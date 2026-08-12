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
    await createDemoProject(app, settings, plugin);
  } finally {
    Notice.onCreate = previousNotice;
  }

  assert.deepEqual(settings.projectMeta[CANDIDE_MANUSCRIPT], {
    type: "fiction",
    author: "Voltaire",
    description: "Candide, ou l'Optimisme (1759) — domaine public — projet d'exemple pour explorer le panneau Chemin de fer (labels, fils, personnages) sur un vrai texte plutôt qu'un squelette minimal.",
  });
  assert.deepEqual(settings.projects, [CANDIDE_MANUSCRIPT]);
  assert.equal(settings.projectFolder, "Projet actif");
  assert.deepEqual(globalSettings(settings), previousGlobals);
  assert.ok(files.get(CANDIDE_ROOT) instanceof TFolder);
  assert.ok(files.get(CANDIDE_MANUSCRIPT) instanceof TFolder);
  expectFile(files, `${CANDIDE_MANUSCRIPT}/Front/00. Note d'édition.md`);
  expectFile(files, `${CANDIDE_MANUSCRIPT}/Partie 1 - L'Ancien Monde/01. Chapitre 1 — Éducation de Candide.md`);
  expectFile(files, `${CANDIDE_ROOT}/_Feuillets/Recherche/Personnages/Candide.md`);
  assert.ok(calls.save > 0);
  assert.equal(calls.render, 1);
  assert.equal(notices.some((message) => message.startsWith("Projet d'exemple créé")), true);

  // Aucun dossier auxiliaire lazy (Journal, Snapshots) n'est créé au démarrage.
  assert.equal(files.has(`${CANDIDE_ROOT}/_Feuillets/Journal`), false);
  assert.equal(files.has(`${CANDIDE_ROOT}/_Feuillets/Snapshots`), false);
});

test("createDemoProject : structure conforme aux projets canoniques", async () => {
  const { app, settings, plugin, files } = createContext();
  const previousGlobals = setDistinctGlobals(settings);
  const previousNotice = Notice.onCreate;
  Notice.onCreate = () => {};

  try {
    await createDemoProject(app, settings, plugin);
  } finally {
    Notice.onCreate = previousNotice;
  }
  void previousGlobals;

  // Racine réelle : Recherche et Ressources sous _Feuillets, jamais sous
  // l'ancien nom anglais, jamais à l'intérieur de Manuscrit.
  assert.ok(files.get(`${CANDIDE_ROOT}/_Feuillets/Recherche`) instanceof TFolder);
  assert.ok(files.get(`${CANDIDE_ROOT}/_Feuillets/Ressources`) instanceof TFolder);
  assert.equal(files.has(`${CANDIDE_ROOT}/Research`), false);
  assert.equal(files.has(`${CANDIDE_ROOT}/Resources`), false);
  assert.equal(files.has(`${CANDIDE_MANUSCRIPT}/_Recherche`), false);
  assert.equal(files.has(`${CANDIDE_MANUSCRIPT}/_Ressources`), false);

  // Les 5 sous-dossiers Ressources exacts.
  for (const sub of ["Images", "Modèles", "Mises en page", "Exports", "Ressources internes"]) {
    assert.ok(files.get(`${CANDIDE_ROOT}/_Feuillets/Ressources/${sub}`) instanceof TFolder, `Ressources/${sub} manquant`);
  }

  // Catégories de Recherche sous leur nom physique canonique uniquement —
  // jamais de doublon Characters/Places à côté de Personnages/Lieux.
  assert.equal(files.has(`${CANDIDE_ROOT}/_Feuillets/Recherche/Characters`), false);
  assert.equal(files.has(`${CANDIDE_ROOT}/_Feuillets/Recherche/Places`), false);
  assert.ok(files.get(`${CANDIDE_ROOT}/_Feuillets/Recherche/Personnages`) instanceof TFolder);
  assert.ok(files.get(`${CANDIDE_ROOT}/_Feuillets/Recherche/Lieux`) instanceof TFolder);
  for (const name of ["Cacambo", "Candide", "Cunégonde", "Docteur Pangloss", "Jacques", "La Vieille", "Martin"]) {
    expectFile(files, `${CANDIDE_ROOT}/_Feuillets/Recherche/Personnages/${name}.md`);
  }
  for (const name of ["Château de Thunder-ten-tronckh", "Eldorado", "La Métairie", "Lisbonne"]) {
    expectFile(files, `${CANDIDE_ROOT}/_Feuillets/Recherche/Lieux/${name}.md`);
  }
  // Événements, Glossaire, Lore restent présents (posés par la structure
  // canonique par défaut, indépendamment du correctif Personnages/Lieux).
  assert.ok(files.get(`${CANDIDE_ROOT}/_Feuillets/Recherche/Événements`) instanceof TFolder);
  assert.ok(files.get(`${CANDIDE_ROOT}/_Feuillets/Recherche/Glossaire`) instanceof TFolder);
  assert.ok(files.get(`${CANDIDE_ROOT}/_Feuillets/Recherche/Lore`) instanceof TFolder);
  expectFile(files, `${CANDIDE_ROOT}/_Feuillets/Recherche/Lore/Il faut cultiver notre jardin.md`);

  // Aucun dossier Backups n'est créé directement par la génération Candide
  // (bootstrap lazy — voir feuilletsAuxiliaryPath/FEUILLETS_AUXILIARY_FOLDERS).
  assert.equal(files.has(`${CANDIDE_ROOT}/_Feuillets/Backups`), false);

  // Page de titre / Note d'édition du Front.
  expectFile(files, `${CANDIDE_MANUSCRIPT}/Front/00. Note d'édition.md`);

  // Lisez-moi réduit à une introduction courte : ce qu'est Candide, où
  // écrire, Binder/Recherche, Aperçu/Édition/export — pas de catalogue
  // exhaustif des fonctions de Feuillets.
  const readme = expectFile(files, `${CANDIDE_ROOT}/Lisez-moi.md`);
  assert.match(readme.content, /Candide/);
  assert.match(readme.content, /Où écrire/);
  assert.match(readme.content, /Binder/);
  assert.match(readme.content, /Recherche/);
  assert.match(readme.content, /Compiler le manuscrit/);
  assert.match(readme.content, /Exporter/);
});

