import test from "node:test";
import assert from "node:assert/strict";
import { Document, Packer, AlignmentType } from "docx";
import JSZip from "jszip";
import { blockToParagraphs, inlineChildren, captionParagraphFor } from "../src/services/docx-blocks.js";

/* Faux nœuds DOM : uniquement l'interface réellement consommée par le module. */
const texte = (s) => ({ nodeType: 3, nodeValue: s });
const el = (tagName, props = {}) => ({
  nodeType: 1,
  tagName,
  childNodes: props.childNodes || props.children || [],
  children: props.children || [],
  textContent: props.textContent || "",
  getAttribute: (k) => (props.attrs || {})[k] ?? null,
  classList: { contains: (c) => (props.classes || []).includes(c) },
  querySelector: (sel) =>
    (props.children || []).find((c) => c.tagName && c.tagName.toLowerCase() === sel) || null,
});
const p = (children) => el("P", { childNodes: children, children });

const TPL = { key: "classique", label: "Classique", align: "justify", indent: true };
const noFootnotes = new Map();

/* `docx` construit un arbre { rootKey, root: [...] } sérialisé ensuite en XML
   OOXML : le texte d'un run vit sous `w:t`, le gras sous `w:b`. On lit cette
   représentation plutôt que le XML final — c'est ce que la bibliothèque expose
   sans passer par un Packer complet. */
function collect(node, key, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, key, out);
    return out;
  }
  if (node.rootKey === key) {
    for (const c of node.root || []) if (typeof c === "string") out.push(c);
  }
  collect(node.root, key, out);
  return out;
}

/** Textes des runs d'un paragraphe docx, dans l'ordre. */
const runTexts = (para) => collect(para, "w:t");
/** Vrai si l'arbre contient au moins un nœud de cette clé OOXML. */
const has = (para, key) => JSON.stringify(para).includes(`"${key}"`);

test("inlineChildren : le texte simple devient un run", () => {
  const runs = inlineChildren(p([texte("Il faisait nuit.")]), noFootnotes);
  assert.equal(runs.length, 1);
  assert.deepEqual(runTexts(runs[0]), ["Il faisait nuit."]);
});

test("inlineChildren : gras et italique s'accumulent en descendant", () => {
  const gras = el("STRONG", { childNodes: [el("EM", { childNodes: [texte("les deux")] })] });
  const runs = inlineChildren(p([texte("avant "), gras]), noFootnotes);
  assert.equal(runs.length, 2);
  assert.ok(has(runs[1], "w:b"), "gras attendu");
  assert.ok(has(runs[1], "w:i"), "italique attendu");
});

test("inlineChildren : <br> devient un saut DANS le paragraphe", () => {
  const runs = inlineChildren(p([texte("a"), el("BR"), texte("b")]), noFootnotes);
  assert.equal(runs.length, 3);
});

test("inlineChildren : un appel de note devient une référence de note", () => {
  const lien = el("A", { attrs: { href: "#fn-3" }, classes: ["footnote-ref"], childNodes: [texte("3")] });
  const runs = inlineChildren(p([lien]), new Map([["3", 7]]));
  assert.equal(runs.length, 1);
  assert.ok(has(runs[0], "w:footnoteReference"), "référence de note attendue");
});

test("inlineChildren : un lien ordinaire garde son texte", () => {
  const lien = el("A", { attrs: { href: "https://exemple.fr" }, childNodes: [texte("un lien")] });
  const runs = inlineChildren(p([lien]), noFootnotes);
  assert.deepEqual(runTexts(runs[0]), ["un lien"]);
});

test("blockToParagraphs : un <p> reçoit l'alignement du modèle", () => {
  const [para] = blockToParagraphs(p([texte("Texte.")]), noFootnotes, TPL);
  // régression : "justify" renvoyait undefined (AlignmentType.JUSTIFY inexistant)
  assert.ok(has(para, "w:jc"), "un alignement doit être posé");
  assert.ok(JSON.stringify(para).includes(`"${AlignmentType.JUSTIFIED}"`), "justifié attendu");
});

test("blockToParagraphs : H1/H2 démarrent une page si le modèle ne configure rien", () => {
  const saut = (tag) => JSON.stringify(blockToParagraphs(el(tag, { childNodes: [texte("T")] }), noFootnotes, TPL));
  assert.ok(saut("H1").includes("w:pageBreakBefore"), "H1 doit démarrer une page");
  assert.ok(saut("H2").includes("w:pageBreakBefore"), "H2 doit démarrer une page");
  assert.ok(!saut("H3").includes("w:pageBreakBefore"), "H3 ne doit pas démarrer une page");
});

test("blockToParagraphs : un modèle qui configure headings décide seul", () => {
  const headings = { h2: { pageBreakBefore: true } };
  const h1 = JSON.stringify(blockToParagraphs(el("H1", { childNodes: [texte("T")] }), noFootnotes, TPL, headings));
  const h2 = JSON.stringify(blockToParagraphs(el("H2", { childNodes: [texte("T")] }), noFootnotes, TPL, headings));
  // h1 non mentionné → PAS de saut de page hérité du repli historique
  assert.ok(!h1.includes("w:pageBreakBefore"), "h1 non configuré ne doit pas hériter du repli");
  assert.ok(h2.includes("w:pageBreakBefore"), "h2 configuré doit démarrer une page");
});

