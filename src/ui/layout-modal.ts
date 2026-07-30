import {
  listExportTemplates,
  resolveExportTemplate,
  updateTemplateTitlePage,
  exportBuiltInTemplates,
} from "../services/export-templates-custom.js";
import { CompileSelectionModal } from "./selection-modals.js";

import { Modal, Setting, Notice, Platform } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n/index.js";

type ExportFormat = "docx" | "odt" | "epub" | "md" | "pdf";
type LayoutSelection = string | null;
type ExportTemplateOption = { key: string; label: string };
type TitlePageStyles = Record<string, TitlePageStyle>;
type BlockElements = Record<string, HTMLElement>;
type OnLayoutChange = () => void;
type NumberFieldSetter = (value: number | undefined) => void;
type SelectionPlugin = ConstructorParameters<typeof CompileSelectionModal>[1];
type LayoutPlugin = SelectionPlugin & {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
  compile(): Promise<CompileResult | null>;
  exportFile(format: ExportFormat): Promise<void>;
};

function presetLabel(preset: unknown, index: number): string {
  if (typeof preset === "object" && preset !== null && "name" in preset && typeof preset.name === "string") {
    return preset.name;
  }
  return t("settings.compilePresets.item", { n: String(index + 1) });
}

function isExportFormat(value: string): value is ExportFormat {
  return value === "docx" || value === "odt" || value === "epub" || value === "md" || value === "pdf";
}

/* Échelle de la maquette : la zone de contenu (entre bande en-tête et bande
   pied de page) représente la hauteur utile d'une A4 (≈700pt). Aperçu, pas
   rendu exact — les valeurs restent en points. */
const PAGE_USABLE_PT = 700;
const MOCKUP_H_PX = 400;
const HEADER_PX = 26;
const FOOTER_PX = 26;
const SCALE = (MOCKUP_H_PX - HEADER_PX - FOOTER_PX) / PAGE_USABLE_PT;

/** Éditeur visuel de MISE EN PAGE (option A) : une seule maquette A4 réunit
 * l'en-tête (bande haute), les blocs de la page de titre (milieu, glissables)
 * et le pied de page (bande basse). Cliquer une zone l'ouvre dans
 * l'inspecteur. En-tête/pied de page sont GLOBAUX (réglages du plugin, toutes
 * les pages) ; les blocs de titre sont propres au MODÈLE (écrits dans son .md,
 * option A). La page de titre masque normalement en-tête/pied (réglage
 * « Masquer p.1 ») : les bandes sont alors grisées avec la mention. */
export class LayoutModal extends Modal {
  plugin: LayoutPlugin;
  templateKey: string;
  templateLabel: string;
  onChange: OnLayoutChange | undefined;
  styles: TitlePageStyles;
  roles: string[];
  selected: LayoutSelection;
  blockEls: BlockElements;
  templates: ExportTemplateOption[] = [];
  titleEl!: HTMLElement;
  layoutContainer!: HTMLElement;
  pageEl!: HTMLElement;
  headerBand!: HTMLElement;
  footerBand!: HTMLElement;
  inspectorEl!: HTMLElement;

  constructor(app: App, plugin: LayoutPlugin, templateKey: string, templateLabel: string, onChange?: OnLayoutChange) {
    super(app);
    this.plugin = plugin;
    this.templateKey = templateKey;
    this.templateLabel = templateLabel;
    this.onChange = onChange; // rafraîchit le panneau après un changement
    this.styles = {};
    this.roles = [];
    this.selected = null; // "header" | "footer" | <role>
    this.blockEls = {};
  }

