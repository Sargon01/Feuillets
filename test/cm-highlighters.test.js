import test from "node:test";
import assert from "node:assert/strict";
import { applyEditorHighlights } from "../src/utils/cm-search-highlighter.js";

const view = () => ({ state: { doc: { length: 20 } }, calls: [], dispatch(value) { this.calls.push(value); } });

test("applyEditorHighlights : ignore les occurrences hors document", () => {
  const editor = view();
  applyEditorHighlights(editor, [{ index: 1, length: 3 }, { index: -1, length: 2 }, { index: 19, length: 2 }], 0);
  assert.equal(editor.calls.length, 1);
  assert.deepEqual(editor.calls[0].effects.value.map(({ from, to }) => [from, to]), [[1, 4]]);
});

