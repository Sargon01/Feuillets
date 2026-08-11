import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { FirstPagePanel, frontTitleCandidates, previewFirstPageFields } from "../src/ui/first-page-panel.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Même petit DOM factice que test/export-panel.test.js (convention du
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

function frontTitleContent(title = "Grand Roman", author = "Auteur Test") {
  return [
    "---", `title: ${title}`, "type: titre", "compile: true", "---",
    `:::titre: ${title}`,
    ":::sous-titre: ",
    ":::mots: ",
    `:::auteur: ${author}`,
    "",
  ].join("\n");
}

/** Fixture minimale : un projet avec un dossier Front, une metadataCache en
 * mémoire (compile/type) indépendante du contenu texte — comme le vrai
 * coffre, où le cache de métadonnées et le texte sont deux systèmes
 * distincts (voir aussi test/preview-view.test.js, même convention). */
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
    exportTemplate: "classique",
    collapsed: {},
    manuscriptTitle: "",
    manuscriptAuthor: "",
    binderSelectedPath: "",
  };
  const plugin = {
    settings,
    getProjectFolder: () => app.vault.getAbstractFileByPath(manuscript.path),
    saveSettings: async () => {},
  };

  async function addFrontPage(name, opts = {}) {
    const path = `${front.path}/${name}.md`;
    const file = await app.vault.create(path, opts.content ?? frontTitleContent(opts.title, opts.author));
    frontmatter.set(file.path, { type: opts.type ?? "titre", compile: opts.compile !== false, ...(opts.fm || {}) });
    return file;
  }

  return { app, settings, plugin, manuscript, front, frontmatter, addFrontPage };
}

/* ------------------------- frontTitleCandidates ------------------------- */

test("frontTitleCandidates : trouve les Front type:titre, ignore les autres Front", async () => {
  const { app, plugin, addFrontPage } = buildFixture();
  const titlePage = await addFrontPage("Page de titre");
  await addFrontPage("Dédicace", { type: "dedicace" });
  await addFrontPage("Remerciements", { type: "remerciements" });

  const found = frontTitleCandidates(app, plugin);
  assert.deepEqual(found.map((f) => f.path), [titlePage.path]);
});

test("frontTitleCandidates : compile:false n'exclut pas un feuillet de la liste — il reste choisissable", async () => {
  const { app, plugin, addFrontPage } = buildFixture();
  const excluded = await addFrontPage("Variante", { compile: false });

  const found = frontTitleCandidates(app, plugin);
  assert.deepEqual(found.map((f) => f.path), [excluded.path]);
});

test("frontTitleCandidates : aucun dossier projet -> liste vide, sans lever", async () => {
  const { app } = buildFixture();
  const plugin = { getProjectFolder: () => null, settings: {} };
  assert.deepEqual(frontTitleCandidates(app, plugin), []);
});

/* --------------------------- previewFirstPageFields ---------------------- */

test("previewFirstPageFields : cinq rôles, dans l'ordre d'affichage", () => {
  const roles = previewFirstPageFields().map((f) => f.role);
  assert.deepEqual(roles, ["titre", "sous-titre", "auteur", "mots", "image"]);
});

/* ------------------------------- FirstPagePanel --------------------------- */

/** Ouvre la sous-section « Première page » via son chevron (`addExtraButton`,
 * aria-label = « Première page ») — même patron que
 * test/edition-composition-view.test.js (« Première page se déplie/replie »)
 * : repliée par défaut, les champs n'existent pas encore dans le DOM. Le
 * clic déclenche un `render()` asynchrone (lecture du dossier de gabarits
 * personnalisés puis du contenu du Front) : un macrotâche laisse le temps à
 * toute la chaîne de microtâches de se dérouler avant que le corps ne soit
 * interrogé, même patron que les autres await de ce fichier. */
async function openFirstPage(container) {
  container.querySelector('[aria-label="Première page"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("FirstPagePanel : repliée par défaut, seule la ligne Setting + chevron existe", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addFrontPage } = buildFixture();
    await addFrontPage("Page de titre", { title: "NEFES", author: "Halim" });
    const container = new FakeElement("div");
    const panel = new FirstPagePanel(app, plugin, container);
    await panel.render();

    const name = container.querySelector(".feuillets-project-row-label");
    assert.equal(name.textContent, "Première page");
    assert.equal(container.querySelectorAll(".setting-item").length, 0);
    assert.equal(container.querySelector('[aria-label="Inclure la page de titre"]'), null, "repliée : les champs n'existent pas encore");
  } finally {
    restore();
  }
});

test("FirstPagePanel : dépliée, sélectionne le Front inclus, coche l'inclusion, lit les rôles", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addFrontPage } = buildFixture();
    await addFrontPage("Page de titre", { title: "NEFES", author: "Halim" });
    const container = new FakeElement("div");
    const panel = new FirstPagePanel(app, plugin, container);
    await panel.render();
    await openFirstPage(container);

    const include = container.querySelector('[aria-label="Inclure la page de titre"]');
    assert.equal(include.checked, true);
    assert.equal(container.querySelector('[aria-label="Titre"]').value, "NEFES");
    assert.equal(container.querySelector('[aria-label="Auteur"]').value, "Halim");
  } finally {
    restore();
  }
});

test("FirstPagePanel : inclusion écrit compile dans le frontmatter du Front", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addFrontPage, frontmatter } = buildFixture();
    const page = await addFrontPage("Page de titre");
    const container = new FakeElement("div");
    const panel = new FirstPagePanel(app, plugin, container);
    await panel.render();
    await openFirstPage(container);

    const include = container.querySelector('[aria-label="Inclure la page de titre"]');
    include.checked = false;
    include.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(frontmatter.get(page.path).compile, false);
  } finally {
    restore();
  }
});

