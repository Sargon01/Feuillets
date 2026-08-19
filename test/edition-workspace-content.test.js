import { test } from "node:test";
import assert from "node:assert/strict";
import { Setting, TFolder } from "obsidian";
import { VIEW_PREVIEW } from "../src/constants.js";
import { EditionWorkspaceContent } from "../src/ui/edition-workspace-content.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { t } from "../src/i18n/index.js";

/* Contenu Édition monté dans le panneau droit. Il ne crée aucune leaf et ne
 * pilote jamais l'ouverture d'une Preview ; il peut seulement rafraîchir une
 * Preview déjà liée lorsqu'elle existe encore. */

/* E-F. changement de propriété / de gabarit → LayoutEditor + Preview liée.
 * Une vue factice exposant refreshForLayoutChange() suffit — même patron
 * structurel que refreshLinkedPreview(). */
function fakeRefreshablePreviewLeaf() {
  const calls = { refresh: 0 };
  const leaf = {
    isDeferred: false,
    loadIfDeferred: async () => {},
    view: { async refreshForLayoutChange() { calls.refresh++; } },
  };
  return { leaf, calls };
}

test("EditionWorkspaceContent : la Preview liée n'est jamais recréée si elle a disparu", async () => {
  const { leaf, calls } = fakeRefreshablePreviewLeaf();
  const workspace = { getLeavesOfType: () => [] }; // la Preview n'est plus dans le workspace
  const content = Object.create(EditionWorkspaceContent.prototype);
  content.app = { workspace };
  content.setLinkedPreview(leaf);

  await content.refreshLinkedPreview();

  assert.equal(calls.refresh, 0, "aucun appel : la Preview a disparu, elle n'est pas recréée silencieusement");
});

test("EditionWorkspaceContent : la Preview liée, toujours ouverte, est rafraîchie une fois", async () => {
  const { leaf, calls } = fakeRefreshablePreviewLeaf();
  const workspace = { getLeavesOfType: (type) => (type === VIEW_PREVIEW ? [leaf] : []) };
  const content = Object.create(EditionWorkspaceContent.prototype);
  content.app = { workspace };
  content.setLinkedPreview(leaf);

  await content.refreshLinkedPreview();

  assert.equal(calls.refresh, 1);
});

