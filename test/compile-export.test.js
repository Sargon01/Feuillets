import test from "node:test";
import assert from "node:assert/strict";
import { MarkdownRenderer, TFile, TFolder, Platform } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile, activePresetConfig, effectiveComposition, getOutputFolder, joinCompiledSegments, listCompiledFilePaths, projectMetaFor, exportWithScope } from "../src/services/compile-export.js";
import { writeGeneratedIncluded } from "../src/services/book-composition.js";
import { updateOuvrageComposition, clearOuvrageComposition } from "../src/services/ouvrage-composition.js";

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
  assert.ok(vault.getAbstractFileByPath("Projet/_Feuillets/Sortie/Manuscrit.md"));
});

test("compile : le séparateur personnalisé n'apparaît qu'entre deux scènes, jamais après un titre de chapitre", async () => {
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "Premier texte.");
  const second = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md", "Deuxième texte.");
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
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: true,
    insertSceneTitles: false,
    separator: "***",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };

  const result = await compile(app, settings);

  assert.ok(result);
  assert.equal(result.manuscript, "# Chapitre 1\n\nPremier texte.\n\n***\n\nDeuxième texte.");
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
    folderPositions: {},
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

test("activePresetConfig : conserve le séparateur configuré tel quel", () => {
  const cfg = activePresetConfig({
    compileFileName: "Manuscrit.md",
    separator: "***",
    activePreset: -1,
    compilePresets: [],
  });

  assert.equal(cfg.separator, "***");
});

test("joinCompiledSegments : normalise le séparateur uniquement entre scènes", () => {
  const result = joinCompiledSegments([
    { text: "# Partie" },
    { text: "## Chapitre" },
    { text: "Scène 1" },
    { text: "Scène 2", sceneBreakBefore: true },
  ], "***");

  assert.equal(result, "# Partie\n\n## Chapitre\n\nScène 1\n\n***\n\nScène 2");
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
  assert.equal(folder.path, "Projet/_Feuillets/Sortie");
  assert.ok(vault.getAbstractFileByPath("Projet/_Feuillets/Sortie"));
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

  const folder = await getOutputFolder(app, settings, "fr");

  assert.ok(folder);
  assert.equal(folder.path, "MonProjet/_Feuillets/Sortie");
  assert.ok(vault.getAbstractFileByPath("MonProjet/_Feuillets/Sortie"));
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

// ─── Sommaire / Table des matières générés (Phase 6) ──────────────────────────

/** Même fixture que "compile : respecte l'ordre, les pages Front et
 * compile: false" (premier test du fichier) : un dossier Front avec sa page
 * de titre, un Chapitre 1 avec deux scènes — de quoi obtenir au moins un
 * titre réel dans le manuscrit compilé. */
function buildContentsFixture() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/Front");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const titlePage = new TFile("Projet/Manuscrit/Front/Page de titre.md", "---\ntitle: Mon livre\ntype: titre\n---\n:::titre: Mon livre\n");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "---\ntitle: Départ\n---\nPremier texte.");
  const second = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md", "---\ntitle: Secret\n---\nDeuxième texte.");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [front, chapter];
  front.parent = manuscript;
  chapter.parent = manuscript;
  front.children = [titlePage];
  chapter.children = [first, second];
  titlePage.parent = front;
  first.parent = chapter;
  second.parent = chapter;

  const { vault } = createFakeVault([volume, manuscript, front, chapter, titlePage, first, second]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([
    [titlePage.path, { title: "Mon livre", type: "titre", compile: true }],
    [first.path, { title: "Départ", compile: true }],
    [second.path, { title: "Secret", compile: true }],
  ]);
  const app = {
    vault,
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
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
    projectMeta: {},
  };
  return { app, settings, manuscript, titlePage, first, second };
}

test("compile portée project : Sommaire après Front, TDM en toute fin", async () => {
  const { app, settings, manuscript } = buildContentsFixture();
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "summary", true);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path], "toc", true);

  const result = await compile(app, settings);

  assert.ok(result);
  // Page Front (titre) en tête, puis Sommaire, puis le corps ; TDM termine.
  assert.equal(result.segments[0].frontType, "titre");
  assert.match(result.segments[1].text, /^# Sommaire/);
  assert.equal(result.segments[1].path, null);
  assert.equal(result.segments[1].frontType, null);
  assert.ok(result.segments.slice(2).some((s) => /Départ/.test(s.text)));
  assert.match(result.segments.at(-1).text, /^# Table des matières/);
  // Sommaire/TDM apparaissent bien dans le manuscrit final aussi.
  assert.match(result.manuscript, /# Sommaire/);
  assert.match(result.manuscript, /# Table des matières/);
});

test("compile : parts et segments restent synchronisés après insertion du Sommaire/TDM", async () => {
  const { app, settings, manuscript } = buildContentsFixture();
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "summary", true);
  writeGeneratedIncluded(meta, "toc", true);

  const result = await compile(app, settings, null, null, null, { writeOutput: false });

  assert.ok(result);
  // segments.text doit correspondre EXACTEMENT au manuscrit reconstitué en
  // joignant chaque segment (même ordre, même longueur — voir le
  // commentaire de compile() sur cette contrainte).
  assert.equal(result.manuscript, result.segments.map((s) => s.text).join("\n\n"));
});

test("compile portée project : seul Sommaire inclus -> TDM absente", async () => {
  const { app, settings, manuscript } = buildContentsFixture();
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "summary", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.match(result.manuscript, /# Sommaire/);
  assert.doesNotMatch(result.manuscript, /# Table des matières/);
});

test("compile portée project : ni Sommaire ni TDM réglés -> aucun des deux (exclus par défaut)", async () => {
  const { app, settings } = buildContentsFixture();

  const result = await compile(app, settings);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Sommaire/);
  assert.doesNotMatch(result.manuscript, /# Table des matières/);
});

test("compile portée file : jamais de Sommaire/TDM même si inclus dans projectMeta", async () => {
  const { app, settings, manuscript, first } = buildContentsFixture();
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "summary", true);
  writeGeneratedIncluded(meta, "toc", true);

  const result = await compile(app, settings, first.path);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Sommaire/);
  assert.doesNotMatch(result.manuscript, /# Table des matières/);
});

test("compile portée folder : jamais de Sommaire/TDM même si inclus dans projectMeta", async () => {
  const { app, settings, manuscript } = buildContentsFixture();
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "summary", true);
  writeGeneratedIncluded(meta, "toc", true);
  const chapterPath = "Projet/Manuscrit/Chapitre 1";

  const result = await compile(app, settings, chapterPath);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Sommaire/);
  assert.doesNotMatch(result.manuscript, /# Table des matières/);
});

test("compile portée selection : jamais de Sommaire/TDM même si inclus dans projectMeta", async () => {
  const { app, settings, manuscript, first, second } = buildContentsFixture();
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "summary", true);
  writeGeneratedIncluded(meta, "toc", true);
  const scope = { type: "selection", projectRoot: manuscript.path, paths: [first.path, second.path] };

  const result = await compile(app, settings, null, scope);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Sommaire/);
  assert.doesNotMatch(result.manuscript, /# Table des matières/);
});

// ─── Table des illustrations générée (Phase 7) ────────────────────────────────

/** Même fixture que buildContentsFixture(), avec une image légendée dans la
 * seconde scène — de quoi obtenir une illustration réelle dans le
 * manuscrit compilé. */
function buildTablesFixture(withIllustration = true) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/Front");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const titlePage = new TFile("Projet/Manuscrit/Front/Page de titre.md", "---\ntitle: Mon livre\ntype: titre\n---\n:::titre: Mon livre\n");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "---\ntitle: Départ\n---\nPremier texte.");
  const secondContent = withIllustration
    ? "---\ntitle: Secret\n---\nDeuxième texte.\n\n![Carte du royaume](carte.png)\n"
    : "---\ntitle: Secret\n---\nDeuxième texte.";
  const second = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md", secondContent);
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [front, chapter];
  front.parent = manuscript;
  chapter.parent = manuscript;
  front.children = [titlePage];
  chapter.children = [first, second];
  titlePage.parent = front;
  first.parent = chapter;
  second.parent = chapter;

  const { vault } = createFakeVault([volume, manuscript, front, chapter, titlePage, first, second]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([
    [titlePage.path, { title: "Mon livre", type: "titre", compile: true }],
    [first.path, { title: "Départ", compile: true }],
    [second.path, { title: "Secret", compile: true }],
  ]);
  const app = {
    vault,
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
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
    projectMeta: {},
  };
  return { app, settings, manuscript, titlePage, first, second };
}

test("compile portée project : Table des illustrations incluse -> insérée avant le manuscrit", async () => {
  const { app, settings, manuscript } = buildTablesFixture(true);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "tables", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.match(result.manuscript, /# Table des illustrations[\s\S]*- Carte du royaume/);
  // Tables est avant le manuscrit (juste après la page de titre)
  const tablesIdx = result.segments.findIndex((s) => s.text.startsWith("# Table des illustrations"));
  const manuscriptIdx = result.segments.findIndex((s) => s.path && s.path.includes("Scène 1"));
  assert.ok(tablesIdx >= 0, "Table des illustrations trouvée");
  assert.ok(tablesIdx < manuscriptIdx, "Table des illustrations avant le manuscrit");
});

test("compile portée project : aucune illustration légendée -> pas de Table des illustrations, même incluse", async () => {
  const { app, settings, manuscript } = buildTablesFixture(false);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "tables", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Table des illustrations/);
});

test("compile portée project : tables non incluse (par défaut) -> jamais générée même avec une illustration", async () => {
  const { app, settings } = buildTablesFixture(true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Table des illustrations/);
});

test("compile : parts et segments restent synchronisés après insertion de la Table des illustrations", async () => {
  const { app, settings, manuscript } = buildTablesFixture(true);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "tables", true);

  const result = await compile(app, settings, null, null, null, { writeOutput: false });

  assert.ok(result);
  assert.equal(result.manuscript, result.segments.map((s) => s.text).join("\n\n"));
});

test("compile portée project : Sommaire puis Tables avant manuscrit, TDM à la fin", async () => {
  const { app, settings, manuscript } = buildTablesFixture(true);
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "summary", true);
  writeGeneratedIncluded(meta, "toc", true);
  writeGeneratedIncluded(meta, "tables", true);

  const result = await compile(app, settings);

  assert.ok(result);
  // Ordre: Front, Sommaire, Tables, Manuscrit, TDM
  assert.equal(result.segments[0].frontType, "titre");
  assert.match(result.segments[1].text, /^# Sommaire/);
  assert.match(result.segments[2].text, /^# Table des illustrations/);
  // Tables n'est jamais listée dans le Sommaire/TDM (ils sont générés avant son insertion).
  assert.doesNotMatch(result.segments[1].text, /Table des illustrations/);
  // TDM termine l'ouvrage
  assert.match(result.segments.at(-1).text, /^# Table des matières/);
});

test("compile portée file : jamais de Table des illustrations même si incluse dans projectMeta", async () => {
  const { app, settings, manuscript, first } = buildTablesFixture(true);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "tables", true);

  const result = await compile(app, settings, first.path);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Table des illustrations/);
});

test("compile portée folder : jamais de Table des illustrations même si incluse dans projectMeta", async () => {
  const { app, settings, manuscript } = buildTablesFixture(true);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "tables", true);

  const result = await compile(app, settings, "Projet/Manuscrit/Chapitre 1");

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Table des illustrations/);
});

test("compile portée selection : jamais de Table des illustrations même si incluse dans projectMeta", async () => {
  const { app, settings, manuscript, first, second } = buildTablesFixture(true);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "tables", true);
  const scope = { type: "selection", projectRoot: manuscript.path, paths: [first.path, second.path] };

  const result = await compile(app, settings, null, scope);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Table des illustrations/);
});

// ─── Bibliographie générée (Phase 8) ───────────────────────────────────────────

/** Même fixture que buildTablesFixture(), avec en plus un dossier
 * `_Recherche/Bibliographie` FRÈRE de Manuscrit (getResearchRoot reconnaît
 * `_Recherche` comme frère, jamais comme descendant) contenant `refCount`
 * fiches valides. */
function buildBibliographyFixture(refCount = 1) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/Front");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const research = new TFolder("Projet/_Recherche");
  const biblio = new TFolder("Projet/_Recherche/Bibliographie");
  const titlePage = new TFile("Projet/Manuscrit/Front/Page de titre.md", "---\ntitle: Mon livre\ntype: titre\n---\n:::titre: Mon livre\n");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "---\ntitle: Départ\n---\nPremier texte.");
  const second = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md", "---\ntitle: Secret\n---\nDeuxième texte.");
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  manuscript.children = [front, chapter];
  front.parent = manuscript;
  chapter.parent = manuscript;
  front.children = [titlePage];
  chapter.children = [first, second];
  titlePage.parent = front;
  first.parent = chapter;
  second.parent = chapter;
  research.children = [biblio];
  biblio.parent = research;

  const refs = [];
  const frontmatter = new Map([
    [titlePage.path, { title: "Mon livre", type: "titre", compile: true }],
    [first.path, { title: "Départ", compile: true }],
    [second.path, { title: "Secret", compile: true }],
  ]);
  for (let i = 0; i < refCount; i++) {
    const ref = new TFile(`Projet/_Recherche/Bibliographie/Réf ${i}.md`, `---\ntitle: Titre ${i}\nauthor: Auteur ${i}\n---\n`);
    ref.parent = biblio;
    refs.push(ref);
    frontmatter.set(ref.path, { title: `Titre ${i}`, author: `Auteur ${i}` });
  }
  biblio.children = refs;

  const { vault } = createFakeVault([volume, manuscript, front, chapter, research, biblio, titlePage, first, second, ...refs]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
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
    projectMeta: {},
  };
  return { app, settings, manuscript, first, second };
}

