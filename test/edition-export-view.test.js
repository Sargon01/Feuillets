import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { EditionExportView } from "../src/views/edition-export-view.js";
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
  addClass(name) { this.classes.add(name); }
  setText(value) { this.textContent = value; }
  empty() { for (const child of [...this.children]) child.remove(); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options.text || "");
    if (options.cls) child.className = options.cls;
    if (options.value !== undefined) child.value = options.value;
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

/** Plugin minimal — SANS aucune référence à une PreviewView, exactement le
 * contrat d'EditionExportView : elle ne connaît que ExportPanelPlugin. */
function buildFixture() {
  const manuscript = new TFolder("Projet/Manuscrit");
  const scene = new TFile("Projet/Manuscrit/Scène 1.md", "---\ntitle: Départ\n---\nTexte.");
  manuscript.children = [scene];
  scene.parent = manuscript;
  const { vault, fileManager, files } = createFakeVault([manuscript, scene]);
  vault.cachedRead = vault.read;
  vault.files = files;
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = {
    projectFolder: manuscript.path,
    exportTemplate: "classique",
    exportFormat: "docx",
    compileFileName: "Manuscrit.md",
    activePreset: -1,
    compilePresets: [],
    collapsed: {},
    projectMeta: {},
    orders: {},
  };
  const plugin = {
    settings,
    activeExportScope: null,
    getProjectFolder: () => app.vault.getAbstractFileByPath(manuscript.path),
    saveSettings: async () => {},
  };
  return { app, plugin, manuscript };
}

test("EditionExportView : se rend sans aucune instance de PreviewView", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const contentEl = new FakeElement("div");
    const view = new EditionExportView({ app, contentEl }, plugin);

    await view.onOpen();

    // Aucune exception, aucune dépendance à une vue Aperçu : le panneau
    // partagé (ExportPanel) est monté directement.
    assert.ok(contentEl.querySelector('[aria-label="Portée de l’export"]'), "le panneau Export partagé est monté");
  } finally {
    restore();
  }
});

test("EditionExportView : portée par défaut = Projet entier", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture();
    const contentEl = new FakeElement("div");
    const view = new EditionExportView({ app, contentEl }, plugin);

    await view.onOpen();

    const label = contentEl.querySelector('[aria-label="Portée de l’export"]');
    assert.equal(label.textContent, "Projet");
    assert.deepEqual(plugin.activeExportScope, { type: "project", projectRoot: manuscript.path });
  } finally {
    restore();
  }
});

test("EditionExportView : une portée de session déjà mémorisée (Binder/Aperçu) est réutilisée", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture();
    // Portée déjà choisie ailleurs dans la session (ex. clic Binder →
    // fichier), mémorisée sur le plugin comme le ferait
    // services/export-workflow.ts (rememberExportScope).
    const scope = { type: "file", projectRoot: manuscript.path, path: "Projet/Manuscrit/Scène 1.md" };
    plugin.activeExportScope = scope;

    const contentEl = new FakeElement("div");
    const view = new EditionExportView({ app, contentEl }, plugin);
    await view.onOpen();

    const label = contentEl.querySelector('[aria-label="Portée de l’export"]');
    assert.equal(label.textContent, "Feuillet");
    assert.deepEqual(plugin.activeExportScope, scope, "la portée de session n'est pas remplacée");
  } finally {
    restore();
  }
});

test("EditionExportView : utilise le panneau Export partagé, exportable même sans Aperçu ouvert", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    plugin.settings.exportFormat = "md";
    const contentEl = new FakeElement("div");
    const view = new EditionExportView({ app, contentEl }, plugin);
    await view.onOpen();

    const launch = contentEl.querySelectorAll("button").find((el) => el.textContent === "Exporter");
    assert.ok(launch, "le bouton Exporter du panneau partagé est présent");
    launch.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Vérifie l'écriture réelle du manuscrit compilé (services/export-workflow.ts
    // → exportWithScope → compile()), plutôt qu'un espion sur une PreviewView
    // qui n'existe pas ici.
    const written = [...app.vault.files.values()].some((f) => f.path?.endsWith(".md") && f.path.includes("Sortie"));
    assert.ok(written, "l'export doit avoir réellement écrit un fichier compilé, sans Aperçu ouvert");
  } finally {
    restore();
  }
});

test("EditionExportView : replier la section n'affiche plus le panneau, et ne monte rien à l'ouverture suivante", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const contentEl = new FakeElement("div");
    const view = new EditionExportView({ app, contentEl }, plugin);
    await view.onOpen();
    assert.ok(contentEl.querySelector('[aria-label="Portée de l’export"]'));

    const head = contentEl.querySelectorAll(".feuillets-section-title")[0];
    head.click();
    await view.render();

    assert.equal(contentEl.querySelector('[aria-label="Portée de l’export"]'), null, "la section repliée ne monte plus le panneau");
  } finally {
    restore();
  }
});