/* ==================== Intégration : DOM factice ===========================
 * Même petit DOM factice que test/layout-modal.test.js / test/edition-
 * composition-view.test.js (convention du dépôt : dupliqué, pas partagé). */

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.style = {};
    this.settings = [];
    this._attributes = new Map();
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    this.type = options.type;
    this.checked = false;
    this.parentNode = null;
    if (options.cls) this.addClass(options.cls);
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) this.setAttribute(k, v);
  }
  dispatch(type, event) {
    const list = this.events.get(type);
    if (list) list(event || { target: this });
  }

  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.appendChild(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  prepend(child) { child.remove(); child.parentNode = this; this.children = [child, ...this.children.filter((c) => c !== child)]; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  hasClass(name) { return this.classes.has(name); }
  toggleClass(name, active) {
    if (active === undefined) { if (this.classes.has(name)) this.classes.delete(name); else this.classes.add(name); }
    else if (active) this.classes.add(name);
    else this.classes.delete(name);
  }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  setAttr(name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  empty() { for (const child of [...this.children]) child.remove(); this.settings = []; }
  setText(text) { this.text = String(text); return this; }
  get textContent() { return this.children.length ? (this.text ? this.text : this.children.map((c) => c.textContent).join("")) : this.text; }
  set textContent(value) { this.empty(); this.text = String(value); }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => { for (const child of node.children) { if (matchesSelector(child, selector)) found.push(child); visit(child); } };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matchesSelector(node, selector) {
  const attr = selector.match(/^\[([^=\]]+)="?([^"\]]*)"?\]$/);
  if (attr) return node.getAttribute(attr[1]) === attr[2];
  if (selector.startsWith(".")) return node.classes.has(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

function installSettingStub() {
  const methods = ["setName", "addButton", "addDropdown", "addExtraButton", "addToggle", "addText", "then"];
  const previous = Object.fromEntries(methods.map((name) => [name, Setting.prototype[name]]));
  const add = (kind, parent, configure, name) => {
    const control = {
      kind,
      name,
      options: [],
      inputEl: { type: "text", value: "" },
      extraSettingsEl: new FakeElement(),
      addOption(value, label) { this.options.push({ value, label }); return this; },
      setValue(value) { this.value = value; this.inputEl.value = value; return this; },
      setPlaceholder(value) { this.placeholder = value; return this; },
      onClick(callback) { this.click = callback; return this; },
      onChange(callback) { this.change = callback; return this; },
    };
    parent.settings.push(control);
    configure(control);
    return control;
  };
  Setting.prototype.setName = function setName(name) { this.name = name; return this; };
  Setting.prototype.addButton = function addButton(configure) { add("button", this.container, configure, this.name); return this; };
  Setting.prototype.addDropdown = function addDropdown(configure) { add("dropdown", this.container, configure, this.name); return this; };
  Setting.prototype.addExtraButton = function addExtraButton(configure) { add("extra", this.container, configure, this.name); return this; };
  Setting.prototype.addToggle = function addToggle(configure) { add("toggle", this.container, configure, this.name); return this; };
  Setting.prototype.addText = function addText(configure) { add("text", this.container, configure, this.name); return this; };
  Setting.prototype.then = function then(callback) { callback(this); return this; };
  return () => Object.assign(Setting.prototype, previous);
}

/** Plugin d'intégration : couvre la Mise en page (gabarit V2) ET la
 * Composition (settings minimaux attendus par FirstPagePanel & consorts,
 * mêmes clés que test/edition-composition-content.test.js:buildPlugin). */
function buildIntegrationFixture() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = volume;
  volume.children.push(manuscript);
  const { vault, fileManager } = createFakeVault([volume, manuscript]);
  vault.cachedRead = vault.read;
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  Object.assign(settings, {
    projectFolder: manuscript.path,
    exportTemplate: "classique",
    collapsed: {},
    orders: {},
    folderPositions: {},
    projectMeta: {},
  });
  const calls = { save: 0, frontmatter: [], leafCreates: 0 };
  const frontmatter = new Map();
  fileManager.processFrontMatter = async (file, update) => {
    const data = { ...(frontmatter.get(file.path) || {}) };
    update(data);
    frontmatter.set(file.path, data);
    calls.frontmatter.push({ file, frontmatter: data });
  };
  const { leaf: previewLeaf, calls: previewCalls } = fakeRefreshablePreviewLeaf();
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) },
    workspace: { getLeavesOfType: () => [previewLeaf], getLeaf: () => { calls.leafCreates += 1; return null; } },
  };
  const plugin = {
    settings,
    saveSettings: async () => { calls.save += 1; },
    getProjectFolder: () => manuscript,
    // Réglages déplacés depuis les Paramètres (§20) : Composition les rend
    // désormais et lit ces mêmes accesseurs que l'ancien onglet.
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    refreshView: () => {},
  };
  const contentEl = new FakeElement("div");
  const hostLeaf = { app, contentEl };
  const view = new EditionWorkspaceContent(app, plugin, contentEl, { linkedPreviewLeaf: previewLeaf });
  return { view, contentEl, plugin, app, hostLeaf, calls, previewCalls };
}

/* ==================== Composant sidebar-only ============================== */

