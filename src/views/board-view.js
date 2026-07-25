const { Menu, TFile, TFolder, setIcon, MarkdownRenderer, Notice } = require("obsidian");
import { VIEW_BOARD, STATUSES, BOARD_MODES } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { openFileActivating } from "../utils/dom.js";
import { parseStoryDate, foldAccents, stripMarkdown } from "../utils/core.js";
import { PROJECT_MODES, resolveType } from "../utils/project-modes.js";
import { DEFAULT_SETTINGS } from "../default-settings.js";
import { filsOf } from "../utils/arc-fields.js";
import { ScriveningsManager } from "./scrivenings-editor.js";
import { ReadSelectionModal } from "../ui/selection-modals.js";
import { DiffModal } from "../ui/diff-modal.js";
import { listSnapshotFiles } from "../services/project-files.js";

function isInputFocused(el) {
  const active = document.activeElement;
  return active && el.contains(active) && ["TEXTAREA", "INPUT"].includes(active.tagName);
}

function getFilsList(fm) {
  const fils = fm.fil;
  if (Array.isArray(fils)) return fils.filter(Boolean).map((r) => String(r).trim()).filter(Boolean);
  if (typeof fils === "string" && fils.trim()) return fils.split(",").map((r) => r.trim()).filter(Boolean);
  return [];
}

function getPersonnagesList(fm) {
  const persos = fm.personnages ?? fm.persos;
  if (Array.isArray(persos)) return persos.filter(Boolean).map((r) => String(r).trim()).filter(Boolean);
  if (typeof persos === "string" && persos.trim()) return persos.split(",").map((r) => r.trim()).filter(Boolean);
  return [];
}

function filColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`;
}

export class BoardView extends BaseFeuilletsView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
    this.focusedFolderPath = null;
    this.scriveningsManager = null;
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
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateActiveHighlight()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateActiveHighlight()));
    await this.render();
  }

  updateActiveHighlight() {
    const active = this.app.workspace.getActiveFile();
    this.highlightActivePath(active ? active.path : null);
  }

  highlightActivePath(path) {
    if (!this.contentEl) return;
    this.contentEl.querySelectorAll(".is-active, .feuillets-dragover, .feuillets-dragging").forEach((r) => {
      r.removeClass("is-active");
      r.removeClass("feuillets-dragover");
      r.removeClass("feuillets-dragging");
    });
    if (path) {
      this.contentEl.querySelectorAll(`[data-path="${CSS.escape(path)}"]`).forEach((r) => r.addClass("is-active"));
    }
  }

  async render(force = false) {
    return this._render(force);
  }

  passesFilter(file) {
    const S = this.plugin.settings;
    const statusFilter = S.statusFilter;
    if (statusFilter && statusFilter !== "Tous") {
      const currentStatus = this.fm(file).statut || "";
      if (statusFilter === "Sans statut" ? currentStatus !== "" : currentStatus !== statusFilter) return false;
    }
    const labelFilter = S.labelFilter;
    if (labelFilter && labelFilter !== "Tous") {
      const currentLabel = this.plugin.labelOf(file);
      if (labelFilter === "Sans label" ? currentLabel !== "" : currentLabel !== labelFilter) return false;
    }
    const tagTerm = (S.tagFilter || "").trim().toLowerCase().replace(/^#/, "");
    if (tagTerm && !this.plugin.tagsOf(file).map((l) => l.toLowerCase()).some((l) => l.includes(tagTerm))) return false;
    const progressFilter = S.progressFilter;
    if (progressFilter && progressFilter !== "Tous" && this.wcMap) {
      const wc = this.wcMap.get(file.path);
      const goal = this.goalFor(file);
      if (wc !== undefined && goal > 0) {
        const state = this.ringState(wc, goal);
        if (progressFilter === "Atteint" && state !== "hit") return false;
        if (progressFilter === "En dessous" && state !== "under") return false;
        if (progressFilter === "Dépassé" && state !== "over") return false;
      } else if (goal <= 0) return false;
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

  gridStyle(el) {
    const S = this.plugin.settings;
    if (S.columns > 0) el.style.gridTemplateColumns = `repeat(${S.columns}, 1fr)`;
    else el.style.gridTemplateColumns = `repeat(auto-fill, minmax(${S.tileSize}px, 1fr))`;
  }

  async _render(force = false) {
    if (this.scriveningsManager && this.scriveningsManager.isSaving) return;

    const container = this.contentEl;
    if (!force && isInputFocused(container)) return;
    const gen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-board-container");

    const S = this.plugin.settings;
    container.style.fontSize = `${S.fontSize}px`;
    container.style.zoom = `${S.uiScale}%`;

    const root = this.getProjectFolder();
    if (!root) {
      container.createDiv({ cls: "feuillets-empty", text: "Aucun dossier projet défini (réglages du plugin)." });
      return;
    }

    let currentFolder = root;
    if (this.focusedFolderPath) {
      const folder = this.app.vault.getAbstractFileByPath(this.focusedFolderPath);
      if (folder instanceof TFolder && folder.path.startsWith(root.path)) currentFolder = folder;
      else this.focusedFolderPath = null;
    }

    if (!S.projectMeta) S.projectMeta = {};
    if (!S.projectMeta[root.path]) S.projectMeta[root.path] = {};
    const meta = S.projectMeta[root.path];
    const projectType = resolveType(meta.type);
    const modeConfig = PROJECT_MODES[projectType] || PROJECT_MODES.fiction;
    let mode = meta.boardMode || modeConfig.defaults.boardMode;
    this.currentCardContent = meta.cardContent || modeConfig.defaults.cardContent;

    const hiddenModes = meta.hiddenBoardModes || S.hiddenBoardModes || [];
    const wholeManuscript = meta.boardWholeManuscript !== undefined ? meta.boardWholeManuscript : !!S.boardWholeManuscript;
    if (mode === "research") mode = "board";

    let visibleModes = BOARD_MODES.map(([k]) => k).filter((k) => !hiddenModes.includes(k));
    if (visibleModes.length === 0) visibleModes = BOARD_MODES.map(([k]) => k);
    if (!visibleModes.includes(mode)) mode = visibleModes[0];
    const activeMode = mode;

    if (activeMode !== "read" && this.scriveningsManager) {
      this.scriveningsManager.destroy();
      this.scriveningsManager = null;
    }

    if (!this.sceneSelection) this.sceneSelection = new Set();
    if (this.selectionModeActive === undefined) this.selectionModeActive = false;

    const bar = container.createDiv({ cls: "feuillets-board-bar" }).createDiv({ cls: "feuillets-board-bar-right" });
    this.iconBtn(bar, this.filterActive() ? "filter" : "list-filter", "Filtres (statut, label, progression)", (e) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle("— Statut —").setDisabled(true));
      for (const st of ["Tous", ...STATUSES.filter(Boolean), "Sans statut"]) {
        menu.addItem((item) =>
          item.setTitle(st).setChecked((S.statusFilter || "Tous") === st).onClick(async () => {
            S.statusFilter = st;
            await this.plugin.saveSettings();
            this.render();
          })
        );
      }
      menu.addSeparator();
      const labels = new Set();
      const projectRoot = this.plugin.getProjectFolder();
      if (projectRoot) {
        const collect = (f) => {
          for (const c of this.plugin.getOrderedChildren(f)) {
            if (c instanceof TFile) {
              const l = this.plugin.labelOf(c);
              if (l) labels.add(l);
            } else if (c instanceof TFolder) collect(c);
          }
        };
        collect(projectRoot);
      }
      const pMeta = projectRoot ? S.projectMeta[projectRoot.path] : null;
      (pMeta && pMeta.labels ? pMeta.labels : S.labels || []).forEach((l) => { if (l.name) labels.add(l.name); });
      const sortedLabels = Array.from(labels).sort((a, b) => a.localeCompare(b, "fr"));
      menu.addItem((item) => item.setTitle("— Label —").setDisabled(true));
      for (const lb of ["Tous", ...sortedLabels, "Sans label"]) {
        menu.addItem((item) =>
          item.setTitle(lb).setChecked((S.labelFilter || "Tous") === lb).onClick(async () => {
            S.labelFilter = lb;
            await this.plugin.saveSettings();
            this.render();
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("— Progression —").setDisabled(true));
      for (const pr of ["Tous", "Atteint", "En dessous", "Dépassé"]) {
        menu.addItem((item) =>
          item.setTitle(pr).setChecked((S.progressFilter || "Tous") === pr).onClick(async () => {
            S.progressFilter = pr;
            await this.plugin.saveSettings();
            this.render();
          })
        );
      }
      if (this.filterActive()) {
        menu.addSeparator();
        menu.addItem((item) =>
          item.setTitle("Réinitialiser tous les filtres").setIcon("filter-x").onClick(async () => {
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
    });

    const tagInput = bar.createEl("input", { cls: "feuillets-tag-filter", type: "text", attr: { placeholder: "#tag…" } });
    tagInput.value = S.tagFilter || "";
    tagInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        S.tagFilter = tagInput.value.trim();
        await this.plugin.saveSettings();
        tagInput.blur();
        this.render();
      }
    });

    this.barSep(bar);

    const switchMode = (m) => async () => {
      if (meta) meta.boardMode = m;
      S.boardMode = m;
      await this.plugin.saveSettings();
      this.render();
    };

    const modeGroup = bar.createDiv({ cls: "feuillets-mode-group" });
    const icons = { board: "layout-grid", outline: "list-tree", arcs: "git-branch", timeline: "milestone", read: "book-open-text" };
    for (const [k, label] of BOARD_MODES) {
      if (!visibleModes.includes(k)) continue;
      const btn = this.iconBtn(modeGroup, icons[k], label, switchMode(k));
      if (activeMode === k) btn.addClass("feuillets-mode-active");
    }

    this.iconBtn(modeGroup, "layout-dashboard", "Tableau canvas (brainstorming)", () => {
      this.plugin.generateCanvasBoard();
    });

    this.iconBtn(modeGroup, "sliders-horizontal", "Options de la vue", (e) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle("— Modes affichés —").setDisabled(true));
      for (const [k, label] of BOARD_MODES) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(visibleModes.includes(k)).onClick(async () => {
            const set = new Set(hiddenModes);
            if (set.has(k)) set.delete(k); else set.add(k);
            const arr = [...set];
            if (meta) meta.hiddenBoardModes = arr;
            S.hiddenBoardModes = arr;
            await this.plugin.saveSettings();
            this.render(true);
          })
        );
      }
      menu.addSeparator();
      this.buildModeOptionsMenu(menu, activeMode, { S, meta, pType: projectType, folder: root, wholeManuscript });
      menu.showAtMouseEvent(e);
    });

    this.barSep(bar);

    if (activeMode !== "read" && activeMode !== "arcs") {
      const selSize = this.sceneSelection.size;
      const getSelectedFiles = () =>
        [...this.sceneSelection].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f) => f instanceof TFile);
      const clearSel = () => {
        this.sceneSelection.clear();
        this.selectionModeActive = false;
        this.render(true);
      };
      const unitLabel = this.plugin.unitLabel();
      const unitPlural = this.plugin.unitLabelPlural();
      const btnSel = this.iconBtn(
        bar,
        "list-checks",
        this.selectionModeActive ? `Actions de ${unitLabel} (${selSize} sélectionnée${selSize > 1 ? "s" : ""})` : `Sélectionner des ${unitPlural}…`,
        (e) => {
          const menu = new Menu();
          if (!this.selectionModeActive) {
            menu.addItem((item) =>
              item.setTitle(`Sélectionner des ${unitPlural}…`).setIcon("list-checks").onClick(() => {
                this.selectionModeActive = true;
                this.render(true);
              })
            );
            menu.showAtMouseEvent(e);
            return;
          }
          menu.addItem((item) =>
            item.setTitle(`Fusionner (${selSize})`).setIcon("git-merge").setDisabled(selSize < 2).onClick(() => {
              const files = getSelectedFiles();
              clearSel();
              if (files.length < 2) {
                new Notice(`Sélectionne au moins deux ${unitPlural} à fusionner.`);
                return;
              }
              this.plugin.openMergeModal(files);
            })
          );
          menu.addItem((item) =>
            item.setTitle(`Dupliquer (${selSize})`).setIcon("copy").setDisabled(selSize < 1).onClick(async () => {
              const files = getSelectedFiles();
              clearSel();
              if (files.length > 0) await this.plugin.duplicateManyScenes(files);
            })
          );
          menu.addItem((item) =>
            item.setTitle(`Déplacer (${selSize})…`).setIcon("move").setDisabled(selSize < 1).onClick(() => {
              const files = getSelectedFiles();
              clearSel();
              if (files.length > 0) this.plugin.openMoveManyModal(files);
            })
          );
          menu.addSeparator();
          menu.addItem((item) => item.setTitle("Quitter le mode sélection").setIcon("x").onClick(clearSel));
          menu.showAtMouseEvent(e);
        }
      );
      if (this.selectionModeActive) btnSel.addClass("feuillets-mode-active");
    }

    this.iconBtn(bar, "undo-2", "Annuler le dernier déplacement", () => this.app.commands.executeCommandById("feuillets:undo-move"));

    const flattened = this.plugin.flattenFiles(root);
    const wcMapRaw = await this.plugin.getWordCounts(flattened);
    if (this._renderGen !== gen) return;

    this.wcMap = new Map();
    for (const file of flattened) {
      this.wcMap.set(file.path, wcMapRaw.get(file.path)?.wc || 0);
    }

    const bumpTotal = () => {};
    this.plugin.wordCountOfFolder(root).then((wc) => {
      this.plugin.updateDailyStats(wc);
    });

    if (this.filterActive()) {
      container.createDiv({ cls: "feuillets-filter-note", text: "Filtre actif — glisser-déposer désactivé, total partiel." });
    }

    const numbering = this.plugin.buildNumbering(root);
    const scrollArea = container.createDiv({ cls: "feuillets-board-scroll" });

    if (activeMode === "board" && wholeManuscript) {
      this.renderBoardWholeManuscript(scrollArea, root, numbering, bumpTotal);
    } else if (activeMode === "board") {
      this.renderBreadcrumbs(scrollArea, root, currentFolder);
      this.renderBoard(scrollArea, root, currentFolder, numbering, bumpTotal);
    } else if (activeMode === "outline") {
      await this.renderOutline(scrollArea, root, numbering, bumpTotal, gen);
    } else if (activeMode === "arcs") {
      this.renderCheminDeFer(scrollArea, root, numbering);
    } else if (activeMode === "timeline") {
      for (const file of this.plugin.flattenFiles(root)) {
        if (this.passesFilter(file)) bumpTotal(this.wcMap.get(file.path) || 0);
      }
      this.renderTimeline(scrollArea, root, numbering);
    } else {
      for (const file of this.plugin.flattenFiles(root)) {
        if (this.passesFilter(file)) bumpTotal(this.wcMap.get(file.path) || 0);
      }
      await this.renderReading(scrollArea, root, numbering);
    }
  }

  buildModeOptionsMenu(menu, activeMode, ctx) {
    const { S, meta, pType, folder, wholeManuscript } = ctx;
    const addToggleOption = (key, label) =>
      menu.addItem((item) =>
        item.setTitle(label).setChecked(!!S[key]).onClick(async () => {
          S[key] = !S[key];
          await this.plugin.saveSettings();
          this.render();
        })
      );

    if (activeMode === "board") {
      menu.addItem((item) => item.setTitle("— Cartes —").setDisabled(true));
      for (const [val, label] of [[false, "Dossier par dossier"], [true, "Tout le manuscrit"]]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(wholeManuscript === val).onClick(async () => {
            if (meta) meta.boardWholeManuscript = val;
            S.boardWholeManuscript = val;
            await this.plugin.saveSettings();
            this.render(true);
          })
        );
      }
      menu.addSeparator();
      addToggleOption("showProgress", "Barres de progression");
      addToggleOption("showCardTags", "Tags sur les tuiles");
      menu.addSeparator();
      const contentOptions =
        pType === "nonfiction"
          ? [["extrait", "Corps : extrait du texte"], ["resume", "Corps : résumé"]]
          : [["extrait", "Corps : extrait du texte"], ["synopsis", "Corps : synopsis"]];
      for (const [val, label] of contentOptions) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(this.currentCardContent === val).onClick(async () => {
            if (meta) meta.cardContent = val;
            S.cardContent = val;
            await this.plugin.saveSettings();
            this.render();
          })
        );
      }
      menu.addSeparator();
      for (const [val, label] of [[180, "Tuiles petites"], [240, "Tuiles moyennes"], [320, "Tuiles grandes"]]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(S.tileSize === val).onClick(async () => {
            S.tileSize = val;
            await this.plugin.saveSettings();
            this.render();
          })
        );
      }
    } else if (activeMode === "outline") {
      menu.addItem((item) => item.setTitle("— Plan —").setDisabled(true));
      addToggleOption("showProgress", "Barres de progression");
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Réinitialiser la largeur des colonnes").onClick(async () => {
          S.outlineWidths = Object.assign({}, DEFAULT_SETTINGS.outlineWidths);
          await this.plugin.saveSettings();
          this.render();
        })
      );
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("— Colonnes affichées —").setDisabled(true));
      for (const [colKey, label] of [
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
      ]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(!!S.outlineCols[colKey]).onClick(async () => {
            S.outlineCols[colKey] = !S.outlineCols[colKey];
            await this.plugin.saveSettings();
            this.render();
          })
        );
      }
    } else if (activeMode === "timeline") {
      menu.addItem((item) => item.setTitle("— Chronologie —").setDisabled(true));
      for (const [val, label] of [["chrono", "Ordre chronologique"], ["narratif", "Ordre narratif"]]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(S.timelineOrder === val).onClick(async () => {
            S.timelineOrder = val;
            await this.plugin.saveSettings();
            this.render();
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Tous les jalons").setChecked(!S.timelineTagFilter).onClick(async () => {
          S.timelineTagFilter = "";
          await this.plugin.saveSettings();
          this.render();
        })
      );
      const chronoFolder = this.plugin.getChronoFolder();
      if (chronoFolder instanceof TFolder) {
        const tags = new Set();
        const collect = (f) => {
          for (const child of f.children) {
            if (child instanceof TFolder) collect(child);
            else if (child instanceof TFile && child.extension === "md") {
              for (const tag of this.plugin.tagsOf(child)) tags.add(tag);
            }
          }
        };
        collect(chronoFolder);
        for (const tag of [...tags].sort((a, b) => a.localeCompare(b, "fr"))) {
          menu.addItem((item) =>
            item.setTitle(`#${tag}`).setChecked(S.timelineTagFilter === tag).onClick(async () => {
              S.timelineTagFilter = tag;
              await this.plugin.saveSettings();
              this.render();
            })
          );
        }
      }
      menu.addSeparator();
      for (const [val, label] of [
        ["siecle", "Échelle : siècle"],
        ["annee", "Échelle : année"],
        ["mois", "Échelle : mois"],
        ["jour", "Échelle : jour"],
        ["aucune", "Échelle : sans en-têtes"],
      ]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked((S.timelineScale || "annee") === val).onClick(async () => {
            S.timelineScale = val;
            await this.plugin.saveSettings();
            this.render();
          })
        );
      }
    } else if (activeMode === "read" && folder) {
      menu.addItem((item) => item.setTitle("— Lecture —").setDisabled(true));
      menu.addItem((item) =>
        item.setTitle("Tout le manuscrit").setChecked(!S.readScope).onClick(async () => {
          S.readScope = "";
          await this.plugin.saveSettings();
          this.render();
        })
      );
      const addFolderScopeOptions = (f, depth) => {
        for (const child of this.plugin.getOrderedChildren(f)) {
          if (child instanceof TFolder) {
            menu.addItem((item) =>
              item.setTitle(`${"— ".repeat(depth)}${child.name}`).setChecked(S.readScope === child.path).onClick(async () => {
                S.readScope = child.path;
                await this.plugin.saveSettings();
                this.render();
              })
            );
            addFolderScopeOptions(child, depth + 1);
          }
        }
      };
      addFolderScopeOptions(folder, 0);
      menu.addItem((item) =>
        item
          .setTitle(S.readScope === "__selection__" ? "Modifier la sélection manuelle…" : "Sélection manuelle…")
          .setChecked(S.readScope === "__selection__")
          .onClick(() => {
            new ReadSelectionModal(this.app, this.plugin, () => {
              this.render(true);
            }).open();
          })
      );
    }
  }

  makeGoalInput(parent, file) {
    const fm = this.fm(file);
    const input = parent.createEl("input", {
      cls: "feuillets-goal-input",
      type: "number",
      attr: { min: "0", placeholder: String(this.plugin.settings.wordGoal) },
    });
    if (fm.objectif !== undefined) input.value = String(fm.objectif);
    input.addEventListener("change", async () => {
      const val = parseInt(input.value, 10);
      await this.setFm(file, "objectif", isNaN(val) ? "" : val);
    });
    return input;
  }

  makeTagsEditor(parent, file) {
    if (!this.plugin.settings.showTags) return;
    const wrap = parent.createDiv({ cls: "feuillets-tags" });
    const tags = this.plugin.tagsOf(file);
    for (const tag of tags) wrap.createSpan({ cls: "feuillets-tag-chip", text: `#${tag}` });
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: tags.length ? "+" : "+ tags" },
    });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const val = input.value.trim();
      if (!val) return;
      const added = val.split(/[,\s]+/).map((s) => s.replace(/^#/, "").trim()).filter(Boolean);
      const merged = [...new Set([...tags, ...added])];
      await this.setFm(file, "tags", merged);
      input.value = "";
      input.blur();
    });
    wrap.querySelectorAll(".feuillets-tag-chip").forEach((chip, idx) => {
      chip.setAttr("title", "Cliquer pour retirer ce tag");
      chip.addEventListener("click", async () => {
        const next = tags.filter((_, i) => i !== idx);
        await this.setFm(file, "tags", next);
      });
    });
  }

  renderBreadcrumbs(container, root, currentFolder) {
    const chain = [];
    let cur = currentFolder;
    while (cur && cur.path !== root.path) {
      chain.push(cur);
      cur = cur.parent;
    }
    chain.push(root);
    chain.reverse();

    const breadcrumbs = container.createDiv({ cls: "feuillets-board-breadcrumbs" });
    chain.forEach((f, idx) => {
      if (idx > 0) breadcrumbs.createSpan({ text: "  /  ", cls: "feuillets-breadcrumb-sep" });
      const isLast = idx === chain.length - 1;
      breadcrumbs
        .createSpan({ cls: "feuillets-breadcrumb-link" + (isLast ? " is-active" : ""), text: f.path === root.path ? "Projet" : f.name })
        .addEventListener("click", () => {
          this.focusedFolderPath = f.path;
          this.render(true);
        });
    });
  }

  renderBoard(container, root, currentFolder, numbering, bumpTotal) {
    const children = this.plugin.getOrderedChildren(currentFolder).filter((c) => !this.plugin.isFrontMatter(c));
    const grid = container.createDiv({ cls: "feuillets-grid" });
    this.gridStyle(grid);
    for (let i = 0; i < children.length; i++) {
      const item = children[i];
      if (item instanceof TFile) {
        if (this.passesFilter(item)) this.renderCard(grid, currentFolder, item, i, children, numbering, bumpTotal);
      } else if (item instanceof TFolder) {
        this.renderFolderCard(grid, currentFolder, item, i, children, numbering, bumpTotal);
      }
    }
  }

  renderBoardWholeManuscript(container, root, numbering, bumpTotal) {
    const walk = (folder, depth) => {
      const children = this.plugin.getOrderedChildren(folder).filter((c) => !this.plugin.isFrontMatter(c));
      let activeGrid = null;
      for (let i = 0; i < children.length; i++) {
        const item = children[i];
        if (item instanceof TFolder) {
          activeGrid = null;
          const sec = container.createDiv({ cls: "feuillets-board-whole-section" });
          sec.style.marginLeft = `${depth * 16}px`;
          const collapsed = this.renderSectionHead(sec, "folder", item.name, "board:whole", item.path);
          if (!collapsed) walk(item, depth + 1);
        } else if (item instanceof TFile) {
          if (!this.passesFilter(item)) continue;
          if (!activeGrid) {
            activeGrid = container.createDiv({ cls: "feuillets-grid feuillets-board-whole-grid" });
            activeGrid.style.marginLeft = `${depth * 16}px`;
            this.gridStyle(activeGrid);
          }
          this.renderCard(activeGrid, folder, item, i, children, numbering, bumpTotal);
        }
      }
    };
    walk(root, 0);
  }

  makeClickToEditFmArea(parent, file, key, placeholder, maxLines = 6) {
    const fm = this.fm(file);
    const val = fm[key] || "";
    const cell = parent.createDiv({ cls: "feuillets-flat-text-cell" + (val ? "" : " is-empty"), text: val || placeholder });
    if (maxLines) {
      cell.style.setProperty("--max-lines", String(maxLines));
      cell.addClass("feuillets-clamp-text");
    }
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      cell.style.display = "none";
      const area = parent.createEl("textarea", { cls: "feuillets-flat-textarea" });
      area.value = fm[key] || "";
      area.focus();
      area.style.height = "auto";
      area.style.height = `${area.scrollHeight}px`;
      const save = async () => {
        if (area.parentNode) {
          const raw = area.value.trim();
          if (raw !== (fm[key] || "")) {
            await this.setFm(file, key, raw);
            cell.setText(raw || placeholder);
            if (raw) cell.removeClass("is-empty"); else cell.addClass("is-empty");
          }
          area.remove();
          cell.style.display = "";
        }
      };
      area.addEventListener("blur", save);
      area.addEventListener("keydown", (evt) => {
        if (evt.key === "Escape" || (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey))) area.blur();
      });
    });
    return cell;
  }

  renderFolderCard(container, parentFolder, folder, index, siblings, numbering, bumpTotal) {
    const S = this.plugin.settings;
    const card = container.createDiv({ cls: "feuillets-card feuillets-card-folder" });
    card.setAttr("title", `Double-cliquer pour entrer dans : ${folder.name}`);
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showFolderContextMenu(e, folder, parentFolder, index, siblings);
    });
    card.addEventListener("dblclick", () => {
      this.focusedFolderPath = folder.path;
      this.render(true);
    });

    const folderNote = this.plugin.folderNoteFor(folder);
    const label = folderNote ? this.plugin.labelOf(folderNote) : null;
    const color = label ? this.plugin.labelColor(label) : null;
    if (color) card.style.borderTop = `3px solid ${color}`;

    const head = card.createDiv({ cls: "feuillets-card-head" });
    const icon = head.createDiv({ cls: "feuillets-card-icon" });
    setIcon(icon, "folder");
    const num = head.createDiv({
      cls: "feuillets-card-num",
      style: "font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 90px; cursor: pointer;",
    });
    num.setText(folder.name);
    num.setAttr("title", "Cliquer pour entrer");
    num.addEventListener("click", (e) => {
      e.stopPropagation();
      this.focusedFolderPath = folder.path;
      this.render(true);
    });

    const wcEl = head.createDiv({ cls: "feuillets-card-wc" });
    const ring = head.createDiv({ cls: "feuillets-ring" });
    if (!S.showProgress) ring.style.display = "none";

    const totalWc = this.plugin.flattenFiles(folder).reduce((acc, f) => acc + (this.wcMap.get(f.path) || 0), 0);
    const goal = this.plugin.folderGoal(folder);
    wcEl.setText(goal > 0 ? `${totalWc} / ${goal}` : String(totalWc));
    if (S.showProgress) this.fillRing(ring, totalWc, goal);

    const fieldKey = this.currentCardContent === "synopsis" ? "synopsis" : "resume";
    const summary = (folderNote && this.plugin.fmOf(folderNote)[fieldKey]) || "";
    const excerpt = card.createDiv({ cls: "feuillets-card-excerpt" });
    excerpt.style.marginTop = "8px";
    excerpt.setText(summary || (fieldKey === "synopsis" ? "Synopsis du dossier…" : "Résumé du dossier…"));

    if (!this.filterActive()) this.attachDragHandlers(head, card, parentFolder, index, siblings, container);
  }

  renderCard(container, parentFolder, file, index, siblings, numbering, bumpTotal) {
    const S = this.plugin.settings;
    const role = this.plugin.roleOfFile(file);
    const goal = this.goalFor(file);
    const card = container.createDiv({ cls: role === "scene" ? "feuillets-card feuillets-card-scene" : "feuillets-card" });
    card.setAttr("title", file.basename);
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showFileContextMenu(e, file, parentFolder, index, siblings);
    });

    const label = this.plugin.labelOf(file);
    const color = label ? this.plugin.labelColor(label) : null;
    /* Liseré latéral plutôt que bande supérieure : sur la grille de
       fiches, une barre pleine largeur en haut de chaque carte dominait
       visuellement toute la grille (effet "tableau kanban coloré") avant
       même de lire le texte. En bordure gauche, la couleur du label reste
       un vrai repère au premier coup d'œil sans écraser le reste. */
    if (color) card.style.borderLeft = `3px solid ${color}`;

    const head = card.createDiv({ cls: "feuillets-card-head" });
    if (this.selectionModeActive && this.plugin.isSceneFile(file)) {
      const cb = head.createEl("input", { type: "checkbox", cls: "feuillets-scene-select" });
      cb.checked = this.sceneSelection.has(file.path);
      cb.setAttr("title", `Sélectionner cette ${this.plugin.unitLabel()}`);
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) this.sceneSelection.add(file.path);
        else this.sceneSelection.delete(file.path);
        this.render(true);
      });
    }

    const icon = head.createDiv({ cls: "feuillets-card-icon" });
    setIcon(icon, "file-text");
    head.createDiv({ cls: "feuillets-card-num" }).setText(String(numbering.get(file.path)));
    const titleEl = head.createDiv({ cls: "feuillets-card-title" });
    titleEl.setText(this.plugin.shortTitleFor(file));
    titleEl.setAttr("title", file.basename);

    const more = head.createDiv({ cls: "feuillets-card-more clickable-icon" });
    setIcon(more, "more-horizontal");
    more.setAttr("title", "Statut, tags, notes…");
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = new Menu();
      const currentSt = this.fm(file).statut || "";
      for (const st of STATUSES.filter(Boolean)) {
        menu.addItem((item) =>
          item.setTitle(`Statut : ${st}`).setChecked(st === currentSt).onClick(async () => {
            await this.setFm(file, "statut", st === currentSt ? "" : st);
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Modifier les tags…").onClick(() => {
          this.plugin.openTagsModal(file);
        })
      );
      menu.addItem((item) =>
        item.setTitle("Modifier le résumé…").onClick(() => {
          this.plugin.openFmFieldModal(file, "resume", "Résumé long");
        })
      );
      menu.addItem((item) =>
        item.setTitle("Ouvrir le fichier").onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
        })
      );

      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Comparer avec le snapshot").setIcon("history").onClick(async () => {
          const projectRoot = this.plugin.getProjectFolder();
          const snapshots = listSnapshotFiles(this.app, file, projectRoot);

          if (snapshots.length === 0) {
            new Notice(`Aucun snapshot trouvé pour : ${file.basename}`);
            return;
          }

          new DiffModal(this.app, this.plugin, file, snapshots[0]).open();
        })
      );

      menu.showAtMouseEvent(e);
    });

    const wcEl = head.createDiv({ cls: "feuillets-card-wc" });
    const ring = head.createDiv({ cls: "feuillets-ring" });
    if (!S.showProgress) ring.style.display = "none";

    if (this.currentCardContent === "synopsis") {
      this.makeClickToEditFmArea(card, file, "synopsis", "Synopsis…", 6);
    } else if (this.currentCardContent === "resume") {
      this.makeClickToEditFmArea(card, file, "resume", "Résumé…", 6);
    } else {
      const excerpt = card.createDiv({ cls: "feuillets-card-excerpt", text: "…" });
      excerpt.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });
      this.app.vault.cachedRead(file).then((raw) => {
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
        /* On tranche un peu large AVANT de nettoyer la syntaxe (le nettoyage
           raccourcit le texte) puis on recoupe à la longueur voulue —
           inutile de dépouiller tout le corps du feuillet pour un aperçu. */
        const limit = S.excerptLength || 420;
        const clean = stripMarkdown(body.slice(0, limit + 200)).slice(0, limit);
        excerpt.setText(clean || "— vide —");
      });
    }

    if (S.showCardTags) this.makeTagsEditor(card, file);

    const wc = this.wcMap.get(file.path) || 0;
    bumpTotal(wc);
    wcEl.setText(String(wc));
    if (S.showProgress) this.fillRing(ring, wc, goal);

    if (!this.filterActive()) this.attachDragHandlers(head, card, parentFolder, index, siblings, container);
  }

  async renderReading(container, rootFolder, numbering) {
    container.empty();
    const scrollWrap = container.createDiv({ cls: "feuillets-reading-wrapper" });

    const S = this.plugin.settings;
    let targetFolder = rootFolder;
    if (S.readScope && S.readScope !== "__selection__") {
      const folder = this.app.vault.getAbstractFileByPath(S.readScope);
      if (folder instanceof TFolder && folder.path.startsWith(rootFolder.path)) {
        targetFolder = folder;
      }
    }

    let filesToRead = [];
    if (S.readScope === "__selection__") {
      const selectedPaths = new Set(S.readSelection || []);
      filesToRead = this.plugin.flattenFiles(rootFolder).filter((f) => selectedPaths.has(f.path));
    } else {
      filesToRead = this.plugin.flattenFiles(targetFolder).filter(
        (f) => this.passesFilter(f) && !this.plugin.isFrontMatter(f)
      );
    }

    if (filesToRead.length === 0) {
      scrollWrap.createDiv({
        cls: "feuillets-empty",
        text: S.readScope === "__selection__"
          ? "Aucun feuillet sélectionné — choisis « Sélection manuelle… » dans le menu."
          : "Aucun feuillet ne passe les filtres actifs.",
      });
      return;
    }

    if (this.scriveningsManager) {
      this.scriveningsManager.destroy();
    }

    this.scriveningsManager = new ScriveningsManager(
      this.app,
      scrollWrap,
      (file) => openFileActivating(this.app, this.app.workspace.getLeaf(false), file)
    );

    await this.scriveningsManager.loadScenes(filesToRead, this.plugin, this);
  }

  renderCheminDeFer(container, root, numbering) {
    const items = [];
    const collect = (folder) => {
      for (const child of this.plugin.getOrderedChildren(folder)) {
        if (child.name.startsWith("_") || child.path.includes("/_") || this.plugin.isFrontMatter(child)) continue;
        if (child instanceof TFolder) {
          const role = this.plugin.roleOfFolder(child);
          if (role === "partie" || role === "chapitre") items.push({ type: "folder", folder: child, role });
          collect(child);
        } else if (child instanceof TFile && child.extension === "md") {
          const role = this.plugin.roleOfFile(child);
          if (role === "scene" || role === "chapitre") items.push({ type: "file", file: child });
        }
      }
    };
    collect(root);

    const fileItems = items.filter((i) => i.type === "file");
    const labelsSet = new Set();
    const labelMap = new Map();
    const filsMap = new Map();
    const personnagesSet = new Set();
    const personnagesMap = new Map();

    for (const item of fileItems) {
      const lbs = this.plugin.labelsOf(item.file);
      labelMap.set(item.file.path, lbs);
      for (const l of lbs) labelsSet.add(l);
      filsMap.set(item.file.path, getFilsList(this.fm(item.file)));
      const persos = getPersonnagesList(this.fm(item.file));
      personnagesMap.set(item.file.path, persos);
      for (const p of persos) personnagesSet.add(p);
    }

    const sortedLabels = Array.from(labelsSet).sort((a, b) => a.localeCompare(b, "fr"));
    const filsSet = new Set();
    for (const arr of filsMap.values()) for (const f of arr) filsSet.add(f);
    const sortedFils = Array.from(filsSet).sort((a, b) => a.localeCompare(b, "fr"));
    const sortedPersonnages = Array.from(personnagesSet).sort((a, b) => a.localeCompare(b, "fr"));

    const wrap = container.createDiv({ cls: "feuillets-notes-container" });
    if (sortedLabels.length === 0 && sortedFils.length === 0) {
      wrap.createDiv({
        cls: "feuillets-empty",
        text: `Aucun label ni fil détecté. Ajoute label: Nom ou fil: indice dans le YAML pour construire le chemin de fer.`,
      });
      return;
    }

    const filterBar = wrap.createDiv({ cls: "feuillets-arcs-filter-bar" });

    const buildFilterGroup = (icon, labelText, options, currentValue, onChange, extraCls) => {
      const group = filterBar.createDiv({ cls: "feuillets-arcs-filter-group" + (extraCls ? ` ${extraCls}` : "") });
      group.createSpan({ cls: "feuillets-arcs-filter-label", text: `${icon} ${labelText}` });
      const sel = group.createEl("select", { cls: "dropdown feuillets-arcs-filter-select" });
      sel.createEl("option", { value: "", text: "Tous" });
      for (const opt of options) sel.createEl("option", { value: opt, text: opt });
      sel.value = currentValue || "";
      sel.addEventListener("change", () => {
        onChange(sel.value);
        this.render(true);
      });
      return group;
    };

    if (sortedLabels.length > 0) {
      buildFilterGroup("📍", "Lieu", sortedLabels, this.selectedLabel, (v) => { this.selectedLabel = v; }, "is-label");
    }
    if (sortedPersonnages.length > 0) {
      buildFilterGroup("👤", "Personnage", sortedPersonnages, this.selectedPerso, (v) => { this.selectedPerso = v; }, "is-perso");
    }
    if (sortedFils.length > 0) {
      buildFilterGroup("🧵", "Fil", sortedFils, this.selectedFil, (v) => { this.selectedFil = v; }, "is-fil");
    }

    const filterLabel = this.selectedLabel || "";
    const filterFil = this.selectedFil || "";
    const filterPerso = this.selectedPerso || "";

    const activeLabels = filterLabel ? [filterLabel] : sortedLabels;
    const activeFils = filterFil ? [filterFil] : sortedFils;
    const matchedSet = (filterLabel || filterFil || filterPerso)
      ? new Set(fileItems.filter((i) => {
          const path = i.file.path;
          if (filterLabel && !(labelMap.get(path) || []).includes(filterLabel)) return false;
          if (filterFil && !(filsMap.get(path) || []).includes(filterFil)) return false;
          if (filterPerso && !(personnagesMap.get(path) || []).includes(filterPerso)) return false;
          return true;
        }).map((i) => i.file.path))
      : null;

    // Étendue (première → dernière apparition) de chaque lieu/fil parmi les scènes
    // effectivement affichées, pour tracer une ligne de continuité entre les points.
    const renderedPaths = items
      .filter((i) => i.type === "file" && (!matchedSet || matchedSet.has(i.file.path)))
      .map((i) => i.file.path);

    const labelFirst = {}, labelLast = {};
    activeLabels.forEach((lb) => { labelFirst[lb] = -1; labelLast[lb] = -1; });
    const filFirst = {}, filLast = {};
    activeFils.forEach((f) => { filFirst[f] = -1; filLast[f] = -1; });

    renderedPaths.forEach((path, idx) => {
      for (const lb of labelMap.get(path) || []) {
        if (!(lb in labelFirst)) continue;
        if (labelFirst[lb] === -1) labelFirst[lb] = idx;
        labelLast[lb] = idx;
      }
      for (const f of filsMap.get(path) || []) {
        if (!(f in filFirst)) continue;
        if (filFirst[f] === -1) filFirst[f] = idx;
        filLast[f] = idx;
      }
    });

    const timeline = wrap.createDiv({ cls: "feuillets-arcs-timeline" });
    let fileIndex = 0;

    for (const item of items) {
      if (item.type === "folder") {
        const row = timeline.createDiv({ cls: `feuillets-arcs-row-folder feuillets-arcs-${item.role}` });
        const spacerLeft = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
        spacerLeft.style.width = `${activeLabels.length * 16}px`;
        const title = row.createDiv({ cls: "feuillets-arcs-folder-title" });
        const num = numbering ? numbering.get(item.folder.path) : "";
        if (num) title.createSpan({ cls: "feuillets-arcs-folder-num", text: num });
        title.createSpan({ text: item.folder.name });
        const spacerRight = row.createDiv({ cls: "feuillets-arcs-row-rails-spacer" });
        spacerRight.style.width = `${activeFils.length * 16}px`;
        continue;
      }

      const file = item.file;
      if (matchedSet && !matchedSet.has(file.path)) continue;

      const idx = fileIndex++;
      const fm = this.fm(file);
      const row = timeline.createDiv({ cls: "feuillets-arcs-row-file" });
      row.style.cursor = "pointer";

      // Lieux (label:) à gauche en ronds
      const rails = row.createDiv({ cls: "feuillets-arcs-row-rails" });
      rails.style.width = `${activeLabels.length * 16}px`;
      const currentLabels = labelMap.get(file.path) || [];

      activeLabels.forEach((lb) => {
        const col = rails.createDiv({ cls: "feuillets-arcs-col" });
        const color = this.plugin.labelColor(lb);
        col.style.setProperty("--arc-color", color);
        const hasLabel = currentLabels.includes(lb);
        if (labelFirst[lb] !== -1 && idx >= labelFirst[lb] && idx <= labelLast[lb]) {
          const line = col.createDiv({ cls: "feuillets-arcs-line" });
          line.style.backgroundColor = color;
          if (!hasLabel) line.style.opacity = "0.2";
        }
        if (hasLabel) {
          const dot = col.createDiv({ cls: "feuillets-arcs-dot", attr: { title: lb } });
          dot.style.backgroundColor = color;
        }
      });

      const info = row.createDiv({ cls: "feuillets-arcs-info" });
      const titleRow = info.createDiv({ cls: "feuillets-arcs-title-row" }).createDiv({ cls: "feuillets-arcs-title-left" });
      if (numbering) titleRow.createSpan({ cls: "feuillets-row-num", text: numbering.get(file.path) || "" });
      if (fm.statut) {
        titleRow.createSpan({ cls: `feuillets-status-dot feuillets-status-dot-${STATUSES.indexOf(fm.statut)}` });
      }
      titleRow.createDiv({ cls: "feuillets-arcs-file-title", text: this.plugin.shortTitleFor(file) });

      if (fm.synopsis) info.createDiv({ cls: "feuillets-arcs-file-synopsis", text: fm.synopsis });

      const currentPersonnages = personnagesMap.get(file.path) || [];
      if (currentPersonnages.length > 0) {
        info.createDiv({ cls: "feuillets-arcs-personnages", text: `Avec ${currentPersonnages.join(", ")}` });
      }

      // Fils (fil:) à droite en carrés
      const filRails = row.createDiv({ cls: "feuillets-arcs-row-rails" });
      filRails.style.width = `${activeFils.length * 16}px`;
      const currentFils = filsMap.get(file.path) || [];

      activeFils.forEach((f) => {
        const col = filRails.createDiv({ cls: "feuillets-arcs-col" });
        const color = filColor(f);
        col.style.setProperty("--arc-color", color);
        const hasFil = currentFils.includes(f);
        if (filFirst[f] !== -1 && idx >= filFirst[f] && idx <= filLast[f]) {
          const line = col.createDiv({ cls: "feuillets-arcs-line" });
          line.style.backgroundColor = color;
          if (!hasFil) line.style.opacity = "0.2";
        }
        if (hasFil) {
          const dot = col.createDiv({ cls: "feuillets-arcs-dot feuillets-arcs-dot-fil", attr: { title: f } });
          dot.style.backgroundColor = color;
        }
      });

      row.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });
    }
  }

  renderTimeline(container, folder, numbering) {
    return this.renderTimelineInner(container, folder, numbering);
  }

  renderTimelineInner(container, folder, numbering) {
    const files = this.plugin.flattenFiles(folder).filter((f) => this.passesFilter(f) && !this.plugin.isFrontMatter(f));
    const items = [];
    for (const file of files) {
      const dateObj = parseStoryDate(this.fm(file).date, file);
      if (dateObj) items.push({ file, ...dateObj });
    }

    const chronoFolder = this.plugin.getChronoFolder();
    if (chronoFolder instanceof TFolder) {
      const collect = (f) => {
        for (const child of f.children) {
          if (child instanceof TFolder) collect(child);
          else if (child instanceof TFile && child.extension === "md") {
            const dateObj = parseStoryDate(this.fm(child).date, child);
            if (!dateObj) continue;
            const filter = this.plugin.settings.timelineTagFilter;
            if (filter && !this.plugin.tagsOf(child).includes(filter)) continue;
            items.push({ file: child, milestone: true, ...dateObj });
          }
        }
      };
      collect(chronoFolder);
    }

    if (this.plugin.settings.timelineOrder === "narratif") {
      const fileOrder = new Map(files.map((f, i) => [f.path, i]));
      items.sort((a, b) => (fileOrder.get(a.file.path) ?? 999) - (fileOrder.get(b.file.path) ?? 999));
    } else {
      items.sort((a, b) => a.sort - b.sort);
    }

    if (items.length === 0) {
      container.createDiv({ cls: "feuillets-empty", text: "Aucune scène datée." });
      return;
    }

    const timeline = container.createDiv({ cls: "feuillets-timeline" });
    for (const item of items) {
      const row = timeline.createDiv({ cls: item.milestone ? "feuillets-timeline-item feuillets-timeline-milestone" : "feuillets-timeline-item" });
      row.createDiv({ cls: "feuillets-timeline-date", text: item.display });
      row.createDiv({ cls: "feuillets-timeline-dot" });
      const body = row.createDiv({ cls: "feuillets-timeline-body" });
      const head = body.createDiv({ cls: "feuillets-timeline-head" });

      head.createSpan({ cls: "feuillets-timeline-title", text: this.plugin.shortTitleFor(item.file) }).addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), item.file);
      });
      if (this.fm(item.file).synopsis) body.createDiv({ cls: "feuillets-timeline-syn", text: this.fm(item.file).synopsis });
    }
  }

  visibleCols() {
    const cols = this.plugin.settings.outlineCols;
    const res = [{ id: "title", label: "Feuillet" }];
    if (cols.synopsis) res.push({ id: "synopsis", label: "Synopsis" });
    if (cols.resume) res.push({ id: "resume", label: "Résumé" });
    if (cols.notes) res.push({ id: "notes", label: "Notes" });
    if (cols.tags) res.push({ id: "tags", label: "Tags" });
    if (cols.label) res.push({ id: "label", label: "Label" });
    if (cols.status) res.push({ id: "status", label: "Statut" });
    if (cols.date) res.push({ id: "date", label: "Date" });
    if (cols.compiler) res.push({ id: "compiler", label: "Compiler" });
    if (cols.filename) res.push({ id: "filename", label: "Fichier" });
    if (cols.words) res.push({ id: "words", label: "Mots" });
    if (cols.goal) res.push({ id: "goal", label: "Objectif" });
    if (cols.progress) res.push({ id: "progress", label: "Progression" });
    return res;
  }

  colsTemplate(overrideWidths) {
    const widths = overrideWidths || this.plugin.settings.outlineWidths;
    return "22px " + this.visibleCols().map((c) => `${Math.max(60, widths[c.id] || 120)}px`).join(" ");
  }

  async renderOutline(container, root, numbering, bumpTotal, gen) {
    const outline = container.createDiv({ cls: "feuillets-outline" });
    outline.style.setProperty("--feuillets-cols", this.colsTemplate());
    const cols = this.visibleCols();
    const head = outline.createDiv({ cls: "feuillets-row feuillets-row-head" });
    head.createDiv({ cls: "feuillets-col-handle" });

    for (const c of cols) {
      const cell = head.createDiv({ cls: "feuillets-col-head-cell" });
      cell.createSpan({ text: c.label });
      const resizer = cell.createDiv({ cls: "feuillets-col-resizer" });
      this.attachColumnResize(resizer, c.id, outline);
    }

    const progress = { count: 0 };
    await this.renderOutlineLevel(outline, root, 0, numbering, bumpTotal, cols, progress, gen);
  }

  /** Glisser le bord droit d'un en-tête de colonne pour la redimensionner
   * (poignée .feuillets-col-resizer, CSS déjà prévu mais jamais câblé). La
   * largeur courante suit la souris en direct via la variable CSS
   * --feuillets-cols (aucun re-rendu pendant le glissement — juste un
   * recalcul de grid-template-columns, comme colsTemplate() le ferait),
   * et n'est écrite dans les réglages (donc persistée) qu'au relâchement. */
  attachColumnResize(resizer, colId, outline) {
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const widths = this.plugin.settings.outlineWidths;
      const startX = e.clientX;
      const startWidth = Math.max(60, widths[colId] || 120);
      let liveWidth = startWidth;

      /* is-resizing plutôt que compter sur :hover pendant le glissement :
         un mouvement rapide de souris quitte facilement la poignée de
         7px de large, et user-select:none évite de sélectionner le texte
         des lignes en dessous pendant qu'on tire. */
      resizer.addClass("is-resizing");
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMouseMove = (moveEvent) => {
        liveWidth = Math.max(60, startWidth + (moveEvent.clientX - startX));
        outline.style.setProperty(
          "--feuillets-cols",
          this.colsTemplate({ ...widths, [colId]: liveWidth })
        );
      };
      const onMouseUp = async () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        resizer.removeClass("is-resizing");
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        widths[colId] = liveWidth;
        await this.plugin.saveSettings();
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  emptyCells(row, cols, handlers) {
    for (const c of cols) {
      if (handlers && handlers[c.id]) {
        handlers[c.id](row.createDiv({ cls: `feuillets-cell feuillets-cell-${c.id}` }));
      } else if (c.id !== "title") {
        row.createDiv({ cls: `feuillets-cell feuillets-cell-${c.id}` });
      }
    }
  }

  async renderOutlineLevel(table, parentFolder, depth, numbering, bumpTotal, cols, progress, gen) {
    const children = this.plugin.getOrderedChildren(parentFolder).filter((c) => !this.plugin.isFrontMatter(c));
    for (let i = 0; i < children.length; i++) {
      if (this._renderGen !== gen) return;
      const child = children[i];
      if (child instanceof TFolder) {
        const row = table.createDiv({ cls: "feuillets-row feuillets-row-folder" });
        const handle = row.createDiv({ cls: "feuillets-col-handle", text: "⋮⋮" });
        const titleCell = row.createDiv({ cls: "feuillets-cell feuillets-cell-title" });
        titleCell.style.paddingLeft = `${depth * 16}px`;
        titleCell.createSpan({ cls: "feuillets-folder-name", text: child.name });

        await this.renderOutlineLevel(table, child, depth + 1, numbering, bumpTotal, cols, progress, gen);
        continue;
      }

      if (!this.passesFilter(child)) continue;
      const row = table.createDiv({ cls: "feuillets-row feuillets-row-scene" });
      row.setAttr("data-path", child.path);

      const handle = row.createDiv({ cls: "feuillets-col-handle", text: "⋮⋮" });
      const titleCell = row.createDiv({ cls: "feuillets-cell feuillets-cell-title" });
      titleCell.style.paddingLeft = `${depth * 16}px`;
      titleCell.createSpan({ cls: "feuillets-title-text", text: this.plugin.shortTitleFor(child) }).addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), child);
      });

      const wc = this.wcMap.get(child.path) || 0;
      bumpTotal(wc);

      this.emptyCells(row, cols, {
        synopsis: (cell) => this.makeClickToEditFmArea(cell, child, "synopsis", "Synopsis…", 1),
        resume: (cell) => this.makeClickToEditFmArea(cell, child, "resume", "Résumé…", 1),
        notes: (cell) => this.makeClickToEditFmArea(cell, child, "notes", "Notes…", 1),
        tags: (cell) => this.makeTagsEditor(cell, child),
        label: (cell) => this.makeLabelSelect(cell, child),
        status: (cell) => this.makeStatusSelect(cell, child),
        date: (cell) => cell.setText(this.fm(child).date || "—"),
        compiler: (cell) => cell.setText(this.fm(child).compiler !== false ? "Oui" : "Non"),
        filename: (cell) => cell.setText(child.basename),
        words: (cell) => cell.setText(String(wc)),
        goal: (cell) => cell.setText(String(this.goalFor(child))),
        progress: (cell) => {
          const ring = cell.createDiv({ cls: "feuillets-ring" });
          this.fillRing(ring, wc, this.goalFor(child));
        }
      });
    }
  }

  async onClose() {
    if (this.scriveningsManager) {
      this.scriveningsManager.destroy();
      this.scriveningsManager = null;
    }
    await super.onClose();
  }
}