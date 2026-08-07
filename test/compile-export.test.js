import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile, activePresetConfig, getOutputFolder, listCompiledFilePaths, projectMetaFor } from "../src/services/compile-export.js";

test("compile : respecte l'ordre, les pages Front et compile: false", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/Front");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const titlePage = new TFile("Projet/Manuscrit/Front/Page de titre.md", "---\ntitle: Mon livre\ntype: titre\n---\n:::titre: Mon livre\n");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "---\ntitle: Départ\n---\nPremier texte.");
  const skipped = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md", "---\ntitle: Secret\ncompile: false\n---\nTexte exclu.");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [front, chapter];
  front.parent = manuscript;
  chapter.parent = manuscript;
  front.children = [titlePage];
  chapter.children = [first, skipped];
  titlePage.parent = front;
  first.parent = chapter;
  skipped.parent = chapter;

  const { vault } = createFakeVault([volume, manuscript, front, chapter, titlePage, first, skipped]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([
    [titlePage.path, { title: "Mon livre", type: "titre", compile: true }],
    [first.path, { title: "Départ", compile: true }],
    [skipped.path, { title: "Secret", compile: false }],
  ]);
  const app = {
    vault,
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: frontmatter.get(file.path) || {} };
      },
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: [front.name, chapter.name] },
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const result = await compile(app, settings);

  assert.ok(result);
  assert.match(result.manuscript, /FEUILLETS-FPROLE:titre/);
  assert.match(result.manuscript, /# Départ/);
  assert.match(result.manuscript, /Premier texte\./);
  assert.doesNotMatch(result.manuscript, /Texte exclu/);
  assert.equal(result.segments.length, 3);
  assert.ok(vault.getAbstractFileByPath("Projet/_Sortie/Manuscrit.md"));
});

