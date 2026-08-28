import type { CanvasData, CanvasNode } from "../../canvas/types.js";
import {
  findMindmapChildren,
  findMindmapGroup,
  findMindmapParent,
  findMindmapRoot,
  isMindmapStructuralEdge,
  MINDMAP_BLOCK_TYPE,
  MINDMAP_BLOCK_VERSION,
  addMindmapChildRelation,
  addMindmapSiblingRelation,
  mindmapMemberNodes,
  reparentMindmapBranch,
} from "./model.js";
import { computeMindmapBranchLayout, computeMindmapTreeLayout, type MindmapLayoutDimensions, type MindmapOrientation } from "./layout.js";
import { canReparentByDrop, resolveShiftTabAction, toggleMindmapCollapse } from "./interactions.js";
import { isIdeaTreeEdge, ideaTreeBranch } from "../../../services/canvas-idea-tree.js";

/** Orchestration PURE (CanvasData uniquement, jamais de DOM/runtime — voir
 * src/integrations/advanced-canvas.ts et main.ts pour le câblage vivant,
 * scopé à la vue Carnet) reliant model.ts (structure), layout.ts
 * (géométrie) et interactions.ts (décisions) en une API par opération :
 * créer une Mindmap, ajouter un enfant/frère, reparenter, replier, appliquer
 * le layout, convertir une branche idea-tree existante. */

const DEFAULT_ROOT_WIDTH = 260;
const DEFAULT_ROOT_HEIGHT = 90;
const GROUP_PADDING = 60;

function freshMindmapNodeId(canvas: CanvasData): string {
  const used = new Set((canvas.nodes || []).map((node) => node.id));
  const chars = "0123456789abcdef";
  for (;;) {
    let id = "";
    for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
    if (!used.has(id)) return id;
  }
}

function dimensionsOf(node: CanvasNode): MindmapLayoutDimensions {
  return { width: Number(node.width) || DEFAULT_ROOT_WIDTH, height: Number(node.height) || DEFAULT_ROOT_HEIGHT };
}

export type CreateMindmapOptions = {
  blockId: string;
  centerX: number;
  centerY: number;
  rootText: string;
};

export type CreateMindmapResult = { group: CanvasNode; root: CanvasNode };

/** Crée le groupe Canvas natif (§2/§5) + son TextNode racine centré à
 * l'intérieur. Aucun fichier Markdown, aucune E/S — pousse directement les
 * deux nodes dans `canvas.nodes`. Le groupe reste un node Canvas ordinaire
 * (déplaçable/redimensionnable nativement, compatible Advanced Canvas). */
export function createMindmapBlock(canvas: CanvasData, options: CreateMindmapOptions): CreateMindmapResult {
  const { blockId, centerX, centerY, rootText } = options;
  const rootId = freshMindmapNodeId(canvas);
  const root: CanvasNode = {
    id: rootId,
    type: "text",
    text: rootText,
    x: centerX - DEFAULT_ROOT_WIDTH / 2,
    y: centerY - DEFAULT_ROOT_HEIGHT / 2,
    width: DEFAULT_ROOT_WIDTH,
    height: DEFAULT_ROOT_HEIGHT,
    feuillets_block_id: blockId,
  };
  canvas.nodes.push(root);

  const groupId = freshMindmapNodeId(canvas);
  const group: CanvasNode = {
    id: groupId,
    type: "group",
    x: centerX - (DEFAULT_ROOT_WIDTH + GROUP_PADDING * 2) / 2,
    y: centerY - (DEFAULT_ROOT_HEIGHT + GROUP_PADDING * 2) / 2,
    width: DEFAULT_ROOT_WIDTH + GROUP_PADDING * 2,
    height: DEFAULT_ROOT_HEIGHT + GROUP_PADDING * 2,
    feuillets_block: MINDMAP_BLOCK_TYPE,
    feuillets_block_version: MINDMAP_BLOCK_VERSION,
    feuillets_block_id: blockId,
  };
  canvas.nodes.push(group);

  return { group, root };
}

function childrenTable(canvas: CanvasData, blockId: string): Record<string, string[]> {
  const table: Record<string, string[]> = {};
  for (const node of mindmapMemberNodes(canvas, blockId)) {
    table[node.id] = findMindmapChildren(canvas, blockId, node.id).map((child) => child.id);
  }
  return table;
}

function dimensionsTable(canvas: CanvasData, blockId: string): Record<string, MindmapLayoutDimensions> {
  const table: Record<string, MindmapLayoutDimensions> = {};
  for (const node of mindmapMemberNodes(canvas, blockId)) table[node.id] = dimensionsOf(node);
  return table;
}

