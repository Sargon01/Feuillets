import type { CanvasData, CanvasEdge, CanvasNode } from "../../canvas/types.js";

/** Modèle STRUCTUREL pur d'une Mindmap Feuillets (Prompt 2/5).
 *
 * Une Mindmap est un groupe Canvas natif (`type: "group"`) portant
 * `feuillets_block: "mindmap"` + `feuillets_block_id: "<uuid>"`. Ses nodes
 * membres portent le même `feuillets_block_id`. Seules les edges portant
 * À LA FOIS `feuillets_managed: "mindmap"` ET ce même `feuillets_block_id`
 * sont des relations STRUCTURELLES (parent → enfant) — toute autre edge
 * (libre, idea-tree, d'un autre bloc…) est ignorée par ce module, jamais
 * lue ni modifiée. La géométrie (x/y) n'est JAMAIS utilisée pour déduire la
 * structure : uniquement les marqueurs. Fonctions pures, aucune E/S. */

export const MINDMAP_BLOCK_TYPE = "mindmap";
export const MINDMAP_BLOCK_VERSION = 1;
export const MINDMAP_EDGE_MARKER = "mindmap";

export function isMindmapGroupNode(node: CanvasNode): boolean {
  return node.type === "group" && node.feuillets_block === MINDMAP_BLOCK_TYPE && typeof node.feuillets_block_id === "string";
}

export function findMindmapGroup(canvas: CanvasData, blockId: string): CanvasNode | null {
  return (canvas.nodes || []).find((node) => isMindmapGroupNode(node) && node.feuillets_block_id === blockId) || null;
}

export function isMindmapMemberNode(node: CanvasNode, blockId: string): boolean {
  return !isMindmapGroupNode(node) && node.feuillets_block_id === blockId;
}

export function mindmapMemberNodes(canvas: CanvasData, blockId: string): CanvasNode[] {
  return (canvas.nodes || []).filter((node) => isMindmapMemberNode(node, blockId));
}

/** Une edge STRUCTURELLE de CE bloc — jamais une edge libre, jamais une
 * edge d'un autre `feuillets_block_id`, jamais une edge idea-tree. */
export function isMindmapStructuralEdge(edge: CanvasEdge, blockId: string): boolean {
  return edge.feuillets_managed === MINDMAP_EDGE_MARKER && edge.feuillets_block_id === blockId;
}

function structuralEdges(canvas: CanvasData, blockId: string): CanvasEdge[] {
  return (canvas.edges || []).filter((edge) => isMindmapStructuralEdge(edge, blockId));
}

/** Table enfant → parent, restreinte aux nodes RÉELLEMENT membres du bloc —
 * une edge structurelle pointant vers/depuis un node disparu ou hors bloc
 * est ignorée (jamais un cycle fantôme, jamais un membre d'un autre bloc). */
function buildParentMap(canvas: CanvasData, blockId: string): Map<string, string> {
  const memberIds = new Set(mindmapMemberNodes(canvas, blockId).map((node) => node.id));
  const parentOf = new Map<string, string>();
  for (const edge of structuralEdges(canvas, blockId)) {
    if (!edge.fromNode || !edge.toNode) continue;
    if (!memberIds.has(edge.fromNode) || !memberIds.has(edge.toNode)) continue;
    if (parentOf.has(edge.toNode)) continue; // au plus UN parent structurel (§3)
    parentOf.set(edge.toNode, edge.fromNode);
  }
  return parentOf;
}

/** Table parent → enfants, dans l'ORDRE STRUCTUREL (celui des edges dans
 * `canvas.edges`, jamais x/y) — la géométrie ne doit JAMAIS influencer ni
 * la structure ni son ordre (§3) : un relayout qui déplace un node ne doit
 * jamais, en retour, changer quel côté (gauche/droite) il occupera au
 * relayout suivant. `parentOf` (une Map) préserve déjà l'ordre d'insertion
 * de `structuralEdges`, donc chaque liste d'enfants hérite naturellement de
 * cet ordre sans re-tri géométrique. */
function buildChildrenMap(canvas: CanvasData, blockId: string): Map<string, string[]> {
  const parentOf = buildParentMap(canvas, blockId);
  const children = new Map<string, string[]>();
  for (const [childId, parentId] of parentOf) {
    const list = children.get(parentId) || [];
    list.push(childId);
    children.set(parentId, list);
  }
  return children;
}

export function findMindmapParent(canvas: CanvasData, blockId: string, nodeId: string): CanvasNode | null {
  const parentId = buildParentMap(canvas, blockId).get(nodeId);
  if (!parentId) return null;
  return (canvas.nodes || []).find((node) => node.id === parentId) || null;
}

export function findMindmapChildren(canvas: CanvasData, blockId: string, nodeId: string): CanvasNode[] {
  const childIds = buildChildrenMap(canvas, blockId).get(nodeId) || [];
  const byId = new Map(mindmapMemberNodes(canvas, blockId).map((node) => [node.id, node]));
  return childIds.map((id) => byId.get(id)).filter((node): node is CanvasNode => !!node);
}

export function findMindmapSiblings(canvas: CanvasData, blockId: string, nodeId: string): CanvasNode[] {
  const parent = findMindmapParent(canvas, blockId, nodeId);
  if (!parent) return [];
  return findMindmapChildren(canvas, blockId, parent.id).filter((node) => node.id !== nodeId);
}

/** Remonte les parents structurels jusqu'à un node sans parent (la racine).
 * `null` si `nodeId` n'est pas membre du bloc. Bornée par `visited` :
 * un cycle accidentel dans les données ne boucle jamais indéfiniment. */
