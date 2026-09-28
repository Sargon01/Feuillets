import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { openFileActivating } from "../src/utils/dom.js";

/* Bug fix "unstable Binder focus after a single click": the Binder used to
 * reclaim keyboard focus via an ARBITRARY 60ms setTimeout after
 * openFileActivating() — a race against the real (asynchronous) end of
 * leaf.openFile(). The fix chains on the real Promise openFileActivating()
 * now returns, then one requestAnimationFrame, before focusing the exact
 * clicked row. Same minimal harness as test/binder-continu-membership.test.js
 * (duplicated per this repo's convention), with a MANUALLY controlled
 * leaf.openFile() so the race can be demonstrated deterministically. */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
  requestAnimationFrame: (cb) => { cb(); return 0; },
};

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = {};
    this.text = options.text ?? "";
    this.style = { setProperty() {} };
    this.focusCalls = [];
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
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  scrollIntoView() {}
  focus(opts) { this.focusCalls.push(opts); }
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

function baseSettings(overrides = {}) {
  return {
    projectFolder: "",
    projects: [],
    projectMeta: {},
    binderLayout: "tree",
    binderCompact: false,
    binderTreeWidth: 240,
    collapsed: {},
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    ...overrides,
  };
}

function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");
  const a = new TFile("Roman/Manuscrit/A.md");
  const b = new TFile("Roman/Manuscrit/B.md");
  a.basename = "A";
  b.basename = "B";
  root.children = [a, b];
  a.parent = root;
  b.parent = root;
  return { root, a, b };
}

/** `openFile` is controlled from the outside — `openFileControl.resolve()`
 * only settles it once called, so a test can assert on the exact state
 * BEFORE and AFTER the real file open genuinely completes. */
function buildView(fixture) {
  const { root, a, b } = fixture;
  const settings = baseSettings({ projectFolder: root.path, binderSelectedPath: root.path });
  const contentEl = new FakeElement();
  let resolveOpenFile;
  const openFileControl = {
    promise: new Promise((resolve) => { resolveOpenFile = resolve; }),
    resolve: () => resolveOpenFile(),
  };
  const openFileCalls = [];
  const leaf = {
    openFile: (file) => {
      openFileCalls.push(file.path);
      return openFileControl.promise;
    },
  };
  const getLeafForOpeningFileCalls = [];
  const setActiveLeafCalls = [];
  const revealLeafCalls = [];
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [a, b],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Roman",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    getLeafForOpeningFile: () => { getLeafForOpeningFileCalls.push(true); return leaf; },
  };
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: {} };
  const app = {
    vault: { getAbstractFileByPath: (path) => (path === root.path ? root : null) },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: {
      leftSplit: { name: "left" },
      rightSplit: { name: "right" },
      rootSplit,
      getLeavesOfType: () => [],
      getActiveViewOfType: () => null,
      getMostRecentLeaf: (splitRoot) => (splitRoot === rootSplit ? workLeaf : null),
      setActiveLeaf: (l, opts) => setActiveLeafCalls.push([l, opts]),
      revealLeaf: async (l) => { revealLeafCalls.push(l); },
      getLeaf: (kind) => { throw new Error(`getLeaf("${kind}") must never be called — no new leaf`); },
    },
  };
  const view = new FeuilletsView({ app, contentEl }, plugin);
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  return { view, contentEl, plugin, leaf, openFileControl, openFileCalls, getLeafForOpeningFileCalls, setActiveLeafCalls, revealLeafCalls };
}

function itemFor(contentEl, path) {
  return contentEl.querySelectorAll(".feuillets-item[data-path]").find((el) => el.getAttr("data-path") === path);
}

