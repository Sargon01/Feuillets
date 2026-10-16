import test from "node:test";
import assert from "node:assert/strict";
import { findMapRoute } from "../src/carnet/canvas/map-routing.js";

const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const sideVector = { right: [1, 0], bottom: [0, 1], left: [-1, 0], top: [0, -1] };
function verify(route, start, end, obstacles = [], clearance = 8) {
  assert(route, "Expected a route"); assert.deepEqual(route[0], { x: start.x, y: start.y }); assert.deepEqual(route.at(-1), { x: end.x, y: end.y });
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    assert(Number.isFinite(b.x) && Number.isFinite(b.y)); assert(distance(a, b) > 0); assert(a.x === b.x || a.y === b.y);
    for (const rect of obstacles) {
      const dx = Math.max(rect.minX - Math.max(a.x, b.x), Math.min(a.x, b.x) - rect.maxX, 0);
      const dy = Math.max(rect.minY - Math.max(a.y, b.y), Math.min(a.y, b.y) - rect.maxY, 0);
      assert(Math.hypot(dx, dy) >= clearance, "Every segment must retain obstacle clearance");
    }
    if (i >= 2) { const previous = route[i - 2]; assert(!(previous.x === a.x && a.x === b.x) && !(previous.y === a.y && a.y === b.y), "Collinear waypoints must be simplified"); }
    for (let j = 1; j < i - 1; j++) {
      const c = route[j - 1], d = route[j];
      const overlapX = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
      const overlapY = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
      assert(!(overlapX && overlapY), "Nonadjacent segments must not intersect or overlap");
    }
  }
  if (route.length > 1) {
    if (start.side) assert.deepEqual([Math.sign(route[1].x - start.x), Math.sign(route[1].y - start.y)], sideVector[start.side]);
    if (end.side) assert.deepEqual([Math.sign(route.at(-2).x - end.x), Math.sign(route.at(-2).y - end.y)], sideVector[end.side]);
  }
  return route;
}

