import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  contentCollectionsFilePath,
  createContentCollection,
  deleteContentCollection,
  loadContentCollections,
  updateContentCollection,
  ContentCollectionsFileCorruptedError,
} from "../src/services/content-collections.js";

const PATH = "Projet/_Feuillets/Ressources/Exports/content-collections.json";

function fixture(extra = []) {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  volume.children = [root];
  root.parent = volume;
  root.children = [];
  const { vault } = createFakeVault([volume, root, ...extra]);
  return { app: { vault }, settings: { projectFolder: root.path }, vault };
}

test("content collections: absent => store vide sans création", async () => {
  const { app, settings, vault } = fixture();
  assert.deepEqual(await loadContentCollections(app, settings), { version: 1, collections: [] });
  assert.equal(vault.getAbstractFileByPath(PATH), null);
  assert.equal(contentCollectionsFilePath(app, settings), PATH);
});

test("content collections: CRUD, nom trimé et ordre canonique", async () => {
  const { app, settings } = fixture();
  const created = await createContentCollection(app, settings, "  Dossier  ", ["source", "preuve", "citation"]);
  assert.equal(created.name, "Dossier");
  assert.deepEqual(created.roles, ["preuve", "source", "citation"]);
  const updated = await updateContentCollection(app, settings, created.id, { name: "Glossaire", roles: ["definition"] });
  assert.equal(updated.id, created.id);
  assert.deepEqual(updated.roles, ["definition"]);
  assert.equal(await deleteContentCollection(app, settings, created.id), true);
  assert.deepEqual((await loadContentCollections(app, settings)).collections, []);
});

test("content collections: doublon, zéro rôle et rôle invalide refusés", async () => {
  const { app, settings, vault } = fixture();
  await createContentCollection(app, settings, "Dossier", ["preuve"]);
  await assert.rejects(() => createContentCollection(app, settings, " dossier ", ["source"]));
  await assert.rejects(() => createContentCollection(app, settings, "Invalide", ["lesson"]));
  await assert.rejects(() => createContentCollection(app, settings, "Vide", []));
  assert.ok(vault.getAbstractFileByPath(PATH) instanceof TFile);
});

test("content collections: JSON corrompu contrôlé et non destructif", async () => {
  const folders = [new TFolder("Projet/_Feuillets"), new TFolder("Projet/_Feuillets/Ressources"), new TFolder("Projet/_Feuillets/Ressources/Exports")];
  const { app, settings, vault } = fixture(folders);
  await vault.create(PATH, "not json");
  await assert.rejects(() => loadContentCollections(app, settings), ContentCollectionsFileCorruptedError);
  assert.equal(await vault.read(vault.getAbstractFileByPath(PATH)), "not json");
});

test("content collections: fichier V1 invalide si un rôle est inconnu", async () => {
  const folders = [new TFolder("Projet/_Feuillets"), new TFolder("Projet/_Feuillets/Ressources"), new TFolder("Projet/_Feuillets/Ressources/Exports")];
  const { app, settings, vault } = fixture(folders);
  await vault.create(PATH, JSON.stringify({ version: 1, collections: [{ id: "x", name: "X", roles: ["correction"] }] }));
  await assert.rejects(() => loadContentCollections(app, settings), ContentCollectionsFileCorruptedError);
});
