import { ItemView, Menu, Notice, Setting, TFolder, setIcon, type App, type WorkspaceLeaf } from "obsidian";
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
import {
  projectStatuses, projectFavoriteTags, projectWordGoalDefault, projectTolerance,
  projectTotalWordGoal, projectDeadline, projectSessionGoal,
} from "../services/project-settings.js";
import { MAPPABLE_FIELDS, rawFrontmatterOf } from "../services/frontmatter.js";

/** Libellé d'affichage d'un champ mappable (§21). MAPPABLE_FIELDS
 * (services/frontmatter.ts) donne déjà l'ordre attendu par le mockup du
 * chantier (Synopsis, Résumé long, Statut, POV, Label, Objectif, Fil
 * narratif, Personnages, Date) — aucun second tableau d'ordre créé. */
function mappingFieldLabel(field: MappableFrontmatterField): string {
  return t(`sidebar.project.mappingField.${field}`);
}

type SidebarTab = "notes" | "research" | "journal" | "project" | "relecture";
/** Sous-page de l'onglet Projet — même patron que RelecturePage : "home"
 * affiche le sommaire compact (chantier « panneau Projet », §1-11), les
 * autres valeurs affichent la sous-page correspondante en remplacement
 * total, avec la barre Retour partagée (renderBackBar). Purement en
 * mémoire, jamais persisté — réinitialisée à "home" sur changement de
 * projet (switchProject) pour ne jamais laisser resurgir l'état d'un
 * projet précédent (§38 du chantier, exigence de sécurité additionnelle). */
type ProjectPage = "home" | "info" | "goals" | "statuses" | "labels" | "tags" | "mapping";
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

/** Sous-ensemble de l'explorateur de fichiers natif réellement utilisé ici
 * — même patron que revealFolderInFileExplorer (ui/annexes-panel.ts),
 * dupliqué plutôt que partagé (convention du dépôt) : « Révéler dans
 * l'Explorateur » (GESTION, chantier « panneau Projet ») sélectionne le
 * dossier racine du projet actif dans l'explorateur natif. */
