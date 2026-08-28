import type { CanvasData, CanvasNode } from "../../canvas/types.js";
import {
  createGroupBlockNode,
  fitGroupBlockToMembers,
  groupBlockMemberNodes,
  hasFileMember,
  removeGroupBlockMember,
} from "../shared/native-group-block.js";
import { computeRelationsLayout, type RelationsLayoutDimensions } from "./layout.js";
import { addRelationEdge, removeRelationEdge, type CreateRelationResult } from "./model.js";

/** Orchestration PURE (CanvasData uniquement, jamais de DOM/runtime — voir
 * carnet/canvas/adapter.ts et main.ts pour le câblage vivant) reliant
 * model.ts (structure) et layout.ts (géométrie) en une API par opération :
 * créer le bloc, réorganiser, relier/délier, retirer un membre. */

export const RELATIONS_GROUP_PADDING = 80;
export const RELATIONS_DEFAULT_SIZE = { width: 480, height: 360 } as const;
const DEFAULT_MEMBER_SIZE: RelationsLayoutDimensions = { width: 240, height: 80 };

export type CreateRelationsBlockOptions = { blockId: string; centerX: number; centerY: number };

/** Crée le GroupNode Canvas natif du bloc Relations — AUCUN membre, jamais
 * de relation automatique (§2/§3). */
export function createRelationsBlock(canvas: CanvasData, options: CreateRelationsBlockOptions): CanvasNode {
  const { blockId, centerX, centerY } = options;
  return createGroupBlockNode(canvas, {
    blockType: "relations",
    blockId,
    x: centerX - RELATIONS_DEFAULT_SIZE.width / 2,
    y: centerY - RELATIONS_DEFAULT_SIZE.height / 2,
    width: RELATIONS_DEFAULT_SIZE.width,
    height: RELATIONS_DEFAULT_SIZE.height,
  });
}

/** §3 : vrai si `filePath` est déjà membre de ce bloc — l'appelant (drop
 * runtime, adapter.ts) doit vérifier ceci AVANT de matérialiser un nouveau
 * FileNode, jamais après. */
export function isFileAlreadyMember(canvas: CanvasData, blockId: string, filePath: string): boolean {
  return hasFileMember(canvas, blockId, filePath);
}

function dimensionsTable(canvas: CanvasData, blockId: string): Record<string, RelationsLayoutDimensions> {
  const table: Record<string, RelationsLayoutDimensions> = {};
  for (const node of groupBlockMemberNodes(canvas, blockId)) {
    table[node.id] = { width: Number(node.width) || DEFAULT_MEMBER_SIZE.width, height: Number(node.height) || DEFAULT_MEMBER_SIZE.height };
  }
  return table;
}

/** « Réorganiser » (§4) : layout PUR déterministe, jamais automatique —
 * seule cette commande explicite (ou l'appelant qui la déclenche) déplace
 * les membres. Les positions manuelles restent intactes tant qu'elle n'est
 * pas invoquée (§4 : « positions inchangées sans Réorganiser »). Ancrée sur
 * le CENTRE actuel du groupe, jamais recentrée ailleurs. */
export function applyRelationsLayout(canvas: CanvasData, blockId: string): boolean {
  const members = groupBlockMemberNodes(canvas, blockId);
  const group = (canvas.nodes || []).find((node) => node.type === "group" && node.feuillets_block_id === blockId);
  if (!group || members.length === 0) return false;
  const anchor = { x: Number(group.x) + Number(group.width) / 2, y: Number(group.y) + Number(group.height) / 2 };
  const result = computeRelationsLayout(members.map((node) => node.id), dimensionsTable(canvas, blockId), anchor);
  for (const node of members) {
    const position = result.positions[node.id];
    if (position) { node.x = position.x; node.y = position.y; }
  }
  fitGroupBlockToMembers(canvas, blockId, RELATIONS_GROUP_PADDING);
  return true;
}

/** « Relier » (§4) : exactement deux membres du même bloc, jamais plus,
 * jamais moins — voir model.ts pour les refus (auto-relation, hors bloc,
 * doublon). Aucun relayout automatique : les positions manuelles restent
 * celles de l'autrice tant qu'elle ne clique pas Réorganiser. */
export function createRelation(canvas: CanvasData, blockId: string, aId: string, bId: string, label?: string): CreateRelationResult {
  return addRelationEdge(canvas, blockId, aId, bId, label);
}

/** Suppression d'UNE relation (§4) : uniquement l'edge métier. */
export function deleteRelation(canvas: CanvasData, blockId: string, edgeId: string): boolean {
  return removeRelationEdge(canvas, blockId, edgeId);
}

/** Suppression d'un membre (§4) : retire le node ET ses edges métier —
 * jamais le fichier Markdown référencé (cette fonction ne touche jamais au
 * vault, voir native-group-block.ts). */
export function removeRelationsMember(canvas: CanvasData, blockId: string, nodeId: string): boolean {
  return removeGroupBlockMember(canvas, blockId, nodeId);
}

export {
  RELATIONS_BLOCK_TYPE,
  RELATIONS_EDGE_MARKER,
  isRelationEdge,
  relationEdges,
  relationExists,
  type CreateRelationResult as RelationCreationResult,
  type RelationRefusalReason,
} from "./model.js";
export { isGroupBlockNode, isGroupBlockMember, groupBlockMemberNodes } from "../shared/native-group-block.js";
