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

/* Dernier lot UX avant 2.5, §3-§4 : plus de nav permanente à quatre
 * rubriques — Composition est désormais un SOMMAIRE compact (Manuscrit /
 * Éléments générés / Fin d'ouvrage / Structure), et « Informations » a
 * disparu (§4 : doublon de Première page/métadonnées projet). */
test("EditionCompositionContent : plus de nav permanente Contenu/Structure/Notes/Informations", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);

    await view.render();

    assert.equal(contentEl.querySelector(".feuillets-section-title-text"), null, "pas d'en-tête repliable — le composant est toujours intégré");
    assert.equal(contentEl.querySelectorAll(".feuillets-composition-nav-item").length, 0, "plus de nav permanente à onglets");
    assert.equal(contentEl.querySelector('[aria-label="Informations"]'), null, "Informations a disparu (§4)");
    assert.equal(contentEl.textContent.includes("Informations"), false, "Informations n'apparaît nulle part dans le sommaire");

    assert.deepEqual(
      contentEl.querySelectorAll(".feuillets-edition-group-label").map((node) => node.textContent),
      ["Manuscrit", "Éléments générés", "Fin d’ouvrage", "Structure"]
    );
    for (const label of ["Contenu du manuscrit", "Première page", "Pages liminaires", "Sommaire", "Table des matières", "Tables", "Bibliographie", "Annexes", "Structure du manuscrit"]) {
      assert.ok(contentEl.textContent.includes(label), `${label} est présent dans le sommaire`);
    }
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : Composition reste la section principale ; sommaire compact, une seule ligne Setting native par entrée", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);

    await view.render();

    assert.ok(contentEl.querySelector(".feuillets-composition-body"), "utilise le conteneur de sommaire dédié");

    // Plus aucun <details>/<summary> ni accordéon "Première page" ouvert au
    // milieu du sommaire (§3).
    assert.equal(contentEl.querySelectorAll("details").length, 0);
    assert.equal(contentEl.querySelectorAll("summary").length, 0);
    assert.equal(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), null, "le contenu de Première page n'apparaît pas dans le sommaire");
    assert.equal(contentEl.querySelector('[aria-label="Renuméroter les notes dans le document compilé"]'), null, "le contenu de Structure n'apparaît pas dans le sommaire");

    // Sommaire / Table des matières / Tables / Bibliographie / Annexes :
    // chacune un seul toggle natif, wiré à la persistance réelle.
    const checkboxes = contentEl.querySelectorAll("input")
      .filter((node) => (node.getAttribute("aria-label") || "").startsWith("Inclure "));
    assert.equal(checkboxes.length, 5, "une case par élément généré");

    // Annexes porte en plus un bouton compact (Créer le dossier Annexes).
    assert.ok(contentEl.querySelector('[aria-label="Créer le dossier Annexes"]'));

    // Basculer le toggle Sommaire persiste réellement l'inclusion — même
    // mécanisme qu'avant (setIncluded → writeGeneratedIncluded).
    const summaryCheckbox = contentEl.querySelector('[aria-label="Inclure le sommaire"]');
    summaryCheckbox.checked = true;
    summaryCheckbox.dispatch("change");
    await Promise.resolve();
    const meta = plugin.settings.projectMeta[plugin.getProjectFolder().path];
    assert.ok(meta, "le basculement écrit bien dans ProjectMeta");
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : sous-page Première page — CONTENU (FirstPagePanel) + PRÉSENTATION (LayoutEditor), retour au sommaire", async () => {
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

    const firstPageRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Première page"));
    firstPageRow.click();
    await view.renderPromise;

    // §6 : sous-page dédiée, jamais un accordéon au milieu du sommaire —
    // le sommaire lui-même a disparu, remplacé par ‹ Composition + le titre.
    assert.equal(contentEl.querySelectorAll(".feuillets-composition-nav-item").length, 0);
    assert.ok(contentEl.querySelector(".feuillets-composition-back"), "bouton de retour vers Composition");
    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title").textContent.includes("Première page"));

    // CONTENU (FirstPagePanel réutilisé, pas dupliqué).
    assert.ok(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), "FirstPagePanel est bien monté, pas une coquille vide");
    // PRÉSENTATION (LayoutEditor.renderStandaloneFirstPage réutilisé) —
    // Setting natif (pas de aria-label propre, voir stub Setting.addToggle),
    // vérifié via le texte affiché.
    for (const label of ["Masquer en-tête et pied", "Position du numéro"]) {
      assert.ok(contentEl.textContent.includes(label), `${label} présent (contrôles de présentation ExportTemplateV2 réutilisés)`);
    }

    assert.equal(leafCalls, 0, "aucune leaf créée par la seule navigation");
    assert.equal(changeCalls, 0, "aucun callback métier déclenché par la seule navigation");

    contentEl.querySelector(".feuillets-composition-back").click();
    await view.renderPromise;
    assert.equal(contentEl.querySelector('[aria-label="Inclure la page de titre"]'), null, "retour au sommaire : la sous-page est démontée");
    assert.ok([...contentEl.querySelectorAll(".feuillets-project-row")].some((row) => row.textContent.includes("Première page")), "la ligne-résumé Première page est de retour");
  } finally {
    restoreDom();
  }
});

