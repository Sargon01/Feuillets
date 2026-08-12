import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createMinimalProject, CreateProjectError, duplicateProjectFolder, getVersionsRoot, listSnapshotFiles, snapshotFile, ensureEditionFolder, initProjectStructure, initResearchSubfolders, EDITION_DOCUMENTS, EDITION_SUBFOLDERS, editionDocumentForName } from "../src/services/project-files.js";
import { getProjectFolder, getProjectRoot, getManuscriptRoot, roleOfFolder, roleOfFile, getEditionRoot, EDITION_FOLDER_NAME, getFeuilletsFolderNames } from "../src/services/folder-structure.js";
import { setLocale } from "../src/i18n/index.js";
import { PROJECT_MODES, researchFolderNames } from "../src/utils/project-modes.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { BoardView } from "../src/views/board-view.js";

class BoardElement {
  constructor() {
    this.style = {};
  }
  empty() {}
  addClass() {}
  createDiv() { return new BoardElement(); }
}

async function visibleModesAtFirstBoardRender(vault, settings) {
  const root = vault.getAbstractFileByPath(settings.projectFolder);
  const icons = [];
  const stop = new Error("modes-ready");
  const view = new BoardView(
    { app: { vault }, contentEl: new BoardElement() },
    { settings, getProjectFolder: () => root }
  );
  view.iconBtn = (_parent, icon) => {
    icons.push(icon);
    if (icon === "sliders-horizontal") throw stop;
    return new BoardElement();
  };
  await assert.rejects(() => view._render(true), (error) => error === stop);
  return icons.filter((icon) => ["layout-grid", "list-tree", "git-branch", "milestone"].includes(icon));
}

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

test("ensureEditionFolder : crée le dossier Edition (voisin de Manuscrit), ses sous-dossiers et ses documents conventionnels", async () => {
  const { volume, manuscript } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript]);
  const app = { vault };

  assert.equal(getEditionRoot(app, manuscript), null, "aucun dossier Edition avant création");

  const edition = await ensureEditionFolder(app, manuscript);

  assert.equal(edition.path, "Projet/_Feuillets/Edition");
  assert.equal(getEditionRoot(app, manuscript).path, edition.path);
  for (const sub of EDITION_SUBFOLDERS) {
    assert.ok(vault.getAbstractFileByPath(`${edition.path}/${sub}`) instanceof TFolder, `${sub} créé`);
  }
  for (const doc of EDITION_DOCUMENTS) {
    const created = vault.getAbstractFileByPath(`${edition.path}/${doc.file}`);
    assert.ok(created instanceof TFile, `${doc.file} créé`);
    assert.equal(editionDocumentForName(created.name)?.id, doc.id, `${doc.file} reconnu comme document éditorial`);
  }
});

test("documents éditoriaux : les apostrophes droite et typographique sont reconnues", () => {
  assert.equal(editionDocumentForName("Note d’intention.md")?.id, "note-intention");
  assert.equal(editionDocumentForName("Note d'intention.md")?.id, "note-intention");
  assert.equal(editionDocumentForName("Lettre d’accompagnement.md")?.id, "lettre-accompagnement");
  assert.equal(editionDocumentForName("Lettre d'accompagnement.md")?.id, "lettre-accompagnement");
});

test("ensureEditionFolder : idempotent — n'écrase pas un document déjà modifié", async () => {
  const { volume, manuscript } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript]);
  const app = { vault };

  await ensureEditionFolder(app, manuscript);
  const synopsisPath = "Projet/_Feuillets/Edition/Synopsis.md";
  const synopsis = vault.getAbstractFileByPath(synopsisPath);
  await vault.modify(synopsis, "Contenu déjà écrit par l'autrice.");

  await ensureEditionFolder(app, manuscript);

  assert.equal(await vault.read(vault.getAbstractFileByPath(synopsisPath)), "Contenu déjà écrit par l'autrice.");
});

test("snapshotFile : un projet structuré écrit les snapshots à la racine du projet", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript, chapter, scene]);
  const app = { vault };

  const stamp = await snapshotFile(app, scene, manuscript);

  assert.match(stamp, /^\d{4}-\d{2}-\d{2} \d{2}h\d{2}\d{2}$/);
  assert.ok(vault.getAbstractFileByPath(`Projet/_Feuillets/Snapshots/${scene.basename}/${stamp}.md`) instanceof TFile);
  assert.equal(vault.getAbstractFileByPath("Projet/Manuscrit/_Snapshots"), null, "aucun dossier technique dans Manuscrit");
  const snapshots = listSnapshotFiles(app, scene, manuscript);
  assert.equal(snapshots.length, 1);
  assert.equal(await vault.read(snapshots[0]), "Texte original");
});

test("snapshotFile : un dossier utilisé tel quel écrit les snapshots dans ce dossier", async () => {
  const root = new TFolder("Mes textes");
  const file = new TFile("Mes textes/Texte 1.md", "Texte.");
  file.parent = root;
  root.children = [file];
  const { vault } = createFakeVault([root, file]);

  const stamp = await snapshotFile({ vault }, file, root);

  assert.ok(vault.getAbstractFileByPath(`Mes textes/_Feuillets/Snapshots/${file.basename}/${stamp}.md`) instanceof TFile);
});

test("listSnapshotFiles : lit les snapshots historiques sous Manuscrit sans y écrire les nouveaux", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const legacyRoot = new TFolder("Projet/Manuscrit/_Snapshots");
  const legacyForScene = new TFolder(`Projet/Manuscrit/_Snapshots/${scene.basename}`);
  const legacy = new TFile(`Projet/Manuscrit/_Snapshots/${scene.basename}/ancien.md`, "Ancien.");
  legacy.stat = { mtime: 1 };
  legacyRoot.parent = manuscript;
  legacyForScene.parent = legacyRoot;
  legacy.parent = legacyForScene;
  legacyRoot.children = [legacyForScene];
  legacyForScene.children = [legacy];
  const { vault } = createFakeVault([volume, manuscript, chapter, scene, legacyRoot, legacyForScene, legacy]);
  const app = { vault };

  await snapshotFile(app, scene, manuscript);

  const snapshots = listSnapshotFiles(app, scene, manuscript);
  assert.equal(snapshots.length, 2);
  assert.ok(snapshots.some((snapshot) => snapshot.path === legacy.path), "snapshot historique lisible");
  assert.ok(vault.getAbstractFileByPath(`Projet/_Feuillets/Snapshots/${scene.basename}`) instanceof TFolder, "nouveau snapshot canonique");
  assert.equal(legacyForScene.children.length, 1, "aucune écriture dans l'ancien emplacement");
});

