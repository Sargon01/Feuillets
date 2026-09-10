import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { buildFeuilProjectExportPlan } from "../src/services/feuil-project-export.js";
import {
  createFeuilProjectPackage,
  validateFeuilProjectManifest,
  FeuilProjectPackageError,
} from "../src/services/feuil-project-package.js";
import { buildFeuilProjectImportPlan } from "../src/services/feuil-project-import-plan.js";
import { materializeFeuilProjectImport } from "../src/services/feuil-project-import.js";
import { applyFeuilProjectImportSettings } from "../src/services/feuil-project-import-settings.js";
import { resolveEditorialRoot } from "../src/services/editorial-roots.js";
import { effectiveComposition, createCompositionBinding } from "../src/services/ouvrage-composition.js";

function makeVaultFixture(initialPaths = []) {
  const entries = new Map();
  const root = new TFolder("");
  entries.set("", root);

  const ensureAncestors = (path) => {
    const segments = path.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      const parentPath = segments.slice(0, index).join("/");
      if (!entries.has(parentPath)) {
        const grandParentPath = segments.slice(0, index - 1).join("/");
        const grandParent = entries.get(grandParentPath);
        const folder = new TFolder(parentPath);
        folder.parent = grandParent;
        if (grandParent) grandParent.children.push(folder);
        entries.set(parentPath, folder);
      }
    }
  };

  for (const path of initialPaths) ensureAncestors(path);

  const vault = {
    getAbstractFileByPath: (path) => entries.get(path) || null,
    createFolder: async (path) => {
      if (entries.has(path)) throw new Error(`Dossier déjà existant: ${path}`);
      ensureAncestors(path);
      const parentPath = path.split("/").slice(0, -1).join("/");
      const parent = entries.get(parentPath);
      const folder = new TFolder(path);
      folder.parent = parent;
      if (parent) parent.children.push(folder);
      entries.set(path, folder);
      return folder;
    },
    createBinary: async (path, data) => {
      ensureAncestors(path);
      const parentPath = path.split("/").slice(0, -1).join("/");
      const parent = entries.get(parentPath);
      const file = new TFile(path);
      file.bytes = new Uint8Array(data);
      file.parent = parent;
      if (parent) parent.children.push(file);
      entries.set(path, file);
      return file;
    },
    readBinary: async (file) => file.bytes ? file.bytes.buffer.slice(0) : new ArrayBuffer(0),
  };

  const app = {
    vault,
    metadataCache: {
      getFileCache: () => ({ frontmatter: {} }),
    },
    fileManager: {
      trashFile: async (folder) => {
        for (const path of [...entries.keys()]) {
          if (path === folder.path || path.startsWith(`${folder.path}/`)) {
            entries.delete(path);
          }
        }
      },
    },
  };

  return { app, entries };
}

function createSourceWarpiFixture() {
  const { app, entries } = makeVaultFixture();

  // Arborescence :
  // WARPI
  // WARPI/NEFES
  // WARPI/NEFES/Chapitre 1
  // WARPI/NEFES/Chapitre 1/Scene.md
  // WARPI/AUTRE_TOME
  const warpi = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const nefesChap = new TFolder("WARPI/NEFES/Chapitre 1");
  const nefesScene = new TFile("WARPI/NEFES/Chapitre 1/Scene.md");
  nefesScene.bytes = new TextEncoder().encode("# Scene 1");
  const autreTome = new TFolder("WARPI/AUTRE_TOME");

  nefesChap.children = [nefesScene];
  nefesScene.parent = nefesChap;

  nefes.children = [nefesChap];
  nefesChap.parent = nefes;

  warpi.children = [nefes, autreTome];
  nefes.parent = warpi;
  autreTome.parent = warpi;

  entries.set("WARPI", warpi);
  entries.set("WARPI/NEFES", nefes);
  entries.set("WARPI/NEFES/Chapitre 1", nefesChap);
  entries.set("WARPI/NEFES/Chapitre 1/Scene.md", nefesScene);
  entries.set("WARPI/AUTRE_TOME", autreTome);

  const nefesLocalComposition = {
    fileName: "NEFES-Special.md",
    level1Role: "chapitres",
    chapterNumbering: "aucune",
    sceneNumbering: "continue",
    autoRename: false,
    renamePrefix: "scene",
    folderTitles: false,
    chapterTitles: true,
    sceneTitles: true,
    separator: "\n***\n",
    footnoteRenumberOnCompile: false,
    summary: true,
    tables: false,
    toc: true,
    bibliography: true,
    annexes: false,
  };

  const sourceSettings = {
    projectFolder: "WARPI",
    projects: ["WARPI"],
    level1Role: "parties",
    compileFileName: "WARPI-Manuscrit.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: false,
    separator: "\n\n* * *\n\n",
    footnoteRenumberOnCompile: true,
    chapterNumbering: "parPartie",
    sceneNumbering: "hier",
    autoRename: true,
    renamePrefix: "partie",
    orders: {
      WARPI: ["NEFES", "AUTRE_TOME"],
      "WARPI/NEFES": ["Chapitre 1"],
    },
    folderPositions: {
      WARPI: 1,
      "WARPI/NEFES": 2,
    },
    folderGoals: {
      WARPI: 80000,
      "WARPI/NEFES": 40000,
    },
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {
      WARPI: {
        name: "WARPI",
        type: "fiction",
        composition: {
          summary: true,
          tables: false,
          toc: true,
          bibliography: false,
          annexes: true,
        },
        folderWorkspaces: {
          NEFES: {
            wordGoal: 45000,
            ouvrage: {
              version: 1,
              composition: nefesLocalComposition,
            },
          },
          AUTRE_TOME: {
            ouvrage: {
              version: 1,
            },
          },
        },
      },
    },
  };

  return { app, sourceSettings, warpi, nefes, autreTome, nefesLocalComposition };
}

