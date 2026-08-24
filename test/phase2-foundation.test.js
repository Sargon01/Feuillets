import test from "node:test";
import assert from "node:assert/strict";
import { TFolder, TFile, normalizePath } from "obsidian";
import { createMinimalProject, snapshotFile, duplicateProjectFolder, ensureEditionFolder } from "../src/services/project-files.js";
import { createProjectBackup } from "../src/services/project-backup.js";
import { ensureDayEntry } from "../src/services/journal.js";

function createFakeVault(files = []) {
  const map = new Map();
  for (const f of files) map.set(f.path, f);
  return {
    vault: {
      getAbstractFileByPath: (path) => map.get(path) || null,
      createFolder: async (path) => {
        const p = normalizePath(path);
        const name = p.split("/").pop();
        const parentPath = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
        const tf = new TFolder(p);
        tf.name = name;
        if (parentPath) {
          const parent = map.get(parentPath) || new TFolder(parentPath);
          parent.name = parentPath.split("/").pop();
          tf.parent = parent;
          map.set(parentPath, parent);
        }
        map.set(p, tf);
        return tf;
      },
      create: async (path, content = "") => {
        const p = normalizePath(path);
        const name = p.split("/").pop();
        const parentPath = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
        const tf = new TFile(p);
        tf.name = name;
        tf.content = content;
        if (parentPath) {
          const parent = map.get(parentPath) || new TFolder(parentPath);
          parent.name = parentPath.split("/").pop();
          tf.parent = parent;
          map.set(parentPath, parent);
        }
        map.set(p, tf);
        return tf;
      },
      read: async (_file) => _file.content || "",
      readBinary: async (_file) => new ArrayBuffer(0),
      createBinary: async (path, _data) => {
        const p = normalizePath(path);
        const tf = new TFile(p);
        map.set(p, tf);
        return tf;
      },
      modify: async (file, content) => {
        file.content = content;
      },
    },
    map,
  };
}

function freshSettings(overrides = {}) {
  return {
    wordGoal: 1500,
    projectFolder: "",
    projects: [],
    projectMeta: {},
    journalFolder: "",
    orders: {},
    folderPositions: {},
    ...overrides,
  };
}

test("Phase 2 — 1. Nouveau fiction : bootstrap minimal canonique", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Projet Fiction", type: "fiction" });

  const base = "Projet Fiction";
  assert.ok(vault.getAbstractFileByPath(`${base}/Manuscrit`) instanceof TFolder, "Manuscrit");
  assert.ok(vault.getAbstractFileByPath(`${base}/Manuscrit/Front/Page de titre.md`) instanceof TFile, "Page de titre");
  assert.ok(vault.getAbstractFileByPath(`${base}/Manuscrit/Chapitre 1/Scène 1.md`) instanceof TFile, "Scène 1");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche`) instanceof TFolder, "_Feuillets/Recherche");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources`) instanceof TFolder, "_Feuillets/Ressources");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Images`) instanceof TFolder, "Images");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Modèles`) instanceof TFolder, "Modèles");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Mises en page`) instanceof TFolder, "Mises en page");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Exports`) instanceof TFolder, "Exports");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources/Ressources internes`) instanceof TFolder, "Ressources internes");
});

test("Phase 2 — 2. Nouveau non-fiction : bootstrap minimal canonique", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Essai", type: "nonfiction" });

  const base = "Essai";
  assert.ok(vault.getAbstractFileByPath(`${base}/Manuscrit/Partie 1/Chapitre 1.md`) instanceof TFile, "Partie 1 / Chapitre 1");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Notes`) instanceof TFolder, "Notes");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche/Sources`) instanceof TFolder, "Sources");
});

test("Phase 2 — 3. Nouveau libre : Recherche vide + Ressources", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Recueil Libre", type: "free" });

  const base = "Recueil Libre";
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Recherche`) instanceof TFolder, "Recherche");
  assert.ok(vault.getAbstractFileByPath(`${base}/_Feuillets/Ressources`) instanceof TFolder, "Ressources");
  assert.equal(vault.getAbstractFileByPath(`${base}/Manuscrit/Front`), null, "pas de Front");
});

test("Phase 2 — 5. Aucun dossier technique lazy créé avant usage", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  await createMinimalProject(app, settings, { name: "Test Lazy", type: "fiction" });

  const base = "Test Lazy";
  for (const name of ["Edition", "Journal", "Snapshots", "Backups", "Versions", "Sortie"]) {
    assert.equal(vault.getAbstractFileByPath(`${base}/_Feuillets/${name}`), null, `pas de ${name} au bootstrap`);
  }
});

