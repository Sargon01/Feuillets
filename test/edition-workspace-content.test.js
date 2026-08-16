import { test } from "node:test";
import assert from "node:assert/strict";
import { Setting, TFolder, TFile } from "obsidian";
import { VIEW_PREVIEW } from "../src/constants.js";
import { EditionWorkspaceContent } from "../src/ui/edition-workspace-content.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { t } from "../src/i18n/index.js";

/* Cœur de l'espace Édition, désormais monté DANS la leaf de son hôte
 * (BoardView) — plus aucune ItemView autonome, plus aucun VIEW_EDITION_
 * WORKSPACE (§7 du chantier « espace central »). L'ouverture/réutilisation de
 * la Preview classique associée est testée côté hôte
 * (test/board-central-surface.test.js) : ce fichier ne teste que le contenu. */

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
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this.text; }
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

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function controls(element, kind) {
  return allElements(element).flatMap((item) => item.settings).filter((control) => control.kind === kind);
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
  const view = new EditionWorkspaceContent(app, plugin, hostLeaf, contentEl, { linkedPreviewLeaf: previewLeaf });
  return { view, contentEl, plugin, app, hostLeaf, calls, previewCalls };
}

/* ==================== §19-21 : trois modes, navigation ==================== */

/* §1 du dernier lot UX avant 2.5 : l'onglet Export a disparu — plus que
 * deux modes (Composition/Mise en page), et une barre d'export compacte
 * (portée/format/Exporter) toujours visible dans la barre principale,
 * quel que soit l'onglet actif. */
test("EditionWorkspaceContent : la navigation contient exactement 2 modes, Composition/Mise en page, mode initial composition", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl } = buildIntegrationFixture();
    await view.render();

    assert.equal(view.mode, "composition");
    const items = contentEl.querySelectorAll(".feuillets-edition-mode-item");
    assert.deepEqual(items.map((el) => el.textContent), ["Composition", "Mise en page"]);
    assert.equal(items[0].hasClass("is-active"), true);
    assert.equal(items[1].hasClass("is-active"), false);
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : \"export\" reste une valeur valide (compat commandes) mais se ramène à Composition, où la barre d'export est visible", async () => {
  const restore = installSettingStub();
  try {
    const { app, plugin, hostLeaf } = buildIntegrationFixture();
    const contentEl = new FakeElement("div");
    const view = new EditionWorkspaceContent(app, plugin, hostLeaf, contentEl, { initialMode: "export" });
    await view.render();

    assert.equal(view.mode, "composition", "\"export\" est normalisé vers \"composition\" (voir normalizeMode)");
    const items = contentEl.querySelectorAll(".feuillets-edition-mode-item");
    assert.deepEqual(items.map((el) => el.textContent), ["Composition", "Mise en page"], "toujours seulement 2 onglets");
    assert.ok(contentEl.querySelector(".feuillets-edition-quickexport"), "la barre d'export est bien visible");

    view.setMode("export");
    assert.equal(view.mode, "composition", "setMode(\"export\") normalise aussi");
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : barre d'export compacte (portée/format/Exporter) toujours visible dans la barre principale", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl } = buildIntegrationFixture();
    await view.render();

    const quickBar = contentEl.querySelector(".feuillets-edition-quickexport");
    assert.ok(quickBar, "la barre d'export compacte est montée dans la barre principale");
    const selects = quickBar.querySelectorAll("select");
    assert.equal(selects.length, 2, "portée + format, aucun autre contrôle");
    assert.equal(quickBar.querySelector(".feuillets-edition-quickexport-scope").tagName, "SELECT");
    assert.equal(quickBar.querySelector(".feuillets-edition-quickexport-format").tagName, "SELECT");
    assert.ok(quickBar.querySelector(".feuillets-edition-quickexport-cta"), "bouton Exporter présent");
    // Aucun champ "Nom du fichier" dans Édition (§1).
    assert.equal(contentEl.querySelector('[aria-label="Nom du fichier exporté"]'), null);

    // Toujours visible après un changement d'onglet vers Mise en page.
    view.setMode("layout");
    assert.ok(contentEl.querySelector(".feuillets-edition-quickexport"), "reste visible en Mise en page");
  } finally {
    restore();
  }
});

