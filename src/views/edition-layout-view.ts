import { Menu, Notice, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { listExportTemplates, duplicateExportTemplate } from "../services/export-templates-custom.js";
import { LayoutModal } from "../ui/layout-modal.js";
import { ExportPanel } from "../ui/export-panel.js";
import { UlyssesImportModal } from "../ui/ulysses-import-modal.js";
import { WordTemplateImportModal } from "../ui/word-template-import-modal.js";

type EditionLayoutPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1] & {
  settings: FeuilletsSettings & { exportTemplate: string };
  saveSettings(): Promise<void>;
};

/** Sous-section "Mise en page" du nouvel espace Édition (Phase 11) :
 * Gabarit actif, Modifier visuellement, Dupliquer, Importer Ulysses —
 * réutilise entièrement l'architecture existante (listExportTemplates,
 * LayoutModal, services/export-templates-custom.ts), aucun second système
 * de gabarits. Les moteurs d'export continuent de lire
 * `settings.exportTemplate` exactement comme avant : cette vue ne fait que
 * déplacer LES COMMANDES qui le règlent, depuis ExportPanel (qui perd son
 * champ « Gabarit », voir ui/export-panel.ts) vers ici. */
export class EditionLayoutView extends BaseFeuilletsView {
  declare plugin: EditionLayoutPlugin;
  declare targetContainer?: HTMLElement;
  private exportPanel: ExportPanel | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: EditionLayoutPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return "feuillets-edition-layout";
  }

  getDisplayText(): string {
    return t("editionLayout.displayText");
  }

  getIcon(): string {
    return "panel-top";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-edition-layout-container");

    const section = container.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "panel-top",
      t("editionLayout.displayText"),
      "editionLayout",
      "panel"
    );
    if (collapsed) return;

    /* Le sélecteur utilise directement listExportTemplates() et écrit
       directement settings.exportTemplate — même source et même réglage
       que le champ Gabarit qu'avait ExportPanel, juste déplacés ici. */
    const templates = await listExportTemplates(this.app, this.plugin.settings);

    const templateControl = this.propertyRow(section, t("editionLayout.activeTemplate"));
    const select = templateControl.createEl("select");
    for (const tpl of templates) select.createEl("option", { value: tpl.key, text: tpl.label });
    select.value = this.plugin.settings.exportTemplate;
    select.setAttribute("aria-label", t("editionLayout.activeTemplate"));
    select.addEventListener("change", () => void this.setActiveTemplate(select.value));

    this.actionRow(section, t("editionLayout.editVisually"), () => this.openLayoutModal(templates));

    const more = templateControl.createEl("button", { cls: "clickable-icon" });
    setIcon(more, "more-horizontal");
    setTooltip(more, "Options du gabarit");
    more.setAttribute("aria-label", "Options du gabarit");
    more.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t("editionLayout.duplicate")).onClick(() => void this.duplicate()));
      menu.addItem((item) => item.setTitle(t("editionLayout.importUlysses")).onClick(() => this.openUlyssesImportModal()));
      menu.addItem((item) => item.setTitle(t("editionLayout.importWord")).onClick(() => this.openWordImportModal()));
      menu.showAtMouseEvent(event);
    });

    if (typeof this.plugin.getProjectFolder === "function") {
      const exportEl = section.createDiv();
      this.exportPanel = new ExportPanel(this.app, this.plugin, exportEl, { embedded: true });
      await this.exportPanel.render();
    }
  }

  /** Ligne d'action du panneau latéral. */
  private actionRow(parent: HTMLElement, label: string, onClick: () => void | Promise<void>): void {
    const row = parent.createDiv({ cls: "feuillets-project-row feuillets-edition-action-row" });
    row.createSpan({ cls: "feuillets-project-row-label", text: label });
    const actions = row.createDiv({ cls: "feuillets-project-row-actions" });
    const button = actions.createEl("button", { cls: "clickable-icon" });
    setIcon(button, "chevron-right");
    setTooltip(button, label);
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => void onClick());
  }

  private propertyRow(parent: HTMLElement, label: string): HTMLElement {
    const row = parent.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: label });
    return row.createDiv({ cls: "feuillets-edition-row-control" });
  }

  private async setActiveTemplate(key: string): Promise<void> {
    this.plugin.settings.exportTemplate = key;
    await this.plugin.saveSettings();
  }

  /** « Modifier visuellement » ouvre le LayoutModal EXISTANT, avec le
   * gabarit actif — aucun nouvel éditeur de mise en page. */
  private openLayoutModal(templates: Array<{ key: string; label: string }>): void {
    const activeKey = this.plugin.settings.exportTemplate;
    const activeLabel = templates.find((tpl) => tpl.key === activeKey)?.label || activeKey;
    new LayoutModal(this.app, this.plugin, activeKey, activeLabel, () => void this.render()).open();
  }

  /** « Dupliquer » : voir duplicateExportTemplate (services/export-
   * templates-custom.ts) — résout le gabarit actif, écrit la copie dans
   * Layouts, la rend immédiatement active ; ce composant ne fait que
   * persister et rafraîchir l'affichage. */
  private async duplicate(): Promise<void> {
    const result = await duplicateExportTemplate(this.app, this.plugin.settings);
    if (!result) return;
    await this.plugin.saveSettings();
    new Notice(t("editionLayout.duplicated", { label: result.label }));
    await this.render();
  }

  private openUlyssesImportModal(): void {
    new UlyssesImportModal(this.app, this.plugin, () => this.render()).open();
  }
  private openWordImportModal(): void { new WordTemplateImportModal(this.app, this.plugin, () => this.render()).open(); }
}
