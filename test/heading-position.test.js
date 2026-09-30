import test from "node:test";
import assert from "node:assert/strict";
import { headingTrailAtOffset } from "../src/services/heading-position.js";

const headings = [
  { text: "Grand", level: 1, startOffset: 10, endOffset: 17 },
  { text: "Sous", level: 2, startOffset: 30, endOffset: 37 },
  { text: "Petit", level: 3, startOffset: 50, endOffset: 58 },
  { text: "Sibling", level: 2, startOffset: 70, endOffset: 80 },
  { text: "Next", level: 1, startOffset: 100, endOffset: 106 },
];

test("headingTrailAtOffset returns the current heading hierarchy", () => {
  assert.deepEqual(headingTrailAtOffset(headings, 0), []);
  assert.deepEqual(headingTrailAtOffset(headings, 20).map((heading) => heading.text), ["Grand"]);
  assert.deepEqual(headingTrailAtOffset(headings, 40).map((heading) => heading.text), ["Grand", "Sous"]);
  assert.deepEqual(headingTrailAtOffset(headings, 60).map((heading) => heading.text), ["Grand", "Sous", "Petit"]);
  assert.deepEqual(headingTrailAtOffset(headings, 90).map((heading) => heading.text), ["Grand", "Sibling"]);
  assert.deepEqual(headingTrailAtOffset(headings, 200).map((heading) => heading.text), ["Next"]);
});

test("headingTrailAtOffset handles skipped levels and preserves inputs", () => {
  const skipped = [
    { text: "A", level: 1, startOffset: 0, endOffset: 1 },
    { text: "B", level: 4, startOffset: 10, endOffset: 11 },
    { text: "C", level: 3, startOffset: 20, endOffset: 21 },
  ];
  const original = [...skipped];
  assert.deepEqual(headingTrailAtOffset(skipped, 15).map((heading) => heading.text), ["A", "B"]);
  assert.deepEqual(headingTrailAtOffset(skipped, 25).map((heading) => heading.text), ["A", "C"]);
  assert.deepEqual(skipped, original);
});

test("headingTrailAtOffset rejects inconsistent cache data safely", () => {
  assert.deepEqual(headingTrailAtOffset(headings, -1), []);
  assert.deepEqual(headingTrailAtOffset([{ text: "A", level: 7, startOffset: 0, endOffset: 1 }], 2), []);
  assert.deepEqual(headingTrailAtOffset([{ text: "A", level: 1, startOffset: -1, endOffset: 1 }], 2), []);
  assert.deepEqual(headingTrailAtOffset([
    { text: "A", level: 1, startOffset: 0, endOffset: 1 },
    { text: "B", level: 2, startOffset: 0, endOffset: 1 },
  ], 2), []);
});
