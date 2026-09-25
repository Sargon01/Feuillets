import test from "node:test";
import assert from "node:assert/strict";
import { resolveFloatingPosition, intersectFloatingBounds, resolveFloatingAvailableSize } from "../src/utils/floating-position.js";

const BOUNDS = { left: 0, top: 0, right: 1200, bottom: 800 };

test("resolveFloatingPosition: plenty of room above and to the right stays aligned with the anchor, above it", () => {
  const anchor = { top: 400, bottom: 420, left: 100, right: 200 };
  const size = { width: 300, height: 150 };
  const result = resolveFloatingPosition(anchor, size, BOUNDS);
  assert.equal(result.placement, "above");
  assert.equal(result.left, 100);
  assert.equal(result.top, 400 - 6 - 150);
});

test("resolveFloatingPosition: overflowing the right edge shifts left, never the reverse", () => {
  const anchor = { top: 400, bottom: 420, left: 1100, right: 1150 };
  const size = { width: 300, height: 150 };
  const result = resolveFloatingPosition(anchor, size, BOUNDS);
  assert.equal(result.left, BOUNDS.right - size.width - 12, "clamped to the 12px margin from the right edge");
  assert.ok(result.left + size.width <= BOUNDS.right - 12);
});

test("resolveFloatingPosition: an anchor near the left edge is clamped to the 12px margin, never negative", () => {
  const anchor = { top: 400, bottom: 420, left: -50, right: 20 };
  const size = { width: 300, height: 150 };
  const result = resolveFloatingPosition(anchor, size, BOUNDS);
  assert.equal(result.left, 12);
});

test("resolveFloatingPosition: no room above flips the tooltip below the anchor", () => {
  const anchor = { top: 20, bottom: 40, left: 100, right: 200 };
  const size = { width: 300, height: 150 };
  const result = resolveFloatingPosition(anchor, size, BOUNDS);
  assert.equal(result.placement, "below");
  assert.equal(result.top, 40 + 6);
});

test("resolveFloatingPosition: below also clamped when it would overflow the bottom edge", () => {
  const anchor = { top: 10, bottom: 20, left: 100, right: 200 };
  const size = { width: 300, height: 900 }; // taller than the bounds themselves
  const result = resolveFloatingPosition(anchor, size, BOUNDS);
  assert.equal(result.placement, "below");
  assert.equal(result.top, 12, "clamped to the top margin as a last resort — never past the bounds");
});

test("resolveFloatingPosition: exactly enough room above (no gap left) still counts as fitting", () => {
  const gap = 6;
  const margin = 12;
  const size = { width: 100, height: 100 };
  const anchor = { top: margin + gap + size.height, bottom: margin + gap + size.height + 20, left: 50, right: 150 };
  const result = resolveFloatingPosition(anchor, size, BOUNDS);
  assert.equal(result.placement, "above");
  assert.equal(result.top, margin);
});

test("resolveFloatingPosition: custom margin and gap are honored", () => {
  const anchor = { top: 400, bottom: 420, left: 1190, right: 1200 };
  const size = { width: 100, height: 50 };
  const result = resolveFloatingPosition(anchor, size, BOUNDS, { margin: 24, gap: 10 });
  assert.equal(result.left, BOUNDS.right - size.width - 24);
  assert.equal(result.top, 400 - 10 - 50);
});

test("resolveFloatingPosition: pure function — repeated calls with the same input return the same output", () => {
  const anchor = { top: 200, bottom: 220, left: 300, right: 400 };
  const size = { width: 250, height: 120 };
  const a = resolveFloatingPosition(anchor, size, BOUNDS);
  const b = resolveFloatingPosition(anchor, size, BOUNDS);
  assert.deepEqual(a, b);
});

/* ------------------------------------------------------------------ *
 * Bounds NOT anchored at the origin — a host panel's own rect, offset
 * within a wider browser window (e.g. a side-by-side split, or a right
 * sidebar occupying the rest of the window).
 * ------------------------------------------------------------------ */

test("resolveFloatingPosition: bounds offset within a wider window — never clamps to the WINDOW's edges, only the bounds'", () => {
  // A host panel occupying [300, 900] horizontally inside a 1600px window.
  const panelBounds = { left: 300, top: 0, right: 900, bottom: 800 };
  const anchor = { top: 400, bottom: 420, left: 850, right: 890 }; // near the panel's own right edge
  const size = { width: 300, height: 100 };
  const result = resolveFloatingPosition(anchor, size, panelBounds);
  assert.equal(result.left, panelBounds.right - size.width - 12, "clamped to the PANEL's right edge, not the window's");
  assert.ok(result.left + size.width <= panelBounds.right, "never crosses into whatever sits to the right of the panel");
});

test("resolveFloatingPosition: bounds offset within a wider window — left clamp respects the panel's own left edge", () => {
  const panelBounds = { left: 300, top: 0, right: 900, bottom: 800 };
  const anchor = { top: 400, bottom: 420, left: 310, right: 350 };
  const size = { width: 300, height: 100 };
  const result = resolveFloatingPosition(anchor, size, panelBounds);
  assert.equal(result.left, panelBounds.left + 12);
});

test("intersectFloatingBounds: the narrower of two overlapping rects wins on every edge", () => {
  const viewport = { left: 0, top: 0, right: 1600, bottom: 900 };
  const panel = { left: 300, top: 40, right: 900, bottom: 800 };
  assert.deepEqual(intersectFloatingBounds(viewport, panel), { left: 300, top: 40, right: 900, bottom: 800 });
});

test("intersectFloatingBounds: a panel partially off-screen is clipped to the viewport", () => {
  const viewport = { left: 0, top: 0, right: 1200, bottom: 800 };
  const panel = { left: -100, top: -50, right: 500, bottom: 900 };
  assert.deepEqual(intersectFloatingBounds(viewport, panel), { left: 0, top: 0, right: 500, bottom: 800 });
});

test("intersectFloatingBounds: commutative — order of arguments never changes the result", () => {
  const a = { left: 0, top: 0, right: 1200, bottom: 800 };
  const b = { left: 300, top: 40, right: 900, bottom: 800 };
  assert.deepEqual(intersectFloatingBounds(a, b), intersectFloatingBounds(b, a));
});

/* ------------------------------------------------------------------ *
 * resolveFloatingAvailableSize — the space left for a floating element's
 * OWN size, margin subtracted, before it is ever measured/positioned.
 * ------------------------------------------------------------------ */

test("resolveFloatingAvailableSize: subtracts the 12px margin from every edge", () => {
  const bounds = { left: 0, top: 0, right: 1200, bottom: 800 };
  assert.deepEqual(resolveFloatingAvailableSize(bounds), { width: 1200 - 24, height: 800 - 24 });
});

test("resolveFloatingAvailableSize: works for bounds not anchored at the origin", () => {
  const bounds = { left: 300, top: 40, right: 900, bottom: 800 };
  assert.deepEqual(resolveFloatingAvailableSize(bounds), { width: 600 - 24, height: 760 - 24 });
});

test("resolveFloatingAvailableSize: a panel narrower/shorter than 2x margin floors at 0, never negative", () => {
  const bounds = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.deepEqual(resolveFloatingAvailableSize(bounds), { width: 0, height: 0 });
});

test("resolveFloatingAvailableSize: a custom margin is honored", () => {
  const bounds = { left: 0, top: 0, right: 1200, bottom: 800 };
  assert.deepEqual(resolveFloatingAvailableSize(bounds, { margin: 24 }), { width: 1200 - 48, height: 800 - 48 });
});
