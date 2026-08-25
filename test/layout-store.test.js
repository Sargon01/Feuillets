import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createSourceAnchor } from "../src/services/source-anchor.js";
import { addLayoutOverride, deleteLayoutOverride, emptyLayoutStore, layoutFilePath, loadLayoutStore, saveLayoutStore, LayoutFileCorruptedError } from "../src/services/layout-store.js";

function fixture() {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const scene = new TFile("Projet/Manuscrit/Chapitre.md", "Un texte de scène.");
  volume.children = [root]; root.parent = volume; root.children = [scene]; scene.parent = root;
  const { vault } = createFakeVault([volume, root, scene]);
  return { app: { vault }, settings: { projectFolder: root.path }, root };
}

test("layout store: resolves canonical path without creating files", async () => {
  const { app, settings } = fixture();
  assert.equal(layoutFilePath(app, settings), "Projet/_Feuillets/Ressources/Ressources internes/layout.json");
  assert.deepEqual(await loadLayoutStore(app, settings), emptyLayoutStore());
  assert.equal(app.vault.getAbstractFileByPath(layoutFilePath(app, settings)), null);
});

test("layout store: saves valid overrides and rejects corrupted JSON", async () => {
  const { app, settings } = fixture();
  const anchor = createSourceAnchor("Un texte de scène.", 3, 8);
  assert.ok(anchor);
  const created = await addLayoutOverride(app, settings, { file: "Chapitre.md", kind: "answer-lines", anchor, lines: 3 });
  assert.ok(created.id);
  assert.deepEqual((await loadLayoutStore(app, settings)).overrides, [created]);
  const file = app.vault.getAbstractFileByPath(layoutFilePath(app, settings));
  assert.ok(file instanceof TFile);
  await app.vault.modify(file, "{");
  await assert.rejects(loadLayoutStore(app, settings), LayoutFileCorruptedError);
});


test("layout store: delete absent does not write", async () => {
  const { app, settings } = fixture();
  assert.equal(await deleteLayoutOverride(app, settings, "missing"), false);
  assert.equal(app.vault.getAbstractFileByPath(layoutFilePath(app, settings)), null);
  await saveLayoutStore(app, settings, emptyLayoutStore());
  assert.equal(app.vault.getAbstractFileByPath(layoutFilePath(app, settings)), null);
});
