import test from "node:test";
import assert from "node:assert/strict";
import { createCarnetLifecycle } from "../src/carnet/core/lifecycle.js";

test("Carnet lifecycle is idempotent and cleans its class", () => {
  const classes = new Set(); const wrapper = { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), remove: (name) => classes.delete(name) } };
  const file = { path: "Projet/Carnet.canvas" }; const app = { workspace: { getLeavesOfType: () => [{ view: { file, containerEl: wrapper } }] } };
  const lifecycle = createCarnetLifecycle(app, (candidate) => candidate?.path === file.path);
  lifecycle.refresh(); lifecycle.refresh(); assert.equal(classes.has("feuillets-carnet-canvas"), true);
  lifecycle.cleanup(); assert.equal(classes.has("feuillets-carnet-canvas"), false);
});

/* ============================================================
 * §16/§17/§23 — Titre d'onglet (Correctif « Carnet logique unique »)
 * ============================================================ */

/** Fabrique une leaf Canvas minimale : `.tabHeaderEl` porte le VRAI DOM
 * ciblé (`.workspace-tab-header-inner-title`), jamais un
 * document.querySelector global — chaque leaf a son propre élément. */
function makeCanvasLeaf(file, initialTitle) {
  const titleEl = { textContent: initialTitle };
  const tabHeaderEl = { querySelector: (selector) => (selector === ".workspace-tab-header-inner-title" ? titleEl : null) };
  const classes = new Set();
  const containerEl = { classList: { toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)), remove: (name) => classes.delete(name) } };
  return { leaf: { view: { file, containerEl }, tabHeaderEl }, titleEl, classes };
}

test("§23.2-3 — folder Carnet : titre « Carnet · CHAPITRE 1 », identique qu'on accède par Binder ou par Research liée", () => {
  const fileA = { path: "Projet/_Feuillets/Carnets/abc.canvas" };
  const { leaf: leafFromBinder, titleEl: titleFromBinder } = makeCanvasLeaf(fileA, "abc");
  const resolveTitle = (file) => (file?.path === fileA.path ? "Carnet · CHAPITRE 1" : null);
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leafFromBinder] } }, () => true, resolveTitle);
  lifecycle.refresh();
  assert.equal(titleFromBinder.textContent, "Carnet · CHAPITRE 1");

  // Même UUID/fichier ouvert dans une AUTRE leaf (ouvert depuis Research) :
  // le resolveTitle ne dépend que du fichier, jamais du point d'entrée —
  // donc rigoureusement le même texte des deux côtés.
  const { leaf: leafFromResearch, titleEl: titleFromResearch } = makeCanvasLeaf(fileA, "abc");
  const lifecycle2 = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leafFromResearch] } }, () => true, resolveTitle);
  lifecycle2.refresh();
  assert.equal(titleFromResearch.textContent, titleFromBinder.textContent);
});

test("§23.1 — Carnet global : titre « Carnet »", () => {
  const globalFile = { path: "Projet/Carnet.canvas" };
  const { leaf, titleEl } = makeCanvasLeaf(globalFile, "Carnet");
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leaf] } }, () => true, () => "Carnet");
  lifecycle.refresh();
  assert.equal(titleEl.textContent, "Carnet");
});

test("§23.4 — l'UUID technique n'apparaît jamais dans le texte visible", () => {
  const file = { path: "Projet/_Feuillets/Carnets/3758ff47-67c3-4cd6-aaaa-000000000000.canvas" };
  const { leaf, titleEl } = makeCanvasLeaf(file, "3758ff47-67c3-4cd6-aaaa-000000000000");
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leaf] } }, () => true, () => "Carnet · CHAPITRE 1");
  lifecycle.refresh();
  assert.equal(titleEl.textContent.includes("3758ff47"), false);
});

