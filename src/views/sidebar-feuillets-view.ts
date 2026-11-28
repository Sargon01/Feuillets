import { isRewriteHistoryPath } from "../services/rewrite-history-store.js";
import { CarnetsContent, type CarnetsPlugin } from "../ui/carnets-content.js";
import { ItemView, MarkdownView, Setting, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_PREVIEW, VIEW_SIDEBAR_FEUILLETS } from "../constants.js";
import { getLocale, t } from "../i18n/index.js";
import { openSnapshotComparison } from "./comparison-view.js";
import { AnalysisView } from "./analysis-view.js";
import { DocxReviewView } from "./docx-review-view.js";
import { JournalView } from "./journal-view.js";
import { NativeReviewView } from "./native-review-view.js";
import { NotesView } from "./notes-view.js";
import type { BaseFeuilletsView } from "./base-feuillets-view.js";
import { ResearchView } from "./research-view.js";
import { TextAnalysisView } from "./text-analysis-view.js";
import { EditionWorkspaceContent, type EditionWorkspacePlugin } from "../ui/edition-workspace-content.js";
import { LayoutEditor, type LayoutSummaryPage } from "../ui/layout-editor.js";
import { asEditorialTemplate, editorialComposition, editorialTemplate, EDITORIAL_TEMPLATE_KEY, resolveEditorialDocument, updateEditorialProperties } from "../services/editorial-document.js";
import { listExportTemplates, resolveExportTemplateV2 } from "../services/export-templates-custom.js";
import { manuscriptPathIsProtected } from "../services/folder-structure.js";
import { ExportPanel, type ExportPanelPlugin } from "../ui/export-panel.js";
import { createProjectScope, type CompileScope } from "../services/compile-scope.js";
import { openScopeWithPreviewBesideLeaf, PreviewView } from "./preview-view.js";

type SidebarTab = "notes" | "research" | "journal" | "project" | "stats" | "relecture" | "carnets";
/** Sous-page de l'onglet Édition (clé interne "project") — état purement en
 * mémoire (jamais persisté dans les réglages) : "home" affiche les deux
 * entrées de navigation (Composition et Mise en page) ; les
 * autres valeurs affichent la sous-page correspondante en remplacement total,
 * avec la barre Retour partagée (renderBackBar). */
export type EditionPage = "home" | "composition" | "layout";
/** Sous-page de l'onglet Relecture — état purement en mémoire (jamais
 * persisté dans les réglages, voir renderProofreadingTab). "home" affiche
 * les deux entrées compactes ; "analysis"/"docx" affichent l'une des deux
 * sous-vues complètes (TextAnalysisView/DocxReviewView), en remplacement
 * total de la page d'accueil, dans le même panneau. */
type RelecturePage = "home" | "native" | "analysis" | "docx";
type SidebarPlugin =
  ConstructorParameters<typeof BaseFeuilletsView>[1]
  & EditionWorkspacePlugin
  & ExportPanelPlugin
  & CarnetsPlugin;
type SidebarSubView = {
  targetContainer?: HTMLElement;
  render(force?: boolean): Promise<void>;
};
type AnalysisSidebarSubView = SidebarSubView & {
  _chaptersCache: unknown;
  _dashboardCache: unknown;
};
type SidebarSubViews = {
  notes: SidebarSubView & { refreshSheetContext?(): Promise<void>; refreshRewriteHistory?(): Promise<void> };
  research: SidebarSubView & { refreshReferencesOnActiveDocumentChange?(): Promise<void> };
  journal: SidebarSubView & { refreshData?(): Promise<void>; refreshJournalData?(): Promise<void>; refreshJournalFile?(path: string): Promise<void>; refreshRewriteHistory?(): Promise<void> };
  docx: SidebarSubView;
  analyse: AnalysisSidebarSubView;
  relecture: SidebarSubView;
  nativeReview: SidebarSubView;
};
type SidebarTabDefinition = { id: SidebarTab; icon: string; titleKey: string };

const SIDEBAR_TABS: SidebarTabDefinition[] = [
  { id: "notes", icon: "file-text", titleKey: "sidebar.tab.notes" },
  { id: "research", icon: "book-marked", titleKey: "sidebar.tab.research" },
  { id: "journal", icon: "calendar", titleKey: "sidebar.tab.journal" },
  { id: "project", icon: "book-open", titleKey: "sidebar.tab.edition" },
  { id: "stats", icon: "bar-chart-3", titleKey: "sidebar.tab.stats" },
  { id: "relecture", icon: "spell-check", titleKey: "sidebar.tab.proofreading" },
  { id: "carnets", icon: "notebook-pen", titleKey: "sidebar.tab.carnets" },
];

