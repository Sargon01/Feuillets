import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);
const { MarkdownView, Notice } = await import(isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js"));
const { SearchReplaceBar } = await import(modulePath("src/views/search-replace-bar.js"));
const { FeuilletsSearchEngine } = await import(modulePath("src/services/feuillets-search-engine.js"));

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
  const editor = {
    cm: { state: { doc: { length: 200 } }, dispatch() { editor.highlights += 1; } },
    setSelection(...args) { editor.selection = args; },
    scrollIntoView(...args) { editor.scrolled = args; },
    highlights: 0,
  };
  const file = { path: "Projet/Scene.md" };
  const view = Object.assign(new MarkdownView(), { containerEl: parent, file, editor });
  const workspace = {
    getActiveViewOfType() { return active ? view : null; },
    getActiveFile() { return file; },
    getLeavesOfType() { return []; },
    getLeaf() { return { openFile() {}, view }; },
    setActiveLeaf() {},
  };
  const app = { workspace };
  const plugin = { renderAllViews: async () => { plugin.renders += 1; }, renders: 0 };
  return { bar: new SearchReplaceBar(app, plugin), parent, editor, file, app, plugin };
}

test("SearchReplaceBar — état, ouverture, fermeture et champs", async () => {
  const dom = installDom();
  const { bar, parent, editor } = createBar();
  assert.equal(bar.searchQuery, "");
  assert.equal(bar.replaceQuery, "");
  assert.equal(bar.showReplace, false);
  assert.deepEqual(bar.occurrences, []);
  assert.equal(bar.currentIndex, 0);
  assert.deepEqual(bar.options, { ignoreCase: true, ignoreDiacritics: false, matchMode: "contains", scope: "manuscript", includeYaml: false });

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

test("SearchReplaceBar — remplacement, popover et insertion au curseur", async () => {
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
  for (const item of [items[0], items[1], items[2], items[3], items[4], items.at(-2), items.at(-1)]) item.dispatchEvent({ type: "click", stopPropagation() {} });
  assert.equal(bar.options.ignoreCase, false);
  assert.equal(bar.options.ignoreDiacritics, true);
  assert.equal(bar.options.matchMode, "wholeWord");
  assert.equal(bar.options.scope, "manuscript");
  assert.ok(runCalls.length >= 7);
  dom.runTimers();
});

test("SearchReplaceBar — temporisation, navigation et moteur", async () => {
  const dom = installDom();
  const { bar, file, editor } = createBar();
  bar.open();
  dom.runTimers();
  const originalSearch = FeuilletsSearchEngine.searchInVault;
  const originalReplace = FeuilletsSearchEngine.replaceInVault;
  const searchCalls = [];
  const replaceCalls = [];
  FeuilletsSearchEngine.searchInVault = async (_app, _plugin, query, options) => {
    searchCalls.push({ query, options });
    return { occurrences: [
      { file, index: 2, length: 3, line: 0, ch: 2 },
      { file, index: 8, length: 3, line: 1, ch: 1 },
    ] };
  };
  FeuilletsSearchEngine.replaceInVault = async (_app, _plugin, query, replacement, options) => {
    replaceCalls.push({ query, replacement, options });
    return { totalReplacements: 2, filesCount: 1 };
  };
  try {
    bar.searchQuery = "mot";
    bar.scheduleSearch();
    bar.scheduleSearch();
    assert.equal(dom.timers.size, 1);
    dom.runTimers();
    await Promise.resolve();
    assert.equal(searchCalls.length, 1);
    assert.equal(searchCalls[0].options.includeYaml, false);
    assert.equal(bar.occurrences.length, 2);
    await bar.navigateMatch(-1);
    assert.equal(bar.currentIndex, 1);
    await bar.navigateMatch(1);
    assert.equal(bar.currentIndex, 0);
    assert.ok(editor.selection);
    assert.ok(editor.highlights > 0);

    bar.replaceQuery = "autre";
    await bar.executeReplaceAll();
    assert.equal(replaceCalls.length, 1);
    assert.deepEqual(replaceCalls[0], {
      query: "mot", replacement: "autre",
      // includeYaml n'est volontairement pas transmis par le comportement actuel.
      options: { scope: "manuscript", ignoreCase: true, ignoreDiacritics: false, matchMode: "contains", activeFile: file },
    });
    assert.ok(searchCalls.length >= 2);

    bar.searchQuery = "";
    await bar.runSearch();
    assert.deepEqual(bar.occurrences, []);
  } finally {
    FeuilletsSearchEngine.searchInVault = originalSearch;
    FeuilletsSearchEngine.replaceInVault = originalReplace;
  }
});
