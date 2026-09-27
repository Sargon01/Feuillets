import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPandocCitationElement,
  flattenPandocCitationElementsForStaticRender,
  PANDOC_CITATION_CLASS,
  PANDOC_CITATION_LABEL_CLASS,
  PANDOC_CITATION_TOOLTIP_CLASS,
} from "../src/services/pandoc-citation-preview.js";

/**
 * Static render/export (Preview, PDF, EPUB, DOCX, ODT) must never show
 * Reading Mode's interactive `.feuillets-pandoc-citation` markup (label +
 * full bibliographic-notice tooltip) — flattenPandocCitationElementsForStaticRender()
 * (pandoc-citation-preview.ts) is the one shared fix, called once from
 * renderManuscriptHtml() (export-render.ts, see export-render-citation-
 * flatten.test.js for the wiring test).
 *
 * Same fake-DOM shape as pandoc-citation-tooltip.test.js (FakeElement/
 * FakeWindow/FakeDocument) — duplicated rather than shared, this repo's own
 * convention for these small per-file fake DOMs (see that file's own doc
 * comment) — extended with exactly what THIS function additionally needs:
 * `replaceWith`, `cloneNode`, and `Document.createTextNode`. Building
 * fixtures through the REAL `buildPandocCitationElement()` (not a
 * hand-rolled shape) means these tests exercise the exact DOM Reading Mode's
 * post-processor and Live Preview/Continu actually produce.
 */

class FakeStyle {
  removeProperty(name) {
    const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    delete this[camel];
  }
}

/** Minimal text node: just enough for `textContent` aggregation and to
 * survive the existing FakeElement.querySelectorAll() traversal below
 * (which calls `.matches()`/`.querySelectorAll()` on every child
 * unconditionally) without needing full Element behavior. */
