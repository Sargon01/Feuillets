const { Notice, Menu, Platform, setIcon } = require("obsidian");

import { VIEW_PROJECT } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { CompileSelectionModal } from "../ui/selection-modals.js";
import { listExportTemplates, exportBuiltInTemplates } from "../services/export-templates-custom.js";
import { LayoutModal } from "../ui/layout-modal.js";

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
      /* Mise en page unifiée : en-tête, blocs de titre et pied de page se
         règlent ensemble dans un éditeur visuel (une maquette A4), plutôt
         qu'en réglages séparés — voir LayoutModal. */
      this.makeRow(optionsSection, "layout-template", "Éditer la mise en page…", () => {
        if (!currentTpl) {
          new Notice("Aucun modèle sélectionné.");
          return;
        }
        new LayoutModal(this.app, this.plugin, currentTpl.key, currentTpl.label, () => this.render()).open();
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
