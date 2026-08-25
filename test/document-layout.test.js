import test from "node:test";
import assert from "node:assert/strict";
import { createSourceAnchor } from "../src/services/source-anchor.js";
import { injectDocumentLayoutMarkers, documentLayoutBlocks } from "../src/services/document-layout.js";
import { resolveLayoutDirectiveContext } from "../src/utils/editor-layout-directives.js";

function anchor(text, value) {
  const start = text.indexOf(value);
  const result = createSourceAnchor(text, start, start + value.length);
  assert.ok(result);
  return result;
}

test("document layout: no override keeps the source byte-identical", () => {
  const markdown = "# Cours\n\nTexte.";
  assert.equal(injectDocumentLayoutMarkers(markdown, []), markdown);
});


test("document layout: questions expose a stable principal question line", () => {
  const markdown = "> [!questions]\n> 1. Pourquoi ?\n>    - Sous-question\n> 2. Quand ?";
  const blocks = documentLayoutBlocks(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].role, "questions");
  assert.equal(markdown.slice(blocks[0].questionLineOffset, blocks[0].questionLineOffset + 15), "> 1. Pourquoi ?");
});

test("document layout: each principal question resolves its own anchor", () => {
  const markdown = "> [!questions]\n> 1. Première ?\n>    Continuation\n> 2. Deuxième ?\n>    - Sous-question\n> 3. Troisième ?";
  const second = resolveLayoutDirectiveContext(markdown, 4);
  const third = resolveLayoutDirectiveContext(markdown, 5);
  assert.equal(markdown.slice(second.question.anchor.startOffset, second.question.anchor.endOffset), "> 2. Deuxième ?");
  assert.equal(markdown.slice(third.question.anchor.startOffset, third.question.anchor.endOffset), "> 3. Troisième ?");
});

test("document layout: page break is a virtual marker before a real block", () => {
  const markdown = "Avant.\n\nAprès.";
  const override = { id: "p", file: "Cours.md", kind: "page-break-before", anchor: anchor(markdown, "Après.") };
  assert.match(injectDocumentLayoutMarkers(markdown, [override]), /FEUILLETS_LAYOUT_PAGE_BREAK_BEFORE\n\nAprès\./);
});


test("document layout: a fenced code block is one complete pagination target", () => {
  const markdown = "```js\nconst answer = 42;\n```\n\nAprès.";
  const [code, paragraph] = documentLayoutBlocks(markdown);
  assert.equal(code.kind, "code");
  assert.equal(markdown.slice(code.startOffset, code.endOffset), "```js\nconst answer = 42;\n```");
  assert.equal(paragraph.kind, "paragraph");
});
