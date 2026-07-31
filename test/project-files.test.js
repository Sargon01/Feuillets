import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createMinimalProject, CreateProjectError, duplicateProjectFolder, listSnapshotFiles, snapshotFile } from "../src/services/project-files.js";
import { getProjectFolder, getProjectRoot, getManuscriptRoot, roleOfFolder, roleOfFile } from "../src/services/folder-structure.js";

function projectFixture() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const scene = new TFile("Projet/Manuscrit/Chapitre 1/Scène.md", "Texte original");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [scene];
  scene.parent = chapter;
  return { volume, manuscript, chapter, scene };
}

test("snapshotFile : crée et retrouve un instantané du feuillet", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript, chapter, scene]);
  const app = { vault };

  const stamp = await snapshotFile(app, scene, manuscript);

  assert.match(stamp, /^\d{4}-\d{2}-\d{2} \d{2}h\d{2}\d{2}$/);
  const snapshots = listSnapshotFiles(app, scene, manuscript);
  assert.equal(snapshots.length, 1);
  assert.equal(await vault.read(snapshots[0]), "Texte original");
});

function freshSettings(overrides = {}) {
  return {
    wordGoal: 1500,
    projectFolder: "",
    projects: [],
    projectMeta: {},
    ...overrides,
  };
}

test("createMinimalProject (fiction) : crée la racine réelle, Manuscrit, Front, Recherche et Ressources", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  const result = await createMinimalProject(app, settings, { name: "Roman1", type: "fiction", author: "Camille Autrice" });

  assert.equal(result.volumePath, "Roman1");
  assert.equal(result.manuscritPath, "Roman1/Manuscrit");
  assert.equal(result.firstFolderPath, "Roman1/Manuscrit/Chapitre 1");
  assert.equal(result.firstFile.path, "Roman1/Manuscrit/Chapitre 1/Scène 1.md");

  // Racine réelle vs racine éditoriale.
  assert.ok(vault.getAbstractFileByPath("Roman1") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("Roman1/Manuscrit") instanceof TFolder);

  // Front + page de titre, avec titre et auteur.
  assert.ok(vault.getAbstractFileByPath("Roman1/Manuscrit/Front") instanceof TFolder);
  const titlePage = vault.getAbstractFileByPath("Roman1/Manuscrit/Front/Page de titre.md");
  assert.ok(titlePage instanceof TFile);
  assert.match(titlePage.content, /title: Roman1/);
  assert.match(titlePage.content, /author: Camille Autrice/);
  assert.match(titlePage.content, /# Roman1/);
  assert.match(titlePage.content, /Camille Autrice/);

  // Chapitre 1 / Scène 1.md.
  assert.ok(vault.getAbstractFileByPath("Roman1/Manuscrit/Chapitre 1") instanceof TFolder);
  const scene = vault.getAbstractFileByPath("Roman1/Manuscrit/Chapitre 1/Scène 1.md");
  assert.ok(scene instanceof TFile);
  assert.match(scene.content, /title: Scène 1/);
  assert.match(scene.content, /order: 1/);
  assert.match(scene.content, /synopsis: /);
  assert.match(scene.content, new RegExp(`goal: ${settings.wordGoal}`));

  // Recherche et Ressources à la racine réelle, frères de Manuscrit.
  assert.ok(vault.getAbstractFileByPath("Roman1/Recherche") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("Roman1/Ressources") instanceof TFolder);
  for (const sub of ["Images", "Template", "Layout", "Export", "Assets"]) {
    assert.ok(vault.getAbstractFileByPath(`Roman1/Ressources/${sub}`) instanceof TFolder, `Ressources/${sub} manquant`);
  }

  // Ni _Recherche, ni Recherche/Ressources DANS Manuscrit.
  assert.equal(vault.getAbstractFileByPath("Roman1/_Recherche"), null);
  assert.equal(vault.getAbstractFileByPath("Roman1/Manuscrit/Recherche"), null);
  assert.equal(vault.getAbstractFileByPath("Roman1/Manuscrit/Ressources"), null);

  assert.equal(settings.projectFolder, "Roman1/Manuscrit");
  assert.equal(settings.projectMeta["Roman1/Manuscrit"].type, "fiction");
  assert.equal(settings.projectMeta["Roman1/Manuscrit"].author, "Camille Autrice");
  assert.equal(settings.mergeYamlPreset, "roman");
});

