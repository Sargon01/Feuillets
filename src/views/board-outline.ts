import { TFile, TFolder } from "obsidian";
import { parseStoryDate } from "../utils/core.js";
import { t } from "../i18n/index.js";
import { toValue } from "../utils/scene-fields.js";
import { filsOf, povOf } from "../utils/arc-fields.js";

export type OutlineColumnKey =
  | "title" | "synopsis" | "pov" | "characters" | "thread" | "summary"
  | "label" | "status" | "tags" | "date" | "words" | "goal";

export const OUTLINE_DEFAULT_WIDTH = 120;
export const OUTLINE_HANDLE_WIDTH = 22;

type OutlineNode = TFile | TFolder;
type OutlineColumn = { id: OutlineColumnKey; label: string };
type OutlineFileEntry = {
  file: TFile;
  parentFolder: TFolder;
  binderIndex: number;
  siblings: OutlineNode[];
  binderFlatIndex: number;
};

export type OutlineRenderContext = {
  settings: Pick<FeuilletsSettings, "outlineWidths" | "outlineCols" | "collapsed"> & { outlineWrapLongText?: boolean };
  outlineColumns: Record<string, boolean>;
  outlineSortColumn: string | null;
  outlineSortDirection: "asc" | "desc" | null;
  outlineDblClickDelayMs: number;
  numbering: Map<string, string>;
  wcMap: Map<string, number>;
  generation: number;
  isCurrentGeneration: (generation: number) => boolean;
  getOrderedChildren: (folder: TFolder) => OutlineNode[];
  isFrontMatter: (node: OutlineNode) => boolean;
  passesFilter: (file: TFile) => boolean;
  fm: (file: TFile) => SceneFrontmatter;
  shortTitleFor: (file: TFile) => string;
  labelOf: (file: TFile) => string;
  tagsOf: (file: TFile) => string[];
  saveSettings: () => Promise<void>;
  rerender: () => void;
  onFocusFolder: (folder: TFolder) => void | Promise<void>;
  cycleSort: (column: string) => void;
  attachColumnResize: (resizer: HTMLElement, column: string, outline: HTMLElement) => void;
  isMultiSelected: (file: TFile) => boolean;
  isEditableContextTarget: (event: MouseEvent) => boolean;
  showFileContextMenu: (event: MouseEvent, file: TFile, parent: TFolder, index: number, siblings: OutlineNode[]) => void;
  showFolderContextMenu: (event: MouseEvent, folder: TFolder, parent: TFolder, index: number, siblings: OutlineNode[]) => void;
  attachDragHandlers: (handle: HTMLElement, row: HTMLElement, parent: TFolder, index: number, siblings: OutlineNode[], table: HTMLElement) => void;
  handleMultiSelectClick: (event: MouseEvent, file: TFile, parent: TFolder, index: number, siblings: OutlineNode[], table: HTMLElement) => boolean;
  beginInlineShortTitleEdit: (cell: HTMLElement, title: HTMLElement, file: TFile) => void;
  openFile: (file: TFile) => void;
  makeClickToEditFmArea: (parent: HTMLElement, file: TFile, key: string, placeholder: string, maxLines?: number) => HTMLElement;
  makeClickToEditFmList: (parent: HTMLElement, file: TFile, key: string, values: string[], rerender: () => void) => HTMLElement;
  makeTagsEditor: (parent: HTMLElement, file: TFile) => void;
  makeLabelSelect: (parent: HTMLElement, file: TFile) => void;
  makeStatusSelect: (parent: HTMLElement, file: TFile) => void;
  makeGoalInput: (parent: HTMLElement, file: TFile) => HTMLInputElement;
  fillRing: (parent: HTMLElement, words: number, goal: number) => void;
};

