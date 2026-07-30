import test from "node:test";
import assert from "node:assert/strict";
import { applyEditorHighlights } from "../src/utils/cm-search-highlighter.js";
import { applyGrammarHighlights } from "../src/utils/cm-grammar-highlighter.js";

const view = () => ({ state: { doc: { length: 20 } }, calls: [], dispatch(value) { this.calls.push(value); } });

test("applyEditorHighlights : ignore les occurrences hors document", () => {
  const editor = view();
  applyEditorHighlights(editor, [{ index: 1, length: 3 }, { index: -1, length: 2 }, { index: 19, length: 2 }], 0);
  assert.equal(editor.calls.length, 1);
  assert.deepEqual(editor.calls[0].effects.value.map(({ from, to }) => [from, to]), [[1, 4]]);
});

test("applyGrammarHighlights : applique l'offset et conserve l'index", () => {
  const editor = view();
  applyGrammarHighlights(editor, [{ start: 2, end: 5, type: "spelling" }], 4);
  const [deco] = editor.calls[0].effects.value;
  assert.equal(deco.from, 6);
  assert.equal(deco.to, 9);
  assert.equal(deco.attributes["data-grammar-idx"], "0");
});
