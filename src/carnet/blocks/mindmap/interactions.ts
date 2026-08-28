import type { CanvasData, CanvasEdge } from "../../canvas/types.js";
import {
  canReparentMindmapNode,
  findMindmapChildren,
  findMindmapParent,
  isMindmapStructuralEdge,
  mindmapSubtree,
} from "./model.js";

/** Logique d'INTERACTION pure d'une Mindmap (§6/§7 du correctif) — aucun
 * accès DOM/clavier/souris ici : ce module décide QUOI faire (créer un
 * frère, un enfant, reparenter, replier), jamais COMMENT l'installer sur un
 * vrai Canvas (voir mindmap.ts pour le câblage runtime, scopé à la vue
 * Carnet et toujours restaurable). */

export type MindmapAction =
  | { kind: "create-sibling"; afterId: string; parentId: string }
  | { kind: "create-child"; parentId: string }
  | { kind: "outdent"; nodeId: string; newParentId: string };

/** Entrée : un nouveau frère juste après `nodeId` — `null` si `nodeId` est
 * la racine (aucun parent structurel, donc aucune fratrie possible). */
export function resolveEnterAction(canvas: CanvasData, blockId: string, nodeId: string): MindmapAction | null {
  const parent = findMindmapParent(canvas, blockId, nodeId);
  if (!parent) return null;
  return { kind: "create-sibling", afterId: nodeId, parentId: parent.id };
}

/** Tab : un nouvel enfant sous `nodeId` — toujours valide pour un membre du
 * bloc (une feuille comme un nœud déjà pourvu d'enfants). */
export function resolveTabAction(_canvas: CanvasData, _blockId: string, nodeId: string): MindmapAction {
  return { kind: "create-child", parentId: nodeId };
}

/** Shift+Tab : reparente `nodeId` sous son grand-parent structurel — `null`
 * si `nodeId` est la racine, ou si son parent EST la racine (pas de
 * grand-parent : sortir romprait l'unicité de la racine, §3). */
export function resolveShiftTabAction(canvas: CanvasData, blockId: string, nodeId: string): MindmapAction | null {
  const parent = findMindmapParent(canvas, blockId, nodeId);
  if (!parent) return null;
  const grandParent = findMindmapParent(canvas, blockId, parent.id);
  if (!grandParent) return null;
  return { kind: "outdent", nodeId, newParentId: grandParent.id };
}

/** Validation d'un dépôt drag & drop (glisser `draggedId` sur `targetId`
 * pour le reparenter) — règles §6 : jamais sur soi-même, jamais sur un
 * descendant (anti-cycle), jamais sur un node d'un AUTRE bloc Mindmap ou un
 * node Canvas libre (donc `targetId` doit être membre de CE `blockId`,
 * vérifié par `canReparentMindmapNode`). */
export function canReparentByDrop(canvas: CanvasData, blockId: string, draggedId: string, targetId: string): boolean {
  return canReparentMindmapNode(canvas, blockId, draggedId, targetId);
}

/* ================================================================
 * Repli / dépli (§7) — persistance pure, aucune E/S.
 * ================================================================ */

/** Bascule `nodeId` dans la liste des nodes repliés (persistée sur le
 * groupe, `mindmapCollapsed`) — jamais de mutation en place de la liste
 * reçue, un nouveau tableau est toujours retourné. */
export function toggleMindmapCollapse(collapsed: string[] | undefined, nodeId: string): string[] {
  const list = collapsed || [];
  if (list.includes(nodeId)) return list.filter((id) => id !== nodeId);
  return [...list, nodeId];
}

export type MindmapVisibility = { hiddenNodeIds: Set<string>; hiddenEdgeIds: Set<string> };

/** Calcule ce qui doit rester MASQUÉ (jamais supprimé) : tous les
 * descendants structurels d'un node replié (mais jamais le node replié
 * lui-même, qui garde son propre contrôle de dépli visible), et les edges
 * structurelles qui les relient. Un node/une edge libre proche ou
 * traversant le groupe n'est jamais concerné (§7 : seuls les descendants
 * ET edges STRUCTURELS du bloc sont pris en compte). */
export function computeMindmapVisibility(canvas: CanvasData, blockId: string, collapsed: string[] | undefined): MindmapVisibility {
  const hiddenNodeIds = new Set<string>();
  for (const collapsedId of collapsed || []) {
    for (const child of findMindmapChildren(canvas, blockId, collapsedId)) {
      for (const descendant of mindmapSubtree(canvas, blockId, child.id)) hiddenNodeIds.add(descendant.id);
    }
  }
  const hiddenEdgeIds = new Set<string>();
  for (const edge of canvas.edges || []) {
    if (!isMindmapStructuralEdge(edge, blockId)) continue;
    if ((edge.fromNode && hiddenNodeIds.has(edge.fromNode)) || (edge.toNode && hiddenNodeIds.has(edge.toNode))) {
      hiddenEdgeIds.add(edge.id);
    }
    // L'edge du node replié VERS son premier niveau d'enfants (désormais
    // masqués) doit elle aussi disparaître visuellement, même si l'enfant
    // direct n'est pas dans hiddenNodeIds pour une AUTRE raison — couvert
    // ci-dessus puisque cet enfant direct est justement ajouté à
    // hiddenNodeIds par la boucle précédente.
  }
  return { hiddenNodeIds, hiddenEdgeIds };
}

/** Edges structurelles à faire disparaître visuellement pour CE bloc,
 * étant donné l'état replié courant — helper de confort au-dessus de
 * `computeMindmapVisibility` pour un appelant qui n'a besoin que des edges. */
export function hiddenMindmapEdges(canvas: CanvasData, blockId: string, collapsed: string[] | undefined): CanvasEdge[] {
  const { hiddenEdgeIds } = computeMindmapVisibility(canvas, blockId, collapsed);
  return (canvas.edges || []).filter((edge) => hiddenEdgeIds.has(edge.id));
}
