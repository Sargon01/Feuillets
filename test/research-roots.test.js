import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { chronologyFolderPath, entityMatchNames, entityMatchTags, findAppearances, getChronoFolder, getResearchRoot, migrateLegacyResearchEntries, maybeRenameResearchFile, researchFolderPath } from "../src/services/research.js";

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

test("migrate-research : déplace les entrées legacy vers la Recherche résolue", async () => {
  const project = new TFolder("Roman");
  const manuscript = new TFolder("Roman/Manuscrit");
  const characters = new TFolder("Roman/_Personnages");
  const places = new TFolder("Roman/_Lieux");
  const chronology = new TFolder("Roman/_Chronologie");
  const charactersBase = new TFile("Roman/Personnages.base", "{}");
  const placesBase = new TFile("Roman/Lieux.base", "{}");
  const auxiliary = new TFolder("Roman/_Feuillets");
  const research = new TFolder("Roman/_Feuillets/Recherche");
  manuscript.parent = project;
  for (const entry of [characters, places, chronology, charactersBase, placesBase, auxiliary]) entry.parent = project;
  research.parent = auxiliary;
  const { vault, fileManager } = createFakeVault([project, manuscript, characters, places, chronology, charactersBase, placesBase, auxiliary, research]);
  const app = { vault, fileManager };
  const settings = { projectFolder: manuscript.path };

  assert.equal(researchFolderPath(app, settings, manuscript), research.path);
  assert.deepEqual(await migrateLegacyResearchEntries(app, manuscript, research.path), { moved: 5, collisions: [] });
  for (const name of ["Personnages", "Lieux", "Chronologie", "Personnages.base", "Lieux.base"]) {
    assert.ok(vault.getAbstractFileByPath(`Roman/_Feuillets/Recherche/${name}`), name);
  }
  assert.equal(vault.getAbstractFileByPath("Roman/_Recherche"), null);
});

test("migrate-research : le chemin V2 est utilisé sans Recherche existante, aussi pour un dossier direct", async () => {
  const root = new TFolder("Articles");
  const characters = new TFolder("Articles/_Personnages");
  characters.parent = root;
  const { vault, fileManager } = createFakeVault([root, characters]);
  const settings = { projectFolder: root.path };
  const app = { vault, fileManager };

  const destination = researchFolderPath(app, settings, root);
  assert.equal(destination, "Articles/_Feuillets/Recherche");
  await vault.createFolder("Articles/_Feuillets");
  await vault.createFolder(destination);
  await migrateLegacyResearchEntries(app, root, destination);
  assert.equal(vault.getAbstractFileByPath("Articles/_Feuillets/Recherche/Personnages"), characters);
  assert.equal(vault.getAbstractFileByPath("Articles/_Recherche"), null);
});

