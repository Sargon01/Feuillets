import {
  listExportTemplates,
  resolveExportTemplateV2,
  saveExportTemplateV2,
} from "../services/export-templates-custom.js";

import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n/index.js";

type LayoutSelection = string | null;
type ExportTemplateOption = { key: string; label: string };
type TitlePageStyles = Record<string, TitlePageStyle>;
type BlockElements = Record<string, HTMLElement>;
type OnLayoutChange = () => void;
type NumberFieldSetter = (value: number | undefined) => void;
type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type LayoutPlugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
};

/* Échelle de la maquette : la zone de contenu (entre bande en-tête et bande
   pied de page) représente la hauteur utile d'une A4 (≈700pt). Aperçu, pas
   rendu exact — les valeurs restent en points. */
const PAGE_USABLE_PT = 700;
const MOCKUP_H_PX = 400;
const HEADER_PX = 26;
const FOOTER_PX = 26;
const SCALE = (MOCKUP_H_PX - HEADER_PX - FOOTER_PX) / PAGE_USABLE_PT;

function isTemplatePageSize(value: string): value is TemplatePageSize {
  return value === "A4" || value === "A5" || value === "Letter";
}

function isTemplateAlign(value: string): value is TemplateAlign {
  return value === "left" || value === "center" || value === "right" || value === "justify";
}

/** Éditeur visuel de MISE EN PAGE (option A) : une seule maquette A4 réunit
 * l'en-tête (bande haute), les blocs de la page de titre (milieu, glissables)
 * et le pied de page (bande basse). Cliquer une zone l'ouvre dans
 * l'inspecteur. En-tête, pied et blocs de titre appartiennent au MODÈLE V2
 * écrit dans son .md. La première page peut masquer les bandes : elles sont
 * alors grisées dans la maquette. */
export class LayoutModal extends Modal {
  plugin: LayoutPlugin;
  templateKey: string;
  templateLabel: string;
  onChange: OnLayoutChange | undefined;
  styles: TitlePageStyles;
  template!: ExportTemplateV2;
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
  navigationButtons: Record<string, HTMLElement>;
  selectedHeading: HeadingLevel;

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
    this.navigationButtons = {};
    this.selectedHeading = "h1";
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

