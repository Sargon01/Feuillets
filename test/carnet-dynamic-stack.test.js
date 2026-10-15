import test from "node:test";
import assert from "node:assert/strict";
import { attachDynamicStacks, canStackDynamically, canUnstackDynamically, stackDynamically, stackMembership, unstackDynamically } from "../src/carnet/canvas/dynamic-stack.js";
import { attachNoteSizing } from "../src/carnet/canvas/note-size.js";
import { stackNotes } from "../src/carnet/canvas/stack-notes.js";
import { t, setLocale } from "../src/i18n/index.js";

const clone = (v) => structuredClone(v);
function fixture(count = 3) {
  const canvas = { nodes: new Map(), selection: new Set(), history: { data: [], current: -1 }, saves: [], moves: [], isDragging: false,
    getData() { return { nodes: [...this.nodes.values()].map((n) => n.getData()), edges: [{ id: "edge", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left", toEnd: "arrow", feuillets_edge_style: { pattern: "dotted" } }] }; },
    pushHistory(data) { this.history.data.splice(++this.history.current); this.history.data.push(clone(data)); },
    overrideHistory() { this.requestPushHistory.run(); this.history.data[this.history.current] = this.getData(); },
    requestSave(history = true) { this.saves.push(history); if (history) this.pending = this.getData(); },
    importData(data) { for (const raw of data.nodes) this.nodes.get(raw.id).setData(raw); },
    undo() { this.importData(this.history.data[--this.history.current]); }, redo() { this.importData(this.history.data[++this.history.current]); },
  };
  canvas.requestPushHistory = Object.assign(() => {}, { run() { if (canvas.pending) { canvas.pushHistory(canvas.pending); canvas.pending = undefined; } canvas.onFlush?.(); }, cancel() { canvas.pending = undefined; } });
  const frames = [];
  for (let i = 0; i < count; i++) {
    const id = String.fromCharCode(97 + i), classes = new Set();
    const node = { id, raw: { id, type: "text", text: `Note ${id}`, x: 20 + i * 90, y: -30.5 + i * 200, width: 180 + i * 35, height: 60.5 + i * 20, custom: true }, classes, renderedHeight: 200,
      getData() { return clone(this.raw); }, setData(raw) { this.raw = clone(raw); },
      moveTo(position) { canvas.moves.push(id); this.moveAndResize({ width: this.raw.width, height: this.raw.height, ...position }); },
      resize(size) { this.moveAndResize({ x: this.raw.x, y: this.raw.y, ...size }); },
      moveAndResize(rect) { this.raw = { ...this.raw, ...rect }; }, setIsEditing(active) { this.isEditing = active; },
      nodeEl: { getBoundingClientRect: () => ({ width: node.raw.width }), classList: { contains: (name) => classes.has(name), add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), toggle: (name, active) => active ? classes.add(name) : classes.delete(name) }, ownerDocument: { defaultView: { requestAnimationFrame: (callback) => frames.push(callback) } } },
      contentEl: { querySelector: () => ({ getClientRects: () => [{}], getBoundingClientRect: () => ({ width: node.raw.width - 2, height: classes.has("feuillets-note-measuring") ? node.renderedHeight : node.raw.height - 2 }) }) },
    };
    canvas.nodes.set(id, node);
  }
  canvas.selection = new Set([...canvas.nodes.values()].reverse()); canvas.pushHistory(canvas.getData());
  const stacks = attachDynamicStacks(canvas);
  const sizing = attachNoteSizing(canvas, undefined, undefined, undefined, stacks); sizing.refresh(new Set(canvas.nodes.keys()));
  return { canvas, stacks, sizing, frames, cleanup() { stacks.cleanup(); sizing.cleanup(); } };
}
function aligned(canvas, ids = ["a", "b", "c"]) {
  for (let i = 1; i < ids.length; i++) {
    const previous = canvas.nodes.get(ids[i - 1]).raw, current = canvas.nodes.get(ids[i]).raw;
    assert.equal(current.x, previous.x); assert.equal(current.y, previous.y + previous.height);
  }
}
function edit(f, id) {
  const node = f.canvas.nodes.get(id), requests = [];
  const cm = { contentDOM: {}, dom: { isConnected: true }, contentHeight: 200,
    scrollDOM: { get clientHeight() { return node.raw.height - 2; }, scrollTop: 0, ownerDocument: { defaultView: { getComputedStyle: () => ({ content: "none" }) } } },
    state: { doc: { toString: () => node.raw.text } }, requestMeasure: (request) => requests.push(request),
  };
  const mode = { cm, onUpdate() {} }; node.child = { editMode: mode }; node.setIsEditing(true);
  return { cm, mode, flush() { const request = requests.pop(); requests.length = 0; request?.write(request.read()); } };
}
for (const count of [2, 3]) test(`create a ${count}-note relationship with one native history action and independent widths`, () => {
  const f = fixture(count), c = f.canvas, before = c.getData(); assert(canStackDynamically(c)); assert(stackDynamically(c));
  aligned(c, [...c.nodes.keys()]); assert.equal(c.history.data.length, 2); assert.deepEqual(c.saves, [false]);
  const id = stackMembership(c.nodes.get("a").raw).id; assert(id);
  [...c.nodes.values()].forEach((node, order) => { assert.deepEqual(node.raw.feuillets_stack, { id, order }); assert.equal(node.raw.width, before.nodes[order].width); assert.equal(node.raw.height, before.nodes[order].height); assert.equal(node.raw.text, before.nodes[order].text); });
  assert.deepEqual(c.getData().edges, before.edges); assert.equal(c.nodes.get("a").raw.y, before.nodes[0].y); f.cleanup();
});
for (const [id, delta] of [["a", 120], ["b", 120], ["c", 120], ["a", -25], ["b", -25]]) test(`height change ${delta} in ${id} moves only followers with exactly zero gap`, () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); const before = c.getData(); c.moves.length = 0;
  const node = c.nodes.get(id); node.resize({ width: node.raw.width, height: node.raw.height + delta }); aligned(c);
  for (const previous of before.nodes) assert.equal(c.nodes.get(previous.id).raw.y, previous.y + (previous.id > id ? delta : 0));
  assert.deepEqual(c.moves, before.nodes.filter((n) => n.id > id).map((n) => n.id)); assert.equal(c.history.data.length, 2); f.cleanup();
});
test("spatial ties use X then stable ID instead of selection order", () => {
  const f = fixture(), c = f.canvas; for (const node of c.nodes.values()) { node.raw.y = 0; node.raw.x = node.id === "a" ? 100 : 50; }
  c.history.data[0] = c.getData(); assert(stackDynamically(c)); aligned(c, ["b", "c", "a"]);
  assert.deepEqual(["b", "c", "a"].map((id) => c.nodes.get(id).raw.feuillets_stack.order), [0, 1, 2]); f.cleanup();
});
test("repeated stable measurements neither move notes nor save nor add history", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); const before = c.getData(), saves = c.saves.length; c.moves.length = 0;
  f.stacks.geometryChanged(c.nodes.get("a")); f.stacks.beforeSave(); f.stacks.geometryChanged(c.nodes.get("b"));
  assert.deepEqual(c.getData(), before); assert.equal(c.moves.length, 0); assert.equal(c.saves.length, saves); assert.equal(c.history.data.length, 2); f.cleanup();
});
test("live typing, deletion and editor exit use the existing measured height without extra snapshots", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); const editor = edit(f, "a"), before = c.getData(); editor.flush(); aligned(c);
  assert.equal(c.nodes.get("a").raw.height, 202); assert(c.nodes.get("b").raw.y > before.nodes[1].y);
  editor.cm.contentHeight = 40; editor.mode.onUpdate({ docChanged: true, geometryChanged: false }, true); editor.flush(); aligned(c);
  assert.equal(c.nodes.get("a").raw.height, 50); assert.equal(c.history.data.length, 2); assert.equal(c.saves.length, 1);
  c.nodes.get("a").setIsEditing(false); aligned(c); assert.equal(c.nodes.get("a").raw.height, before.nodes[0].height); f.cleanup();
});
test("font changes reflow after preview measurement inside the existing typography checkpoint", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); const node = c.nodes.get("b"), top = clone(c.nodes.get("a").raw);
  node.setData({ ...node.raw, feuillets_text_style: { size: 32 } }); c.requestSave(); f.sizing.update(node, true); aligned(c);
  assert.equal(node.raw.height, 202); assert.deepEqual(c.nodes.get("a").raw, top); assert.equal(c.history.data.length, 3);
  assert.deepEqual(c.history.data[c.history.current], c.getData()); node.renderedHeight = 70;
  node.setData({ ...node.raw, feuillets_text_style: { size: 12 } }); c.requestSave(); f.sizing.update(node, true); aligned(c);
  assert.equal(node.raw.height, 72); assert.deepEqual(c.history.data[c.history.current], c.getData()); f.cleanup();
});
test("manual width uses the native resize save and final measured wrapping height", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); const node = c.nodes.get("b"), a = clone(c.nodes.get("a").raw);
  node.classes.add("is-dragging"); node.moveAndResize({ x: node.raw.x, y: node.raw.y, width: 310, height: 150 });
  c.requestSave(); node.classes.delete("is-dragging"); f.frames.splice(0).forEach((frame) => frame()); aligned(c);
  assert.equal(node.raw.width, 310); assert.equal(node.raw.height, 202); assert.equal(node.raw.feuillets_note_width, "manual"); assert(node.raw.feuillets_stack);
  assert.deepEqual(c.nodes.get("a").raw, a); assert.equal(c.history.data.length, 3); assert.deepEqual(c.history.data[c.history.current], c.getData()); f.cleanup();
});
test("multiple stacks retain separate identities and never merge implicitly", () => {
  const f = fixture(4), c = f.canvas; c.selection = new Set([c.nodes.get("a"), c.nodes.get("b")]); stackDynamically(c);
  c.selection = new Set([c.nodes.get("c"), c.nodes.get("d")]); stackDynamically(c); const other = clone(c.nodes.get("c").raw);
  assert.notEqual(c.nodes.get("a").raw.feuillets_stack.id, other.feuillets_stack.id);
  c.nodes.get("a").resize({ width: 180, height: 300 }); aligned(c, ["a", "b"]); assert.deepEqual(c.nodes.get("c").raw, other);
  c.selection = new Set([c.nodes.get("a"), c.nodes.get("c")]); assert(!canStackDynamically(c)); assert(!stackDynamically(c)); f.cleanup();
});
test("JSON persistence restores relationships without saving or moving on binding", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); const saved = JSON.parse(JSON.stringify(c.getData())); f.cleanup();
  const reopened = fixture(); reopened.canvas.importData(saved); assert.deepEqual(reopened.canvas.getData(), saved); assert.equal(reopened.canvas.saves.length, 0); assert.equal(reopened.canvas.moves.length, 0);
  reopened.canvas.nodes.get("b").resize({ width: 215, height: 300 }); aligned(reopened.canvas); reopened.cleanup();
});
test("dissociation removes the whole selected relationship without changing rectangles and is one Undo/Redo", () => {
  const f = fixture(), c = f.canvas, initial = c.getData(); stackDynamically(c); const stacked = c.getData(); c.selection = new Set([c.nodes.get("b")]);
  assert(canUnstackDynamically(c)); assert(unstackDynamically(c)); const unstacked = c.getData(); assert.equal(c.history.data.length, 3);
  assert.deepEqual(unstacked, { ...stacked, nodes: stacked.nodes.map(({ feuillets_stack, ...raw }) => raw) });
  c.undo(); assert.deepEqual(c.getData(), stacked); c.undo(); assert.deepEqual(c.getData(), initial); c.redo(); c.redo(); assert.deepEqual(c.getData(), unstacked);
  const position = c.nodes.get("b").raw.y; c.nodes.get("a").resize({ width: 180, height: 300 }); assert.equal(c.nodes.get("b").raw.y, position); f.cleanup();
});
test("deletion closes the gap during the native save and cleans a remaining singleton", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); c.nodes.delete("b"); c.requestSave(); aligned(c, ["a", "c"]); assert(c.nodes.get("c").raw.feuillets_stack);
  c.nodes.delete("a"); c.requestSave(); assert.equal(c.nodes.get("c").raw.feuillets_stack, undefined); f.cleanup();
});
test("a genuine native drag detaches the moved member and closes the remaining gap in its save", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); const b = c.nodes.get("b"); c.isDragging = true; b.classes.add("is-dragging"); b.moveTo({ x: 500, y: 500 });
  b.classes.delete("is-dragging"); c.isDragging = false; c.requestSave(); assert.equal(b.raw.feuillets_stack, undefined); assert.equal(b.raw.y, 500); aligned(c, ["a", "c"]);
  assert(c.nodes.get("a").raw.feuillets_stack); assert(c.nodes.get("c").raw.feuillets_stack); f.cleanup();
});
test("cancelled dragging preserves membership and automatic reflow never detaches followers", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); const b = c.nodes.get("b"), before = clone(b.raw); c.isDragging = true; b.classes.add("is-dragging");
  b.moveTo({ x: 500, y: 500 }); b.moveTo(before); b.classes.delete("is-dragging"); c.isDragging = false; c.requestSave(); assert.deepEqual(b.raw, before);
  c.nodes.get("a").resize({ width: 180, height: 250 }); c.requestSave(); assert(b.raw.feuillets_stack); aligned(c); f.cleanup();
});
for (const metadata of [null, {}, { id: "", order: 0 }, { id: "stack", order: -1 }, { id: "stack", order: 1.5 }, { id: 2, order: 1 }]) test(`malformed membership is inert and cleaned only on the next native save: ${JSON.stringify(metadata)}`, () => {
  const f = fixture(), c = f.canvas, a = c.nodes.get("a"); a.raw.feuillets_stack = metadata; const before = clone(a.raw);
  assert.equal(stackMembership(a.raw), undefined); f.stacks.geometryChanged(a); assert.deepEqual(a.raw, before); assert.equal(c.saves.length, 0);
  c.requestSave(); assert.equal(a.raw.feuillets_stack, undefined); f.cleanup();
});
for (const metadata of [{ type: "file" }, { type: "group" }, { feuillets_plan_version: 1 }, { feuillets_block_id: "map" }, { feuillets_managed: "research" }, { mindmapCollapsed: [] }]) test(`mixed structural selections are excluded: ${JSON.stringify(metadata)}`, () => {
  const f = fixture(), c = f.canvas; Object.assign(c.nodes.get("b").raw, metadata); const before = c.getData(); assert(!canStackDynamically(c)); assert(!stackDynamically(c)); assert.deepEqual(c.getData(), before); f.cleanup();
});
test("punctual stacking still leaves no persistent relationship", () => {
  const f = fixture(), c = f.canvas; assert(stackNotes(c)); assert(c.getData().nodes.every((n) => !n.feuillets_stack));
  const position = c.nodes.get("b").raw.y; c.nodes.get("a").resize({ width: 180, height: 300 }); assert.equal(c.nodes.get("b").raw.y, position); f.cleanup();
});
test("suspended imports, readonly canvases and disposed bindings never reflow", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); f.cleanup(); const before = c.nodes.get("b").raw.y;
  let importing = true; const stacks = attachDynamicStacks(c, () => importing); c.nodes.get("a").raw.height = 300;
  stacks.geometryChanged(c.nodes.get("a")); assert.equal(c.nodes.get("b").raw.y, before); importing = false; c.readonly = true;
  stacks.beforeSave(); assert.equal(c.nodes.get("b").raw.y, before); c.readonly = false; stacks.cleanup(); stacks.geometryChanged(c.nodes.get("a")); assert.equal(c.nodes.get("b").raw.y, before);
});
test("concurrent edits and overflowing geometry abort creation before metadata or movement", () => {
  for (const mutate of [(c) => { c.onFlush = () => { c.nodes.get("b").raw.text = "Concurrent edit"; }; }, (c) => { for (const n of c.nodes.values()) n.raw.height = Number.MAX_VALUE; }]) {
    const f = fixture(); mutate(f.canvas); assert(!stackDynamically(f.canvas)); assert(f.canvas.getData().nodes.every((n) => !n.feuillets_stack)); assert.equal(f.canvas.moves.length, 0); f.cleanup();
  }
});
test("Binder menu and dynamic action translations use the requested labels", () => {
  setLocale("en"); assert.equal(t("binder.visualOutline"), "Notebook"); assert.equal(t("carnet.dynamicStack.title"), "Stack dynamically"); assert.equal(t("carnet.dynamicStack.dissociate"), "Unstack dynamically");
  setLocale("fr"); assert.equal(t("binder.visualOutline"), "Carnet"); assert.equal(t("carnet.dynamicStack.title"), "Empiler dynamiquement"); assert.equal(t("carnet.dynamicStack.dissociate"), "Dissocier l'empilement"); setLocale("en");
});

test("duplicate stack orders are inert until native save repairs only their membership", () => {
  const f = fixture(), c = f.canvas; stackDynamically(c); const a = c.nodes.get("a"), b = c.nodes.get("b"); b.raw.feuillets_stack.order = 0;
  const positions = c.getData().nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
  f.stacks.geometryChanged(a); c.requestSave(); assert(c.getData().nodes.every((n) => n.feuillets_stack === undefined));
  assert.deepEqual(c.getData().nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })), positions); f.cleanup();
});
test("one Undo/Redo restores creation metadata even when the initial geometry was already stacked", () => {
  const f = fixture(), c = f.canvas; stackNotes(c); const before = c.getData(), entries = c.history.data.length;
  assert(stackDynamically(c)); const after = c.getData(); assert.equal(c.history.data.length, entries + 1); c.undo(); assert.deepEqual(c.getData(), before); c.redo(); assert.deepEqual(c.getData(), after); f.cleanup();
});
