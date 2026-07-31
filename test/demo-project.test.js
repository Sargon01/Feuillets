import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { Notice, TFile, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { createFakeVault } = await import(modulePath("test/helpers/fake-vault.js"));
const { DEFAULT_SETTINGS } = await import(modulePath("src/default-settings.js"));
const { createDemoProject } = await import(modulePath("src/services/demo-project.js"));

const ELIRA_ROOT = "Feuillets — Exemple";
const ELIRA_MANUSCRIPT = `${ELIRA_ROOT}/Manuscrit`;
const CANDIDE_ROOT = "Candide, ou l'Optimisme — Exemple";
const CANDIDE_MANUSCRIPT = `${CANDIDE_ROOT}/Manuscrit`;

function createSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function createContext({ entries = [], failCreate = null, projectMeta } = {}) {
  const { vault, fileManager, files } = createFakeVault(entries);
  const originalCreateFolder = vault.createFolder.bind(vault);
  const originalModify = vault.modify.bind(vault);
  const originalDelete = vault.delete.bind(vault);
  const originalProcessFrontMatter = fileManager.processFrontMatter.bind(fileManager);
  const originalCreate = vault.create.bind(vault);
  const calls = { save: 0, render: 0, folders: [], creates: [], modifies: [], frontmatters: [], deletes: 0 };
  vault.createFolder = async (path) => {
    calls.folders.push(path);
    return originalCreateFolder(path);
  };
  vault.create = async (path, content) => {
    calls.creates.push(path);
    if (failCreate?.(path)) throw new Error("échec volontaire");
    return originalCreate(path, content);
  };
  vault.modify = async (file, content) => {
    calls.modifies.push(file.path);
    return originalModify(file, content);
  };
  vault.delete = async (file) => {
    calls.deletes += 1;
    return originalDelete(file);
  };
  fileManager.processFrontMatter = async (file, update) => {
    calls.frontmatters.push(file.path);
    return originalProcessFrontMatter(file, update);
  };
  const settings = createSettings();
  settings.projectFolder = "Projet actif";
  if (projectMeta !== undefined) settings.projectMeta = projectMeta;
  const plugin = {
    async saveSettings() { calls.save += 1; },
    renderAllViews(force) { assert.equal(force, true); calls.render += 1; },
  };
  return { app: { vault, fileManager }, settings, plugin, files, calls };
}

function expectFile(files, path) {
  const file = files.get(path);
  assert.ok(file, `fichier attendu : ${path}`);
  return file;
}

function globalSettings(settings) {
  return {
    level1Role: settings.level1Role,
    chapterNumbering: settings.chapterNumbering,
    sceneNumbering: settings.sceneNumbering,
    boardMode: settings.boardMode,
    cardContent: settings.cardContent,
    mergeYamlPreset: settings.mergeYamlPreset,
  };
}

function setDistinctGlobals(settings) {
  Object.assign(settings, {
    level1Role: "chapitres",
    chapterNumbering: "aucune",
    sceneNumbering: "continue",
    boardMode: "timeline",
    cardContent: "extrait",
    mergeYamlPreset: "personnalise",
  });
  return globalSettings(settings);
}

test("createDemoProject conserve les métadonnées créées après une génération réussie", async () => {
  const { app, settings, plugin, files, calls } = createContext();
  const previousGlobals = setDistinctGlobals(settings);
  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    await createDemoProject(app, settings, plugin, "elira");
  } finally {
    Notice.onCreate = previousNotice;
  }

  assert.deepEqual(settings.projectMeta[ELIRA_MANUSCRIPT], {
    type: "fiction",
    author: "Auteur d'exemple",
    description: "Projet généré automatiquement pour explorer toutes les fonctionnalités de Feuillets.",
  });
  assert.deepEqual(settings.projects, [ELIRA_MANUSCRIPT]);
  assert.equal(settings.projectFolder, "Projet actif");
  assert.deepEqual(globalSettings(settings), previousGlobals);
  assert.ok(files.get(ELIRA_ROOT) instanceof TFolder);
  assert.ok(files.get(ELIRA_MANUSCRIPT) instanceof TFolder);
  expectFile(files, `${ELIRA_MANUSCRIPT}/Front/Dédicace.md`);
  expectFile(files, `${ELIRA_MANUSCRIPT}/Partie 1 - Les commencements/Chapitre 1 - Le départ/1. Ouverture.md`);
  expectFile(files, `${ELIRA_ROOT}/Recherche/Characters/Elira Voskan.md`);
  for (const path of ["Recherche", "Ressources", "Journal", "Snapshots", "Manuscrit/Front"]) {
    assert.ok(files.get(`${ELIRA_ROOT}/${path}`) instanceof TFolder, `dossier attendu : ${path}`);
  }
  assert.ok([...files.keys()].some((path) => path.startsWith(`${ELIRA_ROOT}/Journal/`)));
  assert.ok([...files.keys()].some((path) => path.startsWith(`${ELIRA_ROOT}/Snapshots/1. Ouverture/`)));
  assert.match(expectFile(files, `${ELIRA_MANUSCRIPT}/Front/Dédicace.md`).content, /^---\ntitle: Dédicace\n/m);
  assert.match(expectFile(files, `${ELIRA_MANUSCRIPT}/Partie 1 - Les commencements/Chapitre 1 - Le départ/1. Ouverture.md`).content, /^---\ntitle: Ouverture\n[\s\S]*?order: 1\n/m);
  assert.ok(calls.folders.includes(`${ELIRA_ROOT}/Recherche`));
  assert.ok(calls.folders.includes(`${ELIRA_ROOT}/Journal`));
  assert.equal(calls.frontmatters.length, 2);
  assert.ok(calls.save > 0);
  assert.equal(calls.render, 1);
  assert.equal(notices.some((message) => message.startsWith("Projet d'exemple créé")), true);
});

