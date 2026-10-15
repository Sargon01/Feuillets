import test from "node:test";
import assert from "node:assert/strict";
import { canStackNotes, stackNotes } from "../src/carnet/canvas/stack-notes.js";

const clone = (value) => structuredClone(value);
function fixture(nodes = [
  { id: "a", x: 80.5, y: -30.25, width: 110, height: 55.5 },
  { id: "b", x: -40, y: 180, width: 210, height: 125.25 },
  { id: "c", x: 500, y: 65, width: 155, height: 90 },
]) {
  const data = { nodes: nodes.map((node) => ({ type: "text", text: "**Bold** and [link](target)", unknown: { keep: true }, ...node })),
    edges: nodes.length > 1 ? [{ id: "ab", fromNode: nodes[0].id, toNode: nodes[1].id, toEnd: "none", color: "3", label: "Keep", feuillets_edge_style: { pattern: "dotted", width: "thick" }, unknown: true }] : [], unknownRoot: true };
  const c = { nodes: new Map(), selection: new Set(), history: { data: [], current: -1 }, saves: [], moves: [], pending: false,
    getData() { return { ...clone(data), nodes: [...this.nodes.values()].map((n) => n.getData()) }; },
    requestSave(history) { this.saves.push(history); },
    pushHistory(d) { this.history.data.splice(++this.history.current); this.history.data.push(clone(d)); },
    importData(d) { for (const raw of d.nodes) this.nodes.get(raw.id).raw = clone(raw); },
    undo() { this.importData(this.history.data[--this.history.current]); },
    redo() { this.importData(this.history.data[++this.history.current]); },
  };
  c.requestPushHistory = Object.assign(() => {}, { run() { if (c.pending) { c.pushHistory(c.getData()); c.pending = false; } c.onFlush?.(); }, cancel() { c.pending = false; } });
  for (const raw of data.nodes) c.nodes.set(raw.id, { id: raw.id, raw: clone(raw),
    getData() { return clone(this.raw); }, moveTo(pos) { c.moves.push(this.id); this.raw = { ...this.raw, ...pos }; },
  });
  c.selection = new Set([...c.nodes.values()].reverse()); c.pushHistory(c.getData());
  return c;
}
function checkStack(c, before) {
  const ordered = before.nodes.slice().sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let y = ordered[0].y;
  for (const raw of ordered) {
    assert.deepEqual(c.nodes.get(raw.id).getData(), { ...raw, x: ordered[0].x, y });
    y += raw.height;
  }
  assert.deepEqual(c.getData().edges, before.edges);
  assert.equal(c.getData().unknownRoot, true);
}

