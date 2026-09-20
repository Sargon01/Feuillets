/* Purely visual reordering of Research spaces and folders — never a Vault
 * move, never a Binder/compile concern. Deliberately kept separate from
 * `settings.orders` (Binder sibling order, consumed by getOrderedChildren
 * in services/folder-structure.ts and by compile-export.ts): that field is
 * keyed by real folder paths too and is read/written by moveNode() and the
 * compiler, so writing Research order into it would risk bleeding into the
 * manuscript tree the moment a Research folder path ever collided with a
 * Binder one. `settings.researchOrder` (src/types.d.ts, src/default-
 * settings.ts) is a dedicated map instead: entirely separate storage, never
 * read by any Binder/compile code path.
 *
 * Order is stored PER PARENT: `researchOrder[parentKey]` is the ordered list
 * of child keys under that parent. `parentKey`/child keys are plain strings
 * chosen by the caller (a real Vault folder path for actual folder children,
 * or a synthetic key for a virtual grouping such as the top-level list of
 * Research spaces) — this module never inspects or validates them. */

export type ResearchOrderMap = Record<string, string[]>;

/** Native drag MIME reserved for Research space/folder reordering — distinct
 * from FEUILLETS_FILE_DRAG_MIME (carnet/canvas/adapter.js) and from the
 * existing internal-move mechanism's private state (`_researchDragPath`,
 * base-feuillets-view.ts), so a reorder drag can never be misread as a
 * request to move a file/folder into another folder, and vice versa. The
 * authoritative drag state is still the dedicated `_researchOrderDrag`
 * plugin field (mirroring `_researchDragPath`'s own pattern): this MIME is
 * set on dataTransfer too, only so the browser recognizes a real drag
 * payload is present. */
export const RESEARCH_ORDER_DRAG_MIME = "application/x-feuillets-research-order";

/** Returns `items` sorted per the order recorded for `parentKey`: items
 * whose key was recorded come first, in that recorded relative order; every
 * other item (never recorded — a new folder, or one whose key changed)
 * keeps its original relative position and is appended after them. With no
 * recorded order at all (`parentKey` absent, or an empty list), `items` is
 * returned unchanged — so the result stays deterministic as long as the
 * caller already hands `items` in a stable base order (e.g. alphabetical),
 * which every call site in base-feuillets-view.ts does. */
export function applyResearchOrder<T>(
  parentKey: string,
  items: readonly T[],
  keyOf: (item: T) => string,
  order: ResearchOrderMap
): T[] {
  const recorded = order[parentKey];
  if (!recorded || recorded.length === 0) return [...items];
  const rank = new Map(recorded.map((key, index) => [key, index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(keyOf(item)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/** Pure reorder of a flat sibling key list: moves `sourceKey` to just
 * before/after `targetKey`. A no-op (returns an equal-valued copy) when
 * `sourceKey === targetKey` (dropping an item on itself), or when either key
 * is absent from `currentKeys` (a stale drag payload from a since-removed
 * sibling). The caller persists the full returned list under the relevant
 * `parentKey` — reordering always rewrites the whole sibling order, which is
 * what lets a never-recorded new sibling fall back to the end deterministically
 * the next time `applyResearchOrder` runs. */
export function reorderResearchKeys(
  currentKeys: readonly string[],
  sourceKey: string,
  targetKey: string,
  position: "before" | "after"
): string[] {
  if (sourceKey === targetKey) return [...currentKeys];
  if (!currentKeys.includes(sourceKey) || !currentKeys.includes(targetKey)) return [...currentKeys];
  const withoutSource = currentKeys.filter((key) => key !== sourceKey);
  const targetIndex = withoutSource.indexOf(targetKey);
  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  withoutSource.splice(insertIndex, 0, sourceKey);
  return withoutSource;
}
