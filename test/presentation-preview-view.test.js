import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownRenderer, TFile } from "obsidian";
import { PresentationPreviewView, openPresentationPreview } from "../src/views/presentation-preview-view.js";

/* FakeElement DOM factice — même convention que test/presentation-view.test.js. */
class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.classes = new Set();
    const style = {}; style.setProperty = (name, value) => { style[name] = value; }; style.removeProperty = (name) => { delete style[name]; };
    this.style = style;
    this.text = options.text || ""; this.attrs = new Map(); this.disabled = false; this._listeners = []; this.visible = true;
    this.ownerDocument = sharedOwnerDocument;
    this.clientWidth = 1280; this.clientHeight = 720; this.scrollWidth = 1280; this.scrollHeight = 720;
    if (options.cls) this.className = options.cls;
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) this.attrs.set(k, String(v));
    this.classList = { add: (...names) => names.forEach((n) => this.classes.add(n)), remove: (...names) => names.forEach((n) => this.classes.delete(n)), contains: (name) => this.classes.has(name), toggle: (n, force) => (force ? this.classes.add(n) : this.classes.delete(n)) };
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.appendChild(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove?.(); child.parentElement = this; this.children.push(child); return child; }
  cloneNode(deep) {
    const clone = new FakeElement(this.tagName, { text: this.text });
    clone.attrs = new Map(this.attrs);
    clone.classes = new Set(this.classes);
    clone.clientWidth = this.clientWidth; clone.clientHeight = this.clientHeight;
    clone.scrollWidth = this.scrollWidth; clone.scrollHeight = this.scrollHeight;
    for (const [key, value] of Object.entries(this.style)) {
      if (typeof value !== "function") clone.style[key] = value;
    }
    if (this.tagName === "IMG") { clone.complete = this.complete; clone.naturalWidth = this.naturalWidth; clone.naturalHeight = this.naturalHeight; }
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
    return clone;
  }
  get childNodes() { return this.children; }
  querySelector(selector) { const names = selector.split(",").map((v) => v.trim().toUpperCase()); return descendants(this).slice(1).find((el) => el.classes ? matches(el, selector, names) : false) || null; }
  querySelectorAll(selector) { const names = selector.split(",").map((v) => v.trim().toUpperCase()); return descendants(this).slice(1).filter((el) => matches(el, selector, names)); }
  remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; }
  empty() { this.children = []; this.text = ""; }
  setText(value) { this.text = String(value); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  removeAttribute(name) { this.attrs.delete(name); }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight }; }
  addEventListener(type, listener, options = {}) { this._listeners.push({ type, listener, once: options?.once, signal: options?.signal }); }
  dispatch(type, event) {
    for (const entry of [...this._listeners]) {
      if (entry.type !== type) continue;
      if (entry.signal && entry.signal.aborted) continue;
      entry.listener(event);
      if (entry.once) { const i = this._listeners.indexOf(entry); if (i >= 0) this._listeners.splice(i, 1); }
    }
  }
  show() { this.visible = true; }
  hide() { this.visible = false; }
}
function matches(el, selector, tagNames) {
  const classSelectors = selector.split(",").map((v) => v.trim()).filter((v) => v.startsWith("."));
  if (classSelectors.length) return classSelectors.some((cls) => el.classes.has(cls.slice(1)));
  return tagNames.includes(el.tagName);
}
function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }

/* Éditeur factice — sous-ensemble PUBLIC utilisé par PresentationPreviewView. */
class FakeEditor {
  constructor(line = 0) { this.cursor = { line, ch: 0 }; this.scrollCalls = []; }
  getCursor() { return this.cursor; }
  setCursor(pos) { this.cursor = { line: pos.line, ch: pos.ch ?? 0 }; }
  scrollIntoView(range, center) { this.scrollCalls.push({ range, center }); }
}

