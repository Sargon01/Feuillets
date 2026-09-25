import test from "node:test";
import assert from "node:assert/strict";
import { MarkdownView, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  registerPandocCitationReadingMode,
  refreshPandocCitationReadingModeViews,
  wrapPandocCitationsInElement,
} from "../src/services/pandoc-citation-reading-mode.js";
import { buildPandocCitationCatalog } from "../src/services/pandoc-citation-preview.js";
import { parseBibtexCatalog } from "../src/services/bibtex-catalog.js";

if (typeof globalThis.Node === "undefined") {
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
}

/**
 * `createEl`/`createSpan` (global Obsidian DOM helpers): wrapPandocCitationsInElement()
 * calls them exactly as the real app would. Assigned from inside a function
 * (never at module top level — see cm-pandoc-citation-live-preview.test.js's own
 * comment on this: a top-level assignment leaks into tsc -p tsconfig.test.json's
 * single shared program and corrupts createEl's return type for unrelated
 * production files).
 */
class FakeReadingElement {
  constructor(tagName, text = "") {
    this.tagName = tagName ? tagName.toUpperCase() : "";
    this._text = text;
    this.childNodes = [];
    this.parentElement = null;
    this.attrs = {};
  }
  get textContent() {
    return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join("") : this._text;
  }
  set textContent(value) {
    this._text = value;
    this.childNodes = [];
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  appendChild(node) {
    if (node.parentElement) node.parentElement.removeChild(node);
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node, reference) {
    if (node.parentElement) node.parentElement.removeChild(node);
    const index = this.childNodes.indexOf(reference);
    node.parentElement = this;
    if (index === -1) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    node.parentElement = null;
    return node;
  }
  createEl(tag, options = {}) {
    const child = new FakeReadingElement(tag);
    if (options.cls) child.setAttribute("class", options.cls);
    this.appendChild(child);
    if (options.text) {
      const t = new FakeReadingTextNode(options.text);
      t.parentElement = child;
      t.ownerDocument = child.ownerDocument;
      child.childNodes.push(t);
    }
    return child;
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  get classes() {
    return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }
  matches(selector) {
    if (selector.startsWith(".")) return this.classes.includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.childNodes) {
      if (child.nodeType !== 1) continue;
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  /** Never dispatched by these tests — present so
   * buildPandocCitationElement()'s attachCitationTooltipBehavior() can
   * register its listeners without throwing at construction time (see the
   * identical comment in cm-pandoc-citation-live-preview.test.js). */
  addEventListener() {}
  removeEventListener() {}
}

class FakeReadingTextNode {
  constructor(text) {
    this._text = text;
    this.parentElement = null;
  }
  get nodeType() {
    return 3;
  }
  get nodeValue() {
    return this._text;
  }
  set nodeValue(value) {
    this._text = value;
  }
  get textContent() {
    return this._text;
  }
}

Object.defineProperty(FakeReadingElement.prototype, "nodeType", { get: () => 1 });

class FakeReadingDocument {
  constructor() {
    // buildPandocCitationElement() (pandoc-citation-preview.ts) now builds
    // the citation's root element via `ownerDocument.defaultView.createSpan(...)`
    // — never the global `createSpan()` — so it lands in the SAME (fake)
    // document as the text node it replaces, exactly like a real detached
    // Obsidian window would require.
    const doc = this;
    this.defaultView = {
      createEl(tag, options = {}) {
        const el = new FakeReadingElement(tag);
        el.ownerDocument = doc;
        if (options.cls) el.setAttribute("class", options.cls);
        if (options.text) el.textContent = options.text;
        return el;
      },
      createSpan(options = {}) {
        return this.createEl("span", options);
      },
    };
  }
  createTextNode(data) {
    return new FakeReadingTextNode(data);
  }
  createElement(tag) {
    const el = new FakeReadingElement(tag);
    el.ownerDocument = this;
    return el;
  }
}

function buildEl(tag) {
  const el = new FakeReadingElement(tag);
  el.ownerDocument = new FakeReadingDocument();
  return el;
}

function installFakeCreateEl() {
  globalThis.createEl = (tag, options = {}) => {
    const el = buildEl(tag);
    if (options.cls) el.setAttribute("class", options.cls);
    if (options.text) el.textContent = options.text;
    return el;
  };
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
}
installFakeCreateEl();

function appendText(el, text) {
  const t = new FakeReadingTextNode(text);
  t.parentElement = el;
  t.ownerDocument = el.ownerDocument;
  el.childNodes.push(t);
  return t;
}

function catalogFrom(bibtex) {
  return buildPandocCitationCatalog(parseBibtexCatalog(bibtex));
}

/** Text a reader actually sees: `Element.textContent` includes hidden
 * (`display: none`) descendants in a real DOM too, so the notice — CSS-hidden
 * by default (see styles.css) — must be excluded explicitly to compare against
 * what the paragraph visually reads as. */
function visibleText(el) {
  let out = "";
  const walk = (node) => {
    if (node.nodeType === 3) {
      out += node.nodeValue;
      return;
    }
    if (node.matches && node.matches(".feuillets-pandoc-citation-tooltip")) return;
    for (const child of node.childNodes) walk(child);
  };
  walk(el);
  return out;
}

test("Reading Mode: a simple citation is wrapped in .feuillets-pandoc-citation", () => {
  const p = buildEl("p");
  appendText(p, "Voir [@smith2024].");
  const catalog = catalogFrom("@article{smith2024, author = {Smith, John}, year = {2024}}");

  wrapPandocCitationsInElement(p, catalog);

  assert.equal(visibleText(p), "Voir (Smith, 2024).");
  const citations = p.querySelectorAll(".feuillets-pandoc-citation");
  assert.equal(citations.length, 1);
  assert.equal(citations[0].getAttribute("data-citekeys"), "smith2024");
});

test("Reading Mode: a citation with a page locator wraps correctly", () => {
  const p = buildEl("p");
  appendText(p, "Voir [@smith2024, p. 42].");
  const catalog = catalogFrom("@article{smith2024, author = {Smith, John}, year = {2024}}");

  wrapPandocCitationsInElement(p, catalog);

  assert.equal(visibleText(p), "Voir (Smith, 2024, p. 42).");
  const citation = p.querySelector(".feuillets-pandoc-citation");
  assert.equal(citation.getAttribute("data-citekeys"), "smith2024");
});

test("Reading Mode: a grouped citation wraps as one element with one notice per citekey", () => {
  const p = buildEl("p");
  appendText(p, "Voir [@smith2024; @doe2023].");
  const catalog = catalogFrom(
    "@article{smith2024, author = {Smith, John}, year = {2024}}\n" +
    "@book{doe2023, author = {Doe, Jane}, year = {2023}}"
  );

  wrapPandocCitationsInElement(p, catalog);

  assert.equal(visibleText(p), "Voir (Smith, 2024; Doe, 2023).");
  const citations = p.querySelectorAll(".feuillets-pandoc-citation");
  assert.equal(citations.length, 1);
  assert.equal(citations[0].getAttribute("data-citekeys"), "smith2024,doe2023");
  const notices = citations[0].querySelectorAll(".feuillets-pandoc-citation-notice");
  assert.equal(notices.length, 2);
});

test("Reading Mode: the notice carries role=tooltip, tabindex and an accessible relation", () => {
  const p = buildEl("p");
  appendText(p, "Voir [@smith2024].");
  const catalog = catalogFrom(
    '@article{smith2024, author = {Smith, John}, title = {A Study}, year = {2024}}'
  );

  wrapPandocCitationsInElement(p, catalog);

  const citation = p.querySelector(".feuillets-pandoc-citation");
  assert.equal(citation.getAttribute("tabindex"), "0");
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  assert.ok(tooltip);
  assert.equal(tooltip.getAttribute("role"), "tooltip");
  assert.equal(citation.getAttribute("aria-describedby"), tooltip.getAttribute("id"));
  assert.match(tooltip.textContent, /Smith, John \(2024\)/);
  assert.match(tooltip.textContent, /A Study/);
});

test("Reading Mode: matches the same rendered text and notice as Live Preview / plain text for identical input", () => {
  const bibtex = '@article{smith2024, author = {Smith, John}, title = {A Study}, year = {2024}}';
  const catalog = catalogFrom(bibtex);

  const p = buildEl("p");
  appendText(p, "Voir [@smith2024].");
  wrapPandocCitationsInElement(p, catalog);

  // Same recognition function used by the plain-text rewrite (see
  // pandoc-citation-preview.ts): the visible text must match exactly.
  assert.equal(visibleText(p), "Voir (Smith, 2024).");
});

test("Reading Mode: an unknown citekey stays raw, with no element and no notice", () => {
  const p = buildEl("p");
  appendText(p, "Voir [@unknownKey] et [@smith2024].");
  const catalog = catalogFrom("@article{smith2024, author = {Smith, John}, year = {2024}}");

  wrapPandocCitationsInElement(p, catalog);

  assert.equal(visibleText(p), "Voir [@unknownKey] et (Smith, 2024).");
  const citations = p.querySelectorAll(".feuillets-pandoc-citation");
  assert.equal(citations.length, 1, "only the resolvable citation is wrapped");
  assert.equal(citations[0].getAttribute("data-citekeys"), "smith2024");
});

test("Reading Mode: CODE, PRE, SCRIPT, STYLE and links are never transformed — bracket or narrative", () => {
  const catalog = catalogFrom("@article{smith2024, author = {Smith, John}, year = {2024}}");
  for (const tag of ["code", "pre", "script", "style", "a"]) {
    for (const text of ["Voir [@smith2024].", "Voir @smith2024 dit."]) {
      const el = buildEl(tag);
      appendText(el, text);
      wrapPandocCitationsInElement(el, catalog);
      assert.equal(el.textContent, text, `${tag} content is untouched`);
      assert.equal(el.querySelectorAll(".feuillets-pandoc-citation").length, 0);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Narrative citations: @who2021 → "World Health Organization (2021)".
 * ------------------------------------------------------------------ */

test("Reading Mode: a known narrative citation renders as Author (Year)", () => {
  const p = buildEl("p");
  appendText(p, "@who2021 souligne l'importance de la vaccination.");
  const catalog = catalogFrom(
    '@report{who2021, author = {{World Health Organization}}, year = {2021}}'
  );

  wrapPandocCitationsInElement(p, catalog);

  assert.equal(visibleText(p), "World Health Organization (2021) souligne l'importance de la vaccination.");
  const citation = p.querySelector(".feuillets-pandoc-citation");
  assert.ok(citation);
  assert.equal(citation.getAttribute("data-citekeys"), "who2021");
});

test("Reading Mode: an unknown narrative citekey stays raw", () => {
  const p = buildEl("p");
  appendText(p, "@unknownAuthor2021 souligne quelque chose.");
  const catalog = catalogFrom("@article{smith2024, author = {Smith, John}, year = {2024}}");

  wrapPandocCitationsInElement(p, catalog);

  assert.equal(visibleText(p), "@unknownAuthor2021 souligne quelque chose.");
  assert.equal(p.querySelectorAll(".feuillets-pandoc-citation").length, 0);
});

test("Reading Mode: an email address is never mistaken for a narrative citation", () => {
  const p = buildEl("p");
  appendText(p, "Contactez who2021@example.com pour plus d'informations.");
  const catalog = catalogFrom('@report{who2021, author = {{World Health Organization}}, year = {2021}}');

  wrapPandocCitationsInElement(p, catalog);

  assert.equal(visibleText(p), "Contactez who2021@example.com pour plus d'informations.");
  assert.equal(p.querySelectorAll(".feuillets-pandoc-citation").length, 0);
});

test("Reading Mode: an ordinary @mention that happens not to be a citekey stays raw", () => {
  const p = buildEl("p");
  appendText(p, "Merci @someone pour la relecture.");
  const catalog = catalogFrom('@report{who2021, author = {{World Health Organization}}, year = {2021}}');

  wrapPandocCitationsInElement(p, catalog);

  assert.equal(visibleText(p), "Merci @someone pour la relecture.");
  assert.equal(p.querySelectorAll(".feuillets-pandoc-citation").length, 0);
});

test("Reading Mode: a BibTeX title containing HTML is escaped — literal text, never an element", () => {
  const p = buildEl("p");
  appendText(p, "Voir [@htmltitle2021].");
  const catalog = catalogFrom(
    "@article{htmltitle2021, author = {Villain, Vera}, title = {<b>Bold</b> claims}, year = {2021}}"
  );

  wrapPandocCitationsInElement(p, catalog);

  const citation = p.querySelector(".feuillets-pandoc-citation");
  const lines = citation.querySelectorAll(".feuillets-pandoc-citation-notice-line");
  const titleLine = lines.find((l) => l.textContent.includes("claims"));
  assert.equal(titleLine.textContent, "<b>Bold</b> claims");
  assert.equal(citation.querySelectorAll("b").length, 0, "never interpreted as HTML");
});

test("Reading Mode: no citation is a link, has an href, or carries a click listener — no parasitic navigation", () => {
  const p = buildEl("p");
  appendText(p, "Voir [@smith2024].");
  const catalog = catalogFrom("@article{smith2024, author = {Smith, John}, year = {2024}}");

  wrapPandocCitationsInElement(p, catalog);

  const citation = p.querySelector(".feuillets-pandoc-citation");
  assert.equal(citation.tagName, "SPAN");
  assert.equal(citation.getAttribute("href"), null);
});

/* ------------------------------------------------------------------ *
 * registerPandocCitationReadingMode(): file/scope resolution and the
 * shared cache, through the real post-processor registration path.
 * ------------------------------------------------------------------ */

let fixtureCount = 0;

function createReadingModeFixture() {
  const suffix = ++fixtureCount;
  const project = new TFolder(`PROJECT-${suffix}`);
  const workA = new TFolder(`${project.path}/Work-A`);
  const workAExtra = new TFolder(`${project.path}/Work-A-Extra`);
  const docA = new TFile(`${project.path}/Work-A/DocA.md`);
  docA.content = "Voir [@smith2024].";
  const docAExtra = new TFile(`${project.path}/Work-A-Extra/DocAExtra.md`);
  docAExtra.content = "Voir [@doe2023].";
  project.children = [workA, workAExtra];
  workA.parent = project;
  workAExtra.parent = project;
  workA.children = [docA];
  workAExtra.children = [docAExtra];
  docA.parent = workA;
  docAExtra.parent = workAExtra;

  const researchA = new TFolder(`RESEARCH-${suffix}/Work-A-Research`);
  const bibA = new TFile(`RESEARCH-${suffix}/Work-A-Research/workA.bib`);
  bibA.content = "@article{smith2024, author = {Smith, John}, year = {2024}}";
  researchA.children = [bibA];
  bibA.parent = researchA;

  const researchAExtra = new TFolder(`RESEARCH-${suffix}/Work-A-Extra-Research`);
  const bibAExtra = new TFile(`RESEARCH-${suffix}/Work-A-Extra-Research/workAExtra.bib`);
  bibAExtra.content = "@article{doe2023, author = {Doe, Jane}, year = {2023}}";
  researchAExtra.children = [bibAExtra];
  bibAExtra.parent = researchAExtra;

  for (const f of [bibA, bibAExtra]) f.stat = { mtime: 1000, size: f.content.length };

  const { vault } = createFakeVault([
    project, workA, workAExtra, docA, docAExtra,
    researchA, bibA, researchAExtra, bibAExtra,
  ]);

  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        pandocCitationPreviewStyle: "author-date",
        researchFolderLinks: {
          [workA.path]: researchA.path,
          [workAExtra.path]: researchAExtra.path,
        },
        folderWorkspaces: {
          "Work-A": { version: 1, citekeyBibliographyPath: "workA.bib" },
          "Work-A-Extra": { version: 1, citekeyBibliographyPath: "workAExtra.bib" },
        },
      },
    },
  };

  return { app: { vault }, settings, project, workA, workAExtra, docA, docAExtra, bibA, bibAExtra };
}

function makeFakePlugin(f) {
  const processors = [];
  return {
    app: f.app,
    settings: f.settings,
    registerMarkdownPostProcessor(fn) {
      processors.push(fn);
      return fn;
    },
    run(el, sourcePath, { addChild } = {}) {
      const children = [];
      const ctx = {
        sourcePath,
        docId: "test",
        frontmatter: null,
        addChild: (child) => {
          children.push(child);
          addChild?.(child);
          return child;
        },
      };
      const result = processors[0](el, ctx);
      return Promise.resolve(result).then(() => children);
    },
  };
}

test("Reading Mode: resolveWorkspaceCitationResources scope — Work-A and Work-A-Extra never cross-resolve", async () => {
  const f = createReadingModeFixture();
  const plugin = makeFakePlugin(f);
  registerPandocCitationReadingMode(plugin);

  const pA = buildEl("p");
  appendText(pA, "Voir [@smith2024].");
  await plugin.run(pA, f.docA.path);
  assert.equal(visibleText(pA), "Voir (Smith, 2024).", "Work-A resolves its own citekey");

  const pAExtra = buildEl("p");
  appendText(pAExtra, "Voir [@doe2023].");
  await plugin.run(pAExtra, f.docAExtra.path);
  assert.equal(visibleText(pAExtra), "Voir (Doe, 2023).", "Work-A-Extra resolves its own citekey");

  const crossA = buildEl("p");
  appendText(crossA, "Voir [@doe2023].");
  await plugin.run(crossA, f.docA.path);
  assert.equal(visibleText(crossA), "Voir [@doe2023].", "Work-A never resolves Work-A-Extra's citekey");

  const crossAExtra = buildEl("p");
  appendText(crossAExtra, "Voir [@smith2024].");
  await plugin.run(crossAExtra, f.docAExtra.path);
  assert.equal(visibleText(crossAExtra), "Voir [@smith2024].", "Work-A-Extra never resolves Work-A's citekey");
});

test("Reading Mode: the shared BibTeX cache is not read again on repeated renders", async () => {
  const f = createReadingModeFixture();
  let reads = 0;
  const baseRead = f.app.vault.read.bind(f.app.vault);
  f.app.vault.read = async (file) => {
    reads += 1;
    return baseRead(file);
  };
  const plugin = makeFakePlugin(f);
  registerPandocCitationReadingMode(plugin);

  for (let i = 0; i < 5; i++) {
    const p = buildEl("p");
    appendText(p, "Voir [@smith2024].");
    await plugin.run(p, f.docA.path);
    assert.equal(visibleText(p), "Voir (Smith, 2024).");
  }

  assert.equal(reads, 1, "five renders of the same file trigger a single bibliography read");
});

test("Reading Mode: a render that produces citations registers a cleanup child; one without registers none", async () => {
  const f = createReadingModeFixture();
  const plugin = makeFakePlugin(f);
  registerPandocCitationReadingMode(plugin);

  const withCitation = buildEl("p");
  appendText(withCitation, "Voir [@smith2024].");
  const childrenWithCitation = await plugin.run(withCitation, f.docA.path);
  assert.equal(childrenWithCitation.length, 1, "one cleanup child registered for the one citation built");
  assert.doesNotThrow(() => childrenWithCitation[0].unload(), "unloading it (rerender/close) never throws");

  const withoutCitation = buildEl("p");
  appendText(withoutCitation, "Rien à citer ici.");
  const childrenWithoutCitation = await plugin.run(withoutCitation, f.docA.path);
  assert.equal(childrenWithoutCitation.length, 0, "no cleanup child when nothing was built — nothing to dispose");
});

test("Reading Mode: an unresolvable source path is a silent no-op, never a throw", async () => {
  const f = createReadingModeFixture();
  const plugin = makeFakePlugin(f);
  registerPandocCitationReadingMode(plugin);

  const p = buildEl("p");
  appendText(p, "Voir [@smith2024].");
  await assert.doesNotReject(() => plugin.run(p, "Nonexistent/Path.md"));
  assert.equal(p.textContent, "Voir [@smith2024].", "left raw: no file, no bibliography resolved");
});

test("Reading Mode: the Markdown source file is never written to", async () => {
  const f = createReadingModeFixture();
  const before = f.docA.content;
  f.app.vault.modify = async () => {
    throw new Error("Reading Mode must never write to the vault");
  };
  const plugin = makeFakePlugin(f);
  registerPandocCitationReadingMode(plugin);

  const p = buildEl("p");
  appendText(p, "Voir [@smith2024].");
  await plugin.run(p, f.docA.path);

  assert.equal(f.docA.content, before);
});

/* ------------------------------------------------------------------ *
 * refreshPandocCitationReadingModeViews(): re-render only the Reading Mode
 * leaves whose resolved bibliography is the one that changed.
 * ------------------------------------------------------------------ */

function fakeReadingModeLeaf({ file, mode, rerenderCalls }) {
  const view = Object.assign(new MarkdownView(), {
    file,
    getMode: () => mode,
    previewMode: { rerender: (full) => rerenderCalls.push(full) },
  });
  return { view };
}

test("Reading Mode: refreshPandocCitationReadingModeViews re-renders only the Reading leaves using the modified .bib", () => {
  const f = createReadingModeFixture();

  const rerenderA = [];
  const rerenderAExtra = [];
  const rerenderEditingA = [];
  const leafA = fakeReadingModeLeaf({ file: f.docA, mode: "preview", rerenderCalls: rerenderA });
  const leafAExtra = fakeReadingModeLeaf({ file: f.docAExtra, mode: "preview", rerenderCalls: rerenderAExtra });
  const leafEditingA = fakeReadingModeLeaf({ file: f.docA, mode: "source", rerenderCalls: rerenderEditingA });

  const app = {
    vault: f.app.vault,
    workspace: {
      getLeavesOfType: (type) => (type === "markdown" ? [leafA, leafAExtra, leafEditingA] : []),
    },
  };
  const plugin = { app, settings: f.settings };

  refreshPandocCitationReadingModeViews(plugin, f.bibA);

  assert.deepEqual(rerenderA, [true], "Work-A's Reading Mode view, using the modified .bib, is refreshed");
  assert.deepEqual(rerenderAExtra, [], "Work-A-Extra's view, using a different .bib, is never refreshed");
  assert.deepEqual(rerenderEditingA, [], "an editing-mode pane on the very same file is never refreshed");
});

test("Reading Mode: refreshPandocCitationReadingModeViews is a no-op when no leaf uses the modified .bib", () => {
  const f = createReadingModeFixture();
  const rerenderA = [];
  const leafA = fakeReadingModeLeaf({ file: f.docA, mode: "preview", rerenderCalls: rerenderA });

  const app = {
    vault: f.app.vault,
    workspace: { getLeavesOfType: (type) => (type === "markdown" ? [leafA] : []) },
  };
  const plugin = { app, settings: f.settings };

  assert.doesNotThrow(() => refreshPandocCitationReadingModeViews(plugin, f.bibAExtra));
  assert.deepEqual(rerenderA, []);
});
