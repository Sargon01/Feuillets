import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  isOuvrageRoot,
  ouvrageRelativePath,
  registerOuvrage,
  remapOuvrageRoots,
  resolveEditorialRoot,
  unregisterOuvrage,
} from "../src/services/editorial-roots.js";

test("ouvrageRelativePath : chemin relatif valide, racine identique refusée, dossier externe refusé", () => {
  assert.equal(ouvrageRelativePath("WARPI", "WARPI/NEFES"), "NEFES");
  assert.equal(ouvrageRelativePath("WARPI", "WARPI/Collection/Tome 2"), "Collection/Tome 2");
  assert.equal(ouvrageRelativePath("WARPI", "WARPI"), null);
  assert.equal(ouvrageRelativePath("WARPI", "AUTRE/NEFES"), null);
  assert.equal(ouvrageRelativePath("WARPI", "WARPI_EXT/NEFES"), null);
  assert.equal(ouvrageRelativePath("WARPI", ""), null);
  assert.equal(ouvrageRelativePath("", "WARPI/NEFES"), null);
  assert.equal(ouvrageRelativePath("  ", "WARPI/NEFES"), null);
  assert.equal(ouvrageRelativePath("WARPI/", "/WARPI/NEFES/"), "NEFES");
});

test("registerOuvrage : enregistrement idempotent", () => {
  const projectRoot = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const settings = { projectMeta: {} };

  // Premier enregistrement
  const first = registerOuvrage(settings, projectRoot, nefes);
  assert.equal(first, true);
  assert.deepEqual(settings.projectMeta["WARPI"].ouvrageRoots, {
    "NEFES": { version: 1 },
  });

  // Deuxième enregistrement identique : idempotent, renvoie false et ne modifie rien
  const second = registerOuvrage(settings, projectRoot, nefes);
  assert.equal(second, false);
  assert.deepEqual(settings.projectMeta["WARPI"].ouvrageRoots, {
    "NEFES": { version: 1 },
  });

  // Tentative sur la racine globale : refusée
  assert.equal(registerOuvrage(settings, projectRoot, projectRoot), false);

  // Tentative sur un dossier externe : refusée
  const externe = new TFolder("AUTRE/Dossier");
  assert.equal(registerOuvrage(settings, projectRoot, externe), false);
});

test("unregisterOuvrage : désenregistrement exact sans suppression d’un ouvrage enfant", () => {
  const projectRoot = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const volumeAnnexe = new TFolder("WARPI/NEFES/Volume annexe");
  const settings = {
    projectMeta: {
      "WARPI": {
        ouvrageRoots: {
          "NEFES": { version: 1 },
          "NEFES/Volume annexe": { version: 1 },
        },
      },
    },
  };

  // Désenregistrement de NEFES : NEFES/Volume annexe reste intact
  const removed = unregisterOuvrage(settings, projectRoot, nefes);
  assert.equal(removed, true);
  assert.deepEqual(settings.projectMeta["WARPI"].ouvrageRoots, {
    "NEFES/Volume annexe": { version: 1 },
  });

  // Tentative de désenregistrer à nouveau NEFES : renvoie false
  assert.equal(unregisterOuvrage(settings, projectRoot, nefes), false);

  // Désenregistrement du dernier ouvrage : supprime la map ouvrageRoots
  const removedChild = unregisterOuvrage(settings, projectRoot, volumeAnnexe);
  assert.equal(removedChild, true);
  assert.equal("ouvrageRoots" in settings.projectMeta["WARPI"], false);
});

test("resolveEditorialRoot : résolution sur la racine globale lorsqu’aucun ouvrage n’est déclaré", () => {
  const projectRoot = new TFolder("WARPI");
  const chapter = new TFolder("WARPI/Chapitre 1");
  const scene = new TFile("WARPI/Chapitre 1/Scène 1.md");
  chapter.parent = projectRoot;
  scene.parent = chapter;
  projectRoot.children = [chapter];
  chapter.children = [scene];

  const { vault, files } = createFakeVault([projectRoot, chapter, scene]);
  vault.files = files;
  const app = { vault };
  const settings = { projectMeta: {} };

  // Fichier profond
  const rootForFile = resolveEditorialRoot(app, settings, projectRoot, scene);
  assert.equal(rootForFile, projectRoot);

  // Dossier
  const rootForFolder = resolveEditorialRoot(app, settings, projectRoot, chapter);
  assert.equal(rootForFolder, projectRoot);
});