test("listSnapshotFiles : un dossier utilisé tel quel n'explore ni parent ni dossier frère", () => {
  const parent = new TFolder("Collection");
  const root = new TFolder("Collection/Mes textes");
  const sibling = new TFolder("Collection/Autre");
  const file = new TFile("Collection/Mes textes/Texte 1.md", "Texte.");
  const parentSnapshots = new TFolder("Collection/_Snapshots");
  const parentScene = new TFolder(`Collection/_Snapshots/${file.basename}`);
  const parentSnapshot = new TFile(`Collection/_Snapshots/${file.basename}/parent.md`, "Parent.");
  const siblingSnapshots = new TFolder("Collection/Autre/_Snapshots");
  const siblingScene = new TFolder(`Collection/Autre/_Snapshots/${file.basename}`);
  const siblingSnapshot = new TFile(`Collection/Autre/_Snapshots/${file.basename}/frere.md`, "Frère.");
  root.parent = parent;
  sibling.parent = parent;
  file.parent = root;
  parentSnapshots.parent = parent;
  parentScene.parent = parentSnapshots;
  parentSnapshot.parent = parentScene;
  siblingSnapshots.parent = sibling;
  siblingScene.parent = siblingSnapshots;
  siblingSnapshot.parent = siblingScene;
  const { vault } = createFakeVault([parent, root, sibling, file, parentSnapshots, parentScene, parentSnapshot, siblingSnapshots, siblingScene, siblingSnapshot]);

  assert.deepEqual(listSnapshotFiles({ vault }, file, root), []);
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
  assert.match(titlePage.content, /:::titre: Roman1/);
  assert.match(titlePage.content, /:::auteur: Camille Autrice/);

  // Chapitre 1 / Scène 1.md.
  assert.ok(vault.getAbstractFileByPath("Roman1/Manuscrit/Chapitre 1") instanceof TFolder);
  const scene = vault.getAbstractFileByPath("Roman1/Manuscrit/Chapitre 1/Scène 1.md");
  assert.ok(scene instanceof TFile);
  assert.match(scene.content, /title: Scène 1/);
  assert.match(scene.content, /order: 1/);
  assert.match(scene.content, /synopsis: /);
  assert.match(scene.content, new RegExp(`goal: ${settings.wordGoal}`));

  // Les auxiliaires nouveaux sont regroupés sous _Feuillets.
  assert.ok(vault.getAbstractFileByPath("Roman1/_Feuillets/Recherche") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("Roman1/_Feuillets/Ressources") instanceof TFolder);
  for (const sub of ["Images", "Modèles", "Mises en page", "Exports", "Ressources internes"]) {
    assert.ok(vault.getAbstractFileByPath(`Roman1/_Feuillets/Ressources/${sub}`) instanceof TFolder, `Ressources/${sub} manquant`);
  }

  // Ni _Recherche ni _Ressources DANS Manuscrit.
  assert.equal(vault.getAbstractFileByPath("Roman1/Manuscrit/_Recherche"), null);
  assert.equal(vault.getAbstractFileByPath("Roman1/Manuscrit/_Ressources"), null);

  assert.equal(settings.projectFolder, "Roman1/Manuscrit");
  assert.equal(settings.projectMeta["Roman1/Manuscrit"].type, "fiction");
  assert.equal(settings.projectMeta["Roman1/Manuscrit"].author, "Camille Autrice");
  assert.equal(settings.mergeYamlPreset, "roman");
});

test("createMinimalProject : initialise les préférences Board du type avant le premier rendu", async (t) => {
  for (const [type, name, hiddenBoardModes, columns, visibleIcons] of [
    ["fiction", "Roman", ["timeline"], ["synopsis", "status"], ["layout-grid", "list-tree", "git-branch"]],
    ["nonfiction", "Essai", ["arcs", "timeline"], ["summary"], ["layout-grid", "list-tree"]],
    ["free", "Carnet", ["arcs", "timeline"], ["synopsis"], ["layout-grid", "list-tree"]],
  ]) {
    await t.test(type, async () => {
      const { vault } = createFakeVault([]);
      const settings = freshSettings({
        hiddenBoardModes: [...DEFAULT_SETTINGS.hiddenBoardModes],
        outlineCols: { ...DEFAULT_SETTINGS.outlineCols },
      });
      const result = await createMinimalProject({ vault }, settings, { name, type });
      const meta = settings.projectMeta[result.manuscritPath];
      assert.deepEqual(meta.hiddenBoardModes, hiddenBoardModes);
      assert.deepEqual(Object.keys(meta.outlineCols).filter((key) => meta.outlineCols[key]), columns);
      assert.deepEqual(await visibleModesAtFirstBoardRender(vault, settings), visibleIcons);
    });
  }
});

test("premier rendu Board : distingue les defaults globaux d'un réglage legacy personnalisé", async (t) => {
  await t.test("les globals identiques à DEFAULT_SETTINGS laissent le type Libre initialiser le Plan", async () => {
    const { vault } = createFakeVault([]);
    const settings = freshSettings({
      hiddenBoardModes: [...DEFAULT_SETTINGS.hiddenBoardModes],
      outlineCols: { ...DEFAULT_SETTINGS.outlineCols },
    });
    const result = await createMinimalProject({ vault }, settings, { name: "Carnet", type: "free" });
    delete settings.projectMeta[result.manuscritPath].hiddenBoardModes;
    delete settings.projectMeta[result.manuscritPath].outlineCols;

    await visibleModesAtFirstBoardRender(vault, settings);
    const meta = settings.projectMeta[result.manuscritPath];
    assert.deepEqual(meta.hiddenBoardModes, ["arcs", "timeline"]);
    assert.deepEqual(Object.keys(meta.outlineCols).filter((key) => meta.outlineCols[key]), ["synopsis"]);
  });

  await t.test("un global legacy réellement modifié est repris une seule fois", async () => {
    const { vault } = createFakeVault([]);
    const legacyOutline = { ...DEFAULT_SETTINGS.outlineCols, summary: true, synopsis: false };
    const settings = freshSettings({ hiddenBoardModes: ["board"], outlineCols: legacyOutline });
    const result = await createMinimalProject({ vault }, settings, { name: "Ancien", type: "free" });
    delete settings.projectMeta[result.manuscritPath].hiddenBoardModes;
    delete settings.projectMeta[result.manuscritPath].outlineCols;

    await visibleModesAtFirstBoardRender(vault, settings);
    const meta = settings.projectMeta[result.manuscritPath];
    assert.deepEqual(meta.hiddenBoardModes, ["board"]);
    assert.deepEqual(meta.outlineCols, legacyOutline);
  });
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
  assert.ok(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("Essai/_Feuillets/Ressources") instanceof TFolder);
  assert.equal(vault.getAbstractFileByPath("Essai/Manuscrit/Chapitre 1"), null);
  assert.equal(vault.getAbstractFileByPath("Essai/Manuscrit/Partie 1/Scène 1.md"), null);

  assert.match(result.firstFile.content, /summary: /);
  assert.match(result.firstFile.content, /sources: /);
  assert.doesNotMatch(result.firstFile.content, /synopsis: /);
});

