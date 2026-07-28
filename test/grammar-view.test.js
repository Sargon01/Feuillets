import assert from "node:assert/strict";
import test from "node:test";
import { Notice, Platform, TFile } from "obsidian";
import { setLocale } from "../src/i18n/index.js";
import { sanitizeForGrammarCheck } from "../src/utils/sanitize-for-grammar.js";
import { GrammarView } from "../src/views/grammar-view.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    if (options.cls) this.addClass(options.cls);
  }

  createEl(_tag, options = {}) { return this.createDiv(options); }
  createDiv(options = {}) { const child = new FakeElement(options); this.children.push(child); return child; }
  createSpan(options = {}) { return this.createDiv(options); }
  addClass(classNames) { for (const className of classNames.split(" ")) this.classes.add(className); }
  removeClass(className) { this.classes.delete(className); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr() {}
  empty() { this.children = []; }
  querySelectorAll() { return []; }
}

function elements(element) {
  return [element, ...element.children.flatMap(elements)];
}

function makeFile(path, content, mtime = 1) {
  const file = new TFile(path, content);
  file.stat = { mtime };
  return file;
}

function createEditor() {
  const dispatches = [];
  const replaces = [];
  return {
    cm: {
      state: { doc: { length: 1000 } },
      dispatch(transaction) { dispatches.push(transaction); },
    },
    dispatches,
    replaces,
    offsetToPos(offset) { return { line: 0, ch: offset }; },
    posToOffset(position) { return position.ch; },
    replaceRange(text, from, to) { replaces.push({ text, from, to }); },
    getCursor() { return { line: 0, ch: 0 }; },
    setSelection() {},
    scrollIntoView() {},
    focus() {},
  };
}

function createGrammarView({ file = null, visible = true, checker } = {}) {
  const contentEl = new FakeElement();
  const editor = createEditor();
  const files = new Map(file ? [[file.path, file]] : []);
  const app = {
    vault: {
      async cachedRead(current) { return current.content; },
      async read(current) { return current.content; },
      async modify(current, next) { current.content = next; },
      getAbstractFileByPath(path) { return files.get(path) || null; },
    },
    workspace: {
      getActiveFile() { return file; },
      revealLeaf() {},
    },
  };
  const sidebar = { activeTab: visible ? "grammar" : "notes", async render() {} };
  const plugin = {
    settings: { grammarEngine: "grammalecte", activeRightPanelTab: sidebar.activeTab },
    grammarCheckerManager: checker,
    activeEditorAnywhere: () => editor,
    titleFor: (current) => current.basename,
    async saveSettings() {},
    grammarUserData: null,
  };
  const view = new GrammarView({ app, contentEl, view: sidebar }, plugin);
  return { view, app, plugin, sidebar, contentEl, editor, files };
}

test("GrammarView affiche l'indisponibilité mobile sans lancer le correcteur", async () => {
  const previousMobile = Platform.isMobile;
  Platform.isMobile = true;
  let checks = 0;
  try {
    const { view, contentEl } = createGrammarView({ checker: { async checkText() { checks += 1; return []; } } });
    await view.render();
    assert.equal(checks, 0);
    assert.equal(elements(contentEl).some((element) => element.classes.has("feuillets-research-empty")), true);
  } finally {
    Platform.isMobile = previousMobile;
  }
});

test("GrammarView efface les surlignages et affiche l'état vide sans feuillet Markdown", async () => {
  const { view, contentEl, editor } = createGrammarView();
  view._highlightedEditor = editor.cm;
  await view.render();
  assert.equal(editor.dispatches.length, 1);
  assert.equal(view._highlightedEditor, null);
  assert.equal(elements(contentEl).some((element) => element.classes.has("feuillets-research-empty")), true);
});

test("GrammarView vérifie le corps nettoyé, conserve l'offset et applique les surlignages", async () => {
  const raw = "---\ntitle: Test\n---\nTexte **visible**";
  const file = makeFile("Projet/scene.md", raw, 42);
  const checks = [];
  const { view, editor } = createGrammarView({
    file,
    checker: { async checkText(text, settings, locale) { checks.push({ text, settings, locale }); return [{ start: 1, end: 4, type: "grammar" }]; } },
  });
  let renders = 0;
  view.render = async () => { renders += 1; };
  setLocale("en");
  try {
    await view.runCheck(file);
  } finally {
    setLocale("fr");
  }
  const body = "Texte **visible**";
  assert.equal(view.checking, false);
  assert.equal(view.frontmatterOffset, raw.length - body.length);
  assert.deepEqual(checks.map((check) => check.text), [sanitizeForGrammarCheck(body)]);
  assert.equal(checks[0].locale, "en");
  assert.equal(checks[0].settings, view.plugin.settings);
  assert.equal(editor.dispatches.length, 1);
  assert.equal(view._highlightedEditor, editor.cm);
  assert.equal(renders, 2);
});

