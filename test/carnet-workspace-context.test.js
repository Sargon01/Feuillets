import test from "node:test";
import assert from "node:assert/strict";
import { CarnetWorkspaceContext } from "../src/carnet/core/workspace-context.js";

function fixture() {
  const node = { getData: () => ({ id: "note", type: "text" }) };
  const edge = { getData: () => ({ id: "edge", fromNode: "note", toNode: "note" }) };
  const create = (path) => ({ file: { path }, canvas: { nodes: new Map([["note", node]]), edges: new Map([["edge", edge]]), selection: new Set([node]),
    getData() { return { nodes: [...this.nodes.values()].map((n) => n.getData()), edges: [...this.edges.values()].map((e) => e.getData()) }; } } });
  const a = create("A.canvas"), b = create("B.canvas");
  const leaves = [{ view: a }, { view: b }];
  const context = new CarnetWorkspaceContext({ getLeavesOfType: () => leaves }, (file) => ["A.canvas", "B.canvas"].includes(file?.path));
  context.activate(a);
  return { a, b, node, edge, leaves, context };
}

test("sidebar focus retains the exact view and selection; a second Carnet invalidates old controls", () => {
  const { context, a, b } = fixture(), snapshot = context.snapshot();
  context.activate({ getViewType: () => "sidebar-feuillets" });
  assert.equal(context.current().view, a);
  assert(context.valid(snapshot));
  context.activate(b);
  assert.equal(context.current().view, b);
  assert.equal(context.valid(snapshot), false);
});

test("closed, renamed, reused and replaced Canvas views invalidate retained targets", () => {
  for (const mutate of [
    (f) => f.leaves.splice(0, 1),
    (f) => { f.a.file = { path: "A.canvas" }; },
    (f) => { f.a.canvas = { ...f.a.canvas }; },
    (f) => { f.a.file.path = "Ordinary.canvas"; },
  ]) {
    const f = fixture(), snapshot = f.context.snapshot();
    mutate(f);
    assert.equal(f.context.valid(snapshot), false);
    assert.equal(f.context.current(), null);
  }
});

test("removed or replaced nodes and edges cannot be addressed through a stale selection", () => {
  for (const kind of ["nodes", "edges"]) for (const replace of [true, false]) {
    const f = fixture(), object = kind === "nodes" ? f.node : f.edge, id = object.getData().id;
    f.a.canvas.selection = new Set([object]);
    const snapshot = f.context.snapshot();
    if (replace) f.a.canvas[kind].set(id, { ...object });
    else f.a.canvas[kind].delete(id);
    assert.equal(f.context.valid(snapshot), false);
    assert.equal(f.context.snapshot(), null);
  }
});

test("empty, readonly, dragging and unreadable selections are handled without writes", () => {
  const { a, context } = fixture();
  a.canvas.selection.clear();
  assert.deepEqual(context.snapshot().objects, []);
  for (const key of ["readonly", "isDragging"]) {
    a.canvas[key] = true; assert.equal(context.snapshot(), null); a.canvas[key] = false;
  }
  a.canvas.getData = () => { throw new Error("View closed"); };
  assert.equal(context.snapshot(), null);
});

test("ordinary Canvas and Markdown navigation clear the target, while cleanup removes subscriptions", () => {
  const { context, a } = fixture();
  let changes = 0;
  const unsubscribe = context.subscribe(() => changes++);
  context.changed(); assert.equal(changes, 1);
  unsubscribe(); context.changed(); assert.equal(changes, 1);
  for (const view of [{ file: { path: "Ordinary.canvas" }, canvas: a.canvas }, { file: { path: "Scene.md" } }]) {
    context.activate(a); context.activate(view); assert.equal(context.current(), null);
  }
  context.subscribe(() => changes++);
  context.activate(a);
  const before = changes;
  context.cleanup(); context.changed(); context.activate(a);
  assert.equal(changes, before); assert.equal(context.current(), null);
});

test("only pending native selection snapshots block controls; native color/menu dirty flags do not", () => {
  const { a, context } = fixture(), before = context.snapshot();
  a.canvas.selectionChanged = true;
  assert(context.valid(before)); assert.equal(context.snapshot().objects[0], before.objects[0]);
  a.canvas.staleSelection = [];
  assert.equal(context.snapshot(), null); assert.equal(context.valid(before), false);
  a.canvas.staleSelection = null;
  assert(context.valid(before)); assert.equal(context.snapshot().objects[0], before.objects[0]);
});