test("Aller-retour .feuil complet : transport fidèle des ouvrages, compositions et héritage", async () => {
  const {
    app: sourceApp,
    sourceSettings,
    warpi: sourceWarpi,
    nefesLocalComposition,
  } = createSourceWarpiFixture();

  // 1. Export plan
  const exportPlan = await buildFeuilProjectExportPlan(
    sourceApp,
    sourceSettings,
    "2.9.0",
    "pkg-warpi",
    "2026-09-10T12:00:00.000Z"
  );

  // Assertion 1 : manifest.project.meta.folderWorkspaces contient NEFES et AUTRE_TOME
  const exportedMeta = exportPlan.manifest.project.meta;
  assert.ok(exportedMeta.folderWorkspaces, "folderWorkspaces doit être présent dans project.meta");
  assert.ok("NEFES" in exportedMeta.folderWorkspaces, "NEFES doit être présent avec sa clé relative");
  assert.ok("AUTRE_TOME" in exportedMeta.folderWorkspaces, "AUTRE_TOME doit être présent avec sa clé relative");

  // Assertion 2 : NEFES conserve ouvrage.version et les 16 champs de sa composition locale
  const nefesExported = exportedMeta.folderWorkspaces["NEFES"];
  assert.equal(nefesExported.ouvrage.version, 1);
  assert.deepEqual(nefesExported.ouvrage.composition, nefesLocalComposition);

  // Assertion 3 : Les autres réglages de workspace (wordGoal) sont conservés
  assert.equal(nefesExported.wordGoal, 45000);

  // Assertion 4 : manifest.project.composition contient exactement les 16 valeurs effectives de WARPI
  const warpiEffectiveComposition = effectiveComposition(sourceSettings, sourceWarpi, sourceWarpi);
  assert.deepEqual(exportPlan.manifest.project.composition, warpiEffectiveComposition);
  assert.equal(exportPlan.manifest.project.composition.fileName, "WARPI-Manuscrit.md");
  assert.equal(exportPlan.manifest.project.composition.chapterNumbering, "parPartie");
  assert.equal(exportPlan.manifest.project.composition.separator, "\n\n* * *\n\n");
  assert.equal(exportPlan.manifest.project.composition.summary, true);
  assert.equal(exportPlan.manifest.project.composition.annexes, true);

  // Assertion 9 : cloneMeta ne copie jamais projectComposition dans manifest.project.meta
  assert.equal("projectComposition" in exportedMeta, false);

  // 2. Génération de l'archive .feuil
  const archiveBytes = await createFeuilProjectPackage(
    exportPlan.manifest,
    exportPlan.files,
    exportPlan.directories
  );

  // 3. Lecture archive & plan d'import
  const importPlan = await buildFeuilProjectImportPlan(archiveBytes);
  assert.equal(importPlan.manifest.project.name, "WARPI");
  assert.deepEqual(importPlan.manifest.project.composition, warpiEffectiveComposition);

  // 4. Coffre de destination avec réglages par défaut différents
  const { app: destApp } = makeVaultFixture(["Imports"]);
  const destSettings = {
    projectFolder: "AncienProjet",
    projects: ["AncienProjet"],
    level1Role: "chapitres",
    compileFileName: "Default.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: true,
    separator: "\n---\n",
    footnoteRenumberOnCompile: false,
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    autoRename: false,
    renamePrefix: "chapitre",
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {
      AncienProjet: {
        name: "AncienProjet",
        type: "fiction",
      },
    },
  };

  const initialDestSettingsSnapshot = JSON.stringify({
    compileFileName: destSettings.compileFileName,
    separator: destSettings.separator,
    chapterNumbering: destSettings.chapterNumbering,
    sceneNumbering: destSettings.sceneNumbering,
    level1Role: destSettings.level1Role,
  });

  // 5. Matérialisation & application des réglages d'import
  const importResult = await materializeFeuilProjectImport(destApp, importPlan, "Imports/WARPI");
  applyFeuilProjectImportSettings(destSettings, importResult);

  // Assertion 5 : Après import sous Imports/WARPI
  const importedWarpi = destApp.vault.getAbstractFileByPath("Imports/WARPI");
  const importedNefes = destApp.vault.getAbstractFileByPath("Imports/WARPI/NEFES");
  const importedAutreTome = destApp.vault.getAbstractFileByPath("Imports/WARPI/AUTRE_TOME");
  assert.ok(importedWarpi instanceof TFolder, "Imports/WARPI doit exister");
  assert.ok(importedNefes instanceof TFolder, "Imports/WARPI/NEFES doit exister");
  assert.ok(importedAutreTome instanceof TFolder, "Imports/WARPI/AUTRE_TOME doit exister");

  // resolveEditorialRoot reconnaît NEFES comme ouvrage
  const resolvedNefes = resolveEditorialRoot(destSettings, importedWarpi, importedNefes);
  assert.equal(resolvedNefes.path, "Imports/WARPI/NEFES");

  // effectiveComposition pour NEFES renvoie sa composition locale
  const nefesImportedComp = effectiveComposition(destSettings, importedWarpi, importedNefes);
  assert.deepEqual(nefesImportedComp, nefesLocalComposition);

  // effectiveComposition pour AUTRE_TOME renvoie la composition exportée de WARPI
  const autreTomeImportedComp = effectiveComposition(destSettings, importedWarpi, importedAutreTome);
  assert.deepEqual(autreTomeImportedComp, warpiEffectiveComposition);

  // AUTRE_TOME reste hérité : aucune ouvrage.composition ne lui est ajoutée
  const autreTomeConfig = destSettings.projectMeta["Imports/WARPI"].folderWorkspaces["AUTRE_TOME"];
  assert.equal(autreTomeConfig.ouvrage.composition, undefined);

  // Les réglages préexistants de destination restent strictement inchangés
  const afterDestSettingsSnapshot = JSON.stringify({
    compileFileName: destSettings.compileFileName,
    separator: destSettings.separator,
    chapterNumbering: destSettings.chapterNumbering,
    sceneNumbering: destSettings.sceneNumbering,
    level1Role: destSettings.level1Role,
  });
  assert.equal(afterDestSettingsSnapshot, initialDestSettingsSnapshot);

  // Assertion 6 : Modification post-import via le binding global de WARPI
  let saveCount = 0;
  let refreshCount = 0;
  const destHost = {
    settings: destSettings,
    app: destApp,
    getProjectFolder: () => importedWarpi,
    saveSettings: async () => { saveCount += 1; },
    refreshBinderViews: () => { refreshCount += 1; },
  };

  const bindingWarpi = createCompositionBinding(destHost, importedWarpi, importedWarpi);
  assert.equal(bindingWarpi.isOuvrage, false);
  await bindingWarpi.update({ separator: "\n===NOUVEAU-SEPARATEUR===\n" });
  await bindingWarpi.update({ summary: false });

  // Seuls projectComposition.separator et projectComposition.summary changent dans le projet
  const warpiMetaAfter = destSettings.projectMeta["Imports/WARPI"];
  assert.equal(warpiMetaAfter.projectComposition.separator, "\n===NOUVEAU-SEPARATEUR===\n");
  assert.equal(warpiMetaAfter.projectComposition.summary, false);

  // Les réglages globaux de destination restent intacts (aucun effet de bord historique)
  assert.equal(destSettings.separator, "\n---\n");
  assert.equal(destSettings.projectMeta["AncienProjet"].generatedIncluded?.summary, undefined);

  // AUTRE_TOME hérite dynamiquement de ces nouvelles valeurs sans avoir été matérialisé
  const autreTomeDynamicComp = effectiveComposition(destSettings, importedWarpi, importedAutreTome);
  assert.equal(autreTomeDynamicComp.separator, "\n===NOUVEAU-SEPARATEUR===\n");
  assert.equal(autreTomeDynamicComp.summary, false);
  assert.equal(warpiMetaAfter.folderWorkspaces["AUTRE_TOME"].ouvrage.composition, undefined);
  assert.ok(saveCount >= 2, "saveSettings doit avoir été appelé");
  assert.ok(refreshCount >= 2, "refreshBinderViews doit avoir été appelé");
});

