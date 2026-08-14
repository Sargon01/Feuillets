import { Menu, Modal, Setting, TFile, TFolder, setIcon, setTooltip, Notice } from "obsidian";
import { VIEW_BOARD, getProjectStatuses, BOARD_MODES } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { openFileActivating } from "../utils/dom.js";
import { parseStoryDate, stripMarkdown } from "../utils/core.js";
import { PROJECT_MODES, resolveType } from "../utils/project-modes.js";
import { DEFAULT_SETTINGS } from "../default-settings.js";
import { povOf } from "../utils/arc-fields.js";
import { openSnapshotComparison } from "./comparison-view.js";
import { FmFieldModal } from "../ui/fm-field-modal.js";
import { TagsModal } from "../ui/entity-modals.js";
import { listSnapshotFiles } from "../services/project-files.js";
import { t } from "../i18n/index.js";
import { toValue } from "../utils/scene-fields.js";

type ProjectNode = TFile | TFolder;
type BoardModeKey = "board" | "outline" | "arcs" | "timeline";

/* isSceneFile/openMergeModal/duplicateManyScenes/openMoveManyModal sont
   attachés dynamiquement au plugin par initScenesEditor (scenes-editor.ts),
   pas déclarés comme méthodes de classe dans main.js — absents du type
   inféré de FeuilletsPlugin, donc ajoutés ici comme dans ScenesEditorPlugin.
   _binderMultiSelect : idem, attaché par base-feuillets-view.js. */
type BoardViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1] & {
  _binderMultiSelect?: Set<string>;
  moveStack?: unknown[];
  isSceneFile(file: TFile): boolean;
  openMergeModal(files: TFile[]): Promise<void>;
  duplicateManyScenes(files: TFile[]): Promise<void>;
  openMoveManyModal(files: TFile[]): void;
};

function differsFromDefaults(value: Record<string, unknown> | undefined, defaults: Record<string, unknown>): boolean {
  if (!value) return false;
  return Object.keys({ ...defaults, ...value }).some((key) => {
    const current = value[key];
    const initial = defaults[key];
    if (Array.isArray(current) && Array.isArray(initial)) {
      return current.length !== initial.length || current.some((entry, index) => entry !== initial[index]);
    }
    return current !== initial;
  });
}

/* app.commands (exécution de commandes par id) est une API interne
   d'Obsidian, non déclarée dans obsidian.d.ts. */
type AppWithCommands = {
  commands: { executeCommandById(id: string): boolean };
};

/** @param el */
function isInputFocused(el: HTMLElement): boolean {
  const active = document.activeElement;
  return !!active && el.contains(active) && ["TEXTAREA", "INPUT"].includes(active.tagName);
}

function getFilsList(fm: Record<string, unknown>): string[] {
  const fils = fm.thread;
  if (Array.isArray(fils)) return fils.filter(Boolean).map((r) => String(r).trim()).filter(Boolean);
  if (typeof fils === "string" && fils.trim()) return fils.split(",").map((r) => r.trim()).filter(Boolean);
  return [];
}

function getPersonnagesList(fm: Record<string, unknown>): string[] {
  const persos = fm.characters;
  if (Array.isArray(persos)) return persos.filter(Boolean).map((r) => String(r).trim()).filter(Boolean);
  if (typeof persos === "string" && persos.trim()) return persos.split(",").map((r) => r.trim()).filter(Boolean);
  return [];
}

function filColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`;
}

type ModeOptionsCtx = {
  S: FeuilletsSettings;
  meta: ProjectMeta;
  pType: string;
  wholeManuscript: boolean;
};

class TagFilterModal extends Modal {
  private value: string;
  private readonly onSubmit: (value: string) => Promise<void>;
  private submitting = false;

  constructor(app: import("obsidian").App, value: string, onSubmit: (value: string) => Promise<void>) {
    super(app);
    this.value = value;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.empty();
    this.setTitle(t("board.filter.tagPrompt"));
    new Setting(this.contentEl).addText((text) => {
      text.setValue(this.value);
      text.onChange((value) => {
        this.value = value;
      });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.submit();
        }
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t("modal.cancel")).onClick(() => this.close()))
      .addButton((button) => button.setButtonText(t("modal.save")).setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    await this.onSubmit(this.value.trim().replace(/^#/, ""));
    this.close();
  }
}

export class BoardView extends BaseFeuilletsView {
  declare plugin: BoardViewPlugin;
  declare iconBtn: (
    parent: HTMLElement,
    icon: string,
    tooltip?: string,
    onClick?: (e: MouseEvent) => unknown
  ) => HTMLElement;
  focusedFolderPath: string | null;
  currentCardContent?: string;
  selectionModeActive?: boolean;
  wcMap?: Map<string, number>;
  selectedLabel?: string;
  selectedPerso?: string;
  selectedFil?: string;
  selectedPov?: string;
  _renderGen?: number;
  outlineColumns?: Record<string, boolean>;

  constructor(leaf: import("obsidian").WorkspaceLeaf, plugin: BoardViewPlugin) {
    super(leaf, plugin);
    this.focusedFolderPath = null;
  }

  getViewType(): string {
    return VIEW_BOARD;
  }

  getDisplayText(): string {
    return t("board.displayText");
  }

  /** Libellé affiché d'un mode du panneau Cartes (BOARD_MODES ne fournit
   * qu'une clé + un repli français) — traduit via i18n, jamais le repli
   * brut de constants.js. */
  boardModeLabel(k: string): string {
    return t(`board.mode.${k}`);
  }

  /** Traduit à l'affichage les valeurs sentinelles internes des filtres
   * (stockées en français dans les réglages, comme pour le Binder — voir
   * filterSentinelLabel dans feuillets-view.js) ; un statut/label/POV réel
   * choisi par l'utilisateur passe inchangé. */
  filterSentinelLabel(v: string): string {
    return v === "Tous" ? t("binder.filter.all")
      : v === "Sans statut" ? t("binder.filter.noStatus")
      : v === "Sans label" ? t("binder.filter.noLabel")
      : v === "Sans POV" ? t("board.filter.noPov")
      : v === "Atteint" ? t("binder.filter.progressHit")
      : v === "En dessous" ? t("binder.filter.progressUnder")
      : v === "Dépassé" ? t("binder.filter.progressOver")
      : v;
  }

  getIcon(): string {
    return "layout-grid";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateActiveHighlight()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateActiveHighlight()));
    await this.render();
  }

  updateActiveHighlight(): void {
    const active = this.app.workspace.getActiveFile();
    this.highlightActivePath(active ? active.path : null);
  }

  highlightActivePath(path: string | null): void {
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

  async render(force = false): Promise<void> {
    return this._render(force);
  }

  passesFilter(file: TFile): boolean {
    const S = this.plugin.settings;
    const statusFilter = S.statusFilter;
    if (statusFilter && statusFilter !== "Tous") {
      const currentStatus = String((this.fm(file).status as string | number | boolean | null | undefined) || "");
      if (statusFilter === "Sans statut" ? currentStatus !== "" : currentStatus !== statusFilter) return false;
    }
    const labelFilter = S.labelFilter;
    if (labelFilter && labelFilter !== "Tous") {
      const labels = this.plugin.labelsOf(file);
      if (labelFilter === "Sans label" ? labels.length !== 0 : !labels.includes(labelFilter)) return false;
    }
    const povFilter = S.povFilter;
    if (povFilter && povFilter !== "Tous") {
      const currentPov = povOf(this.fm(file));
      if (povFilter === "Sans POV" ? currentPov !== "" : currentPov !== povFilter) return false;
    }
    const tagTerm = (S.tagFilter || "").trim().toLowerCase().replace(/^#/, "");
    if (tagTerm && !this.plugin.tagsOf(file).map((l: string) => l.toLowerCase()).some((l: string) => l.includes(tagTerm))) return false;
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

  filterActive(): boolean {
    const S = this.plugin.settings;
    return !!(
      (S.statusFilter && S.statusFilter !== "Tous") ||
      (S.labelFilter && S.labelFilter !== "Tous") ||
      (S.progressFilter && S.progressFilter !== "Tous") ||
      (S.povFilter && S.povFilter !== "Tous") ||
      (S.tagFilter || "").trim() !== ""
    );
  }

  gridStyle(el: HTMLElement): void {
    const S = this.plugin.settings;
    if (S.columns > 0) el.style.gridTemplateColumns = `repeat(${S.columns}, 1fr)`;
    else el.style.gridTemplateColumns = `repeat(auto-fill, minmax(${S.tileSize}px, 1fr))`;
  }

  async _render(force = false): Promise<void> {
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
      container.createDiv({ cls: "feuillets-empty", text: t("board.noProjectFolder") });
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
    let mode: string = meta.boardMode || modeConfig.defaults.boardMode;
    this.currentCardContent = meta.cardContent || modeConfig.defaults.cardContent;

    let initializedProjectPrefs = false;
    const hiddenModes: string[] = Array.isArray(meta.hiddenBoardModes)
      ? meta.hiddenBoardModes
      : Array.isArray(S.hiddenBoardModes) && differsFromDefaults(
        { hiddenBoardModes: S.hiddenBoardModes },
        { hiddenBoardModes: DEFAULT_SETTINGS.hiddenBoardModes }
      )
        ? [...S.hiddenBoardModes]
        : [...modeConfig.boardDefaults.hiddenBoardModes];
    if (!Array.isArray(meta.hiddenBoardModes)) {
      meta.hiddenBoardModes = hiddenModes;
      initializedProjectPrefs = true;
    }
    const outlineColumns: Record<string, boolean> = meta.outlineCols
      ? { ...meta.outlineCols }
      : differsFromDefaults(S.outlineCols, DEFAULT_SETTINGS.outlineCols)
        ? { ...S.outlineCols }
        : { ...modeConfig.boardDefaults.outlineCols };
    if (!meta.outlineCols) {
      meta.outlineCols = outlineColumns;
      initializedProjectPrefs = true;
    }
    this.outlineColumns = outlineColumns;
    if (initializedProjectPrefs && typeof this.plugin.saveSettings === "function") void this.plugin.saveSettings();
    const wholeManuscript = meta.boardWholeManuscript !== undefined ? !!meta.boardWholeManuscript : !!S.boardWholeManuscript;
    if (mode === "research") mode = "board";

    let visibleModes = BOARD_MODES.map(([k]) => k).filter((k) => !hiddenModes.includes(k));
    if (visibleModes.length === 0) visibleModes = BOARD_MODES.map(([k]) => k);
    if (!visibleModes.includes(mode)) mode = visibleModes[0];
    const activeMode = mode as BoardModeKey;

    /* Même Set que le Binder/Plan (this.plugin._binderMultiSelect) — un
       seul mécanisme de sélection multiple dans tout le plugin, pas deux
       en parallèle. Le mode sélection du panneau Cartes (cases à cocher,
       selectionModeActive) reste sa propre affordance UI ; seul le
       stockage est désormais partagé. */
    if (!this.plugin._binderMultiSelect) this.plugin._binderMultiSelect = new Set();
    if (this.selectionModeActive === undefined) this.selectionModeActive = false;

    const bar = container.createDiv({ cls: "feuillets-board-bar" }).createDiv({ cls: "feuillets-board-bar-right" });
    this.iconBtn(bar, this.filterActive() ? "filter" : "list-filter", t("board.filter.tooltip"), (e: MouseEvent) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t("binder.filter.statusHeader")).setDisabled(true));
      for (const st of ["Tous", ...getProjectStatuses(S).filter(Boolean), "Sans statut"]) {
        menu.addItem((item) =>
          item.setTitle(this.filterSentinelLabel(st)).setChecked((S.statusFilter || "Tous") === st).onClick(async () => {
            S.statusFilter = st;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.addSeparator();
      const labels = new Set<string>();
      const projectRoot = this.plugin.getProjectFolder();
      if (projectRoot) {
        const collect = (f: TFolder) => {
          for (const c of this.plugin.getOrderedChildren(f)) {
            if (c instanceof TFile) {
              for (const label of this.plugin.labelsOf(c)) labels.add(label);
            } else if (c instanceof TFolder) collect(c);
          }
        };
        collect(projectRoot);
      }
      const pMeta = projectRoot ? S.projectMeta[projectRoot.path] : null;
      (pMeta && pMeta.labels ? pMeta.labels : S.labels || []).forEach((l) => { if (l.name) labels.add(l.name); });
      const sortedLabels = Array.from(labels).sort((a, b) => a.localeCompare(b, "fr"));
      menu.addItem((item) => item.setTitle(t("binder.filter.labelHeader")).setDisabled(true));
      for (const lb of ["Tous", ...sortedLabels, "Sans label"]) {
        menu.addItem((item) =>
          item.setTitle(this.filterSentinelLabel(lb)).setChecked((S.labelFilter || "Tous") === lb).onClick(async () => {
            S.labelFilter = lb;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.addSeparator();
      const povs = new Set<string>();
      if (projectRoot) {
        const collectPov = (f: TFolder) => {
          for (const c of this.plugin.getOrderedChildren(f)) {
            if (c instanceof TFile) {
              const p = povOf(this.fm(c));
              if (p) povs.add(p);
            } else if (c instanceof TFolder) collectPov(c);
          }
        };
        collectPov(projectRoot);
      }
      const sortedPovs = Array.from(povs).sort((a, b) => a.localeCompare(b, "fr"));
      if (sortedPovs.length > 0) {
        menu.addItem((item) => item.setTitle(t("board.filter.povHeader")).setDisabled(true));
        for (const pv of ["Tous", ...sortedPovs, "Sans POV"]) {
          menu.addItem((item) =>
            item.setTitle(this.filterSentinelLabel(pv)).setChecked((S.povFilter || "Tous") === pv).onClick(async () => {
              S.povFilter = pv;
              await this.plugin.saveSettings();
              void this.render();
            })
          );
        }
        menu.addSeparator();
      }
      menu.addItem((item) => item.setTitle(t("binder.filter.progressHeader")).setDisabled(true));
      for (const pr of ["Tous", "Atteint", "En dessous", "Dépassé"]) {
        menu.addItem((item) =>
          item.setTitle(this.filterSentinelLabel(pr)).setChecked((S.progressFilter || "Tous") === pr).onClick(async () => {
            S.progressFilter = pr;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("board.filter.tagPrompt")).setIcon("tag").onClick(() => {
          new TagFilterModal(this.app, (S.tagFilter || "").replace(/^#/, ""), async (value) => {
            S.tagFilter = value;
            await this.plugin.saveSettings();
            void this.render();
          }).open();
        })
      );
      if (this.filterActive()) {
        menu.addSeparator();
        menu.addItem((item) =>
          item.setTitle(t("binder.filter.reset")).setIcon("filter-x").onClick(async () => {
            S.statusFilter = "Tous";
            S.labelFilter = "Tous";
            S.progressFilter = "Tous";
            S.povFilter = "Tous";
            S.tagFilter = "";
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.showAtMouseEvent(e);
    });

    this.barSep(bar);

    const switchMode = (m: string) => async () => {
      if (meta) meta.boardMode = m;
      S.boardMode = m;
      await this.plugin.saveSettings();
      void this.render();
    };

    const modeGroup = bar.createDiv({ cls: "feuillets-mode-group" });
    const icons: Record<string, string> = { board: "layout-grid", outline: "list-tree", arcs: "git-branch", timeline: "milestone", read: "book-open-text" };
    for (const [k] of BOARD_MODES) {
      if (!visibleModes.includes(k)) continue;
      const btn = this.iconBtn(modeGroup, icons[k], this.boardModeLabel(k), switchMode(k));
      if (activeMode === k) btn.addClass("feuillets-mode-active");
    }

    this.iconBtn(modeGroup, "sliders-horizontal", t("board.viewOptionsTooltip"), (e: MouseEvent) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t("board.visibleModesHeader")).setDisabled(true));
      for (const [k] of BOARD_MODES) {
        menu.addItem((item) =>
          item.setTitle(this.boardModeLabel(k)).setChecked(visibleModes.includes(k)).onClick(async () => {
            const set = new Set(hiddenModes);
            if (!set.has(k) && visibleModes.length === 1) return;
            if (set.has(k)) set.delete(k); else set.add(k);
            const arr = [...set];
            if (meta) meta.hiddenBoardModes = arr;
            S.hiddenBoardModes = arr;
            await this.plugin.saveSettings();
            void this.render(true);
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("board.selection.enable")).setIcon("list-checks").setChecked(!!this.selectionModeActive).onClick(() => {
          this.selectionModeActive = !this.selectionModeActive;
          if (!this.selectionModeActive) this.plugin._binderMultiSelect?.clear();
          void this.render(true);
        })
      );
      menu.addSeparator();
      this.buildModeOptionsMenu(menu, activeMode, { S, meta, pType: projectType, wholeManuscript, outlineColumns });
      menu.showAtMouseEvent(e);
    });

    this.barSep(bar);

    if (this.selectionModeActive && activeMode !== "arcs") {
      const multiSelect = this.plugin._binderMultiSelect;
      const selSize = multiSelect.size;
      const getSelectedFiles = (): TFile[] =>
        [...multiSelect].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
      const clearSel = () => {
        multiSelect.clear();
        this.selectionModeActive = false;
        void this.render(true);
      };
      const unitLabel = this.plugin.unitLabel();
      const unitPlural = this.plugin.unitLabelPlural();
      const btnSel = this.iconBtn(
        bar,
        "list-checks",
        this.selectionModeActive
          ? t("board.selection.actionsTooltip", { unit: unitLabel, count: String(selSize), s: selSize > 1 ? "s" : "" })
          : t("board.selection.selectTooltip", { unitPlural }),
        (e: MouseEvent) => {
          const menu = new Menu();
          if (!this.selectionModeActive) {
            menu.addItem((item) =>
              item.setTitle(t("board.selection.selectTooltip", { unitPlural })).setIcon("list-checks").onClick(() => {
                this.selectionModeActive = true;
                void this.render(true);
              })
            );
            menu.showAtMouseEvent(e);
            return;
          }
          menu.addItem((item) =>
            item.setTitle(t("board.selection.merge", { count: String(selSize) })).setIcon("git-merge").setDisabled(selSize < 2).onClick(() => {
              const files = getSelectedFiles();
              clearSel();
              if (files.length < 2) {
                new Notice(t("board.selection.mergeNeedsTwo", { unitPlural }));
                return;
              }
              void this.plugin.openMergeModal(files);
            })
          );
          menu.addItem((item) =>
            item.setTitle(t("board.selection.duplicate", { count: String(selSize) })).setIcon("copy").setDisabled(selSize < 1).onClick(async () => {
              const files = getSelectedFiles();
              clearSel();
              if (files.length > 0) await this.plugin.duplicateManyScenes(files);
            })
          );
          menu.addItem((item) =>
            item.setTitle(t("board.selection.move", { count: String(selSize) })).setIcon("move").setDisabled(selSize < 1).onClick(() => {
              const files = getSelectedFiles();
              clearSel();
              if (files.length > 0) this.plugin.openMoveManyModal(files);
            })
          );
          menu.addSeparator();

          for (const st of getProjectStatuses(this.plugin.settings).filter(Boolean)) {
            menu.addItem((item) =>
              item.setTitle(t("board.selection.statusCount", { status: st, count: String(selSize) })).setDisabled(selSize < 1).onClick(async () => {
                const files = getSelectedFiles();
                clearSel();
                await this.applyBulkStatus(files, st);
              })
            );
          }
          menu.addSeparator();

          for (const l of this.getProjectLabels()) {
            menu.addItem((item) =>
              item.setTitle(t("board.selection.labelCount", { label: l.name, count: String(selSize) })).setDisabled(selSize < 1).onClick(async () => {
                const files = getSelectedFiles();
                clearSel();
                await this.applyBulkLabel(files, l.name);
              })
            );
          }
          menu.addSeparator();

          menu.addItem((item) =>
            item.setTitle(t("board.selection.addTag", { count: String(selSize) })).setIcon("tag").setDisabled(selSize < 1).onClick(() => {
              const files = getSelectedFiles();
              clearSel();
              this.promptBulkTag(files, () => { void this.render(true); });
            })
          );
          menu.addSeparator();
          menu.addItem((item) => item.setTitle(t("board.selection.exit")).setIcon("x").onClick(clearSel));
          menu.showAtMouseEvent(e);
        }
      );
      if (this.selectionModeActive) btnSel.addClass("feuillets-mode-active");
    }

    if ((this.plugin.moveStack?.length || 0) > 0) {
      this.iconBtn(bar, "undo-2", t("board.undoMoveTooltip"), () => (this.app as unknown as AppWithCommands).commands.executeCommandById("feuillets:undo-move"));
    }

    const flattened = this.plugin.flattenFiles(root);
    const wcMapRaw = await this.plugin.getWordCounts(flattened);
    if (this._renderGen !== gen) return;

    this.wcMap = new Map();
    for (const file of flattened) {
      this.wcMap.set(file.path, wcMapRaw.get(file.path)?.wc || 0);
    }

    const bumpTotal = (_n?: number) => {};
    void this.plugin.wordCountOfFolder(root).then((wc: number) => {
      void this.plugin.updateDailyStats(wc);
    });

    if (this.filterActive()) {
      container.createDiv({ cls: "feuillets-filter-note", text: t("board.filterActiveNote") });
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
    }
  }

  buildModeOptionsMenu(menu: Menu, activeMode: BoardModeKey, ctx: ModeOptionsCtx & { outlineColumns: Record<string, boolean> }): void {
    const { S, meta, pType, wholeManuscript, outlineColumns } = ctx;
    const addToggleOption = (key: string, label: string) =>
      menu.addItem((item) =>
        item.setTitle(label).setChecked(!!S[key]).onClick(async () => {
          S[key] = !S[key];
          await this.plugin.saveSettings();
          void this.render();
        })
      );

    if (activeMode === "board") {
      menu.addItem((item) => item.setTitle(t("board.options.cardsHeader")).setDisabled(true));
      for (const [val, label] of [[false, t("board.options.folderByFolder")], [true, t("board.options.wholeManuscript")]] as [boolean, string][]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(wholeManuscript === val).onClick(async () => {
            if (meta) meta.boardWholeManuscript = val;
            S.boardWholeManuscript = val;
            await this.plugin.saveSettings();
            void this.render(true);
          })
        );
      }
      menu.addSeparator();
      addToggleOption("showProgress", t("binder.display.progressBars"));
      addToggleOption("showCardTags", t("board.options.tagsOnTiles"));
      menu.addSeparator();
      const contentOptions =
        pType === "nonfiction"
          ? [["extrait", t("board.options.bodyExcerpt")], ["summary", t("board.options.bodySummary")]]
          : [["extrait", t("board.options.bodyExcerpt")], ["synopsis", t("board.options.bodySynopsis")]];
      for (const [val, label] of contentOptions) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(this.currentCardContent === val).onClick(async () => {
            if (meta) meta.cardContent = val;
            S.cardContent = val;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.addSeparator();
      for (const [val, label] of [[180, t("board.options.tilesSmall")], [240, t("board.options.tilesMedium")], [320, t("board.options.tilesLarge")]] as [number, string][]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(S.tileSize === val).onClick(async () => {
            S.tileSize = val;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
    } else if (activeMode === "outline") {
      menu.addItem((item) => item.setTitle(t("board.options.outlineHeader")).setDisabled(true));
      addToggleOption("showProgress", t("binder.display.progressBars"));
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("board.options.resetColumnWidths")).onClick(async () => {
          S.outlineWidths = Object.assign({}, DEFAULT_SETTINGS.outlineWidths);
          await this.plugin.saveSettings();
          void this.render();
        })
      );
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("board.options.visibleColumnsHeader")).setDisabled(true));
      for (const [colKey, label] of [
        ["synopsis", t("board.col.synopsis")],
        ["summary", t("board.col.summary")],
        ["notes", t("board.col.notes")],
        ["tags", t("board.col.tags")],
        ["label", t("board.col.label")],
        ["status", t("board.col.status")],
        ["date", t("board.col.date")],
        ["compiler", t("board.col.compiler")],
        ["filename", t("board.col.filename")],
        ["words", t("board.col.words")],
        ["goal", t("board.col.goal")],
        ["progress", t("board.col.progress")],
      ]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(!!outlineColumns[colKey]).onClick(async () => {
            outlineColumns[colKey] = !outlineColumns[colKey];
            meta.outlineCols = outlineColumns;
            S.outlineCols = { ...outlineColumns };
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
    } else if (activeMode === "timeline") {
      menu.addItem((item) => item.setTitle(t("board.options.timelineHeader")).setDisabled(true));
      for (const [val, label] of [["chrono", t("board.options.chronoOrder")], ["narratif", t("board.options.narrativeOrder")]]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked(S.timelineOrder === val).onClick(async () => {
            S.timelineOrder = val;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("board.options.allMilestones")).setChecked(!S.timelineTagFilter).onClick(async () => {
          S.timelineTagFilter = "";
          await this.plugin.saveSettings();
          void this.render();
        })
      );
      const chronoFolder = this.plugin.getChronoFolder();
      if (chronoFolder instanceof TFolder) {
        const tags = new Set<string>();
        const collect = (f: TFolder) => {
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
              void this.render();
            })
          );
        }
      }
      menu.addSeparator();
      for (const [val, label] of [
        ["siecle", t("board.options.scaleCentury")],
        ["annee", t("board.options.scaleYear")],
        ["mois", t("board.options.scaleMonth")],
        ["jour", t("board.options.scaleDay")],
        ["aucune", t("board.options.scaleNone")],
      ]) {
        menu.addItem((item) =>
          item.setTitle(label).setChecked((S.timelineScale || "annee") === val).onClick(async () => {
            S.timelineScale = val;
            await this.plugin.saveSettings();
            void this.render();
          })
        );
      }
    }
  }

  makeGoalInput(parent: HTMLElement, file: TFile): HTMLInputElement {
    const fm = this.fm(file);
    const input = parent.createEl("input", {
      cls: "feuillets-goal-input",
      type: "number",
      attr: { min: "0", placeholder: String(this.plugin.settings.wordGoal) },
    });
    if (fm.goal !== undefined) input.value = toValue(fm.goal);
    input.addEventListener("change", () => {
      const val = parseInt(input.value, 10);
      void this.setFm(file, "goal", isNaN(val) ? "" : val);
    });
    return input;
  }

  makeTagsEditor(parent: HTMLElement, file: TFile): void {
    if (!this.plugin.settings.showTags) return;
    const wrap = parent.createDiv({ cls: "feuillets-tags" });
    const tags = this.plugin.tagsOf(file);
    for (const tag of tags) wrap.createSpan({ cls: "feuillets-tag-chip", text: `#${tag}` });
    const input = wrap.createEl("input", {
      cls: "feuillets-tags-input",
      type: "text",
      attr: { placeholder: tags.length ? "+" : t("shared.tags.placeholder") },
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const val = input.value.trim();
      if (!val) return;
      const added = val.split(/[,\s]+/).map((s) => s.replace(/^#/, "").trim()).filter(Boolean);
      const merged = [...new Set([...tags, ...added])];
      void (async () => {
        await this.setFm(file, "tags", merged);
        input.value = "";
        input.blur();
      })();
    });
    wrap.querySelectorAll(".feuillets-tag-chip").forEach((chip, idx) => {
      chip.setAttr("title", t("shared.tags.removeTooltip"));
      chip.addEventListener("click", () => {
        const next = tags.filter((_: string, i: number) => i !== idx);
        void this.setFm(file, "tags", next);
      });
    });
  }

  renderBreadcrumbs(container: HTMLElement, root: TFolder, currentFolder: TFolder): void {
    const chain: TFolder[] = [];
    let cur: TFolder | null = currentFolder;
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
        .createSpan({ cls: "feuillets-breadcrumb-link" + (isLast ? " is-active" : ""), text: f.path === root.path ? t("board.projectBreadcrumb") : f.name })
        .addEventListener("click", () => {
          this.focusedFolderPath = f.path;
          void this.render(true);
        });
    });
  }

  renderBoard(container: HTMLElement, root: TFolder, currentFolder: TFolder, numbering: Map<string, string>, bumpTotal: (n?: number) => void): void {
    const children = this.plugin.getOrderedChildren(currentFolder).filter((c: ProjectNode) => !this.plugin.isFrontMatter(c));
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

  renderBoardWholeManuscript(container: HTMLElement, root: TFolder, numbering: Map<string, string>, bumpTotal: (n?: number) => void): void {
    const S = this.plugin.settings;
    const walk = (folder: TFolder, depth: number) => {
      const children = this.plugin.getOrderedChildren(folder).filter((c: ProjectNode) => !this.plugin.isFrontMatter(c));
      let activeGrid: HTMLElement | null = null;
      for (let i = 0; i < children.length; i++) {
        const item = children[i];
        if (item instanceof TFolder) {
          activeGrid = null;
          const sec = container.createDiv({ cls: "feuillets-board-whole-section" });
          sec.style.marginLeft = `${depth * 16}px`;

          /* En-tête construit ici plutôt qu'avec le renderSectionHead
             partagé (Notes/Propriétés/Projet…) : on a besoin que toute la
             ligne serve de poignée de glisser-déposer, comme les cartes de
             scène juste en dessous (renderCard) — une petite poignée dédiée
             de quelques pixels s'est révélée peu fiable/découvrable. */
          const collapseKey = `board:whole:${item.path}`;
          const isCollapsed = !!S.collapsed[collapseKey];
          const head = sec.createDiv({ cls: "feuillets-section-head" });
          const titleEl = head.createDiv({ cls: "feuillets-section-title" });
          titleEl.createSpan({ cls: "feuillets-chevron" }).setText(isCollapsed ? "▸" : "▾");
          const iconEl = titleEl.createSpan({ cls: "feuillets-section-icon" });
          setIcon(iconEl, "folder");
          titleEl.createSpan({ cls: "feuillets-section-title-text" }).setText(item.name);
          titleEl.addEventListener("click", () => {
            void (async () => {
              if (isCollapsed) delete S.collapsed[collapseKey];
              else S.collapsed[collapseKey] = true;
              await this.plugin.saveSettings();
              void this.render(true);
            })();
          });
          if (!this.filterActive()) this.attachDragHandlers(head, sec, folder, i, children, container);

          if (!isCollapsed) walk(item, depth + 1);
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

  makeClickToEditFmArea(parent: HTMLElement, file: TFile, key: string, placeholder: string, maxLines = 6): HTMLElement {
    const fm = this.fm(file);
    const val = toValue(fm[key]);
    const cell = parent.createDiv({ cls: "feuillets-flat-text-cell" + (val ? "" : " is-empty"), text: val || placeholder });
    if (maxLines) {
      cell.style.setProperty("--max-lines", String(maxLines));
      cell.addClass("feuillets-clamp-text");
    }
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      cell.hide();
      const area = parent.createEl("textarea", { cls: "feuillets-flat-textarea feuillets-autosize" });
      area.value = toValue(fm[key]);
      area.focus();
      area.style.removeProperty("height");
      area.style.height = `${area.scrollHeight}px`;
      const save = async () => {
        if (area.parentNode) {
          const raw = area.value.trim();
          if (raw !== toValue(fm[key])) {
            await this.setFm(file, key, raw);
            cell.setText(raw || placeholder);
            if (raw) cell.removeClass("is-empty"); else cell.addClass("is-empty");
          }
          area.remove();
          cell.show();
        }
      };
      area.addEventListener("blur", () => { void save(); });
      area.addEventListener("keydown", (evt) => {
        if (evt.key === "Escape" || (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey))) area.blur();
      });
    });
    return cell;
  }

  renderFolderCard(container: HTMLElement, parentFolder: TFolder, folder: TFolder, index: number, siblings: ProjectNode[], _numbering: unknown, _bumpTotal: unknown): void {
    const S = this.plugin.settings;
    const card = container.createDiv({ cls: "feuillets-card feuillets-card-folder" });
    card.setAttr("title", t("board.folderCard.doubleClickEnter", { name: folder.name }));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showFolderContextMenu(e, folder, parentFolder, index, siblings);
    });
    card.addEventListener("dblclick", () => {
      this.focusedFolderPath = folder.path;
      void this.render(true);
    });

    const folderNote = this.plugin.folderNoteFor(folder);
    const label = folderNote ? this.plugin.labelOf(folderNote) : null;
    const color = label ? this.plugin.labelColor(label) : null;
    if (color) card.style.borderTop = `3px solid ${color}`;

    const head = card.createDiv({ cls: "feuillets-card-head" });
    const icon = head.createDiv({ cls: "feuillets-card-icon" });
    setIcon(icon, "folder");
    /* `style` n'est pas une clé reconnue de DomElementInfo (cls/text/attr/
       title seulement) : Obsidian l'ignore silencieusement à l'exécution,
       ce bloc n'a donc jamais réellement appliqué ce style inline — état
       préexistant à cette migration, reproduit tel quel. */
    const num = head.createDiv({
      cls: "feuillets-card-num",
      attr: { style: "font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 90px; cursor: pointer;" },
    });
    num.setText(folder.name);
    num.setAttr("title", t("board.folderCard.clickToEnter"));
    num.addEventListener("click", (e) => {
      e.stopPropagation();
      this.focusedFolderPath = folder.path;
      void this.render(true);
    });

    const wcEl = head.createDiv({ cls: "feuillets-card-wc" });
    const ring = head.createDiv({ cls: "feuillets-ring" });
    if (!S.showProgress) ring.hide();

    const totalWc = this.plugin.flattenFiles(folder).reduce((acc: number, f: TFile) => acc + (this.wcMap!.get(f.path) || 0), 0);
    const goal = this.plugin.folderGoal(folder);
    wcEl.setText(goal > 0 ? `${totalWc} / ${goal}` : String(totalWc));
    if (S.showProgress) this.fillRing(ring, totalWc, goal);

    const fieldKey = this.currentCardContent === "synopsis" ? "synopsis" : "summary";
    const summary = toValue(folderNote && this.plugin.fmOf(folderNote)[fieldKey]);
    const excerpt = card.createDiv({ cls: "feuillets-card-excerpt" });
    excerpt.addClass("feuillets-mt-sm");
    excerpt.setText(summary || (fieldKey === "synopsis" ? t("board.folderCard.synopsisPlaceholder") : t("board.folderCard.summaryPlaceholder")));

    if (!this.filterActive()) this.attachDragHandlers(head, card, parentFolder, index, siblings, container);
  }

  renderCard(container: HTMLElement, parentFolder: TFolder, file: TFile, index: number, siblings: ProjectNode[], numbering: Map<string, string>, bumpTotal: (n?: number) => void): void {
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
      cb.checked = this.plugin._binderMultiSelect!.has(file.path);
      cb.setAttr("title", t("board.card.selectThisUnit", { unit: this.plugin.unitLabel() }));
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) this.plugin._binderMultiSelect!.add(file.path);
        else this.plugin._binderMultiSelect!.delete(file.path);
        void this.render(true);
      });
    }

    const icon = head.createDiv({ cls: "feuillets-card-icon" });
    setIcon(icon, "file-text");
    head.createDiv({ cls: "feuillets-card-num" }).setText(String(numbering.get(file.path)));
    const titleEl = head.createDiv({ cls: "feuillets-card-title" });
    titleEl.setText(this.plugin.shortTitleFor(file));
    titleEl.setAttr("title", file.basename);

    const pov = povOf(this.fm(file));
    if (pov) {
      const povEl = head.createDiv({ cls: "feuillets-card-pov" });
      povEl.setText(pov);
      povEl.setAttr("title", t("board.card.povTooltip", { pov }));
    }

    const more = head.createDiv({ cls: "feuillets-card-more clickable-icon" });
    setIcon(more, "more-horizontal");
    more.setAttr("title", t("board.card.moreTooltip"));
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = new Menu();
      const currentSt = toValue(this.fm(file).status);
      const S = this.plugin.settings;
      for (const st of getProjectStatuses(S).filter(Boolean)) {
        menu.addItem((item) =>
          item.setTitle(t("shared.contextMenu.statusLabel", { status: st })).setChecked(st === currentSt).onClick(async () => {
            await this.setFm(file, "statut", st === currentSt ? "" : st);
          })
        );
      }
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("shared.contextMenu.editTags")).onClick(() => {
          new TagsModal(this.app, this.plugin, file).open();
        })
      );
      menu.addItem((item) =>
        item.setTitle(t("shared.contextMenu.editSummary")).onClick(() => {
          new FmFieldModal(this.app, this.plugin, file, "summary", t("board.card.longSummaryLabel"), () => { void this.render(true); }).open();
        })
      );
      menu.addItem((item) =>
        item.setTitle(t("board.card.editPov")).onClick(() => {
          new FmFieldModal(this.app, this.plugin, file, "pov", t("board.card.povFieldLabel"), () => { void this.render(true); }).open();
        })
      );
      menu.addItem((item) =>
        item.setTitle(t("shared.research.openFile")).onClick(() => {
          openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
        })
      );

      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("shared.contextMenu.compareWithSnapshot")).setIcon("history").onClick(async () => {
          const projectRoot = this.plugin.getProjectFolder();
          const snapshots = listSnapshotFiles(this.app, file, projectRoot);

          if (snapshots.length === 0) {
            new Notice(t("shared.contextMenu.noSnapshotFound", { name: file.basename }));
            return;
          }

          await openSnapshotComparison(this.app, this.plugin, file, snapshots[0]);
        })
      );

      menu.showAtMouseEvent(e);
    });

    const wcEl = head.createDiv({ cls: "feuillets-card-wc" });
    const ring = head.createDiv({ cls: "feuillets-ring" });
    if (!S.showProgress) ring.hide();

    if (this.currentCardContent === "synopsis") {
      this.makeClickToEditFmArea(card, file, "synopsis", t("board.card.synopsisPlaceholder"), 6);
    } else if (this.currentCardContent === "summary") {
      this.makeClickToEditFmArea(card, file, "summary", t("board.card.summaryPlaceholder"), 6);
    } else {
      const excerpt = card.createDiv({ cls: "feuillets-card-excerpt", text: "…" });
      excerpt.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });
      void this.app.vault.cachedRead(file).then((raw) => {
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
        /* On tranche un peu large AVANT de nettoyer la syntaxe (le nettoyage
           raccourcit le texte) puis on recoupe à la longueur voulue —
           inutile de dépouiller tout le corps du feuillet pour un aperçu. */
        const limit = Number(S.excerptLength) || 420;
        const clean = stripMarkdown(body.slice(0, limit + 200)).slice(0, limit);
        excerpt.setText(clean || t("binder.item.emptyPreview"));
      });
    }

    if (S.showCardTags) this.makeTagsEditor(card, file);

    const wc = this.wcMap!.get(file.path) || 0;
    bumpTotal(wc);
    wcEl.setText(String(wc));
    if (S.showProgress) this.fillRing(ring, wc, goal);

    if (!this.filterActive()) this.attachDragHandlers(head, card, parentFolder, index, siblings, container);
  }

  renderCheminDeFer(container: HTMLElement, root: TFolder, numbering: Map<string, string>): void {
    type ChdfItem = { type: "folder"; folder: TFolder; role: string } | { type: "file"; file: TFile };
    const items: ChdfItem[] = [];
    const collect = (folder: TFolder) => {
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

    const fileItems = items.filter((i): i is { type: "file"; file: TFile } => i.type === "file");
    const labelsSet = new Set<string>();
    const labelMap = new Map<string, string[]>();
    const filsMap = new Map<string, string[]>();
    const personnagesSet = new Set<string>();
    const personnagesMap = new Map<string, string[]>();
    const povSet = new Set<string>();
    const povMap = new Map<string, string>();

    for (const item of fileItems) {
      const lbs = this.plugin.labelsOf(item.file);
      labelMap.set(item.file.path, lbs);
      for (const l of lbs) labelsSet.add(l);
      const fm = this.fm(item.file);
      filsMap.set(item.file.path, getFilsList(fm));
      const persos = getPersonnagesList(fm);
      personnagesMap.set(item.file.path, persos);
      for (const p of persos) personnagesSet.add(p);
      const pv = povOf(fm);
      povMap.set(item.file.path, pv);
      if (pv) povSet.add(pv);
    }

    const sortedLabels = Array.from(labelsSet).sort((a, b) => a.localeCompare(b, "fr"));
    const filsSet = new Set<string>();
    for (const arr of filsMap.values()) for (const f of arr) filsSet.add(f);
    const sortedFils = Array.from(filsSet).sort((a, b) => a.localeCompare(b, "fr"));
    const sortedPersonnages = Array.from(personnagesSet).sort((a, b) => a.localeCompare(b, "fr"));
    const sortedPovs = Array.from(povSet).sort((a, b) => a.localeCompare(b, "fr"));

    const wrap = container.createDiv({ cls: "feuillets-notes-container" });
    if (sortedLabels.length === 0 && sortedFils.length === 0 && sortedPovs.length === 0) {
      wrap.createDiv({
        cls: "feuillets-empty",
        text: t("board.arcs.empty"),
      });
      return;
    }

    const filterBar = wrap.createDiv({ cls: "feuillets-arcs-filter-bar" });

    const buildFilterMenuBtn = (icon: string, name: string, options: string[], currentValue: string | undefined, onSelect: (v: string) => void) => {
      const btn = filterBar.createEl("button", { cls: "clickable-icon feuillets-arcs-filter-btn" });
      setIcon(btn.createSpan(), icon);
      btn.createSpan({ cls: "feuillets-arcs-filter-btn-label", text: currentValue || name });
      setTooltip(btn, currentValue ? `${name} : ${currentValue}` : t("board.arcs.filterByTooltip", { name: name.toLowerCase() }));
      if (currentValue) btn.addClass("is-active");
      btn.addEventListener("click", (e) => {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle(t("binder.filter.all")).setChecked(!currentValue).onClick(() => {
          onSelect("");
          void this.render(true);
        }));
        menu.addSeparator();
        for (const opt of options) {
          menu.addItem((item) =>
            item.setTitle(opt).setChecked(currentValue === opt).onClick(() => {
              onSelect(opt);
              void this.render(true);
            })
          );
        }
        menu.showAtMouseEvent(e);
      });
      return btn;
    };

    if (sortedLabels.length > 0) {
      buildFilterMenuBtn("map-pin", t("board.arcs.labelFilterName"), sortedLabels, this.selectedLabel, (v) => { this.selectedLabel = v; });
    }
    if (sortedPersonnages.length > 0) {
      buildFilterMenuBtn("users", t("board.arcs.characterFilterName"), sortedPersonnages, this.selectedPerso, (v) => { this.selectedPerso = v; });
    }
    if (sortedFils.length > 0) {
      buildFilterMenuBtn("route", t("board.arcs.threadFilterName"), sortedFils, this.selectedFil, (v) => { this.selectedFil = v; });
    }
    if (sortedPovs.length > 0) {
      buildFilterMenuBtn("eye", t("board.arcs.povFilterName"), sortedPovs, this.selectedPov, (v) => { this.selectedPov = v; });
    }

    const filterLabel = this.selectedLabel || "";
    const filterFil = this.selectedFil || "";
    const filterPerso = this.selectedPerso || "";
    const filterPov = this.selectedPov || "";

    const activeLabels = filterLabel ? [filterLabel] : sortedLabels;
    const activeFils = filterFil ? [filterFil] : sortedFils;
    const matchedSet = (filterLabel || filterFil || filterPerso || filterPov)
      ? new Set(fileItems.filter((i) => {
          const path = i.file.path;
          if (filterLabel && !(labelMap.get(path) || []).includes(filterLabel)) return false;
          if (filterFil && !(filsMap.get(path) || []).includes(filterFil)) return false;
          if (filterPerso && !(personnagesMap.get(path) || []).includes(filterPerso)) return false;
          if (filterPov && povMap.get(path) !== filterPov) return false;
          return true;
        }).map((i) => i.file.path))
      : null;

    // Étendue (première → dernière apparition) de chaque lieu/fil parmi les scènes
    // effectivement affichées, pour tracer une ligne de continuité entre les points.
    const renderedPaths = items
      .filter((i): i is { type: "file"; file: TFile } => i.type === "file" && (!matchedSet || matchedSet.has(i.file.path)))
      .map((i) => i.file.path);

    const labelFirst: Record<string, number> = {}, labelLast: Record<string, number> = {};
    activeLabels.forEach((lb) => { labelFirst[lb] = -1; labelLast[lb] = -1; });
    const filFirst: Record<string, number> = {}, filLast: Record<string, number> = {};
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
      row.addClass("feuillets-clickable");

      // Lieux (label:) à gauche en ronds
      const rails = row.createDiv({ cls: "feuillets-arcs-row-rails" });
      rails.style.width = `${activeLabels.length * 16}px`;
      const currentLabels = labelMap.get(file.path) || [];

      activeLabels.forEach((lb) => {
        const col = rails.createDiv({ cls: "feuillets-arcs-col" });
        setTooltip(col, lb);
        col.setAttr("title", lb);
        const color = this.plugin.labelColor(lb) || "";
        col.style.setProperty("--arc-color", color);
        const hasLabel = currentLabels.includes(lb);
        if (labelFirst[lb] !== -1 && idx >= labelFirst[lb] && idx <= labelLast[lb]) {
          const line = col.createDiv({ cls: "feuillets-arcs-line" });
          line.style.backgroundColor = color;
          if (!hasLabel) line.addClass("feuillets-dim");
        }
        if (hasLabel) {
          const dot = col.createDiv({ cls: "feuillets-arcs-dot" });
          dot.style.backgroundColor = color;
        }
      });

      const info = row.createDiv({ cls: "feuillets-arcs-info" });
      const titleRow = info.createDiv({ cls: "feuillets-arcs-title-row" }).createDiv({ cls: "feuillets-arcs-title-left" });
      if (numbering) titleRow.createSpan({ cls: "feuillets-row-num", text: numbering.get(file.path) || "" });
      if (fm.status) {
        const dot = titleRow.createSpan({ cls: "feuillets-status-dot" });
        dot.style.background = this.plugin.getStatusColor(toValue(fm.status)) || "var(--text-faint)";
      }
      titleRow.createDiv({ cls: "feuillets-arcs-file-title", text: this.plugin.shortTitleFor(file) });

      if (fm.synopsis) info.createDiv({ cls: "feuillets-arcs-file-synopsis", text: String(fm.synopsis) });

      const currentPov = povMap.get(file.path) || "";
      if (currentPov) {
        info.createDiv({ cls: "feuillets-arcs-personnages", text: t("board.arcs.povLine", { pov: currentPov }) });
      }

      const currentPersonnages = personnagesMap.get(file.path) || [];
      if (currentPersonnages.length > 0) {
        info.createDiv({ cls: "feuillets-arcs-personnages", text: t("board.arcs.withCharacters", { names: currentPersonnages.join(", ") }) });
      }

      // Fils (fil:) à droite en carrés
      const filRails = row.createDiv({ cls: "feuillets-arcs-row-rails" });
      filRails.style.width = `${activeFils.length * 16}px`;
      const currentFils = filsMap.get(file.path) || [];

      activeFils.forEach((f) => {
        const col = filRails.createDiv({ cls: "feuillets-arcs-col" });
        setTooltip(col, f);
        col.setAttr("title", f);
        const color = filColor(f);
        col.style.setProperty("--arc-color", color);
        const hasFil = currentFils.includes(f);
        if (filFirst[f] !== -1 && idx >= filFirst[f] && idx <= filLast[f]) {
          const line = col.createDiv({ cls: "feuillets-arcs-line" });
          line.style.backgroundColor = color;
          if (!hasFil) line.addClass("feuillets-dim");
        }
        if (hasFil) {
          const dot = col.createDiv({ cls: "feuillets-arcs-dot feuillets-arcs-dot-fil" });
          dot.style.backgroundColor = color;
        }
      });

      row.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
      });
    }
  }

  renderTimeline(container: HTMLElement, folder: TFolder, numbering: Map<string, string>): void {
    return this.renderTimelineInner(container, folder, numbering);
  }

  renderTimelineInner(container: HTMLElement, folder: TFolder, _numbering: unknown): void {
    const files = this.plugin.flattenFiles(folder).filter((f: TFile) => this.passesFilter(f) && !this.plugin.isFrontMatter(f));
    type TimelineItem = { file: TFile; milestone?: boolean; sort: number; y: number; mo: number; d: number; display: string };
    const items: TimelineItem[] = [];
    for (const file of files) {
      const dateObj = parseStoryDate(this.fm(file).date, file);
      if (dateObj) items.push({ file, ...dateObj });
    }

    const chronoFolder = this.plugin.getChronoFolder();
    if (chronoFolder instanceof TFolder) {
      const collect = (f: TFolder) => {
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
      const fileOrder = new Map(files.map((f: TFile, i: number) => [f.path, i]));
      items.sort((a, b) => (fileOrder.get(a.file.path) ?? 999) - (fileOrder.get(b.file.path) ?? 999));
    } else {
      items.sort((a, b) => a.sort - b.sort);
    }

    if (items.length === 0) {
      container.createDiv({ cls: "feuillets-empty", text: t("board.timeline.empty") });
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
      if (this.fm(item.file).synopsis) body.createDiv({ cls: "feuillets-timeline-syn", text: String(this.fm(item.file).synopsis) });
    }
  }

  visibleCols(): { id: string; label: string }[] {
    const cols = this.outlineColumns || this.plugin.settings.outlineCols;
    const res = [{ id: "title", label: t("board.col.title") }];
    if (cols.synopsis) res.push({ id: "synopsis", label: t("board.col.synopsis") });
    if (cols.summary) res.push({ id: "summary", label: t("board.col.summary") });
    if (cols.notes) res.push({ id: "notes", label: t("board.col.notes") });
    if (cols.tags) res.push({ id: "tags", label: t("board.col.tags") });
    if (cols.label) res.push({ id: "label", label: t("board.col.label") });
    if (cols.status) res.push({ id: "status", label: t("board.col.status") });
    if (cols.date) res.push({ id: "date", label: t("board.col.date") });
    if (cols.compile) res.push({ id: "compile", label: t("board.col.compiler") });
    if (cols.filename) res.push({ id: "filename", label: t("board.col.filename") });
    if (cols.words) res.push({ id: "words", label: t("board.col.words") });
    if (cols.goal) res.push({ id: "goal", label: t("board.col.goal") });
    if (cols.progress) res.push({ id: "progress", label: t("board.col.progress") });
    return res;
  }

  colsTemplate(overrideWidths?: Record<string, number>): string {
    const widths = overrideWidths || this.plugin.settings.outlineWidths;
    return "22px " + this.visibleCols().map((c) => `${Math.max(60, widths[c.id] || 120)}px`).join(" ");
  }

  async renderOutline(container: HTMLElement, root: TFolder, numbering: Map<string, string>, bumpTotal: (n?: number) => void, gen: number): Promise<void> {
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
  attachColumnResize(resizer: HTMLElement, colId: string, outline: HTMLElement): void {
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
      document.body.addClass("feuillets-col-resizing");

      const onMouseMove = (moveEvent: MouseEvent) => {
        liveWidth = Math.max(60, startWidth + (moveEvent.clientX - startX));
        outline.style.setProperty(
          "--feuillets-cols",
          this.colsTemplate({ ...widths, [colId]: liveWidth })
        );
      };
      const onMouseUpAsync = async () => {
        resizer.removeClass("is-resizing");
        document.body.removeClass("feuillets-col-resizing");
        widths[colId] = liveWidth;
        await this.plugin.saveSettings();
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        void onMouseUpAsync();
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  emptyCells(row: HTMLElement, cols: { id: string; label: string }[], handlers?: Record<string, (cell: HTMLElement) => void>): void {
    for (const c of cols) {
      if (handlers && handlers[c.id]) {
        handlers[c.id](row.createDiv({ cls: `feuillets-cell feuillets-cell-${c.id}` }));
      } else if (c.id !== "title") {
        row.createDiv({ cls: `feuillets-cell feuillets-cell-${c.id}` });
      }
    }
  }

  async renderOutlineLevel(table: HTMLElement, parentFolder: TFolder, depth: number, numbering: Map<string, string>, bumpTotal: (n?: number) => void, cols: { id: string; label: string }[], progress: { count: number }, gen: number): Promise<void> {
    const S = this.plugin.settings;
    const children = this.plugin.getOrderedChildren(parentFolder).filter((c: ProjectNode) => !this.plugin.isFrontMatter(c));
    for (let i = 0; i < children.length; i++) {
      if (this._renderGen !== gen) return;
      const child = children[i];
      if (child instanceof TFolder) {
        /* Même clé que le repli du Binder (S.collapsed[folder.path]) — un
           dossier replié dans un panneau reste replié dans l'autre. */
        const isCollapsed = !!S.collapsed[child.path];
        const row = table.createDiv({ cls: "feuillets-row feuillets-row-folder" });
        const handle = row.createDiv({ cls: "feuillets-col-handle", text: "⋮⋮" });
        const titleCell = row.createDiv({ cls: "feuillets-cell feuillets-cell-title" });
        titleCell.style.paddingLeft = `${depth * 16}px`;
        titleCell.addClass("feuillets-clickable");
        titleCell.createSpan({ cls: "feuillets-chevron" }).setText(isCollapsed ? "▸" : "▾");
        titleCell.createSpan({ cls: "feuillets-folder-name", text: child.name });
        titleCell.addEventListener("click", () => {
          void (async () => {
            if (isCollapsed) delete S.collapsed[child.path];
            else S.collapsed[child.path] = true;
            await this.plugin.saveSettings();
            void this.render(true);
          })();
        });
        /* Sans ça, une ligne de dossier n'avait aucun écouteur de
           glisser-déposer (seules les scènes en avaient, plus bas) : les
           dossiers étaient donc impossibles à réorganiser dans la vue
           Plan. */
        this.attachDragHandlers(handle, row, parentFolder, i, children, table);

        if (!isCollapsed) {
          await this.renderOutlineLevel(table, child, depth + 1, numbering, bumpTotal, cols, progress, gen);
        }
        continue;
      }

      if (!this.passesFilter(child)) continue;
      const row = table.createDiv({ cls: "feuillets-row feuillets-row-scene" });
      row.setAttr("data-path", child.path);
      if (this.plugin._binderMultiSelect && this.plugin._binderMultiSelect.has(child.path)) {
        row.addClass("feuillets-multiselected");
      }

      const handle = row.createDiv({ cls: "feuillets-col-handle", text: "⋮⋮" });
      this.attachDragHandlers(handle, row, parentFolder, i, children, table);
      const titleCell = row.createDiv({ cls: "feuillets-cell feuillets-cell-title" });
      titleCell.style.paddingLeft = `${depth * 16}px`;
      titleCell.createSpan({ cls: "feuillets-title-text", text: this.plugin.shortTitleFor(child) }).addEventListener("click", (e) => {
        if (this.handleMultiSelectClick(e, child, parentFolder, i, children, table)) return;
        openFileActivating(this.app, this.app.workspace.getLeaf(false), child);
      });

      const wc = this.wcMap!.get(child.path) || 0;
      bumpTotal(wc);

      this.emptyCells(row, cols, {
        synopsis: (cell) => this.makeClickToEditFmArea(cell, child, "synopsis", t("board.card.synopsisPlaceholder"), 1),
        summary: (cell) => this.makeClickToEditFmArea(cell, child, "summary", t("board.card.summaryPlaceholder"), 1),
        notes: (cell) => this.makeClickToEditFmArea(cell, child, "notes", t("board.outline.notesPlaceholder"), 1),
        tags: (cell) => this.makeTagsEditor(cell, child),
        label: (cell) => this.makeLabelSelect(cell, child),
        status: (cell) => this.makeStatusSelect(cell, child),
        date: (cell) => cell.setText(String(this.fm(child).date || "—")),
        compile: (cell) => cell.setText(this.fm(child).compile !== false ? t("shared.yes") : t("shared.no")),
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

}
