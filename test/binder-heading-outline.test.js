import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu, MarkdownView } from "obsidian";
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
      getActiveFile: () => null,
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

test("heading rows stay virtual: no data-path, no tabindex, no role, never .feuillets-item/.feuillets-folder-row, and never contextmenu — only click and section-drag listeners", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const rows = headingRows(contentEl);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.getAttr("data-path"), null);
    assert.equal(row.getAttr("draggable"), "true");
    assert.equal(row.getAttr("tabindex"), null);
    assert.equal(row.getAttr("role"), null);
    assert.equal(row.classes.has("feuillets-item"), false);
    assert.equal(row.classes.has("feuillets-folder-row"), false);
    assert.deepEqual(
      [...row.events.keys()].sort(),
      ["click", "dragend", "dragleave", "dragover", "dragstart", "drop"]
    );
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

test("isolated separator: a file with a visible heading outline loses its own border-bottom", () => {
  const block = cssBlock(stylesSource, ".feuillets-binder-isolated .feuillets-item.feuillets-item--with-visible-heading-outline");
  assert.match(block, /border-bottom:\s*none/);
});

test("isolated separator: the group separator lands on the explicitly marked final visible heading row", () => {
  const block = cssBlock(
    stylesSource,
    ".feuillets-binder-isolated .feuillets-heading-outline-row.feuillets-heading-outline-row--last-visible-for-file"
  );
  assert.match(block, /border-bottom:\s*1px solid var\(--background-modifier-border\)/);
});

test("isolated separator: the very last outline row of the whole list never gets a final separator", () => {
  const lastChildSelector = ".feuillets-binder-isolated .feuillets-heading-outline-row.feuillets-heading-outline-row--last-visible-for-file:last-child";
  const block = cssBlock(stylesSource, lastChildSelector);
  assert.match(block, /border-bottom:\s*none/);

  // Cascade order matters: same specificity as the marked final-row rule above,
  // so this override must come AFTER it in source to actually win.
  const groupEndIndex = stylesSource.indexOf(".feuillets-binder-isolated .feuillets-heading-outline-row.feuillets-heading-outline-row--last-visible-for-file");
  const lastChildIndex = stylesSource.indexOf(lastChildSelector);
  assert.ok(groupEndIndex !== -1 && lastChildIndex !== -1);
  assert.ok(lastChildIndex > groupEndIndex, "the :last-child override must appear AFTER the group-end rule to win the cascade");
});

test("isolated separator: none of this grouping logic touches folder rows", () => {
  assert.doesNotMatch(stylesSource, /\.feuillets-folder-row\.feuillets-item--with-visible-heading-outline/);
  assert.doesNotMatch(stylesSource, /\.feuillets-folder-row\.feuillets-heading-outline-row--last-visible-for-file/);
});

test("isolated separator: styles.css contains no :has() selector", () => {
  assert.doesNotMatch(stylesSource, /:has\(/);
});

test("isolated separator: rendering marks the file and final visible outline row explicitly", async () => {
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
  assert.ok(rows[0].classes.has("feuillets-item--with-visible-heading-outline"));
  assert.equal(rows[1].classes.has("feuillets-heading-outline-row--last-visible-for-file"), false);
  assert.ok(rows[2].classes.has("feuillets-heading-outline-row--last-visible-for-file"));
});

test("isolated separator: a collapsed branch marks its visible parent as the final outline row", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const file = new TFile("Roman/Manuscrit/A.md");
  file.basename = "A";
  root.children = [file];
  file.parent = root;

  const fixture = {
    root,
    byPath: new Map([[root.path, root], [file.path, file]]),
    headingsByPath: new Map([[file.path, [headingCache("A1", 1, 0, 1), headingCache("A2", 2, 1, 2)]]]),
  };
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(file.path);
  view._collapsedHeadingKeys.add(`${file.path}\u00001\u0000A1\u00000`);
  await view.render(true);

  const row = headingRows(contentEl)[0];
  assert.equal(headingRows(contentEl).length, 1);
  assert.ok(fileRow(contentEl, file.path).classes.has("feuillets-item--with-visible-heading-outline"));
  assert.ok(row.classes.has("feuillets-heading-outline-row--last-visible-for-file"));
});