test("Archive V1 sans project.composition reste importable et ne crée pas projectComposition", async () => {
  const { app: sourceApp, sourceSettings } = createSourceWarpiFixture();
  const exportPlan = await buildFeuilProjectExportPlan(
    sourceApp,
    sourceSettings,
    "2.9.0",
    "pkg-v1",
    "2026-09-10T12:00:00.000Z"
  );

  // Simule une archive antérieure V1 sans le champ composition
  delete exportPlan.manifest.project.composition;

  const archiveBytes = await createFeuilProjectPackage(
    exportPlan.manifest,
    exportPlan.files,
    exportPlan.directories
  );

  const importPlan = await buildFeuilProjectImportPlan(archiveBytes);
  assert.equal(importPlan.manifest.project.composition, undefined);

  const { app: destApp } = makeVaultFixture(["Imports"]);
  const destSettings = {
    projectFolder: "Dest",
    projects: ["Dest"],
    level1Role: "chapitres",
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {},
  };

  const importResult = await materializeFeuilProjectImport(destApp, importPlan, "Imports/V1Project");
  applyFeuilProjectImportSettings(destSettings, importResult);

  // projectComposition n'est pas créé
  assert.equal(destSettings.projectMeta["Imports/V1Project"].projectComposition, undefined);
});

