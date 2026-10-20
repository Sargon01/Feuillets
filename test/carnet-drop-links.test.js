import test from "node:test";
import assert from "node:assert/strict";
import { attachCarnetDropLinks, toggleDropLink, addDropLinks } from "../src/carnet/canvas/drop-links.js";
import { createCarnetLifecycle } from "../src/carnet/core/lifecycle.js";

const clone = (value) => structuredClone(value);
const initial = () => ({
  nodes: [
    { id: "a", type: "text", text: "A", x: 10, y: 20, width: 100, height: 60, color: "2", custom: { retained: true } },
    { id: "b", type: "text", text: "B", x: 300, y: 20, width: 100, height: 60 },
  ], edges: [], viewport: { x: 1 },
});

function fixture() {
  const listeners = new Map();
  const timers = new Map();
  const cleanups = [];
  let sequence = 0;
  let pending = null;
  let saves = 0;
  const wrapper = {
    isConnected: true,
    classList: { toggle() {}, remove() {} },
    ownerDocument: { defaultView: { setTimeout(fn) { timers.set(++sequence, fn); return sequence; }, clearTimeout(id) { timers.delete(id); } } },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  const nodes = new Map();
  const canvas = {
    nodes, selection: new Set(), wrapperEl: wrapper, isDragging: false, history: { data: [initial()], current: 0 },
    root: initial(),
    getData() { return { ...clone(this.root), nodes: [...nodes.values()].map((node) => clone(node.raw)) }; },
    importData(data) {
      this.root = clone(data);
      for (const raw of data.nodes) {
        if (nodes.has(raw.id)) nodes.get(raw.id).raw = clone(raw);
        else nodes.set(raw.id, {
          id: raw.id, raw: clone(raw), isEditing: false,
          nodeEl: { contains: (target) => target?.id === raw.id },
          getData() { return clone(this.raw); },
          getBBox() { const n = this.raw; return { minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height }; },
        });
      }
    },
    pushHistory(data) {
      this.history.data.splice(this.history.current + 1);
      this.history.data.push(clone(data));
      if (this.history.data.length >= 100) this.history.data.shift();
      this.history.current = this.history.data.length - 1;
    },
    requestSave(addHistory = true) { saves++; if (addHistory) pending = this.getData(); },
    posFromEvt(event) { return { x: event.clientX, y: event.clientY }; },
    undo() { if (this.history.current) this.importData(this.history.data[--this.history.current]); },
    redo() { if (this.history.current < this.history.data.length - 1) this.importData(this.history.data[++this.history.current]); },
  };
  canvas.requestPushHistory = Object.assign(() => {}, {
    run() { if (pending) { canvas.pushHistory(pending); pending = null; } },
    cancel() { pending = null; },
  });
  canvas.importData(initial());
  canvas.selection.add(nodes.get("a"));
  const file = { path: "Project/Carnet.canvas" };
  const view = { file, canvas, containerEl: wrapper, register: (fn) => cleanups.push(fn), getViewData: () => JSON.stringify(canvas.getData()), setViewData() {}, requestSave() {} };
  const leaf = { view };
  const app = { workspace: { activeLeaf: leaf, getActiveViewOfType() { return this.activeLeaf?.view ?? null; }, getLeavesOfType: () => [leaf] } };
  const isCarnet = (candidate) => candidate === file;
  const cleanup = attachCarnetDropLinks(app, view, isCarnet);
  const emit = (name, changes = {}) => listeners.get(name)?.({ pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, clientX: 50, clientY: 40, target: { id: "a" }, ...changes });
  const start = () => emit("pointerdown");
  const release = (x = 350, y = 40) => {
    nodes.get("a").raw.x = x - 40;
    nodes.get("a").raw.y = y - 20;
    canvas.isDragging = true;
    emit("pointermove", { clientX: x, clientY: y });
    emit("pointerup", { clientX: x, clientY: y });
    canvas.isDragging = false;
    canvas.requestSave();
  };
  const flush = () => { for (const [id, fn] of timers) { timers.delete(id); fn(); } canvas.requestPushHistory.run(); };
  return { app, canvas, nodes, file, view, isCarnet, listeners, timers, start, release, emit, flush, cleanup, cleanups, get saves() { return saves; } };
}

test("dropping a free note toggles one line and preserves properties and both positions", () => {
  const f = fixture();
  const before = f.canvas.getData();
  f.start(); f.release(); f.flush();
  const after = f.canvas.getData();
  assert.deepEqual(after.nodes, before.nodes);
  assert.deepEqual(after.viewport, before.viewport);
  assert.equal(after.edges.length, 1);
  assert.equal(after.edges[0].fromEnd, "none");
  assert.equal(after.edges[0].toEnd, "none");
  f.start(); f.release(); f.flush();
  assert.deepEqual(f.canvas.getData(), before);
});

test("creation and removal each use one undo step and preserve the preceding action", () => {
  const f = fixture();
  f.nodes.get("b").raw.text = "Earlier edit";
  f.canvas.requestSave();
  f.start(); f.release(); f.flush();
  assert.equal(f.canvas.history.data.length, 3);
  f.canvas.undo();
  assert.equal(f.canvas.getData().edges.length, 0);
  assert.equal(f.nodes.get("b").raw.text, "Earlier edit");
  assert.equal(f.nodes.get("a").raw.x, 10);
  f.canvas.undo();
  assert.equal(f.nodes.get("b").raw.text, "B");
  f.canvas.redo(); f.canvas.redo();
  assert.equal(f.canvas.getData().edges.length, 1);
  f.start(); f.release(); f.flush();
  f.canvas.undo();
  assert.equal(f.canvas.getData().edges.length, 1);
  assert.equal(f.nodes.get("a").raw.x, 10);
  f.canvas.redo();
  assert.equal(f.canvas.getData().edges.length, 0);
});

test("dropping on empty space preserves the native move", () => {
  const f = fixture();
  f.start(); f.release(600, 200); f.flush();
  assert.equal(f.nodes.get("a").raw.x, 560);
  assert.equal(f.canvas.getData().edges.length, 0);
});

test("restoration retains fractional and negative source coordinates exactly", () => {
  const f = fixture();
  f.nodes.get("a").raw.x = -12.375;
  f.nodes.get("a").raw.y = 19.125;
  f.canvas.requestSave();
  f.start(); f.release(); f.flush();
  assert.equal(f.nodes.get("a").raw.x, -12.375);
  assert.equal(f.nodes.get("a").raw.y, 19.125);
  f.canvas.undo();
  assert.equal(f.nodes.get("a").raw.x, -12.375);
  f.canvas.redo();
  assert.equal(f.nodes.get("a").raw.y, 19.125);
});

for (const variant of ["selected-target", "editing", "resize", "mindmap", "unrecognized", "missing-method"]) {
  test(`${variant} gestures are not intercepted`, () => {
    const f = fixture();
    if (variant === "selected-target") f.canvas.selection.add(f.nodes.get("b"));
    if (variant === "editing") f.nodes.get("a").isEditing = true;
    if (variant === "mindmap") f.nodes.get("a").raw.feuillets_block_id = "map";
    if (variant === "unrecognized") f.view.file = { path: "Other.canvas" };
    if (variant === "missing-method") f.canvas.importData = undefined;
    if (variant === "resize") f.emit("pointerdown", { target: { id: "resize-handle" } }); else f.start();
    f.release(); f.flush();
    assert.equal(f.canvas.getData().edges.length, 0);
    assert.equal(f.nodes.get("a").raw.x, 310);
  });
}

for (const variant of ["content", "head-identity", "head-content", "saturated-history", "selection", "resize", "inactive-view", "closed-view", "missing-method", "panning", "unfinished-drag"]) {
  test(`a concurrent ${variant} change aborts without replacing the native move`, () => {
    const f = fixture();
    if (variant === "saturated-history") {
      f.canvas.history.data = Array.from({ length: 99 }, () => initial());
      f.canvas.history.current = 98;
    }
    f.start(); f.release();
    if (variant === "content") f.nodes.get("b").raw.text = "Concurrent edit";
    if (variant === "head-identity") f.canvas.history.data[0] = clone(f.canvas.history.data[0]);
    if (variant === "head-content") f.canvas.history.data[0].nodes[0].text = "Changed snapshot";
    if (variant === "saturated-history") f.canvas.pushHistory(f.canvas.getData());
    if (variant === "selection") f.canvas.selection.clear();
    if (variant === "resize") f.nodes.get("a").raw.width += 20;
    if (variant === "inactive-view") f.app.workspace.activeLeaf = null;
    if (variant === "closed-view") f.view.file = null;
    if (variant === "missing-method") f.canvas.importData = undefined;
    if (variant === "panning") f.canvas.isHoldingSpace = true;
    if (variant === "unfinished-drag") f.canvas.isDragging = true;
    f.flush();
    assert.equal(f.canvas.getData().edges.length, 0);
    assert.equal(f.nodes.get("a").raw.x, 310);
    if (variant === "content") assert.equal(f.nodes.get("b").raw.text, "Concurrent edit");
  });
}

test("a full history still records exactly one valid gesture", () => {
  const f = fixture();
  f.canvas.history.data = Array.from({ length: 99 }, () => initial());
  f.canvas.history.current = 98;
  f.start(); f.release(); f.flush();
  assert.equal(f.canvas.history.data.length, 99);
  f.canvas.undo();
  assert.equal(f.canvas.getData().edges.length, 0);
  assert.equal(f.nodes.get("a").raw.x, 10);
  f.canvas.redo();
  assert.equal(f.canvas.getData().edges.length, 1);
});

test("ambiguous, enriched, directed and managed connections remain untouched", () => {
  const base = { id: "line", fromNode: "b", toNode: "a", toEnd: "none" };
  for (const edges of [[base, { ...base, id: "other" }], [{ ...base, label: "Meaning" }], [{ ...base, color: "2" }], [{ ...base, toEnd: "arrow" }], [{ ...base, feuillets_managed: "mindmap" }]]) {
    const data = { ...initial(), edges };
    assert.equal(toggleDropLink(data, "a", "b"), null);
    assert.deepEqual(data.edges, edges);
  }
  assert.deepEqual(toggleDropLink({ ...initial(), edges: [base] }, "a", "b").edges, []);
});

test("view and lifecycle cleanup cancel pending finalization and remove listeners", () => {
  const f = fixture();
  f.cleanup();
  const lifecycle = createCarnetLifecycle(f.app, f.isCarnet);
  lifecycle.refresh(); lifecycle.refresh();
  f.start(); f.release();
  assert.equal(f.timers.size, 1);
  lifecycle.cleanup();
  f.flush();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.canvas.getData().edges.length, 0);
  for (const cleanup of f.cleanups) cleanup();
});

