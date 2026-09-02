import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Setting, TFolder } from "obsidian";
import { EditionCompositionContent } from "../src/ui/edition-composition-content.js";
import { contentVariantsFilePath, createContentVariant, selectedContentVariant } from "../src/services/content-variants.js";
import { createContentExtraction, deleteContentExtraction, updateContentExtraction } from "../src/services/content-extractions.js";
import { createContentCollection, deleteContentCollection, updateContentCollection } from "../src/services/content-collections.js";
import { setLocale, t } from "../src/i18n/index.js";
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
    // TitlePageMiniature (mountée par LayoutEditor.renderStandaloneFirstPage
    // dans la sous-page Composition → Première page, §6) assigne directement
    // des propriétés CSS (`el.style.height = ...`) plutôt que `setProperty` —
    // un simple objet suffit, aucun rendu réel n'est vérifié ici.
    this.style = {};
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
    refreshBinderViews: () => {},
  };
  return { app, plugin };
}

test("EditionCompositionContent : composant DOM pur — aucune WorkspaceLeaf, aucune ItemView", () => {
  const { app, plugin } = buildPlugin();
  const view = new EditionCompositionContent(app, plugin, new FakeElement("div"));
  assert.equal(typeof view.getViewType, "undefined", "pas de getViewType : ce n'est pas une View");
  assert.equal(typeof view.leaf, "undefined", "aucune WorkspaceLeaf reçue ni stockée");
});

/* Passe ergonomique finale : plus de nav permanente à quatre
 * rubriques — Composition affiche trois groupes principaux (AVANT /
 * MANUSCRIT / APRÈS) ouvrant chacun une sous-page. */