test("compile portée project : bibliographie incluse -> insérée après Tables", async () => {
  const { app, settings, manuscript } = buildBibliographyFixture(2);
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "tables", true); // aucune illustration -> pas de bloc Tables ici
  writeGeneratedIncluded(meta, "bibliography", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.match(result.manuscript, /# Bibliographie[\s\S]*Auteur 0[\s\S]*Auteur 1/);
  const last = result.segments.at(-1);
  assert.match(last.text, /^# Bibliographie/);
  assert.equal(last.path, null);
  assert.equal(last.frontType, null);
});

test("compile portée project : Table des illustrations ET bibliographie -> bibliographie APRÈS Tables", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/Front");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const research = new TFolder("Projet/_Recherche");
  const biblio = new TFolder("Projet/_Recherche/Bibliographie");
  const titlePage = new TFile("Projet/Manuscrit/Front/Page de titre.md", "---\ntitle: Mon livre\ntype: titre\n---\n:::titre: Mon livre\n");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "---\ntitle: Départ\n---\nPremier texte.\n\n![Carte du royaume](carte.png)\n");
  const ref = new TFile("Projet/_Recherche/Bibliographie/Réf 0.md", "---\ntitle: Titre 0\nauthor: Auteur 0\n---\n");
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  manuscript.children = [front, chapter];
  front.parent = manuscript;
  chapter.parent = manuscript;
  front.children = [titlePage];
  chapter.children = [first];
  titlePage.parent = front;
  first.parent = chapter;
  research.children = [biblio];
  biblio.parent = research;
  ref.parent = biblio;
  biblio.children = [ref];

  const { vault } = createFakeVault([volume, manuscript, front, chapter, research, biblio, titlePage, first, ref]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([
    [titlePage.path, { title: "Mon livre", type: "titre", compile: true }],
    [first.path, { title: "Départ", compile: true }],
    [ref.path, { title: "Titre 0", author: "Auteur 0" }],
  ]);
  const app = { vault, metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) } };
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
    projectMeta: {},
  };
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "tables", true);
  writeGeneratedIncluded(meta, "bibliography", true);

  const result = await compile(app, settings);

  assert.ok(result);
  const tablesIndex = result.segments.findIndex((s) => /^# Table des illustrations/.test(s.text));
  const bibliographyIndex = result.segments.findIndex((s) => /^# Bibliographie/.test(s.text));
  assert.ok(tablesIndex >= 0 && bibliographyIndex >= 0);
  assert.ok(tablesIndex < bibliographyIndex, "la bibliographie vient après Tables");
  assert.equal(bibliographyIndex, result.segments.length - 1, "la bibliographie est le tout dernier segment");
});

test("compile portée project : aucune référence bibliographique -> pas de page générée, même incluse", async () => {
  const { app, settings, manuscript } = buildBibliographyFixture(0);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "bibliography", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Bibliographie/);
});

test("compile portée project : bibliographie non incluse (par défaut) -> jamais générée même avec des références", async () => {
  const { app, settings } = buildBibliographyFixture(3);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Bibliographie/);
});

test("compile : parts et segments restent synchronisés après insertion de la bibliographie", async () => {
  const { app, settings, manuscript } = buildBibliographyFixture(2);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "bibliography", true);

  const result = await compile(app, settings, null, null, null, { writeOutput: false });

  assert.ok(result);
  assert.equal(result.manuscript, result.segments.map((s) => s.text).join("\n\n"));
});

test("compile portée file : jamais de bibliographie même incluse dans projectMeta", async () => {
  const { app, settings, manuscript, first } = buildBibliographyFixture(2);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "bibliography", true);

  const result = await compile(app, settings, first.path);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Bibliographie/);
});

test("compile portée folder : jamais de bibliographie même incluse dans projectMeta", async () => {
  const { app, settings, manuscript } = buildBibliographyFixture(2);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "bibliography", true);

  const result = await compile(app, settings, "Projet/Manuscrit/Chapitre 1");

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Bibliographie/);
});

test("compile portée selection : jamais de bibliographie même incluse dans projectMeta", async () => {
  const { app, settings, manuscript, first, second } = buildBibliographyFixture(2);
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "bibliography", true);
  const scope = { type: "selection", projectRoot: manuscript.path, paths: [first.path, second.path] };

  const result = await compile(app, settings, null, scope);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Bibliographie/);
});

test("compile portée project : génère la bibliographie à partir des clés BibTeX citées dans les scènes compilées", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const sceneCompiled = new TFile(
    "Projet/Manuscrit/Chapitre 1/Scène 1.md",
    "---\ntitle: Scène 1\n---\nTexte citant [@knuth1968] et [@unknownKey].\n"
  );
  sceneCompiled.extension = "md";
  sceneCompiled.stat = { mtime: 1000, size: sceneCompiled.content.length };

  const research = new TFolder("Projet/_Recherche");
  const bibFile = new TFile(
    "Projet/_Recherche/refs.bib",
    "@article{knuth1968,\n  author = {Knuth, Donald},\n  title = {The Art of Computer Programming},\n  year = {1968}\n}\n@article{unused1999,\n  author = {Unused, Author},\n  title = {Unused Title},\n  year = {1999}\n}"
  );
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 1000, size: bibFile.content.length };

  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [sceneCompiled];
  sceneCompiled.parent = chapter;
  research.children = [bibFile];
  bibFile.parent = research;

  const { vault } = createFakeVault([volume, manuscript, chapter, sceneCompiled, research, bibFile]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: { title: file.basename, compile: true },
      }),
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: [chapter.name] },
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    projectMeta: {
      [manuscript.path]: {
        researchFolderLinks: {
          [manuscript.path]: research.path,
        },
        citekeyBibliographyPath: "refs.bib",
      },
    },
  };
  writeGeneratedIncluded(settings.projectMeta[manuscript.path], "bibliography", true);

  const result = await compile(app, settings);
  assert.ok(result);
  assert.match(result.manuscript, /# Bibliographie/);
  const biblioSection = result.manuscript.split("# Bibliographie")[1] || "";
  // Knuth 1968 must be in the bibliography
  assert.match(biblioSection, /Knuth, Donald/);
  assert.match(biblioSection, /The Art of Computer Programming/);
  // Unused entry must NOT be in the bibliography
  assert.doesNotMatch(biblioSection, /Unused, Author/);
  // Unknown citekey must NOT generate an invented reference
  assert.doesNotMatch(biblioSection, /unknownKey/);
});

test("compile portée project : n'inclut que les citekeys des fichiers effectivement compilés", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const sceneCompiled = new TFile(
    "Projet/Manuscrit/Chapitre 1/Scène 1.md",
    "---\ntitle: Scène 1\ncompile: true\n---\nTexte [@knuth1968].\n"
  );
  sceneCompiled.extension = "md";
  sceneCompiled.stat = { mtime: 1000, size: sceneCompiled.content.length };

  const sceneExcluded = new TFile(
    "Projet/Manuscrit/Chapitre 1/Scène 2.md",
    "---\ntitle: Scène 2\ncompile: false\n---\nTexte exclu [@turing1936].\n"
  );
  sceneExcluded.extension = "md";
  sceneExcluded.stat = { mtime: 1000, size: sceneExcluded.content.length };

  const research = new TFolder("Projet/_Recherche");
  const bibFile = new TFile(
    "Projet/_Recherche/refs.bib",
    "@article{knuth1968,\n  author = {Knuth, Donald},\n  year = {1968}\n}\n@article{turing1936,\n  author = {Turing, Alan},\n  year = {1936}\n}"
  );
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 1000, size: bibFile.content.length };

  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [sceneCompiled, sceneExcluded];
  sceneCompiled.parent = chapter;
  sceneExcluded.parent = chapter;
  research.children = [bibFile];
  bibFile.parent = research;

  const { vault } = createFakeVault([volume, manuscript, chapter, sceneCompiled, sceneExcluded, research, bibFile]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: file === sceneExcluded ? { compile: false } : { compile: true },
      }),
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: [chapter.name] },
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    projectMeta: {
      [manuscript.path]: {
        researchFolderLinks: {
          [manuscript.path]: research.path,
        },
        citekeyBibliographyPath: "refs.bib",
      },
    },
  };
  writeGeneratedIncluded(settings.projectMeta[manuscript.path], "bibliography", true);

  const result = await compile(app, settings);
  assert.ok(result);
  const biblioSection = result.manuscript.split("# Bibliographie")[1] || "";
  assert.match(biblioSection, /Knuth, Donald/);
  // Turing is in excluded scene, so must NOT be in bibliography
  assert.doesNotMatch(biblioSection, /Turing, Alan/);
});

test("Markdown export: [@key], groups, and locators remain strictly raw and generated bibliography is appended only when requested", async () => {
  const volume = new TFolder("Project");
  const manuscript = new TFolder("Project/Manuscript");
  const chapter = new TFolder("Project/Manuscript/Chapter 1");
  const rawCitationsText = "Single citation [@knuth1968]. Grouped [@knuth1968; @lamport1994, ch. 2]. Suppressed author [-@knuth1968]. Locator [@knuth1968, pp. 10-15].";
  const scene = new TFile(
    "Project/Manuscript/Chapter 1/Scene 1.md",
    `---\ntitle: Scene 1\ncompile: true\n---\n${rawCitationsText}\n`
  );
  scene.extension = "md";
  scene.stat = { mtime: 1000, size: scene.content.length };

  const research = new TFolder("Project/_Research");
  const bibFile = new TFile(
    "Project/_Research/refs.bib",
    `@article{knuth1968,
  author = {Knuth, Donald},
  title = {The Art of Computer Programming},
  year = {1968}
}
@book{lamport1994,
  author = {Lamport, Leslie},
  title = {LaTeX: A Document Preparation System},
  year = {1994}
}`
  );
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 1000, size: bibFile.content.length };

  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [scene];
  scene.parent = chapter;
  research.children = [bibFile];
  bibFile.parent = research;

  const { vault } = createFakeVault([volume, manuscript, chapter, scene, research, bibFile]);
  vault.cachedRead = vault.read;
  const app = {
    vault,
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: { title: file.basename, compile: true },
      }),
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: [chapter.name] },
    compileFileName: "Manuscript.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    projectMeta: {
      [manuscript.path]: {
        researchFolderLinks: {
          [manuscript.path]: research.path,
        },
        citekeyBibliographyPath: "refs.bib",
      },
    },
  };

  // Case A: bibliography is NOT requested
  writeGeneratedIncluded(settings.projectMeta[manuscript.path], "bibliography", false);
  const resultWithoutBib = await compile(app, settings);
  assert.ok(resultWithoutBib);
  // Manuscript body must contain citations in raw unmodified Markdown syntax
  assert.ok(resultWithoutBib.manuscript.includes("[@knuth1968]"), "Single citation remains raw");
  assert.ok(resultWithoutBib.manuscript.includes("[@knuth1968; @lamport1994, ch. 2]"), "Grouped citations and locators remain raw");
  assert.ok(resultWithoutBib.manuscript.includes("[-@knuth1968]"), "Suppressed author citation remains raw");
  assert.ok(resultWithoutBib.manuscript.includes("[@knuth1968, pp. 10-15]"), "Locator citation remains raw");
  // No bibliography section should be appended
  assert.doesNotMatch(resultWithoutBib.manuscript, /# Bibliographie/, "No bibliography appended when not requested");

  // Case B: bibliography IS requested
  writeGeneratedIncluded(settings.projectMeta[manuscript.path], "bibliography", true);
  const resultWithBib = await compile(app, settings);
  assert.ok(resultWithBib);
  // Citations still remain raw in the manuscript body
  assert.ok(resultWithBib.manuscript.includes("[@knuth1968]"), "Citations remain raw in body with bibliography enabled");
  assert.ok(resultWithBib.manuscript.includes("[@knuth1968; @lamport1994, ch. 2]"), "Grouped citations remain raw in body");
  assert.ok(resultWithBib.manuscript.includes("[-@knuth1968]"), "Suppressed author remains raw in body");
  assert.ok(resultWithBib.manuscript.includes("[@knuth1968, pp. 10-15]"), "Locator remains raw in body");
  // Bibliography section is appended
  assert.match(resultWithBib.manuscript, /# Bibliographie/, "Bibliography section is appended when requested");
  const bibSection = resultWithBib.manuscript.split("# Bibliographie")[1] || "";
  assert.match(bibSection, /Knuth, Donald/);
  assert.match(bibSection, /Lamport, Leslie/);
});

// ─── Annexes (Phase 9) ──────────────────────────────────────────────────────

/** Volume/Manuscrit avec Front (page de titre), un Chapitre 1 (une scène,
 * avec une illustration légendée pour les tests TDM/Tables) et un dossier
 * `annexesFolderName` contenant `annexSpecs` fichiers. */
function buildAnnexesFixture(annexSpecs = [{ title: "Annexe A" }], annexesFolderName = "Annexes") {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/Front");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const annexes = new TFolder(`Projet/Manuscrit/${annexesFolderName}`);
  const titlePage = new TFile("Projet/Manuscrit/Front/Page de titre.md", "---\ntitle: Mon livre\ntype: titre\n---\n:::titre: Mon livre\n");
  const scene = new TFile(
    "Projet/Manuscrit/Chapitre 1/Scène 1.md",
    "---\ntitle: Départ\n---\nPremier texte.\n\n![Carte du royaume](carte.png)\n"
  );
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [front, chapter, annexes];
  front.parent = manuscript;
  chapter.parent = manuscript;
  annexes.parent = manuscript;
  front.children = [titlePage];
  chapter.children = [scene];
  titlePage.parent = front;
  scene.parent = chapter;

  const annexFiles = annexSpecs.map((spec, i) => {
    const file = new TFile(
      `Projet/Manuscrit/${annexesFolderName}/${spec.title}.md`,
      `---\ntitle: ${spec.title}\n---\nContenu de ${spec.title}.${spec.withIllustration ? `\n\n![${spec.illustrationCaption || spec.title + " (figure)"}](img${i}.png)\n` : ""}`
    );
    file.parent = annexes;
    return file;
  });
  annexes.children = annexFiles;

  const { vault } = createFakeVault([volume, manuscript, front, chapter, annexes, titlePage, scene, ...annexFiles]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([
    [titlePage.path, { title: "Mon livre", type: "titre", compile: true }],
    [scene.path, { title: "Départ", compile: true }],
  ]);
  annexFiles.forEach((file, i) => {
    const spec = annexSpecs[i];
    frontmatter.set(file.path, { title: spec.title, compile: spec.compile !== false });
  });
  const app = { vault, metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) } };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: [front.name, chapter.name, annexes.name] },
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    projectMeta: {},
  };
  return { app, settings, manuscript, scene, annexFiles };
}