/** Orientation courante d'un bloc (§5 du correctif Prompt 2) — absence de
 * champ sur le groupe = "horizontal" (compatibilité, jamais de migration). */
export function mindmapOrientationOf(canvas: CanvasData, blockId: string): MindmapOrientation {
  const group = findMindmapGroup(canvas, blockId);
  return group?.mindmapOrientation === "vertical" ? "vertical" : "horizontal";
}

/** « Mindmap : changer l'orientation » (§6) — bascule horizontal ↔ vertical
 * sur le groupe UNIQUEMENT (jamais le modèle parent/enfant). L'appelant est
 * responsable du relayout qui suit (jamais automatique ici, voir §6 :
 * « aucun relayout automatique à l'ouverture », seule une commande
 * explicite en déclenche un). `false` si le bloc n'existe pas. */
export function toggleMindmapOrientation(canvas: CanvasData, blockId: string): MindmapOrientation | null {
  const group = findMindmapGroup(canvas, blockId);
  if (!group) return null;
  const next: MindmapOrientation = mindmapOrientationOf(canvas, blockId) === "vertical" ? "horizontal" : "vertical";
  group.mindmapOrientation = next;
  return next;
}

/** Redimensionne/repositionne UNIQUEMENT le groupe pour qu'il continue
 * d'englober tous ses membres (avec une marge constante) — jamais utilisé
 * pour déduire la structure, seulement pour l'affichage (§2/§5). */
function fitGroupToMembers(canvas: CanvasData, blockId: string): void {
  const group = findMindmapGroup(canvas, blockId);
  const members = mindmapMemberNodes(canvas, blockId);
  if (!group || members.length === 0) return;
  const left = Math.min(...members.map((node) => Number(node.x) || 0));
  const top = Math.min(...members.map((node) => Number(node.y) || 0));
  const right = Math.max(...members.map((node) => (Number(node.x) || 0) + (Number(node.width) || DEFAULT_ROOT_WIDTH)));
  const bottom = Math.max(...members.map((node) => (Number(node.y) || 0) + (Number(node.height) || DEFAULT_ROOT_HEIGHT)));
  group.x = left - GROUP_PADDING;
  group.y = top - GROUP_PADDING;
  group.width = right - left + GROUP_PADDING * 2;
  group.height = bottom - top + GROUP_PADDING * 2;
}

/** « Réorganiser la mindmap » (§8) : relayout COMPLET du bloc depuis sa
 * vraie racine, jamais déclenché automatiquement — uniquement sur une
 * opération structurelle explicite ou cette commande. La position actuelle
 * du groupe (son centre) sert d'ancre : l'utilisateur qui a déplacé le
 * groupe ne le voit jamais sauter ailleurs. */
export function applyMindmapLayout(canvas: CanvasData, blockId: string): boolean {
  const group = findMindmapGroup(canvas, blockId);
  const members = mindmapMemberNodes(canvas, blockId);
  if (!group || members.length === 0) return false;
  const root = members.find((node) => !findMindmapParent(canvas, blockId, node.id)) || members[0];
  const anchor = { x: Number(group.x) + Number(group.width) / 2, y: Number(group.y) + Number(group.height) / 2 };
  const orientation = mindmapOrientationOf(canvas, blockId);
  const result = computeMindmapTreeLayout(childrenTable(canvas, blockId), root.id, dimensionsTable(canvas, blockId), anchor, orientation);
  for (const node of members) {
    const position = result.positions[node.id];
    if (position) { node.x = position.x; node.y = position.y; }
  }
  for (const edge of canvas.edges || []) {
    if (!isMindmapStructuralEdge(edge, blockId) || !edge.fromNode || !edge.toNode) continue;
    const sides = result.edgeSides[`${edge.fromNode}->${edge.toNode}`];
    if (sides) { edge.fromSide = sides.fromSide; edge.toSide = sides.toSide; }
  }
  fitGroupToMembers(canvas, blockId);
  return true;
}

/** Relayout d'UNE branche seulement (§8 : « déplacement d'une branche sans
 * relayout inutile de toute la Canvas ») — ancrée à la position ACTUELLE de
 * `nodeId`, direction déduite du côté où il se trouve déjà par rapport à la
 * racine (jamais recalculée pour le reste de l'arbre). */
