import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCarnetDefaultStyles, withNewNoteDefaults, withNewEdgeDefaults } from "../src/carnet/core/default-styles.js";
import { attachCarnetWorkspaceBinding } from "../src/carnet/canvas/workspace-binding.js";
import { addTextNodeToCanvas } from "../src/services/canvas-board.js";

const clone = (value) => structuredClone(value);
const defaults = { note: { style: "filled", color: "4", textStyle: { size: 22, align: "center", color: "purple" } }, edge: { geometry: "map", pattern: "dotted", width: "thick", arrows: "both", color: "2" } };
function fixture() {
  let preferences = clone(defaults), valid = true, notifications = 0, styleRefreshes = 0;
  const element = (raw) => ({ id: raw.id, raw: clone(raw), getData() { return clone(this.raw); }, setData(next) { this.raw = clone(next); } });
  const canvas = { nodes: new Map(), edges: new Map(), selection: new Set(), history: [], dirty: [], moved: [], saves: 0,
    getData() { return { nodes: [...this.nodes.values()].map((node) => node.getData()), edges: [...this.edges.values()].map((edge) => edge.getData()) }; },
    addNode(node) { this.nodes.set(node.id, node); }, addEdge(edge) { this.edges.set(edge.id, edge); },
    updateSelection(change) { change(); }, setDragging(dragging) { this.isDragging = dragging; },
    importData(data) { this.nodes.clear(); this.edges.clear(); for (const raw of data.nodes) this.addNode(element(raw)); for (const raw of data.edges) this.addEdge(element(raw)); },
    requestSave(addHistory = true) { this.saves++; if (addHistory) this.history.push(this.getData()); },
    markDirty(edge) { this.dirty.push(edge.id); }, markMoved(edge) { this.moved.push(edge.id); },
  };
  canvas.importData({ nodes: ["a", "b"].map((id) => ({ id, type: "text", text: id, x: 0, y: 0, width: 200, height: 100 })), edges: [] });
  const original = { ...canvas };
  const binding = attachCarnetWorkspaceBinding(canvas, () => valid, () => notifications++, () => preferences, () => {
    assert.deepEqual(canvas.history.at(-1), canvas.getData()); styleRefreshes++;
  });
  return { canvas, binding, original, element, setPreferences(value) { preferences = value; }, setValid(value) { valid = value; }, get notifications() { return notifications; }, get styleRefreshes() { return styleRefreshes; } };
}

test("settings normalization accepts supported fields, preserves explicit left alignment and rejects unsupported defaults", () => {
  assert.deepEqual(normalizeCarnetDefaultStyles(defaults), defaults);
  assert.deepEqual(normalizeCarnetDefaultStyles({ note: { style: "classic", color: "#ff00ff", textStyle: { size: 99, align: "left" } }, edge: { geometry: "custom", pattern: "invalid", arrows: "invalid", color: "7" } }), { note: { textStyle: { size: 40, align: "left" } } });
  for (const value of [null, [], false, "invalid", {}]) assert.deepEqual(normalizeCarnetDefaultStyles(value), {});
});

test("selection changes notify immediately without card movement, including native modifier and marquee paths", () => {
  const f = fixture(), c = f.canvas, before = c.getData();
  c.updateSelection(() => c.selection.add(c.nodes.get("a")));
  assert.equal(f.notifications, 1);
  c.updateSelection(() => c.selection.add(c.nodes.get("b")));
  assert.equal(f.notifications, 2); assert.equal(c.selection.size, 2);
  c.setDragging(true); c.updateSelection(() => { c.selection = new Set(c.nodes.values()); }); c.setDragging(false);
  assert.equal(f.notifications, 5); assert.deepEqual(c.getData(), before); assert.equal(c.saves, 0);
});

test("new free cards and edges receive defaults exactly once before their original save/history snapshot", () => {
  const f = fixture(), c = f.canvas, old = c.getData();
  const node = f.element({ id: "new", type: "text", text: "New card" }); c.addNode(node); c.requestSave();
  assert.equal(node.getData().feuillets_note_style, "filled"); assert.equal(node.getData().color, "4");
  assert.deepEqual(node.getData().feuillets_text_style, defaults.note.textStyle);
  assert.deepEqual(c.history[0].nodes.find((raw) => raw.id === "new"), node.getData());
  const edge = f.element({ id: "edge", fromNode: "a", toNode: "b" }); c.addEdge(edge); c.requestSave();
  assert.deepEqual(edge.getData().feuillets_edge_style, { geometry: "map", pattern: "dotted", width: "thick" });
  assert.equal(edge.getData().fromEnd, "arrow"); assert.equal(edge.getData().toEnd, "arrow"); assert.equal(edge.getData().color, "2");
  assert.deepEqual(c.dirty, ["edge"]); assert.deepEqual(c.moved, ["edge"]);
  assert.deepEqual(c.getData().nodes.slice(0, 2), old.nodes);
  f.setPreferences({ note: { style: "outline" }, edge: { width: "thin" } }); c.requestSave();
  assert.equal(node.getData().feuillets_note_style, "filled"); assert.equal(edge.getData().feuillets_edge_style.width, "thick");
  assert.equal(c.saves, 3); assert.equal(c.history.length, 3);
  assert.equal(f.styleRefreshes, 2);
});

