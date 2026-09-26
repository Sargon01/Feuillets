import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { buildScriveningsDocument } from "../src/services/scrivenings-document.js";
import { buildScriveningsClipboardText } from "../src/services/scrivenings-clipboard.js";

function docOf(bodies) {
  return buildScriveningsDocument(bodies.map((body, i) => ({ file: new TFile(`P/${"ABCD"[i]}.md`), content: body })));
}

/* Title resolver stub: "## <letter>" unless the selected body already opens with a heading. */
const titleFor = (segment, selected) => (/^#{1,6}\s+\S/m.test(selected) ? null : `## ${segment.path.slice(2, 3)}`);

const doc = docOf(["Alpha bravo.\n", "Bravo body.\n", "Charlie body."]);
const [A, B, C] = doc.segments;
const clip = (from, to, resolver = titleFor) => buildScriveningsClipboardText(doc, from, to, resolver);

test("single segment: exact slice, never a title (even from segment.from)", () => {
  assert.equal(clip(0, 5), "Alpha");
  assert.equal(clip(B.from, B.from + 5), "Bravo");
  assert.equal(clip(A.from, A.to), A.body);
});

test("middle of A to middle of B: no title for A, title for B", () => {
  assert.equal(clip(6, B.from + 5), "bravo.\n\n## B\n\nBravo");
});

test("middle of A to middle of C: titles for B and C only", () => {
  assert.equal(clip(6, C.from + 7), "bravo.\n\n## B\n\nBravo body.\n\n## C\n\nCharlie");
});

test("selection starting exactly at A.from and crossing: title A present", () => {
  assert.equal(clip(0, B.from + 5), "## A\n\nAlpha bravo.\n\n## B\n\nBravo");
});

test("select-all: every title, one blank line between units, end untouched", () => {
  assert.equal(clip(0, doc.text.length), "## A\n\nAlpha bravo.\n\n## B\n\nBravo body.\n\n## C\n\nCharlie body.");
});

test("selection ending exactly at a boundary does not reach the next segment", () => {
  assert.equal(clip(6, B.from), "bravo.\n\n"); // same as the native slice: joint included, no title B
  assert.equal(clip(0, A.to), A.body);
});

test("selection ending inside the joint range is the plain slice", () => {
  assert.equal(clip(6, A.to), "bravo.\n");
  assert.equal(clip(6, A.to + 1), doc.text.slice(6, A.to + 1));
});

test("selection starting on the joint: no leading blank, B gets its title", () => {
  assert.equal(clip(A.to, B.from + 5), "## B\n\nBravo");
});

test("selection starting exactly at B.from (after the joint) gets B's title", () => {
  assert.equal(clip(B.from, C.from + 3), "## B\n\nBravo body.\n\n## C\n\nCha");
});

test("empty first segment: title still appears when its boundary is selected", () => {
  const d = docOf(["", "Body B."]);
  assert.equal(buildScriveningsClipboardText(d, 0, d.text.length, titleFor), "## A\n\n## B\n\nBody B.");
});

test("empty intermediate segment keeps its title", () => {
  const d = docOf(["Text A.", "", "Text C."]);
  assert.equal(buildScriveningsClipboardText(d, 0, d.text.length, titleFor), "## A\n\nText A.\n\n## B\n\n## C\n\nText C.");
});

test("empty last segment is reached by select-all", () => {
  const d = docOf(["Text A.", ""]);
  assert.equal(buildScriveningsClipboardText(d, 0, d.text.length, titleFor), "## A\n\nText A.\n\n## B");
});

test("body already starting with a heading: resolver returns null, no duplication", () => {
  const d = docOf(["Text A.", "## Chapitre 2\n\nBody."]);
  assert.equal(buildScriveningsClipboardText(d, 3, d.text.length, titleFor), "t A.\n\n## Chapitre 2\n\nBody.");
});

test("resolver receives the selected part of the segment and segment", () => {
  const seen = [];
  buildScriveningsClipboardText(doc, 6, C.from + 7, (segment, selected) => {
    seen.push([segment.path, selected]);
    return null;
  });
  assert.deepEqual(seen, [["P/B.md", B.body], ["P/C.md", "Charlie"]]);
});

test("never mutates the document and tolerates reversed offsets", () => {
  const before = JSON.stringify(doc.segments.map((s) => [s.from, s.to, s.body]));
  assert.equal(clip(B.from + 5, 6), "bravo.\n\n## B\n\nBravo");
  assert.equal(JSON.stringify(doc.segments.map((s) => [s.from, s.to, s.body])), before);
});
