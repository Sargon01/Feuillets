import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFolderCarnetScope, isPathInsideScope, listScopeMarkdownFiles } from "../src/carnet/core/scope.js";

test("folder Carnet scope is strictly inside the real project root", () => {
  assert.equal(createFolderCarnetScope("Projet", "Projet/Manuscrit", "Projet"), null);
  const scope = createFolderCarnetScope("Projet", "Projet/Manuscrit", "Projet/Recherche/Personnages");
  assert.ok(scope);
  assert.equal(isPathInsideScope("Projet/Recherche/Personnages/A.md", scope), true);
  assert.equal(isPathInsideScope("Projet/Recherche/Personnages-bis/A.md", scope), false);
});

test("scope markdown listing only walks its folder", () => {
  const folder = new TFolder("Projet/Recherche"); const sub = new TFolder("Projet/Recherche/Sub"); const md = new TFile("Projet/Recherche/Sub/A.md"); const txt = new TFile("Projet/Recherche/B.txt");
  folder.children = [sub, txt]; sub.parent = folder; sub.children = [md]; md.parent = sub; txt.parent = folder;
  const scope = createFolderCarnetScope("Projet", "Projet/Manuscrit", folder.path);
  assert.deepEqual(listScopeMarkdownFiles(scope, folder).map((file) => file.path), [md.path]);
});

/* ============================================================
 * §8/§9/§22 — Scope logique du Carnet partagé (Correctif « Carnet unique »)
 * ============================================================ */

function buildLinkedFolders() {
  const binder = new TFolder("Projet/Manuscrit/CHAPITRE 1");
  const binderSub = new TFolder("Projet/Manuscrit/CHAPITRE 1/Sub");
  const binderMd = new TFile("Projet/Manuscrit/CHAPITRE 1/Sub/A.md");
  binder.children = [binderSub]; binderSub.parent = binder; binderSub.children = [binderMd]; binderMd.parent = binderSub;

  const research = new TFolder("Projet/Recherche/CHAPITRE 1");
  const researchMd = new TFile("Projet/Recherche/CHAPITRE 1/Note.md");
  const researchTxt = new TFile("Projet/Recherche/CHAPITRE 1/Image.png");
  research.children = [researchMd, researchTxt]; researchMd.parent = research; researchTxt.parent = research;

  return { binder, binderSub, binderMd, research, researchMd, researchTxt };
}

test("§22.1 — scope Binder SANS Research = uniquement les fichiers Binder", () => {
  const { binder, binderMd } = buildLinkedFolders();
  const scope = createFolderCarnetScope("Projet", "Projet/Manuscrit", binder.path);
  assert.equal(scope.linkedResearchFolderPath, undefined);
  assert.deepEqual(listScopeMarkdownFiles(scope, binder).map((f) => f.path), [binderMd.path]);
});

test("§22.2 — scope Binder LIÉ = fichiers Binder + fichiers Research (récursif)", () => {
  const { binder, binderMd, research, researchMd } = buildLinkedFolders();
  const scope = createFolderCarnetScope("Projet", "Projet/Manuscrit", binder.path, research.path);
  assert.equal(scope.linkedResearchFolderPath, research.path);
  const files = listScopeMarkdownFiles(scope, binder, research).map((f) => f.path);
  assert.deepEqual(files.sort(), [binderMd.path, researchMd.path].sort());
});

test("§22.3 — déduplication par path : un même fichier présent des deux côtés n'apparaît qu'une fois", () => {
  const { binder, binderMd, research } = buildLinkedFolders();
  // Cas dégénéré (ne devrait pas arriver en pratique, mais la garantie de
  // dédup doit tenir) : le même TFile listé dans les deux arborescences.
  research.children.push(binderMd);
  const scope = createFolderCarnetScope("Projet", "Projet/Manuscrit", binder.path, research.path);
  const files = listScopeMarkdownFiles(scope, binder, research).map((f) => f.path);
  assert.equal(files.filter((p) => p === binderMd.path).length, 1);
});

test("§22.4 — aucun scan global du vault : un dossier NON passé en linkedFolder n'est jamais consulté", () => {
  const { binder, binderMd, research } = buildLinkedFolders();
  const scope = createFolderCarnetScope("Projet", "Projet/Manuscrit", binder.path, research.path);
  // linkedFolder omis à l'appel : seul le dossier Binder est parcouru,
  // jamais une résolution implicite du chemin `linkedResearchFolderPath`.
  assert.deepEqual(listScopeMarkdownFiles(scope, binder).map((f) => f.path), [binderMd.path]);
});

test("§22.5 — scope Research autonome = uniquement ses propres fichiers", () => {
  const { research, researchMd } = buildLinkedFolders();
  const scope = createFolderCarnetScope("Projet", "Projet/Manuscrit", research.path);
  assert.equal(scope.linkedResearchFolderPath, undefined);
  assert.deepEqual(listScopeMarkdownFiles(scope, research).map((f) => f.path), [researchMd.path]);
});

test("§22.6-7 — après changement/détachement du lien, le scope reconstruit reflète le nouvel état", () => {
  const { binder, binderMd, research, researchMd } = buildLinkedFolders();
  const linked = createFolderCarnetScope("Projet", "Projet/Manuscrit", binder.path, research.path);
  assert.deepEqual(listScopeMarkdownFiles(linked, binder, research).map((f) => f.path).sort(), [binderMd.path, researchMd.path].sort());

  // Détachement : le scope reconstruit pour ce dossier n'a plus de dossier lié.
  const detached = createFolderCarnetScope("Projet", "Projet/Manuscrit", binder.path);
  assert.equal(detached.linkedResearchFolderPath, undefined);
  assert.deepEqual(listScopeMarkdownFiles(detached, binder).map((f) => f.path), [binderMd.path], "Research n'est plus inclus après détachement");
});
