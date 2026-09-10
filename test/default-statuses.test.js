import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { setLocale } from "../src/i18n/index.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  reconcileAllDefaultStatusNames,
  migrateStatusFrontmatterValues,
} from "../src/utils/default-statuses.js";

test("reconcileAllDefaultStatusNames : renomme les statuts par défaut et rapporte les renommages appliqués", () => {
  setLocale("en");
  test.after(() => setLocale("fr"));

  const settings = {
    statuses: [
      { name: "Brouillon", color: "#e08f4f" },
      { name: "Ma Custom", color: "#123456" },
    ],
    projectMeta: {
      "Projet/Manuscrit": {
        statuses: [{ name: "Brouillon", color: "#e08f4f" }],
      },
    },
  };

  const renames = reconcileAllDefaultStatusNames(settings);

  assert.equal(settings.statuses[0].name, "Draft");
  assert.equal(settings.statuses[1].name, "Ma Custom");
  assert.equal(settings.projectMeta["Projet/Manuscrit"].statuses[0].name, "Draft");
  assert.deepEqual(renames, [{ from: "Brouillon", to: "Draft" }]);
});

test("migrateStatusFrontmatterValues : réécrit le statut des fiches encore sur l'ancien nom, sans toucher aux autres", async () => {
  const manuscript = new TFolder("Projet/Manuscrit");
  const draftNote = new TFile("Projet/Manuscrit/Scène 1.md", "---\nstatut: Brouillon\n---\n");
  const customNote = new TFile("Projet/Manuscrit/Scène 2.md", "---\nstatut: Ma Custom\n---\n");
  const noStatusNote = new TFile("Projet/Manuscrit/Scène 3.md", "---\ntitle: Sans statut\n---\n");
  manuscript.children = [draftNote, customNote, noStatusNote];
  draftNote.parent = manuscript;
  customNote.parent = manuscript;
  noStatusNote.parent = manuscript;

  const { vault, fileManager } = createFakeVault([manuscript, draftNote, customNote, noStatusNote]);
  const frontmatterByPath = new Map([
    [draftNote.path, { statut: "Brouillon" }],
    [customNote.path, { statut: "Ma Custom" }],
    [noStatusNote.path, { title: "Sans statut" }],
  ]);
  vault.getMarkdownFiles = () => [draftNote, customNote, noStatusNote];
  fileManager.processFrontMatter = async (file, callback) => callback(frontmatterByPath.get(file.path));

  const app = {
    vault,
    fileManager,
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: frontmatterByPath.get(file.path) || {} };
      },
    },
  };
  const settings = { projectFolder: "" };

  await migrateStatusFrontmatterValues(app, settings, [{ from: "Brouillon", to: "Draft" }]);

  assert.equal(frontmatterByPath.get(draftNote.path).statut, "Draft");
  assert.equal(frontmatterByPath.get(customNote.path).statut, "Ma Custom");
  assert.equal(frontmatterByPath.get(noStatusNote.path).statut, undefined);
});

test("migrateStatusFrontmatterValues : ne fait rien si aucun renommage n'a eu lieu", async () => {
  const note = new TFile("Scène.md", "---\nstatut: Brouillon\n---\n");
  const { vault, fileManager } = createFakeVault([note]);
  let processed = false;
  vault.getMarkdownFiles = () => [note];
  fileManager.processFrontMatter = async () => { processed = true; };
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: { statut: "Brouillon" } }) } };

  await migrateStatusFrontmatterValues(app, {}, []);

  assert.equal(processed, false);
});
