import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_SIDEBAR_FEUILLETS } from "../constants.js";
import { t } from "../i18n/index.js";
import { AnalysisView } from "./analysis-view.js";
import { DocxReviewView } from "./docx-review-view.js";
import { EditionDocsView } from "./edition-docs-view.js";
import { EditionCompositionView } from "./edition-composition-view.js";
import { EditionLayoutView } from "./edition-layout-view.js";
import { JournalView } from "./journal-view.js";
import { NotesView } from "./notes-view.js";
import type { ProjectView } from "./project-view.js";
import { ResearchView } from "./research-view.js";
import { TextAnalysisView } from "./text-analysis-view.js";

type SidebarTab = "notes" | "research" | "journal" | "project" | "relecture";
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
  editionDocs: SidebarSubView;
  editionComposition: SidebarSubView;
  editionLayout: SidebarSubView;
  analyse: AnalysisSidebarSubView;
  relecture: SidebarSubView;
};
type SidebarTabDefinition = { id: SidebarTab; icon: string; titleKey: string };

const SIDEBAR_TABS: SidebarTabDefinition[] = [
  { id: "notes", icon: "file-text", titleKey: "sidebar.tab.notes" },
  { id: "research", icon: "book-marked", titleKey: "sidebar.tab.research" },
  { id: "journal", icon: "calendar", titleKey: "sidebar.tab.journal" },
  { id: "project", icon: "file-edit", titleKey: "sidebar.tab.project" },
  { id: "relecture", icon: "spell-check", titleKey: "sidebar.tab.proofreading" },
];

function activeTabFor(value: unknown): SidebarTab {
  if (value === "docx") return "project";
  if (value === "analyse") return "relecture";
  if (value === "metadata") return "notes";
  if (
    value === "notes" || value === "research" || value === "journal" ||
    value === "project" || value === "relecture"
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
      editionDocs: new EditionDocsView(this.leaf, this.plugin),
      editionComposition: new EditionCompositionView(this.leaf, this.plugin),
      editionLayout: new EditionLayoutView(this.leaf, this.plugin),
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
    const feuilletTabs = new Set<SidebarTab>(["notes", "relecture"]);
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        if (!feuilletTabs.has(this.activeTab)) return;
        if (this.activeTab === "notes") awaitRender(this.subViews.notes, true);
        else awaitRender(this.subViews.relecture, true);
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
    const tabBar = container.createDiv({ cls: "feuillets-sidebar-tab-bar", attr: { role: "tablist" } });
    const hiddenPanels = new Set(this.plugin.settings.hiddenPanels || []);
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

      const handleTabClick = async (): Promise<void> => {
        this.activeTab = tab.id;
        this.plugin.settings.activeRightPanelTab = tab.id;
        await this.plugin.saveSettings();
        await this.render();
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
        void (async () => { this.activeTab = tabs[next].id; this.plugin.settings.activeRightPanelTab = this.activeTab; await this.plugin.saveSettings(); await this.render(); })();
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

  /* Ancien onglet fusionné Export / Révision, devenu l'espace "Édition"
     (lot 1) : regroupe les révisions/commentaires DOCX (inchangées) et les
     documents éditoriaux du dossier Edition/ (synopsis, note d'intention,
     biographie, lettre d'accompagnement, soumissions…). L'export vit
     toujours exclusivement dans PreviewView. L'identifiant `project` est
     gardé pour migrer sans casser les préférences existantes. */
  /* Espace Édition : quatre sections empilées dans un seul
     conteneur — chaque sous-vue reste responsable de SA propre section
     (.feuillets-project-section, voir renderSectionHead), le séparateur
     visuel entre elles venant de cette classe elle-même (styles.css), sans
     wrapper .feuillets-merged-section devenu inutile.
     Correctif alignement (Phase 2) : les cinq sous-vues partagent en plus
     un même conteneur frère .feuillets-edition-section-container, seule
     source de padding horizontal pour l'espace Édition — voir styles.css.
     Sans lui, chaque sous-vue posait (ou pas) son propre padding, d'où le
     décalage visuel entre Documents éditoriaux/Révision DOCX (historiques)
     et Composition/Mise en page/Exporter (nouvelles). La première section
     reçoit en plus .is-first-edition-section, ciblée directement en CSS
     plutôt que via un sélecteur *:first-child fragile. */
  async renderProjectTab(element: HTMLElement): Promise<void> {
    const workspace = element.createDiv({ cls: "feuillets-edition-workspace" });
    const editionSubViews: SidebarSubView[] = [
      this.subViews.editionComposition,
      this.subViews.editionLayout,
      this.subViews.editionDocs,
      this.subViews.docx,
    ];
    for (const [index, subView] of editionSubViews.entries()) {
      const sectionContainer = workspace.createDiv({ cls: "feuillets-edition-section-container" });
      if (index === 0) sectionContainer.addClass("is-first-edition-section");
      await this.renderSubView(subView, sectionContainer);
    }
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
      await this.subViews.editionDocs.render(force);
      await this.subViews.editionComposition.render(force);
      await this.subViews.editionLayout.render(force);
      return;
    }
    await this.subViews[this.activeTab].render(force);
  }
}

function awaitRender(subView: SidebarSubView, force: boolean): void {
  void subView.render(force);
}