  async onOpen(): Promise<void> {
    const { contentEl, modalEl } = this;
    modalEl.addClass("feuillets-titlepage-modal");
    contentEl.empty();
    this.titleEl = contentEl.createEl("h3", { cls: "feuillets-tp-title" });
    contentEl.createEl("p", {
      cls: "setting-item-description feuillets-tp-desc",
      text: t("modal.layout.clickToEdit"),
    });

    const S = this.plugin.settings;
    this.templates = await listExportTemplates(this.app, S);
    if (!this.templates.some((tpl) => tpl.key === this.templateKey) && this.templates[0]) {
      this.templateKey = this.templates[0].key;
    }

    // Barre de config : feuillets, preset, modèle, format — tout le réglage
    // de compilation réuni ici, réglable sans quitter le modal.
    const bar = contentEl.createDiv({ cls: "feuillets-tp-configbar" });

    new Setting(bar).setName(t("modal.layout.sheets")).addButton((b) =>
      b.setButtonText(t("modal.layout.chooseBtn")).onClick(() => new CompileSelectionModal(this.app, this.plugin).open())
    );

    const presets = S.compilePresets || [];
    const presetSetting = new Setting(bar).setName(t("modal.layout.preset"));
    presetSetting.addDropdown((d) => {
      d.addOption("-1", t("modal.layout.defaultSettings"));
      presets.forEach((preset, index) => {
        d.addOption(String(index), presetLabel(preset, index));
      });
      const activePreset = S["activePreset"];
      d.setValue(String(typeof activePreset === "number" && activePreset >= 0 ? activePreset : -1));
      d.onChange(async (v) => {
        S["activePreset"] = parseInt(v, 10);
        await this.plugin.saveSettings();
        this.notifyChange();
      });
    });

    const templateSetting = new Setting(bar).setName(t("modal.layout.template"));
    templateSetting.addDropdown((d) => {
      this.templates.forEach((tpl) => {
        d.addOption(tpl.key, tpl.label);
      });
      d.setValue(this.templateKey);
      d.onChange(async (v) => {
        this.templateKey = v;
        const tpl = this.templates.find((x) => x.key === v);
        this.templateLabel = tpl ? tpl.label : v;
        S.exportTemplate = v;
        await this.plugin.saveSettings();
        this.notifyChange();
        await this.renderLayout();
      });
    });
    templateSetting.addExtraButton((b) => {
      b.setIcon("copy-plus");
      b.setTooltip(t("modal.layout.exportTemplatesTooltip"));
      b.onClick(async () => {
        const n = await exportBuiltInTemplates(this.app, S);
        new Notice(
          n > 0
            ? t("main.notice.templatesExported", { count: String(n) })
            : t("modal.layout.allTemplatesPresent")
        );
      });
    });

    new Setting(bar).setName(t("project.compilation.formatLabel")).addDropdown((d) => {
      d.addOption("docx", ".docx (Word)");
      d.addOption("odt", ".odt (LibreOffice)");
      d.addOption("epub", ".epub (Ebook)");
      d.addOption("md", ".md (Markdown)");
      if (!Platform.isMobile) d.addOption("pdf", ".pdf (PDF)");
      const exportFormat = S["exportFormat"];
      d.setValue(typeof exportFormat === "string" ? exportFormat : "docx");
      d.onChange(async (v) => {
        if (!isExportFormat(v)) return;
        S["exportFormat"] = v;
        await this.plugin.saveSettings();
        this.notifyChange();
      });
    });

    this.layoutContainer = contentEl.createDiv();
    await this.renderLayout();

    const footer = contentEl.createDiv({ cls: "feuillets-tp-footer" });
    new Setting(footer).addButton((b) =>
      b.setButtonText(t("project.compilation.exportBtn")).setCta().onClick(() => this.doExport())
    );
  }

  doExport(): void {
    const savedFormat = this.plugin.settings["exportFormat"];
    const fmt = typeof savedFormat === "string" && isExportFormat(savedFormat) ? savedFormat : "docx";
    this.close();
    if (fmt === "md") void this.plugin.compile();
    else void this.plugin.exportFile(fmt);
  }

  /** (Re)charge les blocs du modèle courant et (re)construit la maquette
   * (bandes + blocs + inspecteur) — rejoué quand on change de modèle. */
  async renderLayout(): Promise<void> {
    this.titleEl.setText(t("modal.layout.pageLayoutTitle", { name: this.templateLabel || this.templateKey }));
    const c = this.layoutContainer;
    c.empty();
    this.selected = null;

    const tpl = await resolveExportTemplate(this.app, this.plugin.settings, this.templateKey);
    this.styles = (tpl.titlePage && tpl.titlePage.styles ? JSON.parse(JSON.stringify(tpl.titlePage.styles)) : {}) as TitlePageStyles;
    this.roles = Object.keys(this.styles);

    const wrap = c.createDiv({ cls: "feuillets-tp-editor" });
    this.pageEl = wrap.createDiv({ cls: "feuillets-tp-page" });
    this.pageEl.style.height = `${MOCKUP_H_PX}px`;

    this.headerBand = this.pageEl.createDiv({ cls: "feuillets-tp-band feuillets-tp-band-top" });
    this.headerBand.style.height = `${HEADER_PX}px`;
    this.headerBand.addEventListener("click", () => this.select("header"));

    this.footerBand = this.pageEl.createDiv({ cls: "feuillets-tp-band feuillets-tp-band-bottom" });
    this.footerBand.style.height = `${FOOTER_PX}px`;
    this.footerBand.addEventListener("click", () => this.select("footer"));

    this.buildBlocks();

    this.inspectorEl = wrap.createDiv({ cls: "feuillets-tp-inspector" });

    this.layout();
    this.renderBands();
    this.renderInspector();
  }

