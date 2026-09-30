import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

/* GitHub #17 follow-up — collapse/expand of headings in the Binder's
 * Markdown outline. Same minimal harness style as
 * test/binder-heading-drag.test.js (duplicated per this repo's convention),
 * extended with `parent` tracking and `closest()` on the FakeElement so the
 * chevron-vs-row drag guard can be exercised the same way a real DOM event
 * would report its `target`. */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle) };

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.parent = null;
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
    child.parent = this;
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
  getBoundingClientRect() { return this._rect || { top: 0, height: 20 }; }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs[name] = value; }
  getAttr(name) { return this.attrs[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    const parts = selector.split(",").map((s) => s.trim());
    const matches = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (parts.some((part) => matchesSelectorPart(child, part))) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
  /** Real DOM `closest()`: checks the element itself, then walks up
   * `parent`. Only plain class selectors are needed by production code
   * here (the chevron drag guard), so that is all this supports. */
  closest(selector) {
    const classNames = (selector.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    let el = this;
    while (el) {
      if (classNames.every((c) => el.classes.has(c))) return el;
      el = el.parent;
    }
    return null;
  }
}

function matchesSelectorPart(el, part) {
  const dataMatch = part.match(/\[data-path="([^"]*)"\]/);
  const withoutAttr = part.replace(/\[[^\]]*\]/g, "");
  const classNames = (withoutAttr.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
  const classOk = classNames.every((c) => el.classes.has(c));
  const dataOk = !dataMatch || el.getAttr("data-path") === dataMatch[1];
  return classOk && dataOk;
}

function findAll(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findAll(child, predicate));
  }
  return found;
}

function headingRows(scope) {
  return findAll(scope, (el) => el.classes.has("feuillets-heading-outline-row"));
}

function headingRowByText(scope, text) {
  const row = headingRows(scope).find((r) => findAll(r, (el) => el.classes.has("feuillets-heading-outline-text"))[0]?.text === text);
  assert.ok(row, `no heading row found with text "${text}"`);
  return row;
}

function headingText(row) {
  return findAll(row, (el) => el.classes.has("feuillets-heading-outline-text"))[0]?.text;
}

function chevronOf(row) {
  return findAll(row, (el) => el.classes.has("feuillets-heading-outline-chevron"))[0] ?? null;
}

function spacerOf(row) {
  return findAll(row, (el) => el.classes.has("feuillets-heading-outline-chevron-spacer"))[0] ?? null;
}

function guidesOf(row) {
  return findAll(row, (el) => el.classes.has("feuillets-heading-outline-guide"));
}

function itemNameSpan(scope, basename) {
  // The name text is `${numbering} ${title}` — numbering is empty in these
  // fixtures, but the leading space is still there, so match by suffix.
  const span = findAll(scope, (el) => el.classes.has("feuillets-item-name")).find((el) => el.text?.trim() === basename);
  assert.ok(span, `no file name span found for "${basename}"`);
  return span;
}

/** Builds a flat Markdown document plus its `HeadingOutlineInput[]` from an
 * ordered list of `{ level, title, body? }` entries — offsets computed by
 * the builder itself as it writes, never guessed (same convention as
 * test/heading-section-move.test.js). */
function buildDoc(entries) {
  let text = "";
  const headings = [];
  entries.forEach((entry) => {
    const headingLine = `${"#".repeat(entry.level)} ${entry.title}`;
    const startOffset = text.length;
    text += headingLine;
    const endOffset = text.length;
    headings.push({ text: entry.title, level: entry.level, startOffset, endOffset });
    if (entry.body !== undefined) text += "\n" + entry.body;
    text += "\n";
  });
  return { text, headings };
}

function toMetadataHeadings(headings) {
  return headings.map((h) => ({
    heading: h.text,
    level: h.level,
    position: { start: { line: 0, col: 0, offset: h.startOffset }, end: { line: 0, col: 0, offset: h.endOffset } },
  }));
}

/** Builds a single-file fixture holding exactly the given `{ level, title,
 * body }` entries — every collapse test controls its own document shape, so
 * this stays a small self-contained builder rather than the multi-file
 * fixture used by the drag tests. */
