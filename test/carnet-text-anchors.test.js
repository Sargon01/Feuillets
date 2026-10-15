import test from "node:test";
import assert from "node:assert/strict";
import { rectangleAnchor, attachTextAnchors } from "../src/carnet/canvas/text-anchors.js";

const rect = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

test("horizontal and vertical connections intersect the native rectangle sides", () => {
  const bounds = rect(20, 20, 90, 40);
  for (const [target, side, x, y] of [[{ x: 400, y: 30 }, "right", 90, 30], [{ x: -100, y: 30 }, "left", 20, 30], [{ x: 55, y: 300 }, "bottom", 55, 40], [{ x: 55, y: -300 }, "top", 55, 20]]) {
    const result = rectangleAnchor(bounds, target);
    assert.equal(result.side, side);
    assert.deepEqual(result.box, rect(x, y, x, y));
  }
});

test("diagonal connections use the geometric intersection rather than the side midpoint", () => {
  const bounds = rect(0, 0, 400, 200);
  assert.deepEqual(rectangleAnchor(bounds, { x: 800, y: 250 }), { side: "right", box: rect(400, 150, 400, 150) });
  assert.deepEqual(rectangleAnchor(bounds, { x: 300, y: 500 }), { side: "bottom", box: rect(225, 200, 225, 200) });
  assert.equal(rectangleAnchor(bounds, { x: 200, y: 100 }), null);
  assert.equal(rectangleAnchor(rect(0, 0, 0, 200), { x: 500, y: 0 }), null);
});

test("three destinations naturally produce ordered points on the same right boundary", () => {
  const bounds = rect(0, 0, 400, 200);
  const points = [0, 100, 200].map((y) => rectangleAnchor(bounds, { x: 800, y }));
  assert(points.every((point) => point.side === "right" && point.box.minX === 400));
  assert(points[0].box.minY < points[1].box.minY && points[1].box.minY < points[2].box.minY);
  assert.equal(new Set(points.map((point) => point.box.minY)).size, 3);
});

test("unsupported runtimes are not patched", () => {
  assert.equal(attachTextAnchors({ nodes: new Map(), edges: new Map() }), null);
});

function runtimeFixture() {
  const observers = [], marked = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const doc = { defaultView: { MutationObserver: Observer, ResizeObserver: Observer },
    createTreeWalker() { throw new Error("Connection geometry must not measure rendered text"); },
    createRange() { throw new Error("Connection geometry must not measure glyphs"); } };
  const makeNode = (id, x, style) => {
    const node = { id, x, y: 0, width: 400, height: 200, style,
      getBBox() { return rect(this.x, this.y, this.x + this.width, this.y + this.height); },
      getData() { return { id, type: "text", feuillets_note_style: this.style, text: "Short line\nA much longer second line", x: this.x, y: this.y, width: this.width, height: this.height }; },
      contentEl: { querySelector() { throw new Error("Connection geometry must not inspect individual text lines"); } },
      nodeEl: { ownerDocument: doc },
    };
    return node;
  };
  const a = makeNode("a", 0, "plain"), b = makeNode("b", 600, "rounded");
  const edge = {
    from: { node: a, side: "right", end: "none" }, to: { node: b, side: "left", end: "none" },
    getData() { return { id: "ab", fromNode: this.from.node.id, toNode: this.to.node.id }; },
    updatePath() { this.drawn = { from: this.from.node.getBBox(), to: this.to.node.getBBox(), fromEnd: this.from.end, toEnd: this.to.end }; if (this.fail) throw new Error("Native drawing failure"); },
    getBBox() { const from = this.from.node.getBBox(), to = this.to.node.getBBox(); return rect(from.minX, from.minY, to.maxX, to.maxY); },
  };
  const canvas = { nodes: new Map([["a", a], ["b", b]]), edges: new Map([["ab", edge]]), markMoved: (edge) => marked.push(edge), addEdge() {}, removeEdge() {}, getEdgesForNode: (node) => node === a || node === b ? [edge] : [] };
  return { canvas, a, b, edge, observers, marked };
}

test("native paths and spatial bounds use card rectangles and never rendered lines or glyphs", () => {
  const f = runtimeFixture(), before = f.a.getData(), from = f.edge.from, to = f.edge.to;
  const drawing = f.edge.updatePath, bounds = f.edge.getBBox;
  const binding = attachTextAnchors(f.canvas);
  binding.refresh(new Set(["a", "b"]));
  f.edge.updatePath();
  assert.deepEqual(f.edge.drawn.from, rect(400, 100, 400, 100));
  assert.deepEqual(f.edge.drawn.to, rect(600, 100, 600, 100));
  assert.equal(f.edge.from, from); assert.equal(f.edge.to, to);
  assert.deepEqual(f.a.getData(), before);
  assert.equal(f.edge.getBBox().minX, 400);
  f.a.x += 100;
  f.edge.updatePath();
  assert.equal(f.edge.drawn.from.minX, 500);
  binding.cleanup();
  assert.equal(f.edge.updatePath, drawing); assert.equal(f.edge.getBBox, bounds);
  assert(f.observers.every((observer) => observer.disconnected));
});

test("plain, outline, rounded, filled and classic notes share geometry for identical dimensions", () => {
  const f = runtimeFixture(), binding = attachTextAnchors(f.canvas);
  binding.refresh(new Set(["a", "b"]));
  f.edge.updatePath();
  const baseline = structuredClone(f.edge.drawn);
  for (const style of [undefined, "plain", "outline", "rounded", "filled", "classic"]) {
    f.a.style = style;
    binding.refresh(new Set(["a", "b"])); f.edge.updatePath();
    assert.deepEqual(f.edge.drawn, baseline);
  }
  binding.cleanup();
});

