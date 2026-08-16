import { test } from "node:test";
import assert from "node:assert/strict";
import { Setting, TFolder } from "obsidian";
import { VIEW_PREVIEW } from "../src/constants.js";
import { EditionWorkspaceContent } from "../src/ui/edition-workspace-content.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

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
  const calls = { save: 0, frontmatter: [] };
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
    workspace: { getLeavesOfType: () => [previewLeaf], getLeaf: () => null },
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
  return { view, contentEl, plugin, calls, previewCalls };
}

/* ==================== §19-21 : trois modes, navigation ==================== */

test("EditionWorkspaceContent : la navigation contient exactement 3 modes, Composition/Mise en page/Export, mode initial composition", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl } = buildIntegrationFixture();
    await view.render();

    assert.equal(view.mode, "composition");
    const items = contentEl.querySelectorAll(".feuillets-edition-mode-item");
    assert.deepEqual(items.map((el) => el.textContent), ["Composition", "Mise en page", "Export"]);
    assert.equal(items[0].hasClass("is-active"), true);
    assert.equal(items[1].hasClass("is-active"), false);
    assert.equal(items[2].hasClass("is-active"), false);
  } finally {
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

test("EditionWorkspaceContent : mode Mise en page — la navigation à 5 catégories du chantier précédent reste intacte", async () => {
  const restore = installSettingStub();
  try {
    const { view } = buildIntegrationFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];

    assert.ok(view.editor.navEl, "la navigation est montée dans son propre conteneur (feuillets-layout-nav)");
    const items = view.editor.navEl.children.filter((el) => el.classes.has("feuillets-layout-nav-item"));
    assert.equal(items.length, 5);
    assert.deepEqual(items.map((el) => el.text), ["Page", "Corps de texte", "Titres", "Citation", "Première page"]);
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
    const checkbox = contentEl.querySelectorAll("input").find((el) => el.type === "checkbox");
    assert.ok(checkbox, "au moins une case (Sommaire/Table des matières/…) est rendue");
    checkbox.checked = !checkbox.checked;
    checkbox.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(previewCalls.refresh, 1, "refreshForLayoutChange appelé exactement une fois après la sauvegarde");
  } finally {
    restore();
  }
});

/* ==================== §22 : mode Export ==================================== */

test("EditionWorkspaceContent : mode Export monte ExportPanel en mode embedded — pas de nouvelle implémentation", async () => {
  const restore = installSettingStub();
  try {
    const { view, contentEl } = buildIntegrationFixture();
    await view.render();
    view.setMode("export");
    await view["modeRenderPromise"];

    assert.ok(
      contentEl.querySelector(".feuillets-edition-export-panel"),
      "le mode Export réutilise le rendu embedded d'ExportPanel (même classe que EditionLayoutView avant migration)"
    );
    assert.ok(contentEl.querySelector('[aria-label="Portée de l’export"]'), "le champ Portée est présent");
  } finally {
    restore();
  }
});