test("createDemoProject (elira) : structure conforme aux nouveaux projets, avec parcours guidé", async () => {
  const { app, settings, plugin, files } = createContext();
  const previousGlobals = setDistinctGlobals(settings);
  const previousNotice = Notice.onCreate;
  Notice.onCreate = () => {};

  try {
    await createDemoProject(app, settings, plugin, "elira");
  } finally {
    Notice.onCreate = previousNotice;
  }
  void previousGlobals;

  // Racine réelle : Recherche et Ressources en frères de Manuscrit, jamais
  // sous l'ancien nom anglais, jamais à l'intérieur de Manuscrit.
  assert.ok(files.get(`${ELIRA_ROOT}/Recherche`) instanceof TFolder);
  assert.ok(files.get(`${ELIRA_ROOT}/Ressources`) instanceof TFolder);
  assert.equal(files.has(`${ELIRA_ROOT}/Research`), false);
  assert.equal(files.has(`${ELIRA_ROOT}/Resources`), false);
  assert.equal(files.has(`${ELIRA_MANUSCRIPT}/Recherche`), false);
  assert.equal(files.has(`${ELIRA_MANUSCRIPT}/Ressources`), false);

  // Les 5 sous-dossiers Ressources exacts.
  for (const sub of ["Images", "Template", "Layout", "Export", "Assets"]) {
    assert.ok(files.get(`${ELIRA_ROOT}/Ressources/${sub}`) instanceof TFolder, `Ressources/${sub} manquant`);
  }

  // Page de titre du Front.
  expectFile(files, `${ELIRA_MANUSCRIPT}/Front/Page de titre.md`);

  // Mini-parcours guidé : présent dans le Lisez-moi, avec les 4 étapes et
  // les libellés réels de l'interface.
  const readme = expectFile(files, `${ELIRA_ROOT}/Lisez-moi.md`);
  assert.match(readme.content, /Parcours guidé en 4 étapes/);
  assert.match(readme.content, /Créer une scène/);
  assert.match(readme.content, /Compiler le manuscrit/);
  assert.match(readme.content, /Dupliquer comme nouvelle version/);
  assert.match(readme.content, /facultatif/i);
  assert.match(readme.content, /Ouvrir un dossier existant/);
});

test("createDemoProject retire les métadonnées créées après un échec", async () => {
  const { app, settings, plugin, files, calls } = createContext({
    failCreate: (path) => path.endsWith("Front/Dédicace.md"),
  });
  const previousGlobals = setDistinctGlobals(settings);
  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    await createDemoProject(app, settings, plugin, "elira");
  } finally {
    Notice.onCreate = previousNotice;
  }

  assert.equal(Object.hasOwn(settings.projectMeta, ELIRA_MANUSCRIPT), false);
  assert.equal(settings.projects.includes(ELIRA_MANUSCRIPT), false);
  assert.equal(settings.projectFolder, "Projet actif");
  assert.deepEqual(globalSettings(settings), previousGlobals);
  assert.ok(files.has(ELIRA_ROOT));
  assert.ok(files.has(ELIRA_MANUSCRIPT));
  assert.equal(calls.deletes, 0);
  assert.ok(calls.save > 0);
  assert.equal(calls.render, 1);
  assert.equal(notices.some((message) => message.startsWith("Échec de la génération")), true);
});

