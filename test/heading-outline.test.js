import test from "node:test";
import assert from "node:assert/strict";
import { buildHeadingOutline } from "../src/services/heading-outline.js";

const h = (text, level, startOffset, endOffset) => ({ text, level, startOffset, endOffset });

test("heading outline: empty array produces no roots", () => {
  assert.deepEqual(buildHeadingOutline([]), []);
});

test("heading outline: a single H1 becomes a single root with no children", () => {
  const result = buildHeadingOutline([h("A", 1, 0, 2)]);
  assert.deepEqual(result, [{ text: "A", level: 1, startOffset: 0, endOffset: 2, children: [] }]);
});

test("heading outline: H1/H2/H3 nests linearly", () => {
  const result = buildHeadingOutline([h("A", 1, 0, 1), h("B", 2, 2, 3), h("C", 3, 4, 5)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "A");
  assert.equal(result[0].children.length, 1);
  assert.equal(result[0].children[0].text, "B");
  assert.equal(result[0].children[0].children.length, 1);
  assert.equal(result[0].children[0].children[0].text, "C");
});

test("heading outline: returning from H3 to H2 attaches the new H2 to the H1 ancestor", () => {
  const result = buildHeadingOutline([h("A", 1, 0, 1), h("B", 2, 2, 3), h("C", 3, 4, 5), h("D", 2, 6, 7)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].children.length, 2);
  assert.equal(result[0].children[0].text, "B");
  assert.equal(result[0].children[0].children[0].text, "C");
  assert.equal(result[0].children[1].text, "D");
  assert.equal(result[0].children[1].children.length, 0);
});

test("heading outline: several H1 headings each become their own root", () => {
  const result = buildHeadingOutline([h("A", 1, 0, 1), h("B", 2, 2, 3), h("C", 3, 4, 5), h("D", 2, 6, 7), h("E", 1, 8, 9)]);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, "A");
  assert.equal(result[1].text, "E");
  assert.equal(result[1].children.length, 0);
});

test("heading outline: a jump from H1 to H4 nests directly without inventing intermediate levels", () => {
  const result = buildHeadingOutline([h("A", 1, 0, 1), h("B", 4, 2, 3)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].children.length, 1);
  assert.equal(result[0].children[0].text, "B");
  assert.equal(result[0].children[0].level, 4);
});

test("heading outline: a document starting with H3 produces a root at that level", () => {
  const result = buildHeadingOutline([h("A", 3, 0, 1), h("B", 4, 2, 3), h("C", 2, 4, 5)]);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, "A");
  assert.equal(result[0].children[0].text, "B");
  assert.equal(result[1].text, "C");
});

test("heading outline: H1 -> H4 -> H3 -> H2 all attach to the H1 root, per the nearest-lower-level rule", () => {
  const result = buildHeadingOutline([h("A", 1, 0, 1), h("B", 4, 2, 3), h("C", 3, 4, 5), h("D", 2, 6, 7)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "A");
  assert.deepEqual(result[0].children.map((n) => n.text), ["B", "C", "D"]);
  assert.deepEqual(result[0].children.map((n) => n.children.length), [0, 0, 0]);
});

test("heading outline: levels down to H6 are supported", () => {
  const headings = [h("H1", 1, 0, 1), h("H2", 2, 1, 2), h("H3", 3, 2, 3), h("H4", 4, 3, 4), h("H5", 5, 4, 5), h("H6", 6, 5, 6)];
  const result = buildHeadingOutline(headings);
  let node = result[0];
  for (let level = 1; level <= 6; level++) {
    assert.equal(node.level, level);
    if (level < 6) node = node.children[0];
  }
});

test("heading outline: a return from H6 straight to H1 starts a new root", () => {
  const result = buildHeadingOutline([h("A", 1, 0, 1), h("B", 6, 1, 2), h("C", 1, 2, 3)]);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, "A");
  assert.equal(result[0].children[0].text, "B");
  assert.equal(result[1].text, "C");
});

test("heading outline: identical heading text produces two distinct nodes", () => {
  const result = buildHeadingOutline([h("Introduction", 1, 0, 1), h("Contexte", 2, 1, 2), h("Contexte", 2, 2, 3)]);
  assert.equal(result[0].children.length, 2);
  assert.notEqual(result[0].children[0], result[0].children[1]);
  assert.equal(result[0].children[0].text, "Contexte");
  assert.equal(result[0].children[1].text, "Contexte");
  assert.equal(result[0].children[0].startOffset, 1);
  assert.equal(result[0].children[1].startOffset, 2);
});

test("heading outline: several roots of different levels are all preserved", () => {
  const result = buildHeadingOutline([h("A", 3, 0, 1), h("B", 4, 1, 2), h("C", 1, 2, 3)]);
  assert.equal(result.length, 2);
  assert.equal(result[0].text, "A");
  assert.equal(result[0].level, 3);
  assert.equal(result[1].text, "C");
  assert.equal(result[1].level, 1);
});

test("heading outline: invalid levels are ignored", () => {
  const result = buildHeadingOutline([
    h("Zero", 0, 0, 1),
    h("Valid", 1, 1, 2),
    h("Seven", 7, 2, 3),
    h("Negative", -1, 3, 4),
    h("NotANumber", NaN, 4, 5),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "Valid");
  assert.equal(result[0].children.length, 0);
});

test("heading outline: offsets are preserved exactly", () => {
  const result = buildHeadingOutline([h("A", 1, 12, 34)]);
  assert.equal(result[0].startOffset, 12);
  assert.equal(result[0].endOffset, 34);
});

test("heading outline: relative order of valid entries is preserved", () => {
  const result = buildHeadingOutline([h("A", 1, 0, 1), h("B", 1, 1, 2), h("C", 1, 2, 3)]);
  assert.deepEqual(result.map((n) => n.text), ["A", "B", "C"]);
});

test("heading outline: input array and input objects are never mutated", () => {
  const input = [h("A", 1, 0, 1), h("B", 2, 1, 2)];
  const snapshot = JSON.parse(JSON.stringify(input));
  buildHeadingOutline(input);
  assert.deepEqual(input, snapshot);
  assert.equal(input.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(input[0], "children"), false);
});
