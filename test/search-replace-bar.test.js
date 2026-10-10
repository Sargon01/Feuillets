import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers";
import { createSearchEditor } from "./search-editor-helper.js";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);
const { setLocale } = await import(modulePath("src/i18n/index.js"));
setLocale("en");
const { MarkdownView, Menu, Notice, TFile, TFolder } = await import(isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js"));
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
    this.attributes = { ...options.attr };
    this.type = options.type;
    this.hidden = false;
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) { const child = new FakeElement(tag, options); child.parent = this; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    this.children.push(child); child.parent = this;
  }
  get parentElement() { return this.parent; }
  get ownerDocument() { return document; }
  get options() { return this.children.filter((child) => child.tag === "option"); }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.text = value; this.children = []; }
  getBoundingClientRect() { return { left: 10, bottom: 30 }; }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  setText(text) { this.text = String(text); return this; }
  setAttr(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, callback) { const callbacks = this.events.get(name) ?? []; callbacks.push(callback); this.events.set(name, callbacks); }
  dispatchEvent(event) {
    if (event.type === "click" && this.disabled) return true;
    for (const callback of this.events.get(event.type) ?? []) callback(event);
    if (event.type === "keydown") this.parent?.dispatchEvent(event);
    return true;
  }
  click() { this.dispatchEvent({ type: "click", stopPropagation() {} }); }
  focus() { if (document.activeElement) document.activeElement.focused = false; this.focused = true; document.activeElement = this; }
  empty() { this.children = []; }
  remove() { this.removed = true; this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
  querySelector(selector) { return all(this).find((element) => matches(element, selector)) ?? null; }
  querySelectorAll(selector) { return all(this).filter((element) => matches(element, selector)); }
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
  globalThis.HTMLElement = FakeElement;
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
  const search = bar.containerEl.querySelector(".feuillets-search-input-wrapper textarea");
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
  const search = bar.containerEl.querySelector(".feuillets-search-input-wrapper textarea");
  let inputs = 0;
  search.addEventListener("input", () => { inputs += 1; });
  search.value = "ac";
  search.selectionStart = 1;
  search.selectionEnd = 2;
  bar.showCharacterMenu(search);
  Menu.lastShown.items.find((item) => item.title === "Tab").click();
  assert.equal(search.value, "a\t");
  assert.equal(search.selectionStart, 2);
  assert.equal(inputs, 1);
  Menu.lastShown.hide();
  assert.equal(bar.characterMenu, null);

  const toggle = bar.containerEl.querySelector(".feuillets-search-replace-toggle");
  toggle.click();
  const replace = bar.containerEl.querySelector(".feuillets-replace-input");
  replace.value = "nouveau";
  replace.dispatchEvent({ type: "input" });
  assert.equal(bar.replaceQuery, "nouveau");
  let replaces = 0;
  bar.executeReplaceAll = async () => { replaces += 1; };
  replace.dispatchEvent(keyEvent("Enter"));
  assert.equal(replaces, 1);

  bar.containerEl.querySelector(".feuillets-search-options-toggle").click();
  const runCalls = [];
  bar.runSearch = async () => { runCalls.push({ ...bar.options }); return true; };
  for (const cls of ["feuillets-search-case", "feuillets-search-accents", "feuillets-search-mode-contains", "feuillets-search-mode-startsWith", "feuillets-search-mode-wholeWord"]) {
    const input = bar.containerEl.querySelector(`.${cls}`);
    input.checked = true;
    input.dispatchEvent({ type: "change" });
  }
  const scope = bar.containerEl.querySelector(".feuillets-search-scope");
  for (const value of ["document", "folder"]) { scope.value = value; scope.dispatchEvent({ type: "change" }); }
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
      bar.searchQuery = "ney";
    bar.replaceQuery = "*ney*";
    bar.options.protectMarkdown = true;
    bar.open();
    bar.toggleReplace();
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
  bar.searchQuery = "mot";
  bar.replaceQuery = "word";
  bar.open();
  bar.toggleReplace();
  let finish;
  const realSearch = bar.runSearch.bind(bar);
  bar.runSearch = () => new Promise((resolve) => { finish = resolve; });
  const first = bar.executeReplaceAll();
  assert.equal(bar.containerEl.querySelector(".feuillets-replace-all-btn").disabled, true);
  await bar.executeReplaceAll();
  assert.equal(editor.transactions.length, 1);
  finish();
  await first;
  assert.equal(bar.containerEl.querySelector(".feuillets-replace-all-btn").disabled, false);
  bar.runSearch = realSearch;
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
  bar.open();
  bar.toggleReplace();
  assert.match(bar.containerEl.querySelector(".feuillets-search-scope").options[0].text, /Scene.md/);
  bar.options.scope = "folder";
  bar.updateScopeUI();
  assert.match(bar.containerEl.querySelector(".feuillets-search-scope").options[1].text, /Project/);
  assert.equal(bar.containerEl.querySelector(".feuillets-replace-all-btn").disabled, true);
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
  bar.open(); bar.toggleReplace(); bar.options.scope = "folder";
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

const field = (bar, cls) => bar.containerEl.querySelector(`.${cls}`);
const change = (bar, cls, checked) => {
  const input = field(bar, cls);
  input.checked = checked;
  input.dispatchEvent({ type: "change" });
};

test("search opens alone; independent sections retain fields, selections and option state", async () => {
  installDom();
  const { bar, editor, parent } = createBar();
  bar.open();
  const search = field(bar, "feuillets-search-input");
  const replacement = field(bar, "feuillets-replace-input");
  assert.equal(field(bar, "feuillets-search-replace-section").hidden, true);
  assert.equal(field(bar, "feuillets-search-options").hidden, true);
  assert.equal(field(bar, "feuillets-search-counter").text, "");
  assert.equal(field(bar, "feuillets-search-prev").disabled, true);
  assert.equal(field(bar, "feuillets-replace-all-btn").disabled, true);
  assert.equal(document.activeElement, search);
  search.value = "mot"; search.selectionStart = 1; search.selectionEnd = 2;
  search.dispatchEvent({ type: "input" });
  await bar.runSearch(false);
  const selections = editor.listSelections();
  const optionsToggle = field(bar, "feuillets-search-options-toggle");
  optionsToggle.click();
  change(bar, "feuillets-search-case", true);
  field(bar, "feuillets-search-replace-toggle").click();
  replacement.value = "other"; replacement.dispatchEvent({ type: "input" });
  field(bar, "feuillets-search-replace-toggle").click();
  assert.equal(field(bar, "feuillets-search-options").hidden, false);
  assert.equal(field(bar, "feuillets-search-replace-section").hidden, true);
  optionsToggle.click();
  assert.equal(bar.options.ignoreCase, false);
  assert.equal(optionsToggle.attributes["aria-expanded"], "false");
  field(bar, "feuillets-search-replace-toggle").click();
  assert.equal(field(bar, "feuillets-replace-input"), replacement);
  assert.equal(replacement.value, "other");
  assert.equal(field(bar, "feuillets-search-input"), search);
  assert.equal(search.selectionStart, 1);
  assert.deepEqual(editor.listSelections(), selections);
  assert.equal(editor.transactions.length, 0);
  replacement.dispatchEvent(keyEvent("Escape"));
  assert.equal(bar.containerEl, null);
  bar.open();
  assert.equal(bar.showReplace, false);
  assert.equal(bar.showOptions, false);
  assert.equal(field(bar, "feuillets-replace-input").value, "other");
  assert.equal(field(bar, "feuillets-search-input").value, "mot");
  assert.equal(parent.children.length, 1);
});

test("the visible selector exposes all five scopes and keeps errors separate from scope controls", async () => {
  installDom();
  const { bar, plugin } = createBar();
  bar.open(); bar.searchQuery = "mot";
  const selector = field(bar, "feuillets-search-scope");
  assert.deepEqual(selector.options.map(({ value }) => value), ["document", "folder", "selection", "manuscript", "project"]);
  for (const scope of ["document", "folder", "selection", "manuscript", "project"]) {
    selector.value = scope; selector.dispatchEvent({ type: "change" });
    await bar.runSearch(false);
    assert.equal(bar.options.scope, scope);
    assert.equal(bar.occurrences.length, 2);
    assert.equal(selector.value, scope);
  }
  selector.value = "selection"; plugin._binderMultiSelect.clear();
  selector.dispatchEvent({ type: "change" });
  await bar.runSearch(false);
  assert.match(field(bar, "feuillets-search-status").text, /editorial scope/);
  assert.equal(selector.options.length, 5);
  assert.equal(field(bar, "feuillets-replace-all-btn").disabled, true);
});

test("scope captions show work names and leave long paths in the tooltip", async () => {
  installDom();
  const { bar, file, plugin } = createBar();
  plugin.editorialRootFor = () => ({ path: "Project/A very long technical parent path/BOZLAK" });
  bar.open();
  const selector = field(bar, "feuillets-search-scope");
  assert.equal(selector.options[3].text, "Work — BOZLAK");
  bar.options.scope = "manuscript";
  bar.resolveScope(); bar.updateScopeUI();
  assert.equal(selector.title, "Project/A very long technical parent path/BOZLAK");
  assert.doesNotMatch(selector.options[3].text, /technical parent/);
  assert.equal(selector.options[0].text, `Active document: ${file.name}`);
});

test("UI case, accents, the three modes and YAML drive the existing matching rules", async () => {
  installDom();
  const { bar, editor } = createBar();
  editor.edit(0, editor.getValue().length, "---\ntitle: cafe\n---\ncafé CAFÉ cafe cafes precafe");
  bar.open(); bar.searchQuery = "cafe";
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 3);
  change(bar, "feuillets-search-accents", true);
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 5);
  change(bar, "feuillets-search-case", true);
  await bar.runSearch(false);
  assert.equal(bar.options.ignoreCase, false);
  assert.equal(bar.occurrences.length, 4);
  change(bar, "feuillets-search-mode-startsWith", true);
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 3);
  change(bar, "feuillets-search-mode-wholeWord", true);
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 2);
  change(bar, "feuillets-search-yaml", true);
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 3);
  change(bar, "feuillets-search-mode-contains", true);
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 5);
});

