import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultComposition,
  orderedComposition,
  includedComposition,
  readGeneratedIncluded,
  writeGeneratedIncluded,
} from "../src/services/book-composition.js";

test("defaultComposition : neuf identifiants, tous uniques", () => {
  const items = defaultComposition();
  assert.equal(items.length, 9);
  assert.deepEqual(
    items.map((i) => i.id).sort(),
    ["annexes", "bibliography", "first-page", "front-matter", "index", "manuscript", "summary", "tables", "toc"]
  );
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, "identifiants uniques");
});

test("defaultComposition : trois catégories de contenu, jamais mélangées", () => {
  const items = defaultComposition();
  const kindOf = (id) => items.find((i) => i.id === id).kind;

  assert.equal(kindOf("first-page"), "written");
  assert.equal(kindOf("front-matter"), "written");
  assert.equal(kindOf("annexes"), "integrated");
  assert.equal(kindOf("manuscript"), "integrated");
  assert.equal(kindOf("summary"), "generated");
  assert.equal(kindOf("toc"), "generated");
  assert.equal(kindOf("tables"), "generated");
  assert.equal(kindOf("bibliography"), "generated");
  assert.equal(kindOf("index"), "generated");

  for (const item of items) {
    assert.ok(["written", "integrated", "generated"].includes(item.kind));
  }
});

test("defaultComposition : ordre par défaut cohérent — sommaire au début, TDM en dernier", () => {
  const items = defaultComposition();
  const orderOf = (id) => items.find((i) => i.id === id).order;

  assert.equal(orderOf("first-page"), 0, "première page toujours en tête");
  assert.ok(orderOf("summary") < orderOf("toc"), "sommaire avant la table des matières");
  assert.ok(orderOf("toc") > orderOf("index"), "table des matières après les éléments de fin");
  assert.equal(orderOf("toc"), items.length - 1, "table des matières toujours en dernier");
  // Ordre strictement croissant, sans doublon, sur des entiers 0..n-1.
  const orders = items.map((i) => i.order).sort((a, b) => a - b);
  assert.deepEqual(orders, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("defaultComposition : Première page et le manuscrit sont inclus par défaut — inclusion sinon toujours explicite", () => {
  const items = defaultComposition();
  const included = items.filter((i) => i.included).map((i) => i.id).sort();
  assert.deepEqual(included, ["first-page", "manuscript"]);
});

test("defaultComposition : une nouvelle liste à chaque appel — pas de référence partagée", () => {
  const a = defaultComposition();
  const b = defaultComposition();
  assert.notEqual(a, b);
  assert.notEqual(a[0], b[0]);
  a[0].included = false;
  assert.equal(b[0].included, true, "muter le résultat d'un appel n'affecte pas les suivants");
});

test("orderedComposition : trie par order croissant, sans muter le tableau reçu", () => {
  const items = [
    { id: "c", kind: "generated", included: true, order: 2 },
    { id: "a", kind: "written", included: true, order: 0 },
    { id: "b", kind: "integrated", included: false, order: 1 },
  ];
  const original = [...items];
  const sorted = orderedComposition(items);

  assert.deepEqual(sorted.map((i) => i.id), ["a", "b", "c"]);
  assert.deepEqual(items, original, "le tableau reçu n'est pas modifié en place");
});

test("orderedComposition : tri stable — deux éléments de même order conservent leur ordre relatif", () => {
  const items = [
    { id: "first", kind: "written", included: true, order: 0 },
    { id: "second", kind: "written", included: true, order: 0 },
  ];
  const sorted = orderedComposition(items);
  assert.deepEqual(sorted.map((i) => i.id), ["first", "second"]);
});

test("includedComposition : ne garde que les éléments inclus, dans l'ordre déterministe", () => {
  const items = [
    { id: "toc", kind: "generated", included: true, order: 3 },
    { id: "first-page", kind: "written", included: true, order: 0 },
    { id: "bibliography", kind: "written", included: false, order: 5 },
    { id: "annexes", kind: "integrated", included: true, order: 6 },
  ];
  const included = includedComposition(items);
  assert.deepEqual(included.map((i) => i.id), ["first-page", "toc", "annexes"]);
});

test("includedComposition : liste vide si rien n'est inclus", () => {
  const items = defaultComposition().map((item) => ({ ...item, included: false }));
  assert.deepEqual(includedComposition(items), []);
});

test("includedComposition appliqué à defaultComposition() : Première page et le manuscrit ressortent", () => {
  const included = includedComposition(defaultComposition());
  assert.deepEqual(included.map((i) => i.id).sort(), ["first-page", "manuscript"]);
});

/* ------------------- readGeneratedIncluded / writeGeneratedIncluded ------- */

test("readGeneratedIncluded : undefined tant que rien n'a été réglé", () => {
  assert.equal(readGeneratedIncluded({}, "summary"), undefined);
});

test("writeGeneratedIncluded puis readGeneratedIncluded : round-trip fidèle", () => {
  const meta = {};
  writeGeneratedIncluded(meta, "summary", true);
  assert.equal(readGeneratedIncluded(meta, "summary"), true);

  writeGeneratedIncluded(meta, "summary", false);
  assert.equal(readGeneratedIncluded(meta, "summary"), false);
});

test("writeGeneratedIncluded : n'écrase ni les autres identifiants ni les autres champs de ProjectMeta", () => {
  const meta = { name: "Mon projet" };
  writeGeneratedIncluded(meta, "summary", true);
  writeGeneratedIncluded(meta, "toc", false);

  assert.equal(meta.name, "Mon projet", "les autres champs de ProjectMeta restent intacts");
  assert.equal(readGeneratedIncluded(meta, "summary"), true);
  assert.equal(readGeneratedIncluded(meta, "toc"), false);
});

test("writeGeneratedIncluded : mute l'objet ProjectMeta reçu en place (jamais une nouvelle référence)", () => {
  const meta = {};
  writeGeneratedIncluded(meta, "toc", true);
  assert.equal(readGeneratedIncluded(meta, "toc"), true, "la mutation est visible sur le même objet");
});
