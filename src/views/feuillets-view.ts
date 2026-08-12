import { VIEW_SIDEBAR, getProjectStatuses } from "../constants.js";
import { hasKnownProject } from "../services/folder-structure.js";
import { foldAccents, stripMarkdown } from "../utils/core.js";
import { highlightActive, isEditing, getActiveFileSafe, openFileActivating } from "../utils/dom.js";
import { ImportOutlineModal } from "../ui/import-outline-modal.js";
import { ManageProjectsModal, NewProjectModal, OpenExistingFolderModal, DuplicateVersionModal } from "../ui/project-modals.js";
import { ScrivenerImportModal } from "../ui/scrivener-import-modal.js";
import { CompareFilesModal, PickFileModal } from "../ui/diff-modal.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { t } from "../i18n/index.js";
import { openScopeWithPreview } from "./preview-view.js";
import { createProjectScope } from "../services/compile-scope.js";
import { Menu, TFile, TFolder, setIcon, Notice, normalizePath, type TAbstractFile } from "obsidian";
import { toValue } from "../utils/scene-fields.js";

type ProjectNode = TFile | TFolder;

/** Narrowing sans cast direct pour obsidianmd/no-tfile-tfolder-cast — voir
 * base-feuillets-view.ts pour le même patron. Le throw n'est jamais atteint
 * ici : `selected` est toujours ramené à un TFolder avant cet appel. */
function asFolder(af: TAbstractFile | null): TFolder {
  if (!(af instanceof TFolder)) throw new Error(`Expected a folder: ${af ? af.path : "null"}`);
  return af;
}

type RenderFileRowOpts = { showPreview?: boolean };
type RenderFileRow = (
  host: HTMLElement,
  file: TFile,
  parent: ProjectNode,
  i: number,
  siblings: ProjectNode[],
  depth: number,
  dragScopeEl: HTMLElement,
  opts?: RenderFileRowOpts
) => boolean;

type SplitBodyCtx = {
  S: FeuilletsSettings;
  binderFilterActive: boolean;
  folderHasMatch: (f: TFolder) => boolean;
  renderFileRow: RenderFileRow;
  /** Vraie racine du projet, distincte de `root` (la racine de travail
   * passée à renderHierarchyBody) dès qu'un dossier est isolé — voir
   * FeuilletsView._binderWorkingRootPath. Sert à l'en-tête d'isolation et
   * au menu contextuel de la ligne racine. */
  projectRoot: TFolder;
  /** Densité EFFECTIVE déjà résolue par render() (override de session du
   * dossier isolé, sinon settings.binderCompact) — voir
   * FeuilletsView.getEffectiveBinderCompact. Ne JAMAIS relire
   * S.binderCompact directement ici pour cette décision. */
  binderCompact: boolean;
};

/* _binderMultiSelect est attaché dynamiquement au plugin par
   base-feuillets-view.js (this.plugin._binderMultiSelect = new Set()) —
   absent de la classe FeuilletsPlugin elle-même (main.js), donc pas
   inférable depuis son propre type. */
type FeuilletsViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1] & {
  _binderMultiSelect?: Set<string>;
};

/* app.setting (panneau de réglages) est une API interne d'Obsidian, non
   déclarée dans obsidian.d.ts. */
type AppWithSettingTab = {
  setting: { open(): void; openTabById(id: string): void };
};

export class FeuilletsView extends BaseFeuilletsView {
  declare plugin: FeuilletsViewPlugin;
  declare targetContainer?: HTMLElement;
  declare iconBtn: (
    parent: HTMLElement,
    icon: string,
    tooltip?: string,
    onClick?: (e: MouseEvent) => void | Promise<void>
  ) => HTMLElement;
  _renderGen?: number;
  _binderSearchOpen?: boolean;
  _suppressSearchBlurClose?: boolean;
  /** Racine de travail isolée temporairement dans le Binder (chantier
   * « isoler un dossier ») : état de SESSION uniquement — jamais enregistré
   * dans settings, jamais lu/écrit ailleurs, ne touche jamais
   * settings.projectFolder ni le vrai dossier projet. Disparaît au
   * redémarrage d'Obsidian ou dès que ce chemin ne pointe plus vers un
   * dossier du projet actif (voir getBinderWorkingRoot). */
  _binderWorkingRootPath?: string;
  /** Densité (compact/standard) propre à une racine de travail isolée,
   * pour la durée de la SESSION uniquement — jamais dans settings, jamais
   * de nouvelle clé DEFAULT_SETTINGS, jamais de système de workspace par
   * dossier. Indexée par chemin de dossier isolé ; un dossier sans entrée
   * ici suit `settings.binderCompact` (voir getEffectiveBinderCompact). */
  _binderCompactOverrides?: Map<string, boolean>;

  /** Racine à afficher dans le Binder : le dossier isolé s'il existe
   * encore et appartient toujours au projet actif, sinon la racine réelle
   * du projet. Ne modifie jamais `projectRoot` ni les réglages — se
   * contente de réinitialiser l'isolation devenue invalide (dossier
   * supprimé/déplacé hors projet, ou changement de projet actif). */
  getBinderWorkingRoot(projectRoot: TFolder | null): TFolder | null {
    if (!projectRoot) return null;
    if (!this._binderWorkingRootPath) return projectRoot;
    const candidate = this.app.vault.getAbstractFileByPath(this._binderWorkingRootPath);
    const inScope =
      candidate instanceof TFolder &&
      (candidate.path === projectRoot.path || candidate.path.startsWith(projectRoot.path + "/"));
    if (!inScope) {
      this._binderWorkingRootPath = undefined;
      return projectRoot;
    }
    return candidate;
  }

  /** Mécanisme d'isolation UNIQUE (chantier "isoler un dossier" +
   * micro-chantier "double-clic pour isoler") : bascule
   * _binderWorkingRootPath et redemande un rendu. Appelé aussi bien par le
   * menu contextuel (binderIsolateExtras) que par le double-clic sur le nom
   * d'un dossier (renderTreeFolders) — jamais dupliqué. Ne déplace, ne
   * renomme, ne modifie aucun fichier. `resetScroll: true` : on entre dans
   * une branche différente, la position de défilement de l'ancienne vue n'a
   * plus de sens ici — la nouvelle racine s'affiche depuis son début plutôt
   * que de conserver un décalage de pixels devenu arbitraire (voir render,
   * _resetScroll). */
  isolateFolder(folder: TFolder): void {
    this._binderWorkingRootPath = folder.path;
    void this.render(true, { resetScroll: true });
  }

  /** Entrée « Isoler ce dossier » ajoutée au menu contextuel standard d'un
   * dossier (showFolderContextMenu, extraItems) — jamais un second menu. */
  binderIsolateExtras(folder: TFolder): (menu: Menu) => void {
    return (menu: Menu) => {
      menu.addItem((item) =>
        item
          .setTitle(t("binder.isolateFolder"))
          .setIcon("focus")
          .onClick(() => this.isolateFolder(folder))
      );
    };
  }

  /** Clé de l'éventuel override de densité de session : le chemin de la
   * racine de travail isolée si elle diffère de la vraie racine du projet,
   * sinon `null` (Binder normal — la densité suit `settings.binderCompact`
   * directement, sans jamais consulter la Map). */
  getBinderCompactScope(): string | null {
    const projectRoot = this.getProjectFolder();
    if (!projectRoot) return null;
    const workingRoot = this.getBinderWorkingRoot(projectRoot);
    return workingRoot && workingRoot.path !== projectRoot.path ? workingRoot.path : null;
  }

  /** Densité EFFECTIVE à appliquer au rendu : l'override de session du
   * dossier isolé s'il en a un, sinon `settings.binderCompact` — que ce
   * soit parce qu'aucun dossier n'est isolé, ou qu'il l'est mais n'a encore
   * aucun override (il « hérite » alors simplement de la valeur globale,
   * sans qu'aucune entrée ne soit créée dans la Map avant un premier
   * bascule — voir le bouton Densité dans render()). */
  getEffectiveBinderCompact(scopeKey: string | null): boolean {
    if (scopeKey && this._binderCompactOverrides?.has(scopeKey)) {
      return !!this._binderCompactOverrides.get(scopeKey);
    }
    return !!this.plugin.settings.binderCompact;
  }

  getViewType(): string {
    return VIEW_SIDEBAR;
  }

  getDisplayText(): string {
    return t("binder.displayText");
  }

