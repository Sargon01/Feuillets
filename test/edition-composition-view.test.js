import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { EditionCompositionView } from "../src/views/edition-composition-view.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Même petit DOM factice que test/edition-export-view.test.js (convention
 * du dépôt : dupliqué, pas partagé). */
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

/** Plugin minimal — juste assez pour que FirstPagePanel (Première page) se
 * rende à l'intérieur de Composition. */
function buildPlugin() {
  const manuscript = new TFolder("Projet/Manuscrit");
  const { vault, files } = createFakeVault([manuscript]);
  vault.cachedRead = vault.read;
  vault.files = files;
  const frontmatter = new Map();
  const app = {
    vault,
    fileManager: {
      processFrontMatter: async (file, mutate) => {
        const data = { ...(frontmatter.get(file.path) || {}) };
        mutate(data);
        frontmatter.set(file.path, data);
      },
    },
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) },
    workspace: { getLeaf: () => null },
  };
  const plugin = {
    settings: { collapsed: {}, projectFolder: manuscript.path, exportTemplate: "classique" },
    getProjectFolder: () => app.vault.getAbstractFileByPath(manuscript.path),
    saveSettings: async () => {},
  };
  return { app, plugin };
}

test("EditionCompositionView : titre et icône corrects", () => {
  const { app, plugin } = buildPlugin();
  const view = new EditionCompositionView({ app, contentEl: new FakeElement("div") }, plugin);
  assert.equal(view.getDisplayText(), "Composition de l’ouvrage");
  assert.equal(view.getIcon(), "book-open");
});

test("EditionCompositionView : Composition reste la section principale, Première page y est réellement présente (Phase 3)", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionView({ app, contentEl }, plugin);

    await view.onOpen();

    const section = contentEl.querySelector(".feuillets-project-section");
    assert.ok(section, "utilise le langage visuel feuillets-project-section");
    const head = contentEl.querySelector(".feuillets-section-title-text");
    assert.equal(head.textContent, "Composition de l’ouvrage");

    // Première page : le composant partagé (ui/first-page-panel.ts) est
    // bien monté — même DOM que dans son propre test (feuillets-first-page).
    const firstPage = contentEl.querySelector(".feuillets-first-page");
    assert.ok(firstPage, "Première page est présente dans Composition de l'ouvrage");
    const summary = contentEl.querySelector(".feuillets-first-page-summary");
    assert.equal(summary.textContent, "Première page");
    assert.ok(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), "le composant partagé est bien rendu, pas une coquille vide");

    // L'ancienne phrase provisoire a disparu.
    assert.equal(contentEl.querySelector(".feuillets-edition-section-description"), null);
    assert.equal(
      contentEl.textContent.includes("Première page, pages liminaires, sommaire, tables, bibliographie, annexes et index."),
      false,
      "l'ancienne phrase provisoire ne doit plus apparaître"
    );

    // Aucun futur élément de composition factice (Pages liminaires, Sommaire,
    // Table des matières, Bibliographie, Annexes, Index) n'est ajouté avant
    // sa propre phase.
    const text = contentEl.textContent;
    for (const notYet of ["Pages liminaires", "Sommaire", "Table des matières", "Bibliographie", "Annexes", "Index"]) {
      assert.equal(text.includes(notYet), false, `« ${notYet} » ne doit pas apparaître avant sa propre phase`);
    }
  } finally {
    restore();
  }
});

test("EditionCompositionView : repliée, elle ne montre que l'en-tête (Première page n'est pas rendue)", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildPlugin();
    plugin.settings.collapsed["editionComposition:panel"] = true;
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionView({ app, contentEl }, plugin);

    await view.onOpen();

    assert.equal(contentEl.querySelector(".feuillets-first-page"), null);
    assert.ok(contentEl.querySelector(".feuillets-section-title-text"), "l'en-tête reste visible");
  } finally {
    restore();
  }
});

test("EditionCompositionView : aucune dépendance à PreviewView", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const view = new EditionCompositionView({ app, contentEl: new FakeElement("div") }, plugin);
    // Aucun champ ni méthode évoquant PreviewView.
    assert.equal("compileScope" in view, false);
    assert.equal("effectiveExportScope" in view, false);
    await view.onOpen();
  } finally {
    restore();
  }
});
