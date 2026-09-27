import test from "node:test";
import assert from "node:assert/strict";
import { MarkdownRenderer } from "obsidian";
import { renderManuscriptHtml } from "../src/services/export-render.js";
import { PANDOC_CITATION_CLASS, PANDOC_CITATION_LABEL_CLASS, PANDOC_CITATION_TOOLTIP_CLASS } from "../src/services/pandoc-citation-preview.js";

/*
 * renderManuscriptHtml() is the ONE function every native static output
 * (PreviewView's paged Preview, PDF, EPUB, DOCX, ODT — see each exporter's
 * own afterVariant callback) funnels through — so proving the interactive
 * `.feuillets-pandoc-citation` markup (label + full bibliographic-notice
 * tooltip, produced by Reading Mode's registerMarkdownPostProcessor(),
 * pandoc-citation-reading-mode.ts, which MarkdownRenderer.render() invokes
 * for every render app-wide, this one included) is flattened HERE covers
 * all five outputs at once, per this task's own "one shared fix" requirement
 * — never duplicated per-exporter.
 *
 * Same small fake DOM/MarkdownRenderer-swap pattern as export-render-
 * captions.test.js (documented there, and originally in export-epub.test.js,
 * as "dupliqué plutôt que partagé" — this repo's own convention), extended
 * with class-selector support in querySelectorAll(), which those files never
 * needed (they only ever query by tag name).
 */

/** Shared, stateless fake `Document` — `flattenPandocCitationElementsForStaticRender()`
 * (pandoc-citation-preview.ts) calls `ownerDocument.createTextNode()`, and
 * applyDocumentLayoutMarkers() (document-layout.ts, run just after it in
 * renderManuscriptHtml()) calls `ownerDocument.createTreeWalker()` — a
 * singleton is enough for both; no test here needs two separate document
 * realms. */
const fakeDocument = {
  createTextNode: (text) => new FakeText(text),
  createTreeWalker: (root) => fakeCreateTreeWalker(root),
};

class FakeElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = fakeDocument;
    this._attributes = new Map(Object.entries(attrs));
  }
  get classes() {
    return (this._attributes.get("class") || "").split(/\s+/).filter(Boolean);
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
  closest() { return null; }
  matches(selector) {
    if (selector.startsWith(".")) return this.classes.includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches?.(selector)) found.push(child);
        if (child.querySelectorAll) visit(child);
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
    if (opts.cls) el.setAttribute("class", opts.cls);
    if (opts.text) el.textContent = opts.text;
    this.appendChild(el);
    return el;
  }
  createSpan(opts = {}) { return this.createEl("span", opts); }
  createDiv(opts = {}) { return this.createEl("div", opts); }
  empty() { this.children = []; }
}

/** A plain text node — just enough for the querySelectorAll traversal
 * above (optional-chained), for textContent aggregation, and for
 * applyDocumentLayoutMarkers()'s own createTreeWalker() scan (document-
 * layout.ts's markerTextNodes(), which reads `.nodeValue`/`.parentElement`
 * and calls `.remove()` is never invoked on a text node, but `appendChild()`
 * above unconditionally calls it on whatever it's given, so it's a no-op
 * here rather than absent). */
class FakeText {
  constructor(text) {
    this.textContent = text;
    this.parentElement = null;
  }
  get nodeValue() { return this.textContent; }
  set nodeValue(value) { this.textContent = value; }
  remove() {
    this.parentElement?.removeChild(this);
  }
}

/** Minimal `Document.createTreeWalker(root, SHOW_TEXT)` — document-layout.ts's
 * markerTextNodes() only ever calls `.nextNode()` on the result and reads
 * `.parentElement`/`.nodeValue` off what it returns, so a flat, pre-collected
 * document-order list of FakeText descendants is enough; no real DOM
 * NodeFilter/whatToShow semantics are needed by anything under test here. */
function collectTextNodesInOrder(root) {
  const out = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child instanceof FakeText) out.push(child);
      else visit(child);
    }
  };
  visit(root);
  return out;
}

