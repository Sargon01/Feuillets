import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { getResearchTemplate } from "../src/services/research-templates.js";

/*
 * getResearchTemplate() must replace an OLD generic French title with the
 * caller's `defaultName` — but only for a known, exact historical title
 * (see LEGACY_GENERIC_TEMPLATE_TITLES in research-templates.ts). Before this
 * fix, only "Nouvel .../Nouvelle ..." matched — never "Nouveau ...", so a
 * user template still carrying a bare "Nouveau lieu"/"Nouveau terme"/
 * "Nouveau concept" title silently kept its stale French default forever,
 * even under an English project.
 */

/** Builds a minimal project whose Templates folder holds exactly one
 * user-customized template file, at the exact candidate basename
 * getResearchTemplate() looks for. */
function makeFixture(templateBasename, existingTitle) {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const auxiliary = new TFolder("Projet/_Feuillets");
  const resources = new TFolder("Projet/_Feuillets/Ressources");
  const modeles = new TFolder("Projet/_Feuillets/Ressources/Modèles");
  const template = new TFile(
    `Projet/_Feuillets/Ressources/Modèles/${templateBasename}`,
    `---\ntitle: "${existingTitle}"\ncustom: true\n---\nCorps personnalisé.\n`
  );
  manuscript.parent = project;
  auxiliary.parent = project;
  resources.parent = auxiliary;
  modeles.parent = resources;
  template.parent = modeles;

  const { vault } = createFakeVault([project, manuscript, auxiliary, resources, modeles, template]);
  const app = { vault };
  const settings = { projectFolder: manuscript.path };
  return { app, settings };
}

const cases = [
  ["lieux", "Places.md", "Nouveau lieu", "New place"],
  ["glossaire", "Glossary.md", "Nouveau terme", "New term"],
  ["codex", "Lore.md", "Nouveau concept", "New concept"],
  ["evenements", "Events.md", "Nouvel événement", "New event"],
  ["sources", "Sources.md", "Nouvelle source", "New source"],
  ["bibliographie", "Bibliography.md", "Nouvelle référence", "New reference"],
  ["codex", "Lore.md", "Nouvelle entrée", "New entry"],
];

for (const [sectionKey, templateBasename, legacyTitle, defaultName] of cases) {
  test(`getResearchTemplate : remplace l'ancien titre générique "${legacyTitle}" par le defaultName fourni`, async () => {
    const { app, settings } = makeFixture(templateBasename, legacyTitle);
    const content = await getResearchTemplate(app, settings, sectionKey, defaultName);
    assert.match(content, new RegExp(`title:\\s*"${defaultName}"`));
    assert.doesNotMatch(content, new RegExp(legacyTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // The rest of the customized template is untouched.
    assert.match(content, /custom: true/);
    assert.match(content, /Corps personnalisé\./);
  });
}

test("getResearchTemplate : un titre utilisateur réel comme \"Nouveau Monde\" reste strictement inchangé", async () => {
  const { app, settings } = makeFixture("Places.md", "Nouveau Monde");
  const content = await getResearchTemplate(app, settings, "lieux", "New place");
  assert.match(content, /title:\s*"Nouveau Monde"/);
  assert.doesNotMatch(content, /New place/);
});

test("getResearchTemplate : un autre titre personnalisé arbitraire reste lui aussi inchangé", async () => {
  const { app, settings } = makeFixture("Glossary.md", "Lexique des termes obscurs");
  const content = await getResearchTemplate(app, settings, "glossaire", "New term");
  assert.match(content, /title:\s*"Lexique des termes obscurs"/);
  assert.doesNotMatch(content, /New term/);
});