test("GrammarView restaure son état après une erreur moteur", async () => {
  const file = makeFile("Projet/scene.md", "Texte");
  const { view } = createGrammarView({ file, checker: { async checkText() { throw new Error("moteur indisponible"); } } });
  view.render = async () => {};
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    await view.runCheck(file);
  } finally {
    Notice.onCreate = null;
  }
  assert.equal(view.checking, false);
  assert.deepEqual(view.issues, []);
  assert.equal(notices.length, 1);
});

test("GrammarView ne touche pas au panneau invisible pendant runCheck", async () => {
  const file = makeFile("Projet/scene.md", "Texte");
  const { view, contentEl } = createGrammarView({ file, visible: false, checker: { async checkText() { return []; } } });
  const sentinel = contentEl.createDiv({ cls: "sentinel" });
  await view.runCheck(file);
  assert.equal(contentEl.children[0], sentinel);
});

test("GrammarView relance la vérification si le fichier ou sa date change", async () => {
  const file = makeFile("Projet/scene.md", "Texte", 10);
  const { view } = createGrammarView({ file });
  const checked = [];
  view.runCheck = async (current) => { checked.push(current); };
  await view.render();
  file.stat.mtime = 11;
  await view.render();
  assert.deepEqual(checked, [file, file]);
});

test("GrammarView applique, ignore et apprend sans modifier d'autre comportement", async () => {
  const file = makeFile("Projet/scene.md", "abcdef");
  const { view, plugin, editor } = createGrammarView({ file });
  let renders = 0;
  view.frontmatterOffset = 2;
  view.render = async () => { renders += 1; };
  await view.applySuggestion(file, { start: 1, end: 3 }, "ZZ");
  assert.deepEqual(editor.replaces, [{ text: "ZZ", from: { line: 0, ch: 3 }, to: { line: 0, ch: 5 } }]);

  const ignored = [];
  const learned = [];
  plugin.grammarUserData = {
    ignoreIssueSignature(signature) { ignored.push(signature); return true; },
    learnWord(word) { learned.push(word); return true; },
  };
  await view.ignoreIssue({ ruleId: "R", underlined: "mot" });
  await view.learnWord("mot");
  assert.deepEqual(ignored, ["R::mot"]);
  assert.deepEqual(learned, ["mot"]);
  assert.equal(renders, 3);
});

test("GrammarView ouvre la ligne demandée dans le panneau", async () => {
  const { view, sidebar, plugin, app } = createGrammarView();
  const row = new FakeElement();
  let scrolled = false;
  row.scrollIntoView = () => { scrolled = true; };
  view.targetContainer = { querySelectorAll: () => [row] };
  let revealed = 0;
  app.workspace.revealLeaf = () => { revealed += 1; };
  let sidebarRenders = 0;
  sidebar.activeTab = "notes";
  sidebar.render = async () => { sidebarRenders += 1; };
  let saves = 0;
  plugin.saveSettings = async () => { saves += 1; };
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout(callback) { callback(); } };
  try {
    await view.highlightRowInPanel(0);
  } finally {
    globalThis.window = previousWindow;
  }
  assert.equal(plugin.settings.activeRightPanelTab, "grammar");
  assert.equal(saves, 1);
  assert.equal(sidebarRenders, 1);
  assert.equal(revealed, 1);
  assert.equal(scrolled, true);
});

test("GrammarView efface l'ancien éditeur quand le fichier actif change", async () => {
  const previous = makeFile("Projet/ancien.md", "Ancien", 1);
  const current = makeFile("Projet/nouveau.md", "Nouveau", 2);
  const { view, plugin, editor } = createGrammarView({ file: previous, checker: { async checkText() { return [{ start: 0, end: 1, type: "grammar" }]; } } });
  const oldEditor = createEditor();
  view.checkedPath = previous.path;
  view.checkedMtime = previous.stat.mtime;
  view._highlightedEditor = oldEditor.cm;
  plugin.activeEditorAnywhere = () => editor;
  view.render = async () => {};
  await view.runCheck(current);
  assert.equal(oldEditor.dispatches.length, 1);
  assert.equal(view._highlightedEditor, editor.cm);
});
