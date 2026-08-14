import test from "node:test";
import assert from "node:assert/strict";
import { adjacentComparisonChange, comparisonChanges, comparisonEdits, comparisonRightOffsets, nextPendingComparisonChange } from "../src/services/comparison-model.js";
import { comparisonSummaryLabel } from "../src/views/comparison-view.js";

const change = (index, overrides = {}) => ({ index, kind: "replacement", rightStart: index, rightEnd: index + 1, oldText: "a", newText: "b", applicable: true, handled: false, changeIndexes: [index], ...overrides });

test("comparaison : un seul moteur de diff pour Relecture et Snapshots", () => {
  assert.deepEqual(comparisonEdits("ab cd ef", "ab XY cd ef"), [{ baseStart: 3, baseEnd: 3, oldText: "", newText: "XY " }]);
  assert.deepEqual(comparisonRightOffsets([{ baseStart: 0, oldText: "Un", newText: "UN et" }, { baseStart: 10, oldText: "x", newText: "" }]), [0, 13]);
});

test("comparaison snapshot : chaque différence est située des DEUX côtés", () => {
  const left = "Le chat dort sur le tapis rouge et chaud.";
  const right = "Le chien dort sur le tapis rouge et chaud.";
  const [first, ...rest] = comparisonChanges(left, right);
  assert.equal(rest.length, 0);
  assert.equal(left.slice(first.leftStart, first.leftEnd), first.oldText);
  assert.equal(right.slice(first.rightStart, first.rightEnd), first.newText);
  assert.equal(first.applicable, true, "le texte de gauche est la base : la restauration est toujours possible");
  assert.equal(first.handled, false);
});

test("comparaison snapshot : appliquer un passage puis rediffer fait disparaître la différence", () => {
  const left = "Le chat dort sur le tapis rouge et chaud.";
  const right = "Le chien dort sur le tapis rouge et chaud.";
  const [first] = comparisonChanges(left, right);
  const restored = left.slice(0, first.leftStart) + first.newText + left.slice(first.leftEnd);
  assert.equal(restored, right);
  assert.deepEqual(comparisonChanges(restored, right), []);
});

test("comparaison snapshot : un couper/coller devient un déplacement, origine à gauche et destination à droite", () => {
  const left = "Alpha reste ici tranquille. Il prit son manteau et sortit de la piece rapidement. Beta arrive ensuite doucement.";
  const right = "Il prit son manteau et sortit de la piece rapidement. Alpha reste ici tranquille. Beta arrive ensuite doucement.";
  const [move, ...rest] = comparisonChanges(left, right);
  assert.equal(rest.length, 0);
  assert.equal(move.kind, "move");
  assert.equal(left.slice(move.leftStart, move.leftEnd), "Alpha reste ici tranquille. ", "l'origine se lit dans le texte de GAUCHE");
  assert.equal(right.slice(move.rightStart, move.rightEnd), "Alpha reste ici tranquille. ", "la destination se lit dans le texte de DROITE");
  assert.equal(move.oldText, move.newText, "même passage aux deux emplacements");
});

test("comparaison : Précédent / Suivant ne sont qu'une navigation, jamais une condition d'action", () => {
  const changes = [change(0, { handled: true }), change(1), change(2)];
  assert.equal(adjacentComparisonChange(changes, null, 1), 1, "sans sélection, on part du premier restant");
  assert.equal(adjacentComparisonChange(changes, 1, 1), 2);
  assert.equal(adjacentComparisonChange(changes, 2, 1), null);
  assert.equal(adjacentComparisonChange(changes, 2, -1), 1);
  assert.equal(adjacentComparisonChange(changes, 0, 1), 1, "un changement traité reste un repère de navigation");
  assert.equal(adjacentComparisonChange(changes.map((item) => ({ ...item, handled: true })), null, 1), null);
});

test("comparaison : après une décision, on enchaîne sur le changement suivant à traiter", () => {
  const changes = [change(0, { handled: true }), change(1), change(2)];
  assert.equal(nextPendingComparisonChange(changes, 0), 1);
  assert.equal(nextPendingComparisonChange(changes, 1), 2);
  assert.equal(nextPendingComparisonChange(changes, 2), 1, "on boucle sur ce qui reste plutôt que de perdre la place");
  assert.equal(nextPendingComparisonChange(changes.map((item) => ({ ...item, handled: true })), 0), null);
});

test("comparaison : pluriels justes", () => {
  assert.equal(comparisonSummaryLabel(5, 1), "5 changements · 1 note");
  assert.equal(comparisonSummaryLabel(1, 2), "1 changement · 2 notes");
  assert.equal(comparisonSummaryLabel(0, 0), "0 changement · 0 note");
});

/* --- Normalisation du diff : isoler un fragment déplacé --------------------
 * Reproduction réelle, à partir de DEUX TEXTES COMPLETS (jamais des
 * changements fabriqués à la main) : le passage déplacé ressort du diff brut
 * comme une suppression AUTONOME à l'origine, mais atterrit CONTRE un ajout
 * indépendant à la destination (aucun texte inchangé entre les deux) — le
 * diff les fond en une seule et même édition. C'est exactement la cause
 * tracée : comparisonEdits() produit un « gros edit » qui contient le
 * passage déplacé, et detectMoves() ne peut alors jamais l'isoler tant qu'il
 * n'existe pas comme édition à lui seul. */
