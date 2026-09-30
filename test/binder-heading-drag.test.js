import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

/* GitHub #17 follow-up — heading-to-heading drag & drop (same file, same
 * Markdown level, section + descendants). Same minimal harness style as
 * test/binder-heading-outline.test.js (duplicated per this repo's
 * convention), extended with a controllable `vault.process()` and a real
 * `metadataCache.on("changed")`/`offref()` pub-sub so the MetadataCache-wait
 * behavior can be tested precisely. */

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
}

/** Matches ONE compound selector part (no commas) against a FakeElement:
 * class tokens are ANDed, and `[data-path="X"]` matches the exact VALUE —
 * bracket content is stripped before scanning for classes so a path
 * containing "." (an extension, a folder name…) is never misread as a
 * stray class token. */
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

/*
 * Roman/Manuscrit/
 *   Alpha.md   H1 A / H2 B / H3 C     (three sections, same-level siblings B/C plus A)
 *   Other.md   H1 X                   (a different file, for cross-file tests)
 *   Family.md  H1 A / H2 A1 / H3 A1a / H2 A2 / H1 B / H2 B1   (subtree drag)
 */
function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");

  const alpha = new TFile("Roman/Manuscrit/Alpha.md");
  alpha.basename = "Alpha";
  const other = new TFile("Roman/Manuscrit/Other.md");
  other.basename = "Other";
  const family = new TFile("Roman/Manuscrit/Family.md");
  family.basename = "Family";

  const children = [alpha, other, family];
  root.children = children;
  for (const child of children) child.parent = root;

  const byPath = new Map([[root.path, root], ...children.map((c) => [c.path, c])]);

  const alphaDoc = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "B", body: "b" },
    { level: 3, title: "C", body: "c" },
    { level: 2, title: "D", body: "d" },
  ]);
  const otherDoc = buildDoc([{ level: 1, title: "X", body: "x" }, { level: 2, title: "Y", body: "y" }]);
  const familyDoc = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
    { level: 2, title: "A2", body: "a2" },
    { level: 1, title: "B", body: "b" },
    { level: 2, title: "B1", body: "b1" },
  ]);

  const filesText = new Map([
    [alpha.path, alphaDoc.text],
    [other.path, otherDoc.text],
    [family.path, familyDoc.text],
  ]);
  const headingsByPath = new Map([
    [alpha.path, toMetadataHeadings(alphaDoc.headings)],
    [other.path, toMetadataHeadings(otherDoc.headings)],
    [family.path, toMetadataHeadings(familyDoc.headings)],
  ]);

  return {
    root, alpha, other, family, byPath,
    alphaHeadings: alphaDoc.headings, otherHeadings: otherDoc.headings, familyHeadings: familyDoc.headings,
    filesText, headingsByPath,
  };
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
  const modifyCalls = [];
  const readCalls = [];
  const cachedReadCalls = [];
  let changedRefCounter = 0;
  const changedListeners = new Map();

  const app = {
    vault: {
      getAbstractFileByPath: (path) => byPath.get(path) || null,
      cachedRead: async (file) => { cachedReadCalls.push(file); return filesText.get(file.path) ?? ""; },
      read: async (file) => { readCalls.push(file); return filesText.get(file.path) ?? ""; },
      modify: async (file, data) => { modifyCalls.push({ file, data }); filesText.set(file.path, data); },
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
  const saveSettingsCalls = { count: 0 };
  const getLeafCalls = { count: 0 };
  const dragState = {};
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

  return {
    view, contentEl, app, plugin, settings, multiSelect, saveSettingsCalls, getLeafCalls,
    processCalls, modifyCalls, readCalls, cachedReadCalls, emitMetadataChanged, dragState,
  };
}

function fakeDragEvent(overrides = {}) {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    dataTransfer: { data: {}, setData(k, v) { this.data[k] = v; }, effectAllowed: null, dropEffect: null },
    clientY: 5,
    preventDefault: () => { defaultPrevented = true; },
    stopPropagation: () => { propagationStopped = true; },
    get defaultPrevented() { return defaultPrevented; },
    get propagationStopped() { return propagationStopped; },
    ...overrides,
  };
}

