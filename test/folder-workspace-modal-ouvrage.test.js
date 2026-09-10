import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { FolderWorkspaceModal } from "../src/ui/folder-workspace-modal.js";
import { isOuvrageRoot } from "../src/services/editorial-roots.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* RECTIFICATION — ALIGNER OUVRAGE SUR LA MODALE EXISTANTE : l'option ouvrage
 * applique chaque changement immédiatement, comme tout le reste de cette
 * modale (aucun état local, aucune validation séparée). Même petit DOM
 * factice que test/contents-panel.test.js (convention du dépôt : dupliqué,
 * pas partagé). Compatible avec la vraie classe Setting du stub
 * (test/obsidian-runtime-stub.mjs) : addToggle y pose un vrai
 * `.click()`/dispatch, exactement comme un clic DOM réel. */
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
  addClass(name) { this.classes.add(name); }
  setText(value) { this.textContent = value; }
  empty() { for (const child of [...this.children]) child.remove(); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  setAttr(name, value) { this.setAttribute(name, value); }
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

/** Retrouve le `.setting-item` (le vrai conteneur créé par Setting du stub)
 * dont le libellé (`.setting-item-name`) correspond exactement. */
function findSettingByName(root, name) {
  for (const nameEl of root.querySelectorAll(".setting-item-name")) {
    if (nameEl.textContent === name) return nameEl.parentNode.parentNode;
  }
  return null;
}

function buildFixture(folderWorkspaces) {
  const root = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  nefes.parent = root;
  root.children = [nefes];
  const { vault } = createFakeVault([root, nefes]);
  const app = { vault };
  const settings = {
    projectFolder: "WARPI",
    projectMeta: folderWorkspaces ? { "WARPI": { folderWorkspaces } } : {},
  };
  let saveCount = 0;
  let renderCount = 0;
  const plugin = {
    settings,
    getProjectFolder: () => root,
    saveSettings: async () => { saveCount++; },
    renderAllViews: () => { renderCount++; },
  };
  return {
    app,
    root,
    nefes,
    settings,
    plugin,
    saveCount: () => saveCount,
    renderCount: () => renderCount,
  };
}

function openModal(app, plugin, folder) {
  const modal = new FolderWorkspaceModal(app, plugin, folder);
  modal.app = app;
  modal.contentEl = new FakeElement("div");
  modal.onOpen();
  return modal;
}

/* rerenderContent() (folder-workspace-modal.ts) restaure le scroll via
 * window.requestAnimationFrame après chaque clic — un no-op suffit ici,
 * seul l'état settings/DOM nous intéresse. Installé/retiré par test, comme
 * installDom() dans preview-view.test.js. */
function installWindowStub() {
  const previous = globalThis.window;
  globalThis.window = { requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
  return () => { globalThis.window = previous; };
}

const OUVRAGE_LABEL = "Définir ce dossier comme ouvrage";

function ouvrageSetting(modal) {
  const setting = findSettingByName(modal.contentEl, OUVRAGE_LABEL);
  assert.ok(setting, "l'option ouvrage doit être présente pour NEFES");
  return setting;
}

function toggleOf(settingEl) {
  const toggle = settingEl.querySelector(".checkbox-container");
  assert.ok(toggle, "le toggle ouvrage doit être rendu");
  return toggle;
}

test("activer le toggle Ouvrage enregistre l'ouvrage immédiatement, en une seule sauvegarde", async () => {
  const restore = installWindowStub();
  try {
    const { app, root, nefes, settings, plugin, saveCount, renderCount } = buildFixture();
    const modal = openModal(app, plugin, nefes);

    assert.equal(isOuvrageRoot(app, settings, root, nefes), false);

    toggleOf(ouvrageSetting(modal)).click();
    // Le toggle déclenche saveSettings() de façon asynchrone : laisser la microtâche se vider.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(isOuvrageRoot(app, settings, root, nefes), true, "le clic doit enregistrer l'ouvrage immédiatement, sans validation séparée");
    assert.equal(saveCount(), 1, "une seule sauvegarde par changement");
    assert.equal(renderCount(), 1, "un seul rafraîchissement des vues par changement");

    // Aucun bouton Appliquer/Annuler : la modale reste alignée sur son
    // fonctionnement existant (chaque champ s'applique seul).
    const settingAfterClick = ouvrageSetting(modal);
    assert.equal(settingAfterClick.querySelectorAll("button").length, 0);
    assert.equal(settingAfterClick.querySelectorAll(".extra-setting-button").length, 0);
  } finally {
    restore();
  }
});

test("désactiver le toggle Ouvrage retire le statut immédiatement et préserve les autres réglages de l'espace", async () => {
  const restore = installWindowStub();
  try {
    const { app, root, nefes, settings, plugin, saveCount } = buildFixture({
      "NEFES": { version: 1, ouvrage: { version: 1 }, preset: "fiction", wordGoal: 50000 },
    });
    const modal = openModal(app, plugin, nefes);

    assert.equal(isOuvrageRoot(app, settings, root, nefes), true);

    toggleOf(ouvrageSetting(modal)).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(isOuvrageRoot(app, settings, root, nefes), false, "le clic doit retirer le statut d'ouvrage immédiatement");
    assert.deepEqual(settings.projectMeta["WARPI"].folderWorkspaces, {
      "NEFES": { version: 1, preset: "fiction", wordGoal: 50000 },
    }, "les autres réglages de l'espace de travail doivent être préservés");
    assert.equal(saveCount(), 1, "une seule sauvegarde par changement");
  } finally {
    restore();
  }
});

test("l'option ouvrage est absente pour la racine globale, Front et ses descendants, et les dossiers préfixés par _", () => {
  const restore = installWindowStub();
  try {
    const root = new TFolder("WARPI");
    const front = new TFolder("WARPI/Front");
    front.parent = root;
    const hidden = new TFolder("WARPI/_Feuillets");
    hidden.parent = root;
    root.children = [front, hidden];
    const { vault } = createFakeVault([root, front, hidden]);
    const app = { vault };
    const settings = { projectFolder: "WARPI", projectMeta: {} };
    const plugin = {
      settings,
      getProjectFolder: () => root,
      saveSettings: async () => {},
      renderAllViews: () => {},
    };

    assert.equal(findSettingByName(openModal(app, plugin, root).contentEl, OUVRAGE_LABEL), null, "racine globale");
    assert.equal(findSettingByName(openModal(app, plugin, front).contentEl, OUVRAGE_LABEL), null, "Front");
    assert.equal(findSettingByName(openModal(app, plugin, hidden).contentEl, OUVRAGE_LABEL), null, "dossier préfixé par _");
  } finally {
    restore();
  }
});