// ===== GitHub #17 follow-up: click-to-navigate =====

/** Wires the fake leaf `buildView()` already returns from
 * `plugin.getLeafForOpeningFile()` with an `openFile()` that records calls
 * and a MarkdownView-shaped `.view` (a fake editor recording every call) —
 * the same `Object.assign(Object.create(MarkdownView.prototype), { editor })`
 * pattern used elsewhere in this test suite so `openFileAndSelectRange()`
 * (utils/dom.ts) recognizes it as a real MarkdownView. */
function setupNavigableLeaf(plugin, app) {
  const leaf = plugin.getLeafForOpeningFile();
  const openFileCalls = [];
  leaf.openFile = async (file, opts) => { openFileCalls.push({ file, opts }); };
  const setActiveLeafCalls = [];
  app.workspace.setActiveLeaf = (l, opts) => { setActiveLeafCalls.push({ leaf: l, opts }); };
  const revealLeafCalls = [];
  app.workspace.revealLeaf = async (l) => { revealLeafCalls.push(l); };
  const editorCalls = { offsetToPos: [], setSelection: [], scrollIntoView: [], focus: 0 };
  const fakeEditor = {
    getValue: () => "x".repeat(10000),
    offsetToPos: (offset) => { editorCalls.offsetToPos.push(offset); return { line: 0, ch: offset }; },
    setSelection: (from, to) => { editorCalls.setSelection.push({ from, to }); },
    scrollIntoView: (range) => { editorCalls.scrollIntoView.push(range); },
    focus: () => { editorCalls.focus++; },
  };
  leaf.view = Object.assign(Object.create(MarkdownView.prototype), { editor: fakeEditor });
  return { leaf, openFileCalls, setActiveLeafCalls, revealLeafCalls, editorCalls };
}

test("a heading row has exactly one click listener wired to navigation", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const row = headingRows(contentEl)[0];
  assert.ok(row.events.has("click"));
});

test("clicking a heading row calls preventDefault/stopPropagation and delegates to navigateToHeading with the exact file and node", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const calls = [];
  view.navigateToHeading = async (file, node) => { calls.push({ file, node }); };

  const row = headingRows(contentEl)[0];
  let defaultPrevented = false;
  let propagationStopped = false;
  row.events.get("click")({
    preventDefault: () => { defaultPrevented = true; },
    stopPropagation: () => { propagationStopped = true; },
  });

  assert.equal(defaultPrevented, true);
  assert.equal(propagationStopped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, fixture.alpha);
  assert.equal(calls[0].node.text, "A");
  assert.equal(calls[0].node.startOffset, 0);
});

test("navigateToHeading() calls getLeafForOpeningFile() exactly once and opens the correct file", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  const { openFileCalls } = setupNavigableLeaf(plugin, app);

  let leafCallsBefore = 0;
  const originalGetLeaf = plugin.getLeafForOpeningFile;
  plugin.getLeafForOpeningFile = (...args) => { leafCallsBefore++; return originalGetLeaf(...args); };

  await view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] });

  assert.equal(leafCallsBefore, 1);
  assert.equal(openFileCalls.length, 1);
  assert.equal(openFileCalls[0].file, fixture.alpha);
});

