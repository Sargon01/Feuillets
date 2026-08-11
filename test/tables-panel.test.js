import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { TablesPanel } from "../src/ui/tables-panel.js";
import { readGeneratedIncluded } from "../src/services/book-composition.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Même petit DOM factice que test/contents-panel.test.js (convention du
 * dépôt : dupliqué, pas partagé). Compatible avec la vraie classe Setting du
 * stub (test/obsidian-runtime-stub.mjs) : createDiv/createEl y sont réels,
 * donc les lignes Setting rendues par TablesPanel construisent un DOM
 * factice mais fidèle, retrouvable par querySelector comme avant. */
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

function buildFixture() {
  const manuscript = new TFolder("Projet/Manuscrit");
  const { vault, files } = createFakeVault([manuscript]);
  vault.files = files;
  const app = { vault };
  const settings = { projectMeta: {} };
  const plugin = {
    settings,
    getProjectFolder: () => app.vault.getAbstractFileByPath(manuscript.path),
    saveSettings: async () => {},
  };
  return { app, plugin, manuscript };
}

test("TablesPanel : une seule ligne latérale « Tables »", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new TablesPanel(app, plugin, container);
    await panel.render();

    const names = container.querySelectorAll(".feuillets-properties-key").map((n) => n.textContent);
    assert.deepEqual(names, ["Tables"]);
    assert.equal(container.querySelectorAll(".setting-item").length, 0);
  } finally {
    restore();
  }
});

test("TablesPanel : case Inclure simple, sans description permanente", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new TablesPanel(app, plugin, container);
    await panel.render();

    assert.ok(container.querySelector('[aria-label="Inclure les tables"]'));

    assert.equal(container.querySelectorAll(".setting-item-description").length, 0);
  } finally {
    restore();
  }
});

test("TablesPanel : exclu par défaut (defaultComposition), case décochée", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new TablesPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.querySelector('[aria-label="Inclure les tables"]').checked, false);
  } finally {
    restore();
  }
});

test("TablesPanel : cocher Inclure écrit l'inclusion dans ProjectMeta sous l'identifiant tables", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture();
    const container = new FakeElement("div");
    const panel = new TablesPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les tables"]');
    include.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(readGeneratedIncluded(plugin.settings.projectMeta[manuscript.path], "tables"), true);
  } finally {
    restore();
  }
});

test("TablesPanel : décocher rétablit l'exclusion", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture();
    const container = new FakeElement("div");
    const panel = new TablesPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les tables"]');
    include.click();
    await Promise.resolve();
    await Promise.resolve();
    include.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(readGeneratedIncluded(plugin.settings.projectMeta[manuscript.path], "tables"), false);
  } finally {
    restore();
  }
});

test("TablesPanel : relit l'état persisté au rendu suivant", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new TablesPanel(app, plugin, container);
    await panel.render();

    container.querySelector('[aria-label="Inclure les tables"]').click();
    await Promise.resolve();
    await Promise.resolve();

    const second = new TablesPanel(app, plugin, container);
    await second.render();
    assert.equal(container.querySelector('[aria-label="Inclure les tables"]').checked, true);
  } finally {
    restore();
  }
});

test("TablesPanel : fonctionne parfaitement SANS callback onPresentationChanged", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new TablesPanel(app, plugin, container); // pas de callbacks
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les tables"]');
    await assert.doesNotReject(async () => {
      include.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    restore();
  }
});

test("TablesPanel : callback onPresentationChanged, fourni, est appelé après une bascule", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    let calls = 0;
    const panel = new TablesPanel(app, plugin, container, { onPresentationChanged: () => { calls++; } });
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les tables"]');
    include.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("TablesPanel : sans projet actif, ne lève pas et le toggle reste utilisable", async () => {
  const restore = installDom();
  try {
    const app = { vault: createFakeVault([]).vault };
    const plugin = { settings: { projectMeta: {} }, getProjectFolder: () => null, saveSettings: async () => {} };
    const container = new FakeElement("div");
    const panel = new TablesPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les tables"]');
    assert.ok(include);
    await assert.doesNotReject(async () => {
      include.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    restore();
  }
});
