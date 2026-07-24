import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCitation } from "../src/services/citations.js";

test("formatCitation", async (t) => {
  const source = {
    auteur: "Antoine Prost",
    titre: "Douze leçons sur l'histoire",
    date: "1996",
    editeur: "Seuil",
  };

  await t.test("note de bas de page : auteur, titre en italique, éditeur, année, page", () => {
    assert.equal(
      formatCitation(source, "45", "footnote"),
      "Antoine Prost, *Douze leçons sur l'histoire*, Seuil, 1996, p. 45."
    );
  });

  await t.test("note de bas de page sans page précisée", () => {
    assert.equal(
      formatCitation(source, "", "footnote"),
      "Antoine Prost, *Douze leçons sur l'histoire*, Seuil, 1996."
    );
  });

  await t.test("auteur-date entre parenthèses, avec page", () => {
    assert.equal(formatCitation(source, "45", "parenthetical"), "(Antoine Prost, 1996, p. 45)");
  });

  await t.test("auteur-date entre parenthèses, sans page", () => {
    assert.equal(formatCitation(source, "", "parenthetical"), "(Antoine Prost, 1996)");
  });

  await t.test("champs manquants : ne casse rien, ignore juste ce qui est vide", () => {
    assert.equal(formatCitation({ auteur: "Prost" }, "12", "footnote"), "Prost, p. 12.");
    assert.equal(formatCitation({ auteur: "Prost" }, "", "parenthetical"), "(Prost)");
  });

  await t.test("fiche entièrement vide : chaîne vide, pas de ponctuation orpheline", () => {
    assert.equal(formatCitation({}, "", "footnote"), "");
    assert.equal(formatCitation({}, "", "parenthetical"), "");
    assert.equal(formatCitation(undefined, "", "footnote"), "");
  });

  await t.test("isRepeat : \"Ibid.\" plutôt que de répéter toute la référence", () => {
    assert.equal(formatCitation(source, "46", "footnote", true), "Ibid., p. 46.");
    assert.equal(formatCitation(source, "", "footnote", true), "Ibid.");
    assert.equal(formatCitation(source, "46", "parenthetical", true), "(Ibid., p. 46)");
    assert.equal(formatCitation(source, "", "parenthetical", true), "(Ibid.)");
  });
});