const movedPassage = "Dans le silence du cabinet de réflexion, une bougie vacillait faiblement.";
const anchorPassage = "En tant qu'enfant exilé loin de sa terre natale, il n'avait jamais imaginé qu'un jour il reviendrait dans cette maison qui avait vu grandir tant de générations avant lui, et pourtant le voilà, debout, immobile, incapable de faire un pas de plus vers la porte qui l'attendait.";
const independentNear = "Un deux trois c'est un ajout.";
const independentEnd = "Ici il y a un ajout.";
const movedBefore = `${movedPassage}\n\n${anchorPassage}`;
const movedAfter = `${anchorPassage}\n${independentNear}\n${movedPassage}\n${independentEnd}`;

test("déplacement réel (B) : un ajout indépendant tout proche de la destination n'empêche plus le déplacement d'être reconnu", () => {
  const changes = comparisonChanges(movedBefore, movedAfter);
  const moves = changes.filter((change) => change.kind === "move");
  assert.equal(moves.length, 1, `exactement un déplacement (obtenu : ${changes.map((c) => c.kind).join(", ")})`);
  // L'origine (suppression, jamais retouchée) garde son texte réel — ici
  // suivi du saut de paragraphe qui la séparait de l'ancre ; la destination
  // (extraite de l'ajout voisin) est le fragment exact, sans bordure.
  assert.equal(moves[0].oldText.trim(), movedPassage); assert.equal(moves[0].newText, movedPassage);
  // Jamais move ET suppression/ajout du même passage : aucun autre changement
  // ne porte ce texte.
  const others = changes.filter((change) => change !== moves[0]);
  assert.ok(others.every((change) => change.oldText.trim() !== movedPassage && change.newText.trim() !== movedPassage), "le passage déplacé n'apparaît nulle part ailleurs");
  // Les changements résiduels ordinaires restent corrects : les deux ajouts
  // indépendants, chacun séparément — jamais absorbés par le déplacement.
  const additions = changes.filter((change) => change.kind === "addition");
  assert.deepEqual(additions.map((change) => change.newText.trim()), [independentNear, independentEnd]);
  // Le moteur situe bien l'origine à gauche et la destination à droite —
  // reconstruction exacte au niveau du diff brut, elle, vérifiée par (E).
  assert.equal(movedBefore.slice(moves[0].leftStart, moves[0].leftEnd).trim(), movedPassage);
  assert.equal(movedAfter.slice(moves[0].rightStart, moves[0].rightEnd), movedPassage);
});

test("symétrie Relecture (C) : le même scénario, dans le sens utilisé par comparisonEdits/nativeReviewEdits", () => {
  // nativeReviewEdits n'est qu'un alias de comparisonEdits (voir
  // native-review-author-return.ts) : la normalisation profite donc aux deux
  // sans code séparé — ce test le vérifie directement sur la fonction que la
  // Relecture appelle réellement, dans SON sens (base → texte du relecteur).
  const edits = comparisonEdits(movedBefore, movedAfter);
  const deletionOfMoved = edits.filter((edit) => edit.newText === "" && edit.oldText.trim() === movedPassage);
  const additionOfMoved = edits.filter((edit) => edit.oldText === "" && edit.newText.trim() === movedPassage);
  assert.equal(deletionOfMoved.length, 1, "l'origine existe comme édition isolée");
  assert.equal(additionOfMoved.length, 1, "la destination existe comme édition isolée — plus jamais fondue dans un ajout voisin");
});

test("ambiguïté (D) : la même phrase présente plusieurs fois n'invente jamais de déplacement", () => {
  const phrase = "Il prit son manteau et sortit de la pièce sans un mot.";
  const before = `${phrase}\n\n${phrase}\n\nDestination possible.`;
  const after = `Destination possible.\nUn ajout tout proche.\n${phrase}`;
  const changes = comparisonChanges(before, after);
  assert.ok(changes.every((change) => change.kind !== "move"), `aucun déplacement inventé pour un passage ambigu (obtenu : ${changes.map((c) => c.kind).join(", ")})`);
});

test("invariant du diff (E) : comparisonEdits(base, changed) appliqué à base reconstruit exactement changed", () => {
  const fixtures = [
    [movedBefore, movedAfter],
    ["ab cd ef", "ab XY cd Z"],
    ["Le chat dort sur le tapis rouge et chaud.", "Le chien dort sur le tapis rouge et chaud."],
    ["Alpha reste ici tranquille. Il prit son manteau et sortit de la piece rapidement. Beta arrive ensuite doucement.", "Il prit son manteau et sortit de la piece rapidement. Alpha reste ici tranquille. Beta arrive ensuite doucement."],
    [`${movedPassage}\n\n${movedPassage}\n\nDestination possible.`, `Destination possible.\nUn ajout tout proche.\n${movedPassage}`],
    ["", ""], ["Rien ne change ici.", "Rien ne change ici."], ["Tout disparaît.", ""], ["", "Tout apparaît."],
  ];
  for (const [base, changed] of fixtures) {
    const edits = comparisonEdits(base, changed);
    let rebuilt = ""; let cursor = 0;
    for (const edit of edits) { rebuilt += base.slice(cursor, edit.baseStart) + edit.newText; cursor = edit.baseEnd; }
    rebuilt += base.slice(cursor);
    assert.equal(rebuilt, changed, `reconstruction fidèle pour « ${base.slice(0, 24)}… »`);
  }
});
