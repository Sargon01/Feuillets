import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_SIDEBAR_FEUILLETS } from "../constants.js";
import { t } from "../i18n/index.js";
import { AnalysisView } from "./analysis-view.js";
import { DocxReviewView } from "./docx-review-view.js";
import { JournalView } from "./journal-view.js";
import { NotesView } from "./notes-view.js";
import type { ProjectView } from "./project-view.js";
import { ResearchView } from "./research-view.js";
import { TextAnalysisView } from "./text-analysis-view.js";

type SidebarTab = "notes" | "research" | "journal" | "project" | "analyse" | "relecture";
type SidebarPlugin = ConstructorParameters<typeof ProjectView>[1];
type SidebarSubView = {
  targetContainer?: HTMLElement;
  render(force?: boolean): Promise<void>;
};
type AnalysisSidebarSubView = SidebarSubView & {
  _chaptersCache: unknown;
  _dashboardCache: unknown;
};
type SidebarSubViews = {
  notes: SidebarSubView;
  research: SidebarSubView;
  journal: SidebarSubView;
  docx: SidebarSubView;
  analyse: AnalysisSidebarSubView;
  relecture: SidebarSubView;
};
type SidebarTabDefinition = { id: SidebarTab; icon: string; title: string };

function activeTabFor(value: unknown): SidebarTab {
  if (value === "docx") return "project";
  if (value === "metadata") return "notes";
  if (
    value === "notes" || value === "research" || value === "journal" ||
    value === "project" || value === "analyse" || value === "relecture"
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
      analyse: new AnalysisView(this.leaf, this.plugin),
      relecture: new TextAnalysisView(this.leaf, this.plugin),
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
    const feuilletTabs = new Set<SidebarTab>(["notes", "analyse"]);
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        if (!feuilletTabs.has(this.activeTab)) return;
        if (this.activeTab === "notes") awaitRender(this.subViews.notes, true);
        else if (this.activeTab === "analyse") awaitRender(this.subViews.analyse, true);
      })
    );
    /* L'agrégation « équilibre des chapitres » (onglet Analyse) lit tout le
       manuscrit : on invalide son cache quand le coffre change, pour la
       recalculer au prochain rendu plutôt qu'à chaque navigation. */
    this.registerEvent(
      this.app.vault.on("modify", () => {
        this.subViews.analyse._chaptersCache = null;
        this.subViews.analyse._dashboardCache = null;
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
      { id: "project", icon: "file-diff", title: t("sidebar.tab.project") },
      { id: "analyse", icon: "bar-chart-3", title: t("sidebar.tab.analysis") },
      { id: "relecture", icon: "spell-check", title: t("sidebar.tab.proofreading") },
    ];

    for (const tab of tabs) {
      const button = tabBar.createDiv({
        cls: `feuillets-tab-btn ${this.activeTab === tab.id ? "is-active" : ""}`
      });
      setIcon(button, tab.icon);
      button.setAttr("title", tab.title);

      const handleTabClick = async (): Promise<void> => {
        this.activeTab = tab.id;
        this.plugin.settings.activeRightPanelTab = tab.id;
        await this.plugin.saveSettings();
        await this.render();
      };
      button.addEventListener("click", () => {
        void handleTabClick();
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
      case "analyse":
        await this.renderAnalysisTab(content);
        break;
      case "relecture":
        await this.renderProofreadingTab(content);
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

  /* L'ancien onglet fusionné Export / Révision ne conserve que la révision
     DOCX. L'export vit désormais exclusivement dans PreviewView. L'identifiant
     `project` est gardé pour migrer sans casser les préférences existantes. */
  async renderProjectTab(element: HTMLElement): Promise<void> {
    const docxEl = element.createDiv({ cls: "feuillets-merged-section" });
    await this.renderSubView(this.subViews.docx, docxEl);
  }

  async renderAnalysisTab(element: HTMLElement): Promise<void> {
    await this.renderSubView(this.subViews.analyse, element);
  }

  async renderProofreadingTab(element: HTMLElement): Promise<void> {
    await this.renderSubView(this.subViews.relecture, element);
  }

  async renderSubView(subView: SidebarSubView, element: HTMLElement): Promise<void> {
    subView.targetContainer = element;
    await subView.render(true);
  }

  async renderAllSubViews(force = false): Promise<void> {
    if (this.activeTab === "project") {
      await this.subViews.docx.render(force);
      return;
    }
    await this.subViews[this.activeTab].render(force);
  }
}

function awaitRender(subView: SidebarSubView, force: boolean): void {
  void subView.render(force);
}
