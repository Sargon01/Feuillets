import test from "node:test";
import assert from "node:assert/strict";
import { mapPresentationNotesToSlides } from "../src/services/presentation-plan.js";
import { splitPresentationMarkdownWithRanges } from "../src/services/presentation.js";

/* ===== mapPresentationNotesToSlides ===== */

function annotation(overrides) {
  return {
    id: "a1", file: "x.md", start: 0, end: 0, quote: "", prefix: "", suffix: "",
    text: "note", color: "yellow", presentationNote: true,
    ...overrides,
  };
}

function slidesFor(markdown) {
  return splitPresentationMarkdownWithRanges(markdown);
}

test("mapPresentationNotesToSlides : annotation ordinaire (presentationNote !== true) ignorée", () => {
  const markdown = "# Slide 1\n\nTexte du passage annoté ici.\n\n---\n\n# Slide 2";
  const slides = slidesFor(markdown);
  const quote = "passage annoté";
  const start = markdown.indexOf(quote);
  const a = annotation({ id: "a1", presentationNote: false, quote, start, end: start + quote.length, prefix: markdown.slice(Math.max(0, start - 8), start), suffix: markdown.slice(start + quote.length, start + quote.length + 8) });
  const result = mapPresentationNotesToSlides(markdown, slides, [a]);
  assert.equal(result.notesBySlide.size, 0);
  assert.deepEqual(result.unresolvedAnnotationIds, []);
});

test("mapPresentationNotesToSlides : annotation presentationNote avec texte vide ignorée", () => {
  const markdown = "# Slide 1\n\nTexte du passage annoté ici.";
  const slides = slidesFor(markdown);
  const quote = "passage annoté";
  const start = markdown.indexOf(quote);
  const a = annotation({ id: "a1", text: "   ", quote, start, end: start + quote.length, prefix: markdown.slice(Math.max(0, start - 8), start), suffix: markdown.slice(start + quote.length, start + quote.length + 8) });
  const result = mapPresentationNotesToSlides(markdown, slides, [a]);
  assert.equal(result.notesBySlide.size, 0);
  assert.deepEqual(result.unresolvedAnnotationIds, []);
});

test("mapPresentationNotesToSlides : annotation résolue rattachée à la bonne slide", () => {
  const markdown = "# Slide 1\n\nAAA.\n\n---\n\n# Slide 2\n\nLe passage annoté est ici.\n\n---\n\n# Slide 3\n\nCCC.";
  const slides = slidesFor(markdown);
  const quote = "passage annoté";
  const start = markdown.indexOf(quote);
  const a = annotation({ id: "a1", text: "commentaire slide 2", quote, start, end: start + quote.length, prefix: markdown.slice(Math.max(0, start - 8), start), suffix: markdown.slice(start + quote.length, start + quote.length + 8) });
  const result = mapPresentationNotesToSlides(markdown, slides, [a]);
  assert.equal(result.notesBySlide.size, 1);
  assert.deepEqual([...result.notesBySlide.keys()], [1]);
  assert.equal(result.notesBySlide.get(1)[0].text, "commentaire slide 2");
  assert.deepEqual(result.unresolvedAnnotationIds, []);
});

test("mapPresentationNotesToSlides : insertion de texte avant l'ancre — resolveAnnotation retrouve le passage, la note suit la bonne slide", () => {
  const original = "# Slide 1\n\nAAA.\n\n---\n\n# Slide 2\n\nLe passage annoté est ici.\n\n---\n\n# Slide 3\n\nCCC.";
  const quote = "passage annoté";
  const start = original.indexOf(quote);
  const end = start + quote.length;
  const a = annotation({
    id: "a1", text: "commentaire", quote, start, end,
    prefix: original.slice(Math.max(0, start - 8), start),
    suffix: original.slice(end, end + 8),
  });
  // Insère du texte AVANT l'ancre (dans la Slide 1) : les offsets stockés
  // sont désormais faux, mais quote/prefix/suffix retrouvent le passage.
  const edited = original.replace("AAA.", "AAA. Texte ajouté avant l'ancre.");
  const slides = slidesFor(edited);
  const result = mapPresentationNotesToSlides(edited, slides, [a]);
  assert.deepEqual(result.unresolvedAnnotationIds, []);
  assert.equal(result.notesBySlide.size, 1);
  assert.deepEqual([...result.notesBySlide.keys()], [1], "la note reste rattachée à la Slide 2, malgré le décalage d'offsets");
});

