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
import { resolveWorkspaceCitationResources } from "../src/services/workspace-citations.js";


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

test("Export/import round-trip: preserves distinct .bib and .csl per workspace, manifest contains only relative paths", async () => {
  const { app: sourceApp, entries } = makeVaultFixture();

  const projectA = new TFolder("Project-A");
  const workA = new TFolder("Project-A/Work-A");
  const chap = new TFolder("Project-A/Work-A/Chapter");
  const scene = new TFile("Project-A/Work-A/Chapter/Scene.md");
  scene.bytes = new TextEncoder().encode("# Scene");
  const workB = new TFolder("Project-A/Work-B");
  const workBChap = new TFolder("Project-A/Work-B/Chapter");
  const workBScene = new TFile("Project-A/Work-B/Chapter/Scene.md");
  workBScene.bytes = new TextEncoder().encode("# Work-B Scene");

  const projectResearch = new TFolder("Project-A/Research");
  const projectBib = new TFile("Project-A/Research/project.bib");
  projectBib.bytes = new TextEncoder().encode("@article{p1, author={P}, year={2020}}");
  const defaultCsl = new TFile("Project-A/Research/default.csl");
  defaultCsl.bytes = new TextEncoder().encode("<style>default</style>");

  const workAResearch = new TFolder("Project-A/Work-A/Research");
  const workABib = new TFile("Project-A/Work-A/Research/workA.bib");
  workABib.bytes = new TextEncoder().encode("@article{n1, author={N}, year={2021}}");
  const workACsl = new TFile("Project-A/Work-A/Research/workA.csl");
  workACsl.bytes = new TextEncoder().encode("<style>workA</style>");

  const workBResearch = new TFolder("Project-A/Work-B/Research");
  const workBBib = new TFile("Project-A/Work-B/Research/workB.bib");
  workBBib.bytes = new TextEncoder().encode("@article{t1, author={T}, year={2022}}");
  const workBCsl = new TFile("Project-A/Work-B/Research/workB.csl");
  workBCsl.bytes = new TextEncoder().encode("<style>workB</style>");

  chap.children = [scene];
  scene.parent = chap;
  workA.children = [chap, workAResearch];
  chap.parent = workA;
  workAResearch.parent = workA;
  workAResearch.children = [workABib, workACsl];
  workABib.parent = workAResearch;
  workACsl.parent = workAResearch;

  workBChap.children = [workBScene];
  workBScene.parent = workBChap;
  workB.children = [workBChap, workBResearch];
  workBChap.parent = workB;
  workBResearch.parent = workB;
  workBResearch.children = [workBBib, workBCsl];
  workBBib.parent = workBResearch;
  workBCsl.parent = workBResearch;

  projectResearch.children = [projectBib, defaultCsl];
  projectBib.parent = projectResearch;
  defaultCsl.parent = projectResearch;

  projectA.children = [workA, workB, projectResearch];
  workA.parent = projectA;
  workB.parent = projectA;
  projectResearch.parent = projectA;

  for (const entry of [
    projectA, workA, chap, scene, workB, workBChap, workBScene,
    projectResearch, projectBib, defaultCsl,
    workAResearch, workABib, workACsl,
    workBResearch, workBBib, workBCsl,
  ]) {
    entries.set(entry.path, entry);
  }

  const sourceSettings = {
    projectFolder: "Project-A",
    projects: ["Project-A"],
    compileFileName: "Manuscript.md",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    level1Role: "chapitres",
    separator: "\n\n",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    autoRename: true,
    renamePrefix: "chapter",
    footnoteRenumberOnCompile: true,
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {
      "Project-A": {
        name: "Project-A",
        type: "fiction",
        researchFolderLinks: {
          "Project-A": "Project-A/Research",
          "Project-A/Work-A": "Project-A/Work-A/Research",
          "Project-A/Work-B": "Project-A/Work-B/Research",
        },
        citekeyBibliographyPath: "project.bib",
        citekeyCslPath: "default.csl",
        folderWorkspaces: {
          "Work-A": {
            version: 1,
            citekeyBibliographyPath: "workA.bib",
            citekeyCslPath: "workA.csl",
          },
          "Work-B": {
            version: 1,
            citekeyBibliographyPath: "workB.bib",
            citekeyCslPath: "workB.csl",
          },
        },
      },
    },
  };

  const exportPlan = await buildFeuilProjectExportPlan(
    sourceApp,
    sourceSettings,
    "2.9.0",
    "pkg-citations",
    "2026-09-10T12:00:00.000Z"
  );

  const manifestMeta = exportPlan.manifest.project.meta;
  assert.equal("pandocBibliographyPath" in manifestMeta, false, "pandocBibliographyPath must be absent from manifest");
  assert.equal(manifestMeta.citekeyBibliographyPath, "project.bib");
  assert.equal(manifestMeta.citekeyCslPath, "default.csl");
  assert.equal(manifestMeta.folderWorkspaces["Work-A"].citekeyBibliographyPath, "workA.bib");
  assert.equal(manifestMeta.folderWorkspaces["Work-A"].citekeyCslPath, "workA.csl");
  assert.equal(manifestMeta.folderWorkspaces["Work-B"].citekeyBibliographyPath, "workB.bib");
  assert.equal(manifestMeta.folderWorkspaces["Work-B"].citekeyCslPath, "workB.csl");

  // Manifest JSON must not contain absolute paths
  const manifestJson = JSON.stringify(exportPlan.manifest);
  assert.doesNotMatch(manifestJson, /"\/Users\//);
  assert.doesNotMatch(manifestJson, /"[A-Za-z]:\\\\/);

  // Package archive
  const archiveBytes = await createFeuilProjectPackage(
    exportPlan.manifest,
    exportPlan.files,
    exportPlan.directories
  );

  // Destination vault
  const { app: destApp } = makeVaultFixture(["Imports"]);
  const destSettings = {
    projectFolder: "Other",
    projects: ["Other"],
    compileFileName: "Default.md",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    level1Role: "chapitres",
    separator: "\n\n",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: true,
    autoRename: false,
    renamePrefix: "chapter",
    footnoteRenumberOnCompile: false,
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {},
  };

  const importPlan = await buildFeuilProjectImportPlan(archiveBytes);
  const importResult = await materializeFeuilProjectImport(destApp, importPlan, "Imports/Project-A");
  applyFeuilProjectImportSettings(destSettings, importResult);

  const importedProjectA = destApp.vault.getAbstractFileByPath("Imports/Project-A");
  const importedWorkA = destApp.vault.getAbstractFileByPath("Imports/Project-A/Work-A");
  const importedWorkB = destApp.vault.getAbstractFileByPath("Imports/Project-A/Work-B");

  // Post-import resolver checks:
  const rootRes = resolveWorkspaceCitationResources(destApp, destSettings, importedProjectA, null);
  assert.equal(rootRes.bibliography.relativePath, "project.bib");
  assert.equal(rootRes.bibliography.file?.path, "Imports/Project-A/Research/project.bib");
  assert.equal(rootRes.csl.relativePath, "default.csl");
  assert.equal(rootRes.csl.file?.path, "Imports/Project-A/Research/default.csl");

  const workARes = resolveWorkspaceCitationResources(destApp, destSettings, importedProjectA, importedWorkA);
  assert.equal(workARes.bibliography.relativePath, "workA.bib");
  assert.equal(workARes.bibliography.file?.path, "Imports/Project-A/Work-A/Research/workA.bib");
  assert.equal(workARes.csl.relativePath, "workA.csl");
  assert.equal(workARes.csl.file?.path, "Imports/Project-A/Work-A/Research/workA.csl");

  const workBRes = resolveWorkspaceCitationResources(destApp, destSettings, importedProjectA, importedWorkB);
  assert.equal(workBRes.bibliography.relativePath, "workB.bib");
  assert.equal(workBRes.bibliography.file?.path, "Imports/Project-A/Work-B/Research/workB.bib");
  assert.equal(workBRes.csl.relativePath, "workB.csl");
  assert.equal(workBRes.csl.file?.path, "Imports/Project-A/Work-B/Research/workB.csl");
});

test("Export: legacy pandocBibliographyPath exported as relative citekeyBibliographyPath without modifying source settings", async () => {
  const { app: sourceApp, entries } = makeVaultFixture();

  const projectA = new TFolder("Project-A");
  const chap = new TFolder("Project-A/Chapter");
  const scene = new TFile("Project-A/Chapter/Scene.md");
  scene.bytes = new TextEncoder().encode("# Scene");
  const research = new TFolder("Project-A/Research");
  const legacyBib = new TFile("Project-A/Research/legacy.bib");
  legacyBib.bytes = new TextEncoder().encode("@article{leg, author={L}, year={2018}}");

  chap.children = [scene];
  scene.parent = chap;
  research.children = [legacyBib];
  legacyBib.parent = research;
  projectA.children = [chap, research];
  chap.parent = projectA;
  research.parent = projectA;

  for (const entry of [projectA, chap, scene, research, legacyBib]) {
    entries.set(entry.path, entry);
  }

  const sourceSettings = {
    projectFolder: "Project-A",
    projects: ["Project-A"],
    compileFileName: "Manuscript.md",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    level1Role: "chapitres",
    separator: "\n\n",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    autoRename: true,
    renamePrefix: "chapter",
    footnoteRenumberOnCompile: true,
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {
      "Project-A": {
        name: "Project-A",
        type: "fiction",
        pandocBibliographyPath: "Project-A/Research/legacy.bib",
        researchFolderLinks: {
          "Project-A": "Project-A/Research",
        },
      },
    },
  };

  const snapshotBefore = JSON.stringify(sourceSettings);

  const exportPlan = await buildFeuilProjectExportPlan(
    sourceApp,
    sourceSettings,
    "2.9.0",
    "pkg-legacy",
    "2026-09-10T12:00:00.000Z"
  );

  // Manifest has converted to relative citekeyBibliographyPath
  assert.equal(exportPlan.manifest.project.meta.citekeyBibliographyPath, "legacy.bib");
  assert.equal("pandocBibliographyPath" in exportPlan.manifest.project.meta, false);

  // Source settings are strictly unmodified
  assert.equal(JSON.stringify(sourceSettings), snapshotBefore);
});

test("Export: citekeyBibliographyPath: \"\" takes precedence over valid pandocBibliographyPath", async () => {
  const { app: sourceApp, entries } = makeVaultFixture();

  const projectA = new TFolder("Project-A");
  const chap = new TFolder("Project-A/Chapter");
  const scene = new TFile("Project-A/Chapter/Scene.md");
  scene.bytes = new TextEncoder().encode("# Scene");
  const research = new TFolder("Project-A/Research");
  const legacyBib = new TFile("Project-A/Research/legacy.bib");
  legacyBib.bytes = new TextEncoder().encode("@article{leg, author={L}, year={2018}}");

  chap.children = [scene];
  scene.parent = chap;
  research.children = [legacyBib];
  legacyBib.parent = research;
  projectA.children = [chap, research];
  chap.parent = projectA;
  research.parent = projectA;

  for (const entry of [projectA, chap, scene, research, legacyBib]) {
    entries.set(entry.path, entry);
  }

  const sourceSettings = {
    projectFolder: "Project-A",
    projects: ["Project-A"],
    compileFileName: "Manuscript.md",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    level1Role: "chapitres",
    separator: "\n\n",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    autoRename: true,
    renamePrefix: "chapter",
    footnoteRenumberOnCompile: true,
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {
      "Project-A": {
        name: "Project-A",
        type: "fiction",
        citekeyBibliographyPath: "",
        pandocBibliographyPath: "Project-A/Research/legacy.bib",
        researchFolderLinks: {
          "Project-A": "Project-A/Research",
        },
      },
    },
  };

  const snapshotBefore = JSON.stringify(sourceSettings);

  const exportPlan = await buildFeuilProjectExportPlan(
    sourceApp,
    sourceSettings,
    "2.9.0",
    "pkg-disabled-priority",
    "2026-09-10T12:00:00.000Z"
  );

  assert.equal(exportPlan.manifest.project.meta.citekeyBibliographyPath, "", "explicit empty string takes precedence over valid pandocBibliographyPath");
  assert.equal("pandocBibliographyPath" in exportPlan.manifest.project.meta, false);
  assert.equal(JSON.stringify(sourceSettings), snapshotBefore, "source settings must remain strictly unmodified");
});

test("Export: invalid legacy pandocBibliographyPath is not converted to citekeyBibliographyPath", async () => {
  const { app: sourceApp, entries } = makeVaultFixture();

  const projectA = new TFolder("Project-A");
  const chap = new TFolder("Project-A/Chapter");
  const scene = new TFile("Project-A/Chapter/Scene.md");
  scene.bytes = new TextEncoder().encode("# Scene");
  const research = new TFolder("Project-A/Research");
  const legacyBib = new TFile("Project-A/Research/legacy.bib");
  legacyBib.bytes = new TextEncoder().encode("@article{leg, author={L}, year={2018}}");

  chap.children = [scene];
  scene.parent = chap;
  research.children = [legacyBib];
  legacyBib.parent = research;
  projectA.children = [chap, research];
  chap.parent = projectA;
  research.parent = projectA;

  for (const entry of [projectA, chap, scene, research, legacyBib]) {
    entries.set(entry.path, entry);
  }

  const sourceSettings = {
    projectFolder: "Project-A",
    projects: ["Project-A"],
    compileFileName: "Manuscript.md",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    level1Role: "chapitres",
    separator: "\n\n",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    autoRename: true,
    renamePrefix: "chapter",
    footnoteRenumberOnCompile: true,
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {
      "Project-A": {
        name: "Project-A",
        type: "fiction",
        pandocBibliographyPath: "Project-A/Research/../Research/legacy.bib",
        researchFolderLinks: {
          "Project-A": "Project-A/Research",
        },
      },
    },
  };

  const exportPlan = await buildFeuilProjectExportPlan(
    sourceApp,
    sourceSettings,
    "2.9.0",
    "pkg-invalid-legacy",
    "2026-09-10T12:00:00.000Z"
  );

  assert.equal(exportPlan.manifest.project.meta.citekeyBibliographyPath, undefined, "invalid legacy path does not create citekeyBibliographyPath");
  assert.equal("pandocBibliographyPath" in exportPlan.manifest.project.meta, false);
});

test("Export/import round-trip: sibling historical research outside adopted project root is packaged and imported as linked external research", async () => {
  const { app: sourceApp, entries } = makeVaultFixture();

  const parent = new TFolder("Parent");
  const projectA = new TFolder("Parent/Project-A");
  projectA.parent = parent;
  const chap = new TFolder("Parent/Project-A/Chapter");
  const scene = new TFile("Parent/Project-A/Chapter/Scene.md");
  scene.bytes = new TextEncoder().encode("# Scene");
  chap.children = [scene];
  scene.parent = chap;
  projectA.children = [chap];
  chap.parent = projectA;

  // Sibling folder outside Project-A: Parent/Research
  const siblingResearch = new TFolder("Parent/Research");
  siblingResearch.parent = parent;
  const bibFile = new TFile("Parent/Research/sibling.bib");
  bibFile.bytes = new TextEncoder().encode("@article{sib, author={S}, year={2019}}");
  siblingResearch.children = [bibFile];
  bibFile.parent = siblingResearch;

  parent.children = [projectA, siblingResearch];

  for (const entry of [parent, projectA, chap, scene, siblingResearch, bibFile]) {
    entries.set(entry.path, entry);
  }

  const sourceSettings = {
    projectFolder: "Parent/Project-A",
    projects: ["Parent/Project-A"],
    compileFileName: "Manuscript.md",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    level1Role: "chapitres",
    separator: "\n\n",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    autoRename: true,
    renamePrefix: "chapter",
    footnoteRenumberOnCompile: true,
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    pandocBibliographyPath: "Parent/Research/sibling.bib",
    projectMeta: {
      "Parent/Project-A": {
        name: "Project-A",
        type: "fiction",
        pandocBibliographyPath: "Parent/Research/sibling.bib",
      },
    },
  };

  const snapshotBefore = JSON.stringify(sourceSettings);

  const exportPlan = await buildFeuilProjectExportPlan(
    sourceApp,
    sourceSettings,
    "2.9.0",
    "pkg-sibling",
    "2026-09-10T12:00:00.000Z"
  );

  assert.equal(JSON.stringify(sourceSettings), snapshotBefore, "source settings must remain strictly unmodified");

  const manifestJson = JSON.stringify(exportPlan.manifest);
  assert.ok(!manifestJson.includes("Parent/"), "manifest JSON must not contain source vault ancestor paths");
  assert.ok(!manifestJson.includes("/Parent"), "manifest JSON must not contain root-slashed paths");

  function assertNoAbsolutePaths(obj, path = "manifest") {
    if (typeof obj === "string") {
      assert.ok(!obj.startsWith("/"), `Manifest string at ${path} must not start with /: ${obj}`);
      assert.ok(!obj.startsWith("\\"), `Manifest string at ${path} must not start with \\: ${obj}`);
      assert.ok(!/^[a-zA-Z]:/.test(obj), `Manifest string at ${path} must not start with drive letter: ${obj}`);
      assert.ok(!obj.includes("Parent/"), `Manifest string at ${path} must not include source vault path: ${obj}`);
    } else if (Array.isArray(obj)) {
      obj.forEach((item, index) => assertNoAbsolutePaths(item, `${path}[${index}]`));
    } else if (obj !== null && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        assert.ok(!k.startsWith("/"), `Manifest key at ${path} must not start with /: ${k}`);
        assertNoAbsolutePaths(v, `${path}.${k}`);
      }
    }
  }
  assertNoAbsolutePaths(exportPlan.manifest);

  const externalLinks = exportPlan.manifest.project.linkedResearch.filter((l) => l.target.kind === "external");
  assert.ok(externalLinks.length > 0, "sibling research linked as external");
  const externalFileKeys = Object.keys(exportPlan.files).filter((k) => k.startsWith("external/research/"));
  assert.ok(externalFileKeys.some((k) => k.endsWith("sibling.bib")), "sibling.bib is included in export package files");

  // Round-trip into destination vault
  const archiveBytes = await createFeuilProjectPackage(
    exportPlan.manifest,
    exportPlan.files,
    exportPlan.directories
  );

  const { app: destApp } = makeVaultFixture(["Imports"]);
  const destSettings = {
    projectFolder: "Other",
    projects: ["Other"],
    compileFileName: "Default.md",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    level1Role: "chapitres",
    separator: "\n\n",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: true,
    autoRename: false,
    renamePrefix: "chapter",
    footnoteRenumberOnCompile: false,
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {},
  };

  const importPlan = await buildFeuilProjectImportPlan(archiveBytes);
  const importResult = await materializeFeuilProjectImport(destApp, importPlan, "Imports/Project-A");
  applyFeuilProjectImportSettings(destSettings, importResult);

  const importedProject = destApp.vault.getAbstractFileByPath("Imports/Project-A");
  assert.ok(importedProject instanceof TFolder, "imported project folder exists");

  const res = resolveWorkspaceCitationResources(destApp, destSettings, importedProject, null);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.relativePath, "sibling.bib");
  assert.ok(res.bibliography.file?.path.endsWith("sibling.bib"));
});

