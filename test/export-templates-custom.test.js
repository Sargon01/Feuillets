import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ensureTemplateFile, loadCustomTemplates } from "../src/services/export-templates-custom.js";
import { EXPORT_TEMPLATES } from "../src/utils/export-templates.js";

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

test("export templates custom : un nouveau projet sans dossier existant crée dans Layout (nouveau nom)", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = project;
  project.children = [manuscript];
  const { vault, fileManager } = createFakeVault([project, manuscript]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: manuscript.path };

  const created = await ensureTemplateFile(app, settings, "classique");

  assert.equal(created?.path, "Projet/_Feuillets/Ressources/Layout/classique.md");
});

test("export templates custom : conserve les valeurs valides et ignore les valeurs de police invalides", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const resources = new TFolder("Projet/Resources");
  const layouts = new TFolder("Projet/Resources/Layouts");
  const valid = new TFile("Projet/Resources/Layouts/valide.md");
  const invalid = new TFile("Projet/Resources/Layouts/invalide.md");
  manuscript.parent = project; resources.parent = project; layouts.parent = resources;
  valid.parent = layouts; invalid.parent = layouts;
  project.children = [manuscript, resources]; resources.children = [layouts]; layouts.children = [valid, invalid];
  const frontmatter = new Map([
    [valid, { fontFamily: "Georgia, serif", fontSizePt: 11, lineHeight: 1.5 }],
    [invalid, { fontFamily: "  ", fontSizePt: 0, lineHeight: null }],
  ]);
  const { vault, fileManager } = createFakeVault([project, manuscript, resources, layouts, valid, invalid]);
  const app = { vault, fileManager, metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file) ?? {} }) } };
  const settings = { projectFolder: manuscript.path };

  const templates = await loadCustomTemplates(app, settings);

  assert.equal(templates.valide.fontFamily, "Georgia, serif");
  assert.equal(templates.valide.fontSizePt, 11);
  assert.equal(templates.valide.lineHeight, 1.5);
  assert.equal(templates.invalide.fontFamily, EXPORT_TEMPLATES.classique.fontFamily);
  assert.equal(templates.invalide.fontSizePt, EXPORT_TEMPLATES.classique.fontSizePt);
  assert.equal(templates.invalide.lineHeight, EXPORT_TEMPLATES.classique.lineHeight);
});
