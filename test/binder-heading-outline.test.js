import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";
import { t } from "../src/i18n/index.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* GitHub #17 — heading outline projection in the Binder: same minimal
 * harness as test/binder-folder-status-progress.test.js (duplicated per
 * this repo's convention), extended with a `headingsByPath` map fed to
 * `app.metadataCache.getFileCache()`, the sole source the renderer is
 * allowed to read from (see src/services/heading-outline-cache.ts).
 *
 * Final UX: a file's structure is shown ONLY on demand, via
 * "Show file structure" / "Hide file structure" in that file's OWN
 * context menu (never a project/global setting, never a chevron). The
 * choice is tracked per file in a session-only runtime Set
 * (`_visibleHeadingOutlinePaths`) — never persisted. */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle) };

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = {};
    this.text = options.text ?? "";
    this.style = { _props: {}, setProperty(name, value) { this._props[name] = value; } };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of String(classNames).split(" ")) if (c) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  scrollIntoView() {}
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs[name] = value; }
  getAttr(name) { return this.attrs[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    const classNames = (selector.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    const attrNames = (selector.match(/\[[\w-]+\]/g) || []).map((a) => a.slice(1, -1));
    const matches = [];
    const walk = (el) => {
      for (const child of el.children) {
        const classOk = classNames.every((c) => child.classes.has(c));
        const attrOk = attrNames.every((a) => Object.prototype.hasOwnProperty.call(child.attrs, a));
        if (classOk && attrOk) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
}

function findAll(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findAll(child, predicate));
  }
  return found;
}

function headingCache(heading, level, startOffset, endOffset) {
  return { heading, level, position: { start: { line: 0, col: 0, offset: startOffset }, end: { line: 0, col: 0, offset: endOffset } } };
}

function headingRows(scope) {
  return findAll(scope, (el) => el.classes.has("feuillets-heading-outline-row"));
}

function fileRow(scope, path) {
  return findAll(scope, (el) => el.classes.has("feuillets-item") && el.getAttr("data-path") === path)[0];
}

function structureItem(menu) {
  // Locale-independent: this test suite's compiled run defaults to French
  // (see test/i18n-test-bootstrap.js), so match on the icon, not the title.
  return menu.items.find((i) => i.icon === "list-tree");
}

/*
 * Roman/Manuscrit/
 *   Alpha.md         H1 A / H2 B / H3 C
 *   NoHeadings.md     (no headings)
 *   Jump.md           H1 A / H4 B                     (no phantom levels)
 *   Mixed.md          H1 A / H4 B / H3 C / H2 D        (B, C, D same depth)
 *   Deep.md           H1..H6, nested sequentially
 *   Dup.md            two H2 "Contexte" (both roots — distinct occurrences)
 */
function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");

  const alpha = new TFile("Roman/Manuscrit/Alpha.md");
  alpha.basename = "Alpha";
  const noHeadings = new TFile("Roman/Manuscrit/NoHeadings.md");
  noHeadings.basename = "NoHeadings";
  const jump = new TFile("Roman/Manuscrit/Jump.md");
  jump.basename = "Jump";
  const mixed = new TFile("Roman/Manuscrit/Mixed.md");
  mixed.basename = "Mixed";
  const deep = new TFile("Roman/Manuscrit/Deep.md");
  deep.basename = "Deep";
  const dup = new TFile("Roman/Manuscrit/Dup.md");
  dup.basename = "Dup";

  const children = [alpha, noHeadings, jump, mixed, deep, dup];
  root.children = children;
  for (const child of children) child.parent = root;

  const byPath = new Map([[root.path, root], ...children.map((c) => [c.path, c])]);

  const headingsByPath = new Map([
    [alpha.path, [headingCache("A", 1, 0, 1), headingCache("B", 2, 1, 2), headingCache("C", 3, 2, 3)]],
    [jump.path, [headingCache("A", 1, 0, 1), headingCache("B", 4, 1, 2)]],
    [mixed.path, [headingCache("A", 1, 0, 1), headingCache("B", 4, 1, 2), headingCache("C", 3, 2, 3), headingCache("D", 2, 3, 4)]],
    [deep.path, [1, 2, 3, 4, 5, 6].map((level) => headingCache(`L${level}`, level, level * 10, level * 10 + 1))],
    [dup.path, [headingCache("Contexte", 2, 0, 1), headingCache("Contexte", 2, 1, 2)]],
  ]);

  return { root, alpha, noHeadings, jump, mixed, deep, dup, byPath, headingsByPath };
}

function buildView(fixture, { settingsOverrides = {}, headingsByPath = fixture.headingsByPath, pluginOverrides = {} } = {}) {
  const { root, byPath } = fixture;
  const settings = {
    projectFolder: root.path,
    binderSelectedPath: root.path,
    projects: [],
    projectMeta: {},
    binderLayout: "tree",
    binderCompact: false,
    binderTreeWidth: 240,
    collapsed: {},
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    binderShowLabels: false,
    binderShowTags: false,
    binderShowStatus: false,
    binderShowProgress: false,
    binderShowWords: false,
    listPanePreviewField: "none",
    listPanePreviewLines: 2,
    folderGoals: {},
    ...settingsOverrides,
  };
  const contentEl = new FakeElement();
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: {} };
  const vaultRoot = new TFolder("");
  const app = {
    vault: {
      getAbstractFileByPath: (path) => byPath.get(path) || null,
      cachedRead: async () => "Contenu.",
      create: async () => { throw new Error("a read-only Binder render must never create a file"); },
      getRoot: () => vaultRoot,
    },
    metadataCache: {
      getFileCache: (file) => {
        const headings = headingsByPath.get(file.path);
        return headings ? { headings } : { frontmatter: {} };
      },
    },
    workspace: {
      leftSplit: { name: "left" },
      rightSplit: { name: "right" },
      rootSplit,
      getLeavesOfType: () => [],
      getActiveViewOfType: () => null,
      getMostRecentLeaf: (splitRoot) => (splitRoot === rootSplit ? workLeaf : null),
      setActiveLeaf: () => {},
      revealLeaf: async () => {},
    },
  };

  const multiSelect = new Set();
  const saveSettingsCalls = { count: 0 };
  const openFileCalls = { count: 0 };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: (folder) => {
      const results = [];
      const walk = (f) => {
        for (const child of f.children || []) {
          if (child instanceof TFile && child.basename !== f.name) results.push(child);
          else if (child instanceof TFolder) walk(child);
        }
      };
      walk(folder);
      return results;
    },
    getWordCounts: async (files) => new Map(files.map((f) => [f.path, { wc: 0 }])),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    tagsOf: () => [],
    labelOf: () => "",
    labelsOf: () => [],
    labelColor: () => null,
    roleOfFile: () => "scene",
    projectDisplayName: () => "Roman",
    saveSettings: async () => { saveSettingsCalls.count++; },
    generateCanvasBoard() {},
    getLeafForOpeningFile: () => { openFileCalls.count++; return workLeaf; },
    getStatusColor: () => null,
    folderNoteFor: () => null,
    folderGoal: () => 0,
    _binderMultiSelect: multiSelect,
    ...pluginOverrides,
  };

  const view = new FeuilletsView({ app, contentEl }, plugin);
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  return { view, contentEl, app, plugin, settings, multiSelect, saveSettingsCalls, openFileCalls };
}

