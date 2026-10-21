import type { CanvasData, CanvasNode } from "./types.js";

const appearanceFields = new Set(["feuillets_note_style", "feuillets_note_width", "feuillets_text_style", "feuillets_stack", "feuillets_compact_file"]);

export function hasOrdinaryCardOwnership(data: CanvasData, node: CanvasNode): boolean {
  return !!node.id && !Object.keys(node).some((key) =>
    key.startsWith("mindmap") || (key.startsWith("feuillets_") && !appearanceFields.has(key) &&
      !(key === "feuillets_managed" && node.type === "file" &&
        (node.feuillets_managed === "manuscript" || node.feuillets_managed === "research")))) &&
    !data.edges.some((edge) => (edge.fromNode === node.id || edge.toNode === node.id) &&
      Object.keys(edge).some((key) => key.startsWith("feuillets_") && key !== "feuillets_edge_style"));
}

export function isOrdinaryCard(data: CanvasData, node: CanvasNode): boolean {
  return (node.type === "text" || node.type === "file" || node.type === "link") && hasOrdinaryCardOwnership(data, node);
}
