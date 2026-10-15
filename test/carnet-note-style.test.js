import test from "node:test";
import assert from "node:assert/strict";
import { applyNoteAppearance, applyNoteStyle, attachCarnetNoteStyles, isFreeNote } from "../src/carnet/canvas/note-style.js";

const clone = (value) => structuredClone(value);
function fixture() {
  const original = { nodes: ["a", "b", "c", "d"].map((id, index) => ({ id, type: "text", text: "**Bold** *italic* [link](target)\n\n- First\n- Second", x: index * 300, y: 30, width: 240, height: 180, custom: { retained: true } })), edges: [], customRoot: "retained" };
  const canvas = { nodes: new Map(), history: [clone(original)], index: 0, saves: 0,
    getData() { return { ...clone(original), nodes: [...this.nodes.values()].map((node) => clone(node.raw)) }; },
    importData(data) { for (const raw of data.nodes) { const node = this.nodes.get(raw.id); if (node) node.setData(clone(raw)); } },
    requestSave() { this.saves++; },
    pushHistory(data) { this.history.splice(++this.index); this.history.push(clone(data)); },
    undo() { this.importData(this.history[--this.index], true); },
    redo() { this.importData(this.history[++this.index], true); },
  };
  canvas.requestPushHistory = Object.assign(() => {}, { run() {}, cancel() {} });
  for (const raw of original.nodes) {
    const classes = new Set();
    canvas.nodes.set(raw.id, { id: raw.id, raw: clone(raw), getData() { return clone(this.raw); }, setData(data) { this.raw = clone(data); }, nodeEl: { classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); }, remove(...names) { names.forEach((name) => classes.delete(name)); } } }, classes });
  }
  return canvas;
}

test("four independent styles preserve all Markdown and unknown properties, default removes only the style", () => {
  const canvas = fixture();
  const before = canvas.getData();
  const binding = attachCarnetNoteStyles(canvas);
  for (const [index, style] of ["plain", "outline", "rounded", "filled"].entries()) {
    const id = before.nodes[index].id;
    assert.equal(applyNoteStyle(canvas, id, style), true);
    binding.refresh();
    assert.equal(canvas.nodes.get(id).classes.has(`feuillets-note-${style}`), true);
  }
  for (const raw of canvas.getData().nodes) { const { feuillets_note_style, ...rest } = raw; assert.deepEqual(rest, before.nodes.find((n) => n.id === raw.id)); }
  assert.equal(canvas.saves, 4);
  assert.equal(applyNoteStyle(canvas, "a", "plain"), true);
  assert.equal(canvas.saves, 4);
  assert.equal(canvas.history.length, 5);
  assert.equal(applyNoteStyle(canvas, "a", undefined), true);
  binding.refresh();
  assert.deepEqual(canvas.nodes.get("a").getData(), before.nodes[0]);
  assert.deepEqual([...canvas.nodes.get("a").classes], ["feuillets-note-plain"]);
});

test("native history and reopening restore styles and cleanup restores the import method", () => {
  const canvas = fixture();
  const originalImport = canvas.importData;
  const binding = attachCarnetNoteStyles(canvas);
  const instance = canvas.nodes.get("a");
  applyNoteStyle(canvas, "a", "plain"); binding.refresh();
  canvas.undo();
  assert.deepEqual([...instance.classes], ["feuillets-note-plain"]);
  canvas.redo();
  assert.equal(instance.classes.has("feuillets-note-plain"), true);
  assert.equal(canvas.nodes.get("a"), instance);
  const persisted = JSON.parse(JSON.stringify(canvas.getData()));
  const reopened = fixture(); reopened.importData(persisted);
  const reopenedBinding = attachCarnetNoteStyles(reopened); reopenedBinding.refresh();
  assert.equal(reopened.nodes.get("a").classes.has("feuillets-note-plain"), true);
  binding.cleanup(); binding.cleanup(); reopenedBinding.cleanup();
  assert.equal(canvas.importData, originalImport);
  assert.equal(instance.classes.size, 0);
  assert.equal(instance.getData().feuillets_note_style, "plain");
});

