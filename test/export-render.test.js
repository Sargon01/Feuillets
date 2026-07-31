import { test } from "node:test";
import assert from "node:assert/strict";
import { Component, MarkdownRenderer } from "obsidian";
import {
  preserveBlankLinesForFrontPage,
  renderManuscriptHtml,
  renderManuscriptHtmlWithFrontPages,
} from "../src/services/export-render.js";

class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.parentElement = null;
    this.children = [];
    this._attributes = new Map();
  }

  get textContent() {
    return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text;
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

  set className(value) {
    this.setAttribute("class", value);
  }

  get innerHTML() {
    if (!this.children.length) return this._text;
    return this.children.map((child) => child.outerHTML).join("");
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

  insertBefore(child, reference) {
    child.remove();
    child.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  replaceWith(replacement) {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    this.parentElement = null;
    replacement.remove();
    replacement.parentElement = parent;
    parent.children[index] = replacement;
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
    const parts = selectors.split(",").map((selector) => selector.trim());
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

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
}

function element(tag, text, attributes = {}) {
  const result = new FakeElement(tag, text);
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
  return result;
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  globalThis.document = { createElement: (tag) => element(tag) };
  globalThis.Image = class {
    naturalWidth = 640;
    naturalHeight = 480;
    set src(_value) { queueMicrotask(() => this.onload()); }
  };
  return () => {
    globalThis.document = previousDocument;
    globalThis.Image = previousImage;
  };
}

function fakeApp(files = []) {
  return {
    metadataCache: { getFirstLinkpathDest: (linkpath) => files.find((file) => file.path === linkpath) || null },
    vault: {
      getFiles: () => files,
      readBinary: async (file) => file.bytes,
    },
  };
}

function setRenderer(render) {
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = render;
  return () => { MarkdownRenderer.render = previousRender; };
}

test("renderManuscriptHtml : décharge toujours le composant et nettoie le DOM rendu", async () => {
  const restoreDom = installDom();
  const calls = [];
  const previousLoad = Component.prototype.load;
  const previousUnload = Component.prototype.unload;
  Component.prototype.load = () => calls.push("load");
  Component.prototype.unload = () => calls.push("unload");
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const paragraph = element("p", "Texte", { "data-footnote-id": "fn1", "data-line": "7" });
    container.appendChild(element("button", "Copier"));
    container.appendChild(element("span", "", { class: "callout-icon" }));
    container.appendChild(paragraph);
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    assert.deepEqual(calls, ["load", "unload"]);
    assert.equal(containerEl.querySelector("button"), null);
    assert.equal(containerEl.querySelector(".callout-icon"), null);
    assert.equal(containerEl.querySelector("p").getAttribute("data-line"), null);
    assert.equal(containerEl.querySelector("p").getAttribute("data-footnote-id"), "fn1");
  } finally {
    restoreRenderer();
    Component.prototype.load = previousLoad;
    Component.prototype.unload = previousUnload;
    restoreDom();
  }
});

test("renderManuscriptHtml : décharge le composant si le rendu Obsidian échoue", async () => {
  const restoreDom = installDom();
  const calls = [];
  const previousLoad = Component.prototype.load;
  const previousUnload = Component.prototype.unload;
  Component.prototype.load = () => calls.push("load");
  Component.prototype.unload = () => calls.push("unload");
  const restoreRenderer = setRenderer(async () => { throw new Error("rendu indisponible"); });
  try {
    await assert.rejects(renderManuscriptHtml(fakeApp(), "texte", "Source.md"), /rendu indisponible/);
    assert.deepEqual(calls, ["load", "unload"]);
  } finally {
    restoreRenderer();
    Component.prototype.load = previousLoad;
    Component.prototype.unload = previousUnload;
    restoreDom();
  }
});

test("renderManuscriptHtml : extrait et retire les notes de bas de page", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const section = element("section", "", { class: "footnotes" });
    const note = element("li", "", { id: "fn1" });
    note.appendChild(element("p", "Une note "));
    note.appendChild(element("a", "↩", { class: "footnote-backref" }));
    section.appendChild(note);
    container.appendChild(section);
  });
  try {
    const { containerEl, footnotes } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    // `html` garde le lien de retour (aller-retour HTML/EPUB) ; `text`
    // (utilisé par DOCX) en reste privé — voir extractFootnotes.
    assert.deepEqual(footnotes, [
      { id: "fn1", html: '<p>Une note </p><a class="footnote-backref">↩</a>', text: "Une note" },
    ]);
    assert.equal(footnotes[0].html.includes("$1"), false);
    assert.equal(containerEl.querySelector("section.footnotes"), null);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("renderManuscriptHtml : retire un slash final des notes sans injecter $1", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const section = element("section", "", { class: "footnotes" });
    const note = element("li", "", { id: "fn-slash" });
    note.appendChild(element("p", "Une note / "));
    note.appendChild(element("a", "↩", { class: "footnote-backref" }));
    section.appendChild(note);
    container.appendChild(section);
  });
  try {
    const { footnotes } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    assert.deepEqual(footnotes, [
      { id: "fn-slash", html: '<p>Une note</p><a class="footnote-backref">↩</a>', text: "Une note" },
    ]);
    assert.equal(footnotes[0].html.includes("$1"), false);
    assert.doesNotMatch(footnotes[0].html, /\/\s*<\/p>/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("renderManuscriptHtml : inline une image interne, conserve sa légende et isole son erreur", async () => {
  const restoreDom = installDom();
  const imageFile = { path: "assets/image.png", name: "image.png", basename: "image", extension: "png", bytes: new Uint8Array([1, 2, 3]).buffer };
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => errors.push(args);
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const embed = element("span", "", { class: "internal-embed", src: "assets/image.png" });
    embed.appendChild(element("img", "", { src: "app://vault/assets/image.png", alt: "Une légende" }));
    container.appendChild(embed);
    container.appendChild(element("img", "", { src: "https://example.test/image.png" }));
    container.appendChild(element("img", "", { src: "app://vault/missing.png" }));
  });
  try {
    const { containerEl, images } = await renderManuscriptHtml(fakeApp([imageFile]), "texte", "Source.md");
    const figure = containerEl.querySelector("figure");
    const image = figure.querySelector("img");
    assert.match(image.getAttribute("src"), /^data:image\/png;base64,AQID$/);
    assert.equal(figure.querySelector("figcaption").textContent, "Une légende");
    assert.deepEqual(images.get(image), { bytes: new Uint8Array([1, 2, 3]), ext: "png", width: 640, height: 480, caption: "Une légende" });
    assert.equal(containerEl.querySelectorAll("img")[1].getAttribute("src"), "https://example.test/image.png");
    assert.equal(errors.length, 0);
  } finally {
    restoreRenderer();
    console.error = previousError;
    restoreDom();
  }
});

test("renderManuscriptHtml : poursuit l'export lorsqu'une image interne est illisible", async () => {
  const restoreDom = installDom();
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => errors.push(args);
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("img", "", { src: "app://vault/image.png" }));
  });
  const app = fakeApp([{ path: "image.png", name: "image.png", extension: "png", bytes: new ArrayBuffer(0) }]);
  app.vault.readBinary = async () => { throw new Error("lecture impossible"); };
  try {
    const { containerEl, images } = await renderManuscriptHtml(app, "texte", "Source.md");
    assert.equal(images.size, 0);
    assert.equal(containerEl.querySelector("img").getAttribute("src"), "app://vault/image.png");
    assert.equal(errors.length, 1);
  } finally {
    restoreRenderer();
    console.error = previousError;
    restoreDom();
  }
});

test("renderManuscriptHtmlWithFrontPages : isole les pages Front et étiquette leurs rôles", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, markdown, container) => {
    for (const block of markdown.split("\n\n")) container.appendChild(element("p", block));
  });
  try {
    const segments = [{ frontType: "titre", text: "FEUILLETS-FPROLE:auteur\n\nHalim" }, { text: "Corps" }];
    const { containerEl } = await renderManuscriptHtmlWithFrontPages(fakeApp(), "ignoré", segments, "Source.md");
    const frontPage = containerEl.querySelector(".feuillets-frontpage-titre");
    assert.ok(frontPage);
    assert.equal(frontPage.querySelector("p").textContent, "Halim");
    assert.equal(frontPage.querySelector("p").getAttribute("data-fp-role"), "auteur");
    assert.equal(containerEl.querySelectorAll("p").at(-1).textContent, "Corps");
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("preserveBlankLinesForFrontPage : matérialise chaque ligne vide", () => {
  assert.equal(preserveBlankLinesForFrontPage("\nTitre\n\n\nAuteur\n"), " \n\nTitre\n\n \n\n \n\nAuteur\n\n ");
  assert.equal(preserveBlankLinesForFrontPage(""), " ");
});
