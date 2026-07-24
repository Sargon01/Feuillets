import test from "node:test";
import assert from "node:assert/strict";
import { escapeXml, decodeXmlEntities } from "../src/utils/xml.js";

test("escapeXml : les quatre caractères dangereux", () => {
  assert.equal(escapeXml("a & b"), "a &amp; b");
  assert.equal(escapeXml("5 < 10"), "5 &lt; 10");
  assert.equal(escapeXml("10 > 5"), "10 &gt; 5");
  assert.equal(escapeXml('dit "oui"'), "dit &quot;oui&quot;");
});

test("escapeXml : l'esperluette est échappée en premier", () => {
  // sinon les entités produites ensuite seraient rééchappées : &amp;lt;
  assert.equal(escapeXml("<"), "&lt;");
  assert.equal(escapeXml("&lt;"), "&amp;lt;", "un &lt; littéral doit rester littéral");
});

test("escapeXml : cas réels d'un manuscrit français", () => {
  assert.equal(escapeXml("Dupont & fils"), "Dupont &amp; fils");
  assert.equal(escapeXml("« Alors ? » dit-il"), "« Alors ? » dit-il");
  // l'apostrophe n'est PAS échappée : attributs en guillemets doubles partout
  assert.equal(escapeXml("l'aube"), "l'aube");
});

test("escapeXml : valeurs vides ou absentes", () => {
  assert.equal(escapeXml(""), "");
  assert.equal(escapeXml(null), "");
  assert.equal(escapeXml(undefined), "");
  assert.equal(escapeXml(0), "0", "0 est une valeur, pas une absence");
});

test("escapeXml : un texte sans caractère spécial est inchangé", () => {
  const s = "Il faisait nuit sur la ville endormie.";
  assert.equal(escapeXml(s), s);
});

test("decodeXmlEntities : entités nommées", () => {
  assert.equal(decodeXmlEntities("a &amp; b"), "a & b");
  assert.equal(decodeXmlEntities("5 &lt; 10 &gt; 2"), "5 < 10 > 2");
  assert.equal(decodeXmlEntities("&quot;oui&quot;"), '"oui"');
  assert.equal(decodeXmlEntities("l&apos;aube"), "l'aube");
});

test("decodeXmlEntities : &amp; est décodé en dernier", () => {
  // "&amp;lt;" représente le TEXTE "&lt;", pas le caractère "<"
  assert.equal(decodeXmlEntities("&amp;lt;"), "&lt;");
});

test("decodeXmlEntities : entités numériques décimales et hexadécimales", () => {
  assert.equal(decodeXmlEntities("&#233;"), "é");
  assert.equal(decodeXmlEntities("&#xE9;"), "é");
  assert.equal(decodeXmlEntities("&#xe9;"), "é", "hexadécimal en minuscules");
});

test("decodeXmlEntities : les caractères hors du plan de base survivent", () => {
  // régression : String.fromCharCode est limité à U+FFFF et renvoyait un
  // caractère faux — une émoji dans un commentaire de relecture .docx
  assert.equal(decodeXmlEntities("&#x1F600;"), "😀");
  assert.equal(decodeXmlEntities("&#128512;"), "😀");
});

test("decodeXmlEntities : un point de code hors bornes ne lève pas", () => {
  assert.doesNotThrow(() => decodeXmlEntities("&#x110000;"));
  assert.doesNotThrow(() => decodeXmlEntities("&#99999999;"));
});

test("decodeXmlEntities : valeurs vides", () => {
  assert.equal(decodeXmlEntities(""), "");
  assert.equal(decodeXmlEntities(null), "");
  assert.equal(decodeXmlEntities(undefined), "");
});

test("aller-retour : décoder ce qu'on vient d'échapper redonne l'original", () => {
  const cas = [
    "Dupont & fils",
    "5 < 10 et 10 > 5",
    'Il dit "non" puis partit',
    "l'aube & la nuit",
    "« Alors ? » — dit-elle.",
    "Été à Paris",
    "a &amp; b",
    "<balise>",
  ];
  for (const s of cas) {
    assert.equal(decodeXmlEntities(escapeXml(s)), s, `aller-retour cassé sur : ${s}`);
  }
});
