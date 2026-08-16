import test from "node:test";
import assert from "node:assert/strict";
import { Setting, TFolder } from "obsidian";
import { EditionCompositionContent } from "../src/ui/edition-composition-content.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Micro-correctif « ne plus embarquer d'ItemView dans BoardView » :
 * EditionCompositionContent est un composant DOM PUR (app, plugin, container),
 * sans View ni ItemView ni WorkspaceLeaf, toujours monté "embedded" (seul
 * usage réel, depuis EditionWorkspaceContent) — plus de grand en-tête
 * repliable ni de getDisplayText()/getIcon() hérités d'ItemView. */

/* Même petit DOM factice que test/edition-export-view.test.js (convention
 * du dépôt : dupliqué, pas partagé), complété d'un tableau `.settings` par
 * nœud — même patron que test/layout-modal.test.js (installSettingStub) —
 * pour pouvoir inspecter les lignes `Setting` natives rendues par les
 * panneaux de Composition. */
class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.classes = new Set();
    this._attributes = new Map();
    this._eventListeners = new Map();
    this.settings = [];
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
  get open() { return this._open === true; }
  set open(value) { this._open = !!value; }
  addClass(name) { this.classes.add(name); }
  setText(value) { this.textContent = value; }
  empty() { for (const child of [...this.children]) child.remove(); this.settings = []; }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  setAttr(name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options.text || "");
    if (options.cls) child.className = options.cls;
    if (options.value !== undefined) child.value = options.value;
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

/** Monkey-patch Setting.prototype pour la durée d'un test — même patron
 * établi par test/layout-modal.test.js (installSettingStub) : chaque
 * addXxx() pousse un descripteur riche dans `parent.settings[]` (où
 * `parent` est le FakeElement passé à `new Setting(container)`) plutôt que
 * de construire un vrai DOM. `setName` reste lisible sur l'instance
 * `Setting` elle-même (native, non stubbée pour `setDesc`). */
function installSettingStub() {
  const methods = ["setName", "addButton", "addDropdown", "addExtraButton", "addToggle", "addText"];
  const previous = Object.fromEntries(methods.map((name) => [name, Setting.prototype[name]]));
  const add = (kind, parent, configure) => {
    const control = {
      kind,
      options: [],
      inputEl: new FakeElement("input"),
      toggleEl: new FakeElement("div"),
      buttonEl: new FakeElement("button"),
      extraSettingsEl: new FakeElement("div"),
      addOption(value, label) { this.options.push({ value, label }); return this; },
      setValue(value) { this.value = value; return this; },
      setButtonText(value) { this.text = value; return this; },
      setCta() { this.cta = true; return this; },
      setIcon(value) { this.icon = value; return this; },
      setTooltip(value) { this.tooltip = value; return this; },
      setPlaceholder(value) { this.placeholder = value; return this; },
      onClick(callback) { this.click = callback; return this; },
      onChange(callback) { this.change = callback; return this; },
    };
    parent.settings.push(control);
    configure(control);
    return control;
  };
  Setting.prototype.setName = function setName(name) { this.name = name; return this; };
  Setting.prototype.addButton = function addButton(configure) { add("button", this.container, configure); return this; };
  Setting.prototype.addDropdown = function addDropdown(configure) { add("dropdown", this.container, configure); return this; };
  Setting.prototype.addExtraButton = function addExtraButton(configure) { add("extra", this.container, configure); return this; };
  Setting.prototype.addToggle = function addToggle(configure) { add("toggle", this.container, configure); return this; };
  Setting.prototype.addText = function addText(configure) { add("text", this.container, configure); return this; };
  return () => Object.assign(Setting.prototype, previous);
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function controls(element, kind) {
  return allElements(element).flatMap((item) => item.settings).filter((control) => control.kind === kind);
}

/** Plugin minimal — juste assez pour que FirstPagePanel (Première page) se
 * rende à l'intérieur de Composition. */
function buildPlugin() {
  const manuscript = new TFolder("Projet/Manuscrit");
  const { vault, files } = createFakeVault([manuscript]);
  vault.cachedRead = vault.read;
  vault.files = files;
  const frontmatter = new Map();
  const app = {
    vault,
    fileManager: {
      processFrontMatter: async (file, mutate) => {
        const data = { ...(frontmatter.get(file.path) || {}) };
        mutate(data);
        frontmatter.set(file.path, data);
      },
    },
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) },
    workspace: { getLeaf: () => null },
  };
  const plugin = {
    settings: {
      collapsed: {},
      projectFolder: manuscript.path,
      exportTemplate: "classique",
      orders: {},
      folderPositions: {},
      projectMeta: {},
      level1Role: "chapitres",
      chapterNumbering: "continu",
      sceneNumbering: "hier",
      autoRename: false,
      renamePrefix: "chapitre",
      insertFolderTitles: true,
      insertTitles: true,
      insertSceneTitles: false,
      footnoteRenumberOnCompile: true,
      manuscriptTitle: "",
      manuscriptAuthor: "",
      separator: "",
      compilePresets: [],
      activePreset: -1,
    },
    getProjectFolder: () => app.vault.getAbstractFileByPath(manuscript.path),
    saveSettings: async () => {},
    /* Réglages déplacés depuis les Paramètres (§20 du chantier « espace
       central ») : Composition rend désormais aussi Structure/Notes/
       Informations/Compilation, qui lisent ces mêmes accesseurs que
       l'ancien onglet de réglages. */
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    refreshView: () => {},
  };
  return { app, plugin };
}

