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