function fire(row, type, event) {
  const handler = row.events.get(type);
  assert.ok(handler, `row has no "${type}" listener`);
  handler(event);
  return event;
}

async function renderWithVisibleFile(view, contentEl, filePath) {
  view._visibleHeadingOutlinePaths.add(filePath);
  await view.render(true);
  return contentEl;
}

// ===== structure: draggable, but still virtual =====

test("a heading row is draggable, but still has no data-path, no tabindex, no role, and never physical classes", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const row = headingRowByText(contentEl, "A");
  assert.equal(row.getAttr("draggable"), "true");
  assert.equal(row.getAttr("data-path"), null);
  assert.equal(row.getAttr("tabindex"), null);
  assert.equal(row.getAttr("role"), null);
  assert.equal(row.classes.has("feuillets-item"), false);
  assert.equal(row.classes.has("feuillets-folder-row"), false);
});

// ===== dragstart =====

test("dragstart sets _headingDragState, the private MIME, and effectAllowed=move — never a physical MIME, never plugin.dragState", async () => {
  const fixture = buildFixture();
  const { view, contentEl, plugin } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const row = headingRowByText(contentEl, "B");
  const b = fixture.alphaHeadings.find((h) => h.text === "B");
  const event = fakeDragEvent();
  fire(row, "dragstart", event);

  assert.equal(view._headingDragState.filePath, fixture.alpha.path);
  assert.equal(view._headingDragState.sourceStartOffset, b.startOffset);
  assert.equal(view._headingDragState.level, 2);
  assert.equal(view._headingDragState.text, "B");
  assert.equal(view._headingDragState.horizontalMode, "move");
  assert.equal(event.dataTransfer.data["application/x-feuillets-heading"], fixture.alpha.path);
  assert.equal(event.dataTransfer.effectAllowed, "move");
  assert.equal(Object.prototype.hasOwnProperty.call(event.dataTransfer.data, "text/plain"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(event.dataTransfer.data, "application/x-feuillets-binder"), false);
  assert.equal(row.classes.has("feuillets-heading-outline-dragging"), true);
  assert.equal(event.propagationStopped, true);

  assert.equal(plugin.dragState, null, "the physical drag system's own state must stay untouched");
  assert.equal(plugin._dragInProgress, false);
  assert.equal(plugin._dragRetryCount, 0);
});

// ===== dragend =====

test("dragend clears _headingDragState and every heading drag/drop class", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const bRow = headingRowByText(contentEl, "B");
  const cRow = headingRowByText(contentEl, "C");
  fire(bRow, "dragstart", fakeDragEvent());
  bRow.addClass("feuillets-heading-outline-drop-before");
  cRow.addClass("feuillets-heading-outline-drop-after");

  fire(bRow, "dragend", fakeDragEvent());

  assert.equal(view._headingDragState, null);
  assert.equal(bRow.classes.has("feuillets-heading-outline-dragging"), false);
  assert.equal(bRow.classes.has("feuillets-heading-outline-drop-before"), false);
  assert.equal(cRow.classes.has("feuillets-heading-outline-drop-after"), false);
});

// ===== dragover: valid same-file/same-level target =====

test("dragover on a valid target, upper half: preventDefault, dropEffect=move, 'before' indicator only", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const bRow = headingRowByText(contentEl, "B");
  const dRow = headingRowByText(contentEl, "D"); // same level as B (H2); C (H3) is B's own descendant
  dRow._rect = { top: 0, height: 20 };
  fire(bRow, "dragstart", fakeDragEvent());

  const overEvent = fakeDragEvent({ clientY: 5 });
  fire(dRow, "dragover", overEvent);
  assert.equal(overEvent.defaultPrevented, true);
  assert.equal(overEvent.dataTransfer.dropEffect, "move");
  assert.equal(dRow.classes.has("feuillets-heading-outline-drop-before"), true);
  assert.equal(dRow.classes.has("feuillets-heading-outline-drop-after"), false);
});

