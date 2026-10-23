import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

test("live typography uses real CodeMirror paste, history, composition and Continu guards", async (t) => {
  const bundle = await build({
    stdin: { contents: `
      export { EditorState, EditorSelection, StateEffect } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export { history, undo, redo } from "@codemirror/commands";
      export { createLiveTypographyExtension, typographySegmentContext } from "./src/utils/cm-live-typography.ts";
      export { isEligibleTypographyTarget } from "./src/services/typography-scope.ts";
      export { TFile, TFolder } from "obsidian";
      export { scriveningsBoundaryGuard, scriveningsBoundariesField, setScriveningsBoundaryOffsetsEffect } from "./src/utils/cm-scrivenings.ts";
    `, resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", globalName: "TypographyTest",
    // Obsidian supplies one shared runtime. The local commands package also
    // has a nested state version, which must not create a second CM instance.
    alias: { "@codemirror/state": resolve("node_modules/@codemirror/state/dist/index.js") },
    plugins: [{ name: "obsidian-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const api = window.TypographyTest;
    window.setupTypography = (text = "", settings = {}, boundaries = null, eligible = true) => {
      window.typography?.view.destroy();
      const options = { liveApostrophe: true, liveEllipsis: true, ...settings };
      const inScope = () => typeof eligible === "boolean" ? eligible : api.isEligibleTypographyTarget(eligible.root, eligible.file);
      const context = (state, from, to) => !inScope() ? null : boundaries === null
        ? { from: 0, to: state.doc.length }
        : api.typographySegmentContext(state, state.field(api.scriveningsBoundariesField), from, to);
      const view = new api.EditorView({
        parent: document.body,
        state: api.EditorState.create({ doc: text, extensions: [api.history(), api.EditorView.lineWrapping,
          api.createLiveTypographyExtension(() => options, context),
          ...(boundaries === null ? [] : [api.scriveningsBoundariesField, api.scriveningsBoundaryGuard]),
        ] }),
      });
      if (boundaries !== null) view.dispatch({ effects: api.setScriveningsBoundaryOffsetsEffect.of(boundaries) });
      window.typography = { view, options };
      view.focus();
    };
    window.pasteTypography = (plain, html = "", file = false, prevent = false) => {
      const view = window.typography.view;
      const data = new window.DataTransfer();
      data.setData("text/plain", plain);
      if (html) data.setData("text/html", html);
      if (file) data.items.add(new window.File(["synthetic"], "l'histoire....png", { type: "image/png" }));
      const event = new window.ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      if (prevent) event.preventDefault();
      view.contentDOM.dispatchEvent(event);
      return view.state.doc.toString();
    };
  });

  for (const [kind, path, eligible] of [
    ["ordinary sheet", "Projet/Manuscrit/Chapitre.md", true],
    ["quick draft", "Projet/_Feuillets/Drafts/Sans titre.md", true],
    ["technical file", "Projet/_Feuillets/Versions/archive.md", false],
  ]) {
    await t.test(`${kind}: typography scope applies to paste and typing`, async () => {
      const prefix = "---\ntitre: l'histoire...\n---\n\n`l'histoire...`\n\nFin : ";
      const result = await page.evaluate(({ path, prefix }) => {
        const api = window.TypographyTest;
        const project = new api.TFolder("Projet");
        const root = new api.TFolder("Projet/Manuscrit");
        root.parent = project;
        const target = { root, file: new api.TFile(path) };
        window.setupTypography(prefix, {}, null, target);
        const view = window.typography.view;
        // Obsidian inserts converted HTML upstream of the shared filter.
        // Supply that insertion through a real paste event/transaction here.
        view.dispatch({ effects: api.StateEffect.appendConfig.of(api.EditorView.domEventHandlers({ paste(event, editor) {
          const html = event.clipboardData.getData("text/html");
          const text = new window.DOMParser().parseFromString(html, "text/html").body.textContent;
          editor.dispatch({ ...editor.state.replaceSelection(text), userEvent: "input.paste" });
          return true;
        } })) });
        view.dispatch({ selection: { anchor: prefix.length } });
        const plain = "La fraternité se construit ensemble. L'histoire...";
        const dirty = plain.replaceAll(" ", "\u00a0");
        const pasted = window.pasteTypography(plain, `<p>${dirty}</p>`);
        api.undo(view);
        const undone = view.state.doc.toString();
        api.redo(view);
        const redone = view.state.doc.toString();
        window.setupTypography("", {}, null, target);
        return { pasted, undone, redone, dirty };
      }, { path, prefix });
      const expected = prefix + (eligible ? "La fraternité se construit ensemble. L’histoire…" : result.dirty);
      assert.equal(result.pasted, expected);
      assert.equal(result.undone, prefix);
      assert.equal(result.redone, expected);
      await page.keyboard.type("L'histoire...");
      assert.equal(await page.evaluate(() => window.typography.view.state.doc.toString()), eligible ? "L’histoire…" : "L'histoire...");
    });
  }

  await t.test("normal and plain native CM pastes transform prose and respect live settings", async () => {
    for (const html of ["", "<p>L'histoire d'un homme...</p>"]) {
      await page.evaluate(() => window.setupTypography());
      assert.equal(await page.evaluate((html) => window.pasteTypography("L'histoire d'un homme...", html), html), "L’histoire d’un homme…");
    }
    await page.evaluate(() => window.setupTypography("", { liveApostrophe: false }));
    assert.equal(await page.evaluate(() => window.pasteTypography("L'histoire...")), "L'histoire…");
    await page.evaluate(() => { window.typography.options.liveEllipsis = false; });
    assert.equal(await page.evaluate(() => window.pasteTypography(" d'un homme...")), "L'histoire… d'un homme...");
  });

  await t.test("third dot and apostrophes are handled by native typed input", async () => {
    await page.evaluate(() => window.setupTypography());
    await page.keyboard.type("L'histoire");
    await page.keyboard.type("..");
    assert.equal(await page.evaluate(() => window.typography.view.state.doc.toString()), "L’histoire..");
    await page.keyboard.type(".");
    assert.equal(await page.evaluate(() => window.typography.view.state.doc.toString()), "L’histoire…");
    await page.evaluate(() => window.setupTypography("", { liveEllipsis: false, liveApostrophe: false }));
    await page.keyboard.type("L'histoire...");
    assert.equal(await page.evaluate(() => window.typography.view.state.doc.toString()), "L'histoire...");
  });

  await t.test("selection replacement, multicursor paste, undo and redo remain native", async () => {
    const result = await page.evaluate(() => {
      window.setupTypography("Avant sélection Après");
      const view = window.typography.view;
      view.dispatch({ selection: { anchor: 6, head: 15 } });
      const pasted = window.pasteTypography("L'histoire...");
      const cursor = view.state.selection.main.head;
      window.TypographyTest.undo(view);
      const undone = view.state.doc.toString();
      window.TypographyTest.redo(view);
      return { pasted, cursor, undone, redone: view.state.doc.toString() };
    });
    assert.deepEqual(result, { pasted: "Avant L’histoire… Après", cursor: 17, undone: "Avant sélection Après", redone: "Avant L’histoire… Après" });
    const multiple = await page.evaluate(() => {
      window.setupTypography("a b");
      const api = window.TypographyTest;
      const view = window.typography.view;
      // Separate real state: CM only enables several ranges explicitly.
      const previous = view.state;
      view.setState(api.EditorState.create({ doc: "a b", selection: api.EditorSelection.create([api.EditorSelection.cursor(1), api.EditorSelection.cursor(3)]),
        extensions: [api.EditorState.allowMultipleSelections.of(true), api.history(), api.createLiveTypographyExtension(() => window.typography.options, state => ({ from: 0, to: state.doc.length }))] }));
      window.pasteTypography(" d'un...");
      const text = view.state.doc.toString();
      api.undo(view);
      return { text, original: view.state.doc.toString(), previous: previous.doc.toString() };
    });
    assert.deepEqual(multiple, { text: "a d’un… b d’un…", original: "a b", previous: "a b" });
  });

  await t.test("existing prose and technical contexts are never globally transformed", async () => {
    const result = await page.evaluate(() => {
      window.setupTypography("L'histoire...\n\n`l...`\n\nFin");
      const view = window.typography.view;
      view.dispatch({ selection: { anchor: 20 } });
      view.dispatch({ changes: { from: 20, insert: "'" }, userEvent: "input.type" });
      return view.state.doc.toString();
    });
    assert.equal(result, "L'histoire...\n\n`l...'`\n\nFin");
  });

  await t.test("composition, programmatic changes, prevented events and files bypass typography", async () => {
    for (const userEvent of ["input.type.compose", "undo", "redo", undefined]) {
      const result = await page.evaluate((userEvent) => {
        window.setupTypography();
        const view = window.typography.view;
        view.dispatch({ changes: { from: 0, insert: "L'histoire..." }, userEvent });
        return view.state.doc.toString();
      }, userEvent);
      assert.equal(result, "L'histoire...");
    }
    await page.evaluate(() => window.setupTypography());
    assert.equal(await page.evaluate(() => window.pasteTypography("L'histoire...", "", true)), "L'histoire...");
    await page.evaluate(() => window.setupTypography());
    assert.equal(await page.evaluate(() => window.pasteTypography("L'histoire...", "", false, true)), "");
    await page.evaluate(() => window.setupTypography("", {}, null, false));
    assert.equal(await page.evaluate(() => window.pasteTypography("L'histoire...")), "L'histoire...");
    const intercepted = await page.evaluate(() => {
      window.setupTypography();
      const api = window.TypographyTest;
      const view = window.typography.view;
      view.dispatch({ effects: api.StateEffect.appendConfig.of(api.EditorView.domEventHandlers({ paste(event, editor) {
        event.preventDefault();
        editor.dispatch({ changes: { from: 0, insert: "L'histoire..." }, userEvent: "input.paste" });
        return true;
      } })) });
      return window.pasteTypography("L'histoire...");
    });
    assert.equal(intercepted, "L'histoire...", "a plugin consuming editor-paste owns its transaction");
  });

  await t.test("Continu changes stay in their source body and cannot cross a protected joint", async () => {
    const result = await page.evaluate(() => {
      window.setupTypography("Première...\nDeuxième...", {}, [11]);
      const api = window.TypographyTest;
      const view = window.typography.view;
      view.dispatch({ selection: { anchor: 12 } });
      const pasted = window.pasteTypography("L'histoire... ");
      const boundaries = [...view.state.field(api.scriveningsBoundariesField)];
      api.undo(view);
      const undone = view.state.doc.toString();
      api.redo(view);
      view.dispatch({ selection: { anchor: 4, head: 15 } });
      const rejected = window.pasteTypography("L'histoire...");
      return { pasted, boundaries, undone, rejected };
    });
    assert.deepEqual(result, { pasted: "Première...\nL’histoire… Deuxième...", boundaries: [11], undone: "Première...\nDeuxième...", rejected: "Première...\nL’histoire… Deuxième..." });
  });
  assert.deepEqual(errors, []);
});
