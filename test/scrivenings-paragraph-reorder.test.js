import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { buildScriveningsDocument, boundaryOffsets, segmentAt } from "../src/services/scrivenings-document.js";
import { scriveningsExtensions, scriveningsBoundariesField } from "../src/utils/cm-scrivenings.js";
import {
  segmentRangeFromBoundaries,
  inSameSegment,
  createParagraphReorderExtension,
  paragraphReorderModeField,
} from "../src/utils/cm-paragraph-reorder.js";
import { resolveMarkdownBlocks, planParagraphMove } from "../src/utils/paragraph-reorder-core.js";

function docFrom(pairs) {
  const entries = pairs.map(([path, content]) => ({ file: new TFile(path), content }));
  return buildScriveningsDocument(entries);
}

/* --- §34-35 : le moteur de réorganisation est bien monté dans Continu ------ */

test("scriveningsExtensions monte createParagraphReorderExtension(scriveningsBoundariesField) — même moteur, jamais un second", () => {
  const own = createParagraphReorderExtension(scriveningsBoundariesField);
  // Le StateField de mode est un singleton exporté : sa présence dans
  // scriveningsExtensions prouve que Continu réutilise cette même extension,
  // jamais une resynthèse indépendante.
  assert.ok(scriveningsExtensions.includes(own[0]), "le StateField de mode partagé doit être monté dans Continu");
  assert.equal(paragraphReorderModeField, own[0]);
});

/* --- §71 : déplacement à l'intérieur d'un seul feuillet -------------------- */

test("réorganisation Continu : déplacer A2 après A3 dans le feuillet A laisse B strictement inchangé", () => {
  const doc = docFrom([
    ["A.md", "A1.\n\nA2.\n\nA3."],
    ["B.md", "B1.\n\nB2."],
  ]);
  const boundaries = boundaryOffsets(doc);
  const segA = doc.segments[0];
  const segB = doc.segments[1];

  const segmentText = doc.text.slice(segA.from, segA.to);
  const blocks = resolveMarkdownBlocks(segmentText);
  assert.equal(blocks.length, 3);

  const plan = planParagraphMove(segmentText, blocks, 1, 3); // A2 après A3
  assert.ok(plan);

  const compositeFrom = plan.from + segA.from;
  const compositeTo = plan.to + segA.from;
  // Garde-fou AVANT dispatch (§37) : la plage affectée reste dans le
  // segment source, jamais franchie vers B.
  assert.ok(inSameSegment(boundaries, doc.text.length, compositeFrom, compositeTo - 1));
  assert.ok(compositeTo <= segA.to, "la plage affectée ne déborde jamais sur la jonction ni sur B");

  const newText = doc.text.slice(0, compositeFrom) + plan.insert + doc.text.slice(compositeTo);
  const delta = plan.insert.length - (compositeTo - compositeFrom);

  // Le corps de A (borné par la nouvelle fin de segment, décalée de delta) :
  const newBodyA = newText.slice(segA.from, segA.to + delta);
  assert.equal(newBodyA, "A1.\n\nA3.\n\nA2.");

  // B, lui, glisse en bloc de `delta` mais son CONTENU reste byte-for-byte
  // identique — jamais touché par le déplacement dans A.
  const bodyB = doc.text.slice(segB.from, segB.to);
  const newBodyB = newText.slice(segB.from + delta, segB.to + delta);
  assert.equal(newBodyB, bodyB, "le feuillet B reste strictement inchangé (byte-for-byte)");
});

/* --- §72 : garde de segment — jamais de déplacement cross-segment --------- */

test("réorganisation Continu : une destination dans un AUTRE feuillet est refusée AVANT tout dispatch", () => {
  const doc = docFrom([
    ["A.md", "A1.\n\nA2.\n\nA3."],
    ["B.md", "B1.\n\nB2."],
  ]);
  const boundaries = boundaryOffsets(doc);
  const segA = doc.segments[0];
  const segB = doc.segments[1];

  // Source : A2 (milieu du feuillet A). Destination candidate : un seam du
  // feuillet B.
  const sourcePos = segA.from + "A1.\n\n".length + 1; // à l'intérieur de A2
  const candidatePos = segB.from + 1; // à l'intérieur de B1

  assert.equal(inSameSegment(boundaries, doc.text.length, sourcePos, candidatePos), false);

  // Même chose dans l'autre sens : B1 → segment A.
  const sourcePosB = segB.from + 1;
  const candidatePosA = segA.from + 1;
  assert.equal(inSameSegment(boundaries, doc.text.length, sourcePosB, candidatePosA), false);
});

test("réorganisation Continu : segmentRangeFromBoundaries résout chaque position au bon feuillet (cohérent avec segmentAt)", () => {
  const doc = docFrom([
    ["A.md", "A1.\n\nA2.\n\nA3."],
    ["B.md", "B1.\n\nB2."],
  ]);
  const boundaries = boundaryOffsets(doc);
  for (let pos = 0; pos < doc.text.length; pos++) {
    const range = segmentRangeFromBoundaries(boundaries, doc.text.length, pos);
    const segment = segmentAt(doc, pos);
    assert.equal(range.from, segment.from, `pos=${pos}`);
    assert.equal(range.to, segment.to, `pos=${pos}`);
  }
});

/* --- §73 : la frontière visuelle (titre) n'est jamais interprétée comme Markdown --- */

test("réorganisation Continu : le titre visuel d'un feuillet n'est jamais un bloc Markdown source ni cible", () => {
  // Les titres de feuillet (ScriveningsTitleWidget) sont des décorations,
  // jamais du texte composite — resolveMarkdownBlocks ne voit QUE le corps
  // réel du segment, jamais un DOM de titre.
  const doc = docFrom([
    ["A.md", "A1."],
    ["B.md", "B1."],
  ]);
  const segA = doc.segments[0];
  const bodyA = doc.text.slice(segA.from, segA.to);
  assert.equal(bodyA, "A1.");
  const blocks = resolveMarkdownBlocks(bodyA);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "Paragraph");
});

/* --- §39 : aucune écriture Vault directe, pipeline existant réutilisé ------ */

test("réorganisation Continu : le plan ne produit qu'un changement de texte composite — au pipeline existant (scriveningsChangeListener) de le redistribuer", () => {
  const doc = docFrom([["A.md", "A1.\n\nA2.\n\nA3."]]);
  const seg = doc.segments[0];
  const text = doc.text.slice(seg.from, seg.to);
  const blocks = resolveMarkdownBlocks(text);
  const plan = planParagraphMove(text, blocks, 0, 3); // A1 après A3
  assert.ok(plan);
  // Le plan est une donnée pure {from, to, insert, selectionOffset} —
  // aucune méthode d'I/O, aucune référence à `app`/`vault`.
  assert.deepEqual(Object.keys(plan).sort(), ["from", "insert", "selectionOffset", "to"]);
});
