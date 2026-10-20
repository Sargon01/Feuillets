import type { CanvasBBox } from "../../services/canvas-runtime.js";
import type { RouteAnchor, RoutePoint } from "./map-routing.js";

const clearance = 16;
const directions = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const length = (a: RoutePoint, b: RoutePoint): number => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

function escape(point: RoutePoint, direction: RoutePoint, other: CanvasBBox): RoutePoint {
  const gap = direction.x ? (direction.x > 0 ? other.minX - point.x : point.x - other.maxX)
    : (direction.y > 0 ? other.minY - point.y : point.y - other.maxY);
  const offset = gap > 0 ? Math.min(clearance, gap / 2) : clearance;
  return { x: point.x + direction.x * offset, y: point.y + direction.y * offset };
}

function simplify(points: RoutePoint[]): RoutePoint[] | null {
  const result: RoutePoint[] = [];
  for (const point of points) {
    const b = result[result.length - 1], a = result[result.length - 2];
    if (b && b.x === point.x && b.y === point.y) continue;
    if (a && b && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) {
      if ((b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) <= 0) return null;
      result.pop();
    }
    result.push(point);
  }
  for (let i = 1; i < result.length; i++) for (let j = i + 2; j < result.length; j++) {
    const a = result[i - 1], b = result[i], c = result[j - 1], d = result[j];
    if (Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return null;
  }
  return result.length > 1 ? result : null;
}

function crosses(a: RoutePoint, b: RoutePoint, box: CanvasBBox): boolean {
  return a.y === b.y
    ? a.y > box.minY && a.y < box.maxY && Math.max(a.x, b.x) > box.minX && Math.min(a.x, b.x) < box.maxX
    : a.x > box.minX && a.x < box.maxX && Math.max(a.y, b.y) > box.minY && Math.min(a.y, b.y) < box.maxY;
}

/** Compare a fixed set of elbows and escape lanes around the two endpoint cards. */
export function findSquareRoute(start: RouteAnchor, end: RouteAnchor, fromBox: CanvasBBox, toBox: CanvasBBox): RoutePoint[] | null {
  const boxes = [fromBox, toBox];
  if (![start.x, start.y, end.x, end.y, ...boxes.flatMap((box) => [box.minX, box.minY, box.maxX, box.maxY])].every(Number.isFinite) ||
    boxes.some((box) => box.minX > box.maxX || box.minY > box.maxY)) return null;
  const inferred = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? (end.x >= start.x ? "right" : "left") : (end.y >= start.y ? "bottom" : "top");
  const from = directions[start.side ?? inferred];
  const to = directions[end.side ?? (inferred === "right" ? "left" : inferred === "left" ? "right" : inferred === "top" ? "bottom" : "top")];
  const a = { x: start.x, y: start.y }, b = { x: end.x, y: end.y };
  const exit = escape(a, from, toBox), entry = escape(b, to, fromBox);
  const xs = [a.x / 2 + b.x / 2, Math.min(fromBox.minX, toBox.minX) - clearance, Math.max(fromBox.maxX, toBox.maxX) + clearance, exit.x, entry.x];
  const ys = [a.y / 2 + b.y / 2, Math.min(fromBox.minY, toBox.minY) - clearance, Math.max(fromBox.maxY, toBox.maxY) + clearance, exit.y, entry.y];
  if (fromBox.maxX < toBox.minX) xs.push(fromBox.maxX / 2 + toBox.minX / 2);
  else if (toBox.maxX < fromBox.minX) xs.push(toBox.maxX / 2 + fromBox.minX / 2);
  if (fromBox.maxY < toBox.minY) ys.push(fromBox.maxY / 2 + toBox.minY / 2);
  else if (toBox.maxY < fromBox.minY) ys.push(toBox.maxY / 2 + fromBox.minY / 2);
  if (![exit.x, exit.y, entry.x, entry.y, ...xs, ...ys].every(Number.isFinite)) return null;
  let best: { points: RoutePoint[]; crossings: number; distance: number } | undefined;
  const consider = (points: RoutePoint[]): void => {
    const route = simplify(points);
    if (!route) return;
    const first = route[1], last = route[route.length - 2];
    if ((first.x - a.x) * from.x + (first.y - a.y) * from.y <= 0 ||
      (last.x - b.x) * to.x + (last.y - b.y) * to.y <= 0) return;
    let crossings = 0, distance = 0;
    for (let i = 1; i < route.length; i++) {
      const previous = route[i - 1], point = route[i];
      if (previous.x !== point.x && previous.y !== point.y) return;
      crossings += boxes.filter((box) => crosses(previous, point, box)).length;
      distance += length(previous, point);
    }
    if (!Number.isFinite(distance)) return;
    if (!best || crossings < best.crossings || (crossings === best.crossings &&
      (route.length < best.points.length || (route.length === best.points.length && distance < best.distance)))) best = { points: route, crossings, distance };
  };
  if (!!from.x === !!to.x) {
    if (from.x) {
      for (const x of xs) consider([a, { x, y: a.y }, { x, y: b.y }, b]);
      for (const y of ys) consider([a, exit, { x: exit.x, y }, { x: entry.x, y }, entry, b]);
    } else {
      for (const y of ys) consider([a, { x: a.x, y }, { x: b.x, y }, b]);
      for (const x of xs) consider([a, exit, { x, y: exit.y }, { x, y: entry.y }, entry, b]);
    }
  } else if (from.x) {
    consider([a, { x: b.x, y: a.y }, b]);
    for (const x of xs) for (const y of ys) consider([a, { x, y: a.y }, { x, y }, { x: b.x, y }, b]);
  } else {
    consider([a, { x: a.x, y: b.y }, b]);
    for (const x of xs) for (const y of ys) consider([a, { x: a.x, y }, { x, y }, { x, y: b.y }, b]);
  }
  return best?.points ?? null;
}