test("Phase 2 — 6. Snapshot / Backup / Journal / Edition / Versions : création canonique au premier usage", async () => {
  const project = new TFolder("MonProjet");
  project.name = "MonProjet";
  const manuscript = new TFolder("MonProjet/Manuscrit");
  manuscript.name = "Manuscrit";
  const sceneFile = new TFile("MonProjet/Manuscrit/Scene.md");
  sceneFile.name = "Scene.md";
  sceneFile.content = "Contenu scène";
  manuscript.parent = project;
  sceneFile.parent = manuscript;

  const { vault } = createFakeVault([project, manuscript, sceneFile]);
  const app = { vault };
  const settings = freshSettings({ projectFolder: "MonProjet/Manuscrit" });

  // 1. Snapshot au premier usage
  await snapshotFile(app, sceneFile, manuscript);
  assert.ok(vault.getAbstractFileByPath("MonProjet/_Feuillets/Snapshots") instanceof TFolder, "Snapshots créé au 1er usage");

  // 2. Backup au premier usage
  await createProjectBackup(app, manuscript, {});
  assert.ok(vault.getAbstractFileByPath("MonProjet/_Feuillets/Backups") instanceof TFolder, "Backups créé au 1er usage");

  // 3. Journal au premier usage
  await ensureDayEntry(app, settings, new Date());
  assert.ok(vault.getAbstractFileByPath("MonProjet/_Feuillets/Journal") instanceof TFolder, "Journal créé au 1er usage");

  // 4. Edition au premier usage
  await ensureEditionFolder(app, manuscript);
  assert.ok(vault.getAbstractFileByPath("MonProjet/_Feuillets/Edition") instanceof TFolder, "Edition créé au 1er usage");

  // 5. Versions au premier usage
  await duplicateProjectFolder(app, manuscript, "v1", settings);
  assert.ok(vault.getAbstractFileByPath("MonProjet/_Feuillets/Versions") instanceof TFolder, "Versions créé au 1er usage");
});

test("Phase 2 — 8. Aucun chemin legacy utilisé pour une NOUVELLE écriture", async () => {
  const project = new TFolder("RomanNeuf");
  project.name = "RomanNeuf";
  const manuscript = new TFolder("RomanNeuf/Manuscrit");
  manuscript.name = "Manuscrit";
  manuscript.parent = project;

  const { vault } = createFakeVault([project, manuscript]);
  const app = { vault };

  await ensureEditionFolder(app, manuscript);
  assert.equal(vault.getAbstractFileByPath("RomanNeuf/_Edition"), null, "pas d'écriture dans _Edition");
  assert.ok(vault.getAbstractFileByPath("RomanNeuf/_Feuillets/Edition") instanceof TFolder, "écrit dans _Feuillets/Edition");
});

test("Phase 2 — 9. Projet canonique : aucun doublon legacy créé", async () => {
  const project = new TFolder("ProjetCanonique");
  project.name = "ProjetCanonique";
  const manuscript = new TFolder("ProjetCanonique/Manuscrit");
  manuscript.name = "Manuscrit";
  const aux = new TFolder("ProjetCanonique/_Feuillets");
  aux.name = "_Feuillets";
  const rech = new TFolder("ProjetCanonique/_Feuillets/Recherche");
  rech.name = "Recherche";
  const ress = new TFolder("ProjetCanonique/_Feuillets/Ressources");
  ress.name = "Ressources";
  manuscript.parent = project;
  aux.parent = project;
  rech.parent = aux;
  ress.parent = aux;

  const { vault } = createFakeVault([project, manuscript, aux, rech, ress]);
  const app = { vault };

  await snapshotFile(app, new TFile("ProjetCanonique/Manuscrit/Scene.md"), manuscript);

  assert.equal(vault.getAbstractFileByPath("ProjetCanonique/_Research"), null, "aucun _Research créé");
  assert.equal(vault.getAbstractFileByPath("ProjetCanonique/_Snapshots"), null, "aucun _Snapshots créé");
});

test("Phase 2 — 10. Dossier adopted imbriqué : rien ne doit être créé chez son parent", async () => {
  const parent = new TFolder("ProjetsDossier");
  parent.name = "ProjetsDossier";
  const adopted = new TFolder("ProjetsDossier/ProjetAdopte");
  adopted.name = "ProjetAdopte";
  adopted.parent = parent;

  const { vault } = createFakeVault([parent, adopted]);
  const app = { vault };

  await ensureEditionFolder(app, adopted);

  assert.ok(vault.getAbstractFileByPath("ProjetsDossier/ProjetAdopte/_Feuillets/Edition") instanceof TFolder, "créé sous le dossier adopted");
  assert.equal(vault.getAbstractFileByPath("ProjetsDossier/_Feuillets"), null, "rien chez le parent");
  assert.equal(vault.getAbstractFileByPath("ProjetsDossier/_Edition"), null, "rien chez le parent");
});
