import { Notice, Platform, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_PROJECT } from "../constants.js";
import { listExportTemplates } from "../services/export-templates-custom.js";
import { t } from "../i18n/index.js";
import { CompileSelectionModal } from "../ui/selection-modals.js";
import { LayoutModal } from "../ui/layout-modal.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";

type ProjectViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];
type ElementOptions = ElementCreationOptions & {
  cls?: string;
  text?: string;
  value?: string;
};
type RowClickHandler = (event: MouseEvent) => void;

function exportFormatFor(settings: FeuilletsSettings): string {
  const format = settings.exportFormat;
  return typeof format === "string" && format ? format : "docx";
}

/** Panneau Compilation / export (Bouton de sélection des feuillets dans
 * l'en-tête, Preset, Modèle, Sous-rubrique "Mise en page" identique au
 * panneau propriétés sans aucun cadre de couleur, ligne "Format", et bouton
 * "Exporter" en dessous). La gestion des projets (créer/importer/basculer/
 * retirer/métadonnées) vivait ici auparavant — déplacée dans
 * ManageProjectsModal (ui/project-modals.js), ouverte depuis le binder
 * (menu de la racine, double volet) puisqu'on peut déjà y basculer de
 * projet directement. */
export class ProjectView extends BaseFeuilletsView {
  declare plugin: ProjectViewPlugin;
  declare targetContainer?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: ProjectViewPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return VIEW_PROJECT;
  }

  getDisplayText(): string {
    return t("project.displayText");
  }

  getIcon(): string {
    return "folder-cog";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-project-container");

    const settings = this.plugin.settings;
    const root = this.plugin.getProjectFolder();
    if (root) {
      await this.renderCompilationSection(container, settings);
    } else {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("project.noActiveProject"));
    }
  }

  makeRow(parent: HTMLElement, icon: string, label: string, onClick?: RowClickHandler): HTMLElement {
    const row = parent.createDiv({ cls: "feuillets-project-row" });
    const iconEl = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconEl, icon);
    row.createSpan({ cls: "feuillets-project-row-label" }).setText(label);
    if (onClick) row.addEventListener("click", onClick);
    return row;
  }

  makePropertyRowWithIcon(parent: HTMLElement, icon: string, label: string, childControl: HTMLElement): HTMLElement {
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

  async renderCompilationSection(container: HTMLElement, settings: FeuilletsSettings): Promise<void> {
    const section = container.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "sliders",
      t("project.compilation.title"),
      "project",
      "compilation",
      (actions: HTMLElement) => {
        // Bouton de sélection des feuillets à compiler calé dans l'en-tête
        this.iconBtn(actions, "list-checks", t("project.compilation.chooseSheetsTooltip"), () =>
          new CompileSelectionModal(this.app, this.plugin).open()
        );
      }
    );
    if (collapsed) return;

    /* Tout le réglage de compilation (feuillets à compiler, preset, modèle,
       en-tête/pied de page, blocs de la page de titre) est réuni dans le hub
       — l'éditeur de mise en page (LayoutModal). Le panneau ne garde que
       l'accès au hub, le format et le bouton Exporter (chemin rapide). */
    const templates = await listExportTemplates(this.app, settings);
    const currentTpl = templates.find((tpl) => tpl.key === settings.exportTemplate) || templates[0];
    this.makeRow(section, "sliders", t("project.compilation.layoutRow"), () => {
      if (!currentTpl) {
        new Notice(t("project.compilation.noTemplate"));
        return;
      }
      new LayoutModal(this.app, this.plugin, currentTpl.key, currentTpl.label, () => { void this.render(); }).open();
    });

    // Ligne "Format" avec sélection du format (accès rapide)
    const formatSelect: HTMLSelectElement = this.createEl("select", { cls: "feuillets-properties-value" });
    formatSelect.createEl("option", { text: ".docx (Word)", value: "docx" });
    formatSelect.createEl("option", { text: ".odt (LibreOffice)", value: "odt" });
    formatSelect.createEl("option", { text: ".epub (Ebook)", value: "epub" });
    formatSelect.createEl("option", { text: ".md (Markdown)", value: "md" });
    if (!Platform.isMobile) {
      formatSelect.createEl("option", { text: ".pdf (PDF)", value: "pdf" });
    }
    formatSelect.value = exportFormatFor(settings);
    formatSelect.addEventListener("change", async () => {
      settings.exportFormat = formatSelect.value;
      await this.plugin.saveSettings();
    });
    this.makePropertyRowWithIcon(section, "file-output", t("project.compilation.formatLabel"), formatSelect);

    // 5. Bouton "Exporter" placé en dessous
    const exportBtn = section.createEl("button", { text: t("project.compilation.exportBtn"), cls: "mod-cta feuillets-export-cta-btn" });
    exportBtn.addEventListener("click", () => {
      const format = exportFormatFor(settings);
      if (format === "md") {
        void this.plugin.compile();
      } else {
        void this.plugin.exportFile(format);
      }
    });
  }

  createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options: ElementOptions): HTMLElementTagNameMap[K] {
    return document.createElement(tag, options);
  }
}
