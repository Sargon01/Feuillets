import type { CanvasBBox } from "../../services/canvas-runtime.js";
import type { CanvasEdge } from "./types.js";

export type RoutePoint = { x: number; y: number };
/** Side points outward from its node, including at the destination. */
export type RouteAnchor = Readonly<RoutePoint & { side?: CanvasEdge["fromSide"] }>;
export type MapRoutingOptions = { clearance?: number; bendPenalty?: number; maxStates?: number };

const MAX_OBSTACLES = 128;
const MAX_GRID_POINTS = 65_536;
const MAX_STATES = 20_000;
const MAX_WAYPOINTS = 1_024;
const directions = [
  { x: 1, y: 0, side: "right" }, { x: 0, y: 1, side: "bottom" },
  { x: -1, y: 0, side: "left" }, { x: 0, y: -1, side: "top" },
] as const;
type Candidate = { key: number; x: number; y: number; direction: number; cost: number; estimate: number; sequence: number };
type Visit = { cost: number; parent?: number; closed?: boolean };

const precedes = (a: Candidate, b: Candidate): boolean => a.estimate < b.estimate ||
  (a.estimate === b.estimate && (a.cost > b.cost || (a.cost === b.cost && a.sequence < b.sequence)));
function enqueue(heap: Candidate[], value: Candidate): void {
  let index = heap.length;
  heap.push(value);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!precedes(value, heap[parent])) break;
    heap[index] = heap[parent]; index = parent;
  }
  heap[index] = value;
}
function dequeue(heap: Candidate[]): Candidate | undefined {
  const first = heap[0], last = heap.pop();
  if (last && heap.length) {
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && precedes(heap[child + 1], heap[child])) child++;
      if (!precedes(heap[child], last)) break;
      heap[index] = heap[child]; index = child;
    }
    heap[index] = last;
  }
  return first;
}

/** Open inflated interiors are blocked; their boundaries already provide clearance. */
function blocked(a: RoutePoint, b: RoutePoint, obstacles: readonly CanvasBBox[]): boolean {
  return obstacles.some((box) => a.y === b.y
    ? a.y > box.minY && a.y < box.maxY && Math.max(a.x, b.x) > box.minX && Math.min(a.x, b.x) < box.maxX
    : a.x > box.minX && a.x < box.maxX && Math.max(a.y, b.y) > box.minY && Math.min(a.y, b.y) < box.maxY);
}