test("navigateToHeading() opens with { active: true }, activates the leaf with focus, selects the COLLAPSED startOffset, scrolls, and focuses the editor", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  const { leaf, openFileCalls, setActiveLeafCalls, revealLeafCalls, editorCalls } = setupNavigableLeaf(plugin, app);

  const node = { text: "B", level: 2, startOffset: 42, endOffset: 60, children: [] };
  await view.navigateToHeading(fixture.alpha, node);

  assert.deepEqual(openFileCalls[0].opts, { active: true });
  assert.equal(setActiveLeafCalls.length, 1);
  assert.equal(setActiveLeafCalls[0].leaf, leaf);
  assert.deepEqual(setActiveLeafCalls[0].opts, { focus: true });

  // The cursor lands EXACTLY on node.startOffset, never node.endOffset.
  assert.deepEqual(editorCalls.offsetToPos, [42, 42], "both ends of the selection are computed from startOffset only");
  assert.equal(editorCalls.setSelection.length, 1);
  assert.deepEqual(editorCalls.setSelection[0].from, { line: 0, ch: 42 });
  assert.deepEqual(editorCalls.setSelection[0].to, { line: 0, ch: 42 });
  assert.deepEqual(editorCalls.setSelection[0].from, editorCalls.setSelection[0].to, "the selection must be collapsed: never the whole heading line");

  assert.equal(editorCalls.scrollIntoView.length, 1);
  assert.equal(editorCalls.focus, 1, "the editor, not the Binder row, ends up focused");
  assert.equal(revealLeafCalls.length, 1);
  assert.equal(revealLeafCalls[0], leaf);
});

test("navigateToHeading() never uses node.endOffset for the selection range", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  const { editorCalls } = setupNavigableLeaf(plugin, app);

  await view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 5, endOffset: 500, children: [] });

  assert.ok(!editorCalls.offsetToPos.includes(500), "endOffset (500) must never reach the editor");
  assert.deepEqual(editorCalls.offsetToPos, [5, 5]);
});

test("duplicate heading text navigates by startOffset alone, never by searching the text", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  const { openFileCalls, editorCalls } = setupNavigableLeaf(plugin, app);

  const first = { text: "Introduction", level: 1, startOffset: 10, endOffset: 20, children: [] };
  const second = { text: "Introduction", level: 1, startOffset: 250, endOffset: 262, children: [] };

  await view.navigateToHeading(fixture.alpha, first);
  await view.navigateToHeading(fixture.alpha, second);

  assert.equal(openFileCalls.length, 2);
  assert.deepEqual(editorCalls.setSelection.map((s) => s.from.ch), [10, 250]);
});

test("two headings of the SAME already-open file each reposition the cursor: no shortcut skips selection because the file is already active", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  const { openFileCalls, editorCalls } = setupNavigableLeaf(plugin, app);

  await view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] });
  await view.navigateToHeading(fixture.alpha, { text: "C", level: 3, startOffset: 2, endOffset: 3, children: [] });

  assert.equal(openFileCalls.length, 2, "leaf.openFile() is still awaited on the second click, even for the same file");
  assert.deepEqual(editorCalls.setSelection.map((s) => s.from.ch), [0, 2]);
});

test("navigateToHeading() opening a DIFFERENT, not-yet-open file still opens it and positions the cursor after the open completes", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  const { openFileCalls, editorCalls } = setupNavigableLeaf(plugin, app);

  await view.navigateToHeading(fixture.jump, { text: "B", level: 4, startOffset: 1, endOffset: 2, children: [] });

  assert.equal(openFileCalls.length, 1);
  assert.equal(openFileCalls[0].file, fixture.jump);
  assert.deepEqual(editorCalls.setSelection[0].from, { line: 0, ch: 1 });
});

test("navigateToHeading() never touches Binder multi-select or the visible-heading-outline set", async () => {
  const fixture = buildFixture();
  const { view, app, plugin, multiSelect } = buildView(fixture);
  setupNavigableLeaf(plugin, app);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  const visibleSnapshot = new Set(view._visibleHeadingOutlinePaths);

  await view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] });

  assert.equal(multiSelect.size, 0);
  assert.deepEqual(view._visibleHeadingOutlinePaths, visibleSnapshot);
});

test("navigateToHeading() never calls saveSettings() or re-renders the Binder", async () => {
  const fixture = buildFixture();
  const { view, app, plugin, saveSettingsCalls } = buildView(fixture);
  setupNavigableLeaf(plugin, app);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  await view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] });

  assert.equal(saveSettingsCalls.count, 0);
  assert.equal(renderCalls, 0);
});