function visibleColumns(ctx: OutlineRenderContext): OutlineColumn[] {
  const cols = ctx.outlineColumns || ctx.settings.outlineCols;
  const result: OutlineColumn[] = [{ id: "title", label: t("board.col.title") }];
  const labels: [OutlineColumnKey, string][] = [
    ["synopsis", t("board.col.synopsis")], ["pov", t("board.col.pov")],
    ["characters", t("board.col.characters")], ["thread", t("board.col.thread")],
    ["summary", t("board.col.summary")], ["label", t("board.col.label")],
    ["status", t("board.col.status")], ["tags", t("board.col.tags")],
    ["date", t("board.col.date")], ["words", t("board.col.words")],
    ["goal", t("board.col.goal")],
  ];
  for (const [id, label] of labels) if (cols[id]) result.push({ id, label });
  return result;
}

function columnsTemplate(ctx: OutlineRenderContext, override?: Record<string, number>): string {
  const widths = override || ctx.settings.outlineWidths;
  return `${OUTLINE_HANDLE_WIDTH}px ` + visibleColumns(ctx)
    .map((column) => `${Math.max(60, widths[column.id] || OUTLINE_DEFAULT_WIDTH)}px`).join(" ");
}

function charactersOf(fm: Record<string, unknown>): string[] {
  const value = fm.characters;
  if (Array.isArray(value)) return value.filter(Boolean).map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function sortValue(ctx: OutlineRenderContext, file: TFile, column: string): string | number {
  const frontmatter = ctx.fm(file);
  switch (column) {
    case "title": return ctx.shortTitleFor(file);
    case "synopsis": return toValue(frontmatter.synopsis);
    case "summary": return toValue(frontmatter.summary);
    case "pov": return povOf(frontmatter);
    case "characters": return charactersOf(frontmatter).join(", ");
    case "thread": return filsOf(frontmatter).join(", ");
    case "label": return ctx.labelOf(file);
    case "status": return String(toValue(frontmatter.status) || "");
    case "tags": return ctx.tagsOf(file).join(", ");
    case "date": return parseStoryDate(frontmatter.date)?.sort ?? "";
    case "words": return ctx.wcMap.get(file.path) || 0;
    case "goal": {
      const raw = frontmatter.goal;
      if (raw === undefined || raw === null || raw === "") return "";
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0 ? value : "";
    }
    default: return "";
  }
}

function compareValues(ctx: OutlineRenderContext, a: TFile, b: TFile, column: string, direction: "asc" | "desc"): number {
  const va = sortValue(ctx, a, column);
  const vb = sortValue(ctx, b, column);
  const aEmpty = va === "" || va === null || va === undefined;
  const bEmpty = vb === "" || vb === null || vb === undefined;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof va === "number" && typeof vb === "number") return direction === "asc" ? va - vb : vb - va;
  const collator = new Intl.Collator("fr");
  const result = collator.compare(String(va), String(vb));
  return direction === "asc" ? result : -result;
}

function collectFiles(ctx: OutlineRenderContext, root: TFolder): OutlineFileEntry[] {
  const result: OutlineFileEntry[] = [];
  const walk = (folder: TFolder, flat: { value: number }): void => {
    const children = ctx.getOrderedChildren(folder).filter((child) => !ctx.isFrontMatter(child));
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child instanceof TFolder) walk(child, flat);
      else {
        result.push({ file: child, parentFolder: folder, binderIndex: index, siblings: children, binderFlatIndex: flat.value });
        flat.value += 1;
      }
    }
  };
  walk(root, { value: 0 });
  return result;
}

function emptyCells(ctx: OutlineRenderContext, row: HTMLElement, columns: OutlineColumn[], handlers: Record<string, (cell: HTMLElement) => void>): void {
  for (const column of columns) {
    const handler = handlers[column.id];
    if (handler) handler(row.createDiv({ cls: `feuillets-cell feuillets-cell-${column.id}` }));
    else if (column.id !== "title") row.createDiv({ cls: `feuillets-cell feuillets-cell-${column.id}` });
  }
}