test("compile contextuelle : une portée Feuillet n'exporte que le fichier demandé", async () => {
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre");
  const first = new TFile("Projet/Manuscrit/Chapitre/Un.md", "Premier.");
  const second = new TFile("Projet/Manuscrit/Chapitre/Deux.md", "Deuxième.");
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [first, second];
  first.parent = chapter;
  second.parent = chapter;

  const { vault } = createFakeVault([manuscript, chapter, first, second]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    compileFileName: "Portée.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const result = await compile(app, settings, second.path);
  assert.ok(result);
  assert.equal(result.manuscript, "Deuxième.");
  assert.deepEqual(result.segments.map((segment) => segment.path), [second.path]);
});

test("compile : deux feuillets utilisant tous deux [^1] ne collisionnent pas, et sont renumérotés en continu", async () => {
  const volume = new TFolder("Roman");
  const manuscript = new TFolder("Roman/Manuscrit");
  const chap1 = new TFolder("Roman/Manuscrit/Chapitre 1");
  const chap2 = new TFolder("Roman/Manuscrit/Chapitre 2");
  const scene1 = new TFile(
    "Roman/Manuscrit/Chapitre 1/Scène 1.md",
    "---\ntitle: Départ\n---\nUn fait notable[^1].\n\n[^1]: Source du chapitre 1."
  );
  const scene2 = new TFile(
    "Roman/Manuscrit/Chapitre 2/Scène 1.md",
    "---\ntitle: Suite\n---\nUn autre fait[^1].\n\n[^1]: Source du chapitre 2."
  );
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [chap1, chap2];
  chap1.parent = manuscript;
  chap2.parent = manuscript;
  chap1.children = [scene1];
  chap2.children = [scene2];
  scene1.parent = chap1;
  scene2.parent = chap2;

  const { vault } = createFakeVault([volume, manuscript, chap1, chap2, scene1, scene2]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([
    [scene1.path, { title: "Départ", compile: true }],
    [scene2.path, { title: "Suite", compile: true }],
  ]);
  const app = {
    vault,
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: [chap1.name, chap2.name] },
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const result = await compile(app, settings);

  assert.ok(result);
  // Jamais deux définitions [^1] distinctes dans le document compilé : la
  // collision entre fichiers doit avoir été résolue par le renamespaçage.
  const defOccurrences = result.manuscript.match(/^\[\^1\]:/gm) || [];
  assert.equal(defOccurrences.length, 1);
  // Renumérotées en continu (réglage par défaut) : 1 puis 2, jamais 1 et 1.
  assert.match(result.manuscript, /notable\[\^1\]/);
  assert.match(result.manuscript, /autre fait\[\^2\]/);
  assert.match(result.manuscript, /\[\^1\]: Source du chapitre 1\./);
  assert.match(result.manuscript, /\[\^2\]: Source du chapitre 2\./);
});

test("compile : la renumérotation ne modifie jamais les fichiers sources", async () => {
  const volume = new TFolder("Roman");
  const manuscript = new TFolder("Roman/Manuscrit");
  const scene = new TFile(
    "Roman/Manuscrit/Scène 1.md",
    "---\ntitle: Scène\n---\nUn fait[^9].\n\n[^9]: Une source."
  );
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [scene];
  scene.parent = manuscript;

  const { vault } = createFakeVault([volume, manuscript, scene]);
  vault.cachedRead = vault.read;
  const originalContent = scene.content;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: { title: "Scène", compile: true } }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  await compile(app, settings);

  assert.equal(scene.content, originalContent);
  assert.match(scene.content, /\[\^9\]/);
});

test("activePresetConfig : renvoie le preset de base quand activePreset = -1", () => {
  const settings = {
    insertFolderTitles: true,
    insertTitles: false,
    insertSceneTitles: true,
    separator: "\n\n---\n\n",
    compileFileName: "Custom.md",
    activePreset: -1,
    compilePresets: [],
  };

  const cfg = activePresetConfig(settings);

  assert.equal(cfg.name, "Réglages par défaut");
  assert.equal(cfg.folderTitles, true);
  assert.equal(cfg.chapterTitles, false);
  assert.equal(cfg.sceneTitles, true);
  assert.equal(cfg.separator, "\n\n---\n\n");
  assert.equal(cfg.fileName, "Custom.md");
});

test("activePresetConfig : fusionne le preset actif par-dessus le preset de base", () => {
  const settings = {
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: false,
    separator: "\n\n",
    compileFileName: "Base.md",
    activePreset: 0,
    compilePresets: [
      {
        name: "Mon preset",
        folderTitles: false,
        sceneTitles: true,
        customField: "extra",
      },
    ],
  };

  const cfg = activePresetConfig(settings);

  assert.equal(cfg.name, "Mon preset");
  assert.equal(cfg.folderTitles, false); // du preset
  assert.equal(cfg.chapterTitles, true); // du base
  assert.equal(cfg.sceneTitles, true); // du preset
  assert.equal(cfg.separator, "\n\n"); // du base (pas dans preset)
  assert.equal(cfg.fileName, "Base.md"); // du base (pas dans preset)
  assert.equal(cfg.customField, "extra"); // ajouté par le preset
});

test("activePresetConfig : index invalide retombe sur le preset de base", () => {
  const settings = {
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    compileFileName: "Base.md",
    activePreset: 5, // n'existe pas
    compilePresets: [{ name: "Seul" }],
  };

  const cfg = activePresetConfig(settings);

  assert.equal(cfg.name, "Réglages par défaut");
});

test("getOutputFolder : structure conventionnelle — _Sortie est un frère de Manuscrit", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;

  const { vault } = createFakeVault([volume, manuscript]);
  const app = { vault };

  const settings = { projectFolder: manuscript.path };

  const folder = await getOutputFolder(app, settings);

  assert.ok(folder);
  assert.equal(folder.path, "Projet/_Sortie");
  assert.ok(vault.getAbstractFileByPath("Projet/_Sortie"));
});

test("getOutputFolder : projet libre (pas de dossier Manuscrit) — _Sortie est un enfant direct du projet", async () => {
  const project = new TFolder("MonProjet");
  const chapter1 = new TFolder("MonProjet/Chapitre 1");
  const chapter2 = new TFolder("MonProjet/Chapitre 2");
  project.children = [chapter1, chapter2];
  chapter1.parent = project;
  chapter2.parent = project;

  const { vault } = createFakeVault([project, chapter1, chapter2]);
  const app = { vault };

  const settings = { projectFolder: project.path };

  const folder = await getOutputFolder(app, settings);

  assert.ok(folder);
  assert.equal(folder.path, "MonProjet/_Sortie");
  assert.ok(vault.getAbstractFileByPath("MonProjet/_Sortie"));
});