  notifyChange(): void {
    if (this.onChange) this.onChange();
  }

  buildBlocks(): void {
    this.blockEls = {};
    for (const role of this.roles) {
      const el = this.pageEl.createDiv({ cls: "feuillets-tp-block" });
      el.createSpan({ cls: "feuillets-tp-block-label" }).setText(role);
      el.addEventListener("pointerdown", (e) => this.startDrag(e, role));
      this.blockEls[role] = el;
    }
  }

  /** Positionne chaque bloc dans la zone de contenu (sous la bande en-tête),
   * pile verticale à marges cumulées. */
  layout(): void {
    let y = 0;
    for (const role of this.roles) {
      const st = this.styles[role];
      const size = st.fontSizePt != null ? st.fontSizePt : 12;
      const mTop = st.marginTopPt != null ? st.marginTopPt : 0;
      const mBot = st.marginBottomPt != null ? st.marginBottomPt : 0;
      y += mTop;
      const el = this.blockEls[role];
      el.style.top = `${HEADER_PX + y * SCALE}px`;
      el.style.fontSize = `${Math.max(6, size * SCALE)}px`;
      el.style.textAlign = st.align || "center";
      el.toggleClass("is-selected", this.selected === role);
      y += size + mBot;
    }
  }

  /** Contenu et état (grisé) des bandes en-tête/pied selon les réglages. */
  renderBands(): void {
    const S = this.plugin.settings;
    const off = S["pdfEnableHeaders"] === false;
    const hideP1 = S.pdfHideFirstPageHeader !== false;

    this.headerBand.empty();
    this.headerBand.toggleClass("is-selected", this.selected === "header");
    this.headerBand.toggleClass("is-muted", off || hideP1);
    if (off) {
      this.headerBand.createSpan().setText(t("modal.layout.headerDisabled"));
    } else {
      this.headerBand.createSpan({ cls: "feuillets-tp-band-l" }).setText(S.pdfHeaderLeft || "{title}");
      this.headerBand.createSpan({ cls: "feuillets-tp-band-r" }).setText(S.pdfHeaderRight || "{author}");
    }
    if (hideP1) this.headerBand.createSpan({ cls: "feuillets-tp-band-note" }).setText(t("modal.layout.hiddenOnP1"));

    this.footerBand.empty();
    this.footerBand.toggleClass("is-selected", this.selected === "footer");
    this.footerBand.toggleClass("is-muted", hideP1);
    const pos = S.pdfPageNumberPosition || "right";
    const span = this.footerBand.createSpan({ cls: `feuillets-tp-band-${pos === "right" ? "r" : pos === "left" ? "l" : "c"}` });
    span.setText(S.pdfFooterRight || "Page {page} sur {pages}");
  }