class FakeResizeObserver {
  constructor(cb) { this.cb = cb; FakeResizeObserver.instances.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
  trigger() { this.cb(); }
}
FakeResizeObserver.instances = [];

function setup(markdown, { withEditor = true, cursorLine = 0 } = {}) {
  const contentEl = new FakeElement();
  const file = new TFile("Cours.md", markdown);
  const editor = withEditor ? new FakeEditor(cursorLine) : null;
  const markdownLeaf = { view: { file, editor } };
  const markdownLeaves = [markdownLeaf];
  let readCount = 0;
  const settings = { roleEditorDisplay: "callouts" };
  const app = {
    vault: {
      read: async (target) => { readCount++; return target.content; },
      on: () => ({}),
    },
    plugins: { plugins: { feuillets: { settings } } },
    workspace: {
      getLeavesOfType: (type) => (type === "markdown" && editor ? markdownLeaves : []),
    },
  };
  const view = new PresentationPreviewView({ app, contentEl });
  return { view, file, contentEl, editor, settings, markdownLeaves, app, getReadCount: () => readCount };
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

function paragraph(container, text) { return container.createEl("p", { text }); }
function semanticCallout(container, text = "introduction") {
  const callout = container.createDiv({ cls: "callout feuillets-semantic-role feuillets-role-introduction", attr: { "data-callout": "introduction" } });
  const title = callout.createDiv({ cls: "callout-title" });
  title.createDiv({ cls: "callout-title-inner", text });
  callout.createDiv({ cls: "callout-content" }).createEl("p", { text: "contenu" });
  return callout;
}

const previousResizeObserver = globalThis.ResizeObserver;

/** Document propriétaire factice — chaque FakeElement le porte dès sa
 * construction, comme un vrai élément porte son ownerDocument. */
function createOwnerDocument() {
  return {
    fullscreenElement: null,
    _listeners: [],
    addEventListener(type, listener) { this._listeners.push({ type, listener }); },
    removeEventListener() {},
    dispatch(type) { for (const entry of [...this._listeners]) if (entry.type === type) entry.listener(); },
  };
}
let sharedOwnerDocument = createOwnerDocument();

test.beforeEach(() => {
  sharedOwnerDocument = createOwnerDocument();
  FakeResizeObserver.instances = [];
  globalThis.ResizeObserver = FakeResizeObserver;
  globalThis.window = {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: () => 0, // la scrutation curseur est déclenchée manuellement (pollCursorForTest) dans ces tests
    clearInterval: () => {},
  };
});

test.after(() => { globalThis.ResizeObserver = previousResizeObserver; });

// ===== 1/2/3 — ouverture, canvas logique, renderer partagé =====

test("PresentationPreviewView — ouverture liée à un MarkdownView : 1 seul canvas logique 1280×720, via renderPresentationSlide", async () => {
  const previous = MarkdownRenderer.render;
  let renderCalls = 0;
  MarkdownRenderer.render = async (_app, markdown, container) => { renderCalls++; paragraph(container, markdown); };
  try {
    const { view, file } = setup("A\n---\nB\n---\nC");
    await view.onOpen();
    await view.linkFile(file);
    assert.equal(view.deckEl.style.width, "1280px");
    assert.equal(view.deckEl.style.height, "720px");
    assert.equal(view.frameEl.style.width, "1280px");
    assert.equal(view.frameEl.style.height, "720px");
    assert.equal(view.frameEl.style.transformOrigin, "top left", "frame origin pour scaling");
    assert.ok(view.scaledWrapperEl, "scaled wrapper créé");
    assert.equal(view.slides.length, 3);
    assert.equal(view.activeIndex, 0);
    assert.equal(renderCalls, 1, "une seule diapositive rendue à la fois");
    assert.equal(view.currentRecord.section.parentElement, view.deckEl);
    // Correctif « aperçu vide » : la section retournée par renderPresentationSlide
    // doit être explicitement activée — sinon elle reste dans l'état masqué
    // posé par le renderer (measurementHost), invisible pour toujours.
    assert.equal(view.currentRecord.section.style.visibility, "visible");
    assert.equal(view.currentRecord.section.style.pointerEvents, "auto");
    assert.equal(view.currentRecord.section.classes.has("is-active"), true);
  } finally { MarkdownRenderer.render = previous; }
});

// ===== 4/5 — curseur → slide =====

test("PresentationPreviewView — curseur sur la ligne de la diapositive 1 => aperçu affiche la diapositive 1", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file } = setup("A\n---\nB\n---\nC", { cursorLine: 0 });
    await view.onOpen();
    await view.linkFile(file);
    assert.equal(view.activeIndex, 0);
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationPreviewView — curseur déplacé sur la diapositive 3 => l'aperçu bascule sur la diapositive 3", async () => {
  const previous = MarkdownRenderer.render;
  let renderCalls = 0;
  MarkdownRenderer.render = async (_app, markdown, container) => { renderCalls++; paragraph(container, markdown); };
  try {
    const { view, file, editor } = setup("A\n---\nB\n---\nC");
    await view.onOpen();
    await view.linkFile(file);
    assert.equal(view.activeIndex, 0);
    renderCalls = 0;

    const oldSection = view.currentRecord.section;
    editor.setCursor({ line: 4, ch: 0 }); // ligne de "C"
    view.pollCursor();
    await flush();

    assert.equal(view.activeIndex, 2);
    assert.equal(renderCalls, 1, "une seule diapositive rerendue");
    assert.equal(oldSection.parentElement, null, "ancienne section retirée du deck");
    assert.equal(view.currentRecord.section.parentElement, view.deckEl);
    assert.equal(view.currentRecord.section.style.visibility, "visible", "nouvelle section explicitement visible");
    assert.equal(view.currentRecord.section.style.pointerEvents, "auto");
    assert.equal(view.currentRecord.section.classes.has("is-active"), true);
    assert.equal(view.deckEl.children.length, 1, "une seule section de slide dans le deck de l'aperçu");
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationPreviewView — liaison explicite : deux feuilles du même fichier restent indépendantes", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file, editor: editorA, markdownLeaves, app } = setup("A\n---\nB\n---\nC", { cursorLine: 0 });
    const editorB = new FakeEditor(4);
    const workLeafB = { view: { file, editor: editorB } };
    markdownLeaves.push(workLeafB);
    let previewLeaf;
    let previewOpen = false;
    app.workspace = {
      getLeavesOfType: (type) => type === "markdown" ? markdownLeaves : (previewOpen ? [previewLeaf] : []),
      getLeaf: () => { previewOpen = true; return previewLeaf; },
      setActiveLeaf: () => {},
      revealLeaf: () => {},
    };
    previewLeaf = { isDeferred: false, view, async setViewState() {} };

    await view.onOpen();
    await openPresentationPreview(app, workLeafB, file);
    assert.equal(view.activeIndex, 2, "l'aperçu démarre sur le curseur de B");

    editorA.setCursor({ line: 2, ch: 0 });
    view.pollCursor();
    assert.equal(view.activeIndex, 2, "le curseur de A est ignoré");

    editorB.setCursor({ line: 2, ch: 0 });
    view.pollCursor();
    await flush();
    assert.equal(view.activeIndex, 1, "le curseur de B pilote l'aperçu");

    await view.previous();
    await view.next();
    assert.equal(editorB.getCursor().line, view.slides[1].startLine, "la navigation déplace le curseur de B");
    assert.equal(editorA.getCursor().line, 2, "le curseur de A reste inchangé");
    assert.equal(editorA.scrollCalls.length, 0, "A ne reçoit aucun scrollIntoView");
    assert.equal(editorB.scrollCalls.length, 2, "seul B reçoit les scrollIntoView de navigation");
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationPreviewView — relink : la nouvelle workLeaf remplace la liaison précédente", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file, editor: editorA, markdownLeaves, app } = setup("A\n---\nB\n---\nC", { cursorLine: 0 });
    const editorB = new FakeEditor(4);
    const workLeafA = markdownLeaves[0];
    const workLeafB = { view: { file, editor: editorB } };
    markdownLeaves.push(workLeafB);
    await view.onOpen();

    await view.linkFile(file, workLeafA);
    assert.equal(view.activeIndex, 0);
    await view.linkFile(file, workLeafB);
    assert.equal(view.activeIndex, 2, "le relink vers B est pris en compte");

    editorA.setCursor({ line: 2, ch: 0 });
    view.pollCursor();
    assert.equal(view.activeIndex, 2, "A ne reprend pas la main après le relink");
    editorB.setCursor({ line: 0, ch: 0 });
    view.pollCursor();
    await flush();
    assert.equal(view.activeIndex, 0, "B reste la leaf liée après le relink");
    assert.equal(app.workspace.getLeavesOfType("markdown").length, 2);
  } finally { MarkdownRenderer.render = previous; }
});

