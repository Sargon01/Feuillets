import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkdownRenderer, TFile, TFolder } from "obsidian";
import { PreviewView } from "../src/views/preview-view.js";
import { createFileScope, createFolderScope, createProjectScope, createSelectionScope } from "../src/services/compile-scope.js";

/* Micro-correctif final — UI Preview liée à Continu :
 *  1. le message « Aucun feuillet du projet n'est ouvert » posé par le
 *     PREMIER rendu automatique (avant que `setCompileScope()` soit posé)
 *     doit être retiré du DOM une fois qu'un rendu de scope RÉUSSIT —
 *     jamais laissé en résidu à côté de l'iframe montée ensuite ;
 *  2. le titre d'onglet (`getDisplayText()`) doit suivre `compileScope`
 *     quand il existe, pas seulement `previewMode` ;
 *  3. `setCompileScope()` doit invalider l'en-tête de la leaf UNE fois par
 *     changement de scope réel, jamais en boucle.
 *
 * Aucun test ici ne touche compileForPreview/readFileForPreview/compile()/
 * scroll/source-map/pagination/hyphenation/templates/export — seul le
 * comportement DOM/UI autour d'un rendu déjà réussi est vérifié. */

/* --------------------------- DOM minimal (fake) --------------------------- */

class FakeStyle {
  constructor() { this._props = new Map(); }
  setProperty(name, value) { this._props.set(name, String(value)); }
  getPropertyValue(name) { return this._props.get(name) ?? ""; }
}

