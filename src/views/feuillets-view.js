import { VIEW_SIDEBAR, STATUSES } from "../constants.js";
import { foldAccents, stripMarkdown } from "../utils/core.js";
import { highlightActive, isEditing, getActiveFileSafe, openFileActivating } from "../utils/dom.js";
import { ImportOutlineModal } from "../ui/import-outline-modal.js";
import { ManageProjectsModal, NewProjectModal } from "../ui/project-modals.js";
import { ScrivenerImportModal } from "../ui/scrivener-import-modal.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
const { Menu, TFile, TFolder, setIcon, Notice, normalizePath } = require("obsidian");

export class FeuilletsView extends BaseFeuilletsView {
  getViewType() {
    return VIEW_SIDEBAR;
  }

  getDisplayText() {
    return "Feuillets";
  }

  getIcon() {
    return "files";
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateActiveHighlight();
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateActiveHighlight())
    );
    await this.render();
  }

  updateActiveHighlight() {
    highlightActive(this.contentEl, getActiveFileSafe(this.app)?.path);
  }

  /** Anime le masquage/affichage du volet dossiers sans reconstruire tout
   * le binder — utilisée par le geste de balayage (main.js), qui ne
   * connaît que ce cycle à 2 états (voir registerSwipeGestures). Ne
   * touche pas les boutons de la barre d'actions (icône/tooltip figés
   * jusqu'au prochain vrai rendu), c'est un compromis assumé pour garder
   * le geste fluide. */
  toggleTreeCollapsedClasses(collapsed) {
    const split = this.contentEl.querySelector(".feuillets-split");
    if (!split) return;
    const treePane = split.querySelector(".feuillets-tree-pane");
    const resizer = split.querySelector(".feuillets-split-resizer");
    split.toggleClass("is-tree-collapsed", collapsed);
    if (treePane) treePane.toggleClass("is-tree-collapsed", collapsed);
    if (resizer) resizer.toggleClass("is-tree-collapsed", collapsed);
    this.plugin.adjustSidebarWidth();
    setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
  }

  /** Version à 3 états (double volet / fiches seules / dossiers seuls) —
   * utilisée par le bouton dédié (voir render()), relit directement les
   * réglages plutôt que de recevoir un booléen, pour rester correcte quel
   * que soit l'état de départ. */
  applyPaneModeClasses() {
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
    setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
  }

  /** Réglages d'affichage transversaux aux deux mises en page (Affichage
   * des lignes + accès aux réglages complets) — ajoutés à la suite du
   * contenu propre à chaque icône de vue (voir showSplitPaneOptionsMenu et
   * showTreeOptionsMenu), pas dans une icône réglages à part : les deux
   * icônes de vue répondent désormais toutes les deux au clic droit, plus
   * besoin d'un troisième bouton générique dans la barre. */
  buildDisplayOptionsMenu(menu) {
    const S = this.plugin.settings;

    const toggle = (title, key) =>
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setChecked(!!S[key])
          .onClick(async () => {
            S[key] = !S[key];
            await this.plugin.saveSettings();
            this.render(true);
          })
      );

    menu.addItem((item) => item.setTitle("— Affichage —").setDisabled(true));
    toggle("Liserés de couleur des labels", "binderShowLabels");
    toggle("Pastilles de tags", "binderShowTags");
    toggle("Pastille de statut", "binderShowStatus");
    toggle("Barres de progression", "binderShowProgress");
    toggle("Nombre de mots en chiffres", "binderShowWords");
    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Plus d'options (réglages du binder)…")
        .setIcon("settings")
        .onClick(() => {
          this.app.setting.open();
          this.app.setting.openTabById(this.plugin.manifest.id);
        })
    );
  }

  /** Menu du clic droit sur l'icône "Double volet" : quel champ prévisualiser
   * dans le volet fichiers, puis l'Affichage transversal (voir
   * buildDisplayOptionsMenu). Le choix des volets visibles (double/dossiers
   * seuls/fichiers seuls) vit désormais dans des boutons directs de la barre
   * d'actions (voir render()), plus dans ce menu. */
  currentSplitMode() {
    const S = this.plugin.settings;
    return S.binderTreeCollapsed ? "files" : S.binderListCollapsed ? "folders" : "both";
  }

  /** Bascule le double volet sur "both"/"folders"/"files" — utilisée par le
   * menu du clic droit ET par les boutons directs de la barre d'actions
   * (voir render()). Passe en double volet si on n'y était pas encore. */
  async applySplitPaneMode(mode) {
    const S = this.plugin.settings;
    S.binderLayout = "split";
    S.binderTreeCollapsed = mode === "files";
    S.binderListCollapsed = mode === "folders";
    await this.plugin.saveSettings();
    this.render(true);
    this.plugin.adjustSidebarWidth();
    setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
  }

  showSplitPaneOptionsMenu(e) {
    const S = this.plugin.settings;
    const menu = new Menu();

    menu.addItem((item) => item.setTitle("— Aperçu de la fiche —").setDisabled(true));
    const previewFields = [
      ["none", "Aucun"],
      ["extrait", "Extrait du texte"],
      ["synopsis", "Synopsis"],
      ["resume", "Résumé long"],
      ["notes", "Notes de travail"],
      ["tags", "Tags"],
    ];
    for (const [key, label] of previewFields) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked((S.listPanePreviewField || "none") === key)
          .onClick(async () => {
            S.listPanePreviewField = key;
            await this.plugin.saveSettings();
            this.render(true);
          })
      );
    }
    menu.addSeparator();
    this.buildDisplayOptionsMenu(menu);
    menu.showAtMouseEvent(e);
  }

  /** Menu du clic droit sur l'icône "Vue arbre" : rien de propre à ce
   * mode (pas de sous-volets ni d'aperçu) — juste l'Affichage transversal,
   * voir buildDisplayOptionsMenu. */
  showTreeOptionsMenu(e) {
    const menu = new Menu();
    this.buildDisplayOptionsMenu(menu);
    menu.showAtMouseEvent(e);
  }

  async render(force = false) {
    const container = this.contentEl;
    if (!force && isEditing(container)) return;
    /* Position de défilement mémorisée AVANT de vider le DOM, restaurée en
       fin de reconstruction : un rafraîchissement de fond (modification dans
       le coffre, changement de fichier actif…) reconstruit tout le binder et
       renvoyait sinon la liste tout en haut alors qu'on lisait plus bas. */
    const savedScroll = this._captureScroll();
    const myGen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-container");

    const folder = this.getProjectFolder();
    const S = this.plugin.settings;

    const header = container.createDiv({ cls: "feuillets-header" });
    const actions = header.createDiv({ cls: "feuillets-actions" });
    this.iconBtn(actions, "layout-grid", "Tableau / plan", () =>
      this.plugin.activateBoard()
    );
    this.barSep(actions);
    /* Pas de "Mode concentration" ici : déjà une icône de ruban permanente
       (non masquable, voir registerRibbonIcons) et une commande de
       palette — la répéter dans le binder n'ajoute aucun accès réel.
       Ordre voulu : Double volet + son choix dossiers/fichiers groupés
       ensemble, puis Vue arbre séparément, puis Recherche/Filtres — plus
       d'icône réglages à part : "Double volet" répond au clic droit
       (showSplitPaneOptionsMenu : aperçu de la fiche + Affichage
       transversal), "Vue arbre" aussi (showTreeOptionsMenu). */
    /* Un seul bouton, à bascule : double volet -> fichiers seuls -> double
       volet -> ... — un bouton en moins que l'ancien "Double volet" +
       "Fichiers seuls" séparés. "Dossiers seuls" reste accessible au clic
       droit (showSplitPaneOptionsMenu) si besoin, pas dans ce cycle (déjà
       couvert par la vue arbre). */
    const isSplit = () => S.binderLayout === "split";
    const splitBtn = this.iconBtn(actions, "columns-2", "Double volet — cliquer pour basculer dossiers+fichiers/fichiers seuls, clic droit : options", async () => {
      // Depuis n'importe quel autre état (vue arbre, fichiers seuls) : double
      // volet. Depuis le double volet : fichiers seuls. Cycle à deux états.
      const next = isSplit() && this.currentSplitMode() === "both" ? "files" : "both";
      await this.applySplitPaneMode(next);
    });
    if (isSplit()) splitBtn.addClass("feuillets-mode-active");
    splitBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showSplitPaneOptionsMenu(e);
    });
    this.barSep(actions);

    const treeBtn = this.iconBtn(actions, "list-tree", "Vue arbre classique — clic droit : options", async () => {
      if (S.binderLayout === "tree") return;
      S.binderLayout = "tree";
      await this.plugin.saveSettings();
      /* structure DOM différente (arbre classique vs double volet) :
         un rendu complet est indispensable ici. */
      this.render(true);
      this.plugin.adjustSidebarWidth();
      setTimeout(() => this.plugin.adjustSidebarWidth(), 60);
    });
    if (S.binderLayout === "tree") treeBtn.addClass("feuillets-mode-active");
    treeBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showTreeOptionsMenu(e);
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
      this.renderProjectManagerSplitView(container, S);
      return;
    }

    this.barSep(header);
    const filterBar = header.createDiv({ cls: "feuillets-binder-filters" });

    const searchIsOpen =
      this._binderSearchOpen || !!(S.binderSearch || "").trim();
    const searchBtn = this.iconBtn(filterBar, "search", "Rechercher");
    searchBtn.addEventListener("click", () => {
      this._binderSearchOpen = !this._binderSearchOpen;
      if (!this._binderSearchOpen) {
        S.binderSearch = "";
        this.plugin.saveSettings().then(() => this.render(true));
      } else {
        this.render(true);
        setTimeout(() => {
          this.contentEl.querySelector(".feuillets-binder-search")?.focus();
        }, 50);
      }
    });
    if (searchIsOpen) searchBtn.addClass("feuillets-mode-active");

    /* Filtres combinés (ET logique) : statut × label × progression —
       même patron que le menu "Filtres" du Tableau/plan (board-view.js),
       propres au binder (réglages binderStatusFilter/binderLabelFilter/
       binderProgressFilter, indépendants de ceux du Tableau/plan). */
    const binderFilterIsActive = () =>
      (S.binderStatusFilter && S.binderStatusFilter !== "Tous") ||
      (S.binderLabelFilter && S.binderLabelFilter !== "Tous") ||
      (S.binderProgressFilter && S.binderProgressFilter !== "Tous");

    const filterBtn = this.iconBtn(
      filterBar,
      binderFilterIsActive() ? "filter" : "list-filter",
      "Filtres (statut, label, progression)"
    );
    if (binderFilterIsActive()) filterBtn.addClass("feuillets-mode-active");
    filterBtn.addEventListener("click", (e) => {
      const menu = new Menu();

      menu.addItem((item) => item.setTitle("— Statut —").setDisabled(true));
      for (const s of ["Tous", ...STATUSES.filter(Boolean), "Sans statut"]) {
        menu.addItem((item) =>
          item
            .setTitle(s)
            .setChecked((S.binderStatusFilter || "Tous") === s)
            .onClick(async () => {
              S.binderStatusFilter = s;
              await this.plugin.saveSettings();
              this.render(true);
            })
        );
      }
      menu.addSeparator();

      const activeLabels = new Set();
      const walkLabels = (f) => {
        for (const child of this.plugin.getOrderedChildren(f)) {
          if (child instanceof TFile) {
            const l = this.plugin.labelOf(child);
            if (l) activeLabels.add(l);
          } else if (child instanceof TFolder) {
            walkLabels(child);
          }
        }
      };
      walkLabels(folder);
      const meta = S.projectMeta ? S.projectMeta[folder.path] : null;
      const labelsList = (meta && meta.labels) ? meta.labels : (S.labels || []);
      labelsList.forEach((l) => {
        if (l.name) activeLabels.add(l.name);
      });
      const labelList = Array.from(activeLabels).sort((a, b) => a.localeCompare(b, "fr"));

      menu.addItem((item) => item.setTitle("— Label —").setDisabled(true));
      for (const lb of ["Tous", ...labelList, "Sans label"]) {
        menu.addItem((item) =>
          item
            .setTitle(lb)
            .setChecked((S.binderLabelFilter || "Tous") === lb)
            .onClick(async () => {
              S.binderLabelFilter = lb;
              await this.plugin.saveSettings();
              this.render(true);
            })
        );
      }
      menu.addSeparator();

      menu.addItem((item) => item.setTitle("— Progression —").setDisabled(true));
      for (const pr of ["Tous", "Atteint", "En dessous", "Dépassé"]) {
        menu.addItem((item) =>
          item
            .setTitle(pr)
            .setChecked((S.binderProgressFilter || "Tous") === pr)
            .onClick(async () => {
              S.binderProgressFilter = pr;
              await this.plugin.saveSettings();
              this.render(true);
            })
        );
      }

      if (binderFilterIsActive()) {
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("Réinitialiser tous les filtres")
            .setIcon("filter-x")
            .onClick(async () => {
              S.binderStatusFilter = "Tous";
              S.binderLabelFilter = "Tous";
              S.binderProgressFilter = "Tous";
              await this.plugin.saveSettings();
              this.render(true);
            })
        );
      }
      menu.showAtMouseEvent(e);
    });

    if ((S.binderSearch || "").trim() || binderFilterIsActive()) {
      const resetBtn = this.iconBtn(
        filterBar,
        "x",
        "Réinitialiser la recherche et les filtres"
      );
      resetBtn.addEventListener("click", async () => {
        S.binderSearch = "";
        S.binderStatusFilter = "Tous";
        S.binderLabelFilter = "Tous";
        S.binderProgressFilter = "Tous";
        this._binderSearchOpen = false;
        await this.plugin.saveSettings();
        this.render(true);
      });
    }

    /* Barre de recherche sur sa propre ligne, sous la barre d'icônes —
       plus lisible qu'un champ étriqué inséré entre les icônes. */
    if (searchIsOpen) {
      const searchRow = container.createDiv({ cls: "feuillets-binder-search-row" });
      const searchInput = searchRow.createEl("input", {
        type: "text",
        cls: "feuillets-binder-search",
        attr: { placeholder: "Rechercher…" },
      });
      searchInput.value = S.binderSearch || "";
      let searchTimer;
      searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        const caret = searchInput.selectionStart;
        searchTimer = setTimeout(async () => {
          S.binderSearch = searchInput.value;
          await this.plugin.saveSettings();
          await this.render(true);
          const fresh = this.contentEl.querySelector(".feuillets-binder-search");
          if (fresh) {
            fresh.focus();
            fresh.setSelectionRange(caret, caret);
          }
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
          this.render(true);
        }
      });

      /* Sélecteur de contexte : titre seul ou titre + contenu du texte
         (S.binderSearchContent existait déjà comme réglage caché, jamais
         exposé dans l'UI avant ce bouton). */
      const contentToggle = this.iconBtn(
        searchRow,
        S.binderSearchContent ? "file-search" : "file",
        S.binderSearchContent ? "Recherche dans le titre et le contenu — cliquer pour limiter au titre" : "Recherche dans le titre seul — cliquer pour inclure le contenu"
      );
      if (S.binderSearchContent) contentToggle.addClass("feuillets-mode-active");
      contentToggle.addEventListener("mousedown", (e) => e.preventDefault());
      contentToggle.addEventListener("click", async () => {
        this._suppressSearchBlurClose = true;
        S.binderSearchContent = !S.binderSearchContent;
        await this.plugin.saveSettings();
        this.render(true);
      });
    }

    const searchTerm = foldAccents((S.binderSearch || "").trim());
    let contentIndex = null;
    if (searchTerm && S.binderSearchContent) {
      contentIndex = await this.buildSearchIndex(
        this.plugin.flattenFiles(folder)
      );
      if (this._renderGen !== myGen) return;
    }

    const passesBinderFilter = (file) => {
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
        const st = this.fm(file).statut || "";
        if (sf === "Sans statut" ? st !== "" : st !== sf) return false;
      }
      const lf = S.binderLabelFilter;
      if (lf && lf !== "Tous") {
        const l = this.plugin.labelOf(file);
        if (lf === "Sans label" ? l !== "" : l !== lf) return false;
      }
      const pf = S.binderProgressFilter;
      if (pf && pf !== "Tous") {
        const wc = wcCache.get(file.path);
        const goal = this.goalFor(file);
        if (wc !== undefined && goal > 0) {
          const state = this.ringState(wc, goal);
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

    const folderHasMatch = (f) => {
      for (const file of this.plugin.flattenFiles(f)) {
        if (passesBinderFilter(file)) return true;
      }
      return false;
    };

    const numbering = this.plugin.buildNumbering(folder);
    const allFiles = this.plugin.flattenFiles(folder);
    const wcCache = await this.plugin.getWordCounts(allFiles);
    if (this._renderGen !== myGen) return;



    const renderFileRow = (
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
      item.style.paddingLeft = `${20 + depth * 14}px`;
      item.setAttr("data-path", file.path);

      const grip = item.createSpan({ cls: "feuillets-drag-grip" });
      setIcon(grip, "grip-vertical");

      if (!hidden && S.binderShowLabels) {
        const labelName = this.plugin.labelOf(file);
        const color = labelName ? this.plugin.labelColor(labelName) : null;
        if (color) item.style.boxShadow = `inset 3px 0 0 ${color}`;
      }

      const ring = item.createDiv({ cls: "feuillets-ring" });
      if (hidden || !S.binderShowProgress) ring.style.display = "none";

      const body = item.createDiv({ cls: "feuillets-item-body" });
      const nameRow = body.createDiv({ cls: "feuillets-item-name-row" });

      if (!hidden && S.binderShowStatus) {
        const st = this.fm(file).statut || "";
        if (st) {
          const dot = nameRow.createSpan({
            cls: `feuillets-status-dot feuillets-status-dot-${STATUSES.indexOf(st)}`,
          });
          dot.setAttr("title", `Statut : ${st}`);
        }
      }

      const num =
        hidden || opts.outOfProject
          ? ""
          : `${numbering.get(file.path) || ""} `;
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
          badge.setAttr("title", "Trouvé dans le texte du feuillet");
        }
      }

      if (!hidden && opts.showPreview && S.listPanePreviewField !== "none") {
        const field = S.listPanePreviewField;
        const lines = S.listPanePreviewLines || 2;
        if (field === "extrait") {
          const prev = body.createDiv({ cls: "feuillets-item-preview" });
          prev.style.maxHeight = `${lines * 1.4}em`;
          this.app.vault.cachedRead(file).then((content) => {
            const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
            const limit = S.excerptLength || 420;
            const clean = stripMarkdown(body.slice(0, limit + 200)).slice(0, limit);
            prev.setText(clean || "— vide —");
          });
        } else {
          let text = "";
          if (field === "tags") {
            text = this.plugin.tagsOf(file).map((t) => `#${t}`).join(" ");
          } else {
            text = (this.fm(file)[field] || "").toString().trim();
          }
          if (text) {
            const prev = body.createDiv({ cls: "feuillets-item-preview" });
            prev.style.maxHeight = `${lines * 1.4}em`;
            prev.setText(text);
          }
        }
      }

      if (!hidden && S.binderShowTags) {
        const tags = this.plugin.tagsOf(file);
        if (tags.length > 0) {
          const tagRow = body.createDiv({ cls: "feuillets-tags" });
          for (const t of tags) {
            tagRow.createSpan({ cls: "feuillets-tag-chip" }).setText(`#${t}`);
          }
        }
      }

      if (!hidden) {
        const wc = wcCache.get(file.path)?.wc || 0;
        if (S.binderShowProgress) this.fillRing(ring, wc, goal);
        if (S.binderShowWords) {
          body.createDiv({ cls: "feuillets-item-wc" }).setText(`${wc} mots`);
        }
      }

      item.addEventListener("click", () => {
        /* mis en surbrillance immédiatement, sans attendre les événements
           workspace ("active-leaf-change"/"file-open") : ceux-ci arrivent
           parfois après qu'un autre rendu ait déjà eu lieu, ou pendant que
           le focus transite encore vers la feuille de la scène cliquée —
           on connaît déjà le fichier ciblé, pas besoin de le redéduire. */
        highlightActive(this.contentEl, file.path);
        const leaf = this.plugin.getLeafForOpeningFile();
        openFileActivating(this.app, leaf, file);
        this.app.workspace.revealLeaf(leaf);
      });

      if (!hidden) {
        this.attachDragHandlers(grip, item, parent, i, siblings, dragScopeEl);
        item.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.showFileContextMenu(e, file, parent, i, siblings);
        });
      }
      return true;
    };

    if (S.binderLayout === "split") {
      this.renderSplitBody(container, folder, {
        S,
        numbering,
        binderFilterActive,
        folderHasMatch,
        renderFileRow,
      });
    } else {
      const list = container.createDiv({ cls: "feuillets-list" });

      const renderLevel = (parent, depth) => {
        const siblings = this.plugin.getOrderedChildren(parent);
        for (let i = 0; i < siblings.length; i++) {
          const child = siblings[i];
          const hidden =
            child.name.startsWith("_") ||
            parent.name.startsWith("_") ||
            parent.path.includes("/_");

          if (child instanceof TFolder) {
            if (!hidden && binderFilterActive && !folderHasMatch(child)) continue;
            const role = hidden ? "cachee" : this.plugin.roleOfFolder(child);
            const row = list.createDiv({
              cls:
                role === "partie"
                  ? "feuillets-folder-row"
                  : role === "cachee"
                  ? "feuillets-folder-row feuillets-hidden"
                  : "feuillets-item feuillets-chapter-folder",
            });
            row.style.paddingLeft = `${6 + depth * 14}px`;
            row.style.cursor = "pointer";
            row.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              this.showFolderContextMenu(e, child, parent, i, siblings);
            });

            if (role === "chapitre" || role === "partie") {
              const ring = row.createDiv({ cls: "feuillets-ring" });
              row
                .createDiv({ cls: "feuillets-item-body" })
                .createDiv({ cls: "feuillets-item-name" })
                .setText(
                  `${numbering.get(child.path) || ""} ${child.name}`.trim()
                );
              const cGoal = this.plugin.folderGoal(child);
              this.plugin.wordCountOfFolder(child).then((wc) => {
                if (S.binderShowProgress) this.fillRing(ring, wc, cGoal);
              });
              if (!S.binderShowProgress) ring.style.display = "none";
            } else {
              row
                .createSpan({ cls: "feuillets-folder-name" })
                .setText(child.name);
            }

            let addSub = null;
            if (!hidden) {
              addSub = row.createSpan({ cls: "feuillets-folder-add" });
              addSub.setText("+");
              addSub.setAttr(
                "title",
                role === "chapitre"
                  ? `Nouvelle ${this.plugin.unitLabel()} dans ce chapitre`
                  : "Nouveau feuillet dans cette partie"
              );
              addSub.addEventListener("click", (e) => {
                e.stopPropagation();
                this.plugin.newSheet(child);
              });
              this.attachDragHandlers(row, row, parent, i, siblings, list);
            }

            row.addEventListener("click", async (e) => {
              if (addSub && (e.target === addSub || addSub.contains(e.target))) return;
              if (S.collapsed[child.path]) delete S.collapsed[child.path];
              else S.collapsed[child.path] = true;
              await this.plugin.saveSettings();
              this.render();
            });

            if (!S.collapsed[child.path] || binderFilterActive) {
              renderLevel(child, depth + 1);
            }
          } else {
            renderFileRow(list, child, parent, i, siblings, depth, list);
          }
        }
      };

      renderLevel(folder, 0);
      // Pas de section Recherche ici (contrairement au double volet) : la
      // vue arbre se concentre uniquement sur le manuscrit.
    }

    this.updateActiveHighlight();
    this._restoreScroll(savedScroll);
  }

  /** Zones défilantes du binder, selon la mise en page : la liste racine
   * (vue arbre, enfant direct du conteneur) ou les deux volets (double
   * volet). On ne mémorise que celles réellement défilées (scrollTop > 0). */
  _captureScroll() {
    const out = [];
    const sels = [":scope > .feuillets-list", ".feuillets-tree-pane", ".feuillets-list-pane"];
    for (const sel of sels) {
      const el = this.contentEl.querySelector(sel);
      if (el && el.scrollTop > 0) out.push({ sel, top: el.scrollTop });
    }
    return out;
  }

  _restoreScroll(saved) {
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
    requestAnimationFrame(apply);
  }

  renderProjectManagerSplitView(container, S) {
    const split = container.createDiv({ cls: "feuillets-split" });
    split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth || 240}px`);

    const treePane = split.createDiv({ cls: "feuillets-tree-pane" });
    const resizer = split.createDiv({ cls: "feuillets-split-resizer" });
    const listPane = split.createDiv({ cls: "feuillets-list-pane" });

    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = S.binderTreeWidth || 240;
      const onMove = (ev) => {
        S.binderTreeWidth = Math.min(400, Math.max(140, startW + ev.clientX - startX));
        split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth}px`);
      };
      const onUp = async () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        await this.plugin.saveSettings();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Left Pane Header: Projets
    const treeHeader = treePane.createDiv({ cls: "feuillets-folder-row feuillets-tree-root" });
    const rootIcon = treeHeader.createDiv({ cls: "feuillets-cell-icon" });
    setIcon(rootIcon, "folder-cog");
    treeHeader.createSpan({ cls: "feuillets-folder-name" }).setText("Gérer les projets");

    const treeActions = treeHeader.createDiv({ cls: "feuillets-project-actions" });

    const newBtn = treeActions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
    setIcon(newBtn, "folder-plus");
    newBtn.setAttr("aria-label", "Créer un nouveau projet…");
    newBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      new NewProjectModal(this.app, this.plugin).open();
    });

    const importBtn = treeActions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
    setIcon(importBtn, "import");
    importBtn.setAttr("aria-label", "Importer un projet Scrivener…");
    importBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      new ScrivenerImportModal(this.app, this.plugin).open();
    });

    // Project List
    const projectListEl = treePane.createDiv({ cls: "feuillets-project-list" });
    projectListEl.style.padding = "4px 0";

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
        .setText("Aucun projet enregistré.");
    } else {
      for (const path of allProjects) {
        const folderObj = this.app.vault.getAbstractFileByPath(path);
        const folderExists = folderObj instanceof TFolder;
        const isActive = folderExists && path === S.projectFolder;
        const meta = S.projectMeta[path] || {};
        const row = projectListEl.createDiv({ cls: `feuillets-folder-row ${isActive ? "is-selected" : ""}` });
        row.style.paddingLeft = "12px";

        const icon = row.createDiv({ cls: "feuillets-cell-icon" });
        setIcon(icon, !folderExists ? "alert-triangle" : meta.icon || (isActive ? "folder-open" : "folder"));

        const nameSpan = row.createSpan({ cls: "feuillets-folder-name" });
        nameSpan.setText(
          folderExists
            ? this.plugin.projectDisplayName(path)
            : `${this.plugin.projectDisplayName(path)} (introuvable)`
        );
        if (!folderExists) {
          nameSpan.style.opacity = "0.6";
          nameSpan.style.fontStyle = "italic";
        }

        const actionsEl = row.createDiv({ cls: "feuillets-project-actions" });
        const removeBtn = actionsEl.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
        setIcon(removeBtn, "trash-2");
        removeBtn.setAttr("aria-label", "Retirer de la liste");
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          S.projects = (S.projects || []).filter((p) => p !== path);
          if (S.projectFolder === path) S.projectFolder = "";
          delete S.projectMeta[path];
          this.plugin.saveSettings().then(() => {
            this.plugin.renderAllViews(true);
          });
        });

        row.addEventListener("click", async () => {
          if (!folderExists) {
            new Notice(`Le dossier « ${path} » n'existe plus dans le coffre (supprimé ou déplacé).`);
            return;
          }
          S.projectFolder = path;
          await this.plugin.saveSettings();
          this.plugin.updateStatusBar();
          this.plugin.renderAllViews(true);
        });
      }
    }

    // Add existing folder input
    const addRow = treePane.createDiv({ cls: "feuillets-properties-add-row" });
    addRow.style.padding = "8px 10px";
    const addInput = addRow.createEl("input", {
      type: "text",
      attr: { placeholder: "Ajouter un dossier existant…" },
    });
    addInput.style.width = "100%";
    addInput.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const p = normalizePath(addInput.value.trim());
      if (!p) return;
      const folder = this.app.vault.getAbstractFileByPath(p);
      if (!(folder instanceof TFolder)) {
        new Notice("Dossier introuvable dans le coffre.");
        return;
      }
      S.projectFolder = p;
      if (!S.projects.includes(p)) S.projects.push(p);
      await this.plugin.saveSettings();
      addInput.value = "";
      this.plugin.updateStatusBar();
      this.plugin.renderAllViews(true);
    });

    // --- Right Pane: Hub & Cards ---
    const listBody = listPane.createDiv({ cls: "feuillets-list" });
    const hub = listBody.createDiv({ cls: "feuillets-project-hub" });
    hub.style.padding = "16px 14px";
    hub.style.display = "flex";
    hub.style.flexDirection = "column";
    hub.style.gap = "14px";

    const titleEl = hub.createEl("h3", { text: "Gestionnaire de projets Feuillets" });
    titleEl.style.marginTop = "0";
    titleEl.style.marginBottom = "4px";

    const subEl = hub.createDiv({ cls: "feuillets-notes-sub" });
    subEl.setText("Aucun projet n'est actuellement actif. Vous pouvez créer un nouveau projet, importer un projet Scrivener ou ajouter un dossier existant de votre coffre.");

    const cardsContainer = hub.createDiv({ cls: "feuillets-hub-cards" });
    cardsContainer.style.display = "flex";
    cardsContainer.style.flexDirection = "column";
    cardsContainer.style.gap = "10px";

    const makeHubCard = (icon, title, desc, btnText, onClick) => {
      const card = cardsContainer.createDiv({ cls: "feuillets-hub-card" });
      card.style.display = "flex";
      card.style.alignItems = "center";
      card.style.gap = "10px";
      card.style.padding = "12px 14px";
      card.style.border = "1px solid var(--background-modifier-border)";
      card.style.borderRadius = "var(--radius-m)";
      card.style.background = "var(--background-secondary-alt)";
      card.style.cursor = "pointer";

      const iconEl = card.createDiv({ cls: "feuillets-cell-icon" });
      iconEl.style.fontSize = "1.4em";
      setIcon(iconEl, icon);

      const textWrap = card.createDiv();
      textWrap.style.flex = "1";
      const cardTitle = textWrap.createDiv();
      cardTitle.style.fontWeight = "bold";
      cardTitle.setText(title);

      const cardDesc = textWrap.createDiv({ cls: "feuillets-notes-sub" });
      cardDesc.setText(desc);

      const btn = card.createEl("button", { text: btnText });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });

      card.addEventListener("click", onClick);
    };

    makeHubCard(
      "folder-plus",
      "Créer un nouveau projet",
      "Génère automatiquement la structure complète (Manuscrit, Recherche, Snapshots, Journal).",
      "Créer",
      () => new NewProjectModal(this.app, this.plugin).open()
    );

    makeHubCard(
      "import",
      "Importer un projet Scrivener",
      "Importe l'arborescence et les fiches depuis un projet Scrivener (.scriv).",
      "Importer",
      () => new ScrivenerImportModal(this.app, this.plugin).open()
    );

    makeHubCard(
      "folder-open",
      "Ajouter un dossier du coffre",
      "Spécifiez un dossier de votre coffre Obsidian pour l'utiliser comme manuscrit.",
      "Ajouter",
      () => addInput.focus()
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
  renderResearchSection(container, researchRoot) {
    const S = this.plugin.settings;

    const renderRow = (label, depth, isFolder) => {
      const row = container.createDiv({
        cls: isFolder ? "feuillets-folder-row feuillets-binder-research-row" : "feuillets-item feuillets-binder-research-row",
      });
      row.style.paddingLeft = `${6 + depth * 14}px`;
      const icon = row.createDiv({ cls: "feuillets-cell-icon" });
      setIcon(icon, depth === 0 ? "search" : isFolder ? "folder" : "file-text");
      row.createSpan({ cls: isFolder ? "feuillets-folder-name" : "feuillets-item-name" }).setText(label);
      return row;
    };

    // Clic droit sur un dossier de recherche (racine comprise) : créer un
    // sous-dossier ou un fichier dedans — mêmes actions que le manuscrit,
    // mais sans le reste du menu contextuel manuscrit (statut/label/
    // snapshot...), qui n'a pas de sens ici.
    const showResearchFolderMenu = (e, folder) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Nouveau dossier…")
          .setIcon("folder-plus")
          .onClick(() => this.plugin.newFolder(folder))
      );
      menu.addItem((item) =>
        item
          .setTitle("Nouveau fichier…")
          .setIcon("file-plus")
          .onClick(async () => {
            let name = "Nouveau fichier";
            let n = 2;
            while (this.app.vault.getAbstractFileByPath(normalizePath(`${folder.path}/${name}.md`))) {
              name = `Nouveau fichier ${n++}`;
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
    const showResearchFileMenu = (e, file) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Ouvrir dans un nouvel onglet")
          .setIcon("file-plus")
          .onClick(() => openFileActivating(this.app, this.app.workspace.getLeaf("tab"), file))
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle("Dupliquer")
          .setIcon("copy")
          .onClick(async () => {
            const content = await this.app.vault.read(file);
            let name = `${file.basename} (copie)`;
            let dest = normalizePath(`${file.parent.path}/${name}.md`);
            let k = 2;
            while (this.app.vault.getAbstractFileByPath(dest)) {
              name = `${file.basename} (copie ${k++})`;
              dest = normalizePath(`${file.parent.path}/${name}.md`);
            }
            await this.app.vault.create(dest, content);
            new Notice(`Dupliqué : ${name}`);
            this.render(true);
          })
      );
      menu.addItem((item) =>
        item
          .setTitle("Mettre à la corbeille")
          .setIcon("trash")
          .onClick(async () => {
            await this.app.vault.trash(file, true);
            new Notice(`« ${this.plugin.titleFor(file) || file.basename} » mis à la corbeille.`);
            this.render(true);
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
    rootRow.addEventListener("click", async () => {
      if (S.collapsed[researchRoot.path]) delete S.collapsed[researchRoot.path];
      else S.collapsed[researchRoot.path] = true;
      await this.plugin.saveSettings();
      this.render(true);
    });
    rootRow.addEventListener("contextmenu", (e) => showResearchFolderMenu(e, researchRoot));
    if (rootCollapsed) return;

    const renderChildren = (folder, depth) => {
      for (const child of this.plugin.getOrderedChildren(folder)) {
        if (child instanceof TFolder) {
          const row = renderRow(child.name, depth, true);
          const isCollapsed = !!S.collapsed[child.path];
          row.addEventListener("click", async () => {
            if (S.collapsed[child.path]) delete S.collapsed[child.path];
            else S.collapsed[child.path] = true;
            await this.plugin.saveSettings();
            this.render(true);
          });
          row.addEventListener("contextmenu", (e) => showResearchFolderMenu(e, child));
          if (!isCollapsed) renderChildren(child, depth + 1);
        } else if (child instanceof TFile) {
          const row = renderRow(this.plugin.titleFor(child), depth, false);
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

  renderSplitBody(container, root, ctx) {
    const {
      S,
      numbering,
      binderFilterActive,
      folderHasMatch,
      renderFileRow,
    } = ctx;

    const split = container.createDiv({ cls: "feuillets-split" });
    split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth}px`);

    const treePane = split.createDiv({ cls: "feuillets-tree-pane" });
    const resizer = split.createDiv({ cls: "feuillets-split-resizer" });
    const listPane = split.createDiv({ cls: "feuillets-list-pane" });

    if (S.binderTreeCollapsed) {
      split.addClass("is-tree-collapsed");
      treePane.addClass("is-tree-collapsed");
      resizer.addClass("is-tree-collapsed");
    } else if (S.binderListCollapsed) {
      split.addClass("is-list-collapsed");
      listPane.addClass("is-list-collapsed");
      resizer.addClass("is-list-collapsed");
    }

    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = S.binderTreeWidth;
      const onMove = (ev) => {
        S.binderTreeWidth = Math.min(360, Math.max(120, startW + ev.clientX - startX));
        split.style.setProperty("--feuillets-tree-w", `${S.binderTreeWidth}px`);
      };
      const onUp = async () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        await this.plugin.saveSettings();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    const treeRoot = root;

    let selected = this.app.vault.getAbstractFileByPath(S.binderSelectedPath || "");
    const inScope = (f) =>
      f instanceof TFolder && (f.path === root.path || f.path.startsWith(root.path + "/"));

    if (!inScope(selected)) {
      selected = treeRoot;
    }

    const selectFolder = async (f) => {
      S.binderSelectedPath = f.path;
      await this.plugin.saveSettings();
      this.render(true);
    };

    /* Racine du volet dossiers : bascule liste de projets / dossier courant.
       Clic sur la ligne -> affiche la liste des projets à la place de
       l'arborescence ; cliquer un projet de cette liste l'active ET revient
       à l'arborescence. Le "+" change de sens selon l'état affiché : nouveau
       dossier/import de plan en temps normal, gestionnaire de projets
       lorsqu'on regarde la liste des projets. */
    const showingProjects = !!this._showProjectList;

    const rootRow = treePane.createDiv({
      cls: "feuillets-folder-row feuillets-tree-root",
    });
    if (!showingProjects && selected.path === treeRoot.path) rootRow.addClass("is-selected");
    const rootIcon = rootRow.createDiv({ cls: "feuillets-cell-icon" });
    setIcon(rootIcon, showingProjects ? "list" : "book-marked");
    // Nom du projet (pas le nom brut du dossier : un projet structuré en
    // <NomDuProjet>/Manuscrit/ afficherait sinon juste "Manuscrit" pour
    // tous les projets — projectDisplayName remonte au vrai nom).
    rootRow.createSpan({ cls: "feuillets-folder-name" }).setText(
      showingProjects ? "Choisir un projet" : this.plugin.projectDisplayName(treeRoot.path)
    );

    const rootAdd = rootRow.createSpan({ cls: "feuillets-folder-add" });
    // Icône distincte en mode "liste des projets" : un simple "+" laissait
    // croire à un ajout de dossier, pas à la gestion des projets.
    if (showingProjects) setIcon(rootAdd, "settings");
    else rootAdd.setText("+");
    rootAdd.setAttr("title", showingProjects ? "Gérer les projets…" : "Nouveau dossier…");
    rootAdd.addEventListener("click", (e) => {
      e.stopPropagation();
      if (showingProjects) {
        new ManageProjectsModal(this.app, this.plugin).open();
        return;
      }
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Nouveau dossier…")
          .setIcon("folder-plus")
          .onClick(() => this.plugin.newFolder(root))
      );
      menu.addItem((item) =>
        item
          .setTitle("Importer un plan…")
          .setIcon("list-tree")
          .onClick(() => new ImportOutlineModal(this.app, this.plugin).open())
      );
      menu.showAtMouseEvent(e);
    });

    rootRow.addEventListener("click", (e) => {
      if (e.target === rootAdd || rootAdd.contains(e.target)) return;
      if (showingProjects) {
        // Reclic sur la ligne "Choisir un projet" : retour à l'arborescence.
        this._showProjectList = false;
        this.render(true);
        return;
      }
      this._showProjectList = true;
      this.render(true);
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

    const renderTreeFolders = (parent, depth) => {
      if (treeTruncated) return;
      const siblings = this.plugin.getOrderedChildren(parent);
      for (let i = 0; i < siblings.length; i++) {
        const child = siblings[i];
        if (!(child instanceof TFolder)) continue;
        const hidden = child.name.startsWith("_") || parent.path.includes("/_");
        if (hidden) continue;
        if (binderFilterActive && !folderHasMatch(child)) continue;

        if (treeRowCount >= MAX_TREE_ROWS) {
          treeTruncated = true;
          const warn = treePane.createDiv({ cls: "feuillets-empty" });
          warn.setText(`Affichage limité à ${MAX_TREE_ROWS} dossiers (projet très volumineux) — replie certains dossiers pour voir le reste.`);
          return;
        }
        treeRowCount++;

        const role = this.plugin.roleOfFolder(child);
        const row = treePane.createDiv({ cls: "feuillets-folder-row" });
        if (depth === 0) row.addClass("is-depth-0");
        row.style.paddingLeft = `${6 + depth * 14}px`;
        if (selected.path === child.path) row.addClass("is-selected");

        const grip = row.createSpan({ cls: "feuillets-drag-grip" });
        setIcon(grip, "grip-vertical");

        const icon = row.createDiv({ cls: "feuillets-cell-icon" });
        setIcon(icon, role === "partie" ? "folder" : "folder-open");

        row.createSpan({ cls: "feuillets-folder-name" }).setText(child.name);

        const addBtn = row.createSpan({ cls: "feuillets-folder-add" });
        addBtn.setText("+");
        addBtn.setAttr("title", `Ajouter dans « ${child.name} »`);
        addBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const menu = new Menu();
          menu.addItem((item) =>
            item
              .setTitle("Nouveau sous-dossier…")
              .setIcon("folder-plus")
              .onClick(() => this.plugin.newFolder(child))
          );
          menu.addItem((item) =>
            item
              .setTitle("Nouveau feuillet ici")
              .setIcon("file-plus")
              .onClick(async () => {
                await selectFolder(child);
                this.plugin.newSheet(child);
              })
          );
          menu.showAtMouseEvent(e);
        });

        row.addEventListener("click", async (e) => {
          if (e.target === addBtn || addBtn.contains(e.target)) return;
          // Toggle collapse
          if (S.collapsed[child.path]) delete S.collapsed[child.path];
          else S.collapsed[child.path] = true;
          await this.plugin.saveSettings();
          await selectFolder(child);
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.showFolderContextMenu(e, child, parent, i, siblings);
        });

        this.attachDragHandlers(grip, row, parent, i, siblings, split);

        if (!S.collapsed[child.path] || binderFilterActive) {
          renderTreeFolders(child, depth + 1);
        }
      }
    };

    if (showingProjects) {
      const allPaths = [S.projectFolder, ...(S.projects || [])]
        .filter(Boolean)
        // Alphabétique, insensible à la casse ("même casse" pour tous —
        // sinon "Zoo" passerait avant "abricot", trié par code de caractère).
        .sort((a, b) =>
          this.plugin.projectDisplayName(a).localeCompare(
            this.plugin.projectDisplayName(b), "fr", { sensitivity: "base" }
          )
        );
      for (const path of allPaths) {
        const isActive = path === S.projectFolder;
        const meta = S.projectMeta[path] || {};
        const row = treePane.createDiv({ cls: "feuillets-folder-row" });
        row.style.paddingLeft = "20px";
        if (isActive) row.addClass("is-selected");
        const icon = row.createDiv({ cls: "feuillets-cell-icon" });
        setIcon(icon, meta.icon || (isActive ? "folder-open" : "folder"));
        row.createSpan({ cls: "feuillets-folder-name" }).setText(this.plugin.projectDisplayName(path));
        row.addEventListener("click", async () => {
          if (!isActive) {
            if (S.projectFolder && !S.projects.includes(S.projectFolder)) {
              S.projects.push(S.projectFolder);
            }
            S.projects = S.projects.filter((p) => p !== path);
            S.projectFolder = path;
            await this.plugin.saveSettings();
            this.plugin.updateStatusBar();
          }
          this._showProjectList = false;
          this.plugin.renderAllViews(true);
        });
      }
    } else {
      renderTreeFolders(treeRoot, 0);

      const researchRoot = this.plugin.getResearchRoot();
      if (!treeTruncated && researchRoot instanceof TFolder) {
        this.renderResearchSection(treePane, researchRoot);
      }
    }

    const listBody = listPane.createDiv({ cls: "feuillets-list" });
    let any = false;

    // Même filet de sécurité que côté dossiers : la liste récursive de tout
    // un vault de plusieurs milliers de notes pouvait construire un DOM
    // énorme d'un coup et planter Obsidian.
    const MAX_LIST_ROWS = 2000;
    let listRowCount = 0;
    let listTruncated = false;

    const renderFilesOf = (folder, depth) => {
      if (listTruncated) return;
      const kids = this.plugin.getOrderedChildren(folder);
      const files = kids.filter((c) => c instanceof TFile);
      // Le nom du dossier (sous-titre) enroule/déroule ses feuillets ET ses
      // sous-dossiers dans CE volet — indépendant du repli du volet dossiers
      // (même S.collapsed, mais rien n'oblige les deux volets à s'accorder
      // visuellement, seul l'état logique est partagé).
      const isCollapsed = depth > 0 && !!S.collapsed[folder.path];
      if (depth > 0 && files.length > 0) {
        const heading = listBody.createDiv({ cls: "feuillets-list-subheading" });
        heading.setText(folder.name);
        heading.style.cursor = "pointer";
        heading.addEventListener("click", async () => {
          if (S.collapsed[folder.path]) delete S.collapsed[folder.path];
          else S.collapsed[folder.path] = true;
          await this.plugin.saveSettings();
          this.render(true);
        });
      }

      if (!isCollapsed) {
        for (let i = 0; i < kids.length; i++) {
          const child = kids[i];
          if (!(child instanceof TFile)) continue;

          if (listRowCount >= MAX_LIST_ROWS) {
            listTruncated = true;
            listBody
              .createDiv({ cls: "feuillets-empty" })
              .setText(`Affichage limité à ${MAX_LIST_ROWS} feuillets (projet très volumineux) — choisis un dossier plus précis, ou désactive la liste récursive.`);
            return;
          }

          const shown = renderFileRow(listBody, child, folder, i, kids, 0, split, {
            showPreview: true,
            outOfProject:
              !child.path.startsWith(root.path + "/") && child.path !== root.path,
          });
          if (shown) {
            any = true;
            listRowCount++;
          }
        }
      }

      if (!isCollapsed && S.binderSplitRecursive !== false) {
        for (const c of kids) {
          if (listTruncated) return;
          if (c instanceof TFolder) renderFilesOf(c, depth + 1);
        }
      }
    };

    renderFilesOf(selected, 0);

    if (!any) {
      listBody
        .createDiv({ cls: "feuillets-empty" })
        .setText(
          S.binderSplitRecursive !== false
            ? "Aucun feuillet dans ce dossier ni ses sous-dossiers."
            : "Aucun feuillet directement dans ce dossier."
        );
    }
  }
}
