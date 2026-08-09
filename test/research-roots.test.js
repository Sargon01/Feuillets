import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { entityMatchNames, entityMatchTags, findAppearances, getChronoFolder, getResearchRoot, maybeRenameResearchFile, researchFolderPath } from "../src/services/research.js";

test("research roots : reconnaît une recherche sœur du manuscrit", () => {
  const manuscript = new TFolder("Projet/Manuscrit");
  const project = new TFolder("Projet");
  const research = new TFolder("Projet/Research");
  const chronology = new TFolder("Projet/Research/Chronology");
  manuscript.parent = project;
  chronology.parent = research;
  const files = new Map([[manuscript.path, manuscript], [research.path, research], [chronology.path, chronology]]);
  const app = { vault: { getAbstractFileByPath: (path) => files.get(path) || null } };
  const settings = { projectFolder: manuscript.path };
  assert.equal(getChronoFolder(app, settings), chronology);
  assert.equal(getResearchRoot(app, settings), research);
  assert.equal(researchFolderPath(app, settings, manuscript), research.path);
});

test("research roots : reconnaît _Research et _Recherche à côté du Manuscrit", () => {
  for (const name of ["_Research", "_Recherche"]) {
    const project = new TFolder("Projet");
    const manuscript = new TFolder("Projet/Manuscrit");
    const research = new TFolder(`Projet/${name}`);
    manuscript.parent = project;
    research.parent = project;
    const { vault } = createFakeVault([project, manuscript, research]);
    assert.equal(getResearchRoot({ vault }, { projectFolder: manuscript.path }), research, name);
  }
});

test("research roots : reconnaît Recherche et Research sans underscore seulement à côté du Manuscrit", () => {
  for (const name of ["Recherche", "Research"]) {
    const project = new TFolder("Projet");
    const manuscript = new TFolder("Projet/Manuscrit");
    const research = new TFolder(`Projet/${name}`);
    manuscript.parent = project;
    research.parent = project;
    const { vault } = createFakeVault([project, manuscript, research]);
    assert.equal(getResearchRoot({ vault }, { projectFolder: manuscript.path }), research, name);
  }
});

test("research chronology : reconnaît les rubriques Événements, Events et les variantes historiques", () => {
  for (const name of ["Événements", "Events", "Chronologie", "Timeline", "Chronology"]) {
    const project = new TFolder("Projet");
    const manuscript = new TFolder("Projet/Manuscrit");
    const research = new TFolder("Projet/_Research");
    const chronology = new TFolder(`Projet/_Research/${name}`);
    manuscript.parent = project;
    research.parent = project;
    chronology.parent = research;
    const { vault } = createFakeVault([project, manuscript, research, chronology]);
    assert.equal(getChronoFolder({ vault }, { projectFolder: manuscript.path }), chronology, name);
  }
});

test("research : normalise les identifiants d'une entité", () => {
  const file = new TFile("Projet/Research/Personnages/Élodie.md");
  const app = {
    metadataCache: { getFileCache: () => ({ frontmatter: { title: "Élodie de Valmont", tags: ["#personnage", "#Héroïne"] } }) },
  };
  assert.deepEqual(entityMatchTags(app, file), ["heroine"]);
  assert.deepEqual(entityMatchNames(app, file), ["élodie de valmont", "élodie", "valmont"]);
});

test("research : renomme une fiche provisoire depuis son titre", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Research");
  const characters = new TFolder("Projet/Research/Personnages");
  const file = new TFile("Projet/Research/Personnages/Nouveau personnage.md");
  manuscript.parent = project;
  research.parent = project;
  characters.parent = research;
  file.parent = characters;
  const { vault, fileManager } = createFakeVault([project, manuscript, research, characters, file]);
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: () => ({ frontmatter: { title: "Élodie de Valmont" } }) },
  };

  await maybeRenameResearchFile(app, { projectFolder: manuscript.path }, file);

  assert.equal(file.path, "Projet/Research/Personnages/Élodie de Valmont.md");
  assert.equal(vault.getAbstractFileByPath(file.path), file);
});