function renderFileRow(ctx: OutlineRenderContext, table: HTMLElement, entry: OutlineFileEntry, depth: number, columns: OutlineColumn[], bumpTotal: (value?: number) => void): void {
  const { file, parentFolder, binderIndex, siblings } = entry;
  const row = table.createDiv({ cls: "feuillets-row feuillets-row-scene" });
  row.setAttr("data-path", file.path);
  if (ctx.isMultiSelected(file)) row.addClass("feuillets-multiselected");
  row.addEventListener("contextmenu", (event) => {
    if (ctx.isEditableContextTarget(event)) return;
    event.preventDefault();
    ctx.showFileContextMenu(event, file, parentFolder, binderIndex, siblings);
  });
  const handle = row.createDiv({ cls: "feuillets-col-handle", text: "⋮⋮" });
  if (ctx.outlineSortColumn === null) ctx.attachDragHandlers(handle, row, parentFolder, binderIndex, siblings, table);
  const titleCell = row.createDiv({ cls: "feuillets-cell feuillets-cell-title" });
  titleCell.style.paddingLeft = `${depth * 16}px`;
  const title = titleCell.createSpan({ cls: "feuillets-title-text", text: ctx.shortTitleFor(file) });
  let timer: number | ReturnType<typeof setTimeout> | null = null;
  title.addEventListener("click", (event) => {
    if (ctx.handleMultiSelectClick(event, file, parentFolder, binderIndex, siblings, table)) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => ctx.openFile(file), ctx.outlineDblClickDelayMs);
  });
  title.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (timer) window.clearTimeout(timer);
    ctx.beginInlineShortTitleEdit(titleCell, title, file);
  });

  const words = ctx.wcMap.get(file.path) || 0;
  bumpTotal(words);
  emptyCells(ctx, row, columns, {
    synopsis: (cell) => ctx.makeClickToEditFmArea(cell, file, "synopsis", "—", 1),
    pov: (cell) => ctx.makeClickToEditFmArea(cell, file, "pov", "—", 1),
    characters: (cell) => ctx.makeClickToEditFmList(cell, file, "characters", charactersOf(ctx.fm(file)), ctx.rerender),
    thread: (cell) => ctx.makeClickToEditFmList(cell, file, "thread", filsOf(ctx.fm(file)), ctx.rerender),
    summary: (cell) => ctx.makeClickToEditFmArea(cell, file, "summary", t("board.card.summaryPlaceholder"), 1),
    notes: (cell) => ctx.makeClickToEditFmArea(cell, file, "notes", t("board.outline.notesPlaceholder"), 1),
    tags: (cell) => ctx.makeTagsEditor(cell, file),
    label: (cell) => ctx.makeLabelSelect(cell, file),
    status: (cell) => ctx.makeStatusSelect(cell, file),
    date: (cell) => ctx.makeClickToEditFmArea(cell, file, "date", "—", 1),
    words: (cell) => cell.setText(String(words)),
    goal: (cell) => ctx.makeGoalInput(cell, file),
  });
}

