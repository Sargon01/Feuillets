import test from "node:test";
import assert from "node:assert/strict";
import { Menu } from "obsidian";
import { applyEdgeStyle, getEdgeAppearance, registerCarnetEdgeStyleMenu } from "../src/carnet/canvas/edge-style.js";
import { isFreeNote } from "../src/carnet/canvas/note-style.js";
import { addDropLinks, toggleDropLink } from "../src/carnet/canvas/drop-links.js";
import { t } from "../src/i18n/index.js";

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
  assert.equal(canvas.getData().edges[0].feuillets_edge_style?.pattern ?? "dotted", pattern);
  assert.deepEqual(canvas.getData().nodes, before.nodes);
  assert.deepEqual(canvas.getData().edges[1], before.edges[1]);
  assert.equal(canvas.saves, pattern === "dotted" ? 0 : 1);
  if (pattern !== "dotted") { const after = canvas.getData(); canvas.undo(); assert.deepEqual(canvas.getData(), before); canvas.redo(); assert.deepEqual(canvas.getData(), after); }
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
  for (const metadata of [{ feuillets_managed: "research" }, { feuillets_block: "relations" }, { feuillets_plan_version: 1 }, { mindmapCollapsed: [] }]) {
    const canvas = fixture(); Object.assign(canvas.root.nodes[0], metadata); assert.equal(applyEdgeStyle(canvas, "ab", "reset"), false);
  }
  for (const method of ["markDirty", "pushHistory", "requestSave", "requestPushHistory"]) { const canvas = fixture(); delete canvas[method]; assert.equal(applyEdgeStyle(canvas, "ab", "reset"), false); }
  const canvas = fixture(); canvas.readonly = true; assert.equal(applyEdgeStyle(canvas, "ab", "reset"), false);
});
test("native edge menu is view-scoped and rejects stale edge objects", () => {
  const canvas = fixture(), file = { path: "Carnet.canvas" }, events = new Map(); canvas.view = { file };
  const plugin = { app: { workspace: { on(name, callback) { events.set(name, callback); return {}; } } }, registerEvent() {} };
  registerCarnetEdgeStyleMenu(plugin, (f) => f === file);
  const menu = new Menu(); menu.addItem((item) => item.setTitle("Native action"));
  const native = menu.items[0]; events.get("canvas:edge-menu")(menu, canvas.edges.get("ab"));
  events.get("canvas:edge-menu")(menu, canvas.edges.get("ab"));
  assert.equal(menu.items.length, 2); assert.equal(menu.items[0], native);
  const appearance = menu.items[1].submenu;
  assert.equal(menu.items[1].title, t("carnet.edgeStyle.menu"));
  assert.deepEqual(appearance.items.filter((i) => i.submenu).map((i) => i.submenu.items.length), [4, 3, 3, 4, 7]);
  const line = appearance.items.find((i) => i.title === t("carnet.edgeStyle.line")).submenu;
  const dotted = line.items.find((i) => i.title === t("carnet.edgeStyle.dotted"));
  dotted.click(); assert.equal(getEdgeAppearance(canvas.getData().edges[0], canvas.getData()).pattern, "dotted");
  const saves = canvas.saves; canvas.view.file = { path: "Ordinary.canvas" }; dotted.click(); assert.equal(canvas.saves, saves);
  const ordinary = new Menu(); events.get("canvas:edge-menu")(ordinary, canvas.edges.get("ab")); assert.equal(ordinary.items.length, 0);
  canvas.view.file = file; canvas.edges.set("ab", { ...canvas.edges.get("ab") }); dotted.click(); assert.equal(canvas.saves, saves);
});

