/**
 * Pure, collision-aware positioning for a floating element anchored to
 * another element — no DOM access, no Obsidian dependency, so it is testable
 * with plain numbers and reusable by any floating UI in this plugin (the
 * citation tooltip today; the ad hoc clamps already duplicated in
 * src/ui/annotation-popover.ts and src/ui/native-review-thread-popover.ts are
 * candidates to migrate onto this later, out of scope here).
 *
 * Contract: given the anchor's rect, the floating element's OWN measured
 * size, and a bounding rect, returns a `{ left, top }` in the SAME
 * coordinate space as both rects (viewport coordinates when they came from
 * `getBoundingClientRect()`, which is what every caller uses) that keeps the
 * floating element entirely within `bounds` shrunk by `margin` on every
 * edge, preferring to sit ABOVE the anchor and falling back to BELOW only
 * when there is not enough room above.
 *
 * `bounds` is deliberately an arbitrary rect (never assumed to start at the
 * origin): a caller anchored to one host panel among several — the citation
 * tooltip intersects the browser viewport with its host panel's OWN rect
 * (see intersectFloatingBounds() below) — must never let the floating
 * element drift into a neighboring panel just because that neighbor is
 * still within the browser window.
 */

export interface FloatingAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

/** An arbitrary rectangle a floating element must stay within — NOT assumed
 * to start at (0, 0). Structurally compatible with a real DOMRect, so a
 * caller can pass `element.getBoundingClientRect()` directly. */
export interface FloatingBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type FloatingPlacement = "above" | "below";

export interface FloatingPositionResult {
  left: number;
  top: number;
  placement: FloatingPlacement;
}

export interface FloatingPositionOptions {
  /** Minimum distance kept from every edge of `bounds`. Default 12. */
  margin?: number;
  /** Gap between the anchor and the floating element. Default 6 — the same
   * value the citation tooltip's CSS used as a static `bottom: calc(100% +
   * 6px)` before this module took over positioning. */
  gap?: number;
}

const DEFAULT_MARGIN = 12;
const DEFAULT_GAP = 6;

/**
 * Resolves the floating element's position. Horizontal: starts aligned with
 * the anchor's left edge, then clamped so the floating element never crosses
 * either edge of `bounds` (closer to the right edge shifts it left, never
 * the reverse). Vertical: placed above the anchor unless that would not fit
 * within `margin` of `bounds`'s top edge, in which case it flips below the
 * anchor — clamped as a last resort for bounds too small to fit either
 * placement cleanly.
 */
export function resolveFloatingPosition(
  anchor: FloatingAnchorRect,
  size: FloatingSize,
  bounds: FloatingBounds,
  options: FloatingPositionOptions = {}
): FloatingPositionResult {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const gap = options.gap ?? DEFAULT_GAP;

  const minLeft = bounds.left + margin;
  const maxLeft = bounds.right - size.width - margin;
  let left = anchor.left;
  if (left > maxLeft) left = maxLeft;
  if (left < minLeft) left = minLeft;

  const spaceAbove = anchor.top - gap - (bounds.top + margin);
  const placement: FloatingPlacement = size.height <= spaceAbove ? "above" : "below";

  const minTop = bounds.top + margin;
  let top: number;
  if (placement === "above") {
    top = anchor.top - gap - size.height;
  } else {
    top = anchor.bottom + gap;
    const maxTop = bounds.bottom - size.height - margin;
    if (top > maxTop) top = maxTop;
  }
  if (top < minTop) top = minTop;

  return { left, top, placement };
}

export interface FloatingAvailableSize {
  width: number;
  height: number;
}

/**
 * The space actually available for a floating element inside `bounds`,
 * `margin` already subtracted from every edge — what a caller must clamp the
 * floating element's OWN natural size to (e.g. inline `max-width`/
 * `max-height`) and re-measure BEFORE calling resolveFloatingPosition().
 * Positioning alone cannot fix an element whose natural size exceeds its
 * bounds: resolveFloatingPosition() can only slide it within the space that
 * exists, never shrink it, so an oversized element still overflows unless
 * its size was constrained first. Never negative — floors at 0 for bounds
 * narrower/shorter than 2×margin.
 */
export function resolveFloatingAvailableSize(
  bounds: FloatingBounds,
  options: FloatingPositionOptions = {}
): FloatingAvailableSize {
  const margin = options.margin ?? DEFAULT_MARGIN;
  return {
    width: Math.max(0, bounds.right - bounds.left - margin * 2),
    height: Math.max(0, bounds.bottom - bounds.top - margin * 2),
  };
}

/**
 * The overlapping region of two bounds — used to combine the browser
 * viewport with a host panel's own rect (see this module's doc comment),
 * so `resolveFloatingPosition()` never lets the tooltip drift into a
 * neighboring panel that happens to still be within the browser window.
 * Can produce a degenerate (right < left, or bottom < top) rect when the two
 * inputs do not overlap at all — resolveFloatingPosition() still returns
 * finite numbers for it (pure arithmetic, never throws), even though the
 * result is not visually meaningful in that case.
 */
export function intersectFloatingBounds(a: FloatingBounds, b: FloatingBounds): FloatingBounds {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}