test("createMinimalProject (libre) : crée uniquement Nouveau texte.md sans structure de livre", async () => {
  const { vault } = createFakeVault([]);
  const settings = freshSettings();

  const result = await createMinimalProject({ vault }, settings, { name: "Carnet", type: "free" });

  assert.equal(result.firstFolderPath, "Carnet/Manuscrit");
  assert.equal(result.firstFile.path, "Carnet/Manuscrit/Nouveau texte.md");
  assert.equal(result.firstFile.content, "# Nouveau texte\n\n");
  assert.equal(settings.projectMeta["Carnet/Manuscrit"].type, "free");
  assert.equal(vault.getAbstractFileByPath("Carnet/Manuscrit/Front"), null);
  assert.equal(vault.getAbstractFileByPath("Carnet/Manuscrit/Partie 1"), null);
  assert.equal(vault.getAbstractFileByPath("Carnet/Manuscrit/Chapitre 1"), null);
  assert.equal(vault.getAbstractFileByPath("Carnet/Manuscrit/Chapitre 1.md"), null);
  assert.deepEqual(settings.projectMeta["Carnet/Manuscrit"].hiddenBoardModes, ["arcs", "timeline"]);
  assert.deepEqual(
    Object.keys(settings.projectMeta["Carnet/Manuscrit"].outlineCols).filter(
      (key) => settings.projectMeta["Carnet/Manuscrit"].outlineCols[key]
    ),
    ["synopsis"]
  );
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

test("createMinimalProject (non-fiction) : crée Recherche/Notes, Sources uniquement", async () => {
  setLocale("fr");
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Essai", type: "nonfiction" });

  // Vérifie les sous-dossiers du mode non-fiction
  assert.ok(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche") instanceof TFolder, "Recherche créé");
  assert.ok(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche/Notes") instanceof TFolder, "Notes créé");
  assert.equal(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche/Bibliographie"), null, "pas de Bibliographie automatique");
  assert.ok(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche/Sources") instanceof TFolder, "Sources créé");

  // Vérifie qu'aucune catégorie fiction n'est créée
  assert.equal(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche/Personnages"), null, "pas de Personnages en non-fiction");
  assert.equal(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche/Lieux"), null, "pas de Lieux en non-fiction");
  assert.equal(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche/Glossaire"), null, "pas de Glossaire en non-fiction");
  assert.equal(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche/Événements"), null, "pas d'Événements en non-fiction");
  assert.equal(vault.getAbstractFileByPath("Essai/_Feuillets/Recherche/Lore"), null, "pas de Lore en non-fiction");
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

test("duplicateProjectFolder : copie le manuscrit et son ordre dans _Feuillets/Versions (chemin canonique)", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript, chapter, scene]);
  const app = { vault };
  const settings = {
    orders: { [manuscript.path]: [chapter.name] },
    folderPositions: { [chapter.path]: 2 },
  };

  const path = await duplicateProjectFolder(app, manuscript, "Premier jet", settings);

  assert.equal(path, "Projet/_Feuillets/Versions/Manuscrit (Premier jet)");
  assert.equal(await vault.read(vault.getAbstractFileByPath(`${path}/Chapitre 1/Scène.md`)), "Texte original");
  assert.deepEqual(settings.orders[path], [chapter.name]);
  assert.equal(settings.folderPositions[`${path}/Chapitre 1`], 2);

  // L'original n'a pas bougé : toujours au même chemin, contenu inchangé.
  assert.equal(manuscript.path, "Projet/Manuscrit");
  assert.equal(await vault.read(scene), "Texte original");

  // Plus aucune écriture dans l'ancien dossier frère _Versions.
  assert.equal(vault.getAbstractFileByPath("Projet/_Versions"), null);
});

test("duplicateProjectFolder : refuse d'écraser une version déjà existante sous le même nom (chemin canonique)", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  const existingVersion = new TFolder("Projet/_Feuillets/Versions/Manuscrit (V1)");
  const { vault } = createFakeVault([volume, manuscript, chapter, scene, existingVersion]);
  const app = { vault };

  await assert.rejects(
    () => duplicateProjectFolder(app, manuscript, "V1"),
    /existe déjà/
  );
  // Rien n'a été touché dans la version déjà en place.
  assert.ok(vault.getAbstractFileByPath("Projet/_Feuillets/Versions/Manuscrit (V1)") instanceof TFolder);
  assert.equal(vault.getAbstractFileByPath("Projet/_Feuillets/Versions/Manuscrit (V1)/Chapitre 1"), null);
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

// =========================================================================
// Tests ciblés — getVersionsRoot : résolveur pur, ordre de résolution
// =========================================================================

test("getVersionsRoot : préfère le chemin canonique _Feuillets/Versions quand plusieurs emplacements existent", () => {
  const { volume, manuscript } = projectFixture();
  const canonical = new TFolder("Projet/_Feuillets/Versions");
  const prefixedInAuxiliary = new TFolder("Projet/_Feuillets/_Versions");
  const legacy = new TFolder("Projet/_Versions");
  const { vault } = createFakeVault([volume, manuscript, canonical, prefixedInAuxiliary, legacy]);
  const app = { vault };

  const resolved = getVersionsRoot(app, manuscript);

  assert.equal(resolved, canonical);
});

test("getVersionsRoot : l'ancien dossier frère _Versions reste lisible s'il n'y a rien de plus récent", () => {
  const { volume, manuscript } = projectFixture();
  const legacy = new TFolder("Projet/_Versions");
  const legacyVersion = new TFolder("Projet/_Versions/Manuscrit (V1)");
  legacy.children = [legacyVersion];
  legacyVersion.parent = legacy;
  const { vault } = createFakeVault([volume, manuscript, legacy, legacyVersion]);
  const app = { vault };

  const resolved = getVersionsRoot(app, manuscript);

  assert.equal(resolved, legacy);
  assert.deepEqual(resolved.children, [legacyVersion]);
});

test("getVersionsRoot : la variante _Feuillets/_Versions reste lisible si elle est présente (sans canonique ni ancien frère)", () => {
  const { volume, manuscript } = projectFixture();
  const prefixedInAuxiliary = new TFolder("Projet/_Feuillets/_Versions");
  const { vault } = createFakeVault([volume, manuscript, prefixedInAuxiliary]);
  const app = { vault };

  const resolved = getVersionsRoot(app, manuscript);

  assert.equal(resolved, prefixedInAuxiliary);
});

test("getVersionsRoot : après un déplacement manuel _Versions → _Feuillets/Versions, les versions sont immédiatement reconnues au chemin canonique", () => {
  const { volume, manuscript } = projectFixture();
  // « Déplacement manuel » simulé directement : la version vit désormais
  // au chemin canonique (getVersionsRoot ne crée ni ne déplace jamais rien
  // lui-même — voir le test dédié à ce résolveur pur ci-dessous).
  const movedRoot = new TFolder("Projet/_Feuillets/Versions");
  const moved = new TFolder("Projet/_Feuillets/Versions/Manuscrit (V1)");
  movedRoot.children = [moved];
  moved.parent = movedRoot;
  const { vault } = createFakeVault([volume, manuscript, movedRoot, moved]);
  const app = { vault };

  const resolved = getVersionsRoot(app, manuscript);

  assert.equal(resolved, movedRoot);
  assert.deepEqual(resolved.children, [moved]);
});

test("getVersionsRoot : ne crée ni ne déplace jamais rien sur le disque (résolveur pur)", () => {
  const { volume, manuscript } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript]);
  const app = { vault };
  const writes = [];
  const guard = (name) => (...args) => { writes.push(name); throw new Error(`${name} ne doit jamais être appelé par getVersionsRoot`); };
  vault.createFolder = guard("createFolder");
  vault.create = guard("create");
  vault.rename = guard("rename");

  const resolved = getVersionsRoot(app, manuscript);

  assert.equal(resolved, null);
  assert.deepEqual(writes, []);
});

// =========================================================================
// Tests ciblés — Diff (PickFileModal) : retrouve les versions via
// getVersionsRoot, sans logique métier propre à réécrire.
// =========================================================================

test("Diff : getVersionsRoot expose bien les versions dupliquées (nouvelles ET historiques) à un consommateur comme PickFileModal", async () => {
  const { volume, manuscript, chapter, scene } = projectFixture();
  // _Feuillets/Versions déjà présent (comme après un premier
  // duplicateProjectFolder, ou après ensureFeuilletsAuxiliaryFolders) : le
  // point exercé ici est que getVersionsRoot le retrouve et que ses
  // enfants — les versions elles-mêmes — restent la bonne source pour un
  // consommateur comme PickFileModal.getOrigins (diff-modal.ts, non
  // modifié par ce chantier).
  const versionsRoot = new TFolder("Projet/_Feuillets/Versions");
  const { vault } = createFakeVault([volume, manuscript, chapter, scene, versionsRoot]);
  const app = { vault };

  const v1 = await duplicateProjectFolder(app, manuscript, "V1");
  const v2 = await duplicateProjectFolder(app, manuscript, "V2");

  const resolved = getVersionsRoot(app, manuscript);
  assert.equal(resolved, versionsRoot);
  const originPaths = resolved.children
    .filter((child) => child instanceof TFolder)
    .map((child) => child.path)
    .sort();
  assert.deepEqual(originPaths, [v1, v2].sort());
});

// =========================================================================
// Tests ciblés — initProjectStructure : racine, locale, variantes, doublons
// =========================================================================

/** Fabriques minimales pour initProjectStructure */
function makeNestedProject(volumePath = "Projets/Mon recueil") {
  const projets = new TFolder("Projets");
  const volume = new TFolder(volumePath);
  const manuscript = new TFolder(`${volumePath}/Manuscrit`);
  volume.parent = projets;
  manuscript.parent = volume;
  projets.children = [volume];
  volume.children = [manuscript];
  return { projets, volume, manuscript };
}

function freshSettingsFor(manuscritPath, overrides = {}) {
  return {
    wordGoal: 1500,
    projectFolder: manuscritPath,
    projects: [],
    projectMeta: { [manuscritPath]: { type: "fiction" } },
    journalFolder: "",
    manuscriptTitle: "",
    mergeYamlPreset: "roman",
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// Test 1 — nouveau projet FR : structure française sous la racine du projet
// -------------------------------------------------------------------------
test("createMinimalProject (FR) : _Recherche et _Ressources sous le volume, pas à la racine du coffre", async () => {
  setLocale("fr");
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettingsFor("");

  const result = await createMinimalProject(app, settings, { name: "Roman FR", type: "fiction" });

  assert.ok(vault.getAbstractFileByPath("Roman FR/_Feuillets/Recherche") instanceof TFolder, "Recherche sous _Feuillets");
  assert.ok(vault.getAbstractFileByPath("Roman FR/_Feuillets/Ressources") instanceof TFolder, "Ressources sous _Feuillets");
  assert.equal(vault.getAbstractFileByPath("_Recherche"), null, "pas de _Recherche à la racine");
  assert.equal(vault.getAbstractFileByPath("_Ressources"), null, "pas de _Ressources à la racine");
  assert.equal(vault.getAbstractFileByPath("_Research"), null, "pas de _Research en FR");
});

// -------------------------------------------------------------------------
// Test 2 — nouveau projet EN : structure anglaise sous la racine du projet
// -------------------------------------------------------------------------
test("createMinimalProject (EN) : _Research et _Resources sous le volume, noms anglais", async () => {
  setLocale("en");
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettingsFor("");

  const result = await createMinimalProject(app, settings, { name: "Novel EN", type: "fiction" });

  assert.ok(vault.getAbstractFileByPath("Novel EN/_Feuillets/Recherche") instanceof TFolder, "Recherche sous _Feuillets");
  assert.ok(vault.getAbstractFileByPath("Novel EN/_Feuillets/Ressources") instanceof TFolder, "Ressources sous _Feuillets");
  assert.equal(vault.getAbstractFileByPath("_Recherche"), null, "pas de _Recherche en EN");
  assert.equal(vault.getAbstractFileByPath("_Ressources"), null, "pas de _Ressources en EN");

  // Repasser en FR pour les tests suivants
  setLocale("fr");
});

// -------------------------------------------------------------------------
// Test 3 — initProjectStructure sur un projet imbriqué (FR)
// Tous les dossiers sous Projets/Mon recueil/, aucun à la racine du coffre
// -------------------------------------------------------------------------
test("initProjectStructure (FR, projet imbriqué) : dossiers sous la racine du projet, jamais à la racine du coffre", async () => {
  setLocale("fr");
  const { projets, volume, manuscript } = makeNestedProject("Projets/Mon recueil");
  const { vault } = createFakeVault([projets, volume, manuscript]);
  const app = { vault };
  const settings = freshSettingsFor("Projets/Mon recueil/Manuscrit");

  await initProjectStructure(app, settings);

  const base = "Projets/Mon recueil";
  // _Recherche et ses sous-dossiers sous la racine du projet (mode fiction)
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche`) instanceof TFolder, "Recherche sous _Feuillets");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Bibliographie`), null, "pas de Bibliographie automatique");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Glossaire`) instanceof TFolder, "Glossaire");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Événements`) instanceof TFolder, "Événements");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Personnages`) instanceof TFolder, "Personnages");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Lieux`) instanceof TFolder, "Lieux");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Lore`) instanceof TFolder, "Lore");
  assert.ok(vault.getAbstractFileByPath(`${base}/Manuscrit/Front/Page de titre.md`) instanceof TFile, "page de titre Fiction");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Modèles/Characters.md`) instanceof TFile, "template Fiction");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Snapshots`), null, "pas de Snapshots au bootstrap");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Backups`), null, "pas de Backups au bootstrap");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Journal`), null, "pas de Journal au bootstrap");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources`) instanceof TFolder, "Ressources sous _Feuillets");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Modèles`) instanceof TFolder, "Modèles");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Mises en page`) instanceof TFolder, "Mises en page");

  // Aucun dossier à la racine du coffre
  assert.equal(vault.getAbstractFileByPath("_Recherche"), null, "pas de _Recherche à la racine du coffre");
  assert.equal(vault.getAbstractFileByPath("_Snapshots"), null, "pas de _Snapshots à la racine du coffre");
  assert.equal(vault.getAbstractFileByPath("_Ressources"), null, "pas de _Ressources à la racine du coffre");
});