for (const type of ["text", "file"]) test(`native edge menus customize ${type} connections with checked state, history and persistence`, () => {
  const canvas = fixture(), file = { path: "Carnet.canvas" }, events = new Map(); canvas.view = { file }; canvas.root.nodes[0].type = type;
  const before = canvas.getData(); canvas.history[0] = structuredClone(before);
  registerCarnetEdgeStyleMenu({ app: { workspace: { on(name, callback) { events.set(name, callback); return {}; } } }, registerEvent() {} }, (f) => f === file);
  const open = () => { const menu = new Menu(); events.get("canvas:edge-menu")(menu, canvas.edges.get("ab")); return menu.items[0].submenu; };
  const choice = (group, value) => open().items.find((i) => i.title === t(`carnet.edgeStyle.${group}`)).submenu.items.find((i) => i.title === t(`carnet.edgeStyle.${value}`));
  const change = (group, value, expected) => {
    const previous = canvas.getData(), index = canvas.index;
    choice(group, value).click();
    assert.equal(canvas.index, index + 1); assert.equal(choice(group, value).checked, true);
    assert.equal(open().items.find((i) => i.title === t(`carnet.edgeStyle.${group}`)).submenu.items.filter((i) => i.checked).length, 1);
    const after = canvas.getData(); expected(after.edges[0]);
    assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges[1], before.edges[1]);
    assert.equal(after.edges[0].id, "ab"); assert.equal(after.edges[0].label, "Keep label");
    canvas.undo(); assert.deepEqual(canvas.getData(), previous); canvas.redo(); assert.deepEqual(canvas.getData(), after);
    const reopened = fixture(); reopened.importData(JSON.parse(JSON.stringify(after))); assert.deepEqual(reopened.getData(), after);
    choice(group, value).click(); assert.equal(canvas.index, index + 1);
  };
  assert.equal(choice("geometry", "straight").checked, true);
  for (const geometry of ["square", "map", "curved", "straight"]) change("geometry", geometry, (e) => assert.equal(e.feuillets_edge_style.geometry, geometry));
  for (const pattern of ["solid", "dotted", "dashed"]) change("line", pattern, (e) => assert.equal(getEdgeAppearance(e, canvas.getData()).pattern, pattern));
  for (const width of ["thick", "regular", "thin"]) change("width", width, (e) => assert.equal(getEdgeAppearance(e, canvas.getData()).width, width));
  for (const arrows of ["both", "start", "end", "none"]) change("arrows", arrows, (e) => assert.equal(getEdgeAppearance(e).arrows, arrows));
  for (const [index, color] of ["red", "orange", "yellow", "green", "cyan", "purple"].entries()) change("color", color, (e) => assert.equal(e.color, String(index + 1)));
  change("color", "defaultColor", (e) => assert.equal(e.color, undefined));
});

test("edge menus exclude structural connections, readonly views and stale edges", () => {
  const canvas = fixture(), file = { path: "Carnet.canvas" }, events = new Map(); canvas.view = { file };
  registerCarnetEdgeStyleMenu({ app: { workspace: { on(name, callback) { events.set(name, callback); return {}; } } }, registerEvent() {} }, (f) => f === file);
  const edge = canvas.edges.get("ab");
  const excluded = () => { const menu = new Menu(); events.get("canvas:edge-menu")(menu, edge); assert.equal(menu.items.length, 0); };
  for (const metadata of [{ feuillets_managed: "mindmap" }, { feuillets_managed: "relations" }, { feuillets_relation: "parent-child", feuillets_block_id: "family" }]) {
    const raw = edge.raw; edge.raw = { ...raw, ...metadata }; excluded(); edge.raw = raw;
  }
  canvas.readonly = true; excluded(); canvas.readonly = false;
  canvas.edges.set("ab", { ...edge }); excluded();
  assert.deepEqual([...events.keys()], ["canvas:edge-menu"]);
});

for (const type of ["file", "group"]) test(`native ${type} endpoints share appearance transactions without changing geometry data`, () => {
  const canvas = fixture(); canvas.root.nodes[0].type = type; canvas.root.nodes[0].file = "Image.png";
  const before = canvas.getData(); canvas.history[0] = structuredClone(before);
  assert.deepEqual(getEdgeAppearance(before.edges[0], before), { pattern: "dotted", width: "thin", color: "", arrows: "none", geometry: "straight" });
  assert(applyEdgeStyle(canvas, "ab", { pattern: "dotted", width: "thick", arrows: "both", color: "4" }));
  const after = canvas.getData();
  assert.deepEqual(after.nodes, before.nodes);
  assert.deepEqual(after.edges[0], { ...before.edges[0], feuillets_edge_style: { width: "thick" }, fromEnd: "arrow", toEnd: "arrow", color: "4" });
  assert.equal(canvas.history.length, 2); canvas.undo(); assert.deepEqual(canvas.getData(), before); canvas.redo(); assert.deepEqual(canvas.getData(), after);
  const reopened = fixture(); reopened.importData(JSON.parse(JSON.stringify(after))); assert.deepEqual(reopened.getData(), after);
  assert(applyEdgeStyle(canvas, "ab", { pattern: "dashed", width: "thin" }));
  assert.deepEqual(canvas.getData().edges[0].feuillets_edge_style, { pattern: "dashed" });
});
test("native file endpoints with structural metadata or managed incident edges stay protected", () => {
  for (const metadata of [{ feuillets_managed: "thread" }, { feuillets_block_id: "relations" }, { mindmapOrientation: "vertical" }]) {
    const canvas = fixture(); Object.assign(canvas.root.nodes[0], { type: "file", ...metadata }); const before = canvas.getData();
    assert(!applyEdgeStyle(canvas, "ab", { pattern: "dotted" })); assert.deepEqual(canvas.getData(), before);
  }
  const canvas = fixture(); canvas.root.nodes[0].type = "file"; canvas.edges.get("cb").raw.feuillets_managed = "relations";
  const before = canvas.getData(); assert(!applyEdgeStyle(canvas, "ab", { width: "thick" })); assert.deepEqual(canvas.getData(), before);
});

