import { test } from "node:test";
import assert from "node:assert/strict";
import { stripFrontmatter } from "../src/services/frontmatter.js";

/* Le YAML est une métadonnée, jamais du corps de manuscrit. Ce découpage a
 * UNE seule définition, partagée par la compilation et l'aperçu : deux
 * expressions régulières concurrentes, c'était exactement le défaut
 * constaté (l'aperçu montrait un frontmatter que l'export n'avait pas).
 *
 * Rappel de ce qui rendait ce défaut si visible : rendu en Markdown,
 * `---\ntitle: X\n---` n'est pas du « texte parasite » mais un TITRE setext
 * <h2> — donc un saut de page dans l'aperçu paginé. */

test("frontmatter — retiré en tête, corps conservé intact", () => {
  const body = "Premier paragraphe.\n\nSecond paragraphe.";
  assert.equal(stripFrontmatter(`---\ntitle: Scène 1\nstatus: brouillon\norder: 3\n---\n${body}`), body);
});

test("frontmatter — aucune clé de métadonnée ne survit au nettoyage", () => {
  const out = stripFrontmatter(
    "---\ntitle: Été\nstatus: relu\norder: 12\ntags: [roman, hiver]\n---\nLe vent se leva."
  );
  for (const key of ["title:", "status:", "order:", "tags:"]) {
    assert.equal(out.includes(key), false, `« ${key} » ne doit pas atteindre le rendu`);
  }
  assert.equal(out.includes("---"), false, "ni les délimiteurs");
  assert.equal(out, "Le vent se leva.");
});

test("frontmatter — fins de ligne CRLF (feuillet importé de Windows)", () => {
  assert.equal(stripFrontmatter("---\r\ntitle: X\r\n---\r\nTexte.\r\nSuite."), "Texte.\r\nSuite.");
});

test("frontmatter — bloc vide, et bloc vide en CRLF", () => {
  // Cas que l'ancienne expression régulière de la compilation laissait
  // passer : deux `---` fuyaient alors dans le texte compilé.
  assert.equal(stripFrontmatter("---\n---\nTexte."), "Texte.");
  assert.equal(stripFrontmatter("---\r\n---\r\nTexte."), "Texte.");
});

test("frontmatter — fichier sans frontmatter : contenu rendu tel quel", () => {
  const raw = "Il faisait nuit.\n\nEt puis plus rien.";
  assert.equal(stripFrontmatter(raw), raw);
  assert.equal(stripFrontmatter(""), "");
});

test("frontmatter — un séparateur horizontal légitime du CORPS n'est jamais touché", () => {
  const raw = "Première scène.\n\n---\n\nDeuxième scène.";
  assert.equal(stripFrontmatter(raw), raw, "un `---` en cours de texte reste un séparateur Markdown");

  // Et il survit au retrait d'un vrai frontmatter placé avant lui.
  const withFm = `---\ntitle: Chapitre\n---\n${raw}`;
  assert.equal(stripFrontmatter(withFm), raw);

  // Un seul bloc retiré, jamais « tout ce qui est entre deux --- ».
  assert.equal(
    stripFrontmatter("---\ntitle: A\n---\nDébut.\n\n---\n\nFin."),
    "Début.\n\n---\n\nFin."
  );
});

test("frontmatter — un document commençant par un séparateur non fermé reste intact", () => {
  const raw = "---\n\nOuverture en fanfare.";
  assert.equal(stripFrontmatter(raw), raw);
});

test("frontmatter — BOM en tête (import externe)", () => {
  assert.equal(stripFrontmatter("﻿---\ntitle: X\n---\nTexte."), "Texte.");
});
