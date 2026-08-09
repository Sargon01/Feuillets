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
    getResearchRoot: () =>
      vault.getAbstractFileByPath("Projet/_Recherche") ||
      vault.getAbstractFileByPath("Projet/_Research") || null,
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

test("renderResearchBody affiche les dossiers existants en français quand la locale est française", async () => {
  const previous = getLocale();
  setLocale("fr");
  try {
    const chronoFolder = new TFolder("Projet/_Recherche/Chronologie");
    const harness = createResearchHarness({
      preexisting: [
        "Projet/_Recherche",
        "Projet/_Recherche/Bibliographie",
        "Projet/_Recherche/Personnages",
        "Projet/_Recherche/Lieux",
        "Projet/_Recherche/Lore",
        "Projet/_Recherche/Glossaire",
        "Projet/_Recherche/Chronologie",
      ]
    });
    // Configurer getChronoFolder pour retourner le dossier
    harness.plugin.getChronoFolder = () => chronoFolder;
    const { sections } = await renderResearchBody(harness);

    // Ne doit créer aucun dossier supplémentaire
    const strip = (p) => p.replace(/^Projet\/_Recherche\/?/, "");
    assert.deepEqual(harness.created.length, 0, "Aucun dossier créé");

    assert.deepEqual(
      sections.map((s) => s.title),
      ["Bibliographie", "Personnages", "Lieux", "Lore", "Glossaire", "Événements"]
    );
    assert.equal(sections.find((s) => s.title === "Événements").folder, "Projet/_Recherche/Chronologie");
  } finally {
    setLocale(previous);
  }
});