function buildFixture(entries, { fileName = "Order.md", basename = "Order" } = {}) {
  const root = new TFolder("Roman/Manuscrit");
  const { text, headings } = buildDoc(entries);
  const file = new TFile(`Roman/Manuscrit/${fileName}`);
  file.basename = basename;
  root.children = [file];
  file.parent = root;
  const byPath = new Map([[root.path, root], [file.path, file]]);
  const filesText = new Map([[file.path, text]]);
  const headingsByPath = new Map([[file.path, toMetadataHeadings(headings)]]);
  return { root, file, headings, byPath, filesText, headingsByPath };
}

function buildView(fixture, { settingsOverrides = {}, pluginOverrides = {} } = {}) {
  const { root, byPath, filesText, headingsByPath } = fixture;
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

  const processCalls = [];
  let changedRefCounter = 0;
  const changedListeners = new Map();

  const app = {
    vault: {
      getAbstractFileByPath: (path) => byPath.get(path) || null,
      cachedRead: async (file) => filesText.get(file.path) ?? "",
      read: async (file) => filesText.get(file.path) ?? "",
      modify: async (file, data) => { filesText.set(file.path, data); },
      process: async (file, fn) => {
        const current = filesText.get(file.path) ?? "";
        const next = fn(current);
        filesText.set(file.path, next);
        processCalls.push({ file, next });
        return next;
      },
      create: async () => { throw new Error("a heading drag must never create a file"); },
      getRoot: () => vaultRoot,
    },
    metadataCache: {
      getFileCache: (file) => {
        const headings = headingsByPath.get(file.path);
        return headings ? { headings } : { frontmatter: {} };
      },
      on: (event, callback) => {
        assert.equal(event, "changed", "only the 'changed' event is expected from a heading drag");
        const ref = { id: ++changedRefCounter };
        changedListeners.set(ref, callback);
        return ref;
      },
      offref: (ref) => { changedListeners.delete(ref); },
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

  function emitMetadataChanged(file) {
    for (const callback of [...changedListeners.values()]) callback(file, filesText.get(file.path) ?? "", { headings: headingsByPath.get(file.path) });
  }

  const multiSelect = new Set();
  const getLeafCalls = { count: 0 };
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
    saveSettings: async () => {},
    generateCanvasBoard() {},
    getLeafForOpeningFile: () => { getLeafCalls.count++; return workLeaf; },
    getStatusColor: () => null,
    folderNoteFor: () => null,
    folderGoal: () => 0,
    _binderMultiSelect: multiSelect,
    dragState: null,
    _dragInProgress: false,
    _dragRetryCount: 0,
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

  return { view, contentEl, app, plugin, settings, multiSelect, getLeafCalls, processCalls, emitMetadataChanged };
}

function fakeDragEvent(overrides = {}) {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    dataTransfer: { data: {}, setData(k, v) { this.data[k] = v; }, effectAllowed: null, dropEffect: null },
    clientY: 5,
    target: null,
    preventDefault: () => { defaultPrevented = true; },
    stopPropagation: () => { propagationStopped = true; },
    get defaultPrevented() { return defaultPrevented; },
    get propagationStopped() { return propagationStopped; },
    ...overrides,
  };
}

function fakeClickEvent(overrides = {}) {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    preventDefault: () => { defaultPrevented = true; },
    stopPropagation: () => { propagationStopped = true; },
    get defaultPrevented() { return defaultPrevented; },
    get propagationStopped() { return propagationStopped; },
    ...overrides,
  };
}

function fakeDblclickEvent(overrides = {}) {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => { defaultPrevented = true; },
    stopPropagation: () => { propagationStopped = true; },
    get defaultPrevented() { return defaultPrevented; },
    get propagationStopped() { return propagationStopped; },
    ...overrides,
  };
}

function fire(el, type, event) {
  const handler = el.events.get(type);
  assert.ok(handler, `element has no "${type}" listener`);
  handler(event);
  return event;
}

async function renderWithVisibleFile(view, contentEl, filePath) {
  view._visibleHeadingOutlinePaths.add(filePath);
  await view.render(true);
  return contentEl;
}

// ===== default state =====

