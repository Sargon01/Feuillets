import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile } from "../src/services/compile-export.js";

test("compile : respecte l'ordre, les pages Front et compile: false", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/Front");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const titlePage = new TFile("Projet/Manuscrit/Front/Page de titre.md", "---\ntitle: Mon livre\ntype: titre\n---\n:::titre: Mon livre\n");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "---\ntitle: Départ\n---\nPremier texte.");
  const skipped = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md", "---\ntitle: Secret\ncompile: false\n---\nTexte exclu.");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [front, chapter];
  front.parent = manuscript;
  chapter.parent = manuscript;
  front.children = [titlePage];
  chapter.children = [first, skipped];
  titlePage.parent = front;
  first.parent = chapter;
  skipped.parent = chapter;

  const { vault } = createFakeVault([volume, manuscript, front, chapter, titlePage, first, skipped]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([
    [titlePage.path, { title: "Mon livre", type: "titre", compile: true }],
    [first.path, { title: "Départ", compile: true }],
    [skipped.path, { title: "Secret", compile: false }],
  ]);
  const app = {
    vault,
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: frontmatter.get(file.path) || {} };
      },
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: [front.name, chapter.name] },
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const result = await compile(app, settings);

  assert.ok(result);
  assert.match(result.manuscript, /FEUILLETS-FPROLE:titre/);
  assert.match(result.manuscript, /# Départ/);
  assert.match(result.manuscript, /Premier texte\./);
  assert.doesNotMatch(result.manuscript, /Texte exclu/);
  assert.equal(result.segments.length, 3);
  assert.ok(vault.getAbstractFileByPath("Projet/Sortie/Manuscrit.md"));
});
