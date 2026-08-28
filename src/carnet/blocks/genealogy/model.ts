import type { CanvasData, CanvasEdge, CanvasNode } from "../../canvas/types.js";
import { freshEdgeId, groupBlockMemberNodes, isGroupBlockManagedEdge } from "../shared/native-group-block.js";

/** Modèle STRUCTUREL pur du bloc Généalogie (Prompt 4, §5/§6).
 *
 * Deux natures de relation, portées par `feuillets_relation` sur une edge
 * `feuillets_managed: "genealogy"` du bloc :
 *   - `parent-child` : DIRIGÉE, `fromNode` = parent, `toNode` = enfant.
 *   - `spouse` : NON dirigée sémantiquement — ne participe jamais au
 *     contrôle de cycle (§6).
 *
 * Toujours de vrais FileNodes génériques : ce module ne suppose AUCUNE
 * propriété YAML « personnage », ne déduit rien du nom ni du contenu. Les
 * seules données sont les marqueurs Canvas eux-mêmes. Fonctions pures,
 * aucune E/S. */

export const GENEALOGY_BLOCK_TYPE = "genealogy";
export const GENEALOGY_EDGE_MARKER = "genealogy";

/** Vrai uniquement pour une représentation Personnage créée par le drop
 * Généalogie. Les unions techniques, FileNodes ordinaires et TextNodes libres
 * ne sont jamais admissibles dans l'action « Conjoints ». */
export function isGenealogyPersonNode(node: CanvasNode): boolean {
  return node.feuillets_genealogy_person === true
    && typeof node.feuillets_genealogy_source === "string"
    && node.feuillets_genealogy_source.length > 0
    && typeof node.feuillets_block_id === "string"
    && node.feuillets_block !== "genealogy-union";
}

export function isGenealogyEdge(edge: CanvasEdge, blockId: string): boolean {
  return isGroupBlockManagedEdge(edge, GENEALOGY_EDGE_MARKER, blockId);
}

export function genealogyEdges(canvas: CanvasData, blockId: string): CanvasEdge[] {
  return (canvas.edges || []).filter((edge) => isGenealogyEdge(edge, blockId));
}

export function parentChildEdges(canvas: CanvasData, blockId: string): CanvasEdge[] {
  return genealogyEdges(canvas, blockId).filter((edge) => edge.feuillets_relation === "parent-child" && !edge.feuillets_union_display);
}

export function spouseEdges(canvas: CanvasData, blockId: string): CanvasEdge[] {
  const direct = genealogyEdges(canvas, blockId).filter((edge) => edge.feuillets_relation === "spouse" && !edge.feuillets_union_display);
  const unions = (canvas.nodes || [])
    .filter((node) => node.feuillets_block === "genealogy-union" && node.feuillets_block_id === blockId && node.feuillets_union_relation === "spouse")
    .flatMap((node) => {
      const members = node.feuillets_union_members;
      if (!members || members.length !== 2) return [];
      return [{ id: node.feuillets_union_relation_id || `union-spouse-${node.id}`, fromNode: members[0], toNode: members[1], feuillets_managed: GENEALOGY_EDGE_MARKER as "genealogy", feuillets_block_id: blockId, feuillets_relation: "spouse" as const }];
    });
  return [...direct, ...unions];
}

/** Table parent → enfants, dans l'ordre STRUCTUREL des edges (jamais x/y —
 * même discipline que Mindmap, voir blocks/mindmap/model.ts). Restreinte
 * aux edges dont les DEUX extrémités sont des membres RÉELS du bloc. */
export function buildGenealogyChildrenMap(canvas: CanvasData, blockId: string): Map<string, string[]> {
  const memberIds = new Set(groupBlockMemberNodes(canvas, blockId).map((node) => node.id));
  const children = new Map<string, string[]>();
  for (const edge of parentChildEdges(canvas, blockId)) {
    if (!edge.fromNode || !edge.toNode) continue;
    if (!memberIds.has(edge.fromNode) || !memberIds.has(edge.toNode)) continue;
    const list = children.get(edge.fromNode) || [];
    list.push(edge.toNode);
    children.set(edge.fromNode, list);
  }
  return children;
}

/** Table enfant → parents (0, 1 ou 2 — la généalogie autorise deux parents
 * distincts par enfant, contrairement à la Mindmap qui n'en autorise qu'un
 * seul). */
export function buildGenealogyParentsMap(canvas: CanvasData, blockId: string): Map<string, string[]> {
  const memberIds = new Set(groupBlockMemberNodes(canvas, blockId).map((node) => node.id));
  const parents = new Map<string, string[]>();
  for (const edge of parentChildEdges(canvas, blockId)) {
    if (!edge.fromNode || !edge.toNode) continue;
    if (!memberIds.has(edge.fromNode) || !memberIds.has(edge.toNode)) continue;
    const list = parents.get(edge.toNode) || [];
    list.push(edge.fromNode);
    parents.set(edge.toNode, list);
  }
  return parents;
}

/** Groupes de conjoints — chaque groupe est l'ensemble des ids reliés
 * transitivement par une edge `spouse` (généralement une paire, mais un
 * trio accidentel reste géré sans planter). Ordre déterministe : trié par
 * id, jamais par insertion. */