    this.layoutContainer = contentEl.createDiv();
    await this.renderLayout();
  }

  /** (Re)charge les blocs du modèle courant et (re)construit la maquette
   * (bandes + blocs + inspecteur) — rejoué quand on change de modèle. */
  async renderLayout(): Promise<void> {
    this.titleEl.setText(t("modal.layout.pageLayoutTitle", { name: this.templateLabel || this.templateKey }));
    const c = this.layoutContainer;
    c.empty();
    this.selected = null;

    this.template = await resolveExportTemplateV2(this.app, this.plugin.settings, this.templateKey);
    this.styles = JSON.parse(JSON.stringify(this.template.titlePage.styles)) as TitlePageStyles;
    this.roles = Object.keys(this.styles);

    const wrap = c.createDiv({ cls: "feuillets-tp-editor" });
    const navigation = wrap.createDiv({ cls: "feuillets-tp-navigation" });
    for (const [key, label] of [["page", "Page"], ["body", "Corps de texte"], ["headings", "Titres"], ["blockquote", "Citation et séparateur"], ["firstPage", "Première page"]]) {
      const button = navigation.createEl("button", { cls: "feuillets-tp-navigation-item", text: label });
      button.addEventListener("click", () => this.select(key));
      this.navigationButtons[key] = button;
    }
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
    const off = !this.template.header.enabled;
    const hideP1 = this.template.firstPage.hideHeader;

    this.headerBand.empty();
    this.headerBand.toggleClass("is-selected", this.selected === "header");
    this.headerBand.toggleClass("is-muted", off || hideP1);
    if (off) {
      this.headerBand.createSpan().setText(t("modal.layout.headerDisabled"));
    } else {
      this.headerBand.createSpan({ cls: "feuillets-tp-band-l" }).setText(this.template.header.left || "{title}");
      this.headerBand.createSpan({ cls: "feuillets-tp-band-r" }).setText(this.template.header.right || "{author}");
    }
    if (hideP1) this.headerBand.createSpan({ cls: "feuillets-tp-band-note" }).setText(t("modal.layout.hiddenOnP1"));

    this.footerBand.empty();
    this.footerBand.toggleClass("is-selected", this.selected === "footer");
    this.footerBand.toggleClass("is-muted", hideP1);
    const pos = this.template.firstPage.pageNumberPosition;
    const span = this.footerBand.createSpan({ cls: `feuillets-tp-band-${pos === "right" ? "r" : pos === "left" ? "l" : "c"}` });
    span.setText(this.template.footer.right || "Page {page} sur {pages}");
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
       ignore de toute façon la valeur de retour d'un listener). saveModel()
       (updateTemplateTitlePage) enchaîne plusieurs `await` réels (lecture
       puis écriture du fichier) : contrairement à project-view.ts/
       sidebar-feuillets-view.ts (mocks de test sans await interne, où un
       wrapper synchrone + void ne change pas l'ordre observable), ici le
       fire-and-forget laisserait l'assertion suivante du test s'exécuter
       avant la fin réelle de l'écriture. */
    const onUp = async (): Promise<void> => {
      document.removeEventListener("pointermove", onMove);
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- onUp doit rester la même référence (async) pour pointerup ; voir commentaire ci-dessus
      document.removeEventListener("pointerup", onUp);
      await this.saveModel();
    };
    document.addEventListener("pointermove", onMove);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- écouteur async assumé : le test attend sa promesse réelle (voir commentaire ci-dessus)
    document.addEventListener("pointerup", onUp);
  }

  select(target: LayoutSelection): void {
    this.selected = target;
    if (target === "headings") this.selectedHeading = "h1";
    for (const [key, button] of Object.entries(this.navigationButtons)) {
      button.toggleClass("is-active", key === target);
    }
    this.layout();
    this.renderBands();
    this.renderInspector();
  }

  renderInspector(): void {
    const insp = this.inspectorEl;
    insp.empty();
    if (this.selected === "page") return this.renderPageInspector(insp);
    if (this.selected === "body") return this.renderBodyInspector(insp);
    if (this.selected === "headings") return this.renderHeadingsInspector(insp);
    if (this.selected === "blockquote") return this.renderBlockquoteInspector(insp);
    if (this.selected === "firstPage") return this.renderFirstPageInspector(insp);
    if (this.selected === "header") return this.renderHeaderInspector(insp);
    if (this.selected === "footer") return this.renderFooterInspector(insp);
    if (this.selected && this.styles[this.selected]) return this.renderBlockInspector(insp, this.selected);
    insp.createDiv({ cls: "setting-item-description" }).setText(
      t("modal.layout.clickAZone")
    );
  }

  /** Champ numérique V2 partagé par les inspecteurs compacts. */
  private bandNumber(
    insp: HTMLElement,
    name: string,
    value: () => number,
    set: (value: number) => void,
  ): void {
    new Setting(insp).setName(name).addText((t2) => {
      t2.inputEl.type = "number";
      t2.setValue(String(value())).onChange(async (v) => {
        const n = parseFloat(v);
        if (!Number.isFinite(n)) return;
        set(Math.max(0, n));
        await this.saveTemplate();
      });
    });
  }

  renderHeaderInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: t("modal.layout.headerAllPages") });
    new Setting(insp).setName(t("modal.layout.enableHeader")).addToggle((t2) =>
      t2.setValue(this.template.header.enabled).onChange(async (v) => {
        this.template.header.enabled = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName("Gauche").addText((t2) =>
      t2.setValue(this.template.header.left).onChange(async (v) => {
        this.template.header.left = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName(t("modal.layout.headerCenter")).addText((t2) =>
      t2.setValue(this.template.header.center).onChange(async (v) => {
        this.template.header.center = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName("Droite").addText((t2) =>
      t2.setValue(this.template.header.right).onChange(async (v) => {
        this.template.header.right = v;
        await this.saveTemplate();
      })
    );
    this.bandNumber(insp, t("modal.layout.distanceToEdge"), () => this.template.header.distanceCm, (v) => this.template.header.distanceCm = v);
    this.bandNumber(insp, t("modal.layout.headerBodyGap"), () => this.template.header.bodyGapPt, (v) => this.template.header.bodyGapPt = v);
    new Setting(insp).setName(t("modal.layout.alternating")).addToggle((t2) =>
      t2.setValue(this.template.header.differentOddEven).onChange(async (v) => {
        this.template.header.differentOddEven = v;
        await this.saveTemplate();
      })
    );
    insp.createDiv({ cls: "setting-item-description", text: t("modal.layout.variables") });
  }

  renderFooterInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: t("modal.layout.footerNumber") });
    new Setting(insp).setName(t("modal.layout.enableFooter")).addToggle((t2) =>
      t2.setValue(this.template.footer.enabled).onChange(async (v) => {
        this.template.footer.enabled = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName(t("modal.layout.formatWithVars")).addText((t2) =>
      t2.setValue(this.template.footer.right).onChange(async (v) => {
        this.template.footer.right = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName(t("modal.layout.footerLeft")).addText((t2) =>
      t2.setValue(this.template.footer.left).onChange(async (v) => {
        this.template.footer.left = v;
        await this.saveTemplate();
      })
    );
    new Setting(insp).setName(t("modal.layout.footerCenter")).addText((t2) =>
      t2.setValue(this.template.footer.center).onChange(async (v) => {
        this.template.footer.center = v;
        await this.saveTemplate();
      })
    );
    this.bandNumber(insp, t("modal.layout.distanceToEdge"), () => this.template.footer.distanceCm, (v) => this.template.footer.distanceCm = v);
    this.bandNumber(insp, t("modal.layout.footerBodyGap"), () => this.template.footer.bodyGapPt, (v) => this.template.footer.bodyGapPt = v);
    insp.createDiv({ cls: "setting-item-description", text: t("modal.layout.variables") });
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

  private numberField(insp: HTMLElement, name: string, value: () => number, set: (value: number) => void): void {
    new Setting(insp).setName(name).addText((control) => {
      control.inputEl.type = "number";
      control.setValue(String(value())).onChange(async (raw) => {
        const next = Number.parseFloat(raw);
        if (!Number.isFinite(next)) return;
        set(next);
        await this.saveTemplate();
      });
    });
  }

  private optionalNumberField(insp: HTMLElement, name: string, value: () => number | undefined, set: (value: number | undefined) => void): void {
    new Setting(insp).setName(name).addText((control) => {
      control.inputEl.type = "number";
      const current = value();
      control.setValue(current == null ? "" : String(current)).onChange(async (raw) => {
        if (raw.trim() === "") set(undefined);
        else {
          const next = Number.parseFloat(raw);
          if (!Number.isFinite(next)) return;
          set(next);
        }
        await this.saveTemplate();
      });
    });
  }

  private textField(insp: HTMLElement, name: string, value: () => string, set: (value: string) => void): void {
    new Setting(insp).setName(name).addText((control) =>
      control.setValue(value()).onChange(async (next) => { set(next); await this.saveTemplate(); })
    );
  }

  renderPageInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: "Page" });
    this.textField(insp, "Format", () => this.template.page.size, (v) => {
      if (isTemplatePageSize(v)) this.template.page.size = v;
    });
    new Setting(insp).setName("Orientation").addDropdown((d) => d
      .addOption("portrait", "Portrait").addOption("landscape", "Paysage")
      .setValue(this.template.page.orientation).onChange(async (v) => {
        if (v === "portrait" || v === "landscape") this.template.page.orientation = v;
        await this.saveTemplate();
      }));
    for (const side of ["top", "bottom", "left", "right"] as const) {
      this.numberField(insp, `Marge ${side}`, () => this.template.page.marginsCm[side], (v) => this.template.page.marginsCm[side] = Math.max(0, v));
    }
    new Setting(insp).setName("Marges miroir").addToggle((control) => control.setValue(this.template.page.mirrorMargins).onChange(async (v) => {
      this.template.page.mirrorMargins = v; await this.saveTemplate();
    }));
    this.numberField(insp, "Colonnes", () => this.template.page.columns.count, (v) => this.template.page.columns.count = Math.max(1, Math.round(v)));
    this.numberField(insp, "Gouttière (pt)", () => this.template.page.columns.gutterPt, (v) => this.template.page.columns.gutterPt = Math.max(0, v));
  }

  renderBodyInspector(insp: HTMLElement): void {
    const body = this.template.body;
    insp.createEl("h4", { text: "Corps de texte" });
    this.textField(insp, "Police", () => body.fontFamily, (v) => body.fontFamily = v);
    this.numberField(insp, "Taille (pt)", () => body.fontSizePt, (v) => body.fontSizePt = Math.max(1, v));
    this.numberField(insp, "Interligne", () => body.lineHeight, (v) => body.lineHeight = Math.max(0.1, v));
    new Setting(insp).setName("Alignement").addDropdown((d) => d
      .addOption("left", "Gauche").addOption("center", "Centré").addOption("right", "Droite").addOption("justify", "Justifié")
      .setValue(body.align).onChange(async (v) => { if (isTemplateAlign(v)) body.align = v; await this.saveTemplate(); }));
    this.numberField(insp, "Retrait première ligne (pt)", () => body.firstLineIndentPt, (v) => body.firstLineIndentPt = Math.max(0, v));
    this.numberField(insp, "Espacement avant (pt)", () => body.paragraphSpacingBeforePt, (v) => body.paragraphSpacingBeforePt = Math.max(0, v));
    this.numberField(insp, "Espacement après (pt)", () => body.paragraphSpacingAfterPt, (v) => body.paragraphSpacingAfterPt = Math.max(0, v));
    new Setting(insp).setName("Césure").addToggle((control) => control.setValue(body.hyphenation).onChange(async (v) => { body.hyphenation = v; await this.saveTemplate(); }));
    new Setting(insp).setName("Profil").addDropdown((d) => d
      .addOption("manuscript", "Manuscrit").addOption("document", "Document").addOption("academic", "Académique")
      .setValue(this.template.profile).onChange(async (v) => {
        if (v === "manuscript" || v === "document" || v === "academic") this.template.profile = v;
        await this.saveTemplate();
      }));
  }

  renderHeadingsInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: "Titres" });
    const picker = insp.createDiv({ cls: "feuillets-heading-level-picker" });
    for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
      const button = picker.createEl("button", { cls: "feuillets-heading-level", text: level.toUpperCase() });
      button.toggleClass("is-active", this.selectedHeading === level);
      button.addEventListener("click", () => {
        this.selectedHeading = level;
        this.renderInspector();
      });
    }
    const style = this.template.headings[this.selectedHeading];
    const editor = insp.createDiv({ cls: "feuillets-heading-editor" });
    editor.createEl("h5", { text: this.selectedHeading.toUpperCase() });
    this.textField(editor, "Police", () => style.fontFamily || "", (v) => style.fontFamily = v.trim() || undefined);
    this.numberField(editor, "Taille (pt)", () => style.fontSizePt ?? 0, (v) => style.fontSizePt = v || undefined);
    new Setting(editor).setName("Gras").addToggle((c) => c.setValue(!!style.bold).onChange(async (v) => { style.bold = v; await this.saveTemplate(); }));
    new Setting(editor).setName("Italique").addToggle((c) => c.setValue(!!style.italic).onChange(async (v) => { style.italic = v; await this.saveTemplate(); }));
    this.textField(editor, "Alignement", () => style.align || "left", (v) => {
      if (isTemplateAlign(v)) style.align = v;
    });
    this.numberField(editor, "Espace avant", () => style.marginTopPt ?? 0, (v) => style.marginTopPt = v || undefined);
    this.numberField(editor, "Espace après", () => style.marginBottomPt ?? 0, (v) => style.marginBottomPt = v || undefined);
    new Setting(editor).setName("Saut de page avant").addToggle((c) => c.setValue(!!style.pageBreakBefore).onChange(async (v) => { style.pageBreakBefore = v; await this.saveTemplate(); }));
  }

  renderBlockquoteInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: "Citation et séparateur" });
    const quote = this.template.blockquote;
    this.textField(insp, "Police", () => quote.fontFamily || "", (v) => quote.fontFamily = v.trim() || undefined);
    this.optionalNumberField(insp, "Taille (pt)", () => quote.fontSizePt, (v) => quote.fontSizePt = v);
    this.optionalNumberField(insp, "Interligne", () => quote.lineHeight, (v) => quote.lineHeight = v);
    new Setting(insp).setName("Alignement").addDropdown((d) => d
      .addOption("", "Par défaut").addOption("left", "Gauche").addOption("center", "Centré").addOption("right", "Droite").addOption("justify", "Justifié")
      .setValue(quote.align || "").onChange(async (v) => { quote.align = isTemplateAlign(v) ? v : undefined; await this.saveTemplate(); }));
    this.optionalNumberField(insp, "Retrait première ligne (pt)", () => quote.firstLineIndentPt, (v) => quote.firstLineIndentPt = v);
    this.optionalNumberField(insp, "Marge gauche (pt)", () => quote.marginLeftPt, (v) => quote.marginLeftPt = v);
    this.optionalNumberField(insp, "Marge droite (pt)", () => quote.marginRightPt, (v) => quote.marginRightPt = v);
    this.optionalNumberField(insp, "Espace avant (pt)", () => quote.marginTopPt, (v) => quote.marginTopPt = v);
    this.optionalNumberField(insp, "Espace après (pt)", () => quote.marginBottomPt, (v) => quote.marginBottomPt = v);
    new Setting(insp).setName("Italique").addDropdown((d) => d
      .addOption("", "Par défaut").addOption("true", "Italique").addOption("false", "Normal")
      .setValue(quote.italic === undefined ? "" : String(quote.italic)).onChange(async (v) => { quote.italic = v === "" ? undefined : v === "true"; await this.saveTemplate(); }));
    this.textField(insp, "Couleur", () => quote.colorHex || "", (v) => quote.colorHex = v.trim() || undefined);
    this.textField(insp, "Séparateur de scène", () => this.template.sceneDivider, (v) => this.template.sceneDivider = v);
  }

  renderFirstPageInspector(insp: HTMLElement): void {
    insp.createEl("h4", { text: "Première page" });
    new Setting(insp).setName("Masquer en-tête et pied").addToggle((c) => c.setValue(this.template.firstPage.hideHeader).onChange(async (v) => { this.template.firstPage.hideHeader = v; await this.saveTemplate(); }));
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

  async saveModel(): Promise<void> {
    this.template.titlePage.styles = JSON.parse(JSON.stringify(this.styles)) as TitlePageStyles;
    await this.saveTemplate();
  }

  async saveTemplate(): Promise<void> {
    await saveExportTemplateV2(this.app, this.plugin.settings, this.templateKey, this.template);
    this.renderBands();
    this.notifyChange();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