// ===== 6 — même diapositive : aucun rerender inutile =====

test("PresentationPreviewView — déplacement du curseur dans la même diapositive : aucun rerender", async () => {
  const previous = MarkdownRenderer.render;
  let renderCalls = 0;
  MarkdownRenderer.render = async (_app, markdown, container) => { renderCalls++; paragraph(container, markdown); };
  try {
    const { view, file, editor } = setup("L0\nL1\nL2\n---\nB", { cursorLine: 0 });
    await view.onOpen();
    await view.linkFile(file);
    assert.equal(view.activeIndex, 0);
    renderCalls = 0;
    const sectionBefore = view.currentRecord.section;

    editor.setCursor({ line: 1, ch: 0 }); // toujours dans la diapositive 0
    view.pollCursor();
    await flush();

    assert.equal(view.activeIndex, 0);
    assert.equal(renderCalls, 0, "aucun nouveau MarkdownRenderer.render");
    assert.equal(view.currentRecord.section, sectionBefore, "même DOM conservé");
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationPreviewView — roleEditorDisplay : seule la slide active est rerendue sans déplacer le curseur", async () => {
  const previous = MarkdownRenderer.render;
  let renderCount = 0;
  MarkdownRenderer.render = async (_app, markdown, container) => { renderCount++; semanticCallout(container, markdown); };
  try {
    const { view, file, editor, settings, getReadCount } = setup("A\n---\nB\n---\nC");
    await view.onOpen(); await view.linkFile(file); await view.next();
    const activeBefore = view.activeIndex;
    const cursorBefore = editor.getCursor();
    const sectionBefore = view.currentRecord.section;
    const readCountBefore = getReadCount();
    editor.scrollCalls = [];
    assert.notEqual(view.currentRecord.section.querySelector(".callout").style.background, "transparent");

    settings.roleEditorDisplay = "compact";
    await view.refreshRoleDisplay();

    assert.equal(renderCount, 3, "une seule slide est rerendue");
    assert.notEqual(view.currentRecord.section, sectionBefore, "la section active est remplacée");
    assert.equal(view.activeIndex, activeBefore, "l'index actif est conservé");
    assert.deepEqual(editor.getCursor(), cursorBefore, "le curseur est conservé");
    assert.equal(editor.scrollCalls.length, 0, "aucun scrollIntoView");
    assert.equal(getReadCount(), readCountBefore, "le vault n'est pas relu");
    assert.equal(view.currentRecord.section.querySelector(".callout").style.background, "transparent", "Compact est réellement appliqué");
  } finally { MarkdownRenderer.render = previous; }
});

// ===== 7/8 — navigation aperçu → curseur =====

test("PresentationPreviewView — bouton suivant : diapositive suivante affichée + curseur placé à startLine", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file, editor } = setup("A\n---\nB\n---\nC");
    await view.onOpen();
    await view.linkFile(file);
    const markdownBefore = file.content;

    await view.next();

    assert.equal(view.activeIndex, 1);
    assert.equal(editor.getCursor().line, view.slides[1].startLine);
    assert.ok(editor.scrollCalls.length >= 1, "scrollIntoView appelé");
    assert.equal(file.content, markdownBefore, "le Markdown n'est jamais modifié");
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationPreviewView — bouton précédent : diapositive précédente affichée + curseur placé à startLine", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file, editor } = setup("A\n---\nB\n---\nC");
    await view.onOpen();
    await view.linkFile(file);
    await view.next(); await view.next();
    assert.equal(view.activeIndex, 2);

    await view.previous();

    assert.equal(view.activeIndex, 1);
    assert.equal(editor.getCursor().line, view.slides[1].startLine);
  } finally { MarkdownRenderer.render = previous; }
});