test("createDemoProject restaure la métadonnée existante après un échec", async () => {
  const previous = { type: "nonfiction", author: "Ancien auteur", description: "Ancien projet" };
  const { app, settings, plugin } = createContext({
    projectMeta: { [ELIRA_MANUSCRIPT]: previous },
    failCreate: (path) => path.endsWith("Front/Dédicace.md"),
  });
  const previousGlobals = setDistinctGlobals(settings);

  await createDemoProject(app, settings, plugin, "elira");

  assert.strictEqual(settings.projectMeta[ELIRA_MANUSCRIPT], previous);
  assert.equal(settings.projects.includes(ELIRA_MANUSCRIPT), false);
  assert.equal(settings.projectFolder, "Projet actif");
  assert.deepEqual(globalSettings(settings), previousGlobals);
});

test("createDemoProject génère Candide avec ses chapitres, son Front et sa Recherche", async () => {
  const { app, settings, plugin, files } = createContext();
  const previousGlobals = setDistinctGlobals(settings);

  await createDemoProject(app, settings, plugin, "candide");

  assert.deepEqual(settings.projectMeta[CANDIDE_MANUSCRIPT], {
    type: "fiction",
    author: "Voltaire",
    description: "Candide, ou l'Optimisme (1759) — domaine public — projet d'exemple pour explorer le panneau Chemin de fer (labels, fils, personnages) sur un vrai texte plutôt qu'un squelette minimal.",
  });
  assert.deepEqual(settings.projects, [CANDIDE_MANUSCRIPT]);
  assert.equal(settings.projectFolder, "Projet actif");
  assert.deepEqual(globalSettings(settings), previousGlobals);
  for (const path of ["Recherche", "Ressources", "Journal", "Snapshots", "Manuscrit/Front"]) {
    assert.ok(files.get(`${CANDIDE_ROOT}/${path}`) instanceof TFolder, `dossier attendu : ${path}`);
  }
  expectFile(files, `${CANDIDE_MANUSCRIPT}/Front/00. Note d'édition.md`);
  const chapter = expectFile(files, `${CANDIDE_MANUSCRIPT}/Partie 1 - L'Ancien Monde/01. Chapitre 1 — Éducation de Candide.md`);
  assert.match(chapter.content, /^---\ntitle: "Chapitre 1 — Éducation de Candide"\n/m);
  assert.match(chapter.content, /Il y avait en Vestphalie/);
  expectFile(files, `${CANDIDE_ROOT}/Recherche/Characters/Candide.md`);
  assert.equal([...files.keys()].filter((path) => path.includes(`${CANDIDE_MANUSCRIPT}/Partie `) && path.endsWith(".md")).length, 30);
});

test("createDemoProject refuse un dossier cible existant sans écrire", async () => {
  const { app, settings, plugin, calls } = createContext({ entries: [new TFolder(ELIRA_ROOT)] });
  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    await createDemoProject(app, settings, plugin, "elira");
  } finally {
    Notice.onCreate = previousNotice;
  }

  assert.deepEqual(calls.folders, []);
  assert.deepEqual(calls.creates, []);
  assert.equal(calls.save, 0);
  assert.equal(calls.render, 0);
  assert.deepEqual(settings.projects, []);
  assert.equal(notices.some((message) => message.includes("existe déjà")), true);
});

test("createDemoProject ne remplace pas un fichier d'exemple existant", async () => {
  const dedication = new TFile(`${ELIRA_MANUSCRIPT}/Front/Dédicace.md`, "contenu existant");
  const { app, settings, plugin, files, calls } = createContext({ entries: [dedication] });

  await createDemoProject(app, settings, plugin, "elira");

  assert.strictEqual(files.get(dedication.path), dedication);
  assert.equal(dedication.content, "contenu existant");
  assert.equal(calls.modifies.includes(dedication.path), false);
});