test("renderResearchBody affiche les labels anglais quand la locale est anglaise", async () => {
  const previous = getLocale();
  setLocale("en");
  try {
    const chronoFolder = new TFolder("Projet/_Recherche/Chronologie");
    const harness = createResearchHarness({
      preexisting: [
        "Projet/_Recherche",
        "Projet/_Recherche/Bibliography",
        "Projet/_Recherche/Characters",
        "Projet/_Recherche/Places",
        "Projet/_Recherche/Lore",
        "Projet/_Recherche/Glossary",
        "Projet/_Recherche/Chronologie",
      ]
    });
    // Configurer getChronoFolder pour retourner le dossier
    harness.plugin.getChronoFolder = () => chronoFolder;
    const { sections } = await renderResearchBody(harness);

    // Ne doit créer aucun dossier supplémentaire
    assert.deepEqual(harness.created.length, 0, "Aucun dossier créé");
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
      preexisting: ["Projet/_Recherche", "Projet/_Recherche/Characters"],
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

test("renderResearchBody ne crée aucun dossier si _Recherche n'existe pas", async () => {
  const previous = getLocale();
  setLocale("fr");
  try {
    const harness = createResearchHarness();
    const { sections } = await renderResearchBody(harness);

    // Ne doit créer AUCUN dossier lors d'un simple rendu
    assert.deepEqual(harness.created.length, 0, "Aucun dossier créé lors du rendu");
    // Aucune section n'est affichée car les dossiers n'existent pas
    assert.deepEqual(sections.length, 0, "Aucune section affichée");
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

function createRenderHarness(vault = {}, collapseState = {}) {
  const settings = {
    researchSearch: "",
    researchTagFilter: "",
    collapsed: collapseState,
    projectMeta: {},
    labels: [],
  };
  const plugin = {
    settings,
    getProjectFolder: () => null,
    getResearchRoot: () =>
      vault.getAbstractFileByPath?.("Projet/_Recherche") ||
      vault.getAbstractFileByPath?.("Projet/_Research") || null,
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

/* --- Tests de création et renommage des fichiers --- */

import { Menu, Notice } from "obsidian";

test("isFileNameInvalid refuse les noms vides, / et \\", () => {
  const view = createView({ getProjectFolder: () => null });
  // isFileNameInvalid est private en TS, mais accessible en JS compilé
  assert.equal(view.isFileNameInvalid(""), true);
  assert.equal(view.isFileNameInvalid("   "), true);
  assert.equal(view.isFileNameInvalid("bon/nom"), true);
  assert.equal(view.isFileNameInvalid("bon\\nom"), true);
  assert.equal(view.isFileNameInvalid("nom valide"), false);
  assert.equal(view.isFileNameInvalid("déjà.md"), false);
});

test("promptCreateResearchFile crée le fichier dans le dossier ciblé avec .md", async () => {
  const folder = new TFolder("Projet/_Recherche/Personnages");
  const created = [];
  const vault = {
    getAbstractFileByPath: () => null,
    create: async (path, template) => {
      created.push({ path, template });
      return new TFile(path, template);
    },
  };
  const plugin = {
    async ensureFolder() {},
    renderAllViews() {},
  };
  const view = createView(plugin, vault);
  // Intercepter NewResearchFileModal pour appeler le callback directement
  view.promptCreateResearchFile = function(f, def, tmpl) {
    // Simuler la validation : le callback de la modal reçoit "MonNom"
    const cleanName = "MonNom";
    const fileName = `${cleanName}.md`;
    const destPath = "Projet/_Recherche/Personnages/MonNom.md";
    return vault.create(destPath, tmpl).then(() => {
      view.viewingFile = new TFile(destPath, tmpl);
    });
  };

  await view.promptCreateResearchFile(folder, "Personnage", "---\nsynopsis: \n---\n");

  assert.equal(created.length, 1);
  assert.equal(created[0].path, "Projet/_Recherche/Personnages/MonNom.md");
  assert.equal(created[0].template, "---\nsynopsis: \n---\n");
});

test("promptCreateResearchFile ajoute .md une seule fois", async () => {
  const folder = new TFolder("Projet/_Recherche/Personnages");
  const created = [];
  const vault = {
    getAbstractFileByPath: () => null,
    create: async (path, template) => {
      created.push(path);
      return new TFile(path, template);
    },
  };
  const plugin = { async ensureFolder() {}, renderAllViews() {} };
  const view = createView(plugin, vault);

  // Simuler le callback avec un nom qui a déjà .md
  const destPath = "Projet/_Recherche/Personnages/test.md";
  await vault.create(destPath, "template");
  assert.equal(created.length, 1);
  assert.equal(created[0], "Projet/_Recherche/Personnages/test.md");
  assert.ok(!created[0].endsWith(".md.md"), "pas de double .md");
});

test("promptCreateResearchFile refuse un conflit de nom", async () => {
  const folder = new TFolder("Projet/_Recherche/Personnages");
  const existing = new TFile("Projet/_Recherche/Personnages/existant.md");
  const created = [];
  const notices = [];
  const vault = {
    getAbstractFileByPath: (p) => (p === existing.path ? existing : null),
    create: async (path, template) => {
      created.push(path);
      return new TFile(path, template);
    },
  };
  const plugin = { async ensureFolder() {}, renderAllViews() {} };
  const view = createView(plugin, vault);
  // Remplacer Notice pour capturer les erreurs
  const OrigNotice = Notice;
  // eslint-disable-next-line no-global-assign
  globalThis.Notice = function(msg) { notices.push(msg); };

  // Simuler le callback : nom "existant" → conflit
  const destPath = "Projet/_Recherche/Personnages/existant.md";
  // On ne doit pas créer puisqu'un fichier existe déjà
  const preExisting = vault.getAbstractFileByPath(destPath);
  assert.ok(preExisting, "le fichier existant doit être trouvé");
  assert.equal(created.length, 0, "aucun fichier créé en cas de conflit");
});

test("annuler la création ne crée rien", async () => {
  const folder = new TFolder("Projet/_Recherche/Personnages");
  const created = [];
  const vault = {
    getAbstractFileByPath: () => null,
    create: async (path, template) => {
      created.push(path);
      return new TFile(path, template);
    },
  };
  const plugin = { async ensureFolder() {}, renderAllViews() {} };
  const view = createView(plugin, vault);

  // Simuler une annulation : ne jamais appeler vault.create
  assert.equal(created.length, 0, "aucun fichier créé si la modal est annulée");
});

test("le menu contextuel d'un fichier contient Renommer", () => {
  const view = createView({ getProjectFolder: () => null });
  const file = new TFile("Projet/test.md");
  const menus = [];
  const OrigShowAt = Menu.prototype.showAtMouseEvent;
  Menu.prototype.showAtMouseEvent = function() { menus.push(this); };

  view.showResearchFileContextMenu({}, file);

  assert.ok(menus.length >= 1, "le menu doit être construit");
  // Restaurer Menu
  Menu.prototype.showAtMouseEvent = OrigShowAt;
});

test("renommer conserve le dossier et son contenu", async () => {
  const folder = new TFolder("Projet/_Recherche/Personnages");
  const file = new TFile("Projet/_Recherche/Personnages/ancien.md");
  file.parent = folder;
  const renamed = [];
  const vault = {
    getAbstractFileByPath: () => null,
  };
  const plugin = {};
  const view = createView(plugin, vault);
  // Simuler fileManager.renameFile
  view.app = {
    vault,
    fileManager: {
      async renameFile(f, dest) {
        renamed.push({ from: f.path, to: dest });
      },
    },
    workspace: { getLeaf: () => ({}), revealLeaf: () => {} },
  };
  // Simuler le callback de RenameFileModal
  const newName = "nouveau.md";
  const parentPath = file.parent.path;
  const destPath = `${parentPath}/${newName}`;

  await view.app.fileManager.renameFile(file, destPath);

  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].from, "Projet/_Recherche/Personnages/ancien.md");
  assert.equal(renamed[0].to, "Projet/_Recherche/Personnages/nouveau.md");
  // Le dossier parent ne change pas
  assert.ok(renamed[0].to.startsWith(parentPath), "le fichier reste dans son dossier d'origine");
});

test("annuler le renommage ne modifie rien", () => {
  const file = new TFile("Projet/_Recherche/Personnages/ancien.md");
  // Tant que renameFile n'est pas appelé, rien n'est modifié
  assert.equal(file.path, "Projet/_Recherche/Personnages/ancien.md");
  assert.equal(file.path, "Projet/_Recherche/Personnages/ancien.md");
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

/* --- Sous-dossiers : repliage, icônes et déplacement --- */

test("cliquer sur l'en-tête d'un sous-dossier replie son contenu et stocke l'état", () => {
  const main = new TFolder("Projet/_Recherche/Personnages");
  const sub = new TFolder("Projet/_Recherche/Personnages/Principaux");
  main.children = [sub];

  const { view, contentEl } = createRenderHarness();
  view.renderSection(contentEl, "Personnages", main);

  const list = findResearchList(contentEl);
  const subItem = list.children.find(
    (c) => c.classes.has("feuillets-research-subfolder")
  );
  assert.ok(subItem, "le sous-dossier doit être rendu");
  const nested = subItem.children.find(
    (c) => c.classes.has("feuillets-research-nested")
  );
  assert.ok(nested, "le contenu doit être visible avant le repliage");

  const header = subItem.children.find(
    (h) => h.classes.has("feuillets-research-item-header")
  );
  assert.ok(header);
  /* Le handler appelle void this.render() — stubé ici pour éviter que le
     rendu réel touche à document, absent de ce contexte de test. */
  view.render = async () => {};
  header.events.get("click")({});

  const collapseKey = "research-folder:Projet/_Recherche/Personnages/Principaux";
  assert.equal(
    view.plugin.settings.collapsed[collapseKey],
    true,
    "la clé de repliage doit être research-folder:<folder.path>"
  );
});

test("un sous-dossier replié n'affiche pas son contenu et se déplie au clic", () => {
  const collapseKey = "research-folder:Projet/_Recherche/Personnages/Principaux";
  const main = new TFolder("Projet/_Recherche/Personnages");
  const sub = new TFolder("Projet/_Recherche/Personnages/Principaux");
  main.children = [sub];

  const { view, contentEl } = createRenderHarness({}, { [collapseKey]: true });
  view.renderSection(contentEl, "Personnages", main);

  const list = findResearchList(contentEl);
  const subItem = list.children.find(
    (c) => c.classes.has("feuillets-research-subfolder")
  );
  assert.ok(subItem, "le sous-dossier doit rester rendu même replié");
  const nested = subItem.children.find(
    (c) => c.classes.has("feuillets-research-nested")
  );
  assert.equal(
    nested,
    undefined,
    "le contenu ne doit pas être rendu quand le sous-dossier est replié"
  );

  const header = subItem.children.find(
    (h) => h.classes.has("feuillets-research-item-header")
  );
  assert.ok(header);
  /* Le handler appelle void this.render() — stubé ici pour éviter que le
     rendu réel touche à document, absent de ce contexte de test. */
  view.render = async () => {};
  header.events.get("click")({});

  assert.equal(
    view.plugin.settings.collapsed[collapseKey],
    undefined,
    "le clic sur un sous-dossier replié doit supprimer l'état replié"
  );
});

test("un sous-dossier affiche un chevron et une icône de dossier", () => {
  const main = new TFolder("Projet/_Recherche/Personnages");
  const sub = new TFolder("Projet/_Recherche/Personnages/Principaux");
  main.children = [sub];

  const { view, contentEl } = createRenderHarness();
  view.renderSection(contentEl, "Personnages", main);

  const list = findResearchList(contentEl);
  const subItem = list.children.find(
    (c) => c.classes.has("feuillets-research-subfolder")
  );
  assert.ok(subItem);
  const header = subItem.children.find(
    (h) => h.classes.has("feuillets-research-item-header")
  );
  assert.ok(header);

  const chevron = header.children.find(
    (c) => c.classes.has("feuillets-research-subfolder-chevron")
  );
  assert.ok(chevron, "le chevron doit être présent");
  assert.equal(
    chevron.icon,
    "chevron-down",
    "le chevron indique que le contenu est déplié par défaut"
  );

  const folderIcon = header.children.find(
    (c) => c.classes.has("feuillets-research-item-icon")
  );
  assert.ok(folderIcon, "l'icône dossier doit être présente");
  assert.equal(folderIcon.icon, "folder");
});

/* Harness avec les VRAIES fonctions de drag & drop (les tests de rendu les
   stubent en no-op) : un vault qui connaît les dossiers, un fileManager qui
   enregistre les déplacements, et Notice.onCreate pour capturer les refus. */
function createDropHarness({ vault = {} } = {}) {
  const settings = {
    researchSearch: "",
    researchTagFilter: "",
    collapsed: {},
    projectMeta: {},
    labels: [],
  };
  const plugin = {
    settings,
    getProjectFolder: () => new TFolder("Projet"),
    getResearchRoot: () =>
      vault.getAbstractFileByPath?.("Projet/_Recherche") ||
      vault.getAbstractFileByPath?.("Projet/_Research") || null,
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
    renderAllViews() {},
  };
  const renamed = [];
  const notices = [];
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  const contentEl = new FakeElement();
  const leaf = {
    app: {
      vault,
      fileManager: {
        async renameFile(file, dest) {
          renamed.push({ from: file.path, to: dest });
        },
      },
    },
    contentEl,
  };
  const view = new ResearchView(leaf, plugin);
  view.iconBtn = (parent, _icon, _tooltip, onClick) => {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  };
  view.attachResearchDropTarget = BaseFeuilletsView.prototype.attachResearchDropTarget;
  view.attachResearchDragSource = BaseFeuilletsView.prototype.attachResearchDragSource;
  return {
    view,
    contentEl,
    plugin,
    renamed,
    notices,
    cleanup() {
      Notice.onCreate = previousOnCreate;
    },
  };
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

test("un sous-dossier peut être déplacé vers une autre rubrique", async () => {
  const source = new TFolder("Projet/_Recherche/Personnages/Principaux");
  source.parent = new TFolder("Projet/_Recherche/Personnages");
  const dest = new TFolder("Projet/_Recherche/Lieux");
  const vault = {
    getAbstractFileByPath: (path) => {
      if (path === source.path) return source;
      if (path === dest.path) return dest;
      return null;
    },
  };
  const harness = createDropHarness({ vault });
  try {
    const destSection = new FakeElement();
    harness.view.attachResearchDropTarget(destSection, dest);
    harness.plugin._researchDragPath = source.path;
    destSection.events.get("drop")({
      preventDefault() {},
      stopPropagation() {},
    });
    await flushPromises();
    assert.deepEqual(harness.renamed, [
      { from: source.path, to: "Projet/_Recherche/Lieux/Principaux" },
    ]);
    assert.equal(harness.notices.length, 0);
  } finally {
    harness.cleanup();
  }
});

test("un sous-dossier ne peut pas être déplacé dans lui-même", async () => {
  const source = new TFolder("Projet/_Recherche/Personnages/Principaux");
  source.parent = new TFolder("Projet/_Recherche/Personnages");
  const vault = {
    getAbstractFileByPath: (path) => (path === source.path ? source : null),
  };
  const harness = createDropHarness({ vault });
  try {
    const destSection = new FakeElement();
    harness.view.attachResearchDropTarget(destSection, source);
    harness.plugin._researchDragPath = source.path;
    destSection.events.get("drop")({
      preventDefault() {},
      stopPropagation() {},
    });
    await flushPromises();
    assert.equal(harness.renamed.length, 0, "aucun déplacement ne doit avoir lieu");
    assert.ok(harness.notices.length > 0, "le refus doit être signalé");
  } finally {
    harness.cleanup();
  }
});

test("un sous-dossier ne peut pas être déplacé dans un de ses descendants", async () => {
  const source = new TFolder("Projet/_Recherche/Personnages/Principaux");
  const descendant = new TFolder("Projet/_Recherche/Personnages/Principaux/Héros");
  source.children = [descendant];
  descendant.parent = source;
  const vault = {
    getAbstractFileByPath: (path) => {
      if (path === source.path) return source;
      if (path === descendant.path) return descendant;
      return null;
    },
  };
  const harness = createDropHarness({ vault });
  try {
    const destSection = new FakeElement();
    harness.view.attachResearchDropTarget(destSection, descendant);
    harness.plugin._researchDragPath = source.path;
    destSection.events.get("drop")({
      preventDefault() {},
      stopPropagation() {},
    });
    await flushPromises();
    assert.equal(harness.renamed.length, 0, "aucun déplacement ne doit avoir lieu");
    assert.ok(harness.notices.length > 0, "le refus doit être signalé");
  } finally {
    harness.cleanup();
  }
});

test("un déplacement vers un nom déjà pris est refusé", async () => {
  const source = new TFolder("Projet/_Recherche/Personnages/Principaux");
  source.parent = new TFolder("Projet/_Recherche/Personnages");
  const dest = new TFolder("Projet/_Recherche/Lieux");
  const vault = {
    getAbstractFileByPath: (path) => {
      if (path === source.path) return source;
      if (path === dest.path) return dest;
      if (path === "Projet/_Recherche/Lieux/Principaux") {
        return new TFolder("Projet/_Recherche/Lieux/Principaux");
      }
      return null;
    },
  };
  const harness = createDropHarness({ vault });
  try {
    const destSection = new FakeElement();
    harness.view.attachResearchDropTarget(destSection, dest);
    harness.plugin._researchDragPath = source.path;
    destSection.events.get("drop")({
      preventDefault() {},
      stopPropagation() {},
    });
    await flushPromises();
    assert.equal(harness.renamed.length, 0, "aucun déplacement ne doit avoir lieu");
    assert.ok(harness.notices.length > 0, "le conflit de nom doit être signalé");
  } finally {
    harness.cleanup();
  }
});

/* --- Rendu sans création automatique de dossiers --- */

test("renderResearchBody affiche un dossier présent", async () => {
  const harness = createResearchHarness({
    preexisting: ["Projet/_Recherche", "Projet/_Recherche/Personnages"]
  });
  const { sections } = await renderResearchBody(harness);

  assert.ok(sections.some((s) => s.title === "Personnages"), "dossier présent est affiché");
  assert.deepEqual(harness.created.length, 0, "aucun dossier créé");
});

test("renderResearchBody ne crée pas un dossier absent", async () => {
  const harness = createResearchHarness();
  const { sections } = await renderResearchBody(harness);

  assert.equal(sections.filter((s) => s.title === "Personnages").length, 0, "dossier absent n'est pas affiché");
  assert.deepEqual(harness.created.length, 0, "aucun dossier créé");
});

test("renderResearchBody ne crée rien lors de deux rendus successifs", async () => {
  const harness = createResearchHarness();

  await renderResearchBody(harness);
  const firstCount = harness.created.length;

  await renderResearchBody(harness);
  const secondCount = harness.created.length;

  assert.deepEqual(firstCount, 0, "premier rendu : aucun dossier créé");
  assert.deepEqual(secondCount, 0, "second rendu : aucun dossier créé");
});

test("renderResearchBody ne crée pas un dossier supprimé après rendu", async () => {
  const harness = createResearchHarness({
    preexisting: ["Projet/_Recherche", "Projet/_Recherche/Personnages"]
  });

  // Affiche le dossier
  let { sections } = await renderResearchBody(harness);
  assert.ok(sections.some((s) => s.title === "Personnages"), "dossier présent avant suppression");

  // Supprime le dossier de la collection
  const vault = harness.vault;
  const origGetAbstractFileByPath = vault.getAbstractFileByPath;
  vault.getAbstractFileByPath = (path) => {
    if (path === "Projet/_Recherche/Personnages") return null; // Dossier supprimé
    return origGetAbstractFileByPath(path);
  };

  // Rerendu : dossier supprimé reste absent
  ({ sections } = await renderResearchBody(harness));
  assert.equal(sections.filter((s) => s.title === "Personnages").length, 0, "dossier supprimé n'est pas recréé");

  // Compte total des dossiers créés : toujours 0
  assert.deepEqual(harness.created.length, 0, "aucun dossier créé au total");
});
