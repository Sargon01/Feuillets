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
    this.attrs = new Map();
  }

  addClass(className) {
    for (const part of String(className).split(/\s+/)) {
      if (part) this.classes.add(part);
    }
  }

  removeClass(className) {
    for (const part of String(className).split(/\s+/)) {
      this.classes.delete(part);
    }
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
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  addEventListener(type, callback) {
    this.events ||= new Map();
    this.events.set(type, callback);
  }

  setText(text) {
    this.text = String(text);
  }

  setAttr(name, value) {
    this.attrs.set(name, value);
  }

  getAttr(name) {
    return this.attrs.get(name);
  }

  hide() {
    this.hidden = true;
  }

  show() {
    this.hidden = false;
  }

  empty() {
    this.children = [];
  }

  contains() {
    return false;
  }

  setCssStyles() {}
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

/* --- Rendu récursif des sous-dossiers dans les rubriques --- */

import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";

/* Patching pour que FakeElement supporte createSpan (appelé par renderCollapsibleHead). */
const origCreateEl = FakeElement.prototype.createEl;
FakeElement.prototype.createSpan = function(options = {}) {
  return this.createEl("span", options);
};

function createRenderHarness(vault = {}) {
  const settings = {
    researchSearch: "",
    researchTagFilter: "",
    collapsed: {},
    projectMeta: {},
    labels: [],
  };
  const plugin = {
    settings,
    getProjectFolder: () => null,
    getResearchRoot: () => null,
    getChronoFolder: () => null,
    async ensureFolder() {},
    projectMode: () => PROJECT_MODES.fiction,
    async migrateBibliographieIntoSources() {},
    async saveSettings() {},
    tagsOf: () => [],
    titleFor: (f) => f.basename.replace(/\.md$/, ""),
    fmOf: () => ({}),
    labelOf: () => "",
    labelColor: () => null,
    newFolder() {},
  };
  const contentEl = new FakeElement();
  const leaf = { app: { vault }, contentEl };
  const view = new ResearchView(leaf, plugin);

  view.iconBtn = (parent, _icon, _tooltip, onClick) => {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  };
  view.attachResearchDropTarget = () => {};
  view.attachResearchDragSource = () => {};
  view.addPreviewBtn = () => new FakeElement();
  view.showResearchFolderContextMenu = () => {};

  return { view, contentEl };
}

/** Traverse l'arbre DOM construit par renderSection pour retrouver le
 *  conteneur `feuillets-research-list` où sont ajoutés sous-dossiers et
 *  fichiers. */
function findResearchList(root) {
  for (const c of root.children) {
    if (c.classes.has("feuillets-research-list")) return c;
  }
  for (const c of root.children) {
    const found = findResearchList(c);
    if (found) return found;
  }
  return null;
}

test("un sous-dossier de niveau 1 est affiché dans une rubrique", () => {
  const main = new TFolder("Projet/_Recherche/Personnages");
  const sub1 = new TFolder("Projet/_Recherche/Personnages/Principaux");
  main.children = [sub1];

  const { view, contentEl } = createRenderHarness();
  view.renderSection(contentEl, "Personnages", main);

  const list = findResearchList(contentEl);
  assert.ok(list, "La liste de recherche doit exister dans le DOM");
  const subfolderItems = list.children.filter(
    (c) => c.classes.has("feuillets-research-subfolder")
  );
  assert.equal(subfolderItems.length, 1);
  const header = subfolderItems[0].children.find(
    (h) => h.classes.has("feuillets-research-item-header")
  );
  assert.ok(header);
  const name = header.children.find(
    (n) => n.classes.has("feuillets-research-item-name")
  );
  assert.ok(name);
  assert.equal(name.text, "Principaux");
});

test("un sous-dossier de niveau 2 est affiché", () => {
  const main = new TFolder("Projet/_Recherche/Personnages");
  const sub1 = new TFolder("Projet/_Recherche/Personnages/Principaux");
  const sub2 = new TFolder("Projet/_Recherche/Personnages/Principaux/Héros");
  sub1.children = [sub2];
  main.children = [sub1];

  const { view, contentEl } = createRenderHarness();
  view.renderSection(contentEl, "Personnages", main);

  const subItems = [];
  function collect(el) {
    for (const c of el.children) {
      if (c.classes.has("feuillets-research-subfolder")) {
        subItems.push(c);
      }
      collect(c);
    }
  }
  collect(contentEl);
  assert.equal(subItems.length, 2);
});

test("un fichier Markdown dans un sous-dossier est affiché", () => {
  const main = new TFolder("Projet/_Recherche/Personnages");
  const sub = new TFolder("Projet/_Recherche/Personnages/Principaux");
  const note = new TFile("Projet/_Recherche/Personnages/Principaux/Héros.md");
  sub.children = [note];
  main.children = [sub];

  const { view, contentEl } = createRenderHarness();
  view.renderSection(contentEl, "Personnages", main);

  const list = findResearchList(contentEl);
  assert.ok(list, "La liste de recherche doit exister");
  const subfolderItem = list.children.find(
    (c) => c.classes.has("feuillets-research-subfolder")
  );
  assert.ok(subfolderItem);
  const nestedList = subfolderItem.children.find(
    (c) => c.classes.has("feuillets-research-nested")
  );
  assert.ok(nestedList);
  const fileItem = nestedList.children.find(
    (c) => c.classes.has("feuillets-research-item") && !c.classes.has("feuillets-research-subfolder")
  );
  assert.ok(fileItem);
  const header = fileItem.children.find(
    (h) => h.classes.has("feuillets-research-item-header")
  );
  assert.ok(header);
  const name = header.children.find(
    (n) => n.classes.has("feuillets-research-item-name")
  );
  assert.ok(name);
  assert.equal(name.text, "Héros");
});

test("chaque sous-dossier possède son menu d'actions", () => {
  const main = new TFolder("Projet/_Recherche/Personnages");
  const sub = new TFolder("Projet/_Recherche/Personnages/Principaux");
  main.children = [sub];

  const { view, contentEl } = createRenderHarness();
  view.renderSection(contentEl, "Personnages", main);

  const list = findResearchList(contentEl);
  assert.ok(list, "La liste de recherche doit exister");
  const subItem = list.children.find(
    (c) => c.classes.has("feuillets-research-subfolder")
  );
  assert.ok(subItem);
  const header = subItem.children.find(
    (h) => h.classes.has("feuillets-research-item-header")
  );
  assert.ok(header);
  const buttons = header.children.filter(
    (b) => b.tag === "button"
  );
  assert.ok(buttons.length >= 1, `Expected at least 1 button, got ${buttons.length}`);
});

test("aucun élément n'est affiché deux fois", () => {
  const main = new TFolder("Projet/_Recherche/Personnages");
  const mainNote = new TFile("Projet/_Recherche/Personnages/Épopée.md");
  const rootNote = new TFile("Projet/_Recherche/racine.md");
  main.children = [mainNote];

  const { view, contentEl } = createRenderHarness();

  const sectionTitles = [];

  view.renderSection(contentEl, "Personnages", main);

  /* Une seule section "Personnages" doit exister dans le DOM (pas de
     doublon). La section racine contient les sous-dossiers imbriqués,
     pas des sections séparées. */
  assert.equal(sectionTitles.length, 0);
});

test("les dossiers racines existants restent affichés comme avant", () => {
  const main = new TFolder("Projet/_Recherche/Personnages");
  const note = new TFile("Projet/_Recherche/Personnages/Épopée.md");
  main.children = [note];

  const { view, contentEl } = createRenderHarness();
  view.renderSection(contentEl, "Personnages", main);

  const list = findResearchList(contentEl);
  assert.ok(list, "La liste de recherche doit exister");
  const items = list.children.filter(
    (c) => c.classes.has("feuillets-research-item") && !c.classes.has("feuillets-research-subfolder")
  );
  assert.equal(items.length, 1);
  const header = items[0].children.find(
    (h) => h.classes.has("feuillets-research-item-header")
  );
  assert.ok(header);
  const name = header.children.find(
    (n) => n.classes.has("feuillets-research-item-name")
  );
  assert.equal(name.text, "Épopée");
});

test("le collage d'un dossier Recherche recopie son arborescence et ses fichiers", async () => {
  const source = new TFolder("Projet/_Recherche/Histoire");
  const nested = new TFolder("Projet/_Recherche/Histoire/Archives");
  const note = new TFile("Projet/_Recherche/Histoire/repères.md");
  const image = new TFile("Projet/_Recherche/Histoire/Archives/carte.png");
  source.children = [note, nested];
  nested.children = [image];
  const destination = new TFolder("Projet/_Recherche/Personnages");
  const entries = new Map([
    [source.path, source],
    [nested.path, nested],
    [note.path, note],
    [image.path, image],
    [destination.path, destination],
  ]);
  const createdFolders = [];
  const createdFiles = [];
  const vault = {
    getAbstractFileByPath: (path) => entries.get(path) || null,
    async createFolder(path) {
      createdFolders.push(path);
      entries.set(path, new TFolder(path));
    },
    async readBinary(file) {
      return new TextEncoder().encode(file.path).buffer;
    },
    async createBinary(path, data) {
      createdFiles.push(path);
      entries.set(path, new TFile(path, data));
    },
  };
  let refreshes = 0;
  const view = createView({ renderAllViews: () => { refreshes += 1; } }, vault);
  view.researchFolderClipboardPath = source.path;

  await view.pasteResearchFolder(destination);

  assert.deepEqual(createdFolders, [
    "Projet/_Recherche/Personnages/Histoire",
    "Projet/_Recherche/Personnages/Histoire/Archives",
  ]);
  assert.deepEqual(createdFiles, [
    "Projet/_Recherche/Personnages/Histoire/repères.md",
    "Projet/_Recherche/Personnages/Histoire/Archives/carte.png",
  ]);
  assert.equal(refreshes, 1);
});
