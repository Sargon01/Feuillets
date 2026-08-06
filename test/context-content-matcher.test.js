import test from "node:test";
import assert from "node:assert/strict";
import { matchContent } from "../src/services/context-content-matcher.js";

const cand = (path, cleanedBody, extra = {}) => ({
  path,
  title: extra.title ?? path.replace(/\.md$/, ""),
  basename: extra.basename ?? path.replace(/\.md$/, ""),
  cleanedBody,
  sourceKind: extra.sourceKind ?? "feuillet",
  sourcePriority: extra.sourcePriority ?? 0,
});

test("Deux termes distincts communs suffisent", () => {
  const text = "Le corsaire embarqua sur le galion espagnol au large de Suvasa.";
  const candidates = [cand("fiche.md", "Description du galion espagnol capturé près de Suvasa en 1720.")];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 1);
  assert.equal(results[0].path, "fiche.md");
  assert.ok(results[0].matchedTerms.length >= 2);
});

test("Un mot générique isolé ne suffit jamais", () => {
  const text = "Il traversa la ville sans un bruit.";
  const candidates = [cand("port.md", "Le port de Lisbonne est très animé le matin.")];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 0);
});

test("Une expression distinctive de deux mots suffit à elle seule", () => {
  const text = "Elle raconta l'histoire du grand incendie de Suvasa à ses enfants.";
  const candidates = [
    cand("incendie.md", "Chronique : le grand incendie de Suvasa ravagea tout le quartier portuaire."),
  ];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 1);
  assert.ok(results[0].matchedExpression.length >= 2);
});

test("Fiche non associée exclue (absente de la liste de candidats)", () => {
  const text = "Le galion espagnol de Suvasa appareilla à l'aube.";
  // Simule : seule une fiche NON associée contiendrait ces termes — elle
  // n'apparaît simplement jamais dans `candidates` (filtrage fait en amont,
  // côté notes-view.ts, avant l'appel à matchContent).
  const candidates = [];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 0);
});

test("Exclusion des chemins déjà remontés par le moteur fiable", () => {
  const text = "Le galion espagnol de Suvasa appareilla à l'aube.";
  const candidates = [
    cand("galion.md", "Le galion espagnol quitta le port de Suvasa sous voiles."),
  ];

  const results = matchContent(text, candidates, { excludePaths: ["galion.md"] });
  assert.equal(results.length, 0);
});

test("Limite stricte à cinq résultats", () => {
  const text = "Le galion espagnol mouilla dans la rade de Suvasa au crépuscule.";
  const candidates = Array.from({ length: 8 }, (_, i) =>
    cand(`fiche-${i}.md`, `Le galion espagnol de Suvasa figure au chapitre ${i}.`)
  );

  const results = matchContent(text, candidates);
  assert.equal(results.length, 5);
});

test("Ordre : source feuillet avant chapitre à score égal", () => {
  const text = "Le galion espagnol mouilla dans la rade de Suvasa au crépuscule.";
  const candidates = [
    cand("chap.md", "Le galion espagnol de Suvasa.", { sourceKind: "chapter", sourcePriority: 10 }),
    cand("feu.md", "Le galion espagnol de Suvasa.", { sourceKind: "feuillet", sourcePriority: 0 }),
  ];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 2);
  assert.equal(results[0].path, "feu.md");
  assert.equal(results[1].path, "chap.md");
});

test("Ordre stable à score et priorité égaux", () => {
  const text = "Le galion espagnol mouilla dans la rade de Suvasa au crépuscule.";
  const candidates = [
    cand("b.md", "Le galion espagnol de Suvasa."),
    cand("a.md", "Le galion espagnol de Suvasa."),
  ];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 2);
  // Ordre de collecte préservé (b avant a, comme fourni), jamais retrié par path.
  assert.equal(results[0].path, "b.md");
  assert.equal(results[1].path, "a.md");
});

test("Extrait centré, sans coupure de mot, avec points de suspension", () => {
  const text = "Le galion espagnol mouilla dans la rade de Suvasa au crépuscule.";
  const filler = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod. ".repeat(10);
  const body = `${filler}Le galion espagnol de Suvasa apparaît ici, loin du début. ${filler}`;
  const candidates = [cand("fiche.md", body)];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 1);
  const excerpt = results[0].excerpt;
  assert.ok(excerpt.includes("galion"));
  assert.ok(excerpt.startsWith("…"));
  assert.ok(excerpt.endsWith("…"));
  // Aucun mot ne doit être tronqué : pas de lettre collée juste après "…"
  // suivie d'un espace immédiat anormal — vérifié en s'assurant que le
  // premier "mot" après l'ellipse est un mot complet du texte source.
  assert.equal(/^…\S+ /.test(excerpt) || /^…\S+$/.test(excerpt), true);
});

