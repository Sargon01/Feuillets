import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { labelOf, labelsOf } from "../src/services/frontmatter.js";

function appWithFrontmatter(frontmatter) {
  return { metadataCache: { getFileCache: () => ({ frontmatter }) } };
}

test("labelOf : retourne le label principal lu par labelsOf", () => {
  const file = new TFile("Projet/Scène.md");
  assert.equal(labelOf(appWithFrontmatter({ label: "Rouge" }), file), "Rouge");
  assert.equal(labelOf(appWithFrontmatter({ label: ["Rouge", "Important"] }), file), "Rouge");
  assert.equal(labelOf(appWithFrontmatter({ labels: ["Bleu", "Secondaire"] }), file), "Bleu");
  assert.equal(labelOf(appWithFrontmatter({}), file), "");
});

test("labelsOf : conserve tous les labels", () => {
  const file = new TFile("Projet/Scène.md");
  assert.deepEqual(labelsOf(appWithFrontmatter({ label: ["Rouge", "Important"] }), file), ["Rouge", "Important"]);
  assert.deepEqual(labelsOf(appWithFrontmatter({ labels: ["Bleu", "Secondaire"] }), file), ["Bleu", "Secondaire"]);
});