test("explicit creation properties, structural objects remain protected", () => {
  const f = fixture(), c = f.canvas;
  const explicit = f.element({ id: "explicit", type: "text", color: "6", feuillets_note_style: "rounded", feuillets_text_style: { size: 30, align: "right", color: "red" } });
  c.addNode(explicit); c.requestSave();
  assert.equal(explicit.getData().feuillets_note_style, "rounded"); assert.equal(explicit.getData().color, "6");
  assert.deepEqual(explicit.getData().feuillets_text_style, { size: 30, align: "right", color: "red" });
  const reset = f.element({ id: "reset", type: "text", color: "", feuillets_note_style: "plain", feuillets_text_style: { align: "left" } });
  c.addNode(reset); c.requestSave();
  assert.equal(reset.getData().color, ""); assert.equal(reset.getData().feuillets_note_style, "plain");
  assert.equal(reset.getData().feuillets_text_style.align, undefined);
  for (const patch of [{ feuillets_plan_version: 2 }, { feuillets_block_id: "mindmap" }, { feuillets_managed: "research" }]) {
    const raw = { id: "protected", type: "text", ...patch }, node = f.element(raw); c.addNode(node); c.requestSave(); assert.deepEqual(node.getData(), raw);
  }
  const raw = { id: "structural-edge", fromNode: "a", toNode: "b", feuillets_managed: "relations", feuillets_block_id: "relations" }, edge = f.element(raw);
  c.addEdge(edge); c.requestSave(); assert.deepEqual(edge.getData(), raw);
  const custom = { id: "custom-edge", fromNode: "a", toNode: "b", fromEnd: "arrow", toEnd: "none", color: "3", feuillets_edge_style: { geometry: "curved", pattern: "solid", width: "thin" } }, customEdge = f.element(custom);
  c.addEdge(customEdge); c.requestSave(); assert.deepEqual(customEdge.getData(), custom);
});

test("connector gestures defer edge defaults until their temporary endpoint becomes a real card", () => {
  const f = fixture(), c = f.canvas;
  const edge = f.element({ id: "connecting", fromNode: "a", toNode: "placeholder" }); c.addEdge(edge);
  c.requestSave(); assert.equal(edge.getData().feuillets_edge_style, undefined);
  const node = f.element({ id: "destination", type: "text" }); c.addNode(node); c.requestSave();
  assert.equal(node.getData().feuillets_note_style, "filled");
  assert.equal(edge.getData().feuillets_edge_style, undefined);
  edge.setData({ ...edge.getData(), toNode: "destination" }); c.requestSave();
  assert.deepEqual(edge.getData().feuillets_edge_style, { geometry: "map", pattern: "dotted", width: "thick" });
  const saved = edge.getData(); f.setPreferences({ edge: { width: "thin" } }); c.requestSave();
  assert.deepEqual(edge.getData(), saved); assert.deepEqual(c.dirty, ["connecting"]);
  const canceled = f.element({ id: "canceled", fromNode: "a", toNode: "placeholder" }); c.addEdge(canceled); c.requestSave();
  c.edges.delete("canceled"); c.requestSave(); assert.equal(canceled.getData().color, undefined);
});

test("loading, imports, paste and history replay retain source appearance even after preferences change", () => {
  const f = fixture(), c = f.canvas;
  const node = f.element({ id: "new", type: "text" }); c.addNode(node); c.requestSave(); const saved = c.getData();
  f.setPreferences({ note: { style: "outline", color: "1" } });
  c.importData({ nodes: [], edges: [] }, true); c.requestSave(false);
  c.importData(saved, true); c.requestSave(false); assert.deepEqual(c.getData(), saved);
  c.importData({ nodes: [{ id: "imported", type: "text" }], edges: [] }, true); c.requestSave();
  assert.deepEqual(c.getData().nodes, [{ id: "imported", type: "text" }]);
});

