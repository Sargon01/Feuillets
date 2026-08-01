import test from "node:test";
import assert from "node:assert/strict";
import { Notice, Platform, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile, activePresetConfig, getOutputFolder, listCompiledFilePaths, projectMetaFor, exportFile } from "../src/services/compile-export.js";

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
  assert.ok(vault.getAbstractFileByPath("Projet/Sortie/Manuscrit.md"));
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

test("getOutputFolder : crée et renvoie le dossier Sortie à côté du projet", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;

  const { vault } = createFakeVault([volume, manuscript]);
  const app = { vault };

  const settings = { projectFolder: manuscript.path };

  const folder = await getOutputFolder(app, settings);

  assert.ok(folder);
  assert.equal(folder.path, "Projet/Sortie");
  assert.ok(vault.getAbstractFileByPath("Projet/Sortie"));
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

test("exportFile : export Pandoc refuse proprement hors desktop (aucun require Node)", async () => {
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = { exportEngine: "pandoc" };
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const previousDesktop = Platform.isDesktop;
  Platform.isDesktop = false;
  try {
    await exportFile(app, settings, "docx");
    assert.equal(notices.length, 1);
    assert.match(notices[0], /mobile/i);
  } finally {
    Platform.isDesktop = previousDesktop;
    Notice.onCreate = null;
  }
});
