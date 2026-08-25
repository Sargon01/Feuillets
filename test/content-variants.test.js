import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  contentVariantsFilePath,
  createContentVariant,
  deleteContentVariant,
  loadContentVariants,
  saveContentVariants,
  selectContentVariant,
  selectedContentVariant,
  updateContentVariant,
  ContentVariantsFileCorruptedError,
} from "../src/services/content-variants.js";

const PATH = "Projet/_Feuillets/Ressources/Exports/content-variants.json";

function fixture(extra = []) {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  volume.children = [root];
  root.parent = volume;
  root.children = [];
  const { vault } = createFakeVault([volume, root, ...extra]);
  return { app: { vault }, settings: { projectFolder: root.path }, vault, root };
}

test("content variants: absent => magasin vide et aucune création", async () => {
  const { app, settings, vault } = fixture();
  assert.deepEqual(await loadContentVariants(app, settings), { version: 1, selectedVariantId: null, variants: [] });
  assert.equal(vault.getAbstractFileByPath(PATH), null);
});

test("content variants: chemin canonique et dossier historique Export", async () => {
  const { app, settings } = fixture();
  assert.equal(contentVariantsFilePath(app, settings), PATH);
  const resources = new TFolder("Projet/_Feuillets/Ressources");
  const legacy = new TFolder("Projet/_Feuillets/Ressources/Export");
  const legacyFixture = fixture([resources, legacy]);
  assert.equal(contentVariantsFilePath(legacyFixture.app, legacyFixture.settings), "Projet/_Feuillets/Ressources/Export/content-variants.json");
});

test("content variants: première sauvegarde crée le dossier et le JSON V1", async () => {
  const { app, settings, vault } = fixture();
  await saveContentVariants(app, settings, { version: 1, selectedVariantId: null, variants: [] });
  const file = vault.getAbstractFileByPath(PATH);
  assert.ok(file instanceof TFile);
  assert.equal(JSON.parse(await vault.read(file)).version, 1);
});

test("content variants: création, ordre canonique et doublons de nom", async () => {
  const { app, settings } = fixture();
  const created = await createContentVariant(app, settings, "  Révision  ", ["solution", "introduction"]);
  assert.equal(created.name, "Révision");
  assert.deepEqual(created.excludedRoles, ["introduction", "solution"]);
  assert.equal(created.questionAnswerSpace, "keep");
  await assert.rejects(() => createContentVariant(app, settings, "réVISION"));
});

test("content variants: update conserve l'id et delete désélectionne", async () => {
  const { app, settings } = fixture();
  const created = await createContentVariant(app, settings, "Version A");
  const updated = await updateContentVariant(app, settings, created.id, { name: "Version B", excludedRoles: ["solution"], questionAnswerSpace: "hide" });
  assert.equal(updated.id, created.id);
  assert.equal(updated.name, "Version B");
  assert.deepEqual(updated.excludedRoles, ["solution"]);
  await selectContentVariant(app, settings, created.id);
  assert.equal((await selectedContentVariant(app, settings))?.id, created.id);
  assert.equal(await deleteContentVariant(app, settings, created.id), true);
  assert.equal((await loadContentVariants(app, settings)).selectedVariantId, null);
  await assert.rejects(() => selectContentVariant(app, settings, "unknown"));
  await selectContentVariant(app, settings, null);
});

test("content variants: JSON corrompu, rôle obsolète et sélection inconnue sont contrôlés", async () => {
  const { app, settings, vault } = fixture();
  const folder = new TFolder("Projet/_Feuillets/Ressources/Exports");
  const base = fixture([new TFolder("Projet/_Feuillets"), new TFolder("Projet/_Feuillets/Ressources"), folder]);
  await base.vault.create(PATH, "not json");
  await assert.rejects(() => loadContentVariants(base.app, base.settings), ContentVariantsFileCorruptedError);
  const file = base.vault.getAbstractFileByPath(PATH);
  assert.equal(await base.vault.read(file), "not json");
  await vault.create(PATH, JSON.stringify({ version: 1, selectedVariantId: null, variants: [{ id: "x", name: "X", excludedRoles: ["correction"], questionAnswerSpace: "keep" }] }));
  await assert.rejects(() => loadContentVariants(app, settings), ContentVariantsFileCorruptedError);
  await assert.rejects(() => loadContentVariants(base.app, base.settings), ContentVariantsFileCorruptedError);
});

test("content variants: selectedVariantId inconnu rend le fichier invalide", async () => {
  const { app, settings, vault } = fixture();
  await vault.create(PATH, JSON.stringify({ version: 1, selectedVariantId: "missing", variants: [] }));
  await assert.rejects(() => loadContentVariants(app, settings), ContentVariantsFileCorruptedError);
});

test("content variants: rôle inconnu refusé sans sauvegarder", async () => {
  const { app, settings, vault } = fixture();
  await assert.rejects(() => createContentVariant(app, settings, "Invalide", ["lesson"]));
  assert.equal(vault.getAbstractFileByPath(PATH), null);
  const valid = await createContentVariant(app, settings, "Valide");
  const file = vault.getAbstractFileByPath(PATH);
  const before = await vault.read(file);
  await assert.rejects(() => updateContentVariant(app, settings, valid.id, { name: "Modifiée", excludedRoles: ["correction"], questionAnswerSpace: "keep" }));
  assert.equal(await vault.read(file), before);
});