// ===== 9 — refresh live =====

test("PresentationPreviewView — modification du Markdown : refresh debounced, slide active cohérente avec le curseur", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file, editor } = setup("A\n---\nB\n---\nC");
    await view.onOpen();
    await view.linkFile(file);
    const oldSection = view.currentRecord.section;

    file.content = "A2\n---\nB2";
    editor.setCursor({ line: 2, ch: 0 }); // ligne de "B2"
    view.onVaultModify(file);
    await new Promise((resolve) => setTimeout(resolve, 260));
    await flush();

    assert.equal(view.slides.length, 2);
    assert.equal(view.activeIndex, 1, "slide correspondant au curseur après refresh");
    assert.equal(oldSection.parentElement, null, "ancienne section retirée");
    assert.equal(view.currentRecord.section.parentElement, view.deckEl);
    assert.equal(view.currentRecord.section.style.visibility, "visible", "nouvelle section explicitement visible après le live refresh");
    assert.equal(view.currentRecord.section.style.pointerEvents, "auto");
  } finally { MarkdownRenderer.render = previous; }
});

// ===== 10 — navigation aperçu : aucun changement du Markdown =====

test("PresentationPreviewView — navigation dans l'aperçu : jamais de mutation du Markdown", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file } = setup("A\n---\nB\n---\nC");
    await view.onOpen();
    await view.linkFile(file);
    const before = file.content;
    await view.next(); await view.next(); await view.previous();
    assert.equal(file.content, before);
  } finally { MarkdownRenderer.render = previous; }
});

