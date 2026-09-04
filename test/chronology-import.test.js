import test from "node:test";
import assert from "node:assert/strict";
import { parseChronologyImport, parseChronologyProjection } from "../src/services/chronology-import.js";

test("nouveau format valide : « # Chronologie / ## événement / ### date / description »", () => {
  const body = [
    "# Chronologie",
    "",
    "## Départ de la caravane dans le Hedjaz",
    "",
    "### 12 mars 765",
    "",
    "Description longue et libre de l'événement, de son contexte et de ses conséquences.",
    "",
    "## Séisme de Lisbonne",
    "",
    "### 1er novembre 1755 à 9 h 30",
    "",
    "Description longue et libre.",
    "",
    "## Événement antique",
    "",
    "### 15 mars 44 av. J.-C.",
    "",
    "Description longue et libre.",
    "",
  ].join("\n");

  const result = parseChronologyImport(body);
  assert.equal(result.ok, true);
  const blocks = result.blocks;

  assert.equal(blocks.length, 3);

  assert.equal(blocks[0].title, "Départ de la caravane dans le Hedjaz");
  assert.equal(blocks[0].date, "12 mars 765");
  assert.equal(blocks[0].text, "Description longue et libre de l'événement, de son contexte et de ses conséquences.");

  assert.equal(blocks[1].title, "Séisme de Lisbonne");
  assert.equal(blocks[1].date, "1er novembre 1755 à 9 h 30");
  assert.equal(blocks[1].text, "Description longue et libre.");

  assert.equal(blocks[2].title, "Événement antique");
  assert.equal(blocks[2].date, "15 mars 44 av. J.-C.");
  assert.equal(blocks[2].text, "Description longue et libre.");
});

test("aucune propriété `type` n'est jamais déduite du nouveau format (le moteur ne produit ni type ni tags)", () => {
  const body = "## Titre\n\n### 1755\n\nTexte.\n";
  const result = parseChronologyImport(body);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.blocks[0]).sort(), ["date", "text", "title"]);
});

test("ancien format valide : repli sur « ## AAAA[-MM[-JJ]] - Titre » (signature détectée n'importe où dans le document)", () => {
  const body = [
    "## 1755-11-01 - Séisme de Lisbonne",
    "Texte du séisme.",
    "",
    "## 1879 - Invention du train électrique",
    "Texte du train.",
  ].join("\n");

  const result = parseChronologyImport(body);
  assert.equal(result.ok, true);
  const blocks = result.blocks;

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].date, "1755-11-01");
  assert.equal(blocks[0].title, "Séisme de Lisbonne");
  assert.equal(blocks[1].date, "1879");
  assert.equal(blocks[1].title, "Invention du train électrique");
});

test("document sans aucun titre daté ou reconnu → aucun bloc (ok, liste vide)", () => {
  const result = parseChronologyImport("Juste un paragraphe de texte, sans titre.");
  assert.equal(result.ok, true);
  assert.deepEqual(result.blocks, []);
});

/* ================== Documents mal formés : import REFUSÉ, jamais partiel ================== */

test("un « ## » sans « ### » à l'intérieur : import entièrement refusé, même mêlé à des blocs valides", () => {
  const body = [
    "## Sans date",
    "",
    "Ce bloc n'a pas de sous-titre daté.",
    "",
    "## Avec date",
    "",
    "### 1900",
    "",
    "Ce bloc, lui, est complet.",
  ].join("\n");

  const result = parseChronologyImport(body);
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, "missing-date");
  assert.equal(result.error.title, "Sans date");
});

test("un « ### » qui ne contient pas une date reconnue (ex. « Conséquences politiques ») : import refusé", () => {
  const body = [
    "## Séisme de Lisbonne",
    "",
    "### Conséquences politiques",
    "",
    "Le royaume vacille.",
  ].join("\n");

  const result = parseChronologyImport(body);
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, "invalid-date");
  assert.equal(result.error.title, "Séisme de Lisbonne");
});

test("mélange de blocs valides et invalides (nouveau format) : aucune création partielle, la première erreur est rapportée", () => {
  const body = [
    "## Premier événement",
    "",
    "### 12 mars 765",
    "",
    "Description valide.",
    "",
    "## Deuxième événement",
    "",
    "### pas une date du tout",
    "",
    "Description qui ne sera jamais importée.",
  ].join("\n");

  const result = parseChronologyImport(body);
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, "invalid-date");
  assert.equal(result.error.title, "Deuxième événement");
});

test("ancien format avec une date invalide (mois hors bornes) : import refusé, jamais un fichier partiel", () => {
  const body = [
    "## 1755-11-01 - Séisme de Lisbonne",
    "Texte valide.",
    "",
    "## 1900-13-01 - Date impossible",
    "Texte qui ne sera jamais importé.",
  ].join("\n");

  const result = parseChronologyImport(body);
  assert.equal(result.ok, false);
  assert.equal(result.error.reason, "invalid-date");
});

test("projection — l'API historique conserve exactement les trois propriétés d'un bloc", () => {
  const result = parseChronologyImport("## Titre\n### 1755\nTexte");
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.blocks[0]).sort(), ["date", "text", "title"]);
});

test("projection — produit des bornes absolues par événement", () => {
  const source = "# Chronologie\n\n## Événement A\n\n### 1755\n\nTexte A\n\n## Événement B\n\n### 1756\n\nTexte B";
  const result = parseChronologyProjection(source);
  assert.equal(result.ok, true);
  assert.equal(result.blocks.length, 2);
  assert.match(source.slice(result.blocks[0].sourceStart, result.blocks[0].sourceEnd), /^## Événement A/);
  assert.equal(source.slice(result.blocks[0].sourceStart, result.blocks[0].sourceEnd).includes("## Événement B"), false);
  assert.equal(result.blocks[1].sourceEnd, source.length);
});

test("projection — conserve les offsets absolus après un frontmatter initial", () => {
  const source = "---\ntags:\n  - histoire\n---\n# Chronologie\n\n## Événement A\n### 1755\nTexte";
  const result = parseChronologyProjection(source);
  assert.equal(result.ok, true);
  assert.equal(source.slice(result.blocks[0].sourceStart).startsWith("## Événement A"), true);
});

test("projection — refuse atomiquement un document legacy invalide", () => {
  const source = "## 1755 - Valide\nTexte\n\n## 1900-13-01 - Invalide\nTexte";
  const result = parseChronologyProjection(source);
  assert.equal(result.ok, false);
});
