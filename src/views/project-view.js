const { Notice, Menu, Platform, setIcon } = require("obsidian");

import { VIEW_PROJECT } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { CompileSelectionModal } from "../ui/selection-modals.js";
import { listExportTemplates, exportBuiltInTemplates } from "../services/export-templates-custom.js";
import { TitlePageModal } from "../ui/title-page-modal.js";

/** Panneau Compilation / export (Bouton de sélection des feuillets dans
 * l'en-tête, Preset, Modèle, Sous-rubrique "Mise en page" identique au
 * panneau propriétés sans aucun cadre de couleur, ligne "Format", et bouton
 * "Exporter" en dessous). La gestion des projets (créer/importer/basculer/
 * retirer/métadonnées) vivait ici auparavant — déplacée dans
 * ManageProjectsModal (ui/project-modals.js), ouverte depuis le binder
 * (menu de la racine, double volet) puisqu'on peut déjà y basculer de
 * projet directement. */
export class ProjectView extends BaseFeuilletsView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
  }

  getViewType() {
    return VIEW_PROJECT;
  }

  getDisplayText() {
    return "Projet & export";
  }

  getIcon() {
    return "folder-cog";
  }

  async onOpen() {
    await this.render();
  }

  async render() {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-project-container");

    const S = this.plugin.settings;
    const root = this.plugin.getProjectFolder();
    if (root) {
      await this.renderCompilationSection(container, S);
    } else {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText("Aucun projet actif — gère tes projets depuis le binder (menu de la racine, double volet).");
    }
  }

  makeRow(parent, icon, label, onClick) {
    const row = parent.createDiv({ cls: "feuillets-project-row" });
    const iconEl = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconEl, icon);
    row.createSpan({ cls: "feuillets-project-row-label" }).setText(label);
    if (onClick) row.addEventListener("click", onClick);
    return row;
  }

  makePropertyRowWithIcon(parent, icon, label, childControl) {
    const row = parent.createDiv({ cls: "feuillets-properties-row" });
    if (icon) {
      const iconEl = row.createSpan({ cls: "feuillets-cell-icon" });
      setIcon(iconEl, icon);
    }
    row.createSpan({ cls: "feuillets-properties-key" }).setText(label);
    row.appendChild(childControl);
    return row;
  }

  /** Petit intitulé de sous-rubrique dans la Mise en page (En-tête / Pied de
   * page / Page de titre) — regroupe visuellement les lignes qui suivent. */
  makeSubhead(parent, text) {
    parent.createDiv({ cls: "feuillets-mep-subhead" }).setText(text);
  }

  // ============================== 2. COMPILATION / EXPORT ==============================

  async renderCompilationSection(container, S) {
    const section = container.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "sliders",
      "Compilation / export",
      "project",
      "compilation",
      (actions) => {
        // Bouton de sélection des feuillets à compiler calé dans l'en-tête
        this.iconBtn(actions, "list-checks", "Choisir les feuillets à compiler…", () =>
          new CompileSelectionModal(this.app, this.plugin).open()
        );
      }
    );
    if (collapsed) return;

    // 1. Sélection du Preset (Au-dessus du Modèle)
    const presets = S.compilePresets || [];
    const presetName =
      S.activePreset >= 0 && presets[S.activePreset]
        ? presets[S.activePreset].name || `Preset ${S.activePreset + 1}`
        : "Réglages par défaut";
    this.makeRow(section, "sliders-horizontal", `Preset : ${presetName}`, (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Réglages par défaut")
          .setChecked(S.activePreset < 0)
          .onClick(async () => {
            S.activePreset = -1;
            await this.plugin.saveSettings();
            this.render();
          })
      );
      presets.forEach((p, i) => {
        menu.addItem((item) =>
          item
            .setTitle(p.name || `Preset ${i + 1}`)
            .setChecked(S.activePreset === i)
            .onClick(async () => {
              S.activePreset = i;
              await this.plugin.saveSettings();
              this.render();
            })
        );
      });
      menu.showAtMouseEvent(e);
    });

    // 2. Choix du modèle éditorial
    const templates = await listExportTemplates(this.app, S);
    const currentTpl = templates.find((t) => t.key === S.exportTemplate) || templates[0];
    this.makeRow(
      section,
      "layout-template",
      `Modèle : ${currentTpl ? currentTpl.label : "Classique"}`,
      (e) => {
        const menu = new Menu();
        templates.forEach((t) => {
          menu.addItem((item) =>
            item
              .setTitle(t.label)
              .setChecked(S.exportTemplate === t.key)
              .onClick(async () => {
                S.exportTemplate = t.key;
                await this.plugin.saveSettings();
                this.render();
              })
          );
        });
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("Exporter les modèles intégrés vers Ressources/Modèles…")
            .setIcon("copy-plus")
            .onClick(async () => {
              const n = await exportBuiltInTemplates(this.app, S);
              new Notice(
                n > 0
                  ? `${n} modèle(s) exporté(s) dans Ressources/Modèles.`
                  : "Tous les modèles sont déjà présents dans Ressources/Modèles."
              );
            })
        );
        menu.showAtMouseEvent(e);
      }
    );

    // 3. Sous-rubrique "Mise en page" identique au panneau propriétés (sans aucun cadre de couleur)
    const optionsSection = section.createDiv({ cls: "feuillets-sub-section" });
    const optionsCollapsed = this.renderSectionHead(
      optionsSection,
      "layout-grid",
      "Mise en page",
      "compilation",
      "options",
      null
    );

    if (!optionsCollapsed) {
      this.makeSubhead(optionsSection, "En-tête");
      // 1. Activer en-têtes
      const enableSelect = this.createEl("select", { cls: "feuillets-properties-value" });
      enableSelect.createEl("option", { text: "Activés", value: "true" });
      enableSelect.createEl("option", { text: "Désactivés", value: "false" });
      enableSelect.value = S.pdfEnableHeaders !== false ? "true" : "false";
      enableSelect.addEventListener("change", async () => {
        S.pdfEnableHeaders = enableSelect.value === "true";
        await this.plugin.saveSettings();
      });
      this.makePropertyRowWithIcon(optionsSection, "heading", "En-têtes", enableSelect);

      // 2. Style en-têtes
      const diffSelect = this.createEl("select", { cls: "feuillets-properties-value" });
      diffSelect.createEl("option", { text: "Alternés (Paires/Impaires)", value: "true" });
      diffSelect.createEl("option", { text: "Identiques", value: "false" });
      diffSelect.value = !!S.pdfDiffHeaders ? "true" : "false";
      diffSelect.addEventListener("change", async () => {
        S.pdfDiffHeaders = diffSelect.value === "true";
        await this.plugin.saveSettings();
      });
      this.makePropertyRowWithIcon(optionsSection, "columns", "Style en-têtes", diffSelect);

      // 3. Page 1
      const hideFirstSelect = this.createEl("select", { cls: "feuillets-properties-value" });
      hideFirstSelect.createEl("option", { text: "Masquer en-tête/N°", value: "true" });
      hideFirstSelect.createEl("option", { text: "Afficher dès p.1", value: "false" });
      hideFirstSelect.value = S.pdfHideFirstPageHeader !== false ? "true" : "false";
      hideFirstSelect.addEventListener("change", async () => {
        S.pdfHideFirstPageHeader = hideFirstSelect.value === "true";
        await this.plugin.saveSettings();
      });
      this.makePropertyRowWithIcon(optionsSection, "file-minus", "Page 1", hideFirstSelect);

      // 4. En-tête G.
      const hlInput = this.createEl("input", { type: "text", cls: "feuillets-properties-value" });
      hlInput.value = S.pdfHeaderLeft || "{title}";
      hlInput.addEventListener("blur", async () => {
        S.pdfHeaderLeft = hlInput.value;
        await this.plugin.saveSettings();
      });
      this.makePropertyRowWithIcon(optionsSection, "align-left", "En-tête G.", hlInput);

      // 5. En-tête D.
      const hrInput = this.createEl("input", { type: "text", cls: "feuillets-properties-value" });
      hrInput.value = S.pdfHeaderRight || "{author}";
      hrInput.addEventListener("blur", async () => {
        S.pdfHeaderRight = hrInput.value;
        await this.plugin.saveSettings();
      });
      this.makePropertyRowWithIcon(optionsSection, "align-right", "En-tête D.", hrInput);

      this.makeSubhead(optionsSection, "Pied de page");
      // 6. Position N°
      const posSelect = this.createEl("select", { cls: "feuillets-properties-value" });
      posSelect.createEl("option", { text: "Droite", value: "right" });
      posSelect.createEl("option", { text: "Centré", value: "center" });
      posSelect.createEl("option", { text: "Gauche", value: "left" });
      posSelect.value = S.pdfPageNumberPosition || "right";
      posSelect.addEventListener("change", async () => {
        S.pdfPageNumberPosition = posSelect.value;
        await this.plugin.saveSettings();
      });
      this.makePropertyRowWithIcon(optionsSection, "binary", "Position N°", posSelect);

      // 7. Format N°
      const numInput = this.createEl("input", { type: "text", cls: "feuillets-properties-value" });
      numInput.value = S.pdfFooterRight || "Page {page} sur {pages}";
      numInput.addEventListener("blur", async () => {
        S.pdfFooterRight = numInput.value;
        await this.plugin.saveSettings();
      });
      this.makePropertyRowWithIcon(optionsSection, "hash", "Format N°", numInput);

      this.makeSubhead(optionsSection, "Page de titre");
      // 8. Réglage des blocs de la page de titre du modèle courant (option A :
      //    édite le .md du modèle sélectionné, voir TitlePageModal).
      this.makeRow(optionsSection, "heading-1", "Régler les blocs…", () => {
        if (!currentTpl) {
          new Notice("Aucun modèle sélectionné.");
          return;
        }
        new TitlePageModal(this.app, this.plugin, currentTpl.key, currentTpl.label).open();
      });
    }

    // 4. Ligne "Format" avec sélection du format
    const formatSelect = this.createEl("select", { cls: "feuillets-properties-value" });
    formatSelect.createEl("option", { text: ".docx (Word)", value: "docx" });
    formatSelect.createEl("option", { text: ".odt (LibreOffice)", value: "odt" });
    formatSelect.createEl("option", { text: ".epub (Ebook)", value: "epub" });
    formatSelect.createEl("option", { text: ".md (Markdown)", value: "md" });
    if (!Platform.isMobile) {
      formatSelect.createEl("option", { text: ".pdf (PDF)", value: "pdf" });
    }
    formatSelect.value = S.exportFormat || "docx";
    formatSelect.addEventListener("change", async () => {
      S.exportFormat = formatSelect.value;
      await this.plugin.saveSettings();
    });
    this.makePropertyRowWithIcon(section, "file-output", "Format", formatSelect);

    // 5. Bouton "Exporter" placé en dessous
    const exportBtn = section.createEl("button", { text: "Exporter", cls: "mod-cta feuillets-export-cta-btn" });
    exportBtn.addEventListener("click", () => {
      const fmt = S.exportFormat || "docx";
      if (fmt === "md") {
        this.plugin.compile();
      } else {
        this.plugin.exportFile(fmt);
      }
    });
  }

  createEl(tag, options) {
    return document.createElement(tag, options);
  }
}
