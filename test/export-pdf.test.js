import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkdownRenderer, Notice, Platform } from "obsidian";
import { exportPdf, paginateManuscript } from "../src/services/export-pdf.js";

let activeFrames = null;

class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.classes = new Set();
    this.offsetHeight = 30;
    this.classList = { contains: (name) => this.classes.has(name) };
    this._attributes = new Map();
    // Une <iframe> (créée via document.createElement OU document.body.createEl,
    // voir export-pdf.js) porte son propre document/window isolés, comme dans
    // un vrai navigateur.
    if (this.tagName === "IFRAME") {
      this.contentDocument = createFakeIframeDocument();
      this.contentWindow = { focused: 0, printed: 0, focus() { this.focused++; }, print() { this.printed++; } };
      if (activeFrames) activeFrames.push(this);
    }
  }

  get textContent() { return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text; }
  set textContent(value) { this.children = []; this._text = value; }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._rawHtml !== undefined ? this._rawHtml : (this.children.length ? this.children.map((child) => child.outerHTML).join("") : this._text); }
  set innerHTML(value) { this._rawHtml = value; this.children = []; }
  get outerHTML() {
    const classAttr = this.classes.size ? ` class="${this.className}"` : "";
    return `<${this.tagName.toLowerCase()}${classAttr}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  get firstChild() { return this.children[0] || null; }
  addClass(name) { this.classes.add(name); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options.text || ""); if (options.cls) child.className = options.cls; return this.appendChild(child); }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  prepend(child) { child.remove(); child.parentNode = this; this.children.unshift(child); }
  after(child) { const parent = this.parentNode; const index = parent.children.indexOf(this); child.remove(); child.parentNode = parent; parent.children.splice(index + 1, 0, child); }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) { this.children.splice(index, 1); child.parentNode = null; } return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  cloneNode(deep) { const clone = new FakeElement(this.tagName, this._text); clone.className = this.className; clone.offsetHeight = this.offsetHeight; if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true)); return clone; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

// Document isolé de l'iframe d'impression — reflète la structure minimale
// (html > head, body) qu'un vrai navigateur fournit après doc.open(),
// sans document.write (voir export-pdf.js).
function createFakeIframeDocument() {
  const documentElement = new FakeElement("html");
  const head = new FakeElement("head");
  const body = new FakeElement("body");
  documentElement.appendChild(head);
  documentElement.appendChild(body);
  return {
    documentElement,
    head,
    body,
    createElement: (tag) => new FakeElement(tag),
    open() {},
    close() {},
  };
}

class RawNode extends FakeElement {
  constructor(html) { super("span"); this.html = html; }
  get outerHTML() { return this.html; }
  cloneNode() { return new RawNode(this.html); }
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousParser = globalThis.DOMParser;
  const previousWindow = globalThis.window;
  const previousCreateEl = globalThis.createEl;
  const previousCreateDiv = globalThis.createDiv;
  const previousCreateSpan = globalThis.createSpan;
  const body = new FakeElement("body");
  body.contains = (node) => body.children.includes(node);
  const frames = [];
  activeFrames = frames;
  const document = {
    body,
    createElement(tag) { return new FakeElement(tag); },
  };
  globalThis.document = document;
  globalThis.DOMParser = class { parseFromString(html) { const bodyEl = new FakeElement("body"); bodyEl.appendChild(new RawNode(html)); return { body: bodyEl }; } };
  globalThis.window = { setTimeout(callback) { callback(); return 0; } };
  // Fonctions globales autonomes createEl/createDiv/createSpan d'Obsidian
  // (nœud détaché, non ajouté à un parent) — voir export-pdf.js.
  globalThis.createEl = (tag, options = {}) => { const el = new FakeElement(tag, options.text || ""); if (options.cls) el.className = options.cls; return el; };
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
  return {
    body,
    frames,
    restore() {
      globalThis.document = previousDocument;
      globalThis.DOMParser = previousParser;
      globalThis.window = previousWindow;
      globalThis.createEl = previousCreateEl;
      globalThis.createDiv = previousCreateDiv;
      globalThis.createSpan = previousCreateSpan;
      activeFrames = null;
    },
  };
}

function element(tag, text, height = 30) { const el = new FakeElement(tag, text); el.offsetHeight = height; return el; }

const template = { fontFamily: "Serif", fontSizePt: 12, lineHeight: 1.5, pageOrientation: "portrait", key: "classique", label: "Classique" };

test("paginateManuscript : isole titres et pages Front, nettoie la mesure et rend options de page", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(element("p", "Avant", 100));
    container.appendChild(element("h2", "Chapitre", 100));
    const front = element("div", "Dédicace", 100); front.addClass("feuillets-frontpage"); container.appendChild(front);
    container.appendChild(element("p", "Après", 100));
    const settings = { pdfMirrorMargins: true, pdfMarginLeft: 1, pdfMarginRight: 3, pdfDiffHeaders: true, pdfHideFirstPageHeader: false, pdfPageNumberPosition: "center", pdfHeaderLeft: "{title}", pdfHeaderRight: "{author}", pdfFooterRight: "Page {page}/{pages}" };
    const result = paginateManuscript(container, [{ id: "note-1", html: "<p>Note exportée</p>" }], settings, template, "Titre", "Auteur");
    assert.equal(result.totalPages, 4);
    assert.equal(dom.body.children.length, 0);
    assert.match(result.pagesHtml, /pdf-page page-odd/);
    assert.match(result.pagesHtml, /pdf-page page-even/);
    assert.match(result.pagesHtml, /padding-left: 1cm/);
    assert.match(result.pagesHtml, /padding-left: 3cm/);
    assert.match(result.pagesHtml, /Titre/);
    assert.match(result.pagesHtml, /Auteur/);
    assert.match(result.pagesHtml, /Page 2\/4/);
    assert.match(result.pagesHtml, /Note exportée/);
  } finally { dom.restore(); }
});

test("paginateManuscript : conserve une page minimale sans contenu", () => {
  const dom = installDom();
  try {
    const result = paginateManuscript(element("div"), [], {}, template);
    assert.equal(result.totalPages, 1);
    assert.equal(result.pagesHtml, "");
    assert.equal(dom.body.children.length, 0);
  } finally { dom.restore(); }
});

test("exportPdf : sur mobile notifie sans rendre ni charger le DOM", async () => {
  const previousMobile = Platform.isMobile;
  const previousNotice = Notice.onCreate;
  const previousRender = MarkdownRenderer.render;
  const notices = [];
  Platform.isMobile = true;
  Notice.onCreate = (message) => notices.push(message);
  MarkdownRenderer.render = async () => { throw new Error("le rendu ne doit pas démarrer"); };
  try {
    await exportPdf({}, {}, { markdown: "Texte", title: "Titre", author: "", sourcePath: "Source.md" });
    assert.equal(notices.length, 1);
    assert.match(notices[0], /desktop/);
  } finally {
    Platform.isMobile = previousMobile;
    Notice.onCreate = previousNotice;
    MarkdownRenderer.render = previousRender;
  }
});

test("exportPdf : injecte la page titre, imprime dans une iframe et la nettoie", async () => {
  const dom = installDom();
  const previousMobile = Platform.isMobile;
  const previousRender = MarkdownRenderer.render;
  Platform.isMobile = false;
  MarkdownRenderer.render = async (_app, _markdown, container) => container.appendChild(element("p", "Corps", 50));
  const app = { vault: { getAbstractFileByPath: () => null } };
  const settings = { exportTemplate: "classique", pdfHideFirstPageHeader: false, pdfPageNumberPosition: "right" };
  try {
    await exportPdf(app, settings, { markdown: "Texte", title: "Mon titre", author: "Une autrice", sourcePath: "Source.md" });
    assert.equal(dom.frames.length, 1);
    const frame = dom.frames[0];
    const printDoc = frame.contentDocument;
    assert.equal(printDoc.documentElement.getAttribute("lang"), "fr");
    const titleTag = printDoc.head.children.find((child) => child.tagName === "TITLE");
    assert.equal(titleTag.textContent, "Mon titre");
    const styleTag = printDoc.head.children.find((child) => child.tagName === "STYLE");
    assert.match(styleTag.textContent, /@media print/);
    assert.match(printDoc.body.innerHTML, /<h1>Mon titre<\/h1>/);
    assert.match(printDoc.body.innerHTML, /Une autrice/);
    assert.equal(frame.contentWindow.focused, 1);
    assert.equal(frame.contentWindow.printed, 1);
    assert.equal(dom.body.children.length, 0);
  } finally {
    Platform.isMobile = previousMobile;
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

test("exportPdf : ne double pas la page titre lorsqu'un segment Front titre existe", async () => {
  const dom = installDom();
  const previousMobile = Platform.isMobile;
  const previousRender = MarkdownRenderer.render;
  Platform.isMobile = false;
  MarkdownRenderer.render = async (_app, _markdown, container) => container.appendChild(element("p", "Page Front", 50));
  const app = { vault: { getAbstractFileByPath: () => null } };
  const settings = { exportTemplate: "classique", pdfHideFirstPageHeader: false, pdfPageNumberPosition: "right" };
  try {
    await exportPdf(app, settings, {
      markdown: "Texte",
      title: "Mon titre",
      author: "Une autrice",
      sourcePath: "Source.md",
      segments: [{ text: "Page Front", frontType: "titre" }],
    });
    assert.equal(dom.frames.length, 1);
    assert.equal(dom.frames[0].contentDocument.body.innerHTML.includes("<h1>Mon titre</h1>"), false);
  } finally {
    Platform.isMobile = previousMobile;
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});
