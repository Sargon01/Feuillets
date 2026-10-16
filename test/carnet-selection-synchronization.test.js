import test from "node:test";
import assert from "node:assert/strict";
import { Menu } from "obsidian";
import { attachCarnetWorkspaceBinding } from "../src/carnet/canvas/workspace-binding.js";
import { CarnetWorkspaceContext } from "../src/carnet/core/workspace-context.js";
import { getCarnetArrangementActions } from "../src/carnet/canvas/arrangement-menu.js";
import { CarnetsContent } from "../src/ui/carnets-content.js";

function fixture() {
  const frames = new Map(), file = { path: "Carnet.canvas" }, calls = [];
  let sequence = 0, nativeFrame, clickGuard = false, captures = 0;
  const win = {
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const c = {
    nodes: new Map(), edges: new Map(), selection: new Set(), saves: 0,
    wrapperEl: { isConnected: true, ownerDocument: { defaultView: win } },
    history: { data: [], current: 0 },
    getData() { return { nodes: [...this.nodes.values()].map((node) => node.getData()), edges: [] }; },
    requestSave() { this.saves++; }, pushHistory() {},
    requestPushHistory: Object.assign(() => {}, { run() {}, cancel() {} }),
    addNode(node) { this.nodes.set(node.id, node); }, addEdge(edge) { this.edges.set(edge.id, edge); }, importData() {},
    updateSelection(change) { this.staleSelection ??= [...this.selection]; change(); requestNativeFrame(); },
    setDragging(value) { this.isDragging = value; this.selectionChanged = true; requestNativeFrame(); },
  };
  const view = { file, canvas: c }, leaves = [{ view }]; c.view = view;
  const workspace = { getLeavesOfType: () => leaves, getActiveFile: () => null };
  const context = new CarnetWorkspaceContext(workspace, (candidate) => candidate === file);
  function requestNativeFrame() {
    nativeFrame ??= win.requestAnimationFrame(() => {
      nativeFrame = undefined; c.staleSelection = null; c.selectionChanged = false;
      context.changed();
    });
  }
  for (const [i, id] of ["a", "b", "c"].entries()) c.nodes.set(id, {
    id, isEditing: false, nodeEl: { classList: { contains: () => false } }, moveTo() {}, setData() {},
    getData: () => ({ id, type: "text", text: id, x: i * 200, y: i * 80, width: 120, height: 60 }),
  });
  c.history.data.push(c.getData());
  const parent = { insertBefore(target) { target.parentNode = this; } };
  const button = { parentNode: parent, nextSibling: null, remove() { this.parentNode = null; }, click() {
    // Native marquee completion suppresses clicks reaching the Canvas ancestor.
    if (clickGuard && this.parentNode === parent) return;
    captures++;
    const menu = new Menu(); menu.parentEl = button;
    for (const [section, count] of [["align-h", 3], ["align-v", 3], ["arrange", 3], ["distribute", 2]]) {
      for (let i = 0; i < count; i++) menu.addItem((item) => {
        const title = `${section}-${i}`;
        item.setTitle(title).setIcon("layout-grid").onClick(() => calls.push(title));
        item.section = section; item.titleEl = { textContent: title };
        item.iconEl = { querySelector: () => ({ classList: ["svg-icon", "layout-grid"] }) };
      });
    }
    menu.showAtPosition({ x: 0, y: 0 });
  } };
  c.menu = { render() {}, menuEl: { appendChild() {}, querySelector: () => button } };
  const originals = { updateSelection: c.updateSelection, setDragging: c.setDragging };
  const binding = attachCarnetWorkspaceBinding(c, () => leaves.some((leaf) => leaf.view === view), () => context.changed(), () => ({}));
  // Exercise the real inspector refresh/cache, with only DOM rendering replaced.
  const ui = Object.create(CarnetsContent.prototype);
  Object.assign(ui, {
    app: { workspace, vault: { getAbstractFileByPath: () => file } },
    plugin: { settings: {}, carnetLifecycle: { context }, getProjectFolder: () => null, isSceneFile: () => false,
      isFeuilletsCarnetFile: () => true, resolveCarnetTitleForFile: () => "Carnet" },
    host: { classList: { toggle() {} } }, title: { setText() {} }, inspector: { childElementCount: 0 }, inspectorHint: {},
    defaultsContent: { refresh() {} }, tools: { childElementCount: 1 }, managerKey: "", selectedEntry: "", sheet: null,
    selection: null, selectionKey: "", updates: [], toolUpdates: [], alive: true, queued: false, actions: [],
    renderManager() {},
    renderInspector(selection) {
      this.actions = selection ? getCarnetArrangementActions(c, () => context.valid(selection)) : [];
      this.inspector.childElementCount = this.actions.length;
    },
  });
  context.activate(view); ui.refresh();
  const select = (ids) => c.updateSelection(() => { c.selection = new Set(ids.map((id) => c.nodes.get(id))); });
  const settle = async () => {
    const batch = [...frames]; frames.clear();
    for (const [, callback] of batch) { callback(); await Promise.resolve(); }
    await Promise.resolve();
  };
  const counts = () => Object.fromEntries(["align", "arrange", "distribute", "stack"].map((section) =>
    [section, ui.actions.filter((action) => section === "align" ? action.section.startsWith(section) : action.section === section).length]));
  return { c, context, view, leaves, ui, binding, frames, originals, calls, select, settle, counts,
    get captures() { return captures; }, guardClick() { clickGuard = true; },
    cleanup() { binding.cleanup(); ui.unsubscribeContext?.(); ui.onunload(); context.cleanup(); },
  };
}

test("selection-only changes reach the cached inspector after native completion, without moving or saving cards", async () => {
  const f = fixture(), before = f.c.getData();
  for (const [ids, expected] of [[["a", "b"], [6, 3, 0]], [["a", "b", "c"], [6, 3, 2]], [["b", "c"], [6, 3, 0]], [["b"], [0, 0, 0]], [[], [0, 0, 0]]]) {
    f.select(ids); f.context.changed(); await Promise.resolve();
    assert.equal(f.context.snapshot(), null);
    await f.settle();
    const counts = f.counts(); assert.deepEqual([counts.align, counts.arrange, counts.distribute], expected);
    assert.deepEqual(f.c.getData(), before); assert.equal(f.c.saves, 0);
  }
  f.cleanup();
});

test("marquee release cannot cache Stack-only controls while native trailing-click suppression is active", async () => {
  const f = fixture(), before = f.c.getData();
  f.c.setDragging(true); f.select(["a", "b", "c"]); await f.settle();
  assert.equal(f.context.snapshot(), null);
  f.c.setDragging(false); f.guardClick(); f.context.changed(); await Promise.resolve();
  assert.equal(f.counts().align, 6); assert.equal(f.counts().distribute, 2);
  f.context.activate({ getViewType: () => "feuillets-sidebar-view" });
  assert.equal(f.context.current().view, f.view);
  await f.settle();
  assert.deepEqual(f.counts(), { align: 6, arrange: 3, distribute: 2, stack: 2 });
  const action = f.ui.actions[0]; action.run({}); assert.deepEqual(f.calls, ["align-h-0"]);
  assert.deepEqual(f.c.getData(), before); assert.equal(f.c.saves, 0);
  f.cleanup();
});

test("pending selection reads coalesce, reject closed targets and are cancelled on plugin cleanup", async () => {
  const f = fixture(); f.select(["a"]); f.select(["a", "b"]); f.select(["a", "b", "c"]);
  assert.equal(f.frames.size, 2); // One native frame and one Feuillets completion read.
  f.leaves.length = 0; await f.settle(); assert.equal(f.context.current(), null); assert.equal(f.captures, 0);
  f.cleanup(); assert.equal(f.c.updateSelection, f.originals.updateSelection); assert.equal(f.c.setDragging, f.originals.setDragging);
  const other = fixture(); other.select(["a", "b"]); assert.equal(other.frames.size, 2);
  other.cleanup(); assert.equal(other.frames.size, 1); await other.settle(); assert.deepEqual(other.ui.actions, []);
});