test("createMinimalProject (fiction) : Chapitre 1 et Scène 1.md sont classés chapitre/scène", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Roman1", type: "fiction" });

  const manuscrit = getProjectFolder(app, settings);
  const chapter = vault.getAbstractFileByPath("Roman1/Manuscrit/Chapitre 1");
  const scene = vault.getAbstractFileByPath("Roman1/Manuscrit/Chapitre 1/Scène 1.md");
  assert.equal(settings.level1Role, "chapitres");
  assert.equal(roleOfFolder(app, settings, chapter), "chapitre");
  assert.equal(roleOfFile(app, settings, scene), "scene");
  assert.equal(manuscrit.path, "Roman1/Manuscrit");
});

test("createMinimalProject (non-fiction) : crée Partie 1/Chapitre 1.md, sans Scène", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  const result = await createMinimalProject(app, settings, { name: "Essai", type: "nonfiction" });

  assert.equal(result.firstFolderPath, "Essai/Manuscrit/Partie 1");
  assert.equal(result.firstFile.path, "Essai/Manuscrit/Partie 1/Chapitre 1.md");
  assert.ok(vault.getAbstractFileByPath("Essai/Manuscrit/Front/Page de titre.md") instanceof TFile);
  assert.ok(vault.getAbstractFileByPath("Essai/Recherche") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("Essai/Ressources") instanceof TFolder);
  assert.equal(vault.getAbstractFileByPath("Essai/Manuscrit/Chapitre 1"), null);
  assert.equal(vault.getAbstractFileByPath("Essai/Manuscrit/Partie 1/Scène 1.md"), null);

  assert.match(result.firstFile.content, /summary: /);
  assert.match(result.firstFile.content, /sources: /);
  assert.doesNotMatch(result.firstFile.content, /synopsis: /);
});

test("createMinimalProject (non-fiction) : Partie 1 et Chapitre 1.md sont classés partie/chapitre", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Essai", type: "nonfiction" });

  const part = vault.getAbstractFileByPath("Essai/Manuscrit/Partie 1");
  const chapterFile = vault.getAbstractFileByPath("Essai/Manuscrit/Partie 1/Chapitre 1.md");
  assert.equal(settings.level1Role, "parties");
  assert.equal(roleOfFolder(app, settings, part), "partie");
  assert.equal(roleOfFile(app, settings, chapterFile), "chapitre");
});

test("createMinimalProject : dossier parent facultatif imbrique le projet", async () => {
  const parent = new TFolder("Romans");
  const { vault } = createFakeVault([parent]);
  const app = { vault };
  const settings = freshSettings();

  const result = await createMinimalProject(app, settings, { name: "Roman1", parentFolder: "Romans", type: "fiction" });

  assert.equal(result.volumePath, "Romans/Roman1");
  assert.equal(settings.projectFolder, "Romans/Roman1/Manuscrit");
});

test("createMinimalProject : racine réelle et racine éditoriale sont bien distinctes", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Roman1", type: "fiction" });

  const manuscrit = getManuscriptRoot(app, settings);
  const root = getProjectRoot(app, settings);
  assert.equal(manuscrit.path, "Roman1/Manuscrit");
  assert.equal(root.path, "Roman1");
  assert.notEqual(root.path, manuscrit.path);
});

test("createMinimalProject : auteur facultatif — page de titre et projectMeta restent vides sans auteur", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Roman1", type: "fiction" });

  assert.equal(settings.projectMeta["Roman1/Manuscrit"].author, undefined);
  const titlePage = vault.getAbstractFileByPath("Roman1/Manuscrit/Front/Page de titre.md");
  assert.match(titlePage.content, /^author: $/m);
});