function simplify(points: RoutePoint[]): RoutePoint[] | null {
  const result: RoutePoint[] = [];
  for (const point of points) {
    const a = result[result.length - 2], b = result[result.length - 1];
    if (a && b && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) result.pop();
    result.push(point);
  }
  if (result.length > MAX_WAYPOINTS) return null;
  // Reject self-intersections rather than emitting a route that doubles back over itself.
  for (let i = 1; i < result.length; i++) for (let j = i + 2; j < result.length; j++) {
    const a = result[i - 1], b = result[i], c = result[j - 1], d = result[j];
    if (Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return null;
  }
  return result;
}

/**
 * Pure orthogonal A* over obstacle-aligned coordinates, independent of Canvas zoom.
 * Pass only OTHER nodes as obstacles; an obstructed anchor is rejected, never exempted.
 * Defaults: 8-unit clearance, 16-unit bend penalty, 12,000 discovered heading states.
 * Hard caps bound obstacles, grid points, states and output regardless of canvas size.
 * Returns null for invalid geometry, exhausted budgets or no route in the bounded graph.
 */
export function findMapRoute(start: RouteAnchor, end: RouteAnchor, obstacles: readonly CanvasBBox[], options: MapRoutingOptions = {}): RoutePoint[] | null {
  const clearance = options.clearance ?? 8, bendPenalty = options.bendPenalty ?? 16, maxStates = options.maxStates ?? 12_000;
  if (![start.x, start.y, end.x, end.y, clearance, bendPenalty].every(Number.isFinite) || clearance <= 0 || bendPenalty < 0 ||
    !Number.isSafeInteger(maxStates) || maxStates < 1 || maxStates > MAX_STATES || obstacles.length > MAX_OBSTACLES) return null;
  const startDirection = start.side === undefined ? -1 : directions.findIndex((direction) => direction.side === start.side);
  const endDirection = end.side === undefined ? -1 : directions.findIndex((direction) => direction.side === end.side);
  if ((start.side !== undefined && startDirection < 0) || (end.side !== undefined && endDirection < 0)) return null;
  const boxes: CanvasBBox[] = [];
  const xs = new Set([start.x, end.x]), ys = new Set([start.y, end.y]);
  for (const box of obstacles) {
    if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite) || box.minX > box.maxX || box.minY > box.maxY) return null;
    const inflated = { minX: box.minX - clearance, minY: box.minY - clearance, maxX: box.maxX + clearance, maxY: box.maxY + clearance };
    if (![inflated.minX, inflated.minY, inflated.maxX, inflated.maxY].every(Number.isFinite) ||
      box.minX - inflated.minX < clearance || box.minY - inflated.minY < clearance || inflated.maxX - box.maxX < clearance || inflated.maxY - box.maxY < clearance) return null;
    boxes.push(inflated); xs.add(inflated.minX); xs.add(inflated.maxX); ys.add(inflated.minY); ys.add(inflated.maxY);
  }
  if ([start, end].some((point) => boxes.some((box) => point.x > box.minX && point.x < box.maxX && point.y > box.minY && point.y < box.maxY))) return null;
  if (start.x === end.x && start.y === end.y) return start.side || end.side ? null : [{ x: start.x, y: start.y }];
  // Departure lanes permit turns before reaching an aligned destination from the wrong side.
  for (const point of [start, end]) {
    xs.add(point.x - clearance); xs.add(point.x + clearance);
    ys.add(point.y - clearance); ys.add(point.y + clearance);
  }
  xs.add(start.x / 2 + end.x / 2); ys.add(start.y / 2 + end.y / 2);
  // Include outer escape lanes around the supplied geometry, never around a viewport.
  const minX = Math.min(...xs) - clearance, maxX = Math.max(...xs) + clearance;
  const minY = Math.min(...ys) - clearance, maxY = Math.max(...ys) + clearance;
  if (![minX, maxX, minY, maxY].every(Number.isFinite) || minX >= Math.min(...xs) || maxX <= Math.max(...xs) ||
    minY >= Math.min(...ys) || maxY <= Math.max(...ys)) return null;
  xs.add(minX); xs.add(maxX); ys.add(minY); ys.add(maxY);
  const xValues = [...xs].sort((a, b) => a - b), yValues = [...ys].sort((a, b) => a - b);
  if (xValues.length * yValues.length > MAX_GRID_POINTS) return null;
  const key = (x: number, y: number, direction: number): number => (y * xValues.length + x) * 5 + direction;
  const heuristic = (x: number, y: number): number => Math.abs(xValues[x] - end.x) + Math.abs(yValues[y] - end.y);
  const startX = xValues.indexOf(start.x), startY = yValues.indexOf(start.y), endX = xValues.indexOf(end.x), endY = yValues.indexOf(end.y);
  const firstKey = key(startX, startY, 4), estimate = heuristic(startX, startY);
  if (!Number.isFinite(estimate)) return null;
  const visits = new Map<number, Visit>([[firstKey, { cost: 0 }]]), heap: Candidate[] = [];
  let sequence = 0;
  enqueue(heap, { key: firstKey, x: startX, y: startY, direction: 4, cost: 0, estimate, sequence: sequence++ });
  while (heap.length) {
    const current = dequeue(heap);
    if (!current) break;
    const visit = visits.get(current.key);
    if (!visit || visit.closed || current.cost !== visit.cost) continue;
    visit.closed = true;
    if (current.x === endX && current.y === endY) {
      const points: RoutePoint[] = [];
      let cursor: number | undefined = current.key;
      while (cursor !== undefined) {
        const pointIndex = Math.floor(cursor / 5);
        points.push({ x: xValues[pointIndex % xValues.length], y: yValues[Math.floor(pointIndex / xValues.length)] });
        cursor = visits.get(cursor)?.parent;
      }
      return simplify(points.reverse());
    }
    for (const [direction, delta] of directions.entries()) {
      if ((current.direction === 4 && startDirection >= 0 && direction !== startDirection) ||
        (current.direction < 4 && direction === (current.direction + 2) % 4)) continue;
      const x = current.x + delta.x, y = current.y + delta.y;
      if (x < 0 || y < 0 || x >= xValues.length || y >= yValues.length || (x === startX && y === startY)) continue;
      if (x === endX && y === endY && endDirection >= 0 && direction !== (endDirection + 2) % 4) continue;
      const a = { x: xValues[current.x], y: yValues[current.y] }, b = { x: xValues[x], y: yValues[y] };
      if (blocked(a, b, boxes)) continue;
      const nextKey = key(x, y, direction), previous = visits.get(nextKey);
      const cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (current.direction < 4 && direction !== current.direction ? bendPenalty : 0);
      const estimate = cost + heuristic(x, y);
      if (!Number.isFinite(estimate) || previous?.closed || (previous && previous.cost <= cost)) continue;
      if (!previous && visits.size >= maxStates) return null;
      visits.set(nextKey, { cost, parent: current.key });
      enqueue(heap, { key: nextKey, x, y, direction, cost, estimate, sequence: sequence++ });
    }
  }
  return null;
}
