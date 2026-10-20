import test from "node:test";
import assert from "node:assert/strict";
import { reflowStack } from "../src/carnet/canvas/dynamic-stack.js";
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
      nodeEl: { ownerDocument: doc, className: "canvas-node feuillets-note-plain" },
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

for (const color of ["1", "2", "3", "4", "5", "6"]) test(`native color ${color} class replacement does not feed the text sizer`, () => {
  const changed = [], f = runtimeFixture(), element = f.a.nodeEl;
  const base = "canvas-node feuillets-note-plain", themed = `${base} is-themed mod-canvas-color-${color}`;
  element.className = themed;
  const binding = attachTextAnchors(f.canvas, (node) => changed.push(node)); binding.refresh(new Set(["a", "b"]));
  f.marked.length = 0;
  const mutation = f.observers[0], record = (oldValue) => ({ type: "attributes", attributeName: "class", target: element, oldValue });
  for (let frame = 0; frame < 120; frame++) mutation.callback([record(themed), record(`${base} is-themed`)]);
  assert.deepEqual(changed, []); assert.deepEqual(f.marked, []);
  element.className = `mod-canvas-color-${color} is-themed ${base} feuillets-note-measuring-auto feuillets-note-measuring`;
  mutation.callback([record(themed)]); assert.deepEqual(changed, []);
  element.className = base;
  mutation.callback([record(themed)]); assert.deepEqual(changed, [f.a]);
  mutation.callback([record(base)]); assert.deepEqual(changed, [f.a]);
  element.className = `${base} is-themed mod-canvas-color-${color}`;
  mutation.callback([record(base)]); assert.deepEqual(changed, [f.a, f.a]);
  binding.cleanup(); assert(f.observers.every((observer) => observer.disconnected));
});

test("actual appearance, text, descendant layout and size changes still invalidate a colored free card", () => {
  const changed = [], f = runtimeFixture(), element = f.a.nodeEl;
  element.className = "canvas-node feuillets-note-plain is-themed mod-canvas-color-4";
  const binding = attachTextAnchors(f.canvas, (node) => changed.push(node)); binding.refresh(new Set(["a", "b"]));
  element.className = "canvas-node feuillets-note-rounded is-themed mod-canvas-color-4";
  f.observers[0].callback([{ type: "attributes", target: element }]);
  f.observers[0].callback([{ type: "attributes", target: {} }]);
  f.observers[0].callback([{ type: "characterData", target: {} }]);
  f.observers[0].callback([{ type: "childList", target: element }]);
  f.observers[1].callback();
  assert.deepEqual(changed, [f.a, f.a, f.a, f.a, f.a]);
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

test("structural edges and nodes remain native independently of the text sizing set", () => {
  const f = runtimeFixture(), drawing = f.edge.updatePath, raw = f.b.getData.bind(f.b);
  f.b.getData = () => ({ ...raw(), feuillets_block_id: "block" });
  const binding = attachTextAnchors(f.canvas);
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

for (const type of ["file", "group"]) test(`native ${type} curves retain paths, spatial bounds and arrow transforms while sharing appearance`, () => {
  const f = runtimeFixture(), getData = f.a.getData.bind(f.a); f.a.getData = () => ({ ...getData(), type });
  const element = () => { const attributes = new Map(), classes = new Set(); return { attributes, classes, style: {}, setAttribute(k, v) { attributes.set(k, v); }, removeAttribute(k) { attributes.delete(k); }, classList: { add: (k) => classes.add(k), remove: (k) => classes.delete(k) } }; };
  f.edge.lineGroupEl = element(); f.edge.lineEndGroupEl = element(); f.edge.path = { display: element(), interaction: element() }; f.edge.toLineEnd = { el: element() };
  const nativePath = "M400 100 C500 100 500 150 600 150", bezier = { path: nativePath, cp1: { x: 500, y: 100 }, cp2: { x: 500, y: 150 } };
  f.edge.updatePath = function () { this.path.display.setAttribute("d", nativePath); this.path.interaction.setAttribute("d", nativePath); this.bezier = bezier; this.toLineEnd.el.style.transform = "native transform"; };
  const bounds = f.edge.getBBox(); const raw = f.edge.getData.bind(f.edge);
  f.edge.getData = () => ({ ...raw(), feuillets_edge_style: { geometry: "curved" } });
  const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["b"])); f.edge.updatePath();
  assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-pattern"), "dotted");
  f.edge.getData = () => ({ ...raw(), feuillets_edge_style: { geometry: "curved", pattern: "dotted", width: "thick" } }); f.edge.updatePath();
  assert.equal(f.edge.path.display.attributes.get("d"), nativePath); assert.equal(f.edge.path.interaction.attributes.get("d"), nativePath);
  assert.equal(f.edge.bezier, bezier); assert.deepEqual(f.edge.getBBox(), bounds); assert.equal(f.edge.toLineEnd.el.style.transform, "native transform");
  assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-pattern"), "dotted"); assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-width"), "thick");
  binding.cleanup(); assert.equal(f.edge.lineGroupEl.classes.size, 0);
});