test("invalid node identifiers never create or remove connections", () => {
  const data = initial();
  assert.equal(toggleDropLink(data, "a", "a"), null);
  assert.equal(toggleDropLink(data, "missing", "b"), null);
  data.nodes[1].id = "a";
  assert.equal(toggleDropLink(data, "a", "b"), null);
});

test("closing the view cancels its deferred operation immediately", () => {
  const f = fixture();
  f.start(); f.release();
  for (const cleanup of f.cleanups) cleanup();
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
  f.flush();
  assert.equal(f.canvas.getData().edges.length, 0);
  assert.equal(f.nodes.get("a").raw.x, 310);
});

test("styled and manually sized free notes retain drop-link creation, removal and native history", () => {
  const f = fixture();
  f.nodes.get("a").raw.feuillets_note_style = "plain";
  f.nodes.get("a").raw.feuillets_note_width = "manual";
  f.nodes.get("b").raw.feuillets_note_style = "filled";
  f.canvas.requestSave();
  const before = f.canvas.getData();
  f.start(); f.release(); f.flush();
  assert.equal(f.canvas.getData().edges.length, 1);
  assert.deepEqual(f.canvas.getData().nodes, before.nodes);
  f.canvas.undo();
  assert.deepEqual(f.canvas.getData(), before);
  f.canvas.redo();
  assert.equal(f.canvas.getData().edges.length, 1);
  f.start(); f.release(); f.flush();
  assert.deepEqual(f.canvas.getData(), before);
});


