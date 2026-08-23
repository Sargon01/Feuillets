import assert from "node:assert/strict";
import test from "node:test";
import {
  presentationScale,
  presentationSlideIndexForLine,
  splitPresentationMarkdown,
  splitPresentationMarkdownWithRanges,
} from "../src/services/presentation.js";

/* Ce fichier ne couvre plus que le socle générique et neutre encore utilisé
   par les deux vues (réelle et prototype) : découpage Markdown et scaling
   du cadre. L'ancien moteur de composition (layouts, media-text, media-
   questions, fit/mediaScale) a été retiré — voir presentation-layout-engine.ts
   et presentation-slide-renderer.ts, désormais l'unique source de vérité. */

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

// ===== Plages de lignes (aperçu lié) =====

test("splitPresentationMarkdownWithRanges — A. 3 diapositives simples : plages correctes, markdown identique à splitPresentationMarkdown", () => {
  const markdown = "# Un\n---\n# Deux\n---\n# Trois";
  const plain = splitPresentationMarkdown(markdown);
  const ranged = splitPresentationMarkdownWithRanges(markdown);
  assert.deepEqual(ranged.map((s) => s.markdown), plain);
  assert.deepEqual(
    ranged.map((s) => [s.startLine, s.endLine]),
    [[0, 1], [2, 3], [4, 4]],
  );
});

test("splitPresentationMarkdownWithRanges — A bis. frontmatter décale les plages d'autant de lignes", () => {
  const markdown = "---\ntype: cours\n---\n# Un\n---\n# Deux";
  const plain = splitPresentationMarkdown(markdown);
  const ranged = splitPresentationMarkdownWithRanges(markdown);
  assert.deepEqual(ranged.map((s) => s.markdown), plain);
  assert.deepEqual(
    ranged.map((s) => [s.startLine, s.endLine]),
    [[3, 4], [5, 5]],
  );
});

test("splitPresentationMarkdownWithRanges — B. un séparateur dans une fence ne crée pas de diapositive, markdown et plages cohérents", () => {
  const markdown = "```text\n---\n```\n---\n# Deux";
  const plain = splitPresentationMarkdown(markdown);
  assert.deepEqual(plain, ["```text\n---\n```", "# Deux"]);
  const ranged = splitPresentationMarkdownWithRanges(markdown);
  assert.deepEqual(ranged.map((s) => s.markdown), plain);
  assert.deepEqual(
    ranged.map((s) => [s.startLine, s.endLine]),
    [[0, 3], [4, 4]],
  );
});

test("splitPresentationMarkdownWithRanges — C. curseur : première ligne, milieu, dernière ligne, ligne séparateur — la ligne « --- » appartient à la diapositive qu'elle CLÔT", () => {
  const markdown = "L0\nL1\nL2\n---\nM0\nM1\n---\nN0";
  const ranged = splitPresentationMarkdownWithRanges(markdown);
  assert.deepEqual(
    ranged.map((s) => [s.startLine, s.endLine]),
    [[0, 3], [4, 6], [7, 7]],
  );

  assert.equal(presentationSlideIndexForLine(ranged, 0), 0, "première ligne de la diapositive 0");
  assert.equal(presentationSlideIndexForLine(ranged, 1), 0, "milieu de la diapositive 0");
  assert.equal(presentationSlideIndexForLine(ranged, 2), 0, "dernière ligne de contenu de la diapositive 0");
  assert.equal(presentationSlideIndexForLine(ranged, 3), 0, "ligne séparateur : appartient à la diapositive précédente");
  assert.equal(presentationSlideIndexForLine(ranged, 4), 1, "première ligne de la diapositive 1");
  assert.equal(presentationSlideIndexForLine(ranged, 6), 1, "second séparateur : appartient à la diapositive 1");
  assert.equal(presentationSlideIndexForLine(ranged, 7), 2, "unique ligne de la diapositive 2");
});

test("splitPresentationMarkdownWithRanges — bornes : avant la première/après la dernière diapositive, et liste vide", () => {
  const ranged = splitPresentationMarkdownWithRanges("---\ntype: cours\n---\n# Un");
  assert.equal(presentationSlideIndexForLine(ranged, 0), 0, "ligne de frontmatter rattachée à la première diapositive");
  assert.equal(presentationSlideIndexForLine(ranged, 999), ranged.length - 1, "au-delà de la dernière ligne : dernière diapositive");
  assert.equal(presentationSlideIndexForLine([], 0), -1, "aucune diapositive : -1");
});

test("splitPresentationMarkdown : non-régression — délègue au scanner générique partagé sans changer le comportement", () => {
  assert.deepEqual(splitPresentationMarkdown("---\ntitle: Test\n---\n# Un\n---\n# Deux"), ["# Un", "# Deux"], "frontmatter YAML ne crée pas de diapositive");
  assert.deepEqual(splitPresentationMarkdown("# Un\n---\n# Deux"), ["# Un", "# Deux"], "--- normal crée toujours une diapositive");
  assert.deepEqual(splitPresentationMarkdown("```md\n---\n```\n---\n# Deux"), ["```md\n---\n```", "# Deux"], "--- dans une fence ne crée pas de diapositive");
  const markdown = "# Un\n---\n# Deux";
  assert.deepEqual(splitPresentationMarkdownWithRanges(markdown).map((s) => [s.startLine, s.endLine]), [[0, 1], [2, 2]], "plages identiques au comportement existant");
});
