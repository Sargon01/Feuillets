import {
  listExportTemplates,
  resolveExportTemplate,
  updateTemplateTitlePage,
  exportBuiltInTemplates,
} from "../services/export-templates-custom.js";
import { CompileSelectionModal } from "./selection-modals.js";

const { Modal, Setting, Notice, Platform } = require("obsidian");

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
  constructor(app, plugin, templateKey, templateLabel, onChange) {
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

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("feuillets-titlepage-modal");
    contentEl.empty();
    this.titleEl = contentEl.createEl("h3", { cls: "feuillets-tp-title" });
    contentEl.createEl("p", {
      cls: "setting-item-description feuillets-tp-desc",
      text: "Clique une zone (en-tête, blocs de titre, pied de page) pour l'éditer.",
    });

    const S = this.plugin.settings;
    this.templates = await listExportTemplates(this.app, S);
    if (!this.templates.some((t) => t.key === this.templateKey) && this.templates[0]) {
      this.templateKey = this.templates[0].key;
    }

    // Barre de config : feuillets, preset, modèle, format — tout le réglage
    // de compilation réuni ici, réglable sans quitter le modal.
    const bar = contentEl.createDiv({ cls: "feuillets-tp-configbar" });

    new Setting(bar).setName("Feuillets").addButton((b) =>
      b.setButtonText("Choisir…").onClick(() => new CompileSelectionModal(this.app, this.plugin).open())
    );

    const presets = S.compilePresets || [];
    new Setting(bar).setName("Preset").addDropdown((d) => {
      d.addOption("-1", "Réglages par défaut");
      presets.forEach((p, i) => d.addOption(String(i), p.name || `Preset ${i + 1}`));
      d.setValue(String(S.activePreset >= 0 ? S.activePreset : -1));
      d.onChange(async (v) => {
        S.activePreset = parseInt(v, 10);
        await this.plugin.saveSettings();
        this.notifyChange();
      });
    });

    new Setting(bar)
      .setName("Modèle")
      .addDropdown((d) => {
        this.templates.forEach((t) => d.addOption(t.key, t.label));
        d.setValue(this.templateKey);
        d.onChange(async (v) => {
          this.templateKey = v;
          const t = this.templates.find((x) => x.key === v);
          this.templateLabel = t ? t.label : v;
          S.exportTemplate = v;
          await this.plugin.saveSettings();
          this.notifyChange();
          await this.renderLayout();
        });
      })
      .addExtraButton((b) =>
        b
          .setIcon("copy-plus")
          .setTooltip("Exporter les modèles intégrés vers Ressources/Modèles…")
          .onClick(async () => {
            const n = await exportBuiltInTemplates(this.app, S);
            new Notice(
              n > 0
                ? `${n} modèle(s) exporté(s) dans Ressources/Modèles.`
                : "Tous les modèles sont déjà présents dans Ressources/Modèles."
            );
          })
      );

    new Setting(bar).setName("Format").addDropdown((d) => {
      d.addOption("docx", ".docx (Word)");
      d.addOption("odt", ".odt (LibreOffice)");
      d.addOption("epub", ".epub (Ebook)");
      d.addOption("md", ".md (Markdown)");
      if (!Platform.isMobile) d.addOption("pdf", ".pdf (PDF)");
      d.setValue(S.exportFormat || "docx");
      d.onChange(async (v) => {
        S.exportFormat = v;
        await this.plugin.saveSettings();
        this.notifyChange();
      });
    });

    this.layoutContainer = contentEl.createDiv();
    await this.renderLayout();

    const footer = contentEl.createDiv({ cls: "feuillets-tp-footer" });
    new Setting(footer).addButton((b) =>
      b.setButtonText("Exporter").setCta().onClick(() => this.doExport())
    );
  }

  doExport() {
    const fmt = this.plugin.settings.exportFormat || "docx";
    this.close();
    if (fmt === "md") this.plugin.compile();
    else this.plugin.exportFile(fmt);
  }

  /** (Re)charge les blocs du modèle courant et (re)construit la maquette
   * (bandes + blocs + inspecteur) — rejoué quand on change de modèle. */
  async renderLayout() {
    this.titleEl.setText(`Mise en page — ${this.templateLabel || this.templateKey}`);
    const c = this.layoutContainer;
    c.empty();
    this.selected = null;

    const tpl = await resolveExportTemplate(this.app, this.plugin.settings, this.templateKey);
    this.styles =
      tpl.titlePage && tpl.titlePage.styles ? JSON.parse(JSON.stringify(tpl.titlePage.styles)) : {};
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

  notifyChange() {
    if (this.onChange) this.onChange();
  }

  buildBlocks() {
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
  layout() {
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
  renderBands() {
    const S = this.plugin.settings;
    const off = S.pdfEnableHeaders === false;
    const hideP1 = S.pdfHideFirstPageHeader !== false;

    this.headerBand.empty();
    this.headerBand.toggleClass("is-selected", this.selected === "header");
    this.headerBand.toggleClass("is-muted", off || hideP1);
    if (off) {
      this.headerBand.createSpan().setText("En-tête désactivé");
    } else {
      this.headerBand.createSpan({ cls: "feuillets-tp-band-l" }).setText(S.pdfHeaderLeft || "{title}");
      this.headerBand.createSpan({ cls: "feuillets-tp-band-r" }).setText(S.pdfHeaderRight || "{author}");
    }
    if (hideP1) this.headerBand.createSpan({ cls: "feuillets-tp-band-note" }).setText("masqués p.1");

    this.footerBand.empty();
    this.footerBand.toggleClass("is-selected", this.selected === "footer");
    this.footerBand.toggleClass("is-muted", hideP1);
    const pos = S.pdfPageNumberPosition || "right";
    const span = this.footerBand.createSpan({ cls: `feuillets-tp-band-${pos === "right" ? "r" : pos === "left" ? "l" : "c"}` });
    span.setText(S.pdfFooterRight || "Page {page} sur {pages}");
  }

  startDrag(e, role) {
    e.preventDefault();
    this.select(role);
    const st = this.styles[role];
    const startY = e.clientY;
    const startMargin = st.marginTopPt != null ? st.marginTopPt : 0;
    const onMove = (ev) => {
      const dPt = (ev.clientY - startY) / SCALE;
      st.marginTopPt = Math.max(0, Math.round(startMargin + dPt));
      this.layout();
      this.syncInspectorValues();
    };
    const onUp = async () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      await this.saveModel();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  select(target) {
    this.selected = target;
    this.layout();
    this.renderBands();
    this.renderInspector();
  }

  renderInspector() {
    const insp = this.inspectorEl;
    insp.empty();
    if (this.selected === "header") return this.renderHeaderInspector(insp);
    if (this.selected === "footer") return this.renderFooterInspector(insp);
    if (this.selected && this.styles[this.selected]) return this.renderBlockInspector(insp, this.selected);
    insp.createDiv({ cls: "setting-item-description" }).setText(
      "Clique une zone de la page (en-tête, un bloc de titre, pied de page)."
    );
  }

  renderHeaderInspector(insp) {
    const S = this.plugin.settings;
    insp.createEl("h4", { text: "En-tête (toutes les pages)" });
    const saveBands = async () => {
      await this.plugin.saveSettings();
      this.renderBands();
    };
    new Setting(insp).setName("Activer l'en-tête").addToggle((t) =>
      t.setValue(S.pdfEnableHeaders !== false).onChange(async (v) => {
        S.pdfEnableHeaders = v;
        await saveBands();
      })
    );
    new Setting(insp).setName("En-tête gauche").addText((t) =>
      t.setValue(S.pdfHeaderLeft || "{title}").onChange(async (v) => {
        S.pdfHeaderLeft = v;
        await saveBands();
      })
    );
    new Setting(insp).setName("En-tête droit").addText((t) =>
      t.setValue(S.pdfHeaderRight || "{author}").onChange(async (v) => {
        S.pdfHeaderRight = v;
        await saveBands();
      })
    );
    new Setting(insp).setName("Alternés (paires/impaires)").addToggle((t) =>
      t.setValue(!!S.pdfDiffHeaders).onChange(async (v) => {
        S.pdfDiffHeaders = v;
        await saveBands();
      })
    );
    new Setting(insp).setName("Masquer sur la page de titre").addToggle((t) =>
      t.setValue(S.pdfHideFirstPageHeader !== false).onChange(async (v) => {
        S.pdfHideFirstPageHeader = v;
        await saveBands();
      })
    );
  }

  renderFooterInspector(insp) {
    const S = this.plugin.settings;
    insp.createEl("h4", { text: "Pied de page (numéro)" });
    const saveBands = async () => {
      await this.plugin.saveSettings();
      this.renderBands();
    };
    new Setting(insp).setName("Position du numéro").addDropdown((d) =>
      d
        .addOption("right", "Droite")
        .addOption("center", "Centré")
        .addOption("left", "Gauche")
        .setValue(S.pdfPageNumberPosition || "right")
        .onChange(async (v) => {
          S.pdfPageNumberPosition = v;
          await saveBands();
        })
    );
    new Setting(insp).setName("Format ({page}, {pages})").addText((t) =>
      t.setValue(S.pdfFooterRight || "Page {page} sur {pages}").onChange(async (v) => {
        S.pdfFooterRight = v;
        await saveBands();
      })
    );
  }

  renderBlockInspector(insp, role) {
    const st = this.styles[role];
    insp.createEl("h4", { text: role });
    const num = (name, get, set) =>
      new Setting(insp).setName(name).addText((t) => {
        t.inputEl.type = "number";
        t.setValue(get() != null ? String(get()) : "").onChange(async (v) => {
          const n = parseFloat(v);
          set(v.trim() === "" || !Number.isFinite(n) ? undefined : n);
          this.layout();
          await this.saveModel();
        });
      });

    num("Taille (pt)", () => st.fontSizePt, (n) => (n == null ? delete st.fontSizePt : (st.fontSizePt = n)));

    new Setting(insp).setName("Alignement").then((s) => {
      for (const [val, icon] of [["left", "align-left"], ["center", "align-center"], ["right", "align-right"]]) {
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

    num("Marge au-dessus (pt)", () => st.marginTopPt, (n) => (n == null ? delete st.marginTopPt : (st.marginTopPt = n)));
    num("Marge en dessous (pt)", () => st.marginBottomPt, (n) => (n == null ? delete st.marginBottomPt : (st.marginBottomPt = n)));
  }

  /** Met à jour le champ « marge au-dessus » pendant un glisser, sans
   * reconstruire l'inspecteur (garde le focus des autres champs). */
  syncInspectorValues() {
    if (!this.selected || !this.styles[this.selected]) return;
    const st = this.styles[this.selected];
    const inputs = this.inspectorEl.querySelectorAll('input[type="number"]');
    // ordre : Taille, Marge au-dessus, Marge en dessous
    if (inputs[1]) inputs[1].value = st.marginTopPt != null ? String(st.marginTopPt) : "";
  }

  saveModel() {
    return updateTemplateTitlePage(this.app, this.plugin.settings, this.templateKey, this.styles);
  }

  onClose() {
    this.contentEl.empty();
  }
}