function fakeCreateTreeWalker(root) {
  const nodes = collectTextNodesInOrder(root);
  let index = 0;
  return { nextNode: () => (index < nodes.length ? nodes[index++] : null) };
}

function installFakeDom() {
  const previousCreateEl = globalThis.createEl;
  const previousCreateDiv = globalThis.createDiv;
  globalThis.createEl = (tag, options = {}) => {
    const el = new FakeElement(tag);
    if (options.text) el.textContent = options.text;
    return el;
  };
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  return () => {
    globalThis.createEl = previousCreateEl;
    globalThis.createDiv = previousCreateDiv;
  };
}

function setRenderer(render) {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = render;
  return () => { MarkdownRenderer.render = previous; };
}

/** A citation element built by hand, matching exactly the DOM shape
 * `buildPandocCitationElement()` (pandoc-citation-preview.ts) produces —
 * standing in for what Reading Mode's post-processor would already have
 * wrapped in the container by the time MarkdownRenderer.render() resolves. */
function fakeInteractiveCitation(label, noticeLines) {
  const citation = new FakeElement("span", { class: PANDOC_CITATION_CLASS });
  const labelEl = new FakeElement("span", { class: PANDOC_CITATION_LABEL_CLASS });
  labelEl.appendChild(new FakeText(label));
  citation.appendChild(labelEl);
  const tooltip = new FakeElement("span", { class: PANDOC_CITATION_TOOLTIP_CLASS });
  const notice = new FakeElement("span", { class: "feuillets-pandoc-citation-notice" });
  for (const line of noticeLines) {
    const lineEl = new FakeElement("span", { class: "feuillets-pandoc-citation-notice-line" });
    lineEl.appendChild(new FakeText(line));
    notice.appendChild(lineEl);
  }
  tooltip.appendChild(notice);
  citation.appendChild(tooltip);
  return citation;
}

const NO_IMAGE_APP = {
  vault: { getAbstractFileByPath: () => null, readBinary: async () => new ArrayBuffer(0) },
  metadataCache: { getFirstLinkpathDest: () => null },
};

test("renderManuscriptHtml flattens an interactive citation to its plain label, no tooltip text survives", async () => {
  const restoreDom = installFakeDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const p = container.createEl("p");
    p.appendChild(new FakeText("Cette annexe confirme qu'un deuxième feuillet compilé contribue bien ses citations "));
    p.appendChild(fakeInteractiveCitation("(Smith, 2024)", ["Smith, John (2024)", "An Important Result", "Journal of Test Studies, 12(3), 45--61", "https://doi.org/10.1000/example.smith"]));
    p.appendChild(new FakeText("."));
  });
  try {
    const { containerEl } = await renderManuscriptHtml(NO_IMAGE_APP, "irrelevant", "Scene.md");
    assert.equal(containerEl.querySelectorAll(`.${PANDOC_CITATION_CLASS}`).length, 0);
    assert.equal(containerEl.querySelectorAll(`.${PANDOC_CITATION_TOOLTIP_CLASS}`).length, 0);
    const text = containerEl.textContent;
    assert.match(text, /\(Smith, 2024\)/);
    assert.equal(text.match(/\(Smith, 2024\)/g).length, 1, "citation label survives exactly once");
    assert.equal(/An Important Result|Journal of Test Studies|doi\.org/.test(text), false, "no bibliographic notice text leaks into the static render");
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("renderManuscriptHtml leaves ordinary prose (no citation markup at all) completely untouched", async () => {
  const restoreDom = installFakeDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const p = container.createEl("p", { text: "Rien à faire ici." });
    void p;
  });
  try {
    const { containerEl } = await renderManuscriptHtml(NO_IMAGE_APP, "irrelevant", "Scene.md");
    assert.equal(containerEl.textContent, "Rien à faire ici.");
  } finally {
    restoreRenderer();
    restoreDom();
  }
});
