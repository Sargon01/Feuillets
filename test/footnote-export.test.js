import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { MarkdownRenderer } from "obsidian";
import { exportDocx } from "../src/services/export-docx.js";
import { exportEpub } from "../src/services/export-epub.js";

/* Petit DOM factice fidèle au HTML RÉEL que produit le moteur markdown-it de
   note de bas de page qu'Obsidian utilise en lecture — vérifié via la doc du
   plugin markdown-it-footnote dont Obsidian reprend les conventions :
   `<sup class="footnote-ref"><a href="#fn1">1</a></sup>` en ligne, et
   `<section class="footnotes"><ol><li id="fn1">…<a class="footnote-backref"
   href="#fnref1">↩</a></li></ol></section>` en fin de document. Même classe
   que test/export-odt.test.js et test/export-render.test.js — dupliquée
   plutôt que partagée, comme le reste des tests de ce dépôt. */
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
  get childNodes() {
    if (this.children.length) return this.children;
    if (this._text) return [{ nodeType: 3, nodeValue: this._text, textContent: this._text }];
    return [];
  }
  get nodeType() {
    return 1;
  }
  get attributes() {
    return Array.from(this._attributes, ([name, value]) => ({ name, value }));
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  set className(value) {
    this.setAttribute("class", value);
  }
  get classList() {
    const self = this;
    return {
      contains: (name) => (self.getAttribute("class") || "").split(/\s+/).includes(name),
    };
  }
  get innerHTML() {
    if (!this.children.length) return this._text;
    return this.children.map((c) => c.outerHTML).join("");
  }
  get outerHTML() {
    const attrs = this.attributes.map(({ name, value }) => ` ${name}="${value}"`).join("");
    return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  setAttribute(name, value) {
    this._attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this._attributes.get(name) ?? null;
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
        if (child.nodeType !== 1) continue; // nœud texte synthétique : jamais un candidat, jamais de descendants
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

/** Nœud texte minimal — seulement ce que docx-blocks.ts/le sérialiseur XHTML
 *  lisent réellement (`nodeType`, `nodeValue`, `textContent`, `outerHTML`
 *  pour la sérialisation). Permet un <p> à contenu MIXTE (texte + élément +
 *  texte), que le constructeur (texte, enfants) de FakeElement seul ne
 *  permet pas de représenter. */
function text(value) {
  return {
    nodeType: 3,
    nodeValue: value,
    textContent: value,
    get outerHTML() {
      return value;
    },
    cloneNode() {
      return text(value);
    },
    remove() {},
  };
}

function el(tag, textContent, attributes = {}) {
  const result = new FakeElement(tag, textContent);
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
  return result;
}

/** Élément avec un contenu MIXTE (texte, éléments, texte…), dans l'ordre. */
function mixed(tag, parts, attributes = {}) {
  const result = new FakeElement(tag, "");
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
  result.children = parts.map((part) => (typeof part === "string" ? text(part) : part));
  return result;
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousNode = globalThis.Node;
  const previousXMLSerializer = globalThis.XMLSerializer;
  globalThis.document = { createElement: (tag) => el(tag) };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  // Suffisant pour ce test : sérialise un nœud (élément ou texte) via
  // outerHTML, comme le ferait un vrai XMLSerializer sur cet arbre minimal.
  globalThis.XMLSerializer = class {
    serializeToString(node) {
      return node && typeof node.outerHTML === "string" ? node.outerHTML : String(node?.textContent ?? "");
    }
  };
  return () => {
    globalThis.document = previousDocument;
    globalThis.Node = previousNode;
    globalThis.XMLSerializer = previousXMLSerializer;
  };
}

function setRenderer(render) {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = render;
  return () => {
    MarkdownRenderer.render = previous;
  };
}

/** Construit un <p> avec un appel de note en fin de phrase, dans la forme
 *  réelle d'Obsidian : `<sup class="footnote-ref"><a href="#fnN">N</a></sup>`. */
function paragraphWithRef(sentence, n) {
  const a = el("a", String(n), { href: `#fn${n}` });
  const sup = mixed("sup", [a], { class: "footnote-ref" });
  return mixed("p", [sentence, sup, "."]);
}

/** Construit la section `.footnotes` finale avec N définitions, dans l'ordre,
 *  chacune avec son lien de retour `.footnote-backref`. */
function footnotesSection(defs) {
  const section = el("section", "", { class: "footnotes" });
  const ol = el("ol");
  defs.forEach((noteText, i) => {
    const n = i + 1;
    const backref = el("a", "↩", { class: "footnote-backref", href: `#fnref${n}` });
    const p = mixed("p", [`${noteText} `, backref]);
    const li = el("li", "", { id: `fn${n}` });
    li.children = [p];
    ol.appendChild(li);
  });
  section.appendChild(ol);
  return section;
}

function renderer(paragraphs, defs) {
  return async (_app, _markdown, container) => {
    for (const p of paragraphs) container.appendChild(p);
    container.appendChild(footnotesSection(defs));
  };
}

async function docxParts(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml").async("string");
  const footnotesXml = (await zip.file("word/footnotes.xml")?.async("string")) || "";
  return { documentXml, footnotesXml };
}

test("export DOCX : une note devient une vraie footnote Word, pas un paragraphe", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(
    renderer([paragraphWithRef("Phrase avec une note", 1)], ["note 1"])
  );
  try {
    const bytes = await exportDocx({}, {}, {
      markdown: "Phrase avec une note[^1].\n\n[^1]: note 1",
      title: "Livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const { documentXml, footnotesXml } = await docxParts(bytes);

    // Une vraie référence Word, pas un simple "1" perdu dans le corps.
    assert.match(documentXml, /<w:footnoteReference/);
    // Le contenu de la note vit dans footnotes.xml, jamais dans le corps.
    assert.match(footnotesXml, /note 1/);
    assert.doesNotMatch(documentXml, />\s*note 1\s*</);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("export DOCX : trois notes, chacune reliée à son propre appel", async () => {
  const restoreDom = installDom();
  const paragraphs = [1, 2, 3].map((n) => paragraphWithRef(`Fait numéro ${n}`, n));
  const defs = ["Première source.", "Deuxième source.", "Troisième source."];
  const restoreRenderer = setRenderer(renderer(paragraphs, defs));
  try {
    const bytes = await exportDocx({}, {}, {
      markdown:
        "Fait numéro 1[^1].\n\n[^1]: Première source.\n\nFait numéro 2[^2].\n\n[^2]: Deuxième source.\n\nFait numéro 3[^3].\n\n[^3]: Troisième source.",
      title: "Livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const { documentXml, footnotesXml } = await docxParts(bytes);

    const refCount = (documentXml.match(/<w:footnoteReference/g) || []).length;
    assert.equal(refCount, 3, "les 3 appels doivent devenir 3 vraies références");
    for (const text of defs) assert.match(footnotesXml, new RegExp(text));
    // Aucune des 3 définitions ne doit apparaître comme texte de corps.
    for (const text of defs) assert.doesNotMatch(documentXml, new RegExp(text));
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("export DOCX : note multiligne, contenu entièrement préservé dans la footnote", async () => {
  const restoreDom = installDom();
  const noteText = "Première ligne de la note. Seconde ligne toujours dans la même note.";
  const restoreRenderer = setRenderer(renderer([paragraphWithRef("Un fait", 1)], [noteText]));
  try {
    const bytes = await exportDocx({}, {}, {
      markdown: `Un fait[^1].\n\n[^1]: Première ligne de la note.\n    Seconde ligne toujours dans la même note.`,
      title: "Livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const { footnotesXml } = await docxParts(bytes);
    assert.match(footnotesXml, /Première ligne de la note\. Seconde ligne toujours dans la même note\./);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("export DOCX : aucune définition orpheline ne se retrouve dans le corps du document", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(
    renderer([paragraphWithRef("Un fait notable", 1)], ["Source citée en référence."])
  );
  try {
    const bytes = await exportDocx({}, {}, {
      markdown: "Un fait notable[^1].\n\n[^1]: Source citée en référence.",
      title: "Livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const { documentXml } = await docxParts(bytes);
    assert.doesNotMatch(documentXml, /Source citée en référence/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("export EPUB : l'appel de note est cliquable et le lien de retour vers l'appel fonctionne", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(
    renderer([paragraphWithRef("Phrase avec une note", 1)], ["note 1"])
  );
  try {
    const bytes = await exportEpub({}, {}, {
      markdown: "Phrase avec une note[^1].\n\n[^1]: note 1",
      title: "Livre",
      author: "Autrice",
      sourcePath: "Manuscrit.md",
      segments: [],
    });
    const zip = await JSZip.loadAsync(bytes);
    const xhtml = await zip.file("OEBPS/chapitres.xhtml").async("string");

    // L'appel reste un lien cliquable vers la note.
    assert.match(xhtml, /<a href="#fn1"/);
    // La note contient un lien de retour vers l'appel — jamais retiré.
    assert.match(xhtml, /href="#fnref1"/);
    assert.match(xhtml, /note 1/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});
