/** Layout PUR et déterministe du bloc Relations (Prompt 4, §4/§7).
 *
 * Relations n'a aucune hiérarchie — un cercle centré sur `anchor` place
 * chaque membre à distance égale des autres, lisible pour un graphe libre
 * (contrairement à une grille, qui casserait les croisements d'edges pour
 * rien). Déterministe : l'ordre d'entrée de `memberIds` n'influence jamais
 * le résultat, seul l'id (trié) le fait — un même bloc rend toujours la
 * même disposition pour « Réorganiser ». Aucune E/S, aucune dépendance. */

export type RelationsLayoutDimensions = { width: number; height: number };
export type RelationsLayoutPosition = { x: number; y: number };
export type RelationsLayoutResult = { positions: Record<string, RelationsLayoutPosition> };

const DEFAULT_DIMENSIONS: RelationsLayoutDimensions = { width: 240, height: 80 };
const RADIUS_GAP = 40;

export function computeRelationsLayout(
  memberIds: string[],
  dimensions: Record<string, RelationsLayoutDimensions>,
  anchor: { x: number; y: number }
): RelationsLayoutResult {
  // Ordre trié par id : jamais l'ordre d'insertion dans `canvas.nodes`,
  // qui peut varier (création, refresh, drag) sans que la structure change.
  const ordered = [...memberIds].sort();
  const positions: Record<string, RelationsLayoutPosition> = {};
  const dimOf = (id: string): RelationsLayoutDimensions => dimensions[id] || DEFAULT_DIMENSIONS;

  if (ordered.length === 0) return { positions };
  if (ordered.length === 1) {
    const dim = dimOf(ordered[0]);
    positions[ordered[0]] = { x: anchor.x - dim.width / 2, y: anchor.y - dim.height / 2 };
    return { positions };
  }

  const maxSpan = Math.max(...ordered.map((id) => Math.max(dimOf(id).width, dimOf(id).height)));
  // Rayon assez grand pour que deux membres consécutifs ne se chevauchent
  // jamais : la circonférence doit contenir N largeurs max + N interstices.
  const radius = Math.max(maxSpan, ((maxSpan + RADIUS_GAP) * ordered.length) / (2 * Math.PI));

  ordered.forEach((id, index) => {
    const dim = dimOf(id);
    // -π/2 : le premier membre (trié) démarre en haut du cercle, jamais à
    // droite — orientation stable et lisible, sans incidence sur le
    // caractère déterministe (juste un choix de convention).
    const angle = (2 * Math.PI * index) / ordered.length - Math.PI / 2;
    const centerX = anchor.x + radius * Math.cos(angle);
    const centerY = anchor.y + radius * Math.sin(angle);
    positions[id] = { x: centerX - dim.width / 2, y: centerY - dim.height / 2 };
  });

  return { positions };
}
