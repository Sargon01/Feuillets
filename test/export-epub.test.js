import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { MarkdownRenderer } from "obsidian";
import { exportEpub } from "../src/services/export-epub.js";

/* Chantier « Compilation professionnelle — Lot 2 » (fidélité visuelle
 * aperçu/export) : avant ce lot, aucun test ne portait sur le CSS/la
 * structure XHTML produits par l'export EPUB (voir l'audit du chantier) —
 * seul le comportement des notes était couvert (footnote-export.test.js).
 * Même petit DOM factice que footnote-export.test.js/export-odt.test.js,
 * dupliqué plutôt que partagé (convention du dépôt). */
class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.parentElement = null;
    this.children = [];
    this._attributes = new Map();
  }
  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text;
  }
  get childNodes() {
    if (this.children.length) return this.children;
    if (this._text) return [{ nodeType: 3, nodeValue: this._text, textContent: this._text }];
    return [];
  }
  get nodeType() { return 1; }
  get attributes() { return Array.from(this._attributes, ([name, value]) => ({ name, value })); }
  get className() { return this.getAttribute("class") || ""; }
  get classList() {
    const self = this;
    return { contains: (name) => (self.getAttribute("class") || "").split(/\s+/).includes(name) };
  }
  get innerHTML() {
    if (!this.children.length) return this._text;
    return this.children.map((c) => c.outerHTML).join("");
  }
  get outerHTML() {
    const attrs = this.attributes.map(({ name, value }) => ` ${name}="${value}"`).join("");
    return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i >= 0) this.parentElement.children.splice(i, 1);
    this.parentElement = null;
  }
  cloneNode(deep) {
    const clone = new FakeElement(this.tagName, this._text);
    for (const { name, value } of this.attributes) clone.setAttribute(name, value);
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
    return clone;
  }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

function el(tag, textContent, attributes = {}) {
  const result = new FakeElement(tag, textContent);
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
  return result;
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousNode = globalThis.Node;
  const previousXMLSerializer = globalThis.XMLSerializer;
  const previousCreateEl = globalThis.createEl;
  const previousCreateDiv = globalThis.createDiv;
  globalThis.document = { createElement: (tag) => el(tag) };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.XMLSerializer = class {
    serializeToString(node) {
      return node && typeof node.outerHTML === "string" ? node.outerHTML : String(node?.textContent ?? "");
    }
  };
  // Fonctions globales autonomes createEl/createDiv d'Obsidian (nœud
  // détaché, non ajouté à un parent) — voir export-render.ts.
  globalThis.createEl = (tag, options = {}) => el(tag, options.text || "");
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  return () => {
    globalThis.document = previousDocument;
    globalThis.Node = previousNode;
    globalThis.XMLSerializer = previousXMLSerializer;
    globalThis.createEl = previousCreateEl;
    globalThis.createDiv = previousCreateDiv;
  };
}

function setRenderer(render) {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = render;
  return () => { MarkdownRenderer.render = previous; };
}

async function chaptersXhtml(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("OEBPS/chapitres.xhtml").async("string");
}

test("export EPUB : le CSS du gabarit choisi (police, taille, interligne) est bien injecté", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(el("h2", "Chapitre 1"));
    container.appendChild(el("p", "Un paragraphe."));
  });
  try {
    const bytes = await exportEpub({}, { exportTemplate: "romanSimple" }, {
      markdown: "## Chapitre 1\n\nUn paragraphe.",
      title: "Livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const xhtml = await chaptersXhtml(bytes);
    assert.match(xhtml, /<style type="text\/css">/);
    assert.match(xhtml, /Baskerville/);
    assert.match(xhtml, /font-size: 14pt/);
    // Le séparateur de scène du gabarit ("* * *") doit être injecté en CSS.
    assert.match(xhtml, /hr::before \{ content: "\* \* \*"; \}/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("export EPUB : un gabarit sans séparateur de scène défini a quand même un repli visuel (\"* * *\")", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(el("p", "Texte."));
  });
  try {
    const bytes = await exportEpub({}, { exportTemplate: "classique" }, {
      markdown: "Texte.",
      title: "Livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const xhtml = await chaptersXhtml(bytes);
    // "classique" ne définit pas tpl.sceneDivider — le CSS partagé doit
    // quand même styler un <hr> avec le même repli que DOCX ("* * *"),
    // au lieu de laisser un <hr> nu sans contenu textuel.
    assert.match(xhtml, /hr::before \{ content: "\* \* \*"; \}/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("export EPUB : les règles de titres (h1/h2/h3) et les unités relatives sont présentes, pas de pixels fixes", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(el("h1", "Partie I"));
  });
  try {
    const bytes = await exportEpub({}, { exportTemplate: "classique" }, {
      markdown: "# Partie I",
      title: "Livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const xhtml = await chaptersXhtml(bytes);
    assert.match(xhtml, /h1 \{[^}]*page-break-before: always;/);
    assert.match(xhtml, /h2 \{[^}]*page-break-before: always;/);
    // Fidélité e-liseuse : pas de largeur/hauteur en px imposée dans le CSS
    // du modèle (voir templateToCss, export-templates.js) — les tailles
    // d'image restent relatives (max-width en %).
    assert.doesNotMatch(xhtml, /:\s*\d+px/);
    assert.match(xhtml, /figure img \{ max-width: 100%; \}/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("export EPUB : une page Front (titre/dédicace) garde sa classe structurelle dans le XHTML", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const front = el("div", "", { class: "feuillets-frontpage feuillets-frontpage-titre" });
    front.appendChild(el("p", "Mon roman"));
    container.appendChild(front);
    container.appendChild(el("p", "Corps du texte."));
  });
  try {
    const bytes = await exportEpub({}, { exportTemplate: "classique" }, {
      markdown: "Mon roman\n\nCorps du texte.",
      title: "Livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [{ text: "Mon roman", frontType: "titre" }],
    });
    const xhtml = await chaptersXhtml(bytes);
    assert.match(xhtml, /class="feuillets-frontpage feuillets-frontpage-titre"/);
    // Segment Front de type "titre" déjà composé par l'autrice : pas de
    // <h1> générique dupliqué (même choix que PDF/ODT, voir export-pdf.js).
    assert.doesNotMatch(xhtml, /<h1>Livre<\/h1>/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});