function multiFixture(count = 3) {
  const f = fixture(), data = initial();
  data.nodes.push({ id: "c", type: "text", text: "C", x: -12.375, y: 160.125, width: 100, height: 60 });
  if (count === 3) data.nodes.push({ id: "d", type: "text", text: "D", x: 150.5, y: 160.75, width: 100, height: 60 });
  f.canvas.importData(data);
  f.canvas.selection = new Set(["a", "c", ...(count === 3 ? ["d"] : [])].map((id) => f.nodes.get(id)));
  f.canvas.history.data = [f.canvas.getData()]; f.canvas.history.current = 0;
  const sources = [...f.canvas.selection];
  const release = (x = 350, y = 40) => {
    for (const node of sources) { node.raw.x += x - 50; node.raw.y += y - 40; }
    f.canvas.isDragging = true;
    f.emit("pointermove", { clientX: x, clientY: y });
    f.emit("pointerup", { clientX: x, clientY: y });
    f.canvas.isDragging = false; f.canvas.requestSave();
  };
  return { ...f, sources, release };
}

for (const count of [2, 3]) {
  test(`${count} selected notes create one native transaction and restore every original coordinate`, () => {
    const f = multiFixture(count), before = f.canvas.getData();
    f.start(); f.release(); f.flush();
    const after = f.canvas.getData();
    assert.deepEqual(after.nodes, before.nodes);
    assert.equal(after.edges.length, count);
    assert.equal(new Set(after.edges.map((edge) => edge.id)).size, count);
    assert(after.edges.every((edge) => edge.toNode === "b" && edge.fromEnd === "none" && edge.toEnd === "none"));
    assert.equal(f.canvas.history.data.length, 2);
    f.canvas.undo(); assert.deepEqual(f.canvas.getData(), before);
    f.canvas.redo(); assert.deepEqual(f.canvas.getData(), after);
  });
}