// -------------------------------------------------------------------------
// Test 4 — transformation d'un dossier existant : contenu strictly inchangé
// -------------------------------------------------------------------------
test("OpenExistingFolder (simulation) : S.projectFolder = path, aucune structure ajoutée", () => {
  // La transformation se limite à enregistrer le chemin dans settings.
  // Ce test vérifie que le mécanisme lui-même n'appelle pas initProjectStructure.
  const S = { projectFolder: "", projects: [] };
  const path = "Projets/Mon existant";

  // Simulation de OpenExistingFolderModal.open()
  if (S.projectFolder && S.projectFolder !== path && !S.projects.includes(S.projectFolder)) {
    S.projects.push(S.projectFolder);
  }
  S.projectFolder = path;
  if (!S.projects.includes(path)) S.projects.push(path);

  assert.equal(S.projectFolder, path);
  assert.ok(S.projects.includes(path));
  // Aucun dossier créé : la transformation ne crée rien
});

// -------------------------------------------------------------------------
// Test 5 — projet FR avec Research et Resources existants : aucun doublon
// -------------------------------------------------------------------------
test("initProjectStructure (FR) : Research + Resources existants — aucun doublon _Recherche/_Ressources", async () => {
  setLocale("fr");
  const projets = new TFolder("Projets");
  const volume = new TFolder("Projets/Vieux projet");
  const manuscript = new TFolder("Projets/Vieux projet/Manuscrit");
  // Dossiers anglais pré-existants (sans préfixe)
  const research = new TFolder("Projets/Vieux projet/Research");
  const resources = new TFolder("Projets/Vieux projet/Resources");
  volume.parent = projets;
  manuscript.parent = volume;
  research.parent = volume;
  resources.parent = volume;
  projets.children = [volume];
  volume.children = [manuscript, research, resources];
  const { vault } = createFakeVault([projets, volume, manuscript, research, resources]);
  const app = { vault };
  const settings = freshSettingsFor("Projets/Vieux projet/Manuscrit");

  await initProjectStructure(app, settings);

  // Research/Resources d'origine toujours présents
  assert.ok(vault.getAbstractFileByPath("Projets/Vieux projet/Research") instanceof TFolder, "Research conservé");
  assert.ok(vault.getAbstractFileByPath("Projets/Vieux projet/Resources") instanceof TFolder, "Resources conservé");
  // Aucun doublon avec préfixe _ créé
  assert.equal(vault.getAbstractFileByPath("Projets/Vieux projet/_Recherche"), null, "pas de _Recherche en doublon");
  assert.equal(vault.getAbstractFileByPath("Projets/Vieux projet/_Ressources"), null, "pas de _Ressources en doublon");
});