// ===== Context menu action =====

test("a file with no headings gets no 'Show file structure' action", () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture);
  const menu = new Menu();
  view.headingOutlineContextMenuExtras(fixture.noHeadings)(menu);
  assert.equal(menu.items.length, 0);
});

test("a file with headings, structure hidden, shows 'Show file structure' with a list-tree icon", () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture);
  const menu = new Menu();
  view.headingOutlineContextMenuExtras(fixture.alpha)(menu);
  const item = structureItem(menu);
  assert.ok(item);
  assert.equal(item.title, t("binder.headingOutline.show"));
  assert.equal(item.icon, "list-tree");
});

test("clicking 'Show file structure' makes the file visible, re-renders, and never calls saveSettings", async () => {
  const fixture = buildFixture();
  const { view, saveSettingsCalls } = buildView(fixture);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  const menu = new Menu();
  view.headingOutlineContextMenuExtras(fixture.alpha)(menu);
  await structureItem(menu).click();

  assert.ok(view._visibleHeadingOutlinePaths.has(fixture.alpha.path));
  assert.equal(renderCalls, 1);
  assert.equal(saveSettingsCalls.count, 0);
});

test("reopening the menu for a now-visible file shows 'Hide file structure'", () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);

  const menu = new Menu();
  view.headingOutlineContextMenuExtras(fixture.alpha)(menu);
  const item = structureItem(menu);
  assert.equal(item.title, t("binder.headingOutline.hide"));
});

