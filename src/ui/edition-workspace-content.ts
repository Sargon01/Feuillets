import { Menu, Notice, setIcon, setTooltip } from "obsidian";
import type { App, TFolder, WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import { VIEW_PREVIEW } from "../constants.js";
import {
  listExportTemplates,
  duplicateExportTemplate,
  createCustomTemplateFromV2,
  customTemplateFile,
  renameCustomTemplate,
  deleteCustomTemplate,
} from "../services/export-templates-custom.js";
import { createDefaultExportTemplateV2 } from "../services/export-template-v2.js";
import { ConfirmModal, promptText } from "./basic-modals.js";
import { UlyssesImportModal } from "./ulysses-import-modal.js";
import { WordTemplateImportModal } from "./word-template-import-modal.js";
import { LayoutEditor, type LayoutEditorOptions, type LayoutSummaryPage } from "./layout-editor.js";
import { EditionCompositionContent, type EditionCompositionContentPlugin } from "./edition-composition-content.js";

export type EditionWorkspaceMode = "composition" | "layout";

export type EditionWorkspacePlugin = {
  settings: FeuilletsSettings & { exportTemplate: string };
  saveSettings(): Promise<void>;
  getProjectFolder(): TFolder | null;
  refreshPresentationAppearance?(): Promise<void>;
} & EditionCompositionContentPlugin;

export type EditionWorkspaceContentOptions = {
  /** Sous-page affichée par la sidebar Édition. */
  initialMode?: EditionWorkspaceMode;
  /** Preview classique déjà ouverte pour ce projet, si elle existe. */
  linkedPreviewLeaf?: WorkspaceLeaf | null;
  /** Informe la sidebar si le composant actif est revenu à sa page racine. */
  onNavigationRootChange?: (isRoot: boolean) => void;
  layoutSummaryPage?: LayoutSummaryPage;
  onLayoutSummaryPageChange?: (page: LayoutSummaryPage) => void;
};

interface RefreshableView {
  refreshForLayoutChange(): Promise<void>;
}

function isRefreshableView(view: unknown): view is RefreshableView {
  return (
    typeof view === "object" &&
    view !== null &&
    "refreshForLayoutChange" in view &&
    typeof (view as { refreshForLayoutChange?: unknown }).refreshForLayoutChange === "function"
  );
}

/** Contenu partagé des sous-pages Composition / Mise en page de la sidebar
 * Édition. Ce composant ne crée aucune leaf et ne possède aucun chrome central :
 * la barre Aperçu / Portée / Format / Exporter appartient à
 * SidebarFeuilletsView. Une Preview existante peut seulement être rafraîchie ;
 * elle n'est jamais créée ici. */
export class EditionWorkspaceContent {
  readonly app: App;
  readonly plugin: EditionWorkspacePlugin;
  private container: HTMLElement;
  mode: EditionWorkspaceMode;
  editor: LayoutEditor | null = null;
  private previewLeaf: WorkspaceLeaf | null;
  private onNavigationRootChange: ((isRoot: boolean) => void) | undefined;
  private layoutSummaryPage: LayoutSummaryPage;
  private onLayoutSummaryPageChange: ((page: LayoutSummaryPage) => void) | undefined;
  private modeBodyEl: HTMLElement | null = null;
  private compositionContent: EditionCompositionContent | null = null;
  /** Promesse du rendu lancé par setMode(), utile aux hôtes qui changent de
   * sous-page sans attendre immédiatement son rendu. */
  modeRenderPromise: Promise<void> = Promise.resolve();

  constructor(
    app: App,
    plugin: EditionWorkspacePlugin,
    container: HTMLElement,
    options: EditionWorkspaceContentOptions = {},
  ) {
    this.app = app;
    this.plugin = plugin;
    this.container = container;
    this.mode = options.initialMode || "composition";
    this.previewLeaf = options.linkedPreviewLeaf ?? null;
    this.onNavigationRootChange = options.onNavigationRootChange;
    this.layoutSummaryPage = options.layoutSummaryPage ?? "home";
    this.onLayoutSummaryPageChange = options.onLayoutSummaryPageChange;
  }

  setLinkedPreview(leaf: WorkspaceLeaf | null): void {
    this.previewLeaf = leaf;
  }

  /** Change de sous-page sans créer de leaf ni de Preview. */
  setMode(mode: EditionWorkspaceMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.modeRenderPromise = this.renderModeBody();
  }

  async render(): Promise<void> {
    const container = this.container;
    container.empty();
    container.addClass("feuillets-layout-workspace");
    this.modeBodyEl = container.createDiv({ cls: "feuillets-edition-mode-body" });
    await this.renderModeBody();
  }

  private async renderModeBody(): Promise<void> {
    const body = this.modeBodyEl;
    if (!body) return;
    body.empty();
    this.compositionContent = null;
    this.editor = null;

    if (this.mode === "composition") {
      const surface = body.createDiv({ cls: "feuillets-edition-mode-surface" });
      const content = new EditionCompositionContent(this.app, this.plugin, surface, {
        onChange: () => void this.refreshLinkedPreview(),
        /* même contrat que la Mise en page : la notification de racine n'est
           transmise qu'en chrome embedded (panneau droit) — le mode central
           historique ne transmet jamais cette option. */
        onNavigationRootChange: this.onNavigationRootChange,
      });
      this.compositionContent = content;
      await content.render();
      return;
    }

    await this.renderLayoutMode(body);
  }

  private async renderLayoutMode(body: HTMLElement): Promise<void> {
    const surface = body.createDiv({ cls: "feuillets-edition-mode-surface" });
    const toolbar = surface.createDiv({ cls: "feuillets-layout-toolbar" });
    toolbar.createSpan({ cls: "feuillets-layout-toolbar-title", text: t("layoutWorkspace.activeTemplate") });
    const select = toolbar.createEl("select");
    select.setAttribute("aria-label", t("layoutWorkspace.activeTemplate"));
    const templates = await listExportTemplates(this.app, this.plugin.settings);
    for (const tpl of templates) select.createEl("option", { value: tpl.key, text: tpl.label });
    select.value = this.plugin.settings.exportTemplate;
    select.addEventListener("change", () => void this.onTemplateChange(select.value, templates));

    /* Gestion des gabarits (nouveau / dupliquer / renommer / supprimer /
       importer Ulysses ou Word) : mêmes services que l'ancien lanceur latéral
       EditionLayoutView, désormais rattachés au SEUL endroit qui affiche le
       gabarit actif — un unique point d'entrée, pas deux. */
    const more = toolbar.createEl("button", { cls: "clickable-icon" });
    setIcon(more, "more-horizontal");
    setTooltip(more, t("editionLayout.templateOptions"));
    more.setAttribute("aria-label", t("editionLayout.templateOptions"));
    more.addEventListener("click", (event) => this.showTemplateMenu(event, templates));

    const layoutBody = surface.createDiv({ cls: "feuillets-layout-body" });
    const layoutOptions: LayoutEditorOptions = {
      mode: "workspace",
      workspaceNavigation: "summary",
      onChange: () => void this.refreshLinkedPreview(),
      initialSummaryPage: this.layoutSummaryPage,
      onSummaryPageChange: (page) => this.onLayoutSummaryPageChange?.(page),
      presentationProjectPath: this.plugin.getProjectFolder()?.path ?? null,
      onPresentationAppearanceChange: () => this.refreshLinkedPreview(),
    };
    if (this.onNavigationRootChange) {
      layoutOptions.onNavigationRootChange = (isRoot) => this.onNavigationRootChange?.(isRoot);
    }
    this.editor = new LayoutEditor(this.app, this.plugin, layoutBody, this.plugin.settings.exportTemplate, layoutOptions);
    await this.editor.load();
  }

  private showTemplateMenu(event: MouseEvent, templates: Array<{ key: string; label: string }>): void {
    const menu = new Menu();
    const activeKey = this.plugin.settings.exportTemplate;
    const activeTemplate = templates.find((tpl) => tpl.key === activeKey);
    const activeLabel = activeTemplate?.label || activeKey;
    const isCustom = !!customTemplateFile(this.app, this.plugin.settings, activeKey);
    menu.addItem((item) => item.setTitle(t("editionLayout.newTemplate")).onClick(() => void this.createNewTemplate()));
    menu.addItem((item) => item.setTitle(t("editionLayout.duplicate")).onClick(() => void this.duplicateTemplate()));
    if (isCustom) {
      menu.addItem((item) => item.setTitle(t("editionLayout.renameTemplate")).onClick(() => void this.renameTemplate(activeLabel)));
      menu.addItem((item) => item.setTitle(t("editionLayout.deleteTemplate")).onClick(() => this.confirmDeleteTemplate(activeLabel)));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("editionLayout.importUlysses")).onClick(() => {
      new UlyssesImportModal(this.app, this.plugin, () => this.renderModeBody()).open();
    }));
    menu.addItem((item) => item.setTitle(t("editionLayout.importWord")).onClick(() => {
      new WordTemplateImportModal(this.app, this.plugin, () => this.renderModeBody()).open();
    }));
    menu.showAtMouseEvent(event);
  }

  private async duplicateTemplate(): Promise<void> {
    const result = await duplicateExportTemplate(this.app, this.plugin.settings);
    if (!result) return;
    await this.plugin.saveSettings();
    new Notice(t("editionLayout.duplicated", { label: result.label }));
    await this.renderModeBody();
    await this.refreshLinkedPreview();
  }

  private async createNewTemplate(): Promise<void> {
    const label = (await promptText(this.app, t("editionLayout.newTemplate")))?.trim();
    if (!label) return;
    const baseKey = label.toLocaleLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gabarit";
    const result = await createCustomTemplateFromV2(
      this.app,
      this.plugin.settings,
      baseKey,
      label,
      createDefaultExportTemplateV2(),
    );
    if (!result) return;
    await this.plugin.saveSettings();
    await this.renderModeBody();
    await this.refreshLinkedPreview();
  }

  private async renameTemplate(currentLabel: string): Promise<void> {
    const label = (await promptText(this.app, t("editionLayout.renameTemplate"), currentLabel))?.trim();
    if (!label) return;
    if (!await renameCustomTemplate(this.app, this.plugin.settings, this.plugin.settings.exportTemplate, label)) return;
    await this.renderModeBody();
  }

  private confirmDeleteTemplate(label: string): void {
    new ConfirmModal(
      this.app,
      t("editionLayout.deleteTemplateTitle", { label }),
      t("editionLayout.deleteTemplateMessage", { label }),
      t("editionLayout.deleteTemplate"),
      () => this.deleteTemplate(),
    ).open();
  }

  private async deleteTemplate(): Promise<void> {
    const result = await deleteCustomTemplate(this.app, this.plugin.settings, this.plugin.settings.exportTemplate);
    if (!result.deleted) return;
    if (result.activeChanged) await this.plugin.saveSettings();
    await this.renderModeBody();
    await this.refreshLinkedPreview();
  }

  private async onTemplateChange(key: string, templates: Array<{ key: string; label: string }>): Promise<void> {
    this.plugin.settings.exportTemplate = key;
    await this.plugin.saveSettings();
    const label = templates.find((tpl) => tpl.key === key)?.label || key;
    if (this.editor) await this.editor.setTemplateKey(key, label);
    await this.refreshLinkedPreview();
  }

  async refreshLinkedPreview(): Promise<void> {
    const leaf = this.previewLeaf;
    if (!leaf) return;
    if (!this.app.workspace.getLeavesOfType(VIEW_PREVIEW).includes(leaf)) {
      // Preview fermée entre-temps : ne pas la recréer silencieusement (§10).
      this.previewLeaf = null;
      return;
    }
    const view = leaf.view;
    if (isRefreshableView(view)) await view.refreshForLayoutChange();
  }
}