  getIcon(): string {
    return "files";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateActiveHighlight();
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateActiveHighlight())
    );
    /* Flèches haut/bas = feuillet suivant/précédent (openNeighbor, déjà
       utilisé par les commandes "Feuillet suivant/précédent") — dès que le
       clavier est dans le Binder mais PAS dans un champ de saisie (barre de
       recherche, édition en ligne d'un tag/synopsis…), pour ne jamais voler
       une flèche destinée à déplacer un curseur de texte.
       Posé sur `window` en phase de CAPTURE plutôt que sur this.contentEl en
       bulles (comme avant) : des plugins basés sur React (ex. Notebook
       Navigator, confirmé dans son bundle) posent leurs propres écouteurs
       délégués en phase de capture sur leur conteneur — un écouteur en
       bulles sur notre seul contentEl peut alors ne jamais recevoir
       l'événement selon l'ordre de montage des panneaux. En capture sur
       `window`, on est servis avant n'importe quel écouteur plus bas dans
       l'arbre, quel que soit le plugin. On vérifie donc nous-mêmes que le
       focus est bien dans le Binder (e.target), puisqu'on ne peut plus
       compter sur le simple fait d'avoir été atteints par la bulle. */
    this.registerDomEvent(window, "keydown", async (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target as Node | null;
      if (!target || !this.contentEl.contains(target)) return;
      const tag = (target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      const next = await this.plugin.openNeighbor(e.key === "ArrowDown" ? 1 : -1, { focusEditor: false });
      /* openNeighbor parcourt tout le projet dans l'ordre du manuscrit, pas
         seulement le dossier affiché dans le volet fiches — sans faire
         suivre la sélection de dossier ici, une fiche voisine d'un AUTRE
         dossier que celui sélectionné n'existait nulle part dans le DOM
         rendu : aucune surbrillance, focus perdu, et le volet dossiers ne
         semblait jamais "changer" au clavier. */
      const S = this.plugin.settings;
      if (next && next.parent && next.parent.path !== S.binderSelectedPath) {
        S.binderSelectedPath = next.parent.path;
        await this.plugin.saveSettings();
        await this.render(true);
      }
      /* Reprend le focus sur la ligne devenue active pour que la flèche
         suivante continue à naviguer dans le Binder — sans ça, la 2e
         pression irait dans l'éditeur (focus jamais déplacé, mais resté
         sur l'ancienne ligne, plus "active"). Léger délai : l'événement
         "file-open" (qui pose is-active) n'a pas forcément fini avant que
         ce callback continue. */
      window.setTimeout(() => {
        this.contentEl.querySelector<HTMLElement>(".feuillets-item.is-active")?.focus();
      }, 60);
    }, { capture: true });
    await this.render();
  }

  updateActiveHighlight(): void {
    highlightActive(this.contentEl, getActiveFileSafe(this.app)?.path);
  }

  /** Anime le masquage/affichage du volet dossiers sans reconstruire tout
   * le binder — utilisée par le geste de balayage (main.js), qui ne
   * connaît que ce cycle à 2 états (voir registerSwipeGestures). Ne
   * touche pas les boutons de la barre d'actions (icône/tooltip figés
   * jusqu'au prochain vrai rendu), c'est un compromis assumé pour garder
   * le geste fluide. */
  toggleTreeCollapsedClasses(collapsed: boolean): void {
    const split = this.contentEl.querySelector(".feuillets-split");
    if (!split) return;
    const treePane = split.querySelector(".feuillets-tree-pane");
    const resizer = split.querySelector(".feuillets-split-resizer");
    split.toggleClass("is-tree-collapsed", collapsed);
    if (treePane) treePane.toggleClass("is-tree-collapsed", collapsed);
    if (resizer) resizer.toggleClass("is-tree-collapsed", collapsed);
    this.plugin.adjustSidebarWidth();
    window.setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
  }

  /** Version à 3 états (double volet / fiches seules / dossiers seuls) —
   * utilisée par le bouton dédié (voir render()), relit directement les
   * réglages plutôt que de recevoir un booléen, pour rester correcte quel
   * que soit l'état de départ. */
  applyPaneModeClasses(): void {
    const S = this.plugin.settings;
    const split = this.contentEl.querySelector(".feuillets-split");
    if (!split) return;
    const treePane = split.querySelector(".feuillets-tree-pane");
    const listPane = split.querySelector(".feuillets-list-pane");
    const resizer = split.querySelector(".feuillets-split-resizer");
    const treeCollapsed = !!S.binderTreeCollapsed;
    const listCollapsed = !treeCollapsed && !!S.binderListCollapsed;
    split.toggleClass("is-tree-collapsed", treeCollapsed);
    split.toggleClass("is-list-collapsed", listCollapsed);
    if (treePane) treePane.toggleClass("is-tree-collapsed", treeCollapsed);
    if (listPane) listPane.toggleClass("is-list-collapsed", listCollapsed);
    if (resizer) {
      resizer.toggleClass("is-tree-collapsed", treeCollapsed);
      resizer.toggleClass("is-list-collapsed", listCollapsed);
    }
    this.plugin.adjustSidebarWidth();
    /* Rejoué après un tick : leftSplit.setSize() (API interne, non
       documentée) semble parfois ignorer un appel fait dans la même
       passe qu'un changement de classes CSS sans reconstruction complète
       — probablement une histoire de mise en page pas encore recalculée
       par Obsidian à cet instant précis. Un second appel différé est un
       filet de sécurité peu coûteux. */
    window.setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
  }

  /** Réglages d'affichage (Affichage des lignes + accès aux réglages
   * complets) — ajoutés à la suite du contenu propre à showSplitPaneOptionsMenu
   * (densité, aperçu de la fiche), pas dans une icône réglages à part. */
  buildDisplayOptionsMenu(menu: Menu): void {
    const S = this.plugin.settings;

    const toggle = (title: string, key: string) =>
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setChecked(!!S[key])
          .onClick(async () => {
            S[key] = !S[key];
            await this.plugin.saveSettings();
            void this.render(true);
          })
      );

    menu.addItem((item) => item.setTitle(t("binder.display.header")).setDisabled(true));
    toggle(t("binder.display.labelStripes"), "binderShowLabels");
    toggle(t("binder.display.tagChips"), "binderShowTags");
    toggle(t("binder.display.statusDot"), "binderShowStatus");
    toggle(t("binder.display.progressBars"), "binderShowProgress");
    toggle(t("binder.display.wordCountNumbers"), "binderShowWords");
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle(t("binder.display.moreOptions"))
        .setIcon("settings")
        .onClick(() => {
          const app = this.app as unknown as AppWithSettingTab;
          app.setting.open();
          app.setting.openTabById(this.plugin.manifest.id);
        })
    );
  }

  /** Menu du clic droit sur l'icône "Double volet" : quel champ prévisualiser
   * dans le volet fichiers, puis l'Affichage transversal (voir
   * buildDisplayOptionsMenu). Le choix des volets visibles (double/dossiers
   * seuls/fichiers seuls) vit désormais dans des boutons directs de la barre
   * d'actions (voir render()), plus dans ce menu. */
  currentSplitMode(): "files" | "folders" | "both" {
    const S = this.plugin.settings;
    return S.binderTreeCollapsed ? "files" : S.binderListCollapsed ? "folders" : "both";
  }

  /** Bascule le double volet sur "both"/"folders"/"files" — utilisée par le
   * menu du clic droit ET par les boutons directs de la barre d'actions
   * (voir render()). Passe en double volet si on n'y était pas encore. */
  async applySplitPaneMode(mode: "files" | "folders" | "both"): Promise<void> {
    const S = this.plugin.settings;
    S.binderLayout = "split";
    S.binderTreeCollapsed = mode === "files";
    S.binderListCollapsed = mode === "folders";
    await this.plugin.saveSettings();
    void this.render(true);
    this.plugin.adjustSidebarWidth();
    window.setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
  }

  showSplitPaneOptionsMenu(e: MouseEvent): void {
    const S = this.plugin.settings;
    const effectiveBinderCompact = this.getEffectiveBinderCompact(this.getBinderCompactScope());
    const menu = new Menu();

    /* Pas de choix de densité ici : bascule directe sur le bouton Densité
       lui-même (un clic), inutile de la dupliquer dans ce menu. */
    menu.addItem((item) => item.setTitle(t("binder.preview.header")).setDisabled(true));
    const previewFields: [string, string][] = [
      ["none", t("binder.preview.none")],
      ["extrait", t("binder.preview.excerpt")],
      ["synopsis", t("binder.preview.synopsis")],
      ["summary", t("binder.preview.summary")],
      ["notes", t("binder.preview.notes")],
      ["tags", t("binder.preview.tags")],
    ];
    for (const [key, label] of previewFields) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked((S.listPanePreviewField || "none") === key)
          .onClick(async () => {
            S.listPanePreviewField = key;
            await this.plugin.saveSettings();
            void this.render(true);
          })
      );
    }
    menu.addSeparator();

    if (!effectiveBinderCompact && S.listPanePreviewField !== "none") {
      menu.addItem((item) => item.setTitle(t("binder.preview.linesHeader")).setDisabled(true));
      for (let n = 1; n <= 6; n++) {
        menu.addItem((item) =>
          item
            .setTitle(String(n))
            .setChecked((S.listPanePreviewLines || 2) === n)
            .onClick(async () => {
              S.listPanePreviewLines = n;
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }
      menu.addSeparator();
    }

    this.buildDisplayOptionsMenu(menu);
    menu.showAtMouseEvent(e);
  }

  /** `resetScroll: true` (voir isolateFolder) : n'essaie pas de restaurer la
   * position de défilement d'AVANT ce rendu — sur un changement de branche
   * (isolation), ce décalage en pixels ne correspond plus à rien de sensé
   * dans la nouvelle liste ; on affiche son tout début à la place. Par
   * défaut (repli/dépli, simple clic, rafraîchissement de fond…), la
   * position actuelle est toujours conservée — voir _captureScroll/
   * _restoreScroll. */
  async render(force = false, opts: { resetScroll?: boolean } = {}): Promise<void> {
    const container = this.contentEl;
    if (!force && isEditing(container)) return;
    /* Position de défilement mémorisée AVANT de vider le DOM, restaurée en
       fin de reconstruction : un rafraîchissement de fond (modification dans
       le coffre, changement de fichier actif…) reconstruit tout le binder et
       renvoyait sinon la liste tout en haut alors qu'on lisait plus bas. */
    const savedScroll = opts.resetScroll ? [] : this._captureScroll();
    const myGen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-container");

    const folder = this.getProjectFolder();
    const S = this.plugin.settings;
    /* Racine de travail (projet complet, ou dossier isolé — voir
       _binderWorkingRootPath) calculée UNE SEULE FOIS ici et réutilisée
       plus bas pour renderHierarchyBody : getBinderWorkingRoot a un effet
       de bord (réinitialise l'isolation devenue invalide), la rappeler
       plusieurs fois par rendu serait inutilement redondant. */
    const workingRoot = folder ? (this.getBinderWorkingRoot(folder) || folder) : null;
    const binderCompactScope = folder && workingRoot && workingRoot.path !== folder.path ? workingRoot.path : null;
    const effectiveBinderCompact = this.getEffectiveBinderCompact(binderCompactScope);
    /* Isolé dès que binderCompactScope est renseigné (racine de travail
       différente de la vraie racine du projet) — réutilisé plus bas pour
       l'indentation des feuillets (voir renderFileRow) : légèrement plus
       marquée dans la vue PRINCIPALE seulement, jamais en vue isolée, sans
       toucher à l'indentation des dossiers ni à la profondeur réelle. */
    const isIsolatedView = !!binderCompactScope;

    const header = container.createDiv({ cls: "feuillets-header" });
    const actions = header.createDiv({ cls: "feuillets-actions" });
    this.iconBtn(actions, "folder-cog", t("binder.manageProjects"), () => {
      new ManageProjectsModal(this.app, this.plugin).open();
    });
    this.barSep(actions);
    this.iconBtn(actions, "notebook", "Carnet", () =>
      this.plugin.generateCanvasBoard()
    );
    this.barSep(actions);
    this.iconBtn(actions, "layout-grid", t("binder.boardPlan"), () =>
      this.plugin.activateBoard()
    );
    this.barSep(actions);
    /* Pas de "Mode concentration" ici : déjà une icône de ruban permanente
       (non masquable, voir registerRibbonIcons) et une commande de
       palette — la répéter dans le binder n'ajoute aucun accès réel.
       Ordre voulu : Double volet + son choix dossiers/fichiers groupés
       ensemble, puis Densité, puis Recherche/Filtres — plus d'icône
       réglages à part : "Double volet" répond au clic droit
       (showSplitPaneOptionsMenu : densité, aperçu de la fiche, affichage
       transversal). */
    const densityBtn = this.iconBtn(actions, "rows-3", t("binder.density.tooltip", { mode: effectiveBinderCompact ? t("binder.density.compact") : t("binder.density.standard") }), async () => {
      /* Isolé : bascule un override de SESSION propre à cette racine de
         travail (jamais settings.binderCompact, jamais persisté) — le
         Binder normal et les autres dossiers isolés restent inchangés.
         Non isolé : comportement actuel exact, settings.binderCompact. */
      if (binderCompactScope) {
        if (!this._binderCompactOverrides) this._binderCompactOverrides = new Map();
        this._binderCompactOverrides.set(binderCompactScope, !effectiveBinderCompact);
        void this.render(true);
      } else {
        S.binderCompact = !S.binderCompact;
        await this.plugin.saveSettings();
        void this.render(true);
      }
    });
    if (effectiveBinderCompact) densityBtn.addClass("feuillets-mode-active");
    densityBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showSplitPaneOptionsMenu(e);
    });

    /* Pas de bouton "+" global dans la barre d'actions : en vue double
       volet, l'ajout se fait directement dans chaque volet (le "+" à côté
       du nom du dossier projet dans le volet gauche crée un dossier, le
       "+" du volet fichiers crée un feuillet dans le dossier sélectionné
       — voir renderSplitBody). En vue arbre, chaque ligne de dossier a son
       propre "+" pour créer un sous-dossier/feuillet à l'intérieur (voir
       renderLevel plus bas). "Importer un plan…" reste accessible via la
       palette de commandes et via le "+" racine du volet dossiers. */
    if (!folder) {
      /* Écran d'accueil (titre + 3 actions) seulement au tout premier
         lancement — aucun projet n'a jamais été créé ni ajouté. Dès qu'un
         SEUL projet est connu (même si on vient d'en désactiver un), le
         gestionnaire de projets (liste + hub) reste plus utile : "premier
         projet" ne voudrait plus rien dire. */
      if (hasKnownProject(S)) {
        this.renderProjectManagerSplitView(container, S);
      } else {
        this.renderOnboarding(container);
      }
      return;
    }

    this.barSep(header);
    const filterBar = header.createDiv({ cls: "feuillets-binder-filters" });

    const searchIsOpen =
      this._binderSearchOpen || !!(S.binderSearch || "").trim();
    const searchBtn = this.iconBtn(filterBar, "search", t("binder.search.tooltip"));
    searchBtn.addEventListener("click", () => {
      this._binderSearchOpen = !this._binderSearchOpen;
      if (!this._binderSearchOpen) {
        S.binderSearch = "";
        void this.plugin.saveSettings().then(() => { void this.render(true); });
      } else {
        void this.render(true);
        window.setTimeout(() => {
          this.contentEl.querySelector<HTMLElement>(".feuillets-binder-search")?.focus();
        }, 50);
      }
    });
    if (searchIsOpen) searchBtn.addClass("feuillets-mode-active");

    /* Filtres combinés (ET logique) : statut × label × progression —
       même patron que le menu "Filtres" du Tableau/plan (board-view.js),
       propres au binder (réglages binderStatusFilter/binderLabelFilter/
       binderProgressFilter, indépendants de ceux du Tableau/plan). */
    const binderFilterIsActive = () =>
      !!((S.binderStatusFilter && S.binderStatusFilter !== "Tous") ||
      (S.binderLabelFilter && S.binderLabelFilter !== "Tous") ||
      (S.binderProgressFilter && S.binderProgressFilter !== "Tous"));

    const filterBtn = this.iconBtn(
      filterBar,
      binderFilterIsActive() ? "filter" : "list-filter",
      t("binder.filter.tooltip")
    );
    if (binderFilterIsActive()) filterBtn.addClass("feuillets-mode-active");
    const filterSentinelLabel = (v: string) =>
      v === "Tous" ? t("binder.filter.all")
      : v === "Sans statut" ? t("binder.filter.noStatus")
      : v === "Sans label" ? t("binder.filter.noLabel")
      : v === "Atteint" ? t("binder.filter.progressHit")
      : v === "En dessous" ? t("binder.filter.progressUnder")
      : v === "Dépassé" ? t("binder.filter.progressOver")
      : v;
    filterBtn.addEventListener("click", (e: MouseEvent) => {
      const menu = new Menu();

      menu.addItem((item) => item.setTitle(t("binder.filter.statusHeader")).setDisabled(true));
      for (const s of ["Tous", ...getProjectStatuses(S).filter(Boolean), "Sans statut"]) {
        menu.addItem((item) =>
          item
            .setTitle(filterSentinelLabel(s))
            .setChecked((S.binderStatusFilter || "Tous") === s)
            .onClick(async () => {
              S.binderStatusFilter = s;
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }
      menu.addSeparator();

      const activeLabels = new Set<string>();
      const walkLabels = (f: TFolder) => {
        for (const child of this.plugin.getOrderedChildren(f)) {
          if (child instanceof TFile) {
            for (const label of this.plugin.labelsOf(child)) activeLabels.add(label);
          } else if (child instanceof TFolder) {
            walkLabels(child);
          }
        }
      };
      if (folder) walkLabels(folder);
      const meta = folder && S.projectMeta ? S.projectMeta[folder.path] : null;
      const labelsList = (meta && meta.labels) ? meta.labels : (S.labels || []);
      labelsList.forEach((l) => {
        if (l.name) activeLabels.add(l.name);
      });
      const labelList = Array.from(activeLabels).sort((a, b) => a.localeCompare(b, "fr"));

      menu.addItem((item) => item.setTitle(t("binder.filter.labelHeader")).setDisabled(true));
      for (const lb of ["Tous", ...labelList, "Sans label"]) {
        menu.addItem((item) =>
          item
            .setTitle(filterSentinelLabel(lb))
            .setChecked((S.binderLabelFilter || "Tous") === lb)
            .onClick(async () => {
              S.binderLabelFilter = lb;
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }
      menu.addSeparator();

      menu.addItem((item) => item.setTitle(t("binder.filter.progressHeader")).setDisabled(true));
      for (const pr of ["Tous", "Atteint", "En dessous", "Dépassé"]) {
        menu.addItem((item) =>
          item
            .setTitle(filterSentinelLabel(pr))
            .setChecked((S.binderProgressFilter || "Tous") === pr)
            .onClick(async () => {
              S.binderProgressFilter = pr;
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }

      if (binderFilterIsActive()) {
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle(t("binder.filter.reset"))
            .setIcon("filter-x")
            .onClick(async () => {
              S.binderStatusFilter = "Tous";
              S.binderLabelFilter = "Tous";
              S.binderProgressFilter = "Tous";
              await this.plugin.saveSettings();
              void this.render(true);
            })
        );
      }
      menu.showAtMouseEvent(e);
    });

    if ((S.binderSearch || "").trim() || binderFilterIsActive()) {
      const resetBtn = this.iconBtn(
        filterBar,
        "x",
        t("binder.filter.resetSearchAndFilters")
      );
      resetBtn.addEventListener("click", () => {
        void (async () => {
          S.binderSearch = "";
          S.binderStatusFilter = "Tous";
          S.binderLabelFilter = "Tous";
          S.binderProgressFilter = "Tous";
          this._binderSearchOpen = false;
          await this.plugin.saveSettings();
          void this.render(true);
        })();
      });
    }

    /* Barre de recherche sur sa propre ligne, sous la barre d'icônes —
       plus lisible qu'un champ étriqué inséré entre les icônes. */
    if (searchIsOpen) {
      const searchRow = container.createDiv({ cls: "feuillets-binder-search-row" });
      const searchInput = searchRow.createEl("input", {
        type: "text",
        cls: "feuillets-binder-search",
        attr: { placeholder: t("binder.search.placeholder") },
      });
      searchInput.value = S.binderSearch || "";
      let searchTimer: number;
      searchInput.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        const caret = searchInput.selectionStart;
        searchTimer = window.setTimeout(() => {
          void (async () => {
            S.binderSearch = searchInput.value;
            await this.plugin.saveSettings();
            await this.render(true);
            const fresh = this.contentEl.querySelector<HTMLInputElement>(".feuillets-binder-search");
            if (fresh) {
              fresh.focus();
              fresh.setSelectionRange(caret, caret);
            }
          })();
        }, 200);
      });
      searchInput.addEventListener("blur", () => {
        /* Un blur peut venir d'un vrai clic ailleurs (fermeture voulue si
           champ vide) OU du fait que ce même champ vient d'être détruit par
           un render(true) déclenché par un AUTRE contrôle de cette ligne
           (ex. contentToggle ci-dessous) — retirer un élément focus du DOM
           déclenche un blur natif, même avec preventDefault sur mousedown.
           Le drapeau _suppressSearchBlurClose distingue ce second cas. */
        if (this._suppressSearchBlurClose) {
          this._suppressSearchBlurClose = false;
          return;
        }
        if (!searchInput.value.trim()) {
          this._binderSearchOpen = false;
          void this.render(true);
        }
      });

      /* Sélecteur de contexte : titre seul ou titre + contenu du texte
         (S.binderSearchContent existait déjà comme réglage caché, jamais
         exposé dans l'UI avant ce bouton). */
      const contentToggle = this.iconBtn(
        searchRow,
        S.binderSearchContent ? "file-search" : "file",
        S.binderSearchContent ? t("binder.search.contentToggle.on") : t("binder.search.contentToggle.off")
      );
      if (S.binderSearchContent) contentToggle.addClass("feuillets-mode-active");
      contentToggle.addEventListener("mousedown", (e: MouseEvent) => e.preventDefault());
      contentToggle.addEventListener("click", () => {
        void (async () => {
          this._suppressSearchBlurClose = true;
          S.binderSearchContent = !S.binderSearchContent;
          await this.plugin.saveSettings();
          void this.render(true);
        })();
      });
    }

    const searchTerm = foldAccents((S.binderSearch || "").trim());
    let contentIndex: Map<string, { text: string }> | null = null;
    if (searchTerm && S.binderSearchContent && folder) {
      contentIndex = await this.buildSearchIndex(
        this.plugin.flattenFiles(folder)
      );
      if (this._renderGen !== myGen) return;
    }

    const passesBinderFilter = (file: TFile): boolean => {
      const search = searchTerm;
      if (search) {
        const hay = foldAccents(
          `${this.plugin.titleFor(file)} ${this.plugin.shortTitleFor(file)} ${file.basename}`
        );
        let found = hay.includes(search);
        if (!found && contentIndex) {
          const entry = contentIndex.get(file.path);
          if (entry && entry.text.includes(search)) found = true;
        }
        if (!found) return false;
      }
      const sf = S.binderStatusFilter;
      if (sf && sf !== "Tous") {
        const st = toValue(this.fm(file).status);
        if (sf === "Sans statut" ? st !== "" : st !== sf) return false;
      }
      const lf = S.binderLabelFilter;
      if (lf && lf !== "Tous") {
        const labels = this.plugin.labelsOf(file);
        if (lf === "Sans label" ? labels.length !== 0 : !labels.includes(lf)) return false;
      }
      const pf = S.binderProgressFilter;
      if (pf && pf !== "Tous") {
        const entry = wcCache.get(file.path);
        const goal = this.goalFor(file);
        if (entry !== undefined && goal > 0) {
          const state = this.ringState(entry.wc, goal);
          if (pf === "Atteint" && state !== "hit") return false;
          if (pf === "En dessous" && state !== "under") return false;
          if (pf === "Dépassé" && state !== "over") return false;
        } else if (goal <= 0) {
          return false;
        }
      }
      return true;
    };

    const binderFilterActive =
      (S.binderSearch || "").trim() !== "" || binderFilterIsActive();

    const folderHasMatch = (f: TFolder): boolean => {
      for (const file of this.plugin.flattenFiles(f)) {
        if (passesBinderFilter(file)) return true;
      }
      return false;
    };

    const numbering = folder ? this.plugin.buildNumbering(folder) : new Map<string, string>();
    const allFiles = folder ? this.plugin.flattenFiles(folder) : [];
    const wcCache = await this.plugin.getWordCounts(allFiles);
    if (this._renderGen !== myGen) return;



    const renderFileRow: RenderFileRow = (
      host,
      file,
      parent,
      i,
      siblings,
      depth,
      dragScopeEl,
      opts = {}
    ) => {
      const hidden =
        file.name.startsWith("_") ||
        parent.name.startsWith("_") ||
        parent.path.includes("/_");
      if (!hidden && !passesBinderFilter(file)) return false;

      const role = hidden ? "cachee" : this.plugin.roleOfFile(file);
      const goal = this.goalFor(file);
      const item = host.createDiv({
        cls:
          role === "scene"
            ? "feuillets-item feuillets-scene"
            : role === "cachee"
            ? "feuillets-item feuillets-hidden"
            : "feuillets-item",
      });
      /* Retrait des feuillets par rapport à leur dossier parent : voir
         renderTreeFolders (paddingLeft du dossier = 6 + depth * 10). Le
         `depth` reçu ici vaut (profondeur d'itération du dossier parent + 1)
         — lui-même déjà à (profondeur du dossier parent + 1) — donc
         10 * depth - 6 retombe systématiquement à ~8px de plus que la ligne
         du dossier parent, quel que soit le niveau. +4px seulement dans la
         vue PRINCIPALE (jamais isolée — voir isIsolatedView) : ni la
         profondeur réelle ni l'indentation des dossiers ne changent, juste
         un peu plus de distance visuelle dossier → feuillet. */
      item.style.paddingLeft = `${10 * depth - 6 + (isIsolatedView ? 0 : 4)}px`;
      item.setAttr("data-path", file.path);
      /* Focusable (sans entrer dans l'ordre de tabulation) : un clic sur
         la ligne lui donne le focus DOM, condition nécessaire pour que les
         flèches haut/bas (voir onOpen) remontent bien jusqu'au conteneur
         du Binder — un <div> sans tabindex ne reçoit jamais le focus, même
         cliqué, et les touches ne remontent alors jamais jusqu'ici. */
      item.setAttr("tabindex", "-1");

      const grip = item.createSpan({ cls: "feuillets-drag-grip" });
      setIcon(grip, "grip-vertical");

      if (!hidden && S.binderShowLabels) {
        const labelName = this.plugin.labelOf(file);
        const color = labelName ? this.plugin.labelColor(labelName) : null;
        if (color) item.style.boxShadow = `inset 3px 0 0 ${color}`;
      }

      const ring = item.createDiv({ cls: "feuillets-ring" });
      if (hidden || !S.binderShowProgress) ring.hide();

      const body = item.createDiv({ cls: "feuillets-item-body" });
      const nameRow = body.createDiv({ cls: "feuillets-item-name-row" });

      if (!hidden && S.binderShowStatus) {
        const st = toValue(this.fm(file).status);
        if (st) {
          const dot = nameRow.createSpan({ cls: "feuillets-status-dot" });
          dot.style.background = this.plugin.getStatusColor(st) || "var(--text-faint)";
          dot.setAttr("title", t("binder.item.statusTooltip", { status: st }));
        }
      }

      const num = hidden ? "" : `${numbering.get(file.path) || ""} `;
      nameRow
        .createSpan({ cls: "feuillets-item-name" })
        .setText(`${num}${this.plugin.shortTitleFor(file)}`);

      if (!hidden && searchTerm && contentIndex) {
        const inTitle = foldAccents(
          `${this.plugin.titleFor(file)} ${this.plugin.shortTitleFor(file)} ${file.basename}`
        ).includes(searchTerm);
        if (!inTitle) {
          const badge = nameRow.createSpan({ cls: "feuillets-search-badge" });
          setIcon(badge, "text-search");
          badge.setAttr("title", t("binder.item.foundInBody"));
        }
      }

      /* Mode compact (voir showSplitPaneOptionsMenu) : aucun aperçu, quel
         que soit le champ choisi — la densité prime, l'aperçu se consulte
         en mode standard. */
      if (!hidden && !effectiveBinderCompact && opts.showPreview && S.listPanePreviewField !== "none") {
        const field = S.listPanePreviewField;
        const lines = S.listPanePreviewLines || 2;
        if (field === "extrait") {
          const prev = body.createDiv({ cls: "feuillets-item-preview" });
          prev.style.maxHeight = `${lines * 1.3}em`;
          void this.app.vault.cachedRead(file).then((content) => {
            const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
            const limit = Number(S.excerptLength) || 420;
            const clean = stripMarkdown(body.slice(0, limit + 200)).slice(0, limit);
            prev.setText(clean || t("binder.item.emptyPreview"));
          });
        } else {
          let text = "";
          if (field === "tags") {
            text = this.plugin.tagsOf(file).map((tg: string) => `#${tg}`).join(" ");
          } else {
            text = toValue(this.fm(file)[field]).trim();
          }
          if (text) {
            const prev = body.createDiv({ cls: "feuillets-item-preview" });
            prev.style.maxHeight = `${lines * 1.3}em`;
            prev.setText(text);
          }
        }
      }

      if (!hidden && S.binderShowTags) {
        const tags = this.plugin.tagsOf(file);
        if (tags.length > 0) {
          const tagRow = body.createDiv({ cls: "feuillets-tags" });
          for (const tg of tags) {
            tagRow.createSpan({ cls: "feuillets-tag-chip" }).setText(`#${tg}`);
          }
        }
      }

      if (!hidden) {
        const wc = wcCache.get(file.path)?.wc || 0;
        if (S.binderShowProgress) this.fillRing(ring, wc, goal);
        if (S.binderShowWords) {
          body.createDiv({ cls: "feuillets-item-wc" }).setText(t("binder.item.words", { count: String(wc) }));
        }
      }

      item.setAttr("data-path", file.path);

      if (this.plugin._binderMultiSelect && this.plugin._binderMultiSelect.has(file.path)) {
        item.addClass("is-selected");
      }

      item.addEventListener("click", (e) => {
        if (this.handleMultiSelectClick(e, file, parent, i, siblings, dragScopeEl)) return;
        /* mis en surbrillance immédiatement, sans attendre les événements
           workspace ("active-leaf-change"/"file-open") : ceux-ci arrivent
           parfois après qu'un autre rendu ait déjà eu lieu, ou pendant que
           le focus transite encore vers la feuille de la scène cliquée —
           on connaît déjà le fichier ciblé, pas besoin de le redéduire. */
        highlightActive(this.contentEl, file.path);
        const leaf = this.plugin.getLeafForOpeningFile();
        openFileActivating(this.app, leaf, file);
        void this.app.workspace.revealLeaf(leaf);
        /* openFileActivating déplace le focus DOM vers l'éditeur — sans le
           reprendre ici, la 1ère flèche haut/bas après un simple clic ne
           navigue jamais (le keydown du Binder, sur this.contentEl, ne
           reçoit rien tant que le focus n'y est pas revenu ; voir onOpen). */
        window.setTimeout(() => {
          this.contentEl.querySelector<HTMLElement>(".feuillets-item.is-active")?.focus();
        }, 60);
      });

      if (!hidden) {
        this.attachDragHandlers(grip, item, parent, i, siblings, dragScopeEl);
        item.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.ensureSelectionForContextMenu(file.path, dragScopeEl);
          this.showFileContextMenu(e, file, parent, i, siblings);
        });
      }
      return true;
    };

    if (folder && workingRoot) {
      this.renderHierarchyBody(container, workingRoot, {
        S,
        binderFilterActive,
        folderHasMatch,
        renderFileRow,
        projectRoot: folder,
        binderCompact: effectiveBinderCompact,
      });
    }

    /* updateActiveHighlight() peut déplacer le défilement (scrollIntoView
       sur le fichier actif — voir utils/dom.ts, highlightActive) : appelé
       APRÈS, _restoreScroll/_resetScroll a toujours le dernier mot, pour
       qu'un simple clic sur un dossier (repli/dépli, sélection…) ne fasse
       jamais sauter le Binder loin de sa position — voir _captureScroll. */
    this.updateActiveHighlight();
    if (opts.resetScroll) this._resetScroll();
    else this._restoreScroll(savedScroll);
  }

  /** Zones défilantes du binder, selon la mise en page : la liste racine
   * (vue arbre, enfant direct du conteneur) ou les deux volets (double
   * volet). Mémorise la position même à 0 : ne pas le faire laisserait
   * highlightActive() (scrollIntoView sur le fichier actif, appelé par
   * updateActiveHighlight à la fin de render) déplacer silencieusement le
   * défilement sans que rien ne le corrige ensuite — c'est précisément ce
   * qui faisait "sauter" le Binder en fin de liste sur un simple clic de
   * dossier alors qu'on était tout en haut. */
  _captureScroll(): { sel: string; top: number }[] {
    const out: { sel: string; top: number }[] = [];
    const sels = [":scope > .feuillets-list", ".feuillets-tree-pane", ".feuillets-list-pane"];
    for (const sel of sels) {
      const el = this.contentEl.querySelector(sel);
      if (el) out.push({ sel, top: el.scrollTop });
    }
    return out;
  }

  _restoreScroll(saved: { sel: string; top: number }[]): void {
    if (!saved || saved.length === 0) return;
    const apply = () => {
      for (const { sel, top } of saved) {
        const el = this.contentEl.querySelector(sel);
        if (el) el.scrollTop = top;
      }
    };
    apply(); // tout de suite : le DOM est déjà construit
    /* puis une 2e passe à la frame suivante — la hauteur défilable d'un
       volet peut n'être finalisée qu'après le prochain calcul de mise en
       page (largeur de barre latérale ajustée, images…), auquel cas le
       premier scrollTop serait plafonné trop bas. */
    window.requestAnimationFrame(apply);
  }

  /** Symétrique de _restoreScroll, pour une entrée en isolation (voir
   * isolateFolder) : la nouvelle racine de travail s'affiche depuis son
   * tout début plutôt que de conserver un décalage devenu arbitraire, et
   * annule là aussi tout scrollIntoView parasite de updateActiveHighlight. */
  _resetScroll(): void {
    const sels = [":scope > .feuillets-list", ".feuillets-tree-pane", ".feuillets-list-pane"];
    const apply = () => {
      for (const sel of sels) {
        const el = this.contentEl.querySelector(sel);
        if (el) el.scrollTop = 0;
      }
    };
    apply();
    window.requestAnimationFrame(apply);
  }

  renderProjectManagerSplitView(container: HTMLElement, S: FeuilletsSettings): void {
    const split = container.createDiv({ cls: "feuillets-split" });
    split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth || 240}px`);

    const treePane = split.createDiv({ cls: "feuillets-tree-pane" });
    const resizer = split.createDiv({ cls: "feuillets-split-resizer" });
    const listPane = split.createDiv({ cls: "feuillets-list-pane" });

    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = S.binderTreeWidth || 240;
      const onMove = (ev: MouseEvent) => {
        S.binderTreeWidth = Math.min(400, Math.max(140, startW + ev.clientX - startX));
        split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth}px`);
      };
      const onUpAsync = async () => {
        await this.plugin.saveSettings();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        void onUpAsync();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Left Pane Header: Projets
    const treeHeader = treePane.createDiv({ cls: "feuillets-folder-row feuillets-tree-root" });
    const rootIcon = treeHeader.createDiv({ cls: "feuillets-cell-icon" });
    setIcon(rootIcon, "folder-cog");
    treeHeader.createSpan({ cls: "feuillets-folder-name" }).setText(t("binder.projectManager.title"));

    const treeActions = treeHeader.createDiv({ cls: "feuillets-project-actions" });

    const newBtn = treeActions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
    setIcon(newBtn, "folder-plus");
    newBtn.setAttr("aria-label", t("binder.projectManager.newProject"));
    newBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      new NewProjectModal(this.app, this.plugin).open();
    });

    const importBtn = treeActions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
    setIcon(importBtn, "import");
    importBtn.setAttr("aria-label", t("binder.projectManager.importScrivener"));
    importBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      new ScrivenerImportModal(this.app, this.plugin).open();
    });

    // Project List
    const projectListEl = treePane.createDiv({ cls: "feuillets-project-list" });
    projectListEl.addClass("feuillets-project-list");

    const allProjects = (S.projects || []).concat(S.projectFolder ? [S.projectFolder] : [])
      .filter((p, i, a) => p && a.indexOf(p) === i)
      .sort((a, b) =>
        this.plugin.projectDisplayName(a).localeCompare(
          this.plugin.projectDisplayName(b), "fr", { sensitivity: "base" }
        )
      );

    if (allProjects.length === 0) {
      projectListEl
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("binder.projectManager.noProjects"));
    } else {
      for (const path of allProjects) {
        const folderObj = this.app.vault.getAbstractFileByPath(path);
        const folderExists = folderObj instanceof TFolder;
        const isActive = folderExists && path === S.projectFolder;
        const meta = S.projectMeta[path] || {};
        const row = projectListEl.createDiv({ cls: `feuillets-folder-row ${isActive ? "is-selected" : ""}` });
        row.addClass("feuillets-project-row-indent");

        const icon = row.createDiv({ cls: "feuillets-cell-icon" });
        setIcon(icon, !folderExists ? "alert-triangle" : (meta.icon as string) || (isActive ? "folder-open" : "folder"));

        const nameSpan = row.createSpan({ cls: "feuillets-folder-name" });
        nameSpan.setText(
          folderExists
            ? this.plugin.projectDisplayName(path)
            : t("binder.projectManager.notFound", { name: this.plugin.projectDisplayName(path) })
        );
        if (!folderExists) {
          nameSpan.addClass("feuillets-muted-italic");
        }

        const actionsEl = row.createDiv({ cls: "feuillets-project-actions" });
        const removeBtn = actionsEl.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
        setIcon(removeBtn, "trash-2");
        removeBtn.setAttr("aria-label", t("binder.projectManager.removeFromList"));
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          S.projects = (S.projects || []).filter((p) => p !== path);
          if (S.projectFolder === path) S.projectFolder = "";
          delete S.projectMeta[path];
          void this.plugin.saveSettings().then(() => {
            this.plugin.renderAllViews(true);
          });
        });

        row.addEventListener("click", () => {
          if (!folderExists) {
            new Notice(t("binder.projectManager.folderGone", { path }));
            return;
          }
          void (async () => {
            S.projectFolder = path;
            await this.plugin.saveSettings();
            void this.plugin.updateStatusBar();
            this.plugin.renderAllViews(true);
          })();
        });
      }
    }

    // Add existing folder input
    const addRow = treePane.createDiv({ cls: "feuillets-properties-add-row" });
    addRow.addClass("feuillets-add-row");
    const addInput = addRow.createEl("input", {
      type: "text",
      attr: { placeholder: t("binder.projectManager.addExisting") },
    });
    addInput.addClass("feuillets-input-full");
    addInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const p = normalizePath(addInput.value.trim());
      if (!p) return;
      const folder = this.app.vault.getAbstractFileByPath(p);
      if (!(folder instanceof TFolder)) {
        new Notice(t("binder.projectManager.folderNotFound"));
        return;
      }
      void (async () => {
        S.projectFolder = p;
        if (!S.projects.includes(p)) S.projects.push(p);
        await this.plugin.saveSettings();
        addInput.value = "";
        void this.plugin.updateStatusBar();
        this.plugin.renderAllViews(true);
      })();
    });

    // --- Right Pane: Hub & Cards ---
    const listBody = listPane.createDiv({ cls: "feuillets-list" });
    const hub = listBody.createDiv({ cls: "feuillets-project-hub" });

    hub.createEl("h3", { cls: "feuillets-hub-title", text: t("binder.projectManager.hubTitle") });

    const subEl = hub.createDiv({ cls: "feuillets-notes-sub" });
    subEl.setText(t("binder.projectManager.hubSub"));

    const cardsContainer = hub.createDiv({ cls: "feuillets-hub-cards" });

    this.hubCard(
      cardsContainer,
      "folder-plus",
      t("binder.projectManager.card.new.title"),
      t("binder.projectManager.card.new.desc"),
      t("binder.projectManager.card.new.btn"),
      () => new NewProjectModal(this.app, this.plugin).open()
    );

    this.hubCard(
      cardsContainer,
      "import",
      t("binder.projectManager.card.import.title"),
      t("binder.projectManager.card.import.desc"),
      t("binder.projectManager.card.import.btn"),
      () => new ScrivenerImportModal(this.app, this.plugin).open()
    );

    this.hubCard(
      cardsContainer,
      "folder-open",
      t("binder.projectManager.card.add.title"),
      t("binder.projectManager.card.add.desc"),
      t("binder.projectManager.card.add.btn"),
      () => addInput.focus()
    );
  }

  /** Une carte d'action cliquable (icône + titre + description + bouton) —
   * même gabarit que les cartes du gestionnaire de projets
   * (renderProjectManagerSplitView) et de l'écran d'accueil (renderOnboarding),
   * pour que les deux se ressemblent visuellement. `onClick` reçoit
   * l'événement (utile pour positionner un Menu au clic, ex. la démo). */
  hubCard(container: HTMLElement, icon: string, title: string, desc: string, btnText: string, onClick: (e: MouseEvent) => void): HTMLElement {
    const card = container.createDiv({ cls: "feuillets-hub-card" });

    const iconEl = card.createDiv({ cls: "feuillets-cell-icon feuillets-hub-card-icon" });
    setIcon(iconEl, icon);

    const textWrap = card.createDiv({ cls: "feuillets-hub-card-text" });
    const cardTitle = textWrap.createDiv({ cls: "feuillets-hub-card-title" });
    cardTitle.setText(title);

    const cardDesc = textWrap.createDiv({ cls: "feuillets-notes-sub" });
    cardDesc.setText(desc);

    const btn = card.createEl("button", { cls: "mod-small", text: btnText });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(e);
    });

    card.addEventListener("click", onClick);
    return card;
  }

  /** Véritable écran d'accueil, affiché uniquement au tout premier lancement
   * (aucun projet actif NI connu — voir render()) : titre, accroche, et les
   * trois actions qui font vraiment démarrer l'écriture. Distinct de
   * renderProjectManagerSplitView, qui reste affiché dès qu'AU MOINS un
   * projet est déjà connu (liste à switcher, pas un premier pas). Réutilise
   * .feuillets-settings-title/.feuillets-settings-tagline (déjà le rendu du
   * nom "Feuillets" + accroche dans les réglages) et .feuillets-hub-card
   * (déjà les cartes du gestionnaire de projets) plutôt que d'inventer un
   * nouveau langage visuel. */
  renderOnboarding(container: HTMLElement): void {
    const wrap = container.createDiv({ cls: "feuillets-onboarding" });

    wrap.createDiv({ cls: "feuillets-settings-title" }).setText(t("binder.onboarding.title"));
    wrap.createDiv({ cls: "feuillets-settings-tagline" }).setText(t("binder.onboarding.tagline"));

    const cards = wrap.createDiv({ cls: "feuillets-hub-cards" });

    this.hubCard(
      cards,
      "folder-plus",
      t("binder.onboarding.card.create.title"),
      t("binder.onboarding.card.create.desc"),
      t("binder.onboarding.card.create.btn"),
      () => new NewProjectModal(this.app, this.plugin).open()
    );

    this.hubCard(
      cards,
      "folder-open",
      t("binder.onboarding.card.open.title"),
      t("binder.onboarding.card.open.desc"),
      t("binder.onboarding.card.open.btn"),
      () => new OpenExistingFolderModal(this.app, this.plugin).open()
    );

    this.hubCard(
      cards,
      "sparkles",
      t("binder.onboarding.card.demo.title"),
      t("binder.onboarding.card.demo.desc"),
      t("binder.onboarding.card.demo.btn"),
      () => {
        void this.plugin.createDemoProject();
      }
    );

    wrap.createDiv({ cls: "feuillets-notes-sub feuillets-onboarding-footnote" }).setText(
      t("binder.onboarding.footnote")
    );
  }

  /** Section "Recherche" repliable, ajoutée sous l'arborescence du
   * manuscrit (vue arbre ET double volet) — juste une porte d'accès aux
   * fichiers de recherche depuis le binder, façon Ulysses ("Extras"). Rendu
   * volontairement simple (pas d'anneau de progression, pas de
   * numérotation, pas de menu contextuel manuscrit) : _Recherche est déjà
   * exclu de la compilation/numérotation/statistiques/Tableau par
   * convention de nommage (voir getOrderedChildren, folder-structure.js) —
   * cette section ne fait qu'y donner accès, jamais le mélanger au reste. */
  renderResearchSection(container: HTMLElement, researchRoot: TFolder, rootIcon = "search", labelForFile?: (f: TFile) => string): void {
    const fileLabel = labelForFile || ((f: TFile) => this.plugin.titleFor(f));
    const S = this.plugin.settings;

    const renderRow = (label: string, depth: number, isFolder: boolean) => {
      const row = container.createDiv({
        cls: isFolder ? "feuillets-folder-row feuillets-binder-research-row" : "feuillets-item feuillets-binder-research-row",
      });
      row.style.paddingLeft = `${6 + depth * 14}px`;
      const icon = row.createDiv({ cls: "feuillets-cell-icon" });
      setIcon(icon, depth === 0 ? rootIcon : isFolder ? "folder" : "file-text");
      row.createSpan({ cls: isFolder ? "feuillets-folder-name" : "feuillets-item-name" }).setText(label);
      return row;
    };

    // Clic droit sur un dossier de recherche (racine comprise) : créer un
    // sous-dossier ou un fichier dedans — mêmes actions que le manuscrit,
    // mais sans le reste du menu contextuel manuscrit (statut/label/
    // snapshot...), qui n'a pas de sens ici.
    const showResearchFolderMenu = (e: MouseEvent, folder: TFolder) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.newFolder"))
          .setIcon("folder-plus")
          .onClick(() => this.plugin.newFolder(folder))
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.newFile"))
          .setIcon("file-plus")
          .onClick(async () => {
            let name = t("binder.research.newFileDefaultName");
            let n = 2;
            while (this.app.vault.getAbstractFileByPath(normalizePath(`${folder.path}/${name}.md`))) {
              name = `${t("binder.research.newFileDefaultName")} ${n++}`;
            }
            const file = await this.app.vault.create(normalizePath(`${folder.path}/${name}.md`), "");
            openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file);
          })
      );
      menu.showAtMouseEvent(e);
    };

    // Clic droit sur un fichier de recherche : gestion basique (ouvrir en
    // nouvel onglet, dupliquer, corbeille) — pas les options manuscrit
    // (statut/label/snapshot), qui n'ont pas de sens pour une fiche.
    const showResearchFileMenu = (e: MouseEvent, file: TFile) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.openNewTab"))
          .setIcon("file-plus")
          .onClick(() => openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file))
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.openSplit"))
          .setIcon("columns-2")
          .onClick(() => openFileActivating(this.app, this.app.workspace.getLeaf("split", "vertical"), file))
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.compareWith"))
          .setIcon("diff")
          .onClick(() => {
            new PickFileModal(this.app, this.plugin, file, (other: TFile) => {
              new CompareFilesModal(this.app, this.plugin, file, other).open();
            }).open();
          })
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.duplicate"))
          .setIcon("copy")
          .onClick(async () => {
            const content = await this.app.vault.read(file);
            const copySuffix = t("binder.research.copySuffix");
            let name = `${file.basename} (${copySuffix})`;
            let dest = normalizePath(`${file.parent!.path}/${name}.md`);
            let k = 2;
            while (this.app.vault.getAbstractFileByPath(dest)) {
              name = `${file.basename} (${copySuffix} ${k++})`;
              dest = normalizePath(`${file.parent!.path}/${name}.md`);
            }
            await this.app.vault.create(dest, content);
            new Notice(t("binder.research.duplicated", { name }));
            void this.render(true);
          })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.research.trash"))
          .setIcon("trash")
          .onClick(async () => {
            await this.app.fileManager.trashFile(file);
            new Notice(t("binder.research.trashed", { name: this.plugin.titleFor(file) || file.basename }));
            void this.render(true);
          })
      );
      menu.showAtMouseEvent(e);
    };

    const researchLabel = researchRoot.name.replace(/^_/, "");
    const rootRow = renderRow(researchLabel, 0, true);
    // Séparateur visuel avec l'arborescence du manuscrit juste au-dessus —
    // trop proche sinon, on pouvait croire que "Recherche" faisait partie
    // du manuscrit plutôt que d'un accès à part (voir styles.css).
    rootRow.addClass("feuillets-binder-research-root");
    const rootCollapsed = !!S.collapsed[researchRoot.path];
    rootRow.addEventListener("click", () => {
      void (async () => {
        if (S.collapsed[researchRoot.path]) delete S.collapsed[researchRoot.path];
        else S.collapsed[researchRoot.path] = true;
        await this.plugin.saveSettings();
        void this.render(true);
      })();
    });
    rootRow.addEventListener("contextmenu", (e) => showResearchFolderMenu(e, researchRoot));
    if (rootCollapsed) return;

    const renderChildren = (folder: TFolder, depth: number) => {
      for (const child of this.plugin.getOrderedChildren(folder)) {
        if (child instanceof TFolder) {
          const row = renderRow(child.name, depth, true);
          const isCollapsed = !!S.collapsed[child.path];
          row.addEventListener("click", () => {
            void (async () => {
              if (S.collapsed[child.path]) delete S.collapsed[child.path];
              else S.collapsed[child.path] = true;
              await this.plugin.saveSettings();
              void this.render(true);
            })();
          });
          row.addEventListener("contextmenu", (e) => showResearchFolderMenu(e, child));
          if (!isCollapsed) renderChildren(child, depth + 1);
        } else if (child instanceof TFile) {
          const row = renderRow(fileLabel(child), depth, false);
          // Toujours dans un nouvel onglet : consulter une fiche de
          // recherche ne doit jamais remplacer la scène en cours d'écriture.
          row.addEventListener("click", () => {
            openFileActivating(this.app, this.app.workspace.getLeaf("tab"), child);
          });
          row.addEventListener("contextmenu", (e) => showResearchFileMenu(e, child));
        }
      }
    };
    renderChildren(researchRoot, 1);
  }

  renderHierarchyBody(container: HTMLElement, root: TFolder, ctx: SplitBodyCtx): void {
    const {
      S,
      binderFilterActive,
      folderHasMatch,
      renderFileRow,
      projectRoot,
      binderCompact,
    } = ctx;

    const treePane = container.createDiv({ cls: "feuillets-list" });
    if (binderCompact) treePane.addClass("feuillets-compact");

    const treeRoot = root;

    let selected = this.app.vault.getAbstractFileByPath(S.binderSelectedPath || "");
    const inScope = (f: unknown): f is TFolder =>
      f instanceof TFolder && (f.path === root.path || f.path.startsWith(root.path + "/"));

    if (!inScope(selected)) {
      selected = treeRoot;
    }
    const selectedFolder = asFolder(selected);

    const selectFolder = async (f: TFolder) => {
      S.binderSelectedPath = f.path;
      await this.plugin.saveSettings();
      void this.render(true);
    };

    const rootRow = treePane.createDiv({
      cls: "feuillets-folder-row feuillets-tree-root",
    });
    if (selectedFolder.path === treeRoot.path) rootRow.addClass("is-selected");

    /* En-tête d'isolation (chantier "isoler un dossier" —
       _binderWorkingRootPath) : réutilise EXACTEMENT la même ligne "nom du
       projet", sans bandeau ni encadrement nouveau. Non isolé, comportement
       identique à avant (nom du projet seul). Isolé, une seule ligne
       compacte : [icône manuscrit] ‹ nom réel du dossier courant — jamais
       de fil d'Ariane complet, jamais de chemin affiché. */
    const isIsolated = treeRoot.path !== projectRoot.path;

    /* Clic sur le nom courant (isolé ou non) : replie/déplie la branche de
       treeRoot — comportement "tout replier/déplier" existant, inchangé,
       juste scopé à la racine de travail. */
    const toggleCollapseCurrentRoot = (e: MouseEvent) => {
      e.stopPropagation();
      const isCollapsed = !!S.collapsed[treeRoot.path];
      S.collapsed[treeRoot.path] = !isCollapsed;
      if (!isCollapsed) {
        for (const child of this.plugin.getOrderedChildren(treeRoot)) {
          if (child instanceof TFolder) S.collapsed[child.path] = true;
        }
      } else {
        const expandAllFolders = (folder: TFolder) => {
          delete S.collapsed[folder.path];
          for (const child of this.plugin.getOrderedChildren(folder)) {
            if (child instanceof TFolder) expandAllFolders(child);
          }
        };
        expandAllFolders(treeRoot);
      }
      void (async () => {
        await this.plugin.saveSettings();
        void this.render(true);
      })();
    };

    if (isIsolated) {
      // Icône manuscrit (réutilise "files", déjà l'icône du Binder — voir
      // getIcon()/registerRibbonIcons — plutôt qu'un SVG maison) : clic =
      // retour immédiat au projet complet.
      const backIcon = rootRow.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(backIcon, "files");
      backIcon.setAttr("aria-label", t("binder.isolation.backToProject"));
      backIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        this._binderWorkingRootPath = undefined;
        void this.render(true);
      });

      // Chevron : remonte exactement d'un dossier. Si le parent est la
      // racine du projet, revenir au Binder complet (équivalent : la racine
      // de travail redevient le projet, donc l'en-tête isolé disparaît).
      const upChevron = rootRow.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(upChevron, "chevron-left");
      upChevron.setAttr("aria-label", t("binder.isolation.up"));
      upChevron.addEventListener("click", (e) => {
        e.stopPropagation();
        const parent = treeRoot.parent;
        this._binderWorkingRootPath = (!parent || parent.path === projectRoot.path) ? undefined : parent.path;
        void this.render(true);
      });

      // Nom réel du dossier isolé : casse conservée (pas d'uppercase — voir
      // styles.css), ellipsis sur nom long, tooltip natif via `title`.
      const nameEl = rootRow.createSpan({ cls: "feuillets-folder-name feuillets-isolation-current" });
      nameEl.setText(treeRoot.name);
      nameEl.setAttr("title", treeRoot.name);
      nameEl.addEventListener("click", toggleCollapseCurrentRoot);
    } else {
      // Nom du projet (pas le nom brut du dossier : un projet structuré en
      // <NomDuProjet>/Manuscrit/ afficherait sinon juste "Manuscrit" pour
      // tous les projets — projectDisplayName remonte au vrai nom).
      const rootName = rootRow.createSpan({ cls: "feuillets-folder-name" });
      rootName.setText(this.plugin.projectDisplayName(treeRoot.path));
      rootName.addEventListener("click", toggleCollapseCurrentRoot);
    }

    rootRow.addEventListener("click", (e) => {
      void selectFolder(treeRoot);
    });

    /* Clic droit sur la ligne racine : si elle représente le vrai dossier
       projet (pas d'isolation, ou isolation revenue au projet), même menu
       qu'avant — "dupliquer comme nouvelle version" comprise (voir plus
       bas). Isolée sur un sous-dossier, la racine affichée est un dossier
       ordinaire : son clic droit ouvre le menu contextuel standard des
       dossiers (showFolderContextMenu), avec "Isoler ce dossier" en plus —
       jamais un second menu créé pour l'occasion. */
    rootRow.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (treeRoot.path !== projectRoot.path) {
        const workingParent = treeRoot.parent;
        const workingSiblings = workingParent ? this.plugin.getOrderedChildren(workingParent) : [treeRoot];
        const workingIndex = Math.max(0, workingSiblings.indexOf(treeRoot));
        this.ensureSelectionForContextMenu(treeRoot.path, treePane);
        this.showFolderContextMenu(e, treeRoot, workingParent ?? treeRoot, workingIndex, workingSiblings, this.binderIsolateExtras(treeRoot));
        return;
      }
      const menu = new Menu();
      const menuTitle = t("shared.contextMenu.openWithPreview");
      menu.addItem((item) =>
        item
          .setTitle(menuTitle)
          .setIcon("eye")
          .onClick(async () => {
            const scope = createProjectScope(treeRoot.path);
            await openScopeWithPreview(this.app, scope);
          })
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(t("binder.newSheetHere"))
          .setIcon("file-plus")
          .onClick(() => this.plugin.newSheet(root))
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.newFolder"))
          .setIcon("folder-plus")
          .onClick(() => this.plugin.newFolder(root))
      );
      menu.addItem((item) =>
        item
          .setTitle(t("binder.importOutline"))
          .setIcon("list-tree")
          .onClick(() => new ImportOutlineModal(this.app, this.plugin).open())
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(t("binder.duplicateAsVersion"))
          .setIcon("copy-plus")
          .onClick(() => {
            new DuplicateVersionModal(this.app, this.plugin.projectDisplayName(treeRoot.path), (label) => {
              void this.plugin.duplicateProject(treeRoot.path, label);
            }).open();
          })
      );
      menu.showAtMouseEvent(e);
    });

    /* Accepter le dépôt d'un dossier imbriqué sur la racine du projet :
       glisser Documentation/Chapitre 5 sur la racine déplace Chapitre 5 à
       la racine, avec vérifications pour éviter les pièges courants
       (déplacement de la racine elle-même, dossier déjà à la racine,
       conflits de nom, rejets de fichiers). */
    rootRow.addEventListener("dragover", (e) => {
      if (!this.plugin.dragState) return;
      const draggedPath = this.plugin.dragState.path;
      if (!draggedPath) return;
      const dragged = this.app.vault.getAbstractFileByPath(draggedPath);
      // Accepter seulement les dossiers, pas les fichiers
      if (!(dragged instanceof TFolder)) return;
      // Ne pas accepter la racine elle-même
      if (dragged.path === treeRoot.path) return;
      // Ne pas accepter un dossier qui est déjà à la racine
      if (dragged.parent?.path === treeRoot.path) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      rootRow.addClass("feuillets-dragover");
    });

    rootRow.addEventListener("dragleave", () => {
      rootRow.removeClass("feuillets-dragover");
    });

    rootRow.addEventListener("drop", (e) => {
      void (async () => {
        e.preventDefault();
        rootRow.removeClass("feuillets-dragover");
        if (!this.plugin.dragState) return;
        const drag = this.plugin.dragState;
        this.plugin.dragState = null;

        const draggedPath = drag.multi ? null : drag.path;
        if (!draggedPath) return;

        const dragged = this.app.vault.getAbstractFileByPath(draggedPath);
        // Accepter seulement les dossiers
        if (!(dragged instanceof TFolder)) return;
        // Ne pas accepter la racine
        if (dragged.path === treeRoot.path) return;
        // Ne pas accepter un dossier qui est déjà à la racine
        if (dragged.parent?.path === treeRoot.path) return;

        const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
        if (!(srcParent instanceof TFolder)) return;

        // Déplacer le dossier à la racine
        await this.plugin.moveNode(dragged, srcParent, treeRoot, Number.MAX_SAFE_INTEGER);
        this.plugin.renderAllViews(true);
      })();
    });

    // Filet de sécurité : chaque dossier jamais replié explicitement
    // (S.collapsed) se déplie par défaut — sur un dossier de projet
    // contenant des milliers de fichiers, ça pouvait construire un DOM
    // énorme d'un coup et planter Obsidian. On plafonne le nombre de lignes
    // rendues plutôt que de changer le comportement normal (jamais atteint
    // pour un projet de taille raisonnable, aucun changement perceptible).
    const MAX_TREE_ROWS = 1500;
    let treeRowCount = 0;
    let treeTruncated = false;

    /* Repli/dépli d'un dossier au simple clic (voir renderTreeFolders,
       ci-dessous) : programmé après ce court délai plutôt qu'exécuté tout de
       suite, pour qu'un double-clic (isolation, voir isolateFolder) ait le
       temps de l'annuler avant qu'il ne parte — un double-clic ne doit
       jamais aussi replier/déplier au passage. */
    const BINDER_CLICK_DELAY_MS = 220;
    let pendingCollapseTimer: number | null = null;

    const renderTreeFolders = (parent: TFolder, depth: number) => {
      if (treeTruncated) return;
      const siblings = this.plugin.getOrderedChildren(parent);
      for (let i = 0; i < siblings.length; i++) {
        const child = siblings[i];
        if (parent === treeRoot && S.collapsed[treeRoot.path] && child instanceof TFile) continue;
        if (child instanceof TFile) {
          if (treeRowCount >= MAX_TREE_ROWS) {
            treeTruncated = true;
            treePane.createDiv({ cls: "feuillets-empty" }).setText(t("binder.tree.truncated", { max: String(MAX_TREE_ROWS) }));
            return;
          }
          if (renderFileRow(treePane, child, parent, i, siblings, depth + 1, treePane, { showPreview: true })) {
            treeRowCount++;
          }
          continue;
        }
        if (!(child instanceof TFolder)) continue;
        const hidden = child.name.startsWith("_") || parent.path.includes("/_");
        if (hidden) continue;
        if (binderFilterActive && !folderHasMatch(child)) continue;

        if (treeRowCount >= MAX_TREE_ROWS) {
          treeTruncated = true;
          const warn = treePane.createDiv({ cls: "feuillets-empty" });
          warn.setText(t("binder.tree.truncated", { max: String(MAX_TREE_ROWS) }));
          return;
        }
        treeRowCount++;

        const row = treePane.createDiv({ cls: "feuillets-folder-row" });
        if (depth === 0) row.addClass("is-depth-0");
        row.style.paddingLeft = `${6 + depth * 10}px`;
        if (selectedFolder.path === child.path) row.addClass("is-active");

        row.setAttr("data-path", child.path);

        if (this.plugin._binderMultiSelect && this.plugin._binderMultiSelect.has(child.path)) {
          row.addClass("is-selected");
        }

        const grip = row.createSpan({ cls: "feuillets-drag-grip" });
        setIcon(grip, "grip-vertical");

        row.createSpan({ cls: "feuillets-folder-name" }).setText(child.name);

        /* Simple clic = replie/déplie ce dossier, comme avant l'essai des
           chevrons (retiré : aspect sobre du Binder — aucun chevron
           permanent). Pour laisser un double-clic s'annoncer d'abord, le
           repli/dépli est programmé après un court délai plutôt qu'exécuté
           immédiatement — `dblclick` annule ce délai avant d'isoler, un
           double-clic ne doit donc JAMAIS aussi replier/déplier au passage.
           `pendingCollapseTimer` est partagé par tout l'arbre de CE rendu :
           un seul geste utilisateur (clic ou double-clic) a lieu à la fois,
           inutile d'en garder un par ligne. */
        row.addEventListener("click", (e) => {
          if (this.handleMultiSelectClick(e, child, parent, i, siblings, treePane)) return;
          if (pendingCollapseTimer !== null) window.clearTimeout(pendingCollapseTimer);
          pendingCollapseTimer = window.setTimeout(() => {
            pendingCollapseTimer = null;
            void (async () => {
              if (S.collapsed[child.path]) delete S.collapsed[child.path];
              else S.collapsed[child.path] = true;
              await this.plugin.saveSettings();
              await selectFolder(child);
            })();
          }, BINDER_CLICK_DELAY_MS);
        });
        row.addEventListener("dblclick", (e) => {
          e.preventDefault();
          if (pendingCollapseTimer !== null) {
            window.clearTimeout(pendingCollapseTimer);
            pendingCollapseTimer = null;
          }
          this.isolateFolder(child);
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.ensureSelectionForContextMenu(child.path, treePane);
          this.showFolderContextMenu(e, child, parent, i, siblings, this.binderIsolateExtras(child));
        });

        this.attachDragHandlers(grip, row, parent, i, siblings, treePane);

        /* Le repli du nom du projet (S.collapsed[treeRoot.path]) ne masque
           que les feuillets posés directement à la racine (voir plus haut) —
           il ne doit jamais empêcher un dossier de se déplier via son PROPRE
           état S.collapsed[child.path], sans quoi "tout replier" fige
           l'arborescence : un dossier redevenait cliquable en apparence mais
           son contenu ne se rendait plus jamais tant que la racine restait
           repliée. */
        if (!S.collapsed[child.path] || binderFilterActive) {
          renderTreeFolders(child, depth + 1);
        }
      }
    };

    renderTreeFolders(treeRoot, 0);

    const versionsRoot = this.plugin.getVersionsRoot();
    if (!treeTruncated && versionsRoot instanceof TFolder) {
      this.renderResearchSection(treePane, versionsRoot, "history", (f: TFile) => this.plugin.shortTitleFor(f));
    }

    // Vider la sélection quand on clique dans une zone vide du Binder
    treePane.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      // Ne vider que si le clic est dans la zone vide ou pas sur un élément avec data-path
      if (
        !target.closest("[data-path]") &&
        !target.closest(".feuillets-drag-grip")
      ) {
        if (this.plugin._binderMultiSelect && this.plugin._binderMultiSelect.size > 0) {
          this.plugin._binderMultiSelect.clear();
          this.refreshMultiSelectClasses(treePane);
        }
      }
    });
  }
}
