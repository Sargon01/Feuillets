import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";

test("citation insertion: real CodeMirror undo, boundary rejection, Continu save and reopen", { skip: !existsSync(chromium.executablePath()) }, async (t) => {
  const bundle = await build({
    stdin: { contents: `export { prepareCitationInsertion, applyCitationInsertion, dispatchCitationPlan } from "./services/citation-insertion.ts";
      export { insertCitation } from "./utils/cm-citekey-trigger.ts";
      export { ScriveningsSegmentEditorAdapter } from "./utils/scrivenings-editor-adapter.ts";
      export { buildScriveningsDocument, boundaryOffsets } from "./services/scrivenings-document.ts";
      export { scriveningsBoundariesField, setScriveningsBoundaryOffsetsEffect, scriveningsBoundaryGuard, scriveningsChangeListener } from "./utils/cm-scrivenings.ts";
      export { ScriveningsSession, ScriveningsView } from "./views/scrivenings-view.ts";
      export { default as FeuilletsPlugin } from "./main.ts";
      export { EditorState } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export { history, undo, redo } from "@codemirror/commands";
      export { TFile, TFolder, MarkdownView } from "obsidian";`, resolveDir: resolve("src") },
    bundle: true, write: false, format: "iife", globalName: "InsertionTest",
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "obsidian-test", setup(builder) {
      // Obsidian supplies one shared CM runtime; local packages contain two state versions.
      builder.onResolve({ filter: /^@codemirror\/state$/ }, () => ({ path: resolve("node_modules/@codemirror/state/dist/index.js") }));
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const api = window.InsertionTest;
    const makeView = (text, extensions = []) => new api.EditorView({ state: api.EditorState.create({ doc: text, extensions: [api.history(), ...extensions] }), parent: document.body });
    const native = makeView("Text .");
    native.dispatch({ selection: { anchor: 5 } });
    const editor = { cm: native, getValue: () => native.state.doc.toString(), focus: () => native.focus() };
    const plan = api.prepareCitationInsertion(editor.getValue(), 5, 5, "[@smith2024]", "footnote");
    const inserted = api.applyCitationInsertion(editor, editor.getValue(), plan);
    const nativeText = native.state.doc.toString();
    const cursor = native.state.selection.main.head;
    const undoSucceeded = api.undo(native);
    const nativeUndone = native.state.doc.toString();
    api.redo(native);
    const nativeRedone = native.state.doc.toString();
    native.destroy();
    // A completed picker operation is isolated from the preceding typed trigger.
    const picker = makeView("Text ");
    picker.dispatch({ changes: { from: 5, insert: "[@" }, selection: { anchor: 7 }, userEvent: "input.type" });
    api.insertCitation(picker, { from: 5, to: 7 }, [{ key: "smith2024" }], "open_group",
      { mode: "footnote", from: 0, to: 7, frontmatter: "" });
    const pickerText = picker.state.doc.toString();
    api.undo(picker);
    const pickerUndone = picker.state.doc.toString();
    picker.destroy();

    const files = [0, 1, 2].map((index) => new api.TFile(`Book/${index}.md`));
    const saved = new Map(files.map((file, index) => [file.path, `---\ntitle: ${index}\n---\nText[^${index + 2}].\n\n[^${index + 2}]: Old\nLast paragraph.`]));
    const app = { vault: { process: async (file, transform) => { saved.set(file.path, transform(saved.get(file.path))); }, getAbstractFileByPath: (path) => files.find((file) => file.path === path) } };
    const session = new api.ScriveningsSession({ app, scheduleTimeout: () => 1, cancelTimeout: () => {}, notify: () => {} });
    const load = () => api.buildScriveningsDocument(files.map((file) => ({ file, content: saved.get(file.path) })));
    session.load(load());
    const continuous = makeView(session.document.text, [api.scriveningsBoundariesField, api.scriveningsBoundaryGuard,
      api.scriveningsChangeListener((changes) => session.handleChanges(changes))]);
    continuous.dispatch({ effects: api.setScriveningsBoundaryOffsetsEffect.of(api.boundaryOffsets(session.document)) });
    const view = Object.create(api.ScriveningsView.prototype);
    Object.assign(view, { cm: continuous, session });
    const outputs = [];
    for (const index of [0, 1, 2]) {
      const segment = session.document.segments[index];
      continuous.dispatch({ selection: { anchor: segment.to - 1 } });
      const target = view.getReferenceCitationTarget();
      const plugin = { getCentralContinuView: () => view, getReferenceCitationTarget: () => target, citationStyleFor: () => "footnote" };
      // Exercise the actual References insertion entry point and target resolver.
      const resolved = api.FeuilletsPlugin.prototype.getReferenceCitationTarget.call(plugin);
      const before = continuous.state.doc.toString();
      const applied = api.FeuilletsPlugin.prototype.insertBibtexCitation.call(plugin, "smith2024", resolved);
      const after = continuous.state.doc.toString();
      await session.flush();
      const persisted = saved.get(target.file.path);
      api.undo(continuous);
      const undoText = continuous.state.doc.toString();
      api.redo(continuous);
      await session.flush();
      outputs.push({ index, applied, path: target.file.path, persisted,
        singleUndo: undoText === before, singleRedo: continuous.state.doc.toString() === after });
    }
    // Source formatting and its registry stay separate from BibTeX bookkeeping.
    const source = new api.TFile("Sources/Archive.md");
    const sourceSegment = session.document.segments[1];
    continuous.dispatch({ selection: { anchor: sourceSegment.from + sourceSegment.body.indexOf("Last paragraph") + 4 } });
    const sourceTarget = view.getReferenceCitationTarget();
    const sourceBefore = continuous.state.doc.toString();
    const sourceRecords = [];
    let sourceMarks = 0;
    const sourcePlugin = { app, fmOf: () => ({ author: "Smith", title: "Archive", date: "2024" }), titleFor: () => "Archive",
      citationStyleFor: () => "footnote", recordCitationOccurrence: (file, citedSource, content, from, to) => sourceRecords.push({
        path: file.path, source: citedSource.path, text: content.slice(from, to),
      }), markSourceCited: () => { sourceMarks++; } };
    api.FeuilletsPlugin.prototype.insertCitationFor.call(sourcePlugin, source, "42", sourceTarget.editor, sourceTarget.file);
    const sourceAfter = continuous.state.doc.toString();
    api.undo(continuous);
    const sourceSingleUndo = continuous.state.doc.toString() === sourceBefore;
    api.redo(continuous);
    const sourceSingleRedo = continuous.state.doc.toString() === sourceAfter;
    await session.flush();
    const beforeRejected = continuous.state.doc.toString();
    const trackedBoundaries = continuous.state.field(api.scriveningsBoundariesField);
    const expectedBoundaries = api.boundaryOffsets(session.document);
    const first = session.document.segments[0];
    const second = session.document.segments[1];
    const rejected = api.dispatchCitationPlan(continuous, { changes: [
      { from: first.from + 1, to: first.from + 1, insert: "orphan" },
      { from: first.to - 1, to: second.from + 1, insert: "bad" },
    ], cursor: first.from + 1, contentStart: 0 });
    const unchanged = continuous.state.doc.toString() === beforeRejected;
    await session.flush();
    continuous.destroy();
    session.destroy();
    const reopenedDocument = load();
    const reopened = makeView(reopenedDocument.text);
    const reopenMatches = reopened.state.doc.toString() === beforeRejected;
    reopened.destroy();
    return { undoSucceeded, inserted, nativeText, cursor, nativeUndone, nativeRedone, pickerText, pickerUndone,
      outputs, sourceRecords, sourceMarks, sourceSingleUndo, sourceSingleRedo,
      trackedBoundaries, expectedBoundaries, rejected, unchanged, reopenMatches };
  });
  assert.equal(result.undoSucceeded, true, JSON.stringify(result));
  assert.equal(result.inserted, true);
  assert.equal(result.nativeText, "Text [^1].\n\n[^1]: [@smith2024]");
  assert.equal(result.cursor, 9);
  assert.equal(result.nativeUndone, "Text .");
  assert.equal(result.nativeRedone, result.nativeText);
  assert.equal(result.pickerText, "Text [^1]\n\n[^1]: [@smith2024]");
  assert.equal(result.pickerUndone, "Text [@");
  for (const output of result.outputs) {
    assert.equal(output.applied, true);
    assert.equal(output.path, `Book/${output.index}.md`);
    assert.match(output.persisted, new RegExp(`^---\\ntitle: ${output.index}\\n---\\n`));
    assert.match(output.persisted, new RegExp(`Last paragraph\\[\\^${output.index + 3}\\]\\.\\n\\n\\[\\^${output.index + 3}\\]: \\[@smith2024\\]$`));
    assert.equal(output.singleUndo, true);
    assert.equal(output.singleRedo, true);
  }
  assert.deepEqual(result.trackedBoundaries, result.expectedBoundaries);
  assert.equal(result.rejected, false);
  assert.equal(result.unchanged, true);
  assert.equal(result.reopenMatches, true);
  assert.equal(result.sourceMarks, 1);
  assert.deepEqual(result.sourceRecords, [{ path: "Book/1.md", source: "Sources/Archive.md", text: "Smith, *Archive*, 2024, p. 42." }]);
  assert.equal(result.sourceSingleUndo, true);
  assert.equal(result.sourceSingleRedo, true);
});
