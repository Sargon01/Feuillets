import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  getProjectFolder,
  getManuscriptRoot,
  getProjectRoot,
  isStructuredManuscriptRoot,
  feuilletsAuxiliaryRootPath,
  getOrderedChildren,
  hasKnownProject,
  getEditionRoot,
  editionFolderPath,
  EDITION_FOLDER_NAME,
  RESEARCH_FOLDER_NAME,
  RESOURCES_FOLDER_NAME,
} from "../src/services/folder-structure.js";

function newProjectFixture() {
  const volume = new TFolder("Roman1");
  const manuscrit = new TFolder("Roman1/Manuscrit");
  const chapter = new TFolder("Roman1/Manuscrit/Chapitre 1");
  const scene = new TFile("Roman1/Manuscrit/Chapitre 1/Scène 1.md");
  const recherche = new TFolder("Roman1/Recherche");
  const ressources = new TFolder("Roman1/Ressources");
  volume.children = [manuscrit, recherche, ressources];
  manuscrit.parent = volume;
  manuscrit.children = [chapter];
  chapter.parent = manuscrit;
  chapter.children = [scene];
  scene.parent = chapter;
  recherche.parent = volume;
  ressources.parent = volume;
  return { volume, manuscrit, chapter, scene, recherche, ressources };
}

test("getManuscriptRoot est un alias de getProjectFolder (racine éditoriale)", () => {
  const { volume, manuscrit } = newProjectFixture();
  const { vault } = createFakeVault([volume, manuscrit]);
  const app = { vault };
  const settings = { projectFolder: "Roman1/Manuscrit" };

  assert.equal(getManuscriptRoot(app, settings), getProjectFolder(app, settings));
  assert.equal(getManuscriptRoot(app, settings).path, "Roman1/Manuscrit");
});

test("getProjectRoot remonte à la racine réelle, distincte de Manuscrit", () => {
  const { volume, manuscrit } = newProjectFixture();
  const { vault } = createFakeVault([volume, manuscrit]);
  const app = { vault };
  const settings = { projectFolder: "Roman1/Manuscrit" };

  const root = getProjectRoot(app, settings);
  assert.equal(root.path, "Roman1");
  assert.notEqual(root.path, getManuscriptRoot(app, settings).path);
});

test("getProjectRoot : ancien projet sans dossier de volume distinct ne casse pas", () => {
  // Convention historique : Manuscrit peut être directement à la racine du
  // coffre, sans dossier de volume séparé — getProjectRoot ne doit ni lever
  // ni inventer un chemin qui n'existe pas.
  const manuscrit = new TFolder("Manuscrit");
  const { vault } = createFakeVault([manuscrit]);
  const app = { vault };
  const settings = { projectFolder: "Manuscrit" };

  assert.doesNotThrow(() => getProjectRoot(app, settings));
  const root = getProjectRoot(app, settings);
  assert.ok(root);
});

test("Binder/Cartes/Plan : getOrderedChildren(Manuscrit) ne montre jamais Recherche ni Ressources", () => {
  const { volume, manuscrit, chapter, recherche, ressources } = newProjectFixture();
  const { vault } = createFakeVault([volume, manuscrit, chapter, recherche, ressources]);
  const app = { vault };
  const settings = { projectFolder: "Roman1/Manuscrit", orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };

  // Depuis Manuscrit (racine éditoriale) : seul Chapitre 1 apparaît.
  const children = getOrderedChildren(app, settings, manuscrit);
  assert.deepEqual(children.map((c) => c.path), ["Roman1/Manuscrit/Chapitre 1"]);

  // Depuis la racine réelle (volume) : Recherche/Ressources y sont bien
  // frères de Manuscrit, mais ça n'est JAMAIS la racine que le Binder, les
  // Cartes ou le Plan utilisent pour construire leur arbre (ils appellent
  // tous getProjectFolder()/getManuscriptRoot(), jamais getProjectRoot()).
  const volumeChildren = getOrderedChildren(app, settings, volume);
  const volumeChildNames = volumeChildren.map((c) => c.name).sort();
  assert.deepEqual(volumeChildNames, ["Manuscrit", RESEARCH_FOLDER_NAME, RESOURCES_FOLDER_NAME].sort());
});

test("hasKnownProject : un ancien projet (Manuscrit à la racine du coffre) est bien reconnu", () => {
  assert.equal(hasKnownProject({ projectFolder: "Manuscrit", projects: [] }), true);
});

