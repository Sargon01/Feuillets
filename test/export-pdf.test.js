import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MarkdownRenderer, Notice, Platform } from "obsidian";
import { effectiveHyphenation, exportPdf, paginateManuscript } from "../src/services/export-pdf.js";

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
  // Sélecteur minimal (nom de balise simple) : suffisant pour retrouver
  // head/body/title/style dans le squelette construit par DOMParser côté
  // export-pdf.js — pas un vrai moteur de sélecteurs CSS.
  querySelector(selector) {
    if (/^[a-z]+$/i.test(selector)) {
      const tag = selector.toUpperCase();
      for (const child of this.children) {
        if (child.tagName === tag) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }
  querySelectorAll() { return []; }
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
    // Transfert d'un nœud entre documents : dans ce fake, un simple realm
    // JS unique suffit — pas besoin de vraiment recopier l'arbre, l'original
    // (le squelette DOMParser) n'est de toute façon plus relu ensuite.
    importNode(node) { return node; },
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
  // Deux usages du DOMParser réel dans export-pdf.js : parser le squelette
  // HTML statique <html><head>...</head><body></body></html> (a besoin d'un
  // vrai documentElement/head/body/title/style) et parser pagesHtml (a
  // seulement besoin de .body, contenu préservé tel quel via RawNode).
  globalThis.DOMParser = class {
    parseFromString(html) {
      if (/^<html>/.test(html)) {
        const htmlEl = new FakeElement("html");
        const headEl = new FakeElement("head");
        const bodyEl = new FakeElement("body");
        htmlEl.appendChild(headEl);
        htmlEl.appendChild(bodyEl);
        const metaEl = new FakeElement("meta");
        metaEl.setAttribute("charset", "utf-8");
        headEl.appendChild(metaEl);
        headEl.appendChild(new FakeElement("title"));
        headEl.appendChild(new FakeElement("style"));
        return { documentElement: htmlEl, body: bodyEl };
      }
      const bodyEl = new FakeElement("body");
      bodyEl.appendChild(new RawNode(html));
      return { body: bodyEl };
    }
  };
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

test("exportPdf : ne fournit pas la surcharge de césure propre à l’aperçu", async () => {
  const source = await readFile(new URL("../src/services/export-pdf.js", import.meta.url), "utf8");
  assert.match(source, /paginateManuscript\(containerEl, footnotes, settings, tpl, title, author\)/);
  assert.doesNotMatch(source, /paginateManuscript\(containerEl, footnotes, settings, tpl, title, author, \{[\s\S]*hyphenationOverride/);
});

test("PDF : sans override, la pagination utilise la césure définie par le gabarit", () => {
  const withHyphenation = { ...template, hyphenation: true };
  const withoutHyphenation = { ...template, hyphenation: false };

  assert.equal(effectiveHyphenation(withHyphenation), true);
  assert.equal(effectiveHyphenation(withoutHyphenation), false);
  assert.equal(effectiveHyphenation(withHyphenation, { hyphenationOverride: false }), false);
  assert.equal(effectiveHyphenation(withoutHyphenation, { hyphenationOverride: true }), true);
});

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

test("paginateManuscript : mêmes réglages centraux pour zones centrales, distances et activation", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(element("p", "Corps", 100));
    const settings = {
      pdfHideFirstPageHeader: false,
      pdfEnableHeaders: true,
      pdfEnableFooters: false,
      pdfHeaderLeft: "Gauche",
      pdfHeaderCenter: "{title}",
      pdfHeaderRight: "{author}",
      pdfHeaderDistanceCm: 1.1,
      pdfHeaderBodyGapPt: 7,
      pdfFooterRight: "Page {page}",
    };
    const result = paginateManuscript(container, [], settings, template, "Roman", "Autrice");
    assert.match(result.pagesHtml, /text-align: center;">Roman/);
    assert.match(result.pagesHtml, /top: 1.1cm/);
    assert.match(result.pagesHtml, /padding-bottom: 7pt/);
    assert.doesNotMatch(result.pagesHtml, /pdf-page-footer/);
  } finally { dom.restore(); }
});

test("paginateManuscript : une colonne conserve le contenu PDF historique sans style de colonnes", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(element("p", "Corps", 100));
    const result = paginateManuscript(container, [], {}, { ...template, columns: { count: 1, gutterPt: 18 } });
    assert.doesNotMatch(result.pagesHtml, /column-count|column-gap|column-fill/);
  } finally { dom.restore(); }
});

test("paginateManuscript : une surcharge de marges adapte la mesure et la page sans changer le PDF par défaut", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(element("p", "Corps", 100));
    const settings = { pdfMarginTop: 1, pdfMarginBottom: 1, pdfMarginLeft: 1, pdfMarginRight: 1 };
    const normal = paginateManuscript(container, [], settings, template);
    const preview = paginateManuscript(container, [], settings, template, "", "", {
      marginsOverrideCm: { top: 3, bottom: 4, left: 5, right: 6 },
    });
    assert.match(normal.pagesHtml, /padding-left: 1cm/);
    assert.match(preview.pagesHtml, /padding-top: 3cm/);
    assert.match(preview.pagesHtml, /padding-bottom: 4cm/);
    assert.match(preview.pagesHtml, /padding-left: 5cm/);
    assert.match(preview.pagesHtml, /padding-right: 6cm/);
  } finally { dom.restore(); }
});