test("every heading is expanded by default, and the collapsed-keys set starts empty", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous", "Petit"]);
  assert.equal(view._collapsedHeadingKeys.size, 0);
});

// ===== chevron presence and alignment =====

test("a heading with children gets a real chevron; a leaf heading gets a spacer of the same role, and siblings at the same depth stay aligned", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
    { level: 2, title: "Feuille", body: "f" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const grandRow = headingRowByText(contentEl, "Grand");
  const sousRow = headingRowByText(contentEl, "Sous");
  const petitRow = headingRowByText(contentEl, "Petit");
  const feuilleRow = headingRowByText(contentEl, "Feuille");

  assert.ok(chevronOf(grandRow), "Grand has children: real chevron");
  assert.equal(spacerOf(grandRow), null);
  assert.ok(chevronOf(sousRow), "Sous has children: real chevron");
  assert.equal(spacerOf(sousRow), null);

  assert.equal(chevronOf(petitRow), null, "Petit is a leaf: no active chevron");
  assert.ok(spacerOf(petitRow), "Petit still reserves the column");

  assert.equal(chevronOf(feuilleRow), null, "Feuille is a leaf: no active chevron");
  assert.ok(spacerOf(feuilleRow), "Feuille still reserves the column");

  // Sous and Feuille are both direct children of Grand — same relative depth.
  assert.equal(
    sousRow.style._props["--feuillets-heading-outline-depth"],
    feuilleRow.style._props["--feuillets-heading-outline-depth"]
  );
});

// ===== collapsing =====

test("collapsing a mid-level heading hides only its own descendants", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
    { level: 2, title: "Feuille", body: "f" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(chevronOf(headingRowByText(contentEl, "Sous")), "click", fakeClickEvent());
  await Promise.resolve();

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous", "Feuille"]);
});

test("collapsing the root heading hides every descendant, keeping only the root row", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(chevronOf(headingRowByText(contentEl, "Grand")), "click", fakeClickEvent());
  await Promise.resolve();

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand"]);
});

test("re-expanding a heading restores every child that was not itself individually collapsed", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(chevronOf(headingRowByText(contentEl, "Grand")), "click", fakeClickEvent());
  await Promise.resolve();
  fire(chevronOf(headingRowByText(contentEl, "Grand")), "click", fakeClickEvent());
  await Promise.resolve();

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous", "Petit"]);
});

test("nested collapse state is preserved: collapsing then re-expanding a parent never clears its descendant's own collapsed state", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(chevronOf(headingRowByText(contentEl, "Sous")), "click", fakeClickEvent()); // collapse Sous
  await Promise.resolve();
  fire(chevronOf(headingRowByText(contentEl, "Grand")), "click", fakeClickEvent()); // collapse Grand
  await Promise.resolve();
  fire(chevronOf(headingRowByText(contentEl, "Grand")), "click", fakeClickEvent()); // re-expand Grand
  await Promise.resolve();

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous"]);
});

// ===== chevron vs. text click =====

test("clicking the chevron never navigates; clicking the text still navigates exactly as before", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const navigateCalls = [];
  view.navigateToHeading = async (file, node) => { navigateCalls.push(node.text); };

  fire(chevronOf(headingRowByText(contentEl, "Grand")), "click", fakeClickEvent());
  await Promise.resolve();
  assert.deepEqual(navigateCalls, [], "the chevron click must never call navigateToHeading");
  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand"], "the click did collapse Grand");

  fire(headingRowByText(contentEl, "Grand"), "click", fakeClickEvent());
  await Promise.resolve();
  assert.deepEqual(navigateCalls, ["Grand"], "a click on the row/text must still navigate");
});

// ===== chevron vs. drag =====

test("a dragstart whose target is inside the chevron is refused: preventDefault(), no heading drag state, no MIME set", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const { view, contentEl, plugin } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const row = headingRowByText(contentEl, "Grand");
  const chevron = chevronOf(row);
  const event = fakeDragEvent({ target: chevron });
  fire(row, "dragstart", event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(view._headingDragState, null);
  assert.equal(Object.keys(event.dataTransfer.data).length, 0, "no MIME must be set for a chevron-originated drag");
  assert.equal(plugin.dragState, null);
});

