import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripWritingNoise,
  countSentences,
  countParagraphs,
  formatNumber,
} from "../src/utils/text-metrics.js";

test("stripWritingNoise", async (t) => {
  await t.test("retire le frontmatter, les commentaires et le code", () => {
    const input = "---\ntitre: x\n---\nBonjour. %%note%% <!--c--> `code` texte.";
    assert.equal(stripWritingNoise(input), "Bonjour.    texte.");
  });

  await t.test("gère une entrée vide/nulle sans erreur", () => {
    assert.equal(stripWritingNoise(""), "");
    assert.equal(stripWritingNoise(undefined), "");
  });
});

test("countSentences", () => {
  assert.equal(countSentences("Bonjour. Comment vas-tu? Bien!"), 3);
  assert.equal(countSentences("Sans ponctuation finale"), 0);
});

test("countParagraphs", () => {
  assert.equal(countParagraphs("Un.\n\nDeux.\n\n\nTrois."), 3);
  assert.equal(countParagraphs("Un seul paragraphe."), 1);
  assert.equal(countParagraphs(""), 0);
});

test("formatNumber", () => {
  assert.equal(formatNumber(1234567), "1 234 567");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(undefined), "0");
});