test("EditionCompositionContent : plus de nav permanente Contenu/Structure/Notes/Informations", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);

    await view.render();

    assert.equal(contentEl.querySelector(".feuillets-section-title-text"), null, "pas d'en-tête repliable — le composant est toujours intégré");
    assert.equal(contentEl.querySelectorAll(".feuillets-composition-nav-item").length, 0, "plus de nav permanente à onglets");
    assert.equal(contentEl.querySelector('[aria-label="Informations"]'), null, "Informations a disparu");
    assert.equal(contentEl.textContent.includes("Informations"), false, "Informations n'apparaît nulle part");

    // Sommaire principal : trois entrées seulement
    const mainRows = [...contentEl.querySelectorAll(".feuillets-project-row")];
    assert.equal(mainRows.length, 3, "exactement trois entrées principales");
    assert.ok(contentEl.textContent.includes("Avant le manuscrit"), "Avant le manuscrit présent");
    assert.ok(contentEl.textContent.includes("Le manuscrit"), "Le manuscrit présent");
    assert.ok(contentEl.textContent.includes("Après le manuscrit"), "Après le manuscrit présent");

    // Pas d'éléments détaillés dans le sommaire principal
    assert.ok(!contentEl.querySelector('[aria-label="Inclure la page de titre"]'), "pas de contenu Première page");
    assert.ok(!contentEl.querySelector('[aria-label="Renuméroter les notes dans le document compilé"]'), "pas de contenu Structure");
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : Le manuscrit expose Contenu, Variantes, Extractions, Collections puis Structure", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();
    const manuscript = contentEl.querySelectorAll(".feuillets-project-row")[1];
    manuscript.click();
    await view.renderPromise;
    const labels = contentEl.querySelectorAll(".feuillets-project-row").map((row) => row.querySelector(".feuillets-project-row-label")?.textContent);
    assert.deepEqual(labels, ["Contenu du manuscrit", "Variantes de contenu", "Extractions de contenu", "Collections de contenu", "Structure du manuscrit"]);
    const variantsRow = contentEl.querySelectorAll(".feuillets-project-row")[1];
    assert.equal(variantsRow.textContent.includes("Complète"), false);
    assert.equal(variantsRow.textContent.includes("Aucune"), false);
    assert.equal(variantsRow.textContent.includes("Sans variante"), false);
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : sous-page Collections vide, création, modification, suppression et retour", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();
    contentEl.querySelectorAll(".feuillets-project-row")[1].click();
    await view.renderPromise;
    contentEl.querySelectorAll(".feuillets-project-row")[3].click();
    await view.renderPromise;
    assert.ok(contentEl.textContent.includes("Facultatif. Regroupe certains rôles avec leur contexte de titres."));
    assert.ok(contentEl.textContent.includes("Aucune collection créée."));
    assert.equal(contentEl.querySelectorAll(".feuillets-content-empty-state").length, 1);
    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title")?.textContent.includes("Collections de contenu"));
    assert.ok(contentEl.querySelector(".feuillets-content-collections-hint")?.hasClass("feuillets-notes-sub"));
    assert.ok(contentEl.textContent.includes("Nouvelle collection…"));
    const collection = await createContentCollection(app, plugin.settings, "Dossier", ["source", "preuve"]);
    await view.render();
    assert.ok(contentEl.textContent.includes("Dossier"));
    await updateContentCollection(app, plugin.settings, collection.id, { name: "Glossaire", roles: ["definition"] });
    await view.render();
    assert.ok(contentEl.textContent.includes("Glossaire"));
    await deleteContentCollection(app, plugin.settings, collection.id);
    await view.render();
    assert.ok(contentEl.textContent.includes("Aucune collection créée."));
    const back = contentEl.querySelector(".feuillets-composition-back");
    back.click();
    await view.renderPromise;
    assert.ok(contentEl.textContent.includes("Collections de contenu"));
    assert.equal(contentEl.textContent.includes("collection active"), false);
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : sous-page Extractions vide, création, modification, suppression et retour", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();
    contentEl.querySelectorAll(".feuillets-project-row")[1].click();
    await view.renderPromise;
    contentEl.querySelectorAll(".feuillets-project-row")[2].click();
    await view.renderPromise;
    assert.ok(contentEl.textContent.includes("Facultatif. Extrait des sections à partir de leurs rôles."));
    assert.ok(contentEl.textContent.includes("Aucune extraction créée."));
    assert.equal(contentEl.querySelectorAll(".feuillets-content-empty-state").length, 1);
    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title")?.textContent.includes("Extractions de contenu"));
    assert.ok(contentEl.querySelector(".feuillets-content-extractions-hint")?.hasClass("feuillets-notes-sub"));
    assert.ok(contentEl.textContent.includes("Nouvelle extraction…"));
    assert.equal(contentEl.textContent.includes("extraction active"), false);
    const extraction = await createContentExtraction(app, plugin.settings, "Activités", ["questions"]);
    await view.render();
    assert.ok(contentEl.textContent.includes("Activités"));
    assert.equal(contentEl.textContent.includes("Sélectionner"), false);
    await updateContentExtraction(app, plugin.settings, extraction.id, { name: "Questions", triggerRoles: ["questions", "source"] });
    await view.render();
    assert.ok(contentEl.textContent.includes("Questions"));
    await deleteContentExtraction(app, plugin.settings, extraction.id);
    await view.render();
    assert.ok(contentEl.textContent.includes("Aucune extraction créée."));
    const back = contentEl.querySelector(".feuillets-composition-back");
    back.click();
    await view.renderPromise;
    assert.ok(contentEl.textContent.includes("Variantes de contenu"));
    assert.ok(contentEl.textContent.includes("Extractions de contenu"));
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : extractions et collections utilisent des cartes verticales et résument les rôles", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    await createContentExtraction(app, plugin.settings, "Sélection", ["questions", "solution", "source", "preuve", "citation"]);
    await createContentCollection(app, plugin.settings, "Références", ["preuve", "source", "citation"]);
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();
    contentEl.querySelectorAll(".feuillets-project-row")[1].click();
    await view.renderPromise;
    contentEl.querySelectorAll(".feuillets-project-row")[2].click();
    await view.renderPromise;
    const extraction = contentEl.querySelector(".feuillets-content-item");
    assert.ok(extraction.querySelector(".feuillets-content-item-name"));
    assert.ok(extraction.querySelector(".feuillets-content-item-summary").textContent.includes("+2"));
    assert.ok(extraction.querySelector(".feuillets-content-item-actions"));
    assert.equal(extraction.querySelector(".feuillets-content-item-name").getAttribute("title"), "Sélection");
    contentEl.querySelector(".feuillets-composition-back").click();
    await view.renderPromise;
    contentEl.querySelectorAll(".feuillets-project-row")[3].click();
    await view.renderPromise;
    const collection = contentEl.querySelector(".feuillets-content-item");
    assert.ok(collection.querySelector(".feuillets-content-item-name"));
    assert.ok(collection.querySelector(".feuillets-content-item-summary").textContent.includes("Preuve · Source · Citation"));
    assert.ok(collection.querySelector(".feuillets-content-item-actions"));
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : un fichier corrompu conserve Contenu et Structure et signale Erreur", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    await app.vault.create(contentVariantsFilePath(app, plugin.settings), "not json");
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();
    contentEl.querySelectorAll(".feuillets-project-row")[1].click();
    await view.renderPromise;
    assert.ok(contentEl.textContent.includes("Contenu du manuscrit"));
    assert.ok(contentEl.textContent.includes("Structure du manuscrit"));
    assert.ok(contentEl.textContent.includes("Erreur"));
    contentEl.querySelectorAll(".feuillets-project-row")[1].click();
    await view.renderPromise;
    assert.ok(contentEl.textContent.includes("Le fichier des variantes de contenu est invalide."));
    assert.equal(contentEl.querySelector("select"), null);
    assert.equal(contentEl.querySelector(".feuillets-content-variant-add"), null);
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : aucune variante n'affiche ni sélecteur vide ni choix Sans variante", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();
    contentEl.querySelectorAll(".feuillets-project-row")[1].click();
    await view.renderPromise;
    contentEl.querySelectorAll(".feuillets-project-row")[1].click();
    await view.renderPromise;
    assert.equal(contentEl.querySelector("select"), null);
    assert.equal(contentEl.querySelectorAll(".feuillets-content-empty-state").length, 1);
    assert.ok(contentEl.querySelector(".feuillets-content-variants-hint")?.hasClass("feuillets-notes-sub"));
    assert.ok(contentEl.textContent.includes("Nouvelle variante…"));
    assert.equal(contentEl.textContent.includes("Sans variante"), false);
  } finally {
    restoreDom();
  }
});

