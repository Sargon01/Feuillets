/** Moteur de layout PUR d'une Mindmap (Prompt 2/5, orientation ajoutée au
 * correctif Prompt 2) — remplace l'ancien principe DFS vertical (voir
 * services/canvas-idea-tree.ts) par un vrai layout d'arbre compact par
 * sous-arbres, inspiré des idées générales (calcul d'extent par sous-arbre,
 * centrage du parent, deux sens depuis la racine) qu'on retrouve dans des
 * outils de mindmap comme Mindvas — AUCUN code de Mindvas n'a été copié ni
 * adapté ligne à ligne ici : ce fichier est une implémentation originale de
 * ces concepts généraux, donc sans attribution/licence à ajouter.
 *
 * Entrée = structure (table enfants) + dimensions des nodes + ancre +
 * orientation. Sortie = nouvelles positions + côté (fromSide/toSide) de
 * chaque edge structurelle. Aucun accès DOM/runtime — ce module ne connaît
 * même pas l'existence de Canvas.
 *
 * UN SEUL moteur pour les deux orientations (jamais deux implémentations) :
 * tout le calcul travaille en coordonnées ABSTRAITES (main = axe de
 * profondeur, cross = axe de répartition des frères) puis convertit vers
 * x/y réels une seule fois, à l'écriture de chaque position — horizontal :
 * main=X/cross=Y (comportement historique, inchangé bit pour bit) ;
 * vertical : main=Y/cross=X. `direction` garde ses valeurs historiques
 * "left"/"right" (jamais renommées, aucun appelant/test existant cassé) ;
 * en orientation verticale, "right" vaut « vers le bas » et "left" « vers
 * le haut ». */

export type MindmapOrientation = "horizontal" | "vertical";
export type MindmapLayoutDimensions = { width: number; height: number };
export type MindmapLayoutSide = "left" | "right";
export type MindmapEdgeSide = "left" | "right" | "top" | "bottom";
export type MindmapLayoutOptions = {
  horizontalSpacing?: number;
  verticalSpacing?: number;
  defaultWidth?: number;
  defaultHeight?: number;
};

export type MindmapEdgeSides = { fromSide: MindmapEdgeSide; toSide: MindmapEdgeSide };
export type MindmapLayoutResult = {
  positions: Record<string, { x: number; y: number }>;
  /** Clé = `${parentId}->${childId}` — un appelant qui a l'id de l'edge la
   * retrouve via ses `fromNode`/`toNode`, jamais une hypothèse sur l'ordre
   * des edges dans `canvas.edges`. */
  edgeSides: Record<string, MindmapEdgeSides>;
};

const DEFAULTS = { horizontalSpacing: 80, verticalSpacing: 40, defaultWidth: 240, defaultHeight: 80 } as const;

function resolved(options: MindmapLayoutOptions | undefined) {
  return { ...DEFAULTS, ...options };
}

function dimensionOf(id: string, dimensions: Record<string, MindmapLayoutDimensions>, resolvedOptions: ReturnType<typeof resolved>): MindmapLayoutDimensions {
  return dimensions[id] || { width: resolvedOptions.defaultWidth, height: resolvedOptions.defaultHeight };
}

/** Taille de `dims` le long de l'axe PRINCIPAL (profondeur) — largeur en
 * horizontal, hauteur en vertical. */
function mainSize(dims: MindmapLayoutDimensions, orientation: MindmapOrientation): number {
  return orientation === "vertical" ? dims.height : dims.width;
}
/** Taille de `dims` le long de l'axe TRANSVERSE (répartition des frères) —
 * hauteur en horizontal, largeur en vertical. */
function crossSize(dims: MindmapLayoutDimensions, orientation: MindmapOrientation): number {
  return orientation === "vertical" ? dims.width : dims.height;
}
/** Convertit une position abstraite (bord de départ le long de l'axe
 * principal, bord de départ le long de l'axe transverse) en x/y réels. */
