import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTitleRoles, hasTitleRoleLines, readTitleRoleValue, setTitleRoleValue } from "../src/utils/title-roles.js";
import { titleRoleCss } from "../src/utils/export-templates.js";

test("parseTitleRoles : découpe rôle/contenu", () => {
  const blocks = parseTitleRoles(":::titre: **NEFES**\n:::sous-titre: *Roman*");
  assert.deepEqual(blocks, [
    { role: "titre", content: "**NEFES**" },
    { role: "sous-titre", content: "*Roman*" },
  ]);
});

test("parseTitleRoles : tolère l'espace avant le deux-points (typo FR)", () => {
  assert.deepEqual(parseTitleRoles(":::titre : **NEFES**"), [
    { role: "titre", content: "**NEFES**" },
  ]);
  // espace fine insécable (U+202F) posée par la typographie française
  assert.deepEqual(parseTitleRoles(":::mots : 71 800 mots"), [
    { role: "mots", content: "71 800 mots" },
  ]);
});

test("parseTitleRoles : rôle normalisé en minuscules", () => {
  assert.equal(parseTitleRoles(":::Titre: X")[0].role, "titre");
});

test("parseTitleRoles : lignes vides ignorées (espacement = marges du modèle)", () => {
  const blocks = parseTitleRoles(":::titre: A\n\n\n:::auteur: B");
  assert.equal(blocks.length, 2);
});

test("parseTitleRoles : ligne sans préfixe → bloc sans rôle", () => {
  assert.deepEqual(parseTitleRoles("juste du texte"), [
    { role: null, content: "juste du texte" },
  ]);
});

test("hasTitleRoleLines : détecte la présence d'au moins un rôle", () => {
  assert.equal(hasTitleRoleLines(":::titre: A\ntexte"), true);
  assert.equal(hasTitleRoleLines("**NEFES**\n\n*Roman*"), false);
});

test("titleRoleCss : traduit les styles de rôle en règles data-fp-role", () => {
  const css = titleRoleCss({
    titlePage: {
      styles: {
        titre: { fontSizePt: 24, bold: true, align: "center", marginBottomPt: 18, marginLeftPt: 12, marginRightPt: 9 },
        "sous-titre": { fontSizePt: 14, italic: true },
      },
    },
  });
  assert.match(css, /\[data-fp-role="titre"\]/);
  assert.match(css, /font-size: 24pt/);
  assert.match(css, /font-weight: 700/);
  assert.match(css, /margin-bottom: 18pt/);
  assert.match(css, /margin-left: 12pt/);
  assert.match(css, /margin-right: 9pt/);
  assert.match(css, /\[data-fp-role="sous-titre"\]/);
  assert.match(css, /font-style: italic/);
});

test("titleRoleCss : rien si le modèle ne définit aucun style de page de titre", () => {
  assert.equal(titleRoleCss({}), "");
  assert.equal(titleRoleCss({ titlePage: {} }), "");
});

/* Lecture/écriture d'un champ de première page : c'est le feuillet Front qui
   fait foi, et PreviewView ne connaît que ces deux fonctions pures. */

const FRONT_PAGE = [
  "---", "title: NEFES", "type: titre", "compile: true", "---",
  ":::titre: NEFES",
  ":::sous-titre: ",
  ":::auteur: Halim",
].join("\n");

test("readTitleRoleValue : valeur écrite, rôle vide, rôle absent", () => {
  assert.equal(readTitleRoleValue(FRONT_PAGE, "titre"), "NEFES");
  assert.equal(readTitleRoleValue(FRONT_PAGE, "sous-titre"), "");
  assert.equal(readTitleRoleValue(FRONT_PAGE, "image"), "");
  assert.equal(readTitleRoleValue(FRONT_PAGE, "  TITRE  "), "NEFES", "casse et espaces ne créent pas un autre rôle");
  assert.equal(readTitleRoleValue("", "titre"), "");
});

test("setTitleRoleValue : réécrit sur place, ajoute à la fin, laisse le reste intact", () => {
  const updated = setTitleRoleValue(FRONT_PAGE, "titre", "  NEFES II  ");
  assert.match(updated, /^---\ntitle: NEFES\ntype: titre/, "le frontmatter n'est jamais touché");
  assert.equal(readTitleRoleValue(updated, "titre"), "NEFES II");
  assert.equal(updated.split("\n").filter((l) => l.startsWith(":::titre:")).length, 1, "aucun doublon de rôle");

  const withImage = setTitleRoleValue(FRONT_PAGE, "image", "![[logo.png]]");
  assert.equal(readTitleRoleValue(withImage, "image"), "![[logo.png]]");
  assert.equal(withImage.split("\n").at(-1), ":::image: ![[logo.png]]");

  // Vider un rôle existant le conserve ; un rôle absent laissé vide n'est pas créé.
  assert.match(setTitleRoleValue(FRONT_PAGE, "auteur", ""), /:::auteur: $/m);
  assert.equal(setTitleRoleValue(FRONT_PAGE, "mots", "   "), FRONT_PAGE);
});

test("setTitleRoleValue : les fins de ligne CRLF ne dupliquent pas un rôle", () => {
  const crlf = FRONT_PAGE.replace(/\n/g, "\r\n");
  const updated = setTitleRoleValue(crlf, "auteur", "Autre");
  assert.equal(readTitleRoleValue(updated, "auteur"), "Autre");
  assert.equal(updated.split("\n").filter((l) => l.startsWith(":::auteur:")).length, 1);
});