/** Variante de buildIntegrationFixture() avec un VRAI contenu compilable
 * (un chapitre, un feuillet) et un fichier actif — nécessaire pour que
 * "Dossier"/"Fichier" apparaissent dans le sélecteur de portée
 * (activeProjectFile()) et pour qu'un export produise réellement un fichier. */
function buildIntegrationFixtureWithContent() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = volume;
  volume.children.push(manuscript);
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  chapter.parent = manuscript;
  manuscript.children.push(chapter);
  const scene = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "---\ntitle: Départ\n---\nTexte.");
  scene.parent = chapter;
  chapter.children.push(scene);

  const { vault, fileManager } = createFakeVault([volume, manuscript, chapter, scene]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([[scene.path, { title: "Départ", compile: true }]]);
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  Object.assign(settings, {
    projectFolder: manuscript.path,
    exportTemplate: "classique",
    collapsed: {},
    orders: { [manuscript.path]: [chapter.name] },
    folderPositions: {},
    projectMeta: {},
    level1Role: "chapitres",
    compileFileName: "Manuscrit.md",
    exportFrenchTypography: false,
    insertFolderTitles: false,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
  });
  const { leaf: previewLeaf } = fakeRefreshablePreviewLeaf();
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) },
    workspace: {
      getLeavesOfType: () => [previewLeaf],
      getLeaf: () => null,
      getActiveFile: () => scene,
    },
  };
  const plugin = {
    settings,
    activeExportScope: null,
    saveSettings: async () => {},
    getProjectFolder: () => manuscript,
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    refreshView: () => {},
    refreshBinderViews: () => {},
    fmOf: (file) => frontmatter.get(file.path) || {},
    shortTitleFor: (file) => file.basename,
  };
  const contentEl = new FakeElement("div");
  const hostLeaf = { app, contentEl };
  const view = new EditionWorkspaceContent(app, plugin, hostLeaf, contentEl, { linkedPreviewLeaf: previewLeaf });
  return { view, contentEl, plugin, app };
}

/* Même petit DOM factice que test/export-workflow.test.js (installChildNodesDom,
 * convention du dépôt : dupliqué, pas partagé) — nécessaire pour laisser
 * l'export EPUB tourner réellement (le moteur lit childNodes/nodeType via un
 * XMLSerializer), sans mocker runExportWorkflow lui-même. */
function installChildNodesDom() {
  const previous = {
    document: globalThis.document, Node: globalThis.Node, XMLSerializer: globalThis.XMLSerializer,
    createEl: globalThis.createEl, createDiv: globalThis.createDiv,
  };
  class DomNode {
    constructor(tagName, text = "") {
      this.tagName = tagName.toUpperCase();
      this._text = text;
      this.parentElement = null;
      this.children = [];
      this._attributes = new Map();
    }
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
    get childNodes() {
      if (this.children.length) return this.children;
      if (this._text) return [{ nodeType: 3, nodeValue: this._text, textContent: this._text }];
      return [];
    }
    get nodeType() { return 1; }
    get attributes() { return Array.from(this._attributes, ([name, value]) => ({ name, value })); }
    get className() { return this.getAttribute("class") || ""; }
    get classList() { const self = this; return { contains: (name) => (self.getAttribute("class") || "").split(/\s+/).includes(name) }; }
    get innerHTML() { return this.children.length ? this.children.map((c) => c.outerHTML).join("") : this._text; }
    get outerHTML() {
      const attrs = this.attributes.map(({ name, value }) => ` ${name}="${value}"`).join("");
      return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
    }
    setAttribute(name, value) { this._attributes.set(name, String(value)); }
    getAttribute(name) { return this._attributes.get(name) ?? null; }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
    remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; }
    cloneNode(deep) {
      const clone = new DomNode(this.tagName, this._text);
      for (const { name, value } of this.attributes) clone.setAttribute(name, value);
      if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
      return clone;
    }
    querySelectorAll() { return []; }
    querySelector() { return null; }
  }
  const el = (tag, text) => new DomNode(tag, text);
  globalThis.document = { createElement: (tag) => el(tag) };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.XMLSerializer = class {
    serializeToString(node) { return node && typeof node.outerHTML === "string" ? node.outerHTML : String(node?.textContent ?? ""); }
  };
  globalThis.createEl = (tag, options = {}) => el(tag, options.text || "");
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  return {
    restore() {
      globalThis.document = previous.document;
      globalThis.Node = previous.Node;
      globalThis.XMLSerializer = previous.XMLSerializer;
      globalThis.createEl = previous.createEl;
      globalThis.createDiv = previous.createDiv;
    },
  };
}

