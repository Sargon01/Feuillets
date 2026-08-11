import test from "node:test";
import assert from "node:assert/strict";
import {
  extractManuscriptHeadings,
  generateSummary,
  generateTableOfContents,
} from "../src/services/contents-generator.js";

function seg(text, frontType = null, path = null) {
  return { path, text, frontType };
}

test("extractManuscriptHeadings : ignore les pages Front", () => {
  const segments = [
    seg("# Page de titre", "titre", "Front/Page de titre.md"),
    seg(":::épigraphe: quelque chose", "epigraphe", "Front/Épigraphe.md"),
    seg("# Partie I\n\nTexte."),
  ];
  const headings = extractManuscriptHeadings(segments);
  assert.deepEqual(headings, [{ level: 1, title: "Partie I" }]);
});

test("extractManuscriptHeadings : conserve l'ordre réel, tous niveaux confondus", () => {
  const segments = [
    seg("# Partie I"),
    seg("## Chapitre 1\n\nTexte du chapitre."),
    seg("### Départ\n\nPremier texte."),
    seg("### Le secret\n\nDeuxième texte."),
    seg("## Chapitre 2"),
  ];
  const headings = extractManuscriptHeadings(segments);
  assert.deepEqual(headings, [
    { level: 1, title: "Partie I" },
    { level: 2, title: "Chapitre 1" },
    { level: 3, title: "Départ" },
    { level: 3, title: "Le secret" },
    { level: 2, title: "Chapitre 2" },
  ]);
});

test("extractManuscriptHeadings : plusieurs titres dans un même segment sont tous extraits", () => {
  const segments = [seg("## Chapitre 1\n\n### Départ\n\nTexte.")];
  assert.deepEqual(extractManuscriptHeadings(segments), [
    { level: 2, title: "Chapitre 1" },
    { level: 3, title: "Départ" },
  ]);
});

test("extractManuscriptHeadings : aucun titre -> liste vide", () => {
  assert.deepEqual(extractManuscriptHeadings([seg("Juste du texte, sans titre.")]), []);
});

test("generateSummary : titre # Sommaire, seulement les deux premiers niveaux, ordre conservé", () => {
  const segments = [
    seg("# Partie I"),
    seg("## Chapitre 1"),
    seg("### Départ\n\nTexte."),
    seg("## Chapitre 2"),
    seg("# Partie II"),
  ];
  const text = generateSummary(segments);
  assert.match(text, /^# Sommaire/);
  assert.doesNotMatch(text, /Départ/, "les titres de niveau 3 n'apparaissent pas dans le Sommaire");
  const lines = text.trim().split("\n").filter((l) => l.startsWith("-"));
  assert.deepEqual(lines, ["- Partie I", "- Chapitre 1", "- Chapitre 2", "- Partie II"]);
});

test("generateSummary : ignore les pages Front", () => {
  const segments = [seg("# Page de titre", "titre"), seg("# Partie I")];
  const text = generateSummary(segments);
  const lines = text.trim().split("\n").filter((l) => l.startsWith("-"));
  assert.deepEqual(lines, ["- Partie I"]);
});

test("generateSummary : aucun titre -> juste l'entête, sans liste", () => {
  assert.equal(generateSummary([seg("Texte sans titre.")]), "# Sommaire\n");
});

test("generateTableOfContents : titre # Table des matières, tous les niveaux, indentés, ordre conservé", () => {
  const segments = [
    seg("# Partie I"),
    seg("## Chapitre 1"),
    seg("### Départ\n\nTexte."),
    seg("### Le secret\n\nTexte."),
    seg("## Chapitre 2"),
  ];
  const text = generateTableOfContents(segments);
  assert.match(text, /^# Table des matières/);
  const lines = text.split("\n").slice(2).filter(Boolean);
  assert.deepEqual(lines, [
    "- Partie I",
    "  - Chapitre 1",
    "    - Départ",
    "    - Le secret",
    "  - Chapitre 2",
  ]);
});

test("generateTableOfContents : ignore les pages Front", () => {
  const segments = [seg(":::titre: Mon roman", "titre"), seg("# Partie I")];
  const text = generateTableOfContents(segments);
  assert.doesNotMatch(text, /Mon roman/);
  assert.match(text, /- Partie I/);
});

test("generateTableOfContents : aucun titre -> juste l'entête, sans liste", () => {
  assert.equal(generateTableOfContents([seg("Texte sans titre.")]), "# Table des matières\n");
});