function relayoutBranch(canvas: CanvasData, blockId: string, nodeId: string): void {
  const node = (canvas.nodes || []).find((candidate) => candidate.id === nodeId);
  const root = findMindmapRoot(canvas, blockId, nodeId);
  if (!node || !root) return;
  const orientation = mindmapOrientationOf(canvas, blockId);
  // "right" vaut « vers l'avant » (droite en horizontal, bas en vertical) —
  // déduit du côté où `node` se trouve DÉJÀ par rapport à la racine, jamais
  // recalculé pour le reste de l'arbre (§8). Comparaison sur l'axe
  // PRINCIPAL de l'orientation courante : X en horizontal, Y en vertical.
  const direction = orientation === "vertical"
    ? ((Number(node.y) + Number(node.height) / 2) >= (Number(root.y) + Number(root.height) / 2) ? "right" : "left")
    : ((Number(node.x) + Number(node.width) / 2) >= (Number(root.x) + Number(root.width) / 2) ? "right" : "left");
  const anchor = { x: Number(node.x) + Number(node.width) / 2, y: Number(node.y) + Number(node.height) / 2 };
  const result = computeMindmapBranchLayout(childrenTable(canvas, blockId), nodeId, dimensionsTable(canvas, blockId), anchor, direction, orientation);
  for (const memberId of Object.keys(result.positions)) {
    const target = (canvas.nodes || []).find((candidate) => candidate.id === memberId);
    const position = result.positions[memberId];
    if (target && position) { target.x = position.x; target.y = position.y; }
  }
  for (const edge of canvas.edges || []) {
    if (!isMindmapStructuralEdge(edge, blockId) || !edge.fromNode || !edge.toNode) continue;
    const sides = result.edgeSides[`${edge.fromNode}->${edge.toNode}`];
    if (sides) { edge.fromSide = sides.fromSide; edge.toSide = sides.toSide; }
  }
  fitGroupToMembers(canvas, blockId);
}

export type MindmapNodeSeed = Partial<Pick<CanvasNode, "type" | "text" | "width" | "height" | "color">>;

function pushMindmapNode(canvas: CanvasData, blockId: string, seed: MindmapNodeSeed | undefined, x: number, y: number): CanvasNode {
  const node: CanvasNode = {
    id: freshMindmapNodeId(canvas),
    type: seed?.type || "text",
    text: seed?.text ?? "",
    x, y,
    width: seed?.width || DEFAULT_ROOT_WIDTH,
    height: seed?.height || DEFAULT_ROOT_HEIGHT,
    feuillets_block_id: blockId,
  };
  if (seed?.color) node.color = seed.color;
  canvas.nodes.push(node);
  return node;
}

/** Tab (§6) : nouvel enfant sous `parentId`, positionné provisoirement au
 * même endroit que son parent (le relayout de branche qui suit replace
 * réellement toutes les cartes). `null` si `parentId` n'est pas membre du
 * bloc — jamais de node orphelin créé dans ce cas. */
export function addMindmapChild(canvas: CanvasData, blockId: string, parentId: string, seed?: MindmapNodeSeed): CanvasNode | null {
  const parent = mindmapMemberNodes(canvas, blockId).find((node) => node.id === parentId);
  if (!parent) return null;
  const child = pushMindmapNode(canvas, blockId, seed, Number(parent.x), Number(parent.y));
  const edge = addMindmapChildRelation(canvas, blockId, parentId, child.id);
  if (!edge) { canvas.nodes.pop(); return null; }
  relayoutBranch(canvas, blockId, parent.id);
  return child;
}

/** Entrée (§6) : nouveau frère juste après `siblingId`. `null` si
 * `siblingId` est la racine (aucun parent structurel, voir interactions.ts). */
export function addMindmapSibling(canvas: CanvasData, blockId: string, siblingId: string, seed?: MindmapNodeSeed): CanvasNode | null {
  const sibling = mindmapMemberNodes(canvas, blockId).find((node) => node.id === siblingId);
  if (!sibling) return null;
  const child = pushMindmapNode(canvas, blockId, seed, Number(sibling.x), Number(sibling.y));
  const edge = addMindmapSiblingRelation(canvas, blockId, siblingId, child.id);
  if (!edge) { canvas.nodes.pop(); return null; }
  const parent = findMindmapParent(canvas, blockId, siblingId);
  relayoutBranch(canvas, blockId, parent ? parent.id : siblingId);
  return child;
}

/** Shift+Tab (§6) : reparente `nodeId` sous son grand-parent structurel.
 * `false` si impossible (racine, ou parent déjà racine — voir
 * interactions.ts, resolveShiftTabAction). */
export function outdentMindmapNode(canvas: CanvasData, blockId: string, nodeId: string): boolean {
  const action = resolveShiftTabAction(canvas, blockId, nodeId);
  if (!action || action.kind !== "outdent") return false;
  if (!reparentMindmapBranch(canvas, blockId, nodeId, action.newParentId)) return false;
  relayoutBranch(canvas, blockId, action.newParentId);
  return true;
}