test("getEditionRoot : un projet sans dossier Edition renvoie null sans lever — compatible avec les anciens projets", () => {
  const { volume, manuscrit } = newProjectFixture();
  const { vault } = createFakeVault([volume, manuscrit]);
  const app = { vault };

  assert.equal(getEditionRoot(app, manuscrit), null);
  assert.equal(editionFolderPath(app, manuscrit), "Roman1/_Feuillets/Edition");
});

test("getEditionRoot : reconnaît le dossier Edition une fois créé, voisin de Manuscrit", () => {
  const { volume, manuscrit } = newProjectFixture();
  const edition = new TFolder(`Roman1/${EDITION_FOLDER_NAME}`);
  edition.parent = volume;
  volume.children.push(edition);
  const { vault } = createFakeVault([volume, manuscrit, edition]);
  const app = { vault };

  const found = getEditionRoot(app, manuscrit);
  assert.ok(found);
  assert.equal(found.path, `Roman1/${EDITION_FOLDER_NAME}`);
});

test("Binder/compilation : getOrderedChildren(Manuscrit) exclut le dossier Edition comme Recherche/Ressources", () => {
  const { volume, manuscrit, chapter } = newProjectFixture();
  const edition = new TFolder(`Roman1/${EDITION_FOLDER_NAME}`);
  const synopsis = new TFile(`Roman1/${EDITION_FOLDER_NAME}/Synopsis.md`);
  edition.parent = volume;
  edition.children = [synopsis];
  synopsis.parent = edition;
  volume.children.push(edition);
  const { vault } = createFakeVault([volume, manuscrit, chapter, edition, synopsis]);
  const app = { vault };
  const settings = { projectFolder: "Roman1/Manuscrit", orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };

  // Le Binder (et donc la compilation/l'export, qui partagent le même
  // parcours — voir compile-export.js) ne voit que Chapitre 1 : Edition,
  // voisin de Manuscrit, n'est jamais atteint par ce parcours.
  const children = getOrderedChildren(app, settings, manuscrit);
  assert.deepEqual(children.map((c) => c.path), ["Roman1/Manuscrit/Chapitre 1"]);

  // Depuis la racine réelle, Edition apparaît bien comme un frère de
  // Manuscrit — au même titre que Recherche/Ressources — jamais dedans.
  const volumeChildNames = getOrderedChildren(app, settings, volume).map((c) => c.name).sort();
  assert.deepEqual(volumeChildNames, ["Manuscrit", EDITION_FOLDER_NAME, RESEARCH_FOLDER_NAME, RESOURCES_FOLDER_NAME].sort());
});

test("Phase 1A : isStructuredManuscriptRoot identifie la racine éditoriale 'Manuscrit'", () => {
  const manuscrit = new TFolder("Projet/Manuscrit");
  const adoptedRoot = new TFolder("Mes textes");
  const nestedAdopted = new TFolder("Collection/Mes textes");

  assert.equal(isStructuredManuscriptRoot(manuscrit), true);
  assert.equal(isStructuredManuscriptRoot(adoptedRoot), false);
  assert.equal(isStructuredManuscriptRoot(nestedAdopted), false);
  assert.equal(isStructuredManuscriptRoot(null), false);
});

test("Phase 1A : Projet structuré Feuillets (Projet/Manuscrit)", () => {
  const volume = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit");
  manuscrit.parent = volume;
  volume.children = [manuscrit];

  const { vault } = createFakeVault([volume, manuscrit]);
  const app = { vault };
  const settings = { projectFolder: "Projet/Manuscrit" };

  assert.equal(getProjectRoot(app, settings)?.path, "Projet");
  assert.equal(feuilletsAuxiliaryRootPath(manuscrit), "Projet/_Feuillets");
});

test("Phase 1A : Dossier existant adopté comme projet (Mes textes)", () => {
  const adopted = new TFolder("Mes textes");
  const { vault } = createFakeVault([adopted]);
  const app = { vault };
  const settings = { projectFolder: "Mes textes" };

  assert.equal(getProjectRoot(app, settings)?.path, "Mes textes");
  assert.equal(feuilletsAuxiliaryRootPath(adopted), "Mes textes/_Feuillets");
});