test("ContentVariantModal : vocabulaire des rôles et texte sans rôle sont localisés", () => {
  setLocale("fr");
  assert.equal(t("contentVariants.modal.includedRoles"), "Rôles inclus");
  assert.equal(t("contentVariants.modal.roleHint"), "Le texte sans rôle est toujours inclus.");
  setLocale("en");
  assert.equal(t("contentVariants.modal.includedRoles"), "Included roles");
  assert.equal(t("contentVariants.modal.roleHint"), "Text without a role is always included.");
  setLocale("fr");
});

test("EditionCompositionContent : sous-page Variantes reste sous Le manuscrit et persiste la sélection", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const first = await createContentVariant(app, plugin.settings, "Lecture courte");
    const second = await createContentVariant(app, plugin.settings, "Lecture longue");
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();
    contentEl.querySelectorAll(".feuillets-project-row")[1].click();
    await view.renderPromise;
    contentEl.querySelectorAll(".feuillets-project-row")[1].click();
    await view.renderPromise;
    assert.ok(contentEl.textContent.includes("Facultatif. Le texte sans rôle est toujours inclus."));
    assert.ok(contentEl.textContent.includes("Sans variante"));
    assert.ok(contentEl.textContent.includes(first.name));
    assert.ok(contentEl.textContent.includes(second.name));
    assert.equal(contentEl.querySelector("select")?.value, "");
    const select = contentEl.querySelector("select");
    select.value = first.id;
    select.dispatch("change", { target: select });
    await view.renderPromise;
    assert.equal((await selectedContentVariant(app, plugin.settings))?.id, first.id);
    const selectedRow = contentEl.querySelector(`[data-content-entry-id="${first.id}"]`);
    assert.ok(selectedRow?.hasClass("feuillets-content-item-selected"), "la variante sélectionnée est visuellement active");
    assert.ok(selectedRow?.textContent.includes("Sélectionnée"), "l’état sélectionné est lisible");
    assert.ok(selectedRow?.textContent.includes("rôles"), "le résumé des rôles est visible");
    const otherRow = contentEl.querySelector(`[data-content-entry-id="${second.id}"]`);
    assert.ok(otherRow && !otherRow.hasClass("feuillets-content-item-selected"), "les autres variantes restent inactives");
    const back = contentEl.querySelector(".feuillets-composition-back");
    back.click();
    await view.renderPromise;
    assert.equal(contentEl.textContent.includes(first.name), true);
    assert.equal(contentEl.textContent.includes("WorkspaceLeaf"), false);
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : Composition reste la section principale ; sommaire compact, trois entrées principales", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);

    await view.render();

    assert.ok(contentEl.querySelector(".feuillets-composition-body"), "utilise le conteneur de sommaire dédié");

    // Pas d'accordéon ni de détails ouverts
    assert.equal(contentEl.querySelectorAll("details").length, 0);
    assert.equal(contentEl.querySelectorAll("summary").length, 0);

    // Aucun contenu détaillé dans le sommaire principal
    assert.equal(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), null, "pas de contenu Première page");
    assert.equal(contentEl.querySelector('[aria-label="Renuméroter les notes dans le document compilé"]'), null, "pas de contenu Structure");

    // Les cases pour Sommaire/TDM/Tables/etc n'apparaissent plus ici (elles sont
    // dans les sous-pages Avant/Après). Le sommaire principal affiche uniquement les
    // trois entrées (pas de checkboxes).
    const checkboxes = contentEl.querySelectorAll("input")
      .filter((node) => (node.getAttribute("aria-label") || "").startsWith("Inclure "));
    assert.equal(checkboxes.length, 0, "aucune case dans le sommaire principal");

    // Les trois entrées principales
    const rows = [...contentEl.querySelectorAll(".feuillets-project-row")];
    assert.equal(rows.length, 3, "trois entrées");
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : sous-page Première page — CONTENU (FirstPagePanel) + PRÉSENTATION (LayoutEditor), retour hiérarchique", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    let leafCalls = 0;
    let changeCalls = 0;
    app.workspace.getLeaf = () => { leafCalls += 1; return null; };
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl, { onChange: () => { changeCalls += 1; } });
    await view.render();

    assert.equal(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), null, "absent tant que la sous-page n'est pas ouverte");

    // Cliquer sur "Avant le manuscrit" pour ouvrir la sous-page
    const beforeRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Avant le manuscrit"));
    beforeRow.click();
    await view.renderPromise;

    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title").textContent.includes("Avant le manuscrit"));

    // Maintenant cliquer sur "Première page" dans cette sous-page
    const firstPageRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Première page"));
    firstPageRow.click();
    await view.renderPromise;

    // Sous-page "Première page" est ouverte
    assert.equal(contentEl.querySelectorAll(".feuillets-composition-nav-item").length, 0);
    assert.ok(contentEl.querySelector(".feuillets-composition-back"), "bouton de retour");
    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title").textContent.includes("Première page"));

    // CONTENU (FirstPagePanel réutilisé)
    assert.ok(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), "FirstPagePanel monté");
    // PRÉSENTATION (LayoutEditor.renderStandaloneFirstPage réutilisé)
    for (const label of ["Masquer en-tête et pied", "Position du numéro"]) {
      assert.ok(contentEl.textContent.includes(label), `${label} présent`);
    }

    assert.equal(leafCalls, 0, "aucune leaf créée");
    assert.equal(changeCalls, 0, "aucun callback par navigation seule");

    // Retour vers "Avant le manuscrit"
    contentEl.querySelector(".feuillets-composition-back").click();
    await view.renderPromise;
    assert.equal(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), null, "Première page démontée");
    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title").textContent.includes("Avant le manuscrit"), "de retour à Avant");

    // Retour vers le sommaire
    contentEl.querySelector(".feuillets-composition-back").click();
    await view.renderPromise;
    assert.ok([...contentEl.querySelectorAll(".feuillets-project-row")].some((row) => row.textContent.includes("Avant le manuscrit")), "Avant le manuscrit de retour");
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : sous-page Structure — Séparateur/presets + Notes de bas de page, retour hiérarchique", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    // Cliquer sur "Le manuscrit" pour ouvrir la sous-page
    const manuscriptRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Le manuscrit"));
    manuscriptRow.click();
    await view.renderPromise;

    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title").textContent.includes("Le manuscrit"));

    // Cliquer sur "Structure du manuscrit" dans cette sous-page
    const structureRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Structure du manuscrit"));
    structureRow.click();
    await view.renderPromise;

    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title").textContent.includes("Structure du manuscrit"));
    for (const label of ["Séparateur", "Presets de compilation", "Ajouter un preset"]) {
      assert.ok(contentEl.textContent.includes(label), `${label} présent`);
    }
    // Notes de bas de page est en bas de Structure
    assert.deepEqual(
      contentEl.querySelectorAll(".feuillets-edition-group-label").map((node) => node.textContent).slice(-1),
      ["Notes de bas de page"]
    );
    assert.ok(contentEl.querySelector('[aria-label="Renuméroter les notes dans le document compilé"]'));

    // Retour vers "Le manuscrit"
    contentEl.querySelector(".feuillets-composition-back").click();
    await view.renderPromise;
    assert.equal(contentEl.querySelector('[aria-label="Renuméroter les notes dans le document compilé"]'), null, "Structure démontée");
    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title").textContent.includes("Le manuscrit"));

    // Retour vers le sommaire
    contentEl.querySelector(".feuillets-composition-back").click();
    await view.renderPromise;
    assert.ok([...contentEl.querySelectorAll(".feuillets-project-row")].some((row) => row.textContent.includes("Le manuscrit")), "Le manuscrit de retour");
  } finally {
    restoreDom();
  }
});

