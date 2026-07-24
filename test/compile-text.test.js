import test from "node:test";
import assert from "node:assert/strict";
import {
  footnotePrefixFor,
  stripWikilinks,
  applyCompileTransforms,
} from "../src/utils/compile-text.js";

test("stripWikilinks : garde la cible d'un lien simple", () => {
  assert.equal(stripWikilinks("Il croisa [[Aurélien]] au détour."), "Il croisa Aurélien au détour.");
});

test("stripWikilinks : l'alias prime sur la cible", () => {
  assert.equal(stripWikilinks("[[Personnages/Aurélien|le vieil homme]] entra."), "le vieil homme entra.");
});

test("stripWikilinks : l'ancre de titre est jetée", () => {
  assert.equal(stripWikilinks("voir [[Notes#Chapitre 3]] ici"), "voir Notes ici");
  assert.equal(stripWikilinks("voir [[Notes#Chapitre 3|là]] ici"), "voir là ici");
});

test("stripWikilinks : un embed d'image reste intact", () => {
  const md = "Une illustration :\n\n![[carte-du-royaume.png]]\n";
  assert.equal(stripWikilinks(md), md);
});

test("stripWikilinks : embed et lien voisins", () => {
  assert.equal(
    stripWikilinks("![[img.png]] puis [[Lieu|la cité]]"),
    "![[img.png]] puis la cité"
  );
});

test("stripWikilinks : plusieurs liens sur la même ligne", () => {
  assert.equal(
    stripWikilinks("[[A]] et [[B|bé]] et [[C]]"),
    "A et bé et C"
  );
});

test("stripWikilinks : un alias vide n'affiche rien", () => {
  // `|` présent mais vide : l'alias existe et vaut "", il prime donc
  assert.equal(stripWikilinks("avant [[Cible|]] après"), "avant  après");
});

test("stripWikilinks : les espaces autour du texte conservé sont rognés", () => {
  assert.equal(stripWikilinks("[[  Cible  ]]"), "Cible");
  assert.equal(stripWikilinks("[[Cible|  alias  ]]"), "alias");
});

test("stripWikilinks : du texte sans lien est inchangé", () => {
  const md = "Un paragraphe ordinaire, avec [des crochets] simples.";
  assert.equal(stripWikilinks(md), md);
});

test("footnotePrefixFor : retire l'extension et normalise les séparateurs", () => {
  assert.equal(footnotePrefixFor("Manuscrit/Ch1/Scene 1.md"), "Manuscrit-Ch1-Scene-1");
  assert.equal(footnotePrefixFor("a.MD"), "a");
  assert.equal(footnotePrefixFor(""), "");
});

test("footnotePrefixFor : deux feuillets distincts donnent des préfixes distincts", () => {
  const a = footnotePrefixFor("Ch1/Scene 1.md");
  const b = footnotePrefixFor("Ch1/Scene 2.md");
  const c = footnotePrefixFor("Ch2/Scene 1.md");
  assert.equal(new Set([a, b, c]).size, 3);
});

test("footnotePrefixFor : LIMITE CONNUE — aveugle aux accents", () => {
  /* Deux noms ne différant QUE par des caractères accentués aux mêmes
     positions produisent le même préfixe, donc un mélange des notes de bas de
     page des deux feuillets. Cas rare, documenté dans compile-text.js. Ce
     test fige le comportement ACTUEL : s'il casse, c'est que la limite a été
     corrigée — mettre à jour l'assertion, pas la contourner. */
  assert.equal(footnotePrefixFor("Ch1/Scène é.md"), footnotePrefixFor("Ch1/Scène è.md"));
  // en revanche des accents à des positions différentes ne collisionnent pas
  assert.notEqual(footnotePrefixFor("Ch1/Côte.md"), footnotePrefixFor("Ch1/Coté.md"));
});

test("applyCompileTransforms : renumérote les notes dans l'espace du feuillet", () => {
  const out = applyCompileTransforms("Un texte[^1].\n\n[^1]: La note.", "Ch1-S1", false);
  assert.ok(!/\[\^1\]/.test(out), `la note ne doit plus être « 1 » nu : ${out}`);
  assert.ok(out.includes("Ch1-S1"), `le préfixe doit apparaître : ${out}`);
});

test("applyCompileTransforms : deux feuillets ne partagent pas leurs notes", () => {
  const src = "Texte[^1].\n\n[^1]: Note.";
  const a = applyCompileTransforms(src, "Ch1-S1", false);
  const b = applyCompileTransforms(src, "Ch1-S2", false);
  assert.notEqual(a, b);
});

test("applyCompileTransforms : la typographie française est optionnelle", () => {
  const src = 'Il dit "bonjour" !';
  const sans = applyCompileTransforms(src, "p", false);
  const avec = applyCompileTransforms(src, "p", true);
  assert.equal(sans, src);
  assert.notEqual(avec, src);
  assert.match(avec, /[«»]/, "guillemets français attendus");
});

test("applyCompileTransforms : wikiliens retirés même avec la typographie active", () => {
  const out = applyCompileTransforms("Voir [[Lieu|la cité]] au loin.", "p", true);
  assert.ok(!out.includes("[["), `wikilien résiduel : ${out}`);
  assert.ok(out.includes("la cité"));
});

test("applyCompileTransforms : un embed survit à la chaîne complète", () => {
  const out = applyCompileTransforms("![[carte.png]]", "p", true);
  assert.equal(out, "![[carte.png]]");
});
