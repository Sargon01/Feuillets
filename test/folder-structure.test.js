import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  getProjectFolder,
  getManuscriptRoot,
  getProjectRoot,
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
