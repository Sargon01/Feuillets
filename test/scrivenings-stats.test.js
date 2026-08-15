import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { buildScriveningsDocument } from "../src/services/scrivenings-document.js";
import {
  computeScriveningsWordCounts,
  updateScriveningsWordCounts,
  scriveningsStatsFromCounts,
  formatScriveningsStats,
} from "../src/utils/scrivenings-stats.js";
import { countWords } from "../src/utils/core.js";
import { formatNumber } from "../src/utils/text-metrics.js";

/* Lot 2B.2 §6 — statistiques du groupe : ce module ne doit JAMAIS créer un
 * second compteur de mots, seulement réutiliser `countWords` (utils/core.ts)
 * sur `segment.body` — jamais le frontmatter, les titres widgets ou les
 * jonctions structurelles, qui n'existent que dans le texte composite
 * CodeMirror, jamais dans `segment.body` lui-même. */

function entriesFrom(pairs) {
  const files = pairs.map(([path]) => new TFile(path));
  return pairs.map(([, content], i) => ({ file: files[i], content }));
}

test("computeScriveningsWordCounts : 3 segments -> fileCount = 3, somme correcte", () => {
  const doc = buildScriveningsDocument(
    entriesFrom([
      ["A.md", "---\ntitle: A\n---\nUn deux trois"],
      ["B.md", "Quatre cinq"],
      ["C.md", "Six"],
    ])
  );

  const counts = computeScriveningsWordCounts(doc);
  const stats = scriveningsStatsFromCounts(doc, counts);

  assert.equal(stats.fileCount, 3);
  assert.equal(stats.wordCount, countWords("Un deux trois") + countWords("Quatre cinq") + countWords("Six"));
  assert.equal(stats.wordCount, 6);
});

test("computeScriveningsWordCounts : le frontmatter n'est jamais compté (déjà hors segment.body)", () => {
  const doc = buildScriveningsDocument(entriesFrom([["A.md", "---\ntitle: Un titre de trois mots\n---\nSeul"]]));
  const stats = scriveningsStatsFromCounts(doc, computeScriveningsWordCounts(doc));
  assert.equal(stats.wordCount, 1);
});

test("updateScriveningsWordCounts : ne recalcule QUE les chemins touchés", () => {
  const doc = buildScriveningsDocument(
    entriesFrom([
      ["A.md", "Un mot"],
      ["B.md", "Deux mots ici"],
    ])
  );
  const initial = computeScriveningsWordCounts(doc);

  // Modifie B.md dans le document (édition simulée) SANS toucher au compte
  // déjà connu de A.md — updateScriveningsWordCounts ne doit jamais le
  // recalculer, même si son body était en réalité inchangé ici.
  const editedDoc = {
    ...doc,
    segments: doc.segments.map((s) => (s.path === "B.md" ? { ...s, body: "Deux mots seulement maintenant" } : s)),
  };

  const next = updateScriveningsWordCounts(editedDoc, ["B.md"], initial);

  assert.equal(next.get("A.md"), initial.get("A.md"), "A.md non touché : compte conservé tel quel");
  assert.equal(next.get("B.md"), countWords("Deux mots seulement maintenant"));
});

test("updateScriveningsWordCounts : retire un chemin qui n'appartient plus au document (recomposition)", () => {
  const doc = buildScriveningsDocument(
    entriesFrom([
      ["A.md", "Un"],
      ["B.md", "Deux"],
    ])
  );
  const initial = computeScriveningsWordCounts(doc);

  const afterRemoval = buildScriveningsDocument(entriesFrom([["A.md", "Un"]]));
  const next = updateScriveningsWordCounts(afterRemoval, [], initial);

  assert.equal(next.has("B.md"), false);
  assert.equal(next.get("A.md"), 1);
});

test("scriveningsStatsFromCounts : fileCount vient toujours des segments réels, jamais de wordCounts.size", () => {
  const doc = buildScriveningsDocument(entriesFrom([["A.md", "Un"]]));
  // Table de comptes volontairement désynchronisée (chemin fantôme en trop).
  const counts = new Map([
    ["A.md", 1],
    ["fantome.md", 42],
  ]);
  const stats = scriveningsStatsFromCounts(doc, counts);
  assert.equal(stats.fileCount, 1);
  assert.equal(stats.wordCount, 1, "le compte fantôme ne doit jamais être additionné");
});

test("formatScriveningsStats (fr) : singulier/pluriel gérés séparément pour feuillets et mots", () => {
  assert.equal(formatScriveningsStats({ fileCount: 1, wordCount: 1 }), "1 feuillet · 1 mot");
  assert.equal(
    formatScriveningsStats({ fileCount: 7, wordCount: 8432 }),
    `7 feuillets · ${formatNumber(8432)} mots`
  );
  assert.equal(formatScriveningsStats({ fileCount: 0, wordCount: 0 }), "0 feuillets · 0 mots");
  assert.equal(formatScriveningsStats({ fileCount: 1, wordCount: 3 }), "1 feuillet · 3 mots");
});