/* §5A du correctif "les contrôles Export ne fonctionnent pas" : test
 * COMPORTEMENTAL bout en bout, sans mocker runExportWorkflow (ni
 * exportWithScope/compile en dessous) — sélectionner Dossier, sélectionner
 * EPUB, cliquer Exporter, puis vérifier le VRAI résultat (fichier compilé
 * écrit dans le coffre), exactement comme un test manuel. */
test("EditionWorkspaceContent : barre d'export — sélectionner Dossier + EPUB puis cliquer Exporter appelle réellement runExportWorkflow et produit un fichier", async () => {
  const restore = installSettingStub();
  const dom = installChildNodesDom();
  try {
    const { view, contentEl, plugin, app } = buildIntegrationFixtureWithContent();
    await view.render();

    const scopeSelect = contentEl.querySelector(".feuillets-edition-quickexport-scope");
    const formatSelect = contentEl.querySelector(".feuillets-edition-quickexport-format");
    const exportBtn = contentEl.querySelector(".feuillets-edition-quickexport-cta");
    assert.ok(scopeSelect && formatSelect && exportBtn, "les trois contrôles existent");

    // "Dossier" doit être proposé (un fichier actif existe, voir
    // activeProjectFile()) — sinon le scénario manuel décrit ne serait
    // simplement pas reproductible.
    const scopeOptions = scopeSelect.children.map((o) => o.value);
    assert.ok(scopeOptions.includes("folder"), "l'option Dossier doit être proposée");

    scopeSelect.value = "folder";
    scopeSelect.dispatch("change");
    formatSelect.value = "epub";
    formatSelect.dispatch("change");

    assert.equal(plugin.settings.exportFormat, "epub", "le changement de Format écrit bien settings.exportFormat");
    assert.deepEqual(plugin.activeExportScope, { type: "folder", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Chapitre 1" }, "le changement de Portée écrit bien activeExportScope (rememberExportScope)");

    // Clic réel : listener câblé par renderQuickBar() (bar.createEl("button")
    // + addEventListener), jamais appelé/attendu directement — le vrai code
    // fait `() => void this.launchExport()` (fire-and-forget, comme tous les
    // autres boutons de ce plugin) : on laisse le temps aux micro/macrotasks
    // de compile()/exportEpub()/writeBinaryFile() de se dérouler avant de
    // vérifier le résultat, sans jamais mocker runExportWorkflow lui-même.
    const clickHandler = exportBtn.events.get("click");
    assert.ok(clickHandler, "un handler click doit être enregistré sur le bouton Exporter");
    let caught = null;
    const onUnhandled = (err) => { caught = err; };
    process.on("unhandledRejection", onUnhandled);
    clickHandler();
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    process.off("unhandledRejection", onUnhandled);
    if (caught) throw caught;

    const outputFiles = app.vault.getFiles().filter((f) => f.path.endsWith(".epub"));
    assert.equal(outputFiles.length, 1, "runExportWorkflow a réellement produit un .epub — pas un no-op silencieux");
    assert.match(outputFiles[0].path, /_Feuillets\/Sortie\/Manuscrit\.epub$/, "écrit au bon endroit (_Feuillets/Sortie), avec le baseName attendu");
  } finally {
    dom.restore();
    restore();
  }
});

test("EditionWorkspaceContent : changer de mode ne recrée jamais de leaf ni de Preview — même vue, même leaf tout du long", async () => {
  const restore = installSettingStub();
  try {
    const { view, previewCalls } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.setMode("export");
    await view["modeRenderPromise"];
    view.setMode("composition");
    await view["modeRenderPromise"];

    assert.equal(view.mode, "composition");
    // Le changement de mode seul ne rafraîchit jamais la Preview de lui-même
    // (seule une modification réelle du contenu le fait).
    assert.equal(previewCalls.refresh, 0);
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : Actualiser l’aperçu fonctionne dans tous les modes (dont l'alias \"export\") sans changer mode, portée ni leaf", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl, plugin, calls, previewCalls } = buildIntegrationFixture();
    await view.render();
    const refresh = contentEl.querySelector('[aria-label="Actualiser l’aperçu"]');
    assert.ok(refresh, "bouton présent dans la barre supérieure");
    const scopeBefore = JSON.stringify(plugin.settings.lastExportScope ?? null);

    // §1 : "export" n'est plus un onglet réel — setMode("export") se ramène
    // à "composition" (voir normalizeMode) : le refresh doit rester un no-op
    // sur le mode RÉSULTANT, jamais recréer de leaf ni changer de portée.
    for (const [requested, expected] of [["composition", "composition"], ["layout", "layout"], ["export", "composition"]]) {
      view.setMode(requested);
      await view["modeRenderPromise"];
      refresh.dispatch("click");
      await Promise.resolve();
      assert.equal(view.mode, expected, `le refresh conserve le mode résultant de setMode("${requested}")`);
    }

    assert.equal(previewCalls.refresh, 3, "un refresh exact depuis chaque appel");
    assert.equal(calls.leafCreates, 0, "aucune leaf créée");
    assert.equal(JSON.stringify(plugin.settings.lastExportScope ?? null), scopeBefore, "portée inchangée");
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : Actualiser sans Preview liée est un no-op propre", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl, calls, previewCalls } = buildIntegrationFixture();
    view.setLinkedPreview(null);
    await view.render();

    contentEl.querySelector('[aria-label="Actualiser l’aperçu"]').dispatch("click");
    await Promise.resolve();

    assert.equal(previewCalls.refresh, 0);
    assert.equal(calls.leafCreates, 0, "aucune Preview créée");
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : un rerender de la barre ne duplique pas le listener Actualiser", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl, previewCalls } = buildIntegrationFixture();
    await view.render();
    await view.render();

    contentEl.querySelector('[aria-label="Actualiser l’aperçu"]').dispatch("click");
    await Promise.resolve();

    assert.equal(previewCalls.refresh, 1, "un clic produit un seul refresh");
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : Composition → Mise en page → Composition ne perd aucun état — le gabarit actif reste identique", async () => {
  const restore = installSettingStub();
  try {
    const { view, plugin } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    const templateAfterLayout = plugin.settings.exportTemplate;
    view.setMode("composition");
    await view["modeRenderPromise"];
    view.setMode("layout");
    await view["modeRenderPromise"];

    assert.equal(plugin.settings.exportTemplate, templateAfterLayout);
    assert.equal(plugin.settings.exportTemplate, "classique");
  } finally {
    restore();
  }
});

/* §6-§7 du dernier lot UX avant 2.5 : "Première page" a quitté la
 * navigation Mise en page — 4 catégories seulement, elle vit désormais
 * UNIQUEMENT dans Composition → Première page. */
test("EditionWorkspaceContent : mode Mise en page — navigation à 4 catégories, plus de Première page", async () => {
  const restore = installSettingStub();
  try {
    const { view } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];

    assert.ok(view.editor.navEl, "la navigation est montée dans son propre conteneur (feuillets-layout-nav)");
    const items = view.editor.navEl.children.filter((el) => el.classes.has("feuillets-layout-nav-item"));
    assert.equal(items.length, 4);
    assert.deepEqual(items.map((el) => el.text), ["Page", "Corps de texte", "Titres", "Citation"]);
  } finally {
    restore();
  }
});

/* §2 du dernier lot UX avant 2.5 : la typographie française a déménagé
 * dans Mise en page → Corps de texte, mais écrit toujours EXACTEMENT
 * settings.exportFrenchTypography (jamais le gabarit ExportTemplateV2). */
test("EditionWorkspaceContent : mode Mise en page → Corps de texte expose \"Typographie française à l'export\", écrit settings.exportFrenchTypography", async () => {
  const restore = installSettingStub();
  try {
    const { view, plugin } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.editor.select("body");

    const typography = controls(view.editor.inspectorEl, "toggle").find((c) => c.name === t("settings.exportFrenchTypography.name"));
    assert.ok(typography, "le contrôle Typographie française est présent dans Corps de texte");
    assert.equal(typography.value, plugin.settings.exportFrenchTypography !== false);

    await typography.change(false);
    assert.equal(plugin.settings.exportFrenchTypography, false, "écrit settings.exportFrenchTypography, pas le gabarit");
    assert.equal(view.editor.template.exportFrenchTypography, undefined, "jamais intégré à ExportTemplateV2");
  } finally {
    restore();
  }
});

/* §8 : la Gouttière n'apparaît qu'à partir de 2 colonnes. */
test("EditionWorkspaceContent : mode Mise en page → Page — Gouttière absente pour 1 colonne, présente pour 2+", async () => {
  const restore = installSettingStub();
  try {
    const { view } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.editor.select("page");

    assert.equal(view.editor.template.page.columns.count, 1, "1 colonne par défaut");
    let gutter = controls(view.editor.inspectorEl, "text").find((c) => c.name === t("modal.layout.gutterPt"));
    assert.equal(gutter, undefined, "Gouttière absente pour 1 colonne");

    const columns = controls(view.editor.inspectorEl, "text").find((c) => c.name === t("modal.layout.columns"));
    assert.ok(columns, "le champ Colonnes est présent");
    await columns.change("2");
    assert.equal(view.editor.template.page.columns.count, 2);

    gutter = controls(view.editor.inspectorEl, "text").find((c) => c.name === t("modal.layout.gutterPt"));
    assert.ok(gutter, "Gouttière apparaît dès 2 colonnes");
  } finally {
    restore();
  }
});

/* §8 : en-tête/pied désactivés n'affichent que l'interrupteur. */
test("EditionWorkspaceContent : mode Mise en page → Page — champs En-tête masqués quand En-tête désactivé", async () => {
  const restore = installSettingStub();
  try {
    const { view } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.editor.select("page");

    // "En-tête centre" est un libellé unique (contrairement à "Gauche"/
    // "Droite", partagés avec les champs Marges du même inspecteur Page).
    assert.equal(view.editor.template.header.enabled, true, "activé par défaut");
    assert.ok(controls(view.editor.inspectorEl, "text").find((c) => c.name === t("modal.layout.headerCenter")), "les champs En-tête sont visibles quand activé");

    const enableHeader = controls(view.editor.inspectorEl, "toggle").find((c) => c.name === t("modal.layout.enableHeader"));
    await enableHeader.change(false);

    assert.equal(controls(view.editor.inspectorEl, "text").find((c) => c.name === t("modal.layout.headerCenter")), undefined, "les champs En-tête disparaissent quand désactivé — seul l'interrupteur reste");
    assert.ok(controls(view.editor.inspectorEl, "toggle").find((c) => c.name === t("modal.layout.enableHeader")), "l'interrupteur reste, lui, toujours visible");
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : mode Mise en page → Page — champs Pied masqués quand Pied désactivé", async () => {
  const restore = installSettingStub();
  try {
    const { view } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.editor.select("page");

    assert.equal(view.editor.template.footer.enabled, true, "activé par défaut");
    let footerControls = controls(view.editor.inspectorEl, "text").filter((c) => [t("modal.layout.formatWithVars"), t("modal.layout.footerLeft"), t("modal.layout.footerCenter")].includes(c.name));
    assert.equal(footerControls.length, 3, "les champs Pied sont visibles quand activé");

    const enableFooter = controls(view.editor.inspectorEl, "toggle").find((c) => c.name === t("modal.layout.enableFooter"));
    await enableFooter.change(false);

    footerControls = controls(view.editor.inspectorEl, "text").filter((c) => [t("modal.layout.formatWithVars"), t("modal.layout.footerLeft"), t("modal.layout.footerCenter")].includes(c.name));
    assert.equal(footerControls.length, 0, "les champs Pied disparaissent quand désactivé");
    assert.ok(controls(view.editor.inspectorEl, "toggle").find((c) => c.name === t("modal.layout.enableFooter")), "l'interrupteur reste, lui, toujours visible");
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : changer une propriété du gabarit (mode Mise en page) sauvegarde le V2 puis rafraîchit la Preview une fois", async () => {
  const restore = installSettingStub();
  try {
    const { view, calls, previewCalls } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.editor.select("body");
    const fontSize = controls(view.editor.inspectorEl, "text")[1];
    await fontSize.change("14");

    assert.equal(view.editor.template.body.fontSizePt, 14);
    assert.equal(calls.frontmatter.length, 1, "saveExportTemplateV2 a écrit le fichier V2");
    assert.equal(previewCalls.refresh, 1, "refreshForLayoutChange appelé exactement une fois");
  } finally {
    restore();
  }
});

/* ==================== §20 : mode Composition ============================== */

test("EditionWorkspaceContent : mode Composition monte les mêmes sections que le panneau latéral (réutilisation stricte)", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl } = buildIntegrationFixture();
    await view.render();

    for (const label of ["Première page", "Pages liminaires", "Sommaire", "Tables", "Bibliographie", "Annexes"]) {
      assert.ok(contentEl.textContent.includes(label), `${label} est présent en mode Composition`);
    }
  } finally {
    restore();
  }
});

test("EditionWorkspaceContent : en mode Composition, une modification (Sommaire) sauvegarde via la méthode existante et rafraîchit la Preview exactement une fois", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl, previewCalls } = buildIntegrationFixture();
    await view.render();

    assert.equal(view.mode, "composition");
    const checkbox = contentEl.querySelector('[aria-label="Inclure le sommaire"]');
    assert.ok(checkbox, "la case Sommaire est rendue");
    checkbox.checked = !checkbox.checked;
    checkbox.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(previewCalls.refresh, 1, "refreshForLayoutChange appelé exactement une fois après la sauvegarde");
  } finally {
    restore();
  }
});

/* ==================== §1/§22 : l'onglet Export a disparu ==================== */

test("EditionWorkspaceContent : setMode(\"export\") ne monte plus aucun panneau Export dédié — la barre compacte suffit", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl } = buildIntegrationFixture();
    await view.render();
    view.setMode("export");
    await view["modeRenderPromise"];

    assert.equal(view.mode, "composition");
    assert.equal(
      contentEl.querySelectorAll(".feuillets-edition-mode-surface.feuillets-edition-export-panel").length,
      0,
      "plus de surface Export dédiée : ExportPanel.renderEditionEmbedded()/render() n'est plus dispatché depuis Édition"
    );
    // La portée/le format restent accessibles via la barre compacte, pas via
    // un panneau Export séparé.
    assert.ok(contentEl.querySelector(".feuillets-edition-quickexport-scope"));
    assert.ok(contentEl.querySelector(".feuillets-edition-quickexport-format"));
  } finally {
    restore();
  }
});
