import { ItemView, Menu, Notice, TFolder, setIcon, type WorkspaceLeaf } from "obsidian";
import { VIEW_SIDEBAR_FEUILLETS } from "../constants.js";
import { t } from "../i18n/index.js";
import { openSnapshotComparison } from "./comparison-view.js";
import { AnalysisView } from "./analysis-view.js";
import { DocxReviewView } from "./docx-review-view.js";
import { JournalView } from "./journal-view.js";
import { NativeReviewView } from "./native-review-view.js";
import { NotesView } from "./notes-view.js";
import type { ProjectView } from "./project-view.js";
import { ResearchView } from "./research-view.js";
import { TextAnalysisView } from "./text-analysis-view.js";
import { ManageProjectsModal, NewProjectModal, OpenExistingFolderModal } from "../ui/project-modals.js";
import { ScrivenerImportModal } from "../ui/scrivener-import-modal.js";
import { PROJECT_MODES, resolveType } from "../utils/project-modes.js";

type SidebarTab = "notes" | "research" | "journal" | "project" | "relecture";
/** Sous-page de l'onglet Relecture — état purement en mémoire (jamais
 * persisté dans les réglages, voir renderProofreadingTab). "home" affiche
 * les deux entrées compactes ; "analysis"/"docx" affichent l'une des deux
 * sous-vues complètes (TextAnalysisView/DocxReviewView), en remplacement
 * total de la page d'accueil, dans le même panneau. */
type RelecturePage = "home" | "native" | "analysis" | "docx";
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
  nativeReview: SidebarSubView;
};
type SidebarTabDefinition = { id: SidebarTab; icon: string; titleKey: string };

