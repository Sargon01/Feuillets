import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeProse } from "../src/utils/literary-analysis.js";

test("analyzeProse : compte mots / phrases / paragraphes", () => {
  const r = analyzeProse("Le chat dort. Il ronronne doucement.\n\nUn autre paragraphe ici.");
  assert.equal(r.sentences, 3);
  assert.equal(r.paragraphs, 2);
  assert.ok(r.words >= 10);
});

test("analyzeProse : ignore frontmatter, commentaires et code", () => {
  const r = analyzeProse("---\ntitre: X\n---\nTexte réel.\n\n%%note%%\n\n```\ncode ignoré\n```");
  // seule « Texte réel. » compte comme prose
  assert.equal(r.sentences, 1);
  assert.equal(r.words, 2);
});

test("analyzeProse : longueur moyenne des phrases", () => {
  const r = analyzeProse("Un deux trois. Quatre cinq six sept huit neuf.");
  // 9 mots / 2 phrases = 4.5
  assert.ok(Math.abs(r.avgSentenceLength - 4.5) < 0.01);
});

test("analyzeProse : détecte les phrases de plus de 40 mots", () => {
  const longue = Array.from({ length: 45 }, (_, i) => `mot${i}`).join(" ") + ".";
  const r = analyzeProse(`Courte phrase. ${longue}`);
  assert.equal(r.longSentenceCount, 1);
  assert.equal(r.longSentences.length, 1);
});

test("analyzeProse : ratio dialogue (tirets et guillemets)", () => {
  const r = analyzeProse("— Bonjour toi.\n\nIl marcha longtemps sans dire un mot ni rien.");
  assert.ok(r.dialogueRatio > 0 && r.dialogueRatio < 1);
});

test("analyzeProse : texte vide ne plante pas", () => {
  const r = analyzeProse("");
  assert.equal(r.words, 0);
  assert.equal(r.dialogueRatio, 0);
  assert.equal(r.avgSentenceLength, 0);
});
