import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { duplicateProjectFolder, listSnapshotFiles, snapshotFile } from "../src/services/project-files.js";

function projectFixture() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const scene = new TFile("Projet/Manuscrit/Chapitre 1/Scène.md", "Texte original");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [scene];
  scene.parent = chapter;
  return { volume, manuscript, chapter, scene };
}

test("snapshotFile : crée et retrouve un instantané du feuillet", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript, chapter, scene]);
  const app = { vault };

  const stamp = await snapshotFile(app, scene, manuscript);

  assert.match(stamp, /^\d{4}-\d{2}-\d{2} \d{2}h\d{2}\d{2}$/);
  const snapshots = listSnapshotFiles(app, scene, manuscript);
  assert.equal(snapshots.length, 1);
  assert.equal(await vault.read(snapshots[0]), "Texte original");
});

test("duplicateProjectFolder : copie le manuscrit et son ordre", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript, chapter, scene]);
  const app = { vault };
  const settings = {
    orders: { [manuscript.path]: [chapter.name] },
    folderPositions: { [chapter.path]: 2 },
  };

  const path = await duplicateProjectFolder(app, manuscript, "Premier jet", settings);

  assert.equal(path, "Projet/_Versions/Manuscrit (Premier jet)");
  assert.equal(await vault.read(vault.getAbstractFileByPath(`${path}/Chapitre 1/Scène.md`)), "Texte original");
  assert.deepEqual(settings.orders[path], [chapter.name]);
  assert.equal(settings.folderPositions[`${path}/Chapitre 1`], 2);
});
