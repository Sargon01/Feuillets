import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { resolveCompileScopeFiles } from "../src/services/compile-scope.js";

function createFixture(orders = {}) {
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène A.md");
  const second = new TFile("Projet/Manuscrit/Chapitre 1/Scène B.md");

  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [first, second];
  first.parent = chapter;
  second.parent = chapter;

  const { vault } = createFakeVault([manuscript, chapter, first, second]);
  return {
    app: { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } },
    chapter,
    first,
    second,
    settings: {
      projectFolder: manuscript.path,
      orders,
      folderPositions: {},
      compileFileName: "Manuscrit.md",
    },
  };
}

test("sélectionner un dossier retourne tous ses fichiers Markdown", () => {
  const { app, chapter, first, second, settings } = createFixture();

  const files = resolveCompileScopeFiles(app, settings, {
    type: "selection",
    projectRoot: "Projet/Manuscrit",
    paths: [chapter.path],
  });

  assert.deepEqual(files.map((file) => file.path), [first.path, second.path]);
});

test("sélectionner un dossier et l'un de ses fichiers ne crée pas de doublon", () => {
  const { app, chapter, first, second, settings } = createFixture();

  const files = resolveCompileScopeFiles(app, settings, {
    type: "selection",
    projectRoot: "Projet/Manuscrit",
    paths: [chapter.path, first.path],
  });

  assert.deepEqual(files.map((file) => file.path), [first.path, second.path]);
});

test("la sélection développée respecte l'ordre du Binder", () => {
  const { app, chapter, first, second, settings } = createFixture({
    "Projet/Manuscrit/Chapitre 1": ["Scène B.md", "Scène A.md"],
  });

  const files = resolveCompileScopeFiles(app, settings, {
    type: "selection",
    projectRoot: "Projet/Manuscrit",
    paths: [chapter.path],
  });

  assert.deepEqual(files.map((file) => file.path), [second.path, first.path]);
});