test("Manifeste .feuil avec composition invalide est rejeté", () => {
  const validManifest = {
    format: "feuil",
    version: 1,
    packageId: "pkg-inv",
    createdAt: "2026-09-10T12:00:00.000Z",
    createdByVersion: "2.9.0",
    project: {
      name: "Invalide",
      rootKind: "adopted",
      manuscriptPath: ".",
      structure: { level1Role: "parties" },
      meta: {},
      pathSettings: { orders: {}, folderPositions: {}, folderGoals: {} },
      narrativeState: { placeholders: {}, origins: {}, resolved: [] },
      linkedResearch: [],
      composition: {
        fileName: "Doc.md",
        level1Role: "inconnu", // invalide
        chapterNumbering: "continu",
        sceneNumbering: "hier",
        autoRename: true,
        renamePrefix: "ch",
        folderTitles: true,
        chapterTitles: true,
        sceneTitles: true,
        separator: "\n\n",
        footnoteRenumberOnCompile: true,
        summary: true,
        tables: true,
        toc: true,
        bibliography: true,
        annexes: true,
      },
    },
  };

  assert.throws(() => validateFeuilProjectManifest(validManifest), FeuilProjectPackageError);

  // Invalide car champ manquant (15 au lieu de 16)
  const incompleteManifest = JSON.parse(JSON.stringify(validManifest));
  incompleteManifest.project.composition.level1Role = "parties";
  delete incompleteManifest.project.composition.annexes;
  assert.throws(() => validateFeuilProjectManifest(incompleteManifest), FeuilProjectPackageError);
});

test("cloneMeta ne copie jamais projectComposition dans manifest.project.meta", async () => {
  const { app, sourceSettings } = createSourceWarpiFixture();
  // On simule que WARPI a déjà un projectComposition dans ses projectMeta
  sourceSettings.projectMeta["WARPI"].projectComposition = {
    fileName: "Exported.md",
    level1Role: "parties",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    autoRename: true,
    renamePrefix: "chapitre",
    folderTitles: true,
    chapterTitles: true,
    sceneTitles: true,
    separator: "\n\n",
    footnoteRenumberOnCompile: true,
    summary: true,
    tables: true,
    toc: true,
    bibliography: true,
    annexes: true,
  };

  const plan = await buildFeuilProjectExportPlan(app, sourceSettings, "2.9.0", "pkg-meta", "2026-09-10T12:00:00.000Z");
  assert.equal("projectComposition" in plan.manifest.project.meta, false);
});
