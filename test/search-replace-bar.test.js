import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers";
import { createSearchEditor } from "./search-editor-helper.js";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);
const { setLocale } = await import(modulePath("src/i18n/index.js"));
setLocale("en");
const { MarkdownView, Notice, TFile, TFolder } = await import(isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js"));
const { SearchReplaceBar } = await import(modulePath("src/views/search-replace-bar.js"));
const { createFakeVault } = await import(modulePath("test/helpers/fake-vault.js"));
const { GlobalSearchReplace } = await import(modulePath("src/services/global-search-replace.js"));

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.parent = null;
    this.value = options.value ?? "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.text = options.text ?? "";
    this.removed = false;
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) { const child = new FakeElement(tag, options); child.parent = this; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { this.children.push(child); child.parent = this; }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  setText(text) { this.text = String(text); return this; }
  setAttr() {}
  addEventListener(name, callback) { this.events.set(name, callback); }
  dispatchEvent(event) { this.events.get(event.type)?.(event); return true; }
  focus() { this.focused = true; }
  empty() { this.children = []; }
  remove() { this.removed = true; this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
  querySelector(selector) { return all(this).find((element) => matches(element, selector)) ?? null; }
}

function all(element) { return [element, ...element.children.flatMap(all)]; }
function matches(element, selector) {
  const parts = selector.split(" ");
  const last = parts.at(-1);
  const tagMatches = !last || !/^[a-z]+$/i.test(last) || element.tag === last;
  const classMatches = !last?.startsWith(".") || element.classes.has(last.slice(1));
  if (!tagMatches || !classMatches) return false;
  if (parts.length === 1) return true;
  const parentClass = parts[0].slice(1);
  return element.parent?.classes.has(parentClass) ?? false;
}

function keyEvent(key, { shiftKey = false } = {}) {
  return { key, shiftKey, type: "keydown", preventDefault() { this.prevented = true; }, stopPropagation() {} };
}

function installDom() {
  const timers = new Map();
  let nextTimer = 1;
  const listeners = new Map();
  globalThis.window = {
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.document = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
  };
  return { timers, listeners, runTimers: () => { for (const callback of [...timers.values()]) callback(); timers.clear(); } };
}

function createBar({ active = true } = {}) {
  const parent = new FakeElement();
  const editor = createSearchEditor("  mot\n mot");
  editor.highlights = 0;
  editor.cm = { state: { doc: { length: 200 } }, dispatch() { editor.highlights += 1; } };
  const root = new TFolder("Project");
  const file = new TFile("Project/Scene.md", "  mot\n mot");
  file.parent = root; root.children = [file];
  const fake = createFakeVault([root, file]);
  const view = Object.assign(new MarkdownView(), { containerEl: parent, file, editor, getMode: () => "source", save: () => fake.vault.process(file, () => editor.getValue()) });
  const workspace = {
    getActiveViewOfType() { return active ? view : null; },
    getActiveFile() { return file; },
    getLeavesOfType(type) { return type === "markdown" ? [{ view }] : []; },
    getLeaf() { return { openFile() {}, view }; },
    setActiveLeaf() {},
  };
  const app = { workspace, ...fake, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const plugin = {
    settings: { projectFolder: root.path, orders: {}, folderPositions: {}, compileFileName: "Compiled.md", projectMeta: {} },
    getProjectFolder: () => root,
    editorialRootFor: () => root,
    compileScopeForFolder: (folder) => ({ type: "folder", projectRoot: root.path, path: folder.path }),
    compileScopeForSelection: (paths) => ({ type: "selection", projectRoot: root.path, paths }),
    _binderMultiSelect: new Set([file.path]),
    getSearchReplaceView: () => active ? view : null,
    renderAllViews: async () => { plugin.renders += 1; }, renders: 0,
  };
  const service = new GlobalSearchReplace(app, plugin);
  plugin.getGlobalSearchReplace = () => service;
  return { bar: new SearchReplaceBar(app, plugin), parent, editor, file, app, plugin };
}

test("SearchReplaceBar state, opening, closing and fields", async () => {
  const dom = installDom();
  const { bar, parent, editor } = createBar();
  assert.equal(bar.searchQuery, "");
  assert.equal(bar.replaceQuery, "");
  assert.equal(bar.showReplace, false);
  assert.deepEqual(bar.occurrences, []);
  assert.equal(bar.currentIndex, 0);
  assert.deepEqual(bar.options, { ignoreCase: true, ignoreDiacritics: false, matchMode: "contains", scope: "document", includeYaml: false, protectMarkdown: false });

  bar.open();
  assert.ok(bar.containerEl);
  dom.runTimers();
  const search = bar.containerEl.querySelector(".feuillets-search-input-wrapper input");
  assert.equal(search.focused, true);
  bar.open();
  assert.equal(parent.children.filter((child) => child.classes.has("feuillets-search-bar")).length, 1);

  search.value = "mot";
  search.dispatchEvent({ type: "input" });
  assert.equal(bar.searchQuery, "mot");
  search.dispatchEvent(keyEvent("Enter"));
  search.dispatchEvent(keyEvent("Enter", { shiftKey: true }));
  search.dispatchEvent(keyEvent("Escape"));
  assert.equal(bar.containerEl, null);
  assert.ok(editor.highlights > 0);

  const withoutView = createBar({ active: false }).bar;
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  withoutView.open();
  assert.equal(withoutView.containerEl, null);
  assert.equal(notices.length, 1);
  Notice.onCreate = null;
});

test("SearchReplaceBar replacement, options and cursor insertion", async () => {
  const dom = installDom();
  const { bar } = createBar();
  bar.open();
  const search = bar.containerEl.querySelector(".feuillets-search-input-wrapper input");
  let inputs = 0;
  search.addEventListener("input", () => { inputs += 1; });
  search.value = "ac";
  search.selectionStart = 1;
  search.selectionEnd = 2;
  bar.togglePopover();
  const tab = all(bar.popoverEl).find((element) => element.children.some((child) => child.text === "⇥"));
  tab.dispatchEvent({ type: "click", stopPropagation() {} });
  assert.equal(search.value, "a\t");
  assert.equal(search.selectionStart, 2);
  assert.equal(inputs, 1);
  bar.closePopover();
  assert.equal(bar.popoverEl, null);

  const toggle = all(bar.containerEl).find((element) => element.classes.has("feuillets-search-icon-btn") && element.icon === "replace");
  toggle.dispatchEvent({ type: "click" });
  const replace = bar.containerEl.querySelector(".feuillets-replace-input");
  replace.value = "nouveau";
  replace.dispatchEvent({ type: "input" });
  assert.equal(bar.replaceQuery, "nouveau");
  let replaces = 0;
  bar.executeReplaceAll = async () => { replaces += 1; };
  replace.dispatchEvent(keyEvent("Enter"));
  assert.equal(replaces, 1);

  bar.renderPopover();
  const items = all(bar.popoverEl).filter((element) => element.classes.has("feuillets-search-popover-item"));
  const runCalls = [];
  bar.runSearch = async () => { runCalls.push({ ...bar.options }); };
  for (const item of [items[0], items[1], items[2], items[3], items[4], items.at(-5), items.at(-4)]) item.dispatchEvent({ type: "click", stopPropagation() {} });
  assert.equal(bar.options.ignoreCase, false);
  assert.equal(bar.options.ignoreDiacritics, true);
  assert.equal(bar.options.matchMode, "wholeWord");
  assert.equal(bar.options.scope, "folder");
  assert.ok(runCalls.length >= 7);
  dom.runTimers();
});

test("SearchReplaceBar debounce, multi-file navigation and local replacement", async () => {
  const dom = installDom();
  const { bar, editor, app } = createBar();
  bar.open();
  bar.options.scope = "folder";
  dom.runTimers();
  bar.searchQuery = "mot";
  bar.scheduleSearch(); bar.scheduleSearch();
  assert.equal(dom.timers.size, 1);
  dom.runTimers();
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 2);
  await bar.navigateMatch(-1);
  assert.equal(bar.currentIndex, 1);
  await bar.navigateMatch(1);
  assert.equal(bar.currentIndex, 0);
  assert.ok(editor.selection);
  assert.ok(editor.highlights > 0);
  bar.options.scope = "document";
  bar.replaceQuery = "autre";
  await bar.executeReplaceAll();
  assert.equal(editor.getValue(), "  autre\n autre");
  assert.equal(editor.transactions.length, 1);
  assert.equal(app.vault.getAbstractFileByPath("Project/Scene.md").content, "  mot\n mot");
  bar.searchQuery = "";
  await bar.runSearch();
  assert.deepEqual(bar.occurrences, []);
});

test("SearchReplaceBar applies real unsaved replacements and preserves selections after refresh", async () => {
  installDom();
  const { bar, editor } = createBar();
  editor.edit(0, editor.getValue().length, "ney *ney* **before ney after** `ney`\n[^1]: ney");
  editor.setSelection({ line: 1, ch: 6 }, { line: 1, ch: 9 });
  const original = editor.getValue();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    bar.showReplace = true;
    bar.searchQuery = "ney";
    bar.replaceQuery = "*ney*";
    bar.options.protectMarkdown = true;
    bar.open();
    await bar.runSearch(false);
    assert.equal(bar.occurrences.length, 2);
    const before = editor.listSelections();
    await bar.executeReplaceAll();
    assert.equal(editor.getValue(), "*ney* *ney* **before ney after** `ney`\n[^1]: *ney*");
    assert.equal(editor.transactions.length, 1);
    assert.deepEqual(editor.listSelections(), [{ anchor: { line: 1, ch: 6 }, head: { line: 1, ch: 11 } }]);
    assert.equal(bar.occurrences.length, 0);
    assert.match(notices[0], /2/);
    await bar.executeReplaceAll();
    assert.equal(editor.transactions.length, 1);
    assert.match(notices[1], /No changes/);
    editor.undo();
    assert.equal(editor.getValue(), original);
    assert.deepEqual(editor.listSelections(), before);
  } finally { Notice.onCreate = null; }
});