test("multi-note drops preserve existing reversed, labeled, arrowed and colored relationships", () => {
  const f = multiFixture(), existing = { id: "existing", fromNode: "b", toNode: "a", label: "Meaning", color: "3", fromEnd: "arrow", toEnd: "none", custom: { retained: true } };
  f.canvas.root.edges = [existing]; f.canvas.requestSave();
  const before = f.canvas.getData();
  f.start(); f.release(); f.flush();
  assert.equal(f.canvas.getData().edges.length, 3);
  assert.deepEqual(f.canvas.getData().edges[0], existing);
  assert.deepEqual(f.canvas.getData().nodes, before.nodes);
  f.canvas.undo(); assert.deepEqual(f.canvas.getData(), before);
  f.canvas.redo(); assert.equal(f.canvas.getData().edges.length, 3);
});

test("a fully connected selection restores positions without adding an undo entry or truncating redo", () => {
  const f = multiFixture(), all = addDropLinks(f.canvas.getData(), ["a", "c", "d"], "b");
  f.canvas.importData(all); f.canvas.requestSave(); f.canvas.requestPushHistory.run();
  f.nodes.get("b").raw.text = "Redo remains available";
  f.canvas.requestSave(); f.canvas.requestPushHistory.run(); f.canvas.undo();
  const before = f.canvas.getData(), entries = f.canvas.history.data.slice(), current = f.canvas.history.current;
  f.start(); f.release(); f.flush();
  assert.deepEqual(f.canvas.getData(), before);
  assert.equal(f.canvas.history.current, current);
  assert.deepEqual(f.canvas.history.data, entries);
  assert(f.canvas.history.data.every((entry, i) => entry === entries[i]));
  f.canvas.redo(); assert.equal(f.nodes.get("b").raw.text, "Redo remains available");
});

test("every dragged node is excluded from pointer hit testing even when it covers the destination", () => {
  const f = multiFixture();
  f.nodes.get("d").raw.x = 10; f.nodes.get("d").raw.y = 20;
  f.canvas.requestSave();
  f.start(); f.release(); f.flush();
  assert.equal(f.canvas.getData().edges.length, 3);
  assert(f.canvas.getData().edges.every((edge) => edge.toNode === "b"));
  assert.equal(f.nodes.get("d").raw.x, 10);
});

test("empty-space and selected-node drops preserve ordinary multi-node movement", () => {
  for (const position of [[800, 500], [50, 200]]) {
    const f = multiFixture(), before = f.canvas.getData();
    f.start(); f.release(...position); f.flush();
    assert.equal(f.canvas.getData().edges.length, 0);
    assert.equal(f.nodes.get("a").raw.x, before.nodes[0].x + position[0] - 50);
    assert.equal(f.nodes.get("c").raw.y, before.nodes[2].y + position[1] - 40);
  }
});

for (const type of ["group", "managed", "mindmap", "editing"]) {
  test(`a mixed selection containing a ${type} node is left to native Canvas`, () => {
    const f = multiFixture();
    if (type === "managed") f.nodes.get("c").raw.feuillets_block_id = "map";
    else if (type === "mindmap") f.nodes.get("c").raw.mindmapRoot = true;
    else if (type === "editing") f.nodes.get("c").isEditing = true;
    else f.nodes.get("c").raw.type = type;
    f.start(); f.release(); f.flush();
    assert.equal(f.canvas.getData().edges.length, 0);
    assert.equal(f.nodes.get("a").raw.x, 310);
    assert.equal(f.nodes.get("c").raw.x, -12.375 + 300);
  });
}