test("EditionCompositionContent : composant DOM pur — aucune WorkspaceLeaf, aucune ItemView", () => {
  const { app, plugin } = buildPlugin();
  const view = new EditionCompositionContent(app, plugin, new FakeElement("div"));
  assert.equal(typeof view.getViewType, "undefined", "pas de getViewType : ce n'est pas une View");
  assert.equal(typeof view.leaf, "undefined", "aucune WorkspaceLeaf reçue ni stockée");
});

test("EditionCompositionContent : jamais de grand en-tête repliable — groupes et contenu intacts (seul mode réel, toujours intégré)", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);

    await view.render();

    assert.equal(contentEl.querySelector(".feuillets-section-title-text"), null, "pas d'en-tête repliable — le composant est toujours intégré");
    assert.deepEqual(
      contentEl.querySelectorAll(".feuillets-edition-group-label").map((node) => node.textContent),
      ["Contenu", "Éléments générés", "Fin d’ouvrage", "Numérotation", "Notes", "Informations de l’ouvrage", "Compilation"]
    );
    for (const label of ["Première page", "Pages liminaires", "Sommaire", "Tables", "Bibliographie", "Annexes"]) {
      assert.ok(contentEl.textContent.includes(label), `${label} est présent`);
    }
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : Composition reste la section principale ; toutes les sous-sections réellement implémentées y sont présentes, une seule ligne Setting native par entrée", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);

    await view.render();

    const section = contentEl.querySelector(".feuillets-project-section");
    assert.ok(section, "utilise le langage visuel feuillets-project-section");

    for (const label of ["Première page", "Pages liminaires", "Sommaire", "Table des matières", "Tables", "Bibliographie", "Annexes"]) {
      assert.ok(contentEl.textContent.includes(label), `${label} est présent`);
    }
    assert.equal(contentEl.querySelectorAll(".setting-item").length, 0);

    // Plus aucun <details>/<summary> nulle part dans Composition : le
    // correctif remplace intégralement ce patron par des lignes Setting.
    assert.equal(contentEl.querySelectorAll("details").length, 0);
    assert.equal(contentEl.querySelectorAll("summary").length, 0);
    assert.equal(contentEl.querySelectorAll(".feuillets-edition-composition-separator").length, 0);
    assert.deepEqual(
      contentEl.querySelectorAll(".feuillets-edition-group-label").map((node) => node.textContent),
      ["Contenu", "Éléments générés", "Fin d’ouvrage", "Numérotation", "Notes", "Informations de l’ouvrage", "Compilation"]
    );
    const ordered = ["Contenu", "Première page", "Pages liminaires", "Éléments générés", "Sommaire", "Table des matières", "Tables", "Fin d’ouvrage", "Bibliographie", "Annexes"];
    let previousIndex = -1;
    for (const label of ordered) {
      const index = contentEl.textContent.indexOf(label);
      assert.ok(index > previousIndex, `${label} apparaît après l'élément précédent`);
      previousIndex = index;
    }

    // Première page / Pages liminaires : les composants partagés restent montés.
    assert.ok(contentEl.querySelector('[aria-label="Première page"]'));
    assert.ok(contentEl.querySelector('[aria-label="Pages liminaires"]'));

    // Sommaire / Table des matières / Tables / Bibliographie / Annexes :
    // chacune un seul toggle natif, wiré à la persistance réelle. Filtré sur
    // le préfixe « Inclure » : Composition héberge désormais aussi les cases
    // des réglages déplacés depuis les Paramètres (§20), qui ne font pas
    // partie des éléments générés.
    const checkboxes = contentEl.querySelectorAll("input")
      .filter((node) => (node.getAttribute("aria-label") || "").startsWith("Inclure "));
    assert.equal(checkboxes.length, 5, "une case par élément généré");

    // Annexes porte en plus un bouton compact (Créer le dossier Annexes).
    assert.ok(contentEl.querySelector('[aria-label="Créer le dossier Annexes"]'));

    // Basculer le toggle Sommaire persiste réellement l'inclusion — même
    // mécanisme qu'avant (setIncluded → writeGeneratedIncluded), juste
    // exposé via l'API native `Setting.addToggle` désormais.
    const summaryCheckbox = contentEl.querySelector('[aria-label="Inclure le sommaire"]');
    summaryCheckbox.checked = true;
    summaryCheckbox.dispatch("change");
    await Promise.resolve();
    const meta = plugin.settings.projectMeta[plugin.getProjectFolder().path];
    assert.ok(meta, "le basculement écrit bien dans ProjectMeta");

    // L'ancienne phrase provisoire a disparu.
    assert.equal(contentEl.querySelector(".feuillets-edition-section-description"), null);
    assert.equal(
      contentEl.textContent.includes("Première page, pages liminaires, sommaire, tables, bibliographie, annexes et index."),
      false,
      "l'ancienne phrase provisoire ne doit plus apparaître"
    );

    // Aucun futur élément de composition factice (Index) n'est ajouté avant
    // sa propre phase.
    assert.equal(contentEl.textContent.includes("Index"), false, "« Index » ne doit pas apparaître avant sa propre phase");
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : Première page se déplie/replie via son chevron, sans perdre le contenu existant", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    assert.equal(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), null, "repliée par défaut");

    contentEl.querySelector('[aria-label="Première page"]').click();
    await Promise.resolve();
    await Promise.resolve();

    assert.ok(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), "le composant partagé est bien rendu, pas une coquille vide");

    contentEl.querySelector('[aria-label="Première page"]').click();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), null, "repliée à nouveau");
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : aucune dépendance à PreviewView", async () => {
  const restoreDom = installDom();
  const restoreSetting = installSettingStub();
  try {
    const { app, plugin } = buildPlugin();
    const view = new EditionCompositionContent(app, plugin, new FakeElement("div"));
    // Aucun champ ni méthode évoquant PreviewView.
    assert.equal("compileScope" in view, false);
    assert.equal("effectiveExportScope" in view, false);
    await view.render();
  } finally {
    restoreSetting();
    restoreDom();
  }
});

test("EditionCompositionContent : réattacher à un nouveau conteneur (attach) conserve l'instance", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const view = new EditionCompositionContent(app, plugin, new FakeElement("div"));
    await view.render();

    const second = new FakeElement("div");
    view.attach(second);
    await view.render();

    assert.ok(second.textContent.includes("Première page"), "le nouveau conteneur reçoit le rendu");
  } finally {
    restoreDom();
  }
});