test("unrecognized or closed targets and readonly Canvases do not receive defaults; cleanup restores exact methods", () => {
  for (const kind of ["invalid", "readonly"]) {
    const f = fixture(), c = f.canvas;
    if (kind === "invalid") f.setValid(false); else c.readonly = true;
    const raw = { id: "new", type: "text" }, node = f.element(raw); c.addNode(node); c.requestSave(); assert.deepEqual(node.getData(), raw);
    f.binding.cleanup();
    for (const method of ["updateSelection", "setDragging", "addNode", "addEdge", "importData", "requestSave"]) assert.equal(c[method], f.original[method]);
    const before = f.notifications; c.updateSelection(() => {}); assert.equal(f.notifications, before);
  }
});

test("capture initializer shares the same defaults and never changes existing cards", () => {
  const data = { nodes: [{ id: "old", type: "text", text: "Old" }], edges: [] }, before = clone(data.nodes[0]);
  assert.equal(addTextNodeToCanvas(data, "Captured", defaults.note), "added");
  assert.deepEqual(data.nodes[0], before); assert.equal(data.nodes[1].feuillets_note_style, "filled");
  assert.deepEqual(data.nodes[1].feuillets_text_style, defaults.note.textStyle);
  assert.equal(withNewNoteDefaults(data, before, undefined), before);
  const edge = { id: "edge", fromNode: "old", toNode: data.nodes[1].id };
  assert.equal(withNewEdgeDefaults(data, edge, undefined), edge);
});

for (const managed of [undefined, "manuscript", "research"]) test(`new file cards receive missing defaults once: ${managed ?? "ordinary"}`, () => {
  const f = fixture(), c = f.canvas;
  const raw = { id: "file", type: "file", file: "Document.md", x: 10, y: 20, width: 320, height: 220, externalPlugin: { retained: true }, ...(managed ? { feuillets_managed: managed } : {}) };
  const node = f.element(raw); c.addNode(node); c.requestSave(); const saved = node.getData();
  assert.deepEqual(saved, { ...raw, feuillets_note_style: "filled", color: "4", feuillets_text_style: defaults.note.textStyle });
  f.setPreferences({ note: { style: "plain", color: "1" } }); c.requestSave(); assert.deepEqual(node.getData(), saved);
  c.importData(JSON.parse(JSON.stringify(c.getData())), true); c.requestSave(); assert.deepEqual(c.nodes.get("file").getData(), saved);
  f.binding.cleanup();
});

test("file creation from Binder and Research uses the workspace default initializer", async () => {
  const { createCarnetFileNode } = await import("../src/carnet/canvas/adapter.js");
  for (const path of ["Manuscript/Sheet.md", "Research/Card.md"]) {
    const f = fixture(), c = f.canvas;
    c.createFileNode = ({ pos, size, file }) => {
      const node = f.element({ id: "dropped", type: "file", file: file.path, ...pos, ...size }); c.addNode(node); return node;
    };
    const node = createCarnetFileNode(c, { path }, { x: 500, y: 400 });
    assert.equal(node.getData().type, "file"); assert.equal(node.getData().file, path);
    assert.equal(node.getData().feuillets_note_style, "filled"); assert.equal(node.getData().color, "4");
    assert.equal(node.getData().width, 320); assert.equal(node.getData().height, 220);
    assert.equal(c.saves, 1); assert.equal(c.history.length, 1); f.binding.cleanup();
  }
});

for (const ends of [{ fromEnd: "none", toEnd: "none" }, { toEnd: "arrow" }, { fromEnd: "arrow", toEnd: "none" }]) test(`explicit edge markers survive creation defaults: ${JSON.stringify(ends)}`, () => {
  const data = { nodes: ["a", "b"].map(id => ({ id, type: "file", file: `${id}.md` })), edges: [] };
  const edge = { id: "ab", fromNode: "a", toNode: "b", label: "Keep label", color: "3", ...ends, feuillets_edge_style: { geometry: "curved", pattern: "solid", width: "regular" } };
  assert.deepEqual(withNewEdgeDefaults(data, edge, defaults.edge), edge);
});

test("Square defaults survive settings serialization and initialize only new ordinary connections", () => {
  const preferences = normalizeCarnetDefaultStyles(JSON.parse(JSON.stringify({ edge: { geometry: "square", pattern: "dotted", arrows: "both" } })));
  assert.equal(preferences.edge.geometry, "square");
  const f = fixture(), c = f.canvas; f.setPreferences(preferences);
  const edge = f.element({ id: "square", fromNode: "a", toNode: "b" }); c.addEdge(edge); c.requestSave();
  assert.equal(edge.getData().feuillets_edge_style.geometry, "square"); assert.equal(edge.getData().fromEnd, "arrow"); assert.equal(edge.getData().toEnd, "arrow");
  const saved = c.getData(); f.setPreferences({ edge: { geometry: "curved" } }); c.importData(JSON.parse(JSON.stringify(saved)), true); c.requestSave(false);
  assert.deepEqual(c.getData(), saved); f.binding.cleanup();
});
