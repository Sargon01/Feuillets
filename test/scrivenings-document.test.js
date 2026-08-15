import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  buildScriveningsDocument,
  loadScriveningsDocument,
  segmentAt,
  compositeOffsetToLocation,
  locationToCompositeOffset,
  boundaryOffsets,
  changeCrossesBoundary,
  applyCompositeChanges,
  resolveScriveningsWrite,
  SCRIVENINGS_JOINT,
} from "../src/services/scrivenings-document.js";

function entriesFrom(pairs) {
  // pairs: [ [path, content], ... ]
  const files = pairs.map(([path]) => new TFile(path));
  const entries = pairs.map(([, content], i) => ({ file: files[i], content }));
  return { files, entries };
}

test("un seul fichier : composite = son corps, un seul segment", () => {
  const { entries } = entriesFrom([["A.md", "Bonjour le monde."]]);
  const doc = buildScriveningsDocument(entries);

  assert.equal(doc.text, "Bonjour le monde.");
  assert.equal(doc.segments.length, 1);
  assert.equal(doc.segments[0].from, 0);
  assert.equal(doc.segments[0].to, doc.text.length);
  assert.equal(doc.segments[0].frontmatter, "");
});

test("plusieurs fichiers : jointure structurelle unique entre chaque corps", () => {
  const { entries } = entriesFrom([
    ["A.md", "Corps A"],
    ["B.md", "Corps B"],
    ["C.md", "Corps C"],
  ]);
  const doc = buildScriveningsDocument(entries);

  assert.equal(doc.text, `Corps A${SCRIVENINGS_JOINT}Corps B${SCRIVENINGS_JOINT}Corps C`);
  assert.equal(doc.segments.length, 3);
  assert.equal(doc.segments[0].from, 0);
  assert.equal(doc.segments[0].to, 7);
  assert.equal(doc.segments[1].from, 8); // 7 + 1 jonction
  assert.equal(doc.segments[1].to, 15);
  assert.equal(doc.segments[2].from, 16); // 15 + 1 jonction
  assert.equal(doc.segments[2].to, 23);
});

test("fichier vide : segment de longueur nulle, sans casser le mapping des voisins", () => {
  const { entries } = entriesFrom([
    ["A.md", "Avant"],
    ["B.md", ""],
    ["C.md", "Après"],
  ]);
  const doc = buildScriveningsDocument(entries);

  const empty = doc.segments[1];
  assert.equal(empty.from, empty.to);
  assert.equal(empty.body, "");
  assert.equal(segmentAt(doc, empty.from)?.path, "B.md");
});

test("YAML retiré du composite mais conservé sur le segment", () => {
  const { entries } = entriesFrom([
    ["A.md", "---\ntitle: A\n---\nCorps A"],
    ["B.md", "Corps B sans YAML"],
  ]);
  const doc = buildScriveningsDocument(entries);

  assert.ok(!doc.text.includes("title: A"));
  assert.equal(doc.text, `Corps A${SCRIVENINGS_JOINT}Corps B sans YAML`);
  assert.equal(doc.segments[0].frontmatter, "---\ntitle: A\n---\n");
  assert.equal(doc.segments[0].body, "Corps A");
  assert.equal(doc.segments[1].frontmatter, "");
});

test("Unicode et retours à la ligne dans le corps sont préservés", () => {
  const { entries } = entriesFrom([
    ["A.md", "Élan, café, naïve\nDeuxième ligne\n\nParagraphe suivant"],
  ]);
  const doc = buildScriveningsDocument(entries);

  assert.equal(doc.text, "Élan, café, naïve\nDeuxième ligne\n\nParagraphe suivant");
});

test("mapping aller/retour : offset composite <-> (fichier, offset local)", () => {
  const { entries } = entriesFrom([
    ["A.md", "0123"],
    ["B.md", "abcdef"],
  ]);
  const doc = buildScriveningsDocument(entries);

  const loc = compositeOffsetToLocation(doc, 7); // "b" dans "abcdef" (from=5)
  assert.equal(loc.segment.path, "B.md");
  assert.equal(loc.offset, 2);

  assert.equal(locationToCompositeOffset(doc, "B.md", 2), 7);
  assert.equal(locationToCompositeOffset(doc, "A.md", 0), 0);
  assert.equal(locationToCompositeOffset(doc, "A.md", 4), 4);
  assert.equal(locationToCompositeOffset(doc, "inconnu.md", 0), null);
  assert.equal(locationToCompositeOffset(doc, "A.md", 99), null);
});

test("bornes de segment : les deux extrémités sont des positions de caret valides", () => {
  const { entries } = entriesFrom([
    ["A.md", "abc"],
    ["B.md", "def"],
  ]);
  const doc = buildScriveningsDocument(entries);

  assert.equal(segmentAt(doc, 0)?.path, "A.md");
  assert.equal(segmentAt(doc, 3)?.path, "A.md"); // fin de A, caret pour ajouter à A
  assert.equal(segmentAt(doc, 4)?.path, "B.md"); // début de B, juste après la jonction
  assert.equal(segmentAt(doc, 7)?.path, "B.md"); // fin de B
  assert.equal(segmentAt(doc, 8), null); // hors bornes
});

test("boundaryOffsets pointe exactement sur les caractères de jonction", () => {
  const { entries } = entriesFrom([
    ["A.md", "abc"],
    ["B.md", "de"],
    ["C.md", "f"],
  ]);
  const doc = buildScriveningsDocument(entries);

  assert.deepEqual(boundaryOffsets(doc), [3, 6]);
  assert.equal(doc.text[3], SCRIVENINGS_JOINT);
  assert.equal(doc.text[6], SCRIVENINGS_JOINT);
});

