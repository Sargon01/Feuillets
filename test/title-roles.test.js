import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTitleRoles, hasTitleRoleLines } from "../src/utils/title-roles.js";
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
        titre: { fontSizePt: 24, bold: true, align: "center", marginBottomPt: 18 },
        "sous-titre": { fontSizePt: 14, italic: true },
      },
    },
  });
  assert.match(css, /\[data-fp-role="titre"\]/);
  assert.match(css, /font-size: 24pt/);
  assert.match(css, /font-weight: 700/);
  assert.match(css, /margin-bottom: 18pt/);
  assert.match(css, /\[data-fp-role="sous-titre"\]/);
  assert.match(css, /font-style: italic/);
});

test("titleRoleCss : rien si le modèle ne définit aucun style de page de titre", () => {
  assert.equal(titleRoleCss({}), "");
  assert.equal(titleRoleCss({ titlePage: {} }), "");
});
