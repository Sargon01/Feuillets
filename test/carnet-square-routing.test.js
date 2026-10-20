import test from "node:test";
import assert from "node:assert/strict";
import { findSquareRoute } from "../src/carnet/canvas/square-routing.js";

const box = (x, y, width = 100, height = 100) => ({ minX: x, minY: y, maxX: x + width, maxY: y + height });
const anchor = (bounds, side) => ({ side,
  x: side === "left" ? bounds.minX : side === "right" ? bounds.maxX : (bounds.minX + bounds.maxX) / 2,
  y: side === "top" ? bounds.minY : side === "bottom" ? bounds.maxY : (bounds.minY + bounds.maxY) / 2,
});
const directions = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
function verify(route, start, end) {
  assert(route && route.length >= 2 && route.length <= 6);
  assert.deepEqual(route[0], { x: start.x, y: start.y }); assert.deepEqual(route.at(-1), { x: end.x, y: end.y });
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    assert([a.x, a.y, b.x, b.y].every(Number.isFinite));
    assert((a.x === b.x) !== (a.y === b.y), "Every segment must have length and exactly one axis");
    if (i > 1) { const previous = route[i - 2]; assert((previous.x === a.x) !== (a.x === b.x), "No redundant elbow or reversal"); }
  }
  const [dx, dy] = directions[start.side], [ex, ey] = directions[end.side];
  assert((route[1].x - start.x) * dx + (route[1].y - start.y) * dy > 0);
  assert((route.at(-2).x - end.x) * ex + (route.at(-2).y - end.y) * ey > 0);
}
function avoids(route, bounds) {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    assert(!(a.y === b.y ? a.y > bounds.minY && a.y < bounds.maxY && Math.max(a.x, b.x) > bounds.minX && Math.min(a.x, b.x) < bounds.maxX
      : a.x > bounds.minX && a.x < bounds.maxX && Math.max(a.y, b.y) > bounds.minY && Math.min(a.y, b.y) < bounds.maxY));
  }
}
for (const [name, target, fromSide, toSide, count] of [
  ["horizontal", box(300, 0), "right", "left", 2],
  ["vertical", box(0, 300), "bottom", "top", 2],
  ["L", box(300, 200), "right", "top", 3],
  ["Z", box(300, 200), "right", "left", 4],
  ["U", box(300, 200), "left", "top", 5],
  ["inverted facing sides", box(-300, 0), "right", "left", 6],
]) test(`Square produces a stable ${name} route`, () => {
  const source = box(0, 0), start = anchor(source, fromSide), end = anchor(target, toSide);
  const route = findSquareRoute(start, end, source, target);
  verify(route, start, end); assert.equal(route.length, count); avoids(route, source); avoids(route, target);
  assert.deepEqual(findSquareRoute(start, end, source, target), route);
});

for (const [x, y] of [[300, 0], [0, 300], [300, 200], [-300, -200], [89, 20], [40, 120], [-150, 0]]) test(`Square respects all face pairs at ${x}, ${y}`, () => {
  const source = box(-12.5, 7.25, 100.5, 90.25), target = box(x, y, 130.5, 80.25);
  for (const fromSide of Object.keys(directions)) for (const toSide of Object.keys(directions)) {
    const start = anchor(source, fromSide), end = anchor(target, toSide), route = findSquareRoute(start, end, source, target);
    verify(route, start, end); avoids(route, source); avoids(route, target);
  }
});

test("Square follows fractional movement and resizing without producing invalid coordinates", () => {
  for (let i = 0; i < 100; i++) {
    const source = box(-200 + i / 3, -100, 80 + i / 7, 100 + i / 11), target = box(300 - i / 2, i * 3.25, 110, 140);
    const start = anchor(source, "right"), end = anchor(target, "left");
    verify(findSquareRoute(start, end, source, target), start, end);
  }
});

for (const transpose of [false, true]) for (const sx of [1, -1]) for (const sy of [1, -1]) test(`Square uses the free gap between disjoint offset cards: transpose=${transpose}, x=${sx}, y=${sy}`, () => {
  const transform = ({ x, y }) => transpose ? { x: y * sy, y: x * sx } : { x: x * sx, y: y * sy };
  const bounds = (value) => {
    const a = transform({ x: value.minX, y: value.minY }), b = transform({ x: value.maxX, y: value.maxY });
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
  };
  const port = (value) => {
    const [x, y] = directions[value.side], vector = transform({ x, y });
    return { ...transform(value), side: Object.keys(directions).find(side => directions[side][0] === vector.x && directions[side][1] === vector.y) };
  };
  const source = bounds(box(100, 0, 300, 60)), target = bounds(box(0, 150, 300, 400));
  const start = port({ x: 100, y: 30, side: "left" }), end = port({ x: 300, y: 350, side: "right" });
  for (const reverse of [false, true]) {
    const from = reverse ? end : start, to = reverse ? start : end;
    const route = findSquareRoute(from, to, reverse ? target : source, reverse ? source : target);
    verify(route, from, to); avoids(route, source); avoids(route, target);
  }
});

test("Square rejects invalid coordinates, inverted bounds, overflow and coincident ports", () => {
  const source = box(0, 0), target = box(300, 200), start = anchor(source, "right"), end = anchor(target, "left");
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(findSquareRoute({ ...start, x: value }, end, source, target), null);
    assert.equal(findSquareRoute(start, end, { ...source, maxY: value }, target), null);
  }
  assert.equal(findSquareRoute(start, end, { ...source, minX: 500 }, target), null);
  assert.equal(findSquareRoute({ x: -Number.MAX_VALUE, y: 0, side: "left" }, { x: Number.MAX_VALUE, y: 100, side: "right" }, source, target), null);
  assert.equal(findSquareRoute(start, start, source, source), null);
});