test("resolveEditorialRoot : résolution de WARPI/NEFES depuis un fichier profond", () => {
  const projectRoot = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const chapter = new TFolder("WARPI/NEFES/Partie 1/Chapitre 1");
  const scene = new TFile("WARPI/NEFES/Partie 1/Chapitre 1/Scène 1.md");
  nefes.parent = projectRoot;
  chapter.parent = nefes;
  scene.parent = chapter;

  const { vault, files } = createFakeVault([projectRoot, nefes, chapter, scene]);
  vault.files = files;
  const app = { vault };
  const settings = {
    projectMeta: {
      "WARPI": {
        ouvrageRoots: {
          "NEFES": { version: 1 },
        },
      },
    },
  };

  const resolved = resolveEditorialRoot(app, settings, projectRoot, scene);
  assert.equal(resolved, nefes);
  assert.equal(resolved.path, "WARPI/NEFES");
});

test("resolveEditorialRoot : priorité de l’ouvrage le plus proche avec NEFES et NEFES/Volume annexe", () => {
  const projectRoot = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const annexe = new TFolder("WARPI/NEFES/Volume annexe");
  const chapterAnnexe = new TFolder("WARPI/NEFES/Volume annexe/Chapitre 1");
  const sceneInAnnexe = new TFile("WARPI/NEFES/Volume annexe/Chapitre 1/Scène 1.md");
  const chapterNefes = new TFolder("WARPI/NEFES/Chapitre A");
  const sceneInNefes = new TFile("WARPI/NEFES/Chapitre A/Scène A.md");

  nefes.parent = projectRoot;
  annexe.parent = nefes;
  chapterAnnexe.parent = annexe;
  sceneInAnnexe.parent = chapterAnnexe;
  chapterNefes.parent = nefes;
  sceneInNefes.parent = chapterNefes;

  const { vault, files } = createFakeVault([
    projectRoot,
    nefes,
    annexe,
    chapterAnnexe,
    sceneInAnnexe,
    chapterNefes,
    sceneInNefes,
  ]);
  vault.files = files;
  const app = { vault };
  const settings = {
    projectMeta: {
      "WARPI": {
        ouvrageRoots: {
          "NEFES": { version: 1 },
          "NEFES/Volume annexe": { version: 1 },
        },
      },
    },
  };

  // Depuis le fichier dans Volume annexe : priorité à l'ouvrage le plus proche (Volume annexe)
  const resolvedAnnexe = resolveEditorialRoot(app, settings, projectRoot, sceneInAnnexe);
  assert.equal(resolvedAnnexe, annexe);
  assert.equal(resolvedAnnexe.path, "WARPI/NEFES/Volume annexe");

  // Depuis le dossier Volume annexe lui-même : résout Volume annexe
  const resolvedFolder = resolveEditorialRoot(app, settings, projectRoot, annexe);
  assert.equal(resolvedFolder, annexe);

  // Depuis le fichier dans NEFES hors Volume annexe : résout NEFES
  const resolvedNefes = resolveEditorialRoot(app, settings, projectRoot, sceneInNefes);
  assert.equal(resolvedNefes, nefes);
  assert.equal(resolvedNefes.path, "WARPI/NEFES");
});