test("a dragstart whose target is the row itself (outside the chevron) still works exactly as it did before the collapse feature", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const row = headingRowByText(contentEl, "Grand");
  const event = fakeDragEvent({ target: row });
  fire(row, "dragstart", event);

  assert.equal(event.defaultPrevented, false);
  assert.ok(view._headingDragState);
  assert.equal(view._headingDragState.filePath, fixture.file.path);
  assert.equal(event.dataTransfer.data["application/x-feuillets-heading"], fixture.file.path);
});

// ===== duplicate headings =====

test("two headings with identical level and text get distinct collapse keys: collapsing the first never affects the second", async () => {
  const fixture = buildFixture([
    { level: 2, title: "Section", body: "s1" },
    { level: 3, title: "Premier enfant", body: "p1" },
    { level: 2, title: "Section", body: "s2" },
    { level: 3, title: "Second enfant", body: "p2" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const sectionRows = headingRows(contentEl).filter((row) => headingText(row) === "Section");
  assert.equal(sectionRows.length, 2);
  fire(chevronOf(sectionRows[0]), "click", fakeClickEvent());
  await Promise.resolve();

  assert.deepEqual(
    headingRows(contentEl).map((row) => headingText(row)),
    ["Section", "Section", "Second enfant"],
    "only the first Section's child is hidden"
  );
});

// ===== survives ordinary rerenders and offset changes =====

test("a plain render(true) never re-expands a collapsed heading", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(chevronOf(headingRowByText(contentEl, "Grand")), "click", fakeClickEvent());
  await Promise.resolve();
  await view.render(true);

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand"]);
});

test("a MetadataCache refresh that reports the SAME file/level/text/occurrence with DIFFERENT offsets never re-expands a collapsed heading — this is exactly why the key is not startOffset-based", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(chevronOf(headingRowByText(contentEl, "Sous")), "click", fakeClickEvent());
  await Promise.resolve();

  // Same file/level/text/occurrence, but every offset shifted — simulating
  // an unrelated MetadataCache refresh (e.g. text inserted earlier in the
  // file) that never touched this heading's identity.
  const shifted = fixture.headings.map((h) => ({ ...h, startOffset: h.startOffset + 100, endOffset: h.endOffset + 100 }));
  fixture.headingsByPath.set(fixture.file.path, toMetadataHeadings(shifted));

  await view.render(true);

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous"]);
});

// ===== hide/show the whole file structure =====

test("toggling the whole file's outline off then on again preserves every collapse state in between", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(chevronOf(headingRowByText(contentEl, "Sous")), "click", fakeClickEvent());
  await Promise.resolve();

  view._visibleHeadingOutlinePaths.delete(fixture.file.path);
  await view.render(true);
  assert.equal(headingRows(contentEl).length, 0, "the outline is hidden");
  assert.equal(view._collapsedHeadingKeys.size, 1, "the collapse state itself must survive being hidden");

  view._visibleHeadingOutlinePaths.add(fixture.file.path);
  await view.render(true);

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous"]);
});

// ===== drag of a collapsed parent =====

test("dragging a collapsed heading moves its full section, descendants included, even though they were never rendered", async () => {
  const fixture = buildFixture([
    { level: 2, title: "A", body: "a" },
    { level: 3, title: "A1", body: "a1" },
    { level: 3, title: "A2", body: "a2" },
    { level: 2, title: "B", body: "b" },
    { level: 2, title: "C", body: "c" },
  ]);
  const { view, contentEl, processCalls, emitMetadataChanged } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(chevronOf(headingRowByText(contentEl, "A")), "click", fakeClickEvent());
  await Promise.resolve();
  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["A", "B", "C"]);

  const aRow = headingRowByText(contentEl, "A");
  const cRow = headingRowByText(contentEl, "C");
  cRow._rect = { top: 100, height: 20 };
  fire(aRow, "dragstart", fakeDragEvent({ target: aRow }));
  fire(cRow, "drop", fakeDragEvent({ target: cRow, clientY: 115 })); // lower half of C -> after
  await Promise.resolve();

  assert.equal(processCalls.length, 1);
  const expectedText = buildDoc([
    { level: 2, title: "B", body: "b" },
    { level: 2, title: "C", body: "c" },
    { level: 2, title: "A", body: "a" },
    { level: 3, title: "A1", body: "a1" },
    { level: 3, title: "A2", body: "a2" },
  ]).text;
  assert.equal(fixture.filesText.get(fixture.file.path), expectedText, "A1 and A2 must travel with A even though they were hidden");

  // Bring the fake MetadataCache to the state Obsidian would report after
  // reparsing the new text, then let the real refresh -> render bridge run.
  const expectedDoc = buildDoc([
    { level: 2, title: "B", body: "b" },
    { level: 2, title: "C", body: "c" },
    { level: 2, title: "A", body: "a" },
    { level: 3, title: "A1", body: "a1" },
    { level: 3, title: "A2", body: "a2" },
  ]);
  fixture.headingsByPath.set(fixture.file.path, toMetadataHeadings(expectedDoc.headings));
  emitMetadataChanged(fixture.file);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(
    headingRows(contentEl).map((row) => headingText(row)),
    ["B", "C", "A"],
    "A stays collapsed after the move — A1/A2 must not reappear"
  );
});