export function findMindmapRoot(canvas: CanvasData, blockId: string, nodeId: string): CanvasNode | null {
  const byId = new Map(mindmapMemberNodes(canvas, blockId).map((node) => [node.id, node]));
  if (!byId.has(nodeId)) return null;
  const parentOf = buildParentMap(canvas, blockId);
  let currentId = nodeId;
  const visited = new Set<string>();
  while (!visited.has(currentId)) {
    visited.add(currentId);
    const parentId = parentOf.get(currentId);
    if (!parentId || !byId.has(parentId)) break;
    currentId = parentId;
  }
  return byId.get(currentId) || null;
}

/** `true` si `candidateId` est `ancestorId` lui-même OU un de ses
 * descendants structurels — LA garde anti-cycle du module : un reparentage
 * qui rendrait `ancestorId` descendant de lui-même est toujours rejeté par
 * `canReparentMindmapNode` grâce à cette fonction. */
export function isMindmapDescendant(canvas: CanvasData, blockId: string, ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) return true;
  const children = buildChildrenMap(canvas, blockId);
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

/** Sous-arbre en ordre déterministe (pré-ordre, frères triés par y puis x
 * puis id — jamais un ordre dépendant de l'insertion). Bornée par
 * `visited` contre un cycle accidentel dans les données existantes. */
export function mindmapSubtree(canvas: CanvasData, blockId: string, rootId: string): CanvasNode[] {
  const byId = new Map(mindmapMemberNodes(canvas, blockId).map((node) => [node.id, node]));
  const root = byId.get(rootId);
  if (!root) return [];
  const children = buildChildrenMap(canvas, blockId);
  const ordered: CanvasNode[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    ordered.push(node);
    for (const childId of children.get(id) || []) visit(childId);
  };
  visit(rootId);
  return ordered;
}

/** `newParentId === null` autorise le détachement (le node devient racine
 * de sa propre branche) — toujours valide. Sinon : rejette la cible hors
 * bloc, le node lui-même, et tout descendant (anti-cycle, §3). */
export function canReparentMindmapNode(canvas: CanvasData, blockId: string, nodeId: string, newParentId: string | null): boolean {
  if (newParentId === null) return true;
  if (newParentId === nodeId) return false;
  const member = mindmapMemberNodes(canvas, blockId).some((node) => node.id === newParentId);
  if (!member) return false;
  return !isMindmapDescendant(canvas, blockId, nodeId, newParentId);
}

function freshMindmapEdgeId(canvas: CanvasData): string {
  const used = new Set((canvas.edges || []).map((edge) => edge.id));
  let index = 1;
  while (used.has(`feuillets-mindmap-${index}`)) index += 1;
  return `feuillets-mindmap-${index}`;
}

/** Crée l'edge structurelle parent → enfant. Ne crée ni ne déplace aucun
 * node — l'appelant (mindmap.ts) fournit le node déjà poussé dans
 * `canvas.nodes` (avec son `feuillets_block_id` posé) et relance ensuite le
 * layout. `null` si parent/enfant n'appartiennent pas au même bloc, ou si
 * l'enfant a déjà un parent structurel (au plus un, §3). */
export function addMindmapChildRelation(canvas: CanvasData, blockId: string, parentId: string, childId: string): CanvasEdge | null {
  const members = new Set(mindmapMemberNodes(canvas, blockId).map((node) => node.id));
  if (!members.has(parentId) || !members.has(childId)) return null;
  if (buildParentMap(canvas, blockId).has(childId)) return null;
  const edge: CanvasEdge = {
    id: freshMindmapEdgeId(canvas),
    fromNode: parentId,
    toNode: childId,
    feuillets_managed: MINDMAP_EDGE_MARKER,
    feuillets_block_id: blockId,
  };
  canvas.edges.push(edge);
  return edge;
}

/** Ajoute `childId` comme frère de `siblingId` (même parent structurel).
 * `null` si `siblingId` est la racine (pas de parent, donc pas de fratrie
 * structurelle possible) ou hors bloc. */
export function addMindmapSiblingRelation(canvas: CanvasData, blockId: string, siblingId: string, childId: string): CanvasEdge | null {
  const parent = findMindmapParent(canvas, blockId, siblingId);
  if (!parent) return null;
  return addMindmapChildRelation(canvas, blockId, parent.id, childId);
}

/** Retire UNIQUEMENT la relation structurelle (l'edge parent → `nodeId`) —
 * ne supprime ni le node, ni ses propres relations avec ses enfants :
 * `nodeId` devient la racine de sa propre branche, toujours dans le bloc. */
export function removeMindmapParentRelation(canvas: CanvasData, blockId: string, nodeId: string): boolean {
  const edges = canvas.edges || [];
  const index = edges.findIndex((edge) => isMindmapStructuralEdge(edge, blockId) && edge.toNode === nodeId);
  if (index === -1) return false;
  edges.splice(index, 1);
  return true;
}

/** Déplace/reparente une branche entière : seule l'edge parent → `nodeId`
 * change, tous les descendants de `nodeId` suivent automatiquement (leurs
 * propres edges structurelles ne sont jamais touchées). Rejette tout
 * reparentage créant un cycle (voir `canReparentMindmapNode`). */
export function reparentMindmapBranch(canvas: CanvasData, blockId: string, nodeId: string, newParentId: string | null): boolean {
  if (!canReparentMindmapNode(canvas, blockId, nodeId, newParentId)) return false;
  removeMindmapParentRelation(canvas, blockId, nodeId);
  if (newParentId === null) return true;
  return addMindmapChildRelation(canvas, blockId, newParentId, nodeId) !== null;
}
