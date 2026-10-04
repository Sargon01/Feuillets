import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";

test("XRef browser: real CodeMirror renders multiline selections and notes without source or store writes", { skip: !existsSync(chromium.executablePath()) }, async (t) => {
  const bundle = await build({
    stdin: { resolveDir: resolve("src"), contents: `
      export { EditorState } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export { createCrossReferenceExtension, notifyCrossReferenceEditors } from "./utils/cm-cross-references.ts";
      export { crossReferenceStorePath } from "./services/cross-reference-store.ts";
      export { createCrossReferenceLink } from "./services/cross-reference-resolution.ts";
      export { emptyCrossReferenceStore, serializeCrossReferenceStore } from "./services/cross-reference-model.ts";
      export { detectCrossReferenceTargets } from "./services/cross-reference-detection.ts";
      export { TFile, TFolder, editorInfoField, editorLivePreviewField, setBrowserPreview } from "obsidian";
    ` },
    bundle: true, write: false, format: "iife", globalName: "CrossReferenceBrowser",
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "xref-browser-obsidian", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "xref-browser" }));
      builder.onLoad({ filter: /.*/, namespace: "xref-browser" }, () => ({ resolveDir: process.cwd(), contents: `
        export * from ${JSON.stringify(resolve("test/obsidian-runtime-stub.mjs"))};
        import { StateField, StateEffect } from "@codemirror/state";
        export const setBrowserPreview = StateEffect.define();
        export const editorInfoField = StateField.define({ create: () => ({ file: globalThis.browserXrefFile }), update: v => v });
        export const editorLivePreviewField = StateField.define({ create: () => true, update: (v, tr) => {
          for (const e of tr.effects) if (e.is(setBrowserPreview)) v = e.value;
          return v;
        } });
      ` }));
    } }],
  });
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const api = window.CrossReferenceBrowser;
    const root = new api.TFolder("Manuscript");
    const a = new api.TFile("Manuscript/A.md", "![First map](a.png)");
    const b = new api.TFile("Manuscript/B.md", "![Current map](b.png)");
    const source = "See figure 99\nlinked text.\n\n[^1]: See figure 88.";
    const ref = new api.TFile("Manuscript/Reference.md", source);
    root.children = [a, b, ref]; for (const file of root.children) file.parent = root;
    const files = new Map([root, a, b, ref].map((file) => [file.path, file]));
    const settings = { projectFolder: root.path, projectMeta: {}, orders: {}, folderPositions: {} };
    let writes = 0;
    const app = { vault: { getAbstractFileByPath: (path) => files.get(path) ?? null, read: async (file) => file.content,
      modify: async () => { writes++; }, create: async () => { writes++; } }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
    const detected = api.detectCrossReferenceTargets(b.path, b.content)[0];
    let store = api.createCrossReferenceLink(api.emptyCrossReferenceStore(), detected, b.content, ref.path, source, 4, source.indexOf("."), "type-number").store;
    const noteStart = source.indexOf("figure 88");
    store = api.createCrossReferenceLink(store, detected, b.content, ref.path, source, noteStart, noteStart + 9, "title").store;
    const path = api.crossReferenceStorePath(app, settings); const json = api.serializeCrossReferenceStore(store);
    files.set(path, new api.TFile(path, json));
    window.browserXrefFile = ref;
    const view = new api.EditorView({ state: api.EditorState.create({ doc: source,
      extensions: [api.editorInfoField, api.editorLivePreviewField, api.createCrossReferenceExtension(app, () => settings)] }), parent: document.body });
    window.browserXref = { view, source, noteStart, app, path, files, json, writes: () => writes };
  });
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("Current map") && document.querySelector(".cm-content")?.textContent.includes("figure 2"));
  const first = await page.evaluate(() => ({ text: document.querySelector(".cm-content").textContent, source: window.browserXref.view.state.doc.toString() }));
  assert.ok(first.text.includes("figure 2")); assert.ok(first.text.includes("Current map")); assert.ok(!first.text.includes("linked text"));
  assert.equal(first.source, "See figure 99\nlinked text.\n\n[^1]: See figure 88.");
  await page.evaluate(() => window.browserXref.view.dispatch({ selection: { anchor: 7 } }));
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("linked text"));
  await page.evaluate(() => {
    window.browserXref.view.dispatch({ selection: { anchor: 0 }, effects: window.CrossReferenceBrowser.setBrowserPreview.of(false) });
  });
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("figure 88"));
  const final = await page.evaluate(() => ({ source: window.browserXref.view.state.doc.toString(), store: window.browserXref.files.get(window.browserXref.path).content, original: window.browserXref.json, writes: window.browserXref.writes() }));
  assert.equal(final.source, first.source); assert.equal(final.store, final.original); assert.equal(final.writes, 0);
  assert.deepEqual(errors, []);
});
