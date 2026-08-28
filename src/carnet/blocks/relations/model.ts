import type { CanvasData, CanvasEdge } from "../../canvas/types.js";
import { freshEdgeId, groupBlockMemberNodes, isGroupBlockManagedEdge } from "../shared/native-group-block.js";

/** Modèle STRUCTUREL pur du bloc Relations (Prompt 4, §4).
 *
 * Relations = graphe LIBRE sémantique : aucune hiérarchie, aucun sens
 * imposé à `fromNode`/`toNode` (Canvas exige toujours les deux, mais la
 * relation elle-même est symétrique — « A est relié à B » vaut dans les
 * deux sens). Seules les edges portant À LA FOIS
 * `feuillets_managed: "relations"` ET le `feuillets_block_id` du bloc sont
 * des relations métier — toute autre edge (libre, d'un autre bloc) n'est
 * jamais lue ni modifiée ici. Fonctions pures, aucune E/S. */

export const RELATIONS_BLOCK_TYPE = "relations";
export const RELATIONS_EDGE_MARKER = "relations";

export function isRelationEdge(edge: CanvasEdge, blockId: string): boolean {
  return isGroupBlockManagedEdge(edge, RELATIONS_EDGE_MARKER, blockId);
}

export function relationEdges(canvas: CanvasData, blockId: string): CanvasEdge[] {
  return (canvas.edges || []).filter((edge) => isRelationEdge(edge, blockId));
}

/** Vrai si une relation existe déjà entre ces deux membres, DANS N'IMPORTE
 * QUEL SENS (le graphe est non dirigé sémantiquement) — empêche les
 * doublons (§4/§11). */
export function relationExists(canvas: CanvasData, blockId: string, aId: string, bId: string): boolean {
  return relationEdges(canvas, blockId).some(
    (edge) => (edge.fromNode === aId && edge.toNode === bId) || (edge.fromNode === bId && edge.toNode === aId)
  );
}

export type RelationRefusalReason = "same-node" | "not-members" | "duplicate";

export type CreateRelationResult =
  | { ok: true; edge: CanvasEdge }
  | { ok: false; reason: RelationRefusalReason };

/** Crée l'edge métier « Relier » entre EXACTEMENT deux membres du même
 * bloc (§4) — refuse une auto-relation, des ids hors bloc, ou un doublon.
 * `label` reste FACULTATIF et réutilise le champ natif `label` de l'edge
 * Canvas (édition native, aucun rendu Feuillets custom). */
export function addRelationEdge(canvas: CanvasData, blockId: string, aId: string, bId: string, label?: string): CreateRelationResult {
  if (aId === bId) return { ok: false, reason: "same-node" };
  const members = new Set(groupBlockMemberNodes(canvas, blockId).map((node) => node.id));
  if (!members.has(aId) || !members.has(bId)) return { ok: false, reason: "not-members" };
  if (relationExists(canvas, blockId, aId, bId)) return { ok: false, reason: "duplicate" };
  const edge: CanvasEdge = {
    id: freshEdgeId(canvas, "feuillets-relations"),
    fromNode: aId,
    toNode: bId,
    feuillets_managed: RELATIONS_EDGE_MARKER,
    feuillets_block_id: blockId,
    feuillets_relation_id: crypto.randomUUID(),
  };
  if (label) edge.label = label;
  canvas.edges = canvas.edges || [];
  canvas.edges.push(edge);
  return { ok: true, edge };
}

/** Suppression d'UNE relation (§4) : retire UNIQUEMENT cette edge métier,
 * jamais les nodes membres qu'elle reliait. `false` si `edgeId` n'est pas
 * une relation de CE bloc. */
export function removeRelationEdge(canvas: CanvasData, blockId: string, edgeId: string): boolean {
  const edges = canvas.edges || [];
  const index = edges.findIndex((edge) => edge.id === edgeId && isRelationEdge(edge, blockId));
  if (index === -1) return false;
  edges.splice(index, 1);
  return true;
}
