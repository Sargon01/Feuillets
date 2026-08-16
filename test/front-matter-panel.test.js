import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { FrontMatterPanel, frontMatterPages } from "../src/ui/front-matter-panel.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Même petit DOM factice que test/first-page-panel.test.js (convention du
 * dépôt : dupliqué, pas partagé). */
class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.classes = new Set();
    this._attributes = new Map();
    this._eventListeners = new Map();
  }
  addEventListener(type, listener) {
    if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
    this._eventListeners.get(type).push(listener);
  }
  dispatch(type, event) {
    const list = this._eventListeners.get(type);
    if (list) [...list].forEach((fn) => fn(event || { target: this }));
  }
  click() { this.dispatch("click"); }
  toggleClass(cls, val) {
    if (val === undefined) { if (this.classes.has(cls)) this.classes.delete(cls); else this.classes.add(cls); }
    else if (val) this.classes.add(cls);
    else this.classes.delete(cls);
  }
  hasClass(cls) { return this.classes.has(cls); }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(value) { this.children = []; this._text = value; }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get open() { return this._open === true; }
  set open(value) { this._open = !!value; }
  addClass(name) { this.classes.add(name); }
  setText(value) { this.textContent = value; }
  empty() { for (const child of [...this.children]) child.remove(); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  setAttr(name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options.text || "");
    if (options.cls) child.className = options.cls;
    if (options.value !== undefined) child.value = options.value;
    if (options.type !== undefined) child.type = options.type;
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) child.setAttribute(k, v);
    return this.appendChild(child);
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matches(node, selector) {
  const attr = selector.match(/^\[([^=\]]+)="?([^"\]]*)"?\]$/);
  if (attr) return node.getAttribute(attr[1]) === attr[2];
  if (selector.startsWith(".")) return node.classes.has(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

function installDom() {
  const previous = { createEl: globalThis.createEl, createDiv: globalThis.createDiv, createSpan: globalThis.createSpan };
  globalThis.createEl = (tag, options = {}) => { const el = new FakeElement(tag, options.text || ""); if (options.cls) el.className = options.cls; return el; };
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
  return () => {
    globalThis.createEl = previous.createEl;
    globalThis.createDiv = previous.createDiv;
    globalThis.createSpan = previous.createSpan;
  };
}

/** Fixture minimale : un projet avec un dossier Front, une metadataCache en
 * mémoire (type/compile/title) indépendante du contenu texte — même
 * convention que test/first-page-panel.test.js. */
function buildFixture() {
  const manuscript = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/Front");
  front.parent = manuscript;
  manuscript.children = [front];
  const { vault, files } = createFakeVault([manuscript, front]);
  vault.cachedRead = vault.read;
  vault.files = files;

  const frontmatter = new Map();
  const fileManager = {
    processFrontMatter: async (file, mutate) => {
      const data = { ...(frontmatter.get(file.path) || {}) };
      mutate(data);
      frontmatter.set(file.path, data);
    },
  };
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) },
    workspace: { getLeaf: () => null },
  };
  const settings = {
    projectFolder: manuscript.path,
    collapsed: {},
    orders: {},
    folderPositions: {},
    binderSelectedPath: "",
  };
  const plugin = {
    settings,
    getProjectFolder: () => app.vault.getAbstractFileByPath(manuscript.path),
    saveSettings: async () => {},
  };

  async function addPage(name, opts = {}) {
    const path = `${front.path}/${name}.md`;
    const file = await app.vault.create(path, opts.content ?? "");
    frontmatter.set(file.path, { type: opts.type ?? "dedicace", compile: opts.compile !== false, ...(opts.fm || {}) });
    return file;
  }

  return { app, settings, plugin, manuscript, front, frontmatter, addPage };
}

/* ------------------------------ frontMatterPages -------------------------- */

test("frontMatterPages : exclut le feuillet type:titre, déjà géré par Première page", async () => {
  const { app, plugin, addPage } = buildFixture();
  const dedicace = await addPage("Dédicace", { type: "dedicace" });
  await addPage("Page de titre", { type: "titre" });

  const pages = frontMatterPages(app, plugin);
  assert.deepEqual(pages.map((f) => f.path), [dedicace.path]);
});