test("dragover: 'before' on the upper half, 'after' on the lower half, never both — using two same-level H2 siblings", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.family.path);

  const a1Row = headingRowByText(contentEl, "A1");
  const a2Row = headingRowByText(contentEl, "A2");
  a2Row._rect = { top: 100, height: 20 };

  fire(a1Row, "dragstart", fakeDragEvent());

  const overEvent = fakeDragEvent({ clientY: 105 }); // upper half of [100, 120)
  fire(a2Row, "dragover", overEvent);
  assert.equal(overEvent.defaultPrevented, true);
  assert.equal(overEvent.dataTransfer.dropEffect, "move");
  assert.equal(a2Row.classes.has("feuillets-heading-outline-drop-before"), true);
  assert.equal(a2Row.classes.has("feuillets-heading-outline-drop-after"), false);

  const overEvent2 = fakeDragEvent({ clientY: 119 }); // lower half
  fire(a2Row, "dragover", overEvent2);
  assert.equal(a2Row.classes.has("feuillets-heading-outline-drop-before"), false);
  assert.equal(a2Row.classes.has("feuillets-heading-outline-drop-after"), true);
});

test("dragleave removes both indicator classes from that row", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.family.path);

  const a1Row = headingRowByText(contentEl, "A1");
  const a2Row = headingRowByText(contentEl, "A2");
  fire(a1Row, "dragstart", fakeDragEvent());
  fire(a2Row, "dragover", fakeDragEvent({ clientY: 5 }));
  assert.ok(a2Row.classes.has("feuillets-heading-outline-drop-before"));

  fire(a2Row, "dragleave", fakeDragEvent());
  assert.equal(a2Row.classes.has("feuillets-heading-outline-drop-before"), false);
  assert.equal(a2Row.classes.has("feuillets-heading-outline-drop-after"), false);
});

// ===== cross-file: refused =====

test("dragover across two different files: no indicator, no preventDefault", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  view._visibleHeadingOutlinePaths.add(fixture.other.path);
  await view.render(true);

  const bRow = headingRowByText(contentEl, "B"); // Alpha, H2
  const yRow = headingRowByText(contentEl, "Y"); // Other, H2 — same level, different file
  fire(bRow, "dragstart", fakeDragEvent());

  const overEvent = fakeDragEvent();
  fire(yRow, "dragover", overEvent);

  assert.equal(overEvent.defaultPrevented, false);
  assert.equal(yRow.classes.has("feuillets-heading-outline-drop-before"), false);
  assert.equal(yRow.classes.has("feuillets-heading-outline-drop-after"), false);
});

test("drop across two different files never calls vault.process", async () => {
  const fixture = buildFixture();
  const { view, contentEl, processCalls } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  view._visibleHeadingOutlinePaths.add(fixture.other.path);
  await view.render(true);

  const bRow = headingRowByText(contentEl, "B");
  const yRow = headingRowByText(contentEl, "Y");
  fire(bRow, "dragstart", fakeDragEvent());
  fire(yRow, "drop", fakeDragEvent());

  await Promise.resolve();
  assert.equal(processCalls.length, 0);
});

// ===== cross-level: refused =====

test("dragover across levels (H2 onto H1, same file): no indicator, no preventDefault", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const bRow = headingRowByText(contentEl, "B"); // H2
  const aRow = headingRowByText(contentEl, "A"); // H1
  fire(bRow, "dragstart", fakeDragEvent());

  const overEvent = fakeDragEvent();
  fire(aRow, "dragover", overEvent);

  assert.equal(overEvent.defaultPrevented, false);
  assert.equal(aRow.classes.has("feuillets-heading-outline-drop-before"), false);
});

test("drop across levels never calls vault.process", async () => {
  const fixture = buildFixture();
  const { view, contentEl, processCalls } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const bRow = headingRowByText(contentEl, "B");
  const aRow = headingRowByText(contentEl, "A");
  fire(bRow, "dragstart", fakeDragEvent());
  fire(aRow, "drop", fakeDragEvent());

  await Promise.resolve();
  assert.equal(processCalls.length, 0);
});

// ===== self-drop: refused =====

test("self-drop (same startOffset): no indicator, no vault.process", async () => {
  const fixture = buildFixture();
  const { view, contentEl, processCalls } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const bRow = headingRowByText(contentEl, "B");
  fire(bRow, "dragstart", fakeDragEvent());

  const overEvent = fakeDragEvent();
  fire(bRow, "dragover", overEvent);
  assert.equal(overEvent.defaultPrevented, false);
  assert.equal(bRow.classes.has("feuillets-heading-outline-drop-before"), false);

  fire(bRow, "drop", fakeDragEvent());
  await Promise.resolve();
  assert.equal(processCalls.length, 0);
});