test("two equal notes form a zero-gap column at the original topmost position", () => {
  const c = fixture([{ id: "a", x: -100, y: -50, width: 100, height: 60 }, { id: "b", x: 300, y: 100, width: 100, height: 60 }]), before = c.getData(), selection = [...c.selection];
  assert(canStackNotes(c)); assert(stackNotes(c)); checkStack(c, before);
  assert.deepEqual([...c.selection], selection); assert.deepEqual(c.moves, ["b"]);
});
test("different widths and fractional heights preserve all geometry except X/Y and stack in spatial order", () => {
  const c = fixture(), before = c.getData(); assert(stackNotes(c)); checkStack(c, before);
  assert.deepEqual(c.moves, ["c", "b"]); assert.deepEqual(c.saves, [false]);
  assert.equal(c.history.data.length, 2);
});
test("Y, X and stable node IDs determine order independently of selection order", () => {
  const raw = [{ id: "c", x: 5, y: 10, width: 50, height: 20 }, { id: "b", x: -5, y: 10, width: 60, height: 30 }, { id: "a", x: -5, y: 10, width: 70, height: 40 }];
  for (const order of [["a", "b", "c"], ["c", "a", "b"], ["b", "c", "a"]]) {
    const c = fixture(raw), before = c.getData(); c.selection = new Set(order.map((id) => c.nodes.get(id)));
    assert(stackNotes(c)); checkStack(c, before); assert.equal(c.nodes.get("a").raw.y, 10);
  }
});
test("an already stacked selection leaves saves, movement, pending history and redo untouched", () => {
  const c = fixture(); stackNotes(c); const before = c.getData(), moves = c.moves.length, saves = c.saves.length, entries = c.history.data.length;
  c.history.data.push(clone(before)); c.pending = true;
  assert(stackNotes(c)); assert.deepEqual(c.getData(), before);
  assert.equal(c.moves.length, moves); assert.equal(c.saves.length, saves); assert.equal(c.history.data.length, entries + 1); assert(c.pending);
});
test("one Undo and Redo restore the entire selection and keep the preceding native edit accessible", () => {
  const c = fixture(), original = c.getData(); c.nodes.get("a").raw.text = "Previous edit"; c.pending = true;
  const before = c.getData(); assert(stackNotes(c)); const after = c.getData(); assert.equal(c.history.data.length, 3);
  c.undo(); assert.deepEqual(c.getData(), before); c.undo(); assert.deepEqual(c.getData(), original);
  c.redo(); c.redo(); assert.deepEqual(c.getData(), after);
  const reopened = fixture(); reopened.importData(JSON.parse(JSON.stringify(after))); assert.deepEqual(reopened.getData(), after);
});
test("native saturated history preserves the preceding entry while stacking all notes in one action", () => {
  const c = fixture(), before = c.getData(); c.pushHistory(before); const push = c.pushHistory;
  c.pushHistory = function (data) { push.call(this, data); if (this.history.data.length > 2) { this.history.data.shift(); this.history.current--; } };
  assert(stackNotes(c)); const after = c.getData(); assert.equal(c.history.data.length, 2);
  c.undo(); assert.deepEqual(c.getData(), before); c.redo(); assert.deepEqual(c.getData(), after);
});
for (const metadata of [{ type: "file" }, { type: "group" }, { feuillets_plan_version: 2 }, { feuillets_block_id: "map" }, { mindmapCollapsed: [] }, { feuillets_managed: "research" }]) test(`mixed selections reject unsupported metadata ${JSON.stringify(metadata)}`, () => {
  const c = fixture(); Object.assign(c.nodes.get("b").raw, metadata); const before = c.getData();
  assert(!canStackNotes(c)); assert(!stackNotes(c)); assert.deepEqual(c.getData(), before); assert.equal(c.moves.length, 0); assert.equal(c.saves.length, 0);
});
for (const change of [
  (c) => { c.selection = new Set([c.nodes.get("a")]); },
  (c) => { c.selection.add({ id: "ab", getData: () => c.getData().edges[0] }); },
  (c) => { c.nodes.get("a").isEditing = true; },
  (c) => { c.readonly = true; }, (c) => { c.isDragging = true; }, (c) => { c.isHoldingSpace = true; },
  (c) => { delete c.nodes.get("c").moveTo; }, (c) => { delete c.requestPushHistory.cancel; },
  (c) => { c.nodes.get("a").raw.height = NaN; }, (c) => { c.nodes.get("a").raw.width = 0; },
]) test("ineligible selection or incomplete native contracts never cause partial movement", () => {
  const c = fixture(); change(c); assert(!canStackNotes(c)); assert(!stackNotes(c)); assert.equal(c.moves.length, 0); assert.equal(c.saves.length, 0);
});
for (const change of [
  (c) => { c.nodes.get("b").raw.text = "Concurrent edit"; },
  (c) => { c.selection.delete(c.nodes.get("b")); },
  (c) => { c.nodes.set("b", { ...c.nodes.get("b") }); },
  (c) => { c.history.data[c.history.current].unknownRoot = false; },
  (c) => { c.history = { ...c.history }; }, (c) => { c.readonly = true; },
  (c) => { delete c.nodes.get("b").moveTo; }, (c) => { delete c.requestSave; },
]) test("concurrent mutations during pending history finalization abort before any node moves", () => {
  const c = fixture(); c.onFlush = () => change(c); assert(!stackNotes(c)); assert.equal(c.moves.length, 0); assert.equal(c.saves.length, 0);
});
test("an inactive or closing view cannot stack notes after finalizing pending history", () => {
  const c = fixture(); let active = true; c.onFlush = () => { active = false; };
  assert(!stackNotes(c, () => active)); assert.equal(c.moves.length, 0);
});
test("appearances, typography, manual widths and unrelated nodes or edges remain intact", () => {
  const c = fixture(); Object.assign(c.nodes.get("a").raw, { feuillets_note_style: "plain", feuillets_text_style: { size: 28, align: "center" } });
  Object.assign(c.nodes.get("b").raw, { feuillets_note_style: "filled", feuillets_note_width: "manual", color: "2" });
  Object.assign(c.nodes.get("c").raw, { feuillets_note_style: "outline", feuillets_text_style: { size: 12 } });
  const extra = { id: "unrelated", type: "group", x: 5, y: 8, width: 900, height: 900 };
  c.nodes.set(extra.id, { id: extra.id, raw: extra, getData() { return clone(this.raw); } });
  const before = c.getData(); c.history.data[0] = clone(before); assert(stackNotes(c));
  assert.deepEqual(c.nodes.get(extra.id).getData(), extra);
  checkStack(c, { ...before, nodes: before.nodes.filter((n) => n.id !== extra.id) });
});

test("managed incident connections exclude otherwise free-text notes", () => {
  const c = fixture(); c.getData = function () { return { nodes: [...this.nodes.values()].map((n) => n.getData()), edges: [{ id: "managed", fromNode: "a", toNode: "b", feuillets_managed: "relations" }] }; };
  const before = c.getData(); assert(!canStackNotes(c)); assert(!stackNotes(c));
  assert.deepEqual(c.getData(), before); assert.equal(c.moves.length, 0);
});
test("overflowing accumulated geometry is rejected before history or movement", () => {
  const c = fixture([{ id: "a", x: 10, y: 0, width: 100, height: Number.MAX_VALUE }, { id: "b", x: 20, y: 5, width: 100, height: Number.MAX_VALUE }]);
  const before = c.getData(); let flushed = false; c.onFlush = () => { flushed = true; };
  assert(!stackNotes(c)); assert(!flushed); assert.equal(c.moves.length, 0); assert.deepEqual(c.getData(), before);
});

test("malformed native history or exports leave stacking unavailable without movement", () => {
  for (const history of [{ data: [], current: 0 }, { data: [null], current: 0 }, { data: [{}], current: 0 }]) {
    const c = fixture(); c.history = history;
    assert(!canStackNotes(c)); assert(!stackNotes(c)); assert.equal(c.moves.length, 0);
  }
  const c = fixture(); c.getData = () => ({});
  assert(!canStackNotes(c)); assert(!stackNotes(c)); assert.equal(c.moves.length, 0);
});
