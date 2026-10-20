import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTextStyle, formatNoteSelection } from "../src/carnet/canvas/text-style.js";

test("typography normalizes unsafe values and removes default alignment and unsupported colors", () => {
  assert.equal(normalizeTextStyle(undefined), undefined);
  assert.equal(normalizeTextStyle({ size: NaN, align: "left", color: "#ffffff" }), undefined);
  assert.deepEqual(normalizeTextStyle({ size: 2, align: "right", color: "red" }), { size: 12, align: "right", color: "red" });
  assert.deepEqual(normalizeTextStyle({ size: 90, align: "justify" }), { size: 40, align: "justify" });
});
for (const format of ["bold", "italic", "strikethrough"]) test(`selected ${format} delegates to the native editor without replacing the note`, () => {
  const calls = [], editor = { getSelection: () => "selected", toggleMarkdownFormatting: (name) => calls.push(name), focus: () => calls.push("focus") };
  const node = { isEditing: true, child: { editor }, setData: () => assert.fail("Node content must not be replaced") };
  assert.equal(formatNoteSelection(node, format), true); assert.deepEqual(calls, [format, "focus"]);
  editor.getSelection = () => ""; assert.equal(formatNoteSelection(node, format), false); assert.equal(calls.length, 2);
  node.isEditing = false; assert.equal(formatNoteSelection(node, format), false);
});
test("underline uses only the editor selection and restores the selected range", () => {
  const calls = [], editor = { getSelection: () => "**selected**", toggleMarkdownFormatting() {}, getCursor: () => ({ line: 0, ch: 6 }), posToOffset: () => 6, offsetToPos: (ch) => ({ line: 0, ch }), replaceSelection: (text) => calls.push(text), setSelection: (...range) => calls.push(range), focus() {} };
  const node = { isEditing: true, child: { editor } };
  assert.equal(formatNoteSelection(node, "underline"), true);
  assert.equal(calls[0], "<u>**selected**</u>"); assert.deepEqual(calls[1], [{ line: 0, ch: 9 }, { line: 0, ch: 21 }]);
  editor.getSelection = () => "First\nSecond"; assert.equal(formatNoteSelection(node, "underline"), false); assert.equal(calls.length, 2);
  assert.equal(formatNoteSelection({ isEditing: true }, "bold"), false);
});

test("scoped typography survives native editor class replacement and cleans up without injected styles", async () => {
  const { refreshTextStyle, bindTextEditor } = await import("../src/carnet/canvas/text-style.js");
  const element = () => { const values = new Map(), attributes = new Map(), classes = new Set(); return { values, attributes, classes, style: { setProperty: (k, v) => values.set(k, v), removeProperty: (k) => values.delete(k) }, setAttribute: (k, v) => attributes.set(k, v), removeAttribute: (k) => attributes.delete(k), classList: { toggle: (k, active) => active ? classes.add(k) : classes.delete(k) } }; };
  const root = element(), dom = element(), editor = { cm: { dom, contentDOM: {}, requestMeasure() {} }, onUpdate() {} };
  const node = { isEditing: true, nodeEl: root, getData: () => ({ type: "text", feuillets_text_style: { size: 24, align: "justify", color: "green" } }), child: { editMode: editor } };
  const cleanup = bindTextEditor(node);
  assert.equal(dom.values.get("--feuillets-text-size"), "24px");
  dom.classes.clear(); assert.equal(dom.attributes.get("data-feuillets-typography"), "true");
  assert.equal(root.values.get("--feuillets-text-align"), "justify");
  cleanup(); assert.equal(dom.values.size, 0); assert.equal(dom.attributes.size, 0);
  refreshTextStyle(node, false); assert.equal(root.values.size, 0); assert.equal(root.attributes.size, 0);
});