test("mapPresentationNotesToSlides : ancre chevauchant deux slides → rattachée à la slide qui contient le DÉBUT", () => {
  // Le séparateur "---" tombe entre les deux mots de la citation : la
  // citation en tant que telle ne survit pas au split, mais l'annotation
  // stocke un start qui tombe dans la Slide 1 (avant le séparateur) — donc
  // rattachée à la Slide 1, jamais à la Slide 2 qui suit.
  const markdown = "# Slide 1\n\nDébut du passage partagé\n\n---\n\n# Slide 2\n\nreste ici.";
  const slides = slidesFor(markdown);
  const start = markdown.indexOf("Début du passage partagé");
  const a = annotation({ id: "a1", text: "note", quote: "Début du passage partagé", start, end: start + "Début du passage partagé".length, prefix: "", suffix: "" });
  const result = mapPresentationNotesToSlides(markdown, slides, [a]);
  assert.equal(result.notesBySlide.size, 1);
  assert.deepEqual([...result.notesBySlide.keys()], [0], "rattachée à la slide qui contient le début de l'ancre");
});

test("mapPresentationNotesToSlides : annotation non résoluble → unresolvedAnnotationIds, jamais associée à une slide", () => {
  const markdown = "# Slide 1\n\nTexte réel.";
  const slides = slidesFor(markdown);
  const a = annotation({ id: "a1", text: "note perdue", quote: "passage disparu depuis", start: 0, end: 5, prefix: "inconnu", suffix: "inconnu" });
  const result = mapPresentationNotesToSlides(markdown, slides, [a]);
  assert.equal(result.notesBySlide.size, 0);
  assert.deepEqual(result.unresolvedAnnotationIds, ["a1"]);
});

test("mapPresentationNotesToSlides : plusieurs notes d'une même slide, ordonnées par sourceStart", () => {
  const markdown = "# Slide 1\n\nPremier passage. Puis un second passage bien plus loin.";
  const slides = slidesFor(markdown);
  const q1 = "second passage";
  const q2 = "Premier passage";
  const s1 = markdown.indexOf(q1);
  const s2 = markdown.indexOf(q2);
  // Volontairement passées dans le désordre (la note du second passage source
  // en premier) : le résultat doit malgré tout suivre l'ordre du texte.
  const noteB = annotation({ id: "note-second", text: "note B (second passage)", quote: q1, start: s1, end: s1 + q1.length, prefix: markdown.slice(s1 - 8, s1), suffix: markdown.slice(s1 + q1.length, s1 + q1.length + 8) });
  const noteA = annotation({ id: "note-first", text: "note A (premier passage)", quote: q2, start: s2, end: s2 + q2.length, prefix: markdown.slice(Math.max(0, s2 - 8), s2), suffix: markdown.slice(s2 + q2.length, s2 + q2.length + 8) });
  const result = mapPresentationNotesToSlides(markdown, slides, [noteB, noteA]);
  assert.equal(result.notesBySlide.size, 1);
  const notes = result.notesBySlide.get(0);
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map((n) => n.annotationId), ["note-first", "note-second"], "ordre du texte source, pas l'ordre de passage des annotations");
});

test("mapPresentationNotesToSlides : aucune annotation → aucune association inventée", () => {
  const markdown = "# Slide 1\n\nTexte.\n\n---\n\n# Slide 2\n\nAutre texte.";
  const slides = slidesFor(markdown);
  const result = mapPresentationNotesToSlides(markdown, slides, []);
  assert.equal(result.notesBySlide.size, 0);
  assert.deepEqual(result.unresolvedAnnotationIds, []);
});
