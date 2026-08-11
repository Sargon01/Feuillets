import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { BibliographyPanel } from "../src/ui/bibliography-panel.js";
import { readGeneratedIncluded } from "../src/services/book-composition.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Même petit DOM factice que test/tables-panel.test.js (convention du dépôt
 * : dupliqué, pas partagé). Compatible avec la vraie classe Setting du stub
 * (test/obsidian-runtime-stub.mjs). */
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
  click() { if (this.tagName === "INPUT") { this.checked = !this.checked; this.dispatch("change"); } else this.dispatch("click"); }
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

/** Volume/Manuscrit/_Recherche/Bibliographie, avec `n` fiches valides —
 * même montage que test/bibliography-generator.test.js (getResearchRoot
 * reconnaît _Recherche comme FRÈRE de Manuscrit). */
function buildFixture(referenceCount = 0) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/_Recherche");
  const biblio = new TFolder("Projet/_Recherche/Bibliographie");
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  research.children = [biblio];
  biblio.parent = research;

  const frontmatter = new Map();
  const entries = [];
  for (let i = 0; i < referenceCount; i++) {
    const file = new TFile(`Projet/_Recherche/Bibliographie/Réf ${i}.md`, `---\ntitle: Titre ${i}\nauthor: Auteur ${i}\n---\n`);
    file.parent = biblio;
    entries.push(file);
    frontmatter.set(file.path, { title: `Titre ${i}`, author: `Auteur ${i}` });
  }
  biblio.children = entries;

  const { vault, files } = createFakeVault([volume, manuscript, research, biblio, ...entries]);
  vault.files = files;
  const app = { vault, metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) } };
  const settings = { projectFolder: manuscript.path, projectMeta: {} };
  const plugin = {
    settings,
    getProjectFolder: () => app.vault.getAbstractFileByPath(manuscript.path),
    saveSettings: async () => {},
  };
  return { app, plugin, manuscript };
}

test("BibliographyPanel : une seule ligne latérale « Bibliographie »", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture(0);
    const container = new FakeElement("div");
    const panel = new BibliographyPanel(app, plugin, container);
    await panel.render();

    const names = container.querySelectorAll(".feuillets-properties-key").map((n) => n.textContent);
    assert.deepEqual(names, ["Bibliographie"]);
    assert.equal(container.querySelectorAll(".setting-item").length, 0);
  } finally {
    restore();
  }
});

test("BibliographyPanel : case Inclure et décompte sur la même ligne", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture(12);
    const container = new FakeElement("div");
    const panel = new BibliographyPanel(app, plugin, container);
    await panel.render();

    assert.ok(container.querySelector('[aria-label="Inclure la bibliographie"]'));

    assert.equal(container.querySelector(".feuillets-edition-count").textContent, "12 référence(s)");
  } finally {
    restore();
  }
});

test("BibliographyPanel : décompte à 0 sans fiche exploitable", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture(0);
    const container = new FakeElement("div");
    const panel = new BibliographyPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.querySelector(".feuillets-edition-count").textContent, "0 référence(s)");
  } finally {
    restore();
  }
});

test("BibliographyPanel : exclue par défaut (defaultComposition), case décochée — aucune édition des références ici", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture(3);
    const container = new FakeElement("div");
    const panel = new BibliographyPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.querySelector('[aria-label="Inclure la bibliographie"]').checked, false);
    // Aucun champ texte, aucun bouton d'édition — seulement la case.
    assert.equal(container.querySelectorAll("input").length, 1);
    assert.equal(container.querySelectorAll("textarea").length, 0);
    assert.equal(container.querySelectorAll("button").length, 0);
  } finally {
    restore();
  }
});

test("BibliographyPanel : cocher Inclure écrit l'inclusion dans ProjectMeta sous l'identifiant bibliography", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture(1);
    const container = new FakeElement("div");
    const panel = new BibliographyPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure la bibliographie"]');
    include.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(readGeneratedIncluded(plugin.settings.projectMeta[manuscript.path], "bibliography"), true);
  } finally {
    restore();
  }
});

test("BibliographyPanel : décocher rétablit l'exclusion", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture(1);
    const container = new FakeElement("div");
    const panel = new BibliographyPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure la bibliographie"]');
    include.click();
    await Promise.resolve();
    await Promise.resolve();
    include.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(readGeneratedIncluded(plugin.settings.projectMeta[manuscript.path], "bibliography"), false);
  } finally {
    restore();
  }
});

test("BibliographyPanel : fonctionne parfaitement SANS callback onPresentationChanged", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture(1);
    const container = new FakeElement("div");
    const panel = new BibliographyPanel(app, plugin, container); // pas de callbacks
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure la bibliographie"]');
    await assert.doesNotReject(async () => {
      include.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    restore();
  }
});

test("BibliographyPanel : callback onPresentationChanged, fourni, est appelé après une bascule", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture(1);
    const container = new FakeElement("div");
    let calls = 0;
    const panel = new BibliographyPanel(app, plugin, container, { onPresentationChanged: () => { calls++; } });
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure la bibliographie"]');
    include.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("BibliographyPanel : sans projet actif, ne lève pas et le toggle reste utilisable", async () => {
  const restore = installDom();
  try {
    const app = { vault: createFakeVault([]).vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
    const plugin = { settings: { projectMeta: {} }, getProjectFolder: () => null, saveSettings: async () => {} };
    const container = new FakeElement("div");
    const panel = new BibliographyPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure la bibliographie"]');
    assert.ok(include);
    assert.equal(container.querySelector(".feuillets-edition-count").textContent, "0 référence(s)");
    await assert.doesNotReject(async () => {
      include.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    restore();
  }
});