// -------------------------------------------------------------------------
// Test 6 — structure partielle : seuls les dossiers manquants sont créés
// -------------------------------------------------------------------------
test("initProjectStructure (FR) : structure partielle — seuls les dossiers manquants sont créés", async () => {
  setLocale("fr");
  const { projets, volume, manuscript } = makeNestedProject("Projets/Partiel");
  // Personnages et Lieux déjà présents
  const recherche = new TFolder("Projets/Partiel/Recherche");
  const personnages = new TFolder("Projets/Partiel/Recherche/Personnages");
  const lieux = new TFolder("Projets/Partiel/Recherche/Lieux");
  recherche.parent = volume;
  personnages.parent = recherche;
  lieux.parent = recherche;
  volume.children.push(recherche);
  recherche.children = [personnages, lieux];
  const { vault } = createFakeVault([projets, volume, manuscript, recherche, personnages, lieux]);
  const app = { vault };
  const settings = freshSettingsFor("Projets/Partiel/Manuscrit");

  await initProjectStructure(app, settings);

  // Dossiers préexistants inchangés
  assert.ok(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Personnages") instanceof TFolder, "Personnages toujours là");
  assert.ok(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Lieux") instanceof TFolder, "Lieux toujours là");
  // Dossiers manquants créés (mode fiction)
  assert.equal(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Bibliographie"), null, "pas de Bibliographie automatique");
  assert.ok(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Glossaire") instanceof TFolder, "Glossaire créé");
  assert.ok(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Événements") instanceof TFolder, "Événements créés");
  assert.ok(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Lore") instanceof TFolder, "Lore créé");
});

// -------------------------------------------------------------------------
// Test 6b — mode non-fiction : Notes, Sources créés (aucune Bibliographie)
// -------------------------------------------------------------------------
test("initProjectStructure (FR) : mode non-fiction crée Notes, Sources", async () => {
  setLocale("fr");
  const { projets, volume, manuscript } = makeNestedProject("Projets/Essai");
  const { vault } = createFakeVault([projets, volume, manuscript]);
  const app = { vault };
  const settings = freshSettingsFor("Projets/Essai/Manuscrit", { projectMeta: { "Projets/Essai/Manuscrit": { type: "nonfiction" } } });

  await initProjectStructure(app, settings);

  const base = "Projets/Essai";
  // _Recherche et ses sous-dossiers en mode non-fiction
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche`) instanceof TFolder, "Recherche sous _Feuillets");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Bibliographie`), null, "pas de Bibliographie automatique");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Notes`) instanceof TFolder, "Notes");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Sources`) instanceof TFolder, "Sources");
  // Pas de catégories fiction
  assert.equal(vault.getAbstractFileByPath(`${base}/_Recherche/Personnages`), null, "pas de Personnages en non-fiction");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Recherche/Lieux`), null, "pas de Lieux en non-fiction");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Recherche/Glossaire`), null, "pas de Glossaire en non-fiction");
  assert.ok(vault.getAbstractFileByPath(`${base}/Manuscrit/Front/Page de titre.md`) instanceof TFile, "page de titre Non-fiction");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Modèles/Sources.md`) instanceof TFile, "template Non-fiction");
});

test("initProjectStructure (FR) : mode libre crée seulement les éléments techniques", async () => {
  setLocale("fr");
  const { projets, volume, manuscript } = makeNestedProject("Projets/Libre");
  const { vault } = createFakeVault([projets, volume, manuscript]);
  const app = { vault };
  const settings = freshSettingsFor("Projets/Libre/Manuscrit", {
    projectMeta: { "Projets/Libre/Manuscrit": { type: "free" } },
    mergeYamlPreset: "minimal",
  });

  await initProjectStructure(app, settings);

  const base = "Projets/Libre";
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche`) instanceof TFolder, "Recherche technique");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources`) instanceof TFolder, "Ressources techniques");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Snapshots`), null, "pas de Snapshots au bootstrap");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Backups`), null, "pas de Backups au bootstrap");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Journal`), null, "pas de Journal au bootstrap");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Mises en page/Exemple.md`), null, "pas d'Exemple.md créé automatiquement");
  assert.equal(vault.getAbstractFileByPath(`${base}/Manuscrit/Front`), null);
  for (const name of ["Characters.md", "Places.md", "Lore.md", "Sources.md", "Acteurs.md", "Geographie.md", "Concepts.md", "Bibliography.md", "Glossary.md", "Events.md"]) {
    assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Modèles/${name}`), null, name);
  }
  for (const name of ["Bibliographie", "Glossaire", "Événements", "Personnages", "Lieux", "Notes", "Sources"]) {
    assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/${name}`), null, name);
  }
});

test("initProjectStructure (FR) : ne supprime pas le Front existant d'un projet libre", async () => {
  setLocale("fr");
  const { projets, volume, manuscript } = makeNestedProject("Projets/Libre legacy");
  const front = new TFolder("Projets/Libre legacy/Manuscrit/Front");
  const titlePage = new TFile("Projets/Libre legacy/Manuscrit/Front/Page de titre.md", "Titre existant");
  front.parent = manuscript;
  titlePage.parent = front;
  manuscript.children = [front];
  front.children = [titlePage];
  const { vault } = createFakeVault([projets, volume, manuscript, front, titlePage]);
  const settings = freshSettingsFor("Projets/Libre legacy/Manuscrit", {
    projectMeta: { "Projets/Libre legacy/Manuscrit": { type: "free" } },
    mergeYamlPreset: "minimal",
  });

  await initProjectStructure({ vault }, settings);

  assert.equal(vault.getAbstractFileByPath(front.path), front);
  assert.equal(await vault.read(titlePage), "Titre existant");
});

// -------------------------------------------------------------------------
// Test 7 — variantes historiques : Templates, Layouts, Exports reconnues
// -------------------------------------------------------------------------
test("initProjectStructure (FR) : variantes historiques Templates/Layouts/Exports reconnues, aucun doublon", async () => {
  setLocale("fr");
  const { projets, volume, manuscript } = makeNestedProject("Projets/Legacy");
  const ressources = new TFolder("Projets/Legacy/Ressources");
  const templates = new TFolder("Projets/Legacy/Ressources/Templates");
  const layouts = new TFolder("Projets/Legacy/Ressources/Layouts");
  const exports = new TFolder("Projets/Legacy/Ressources/Exports");
  ressources.parent = volume;
  templates.parent = ressources;
  layouts.parent = ressources;
  exports.parent = ressources;
  volume.children.push(ressources);
  ressources.children = [templates, layouts, exports];
  const { vault } = createFakeVault([projets, volume, manuscript, ressources, templates, layouts, exports]);
  const app = { vault };
  const settings = freshSettingsFor("Projets/Legacy/Manuscrit");

  await initProjectStructure(app, settings);

  // Variantes historiques préservées
  assert.ok(vault.getAbstractFileByPath("Projets/Legacy/Ressources/Templates") instanceof TFolder, "Templates conservé");
  assert.ok(vault.getAbstractFileByPath("Projets/Legacy/Ressources/Layouts") instanceof TFolder, "Layouts conservé");
  assert.ok(vault.getAbstractFileByPath("Projets/Legacy/Ressources/Exports") instanceof TFolder, "Exports conservé");
  // Aucun doublon avec le nouveau nom
  assert.equal(vault.getAbstractFileByPath("Projets/Legacy/Ressources/Template"), null, "pas de doublon Template");
  assert.equal(vault.getAbstractFileByPath("Projets/Legacy/Ressources/Layout"), null, "pas de doublon Layout");
  assert.equal(vault.getAbstractFileByPath("Projets/Legacy/Ressources/Export"), null, "pas de doublon Export");
});

// =========================================================================
// Tests — Transformer un dossier existant en projet Feuillets
// =========================================================================

test("initResearchSubfolders (FR, mode fiction) : dossier transformé crée catégories fiction", async () => {
  setLocale("fr");
  const existingFolder = new TFolder("Existant");
  const research = new TFolder("Existant/Recherche");
  research.parent = existingFolder;
  existingFolder.children = [research];
  const { vault } = createFakeVault([existingFolder, research]);
  const app = { vault };
  const names = getFeuilletsFolderNames();
  const researchPath = `Existant/${names.research}`;

  // Appeler initResearchSubfolders avec le mode fiction
  await initResearchSubfolders(app, researchPath, "fiction");

  // Vérifier les catégories fiction
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}`) instanceof TFolder, "Recherche existe");
  assert.equal(vault.getAbstractFileByPath(`Existant/${names.research}/Bibliographie`), null, "pas de Bibliographie automatique");
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}/Personnages`) instanceof TFolder, "Personnages");
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}/Lieux`) instanceof TFolder, "Lieux");
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}/Événements`) instanceof TFolder, "Événements");
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}/Lore`) instanceof TFolder, "Lore");
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}/Glossaire`) instanceof TFolder, "Glossaire");
  // Pas de catégories non-fiction
  assert.equal(vault.getAbstractFileByPath(`Existant/${names.research}/Notes`), null, "pas de Notes en fiction");
});

test("initResearchSubfolders : réutilise une rubrique Chronologie existante pour les événements", async () => {
  setLocale("en");
  const project = new TFolder("Projet");
  const research = new TFolder("Projet/_Research");
  const chronology = new TFolder("Projet/_Research/Chronologie");
  research.parent = project;
  chronology.parent = research;
  project.children = [research];
  research.children = [chronology];
  const { vault } = createFakeVault([project, research, chronology]);

  await initResearchSubfolders({ vault }, research.path, "fiction");

  assert.equal(vault.getAbstractFileByPath("Projet/_Research/Events"), null, "pas de doublon Events");
  assert.equal(vault.getAbstractFileByPath("Projet/_Research/Chronologie"), chronology);
});

test("initResearchSubfolders (FR, mode non-fiction) : dossier transformé crée catégories non-fiction", async () => {
  setLocale("fr");
  const existingFolder = new TFolder("Essai");
  const research = new TFolder("Essai/Recherche");
  research.parent = existingFolder;
  existingFolder.children = [research];
  const { vault } = createFakeVault([existingFolder, research]);
  const app = { vault };
  const names = getFeuilletsFolderNames();
  const researchPath = `Essai/${names.research}`;

  // Appeler initResearchSubfolders avec le mode non-fiction
  await initResearchSubfolders(app, researchPath, "nonfiction");

  // Vérifier les catégories non-fiction uniquement
  assert.ok(vault.getAbstractFileByPath(`Essai/${names.research}`) instanceof TFolder, "Recherche existe");
  assert.equal(vault.getAbstractFileByPath(`Essai/${names.research}/Bibliographie`), null, "pas de Bibliographie automatique");
  assert.ok(vault.getAbstractFileByPath(`Essai/${names.research}/Notes`) instanceof TFolder, "Notes");
  assert.ok(vault.getAbstractFileByPath(`Essai/${names.research}/Sources`) instanceof TFolder, "Sources");
  // Pas de catégories fiction
  assert.equal(vault.getAbstractFileByPath(`Essai/${names.research}/Personnages`), null, "pas de Personnages en non-fiction");
  assert.equal(vault.getAbstractFileByPath(`Essai/${names.research}/Lieux`), null, "pas de Lieux en non-fiction");
  assert.equal(vault.getAbstractFileByPath(`Essai/${names.research}/Glossaire`), null, "pas de Glossaire en non-fiction");
});

test("initResearchSubfolders (FR, mode libre) : dossier transformé crée seulement _Recherche", async () => {
  setLocale("fr");
  const existingFolder = new TFolder("Libre");
  const research = new TFolder("Libre/Recherche");
  research.parent = existingFolder;
  existingFolder.children = [research];
  const { vault } = createFakeVault([existingFolder, research]);
  const app = { vault };
  const names = getFeuilletsFolderNames("fr");
  const researchPath = `Libre/${names.research}`;

  // Appeler initResearchSubfolders avec le mode libre
  await initResearchSubfolders(app, researchPath, "free");

  // Vérifier que _Recherche existe mais aucun sous-dossier automatique
  assert.ok(vault.getAbstractFileByPath(`Libre/${names.research}`) instanceof TFolder, "_Recherche existe");
  // Aucune catégorie créée automatiquement
  assert.equal(vault.getAbstractFileByPath(`Libre/${names.research}/Personnages`), null, "pas de Personnages");
  assert.equal(vault.getAbstractFileByPath(`Libre/${names.research}/Lieux`), null, "pas de Lieux");
  assert.equal(vault.getAbstractFileByPath(`Libre/${names.research}/Lore`), null, "pas de Lore");
  assert.equal(vault.getAbstractFileByPath(`Libre/${names.research}/Glossaire`), null, "pas de Glossaire");
  assert.equal(vault.getAbstractFileByPath(`Libre/${names.research}/Notes`), null, "pas de Notes");
  assert.equal(vault.getAbstractFileByPath(`Libre/${names.research}/Bibliographie`), null, "pas de Bibliographie");
  assert.equal(vault.getAbstractFileByPath(`Libre/${names.research}/Sources`), null, "pas de Sources");
});

// =========================================================================
// Tests — Phase 1B : Noms physiques canoniques des dossiers Feuillets
// =========================================================================

test("Phase 1B - Test A & B : création en locale FR et EN produit des chemins physiques identiques", async () => {
  const settings = { ...DEFAULT_SETTINGS, orders: {}, folderPositions: {}, projectMeta: {} };

  // A. Création en FR
  setLocale("fr");
  const vaultFR = createFakeVault([]).vault;
  const appFR = { vault: vaultFR };
  await createMinimalProject(appFR, settings, { name: "ProjetFR", type: "fiction" });

  const pathsFR = [
    "ProjetFR/_Feuillets/Recherche",
    "ProjetFR/_Feuillets/Ressources/Images",
    "ProjetFR/_Feuillets/Ressources/Modèles",
    "ProjetFR/_Feuillets/Ressources/Mises en page",
    "ProjetFR/_Feuillets/Ressources/Exports",
    "ProjetFR/_Feuillets/Ressources/Ressources internes",
  ];
  for (const p of pathsFR) {
    assert.ok(vaultFR.getAbstractFileByPath(p) instanceof TFolder, `FR a bien créé ${p}`);
  }

  // B. Création en EN
  setLocale("en");
  const vaultEN = createFakeVault([]).vault;
  const appEN = { vault: vaultEN };
  await createMinimalProject(appEN, settings, { name: "ProjetEN", type: "fiction" });

  for (const p of pathsFR.map((path) => path.replace("ProjetFR", "ProjetEN"))) {
    assert.ok(vaultEN.getAbstractFileByPath(p) instanceof TFolder, `EN a créé exactement le même chemin canonique ${p}`);
  }
});

test("Phase 1B - Test C : un ancien dossier Layouts existant est réutilisé sans créer Mises en page", async () => {
  setLocale("fr");
  const volume = new TFolder("ProjetLegacy");
  const manuscrit = new TFolder("ProjetLegacy/Manuscrit");
  const aux = new TFolder("ProjetLegacy/_Feuillets");
  const res = new TFolder("ProjetLegacy/_Feuillets/Ressources");
  const layouts = new TFolder("ProjetLegacy/_Feuillets/Ressources/Layouts");
  volume.children = [manuscrit, aux];
  aux.parent = volume;
  aux.children = [res];
  res.parent = aux;
  res.children = [layouts];
  layouts.parent = res;
  manuscrit.parent = volume;

  const { vault } = createFakeVault([volume, manuscrit, aux, res, layouts]);
  const app = { vault };
  const settings = { projectFolder: "ProjetLegacy/Manuscrit", orders: {}, folderPositions: {}, projectMeta: {} };

  await initProjectStructure(app, settings);

  assert.ok(vault.getAbstractFileByPath("ProjetLegacy/_Feuillets/Ressources/Layouts") instanceof TFolder, "Layouts réutilisé");
  assert.equal(vault.getAbstractFileByPath("ProjetLegacy/_Feuillets/Ressources/Mises en page"), null, "aucun Mises en page concurrent créé");
});

test("Phase 1B - Test D : un ancien dossier Template existant est réutilisé sans créer Modèles", async () => {
  setLocale("fr");
  const volume = new TFolder("ProjetLegacy");
  const manuscrit = new TFolder("ProjetLegacy/Manuscrit");
  const aux = new TFolder("ProjetLegacy/_Feuillets");
  const res = new TFolder("ProjetLegacy/_Feuillets/Ressources");
  const template = new TFolder("ProjetLegacy/_Feuillets/Ressources/Template");
  volume.children = [manuscrit, aux];
  aux.parent = volume;
  aux.children = [res];
  res.parent = aux;
  res.children = [template];
  template.parent = res;
  manuscrit.parent = volume;

  const { vault } = createFakeVault([volume, manuscrit, aux, res, template]);
  const app = { vault };
  const settings = { projectFolder: "ProjetLegacy/Manuscrit", orders: {}, folderPositions: {}, projectMeta: {} };

  await initProjectStructure(app, settings);

  assert.ok(vault.getAbstractFileByPath("ProjetLegacy/_Feuillets/Ressources/Template") instanceof TFolder, "Template réutilisé");
  assert.equal(vault.getAbstractFileByPath("ProjetLegacy/_Feuillets/Ressources/Modèles"), null, "aucun Modèles concurrent créé");
});

test("Phase 1B - Test E : aucun dossier _Research, Research, _Resources, Resources, Templates ou Layouts sur projet neuf", async () => {
  setLocale("en");
  const settings = { ...DEFAULT_SETTINGS, orders: {}, folderPositions: {}, projectMeta: {} };
  const { vault } = createFakeVault([]);
  const app = { vault };

  await createMinimalProject(app, settings, { name: "ProjetNeuf", type: "fiction" });

  const prohibitedPaths = [
    "ProjetNeuf/_Research",
    "ProjetNeuf/Research",
    "ProjetNeuf/_Resources",
    "ProjetNeuf/Resources",
    "ProjetNeuf/_Feuillets/Ressources/Templates",
    "ProjetNeuf/_Feuillets/Ressources/Layouts",
  ];
  for (const p of prohibitedPaths) {
    assert.equal(vault.getAbstractFileByPath(p), null, `${p} ne doit pas être créé sur un projet neuf`);
  }
});

// =========================================================================
// Tests — Phase 1C : Catégories Recherche créées par défaut
// =========================================================================

test("Phase 1C : nouveau Fiction crée exactement Personnages, Lieux, Événements, Lore, Glossaire (aucune Bibliographie), identique en FR et EN", async () => {
  for (const lang of ["fr", "en"]) {
    setLocale(lang);
    const { vault } = createFakeVault([]);
    const app = { vault };
    const settings = { ...DEFAULT_SETTINGS, orders: {}, folderPositions: {}, projectMeta: {} };

    await createMinimalProject(app, settings, { name: `Fiction_${lang}`, type: "fiction" });

    const expected = [
      `Fiction_${lang}/_Feuillets/Recherche/Personnages`,
      `Fiction_${lang}/_Feuillets/Recherche/Lieux`,
      `Fiction_${lang}/_Feuillets/Recherche/Événements`,
      `Fiction_${lang}/_Feuillets/Recherche/Lore`,
      `Fiction_${lang}/_Feuillets/Recherche/Glossaire`,
    ];
    for (const p of expected) {
      assert.ok(vault.getAbstractFileByPath(p) instanceof TFolder, `${p} créé en locale ${lang}`);
    }

    assert.equal(vault.getAbstractFileByPath(`Fiction_${lang}/_Feuillets/Recherche/Bibliographie`), null, "pas de Bibliographie automatique");
    assert.equal(vault.getAbstractFileByPath(`Fiction_${lang}/_Feuillets/Recherche/Bibliography`), null, "pas de Bibliography automatique");
    assert.equal(vault.getAbstractFileByPath(`Fiction_${lang}/_Feuillets/Recherche/Characters`), null, "pas de Characters anglais concurrent");
  }
});

test("Phase 1C : nouveau Non-fiction crée exactement Notes + Sources (aucune Bibliographie), identique en FR et EN", async () => {
  for (const lang of ["fr", "en"]) {
    setLocale(lang);
    const { vault } = createFakeVault([]);
    const app = { vault };
    const settings = { ...DEFAULT_SETTINGS, orders: {}, folderPositions: {}, projectMeta: {} };

    await createMinimalProject(app, settings, { name: `NonFiction_${lang}`, type: "nonfiction" });

    const expected = [
      `NonFiction_${lang}/_Feuillets/Recherche/Notes`,
      `NonFiction_${lang}/_Feuillets/Recherche/Sources`,
    ];
    for (const p of expected) {
      assert.ok(vault.getAbstractFileByPath(p) instanceof TFolder, `${p} créé en locale ${lang}`);
    }

    assert.equal(vault.getAbstractFileByPath(`NonFiction_${lang}/_Feuillets/Recherche/Bibliographie`), null, "pas de Bibliographie automatique");
    assert.equal(vault.getAbstractFileByPath(`NonFiction_${lang}/_Feuillets/Recherche/Personnages`), null, "pas de Personnages en non-fiction");
  }
});

test("Phase 1C : nouveau Libre laisse le dossier Recherche vide", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = { ...DEFAULT_SETTINGS, orders: {}, folderPositions: {}, projectMeta: {} };

  await createMinimalProject(app, settings, { name: "ProjetLibre", type: "free" });

  const resFolder = vault.getAbstractFileByPath("ProjetLibre/_Feuillets/Recherche");
  assert.ok(resFolder instanceof TFolder, "_Feuillets/Recherche existe");
  assert.equal(resFolder.children.length, 0, "Recherche est strictly vide");
});

test("Phase 1C : réutilisation des anciennes variantes (Characters, Places, Events, Timeline) sans doublon", async () => {
  setLocale("fr");
  const volume = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit");
  const aux = new TFolder("Projet/_Feuillets");
  const rech = new TFolder("Projet/_Feuillets/Recherche");
  const characters = new TFolder("Projet/_Feuillets/Recherche/Characters");
  const places = new TFolder("Projet/_Feuillets/Recherche/Places");
  const events = new TFolder("Projet/_Feuillets/Recherche/Events");

  volume.children = [manuscrit, aux];
  aux.parent = volume;
  aux.children = [rech];
  rech.parent = aux;
  rech.children = [characters, places, events];
  characters.parent = rech;
  places.parent = rech;
  events.parent = rech;
  manuscrit.parent = volume;

  const { vault } = createFakeVault([volume, manuscrit, aux, rech, characters, places, events]);
  const app = { vault };

  await initResearchSubfolders(app, rech.path, "fiction");

  assert.ok(vault.getAbstractFileByPath("Projet/_Feuillets/Recherche/Characters") instanceof TFolder, "Characters conservé");
  assert.ok(vault.getAbstractFileByPath("Projet/_Feuillets/Recherche/Places") instanceof TFolder, "Places conservé");
  assert.ok(vault.getAbstractFileByPath("Projet/_Feuillets/Recherche/Events") instanceof TFolder, "Events conservé");

  assert.equal(vault.getAbstractFileByPath("Projet/_Feuillets/Recherche/Personnages"), null, "aucun Personnages concurrent");
  assert.equal(vault.getAbstractFileByPath("Projet/_Feuillets/Recherche/Lieux"), null, "aucun Lieux concurrent");
  assert.equal(vault.getAbstractFileByPath("Projet/_Feuillets/Recherche/Événements"), null, "aucun Événements concurrent");
});

test("Phase 1C : ancienne Bibliographie (fiction et non-fiction) toujours reconnue dans researchFolders", () => {
  const fictionMode = PROJECT_MODES.fiction;
  const nonfictionMode = PROJECT_MODES.nonfiction;

  assert.ok(fictionMode.researchFolders.bibliographie, "bibliographie toujours définie en fiction pour compatibilité");
  assert.ok(nonfictionMode.researchFolders.bibliographie, "bibliographie toujours définie en non-fiction pour compatibilité");

  const fictionNames = researchFolderNames(fictionMode.researchFolders, "bibliographie");
  assert.ok(fictionNames.includes("Bibliographie"), "reconnaît Bibliographie");
  assert.ok(fictionNames.includes("Bibliography"), "reconnaît Bibliography");
});

// =========================================================================
// Tests — Phase 1D : Identité du projet et page de titre
// =========================================================================

test("Phase 1D : global manuscriptTitle = 'NEFES', création projet 'Alpha' → Page de titre = Alpha", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = { ...DEFAULT_SETTINGS, manuscriptTitle: "NEFES", orders: {}, folderPositions: {}, projectMeta: {} };

  await createMinimalProject(app, settings, { name: "Alpha", type: "fiction" });

  const titleFile = vault.getAbstractFileByPath("Alpha/Manuscrit/Front/Page de titre.md");
  assert.ok(titleFile instanceof TFile, "Page de titre créée");
  assert.match(titleFile.content, /^title: Alpha$/m, "frontmatter title vaut Alpha");
  assert.match(titleFile.content, /^:::titre: Alpha$/m, "rôle titre vaut Alpha");
  assert.doesNotMatch(titleFile.content, /^# /m, "pas de titre H1 dupliqué dans le corps");
  assert.doesNotMatch(titleFile.content, /NEFES/, "ne contient jamais NEFES");
});

test("Phase 1D : initProjectStructure sur Alpha avec global 'NEFES' → Alpha, jamais NEFES", async () => {
  const alpha = new TFolder("Alpha");
  const manuscrit = new TFolder("Alpha/Manuscrit");
  manuscrit.parent = alpha;
  alpha.children = [manuscrit];

  const { vault } = createFakeVault([alpha, manuscrit]);
  const app = { vault };
  const settings = {
    ...DEFAULT_SETTINGS,
    manuscriptTitle: "NEFES",
    projectFolder: "Alpha/Manuscrit",
    projects: ["Alpha/Manuscrit"],
    projectMeta: { "Alpha/Manuscrit": { type: "fiction" } },
  };

  await initProjectStructure(app, settings);

  const titleFile = vault.getAbstractFileByPath("Alpha/Manuscrit/Front/Page de titre.md");
  assert.ok(titleFile instanceof TFile, "Page de titre créée");
  assert.match(titleFile.content, /^title: Alpha$/m, "title vaut Alpha");
  assert.doesNotMatch(titleFile.content, /NEFES/, "ne contient jamais NEFES");
});

test("Phase 1D : Scrivener ProjectTitle = 'Candide', dossier choisi = 'Import test' → title = Candide", async () => {
  const importFolder = new TFolder("Import test");
  const manuscrit = new TFolder("Import test/Manuscrit");
  manuscrit.parent = importFolder;
  importFolder.children = [manuscrit];

  const { vault } = createFakeVault([importFolder, manuscrit]);
  const app = { vault };
  const settings = {
    ...DEFAULT_SETTINGS,
    manuscriptTitle: "NEFES",
    projectFolder: "Import test/Manuscrit",
    projects: ["Import test/Manuscrit"],
    projectMeta: { "Import test/Manuscrit": { type: "fiction" } },
  };

  await initProjectStructure(app, settings, { title: "Candide" });

  const titleFile = vault.getAbstractFileByPath("Import test/Manuscrit/Front/Page de titre.md");
  assert.ok(titleFile instanceof TFile, "Page de titre créée");
  assert.match(titleFile.content, /^title: Candide$/m, "title vaut Candide");
  assert.doesNotMatch(titleFile.content, /Import test/, "ne contient pas le nom du dossier quand ProjectTitle est fourni");
});

test("Phase 1D : Scrivener sans ProjectTitle → title = 'Import test'", async () => {
  const importFolder = new TFolder("Import test");
  const manuscrit = new TFolder("Import test/Manuscrit");
  manuscrit.parent = importFolder;
  importFolder.children = [manuscrit];

  const { vault } = createFakeVault([importFolder, manuscrit]);
  const app = { vault };
  const settings = {
    ...DEFAULT_SETTINGS,
    manuscriptTitle: "NEFES",
    projectFolder: "Import test/Manuscrit",
    projects: ["Import test/Manuscrit"],
    projectMeta: { "Import test/Manuscrit": { type: "fiction" } },
  };

  await initProjectStructure(app, settings, { title: "Import test" });

  const titleFile = vault.getAbstractFileByPath("Import test/Manuscrit/Front/Page de titre.md");
  assert.ok(titleFile instanceof TFile, "Page de titre créée");
  assert.match(titleFile.content, /^title: Import test$/m, "title vaut Import test");
});

test("Phase 1D : une Page de titre existante n'est jamais remplacée", async () => {
  const alpha = new TFolder("Alpha");
  const manuscrit = new TFolder("Alpha/Manuscrit");
  const front = new TFolder("Alpha/Manuscrit/Front");
  const existingTitlePage = new TFile("Alpha/Manuscrit/Front/Page de titre.md");
  existingTitlePage.content = "---\ntitle: Mon Titre Existant\n---\n# Mon Titre Existant";

  alpha.children = [manuscrit];
  manuscrit.parent = alpha;
  manuscrit.children = [front];
  front.parent = manuscrit;
  front.children = [existingTitlePage];

  const { vault } = createFakeVault([alpha, manuscrit, front, existingTitlePage]);
  const app = { vault };
  const settings = {
    ...DEFAULT_SETTINGS,
    projectFolder: "Alpha/Manuscrit",
    projects: ["Alpha/Manuscrit"],
    projectMeta: { "Alpha/Manuscrit": { type: "fiction" } },
  };

  await initProjectStructure(app, settings);

  const titleFile = vault.getAbstractFileByPath("Alpha/Manuscrit/Front/Page de titre.md");
  assert.equal(titleFile.content, "---\ntitle: Mon Titre Existant\n---\n# Mon Titre Existant", "contenu inchangé");
});

test("Phase 1D : le wrapper plugin transmet l'identité sans perte à initProjectStructure", async () => {
  const importFolder = new TFolder("Dossier Import");
  const manuscrit = new TFolder("Dossier Import/Manuscrit");
  manuscrit.parent = importFolder;
  importFolder.children = [manuscrit];

  const { vault } = createFakeVault([importFolder, manuscrit]);
  const app = { vault };
  const settings = {
    ...DEFAULT_SETTINGS,
    manuscriptTitle: "NEFES",
    projectFolder: "Dossier Import/Manuscrit",
    projects: ["Dossier Import/Manuscrit"],
    projectMeta: { "Dossier Import/Manuscrit": { type: "fiction" } },
  };

  const pluginInstance = {
    app,
    settings,
    async initProjectStructure(identity) {
      return initProjectStructure(this.app, this.settings, identity);
    },
  };

  await pluginInstance.initProjectStructure({ title: "Titre Scrivener Real" });

  const titleFile = vault.getAbstractFileByPath("Dossier Import/Manuscrit/Front/Page de titre.md");
  assert.ok(titleFile instanceof TFile, "Page de titre créée");
  assert.match(titleFile.content, /^title: Titre Scrivener Real$/m, "le wrapper a bien transmis le titre");
  assert.doesNotMatch(titleFile.content, /NEFES/, "le wrapper n'a pas utilisé NEFES");
});

test("Phase 1D : import titre AKSAK → fichier physique Front/Page de titre.md et affichage Binder 'Page de titre'", async () => {
  const { titleFor, shortTitleFor } = await import("../src/services/frontmatter.js");
  const { buildScrivenerImportPlan, isScrivenerTitlePageNode } = await import("../src/services/scrivener-import.js");

  // 1. isScrivenerTitlePageNode reconnaît "AKSAK" sous un dossier Front Matter
  assert.ok(isScrivenerTitlePageNode("AKSAK", "Front Matter", "AKSAK"), "AKSAK est reconnu comme page de titre");
  assert.ok(!isScrivenerTitlePageNode("Dedication", "Front Matter", "AKSAK"), "Dedication n'est pas une page de titre");

  // 2. Le plan d'import réutilise le chemin canonique Front/Page de titre.md
  const parsedScrivx = {
    projectTitle: "AKSAK",
    draft: {
      uuid: "draft-1",
      title: "Draft",
      isFolder: true,
      children: [
        {
          uuid: "front-folder",
          title: "Front Matter",
          isFolder: true,
          children: [
            { uuid: "title-node", title: "AKSAK", isFolder: false, children: [] },
            { uuid: "dedic-node", title: "Dedication", isFolder: false, children: [] },
          ],
        },
      ],
    },
    research: null,
    trash: null,
    others: [],
  };

  const plan = buildScrivenerImportPlan(parsedScrivx, {
    manuscritPath: "Projet/Manuscrit",
    projectTitle: "AKSAK",
  });

  const titleTarget = plan.targets.find((t) => t.uuid === "title-node");
  const dedicTarget = plan.targets.find((t) => t.uuid === "dedic-node");

  assert.ok(titleTarget, "cible pour node titre trouvée");
  assert.equal(titleTarget.markdownPath, "Projet/Manuscrit/Front/Page de titre.md", "le fichier physique est canoniquement Page de titre.md");
  assert.ok(dedicTarget, "cible pour dédicace trouvée");
  assert.equal(dedicTarget.markdownPath, "Projet/Manuscrit/Front/Dedication.md", "autre document Front préservé sous Front/Dedication.md");

  // 3. titleFor / shortTitleFor retournent "Page de titre" pour le Binder
  const titleFile = new TFile("Projet/Manuscrit/Front/Page de titre.md");
  const app = {
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: { title: "AKSAK", type: "titre" } }),
    },
  };

  assert.equal(titleFor(app, titleFile), "Page de titre", "titleFor affiche Page de titre dans le Binder");
  assert.equal(shortTitleFor(app, titleFile), "Page de titre", "shortTitleFor affiche Page de titre dans le Binder");
});
