import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ensureTemplateFile, loadCustomTemplates } from "../src/services/export-templates-custom.js";

test("export templates custom : lit un modèle et crée un modèle manquant", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const resources = new TFolder("Projet/Resources");
  const layouts = new TFolder("Projet/Resources/Layouts");
  const custom = new TFile("Projet/Resources/Layouts/perso.md");
  manuscript.parent = project; resources.parent = project; layouts.parent = resources; custom.parent = layouts;
  project.children = [manuscript, resources]; resources.children = [layouts]; layouts.children = [custom];
  const { vault, fileManager } = createFakeVault([project, manuscript, resources, layouts, custom]);
  const app = { vault, fileManager, metadataCache: { getFileCache: (file) => ({ frontmatter: file === custom ? { label: "Mon modèle", fontSizePt: 11 } : {} }) } };
  const settings = { projectFolder: manuscript.path };

  const templates = await loadCustomTemplates(app, settings);
  const created = await ensureTemplateFile(app, settings, "classique");

  assert.equal(templates.perso.label, "Mon modèle");
  assert.equal(created?.path, "Projet/Resources/Layouts/classique.md");
});