test("clicking 'Hide file structure' removes the file from the visible set and re-renders", async () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  const menu = new Menu();
  view.headingOutlineContextMenuExtras(fixture.alpha)(menu);
  await structureItem(menu).click();

  assert.equal(view._visibleHeadingOutlinePaths.has(fixture.alpha.path), false);
  assert.equal(renderCalls, 1);
});

test("the action is opt-in per caller: it lives only on FeuilletsView (the Binder), never on the shared BaseFeuilletsView that Board/Research/etc. extend", () => {
  assert.equal(typeof FeuilletsView.prototype.headingOutlineContextMenuExtras, "function");
  assert.equal(Object.prototype.hasOwnProperty.call(BaseFeuilletsView.prototype, "headingOutlineContextMenuExtras"), false);
  // showFileContextMenu (base-feuillets-view.ts) only ever calls its OWN
  // `extraItems` PARAMETER — a caller must pass this callback explicitly to
  // get the heading action at all. Board's calls (board-view.ts) never do,
  // so the shared method behaves for them exactly as it did before #17.
});

// ===== Rendered outline =====

test("structure not requested: no .feuillets-heading-outline-row at all", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);
  assert.equal(headingRows(contentEl).length, 0);
});

test("structure requested for Alpha.md: its three headings render in order", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const rows = headingRows(contentEl);
  const texts = rows.map((r) => findAll(r, (el) => el.classes.has("feuillets-heading-outline-text"))[0].text);
  assert.deepEqual(texts, ["A", "B", "C"]);
});

test("two files are independent: showing Alpha does not show Jump", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const rows = headingRows(contentEl);
  const texts = rows.map((r) => findAll(r, (el) => el.classes.has("feuillets-heading-outline-text"))[0].text);
  assert.deepEqual(texts, ["A", "B", "C"], "only Alpha's own headings, nothing from Jump");
});

test("hiding Alpha again removes its heading rows", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);
  assert.ok(headingRows(contentEl).length > 0);

  view._visibleHeadingOutlinePaths.delete(fixture.alpha.path);
  await view.render(true);
  assert.equal(headingRows(contentEl).length, 0);
});

test("H1 -> H4 jump: B is a direct visual child of A (relative depth differs by exactly one unit)", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.jump.path);
  await view.render(true);

  const rows = headingRows(contentEl);
  const textOf = (row) => findAll(row, (el) => el.classes.has("feuillets-heading-outline-text"))[0].text;
  const aRow = rows.find((r) => textOf(r) === "A");
  const bRow = rows.find((r) => textOf(r) === "B");
  assert.equal(aRow.getAttr("data-heading-level"), "1");
  assert.equal(bRow.getAttr("data-heading-level"), "4");
  assert.equal(aRow.style._props["--feuillets-heading-outline-depth"], "1", "a root heading starts at relative depth 1");
  assert.equal(bRow.style._props["--feuillets-heading-outline-depth"], "2", "B is A's direct child: exactly one level deeper, never four");
});

