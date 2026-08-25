import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  contentExtractionsFilePath,
  createContentExtraction,
  deleteContentExtraction,
  loadContentExtractions,
  updateContentExtraction,
  ContentExtractionsFileCorruptedError,
} from "../src/services/content-extractions.js";

const PATH = "Projet/_Feuillets/Ressources/Exports/content-extractions.json";

function fixture(extra = []) {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  volume.children = [root];
  root.parent = volume;
  root.children = [];
  const { vault } = createFakeVault([volume, root, ...extra]);
  return { app: { vault }, settings: { projectFolder: root.path }, vault };
}

test("content extractions: absent => store vide sans création", async () => {
  const { app, settings, vault } = fixture();
  assert.deepEqual(await loadContentExtractions(app, settings), { version: 1, extractions: [] });
  assert.equal(vault.getAbstractFileByPath(PATH), null);
  assert.equal(contentExtractionsFilePath(app, settings), PATH);
});

test("content extractions: CRUD, nom trimé et ordre canonique", async () => {
  const { app, settings } = fixture();
  const created = await createContentExtraction(app, settings, "  Activités  ", ["preuve", "questions"]);
  assert.equal(created.name, "Activités");
  assert.deepEqual(created.triggerRoles, ["questions", "preuve"]);
  const updated = await updateContentExtraction(app, settings, created.id, { name: "Sources", triggerRoles: ["source", "introduction"] });
  assert.equal(updated.id, created.id);
  assert.deepEqual(updated.triggerRoles, ["introduction", "source"]);
  assert.equal(await deleteContentExtraction(app, settings, created.id), true);
  assert.deepEqual((await loadContentExtractions(app, settings)).extractions, []);
});

test("content extractions: doublon de nom, rôle invalide et zéro rôle refusés", async () => {
  const { app, settings, vault } = fixture();
  await createContentExtraction(app, settings, "Activités", ["questions"]);
  await assert.rejects(() => createContentExtraction(app, settings, " activités ", ["preuve"]));
  await assert.rejects(() => createContentExtraction(app, settings, "Invalide", ["lesson"]));
  await assert.rejects(() => createContentExtraction(app, settings, "Vide", []));
  assert.ok(vault.getAbstractFileByPath(PATH) instanceof TFile);
});

test("content extractions: JSON corrompu contrôlé et non destructif", async () => {
  const folders = [new TFolder("Projet/_Feuillets"), new TFolder("Projet/_Feuillets/Ressources"), new TFolder("Projet/_Feuillets/Ressources/Exports")];
  const { app, settings, vault } = fixture(folders);
  await vault.create(PATH, "not json");
  await assert.rejects(() => loadContentExtractions(app, settings), ContentExtractionsFileCorruptedError);
  assert.equal(await vault.read(vault.getAbstractFileByPath(PATH)), "not json");
});

test("content extractions: fichier V1 invalide si un rôle est inconnu", async () => {
  const folders = [new TFolder("Projet/_Feuillets"), new TFolder("Projet/_Feuillets/Ressources"), new TFolder("Projet/_Feuillets/Ressources/Exports")];
  const { app, settings, vault } = fixture(folders);
  await vault.create(PATH, JSON.stringify({ version: 1, extractions: [{ id: "x", name: "X", triggerRoles: ["correction"] }] }));
  await assert.rejects(() => loadContentExtractions(app, settings), ContentExtractionsFileCorruptedError);
});