test("Export/import round-trip: preserves explicit bibliography disablement across export and import", async () => {
  const { app: sourceApp, entries } = makeVaultFixture();

  const projectA = new TFolder("Project-A");
  const workA = new TFolder("Project-A/Work-A");
  const chap = new TFolder("Project-A/Work-A/Chapter");
  const scene = new TFile("Project-A/Work-A/Chapter/Scene.md");
  scene.bytes = new TextEncoder().encode("# Scene");

  const research = new TFolder("Project-A/Research");
  const bib = new TFile("Project-A/Research/project.bib");
  bib.bytes = new TextEncoder().encode("@article{p1, author={P}, year={2020}}");

  chap.children = [scene];
  scene.parent = chap;
  workA.children = [chap];
  chap.parent = workA;
  research.children = [bib];
  bib.parent = research;
  projectA.children = [workA, research];
  workA.parent = projectA;
  research.parent = projectA;

  for (const entry of [projectA, workA, chap, scene, research, bib]) {
    entries.set(entry.path, entry);
  }

  const sourceSettings = {
    projectFolder: "Project-A",
    projects: ["Project-A"],
    compileFileName: "Manuscript.md",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    level1Role: "chapitres",
    separator: "\n\n",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    autoRename: true,
    renamePrefix: "chapter",
    footnoteRenumberOnCompile: true,
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {
      "Project-A": {
        name: "Project-A",
        type: "fiction",
        researchFolderLinks: {
          "Project-A": "Project-A/Research",
        },
        // Explicitly disabled at project level
        citekeyBibliographyPath: "",
        folderWorkspaces: {
          "Work-A": {
            version: 1,
            // Explicitly disabled at workspace level
            citekeyBibliographyPath: "",
          },
        },
      },
    },
  };

  const exportPlan = await buildFeuilProjectExportPlan(
    sourceApp,
    sourceSettings,
    "2.9.0",
    "pkg-disabled",
    "2026-09-10T12:00:00.000Z"
  );

  assert.equal(exportPlan.manifest.project.meta.citekeyBibliographyPath, "", "project-level explicit disablement preserved in manifest");
  assert.equal(exportPlan.manifest.project.meta.folderWorkspaces["Work-A"].citekeyBibliographyPath, "", "workspace-level explicit disablement preserved in manifest");

  const archiveBytes = await createFeuilProjectPackage(
    exportPlan.manifest,
    exportPlan.files,
    exportPlan.directories
  );

  const { app: destApp } = makeVaultFixture(["Imports"]);
  const destSettings = {
    projectFolder: "Other",
    projects: ["Other"],
    compileFileName: "Default.md",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    level1Role: "chapitres",
    separator: "\n\n",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: true,
    autoRename: false,
    renamePrefix: "chapter",
    footnoteRenumberOnCompile: false,
    orders: {},
    folderPositions: {},
    folderGoals: {},
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
    projectMeta: {},
  };

  const importPlan = await buildFeuilProjectImportPlan(archiveBytes);
  const importResult = await materializeFeuilProjectImport(destApp, importPlan, "Imports/Project-A");
  applyFeuilProjectImportSettings(destSettings, importResult);

  const importedProject = destApp.vault.getAbstractFileByPath("Imports/Project-A");
  const importedWorkA = destApp.vault.getAbstractFileByPath("Imports/Project-A/Work-A");

  const rootRes = resolveWorkspaceCitationResources(destApp, destSettings, importedProject, null);
  assert.equal(rootRes.bibliography.status, "disabled", "root bibliography remains disabled after import");
  assert.equal(rootRes.bibliography.file, null);

  const workARes = resolveWorkspaceCitationResources(destApp, destSettings, importedProject, importedWorkA);
  assert.equal(workARes.bibliography.status, "disabled", "workspace bibliography remains disabled after import");
  assert.equal(workARes.bibliography.file, null);
});