function toXY(mainStart: number, crossStart: number, orientation: MindmapOrientation): { x: number; y: number } {
  return orientation === "vertical" ? { x: crossStart, y: mainStart } : { x: mainStart, y: crossStart };
}
/** `"right"` vaut toujours « vers l'avant » (droite en horizontal, bas en
 * vertical) ; `"left"` vaut « vers l'arrière » (gauche en horizontal, haut
 * en vertical) — jamais deux moteurs, une seule règle de correspondance. */
function edgeSidesFor(direction: MindmapLayoutSide, orientation: MindmapOrientation): MindmapEdgeSides {
  if (orientation === "vertical") {
    return direction === "right" ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
  }
  return direction === "right" ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
}

function edgeKey(parentId: string, childId: string): string {
  return `${parentId}->${childId}`;
}

/** Espace transverse total occupé par le sous-arbre de `nodeId` (sa propre
 * taille transverse si feuille, sinon la somme des extents de ses enfants +
 * les espacements entre eux, jamais moins que sa propre taille transverse).
 * Mémoïsé : un même sous-arbre n'est calculé qu'une fois même s'il est
 * consulté plusieurs fois (parent centré sur ses enfants, potentiellement
 * profonds). */
function extentOf(
  nodeId: string,
  childrenOf: Record<string, string[] | undefined>,
  dimensions: Record<string, MindmapLayoutDimensions>,
  resolvedOptions: ReturnType<typeof resolved>,
  orientation: MindmapOrientation,
  memo: Map<string, number>
): number {
  const cached = memo.get(nodeId);
  if (cached !== undefined) return cached;
  const kids = childrenOf[nodeId] || [];
  const ownCross = crossSize(dimensionOf(nodeId, dimensions, resolvedOptions), orientation);
  let value: number;
  if (kids.length === 0) {
    value = ownCross;
  } else {
    const childrenTotal = kids.reduce((sum, childId) => sum + extentOf(childId, childrenOf, dimensions, resolvedOptions, orientation, memo), 0)
      + resolvedOptions.verticalSpacing * (kids.length - 1);
    value = Math.max(ownCross, childrenTotal);
  }
  memo.set(nodeId, value);
  return value;
}

/** Place `nodeId` (et tout son sous-arbre) dans le créneau transverse
 * [`crossTop`, `crossTop` + extent], au bord principal `edgeMain` — le bord
 * de DÉPART de `nodeId` le long de l'axe principal si `direction ===
 * "right"`, son bord opposé si `direction === "left"` (jamais une
 * profondeur fixe multipliée par un espacement générique : chaque niveau se
 * déduit de la TAILLE RÉELLE du niveau précédent, seule façon de garantir
 * qu'aucun niveau ne chevauche le suivant quelles que soient les tailles de
 * nodes). Retourne le centre transverse réellement occupé par `nodeId` (le
 * parent appelant s'en sert pour se centrer sur ses propres enfants). */
