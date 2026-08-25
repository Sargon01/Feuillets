import test from "node:test";
import assert from "node:assert/strict";
import { createSourceAnchor, resolveSourceAnchor, refreshSourceAnchor } from "../src/services/source-anchor.js";

test("source anchor: create validates range and captures bounded context", () => {
  const content = "x".repeat(100) + "quote" + "y".repeat(100);
  const anchor = createSourceAnchor(content, 100, 105);
  assert.deepEqual(anchor, { start: 100, end: 105, quote: "quote", prefix: "x".repeat(64), suffix: "y".repeat(64) });
  assert.equal(createSourceAnchor(content, -1, 2), null);
  assert.equal(createSourceAnchor(content, 2, 2), null);
  assert.equal(createSourceAnchor(content, 2.5, 3), null);
  assert.equal(createSourceAnchor(content, 2, content.length + 1), null);
});

test("source anchor: resolves direct, shifted, repeated and changed quotes without guessing", () => {
  const original = "before alpha unique after";
  const anchor = createSourceAnchor(original, 7, 12);
  assert.ok(anchor);
  assert.deepEqual(resolveSourceAnchor(anchor, original), { start: 7, end: 12 });
  assert.deepEqual(resolveSourceAnchor(anchor, "inserted " + original), { start: 16, end: 21 });

  const repeated = createSourceAnchor("A quote one. B quote two.", 2, 7);
  assert.ok(repeated);
  assert.deepEqual(resolveSourceAnchor(repeated, "A quote one. B quote two."), { start: 2, end: 7 });
  const ambiguous = { ...repeated, start: 99, end: 104, prefix: "", suffix: "" };
  assert.equal(resolveSourceAnchor(ambiguous, "quote quote"), null);

  const changed = { ...anchor, quote: "different" };
  assert.deepEqual(resolveSourceAnchor(changed, "before different unique after"), { start: 7, end: 16 });
  assert.equal(resolveSourceAnchor({ ...changed, prefix: "", suffix: "" }, "before alpha changed after"), null);
});

test("source anchor: refreshes offsets and context", () => {
  const anchor = createSourceAnchor("old quote", 4, 9);
  assert.ok(anchor);
  const refreshed = refreshSourceAnchor(anchor, "inserted old quote");
  assert.deepEqual(refreshed, createSourceAnchor("inserted old quote", 13, 18));
});