test("H1 A / H4 B / H3 C / H2 D: B, C, D share the same relative depth", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.mixed.path);
  await view.render(true);

  const rows = headingRows(contentEl);
  const textOf = (row) => findAll(row, (el) => el.classes.has("feuillets-heading-outline-text"))[0].text;
  const [aRow, bRow, cRow, dRow] = ["A", "B", "C", "D"].map((text) => rows.find((r) => textOf(r) === text));
  const depths = new Set([bRow, cRow, dRow].map((r) => r.style._props["--feuillets-heading-outline-depth"]));
  assert.equal(depths.size, 1, "B (H4), C (H3), D (H2) must share the exact same relative depth");
  assert.notEqual(aRow.style._props["--feuillets-heading-outline-depth"], bRow.style._props["--feuillets-heading-outline-depth"]);
});

test("H1 through H6: all rendered, relative depth grows by exactly one level at a time", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.deep.path);
  await view.render(true);

  const rows = headingRows(contentEl).filter((r) => /^L[1-6]$/.test(findAll(r, (el) => el.classes.has("feuillets-heading-outline-text"))[0].text));
  assert.equal(rows.length, 6);
  for (const row of rows) {
    const level = Number(row.getAttr("data-heading-level"));
    const text = findAll(row, (el) => el.classes.has("feuillets-heading-outline-text"))[0].text;
    assert.equal(text, `L${level}`);
    assert.equal(row.style._props["--feuillets-heading-outline-depth"], String(level), `L${level} sits at relative depth ${level}`);
  }
});

test("duplicate heading text produces two distinct rows", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.dup.path);
  await view.render(true);

  const rows = headingRows(contentEl).filter((r) => findAll(r, (el) => el.classes.has("feuillets-heading-outline-text"))[0].text === "Contexte");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0], rows[1]);
});

test("heading rows are always passive: no data-path, no draggable, no tabindex, never .feuillets-item/.feuillets-folder-row, no listeners", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const rows = headingRows(contentEl);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.getAttr("data-path"), null);
    assert.equal(row.getAttr("draggable"), null);
    assert.equal(row.getAttr("tabindex"), null);
    assert.equal(row.classes.has("feuillets-item"), false);
    assert.equal(row.classes.has("feuillets-folder-row"), false);
    assert.equal(row.events.size, 0);
  }
});

test("a file filtered out by the Binder search leaves no orphan heading rows, even if requested", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { settingsOverrides: { binderSearch: "alpha" } });
  view._visibleHeadingOutlinePaths.add(fixture.jump.path); // filtered out by the search below
  await view.render(true);

  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-item") && el.getAttr("data-path")).length, 1);
  assert.equal(headingRows(contentEl).length, 0);
});

test("split view (double pane): headings render only in the right files pane, never the left folders pane", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, {
    settingsOverrides: { binderLayout: "split", binderSelectedPath: fixture.root.path },
  });
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const listPane = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  assert.ok(listPane);
  assert.ok(treePane);
  assert.ok(headingRows(listPane).length > 0);
  assert.equal(headingRows(treePane).length, 0);
});

test("isolated Binder root: the same shared engine still supports the requested structure", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const sub = new TFolder("Roman/Manuscrit/Sub");
  sub.name = "Sub";
  const withHeadings = new TFile("Roman/Manuscrit/Sub/WithHeadings.md");
  withHeadings.basename = "WithHeadings";
  sub.children = [withHeadings];
  withHeadings.parent = sub;
  root.children = [sub];
  sub.parent = root;

  const byPath = new Map([[root.path, root], [sub.path, sub], [withHeadings.path, withHeadings]]);
  const headingsByPath = new Map([[withHeadings.path, [headingCache("Only", 1, 0, 1)]]]);
  const fixture = { root, byPath, headingsByPath };

  const { view, contentEl } = buildView(fixture, {
    pluginOverrides: { getWorkspaceFolder: () => sub, setWorkspaceFolder: () => {} },
  });
  view._visibleHeadingOutlinePaths.add(withHeadings.path);
  await view.render(true);

  assert.equal(headingRows(contentEl).length, 1, "the shared engine renders the requested structure identically while isolated");
  const isolatedPane = findAll(contentEl, (el) => el.classes.has("feuillets-binder-isolated"))[0];
  assert.ok(isolatedPane, "the isolated Binder marks its own pane with .feuillets-binder-isolated");
  assert.equal(headingRows(isolatedPane).length, 1, "the heading row is a DOM descendant of the isolated pane, so the CSS override actually applies to it");
});

