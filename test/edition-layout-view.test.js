import test from "node:test";
import assert from "node:assert/strict";
import { EditionLayoutView } from "../src/views/edition-layout-view.js";

/* Même petit DOM factice que test/edition-composition-view.test.js
 * (convention du dépôt : dupliqué, pas partagé). */
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

function buildPlugin() {
  return {
    settings: { collapsed: {} },
    saveSettings: async () => {
      throw new Error("EditionLayoutView ne doit écrire aucun réglage en Phase 2");
    },
  };
}

test("EditionLayoutView : titre et icône corrects", () => {
  const plugin = buildPlugin();
  const view = new EditionLayoutView({ app: {}, contentEl: new FakeElement("div") }, plugin);
  assert.equal(view.getDisplayText(), "Mise en page");
  assert.equal(view.getIcon(), "panel-top");
});

test("EditionLayoutView : section repliable via renderSectionHead, description visible quand ouverte", async () => {
  const restore = installDom();
  try {
    const plugin = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionLayoutView({ app: {}, contentEl }, plugin);

    await view.onOpen();

    const section = contentEl.querySelector(".feuillets-project-section");
    assert.ok(section, "utilise le langage visuel feuillets-project-section");
    const head = contentEl.querySelector(".feuillets-section-title-text");
    assert.equal(head.textContent, "Mise en page");

    const description = contentEl.querySelector(".feuillets-edition-section-description");
    assert.ok(description, "la ligne descriptive est affichée");
    assert.equal(description.textContent, "Gabarit, typographie, marges, en-têtes et pieds de page.");

    // Ni sélecteur de gabarit, ni LayoutModal, ni réglage — Phase 11 seulement.
    assert.equal(contentEl.querySelectorAll("button").length, 0);
    assert.equal(contentEl.querySelectorAll("select").length, 0);
    assert.equal(contentEl.querySelectorAll("input").length, 0);
  } finally {
    restore();
  }
});

test("EditionLayoutView : repliée, elle ne montre que l'en-tête", async () => {
  const restore = installDom();
  try {
    const plugin = buildPlugin();
    plugin.settings.collapsed["editionLayout:panel"] = true;
    const contentEl = new FakeElement("div");
    const view = new EditionLayoutView({ app: {}, contentEl }, plugin);

    await view.onOpen();

    assert.equal(contentEl.querySelector(".feuillets-edition-section-description"), null);
    assert.ok(contentEl.querySelector(".feuillets-section-title-text"), "l'en-tête reste visible");
  } finally {
    restore();
  }
});

test("EditionLayoutView : aucune dépendance à PreviewView ni écriture Vault", async () => {
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
