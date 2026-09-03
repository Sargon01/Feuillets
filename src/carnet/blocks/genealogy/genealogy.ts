import type { CanvasData, CanvasNode } from "../../canvas/types.js";
import { fitGroupBlockToMembers } from "../shared/native-group-block.js";
import { createGenealogyCanvasModel } from "./canvas-model.js";
import { GENEALOGY_VERTICAL_GAP } from "./layout.js";
import type { GenealogyFamilyGraph } from "./types.js";

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function genealogyNodes(canvas: CanvasData, blockId: string): CanvasNode[] {
  return canvas.nodes.filter((node) => node.feuillets_block === "genealogy" && node.feuillets_block_id === blockId);
}

function translateModel(model: CanvasData, deltaX: number, deltaY: number): CanvasData {
  return {
    nodes: model.nodes.map((node) => ({
      ...node,
      x: (Number(node.x) || 0) + deltaX,
      y: (Number(node.y) || 0) + deltaY,
    })),
    edges: model.edges.map((edge) => ({ ...edge })),
  };
}

function appendBelow(canvas: CanvasData, model: CanvasData): CanvasData {
  const existingBottom = canvas.nodes.reduce(
    (bottom, node) => Math.max(bottom, (Number(node.y) || 0) + (Number(node.height) || 0)),
    0,
  );
  const modelTop = model.nodes.reduce(
    (top, node) => Math.min(top, Number(node.y) || 0),
    Number.POSITIVE_INFINITY,
  );
  const deltaY = model.nodes.length > 0 ? existingBottom + 200 - modelTop : 0;
  const placed = translateModel(model, 0, deltaY);
  return {
    nodes: [...canvas.nodes.map((node) => ({ ...node })), ...placed.nodes],
    edges: [...canvas.edges.map((edge) => ({ ...edge })), ...placed.edges],
  };
}

export function createGenealogyBlock(canvas: CanvasData, graph: GenealogyFamilyGraph, blockId: string): CanvasData {
  return appendBelow(canvas, createGenealogyCanvasModel(graph, blockId));
}

export function reconcileGenealogyBlock(canvas: CanvasData, graph: GenealogyFamilyGraph, blockId: string): CanvasData {
  const oldGroup = genealogyNodes(canvas, blockId).find((node) => node.type === "group");
  if (!oldGroup) return canvas;

  const previousPersons = new Map(
    genealogyNodes(canvas, blockId)
      .filter((node) => node.type === "file" && typeof node.file === "string")
      .map((node) => [node.file as string, node]),
  );
  const model = createGenealogyCanvasModel(graph, blockId);
  const freshGroup = model.nodes.find((node) => node.type === "group");
  const deltaX = freshGroup ? (Number(oldGroup.x) || 0) - (Number(freshGroup.x) || 0) : 0;
  const deltaY = freshGroup ? (Number(oldGroup.y) || 0) - (Number(freshGroup.y) || 0) : 0;
  const translated = translateModel(model, deltaX, deltaY);
  const positioned = translated.nodes.map((node) => {
    if (node.type !== "file" || !node.file) return { ...node };
    const previous = previousPersons.get(node.file);
    return previous ? { ...node, x: previous.x, y: previous.y } : { ...node };
  });
  const nextBlock: CanvasData = { nodes: positioned, edges: model.edges.map((edge) => ({ ...edge })) };
  for (const union of nextBlock.nodes.filter((node) => node.feuillets_genealogy_kind === "union")) {
    const partners = nextBlock.edges
      .filter((edge) => edge.feuillets_relation === "partner-union" && edge.toNode === union.id)
      .map((edge) => nextBlock.nodes.find((node) => node.id === edge.fromNode))
      .filter((node): node is CanvasNode => node !== undefined);
    if (partners.length === 0) continue;
    const left = Math.min(...partners.map((node) => Number(node.x) || 0));
    const right = Math.max(...partners.map((node) => (Number(node.x) || 0) + (Number(node.width) || 0)));
    const bottom = Math.max(...partners.map((node) => (Number(node.y) || 0) + (Number(node.height) || 0)));
    union.x = (left + right - (Number(union.width) || 0)) / 2;
    union.y = bottom + GENEALOGY_VERTICAL_GAP / 2;
  }
  fitGroupBlockToMembers(nextBlock, blockId);
  return {
    nodes: [
      ...canvas.nodes.filter((node) => !(node.feuillets_block === "genealogy" && node.feuillets_block_id === blockId)).map((node) => ({ ...node })),
      ...nextBlock.nodes,
    ],
    edges: [
      ...canvas.edges.filter((edge) => !(edge.feuillets_managed === "genealogy" && edge.feuillets_block_id === blockId)).map((edge) => ({ ...edge })),
      ...nextBlock.edges,
    ],
  };
}

export function genealogyBlockIds(canvas: CanvasData): string[] {
  return [...new Set(canvas.nodes
    .filter((node) => node.type === "group" && node.feuillets_block === "genealogy" && typeof node.feuillets_block_id === "string")
    .map((node) => node.feuillets_block_id as string))].sort(compareIds);
}

export function selectGenealogyBlockId(canvas: CanvasData, selectedNodeId?: string): string | null {
  const blockIds = genealogyBlockIds(canvas);
  if (blockIds.length === 1) return blockIds[0] ?? null;
  if (!selectedNodeId) return null;
  const selected = canvas.nodes.find((node) => node.id === selectedNodeId);
  return selected?.feuillets_block === "genealogy" && typeof selected.feuillets_block_id === "string"
    ? selected.feuillets_block_id
    : null;
}