test("structural nodes, files and incomplete or readonly runtimes are left untouched", () => {
  for (const metadata of [{ type: "file", file: "Note.md" }, { type: "group" }, { feuillets_plan_version: 1 }, { feuillets_block_id: "block" }, { feuillets_managed: "manuscript" }, { feuillets_internal: true }, { mindmapCollapsed: [] }]) {
    const canvas = fixture(); Object.assign(canvas.nodes.get("a").raw, metadata);
    assert.equal(applyNoteStyle(canvas, "a", "plain"), false);
    assert.equal(canvas.saves, 0);
  }
  const canvas = fixture(); canvas.readonly = true;
  assert.equal(applyNoteStyle(canvas, "a", "plain"), false);
  delete canvas.pushHistory;
  assert.equal(attachCarnetNoteStyles(canvas), null);
  assert.equal(applyNoteStyle(canvas, "a", "plain"), false);
  assert.equal(isFreeNote({ nodes: [], edges: [{ id: "structural", fromNode: "a", feuillets_block_id: "block" }] }, { id: "a", type: "text" }), false);
});


test("missing appearance means plain without migrating data, and classic is an explicit native-card choice", () => {
  const canvas = fixture(), before = canvas.getData();
  const binding = attachCarnetNoteStyles(canvas); binding.refresh();
  assert.equal(canvas.nodes.get("a").classes.has("feuillets-note-plain"), true);
  assert.deepEqual(canvas.getData(), before);
  assert.equal(canvas.saves, 0);
  assert.equal(applyNoteStyle(canvas, "a", "classic"), true); binding.refresh();
  assert.deepEqual([...canvas.nodes.get("a").classes], ["feuillets-note-classic"]);
  canvas.nodes.get("a").raw.feuillets_note_width = "manual";
  assert.equal(isFreeNote(canvas.getData(), canvas.nodes.get("a").raw), true);
  binding.cleanup();
});

test("native history imports notify appearance controls without waiting for a toolbar render", () => {
  const canvas = fixture(), updates = [];
  const binding = attachCarnetNoteStyles(canvas, () => updates.push(canvas.nodes.get("a").getData().feuillets_note_style));
  applyNoteStyle(canvas, "a", "rounded"); binding.refresh();
  assert.equal(updates.at(-1), "rounded");
  const count = updates.length;
  canvas.undo(); assert.equal(updates.length, count + 1); assert.equal(updates.at(-1), undefined);
  canvas.redo(); assert.equal(updates.length, count + 2); assert.equal(updates.at(-1), "rounded");
  binding.cleanup();
});

test("independent typography uses one native transaction, normalizes defaults and preserves content and card color", () => {
  const c = fixture(), before = c.getData();
  c.nodes.get("a").raw.color = "4";
  assert(applyNoteAppearance(c, "a", { textStyle: { size: 24, align: "center", color: "purple" } }));
  assert.equal(c.saves, 1); assert.equal(c.history.length, 2);
  assert.deepEqual(c.nodes.get("a").getData(), { ...before.nodes[0], color: "4", feuillets_text_style: { size: 24, align: "center", color: "purple" } });
  assert(isFreeNote(c.getData(), c.nodes.get("a").getData()));
  assert.deepEqual(c.nodes.get("b").getData(), before.nodes[1]);
  applyNoteAppearance(c, "a", { textStyle: { size: 24, align: "center", color: "purple" } }); assert.equal(c.saves, 1);
  const saved = c.getData(); c.undo(); assert.equal(c.nodes.get("a").getData().feuillets_text_style, undefined);
  c.redo(); assert.deepEqual(c.getData(), saved);
  const reopened = fixture(); reopened.importData(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reopened.nodes.get("a").getData().feuillets_text_style, { size: 24, align: "center", color: "purple" });
  applyNoteAppearance(c, "a", { textStyle: { align: "left" } }); assert.equal(c.nodes.get("a").getData().feuillets_text_style, undefined);
  applyNoteAppearance(c, "a", { textStyle: undefined }); assert.equal(c.saves, 2);
});