test("§23.6 — deux propriétaires homonymes : le titre affiché reste ce que resolveTitle calcule (suffixes minimaux gérés en amont)", () => {
  const fileA = { path: "Projet/_Feuillets/Carnets/a.canvas" };
  const fileB = { path: "Projet/_Feuillets/Carnets/b.canvas" };
  const { leaf: leafA, titleEl: titleA } = makeCanvasLeaf(fileA, "a");
  const { leaf: leafB, titleEl: titleB } = makeCanvasLeaf(fileB, "b");
  const resolveTitle = (file) => {
    if (file?.path === fileA.path) return "Carnet · Partie A/CHAPITRE 1";
    if (file?.path === fileB.path) return "Carnet · Partie B/CHAPITRE 1";
    return null;
  };
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leafA, leafB] } }, () => true, resolveTitle);
  lifecycle.refresh();
  assert.equal(titleA.textContent, "Carnet · Partie A/CHAPITRE 1");
  assert.equal(titleB.textContent, "Carnet · Partie B/CHAPITRE 1");
});

test("§23.7 — dossier/Canvas NON reconnu comme Carnet : le titre Obsidian reste intact", () => {
  const file = { path: "Projet/Autre.canvas" };
  const { leaf, titleEl } = makeCanvasLeaf(file, "Autre");
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leaf] } }, () => false, () => null);
  lifecycle.refresh();
  assert.equal(titleEl.textContent, "Autre");
});

test("§23.8 — refresh répété : aucun préfixe dupliqué (jamais « Carnet · Carnet · X »)", () => {
  const file = { path: "Projet/_Feuillets/Carnets/abc.canvas" };
  const { leaf, titleEl } = makeCanvasLeaf(file, "abc");
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leaf] } }, () => true, () => "Carnet · CHAPITRE 1");
  lifecycle.refresh(); lifecycle.refresh(); lifecycle.refresh();
  assert.equal(titleEl.textContent, "Carnet · CHAPITRE 1");
});

test("§23.9 — cleanup : le titre d'origine est restauré", () => {
  const file = { path: "Projet/_Feuillets/Carnets/abc.canvas" };
  const { leaf, titleEl } = makeCanvasLeaf(file, "abc");
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leaf] } }, () => true, () => "Carnet · CHAPITRE 1");
  lifecycle.refresh();
  assert.equal(titleEl.textContent, "Carnet · CHAPITRE 1");
  lifecycle.cleanup();
  assert.equal(titleEl.textContent, "abc", "le texte d'origine (avant réécriture) est restauré, jamais laissé au dernier titre appliqué");
});

test("§23.9b — une leaf qui cesse d'être reconnue comme Carnet retrouve son titre d'origine sans cleanup explicite", () => {
  const file = { path: "Projet/_Feuillets/Carnets/abc.canvas" };
  const { leaf, titleEl } = makeCanvasLeaf(file, "abc");
  let recognized = true;
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leaf] } }, () => recognized, () => (recognized ? "Carnet · CHAPITRE 1" : null));
  lifecycle.refresh();
  assert.equal(titleEl.textContent, "Carnet · CHAPITRE 1");
  recognized = false;
  lifecycle.refresh();
  assert.equal(titleEl.textContent, "abc");
});

test("§23.10 — plusieurs Canvas ouverts : chaque leaf ne reçoit QUE son propre titre", () => {
  const fileA = { path: "Projet/_Feuillets/Carnets/a.canvas" };
  const fileB = { path: "Projet/_Feuillets/Carnets/b.canvas" };
  const { leaf: leafA, titleEl: titleA } = makeCanvasLeaf(fileA, "a");
  const { leaf: leafB, titleEl: titleB } = makeCanvasLeaf(fileB, "b");
  const resolveTitle = (file) => (file?.path === fileA.path ? "Carnet · CHAPITRE 1" : file?.path === fileB.path ? "Carnet · CHAPITRE 2" : null);
  const lifecycle = createCarnetLifecycle({ workspace: { getLeavesOfType: () => [leafA, leafB] } }, () => true, resolveTitle);
  lifecycle.refresh();
  assert.equal(titleA.textContent, "Carnet · CHAPITRE 1");
  assert.equal(titleB.textContent, "Carnet · CHAPITRE 2");
  assert.notEqual(titleA, titleB, "deux éléments DOM distincts, jamais un querySelector global partagé");
});
