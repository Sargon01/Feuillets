import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createProjectBackup, getBackupsRoot } from "../src/services/project-backup.js";

test("project backup : archive le projet et applique la rotation", async () => {
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
});
