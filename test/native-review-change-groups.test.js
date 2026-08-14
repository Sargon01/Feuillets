import test from "node:test";
import assert from "node:assert/strict";
import { groupNativeReviewChanges } from "../src/services/native-review-change-groups.js";

test("groupes : cinq micro-changements proches forment une décision", () => {
  const base = "Ici on rajoute une phrase utile.";
  const words = ["Ici", "on", "rajoute", "une", "phrase"];
  let offset = 0;
  const changes = words.map((word) => { const start = base.indexOf(word, offset); offset = start + word.length; return { baseStart: start, baseEnd: start + word.length, oldText: word, newText: word.toUpperCase(), confidence: "safe", reason: "non-overlapping" }; });
  const groups = groupNativeReviewChanges("doc-1", changes, base);
  assert.equal(groups.length, 1); assert.deepEqual(groups[0].changeIndexes, [0, 1, 2, 3, 4]);
  assert.equal(groups[0].oldText, "Ici on rajoute une phrase"); assert.equal(groups[0].newText, "ICI ON RAJOUTE UNE PHRASE");
});

test("groupes : suppression et ajout distants ne sont pas fusionnés", () => {
  const base = "Départ avec beaucoup de texte entre les deux zones finales.";
  const changes = [
    { baseStart: 0, baseEnd: 6, oldText: "Départ", newText: "", confidence: "safe", reason: "non-overlapping" },
    { baseStart: base.length, baseEnd: base.length, oldText: "", newText: " Arrivée", confidence: "safe", reason: "non-overlapping" },
  ];
  const groups = groupNativeReviewChanges("doc", changes, base); assert.equal(groups.length, 2); assert.deepEqual(groups.map((group) => group.kind), ["deletion", "addition"]);
});

test("groupes : un saut de paragraphe et un déplacement lointain restent séparés", () => {
  const base = "Premier texte.\n\nSecond texte très loin.";
  const changes = [
    { baseStart: 0, baseEnd: 7, oldText: "Premier", newText: "Début", confidence: "safe", reason: "non-overlapping" },
    { baseStart: 17, baseEnd: 23, oldText: "Second", newText: "Suite", confidence: "safe", reason: "non-overlapping" },
  ];
  assert.equal(groupNativeReviewChanges("doc-1", changes, base).length, 2);
});

test("groupes : suppression et addition uniques d’un texte significatif forment un déplacement", () => {
  const moved = "Il prit son manteau et sortit de la pièce."; const base = `${moved}\n\nBien plus loin, la scène continuait sans lui.`;
  const changes = [
    { baseStart: 0, baseEnd: moved.length, currentStart: 0, currentEnd: moved.length, oldText: moved, newText: "", confidence: "safe", reason: "non-overlapping" },
    { baseStart: base.length, baseEnd: base.length, currentStart: base.length, currentEnd: base.length, oldText: "", newText: moved, confidence: "safe", reason: "non-overlapping" },
  ];
  const groups = groupNativeReviewChanges("doc", changes, base, base); assert.equal(groups.length, 1); assert.equal(groups[0].kind, "move"); assert.deepEqual(groups[0].changeIndexes, [0, 1]); assert.ok(groups[0].moveFrom); assert.ok(groups[0].moveTo);
});

test("groupes : un ajout indépendant tout proche n'empêche plus le déplacement d'être reconnu", () => {
  // Reproduction exacte du smoke test réel : un passage coupé-collé plus bas,
  // ET un second ajout indépendant qui atterrit juste à côté de sa
  // destination (même position brute, aucun saut de ligne entre les deux) —
  // de quoi les fusionner en un seul groupe à deux membres si rien ne les en
  // empêche, ce qui aurait rendu le déplacement invisible à detectMoves.
  const moved = "Il prit son manteau et sortit de la pièce sans un mot.";
  const base = `${moved}\n\nBien plus loin, la scène continuait sans lui.`;
  const independent = "Une phrase toute neuve, sans rapport avec le reste.";
  const changes = [
    { baseStart: 0, baseEnd: moved.length, oldText: moved, newText: "", confidence: "safe", reason: "non-overlapping" },
    { baseStart: base.length, baseEnd: base.length, oldText: "", newText: independent, confidence: "safe", reason: "non-overlapping" },
    { baseStart: base.length, baseEnd: base.length, oldText: "", newText: moved, confidence: "safe", reason: "non-overlapping" },
  ];
  const groups = groupNativeReviewChanges("doc", changes, base, base);
  const move = groups.find((group) => group.kind === "move");
  assert.ok(move, `un déplacement doit être reconnu malgré l'ajout voisin (obtenu : ${groups.map((g) => g.kind).join(", ")})`);
  assert.equal(move.oldText, moved); assert.equal(move.newText, moved);
  assert.ok(move.moveFrom && move.moveTo, "origine et destination sont toutes deux localisées");
  // L'ajout indépendant, lui, reste un ajout ordinaire — jamais absorbé par
  // le déplacement, jamais perdu.
  const addition = groups.find((group) => group.kind === "addition");
  assert.ok(addition, "l'ajout indépendant reste visible, séparément du déplacement");
  assert.equal(addition.newText, independent);
  assert.equal(groups.length, 2);
});

test("groupes : deux ajouts distincts mais non uniques, l'un significatif l'autre non, restent de simples ajouts adjacents", () => {
  // Garde-fou : un ajout significatif MAIS sans suppression correspondante
  // (donc réellement sans origine connue) ne doit jamais être confondu avec
  // un déplacement, même isolé et même collé à un autre ajout.
  const base = "Texte de base sans rapport.";
  const onlyAddition = "Un paragraphe tout nouveau, jamais présent auparavant nulle part.";
  const changes = [
    { baseStart: base.length, baseEnd: base.length, oldText: "", newText: "petit ajout, ", confidence: "safe", reason: "non-overlapping" },
    { baseStart: base.length, baseEnd: base.length, oldText: "", newText: onlyAddition, confidence: "safe", reason: "non-overlapping" },
  ];
  const groups = groupNativeReviewChanges("doc", changes, base, base);
  assert.equal(groups.length, 1, "toujours fusionnés : aucun des deux n'est un déplacement");
  assert.equal(groups[0].kind, "addition");
});

test("groupes : association répétée ou fragment trivial ne crée aucun déplacement", () => {
  const moved = "Une phrase assez longue pour être un déplacement certain."; const base = `${moved}\n${moved}\nDestination.`;
  const repeated = [
    { baseStart: 0, baseEnd: moved.length, oldText: moved, newText: "", confidence: "safe", reason: "non-overlapping" },
    { baseStart: moved.length + 1, baseEnd: moved.length * 2 + 1, oldText: moved, newText: "", confidence: "safe", reason: "non-overlapping" },
    { baseStart: base.length, baseEnd: base.length, oldText: "", newText: moved, confidence: "safe", reason: "non-overlapping" },
  ];
  assert.deepEqual(groupNativeReviewChanges("doc", repeated, base).map((group) => group.kind), ["deletion", "deletion", "addition"]);
  const trivial = [{ baseStart: 0, baseEnd: 3, oldText: "mot", newText: "", confidence: "safe" }, { baseStart: base.length, baseEnd: base.length, oldText: "", newText: "mot", confidence: "safe" }];
  assert.deepEqual(groupNativeReviewChanges("doc", trivial, base).map((group) => group.kind), ["deletion", "addition"]);
});