for (const [type, file] of [["text", undefined], ["file", "Note.md"], ["file", "Image.png"]]) test(`geometry changes preserve appearance and native identity for ${file ?? type} and support persistence and Undo/Redo`, () => {
  const canvas = fixture(); Object.assign(canvas.root.nodes[0], { type, ...(file ? { file } : {}) });
  const edge = canvas.edges.get("ab"); Object.assign(edge.raw, { color: "4", fromEnd: "arrow", toEnd: "arrow", feuillets_edge_style: { pattern: "dotted", width: "thick" } });
  const before = canvas.getData(); canvas.history[0] = structuredClone(before);
  assert.equal(getEdgeAppearance(edge.raw, before).geometry, "straight");
  for (const geometry of ["straight", "square", "map", "curved", "map", "straight"]) {
    const previous = canvas.getData(); assert(applyEdgeStyle(canvas, "ab", { geometry })); const after = canvas.getData();
    assert.deepEqual(after, { ...previous, edges: previous.edges.map((raw) => raw.id === "ab" ? { ...raw, feuillets_edge_style: { ...raw.feuillets_edge_style, geometry } } : raw) });
    canvas.undo(); assert.deepEqual(canvas.getData(), previous); canvas.redo(); assert.deepEqual(canvas.getData(), after);
    const reopened = fixture(); reopened.importData(JSON.parse(JSON.stringify(after))); assert.deepEqual(reopened.getData(), after);
    assert.equal(getEdgeAppearance(reopened.getData().edges[0], reopened.getData()).geometry, geometry);
    const entries = canvas.history.length; assert(applyEdgeStyle(canvas, "ab", { geometry })); assert.equal(canvas.history.length, entries);
  }
});
test("appearance edits and reset retain explicit geometry until another geometry is chosen", () => {
  const canvas = fixture(); applyEdgeStyle(canvas, "ab", { geometry: "curved", pattern: "dotted", width: "thick", arrows: "both", color: "3" });
  applyEdgeStyle(canvas, "ab", { pattern: "solid" }); assert.equal(canvas.edges.get("ab").raw.feuillets_edge_style.geometry, "curved");
  applyEdgeStyle(canvas, "ab", "reset"); assert.deepEqual(canvas.edges.get("ab").raw.feuillets_edge_style, { geometry: "curved" });
  const entries = canvas.history.length; applyEdgeStyle(canvas, "ab", "reset"); assert.equal(canvas.history.length, entries);
});
test("geometry choices reject structural edges without changing their data", () => {
  for (const metadata of [{ feuillets_managed: "mindmap" }, { feuillets_block_id: "relations" }]) {
    const canvas = fixture(); Object.assign(canvas.edges.get("ab").raw, metadata); const before = canvas.getData();
    for (const geometry of ["straight", "curved", "square", "map"]) assert(!applyEdgeStyle(canvas, "ab", { geometry })); assert.deepEqual(canvas.getData(), before);
  }
});

test("geometry changes invalidate the native spatial index without extra saves or history entries", () => {
  const canvas = fixture(), moved = []; canvas.markMoved = (edge) => moved.push(edge);
  for (const geometry of ["square", "map", "curved", "straight"]) {
    const previous = canvas.history.length; applyEdgeStyle(canvas, "ab", { geometry });
    assert.equal(moved.at(-1), canvas.edges.get("ab")); assert.equal(canvas.history.length, previous + 1);
  }
  assert.equal(moved.length, 4); applyEdgeStyle(canvas, "ab", { width: "thick" }); assert.equal(moved.length, 4);
});

for (const from of [{ type: "text" }, { type: "file", feuillets_managed: "manuscript" }, { type: "file", feuillets_managed: "research" }, { type: "file" }]) {
  for (const to of [{ type: "text" }, { type: "file", feuillets_managed: "manuscript" }, { type: "file", feuillets_managed: "research" }, { type: "file" }]) test(`ordinary connectors share defaults: ${JSON.stringify([from, to])}`, () => {
    const c = fixture(); Object.assign(c.root.nodes[0], from); Object.assign(c.root.nodes[1], to);
    const before = c.getData();
    assert.deepEqual(getEdgeAppearance(before.edges[0], before), { pattern: "dotted", width: "thin", color: "", arrows: "none", geometry: "straight" });
    assert(applyEdgeStyle(c, "ab", { geometry: "map", pattern: "dashed", width: "thick", arrows: "both", color: "3" }));
    const after = c.getData(); assert.deepEqual(after.nodes, before.nodes); assert.equal(after.edges[0].label, "Keep label");
    assert.deepEqual(getEdgeAppearance(after.edges[0], after), { pattern: "dashed", width: "thick", color: "3", arrows: "both", geometry: "map" });
  });
}