for (const [type, file] of [["text", undefined], ["file", "Note.md"], ["file", "Image.png"]]) test(`switching geometry restores the original curve renderer and follows movement and resizing for ${file ?? type}`, () => {
  const f = runtimeFixture(), nodeData = f.a.getData.bind(f.a), edgeData = f.edge.getData.bind(f.edge);
  f.a.getData = () => ({ ...nodeData(), type, ...(file ? { file } : {}) });
  let geometry;
  f.edge.getData = () => ({ ...edgeData(), label: "Keep label", color: "3", feuillets_edge_style: { pattern: "dotted", width: "thick", ...(geometry ? { geometry } : {}) } });
  const element = () => { const attributes = new Map(), classes = new Set(); return { attributes, classes, style: {}, setAttribute(k, v) { attributes.set(k, v); }, removeAttribute(k) { attributes.delete(k); }, classList: { add: (k) => classes.add(k), remove: (k) => classes.delete(k) } }; };
  f.edge.lineGroupEl = element(); f.edge.lineEndGroupEl = element(); f.edge.path = { display: element(), interaction: element() }; f.edge.toLineEnd = { el: element() }; f.edge.to.end = "arrow";
  const curve = () => `M${f.a.x + f.a.width} ${f.a.y} C500 20 550 150 ${f.b.x} ${f.b.y}`;
  f.edge.updatePath = function () {
    this.drawn = { from: this.from.node.getBBox(), to: this.to.node.getBBox() };
    this.path.display.setAttribute("d", curve()); this.path.interaction.setAttribute("d", curve());
    this.bezier = { path: curve(), cp1: { x: 500, y: 20 }, cp2: { x: 550, y: 150 } }; this.toLineEnd.el.style.transform = "native arrow transform";
  };
  const original = f.edge.updatePath, binding = attachTextAnchors(f.canvas); binding.refresh(new Set(type === "text" ? ["a", "b"] : ["b"]));
  f.edge.updatePath(); assert.equal(f.edge.path.display.attributes.get("d").includes("C"), false);
  const before = f.edge.getData();
  for (const mode of ["straight", "curved", "straight", "curved"]) {
    geometry = mode; f.edge.updatePath();
    if (mode === "curved") {
      assert.equal(f.edge.path.display.attributes.get("d"), curve()); assert.deepEqual(f.edge.drawn.from, f.a.getBBox());
      assert.deepEqual(f.edge.bezier.cp1, { x: 500, y: 20 }); assert.equal(f.edge.toLineEnd.el.style.transform, "native arrow transform");
    } else {
      assert(!f.edge.path.display.attributes.get("d").includes("C")); assert.equal(f.edge.bezier.cp1, f.edge.bezier.from);
      const path = f.edge.path.display.attributes.get("d"); f.a.x += 20; f.a.height += 40; f.b.y += 60; f.edge.updatePath(); assert.notEqual(f.edge.path.display.attributes.get("d"), path);
    }
    assert.equal(f.edge.path.display.attributes.get("d"), f.edge.path.interaction.attributes.get("d"));
    assert.deepEqual(f.edge.getData(), { ...before, feuillets_edge_style: { ...before.feuillets_edge_style, geometry: mode } });
    assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-pattern"), "dotted"); assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-width"), "thick");
  }
  binding.cleanup(); assert.equal(f.edge.updatePath, original);
});