function placeSubtreeAt(
  nodeId: string,
  crossTop: number,
  edgeMain: number,
  direction: MindmapLayoutSide,
  orientation: MindmapOrientation,
  childrenOf: Record<string, string[] | undefined>,
  dimensions: Record<string, MindmapLayoutDimensions>,
  resolvedOptions: ReturnType<typeof resolved>,
  memo: Map<string, number>,
  positions: Record<string, { x: number; y: number }>,
  edgeSides: Record<string, MindmapEdgeSides>
): number {
  const dims = dimensionOf(nodeId, dimensions, resolvedOptions);
  const mainSizeVal = mainSize(dims, orientation);
  const crossSizeVal = crossSize(dims, orientation);
  const kids = childrenOf[nodeId] || [];
  const mainStart = direction === "right" ? edgeMain : edgeMain - mainSizeVal;

  if (kids.length === 0) {
    const crossCenter = crossTop + crossSizeVal / 2;
    positions[nodeId] = toXY(mainStart, crossCenter - crossSizeVal / 2, orientation);
    return crossCenter;
  }

  // Bord depuis lequel les ENFANTS de ce node partent — le bord OPPOSÉ à
  // `edgeMain` sur `nodeId`, décalé de l'espacement principal. Dépend
  // uniquement de la taille RÉELLE de `nodeId` le long de l'axe principal,
  // jamais d'une constante de profondeur : aucun chevauchement possible,
  // quelles que soient les tailles mélangées d'un niveau à l'autre.
  const childEdgeMain = direction === "right" ? mainStart + mainSizeVal + resolvedOptions.horizontalSpacing : mainStart - resolvedOptions.horizontalSpacing;

  let cursor = crossTop;
  let firstChildCenter = 0;
  let lastChildCenter = 0;
  kids.forEach((childId, index) => {
    const childCenter = placeSubtreeAt(childId, cursor, childEdgeMain, direction, orientation, childrenOf, dimensions, resolvedOptions, memo, positions, edgeSides);
    if (index === 0) firstChildCenter = childCenter;
    lastChildCenter = childCenter;
    cursor += extentOf(childId, childrenOf, dimensions, resolvedOptions, orientation, memo) + resolvedOptions.verticalSpacing;
    edgeSides[edgeKey(nodeId, childId)] = edgeSidesFor(direction, orientation);
  });
  const crossCenter = (firstChildCenter + lastChildCenter) / 2;
  positions[nodeId] = toXY(mainStart, crossCenter - crossSizeVal / 2, orientation);
  return crossCenter;
}

/** Layout d'UNE branche (racine locale `rootId` incluse) entièrement dans
 * `direction` depuis `anchor` — utilisé pour reparenter/déplacer une
 * branche sans jamais recalculer le reste de l'arbre (§8 du correctif
 * Prompt 2/5). `anchor` place `rootId` lui-même (son centre, X et Y) quel
 * que soit `direction` — cohérent avec `computeMindmapTreeLayout`, où la
 * racine n'est jamais décalée par la logique gauche/droite (ou haut/bas). */
export function computeMindmapBranchLayout(
  childrenOf: Record<string, string[] | undefined>,
  rootId: string,
  dimensions: Record<string, MindmapLayoutDimensions>,
  anchor: { x: number; y: number },
  direction: MindmapLayoutSide,
  orientation: MindmapOrientation = "horizontal",
  options?: MindmapLayoutOptions
): MindmapLayoutResult {
  const resolvedOptions = resolved(options);
  const memo = new Map<string, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  const edgeSides: Record<string, MindmapEdgeSides> = {};
  const rootDims = dimensionOf(rootId, dimensions, resolvedOptions);
  const anchorMain = orientation === "vertical" ? anchor.y : anchor.x;
  const anchorCross = orientation === "vertical" ? anchor.x : anchor.y;
  const rootMainSize = mainSize(rootDims, orientation);
  const rootCrossSize = crossSize(rootDims, orientation);
  // `anchor` est le CENTRE (X et Y) souhaité pour la racine locale — jamais
  // son bord — quel que soit `direction` : seuls SES ENFANTS partent dans
  // ce sens. Comme `placeSubtreeAt`, la racine se centre sur ses enfants
  // (premier/dernier centre transverse), jamais l'inverse — repli sur le
  // centre de son propre extent uniquement si elle n'a aucun enfant.
  const extent = extentOf(rootId, childrenOf, dimensions, resolvedOptions, orientation, memo);
  const crossTop = anchorCross - extent / 2;
  const kids = childrenOf[rootId] || [];
  const rootMainStart = anchorMain - rootMainSize / 2;
  const rootMainEnd = anchorMain + rootMainSize / 2;

  let rootCrossCenter = crossTop + extent / 2;
  if (kids.length > 0) {
    const childEdgeMain = direction === "right" ? rootMainEnd + resolvedOptions.horizontalSpacing : rootMainStart - resolvedOptions.horizontalSpacing;
    let cursor = crossTop;
    let firstChildCenter = 0;
    let lastChildCenter = 0;
    kids.forEach((childId, index) => {
      const childCenter = placeSubtreeAt(childId, cursor, childEdgeMain, direction, orientation, childrenOf, dimensions, resolvedOptions, memo, positions, edgeSides);
      if (index === 0) firstChildCenter = childCenter;
      lastChildCenter = childCenter;
      cursor += extentOf(childId, childrenOf, dimensions, resolvedOptions, orientation, memo) + resolvedOptions.verticalSpacing;
      edgeSides[edgeKey(rootId, childId)] = edgeSidesFor(direction, orientation);
    });
    rootCrossCenter = (firstChildCenter + lastChildCenter) / 2;
  }
  positions[rootId] = toXY(rootMainStart, rootCrossCenter - rootCrossSize / 2, orientation);
  return { positions, edgeSides };
}

