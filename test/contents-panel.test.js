import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { ContentsPanel } from "../src/ui/contents-panel.js";
import { readGeneratedIncluded } from "../src/services/book-composition.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Même petit DOM factice que test/front-matter-panel.test.js (convention du
 * dépôt : dupliqué, pas partagé). Compatible avec la vraie classe Setting du
 * stub (test/obsidian-runtime-stub.mjs). */
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

test("ContentsPanel : deux lignes latérales, Sommaire puis Table des matières", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ContentsPanel(app, plugin, container);
    await panel.render();

    const names = container.querySelectorAll(".feuillets-properties-key").map((n) => n.textContent);
    assert.deepEqual(names, ["Sommaire", "Table des matières"]);
    assert.equal(container.querySelectorAll(".setting-item").length, 0);
  } finally {
    restore();
  }
});

test("ContentsPanel : cases Inclure simples, aucune édition manuelle du contenu", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ContentsPanel(app, plugin, container);
    await panel.render();

    assert.ok(container.querySelector('[aria-label="Inclure le sommaire"]'));
    assert.ok(container.querySelector('[aria-label="Inclure la table des matières"]'));
    assert.equal(container.querySelectorAll("input").length, 2);
    assert.equal(container.querySelectorAll(".checkbox-container").length, 0);
    assert.equal(container.querySelectorAll("textarea").length, 0);
    assert.equal(container.querySelectorAll("button").length, 0);
  } finally {
    restore();
  }
});

test("ContentsPanel : n'affiche pas de description générée permanente", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ContentsPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.querySelectorAll(".setting-item-description").length, 0);
  } finally {
    restore();
  }
});

test("ContentsPanel : exclus par défaut (defaultComposition), cases décochées", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ContentsPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.querySelector('[aria-label="Inclure le sommaire"]').checked, false);
    assert.equal(container.querySelector('[aria-label="Inclure la table des matières"]').checked, false);
  } finally {
    restore();
  }
});

test("ContentsPanel : cocher Inclure écrit l'inclusion dans ProjectMeta (readGeneratedIncluded)", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ContentsPanel(app, plugin, container);
    await panel.render();

    const summaryInclude = container.querySelector('[aria-label="Inclure le sommaire"]');
    summaryInclude.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(readGeneratedIncluded(plugin.settings.projectMeta[manuscript.path], "summary"), true);
    assert.equal(readGeneratedIncluded(plugin.settings.projectMeta[manuscript.path], "toc"), undefined, "toc n'est pas affecté");
  } finally {
    restore();
  }
});

test("ContentsPanel : décocher après avoir coché rétablit l'exclusion", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ContentsPanel(app, plugin, container);
    await panel.render();

    const tocInclude = container.querySelector('[aria-label="Inclure la table des matières"]');
    tocInclude.click();
    await Promise.resolve();
    await Promise.resolve();
    tocInclude.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(readGeneratedIncluded(plugin.settings.projectMeta[manuscript.path], "toc"), false);
  } finally {
    restore();
  }
});

test("ContentsPanel : relit l'état persisté au rendu suivant (round-trip complet)", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ContentsPanel(app, plugin, container);
    await panel.render();

    container.querySelector('[aria-label="Inclure le sommaire"]').click();
    await Promise.resolve();
    await Promise.resolve();

    // Nouvelle instance, même plugin (mêmes réglages persistés) — simule un
    // rendu ultérieur (réouverture de l'onglet, par exemple).
    const second = new ContentsPanel(app, plugin, container);
    await second.render();
    assert.equal(container.querySelector('[aria-label="Inclure le sommaire"]').checked, true);
  } finally {
    restore();
  }
});

test("ContentsPanel : fonctionne parfaitement SANS callback onPresentationChanged", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new ContentsPanel(app, plugin, container); // pas de callbacks
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure le sommaire"]');
    await assert.doesNotReject(async () => {
      include.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    restore();
  }
});

test("ContentsPanel : callback onPresentationChanged, fourni, est appelé après une bascule", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    let calls = 0;
    const panel = new ContentsPanel(app, plugin, container, { onPresentationChanged: () => { calls++; } });
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure le sommaire"]');
    include.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("ContentsPanel : sans projet actif, ne lève pas et les toggles restent utilisables", async () => {
  const restore = installDom();
  try {
    const app = { vault: createFakeVault([]).vault };
    const plugin = { settings: { projectMeta: {} }, getProjectFolder: () => null, saveSettings: async () => {} };
    const container = new FakeElement("div");
    const panel = new ContentsPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure le sommaire"]');
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