test("MAX_TREE_ROWS: a file whose structure is NOT requested never consumes rows for its headings", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const files = Array.from({ length: 10 }, (_, i) => {
    const f = new TFile(`Roman/Manuscrit/File${i}.md`);
    f.basename = `File${i}`;
    return f;
  });
  root.children = files;
  for (const f of files) f.parent = root;

  const byPath = new Map([[root.path, root], ...files.map((f) => [f.path, f])]);
  const manyHeadings = Array.from({ length: 500 }, (_, i) => headingCache(`H${i}`, 1, i, i + 1));
  const headingsByPath = new Map(files.map((f) => [f.path, manyHeadings]));
  const fixture = { root, byPath, headingsByPath };

  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-item") && el.getAttr("data-path")).length, 10);
  assert.equal(headingRows(contentEl).length, 0);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-empty")).length, 0);
});

test("MAX_TREE_ROWS: once a file's structure IS requested, its headings count toward the shared limit", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const big = new TFile("Roman/Manuscrit/Big.md");
  big.basename = "Big";
  const after = new TFile("Roman/Manuscrit/ZAfter.md");
  after.basename = "ZAfter";
  root.children = [big, after];
  big.parent = root;
  after.parent = root;

  const byPath = new Map([[root.path, root], [big.path, big], [after.path, after]]);
  const manyHeadings = Array.from({ length: 1600 }, (_, i) => headingCache(`H${i}`, 1, i, i + 1));
  const headingsByPath = new Map([[big.path, manyHeadings]]);
  const fixture = { root, byPath, headingsByPath };

  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(big.path);
  await view.render(true);

  const rows = headingRows(contentEl);
  assert.equal(rows.length, 1499, "1500 total rows max, minus the 1 row already used by Big.md itself");
  const truncationMessages = findAll(contentEl, (el) => el.classes.has("feuillets-empty")).filter((el) => /1500/.test(el.text));
  assert.equal(truncationMessages.length, 1, "exactly one truncation message, never duplicated");
  assert.equal(fileRow(contentEl, after.path), undefined, "the shared MAX_TREE_ROWS cap already stopped the whole render");
});

// ===== Indentation base (file-title column, not the same formula as file rows) =====

test("indentation: a root heading's --feuillets-binder-depth equals the FILE's own depth, not depth+1", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const rows = headingRows(contentEl);
  for (const row of rows) {
    assert.equal(row.style._props["--feuillets-binder-depth"], "0", "Alpha.md sits at folder depth 0; its headings share that SAME physical depth");
  }
});

test("indentation: without label display, heading rows get no --with-label-column modifier class", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { settingsOverrides: { binderShowLabels: false } });
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  for (const row of headingRows(contentEl)) {
    assert.equal(row.classes.has("feuillets-heading-outline-row--with-label-column"), false);
  }
});

test("indentation: with label display on, heading rows get the --with-label-column modifier class", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { settingsOverrides: { binderShowLabels: true } });
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const rows = headingRows(contentEl);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.ok(row.classes.has("feuillets-heading-outline-row--with-label-column"));
  }
});

// ===== Isolated Binder indentation (CSS invariants, no pixel/JSDOM check) =====

const stylesSource = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

/** Extracts one CSS rule's declaration block by its exact selector line —
 * same static-source-check pattern as test/binder-context-menu-order.test.js
 * (methodBody), applied to a CSS rule instead of a method body. */
function cssBlock(source, selectorLine) {
  const start = source.indexOf(`${selectorLine} {`);
  assert.notEqual(start, -1, `selector must exist: ${selectorLine}`);
  const braceStart = source.indexOf("{", start);
  const braceEnd = source.indexOf("}", braceStart);
  return source.slice(braceStart + 1, braceEnd);
}

