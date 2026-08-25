import test from "node:test";
import assert from "node:assert/strict";
import {
  headingTargetAtOffset,
  imageTargetAtOffset,
  calloutTargetAtOffset,
  presentationNoteAnchorAtOffset,
} from "../src/services/presentation-note-anchors.js";

test("headingTargetAtOffset : ancre la ligne entière du titre, curseur n'importe où dans la ligne", () => {
  const content = "## I. L'Empire carolingien\n\nTexte.";
  const target = headingTargetAtOffset(content, content.indexOf("Empire"));
  assert.deepEqual(target, { start: 0, end: "## I. L'Empire carolingien".length });
});

test("headingTargetAtOffset : null hors d'une ligne de titre", () => {
  const content = "Un paragraphe ordinaire.";
  assert.equal(headingTargetAtOffset(content, 3), null);
});

test("imageTargetAtOffset : ancre l'occurrence wiki EXACTE sous le curseur, distingue plusieurs occurrences", () => {
  const content = "Avant ![[carte.png]] milieu ![[carte.png|Alias]] après.";
  const firstStart = content.indexOf("![[carte.png]]");
  const secondStart = content.indexOf("![[carte.png|Alias]]");
  const first = imageTargetAtOffset(content, firstStart + 2);
  const second = imageTargetAtOffset(content, secondStart + 2);
  assert.deepEqual(first, { start: firstStart, end: firstStart + "![[carte.png]]".length });
  assert.deepEqual(second, { start: secondStart, end: secondStart + "![[carte.png|Alias]]".length });
});

test("imageTargetAtOffset : image Markdown standard reconnue aussi", () => {
  const content = "Texte ![alt](carte.png) suite.";
  const start = content.indexOf("![alt]");
  const target = imageTargetAtOffset(content, start + 2);
  assert.deepEqual(target, { start, end: start + "![alt](carte.png)".length });
});

test("calloutTargetAtOffset : ancre le bloc logique entier, clic n'importe où dedans", () => {
  const content = "Texte.\n\n> [!questions] Mes questions\n> Ligne 1\n> Ligne 2\n\nSuite.";
  const blockStart = content.indexOf("> [!questions]");
  const blockEnd = content.indexOf("Ligne 2") + "Ligne 2".length;
  const target = calloutTargetAtOffset(content, content.indexOf("Ligne 1"));
  assert.deepEqual(target, { start: blockStart, end: blockEnd });
});

test("calloutTargetAtOffset : null pour une citation ordinaire (pas d'en-tête [!type])", () => {
  const content = "> Une simple citation, pas un callout.";
  assert.equal(calloutTargetAtOffset(content, 5), null);
});

test("calloutTargetAtOffset : TOLÉRANCE DE BORD — un point qui tombe sur la ligne vide juste AVANT ou juste APRÈS le callout le trouve quand même", () => {
  // En Live Preview, le callout est rendu comme un bloc HTML qui remplace
  // ses lignes source : posAtCoords renvoie alors une position à la
  // frontière du bloc, jamais une ligne « > » réelle. Sans cette tolérance,
  // le clic droit ne trouvait rien tant qu'on n'était pas entré dedans.
  const content = "Texte.\n\n> [!questions] Mes questions\n> Ligne 1\n\nSuite.";
  const blockStart = content.indexOf("> [!questions]");
  const blockEnd = content.indexOf("Ligne 1") + "Ligne 1".length;
  const expected = { start: blockStart, end: blockEnd };

  const emptyLineBefore = blockStart - 1;   // la ligne vide qui précède le bloc
  const emptyLineAfter = blockEnd + 1;      // la ligne vide qui suit le bloc
  assert.deepEqual(calloutTargetAtOffset(content, emptyLineBefore), expected, "frontière haute");
  assert.deepEqual(calloutTargetAtOffset(content, emptyLineAfter), expected, "frontière basse");
});

test("calloutTargetAtOffset : la tolérance est bornée à UNE ligne — jamais le callout « le plus proche »", () => {
  const content = "> [!note]\n> Corps\n\n\nLoin du callout.";
  const farAway = content.indexOf("Loin du callout");
  assert.equal(calloutTargetAtOffset(content, farAway), null);
});

test("presentationNoteAnchorAtOffset : null quand le curseur n'est ni sur un titre, ni une image, ni un callout", () => {
  const content = "Un paragraphe tout à fait ordinaire.";
  assert.equal(presentationNoteAnchorAtOffset(content, 5), null);
});

test("presentationNoteAnchorAtOffset : ordre titre → image → callout, chacun bien détecté à sa position", () => {
  const content = "# Titre\n\n![[img.png]]\n\n> [!note]\n> corps";
  assert.deepEqual(presentationNoteAnchorAtOffset(content, 2), { start: 0, end: "# Titre".length });
  const imgStart = content.indexOf("![[img.png]]");
  assert.deepEqual(presentationNoteAnchorAtOffset(content, imgStart + 2), { start: imgStart, end: imgStart + "![[img.png]]".length });
  const calloutStart = content.indexOf("> [!note]");
  const calloutEnd = content.indexOf("> corps") + "> corps".length;
  assert.deepEqual(presentationNoteAnchorAtOffset(content, content.indexOf("corps")), { start: calloutStart, end: calloutEnd });
});
