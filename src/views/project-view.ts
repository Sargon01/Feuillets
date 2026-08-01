import { setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_PROJECT } from "../constants.js";
import { openFeuilletsExportSettings } from "../settings/open-export-settings.js";
import { t } from "../i18n/index.js";
import { activatePreviewView } from "./preview-view.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";

type ProjectViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];
type ElementOptions = ElementCreationOptions & {
  cls?: string;
  text?: string;
  value?: string;
};
type RowClickHandler = (event: MouseEvent) => void;

/** Vue héritée du panneau latéral : elle ne possède plus aucun réglage de
 * compilation ou d'export. Ces réglages vivent uniquement dans l'onglet
 * Export des paramètres Feuillets. */
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

    const section = container.createDiv({ cls: "feuillets-project-section" });
    this.makeRow(section, "settings", t("settings.category.export"), () => openFeuilletsExportSettings(this.app));
    this.makeRow(section, "eye", t("modal.preview.title"), () => void activatePreviewView(this.app));
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

  createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options: ElementOptions): HTMLElementTagNameMap[K] {
    return document.createElement(tag, options);
  }
}
