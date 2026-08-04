import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { ResearchView } from "../src/views/research-view.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
    this.value = "";
  }

  addClass(className) {
    this.classes.add(className);
  }

  createDiv(options = {}) {
    const child = new FakeElement(options);
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    this.children.push(child);
    return child;
  }

  addEventListener(type, callback) {
    this.events ||= new Map();
    this.events.set(type, callback);
  }

  setText(text) {
    this.text = String(text);
  }

  empty() {
    this.children = [];
  }

  contains() {
    return false;
  }
}

function createView(plugin, vault = {}) {
  const contentEl = new FakeElement();
  const leaf = { app: { vault }, contentEl };
  return new ResearchView(leaf, plugin);
}

test("ResearchView affiche l'état vide sans dossier de projet", async () => {
  const view = createView({ getProjectFolder: () => null });
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };

  try {
    await view.render();
  } finally {
    globalThis.document = previousDocument;
  }

  assert.equal(view.contentEl.classes.has("feuillets-research-container"), true);
  assert.equal(view.contentEl.children.length, 1);
  assert.equal(view.contentEl.children[0].classes.has("feuillets-empty"), true);
});

test("ResearchView conserve le rendu du fichier encore présent", async () => {
  const root = new TFolder("Projet");
  const file = new TFile("Projet/_Recherche/note.md");
  const view = createView(
    { getProjectFolder: () => root },
    { getAbstractFileByPath: (path) => (path === file.path ? file : null) }
  );
  view.viewingFile = file;
  let rendered;
  view.renderFileView = async (container, currentFile, currentRoot) => {
    rendered = { container, currentFile, currentRoot };
  };

  await view.render(true);

  assert.deepEqual(rendered, {
    container: view.contentEl,
    currentFile: file,
    currentRoot: root,
  });
  assert.equal(view.viewingFile, file);
});

test("ResearchView délègue le rendu normal au corps Recherche", async () => {
  const root = new TFolder("Projet");
  const view = createView({ getProjectFolder: () => root });
  let rendered;
  view.renderResearchBody = async (container, currentRoot, generation) => {
    rendered = { container, currentRoot, generation };
  };

  await view.render(true);

  assert.deepEqual(rendered, {
    container: view.contentEl,
    currentRoot: root,
    generation: 1,
  });
});

/* --- Création localisée des dossiers de recherche --- */

import { setLocale, getLocale } from "../src/i18n/index.js";
import { PROJECT_MODES } from "../src/utils/project-modes.js";

function createResearchHarness({ preexisting = [], mode = "fiction" } = {}) {
  const folders = new Map();
  for (const path of preexisting) folders.set(path, new TFolder(path));
  const created = [];
  const vault = {
    getAbstractFileByPath: (path) => folders.get(path) || null,
    getMarkdownFiles: () => [],
  };
  const plugin = {
    settings: { researchSearch: "", researchTagFilter: "", collapsed: {}, projectMeta: {}, labels: [] },
    getProjectFolder: () => new TFolder("Projet"),
    getResearchRoot: () => null,
    getChronoFolder: () => null,
    async ensureFolder(path) {
      created.push(path);
      let folder = folders.get(path);
      if (!folder) {
        folder = new TFolder(path);
        folders.set(path, folder);
      }
      return folder;
    },
    projectMode: () => PROJECT_MODES[mode],
    async migrateBibliographieIntoSources() {},
    newFolder() {},
    async saveSettings() {},
  };
  return { plugin, vault, created };
}

async function renderResearchBody(harness) {
  const contentEl = new FakeElement();
  const leaf = { app: { vault: harness.vault }, contentEl };
  const view = new ResearchView(leaf, harness.plugin);
  view._renderGen = 1;
  view.iconBtn = () => ({ addEventListener() {}, addClass() {} });
  view.renderSavedFiltersButton = () => {};
  view.renderFootnotesOverviewSection = async () => {};
  view.renderBibliographySection = async () => {};
  view.filterEntities = () => {};
  const sections = [];
  view.renderSection = (container, title, folderOrFiles) => {
    sections.push({
      title,
      folder: folderOrFiles instanceof TFolder ? folderOrFiles.path : null,
    });
  };
  await view.renderResearchBody(
    contentEl,
    harness.plugin.getProjectFolder(),
    1
  );
  return { sections };
}

test("renderResearchBody crée les dossiers en français quand la locale est française", async () => {
  const previous = getLocale();
  setLocale("fr");
  try {
    const harness = createResearchHarness();
    const { sections } = await renderResearchBody(harness);

    const strip = (p) => p.replace(/^Projet\/_Recherche\/?/, "");
    assert.deepEqual(
      harness.created.map(strip),
      ["", "Bibliographie", "Personnages", "Lieux", "Lore", "Glossaire", "Chronologie"]
    );
    assert.deepEqual(
      sections.map((s) => s.title),
      ["Bibliographie", "Personnages", "Lieux", "Lore", "Glossaire", "Événements"]
    );
    assert.equal(sections.find((s) => s.title === "Événements").folder, "Projet/_Recherche/Chronologie");
  } finally {
    setLocale(previous);
  }
});

test("renderResearchBody conserve les labels anglais quand la locale est anglaise", async () => {
  const previous = getLocale();
  setLocale("en");
  try {
    const harness = createResearchHarness();
    const { sections } = await renderResearchBody(harness);

    assert.deepEqual(
      harness.created.map((p) => p.replace(/^Projet\/_Recherche\/?/, "")),
      ["", "Bibliography", "Characters", "Places", "Lore", "Glossary", "Chronologie"]
    );
    assert.deepEqual(
      sections.map((s) => s.title),
      ["Bibliography", "Characters", "Places", "Lore", "Glossary", "Events"]
    );
  } finally {
    setLocale(previous);
  }
});

test("renderResearchBody ne crée aucun doublon quand le dossier anglais existe déjà (locale française)", async () => {
  const previous = getLocale();
  setLocale("fr");
  try {
    const harness = createResearchHarness({
      preexisting: ["Projet/_Recherche/Characters"],
    });
    const { sections } = await renderResearchBody(harness);

    assert.equal(harness.created.includes("Projet/_Recherche/Personnages"), false);
    assert.equal(harness.created.includes("Projet/_Recherche/Characters"), false);
    assert.equal(
      sections.find((s) => s.title === "Personnages").folder,
      "Projet/_Recherche/Characters"
    );
  } finally {
    setLocale(previous);
  }
});

test("renderResearchBody ne crée aucun doublon lors d'une seconde ouverture", async () => {
  const previous = getLocale();
  setLocale("fr");
  try {
    const harness = createResearchHarness();
    await renderResearchBody(harness);
    const afterFirst = [...new Set(harness.created)].sort();
    await renderResearchBody(harness);
    const afterSecond = [...new Set(harness.created)].sort();

    assert.deepEqual(afterSecond, afterFirst);
  } finally {
    setLocale(previous);
  }
});

test("renderResearchBody ne crée des dossiers que sous _Recherche du projet actif", async () => {
  const previous = getLocale();
  setLocale("fr");
  try {
    const harness = createResearchHarness();
    await renderResearchBody(harness);

    for (const path of harness.created) {
      assert.ok(
        path.startsWith("Projet/_Recherche"),
        `dossier créé hors de _Recherche : ${path}`
      );
    }
    assert.deepEqual(
      harness.created.map((p) => p.replace(/^Projet\/_Recherche\/?/, "")).filter(Boolean),
      ["Bibliographie", "Personnages", "Lieux", "Lore", "Glossaire", "Chronologie"]
    );
  } finally {
    setLocale(previous);
  }
});
