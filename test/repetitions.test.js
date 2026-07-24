import { test } from "node:test";
import assert from "node:assert/strict";
import { findRepetitions } from "../src/utils/repetitions.js";

test("findRepetitions : mots de contenu rapprochés signalés", () => {
  const r = findRepetitions("Le chat noir dormait. Le chat noir ronronnait.");
  const words = r.map((x) => x.norm).sort();
  assert.deepEqual(words, ["chat", "noir"]);
});

test("findRepetitions : ignore les mots-outils et les mots courts", () => {
  const r = findRepetitions("Il est là et il est là.");
  assert.equal(r.length, 0);
});

test("findRepetitions : accents/casse normalisés (même mot)", () => {
  const r = findRepetitions("Épée épée ÉPÉE brandie.");
  assert.equal(r.length, 1);
  assert.equal(r[0].norm, "epee");
  assert.equal(r[0].count, 3);
});

test("findRepetitions : hors fenêtre = non signalé", () => {
  const filler = Array.from({ length: 15 }, (_, i) => `remplissage${i}`).join(" ");
  const text = `soleil ${filler} soleil`;
  assert.equal(findRepetitions(text, { window: 5 }).length, 0);
  assert.equal(findRepetitions(text, { window: 30 }).length, 1);
});

test("findRepetitions : offsets exploitables pour naviguer", () => {
  const text = "brume épaisse puis brume claire";
  const r = findRepetitions(text);
  assert.equal(r.length, 1);
  assert.equal(text.slice(r[0].offsets[0], r[0].offsets[0] + 5), "brume");
});

test("findRepetitions : tri par répétition la plus rapprochée", () => {
  // "proche proche" (gap 1) doit passer avant "loin ... loin" (gap 6)
  const text = "proche proche remplir un deux trois quatre cinq loin encore loin";
  const r = findRepetitions(text, { window: 20 });
  assert.equal(r[0].norm, "proche");
});