function mapFixture(type = "text", geometry = "map") {
  const f = runtimeFixture();
  const element = () => ({ attributes: new Map(), style: {}, classList: { add() {}, remove() {} },
    setAttribute(key, value) { this.attributes.set(key, value); }, removeAttribute(key) { this.attributes.delete(key); } });
  const data = f.edge.getData.bind(f.edge), nodeData = f.b.getData.bind(f.b);
  f.b.getData = () => ({ ...nodeData(), type, ...(type === "file" ? { file: "Note.md" } : {}) });
  f.edge.getData = () => ({ ...data(), label: "Keep label", color: "4", feuillets_edge_style: { geometry, pattern: "dotted", width: "thick" } });
  f.edge.from.end = "arrow"; f.edge.to.end = "arrow";
  f.edge.path = { display: element(), interaction: element() }; f.edge.lineGroupEl = element(); f.edge.lineEndGroupEl = element();
  f.edge.fromLineEnd = { el: element() }; f.edge.toLineEnd = { el: element() };
  f.edge.updatePath = function () {
    const from = { x: f.a.x + f.a.width, y: f.a.y + f.a.height / 2 }, to = { x: f.b.x, y: f.b.y + f.b.height / 2 };
    this.bezier = { from, to, cp1: from, cp2: to, path: `M${from.x} ${from.y} C500 20 550 150 ${to.x} ${to.y}` };
    this.path.display.setAttribute("d", this.bezier.path); this.path.interaction.setAttribute("d", this.bezier.path);
    this.fromLineEnd.el.style.transform = "native start"; this.toLineEnd.el.style.transform = "native end";
  };
  f.edge.getCenter = function () { return { x: (this.bezier.from.x + this.bezier.to.x) / 2, y: (this.bezier.from.y + this.bezier.to.y) / 2 }; };
  f.canvas.removeNode = (node) => f.canvas.nodes.delete(node.id);
  f.obstacle = (id, box, type = "text") => {
    const node = { id, box, getBBox() { return this.box; }, getData() { return { id, type, x: this.box.minX, y: this.box.minY, width: this.box.maxX - this.box.minX, height: this.box.maxY - this.box.minY }; } };
    f.canvas.nodes.set(id, node); return node;
  };
  f.setGeometry = (value) => { geometry = value; };
  f.path = () => f.edge.path.display.attributes.get("d");
  f.points = () => [...f.path().matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
  return f;
}
function avoids(points, box) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    assert(a.x === b.x || a.y === b.y);
    assert(!(a.y === b.y ? a.y > box.minY && a.y < box.maxY && Math.max(a.x, b.x) > box.minX && Math.min(a.x, b.x) < box.maxX
      : a.x > box.minX && a.x < box.maxX && Math.max(a.y, b.y) > box.minY && Math.min(a.y, b.y) < box.maxY));
  }
}
for (const type of ["text", "file", "group"]) test(`Map routes ${type} endpoints around ordinary obstacles with interactive bounds, labels and styles`, () => {
  const f = mapFixture(type), obstacle = f.obstacle("c", rect(450, 50, 550, 150), "group");
  const before = f.edge.getData(), binding = attachTextAnchors(f.canvas);
  binding.refresh(new Set(["a", "b"]));
  // Native indexing asks for bounds before rendering the edge.
  const bounds = f.edge.getBBox(); f.edge.updatePath(); const points = f.points();
  assert(points.length > 2); avoids(points, obstacle.box);
  assert.deepEqual(points[0], { x: 400, y: 100 }); assert.deepEqual(points.at(-1), { x: 600, y: 100 });
  assert.equal(f.edge.path.interaction.attributes.get("d"), f.path());
  assert(bounds.minY <= 42 || bounds.maxY >= 158);
  const label = f.edge.getCenter(); assert(label.y <= 42 || label.y >= 158);
  assert.equal(f.edge.fromLineEnd.el.style.transform, "translate(400px, 100px) rotate(-90deg)");
  assert.equal(f.edge.toLineEnd.el.style.transform, "translate(600px, 100px) rotate(90deg)");
  assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-pattern"), "dotted"); assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-width"), "thick");
  assert.deepEqual(f.edge.getData(), before); binding.cleanup();
});
for (const mode of ["curved", "straight"]) test(`${mode} to Map and back restores native paths, bounds, centers and arrows`, () => {
  const f = mapFixture("text", mode); f.obstacle("c", rect(450, 50, 550, 150));
  const originalCenter = f.edge.getCenter, originalBounds = f.edge.getBBox, moved = f.canvas.markMoved, remove = f.canvas.removeNode;
  const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"])); f.edge.updatePath();
  const path = f.path(), bounds = f.edge.getBBox(), label = f.edge.getCenter(), arrow = f.edge.toLineEnd.el.style.transform;
  f.setGeometry("map"); f.edge.updatePath(); assert.notEqual(f.path(), path); assert(f.points().length > 2);
  f.setGeometry(mode); f.edge.updatePath(); assert.equal(f.path(), path); assert.deepEqual(f.edge.getBBox(), bounds); assert.deepEqual(f.edge.getCenter(), label); assert.equal(f.edge.toLineEnd.el.style.transform, arrow);
  binding.cleanup(); assert.equal(f.edge.getCenter, originalCenter); assert.equal(f.edge.getBBox, originalBounds); assert.equal(f.canvas.markMoved, moved); assert.equal(f.canvas.removeNode, remove);
});
test("Map invalidates on unrelated obstacle movement, resize, addition and removal, and caches stable geometry", () => {
  const f = mapFixture(), c = f.obstacle("c", rect(450, 50, 550, 150));
  const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"])); f.edge.updatePath();
  const routed = f.path(), from = f.edge.bezier.from;
  f.marked.length = 0; f.canvas.markMoved(c); f.edge.updatePath(); assert.deepEqual(f.marked, [c]); assert.equal(f.edge.bezier.from, from);
  c.box = rect(450, 300, 550, 400); f.canvas.markMoved(c); assert(f.marked.includes(f.edge)); f.edge.updatePath(); assert.equal(f.points().length, 2); assert.notEqual(f.edge.bezier.from, from);
  c.box = rect(450, 50, 550, 150); f.canvas.markMoved(c); f.edge.updatePath(); assert.equal(f.path(), routed);
  c.box = rect(450, 50, 550, 300); f.canvas.markMoved(c); f.edge.updatePath(); assert.notEqual(f.path(), routed); avoids(f.points(), c.box);
  f.canvas.removeNode(c); f.edge.updatePath(); assert.equal(f.points().length, 2);
  const d = f.obstacle("d", rect(450, 70, 550, 130), "file"); binding.refresh(new Set(["a", "b"])); f.edge.updatePath(); assert(f.points().length > 2); avoids(f.points(), d.box);
  binding.cleanup(); f.marked.length = 0; f.canvas.markMoved(d); assert.deepEqual(f.marked, [d]);
});
test("Map follows endpoint resize and simultaneous stack movement around multiple obstacles", () => {
  const f = mapFixture(); f.b.x = 1000;
  const c = f.obstacle("c", rect(450, 50, 550, 150)), d = f.obstacle("d", rect(750, -50, 850, 120));
  const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"])); f.edge.updatePath();
  avoids(f.points(), c.box); avoids(f.points(), d.box); const before = f.path();
  f.a.height += 100; f.canvas.markMoved(f.a); f.b.y += 100; f.canvas.markMoved(f.b); c.box = rect(450, 150, 550, 250); f.canvas.markMoved(c); f.edge.updatePath();
  assert.notEqual(f.path(), before); assert.deepEqual(f.points()[0], { x: 400, y: 150 }); assert.deepEqual(f.points().at(-1), { x: 1000, y: 200 }); avoids(f.points(), c.box); avoids(f.points(), d.box); binding.cleanup();
});
test("Map failure replaces old routed geometry with a straight fallback and retains Map metadata", () => {
  const f = mapFixture(), c = f.obstacle("c", rect(450, 50, 550, 150));
  const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"])); f.edge.updatePath(); assert(f.points().length > 2);
  c.box = rect(390, 90, 550, 150); f.canvas.markMoved(c); f.edge.updatePath();
  assert.equal(f.path(), "M400 100 L600 100"); assert.equal(f.edge.path.interaction.attributes.get("d"), f.path()); assert.equal(f.edge.getData().feuillets_edge_style.geometry, "map");
  assert.deepEqual(f.edge.getBBox(), rect(400, 100, 600, 100)); assert.deepEqual(f.edge.getCenter(), { x: 500, y: 100 }); binding.cleanup();
});
test("saved Map metadata resumes routing on a fresh binding without history or saves", () => {
  const f = mapFixture(), c = f.obstacle("c", rect(450, 50, 550, 150));
  let binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"])); f.edge.updatePath();
  const path = f.path(), persisted = JSON.parse(JSON.stringify(f.edge.getData())); binding.cleanup();
  f.edge.getData = () => structuredClone(persisted); binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"])); f.edge.updatePath(); assert.equal(f.path(), path);
  c.box = rect(450, 300, 550, 400); f.canvas.markMoved(c); f.edge.updatePath(); assert.equal(f.points().length, 2); binding.cleanup();
});
test("Map never wraps structural Mindmap or Relations edges", () => {
  for (const managed of ["mindmap", "relations", "genealogy"]) {
    const f = mapFixture(), getData = f.edge.getData.bind(f.edge), original = f.edge.updatePath;
    f.edge.getData = () => ({ ...getData(), feuillets_managed: managed });
    const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"])); assert.equal(f.edge.updatePath, original); binding.cleanup();
  }
});