test("compile portée project : reconnaît le dossier Annexes (FR)", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.match(result.manuscript, /# Annexes[\s\S]*Contenu de Annexe A/);
});

test("compile portée project : reconnaît le dossier Appendices (EN)", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture([{ title: "Annex A" }], "Appendices");
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.match(result.manuscript, /# Annexes[\s\S]*Contenu de Annex A/);
});

test("compile portée project : respecte l'ordre getOrderedChildren des annexes", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture(
    [{ title: "Zèbre" }, { title: "Alpha" }],
    "Annexes"
  );
  // Ordre explicite du Binder — pas alphabétique — pour prouver que c'est
  // bien getOrderedChildren qui gouverne, pas un tri propre à ce code.
  settings.orders["Projet/Manuscrit/Annexes"] = ["Zèbre.md", "Alpha.md"];
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  const iZebre = result.manuscript.indexOf("Zèbre");
  const iAlpha = result.manuscript.indexOf("Alpha");
  assert.ok(iZebre >= 0 && iAlpha >= 0 && iZebre < iAlpha);
});

test("compile portée project : respecte compile: false sur une annexe individuelle", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture(
    [{ title: "Incluse" }, { title: "Exclue", compile: false }],
    "Annexes"
  );
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.match(result.manuscript, /Contenu de Incluse/);
  assert.doesNotMatch(result.manuscript, /Contenu de Exclue/);
});

test("compile portée project : annexes non incluses (par défaut) -> absentes du corps ET non insérées, sans page vide", async () => {
  const { app, settings } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");

  const result = await compile(app, settings);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Annexes/);
  assert.doesNotMatch(result.manuscript, /Contenu de Annexe A/);
});

test("compile portée project : incluses mais toutes compile:false -> pas de # Annexes (page vide interdite)", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture(
    [{ title: "Une", compile: false }, { title: "Deux", compile: false }],
    "Annexes"
  );
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Annexes/);
});

test("compile portée project : dossier Annexes vide, inclus -> pas de # Annexes", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture([], "Annexes");
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /# Annexes/);
});

test("compile portée project : annexes retirées du corps principal (jamais compilées inline)", async () => {
  const { app, settings } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");
  // Même NON incluses : jamais compilées comme un dossier ordinaire du corps.
  const result = await compile(app, settings);
  assert.ok(result);
  assert.doesNotMatch(result.manuscript, /Annexe A/);
});

test("compile portée project : annexes insérées APRÈS Tables et Bibliographie", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "tables", true);
  writeGeneratedIncluded(meta, "bibliography", true); // aucune fiche Recherche -> pas de bloc, juste tables
  writeGeneratedIncluded(meta, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  const tablesIndex = result.segments.findIndex((s) => /^# Table des illustrations/.test(s.text));
  const annexesIndex = result.segments.findIndex((s) => /^# Annexes/.test(s.text));
  assert.ok(tablesIndex >= 0, "Table des illustrations générée (carte du royaume dans le corps)");
  assert.ok(annexesIndex > tablesIndex, "les annexes viennent après Tables");
  assert.equal(annexesIndex, result.segments.length - 2, "# Annexes suivi directement du fichier d'annexe, en toute fin");
});

test("compile portée project : Table des matières voit aussi les titres des annexes quand elles sont incluses", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "toc", true);
  writeGeneratedIncluded(meta, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  const toc = result.segments.find((s) => /^# Table des matières/.test(s.text));
  assert.ok(toc, "TDM générée");
  assert.match(toc.text, /Annexe A/, "la TDM voit le titre de l'annexe");
  // Le segment de la TDM lui-même ne contient l'annexe qu'UNE fois (comme
  // source), le texte de l'annexe n'est jamais dupliqué dans la TDM.
  assert.equal((toc.text.match(/Annexe A/g) || []).length, 2);
});

test("compile portée project : Table des matières NE voit PAS les annexes quand elles sont exclues", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "toc", true); // annexes non incluses (défaut)

  const result = await compile(app, settings);

  assert.ok(result);
  const toc = result.segments.find((s) => /^# Table des matières/.test(s.text));
  assert.ok(toc);
  assert.doesNotMatch(toc.text, /Annexe A/);
});

test("compile portée project : Table des illustrations voit aussi les illustrations légendées des annexes incluses", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture(
    [{ title: "Annexe A", withIllustration: true, illustrationCaption: "Plan de l'annexe" }],
    "Annexes"
  );
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "tables", true);
  writeGeneratedIncluded(meta, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  const tables = result.segments.find((s) => /^# Table des illustrations/.test(s.text));
  assert.ok(tables);
  assert.match(tables.text, /Carte du royaume/, "illustration du corps principal");
  assert.match(tables.text, /Plan de l'annexe/, "illustration de l'annexe incluse");
});

test("compile portée project : Sommaire reste centré sur le manuscrit principal, jamais les annexes", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "summary", true);
  writeGeneratedIncluded(meta, "annexes", true);

  const result = await compile(app, settings);

  assert.ok(result);
  const summary = result.segments.find((s) => /^# Sommaire/.test(s.text));
  assert.ok(summary);
  assert.doesNotMatch(summary.text, /Annexe A/);
});

test("compile : parts et segments restent synchronisés après insertion des annexes", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture(
    [{ title: "Annexe A" }, { title: "Annexe B" }],
    "Annexes"
  );
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);

  const result = await compile(app, settings, null, null, null, { writeOutput: false });

  assert.ok(result);
  assert.equal(result.manuscript, result.segments.map((s) => s.text).join("\n\n"));
});

test("compile portée file : comportement inchangé — le dossier Annexes reste compilé normalement s'il est ciblé", async () => {
  const { app, settings, manuscript, annexFiles } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);

  const result = await compile(app, settings, annexFiles[0].path);

  assert.ok(result);
  // Compilé comme un fichier normal, PAS précédé de "# Annexes".
  assert.doesNotMatch(result.manuscript, /# Annexes/);
  assert.match(result.manuscript, /Contenu de Annexe A/);
});

test("compile portée folder ciblant Annexes : comportement inchangé — compilée comme un dossier ordinaire (pas via la logique Phase 9)", async () => {
  const { app, settings, manuscript } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);

  const result = await compile(app, settings, "Projet/Manuscrit/Annexes");

  assert.ok(result);
  // Compilée normalement, comme n'importe quel dossier ciblé : un seul
  // segment de titre de dossier (le nom "Annexes" lui-même, coïncidence de
  // nommage — pas le marqueur de section généré par la Phase 9, qui
  // n'existe qu'en portée project) suivi du fichier.
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[1].path, "Projet/Manuscrit/Annexes/Annexe A.md");
  assert.match(result.manuscript, /Contenu de Annexe A/);
});

