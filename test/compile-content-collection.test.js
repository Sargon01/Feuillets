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
  manuscript.children = [...folders, ...files.filter((file) => !file.parent)];
  for (const folder of folders) folder.parent = manuscript;
  for (const file of files) if (!file.parent) file.parent = manuscript;
  const { vault } = createFakeVault([volume, manuscript, ...folders, ...files]);
  vault.cachedRead = vault.read;
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: Object.fromEntries([manuscript, ...folders].map((folder) => [folder.path, folder.children.map((child) => child.name)])),
    compileFileName: "Collection.md",
    insertFolderTitles: true,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    footnoteRenumberOnCompile: false,
  };
  return { app, settings, manuscript };
}

function collection(roles) {
  return { id: "c", name: "Collection", roles };
}

function options(contentCollection) {
  return { writeOutput: false, contentCollection };
}

test("sans collection, compile conserve le texte complet", async () => {
  const file = new TFile("Projet/Manuscrit/A.md", "Avant.\n\n> [!definition]\n> Définition.\n\nAprès.");
  const data = fixture([file]);
  const result = await compile(data.app, data.settings, null, null, null, { writeOutput: false });
  assert.ok(result);
  assert.equal(result.manuscript, "Avant.\n\n> [!definition]\n> Définition.\n\nAprès.");
});

test("compile une collection avec titres et rôles sélectionnés", async () => {
  const file = new TFile("Projet/Manuscrit/A.md", "# Chapitre\n\nTexte.\n\n## Partie\n\n> [!definition]\n> Définition.\n\n> [!preuve]\n> Preuve.\n\n> [!source]\n> Source.");
  const data = fixture([file]);
  const result = await compile(data.app, data.settings, null, null, null, options(collection(["definition", "source"])));
  assert.ok(result);
  assert.equal(result.manuscript, "# Chapitre\n\n## Partie\n\n> [!definition]\n> Définition.\n\n> [!source]\n> Source.");
  assert.equal(result.segments.length, 1);
});

test("plusieurs fichiers gardent l'ordre et un fichier sans résultat disparaît", async () => {
  const first = new TFile("Projet/Manuscrit/1.md", "> [!preuve]\n> Premier");
  const empty = new TFile("Projet/Manuscrit/2.md", "Texte sans rôle.");
  const third = new TFile("Projet/Manuscrit/3.md", "> [!preuve]\n> Troisième");
  const data = fixture([first, empty, third]);
  const result = await compile(data.app, data.settings, null, null, null, options(collection(["preuve"])));
  assert.ok(result);
  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments.map((segment) => segment.path), [first.path, third.path]);
  assert.ok(result.manuscript.indexOf("Premier") < result.manuscript.indexOf("Troisième"));
  assert.doesNotMatch(result.manuscript, /Texte sans rôle/);
});

test("un dossier sans descendant correspondant ne produit pas de titre vide", async () => {
  const folder = new TFolder("Projet/Manuscrit/Sans résultat");
  const file = new TFile("Projet/Manuscrit/Sans résultat/A.md", "Texte sans rôle.");
  folder.children = [file];
  file.parent = folder;
  const data = fixture([file], [folder]);
  const result = await compile(data.app, data.settings, null, null, null, options(collection(["preuve"])));
  assert.ok(result);
  assert.equal(result.manuscript, "");
  assert.deepEqual(result.segments, []);
});

test("contentExtraction et contentCollection sont incompatibles", async () => {
  const file = new TFile("Projet/Manuscrit/A.md", "> [!preuve]\n> Texte");
  const data = fixture([file]);
  await assert.rejects(
    compile(data.app, data.settings, null, null, null, {
      contentExtraction: { id: "e", name: "Extraction", triggerRoles: ["preuve"] },
      contentCollection: collection(["preuve"]),
      writeOutput: false,
    }),
    /contentExtraction et contentCollection/
  );
});

test("renderText suit la collection et conserve les marqueurs Document", async () => {
  const source = "Texte ordinaire.\n\n> [!preuve]\n> Preuve.";
  const file = new TFile("Projet/Manuscrit/A.md", source);
  const data = fixture([file]);
  const start = source.indexOf("> [!preuve]");
  const anchor = createSourceAnchor(source, start, start + "> [!preuve]\n> Preuve.".length);
  assert.ok(anchor);
  await addLayoutOverride(data.app, data.settings, { file: "A.md", kind: "page-break-before", anchor });
  const result = await compile(data.app, data.settings, null, null, null, options(collection(["preuve"])));
  assert.ok(result);
  assert.match(result.segments[0].renderText || "", /FEUILLETS_LAYOUT_PAGE_BREAK_BEFORE/);
  assert.doesNotMatch(result.segments[0].renderText || "", /Texte ordinaire/);
});