  startDrag(e: PointerEvent, role: string): void {
    e.preventDefault();
    this.select(role);
    const st = this.styles[role];
    const startY = e.clientY;
    const startMargin = st.marginTopPt != null ? st.marginTopPt : 0;
    const onMove = (ev: PointerEvent) => {
      const dPt = (ev.clientY - startY) / SCALE;
      st.marginTopPt = Math.max(0, Math.round(startMargin + dPt));
      this.layout();
      this.syncInspectorValues();
    };
    /* Reste passé directement à addEventListener malgré no-misused-promises :
       le test (layout-modal.test.js, "sans écriture prématurée") attend la
       fin réelle de saveModel() via `await listeners.get("pointerup")()` —
       un wrapper synchrone (void this.saveModel()) casse cette garantie
       observable sans rien changer au comportement réel côté DOM (qui
       ignore de toute façon la valeur de retour d'un listener). */
    const onUp = async (): Promise<void> => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      await this.saveModel();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  select(target: LayoutSelection): void {
    this.selected = target;
    this.layout();
    this.renderBands();
    this.renderInspector();
  }

  renderInspector(): void {
    const insp = this.inspectorEl;
    insp.empty();
    if (this.selected === "header") return this.renderHeaderInspector(insp);
    if (this.selected === "footer") return this.renderFooterInspector(insp);
    if (this.selected && this.styles[this.selected]) return this.renderBlockInspector(insp, this.selected);
    insp.createDiv({ cls: "setting-item-description" }).setText(
      t("modal.layout.clickAZone")
    );
  }

  renderHeaderInspector(insp: HTMLElement): void {
    const S = this.plugin.settings;
    insp.createEl("h4", { text: t("modal.layout.headerAllPages") });
    const saveBands = async () => {
      await this.plugin.saveSettings();
      this.renderBands();
    };
    new Setting(insp).setName(t("modal.layout.enableHeader")).addToggle((t2) =>
      t2.setValue(S["pdfEnableHeaders"] !== false).onChange(async (v) => {
        S["pdfEnableHeaders"] = v;
        await saveBands();
      })
    );
    new Setting(insp).setName(t("settings.pdfHeaderLeft.name")).addText((t2) =>
      t2.setValue(S.pdfHeaderLeft || "{title}").onChange(async (v) => {
        S.pdfHeaderLeft = v;
        await saveBands();
      })
    );
    new Setting(insp).setName(t("settings.pdfHeaderRight.name")).addText((t2) =>
      t2.setValue(S.pdfHeaderRight || "{author}").onChange(async (v) => {
        S.pdfHeaderRight = v;
        await saveBands();
      })
    );
    new Setting(insp).setName(t("modal.layout.alternating")).addToggle((t2) =>
      t2.setValue(!!S.pdfDiffHeaders).onChange(async (v) => {
        S.pdfDiffHeaders = v;
        await saveBands();
      })
    );
    new Setting(insp).setName(t("modal.layout.hideOnTitlePage")).addToggle((t2) =>
      t2.setValue(S.pdfHideFirstPageHeader !== false).onChange(async (v) => {
        S.pdfHideFirstPageHeader = v;
        await saveBands();
      })
    );
  }

  renderFooterInspector(insp: HTMLElement): void {
    const S = this.plugin.settings;
    insp.createEl("h4", { text: t("modal.layout.footerNumber") });
    const saveBands = async () => {
      await this.plugin.saveSettings();
      this.renderBands();
    };
    new Setting(insp).setName(t("modal.pdfStyle.numberPosition")).addDropdown((d) =>
      d
        .addOption("right", t("settings.pdfPageNumberPosition.right"))
        .addOption("center", t("settings.pdfPageNumberPosition.center"))
        .addOption("left", t("settings.pdfPageNumberPosition.left"))
        .setValue(S.pdfPageNumberPosition || "right")
        .onChange(async (v) => {
          if (v !== "right" && v !== "center" && v !== "left") return;
          S.pdfPageNumberPosition = v;
          await saveBands();
        })
    );
    new Setting(insp).setName(t("modal.layout.formatWithVars")).addText((t2) =>
      t2.setValue(S.pdfFooterRight || "Page {page} sur {pages}").onChange(async (v) => {
        S.pdfFooterRight = v;
        await saveBands();
      })
    );
  }

  renderBlockInspector(insp: HTMLElement, role: string): void {
    const st = this.styles[role];
    insp.createEl("h4", { text: role });
    const num = (name: string, get: () => number | undefined, set: NumberFieldSetter): Setting =>
      new Setting(insp).setName(name).addText((t2) => {
        t2.inputEl.type = "number";
        t2.setValue(get() != null ? String(get()) : "").onChange(async (v) => {
          const n = parseFloat(v);
          set(v.trim() === "" || !Number.isFinite(n) ? undefined : n);
          this.layout();
          await this.saveModel();
        });
      });

    num(t("modal.layout.sizePt"), () => st.fontSizePt, (n) => (n == null ? delete st.fontSizePt : (st.fontSizePt = n)));

    new Setting(insp).setName(t("modal.layout.alignment")).then((s) => {
      const alignments: Array<[string, string]> = [["left", "align-left"], ["center", "align-center"], ["right", "align-right"]];
      for (const [val, icon] of alignments) {
        s.addExtraButton((b) => {
          b.setIcon(icon).setTooltip(val).onClick(async () => {
            st.align = val;
            this.layout();
            this.renderInspector();
            await this.saveModel();
          });
          if ((st.align || "center") === val) b.extraSettingsEl.addClass("is-active");
        });
      }
    });

    num(t("modal.layout.marginAbove"), () => st.marginTopPt, (n) => (n == null ? delete st.marginTopPt : (st.marginTopPt = n)));
    num(t("modal.layout.marginBelow"), () => st.marginBottomPt, (n) => (n == null ? delete st.marginBottomPt : (st.marginBottomPt = n)));
  }

  /** Met à jour le champ « marge au-dessus » pendant un glisser, sans
   * reconstruire l'inspecteur (garde le focus des autres champs). */
  syncInspectorValues(): void {
    if (!this.selected || !this.styles[this.selected]) return;
    const st = this.styles[this.selected];
    const inputs = this.inspectorEl.querySelectorAll<HTMLInputElement>('input[type="number"]');
    // ordre : Taille, Marge au-dessus, Marge en dessous
    if (inputs[1]) inputs[1].value = st.marginTopPt != null ? String(st.marginTopPt) : "";
  }

  saveModel(): Promise<void> {
    return updateTemplateTitlePage(this.app, this.plugin.settings, this.templateKey, this.styles);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