test("research : retrouve une apparition via un wikilien", async () => {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Research");
  const characters = new TFolder("Projet/Research/Personnages");
  const scene = new TFile("Projet/Manuscrit/Scène 1.md", "Avant [[Élodie de Valmont]] après.");
  const entity = new TFile("Projet/Research/Personnages/Élodie de Valmont.md");
  manuscript.parent = project;
  research.parent = project;
  characters.parent = research;
  scene.parent = manuscript;
  entity.parent = characters;
  manuscript.children = [scene];
  const { vault } = createFakeVault([project, manuscript, research, characters, scene, entity]);
  const app = {
    vault: { ...vault, cachedRead: async (file) => file.content },
    metadataCache: {
      getFileCache: () => ({ frontmatter: {} }),
      getFirstLinkpathDest: () => entity,
      resolvedLinks: { [scene.path]: { [entity.path]: 1 } },
    },
  };
  const settings = { projectFolder: manuscript.path, orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };

  const appearances = await findAppearances(app, settings, entity);

  assert.equal(appearances.length, 1);
  assert.equal(appearances[0].file, scene);
  assert.equal(appearances[0].via, "lien");
  assert.match(appearances[0].excerpt, /\[\[Élodie de Valmont\]\]/);
});

function appearanceHarness(entityName, sceneContent, { entityTags = [], sceneFrontmatter = {} } = {}) {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/_Research");
  const characters = new TFolder("Projet/_Research/Characters");
  const scene = new TFile("Projet/Manuscrit/Scène.md", sceneContent);
  const entity = new TFile(`Projet/_Research/Characters/${entityName}.md`);
  manuscript.parent = project;
  research.parent = project;
  characters.parent = research;
  scene.parent = manuscript;
  entity.parent = characters;
  project.children = [manuscript, research];
  manuscript.children = [scene];
  research.children = [characters];
  characters.children = [entity];
  const { vault } = createFakeVault([project, manuscript, research, characters, scene, entity]);
  const app = {
    vault: { ...vault, cachedRead: async (file) => file.content },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: file === entity ? { title: entityName, tags: entityTags } : sceneFrontmatter }),
      getFirstLinkpathDest: () => null,
      resolvedLinks: {},
    },
  };
  return { app, entity, settings: { projectFolder: manuscript.path, orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" } };
}

test("research appearances : le frontmatter LF, CRLF et BOM ne compte pas comme une apparition", async () => {
  for (const content of [
    "---\ntitle: Élodie\n---\nPersonne ici.",
    "---\r\ntitle: Élodie\r\n---\r\nPersonne ici.",
    "\uFEFF---\ntitle: Élodie\n---\nPersonne ici.",
  ]) {
    const { app, entity, settings } = appearanceHarness("Élodie", content);
    assert.deepEqual(await findAppearances(app, settings, entity), []);
  }
});

test("research appearances : reconnaît les noms accentués dans le corps", async () => {
  for (const name of ["Élodie", "François"]) {
    const { app, entity, settings } = appearanceHarness(name, `${name} arrive.`);
    const appearances = await findAppearances(app, settings, entity);
    assert.equal(appearances.length, 1, name);
    assert.equal(appearances[0].via, "nom", name);
  }
});

test("research appearances : reconnaît un nom après un frontmatter vide", async () => {
  const { app, entity, settings } = appearanceHarness("Élodie", "---\n---\nÉlodie arrive.");
  const appearances = await findAppearances(app, settings, entity);
  assert.equal(appearances.length, 1);
  assert.equal(appearances[0].via, "nom");
});

test("research appearances : ne confond pas Anna et Annabelle", async () => {
  const { app, entity, settings } = appearanceHarness("Anna", "Annabelle arrive.");
  assert.deepEqual(await findAppearances(app, settings, entity), []);
});

test("research appearances : conserve la détection par tag", async () => {
  const { app, entity, settings } = appearanceHarness("Absente", "Sans nom.", {
    entityTags: ["#Héroïne"],
    sceneFrontmatter: { tags: ["#Héroïne"] },
  });
  const appearances = await findAppearances(app, settings, entity);
  assert.equal(appearances.length, 1);
  assert.equal(appearances[0].via, "tag");
});