class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
  }
  matches() {
    return false;
  }
  querySelectorAll() {
    return [];
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.attrs = {};
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this._text = "";
    this._listeners = new Map();
    this.style = new FakeStyle();
    this.rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    this._naturalWidth = 200;
    this._naturalHeight = 80;
  }
  get offsetWidth() {
    let width = this._naturalWidth;
    if (this.style.maxWidth !== undefined) width = Math.min(width, parseFloat(this.style.maxWidth));
    if (this.style.minWidth !== undefined) width = Math.max(width, parseFloat(this.style.minWidth));
    return width;
  }
  get offsetHeight() {
    let height = this._naturalHeight;
    if (this.style.maxHeight !== undefined) height = Math.min(height, parseFloat(this.style.maxHeight));
    return height;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  get classes() {
    return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentElement = null;
    return child;
  }
  remove() {
    this.parentElement?.removeChild(this);
  }
  /** `ChildNode.replaceWith` — flattenPandocCitationElementsForStaticRender()'s
   * own mechanism for swapping a citation element for a plain text node. */
  replaceWith(node) {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index !== -1) parent.children[index] = node;
    node.parentElement = parent;
    this.parentElement = null;
  }
  /** Deep clone — used by visibleCitationText()'s fallback path (label
   * unexpectedly missing) to compute tooltip-free text without mutating the
   * live citation element. */
  cloneNode(deep) {
    const clone = new FakeElement(this.tagName);
    clone.attrs = { ...this.attrs };
    clone.ownerDocument = this.ownerDocument;
    clone._text = this._text;
    if (deep) {
      for (const child of this.children) {
        const childClone = child.cloneNode ? child.cloneNode(true) : new FakeText(child.textContent);
        childClone.parentElement = clone;
        clone.children.push(childClone);
      }
    }
    return clone;
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag);
    child.ownerDocument = this.ownerDocument;
    if (options.cls) child.setAttribute("class", options.cls);
    if (options.text) child._text = options.text;
    this.appendChild(child);
    return child;
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this._text = value;
    this.children = [];
  }
  matches(selector) {
    if (selector.startsWith(".")) return this.classes.includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

class FakeWindow {
  constructor({ width = 1200, height = 800 } = {}) {
    this.innerWidth = width;
    this.innerHeight = height;
    this.ResizeObserver = undefined;
    this.document = null;
    this._timers = new Map();
    this._nextTimerId = 1;
  }
  createEl(tag, options = {}) {
    const el = new FakeElement(tag);
    el.ownerDocument = this.document;
    if (options.cls) el.setAttribute("class", options.cls);
    if (options.text) el._text = options.text;
    return el;
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  setTimeout(fn, delay) {
    const id = this._nextTimerId++;
    this._timers.set(id, { fn, delay });
    return id;
  }
  clearTimeout(id) {
    this._timers.delete(id);
  }
}

class FakeDocument {
  constructor(win) {
    this.defaultView = win;
    win.document = this;
    this.body = new FakeElement("body");
    this.body.ownerDocument = this;
  }
  createElement(tag) {
    const el = new FakeElement(tag);
    el.ownerDocument = this;
    return el;
  }
  createTextNode(text) {
    return new FakeText(text);
  }
}

function installFakeEnvironment() {
  const win = new FakeWindow();
  const doc = new FakeDocument(win);
  return { doc, win };
}

function recordFor(overrides = {}) {
  return {
    key: "smith2024",
    type: "article",
    title: "An Important Result",
    authors: ["Smith"],
    year: "2024",
    author: "Smith, John",
    journal: "Journal of Test Studies",
    doi: "10.1000/example.smith",
    ...overrides,
  };
}

/* --- 1/2/3. Ordinary citation: label + tooltip flattens to label only --- */

test("1/2/3. an interactive citation (label + tooltip) flattens to a single plain-text node holding only the label", () => {
  const { doc } = installFakeEnvironment();
  const container = doc.createElement("div");
  const records = new Map([["smith2024", recordFor()]]);
  const citation = buildPandocCitationElement("(Smith, 2024)", ["smith2024"], records, doc);
  container.appendChild(doc.createTextNode("Cette annexe confirme qu'un deuxième feuillet "));
  container.appendChild(citation);
  container.appendChild(doc.createTextNode(" compilé."));

  flattenPandocCitationElementsForStaticRender(container);

  assert.equal(container.querySelectorAll(`.${PANDOC_CITATION_CLASS}`).length, 0);
  assert.equal(container.querySelectorAll(`.${PANDOC_CITATION_TOOLTIP_CLASS}`).length, 0);
  const text = container.textContent;
  assert.equal(text, "Cette annexe confirme qu'un deuxième feuillet (Smith, 2024) compilé.");
  assert.equal(text.match(/\(Smith, 2024\)/g).length, 1, "(Smith, 2024) must survive exactly once");
  assert.equal(/An Important Result|Journal of Test Studies|10\.1000/.test(text), false, "no tooltip bibliographic text may leak");
});

/* --- 4. Grouped citation (several citekeys, one element) --- */

test("4. a grouped citation label ([@doe2023; @who2021]-style, one element) remains exactly once", () => {
  const { doc } = installFakeEnvironment();
  const container = doc.createElement("div");
  const records = new Map([
    ["doe2023", recordFor({ key: "doe2023", author: "Doe, Jane and Brown, Alex", year: "2023", title: "Example Two" })],
    ["who2021", recordFor({ key: "who2021", author: "World Health Organization", year: "2021", title: "Global Report" })],
  ]);
  const citation = buildPandocCitationElement("(Doe & Brown, 2023; World Health Organization, 2021)", ["doe2023", "who2021"], records, doc);
  container.appendChild(citation);

  flattenPandocCitationElementsForStaticRender(container);

  assert.equal(container.querySelectorAll(`.${PANDOC_CITATION_CLASS}`).length, 0);
  const text = container.textContent;
  assert.equal(text, "(Doe & Brown, 2023; World Health Organization, 2021)");
  assert.equal(text.match(/\(Doe & Brown, 2023;/g).length, 1);
});

/* --- 5. Narrative citation (bracket-less @key form) --- */

test("5. a narrative citation label (bracket-less @key form) keeps its own formatting exactly", () => {
  const { doc } = installFakeEnvironment();
  const container = doc.createElement("div");
  const records = new Map([["smith2024", recordFor()]]);
  const citation = buildPandocCitationElement("Smith (2024)", ["smith2024"], records, doc);
  container.appendChild(doc.createTextNode("Comme le montre "));
  container.appendChild(citation);
  container.appendChild(doc.createTextNode(", ce résultat est confirmé."));

  flattenPandocCitationElementsForStaticRender(container);

  assert.equal(container.textContent, "Comme le montre Smith (2024), ce résultat est confirmé.");
});

/* --- 6. Citation inside a footnote --- */

test("6. a citation nested inside a footnote element flattens too, tooltip-free, without touching the footnote's own text", () => {
  const { doc } = installFakeEnvironment();
  const container = doc.createElement("div");
  const footnote = doc.createElement("div");
  footnote.setAttribute("class", "footnote");
  const records = new Map([["smith2024", recordFor()]]);
  const citation = buildPandocCitationElement("(Smith, 2024)", ["smith2024"], records, doc);
  footnote.appendChild(doc.createTextNode("Voir "));
  footnote.appendChild(citation);
  footnote.appendChild(doc.createTextNode(" pour le détail."));
  container.appendChild(footnote);

  flattenPandocCitationElementsForStaticRender(container);

  assert.equal(container.querySelectorAll(`.${PANDOC_CITATION_TOOLTIP_CLASS}`).length, 0);
  assert.equal(footnote.textContent, "Voir (Smith, 2024) pour le détail.");
});

/* --- 7. Unresolved citekey: no record, so buildPandocCitationElement never builds a tooltip at all --- */

test("7. an unresolved citekey (no bibliography record, so no tooltip was ever built) is left with its label text unchanged", () => {
  const { doc } = installFakeEnvironment();
  const container = doc.createElement("div");
  const emptyRecords = new Map();
  const citation = buildPandocCitationElement("[@unknownkey]", ["unknownkey"], emptyRecords, doc);
  container.appendChild(citation);

  assert.equal(citation.querySelector(`.${PANDOC_CITATION_TOOLTIP_CLASS}`), null, "sanity: no tooltip was ever built for an unresolved key");

  flattenPandocCitationElementsForStaticRender(container);

  assert.equal(container.querySelectorAll(`.${PANDOC_CITATION_CLASS}`).length, 0);
  assert.equal(container.textContent, "[@unknownkey]");
});

/* --- Label missing (defensive fallback) --- */

test("if the label element is unexpectedly missing, the fallback strips the tooltip subtree first — it never leaks bibliographic text", () => {
  const { doc } = installFakeEnvironment();
  const container = doc.createElement("div");
  const citation = doc.createElement("span");
  citation.setAttribute("class", PANDOC_CITATION_CLASS);
  // No PANDOC_CITATION_LABEL_CLASS span — only a tooltip, simulating
  // corrupted/unexpected markup.
  const tooltip = doc.createElement("span");
  tooltip.setAttribute("class", PANDOC_CITATION_TOOLTIP_CLASS);
  tooltip.textContent = "Smith, John (2024)An Important ResultJournal of Test Studies";
  citation.appendChild(tooltip);
  container.appendChild(citation);

  flattenPandocCitationElementsForStaticRender(container);

  assert.equal(container.querySelectorAll(`.${PANDOC_CITATION_CLASS}`).length, 0);
  assert.equal(container.textContent, "", "never falls back to the citation's own textContent (which would include the tooltip)");
});

/* --- Plain text untouched: nothing to flatten --- */

test("plain text with no citation element at all is left completely untouched", () => {
  const { doc } = installFakeEnvironment();
  const container = doc.createElement("div");
  container.appendChild(doc.createTextNode("Rien à faire ici."));

  flattenPandocCitationElementsForStaticRender(container);

  assert.equal(container.textContent, "Rien à faire ici.");
});
