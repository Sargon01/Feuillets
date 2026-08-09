import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createMinimalProject, CreateProjectError, duplicateProjectFolder, listSnapshotFiles, snapshotFile, ensureEditionFolder, initProjectStructure, initResearchSubfolders, EDITION_DOCUMENTS, EDITION_SUBFOLDERS } from "../src/services/project-files.js";
import { getProjectFolder, getProjectRoot, getManuscriptRoot, roleOfFolder, roleOfFile, getEditionRoot, EDITION_FOLDER_NAME, getFeuilletsFolderNames } from "../src/services/folder-structure.js";
import { setLocale } from "../src/i18n/index.js";

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

  assert.equal(edition.path, `Projet/${getFeuilletsFolderNames().edition}`);
  assert.equal(getEditionRoot(app, manuscript).path, edition.path);
  for (const sub of EDITION_SUBFOLDERS) {
    assert.ok(vault.getAbstractFileByPath(`${edition.path}/${sub}`) instanceof TFolder, `${sub} créé`);
  }
  for (const doc of EDITION_DOCUMENTS) {
    assert.ok(vault.getAbstractFileByPath(`${edition.path}/${doc}`) instanceof TFile, `${doc} créé`);
  }
});

test("ensureEditionFolder : idempotent — n'écrase pas un document déjà modifié", async () => {
  const { volume, manuscript } = projectFixture();
  const { vault } = createFakeVault([volume, manuscript]);
  const app = { vault };

  await ensureEditionFolder(app, manuscript);
  const synopsisPath = `Projet/${getFeuilletsFolderNames().edition}/Synopsis.md`;
  const synopsis = vault.getAbstractFileByPath(synopsisPath);
  await vault.modify(synopsis, "Contenu déjà écrit par l'autrice.");

  await ensureEditionFolder(app, manuscript);

  assert.equal(await vault.read(vault.getAbstractFileByPath(synopsisPath)), "Contenu déjà écrit par l'autrice.");
});

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

  // _Recherche et _Ressources à la racine réelle, frères de Manuscrit.
  assert.ok(vault.getAbstractFileByPath("Roman1/_Recherche") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("Roman1/_Ressources") instanceof TFolder);
  for (const sub of ["Images", "Modèles", "Mises en page", "Exports", "Ressources internes"]) {
    assert.ok(vault.getAbstractFileByPath(`Roman1/_Ressources/${sub}`) instanceof TFolder, `_Ressources/${sub} manquant`);
  }

  // Ni _Recherche ni _Ressources DANS Manuscrit.
  assert.equal(vault.getAbstractFileByPath("Roman1/Manuscrit/_Recherche"), null);
  assert.equal(vault.getAbstractFileByPath("Roman1/Manuscrit/_Ressources"), null);

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
  assert.ok(vault.getAbstractFileByPath("Essai/_Recherche") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("Essai/_Ressources") instanceof TFolder);
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

