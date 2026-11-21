import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

test("formatting marks in real CodeMirror editors", async (t) => {
  const bundle = await build({
    stdin: { contents: `
      export { EditorState, StateField, StateEffect } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export { Language, defineLanguageFacet } from "@codemirror/language";
      export { parser } from "@lezer/markdown";
      export { history, undo, redo, cursorCharRight, cursorCharLeft } from "@codemirror/commands";
      export { FormattingMarksController } from "./src/utils/cm-formatting-marks.ts";
      export { scriveningsParagraphEndLookup } from "./src/utils/cm-scrivenings-markdown.ts";
      export { createScriveningsExtensions, setScriveningsDecorations, scriveningsBoundariesField } from "./src/utils/cm-scrivenings.ts";
      export { buildScriveningsDocument } from "./src/services/scrivenings-document.ts";
      export { TFile } from "obsidian";
    `, resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", globalName: "MarksTest",
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
  await page.addStyleTag({ content: await readFile("styles.css", "utf8") });
  await page.addStyleTag({ content: `body { --text-normal: #222; } .cm-editor { width: 340px; height: 190px; margin-bottom: 10px; }
    .cm-scroller { overflow: auto; } .cm-content { font: 16px/24px monospace; }` });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const api = window.MarksTest;
    const make = (tag, options = {}, parent) => {
      const element = document.createElement(tag);
      if (options.cls) element.className = options.cls;
      if (options.text) element.textContent = options.text;
      for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
      parent?.appendChild(element);
      return element;
    };
    window.createDiv = (options) => make("div", options);
    window.createSpan = (options) => make("span", options);
    HTMLElement.prototype.createSpan = function (options) { return make("span", options, this); };
    HTMLElement.prototype.createDiv = function (options) { return make("div", options, this); };
    HTMLElement.prototype.setCssStyles = function (styles) { Object.assign(this.style, styles); };
    let enabled = false;
    const controller = new api.FormattingMarksController(() => enabled);
    const scopeEffect = api.StateEffect.define();
    const scope = api.StateField.define({ create: () => true, update(value, tr) {
      for (const effect of tr.effects) if (effect.is(scopeEffect)) return effect.value;
      return value;
    } });
    const language = new api.Language(api.defineLanguageFacet(), api.parser, []);
    window.marks = {
      controller, editors: [], scopeEffect, scope,
      toggle(value) { enabled = value; controller.refresh(); },
      create(text, { continu = false, eligible = true, plain = false } = {}) {
        const parent = document.body.appendChild(document.createElement("div"));
        const extension = controller.extension({ eligible: (state) => state.field(scope),
          ...(continu ? {
            boundaries: (state) => state.field(api.scriveningsBoundariesField),
            paragraphEndLookup: (view) => api.scriveningsParagraphEndLookup(view.state.doc,
              view.state.field(api.scriveningsBoundariesField), view.visibleRanges),
          } : {}),
        });
        const view = new api.EditorView({ parent, state: api.EditorState.create({ doc: text,
          extensions: [scope, api.EditorView.lineWrapping, ...(continu ? api.createScriveningsExtensions() : [language, api.history()]),
            ...(plain ? [] : extension)],
        }) });
        if (!eligible) view.dispatch({ effects: scopeEffect.of(false) });
        this.editors.push(view);
        return this.editors.length - 1;
      },
      reset() { for (const view of this.editors) { const parent = view.dom.parentElement; view.destroy(); parent.remove(); } this.editors = []; },
      ends(index = 0) { return [...this.editors[index].dom.querySelectorAll(".feuillets-formatting-line-end")]
        .map((element) => ({ at: this.editors[index].state.doc.lineAt(this.editors[index].posAtDOM(element)).to,
          mark: element.dataset.feuilletsLineEnd })); },
    };
  });

  await t.test("disabled creates no decorations; toggles every open view and respects scope changes", async () => {
    await page.evaluate(() => {
      window.marks.create("Un  mot\n\nFin\n");
      window.marks.create("Deux mots\n");
      window.marks.create("Autre note\n", { eligible: false });
      window.marks.create("Lecture sans marques\n", { plain: true });
    });
    assert.equal(await page.locator(".cm-highlightSpace, .feuillets-formatting-line-end").count(), 0);
    await page.evaluate(() => window.marks.toggle(true));
    assert.equal(await page.locator(".cm-editor.feuillets-formatting-marks").count(), 2);
    const before = await page.evaluate(() => window.marks.editors.map((view) => ({ doc: view.state.doc.toString(), selection: view.state.selection.toJSON() })));
    await page.evaluate(() => window.marks.toggle(false));
    assert.equal(await page.locator(".cm-highlightSpace, .feuillets-formatting-line-end").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.marks.editors.map((view) => ({ doc: view.state.doc.toString(), selection: view.state.selection.toJSON() }))), before);
    await page.evaluate(() => { window.marks.toggle(true); window.marks.create("Nouvel éditeur\n"); });
    assert.equal(await page.locator(".cm-editor.feuillets-formatting-marks").count(), 3);
    await page.evaluate(() => window.marks.editors[2].dispatch({ effects: window.marks.scopeEffect.of(true) }));
    assert.equal(await page.locator(".cm-editor.feuillets-formatting-marks").count(), 4);
    await page.evaluate(() => window.marks.editors[0].dispatch({ effects: window.marks.scopeEffect.of(false) }));
    assert.equal(await page.locator(".cm-editor.feuillets-formatting-marks").count(), 3);
  });

  await t.test("single and double spaces, tabs and French nonbreaking spaces stay distinct", async () => {
    const text = "Un deux  trois\t«\u00a0Bonjour\u202f!\u00a0»\n";
    await page.evaluate((text) => { window.marks.reset(); window.marks.create(text); }, text);
    const result = await page.evaluate(() => {
      const dom = window.marks.editors[0].dom;
      return { spaces: [...dom.querySelectorAll(".cm-highlightSpace")].map((span) => span.textContent),
        tabs: dom.querySelectorAll(".cm-highlightTab").length, nbsp: dom.querySelectorAll(".feuillets-formatting-nbsp").length,
        nnbsp: dom.querySelectorAll(".feuillets-formatting-nnbsp").length,
        symbols: [".feuillets-formatting-nbsp", ".feuillets-formatting-nnbsp", ".cm-highlightTab"]
          .map((selector) => getComputedStyle(dom.querySelector(selector), "::before").content),
        text: window.marks.editors[0].state.doc.toString() };
    });
    assert.deepEqual(result, { spaces: [" ", " ", " "], tabs: 1, nbsp: 2, nnbsp: 1, symbols: ['"°"', '"˙"', '"→"'], text });
  });

  await t.test("physical soft/hard breaks and Markdown paragraph ends differ; visual wrapping adds nothing", async () => {
    const text = "Un paragraphe\nsur deux lignes\n\nDeux espaces  \nsaut forcé\\\nfin\n\n" + "longue ligne ".repeat(40) + "\n";
    await page.evaluate((text) => { window.marks.reset(); window.marks.create(text); }, text);
    const ends = await page.evaluate(() => window.marks.ends());
    assert.deepEqual(ends.slice(0, 7).map((end) => end.mark), ["↵", "¶", "¶", "↵", "↵", "¶", "¶"]);
    assert.equal(ends.length, (text.match(/\n/g) ?? []).length);
    const geometry = await page.evaluate(() => {
      const view = window.marks.editors[0];
      const positions = [0, 3, 13, 14, 29, 30, 60];
      const measure = () => positions.map((pos) => { const rect = view.coordsAtPos(pos); return [rect.left, rect.top]; });
      const lines = () => [...view.dom.querySelectorAll(".cm-line")].map((el) => { const rect = el.getBoundingClientRect(); return [rect.width, rect.height]; });
      const on = measure(); const onLines = lines(); window.marks.toggle(false); const off = measure(); const offLines = lines();
      window.marks.toggle(true);
      return { on, off, onLines, offLines };
    });
    for (let i = 0; i < geometry.on.length; i++) {
      assert.ok(Math.abs(geometry.on[i][0] - geometry.off[i][0]) < 0.1, JSON.stringify(geometry));
      assert.equal(geometry.on[i][1], geometry.off[i][1]);
    }
    assert.deepEqual(geometry.onLines, geometry.offLines);
  });

  await t.test("selection, native cursor movement, paste, undo and clipboard serialization preserve source", async () => {
    const text = "A  B\u00a0C\u202fD\tE\n\nFin\n";
    await page.evaluate((text) => { window.marks.reset(); window.marks.create(text); window.marks.editors[0].focus(); }, text);
    const result = await page.evaluate(() => {
      const view = window.marks.editors[0]; const api = window.MarksTest;
      view.dispatch({ selection: { anchor: 1 } }); api.cursorCharRight(view); api.cursorCharRight(view); api.cursorCharLeft(view);
      const head = view.state.selection.main.head;
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      const selected = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
      const copiedData = new window.DataTransfer();
      view.contentDOM.dispatchEvent(new window.ClipboardEvent("copy", { clipboardData: copiedData, bubbles: true, cancelable: true }));
      const copied = copiedData.getData("text/plain");
      window.marks.toggle(false); const afterToggle = view.state.selection.toJSON(); window.marks.toggle(true);
      const clipboard = view.dom.ownerDocument.createElement("div");
      const domRange = document.createRange(); domRange.selectNodeContents(view.contentDOM);
      clipboard.appendChild(domRange.cloneContents());
      const visibleClipboard = clipboard.textContent;
      const data = new window.DataTransfer(); data.setData("text/plain", "Collé  ici\u00a0!\n");
      view.contentDOM.dispatchEvent(new window.ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      const pasted = view.state.doc.toString(); api.undo(view);
      return { head, selected, copied, visibleClipboard, pasted, undone: view.state.doc.toString(), afterToggle };
    });
    assert.equal(result.head, 2);
    assert.equal(result.selected, text);
    assert.equal(result.copied, text);
    assert.doesNotMatch(result.visibleClipboard, /[¶↵°˙→·]/);
    assert.equal(result.pasted, "Collé  ici\u00a0!\n");
    assert.equal(result.undone, text);
    assert.deepEqual(result.afterToggle.ranges, [{ anchor: 0, head: text.length }]);
  });

  await t.test("Continu reuses Markdown rendering and never marks protected sheet junctions", async () => {
    const result = await page.evaluate(async () => {
      window.marks.reset(); const api = window.MarksTest;
      const source = ["# Titre\n\n**Gras** et *italique*\nsuite\n", "> Citation\n> suite\n\n```\n\ncode\n```\n", "Dernier  feuillet\n"];
      const composite = api.buildScriveningsDocument(source.map((content, i) => ({ file: new api.TFile(`Projet/${i}.md`), content })));
      window.marks.create(composite.text, { continu: true });
      const view = window.marks.editors[0];
      api.setScriveningsDecorations(view, composite, (file) => file.basename);
      await Promise.resolve();
      const boundaries = view.state.field(api.scriveningsBoundariesField);
      const ends = window.marks.ends();
      const markdown = { strong: !!view.dom.querySelector(".cm-scrivenings-strong"), emphasis: !!view.dom.querySelector(".cm-scrivenings-emphasis"),
        titles: view.dom.querySelectorAll(".feuillets-scrivenings-title").length };
      const original = view.state.doc.toString();
      view.dispatch({ changes: { from: boundaries[0], to: boundaries[0] + 1, insert: "" } });
      const guarded = view.state.doc.toString() === original;
      view.dispatch({ changes: { from: 0, insert: "Un  ajout\n\n" } });
      const moved = view.state.field(api.scriveningsBoundariesField);
      return { boundaries, ends, markdown, guarded, moved, movedEnds: window.marks.ends(), original, source: composite.text };
    });
    assert.equal(result.original, result.source);
    assert.ok(result.guarded);
    assert.deepEqual(result.markdown, { strong: true, emphasis: true, titles: 3 });
    assert.ok(result.ends.length > 0);
    assert.ok(result.ends.every((end) => !result.boundaries.includes(end.at)));
    assert.ok(result.movedEnds.every((end) => !result.moved.includes(end.at)));
  });

  await t.test("long manuscripts limit custom decorations to the viewport and stay responsive", async () => {
    const result = await page.evaluate(async () => {
      window.marks.reset(); window.marks.toggle(false);
      const text = "Texte  français\u00a0; fine\u202f!\t\n\n".repeat(20000);
      window.marks.create(text);
      const view = window.marks.editors[0];
      const offCount = view.dom.querySelectorAll(".cm-highlightSpace, .feuillets-formatting-line-end").length;
      const start = performance.now(); window.marks.toggle(true);
      const activationMs = performance.now() - start;
      const decorated = view.dom.querySelectorAll(".feuillets-formatting-line-end").length;
      const startTyping = performance.now(); view.dispatch({ changes: { from: 0, insert: "Ajout " } });
      const typingMs = performance.now() - startTyping;
      view.dispatch({ effects: window.MarksTest.EditorView.scrollIntoView(view.state.doc.length) });
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const scrolled = window.marks.ends(); window.marks.toggle(false);
      return { offCount, activationMs, typingMs, decorated, scrolled: scrolled.length, last: scrolled.at(-1)?.at,
        length: view.state.doc.length, disabled: view.dom.querySelectorAll(".cm-highlightSpace, .feuillets-formatting-line-end").length };
    });
    assert.equal(result.offCount, 0); assert.equal(result.disabled, 0);
    assert.ok(result.decorated > 0 && result.decorated < 300);
    assert.ok(result.scrolled > 0 && result.scrolled < 300);
    assert.ok(result.last > result.length - 1000);
    assert.ok(result.activationMs < 2000 && result.typingMs < 2000, JSON.stringify(result));
    t.diagnostic(`Long manuscript: ${result.length} characters; activation ${result.activationMs.toFixed(1)} ms, insertion ${result.typingMs.toFixed(1)} ms; ${result.decorated} visible line marks.`);
  });

  await t.test("long Continu manuscripts keep marks local to visible source sheets", async () => {
    const result = await page.evaluate(async () => {
      window.marks.reset(); window.marks.toggle(true);
      const api = window.MarksTest;
      const composite = api.buildScriveningsDocument(Array.from({ length: 100 }, (_, i) => ({
        file: new api.TFile(`Projet/Scène ${i}.md`), content: "Un  paragraphe\u00a0; fin\u202f!\n\n".repeat(120),
      })));
      window.marks.create(composite.text, { continu: true });
      const view = window.marks.editors[0];
      api.setScriveningsDecorations(view, composite, (file) => file.basename);
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const start = performance.now(); view.dispatch({ changes: { from: 0, insert: "Ajout " } });
      const typingMs = performance.now() - start;
      const ends = window.marks.ends();
      const boundaries = view.state.field(api.scriveningsBoundariesField);
      return { length: view.state.doc.length, marks: ends.length, typingMs,
        protected: ends.every((end) => !boundaries.includes(end.at)) };
    });
    assert.ok(result.marks > 0 && result.marks < 300);
    assert.ok(result.protected);
    assert.ok(result.typingMs < 2000, JSON.stringify(result));
    t.diagnostic(`Continu: ${result.length} characters across 100 sheets; insertion ${result.typingMs.toFixed(1)} ms; ${result.marks} visible line marks.`);
  });
  assert.deepEqual(errors, []);
});