test("changeCrossesBoundary : rejette toute édition qui toucherait une jonction", () => {
  const { entries } = entriesFrom([
    ["A.md", "abc"],
    ["B.md", "def"],
  ]);
  const doc = buildScriveningsDocument(entries);

  // Édition interne à A : autorisée.
  assert.equal(changeCrossesBoundary(doc, 0, 2), false);
  // Caret en fin de A (append) : autorisé.
  assert.equal(changeCrossesBoundary(doc, 3, 3), false);
  // Caret en début de B (append) : autorisé.
  assert.equal(changeCrossesBoundary(doc, 4, 4), false);
  // Sélection qui engloberait la jonction : refusée.
  assert.equal(changeCrossesBoundary(doc, 2, 5), true);
  // Suppression exacte de la jonction : refusée.
  assert.equal(changeCrossesBoundary(doc, 3, 4), true);
});

test("applyCompositeChanges : édition contenue dans un seul segment", () => {
  const { entries } = entriesFrom([
    ["A.md", "Bonjour"],
    ["B.md", "Monde"],
  ]);
  const doc = buildScriveningsDocument(entries);

  const result = applyCompositeChanges(doc, [{ from: 0, to: 7, insert: "Salut" }]);
  assert.ok(result);
  assert.deepEqual(result.touchedPaths, ["A.md"]);
  assert.equal(result.document.segments[0].body, "Salut");
  assert.equal(result.document.segments[1].body, "Monde");
  assert.equal(result.document.text, `Salut${SCRIVENINGS_JOINT}Monde`);
  // Le segment B doit avoir glissé de la bonne longueur.
  assert.equal(result.document.segments[1].from, "Salut".length + 1);
});

test("applyCompositeChanges : redistribution exacte sur plusieurs segments dans un même lot", () => {
  const { entries } = entriesFrom([
    ["A.md", "AAAA"],
    ["B.md", "BBBB"],
    ["C.md", "CCCC"],
  ]);
  const doc = buildScriveningsDocument(entries);

  // Insertion en fin de A, suppression en tête de C — B intact.
  const result = applyCompositeChanges(doc, [
    { from: 4, to: 4, insert: "!" }, // fin de A
    { from: doc.segments[2].from, to: doc.segments[2].from + 2, insert: "" }, // début de C
  ]);

  assert.ok(result);
  assert.deepEqual(result.touchedPaths.sort(), ["A.md", "C.md"]);
  assert.equal(result.document.segments[0].body, "AAAA!");
  assert.equal(result.document.segments[1].body, "BBBB");
  assert.equal(result.document.segments[2].body, "CC");
});

test("applyCompositeChanges : un remplacement de MÊME longueur marque quand même le segment modifié", () => {
  const { entries } = entriesFrom([["A.md", "Corps A"]]);
  const doc = buildScriveningsDocument(entries);

  // "Corps A" -> "Corpz A" : même longueur, delta nul, mais le contenu change.
  const result = applyCompositeChanges(doc, [{ from: 4, to: 5, insert: "z" }]);

  assert.ok(result);
  assert.deepEqual(result.touchedPaths, ["A.md"]);
  assert.equal(result.document.segments[0].body, "Corpz A");
});

test("applyCompositeChanges : refuse tout le lot si une seule édition franchit une frontière", () => {
  const { entries } = entriesFrom([
    ["A.md", "AAAA"],
    ["B.md", "BBBB"],
  ]);
  const doc = buildScriveningsDocument(entries);

  const result = applyCompositeChanges(doc, [
    { from: 0, to: 1, insert: "x" }, // édition valide, seule
    { from: 3, to: 6, insert: "" }, // franchit la jonction
  ]);

  assert.equal(result, null);
});

test("loadScriveningsDocument lit chaque fichier réel du Vault, dans l'ordre fourni", async () => {
  const fileA = new TFile("Projet/A.md", "Texte A");
  const fileB = new TFile("Projet/B.md", "---\ntitle: B\n---\nTexte B");
  const { vault } = createFakeVault([fileA, fileB]);
  const app = { vault };

  const doc = await loadScriveningsDocument(app, [fileA, fileB]);

  assert.equal(doc.segments[0].path, "Projet/A.md");
  assert.equal(doc.segments[0].body, "Texte A");
  assert.equal(doc.segments[1].path, "Projet/B.md");
  assert.equal(doc.segments[1].body, "Texte B");
  assert.equal(doc.segments[1].frontmatter, "---\ntitle: B\n---\n");
});

test("resolveScriveningsWrite : préserve le frontmatter actuel, ne remplace que le corps", () => {
  const current = "---\ntitle: A\nupdated: hier\n---\nAncien corps";
  const result = resolveScriveningsWrite(current, "Ancien corps", "Nouveau corps");

  assert.equal(result.conflict, false);
  assert.equal(result.content, "---\ntitle: A\nupdated: hier\n---\nNouveau corps");
});

test("resolveScriveningsWrite : détecte une modification externe et refuse d'écraser", () => {
  const current = "---\ntitle: A\n---\nCorps modifié ailleurs entretemps";
  const result = resolveScriveningsWrite(current, "Ancien corps connu de Scrivenings", "Nouveau corps");

  assert.equal(result.conflict, true);
  assert.equal(result.content, null);
});

test("resolveScriveningsWrite : fichier sans frontmatter reste sans frontmatter", () => {
  const current = "Corps sans YAML";
  const result = resolveScriveningsWrite(current, "Corps sans YAML", "Corps édité");

  assert.equal(result.conflict, false);
  assert.equal(result.content, "Corps édité");
});