test("special characters insert at the saved cursor in each field, preserving surrounding text", async () => {
  installDom();
  const { bar } = createBar();
  bar.open(); bar.toggleReplace();
  for (const cls of ["feuillets-search-input", "feuillets-replace-input"]) {
    const input = field(bar, cls);
    for (const [label, value] of [["Tab", "\t"], ["Line break", "\n"], ["Paragraph", "\n\n"]]) {
      input.value = "left right"; input.selectionStart = input.selectionEnd = 5;
      bar.showCharacterMenu(input);
      input.selectionStart = 0; input.selectionEnd = 0;
      Menu.lastShown.items.find((item) => item.title === label).click();
      assert.equal(input.value, `left ${value}right`);
      assert.equal(input.selectionStart, 5 + value.length);
      assert.equal(cls === "feuillets-search-input" ? bar.searchQuery : bar.replaceQuery, input.value);
      assert.equal(document.activeElement, input);
    }
  }
  const menu = Menu.lastShown;
  bar.close();
  menu.items[0].click();
  assert.equal(bar.containerEl, null);
});

test("typing keeps the editor cursor; navigation selects and scrolls with a coherent counter", async () => {
  const dom = installDom();
  const { bar, editor } = createBar();
  bar.open();
  const search = field(bar, "feuillets-search-input");
  const before = editor.listSelections();
  search.value = "mot"; search.dispatchEvent({ type: "input" });
  assert.equal(field(bar, "feuillets-search-next").disabled, true);
  dom.runTimers(); await bar.runSearch(false);
  assert.equal(field(bar, "feuillets-search-counter").text, "1 / 2");
  assert.deepEqual(editor.listSelections(), before);
  assert.equal(document.activeElement, search);
  await bar.navigateMatch(1);
  assert.equal(field(bar, "feuillets-search-counter").text, "2 / 2");
  assert.deepEqual(editor.selection, [{ line: 1, ch: 1 }, { line: 1, ch: 4 }]);
  assert.ok(editor.scrolled);
  search.value = "absent"; search.dispatchEvent({ type: "input" });
  await bar.runSearch(false);
  assert.equal(field(bar, "feuillets-search-counter").text, "No occurrences");
  for (const cls of ["feuillets-search-next", "feuillets-search-prev", "feuillets-replace-current-btn", "feuillets-replace-all-btn"]) assert.equal(field(bar, cls).disabled, true);
  search.value = ""; search.dispatchEvent({ type: "input" });
  await bar.runSearch(false);
  assert.equal(field(bar, "feuillets-search-counter").text, "");
});