test("getOutputFolder : renvoie null si pas de dossier projet", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = { projectFolder: "Inexistant" };

  const folder = await getOutputFolder(app, settings);

  assert.equal(folder, null);
});

test("listCompiledFilePaths : liste les chemins dans l'ordre, exclut compile:false", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const scene1 = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "");
  const scene2 = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md", "");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [scene1, scene2];
  scene1.parent = chapter;
  scene2.parent = chapter;

  const { vault } = createFakeVault([volume, manuscript, chapter, scene1, scene2]);
  const frontmatter = new Map([
    [scene1.path, { compile: true }],
    [scene2.path, { compile: false }],
  ]);
  const app = {
    vault,
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: frontmatter.get(file.path) || {} };
      },
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: [chapter.name] },
  };

  const paths = listCompiledFilePaths(app, settings);

  assert.equal(paths.length, 1);
  assert.equal(paths[0], scene1.path);
});

test("listCompiledFilePaths : renvoie [] si pas de dossier projet", () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = { projectFolder: "Inexistant" };

  const paths = listCompiledFilePaths(app, settings);

  assert.deepEqual(paths, []);
});

test("projectMetaFor : renvoie les métas du projet s'il existe", () => {
  const settings = {
    projectMeta: {
      "Mon/Projet": { name: "Mon Projet", author: "Auteur", type: "fiction" },
    },
  };
  const folder = { path: "Mon/Projet" };

  const meta = projectMetaFor(settings, folder);

  assert.equal(meta.name, "Mon Projet");
  assert.equal(meta.author, "Auteur");
});

test("projectMetaFor : renvoie {} si pas de dossier ou pas de meta", () => {
  const settings = { projectMeta: {} };

  assert.deepEqual(projectMetaFor(settings, null), {});
  assert.deepEqual(projectMetaFor(settings, { path: "Autre" }), {});
});

// ─── Tests d'émission de titres de dossiers selon la portée ──────────────────

