import type { CanvasData, CanvasEdge, CanvasNode } from "./canvas-board.js";
import { firstMeaningfulLine, freshCanvasNodeId } from "./canvas-bridge.js";

/** Marqueur exclusivement porté par les arêtes créées par l'Arbre d'idées. */
export const IDEA_TREE_MARKER = "idea-tree";

export const IDEA_TREE_LAYOUT = {
  childWidth: 260,
  childHeight: 80,
  horizontalIndent: 170,
  verticalSpacing: 60,
} as const;

/** Attributs communs aux TextNodes du modèle « Test Manuel ». Advanced
 * Canvas les interprète ; Canvas natif les conserve sans dépendance. */
export const IDEA_TREE_NODE_STYLE = {
  border: "invisible",
  shape: null,
} as const;

/** Attributs communs aux cinq edges du modèle « Test Manuel ». */
export const IDEA_TREE_EDGE_STYLE = {
  pathfindingMethod: "square",
} as const;

export type IdeaTreeCreation = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

/** Crée UN TextNode + SON edge marquée sous `parentId`, à la position `y`
 * donnée (le géométrie x/largeur/hauteur reste toujours celle du modèle
 * « Test Manuel », voir IDEA_TREE_LAYOUT) — factorisation partagée par
 * `createIdeaBranches` (plusieurs lignes) et `createIdeaChild`/
 * `createIdeaSibling` (Lot 5, une seule carte, texte vide autorisé) : une
 * seule logique de création de paire node+edge, jamais dupliquée. */
function appendIdeaNode(canvas: CanvasData, parentId: string, text: string, y: number): CanvasNode {
  const { childWidth, childHeight, horizontalIndent } = IDEA_TREE_LAYOUT;
  const parent = (canvas.nodes || []).find((node) => node.id === parentId);
  const id = freshCanvasNodeId(canvas);
  const node: CanvasNode = {
    id,
    type: "text",
    text,
    styleAttributes: { ...IDEA_TREE_NODE_STYLE },
    x: (Number(parent?.x) || 0) + horizontalIndent,
    y,
    width: childWidth,
    height: childHeight,
  };
  canvas.nodes.push(node);

  const edge: CanvasEdge = {
    id: freshCanvasEdgeId(canvas),
    styleAttributes: { ...IDEA_TREE_EDGE_STYLE },
    toFloating: false,
    fromNode: parentId,
    fromSide: "bottom",
    toNode: id,
    toSide: "left",
    toEnd: "none",
    feuillets_managed: IDEA_TREE_MARKER,
  };
  canvas.edges.push(edge);

  return node;
}

/** Vrai si `nodeId` possède un parent idea-tree (une edge marquée dont il
 * est la cible) — distinct de `isIdeaTreeNode`, qui répond aussi vrai pour
 * une racine sans parent (elle a des enfants). Utilisé par le raccourci
 * Entrée (section 2 du Lot 5) : créer un frère n'a de sens que si le node
 * sélectionné a déjà un parent dans l'arbre. */
export function hasIdeaTreeParent(canvas: CanvasData, nodeId: string): boolean {
  return (canvas.edges || []).some((edge) => isIdeaTreeEdge(edge) && edge.toNode === nodeId);
}

/** Lot 5 — raccourci Tab : ajoute UN enfant (texte vide par défaut, l'appelant
 * démarre l'édition juste après) sous `parentId`, juste sous les enfants déjà
 * présents. Retourne `null` si `parentId` n'existe pas dans `canvas`. */
export function createIdeaChild(canvas: CanvasData, parentId: string, text = ""): CanvasNode | null {
  const parent = (canvas.nodes || []).find((node) => node.id === parentId);
  if (!parent) return null;

  const { verticalSpacing } = IDEA_TREE_LAYOUT;
  const existingChildren = (canvas.edges || [])
    .filter((edge) => isIdeaTreeEdge(edge) && edge.fromNode === parentId)
    .map((edge) => canvas.nodes.find((node) => node.id === edge.toNode))
    .filter((node): node is CanvasNode => !!node);
  const y = existingChildren.reduce(
    (bottom, child) => Math.max(bottom, (Number(child.y) || 0) + verticalSpacing),
    (Number(parent.y) || 0) + verticalSpacing
  );

  const node = appendIdeaNode(canvas, parentId, text, y);
  reflowIdeaTree(canvas, parentId);
  return node;
}

/** Lot 5 — raccourci Entrée : ajoute UN frère juste après `siblingId` (même
 * parent idea-tree), texte vide par défaut. Retourne `null` si `siblingId`
 * n'a pas de parent idea-tree (racine) ou n'existe plus dans `canvas`. */
