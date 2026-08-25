import assert from "node:assert/strict";
import test from "node:test";
import { editorInfoField } from "obsidian";
import {
  documentLayoutPageBreakPlugin,
  DocumentLayoutPageBreakWidget,
  refreshDocumentPageBreakEffect,
  setDocumentLayoutPageBreakAnchors,
} from "../src/utils/cm-document-layout.js";

const field = documentLayoutPageBreakPlugin[0];
const viewPlugin = documentLayoutPageBreakPlugin[1];

function anchor(markdown, quote) {
  const start = markdown.indexOf(quote);
  return { start, end: start + quote.length, quote, prefix: markdown.slice(0, start), suffix: markdown.slice(start + quote.length) };
}

function stateFor(markdown, path = "Cours.md") {
  const doc = {
    toString: () => markdown,
    lineAt(pos) {
      const from = markdown.lastIndexOf("\n", pos - 1) + 1;
      return { from };
    },
  };
  return {
    doc,
    field(fieldName) {
      assert.equal(fieldName, editorInfoField);
      return { file: { path } };
    },
  };
}

function viewFor(state) {
  return { state, dispatches: [], dispatch(spec) { this.dispatches.push(spec); } };
}

test("page-break decorations are provided by the StateField, not the ViewPlugin", () => {
  assert.equal(typeof field.create, "function");
  assert.equal(typeof field.update, "function");
  assert.equal(field.provide(field), field);
  assert.equal(viewPlugin.__viewPluginSpec?.decorations, undefined);
});

test("page-break widget is virtual, block-positioned, and leaves Markdown unchanged", () => {
  const markdown = "Texte.\n\n## Chapitre";
  const state = stateFor(markdown);
  setDocumentLayoutPageBreakAnchors("Cours.md", [anchor(markdown, "## Chapitre")]);
  const decorations = field.create(state);
  assert.equal(decorations.length, 1);
  assert.equal(decorations[0].from, markdown.indexOf("## Chapitre"));
  assert.equal(decorations[0].block, true);
  assert.equal(decorations[0].side, -1);
  assert.ok(decorations[0].widget instanceof DocumentLayoutPageBreakWidget);
  assert.equal(state.doc.toString(), markdown);
});

test("StateEffect rafraîchit immédiatement ON puis OFF sans docChanged", () => {
  const markdown = "Texte.\n\n## Chapitre";
  const state = stateFor(markdown);
  const view = viewFor(state);
  const plugin = new viewPlugin(view);
  setDocumentLayoutPageBreakAnchors("Cours.md", [anchor(markdown, "## Chapitre")]);
  const on = field.update(field.create(state), { docChanged: false, effects: view.dispatches.at(-1).effects ? [{ is: (type) => type === refreshDocumentPageBreakEffect }] : [], state });
  assert.equal(on.length, 1);
  setDocumentLayoutPageBreakAnchors("Cours.md", []);
  const off = field.update(on, { docChanged: false, effects: [{ is: (type) => type === refreshDocumentPageBreakEffect }], state });
  assert.equal(off.length, 0);
  plugin.destroy();
});

test("docChanged reconstruit la décoration avant le heading résolu", () => {
  const initial = "Texte.\n\n## Chapitre";
  const next = "Introduction.\n\n" + initial;
  const state = stateFor(next);
  setDocumentLayoutPageBreakAnchors("Cours.md", [anchor(initial, "## Chapitre")]);
  const value = field.create(stateFor(initial));
  const updated = field.update(value, { docChanged: true, effects: [], state });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].from, next.indexOf("## Chapitre"));
  assert.equal(state.doc.toString(), next);
});

test("destroy désenregistre la vue avant l’invalidation suivante", () => {
  const state = stateFor("Texte.");
  const view = viewFor(state);
  const plugin = new viewPlugin(view);
  plugin.destroy();
  setDocumentLayoutPageBreakAnchors("Cours.md", []);
  assert.equal(view.dispatches.length, 0);
});