test("keyboard non-regression: the Binder's ArrowUp/ArrowDown -> openNeighbor listener never references heading rows", () => {
  const source = readFileSync(resolve(process.cwd(), "src/views/feuillets-view.ts"), "utf8");
  const start = source.indexOf('this.registerDomEvent(window, "keydown"');
  assert.notEqual(start, -1, "the Binder keydown listener must still exist");
  const end = source.indexOf("}, { capture: true });", start);
  assert.notEqual(end, -1, "the handler must still end with its capture-phase registration");
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /heading/i, "the ArrowUp/Down handler must not special-case heading rows in any way");
});

test("heading rows remain non-focusable: no tabindex, no role, so they never become the ArrowUp/Down keydown target", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  for (const row of headingRows(contentEl)) {
    assert.equal(row.getAttr("tabindex"), null);
    assert.equal(row.getAttr("role"), null);
  }
});

// ===== Regression: a heading click must never scroll the Binder itself =====

/** A minimal, purpose-built Binder root for exercising the REAL
 * `highlightActive()`/`updateActiveHighlight()` — decoupled from the shared
 * `FakeElement` used for rendering assertions elsewhere in this file, whose
 * `querySelectorAll()` does not resolve attribute VALUES (only attribute
 * presence), so it cannot stand in for `[data-path="..."]` matching. */
function makeHighlightableBinderRoot(filePath) {
  const scrollCalls = { count: 0 };
  const fileEl = {
    classes: new Set(),
    addClass(name) { this.classes.add(name); },
    removeClass(name) { this.classes.delete(name); },
    scrollIntoView() { scrollCalls.count++; },
  };
  const root = {
    querySelectorAll(selector) {
      if (selector.startsWith("[data-path=")) {
        const match = selector.match(/\[data-path="([^"]*)"\]/);
        return match && match[1] === filePath ? [fileEl] : [];
      }
      return [fileEl].filter((el) => el.classes.has("is-active") || el.classes.has("feuillets-dragover") || el.classes.has("feuillets-dragging"));
    },
  };
  return { root, fileEl, scrollCalls };
}

/** Restores the REAL `updateActiveHighlight()` — `buildView()` stubs it out
 * to `() => {}` so ordinary render() tests never need a working
 * `app.workspace.getActiveFile()`. */
function useRealActiveHighlight(view) {
  delete view.updateActiveHighlight;
}

test("navigateToHeading(): while file-open/active-leaf-change fire during the click, the file becomes .is-active but the Binder itself never scrolls — the EDITOR still scrolls", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  useRealActiveHighlight(view);
  const { leaf, editorCalls } = setupNavigableLeaf(plugin, app);
  const { root, fileEl, scrollCalls } = makeHighlightableBinderRoot(fixture.alpha.path);
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  const originalOpenFile = leaf.openFile;
  leaf.openFile = async (file, opts) => {
    await originalOpenFile(file, opts);
    // Simulates Obsidian firing "file-open"/"active-leaf-change" for real,
    // synchronously inside the awaited leaf.openFile() — the exact moment
    // the reported bug reproduced: the Binder's own highlight/scroll ran
    // WHILE the heading click was still in flight.
    view.updateActiveHighlight();
  };

  await view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] });

  assert.ok(fileEl.classes.has("is-active"), "the parent file must still become .is-active");
  assert.equal(scrollCalls.count, 0, "the Binder's own scrollIntoView must NEVER fire during a heading navigation");
  assert.equal(editorCalls.scrollIntoView.length, 1, "the EDITOR itself must still scroll to the heading");
});

test("after navigateToHeading() resolves, the transient depth counter is back to 0 and normal scroll-revealing highlight behavior is restored", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  useRealActiveHighlight(view);
  setupNavigableLeaf(plugin, app);
  const { root, scrollCalls } = makeHighlightableBinderRoot(fixture.alpha.path);
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  await view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] });
  assert.equal(view._headingNavigationDepth, 0);

  view.updateActiveHighlight(); // e.g. "Next/previous sheet", an internal link, a command
  assert.equal(scrollCalls.count, 1, "outside a heading navigation, the historical scrollIntoView must fire again");
});

