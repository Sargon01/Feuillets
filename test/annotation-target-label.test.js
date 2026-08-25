import test from "node:test";
import assert from "node:assert/strict";
import { humanAnnotationTargetLabel } from "../src/utils/annotation-target-label.js";

test("titre : marqueurs # retirés", () => {
  assert.equal(humanAnnotationTargetLabel({ quote: "## I. L'Empire carolingien" }), "I. L'Empire carolingien");
  assert.equal(humanAnnotationTargetLabel({ quote: "# Titre simple" }), "Titre simple");
});

test("image wiki : alias en priorité, puis nom de fichier", () => {
  assert.equal(humanAnnotationTargetLabel({ quote: "![[carte.png|Ma légende]]" }), "Ma légende");
  assert.equal(humanAnnotationTargetLabel({ quote: "![[dossier/carte.png]]" }), "carte.png");
});

test("image Markdown : alt en priorité, puis nom de fichier", () => {
  assert.equal(humanAnnotationTargetLabel({ quote: "![Une légende](images/carte.png)" }), "Une légende");
  assert.equal(humanAnnotationTargetLabel({ quote: "![](images/carte.png)" }), "carte.png");
});

test("callout : titre en priorité, sinon type lisible", () => {
  assert.equal(humanAnnotationTargetLabel({ quote: "> [!questions] Mes questions\n> Ligne 1" }), "Mes questions");
  assert.equal(humanAnnotationTargetLabel({ quote: "> [!questions]\n> Ligne 1" }), "Questions");
});

test("sélection ordinaire : extrait nettoyé (stripMarkdown), jamais la syntaxe brute", () => {
  assert.equal(humanAnnotationTargetLabel({ quote: "**Texte** en gras" }), "Texte en gras");
});

test("citation vide : chaîne vide, jamais une exception", () => {
  assert.equal(humanAnnotationTargetLabel({ quote: "" }), "");
  assert.equal(humanAnnotationTargetLabel({ quote: "   " }), "");
});
