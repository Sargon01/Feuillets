import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFolder } from "obsidian";
import { EditionLayoutView } from "../src/views/edition-layout-view.js";
import { TextPromptModal } from "../src/ui/basic-modals.js";
import { LayoutModal } from "../src/ui/layout-modal.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createCustomTemplateFromV2 } from "../src/services/export-templates-custom.js";
import { createDefaultExportTemplateV2 } from "../src/services/export-template-v2.js";

/* Même petit DOM factice que test/edition-composition-view.test.js
 * (convention du dépôt : dupliqué, pas partagé), complété de ce
 * qu'EditionLayoutView utilise en plus (select/option, input file, click). */
class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.classes = new Set();
    this._attributes = new Map();
    this._eventListeners = new Map();
    this.value = "";
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
  addClass(name) { this.classes.add(name); }
  setText(value) { this.textContent = value; }
  empty() { for (const child of [...this.children]) child.remove(); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
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

/** Plugin minimal — pas de dossier projet configuré : listExportTemplates()
 * retombe alors sur les seuls modèles intégrés (aucun vault nécessaire). */
function buildPlugin() {
  return {
    settings: { collapsed: {}, exportTemplate: "classique" },
    saveSettings: async () => {},
  };
}

function buildCreationFixture() {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = project;
  project.children = [manuscript];
  const { vault, fileManager } = createFakeVault([project, manuscript]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  let saves = 0;
  const plugin = {
    settings: { collapsed: {}, exportTemplate: "classique", projectFolder: manuscript.path },
    saveSettings: async () => { saves += 1; },
  };
  return { app, plugin, saves: () => saves };
}

test("EditionLayoutView : titre et icône corrects", () => {
  const plugin = buildPlugin();
  const view = new EditionLayoutView({ app: {}, contentEl: new FakeElement("div") }, plugin);
  assert.equal(view.getDisplayText(), "Mise en page & export");
  assert.equal(view.getIcon(), "panel-top");
});

test("EditionLayoutView : sélecteur Gabarit peuplé par listExportTemplates, valeur = settings.exportTemplate", async () => {
  const restore = installDom();
  try {
    const plugin = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionLayoutView({ app: {}, contentEl }, plugin);

    await view.onOpen();

    const section = contentEl.querySelector(".feuillets-project-section");
    assert.ok(section, "utilise le langage visuel feuillets-project-section");
    const head = contentEl.querySelector(".feuillets-section-title-text");
    assert.equal(head.textContent, "Mise en page & export");

    const select = contentEl.querySelector('[aria-label="Gabarit"]');
    assert.ok(select, "le sélecteur Gabarit est présent");
    assert.equal(select.value, "classique");
    const options = select.children.map((o) => o.value);
    assert.ok(options.includes("classique"));
    assert.ok(options.includes("moderne"));
    assert.equal(options.length, 5, "seuls les cinq gabarits intégrés proposés sont listés");
  } finally {
    restore();
  }
});

test("EditionLayoutView : changer le sélecteur écrit directement settings.exportTemplate et sauvegarde", async () => {
  const restore = installDom();
  try {
    const plugin = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionLayoutView({ app: {}, contentEl }, plugin);
    await view.onOpen();

    let saved = false;
    plugin.saveSettings = async () => { saved = true; };

    const select = contentEl.querySelector('[aria-label="Gabarit"]');
    select.value = "moderne";
    select.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(plugin.settings.exportTemplate, "moderne");
    assert.equal(saved, true);
  } finally {
    restore();
  }
});

test("EditionLayoutView : Modifier visuellement et le menu d'options sont présents", async () => {
  const restore = installDom();
  try {
    const plugin = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionLayoutView({ app: {}, contentEl }, plugin);
    await view.onOpen();

    assert.ok(contentEl.querySelector('[aria-label="Modifier visuellement"]'));
    assert.ok(contentEl.querySelector('[aria-label="Options du gabarit"]'));
    assert.equal(contentEl.querySelectorAll(".feuillets-edition-action-row").length, 1);
    assert.equal(contentEl.querySelectorAll(".setting-item").length, 0);
  } finally {
    restore();
  }
});

test("EditionLayoutView : Nouveau gabarit crée un V2 actif sans écraser une collision et ouvre l'éditeur", async () => {
  const restore = installDom();
  const originalPromptOpen = TextPromptModal.prototype.open;
  const originalLayoutOpen = LayoutModal.prototype.open;
  let promptResult = null;
  const opened = [];
  TextPromptModal.prototype.open = function openPrompt() { this.onResult(promptResult); };
  LayoutModal.prototype.open = function openLayout() { opened.push({ key: this.templateKey, label: this.templateLabel }); return this; };
  try {
    const { app, plugin, saves } = buildCreationFixture();
    const contentEl = new FakeElement("div");
    const view = new EditionLayoutView({ app, contentEl }, plugin);
    await view.onOpen();

    contentEl.querySelector('[aria-label="Options du gabarit"]').click();
    const menu = Menu.lastShown;
    assert.deepEqual(menu.items.filter((item) => !item.separator).map((item) => item.title), ["Nouveau gabarit…", "Dupliquer", "Importer Ulysses", "Importer Word"]);

    await view.createNewTemplate();
    assert.equal(app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Mises en page/gabarit.md"), null, "annulation : aucun fichier");
    promptResult = "   ";
    await view.createNewTemplate();
    assert.equal(app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Mises en page/gabarit.md"), null, "nom vide : aucun fichier");

    promptResult = "Mon modèle";
    await view.createNewTemplate();
    const created = app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Mises en page/mon-modele.md");
    assert.ok(created, "le nouveau fichier est créé dans Resources/Mises en page");
    assert.match(created.content, /version: 2/);
    assert.match(created.content, /profile: document/);
    assert.equal(plugin.settings.exportTemplate, "mon-modele");
    assert.equal(saves(), 1);
    assert.deepEqual(opened, [{ key: "mon-modele", label: "Mon modèle" }]);

    const firstContent = created.content;
    await view.createNewTemplate();
    assert.equal(created.content, firstContent, "la collision ne remplace jamais le premier fichier");
    assert.ok(app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Mises en page/mon-modele-2.md"));
    assert.equal(plugin.settings.exportTemplate, "mon-modele-2");
    assert.equal(saves(), 2);
    assert.deepEqual(opened.at(-1), { key: "mon-modele-2", label: "Mon modèle" });
  } finally {
    TextPromptModal.prototype.open = originalPromptOpen;
    LayoutModal.prototype.open = originalLayoutOpen;
    restore();
  }
});

test("EditionLayoutView : les actions Renommer et Supprimer n'apparaissent que pour un fichier personnalisé actif", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildCreationFixture();
    const contentEl = new FakeElement("div");
    const view = new EditionLayoutView({ app, contentEl }, plugin);
    await view.onOpen();
    contentEl.querySelector('[aria-label="Options du gabarit"]').click();
    assert.equal(Menu.lastShown.items.some((item) => item.title === "Renommer…"), false);
    assert.equal(Menu.lastShown.items.some((item) => item.title === "Supprimer…"), false);

    await createCustomTemplateFromV2(app, plugin.settings, "perso", "Personnel", createDefaultExportTemplateV2());
    await view.render();
    contentEl.querySelector('[aria-label="Options du gabarit"]').click();
    assert.deepEqual(Menu.lastShown.items.filter((item) => !item.separator).map((item) => item.title), ["Nouveau gabarit…", "Dupliquer", "Renommer…", "Supprimer…", "Importer Ulysses", "Importer Word"]);
  } finally { restore(); }
});

test("EditionLayoutView : repliée, elle ne montre que l'en-tête", async () => {
  const restore = installDom();
  try {
    const plugin = buildPlugin();
    plugin.settings.collapsed["editionLayout:panel"] = true;
    const contentEl = new FakeElement("div");
    const view = new EditionLayoutView({ app: {}, contentEl }, plugin);

    await view.onOpen();

    assert.equal(contentEl.querySelector('[aria-label="Gabarit"]'), null);
    assert.ok(contentEl.querySelector(".feuillets-section-title-text"), "l'en-tête reste visible");
  } finally {
    restore();
  }
});

test("EditionLayoutView : aucune dépendance à PreviewView", async () => {
  const restore = installDom();
  try {
    const plugin = buildPlugin();
    const view = new EditionLayoutView({ app: {}, contentEl: new FakeElement("div") }, plugin);
    assert.equal("compileScope" in view, false);
    assert.equal("effectiveExportScope" in view, false);
    await view.onOpen();
  } finally {
    restore();
  }
});
