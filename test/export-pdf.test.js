import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkdownRenderer, Notice, Platform } from "obsidian";
import { exportPdf, paginateManuscript } from "../src/services/export-pdf.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

let activeFrames = null;
// Hauteur (offsetHeight) forcée sur la prochaine ".pdf-footnote-entry" créée
// par buildFootnoteEntry (export-pdf.js) — sert uniquement à simuler une
// note longue en test (le fake DOM ne calcule pas de vraie mise en page).
let nextFootnoteEntryHeight = null;

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
  // Support minimal, volontairement limité au seul motif utilisé par
  // export-pdf.js : `a[href^="#"]` (recherche des appels de note).
  querySelectorAll(selector) {
    const m = /^([a-z0-9]*)\[([a-zA-Z-]+)\^="([^"]*)"\]$/i.exec(selector || "");
    if (!m) return [];
    const [, tag, attr, prefix] = m;
    const results = [];
    const visit = (node) => {
      for (const child of node.children) {
        const tagOk = !tag || child.tagName.toLowerCase() === tag.toLowerCase();
        if (tagOk && (child.getAttribute(attr) || "").startsWith(prefix)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

// Document isolé de l'iframe d'impression. Reflète le VRAI comportement du
// navigateur : doc.open() vide le document sans reconstruire de squelette
// <html>/<head>/<body> (ça, c'était le rôle du parseur HTML déclenché par
// document.write, qu'on ne fait plus) — documentElement/head/body valent
// donc null tant qu'on n'a rien inséré. Une version antérieure de ce fake
// pré-remplissait ces trois champs, masquant le crash réel d'Obsidian
// (« Cannot read properties of null (reading 'setAttribute') »).
function createFakeIframeDocument() {
  return {
    documentElement: null,
    head: null,
    body: null,
    createElement: (tag) => new FakeElement(tag),
    open() {
      this.documentElement = null;
      this.head = null;
      this.body = null;
    },
    close() {},
    replaceChildren(htmlEl) {
      this.documentElement = htmlEl;
      this.head = htmlEl.children.find((child) => child.tagName === "HEAD") || null;
      this.body = htmlEl.children.find((child) => child.tagName === "BODY") || null;
    },
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
  globalThis.createEl = (tag, options = {}) => {
    const el = new FakeElement(tag, options.text || "");
    if (options.cls) el.className = options.cls;
    if (options.cls === "pdf-footnote-entry" && nextFootnoteEntryHeight != null) {
      el.offsetHeight = nextFootnoteEntryHeight;
      nextFootnoteEntryHeight = null;
    }
    return el;
  };
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

// Paragraphe portant un appel de note, dans la même forme que le rendu
// Markdown natif d'Obsidian : <sup class="footnote-ref"><a href="#id">n</a></sup>.
function paragraphWithFootnoteRef(footnoteId, height = 30) {
  const p = element("p", "", height);
  const sup = p.createEl("sup", { cls: "footnote-ref" });
  const a = sup.createEl("a", { text: "•" });
  a.setAttribute("href", `#${footnoteId}`);
  return p;
}

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

test("pdfFootnotePlacement : valeur par défaut = fin du manuscrit", () => {
  assert.equal(DEFAULT_SETTINGS.pdfFootnotePlacement, "end");
});

test("paginateManuscript : placement 'end' regroupe toutes les notes en fin de manuscrit (comportement inchangé)", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(paragraphWithFootnoteRef("fn1", 30));
    container.appendChild(paragraphWithFootnoteRef("fn2", 30));
    const settings = { pdfFootnotePlacement: "end" };
    const footnotes = [
      { id: "fn1", html: "<p>Première note</p>" },
      { id: "fn2", html: "<p>Deuxième note</p>" },
    ];
    const result = paginateManuscript(container, footnotes, settings, template);
    assert.match(result.pagesHtml, /pdf-footnotes-section/);
    assert.equal(result.pagesHtml.includes("pdf-footnote-entry"), false);
    assert.match(result.pagesHtml, /Première note/);
    assert.match(result.pagesHtml, /Deuxième note/);
  } finally { dom.restore(); }
});

test("paginateManuscript : placement 'bottom' insère la note juste après son appel, pas dans une section groupée", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(paragraphWithFootnoteRef("fn1", 30));
    const settings = { pdfFootnotePlacement: "bottom" };
    const footnotes = [{ id: "fn1", html: "<p>Texte de la note</p>" }];
    const result = paginateManuscript(container, footnotes, settings, template);
    assert.equal(result.totalPages, 1);
    assert.equal(result.pagesHtml.includes("pdf-footnotes-section"), false);
    assert.match(result.pagesHtml, /pdf-footnote-divider/);
    assert.match(result.pagesHtml, /pdf-footnote-entry/);
    assert.match(result.pagesHtml, /Texte de la note/);
    const refIndex = result.pagesHtml.indexOf("footnote-ref");
    const entryIndex = result.pagesHtml.indexOf("pdf-footnote-entry");
    assert.ok(refIndex >= 0 && entryIndex > refIndex, "la note doit suivre son appel");
  } finally { dom.restore(); }
});

test("paginateManuscript : placement 'bottom' - plusieurs notes sur la même page apparaissent toutes, dans l'ordre et numérotées", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(paragraphWithFootnoteRef("fn1", 30));
    container.appendChild(paragraphWithFootnoteRef("fn2", 30));
    const settings = { pdfFootnotePlacement: "bottom" };
    const footnotes = [
      { id: "fn1", html: "<p>Première note</p>" },
      { id: "fn2", html: "<p>Deuxième note</p>" },
    ];
    const result = paginateManuscript(container, footnotes, settings, template);
    assert.equal(result.totalPages, 1);
    assert.match(result.pagesHtml, /Première note/);
    assert.match(result.pagesHtml, /Deuxième note/);
    assert.ok(result.pagesHtml.indexOf("Première note") < result.pagesHtml.indexOf("Deuxième note"));
    assert.match(result.pagesHtml, /pdf-footnote-num">1\./);
    assert.match(result.pagesHtml, /pdf-footnote-num">2\./);
  } finally { dom.restore(); }
});

test("paginateManuscript : placement 'bottom' - une note longue provoque une repagination sans perte ni duplication", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(paragraphWithFootnoteRef("fn1", 800));
    container.appendChild(element("p", "Suite du texte", 100));
    const settings = { pdfFootnotePlacement: "bottom" };
    const footnotes = [{ id: "fn1", html: "<p>Note très longue</p>" }];
    nextFootnoteEntryHeight = 300;
    const result = paginateManuscript(container, footnotes, settings, template);
    assert.equal(result.totalPages, 2);
    assert.equal((result.pagesHtml.match(/Note très longue/g) || []).length, 1);
    assert.equal((result.pagesHtml.match(/pdf-footnote-divider/g) || []).length, 1);
    assert.match(result.pagesHtml, /Suite du texte/);
  } finally { dom.restore(); }
});

