import test from "node:test";
import assert from "node:assert/strict";
import { frenchTypography } from "../src/utils/core.js";
import { sourceOffsetToRenderedOffset, renderedOffsetToSourceOffset } from "../src/views/preview-source-map.js";

for (const [name, source, rendered, words] of [
  ["plain text", "First passage, second passage.", "First passage, second passage.", ["First", "second"]],
  ["italic", "Un frère chante un *nefes*. Sa voix recouvre à peine les hurlements.", "Un frère chante un nefes. Sa voix recouvre à peine les hurlements.", ["chante", "nefes", "hurlements"]],
  ["nested emphasis and links", "*one* **two** ***three*** [four](https://example.test) and *five*.", "one two three four and five.", ["one", "two", "three", "four", "five"]],
  ["soft breaks and collapsed spaces", "First  line\nsecond\tline.", "First line second line.", ["First", "second"]],
  ["hard breaks", "First  \nsecond line.", "Firstsecond line.", ["First", "second"]],
  ["escaped punctuation", "An escaped \\*star and a \\[bracket.", "An escaped *star and a [bracket.", ["star", "bracket"]],
]) {
  test(`Verified source offsets: ${name}`, () => {
    for (const word of words) {
      const offset = source.indexOf(word) + 1;
      assert.equal(sourceOffsetToRenderedOffset(source, rendered, offset), rendered.indexOf(word) + 1, word);
    }
  });
}

test("Invisible syntax and unsupported transformations retain the fallback", () => {
  assert.equal(sourceOffsetToRenderedOffset("A *word*.", "A word.", 2), null);
  assert.equal(sourceOffsetToRenderedOffset("A *word*.", "A different word.", 4), null);
  assert.equal(sourceOffsetToRenderedOffset("A &amp; B.", "A & B.", 8), null);
  assert.equal(sourceOffsetToRenderedOffset('A "word".', 'A “word”.', 4), null);
});


for (const [name, source, words] of [
  ["italic and apostrophes", "D'abord un *nefes*, puis d'autres voix.", ["abord", "nefes", "autres"]],
  ["ellipsis", "Certains vers la cour, d'autres grimpent... Enfin le silence.", ["cour", "grimpent", "Enfin"]],
  ["quotes and punctuation", 'Il dit: "un *nefes*!" Puis repart?', ["dit", "nefes", "Puis", "repart"]],
  ["existing nonbreaking spaces", "«\u00a0Un *nefes*\u00a0» ; fin.", ["Un", "nefes", "fin"]],
  ["combined", `D'abord: "**chant** et *voix*..."; puis d'autres!`, ["abord", "chant", "voix", "puis", "autres"]],
]) {
  test(`French typography offsets: ${name}`, () => {
    const rendered = frenchTypography(source, false).replaceAll("*", "");
    for (const word of words) {
      const from = source.indexOf(word) + 1;
      const to = rendered.indexOf(word) + 1;
      assert.equal(sourceOffsetToRenderedOffset(source, rendered, from), to, word);
      assert.equal(renderedOffsetToSourceOffset(source, rendered, to), from, word);
    }
  });
}

test("Typography contraction maps each dot to its single rendered glyph", () => {
  const source = "Avant... après";
  const rendered = frenchTypography(source, false);
  for (let index = 5; index < 8; index++) assert.equal(sourceOffsetToRenderedOffset(source, rendered, index), 5);
  assert.equal(renderedOffsetToSourceOffset(source, rendered, 5), 5);
});

test("Typography preserves code exclusions and rejects unrelated smart quotes", () => {
  const source = "Avant `d'autres...` puis d'autres...";
  const rendered = frenchTypography(source, false);
  assert.equal(sourceOffsetToRenderedOffset(source, rendered, source.lastIndexOf("autres")), rendered.lastIndexOf("autres"));
  assert.equal(renderedOffsetToSourceOffset('Une "voix".', 'Une “voix”.', 6), null);
});

test("Cross-reference offsets preserve real source positions before, within and after substitutions and typography", () => {
  const source = "Avant... old figure puis *suite* et old title. Fin.";
  const replacements = [
    { from: source.indexOf("old figure"), to: source.indexOf("old figure") + 10, text: "image 2" },
    { from: source.indexOf("old title"), to: source.indexOf("old title") + 9, text: "A much longer current title" },
  ];
  const rendered = "Avant… image 2 puis suite et A much longer current title. Fin.";
  for (const word of ["Avant", "puis", "suite", "Fin"]) {
    assert.equal(sourceOffsetToRenderedOffset(source, rendered, source.indexOf(word) + 1, replacements), rendered.indexOf(word) + 1);
    assert.equal(renderedOffsetToSourceOffset(source, rendered, rendered.indexOf(word) + 1, replacements), source.indexOf(word) + 1);
  }
  assert.equal(renderedOffsetToSourceOffset(source, rendered, rendered.indexOf("image 2") + 4, replacements), source.indexOf("old figure"));
  assert.equal(sourceOffsetToRenderedOffset(source, rendered, source.indexOf("old title") + 5, replacements), rendered.indexOf("A much"));
});
