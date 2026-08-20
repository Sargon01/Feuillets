import test from "node:test";
import assert from "node:assert/strict";
import { resolveMarkdownBlocks, planParagraphMove } from "../src/utils/paragraph-reorder-core.js";

function apply(text, plan) {
  return text.slice(0, plan.from) + plan.insert + text.slice(plan.to);
}

/* --- §52 : déplacement simple vers le bas -------------------------------- */

test("planParagraphMove : déplacer B après C", () => {
  const text = "A.\n\nB.\n\nC.";
  const blocks = resolveMarkdownBlocks(text);
  assert.equal(blocks.length, 3);
  const plan = planParagraphMove(text, blocks, 1, 3); // seam après C
  assert.ok(plan);
  assert.equal(apply(text, plan), "A.\n\nC.\n\nB.");
});

/* --- §53 : déplacement vers le haut --------------------------------------- */

test("planParagraphMove : déplacer C avant A", () => {
  const text = "A.\n\nB.\n\nC.";
  const blocks = resolveMarkdownBlocks(text);
  const plan = planParagraphMove(text, blocks, 2, 0); // seam avant A
  assert.ok(plan);
  assert.equal(apply(text, plan), "C.\n\nA.\n\nB.");
});

/* --- §54 : paragraphe multiligne ------------------------------------------ */

test("planParagraphMove : un paragraphe multiligne se déplace en un seul bloc", () => {
  const text = "Premier paragraphe.\n\nDeuxième paragraphe sur\nplusieurs lignes source\nsans ligne vide interne.\n\nTroisième paragraphe.";
  const blocks = resolveMarkdownBlocks(text);
  assert.equal(blocks.length, 3);
  assert.equal(text.slice(blocks[1].from, blocks[1].to), "Deuxième paragraphe sur\nplusieurs lignes source\nsans ligne vide interne.");
  const plan = planParagraphMove(text, blocks, 1, 0);
  assert.ok(plan);
  const result = apply(text, plan);
  assert.equal(
    result,
    "Deuxième paragraphe sur\nplusieurs lignes source\nsans ligne vide interne.\n\nPremier paragraphe.\n\nTroisième paragraphe."
  );
});

/* --- §55 : séparateurs variés, aucune normalisation ----------------------- */

test("planParagraphMove : préserve exactement les séparateurs réels (1, 2, 3 lignes vides), sans normalisation", () => {
  const text = "A.\n\nB.\n\n\nC.\n\n\n\nD.";
  const blocks = resolveMarkdownBlocks(text);
  assert.equal(blocks.length, 4);
  const plan = planParagraphMove(text, blocks, 0, 4); // déplacer A après D
  assert.ok(plan);
  const result = apply(text, plan);
  // Les séparateurs réels (\n\n, \n\n\n, \n\n\n\n) sont réutilisés tels
  // quels, dans leur ordre d'origine, entre les blocs du nouvel agencement.
  assert.equal(result, "B.\n\nC.\n\n\nD.\n\n\n\nA.");
});

/* --- §56 : CRLF, aucune conversion globale --------------------------------- */

test("planParagraphMove : un document CRLF n'est jamais converti en LF", () => {
  const text = "A.\r\n\r\nB.\r\n\r\nC.";
  const blocks = resolveMarkdownBlocks(text);
  // @lezer/markdown attache le \r qui précède un saut de ligne au bloc
  // PRÉCÉDENT (voir §14 : les chaînes réelles sont prélevées telles
  // quelles, jamais renormalisées) : chaque paragraphe se termine ici par
  // "\r", et son séparateur réel est "\n\r\n".
  assert.equal(text.slice(blocks[0].from, blocks[0].to), "A.\r");
  const plan = planParagraphMove(text, blocks, 0, 3); // déplacer A après C
  assert.ok(plan);
  const result = apply(text, plan);
  assert.equal(result, "B.\r\n\r\nC.\n\r\nA.\r");
  // Même multiset de caractères qu'à l'origine (aucun \r ni \n ajouté ou
  // supprimé) : la réorganisation déplace les blocs, jamais les fins de
  // ligne elles-mêmes — aucune conversion globale CRLF → LF (§56).
  const sortChars = (s) => s.split("").sort().join("");
  assert.equal(sortChars(result), sortChars(text));
});

/* --- §57 : titre — jamais draggable, mais peut être franchi --------------- */

test("planParagraphMove : un Paragraph peut passer de l'autre côté d'un titre, jamais touché byte-for-byte", () => {
  const text = "Premier paragraphe.\n\n## Titre\n\nDeuxième paragraphe.";
  const blocks = resolveMarkdownBlocks(text);
  assert.deepEqual(blocks.map((b) => b.type), ["Paragraph", "ATXHeading2", "Paragraph"]);
  assert.equal(blocks[1].draggable, false);

  const plan = planParagraphMove(text, blocks, 2, 0); // déplacer le 2e avant le 1er
  assert.ok(plan);
  const result = apply(text, plan);
  assert.equal(result, "Deuxième paragraphe.\n\nPremier paragraphe.\n\n## Titre");
  assert.ok(result.includes("## Titre"), "le titre reste identique, byte-for-byte");
});

