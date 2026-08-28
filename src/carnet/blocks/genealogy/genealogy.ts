import type { CanvasData, CanvasNode } from "../../canvas/types.js";
import {
  createGroupBlockNode,
  groupBlockMemberNodes,
  hasFileMember,
  removeGroupBlockMember,
  freshEdgeId,
  freshNodeId,
} from "../shared/native-group-block.js";
import type { GenealogyLayoutDimensions } from "./layout.js";
import {
  addParentChildEdge,
  addSpouseEdge,
  parentChildEdges,
  spouseEdges,
  isGenealogyPersonNode,
  removeGenealogyEdge,
  type GenealogyRelationResult,
} from "./model.js";

/** Orchestration PURE (CanvasData uniquement) du bloc Généalogie. Les cartes
 * sont toujours placées manuellement ; seule la jonction technique est
 * recalculée à partir de leurs positions courantes. */

export const GENEALOGY_DEFAULT_SIZE = { width: 480, height: 360 } as const;
const DEFAULT_MEMBER_SIZE: GenealogyLayoutDimensions = { width: 240, height: 80 };

export type CreateGenealogyBlockOptions = { blockId: string; centerX: number; centerY: number };

/** Crée le GroupNode Canvas natif du bloc Généalogie — AUCUN membre, aucune
 * relation automatique (§2/§3/§5). */
export function createGenealogyBlock(canvas: CanvasData, options: CreateGenealogyBlockOptions): CanvasNode {
  const { blockId, centerX, centerY } = options;
  return createGroupBlockNode(canvas, {
    blockType: "genealogy",
    blockId,
    x: centerX - GENEALOGY_DEFAULT_SIZE.width / 2,
    y: centerY - GENEALOGY_DEFAULT_SIZE.height / 2,
    width: GENEALOGY_DEFAULT_SIZE.width,
    height: GENEALOGY_DEFAULT_SIZE.height,
  });
}

export function isFileAlreadyMember(canvas: CanvasData, blockId: string, filePath: string): boolean {
  return hasFileMember(canvas, blockId, filePath);
}

function unionKey(blockId: string, aId: string, bId: string): string {
  return `${blockId}:${[aId, bId].sort().join("|")}`;
}

function unionNodes(canvas: CanvasData, blockId: string): CanvasNode[] {
  return (canvas.nodes || []).filter((node) => node.feuillets_block === "genealogy-union" && node.feuillets_block_id === blockId);
}

function ensureUnion(canvas: CanvasData, blockId: string, aId: string, bId: string): CanvasNode {
  const key = unionKey(blockId, aId, bId);
  const existing = unionNodes(canvas, blockId).find((node) => node.feuillets_union_id === key);
  if (existing) return existing;
  const node: CanvasNode = {
    id: freshNodeId(canvas), type: "text", text: "", x: 0, y: 0, width: 8, height: 8, color: "transparent",
    feuillets_block: "genealogy-union", feuillets_block_version: 1, feuillets_block_id: blockId,
    feuillets_union_id: key, feuillets_union_members: [aId, bId].sort(), feuillets_union_technical: true,
  };
  canvas.nodes.push(node);
  return node;
}

function positionUnionBetween(union: CanvasNode, a: CanvasNode, b: CanvasNode): void {
  union.x = ((Number(a.x) || 0) + (Number(a.width) || DEFAULT_MEMBER_SIZE.width) / 2 + (Number(b.x) || 0) + (Number(b.width) || DEFAULT_MEMBER_SIZE.width) / 2) / 2 - 4;
  union.y = ((Number(a.y) || 0) + (Number(a.height) || DEFAULT_MEMBER_SIZE.height) / 2 + (Number(b.y) || 0) + (Number(b.height) || DEFAULT_MEMBER_SIZE.height) / 2) / 2 - 4;
}

/** Recalcule la représentation technique sans toucher aux relations métier. */
function synchronizeUnions(canvas: CanvasData, blockId: string): void {
  const members = new Set(groupBlockMemberNodes(canvas, blockId).map((node) => node.id));
  const spouses = spouseEdges(canvas, blockId).filter((edge) => edge.fromNode && edge.toNode && members.has(edge.fromNode) && members.has(edge.toNode));
  const validKeys = new Set(spouses.map((edge) => unionKey(blockId, edge.fromNode as string, edge.toNode as string)));
  canvas.nodes = (canvas.nodes || []).filter((node) => node.feuillets_block !== "genealogy-union" || node.feuillets_block_id !== blockId || (node.feuillets_union_id !== undefined && validKeys.has(node.feuillets_union_id)));
  canvas.edges = (canvas.edges || []).filter((edge) => !(edge.feuillets_union_display && edge.feuillets_block_id === blockId));
  for (const spouse of spouses) {
    const aId = spouse.fromNode as string;
    const bId = spouse.toNode as string;
    const union = ensureUnion(canvas, blockId, aId, bId);
    const a = (canvas.nodes || []).find((node) => node.id === aId);
    const b = (canvas.nodes || []).find((node) => node.id === bId);
    const leftToRight = (Number(a?.x) || 0) <= (Number(b?.x) || 0);
    const leftId = leftToRight ? aId : bId;
    const rightId = leftToRight ? bId : aId;
    canvas.edges.push({ id: freshEdgeId(canvas, "feuillets-genealogy-union"), fromNode: leftId, toNode: union.id, fromSide: "right", toSide: "left", lineType: "orthogonal", feuillets_managed: "genealogy", feuillets_block_id: blockId, feuillets_union_display: "spouse", feuillets_relation: "spouse", toEnd: "none" });
    canvas.edges.push({ id: freshEdgeId(canvas, "feuillets-genealogy-union"), fromNode: union.id, toNode: rightId, fromSide: "right", toSide: "left", lineType: "orthogonal", feuillets_managed: "genealogy", feuillets_block_id: blockId, feuillets_union_display: "spouse", feuillets_relation: "spouse", toEnd: "none" });
  }
  const parentEdges = parentChildEdges(canvas, blockId);
  for (const edge of parentEdges) {
    if (!edge.fromNode || !edge.toNode) continue;
    const parents = parentEdges.filter((candidate) => candidate.toNode === edge.toNode).map((candidate) => candidate.fromNode).filter((id): id is string => typeof id === "string");
    const union = spouses.find((spouse) => parents.includes(spouse.fromNode || "") && parents.includes(spouse.toNode || ""));
    if (union) {
      const junction = ensureUnion(canvas, blockId, union.fromNode as string, union.toNode as string);
      if (!canvas.edges.some((candidate) => candidate.feuillets_union_display === "parent-child" && candidate.fromNode === junction.id && candidate.toNode === edge.toNode)) {
        canvas.edges.push({ id: freshEdgeId(canvas, "feuillets-genealogy-union"), fromNode: junction.id, toNode: edge.toNode, feuillets_managed: "genealogy", feuillets_block_id: blockId, feuillets_union_display: "parent-child", feuillets_relation: "parent-child", toEnd: "arrow" });
      }
    } else if (!canvas.edges.some((candidate) => candidate.feuillets_union_display === "parent-child" && candidate.fromNode === edge.fromNode && candidate.toNode === edge.toNode)) {
      canvas.edges.push({ id: freshEdgeId(canvas, "feuillets-genealogy-union"), fromNode: edge.fromNode, toNode: edge.toNode, feuillets_managed: "genealogy", feuillets_block_id: blockId, feuillets_union_display: "parent-child", feuillets_relation: "parent-child", toEnd: "arrow" });
    }
  }
}

