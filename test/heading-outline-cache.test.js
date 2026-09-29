import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { headingOutlineInputsForFile, headingOutlineForFile } from "../src/services/heading-outline-cache.js";

const headingCache = (heading, level, startOffset, endOffset) => ({
  heading,
  level,
  position: { start: { line: 0, col: 0, offset: startOffset }, end: { line: 0, col: 0, offset: endOffset } },
});

function appWithCache(cache) {
  return { metadataCache: { getFileCache: () => cache } };
}

test("heading outline cache: getFileCache() returning null yields an empty list", () => {
  const app = appWithCache(null);
  const file = new TFile("Manuscrit.md");
  assert.deepEqual(headingOutlineInputsForFile(app, file), []);
});

test("heading outline cache: a cache with no headings property yields an empty list", () => {
  const app = appWithCache({ frontmatter: {} });
  const file = new TFile("Manuscrit.md");
  assert.deepEqual(headingOutlineInputsForFile(app, file), []);
});

test("heading outline cache: an empty headings array yields an empty list", () => {
  const app = appWithCache({ headings: [] });
  const file = new TFile("Manuscrit.md");
  assert.deepEqual(headingOutlineInputsForFile(app, file), []);
});

test("heading outline cache: a single H1 heading is converted correctly", () => {
  const app = appWithCache({ headings: [headingCache("Chapitre 1", 1, 0, 10)] });
  const file = new TFile("Manuscrit.md");
  assert.deepEqual(headingOutlineInputsForFile(app, file), [{ text: "Chapitre 1", level: 1, startOffset: 0, endOffset: 10 }]);
});

test("heading outline cache: H1 through H6 are all converted correctly", () => {
  const cacheHeadings = [1, 2, 3, 4, 5, 6].map((level) => headingCache(`H${level}`, level, level * 10, level * 10 + 2));
  const app = appWithCache({ headings: cacheHeadings });
  const file = new TFile("Manuscrit.md");
  const result = headingOutlineInputsForFile(app, file);
  assert.equal(result.length, 6);
  for (let i = 0; i < 6; i++) {
    assert.equal(result[i].level, i + 1);
    assert.equal(result[i].text, `H${i + 1}`);
  }
});

test("heading outline cache: heading text is preserved exactly", () => {
  const app = appWithCache({ headings: [headingCache("Le Chêne et l'Orage — Prologue", 1, 0, 5)] });
  const file = new TFile("Manuscrit.md");
  assert.equal(headingOutlineInputsForFile(app, file)[0].text, "Le Chêne et l'Orage — Prologue");
});

test("heading outline cache: startOffset is preserved exactly", () => {
  const app = appWithCache({ headings: [headingCache("A", 1, 42, 50)] });
  const file = new TFile("Manuscrit.md");
  assert.equal(headingOutlineInputsForFile(app, file)[0].startOffset, 42);
});

test("heading outline cache: endOffset is preserved exactly", () => {
  const app = appWithCache({ headings: [headingCache("A", 1, 42, 50)] });
  const file = new TFile("Manuscrit.md");
  assert.equal(headingOutlineInputsForFile(app, file)[0].endOffset, 50);
});

test("heading outline cache: heading order is preserved", () => {
  const app = appWithCache({ headings: [headingCache("A", 1, 0, 1), headingCache("B", 2, 2, 3), headingCache("C", 1, 4, 5)] });
  const file = new TFile("Manuscrit.md");
  assert.deepEqual(headingOutlineInputsForFile(app, file).map((h) => h.text), ["A", "B", "C"]);
});

test("heading outline cache: duplicate heading text becomes distinct entries", () => {
  const app = appWithCache({ headings: [headingCache("Contexte", 2, 0, 1), headingCache("Contexte", 2, 2, 3)] });
  const file = new TFile("Manuscrit.md");
  const result = headingOutlineInputsForFile(app, file);
  assert.equal(result.length, 2);
  assert.notEqual(result[0], result[1]);
  assert.equal(result[0].startOffset, 0);
  assert.equal(result[1].startOffset, 2);
});

test("heading outline cache: MetadataCache objects are never mutated", () => {
  const heading = headingCache("A", 1, 0, 1);
  const cache = { headings: [heading] };
  const snapshot = JSON.parse(JSON.stringify(cache));
  const app = appWithCache(cache);
  const file = new TFile("Manuscrit.md");
  headingOutlineInputsForFile(app, file);
  assert.deepEqual(cache, snapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(heading, "startOffset"), false);
});

test("heading outline cache: a non-Markdown file does not query MetadataCache", () => {
  const app = {
    metadataCache: {
      getFileCache: () => {
        throw new Error("getFileCache() must not be called for non-Markdown files");
      },
    },
  };
  const file = new TFile("Manuscrit.canvas");
  assert.deepEqual(headingOutlineInputsForFile(app, file), []);
});

test("heading outline cache: headingOutlineForFile() composes with buildHeadingOutline()", () => {
  const app = appWithCache({ headings: [headingCache("A", 1, 0, 1), headingCache("B", 2, 1, 2)] });
  const file = new TFile("Manuscrit.md");
  const result = headingOutlineForFile(app, file);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "A");
  assert.equal(result[0].children.length, 1);
  assert.equal(result[0].children[0].text, "B");
  assert.deepEqual(result[0].children[0].children, []);
});

test("heading outline cache: H1 A / H4 B / H3 C / H2 D all attach to the H1 root", () => {
  const app = appWithCache({
    headings: [headingCache("A", 1, 0, 1), headingCache("B", 4, 1, 2), headingCache("C", 3, 2, 3), headingCache("D", 2, 3, 4)],
  });
  const file = new TFile("Manuscrit.md");
  const result = headingOutlineForFile(app, file);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "A");
  assert.deepEqual(result[0].children.map((n) => n.text), ["B", "C", "D"]);
});

test("heading outline cache: no vault read is required, only metadataCache.getFileCache()", () => {
  const app = {
    metadataCache: { getFileCache: () => ({ headings: [headingCache("A", 1, 0, 1)] }) },
    vault: {
      read: () => { throw new Error("vault.read() must not be called"); },
      cachedRead: () => { throw new Error("vault.cachedRead() must not be called"); },
    },
  };
  const file = new TFile("Manuscrit.md");
  assert.deepEqual(headingOutlineInputsForFile(app, file), [{ text: "A", level: 1, startOffset: 0, endOffset: 1 }]);
});
