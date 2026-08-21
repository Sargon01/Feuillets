import test from "node:test";
import assert from "node:assert/strict";
import { planTextFragmentMove } from "../src/utils/text-fragment-reorder-core.js";

function apply(text, plan) {
  return text.slice(0, plan.from) + plan.insert + text.slice(plan.to);
}

/* --- §42 : target AVANT la source ------------------------------------------ */

test("planTextFragmentMove : déplacer « bravo » avant « Alpha »", () => {
  // 0123456789012345678901234
  // Alpha bravo charlie delta.
  const text = "Alpha bravo charlie delta.";
  const sourceFrom = 6; // "bravo "
  const sourceTo = 12;
  assert.equal(text.slice(sourceFrom, sourceTo), "bravo ");
  const target = 0; // avant "Alpha"

  const plan = planTextFragmentMove(text, sourceFrom, sourceTo, target);
  assert.ok(plan);
  assert.equal(plan.from, 0);
  assert.equal(plan.to, 12);
  assert.equal(plan.insert, "bravo Alpha ");
  assert.equal(plan.selectionFrom, 0);
  assert.equal(plan.selectionTo, 6);

  const result = apply(text, plan);
  assert.equal(result, "bravo Alpha charlie delta.");
  assert.equal(result.length, text.length);
});

/* --- §43 : target APRÈS la source ------------------------------------------ */

test("planTextFragmentMove : déplacer « bravo » après « delta »", () => {
  const text = "Alpha bravo charlie delta.";
  const sourceFrom = 6; // "bravo "
  const sourceTo = 12;
  const length = sourceTo - sourceFrom;
  const target = text.length; // toute fin de chaîne

  const plan = planTextFragmentMove(text, sourceFrom, sourceTo, target);
  assert.ok(plan);
  assert.equal(plan.from, 6);
  assert.equal(plan.to, text.length);
  assert.equal(plan.insert, "charlie delta.bravo ");
  assert.equal(plan.selectionFrom, target - length);
  assert.equal(plan.selectionTo, target);

  const result = apply(text, plan);
  assert.equal(result, "Alpha charlie delta.bravo ");
  assert.equal(result.length, text.length);
});

/* --- §44 : no-op ------------------------------------------------------------- */

test("planTextFragmentMove : target sur les bornes ou à l'intérieur de la source produit null", () => {
  const text = "Alpha bravo charlie delta.";
  const sourceFrom = 6;
  const sourceTo = 12;
  assert.equal(planTextFragmentMove(text, sourceFrom, sourceTo, sourceFrom), null); // target === sourceFrom
  assert.equal(planTextFragmentMove(text, sourceFrom, sourceTo, sourceTo), null); // target === sourceTo
  assert.equal(planTextFragmentMove(text, sourceFrom, sourceTo, 9), null); // au milieu de la source
});

test("planTextFragmentMove : sélection vide ou inversée produit null", () => {
  const text = "Alpha bravo charlie delta.";
  assert.equal(planTextFragmentMove(text, 6, 6, 0), null);
  assert.equal(planTextFragmentMove(text, 12, 6, 0), null);
});

test("planTextFragmentMove : target hors bornes du texte produit null", () => {
  const text = "Alpha bravo charlie delta.";
  assert.equal(planTextFragmentMove(text, 6, 12, -1), null);
  assert.equal(planTextFragmentMove(text, 6, 12, text.length + 1), null);
});

/* --- §45 : whitespace exact, aucune normalisation --------------------------- */

test("planTextFragmentMove : espace double conservé tel quel, aucun trim", () => {
  // "AAA  BBB CCC" : sélection exacte "BBB" (sans les espaces environnants)
  const text = "AAA  BBB CCC";
  const sourceFrom = text.indexOf("BBB");
  const sourceTo = sourceFrom + 3;
  const plan = planTextFragmentMove(text, sourceFrom, sourceTo, 0); // avant AAA
  assert.ok(plan);
  const result = apply(text, plan);
  // Les deux espaces qui précédaient BBB restent groupés à leur place
  // d'origine, juste après "BBB" désormais déplacé en tête — le moteur ne
  // corrige rien, ne fusionne rien.
  assert.equal(result, "BBBAAA   CCC");
  assert.equal(result.length, text.length);
});

test("planTextFragmentMove : tabulation dans le texte intermédiaire préservée telle quelle", () => {
  const text = "AAA\tBBB\tCCC";
  const sourceFrom = text.indexOf("BBB");
  const sourceTo = sourceFrom + 3;
  const plan = planTextFragmentMove(text, sourceFrom, sourceTo, text.length);
  assert.ok(plan);
  const result = apply(text, plan);
  assert.equal(result, "AAA\t\tCCCBBB");
});

test("planTextFragmentMove : ponctuation collée à la sélection, jamais réparée", () => {
  const text = "Il entra dans la vieille maison sans bruit.";
  const sourceFrom = text.indexOf("dans la vieille maison");
  const sourceTo = sourceFrom + "dans la vieille maison".length;
  const plan = planTextFragmentMove(text, sourceFrom, sourceTo, text.length);
  assert.ok(plan);
  const result = apply(text, plan);
  assert.equal(result, "Il entra  sans bruit.dans la vieille maison");
});

test("planTextFragmentMove : CRLF dans le texte intermédiaire n'est jamais touché", () => {
  const text = "AAA\r\nBBB\r\nCCC";
  const sourceFrom = text.indexOf("BBB");
  const sourceTo = sourceFrom + 3;
  const plan = planTextFragmentMove(text, sourceFrom, sourceTo, 0);
  assert.ok(plan);
  const result = apply(text, plan);
  assert.equal(result, "BBBAAA\r\n\r\nCCC");
  const sortChars = (s) => s.split("").sort().join("");
  assert.equal(sortChars(result), sortChars(text));
});

/* --- Garde-fou supplémentaire : longueur totale toujours préservée --------- */

test("planTextFragmentMove : longueur du document identique avant/après, quel que soit target", () => {
  const text = "Un texte assez long pour tester plusieurs cibles possibles ici.";
  const sourceFrom = text.indexOf("assez long");
  const sourceTo = sourceFrom + "assez long".length;
  for (const target of [0, 5, sourceFrom - 1, sourceTo + 1, text.length]) {
    const plan = planTextFragmentMove(text, sourceFrom, sourceTo, target);
    if (!plan) continue;
    const result = apply(text, plan);
    assert.equal(result.length, text.length);
    const sortChars = (s) => s.split("").sort().join("");
    assert.equal(sortChars(result), sortChars(text));
  }
});