// ===== real moves: before / after, engine reused =====

test("drop before: moves the source section, uses the 5A engine (verified against filesText), and resolves after MetadataCache 'changed'", async () => {
  const fixture = buildFixture();
  const { view, contentEl, processCalls, emitMetadataChanged } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.family.path);

  const bRow = headingRowByText(contentEl, "B");
  const aRow = headingRowByText(contentEl, "A");
  fire(bRow, "dragstart", fakeDragEvent()); // B (H1) before A (H1)
  aRow._rect = { top: 0, height: 20 };
  fire(aRow, "drop", fakeDragEvent({ clientY: 0 })); // upper half -> before

  await Promise.resolve();
  assert.equal(processCalls.length, 1);
  const expected = buildDoc([
    { level: 1, title: "B", body: "b" },
    { level: 2, title: "B1", body: "b1" },
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
    { level: 2, title: "A2", body: "a2" },
  ]).text;
  assert.equal(fixture.filesText.get(fixture.family.path), expected);

  emitMetadataChanged(fixture.family);
  await Promise.resolve();
  await Promise.resolve();
});

test("drop after: moves the source section past the target's own full section", async () => {
  const fixture = buildFixture();
  const { view, contentEl, processCalls, emitMetadataChanged } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.family.path);

  const a1Row = headingRowByText(contentEl, "A1");
  const b1Row = headingRowByText(contentEl, "B1");
  b1Row._rect = { top: 100, height: 20 };
  fire(a1Row, "dragstart", fakeDragEvent());
  fire(b1Row, "drop", fakeDragEvent({ clientY: 115 })); // lower half -> after

  await Promise.resolve();
  assert.equal(processCalls.length, 1);
  const expected = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A2", body: "a2" },
    { level: 1, title: "B", body: "b" },
    { level: 2, title: "B1", body: "b1" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
  ]).text;
  assert.equal(fixture.filesText.get(fixture.family.path), expected);
  emitMetadataChanged(fixture.family);
  await Promise.resolve();
  await Promise.resolve();
});

// ===== subtree =====

test("dragging an H2 with a descendant carries the descendant along, leaves its H2 sibling behind, and never rewrites any level", async () => {
  const fixture = buildFixture();
  const { view, contentEl, processCalls, emitMetadataChanged } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.family.path);

  const a1Row = headingRowByText(contentEl, "A1");
  const b1Row = headingRowByText(contentEl, "B1");
  b1Row._rect = { top: 100, height: 20 };
  fire(a1Row, "dragstart", fakeDragEvent());
  fire(b1Row, "drop", fakeDragEvent({ clientY: 115 }));

  await Promise.resolve();
  const finalText = fixture.filesText.get(fixture.family.path);
  assert.ok(finalText.includes("## A1\na1\n### A1a\na1a\n"), "A1 and A1a must move together, levels untouched");
  assert.ok(finalText.includes("## A2\na2\n"), "A2 must stay behind, untouched");
  assert.equal(processCalls.length, 1);
  emitMetadataChanged(fixture.family);
  await Promise.resolve();
  await Promise.resolve();
});

// ===== no-op adjacent =====

test("an already-adjacent drop produces no text change and never triggers a re-render", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.family.path);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  // A1 is already immediately before A2 — "A1 before A2" is a genuine no-op.
  const a1Row = headingRowByText(contentEl, "A1");
  const a2Row = headingRowByText(contentEl, "A2");
  a2Row._rect = { top: 0, height: 20 };
  fire(a1Row, "dragstart", fakeDragEvent());
  fire(a2Row, "drop", fakeDragEvent({ clientY: 0 }));

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.filesText.get(fixture.family.path), fixture.familyHeadings && buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
    { level: 2, title: "A2", body: "a2" },
    { level: 1, title: "B", body: "b" },
    { level: 2, title: "B1", body: "b1" },
  ]).text, "the text must remain byte-for-byte identical");
  assert.equal(renderCalls, 0, "a genuine no-op must never trigger a re-render");
});