test("migrate-research : réutilise le legacy, privilégie le canonical et préserve une collision", async (t) => {
  await t.test("legacy seul", async () => {
    const root = new TFolder("Projet");
    const legacy = new TFolder("Projet/_Recherche");
    const places = new TFolder("Projet/_Lieux");
    legacy.parent = root;
    places.parent = root;
    const { vault, fileManager } = createFakeVault([root, legacy, places]);
    const app = { vault, fileManager };
    const settings = { projectFolder: root.path };
    assert.equal(researchFolderPath(app, settings, root), legacy.path);
    await migrateLegacyResearchEntries(app, root, legacy.path);
    assert.equal(vault.getAbstractFileByPath("Projet/_Recherche/Lieux"), places);
    assert.equal(vault.getAbstractFileByPath("Projet/_Feuillets/Recherche"), null);
  });

  await t.test("canonical prioritaire et collision non écrasée", async () => {
    const root = new TFolder("Projet");
    const legacy = new TFolder("Projet/_Recherche");
    const auxiliary = new TFolder("Projet/_Feuillets");
    const canonical = new TFolder("Projet/_Feuillets/Recherche");
    const oldCharacters = new TFolder("Projet/_Personnages");
    const existingCharacters = new TFolder("Projet/_Feuillets/Recherche/Personnages");
    legacy.parent = root;
    auxiliary.parent = root;
    canonical.parent = auxiliary;
    oldCharacters.parent = root;
    existingCharacters.parent = canonical;
    const { vault, fileManager } = createFakeVault([root, legacy, auxiliary, canonical, oldCharacters, existingCharacters]);
    const app = { vault, fileManager };
    const settings = { projectFolder: root.path };
    assert.equal(researchFolderPath(app, settings, root), canonical.path);
    const result = await migrateLegacyResearchEntries(app, root, canonical.path);
    assert.deepEqual(result, { moved: 0, collisions: [{ from: "_Personnages", to: "Personnages" }] });
    assert.equal(vault.getAbstractFileByPath(oldCharacters.path), oldCharacters);
    assert.equal(vault.getAbstractFileByPath(existingCharacters.path), existingCharacters);
  });
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

test("split-chronology : résout une destination V2 sans utiliser chronoFolder pour créer un chemin legacy", () => {
  const project = new TFolder("Roman");
  const manuscript = new TFolder("Roman/Manuscrit");
  manuscript.parent = project;
  const { vault } = createFakeVault([project, manuscript]);
  const settings = {
    projectFolder: manuscript.path,
    chronoFolder: "Recherche/Chronologie",
    projectMeta: { [manuscript.path]: { type: "fiction" } },
  };

  assert.equal(chronologyFolderPath({ vault }, settings, manuscript), "Roman/_Feuillets/Recherche/Événements");
  assert.equal(vault.getAbstractFileByPath("Roman/Manuscrit/Recherche/Chronologie"), null);
  assert.equal(vault.getAbstractFileByPath("Roman/_Recherche"), null);
});

test("split-chronology : résout sous _Feuillets pour un dossier direct et réutilise les variantes existantes", () => {
  const direct = new TFolder("Articles");
  const { vault: directVault } = createFakeVault([direct]);
  const directSettings = { projectFolder: direct.path, projectMeta: { [direct.path]: { type: "free" } } };
  assert.equal(chronologyFolderPath({ vault: directVault }, directSettings, direct), "Articles/_Feuillets/Recherche/Chronologie");

  for (const name of ["Chronologie", "Timeline", "Events"]) {
    const project = new TFolder("Projet");
    const manuscript = new TFolder("Projet/Manuscrit");
    const auxiliary = new TFolder("Projet/_Feuillets");
    const research = new TFolder("Projet/_Feuillets/Recherche");
    const chronology = new TFolder(`Projet/_Feuillets/Recherche/${name}`);
    manuscript.parent = project;
    auxiliary.parent = project;
    research.parent = auxiliary;
    chronology.parent = research;
    const { vault } = createFakeVault([project, manuscript, auxiliary, research, chronology]);
    const settings = { projectFolder: manuscript.path, projectMeta: { [manuscript.path]: { type: "fiction" } } };
    assert.equal(chronologyFolderPath({ vault }, settings, manuscript), chronology.path, name);
  }
});

test("split-chronology : réutilise la Recherche legacy mais privilégie la canonical", () => {
  const root = new TFolder("Projet");
  const legacy = new TFolder("Projet/_Recherche");
  legacy.parent = root;
  const { vault } = createFakeVault([root, legacy]);
  const settings = { projectFolder: root.path, projectMeta: { [root.path]: { type: "free" } } };
  assert.equal(chronologyFolderPath({ vault }, settings, root), "Projet/_Recherche/Chronologie");

  const auxiliary = new TFolder("Projet/_Feuillets");
  const canonical = new TFolder("Projet/_Feuillets/Recherche");
  auxiliary.parent = root;
  canonical.parent = auxiliary;
  const { vault: canonicalVault } = createFakeVault([root, legacy, auxiliary, canonical]);
  assert.equal(chronologyFolderPath({ vault: canonicalVault }, settings, root), "Projet/_Feuillets/Recherche/Chronologie");
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

test("getResearchTemplate : lit le modèle personnalisé depuis Modèles, avec fallback legacy Templates", async () => {
  const { getResearchTemplate } = await import("../src/services/research-templates.js");

  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const auxiliary = new TFolder("Projet/_Feuillets");
  const resources = new TFolder("Projet/_Feuillets/Ressources");
  const modeles = new TFolder("Projet/_Feuillets/Ressources/Modèles");
  const customChar = new TFile("Projet/_Feuillets/Ressources/Modèles/Characters.md", "---\nrole: Héros\ncustom: true\n---\n");

  manuscript.parent = project;
  auxiliary.parent = project;
  resources.parent = auxiliary;
  modeles.parent = resources;
  customChar.parent = modeles;

  const { vault } = createFakeVault([project, manuscript, auxiliary, resources, modeles, customChar]);
  const app = { vault };
  const settings = { projectFolder: manuscript.path };

  const content = await getResearchTemplate(app, settings, { yamlPreset: "roman" }, "personnages", "Hero");
  assert.match(content, /custom: true/);
  assert.match(content, /role: Héros/);

  // Fallback legacy : Templates
  const legProject = new TFolder("LegProjet");
  const legManuscript = new TFolder("LegProjet/Manuscrit");
  const legAuxiliary = new TFolder("LegProjet/_Feuillets");
  const legResources = new TFolder("LegProjet/_Feuillets/Ressources");
  const legTemplates = new TFolder("LegProjet/_Feuillets/Ressources/Templates");
  const legCustomChar = new TFile("LegProjet/_Feuillets/Ressources/Templates/Characters.md", "---\nlegacy: true\n---\n");

  legManuscript.parent = legProject;
  legAuxiliary.parent = legProject;
  legResources.parent = legAuxiliary;
  legTemplates.parent = legResources;
  legCustomChar.parent = legTemplates;

  const { vault: legVault } = createFakeVault([legProject, legManuscript, legAuxiliary, legResources, legTemplates, legCustomChar]);
  const legApp = { vault: legVault };
  const legSettings = { projectFolder: legManuscript.path };

  const legContent = await getResearchTemplate(legApp, legSettings, { yamlPreset: "roman" }, "personnages", "Hero");
  assert.match(legContent, /legacy: true/);
});
