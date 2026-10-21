import test from "node:test";
import assert from "node:assert/strict";
import { attachCompactFiles, compactFileSelection, expandedFileSize, isCompactableFile, setFilesCompact } from "../src/carnet/canvas/compact-files.js";
import { isOrdinaryCard } from "../src/carnet/canvas/ordinary-cards.js";

function fixture(advanced = false) {
  const initial = { nodes: ["a", "b"].map((id, index) => ({ id, type: "file", file: `Folder/${id}.md`, x: -121 + index * 640, y: 32, width: 373, height: 487,
    subpath: "#Section", vendor: { opaque: [1, 2, { extra: true }] }, styleAttributes: { border: "dashed" }, dynamicHeight: false })),
  edges: ["curved", "straight", "square", "map"].map((geometry) => ({ id: geometry, fromNode: "a", toNode: "b", fromSide: "right", toSide: "left", vendor: { retained: true }, feuillets_edge_style: { geometry } })), rootVendor: { retained: true } };
  let importing = false;
  const canvas = { nodes: new Map(), edges: new Map(), selection: new Set(), history: [structuredClone(initial)], current: 0, pending: false, saves: [], moved: [],
    getData() { return { ...structuredClone(initial), nodes: [...this.nodes.values()].map((node) => node.getData()) }; },
    requestSave(history = true) { this.saves.push(history); if (history) this.pending = true; },
    pushHistory(data) { this.history.splice(++this.current); this.history.push(structuredClone(data)); },
    importData(data) { importing = true; try { for (const raw of data.nodes) this.nodes.get(raw.id).setData(raw); } finally { importing = false; } },
    undo() { this.importData(this.history[--this.current]); }, redo() { this.importData(this.history[++this.current]); },
  };
  canvas.requestPushHistory = Object.assign(() => { canvas.pending = true; }, {
    run() { if (canvas.pending) { canvas.pending = false; canvas.pushHistory(canvas.getData()); } }, cancel() { canvas.pending = false; },
  });
  for (const raw of initial.nodes) {
    class FileNode {
      constructor(data) { this.id = data.id; this.raw = structuredClone(data); }
      getData() { return structuredClone(this.raw); }
      setData(data) { this.raw = structuredClone(data); canvas.moved.push(this.id); if (advanced && !importing) canvas.requestSave(); }
      getBBox() { const { x, y, width, height } = this.raw; return { minX: x, minY: y, maxX: x + width, maxY: y + height }; }
    }
    canvas.nodes.set(raw.id, new FileNode(raw));
  }
  let valid = true, refreshes = 0;
  const binding = attachCompactFiles(canvas, () => valid, () => "", () => { refreshes++; });
  return { canvas, binding, initial, invalidate: () => { valid = false; }, refreshes: () => refreshes };
}

for (const advanced of [false, true]) test(`compact FileNodes preserve native identity, dimensions, paths and every unknown field (${advanced ? "Advanced Canvas autosave" : "native"})`, () => {
  const f = fixture(advanced), c = f.canvas, instances = [...c.nodes.values()];
  assert(setFilesCompact(c, ["a", "b"], true));
  assert.equal(c.history.length, 2); assert.equal(f.refreshes(), 1);
  for (const node of instances) {
    assert.equal(c.nodes.get(node.id), node);
    const before = f.initial.nodes.find((raw) => raw.id === node.id), after = node.getData();
    assert.deepEqual(after, { ...before, width: 373, height: 56, feuillets_compact_file: { width: 373, height: 487, version: 2 } });
    assert.equal(isOrdinaryCard(c.getData(), after), true);
    assert.equal(node.getBBox().maxY, before.y + 56);
  }
  assert.deepEqual(c.getData().edges, f.initial.edges);
  const persisted = JSON.parse(JSON.stringify(c.getData()));
  const reopened = fixture(advanced); reopened.canvas.importData(persisted); reopened.binding.refresh();
  assert(setFilesCompact(reopened.canvas, ["a", "b"], false));
  assert.deepEqual(reopened.canvas.getData(), f.initial);
  c.undo(); f.binding.refresh(); assert.deepEqual(c.getData(), f.initial);
  c.redo(); f.binding.refresh(); assert.deepEqual(c.getData(), persisted);
  assert.equal(c.nodes.get("a"), instances[0]);
  assert(setFilesCompact(c, ["a", "b"], false)); assert.deepEqual(c.getData(), f.initial);
  assert.equal(c.history.length, 3);
  assert(setFilesCompact(c, ["a"], false)); assert.equal(c.history.length, 3);
  c.undo(); assert.deepEqual(c.getData(), persisted); c.redo(); assert.deepEqual(c.getData(), f.initial);
  f.binding.cleanup(); reopened.binding.cleanup();
});