const SIDEBAR_TABS: SidebarTabDefinition[] = [
  { id: "notes", icon: "file-text", titleKey: "sidebar.tab.notes" },
  { id: "research", icon: "book-marked", titleKey: "sidebar.tab.research" },
  { id: "journal", icon: "calendar", titleKey: "sidebar.tab.journal" },
  { id: "project", icon: "folder-cog", titleKey: "sidebar.tab.project" },
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

  /* Onglet « Projet » — GESTION DE PROJET (chantier espace central, §13).
     Documents éditoriaux et Édition ont quitté le panneau latéral pour le
     centre : l'espace libéré accueille désormais le seul accès quotidien au
     projet actif. L'identifiant `project` est conservé pour ne pas casser
     `activeRightPanelTab` des installations existantes.

     Volontairement minimal (§13) : un en-tête de section, la ligne du projet
     actif (icône + nom + chevron), sa ligne d'information type · auteur.
     Aucune carte lourde, aucun cockpit, aucun formulaire permanent — la
     gestion avancée reste ManageProjectsModal (§17). */
  async renderProjectTab(element: HTMLElement): Promise<void> {
    // §21 : cloisonnement CSS — toute règle Projet ajoutée par ce chantier
    // vit STRICTEMENT sous cette racine (voir styles.css).
    const container = element.createDiv({ cls: "feuillets-sidebar-project" });

    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.header") });

    const S = this.plugin.settings;
    const path = S.projectFolder;
    const root = this.plugin.getProjectFolder();
    const meta: ProjectMeta = path ? (S.projectMeta[path] || {}) : {};

    const head = section.createDiv({ cls: "feuillets-notes-section-head feuillets-clickable" });
    const iconSpan = head.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconSpan, root ? ((meta.icon as string) || "folder-open") : "alert-triangle");
    head.createSpan({ cls: "feuillets-notes-section-title" })
      .setText(root && path ? this.plugin.projectDisplayName(path) : t("sidebar.project.none"));
    const chevron = head.createSpan({ cls: "feuillets-notes-section-icon" });
    chevron.setAttr("style", "margin-left: auto;");
    setIcon(chevron, "chevron-down");
    head.addEventListener("click", (event) => this.showProjectMenu(event));

    section.createDiv({ cls: "feuillets-notes-sub" }).setText(this.projectSubtitle(meta));

    // §13-17 : panneau compact de gestion, uniquement si un projet est
    // réellement actif — pas de section vide à afficher sans projet.
    if (!root || !path) return;

    this.renderProjectInfoSection(container, path, meta);
    this.renderProjectManuscriptSection(container, root);
    this.renderProjectManagementSection(container);
  }

  /** §15 : « Informations » — UNIQUEMENT les champs déjà présents dans
   * ProjectMeta (types.d.ts), affichés en lecture seule. Aucune valeur
   * absente n'est inventée : un champ vide n'affiche tout simplement pas de
   * ligne. La modification reste le rôle de ManageProjectsModal (§15) — ce
   * panneau ne crée pas de second éditeur de métadonnées. */
  private renderProjectInfoSection(container: HTMLElement, path: string, meta: ProjectMeta): void {
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.infoHeader") });

    const typeLabel = PROJECT_MODES[resolveType(meta.type)]?.label || "";
    const fields: Array<[string, string | undefined]> = [
      [t("sidebar.project.fieldName"), this.plugin.projectDisplayName(path)],
      [t("sidebar.project.fieldAuthor"), meta.author],
      [t("sidebar.project.fieldType"), typeLabel],
      [t("sidebar.project.fieldDescription"), meta.description],
    ];
    for (const [label, rawValue] of fields) {
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (!value) continue;
      const row = section.createDiv({ cls: "feuillets-properties-row" });
      row.createSpan({ cls: "feuillets-properties-key", text: label });
      row.createSpan({ cls: "feuillets-properties-value", text: value });
    }
  }

  /** §16 : « Manuscrit » — juste le dossier réellement résolu
   * (`getProjectFolder`, déjà consommé partout ailleurs). Aucune métrique
   * calculée ici : afficher un chiffre inventé serait pire que rien. */
  private renderProjectManuscriptSection(container: HTMLElement, root: TFolder): void {
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.manuscriptHeader") });
    const row = section.createDiv({ cls: "feuillets-properties-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: t("sidebar.project.fieldFolder") });
    row.createSpan({ cls: "feuillets-properties-value", text: root.name });
  }

  /** §17 : « Gestion » — un seul accès compact vers l'administration
   * avancée déjà existante (ManageProjectsModal, déjà ouverte depuis le menu
   * du projet actif). Aucune logique dupliquée : ce n'est qu'un second point
   * d'entrée vers la même modale. */
  private renderProjectManagementSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.manageHeader") });
    const row = section.createDiv({ cls: "feuillets-notes-section-head feuillets-clickable" });
    const iconSpan = row.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, "folder-cog");
    row.createSpan({ cls: "feuillets-notes-section-title", text: t("sidebar.project.manage") });
    row.addEventListener("click", () => new ManageProjectsModal(this.app, this.plugin).open());
  }

  /** Ligne d'information sous le projet actif : « Type · Auteur » — les deux
   * données déjà stockées dans ProjectMeta, jamais un nouveau réglage. */
  private projectSubtitle(meta: ProjectMeta): string {
    const typeLabel = PROJECT_MODES[resolveType(meta.type)]?.label || "";
    const author = typeof meta.author === "string" ? meta.author.trim() : "";
    return [typeLabel, author].filter(Boolean).join(" · ");
  }

  /** §14 : un Menu Obsidian NATIF — tous les projets connus, coche sur
   * l'actif, puis les quatre entrées de gestion qui réutilisent les modales
   * existantes (aucune nouvelle modale créée). */
  private showProjectMenu(event: MouseEvent): void {
    const S = this.plugin.settings;
    const menu = new Menu();
    const known = [S.projectFolder, ...(S.projects || [])]
      .filter((p, i, a): p is string => !!p && a.indexOf(p) === i);
    for (const path of known) {
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.projectDisplayName(path))
          .setChecked(path === S.projectFolder)
          .onClick(() => { void this.switchProject(path); })
      );
    }
    if (known.length) menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("sidebar.project.new")).setIcon("folder-plus")
      .onClick(() => new NewProjectModal(this.app, this.plugin).open()));
    menu.addItem((item) => item.setTitle(t("sidebar.project.useExisting")).setIcon("folder-open")
      .onClick(() => new OpenExistingFolderModal(this.app, this.plugin).open()));
    menu.addItem((item) => item.setTitle(t("sidebar.project.importScrivener")).setIcon("import")
      .onClick(() => new ScrivenerImportModal(this.app, this.plugin).open()));
    menu.addItem((item) => item.setTitle(t("sidebar.project.manage")).setIcon("folder-cog")
      .onClick(() => new ManageProjectsModal(this.app, this.plugin).open()));
    menu.showAtMouseEvent(event);
  }

  /** §15 : changement de projet DIRECT, sans passer par une modale — même
   * séquence exacte que ManageProjectsModal.renderProjectRow (préservation de
   * l'ancien projet dans `settings.projects`, saveSettings, updateStatusBar,
   * renderAllViews). */
  private async switchProject(path: string): Promise<void> {
    const S = this.plugin.settings;
    if (path === S.projectFolder) return;
    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) {
      new Notice(t("modal.manageProjects.folderGone", { path }));
      return;
    }
    if (S.projectFolder && !S.projects.includes(S.projectFolder)) S.projects.push(S.projectFolder);
    S.projectFolder = path;
    await this.plugin.saveSettings();
    // `updateStatusBar` est asynchrone (compte les mots du projet) : on ne
    // l'attend pas — même geste que partout ailleurs dans main.ts.
    void this.plugin.updateStatusBar();
    this.plugin.renderAllViews(true);
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
