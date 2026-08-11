import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { MarkdownRenderer } from "obsidian";
import { exportOdt } from "../src/services/export-odt.js";
import { EXPORT_TEMPLATES } from "../src/utils/export-templates.js";

/* Même petit DOM factice que export-render.test.js : suffisant pour
   parcourir containerEl.childNodes/querySelectorAll, sans reproduire un
   navigateur entier. */
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
  set textContent(value) {
    this.children = [];
    this._text = value;
  }
  get attributes() {
    return Array.from(this._attributes, ([name, value]) => ({ name, value }));
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  get childNodes() {
    // Cette fausse arborescence ne modélise pas les nœuds texte comme de
    // vrais enfants (contrairement au DOM réel) : un élément-feuille avec du
    // texte (ex. un <p>) expose ici un unique nœud texte synthétique, pour
    // que le parcours récursif de domToOdtContent (export-odt.ts) trouve
    // bien un enfant à lire — suffisant pour ce test, pas un DOM générique.
    if (this.children.length) return this.children;
    if (this._text) return [{ nodeType: 3, textContent: this._text }];
    return [];
  }
  get nodeType() {
    return 1; // Node.ELEMENT_NODE — cette fausse arborescence ne modélise pas les nœuds texte séparément
  }
  get innerHTML() {
    return this.children.length ? this.children.map((c) => c.outerHTML).join("") : this._text;
  }
  get outerHTML() {
    const attrs = this.attributes.map(({ name, value }) => ` ${name}="${value}"`).join("");
    return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  setAttribute(name, value) {
    this._attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this._attributes.get(name) || null;
  }
  removeAttribute(name) {
    this._attributes.delete(name);
  }
  appendChild(child) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
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
  matches(selector) {
    const attribute = selector.match(/\[([^\]]+)\]$/);
    const base = attribute ? selector.slice(0, -attribute[0].length) : selector;
    if (attribute && !this._attributes.has(attribute[1])) return false;
    if (base === "*") return true;
    const [tag, ...classes] = base.split(".");
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const ownClasses = (this.className || "").split(/\s+/);
    return classes.every((name) => ownClasses.includes(name));
  }
  querySelectorAll(selectors) {
    const parts = selectors.split(",").map((s) => s.trim());
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (parts.some((selector) => child.matches(selector))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selectors) {
    return this.querySelectorAll(selectors)[0] || null;
  }
}

function element(tag, text, attributes = {}) {
  const result = new FakeElement(tag, text);
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
  return result;
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousNode = globalThis.Node;
  const previousCreateEl = globalThis.createEl;
  const previousCreateDiv = globalThis.createDiv;
  globalThis.document = { createElement: (tag) => element(tag) };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  // Fonctions globales autonomes createEl/createDiv d'Obsidian (nœud
  // détaché, non ajouté à un parent) — voir export-render.ts.
  globalThis.createEl = (tag, options = {}) => element(tag, options.text || "");
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  return () => {
    globalThis.document = previousDocument;
    globalThis.Node = previousNode;
    globalThis.createEl = previousCreateEl;
    globalThis.createDiv = previousCreateDiv;
  };
}

function setRenderer(render) {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = render;
  return () => { MarkdownRenderer.render = previous; };
}

test("exportOdt : les notes de bas de page apparaissent en notes de fin, jamais silencieusement perdues", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("p", "Un fait notable."));
    const section = element("section", "", { class: "footnotes" });
    const note = element("li", "", { id: "fn1" });
    note.appendChild(element("p", "Une source importante."));
    section.appendChild(note);
    container.appendChild(section);
  });

  try {
    const app = {};
    const settings = {};
    const bytes = await exportOdt(app, settings, {
      markdown: "Un fait notable.[^1]\n\n[^1]: Une source importante.",
      title: "Mon livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });

    const zip = await JSZip.loadAsync(bytes);
    const contentXml = await zip.file("content.xml").async("string");

    assert.match(contentXml, /Un fait notable\./);
    assert.match(contentXml, />Notes<\/text:h>/);
    assert.match(contentXml, /Une source importante\./);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("exportOdt : aucune section Notes si le manuscrit n'a aucune note", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("p", "Texte sans note."));
  });

  try {
    const bytes = await exportOdt({}, {}, {
      markdown: "Texte sans note.",
      title: "Mon livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const zip = await JSZip.loadAsync(bytes);
    const contentXml = await zip.file("content.xml").async("string");
    assert.doesNotMatch(contentXml, />Notes<\/text:h>/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

/* Chantier « Compilation professionnelle — Lot 2 » (fidélité visuelle
 * aperçu/export) : avant ce lot, l'ODT ignorait complètement le modèle
 * d'export choisi (font/taille/interligne/marges toujours Times 12pt,
 * 2.5cm, quel que soit le gabarit) — voir l'audit du chantier. Ces tests
 * vérifient que le modèle sélectionné (même source que PDF/EPUB/DOCX,
 * voir export-templates.js) pilote désormais réellement le style ODT. */
test("exportOdt : la police/taille/interligne du gabarit choisi pilotent le style par défaut", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("p", "Texte."));
  });
  try {
    const bytes = await exportOdt({}, { exportTemplate: "romanSimple" }, {
      markdown: "Texte.",
      title: "Mon livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const zip = await JSZip.loadAsync(bytes);
    const stylesXml = await zip.file("styles.xml").async("string");
    // romanSimple : Baskerville 14pt, interligne 24/14 (~171%), marges
    // asymétriques (top/bottom 2.5cm, left 3cm, right 3.5cm).
    assert.match(stylesXml, /fo:font-name="Baskerville"/);
    assert.match(stylesXml, /fo:font-size="14pt"/);
    assert.match(stylesXml, /fo:line-height="171%"/);
    assert.match(stylesXml, /fo:margin-left="3cm"/);
    assert.match(stylesXml, /fo:margin-right="3\.5cm"/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("exportOdt : le corps V2 applique retrait et espacements explicites", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => container.appendChild(element("p", "Texte.")));
  try {
    const bytes = await exportOdt({}, { exportTemplate: "apa" }, {
      markdown: "Texte.", title: "Mon livre", author: "Autrice", sourcePath: "Manuscrit.md", segments: [],
    });
    const zip = await JSZip.loadAsync(bytes);
    const stylesXml = await zip.file("styles.xml").async("string");
    assert.match(stylesXml, /fo:text-indent="36pt"/);
    assert.match(stylesXml, /fo:margin-top="0pt" fo:margin-bottom="0pt"/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("exportOdt : Quotations reçoit les surcharges locales de citation", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => container.appendChild(element("blockquote", "Citation.")));
  const previous = EXPORT_TEMPLATES.romanSimple.blockquote;
  EXPORT_TEMPLATES.romanSimple.blockquote = { fontFamily: "Futura", fontSizePt: 13, lineHeight: 1.2, align: "center", firstLineIndentPt: 8, marginTopPt: 10, marginBottomPt: 11, marginLeftPt: 12, marginRightPt: 13, italic: false, colorHex: "#123456" };
  try {
    const bytes = await exportOdt({}, { exportTemplate: "romanSimple" }, { markdown: "> Citation.", title: "Livre", author: "Autrice", sourcePath: "Manuscrit.md", segments: [] });
    const zip = await JSZip.loadAsync(bytes);
    const contentXml = await zip.file("content.xml").async("string");
    assert.match(contentXml, /style:name="Quotations"[\s\S]*fo:margin-left="12pt"[\s\S]*fo:font-family="Futura"[\s\S]*fo:font-size="13pt"/);
  } finally { EXPORT_TEMPLATES.romanSimple.blockquote = previous; restoreRenderer(); restoreDom(); }
});

test("exportOdt : page, colonnes, en-tête et pied V2 ne sont pas écrasés par les réglages pdf legacy", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => container.appendChild(element("p", "Texte.")));
  try {
    const bytes = await exportOdt({}, {
      exportTemplate: "romanFrancais", pdfPageSize: "letter", pdfOrientation: "portrait",
      pdfHeaderLeft: "Titre V2", pdfFooterRight: "Page {page}", pdfEnableHeaders: true, pdfEnableFooters: true,
    }, { markdown: "Texte.", title: "Mon livre", author: "Autrice", sourcePath: "Manuscrit.md", segments: [] });
    const zip = await JSZip.loadAsync(bytes);
    const stylesXml = await zip.file("styles.xml").async("string");
    assert.match(stylesXml, /fo:page-width="29\.7cm" fo:page-height="21cm"/);
    assert.match(stylesXml, /fo:column-count="2" fo:column-gap="45pt"/);
    assert.doesNotMatch(stylesXml, /Titre V2/);
    assert.match(stylesXml, /Mon livre<text:tab\/><text:tab\/>Autrice/);
    assert.match(stylesXml, /Page <text:page-number\/> sur <text:page-count\/>/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("exportOdt : les titres (h1/h2/h3) reprennent taille/graisse/saut de page du gabarit", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("h1", "Partie I"));
    container.appendChild(element("h2", "Chapitre 1"));
  });
  try {
    const bytes = await exportOdt({}, { exportTemplate: "these" }, {
      markdown: "# Partie I\n\n## Chapitre 1",
      title: "Mon livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const zip = await JSZip.loadAsync(bytes);
    const contentXml = await zip.file("content.xml").async("string");
    // "these" : h1 20pt gras avec saut de page, h2 16pt gras sans saut.
    assert.match(contentXml, /style:name="Heading_20_1"[\s\S]*?fo:font-size="20pt" fo:font-weight="bold"/);
    assert.match(contentXml, /style:name="Heading_20_1"[\s\S]*?fo:break-before="page"/);
    assert.match(contentXml, /style:name="Heading_20_2"[\s\S]*?fo:font-size="16pt" fo:font-weight="bold"/);
    assert.doesNotMatch(contentXml.match(/<style:style style:name="Heading_20_2"[\s\S]*?<\/style:style>/)[0], /fo:break-before/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("exportOdt : H4 à H6 utilisent aussi les styles V2", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("h4", "Niveau 4"));
    container.appendChild(element("h5", "Niveau 5"));
    container.appendChild(element("h6", "Niveau 6"));
  });
  try {
    const bytes = await exportOdt({}, { exportTemplate: "these" }, {
      markdown: "#### Niveau 4", title: "Mon livre", author: "Autrice", sourcePath: "Manuscrit.md", segments: [],
    });
    const zip = await JSZip.loadAsync(bytes);
    const contentXml = await zip.file("content.xml").async("string");
    assert.match(contentXml, /text:style-name="Heading_20_4" text:outline-level="4">Niveau 4/);
    assert.match(contentXml, /text:style-name="Heading_20_5" text:outline-level="5">Niveau 5/);
    assert.match(contentXml, /text:style-name="Heading_20_6" text:outline-level="6">Niveau 6/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("exportOdt : le séparateur de scène du gabarit apparaît dans le texte du <hr>", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("p", "Avant."));
    container.appendChild(element("hr"));
    container.appendChild(element("p", "Après."));
  });
  try {
    const bytes = await exportOdt({}, { exportTemplate: "romanFrancais" }, {
      markdown: "Avant.\n\n***\n\nAprès.",
      title: "Mon livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const zip = await JSZip.loadAsync(bytes);
    const contentXml = await zip.file("content.xml").async("string");
    assert.match(contentXml, /text:style-name="Horizontal_20_Line">\*\*\*</);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("exportOdt : sans séparateur défini par le gabarit, repli \"* * *\" (même repli que DOCX)", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("hr"));
  });
  try {
    const bytes = await exportOdt({}, { exportTemplate: "classique" }, {
      markdown: "***",
      title: "Mon livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const zip = await JSZip.loadAsync(bytes);
    const contentXml = await zip.file("content.xml").async("string");
    assert.match(contentXml, /text:style-name="Horizontal_20_Line">\* \* \*</);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});