/** Layout complet d'une Mindmap depuis sa VRAIE racine : ses enfants
 * directs sont répartis en deux groupes équilibrés (avant/arrière, ordre
 * pair/impair sur l'ordre STRUCTUREL des enfants — jamais dépendant de la
 * géométrie existante, voir model.ts) et chaque groupe est empilé
 * indépendamment, centré sur l'axe transverse de la racine. La racine
 * elle-même reste fixe à `anchor` (X et Y). */
export function computeMindmapTreeLayout(
  childrenOf: Record<string, string[] | undefined>,
  rootId: string,
  dimensions: Record<string, MindmapLayoutDimensions>,
  anchor: { x: number; y: number },
  orientation: MindmapOrientation = "horizontal",
  options?: MindmapLayoutOptions
): MindmapLayoutResult {
  const resolvedOptions = resolved(options);
  const memo = new Map<string, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  const edgeSides: Record<string, MindmapEdgeSides> = {};

  const rootDims = dimensionOf(rootId, dimensions, resolvedOptions);
  const anchorMain = orientation === "vertical" ? anchor.y : anchor.x;
  const anchorCross = orientation === "vertical" ? anchor.x : anchor.y;
  const rootMainSize = mainSize(rootDims, orientation);
  const rootCrossSize = crossSize(rootDims, orientation);
  const kids = childrenOf[rootId] || [];
  const rightKids = kids.filter((_, index) => index % 2 === 0);
  const leftKids = kids.filter((_, index) => index % 2 === 1);

  const layoutSide = (sideKids: string[], direction: MindmapLayoutSide, edgeMain: number): void => {
    if (sideKids.length === 0) return;
    const extents = sideKids.map((childId) => extentOf(childId, childrenOf, dimensions, resolvedOptions, orientation, memo));
    const total = extents.reduce((sum, value) => sum + value, 0) + resolvedOptions.verticalSpacing * (sideKids.length - 1);
    let cursor = anchorCross - total / 2;
    sideKids.forEach((childId, index) => {
      placeSubtreeAt(childId, cursor, edgeMain, direction, orientation, childrenOf, dimensions, resolvedOptions, memo, positions, edgeSides);
      cursor += extents[index] + resolvedOptions.verticalSpacing;
      edgeSides[edgeKey(rootId, childId)] = edgeSidesFor(direction, orientation);
    });
  };

  const rootMainStart = anchorMain - rootMainSize / 2;
  const rootMainEnd = anchorMain + rootMainSize / 2;
  layoutSide(rightKids, "right", rootMainEnd + resolvedOptions.horizontalSpacing);
  layoutSide(leftKids, "left", rootMainStart - resolvedOptions.horizontalSpacing);

  positions[rootId] = toXY(rootMainStart, anchorCross - rootCrossSize / 2, orientation);
  return { positions, edgeSides };
}
