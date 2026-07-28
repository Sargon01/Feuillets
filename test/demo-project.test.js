import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { Notice, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { createFakeVault } = await import(modulePath("test/helpers/fake-vault.js"));
const { DEFAULT_SETTINGS } = await import(modulePath("src/default-settings.js"));
const { createDemoProject } = await import(modulePath("src/services/demo-project.js"));

const ELIRA_ROOT = "Feuillets — Exemple";
const ELIRA_MANUSCRIPT = `${ELIRA_ROOT}/Manuscrit`;

function createSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function createContext({ entries = [], failCreate = null, projectMeta } = {}) {
  const { vault, fileManager, files } = createFakeVault(entries);
  const originalCreate = vault.create.bind(vault);
  if (failCreate) {
    vault.create = async (path, content) => {
      if (failCreate(path)) throw new Error("échec volontaire");
      return originalCreate(path, content);
    };
  }
  const settings = createSettings();
  settings.projectFolder = "Projet actif";
  if (projectMeta !== undefined) settings.projectMeta = projectMeta;
  const calls = { save: 0, render: 0 };
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

test("createDemoProject conserve les métadonnées créées après une génération réussie", async () => {
  const { app, settings, plugin, files, calls } = createContext();
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
  assert.ok(files.get(ELIRA_ROOT) instanceof TFolder);
  assert.ok(files.get(ELIRA_MANUSCRIPT) instanceof TFolder);
  expectFile(files, `${ELIRA_MANUSCRIPT}/Front/Dédicace.md`);
  expectFile(files, `${ELIRA_MANUSCRIPT}/Partie 1 - Les commencements/Chapitre 1 - Le départ/1. Ouverture.md`);
  expectFile(files, `${ELIRA_ROOT}/Research/Characters/Elira Voskan.md`);
  assert.ok([...files.keys()].some((path) => path.startsWith(`${ELIRA_ROOT}/Journal/`)));
  assert.ok([...files.keys()].some((path) => path.startsWith(`${ELIRA_ROOT}/Snapshots/1. Ouverture/`)));
  assert.match(expectFile(files, `${ELIRA_MANUSCRIPT}/Front/Dédicace.md`).content, /^---\ntitle: Dédicace\n/m);
  assert.ok(calls.save > 0);
  assert.equal(calls.render, 1);
  assert.equal(notices.some((message) => message.startsWith("Projet d'exemple créé")), true);
});

test("createDemoProject retire les métadonnées créées après un échec", async () => {
  const { app, settings, plugin, files, calls } = createContext({
    failCreate: (path) => path.endsWith("Front/Dédicace.md"),
  });
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
  assert.ok(files.has(ELIRA_ROOT));
  assert.ok(files.has(ELIRA_MANUSCRIPT));
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

  await createDemoProject(app, settings, plugin, "elira");

  assert.strictEqual(settings.projectMeta[ELIRA_MANUSCRIPT], previous);
  assert.equal(settings.projects.includes(ELIRA_MANUSCRIPT), false);
  assert.equal(settings.projectFolder, "Projet actif");
});
