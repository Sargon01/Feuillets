import test from "node:test";
import assert from "node:assert/strict";
import { Menu } from "obsidian";
import { applyEdgeStyle, registerCarnetEdgeStyleMenu } from "../src/carnet/canvas/edge-style.js";
import { isFreeNote } from "../src/carnet/canvas/note-style.js";
import { addDropLinks, toggleDropLink } from "../src/carnet/canvas/drop-links.js";

function fixture() {
  const raw = { nodes: ["a", "b", "c"].map((id, i) => ({ id, type: "text", text: "**Note**", x: i * 200, y: 0, width: 100, height: 60 })), edges: [{ id: "ab", fromNode: "a", toNode: "b", toEnd: "none", label: "Keep label" }, { id: "cb", fromNode: "c", toNode: "b", toEnd: "none" }] };
  const clone = (v) => structuredClone(v);
  const canvas = { edges: new Map(), root: clone(raw), saves: 0, dirty: [], history: [clone(raw)], index: 0,
    getData() { return { ...clone(this.root), edges: [...this.edges.values()].map((e) => e.getData()) }; },
    importData(data) { this.root = clone(data); for (const edge of data.edges) this.edges.get(edge.id).setData(edge); },
    markDirty(edge) { this.dirty.push(edge); }, requestSave(history) { assert.equal(history, false); this.saves++; },
    pushHistory(data) { this.history.splice(++this.index); this.history.push(clone(data)); },
    undo() { this.importData(this.history[--this.index]); }, redo() { this.importData(this.history[++this.index]); },
  };
  canvas.requestPushHistory = Object.assign(() => {}, { run() {}, cancel() {} });
  for (const data of raw.edges) canvas.edges.set(data.id, { canvas, raw: clone(data), getData() { return clone(this.raw); }, setData(data) { this.raw = clone(data); } });
  return canvas;
}

