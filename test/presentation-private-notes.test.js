import test from "node:test";
import assert from "node:assert/strict";
import { withoutSpeakerNotes } from "../src/services/presentation-private-notes.js";
import { splitPresentationMarkdownWithRanges } from "../src/services/presentation.js";

test("private notes: titles, folding and nested callouts are removed without source drift", () => {
  const markdown = "# Public\n\n> [!speaker-notes]+ Private title\n> Secret\n>\n> > [!note]\n> > Nested secret\n\n## Visible\n\n> [!source]\n> Public source";
  const publicMarkdown = withoutSpeakerNotes(markdown);
  assert.doesNotMatch(publicMarkdown, /Secret|secret|Private title/);
  assert.match(publicMarkdown, /\[!source\]/);
  assert.equal(publicMarkdown.split("\n").indexOf("## Visible"), markdown.split("\n").indexOf("## Visible"));
  assert.equal(withoutSpeakerNotes(publicMarkdown), publicMarkdown);
});

test("private notes: literal code examples and ordinary callouts stay intact", () => {
  for (const markdown of ["```md\n> [!speaker-notes]\n> Literal\n```", "    > [!speaker-notes]\n    > Literal", "> [!note]\n> Visible", "> Ordinary speaker-notes text"]) {
    assert.equal(withoutSpeakerNotes(markdown), markdown);
  }
});

test("private notes: note-only segments create no empty slide", () => {
  const slides = splitPresentationMarkdownWithRanges("> [!speaker-notes]\n> Secret\n\n---\n\n# Visible\n\n---\n\n> [!speaker-notes]\n> More secrets");
  assert.equal(slides.length, 1);
  assert.equal(slides[0].markdown, "# Visible");
  assert.equal(slides[0].startLine, 5);
});
