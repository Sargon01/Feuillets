import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (p) => new URL(`../.test-dist/${p}`, import.meta.url).href;
const modulePath = (p) => (isCompiledTest ? `../${p}` : compiledModule(p));

if (typeof globalThis.HTMLElement === "undefined") globalThis.HTMLElement = class HTMLElement {};

const { EditorState } = await import("@codemirror/state");
const { EditorView } = await import("@codemirror/view");
const { Menu } = await import(isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js"));
const { ScriveningsGrammarChecker } = await import(modulePath("src/utils/cm-scrivenings-grammar.js"));
const { grammarIssuesField, GRAMMAR_CHECK_DEBOUNCE_MS } = await import(modulePath("src/utils/cm-grammar-highlighter.js"));

function segment(path, body, from) {
  return { path, body, from, to: from + body.length, file: { path, basename: path.replace(".md", ""), stat: { mtime: 1 } } };
}

class GrammarElement extends HTMLElement {
  constructor(key) {
    super();
    this.key = key;
  }
  closest() { return this; }
  getAttribute(name) { return name === "data-grammar-key" ? this.key : null; }
}

test("Continu grammar checks bodies independently and maps local ranges into the composite", async () => {
  const originalWindow = globalThis.window;
  const timers = new Map();
  let timerId = 0;
  globalThis.window = {
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const calls = [];
  const active = {
    id: "provider",
    name: "Provider",
    async analyze(input) {
      calls.push(input);
      return [{ message: "Issue", start: 0, end: input.text.length, text: input.text }];
    },
  };
  const document = { segments: [segment("A.md", "bad", 0), segment("B.md", "wrong", 4)] };
  let editor = null;
  const host = {
    app: { vault: { getAbstractFileByPath: () => null }, workspace: {} },
    getAnalysisProvider: (id) => (!id || id === active.id ? active : null),
    titleFor: (file) => file.basename,
    analyzeActiveFile: async () => {},
    activeEditorAnywhere: () => null,
  };
  const checker = new ScriveningsGrammarChecker({ host, getEditor: () => editor, getDocument: () => document });
  try {
    const extensions = checker.extensions();
    assert.ok(extensions.includes(grammarIssuesField));
    assert.ok(extensions.some((extension) => typeof extension?.click === "function"));
    editor = new EditorView({ state: EditorState.create({ doc: "bad\nwrong", extensions }) });
    checker.reset();
    assert.equal([...timers.values()][0].delay, 50);
    [...timers.values()][0].callback();
    for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
    assert.deepEqual(calls.map((input) => [input.filePath, input.text]), [["A.md", "bad"], ["B.md", "wrong"]]);
    const issues = [...editor.state.field(grammarIssuesField).issues.values()];
    assert.deepEqual(issues.map((entry) => [entry.filePath, entry.from, entry.to]), [["A.md", 0, 3], ["B.md", 4, 9]]);
    assert.notEqual(issues[0].key, issues[1].key);
    const clickExtension = extensions.find((extension) => typeof extension?.click === "function");
    const originalShow = Menu.prototype.showAtPosition;
    let shown = null;
    Menu.prototype.showAtPosition = function() { shown = this; };
    try {
      assert.equal(clickExtension.click({ button: 0, target: new GrammarElement(issues[1].key), clientX: 1, clientY: 1, preventDefault() {}, stopPropagation() {} }, editor), true);
      assert.ok(shown);
    } finally {
      Menu.prototype.showAtPosition = originalShow;
    }
    checker.requestTouched(["A.md"]);
    assert.equal([...timers.values()].at(-1).delay, GRAMMAR_CHECK_DEBOUNCE_MS);
  } finally {
    checker.destroy();
    editor?.destroy();
    globalThis.window = originalWindow;
  }
});