test("if leaf.openFile() rejects, the transient depth counter still returns to 0 (try/finally), and normal scroll behavior is restored", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  useRealActiveHighlight(view);
  const { leaf } = setupNavigableLeaf(plugin, app);
  leaf.openFile = async () => { throw new Error("boom"); };
  const { root, scrollCalls } = makeHighlightableBinderRoot(fixture.alpha.path);
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  await assert.rejects(() => view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] }));
  assert.equal(view._headingNavigationDepth, 0, "an error must not leave the scroll suppression stuck on");

  view.updateActiveHighlight();
  assert.equal(scrollCalls.count, 1, "normal scroll behavior is restored even after a failed navigation");
});

test("two overlapping heading navigations keep the Binder scroll suppressed until BOTH finish (a counter, not a boolean, is required)", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  useRealActiveHighlight(view);
  const { leaf } = setupNavigableLeaf(plugin, app);
  let resolveFirstOpen;
  const firstOpenGate = new Promise((resolve) => { resolveFirstOpen = resolve; });
  let openCount = 0;
  leaf.openFile = async () => {
    openCount++;
    if (openCount === 1) await firstOpenGate;
  };
  const { root, scrollCalls } = makeHighlightableBinderRoot(fixture.alpha.path);
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  const navA = view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] });
  const navB = view.navigateToHeading(fixture.alpha, { text: "C", level: 3, startOffset: 2, endOffset: 3, children: [] });
  await navB;

  assert.equal(view._headingNavigationDepth, 1, "A is still in flight: depth must still be 1, not 0");
  view.updateActiveHighlight();
  assert.equal(scrollCalls.count, 0, "scroll must STILL be suppressed while A is in flight");

  resolveFirstOpen();
  await navA;
  assert.equal(view._headingNavigationDepth, 0);
  view.updateActiveHighlight();
  assert.equal(scrollCalls.count, 1, "scroll resumes only once BOTH overlapping navigations have finished");
});

test("navigateToHeading(): while workspace.revealLeaf() itself is still pending (openFile already done), the Binder scroll stays suppressed; it resumes only once revealLeaf() actually resolves", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  useRealActiveHighlight(view);
  const { openFileCalls } = setupNavigableLeaf(plugin, app);
  const { root, scrollCalls } = makeHighlightableBinderRoot(fixture.alpha.path);
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  let resolveReveal;
  const revealGate = new Promise((resolve) => { resolveReveal = resolve; });
  let revealCalled = false;
  app.workspace.revealLeaf = async () => {
    revealCalled = true;
    await revealGate;
  };

  const nav = view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] });

  // Poll microtasks until revealLeaf() has actually been entered — proves
  // openFile()/selectRange() already completed and we are now stuck
  // specifically INSIDE revealLeaf(), not merely somewhere earlier.
  for (let i = 0; i < 20 && !revealCalled; i++) await Promise.resolve();
  assert.ok(revealCalled, "revealLeaf() must have been called by now");
  assert.equal(openFileCalls.length, 1, "openFile() must have already completed by the time revealLeaf() runs");

  assert.ok(view._headingNavigationDepth > 0, "the lock must still be held while revealLeaf() is pending");
  view.updateActiveHighlight();
  assert.equal(scrollCalls.count, 0, "the Binder must not scroll while revealLeaf() is still pending");

  resolveReveal();
  await nav;

  assert.equal(view._headingNavigationDepth, 0);
  view.updateActiveHighlight();
  assert.equal(scrollCalls.count, 1, "the Binder scroll resumes once revealLeaf() has actually resolved");
});