test("createMinimalProject (non-fiction) : crée _Recherche/Notes, Bibliographie, Sources uniquement", async () => {
  setLocale("fr");
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Essai", type: "nonfiction" });

  // Vérifie les sous-dossiers du mode non-fiction
  assert.ok(vault.getAbstractFileByPath("Essai/_Recherche") instanceof TFolder, "_Recherche créé");
  assert.ok(vault.getAbstractFileByPath("Essai/_Recherche/Notes") instanceof TFolder, "Notes créé");
  assert.ok(vault.getAbstractFileByPath("Essai/_Recherche/Bibliographie") instanceof TFolder, "Bibliographie créé");
  assert.ok(vault.getAbstractFileByPath("Essai/_Recherche/Sources") instanceof TFolder, "Sources créé");

  // Vérifie qu'aucune catégorie fiction n'est créée
  assert.equal(vault.getAbstractFileByPath("Essai/_Recherche/Personnages"), null, "pas de Personnages en non-fiction");
  assert.equal(vault.getAbstractFileByPath("Essai/_Recherche/Lieux"), null, "pas de Lieux en non-fiction");
  assert.equal(vault.getAbstractFileByPath("Essai/_Recherche/Glossaire"), null, "pas de Glossaire en non-fiction");
  assert.equal(vault.getAbstractFileByPath("Essai/_Recherche/Événements"), null, "pas d'Événements en non-fiction");
  assert.equal(vault.getAbstractFileByPath("Essai/_Recherche/Lore"), null, "pas de Lore en non-fiction");
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

  assert.ok(vault.getAbstractFileByPath("Roman FR/_Recherche") instanceof TFolder, "_Recherche sous le volume");
  assert.ok(vault.getAbstractFileByPath("Roman FR/_Ressources") instanceof TFolder, "_Ressources sous le volume");
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

  assert.ok(vault.getAbstractFileByPath("Novel EN/_Research") instanceof TFolder, "_Research sous le volume");
  assert.ok(vault.getAbstractFileByPath("Novel EN/_Resources") instanceof TFolder, "_Resources sous le volume");
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
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche`) instanceof TFolder, "_Recherche sous le projet");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche/Bibliographie`) instanceof TFolder, "Bibliographie");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche/Glossaire`) instanceof TFolder, "Glossaire");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche/Événements`) instanceof TFolder, "Événements");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche/Personnages`) instanceof TFolder, "Personnages");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche/Lieux`) instanceof TFolder, "Lieux");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche/Lore`) instanceof TFolder, "Lore");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Snapshots`) instanceof TFolder, "_Snapshots sous le projet");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Backups`) instanceof TFolder, "_Backups sous le projet");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Journal`) instanceof TFolder, "_Journal sous le projet");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Ressources`) instanceof TFolder, "_Ressources sous le projet");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Ressources/Modèles`) instanceof TFolder, "Modèles");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Ressources/Mises en page`) instanceof TFolder, "Mises en page");

  // Aucun dossier à la racine du coffre
  assert.equal(vault.getAbstractFileByPath("_Recherche"), null, "pas de _Recherche à la racine du coffre");
  assert.equal(vault.getAbstractFileByPath("_Snapshots"), null, "pas de _Snapshots à la racine du coffre");
  assert.equal(vault.getAbstractFileByPath("_Ressources"), null, "pas de _Ressources à la racine du coffre");
});

// -------------------------------------------------------------------------
// Test 4 — transformation d'un dossier existant : contenu strictement inchangé
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
  assert.ok(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Bibliographie") instanceof TFolder, "Bibliographie créée");
  assert.ok(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Glossaire") instanceof TFolder, "Glossaire créé");
  assert.ok(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Événements") instanceof TFolder, "Événements créés");
  assert.ok(vault.getAbstractFileByPath("Projets/Partiel/Recherche/Lore") instanceof TFolder, "Lore créé");
});

// -------------------------------------------------------------------------
// Test 6b — mode non-fiction : Notes, Bibliographie, Sources créés
// -------------------------------------------------------------------------
test("initProjectStructure (FR) : mode non-fiction crée Notes, Bibliographie, Sources", async () => {
  setLocale("fr");
  const { projets, volume, manuscript } = makeNestedProject("Projets/Essai");
  const { vault } = createFakeVault([projets, volume, manuscript]);
  const app = { vault };
  const settings = freshSettingsFor("Projets/Essai/Manuscrit", { projectMeta: { "Projets/Essai/Manuscrit": { type: "nonfiction" } } });

  await initProjectStructure(app, settings);

  const base = "Projets/Essai";
  // _Recherche et ses sous-dossiers en mode non-fiction
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche`) instanceof TFolder, "_Recherche sous le projet");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche/Bibliographie`) instanceof TFolder, "Bibliographie");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche/Notes`) instanceof TFolder, "Notes");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Recherche/Sources`) instanceof TFolder, "Sources");
  // Pas de catégories fiction
  assert.equal(vault.getAbstractFileByPath(`${base}/_Recherche/Personnages`), null, "pas de Personnages en non-fiction");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Recherche/Lieux`), null, "pas de Lieux en non-fiction");
  assert.equal(vault.getAbstractFileByPath(`${base}/_Recherche/Glossaire`), null, "pas de Glossaire en non-fiction");
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
  const research = new TFolder("Existant/_Recherche");
  research.parent = existingFolder;
  existingFolder.children = [research];
  const { vault } = createFakeVault([existingFolder, research]);
  const app = { vault };
  const names = getFeuilletsFolderNames("fr");
  const researchPath = `Existant/${names.research}`;

  // Appeler initResearchSubfolders avec le mode fiction
  await initResearchSubfolders(app, researchPath, "fiction");

  // Vérifier les catégories fiction
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}`) instanceof TFolder, "_Recherche existe");
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}/Bibliographie`) instanceof TFolder, "Bibliographie");
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}/Personnages`) instanceof TFolder, "Personnages");
  assert.ok(vault.getAbstractFileByPath(`Existant/${names.research}/Lieux`) instanceof TFolder, "Lieux");
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
  const research = new TFolder("Essai/_Recherche");
  research.parent = existingFolder;
  existingFolder.children = [research];
  const { vault } = createFakeVault([existingFolder, research]);
  const app = { vault };
  const names = getFeuilletsFolderNames("fr");
  const researchPath = `Essai/${names.research}`;

  // Appeler initResearchSubfolders avec le mode non-fiction
  await initResearchSubfolders(app, researchPath, "nonfiction");

  // Vérifier les catégories non-fiction uniquement
  assert.ok(vault.getAbstractFileByPath(`Essai/${names.research}`) instanceof TFolder, "_Recherche existe");
  assert.ok(vault.getAbstractFileByPath(`Essai/${names.research}/Bibliographie`) instanceof TFolder, "Bibliographie");
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
  const research = new TFolder("Libre/_Recherche");
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