/** Dépose drag & drop (§6) : reparente `draggedId` sous `targetId` si les
 * règles anti-cycle/anti-bloc-étranger sont respectées (interactions.ts).
 * `false` sinon — AUCUNE mutation dans ce cas. */
export function reparentMindmapNodeByDrop(canvas: CanvasData, blockId: string, draggedId: string, targetId: string): boolean {
  if (!canReparentByDrop(canvas, blockId, draggedId, targetId)) return false;
  if (!reparentMindmapBranch(canvas, blockId, draggedId, targetId)) return false;
  relayoutBranch(canvas, blockId, targetId);
  return true;
}

/** Replie/déplie `nodeId` (§7) : persiste UNIQUEMENT la liste d'ids sur le
 * groupe (`mindmapCollapsed`) — ne supprime ni ne masque aucune donnée du
 * canvas lui-même ; l'affichage réel (masquage DOM) est du ressort du
 * câblage vivant (mindmap.ts n'expose que l'état, voir interactions.ts
 * `computeMindmapVisibility` pour ce que l'appelant doit masquer). */
export function toggleMindmapNodeCollapsed(canvas: CanvasData, blockId: string, nodeId: string): string[] | null {
  const group = findMindmapGroup(canvas, blockId);
  if (!group) return null;
  const next = toggleMindmapCollapse(group.mindmapCollapsed, nodeId);
  group.mindmapCollapsed = next;
  return next;
}

export type MindmapConversionResult =
  | { ok: true; blockId: string }
  | { ok: false; reason: "empty-branch" | "cycle-detected" };

/** « Convertir en mindmap » (§11) sur une branche idea-tree EXISTANTE :
 * crée un groupe autour EXACTEMENT des nodes de cette branche (jamais tout
 * le Canvas), convertit uniquement les edges idea-tree internes à cette
 * branche en edges mindmap, préserve position/style/propriétés inconnues
 * de chaque node — puis applique le nouveau layout. Toute incohérence
 * (branche vide, cycle) annule l'opération SANS mutation partielle : tout
 * est calculé d'abord sur une copie de travail, appliqué en un seul bloc
 * seulement si valide. */
export function convertIdeaTreeBranchToMindmap(canvas: CanvasData, rootId: string, blockId: string): MindmapConversionResult {
  const branch = ideaTreeBranch(canvas, rootId);
  if (branch.length === 0) return { ok: false, reason: "empty-branch" };
  const branchIds = new Set(branch.map((node) => node.id));

  // Anti-cycle défensif : le pré-ordre idea-tree ne visite jamais deux fois
  // le même id (voir services/canvas-idea-tree.ts, `visited`) — un id
  // dupliqué dans `branch` trahirait un graphe incohérent (edges idea-tree
  // formant un cycle) déjà partiellement corrompu en amont.
  if (branch.length !== branchIds.size) return { ok: false, reason: "cycle-detected" };

  // Toutes les mutations sont décidées ici sur les VRAIES références, mais
  // seulement APRÈS validation complète ci-dessus — aucun état
  // intermédiaire n'est jamais visible si l'on ressort avant ce point.
  for (const node of branch) node.feuillets_block_id = blockId;
  for (const edge of canvas.edges || []) {
    if (!isIdeaTreeEdge(edge) || !edge.fromNode || !edge.toNode) continue;
    if (!branchIds.has(edge.fromNode) || !branchIds.has(edge.toNode)) continue;
    edge.feuillets_managed = "mindmap";
    edge.feuillets_block_id = blockId;
  }

  const left = Math.min(...branch.map((node) => Number(node.x) || 0));
  const top = Math.min(...branch.map((node) => Number(node.y) || 0));
  const right = Math.max(...branch.map((node) => (Number(node.x) || 0) + (Number(node.width) || DEFAULT_ROOT_WIDTH)));
  const bottom = Math.max(...branch.map((node) => (Number(node.y) || 0) + (Number(node.height) || DEFAULT_ROOT_HEIGHT)));
  const group: CanvasNode = {
    id: freshMindmapNodeId(canvas),
    type: "group",
    x: left - GROUP_PADDING,
    y: top - GROUP_PADDING,
    width: right - left + GROUP_PADDING * 2,
    height: bottom - top + GROUP_PADDING * 2,
    feuillets_block: MINDMAP_BLOCK_TYPE,
    feuillets_block_version: MINDMAP_BLOCK_VERSION,
    feuillets_block_id: blockId,
  };
  canvas.nodes.push(group);
  applyMindmapLayout(canvas, blockId);
  return { ok: true, blockId };
}

export { isMindmapGroupNode, isMindmapMemberNode, mindmapSubtree } from "./model.js";
export type { MindmapOrientation } from "./layout.js";