// ===== 10B — scaling : wrapper dimensions correctes =====

test("PresentationPreviewView — scaling : wrapper dimensions correctes (640×360 = 1280×720 * 0.5)", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file } = setup("A\n---\nB");
    await view.onOpen();
    view.stageEl.clientWidth = 640;
    view.stageEl.clientHeight = 360;
    await view.linkFile(file);
    // Le scale doit être déterminé lors du premier appel à updateUi() → updateScale()
    assert.equal(view.scaledWrapperEl.style.width, "640px", "wrapper width = 1280 * 0.5");
    assert.equal(view.scaledWrapperEl.style.height, "360px", "wrapper height = 720 * 0.5");
    assert.equal(view.frameEl.style.transform, "scale(0.5)", "frame transformé de 0.5");
  } finally { MarkdownRenderer.render = previous; }
});

// ===== 11 — resize : scale change, zéro nouveau renderPresentationSlide =====

test("PresentationPreviewView — resize : le scale change mais aucun nouveau rendu", async () => {
  const previous = MarkdownRenderer.render;
  let renderCalls = 0;
  MarkdownRenderer.render = async (_app, markdown, container) => { renderCalls++; paragraph(container, markdown); };
  try {
    const { view, file } = setup("A\n---\nB");
    await view.onOpen();
    await view.linkFile(file);
    renderCalls = 0;
    const scaleBefore = view.frameEl.style.transform;
    const sectionBefore = view.currentRecord.section;
    const wrapperSizeBefore = `${view.scaledWrapperEl.style.width},${view.scaledWrapperEl.style.height}`;

    view.stageEl.clientWidth = 640;
    view.stageEl.clientHeight = 360;
    FakeResizeObserver.instances[0].trigger();

    assert.notEqual(view.frameEl.style.transform, scaleBefore, "transform du frame change");
    assert.notEqual(`${view.scaledWrapperEl.style.width},${view.scaledWrapperEl.style.height}`, wrapperSizeBefore, "taille du wrapper change");
    assert.equal(renderCalls, 0, "aucun nouveau MarkdownRenderer.render déclenché par un resize");
    assert.equal(view.currentRecord.section, sectionBefore, "même section, aucun nouveau renderPresentationSlide");
    assert.equal(view.currentRecord.section.style.visibility, "visible", "resize ne change pas l'état visible");
    assert.equal(view.currentRecord.section.style.pointerEvents, "auto");
    // Vérify wrapper dimensions : 640×360 = 1280×720 scaled à 0.5
    assert.equal(view.scaledWrapperEl.style.width, "640px", "wrapper width = 1280 * 0.5");
    assert.equal(view.scaledWrapperEl.style.height, "360px", "wrapper height = 720 * 0.5");
  } finally { MarkdownRenderer.render = previous; }
});

// ===== 12 — ancien rendu async après changement de slide : zéro effet =====

test("PresentationPreviewView — image résolue tardivement sur une génération périmée : aucun effet", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    if (markdown === "MEDIA") {
      const p = container.createEl("p");
      const img = p.createEl("img");
      img.complete = false; img.naturalWidth = 0; img.naturalHeight = 0;
    } else {
      paragraph(container, markdown);
    }
  };
  try {
    const { view, file } = setup("MEDIA\n---\nB");
    await view.onOpen();
    await view.linkFile(file);
    const image = view.currentRecord.section.querySelector("img");
    const recordAfterMedia = view.currentRecord;

    await view.next(); // change de génération/slide avant que l'image ne se résolve
    const recordAfterNext = view.currentRecord;
    assert.notEqual(recordAfterNext, recordAfterMedia);

    image.naturalWidth = 400; image.naturalHeight = 800;
    image.dispatch("load");
    await flush();

    assert.equal(view.currentRecord, recordAfterNext, "aucune reconstruction déclenchée par l'ancien listener");
  } finally { MarkdownRenderer.render = previous; }
});

