import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (p) => new URL(`../.test-dist/${p}`, import.meta.url).href;
const modulePath = (p) => (isCompiledTest ? `../${p}` : compiledModule(p));

if (typeof globalThis.HTMLElement === "undefined") {
  globalThis.HTMLElement = class HTMLElement {};
}

const { EditorState } = await import("@codemirror/state");
const { EditorView, Decoration } = await import("@codemirror/view");
const { Menu } = await import(isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js"));
const {
  applyGrammarHighlights,
  applyMappedGrammarHighlights,
  clearGrammarHighlights,
  clearGrammarHighlightsForFile,
  grammarIssuesField,
  grammarContextMenuExtension,
  createGrammarCheckerExtension,
  GRAMMAR_CHECK_DEBOUNCE_MS,
  requestGrammarCheck,
} = await import(modulePath("src/utils/cm-grammar-highlighter.js"));

function provider(id = "provider") {
  return { id, name: id, analyze: async () => [] };
}

function view(doc) {
  return new EditorView({ state: EditorState.create({ doc, extensions: [grammarIssuesField] }) });
}

function grammarState(editor) {
  return editor.state.field(grammarIssuesField);
}

class GrammarElement extends HTMLElement {
  constructor(key) {
    super();
    this.key = key;
  }
  closest(selector) {
    assert.equal(selector, "[data-grammar-key]");
    return this;
  }
  getAttribute(name) {
    return name === "data-grammar-key" ? this.key : null;
  }
}

function host(currentProvider, editor = null) {
  return {
    getAnalysisProvider: (id) => (!id || id === currentProvider.id ? currentProvider : null),
    analyzeActiveFile: async () => {},
    activeEditorAnywhere: () => editor,
    app: { vault: { getAbstractFileByPath: () => null }, workspace: {} },
  };
}

function eventFor(key, button = 0) {
  return {
    target: new GrammarElement(key),
    preventDefault() {},
    stopPropagation() {},
    button,
    clientX: 1,
    clientY: 1,
  };
}

test("grammar highlights keep decorations, keys, ranges, and classes in editor state", () => {
  const editor = view("fotee erreur");
  applyGrammarHighlights(editor, [
    { message: "Spelling", start: 0, end: 5, canLearn: true },
    { message: "Grammar", start: 6, end: 12, category: "Grammaire" },
  ], undefined, "A.md", provider());
  const state = grammarState(editor);
  assert.equal(state.filePath, "A.md");
  assert.equal(state.issues.size, 2);
  assert.equal(state.decorations.length, 2);
  assert.match(state.decorations[0].class, /spelling/);
  assert.match(state.decorations[1].class, /grammar/);
  assert.equal(state.decorations[0].attributes["data-grammar-key"], "grammar-0");
});

test("grammar highlights ignore invalid ranges and clear both decorations and metadata", () => {
  const editor = view("short");
  applyGrammarHighlights(editor, [
    { message: "negative", start: -1, end: 2 },
    { message: "empty", start: 2, end: 2 },
    { message: "outside", start: 2, end: 8 },
    { message: "valid", start: 0, end: 2 },
  ], undefined, "A.md", provider());
  assert.equal(grammarState(editor).issues.size, 1);
  clearGrammarHighlights(editor);
  assert.equal(grammarState(editor).issues.size, 0);
  assert.equal(grammarState(editor).decorations, Decoration.none);
});

test("each editor owns independent grammar state and document edits invalidate only that editor", () => {
  const first = view("fotee");
  const second = view("erreur");
  const firstProvider = provider("one");
  const secondProvider = provider("two");
  applyGrammarHighlights(first, [{ message: "A", start: 0, end: 5 }], undefined, "A.md", firstProvider);
  applyGrammarHighlights(second, [{ message: "B", start: 0, end: 6 }], undefined, "B.md", secondProvider);
  assert.equal(grammarState(first).filePath, "A.md");
  assert.equal(grammarState(second).filePath, "B.md");
  first.dispatch({ changes: { from: 0, to: 0, insert: "x" } });
  assert.equal(grammarState(first).issues.size, 0);
  assert.equal(grammarState(second).issues.size, 1);
  applyGrammarHighlights(first, [{ message: "fresh", start: 1, end: 6 }], undefined, "A.md", firstProvider);
  assert.equal(grammarState(first).issues.get("grammar-0").issue.message, "fresh");
  clearGrammarHighlights(first);
  assert.equal(grammarState(second).issues.get("grammar-0").issue.message, "B");
});

test("one editor keeps file-scoped diagnostics independently", () => {
  const editor = view("fotee\nerreur");
  const active = provider();
  applyMappedGrammarHighlights(editor, [{ message: "A", start: 0, end: 5, canLearn: true }], "A.md", 0, active);
  applyMappedGrammarHighlights(editor, [{ message: "B", start: 0, end: 6, category: "Grammaire" }], "B.md", 6, active);
  assert.equal(grammarState(editor).issues.size, 2);
  assert.deepEqual([...grammarState(editor).issues.values()].map((entry) => entry.filePath).sort(), ["A.md", "B.md"]);
  applyMappedGrammarHighlights(editor, [{ message: "fresh A", start: 1, end: 5 }], "A.md", 0, active);
  assert.equal(grammarState(editor).issues.size, 2);
  assert.ok([...grammarState(editor).issues.values()].some((entry) => entry.filePath === "B.md" && entry.from === 6));
  clearGrammarHighlightsForFile(editor, "A.md");
  assert.equal(grammarState(editor).issues.size, 1);
  assert.equal([...grammarState(editor).issues.values()][0].filePath, "B.md");
});

test("editing an issue removes only that issue while preserving neighboring classes", () => {
  const editor = view("fotee erreur");
  applyGrammarHighlights(editor, [
    { message: "Spelling", start: 0, end: 5, canLearn: true },
    { message: "Grammar", start: 6, end: 12, category: "Grammaire" },
  ], undefined, "A.md", provider());
  editor.dispatch({ changes: { from: 2, to: 2, insert: "x" } });
  const state = grammarState(editor);
  assert.equal(state.issues.size, 1);
  assert.equal(state.issues.get("grammar-1").issue.category, "Grammaire");
  assert.match(state.decorations[0].class, /grammar/);
});

test("edits outside an issue preserve it, while boundaries and crossing replacements remove it", () => {
  const editor = view("fotee milieu erreur");
  applyGrammarHighlights(editor, [
    { message: "Spelling", start: 0, end: 5, canLearn: true },
    { message: "Grammar", start: 13, end: 19, category: "Grammaire" },
  ], undefined, "A.md", provider());
  editor.dispatch({ changes: { from: 7, to: 7, insert: "x" } });
  assert.equal(grammarState(editor).issues.size, 2);
  editor.dispatch({ changes: { from: 5, to: 5, insert: "x" } });
  assert.equal(grammarState(editor).issues.size, 1);
  editor.dispatch({ changes: { from: 10, to: 16, insert: "y" } });
  assert.equal(grammarState(editor).issues.size, 0);
});

test("overlapping issues are independently removed only when their ranges are touched", () => {
  const editor = view("fotee");
  applyGrammarHighlights(editor, [
    { message: "Spelling", start: 0, end: 5, canLearn: true },
    { message: "Grammar", start: 1, end: 4, category: "Grammaire" },
  ], undefined, "A.md", provider());
  editor.dispatch({ changes: { from: 0, to: 0, insert: "F" } });
  assert.equal(grammarState(editor).issues.size, 1);
  assert.equal(grammarState(editor).issues.get("grammar-1").issue.category, "Grammaire");
  editor.dispatch({ changes: { from: 2, to: 2, insert: "x" } });
  assert.equal(grammarState(editor).issues.size, 0);
});

test("underline menus resolve and replace in their originating editor", async () => {
  const first = view("fotee");
  const second = view("erreur");
  const firstProvider = provider("one");
  const secondProvider = provider("two");
  applyGrammarHighlights(first, [{ message: "A", start: 0, end: 5, suggestions: ["faute"] }], undefined, "A.md", firstProvider);
  applyGrammarHighlights(second, [{ message: "B", start: 0, end: 6, suggestions: ["correct"] }], undefined, "B.md", secondProvider);
  const originalShow = Menu.prototype.showAtPosition;
  let shown = null;
  Menu.prototype.showAtPosition = function() { shown = this; };
  try {
    const handler = grammarContextMenuExtension(host(firstProvider, second));
    assert.equal(handler.click(eventFor("grammar-0"), first), true);
    await shown.items[1].callback();
    assert.equal(first.state.doc.toString(), "faute");
    assert.equal(second.state.doc.toString(), "erreur");
		assert.equal(grammarState(first).issues.size, 0);
  } finally {
    Menu.prototype.showAtPosition = originalShow;
  }
});

test("underline menus pass the exact issue to ignore and learn actions", async () => {
  const editor = view("fotee");
  const active = provider();
  const ignored = [];
  const learned = [];
  active.ignoreOccurrence = async (issue) => ignored.push(issue);
  active.learnWord = async (word, issue) => learned.push([word, issue]);
  const issue = { message: "Spelling", start: 0, end: 5, text: "fotee", canLearn: true };
  applyGrammarHighlights(editor, [issue], undefined, "A.md", active);
  const originalShow = Menu.prototype.showAtPosition;
  let shown = null;
  Menu.prototype.showAtPosition = function() { shown = this; };
  try {
    const handler = grammarContextMenuExtension(host(active));
    handler.click(eventFor("grammar-0"), editor);
    await shown.items[1].callback();
    assert.equal(ignored[0], issue);
    assert.equal(grammarState(editor).issues.size, 0);
    applyGrammarHighlights(editor, [issue], undefined, "A.md", active);
    handler.click(eventFor("grammar-0"), editor);
    await shown.items[2].callback();
    assert.deepEqual(learned[0], ["fotee", issue]);
  } finally {
    Menu.prototype.showAtPosition = originalShow;
  }
});

test("a removed provider or stale state cannot open an actionable underline menu", () => {
  const editor = view("fotee");
  const active = provider();
  applyGrammarHighlights(editor, [{ message: "Spelling", start: 0, end: 5 }], undefined, "A.md", active);
  const unavailableHost = { ...host(active), getAnalysisProvider: () => null };
  const handler = grammarContextMenuExtension(unavailableHost);
  assert.equal(handler.click(eventFor("grammar-0"), editor), false);
  editor.dispatch({ changes: { from: 0, to: 0, insert: "x" } });
  assert.equal(handler.click(eventFor("grammar-0"), editor), false);
});

test("only primary clicks open an underline menu and right clicks remain native", async () => {
  const editor = view("fotee");
  const active = provider();
  applyGrammarHighlights(editor, [{ message: "Spelling", start: 0, end: 5, suggestions: ["faute"] }], undefined, "A.md", active);
  const originalShow = Menu.prototype.showAtPosition;
  let shown = null;
  Menu.prototype.showAtPosition = function() { shown = this; };
  let prevented = 0;
  let stopped = 0;
  try {
    const handler = grammarContextMenuExtension(host(active));
    assert.equal(Object.hasOwn(handler, "contextmenu"), false);
    assert.equal(handler.click(eventFor("grammar-0"), editor), true);
    await Promise.resolve();
    assert.ok(shown);

    shown = null;
    const secondary = eventFor("grammar-0", 2);
    secondary.preventDefault = () => { prevented += 1; };
    secondary.stopPropagation = () => { stopped += 1; };
    assert.equal(handler.click(secondary, editor), false);
    assert.equal(shown, null);
    assert.equal(prevented, 0);
    assert.equal(stopped, 0);

    assert.equal(handler.click({ ...eventFor("grammar-0"), target: null }, editor), false);
  } finally {
    Menu.prototype.showAtPosition = originalShow;
  }
});

test("grammar underline styles provide shape and color distinctions", () => {
  const styles = readFileSync(path.resolve("styles.css"), "utf8");
  const spelling = styles.match(/\.feuillets-grammar-underline-spelling\s*\{[^}]*\}/)?.[0] ?? "";
  const grammar = styles.match(/\.feuillets-grammar-underline-grammar\s*\{[^}]*\}/)?.[0] ?? "";

  assert.match(spelling, /border-bottom:\s*2px\s+dotted\s+var\(--text-error\)/);
  assert.match(grammar, /border-bottom:\s*2px\s+dashed\s+var\(--color-blue\)/);
  assert.notEqual(spelling.match(/border-bottom:\s*2px\s+(\w+)/)?.[1], grammar.match(/border-bottom:\s*2px\s+(\w+)/)?.[1]);
  assert.doesNotMatch(grammar, /var\(--text-accent\)/);
  for (const selector of [spelling, grammar]) {
    assert.doesNotMatch(selector, /text-decoration-(?:line|style|color)/);
  }
});

