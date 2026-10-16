export interface CrossEditorSelection { ranges: readonly { from: number; to: number }[] }

/** Uses half-open ranges: a cursor at the end is outside, and adjacent selections do not overlap. */
export function selectionOverlaps(selection: CrossEditorSelection, from: number, to: number): boolean {
  if (!selection?.ranges || from >= to) return false;
  for (const range of selection.ranges) {
    const selFrom = Math.min(range.from, range.to);
    const selTo = Math.max(range.from, range.to);
    if (selFrom === selTo) {
      if (selFrom >= from && selFrom < to) return true;
    } else {
      if (selFrom < to && selTo > from) return true;
    }
  }
  return false;
}
