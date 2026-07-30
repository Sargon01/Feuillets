import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_SIDEBAR_FEUILLETS } from "../constants.js";
import { t } from "../i18n/index.js";
import { AnalysisView } from "./analysis-view.js";
import { DocxReviewView } from "./docx-review-view.js";
import { GrammarView } from "./grammar-view.js";
import { JournalView } from "./journal-view.js";
import { NotesView } from "./notes-view.js";
import { ProjectView } from "./project-view.js";
import { ResearchView } from "./research-view.js";

type SidebarTab = "notes" | "research" | "journal" | "project" | "grammar" | "analyse";
type SidebarPlugin = ConstructorParameters<typeof ProjectView>[1];
type SidebarSubView = {
  targetContainer?: HTMLElement;
  render(force?: boolean): Promise<void>;
};
type AnalysisSidebarSubView = SidebarSubView & {
  _chaptersCache: unknown;
  _vocabCache: unknown;
  _dashboardCache: unknown;
  _romanVocabCache: unknown;
};
type SidebarSubViews = {
  notes: SidebarSubView;
  research: SidebarSubView;
  journal: SidebarSubView;
  docx: SidebarSubView;
  project: SidebarSubView;
  grammar: SidebarSubView;
  analyse: AnalysisSidebarSubView;
};
type SidebarTabDefinition = { id: SidebarTab; icon: string; title: string };

function activeTabFor(value: unknown): SidebarTab {
  if (value === "docx") return "project";
  if (value === "metadata") return "notes";
  if (
    value === "notes" || value === "research" || value === "journal" ||
    value === "project" || value === "grammar" || value === "analyse"
  ) {
    return value;
  }
  return "project";
}

export class SidebarFeuilletsView extends ItemView {
  plugin: SidebarPlugin;
  activeTab: SidebarTab;
  subViews: SidebarSubViews;

  constructor(leaf: WorkspaceLeaf, plugin: SidebarPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.activeTab = activeTabFor(plugin.settings.activeRightPanelTab || "notes");
    this.subViews = {
      notes: new NotesView(this.leaf, this.plugin),
      research: new ResearchView(this.leaf, this.plugin),
      journal: new JournalView(this.leaf, this.plugin),
      docx: new DocxReviewView(this.leaf, this.plugin),
      project: new ProjectView(this.leaf, this.plugin),
      grammar: new GrammarView(this.leaf, this.plugin),
      analyse: new AnalysisView(this.leaf, this.plugin),
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

  async onOpen(): Promise<void> {
    await this.render();
    /* Les sous-vues ne reçoivent pas leur propre onOpen (elles ne sont pas
       ouvertes comme feuilles) : leurs écouteurs ne se déclenchent donc pas.
       Le panneau, lui, est une vraie feuille — on y rafraîchit l'onglet actif
       à chaque ouverture de fichier, pour tous les onglets dont le contenu
       dépend du feuillet courant (Notes, Correcteur, Analyse — tous lisent
       getActiveFile). Recherche/Projet/Journal ne dépendent pas du feuillet
       et ne sont donc pas re-rendus inutilement. */
    const feuilletTabs = new Set<SidebarTab>(["notes", "grammar", "analyse"]);
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        if (!feuilletTabs.has(this.activeTab)) return;
        const subView = this.subViews[this.activeTab];
        awaitRender(subView, true);
      })
    );
    /* L'agrégation « équilibre des chapitres » (onglet Analyse) lit tout le
       manuscrit : on invalide son cache quand le coffre change, pour la
       recalculer au prochain rendu plutôt qu'à chaque navigation. */
    this.registerEvent(
      this.app.vault.on("modify", () => {
        this.subViews.analyse._chaptersCache = null;
        this.subViews.analyse._vocabCache = null;
        this.subViews.analyse._dashboardCache = null;
        this.subViews.analyse._romanVocabCache = null;
      })
    );
  }

  async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("feuillets-sidebar-container");

    // ----- BARRE D'ONGLETS -----
    const tabBar = container.createDiv({ cls: "feuillets-sidebar-tab-bar" });
    const tabs: SidebarTabDefinition[] = [
      { id: "notes", icon: "file-text", title: t("sidebar.tab.notes") },
      { id: "research", icon: "book-marked", title: t("sidebar.tab.research") },
      { id: "journal", icon: "calendar", title: t("sidebar.tab.journal") },
      { id: "project", icon: "folder-cog", title: t("sidebar.tab.project") },
      { id: "grammar", icon: "spell-check", title: t("sidebar.tab.grammar") },
      { id: "analyse", icon: "bar-chart-3", title: t("sidebar.tab.analysis") },
    ];

    for (const tab of tabs) {
      const button = tabBar.createDiv({
        cls: `feuillets-tab-btn ${this.activeTab === tab.id ? "is-active" : ""}`
      });
      setIcon(button, tab.icon);
      button.setAttr("title", tab.title);

      button.addEventListener("click", async () => {
        this.activeTab = tab.id;
        this.plugin.settings.activeRightPanelTab = tab.id;
        await this.plugin.saveSettings();
        await this.render();
      });
    }

    // ----- CONTENU DYNAMIQUE DE L'ONGLET SÉLECTIONNÉ -----
    const content = container.createDiv({ cls: "feuillets-sidebar-content" });

    switch (this.activeTab) {
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
      case "grammar":
        await this.renderGrammarTab(content);
        break;
      case "analyse":
        await this.renderAnalysisTab(content);
        break;
    }
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

  /* Onglet fusionné : Compilation/export (ProjectView) puis Révision .docx
     (DocxReviewView) l'un sous l'autre — chacun dans son propre conteneur
     pour que le container.empty() de l'un n'efface pas le rendu de l'autre.
     La gestion des projets a quitté cet onglet (voir ManageProjectsModal,
     ouverte depuis le binder), ce qui a libéré la place pour la révision. */
  async renderProjectTab(element: HTMLElement): Promise<void> {
    const projectEl = element.createDiv({ cls: "feuillets-merged-section" });
    await this.renderSubView(this.subViews.project, projectEl);

    const docxEl = element.createDiv({ cls: "feuillets-merged-section" });
    await this.renderSubView(this.subViews.docx, docxEl);
  }

  async renderGrammarTab(element: HTMLElement): Promise<void> {
    await this.renderSubView(this.subViews.grammar, element);
  }

  async renderAnalysisTab(element: HTMLElement): Promise<void> {
    await this.renderSubView(this.subViews.analyse, element);
  }

  async renderSubView(subView: SidebarSubView, element: HTMLElement): Promise<void> {
    subView.targetContainer = element;
    await subView.render(true);
  }

  async renderAllSubViews(force = false): Promise<void> {
    if (this.activeTab === "project") {
      await this.subViews.project.render(force);
      await this.subViews.docx.render(force);
      return;
    }
    await this.subViews[this.activeTab].render(force);
  }
}

function awaitRender(subView: SidebarSubView, force: boolean): void {
  void subView.render(force);
}