test("frontMatterPages : conserve l'ordre existant du projet (getOrderedChildren, pas de second système d'ordre)", async () => {
  const { app, plugin, addPage, front } = buildFixture();
  // Créées dans l'ordre alphabétique inverse de leur nom, pour vérifier que
  // c'est bien l'ordre projet enregistré (settings.orders) qui gouverne —
  // jamais un tri propre à ce composant.
  const z = await addPage("Z Remerciements");
  const a = await addPage("A Épigraphe");
  plugin.settings.orders[front.path] = [z.name, a.name];

  const pages = frontMatterPages(app, plugin);
  assert.deepEqual(pages.map((f) => f.path), [z.path, a.path]);
});

test("frontMatterPages : aucun dossier Front -> liste vide, sans lever", async () => {
  const { app } = buildFixture();
  const plugin = { getProjectFolder: () => null, settings: { orders: {}, folderPositions: {} } };
  assert.deepEqual(frontMatterPages(app, plugin), []);
});

test("frontMatterPages : liste vide si le dossier Front ne contient que la page de titre", async () => {
  const { app, plugin, addPage } = buildFixture();
  await addPage("Page de titre", { type: "titre" });
  assert.deepEqual(frontMatterPages(app, plugin), []);
});

/* ------------------------------ FrontMatterPanel --------------------------- */

/** Ouvre la sous-section « Pages liminaires » via son chevron
 * (`addExtraButton`, aria-label = « Pages liminaires ») — même patron que
 * test/edition-composition-content.test.js (« Première page se déplie/replie »)
 * : repliée par défaut, la liste n'existe pas encore dans le DOM. */
function openFrontMatter(container) {
  container.querySelector('[aria-label="Pages liminaires"]').click();
}

test("FrontMatterPanel : affiche chaque page avec case Inclure, titre/nom et action Ouvrir, une fois dépliée", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addPage } = buildFixture();
    await addPage("Dédicace", { fm: { title: "À ma mère" } });
    const container = new FakeElement("div");
    const panel = new FrontMatterPanel(app, plugin, container);
    await panel.render();

    const name = container.querySelector(".feuillets-project-row-label");
    assert.equal(name.textContent, "Pages liminaires");
    assert.equal(container.querySelector('[aria-label="Inclure À ma mère"]'), null, "repliée par défaut : rien à afficher");

    openFrontMatter(container);
    await Promise.resolve();
    await Promise.resolve();

    const include = container.querySelector('[aria-label="Inclure À ma mère"]');
    assert.ok(include, "case Inclure présente, libellée par le titre affiché");
    assert.equal(include.checked, true, "compile:true par défaut -> incluse");

    const names = container.querySelectorAll(".feuillets-properties-key").map((node) => node.textContent);
    assert.ok(names.includes("À ma mère"), "le titre du frontmatter prime sur le nom de fichier");

    assert.ok(container.querySelector('[aria-label="Ouvrir À ma mère"]'), "action Ouvrir présente");
  } finally {
    restore();
  }
});

test("FrontMatterPanel : lit compile — une page exclue affiche la case décochée", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addPage } = buildFixture();
    await addPage("Dédicace", { compile: false });
    const container = new FakeElement("div");
    const panel = new FrontMatterPanel(app, plugin, container);
    await panel.render();
    openFrontMatter(container);
    await Promise.resolve();
    await Promise.resolve();

    const include = container.querySelector('[aria-label="Inclure Dédicace"]');
    assert.equal(include.checked, false);
  } finally {
    restore();
  }
});

test("FrontMatterPanel : décocher Inclure écrit compile:false dans le frontmatter", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addPage, frontmatter } = buildFixture();
    const page = await addPage("Dédicace");
    const container = new FakeElement("div");
    const panel = new FrontMatterPanel(app, plugin, container);
    await panel.render();
    openFrontMatter(container);
    await Promise.resolve();
    await Promise.resolve();

    const include = container.querySelector('[aria-label="Inclure Dédicace"]');
    include.checked = false;
    include.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(frontmatter.get(page.path).compile, false);
  } finally {
    restore();
  }
});