test("live editing and manual dimensions immediately change the rectangle without inspecting the iframe", () => {
  const f = runtimeFixture(), binding = attachTextAnchors(f.canvas);
  binding.refresh(new Set(["a", "b"]));
  f.a.isEditing = true;
  f.a.height = 400; f.b.y = 100;
  f.edge.updatePath();
  assert.deepEqual(f.edge.drawn.from, rect(400, 200, 400, 200));
  f.a.width = 300; f.a.height = 100;
  f.edge.updatePath();
  assert.equal(f.edge.drawn.from.minX, 300);
  assert(f.edge.drawn.from.minY >= 0 && f.edge.drawn.from.minY <= 100);
  f.marked.length = 0;
  binding.update(f.a);
  assert.deepEqual(f.marked, [f.edge]);
  binding.cleanup();
});

test("content notifications still reach the existing sizer and only connected edges", () => {
  const changed = [], f = runtimeFixture(), binding = attachTextAnchors(f.canvas, (node) => changed.push(node));
  binding.refresh(new Set(["a", "b"]));
  f.marked.length = 0; f.observers[0].callback();
  assert.deepEqual(changed, [f.a]); assert.deepEqual(f.marked, [f.edge]);
  binding.cleanup();
});

test("temporary native endpoints are restored even when native drawing fails", () => {
  const f = runtimeFixture(), from = f.edge.from, to = f.edge.to;
  const binding = attachTextAnchors(f.canvas);
  binding.refresh(new Set(["a", "b"])); f.edge.fail = true;
  assert.throws(() => f.edge.updatePath(), /Native drawing failure/);
  assert.equal(f.edge.from, from); assert.equal(f.edge.to, to);
  binding.cleanup();
});

test("structural edges and nodes outside the free-note set remain native", () => {
  const f = runtimeFixture(), drawing = f.edge.updatePath, binding = attachTextAnchors(f.canvas);
  binding.refresh(new Set(["a"]));
  assert.equal(f.edge.updatePath, drawing);
  f.edge.getData = () => ({ id: "ab", feuillets_managed: "mindmap" });
  binding.refresh(new Set(["a", "b"]));
  assert.equal(f.edge.updatePath, drawing);
  binding.cleanup();
});

test("external styles keep native edge geometry", () => {
  for (const style of [{ pathStyle: "curved" }, { feuillets_managed: "relations" }]) {
    const f = runtimeFixture(), drawing = f.edge.updatePath, getData = f.edge.getData.bind(f.edge);
    f.edge.getData = () => ({ ...getData(), ...style });
    const binding = attachTextAnchors(f.canvas);
    binding.refresh(new Set(["a", "b"]));
    assert.equal(f.edge.updatePath, drawing);
    binding.cleanup();
  }
});

test("native colors and Feuillets styles retain rectangular attachment geometry", () => {
  const f = runtimeFixture(), binding = attachTextAnchors(f.canvas);
  binding.refresh(new Set(["a", "b"]));
  const getData = f.edge.getData.bind(f.edge);
  f.edge.getData = () => ({ ...getData(), color: "2", fromEnd: "arrow", feuillets_edge_style: { pattern: "dotted", width: "thick" } });
  f.edge.updatePath();
  assert.deepEqual(f.edge.drawn.from, rect(400, 100, 400, 100));
  binding.cleanup();
});

test("native arrowheads align with the straight path and all appearance attributes are reversible", () => {
  const f = runtimeFixture(), elements = [];
  const element = () => {
    const attributes = new Map(), classes = new Set(), el = { attributes, classes, style: {},
      setAttribute(k, v) { attributes.set(k, v); }, removeAttribute(k) { attributes.delete(k); },
      classList: { add(k) { classes.add(k); }, remove(k) { classes.delete(k); } },
    }; elements.push(el); return el;
  };
  f.edge.lineGroupEl = element(); f.edge.lineEndGroupEl = element();
  f.edge.path = { display: element(), interaction: element() };
  f.edge.fromLineEnd = { el: element() }; f.edge.toLineEnd = { el: element() };
  f.edge.from.end = "arrow"; f.edge.to.end = "arrow"; f.b.y = 300;
  const getData = f.edge.getData.bind(f.edge);
  f.edge.getData = () => ({ ...getData(), feuillets_edge_style: { pattern: "dotted", width: "thick" }, color: "3" });
  const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"])); f.edge.updatePath();
  const { from, to } = f.edge.bezier, angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
  assert.equal(f.edge.fromLineEnd.el.style.transform, `translate(${from.x}px, ${from.y}px) rotate(${angle - 90}deg)`);
  assert.equal(f.edge.toLineEnd.el.style.transform, `translate(${to.x}px, ${to.y}px) rotate(${angle + 90}deg)`);
  assert.equal(f.edge.path.display.attributes.get("d"), f.edge.path.interaction.attributes.get("d"));
  assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-pattern"), "dotted");
  assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-width"), "thick");
  assert.equal(f.edge.lineEndGroupEl.attributes.get("data-feuillets-arrows"), "true");
  binding.cleanup();
  for (const el of elements.slice(0, 2)) { assert.equal(el.attributes.size, 0); assert.equal(el.classes.size, 0); }
});