test("FirstPagePanel : changer de Front exclut les autres sans les supprimer", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addFrontPage, frontmatter } = buildFixture();
    const main = await addFrontPage("Page de titre", { title: "Principal" });
    const variant = await addFrontPage("Variante", { title: "Variante", compile: false });
    const container = new FakeElement("div");
    const panel = new FirstPagePanel(app, plugin, container);
    await panel.render();
    await openFirstPage(container);

    const picker = container.querySelector('[aria-label="Fichier Front utilisé"]');
    assert.deepEqual(picker.children.map((o) => o.value), [main.path, variant.path]);

    picker.value = variant.path;
    picker.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(frontmatter.get(variant.path).compile, true);
    assert.equal(frontmatter.get(main.path).compile, false, "un seul Front sert de première page");
    // Aucun fichier n'est supprimé — les deux existent toujours dans le coffre.
    assert.ok(app.vault.getAbstractFileByPath(main.path));
    assert.ok(app.vault.getAbstractFileByPath(variant.path));
  } finally {
    restore();
  }
});

test("FirstPagePanel : écriture des rôles — titre synchronise manuscriptTitle, auteur synchronise manuscriptAuthor", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addFrontPage } = buildFixture();
    await addFrontPage("Page de titre");
    const container = new FakeElement("div");
    const panel = new FirstPagePanel(app, plugin, container);
    await panel.render();
    await openFirstPage(container);

    const titleInput = container.querySelector('[aria-label="Titre"]');
    titleInput.value = "NEFES";
    titleInput.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    const authorInput = container.querySelector('[aria-label="Auteur"]');
    authorInput.value = "Halim";
    authorInput.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(plugin.settings.manuscriptTitle, "NEFES");
    assert.equal(plugin.settings.manuscriptAuthor, "Halim");
  } finally {
    restore();
  }
});

test("FirstPagePanel : ouverture du Front dans l'éditeur et sélection dans le Binder", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addFrontPage } = buildFixture();
    const page = await addFrontPage("Page de titre");
    let opened = null;
    plugin.getLeafForOpeningFile = () => ({ openFile: async (file) => { opened = file; } });
    const container = new FakeElement("div");
    const panel = new FirstPagePanel(app, plugin, container);
    await panel.render();
    await openFirstPage(container);

    const open = container.querySelector('[aria-label="Ouvrir le fichier Front"]');
    assert.ok(open);
    open.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(opened, page);
    assert.equal(plugin.settings.binderSelectedPath, "Projet/Manuscrit/Front");
  } finally {
    restore();
  }
});

test("FirstPagePanel : n'offre plus d'accès à la mise en page visuelle", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addFrontPage } = buildFixture();
    await addFrontPage("Page de titre");
    plugin.settings.exportTemplate = "moderne";
    const container = new FakeElement("div");
    const panel = new FirstPagePanel(app, plugin, container);
    await panel.render();
    await openFirstPage(container);

    assert.equal(container.querySelector('[aria-label="Régler visuellement la page de titre"]'), null);
    assert.equal(container.textContent.includes("Mise en page visuelle"), false);
  } finally {
    restore();
  }
});

test("FirstPagePanel : fonctionne sans aucun feuillet Front — reste utilisable, une fois dépliée", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new FirstPagePanel(app, plugin, container);
    await panel.render();
    await openFirstPage(container);

    assert.equal(panel.frontTitleCandidates().length, 0);
    assert.ok(container.querySelector('[aria-label="Inclure la page de titre"]'), "l'inclusion reste affichée");
    assert.equal(container.querySelector('[aria-label="Fichier Front utilisé"]'), null, "aucun fichier à choisir");
    assert.equal(container.querySelector('[aria-label="Régler visuellement la page de titre"]'), null);
  } finally {
    restore();
  }
});

test("FirstPagePanel : fonctionne parfaitement SANS callback onPresentationChanged (aucune PreviewView requise)", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addFrontPage } = buildFixture();
    await addFrontPage("Page de titre");
    const container = new FakeElement("div");
    const panel = new FirstPagePanel(app, plugin, container); // pas de callbacks
    await panel.render();
    await openFirstPage(container);

    const titleInput = container.querySelector('[aria-label="Titre"]');
    titleInput.value = "Sans Preview";
    await assert.doesNotReject(async () => {
      titleInput.dispatch("change");
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(plugin.settings.manuscriptTitle, "Sans Preview");
  } finally {
    restore();
  }
});

test("FirstPagePanel : callback onPresentationChanged, fourni, est appelé après un changement", async () => {
  const restore = installDom();
  try {
    const { app, plugin, addFrontPage } = buildFixture();
    await addFrontPage("Page de titre");
    const container = new FakeElement("div");
    let calls = 0;
    const panel = new FirstPagePanel(app, plugin, container, { onPresentationChanged: () => { calls++; } });
    await panel.render();
    await openFirstPage(container);
    calls = 0; // ignorer un éventuel appel lié au dépliage lui-même

    const titleInput = container.querySelector('[aria-label="Titre"]');
    titleInput.value = "Avec Preview";
    titleInput.dispatch("change");
    // La chaîne interne (lecture, écriture, réglages, callback) empile
    // plusieurs await successifs : un macrotâche laisse le temps à toute la
    // chaîne de microtâches de se dérouler (même pattern que
    // test/export-panel.test.js et test/preview-view.test.js).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls, 1);
  } finally {
    restore();
  }
});
