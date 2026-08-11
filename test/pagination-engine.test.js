import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { effectiveHyphenation, pageContentGeometry } from "../src/services/export-pdf.js";
import { EXPORT_TEMPLATES } from "../src/utils/export-templates.js";
import {
  CONTINUATION_STYLE,
  CONTINUES_JUSTIFY_STYLE,
  FRAGMENT_CONTINUATION_CLASS,
  FRAGMENT_CONTINUES_CLASS,
  FRAGMENT_START_CLASS,
  applyFragmentPresentation,
  paginateDom,
  wordBoundaries,
  wordPrefixEnds,
} from "../src/services/pagination-engine.js";

function wordFragments(text, capacity) {
  const result = [];
  let start = 0;
  while (start < text.length) {
    const remaining = text.slice(start);
    if (remaining.length <= capacity) {
      result.push(remaining);
      break;
    }
    const boundary = wordPrefixEnds(remaining).filter((value) => value <= capacity).at(-1);
    assert.ok(boundary, "le cas de test doit contenir au moins un mot entier");
    const end = start + boundary;
    result.push(text.slice(start, end));
    start = end;
  }
  return result;
}

test("pagination-engine : texte court sur un seul fragment", () => {
  assert.deepEqual(wordFragments("Texte court.", 100), ["Texte court."]);
});

test("pagination-engine : une coupure conserve strictement tous les caractères", () => {
  const text = "Les nôtres ont été noyées dans la suite du paragraphe, sans aucune disparition.";
  const parts = wordFragments(text, 32);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(""), text);
});

test("pagination-engine : régression Kitmir — aucune portion intermédiaire ne disparaît", () => {
  const text = "Kitmir reprend son trot léger. Il dodeline de la tête, il la porte haut. Il remue la queue. Ses petits pas calés sur ceux des soldats. Parfait petit soldat. Je ne peux m’empêcher de rire. Il se moque du sergent...";
  const parts = wordFragments(text, 34);
  assert.ok(parts.length > 2);
  assert.equal(parts.join(""), text);
  assert.match(parts.join(""), /Ses petits pas calés sur ceux des soldats/);
});

test("pagination-engine : les frontières de pagination sont des mots entiers", () => {
  const text = "des sacrifices nécessaires";
  const words = wordBoundaries(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(words, ["des", "sacrifices", "nécessaires"]);
  assert.equal(words.includes("sacrifi"), false);
  assert.equal(words.join(" "), text);
});

test("pagination-engine : les préfixes légaux conservent les mots et séparateurs exacts", () => {
  const text = "des sacrifices nécessaires";
  const prefixes = wordPrefixEnds(text).map((end) => text.slice(0, end));
  assert.deepEqual(prefixes, ["des ", "des sacrifices "]);
  assert.equal(prefixes.some((prefix) => prefix.endsWith("sacrifi")), false);
});

test("pagination-engine : la pagination réelle ne décide pas avec getClientRects", () => {
  const implementation = paginateDom.toString();
  assert.doesNotMatch(implementation, /getClientRects|firstOverflowWordStart/);
  assert.match(implementation, /overflows/);
});

test("pagination-engine : la mesure multicolonne compose à hauteur de page et détecte le débordement horizontal", async () => {
  const implementation = await readFile(new URL("../src/services/pagination-engine.js", import.meta.url), "utf8");
  assert.match(implementation, /"column-count"/);
  assert.match(implementation, /"column-gap"/);
  assert.match(implementation, /"column-fill"/);
  assert.match(implementation, /scrollWidth > content\.clientWidth/);
});

test("pagination-engine : la zone A4 à marges 2,5 cm garde ses pixels fractionnaires", () => {
  const geometry = pageContentGeometry(210, 297, 2.5, 2.5, 2.5, 2.5);
  assert.equal(geometry.widthPx, 604.72);
  assert.equal(geometry.heightPx, 933.5365);
});

test("pagination-engine : A5, Letter, paysage et marges asymétriques sont dérivés des mm finaux", () => {
  assert.deepEqual(pageContentGeometry(148, 210, 2, 3, 1, 4), {
    widthPx: 98 * 3.7795,
    heightPx: 160 * 3.7795,
  });
  assert.deepEqual(pageContentGeometry(279, 216, 1.5, 2, 2, 3), {
    widthPx: 229 * 3.7795,
    heightPx: 181 * 3.7795,
  });
  assert.deepEqual(pageContentGeometry(297, 210, 2.5, 2.5, 1, 4), {
    widthPx: 247 * 3.7795,
    heightPx: 160 * 3.7795,
  });
});

test("pagination-engine : les marges miroir conservent la même largeur utile", () => {
  const odd = pageContentGeometry(210, 297, 2.5, 2.5, 1, 3);
  const even = pageContentGeometry(210, 297, 2.5, 2.5, 3, 1);
  assert.equal(odd.widthPx, even.widthPx);
  assert.equal(odd.heightPx, even.heightPx);
});

test("pagination-engine : la surcharge de césure est explicite et le gabarit reste le repli", () => {
  const template = { hyphenation: true };
  assert.equal(effectiveHyphenation(template), true);
  assert.equal(effectiveHyphenation(template, { hyphenationOverride: false }), false);
  assert.equal(effectiveHyphenation(template, { hyphenationOverride: true }), true);
});

test("pagination-engine : Classique conserve ses réglages de composition", () => {
  const classique = EXPORT_TEMPLATES.classique;
  assert.equal(classique.hyphenation, true);
  assert.equal(classique.lineHeight, 2);
  assert.equal(classique.align, "justify");
});

test("pagination-engine : seul le fragment continué perd l'alinéa et la marge haute", () => {
  const styles = [];
  const fragment = {
    classList: { classes: [], add(name) { this.classes.push(name); } },
    setCssProps(props) { styles.push(props); },
  };
  applyFragmentPresentation(fragment, false, true, "justify");
  assert.deepEqual(fragment.classList.classes, [FRAGMENT_START_CLASS, FRAGMENT_CONTINUES_CLASS]);
  assert.deepEqual(styles, [CONTINUES_JUSTIFY_STYLE]);

  applyFragmentPresentation(fragment, true, true, "justify");
  assert.deepEqual(fragment.classList.classes, [
    FRAGMENT_START_CLASS,
    FRAGMENT_CONTINUES_CLASS,
    FRAGMENT_CONTINUATION_CLASS,
    FRAGMENT_CONTINUES_CLASS,
  ]);
  assert.deepEqual(styles, [CONTINUES_JUSTIFY_STYLE, CONTINUATION_STYLE, CONTINUES_JUSTIFY_STYLE]);
});

test("pagination-engine : le dernier fragment ne force pas sa dernière ligne", () => {
  const styles = [];
  const fragment = {
    classList: { add() {} },
    setCssProps(props) { styles.push(props); },
  };
  applyFragmentPresentation(fragment, true, false, "justify");
  assert.deepEqual(styles, [CONTINUATION_STYLE]);
});

test("pagination-engine : un long paragraphe progresse sur plusieurs pages sans répétition", () => {
  const text = "un deux trois quatre cinq six sept huit neuf dix ".repeat(20);
  const parts = wordFragments(text, 25);
  assert.ok(parts.length > 3);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every((part) => part.length > 0));
});
