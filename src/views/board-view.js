import { DEFAULT_SETTINGS } from "../default-settings.js";
import { VIEW_BOARD, STATUSES, BOARD_MODES } from "../constants.js";
import { highlightActive, isEditing, getActiveFileSafe, openFileActivating } from "../utils/dom.js";
import { filsOf } from "../utils/arc-fields.js";

import { ImportOutlineModal } from "../ui/import-outline-modal.js";
import { CompileSelectionModal, ReadSelectionModal } from "../ui/selection-modals.js";
import { NewProjectModal, ProjectManagerModal } from "../ui/project-modals.js";
import { FmFieldModal } from "../ui/fm-field-modal.js";
import { TagsModal } from "../ui/entity-modals.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { PROJECT_MODES, resolveType } from "../utils/project-modes.js";
const { Menu, TFile, TFolder, setIcon, MarkdownRenderer, Notice, Platform } = require("obsidian");

export class BoardView extends BaseFeuilletsView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.focusedFolderPath = null;
  }
  getViewType() {
    return VIEW_BOARD;
  }
  getDisplayText() {
    return "Feuillets — Tableau";
  }
  getIcon() {
    return "layout-grid";
  }
  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () =>
        this.updateActiveHighlight()
      )
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateActiveHighlight())
    );
    await this.render();
  }

  /** Même principe que le binder : nettoyage complet puis réassignation
   * unique, pour ne jamais laisser une ligne bloquée en surbrillance
   * quelle qu'en soit la cause. */
  updateActiveHighlight() {
    highlightActive(this.contentEl, getActiveFileSafe(this.app)?.path);
  }

  async render(force = false) {
    return this._render(force);
  }

  passesFilter(file) {
    const S = this.plugin.settings;
    const f = S.statusFilter;
    if (f && f !== "Tous") {
      const st = this.fm(file).statut || "";
      if (f === "Sans statut" ? st !== "" : st !== f) return false;
    }
    const lf = S.labelFilter;
    if (lf && lf !== "Tous") {
      const l = this.plugin.labelOf(file);
      if (lf === "Sans label" ? l !== "" : l !== lf) return false;
    }
    const tf = (S.tagFilter || "").trim().toLowerCase().replace(/^#/, "");
    if (tf) {
      const tags = this.plugin.tagsOf(file).map((t) => t.toLowerCase());
      if (!tags.some((t) => t.includes(tf))) return false;
    }
    const pf = S.progressFilter;
    if (pf && pf !== "Tous" && this.wcMap) {
      const wc = this.wcMap.get(file.path);
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
  }

  filterActive() {
    const S = this.plugin.settings;
    return (
      (S.statusFilter && S.statusFilter !== "Tous") ||
      (S.labelFilter && S.labelFilter !== "Tous") ||
      (S.progressFilter && S.progressFilter !== "Tous") ||
      (S.tagFilter || "").trim() !== ""
    );
  }

  /** Rend un élément cible de dépôt : y lâcher un feuillet le déplace
   * DANS le dossier, en dernière position. */
  attachDropInto(el, folder) {
    el.addEventListener("dragover", (e) => {
      if (!this.plugin.dragState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.addClass("feuillets-dragover");
    });
    el.addEventListener("dragleave", () => el.removeClass("feuillets-dragover"));
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.removeClass("feuillets-dragover");
      if (!this.plugin.dragState) return;
      const drag = this.plugin.dragState;
      this.plugin.dragState = null;
      const moved = this.app.vault.getAbstractFileByPath(drag.path || "");
      const srcParent = this.app.vault.getAbstractFileByPath(drag.parentPath);
      if (!moved || !(srcParent instanceof TFolder)) return;
      if (drag.parentPath === folder.path) return; // déjà dedans
      await this.plugin.moveNode(
        moved,
        srcParent,
        folder,
        Number.MAX_SAFE_INTEGER
      );
      this.plugin.renderAllViews(true);
    });
  }

  gridStyle(grid) {
    const S = this.plugin.settings;
    if (S.columns > 0) {
      grid.style.gridTemplateColumns = `repeat(${S.columns}, 1fr)`;
    } else {
      grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${S.tileSize}px, 1fr))`;
    }
  }

  async _render(force = false) {
    const container = this.contentEl;
    if (!force && isEditing(container)) return;
    /* jeton de génération : si un rendu du plan est en cours par paquets
       (voir renderOutline) et qu'un nouveau rendu démarre entre-temps,
       le paquet en cours doit s'arrêter au prochain point de contrôle au
       lieu de continuer à peupler un tableau devenu obsolète. */
    const myGen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-board-container");

    const S = this.plugin.settings;
    container.style.fontSize = `${S.fontSize}px`;
    container.style.zoom = `${S.uiScale}%`;

    const folder = this.getProjectFolder();
    if (!folder) {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText("Aucun dossier projet défini (réglages du plugin).");
      return;
    }
    let boardFolder = folder;
    if (this.focusedFolderPath) {
      const f = this.app.vault.getAbstractFileByPath(this.focusedFolderPath);
      if (f instanceof TFolder && f.path.startsWith(folder.path)) {
        boardFolder = f;
      } else {
        this.focusedFolderPath = null;
      }
    }
    if (!S.projectMeta) S.projectMeta = {};
    if (!S.projectMeta[folder.path]) S.projectMeta[folder.path] = {};
    const meta = S.projectMeta[folder.path];
    const pType = resolveType(meta.type);
    const pMode = PROJECT_MODES[pType] || PROJECT_MODES.fiction;
    let currentMode = meta.boardMode || pMode.defaults.boardMode;
    this.currentCardContent = meta.cardContent || pMode.defaults.cardContent;

    console.log("Feuillets Board debug:", {
      folderPath: folder.path,
      metaType: meta.type,
      resolvedType: pType,
      savedBoardMode: meta.boardMode,
      defaultBoardMode: pMode.defaults.boardMode,
      currentMode: currentMode
    });

    let hiddenBoardModes = meta.hiddenBoardModes || S.hiddenBoardModes || [];

    if (currentMode === "research") currentMode = "board";
    let visibleModeKeys = BOARD_MODES.map(([m]) => m).filter(
      (m) => !hiddenBoardModes.includes(m)
    );
    if (visibleModeKeys.length === 0) visibleModeKeys = BOARD_MODES.map(([m]) => m);
    if (!visibleModeKeys.includes(currentMode)) currentMode = visibleModeKeys[0];
    const mode = currentMode;
    if (!this.sceneSelection) this.sceneSelection = new Set();
    if (this.selectionModeActive === undefined) this.selectionModeActive = false;

    /* plus de titre « Manuscrit » ni de statistiques dans la barre : on
       sait où on est (demande d'Halim), et ces infos vivent déjà dans la
       barre d'état en bas. La barre ne contient plus que les actions. */
    const bar = container.createDiv({ cls: "feuillets-board-bar" });
    const right = bar.createDiv({ cls: "feuillets-board-bar-right" });

    /* filtres combinés (ET logique) : statut × label × progression × tag,
       regroupés dans un seul menu — trois <select> affichant chacun "Tous"
       ne disaient pas ce qu'ils filtraient une fois repliés. */
    this.iconBtn(
      right,
      this.filterActive() ? "filter" : "list-filter",
      "Filtres (statut, label, progression)",
      (e) => {
        const menu = new Menu();

        menu.addItem((item) => item.setTitle("— Statut —").setDisabled(true));
        for (const st of ["Tous", ...STATUSES.filter(Boolean), "Sans statut"]) {
          menu.addItem((item) =>
            item
              .setTitle(st)
              .setChecked((S.statusFilter || "Tous") === st)
              .onClick(async () => {
                S.statusFilter = st;
                await this.plugin.saveSettings();
                this.render();
              })
          );
        }
        menu.addSeparator();

        const activeLabels = new Set();
        const root = this.plugin.getProjectFolder();
        if (root) {
          const walk = (folder) => {
            for (const child of this.plugin.getOrderedChildren(folder)) {
              if (child instanceof TFile) {
                const l = this.plugin.labelOf(child);
                if (l) activeLabels.add(l);
              } else if (child instanceof TFolder) {
                walk(child);
              }
            }
          };
          walk(root);
        }
        const meta = root ? S.projectMeta[root.path] : null;
        const labelsList = (meta && meta.labels) ? meta.labels : (S.labels || []);
        labelsList.forEach((l) => {
          if (l.name) activeLabels.add(l.name);
        });
        const labelList = Array.from(activeLabels).sort((a, b) => a.localeCompare(b, "fr"));

        menu.addItem((item) => item.setTitle("— Label —").setDisabled(true));
        for (const lb of [
          "Tous",
          ...labelList,
          "Sans label",
        ]) {
          menu.addItem((item) =>
            item
              .setTitle(lb)
              .setChecked((S.labelFilter || "Tous") === lb)
              .onClick(async () => {
                S.labelFilter = lb;
                await this.plugin.saveSettings();
                this.render();
              })
          );
        }
        menu.addSeparator();

        menu.addItem((item) =>
          item.setTitle("— Progression —").setDisabled(true)
        );
        for (const pr of ["Tous", "Atteint", "En dessous", "Dépassé"]) {
          menu.addItem((item) =>
            item
              .setTitle(pr)
              .setChecked((S.progressFilter || "Tous") === pr)
              .onClick(async () => {
                S.progressFilter = pr;
                await this.plugin.saveSettings();
                this.render();
              })
          );
        }

        if (this.filterActive()) {
          menu.addSeparator();
          menu.addItem((item) =>
            item
              .setTitle("Réinitialiser tous les filtres")
              .setIcon("filter-x")
              .onClick(async () => {
                S.statusFilter = "Tous";
                S.labelFilter = "Tous";
                S.progressFilter = "Tous";
                S.tagFilter = "";
                await this.plugin.saveSettings();
                this.render();
              })
          );
        }
        menu.showAtMouseEvent(e);
      }
    );

    const tagInput = right.createEl("input", {
      cls: "feuillets-tag-filter",
      type: "text",
      attr: { placeholder: "#tag…" },
    });
    tagInput.value = S.tagFilter || "";
    tagInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        S.tagFilter = tagInput.value.trim();
        await this.plugin.saveSettings();
        tagInput.blur();
        this.render();
      }
    });

    const setMode = (m) => async () => {
      if (meta) {
        meta.boardMode = m;
      }
      S.boardMode = m;
      await this.plugin.saveSettings();
      this.render();
    };
    const modeGroup = right.createDiv({ cls: "feuillets-mode-group" });
    const MODE_ICONS = {
      board: "layout-grid",
      outline: "list-tree",
      arcs: "git-branch",
      timeline: "milestone",
      read: "book-open-text",
    };
    for (const [m, defaultLabel] of BOARD_MODES) {
      if (!visibleModeKeys.includes(m)) continue;
      const btn = this.iconBtn(modeGroup, MODE_ICONS[m], defaultLabel, setMode(m));
      if (mode === m) btn.addClass("feuillets-mode-active");
    }

    this.iconBtn(modeGroup, "eye", "Modes affichés", (e) => {
      const menu = new Menu();
      for (const [m, defaultLabel] of BOARD_MODES) {
        menu.addItem((item) =>
          item
            .setTitle(defaultLabel)
            .setChecked(visibleModeKeys.includes(m))
            .onClick(async () => {
              const hidden = new Set(hiddenBoardModes);
              if (hidden.has(m)) hidden.delete(m);
              else hidden.add(m);
              const newHidden = [...hidden];
              if (meta) {
                meta.hiddenBoardModes = newHidden;
              }
              S.hiddenBoardModes = newHidden;
              await this.plugin.saveSettings();
              this.render(true);
            })
        );
      }
      menu.showAtMouseEvent(e);
    });

    /* Actions de scène (fusionner/dupliquer/déplacer) : disponibles en
       Cartes/Plan/Chronologie, pas en Lecture qui reste un mode de lecture
       continue pure. Un seul point d'entrée qui active un mode sélection
       (cases à cocher discrètes sur les lignes/cartes) plutôt que des
       cases visibles en permanence. */
    if (mode !== "read" && mode !== "arcs") {
      const selCount = this.sceneSelection.size;
      const resolveSelected = () =>
        [...this.sceneSelection]
          .map((p) => this.app.vault.getAbstractFileByPath(p))
          .filter((f) => f instanceof TFile);
      const exitSelection = () => {
        this.sceneSelection.clear();
        this.selectionModeActive = false;
        this.render(true);
      };

      const unit = this.plugin.unitLabel();
      const unitPlural = this.plugin.unitLabelPlural();

      const selBtn = this.iconBtn(
        right,
        "list-checks",
        this.selectionModeActive
          ? `Actions de ${unit} (${selCount} sélectionnée${selCount > 1 ? "s" : ""})`
          : `Sélectionner des ${unitPlural}…`,
        (e) => {
          const menu = new Menu();
          if (!this.selectionModeActive) {
            menu.addItem((item) =>
              item
                .setTitle(`Sélectionner des ${unitPlural}…`)
                .setIcon("list-checks")
                .onClick(() => {
                  this.selectionModeActive = true;
                  this.render(true);
                })
            );
            menu.showAtMouseEvent(e);
            return;
          }
          menu.addItem((item) =>
            item
              .setTitle(`Fusionner (${selCount})`)
              .setIcon("git-merge")
              .setDisabled(selCount < 2)
              .onClick(() => {
                const files = resolveSelected();
                exitSelection();
                if (files.length < 2) {
                  new Notice(`Sélectionne au moins deux ${unitPlural} à fusionner.`);
                  return;
                }
                this.plugin.openMergeModal(files);
              })
          );
          menu.addItem((item) =>
            item
              .setTitle(`Dupliquer (${selCount})`)
              .setIcon("copy")
              .setDisabled(selCount < 1)
              .onClick(async () => {
                const files = resolveSelected();
                exitSelection();
                if (files.length > 0) await this.plugin.duplicateManyScenes(files);
              })
          );
          menu.addItem((item) =>
            item
              .setTitle(`Déplacer (${selCount})…`)
              .setIcon("move")
              .setDisabled(selCount < 1)
              .onClick(() => {
                const files = resolveSelected();
                exitSelection();
                if (files.length > 0) this.plugin.openMoveManyModal(files);
              })
          );
          menu.addSeparator();
          menu.addItem((item) =>
            item
              .setTitle("Quitter le mode sélection")
              .setIcon("x")
              .onClick(exitSelection)
          );
          menu.showAtMouseEvent(e);
        }
      );
      if (this.selectionModeActive) selBtn.addClass("feuillets-mode-active");
    }

    if (mode === "timeline" && folder) {
      const tagSel = right.createEl("select", { cls: "feuillets-filter" });
      tagSel.setAttr("title", "Focale : filtrer les jalons de _Chronologie par tag");
      const optAll = tagSel.createEl("option", { text: "Tous les jalons" });
      optAll.value = "";
      /* tags rencontrés dans _Chronologie */
      const chronoFolder = this.plugin.getChronoFolder();
      if (chronoFolder instanceof TFolder) {
        const tagSet = new Set();
        const walk = (cf) => {
          for (const c of cf.children) {
            if (c instanceof TFolder) walk(c);
            else if (c instanceof TFile && c.extension === "md") {
              for (const t of this.plugin.tagsOf(c)) tagSet.add(t);
            }
          }
        };
        walk(chronoFolder);
        for (const t of [...tagSet].sort((a, b) => a.localeCompare(b, "fr"))) {
          const opt = tagSel.createEl("option", { text: `#${t}` });
          opt.value = t;
        }
      }
      tagSel.value = S.timelineTagFilter || "";
      tagSel.addEventListener("change", async () => {
        S.timelineTagFilter = tagSel.value;
        await this.plugin.saveSettings();
        tagSel.blur();
        this.render();
      });
    }

    if (mode === "read" && folder) {
      /* périmètre de lecture : seul réglage du mode, donc son propre point
         d'entrée dans la barre plutôt que dans "Options de la vue" (qui ne
         s'affiche pas pour ce mode, voir plus bas). */
      const scopeSel = right.createEl("select", { cls: "feuillets-filter" });
      scopeSel.setAttr("title", "Périmètre de lecture");
      const optAll = scopeSel.createEl("option", { text: "Tout le manuscrit" });
      optAll.value = "";
      const addScopes = (parent, depth) => {
        for (const child of this.plugin.getOrderedChildren(parent)) {
          if (child instanceof TFolder) {
            const opt = scopeSel.createEl("option", {
              text: `${"  ".repeat(depth)}${child.name}`,
            });
            opt.value = child.path;
            addScopes(child, depth + 1);
          }
        }
      };
      addScopes(folder, 0);
      const optSel = scopeSel.createEl("option", { text: "Sélection manuelle…" });
      optSel.value = "__selection__";
      scopeSel.value = S.readScope || "";
      scopeSel.addEventListener("change", async () => {
        if (scopeSel.value === "__selection__") {
          new ReadSelectionModal(this.app, this.plugin, () =>
            this.render(true)
          ).open();
          return;
        }
        S.readScope = scopeSel.value;
        await this.plugin.saveSettings();
        scopeSel.blur();
        this.render();
      });
      if (S.readScope === "__selection__") {
        const editSelBtn = right.createEl("button", {
          text: "Modifier la sélection",
        });
        editSelBtn.addEventListener("click", () => {
          new ReadSelectionModal(this.app, this.plugin, () =>
            this.render(true)
          ).open();
        });
      }
    }

    /* sous-menu d'options propre au mode actif — absent en Lecture et en
       Arcs, qui n'ont pas de réglage additionnel à proposer ici. */
    if (mode !== "read" && mode !== "arcs") this.iconBtn(right, "sliders-horizontal", "Options de la vue", (e) => {
      const menu = new Menu();
      const toggle = (key, label, onAfter) =>
        menu.addItem((item) =>
          item
            .setTitle(label)
            .setChecked(!!S[key])
            .onClick(async () => {
              S[key] = !S[key];
              await this.plugin.saveSettings();
              if (onAfter) onAfter();
              this.render();
            })
        );

      if (mode === "board") {
        menu.addItem((item) =>
          item.setTitle("— Cartes —").setDisabled(true)
        );
        toggle("showProgress", "Barres de progression");
        toggle("showCardTags", "Tags sur les tuiles");
        menu.addSeparator();
        const contentOptions = pType === "nonfiction"
          ? [
              ["extrait", "Corps : extrait du texte"],
              ["resume", "Corps : résumé"],
            ]
          : [
              ["extrait", "Corps : extrait du texte"],
              ["synopsis", "Corps : synopsis"],
            ];
        for (const [v, label] of contentOptions) {
          menu.addItem((item) =>
            item
              .setTitle(label)
              .setChecked(this.currentCardContent === v)
              .onClick(async () => {
                if (meta) {
                  meta.cardContent = v;
                }
                S.cardContent = v;
                await this.plugin.saveSettings();
                this.render();
              })
          );
        }
        menu.addSeparator();
        for (const [size, label] of [
          [180, "Tuiles petites"],
          [240, "Tuiles moyennes"],
          [320, "Tuiles grandes"],
        ]) {
          menu.addItem((item) =>
            item
              .setTitle(label)
              .setChecked(S.tileSize === size)
              .onClick(async () => {
                S.tileSize = size;
                await this.plugin.saveSettings();
                this.render();
              })
          );
        }
      } else if (mode === "outline") {
        menu.addItem((item) => item.setTitle("— Plan —").setDisabled(true));
        toggle("showProgress", "Barres de progression");
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("Réinitialiser la largeur des colonnes")
            .onClick(async () => {
              S.outlineWidths = Object.assign(
                {},
                DEFAULT_SETTINGS.outlineWidths
              );
              await this.plugin.saveSettings();
              this.render();
            })
        );
      } else if (mode === "timeline") {
        menu.addItem((item) =>
          item.setTitle("— Chronologie —").setDisabled(true)
        );
        for (const [v, label] of [
          ["chrono", "Ordre chronologique"],
          ["narratif", "Ordre narratif"],
        ]) {
          menu.addItem((item) =>
            item
              .setTitle(label)
              .setChecked(S.timelineOrder === v)
              .onClick(async () => {
                S.timelineOrder = v;
                await this.plugin.saveSettings();
                this.render();
              })
          );
        }
        menu.addSeparator();
        for (const [v, label] of [
          ["siecle", "Échelle : siècle"],
          ["annee", "Échelle : année"],
          ["mois", "Échelle : mois"],
          ["jour", "Échelle : jour"],
          ["aucune", "Échelle : sans en-têtes"],
        ]) {
          menu.addItem((item) =>
            item
              .setTitle(label)
              .setChecked((S.timelineScale || "annee") === v)
              .onClick(async () => {
                S.timelineScale = v;
                await this.plugin.saveSettings();
                this.render();
              })
          );
        }
      }
      menu.showAtMouseEvent(e);
    });

    if (mode === "outline") {
      const colsBtn = this.iconBtn(right, "columns-3", "Colonnes affichées");
      colsBtn.addEventListener("click", (e) => {
        const menu = new Menu();
        const defs = [
          ["synopsis", "Synopsis"],
          ["resume", "Résumé"],
          ["notes", "Notes"],
          ["tags", "Tags"],
          ["label", "Label"],
          ["status", "Statut"],
          ["date", "Date"],
          ["compiler", "Compiler"],
          ["filename", "Fichier"],
          ["words", "Mots"],
          ["goal", "Objectif"],
          ["progress", "Progression"],
        ];
        for (const [id, label] of defs) {
          menu.addItem((item) =>
            item
              .setTitle(label)
              .setChecked(!!S.outlineCols[id])
              .onClick(async () => {
                S.outlineCols[id] = !S.outlineCols[id];
                await this.plugin.saveSettings();
                this.render();
              })
          );
        }
        menu.showAtMouseEvent(e);
      });
    }

    this.barSep(right);

    /* groupe « écrire » : créer, annuler */
    const addBtn = this.iconBtn(
      right,
      "file-plus",
      "Nouveau feuillet (racine)"
    );
    const addFolderBtn = this.iconBtn(
      right,
      "folder-plus",
      "Nouveau dossier / importer un plan"
    );
    this.iconBtn(right, "undo-2", "Annuler le dernier déplacement", () =>
      this.app.commands.executeCommandById("feuillets:undo-move")
    );

    this.barSep(right);

    /* groupe « projet » : gestion, réglages */
    this.iconBtn(right, "library", "Projets", (e) => {
      const menu = new Menu();
      const allProjects = [S.projectFolder, ...(S.projects || [])].filter(
        (p, i, a) => p && a.indexOf(p) === i
      );
      for (const p of allProjects) {
        menu.addItem((item) =>
          item
            .setTitle(this.plugin.projectDisplayName(p))
            .setChecked(p === S.projectFolder)
            .onClick(async () => {
              if (p === S.projectFolder) return;
              S.projectFolder = p;
              await this.plugin.saveSettings();
              this.plugin.renderAllViews(true);
              this.plugin.updateStatusBar();
            })
        );
      }
      if (allProjects.length > 0) menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle("Créer un nouveau projet…")
          .setIcon("folder-plus")
          .onClick(() => new NewProjectModal(this.app, this.plugin).open())
      );
      menu.addItem((item) =>
        item
          .setTitle("Gestion des projets…")
          .setIcon("settings-2")
          .onClick(() => new ProjectManagerModal(this.app, this.plugin).open())
      );
      menu.showAtMouseEvent(e);
    });
    this.iconBtn(right, "settings", "Réglages du plugin", () => {
      this.app.setting.open();
      this.app.setting.openTabById(this.plugin.manifest.id);
    });

    /* export : bouton texte, c'est une action majeure */
    const exportBtn = this.iconBtn(
      right,
      "download",
      "Compiler et exporter (Markdown, Word, EPUB)"
    );
    exportBtn.addEventListener("click", (e) => {
      const menu = new Menu();

      /* preset actif : c'est un réglage de compilation, sa place est ici */
      const presets = S.compilePresets || [];
      const presetName =
        S.activePreset >= 0 && presets[S.activePreset]
          ? presets[S.activePreset].name || `Preset ${S.activePreset + 1}`
          : "Réglages par défaut";
      menu.addItem((item) =>
        item.setTitle(`Preset : ${presetName}`).setDisabled(true)
      );
      menu.addItem((item) =>
        item
          .setTitle("Réglages par défaut")
          .setChecked(S.activePreset < 0)
          .onClick(async () => {
            S.activePreset = -1;
            await this.plugin.saveSettings();
            new Notice("Preset : réglages par défaut.");
          })
      );
      presets.forEach((p, i) => {
        menu.addItem((item) =>
          item
            .setTitle(p.name || `Preset ${i + 1}`)
            .setChecked(S.activePreset === i)
            .onClick(async () => {
              S.activePreset = i;
              await this.plugin.saveSettings();
              new Notice(`Preset : ${p.name || `Preset ${i + 1}`}`);
            })
        );
      });
      menu.addSeparator();

      menu.addItem((item) =>
        item
          .setTitle(".md (Markdown compilé)")
          .setIcon("file-text")
          .onClick(() => this.plugin.compile())
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle("Choisir les feuillets à compiler…")
          .setIcon("list-checks")
          .onClick(() => new CompileSelectionModal(this.app, this.plugin).open())
      );
      menu.addSeparator();
      if (Platform.isMobile) {
        menu.addItem((item) =>
          item
            .setTitle("Word et EPUB : bureau uniquement (Pandoc)")
            .setDisabled(true)
        );
        menu.showAtMouseEvent(e);
        return;
      }
      menu.addItem((item) =>
        item.setTitle(".docx (Word)").onClick(() => this.plugin.exportFile("docx"))
      );
      menu.addItem((item) =>
        item.setTitle(".epub").onClick(() => this.plugin.exportFile("epub"))
      );
      menu.showAtMouseEvent(e);
    });


    addBtn.addEventListener("click", () => this.plugin.newSheet(boardFolder));
    addFolderBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Nouveau dossier…")
          .setIcon("folder-plus")
          .onClick(() => this.plugin.newFolder(boardFolder))
      );
      menu.addItem((item) =>
        item
          .setTitle("Importer un plan…")
          .setIcon("list-tree")
          .onClick(() => new ImportOutlineModal(this.app, this.plugin).open())
      );
      menu.showAtMouseEvent(e);
    });

    const allFiles = this.plugin.flattenFiles(folder);
    /* précalcul de tous les comptes de mots via le cache partagé du
       plugin : un fichier n'est relu que s'il a changé depuis le dernier
       rendu, pas relu à chaque sauvegarde comme avant. */
    const countsCache = await this.plugin.getWordCounts(allFiles);
    /* GARDE DE CONCURRENCE. _render est asynchrone : pendant cette attente,
       un autre rendu a pu démarrer (frappe, changement de filtre…). Il a
       vidé le conteneur — mais NOUS, on reprend ici et on continuerait à
       y rajouter notre barre d'outils et nos lignes PAR-DESSUS les siennes.
       Résultat visible : deux barres empilées (celle du dessus coupant la
       première ligne du contenu) et deux lignes allumées en même temps,
       puisque deux exemplaires de la même ligne portaient le même
       data-path. On abandonne donc ce rendu périmé. */
    if (this._renderGen !== myGen) return;
    this.wcMap = new Map();
    for (const f of allFiles) {
      this.wcMap.set(f.path, countsCache.get(f.path)?.wc || 0);
    }
    /* bumpTotal conservé comme point d'accroche (les rendus l'appellent),
       mais il n'alimente plus d'affichage : le compte vit dans la barre
       d'état. Le suivi quotidien, lui, doit continuer d'être enregistré
       même sans affichage ici, sinon l'historique aurait des trous. */
    const bumpTotal = () => {};
    this.plugin.wordCountOfFolder(folder).then((fullTotal) => {
      this.plugin.updateDailyStats(fullTotal);
    });

    if (this.filterActive()) {
      container
        .createDiv({ cls: "feuillets-filter-note" })
        .setText(
          "Filtre actif — glisser-déposer désactivé, total partiel."
        );
    }

    const numbering = this.plugin.buildNumbering(folder);

    /* zone défilante distincte de la barre d'outils. AVANT, la barre était
       simplement `sticky` au-dessus du contenu : elle le RECOUVRAIT au
       défilement, et comme sa hauteur varie (elle passe à la ligne quand
       le panneau est étroit), l'en-tête de colonnes du plan — calé sur une
       hauteur fixe supposée — se retrouvait décalé, coupant la première
       ligne (le dossier Front). Avec une vraie zone de défilement, la
       barre n'est plus dans le flux du contenu : plus rien à recouvrir,
       plus de hauteur à deviner. */
    const scroll = container.createDiv({ cls: "feuillets-board-scroll" });

    if (mode === "board") {
      this.renderBreadcrumbs(scroll, folder, boardFolder);
      this.renderBoard(scroll, folder, boardFolder, numbering, bumpTotal);
    } else if (mode === "outline") {
      this.renderOutline(scroll, folder, numbering, bumpTotal, myGen);
    } else if (mode === "arcs") {
      this.renderCheminDeFer(scroll, folder, numbering);
    } else if (mode === "timeline") {
      for (const f of this.plugin.flattenFiles(folder)) {
        if (this.passesFilter(f)) bumpTotal(this.wcMap.get(f.path) || 0);
      }
      this.renderTimeline(scroll, folder, numbering);
    } else {
      for (const f of this.plugin.flattenFiles(folder)) {
        if (this.passesFilter(f)) bumpTotal(this.wcMap.get(f.path) || 0);
      }
      await this.renderReading(scroll, folder, numbering);
    }
  }

  /* --- éditeurs partagés --- */

  makeGoalInput(parent, file) {
    const fm = this.fm(file);
    const input = parent.createEl("input", {
      cls: "feuillets-goal-input",
      type: "number",
      attr: { min: "0", placeholder: String(this.plugin.settings.wordGoal) },
    });
    if (fm.objectif !== undefined) input.value = String(fm.objectif);
    input.addEventListener("change", async () => {
      const n = parseInt(input.value, 10);
      await this.setFm(file, "objectif", isNaN(n) ? "" : n);
    });
    return input;
  }

  makeFolderGoalInput(parent, folder) {
    const S = this.plugin.settings;
    const input = parent.createEl("input", {
      cls: "feuillets-goal-input",
      type: "number",
      attr: { min: "0", placeholder: "objectif" },
    });
    const g = S.folderGoals[folder.path];
    if (typeof g === "number" && g > 0) input.value = String(g);
    input.addEventListener("change", async () => {
      const n = parseInt(input.value, 10);
      if (isNaN(n) || n <= 0) delete S.folderGoals[folder.path];
      else S.folderGoals[folder.path] = n;
      await this.plugin.saveSettings();
    });
    return input;
  }

  makeTagsEditor(parent, file) {
    const S = this.plugin.settings;
    if (!S.showTags) return;
    const wrap = parent.createDiv({ cls: "feuillets-tags" });
    const tags = this.plugin.tagsOf(file);
    for (const t of tags) {
      wrap.createSpan({ cls: "feuillets-tag-chip" }).setText(`#${t}`);
    }
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: tags.length ? "+" : "+ tags" },
    });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const raw = input.value.trim();
      if (!raw) return;
      const added = raw
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean);
      const merged = [...new Set([...tags, ...added])];
      await this.setFm(file, "tags", merged);
      input.value = "";
      input.blur();
    });
    /* clic sur une pastille = suppression du tag */
    wrap.querySelectorAll(".feuillets-tag-chip").forEach((chip, idx) => {
      chip.setAttr("title", "Cliquer pour retirer ce tag");
      chip.addEventListener("click", async () => {
        const next = tags.filter((_, j) => j !== idx);
        await this.setFm(file, "tags", next);
      });
    });
  }

  /* --- vue cartes --- */

  renderBreadcrumbs(container, root, boardFolder) {
    const chain = [];
    let temp = boardFolder;
    while (temp && temp.path !== root.path) {
      chain.push(temp);
      temp = temp.parent;
    }
    chain.push(root);
    chain.reverse();

    const bar = container.createDiv({ cls: "feuillets-board-breadcrumbs" });
    chain.forEach((f, idx) => {
      if (idx > 0) {
        bar.createSpan({ text: "  /  ", cls: "feuillets-breadcrumb-sep" });
      }
      const link = bar.createSpan({
        cls: "feuillets-breadcrumb-link" + (idx === chain.length - 1 ? " is-active" : ""),
        text: f.path === root.path ? "Projet" : f.name
      });
      link.addEventListener("click", () => {
        this.focusedFolderPath = f.path;
        this.render(true);
      });
    });
  }

  renderBoard(container, root, boardFolder, numbering, bumpTotal) {
    /* Front (page de titre, dédicace…) : pas de la narration — visible
       dans le binder, pas dans les panneaux narratifs (Cartes/Plan/
       Chronologie/Lecture/Arcs). */
    const siblings = this.plugin
      .getOrderedChildren(boardFolder)
      .filter((c) => !this.plugin.isFrontMatter(c));
    const grid = container.createDiv({ cls: "feuillets-grid" });
    this.gridStyle(grid);

    for (let i = 0; i < siblings.length; i++) {
      const child = siblings[i];
      if (child instanceof TFile) {
        if (this.passesFilter(child)) {
          this.renderCard(grid, boardFolder, child, i, siblings, numbering, bumpTotal);
        }
      } else if (child instanceof TFolder) {
        this.renderFolderCard(grid, boardFolder, child, i, siblings, numbering, bumpTotal);
      }
    }
  }

  makeClickToEditFmArea(parent, file, key, placeholder, maxLines = 6) {
    const fm = this.fm(file);
    const value = fm[key] || "";

    const textEl = parent.createDiv({ 
      cls: "feuillets-flat-text-cell" + (value ? "" : " is-empty"),
      text: value || placeholder 
    });
    if (maxLines) {
      textEl.style.setProperty("--max-lines", String(maxLines));
      textEl.addClass("feuillets-clamp-text");
    }

    textEl.addEventListener("click", (e) => {
      e.stopPropagation();
      textEl.style.display = "none";

      const ta = parent.createEl("textarea", {
        cls: "feuillets-flat-textarea",
      });
      ta.value = fm[key] || "";
      ta.focus();

      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";

      const saveAndExit = async () => {
        if (ta.parentNode) {
          const newVal = ta.value.trim();
          if (newVal !== (fm[key] || "")) {
            await this.setFm(file, key, newVal);
            textEl.setText(newVal || placeholder);
            if (newVal) textEl.removeClass("is-empty");
            else textEl.addClass("is-empty");
          }
          ta.remove();
          textEl.style.display = "";
        }
      };

      ta.addEventListener("blur", saveAndExit);
      ta.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" || (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey))) {
          ta.blur();
        }
      });
    });
    return textEl;
  }

  makeFolderClickToEditFmArea(parent, folder, key, placeholder, maxLines = 6) {
    const folderNote = this.plugin.folderNoteFor(folder);
    const value = folderNote ? (this.plugin.fmOf(folderNote)[key] || "") : "";

    const textEl = parent.createDiv({ 
      cls: "feuillets-flat-text-cell" + (value ? "" : " is-empty"),
      text: value || placeholder 
    });
    if (maxLines) {
      textEl.style.setProperty("--max-lines", String(maxLines));
      textEl.addClass("feuillets-clamp-text");
    }

    textEl.addEventListener("click", async (e) => {
      e.stopPropagation();
      textEl.style.display = "none";

      const ta = parent.createEl("textarea", {
        cls: "feuillets-flat-textarea",
      });
      ta.value = value;
      ta.focus();

      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";

      const saveAndExit = async () => {
        if (ta.parentNode) {
          const newVal = ta.value.trim();
          const note = await this.plugin.getOrCreateFolderNote(folder);
          const fm = this.plugin.fmOf(note);
          if (newVal !== (fm[key] || "")) {
            await this.setFm(note, key, newVal);
            textEl.setText(newVal || placeholder);
            if (newVal) textEl.removeClass("is-empty");
            else textEl.addClass("is-empty");
          }
          ta.remove();
          textEl.style.display = "";
        }
      };

      ta.addEventListener("blur", saveAndExit);
      ta.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" || (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey))) {
          ta.blur();
        }
      });
    });
    return textEl;
  }

  renderFolderCard(grid, parent, folder, index, siblings, numbering, bumpTotal) {
    const S = this.plugin.settings;
    const role = this.plugin.roleOfFolder(folder);
    const card = grid.createDiv({
      cls: "feuillets-card feuillets-card-folder",
    });
    card.setAttr("title", `Double-cliquer pour entrer dans : ${folder.name}`);
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showFolderContextMenu(e, folder, parent, index, siblings);
    });

    card.addEventListener("dblclick", () => {
      this.focusedFolderPath = folder.path;
      this.render(true);
    });

    const folderNote = this.plugin.folderNoteFor(folder);
    const labelName = folderNote ? this.plugin.labelOf(folderNote) : null;
    const labelColor = labelName ? this.plugin.labelColor(labelName) : null;
    if (labelColor) {
      card.style.borderTop = `3px solid ${labelColor}`;
    }

    const head = card.createDiv({ cls: "feuillets-card-head" });
    const icon = head.createDiv({ cls: "feuillets-card-icon" });
    setIcon(icon, "folder");

    const titleEl = head.createDiv({ 
      cls: "feuillets-card-num", 
      style: "font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 90px; cursor: pointer;" 
    });
    titleEl.setText(folder.name);
    titleEl.setAttr("title", "Cliquer pour entrer");
    titleEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.focusedFolderPath = folder.path;
      this.render(true);
    });

    const wcEl = head.createDiv({ cls: "feuillets-card-wc" });
    const ring = head.createDiv({ cls: "feuillets-ring" });
    if (!S.showProgress) ring.style.display = "none";

    const cwc = this.plugin.flattenFiles(folder).reduce((a, f) => a + (this.wcMap.get(f.path) || 0), 0);
    const cGoal = this.plugin.folderGoal(folder);
    wcEl.setText(cGoal > 0 ? `${cwc} / ${cGoal}` : String(cwc));
    if (S.showProgress) this.fillRing(ring, cwc, cGoal);

    /* Corps non-modifiable : synopsis ou résumé de la note de dossier */
    const key = this.currentCardContent === "synopsis" ? "synopsis" : "resume";
    const bodyText = folderNote ? this.plugin.fmOf(folderNote)[key] || "" : "";
    const bodyEl = card.createDiv({ 
      cls: "feuillets-card-body", 
      style: "white-space: pre-wrap; font-size: 0.9em; opacity: 0.85; margin-top: 8px; line-height: 1.3;" 
    });
    bodyEl.setText(bodyText || (key === "synopsis" ? "Synopsis du dossier…" : "Résumé du dossier…"));

    if (!this.filterActive()) {
      this.attachDragHandlers(head, card, parent, index, siblings, grid);
    }
  }

  renderCard(grid, parent, file, index, siblings, numbering, bumpTotal) {
    const S = this.plugin.settings;
    const role = this.plugin.roleOfFile(file);
    const goal = this.goalFor(file);
    const card = grid.createDiv({
      cls:
        role === "scene"
          ? "feuillets-card feuillets-card-scene"
          : "feuillets-card",
    });
    card.setAttr("title", file.basename);
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showFileContextMenu(e, file, parent, index, siblings);
    });

    /* bandeau de label */
    const labelName = this.plugin.labelOf(file);
    const labelColor = labelName ? this.plugin.labelColor(labelName) : null;
    if (labelColor) {
      card.style.borderTop = `3px solid ${labelColor}`;
    }

    /* tête : icône document, numéro, pastille label, mots, anneau */
    const head = card.createDiv({ cls: "feuillets-card-head" });
    if (this.selectionModeActive && this.plugin.isSceneFile(file)) {
      const checkbox = head.createEl("input", {
        type: "checkbox",
        cls: "feuillets-scene-select",
      });
      checkbox.checked = this.sceneSelection.has(file.path);
      checkbox.setAttr("title", `Sélectionner cette ${this.plugin.unitLabel()}`);
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.sceneSelection.add(file.path);
        else this.sceneSelection.delete(file.path);
        this.render(true);
      });
    }
    const icon = head.createDiv({ cls: "feuillets-card-icon" });
    setIcon(icon, "file-text");
    head
      .createDiv({ cls: "feuillets-card-num" })
      .setText(String(numbering.get(file.path)));

    const moreBtn = head.createDiv({ cls: "feuillets-card-more clickable-icon" });
    setIcon(moreBtn, "more-horizontal");
    moreBtn.setAttr("title", "Statut, tags, notes…");
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = new Menu();
      const currentStatus = this.fm(file).statut || "";
      for (const st of STATUSES.filter(Boolean)) {
        menu.addItem((item) =>
          item
            .setTitle(`Statut : ${st}`)
            .setChecked(st === currentStatus)
            .onClick(async () => {
              await this.setFm(file, "statut", st === currentStatus ? "" : st);
            })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Modifier les tags…").onClick(() => {
          new TagsModal(this.app, this.plugin, file).open();
        })
      );
      menu.addItem((item) =>
        item.setTitle("Modifier le résumé…").onClick(() => {
          new FmFieldModal(
            this.app,
            this.plugin,
            file,
            "resume",
            "Résumé long"
          ).open();
        })
      );
      menu.addItem((item) =>
        item.setTitle("Ouvrir le fichier").onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
        })
      );
      menu.showAtMouseEvent(e);
    });

    const wcEl = head.createDiv({ cls: "feuillets-card-wc" });
    const ring = head.createDiv({ cls: "feuillets-ring" });
    if (!S.showProgress) ring.style.display = "none";

    /* corps : extrait du texte, synopsis ou résumé selon réglage */
    if (this.currentCardContent === "synopsis") {
      this.makeClickToEditFmArea(card, file, "synopsis", "Synopsis…", 6);
    } else if (this.currentCardContent === "resume") {
      this.makeClickToEditFmArea(card, file, "resume", "Résumé…", 6);
    } else {
      const excerpt = card.createDiv({ cls: "feuillets-card-excerpt" });
      excerpt.setText("…");
      excerpt.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });
      this.app.vault.cachedRead(file).then((content) => {
        const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
        excerpt.setText(body.slice(0, S.excerptLength || 420) || "— vide —");
      });
    }

    if (S.showCardTags) this.makeTagsEditor(card, file);

    const wc = this.wcMap.get(file.path) || 0;
    bumpTotal(wc);
    wcEl.setText(String(wc));
    if (S.showProgress) this.fillRing(ring, wc, goal);

    if (!this.filterActive()) {
      this.attachDragHandlers(head, card, parent, index, siblings, grid);
    }
  }

  /* --- vue chronologie (mini Aeon) --- */

  /** Interprète la clé `date` : "1826", "1826-05", "1826-05-29",
   * éventuellement suivie d'une précision libre après un espace. */
  parseStoryDate(raw, file = null) {
    return this.plugin.parseStoryDate(raw, file);
  }

  /** Lecture continue (« scrivenings ») : tout le manuscrit filtré,
   * rendu à la suite. Lecture seule — cliquer un titre ouvre la scène. */
  async renderReading(container, folder, numbering) {
    const S = this.plugin.settings;

    /* périmètre de lecture : sélecteur dans la barre d'outils (voir
       construction de `right` dans _render), pas ici — un seul endroit
       pour ce réglage plutôt que deux contrôles dupliqués. */
    let scope = folder;
    if (S.readScope) {
      const f = this.app.vault.getAbstractFileByPath(S.readScope);
      if (f instanceof TFolder && f.path.startsWith(folder.path)) scope = f;
      else {
        S.readScope = "";
      }
    }

    const wrap = container.createDiv({ cls: "feuillets-reading" });
    let files;
    if (S.readScope === "__selection__") {
      const wanted = new Set(S.readSelection || []);
      files = this.plugin.flattenFiles(folder).filter((f) => wanted.has(f.path));
    } else {
      files = this.plugin
        .flattenFiles(scope)
        .filter((f) => this.passesFilter(f) && !this.plugin.isFrontMatter(f));
    }
    for (const file of files) {
      const section = wrap.createDiv({ cls: "feuillets-reading-section" });
      const head = section.createDiv({ cls: "feuillets-reading-title" });
      head.setText(
        `${numbering.get(file.path) || ""} ${this.titleFor(file)}`.trim()
      );
      head.setAttr("title", "Ouvrir dans l'éditeur");
      head.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });

      const raw0 = await this.app.vault.cachedRead(file);
      const fmMatch0 = raw0.match(/^---\n[\s\S]*?\n---\n?/);
      const front0 = fmMatch0 ? fmMatch0[0] : "";
      let body = raw0.slice(front0.length).trim();
      let front = front0;

      /* rend le corps de la section seule — jamais toute la page, pour ne
         perturber ni le défilement ni les autres sections déjà en cours
         d'édition */
      const renderBody = async () => {
        const bodyEl = section.createDiv({ cls: "feuillets-reading-body" });
        bodyEl.setAttr(
          "title",
          "Cliquer pour éditer à cet endroit, quitter le champ pour enregistrer"
        );
        await MarkdownRenderer.render(this.app, body, bodyEl, file.path, this);

        bodyEl.addEventListener("click", (e) => {
          if (e.target.tagName === "A") return; // liens cliquables normalement
          if (section.querySelector("textarea")) return;

          /* position approximative du curseur à l'endroit cliqué : le
             rendu Markdown n'a pas la même longueur que le texte brut
             (syntaxe retirée), donc on place le curseur au même ratio de
             position dans le texte brut plutôt qu'au tout début — un
             clic au milieu du chapitre ouvre l'édition au milieu. */
          let approxOffset = body.length;
          try {
            let range = null;
            if (document.caretRangeFromPoint) {
              range = document.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (document.caretPositionFromPoint) {
              const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
              if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
              }
            }
            if (range) {
              const pre = document.createRange();
              pre.selectNodeContents(bodyEl);
              pre.setEnd(range.startContainer, range.startOffset);
              const renderedOffset = pre.toString().length;
              const renderedLen = bodyEl.textContent.length || 1;
              approxOffset = Math.round(
                (renderedOffset / renderedLen) * body.length
              );
            }
          } catch (err) {
            /* repli : fin du texte, jamais une exception visible */
          }

          const ta = document.createElement("textarea");
          ta.addClass("feuillets-reading-edit");
          ta.value = body;
          const autoGrow = () => {
            ta.style.height = "auto";
            ta.style.height = `${ta.scrollHeight}px`;
          };
          bodyEl.replaceWith(ta);
          ta.addEventListener("input", autoGrow);
          ta.focus();
          ta.setSelectionRange(approxOffset, approxOffset);
          autoGrow();

          ta.addEventListener("blur", async () => {
            const newBody = ta.value;
            if (newBody !== body) {
              await this.app.vault.modify(file, front + newBody + "\n");
              body = newBody;
            }
            ta.remove();
            await renderBody();
          });
        });
      };
      await renderBody();
    }
    if (files.length === 0) {
      wrap
        .createDiv({ cls: "feuillets-empty" })
        .setText(
          S.readScope === "__selection__"
            ? "Aucun feuillet sélectionné — choisis « Sélection manuelle… » dans le menu."
            : "Aucun feuillet ne passe les filtres actifs."
        );
    }
  }

  renderCheminDeFer(container, root, numbering) {
    const S = this.plugin.settings;
    if (this.selectedArc === undefined) this.selectedArc = "";

    const items = [];
    const collect = (folder) => {
      for (const child of this.plugin.getOrderedChildren(folder)) {
        const hidden = child.name.startsWith("_") || child.path.includes("/_");
        if (hidden || this.plugin.isFrontMatter(child)) continue;

        if (child instanceof TFolder) {
          const role = this.plugin.roleOfFolder(child);
          if (role === "partie" || role === "chapitre") {
            items.push({ type: "folder", folder: child, role });
          }
          collect(child);
        } else if (child instanceof TFile && child.extension === "md") {
          const role = this.plugin.roleOfFile(child);
          if (role === "scene" || role === "chapitre") {
            items.push({ type: "file", file: child });
          }
        }
      }
    };
    collect(root);

    const scenes = items.filter((x) => x.type === "file");
    const labelSet = new Set();
    const sceneLabels = new Map(); // file.path -> [label names]
    const sceneFils = new Map(); // file.path -> [fils narratifs] (une scène peut en avoir plusieurs)
    for (const sc of scenes) {
      const list = this.plugin.labelsOf(sc.file);
      sceneLabels.set(sc.file.path, list);
      for (const l of list) labelSet.add(l);
      sceneFils.set(sc.file.path, filsOf(this.fm(sc.file)));
    }
    const allLabels = Array.from(labelSet).sort((a, b) => a.localeCompare(b, "fr"));
    const filSet = new Set();
    for (const fils of sceneFils.values()) for (const f of fils) filSet.add(f);
    const allFils = Array.from(filSet).sort((a, b) => a.localeCompare(b, "fr"));
    const anyFil = allFils.length > 0;

    const wrapper = container.createDiv({ cls: "feuillets-notes-container" });

    /* `fil` doit fonctionner même sans aucun label — c'est un champ
       indépendant. Avant ce correctif, l'absence de label faisait sortir
       la vue tout entière avant même d'atteindre le calcul des fils, les
       rendant invisibles alors qu'ils étaient bien renseignés. */
    if (allLabels.length === 0 && !anyFil) {
      wrapper
        .createDiv({ cls: "feuillets-empty" })
        .setText(
          `Aucun label ni fil détecté. Ajoute \`label: Nom\` (ou \`label: [Nom1, Nom2]\`) et/ou \`fil: indice\` (ou \`fil: indice, autre-fil\`) dans le YAML de tes ${this.plugin.unitLabelPlural()} pour construire le chemin de fer.`
        );
      return;
    }

    const filterBar = wrapper.createDiv({ cls: "feuillets-arcs-filter-bar" });
    filterBar.createDiv({ cls: "feuillets-arcs-filter-label", text: "Label / Fil" });
    const select = filterBar.createEl("select", { cls: "dropdown feuillets-arcs-filter-select" });
    select.createEl("option", { value: "", text: "Tous" });
    if (allLabels.length > 0) {
      const labelGroup = select.createEl("optgroup", { attr: { label: "Labels" } });
      for (const label of allLabels) {
        labelGroup.createEl("option", { value: `label:${label}`, text: label });
      }
    }
    if (allFils.length > 0) {
      const filGroup = select.createEl("optgroup", { attr: { label: "Fils" } });
      for (const filValue of allFils) {
        filGroup.createEl("option", { value: `fil:${filValue}`, text: filValue });
      }
    }
    const validValues = new Set([
      "",
      ...allLabels.map((l) => `label:${l}`),
      ...allFils.map((f) => `fil:${f}`),
    ]);
    select.value = validValues.has(this.selectedArc) ? this.selectedArc : "";
    select.addEventListener("change", () => {
      this.selectedArc = select.value;
      this.render(true);
    });

    /* un seul sélecteur, jamais les deux filtres actifs en même temps : soit
       "label:Nom", soit "fil:Valeur", soit "" (aucun filtre). */
    const rawSelection = select.value;
    const selectedLabel = rawSelection.startsWith("label:") ? rawSelection.slice(6) : "";
    const selectedFil = rawSelection.startsWith("fil:") ? rawSelection.slice(4) : "";
    const visibleLabels = selectedLabel ? [selectedLabel] : allLabels;

    const filteredScenePaths = selectedLabel
      ? new Set(
          scenes
            .filter((sc) => (sceneLabels.get(sc.file.path) || []).includes(selectedLabel))
            .map((sc) => sc.file.path)
        )
      : selectedFil
      ? new Set(
          scenes
            .filter((sc) => (sceneFils.get(sc.file.path) || []).includes(selectedFil))
            .map((sc) => sc.file.path)
        )
      : null;
    const scenesForIndex = filteredScenePaths
      ? scenes.filter((sc) => filteredScenePaths.has(sc.file.path))
      : scenes;

    const visibleSceneCount = filteredScenePaths ? filteredScenePaths.size : scenes.length;
    const unitWord = visibleSceneCount !== 1 ? this.plugin.unitLabelPlural() : this.plugin.unitLabel();
    filterBar.createDiv({
      cls: "feuillets-arcs-filter-count",
      text: selectedLabel
        ? `${visibleSceneCount} ${unitWord} avec ce label`
        : selectedFil
        ? `${visibleSceneCount} ${unitWord} avec ce fil`
        : `${visibleSceneCount} ${unitWord}`,
    });

    if (selectedLabel) {
      const chapters = this.plugin.getChapters(root);
      if (chapters.length > 0) {
        const chaptersWithLabel = new Set();
        for (const sc of scenesForIndex) {
          const idx = chapters.findIndex((c) =>
            c instanceof TFolder
              ? sc.file.path.startsWith(c.path + "/")
              : sc.file.path === c.path
          );
          if (idx !== -1) chaptersWithLabel.add(idx);
        }
        const densityWrap = wrapper.createDiv({ cls: "feuillets-arcs-density-wrap" });
        densityWrap
          .createDiv({ cls: "feuillets-notes-label" })
          .setText(`Présence de « ${selectedLabel} » sur ${chapters.length} chapitres`);
        const density = densityWrap.createDiv({ cls: "feuillets-density-strip" });
        const labelColor = this.plugin.labelColor(selectedLabel);
        chapters.forEach((c, idx) => {
          const tick = density.createDiv({ cls: "feuillets-density-tick" });
          if (chaptersWithLabel.has(idx)) {
            tick.addClass("feuillets-density-hit");
            tick.style.background = labelColor;
          }
          tick.setAttr("title", `Chapitre ${idx + 1}`);
        });
      }
    }

    if (selectedFil) {
      const chapters = this.plugin.getChapters(root);
      if (chapters.length > 0) {
        const chaptersWithFil = new Set();
        for (const sc of scenesForIndex) {
          const idx = chapters.findIndex((c) =>
            c instanceof TFolder
              ? sc.file.path.startsWith(c.path + "/")
              : sc.file.path === c.path
          );
          if (idx !== -1) chaptersWithFil.add(idx);
        }
        const densityWrap = wrapper.createDiv({ cls: "feuillets-arcs-density-wrap" });
        densityWrap
          .createDiv({ cls: "feuillets-notes-label" })
          .setText(`Présence du fil « ${selectedFil} » sur ${chapters.length} chapitres`);
        const density = densityWrap.createDiv({ cls: "feuillets-density-strip" });
        const filColor = this.plugin.labelColor(selectedFil);
        chapters.forEach((c, idx) => {
          const tick = density.createDiv({ cls: "feuillets-density-tick" });
          if (chaptersWithFil.has(idx)) {
            tick.addClass("feuillets-density-hit");
            tick.style.background = filColor;
          }
          tick.setAttr("title", `Chapitre ${idx + 1}`);
        });
      }
    }

    const firstIndices = {};
    const lastIndices = {};
    for (const label of visibleLabels) {
      firstIndices[label] = -1;
      lastIndices[label] = -1;
    }
    scenesForIndex.forEach((sc, idx) => {
      const list = sceneLabels.get(sc.file.path) || [];
      for (const label of list) {
        if (!(label in firstIndices)) continue;
        if (firstIndices[label] === -1) firstIndices[label] = idx;
        lastIndices[label] = idx;
      }
    });

    /* même principe que les labels : une ligne continue court de la
       première à la dernière scène portant le même texte de fil — « jusqu'à
       ce qu'on rentre à nouveau dans le même fil ». Une scène peut porter
       plusieurs fils à la fois. Les fils qui n'apparaissent pas dans les
       scènes actuellement visibles (filtre label actif) ne reçoivent pas de
       colonne, pour ne pas ajouter d'espace vide. */
    const filFirstIndices = {};
    const filLastIndices = {};
    scenesForIndex.forEach((sc, idx) => {
      const fils = sceneFils.get(sc.file.path) || [];
      for (const fil of fils) {
        if (!(fil in filFirstIndices)) filFirstIndices[fil] = idx;
        filLastIndices[fil] = idx;
      }
    });
    const visibleFils = selectedFil
      ? [selectedFil].filter((f) => f in filFirstIndices)
      : Object.keys(filFirstIndices).sort((a, b) => a.localeCompare(b, "fr"));

    const timeline = wrapper.createDiv({ cls: "feuillets-arcs-timeline" });
    let sceneCount = 0;
    for (const item of items) {
      if (item.type === "folder") {
        const row = timeline.createDiv({
          cls: `feuillets-arcs-row-folder feuillets-arcs-${item.role}`,
        });
        const railsSpacer = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
        railsSpacer.style.width = `${visibleLabels.length * 24}px`;
        const titleWrap = row.createDiv({ cls: "feuillets-arcs-folder-title" });
        const num = numbering ? numbering.get(item.folder.path) : "";
        if (num) {
          titleWrap.createSpan({ cls: "feuillets-arcs-folder-num", text: num });
        }
        titleWrap.createSpan({ text: item.folder.name });
        if (visibleFils.length > 0) {
          const filSpacer = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
          filSpacer.style.width = `${visibleFils.length * 24}px`;
        }
        continue;
      }

      const file = item.file;
      if (filteredScenePaths && !filteredScenePaths.has(file.path)) continue;
      const currentIdx = sceneCount;
      sceneCount++;
      const fm = this.fm(file);

      const row = timeline.createDiv({ cls: "feuillets-arcs-row-file" });
      row.style.cursor = "pointer";

      const rails = row.createDiv({ cls: "feuillets-arcs-row-rails" });
      rails.style.width = `${visibleLabels.length * 24}px`;

      const list = sceneLabels.get(file.path) || [];
      visibleLabels.forEach((label) => {
        const col = rails.createDiv({ cls: "feuillets-arcs-col" });
        const labelColor = this.plugin.labelColor(label);
        col.style.setProperty("--arc-color", labelColor);

        const first = firstIndices[label];
        const last = lastIndices[label];
        const hasLabel = list.includes(label);

        if (currentIdx >= first && currentIdx <= last) {
          const line = col.createDiv({ cls: "feuillets-arcs-line" });
          line.style.backgroundColor = labelColor;
          if (!hasLabel) line.style.opacity = "0.2";
        }
        if (hasLabel) {
          const dot = col.createDiv({ cls: "feuillets-arcs-dot" });
          dot.style.backgroundColor = labelColor;
          dot.setAttr("title", label);
          dot.setAttr("aria-label", label);
        }
      });

      const titleArea = row.createDiv({ cls: "feuillets-arcs-info" });
      const titleRow = titleArea.createDiv({ cls: "feuillets-arcs-title-row" });
      const titleLeft = titleRow.createDiv({ cls: "feuillets-arcs-title-left" });
      if (numbering) {
        titleLeft
          .createSpan({ cls: "feuillets-row-num" })
          .setText(numbering.get(file.path) || "");
      }
      if (fm.statut) {
        const dot = titleLeft.createSpan({
          cls: `feuillets-status-dot feuillets-status-dot-${STATUSES.indexOf(fm.statut)}`,
        });
        dot.setAttr("title", `Statut : ${fm.statut}`);
      }
      titleLeft.createDiv({ cls: "feuillets-arcs-file-title", text: this.plugin.shortTitleFor(file) });
      const fmFils = sceneFils.get(file.path) || [];
      if (fmFils.length > 0) {
        titleLeft.createDiv({ cls: "feuillets-arcs-phase", text: fmFils.join(", ") });
      }

      if (list.length > 0) {
        const badges = titleArea.createDiv({ cls: "feuillets-arcs-row-badges" });
        for (const label of list) {
          const labelColor = this.plugin.labelColor(label);
          const badge = badges.createSpan({ cls: "feuillets-arcs-badge", text: label });
          badge.style.setProperty("--arc-color-bg", labelColor + "20");
          badge.style.setProperty("--arc-color-text", labelColor);
        }
      }

      if (fm.synopsis) {
        titleArea.createDiv({ cls: "feuillets-arcs-file-synopsis", text: fm.synopsis });
      }

      /* rail des fils narratifs séparé, à droite du titre plutôt que mêlé
         aux rails des labels à gauche — même mécanique (ligne continue
         entre deux occurrences du même texte) mais un triangle plutôt
         qu'un cercle, pour ne pas confondre les deux d'un coup d'œil. */
      if (visibleFils.length > 0) {
        const filRails = row.createDiv({ cls: "feuillets-arcs-row-rails feuillets-arcs-row-rails-fil" });
        filRails.style.width = `${visibleFils.length * 24}px`;
        const currentFils = sceneFils.get(file.path) || [];
        visibleFils.forEach((filValue) => {
          const col = filRails.createDiv({ cls: "feuillets-arcs-col feuillets-arcs-col-fil" });
          const filColor = this.plugin.labelColor(filValue);
          col.style.setProperty("--arc-color", filColor);

          const first = filFirstIndices[filValue];
          const last = filLastIndices[filValue];
          const hasFil = currentFils.includes(filValue);

          if (currentIdx >= first && currentIdx <= last) {
            const line = col.createDiv({ cls: "feuillets-arcs-line" });
            line.style.backgroundColor = filColor;
            if (!hasFil) line.style.opacity = "0.2";
          }
          if (hasFil) {
            const dot = col.createDiv({ cls: "feuillets-arcs-dot-fil" });
            dot.style.backgroundColor = filColor;
            dot.setAttr("title", `Fil : ${filValue}`);
            dot.setAttr("aria-label", `Fil : ${filValue}`);
          }
        });
      }

      row.addEventListener("click", () => {
        const leaf = this.plugin.getLeafForOpeningFile();
        openFileActivating(this.app, leaf, file);
        this.app.workspace.revealLeaf(leaf);
      });
    }
  }

  renderTimeline(container, folder, numbering) {
    const S = this.plugin.settings;
    /* bascule ordre chronologique / ordre narratif */
    const orderBar = container.createDiv({ cls: "feuillets-history-tabs" });
    for (const [val, label] of [
      ["chrono", "Ordre chronologique"],
      ["narratif", "Ordre narratif"],
    ]) {
      const b = orderBar.createEl("button", { text: label });
      if (S.timelineOrder === val) b.addClass("feuillets-mode-active");
      b.addEventListener("click", async () => {
        S.timelineOrder = val;
        await this.plugin.saveSettings();
        this.render();
      });
    }
    return this.renderTimelineInner(container, folder, numbering);
  }

  renderTimelineInner(container, folder, numbering) {
    const files = this.plugin
      .flattenFiles(folder)
      .filter((f) => this.passesFilter(f) && !this.plugin.isFrontMatter(f));
    const dated = [];
    for (const f of files) {
      const parsed = this.parseStoryDate(this.fm(f).date, f);
      if (parsed) dated.push({ file: f, ...parsed });
    }
    /* jalons historiques : fiches datées du dossier _Chronologie */
    const chronoFolder = this.plugin.getChronoFolder();
    if (chronoFolder instanceof TFolder) {
      const walkChrono = (cf) => {
        for (const c of cf.children) {
          if (c instanceof TFolder) walkChrono(c);
          else if (c instanceof TFile && c.extension === "md") {
            const parsed = this.parseStoryDate(this.fm(c).date, c);
            if (!parsed) continue;
            const tf = this.plugin.settings.timelineTagFilter;
            if (tf) {
              const tags = this.plugin.tagsOf(c);
              if (!tags.includes(tf)) continue;
            }
            dated.push({ file: c, milestone: true, ...parsed });
          }
        }
      };
      walkChrono(chronoFolder);
    }
    if (this.plugin.settings.timelineOrder === "narratif") {
      /* ordre du manuscrit, dates affichées : les retours en arrière du
         temps de l'histoire deviennent visibles */
      const rank = new Map(files.map((f, i) => [f.path, i]));
      dated.sort((a, b) => rank.get(a.file.path) - rank.get(b.file.path));
    } else {
      dated.sort((a, b) => a.sort - b.sort);
    }

    if (dated.length === 0) {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText(
          `Aucune ${this.plugin.unitLabel()} datée. Renseigne la clé \`date\` du frontmatter (ex. 1826, 1826-05, 1826-05-29) pour construire la chronologie.`
        );
    }

    const line = container.createDiv({ cls: "feuillets-timeline" });
    let lastDisplay = null;
    let lastYear = null;
    let narrativePrev = 0;
    let prevDate = null;
    const toDate = (it) =>
      new Date(it.y, (it.mo || 1) - 1, it.d || 1).getTime();
    const fmtDelta = (days) => {
      const abs = Math.abs(days);
      const sign = days < 0 ? "−" : "+";
      if (abs < 60) return `${sign}${abs} jour${abs > 1 ? "s" : ""}`;
      if (abs < 730) return `${sign}${Math.round(abs / 30.44)} mois`;
      return `${sign}${Math.round(abs / 365.25)} an${abs >= 730 ? "s" : ""}`;
    };
    const MOIS = [
      "", "janvier", "février", "mars", "avril", "mai", "juin",
      "juillet", "août", "septembre", "octobre", "novembre", "décembre",
    ];
    const scaleKey = (it) => {
      switch (this.plugin.settings.timelineScale) {
        case "siecle": return String(Math.floor(it.y / 100) * 100);
        case "mois": return `${it.y}-${it.mo}`;
        case "jour": return `${it.y}-${it.mo}-${it.d}`;
        case "aucune": return null;
        default: return String(it.y);
      }
    };
    const scaleLabel = (it) => {
      switch (this.plugin.settings.timelineScale) {
        case "siecle": {
          const c = Math.floor(it.y / 100) * 100;
          return `${c}–${c + 99}`;
        }
        case "mois": return it.mo ? `${MOIS[it.mo]} ${it.y}` : String(it.y);
        case "jour":
          return it.d && it.mo
            ? `${it.d} ${MOIS[it.mo]} ${it.y}`
            : it.mo
            ? `${MOIS[it.mo]} ${it.y}`
            : String(it.y);
        default: return String(it.y);
      }
    };
    let lastScaleKey = null;
    for (const item of dated) {
      /* badge d'écart temporel avec l'élément précédent */
      if (prevDate !== null) {
        const days = Math.round((toDate(item) - prevDate) / 86400000);
        if (days !== 0) {
          const gap = line.createDiv({ cls: "feuillets-timeline-gap" });
          gap.setText(fmtDelta(days));
          gap.setAttr(
            "title",
            "Temps écoulé (de l'histoire) depuis l'élément précédent"
          );
        }
      }
      prevDate = toDate(item);
      /* en-tête d'échelle (mode chronologique) : siècle / année / mois / jour */
      const sk = scaleKey(item);
      if (
        this.plugin.settings.timelineOrder === "chrono" &&
        sk !== null &&
        sk !== lastScaleKey
      ) {
        line
          .createDiv({ cls: "feuillets-timeline-year" })
          .setText(scaleLabel(item));
        lastScaleKey = sk;
      }
      const row = line.createDiv({
        cls: item.milestone
          ? "feuillets-timeline-item feuillets-timeline-milestone"
          : "feuillets-timeline-item",
      });
      const dateCol = row.createDiv({ cls: "feuillets-timeline-date" });
      const dateInput = dateCol.createEl("input", {
        cls: "feuillets-timeline-date-input",
        type: "text",
      });
      dateInput.value = item.display === lastDisplay ? "" : item.display;
      dateInput.setAttr("placeholder", item.display);
      dateInput.addEventListener("blur", async () => {
        const v = dateInput.value.trim();
        if (!v || v === item.display) return;
        await this.setFm(item.file, "date", v);
      });
      lastDisplay = item.display;
      row.createDiv({ cls: "feuillets-timeline-dot" });
      const body = row.createDiv({ cls: "feuillets-timeline-body" });
      const head = body.createDiv({ cls: "feuillets-timeline-head" });
      if (
        this.selectionModeActive &&
        !item.milestone &&
        this.plugin.isSceneFile(item.file)
      ) {
        const checkbox = head.createEl("input", {
          type: "checkbox",
          cls: "feuillets-scene-select",
        });
        checkbox.checked = this.sceneSelection.has(item.file.path);
        checkbox.setAttr("title", `Sélectionner cette ${this.plugin.unitLabel()}`);
        checkbox.addEventListener("click", (e) => e.stopPropagation());
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) this.sceneSelection.add(item.file.path);
          else this.sceneSelection.delete(item.file.path);
          this.render(true);
        });
      }
      const numStr = item.milestone
        ? ""
        : String(numbering.get(item.file.path) || "");
      const numEl = head.createSpan({ cls: "feuillets-row-num" });
      numEl.setText(numStr);
      /* signale les anachronies : la position narrative recule alors
         que le temps de l'histoire avance */
      const narrativeNow = item.milestone
        ? narrativePrev
        : parseFloat(numStr) || 0;
      if (narrativeNow < narrativePrev) {
        const flag = head.createSpan({ cls: "feuillets-timeline-flag" });
        flag.setText("↩ analepse");
        flag.setAttr(
          "title",
          `Cette ${this.plugin.unitLabel()} est racontée plus tôt dans le manuscrit que la précédente de la chronologie.`
        );
      }
      narrativePrev = Math.max(narrativePrev, narrativeNow);
      const title = head.createSpan({ cls: "feuillets-timeline-title" });
      const shortT = this.plugin.shortTitleFor(item.file);
      title.setText(shortT);
      const fullT = this.titleFor(item.file);
      if (fullT !== shortT) title.setAttr("title", fullT);
      /* durée : clé `date_fin` — événement qui s'étend dans le temps */
      const endParsed = this.plugin.parseStoryDate(this.fm(item.file).date_fin);
      if (endParsed && endParsed.sort > item.sort) {
        const days = Math.round((toDate(endParsed) - toDate(item)) / 86400000);
        if (days > 0) {
          const dur = head.createSpan({ cls: "feuillets-timeline-duration" });
          const abs = days;
          const label =
            abs < 60
              ? `${abs} jour${abs > 1 ? "s" : ""}`
              : abs < 730
              ? `${Math.round(abs / 30.44)} mois`
              : `${Math.round(abs / 365.25)} ans`;
          dur.setText(`⟷ ${label}`);
          dur.setAttr(
            "title",
            `Du ${item.display} au ${endParsed.display}`
          );
        }
      }
      title.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), item.file);
      });
      const syn = this.fm(item.file).synopsis;
      if (syn) {
        body.createDiv({ cls: "feuillets-timeline-syn" }).setText(syn);
      }
      if (item.milestone) {
        /* couleur de piste : dérivée du premier tag du jalon, stable */
        const tags = this.plugin.tagsOf(item.file);
        if (tags.length > 0) {
          const palette = this.getProjectLabels().map(
            (l) => l.color
          );
          if (palette.length > 0) {
            let h = 0;
            for (const ch of tags[0]) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
            row.style.setProperty("--tl-color", palette[h % palette.length]);
            row.addClass("feuillets-timeline-milestone-colored");
          }
        }
      } else {
        const labelName = this.plugin.labelOf(item.file);
        const color = labelName ? this.plugin.labelColor(labelName) : null;
        if (color) row.style.setProperty("--tl-color", color);
      }
    }
  }

  /* --- vue plan (outliner façon Scrivener) --- */

  visibleCols() {
    const C = this.plugin.settings.outlineCols;
    const cols = [{ id: "title", label: "Feuillet" }];
    if (C.synopsis) cols.push({ id: "synopsis", label: "Synopsis" });
    if (C.resume) cols.push({ id: "resume", label: "Résumé" });
    if (C.notes) cols.push({ id: "notes", label: "Notes" });
    if (C.tags) cols.push({ id: "tags", label: "Tags" });
    if (C.label) cols.push({ id: "label", label: "Label" });
    if (C.status) cols.push({ id: "status", label: "Statut" });
    if (C.date) cols.push({ id: "date", label: "Date" });
    if (C.compiler) cols.push({ id: "compiler", label: "Compiler" });
    if (C.filename) cols.push({ id: "filename", label: "Fichier" });
    if (C.words) cols.push({ id: "words", label: "Mots" });
    if (C.goal) cols.push({ id: "goal", label: "Objectif" });
    if (C.progress) cols.push({ id: "progress", label: "Progression" });
    return cols;
  }

  colsTemplate() {
    const W = this.plugin.settings.outlineWidths;
    return (
      "22px " +
      this.visibleCols()
        .map((c) => `${Math.max(60, W[c.id] || 120)}px`)
        .join(" ")
    );
  }

  async renderOutline(container, root, numbering, bumpTotal, gen) {
    const S = this.plugin.settings;
    const table = container.createDiv({ cls: "feuillets-outline" });
    table.style.setProperty("--feuillets-cols", this.colsTemplate());
    const cols = this.visibleCols();

    /* en-tête avec poignées de redimensionnement */
    const headRow = table.createDiv({ cls: "feuillets-row feuillets-row-head" });
    headRow.createDiv({ cls: "feuillets-col-handle" });
    for (const col of cols) {
      const cell = headRow.createDiv({ cls: "feuillets-col-head-cell" });
      cell.createSpan().setText(col.label);
      const resizer = cell.createDiv({ cls: "feuillets-col-resizer" });
      resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = Math.max(60, S.outlineWidths[col.id] || 120);
        const onMove = (ev) => {
          S.outlineWidths[col.id] = Math.max(60, startW + ev.clientX - startX);
          table.style.setProperty("--feuillets-cols", this.colsTemplate());
        };
        const onUp = async () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          await this.plugin.saveSettings();
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }

    /* compteur de lignes construites depuis la dernière pause : au-delà
       d'un paquet, on rend la main au navigateur (requestAnimationFrame)
       avant de continuer — sans ça, un plan à une centaine de feuillets
       (synopsis, statut, anneau… par ligne) bloque le fil principal en
       un seul bloc et le panneau paraît figé à l'ouverture. */
    const progress = { count: 0 };
    await this.renderOutlineLevel(
      table, root, 0, numbering, bumpTotal, cols, progress, gen
    );
    /* rendu terminé : c'est ICI, une seule fois, qu'on fixe l'état actif —
       pas ligne par ligne pendant la construction (voir commentaire dans
       renderOutlineLevel). Un rendu plus récent a pu démarrer entre-temps :
       dans ce cas on n'a rien à corriger, l'autre passage s'en chargera. */
    if (this._renderGen === gen) this.updateActiveHighlight();
  }

  emptyCells(row, cols, except) {
    for (const col of cols) {
      if (except && except[col.id]) {
        except[col.id](row.createDiv({ cls: `feuillets-cell feuillets-cell-${col.id}` }));
      } else if (col.id !== "title") {
        row.createDiv({ cls: `feuillets-cell feuillets-cell-${col.id}` });
      }
    }
  }

  async renderOutlineLevel(table, parent, depth, numbering, bumpTotal, cols, progress, gen) {
    const S = this.plugin.settings;
    /* Front n'est jamais de la narration — pas dans le Plan. */
    const siblings = this.plugin
      .getOrderedChildren(parent)
      .filter((c) => !this.plugin.isFrontMatter(c));
    for (let i = 0; i < siblings.length; i++) {
      /* un rendu plus récent a démarré entre-temps (changement de mode,
         de filtre…) : on abandonne ce paquet au lieu de continuer à
         peupler un tableau qui n'est déjà plus affiché */
      if (this._renderGen !== gen) return;
      const child = siblings[i];
      if (child instanceof TFolder) {
        const role = this.plugin.roleOfFolder(child);
        const row = table.createDiv({
          cls:
            role === "partie"
              ? "feuillets-row feuillets-row-part"
              : "feuillets-row feuillets-row-folder",
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.showFolderContextMenu(e, child, parent, i, siblings);
        });
        const handle = row.createDiv({ cls: "feuillets-col-handle" });
        handle.setText("⋮⋮");
        const titleCell = row.createDiv({
          cls: "feuillets-cell feuillets-cell-title",
        });
        titleCell.style.paddingLeft = `${depth * 16}px`;
        const collapsed = !!S.collapsed[child.path];
        titleCell.style.cursor = "pointer";
        titleCell.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (S.collapsed[child.path]) delete S.collapsed[child.path];
          else S.collapsed[child.path] = true;
          await this.plugin.saveSettings();
          this.render();
        });

        const icon = titleCell.createDiv({ cls: "feuillets-cell-icon" });
        setIcon(icon, role === "partie" ? "folder" : "folder-open");
        const num = numbering.get(child.path);
        titleCell
          .createSpan({ cls: "feuillets-folder-name" })
          .setText(
            role === "chapitre" && num ? `${num} ${child.name}` : child.name
          );

        const note = await this.plugin.getOrCreateFolderNote(child);
        this.emptyCells(row, cols, {
          synopsis: (cell) => cell.setText(this.plugin.fmOf(note).synopsis || ""),
          resume: (cell) => cell.setText(this.plugin.fmOf(note).resume || ""),
          notes: (cell) => cell.setText(this.plugin.fmOf(note).notes || ""),
          label: (cell) => cell.setText(this.plugin.labelOf(note) || ""),
          status: (cell) => cell.setText(this.plugin.fmOf(note).statut || ""),
          words: (cell) => {
            const cwc = this.plugin
              .flattenFiles(child)
              .reduce((a, f) => a + (this.wcMap.get(f.path) || 0), 0);
            cell.createSpan({ cls: "feuillets-wc" }).setText(String(cwc));
          },
          progress: (cell) => {
            const ring = cell.createDiv({ cls: "feuillets-ring" });
            const cGoal = this.plugin.folderGoal(child);
            const cwc = this.plugin
              .flattenFiles(child)
              .reduce((a, f) => a + (this.wcMap.get(f.path) || 0), 0);
            this.fillRing(ring, cwc, cGoal);
          },
          goal: (cell) => {
            const cGoal = this.plugin.folderGoal(child);
            cell.setText(cGoal > 0 ? String(cGoal) : "-");
          },
        });
        if (!this.filterActive()) {
          this.attachDragHandlers(handle, row, parent, i, siblings, table);
        }
        progress.count++;
        if (progress.count % 30 === 0) {
          await new Promise((r) => requestAnimationFrame(r));
          if (this._renderGen !== gen) return;
        }
        if (collapsed) {
          for (const f of this.plugin.flattenFiles(child)) {
            if (this.passesFilter(f)) bumpTotal(this.wcMap.get(f.path) || 0);
          }
        } else {
          await this.renderOutlineLevel(
            table, child, depth + 1, numbering, bumpTotal, cols, progress, gen
          );
        }
        continue;
      }

      const file = child;
      if (!this.passesFilter(file)) continue;
      const role = this.plugin.roleOfFile(file);
      const goal = this.goalFor(file);
      const row = table.createDiv({
        cls: role === "scene" ? "feuillets-row feuillets-row-scene" : "feuillets-row",
      });
      row.setAttr("data-path", file.path);
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.showFileContextMenu(e, file, parent, i, siblings);
      });
      /* PAS de comparaison à activeFile ici : un rendu par paquets étale
         la construction sur plusieurs frames, et si le fichier actif
         change PENDANT ce temps (l'utilisateur clique un feuillet avant
         la fin du rendu), les paquets encore à venir compareraient à un
         activeFile déjà périmé — exactement la course qui laissait
         parfois une ligne bloquée en surbrillance. updateActiveHighlight(),
         appelé une fois le rendu terminé, fixe l'état correct d'un coup,
         sans dépendre du moment où chaque ligne a été construite. */

      const handle = row.createDiv({ cls: "feuillets-col-handle" });
      handle.setText("⋮⋮");

      const titleCell = row.createDiv({
        cls: "feuillets-cell feuillets-cell-title",
      });
      titleCell.style.paddingLeft = `${depth * 16}px`;
      if (this.selectionModeActive && this.plugin.isSceneFile(file)) {
        const checkbox = titleCell.createEl("input", {
          type: "checkbox",
          cls: "feuillets-scene-select",
        });
        checkbox.checked = this.sceneSelection.has(file.path);
        checkbox.setAttr("title", `Sélectionner cette ${this.plugin.unitLabel()}`);
        checkbox.addEventListener("click", (e) => e.stopPropagation());
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) this.sceneSelection.add(file.path);
          else this.sceneSelection.delete(file.path);
          this.render(true);
        });
      }
      const icon = titleCell.createDiv({ cls: "feuillets-cell-icon" });
      setIcon(icon, "file-text");
      titleCell
        .createSpan({ cls: "feuillets-row-num" })
        .setText(String(numbering.get(file.path)));
      const titleSpan = titleCell.createSpan({
        cls: "feuillets-title-text clickable",
        text: this.plugin.shortTitleFor(file),
      });
      titleSpan.style.cursor = "pointer";
      titleSpan.style.flexGrow = "1";
      titleSpan.setAttr("title", `Fichier : ${file.basename}`);
      titleSpan.addEventListener("click", () => {
        const leaf = this.plugin.getLeafForOpeningFile();
        openFileActivating(this.app, leaf, file);
        this.app.workspace.revealLeaf(leaf);
      });

      const wc = this.wcMap.get(file.path) || 0;
      bumpTotal(wc);
      this.emptyCells(row, cols, {
        synopsis: (cell) => this.makeClickToEditFmArea(cell, file, "synopsis", "Synopsis…", 1),
        resume: (cell) => this.makeClickToEditFmArea(cell, file, "resume", "Résumé…", 1),
        notes: (cell) => this.makeClickToEditFmArea(cell, file, "notes", "Notes…", 1),
        tags: (cell) => this.makeTagsEditor(cell, file),
        label: (cell) => this.makeLabelSelect(cell, file),
        status: (cell) => this.makeStatusSelect(cell, file),
        date: (cell) => {
          const wrap = cell.createDiv({ cls: "feuillets-date-cell" });
          const mk = (key, ph) => {
            const inp = wrap.createEl("input", {
              cls: "feuillets-date-input",
              type: "text",
              attr: { placeholder: ph },
            });
            inp.value = this.fm(file)[key] || "";
            inp.addEventListener("blur", async () => {
              const v = inp.value.trim();
              if (v !== (this.fm(file)[key] || "")) {
                await this.setFm(file, key, v);
              }
            });
          };
          mk("date", "début");
          mk("date_fin", "fin");
        },
        compiler: (cell) => {
          const fm = this.fm(file);
          const cb = cell.createEl("input", { type: "checkbox" });
          cb.checked = !(fm.compiler === false || fm.compile === false);
          cb.setAttr(
            "title",
            "Décoché : le feuillet reste visible mais saute à la compilation"
          );
          cb.addEventListener("change", async () => {
            await this.app.fileManager.processFrontMatter(file, (x) => {
              if (cb.checked) delete x.compiler;
              else x.compiler = false;
              delete x.compile;
            });
          });
        },
        filename: (cell) => {
          const el = cell.createSpan({ cls: "feuillets-filename-cell" });
          el.setText(file.basename);
          el.setAttr("title", `${file.path} — cliquer pour ouvrir`);
          el.addEventListener("click", () => {
            openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
          });
        },
        words: (cell) => {
          cell.createSpan({ cls: "feuillets-wc" }).setText(String(wc));
        },
        progress: (cell) => {
          const ring = cell.createDiv({ cls: "feuillets-ring" });
          this.fillRing(ring, wc, goal);
        },
        goal: (cell) => this.makeGoalInput(cell, file),
      });

      if (!this.filterActive()) {
        this.attachDragHandlers(handle, row, parent, i, siblings, table);
      }

      progress.count++;
      if (progress.count % 30 === 0) {
        await new Promise((r) => requestAnimationFrame(r));
        if (this._renderGen !== gen) return;
      }
    }
  }
}

/* ---------- réglages ---------- */