/* §9 du dernier lot UX avant 2.5 : un changement de réglage Structure peut
 * rafraîchir le Binder, mais ne doit JAMAIS reconstruire la surface
 * Composition active — ni sa sous-page, ni sa position de défilement. */
test("EditionCompositionContent : un changement de réglage Structure appelle refreshBinderViews (jamais refreshView/renderAllViews), sans reconstruire la sous-page", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    let refreshViewCalls = 0;
    let refreshBinderCalls = 0;
    let renderAllViewsCalls = 0;
    plugin.refreshView = () => { refreshViewCalls += 1; };
    plugin.refreshBinderViews = () => { refreshBinderCalls += 1; };
    plugin.renderAllViews = () => { renderAllViewsCalls += 1; };
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    // Naviguer vers "Le manuscrit"
    const manuscriptRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Le manuscrit"));
    manuscriptRow.click();
    await view.renderPromise;

    // Puis naviguer vers "Structure du manuscrit"
    const structureRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Structure du manuscrit"));
    structureRow.click();
    await view.renderPromise;

    const subpageTitleBefore = contentEl.querySelector(".feuillets-composition-subpage-title");

    const level1RoleSelect = [...contentEl.querySelectorAll("select")].find((select) => select.getAttribute("aria-label") === "Rôle du premier niveau");
    assert.ok(level1RoleSelect, "le sélecteur de rôle de niveau 1 est dans Structure");
    level1RoleSelect.value = "parties";
    level1RoleSelect.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(plugin.settings.level1Role, "parties", "le réglage est bien sauvegardé");
    assert.equal(refreshBinderCalls, 1, "refreshBinderViews est appelé");
    assert.equal(refreshViewCalls, 0, "refreshView n'est JAMAIS appelé");
    assert.equal(renderAllViewsCalls, 0, "renderAllViews n'est jamais appelé");
    assert.equal(contentEl.querySelector(".feuillets-composition-subpage-title"), subpageTitleBefore, "Structure n'a pas été reconstruite");
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

    assert.ok(second.textContent.includes("Avant le manuscrit"), "le nouveau conteneur reçoit le rendu");
  } finally {
    restoreDom();
  }
});

