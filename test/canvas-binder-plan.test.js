import test from "node:test";
import assert from "node:assert/strict";
import { BINDER_OUTLINER_MARKER, addOutlinerItem, binderOutlinerFingerprint, movePlanItem, outlinerFallback, refreshOutlinerItems, removeNewOutlinerItem, upsertBinderOutliner } from "../src/services/canvas-binder-plan.js";

const snapshot = { path: "Book/Manuscript", title: "Manuscript", children: [{ id: "part", kind: "folder", path: "Book/Manuscript/Part", title: "Part", collapsed: false, children: [{ id: "scene", kind: "file", path: "Book/Manuscript/Part/Scene.md", title: "Scene", collapsed: false, children: [] }] }] };

test("Binder snapshot creates one fixed-size 520×620 outliner TextNode and no edges", () => {
  const result = upsertBinderOutliner({ nodes: [], edges: [] }, snapshot);
  assert.equal(result.ok, true); assert.equal(result.canvas.nodes.length, 1); assert.equal(result.canvas.edges.length, 0);
  const node = result.canvas.nodes[0]; assert.equal(node.type, "text"); assert.equal(node.width, 520); assert.equal(node.height, 620); assert.equal(node.dynamicHeight, false); assert.equal(node.feuillets_binder_ui_version, 2); assert.equal(node.feuillets_binder_plan, BINDER_OUTLINER_MARKER); assert.equal(node.feuillets_binder_root, snapshot.path);
});

test("refresh reuses its unique card, preserves foreign Canvas data and collapsed paths", () => {
  const foreign = { id: "free", type: "text", text: "free" }; const first = upsertBinderOutliner({ nodes: [foreign], edges: [{ id: "edge", fromNode: "free", toNode: "free" }] }, snapshot); assert.equal(first.ok, true);
  first.canvas.nodes.find((node) => node.feuillets_binder_plan).feuillets_binder_items[0].collapsed = true;
  const second = upsertBinderOutliner(first.canvas, snapshot); assert.equal(second.ok, true); assert.equal(second.nodeId, first.nodeId); assert.equal(second.canvas.nodes.length, 2); assert.deepEqual(second.canvas.nodes.find((node) => node.id === "free"), foreign); assert.equal(second.canvas.nodes.find((node) => node.feuillets_binder_plan).feuillets_binder_items[0].collapsed, true);
});

test("multiple outliner cards refuse without mutation", () => {
  const first = upsertBinderOutliner({ nodes: [], edges: [] }, snapshot); assert.equal(first.ok, true); const canvas = { ...first.canvas, nodes: [...first.canvas.nodes, { ...first.canvas.nodes[0], id: "other" }] }; const before = JSON.stringify(canvas); assert.equal(upsertBinderOutliner(canvas, snapshot).ok, false); assert.equal(JSON.stringify(canvas), before);
});

test("new items are added and only new items may be removed", () => {
  const items = addOutlinerItem(snapshot.children, "new-file"); const fresh = items.at(-1); assert.equal(fresh.kind, "new-file"); assert.equal(removeNewOutlinerItem(items, fresh.id).length, snapshot.children.length); assert.equal(removeNewOutlinerItem(items, "part").length, items.length);
});

test("fingerprint is stable, fallback remains readable, and refresh keeps snapshot order", () => {
  assert.equal(binderOutlinerFingerprint(snapshot), binderOutlinerFingerprint(snapshot)); assert.match(outlinerFallback(snapshot), /Plan du manuscrit[\s\S]*Part[\s\S]*Scene/);
  const refreshed = refreshOutlinerItems({ ...snapshot, children: [...snapshot.children].reverse() }, snapshot.children); assert.deepEqual(refreshed.map((item) => item.path), ["Book/Manuscript/Part"]);
});

test("movePlanItem supports before, after and inside while preserving its subtree", () => {
  const items = [{ id: "a", kind: "folder", title: "A", collapsed: false, children: [{ id: "a1", kind: "file", title: "A1", collapsed: false, children: [] }] }, { id: "b", kind: "folder", title: "B", collapsed: false, children: [] }, { id: "c", kind: "file", title: "C", collapsed: false, children: [] }];
  assert.deepEqual(movePlanItem(items, "c", "a", "before").map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(movePlanItem(items, "a", "c", "after").map((item) => item.id), ["b", "c", "a"]);
  const inside = movePlanItem(items, "a", "b", "inside"); const target = inside.find((item) => item.id === "b"); assert.deepEqual(target.children.map((item) => item.id), ["a"]); assert.equal(target.children[0].children[0].id, "a1");
});

test("movePlanItem refuses self, cycles and inside a file", () => {
  const items = [{ id: "folder", kind: "folder", title: "Folder", collapsed: false, children: [{ id: "file", kind: "file", title: "File", collapsed: false, children: [] }] }, { id: "other", kind: "file", title: "Other", collapsed: false, children: [] }];
  assert.equal(movePlanItem(items, "folder", "folder", "before"), items); assert.equal(movePlanItem(items, "folder", "file", "inside"), items); assert.equal(movePlanItem(items, "other", "file", "inside"), items);
});
