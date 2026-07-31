import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { MarkdownRenderer } from "obsidian";
import { exportOdt } from "../src/services/export-odt.js";

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
  globalThis.document = { createElement: (tag) => element(tag) };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  return () => {
    globalThis.document = previousDocument;
    globalThis.Node = previousNode;
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