// ===== stale / invalid MetadataCache =====

test("stale cache offsets that no longer match the current text: moveHeadingSection() returns null, original text kept, no render", async () => {
  const fixture = buildFixture();
  const { view, contentEl, processCalls } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  const bRow = headingRowByText(contentEl, "B");
  const dRow = headingRowByText(contentEl, "D"); // same level as B (H2)
  fire(bRow, "dragstart", fakeDragEvent());
  // Corrupt the cache AFTER dragstart: B's cached span no longer matches
  // its real span in the (untouched) text, simulating a stale MetadataCache.
  fixture.headingsByPath.set(fixture.alpha.path, toMetadataHeadings(
    fixture.alphaHeadings.map((h) => (h.text === "B" ? { ...h, endOffset: h.startOffset } : h))
  ));
  const originalText = fixture.filesText.get(fixture.alpha.path);

  fire(dRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();

  assert.equal(processCalls.length, 1, "vault.process still runs — it needs the current text to determine the outcome");
  assert.equal(fixture.filesText.get(fixture.alpha.path), originalText, "no destructive mutation from an inconsistent cache");
  assert.equal(renderCalls, 0);
});

test("the source heading has disappeared from the fresh cache by drop time: original text kept, no render", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  const bRow = headingRowByText(contentEl, "B");
  const dRow = headingRowByText(contentEl, "D"); // same level as B (H2)
  fire(bRow, "dragstart", fakeDragEvent());
  fixture.headingsByPath.set(fixture.alpha.path, toMetadataHeadings(fixture.alphaHeadings.filter((h) => h.text !== "B")));
  const originalText = fixture.filesText.get(fixture.alpha.path);

  fire(dRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();

  assert.equal(fixture.filesText.get(fixture.alpha.path), originalText);
  assert.equal(renderCalls, 0);
});

test("the target heading has disappeared from the fresh cache by drop time: original text kept, no render", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  const bRow = headingRowByText(contentEl, "B");
  const dRow = headingRowByText(contentEl, "D"); // same level as B (H2)
  fire(bRow, "dragstart", fakeDragEvent());
  fixture.headingsByPath.set(fixture.alpha.path, toMetadataHeadings(fixture.alphaHeadings.filter((h) => h.text !== "D")));
  const originalText = fixture.filesText.get(fixture.alpha.path);

  fire(dRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();

  assert.equal(fixture.filesText.get(fixture.alpha.path), originalText);
  assert.equal(renderCalls, 0);
});

test("the level changed since dragstart (per the fresh cache at drop time): refused, original text kept, no render", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.family.path);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  const a1Row = headingRowByText(contentEl, "A1");
  const a2Row = headingRowByText(contentEl, "A2");
  fire(a1Row, "dragstart", fakeDragEvent()); // captured level = 2
  // The fresh cache now reports A1 at a DIFFERENT level than when the drag started.
  fixture.headingsByPath.set(fixture.family.path, toMetadataHeadings(
    fixture.familyHeadings.map((h) => (h.text === "A1" ? { ...h, level: 3 } : h))
  ));
  const originalText = fixture.filesText.get(fixture.family.path);

  fire(a2Row, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();

  assert.equal(fixture.filesText.get(fixture.family.path), originalText);
  assert.equal(renderCalls, 0);
});

// ===== Vault.process only =====

