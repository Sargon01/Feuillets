import test from "node:test";
import assert from "node:assert/strict";
import { extractContextWindow } from "../src/services/context-window.js";

const PARA_A = "Paragraphe A, première ligne.";
const PARA_B = "Paragraphe B, ligne un.\nParagraphe B, ligne deux.";
const PARA_C = "Paragraphe C, seule ligne.";

function buildText(...paragraphs) {
  return paragraphs.join("\n\n");
}

test("premier paragraphe : pas de précédent, courant + suivant seulement", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf(PARA_A) + 3; // quelque part dans le premier paragraphe
  assert.equal(extractContextWindow(text, offset), [PARA_A, PARA_B].join("\n\n"));
});

test("paragraphe du milieu : précédent + courant + suivant réunis", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf("ligne deux");
  assert.equal(extractContextWindow(text, offset), [PARA_A, PARA_B, PARA_C].join("\n\n"));
});

test("dernier paragraphe : précédent + courant seulement, pas de suivant", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf(PARA_C) + 5;
  assert.equal(extractContextWindow(text, offset), [PARA_B, PARA_C].join("\n\n"));
});

test("frontmatter YAML exclu du résultat et de la position du curseur", () => {
  const fm = "---\ntitle: Test\ntags: [a, b]\n---\n";
  const text = fm + buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf("ligne deux");

  const result = extractContextWindow(text, offset);
  assert.equal(result, [PARA_A, PARA_B, PARA_C].join("\n\n"));
  assert.equal(result.includes("title: Test"), false);
  assert.equal(result.includes("---"), false);
});

test("un offset tombant DANS le frontmatter est ramené au tout début du corps", () => {
  const fm = "---\ntitle: Test\n---\n";
  const text = fm + buildText(PARA_A, PARA_B, PARA_C);
  const offset = 2; // en plein dans le bloc frontmatter
  assert.equal(extractContextWindow(text, offset), [PARA_A, PARA_B].join("\n\n"));
});

test("offset hors limites : négatif borné à 0", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  assert.equal(extractContextWindow(text, -500), [PARA_A, PARA_B].join("\n\n"));
});

test("offset hors limites : trop grand borné à la fin du texte", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  assert.equal(extractContextWindow(text, text.length + 999), [PARA_B, PARA_C].join("\n\n"));
});

test("offset non fini (NaN) traité comme 0, sans lever d'erreur", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  assert.equal(extractContextWindow(text, Number.NaN), [PARA_A, PARA_B].join("\n\n"));
});

test("texte vide : chaîne vide, sans erreur", () => {
  assert.equal(extractContextWindow("", 0), "");
  assert.equal(extractContextWindow("", 50), "");
});

test("plusieurs lignes vides consécutives comptent comme un seul séparateur", () => {
  const text = `${PARA_A}\n\n\n\n${PARA_B}`;
  const offset = text.indexOf(PARA_B) + 2;
  assert.equal(extractContextWindow(text, offset), [PARA_A, PARA_B].join("\n\n"));
});

test("radius 0 : uniquement le paragraphe courant", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf("ligne deux");
  assert.equal(extractContextWindow(text, offset, 0), PARA_B);
});

test("un seul paragraphe dans tout le texte : fenêtre réduite à lui-même", () => {
  const text = PARA_A;
  assert.equal(extractContextWindow(text, 3), PARA_A);
});
