import assert from "node:assert/strict";
import test from "node:test";
import { PRESENTATION_MEDIA_SCALES, mediaQuestionsModeFor, presentationBodySizeCandidates, presentationExplicitMediaSize, presentationHeadingSize, presentationLayoutFor, presentationOverflows, presentationScale, splitPresentationMarkdown } from "../src/services/presentation.js";

class FakeElement {
  constructor(tagName, children = []) { this.tagName = tagName.toUpperCase(); this.children = children; this.childNodes = children; }
  querySelector(selector) { return selector.includes("li") || selector.includes("blockquote") || selector.includes("table") ? null : null; }
  querySelectorAll(selector) {
    const names = selector.split(",").map((value) => value.trim().toUpperCase());
    const found = [];
    const visit = (node) => { for (const child of node.children) { if (names.includes(child.tagName)) found.push(child); visit(child); } };
    visit(this);
    return found;
  }
}

const block = (tag, children = []) => new FakeElement(tag, children);
const root = (...children) => block("div", children);
const image = () => block("p", [block("img")]);

test("Présentation : découpe les slides, retire le frontmatter et ignore les sections blanches", () => {
  assert.deepEqual(splitPresentationMarkdown("# Un\n---\n# Deux"), ["# Un", "# Deux"]);
  assert.deepEqual(splitPresentationMarkdown("---\ntype: cours\n---\n# Un\n---\n# Deux"), ["# Un", "# Deux"]);
  assert.deepEqual(splitPresentationMarkdown("---\n\n---\n# Un\n---\n\n---"), ["# Un"]);
  assert.deepEqual(splitPresentationMarkdown("# Seule"), ["# Seule"]);
  assert.deepEqual(splitPresentationMarkdown("\n \n"), []);
});

test("Présentation : ne coupe ni les fences, ni les citations, ni les séparateurs Markdown ordinaires", () => {
  assert.deepEqual(splitPresentationMarkdown("```text\n---\n```\n---\n# Deux"), ["```text\n---\n```", "# Deux"]);
  assert.deepEqual(splitPresentationMarkdown("~~~\n---\n~~~\n---\n# Deux"), ["~~~\n---\n~~~", "# Deux"]);
  assert.deepEqual(splitPresentationMarkdown("> ---\n\n***\n\n___"), ["> ---\n\n***\n\n___"]);
});

test("Présentation : le scale reste uniforme et plafonné à 1", () => {
  assert.equal(presentationScale(640, 720), 0.5);
  assert.equal(presentationScale(2560, 1440), 1);
  assert.equal(presentationScale(0, 720), 0);
});

test("Présentation : classe title, quote et standard par structure", () => {
  assert.equal(presentationLayoutFor(root(block("h1"), block("p")), 0), "title");
  assert.equal(presentationLayoutFor(root(block("h2"), block("blockquote")), 1), "quote");
  assert.equal(presentationLayoutFor(root(block("h1"), block("ul")), 0), "standard");
});

test("Présentation : classe media, media-text et gallery par médias autonomes", () => {
  assert.equal(presentationLayoutFor(root(block("h1"), image(), block("ol")), 1), "media-questions");
  assert.equal(presentationLayoutFor(root(block("h1"), image(), block("p"), block("ul")), 1), "media-questions");
  assert.equal(presentationLayoutFor(root(block("h1"), image()), 1), "media");
  assert.equal(presentationLayoutFor(root(block("h1"), block("p"), image()), 1), "media-text");
  assert.equal(presentationLayoutFor(root(block("h2"), image(), image()), 1), "gallery");
  assert.equal(presentationLayoutFor(root(block("ul", [block("li", [block("img")])])), 1), "standard");
});

test("Présentation : media-questions choisit side ou stacked avec le ratio et le nombre d'items", () => {
  assert.equal(mediaQuestionsModeFor(600, 900, 4), "side");
  assert.equal(mediaQuestionsModeFor(631, 631, 4), "side");
  assert.equal(mediaQuestionsModeFor(631, 631, 7), "stacked");
  assert.equal(mediaQuestionsModeFor(1200, 900, 3), "side");
  assert.equal(mediaQuestionsModeFor(1200, 900, 5), "stacked");
  assert.equal(mediaQuestionsModeFor(1600, 900, 3), "stacked");
  assert.equal(mediaQuestionsModeFor(0, 0, 3), "stacked");
});

test("Présentation : le fit continu expose ses candidats et conserve les layouts", () => {
  assert.deepEqual(presentationBodySizeCandidates(), [31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18]);
  assert.deepEqual(PRESENTATION_MEDIA_SCALES, [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35]);
  assert.equal(PRESENTATION_MEDIA_SCALES.at(-1), 0.35);
  assert.equal(presentationLayoutFor(root(block("h1"), image(), block("ol")), 1), "media-questions");
  assert.equal(mediaQuestionsModeFor(600, 900, 4), "side");
  assert.equal(presentationOverflows({ scrollWidth: 101, clientWidth: 100, scrollHeight: 100, clientHeight: 100 }), false);
  assert.equal(presentationOverflows({ scrollWidth: 102, clientWidth: 100, scrollHeight: 100, clientHeight: 100 }), true);
});

test("Présentation : détecte seulement les tailles média explicitement rendues", () => {
  const makeImage = (width, height, naturalWidth = 631, naturalHeight = 631) => ({
    parentElement: null,
    naturalWidth,
    naturalHeight,
    style: {},
    getAttribute: (name) => name === "width" ? width : name === "height" ? height : null,
  });
  assert.deepEqual(presentationExplicitMediaSize(makeImage("300", null)), { width: 300 });
  assert.equal(presentationExplicitMediaSize(makeImage("0", null)), null);
  assert.equal(presentationExplicitMediaSize(makeImage("-10", null)), null);
  assert.equal(presentationExplicitMediaSize(makeImage("abc", null)), null);
  assert.equal(presentationExplicitMediaSize(makeImage(null, null)), null);
});

test("Présentation : les titres respectent leurs minimums à 18 px", () => {
  assert.ok(presentationHeadingSize(1, 18) >= 38);
  assert.ok(presentationHeadingSize(2, 18) >= 34);
  assert.ok(presentationHeadingSize(3, 18) >= 30);
  assert.ok(presentationHeadingSize(4, 18) >= 26);
});