test("compile portée selection : comportement inchangé pour les annexes sélectionnées", async () => {
  const { app, settings, manuscript, annexFiles } = buildAnnexesFixture([{ title: "Annexe A" }], "Annexes");
  writeGeneratedIncluded(settings.projectMeta[manuscript.path] = {}, "annexes", true);
  const scope = { type: "selection", projectRoot: manuscript.path, paths: [annexFiles[0].path] };

  const result = await compile(app, settings, null, scope);

  assert.ok(result);
  assert.match(result.manuscript, /Contenu de Annexe A/);
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
  assert.equal(result.outPath, "R/Manuscrit/_Feuillets/Sortie/Manuscrit.md");
  assert.ok(vault.getAbstractFileByPath("R/Manuscrit/_Feuillets/Sortie/Manuscrit.md"));
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
  const prev = {
    document: globalThis.document,
    Node: globalThis.Node,
    XMLSerializer: globalThis.XMLSerializer,
    createEl: globalThis.createEl,
    createDiv: globalThis.createDiv,
  };
  globalThis.document = {
    createElement: (tag) => makeEl(tag),
    createTextNode: (t) => ({ nodeType: 3, nodeValue: t, textContent: t, get outerHTML() { return t; }, cloneNode() { return this; }, remove() {} }),
    createElementNS: (_ns, tag) => makeEl(tag),
  };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.XMLSerializer = class { serializeToString(n) { return n?.outerHTML ?? String(n?.textContent ?? ""); } };
  // Fonctions globales autonomes createEl/createDiv d'Obsidian (nœud
  // détaché, non ajouté à un parent) — voir export-render.ts.
  globalThis.createEl = (tag, options = {}) => makeEl(tag, options.text || "");
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
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
  assert.deepEqual([...SUPPORTED_EXPORT_FORMATS].sort(), ["docx", "epub", "md", "odt", "pandoc", "pdf"]);
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

test("exportWithScope : les formats binaires reçoivent toujours un sourcePath pour chaque portée", async () => {
  const { exportWithScope } = await import("../src/services/compile-export.js");
  const { createFileScope, createFolderScope, createProjectScope } = await import("../src/services/compile-scope.js");
  const { app, settings, manuscript } = makeExportFixture();
  const folder = manuscript.children[0];
  const file = folder.children[0];
  const scopes = [
    createFileScope(manuscript.path, file.path),
    createFolderScope(manuscript.path, folder.path),
    createProjectScope(manuscript.path),
  ];
  const formats = ["pdf", "docx", "epub", "odt"];
  const restoreDom = installMinimalDom();
  const previousRender = MarkdownRenderer.render;
  const sourcePaths = [];
  MarkdownRenderer.render = async (_app, _markdown, _container, sourcePath) => {
    sourcePaths.push(sourcePath);
  };
  try {
    for (const format of formats) {
      for (const scope of scopes) await exportWithScope(app, settings, scope, format, `SourcePath-${format}`);
    }
    assert.equal(sourcePaths.length, formats.length * scopes.length);
    assert.ok(sourcePaths.every((sourcePath) => typeof sourcePath === "string" && sourcePath.length > 0));
  } finally {
    MarkdownRenderer.render = previousRender;
    restoreDom();
  }
});

test("compile : un brouillon est exportable explicitement, mais exclu du projet", async () => {
  const { createFileScope, createProjectScope } = await import("../src/services/compile-scope.js");
  const project = new TFolder("WARPI");
  const feuillets = new TFolder("WARPI/_Feuillets");
  const drafts = new TFolder("WARPI/_Feuillets/Drafts");
  const textes = new TFolder("WARPI/TEXTES");
  const normal = new TFile("WARPI/TEXTES/Normal.md", "Texte normal.");
  const draft = new TFile("WARPI/_Feuillets/Drafts/Sans titre.md", "---\nstatus: Brouillon\n---\nTexte brouillon.");
  project.children = [feuillets, textes];
  feuillets.parent = project;
  textes.parent = project;
  feuillets.children = [drafts];
  drafts.parent = feuillets;
  drafts.children = [draft];
  draft.parent = drafts;
  textes.children = [normal];
  normal.parent = textes;

  const { vault, fileManager } = createFakeVault([project, feuillets, drafts, textes, normal, draft]);
  vault.cachedRead = vault.read;
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = {
    projectFolder: project.path,
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

  const projectResult = await compile(app, settings, null, createProjectScope(project.path), null, { writeOutput: false });
  assert.ok(projectResult);
  assert.ok(!projectResult.segments.some((segment) => segment.path === draft.path));

  const fileResult = await compile(app, settings, null, createFileScope(project.path, draft.path), null, { writeOutput: false });
  assert.ok(fileResult);
  assert.deepEqual(fileResult.segments.map((segment) => segment.path), [draft.path]);

  const nestedFolder = await vault.createFolder("WARPI/_Feuillets/Drafts/Notes");
  assert.ok(nestedFolder instanceof TFolder);
  const nested = await vault.create("WARPI/_Feuillets/Drafts/Notes/Imbrique.md", "---\nstatus: Brouillon\n---\nTexte imbrique.");
  const nestedResult = await compile(app, settings, null, createFileScope(project.path, nested.path), null, { writeOutput: false });
  assert.ok(nestedResult);
  assert.deepEqual(nestedResult.segments.map((segment) => segment.path), [nested.path]);

  await vault.createFolder("WARPI/TEXTES/Promu");
  const promotedFolder = vault.getAbstractFileByPath("WARPI/TEXTES/Promu");
  assert.ok(promotedFolder instanceof TFolder);
  await fileManager.renameFile(draft, "WARPI/TEXTES/Promu/Sans titre.md");
  const promotedResult = await compile(app, settings, null, createProjectScope(project.path), null, { writeOutput: false });
  assert.ok(promotedResult);
  assert.ok(promotedResult.segments.some((segment) => segment.path === draft.path));
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
    assert.equal(vault.getAbstractFileByPath("EW/_Feuillets/Sortie/Manuscrit.md"), null, "un export DOCX ne doit pas écrire Manuscrit.md");
  } finally {
    restoreDom();
  }
});

test("exportEditorialDocumentDocxToFolder : exporte un document Markdown individuel dans le dossier demandé", async () => {
  const { exportEditorialDocumentDocxToFolder } = await import("../src/services/compile-export.js");
  const { app, vault, settings } = makeExportFixture();
  const edition = new TFolder("EW/_Edition");
  const synopsis = new TFile("EW/_Edition/Synopsis.md", "# Synopsis\n\nUne histoire.");
  const destination = new TFolder("EW/_Edition/Soumissions/Paquet");
  edition.parent = new TFolder("EW");
  synopsis.parent = edition;
  destination.parent = edition;
  edition.children = [synopsis, destination];
  vault.getAbstractFileByPath = ((original) => (path) => {
    if (path === edition.path) return edition;
    if (path === synopsis.path) return synopsis;
    if (path === destination.path) return destination;
    return original(path);
  })(vault.getAbstractFileByPath);
  const restoreDom = installMinimalDom();
  try {
    const outPath = await exportEditorialDocumentDocxToFolder(app, settings, synopsis.path, destination.path, "Synopsis");
    assert.equal(outPath, "EW/_Edition/Soumissions/Paquet/Synopsis.docx");
    assert.ok(vault.getAbstractFileByPath(outPath), "le DOCX est créé dans le dossier demandé");
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
    assert.equal(vault.getAbstractFileByPath("EW/_Feuillets/Sortie/Manuscrit.md"), null, "un export EPUB ne doit pas écrire Manuscrit.md");
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
    assert.equal(vault.getAbstractFileByPath("EW/_Feuillets/Sortie/Manuscrit.md"), null, "un export ODT ne doit pas écrire Manuscrit.md");
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
  const { app, settings, manuscript } = makeExportFixture();
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

// =========================================================================
// Tests — Phase 1D : Identité à l'export
// =========================================================================

test("Phase 1D : export : title/author de Page de titre prioritaires", async () => {
  const { resolveExportIdentity } = await import("../src/services/compile-export.js");
  const manuscript = new TFolder("Projet/Manuscrit");
  const frontPageFile = new TFile("Projet/Manuscrit/Front/Page de titre.md");
  const { vault } = createFakeVault([manuscript, frontPageFile]);
  const app = {
    vault,
    metadataCache: {
      getFileCache: (file) => {
        if (file.path === frontPageFile.path) {
          return { frontmatter: { title: "Titre Sur Mesure", author: "Auteur Sur Mesure", type: "titre" } };
        }
        return { frontmatter: {} };
      },
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    manuscriptTitle: "Titre Global Legacy",
    manuscriptAuthor: "Auteur Global Legacy",
    projectMeta: { [manuscript.path]: { type: "fiction", author: "Auteur Meta" } },
  };

  const segments = [{ frontType: "titre", path: frontPageFile.path }];
  const identity = resolveExportIdentity(app, settings, manuscript, segments);

  assert.equal(identity.title, "Titre Sur Mesure", "title de la page de titre prioritaire");
  assert.equal(identity.author, "Auteur Sur Mesure", "author de la page de titre prioritaire");
});

test("Phase 1D : sans auteur dans Page de titre, projectMeta.author prioritaire sur le global", async () => {
  const { resolveExportIdentity } = await import("../src/services/compile-export.js");
  const manuscript = new TFolder("Projet/Manuscrit");
  const frontPageFile = new TFile("Projet/Manuscrit/Front/Page de titre.md");
  const { vault } = createFakeVault([manuscript, frontPageFile]);
  const app = {
    vault,
    metadataCache: {
      getFileCache: (file) => {
        if (file.path === frontPageFile.path) {
          return { frontmatter: { title: "Titre Sur Mesure", author: "", type: "titre" } };
        }
        return { frontmatter: {} };
      },
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    manuscriptTitle: "Titre Global Legacy",
    manuscriptAuthor: "Auteur Global Legacy",
    projectMeta: { [manuscript.path]: { type: "fiction", author: "Auteur Meta" } },
  };

  const segments = [{ frontType: "titre", path: frontPageFile.path }];
  const identity = resolveExportIdentity(app, settings, manuscript, segments);

  assert.equal(identity.title, "Titre Sur Mesure", "title de la page de titre prioritaire");
  assert.equal(identity.author, "Auteur Meta", "projectMeta.author prioritaire sur le global");
});

/* ===================== Ouvrage imbriqué : racine réelle de compilation ===================== */

function createNestedOuvrageFixture(settingsOverrides = {}, { withOpening = false } = {}) {
  const link = (parent, children) => {
    parent.children = children;
    for (const child of children) child.parent = parent;
  };
  const root = new TFolder("WARPI");
  const rootNote = new TFile("WARPI/WARPI.md", "GLOBAL_INTERDIT");
  const globalFront = new TFolder("WARPI/Front");
  const globalTitle = new TFile("WARPI/Front/Page de titre.md", "---\ntype: titre\n---\n:::titre: FRONT_GLOBAL_INTERDIT\n");
  const sibling = new TFolder("WARPI/Autre");
  const siblingChapter = new TFolder("WARPI/Autre/Chapitre A");
  const siblingScene = new TFile("WARPI/Autre/Chapitre A/Scène A.md", "FRERE_INTERDIT");
  const nefes = new TFolder("WARPI/NEFES");
  const nefesFront = new TFolder("WARPI/NEFES/Front");
  const nefesTitle = new TFile("WARPI/NEFES/Front/Page de titre.md", "---\ntype: titre\n---\n:::titre: TITRE_NEFES\n");
  const part = new TFolder("WARPI/NEFES/Subhanallah");
  const chapter = new TFolder("WARPI/NEFES/Subhanallah/Chapitre 1");
  const scene1 = new TFile("WARPI/NEFES/Subhanallah/Chapitre 1/Scene 1.md", "SCENE_NEFES_1");
  const scene2 = new TFile("WARPI/NEFES/Subhanallah/Chapitre 1/Scene 2.md", "SCENE_NEFES_2");
  /* Feuillet direct de la partie Subhanallah : chapitre sous NEFES, mais
     scène d'un « chapitre » Subhanallah si l'on comptait depuis WARPI. */
  const opening = new TFile("WARPI/NEFES/Subhanallah/Ouverture.md", "OUVERTURE_NEFES");
  link(root, [globalFront, sibling, nefes, rootNote]);
  link(globalFront, [globalTitle]);
  link(sibling, [siblingChapter]);
  link(siblingChapter, [siblingScene]);
  link(nefes, [nefesFront, part]);
  link(nefesFront, [nefesTitle]);
  link(part, withOpening ? [opening, chapter] : [chapter]);
  link(chapter, [scene1, scene2]);

  const { vault } = createFakeVault([
    root, rootNote, globalFront, globalTitle, sibling, siblingChapter, siblingScene,
    nefes, nefesFront, nefesTitle, part, chapter, scene1, scene2,
    ...(withOpening ? [opening] : []),
  ]);
  vault.cachedRead = vault.read;
  let writes = 0;
  const origCreate = vault.create.bind(vault);
  const origModify = vault.modify.bind(vault);
  const origCreateFolder = vault.createFolder.bind(vault);
  vault.create = async (...args) => { writes++; return origCreate(...args); };
  vault.modify = async (...args) => { writes++; return origModify(...args); };
  vault.createFolder = async (...args) => { writes++; return origCreateFolder(...args); };

  const frontmatter = new Map([
    [globalTitle.path, { type: "titre" }],
    [nefesTitle.path, { type: "titre" }],
    [scene1.path, { title: "Première scène" }],
    [opening.path, { title: "Ouverture" }],
  ]);
  const app = {
    vault,
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }),
    },
  };
  const settings = {
    projectFolder: root.path,
    level1Role: "parties",
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    projectMeta: { [root.path]: { folderWorkspaces: { NEFES: { version: 1, ouvrage: { version: 1 } } } } },
    ...settingsOverrides,
  };
  return { app, settings, vault, writeCount: () => writes, globalTitle, nefesTitle, scene1, scene2, siblingScene, opening };
}

test("compile : une portée project sur un ouvrage imbriqué part de l'ouvrage, jamais de la racine globale", async () => {
  const { app, settings, vault, writeCount, nefesTitle, scene1, scene2 } = createNestedOuvrageFixture();

  const result = await compile(app, settings, null, { type: "project", projectRoot: "WARPI/NEFES" }, null, { writeOutput: false });

  assert.ok(result);
  assert.match(result.manuscript, /TITRE_NEFES/);
  assert.match(result.manuscript, /SCENE_NEFES_1/);
  assert.match(result.manuscript, /SCENE_NEFES_2/);
  assert.doesNotMatch(result.manuscript, /GLOBAL_INTERDIT/);
  assert.doesNotMatch(result.manuscript, /FRONT_GLOBAL_INTERDIT/);
  assert.doesNotMatch(result.manuscript, /FRERE_INTERDIT/);

  /* NEFES est la profondeur 0 : sa page de titre (son propre Front) ouvre
     le livre, puis Subhanallah (partie, `#`) et Chapitre 1 (chapitre, `##`).
     Aucun titre de dossier de WARPI (Front, Autre, NEFES) ne précède. */
  assert.deepEqual(
    result.segments.map((s) => s.path),
    [nefesTitle.path, null, null, scene1.path, scene2.path]
  );
  assert.equal(result.segments[0].frontType, "titre");
  assert.deepEqual(
    result.segments.filter((s) => s.path === null).map((s) => s.text),
    ["# Subhanallah", "## Chapitre 1"]
  );
  assert.equal(result.segments[1].structuralType, "part");
  assert.doesNotMatch(result.manuscript, /^#+ (WARPI|NEFES|Autre|Front|Chapitre A)\s*$/m);
  assert.doesNotMatch(result.manuscript, /^#+\s*$/m);

  assert.equal(result.outPath, "");
  assert.equal(writeCount(), 0);
  assert.equal(vault.getAbstractFileByPath("WARPI/_Feuillets/Sortie/Manuscrit.md"), null);
});

test("compile : une portée project sur la racine globale compile toujours tout le projet", async () => {
  const { app, settings, writeCount, globalTitle } = createNestedOuvrageFixture();

  const result = await compile(app, settings, null, { type: "project", projectRoot: "WARPI" }, null, { writeOutput: false });

  assert.ok(result);
  assert.match(result.manuscript, /GLOBAL_INTERDIT/);
  assert.match(result.manuscript, /FRONT_GLOBAL_INTERDIT/);
  assert.match(result.manuscript, /FRERE_INTERDIT/);
  assert.match(result.manuscript, /TITRE_NEFES/);
  assert.match(result.manuscript, /SCENE_NEFES_1/);
  assert.match(result.manuscript, /^# Autre$/m);
  assert.match(result.manuscript, /^# NEFES$/m);
  assert.equal(result.segments.find((s) => s.path === globalTitle.path)?.frontType, "titre");
  assert.equal(writeCount(), 0);
});

test("compile : une portée folder rattachée à un ouvrage est calculée relativement à l'ouvrage", async () => {
  const { app, settings, writeCount, scene1, scene2 } = createNestedOuvrageFixture();

  const result = await compile(
    app, settings, null,
    { type: "folder", projectRoot: "WARPI/NEFES", path: "WARPI/NEFES/Subhanallah" },
    null, { writeOutput: false }
  );

  assert.ok(result);
  /* Subhanallah est un enfant direct de NEFES : partie de niveau `#`, et
     non `##` comme elle le serait sous WARPI. */
  assert.deepEqual(result.segments.map((s) => s.path), [null, null, scene1.path, scene2.path]);
  assert.deepEqual(
    result.segments.filter((s) => s.path === null).map((s) => s.text),
    ["# Subhanallah", "## Chapitre 1"]
  );
  assert.doesNotMatch(result.manuscript, /GLOBAL_INTERDIT|FRONT_GLOBAL_INTERDIT|FRERE_INTERDIT|TITRE_NEFES/);
  assert.equal(writeCount(), 0);
});

test("compile : une portée file rattachée à un ouvrage est calculée relativement à l'ouvrage", async () => {
  const { app, settings, writeCount, scene1 } = createNestedOuvrageFixture({ insertSceneTitles: true });

  const result = await compile(
    app, settings, null,
    { type: "file", projectRoot: "WARPI/NEFES", path: scene1.path },
    null, { writeOutput: false }
  );

  assert.ok(result);
  /* Scène de profondeur 2 sous NEFES (Subhanallah/Chapitre 1) : dans un
     ouvrage déclaré, le titre automatique d'une scène descend d'un niveau
     supplémentaire — `####`, jamais `###` (CORRECTIF LOT 4, titres
     automatiques des scènes en H4). */
  assert.deepEqual(result.segments.map((s) => s.path), [scene1.path]);
  assert.equal(result.manuscript, "#### Première scène\n\nSCENE_NEFES_1");
  assert.doesNotMatch(result.manuscript, /GLOBAL_INTERDIT|FRONT_GLOBAL_INTERDIT|FRERE_INTERDIT|TITRE_NEFES|SCENE_NEFES_2/);
  assert.equal(writeCount(), 0);
});

test("compile : un feuillet direct d'une partie d'ouvrage garde son rôle de chapitre relatif à l'ouvrage", async () => {
  const { app, settings, writeCount, opening } = createNestedOuvrageFixture({}, { withOpening: true });

  const result = await compile(
    app, settings, null,
    { type: "file", projectRoot: "WARPI/NEFES", path: opening.path },
    null, { writeOutput: false }
  );

  assert.ok(result);
  /* Sous NEFES, Subhanallah est une partie : Ouverture en est un chapitre
     titré `##`. Calculée depuis WARPI, Subhanallah deviendrait un chapitre
     et Ouverture une scène sans titre. */
  assert.equal(result.manuscript, "## Ouverture\n\nOUVERTURE_NEFES");
  assert.equal(writeCount(), 0);
});

/* ===================== LOT 5A — composition propre à chaque ouvrage ===================== */

test("effectiveComposition : sans composition locale sur NEFES, héritage exact de la composition globale, sans mutation", () => {
  const { app, settings } = createNestedOuvrageFixture();
  const root = app.vault.getAbstractFileByPath("WARPI");
  const nefes = app.vault.getAbstractFileByPath("WARPI/NEFES");

  const global = effectiveComposition(settings, root, root);
  const nefesComposition = effectiveComposition(settings, root, nefes);

  assert.deepEqual(nefesComposition, global);
  assert.equal(
    settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].ouvrage.composition,
    undefined,
    "une simple lecture ne doit jamais matérialiser de composition locale"
  );
});

test("effectiveComposition : une composition locale rend NEFES indépendant de WARPI (portées project, folder et file)", async () => {
  const { app, settings, scene1 } = createNestedOuvrageFixture({}, {});
  const root = app.vault.getAbstractFileByPath("WARPI");
  const nefes = app.vault.getAbstractFileByPath("WARPI/NEFES");
  const chapter = app.vault.getAbstractFileByPath("WARPI/NEFES/Subhanallah/Chapitre 1");

  const global = effectiveComposition(settings, root, root);
  assert.equal(global.folderTitles, true);
  const changed = updateOuvrageComposition(settings, root, nefes, global, {
    folderTitles: false,
    separator: "\n\n***\n\n",
  });
  assert.equal(changed, true);

  // Portée project sur NEFES : composition LOCALE appliquée (pas de titre
  // de partie « Subhanallah », séparateur « *** »).
  const nefesProject = await compile(app, settings, null, { type: "project", projectRoot: nefes.path }, null, { writeOutput: false });
  assert.ok(nefesProject);
  assert.doesNotMatch(nefesProject.manuscript, /Subhanallah/);
  assert.match(nefesProject.manuscript, /\n\n\*\*\*\n\n/);

  // Portée folder toujours DANS NEFES : même composition locale.
  const nefesFolder = await compile(app, settings, null, { type: "folder", projectRoot: nefes.path, path: chapter.path }, null, { writeOutput: false });
  assert.ok(nefesFolder);
  assert.match(nefesFolder.manuscript, /\n\n\*\*\*\n\n/);

  // Portée file toujours DANS NEFES : même composition locale (séparateur
  // sans effet ici — un seul segment — mais la RÉSOLUTION reste celle de
  // NEFES, jamais celle de WARPI).
  const nefesFile = await compile(app, settings, null, { type: "file", projectRoot: nefes.path, path: scene1.path }, null, { writeOutput: false });
  assert.ok(nefesFile);
  assert.equal(effectiveComposition(settings, root, nefes).folderTitles, false);

  // Portée project sur WARPI : SA PROPRE composition globale, inchangée —
  // le titre de partie « Subhanallah » (calculé depuis WARPI, `folderTitles`
  // global toujours vrai) et le séparateur global (« \n\n ») réapparaissent,
  // même si WARPI parcourt aussi le contenu de NEFES.
  const warpiProject = await compile(app, settings, null, { type: "project", projectRoot: root.path }, null, { writeOutput: false });
  assert.ok(warpiProject);
  assert.match(warpiProject.manuscript, /Subhanallah/);
  assert.doesNotMatch(warpiProject.manuscript, /\*\*\*/);
  assert.equal(activePresetConfig(settings).separator, "\n\n", "les réglages globaux (WARPI) restent inchangés");
});

test("updateOuvrageComposition : appliquer un preset à NEFES ne modifie ni le preset actif ni la composition de WARPI", async () => {
  const { app, settings } = createNestedOuvrageFixture();
  const root = app.vault.getAbstractFileByPath("WARPI");
  const nefes = app.vault.getAbstractFileByPath("WARPI/NEFES");
  const global = effectiveComposition(settings, root, root);

  // « Application d'un preset » = copier son sous-ensemble de champs
  // (exactement ceux de PresetConfig) dans la composition de NEFES — le
  // catalogue de presets (compilePresets/activePreset) reste, lui, global.
  const preset = { name: "Poche", fileName: "Poche.md", folderTitles: false, chapterTitles: false, sceneTitles: true, separator: "\n\n* * *\n\n" };
  updateOuvrageComposition(settings, root, nefes, global, {
    fileName: preset.fileName,
    folderTitles: preset.folderTitles,
    chapterTitles: preset.chapterTitles,
    sceneTitles: preset.sceneTitles,
    separator: preset.separator,
  });

  assert.equal(settings.activePreset, -1, "le preset actif de WARPI reste inchangé");
  assert.deepEqual(settings.compilePresets, [], "le catalogue de presets reste global, jamais dupliqué");
  assert.deepEqual(effectiveComposition(settings, root, root), global, "la composition de WARPI reste inchangée");

  const nefesComposition = effectiveComposition(settings, root, nefes);
  assert.equal(nefesComposition.fileName, "Poche.md");
  assert.equal(nefesComposition.folderTitles, false);
  assert.equal(nefesComposition.chapterTitles, false);
  assert.equal(nefesComposition.sceneTitles, true);
  assert.equal(nefesComposition.separator, "\n\n* * *\n\n");
  // Les champs hors preset (hérités à la matérialisation) restent ceux de
  // la composition globale — jamais réinitialisés par l'application du preset.
  assert.equal(nefesComposition.footnoteRenumberOnCompile, global.footnoteRenumberOnCompile);
  assert.equal(nefesComposition.annexes, global.annexes);
});

test("clearOuvrageComposition : « Utiliser les réglages du projet » retire uniquement la composition, NEFES recolle immédiatement à WARPI", async () => {
  const { app, settings } = createNestedOuvrageFixture();
  const root = app.vault.getAbstractFileByPath("WARPI");
  const nefes = app.vault.getAbstractFileByPath("WARPI/NEFES");
  const global = effectiveComposition(settings, root, root);
  updateOuvrageComposition(settings, root, nefes, global, { folderTitles: false, separator: "\n\n***\n\n" });

  const beforeClear = await compile(app, settings, null, { type: "project", projectRoot: nefes.path }, null, { writeOutput: false });
  assert.doesNotMatch(beforeClear.manuscript, /Subhanallah/);

  const removed = clearOuvrageComposition(settings, root, nefes);
  assert.equal(removed, true);
  assert.equal(settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].ouvrage.version, 1, "le statut d'ouvrage lui-même reste enregistré");

  const afterClear = await compile(app, settings, null, { type: "project", projectRoot: nefes.path }, null, { writeOutput: false });
  assert.ok(afterClear);
  assert.match(afterClear.manuscript, /Subhanallah/, "NEFES retrouve immédiatement le titre de partie de la composition globale");
  assert.deepEqual(effectiveComposition(settings, root, nefes), effectiveComposition(settings, root, root));
});

test("effectiveComposition : la Mise en page globale (hors Composition) n'est jamais affectée", () => {
  const { app, settings } = createNestedOuvrageFixture({ exportTemplate: "classique", pdfPageSize: "A5" });
  const root = app.vault.getAbstractFileByPath("WARPI");
  const nefes = app.vault.getAbstractFileByPath("WARPI/NEFES");
  const global = effectiveComposition(settings, root, root);

  updateOuvrageComposition(settings, root, nefes, global, { separator: "***" });
  clearOuvrageComposition(settings, root, nefes);

  assert.equal(settings.exportTemplate, "classique");
  assert.equal(settings.pdfPageSize, "A5");
});

test("exportWithScope : Markdown, DOCX, EPUB et ODT reflètent tous la même composition NEFES (jamais celle de WARPI)", async () => {
  const JSZip = (await import("jszip")).default;
  const { exportWithScope } = await import("../src/services/compile-export.js");

  function makeEl(tag, textContent = "") {
    const node = {
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
      set className(value) { this._attrs.set("class", value); },
      get classList() {
        return {
          contains: (name) => (node._attrs.get("class") || "").split(/\s+/).includes(name),
          add: (...names) => node._attrs.set("class", [...new Set(`${node._attrs.get("class") || ""} ${names.join(" ")}`.trim().split(/\s+/))].join(" ")),
          remove: (...names) => node._attrs.set("class", (node._attrs.get("class") || "").split(/\s+/).filter((n) => !names.includes(n)).join(" ")),
        };
      },
      get innerHTML() { return this.children.length ? this.children.map((c) => c.outerHTML).join("") : this._text; },
      get outerHTML() {
        const attrs = Array.from(this._attrs, ([k, v]) => ` ${k}="${v}"`).join("");
        return `<${tag.toLowerCase()}${attrs}>${this.innerHTML}</${tag.toLowerCase()}>`;
      },
      setAttribute(name, value) { this._attrs.set(name, String(value)); },
      getAttribute(name) { return this._attrs.get(name) ?? null; },
      appendChild(child) { if (child.remove) child.remove(); child.parentElement = this; this.children.push(child); return child; },
      insertBefore(child, referenceNode) {
        if (child.remove) child.remove();
        child.parentElement = node;
        const i = referenceNode ? node.children.indexOf(referenceNode) : -1;
        if (i >= 0) node.children.splice(i, 0, child);
        else node.children.push(child);
        return child;
      },
      remove() {
        if (!this.parentElement) return;
        const i = this.parentElement.children.indexOf(this);
        if (i >= 0) this.parentElement.children.splice(i, 1);
        this.parentElement = null;
      },
      querySelectorAll(sel) {
        const found = [];
        const visit = (n) => {
          for (const child of n.children || []) {
            const tag = child.tagName?.toLowerCase() || "";
            const cls = child.getAttribute?.("class") || "";
            if (sel.startsWith(".") ? cls.split(/\s+/).includes(sel.slice(1)) : tag === sel.toLowerCase()) found.push(child);
            visit(child);
          }
        };
        visit(node);
        return found;
      },
      querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
    };
    return node;
  }
  function fakeRender(markdown, container) {
    for (const block of markdown.split(/\n\n+/)) {
      if (!block.trim()) continue;
      const headingMatch = block.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) { container.appendChild(makeEl(`h${headingMatch[1].length}`, headingMatch[2])); continue; }
      container.appendChild(makeEl("p", block));
    }
  }
  const previousDom = { document: globalThis.document, Node: globalThis.Node, XMLSerializer: globalThis.XMLSerializer, createEl: globalThis.createEl, createDiv: globalThis.createDiv };
  globalThis.document = { createElement: (tag) => makeEl(tag) };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.XMLSerializer = class { serializeToString(n) { return n && typeof n.outerHTML === "string" ? n.outerHTML : String(n?.textContent ?? ""); } };
  globalThis.createEl = (tag, options = {}) => makeEl(tag, options.text || "");
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  const previousRenderer = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => fakeRender(markdown, container);

  try {
    const { app, settings, vault } = createNestedOuvrageFixture();
    const root = app.vault.getAbstractFileByPath("WARPI");
    const nefes = app.vault.getAbstractFileByPath("WARPI/NEFES");
    const global = effectiveComposition(settings, root, root);
    // folderTitles désactivé UNIQUEMENT pour NEFES : "Subhanallah" ne doit
    // apparaître dans AUCUN format tant que la portée cible NEFES.
    updateOuvrageComposition(settings, root, nefes, global, { folderTitles: false });

    const nefesScope = { type: "project", projectRoot: nefes.path };
    const mdPath = await exportWithScope(app, settings, nefesScope, "md", "NefesMd");
    const mdText = vault.getAbstractFileByPath(mdPath).content;
    assert.doesNotMatch(mdText, /Subhanallah/);
    assert.match(mdText, /SCENE_NEFES_1/);

    const docxPath = await exportWithScope(app, settings, nefesScope, "docx", "NefesDocx");
    const docxBytes = vault.getAbstractFileByPath(docxPath).content;
    const docxXml = await (await JSZip.loadAsync(docxBytes)).file("word/document.xml").async("string");
    assert.doesNotMatch(docxXml, /Subhanallah/);
    assert.match(docxXml, /SCENE_NEFES_1/);

    const epubPath = await exportWithScope(app, settings, nefesScope, "epub", "NefesEpub");
    const epubBytes = vault.getAbstractFileByPath(epubPath).content;
    const epubXml = await (await JSZip.loadAsync(epubBytes)).file("OEBPS/chapitres.xhtml").async("string");
    assert.doesNotMatch(epubXml, /Subhanallah/);
    assert.match(epubXml, /SCENE_NEFES_1/);

    const odtPath = await exportWithScope(app, settings, nefesScope, "odt", "NefesOdt");
    const odtBytes = vault.getAbstractFileByPath(odtPath).content;
    const odtXml = await (await JSZip.loadAsync(odtBytes)).file("content.xml").async("string");
    assert.doesNotMatch(odtXml, /Subhanallah/);
    assert.match(odtXml, /SCENE_NEFES_1/);

    // WARPI, lui, garde son titre de partie dans tous les formats : la
    // composition locale de NEFES ne l'atteint jamais.
    const warpiScope = { type: "project", projectRoot: root.path };
    const warpiMdPath = await exportWithScope(app, settings, warpiScope, "md", "WarpiMd");
    const warpiMdText = vault.getAbstractFileByPath(warpiMdPath).content;
    assert.match(warpiMdText, /Subhanallah/);
  } finally {
    MarkdownRenderer.render = previousRenderer;
    Object.assign(globalThis, previousDom);
  }
});

/* ===================== COMPLÉMENT LOT 5A — inventaire exhaustif de Composition ===================== */

test("effectiveComposition : WARPI et NEFES aux valeurs opposées pour CHAQUE groupe de réglages — la compilation NEFES n'utilise aucune valeur de WARPI", async () => {
  const link = (parent, children) => {
    parent.children = children;
    for (const child of children) child.parent = parent;
  };
  const root = new TFolder("WARPI");
  const globalFront = new TFolder("WARPI/Front");
  const globalTitle = new TFile("WARPI/Front/Page de titre.md", "---\ntype: titre\n---\n:::titre: TITRE_WARPI\n");
  const nefes = new TFolder("WARPI/NEFES");
  const nefesFront = new TFolder("WARPI/NEFES/Front");
  const nefesTitle = new TFile("WARPI/NEFES/Front/Page de titre.md", "---\ntype: titre\n---\n:::titre: TITRE_NEFES\n");
  /* PartieA est un enfant DIRECT de NEFES (profondeur 1) : c'est exactement
     le niveau que tranche `level1Role` (ni profondeur ≥ 2 → toujours
     "chapitre", ni la racine éditoriale elle-même) — voir
     folderCompositionRole() dans compile-export.ts. Scene1/Scene2 sont
     DIRECTEMENT dans PartieA (pas de sous-dossier) : leur propre rôle
     (scène si PartieA est un chapitre, chapitre sinon) dépend ainsi
     ENTIÈREMENT de la résolution de `level1Role` pour NEFES. */
  const partieA = new TFolder("WARPI/NEFES/PartieA");
  const scene1 = new TFile("WARPI/NEFES/PartieA/Scene1.md", "Texte un[^1].\n\n[^1]: Note un.");
  const scene2 = new TFile("WARPI/NEFES/PartieA/Scene2.md", "Texte deux[^1].\n\n[^1]: Note deux.");
  const annexes = new TFolder("WARPI/NEFES/Annexes");
  const annexeFile = new TFile("WARPI/NEFES/Annexes/AnnexeScene.md", "Contenu annexe.");

  link(root, [globalFront, nefes]);
  link(globalFront, [globalTitle]);
  link(nefes, [nefesFront, partieA, annexes]);
  link(nefesFront, [nefesTitle]);
  link(partieA, [scene1, scene2]);
  link(annexes, [annexeFile]);

  const { vault } = createFakeVault([
    root, globalFront, globalTitle, nefes, nefesFront, nefesTitle, partieA, scene1, scene2, annexes, annexeFile,
  ]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([
    [globalTitle.path, { type: "titre" }],
    [nefesTitle.path, { type: "titre" }],
    [scene1.path, { title: "Scene1" }],
    [scene2.path, { title: "Scene2" }],
  ]);
  const app = { vault, metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) } };

  const settings = {
    projectFolder: root.path,
    level1Role: "parties",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    autoRename: true,
    renamePrefix: "chapitre",
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: false,
    separator: "\n\n",
    footnoteRenumberOnCompile: true,
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    projectMeta: { [root.path]: { folderWorkspaces: { NEFES: { version: 1, ouvrage: { version: 1 } } } } },
  };

  const warpi = app.vault.getAbstractFileByPath("WARPI");
  const nefesFolder = app.vault.getAbstractFileByPath("WARPI/NEFES");
  const globalComposition = effectiveComposition(settings, warpi, warpi);

  /* Valeurs strictement OPPOSÉES à WARPI pour les 16 champs de
     OuvrageCompositionConfig, un par un — voir la liste exacte dans
     types.d.ts. */
  const nefesOverride = {
    fileName: "NefesSortie.md",
    level1Role: "chapitres",
    chapterNumbering: "parPartie",
    sceneNumbering: "continue",
    autoRename: false,
    renamePrefix: "partie",
    folderTitles: false,
    chapterTitles: false,
    sceneTitles: true,
    separator: "\n\n>>>NEFES<<<\n\n",
    footnoteRenumberOnCompile: false,
    summary: true,
    tables: true,
    toc: true,
    bibliography: true,
    annexes: true,
  };

  // Le patch de test couvre EXACTEMENT les 16 champs du type, chacun
  // effectivement opposé à la valeur de WARPI — sinon ce test ne prouve
  // rien pour le champ oublié.
  const fields = Object.keys(globalComposition);
  assert.deepEqual([...fields].sort(), Object.keys(nefesOverride).sort());
  for (const key of fields) {
    assert.notDeepEqual(nefesOverride[key], globalComposition[key], `valeur de test non opposée pour ${key}`);
  }

  const changed = updateOuvrageComposition(settings, warpi, nefesFolder, globalComposition, nefesOverride);
  assert.equal(changed, true);

  // 1. Au niveau de la composition résolue : chaque champ de NEFES est
  // exactement celui du patch, jamais celui de WARPI — et WARPI reste
  // rigoureusement intact.
  const nefesComposition = effectiveComposition(settings, warpi, nefesFolder);
  for (const key of fields) {
    assert.equal(nefesComposition[key], nefesOverride[key], `composition NEFES : ${key} doit venir de NEFES`);
    assert.notDeepEqual(nefesComposition[key], globalComposition[key], `composition NEFES : ${key} ne doit jamais provenir de WARPI`);
  }
  assert.deepEqual(effectiveComposition(settings, warpi, warpi), globalComposition, "la composition de WARPI reste inchangée");

  // 2. Au niveau de la compilation réelle : chaque champ observable dans le
  // texte compilé reflète bien NEFES, jamais WARPI.
  const result = await compile(app, settings, null, { type: "project", projectRoot: nefesFolder.path }, null, { writeOutput: false });
  assert.ok(result);

  // folderTitles/chapterTitles désactivés chez NEFES : aucun TITRE de
  // dossier « PartieA » n'apparaît (les identifiants de notes de bas de
  // page dérivés du CHEMIN du feuillet contiennent, eux, littéralement
  // "PartieA" — ce n'est pas un titre, exclu explicitement ici).
  assert.doesNotMatch(result.manuscript, /^#{1,6} .*PartieA/m);
  /* level1Role = "chapitres" chez NEFES : PartieA (profondeur 1) devient un
     CHAPITRE, ses feuillets deviennent des SCÈNES — sceneTitles (vrai chez
     NEFES) affiche donc leur titre, TOUJOURS en H4 absolu (LOT 4). Si
     level1Role avait fui la valeur de WARPI ("parties"), PartieA serait
     resté une partie, ses feuillets un rôle CHAPITRE — titre masqué,
     chapterTitles étant faux chez NEFES : cette assertion échouerait. */
  assert.match(result.manuscript, /#### Scene1/);
  assert.match(result.manuscript, /#### Scene2/);
  // separator NEFES, jamais celui de WARPI (« \n\n » n'aurait rien de
  // reconnaissable, le marqueur NEFES, lui, est sans ambiguïté).
  assert.match(result.manuscript, /\n\n>>>NEFES<<<\n\n/);
  // footnoteRenumberOnCompile désactivé chez NEFES : jamais de
  // renumérotation croisée en [^2] (chaque feuillet garde son propre
  // espace de numérotation interne).
  assert.doesNotMatch(result.manuscript, /\[\^2\]/);
  // annexes incluses chez NEFES.
  assert.match(result.manuscript, /# Annexes/);
  assert.match(result.manuscript, /Contenu annexe/);
  // sommaire et table des matières inclus chez NEFES — seule l'inclusion
  // nous intéresse ici (le texte exact relève de contents-generator.ts,
  // déjà testé ailleurs).
  assert.ok(result.segments.some((s) => s.generatedType === "summary"), "Sommaire absent alors que la composition NEFES l'inclut");
  assert.ok(result.segments.some((s) => s.generatedType === "toc"), "Table des matières absente alors que la composition NEFES l'inclut");

  // Contre-épreuve pour footnoteRenumberOnCompile : la même portée NEFES,
  // composition locale retirée (retour à l'héritage global, WARPI
  // renumérote), DOIT cette fois produire un [^2] — sans quoi l'absence
  // observée ci-dessus ne prouverait rien.
  const removed = clearOuvrageComposition(settings, warpi, nefesFolder);
  assert.equal(removed, true);
  const resultAfterClear = await compile(app, settings, null, { type: "project", projectRoot: nefesFolder.path }, null, { writeOutput: false });
  assert.ok(resultAfterClear);
  assert.match(resultAfterClear.manuscript, /\[\^2\]/, "avec la composition globale de WARPI (renumérotation activée), [^2] doit apparaître");
  // Restaure la composition locale pour la suite du test.
  updateOuvrageComposition(settings, warpi, nefesFolder, globalComposition, nefesOverride);

  // 3. Nom de fichier : une compilation ÉCRITE (pas writeOutput:false)
  // utilise le fileName de NEFES, jamais « Manuscrit.md ».
  const written = await compile(app, settings, null, { type: "project", projectRoot: nefesFolder.path }, null);
  assert.ok(written);
  assert.match(written.outPath, /NefesSortie\.md$/);

  // 4. WARPI, lui, garde strictement sa propre composition : aucune trace
  // du marqueur de séparateur de NEFES dans sa propre compilation.
  const warpiResult = await compile(app, settings, null, { type: "project", projectRoot: warpi.path }, null, { writeOutput: false });
  assert.ok(warpiResult);
  assert.doesNotMatch(warpiResult.manuscript, />>>NEFES<<</);
});

test("compile-export.ts : aucune fonction parallèle de calcul des rôles — roleOfFolder/roleOfFile de folder-structure.ts, jamais une copie locale", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/services/compile-export.ts", "utf8");
  assert.doesNotMatch(source, /folderCompositionRole/);
  assert.doesNotMatch(source, /fileCompositionRole/);
  assert.match(source, /roleOfFolder\(app, settings, child, editorialRoot, composition\.level1Role\)/);
  assert.match(source, /roleOfFile\(app, settings, child, editorialRoot, composition\.level1Role\)/);
});

test("compile : les portées folder et file hors ouvrage restent calculées depuis la racine globale", async () => {
  const { app, settings, siblingScene } = createNestedOuvrageFixture();

  const folderResult = await compile(
    app, settings, null,
    { type: "folder", projectRoot: "WARPI", path: "WARPI/Autre" },
    null, { writeOutput: false }
  );
  assert.ok(folderResult);
  assert.deepEqual(folderResult.segments.map((s) => s.path), [null, null, siblingScene.path]);
  assert.deepEqual(
    folderResult.segments.filter((s) => s.path === null).map((s) => s.text),
    ["# Autre", "## Chapitre A"]
  );
  assert.doesNotMatch(folderResult.manuscript, /GLOBAL_INTERDIT|TITRE_NEFES|SCENE_NEFES/);

  const fileResult = await compile(
    app, settings, null,
    { type: "file", projectRoot: "WARPI", path: siblingScene.path },
    null, { writeOutput: false }
  );
  assert.ok(fileResult);
  assert.equal(fileResult.manuscript, "FRERE_INTERDIT");
});

/* ===================== CORRECTIF LOT 4 — titres automatiques des scènes en H4 ===================== */

function createTitleBumpFixture({ withOuvrage = true, insertSceneTitles = true, sceneContent = "AL_RAHMAN_TEXTE" } = {}) {
  const link = (parent, children) => {
    parent.children = children;
    for (const child of children) child.parent = parent;
  };
  /* Hors ouvrage (withOuvrage: false) : PAS de niveau NEFES intercalaire —
     `nefes` DÉSIGNE alors la racine globale elle-même, pour comparer les
     deux scénarios à EXACTEMENT la même profondeur Partie/Chapitre/Scène
     (jamais une profondeur artificiellement creusée d'un cran par un
     dossier NEFES resté présent mais non déclaré). */
  const root = new TFolder("WARPI");
  const nefes = withOuvrage ? new TFolder("WARPI/NEFES") : root;
  const part = new TFolder(`${nefes.path}/Subhanallah`);
  const chapter = new TFolder(`${part.path}/Chapitre 1`);
  const scene = new TFile(`${chapter.path}/Al-Rahman.md`, sceneContent);
  if (withOuvrage) link(root, [nefes]);
  link(nefes, [part]);
  link(part, [chapter]);
  link(chapter, [scene]);

  const entries = withOuvrage ? [root, nefes, part, chapter, scene] : [root, part, chapter, scene];
  const { vault } = createFakeVault(entries);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([[scene.path, { title: "Al-Rahman" }]]);
  const app = {
    vault,
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
  };
  const settings = {
    projectFolder: root.path,
    level1Role: "parties",
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    projectMeta: withOuvrage ? { [root.path]: { folderWorkspaces: { NEFES: { version: 1, ouvrage: { version: 1 } } } } } : {},
  };
  return { app, settings, root, nefes, part, chapter, scene };
}

test("compile : dans un ouvrage déclaré, le titre automatique d'une scène est généré en H4 — identique en portée project, folder et file", async () => {
  const { app, settings, nefes, chapter, scene } = createTitleBumpFixture();

  const projectResult = await compile(app, settings, null, { type: "project", projectRoot: nefes.path }, null, { writeOutput: false });
  assert.ok(projectResult);
  assert.deepEqual(
    projectResult.segments.filter((s) => s.path === null).map((s) => s.text),
    ["# Subhanallah", "## Chapitre 1"],
    "la partie reste en H1 et le chapitre en H2"
  );
  assert.equal(projectResult.manuscript, "# Subhanallah\n\n## Chapitre 1\n\n#### Al-Rahman\n\nAL_RAHMAN_TEXTE");

  const folderResult = await compile(app, settings, null, { type: "folder", projectRoot: nefes.path, path: chapter.path }, null, { writeOutput: false });
  assert.ok(folderResult);
  assert.equal(folderResult.manuscript, "## Chapitre 1\n\n#### Al-Rahman\n\nAL_RAHMAN_TEXTE");

  const fileResult = await compile(app, settings, null, { type: "file", projectRoot: nefes.path, path: scene.path }, null, { writeOutput: false });
  assert.ok(fileResult);
  assert.equal(fileResult.manuscript, "#### Al-Rahman\n\nAL_RAHMAN_TEXTE");
});

test("compile : hors ouvrage aussi, le titre automatique d'une scène est généré en H4 (RECTIFICATION LOT 4 — niveau absolu, plus jamais H3)", async () => {
  const { app, settings, nefes } = createTitleBumpFixture({ withOuvrage: false });

  const result = await compile(app, settings, null, { type: "project", projectRoot: nefes.path }, null, { writeOutput: false });

  assert.ok(result);
  assert.equal(result.manuscript, "# Subhanallah\n\n## Chapitre 1\n\n#### Al-Rahman\n\nAL_RAHMAN_TEXTE");
});

test("compile : une scène plus profondément nichée reste en H4, jamais H5 — le niveau est absolu, pas depth + 1", async () => {
  const link = (parent, children) => {
    parent.children = children;
    for (const child of children) child.parent = parent;
  };
  const root = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const part = new TFolder("WARPI/NEFES/Subhanallah");
  const subPart = new TFolder("WARPI/NEFES/Subhanallah/Sous-partie");
  const chapter = new TFolder("WARPI/NEFES/Subhanallah/Sous-partie/Chapitre 1");
  const scene = new TFile("WARPI/NEFES/Subhanallah/Sous-partie/Chapitre 1/Al-Rahman.md", "AL_RAHMAN_TEXTE");
  link(root, [nefes]);
  link(nefes, [part]);
  link(part, [subPart]);
  link(subPart, [chapter]);
  link(chapter, [scene]);

  const { vault } = createFakeVault([root, nefes, part, subPart, chapter, scene]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([[scene.path, { title: "Al-Rahman" }]]);
  const app = {
    vault,
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
  };
  const settings = {
    projectFolder: root.path,
    level1Role: "parties",
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    projectMeta: { [root.path]: { folderWorkspaces: { NEFES: { version: 1, ouvrage: { version: 1 } } } } },
  };

  const result = await compile(app, settings, null, { type: "project", projectRoot: nefes.path }, null, { writeOutput: false });

  assert.ok(result);
  /* Un niveau de dossier supplémentaire (Sous-partie) avant le chapitre :
     un calcul dérivé de la profondeur du parcours (depth + 1, ou tout
     variante qui en dépendrait) pourrait descendre au-delà de H4 selon la
     façon dont ce niveau intermédiaire est compté. Le niveau du titre de
     scène est ABSOLU (role === "scene" → 4) : il reste H4, jamais H5 ni
     davantage, quel que soit le nombre de dossiers traversés. */
  assert.match(result.manuscript, /#### Al-Rahman\n\nAL_RAHMAN_TEXTE$/);
  assert.doesNotMatch(result.manuscript, /##### Al-Rahman/);
});

test("compile : dans un ouvrage, un titre H2 déjà écrit à la main dans le contenu de la scène n'est jamais remplacé par le H4 automatique", async () => {
  const { app, settings, nefes } = createTitleBumpFixture({
    sceneContent: "## Titre écrit à la main\n\nTexte de la scène.",
  });

  const result = await compile(app, settings, null, { type: "project", projectRoot: nefes.path }, null, { writeOutput: false });

  assert.ok(result);
  assert.match(result.manuscript, /## Titre écrit à la main\n\nTexte de la scène\.$/);
  assert.doesNotMatch(result.manuscript, /####/);
});

test("compile : dans un ouvrage, un titre composé sur deux lignes (H2 + H3 manuels) est conservé sans modification", async () => {
  const { app, settings, nefes } = createTitleBumpFixture({
    sceneContent: "## Titre principal\n\n### Sous-titre\n\nTexte de la scène.",
  });

  const result = await compile(app, settings, null, { type: "project", projectRoot: nefes.path }, null, { writeOutput: false });

  assert.ok(result);
  assert.match(result.manuscript, /## Titre principal\n\n### Sous-titre\n\nTexte de la scène\.$/);
  assert.doesNotMatch(result.manuscript, /####/);
});

test("compile : dans un ouvrage, aucun titre automatique de scène n'est généré quand les titres de scènes sont désactivés", async () => {
  const { app, settings, nefes } = createTitleBumpFixture({ insertSceneTitles: false });

  const result = await compile(app, settings, null, { type: "project", projectRoot: nefes.path }, null, { writeOutput: false });

  assert.ok(result);
  assert.equal(result.manuscript, "# Subhanallah\n\n## Chapitre 1\n\nAL_RAHMAN_TEXTE");
  assert.doesNotMatch(result.manuscript, /#### Al-Rahman/);
});

/* ===================== NATIVE EXPORT CITATIONS (DOCX, EPUB, ODT, PDF) ===================== */

function createCitationTextNode(textValue, parent = null) {
  return {
    nodeType: 3,
    _value: textValue,
    parentElement: parent,
    get nodeValue() {
      return this._value;
    },
    set nodeValue(v) {
      this._value = String(v);
    },
    get textContent() {
      return this._value;
    },
    set textContent(v) {
      this._value = String(v);
    },
    cloneNode() {
      return createCitationTextNode(this._value, this.parentElement);
    },
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.childNodes.indexOf(this);
        if (idx >= 0) this.parentElement.childNodes.splice(idx, 1);
        this.parentElement = null;
      }
    },
  };
}

class FakeCitationEl {
  constructor(tag, textContent = "") {
    this.tagName = tag.toUpperCase();
    this._attrs = new Map();
    this.parentElement = null;
    this.childNodes = [];
    this.style = {};
    this.scrollHeight = 0;
    this.clientHeight = 1000;
    this.scrollWidth = 0;
    this.clientWidth = 1000;
    if (textContent) {
      this.childNodes.push(createCitationTextNode(textContent, this));
    }
  }

  get nodeType() {
    return 1;
  }

  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }

  set textContent(v) {
    this.childNodes = [createCitationTextNode(String(v), this)];
  }

  get attributes() {
    return Array.from(this._attrs, ([name, value]) => ({ name, value }));
  }

  get className() {
    return this._attrs.get("class") || "";
  }

  set className(v) {
    this._attrs.set("class", String(v));
  }

  get classList() {
    const self = this;
    return {
      contains: (name) => (self.className || "").split(/\s+/).includes(name),
      add: (...names) => {
        const cur = (self.className || "").trim().split(/\s+/).filter(Boolean);
        self.className = [...new Set([...cur, ...names])].join(" ");
      },
      remove: (...names) => {
        const cur = (self.className || "").trim().split(/\s+/).filter(Boolean);
        self.className = cur.filter((n) => !names.includes(n)).join(" ");
      },
    };
  }

  get innerHTML() {
    if (this._rawHtml !== undefined) return this._rawHtml;
    return this.childNodes
      .map((c) => (c.nodeType === 3 ? c.textContent : c.outerHTML))
      .join("");
  }

  set innerHTML(v) {
    this._rawHtml = v;
    this.childNodes = [createCitationTextNode(String(v), this)];
  }

  get outerHTML() {
    if (this._rawHtml !== undefined) return this._rawHtml;
    const attrs = Array.from(this._attrs, ([k, v]) => ` ${k}="${v}"`).join("");
    return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this._attrs.get(name) ?? null;
  }

  removeAttribute(name) {
    this._attrs.delete(name);
  }

  appendChild(child) {
    if (child.remove) child.remove();
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, referenceNode) {
    if (child.remove) child.remove();
    child.parentElement = this;
    const idx = referenceNode ? this.childNodes.indexOf(referenceNode) : -1;
    if (idx >= 0) {
      this.childNodes.splice(idx, 0, child);
    } else {
      this.childNodes.push(child);
    }
    return child;
  }

  prepend(child) {
    return this.insertBefore(child, this.childNodes[0] || null);
  }

  after(newNode) {
    if (!this.parentElement) return;
    const idx = this.parentElement.childNodes.indexOf(this);
    if (idx >= 0) {
      this.parentElement.childNodes.splice(idx + 1, 0, newNode);
      newNode.parentElement = this.parentElement;
    }
  }

  remove() {
    if (!this.parentElement) return;
    const idx = this.parentElement.childNodes.indexOf(this);
    if (idx >= 0) this.parentElement.childNodes.splice(idx, 1);
    this.parentElement = null;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  cloneNode(deep = false) {
    const clone = new FakeCitationEl(this.tagName);
    for (const [k, v] of this._attrs) {
      clone.setAttribute(k, v);
    }
    if (deep) {
      for (const child of this.childNodes) {
        if (child.nodeType === 3) {
          clone.appendChild(createCitationTextNode(child.textContent, clone));
        } else if (child.cloneNode) {
          clone.appendChild(child.cloneNode(true));
        }
      }
    }
    return clone;
  }

  matches(sel) {
    const tag = this.tagName.toLowerCase();
    const cls = this.className || "";
    if (sel.startsWith(".")) {
      return cls.split(/\s+/).includes(sel.slice(1));
    }
    if (sel.includes(".")) {
      const [t, ...cList] = sel.split(".");
      if (t && tag !== t.toLowerCase()) return false;
      return cList.every((c) => cls.split(/\s+/).includes(c));
    }
    if (sel.includes("[") && sel.endsWith("]")) {
      const [t, attrWithBrackets] = sel.split("[");
      const attrName = attrWithBrackets.slice(0, -1);
      if (t && tag !== t.toLowerCase()) return false;
      return this._attrs.has(attrName);
    }
    return tag === sel.toLowerCase();
  }

  querySelectorAll(sel) {
    const selectors = sel.split(",").map((s) => s.trim());
    const found = [];
    const visit = (n) => {
      for (const child of n.children) {
        if (selectors.some((s) => child.matches(s))) {
          found.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

function setupCitationExportDom() {
  const frames = [];
  const body = new FakeCitationEl("body");
  body.createEl = (tag, options = {}) => {
    if (tag === "iframe") {
      const frame = new FakeCitationEl("iframe");
      const contentDoc = {
        documentElement: null,
        head: null,
        body: null,
        open() {
          this.documentElement = null;
          this.head = null;
          this.body = null;
        },
        close() {},
        importNode(node) {
          return node;
        },
        replaceChildren(htmlEl) {
          this.documentElement = htmlEl;
          this.head = htmlEl.children.find((c) => c.tagName === "HEAD") || null;
          this.body = htmlEl.children.find((c) => c.tagName === "BODY") || null;
        },
      };
      frame.contentDocument = contentDoc;
      frame.contentWindow = {
        focus() {},
        print() {},
      };
      frames.push(frame);
      body.appendChild(frame);
      return frame;
    }
    const el = new FakeCitationEl(tag, options.text || "");
    if (options.cls) el.className = options.cls;
    body.appendChild(el);
    return el;
  };

  const prevDom = {
    document: globalThis.document,
    Node: globalThis.Node,
    XMLSerializer: globalThis.XMLSerializer,
    DOMParser: globalThis.DOMParser,
    createEl: globalThis.createEl,
    createDiv: globalThis.createDiv,
    PlatformIsMobile: Platform.isMobile,
    window: globalThis.window,
  };

  Platform.isMobile = false;

  globalThis.window = {
    setTimeout(callback) {
      callback();
      return 0;
    },
  };

  globalThis.document = {
    body,
    createElement: (tag) => new FakeCitationEl(tag),
  };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.XMLSerializer = class {
    serializeToString(n) {
      return n && typeof n.outerHTML === "string" ? n.outerHTML : String(n?.textContent ?? "");
    }
  };
  globalThis.DOMParser = class {
    parseFromString(html) {
      if (/^<html>/.test(html)) {
        const htmlEl = new FakeCitationEl("html");
        const headEl = new FakeCitationEl("head");
        const bodyEl = new FakeCitationEl("body");
        htmlEl.appendChild(headEl);
        htmlEl.appendChild(bodyEl);
        headEl.appendChild(new FakeCitationEl("title"));
        headEl.appendChild(new FakeCitationEl("style"));
        return { documentElement: htmlEl, body: bodyEl };
      }
      const bodyEl = new FakeCitationEl("body");
      const wrapper = new FakeCitationEl("div");
      wrapper.innerHTML = html;
      bodyEl.appendChild(wrapper);
      return { body: bodyEl };
    }
  };
  globalThis.createEl = (tag, options = {}) => {
    const el = new FakeCitationEl(tag, options.text || "");
    if (options.cls) el.className = options.cls;
    return el;
  };
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);

  const prevRenderer = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    for (const block of markdown.split(/\n\n+/)) {
      if (!block.trim()) continue;
      if (block.startsWith("[^1]:")) {
        const fnSec = new FakeCitationEl("section");
        fnSec.className = "footnotes";
        const ol = new FakeCitationEl("ol");
        const li = new FakeCitationEl("li");
        li.setAttribute("id", "fn1");
        const p = new FakeCitationEl("p", block.replace(/^\[\^1\]:\s*/, ""));
        const a = new FakeCitationEl("a", "↩");
        a.className = "footnote-backref";
        a.setAttribute("href", "#fnref1");
        p.appendChild(a);
        li.appendChild(p);
        ol.appendChild(li);
        fnSec.appendChild(ol);
        container.appendChild(fnSec);
        continue;
      }
      const headingMatch = block.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        container.appendChild(new FakeCitationEl(`h${headingMatch[1].length}`, headingMatch[2]));
        continue;
      }
      container.appendChild(new FakeCitationEl("p", block));
    }
  };

  return {
    frames,
    restore() {
      MarkdownRenderer.render = prevRenderer;
      Platform.isMobile = prevDom.PlatformIsMobile;
      globalThis.document = prevDom.document;
      globalThis.Node = prevDom.Node;
      globalThis.XMLSerializer = prevDom.XMLSerializer;
      globalThis.DOMParser = prevDom.DOMParser;
      globalThis.createEl = prevDom.createEl;
      globalThis.createDiv = prevDom.createDiv;
      globalThis.window = prevDom.window;
    },
  };
}

function createCitationExportFixture() {
  const project = new TFolder("Project");
  const projectResearch = new TFolder("Project/_Recherche");
  const projectBib = new TFile("Project/_Recherche/project.bib");
  projectBib.content = `@article{sharedKey,
  author = {ProjectAuthor},
  year = {2020},
  title = {Project Title}
}
@article{projectOnlyKey,
  author = {ProjectSolo},
  year = {2019},
  title = {Solo Title}
}`;
  projectBib.stat = { mtime: 1000 };
  projectResearch.children = [projectBib];
  projectBib.parent = projectResearch;

  const workA = new TFolder("Project/Work-A");
  const workAResearch = new TFolder("Project/Work-A/_Recherche");
  const workABib = new TFile("Project/Work-A/_Recherche/workA.bib");
  workABib.content = `@article{sharedKey,
  author = {WorkAAuthor},
  year = {2023},
  title = {Work A Title}
}`;
  workABib.stat = { mtime: 1000 };
  workAResearch.children = [workABib];
  workABib.parent = workAResearch;

  const chapterA = new TFolder("Project/Work-A/Chapter-A");
  const chapterAResearch = new TFolder("Project/Work-A/Chapter-A/_Recherche");
  const chapterABib = new TFile("Project/Work-A/Chapter-A/_Recherche/chapterA.bib");
  chapterABib.content = `@article{sharedKey,
  author = {ChapterAuthor},
  year = {2024},
  title = {Chapter A Title}
}`;
  chapterABib.stat = { mtime: 1000 };
  chapterAResearch.children = [chapterABib];
  chapterABib.parent = chapterAResearch;

  const docA = new TFile("Project/Work-A/Chapter-A/Document-A.md");
  docA.content = "Document A cite [@sharedKey], alien [@workBKey], unknown [@unknownKey] and note[^1].\n\n[^1]: Footnote cite [@sharedKey].";
  docA.stat = { mtime: 1000 };
  chapterA.children = [chapterAResearch, docA];
  docA.parent = chapterA;
  chapterAResearch.parent = chapterA;

  const docWorkA = new TFile("Project/Work-A/Scene-Direct.md");
  docWorkA.content = "Work direct cite [@sharedKey].";
  docWorkA.stat = { mtime: 1000 };
  workA.children = [workAResearch, chapterA, docWorkA];
  docWorkA.parent = workA;
  chapterA.parent = workA;
  workAResearch.parent = workA;

  const workB = new TFolder("Project/Work-B");
  const workBResearch = new TFolder("Project/Work-B/_Recherche");
  const workBBib = new TFile("Project/Work-B/_Recherche/workB.bib");
  workBBib.content = `@article{workBKey,
  author = {WorkBAuthor},
  year = {2025},
  title = {Work B Title}
}`;
  workBBib.stat = { mtime: 1000 };
  workBResearch.children = [workBBib];
  workBBib.parent = workBResearch;

  const docB = new TFile("Project/Work-B/Document-B.md");
  docB.content = "Work B cite [@workBKey] and [@sharedKey].";
  docB.stat = { mtime: 1000 };
  workB.children = [workBResearch, docB];
  docB.parent = workB;
  workBResearch.parent = workB;

  project.children = [projectResearch, workA, workB];
  projectResearch.parent = project;
  workA.parent = project;
  workB.parent = project;

  const { vault } = createFakeVault([
    project,
    projectResearch,
    projectBib,
    workA,
    workAResearch,
    workABib,
    chapterA,
    chapterAResearch,
    chapterABib,
    docA,
    docWorkA,
    workB,
    workBResearch,
    workBBib,
    docB,
  ]);
  vault.cachedRead = vault.read;

  const app = {
    vault,
    metadataCache: {
      getFileCache() {
        return { frontmatter: {} };
      },
    },
  };

  const settings = {
    projectFolder: project.path,
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
    projectMeta: {
      [project.path]: {
        pandocCitationPreviewStyle: "author-date",
        researchFolderLinks: {
          [project.path]: projectResearch.path,
          [workA.path]: workAResearch.path,
          [chapterA.path]: chapterAResearch.path,
          [workB.path]: workBResearch.path,
        },
        citekeyBibliographyPath: "project.bib",
        folderWorkspaces: {
          "Work-A": {
            version: 1,
            citekeyBibliographyPath: "workA.bib",
          },
          "Work-A/Chapter-A": {
            version: 1,
            citekeyBibliographyPath: "chapterA.bib",
          },
          "Work-B": {
            version: 1,
            citekeyBibliographyPath: "workB.bib",
          },
        },
      },
    },
  };

  return { app, settings, vault, project, workA, chapterA, docA, docWorkA, workB, docB };
}

test("exportWithScope (file scope) : DOCX, EPUB, ODT et PDF formatent les citations avec le .bib le plus proche (Chapter-A)", async () => {
  const JSZip = (await import("jszip")).default;
  const dom = setupCitationExportDom();

  try {
    const { app, settings, vault, project, docA } = createCitationExportFixture();
    const scope = { type: "file", projectRoot: project.path, path: docA.path };

    // 1. DOCX
    const docxPath = await exportWithScope(app, settings, scope, "docx", "OutputDocx");
    assert.ok(docxPath);
    const docxData = vault.getAbstractFileByPath(docxPath).content;
    const docxZip = await JSZip.loadAsync(docxData);
    const docxXml = await docxZip.file("word/document.xml").async("string");
    const docxFnXml = docxZip.file("word/footnotes.xml")
      ? await docxZip.file("word/footnotes.xml").async("string")
      : "";

    // Nearest .bib (Chapter-A) must win over Work-A and Project
    assert.match(docxXml, /\(ChapterAuthor, 2024\)/);
    assert.doesNotMatch(docxXml, /\[@sharedKey\]/);
    assert.doesNotMatch(docxXml, /WorkAAuthor/);
    assert.doesNotMatch(docxXml, /ProjectAuthor/);
    // Footnote cite must be formatted
    assert.match(docxFnXml, /\(ChapterAuthor, 2024\)/);
    assert.doesNotMatch(docxFnXml, /\[@sharedKey\]/);
    // Work-B citekey must not leak and remain raw
    assert.match(docxXml, /\[@workBKey\]/);
    assert.doesNotMatch(docxXml, /WorkBAuthor/);
    // Unknown citekey must remain raw
    assert.match(docxXml, /\[@unknownKey\]/);

    // 2. EPUB
    const epubPath = await exportWithScope(app, settings, scope, "epub", "OutputEpub");
    assert.ok(epubPath);
    const epubData = vault.getAbstractFileByPath(epubPath).content;
    const epubZip = await JSZip.loadAsync(epubData);
    const epubXml = await epubZip.file("OEBPS/chapitres.xhtml").async("string");

    assert.match(epubXml, /\(ChapterAuthor, 2024\)/);
    assert.doesNotMatch(epubXml, /\[@sharedKey\]/);
    assert.doesNotMatch(epubXml, /WorkAAuthor/);
    assert.doesNotMatch(epubXml, /ProjectAuthor/);
    assert.match(epubXml, /<li id="fn1">[\s\S]*\(ChapterAuthor, 2024\)[\s\S]*<\/li>/);
    assert.match(epubXml, /\[@workBKey\]/);
    assert.match(epubXml, /\[@unknownKey\]/);

    // 3. ODT
    const odtPath = await exportWithScope(app, settings, scope, "odt", "OutputOdt");
    assert.ok(odtPath);
    const odtData = vault.getAbstractFileByPath(odtPath).content;
    const odtZip = await JSZip.loadAsync(odtData);
    const odtXml = await odtZip.file("content.xml").async("string");

    assert.match(odtXml, /\(ChapterAuthor, 2024\)/);
    assert.doesNotMatch(odtXml, /\[@sharedKey\]/);
    assert.doesNotMatch(odtXml, /WorkAAuthor/);
    assert.doesNotMatch(odtXml, /ProjectAuthor/);
    assert.match(odtXml, /Footnote cite \(ChapterAuthor, 2024\)/);
    assert.match(odtXml, /\[@workBKey\]/);
    assert.match(odtXml, /\[@unknownKey\]/);

    // 4. PDF
    await exportWithScope(app, settings, scope, "pdf", "OutputPdf");
    assert.ok(dom.frames.length >= 1);
    const pdfHtml = dom.frames[dom.frames.length - 1].contentDocument.body.innerHTML;

    assert.match(pdfHtml, /\(ChapterAuthor, 2024\)/);
    assert.doesNotMatch(pdfHtml, /\[@sharedKey\]/);
    assert.doesNotMatch(pdfHtml, /WorkAAuthor/);
    assert.doesNotMatch(pdfHtml, /ProjectAuthor/);
    assert.match(pdfHtml, /\[@workBKey\]/);
    assert.match(pdfHtml, /\[@unknownKey\]/);
  } finally {
    dom.restore();
  }
});

test("exportWithScope (folder scope) : export de Work-A utilise la configuration bibliographique de Work-A", async () => {
  const JSZip = (await import("jszip")).default;
  const dom = setupCitationExportDom();

  try {
    const { app, settings, vault, project, workA } = createCitationExportFixture();
    const scope = { type: "folder", projectRoot: project.path, path: workA.path };

    const docxPath = await exportWithScope(app, settings, scope, "docx", "WorkADocx");
    assert.ok(docxPath);
    const docxData = vault.getAbstractFileByPath(docxPath).content;
    const docxZip = await JSZip.loadAsync(docxData);
    const docxXml = await docxZip.file("word/document.xml").async("string");

    // Work-A folder scope resolves Work-A .bib (WorkAAuthor, 2023)
    assert.match(docxXml, /\(WorkAAuthor, 2023\)/);
    assert.doesNotMatch(docxXml, /\[@sharedKey\]/);
    assert.doesNotMatch(docxXml, /ProjectAuthor/);
  } finally {
    dom.restore();
  }
});

test("exportWithScope (project scope) : export du projet complet utilise le .bib du projet", async () => {
  const JSZip = (await import("jszip")).default;
  const dom = setupCitationExportDom();

  try {
    const { app, settings, vault, project } = createCitationExportFixture();
    const scope = { type: "project", projectRoot: project.path };

    const docxPath = await exportWithScope(app, settings, scope, "docx", "ProjectDocx");
    assert.ok(docxPath);
    const docxData = vault.getAbstractFileByPath(docxPath).content;
    const docxZip = await JSZip.loadAsync(docxData);
    const docxXml = await docxZip.file("word/document.xml").async("string");

    // Project scope resolves Project .bib (ProjectAuthor, 2020)
    assert.match(docxXml, /\(ProjectAuthor, 2020\)/);
    assert.doesNotMatch(docxXml, /\[@sharedKey\]/);
  } finally {
    dom.restore();
  }
});

test("exportWithScope : fail-closed si la cible de portée n'existe plus (aucune bibliographie ni repli projet)", async () => {
  const JSZip = (await import("jszip")).default;
  const dom = setupCitationExportDom();

  try {
    const { app, settings, vault, project } = createCitationExportFixture();
    // Scope pointing to deleted file
    const scope = { type: "file", projectRoot: project.path, path: "Project/Work-A/Chapter-A/Deleted.md" };

    const docxPath = await exportWithScope(app, settings, scope, "docx", "FailClosedDocx");
    if (docxPath) {
      const docxData = vault.getAbstractFileByPath(docxPath).content;
      const docxZip = await JSZip.loadAsync(docxData);
      const docxXml = await docxZip.file("word/document.xml").async("string");
      // Must not use project .bib nor any other .bib
      assert.doesNotMatch(docxXml, /ProjectAuthor|WorkAAuthor|ChapterAuthor/);
    }
  } finally {
    dom.restore();
  }
});

test("exportWithScope (format md) : conserve toujours les citekeys brutes [@citekey]", async () => {
  const dom = setupCitationExportDom();

  try {
    const { app, settings, vault, project, docA } = createCitationExportFixture();
    const scope = { type: "file", projectRoot: project.path, path: docA.path };

    const mdPath = await exportWithScope(app, settings, scope, "md", "OutputMd");
    assert.ok(mdPath);
    const mdText = vault.getAbstractFileByPath(mdPath).content;

    // Markdown export must preserve raw citekeys
    assert.match(mdText, /\[@sharedKey\]/);
    assert.match(mdText, /\[@workBKey\]/);
    assert.match(mdText, /\[@unknownKey\]/);
    assert.doesNotMatch(mdText, /\(ChapterAuthor, 2024\)/);
  } finally {
    dom.restore();
  }
});

test("exportWithScope : pandocCitationPreviewStyle = 'off' conserve les citekeys brutes dans les exports natifs", async () => {
  const JSZip = (await import("jszip")).default;
  const dom = setupCitationExportDom();

  try {
    const { app, settings, vault, project, docA } = createCitationExportFixture();
    settings.projectMeta[project.path].pandocCitationPreviewStyle = "off";
    const scope = { type: "file", projectRoot: project.path, path: docA.path };

    const docxPath = await exportWithScope(app, settings, scope, "docx", "OffDocx");
    assert.ok(docxPath);
    const docxData = vault.getAbstractFileByPath(docxPath).content;
    const docxZip = await JSZip.loadAsync(docxData);
    const docxXml = await docxZip.file("word/document.xml").async("string");

    assert.match(docxXml, /\[@sharedKey\]/);
    assert.doesNotMatch(docxXml, /ChapterAuthor/);

    const epubPath = await exportWithScope(app, settings, scope, "epub", "OffEpub");
    assert.ok(epubPath);
    const epubData = vault.getAbstractFileByPath(epubPath).content;
    const epubZip = await JSZip.loadAsync(epubData);
    const epubXml = await epubZip.file("OEBPS/chapitres.xhtml").async("string");

    assert.match(epubXml, /\[@sharedKey\]/);
    assert.doesNotMatch(epubXml, /ChapterAuthor/);

    const odtPath = await exportWithScope(app, settings, scope, "odt", "OffOdt");
    assert.ok(odtPath);
    const odtData = vault.getAbstractFileByPath(odtPath).content;
    const odtZip = await JSZip.loadAsync(odtData);
    const odtXml = await odtZip.file("content.xml").async("string");

    assert.match(odtXml, /\[@sharedKey\]/);
    assert.doesNotMatch(odtXml, /ChapterAuthor/);
  } finally {
    dom.restore();
  }
});