export function buildGenealogySpouseGroups(canvas: CanvasData, blockId: string): string[][] {
  const memberIds = new Set(groupBlockMemberNodes(canvas, blockId).map((node) => node.id));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) as string;
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const id of memberIds) if (!parent.has(id)) parent.set(id, id);
  for (const edge of spouseEdges(canvas, blockId)) {
    if (!edge.fromNode || !edge.toNode) continue;
    if (!memberIds.has(edge.fromNode) || !memberIds.has(edge.toNode)) continue;
    union(edge.fromNode, edge.toNode);
  }
  const groups = new Map<string, string[]>();
  for (const id of memberIds) {
    const root = find(id);
    const list = groups.get(root) || [];
    list.push(id);
    groups.set(root, list);
  }
  return [...groups.values()].filter((group) => group.length > 1).map((group) => [...group].sort());
}

export function areSpouses(canvas: CanvasData, blockId: string, aId: string, bId: string): boolean {
  return spouseEdges(canvas, blockId).some(
    (edge) => (edge.fromNode === aId && edge.toNode === bId) || (edge.fromNode === bId && edge.toNode === aId)
  );
}

function existsParentChildPair(canvas: CanvasData, blockId: string, parentId: string, childId: string): boolean {
  return parentChildEdges(canvas, blockId).some((edge) => edge.fromNode === parentId && edge.toNode === childId);
}

/** `true` si `candidateId` est déjà descendant de `ancestorId` par la
 * chaîne parent→enfant EXISTANTE (spouse ignorée, §6) — LA garde anti-cycle :
 * ajouter `parentId → childId` créerait un cycle exactement quand `parentId`
 * est DÉJÀ un descendant de `childId` (le nouvel arc refermerait la boucle). */
export function isGenealogyDescendant(canvas: CanvasData, blockId: string, ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) return true;
  const children = buildGenealogyChildrenMap(canvas, blockId);
  const stack = [...(children.get(ancestorId) || [])];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === candidateId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(children.get(current) || []));
  }
  return false;
}

export type GenealogyRefusalReason = "self" | "not-members" | "duplicate" | "cycle";

export type GenealogyRelationResult =
  | { ok: true; edge: CanvasEdge }
  | { ok: false; reason: GenealogyRefusalReason };

function membersOf(canvas: CanvasData, blockId: string): Set<string> {
  return new Set(groupBlockMemberNodes(canvas, blockId).map((node) => node.id));
}

/** « Parent → enfant » (§5/§6) : refuse soi-même, hors bloc, le doublon
 * EXACT (même parent, même enfant déjà relié), et tout cycle (`parentId`
 * déjà descendant de `childId`). Un enfant peut avoir DEUX parents — aucune
 * limite imposée au-delà de ces quatre refus. */
export function addParentChildEdge(canvas: CanvasData, blockId: string, parentId: string, childId: string): GenealogyRelationResult {
  if (parentId === childId) return { ok: false, reason: "self" };
  const members = membersOf(canvas, blockId);
  if (!members.has(parentId) || !members.has(childId)) return { ok: false, reason: "not-members" };
  if (existsParentChildPair(canvas, blockId, parentId, childId)) return { ok: false, reason: "duplicate" };
  if (isGenealogyDescendant(canvas, blockId, childId, parentId)) return { ok: false, reason: "cycle" };
  const edge: CanvasEdge = {
    id: freshEdgeId(canvas, "feuillets-genealogy"),
    fromNode: parentId,
    toNode: childId,
    feuillets_managed: GENEALOGY_EDGE_MARKER,
    feuillets_block_id: blockId,
    feuillets_relation: "parent-child",
    toEnd: "arrow",
  };
  canvas.edges = canvas.edges || [];
  canvas.edges.push(edge);
  return { ok: true, edge };
}

/** « Conjoints » (§5/§6) : refuse soi-même, hors bloc, le doublon (déjà
 * conjoints, dans n'importe quel sens). Jamais de contrôle de cycle
 * (§6 : les relations spouse n'y participent pas). Trait SANS embout
 * (`toEnd: "none"`) : distinction visuelle native, jamais un rendu custom. */
export function addSpouseEdge(canvas: CanvasData, blockId: string, aId: string, bId: string): GenealogyRelationResult {
  if (aId === bId) return { ok: false, reason: "self" };
  const members = membersOf(canvas, blockId);
  if (!members.has(aId) || !members.has(bId)) return { ok: false, reason: "not-members" };
  if (areSpouses(canvas, blockId, aId, bId)) return { ok: false, reason: "duplicate" };
  const edge: CanvasEdge = {
    id: freshEdgeId(canvas, "feuillets-genealogy"),
    fromNode: aId,
    toNode: bId,
    feuillets_managed: GENEALOGY_EDGE_MARKER,
    feuillets_block_id: blockId,
    feuillets_relation: "spouse",
    toEnd: "none",
  };
  canvas.edges = canvas.edges || [];
  canvas.edges.push(edge);
  return { ok: true, edge };
}

/** Suppression d'UNE relation généalogique : uniquement l'edge métier,
 * jamais les membres qu'elle reliait. */
export function removeGenealogyEdge(canvas: CanvasData, blockId: string, edgeId: string): boolean {
  const edges = canvas.edges || [];
  const index = edges.findIndex((edge) => edge.id === edgeId && isGenealogyEdge(edge, blockId));
  if (index === -1) return false;
  edges.splice(index, 1);
  return true;
}