test("indentation: the normal (non-isolated) heading rule still reserves the chevron/icon column and the relative depth", () => {
  const normal = cssBlock(stylesSource, ".feuillets-heading-outline-row");
  assert.match(normal, /--feuillets-binder-chevron-w/);
  assert.match(normal, /--feuillets-binder-icon-w/);
  assert.match(normal, /--feuillets-heading-outline-depth/);
});

test("indentation: the normal with-label-column variant additionally reserves the label width", () => {
  const normalWithLabel = cssBlock(
    stylesSource,
    ".feuillets-heading-outline-row.feuillets-heading-outline-row--with-label-column"
  );
  assert.match(normalWithLabel, /--feuillets-binder-label-w/);
  assert.match(normalWithLabel, /--feuillets-binder-chevron-w/);
  assert.match(normalWithLabel, /--feuillets-binder-icon-w/);
});

test("indentation: an isolated-mode heading rule exists", () => {
  assert.match(stylesSource, /\.feuillets-binder-isolated \.feuillets-heading-outline-row \{/);
});

test("indentation: the isolated formula excludes the chevron and icon column widths", () => {
  const isolated = cssBlock(stylesSource, ".feuillets-binder-isolated .feuillets-heading-outline-row");
  assert.doesNotMatch(isolated, /--feuillets-binder-chevron-w/);
  assert.doesNotMatch(isolated, /--feuillets-binder-icon-w/);
});

test("indentation: the isolated formula still carries the relative heading depth", () => {
  const isolated = cssBlock(stylesSource, ".feuillets-binder-isolated .feuillets-heading-outline-row");
  assert.match(isolated, /--feuillets-heading-outline-depth/);
});

test("indentation: the isolated with-label-column variant reserves the label width but never chevron/icon", () => {
  const isolatedWithLabel = cssBlock(
    stylesSource,
    ".feuillets-binder-isolated .feuillets-heading-outline-row.feuillets-heading-outline-row--with-label-column"
  );
  assert.match(isolatedWithLabel, /--feuillets-binder-label-w/);
  assert.match(isolatedWithLabel, /--feuillets-heading-outline-depth/);
  assert.doesNotMatch(isolatedWithLabel, /--feuillets-binder-chevron-w/);
  assert.doesNotMatch(isolatedWithLabel, /--feuillets-binder-icon-w/);
});

test("indentation: the isolated BASE (no label column) reserves no label width at all", () => {
  const isolated = cssBlock(stylesSource, ".feuillets-binder-isolated .feuillets-heading-outline-row");
  assert.doesNotMatch(isolated, /--feuillets-binder-label-w/);
});

test("indentation: no CSS value ever computes indentation from a raw getBoundingClientRect/measurement API", () => {
  assert.doesNotMatch(stylesSource, /getBoundingClientRect/);
});

// ===== Context menu action position =====

function buildMenuFixture() {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  // Minimal extra surface real showFileContextMenu touches at CONSTRUCTION
  // time (never at click time) beyond what buildView() already provides.
  plugin.isSceneFile = () => true;
  plugin.settings.labels = [];
  plugin.settings.projectMeta = {};
  app.workspace.getLeaf = () => ({});
  return { fixture, view, app, plugin };
}

/** showFileContextMenu() constructs its OWN `new Menu()` internally, so the
 * only way to recover that exact instance from outside — without changing
 * production code — is to spy on `Menu.prototype.showAtMouseEvent`, which
 * every production call site invokes on it exactly once at the end. */
function captureFileMenu(view, file, extraItems) {
  const originalShowAt = Menu.prototype.showAtMouseEvent;
  let captured = null;
  Menu.prototype.showAtMouseEvent = function showAtMouseEventSpy() { captured = this; };
  try {
    view.showFileContextMenu({ preventDefault() {} }, file, file.parent, 0, file.parent.children, extraItems);
  } finally {
    Menu.prototype.showAtMouseEvent = originalShowAt;
  }
  return captured;
}

test("menu position: with extraItems, the heading action appears in the navigation group, before the first separator", () => {
  const { fixture, view } = buildMenuFixture();
  const menu = captureFileMenu(view, fixture.alpha, view.headingOutlineContextMenuExtras(fixture.alpha));

  const headingIndex = menu.items.findIndex((i) => i.icon === "list-tree");
  const firstSeparatorIndex = menu.items.findIndex((i) => i.separator === true);
  assert.notEqual(headingIndex, -1, "the heading action must be present");
  assert.notEqual(firstSeparatorIndex, -1);
  assert.ok(headingIndex < firstSeparatorIndex, "the heading action must sit in the navigation group, before the first section separator");
});

test("menu position: the heading action appears before any destructive action, and Trash remains the last actionable entry", () => {
  const { fixture, view } = buildMenuFixture();
  const menu = captureFileMenu(view, fixture.alpha, view.headingOutlineContextMenuExtras(fixture.alpha));

  const items = menu.items;
  const headingIndex = items.findIndex((i) => i.icon === "list-tree");
  const trashIndex = items.findIndex((i) => i.title === t("shared.trash"));
  assert.notEqual(headingIndex, -1, "the heading action must be present");
  assert.notEqual(trashIndex, -1, "Trash must be present");
  assert.ok(headingIndex < trashIndex, "the heading action must appear before Trash");

  // Trash must be the LAST actionable (non-separator) entry.
  const actionable = items.filter((i) => !i.separator && !i.disabled);
  assert.equal(actionable[actionable.length - 1].title, t("shared.trash"), "Trash stays the final action in the menu");
});

test("menu position: extraItems is invoked exactly once", () => {
  const { fixture, view } = buildMenuFixture();
  let calls = 0;
  captureFileMenu(view, fixture.alpha, (menu) => { calls++; void menu; });
  assert.equal(calls, 1);
});

test("menu position: a historical call with no extraItems produces the exact same menu as before (no heading entry, same item count)", () => {
  const { fixture, view } = buildMenuFixture();
  const withoutExtras = captureFileMenu(view, fixture.alpha);
  const withExtras = captureFileMenu(view, fixture.alpha, view.headingOutlineContextMenuExtras(fixture.alpha));

  assert.equal(withoutExtras.items.some((i) => i.icon === "list-tree"), false, "no extraItems callback -> no heading entry, exactly like before GitHub #17");
  assert.equal(withExtras.items.some((i) => i.icon === "list-tree"), true);
  assert.equal(withExtras.items.length, withoutExtras.items.length + 1, "the ONLY difference is the one heading entry");
});

test("menu position: Board's own showFileContextMenu call sites never pass the heading callback (source audit)", () => {
  const boardSource = readFileSync(resolve(process.cwd(), "src/views/board-view.ts"), "utf8");
  const boardOutlineSource = readFileSync(resolve(process.cwd(), "src/views/board-outline.ts"), "utf8");
  for (const call of [...boardSource.matchAll(/showFileContextMenu\(([^)]*)\)/g)]) {
    assert.doesNotMatch(call[1], /headingOutlineContextMenuExtras/, "Board must never pass the Binder-only heading callback");
  }
  for (const call of [...boardOutlineSource.matchAll(/showFileContextMenu\(([^)]*)\)/g)]) {
    assert.doesNotMatch(call[1], /headingOutlineContextMenuExtras/);
  }
});