test("paginateManuscript : transmet les deux colonnes et la gouttière à la mesure puis à la page PDF finale", () => {
  const dom = installDom();
  try {
    const container = element("div");
    container.appendChild(element("p", "Corps", 100));
    const result = paginateManuscript(container, [], {}, { ...template, columns: { count: 2, gutterPt: 18 } });
    assert.match(paginateManuscript.toString(), /columnCount,\s*columnGapPt/);
    assert.match(result.pagesHtml, /class="pdf-page-content" style="height: 100%; overflow: hidden; column-count: 2; column-gap: 18pt; column-fill: auto;"/);
  } finally { dom.restore(); }
});

test("paginateManuscript : une page Front conserve sa composition à une colonne", () => {
  const dom = installDom();
  try {
    const container = element("div");
    const front = element("div", "Dédicace", 100); front.addClass("feuillets-frontpage");
    container.appendChild(front);
    container.appendChild(element("p", "Corps", 100));
    const result = paginateManuscript(container, [], {}, { ...template, columns: { count: 2, gutterPt: 18 } });
    const pages = result.pagesHtml.split('class="pdf-page-content"');
    assert.doesNotMatch(pages[1], /column-count/, "la page Front reste inchangée");
    assert.match(pages[2], /column-count: 2/, "le corps suivant conserve deux colonnes");
  } finally { dom.restore(); }
});

/* ==================== §27/§42 : géométrie Portrait / Paysage ==============
 * Régression du bug Paysage : `settings.pdfOrientation` valant toujours
 * "portrait" par défaut, un gabarit paysage ne pouvait jamais gagner. Le
 * gabarit RÉSOLU prime désormais ; les réglages legacy restent le repli exact
 * pour un gabarit qui n'exprime pas la donnée (tous les gabarits intégrés). */

/** Dimensions de page réellement écrites dans le HTML paginé. */
function pageBox(pagesHtml) {
  const width = /width: ([\d.]+)mm;/.exec(pagesHtml);
  const height = /height: ([\d.]+)mm;/.exec(pagesHtml);
  return { widthMm: Number(width?.[1]), heightMm: Number(height?.[1]) };
}

function paginateOnce(tpl, settings) {
  const container = element("div");
  container.appendChild(element("p", "Corps", 100));
  return paginateManuscript(container, [], settings, tpl);
}

test("paginateManuscript : A4 portrait — page plus haute que large", () => {
  const dom = installDom();
  try {
    const box = pageBox(paginateOnce({ ...template, pageSize: "A4", pageOrientation: "portrait" }, {}).pagesHtml);
    assert.equal(box.widthMm, 210);
    assert.equal(box.heightMm, 297);
    assert.ok(box.widthMm < box.heightMm);
  } finally { dom.restore(); }
});

test("paginateManuscript : A4 paysage — page plus large que haute, malgré un réglage legacy portrait", () => {
  const dom = installDom();
  try {
    const box = pageBox(paginateOnce(
      { ...template, pageSize: "A4", pageOrientation: "landscape" },
      { pdfPageSize: "A4", pdfOrientation: "portrait" }
    ).pagesHtml);
    assert.equal(box.widthMm, 297);
    assert.equal(box.heightMm, 210);
    assert.ok(box.widthMm > box.heightMm);
  } finally { dom.restore(); }
});

test("paginateManuscript : Portrait → Paysage → Portrait recalcule réellement, sans valeur en cache", () => {
  const dom = installDom();
  try {
    const legacy = { pdfPageSize: "A4", pdfOrientation: "portrait" };
    const portrait = pageBox(paginateOnce({ ...template, pageSize: "A4", pageOrientation: "portrait" }, legacy).pagesHtml);
    const landscape = pageBox(paginateOnce({ ...template, pageSize: "A4", pageOrientation: "landscape" }, legacy).pagesHtml);
    const back = pageBox(paginateOnce({ ...template, pageSize: "A4", pageOrientation: "portrait" }, legacy).pagesHtml);

    assert.ok(portrait.widthMm < portrait.heightMm);
    assert.ok(landscape.widthMm > landscape.heightMm);
    assert.deepEqual(back, portrait);
  } finally { dom.restore(); }
});

