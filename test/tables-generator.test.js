import test from "node:test";
import assert from "node:assert/strict";
import {
  extractIllustrationCaptions,
  generateTableOfIllustrations,
} from "../src/services/tables-generator.js";

function seg(text, frontType = null, path = null) {
  return { path, text, frontType };
}

test("extractIllustrationCaptions : détecte les images avec texte alternatif non vide", () => {
  const segments = [seg("Texte.\n\n![Le phare au crépuscule](phare.png)\n\nSuite.")];
  assert.deepEqual(extractIllustrationCaptions(segments), ["Le phare au crépuscule"]);
});

test("extractIllustrationCaptions : ignore les images sans texte alternatif", () => {
  const segments = [seg("![](phare.png)\n\n![ ](carte.png)")];
  assert.deepEqual(extractIllustrationCaptions(segments), []);
});

test("extractIllustrationCaptions : ignore les embeds wiki (pas de syntaxe Markdown standard)", () => {
  const segments = [seg("![[phare.png]]")];
  assert.deepEqual(extractIllustrationCaptions(segments), []);
});

test("extractIllustrationCaptions : ignore les pages Front", () => {
  const segments = [
    seg("![Portrait de l’auteur](auteur.png)", "titre"),
    seg("![Le phare](phare.png)"),
  ];
  assert.deepEqual(extractIllustrationCaptions(segments), ["Le phare"]);
});

test("extractIllustrationCaptions : conserve l'ordre réel du manuscrit", () => {
  const segments = [
    seg("![Carte du royaume](carte.png)"),
    seg("Texte."),
    seg("![Portrait du roi](roi.png)\n\net ![Blason](blason.png)"),
  ];
  assert.deepEqual(extractIllustrationCaptions(segments), ["Carte du royaume", "Portrait du roi", "Blason"]);
});

test("extractIllustrationCaptions : déduplique les doublons EXACTS, garde la première occurrence", () => {
  const segments = [
    seg("![Le phare](phare1.png)"),
    seg("![Le phare](phare2.png)"),
    seg("![Le Phare](phare3.png)"),
  ];
  // "Le Phare" (majuscule différente) n'est PAS un doublon exact.
  assert.deepEqual(extractIllustrationCaptions(segments), ["Le phare", "Le Phare"]);
});

test("extractIllustrationCaptions : aucune image -> liste vide", () => {
  assert.deepEqual(extractIllustrationCaptions([seg("Juste du texte.")]), []);
});

test("generateTableOfIllustrations : titre # Table des illustrations, une légende par ligne, ordre conservé", () => {
  const segments = [
    seg("![Carte du royaume](carte.png)"),
    seg("![Portrait du roi](roi.png)"),
  ];
  const text = generateTableOfIllustrations(segments);
  assert.equal(text, "# Table des illustrations\n\n- Carte du royaume\n- Portrait du roi\n");
});

test("generateTableOfIllustrations : aucune illustration légendée -> null (jamais de page vide)", () => {
  assert.equal(generateTableOfIllustrations([seg("Texte sans image.")]), null);
  assert.equal(generateTableOfIllustrations([seg("![](sans-legende.png)")]), null);
  assert.equal(generateTableOfIllustrations([]), null);
});

test("generateTableOfIllustrations : ignore les pages Front", () => {
  const segments = [seg("![Portrait de l’auteur](auteur.png)", "titre")];
  assert.equal(generateTableOfIllustrations(segments), null);
});