test("if workspace.revealLeaf() rejects, navigateToHeading() rejects too, but the transient counter still returns to 0 and normal scroll behavior is restored", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  useRealActiveHighlight(view);
  setupNavigableLeaf(plugin, app);
  app.workspace.revealLeaf = async () => { throw new Error("reveal failed"); };
  const { root, scrollCalls } = makeHighlightableBinderRoot(fixture.alpha.path);
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  await assert.rejects(() => view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] }));
  assert.equal(view._headingNavigationDepth, 0, "a revealLeaf() rejection must not leave the scroll suppression stuck on");

  view.updateActiveHighlight();
  assert.equal(scrollCalls.count, 1, "normal scroll behavior is restored even after a failed revealLeaf()");
});

test("concurrent: while navigation A is blocked specifically inside its own revealLeaf(), navigation B can still start and finish, and the scroll stays suppressed until A's revealLeaf() resolves", async () => {
  const fixture = buildFixture();
  const { view, app, plugin } = buildView(fixture);
  useRealActiveHighlight(view);
  setupNavigableLeaf(plugin, app);
  const { root, scrollCalls } = makeHighlightableBinderRoot(fixture.alpha.path);
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  let resolveARevealGate;
  const aRevealGate = new Promise((resolve) => { resolveARevealGate = resolve; });
  let revealCallCount = 0;
  app.workspace.revealLeaf = async () => {
    revealCallCount++;
    if (revealCallCount === 1) await aRevealGate;
  };

  const navA = view.navigateToHeading(fixture.alpha, { text: "A", level: 1, startOffset: 0, endOffset: 1, children: [] });
  const navB = view.navigateToHeading(fixture.alpha, { text: "C", level: 3, startOffset: 2, endOffset: 3, children: [] });
  await navB;

  assert.equal(view._headingNavigationDepth, 1, "A is still stuck inside its own revealLeaf(): depth must still be 1");
  view.updateActiveHighlight();
  assert.equal(scrollCalls.count, 0, "scroll must STILL be suppressed while A's revealLeaf() is pending");

  resolveARevealGate();
  await navA;
  assert.equal(view._headingNavigationDepth, 0);
  view.updateActiveHighlight();
  assert.equal(scrollCalls.count, 1, "scroll resumes only once A's revealLeaf() has actually resolved");
});

test("normal file-click navigation (not a heading) is untouched: highlightActive still scrolls the Binder to reveal the active row", async () => {
  const fixture = buildFixture();
  const { view, app } = buildView(fixture);
  useRealActiveHighlight(view);
  const { root, scrollCalls } = makeHighlightableBinderRoot(fixture.alpha.path);
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  view.updateActiveHighlight();
  assert.equal(scrollCalls.count, 1, "a normal active-file change (command, internal link, next/previous sheet) must still reveal the row");
});

// ===== GitHub #17 follow-up: a LATE, redundant "active-leaf-change" toward =====
// ===== an already-active row must not scroll the Binder a second time    =====

/** A minimal fake Binder root supporting exactly what `isBinderPathAlreadyActive()`
 * and `highlightActive()` need: compound class selectors (".feuillets-item.is-active"),
 * comma-separated OR selectors (the cleanup selector), and `[data-path="..."]`
 * attribute-value matching — plus a real `.dataset.path` on each element, since
 * production code reads `el.dataset.path`, not `getAttr("data-path")`. */
function makeActiveHighlightFixture(paths) {
  const scrollCalls = { count: 0 };
  const elements = paths.map((path) => ({
    classes: new Set(["feuillets-item"]),
    dataset: { path },
    addClass(name) { this.classes.add(name); },
    removeClass(name) { this.classes.delete(name); },
    scrollIntoView() { scrollCalls.count++; },
  }));

  function matchesPart(el, part) {
    const dataMatch = part.match(/\[data-path="([^"]*)"\]/);
    // Strip the attribute selector FIRST: a real file path can contain a
    // literal "." (extension, folder name…), which the class-name regex
    // below would otherwise misread as a stray ".class" token.
    const withoutAttr = part.replace(/\[[^\]]*\]/g, "");
    const classNames = (withoutAttr.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    const classOk = classNames.every((c) => el.classes.has(c));
    const dataOk = !dataMatch || el.dataset.path === dataMatch[1];
    return classOk && dataOk;
  }

  const root = {
    querySelectorAll(selector) {
      const parts = selector.split(",").map((s) => s.trim());
      return elements.filter((el) => parts.some((part) => matchesPart(el, part)));
    },
  };

  return { root, elements, scrollCalls };
}

