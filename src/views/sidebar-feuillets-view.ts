import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_PREVIEW, VIEW_SIDEBAR_FEUILLETS } from "../constants.js";
import { t } from "../i18n/index.js";
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
import { EditionDocsContent, type EditionDocsContentPlugin } from "../ui/edition-docs-content.js";
import { ExportPanel, type ExportPanelPlugin } from "../ui/export-panel.js";
import { createProjectScope } from "../services/compile-scope.js";
import { openScopeWithPreviewBesideLeaf } from "./preview-view.js";

type SidebarTab = "notes" | "research" | "journal" | "project" | "stats" | "relecture";
/** Sous-page de l'onglet Édition (clé interne "project") — état purement en
 * mémoire (jamais persisté dans les réglages) : "home" affiche les trois
 * entrées de navigation (Composition, Mise en page, Dossier éditorial) ; les
 * autres valeurs affichent la sous-page correspondante en remplacement total,
 * avec la barre Retour partagée (renderBackBar). */
export type EditionPage = "home" | "composition" | "layout" | "documents";
/** Sous-page de l'onglet Relecture — état purement en mémoire (jamais
 * persisté dans les réglages, voir renderProofreadingTab). "home" affiche
 * les deux entrées compactes ; "analysis"/"docx" affichent l'une des deux
 * sous-vues complètes (TextAnalysisView/DocxReviewView), en remplacement
 * total de la page d'accueil, dans le même panneau. */
type RelecturePage = "home" | "native" | "analysis" | "docx";
type SidebarPlugin =
  ConstructorParameters<typeof BaseFeuilletsView>[1]
  & EditionWorkspacePlugin
  & EditionDocsContentPlugin
  & ExportPanelPlugin;
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
    value === "project" || value === "stats" || value === "relecture"
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

  async onOpen(): Promise<void> {
    await this.render();
    /* Les sous-vues ne reçoivent pas leur propre onOpen (elles ne sont pas
       ouvertes comme feuilles) : leurs écouteurs ne se déclenchent donc pas.
       Le panneau, lui, est une vraie feuille — on y rafraîchit l'onglet actif
       à chaque ouverture de fichier, pour tous les onglets dont le contenu
       dépend du feuillet courant (Notes, Correcteur, Analyse — tous lisent
       getActiveFile). Recherche/Projet/Journal ne dépendent pas du feuillet
       et ne sont donc pas re-rendus inutilement. */
    const feuilletTabs = new Set<SidebarTab>(["notes", "relecture", "stats"]);
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        if (!feuilletTabs.has(this.activeTab)) return;
        if (this.activeTab === "notes") { awaitRender(this.subViews.notes, true); return; }
        if (this.activeTab === "stats") { awaitRender(this.subViews.analyse, true); return; }
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
        void (async () => {
          this.activeTab = tabs[next].id;
          this.plugin.settings.activeRightPanelTab = this.activeTab;
          await this.plugin.saveSettings();
          await this.render();
        })();
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
  private async openPreview(): Promise<void> {
    const root = this.plugin.getProjectFolder();
    if (!root) return;
    const workspace = this.app.workspace;
    if (typeof workspace.getMostRecentLeaf !== "function") return;
    const anchorLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    if (!anchorLeaf) return;
    await openScopeWithPreviewBesideLeaf(this.app, createProjectScope(root.path), anchorLeaf);
  }

  /** Barre globale « Aperçu / Portée / Format / Exporter » — CORRECTIF
   * PROMPT 2/3, §1/§3/§4 : commune aux quatre pages de l'onglet Édition
   * (accueil, Composition, Mise en page, Dossier éditorial), rendue UNE
   * seule fois par `renderProjectTab()`. Réutilise exclusivement
   * `ExportPanel.renderQuickBar()` pour portée/format/Exporter — aucun
   * select ni workflow d'export réimplémenté ici, la Sidebar ne possède que
   * le conteneur visuel. */
  private renderEditionActionsBar(element: HTMLElement): void {
    const bar = element.createDiv({ cls: "feuillets-sidebar-edition-actions" });

    const previewBtn = bar.createEl("button", { cls: "clickable-icon" });
    setIcon(previewBtn, "eye");
    previewBtn.setAttr("aria-label", t("sidebar.edition.openPreview"));
    previewBtn.setAttr("title", t("sidebar.edition.openPreview"));
    previewBtn.addEventListener("click", () => void this.openPreview());

    const exportHost = bar.createDiv({ cls: "feuillets-sidebar-edition-export-host" });
    new ExportPanel(this.app, this.plugin, exportHost).renderQuickBar(exportHost);
  }

  /* Onglet « Édition » (clé interne "project") : page d'accueil avec 3 entrées
     (Composition, Mise en page, Dossier éditorial) ou sous-pages montées via
     EditionWorkspaceContent ou EditionDocsContent. La barre
     globale Aperçu/Export (renderEditionActionsBar) est rendue en tête, hors
     du wrapper HOME/sous-page — commune aux quatre pages.
     UN SEUL Retour visible à chaque profondeur : la barre « Retour à
     Édition » n'est rendue que lorsque le contenu enfant est sur sa PAGE
     RACINE (childIsAtRoot, voir setEditionChildAtRoot) — sinon seul le
     Retour local de l'enfant reste, jamais les deux simultanément. */
  async renderProjectTab(element: HTMLElement): Promise<void> {
    this.renderEditionActionsBar(element);
    const wrapper = element.createDiv({ cls: "feuillets-notes-container" });
    if (this.editionPage !== "home") {
      this.editionBackHost = wrapper.createDiv({ cls: "feuillets-edition-back-host" });
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
            onNavigationRootChange: (isRoot) => this.setEditionChildAtRoot(isRoot),
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
            onNavigationRootChange: (isRoot) => this.setEditionChildAtRoot(isRoot),
          }
        );
        await content.render();
      } else if (this.editionPage === "documents") {
        // Dossier éditorial : pas de navigation interne — le Retour global
        // reste le seul Retour et est toujours présent.
        this.renderEditionBackBar();
        const content = new EditionDocsContent(
          this.app,
          this.plugin,
          host
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
    this.renderEditionNavRow(container, "folder-cog", t("sidebar.edition.editorialFolder"), () => {
      this.editionPage = "documents";
      void this.render();
    });
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
}

function awaitRender(subView: SidebarSubView, force: boolean): void {
  void subView.render(force);
}