test("SearchReplaceBar locks concurrent activations and never reports success on failure", async () => {
  installDom();
  const { bar, editor } = createBar();
  bar.showReplace = true;
  bar.searchQuery = "mot";
  bar.replaceQuery = "word";
  bar.open();
  let finish;
  bar.runSearch = () => new Promise((resolve) => { finish = resolve; });
  const first = bar.executeReplaceAll();
  assert.equal(bar.containerEl.querySelector(".feuillets-replace-all-btn").disabled, true);
  await bar.executeReplaceAll();
  assert.equal(editor.transactions.length, 1);
  finish();
  await first;
  assert.equal(bar.containerEl.querySelector(".feuillets-replace-all-btn").disabled, false);
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const originalError = console.error;
  console.error = () => {};
  try {
    bar.searchQuery = "word";
    bar.replaceQuery = "next";
    editor.transaction = () => { throw new Error("Read-only"); };
    await bar.executeReplaceAll();
    assert.equal(editor.getValue(), "  word\n word");
    assert.equal(bar.replacing, false);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /failed/);
    assert.doesNotMatch(notices[0], /occurrence.*replaced/);
  } finally { Notice.onCreate = null; console.error = originalError; }
});

test("SearchReplaceBar shows the exact folder, previews, cancels and confirms real multi-file writes", async () => {
  installDom();
  const { bar, editor, app } = createBar();
  bar.showReplace = true;
  bar.open();
  assert.match(bar.containerEl.querySelector(".feuillets-search-scope").text, /Scene.md/);
  bar.options.scope = "folder";
  bar.updateScopeUI();
  assert.match(bar.containerEl.querySelector(".feuillets-search-scope").text, /Project/);
  assert.equal(bar.containerEl.querySelector(".feuillets-replace-all-btn").disabled, false);
  bar.searchQuery = "mot"; bar.replaceQuery = "word";
  const cancelled = bar.executeReplaceAll();
  while (!bar.previewModal) await new Promise((resolve) => setImmediate(resolve));
  bar.previewModal.onClose();
  await cancelled;
  assert.equal(editor.transactions.length, 0);
  assert.equal(app.vault.getAbstractFileByPath("Project/Scene.md").content, "  mot\n mot");
  const confirmed = bar.executeReplaceAll();
  while (!bar.previewModal) await new Promise((resolve) => setImmediate(resolve));
  const button = bar.previewModal.contentEl.querySelectorAll("button").find((button) => button.textContent === "Replace in 1 sheet");
  button.click(); button.click();
  await confirmed;
  assert.equal(editor.getValue(), "  word\n word");
  assert.equal(app.vault.getAbstractFileByPath("Project/Scene.md").content, editor.getValue());
  assert.equal(editor.transactions.length, 1);
});