test("protected structures, non-Markdown nodes and mixed selections are excluded", () => {
  for (const patch of [{ type: "text" }, { type: "group" }, { type: "link" }, { file: "Image.png" }, { file: "Nested.canvas" },
    { feuillets_block_id: "protected" }, { feuillets_plan_version: 1 }, { mindmapCollapsed: [] }, { feuillets_unknown_structure: true }, { feuillets_managed: "thread" }]) {
    const f = fixture(), node = f.canvas.nodes.get("a"); node.raw = { ...node.raw, ...patch };
    const before = f.canvas.getData();
    assert.equal(setFilesCompact(f.canvas, ["b", "a"], true), false); assert.deepEqual(f.canvas.getData(), before);
    f.canvas.selection = new Set(f.canvas.nodes.values()); assert.deepEqual(compactFileSelection(f.canvas), []);
    f.binding.cleanup();
  }
  for (const managed of [undefined, "manuscript", "research"]) {
    const f = fixture(); if (managed) f.canvas.nodes.get("a").raw.feuillets_managed = managed;
    assert.equal(isCompactableFile(f.canvas.getData(), f.canvas.nodes.get("a").getData()), true);
    f.binding.cleanup();
  }
  const data = { nodes: [], edges: [{ id: "protected", fromNode: "a", feuillets_block_id: "block" }] };
  assert.equal(isCompactableFile(data, { id: "a", type: "file", file: "A.md" }), false);
});

test("ordinary canvases, closed views, readonly and editing states cannot be mutated", () => {
  const f = fixture(), c = f.canvas, before = c.getData();
  c.selection = new Set(c.nodes.values()); assert.equal(compactFileSelection(c).length, 2);
  for (const flag of ["readonly", "isDragging"]) { c[flag] = true; assert.equal(setFilesCompact(c, ["a"], true), false); assert.deepEqual(compactFileSelection(c), []); c[flag] = false; }
  c.nodes.get("a").isEditing = true; assert.equal(setFilesCompact(c, ["a"], true), false); c.nodes.get("a").isEditing = false;
  f.invalidate(); assert.equal(setFilesCompact(c, ["a"], true), false);
  f.binding.cleanup(); assert.equal(setFilesCompact(c, ["a"], true), false); assert.deepEqual(compactFileSelection(c), []);
  assert.deepEqual(c.getData(), before); assert.equal(c.history.length, 1);
  assert.equal(attachCompactFiles({}, () => true, () => "", () => {}), null);
});

test("malformed compact state and invalid dimensions are not used as restoration geometry", () => {
  for (const value of [true, {}, { width: 0, height: 20 }, { width: 300, height: NaN }, { width: "300", height: 200 }]) assert.equal(expandedFileSize({ id: "a", feuillets_compact_file: value }), undefined);
  const f = fixture(); f.canvas.nodes.get("a").raw.width = Infinity;
  assert.equal(setFilesCompact(f.canvas, ["b", "a"], true), false); assert.equal(f.canvas.history.length, 1); f.binding.cleanup();
});