test("unobstructed aligned anchors return the exact direct route", () => {
  const start = { x: -25.5, y: 12.25 }, end = { x: 210.75, y: 12.25 };
  assert.deepEqual(verify(findMapRoute(start, end, []), start, end), [start, end]);
});
test("unobstructed diagonal anchors use one bend and Manhattan length", () => {
  const start = { x: 0, y: 0 }, end = { x: 100, y: 60 }, route = verify(findMapRoute(start, end, []), start, end);
  assert.equal(route.length, 3); assert.equal(route.slice(1).reduce((sum, point, i) => sum + distance(route[i], point), 0), 160);
});
test("one intervening rectangle produces a short obstacle-clearing route", () => {
  const start = { x: 0, y: 0 }, end = { x: 200, y: 0 }, obstacles = [box(60, -25, 130, 25)];
  const route = verify(findMapRoute(start, end, obstacles), start, end, obstacles);
  assert.equal(route.length, 4); assert.equal(route.slice(1).reduce((sum, point, i) => sum + distance(route[i], point), 0), 266);
});
test("multiple differently sized and overlapping obstacles never permit segment tunneling", () => {
  const start = { x: 0, y: 0 }, end = { x: 500, y: 20 }, obstacles = [box(40, -20, 45, 60), box(100, -80, 200, 10), box(230, -30, 360, 150), box(340, -60, 400, 40)];
  verify(findMapRoute(start, end, obstacles), start, end, obstacles);
});
test("a narrow passage retains exact clearance at both sides", () => {
  const start = { x: 0, y: 28 }, end = { x: 200, y: 28 }, obstacles = [box(50, -100, 150, 20), box(50, 36, 150, 100)];
  assert.deepEqual(verify(findMapRoute(start, end, obstacles), start, end, obstacles), [start, end]);
});
test("a passage narrower than the requested clearance forces an exterior detour", () => {
  const start = { x: 0, y: 27.5 }, end = { x: 200, y: 27.5 }, obstacles = [box(50, -100, 150, 20), box(50, 35, 150, 100)];
  const route = verify(findMapRoute(start, end, obstacles), start, end, obstacles); assert(route.length > 2);
});
for (const startSide of Object.keys(sideVector)) for (const endSide of Object.keys(sideVector)) test(`attachment directions ${startSide} and ${endSide} are respected`, () => {
  const start = { x: 0, y: 0, side: startSide }, end = { x: 120, y: 70, side: endSide }, obstacles = [box(40, 10, 70, 50)];
  verify(findMapRoute(start, end, obstacles), start, end, obstacles);
});
test("aligned anchors can exit away from the destination and approach from its far side", () => {
  for (const endX of [100, 5]) {
    const start = { x: 0, y: 0, side: "right" }, end = { x: endX, y: 0, side: "right" };
    verify(findMapRoute(start, end, []), start, end);
    const away = { ...start, side: "left" }; verify(findMapRoute(away, end, []), away, end);
  }
});
for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) test(`routing works in quadrant ${dx}, ${dy} and with reversed anchors`, () => {
  const start = { x: -50, y: 30 }, end = { x: start.x + dx * 200, y: start.y + dy * 100 };
  const obstacles = [box(Math.min(start.x, end.x) + 50, Math.min(start.y, end.y) + 20, Math.max(start.x, end.x) - 50, Math.max(start.y, end.y) - 20)];
  verify(findMapRoute(start, end, obstacles), start, end, obstacles); verify(findMapRoute(end, start, obstacles), end, start, obstacles);
});
test("repeated calculations and obstacle permutations return identical waypoints", () => {
  const start = { x: 0, y: 0 }, end = { x: 250, y: 0 }, obstacles = [box(50, -20, 80, 20), box(150, -30, 180, 30)];
  const first = verify(findMapRoute(start, end, obstacles), start, end, obstacles);
  for (let i = 0; i < 10; i++) assert.deepEqual(findMapRoute(start, end, i % 2 ? [...obstacles].reverse() : obstacles), first);
});
test("large distances and translated geometry do not require a cell per Canvas unit", () => {
  const start = { x: -1e12, y: 1e12 }, end = { x: 1e12, y: 1e12 }, obstacles = [box(-10, 1e12 - 20, 10, 1e12 + 20)];
  verify(findMapRoute(start, end, obstacles, { maxStates: 500 }), start, end, obstacles);
  const offset = { x: 1000.25, y: -2500.5 }, a = { x: 0, y: 0 }, b = { x: 200, y: 0 }, small = [box(50, -20, 100, 20)], route = findMapRoute(a, b, small);
  const moved = small.map((r) => ({ minX: r.minX + offset.x, maxX: r.maxX + offset.x, minY: r.minY + offset.y, maxY: r.maxY + offset.y }));
  assert.deepEqual(findMapRoute(offset, { x: b.x + offset.x, y: b.y + offset.y }, moved), route.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y })));
});
test("enclosing obstacles return null cleanly without a timing-based budget", () => {
  const obstacles = [box(-40, -40, -30, 40), box(30, -40, 40, 40), box(-40, -40, 40, -30), box(-40, 30, 40, 40)];
  assert.equal(findMapRoute({ x: 0, y: 0 }, { x: 200, y: 0 }, obstacles), null);
});
test("a depleted state budget returns null deterministically", () => {
  assert.equal(findMapRoute({ x: 0, y: 0 }, { x: 100, y: 60 }, [], { maxStates: 1 }), null);
  assert.equal(findMapRoute({ x: 0, y: 0 }, { x: 100, y: 60 }, [], { maxStates: 1 }), null);
});
test("obstructed anchors are rejected rather than exempting their obstacle", () => {
  const obstacles = [box(0, 0, 20, 20)];
  assert.equal(findMapRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, obstacles), null);
  assert.equal(findMapRoute({ x: -30, y: 0 }, { x: 5, y: 5 }, obstacles), null);
});
test("frozen inputs remain unchanged and output points are independent objects", () => {
  const start = Object.freeze({ x: 0, y: 0, side: "right" }), end = Object.freeze({ x: 200, y: 0, side: "left" });
  const obstacles = Object.freeze([Object.freeze(box(50, -20, 100, 20))]), options = Object.freeze({ clearance: 2.5, bendPenalty: 4, maxStates: 500 });
  const before = JSON.stringify({ start, end, obstacles, options }), route = verify(findMapRoute(start, end, obstacles, options), start, end, obstacles, 2.5);
  route[0].x = 10; assert.equal(JSON.stringify({ start, end, obstacles, options }), before);
});
test("coincident anchors without directions have one point and directed coincidences fail", () => {
  assert.deepEqual(findMapRoute({ x: 1, y: 2 }, { x: 1, y: 2 }, []), [{ x: 1, y: 2 }]);
  assert.equal(findMapRoute({ x: 1, y: 2, side: "top" }, { x: 1, y: 2 }, []), null);
});
for (const options of [{ clearance: 0 }, { clearance: -1 }, { clearance: Infinity }, { bendPenalty: -1 }, { maxStates: 0 }, { maxStates: 1.5 }, { maxStates: 20_001 }]) test(`invalid options return null: ${JSON.stringify(options)}`, () => {
  assert.equal(findMapRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [], options), null);
});
test("malformed coordinates, rectangles and unsupported sides fail cleanly", () => {
  assert.equal(findMapRoute({ x: NaN, y: 0 }, { x: 1, y: 0 }, []), null);
  assert.equal(findMapRoute({ x: 0, y: 0, side: "diagonal" }, { x: 1, y: 0 }, []), null);
  for (const obstacle of [box(10, 0, -10, 10), box(0, 0, Infinity, 10)]) assert.equal(findMapRoute({ x: -30, y: 0 }, { x: 30, y: 0 }, [obstacle]), null);
});
test("hard input and numeric precision limits fail without allocating an unbounded search", () => {
  assert.equal(findMapRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, Array.from({ length: 129 }, () => box(20, 20, 30, 30))), null);
  assert.equal(findMapRoute({ x: Number.MAX_VALUE, y: 0 }, { x: -Number.MAX_VALUE, y: 0 }, []), null);
  assert.equal(findMapRoute({ x: 1e20, y: 0 }, { x: 1e20 + 1e6, y: 0 }, []), null);
});

test("a configurable bend penalty keeps routes clear and favors simple detours", () => {
  const start = { x: 0, y: 0 }, end = { x: 300, y: 0 }, obstacles = [box(40, -10, 70, 40), box(100, -40, 130, 10), box(160, -10, 190, 40)];
  const route = verify(findMapRoute(start, end, obstacles, { bendPenalty: 100 }), start, end, obstacles);
  assert(route.length <= 6); verify(findMapRoute(start, end, obstacles, { bendPenalty: 0 }), start, end, obstacles);
});
test("grid-size limits fail cleanly for too many distinct obstacle coordinates", () => {
  const obstacles = Array.from({ length: 128 }, (_, i) => box(1000 + i * 20, 1000 + i * 30, 1010 + i * 20, 1010 + i * 30));
  assert.equal(findMapRoute({ x: 0, y: 0 }, { x: 100, y: 60 }, obstacles), null);
});
test("thin and degenerate rectangles still retain clearance", () => {
  const start = { x: 0, y: 0 }, end = { x: 200, y: 0 }, obstacles = [box(50, -20, 50, 20), box(100, -0.01, 100.01, 0.01)];
  verify(findMapRoute(start, end, obstacles), start, end, obstacles);
});