// ===== simple / rerender combination =====

test("a plain render(true) called directly never re-expands a collapsed heading (non-drag path)", async () => {
  const fixture = buildFixture([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(chevronOf(headingRowByText(contentEl, "A")), "click", fakeClickEvent());
  await Promise.resolve();
  await view.render(true);
  await view.render(true);

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["A"]);
});

// ===== split / isolated =====

test("split view: chevrons render and collapse works in the right files pane; the left folders pane never shows any heading", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const { view, contentEl } = buildView(fixture, {
    settingsOverrides: { binderLayout: "split", binderSelectedPath: fixture.root.path },
  });
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const listPane = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  assert.ok(listPane);
  assert.ok(treePane);
  assert.equal(headingRows(treePane).length, 0);

  const chevron = chevronOf(headingRowByText(listPane, "Grand"));
  assert.ok(chevron);
  fire(chevron, "click", fakeClickEvent());
  await Promise.resolve();

  // render(true) rebuilds the pane from scratch under contentEl — the
  // pre-click `listPane` reference is now detached, so re-query it.
  const listPaneAfter = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  assert.deepEqual(headingRows(listPaneAfter).map((row) => headingText(row)), ["Grand"]);
});

test("isolated Binder root: collapse works, and neither the indentation formula nor the drop indicator classes are touched", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const sub = new TFolder("Roman/Manuscrit/Sub");
  sub.name = "Sub";
  const { text, headings } = buildDoc([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const file = new TFile("Roman/Manuscrit/Sub/File.md");
  file.basename = "File";
  sub.children = [file];
  file.parent = sub;
  root.children = [sub];
  sub.parent = root;

  const byPath = new Map([[root.path, root], [sub.path, sub], [file.path, file]]);
  const filesText = new Map([[file.path, text]]);
  const headingsByPath = new Map([[file.path, toMetadataHeadings(headings)]]);
  const fixture = { root, file, headings, byPath, filesText, headingsByPath };

  const { view, contentEl } = buildView(fixture, {
    pluginOverrides: { getWorkspaceFolder: () => sub, setWorkspaceFolder: () => {} },
  });
  await renderWithVisibleFile(view, contentEl, file.path);

  const grandRow = headingRowByText(contentEl, "Grand");
  const depthBefore = grandRow.style._props["--feuillets-binder-depth"];

  fire(chevronOf(grandRow), "click", fakeClickEvent());
  await Promise.resolve();

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand"]);
  const grandRowAfter = headingRowByText(contentEl, "Grand");
  assert.equal(grandRowAfter.style._props["--feuillets-binder-depth"], depthBefore, "indentation formula untouched");
  assert.equal(grandRowAfter.classes.has("feuillets-heading-outline-drop-before"), false);
  assert.equal(grandRowAfter.classes.has("feuillets-heading-outline-drop-after"), false);
});

// ===== row budget =====

test("a collapsed parent's hidden descendants are never rendered, so they never consume a row of the Binder's row budget", async () => {
  const entries = [{ level: 1, title: "Parent", body: "p" }];
  for (let i = 0; i < 50; i++) entries.push({ level: 2, title: `Child ${i}`, body: `c${i}` });
  const fixture = buildFixture(entries);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  assert.equal(headingRows(contentEl).length, 51, "expanded: parent + 50 children");

  fire(chevronOf(headingRowByText(contentEl, "Parent")), "click", fakeClickEvent());
  await Promise.resolve();

  assert.equal(headingRows(contentEl).length, 1, "collapsed: only the parent row is ever created");
});

// ===== double-click on the file name =====

test("double-clicking a file's name (structure currently hidden) makes it visible", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await view.render(true); // outline NOT added to _visibleHeadingOutlinePaths

  assert.equal(headingRows(contentEl).length, 0);
  fire(itemNameSpan(contentEl, fixture.file.basename), "dblclick", fakeDblclickEvent());
  await Promise.resolve();

  assert.ok(view._visibleHeadingOutlinePaths.has(fixture.file.path));
  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous"]);
});