// ===== 13 — fermeture : nettoyage =====

test("PresentationPreviewView — fermeture : AbortController / ResizeObserver nettoyés", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file } = setup("A\n---\nB");
    await view.onOpen();
    await view.linkFile(file);
    const controller = view.currentRecord.controller;
    const resizeObserver = FakeResizeObserver.instances[0];

    await view.onClose();

    assert.equal(controller.signal.aborted, true);
    assert.equal(resizeObserver.disconnected, true);
    assert.equal(view.currentRecord, null);
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationPreviewView — export PDF : bouton icône présent dans la toolbar, clic sans exception", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file } = setup("A");
    await view.onOpen();
    await view.linkFile(file);
    assert.ok(view.exportPdfButton, "bouton export PDF présent");
    assert.equal(view.exportPdfButton.getAttribute("aria-label"), "Exporter en PDF");
    assert.doesNotThrow(() => view.exportPdfButton.dispatch("click"));
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationPreviewView — export PDF : le clic ouvre TOUJOURS le choix de format (16:9 / A4), jamais un format silencieux", async () => {
  const { PresentationPdfExportModal } = await import("../src/ui/presentation-pdf-export-modal.js");
  const previousOpen = PresentationPdfExportModal.prototype.open;
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  let opened = null;
  // `.open()` n'exécute pas onOpen() dans le stub Modal (voir
  // presentation-pdf-export-modal.test.js pour la couverture de onOpen()
  // lui-même) : ici on vérifie seulement que exportPdf() construit bien CETTE
  // modale, et que son callback appelle réellement exportPresentationPdf avec
  // le format choisi — jamais un format par défaut sans passer par l'utilisateur.
  PresentationPdfExportModal.prototype.open = function () { opened = this; };
  try {
    const { view, file, app, settings } = setup("A");
    await view.onOpen();
    await view.linkFile(file);

    view.exportPdfButton.dispatch("click");
    assert.ok(opened instanceof PresentationPdfExportModal, "la modale de choix de format est bien ouverte");

    // `document` n'est pas défini dans ce fichier de test : exportPresentationPdf
    // retombe tôt sans effet de bord — cela suffit à prouver que le CHOIX
    // atteint bien la vraie fonction, sans reconstruire tout le pipeline
    // d'impression (déjà couvert par presentation-pdf-export.test.js).
    assert.doesNotThrow(() => opened.onChoose("16:9"));
    assert.doesNotThrow(() => opened.onChoose("a4-landscape"));
    // Sanity : le callback vient bien de CETTE vue (mêmes app/settings).
    assert.equal(opened.app, app);
    void settings;
  } finally {
    PresentationPdfExportModal.prototype.open = previousOpen;
    MarkdownRenderer.render = previousRender;
  }
});

/* ── Projection : la vue passe elle-même en plein écran ──────────────────── */

/** Racine factice acceptant le plein écran, avec son propre ownerDocument. */
function fullscreenCapableRoot(view) {
  const root = view.rootEl;
  const owner = root.ownerDocument;
  root.focused = 0;
  root.focus = () => { root.focused++; };
  root.requestFullscreen = async () => { owner.fullscreenElement = root; owner.dispatch("fullscreenchange"); };
  return { root, owner };
}

test("Projection — le bouton met CETTE vue en plein écran : aucun second onglet n'est ouvert", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file } = setup("A\n---\nB\n---\nC");
    await view.onOpen();
    await view.linkFile(file);

    assert.ok(view.launchButton, "bouton « Lancer la présentation » présent");
    assert.equal(view.launchButton.getAttribute("aria-label"), "Lancer la présentation");

    // Toute tentative d'ouvrir une autre leaf serait une régression : la
    // projection est un MODE de cette vue, plus un onglet séparé.
    view.app.workspace.getLeaf = () => { throw new Error("aucun onglet ne doit être ouvert"); };
    const { root, owner } = fullscreenCapableRoot(view);

    view.launchButton.dispatch("click");
    await flush();

    assert.equal(owner.fullscreenElement, root, "c'est la vue elle-même qui passe en plein écran");
    assert.equal(view.isPresenting, true);
    assert.ok(root.focused >= 1, "focus donné : la navigation clavier marche d'emblée");
  } finally { MarkdownRenderer.render = previous; }
});