test("createMinimalProject : refuse un nom vide, sans rien créer", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await assert.rejects(
    () => createMinimalProject(app, settings, { name: "   ", type: "fiction" }),
    (e) => e instanceof CreateProjectError && e.code === "empty-name"
  );
  assert.equal(settings.projectFolder, "");
});

test("createMinimalProject : refuse un dossier déjà existant", async () => {
  const existing = new TFolder("Roman1");
  const { vault } = createFakeVault([existing]);
  const app = { vault };
  const settings = freshSettings();

  await assert.rejects(
    () => createMinimalProject(app, settings, { name: "Roman1", type: "fiction" }),
    (e) => e instanceof CreateProjectError && e.code === "already-exists" && e.path === "Roman1"
  );
  // Le dossier pré-existant n'a pas été transformé en Manuscrit/Chapitre 1.
  assert.equal(vault.getAbstractFileByPath("Roman1/Manuscrit"), null);
});

test("createMinimalProject : conserve l'ancien projet actif dans la liste", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings({ projectFolder: "Ancien/Manuscrit" });

  await createMinimalProject(app, settings, { name: "Roman1", type: "fiction" });

  assert.ok(settings.projects.includes("Ancien/Manuscrit"));
  assert.equal(settings.projectFolder, "Roman1/Manuscrit");
});

test("duplicateProjectFolder : copie le manuscrit et son ordre", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript, chapter, scene]);
  const app = { vault };
  const settings = {
    orders: { [manuscript.path]: [chapter.name] },
    folderPositions: { [chapter.path]: 2 },
  };

  const path = await duplicateProjectFolder(app, manuscript, "Premier jet", settings);

  assert.equal(path, "Projet/_Versions/Manuscrit (Premier jet)");
  assert.equal(await vault.read(vault.getAbstractFileByPath(`${path}/Chapitre 1/Scène.md`)), "Texte original");
  assert.deepEqual(settings.orders[path], [chapter.name]);
  assert.equal(settings.folderPositions[`${path}/Chapitre 1`], 2);

  // L'original n'a pas bougé : toujours au même chemin, contenu inchangé.
  assert.equal(manuscript.path, "Projet/Manuscrit");
  assert.equal(await vault.read(scene), "Texte original");
});

test("duplicateProjectFolder : refuse d'écraser une version déjà existante sous le même nom", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const existingVersion = new TFolder("Projet/_Versions/Manuscrit (V1)");
  const { vault } = createFakeVault([volume, manuscript, chapter, scene, existingVersion]);
  const app = { vault };

  await assert.rejects(
    () => duplicateProjectFolder(app, manuscript, "V1"),
    /existe déjà/
  );
  // Rien n'a été touché dans la version déjà en place.
  assert.ok(vault.getAbstractFileByPath("Projet/_Versions/Manuscrit (V1)") instanceof TFolder);
  assert.equal(vault.getAbstractFileByPath("Projet/_Versions/Manuscrit (V1)/Chapitre 1"), null);
});

test("duplicateProjectFolder : deux versions distinctes peuvent coexister et s'ouvrir séparément", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript, chapter, scene]);
  const app = { vault };

  const v1 = await duplicateProjectFolder(app, manuscript, "V1");
  const v2 = await duplicateProjectFolder(app, manuscript, "V2");

  assert.notEqual(v1, v2);
  const sceneV1 = vault.getAbstractFileByPath(`${v1}/Chapitre 1/Scène.md`);
  const sceneV2 = vault.getAbstractFileByPath(`${v2}/Chapitre 1/Scène.md`);
  assert.ok(sceneV1 instanceof TFile);
  assert.ok(sceneV2 instanceof TFile);
  assert.notEqual(sceneV1.path, sceneV2.path);
  assert.equal(await vault.read(sceneV1), "Texte original");
  assert.equal(await vault.read(sceneV2), "Texte original");
});