type FileExplorerInstance = { revealInFolder?(node: TFolder): void };
type AppWithInternalPlugins = App & {
  internalPlugins?: { getPluginById?(id: string): { instance?: FileExplorerInstance } | undefined };
};
function revealFolderInFileExplorer(app: App, folder: TFolder): boolean {
  const instance = (app as AppWithInternalPlugins).internalPlugins?.getPluginById?.("file-explorer")?.instance;
  if (!instance?.revealInFolder) return false;
  instance.revealInFolder(folder);
  return true;
}

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
  projectPage: ProjectPage;
  subViews: SidebarSubViews;

  constructor(leaf: WorkspaceLeaf, plugin: SidebarPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.projectPage = "home";
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

  /* Onglet « Projet » — chantier « panneau Projet + métadonnées + mapping
     YAML » : le panneau latéral devient l'UNIQUE lieu de configuration du
     projet actif (voir Paramètres → Projet, appelé à disparaître en Phase
     E une fois toutes ses fonctions couvertes ici). L'identifiant `project`
     est conservé pour ne pas casser `activeRightPanelTab` des installations
     existantes.

     Page d'accueil compacte (sommaire, §1-11) + sous-pages complètes
     (Informations/Objectifs/Statuts/Labels/Tags), même patron que
     RelecturePage : `projectPage` bascule le contenu de CE MÊME conteneur,
     avec la barre Retour déjà utilisée par Relecture/Édition
     (renderBackBar). Aucune nouvelle ItemView, aucune nouvelle modale. */
  async renderProjectTab(element: HTMLElement): Promise<void> {
    if (this.projectPage !== "home") {
      this.renderProjectBackBar(element);
      // §21 : cloisonnement CSS — toute règle Projet ajoutée par ce chantier
      // vit STRICTEMENT sous cette racine (voir styles.css).
      const content = element.createDiv({ cls: "feuillets-sidebar-project" });
      this.renderProjectSubPage(this.projectPage, content);
      return;
    }
    this.renderProjectHome(element);
  }

  private renderProjectBackBar(element: HTMLElement): void {
    this.renderBackBar(element, t("sidebar.project.backToHome"), () => {
      this.projectPage = "home";
      void this.render();
    });
  }

  private renderProjectHome(element: HTMLElement): void {
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
    setIcon(iconSpan, root ? (meta.icon || "folder-open") : "alert-triangle");
    head.createSpan({ cls: "feuillets-notes-section-title" })
      .setText(root && path ? this.plugin.projectDisplayName(path) : t("sidebar.project.none"));
    const chevron = head.createSpan({ cls: "feuillets-notes-section-icon" });
    chevron.setAttr("style", "margin-left: auto;");
    setIcon(chevron, "chevron-down");
    head.addEventListener("click", (event) => this.showProjectMenu(event));

    section.createDiv({ cls: "feuillets-notes-sub" }).setText(this.projectSubtitle(meta));

    // Sommaire compact, uniquement si un projet est réellement actif — pas
    // de section vide à afficher sans projet. La home n'affiche plus
    // Nom/Auteur/Type en double sous l'en-tête (§10) : la sous-page
    // Informations les porte désormais seule.
    if (!root || !path) return;

    this.renderProjectManuscriptSection(container, root);
    this.renderProjectMetadataSection(container);
    this.renderProjectInfoNavSection(container);
    this.renderProjectManagementSection(container, root);
  }

  /** MANUSCRIT : le dossier réellement résolu (lecture seule, comme avant)
   * + l'entrée de navigation vers la sous-page Objectifs. */
  private renderProjectManuscriptSection(container: HTMLElement, root: TFolder): void {
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.manuscriptHeader") });
    const row = section.createDiv({ cls: "feuillets-properties-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: t("sidebar.project.fieldFolder") });
    row.createSpan({ cls: "feuillets-properties-value", text: root.name });
    this.renderProjectNavRow(section, "target", t("sidebar.project.rowGoals"), () => {
      this.projectPage = "goals";
      void this.render();
    });
  }

  /** MÉTADONNÉES : Correspondance des propriétés (mapping YAML, Phase D) +
   * Statuts/Labels/Tags. */
  private renderProjectMetadataSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.metadataHeader") });
    this.renderProjectNavRow(section, "arrow-left-right", t("sidebar.project.rowMapping"), () => {
      this.projectPage = "mapping";
      void this.render();
    });
    this.renderProjectNavRow(section, "circle-dot", t("sidebar.project.rowStatuses"), () => {
      this.projectPage = "statuses";
      void this.render();
    });
    this.renderProjectNavRow(section, "tag", t("sidebar.project.rowLabels"), () => {
      this.projectPage = "labels";
      void this.render();
    });
    this.renderProjectNavRow(section, "hash", t("sidebar.project.rowTags"), () => {
      this.projectPage = "tags";
      void this.render();
    });
  }

  /** INFORMATIONS : une seule entrée de navigation vers la fiche complète
   * (nom/auteur/type/description/icône), qui remplace l'ancien affichage
   * en lecture seule directement sous l'en-tête (§10). */
  private renderProjectInfoNavSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.infoHeader") });
    this.renderProjectNavRow(section, "info", t("sidebar.project.rowInfo"), () => {
      this.projectPage = "info";
      void this.render();
    });
  }

  /** GESTION : révéler le dossier projet dans l'Explorateur natif (action
   * directe, même patron que revealFolderInFileExplorer/annexes-panel.ts —
   * dupliqué plutôt que partagé, convention du dépôt) + l'accès existant à
   * ManageProjectsModal, inchangé. Aucune opération avancée (duplication,
   * suppression…) n'est dupliquée ici : elle reste dans la modale (§11). */
  private renderProjectManagementSection(container: HTMLElement, root: TFolder): void {
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.manageHeader") });
    this.renderProjectNavRow(section, "folder-open", t("sidebar.project.reveal"), () => {
      if (!revealFolderInFileExplorer(this.app, root)) new Notice(t("sidebar.project.revealUnavailable"));
    }, false);
    this.renderProjectNavRow(section, "folder-cog", t("sidebar.project.manage"), () =>
      new ManageProjectsModal(this.app, this.plugin).open()
    );
  }

  /** Ligne de navigation compacte, réutilisée par toutes les sections du
   * sommaire Projet (icône + libellé + chevron optionnel) — même gabarit
   * visuel que `.feuillets-notes-section-head.feuillets-clickable`, déjà
   * utilisé pour « Gérer les projets » avant ce chantier. */
  private renderProjectNavRow(section: HTMLElement, icon: string, label: string, onClick: () => void, showChevron = true): void {
    const row = section.createDiv({ cls: "feuillets-notes-section-head feuillets-clickable" });
    const iconSpan = row.createSpan({ cls: "feuillets-notes-section-icon" });
    setIcon(iconSpan, icon);
    row.createSpan({ cls: "feuillets-notes-section-title", text: label });
    if (showChevron) {
      const chevron = row.createSpan({ cls: "feuillets-notes-section-icon" });
      chevron.setAttr("style", "margin-left: auto;");
      setIcon(chevron, "chevron-right");
    }
    row.addEventListener("click", onClick);
  }

  /** Répartiteur des sous-pages du panneau Projet. Sans projet actif (cas
   * limite : bascule de projet pendant qu'une sous-page est affichée), on
   * revient silencieusement à l'accueil plutôt que d'afficher une page
   * vide ou de lever une exception. */
  private renderProjectSubPage(page: ProjectPage, element: HTMLElement): void {
    const S = this.plugin.settings;
    const path = S.projectFolder;
    const root = this.plugin.getProjectFolder();
    if (!root || !path) {
      this.projectPage = "home";
      void this.render();
      return;
    }
    switch (page) {
      case "info": this.renderProjectInfoPage(element, path); break;
      case "goals": this.renderProjectGoalsPage(element, path); break;
      case "statuses": this.renderProjectStatusesPage(element, path); break;
      case "labels": this.renderProjectLabelsPage(element, path); break;
      case "tags": this.renderProjectTagsPage(element, path); break;
      case "mapping": this.renderProjectMappingPage(element, path, root); break;
    }
  }

  /** Sous-page « Informations du projet » (§10) : reprend EXACTEMENT les
   * champs et la cible d'écriture (`settings.projectMeta[path]`) de
   * ManageProjectsModal — aucun second éditeur de métadonnées, juste un
   * second point d'entrée déjà annoncé par le sommaire. Style de citation
   * uniquement en non-fiction, comme l'ancien Paramètres → Projet. */
  private renderProjectInfoPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const meta = S.projectMeta[path] || {};
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.infoHeader") });

    new Setting(section).setName(t("modal.manageProjects.nameField")).addText((t2) =>
      t2.setPlaceholder(this.plugin.projectDisplayName(path)).setValue(meta.name || "").onChange((v) => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].name = v.trim();
        void this.plugin.saveSettings();
        this.plugin.renderAllViews(true);
      })
    );
    new Setting(section).setName(t("modal.manageProjects.authorField")).addText((t2) =>
      t2.setPlaceholder(t("modal.manageProjects.authorPlaceholder")).setValue(meta.author || "").onChange((v) => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].author = v.trim();
        void this.plugin.saveSettings();
        this.plugin.renderAllViews(true);
      })
    );
    new Setting(section).setName(t("modal.manageProjects.iconField")).addText((t2) =>
      t2.setPlaceholder(t("modal.manageProjects.iconPlaceholder")).setValue(meta.icon || "").onChange((v) => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].icon = v.trim();
        void this.plugin.saveSettings();
        this.plugin.renderAllViews(true);
      })
    );
    new Setting(section).setName(t("modal.manageProjects.typeField")).addDropdown((d) => {
      for (const [key, mode] of Object.entries(PROJECT_MODES)) d.addOption(key, mode.label);
      d.setValue(resolveType(meta.type)).onChange((v) => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].type = v;
        void this.plugin.saveSettings();
        void this.render();
      });
    });
    if (resolveType(meta.type) === "nonfiction") {
      new Setting(section)
        .setName(t("settings.citationStyle.name"))
        .setDesc(t("settings.citationStyle.desc"))
        .addDropdown((d) =>
          d
            .addOption("footnote", t("settings.citationStyle.footnote"))
            .addOption("parenthetical", t("settings.citationStyle.parenthetical"))
            .setValue(meta.citationStyle || "footnote")
            .onChange((v) => {
              if (!S.projectMeta[path]) S.projectMeta[path] = {};
              S.projectMeta[path].citationStyle = v;
              void this.plugin.saveSettings();
            })
        );
    }
    new Setting(section).setName(t("modal.manageProjects.descriptionField")).addTextArea((t2) =>
      t2.setValue(meta.description || "").onChange((v) => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].description = v.trim();
        void this.plugin.saveSettings();
      })
    );
  }

  /** Sous-page « Objectifs » (§9) : les cinq réglages historiques de
   * Paramètres → Projet, désormais surchargeables par projet — même valeur
   * EFFECTIVE que partout ailleurs (resolvers services/project-settings.ts).
   * Chaque champ affiche un bouton de réinitialisation UNIQUEMENT quand une
   * surcharge existe déjà pour CE projet (exigence de sécurité additionnelle
   * #4 du plan : jamais de copie de la valeur globale, seulement `delete`). */
  private renderProjectGoalsPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowGoals") });

    const meta = (): ProjectMeta | undefined => S.projectMeta[path];
    const ensureMeta = (): ProjectMeta => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      return S.projectMeta[path];
    };
    const addReset = (setting: Setting, onReset: () => void): void => {
      setting.addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("sidebar.project.resetToGlobal")).onClick(() => {
          onReset();
          void this.plugin.saveSettings();
          void this.render();
        })
      );
    };
    const numberRow = (
      label: string, desc: string | undefined,
      getValue: () => number, setValue: (n: number) => void,
      hasOverride: () => boolean, reset: () => void,
    ): void => {
      const setting = new Setting(section).setName(label);
      if (desc) setting.setDesc(desc);
      setting.addText((t2) =>
        t2.setValue(String(getValue())).onChange((v) => {
          const n = parseInt(v, 10);
          setValue(isNaN(n) ? 0 : Math.max(0, n));
          void this.plugin.saveSettings();
        })
      );
      if (hasOverride()) addReset(setting, reset);
    };

    numberRow(
      t("settings.wordGoal.name"), undefined,
      () => projectWordGoalDefault(this.app, S),
      (n) => { ensureMeta().wordGoal = n; },
      () => typeof meta()?.wordGoal === "number",
      () => { delete meta()!.wordGoal; },
    );
    numberRow(
      t("settings.tolerance.name"), undefined,
      () => projectTolerance(this.app, S),
      (n) => { ensureMeta().tolerance = n; },
      () => typeof meta()?.tolerance === "number",
      () => { delete meta()!.tolerance; },
    );
    numberRow(
      t("settings.projectWordGoal.name"), undefined,
      () => projectTotalWordGoal(this.app, S),
      (n) => { ensureMeta().projectWordGoal = n; },
      () => typeof meta()?.projectWordGoal === "number",
      () => { delete meta()!.projectWordGoal; },
    );
    numberRow(
      t("settings.sessionGoal.name"), undefined,
      () => projectSessionGoal(this.app, S),
      (n) => { ensureMeta().sessionGoal = n; },
      () => typeof meta()?.sessionGoal === "number",
      () => { delete meta()!.sessionGoal; },
    );

    // Date limite : texte libre AAAA-MM-JJ, pas un champ numérique — même
    // patron que l'ancien Paramètres → Projet.
    const deadlineSetting = new Setting(section)
      .setName(t("settings.deadline.name"));
    deadlineSetting.addText((t2) =>
      t2.setPlaceholder("AAAA-MM-JJ").setValue(projectDeadline(this.app, S)).onChange((v) => {
        ensureMeta().deadlineDate = v.trim();
        void this.plugin.saveSettings();
      })
    );
    if (typeof meta()?.deadlineDate === "string") {
      addReset(deadlineSetting, () => { delete meta()!.deadlineDate; });
    }
  }

  /** Sous-page « Statuts » (§6) : clone-on-first-edit — lire n'écrit jamais.
   * Tant qu'aucune modification réelle n'a eu lieu, la liste affichée EST
   * `settings.statuses` (repli global, via le resolver centralisé) ; le
   * premier changement clone cette liste dans `ProjectMeta.statuses`, qui
   * seul est ensuite modifié — jamais le tableau global. */
  private renderProjectStatusesPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowStatuses") });

    const hasOverride = Array.isArray(S.projectMeta[path]?.statuses);
    const list = hasOverride ? S.projectMeta[path].statuses! : projectStatuses(this.app, S);
    const ensureOverride = (): ProjectStatusEntry[] => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      const meta = S.projectMeta[path];
      if (!meta.statuses) meta.statuses = JSON.parse(JSON.stringify(projectStatuses(this.app, S))) as ProjectStatusEntry[];
      return meta.statuses;
    };

    list.forEach((st, i) => {
      new Setting(section)
        .setName(String(i + 1))
        .addText((t2) =>
          t2.setValue(st.name || "").onChange((v) => {
            const arr = ensureOverride();
            arr[i].name = v.trim() || t("settings.statuses.item", { n: String(i + 1) });
            void this.plugin.saveSettings();
          })
        )
        .addColorPicker((c) =>
          c.setValue(st.color || "#888888").onChange((v) => {
            const arr = ensureOverride();
            arr[i].color = v;
            void this.plugin.saveSettings();
          })
        )
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip(t("settings.statuses.deleteTooltip")).onClick(() => {
            const arr = ensureOverride();
            arr.splice(i, 1);
            void this.plugin.saveSettings();
            void this.render();
          })
        );
    });

    new Setting(section).addButton((b) =>
      b.setButtonText(t("settings.statuses.add")).onClick(() => {
        const arr = ensureOverride();
        arr.push({ name: t("settings.statuses.item", { n: String(arr.length + 1) }), color: "#888888" });
        void this.plugin.saveSettings();
        void this.render();
      })
    );

    if (hasOverride) {
      new Setting(section).setName(t("sidebar.project.resetToGlobal")).addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("sidebar.project.resetToGlobal")).onClick(() => {
          delete S.projectMeta[path]?.statuses;
          void this.plugin.saveSettings();
          void this.render();
        })
      );
    }
  }

  /** Sous-page « Labels » (§7) : administration déplacée depuis l'ancien
   * Paramètres → Projet, MÊME comportement (nom/couleur/ajouter/supprimer),
   * même clone-on-first-edit que les statuts — aucun second système de
   * labels créé. */
  private renderProjectLabelsPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowLabels") });

    const hasOverride = Array.isArray(S.projectMeta[path]?.labels);
    const list = hasOverride ? S.projectMeta[path].labels! : (S.labels || []);
    const ensureOverride = (): Label[] => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      const meta = S.projectMeta[path];
      if (!meta.labels) meta.labels = JSON.parse(JSON.stringify(S.labels || [])) as Label[];
      return meta.labels;
    };

    list.forEach((l, i) => {
      new Setting(section)
        .setName(String(i + 1))
        .addText((t2) =>
          t2.setValue(l.name).onChange((v) => {
            const arr = ensureOverride();
            arr[i].name = v.trim() || t("settings.labels.item", { n: String(i + 1) });
            void this.plugin.saveSettings();
          })
        )
        .addColorPicker((c) =>
          c.setValue(l.color).onChange((v) => {
            const arr = ensureOverride();
            arr[i].color = v;
            void this.plugin.saveSettings();
          })
        )
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip(t("settings.labels.deleteTooltip")).onClick(() => {
            const arr = ensureOverride();
            arr.splice(i, 1);
            void this.plugin.saveSettings();
            void this.render();
          })
        );
    });

    new Setting(section).addButton((b) =>
      b.setButtonText(t("settings.labels.add")).onClick(() => {
        const arr = ensureOverride();
        arr.push({ name: t("settings.labels.item", { n: String(arr.length + 1) }), color: "#888888" });
        void this.plugin.saveSettings();
        void this.render();
      })
    );

    if (hasOverride) {
      new Setting(section).setName(t("sidebar.project.resetToGlobal")).addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("sidebar.project.resetToGlobal")).onClick(() => {
          delete S.projectMeta[path]?.labels;
          void this.plugin.saveSettings();
          void this.render();
        })
      );
    }
  }

  /** Sous-page « Tags » (§8) : administre UNIQUEMENT les tags favoris
   * proposés par Feuillets — jamais les tags Obsidian eux-mêmes, jamais de
   * second système de tags (voir services/frontmatter.ts tagsOf, inchangé). */
  private renderProjectTagsPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowTags") });

    const hasOverride = Array.isArray(S.projectMeta[path]?.favoriteTags);
    const setting = new Setting(section)
      .setName(t("settings.favoriteTags.name"))
      .addTextArea((t2) =>
        t2.setPlaceholder(t("settings.favoriteTags.placeholder")).setValue(projectFavoriteTags(this.app, S).join(", ")).onChange((v) => {
          if (!S.projectMeta[path]) S.projectMeta[path] = {};
          S.projectMeta[path].favoriteTags = [
            ...new Set(v.split(/[,\n]+/).map((x) => x.replace(/^#/, "").trim()).filter(Boolean)),
          ];
          void this.plugin.saveSettings();
        })
      );
    if (hasOverride) {
      setting.addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip(t("sidebar.project.resetToGlobal")).onClick(() => {
          delete S.projectMeta[path]?.favoriteTags;
          void this.plugin.saveSettings();
          void this.render();
        })
      );
    }
  }

  /** Sous-page « Correspondance des propriétés » (§21-24 du chantier
   * « mapping YAML »). Aucun fichier Markdown n'est jamais modifié ici —
   * uniquement `meta.propertyMap`, voir applyMapping(). */
  private renderProjectMappingPage(container: HTMLElement, path: string, root: TFolder): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.rowMapping") });
    section.createDiv({ cls: "feuillets-notes-sub" }).setText(t("sidebar.project.mappingIntro"));

    // §22 : scan des propriétés RAW du manuscrit actif, à l'ouverture de
    // CETTE sous-page seulement — jamais au démarrage du plugin, jamais
    // tout le Vault.
    const rawKeys = this.collectRawFrontmatterKeys(root);
    const propertyMap = S.projectMeta[path]?.propertyMap || {};

    for (const field of MAPPABLE_FIELDS) {
      const current = propertyMap[field];
      const row = section.createDiv({ cls: "feuillets-notes-section-head feuillets-clickable" });
      row.createSpan({ cls: "feuillets-notes-section-title", text: mappingFieldLabel(field) });
      const valueSpan = row.createSpan({ cls: "feuillets-properties-value" });
      valueSpan.setAttr("style", "margin-left: auto;");
      valueSpan.setText(current || field);
      const chevron = row.createSpan({ cls: "feuillets-notes-section-icon" });
      setIcon(chevron, "chevron-down");
      row.addEventListener("click", (event) => this.showMappingMenu(event, path, field, current, rawKeys));
    }
  }

  /** Propriétés RAW dédupliquées, triées naturellement, des seuls fichiers
   * Markdown du projet actif (§22 : jamais un scan Vault entier). */
  private collectRawFrontmatterKeys(root: TFolder): string[] {
    const files = this.plugin.flattenFiles(root).filter((f) => f.extension === "md");
    const keys = new Set<string>();
    for (const f of files) {
      for (const key of Object.keys(rawFrontmatterOf(this.app, f))) keys.add(key);
    }
    return [...keys].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  }

  /** Menu Obsidian NATIF (§21) : « Propriété Feuillets par défaut — <champ> »
   * puis séparateur puis les propriétés RAW détectées. */
  private showMappingMenu(
    event: MouseEvent, path: string, field: MappableFrontmatterField,
    current: string | undefined, rawKeys: string[],
  ): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("sidebar.project.mappingDefault", { field: mappingFieldLabel(field) }))
        .setChecked(!current)
        .onClick(() => this.applyMapping(path, field, undefined))
    );
    if (rawKeys.length) menu.addSeparator();
    for (const key of rawKeys) {
      menu.addItem((item) =>
        item.setTitle(key).setChecked(current === key).onClick(() => this.applyMapping(path, field, key))
      );
    }
    menu.showAtMouseEvent(event);
  }

  /** §23 : écrit UNIQUEMENT `meta.propertyMap[field]` (ou le supprime,
   * §23 second cas) — jamais un fichier Markdown. §24 : refuse une
   * collision silencieuse (deux champs logiques → même propriété RAW). */
  private applyMapping(path: string, field: MappableFrontmatterField, target: string | undefined): void {
    const S = this.plugin.settings;
    if (!S.projectMeta[path]) S.projectMeta[path] = {};
    const meta = S.projectMeta[path];
    if (!target) {
      if (meta.propertyMap) {
        delete meta.propertyMap[field];
        if (Object.keys(meta.propertyMap).length === 0) delete meta.propertyMap;
      }
    } else {
      const map = meta.propertyMap || {};
      const collisionField = (Object.keys(map) as MappableFrontmatterField[]).find(
        (f) => f !== field && map[f] === target
      );
      if (collisionField) {
        new Notice(t("sidebar.project.mappingCollision", { target, field: mappingFieldLabel(collisionField) }));
        return;
      }
      if (!meta.propertyMap) meta.propertyMap = {};
      meta.propertyMap[field] = target;
    }
    void this.plugin.saveSettings();
    this.plugin.renderAllViews(true);
    void this.render();
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
    // Exigence de sécurité additionnelle #3 (chantier « panneau Projet ») :
    // jamais d'état résiduel d'un projet précédent — un changement de
    // projet depuis une sous-page ramène toujours à l'accueil du nouveau.
    this.projectPage = "home";
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