/** Synchronise les unions et leur position, sans déplacer aucun FileNode. */
export function applyGenealogyLayout(canvas: CanvasData, blockId: string): boolean {
  synchronizeUnions(canvas, blockId);
  const members = groupBlockMemberNodes(canvas, blockId);
  const group = (canvas.nodes || []).find((node) => node.type === "group" && node.feuillets_block_id === blockId);
  if (!group || members.length === 0) return false;
  for (const union of unionNodes(canvas, blockId)) {
    const ids = union.feuillets_union_members;
    const first = ids?.[0] ? members.find((node) => node.id === ids[0]) : undefined;
    const second = ids?.[1] ? members.find((node) => node.id === ids[1]) : undefined;
    if (first && second) positionUnionBetween(union, first, second);
  }
  return true;
}

/** « Parent → enfant » (§5/§6) : validation dans model.ts, relayout
 * automatique ICI si l'edge a bien été créée (§7 : « après ajout/
 * suppression d'une relation généalogique → relayout automatique »).
 * Aucune mutation partielle en cas de refus — `addParentChildEdge` ne
 * pousse l'edge qu'après validation complète. */
export function addGenealogyParentChild(canvas: CanvasData, blockId: string, parentId: string, childId: string): GenealogyRelationResult {
  const result = addParentChildEdge(canvas, blockId, parentId, childId);
  return result;
}

/** « Conjoints » (§5/§6) : même discipline — relayout automatique
 * uniquement si l'edge a réellement été créée. */
export function addGenealogySpouse(canvas: CanvasData, blockId: string, aId: string, bId: string): GenealogyRelationResult {
  const result = addSpouseEdge(canvas, blockId, aId, bId);
  if (result.ok) {
    /* La relation spouse reste portée par l'union ; l'edge métier directe
     * n'est pas rendue, afin d'éviter la double ligne du couple. */
    canvas.edges = (canvas.edges || []).filter((edge) => edge.id !== result.edge.id);
    const union = ensureUnion(canvas, blockId, aId, bId);
    union.feuillets_union_relation = "spouse";
    union.feuillets_union_relation_id = result.edge.id;
    synchronizeUnions(canvas, blockId);
    const a = (canvas.nodes || []).find((node) => node.id === aId);
    const b = (canvas.nodes || []).find((node) => node.id === bId);
    if (a && b) positionUnionBetween(union, a, b);
  }
  return result;
}

/** Suppression d'UNE relation (§7 : relayout automatique après
 * suppression aussi). */
export function deleteGenealogyRelation(canvas: CanvasData, blockId: string, edgeId: string): boolean {
  const removed = removeGenealogyEdge(canvas, blockId, edgeId) || (() => {
    const union = unionNodes(canvas, blockId).find((node) => node.feuillets_union_relation_id === edgeId);
    if (!union) return false;
    delete union.feuillets_union_relation;
    delete union.feuillets_union_relation_id;
    return true;
  })();
  if (removed) synchronizeUnions(canvas, blockId);
  return removed;
}

/** Suppression d'un membre — retire le node ET ses edges métier, jamais le
 * fichier Markdown ; relayout automatique du reste du bloc si celui-ci
 * n'est pas vide. */
export function removeGenealogyMember(canvas: CanvasData, blockId: string, nodeId: string): boolean {
  const removed = removeGroupBlockMember(canvas, blockId, nodeId);
  if (removed) synchronizeUnions(canvas, blockId);
  return removed;
}

export {
  GENEALOGY_BLOCK_TYPE,
  GENEALOGY_EDGE_MARKER,
  isGenealogyEdge,
  genealogyEdges,
  parentChildEdges,
  spouseEdges,
  areSpouses,
  isGenealogyDescendant,
  isGenealogyPersonNode,
  type GenealogyRelationResult as GenealogyCreationResult,
  type GenealogyRefusalReason,
} from "./model.js";
export { isGroupBlockNode, isGroupBlockMember, groupBlockMemberNodes } from "../shared/native-group-block.js";
