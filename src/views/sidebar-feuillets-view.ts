import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_SIDEBAR_FEUILLETS } from "../constants.js";
import { t } from "../i18n/index.js";
import { DiffModal } from "../ui/diff-modal.js";
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
/** Sous-page de l'onglet Relecture — état purement en mémoire (jamais
 * persisté dans les réglages, voir renderProofreadingTab). "home" affiche
 * les deux entrées compactes ; "analysis"/"docx" affichent l'une des deux
 * sous-vues complètes (TextAnalysisView/DocxReviewView), en remplacement
 * total de la page d'accueil, dans le même panneau. */
type RelecturePage = "home" | "analysis" | "docx";
/** Page affichée dans l'espace Édition ("project") — état PUREMENT en
 * mémoire, jamais persisté (même règle que `relecturePage` ci-dessus) :
 * survit tant que le panneau existe, repart de "home" à chaque rechargement
 * du plugin. "home" affiche les trois entrées compactes (Composition/Mise
 * en page/Documents) ; les trois autres valeurs affichent l'une des trois
 * sous-vues complètes déjà en place (EditionCompositionView/
 * EditionLayoutView/EditionDocsView), en remplacement total de la page
 * d'accueil — exactement le même gabarit que `relecturePage`/
 * renderProofreadingTab ci-dessus, voir renderProjectTab. */