test("EditionCompositionContent : sous-page Structure — Séparateur/presets + Notes de bas de page, retour au sommaire", async () => {
  const restoreDom = installDom();
  try {
    const { app, plugin } = buildPlugin();
    const contentEl = new FakeElement("div");
    const view = new EditionCompositionContent(app, plugin, contentEl);
    await view.render();

    const structureRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Structure du manuscrit"));
    structureRow.click();
    await view.renderPromise;

    assert.ok(contentEl.querySelector(".feuillets-composition-subpage-title").textContent.includes("Structure du manuscrit"));
    for (const label of ["Séparateur", "Presets de compilation", "Ajouter un preset"]) {
      assert.ok(contentEl.textContent.includes(label), `${label} présent dans la sous-page Structure`);
    }
    // §5 : "Notes de bas de page" est désormais EN BAS de Structure, ce
    // n'est plus une rubrique séparée.
    assert.deepEqual(
      contentEl.querySelectorAll(".feuillets-edition-group-label").map((node) => node.textContent).slice(-1),
      ["Notes de bas de page"]
    );
    assert.ok(contentEl.querySelector('[aria-label="Renuméroter les notes dans le document compilé"]'));

    contentEl.querySelector(".feuillets-composition-back").click();
    await view.renderPromise;
    assert.equal(contentEl.querySelector('[aria-label="Renuméroter les notes dans le document compilé"]'), null, "retour au sommaire : la sous-page est démontée");
  } finally {
    restoreDom();
  }
});

/* §9 du dernier lot UX avant 2.5 : un changement de réglage Structure peut
 * rafraîchir le Binder, mais ne doit JAMAIS reconstruire la surface
 * Composition active — ni sa sous-page, ni sa position de défilement. Avant
 * le correctif, saveAndRefresh appelait plugin.refreshView() (→
 * renderAllViews() → reconstruction globale, y compris cette même
 * sous-page) ; il appelle désormais plugin.refreshBinderViews(), qui ne
 * touche jamais VIEW_BOARD (voir main.ts). */
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

    const structureRow = [...contentEl.querySelectorAll(".feuillets-project-row")].find((row) => row.textContent.includes("Structure du manuscrit"));
    structureRow.click();
    await view.renderPromise;

    // Repère de la sous-page actuellement montée (un nœud DOM précis) :
    // s'il survit à l'identique après le changement de réglage, la
    // sous-page n'a pas été reconstruite.
    const subpageTitleBefore = contentEl.querySelector(".feuillets-composition-subpage-title");

    const level1RoleSelect = [...contentEl.querySelectorAll("select")].find((select) => select.getAttribute("aria-label") === "Rôle des dossiers de premier niveau");
    assert.ok(level1RoleSelect, "le sélecteur de rôle de niveau 1 est bien dans la sous-page Structure");
    level1RoleSelect.value = "parties";
    level1RoleSelect.dispatch("change");
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(plugin.settings.level1Role, "parties", "le réglage est bien sauvegardé");
    assert.equal(refreshBinderCalls, 1, "refreshBinderViews est appelé");
    assert.equal(refreshViewCalls, 0, "refreshView (→ renderAllViews global) n'est JAMAIS appelé");
    assert.equal(renderAllViewsCalls, 0, "renderAllViews n'est jamais appelé directement non plus");
    assert.equal(contentEl.querySelector(".feuillets-composition-subpage-title"), subpageTitleBefore, "la sous-page Structure n'a pas été reconstruite (même nœud DOM)");
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