/* --- §58 : séparateur *** --------------------------------------------------- */

test("planParagraphMove : un séparateur *** reste exactement ***, jamais draggable", () => {
  const text = "A.\n\n***\n\nB.";
  const blocks = resolveMarkdownBlocks(text);
  assert.deepEqual(blocks.map((b) => b.type), ["Paragraph", "HorizontalRule", "Paragraph"]);
  assert.equal(blocks[1].draggable, false);
  const plan = planParagraphMove(text, blocks, 2, 0);
  assert.ok(plan);
  const result = apply(text, plan);
  assert.ok(result.includes("***"));
  assert.equal(result, "B.\n\nA.\n\n***");
});

/* --- §59 : liste — bloc entier non draggable ------------------------------- */

test("planParagraphMove : une liste reste strictement identique et n'est jamais draggable", () => {
  const text = "A.\n\n- un\n- deux\n\nB.";
  const blocks = resolveMarkdownBlocks(text);
  assert.deepEqual(blocks.map((b) => b.type), ["Paragraph", "BulletList", "Paragraph"]);
  assert.equal(blocks[1].draggable, false);
  const plan = planParagraphMove(text, blocks, 0, 3); // déplacer A après B
  assert.ok(plan);
  const result = apply(text, plan);
  assert.equal(result, "- un\n- deux\n\nB.\n\nA.");
  assert.ok(result.includes("- un\n- deux"), "la liste reste strictement identique");
});

/* --- §60 : bloc de code fenced ---------------------------------------------- */

test("planParagraphMove : un bloc de code fenced reste strictement identique et n'est jamais draggable", () => {
  const text = "A.\n\n```js\nconst x = 1;\n```\n\nB.";
  const blocks = resolveMarkdownBlocks(text);
  assert.deepEqual(blocks.map((b) => b.type), ["Paragraph", "FencedCode", "Paragraph"]);
  assert.equal(blocks[1].draggable, false);
  const plan = planParagraphMove(text, blocks, 2, 0);
  assert.ok(plan);
  const result = apply(text, plan);
  assert.ok(result.includes("```js\nconst x = 1;\n```"));
});

/* --- §62 : no-op ------------------------------------------------------------- */

test("planParagraphMove : déplacer sur sa propre position produit null (aucune transaction)", () => {
  const text = "A.\n\nB.\n\nC.";
  const blocks = resolveMarkdownBlocks(text);
  assert.equal(planParagraphMove(text, blocks, 1, 1), null); // avant soi-même
  assert.equal(planParagraphMove(text, blocks, 1, 2), null); // immédiatement après soi-même sans changement réel
});

/* --- §63 : draggable uniquement pour les Paragraph -------------------------- */

test("resolveMarkdownBlocks : draggable === true uniquement pour les Paragraph", () => {
  const text = "A.\n\n## Titre\n\n> citation\n\n- un\n- deux\n\n```js\nconst x = 1;\n```\n\n***\n\nB.";
  const blocks = resolveMarkdownBlocks(text);
  const byType = Object.fromEntries(blocks.map((b) => [b.type, b.draggable]));
  assert.equal(blocks.filter((b) => b.draggable).length, 2);
  assert.equal(byType.Paragraph, true);
  assert.equal(byType.ATXHeading2, false);
  assert.equal(byType.Blockquote, false);
  assert.equal(byType.BulletList, false);
  assert.equal(byType.FencedCode, false);
  assert.equal(byType.HorizontalRule, false);
});

/* --- Bornes / garde-fous ----------------------------------------------------- */

test("planParagraphMove : refuse un sourceIndex non draggable", () => {
  const text = "A.\n\n## Titre\n\nB.";
  const blocks = resolveMarkdownBlocks(text);
  assert.equal(planParagraphMove(text, blocks, 1, 0), null);
});

test("planParagraphMove : refuse une seam hors bornes", () => {
  const text = "A.\n\nB.";
  const blocks = resolveMarkdownBlocks(text);
  assert.equal(planParagraphMove(text, blocks, 0, -1), null);
  assert.equal(planParagraphMove(text, blocks, 0, 3), null);
});

test("planParagraphMove : aucun texte perdu ni ajouté (mêmes caractères, réarrangés)", () => {
  const text = "A.\n\nB.\n\nC.";
  const blocks = resolveMarkdownBlocks(text);
  const plan = planParagraphMove(text, blocks, 1, 3);
  const result = apply(text, plan);
  const sortChars = (s) => s.split("").sort().join("");
  assert.equal(sortChars(result), sortChars(text));
});

test("planParagraphMove : place le curseur au début du paragraphe déplacé", () => {
  const text = "A.\n\nB.\n\nC.";
  const blocks = resolveMarkdownBlocks(text);
  const plan = planParagraphMove(text, blocks, 1, 3);
  const result = apply(text, plan);
  assert.equal(result.slice(plan.selectionOffset, plan.selectionOffset + 2), "B.");
});
