import test from "node:test";
import assert from "node:assert/strict";
import { MarkdownView, TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { buildScriveningsDocument, applyCompositeChanges } from "../src/services/scrivenings-document.js";
import { createEditorCursorTrackingExtension } from "../src/services/editor-cursor-tracking.js";
import { countScriveningsSelectionWords, computeScriveningsWordCounts } from "../src/utils/scrivenings-stats.js";
import { countWords } from "../src/utils/core.js";
import { formatNumber } from "../src/utils/text-metrics.js";
import { getLocale, setLocale } from "../src/i18n/index.js";

function documentFrom(bodies) {
  return buildScriveningsDocument(bodies.map((content, index) => ({
    file: new TFile(`Project/${index}.md`), content,
  })));
}

function continuFrom(document) {
  const view = Object.create(ScriveningsView.prototype);
  view.session = { document };
  view.wordCounts = computeScriveningsWordCounts(document);
  view.cm = { state: { selection: { main: { from: 0, to: 0 } } } };
  return view;
}

function span() {
  return { textContent: "", hidden: false, setText(text) { this.textContent = text; } };
}

function nativeFixture() {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  const view = Object.create(MarkdownView.prototype);
  view.file = new TFile("Project/Active.md");
  view.getMode = () => "source";
  let selected = "";
  view.editor = { getSelection: () => selected };
  const workspace = {
    getActiveViewOfType: (Type) => Type === MarkdownView ? workspace.active : null,
    getMostRecentLeaf: () => ({ view: workspace.central }),
    getLeavesOfType: () => [],
    active: view, central: view,
  };
  plugin.app = { workspace, vault: { cachedRead() { assert.fail("Selection updates must not read the vault"); } } };
  plugin._editorCursorListeners = new Set();
  plugin.getProjectFolder = () => new TFolder("Project");
  plugin.getCentralContinuView = () => null;
  plugin.statusSelectionEl = span();
  plugin.statusStatsEl = { textContent: "801 words · 4 867 characters · +0 today" };
  plugin.statusPreviewEl = { textContent: " · Page 2/3", hidden: false };
  plugin.statusEl = { className: "feuillets-status-hit" };
  plugin.updateStatusBar = () => assert.fail("Selection updates must not recalculate totals");
  plugin.wordCountOfFolder = () => assert.fail("Selection updates must not scan the project");
  return { plugin, view, workspace, select: (text) => { selected = text; } };
}

const passages = [
  ["one word", "word", 1],
  ["sentence", "A short selected sentence.", 4],
  ["multiple lines and paragraphs", "First line\nSecond line\n\nLast paragraph.", 6],
  ["French apostrophes and hyphens", "L'amour aujourd’hui porte-monnaie va-t-il", 4],
  ["Markdown formatting", "# **Bold words** and [a link](https://example.com) [[target|alias]]", 6],
  ["punctuation only", "… ! -- ***", 0],
  ["whitespace only", " \n\t ", 0],
];

for (const [name, text, expected] of passages) {
  test(`selected words preserve countWords conventions: ${name}`, () => {
    const { plugin, select } = nativeFixture();
    select(text);
    plugin.updateSelectionStatusBar();
    assert.equal(countWords(text), expected);
    const doc = documentFrom([text]);
    assert.equal(countScriveningsSelectionWords(doc, 0, doc.text.length), expected);
    const previous = getLocale();
    try {
      setLocale("en");
      plugin.updateSelectionStatusBar();
      assert.equal(plugin.statusSelectionEl.textContent, ` · ${expected} ${expected === 1 ? "word" : "words"} selected`);
      assert.equal(plugin.statusSelectionEl.hidden, false);
    } finally { setLocale(previous); }
  });
}

test("native selection signal updates extension, reduction and clearing without changing other spans", () => {
  const { plugin, view, select } = nativeFixture();
  const initialStats = { ...plugin.statusStatsEl };
  const initialPreview = { ...plugin.statusPreviewEl };
  const notifications = [];
  plugin.registerEditorCursorListener((change) => notifications.push(change));
  const extension = createEditorCursorTrackingExtension((change) => plugin.notifyEditorCursorChanged(change));
  plugin.updateSelectionStatusBar();
  assert.equal(plugin.statusSelectionEl.hidden, true);
  assert.equal(plugin.statusSelectionEl.textContent, "");
  for (const text of ["word", "word and sentence", "word and", ""]) {
    select(text);
    extension.fn({ selectionSet: true,
      state: { selection: { main: { head: text.length } } },
      view: { state: { field: () => ({ file: view.file }) } },
    });
    assert.equal(plugin.statusSelectionEl.hidden, text.length === 0);
    assert.equal(plugin.statusSelectionEl.textContent === "", text.length === 0);
  }
  assert.equal(notifications.length, 4);
  assert.deepEqual(plugin.statusStatsEl, initialStats);
  assert.deepEqual(plugin.statusPreviewEl, initialPreview);
  assert.equal(plugin.statusEl.className, "feuillets-status-hit");
});

test("native selection follows the current file, active editor, mode and project", () => {
  const { plugin, view, workspace, select } = nativeFixture();
  select("old selection");
  plugin.updateSelectionStatusBar();
  assert.equal(plugin.statusSelectionEl.hidden, false);
  const next = Object.assign(Object.create(MarkdownView.prototype), {
    file: new TFile("Project/Next.md"), getMode: () => "source", editor: { getSelection: () => "" },
  });
  workspace.active = next;
  workspace.central = next;
  plugin.updateSelectionStatusBar();
  assert.equal(plugin.statusSelectionEl.hidden, true);
  workspace.active = view;
  workspace.central = view;
  view.file = new TFile("Project-other/Outside.md");
  plugin.updateSelectionStatusBar();
  assert.equal(plugin.statusSelectionEl.hidden, true);
  view.file = new TFile("Project/Active.md");
  plugin.getProjectFolder = () => new TFolder("Other project");
  plugin.updateSelectionStatusBar();
  assert.equal(plugin.statusSelectionEl.hidden, true);
  plugin.getProjectFolder = () => new TFolder("Project");
  view.getMode = () => "preview";
  plugin.updateSelectionStatusBar();
  assert.equal(plugin.statusSelectionEl.hidden, true);
  view.getMode = () => "source";
  workspace.central = next;
  plugin.updateSelectionStatusBar();
  assert.equal(plugin.statusSelectionEl.hidden, true, "a sidebar Markdown editor cannot contribute");
  workspace.active = null;
  plugin.updateSelectionStatusBar();
  assert.equal(plugin.statusSelectionEl.hidden, true, "Binder, search and other UI selections are ignored");
});

test("Continu selections intersect real segments, including partial boundaries and empty segments", () => {
  const doc = documentFrom(["---\ntitle: Invisible heading words\n---\nOne two three", "", "Four five six"]);
  const [first, empty, last] = doc.segments;
  assert.equal(countScriveningsSelectionWords(doc, 0, 0), 0);
  assert.equal(countScriveningsSelectionWords(doc, first.from, first.to), 3);
  assert.equal(countScriveningsSelectionWords(doc, 4, 7), 1);
  assert.equal(countScriveningsSelectionWords(doc, 4, last.from + 4), 3);
  assert.equal(countScriveningsSelectionWords(doc, first.to, last.from), 0, "junctions and empty bodies contribute nothing");
  assert.equal(countScriveningsSelectionWords(doc, first.to - 2, last.from + 2), 2, "partial words follow countWords");
  assert.equal(countScriveningsSelectionWords(doc, empty.from, empty.to), 0);
  assert.equal(countScriveningsSelectionWords(doc, 0, doc.text.length), 6, "YAML and virtual titles are absent from bodies");
});

test("Continu reads live unsaved bodies and selection without mutating group totals", () => {
  const document = documentFrom(["One two", "Three four"]);
  const view = continuFrom(document);
  const originalStats = view.getGroupStats();
  assert.equal(view.getSelectedWordCount(), null);
  view.cm.state.selection.main = { from: 0, to: document.text.length };
  assert.equal(view.getSelectedWordCount(), 4);
  view.cm.state.selection.main.to = 3;
  assert.equal(view.getSelectedWordCount(), 1);
  assert.deepEqual(view.getGroupStats(), originalStats);
  assert.deepEqual(view.wordCounts, computeScriveningsWordCounts(document));
  const edit = applyCompositeChanges(document, [{ from: 0, to: 3, insert: "Live unsaved words" }]);
  assert.ok(edit);
  view.session.document = edit.document;
  view.cm.state.selection.main = { from: 0, to: edit.document.text.length };
  assert.equal(view.getSelectedWordCount(), 6);
  assert.deepEqual(document, documentFrom(["One two", "Three four"]));
  view.cm.state.selection.main.to = 0;
  assert.equal(view.getSelectedWordCount(), null);
  view.cm = null;
  assert.equal(view.getSelectedWordCount(), null);
});

test("Continu notification uses only the current central view and clears after editor destruction", () => {
  const { plugin, workspace } = nativeFixture();
  const view = continuFrom(documentFrom(["One two", "Three four"]));
  const other = continuFrom(documentFrom(["Other selection"]));
  view.cm.state.selection.main = { from: 0, to: 3 };
  other.cm.state.selection.main = { from: 0, to: 15 };
  plugin.getCentralContinuView = () => view;
  plugin.notifyContinuSelectionChanged(view);
  const label = plugin.statusSelectionEl.textContent;
  plugin.notifyContinuSelectionChanged(other);
  assert.equal(plugin.statusSelectionEl.textContent, label);
  view.plugin = plugin;
  view.cm.destroy = () => {};
  view.destroyEditor();
  assert.equal(plugin.statusSelectionEl.hidden, true);
  plugin.getCentralContinuView = () => null;
  workspace.active = null;
  plugin.updateSelectionStatusBar();
  assert.equal(plugin.statusSelectionEl.textContent, "");
});

test("selection labels use French and English singular, plural, zero and existing number formatting", () => {
  const { plugin } = nativeFixture();
  const previous = getLocale();
  let count = 1;
  plugin.getCentralContinuView = () => ({ getSelectedWordCount: () => count });
  try {
    for (const [locale, one, many] of [
      ["fr", "mot sélectionné", "mots sélectionnés"],
      ["en", "word selected", "words selected"],
      ["unsupported", "word selected", "words selected"],
    ]) {
      setLocale(locale);
      for (count of [1, 2, 0, 1234]) {
        plugin.updateSelectionStatusBar();
        assert.equal(plugin.statusSelectionEl.textContent, ` · ${formatNumber(count)} ${count === 1 ? one : many}`);
      }
    }
  } finally { setLocale(previous); }
});

test("workspace listeners refresh selection synchronously and are registered through the plugin lifecycle", (t) => {
  const { plugin, workspace, select } = nativeFixture();
  const previousWindow = globalThis.window;
  globalThis.window = { clearTimeout() {}, setTimeout() { return 1; } };
  t.after(() => { globalThis.window = previousWindow; });
  const listeners = new Map();
  const registrations = [];
  workspace.on = (name, callback) => { listeners.set(name, callback); return { name, callback }; };
  plugin.registerEvent = (event) => registrations.push(event.name);
  plugin.addStatusBarItem = () => ({ addClass() {}, addEventListener() {}, createSpan: span });
  plugin.registerStatusBar();
  assert.deepEqual(registrations.sort(), ["active-leaf-change", "editor-change", "file-open", "layout-change"]);
  for (const name of registrations) {
    select("new selected text");
    listeners.get(name)();
    assert.equal(plugin.statusSelectionEl.hidden, false);
    select("");
    listeners.get(name)();
    assert.equal(plugin.statusSelectionEl.hidden, true);
  }
});