test("compile portée file : aucun titre de dossier n'est émis", async () => {
  const manuscript = new TFolder("R/Manuscrit");
  const chap = new TFolder("R/Manuscrit/Chapitre");
  const sceneA = new TFile("R/Manuscrit/Chapitre/A.md", "Texte A.");
  const sceneB = new TFile("R/Manuscrit/Chapitre/B.md", "Texte B.");
  manuscript.children = [chap];
  chap.parent = manuscript;
  chap.children = [sceneA, sceneB];
  sceneA.parent = chap;
  sceneB.parent = chap;

  const { vault } = createFakeVault([manuscript, chap, sceneA, sceneB]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    compileFileName: "Out.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const result = await compile(app, settings, sceneA.path);
  assert.ok(result);
  // Aucun titre markdown de niveau dossier (# Chapitre) ne doit apparaître
  assert.doesNotMatch(result.manuscript, /^#+\s+Chapitre/m);
});

test("compile portée folder : aucun dossier frère n'émet de titre", async () => {
  const manuscript = new TFolder("R/Manuscrit");
  const chapA = new TFolder("R/Manuscrit/ChapA");
  const chapB = new TFolder("R/Manuscrit/ChapB");
  const sceneA = new TFile("R/Manuscrit/ChapA/S1.md", "Texte A.");
  const sceneB = new TFile("R/Manuscrit/ChapB/S2.md", "Texte B.");
  manuscript.children = [chapA, chapB];
  chapA.parent = manuscript;
  chapB.parent = manuscript;
  chapA.children = [sceneA];
  chapB.children = [sceneB];
  sceneA.parent = chapA;
  sceneB.parent = chapB;

  const { vault } = createFakeVault([manuscript, chapA, chapB, sceneA, sceneB]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: ["ChapA", "ChapB"] },
    compileFileName: "Out.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  // Compiler uniquement ChapA
  const result = await compile(app, settings, chapA.path);
  assert.ok(result);
  // Le titre de ChapA doit apparaître (dossier cible retenu)
  assert.match(result.manuscript, /^#+\s+ChapA/m);
  // Le titre de ChapB (dossier frère) ne doit PAS apparaître
  assert.doesNotMatch(result.manuscript, /^#+\s+ChapB/m);
});

test("compile portée selection : aucun dossier hors sélection n'émet de titre", async () => {
  const manuscript = new TFolder("R/Manuscrit");
  const chapA = new TFolder("R/Manuscrit/ChapA");
  const chapB = new TFolder("R/Manuscrit/ChapB");
  const sceneA = new TFile("R/Manuscrit/ChapA/S1.md", "Texte A.");
  const sceneB = new TFile("R/Manuscrit/ChapB/S2.md", "Texte B.");
  manuscript.children = [chapA, chapB];
  chapA.parent = manuscript;
  chapB.parent = manuscript;
  chapA.children = [sceneA];
  chapB.children = [sceneB];
  sceneA.parent = chapA;
  sceneB.parent = chapB;

  const { vault } = createFakeVault([manuscript, chapA, chapB, sceneA, sceneB]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  // On importe compile-scope pour créer la portée sélection
  const { createSelectionScope } = await import("../src/services/compile-scope.js");
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: ["ChapA", "ChapB"] },
    compileFileName: "Out.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const scope = createSelectionScope(manuscript.path, [sceneA.path]);
  const result = await compile(app, settings, null, scope);
  assert.ok(result);
  // ChapA doit apparaître (ancêtre du fichier retenu)
  assert.match(result.manuscript, /^#+\s+ChapA/m);
  // ChapB ne doit PAS apparaître (hors sélection)
  assert.doesNotMatch(result.manuscript, /^#+\s+ChapB/m);
});

test("compile : dossier sans fichier retenu dans fileSet n'émet aucun titre (portée folder)", async () => {
  // Ce test vérifie que lorsque la portée est folder=ChapA, ChapB (dossier
  // frère) n'est pas dans fileSet et ne produit donc aucun titre.
  const manuscript = new TFolder("R/Manuscrit");
  const chapA = new TFolder("R/Manuscrit/ChapA");
  const chapB = new TFolder("R/Manuscrit/ChapB");
  const sceneA = new TFile("R/Manuscrit/ChapA/S1.md", "Texte A.");
  const sceneB = new TFile("R/Manuscrit/ChapB/S2.md", "Texte B.");
  manuscript.children = [chapA, chapB];
  chapA.parent = manuscript;
  chapB.parent = manuscript;
  chapA.children = [sceneA];
  chapB.children = [sceneB];
  sceneA.parent = chapA;
  sceneB.parent = chapB;

  const { vault } = createFakeVault([manuscript, chapA, chapB, sceneA, sceneB]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: ["ChapA", "ChapB"] },
    compileFileName: "Out.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  // Portée folder=ChapA : ChapB est absent du fileSet
  const result = await compile(app, settings, chapA.path);
  assert.ok(result);
  // ChapA est dans la portée : son titre doit apparaître
  assert.match(result.manuscript, /^#+\s+ChapA/m);
  // ChapB n'est pas dans la portée : son titre NE DOIT PAS apparaître
  assert.doesNotMatch(result.manuscript, /^#+\s+ChapB/m);
});

test("compile portée project : tous les dossiers émettent leurs titres (comportement inchangé)", async () => {
  const manuscript = new TFolder("R/Manuscrit");
  const chapA = new TFolder("R/Manuscrit/ChapA");
  const chapB = new TFolder("R/Manuscrit/ChapB");
  const sceneA = new TFile("R/Manuscrit/ChapA/S1.md", "Texte A.");
  const sceneB = new TFile("R/Manuscrit/ChapB/S2.md", "Texte B.");
  manuscript.children = [chapA, chapB];
  chapA.parent = manuscript;
  chapB.parent = manuscript;
  chapA.children = [sceneA];
  chapB.children = [sceneB];
  sceneA.parent = chapA;
  sceneB.parent = chapB;

  const { vault } = createFakeVault([manuscript, chapA, chapB, sceneA, sceneB]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: ["ChapA", "ChapB"] },
    compileFileName: "Out.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  // Portée projet par défaut (scopePath = null)
  const result = await compile(app, settings);
  assert.ok(result);
  // Les deux dossiers doivent émettre leurs titres
  assert.match(result.manuscript, /^#+\s+ChapA/m);
  assert.match(result.manuscript, /^#+\s+ChapB/m);
});

test("compile : le fichier de sortie est écrit dans <projectRoot>/_Sortie", async () => {
  const manuscript = new TFolder("R/Manuscrit");
  const scene = new TFile("R/Manuscrit/S.md", "Bonjour.");
  manuscript.children = [scene];
  scene.parent = manuscript;

  const { vault } = createFakeVault([manuscript, scene]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const result = await compile(app, settings);
  assert.ok(result);
  // Le chemin de sortie doit être dans <projectRoot>/_Sortie
  assert.equal(result.outPath, "R/Manuscrit/_Sortie/Manuscrit.md");
  assert.ok(vault.getAbstractFileByPath("R/Manuscrit/_Sortie/Manuscrit.md"));
});

test("compile : { writeOutput: false } ne pose aucun fichier et garde la page de titre en segments", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/Front");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const titlePage = new TFile("Projet/Manuscrit/Front/Page de titre.md", "---\ntype: titre\n---\n:::titre: Mon livre\n");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "Premier texte.");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [front, chapter];
  front.parent = manuscript;
  chapter.parent = manuscript;
  front.children = [titlePage];
  chapter.children = [first];
  titlePage.parent = front;
  first.parent = chapter;

  const { vault } = createFakeVault([volume, manuscript, front, chapter, titlePage, first]);
  vault.cachedRead = vault.read;

  /* La compilation doit être réalisée EN MÉMOIRE : aucun create, modify ni
     createFolder ne peut avoir lieu, donc _Sortie n'est jamais posé. */
  let writes = 0;
  const origCreate = vault.create.bind(vault);
  const origModify = vault.modify.bind(vault);
  const origCreateFolder = vault.createFolder.bind(vault);
  vault.create = async (...args) => { writes++; return origCreate(...args); };
  vault.modify = async (...args) => { writes++; return origModify(...args); };
  vault.createFolder = async (...args) => { writes++; return origCreateFolder(...args); };

  const app = {
    vault,
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: file === titlePage ? { type: "titre", compile: true } : {} };
      },
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const result = await compile(app, settings, null, null, null, { writeOutput: false });

  assert.ok(result);
  assert.equal(writes, 0, "aucune écriture (create/modify/createFolder) ne doit avoir lieu");
  assert.equal(result.outPath, "", "sans écriture, le chemin de sortie reste vide");
  assert.ok(vault.getAbstractFileByPath("Projet/_Sortie") === null, "_Sortie n'est jamais créé");
  /* La page de titre doit rester un segment Front — c'est ce segment qui
     permet à l'Aperçu et à l'export de la styler comme une vraie page, au
     lieu de la laisser en Markdown brut. */
  const titreSeg = result.segments.find((s) => s.frontType === "titre");
  assert.ok(titreSeg, "la page de titre reste un segment Front dans la compilation en mémoire");
  assert.match(result.manuscript, /Mon livre/);
});

// ─── Tests exportWithScope ────────────────────────────────────────────────────
// DOM minimal partagé par les tests des formats binaires (epub/docx/odt).
// Reproduit ici conformément à la convention du dépôt (pas de helper partagé).
// Les tests PDF vérifient uniquement que la branche pdf est atteinte sans
// créer un faux .md — exportPdf est desktop-only et ne crée pas de fichier
// via vault, donc aucune assertion sur le binaire.

function makeEl(tag, textContent = "") {
  const el = {
    tagName: tag.toUpperCase(),
    _text: textContent,
    _attrs: new Map(),
    parentElement: null,
    children: [],
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; },
    set textContent(v) { this.children = []; this._text = v; },
    get childNodes() {
      if (this.children.length) return this.children;
      if (this._text) return [{ nodeType: 3, nodeValue: this._text, textContent: this._text }];
      return [];
    },
    get nodeType() { return 1; },
    get attributes() { return Array.from(this._attrs, ([name, value]) => ({ name, value })); },
    get className() { return this._attrs.get("class") || ""; },
    get classList() {
      const self = this;
      return { contains: (name) => (self._attrs.get("class") || "").split(/\s+/).includes(name) };
    },
    get innerHTML() { return this.children.length ? this.children.map((c) => c.outerHTML).join("") : this._text; },
    get outerHTML() {
      const attrs = Array.from(this._attrs, ([k, v]) => ` ${k}="${v}"`).join("");
      return `<${tag.toLowerCase()}${attrs}>${this.innerHTML}</${tag.toLowerCase()}>`;
    },
    setAttribute(name, value) { this._attrs.set(name, String(value)); },
    getAttribute(name) { return this._attrs.get(name) ?? null; },
    appendChild(child) { if (child.remove) child.remove(); child.parentElement = this; this.children.push(child); return child; },
    prepend(child) { if (child.remove) child.remove(); child.parentElement = this; this.children.unshift(child); },
    after(sibling) {
      if (!this.parentElement) return;
      const i = this.parentElement.children.indexOf(this);
      this.parentElement.children.splice(i + 1, 0, sibling);
      sibling.parentElement = this.parentElement;
    },
    remove() {
      if (!this.parentElement) return;
      const i = this.parentElement.children.indexOf(this);
      if (i >= 0) this.parentElement.children.splice(i, 1);
      this.parentElement = null;
    },
    cloneNode(deep) {
      const c = makeEl(tag, this._text);
      for (const [k, v] of this._attrs) c.setAttribute(k, v);
      if (deep) for (const child of this.children) c.appendChild(child.cloneNode(true));
      return c;
    },
    querySelectorAll(sel) {
      const found = [];
      const visit = (node) => {
        if (node === el) { for (const child of node.children || []) visit(child); return; }
        const t = node.tagName?.toLowerCase() || "";
        const cls = node.getAttribute?.("class") || "";
        if (sel.startsWith(".") && cls.split(/\s+/).includes(sel.slice(1))) found.push(node);
        else if (t === sel.toLowerCase()) found.push(node);
        for (const child of node.children || []) visit(child);
      };
      visit(el);
      return found;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
  };
  return el;
}

function installMinimalDom() {
  const prev = { document: globalThis.document, Node: globalThis.Node, XMLSerializer: globalThis.XMLSerializer };
  globalThis.document = {
    createElement: (tag) => makeEl(tag),
    createTextNode: (t) => ({ nodeType: 3, nodeValue: t, textContent: t, get outerHTML() { return t; }, cloneNode() { return this; }, remove() {} }),
    createElementNS: (_ns, tag) => makeEl(tag),
  };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.XMLSerializer = class { serializeToString(n) { return n?.outerHTML ?? String(n?.textContent ?? ""); } };
  return () => Object.assign(globalThis, prev);
}

function makeExportFixture() {
  const manuscript = new TFolder("EW/Manuscrit");
  const chap = new TFolder("EW/Manuscrit/Chapitre");
  const scene = new TFile("EW/Manuscrit/Chapitre/Scene.md", "---\ntitle: Scene\n---\nContenu de test.");
  manuscript.children = [chap];
  chap.parent = manuscript;
  chap.children = [scene];
  scene.parent = chap;

  const { vault } = createFakeVault([manuscript, chap, scene]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: { title: "Scene", compile: true } }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    manuscriptTitle: "Test",
    manuscriptAuthor: "Auteur",
    projectMeta: {},
  };
  return { app, vault, settings, manuscript };
}

test("SUPPORTED_EXPORT_FORMATS : contient exactement les formats implementes", async () => {
  const { SUPPORTED_EXPORT_FORMATS } = await import("../src/services/compile-export.js");
  // Les 5 formats reellement implementes : epub, docx, odt, pdf, md
  assert.deepEqual([...SUPPORTED_EXPORT_FORMATS].sort(), ["docx", "epub", "md", "odt", "pdf"]);
  // Aucun format fictif (html n'est pas implemente dans Feuillets)
  assert.ok(!SUPPORTED_EXPORT_FORMATS.includes("html"), "html ne doit pas etre dans SUPPORTED_EXPORT_FORMATS");
});

test("exportWithScope format md : produit un fichier .md dans _Sortie", async () => {
  const { exportWithScope } = await import("../src/services/compile-export.js");
  const { createProjectScope } = await import("../src/services/compile-scope.js");
  const { app, vault, settings, manuscript } = makeExportFixture();

  const scope = createProjectScope(manuscript.path);
  const outPath = await exportWithScope(app, settings, scope, "md", "MonRoman");

  assert.ok(outPath, "exportWithScope doit renvoyer un chemin");
  assert.match(outPath, /\.md$/, "le chemin de sortie doit se terminer par .md");
  assert.ok(vault.getAbstractFileByPath(outPath), "le fichier .md doit exister dans le vault");
  assert.doesNotMatch(outPath, /\.md\.md$/, "aucune double extension .md.md");
});

test("exportWithScope format md : la portee file est respectee", async () => {
  const { exportWithScope } = await import("../src/services/compile-export.js");
  const { createFileScope } = await import("../src/services/compile-scope.js");

  const manuscript = new TFolder("FS/Manuscrit");
  const sceneA = new TFile("FS/Manuscrit/A.md", "Texte A.");
  const sceneB = new TFile("FS/Manuscrit/B.md", "Texte B.");
  manuscript.children = [sceneA, sceneB];
  sceneA.parent = manuscript;
  sceneB.parent = manuscript;

  const { vault } = createFakeVault([manuscript, sceneA, sceneB]);
  vault.cachedRead = vault.read;
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    compileFileName: "Out.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const scope = createFileScope(manuscript.path, sceneA.path);
  const outPath = await exportWithScope(app, settings, scope, "md", "FileOnly");
  assert.ok(outPath);
  const file = vault.getAbstractFileByPath(outPath);
  assert.ok(file, "le fichier de sortie doit exister");
  assert.match(file.content, /Texte A/, "le contenu doit inclure sceneA");
  assert.doesNotMatch(file.content, /Texte B/, "le contenu ne doit pas inclure sceneB");
});

test("exportWithScope format docx : produit un fichier .docx (pas .md)", async () => {
  const { exportWithScope } = await import("../src/services/compile-export.js");
  const { createProjectScope } = await import("../src/services/compile-scope.js");
  const { app, vault, settings, manuscript } = makeExportFixture();
  const restoreDom = installMinimalDom();
  try {
    const scope = createProjectScope(manuscript.path);
    const outPath = await exportWithScope(app, settings, scope, "docx", "MonRoman");
    assert.ok(outPath, "exportWithScope docx doit renvoyer un chemin");
    assert.match(outPath, /\.docx$/, "le chemin de sortie doit se terminer par .docx");
    assert.doesNotMatch(outPath, /\.md$/, "docx ne doit pas produire un .md");
    assert.doesNotMatch(outPath, /\.docx\.docx$/, "aucune double extension .docx.docx");
    assert.ok(vault.getAbstractFileByPath(outPath), "le fichier .docx doit exister dans le vault");
  } finally {
    restoreDom();
  }
});

test("exportWithScope format epub : produit un fichier .epub (pas .md)", async () => {
  const { exportWithScope } = await import("../src/services/compile-export.js");
  const { createProjectScope } = await import("../src/services/compile-scope.js");
  const { app, vault, settings, manuscript } = makeExportFixture();
  const restoreDom = installMinimalDom();
  try {
    const scope = createProjectScope(manuscript.path);
    const outPath = await exportWithScope(app, settings, scope, "epub", "MonRoman");
    assert.ok(outPath, "exportWithScope epub doit renvoyer un chemin");
    assert.match(outPath, /\.epub$/, "le chemin de sortie doit se terminer par .epub");
    assert.doesNotMatch(outPath, /\.md$/, "epub ne doit pas produire un .md");
    assert.doesNotMatch(outPath, /\.epub\.epub$/, "aucune double extension");
    assert.ok(vault.getAbstractFileByPath(outPath), "le fichier .epub doit exister dans le vault");
  } finally {
    restoreDom();
  }
});

test("exportWithScope format odt : produit un fichier .odt (pas .md)", async () => {
  const { exportWithScope } = await import("../src/services/compile-export.js");
  const { createProjectScope } = await import("../src/services/compile-scope.js");
  const { app, vault, settings, manuscript } = makeExportFixture();
  const restoreDom = installMinimalDom();
  try {
    const scope = createProjectScope(manuscript.path);
    const outPath = await exportWithScope(app, settings, scope, "odt", "MonRoman");
    assert.ok(outPath, "exportWithScope odt doit renvoyer un chemin");
    assert.match(outPath, /\.odt$/, "le chemin de sortie doit se terminer par .odt");
    assert.doesNotMatch(outPath, /\.md$/, "odt ne doit pas produire un .md");
    assert.doesNotMatch(outPath, /\.odt\.odt$/, "aucune double extension");
    assert.ok(vault.getAbstractFileByPath(outPath), "le fichier .odt doit exister dans le vault");
  } finally {
    restoreDom();
  }
});

test("exportWithScope : nom base sans extension + format docx -> .docx sans double extension", async () => {
  // La modale appelle sanitizeFileName qui retire l'extension avant de
  // transmettre le baseName. Ce test simule ce comportement : on passe
  // "Recueil" (sans .md) et on verifie qu'on obtient "Recueil.docx".
  const { exportWithScope } = await import("../src/services/compile-export.js");
  const { createProjectScope } = await import("../src/services/compile-scope.js");
  const { app, vault, settings, manuscript } = makeExportFixture();
  const restoreDom = installMinimalDom();
  try {
    const scope = createProjectScope(manuscript.path);
    const outPath = await exportWithScope(app, settings, scope, "docx", "Recueil");
    assert.ok(outPath);
    assert.match(outPath, /Recueil\.docx$/, "doit se terminer par Recueil.docx");
    assert.doesNotMatch(outPath, /Recueil\.md\.docx$/, "ne doit pas produire de double extension");
  } finally {
    restoreDom();
  }
});

test("exportWithScope : la meme portee folder est transmise pour chaque format", async () => {
  // Verifie que le scope folder est bien respecte pour le format md :
  // seuls les fichiers du dossier cible sont inclus.
  const { exportWithScope } = await import("../src/services/compile-export.js");
  const { createFolderScope } = await import("../src/services/compile-scope.js");

  const manuscript = new TFolder("SC/Manuscrit");
  const chapA = new TFolder("SC/Manuscrit/ChapA");
  const chapB = new TFolder("SC/Manuscrit/ChapB");
  const sceneA = new TFile("SC/Manuscrit/ChapA/A.md", "Texte A.");
  const sceneB = new TFile("SC/Manuscrit/ChapB/B.md", "Texte B.");
  manuscript.children = [chapA, chapB];
  chapA.parent = manuscript;
  chapB.parent = manuscript;
  chapA.children = [sceneA];
  chapB.children = [sceneB];
  sceneA.parent = chapA;
  sceneB.parent = chapB;

  const { vault } = createFakeVault([manuscript, chapA, chapB, sceneA, sceneB]);
  vault.cachedRead = vault.read;
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    folderPositions: {},
    compileFileName: "Out.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  // Portee folder = ChapA seulement
  const scope = createFolderScope(manuscript.path, chapA.path);
  const outPath = await exportWithScope(app, settings, scope, "md", "ChapAOnly");
  assert.ok(outPath);
  const file = vault.getAbstractFileByPath(outPath);
  assert.ok(file);
  assert.match(file.content, /Texte A/, "la portee folder doit inclure sceneA");
  assert.doesNotMatch(file.content, /Texte B/, "la portee folder ne doit pas inclure sceneB");
});