test("the registered checker keeps its initial delay and debounces document changes at 600 ms", async () => {
  const originalWindow = globalThis.window;
  const timers = new Map();
  let nextTimer = 1;
  globalThis.window = {
    setTimeout: (callback, delay) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const file = { path: "A.md", basename: "A", stat: { mtime: 1 } };
  let analyses = 0;
  const checkerProvider = { id: "placeholder", name: "placeholder", analyze: async () => { analyses += 1; return []; } };
  const checkerHost = {
    ...host(checkerProvider),
    getAnalysisProvider: () => checkerProvider,
    grammarEditorFile: () => file,
  };
  try {
    const extensions = createGrammarCheckerExtension(checkerHost);
    const editor = new EditorView({ state: EditorState.create({ doc: "fotee", extensions }) });
    assert.equal(extensions.length, 3);
    assert.equal(editor.plugins.length, 1);
    assert.deepEqual([...timers.values()].map((timer) => timer.delay), [50]);
    requestGrammarCheck(editor);
    assert.deepEqual([...timers.values()].map((timer) => timer.delay), [50]);
    editor.dispatch({ changes: { from: 5, to: 5, insert: "x" } });
    editor.dispatch({ changes: { from: 6, to: 6, insert: "y" } });
    assert.equal(GRAMMAR_CHECK_DEBOUNCE_MS, 600);
    assert.deepEqual([...timers.values()].map((timer) => timer.delay), [600]);
    const timer = [...timers.values()][0];
    timer.callback();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(analyses, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});