/* ==================================================================
 * MICRO-CORRECTIF VISUEL — DEUX GRAMMAIRES DISTINCTES.
 * Composition pages de NAVIGATION : Retour sur SA PROPRE ligne, titre sur
 * la ligne SUIVANTE ; chaque entrée = label | status | chevron/contrôle
 * sur UNE SEULE ligne. En sous-page : « Retour à Édition » (sidebar)
 * absent de ce composant.
 * ================================================================== */

function compositionRows(container) {
  return [...container.querySelectorAll(".feuillets-project-row")];
}

function openCompositionRow(container, label) {
  const row = compositionRows(container).find((r) => r.textContent.includes(label));
  assert.ok(row, `ligne « ${label} » présente`);
  row.click();
}

test("MICRO composition §27.1+2 — avant : le Retour tient sa propre ligne, le titre vient EN DESSOUS", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    openCompositionRow(contentEl, "Avant le manuscrit");
    await view.renderPromise;

    const header = contentEl.querySelector(".feuillets-composition-subpage-header");
    assert.ok(header, "en-tête de sous-page rendu");
    const children = [...header.children];
    assert.equal(children.length, 2, "Retour + titre, deux frères");
    assert.ok(children[0].classes.has("feuillets-composition-back"), "le Retour est le premier frère");
    assert.ok(children[1].classes.has("feuillets-composition-subpage-title"), "le titre est le SECOND frère");
    assert.ok(children[0].textContent.includes("Composition"), "le Retour pointe vers Composition (parent immédiat)");
    assert.ok(children[1].textContent.includes("Avant le manuscrit"), "le titre est Avant le manuscrit");
    assert.ok(!children[0].textContent.includes("Avant le manuscrit"), "jamais retour + titre sur la même ligne");
  } finally {
    restoreDom();
  }
});