test("FrontMatterPanel : recocher Inclure rétablit compile:true", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addPage, frontmatter } = buildFixture();
    const page = await addPage("Dédicace", { compile: false });
    const container = new FakeElement("div");
    const panel = new FrontMatterPanel(app, plugin, container);
    await panel.render();
    openFrontMatter(container);
    await Promise.resolve();
    await Promise.resolve();

    const include = container.querySelector('[aria-label="Inclure Dédicace"]');
    include.checked = true;
    include.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(frontmatter.get(page.path).compile, true);
  } finally {
    restore();
  }
});

test("FrontMatterPanel : ouverture du fichier dans l'éditeur et sélection dans le Binder", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addPage } = buildFixture();
    const page = await addPage("Dédicace");
    let opened = null;
    plugin.getLeafForOpeningFile = () => ({ openFile: async (file) => { opened = file; } });
    const container = new FakeElement("div");
    const panel = new FrontMatterPanel(app, plugin, container);
    await panel.render();
    openFrontMatter(container);
    await Promise.resolve();
    await Promise.resolve();

    container.querySelector('[aria-label="Ouvrir Dédicace"]').click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(opened, page);
    assert.equal(plugin.settings.binderSelectedPath, "Projet/Manuscrit/Front");
  } finally {
    restore();
  }
});

test("FrontMatterPanel : aucune page -> « Aucune page liminaire. », une fois dépliée", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new FrontMatterPanel(app, plugin, container);
    await panel.render();
    openFrontMatter(container);
    await Promise.resolve();
    await Promise.resolve();

    const empty = container.querySelector(".feuillets-edition-empty");
    assert.ok(empty, "message d'état vide affiché");
    assert.equal(empty.textContent, "Aucune page liminaire.");
  } finally {
    restore();
  }
});

test("FrontMatterPanel : la page de titre n'apparaît jamais dans la liste (gérée par Première page)", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addPage } = buildFixture();
    await addPage("Page de titre", { type: "titre" });
    await addPage("Dédicace");
    const container = new FakeElement("div");
    const panel = new FrontMatterPanel(app, plugin, container);
    await panel.render();
    openFrontMatter(container);
    await Promise.resolve();
    await Promise.resolve();

    const items = container.querySelectorAll(".feuillets-properties-key").map((el) => el.textContent);
    assert.deepEqual(items, ["Dédicace"]);
  } finally {
    restore();
  }
});

test("FrontMatterPanel : fonctionne parfaitement SANS callback onPresentationChanged", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addPage } = buildFixture();
    await addPage("Dédicace");
    const container = new FakeElement("div");
    const panel = new FrontMatterPanel(app, plugin, container); // pas de callbacks
    const include = () => container.querySelector('[aria-label="Inclure Dédicace"]');
    await panel.render();
    openFrontMatter(container);
    await Promise.resolve();
    await Promise.resolve();

    await assert.doesNotReject(async () => {
      include().checked = false;
      include().dispatch("change");
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    restore();
  }
});

test("FrontMatterPanel : callback onPresentationChanged, fourni, est appelé après une bascule", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addPage } = buildFixture();
    await addPage("Dédicace");
    const container = new FakeElement("div");
    let calls = 0;
    const panel = new FrontMatterPanel(app, plugin, container, { onPresentationChanged: () => { calls++; } });
    await panel.render();
    openFrontMatter(container);
    await Promise.resolve();
    await Promise.resolve();
    calls = 0; // ignorer un éventuel appel lié au dépliage lui-même (aucun aujourd'hui, mais robuste au futur)

    const include = container.querySelector('[aria-label="Inclure Dédicace"]');
    include.checked = false;
    include.dispatch("change");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls, 1);
  } finally {
    restore();
  }
});
