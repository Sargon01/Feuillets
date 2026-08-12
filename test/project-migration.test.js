import test from "node:test";
import assert from "node:assert/strict";
import { TFolder, TFile } from "obsidian";
import { detectLegacyProjectStructure, LEGACY_PROJECT_INVENTORY } from "../src/services/project-migration.js";

function createFakeVault(files = []) {
  const map = new Map();
  for (const f of files) map.set(f.path, f);
  return {
    vault: {
      getAbstractFileByPath: (path) => map.get(path) || null,
    },
    map,
  };
}

function freshSettings(overrides = {}) {
  return {
    projectFolder: "Projet/Manuscrit",
    projects: ["Projet/Manuscrit"],
    projectMeta: {},
    ...overrides,
  };
}

test("Phase 1E : projet entièrement canonique → canonical=true, aucun legacy", () => {
  const project = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit");
  const aux = new TFolder("Projet/_Feuillets");
  const rech = new TFolder("Projet/_Feuillets/Recherche");
  const ress = new TFolder("Projet/_Feuillets/Ressources");
  const titlePage = new TFile("Projet/Manuscrit/Front/Page de titre.md");

  manuscrit.parent = project;

  const { vault } = createFakeVault([project, manuscrit, aux, rech, ress, titlePage]);
  const app = { vault };
  const settings = freshSettings();

  const res = detectLegacyProjectStructure(app, settings);

  assert.equal(res.canonical, true, "est canonique");
  assert.deepEqual(res.legacyPaths, [], "aucun chemin legacy");
  assert.deepEqual(res.conflicts, [], "aucun conflit");
});

test("Phase 1E : ancien _Research / Resources / _Snapshots détectés", () => {
  const project = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit");
  const oldResearch = new TFolder("Projet/_Research");
  const oldResources = new TFolder("Projet/Resources");
  const oldSnapshots = new TFolder("Projet/_Snapshots");

  manuscrit.parent = project;

  const { vault } = createFakeVault([project, manuscrit, oldResearch, oldResources, oldSnapshots]);
  const app = { vault };
  const settings = freshSettings();

  const res = detectLegacyProjectStructure(app, settings);

  assert.equal(res.canonical, false, "non canonique");
  assert.ok(res.legacyPaths.includes("Projet/_Research"), "détecte _Research");
  assert.ok(res.legacyPaths.includes("Projet/Resources"), "détecte Resources");
  assert.ok(res.legacyPaths.includes("Projet/_Snapshots"), "détecte _Snapshots");
  assert.deepEqual(res.conflicts, [], "pas de conflit si la destination canonique est absente");
});

test("Phase 1E : ancien Template / Layout détectés", () => {
  const project = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit");
  const oldTemplates = new TFolder("Projet/Resources/Templates");
  const oldLayouts = new TFolder("Projet/_Resources/Layouts");

  manuscrit.parent = project;

  const { vault } = createFakeVault([project, manuscrit, oldTemplates, oldLayouts]);
  const app = { vault };
  const settings = freshSettings();

  const res = detectLegacyProjectStructure(app, settings);

  assert.equal(res.canonical, false, "non canonique");
  assert.ok(res.legacyPaths.includes("Projet/Resources/Templates"), "détecte Templates");
  assert.ok(res.legacyPaths.includes("Projet/_Resources/Layouts"), "détecte Layouts");
});

test("Phase 1E : ancien Characters / Timeline détectés", () => {
  const project = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit");
  const oldCharacters = new TFolder("Projet/Research/Characters");
  const oldTimeline = new TFolder("Projet/_Recherche/Timeline");

  manuscrit.parent = project;

  const { vault } = createFakeVault([project, manuscrit, oldCharacters, oldTimeline]);
  const app = { vault };
  const settings = freshSettings();

  const res = detectLegacyProjectStructure(app, settings);

  assert.equal(res.canonical, false, "non canonique");
  assert.ok(res.legacyPaths.includes("Projet/Research/Characters"), "détecte Characters");
  assert.ok(res.legacyPaths.includes("Projet/_Recherche/Timeline"), "détecte Timeline");
});

test("Phase 1E : canonical + legacy pour le même rôle → conflit", () => {
  const project = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit");
  const canonicalResearch = new TFolder("Projet/_Feuillets/Recherche");
  const legacyResearch = new TFolder("Projet/_Research");

  manuscrit.parent = project;

  const { vault } = createFakeVault([project, manuscrit, canonicalResearch, legacyResearch]);
  const app = { vault };
  const settings = freshSettings();

  const res = detectLegacyProjectStructure(app, settings);

  assert.equal(res.canonical, false, "non canonique car conflit");
  assert.ok(res.legacyPaths.includes("Projet/_Research"));
  assert.equal(res.conflicts.length, 1, "un conflit détecté");
  assert.equal(res.conflicts[0].role, "research");
  assert.equal(res.conflicts[0].canonicalPath, "Projet/_Feuillets/Recherche");
  assert.equal(res.conflicts[0].legacyPath, "Projet/_Research");
});

test("Phase 1E : dossier adopté correctement analysé sans remonter au parent", () => {
  const parentFolder = new TFolder("ProjetsExterieurs");
  const adopted = new TFolder("ProjetsExterieurs/Mes textes");
  const canonicalAux = new TFolder("ProjetsExterieurs/Mes textes/_Feuillets");
  const canonicalRech = new TFolder("ProjetsExterieurs/Mes textes/_Feuillets/Recherche");
  const legacyInParent = new TFolder("ProjetsExterieurs/_Research");

  adopted.parent = parentFolder;

  const { vault } = createFakeVault([parentFolder, adopted, canonicalAux, canonicalRech, legacyInParent]);
  const app = { vault };
  const settings = freshSettings({
    projectFolder: "ProjetsExterieurs/Mes textes",
    projects: ["ProjetsExterieurs/Mes textes"],
  });

  const res = detectLegacyProjectStructure(app, settings);

  assert.equal(res.canonical, true, "dossier adopté canonique sans remonter au parent");
  assert.deepEqual(res.legacyPaths, [], "n'inclut pas le _Research du dossier parent");
});

test("Phase 1E : le détecteur ne modifie jamais le vault (read-only)", () => {
  const project = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit");
  const legacyResearch = new TFolder("Projet/_Research");

  manuscrit.parent = project;

  let writeOperationCalled = false;
  const { vault } = createFakeVault([project, manuscrit, legacyResearch]);
  vault.create = () => { writeOperationCalled = true; };
  vault.modify = () => { writeOperationCalled = true; };
  vault.delete = () => { writeOperationCalled = true; };
  vault.rename = () => { writeOperationCalled = true; };

  const app = { vault };
  const settings = freshSettings();

  detectLegacyProjectStructure(app, settings);

  assert.equal(writeOperationCalled, false, "aucune écriture n'a été effectuée sur le vault");
});