export function createIdeaSibling(canvas: CanvasData, siblingId: string, text = ""): CanvasNode | null {
  const parentEdge = (canvas.edges || []).find((edge) => isIdeaTreeEdge(edge) && edge.toNode === siblingId);
  if (!parentEdge || !parentEdge.fromNode) return null;
  const sibling = (canvas.nodes || []).find((node) => node.id === siblingId);
  if (!sibling) return null;

  // Un `y` juste au-dessus du prochain frère (verticalSpacing = 60 sépare
  // toujours deux frères existants) place le nouveau node immédiatement
  // après `siblingId` dans le tri (y, x, id) qu'utilise `ideaTreeBranch` —
  // reflowIdeaTree recalcule ensuite la position réelle depuis cet ordre.
  const y = (Number(sibling.y) || 0) + 1;
  const node = appendIdeaNode(canvas, parentEdge.fromNode, text, y);
  reflowIdeaTree(canvas, parentEdge.fromNode);
  return node;
}

function freshCanvasEdgeId(canvas: CanvasData): string {
  const used = new Set((canvas.edges || []).map((edge) => edge.id));
  let index = 1;
  while (used.has(`feuillets-idea-tree-${index}`)) index += 1;
  return `feuillets-idea-tree-${index}`;
}

/** Une ligne non vide devient une branche. Seuls les blancs extérieurs de
 * chaque ligne sont retirés ; le texte intérieur reste strictement intact. */
export function ideaTreeLines(raw: string): string[] {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Retrouve l'ancêtre racine d'un node en remontant exclusivement les
 * arêtes gérées. Une edge Canvas libre n'entre jamais dans ce calcul. */
export function ideaTreeRoot(canvas: CanvasData, nodeId: string): CanvasNode | null {
  const byId = new Map((canvas.nodes || []).map((node) => [node.id, node]));
  if (!byId.has(nodeId)) return null;
  const parentOf = new Map<string, string>();
  for (const edge of canvas.edges || []) {
    if (!isIdeaTreeEdge(edge) || !edge.fromNode || !edge.toNode) continue;
    if (!byId.has(edge.fromNode) || !byId.has(edge.toNode) || parentOf.has(edge.toNode)) continue;
    parentOf.set(edge.toNode, edge.fromNode);
  }

  let currentId = nodeId;
  const visited = new Set<string>();
  while (!visited.has(currentId)) {
    visited.add(currentId);
    const parentId = parentOf.get(currentId);
    if (!parentId) break;
    currentId = parentId;
  }
  return byId.get(currentId) || null;
}

/** Reflow visuel d'un SEUL arbre Feuillets. La racine reste son ancre ;
 * tous ses descendants suivent l'ordre DFS métier existant et leur
 * profondeur structurelle. Aucun node extérieur, même relié par une edge
 * ordinaire, n'est lu ni déplacé. */
export function reflowIdeaTree(canvas: CanvasData, memberId: string): CanvasNode[] {
  const root = ideaTreeRoot(canvas, memberId);
  if (!root) return [];
  const ordered = ideaTreeBranch(canvas, root.id);
  const ids = new Set(ordered.map((node) => node.id));
  const parentOf = new Map<string, string>();
  for (const edge of canvas.edges || []) {
    if (!isIdeaTreeEdge(edge) || !edge.fromNode || !edge.toNode) continue;
    if (ids.has(edge.fromNode) && ids.has(edge.toNode) && !parentOf.has(edge.toNode)) {
      parentOf.set(edge.toNode, edge.fromNode);
    }
  }

  const depth = new Map<string, number>([[root.id, 0]]);
  const rootX = Number(root.x) || 0;
  const rootY = Number(root.y) || 0;
  ordered.forEach((node, index) => {
    if (node.id === root.id) return;
    const parentDepth = depth.get(parentOf.get(node.id) || root.id) ?? 0;
    const nodeDepth = parentDepth + 1;
    depth.set(node.id, nodeDepth);
    node.x = rootX + nodeDepth * IDEA_TREE_LAYOUT.horizontalIndent;
    node.y = rootY + index * IDEA_TREE_LAYOUT.verticalSpacing;
  });
  return ordered;
}

/** Ajoute uniquement les nouveaux TextNodes et leurs arêtes marquées. Les
 * nodes/edges déjà présents ne sont ni clonés ni réécrits, ce qui préserve
 * tous leurs attributs connus ou inconnus. */
export function createIdeaBranches(canvas: CanvasData, parentId: string, raw: string): IdeaTreeCreation {
  const parent = (canvas.nodes || []).find((node) => node.id === parentId);
  const lines = ideaTreeLines(raw);
  if (!parent || lines.length === 0) return { nodes: [], edges: [] };

  const { verticalSpacing } = IDEA_TREE_LAYOUT;
  const existingChildren = (canvas.edges || [])
    .filter((edge) => isIdeaTreeEdge(edge) && edge.fromNode === parentId)
    .map((edge) => canvas.nodes.find((node) => node.id === edge.toNode))
    .filter((node): node is CanvasNode => !!node);
  const firstY = existingChildren.reduce(
    (bottom, child) => Math.max(bottom, (Number(child.y) || 0) + verticalSpacing),
    (Number(parent.y) || 0) + verticalSpacing
  );

  const nodes: CanvasNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const node = appendIdeaNode(canvas, parentId, lines[index], firstY + index * verticalSpacing);
    nodes.push(node);
  }
  const edges = nodes
    .map((node) => (canvas.edges || []).find((edge) => isIdeaTreeEdge(edge) && edge.toNode === node.id))
    .filter((edge): edge is CanvasEdge => !!edge);

  reflowIdeaTree(canvas, parentId);

  return { nodes, edges };
}