test("MICRO composition §27.3 — avant : Première page + status + chevron sur UNE seule row", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    openCompositionRow(contentEl, "Avant le manuscrit");
    await view.renderPromise;

    const firstPageRow = compositionRows(contentEl).find((r) => r.textContent.includes("Première page"));
    assert.ok(firstPageRow, "ligne Première page présente");
    assert.ok(firstPageRow.querySelector(".feuillets-project-row-label"), "label Première page dans la row");
    const count = firstPageRow.querySelector(".feuillets-edition-count");
    assert.ok(count && count.textContent.trim() !== "", "status (Incluse/Exclue) sur la MÊME row");
    assert.ok(firstPageRow.querySelector(".clickable-icon"), "chevron sur la MÊME row");
  } finally {
    restoreDom();
  }
});

test("MICRO composition §27.4+5 — avant : Sommaire et Tables ont leur checkbox sur la MÊME ligne", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    openCompositionRow(contentEl, "Avant le manuscrit");
    await view.renderPromise;

    const sommaireRow = [...contentEl.querySelectorAll(".feuillets-edition-row")].find((r) => r.textContent.includes("Sommaire"));
    assert.ok(sommaireRow, "ligne Sommaire présente");
    assert.ok(sommaireRow.querySelector(".feuillets-properties-key"), "label Sommaire");
    assert.ok(sommaireRow.querySelector('[aria-label="Inclure le sommaire"]'), "checkbox Sommaire sur la MÊME ligne");

    const tablesRow = [...contentEl.querySelectorAll(".feuillets-edition-row")].find((r) => r.textContent.includes("Tables"));
    assert.ok(tablesRow, "ligne Tables présente");
    assert.ok(tablesRow.querySelector(".feuillets-properties-key"), "label Tables");
    assert.ok(tablesRow.querySelector('[aria-label="Inclure les tables"]'), "checkbox Tables sur la MÊME ligne");
  } finally {
    restoreDom();
  }
});

test("MICRO composition §27.6 — le manuscrit : Contenu + décompte + chevron sur UNE seule row", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    openCompositionRow(contentEl, "Le manuscrit");
    await view.renderPromise;

    const contentRow = compositionRows(contentEl).find((r) => r.textContent.includes("Contenu du manuscrit"));
    assert.ok(contentRow, "ligne Contenu du manuscrit présente");
    assert.ok(contentRow.querySelector(".feuillets-project-row-label"), "label Contenu du manuscrit");
    const count = contentRow.querySelector(".feuillets-edition-count");
    assert.ok(count && /^\d+\/\d+$/.test(count.textContent.trim()), "décompte 101/101 sur la MÊME row");
    assert.ok(contentRow.querySelector(".clickable-icon"), "chevron sur la MÊME row");
  } finally {
    restoreDom();
  }
});

test("MICRO composition §27.7 — après : Table des matières + contrôle sur UNE seule ligne", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    openCompositionRow(contentEl, "Après le manuscrit");
    await view.renderPromise;

    const tdmRow = [...contentEl.querySelectorAll(".feuillets-edition-row")].find((r) => r.textContent.includes("Table des matières"));
    assert.ok(tdmRow, "ligne Table des matières présente");
    assert.ok(tdmRow.querySelector(".feuillets-properties-key"), "label Table des matières");
    assert.ok(tdmRow.querySelector('[aria-label="Inclure la table des matières"]'), "contrôle sur la MÊME ligne");
  } finally {
    restoreDom();
  }
});

test("MICRO composition §27.8 — aucun titre de page n'est placé dans la back bar", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    openCompositionRow(contentEl, "Avant le manuscrit");
    await view.renderPromise;

    const back = contentEl.querySelector(".feuillets-composition-back");
    assert.ok(back, "bouton Retour présent");
    assert.equal(back.querySelector(".feuillets-composition-subpage-title"), null, "le titre ne vit JAMAIS dans le bouton Retour");
    assert.equal(back.textContent.includes("Avant le manuscrit"), false, "le nom de la page courante n'est pas dans le Retour");
  } finally {
    restoreDom();
  }
});