// ===== Isolated Binder: file+headings form one visual group (border-bottom) =====

test("isolated separator: a file with no visible structure keeps the historical border behavior", () => {
  assert.match(stylesSource, /\.feuillets-binder-isolated \.feuillets-item \{\s*border-bottom: 1px solid var\(--background-modifier-border\);\s*\}/);
  assert.match(stylesSource, /\.feuillets-binder-isolated \.feuillets-item:last-child \{\s*border-bottom: none;\s*\}/);
});

test("isolated separator: a file immediately followed by a heading row loses its own border-bottom", () => {
  const block = cssBlock(stylesSource, ".feuillets-binder-isolated .feuillets-item:has(+ .feuillets-heading-outline-row)");
  assert.match(block, /border-bottom:\s*none/);
});

test("isolated separator: the group separator lands on the LAST heading row of a contiguous run, never an intermediate one", () => {
  const block = cssBlock(
    stylesSource,
    ".feuillets-binder-isolated .feuillets-heading-outline-row:not(:has(+ .feuillets-heading-outline-row))"
  );
  assert.match(block, /border-bottom:\s*1px solid var\(--background-modifier-border\)/);
});

test("isolated separator: the very last row of the whole list never gets a final separator, even a heading row", () => {
  const lastChildSelector = ".feuillets-binder-isolated .feuillets-heading-outline-row:last-child";
  const block = cssBlock(stylesSource, lastChildSelector);
  assert.match(block, /border-bottom:\s*none/);

  // Cascade order matters: same specificity as the "last of run" rule above,
  // so this override must come AFTER it in source to actually win.
  const groupEndIndex = stylesSource.indexOf(".feuillets-binder-isolated .feuillets-heading-outline-row:not(:has(+ .feuillets-heading-outline-row))");
  const lastChildIndex = stylesSource.indexOf(lastChildSelector);
  assert.ok(groupEndIndex !== -1 && lastChildIndex !== -1);
  assert.ok(lastChildIndex > groupEndIndex, "the :last-child override must appear AFTER the group-end rule to win the cascade");
});