test("dynamic stack reflow invalidates Map routes through native follower movement", () => {
  const f = mapFixture(), d = f.obstacle("d", rect(450, 0, 550, 50)), e = f.obstacle("e", rect(450, 50, 550, 200));
  for (const [order, node] of [d, e].entries()) {
    const getData = node.getData.bind(node); node.getData = () => ({ ...getData(), feuillets_stack: { id: "stack", order } });
    node.moveTo = ({ x, y }) => { const box = node.box; node.box = rect(x, y, x + box.maxX - box.minX, y + box.maxY - box.minY); f.canvas.markMoved(node); };
  }
  f.canvas.getData = () => ({ nodes: [...f.canvas.nodes.values()].map((node) => node.getData()), edges: [f.edge.getData()] });
  const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b", "d", "e"])); f.edge.updatePath(); const before = f.path();
  d.box = rect(450, 0, 550, 300); f.canvas.markMoved(d); assert.equal(reflowStack(f.canvas, "stack"), 1); assert.equal(e.box.minY, 300);
  f.edge.updatePath(); assert.notEqual(f.path(), before); avoids(f.points(), d.box); avoids(f.points(), e.box); binding.cleanup();
});

for (const from of [undefined, "manuscript", "research"]) for (const to of [undefined, "manuscript", "research"]) test(`ordinary file endpoints share default runtime paths without text observers: ${from}-${to}`, () => {
  const f = mapFixture();
  for (const [node, managed] of [[f.a, from], [f.b, to]]) {
    const getData = node.getData.bind(node);
    node.getData = () => ({ ...getData(), type: "file", file: `${node.id}.md`, ...(managed ? { feuillets_managed: managed } : {}) });
  }
  f.edge.getData = () => ({ id: "ab", fromNode: "a", toNode: "b", fromEnd: "none", toEnd: "none" });
  f.edge.from.end = "none"; f.edge.to.end = "none";
  const before = structuredClone(f.edge.getData()), native = f.edge.updatePath;
  const binding = attachTextAnchors(f.canvas, () => { throw Error("FileNodes must never use text sizing"); });
  binding.refresh(new Set()); f.edge.updatePath();
  assert.equal(f.observers.length, 0); assert.notEqual(f.edge.updatePath, native);
  assert.equal(f.edge.path.display.attributes.get("d"), "M400 100 L600 100");
  assert.equal(f.edge.path.interaction.attributes.get("d"), f.path());
  assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-pattern"), "dotted");
  assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-width"), "thin");
  assert.equal(f.edge.lineEndGroupEl.attributes.get("data-feuillets-arrows"), "false");
  f.a.width += 40; f.a.height += 80; f.canvas.markMoved(f.a); f.edge.updatePath();
  assert.notEqual(f.path(), "M400 100 L600 100"); assert.equal(f.path(), f.edge.path.interaction.attributes.get("d"));
  assert.deepEqual(f.edge.getData(), before); binding.cleanup(); assert.equal(f.edge.updatePath, native);
});