test("context menu offers the current action, batches selection and rejects a stale card", async () => {
  const { registerCarnetNoteStyleMenu } = await import("../src/carnet/canvas/note-style.js");
  const { Menu } = await import("obsidian");
  const { t } = await import("../src/i18n/index.js");
  const f = fixture(), c = f.canvas, file = { path: "Carnet.canvas" };
  c.view = { file };
  for (const node of c.nodes.values()) node.canvas = c;
  c.selection = new Set(c.nodes.values());
  let open;
  registerCarnetNoteStyleMenu({ app: { workspace: { on: (name, callback) => { assert.equal(name, "canvas:node-menu"); open = callback; return {}; } } }, registerEvent() {} }, (candidate) => candidate === file, () => f.binding.refresh());
  const a = c.nodes.get("a"), menu = new Menu(); open(menu, a);
  const collapse = menu.items.find((item) => item.title === t("carnet.compact.collapse")); assert(collapse);
  collapse.click(); assert.equal(c.history.length, 2);
  for (const node of c.nodes.values()) assert(expandedFileSize(node.getData()));
  const expanded = new Menu(); open(expanded, a);
  const expand = expanded.items.find((item) => item.title === t("carnet.compact.expand")); assert(expand);
  expand.click(); assert.deepEqual(c.getData(), f.initial); assert.equal(c.history.length, 3);
  const stale = new Menu(); open(stale, a);
  c.nodes.set("a", { ...a, getData: () => a.getData() });
  stale.items.find((item) => item.title === t("carnet.compact.collapse")).click(); assert.equal(c.history.length, 3);
  f.binding.cleanup();
});

test("native editing expands the same FileNode first and removes its instance bindings on cleanup", () => {
  const f = fixture(), c = f.canvas, node = c.nodes.get("a");
  node.render = () => {};
  node.startEditing = (position) => { node.isEditing = true; node.editPosition = position; };
  const originalRender = node.render, originalEditing = node.startEditing;
  f.binding.refresh();
  assert(setFilesCompact(c, ["a"], true));
  const position = { line: 2, ch: 4 };
  node.startEditing(position);
  assert.equal(node.isEditing, true); assert.equal(node.editPosition, position);
  assert.deepEqual(node.getData(), f.initial.nodes[0]);
  assert.equal(c.history.length, 3); assert.equal(c.nodes.get("a"), node);
  f.binding.cleanup();
  assert.equal(node.render, originalRender); assert.equal(node.startEditing, originalEditing);
});

test("Advanced Canvas automatic-height metadata survives both states", () => {
  const f = fixture(true), c = f.canvas, node = c.nodes.get("a");
  node.raw.dynamicHeight = true; node.raw.styleAttributes = { textAlign: "center", vendor: "opaque" };
  const before = node.getData();
  assert(setFilesCompact(c, ["a"], true)); assert.equal(node.getData().dynamicHeight, true);
  assert(setFilesCompact(c, ["a"], false)); assert.deepEqual(node.getData(), before);
  f.binding.cleanup();
});

for (const advanced of [false, true]) test(`ten compact cycles retain the live width, color and native edge data (${advanced ? "Advanced Canvas" : "native"})`, () => {
  const f = fixture(advanced), c = f.canvas, node = c.nodes.get("a");
  Object.assign(node.raw, { width: 420, color: "4", feuillets_note_style: "plain" });
  const before = node.getData(), edges = c.getData().edges;
  for (let cycle = 0; cycle < 10; cycle++) {
    assert(setFilesCompact(c, ["a"], true));
    assert.equal(node.getData().width, 420); assert.equal(node.getData().height, 56);
    assert.equal(node.getData().color, "4");
    assert.equal(node.getBBox().maxX, before.x + 420);
    assert.deepEqual(c.getData().edges, edges);
    assert(setFilesCompact(c, ["a"], false));
    assert.deepEqual(node.getData(), before);
  }
  assert.equal(c.history.length, 21);
  f.binding.cleanup();
});