export function isIdeaTreeEdge(edge: CanvasEdge): boolean {
  return edge.feuillets_managed === IDEA_TREE_MARKER;
}

export function isIdeaTreeNode(canvas: CanvasData, nodeId: string): boolean {
  return (canvas.edges || []).some(
    (edge) => isIdeaTreeEdge(edge) && (edge.fromNode === nodeId || edge.toNode === nodeId)
  );
}

/** Branche en depth-first pre-order. Les frères sont triés selon Y, puis X
 * et enfin id pour garantir un résultat stable même à coordonnées égales.
 * Les cycles accidentels sont bornés par `visited`. */
export function ideaTreeBranch(canvas: CanvasData, rootId: string): CanvasNode[] {
  const byId = new Map((canvas.nodes || []).map((node) => [node.id, node]));
  const root = byId.get(rootId);
  if (!root) return [];

  const children = new Map<string, CanvasNode[]>();
  for (const edge of canvas.edges || []) {
    if (!isIdeaTreeEdge(edge) || !edge.fromNode || !edge.toNode) continue;
    const child = byId.get(edge.toNode);
    if (!child) continue;
    const list = children.get(edge.fromNode) || [];
    list.push(child);
    children.set(edge.fromNode, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) =>
      (Number(a.y) || 0) - (Number(b.y) || 0) ||
      (Number(a.x) || 0) - (Number(b.x) || 0) ||
      a.id.localeCompare(b.id)
    );
  }

  const ordered: CanvasNode[] = [];
  const visited = new Set<string>();
  const visit = (node: CanvasNode) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    ordered.push(node);
    for (const child of children.get(node.id) || []) visit(child);
  };
  visit(root);
  return ordered;
}

/** Lot 9 — nombre maximal de `#` que le Markdown standard réutilisé par
 * `ImportOutlineModal` sait interpréter en niveau de dossier. */
const MAX_OUTLINE_HEADING_LEVEL = 6;

export type IdeaTreeOutlineResult =
  | { ok: true; markdown: string }
  | { ok: false; code: "non-text-node" | "empty-title" | "too-deep" };

/** Lot 9 — convertit UNE branche idea-tree (le node `rootId` inclus, et
 * seulement ses descendants atteints par des edges `feuillets_managed:
 * "idea-tree"`, voir `ideaTreeBranch`) en Markdown compatible avec
 * `ImportOutlineModal` :
 *
 *   - un node qui a au moins un enfant idea-tree devient un titre Markdown
 *     (`#` répété selon sa profondeur relative depuis `rootId`, `rootId`
 *     lui-même à profondeur 0 donc `#`) ;
 *   - un node sans enfant idea-tree devient une puce (`- …`) sous le titre
 *     le plus proche.
 *
 * Fonction PURE : aucune lecture de `app`/vault, aucune mutation de
 * `canvas`. Toute branche invalide (node non-TextNode, titre vide, ou
 * profondeur nécessitant plus de 6 `#`) est refusée entièrement — jamais
 * une génération partielle qui ignorerait silencieusement un node. */
export function ideaTreeBranchToOutlineMarkdown(canvas: CanvasData, rootId: string): IdeaTreeOutlineResult {
  const branch = ideaTreeBranch(canvas, rootId);
  if (branch.length === 0) return { ok: true, markdown: "" };

  for (const node of branch) {
    if (node.type !== "text") return { ok: false, code: "non-text-node" };
  }

  const titles = new Map<string, string>();
  for (const node of branch) {
    const title = firstMeaningfulLine(node.text || "");
    if (!title) return { ok: false, code: "empty-title" };
    titles.set(node.id, title);
  }

  const branchIds = new Set(branch.map((node) => node.id));
  const parentOf = new Map<string, string>();
  const hasChild = new Set<string>();
  for (const edge of canvas.edges || []) {
    if (!isIdeaTreeEdge(edge) || !edge.fromNode || !edge.toNode) continue;
    if (!branchIds.has(edge.fromNode) || !branchIds.has(edge.toNode)) continue;
    if (!parentOf.has(edge.toNode)) parentOf.set(edge.toNode, edge.fromNode);
    hasChild.add(edge.fromNode);
  }

  const depth = new Map<string, number>([[rootId, 0]]);
  for (const node of branch) {
    if (node.id === rootId) continue;
    const parentId = parentOf.get(node.id);
    const parentDepth = (parentId ? depth.get(parentId) : undefined) ?? 0;
    depth.set(node.id, parentDepth + 1);
  }

  const lines: string[] = [];
  for (const node of branch) {
    const title = titles.get(node.id) as string;
    const nodeDepth = depth.get(node.id) ?? 0;
    if (hasChild.has(node.id)) {
      const level = nodeDepth + 1;
      if (level > MAX_OUTLINE_HEADING_LEVEL) return { ok: false, code: "too-deep" };
      lines.push(`${"#".repeat(level)} ${title}`);
    } else {
      lines.push(`- ${title}`);
    }
  }

  return { ok: true, markdown: lines.join("\n") };
}