for (const type of ["text", "file"]) test(`Square synchronizes runtime paths, bounds, labels and arrows for ${type} cards`, () => {
  const f = mapFixture(type, "square"); f.b.y = 300;
  const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"]));
  const before = f.edge.getData(), original = f.path();
  const bounds = f.edge.getBBox(); f.edge.updatePath();
  const points = f.points(); assert(points.length >= 4); avoids(points, f.a.getBBox()); avoids(points, f.b.getBBox());
  assert.equal(f.path(), f.edge.path.interaction.attributes.get("d")); assert(!/[CQ]|NaN|Infinity/.test(f.path()));
  assert.deepEqual(bounds, { minX: Math.min(...points.map(p=>p.x)), minY: Math.min(...points.map(p=>p.y)), maxX: Math.max(...points.map(p=>p.x)), maxY: Math.max(...points.map(p=>p.y)) });
  const label = f.edge.getCenter(); assert(points.slice(1).some((p,i)=>p.x===points[i].x ? label.x===p.x&&label.y>=Math.min(p.y,points[i].y)&&label.y<=Math.max(p.y,points[i].y) : label.y===p.y&&label.x>=Math.min(p.x,points[i].x)&&label.x<=Math.max(p.x,points[i].x)));
  assert.equal(f.edge.fromLineEnd.el.style.transform, "translate(400px, 100px) rotate(-90deg)");
  assert.equal(f.edge.toLineEnd.el.style.transform, "translate(600px, 400px) rotate(90deg)");
  const path = f.path(); f.a.width += 50; f.a.height += 80; f.b.x += 150; f.canvas.markMoved(f.a); f.canvas.markMoved(f.b); f.edge.updatePath();
  assert.notEqual(f.path(), path); assert.equal(f.path(), f.edge.path.interaction.attributes.get("d")); assert.deepEqual(f.edge.getData(), before);
  const square = f.path(); const obstacle = f.obstacle("unrelated", rect(460, 150, 550, 250));
  binding.refresh(new Set(["a", "b"])); f.canvas.markMoved(obstacle); f.edge.updatePath(); assert.equal(f.path(), square);
  assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-pattern"), "dotted"); assert.equal(f.edge.lineGroupEl.attributes.get("data-feuillets-width"), "thick");
  assert.equal(f.edge.lineEndGroupEl.attributes.get("data-feuillets-arrows"), "true");
  assert.notEqual(f.path(), original);
  f.setGeometry("curved"); f.edge.updatePath(); assert(f.path().includes("C"));
  f.setGeometry("square"); f.edge.updatePath(); assert.equal(f.path(), square); binding.cleanup();
});

for (const metadata of [{ styleAttributes: { pathfindingMethod: "square" } }, { styleAttributes: { pathfindingMethod: "direct", foreign: true } }, { feuillets_managed: "mindmap" }, { feuillets_block_id: "relations" }, { anotherPlugin: true }]) test(`Square leaves owned connections under their original renderer: ${JSON.stringify(metadata)}`, () => {
  const f = mapFixture("text", "square"), raw = f.edge.getData.bind(f.edge), original = f.edge.updatePath;
  f.edge.getData = () => ({ ...raw(), ...metadata }); const before = f.edge.getData();
  const binding = attachTextAnchors(f.canvas); binding.refresh(new Set(["a", "b"])); assert.equal(f.edge.updatePath, original);
  assert.deepEqual(f.edge.getData(), before); binding.cleanup();
});