test("double-clicking a file's name (structure currently visible) hides it", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);
  assert.ok(headingRows(contentEl).length > 0);

  fire(itemNameSpan(contentEl, fixture.file.basename), "dblclick", fakeDblclickEvent());
  await Promise.resolve();

  assert.equal(view._visibleHeadingOutlinePaths.has(fixture.file.path), false);
  assert.equal(headingRows(contentEl).length, 0);
});

test("double-clicking the name of a file with no headings is a structural no-op: the set stays untouched, nothing throws", async () => {
  const fixture = buildFixture([]);
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  fire(itemNameSpan(contentEl, fixture.file.basename), "dblclick", fakeDblclickEvent());
  await Promise.resolve();

  assert.equal(view._visibleHeadingOutlinePaths.has(fixture.file.path), false);
  assert.equal(headingRows(contentEl).length, 0);
});

test("a double-click on the file's name while a modifier key is held never toggles the outline, respecting any historical modifier gesture", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  for (const modifier of ["altKey", "shiftKey", "ctrlKey", "metaKey"]) {
    const event = fakeDblclickEvent({ [modifier]: true });
    fire(itemNameSpan(contentEl, fixture.file.basename), "dblclick", event);
    await Promise.resolve();
    assert.equal(view._visibleHeadingOutlinePaths.has(fixture.file.path), false, `${modifier} must never trigger the toggle`);
    assert.equal(event.defaultPrevented, false, `${modifier} must not intercept the event`);
  }
});

test("the file context menu action and a double-click on the name flip the exact same _visibleHeadingOutlinePaths set", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  // Drive the menu path directly against a minimal fake Menu, the same
  // shape showFileContextMenu builds items against.
  const menuItems = [];
  const fakeMenu = {
    addItem: (build) => {
      const item = {
        setTitle: () => item,
        setIcon: () => item,
        onClick: (fn) => { item._onClick = fn; return item; },
      };
      build(item);
      menuItems.push(item);
    },
  };
  view.headingOutlineContextMenuExtras(fixture.file)(fakeMenu);
  assert.equal(menuItems.length, 1);

  menuItems[0]._onClick();
  await Promise.resolve();
  assert.ok(view._visibleHeadingOutlinePaths.has(fixture.file.path), "the menu path made it visible");

  fire(itemNameSpan(contentEl, fixture.file.basename), "dblclick", fakeDblclickEvent());
  await Promise.resolve();
  assert.equal(view._visibleHeadingOutlinePaths.has(fixture.file.path), false, "the dblclick path hid it back — same Set");
});

// ===== double-click on a heading's text =====

test("double-clicking a parent heading's text toggles its collapse exactly like the chevron", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const grandText = findAll(headingRowByText(contentEl, "Grand"), (el) => el.classes.has("feuillets-heading-outline-text"))[0];
  fire(grandText, "dblclick", fakeDblclickEvent());
  await Promise.resolve();

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand"]);

  const grandTextAfter = findAll(headingRowByText(contentEl, "Grand"), (el) => el.classes.has("feuillets-heading-outline-text"))[0];
  fire(grandTextAfter, "dblclick", fakeDblclickEvent());
  await Promise.resolve();

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous", "Petit"]);
});

