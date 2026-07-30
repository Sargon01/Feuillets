import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ImportOutlineModal } from "../src/ui/import-outline-modal.js";

function importFixture() {
  const project = new TFolder("Projet");
  project.children = [];
  const { vault, files } = createFakeVault([project]);
  const orders = new Map();
  let renderCalls = 0;
  const app = { vault };
  const plugin = {
    settings: { wordGoal: 750 },
    getProjectFolder: () => project,
    ensureFolder: (path) => vault.createFolder(path),
    writeOrder: async (parent, children) => orders.set(parent.path, children.map((child) => child.name)),
    renderAllViews: () => { renderCalls++; },
  };
  const modal = Object.create(ImportOutlineModal.prototype);
  modal.app = app;
  modal.plugin = plugin;
  return { modal, vault, files, orders, renderCalls: () => renderCalls };
}

test("import outline : crée dossiers, scènes et ordre à partir des titres Markdown", async () => {
  const { modal, vault, orders } = importFixture();

  await modal.importOutline("# Partie 1\n- Scène A\n- Scène B\n## Chapitre 1\nScène C");

  const sceneA = vault.getAbstractFileByPath("Projet/Partie 1/scene-001.md");
  const sceneB = vault.getAbstractFileByPath("Projet/Partie 1/scene-002.md");
  const sceneC = vault.getAbstractFileByPath("Projet/Partie 1/Chapitre 1/scene-003.md");
  assert.ok(sceneA instanceof TFile);
  assert.ok(sceneB instanceof TFile);
  assert.ok(sceneC instanceof TFile);
  assert.match(await vault.read(sceneA), /title: Scène A/);
  assert.match(await vault.read(sceneA), /goal: 750/);
  assert.deepEqual(orders.get("Projet"), ["Partie 1"]);
  assert.deepEqual(orders.get("Projet/Partie 1"), ["scene-001.md", "scene-002.md", "Chapitre 1"]);
  assert.deepEqual(orders.get("Projet/Partie 1/Chapitre 1"), ["scene-003.md"]);
});

test("import outline : ne remplace pas une scène existante", async () => {
  const { modal, vault, files } = importFixture();
  const existing = await vault.create("Projet/scene-001.md", "Contenu existant");

  await modal.importOutline("Nouvelle scène");

  assert.equal(vault.getAbstractFileByPath("Projet/scene-001.md"), existing);
  assert.equal(await vault.read(existing), "Contenu existant");
  assert.equal(files.size, 2);
});

test("import outline : une entrée vide ne crée aucun élément", async () => {
  const { modal, files, orders, renderCalls } = importFixture();

  await modal.importOutline("");

  assert.equal(files.size, 1);
  assert.equal(orders.size, 0);
  assert.equal(renderCalls(), 1);
});
