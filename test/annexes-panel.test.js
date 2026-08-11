import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { AnnexesPanel } from "../src/ui/annexes-panel.js";
import { readGeneratedIncluded } from "../src/services/book-composition.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Même petit DOM factice que test/bibliography-panel.test.js (convention du
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

/** Manuscrit, avec ou sans dossier Annexes contenant `fileCount` fiches. */
function buildFixture({ folderName = null, fileCount = 0 } = {}) {
  const manuscript = new TFolder("Projet/Manuscrit");
  const entries = [manuscript];
  let annexesRef = null;
  if (folderName) {
    annexesRef = new TFolder(`Projet/Manuscrit/${folderName}`);
    annexesRef.parent = manuscript;
    const files = [];
    for (let i = 0; i < fileCount; i++) {
      const file = new TFile(`Projet/Manuscrit/${folderName}/Annexe ${i}.md`, `---\ntitle: Annexe ${i}\n---\nTexte.`);
      file.parent = annexesRef;
      files.push(file);
      entries.push(file);
    }
    annexesRef.children = files;
    manuscript.children = [annexesRef];
    entries.push(annexesRef);
  }

  const { vault, files } = createFakeVault(entries);
  vault.files = files;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    internalPlugins: { getPluginById: () => undefined }, // pas d'explorateur natif dans les tests
  };
  const settings = { projectFolder: manuscript.path, projectMeta: {}, orders: {}, folderPositions: {} };
  const plugin = {
    settings,
    getProjectFolder: () => app.vault.getAbstractFileByPath(manuscript.path),
    saveSettings: async () => {},
  };
  return { app, plugin, manuscript };
}

test("AnnexesPanel : une seule ligne latérale « Annexes »", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container);
    await panel.render();

    const names = container.querySelectorAll(".feuillets-properties-key").map((n) => n.textContent);
    assert.deepEqual(names, ["Annexes"]);
    assert.equal(container.querySelectorAll(".setting-item").length, 0);
  } finally {
    restore();
  }
});

test("AnnexesPanel : dossier Annexes présent — décompte en description, bouton Ouvrir le dossier", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture({ folderName: "Annexes", fileCount: 3 });
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.querySelector(".feuillets-edition-count").textContent, "3 annexe(s)");
    assert.ok(container.querySelector('[aria-label="Ouvrir le dossier"]'), "le bouton « Ouvrir le dossier » doit exister");
    assert.equal(container.querySelector('[aria-label="Créer le dossier Annexes"]'), null);
  } finally {
    restore();
  }
});

test("AnnexesPanel : dossier Appendices reconnu comme Annexes", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture({ folderName: "Appendices", fileCount: 2 });
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.querySelector(".feuillets-edition-count").textContent, "2 annexe(s)");
  } finally {
    restore();
  }
});

test("AnnexesPanel : aucun dossier — état vide, bouton Créer le dossier Annexes", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.querySelector(".feuillets-edition-count").textContent, "Aucune annexe");
    assert.ok(container.querySelector('[aria-label="Créer le dossier Annexes"]'), "le bouton « Créer le dossier Annexes » doit exister");
    assert.equal(container.querySelector('[aria-label="Ouvrir le dossier"]'), null);
  } finally {
    restore();
  }
});

test("AnnexesPanel : le bouton Créer crée UNIQUEMENT <Manuscrit>/Annexes, sans fichier", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture();
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container);
    await panel.render();

    const createBtn = container.querySelector('[aria-label="Créer le dossier Annexes"]');
    createBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const created = app.vault.getAbstractFileByPath(`${manuscript.path}/Annexes`);
    assert.ok(created instanceof TFolder, "le dossier Annexes existe");
    assert.equal(created.children?.length || 0, 0, "aucun fichier créé dedans");
  } finally {
    restore();
  }
});

test("AnnexesPanel : exclues par défaut (defaultComposition), case décochée", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture({ folderName: "Annexes", fileCount: 1 });
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container);
    await panel.render();

    assert.equal(container.querySelector('[aria-label="Inclure les annexes"]').checked, false);
  } finally {
    restore();
  }
});

test("AnnexesPanel : cocher Inclure écrit l'inclusion dans ProjectMeta sous l'identifiant annexes", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture({ folderName: "Annexes", fileCount: 1 });
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les annexes"]');
    include.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(readGeneratedIncluded(plugin.settings.projectMeta[manuscript.path], "annexes"), true);
  } finally {
    restore();
  }
});

test("AnnexesPanel : décocher rétablit l'exclusion", async () => {
  const restore = installDom();
  try {
    const { app, plugin, manuscript } = buildFixture({ folderName: "Annexes", fileCount: 1 });
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les annexes"]');
    include.click();
    await Promise.resolve();
    await Promise.resolve();
    include.click();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(readGeneratedIncluded(plugin.settings.projectMeta[manuscript.path], "annexes"), false);
  } finally {
    restore();
  }
});

test("AnnexesPanel : fonctionne parfaitement SANS callback onPresentationChanged", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture({ folderName: "Annexes", fileCount: 1 });
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container); // pas de callbacks
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les annexes"]');
    await assert.doesNotReject(async () => {
      include.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    restore();
  }
});

test("AnnexesPanel : callback onPresentationChanged, fourni, est appelé après une bascule", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture({ folderName: "Annexes", fileCount: 1 });
    const container = new FakeElement("div");
    let calls = 0;
    const panel = new AnnexesPanel(app, plugin, container, { onPresentationChanged: () => { calls++; } });
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les annexes"]');
    include.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("AnnexesPanel : callback appelé après création du dossier", async () => {
  const restore = installDom();
  try {
    const { app, plugin } = buildFixture();
    const container = new FakeElement("div");
    let calls = 0;
    const panel = new AnnexesPanel(app, plugin, container, { onPresentationChanged: () => { calls++; } });
    await panel.render();

    const createBtn = container.querySelector('[aria-label="Créer le dossier Annexes"]');
    createBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("AnnexesPanel : sans projet actif, ne lève pas et le toggle reste utilisable", async () => {
  const restore = installDom();
  try {
    const app = { vault: createFakeVault([]).vault, internalPlugins: { getPluginById: () => undefined } };
    const plugin = { settings: { projectMeta: {}, orders: {}, folderPositions: {} }, getProjectFolder: () => null, saveSettings: async () => {} };
    const container = new FakeElement("div");
    const panel = new AnnexesPanel(app, plugin, container);
    await panel.render();

    const include = container.querySelector('[aria-label="Inclure les annexes"]');
    assert.ok(include);
    assert.equal(container.querySelector(".feuillets-edition-count").textContent, "Aucune annexe");
    await assert.doesNotReject(async () => {
      include.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  } finally {
    restore();
  }
});