test("a valid move calls vault.process(); vault.modify()/read()/cachedRead() are never called by the drag path", async () => {
  const fixture = buildFixture();
  const { view, contentEl, processCalls, modifyCalls, readCalls, cachedReadCalls, emitMetadataChanged } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const bRow = headingRowByText(contentEl, "B");
  const dRow = headingRowByText(contentEl, "D"); // same level as B (H2)
  fire(bRow, "dragstart", fakeDragEvent());
  fire(dRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();

  assert.equal(processCalls.length, 1);
  assert.equal(modifyCalls.length, 0);
  assert.equal(readCalls.length, 0);
  assert.equal(cachedReadCalls.length, 0);
  emitMetadataChanged(fixture.alpha);
  await Promise.resolve();
  await Promise.resolve();
});

// ===== waiting for MetadataCache "changed" =====

test("render() is not called until MetadataCache fires 'changed' for the correct file", async () => {
  const fixture = buildFixture();
  const { view, contentEl, emitMetadataChanged } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  const bRow = headingRowByText(contentEl, "B");
  const dRow = headingRowByText(contentEl, "D"); // same level as B (H2), currently AFTER it
  fire(dRow, "dragstart", fakeDragEvent()); // D before B is a genuine change (not already adjacent)
  fire(bRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(renderCalls, 0, "render() must wait for the real MetadataCache refresh");

  emitMetadataChanged(fixture.alpha);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(renderCalls, 1, "render(true) fires exactly once the correct 'changed' event arrives");
});

test("a 'changed' event for a DIFFERENT file does not resolve the wait", async () => {
  const fixture = buildFixture();
  const { view, contentEl, emitMetadataChanged } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  const bRow = headingRowByText(contentEl, "B");
  const dRow = headingRowByText(contentEl, "D"); // same level as B (H2), currently AFTER it
  fire(dRow, "dragstart", fakeDragEvent()); // D before B is a genuine change (not already adjacent)
  fire(bRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();

  emitMetadataChanged(fixture.other);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(renderCalls, 0, "an unrelated file's event must never resolve the wait");

  emitMetadataChanged(fixture.alpha);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(renderCalls, 1);
});

test("a 'changed' event fired BEFORE the mutation actually completes does not resolve the wait; the next one does", async () => {
  const fixture = buildFixture();
  const { view, contentEl, emitMetadataChanged } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };

  // Fire a "changed" event for Alpha BEFORE any drag even starts — this
  // must never be mistaken for the eventual real refresh.
  emitMetadataChanged(fixture.alpha);

  const bRow = headingRowByText(contentEl, "B");
  const dRow = headingRowByText(contentEl, "D"); // same level as B (H2), currently AFTER it
  fire(dRow, "dragstart", fakeDragEvent()); // D before B is a genuine change (not already adjacent)
  fire(bRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();
  assert.equal(renderCalls, 0);

  emitMetadataChanged(fixture.alpha);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(renderCalls, 1);
});

// ===== EventRef cleanup =====

test("the MetadataCache listener is removed after a successful move, a no-op, a null result, and a failed process()", async () => {
  const fixture = buildFixture();

  // A. success
  {
    const { view, contentEl, app, emitMetadataChanged } = buildView(fixture);
    await renderWithVisibleFile(view, contentEl, fixture.alpha.path);
    let offrefCalls = 0;
    const originalOffref = app.metadataCache.offref;
    app.metadataCache.offref = (ref) => { offrefCalls++; originalOffref(ref); };
    const bRow = headingRowByText(contentEl, "B");
    const dRow = headingRowByText(contentEl, "D"); // same level as B (H2), currently AFTER it
    fire(dRow, "dragstart", fakeDragEvent()); // D before B is a genuine change (not already adjacent)
    fire(bRow, "drop", fakeDragEvent({ clientY: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    emitMetadataChanged(fixture.alpha);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(offrefCalls, 1, "success path must remove its listener");
  }

  // B. no-op (already adjacent)
  {
    const { view, contentEl, app } = buildView(fixture);
    await renderWithVisibleFile(view, contentEl, fixture.family.path);
    let offrefCalls = 0;
    const originalOffref = app.metadataCache.offref;
    app.metadataCache.offref = (ref) => { offrefCalls++; originalOffref(ref); };
    const a1Row = headingRowByText(contentEl, "A1");
    const a2Row = headingRowByText(contentEl, "A2");
    a2Row._rect = { top: 0, height: 20 };
    fire(a1Row, "dragstart", fakeDragEvent());
    fire(a2Row, "drop", fakeDragEvent({ clientY: 0 }));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(offrefCalls, 1, "no-op path must still remove its listener");
  }

  // C. null result (level mismatch discovered at drop time)
  {
    const { view, contentEl, app } = buildView(fixture);
    await renderWithVisibleFile(view, contentEl, fixture.family.path);
    let offrefCalls = 0;
    const originalOffref = app.metadataCache.offref;
    app.metadataCache.offref = (ref) => { offrefCalls++; originalOffref(ref); };
    const a1Row = headingRowByText(contentEl, "A1");
    const a2Row = headingRowByText(contentEl, "A2");
    fire(a1Row, "dragstart", fakeDragEvent());
    fixture.headingsByPath.set(fixture.family.path, toMetadataHeadings(
      fixture.familyHeadings.map((h) => (h.text === "A1" ? { ...h, level: 3 } : h))
    ));
    fire(a2Row, "drop", fakeDragEvent({ clientY: 0 }));
    await Promise.resolve();
    assert.equal(offrefCalls, 1, "a null/refused move must still remove its listener");
  }

  // D. vault.process() rejects
  {
    const { view, contentEl, app } = buildView(fixture);
    await renderWithVisibleFile(view, contentEl, fixture.alpha.path);
    app.vault.process = async () => { throw new Error("disk error"); };
    let offrefCalls = 0;
    const originalOffref = app.metadataCache.offref;
    app.metadataCache.offref = (ref) => { offrefCalls++; originalOffref(ref); };
    const bRow = headingRowByText(contentEl, "B");
    const dRow = headingRowByText(contentEl, "D"); // same level as B (H2)
    fire(bRow, "dragstart", fakeDragEvent());
    fire(dRow, "drop", fakeDragEvent({ clientY: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(offrefCalls, 1, "a rejected vault.process() must still remove its listener");
  }
});

test("a rejecting render(true) — AFTER a successful write and the correct MetadataCache event — is not swallowed by the Vault.process() catch, though the EventRef is still cleaned up", async () => {
  const fixture = buildFixture();
  const { view, app, emitMetadataChanged } = buildView(fixture);

  let offrefCalls = 0;
  const originalOffref = app.metadataCache.offref;
  app.metadataCache.offref = (ref) => { offrefCalls++; originalOffref(ref); };

  const renderError = new Error("render sentinel failure");
  view.render = async () => { throw renderError; };

  const b = fixture.alphaHeadings.find((h) => h.text === "B");
  const d = fixture.alphaHeadings.find((h) => h.text === "D"); // same level as B (H2), currently AFTER it

  // D before B is a genuine change (not already adjacent) — calling the
  // method directly (rather than through the drop handler's `void` call)
  // lets this test observe whatever the returned promise actually does.
  const movePromise = view.moveHeadingSectionInFile(fixture.alpha, d.startOffset, b.startOffset, 2, "before");

  await new Promise((resolve) => setTimeout(resolve, 0));
  emitMetadataChanged(fixture.alpha);

  await assert.rejects(movePromise, (err) => err === renderError, "a render(true) failure must propagate, never be treated as success");
  assert.equal(offrefCalls, 1, "the EventRef must still be removed even when render(true) rejects");
});

// ===== outline stays open, rows reflect the new order =====

/** Builds a single-file fixture holding exactly the given `{ level, title,
 * body }` entries — used by the refresh test below, which needs full
 * control over the document to update the fake MetadataCache to the state
 * Obsidian itself would report after reparsing the moved text. */
function buildSingleFileFixture(entries) {
  const root = new TFolder("Roman/Manuscrit");
  const { text, headings } = buildDoc(entries);
  const file = new TFile("Roman/Manuscrit/Order.md");
  file.basename = "Order";
  root.children = [file];
  file.parent = root;
  const byPath = new Map([[root.path, root], [file.path, file]]);
  const filesText = new Map([[file.path, text]]);
  const headingsByPath = new Map([[file.path, toMetadataHeadings(headings)]]);
  return { root, file, byPath, filesText, headingsByPath };
}

test("the outline stays visible after a successful move, and the heading rows reflect the exact new Markdown order (real MetadataCache -> Binder bridge)", async () => {
  const fixture = buildSingleFileFixture([
    { level: 1, title: "A", body: "a" },
    { level: 1, title: "B", body: "b" },
    { level: 1, title: "C", body: "c" },
  ]);
  const { view, contentEl, emitMetadataChanged } = buildView(fixture);
  view._visibleHeadingOutlinePaths.add(fixture.file.path);
  await view.render(true);

  const aRow = headingRowByText(contentEl, "A");
  const cRow = headingRowByText(contentEl, "C");
  fire(cRow, "dragstart", fakeDragEvent()); // C before A is a genuine change
  fire(aRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();

  // The move already produced the new text (C, A, B) in the fake Vault —
  // verify it, then rebuild the fake MetadataCache's headings from that
  // SAME known document (never re-derived from the old cache), exactly as
  // Obsidian would after reparsing the written file. This must happen
  // BEFORE emitMetadataChanged, or the event handler would still be
  // looking at stale offsets.
  const expectedDoc = buildDoc([
    { level: 1, title: "C", body: "c" },
    { level: 1, title: "A", body: "a" },
    { level: 1, title: "B", body: "b" },
  ]);
  assert.equal(fixture.filesText.get(fixture.file.path), expectedDoc.text);
  fixture.headingsByPath.set(fixture.file.path, toMetadataHeadings(expectedDoc.headings));

  emitMetadataChanged(fixture.file);
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(view._visibleHeadingOutlinePaths.has(fixture.file.path), "the outline must never close itself after a drag");
  assert.deepEqual(
    headingRows(contentEl).map((row) => headingText(row)),
    ["C", "A", "B"],
    "the rendered heading rows must reflect the exact new Markdown order, not just exist"
  );
});

// ===== no automatic navigation =====

test("a valid drop never calls getLeafForOpeningFile/openFile/revealLeaf — a drag is pure structure, never navigation", async () => {
  const fixture = buildFixture();
  const { view, contentEl, getLeafCalls, emitMetadataChanged } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const bRow = headingRowByText(contentEl, "B");
  const dRow = headingRowByText(contentEl, "D"); // same level as B (H2), currently AFTER it
  fire(dRow, "dragstart", fakeDragEvent()); // D before B is a genuine change (not already adjacent)
  fire(bRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();
  emitMetadataChanged(fixture.alpha);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(getLeafCalls.count, 0);
});

// ===== click non-regression =====

test("click on a heading row still delegates to navigateToHeading, unaffected by draggable/drag listeners", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await renderWithVisibleFile(view, contentEl, fixture.alpha.path);

  const calls = [];
  view.navigateToHeading = async (file, node) => { calls.push({ file, node }); };
  const bRow = headingRowByText(contentEl, "B");
  const event = fakeDragEvent();
  fire(bRow, "click", event);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, fixture.alpha);
  assert.equal(calls[0].node.text, "B");
});

// ===== split / isolated =====

test("split view: heading rows are draggable in the right files pane, and absent entirely from the left folders pane", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { settingsOverrides: { binderLayout: "split", binderSelectedPath: fixture.root.path } });
  view._visibleHeadingOutlinePaths.add(fixture.alpha.path);
  await view.render(true);

  const listPane = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  assert.ok(listPane);
  assert.ok(treePane);
  assert.ok(headingRows(listPane).length > 0);
  assert.equal(headingRows(listPane).every((r) => r.getAttr("draggable") === "true"), true);
  assert.equal(headingRows(treePane).length, 0);
});

test("isolated Binder root: heading rows are still draggable, and a valid drag still moves the section", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const sub = new TFolder("Roman/Manuscrit/Sub");
  sub.name = "Sub";
  const { text, headings } = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 1, title: "B", body: "b" },
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
  const fixture = { root, byPath, filesText, headingsByPath };

  const { view, contentEl, processCalls, emitMetadataChanged } = buildView(fixture, {
    pluginOverrides: { getWorkspaceFolder: () => sub, setWorkspaceFolder: () => {} },
  });
  view._visibleHeadingOutlinePaths.add(file.path);
  await view.render(true);

  const aRow = headingRowByText(contentEl, "A");
  const bRow = headingRowByText(contentEl, "B");
  assert.equal(aRow.getAttr("draggable"), "true");

  fire(bRow, "dragstart", fakeDragEvent());
  fire(aRow, "drop", fakeDragEvent({ clientY: 0 }));
  await Promise.resolve();
  assert.equal(processCalls.length, 1);
  assert.equal(filesText.get(file.path), buildDoc([
    { level: 1, title: "B", body: "b" },
    { level: 1, title: "A", body: "a" },
  ]).text);
  emitMetadataChanged(file);
  await Promise.resolve();
  await Promise.resolve();
});