test("blockToParagraphs : une liste préfixe ses items", () => {
  const li = (t) => el("LI", { childNodes: [texte(t)] });
  const ul = blockToParagraphs(el("UL", { children: [li("un"), li("deux")] }), noFootnotes, TPL);
  assert.equal(ul.length, 2);
  assert.deepEqual(runTexts(ul[0]), ["• ", "un"]);

  const ol = blockToParagraphs(el("OL", { children: [li("un"), li("deux")] }), noFootnotes, TPL);
  assert.deepEqual(runTexts(ol[0]), ["1. ", "un"]);
  assert.deepEqual(runTexts(ol[1]), ["2. ", "deux"]);
});

test("blockToParagraphs : <hr> utilise le séparateur du modèle", () => {
  const [para] = blockToParagraphs(el("HR"), noFootnotes, { ...TPL, sceneDivider: "≈≈≈" });
  assert.deepEqual(runTexts(para), ["≈≈≈"]);
  const [defaut] = blockToParagraphs(el("HR"), noFootnotes, TPL);
  assert.deepEqual(runTexts(defaut), ["* * *"]);
});

test("blockToParagraphs : un élément inconnu descend dans ses enfants", () => {
  const div = el("DIV", { children: [p([texte("caché")])] });
  const out = blockToParagraphs(div, noFootnotes, TPL);
  assert.equal(out.length, 1);
  assert.deepEqual(runTexts(out[0]), ["caché"]);
});

test("blockToParagraphs : un nœud non-élément ne produit rien", () => {
  assert.deepEqual(blockToParagraphs(texte("nu"), noFootnotes, TPL), []);
  assert.deepEqual(blockToParagraphs(null, noFootnotes, TPL), []);
});

test("captionParagraphFor : légende de l'image, sinon son alt", () => {
  const img = el("IMG", { attrs: { alt: "repli alt" } });
  const para = p([img]);

  const avecLegende = captionParagraphFor(para, new Map([[img, { caption: "Fig. 1" }]]));
  assert.deepEqual(runTexts(avecLegende), ["Fig. 1"]);

  const sansLegende = captionParagraphFor(para, new Map());
  assert.deepEqual(runTexts(sansLegende), ["repli alt"]);
});

test("captionParagraphFor : null sans image ni texte", () => {
  assert.equal(captionParagraphFor(p([texte("x")]), new Map()), null);
  assert.equal(captionParagraphFor(el("DIV"), new Map()), null);
  const nu = el("IMG", { attrs: {} });
  assert.equal(captionParagraphFor(p([nu]), new Map()), null);
});

/* PNG 1×1 valide — de vrais octets, pour que docx puisse réellement empaqueter. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test("inlineChildren : une image est retrouvée par son NŒUD, pas par son src", async () => {
  const img = el("IMG", { attrs: { src: "data:image/png;base64,..." } });
  const images = new Map([[img, { bytes: PNG, ext: "png", width: 100, height: 80 }]]);

  // régression : images.find(...) sur une Map levait un TypeError et faisait
  // échouer tout export .docx d'un manuscrit contenant une image.
  const runs = inlineChildren(p([img]), noFootnotes, images);
  assert.equal(runs.length, 1);
});

test("une image exportée produit un .docx dont le média porte la bonne extension", async () => {
  const img = el("IMG", { attrs: { src: "x" } });
  const images = new Map([[img, { bytes: PNG, ext: "png", width: 100, height: 80 }]]);
  const paras = blockToParagraphs(p([img]), noFootnotes, TPL, {}, images);

  const doc = new Document({ sections: [{ children: paras }] });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const media = Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !f.endsWith("/"));

  assert.equal(media.length, 1);
  // régression : sans `type`, docx écrivait "<hash>.undefined", que Word n'ouvre pas
  assert.ok(media[0].endsWith(".png"), `extension inattendue : ${media[0]}`);
});

test("inlineChildren : jpeg est normalisé en jpg", async () => {
  const img = el("IMG", { attrs: { src: "x" } });
  const images = new Map([[img, { bytes: PNG, ext: "JPEG", width: 10, height: 10 }]]);
  const paras = blockToParagraphs(p([img]), noFootnotes, TPL, {}, images);

  const doc = new Document({ sections: [{ children: paras }] });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const media = Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !f.endsWith("/"));
  assert.ok(media[0].endsWith(".jpg"), `extension inattendue : ${media[0]}`);
});

test("inlineChildren : un format non empaquetable est ignoré, sans planter", () => {
  const img = el("IMG", { attrs: { src: "x" } });
  const images = new Map([[img, { bytes: PNG, ext: "webp", width: 10, height: 10 }]]);

  const warns = [];
  const original = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    const runs = inlineChildren(p([img]), noFootnotes, images);
    assert.deepEqual(runs, []);
  } finally {
    console.warn = original;
  }
  assert.match(warns.join(" "), /webp/);
});

test("inlineChildren : une image trop large est réduite en gardant ses proportions", () => {
  const img = el("IMG", { attrs: { src: "x" } });
  const images = new Map([[img, { bytes: PNG, ext: "png", width: 1000, height: 800 }]]);
  const runs = inlineChildren(p([img]), noFootnotes, images);

  const s = JSON.stringify(runs[0]);
  // 1000×800 ramené à 500 de large → 400 de haut ; docx exprime en EMU (×9525)
  assert.ok(s.includes(String(500 * 9525)), "largeur ramenée à 500 attendue");
  assert.ok(s.includes(String(400 * 9525)), "hauteur proportionnelle attendue");
});
