const { ItemView, setIcon } = require("obsidian");
import { VIEW_SIDEBAR_FEUILLETS } from "../constants.js";
import { NotesView } from "./notes-view.js";
import { ResearchView } from "./research-view.js";
import { JournalView } from "./journal-view.js";
import { ProjectView } from "./project-view.js";
import { DocxReviewView } from "./docx-review-view.js";
import { GrammarView } from "./grammar-view.js";
import { AnalysisView } from "./analysis-view.js";

export class SidebarFeuilletsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.activeTab = plugin.settings.activeRightPanelTab || "notes";
    this.subViews = {
      notes: new NotesView(this.leaf, this.plugin),
      research: new ResearchView(this.leaf, this.plugin),
      journal: new JournalView(this.leaf, this.plugin),
      docx: new DocxReviewView(this.leaf, this.plugin),
      project: new ProjectView(this.leaf, this.plugin),
      grammar: new GrammarView(this.leaf, this.plugin),
      analyse: new AnalysisView(this.leaf, this.plugin),
    };
    // "docx" n'a plus son propre onglet — fusionné dans "project" (voir
    // renderProjectTab) depuis que la gestion des projets est passée dans
    // ManageProjectsModal (ouverte depuis le binder), libérant la place.
    if (this.activeTab === "docx") this.activeTab = "project";
    // "metadata" (ancien onglet Propriétés) a fusionné dans "notes" —
    // section "Propriétés du fichier" + modales Propriétés/Tags du projet.
    if (this.activeTab === "metadata") this.activeTab = "notes";
  }

  getViewType() {
    return VIEW_SIDEBAR_FEUILLETS;
  }

  getDisplayText() {
    return "Feuillets — Inspecteur";
  }

  getIcon() {
    return "sliders-horizontal";
  }

  async onOpen() {
    await this.render();
    /* Les sous-vues ne reçoivent pas leur propre onOpen (elles ne sont pas
       ouvertes comme feuilles) : leurs écouteurs ne se déclenchent donc pas.
       Le panneau, lui, est une vraie feuille — on y rafraîchit l'onglet actif
       à chaque ouverture de fichier, pour tous les onglets dont le contenu
       dépend du feuillet courant (Notes, Correcteur, Analyse — tous lisent
       getActiveFile). Recherche/Projet/Journal ne dépendent pas du feuillet
       et ne sont donc pas re-rendus inutilement. */
    const FEUILLET_TABS = new Set(["notes", "grammar", "analyse"]);
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        if (!FEUILLET_TABS.has(this.activeTab)) return;
        const sub = this.subViews[this.activeTab];
        if (sub && typeof sub.render === "function") sub.render(true);
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
      })
    );
  }

  async render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("feuillets-sidebar-container");

    // ----- BARRE D'ONGLETS -----
    const tabBar = container.createDiv({ cls: "feuillets-sidebar-tab-bar" });

    const tabs = [
      { id: "notes", icon: "file-text", title: "Notes du feuillet" },
      { id: "research", icon: "search", title: "Recherche & extraits" },
      { id: "journal", icon: "calendar", title: "Journal & statistiques" },
      { id: "project", icon: "folder-cog", title: "Export & révision (.docx)" },
      { id: "grammar", icon: "spell-check", title: "Correction grammaticale" },
      { id: "analyse", icon: "bar-chart-3", title: "Analyse du texte" },
    ];

    for (const tab of tabs) {
      const btn = tabBar.createDiv({
        cls: `feuillets-tab-btn ${this.activeTab === tab.id ? "is-active" : ""}`
      });
      setIcon(btn, tab.icon);
      btn.setAttr("title", tab.title);

      btn.addEventListener("click", async () => {
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
      default:
        await this.renderProjectTab(content);
        break;
    }
  }

  async renderNotesTab(el) {
    const subView = this.subViews.notes;
    subView.targetContainer = el;
    await subView.render(true);
  }

  async renderResearchTab(el) {
    const subView = this.subViews.research;
    subView.targetContainer = el;
    await subView.render(true);
  }

  async renderJournalTab(el) {
    const subView = this.subViews.journal;
    subView.targetContainer = el;
    await subView.render(true);
  }

  /* Onglet fusionné : Compilation/export (ProjectView) puis Révision .docx
     (DocxReviewView) l'un sous l'autre — chacun dans son propre conteneur
     pour que le container.empty() de l'un n'efface pas le rendu de l'autre.
     La gestion des projets a quitté cet onglet (voir ManageProjectsModal,
     ouverte depuis le binder), ce qui a libéré la place pour la révision. */
  async renderProjectTab(el) {
    const projectEl = el.createDiv({ cls: "feuillets-merged-section" });
    const projectSubView = this.subViews.project;
    projectSubView.targetContainer = projectEl;
    await projectSubView.render(true);

    const docxEl = el.createDiv({ cls: "feuillets-merged-section" });
    const docxSubView = this.subViews.docx;
    docxSubView.targetContainer = docxEl;
    await docxSubView.render(true);
  }

  async renderGrammarTab(el) {
    const subView = this.subViews.grammar;
    subView.targetContainer = el;
    await subView.render(true);
  }

  async renderAnalysisTab(el) {
    const subView = this.subViews.analyse;
    subView.targetContainer = el;
    await subView.render(true);
  }

  async renderAllSubViews(force = false) {
    if (this.activeTab === "project") {
      await this.subViews.project.render(force);
      await this.subViews.docx.render(force);
      return;
    }
    const subView = this.subViews[this.activeTab];
    if (subView && typeof subView.render === "function") {
      await subView.render(force);
    }
  }
}