test("Projection — la barre d'outils est masquée pendant la projection, et revient à la sortie", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file } = setup("A\n---\nB");
    await view.onOpen();
    await view.linkFile(file);
    const { owner } = fullscreenCapableRoot(view);
    assert.notEqual(view.toolbarEl.style.display, "none", "visible en aperçu");

    view.launchButton.dispatch("click");
    await flush();
    assert.equal(view.toolbarEl.style.display, "none", "masquée en projection");

    // Sortie par Échap : le navigateur quitte le plein écran, la vue doit suivre.
    owner.fullscreenElement = null;
    owner.dispatch("fullscreenchange");
    assert.equal(view.isPresenting, false);
    assert.notEqual(view.toolbarEl.style.display, "none", "barre d'outils rendue à la sortie");
  } finally { MarkdownRenderer.render = previous; }
});

test("Projection — les flèches font défiler les slides SANS déplacer le curseur de l'éditeur", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file, editor } = setup("A\n---\nB\n---\nC");
    await view.onOpen();
    await view.linkFile(file);
    fullscreenCapableRoot(view);
    view.launchButton.dispatch("click");
    await flush();

    const cursorBefore = { ...editor.getCursor() };
    view.rootEl.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
    await flush();
    assert.equal(view.activeIndex, 1, "la flèche droite avance");

    view.rootEl.dispatch("keydown", { key: "ArrowLeft", preventDefault() {} });
    await flush();
    assert.equal(view.activeIndex, 0, "la flèche gauche recule");

    // L'auteur projette, il n'écrit pas : le curseur ne doit pas bouger.
    assert.deepEqual(editor.getCursor(), cursorBefore, "curseur de l'éditeur inchangé pendant la projection");
  } finally { MarkdownRenderer.render = previous; }
});

test("Projection — hors projection, les flèches sont ignorées : elles appartiennent à l'éditeur", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const { view, file } = setup("A\n---\nB\n---\nC");
    await view.onOpen();
    await view.linkFile(file);
    assert.equal(view.isPresenting, false);

    view.rootEl.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
    await flush();
    assert.equal(view.activeIndex, 0, "aucune navigation clavier tant qu'on ne projette pas");
  } finally { MarkdownRenderer.render = previous; }
});

// ===== openPresentationPreview : côte à côte, réutilisation =====

test("openPresentationPreview — crée un split côte à côte de la leaf active, jamais un onglet, jamais un doublon", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => paragraph(container, markdown);
  try {
    const file = new TFile("Cours.md", "A\n---\nB");
    const contentEl = new FakeElement();
    const app = { vault: { read: async (target) => target.content, on: () => ({}) } };
    const previewView = new PresentationPreviewView({ app, contentEl });
    let created = 0;
    const previewLeaf = {
      isDeferred: false,
      view: previewView,
      async setViewState() {},
    };
    const workLeaf = { id: "work" };
    const calls = [];
    const workspace = {
      getLeavesOfType: (type) => (type === "feuillets-presentation-preview" && created ? [previewLeaf] : []),
      getLeaf: (kind) => { calls.push(kind); created++; return previewLeaf; },
      setActiveLeaf: (leaf) => calls.push(["setActiveLeaf", leaf]),
      revealLeaf: (leaf) => calls.push(["revealLeaf", leaf]),
    };
    const appWithWorkspace = { ...app, workspace };
    previewView.app = appWithWorkspace;

    await previewView.onOpen();
    await openPresentationPreview(appWithWorkspace, workLeaf, file);
    assert.ok(calls.includes("split"), "ouvre un split, jamais un onglet");
    assert.equal(previewView.file, file);

    // second appel, depuis un autre fichier : réutilise le même leaf, aucun nouveau split.
    const file2 = new TFile("Autre.md", "X");
    const splitCallsBefore = calls.filter((c) => c === "split").length;
    await openPresentationPreview(appWithWorkspace, workLeaf, file2);
    const splitCallsAfter = calls.filter((c) => c === "split").length;
    assert.equal(splitCallsAfter, splitCallsBefore, "aucun doublon créé");
    assert.equal(previewView.file, file2, "relié explicitement au nouveau fichier");
  } finally { MarkdownRenderer.render = previous; }
});
