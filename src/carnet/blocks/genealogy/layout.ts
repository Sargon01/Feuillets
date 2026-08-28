/** Layout PUR et déterministe du bloc Généalogie (Prompt 4, §7).
 *
 * Verticale, par génération (0 en haut, croissant vers le bas) :
 *   - un parent est TOUJOURS au-dessus de son enfant ;
 *   - des conjoints partagent TOUJOURS la même génération, placés côte à
 *     côte (une seule « unité » horizontale) ;
 *   - les enfants sont placés sous leur parent/couple ;
 *   - la fratrie (même parent) reste groupée ;
 *   - les composants déconnectés sont placés côte à côte, jamais superposés ;
 *   - le résultat est déterministe : seuls les ids (triés) et la structure
 *     du graphe influencent la position, jamais l'ordre d'insertion.
 *
 * Aucune E/S, aucune dépendance — reçoit des tables déjà construites par
 * genealogy.ts (childrenMap, spouseGroups) depuis le CanvasData réel. */

export type GenealogyLayoutDimensions = { width: number; height: number };
export type GenealogyLayoutPosition = { x: number; y: number };
export type GenealogyLayoutResult = { positions: Record<string, GenealogyLayoutPosition> };
export type GenealogyLayoutUnion = { id: string; members: [string, string] };

/** Positionne une jonction à partir des positions MANUELLES courantes des
 * deux cartes. Cette opération ne déplace jamais les cartes elles-mêmes. */
export function computeGenealogyUnionPosition(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
): GenealogyLayoutPosition {
  const firstCenterX = first.x + first.width / 2;
  const secondCenterX = second.x + second.width / 2;
  const firstCenterY = first.y + first.height / 2;
  const secondCenterY = second.y + second.height / 2;
  return {
    x: (firstCenterX + secondCenterX) / 2 - 4,
    y: (firstCenterY + secondCenterY) / 2 - 4,
  };
}

const DEFAULT_DIMENSIONS: GenealogyLayoutDimensions = { width: 240, height: 80 };
const SPOUSE_GAP = 24;
const SIBLING_GAP = 48;
const GENERATION_GAP = 80;
const COMPONENT_GAP = 120;

/** Union-find minimal, local à ce module — regroupe les membres reliés par
 * n'importe quelle relation (parent-enfant OU conjoint) en composants
 * CONNEXES, pour les placer côte à côte sans jamais les entremêler. */
function connectedComponents(memberIds: string[], childrenMap: Map<string, string[]>, spouseGroups: string[][]): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const id of memberIds) parent.set(id, id);
  for (const [parentId, children] of childrenMap) {
    if (!parent.has(parentId)) continue;
    for (const childId of children) { if (parent.has(childId)) union(parentId, childId); }
  }
  for (const group of spouseGroups) {
    for (let i = 1; i < group.length; i += 1) union(group[0], group[i]);
  }
  const components = new Map<string, string[]>();
  for (const id of memberIds) {
    const root = find(id);
    const list = components.get(root) || [];
    list.push(id);
    components.set(root, list);
  }
  // Composants ordonnés par leur plus petit id — déterministe, jamais par
  // ordre de découverte (qui dépend de l'ordre de `memberIds`).
  return [...components.values()]
    .map((list) => [...list].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Génération de chaque membre — point fixe borné (au plus `N` passes,
 * `N` = nombre de membres) : chaque passe ne peut QU'augmenter une valeur,
 * jamais la diminuer, donc convergence garantie sans boucle infinie. */
function computeGenerations(memberIds: string[], childrenMap: Map<string, string[]>, spouseGroups: string[][]): Map<string, number> {
  const generation = new Map<string, number>();
  for (const id of memberIds) generation.set(id, 0);
  const parentIds = [...childrenMap.keys()].sort();
  const maxIterations = memberIds.length + 1;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;
    for (const parentId of parentIds) {
      const parentGen = generation.get(parentId) ?? 0;
      for (const childId of childrenMap.get(parentId) || []) {
        if (!generation.has(childId)) continue;
        const required = parentGen + 1;
        if ((generation.get(childId) ?? 0) < required) { generation.set(childId, required); changed = true; }
      }
    }
    for (const group of spouseGroups) {
      const groupGen = Math.max(...group.map((id) => generation.get(id) ?? 0));
      for (const id of group) {
        if ((generation.get(id) ?? 0) !== groupGen) { generation.set(id, groupGen); changed = true; }
      }
    }
    if (!changed) break;
  }
  return generation;
}

type Unit = { members: string[]; generation: number };

/** Une « unité » horizontale = un groupe de conjoints (placés ensemble) ou
 * un individu seul. Chaque membre appartient à EXACTEMENT une unité. */
function buildUnits(memberIds: string[], generation: Map<string, number>, spouseGroups: string[][]): Unit[] {
  const grouped = new Set<string>();
  const units: Unit[] = [];
  for (const group of spouseGroups) {
    units.push({ members: group, generation: generation.get(group[0]) ?? 0 });
    for (const id of group) grouped.add(id);
  }
  for (const id of [...memberIds].sort()) {
    if (grouped.has(id)) continue;
    units.push({ members: [id], generation: generation.get(id) ?? 0 });
  }
  return units;
}

function unitKey(unit: Unit): string {
  return unit.members.join(",");
}

/** Layout complet — `dimensions` couvre TOUS les membres (fallback interne
 * sinon), `childrenMap`/`spouseGroups` déjà restreints au bloc/composant. */
