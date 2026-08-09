import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import JSZip from "jszip";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createProjectBackup, getBackupsRoot } from "../src/services/project-backup.js";

async function archiveEntries(vault, path) {
  const backup = vault.getAbstractFileByPath(path);
  const zip = await JSZip.loadAsync(backup.content);
  return Object.keys(zip.files);
}

test("project backup : un projet classique sauvegarde son parent et applique la rotation", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const backups = new TFolder("Projet/_Backups");
  const scene = new TFile("Projet/Manuscrit/Scène.md", "Texte du manuscrit");
  const oldBackup = new TFile("Projet/_Backups/ancien.zip", "ancienne archive");
  project.children = [manuscript, backups];
  manuscript.parent = project;
  backups.parent = project;
  manuscript.children = [scene];
  scene.parent = manuscript;
  oldBackup.parent = backups;
  oldBackup.stat = { mtime: 1 };
  backups.children = [oldBackup];
  const { vault, fileManager } = createFakeVault([project, manuscript, backups, scene, oldBackup]);
  const app = { vault, fileManager };

  const path = await createProjectBackup(app, manuscript, { backupKeepCount: 1 });

  assert.equal(getBackupsRoot(app, manuscript), backups);
  assert.ok(path.startsWith("Projet/_Backups/Projet "));
  assert.ok(vault.getAbstractFileByPath(path));
  assert.equal(vault.getAbstractFileByPath(oldBackup.path), null);
  assert.deepEqual(await archiveEntries(vault, path), ["Projet/", "Projet/Manuscrit/", "Projet/Manuscrit/Scène.md"]);
});

test("project backup : un dossier imbriqué utilisé tel quel ne sauvegarde pas son parent", async () => {
  const documents = new TFolder("Documents");
  const article = new TFolder("Documents/Article");
  const otherFolder = new TFolder("Documents/AutreDossier");
  const articleFile = new TFile("Documents/Article/Texte.md", "Article");
  const privateFile = new TFile("Documents/AutreDossier/Privé.md", "Privé");
  documents.children = [article, otherFolder];
  article.parent = documents;
  otherFolder.parent = documents;
  article.children = [articleFile];
  otherFolder.children = [privateFile];
  articleFile.parent = article;
  privateFile.parent = otherFolder;
  const { vault, fileManager } = createFakeVault([documents, article, otherFolder, articleFile, privateFile]);
  const app = { vault, fileManager };

  const path = await createProjectBackup(app, article, {});

  assert.equal(getBackupsRoot(app, article)?.path, "Documents/Article/_Feuillets/Backups");
  assert.ok(path.startsWith("Documents/Article/_Feuillets/Backups/Article "));
  const entries = await archiveEntries(vault, path);
  assert.ok(entries.includes("Documents/Article/Texte.md"));
  assert.ok(!entries.some((entry) => entry.startsWith("Documents/AutreDossier/")));
  assert.ok(!entries.some((entry) => entry.startsWith("Documents/Article/_Feuillets/Backups/")));
});

test("project backup : un dossier de premier niveau utilisé tel quel ne sauvegarde pas le coffre", async () => {
  const article = new TFolder("Article");
  const unrelated = new TFolder("AutreDossier");
  const articleFile = new TFile("Article/Texte.md", "Article");
  const unrelatedFile = new TFile("AutreDossier/Privé.md", "Privé");
  article.children = [articleFile];
  unrelated.children = [unrelatedFile];
  articleFile.parent = article;
  unrelatedFile.parent = unrelated;
  const { vault, fileManager } = createFakeVault([article, unrelated, articleFile, unrelatedFile]);
  const app = { vault, fileManager };

  const path = await createProjectBackup(app, article, {});

  assert.equal(getBackupsRoot(app, article)?.path, "Article/_Feuillets/Backups");
  assert.ok(path.startsWith("Article/_Feuillets/Backups/Article "));
  assert.deepEqual(await archiveEntries(vault, path), ["Article/", "Article/Texte.md"]);
});