test("a leaf heading's text has no dblclick listener at all — no collapse is even possible to trigger", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const sousText = findAll(headingRowByText(contentEl, "Sous"), (el) => el.classes.has("feuillets-heading-outline-text"))[0];
  assert.equal(sousText.events.has("dblclick"), false, "a leaf heading gets no dblclick listener");

  assert.equal(view._collapsedHeadingKeys.size, 0);
  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous"]);
});

test("the chevron click and a double-click on the text share exactly the same collapsed state, in either order", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const textOf = () => findAll(headingRowByText(contentEl, "Grand"), (el) => el.classes.has("feuillets-heading-outline-text"))[0];

  // dblclick text -> collapse, then chevron click -> expand.
  fire(textOf(), "dblclick", fakeDblclickEvent());
  await Promise.resolve();
  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand"]);
  fire(chevronOf(headingRowByText(contentEl, "Grand")), "click", fakeClickEvent());
  await Promise.resolve();
  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous"]);

  // chevron click -> collapse, then dblclick text -> expand.
  fire(chevronOf(headingRowByText(contentEl, "Grand")), "click", fakeClickEvent());
  await Promise.resolve();
  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand"]);
  fire(textOf(), "dblclick", fakeDblclickEvent());
  await Promise.resolve();
  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous"]);
});

test("double-click nested collapse: collapsing Sous then Grand by double-click, then re-expanding Grand by double-click, leaves Sous collapsed", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const textOf = (title) => findAll(headingRowByText(contentEl, title), (el) => el.classes.has("feuillets-heading-outline-text"))[0];

  fire(textOf("Sous"), "dblclick", fakeDblclickEvent());
  await Promise.resolve();
  fire(textOf("Grand"), "dblclick", fakeDblclickEvent());
  await Promise.resolve();
  fire(textOf("Grand"), "dblclick", fakeDblclickEvent());
  await Promise.resolve();

  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous"]);
});

test("hiding then re-showing the file's whole outline (via double-click on the name) preserves a heading collapsed via double-click", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  fire(findAll(headingRowByText(contentEl, "Sous"), (el) => el.classes.has("feuillets-heading-outline-text"))[0], "dblclick", fakeDblclickEvent());
  await Promise.resolve();

  fire(itemNameSpan(contentEl, fixture.file.basename), "dblclick", fakeDblclickEvent());
  await Promise.resolve();
  assert.equal(headingRows(contentEl).length, 0);

  fire(itemNameSpan(contentEl, fixture.file.basename), "dblclick", fakeDblclickEvent());
  await Promise.resolve();
  assert.deepEqual(headingRows(contentEl).map((row) => headingText(row)), ["Grand", "Sous"]);
});

// ===== hierarchy guides =====

test("guides: a root heading draws none, a depth-2 heading draws exactly one, a depth-3 heading draws exactly two — matching the ancestor chain, never the raw Markdown level", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 4, title: "Petit", body: "p" }, // jumps H2 -> H4, still depth 3 in the computed tree
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  assert.equal(guidesOf(headingRowByText(contentEl, "Grand")).length, 0);
  assert.equal(guidesOf(headingRowByText(contentEl, "Sous")).length, 1);
  assert.equal(guidesOf(headingRowByText(contentEl, "Petit")).length, 2, "computed depth is 3, not the raw H4 level");
});

test("guides carry no data-path, no tabindex, no draggable, no role, and never .feuillets-item/.feuillets-folder-row", async () => {
  const fixture = buildFixture([
    { level: 1, title: "Grand", body: "g" },
    { level: 2, title: "Sous", body: "s" },
    { level: 3, title: "Petit", body: "p" },
  ]);
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.file.path);

  const guides = guidesOf(headingRowByText(contentEl, "Petit"));
  assert.ok(guides.length > 0);
  for (const guide of guides) {
    assert.equal(guide.getAttr("data-path"), null);
    assert.equal(guide.getAttr("tabindex"), null);
    assert.equal(guide.getAttr("draggable"), null);
    assert.equal(guide.getAttr("role"), null);
    assert.equal(guide.classes.has("feuillets-item"), false);
    assert.equal(guide.classes.has("feuillets-folder-row"), false);
  }
});
