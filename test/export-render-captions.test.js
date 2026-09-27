import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { MarkdownRenderer } from "obsidian";
import { renderManuscriptHtml, realCaption } from "../src/services/export-render.js";

/*
 * Preview/PDF/EPUB caption pipeline — `realCaption` is the single semantic
 * rule (unchanged by this task); `inlineImages` (export-render.ts) builds
 * one <figure>/<figcaption> only for a REAL caption, never for a plain
 * embed's filename-as-alt or a wikilink size alias. Never previously
 * covered by an automated test (see the "images" audit before this task) —
 * these tests lock the existing, already-correct behavior in place.
 *
 * Same small fake DOM/MarkdownRenderer-swap pattern as export-epub.test.js
 * (documented there as "dupliqué plutôt que partagé", the repo's own
 * convention for this), extended with the bits export-epub.test.js never
 * needed: Element.closest (export-render.ts's resolveImageFile calls it)
 * and a synchronous Image stub (naturalSizeOf).
 */

class FakeElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this._attributes = new Map(Object.entries(attrs));
  }
  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent ?? "").join("") : (this._text ?? "");
  }
  set textContent(value) {
    this.children = [];
    this._text = value;
  }
  appendChild(child) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  replaceWith(node) {
    const parent = this.parentElement;
    if (!parent) return;
    const i = parent.children.indexOf(this);
    if (i >= 0) parent.children[i] = node;
    node.parentElement = parent;
    this.parentElement = null;
  }
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i >= 0) this.parentElement.children.splice(i, 1);
    this.parentElement = null;
  }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  getAttribute(name) { return this._attributes.has(name) ? this._attributes.get(name) : null; }
  removeAttribute(name) { this._attributes.delete(name); }
  closest() { return null; } // no ".internal-embed" wrapper in these fixtures
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.tagName === selector.toUpperCase()) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  createEl(tag, opts = {}) {
    const el = new FakeElement(tag);
    if (opts.text) el.textContent = opts.text;
    this.appendChild(el);
    return el;
  }
  createSpan(opts = {}) { return this.createEl("span", opts); }
  createDiv(opts = {}) { return this.createEl("div", opts); }
  empty() { this.children = []; }
}

function el(tag, attrs) {
  return new FakeElement(tag, attrs);
}

function installFakeDom() {
  const previousCreateEl = globalThis.createEl;
  const previousCreateDiv = globalThis.createDiv;
  const previousImage = globalThis.Image;
  const previousBtoa = globalThis.btoa;
  globalThis.createEl = (tag, options = {}) => el(tag).also((e) => { if (options.text) e.textContent = options.text; });
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  // naturalSizeOf(dataUri) sets el.onload/.onerror then el.src = dataUri —
  // fire onload synchronously-ish (microtask) with a fixed natural size.
  globalThis.Image = class {
    set src(_value) {
      queueMicrotask(() => {
        this.naturalWidth = 400;
        this.naturalHeight = 300;
        this.onload?.();
      });
    }
  };
  if (typeof globalThis.btoa !== "function") {
    globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
  }
  return () => {
    globalThis.createEl = previousCreateEl;
    globalThis.createDiv = previousCreateDiv;
    globalThis.Image = previousImage;
    globalThis.btoa = previousBtoa;
  };
}

// Tiny helper so createEl's arrow function above can set text inline.
FakeElement.prototype.also = function (fn) { fn(this); return this; };

function setRenderer(render) {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = render;
  return () => { MarkdownRenderer.render = previous; };
}

function makeApp(files) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    vault: {
      getAbstractFileByPath: (p) => byPath.get(p) || null,
      readBinary: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath) => {
        for (const f of byPath.values()) {
          if (f.path === linkpath || f.name === linkpath || f.basename === linkpath) return f;
        }
        return null;
      },
    },
  };
}

async function renderWithImage(imgAttrs, app) {
  const restoreDom = installFakeDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const p = container.createEl("p");
    const img = new FakeElement("img", imgAttrs);
    p.appendChild(img);
  });
  try {
    return await renderManuscriptHtml(app, "irrelevant", "Scene.md");
  } finally {
    restoreRenderer();
    restoreDom();
  }
}

test("realCaption: plain embed's own filename as alt is never a caption", () => {
  const file = new TFile("Chapter/image.png");
  file.name = "image.png";
  file.basename = "image";
  assert.equal(realCaption("image.png", file), "");
  assert.equal(realCaption("image", file), "");
  assert.equal(realCaption("IMAGE.PNG", file), ""); // case-insensitive match
});

test("realCaption: a numeric wikilink size alias (300, 300x200) is never a caption", () => {
  const file = new TFile("Chapter/image.png");
  file.name = "image.png";
  file.basename = "image";
  assert.equal(realCaption("300", file), "");
  assert.equal(realCaption("300x200", file), "");
});

test("realCaption: real caption text passes through untouched", () => {
  const file = new TFile("Chapter/image.png");
  file.name = "image.png";
  file.basename = "image";
  assert.equal(realCaption("Vue générale du site en 1923", file), "Vue générale du site en 1923");
});

test("realCaption: empty/absent alt is never a caption", () => {
  const file = new TFile("Chapter/image.png");
  file.name = "image.png";
  file.basename = "image";
  assert.equal(realCaption(null, file), "");
  assert.equal(realCaption("   ", file), "");
});

test("export DOM: a plain ![[image.png]] embed (alt = filename) produces no figure/figcaption at all", async () => {
  const image = new TFile("image.png");
  image.name = "image.png";
  image.basename = "image";
  image.extension = "png";
  const app = makeApp([image]);
  const { containerEl } = await renderWithImage({ src: "image.png", alt: "image.png" }, app);
  assert.equal(containerEl.querySelectorAll("figure").length, 0);
  assert.equal(containerEl.querySelector("img"), containerEl.children[0].children[0], "img is untouched, still directly in its <p>");
});

test("export DOM: a wikilink size alias (width='300', alt=filename) produces no caption either", async () => {
  const image = new TFile("image.png");
  image.name = "image.png";
  image.basename = "image";
  image.extension = "png";
  const app = makeApp([image]);
  const { containerEl } = await renderWithImage({ src: "image.png", alt: "image.png", width: "300" }, app);
  assert.equal(containerEl.querySelectorAll("figure").length, 0);
});

test("export DOM: ![Caption](image.png) produces exactly one <figure>, one <img>, one <figcaption> with the caption text", async () => {
  const image = new TFile("image.png");
  image.name = "image.png";
  image.basename = "image";
  image.extension = "png";
  const app = makeApp([image]);
  const { containerEl, images } = await renderWithImage({ src: "image.png", alt: "Vue générale du site en 1923" }, app);

  const figures = containerEl.querySelectorAll("figure");
  assert.equal(figures.length, 1);
  const figcaptions = figures[0].children.filter((c) => c.tagName === "FIGCAPTION");
  assert.equal(figcaptions.length, 1);
  assert.equal(figcaptions[0].textContent, "Vue générale du site en 1923");
  assert.equal(containerEl.querySelectorAll("img").length, 1);

  const [, info] = [...images.entries()][0];
  assert.equal(info.caption, "Vue générale du site en 1923");
});

test("export DOM: plain image export behavior is unaffected by this task (no regression)", async () => {
  const image = new TFile("image.png");
  image.name = "image.png";
  image.basename = "image";
  image.extension = "png";
  const app = makeApp([image]);
  const { containerEl, missingResources } = await renderWithImage({ src: "image.png", alt: "image.png" }, app);
  assert.equal(missingResources.length, 0);
  assert.equal(containerEl.querySelectorAll("img").length, 1);
});