test("paginateManuscript : placement 'bottom' - une note jamais appelée n'est pas perdue (repli en fin de manuscrit)", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(element("p", "Texte sans appel", 30));
    const settings = { pdfFootnotePlacement: "bottom" };
    const footnotes = [{ id: "fn1", html: "<p>Note orpheline</p>" }];
    const result = paginateManuscript(container, footnotes, settings, template);
    assert.match(result.pagesHtml, /Note orpheline/);
    assert.equal((result.pagesHtml.match(/Note orpheline/g) || []).length, 1);
  } finally { dom.restore(); }
});

test("exportPdf : imprime toujours quand le placement des notes est 'bottom'", async () => {
  const dom = installDom();
  const previousMobile = Platform.isMobile;
  const previousRender = MarkdownRenderer.render;
  Platform.isMobile = false;
  MarkdownRenderer.render = async (_app, _markdown, container) => container.appendChild(element("p", "Corps", 50));
  const app = { vault: { getAbstractFileByPath: () => null } };
  const settings = { exportTemplate: "classique", pdfFootnotePlacement: "bottom" };
  try {
    await assert.doesNotReject(() =>
      exportPdf(app, settings, { markdown: "Texte", title: "Mon titre", author: "Une autrice", sourcePath: "Source.md" })
    );
    assert.equal(dom.frames.length, 1);
    assert.equal(dom.frames[0].contentWindow.printed, 1);
  } finally {
    Platform.isMobile = previousMobile;
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
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

test("exportPdf : ne plante pas quand documentElement/head/body valent null après open() (régression du crash setAttribute sur null)", async () => {
  // Vérifie d'abord que le fake reproduit bien le vrai comportement du
  // navigateur avant toute construction — c'est justement l'écart que
  // masquait l'ancienne version de ce fake (documentElement/head/body
  // pré-remplis), qui laissait passer un doc.documentElement.setAttribute(...)
  // sans jamais planter en test, alors qu'Obsidian plantait réellement.
  const freshDoc = createFakeIframeDocument();
  freshDoc.open();
  assert.equal(freshDoc.documentElement, null);
  assert.equal(freshDoc.head, null);
  assert.equal(freshDoc.body, null);

  const dom = installDom();
  const previousMobile = Platform.isMobile;
  const previousRender = MarkdownRenderer.render;
  Platform.isMobile = false;
  MarkdownRenderer.render = async (_app, _markdown, container) => container.appendChild(element("p", "Corps", 50));
  const app = { vault: { getAbstractFileByPath: () => null } };
  const settings = { exportTemplate: "classique", pdfHideFirstPageHeader: false, pdfPageNumberPosition: "right" };
  try {
    await assert.doesNotReject(() =>
      exportPdf(app, settings, { markdown: "Texte", title: "Mon titre", author: "Une autrice", sourcePath: "Source.md" })
    );
    assert.equal(dom.frames.length, 1);
    const frame = dom.frames[0];
    const printDoc = frame.contentDocument;
    assert.equal(printDoc.documentElement.getAttribute("lang"), "fr");
    assert.ok(printDoc.head, "head doit être créé");
    const titleTag = printDoc.head.children.find((child) => child.tagName === "TITLE");
    assert.equal(titleTag.textContent, "Mon titre");
    const styleTag = printDoc.head.children.find((child) => child.tagName === "STYLE");
    assert.ok(styleTag, "style doit être créé");
    assert.ok(printDoc.body, "body doit être créé");
    assert.match(printDoc.body.innerHTML, /<h1>Mon titre<\/h1>/);
    assert.match(printDoc.body.innerHTML, /Corps/);
    assert.equal(frame.contentWindow.printed, 1);
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