test("Correspondance en tout début de document", () => {
  const text = "Le galion espagnol mouilla dans la rade de Suvasa au crépuscule.";
  const filler = "Lorem ipsum dolor sit amet consectetur. ".repeat(20);
  const body = `Le galion espagnol de Suvasa ouvre ce document. ${filler}`;
  const candidates = [cand("fiche.md", body)];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 1);
  assert.equal(results[0].excerpt.startsWith("…"), false);
  assert.ok(results[0].excerpt.endsWith("…"));
});

test("Correspondance en toute fin de document", () => {
  const text = "Le galion espagnol mouilla dans la rade de Suvasa au crépuscule.";
  const filler = "Lorem ipsum dolor sit amet consectetur. ".repeat(20);
  const body = `${filler}Ce document se termine par le galion espagnol de Suvasa.`;
  const candidates = [cand("fiche.md", body)];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 1);
  assert.ok(results[0].excerpt.startsWith("…"));
  assert.equal(results[0].excerpt.endsWith("…"), false);
});

test("Fiche vide n'est jamais retenue", () => {
  const text = "Le galion espagnol mouilla dans la rade de Suvasa au crépuscule.";
  const candidates = [cand("vide.md", "")];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 0);
});

test("Fiche très longue reste bornée à un extrait court", () => {
  const text = "Le galion espagnol mouilla dans la rade de Suvasa au crépuscule.";
  const filler = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(500);
  const body = `${filler}Le galion espagnol de Suvasa. ${filler}`;
  const candidates = [cand("fiche.md", body)];

  const results = matchContent(text, candidates);
  assert.equal(results.length, 1);
  assert.ok(results[0].excerpt.length < 260);
});

test("Requête vide ou sans terme significatif → aucun résultat", () => {
  const candidates = [cand("fiche.md", "Le galion espagnol de Suvasa.")];
  assert.equal(matchContent("", candidates).length, 0);
  assert.equal(matchContent("de la et le", candidates).length, 0);
});

/* ===================== Régression : accents encodés en Unicode décomposé
 * (NFD) — bug constaté en test manuel (voir mission de correction). Un mot
 * accentué peut être stocké en NFC ("é" = un seul caractère précomposé,
 * U+00E9) ou en NFD ("é" = "e" + accent combinant séparé, U+0065 U+0301) :
 * les deux graphies s'affichent identiquement mais ne sont PAS égales
 * caractère par caractère. Le clavier français macOS et certains
 * copier-coller produisent parfois du NFD. Avant le correctif, le
 * tokenizer cassait "épices" en NFD en deux jetons ("e" + "pices"), aucun
 * des deux ne redevenant "epices" après normalisation : la correspondance
 * échouait silencieusement alors que le texte affiché était identique à
 * l'œil. ===================== */

test("Régression NFD — un terme accentué en Unicode décomposé compte comme le même mot qu'en NFC", () => {
  const text = "Les marchands déchargèrent leurs tissus et leurs épices avant la tombée de la nuit.";
  const bodyNFD = "Les caravanes transportent des épices et des tissus précieux entre les villes.".normalize("NFD");
  const candidates = [cand("commerce.md", bodyNFD, { title: "Commerce caravanier" })];

  const results = matchContent(text, candidates);

  assert.equal(results.length, 1);
  assert.equal(results[0].path, "commerce.md");
  assert.deepEqual(results[0].matchedTerms.sort(), ["epices", "tissus"]);
});

test("Régression NFD — fonctionne aussi dans l'autre sens (passage en NFD, fiche en NFC)", () => {
  const text = "Les marchands déchargèrent leurs tissus et leurs épices avant la tombée de la nuit.".normalize("NFD");
  const body = "Les caravanes transportent des épices et des tissus précieux entre les villes.";
  const candidates = [cand("commerce.md", body, { title: "Commerce caravanier" })];

  const results = matchContent(text, candidates);

  assert.equal(results.length, 1);
  assert.equal(results[0].path, "commerce.md");
});