test("unit replacement uses one undoable transaction, supports deletion and remains in scope", async () => {
  installDom();
  const { bar, editor, app } = createBar();
  const outside = await app.vault.create("Project/Other.md", "mot");
  bar.open(); bar.toggleReplace(); bar.searchQuery = "mot"; bar.replaceQuery = "word";
  await bar.runSearch(false); await bar.navigateMatch(1);
  await bar.executeReplaceCurrent();
  assert.equal(editor.getValue(), "  mot\n word");
  assert.equal(editor.transactions.length, 1);
  assert.equal(outside.content, "mot");
  assert.equal(bar.occurrences.length, 1);
  assert.equal(editor.undo(), true);
  assert.equal(editor.getValue(), "  mot\n mot");
  bar.replaceQuery = ""; await bar.runSearch(false);
  await bar.executeReplaceCurrent();
  assert.equal(editor.getValue(), "  \n mot");
  assert.equal(outside.content, "mot");
  assert.equal(await bar.plugin.getGlobalSearchReplace().getUndoStatus(), null);
});

test("identical and protected occurrences disable replacement; Markdown unit formatting is idempotent", async () => {
  installDom();
  const { bar, editor } = createBar();
  editor.edit(0, editor.getValue().length, "mot *mot* **mot**");
  bar.open(); bar.toggleReplace(); bar.searchQuery = "mot"; bar.replaceQuery = "mot";
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 3);
  assert.equal(field(bar, "feuillets-replace-current-btn").disabled, true);
  assert.equal(field(bar, "feuillets-replace-all-btn").disabled, true);
  bar.replaceQuery = "*mot*";
  change(bar, "feuillets-search-protection", true);
  await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 1);
  await bar.executeReplaceCurrent();
  assert.equal(editor.getValue(), "*mot* *mot* **mot**");
  assert.equal(bar.occurrences.length, 0);
  await bar.executeReplaceCurrent();
  assert.equal(editor.transactions.length, 1);
  bar.toggleReplace(); await bar.runSearch(false);
  assert.equal(bar.occurrences.length, 3);
  assert.equal(bar.options.protectMarkdown, true);
});

