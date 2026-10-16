import type { CanvasBBox, MinimalRuntimeCanvas, MinimalRuntimeEdge, MinimalRuntimeEdgeEnd, MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import { getEdgeAppearance, isEligibleEdge } from "./edge-style.js";
import { findMapRoute, type RoutePoint } from "./map-routing.js";
import type { CanvasData, CanvasEdge, CarnetEdgeGeometry } from "./types.js";

type Side = "top" | "right" | "bottom" | "left";
type Anchor = { side: Side; box: CanvasBBox };
type AnchorEdge = MinimalRuntimeEdge & { from: MinimalRuntimeEdgeEnd; to: MinimalRuntimeEdgeEnd; updatePath: () => void; getBBox: () => CanvasBBox; getCenter?: () => RoutePoint; bezier?: { from: { x: number; y: number }; to: { x: number; y: number }; cp1: { x: number; y: number }; cp2: { x: number; y: number }; path: string } };
type AnchorCanvas = MinimalRuntimeCanvas & {
  nodes: Map<string, MinimalRuntimeNode>;
  edges: Map<string, MinimalRuntimeEdge>;
  getEdgesForNode: (node: MinimalRuntimeNode) => MinimalRuntimeEdge[];
  markMoved: (element: MinimalRuntimeNode | MinimalRuntimeEdge) => void;
  addEdge: (edge: MinimalRuntimeEdge) => void;
  removeEdge: (edge: MinimalRuntimeEdge) => void;
};

const defaultEdgeFields = new Set(["id", "fromNode", "toNode", "fromSide", "toSide", "fromEnd", "toEnd", "label", "color", "feuillets_edge_style"]);
export const isOrdinaryEdge = (edge: CanvasEdge): boolean => Object.keys(edge).every((key) => defaultEdgeFields.has(key));
const appearanceAttributes = ["data-feuillets-pattern", "data-feuillets-width", "data-feuillets-arrows"];
function clearAppearance(edge: MinimalRuntimeEdge): void {
  edge.lineGroupEl?.classList.remove("feuillets-note-connection");
  edge.lineEndGroupEl?.classList.remove("feuillets-note-connection-ends");
  for (const element of [edge.lineGroupEl, edge.lineEndGroupEl]) for (const attribute of appearanceAttributes) element?.removeAttribute(attribute);
}
const attachmentSide = (side: unknown): Side | undefined => side === "top" || side === "right" || side === "bottom" || side === "left" ? side : undefined;
const center = (box: CanvasBBox): { x: number; y: number } => ({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
function attachment(end: MinimalRuntimeEdgeEnd): RoutePoint | undefined {
  const box = end.node.getBBox?.();
  if (!box) return undefined;
  const point = center(box);
  if (end.side === "left") point.x = box.minX;
  else if (end.side === "right") point.x = box.maxX;
  else if (end.side === "top") point.y = box.minY;
  else if (end.side === "bottom") point.y = box.maxY;
  return point;
}
function routeCenter(points: RoutePoint[]): RoutePoint {
  const length = (a: RoutePoint, b: RoutePoint): number => Math.hypot(b.x - a.x, b.y - a.y);
  let remaining = points.slice(1).reduce((sum, point, i) => sum + length(points[i], point), 0) / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], distance = length(a, b);
    if (distance > 0 && remaining <= distance) return { x: a.x + (b.x - a.x) * remaining / distance, y: a.y + (b.y - a.y) * remaining / distance };
    remaining -= distance;
  }
  return points[0];
}
/** Intersect the center-to-center line with the native card boundary. */
export function rectangleAnchor(bounds: CanvasBBox, target: { x: number; y: number }): Anchor | null {
  const origin = center(bounds), dx = target.x - origin.x, dy = target.y - origin.y;
  const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
  if (!(width > 0 && height > 0) || (dx === 0 && dy === 0)) return null;
  const horizontal = width / Math.abs(dx), vertical = height / Math.abs(dy);
  const distance = Math.min(horizontal, vertical) / 2;
  const x = origin.x + dx * distance, y = origin.y + dy * distance;
  return { side: horizontal <= vertical ? (dx > 0 ? "right" : "left") : (dy > 0 ? "bottom" : "top"),
    box: { minX: x, maxX: x, minY: y, maxY: y } };
}

export function attachTextAnchors(value: MinimalRuntimeCanvas, onContentChange?: (node: MinimalRuntimeNode) => void): { refresh(free: Set<string>): void; update(node: MinimalRuntimeNode): void; cleanup(): void } | null {
  const canvas = value as Partial<AnchorCanvas>;
  if (!(canvas.nodes instanceof Map) || !(canvas.edges instanceof Map) || typeof canvas.markMoved !== "function" ||
    typeof canvas.addEdge !== "function" || typeof canvas.removeEdge !== "function" || typeof canvas.getEdgesForNode !== "function") return null;
  const runtime = canvas as AnchorCanvas;
  const notes = new Map<MinimalRuntimeNode, { cleanup(): void }>();
  const edges = new Map<AnchorEdge, () => void>();
  const boxes = new Map<MinimalRuntimeNode, CanvasBBox>();
  const originalMoved = runtime.markMoved;
  let geometryVersion = 0;
  let freeIds = new Set<string>();
  const anchored = (edge: MinimalRuntimeEdge): boolean => {
    if (!edge.from || !edge.to || !freeIds.has(edge.from.node.id) || !freeIds.has(edge.to.node.id)) return false;
    return isOrdinaryEdge(edge.getData());
  };

  const appearanceData = (from: MinimalRuntimeNode, to: MinimalRuntimeNode): CanvasData => ({
    nodes: [from.getData(), to.getData()],
    edges: [...runtime.getEdgesForNode(from), ...runtime.getEdgesForNode(to)].map((edge) => edge.getData()),
  });
  const eligible = (edge: MinimalRuntimeEdge): boolean => !!edge.from && !!edge.to &&
    (anchored(edge) || [edge.from.node, edge.to.node].some((node) => node.getData().type !== "text")) &&
    isEligibleEdge(appearanceData(edge.from.node, edge.to.node), edge.getData());

  const geometry = (edge: AnchorEdge): CarnetEdgeGeometry => getEdgeAppearance(edge.getData(), appearanceData(edge.from.node, edge.to.node)).geometry;
  const straight = (edge: AnchorEdge): boolean => geometry(edge) === "straight";
  const invalidateRoutes = (): void => {
    geometryVersion++;
    for (const edge of edges.keys()) if (geometry(edge) === "map" && eligible(edge)) originalMoved.call(runtime, edge);
  };
  const remember = (node: MinimalRuntimeNode): boolean => {
    const box = node.getBBox?.(), previous = boxes.get(node);
    if (!box || (previous && box.minX === previous.minX && box.minY === previous.minY && box.maxX === previous.maxX && box.maxY === previous.maxY)) return false;
    boxes.set(node, { ...box }); return true;
  };
  const syncBoxes = (): void => {
    let changed = false;
    for (const node of boxes.keys()) if (runtime.nodes.get(node.id) !== node) { boxes.delete(node); changed = true; }
    for (const node of runtime.nodes.values()) if (remember(node)) changed = true;
    if (changed) invalidateRoutes();
  };
  const moved: AnchorCanvas["markMoved"] = (element) => {
    originalMoved.call(runtime, element);
    // Native movement updates spatial indexes before rendering; ignore unchanged bounds.
    const node = element as MinimalRuntimeNode;
    if (runtime.nodes.get(node.id) === node && remember(node)) invalidateRoutes();
  };
  runtime.markMoved = moved;
  const originalRemoveNode = runtime.removeNode;
  const removeNode = (node: MinimalRuntimeNode): void => {
    try { originalRemoveNode?.call(runtime, node); } finally { syncBoxes(); }
  };
  if (originalRemoveNode) runtime.removeNode = removeNode;
  syncBoxes();

  const bindEdge = (edge: MinimalRuntimeEdge): void => {
    if (!eligible(edge)) return;
    if (edges.has(edge as AnchorEdge) || !edge.from || !edge.to || typeof (edge as Partial<AnchorEdge>).updatePath !== "function" || typeof (edge as Partial<AnchorEdge>).getBBox !== "function") return;
    const target = edge as AnchorEdge;
    const original = target.updatePath;
    const originalBounds = target.getBBox;
    const originalCenter = target.getCenter;
    let cachedKey = "", cachedRoute: RoutePoint[] | undefined;
    const mapRoute = (): RoutePoint[] | undefined => {
      const from = attachment(target.from), to = attachment(target.to);
      if (!from || !to) return undefined;
      const key = JSON.stringify([geometryVersion, target.from.node.id, target.to.node.id, from, to, target.from.side, target.to.side]);
      if (key !== cachedKey) {
        const obstacles = [...boxes].filter(([node]) => node !== target.from.node && node !== target.to.node).map(([, box]) => box);
        cachedRoute = findMapRoute({ ...from, side: attachmentSide(target.from.side) }, { ...to, side: attachmentSide(target.to.side) }, obstacles) ?? [from, to];
        cachedKey = key;
      }
      return cachedRoute;
    };
    const withAnchors = <T>(draw: () => T): T => {
      const from = target.from, to = target.to;
      if (!straight(target) || !eligible(target)) return draw();
      const fromBox = from.node.getBBox?.(), toBox = to.node.getBBox?.();
      const adapt = (end: MinimalRuntimeEdgeEnd, box: CanvasBBox | undefined, other: CanvasBBox | undefined): MinimalRuntimeEdgeEnd => {
        const anchor = box && other && rectangleAnchor(box, center(other));
        if (!anchor) return end;
        const node = new Proxy(end.node, { get: (source, key, receiver): unknown => key === "getBBox" ? () => anchor.box : Reflect.get(source, key, receiver) });
        return { ...end, node, side: anchor.side };
      };
      // Native updatePath synchronously draws both SVG paths, arrows and the label's Bezier geometry.
      try {
        target.from = adapt(from, fromBox, toBox);
        target.to = adapt(to, toBox, fromBox);
        return draw();
      } finally { target.from = from; target.to = to; }
    };
    target.updatePath = () => withAnchors(() => {
      original.call(target);
      if (!eligible(target)) {
        clearAppearance(target);
        return;
      }
      const mode = geometry(target);
      if (mode === "straight" || mode === "map") {
        const points = mode === "map" ? mapRoute() : undefined;
        const from = points?.[0] ?? attachment(target.from), to = points?.[points.length - 1] ?? attachment(target.to);
        if (!from || !to) return;
        const route = points ?? [from, to];
        const path = route.map((point, i) => `${i === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
        target.path?.display?.setAttribute("d", path);
        target.path?.interaction?.setAttribute("d", path);
        target.bezier = { from, to, cp1: from, cp2: to, path };
        // Native triangles point upward; use the first and last segment tangents.
        const first = route[1] ?? to, last = route[route.length - 2] ?? from;
        const startAngle = Math.atan2(first.y - from.y, first.x - from.x) * 180 / Math.PI;
        const endAngle = Math.atan2(to.y - last.y, to.x - last.x) * 180 / Math.PI;
        if (target.fromLineEnd?.el) target.fromLineEnd.el.style.transform = `translate(${from.x}px, ${from.y}px) rotate(${startAngle - 90}deg)`;
        if (target.toLineEnd?.el) target.toLineEnd.el.style.transform = `translate(${to.x}px, ${to.y}px) rotate(${endAngle + 90}deg)`;
      }
      // Appearance decorates native curves without replacing their path, bounds or arrow transforms.
      if (!anchored(target) && !target.getData().feuillets_edge_style) { clearAppearance(target); return; }
      target.lineGroupEl?.classList.add("feuillets-note-connection");
      target.lineEndGroupEl?.classList.add("feuillets-note-connection-ends");
      const data: CanvasEdge = target.getData();
      const style = getEdgeAppearance(data, appearanceData(target.from.node, target.to.node));
      for (const element of [target.lineGroupEl, target.lineEndGroupEl]) {
        element?.setAttribute("data-feuillets-pattern", style.pattern);
        element?.setAttribute("data-feuillets-width", style.width);
        element?.setAttribute("data-feuillets-arrows", String(target.from.end === "arrow" || target.to.end === "arrow"));
      }
    });
    target.getBBox = () => {
      const points = eligible(target) && geometry(target) === "map" ? mapRoute() : undefined;
      return points ? { minX: Math.min(...points.map((point) => point.x)), minY: Math.min(...points.map((point) => point.y)),
        maxX: Math.max(...points.map((point) => point.x)), maxY: Math.max(...points.map((point) => point.y)) } : withAnchors(() => originalBounds.call(target) as CanvasBBox);
    };
    if (originalCenter) target.getCenter = () => {
      const points = eligible(target) && geometry(target) === "map" ? mapRoute() : undefined;
      return points ? routeCenter(points) : originalCenter.call(target) as RoutePoint;
    };
    const wrapped = target.updatePath, wrappedBounds = target.getBBox, wrappedCenter = target.getCenter;
    edges.set(target, () => {
      if (target.updatePath === wrapped) target.updatePath = original;
      if (target.getBBox === wrappedBounds) target.getBBox = originalBounds;
      if (target.getCenter === wrappedCenter && originalCenter) target.getCenter = originalCenter;
      clearAppearance(target);
    });
    runtime.markMoved(target);
  };
  const originalAdd = runtime.addEdge, originalRemove = runtime.removeEdge;
  const add: AnchorCanvas["addEdge"] = (edge) => { originalAdd.call(runtime, edge); bindEdge(edge); };
  const remove: AnchorCanvas["removeEdge"] = (edge) => {
    try { originalRemove.call(runtime, edge); }
    finally { edges.get(edge as AnchorEdge)?.(); edges.delete(edge as AnchorEdge); }
  };
  runtime.addEdge = add; runtime.removeEdge = remove;
  const update = (node: MinimalRuntimeNode): void => {
    if (remember(node)) invalidateRoutes();
    for (const edge of runtime.getEdgesForNode(node)) runtime.markMoved(edge);
  };
  return {
    update,
    refresh: (free) => {
      freeIds = free;
      syncBoxes();
      for (const [node, binding] of notes) if (!freeIds.has(node.id) || runtime.nodes.get(node.id) !== node) { binding.cleanup(); notes.delete(node); }
      for (const node of runtime.nodes.values()) {
        if (!freeIds.has(node.id) || notes.has(node) || !node.nodeEl) continue;
        const element = node.nodeEl;
        const win = element.ownerDocument.defaultView;
        if (!win) continue;
        const invalidate = (): void => {
          onContentChange?.(node);
          update(node);
        };
        const stableClasses = (): string => element.className.split(/\s+/).filter((name) => name && !name.startsWith("feuillets-note-measuring")).sort().join(" ");
        let observedClasses = stableClasses();
        const mutation = new win.MutationObserver((records) => {
          const currentClasses = stableClasses(), classesChanged = currentClasses !== observedClasses;
          observedClasses = currentClasses;
          // Native rendering removes and re-adds the same color class in one batch.
          // Measure final class changes, rather than those intermediate states.
          if (!records?.length || classesChanged || records.some((record) => record.type !== "attributes" || record.target !== element)) invalidate();
        });
        const resize = new win.ResizeObserver(invalidate);
        mutation.observe(element, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
        resize.observe(element);
        notes.set(node, { cleanup: () => { mutation.disconnect(); resize.disconnect(); } });
      }
      const currentEdges = new Set(runtime.edges.values());
      for (const [edge, restore] of edges) if (!eligible(edge) || !currentEdges.has(edge)) {
        restore(); edges.delete(edge); runtime.markMoved(edge);
      }
      for (const edge of runtime.edges.values()) if (eligible(edge)) { bindEdge(edge); runtime.markMoved(edge); }
    },
    cleanup: () => {
      notes.forEach((binding) => binding.cleanup()); notes.clear();
      edges.forEach((restore, edge) => { restore(); runtime.markMoved(edge); }); edges.clear();
      if (runtime.addEdge === add) runtime.addEdge = originalAdd;
      if (runtime.removeEdge === remove) runtime.removeEdge = originalRemove;
      if (runtime.markMoved === moved) runtime.markMoved = originalMoved;
      if (runtime.removeNode === removeNode) runtime.removeNode = originalRemoveNode;
      boxes.clear();
    },
  };
}