test("compact resizing keeps the new width when expanded, undone, saved and reopened", () => {
  const f = fixture(true), c = f.canvas, node = c.nodes.get("a");
  assert(setFilesCompact(c, ["a"], true));
  node.setData({ ...node.getData(), width: 517, height: 72 });
  c.requestPushHistory.run();
  const resized = c.getData();
  assert(setFilesCompact(c, ["a"], false));
  const expanded = c.getData();
  assert.equal(node.getData().width, 517); assert.equal(node.getData().height, 487);
  c.undo(); assert.deepEqual(c.getData(), resized);
  c.redo(); assert.deepEqual(c.getData(), expanded);
  const reopened = fixture(); reopened.canvas.importData(JSON.parse(JSON.stringify(resized)));
  assert(setFilesCompact(reopened.canvas, ["a"], false)); assert.deepEqual(reopened.canvas.getData(), expanded);
  f.binding.cleanup(); reopened.binding.cleanup();
});

test("legacy 260px cards restore their saved width unless manually resized", () => {
  for (const liveWidth of [260, 536]) {
    const f = fixture(), c = f.canvas, node = c.nodes.get("a");
    node.raw = { ...node.raw, width: liveWidth, height: 56, feuillets_compact_file: { width: 420, height: 487 } };
    c.history[0] = c.getData();
    const before = c.getData(), width = liveWidth === 260 ? 420 : liveWidth;
    assert(setFilesCompact(c, ["a"], false));
    assert.equal(node.getData().width, width); assert.equal(node.getData().height, 487);
    c.undo(); assert.deepEqual(c.getData(), before);
    c.redo(); assert.equal(node.getData().width, width);
    assert(setFilesCompact(c, ["a"], true));
    assert.equal(node.getData().width, width); assert.equal(node.getData().feuillets_compact_file.version, 2);
    f.binding.cleanup();
  }
});

class DecorationElement {
  constructor(cls = "", tag = "div") {
    this.tag = tag; this.classes = new Set(cls.split(" ")); this.children = []; this.attributes = new Map(); this.textContent = "";
    this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name) };
  }
  createDiv({ cls }) { const child = new DecorationElement(cls); child.parent = this; this.children.push(child); return child; }
  createSpan({ cls }) { const child = new DecorationElement(cls, "span"); child.parent = this; this.children.push(child); return child; }
  querySelector(selector) { return this.children.find((child) => child.classes.has(selector.slice(1))) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
}

test("individual renders decorate only their FileNode, without global scans, controls or icons", () => {
  const f = fixture(), c = f.canvas, a = c.nodes.get("a"), b = c.nodes.get("b");
  for (const node of [a, b]) {
    node.nodeEl = new DecorationElement("canvas-node"); node.nodeEl.createDiv({ cls: "canvas-node-container" });
    node.render = () => {};
  }
  const originalA = a.render, originalB = b.render;
  f.binding.refresh(); assert(setFilesCompact(c, ["a", "b"], true));
  const title = (node) => node.nodeEl.children[0].querySelector(".feuillets-compact-file-title");
  assert.equal(title(a).children.length, 1); assert.equal(title(a).children[0].tag, "span");
  assert.equal(title(a).children[0].textContent, "a");
  assert.deepEqual(a.nodeEl.children[0].children.map((element) => [...element.classes]), [["feuillets-compact-file-title"]]);
  const nativeGetData = c.getData; c.getData = () => assert.fail("A FileNode render must not snapshot the whole Canvas");
  const nativeReadB = b.getData; b.getData = () => assert.fail("Rendering a must not inspect or decorate b");
  const firstWrapper = a.render;
  for (let i = 0; i < 10; i++) a.render();
  assert.equal(a.render, firstWrapper); assert.equal(a.nodeEl.children[0].children.length, 1);
  b.getData = nativeReadB; c.getData = nativeGetData;
  const replacement = new DecorationElement("canvas-node-container"); a.nodeEl.children = [replacement];
  a.render(); assert.equal(replacement.children.length, 1);
  a.setData({ ...a.getData(), feuillets_block_id: "protected" }); a.render();
  assert.equal(replacement.children.length, 0); assert(!a.nodeEl.classes.has("feuillets-compact-file"));
  f.binding.refresh(); assert.equal(a.render, originalA);
  f.binding.cleanup(); assert.equal(b.render, originalB); assert.equal(b.nodeEl.children[0].children.length, 0);
});
