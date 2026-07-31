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

test("analyzeProse : une liste Markdown à tirets n'est jamais du dialogue", () => {
  const r = analyzeProse("- Premier point important.\n- Deuxième point à considérer ici.\n- Troisième et dernier point.");
  assert.equal(r.dialogueRatio, 0);
});

test("analyzeProse : un titre Markdown n'est jamais du dialogue", () => {
  const r = analyzeProse("# Chapitre premier\n\nLe vent soufflait doucement sur la lande déserte ce soir-là.");
  assert.equal(r.dialogueRatio, 0);
});

test("analyzeProse : citation et séparateur ne sont jamais du dialogue", () => {
  const r = analyzeProse("> Une pensée célèbre à méditer.\n\n---\n\nLe récit reprend son cours normalement ici.");
  assert.equal(r.dialogueRatio, 0);
});

test("analyzeProse : une vraie réplique au tiret cadratin est reconnue", () => {
  const r = analyzeProse("— Je ne partirai pas sans toi, dit-elle fermement.");
  assert.ok(r.dialogueRatio > 0.5);
});

test("analyzeProse : un simple trait d'union ASCII n'ouvre jamais une réplique", () => {
  const r = analyzeProse("- Ceci ressemble à une puce, pas à une réplique de dialogue.");
  assert.equal(r.dialogueRatio, 0);
});

test("analyzeProse : une vraie réplique entre guillemets français est reconnue", () => {
  const r = analyzeProse("Elle s'approcha et dit : « Je ne partirai pas sans toi ce soir. »");
  assert.ok(r.dialogueRatio > 0);
});

test("analyzeProse : citer un mot ou un titre court entre guillemets n'est pas du dialogue", () => {
  const r = analyzeProse("Il referma « le journal » et retourna travailler sans un mot de plus aujourd'hui.");
  assert.equal(r.dialogueRatio, 0);
});

test("analyzeProse : le ratio se calcule sur les mots réellement dialogués, pas la ligne entière", () => {
  // Le paragraphe entier compte une dizaine de mots, mais seule la réplique
  // de 3 mots entre guillemets est dialoguée — un ratio calculé sur la
  // longueur brute du paragraphe (11/11 = 100 %) serait bien trop élevé.
  const r = analyzeProse("Elle hésita un long moment avant de répondre : « Viens avec moi. »");
  assert.ok(r.dialogueRatio > 0);
  assert.ok(r.dialogueRatio < 0.5);
});

test("analyzeProse : texte vide ne plante pas", () => {
  const r = analyzeProse("");
  assert.equal(r.words, 0);
  assert.equal(r.dialogueRatio, 0);
  assert.equal(r.avgSentenceLength, 0);
});
