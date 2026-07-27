import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchRegExp,
  preserveCase,
  replaceInText,
  splitFrontmatter,
} from "../src/services/manuscript-search-replace.js";

test("search-replace : préserve le frontmatter par défaut", () => {
  const content = "---\ntitle: Kemal\n---\nKemal retrouve kemal.";

  const result = replaceInText(content, "kemal", "Altan");

  assert.equal(result.newContent, "---\ntitle: Kemal\n---\nAltan retrouve altan.");
  assert.equal(result.count, 2);
});

test("search-replace : gère la casse et les diacritiques", () => {
  assert.equal(preserveCase("KEMAL", "Altan"), "ALTAN");
  assert.equal(preserveCase("Kemal", "altan"), "Altan");
  assert.ok(buildSearchRegExp("elodie", { ignoreDiacritics: true })?.test("Élodie"));
  assert.equal(replaceInText("Élodie", "elodie", "Jeanne", { ignoreDiacritics: true }).newContent, "Jeanne");
});

test("search-replace : accepte les captures regex et refuse un motif invalide", () => {
  const result = replaceInText("Chapitre 12", "(Chapitre) (\\d+)", "$2 — $1", { useRegex: true });

  assert.deepEqual(result, { newContent: "12 — Chapitre", count: 1 });
  assert.equal(buildSearchRegExp("[", { useRegex: true }), null);
});

test("search-replace : sépare uniquement un frontmatter initial", () => {
  assert.deepEqual(splitFrontmatter("Texte\n---\nSuite"), { frontmatter: "", body: "Texte\n---\nSuite" });
});