test("Test A — the Binder does not reclaim focus before the real openFile() resolves, and focuses the clicked row exactly once right after", async () => {
  const fixture = buildFixture();
  const h = buildView(fixture);
  await h.view.render(true);
  const itemA = itemFor(h.contentEl, fixture.a.path);
  assert.ok(itemA, "the row for A.md must exist");

  itemA.events.get("click")({});

  // openFile() is still pending: focus must NOT have been reclaimed yet.
  assert.deepEqual(itemA.focusCalls, [], "no focus reclaim before the real file open completes");

  h.openFileControl.resolve();
  await h.openFileControl.promise;
  // Flush the microtask queue so the .then() continuation (which schedules
  // requestAnimationFrame, itself synchronous in this test's stub) actually runs.
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(itemA.focusCalls.length, 1, "the clicked row is focused exactly once, after the real open completes");
  assert.deepEqual(itemA.focusCalls[0], { preventScroll: true });
});

test("Test B — the arbitrary 60ms setTimeout for the single-click focus reclaim no longer exists", () => {
  const source = readFileSync(resolve(process.cwd(), "src/views/feuillets-view.ts"), "utf8");
  // Scoped to the single-click handler itself (from openFileActivating's
  // call through the end of the click listener) — the UNRELATED ArrowUp/
  // ArrowDown keyboard-navigation handler elsewhere in this file still
  // legitimately uses its own 60ms setTimeout + the same querySelector, and
  // must stay untouched (out of scope for this bug fix).
  const clickHandlerStart = source.indexOf("const opening = openFileActivating(this.app, leaf, file);");
  assert.notEqual(clickHandlerStart, -1, "the single-click handler's openFileActivating() call must exist");
  const clickHandlerEnd = source.indexOf("if (!effectivelyHidden) {", clickHandlerStart);
  const clickHandler = source.slice(clickHandlerStart, clickHandlerEnd);

  assert.doesNotMatch(clickHandler, /querySelector<HTMLElement>\(".feuillets-item\.is-active"\)\?\.focus\(\)/);
  assert.doesNotMatch(clickHandler, /,\s*60\)/, "no more arbitrary 60ms delay for the focus reclaim");
  assert.match(clickHandler, /opening\.then\(\(\) => \{/, "chains on the real openFileActivating() Promise instead");
  assert.match(clickHandler, /window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(clickHandler, /item\.focus\(\{ preventScroll: true \}\)/);
});

test("Test C — openFileActivating() still calls setActiveLeaf({ focus: true }) synchronously, its only new contract is returning the openFile() Promise", async () => {
  const openFileCalls = [];
  let resolveOpenFile;
  const opening = new Promise((resolve) => { resolveOpenFile = resolve; });
  const leaf = { openFile: (file, opts) => { openFileCalls.push([file, opts]); return opening; } };
  const setActiveLeafCalls = [];
  const app = { workspace: { setActiveLeaf: (l, opts) => setActiveLeafCalls.push([l, opts]) } };
  const file = new TFile("Roman/Manuscrit/A.md");

  const result = openFileActivating(app, leaf, file);

  // setActiveLeaf({ focus: true }) already happened, even though openFile()
  // has not resolved yet — same historical ordering as before.
  assert.equal(setActiveLeafCalls.length, 1);
  assert.deepEqual(setActiveLeafCalls[0], [leaf, { focus: true }]);
  assert.deepEqual(openFileCalls[0], [file, { active: true }]);

  assert.equal(result, opening, "returns the exact Promise produced by leaf.openFile()");
  resolveOpenFile();
  await result;
});

test("Test D — the single click reuses the same leaf from getLeafForOpeningFile(); no new leaf is ever created", async () => {
  const fixture = buildFixture();
  const h = buildView(fixture);
  await h.view.render(true);
  const itemA = itemFor(h.contentEl, fixture.a.path);

  itemA.events.get("click")({});
  h.openFileControl.resolve();
  await h.openFileControl.promise;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.getLeafForOpeningFileCalls.length, 1);
  assert.deepEqual(h.openFileCalls, [fixture.a.path]);
  assert.equal(h.revealLeafCalls[0], h.leaf, "the same leaf is revealed, never a new one");
  // app.workspace.getLeaf("tab"/"split") throws in this fixture if ever
  // called — reaching this assertion already proves it never was.
  assert.ok(true, "getLeaf(\"tab\"/\"split\") was never called (fixture would have thrown otherwise)");
});
