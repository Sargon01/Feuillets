import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { Notice, TFile, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { EditionDocsView, revealInFileExplorer } = await import(modulePath("src/views/edition-docs-view.js"));
const { EDITION_FOLDER_NAME } = await import(modulePath("src/services/folder-structure.js"));

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attributes = options.attr ?? {};
    this.text = options.text ?? "";
    this.style = {};
    if (options.cls) this.addClass(options.cls);
    if (options.text) this.text = options.text;
  }

  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
}

function allElements(element) { return [element, ...element.children.flatMap(allElements)]; }
function textsOf(container) { return allElements(container).map((el) => el.text).filter(Boolean); }
function buttonsOf(container) { return allElements(container).filter((el) => el.tag === "button"); }
function rowsOf(container) { return allElements(container).filter((el) => el.classes.has("feuillets-project-row")); }
function rowWithLabel(container, label) {
  return rowsOf(container).find((row) => allElements(row).some((el) => el.text === label));
}

function createView({ root = null, editionFolder = null } = {}) {
  const openedFiles = [];
  const leaf = {
    openFile: async (file) => { openedFiles.push(file); },
  };
  const app = {
    vault: {
      getAbstractFileByPath(path) {
        if (editionFolder && (path === editionFolder.path || path.startsWith(`${editionFolder.path}/`))) {
          return findInFolder(editionFolder, path);
        }
        return null;
      },
      async create(path, content) {
        const file = new TFile(path, content);
        if (editionFolder) editionFolder.children.push(file);
        return file;
      },
    },
    workspace: {
      getLeaf: () => leaf,
      setActiveLeaf: () => {},
    },
  };
  const plugin = {
    settings: { collapsed: {} },
    getProjectFolder: () => root,
  };
  const contentEl = new FakeElement();
  const view = new EditionDocsView({ app, contentEl }, plugin);
  return { view, app, contentEl, openedFiles };
}

function findInFolder(folder, path) {
  if (folder.path === path) return folder;
  for (const child of folder.children || []) {
    if (child.path === path) return child;
    if (child instanceof TFolder) {
      const found = findInFolder(child, path);
      if (found) return found;
    }
  }
  return null;
}

test("EditionDocsView : sans dossier projet, affiche un message vide sans planter", async () => {
  const { view, contentEl } = createView({ root: null });
  await view.render();
  assert.ok(textsOf(contentEl).some((t) => t.length > 0));
});

test("EditionDocsView : projet sans dossier Edition — propose de le créer plutôt que d'afficher une liste vide silencieuse", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const { view, contentEl } = createView({ root });

  await view.render();

  const texts = textsOf(contentEl);
  assert.ok(texts.some((t) => /Edition/i.test(t)), "invite à créer le dossier Edition");
  assert.equal(buttonsOf(contentEl).filter((b) => /Créer/i.test(b.text)).length, 1);
});

test("EditionDocsView : liste les documents et dossiers présents dans Edition/", async () => {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  root.parent = volume;
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = volume;
  const synopsis = new TFile(`Projet/${EDITION_FOLDER_NAME}/Synopsis.md`);
  synopsis.parent = edition;
  const submissions = new TFolder(`Projet/${EDITION_FOLDER_NAME}/Soumissions`);
  submissions.parent = edition;
  submissions.children = [];
  edition.children = [synopsis, submissions];

  const { view, contentEl, openedFiles } = createView({ root, editionFolder: edition });
  await view.render();

  const texts = textsOf(contentEl);
  assert.ok(texts.includes("Synopsis"), "le document Synopsis est listé (basename, sans extension)");
  assert.ok(texts.some((t) => t === "Soumissions"), "le sous-dossier Soumissions est listé");

  // Cliquer sur la ligne du document déclenche bien l'ouverture du fichier réel.
  const row = rowWithLabel(contentEl, "Synopsis");
  await row.events.get("click")();
  assert.deepEqual(openedFiles, [synopsis]);
});

test("EditionDocsView : le bouton de révélation retombe sur une Notice si l'explorateur natif est indisponible", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const edition = new TFolder(`Projet/${EDITION_FOLDER_NAME}`);
  edition.parent = root.parent;
  const doc = new TFile(`Projet/${EDITION_FOLDER_NAME}/Biographie.md`);
  doc.parent = edition;
  edition.children = [doc];

  const { view, contentEl, app } = createView({ root, editionFolder: edition });
  // Pas d'internalPlugins sur ce app de test : revealInFileExplorer doit renvoyer false sans lever.
  assert.equal(revealInFileExplorer(app, doc), false);

  await view.render();
  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (m) => notices.push(m);
  try {
    // Le bouton de révélation est le second bouton de la ligne du document.
    const rowButtons = buttonsOf(contentEl);
    const btn = rowButtons[rowButtons.length - 1];
    await btn.events.get("click")({ stopPropagation() {} });
    assert.equal(notices.length, 1);
  } finally {
    Notice.onCreate = previousNotice;
  }
});