test("persistent global undo is accessible after reopening and service restart, and reports conflicts", async () => {
  installDom();
  const { bar, editor, plugin, app } = createBar();
  bar.open(); bar.toggleReplace(); bar.searchQuery = "mot"; bar.replaceQuery = "word"; bar.options.scope = "folder";
  const pending = bar.executeReplaceAll();
  while (!bar.previewModal) await new Promise((resolve) => setImmediate(resolve));
  bar.previewModal.contentEl.querySelectorAll("button").find((button) => button.textContent === "Replace in 1 sheet").click();
  await pending;
  assert.equal(field(bar, "feuillets-search-undo-summary").text, "2 replacements in 1 sheet");
  assert.equal(field(bar, "feuillets-search-undo-btn").disabled, false);
  bar.close();
  plugin.getGlobalSearchReplace = () => new GlobalSearchReplace(app, plugin);
  const reopened = new SearchReplaceBar(app, plugin);
  reopened.open(); await reopened.refreshUndoState();
  assert.equal(reopened.showReplace, false);
  assert.equal(field(reopened, "feuillets-search-undo").hidden, false);
  editor.edit(0, 0, "later ");
  await reopened.refreshUndoState();
  assert.equal(field(reopened, "feuillets-search-undo-btn").disabled, true);
  assert.match(field(reopened, "feuillets-search-undo-summary").text, /Undo refused/);
  editor.undo(); await reopened.refreshUndoState();
  assert.equal(field(reopened, "feuillets-search-undo-btn").disabled, false);
  reopened.searchQuery = "mot";
  await reopened.executeUndo();
  assert.equal(editor.getValue(), "  mot\n mot");
  assert.equal(reopened.occurrences.length, 2);
  assert.equal(field(reopened, "feuillets-search-undo").hidden, true);
});

test("rapid query and scope changes discard old search results and pending navigation", async () => {
  installDom();
  const { bar, plugin } = createBar();
  bar.open(); bar.options.scope = "folder"; bar.searchQuery = "mot";
  const plan = await plugin.getGlobalSearchReplace().preview(bar.resolveScope(), "mot", "", bar.options);
  let finish;
  plugin.getGlobalSearchReplace = () => ({ preview: () => new Promise((resolve) => { finish = resolve; }), getUndoStatus: async () => null });
  let jumps = 0; bar.jumpToCurrentMatch = async () => { jumps++; };
  const old = bar.navigateMatch(1);
  bar.searchQuery = "absent"; bar.options.scope = "document"; bar.scope = null;
  await bar.runSearch(false);
  finish(plan); await old;
  assert.equal(bar.occurrences.length, 0);
  assert.equal(jumps, 0);
  assert.equal(field(bar, "feuillets-search-counter").text, "No occurrences");
});

test("closing clears timers and menus; changing sheets moves one panel and Binder focus preserves its fields", async () => {
  const dom = installDom();
  const { bar, app, plugin, editor } = createBar();
  bar.open();
  const search = field(bar, "feuillets-search-input");
  const nextFile = await app.vault.create("Project/Next.md", "next");
  const nextView = Object.assign(new MarkdownView(), { file: nextFile, editor, containerEl: new FakeElement(), getMode: () => "source" });
  app.workspace.getActiveViewOfType = () => nextView;
  app.workspace.getLeavesOfType = () => [{ view: nextView }, { view: bar.boundView }];
  bar.handleActiveViewChange();
  assert.equal(bar.containerEl.parent, nextView.containerEl);
  assert.equal(field(bar, "feuillets-search-input"), search);
  assert.equal(document.activeElement, search);
  plugin.getSearchReplaceView = () => nextView;
  app.workspace.getActiveViewOfType = () => null;
  bar.handleActiveViewChange();
  assert.ok(bar.containerEl);
  assert.equal(field(bar, "feuillets-search-input"), search);
  bar.showCharacterMenu(search); bar.scheduleSearch(false); bar.close();
  assert.equal(dom.timers.size, 0);
  assert.equal(dom.listeners.size, 0);
  assert.equal(bar.characterMenu, null);
});