for (const variant of ["source-content", "source-size", "target-content", "target-position", "target-removed", "target-editing", "target-instance", "history-identity", "history-content", "saturated-history", "selection", "view", "closed-view", "panning", "unfinished-drag", "unload"]) {
  test(`a concurrent multi-note ${variant} change aborts the whole custom action`, () => {
    const f = multiFixture();
    if (variant === "saturated-history") { f.canvas.history.data = Array.from({ length: 99 }, () => f.canvas.getData()); f.canvas.history.current = 98; }
    f.start(); f.release();
    if (variant === "source-content") f.nodes.get("c").raw.text = "Concurrent edit";
    if (variant === "source-size") f.nodes.get("d").raw.width += 5;
    if (variant === "target-content") f.nodes.get("b").raw.text = "Concurrent target edit";
    if (variant === "target-position") f.nodes.get("b").raw.x += 10;
    if (variant === "target-removed") f.nodes.delete("b");
    if (variant === "target-editing") f.nodes.get("b").isEditing = true;
    if (variant === "target-instance") f.nodes.set("b", { ...f.nodes.get("b") });
    if (variant === "history-identity") f.canvas.history.data[f.canvas.history.current] = clone(f.canvas.history.data[f.canvas.history.current]);
    if (variant === "history-content") f.canvas.history.data[f.canvas.history.current].nodes[0].text = "Changed snapshot";
    if (variant === "saturated-history") f.canvas.pushHistory(f.canvas.getData());
    if (variant === "selection") f.canvas.selection.delete(f.nodes.get("c"));
    if (variant === "view") f.view.canvas = {};
    if (variant === "closed-view") f.view.file = null;
    if (variant === "panning") f.canvas.isHoldingSpace = true;
    if (variant === "unfinished-drag") f.canvas.isDragging = true;
    if (variant === "unload") f.cleanup();
    f.flush();
    assert.equal(f.canvas.getData().edges.length, 0);
    assert.equal(f.nodes.get("a").raw.x, 310);
    assert.equal(f.nodes.get("c").raw.x, -12.375 + 300);
  });
}

test("saturated native history keeps the preceding edit and groups all new links", () => {
  const f = multiFixture();
  f.canvas.history.data = Array.from({ length: 99 }, () => f.canvas.getData()); f.canvas.history.current = 98;
  f.nodes.get("b").raw.text = "Earlier edit"; f.canvas.requestSave();
  f.start(); f.release(); f.flush();
  assert.equal(f.canvas.history.data.length, 99);
  f.canvas.undo(); assert.equal(f.canvas.getData().edges.length, 0); assert.equal(f.nodes.get("b").raw.text, "Earlier edit");
  f.canvas.undo(); assert.equal(f.nodes.get("b").raw.text, "B");
  f.canvas.redo(); f.canvas.redo(); assert.equal(f.canvas.getData().edges.length, 3);
});

test("multi-note drops use pointer coordinates at the active Canvas zoom", () => {
  const f = multiFixture(); f.canvas.posFromEvt = () => ({ x: 350, y: 40 });
  f.start(); f.release(1100, 500); f.flush();
  assert.equal(f.canvas.getData().edges.length, 3);
  assert.equal(f.nodes.get("c").raw.x, -12.375);
});

test("invalid multi-note requests never partially create links or mutate input data", () => {
  const data = initial(), before = clone(data);
  for (const ids of [["a"], ["a", "a"], ["a", "missing"], ["a", "b"]]) assert.equal(addDropLinks(data, ids, "b"), null);
  assert.deepEqual(data, before);
});