export function computeGenealogyLayout(
  memberIds: string[],
  childrenMap: Map<string, string[]>,
  spouseGroups: string[][],
  dimensions: Record<string, GenealogyLayoutDimensions>,
  anchor: { x: number; y: number },
  unions: GenealogyLayoutUnion[] = []
): GenealogyLayoutResult {
  const positions: Record<string, GenealogyLayoutPosition> = {};
  if (memberIds.length === 0) return { positions };
  const dimOf = (id: string): GenealogyLayoutDimensions => dimensions[id] || DEFAULT_DIMENSIONS;

  const components = connectedComponents(memberIds, childrenMap, spouseGroups);
  let componentOffsetX = 0;

  for (const component of components) {
    const componentSet = new Set(component);
    const localChildren = new Map<string, string[]>();
    for (const id of component) {
      const kids = (childrenMap.get(id) || []).filter((childId) => componentSet.has(childId));
      if (kids.length > 0) localChildren.set(id, kids);
    }
    const localSpouseGroups = spouseGroups
      .map((group) => group.filter((id) => componentSet.has(id)))
      .filter((group) => group.length > 1);

    const generation = computeGenerations(component, localChildren, localSpouseGroups);
    const units = buildUnits(component, generation, localSpouseGroups);
    const unitOf = new Map<string, Unit>();
    for (const unit of units) for (const id of unit.members) unitOf.set(id, unit);

    const byGeneration = new Map<number, Unit[]>();
    for (const unit of units) {
      const list = byGeneration.get(unit.generation) || [];
      list.push(unit);
      byGeneration.set(unit.generation, list);
    }
    const generations = [...byGeneration.keys()].sort((a, b) => a - b);

    const unitWidth = (unit: Unit): number =>
      unit.members.reduce((sum, id) => sum + dimOf(id).width, 0) + SPOUSE_GAP * Math.max(0, unit.members.length - 1);
    const unitHeight = (unit: Unit): number => Math.max(...unit.members.map((id) => dimOf(id).height));

    const localCenterX = new Map<string, number>(); // unitKey -> center X (local, sans offset composant)
    let cursorY = 0;
    let componentWidth = 0;

    for (const generationIndex of generations) {
      const rowUnits = byGeneration.get(generationIndex) as Unit[];
      // Tri déterministe : par X cible (moyenne des unités parentes déjà
      // posées), puis par ids triés en repli — regroupe naturellement la
      // fratrie (même parent ⇒ même X cible) sans jamais dépendre de
      // l'ordre d'insertion des edges.
      const targetX = (unit: Unit): number => {
        const parentUnitKeys = new Set<string>();
        for (const id of unit.members) {
          for (const [parentId, kids] of localChildren) {
            if (kids.includes(id)) {
              const parentUnit = unitOf.get(parentId);
              if (parentUnit) parentUnitKeys.add(unitKey(parentUnit));
            }
          }
        }
        const centers = [...parentUnitKeys].map((key) => localCenterX.get(key)).filter((value): value is number => value !== undefined);
        if (centers.length === 0) return Number.POSITIVE_INFINITY; // pas de parent placé : repoussé après la fratrie ancrée
        return centers.reduce((sum, value) => sum + value, 0) / centers.length;
      };
      const sorted = [...rowUnits].sort((a, b) => {
        const ta = targetX(a);
        const tb = targetX(b);
        if (ta !== tb) return ta - tb;
        return unitKey(a) < unitKey(b) ? -1 : unitKey(a) > unitKey(b) ? 1 : 0;
      });

      let cursorX = 0;
      const rowHeight = Math.max(0, ...rowUnits.map((unit) => unitHeight(unit)));
      for (const unit of sorted) {
        const width = unitWidth(unit);
        const desired = targetX(unit);
        const left = Number.isFinite(desired) ? Math.max(cursorX, desired - width / 2) : cursorX;
        let memberX = left;
        for (const id of unit.members) {
          const dim = dimOf(id);
          positions[id] = { x: memberX, y: cursorY };
          memberX += dim.width + SPOUSE_GAP;
        }
        localCenterX.set(unitKey(unit), left + width / 2);
        cursorX = left + width + SIBLING_GAP;
        componentWidth = Math.max(componentWidth, left + width);
      }
      cursorY += rowHeight + GENERATION_GAP;
    }

    for (const id of component) {
      const position = positions[id];
      if (position) position.x += componentOffsetX;
    }
    componentOffsetX += componentWidth + COMPONENT_GAP;
  }

  // Recentre l'ensemble sur `anchor` (le rectangle englobant devient centré
  // dessus), jamais une position absolue arbitraire.
  const xs = Object.values(positions).map((p) => p.x);
  const ys = Object.values(positions).map((p) => p.y);
  if (xs.length > 0) {
    const spanRight = Math.max(...memberIds.map((id) => (positions[id]?.x ?? 0) + dimOf(id).width));
    const spanLeft = Math.min(...xs);
    const spanBottom = Math.max(...memberIds.map((id) => (positions[id]?.y ?? 0) + dimOf(id).height));
    const spanTop = Math.min(...ys);
    const shiftX = anchor.x - (spanLeft + spanRight) / 2;
    const shiftY = anchor.y - (spanTop + spanBottom) / 2;
    for (const id of Object.keys(positions)) { positions[id].x += shiftX; positions[id].y += shiftY; }
  }

  /* Les jonctions sont des éléments techniques : elles suivent le milieu
   * exact du couple après recentrage, sans influencer la largeur/hauteur du
   * layout des fiches. */
  for (const union of unions) {
    const first = positions[union.members[0]];
    const second = positions[union.members[1]];
    if (!first || !second) continue;
    const firstDim = dimOf(union.members[0]);
    const secondDim = dimOf(union.members[1]);
    const centerX = (first.x + firstDim.width / 2 + second.x + secondDim.width / 2) / 2;
    const centerY = (first.y + firstDim.height / 2 + second.y + secondDim.height / 2) / 2;
    positions[union.id] = { x: centerX - 4, y: centerY - 4 };
  }

  return { positions };
}