async function renderLevel(ctx: OutlineRenderContext, table: HTMLElement, folder: TFolder, depth: number, columns: OutlineColumn[], bumpTotal: (value?: number) => void): Promise<void> {
  const children = ctx.getOrderedChildren(folder).filter((child) => !ctx.isFrontMatter(child));
  for (let index = 0; index < children.length; index += 1) {
    if (!ctx.isCurrentGeneration(ctx.generation)) return;
    const child = children[index];
    if (child instanceof TFolder) {
      const collapsed = !!ctx.settings.collapsed[child.path];
      const row = table.createDiv({ cls: "feuillets-row feuillets-row-folder" });
      const handle = row.createDiv({ cls: "feuillets-col-handle", text: "⋮⋮" });
      const titleCell = row.createDiv({ cls: "feuillets-cell feuillets-cell-title" });
      titleCell.style.paddingLeft = `${depth * 16}px`;
      titleCell.addClass("feuillets-clickable");
      titleCell.createSpan({ cls: "feuillets-chevron" }).setText(collapsed ? "▸" : "▾");
      const folderName = titleCell.createSpan({ cls: "feuillets-folder-name", text: child.name });
      const toggleFolder = (): void => {
        void (async () => {
          if (collapsed) delete ctx.settings.collapsed[child.path];
          else ctx.settings.collapsed[child.path] = true;
          await ctx.saveSettings();
          ctx.rerender();
        })();
      };
      let folderClickTimer: number | ReturnType<typeof setTimeout> | null = null;
      folderName.addEventListener("click", (event) => {
        event.stopPropagation();
        if (folderClickTimer) window.clearTimeout(folderClickTimer);
        folderClickTimer = window.setTimeout(toggleFolder, ctx.outlineDblClickDelayMs);
      });
      folderName.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (folderClickTimer) {
          window.clearTimeout(folderClickTimer);
          folderClickTimer = null;
        }
        void ctx.onFocusFolder(child);
      });
      titleCell.addEventListener("click", (event) => {
        if (event.target === folderName) return;
        toggleFolder();
      });
      row.addEventListener("contextmenu", (event) => {
        if (ctx.isEditableContextTarget(event)) return;
        event.preventDefault();
        ctx.showFolderContextMenu(event, child, folder, index, children);
      });
      ctx.attachDragHandlers(handle, row, folder, index, children, table);
      if (!collapsed) await renderLevel(ctx, table, child, depth + 1, columns, bumpTotal);
    } else if (ctx.passesFilter(child)) {
      renderFileRow(ctx, table, { file: child, parentFolder: folder, binderIndex: index, siblings: children, binderFlatIndex: 0 }, depth, columns, bumpTotal);
    }
  }
}

export async function renderBoardOutline(container: HTMLElement, scopeFolder: TFolder, ctx: OutlineRenderContext, bumpTotal: (value?: number) => void): Promise<void> {
  const outline = container.createDiv({ cls: `feuillets-outline${ctx.settings.outlineWrapLongText ? " feuillets-outline-wrap" : ""}` });
  outline.style.setProperty("--feuillets-cols", columnsTemplate(ctx));
  const columns = visibleColumns(ctx);
  const head = outline.createDiv({ cls: "feuillets-row feuillets-row-head" });
  head.createDiv({ cls: "feuillets-col-handle" });
  for (const column of columns) {
    const cell = head.createDiv({ cls: "feuillets-col-head-cell feuillets-col-sortable" });
    cell.createSpan({ text: column.label });
    const indicator = cell.createSpan({ cls: "feuillets-sort-indicator" });
    if (ctx.outlineSortColumn === column.id && ctx.outlineSortDirection) indicator.setText(ctx.outlineSortDirection === "asc" ? "↑" : "↓");
    cell.addEventListener("click", (event) => {
      const target = typeof Element !== "undefined" && event.target instanceof Element ? event.target : null;
      if (target?.classList.contains("feuillets-col-resizer")) return;
      ctx.cycleSort(column.id);
    });
    const resizer = cell.createDiv({ cls: "feuillets-col-resizer" });
    ctx.attachColumnResize(resizer, column.id, outline);
  }
  const sortColumn = ctx.outlineSortColumn;
  const sortDirection = ctx.outlineSortDirection;
  if (sortColumn && sortDirection) {
    const entries = collectFiles(ctx, scopeFolder).filter((entry) => ctx.passesFilter(entry.file));
    const sorted = entries.sort((a, b) => {
      const result = compareValues(ctx, a.file, b.file, sortColumn, sortDirection);
      return result || a.binderFlatIndex - b.binderFlatIndex;
    });
    for (const entry of sorted) {
      if (!ctx.isCurrentGeneration(ctx.generation)) return;
      renderFileRow(ctx, outline, entry, 0, columns, bumpTotal);
    }
    return;
  }
  await renderLevel(ctx, outline, scopeFolder, 0, columns, bumpTotal);
}