test("MICRO composition §27.9 — en sous-page, « Retour à Édition » est absent", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    openCompositionRow(contentEl, "Avant le manuscrit");
    await view.renderPromise;
    assert.equal(contentEl.textContent.includes("Retour à Édition"), false, "aucun Retour global en sous-page");

    openCompositionRow(contentEl, "Première page");
    await view.renderPromise;
    assert.equal(contentEl.textContent.includes("Retour à Édition"), false, "aucun Retour global en sous-page profonde");
    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title").textContent.includes("Première page"), "seul le titre local reste");
  } finally {
    restoreDom();
  }
});

test("MICRO composition §27.CSS — l'en-tête empile Retour puis titre, jamais dans le même flex-row", () => {
  const css = readFileSync("styles.css", "utf8");
  const header = ruleBlock(css, ".feuillets-composition-subpage-header");
  assert.ok(header.includes("flex-direction: column"), "en-tête vertical : Retour puis titre");
  assert.equal(header.includes("flex-direction: row"), false, "jamais retour + titre dans le même flex-row");
});

/* ==========================================================================
 * DERNIER CORRECTIF : Composition notifie son parent (sidebar) via
 * onNavigationRootChange — true sur le sommaire, false partout ailleurs ;
 * les libellés de Structure sont raccourcis (i18n uniquement) ; les lignes
 * de Structure ne reçoivent JAMAIS la classe compacte du LayoutEditor.
 * ========================================================================== */

test("racine : EditionCompositionContent.notifie true sur le sommaire, false au premier clic, true au retour", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const seen = [];
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl, { onNavigationRootChange: (isRoot) => seen.push(isRoot) });
    await view.render();
    assert.deepEqual(seen, [true], "sommaire = racine");

    openCompositionRow(contentEl, "Le manuscrit");
    await view.renderPromise;
    assert.deepEqual(seen, [true, false], "Le manuscrit → hors racine");

    const back = contentEl.querySelector(".feuillets-composition-back");
    back.click();
    await view.renderPromise;
    assert.deepEqual(seen, [true, false, true], "retour au sommaire → racine");
  } finally {
    restoreDom();
  }
});

test("Structure : libellés raccourcis (Rôle du premier niveau, Numérotation chapitres/scènes, Renuméroter les titres, Préfixe de numérotation, Titres des parties/chapitres/scènes)", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    openCompositionRow(contentEl, "Le manuscrit");
    await view.renderPromise;
    openCompositionRow(contentEl, "Structure du manuscrit");
    await view.renderPromise;

    const ariaLabels = [...contentEl.querySelectorAll("select"), ...contentEl.querySelectorAll("input")].map((el) => el.getAttribute("aria-label")).filter(Boolean);
    for (const expected of ["Rôle du premier niveau", "Numérotation chapitres", "Renuméroter les titres", "Préfixe de numérotation", "Titres des parties", "Titres des chapitres"]) {
      assert.ok(ariaLabels.includes(expected), `libellé Structure présent : ${expected}`);
    }
    assert.ok(ariaLabels.includes("Numérotation scènes"), "Numérotation scènes interpolé");
    assert.ok(ariaLabels.includes("Titres des scènes"), "Titres des scènes interpolé");
    assert.equal(ariaLabels.includes("Rôle des dossiers de premier niveau"), false, "ancien libellé disparu");
    assert.equal(ariaLabels.includes("Renumérotation automatique des titres"), false, "ancien libellé disparu");
    assert.equal(ariaLabels.includes("Insérer les titres des parties"), false, "ancien libellé disparu");
  } finally {
    restoreDom();
  }
});

test("Structure : aucune ligne ne porte la classe compacte du LayoutEditor (100 % responsive)", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    openCompositionRow(contentEl, "Le manuscrit");
    await view.renderPromise;
    openCompositionRow(contentEl, "Structure du manuscrit");
    await view.renderPromise;

    assert.equal(contentEl.querySelector(".feuillets-setting-compact"), null, "aucun Setting compact dans Structure");
  } finally {
    restoreDom();
  }
});

/** Bloc de règles d'un sélecteur exact, tel qu'écrit dans styles.css. */
function ruleBlock(css, selector) {
  const index = css.indexOf(`\n${selector} {`);
  assert.ok(index >= 0, `règle ${selector} absente de styles.css`);
  const start = css.indexOf("{", index);
  return css.slice(start + 1, css.indexOf("}", start));
}