test("isOuvrageRoot et resolveEditorialRoot : entrée obsolète ignorée", () => {
  const projectRoot = new TFolder("WARPI");
  const existingFolder = new TFolder("WARPI/NEFES");
  existingFolder.parent = projectRoot;
  const scene = new TFile("WARPI/NEFES/Scène.md");
  scene.parent = existingFolder;

  const deletedFolder = new TFolder("WARPI/Supprimé");
  deletedFolder.parent = projectRoot;

  // Seul existingFolder existe dans le vault
  const { vault, files } = createFakeVault([projectRoot, existingFolder, scene]);
  vault.files = files;
  const app = { vault };
  const settings = {
    projectMeta: {
      "WARPI": {
        ouvrageRoots: {
          "Supprimé": { version: 1 },
          "NEFES": { version: 1 },
        },
      },
    },
  };

  // isOuvrageRoot refuse le dossier supprimé
  assert.equal(isOuvrageRoot(app, settings, projectRoot, deletedFolder), false);
  assert.equal(isOuvrageRoot(app, settings, projectRoot, existingFolder), true);

  // resolveEditorialRoot ignore l'entrée obsolète et replie sur projectRoot pour un nœud sous Supprimé
  const orphanScene = new TFile("WARPI/Supprimé/Scène.md");
  orphanScene.parent = deletedFolder;
  const resolved = resolveEditorialRoot(app, settings, projectRoot, orphanScene);
  assert.equal(resolved, projectRoot);
});

test("remapOuvrageRoots : remappage lors du renommage d’un ouvrage", () => {
  const settings = {
    projectMeta: {
      "WARPI": {
        ouvrageRoots: {
          "NEFES": { version: 1 },
        },
      },
    },
  };

  const changed = remapOuvrageRoots(settings, "WARPI", "WARPI/NEFES", "WARPI/TOME_1");
  assert.equal(changed, true);
  assert.deepEqual(settings.projectMeta["WARPI"].ouvrageRoots, {
    "TOME_1": { version: 1 },
  });

  // Ancien chemin hors de la racine globale : ne modifie rien
  const noChangeOutside = remapOuvrageRoots(settings, "WARPI", "AUTRE/Dossier", "WARPI/Dossier");
  assert.equal(noChangeOutside, false);

  // Aucune clé correspondante : ne modifie rien
  const noChangeUnknown = remapOuvrageRoots(settings, "WARPI", "WARPI/Inconnu", "WARPI/Autre");
  assert.equal(noChangeUnknown, false);
});

test("remapOuvrageRoots : remappage de ses ouvrages descendants", () => {
  const settings = {
    projectMeta: {
      "WARPI": {
        ouvrageRoots: {
          "NEFES": { version: 1 },
          "NEFES/Volume annexe": { version: 1 },
          "NEFES/Hors-série": { version: 1 },
        },
      },
    },
  };

  const changed = remapOuvrageRoots(settings, "WARPI", "WARPI/NEFES", "WARPI/CYCLE_1");
  assert.equal(changed, true);
  assert.deepEqual(settings.projectMeta["WARPI"].ouvrageRoots, {
    "CYCLE_1": { version: 1 },
    "CYCLE_1/Volume annexe": { version: 1 },
    "CYCLE_1/Hors-série": { version: 1 },
  });
});

test("remapOuvrageRoots : collision de clé cible préservée", () => {
  const settings = {
    projectMeta: {
      "WARPI": {
        ouvrageRoots: {
          "Tome 1": { version: 1 },
          "Tome 2": { version: 1 },
          "Tome 1/Annexe": { version: 1 },
        },
      },
    },
  };

  // Renommer Tome 1 vers Tome 2 : Tome 2 existe déjà (collision), il est conservé
  // Tome 1 est supprimé, et Tome 1/Annexe est bien déplacé vers Tome 2/Annexe
  const changed = remapOuvrageRoots(settings, "WARPI", "WARPI/Tome 1", "WARPI/Tome 2");
  assert.equal(changed, true);
  assert.deepEqual(settings.projectMeta["WARPI"].ouvrageRoots, {
    "Tome 2": { version: 1 },
    "Tome 2/Annexe": { version: 1 },
  });

  // Collision totale : deux ouvrages sans descendant libre
  const settingsCollision = {
    projectMeta: {
      "WARPI": {
        ouvrageRoots: {
          "A": { version: 1 },
          "B": { version: 1 },
        },
      },
    },
  };
  const changedTotal = remapOuvrageRoots(settingsCollision, "WARPI", "WARPI/A", "WARPI/B");
  assert.equal(changedTotal, true);
  assert.deepEqual(settingsCollision.projectMeta["WARPI"].ouvrageRoots, {
    "B": { version: 1 },
  });
});