test("updateActiveHighlight('active-leaf-change') fired AFTER a heading navigation has settled, toward the row it already marked active, does not scroll the Binder again — the exact reported bug", () => {
  const fixture = buildFixture();
  const { view, app } = buildView(fixture);
  useRealActiveHighlight(view);
  const { root, elements, scrollCalls } = makeActiveHighlightFixture([fixture.alpha.path]);
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  // 1-2: navigation heading in flight — a "file-open" fires while
  // _headingNavigationDepth > 0, marking the row active without scrolling
  // (exactly what navigateToHeading()'s own sequence does in production).
  view._headingNavigationDepth = 1;
  view.updateActiveHighlight("file-open");
  assert.ok(elements[0].classes.has("is-active"));
  assert.equal(scrollCalls.count, 0);

  // 3-4: navigation has fully settled.
  view._headingNavigationDepth = 0;

  // 5-6: the LATE, redundant "active-leaf-change" Obsidian still fires
  // once openFileAndSelectRange()/revealLeaf() have completed — the row is
  // already .is-active, so this must not scroll the Binder a second time.
  view.updateActiveHighlight("active-leaf-change");

  assert.ok(elements[0].classes.has("is-active"), "the row must stay active");
  assert.equal(scrollCalls.count, 0, "a redundant active-leaf-change toward an already-active row must never scroll the Binder");
});

test("updateActiveHighlight('active-leaf-change') for a REAL file change (A active, B not yet) still reveals B: scrollIntoView is still called exactly once", () => {
  const fixture = buildFixture();
  const { view, app } = buildView(fixture);
  useRealActiveHighlight(view);
  const { root, elements, scrollCalls } = makeActiveHighlightFixture([fixture.alpha.path, fixture.jump.path]);
  elements[0].addClass("is-active"); // A is the currently active file
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.jump; // the user really switched to B

  view.updateActiveHighlight("active-leaf-change");

  assert.equal(elements[0].classes.has("is-active"), false, "A loses .is-active");
  assert.ok(elements[1].classes.has("is-active"), "B receives .is-active");
  assert.equal(scrollCalls.count, 1, "a real file change must still scroll to reveal the newly active row — Next/previous sheet, another tab, an internal link keep working");
});

test("updateActiveHighlight('active-leaf-change') is a scroll no-op whenever the active path already has .is-active, independent of any heading navigation", () => {
  const fixture = buildFixture();
  const { view, app } = buildView(fixture);
  useRealActiveHighlight(view);
  const { root, elements, scrollCalls } = makeActiveHighlightFixture([fixture.alpha.path]);
  elements[0].addClass("is-active");
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  view.updateActiveHighlight("active-leaf-change");

  assert.ok(elements[0].classes.has("is-active"));
  assert.equal(scrollCalls.count, 0);
});

test("updateActiveHighlight('file-open') keeps its historical scroll behavior unconditionally — the redundant-active-leaf-change optimization is scoped to 'active-leaf-change' only", () => {
  const fixture = buildFixture();
  const { view, app } = buildView(fixture);
  useRealActiveHighlight(view);
  const { root, elements, scrollCalls } = makeActiveHighlightFixture([fixture.alpha.path]);
  elements[0].addClass("is-active"); // already active, exactly like the redundant active-leaf-change case above
  view.contentEl = root;
  app.workspace.getActiveFile = () => fixture.alpha;

  view.updateActiveHighlight("file-open");

  assert.equal(scrollCalls.count, 1, "file-open must scroll regardless of whether the row was already active");
});
