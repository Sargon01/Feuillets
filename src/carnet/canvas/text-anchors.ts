import type { CanvasBBox, MinimalRuntimeCanvas, MinimalRuntimeEdge, MinimalRuntimeEdgeEnd, MinimalRuntimeNode } from "../../services/canvas-runtime.js";

type Side = "top" | "right" | "bottom" | "left";
type Anchor = { side: Side; box: CanvasBBox };
type AnchorEdge = MinimalRuntimeEdge & { from: MinimalRuntimeEdgeEnd; to: MinimalRuntimeEdgeEnd; updatePath: () => void; getBBox: () => CanvasBBox; bezier?: { from: { x: number; y: number }; to: { x: number; y: number }; cp1: { x: number; y: number }; cp2: { x: number; y: number }; path: string } };
type AnchorCanvas = MinimalRuntimeCanvas & {
  nodes: Map<string, MinimalRuntimeNode>;
  edges: Map<string, MinimalRuntimeEdge>;
  getEdgesForNode: (node: MinimalRuntimeNode) => MinimalRuntimeEdge[];
  markMoved: (edge: MinimalRuntimeEdge) => void;
  addEdge: (edge: MinimalRuntimeEdge) => void;
  removeEdge: (edge: MinimalRuntimeEdge) => void;
};

const defaultEdgeFields = new Set(["id", "fromNode", "toNode", "fromSide", "toSide", "fromEnd", "toEnd", "label"]);
const center = (box: CanvasBBox): { x: number; y: number } => ({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
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
  let freeIds = new Set<string>();
  const eligible = (edge: MinimalRuntimeEdge): boolean => {
    if (!edge.from || !edge.to || !freeIds.has(edge.from.node.id) || !freeIds.has(edge.to.node.id)) return false;
    const data = edge.getData();
    return Object.keys(data).every((key) => defaultEdgeFields.has(key)) &&
      data.fromEnd !== "arrow" && data.toEnd !== "arrow" && edge.from.end !== "arrow" && edge.to.end !== "arrow";
  };

  const bindEdge = (edge: MinimalRuntimeEdge): void => {
    if (!eligible(edge)) return;
    if (edges.has(edge as AnchorEdge) || !edge.from || !edge.to || typeof (edge as Partial<AnchorEdge>).updatePath !== "function" || typeof (edge as Partial<AnchorEdge>).getBBox !== "function") return;
    const target = edge as AnchorEdge;
    const original = target.updatePath;
    const originalBounds = target.getBBox;
    const withAnchors = <T>(draw: () => T): T => {
      const from = target.from, to = target.to;
      if (!eligible(target)) return draw();
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
        target.lineGroupEl?.classList.remove("feuillets-note-connection");
        target.lineEndGroupEl?.classList.remove("feuillets-note-connection-ends");
        return;
      }
      const point = (end: MinimalRuntimeEdgeEnd): { x: number; y: number } | undefined => {
        const box = end.node.getBBox?.();
        if (!box) return undefined;
        const p = center(box);
        if (end.side === "left") p.x = box.minX;
        else if (end.side === "right") p.x = box.maxX;
        else if (end.side === "top") p.y = box.minY;
        else if (end.side === "bottom") p.y = box.maxY;
        return p;
      };
      const from = point(target.from), to = point(target.to);
      if (!from || !to) return;
      const path = `M${from.x} ${from.y} L${to.x} ${to.y}`;
      target.path?.display?.setAttribute("d", path);
      target.path?.interaction?.setAttribute("d", path);
      target.bezier = { from, to, cp1: from, cp2: to, path };
      target.lineGroupEl?.classList.add("feuillets-note-connection");
      target.lineEndGroupEl?.classList.add("feuillets-note-connection-ends");
    });
    target.getBBox = () => withAnchors(() => originalBounds.call(target) as CanvasBBox);
    const wrapped = target.updatePath, wrappedBounds = target.getBBox;
    edges.set(target, () => {
      if (target.updatePath === wrapped) target.updatePath = original;
      if (target.getBBox === wrappedBounds) target.getBBox = originalBounds;
      target.lineGroupEl?.classList.remove("feuillets-note-connection");
      target.lineEndGroupEl?.classList.remove("feuillets-note-connection-ends");
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
    for (const edge of runtime.getEdgesForNode(node)) runtime.markMoved(edge);
  };
  return {
    update,
    refresh: (free) => {
      freeIds = free;
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
        const stableClasses = (classes: string | null): string => (classes ?? "").split(/\s+/).filter((name) => !name.startsWith("feuillets-note-measuring")).join(" ");
        const mutation = new win.MutationObserver((records) => {
          if (!records?.length || records.some((record) => record.type !== "attributes" || record.target !== element ||
            stableClasses(record.oldValue) !== stableClasses(element.className))) invalidate();
        });
        const resize = new win.ResizeObserver(invalidate);
        mutation.observe(element, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
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
    },
  };
}