test("Tri naturel : Chapter 1/2/10 (dossiers) triés dans l'ordre attendu quand aucun ordre éditorial n'existe", () => {
  const manuscrit = new TFolder("Roman/Manuscrit");
  const ch1 = new TFolder("Roman/Manuscrit/Chapter 1");
  const ch2 = new TFolder("Roman/Manuscrit/Chapter 2");
  const ch10 = new TFolder("Roman/Manuscrit/Chapter 10");
  const ch11 = new TFolder("Roman/Manuscrit/Chapter 11");
  // Ordre d'insertion volontairement « naïf » (comme le retournerait un
  // tri alphabétique classique) pour vérifier que le fallback corrige.
  manuscrit.children = [ch1, ch10, ch11, ch2];
  for (const c of manuscrit.children) c.parent = manuscrit;

  const { vault } = createFakeVault([manuscrit, ch1, ch2, ch10, ch11]);
  const app = { vault };
  const settings = { projectFolder: "Roman/Manuscrit", orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };

  const children = getOrderedChildren(app, settings, manuscrit);
  assert.deepEqual(children.map((c) => c.name), ["Chapter 1", "Chapter 2", "Chapter 10", "Chapter 11"]);
});

test("Tri naturel : Scene 1.1/1.2/1.10 (fichiers) triés dans l'ordre attendu quand aucun ordre éditorial n'existe", () => {
  const chapter = new TFolder("Roman/Manuscrit/Chapter 1");
  const s1 = new TFile("Roman/Manuscrit/Chapter 1/Scene 1.1.md");
  const s2 = new TFile("Roman/Manuscrit/Chapter 1/Scene 1.2.md");
  const s10 = new TFile("Roman/Manuscrit/Chapter 1/Scene 1.10.md");
  chapter.children = [s10, s1, s2];
  for (const c of chapter.children) c.parent = chapter;

  const { vault } = createFakeVault([chapter, s1, s2, s10]);
  const app = { vault, metadataCache: { getFileCache: () => null } };
  const settings = { projectFolder: "Roman/Manuscrit", orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };

  const children = getOrderedChildren(app, settings, chapter);
  assert.deepEqual(children.map((c) => c.name), ["Scene 1.1.md", "Scene 1.2.md", "Scene 1.10.md"]);
});

test("Tri naturel : l'ordre manuel persisté (settings.orders) reste TOUJOURS prioritaire", () => {
  const chapter = new TFolder("Roman/Manuscrit/Chapter 1");
  const s1 = new TFile("Roman/Manuscrit/Chapter 1/Scene 1.1.md");
  const s2 = new TFile("Roman/Manuscrit/Chapter 1/Scene 1.2.md");
  const s10 = new TFile("Roman/Manuscrit/Chapter 1/Scene 1.10.md");
  chapter.children = [s1, s2, s10];
  for (const c of chapter.children) c.parent = chapter;

  const { vault } = createFakeVault([chapter, s1, s2, s10]);
  const app = { vault, metadataCache: { getFileCache: () => null } };
  // Ordre Binder explicite, délibérément inverse du tri naturel.
  const settings = {
    projectFolder: "Roman/Manuscrit",
    orders: { "Roman/Manuscrit/Chapter 1": ["Scene 1.10.md", "Scene 1.2.md", "Scene 1.1.md"] },
    folderPositions: {},
    compileFileName: "Manuscrit.md",
  };

  const children = getOrderedChildren(app, settings, chapter);
  assert.deepEqual(children.map((c) => c.name), ["Scene 1.10.md", "Scene 1.2.md", "Scene 1.1.md"]);
});

test("Tri naturel : dossiers/fichiers ordinaires non numérotés restent triés correctement", () => {
  const manuscrit = new TFolder("Roman/Manuscrit");
  const partieB = new TFolder("Roman/Manuscrit/Partie B");
  const partieA = new TFolder("Roman/Manuscrit/Partie A");
  const epilogue = new TFolder("Roman/Manuscrit/Épilogue");
  manuscrit.children = [partieB, epilogue, partieA];
  for (const c of manuscrit.children) c.parent = manuscrit;

  const { vault } = createFakeVault([manuscrit, partieB, partieA, epilogue]);
  const app = { vault };
  const settings = { projectFolder: "Roman/Manuscrit", orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };

  const children = getOrderedChildren(app, settings, manuscrit);
  assert.deepEqual(children.map((c) => c.name), ["Épilogue", "Partie A", "Partie B"]);
});

test("Phase 1A : Dossier adopté imbriqué (Collection/Mes textes) ne remonte jamais au parent", () => {
  const collection = new TFolder("Collection");
  const adopted = new TFolder("Collection/Mes textes");
  adopted.parent = collection;
  collection.children = [adopted];

  const { vault } = createFakeVault([collection, adopted]);
  const app = { vault };
  const settings = { projectFolder: "Collection/Mes textes" };

  assert.equal(getProjectRoot(app, settings)?.path, "Collection/Mes textes");
  assert.notEqual(getProjectRoot(app, settings)?.path, "Collection");
  assert.equal(feuilletsAuxiliaryRootPath(adopted), "Collection/Mes textes/_Feuillets");
});