type EditionPage = "home" | "composition" | "layout" | "docs";
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
  // DocxReviewView n'habite plus l'espace Édition ("project") : les deux
  // anciennes valeurs pointent maintenant vers Relecture, seule sa page
  // secondaire diffère (voir le constructeur, qui lit CETTE MÊME valeur
  // pour choisir relecturePage).
  if (value === "docx") return "relecture";
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
  relecturePage: RelecturePage;
  editionPage: EditionPage;
  subViews: SidebarSubViews;

  constructor(leaf: WorkspaceLeaf, plugin: SidebarPlugin) {
    super(leaf);
    this.plugin = plugin;
    const legacyTab = plugin.settings.activeRightPanelTab || "notes";
    this.activeTab = activeTabFor(legacyTab);
    /* Compat : les anciennes valeurs "docx"/"analyse" d'activeRightPanelTab
       ouvraient directement la sous-vue correspondante — on ouvre donc
       Relecture directement sur la bonne page secondaire au lieu de sa
       page d'accueil. Lecture ponctuelle au démarrage seulement :
       relecturePage n'est ensuite JAMAIS réécrit dans les réglages (aucun
       nouveau réglage persistant, conformément à la mission). */
    this.relecturePage = legacyTab === "docx" ? "docx" : legacyTab === "analyse" ? "analysis" : "home";
    // Jamais lu depuis les réglages (aucun nouveau réglage persistant) :
    // repart toujours de "home" à la création du panneau.
    this.editionPage = "home";
    this.subViews = {
      notes: new NotesView(this.leaf, this.plugin),
      research: new ResearchView(this.leaf, this.plugin),
      journal: new JournalView(this.leaf, this.plugin),
      docx: new DocxReviewView(this.leaf, this.plugin),
      // { embedded: true } : ces trois sous-vues vivent maintenant chacune
      // sur sa propre page secondaire de l'espace Édition (voir
      // renderProjectTab) — leur grand en-tête repliable devient redondant
      // sous la barre « Retour à Édition », voir Edition*View.embedded.
      editionDocs: new EditionDocsView(this.leaf, this.plugin, { embedded: true }),
      editionComposition: new EditionCompositionView(this.leaf, this.plugin, { embedded: true }),
      editionLayout: new EditionLayoutView(this.leaf, this.plugin, { embedded: true }),
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
        if (this.activeTab === "notes") { awaitRender(this.subViews.notes, true); return; }
        // Relecture : ne rafraîchit TextAnalysisView que si sa page est
        // effectivement affichée — pas sur la page d'accueil, pas sur
        // Révision DOCX (qui ne dépend pas du feuillet actif).
        if (this.relecturePage === "analysis") awaitRender(this.subViews.relecture, true);
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
     (lot 1) : regroupe les documents éditoriaux du dossier Edition/
     (synopsis, note d'intention, biographie, lettre d'accompagnement,
     soumissions…). L'export vit toujours exclusivement dans PreviewView.
     L'identifiant `project` est gardé pour migrer sans casser les
     préférences existantes. Les révisions/commentaires DOCX (ex-Révision
     DOCX de cet espace) ont déménagé vers la page secondaire "docx" de
     Relecture — voir renderProofreadingTab.
     Correctif UI : page d'accueil à trois entrées compactes + page secondaire
     avec barre Retour — EXACTEMENT le même gabarit que l'espace Relecture
     ci-dessous (renderProofreadingTab/renderRelectureHome/
     renderRelectureBackBar), pas une seconde navigation. La barre de
     sous-onglets horizontale du chantier précédent (illisible dans un
     panneau de 250–300px) est retirée. */
  async renderProjectTab(element: HTMLElement): Promise<void> {
    if (this.editionPage === "home") {
      this.renderEditionHome(element);
      return;
    }
    // Même raison que renderProofreadingTab : la barre Retour vit dans
    // `element`, JAMAIS dans le conteneur passé en targetContainer à la
    // sous-vue (les Edition*View vident intégralement leur conteneur au
    // début de leur propre render()) — un second conteneur dédié, enfant de
    // `element` mais frère de la barre, encaisse ce vidage sans jamais
    // l'emporter avec lui.
    this.renderEditionBackBar(element);
    const workspace = element.createDiv({ cls: "feuillets-edition-workspace" });
    const sectionContainer = workspace.createDiv({
      cls: "feuillets-edition-section-container is-first-edition-section",
    });
    await this.renderSubView(this.editionSubViewFor(this.editionPage), sectionContainer);
  }

  /** Sous-vue de l'espace Édition associée à une page secondaire — jamais
   * Révision DOCX (this.subViews.docx), qui n'habite plus cet espace (voir
   * renderProjectTab), jamais appelée pour "home" (aucune sous-vue à cette
   * page, voir renderProjectTab). */
  private editionSubViewFor(page: Exclude<EditionPage, "home">): SidebarSubView {
    if (page === "layout") return this.subViews.editionLayout;
    if (page === "docs") return this.subViews.editionDocs;
    return this.subViews.editionComposition;
  }

  /** Page d'accueil de l'espace Édition : trois entrées compactes, aucune
   * des trois sous-vues complètes affichée — même gabarit que
   * renderRelectureHome (icône native à gauche, chevron à droite, une
   * sous-titre descriptif, pleine largeur), réutilisé via renderHomeRow
   * plutôt que redéfini. Icônes alignées sur getIcon() de chaque sous-vue
   * (edition-composition-view.ts/edition-layout-view.ts/edition-docs-
   * view.ts). Libellés et sous-titres tirés des clés i18n existantes de
   * ces trois vues (displayText/description), aucune nouvelle clé de
   * contenu créée. */
  private renderEditionHome(element: HTMLElement): void {
    this.renderHomeRow(
      element, "book-open",
      t("editionComposition.displayText"), t("editionComposition.description"),
      () => { this.editionPage = "composition"; void this.render(); }
    );
    this.renderHomeRow(
      element, "panel-top",
      t("editionLayout.displayText"), t("editionLayout.description"),
      () => { this.editionPage = "layout"; void this.render(); }
    );
    this.renderHomeRow(
      element, "folder-cog",
      t("editionDocs.displayText"), t("editionDocs.description"),
      () => { this.editionPage = "docs"; void this.render(); }
    );
  }

  /** Même gabarit de barre de retour que Relecture (renderRelectureBackBar)
   * et NotesView (notes-view.ts, Notes de travail) : `.feuillets-notes-
   * back-bar`/`.feuillets-back-btn`/`.feuillets-back-icon`, réutilisés tels
   * quels via renderBackBar plutôt que redéfinis. */
  private renderEditionBackBar(element: HTMLElement): void {
    this.renderBackBar(element, t("editionHub.backToHome"), () => {
      this.editionPage = "home";
      void this.render();
    });
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
    if (this.relecturePage === "home") {
      this.renderRelectureHome(element);
      return;
    }
    // La barre Retour vit dans `element` (le conteneur de page), JAMAIS
    // dans le conteneur passé en targetContainer à la sous-vue : Text
    // AnalysisView/DocxReviewView vident intégralement LEUR conteneur au
    // début de leur propre render() (container.empty()) — si la barre y
    // habitait, ce vidage l'effacerait à chaque rendu. Un second conteneur
    // dédié, enfant de `element` mais frère de la barre, encaisse ce
    // vidage sans jamais l'emporter avec lui.
    this.renderRelectureBackBar(element);
    const content = element.createDiv();
    const subView = this.relecturePage === "docx" ? this.subViews.docx : this.subViews.relecture;
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
      element, "spell-check",
      t("relecture.home.analysis.title"), t("relecture.home.analysis.sub"),
      () => { this.relecturePage = "analysis"; void this.render(); }
    );
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
      () => { new DiffModal(this.app, this.plugin, activeFile).open(); }
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
    if (this.activeTab === "project") {
      // Une seule page de l'espace Édition est affichée à la fois (voir
      // renderProjectTab) : rien à rafraîchir sur l'accueil (pas de
      // sous-vue affichée), comme Relecture sur sa propre page d'accueil
      // (relecturePage === "home", ci-dessous).
      if (this.editionPage === "home") return;
      await this.editionSubViewFor(this.editionPage).render(force);
      return;
    }
    if (this.activeTab === "relecture") {
      if (this.relecturePage === "docx") await this.subViews.docx.render(force);
      else if (this.relecturePage === "analysis") await this.subViews.relecture.render(force);
      return;
    }
    await this.subViews[this.activeTab].render(force);
  }
}

function awaitRender(subView: SidebarSubView, force: boolean): void {
  void subView.render(force);
}