test("Binder focus keeps the explicitly tracked Markdown target and selection scope", async () => {
  installDom();
  const { bar, plugin, app, editor } = createBar();
  bar.open();
  const view = bar.boundView;
  plugin.getSearchReplaceView = () => view;
  app.workspace.getActiveViewOfType = () => null;
  bar.handleActiveViewChange();
  assert.ok(bar.containerEl);
  bar.options.scope = "selection";
  bar.searchQuery = "mot";
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 2);
  assert.deepEqual(bar.scope.paths, ["Project/Scene.md"]);
  bar.options.scope = "document"; bar.replaceQuery = "word";
  await bar.executeReplaceAll();
  assert.equal(editor.getValue(), "  word\n word");
});

test("a stale multi-file confirmation reports failure without success or source writes", async () => {
  installDom();
  const { bar, editor, app } = createBar();
  bar.open(); bar.showReplace = true; bar.options.scope = "folder";
  bar.searchQuery = "mot"; bar.replaceQuery = "word";
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const originalError = console.error;
  console.error = () => {};
  try {
    const pending = bar.executeReplaceAll();
    while (!bar.previewModal) await new Promise((resolve) => setImmediate(resolve));
    await bar.executeReplaceAll();
    editor.edit(0, 0, "later ");
    bar.previewModal.contentEl.querySelectorAll("button").find((button) => button.textContent === "Replace in 1 sheet").click();
    await pending;
    assert.equal(editor.getValue(), "later   mot\n mot");
    assert.equal(app.vault.getAbstractFileByPath("Project/Scene.md").content, "  mot\n mot");
    assert.equal(editor.transactions.length, 0);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /changed/);
    assert.doesNotMatch(notices[0], /occurrence.*replaced/);
    assert.equal(bar.replacing, false);
  } finally { Notice.onCreate = null; console.error = originalError; }
});

test("closing the bar while preview is calculated prevents a later confirmation", async () => {
  installDom();
  const { bar, plugin } = createBar();
  bar.open(); bar.options.scope = "folder"; bar.searchQuery = "mot"; bar.replaceQuery = "word";
  const plan = await plugin.getGlobalSearchReplace().preview({ type: "project", projectRoot: "Project" }, "mot", "word", bar.options);
  let finish;
  plugin.getGlobalSearchReplace = () => ({ preview: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = bar.executeReplaceAll();
  bar.close(); finish(plan);
  await pending;
  assert.equal(bar.previewModal, null);
  assert.equal(bar.replacing, false);
});