class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.style = new FakeStyle();
    this.classes = new Set();
    this.offsetHeight = 30;
    this.offsetWidth = 30;
    this.clientWidth = 900;
    this.clientHeight = 700;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 0;
    this.scrollWidth = 0;
    this._attributes = new Map();
    this._eventListeners = new Map();
    this.classList = { contains: (name) => this.classes.has(name) };
  }
  addEventListener(type, listener) {
    if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
    this._eventListeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const list = this._eventListeners.get(type);
    if (list) { const idx = list.indexOf(listener); if (idx >= 0) list.splice(idx, 1); }
  }
  dispatch(type, event) {
    const list = this._eventListeners.get(type);
    if (list) [...list].forEach((fn) => fn(event || { target: this }));
  }
  toggleClass(cls, val) {
    if (val === undefined) { if (this.classes.has(cls)) this.classes.delete(cls); else this.classes.add(cls); }
    else if (val) this.classes.add(cls);
    else this.classes.delete(cls);
  }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(value) { this.children = []; this._text = value; }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  addClass(name) { this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  hasClass(name) { return this.classes.has(name); }
  setText(value) { this.textContent = value; }
  setCssStyles(styles) { Object.assign(this.style, styles); }
  getBoundingClientRect() { return { top: 0, left: 0, right: this.offsetWidth, bottom: this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight }; }
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
  prepend(child) { child.remove(); child.parentNode = this; this.children.unshift(child); }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  cloneNode(deep) {
    const clone = new FakeElement(this.tagName, this._text);
    clone.className = this.className;
    for (const [n, v] of this._attributes) clone.setAttribute(n, v);
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
    return clone;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matchesSelector(selector) {
    if (selector.startsWith(".")) return this.classes.has(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matchesSelector && child.matchesSelector(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

function element(tag, text) { return new FakeElement(tag, text); }

function installDom() {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    createEl: globalThis.createEl,
    createDiv: globalThis.createDiv,
    createSpan: globalThis.createSpan,
    getComputedStyle: globalThis.getComputedStyle,
  };
  globalThis.getComputedStyle = () => ({ paddingLeft: "0px", paddingRight: "0px", paddingTop: "0px", paddingBottom: "0px" });
  const body = new FakeElement("body");
  globalThis.document = { body, createElement: (tag) => new FakeElement(tag) };
  const timers = new Map();
  let nextTimerId = 1;
  globalThis.window = {
    setTimeout: (fn) => { const id = nextTimerId++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    requestAnimationFrame: (fn) => { const id = nextTimerId++; timers.set(id, fn); return id; },
    cancelAnimationFrame: (id) => { timers.delete(id); },
  };
  globalThis.createEl = (tag, options = {}) => { const el = new FakeElement(tag, options.text || ""); if (options.cls) el.className = options.cls; return el; };
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
  return {
    restore() {
      globalThis.document = previous.document;
      globalThis.window = previous.window;
      globalThis.createEl = previous.createEl;
      globalThis.createDiv = previous.createDiv;
      globalThis.createSpan = previous.createSpan;
      globalThis.getComputedStyle = previous.getComputedStyle;
    },
  };
}

/* ----------------------------- Fixture projet ----------------------------- */

function buildProject() {
  const manuscript = new TFolder("Manuscrit");
  manuscript.name = "Manuscrit";
  manuscript.path = "Manuscrit";

  const chapterDir = new TFolder("Manuscrit/SUBHANALLAH");
  chapterDir.name = "SUBHANALLAH";
  chapterDir.path = "Manuscrit/SUBHANALLAH";
  chapterDir.parent = manuscript;

  const sceneFile = new TFile("Manuscrit/SUBHANALLAH/01-scene.md", "---\ntitre: Scene 1\n---\nTexte réel de la scène.");
  sceneFile.name = "01-scene.md";
  sceneFile.basename = "01-scene";
  sceneFile.extension = "md";
  sceneFile.path = "Manuscrit/SUBHANALLAH/01-scene.md";
  sceneFile.parent = chapterDir;

  const otherFile = new TFile("Manuscrit/Al-Rahman.md", "---\ntitre: Al-Rahman\n---\nTexte.");
  otherFile.name = "Al-Rahman.md";
  otherFile.basename = "Al-Rahman";
  otherFile.extension = "md";
  otherFile.path = "Manuscrit/Al-Rahman.md";
  otherFile.parent = manuscript;

  chapterDir.children = [sceneFile];
  manuscript.children = [chapterDir, otherFile];

  const app = {
    vault: {
      read: async (f) => (f && typeof f.content === "string" ? f.content : "---\ntitre: Scene 1\n---\nTexte réel de la scène."),
      cachedRead: async (f) => (f && typeof f.content === "string" ? f.content : "---\ntitre: Scene 1\n---\nTexte réel de la scène."),
      getAbstractFileByPath: (p) => {
        const walk = (node) => {
          if (node.path === p) return node;
          for (const child of node.children || []) {
            const found = walk(child);
            if (found) return found;
          }
          return null;
        };
        return walk(manuscript);
      },
    },
    metadataCache: { getFileCache: (f) => ({ frontmatter: f && f._fm ? f._fm : { titre: "Scene 1" } }) },
    fileManager: { processFrontMatter: async () => {} },
    workspace: {
      on: () => ({}),
      getActiveFile: () => null,
      getLeavesOfType: () => [],
      getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
      revealLeaf: () => {},
      setActiveLeaf: () => {},
    },
  };

  const settings = {
    projectFolder: "Manuscrit",
    level1Role: "chapitres",
    exportTemplate: "classique",
    manuscriptTitle: "NEFES",
    manuscriptAuthor: "Auteur Test",
    orders: {},
    folderPositions: {},
  };

  return { app, settings, manuscript, chapterDir, sceneFile, otherFile };
}

/** Ouvre une PreviewView complète (DOM + moteur de rendu), scope-libre —
 * réplique le point de départ réel : `onOpen()` déclenche un premier
 * `refreshPreview()` automatique SANS scope et SANS Markdown actif. */
async function openView() {
  const { app, settings, manuscript, chapterDir, sceneFile, otherFile } = buildProject();
  const plugin = { settings, getProjectFolder: () => manuscript, saveSettings: async () => {} };
  const leaf = { contentEl: element("div") };
  const view = new PreviewView(leaf, plugin);
  view.app = app;

  await view.onOpen();

  const scaledContainer = view.contentEl.querySelector(".feuillets-preview-scaled-container");
  const viewport = view.contentEl.querySelector(".feuillets-preview-viewport");
  if (viewport) { viewport._paddingX = 0; viewport._paddingY = 0; }
  return { view, plugin, app, manuscript, chapterDir, sceneFile, otherFile, scaledContainer };
}

function withRender(fn) {
  return async () => {
    const dom = installDom();
    const previousRender = MarkdownRenderer.render;
    MarkdownRenderer.render = async (_app, markdown, container) => { container.appendChild(element("p", markdown)); };
    try {
      await fn(dom);
    } finally {
      MarkdownRenderer.render = previousRender;
      dom.restore();
    }
  };
}

function fireLoad(el) {
  const frame = el.children.find((c) => c.tagName === "IFRAME");
  if (frame) frame.dispatch("load");
  return frame;
}

/* ============================================================
 * 1. MESSAGE RÉSIDUEL
 * ============================================================ */

test("message résiduel — le premier rendu SANS scope pose « Aucun feuillet… », un rendu de scope réussi le retire", withRender(async () => {
  const { view, manuscript, chapterDir, scaledContainer } = await openView();

  // 1-3. Premier rendu automatique (onOpen), sans scope, aucun Markdown actif.
  assert.equal(view.compileScope, null);
  const messageBefore = scaledContainer.children.find((c) => c.hasClass("feuillets-preview-empty"));
  assert.ok(messageBefore, "le premier rendu doit poser le message « Aucun feuillet du projet n'est ouvert »");
  assert.equal(scaledContainer.children.length, 1, "rien d'autre monté à ce stade");

  // 4-5. setCompileScope(folderScope) : rendu de scope réussi.
  await view.setCompileScope(createFolderScope(manuscript.path, chapterDir.path));
  fireLoad(scaledContainer);

  const stillMessage = scaledContainer.children.find((c) => c.hasClass("feuillets-preview-empty"));
  assert.equal(stillMessage, undefined, "le message initial ne doit plus être attaché au DOM");
  const frame = scaledContainer.children.find((c) => c.tagName === "IFRAME");
  assert.ok(frame, "le rendu valide (iframe) doit être monté");
  assert.equal(view.status, "fresh");
}));

test("message résiduel — un rendu qui échoue réellement garde son propre message affiché", withRender(async () => {
  const { view, manuscript, scaledContainer } = await openView();

  // Portée folder vide (dossier inexistant) : `resolveCompileScopeFiles`
  // renvoie une liste vide → `preview.message.emptyScope`, un VRAI échec de
  // scope, pas une absence de scope.
  await view.setCompileScope(createFolderScope(manuscript.path, "Manuscrit/Introuvable"));

  const message = scaledContainer.children.find((c) => c.hasClass("feuillets-preview-empty"));
  assert.ok(message, "un rendu réellement vide/en erreur doit garder son message visible");
  assert.equal(scaledContainer.children.length, 1, "aucune iframe fantôme à côté d'un message d'erreur légitime");
}));

/* ============================================================
 * 2. TITRES D'ONGLET
 * ============================================================ */

test("getDisplayText — priorité au CompileScope explicite (file/folder/selection/project)", withRender(async () => {
  const { view, manuscript, chapterDir, sceneFile, otherFile } = await openView();

  await view.setCompileScope(createFileScope(manuscript.path, otherFile.path));
  assert.equal(view.getDisplayText(), "Aperçu — Al-Rahman");

  await view.setCompileScope(createFolderScope(manuscript.path, chapterDir.path));
  assert.equal(view.getDisplayText(), "Aperçu — SUBHANALLAH");

  await view.setCompileScope(createSelectionScope(manuscript.path, [sceneFile.path, otherFile.path]));
  assert.equal(view.getDisplayText(), "Aperçu — sélection");

  await view.setCompileScope(createProjectScope(manuscript.path));
  assert.equal(view.getDisplayText(), "Aperçu — manuscrit");
}));

test("getDisplayText — dossier non résolvable : repli sur le dernier segment du chemin", withRender(async () => {
  const { view, manuscript } = await openView();
  await view.setCompileScope(createFolderScope(manuscript.path, "Manuscrit/Fantôme"));
  assert.equal(view.getDisplayText(), "Aperçu — Fantôme");
}));

test("getDisplayText — sans CompileScope, comportement PreviewMode historique inchangé", () => {
  const leaf = { contentEl: element("div") };
  const plugin = { settings: { previewMode: "manuscript" } };
  const view = new PreviewView(leaf, plugin);
  assert.equal(view.getDisplayText(), "Aperçu — manuscrit");

  plugin.settings.previewMode = "scene";
  assert.equal(view.getDisplayText(), "Aperçu — feuillet");
});

/* ============================================================
 * 3. RAFRAÎCHISSEMENT DE L'EN-TÊTE D'ONGLET
 * ============================================================ */

test("setCompileScope — updateHeader() appelé une fois par changement de scope réel", withRender(async () => {
  const { view, manuscript, chapterDir, otherFile } = await openView();
  let updateHeaderCalls = 0;
  view.leaf.updateHeader = () => { updateHeaderCalls++; };

  await view.setCompileScope(createFolderScope(manuscript.path, chapterDir.path));
  assert.equal(updateHeaderCalls, 1);

  await view.setCompileScope(createFileScope(manuscript.path, otherFile.path));
  assert.equal(updateHeaderCalls, 2);
}));

test("setCompileScope — pas d'appel updateHeader() pendant un rafraîchissement live sans changement de scope (onContinuDocumentChanged)", withRender(async () => {
  const { view, manuscript, chapterDir } = await openView();
  const scope = createFolderScope(manuscript.path, chapterDir.path);
  await view.setCompileScope(scope);

  let updateHeaderCalls = 0;
  view.leaf.updateHeader = () => { updateHeaderCalls++; };

  // Un rafraîchissement live du même scope (frappe Continu, scroll, etc.)
  // n'appelle jamais setCompileScope de nouveau : updateHeader() ne doit
  // donc pas être sollicité par refreshPreview() seul.
  await view.refreshPreview();
  assert.equal(updateHeaderCalls, 0);
}));
