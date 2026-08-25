import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile } from "../src/services/compile-export.js";
import { addLayoutOverride } from "../src/services/layout-store.js";
import { createSourceAnchor } from "../src/services/source-anchor.js";

function fixture(files, folders = []) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;
  for (const folder of folders) if (!folder.parent) folder.parent = manuscript;
  for (const file of files) if (!file.parent) file.parent = manuscript;
  manuscript.children = [...folders.filter((folder) => folder.parent?.path === manuscript.path), ...files.filter((file) => file.parent?.path === manuscript.path)];
  const all = [volume, manuscript, ...folders, ...files];
  const { vault } = createFakeVault(all);
  vault.cachedRead = vault.read;
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: Object.fromEntries([manuscript, ...folders].map((folder) => [folder.path, folder.children.map((child) => child.name)])),
    compileFileName: "Extrait.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    footnoteRenumberOnCompile: false,
  };
  return { app, settings, manuscript };
}

function attach(folder, file) {
  folder.children = [file];
  file.parent = folder;
}

test("compile avec extraction : seul le H3 correspondant est conservé", async () => {
  const file = new TFile("Projet/Manuscrit/Activités.md", "Avant.\n\n### Activité\n\n> [!questions]\n> Question.\n\n### Après\n\nTexte normal après.");
  const fixtureData = fixture([file]);
  const result = await compile(fixtureData.app, fixtureData.settings, null, null, null, { writeOutput: false, contentExtraction: { id: "q", name: "Activités", triggerRoles: ["questions"] } });
  assert.ok(result);
  assert.equal(result.manuscript, "### Activité\n\n> [!questions]\n> Question.");
  assert.equal(result.segments.length, 1);
});

test("compile avec extraction : aucun titre de dossier vide", async () => {
  const emptyChapter = new TFolder("Projet/Manuscrit/Sans preuve");
  const matchingChapter = new TFolder("Projet/Manuscrit/Avec preuve");
  const empty = new TFile("Projet/Manuscrit/Sans preuve/A.md", "Texte sans rôle.");
  const matching = new TFile("Projet/Manuscrit/Avec preuve/B.md", "> [!preuve]\n> Élément.");
  attach(emptyChapter, empty);
  attach(matchingChapter, matching);
  const fixtureData = fixture([empty, matching], [emptyChapter, matchingChapter]);
  const result = await compile(fixtureData.app, fixtureData.settings, null, null, null, { writeOutput: false, contentExtraction: { id: "p", name: "Preuves", triggerRoles: ["preuve"] } });
  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /Sans preuve/);
  assert.match(result.manuscript, /Avec preuve/);
  assert.match(result.manuscript, /> \[!preuve\]/);
});

test("compile avec extraction : deux sections gardent l'ordre source", async () => {
  const file = new TFile("Projet/Manuscrit/Deux.md", "### Première\n\n> [!questions]\n> A\n\n### Deuxième\n\n> [!questions]\n> B");
  const fixtureData = fixture([file]);
  const result = await compile(fixtureData.app, fixtureData.settings, null, null, null, { writeOutput: false, contentExtraction: { id: "q", name: "Questions", triggerRoles: ["questions"] } });
  assert.ok(result);
  assert.ok(result.manuscript.indexOf("Première") < result.manuscript.indexOf("Deuxième"));
  assert.equal(result.segments.length, 1);
});

test("compile avec extraction sans correspondance : sortie vide et sans segment", async () => {
  const file = new TFile("Projet/Manuscrit/Aucun.md", "Texte normal.");
  const fixtureData = fixture([file]);
  const result = await compile(fixtureData.app, fixtureData.settings, null, null, null, { writeOutput: false, contentExtraction: { id: "p", name: "Preuves", triggerRoles: ["preuve"] } });
  assert.ok(result);
  assert.equal(result.manuscript, "");
  assert.deepEqual(result.segments, []);
});

test("compile avec extraction : les marqueurs Document restent dans renderText", async () => {
  const source = "### Activité\n\n> [!questions]\n> Question.\n\nAprès.";
  const file = new TFile("Projet/Manuscrit/Layout.md", source);
  const fixtureData = fixture([file]);
  const anchor = createSourceAnchor(source, source.indexOf("Après."), source.indexOf("Après.") + "Après.".length);
  assert.ok(anchor);
  await addLayoutOverride(fixtureData.app, fixtureData.settings, { file: "Layout.md", kind: "page-break-before", anchor });
  const result = await compile(fixtureData.app, fixtureData.settings, null, null, null, { writeOutput: false, contentExtraction: { id: "q", name: "Questions", triggerRoles: ["questions"] } });
  assert.ok(result);
  assert.match(result.segments[0].renderText || "", /FEUILLETS_LAYOUT_PAGE_BREAK_BEFORE/);
});

test("compile sans extraction conserve le texte hors rôle", async () => {
  const file = new TFile("Projet/Manuscrit/Normal.md", "Avant.\n\n> [!questions]\n> Question.\n\nAprès.");
  const fixtureData = fixture([file]);
  const result = await compile(fixtureData.app, fixtureData.settings, null, null, null, { writeOutput: false });
  assert.ok(result);
  assert.equal(result.manuscript, "Avant.\n\n> [!questions]\n> Question.\n\nAprès.");
});