for (const pattern of ["solid", "dashed", "dotted"]) test(`pattern ${pattern} changes only the selected edge and supports one undo and redo`, () => {
  const canvas = fixture(), before = canvas.getData();
  assert(applyEdgeStyle(canvas, "ab", { pattern }));
  assert.equal(canvas.getData().edges[0].feuillets_edge_style?.pattern ?? "dashed", pattern);
  assert.deepEqual(canvas.getData().nodes, before.nodes);
  assert.deepEqual(canvas.getData().edges[1], before.edges[1]);
  assert.equal(canvas.saves, pattern === "dashed" ? 0 : 1);
  if (pattern !== "dashed") { const after = canvas.getData(); canvas.undo(); assert.deepEqual(canvas.getData(), before); canvas.redo(); assert.deepEqual(canvas.getData(), after); }
});
for (const width of ["thin", "regular", "thick"]) test(`width ${width} is stored minimally`, () => {
  const canvas = fixture(); assert(applyEdgeStyle(canvas, "ab", { width }));
  assert.equal(canvas.edges.get("ab").raw.feuillets_edge_style?.width ?? "thin", width);
  assert.equal(canvas.saves, width === "thin" ? 0 : 1);
});
for (const arrows of ["none", "start", "end", "both"]) test(`native arrow configuration ${arrows} persists`, () => {
  const canvas = fixture(); assert(applyEdgeStyle(canvas, "ab", { arrows }));
  const edge = canvas.getData().edges[0];
  assert.equal(edge.fromEnd ?? "none", arrows === "start" || arrows === "both" ? "arrow" : "none");
  assert.equal(edge.toEnd, arrows === "end" || arrows === "both" ? "arrow" : "none");
  assert.equal(canvas.saves, arrows === "none" ? 0 : 1);
});
test("native palette, theme color, reset, reopening and no-op actions", () => {
  const canvas = fixture(), before = canvas.getData();
  for (const color of ["1", "2", "3", "4", "5", "6", "#336699"]) { assert(applyEdgeStyle(canvas, "ab", { color })); assert.equal(canvas.getData().edges[0].color, color); }
  applyEdgeStyle(canvas, "ab", { color: "" }); assert.equal(canvas.getData().edges[0].color, undefined);
  applyEdgeStyle(canvas, "ab", { pattern: "dotted", width: "thick", color: "4", arrows: "both" });
  const persisted = JSON.parse(JSON.stringify(canvas.getData())), reopened = fixture(); reopened.importData(persisted);
  assert.deepEqual(reopened.getData(), persisted);
  const history = canvas.history.length; applyEdgeStyle(canvas, "ab", { pattern: "dotted", width: "thick", color: "4", arrows: "both" }); assert.equal(canvas.history.length, history);
  applyEdgeStyle(canvas, "ab", "reset"); assert.equal(canvas.getData().edges[0].feuillets_edge_style, undefined); assert.equal(canvas.getData().edges[0].color, undefined);
  const saves = canvas.saves; applyEdgeStyle(canvas, "ab", "reset"); assert.equal(canvas.saves, saves);
  canvas.undo(); assert.deepEqual(canvas.getData(), persisted); canvas.redo();
  assert.equal(canvas.getData().edges[0].label, before.edges[0].label);
});
test("styling metadata does not make notes structural or break add-missing links", () => {
  const canvas = fixture(); applyEdgeStyle(canvas, "ab", { pattern: "dotted", color: "4", arrows: "both" });
  const data = canvas.getData(), styled = data.edges[0];
  assert(isFreeNote(data, data.nodes[0]));
  const result = addDropLinks({ ...data, edges: [styled] }, ["a", "c"], "b");
  assert.deepEqual(result.edges[0], styled); assert.equal(result.edges.length, 2);
  assert.equal(toggleDropLink({ ...data, edges: [styled] }, "a", "b"), null);
});
test("managed nodes, managed edges, external styles and incomplete runtimes are untouched", () => {
  for (const metadata of [{ feuillets_managed: "mindmap" }, { feuillets_block_id: "relations" }, { pathStyle: "curved" }, { anotherPluginData: { retained: true } }]) {
    const canvas = fixture(); Object.assign(canvas.edges.get("ab").raw, metadata);
    const before = canvas.getData(); assert.equal(applyEdgeStyle(canvas, "ab", { pattern: "solid" }), false); assert.deepEqual(canvas.getData(), before);
  }
  for (const metadata of [{ type: "file" }, { type: "group" }, { feuillets_plan_version: 1 }, { mindmapCollapsed: [] }]) {
    const canvas = fixture(); Object.assign(canvas.root.nodes[0], metadata); assert.equal(applyEdgeStyle(canvas, "ab", "reset"), false);
  }
  for (const method of ["markDirty", "pushHistory", "requestSave", "requestPushHistory"]) { const canvas = fixture(); delete canvas[method]; assert.equal(applyEdgeStyle(canvas, "ab", "reset"), false); }
  const canvas = fixture(); canvas.readonly = true; assert.equal(applyEdgeStyle(canvas, "ab", "reset"), false);
});
test("native edge menu is view-scoped and rejects stale edge objects", () => {
  const canvas = fixture(), file = { path: "Carnet.canvas" }, events = new Map(); canvas.view = { file };
  const plugin = { app: { workspace: { on(name, callback) { events.set(name, callback); return {}; } } }, registerEvent() {} };
  registerCarnetEdgeStyleMenu(plugin, (f) => f === file);
  const menu = new Menu(); events.get("canvas:edge-menu")(menu, canvas.edges.get("ab"));
  assert.equal(menu.items.length, 1); const appearance = menu.items[0].submenu;
  assert.deepEqual(appearance.items.slice(0, 3).map((i) => i.submenu.items.length), [3, 3, 4]);
  appearance.items[0].submenu.items[2].click(); assert.equal(canvas.getData().edges[0].feuillets_edge_style.pattern, "dotted");
  const saves = canvas.saves; canvas.view.file = { path: "Ordinary.canvas" }; appearance.items[1].submenu.items[2].click(); assert.equal(canvas.saves, saves);
  const ordinary = new Menu(); events.get("canvas:edge-menu")(ordinary, canvas.edges.get("ab")); assert.equal(ordinary.items.length, 0);
  canvas.view.file = file; canvas.edges.set("ab", { ...canvas.edges.get("ab") }); appearance.items[1].submenu.items[2].click(); assert.equal(canvas.saves, saves);
});
