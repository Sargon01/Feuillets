import assert from "node:assert/strict";
import test from "node:test";
import { splitPresentationMarkdownWithRanges } from "../src/services/presentation.js";
import { createSourceAnchor } from "../src/services/source-anchor.js";
import { createPresentationSlideAnchor, resolvePresentationSlideLayouts, replacePresentationSlideLayout } from "../src/services/presentation-layout-overrides.js";

function override(markdown, needle, layout, id = needle) {
  const start = markdown.indexOf(needle);
  return { id, file: "Cours.md", kind: "slide-layout", anchor: createSourceAnchor(markdown, start, start + needle.length), layout };
}

test("ancre canonique : première ligne significative, fences et séparateurs ignorés", () => {
  const markdown = "\n```\n```\n\n# Premier\n---\n\nTexte sans titre\n---\n\n---";
  const slides = splitPresentationMarkdownWithRanges(markdown);
  assert.equal(createPresentationSlideAnchor(markdown, slides[0]).quote, "# Premier");
  assert.equal(createPresentationSlideAnchor(markdown, slides[1]).quote, "Texte sans titre");
});

test("ancre : insertion et déplacement de la slide conservés par SourceAnchor", () => {
  const first = "# Un\n---\n# Deux";
  const anchor = createPresentationSlideAnchor(first, splitPresentationMarkdownWithRanges(first)[1]);
  const shifted = "Texte avant\n\n" + first;
  const resolved = anchor && createSourceAnchor(first, anchor.start, anchor.end);
  assert.equal(resolved?.quote, "# Deux");
  assert.equal(shifted.slice(shifted.indexOf("# Deux"), shifted.indexOf("# Deux") + 6), "# Deux");
});

test("résolution : layouts par slide, stale ignoré, collision = automatique", () => {
  const markdown = "# Un\n---\n# Deux";
  const slides = splitPresentationMarkdownWithRanges(markdown);
  const one = override(markdown, "# Un", "flow", "one");
  const two = override(markdown, "# Deux", "columns", "two");
  const collision = { ...one, id: "collision", layout: "image-left" };
  const resolved = resolvePresentationSlideLayouts(markdown, slides, [one, two, collision]);
  assert.equal(resolved.has(0), false);
  assert.equal(resolved.get(1)?.layout, "columns");
  assert.equal(resolvePresentationSlideLayouts(markdown, slides, [{ ...one, anchor: { ...one.anchor, quote: "absent" } }]).size, 0);
});

test("remplacement : un seul slide-layout cible, autres familles et slides préservés", () => {
  const markdown = "# Un\n---\n# Deux";
  const slides = splitPresentationMarkdownWithRanges(markdown);
  const old = override(markdown, "# Un", "flow", "old");
  const other = override(markdown, "# Deux", "columns", "other");
  const documentOverride = { id: "doc", file: "Cours.md", kind: "image-position", anchor: old.anchor, position: "left" };
  const store = { version: 1, overrides: [old, other, documentOverride] };
  const next = replacePresentationSlideLayout(store, "Cours.md", markdown, slides, 0, "image-right");
  assert.equal(next.overrides.filter((item) => item.kind === "slide-layout").length, 2);
  assert.equal(next.overrides.find((item) => item.id === "old"), undefined);
  assert.equal(next.overrides.find((item) => item.id === "other")?.layout, "columns");
  assert.equal(next.overrides.find((item) => item.id === "doc")?.kind, "image-position");
  const automatic = replacePresentationSlideLayout(next, "Cours.md", markdown, slides, 0, null);
  assert.equal(automatic.overrides.some((item) => item.kind === "slide-layout" && item.id !== "other"), false);
});