type PreviewViewWithScope = {
  compileScope?: {
    projectRoot?: string;
  };
};

function getPreviewProjectRoot(view: unknown): string | null {
  if (
    typeof view === "object" &&
    view !== null &&
    "compileScope" in view
  ) {
    const scope = (view as PreviewViewWithScope).compileScope;
    if (scope && typeof scope === "object" && typeof scope.projectRoot === "string") {
      return scope.projectRoot;
    }
  }
  return null;
}

function activeTabFor(value: unknown): SidebarTab {
  // DocxReviewView n'habite plus l'espace Édition ("project") : les deux
  // anciennes valeurs pointent maintenant vers Relecture, seule sa page
  // secondaire diffère (voir le constructeur, qui lit CETTE MÊME valeur
  // pour choisir relecturePage).
  if (value === "docx") return "relecture";
  if (value === "analyse") return "stats";
  if (value === "metadata") return "notes";
  if (
    value === "notes" || value === "research" || value === "journal" ||
    value === "project" || value === "stats" || value === "relecture" || value === "carnets"
  ) {
    return value;
  }
  return "project";
}

export class SidebarFeuilletsView extends ItemView {
  plugin: SidebarPlugin;
  activeTab: SidebarTab;
  relecturePage: RelecturePage;
  editionPage: EditionPage;
  private layoutSummaryPage: LayoutSummaryPage = "home";
  private editionContext = "";
  private editionFilePath: string | null = null;
  private carnetsContent: CarnetsContent | null = null;
  private tabLayoutKey = "";
  subViews: SidebarSubViews;
  /** Conteneur dédié de la barre « Retour à Édition » (rendue QUE lorsque
   * le contenu enfant est sur sa page racine) — jamais la barre elle-même
   * directement dans le wrapper, pour pouvoir la retirer/la remonter sans
   * reconstruire le panneau ni perdre l'état de l'enfant. */
  editionBackHost: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SidebarPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.editionPage = "home";
    const legacyTab = plugin.settings.activeRightPanelTab || "notes";
    this.activeTab = activeTabFor(legacyTab);
    /* Compat : les anciennes valeurs "docx"/"analyse" d'activeRightPanelTab
       ouvraient directement la sous-vue correspondante — on ouvre donc
       Relecture directement sur la bonne page secondaire au lieu de sa
       page d'accueil. Lecture ponctuelle au démarrage seulement :
       relecturePage n'est ensuite JAMAIS réécrit dans les réglages (aucun
       nouveau réglage persistant, conformément à la mission). */
    this.relecturePage = legacyTab === "docx" ? "docx" : "home";
    this.subViews = {
      notes: new NotesView(this.leaf, this.plugin),
      research: new ResearchView(this.leaf, this.plugin),
      journal: new JournalView(this.leaf, this.plugin),
      docx: new DocxReviewView(this.leaf, this.plugin),
      analyse: new AnalysisView(this.leaf, this.plugin),
      relecture: new TextAnalysisView(this.leaf, this.plugin),
      nativeReview: new NativeReviewView(this.leaf, this.plugin),
    };
  }

  getViewType(): string {
    return VIEW_SIDEBAR_FEUILLETS;
  }

  getDisplayText(): string {
    return t("sidebar.displayText");
  }

  getIcon(): string {
    return "sliders-horizontal";
  }

  async refreshReferencesOnActiveDocumentChange(): Promise<void> {
    if (this.activeTab === "research") await this.subViews.research.refreshReferencesOnActiveDocumentChange?.();
  }

  async refreshSheetContext(): Promise<void> {
    if (this.activeTab === "notes" && this.subViews.notes.targetContainer?.isConnected) await this.subViews.notes.refreshSheetContext?.();
  }

  async refreshJournalData(): Promise<void> {
    if (this.activeTab === "journal") await this.subViews.journal.refreshJournalData?.();
  }

  async refreshRewriteHistory(): Promise<void> {
    if (this.activeTab === "journal") await this.subViews.journal.refreshRewriteHistory?.();
    if (this.activeTab === "notes") await this.subViews.notes.refreshRewriteHistory?.();
  }

  async onOpen(): Promise<void> {
    await this.render();
    /* Embedded subviews do not receive onOpen. The host forwards document
       navigation to References without refreshing the Research folder browser. */
    const refreshReferences = () => {
      void this.refreshReferencesOnActiveDocumentChange();
      if (this.activeTab === "project") void this.refreshData();
    };
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { refreshReferences(); void this.refreshSheetContext(); }));
    this.registerEvent(this.app.workspace.on("layout-change", refreshReferences));
    const feuilletTabs = new Set<SidebarTab>(["notes", "relecture", "stats"]);
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        refreshReferences();
        if (!feuilletTabs.has(this.activeTab)) return;
        if (isRewriteHistoryPath(file?.path ?? "")) return;
        if (this.activeTab === "notes") { void this.refreshSheetContext(); return; }
        if (this.activeTab === "stats") { awaitRender(this.subViews.analyse, true); return; }
        // Relecture : ne rafraîchit TextAnalysisView que si sa page est
        // effectivement affichée — pas sur la page d'accueil, pas sur
        // Révision DOCX (qui ne dépend pas du feuillet actif).
        if (this.relecturePage === "analysis") awaitRender(this.subViews.relecture, true);
      })
    );
    const refreshJournalFile = (path: string) => {
      if (this.activeTab === "journal") void this.subViews.journal.refreshJournalFile?.(path);
    };
    this.registerEvent(this.app.vault.on("modify", (file) => refreshJournalFile(file.path)));
    this.registerEvent(this.app.vault.on("create", (file) => refreshJournalFile(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => refreshJournalFile(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      refreshJournalFile(file.path);
      refreshJournalFile(oldPath);
    }));
    /* L'agrégation « équilibre des chapitres » (onglet Analyse) lit tout le
       manuscrit : on invalide son cache quand le coffre change, pour la
       recalculer au prochain rendu plutôt qu'à chaque navigation. */
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (isRewriteHistoryPath(file.path)) return;
        this.subViews.analyse._chaptersCache = null;
        this.subViews.analyse._dashboardCache = null;
      })
    );
  }

  async render(): Promise<void> {
    if (this.carnetsContent) { this.removeChild(this.carnetsContent); this.carnetsContent = null; }
    const container = this.contentEl;
    this.editionBackHost = null;
    container.empty();
    container.addClass("feuillets-sidebar-container");

    // ----- BARRE D'ONGLETS -----
    const tabBar = container.createDiv({ cls: "feuillets-sidebar-tab-bar", attr: { role: "tablist" } });
    const hiddenPanels = new Set(this.plugin.settings.hiddenPanels || []);
    this.tabLayoutKey = this.getTabLayoutKey();
    const tabs = SIDEBAR_TABS.filter((tab) => !hiddenPanels.has(tab.id));
    if (tabs.length && !tabs.some((tab) => tab.id === this.activeTab)) {
      this.activeTab = tabs[0].id;
    }

    for (const tab of tabs) {
      const label = t(tab.titleKey);
      const button = typeof tabBar.createEl === "function"
        ? tabBar.createEl("button", { cls: `feuillets-tab-btn ${this.activeTab === tab.id ? "is-active" : ""}`, attr: { role: "tab", "aria-label": label, "aria-selected": String(this.activeTab === tab.id), title: label } })
        : tabBar.createDiv({ cls: `feuillets-tab-btn ${this.activeTab === tab.id ? "is-active" : ""}` });
      setIcon(button, tab.icon);
      button.setAttr?.("role", "tab");
      button.setAttr?.("aria-label", label);
      button.setAttr?.("aria-selected", String(this.activeTab === tab.id));
      button.setAttr?.("tabindex", this.activeTab === tab.id ? "0" : "-1");
      button.setAttr?.("id", `feuillets-tab-${tab.id}`);
      button.setAttr?.("aria-controls", "feuillets-sidebar-panel");

      const handleTabClick = async (): Promise<void> => {
        this.activeTab = tab.id;
        this.plugin.settings.activeRightPanelTab = tab.id;
        await this.plugin.saveSettings();
        await this.render();
        this.contentEl.querySelector<HTMLElement>(`#feuillets-tab-${this.activeTab}`)?.focus();
      };
      button.addEventListener("click", () => {
        void handleTabClick();
      });
      button.addEventListener("keydown", (event) => {
        const index = tabs.indexOf(tab);
        const key = (event as KeyboardEvent).key;
        const next = key === "Home" ? 0 : key === "End" ? tabs.length - 1 :
          key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length :
          key === "ArrowRight" ? (index + 1) % tabs.length : -1;
        if (next < 0) return;
        event.preventDefault();
        void (async () => {
          this.activeTab = tabs[next].id;
          this.plugin.settings.activeRightPanelTab = this.activeTab;
          await this.plugin.saveSettings();
          await this.render();
          this.contentEl.querySelector<HTMLElement>(`#feuillets-tab-${this.activeTab}`)?.focus();
        })();
      });
    }

    // ----- CONTENU DYNAMIQUE DE L'ONGLET SÉLECTIONNÉ -----
    const content = container.createDiv({ cls: "feuillets-sidebar-content", attr: { id: "feuillets-sidebar-panel", role: "tabpanel", "aria-labelledby": `feuillets-tab-${this.activeTab}` } });

    switch (this.activeTab) {
      case "carnets":
        this.carnetsContent = new CarnetsContent(this.app, this.plugin, content);
        this.addChild(this.carnetsContent);
        break;
      case "notes":
        await this.renderNotesTab(content);
        break;
      case "research":
        await this.renderResearchTab(content);
        break;
      case "journal":
        await this.renderJournalTab(content);
        break;
      case "project":
        await this.renderProjectTab(content);
        break;
      case "stats":
        await this.renderStatsTab(content);
        break;
      case "relecture":
        await this.renderProofreadingTab(content);
        break;
    }
  }


  /** Ouvre directement une page de l'onglet Édition dans le panneau droit.
   * Utilisé par les commandes historiques (Export / Mise en page) après
   * suppression des anciennes surfaces Édition/Documents du Board. */
  async openEditionPage(page: EditionPage): Promise<void> {
    this.activeTab = "project";
    this.editionPage = page;
    await this.render();
  }

  async renderNotesTab(element: HTMLElement): Promise<void> {
    await this.renderSubView(this.subViews.notes, element);
  }

  async renderResearchTab(element: HTMLElement): Promise<void> {
    await this.renderSubView(this.subViews.research, element);
  }

  async renderJournalTab(element: HTMLElement): Promise<void> {
    await this.renderSubView(this.subViews.journal, element);
  }

  async renderStatsTab(element: HTMLElement): Promise<void> {
    await this.renderSubView(this.subViews.analyse, element);
  }

  private existingProjectPreviewLeaf(): WorkspaceLeaf | null {
    const projectFolder = this.plugin.getProjectFolder();
    if (!projectFolder) return null;
    const leaves = this.app.workspace.getLeavesOfType(VIEW_PREVIEW);
    for (const leaf of leaves) {
      if (getPreviewProjectRoot(leaf.view) === projectFolder.path) {
        return leaf;
      }
    }
    return null;
  }

  /** Ouvre/réutilise la Preview classique — CORRECTIF PROMPT 2/3, §2 :
   * UNIQUEMENT sur clic explicite (bouton Aperçu de la barre globale),
   * jamais en ouvrant l'onglet Édition ou l'une de ses sous-pages. La leaf
   * d'ancrage vient TOUJOURS de `workspace.getMostRecentLeaf(rootSplit)` —
   * jamais `this.leaf` (la leaf de la Sidebar elle-même) — pour que la
   * Preview s'ouvre à côté de la vraie leaf centrale de travail (Markdown/
   * Continu/Board déjà ouvert), jamais en remplacement de celle-ci. Réutilise
   * tel quel le helper existant `openScopeWithPreviewBesideLeaf` : une
   * Preview déjà ouverte est reprise, jamais recréée. */
  private async openPreview(scope?: CompileScope): Promise<void> {
    const root = this.plugin.getProjectFolder();
    if (!root) return;
    const workspace = this.app.workspace;
    if (typeof workspace.getMostRecentLeaf !== "function") return;
    const anchorLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    if (!anchorLeaf) return;
    await openScopeWithPreviewBesideLeaf(this.app, scope ?? createProjectScope(root.path), anchorLeaf);
  }

  /** Barre globale « Aperçu / Portée / Format / Exporter » — CORRECTIF
   * commune aux pages de l'onglet Édition (accueil, Composition et
   * Mise en page), rendue UNE
   * seule fois par `renderProjectTab()`. Réutilise exclusivement
   * `ExportPanel.renderQuickBar()` pour portée/format/Exporter — aucun
   * select ni workflow d'export réimplémenté ici, la Sidebar ne possède que
   * le conteneur visuel. */
  private renderEditionActionsBar(element: HTMLElement, scope?: CompileScope): void {
    const bar = element.createDiv({ cls: "feuillets-sidebar-edition-actions" });

    const previewBtn = bar.createEl("button", { cls: "clickable-icon" });
    setIcon(previewBtn, "eye");
    previewBtn.setAttr("aria-label", t("sidebar.edition.openPreview"));
    previewBtn.setAttr("title", t("sidebar.edition.openPreview"));
    previewBtn.addEventListener("click", () => void this.openPreview(scope));

    const exportHost = bar.createDiv({ cls: "feuillets-sidebar-edition-export-host" });
    new ExportPanel(this.app, this.plugin, exportHost, {
      onScopeChanged: () => this.refreshData(),
      ...(scope ? { getScope: () => scope, fixedScope: true } : {}),
    }).renderQuickBar(exportHost);
  }

  async renderProjectTab(element: HTMLElement): Promise<void> {
    const activeFile = this.editionActiveFile();
    const activeScope = this.plugin.getActiveEditorialScope?.();
    const document = activeScope?.type === "file"
      ? resolveEditorialDocument(this.app, this.plugin.settings, activeScope.path) : null;
    this.editionContext = this.getEditionContext();
    const project = this.plugin.getProjectFolder();
    if (this.editionFilePath !== (document?.path ?? null)) {
      if (this.editionFilePath && this.layoutSummaryPage !== "home") this.layoutSummaryPage = "home";
      this.editionFilePath = document?.path ?? null;
    }
    if (!document && activeFile && project && manuscriptPathIsProtected(project, activeFile.path)) {
      element.createDiv({ cls: "feuillets-empty", text: t("editionDocs.submissionDocument") });
      return;
    }
    this.renderEditionActionsBar(element, document && activeScope ? activeScope : undefined);
    const wrapper = element.createDiv({ cls: "feuillets-notes-container" });
    if (document) {
      wrapper.createDiv({ cls: "feuillets-notes-section-title feuillets-editorial-context-title", text: document.basename });
      if (this.editionPage !== "home") {
        this.editionBackHost = wrapper.createDiv({ cls: "feuillets-edition-back-host" });
        this.renderEditionBackBar();
        await this.renderDocumentEdition(wrapper.createDiv({ cls: "feuillets-sidebar-project" }), document);
        return;
      }
    }
    if (this.editionPage !== "home") {
      this.editionBackHost = wrapper.createDiv({ cls: "feuillets-edition-back-host" });
      const backHost = this.editionBackHost;
      const host = wrapper.createDiv({ cls: "feuillets-sidebar-project" });
      if (this.editionPage === "composition") {
        this.renderEditionBackBar();
        const content = new EditionWorkspaceContent(
          this.app,
          this.plugin,
          host,
          {
            initialMode: "composition",
            linkedPreviewLeaf: this.existingProjectPreviewLeaf(),
            onNavigationRootChange: (isRoot) => {
              if (this.editionBackHost === backHost) this.setEditionChildAtRoot(isRoot);
            },
            layoutSummaryPage: this.layoutSummaryPage,
            onLayoutSummaryPageChange: (page) => {
              if (this.editionBackHost === backHost) this.layoutSummaryPage = page;
            },
          }
        );
        await content.render();
      } else if (this.editionPage === "layout") {
        this.renderEditionBackBar();
        const content = new EditionWorkspaceContent(
          this.app,
          this.plugin,
          host,
          {
            initialMode: "layout",
            linkedPreviewLeaf: this.existingProjectPreviewLeaf(),
            onNavigationRootChange: (isRoot) => {
              if (this.editionBackHost === backHost) this.setEditionChildAtRoot(isRoot);
            },
            layoutSummaryPage: this.layoutSummaryPage,
            onLayoutSummaryPageChange: (page) => {
              if (this.editionBackHost === backHost) this.layoutSummaryPage = page;
            },
          }
        );
        await content.render();
      }
      return;
    }

    const container = wrapper.createDiv({ cls: "feuillets-sidebar-project" });
    this.renderEditionNavRow(container, "book-open", t("sidebar.edition.composition"), () => {
      this.editionPage = "composition";
      void this.render();
    });
    this.renderEditionNavRow(container, "layout-template", t("sidebar.edition.layout"), () => {
      this.editionPage = "layout";
      void this.render();
    });
  }

  private editionActiveFile(): TFile | null {
    const workspace = this.app.workspace;
    const view = workspace.getMostRecentLeaf?.(workspace.rootSplit)?.view;
    if (view instanceof MarkdownView) return view.file;
    if (view instanceof PreviewView && view.compileScope?.type === "file") {
      const file = this.app.vault.getAbstractFileByPath(view.compileScope.path);
      return file instanceof TFile ? file : null;
    }
    return null;
  }

  private async renderDocumentEdition(host: HTMLElement, file: TFile): Promise<void> {
    const settings = this.plugin.settings;
    const save = async (patch: EditorialDocumentSettings) => {
      updateEditorialProperties(settings, file.path, patch);
      await this.plugin.saveSettings();
    };
    const refreshPreview = async () => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_PREVIEW)) {
        const view = leaf.view;
        if (view instanceof PreviewView && view.compileScope?.type === "file" && view.compileScope.path === file.path) {
          await view.refreshForLayoutChange();
        }
      }
    };
    if (this.editionPage === "composition") {
      const composition = editorialComposition(settings, file);
      new Setting(host).setName(t("editionDocs.automaticTitle")).addToggle(control =>
        control.setValue(composition.automaticTitle).onChange(async automaticTitle => {
          await save({ automaticTitle });
          await refreshPreview();
        }));
      new Setting(host).setName(t("settings.exportFrenchTypography.name")).addToggle(control =>
        control.setValue(composition.frenchTypography).onChange(async frenchTypography => {
          await save({ frenchTypography });
          await refreshPreview();
        }));
      return;
    }
    const templates = await listExportTemplates(this.app, settings);
    const toolbarHost = host.createDiv();
    const toolbar = toolbarHost.createDiv({ cls: "feuillets-layout-toolbar" });
    const label = t("layoutWorkspace.activeTemplate");
    toolbar.createSpan({ cls: "feuillets-layout-toolbar-title", text: label });
    const select = toolbar.createEl("select", { attr: { "aria-label": label } });
    const backHost = this.editionBackHost;
    const layoutHost = host.createDiv();
    const editor = new LayoutEditor(this.app, this.plugin, layoutHost, EDITORIAL_TEMPLATE_KEY, {
      mode: "workspace",
      workspaceNavigation: "summary",
      templateLabel: t("editionDocs.documentTemplate"),
      onNavigationRootChange: isRoot => {
        toolbarHost.hidden = !isRoot;
        if (this.editionBackHost === backHost) this.setEditionChildAtRoot(isRoot);
      },
      documentTemplate: {
        load: () => editorialTemplate(settings, file),
        save: template => save({ template: asEditorialTemplate(template) }),
      },
      onChange: refreshPreview,
    });
    select.createEl("option", { value: "", text: t("editionDocs.useTemplate") });
    select.createEl("option", { value: EDITORIAL_TEMPLATE_KEY, text: t("editionDocs.documentTemplate") });
    for (const option of templates) {
      if (option.key !== EDITORIAL_TEMPLATE_KEY) select.createEl("option", { value: option.key, text: option.label });
    }
    select.addEventListener("change", () => {
      const key = select.value;
      if (!key) return;
      void (async () => {
        const template = asEditorialTemplate(await resolveExportTemplateV2(this.app, settings, key));
        await save({ template });
        select.value = "";
        await editor.load();
        await refreshPreview();
      })();
    });
    await editor.load();
  }

  private renderEditionNavRow(container: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const row = section.createDiv({ cls: "feuillets-notes-section-head feuillets-clickable" });
    const iconSpan = row.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, icon);
    row.createSpan({ cls: "feuillets-notes-section-title", text: label });
    const chevron = row.createSpan({ cls: "feuillets-notes-section-icon" });
    chevron.setAttr("style", "margin-left: auto;");
    setIcon(chevron, "chevron-right");
    row.addEventListener("click", onClick);
  }

  /** Monte la barre « Retour à Édition » dans son conteneur dédié (s'il est
   * vide). Retour vers l'accueil Édition, jamais vers autre chose. */
  private renderEditionBackBar(): void {
    const host = this.editionBackHost;
    if (!host || host.children.length > 0) return;
    this.renderBackBar(host, t("sidebar.edition.backToHome"), () => {
      this.editionPage = "home";
      void this.render();
    });
  }

  /** childIsAtRoot === true → « Retour à Édition » affiché ; false → retiré
   * du DOM (jamais masqué en CSS) : seul le Retour local de l'enfant reste.
   * Ne persiste rien, ne déclenche aucune leaf, ne touche à aucune donnée. */
  private setEditionChildAtRoot(isRoot: boolean): void {
    const host = this.editionBackHost;
    if (!host) return;
    if (isRoot) this.renderEditionBackBar();
    else host.empty();
  }

  /* Onglet Relecture : page d'accueil (deux entrées compactes, aucune des
     deux sous-vues complètes affichée) ou l'une de ses deux pages
     secondaires — TextAnalysisView/DocxReviewView remplacent alors
     ENTIÈREMENT la page d'accueil dans ce même conteneur `element`, comme
     la page « Notes de travail » du Feuillet (voir NotesView). La page
     active (`relecturePage`) est un champ d'instance, jamais persisté :
     elle survit à un changement temporaire d'onglet (on ne la réinitialise
     nulle part ailleurs qu'au clic sur Retour) mais repart de "home" à
     chaque rechargement du plugin, sauf compat legacy (voir constructeur). */
  async renderProofreadingTab(element: HTMLElement): Promise<void> {
    // Même grammaire structurelle que le panneau Feuillet (NotesView) : un
    // unique conteneur intérieur `.feuillets-notes-container` porte HOME,
    // barre Retour et sous-vues — jamais une double couche.
    const wrapper = element.createDiv({ cls: "feuillets-notes-container" });
    if (this.relecturePage === "home") {
      this.renderRelectureHome(wrapper);
      return;
    }
    // La barre Retour vit dans le wrapper, JAMAIS dans le conteneur passé en
    // targetContainer à la sous-vue : TextAnalysisView/DocxReviewView vident
    // intégralement LEUR conteneur au début de leur propre render()
    // (container.empty()) — si la barre y habitait, ce vidage l'effacerait à
    // chaque rendu. Un second conteneur dédié, enfant du wrapper mais frère
    // de la barre, encaisse ce vidage sans jamais l'emporter avec lui.
    this.renderRelectureBackBar(wrapper);
    const content = wrapper.createDiv();
    const subView = this.relecturePage === "docx" ? this.subViews.docx : this.relecturePage === "native" ? this.subViews.nativeReview : this.subViews.relecture;
    await this.renderSubView(subView, content);
  }

  /** Même gabarit de barre de retour que NotesView (notes-view.ts,
   * Notes de travail) : `.feuillets-notes-back-bar`/`.feuillets-back-btn`/
   * `.feuillets-back-icon`, réutilisés tels quels plutôt que redéfinis. */
  private renderRelectureBackBar(element: HTMLElement): void {
    this.renderBackBar(element, t("relecture.backToHome"), () => {
      this.relecturePage = "home";
      void this.render();
    });
  }

  /** Barre de retour compacte partagée par Relecture (renderRelectureBackBar)
   * et Édition (renderEditionBackBar) — un seul gabarit visuel pour « page
   * secondaire → page d'accueil du même onglet », jamais une seconde
   * grammaire par onglet. */
  private renderBackBar(element: HTMLElement, label: string, onClick: () => void): void {
    const backBar = element.createDiv({ cls: "feuillets-notes-back-bar" });
    const backBtn = backBar.createEl("button", {
      cls: "feuillets-back-btn",
      text: ` ${label}`
    });
    const iconSpan = backBtn.createSpan({ cls: "feuillets-back-icon" });
    setIcon(iconSpan, "arrow-left");
    backBtn.prepend(iconSpan);
    backBtn.addEventListener("click", () => {
      onClick();
    });
  }

  private renderRelectureHome(element: HTMLElement): void {
    this.renderHomeRow(
      element, "messages-square",
      t("relecture.home.native.title"), t("relecture.home.native.sub"),
      () => { this.relecturePage = "native"; void this.render(); }
    );
    // Le Correcteur n'apparaît que si un fournisseur d'analyse est vraiment
    // disponible : getAnalysisProvider() est l'unique source de vérité, jamais
    // une détection par ID de greffon.
    if (this.plugin.getAnalysisProvider()) {
      this.renderHomeRow(
        element, "spell-check",
        t("relecture.home.analysis.title"), t("relecture.home.analysis.sub"),
        () => { this.relecturePage = "analysis"; void this.render(); }
      );
    }
    this.renderHomeRow(
      element, "file-check",
      t("relecture.home.docx.title"), t("relecture.home.docx.sub"),
      () => { this.relecturePage = "docx"; void this.render(); }
    );
    this.renderRelectureDiffRow(element);
  }

  /** Entrée « Comparer une version » — ouvre directement DiffModal
   * (inchangée, voir ui/diff-modal.ts) sur le feuillet actif, sans créer
   * de troisième page secondaire Relecture. Reprend exactement la
   * condition de l'ancien accès depuis Feuillet (NotesView) : un fichier
   * Markdown du projet actif — ni élargie ni réduite. N'affiche même pas
   * la ligne si cette condition n'est pas remplie (comme l'ancien bouton,
   * qui n'existait que dans le contexte d'un feuillet déjà validé). */
  private renderRelectureDiffRow(element: HTMLElement): void {
    const activeFile = this.app.workspace.getActiveFile();
    const root = this.plugin.getProjectFolder();
    if (!activeFile || activeFile.extension !== "md" || !root || !activeFile.path.startsWith(root.path + "/")) {
      return;
    }
    this.renderHomeRow(
      element, "history",
      t("relecture.home.diff.title"), t("relecture.home.diff.sub"),
      () => { void openSnapshotComparison(this.app, this.plugin, activeFile); }
    );
  }

  /** Ligne compacte réutilisant le même gabarit que la ligne « Notes de
   * travail » du Feuillet (`.feuillets-notes-section`/`-section-head`/
   * `-section-icon`/`-section-title`, voir NotesView.renderWorkingNotesRow)
   * plutôt qu'une carte lourde (`.feuillets-hub-card`) — icône + libellé +
   * chevron, avec une seconde ligne de sous-titre (`.feuillets-notes-sub`,
   * déjà utilisée ailleurs dans le panneau). `onClick` porte l'action
   * ENTIÈRE (changement de page + render(), ou simple ouverture de modale
   * pour Comparer une version) : cette méthode ne décide plus elle-même de
   * redessiner le panneau. Partagée par Relecture (renderRelectureHome/
   * renderRelectureDiffRow) et Édition (renderEditionHome) — un seul
   * gabarit de page d'accueil à entrées compactes pour tout le panneau. */
  private renderHomeRow(container: HTMLElement, icon: string, title: string, sub: string, onClick: () => void): void {
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    const head = section.createDiv({ cls: "feuillets-notes-section-head feuillets-clickable" });

    const iconSpan = head.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, icon);

    head.createSpan({ cls: "feuillets-notes-section-title" }).setText(title);

    const chevronSpan = head.createSpan({ cls: "feuillets-notes-section-icon" });
    chevronSpan.setAttr("style", "margin-left: auto;");
    setIcon(chevronSpan, "chevron-right");

    section.createDiv({ cls: "feuillets-notes-sub" }).setText(sub);

    head.addEventListener("click", () => {
      onClick();
    });
  }

  async renderSubView(subView: SidebarSubView, element: HTMLElement): Promise<void> {
    subView.targetContainer = element;
    await subView.render(true);
  }

  async renderAllSubViews(force = false): Promise<void> {
    if (this.tabLayoutKey !== this.getTabLayoutKey()) { await this.render(); return; }
    if (this.activeTab === "carnets") {
      this.carnetsContent?.refresh();
      return;
    }
    if (this.activeTab === "project") {
      // Gestion de projet : aucune sous-vue montée (tout est construit
      // directement par renderProjectTab) — un rendu complet du panneau suffit.
      await this.render();
      return;
    }
    if (this.activeTab === "stats") {
      await this.subViews.analyse.render(force);
      return;
    }
    if (this.activeTab === "relecture") {
      if (this.relecturePage === "docx") await this.subViews.docx.render(force);
      else if (this.relecturePage === "analysis") await this.subViews.relecture.render(force);
      else if (this.relecturePage === "native") await this.subViews.nativeReview.render(force);
      return;
    }
    await this.subViews[this.activeTab].render(force);
  }

  private getEditionContext(): string {
    const project = this.plugin.getProjectFolder()?.path ?? null;
    const root = this.plugin.editorialRootForComposition?.()?.path ?? project;
    const file = this.editionActiveFile();
    const projectFolder = this.plugin.getProjectFolder();
    const protectedPath = file && projectFolder && manuscriptPathIsProtected(projectFolder, file.path) ? file.path : null;
    return JSON.stringify([project, root, protectedPath, this.plugin.getActiveEditorialScope?.()]);
  }

  private getTabLayoutKey(): string {
    return JSON.stringify([this.plugin.settings.hiddenPanels || [], getLocale()]);
  }

  async refreshData(): Promise<void> {
    if (this.tabLayoutKey !== this.getTabLayoutKey()) {
      await this.render();
    } else if (this.activeTab === "carnets") {
      this.carnetsContent?.refresh();
    } else if (this.activeTab === "journal" && this.subViews.journal.refreshData) {
      await this.subViews.journal.refreshData();
    } else if (this.activeTab !== "project") {
      await this.renderAllSubViews();
    } else if (this.editionContext !== this.getEditionContext()) {
      await this.render();
    }
    // Mounted Edition forms keep their DOM; reactivation and explicit renders
    // reload their data through the existing components.
  }
}

function awaitRender(subView: SidebarSubView, force: boolean): void {
  void subView.render(force);
}