test("isolated separator: none of this grouping logic touches folder rows", () => {
  assert.doesNotMatch(stylesSource, /\.feuillets-folder-row:has\(/);
  assert.doesNotMatch(stylesSource, /:not\(:has\(\+ \.feuillets-folder-row\)\)/);
});

test("isolated separator: the normal (non-isolated) Binder gets no new grouping rule at all", () => {
  assert.doesNotMatch(stylesSource, /(?<!\.feuillets-binder-isolated )\.feuillets-item:has\(\+ \.feuillets-heading-outline-row\)/);
  assert.doesNotMatch(stylesSource, /(?<!\.feuillets-binder-isolated )\.feuillets-heading-outline-row:not\(:has\(\+ \.feuillets-heading-outline-row\)\)/);
});

test("isolated separator: heading rows are rendered as flat DOM siblings immediately after their own file row (the precondition the :has() selector relies on)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const sub = new TFolder("Roman/Manuscrit/Sub");
  sub.name = "Sub";
  const a = new TFile("Roman/Manuscrit/Sub/A.md");
  a.basename = "A";
  const b = new TFile("Roman/Manuscrit/Sub/B.md");
  b.basename = "B";
  sub.children = [a, b];
  a.parent = sub;
  b.parent = sub;
  root.children = [sub];
  sub.parent = root;

  const byPath = new Map([[root.path, root], [sub.path, sub], [a.path, a], [b.path, b]]);
  const headingsByPath = new Map([[a.path, [headingCache("A1", 1, 0, 1), headingCache("A2", 2, 1, 2)]]]);
  const fixture = { root, byPath, headingsByPath };

  const { view, contentEl } = buildView(fixture, {
    pluginOverrides: { getWorkspaceFolder: () => sub, setWorkspaceFolder: () => {} },
  });
  view._visibleHeadingOutlinePaths.add(a.path);
  await view.render(true);

  const isolatedPane = findAll(contentEl, (el) => el.classes.has("feuillets-binder-isolated"))[0];
  assert.ok(isolatedPane);
  const rows = findAll(isolatedPane, (el) => el.classes.has("feuillets-item") || el.classes.has("feuillets-heading-outline-row"));
  const kinds = rows.map((r) => (r.classes.has("feuillets-item") ? `file:${r.getAttr("data-path")}` : "heading"));
  assert.deepEqual(kinds, ["file:Roman/Manuscrit/Sub/A.md", "heading", "heading", "file:Roman/Manuscrit/Sub/B.md"]);
});