test("paginateManuscript : un gabarit V2 portrait prime sur un ancien réglage paysage", () => {
  const dom = installDom();
  try {
    const box = pageBox(paginateOnce(
      { ...template, pageSize: "A4", pageOrientation: "portrait" },
      { pdfPageSize: "A4", pdfOrientation: "landscape" }
    ).pagesHtml);
    assert.ok(box.widthMm < box.heightMm);
  } finally { dom.restore(); }
});

test("paginateManuscript : le format V2 est respecté (A5), les réglages legacy ne servent que de repli", () => {
  const dom = installDom();
  try {
    const v2 = pageBox(paginateOnce({ ...template, pageSize: "A5" }, { pdfPageSize: "A4" }).pagesHtml);
    assert.equal(v2.widthMm, 148);
    assert.equal(v2.heightMm, 210);

    const legacyOnly = pageBox(paginateOnce({ ...template }, { pdfPageSize: "A5" }).pagesHtml);
    assert.equal(legacyOnly.widthMm, 148, "sans pageSize dans le gabarit, le réglage legacy pilote encore");
  } finally { dom.restore(); }
});

test("paginateManuscript : les marges V2 du gabarit priment sur les anciens réglages de marges", () => {
  const dom = installDom();
  try {
    const tpl = { ...template, marginsCm: { top: 3, bottom: 4, left: 5, right: 6 } };
    const settings = { pdfMarginTop: 1, pdfMarginBottom: 1, pdfMarginLeft: 1, pdfMarginRight: 1 };
    const html = paginateOnce(tpl, settings).pagesHtml;
    assert.match(html, /padding-top: 3cm/);
    assert.match(html, /padding-bottom: 4cm/);
    assert.match(html, /padding-left: 5cm/);
    assert.match(html, /padding-right: 6cm/);
  } finally { dom.restore(); }
});

test("paginateManuscript : sans marges dans le gabarit, les anciens réglages restent la source (aucune régression)", () => {
  const dom = installDom();
  try {
    const html = paginateOnce({ ...template }, { pdfMarginTop: 1.2, pdfMarginBottom: 1.3, pdfMarginLeft: 1.4, pdfMarginRight: 1.5 }).pagesHtml;
    assert.match(html, /padding-top: 1.2cm/);
    assert.match(html, /padding-left: 1.4cm/);
  } finally { dom.restore(); }
});

test("paginateManuscript : Aperçu et export PDF reçoivent la MÊME géométrie pour un même gabarit", () => {
  const dom = installDom();
  try {
    const tpl = { ...template, pageSize: "A4", pageOrientation: "landscape", marginsCm: { top: 2, bottom: 2, left: 3, right: 3 } };
    const settings = { pdfPageSize: "A5", pdfOrientation: "portrait", pdfMarginTop: 1, pdfMarginBottom: 1, pdfMarginLeft: 1, pdfMarginRight: 1 };
    // Aperçu : passe explicitement les marges du gabarit (preview-view.ts).
    const container = element("div");
    container.appendChild(element("p", "Corps", 100));
    const preview = paginateManuscript(container, [], settings, tpl, "", "", { marginsOverrideCm: tpl.marginsCm });
    // Export PDF : aucun override — le gabarit doit suffire.
    const pdf = paginateOnce(tpl, settings);

    assert.deepEqual(pageBox(preview.pagesHtml), pageBox(pdf.pagesHtml));
    for (const html of [preview.pagesHtml, pdf.pagesHtml]) {
      assert.match(html, /padding-top: 2cm/);
      assert.match(html, /padding-left: 3cm/);
    }
  } finally { dom.restore(); }
});

test("paginateManuscript : les bandes V2 du gabarit priment sur les anciens réglages d'en-tête", () => {
  const dom = installDom();
  try {
    const tpl = {
      ...template,
      header: { enabled: true, left: "V2 gauche", center: "", right: "V2 droite", distanceCm: 1.4, bodyGapPt: 9, differentOddEven: false },
      footer: { enabled: true, left: "", center: "", right: "Page {page}", distanceCm: 0.9, bodyGapPt: 4 },
      firstPage: { hideHeader: false, pageNumberPosition: "right" },
    };
    const settings = { pdfHeaderLeft: "Legacy gauche", pdfHeaderRight: "Legacy droite", pdfHeaderDistanceCm: 0.5, pdfHideFirstPageHeader: true };
    const html = paginateOnce(tpl, settings).pagesHtml;
    assert.match(html, /V2 gauche/);
    assert.match(html, /V2 droite/);
    assert.doesNotMatch(html, /Legacy gauche/);
    assert.match(html, /top: 1.4cm/);
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
    // Chantier « Compilation professionnelle — Lot 2 » : une image ne doit
    // jamais déborder de sa page imprimée (voir l'audit du chantier —
    // avant ce lot, aucune contrainte de hauteur n'existait).
    assert.match(styleTag.textContent, /\.pdf-page-content figure img, \.pdf-page-content img \{\s*max-height: 100%;/);
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