test("EditionWorkspaceContent : rendu initial = Composition sans chrome central ni barre Export dupliquée", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl } = buildIntegrationFixture();
    await view.render();

    assert.equal(view.mode, "composition");
    assert.equal(contentEl.querySelectorAll(".feuillets-edition-mode-nav").length, 0);
    assert.equal(contentEl.querySelectorAll(".feuillets-edition-quickexport-host").length, 0);
    assert.equal(contentEl.querySelectorAll(".feuillets-edition-preview-refresh").length, 0);
    assert.equal(contentEl.querySelectorAll(".feuillets-edition-mode-surface").length, 1);
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : Mise en page utilise toujours la navigation summary de la sidebar", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view.modeRenderPromise;

    assert.equal(view.mode, "layout");
    assert.ok(view.editor, "LayoutEditor monté");
    assert.equal(view.editor.workspaceNavigation, "summary");
    assert.equal(contentEl.querySelectorAll(".feuillets-layout-summary-host").length, 1);
    assert.equal(contentEl.querySelectorAll(".feuillets-layout-nav").length, 0);
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : Composition → Mise en page → Composition ne crée aucune leaf", async () => {
  const restore = installSettingStub();
  try {
    const { view, calls } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view.modeRenderPromise;
    view.setMode("composition");
    await view.modeRenderPromise;

    assert.equal(view.mode, "composition");
    assert.equal(calls.leafCreates, 0);
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : une Preview liée existante est seulement rafraîchie, jamais recréée", async () => {
  const restore = installSettingStub();
  try {
    const { view, previewCalls, calls } = buildIntegrationFixture();
    await view.render();
    await view.refreshLinkedPreview();

    assert.equal(previewCalls.refresh, 1);
    assert.equal(calls.leafCreates, 0);
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : sans Preview liée, refreshLinkedPreview reste un no-op", async () => {
  const restore = installSettingStub();
  try {
    const { view, calls } = buildIntegrationFixture();
    view.setLinkedPreview(null);
    await view.render();
    await view.refreshLinkedPreview();
    assert.equal(calls.leafCreates, 0);
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : onNavigationRootChange est transmis au LayoutEditor summary", async () => {
  const restore = installSettingStub();
  try {
    const fixture = buildIntegrationFixture();
    const states = [];
    const view = new EditionWorkspaceContent(fixture.app, fixture.plugin, fixture.contentEl, {
      initialMode: "layout",
      onNavigationRootChange: (isRoot) => states.push(isRoot),
    });
    await view.render();
    assert.equal(states.at(-1), true);
  } finally {
    restore();
  }
});

/* DERNIER CORRECTIF : EditionWorkspaceContent transmet onNavigationRootChange
 * aux enfants UNIQUEMENT en chrome embedded (panneau droit) — jamais en mode
 * central historique (chrome "workspace"), où la navigation reste "rail". */

test("racine : embedded + composition notifie true au sommaire, false à Le manuscrit, true au retour", async () => {
  const restore = installSettingStub();
  try {
    const { app, plugin } = buildIntegrationFixture();
    const seen = [];
    const contentEl = new FakeElement("div");
    const view = new EditionWorkspaceContent(app, plugin, contentEl, {
      initialMode: "composition",
      onNavigationRootChange: (isRoot) => seen.push(isRoot),
    });
    await view.render();
    assert.deepEqual(seen, [true], "le sommaire Composition est la racine");

    const manuscriptRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Le manuscrit"));
    manuscriptRow.dispatch("click");
    await view["compositionContent"]["renderPromise"];
    assert.deepEqual(seen, [true, false], "Le manuscrit → hors racine");

    const back = contentEl.querySelector(".feuillets-composition-back");
    back.dispatch("click");
    await view["compositionContent"]["renderPromise"];
    assert.deepEqual(seen, [true, false, true], "retour au sommaire → racine");
  } finally {
    restore();
  }
});

test("racine : embedded + layout notifie true au sommaire et false à l'ouverture de Page", async () => {
  const restore = installSettingStub();
  try {
    const { app, plugin } = buildIntegrationFixture();
    const seen = [];
    const contentEl = new FakeElement("div");
    const view = new EditionWorkspaceContent(app, plugin, contentEl, {
      initialMode: "layout",
      onNavigationRootChange: (isRoot) => seen.push(isRoot),
    });
    await view.render();
    assert.deepEqual(seen, [true], "le sommaire Mise en page est la racine");

    const pageRow = [...contentEl.querySelectorAll(".feuillets-layout-summary-row")].find((row) =>
      [...row.children].some((c) => c.classes?.has?.("feuillets-layout-summary-label") && c.text === t("modal.layout.categoryPage"))
    );
    pageRow.dispatch("click");
    assert.deepEqual(seen, [true, false], "Page → hors racine");
  } finally {
    restore();
  }
});