const ordinaryCards = [
  { type: "text", text: "Free note" },
  { type: "file", file: "Sheet.md", feuillets_managed: "manuscript" },
  { type: "file", file: "Research.md", feuillets_managed: "research" },
  { type: "file", file: "Ordinary.md" },
];
for (const source of ordinaryCards) for (const target of ordinaryCards) test(`native drop links ${source.file ?? "text"} to ${target.file ?? "text"} with history and persistence`, () => {
  const f = fixture();
  Object.assign(f.nodes.get("a").raw, source); Object.assign(f.nodes.get("b").raw, target);
  const before = f.canvas.getData(); f.canvas.history.data = [clone(before)];
  f.start(); f.release(); f.flush();
  const after = f.canvas.getData();
  assert.deepEqual(after.nodes, before.nodes); assert.equal(after.edges.length, 1);
  assert.equal(after.edges[0].fromEnd, "none"); assert.equal(after.edges[0].toEnd, "none");
  assert.equal(f.canvas.history.data.length, 2);
  f.canvas.undo(); assert.deepEqual(f.canvas.getData(), before);
  f.canvas.redo(); assert.deepEqual(f.canvas.getData(), after);
  f.canvas.importData(JSON.parse(JSON.stringify(after)), true); assert.deepEqual(f.canvas.getData(), after);
  f.cleanup(); assert.equal(f.listeners.size, 0);
});

test("mixed document selections add only missing links and preserve customized relationships", () => {
  const f = multiFixture(2);
  Object.assign(f.nodes.get("a").raw, ordinaryCards[1]); Object.assign(f.nodes.get("c").raw, ordinaryCards[2]);
  Object.assign(f.nodes.get("b").raw, ordinaryCards[3]);
  const edge = { id: "existing", fromNode: "b", toNode: "a", label: "Keep", color: "4", fromEnd: "arrow", toEnd: "none", feuillets_edge_style: { geometry: "curved", width: "thick" } };
  f.canvas.root.edges = [edge]; const before = f.canvas.getData(); f.canvas.history.data = [clone(before)];
  f.start(); f.release(); f.flush();
  const after = f.canvas.getData();
  assert.deepEqual(after.nodes, before.nodes); assert.equal(after.edges.length, 2); assert.deepEqual(after.edges[0], edge);
  f.canvas.undo(); assert.deepEqual(f.canvas.getData(), before); f.canvas.redo(); assert.deepEqual(f.canvas.getData(), after);
});

test("drop import initializes only the new edge with current defaults in one history action", () => {
  const f = fixture(), defaults = { edge: { geometry: "map", pattern: "solid", width: "thick", arrows: "both", color: "5" } };
  f.cleanup();
  const cleanup = attachCarnetDropLinks(f.app, f.view, f.isCarnet, () => defaults);
  Object.assign(f.nodes.get("a").raw, ordinaryCards[1]); Object.assign(f.nodes.get("b").raw, ordinaryCards[2]);
  const before = f.canvas.getData(); f.canvas.history.data = [clone(before)];
  f.start(); f.release(); f.flush(); const saved = f.canvas.getData();
  assert.deepEqual(saved.nodes, before.nodes);
  assert.deepEqual(saved.edges[0].feuillets_edge_style, { geometry: "map", pattern: "solid", width: "thick" });
  assert.equal(saved.edges[0].fromEnd, "arrow"); assert.equal(saved.edges[0].toEnd, "arrow"); assert.equal(saved.edges[0].color, "5");
  assert.equal(f.canvas.history.data.length, 2);
  defaults.edge = { width: "thin", arrows: "none", color: "1" };
  f.canvas.undo(); assert.deepEqual(f.canvas.getData(), before); f.canvas.redo(); assert.deepEqual(f.canvas.getData(), saved);
  f.start(); f.release(); f.flush(); assert.equal(f.canvas.getData().edges.length, 1);
  cleanup();
});

for (const patch of [{ feuillets_block_id: "map" }, { feuillets_plan_version: 2 }, { feuillets_managed: "thread" }, { mindmapRoot: true }, { feuillets_unknown: true }]) test(`documentary ownership does not bypass structural protection: ${JSON.stringify(patch)}`, () => {
  const data = initial(); Object.assign(data.nodes[0], ordinaryCards[1], patch);
  const before = clone(data); assert.equal(toggleDropLink(data, "a", "b"), null); assert.deepEqual(data, before);
});

test("dynamic stack movement remains native while ordinary card styling stays eligible", () => {
  const f = fixture(); f.nodes.get("a").raw.feuillets_stack = { id: "stack", order: 0 };
  assert.equal(toggleDropLink(f.canvas.getData(), "a", "b"), null);
  f.start(); f.release(); f.flush(); assert.equal(f.canvas.getData().edges.length, 0); assert.equal(f.nodes.get("a").raw.x, 310);
});
