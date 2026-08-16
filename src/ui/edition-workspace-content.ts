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
import { LayoutEditor } from "./layout-editor.js";
import { EditionCompositionContent, type EditionCompositionContentPlugin } from "./edition-composition-content.js";
import { ExportPanel, type ExportPanelPlugin } from "./export-panel.js";

export type EditionWorkspaceMode = "composition" | "layout" | "export";

export type EditionWorkspacePlugin = {
  settings: FeuilletsSettings & { exportTemplate: string };
  saveSettings(): Promise<void>;
  getProjectFolder(): TFolder | null;
} & EditionCompositionContentPlugin
  & ExportPanelPlugin;

export type EditionWorkspaceContentOptions = {
  /** Mode affiché au premier rendu — état de session de l'hôte, jamais
   * persisté (§1 du chantier : aucun nouveau réglage). */
  initialMode?: EditionWorkspaceMode;
  /** Preview classique déjà ouverte/réutilisée par l'hôte (§9). */
  linkedPreviewLeaf?: WorkspaceLeaf | null;
  /** Notifié à chaque changement de mode interne — permet à l'hôte (BoardView)
   * de retenir le mode courant sans le persister ni redessiner sa surface. */
  onModeChange?: (mode: EditionWorkspaceMode) => void;
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

/** Cœur de l'espace « Édition » (Composition / Mise en page / Export), monté
 * DANS la leaf de son hôte — plus aucune ItemView autonome (§7 du chantier) :
 * BoardView l'installe dans sa propre surface centrale quand
 * `centralSurface === "edition"`.
 *
 * Les trois modes réutilisent des composants déjà partagés ailleurs :
 * EditionCompositionContent (composant DOM pur, micro-correctif « ne plus
 * embarquer d'ItemView dans BoardView »), LayoutEditor (cœur extrait du
 * LayoutModal), ExportPanel (rendu `embedded` complet) — aucun nouveau
 * moteur ni duplication de logique. La Preview n'est jamais possédée ici :
 * elle est ouverte/réutilisée par l'hôte et seulement rafraîchie
 * (`refreshLinkedPreview`), jamais recréée silencieusement (§10). */
export class EditionWorkspaceContent {
  readonly app: App;
  readonly plugin: EditionWorkspacePlugin;
  /** Leaf de l'hôte (BoardView) — conservée pour référence, mais plus
   * transmise à AUCUN sous-composant : Composition et Documents sont des
   * composants DOM purs sans WorkspaceLeaf propre. */
  readonly hostLeaf: WorkspaceLeaf;
  private container: HTMLElement;
  mode: EditionWorkspaceMode;
  editor: LayoutEditor | null = null;
  private previewLeaf: WorkspaceLeaf | null;
  private onModeChange: ((mode: EditionWorkspaceMode) => void) | undefined;
  private modeBodyEl: HTMLElement | null = null;
  private modeNavButtons: Partial<Record<EditionWorkspaceMode, HTMLElement>> = {};
  private compositionContent: EditionCompositionContent | null = null;
  /** Rendu du mode courant en cours — exposé pour que les tests puissent
   * l'attendre après un `setMode()` fire-and-forget (comme un clic réel).
   * Aucun rôle fonctionnel : jamais lu par le reste du plugin. */
  modeRenderPromise: Promise<void> = Promise.resolve();

  constructor(
    app: App,
    plugin: EditionWorkspacePlugin,
    hostLeaf: WorkspaceLeaf,
    container: HTMLElement,
    options: EditionWorkspaceContentOptions = {},
  ) {
    this.app = app;
    this.plugin = plugin;
    this.hostLeaf = hostLeaf;
    this.container = container;
    this.mode = options.initialMode || "composition";
    this.previewLeaf = options.linkedPreviewLeaf ?? null;
    this.onModeChange = options.onModeChange;
  }

  /** Réattache le composant à un nouveau conteneur — l'hôte reconstruit son
   * DOM à chaque rendu, l'instance et son mode courant survivent. */
  attach(container: HTMLElement): void {
    this.container = container;
  }

  /** Appelé par l'hôte juste après avoir ouvert/réutilisé la Preview classique
   * associée (openScopeWithPreviewBesideLeaf). */
  setLinkedPreview(leaf: WorkspaceLeaf | null): void {
    this.previewLeaf = leaf;
  }

  /** Change de mode sans jamais recréer la Preview ni la moindre leaf — ne
   * reconstruit que `modeBody`. No-op si déjà sur ce mode. */
  setMode(mode: EditionWorkspaceMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.onModeChange?.(mode);
    this.modeRenderPromise = this.renderModeBody();
  }

  async render(): Promise<void> {
    const container = this.container;
    container.empty();
    container.addClass("feuillets-layout-workspace");

    const nav = container.createDiv({ cls: "feuillets-edition-mode-nav", attr: { role: "tablist" } });
    const modes: Array<[EditionWorkspaceMode, string]> = [
      ["composition", t("editionWorkspace.modeComposition")],
      ["layout", t("editionWorkspace.modeLayout")],
      ["export", t("editionWorkspace.modeExport")],
    ];
    this.modeNavButtons = {};
    for (const [key, label] of modes) {
      const button = nav.createEl("button", {
        cls: "feuillets-edition-mode-item",
        text: label,
        attr: { role: "tab", "aria-selected": String(this.mode === key) },
      });
      button.addEventListener("click", () => this.setMode(key));
      this.modeNavButtons[key] = button;
    }

    const refresh = nav.createEl("button", { cls: "clickable-icon feuillets-edition-preview-refresh" });
    setIcon(refresh, "refresh-cw");
    setTooltip(refresh, t("preview.export.refreshPreview"));
    refresh.setAttribute("aria-label", t("preview.export.refreshPreview"));
    refresh.addEventListener("click", () => void this.refreshLinkedPreview());

    this.modeBodyEl = container.createDiv({ cls: "feuillets-edition-mode-body" });
    await this.renderModeBody();
  }

  private async renderModeBody(): Promise<void> {
    const body = this.modeBodyEl;
    if (!body) return;
    for (const [key, button] of Object.entries(this.modeNavButtons) as Array<[EditionWorkspaceMode, HTMLElement]>) {
      button.toggleClass("is-active", key === this.mode);
      button.setAttribute("aria-selected", String(key === this.mode));
    }
    body.empty();
    this.compositionContent = null;
    this.editor = null;

    if (this.mode === "composition") {
      const surface = body.createDiv({ cls: "feuillets-edition-mode-surface" });
      const content = new EditionCompositionContent(this.app, this.plugin, surface, {
        onChange: () => void this.refreshLinkedPreview(),
      });
      this.compositionContent = content;
      await content.render();
      return;
    }

    if (this.mode === "export") {
      const surface = body.createDiv({ cls: "feuillets-edition-mode-surface" });
      const panel = new ExportPanel(this.app, this.plugin, surface, { embedded: true });
      await panel.render();
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
    this.editor = new LayoutEditor(this.app, this.plugin, layoutBody, this.plugin.settings.exportTemplate, {
      mode: "workspace",
      onChange: () => void this.refreshLinkedPreview(),
    });
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