test("createDemoProject retire les métadonnées créées après un échec", async () => {
  const { app, settings, plugin, files, calls } = createContext({
    failCreate: (path) => path.endsWith("Front/00. Note d'édition.md"),
  });
  const previousGlobals = setDistinctGlobals(settings);
  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    await createDemoProject(app, settings, plugin);
  } finally {
    Notice.onCreate = previousNotice;
  }

  assert.equal(Object.hasOwn(settings.projectMeta, CANDIDE_MANUSCRIPT), false);
  assert.equal(settings.projects.includes(CANDIDE_MANUSCRIPT), false);
  assert.equal(settings.projectFolder, "Projet actif");
  assert.deepEqual(globalSettings(settings), previousGlobals);
  assert.ok(files.has(CANDIDE_ROOT));
  assert.ok(files.has(CANDIDE_MANUSCRIPT));
  assert.equal(calls.deletes, 0);
  assert.ok(calls.save > 0);
  assert.equal(calls.render, 1);
  assert.equal(notices.some((message) => message.startsWith("Échec de la génération")), true);
});

test("createDemoProject restaure la métadonnée existante après un échec", async () => {
  const previous = { type: "nonfiction", author: "Ancien auteur", description: "Ancien projet" };
  const { app, settings, plugin } = createContext({
    projectMeta: { [CANDIDE_MANUSCRIPT]: previous },
    failCreate: (path) => path.endsWith("Front/00. Note d'édition.md"),
  });
  const previousGlobals = setDistinctGlobals(settings);

  await createDemoProject(app, settings, plugin);

  assert.strictEqual(settings.projectMeta[CANDIDE_MANUSCRIPT], previous);
  assert.equal(settings.projects.includes(CANDIDE_MANUSCRIPT), false);
  assert.equal(settings.projectFolder, "Projet actif");
  assert.deepEqual(globalSettings(settings), previousGlobals);
});

test("createDemoProject génère Candide avec ses 30 chapitres, son Front et sa Recherche", async () => {
  const { app, settings, plugin, files } = createContext();
  const previousGlobals = setDistinctGlobals(settings);

  await createDemoProject(app, settings, plugin);

  assert.deepEqual(settings.projectMeta[CANDIDE_MANUSCRIPT], {
    type: "fiction",
    author: "Voltaire",
    description: "Candide, ou l'Optimisme (1759) — domaine public — projet d'exemple pour explorer le panneau Chemin de fer (labels, fils, personnages) sur un vrai texte plutôt qu'un squelette minimal.",
  });
  assert.deepEqual(settings.projects, [CANDIDE_MANUSCRIPT]);
  assert.equal(settings.projectFolder, "Projet actif");
  assert.deepEqual(globalSettings(settings), previousGlobals);
  for (const path of ["_Feuillets/Recherche", "_Feuillets/Ressources", "Manuscrit/Front"]) {
    assert.ok(files.get(`${CANDIDE_ROOT}/${path}`) instanceof TFolder, `dossier attendu : ${path}`);
  }
  expectFile(files, `${CANDIDE_MANUSCRIPT}/Front/00. Note d'édition.md`);
  const chapter = expectFile(files, `${CANDIDE_MANUSCRIPT}/Partie 1 - L'Ancien Monde/01. Chapitre 1 — Éducation de Candide.md`);
  assert.match(chapter.content, /^---\ntitle: "Chapitre 1 — Éducation de Candide"\n/m);
  assert.match(chapter.content, /Il y avait en Vestphalie/);
  expectFile(files, `${CANDIDE_ROOT}/_Feuillets/Recherche/Personnages/Candide.md`);
  assert.equal([...files.keys()].filter((path) => path.includes(`${CANDIDE_MANUSCRIPT}/Partie `) && path.endsWith(".md")).length, 30);
});

test("createDemoProject refuse un dossier cible existant sans écrire", async () => {
  const { app, settings, plugin, calls } = createContext({ entries: [new TFolder(CANDIDE_ROOT)] });
  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    await createDemoProject(app, settings, plugin);
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
  const editionNote = new TFile(`${CANDIDE_MANUSCRIPT}/Front/00. Note d'édition.md`, "contenu existant");
  const { app, settings, plugin, files, calls } = createContext({ entries: [editionNote] });

  await createDemoProject(app, settings, plugin);

  assert.strictEqual(files.get(editionNote.path), editionNote);
  assert.equal(editionNote.content, "contenu existant");
  assert.equal(calls.modifies.includes(editionNote.path), false);
});
