import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder, MarkdownRenderer } from "obsidian";
import { Document, Packer } from "docx";
import JSZip from "jszip";
import { CSL_BIBLIOGRAPHY_ANCHOR_ATTR, CSL_BIBLIOGRAPHY_ANCHOR_MARKDOWN } from "../src/services/csl-bibliography-anchor.js";
import { applyContentVariant } from "../src/services/content-variant-render.js";
import { CitationEngineRegistry } from "../src/api/citation-engine.js";
import { CslCitationHost } from "../src/services/csl-citation-host.js";
import {
  applyNativeCslToStaticRender,
  createStaticDocumentId,
  CITATION_RENDER_CSS,
  STATIC_RENDER_ATTR,
  STATIC_RENDER_ATTR_VALUE,
} from "../src/services/pandoc-citation-static-csl.js";
import { registerPandocCitationReadingMode } from "../src/services/pandoc-citation-reading-mode.js";
import { inlineChildren, blockToParagraphs } from "../src/services/docx-blocks.js";
import { domToOdtContent } from "../src/services/export-odt.js";
import { previewTemplateCss, PreviewView } from "../src/views/preview-view.js";
import { compile, exportWithScope } from "../src/services/compile-export.js";
import { writeGeneratedIncluded } from "../src/services/book-composition.js";
import { exportEpub } from "../src/services/export-epub.js";
import { exportDocx } from "../src/services/export-docx.js";
import { exportOdt, cslBibliographyStyleXml } from "../src/services/export-odt.js";
import { renderManuscriptHtml } from "../src/services/export-render.js";
import { resolveDocumentCitationStyle } from "../src/services/document-citation-style.js";
import { createFakeVault } from "./helpers/fake-vault.js";

class TestDomNode {
  constructor(doc, tag, value = "") {
    this.ownerDocument = doc;
    this.nodeType = tag === "#text" ? 3 : 1;
    this.tagName = tag.toUpperCase();
    this.nodeValue = value;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.style = { setProperty: (name, value) => {
      this.attrs.set("style", `${this.attrs.get("style") ?? ""}${name}:${value};`);
    } };
    const classSet = new Set();
    this.classList = classSet;
    classSet.contains = (val) => classSet.has(val);
  }

  get parentElement() {
    return this.parentNode;
  }

  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get innerHTML() { return this.childNodes.map((node) => node.outerHTML).join(""); }
  get outerHTML() {
    if (this.nodeType === 3) return this.nodeValue.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    const attrs = [...this.attrs, ...(this.className ? [["class", this.className]] : [])].map(([name, value]) => ` ${name}="${value}"`).join("");
    return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  remove() { this.parentNode?.removeChild(this); }
  removeAttribute(name) { this.attrs.delete(name); }
  cloneNode(deep) {
    const clone = new TestDomNode(this.ownerDocument, this.nodeType === 3 ? "#text" : this.tagName, this.nodeValue);
    clone.className = this.className;
    for (const [name, value] of this.attrs) clone.setAttribute(name, value);
    if (deep) this.childNodes.forEach((child) => clone.appendChild(child.cloneNode(true)));
    return clone;
  }

  get className() {
    return [...this.classList].join(" ");
  }

  set className(value) {
    this.classList.clear();
    for (const name of value.split(/\s+/).filter(Boolean)) {
      this.classList.add(name);
    }
  }

  get textContent() {
    return this.nodeType === 3
      ? this.nodeValue
      : this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [];
    this.appendChild(this.ownerDocument.createTextNode(value));
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }

  appendChild(node) {
    return this.insertBefore(node, null);
  }

  insertBefore(node, reference) {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    this.childNodes.splice(index === -1 ? this.childNodes.length : index, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node) {
    const idx = this.childNodes.indexOf(node);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      node.parentNode = null;
    }
    return node;
  }

  replaceWith(...nodes) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    for (const node of nodes) {
      parent.insertBefore(node, this);
    }
    parent.removeChild(this);
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.nodeType === 1 && curr.matches(selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  matches(selector) {
    if (selector === "*") return true;
    const qualified = selector.match(/^([a-z]+)\[([a-z-]+)\]$/i);
    if (qualified) return this.tagName === qualified[1].toUpperCase() && this.attrs.has(qualified[2]);
    if (selector.startsWith(".")) {
      return selector.slice(1).split(".").every((name) => this.classList.has(name));
    }
    if (selector.startsWith("[")) {
      const match = selector.match(/\[([a-zA-Z0-9_-]+)(?:='([^']*)'|="([^"]*)")?\]/);
      if (match) {
        const attr = match[1];
        const val = match[2] || match[3];
        if (val !== undefined) return this.getAttribute(attr) === val;
        return this.attrs.has(attr);
      }
    }
    return this.tagName === selector.toUpperCase();
  }

  querySelectorAll(selector) {
    if (selector.includes(",")) return [...new Set(selector.split(",").flatMap((part) => this.querySelectorAll(part.trim())))];
    const matches = [];
    for (const node of this.childNodes) {
      if (node.nodeType === 1) {
        if (node.matches(selector)) matches.push(node);
        matches.push(...node.querySelectorAll(selector));
      }
    }
    return matches;
  }
}

class TestDomDocument {
  createTreeWalker(root) {
    const nodes = [];
    const visit = (node) => { if (node.nodeType === 3) nodes.push(node); else node.childNodes.forEach(visit); };
    visit(root);
    let index = 0;
    return { nextNode: () => nodes[index++] ?? null };
  }
  createElement(tag) {
    return new TestDomNode(this, tag);
  }

  createTextNode(value) {
    return new TestDomNode(this, "#text", value);
  }
}

let fixtureSeq = 0;
function createStaticCslFixture({
  docContent = "Some text [@doe2023].",
  provider = true,
  customEngineHandler = null,
} = {}) {
  const doc = new TestDomDocument();
  const root = new TFolder(`STATIC-TEST-${++fixtureSeq}`);
  const work = new TFolder(`${root.path}/Work`);
  const research = new TFolder(`${root.path}/Research`);
  const fileA = new TFile(`${work.path}/Chapter.md`, docContent);
  const bibFile = new TFile(`${research.path}/refs.bib`, "@article{doe2023, author={John Doe}, year={2023}}\n@article{smith2024, author={Jane Smith}, year={2024}}");
  const cslFile = new TFile(`${research.path}/style.csl`, "<style>Mock Style</style>");

  root.children = [work, research];
  work.parent = root;
  research.parent = root;
  work.children = [fileA];
  fileA.parent = work;
  fileA.stat = { mtime: 100, size: docContent.length };

  research.children = [bibFile, cslFile];
  bibFile.parent = research;
  bibFile.stat = { mtime: 100, size: bibFile.content.length };
  cslFile.parent = research;
  cslFile.stat = { mtime: 100, size: cslFile.content.length };

  const { vault, files } = createFakeVault([root, work, research, fileA, bibFile, cslFile]);
  vault.cachedRead = vault.read;
  const addFile = (path, content) => {
    const file = new TFile(path, content);
    const parentPath = path.slice(0, path.lastIndexOf("/"));
    const parent = files.get(parentPath) || root;
    file.parent = parent;
    file.stat = { mtime: 100, size: content.length };
    files.set(file.path, file);
    if (parent && parent.children) {
      parent.children.push(file);
    }
    return file;
  };
  const settings = {
    projectFolder: root.path,
    outputFolder: "_Sortie",
    compileFileName: "Export.md",
    level1Role: "chapitres",
    orders: {},
    folderPositions: {},
    projectMeta: {
      [root.path]: {
        pandocCitationPreviewStyle: "csl",
        researchFolderLinks: { [work.path]: research.path },
        folderWorkspaces: {
          Work: {
            version: 1,
            citekeyBibliographyPath: "refs.bib",
            citekeyCslPath: "style.csl",
          },
        },
      },
    },
  };

  const app = {
    vault,
    metadataCache: {
      getFileCache: () => ({ frontmatter: {} }),
    },
    workspace: {
      getLeavesOfType: () => [],
      getActiveFile: () => null,
    },
  };

  const registry = new CitationEngineRegistry();
  const requests = [];
  const disposed = [];

  const engine = {
    id: "feuillets-csl",
    name: "Static CSL Test Engine",
    version: "1.0",
    renderDocument: async (request) => {
      requests.push(request);
      if (customEngineHandler) {
        return customEngineHandler(request);
      }
      return {
        documentId: request.documentId,
        revision: request.revision,
        citations: request.clusters.map((cluster) => {
          const itemsText = cluster.items.map((it) => `${it.id}:${it.mode || "normal"}${it.locator ? `:${it.locator}` : ""}`).join("; ");
          const plainText = `(${itemsText})`;
          return {
            clusterId: cluster.id,
            plainText,
            content: [
              {
                type: "span",
                style: { fontStyle: "italic" },
                children: [{ type: "text", text: plainText }],
              },
            ],
          };
        }),
        bibliography: null,
        diagnostics: [],
      };
    },
    disposeDocument: (id) => disposed.push(id),
  };

  if (provider) {
    registry.register(engine);
  }

  const host = new CslCitationHost({
    app,
    getSettings: () => settings,
    citationRegistry: registry,
  });

  return {
    doc,
    app,
    settings,
    host,
    projectRoot: root,
    fileA,
    requests,
    disposed,
    engine,
    vault,
    files,
    addFile,
  };
}

// =========================================================================
// SECTION 25: SPECIFICATION TESTS (A through O)
// =========================================================================

function bibliographyResult(request, { layout = {}, entries, ...overrides } = {}) {
  const ids = [...new Set(request.clusters.flatMap((cluster) => cluster.items.map((item) => item.id)))].reverse();
  return {
    documentId: request.documentId, revision: request.revision,
    citations: request.clusters.map((cluster) => ({ clusterId: cluster.id, plainText: "Rendered citation", content: [{ type: "text", text: "Rendered citation" }] })),
    bibliography: {
      layout: { hangingIndent: true, entrySpacing: 2, lineSpacing: 1.5, ...layout },
      entries: entries ?? ids.map((id) => ({ itemIds: [id], plainText: `Plain ${id}`, content: [{ type: "span", style: { fontStyle: "italic", fontWeight: "bold", fontVariant: "small-caps", textDecoration: "underline" }, children: [{ type: "text", text: `Rich ${id}` }] }] })),
    },
    diagnostics: [], ...overrides,
  };
}

function bibliographyFixture(t, { source = "[@doe2023] [@smith2024] [@doe2023]", anchor = true, provider = true, handler = bibliographyResult } = {}) {
  const f = createStaticCslFixture({ docContent: source, provider, customEngineHandler: handler });
  t.after(() => f.host.dispose());
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  p.textContent = source;
  container.appendChild(p);
  const anchorEl = f.doc.createElement("div");
  anchorEl.setAttribute(CSL_BIBLIOGRAPHY_ANCHOR_ATTR, "true");
  anchorEl.setAttribute("hidden", "hidden");
  if (anchor) container.appendChild(anchorEl);
  const run = () => applyNativeCslToStaticRender({ app: f.app, settings: f.settings, host: f.host, projectRoot: f.projectRoot, container, sources: [{ path: f.fileA.path, text: source }], documentId: createStaticDocumentId("bibliography-test", f.projectRoot.path) });
  return { ...f, container, p, anchorEl, run };
}

test("Static bibliography: absent anchor does not request or insert bibliography", async (t) => {
  const f = bibliographyFixture(t, { anchor: false });
  assert.equal(await f.run(), true);
  assert.equal(f.requests[0].includeBibliography, false);
  assert.equal(f.container.querySelectorAll(".feuillets-csl-bibliography").length, 0);
});

test("Static bibliography: one request preserves provider order, deduplication and rich AST", async (t) => {
  const f = bibliographyFixture(t);
  assert.equal(await f.run(), true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].includeBibliography, true);
  assert.equal(f.requests[0].clusters.length, 3);
  const entries = f.container.querySelectorAll(".feuillets-csl-bibliography-entry");
  assert.deepEqual(entries.map((entry) => entry.textContent), ["Rich smith2024", "Rich doe2023"]);
  assert.equal(f.container.querySelectorAll(".feuillets-csl-font-italic").length, 2);
  assert.equal(f.container.querySelectorAll(".feuillets-csl-variant-small-caps").length, 2);
  assert.equal(f.container.querySelectorAll(`[${CSL_BIBLIOGRAPHY_ANCHOR_ATTR}]`).length, 0);
  assert.equal(f.container.textContent.includes("Plain"), false);
});

test("Static bibliography: core never sorts or deduplicates provider entries", async (t) => {
  const entries = ["Z first", "A second", "Z again"].map((text, index) => ({ itemIds: [index === 1 ? "doe2023" : "smith2024"], plainText: "Unused", content: [{ type: "text", text }] }));
  const f = bibliographyFixture(t, { handler: (req) => bibliographyResult(req, { entries }) });
  assert.equal(await f.run(), true);
  assert.deepEqual(f.container.querySelectorAll(".feuillets-csl-bibliography-entry").map((entry) => entry.textContent), ["Z first", "A second", "Z again"]);
});

test("Document citation style: explicit nested modes take precedence over inherited global settings", () => {
  const settings = { projectFolder: "Book", projectMeta: { Book: { pandocCitationPreviewStyle: "csl" }, "Book/Nested": { pandocCitationPreviewStyle: "off" } } };
  assert.equal(resolveDocumentCitationStyle(settings, "Book/Nested"), "off");
  settings.projectMeta["Book/Nested"].pandocCitationPreviewStyle = "author-date";
  assert.equal(resolveDocumentCitationStyle(settings, "Book//Nested"), "author-date");
  settings.projectMeta.Book.pandocCitationPreviewStyle = "off";
  settings.projectMeta["Book/Nested"].pandocCitationPreviewStyle = "csl";
  assert.equal(resolveDocumentCitationStyle(settings, "Book/Nested"), "csl");
  delete settings.projectMeta["Book/Nested"].pandocCitationPreviewStyle;
  settings.projectMeta.Book.pandocCitationPreviewStyle = "author-date";
  assert.equal(resolveDocumentCitationStyle(settings, "Book/Nested"), "author-date");
});

test("Static bibliography: all AST nodes belong to the container ownerDocument", async (t) => {
  const f = bibliographyFixture(t);
  assert.equal(await f.run(), true);
  const verify = (node) => { assert.equal(node.ownerDocument, f.doc); node.childNodes.forEach(verify); };
  verify(f.container);
});

for (const [attribute, value] of [["hanging-indent", "true"], ["entry-spacing", "2"], ["line-spacing", "1.5"], ["second-field-align", "flush"], ["max-offset", "5"]]) {
  test(`Static bibliography: provider ${attribute} is preserved semantically and styled`, async (t) => {
    const f = bibliographyFixture(t, { handler: (req) => bibliographyResult(req, { layout: { secondFieldAlign: "flush", maxOffset: 5 } }) });
    assert.equal(await f.run(), true);
    const bibliography = f.container.querySelector(".feuillets-csl-bibliography");
    assert.equal(bibliography.getAttribute(`data-csl-${attribute}`), value);
    for (const entry of bibliography.children.slice(1)) assert.equal(entry.getAttribute(`data-csl-${attribute}`), value);
    assert.match(CITATION_RENDER_CSS, /--csl-entry-spacing|--csl-line-spacing|--csl-label-width/);
  });
}

test("Static bibliography: numeric left-margin and right-inline retain their distinct roles", async (t) => {
  const entries = [1, 2].map((n) => ({ itemIds: [`key${n}`], plainText: `Plain ${n}`, content: [
    { type: "block", display: "left-margin", children: [{ type: "text", text: `[${n}]` }] },
    { type: "block", display: "right-inline", children: [{ type: "span", style: { fontStyle: "italic" }, children: [{ type: "text", text: `Reference ${n}` }] }] },
  ] }));
  const f = bibliographyFixture(t, { handler: (req) => bibliographyResult(req, { entries, layout: { secondFieldAlign: "flush", maxOffset: 4 } }) });
  assert.equal(await f.run(), true);
  assert.deepEqual(f.container.querySelectorAll(".feuillets-csl-left-margin").map((el) => el.textContent), ["[1]", "[2]"]);
  assert.deepEqual(f.container.querySelectorAll(".feuillets-csl-right-inline").map((el) => el.textContent), ["Reference 1", "Reference 2"]);
  assert.match(CITATION_RENDER_CSS, /grid-template-columns: var\(--csl-label-width/);
});

for (const [name, handler] of [
  ["diagnostic error", (req) => bibliographyResult(req, { diagnostics: [{ severity: "error", code: "UNKNOWN_CITEKEY", message: "Unknown key" }] })],
  ["null bibliography", (req) => ({ ...bibliographyResult(req), bibliography: null })],
  ["partial citations", (req) => bibliographyResult(req, { citations: bibliographyResult(req).citations.slice(1) })],
  ["engine error", () => { throw new Error("Engine failure"); }],
  ["invalid layout", (req) => bibliographyResult(req, { layout: { entrySpacing: "invalid" } })],
  ["non-finite layout", (req) => bibliographyResult(req, { layout: { entrySpacing: Infinity } })],
  ["empty bibliography with non-finite layout", (req) => bibliographyResult(req, { layout: { entrySpacing: Infinity }, entries: [] })],
]) {
  test(`Static bibliography: ${name} fails closed for both citations and bibliography`, async (t) => {
    const f = bibliographyFixture(t, { handler });
    const original = f.container.outerHTML;
    assert.equal(await f.run(), false);
    assert.equal(f.container.outerHTML, original);
    assert.equal(f.anchorEl.getAttribute("hidden"), "hidden");
    assert.equal(f.anchorEl.textContent, "");
    assert.equal(f.container.querySelectorAll(".feuillets-csl-citation").length, 0);
    assert.equal(f.container.querySelectorAll(".feuillets-csl-bibliography").length, 0);
  });
}

test("Static bibliography: absent provider leaves a hidden empty anchor and raw citations", async (t) => {
  const f = bibliographyFixture(t, { provider: false });
  const original = f.container.outerHTML;
  assert.equal(await f.run(), false);
  assert.equal(f.container.outerHTML, original);
  assert.match(CSL_BIBLIOGRAPHY_ANCHOR_MARKDOWN, /hidden="hidden"/);
  assert.match(CITATION_RENDER_CSS, /\[data-feuillets-csl-bibliography-anchor\] \{ display: none; \}/);
  assert.equal(blockToParagraphs(f.anchorEl, new Map(), {}).length, 0);
  assert.equal(domToOdtContent(f.anchorEl), "");
});

test("Static bibliography: no final citation makes no Host request and no empty heading", async (t) => {
  const f = bibliographyFixture(t, { source: "No citation remains." });
  assert.equal(await f.run(), false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.container.querySelectorAll("h1").length, 0);
  assert.equal(f.container.textContent, "No citation remains.");
});

test("Static bibliography: a valid empty bibliography removes only the anchor and has no heading", async (t) => {
  const f = bibliographyFixture(t, { handler: (req) => bibliographyResult(req, { entries: [] }) });
  assert.equal(await f.run(), true);
  assert.equal(f.container.querySelectorAll("h1").length, 0);
  assert.equal(f.container.querySelectorAll(`[${CSL_BIBLIOGRAPHY_ANCHOR_ATTR}]`).length, 0);
  assert.equal(f.container.querySelectorAll(".feuillets-csl-citation").length, 3);
});

test("Static bibliography: ContentVariant excludes source-only citations from the bibliography request", async (t) => {
  const f = bibliographyFixture(t);
  f.p.textContent = "[@doe2023]";
  const excluded = f.doc.createElement("div");
  excluded.className = "feuillets-semantic-role feuillets-role-solution";
  excluded.textContent = "[@smith2024]";
  f.container.insertBefore(excluded, f.p);
  applyContentVariant(f.container, { excludedRoles: ["solution"], questionAnswerSpace: "keep" });
  assert.equal(await f.run(), true);
  assert.deepEqual(f.requests[0].clusters.flatMap((cluster) => cluster.items.map((item) => item.id)), ["doe2023"]);
  assert.deepEqual(f.container.querySelectorAll(".feuillets-csl-bibliography-entry").map((entry) => entry.textContent), ["Rich doe2023"]);
});

test("Static bibliography: failing AST construction makes zero mutations", async (t) => {
  const f = bibliographyFixture(t);
  const original = f.container.outerHTML;
  const createElement = f.doc.createElement.bind(f.doc);
  f.doc.createElement = (tag) => { if (tag === "span") throw new Error("DOM creation failure"); return createElement(tag); };
  assert.equal(await f.run(), false);
  assert.equal(f.container.outerHTML, original);
});

test("Static bibliography: failure while constructing the second citation leaves the prepared bibliography detached", async (t) => {
  const f = bibliographyFixture(t);
  const original = f.container.outerHTML;
  const createTextNode = f.doc.createTextNode.bind(f.doc);
  let citationTexts = 0;
  f.doc.createTextNode = (value) => {
    if (value === "Rendered citation" && ++citationTexts === 2) throw new Error("Second citation creation failure");
    return createTextNode(value);
  };
  assert.equal(await f.run(), false);
  assert.equal(f.container.outerHTML, original);
});

function installBibliographyRender(t, doc) {
  const names = ["createDiv", "createEl", "document", "Node", "XMLSerializer"];
  const previous = new Map(names.map((name) => [name, globalThis[name]]));
  const render = MarkdownRenderer.render;
  const element = (tag, options = {}) => {
    const el = doc.createElement(tag);
    if (options.text) el.textContent = options.text;
    if (options.cls) el.className = options.cls;
    return el;
  };
  globalThis.createEl = element;
  globalThis.createDiv = (options) => element("div", options);
  globalThis.document = doc;
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.XMLSerializer = class { serializeToString(node) { return node.outerHTML; } };
  MarkdownRenderer.render = async (_app, markdown, container) => {
    for (const block of markdown.split(/\n\n+/).filter(Boolean)) {
      if (block.includes(CSL_BIBLIOGRAPHY_ANCHOR_ATTR)) {
        const anchor = element("div");
        anchor.setAttribute(CSL_BIBLIOGRAPHY_ANCHOR_ATTR, "true");
        anchor.setAttribute("hidden", "hidden");
        container.appendChild(anchor);
      } else {
        const heading = block.match(/^(#{1,6})\s+(.+)$/);
        container.appendChild(element(heading ? `h${heading[1].length}` : "p", { text: heading ? heading[2] : block }));
      }
    }
  };
  t.after(() => {
    for (const [name, value] of previous) globalThis[name] = value;
    MarkdownRenderer.render = render;
  });
}

test("Static bibliography: render pipeline preserves an empty hidden anchor supplied by the simulated MarkdownRenderer", async (t) => {
  const f = bibliographyFixture(t);
  installBibliographyRender(t, f.doc);
  const result = await renderManuscriptHtml(f.app, CSL_BIBLIOGRAPHY_ANCHOR_MARKDOWN, f.fileA.path);
  const anchor = result.containerEl.querySelector(`[${CSL_BIBLIOGRAPHY_ANCHOR_ATTR}]`);
  assert.ok(anchor);
  assert.equal(anchor.getAttribute("hidden"), "hidden");
  assert.equal(result.containerEl.textContent, "");
});

for (const style of ["off", "author-date"]) {
  test(`Native EPUB: ${style} preserves historical bibliography without calling the CSL Host`, async (t) => {
    const f = bibliographyFixture(t);
    installBibliographyRender(t, f.doc);
    f.settings.exportTemplate = "documentSimple";
    f.settings.projectMeta[f.projectRoot.path].pandocCitationPreviewStyle = style;
    writeGeneratedIncluded(f.settings.projectMeta[f.projectRoot.path], "bibliography", true);
    const result = await compile(f.app, f.settings, null, null, undefined, { writeOutput: false });
    assert.match(result.manuscript, /John Doe|Doe, John/);
    assert.doesNotMatch(result.manuscript, /data-feuillets-csl-bibliography-anchor/);
    const zip = await JSZip.loadAsync(await exportEpub(f.app, f.settings, {
      markdown: result.manuscript, segments: result.segments, sourcePath: f.fileA.path,
      title: "Historical book", author: "Author", projectRoot: f.projectRoot, cslHost: f.host,
      citationSettings: { style, bibliographyPath: `${f.projectRoot.path}/Research/refs.bib` },
    }));
    const xml = await zip.file("OEBPS/chapitres.xhtml").async("string");
    assert.equal(f.requests.length, 0);
    assert.doesNotMatch(xml, /class="feuillets-csl-bibliography/);
    assert.match(xml, /John Doe|Doe, John/);
    if (style === "off") assert.match(xml, /\[@doe2023\]/);
    else {
      assert.doesNotMatch(xml, /\[@doe2023\]/);
      assert.match(xml, /Doe, 2023/);
    }
  });
}

test("Native EPUB: disabled bibliography still renders CSL citations without requesting entries", async (t) => {
  const f = bibliographyFixture(t);
  installBibliographyRender(t, f.doc);
  f.settings.exportTemplate = "documentSimple";
  writeGeneratedIncluded(f.settings.projectMeta[f.projectRoot.path], "bibliography", false);
  const result = await compile(f.app, f.settings, null, null, undefined, { writeOutput: false, bibliographyMode: "csl" });
  const zip = await JSZip.loadAsync(await exportEpub(f.app, f.settings, {
    markdown: result.manuscript, segments: result.segments, sourcePath: f.fileA.path,
    title: "Book without bibliography", author: "Author", projectRoot: f.projectRoot, cslHost: f.host,
    citationSettings: { style: "csl", bibliographyPath: "" },
  }));
  const xml = await zip.file("OEBPS/chapitres.xhtml").async("string");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].includeBibliography, false);
  assert.match(xml, /Rendered citation/);
  assert.doesNotMatch(xml, /class="feuillets-csl-bibliography|Rich doe2023|Rich smith2024/);
});

for (const format of ["epub", "docx", "odt"]) {
  test(`Native ${format}: compiled CSL bibliography is a real structured export entry`, async (t) => {
    const f = bibliographyFixture(t);
    installBibliographyRender(t, f.doc);
    f.settings.exportTemplate = "documentSimple";
    writeGeneratedIncluded(f.settings.projectMeta[f.projectRoot.path], "bibliography", true);
    if (format === "docx") writeGeneratedIncluded(f.settings.projectMeta[f.projectRoot.path], "toc", true);
    const result = await compile(f.app, f.settings, null, null, undefined, { writeOutput: false, bibliographyMode: "csl" });
    const input = { markdown: result.manuscript, segments: result.segments, sourcePath: f.fileA.path, title: "Test book", author: "Test author", projectRoot: f.projectRoot, cslHost: f.host, citationSettings: { style: "csl", bibliographyPath: "" } };
    const exporter = { epub: exportEpub, docx: exportDocx, odt: exportOdt }[format];
    const zip = await JSZip.loadAsync(await exporter(f.app, f.settings, input));
    const xml = await zip.file({ epub: "OEBPS/chapitres.xhtml", docx: "word/document.xml", odt: "content.xml" }[format]).async("string");
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].includeBibliography, true);
    assert.match(xml, /Rich smith2024/);
    assert.match(xml, /Rich doe2023/);
    assert.doesNotMatch(xml, /Plain smith2024|Plain doe2023|data-feuillets-csl-bibliography-anchor="true"/);
    if (format === "epub") {
      assert.match(xml, /<section[^>]*class="feuillets-csl-bibliography"/);
      assert.match(xml, /<div[^>]*class="feuillets-csl-bibliography-entry"/);
      assert.match(xml, /data-csl-hanging-indent="true"/);
      assert.match(xml, /--csl-line-spacing/);
    } else if (format === "docx") {
      assert.ok(xml.indexOf("TOC") >= 0 && xml.indexOf("TOC") < xml.indexOf("Rich smith2024"));
      assert.match(xml, /<w:ind[^>]*w:hanging=/);
      assert.match(xml, /w:line="360"/);
      assert.match(xml, /<w:i/);
      assert.match(xml, /<w:smallCaps/);
    } else {
      assert.match(xml, /<text:p text:style-name="CSLBibliography1"/);
      assert.match(xml, /fo:text-indent="-28pt"/);
      assert.match(xml, /fo:line-height="150%"/);
      assert.match(xml, /text:style-name="Italic"/);
    }
  });
}

test("DOCX bibliography: numeric paragraphs preserve tabs, indentation, spacing and all inline typography", async (t) => {
  const f = bibliographyFixture(t, { handler: (req) => bibliographyResult(req, { layout: { secondFieldAlign: "margin", maxOffset: 5 }, entries: [{ itemIds: ["doe2023"], plainText: "Unused plain text", content: [
    { type: "block", display: "left-margin", children: [{ type: "text", text: "[1]" }] },
    { type: "block", display: "right-inline", children: [
      { type: "span", style: { fontStyle: "italic", fontWeight: "bold", fontVariant: "small-caps", textDecoration: "underline", verticalAlign: "superscript" }, children: [{ type: "text", text: "Numeric reference" }] },
      { type: "span", style: { verticalAlign: "subscript" }, children: [{ type: "text", text: "Subscript" }] },
    ] },
  ] }] }) });
  assert.equal(await f.run(), true);
  const paragraphs = blockToParagraphs(f.container.querySelector(".feuillets-csl-bibliography-entry"), new Map(), { fontSizePt: 12 });
  assert.equal(paragraphs.length, 1);
  const document = new Document({ sections: [{ children: paragraphs }] });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /w:hanging="840"/);
  assert.match(xml, /w:left="0"/);
  assert.match(xml, /w:after="720"/);
  assert.match(xml, /w:line="360"/);
  assert.match(xml, /<w:tab[^>]*w:pos="0"/);
  assert.match(xml, /<w:tab\/>/);
  for (const property of ["w:i", "w:b", "w:smallCaps", "w:u", "superscript", "subscript"]) assert.ok(xml.includes(property), property);
  assert.ok(xml.indexOf("[1]") < xml.indexOf("Numeric reference"));
});

test("ODT bibliography: numeric alignment emits paragraph styles and structured tab stops", async (t) => {
  const f = bibliographyFixture(t, { handler: (req) => bibliographyResult(req, { layout: { secondFieldAlign: "flush", maxOffset: 5 }, entries: [{ itemIds: ["doe2023"], plainText: "Unused", content: [
    { type: "block", display: "left-margin", children: [{ type: "text", text: "[1]" }] },
    { type: "block", display: "right-inline", children: [{ type: "span", style: { fontStyle: "italic" }, children: [{ type: "text", text: "Numeric entry" }] }] },
  ] }] }) });
  await f.run();
  const styles = new Map();
  const content = domToOdtContent(f.container, { bibliographyStyles: styles });
  const xml = [...styles].map(([name, layout]) => cslBibliographyStyleXml(name, layout)).join("") + content;
  assert.match(xml, /style:position="42pt"/);
  assert.match(xml, /fo:text-indent="-42pt"/);
  assert.match(xml, /fo:margin-bottom="36pt"/);
  assert.match(xml, /fo:line-height="150%"/);
  assert.match(xml, /\[1\]<text:tab\/><text:span text:style-name="Italic">Numeric entry/);
  assert.match(xml, /<text:p text:style-name="CSLBibliography1"/);
});

test("Native export: explicit nested root selects CSL before compilation even when global style is off", async (t) => {
  const f = bibliographyFixture(t);
  installBibliographyRender(t, f.doc);
  const nested = f.fileA.parent;
  const globalMeta = f.settings.projectMeta[f.projectRoot.path];
  f.settings.projectMeta[nested.path] = { ...globalMeta, pandocCitationPreviewStyle: "csl", citekeyBibliographyPath: "refs.bib", citekeyCslPath: "style.csl" };
  globalMeta.pandocCitationPreviewStyle = "off";
  writeGeneratedIncluded(globalMeta, "bibliography", true);
  const recorded = [];
  const compileFn = (...args) => { recorded.push(args[5]); return compile(...args); };
  const output = await exportWithScope(f.app, f.settings, { type: "project", projectRoot: nested.path }, "epub", "nested", null, null, compileFn, f.host);
  assert.ok(output);
  assert.equal(recorded[0].bibliographyMode, "csl");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].includeBibliography, true);
});

for (const enabled of [true, false]) {
  test(`Preview: nested CSL compilation ${enabled ? "includes" : "omits"} bibliography before rendering`, async (t) => {
    const f = bibliographyFixture(t);
    const nested = f.fileA.parent;
    f.settings.projectMeta[nested.path] = { pandocCitationPreviewStyle: "csl" };
    f.settings.projectMeta[f.projectRoot.path].pandocCitationPreviewStyle = "off";
    writeGeneratedIncluded(f.settings.projectMeta[f.projectRoot.path], "bibliography", enabled);
    const view = Object.create(PreviewView.prototype);
    view.plugin = { settings: f.settings, getProjectFolder: () => f.projectRoot };
    view.app = f.app;
    view.refreshGeneration = 1;
    const source = await view.collectSource(1, { type: "project", projectRoot: nested.path });
    assert.ok(source);
    assert.equal(source.projectRootPath, nested.path);
    assert.equal(source.markdown.includes(CSL_BIBLIOGRAPHY_ANCHOR_ATTR), enabled);
    assert.doesNotMatch(source.markdown, /# Bibliographie|# Bibliography/);
  });
}

test("Static CSL — Case A: simple citation [@doe2023] produces structured AST span", async () => {
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  const t = f.doc.createTextNode("Before [@doe2023] after.");
  p.appendChild(t);
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-a", f.projectRoot.path),
  });

  assert.equal(ok, true, "render should succeed");
  const spans = container.querySelectorAll(".feuillets-csl-citation");
  assert.equal(spans.length, 1, "exactly one citation span inserted");
  assert.equal(spans[0].getAttribute("data-csl-cluster-id")?.startsWith("citation:"), true);
  assert.equal(spans[0].getAttribute("data-cluster-id")?.startsWith("citation:"), true);
  assert.ok(spans[0].textContent.includes("doe2023:normal"));
  assert.equal(p.textContent, "Before (doe2023:normal) after.");
});

test("Static CSL — Case B: citation group [@doe2023; @smith2024] produces single cluster", async () => {
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  const t = f.doc.createTextNode("Group [@doe2023; @smith2024] test.");
  p.appendChild(t);
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-b", f.projectRoot.path),
  });

  assert.equal(ok, true);
  assert.equal(f.requests.length, 1);
  const cluster = f.requests[0].clusters[0];
  assert.equal(cluster.items.length, 2);
  assert.equal(cluster.items[0].id, "doe2023");
  assert.equal(cluster.items[1].id, "smith2024");

  const spans = container.querySelectorAll(".feuillets-csl-citation");
  assert.equal(spans.length, 1);
  assert.ok(spans[0].textContent.includes("doe2023:normal; smith2024:normal"));
});

test("Static CSL — Case C: locator [@doe2023, p. 42] is passed into cluster item", async () => {
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  p.appendChild(f.doc.createTextNode("Locator [@doe2023, p. 42] test."));
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-c", f.projectRoot.path),
  });

  assert.equal(ok, true);
  const item = f.requests[0].clusters[0].items[0];
  assert.equal(item.id, "doe2023");
  assert.equal(item.locator, "42");
  assert.equal(item.label, "page");
});

test("Static CSL — Case D: narrative citation @doe2023 is recognized in composite mode", async () => {
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  p.appendChild(f.doc.createTextNode("According to @doe2023 it works."));
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-d", f.projectRoot.path),
  });

  assert.equal(ok, true);
  const item = f.requests[0].clusters[0].items[0];
  assert.equal(item.id, "doe2023");
  assert.equal(item.mode, "composite");
});

test("Static CSL — Case E: multiple citations across multiple text nodes maintain document order", async () => {
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const p1 = f.doc.createElement("p");
  p1.appendChild(f.doc.createTextNode("First paragraph [@doe2023]."));
  const p2 = f.doc.createElement("p");
  p2.appendChild(f.doc.createTextNode("Second paragraph [@smith2024]."));
  container.appendChild(p1);
  container.appendChild(p2);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-e", f.projectRoot.path),
  });

  assert.equal(ok, true);
  assert.equal(f.requests[0].clusters.length, 2);
  assert.equal(f.requests[0].clusters[0].items[0].id, "doe2023");
  assert.equal(f.requests[0].clusters[1].items[0].id, "smith2024");
});

test("Static CSL — Case F: numeric sequential rendering format", async () => {
  const f = createStaticCslFixture({
    customEngineHandler: (req) => ({
      documentId: req.documentId,
      revision: req.revision,
      citations: req.clusters.map((c, i) => ({
        clusterId: c.id,
        plainText: `[${i + 1}]`,
        content: [{ type: "text", text: `[${i + 1}]` }],
      })),
      bibliography: null,
      diagnostics: [],
    }),
  });

  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  p.appendChild(f.doc.createTextNode("One [@doe2023], two [@smith2024], three [@doe2023]."));
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-f", f.projectRoot.path),
  });

  assert.equal(ok, true);
  assert.equal(p.textContent, "One [1], two [2], three [3].");
});

test("Static CSL — Case G: inline code `[@doe2023]` remains raw and excluded from CSL", async () => {
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  const code = f.doc.createElement("code");
  code.appendChild(f.doc.createTextNode("[@doe2023]"));
  p.appendChild(f.doc.createTextNode("See code: "));
  p.appendChild(code);
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-g", f.projectRoot.path),
  });

  assert.equal(ok, false, "no eligible citations should result in false");
  assert.equal(code.textContent, "[@doe2023]", "inline code text must remain raw");
  assert.equal(container.querySelectorAll(".feuillets-csl-citation").length, 0);
});

test("Static CSL — Case H: fenced code <pre><code>...</code></pre> remains raw", async () => {
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const pre = f.doc.createElement("pre");
  const code = f.doc.createElement("code");
  code.appendChild(f.doc.createTextNode("function test() { return '[@doe2023]'; }"));
  pre.appendChild(code);
  container.appendChild(pre);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-h", f.projectRoot.path),
  });

  assert.equal(ok, false);
  assert.equal(container.querySelectorAll(".feuillets-csl-citation").length, 0);
});

test("Static CSL — Case I: links and footnotes are protected from transformation", async () => {
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  const a = f.doc.createElement("a");
  a.setAttribute("href", "https://example.com");
  a.appendChild(f.doc.createTextNode("[@doe2023]"));
  p.appendChild(a);

  const fnSection = f.doc.createElement("section");
  fnSection.className = "footnotes";
  const fnP = f.doc.createElement("p");
  fnP.appendChild(f.doc.createTextNode("[@smith2024]"));
  fnSection.appendChild(fnP);

  container.appendChild(p);
  container.appendChild(fnSection);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-i", f.projectRoot.path),
  });

  assert.equal(ok, false);
  assert.equal(a.textContent, "[@doe2023]");
  assert.equal(fnP.textContent, "[@smith2024]");
});

test("Static CSL — Case J: engine diagnostic error triggers atomic fail-closed behavior", async () => {
  const f = createStaticCslFixture({
    customEngineHandler: (req) => ({
      documentId: req.documentId,
      revision: req.revision,
      citations: [],
      bibliography: null,
      diagnostics: [{ level: "error", message: "Fatal engine failure" }],
    }),
  });

  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  const rawText = "Paragraph with [@doe2023].";
  p.appendChild(f.doc.createTextNode(rawText));
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-j", f.projectRoot.path),
  });

  assert.equal(ok, false, "fail-closed must return false");
  assert.equal(p.textContent, rawText, "raw text must be 100% preserved");
  assert.equal(container.querySelectorAll(".feuillets-csl-citation").length, 0);
});

test("Static CSL — Case K: partial or incomplete engine result triggers atomic fail-closed behavior", async () => {
  const f = createStaticCslFixture({
    customEngineHandler: (req) => ({
      documentId: req.documentId,
      revision: req.revision,
      // Only returns citation for first cluster, omitting second
      citations: [
        {
          clusterId: req.clusters[0].id,
          plainText: "(Doe 2023)",
          content: [{ type: "text", text: "(Doe 2023)" }],
        },
      ],
      bibliography: null,
      diagnostics: [],
    }),
  });

  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  const rawText = "First [@doe2023] and second [@smith2024].";
  p.appendChild(f.doc.createTextNode(rawText));
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-k", f.projectRoot.path),
  });

  assert.equal(ok, false);
  assert.equal(p.textContent, rawText, "neither citation mutated");
  assert.equal(container.querySelectorAll(".feuillets-csl-citation").length, 0);
});

test("Static CSL — Case L: provider absent fails closed without DOM mutation", async () => {
  const f = createStaticCslFixture({ provider: false });

  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  const rawText = "Text with [@doe2023].";
  p.appendChild(f.doc.createTextNode(rawText));
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-l", f.projectRoot.path),
  });

  assert.equal(ok, false);
  assert.equal(p.textContent, rawText);

  // Also test host === null
  const okNull = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: null,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-l-null", f.projectRoot.path),
  });
  assert.equal(okNull, false);
});

test("Static CSL — Case M: zero citations in DOM results in zero host calls", async () => {
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  p.appendChild(f.doc.createTextNode("Plain text with no citations."));
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-m", f.projectRoot.path),
  });

  assert.equal(ok, false);
  assert.equal(f.requests.length, 0, "Host must never be called when DOM has 0 citations");
});

test("Static CSL — Case N: Host session is properly disposed in all scenarios (success and error)", async () => {
  const f = createStaticCslFixture();
  const docId = createStaticDocumentId("test-n", f.projectRoot.path);

  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  p.appendChild(f.doc.createTextNode("Citation [@doe2023]."));
  container.appendChild(p);

  await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: docId,
  });

  assert.equal(f.disposed.includes(docId), true, "disposeDocument must be called after success");

  // Error case
  const fError = createStaticCslFixture({
    customEngineHandler: () => {
      throw new Error("Simulated engine crash");
    },
  });
  const errorDocId = createStaticDocumentId("test-n-err", fError.projectRoot.path);
  const containerErr = fError.doc.createElement("div");
  const pErr = fError.doc.createElement("p");
  pErr.appendChild(fError.doc.createTextNode("Citation [@doe2023]."));
  containerErr.appendChild(pErr);

  await applyNativeCslToStaticRender({
    app: fError.app,
    settings: fError.settings,
    host: fError.host,
    projectRoot: fError.projectRoot,
    container: containerErr,
    sources: [{ path: fError.fileA.path }],
    documentId: errorDocId,
  });

  assert.equal(fError.disposed.includes(errorDocId), true, "disposeDocument must be called after error");
});

test("Static CSL — Case O: ContentVariant exclusion keeps removed citations out of CSL clusters", async () => {
  // If a section is removed by content variant, the DOM passed to applyNativeCslToStaticRender
  // only contains surviving text nodes.
  const f = createStaticCslFixture();
  const container = f.doc.createElement("div");
  const pIncluded = f.doc.createElement("p");
  pIncluded.appendChild(f.doc.createTextNode("Included section [@doe2023]."));
  container.appendChild(pIncluded);
  // Excluded section was removed by applyContentVariant prior to static CSL render

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [{ path: f.fileA.path }],
    documentId: createStaticDocumentId("test-o", f.projectRoot.path),
  });

  assert.equal(ok, true);
  assert.equal(f.requests[0].clusters.length, 1);
  assert.equal(f.requests[0].clusters[0].items[0].id, "doe2023");
});

// =========================================================================
// INTEGRATION TESTS: STATIC SURFACES & TYPOGRAPHY
// =========================================================================

test("Static CSL — Reading Mode post-processor skips static renders", async () => {
  const f = createStaticCslFixture();
  let registeredPostProcessor = null;
  const plugin = {
    app: f.app,
    settings: f.settings,
    cslCitationHost: f.host,
    registerMarkdownPostProcessor: (fn) => {
      registeredPostProcessor = fn;
    },
  };

  registerPandocCitationReadingMode(plugin);
  assert.ok(registeredPostProcessor, "reading post processor must be registered");

  const staticContainer = f.doc.createElement("div");
  staticContainer.setAttribute(STATIC_RENDER_ATTR, STATIC_RENDER_ATTR_VALUE);
  const p = f.doc.createElement("p");
  p.appendChild(f.doc.createTextNode("Static [@doe2023]."));
  staticContainer.appendChild(p);

  const context = { sourcePath: f.fileA.path };
  await registeredPostProcessor(staticContainer, context);

  // Since staticContainer has data-feuillets-static-render="true", post-processor exits immediately
  assert.equal(staticContainer.querySelectorAll(".feuillets-csl-citation").length, 0);
  assert.equal(p.textContent, "Static [@doe2023].", "unmodified by Reading Mode");
});

test("Static CSL — docx-blocks.ts maps CSL typographic classes to DOCX TextRun properties", () => {
  const doc = new TestDomDocument();
  const p = doc.createElement("p");

  const spanItalic = doc.createElement("span");
  spanItalic.className = "feuillets-csl-citation feuillets-csl-font-italic";
  spanItalic.appendChild(doc.createTextNode("(Doe, 2023)"));

  const spanBold = doc.createElement("span");
  spanBold.className = "feuillets-csl-citation feuillets-csl-weight-bold";
  spanBold.appendChild(doc.createTextNode("[1]"));

  const spanSmallCaps = doc.createElement("span");
  spanSmallCaps.className = "feuillets-csl-citation feuillets-csl-variant-small-caps";
  spanSmallCaps.appendChild(doc.createTextNode("Smith"));

  const spanUnderline = doc.createElement("span");
  spanUnderline.className = "feuillets-csl-citation feuillets-csl-decoration-underline";
  spanUnderline.appendChild(doc.createTextNode("Title"));

  const spanSup = doc.createElement("span");
  spanSup.className = "feuillets-csl-citation feuillets-csl-valign-sup";
  spanSup.appendChild(doc.createTextNode("42"));

  const spanSub = doc.createElement("span");
  spanSub.className = "feuillets-csl-citation feuillets-csl-valign-sub";
  spanSub.appendChild(doc.createTextNode("2"));

  p.appendChild(spanItalic);
  p.appendChild(spanBold);
  p.appendChild(spanSmallCaps);
  p.appendChild(spanUnderline);
  p.appendChild(spanSup);
  p.appendChild(spanSub);
  const runs = inlineChildren(p, new Map());
  assert.equal(runs.length, 6);

  const jsonRuns = runs.map((r) => JSON.stringify(r));
  assert.ok(jsonRuns[0].includes('"w:i"'), "italic mark expected");
  assert.ok(jsonRuns[1].includes('"w:b"'), "bold mark expected");
  assert.ok(jsonRuns[2].includes('"w:smallCaps"'), "smallCaps mark expected");
  assert.ok(jsonRuns[3].includes('"w:u"'), "underline mark expected");
  assert.ok(jsonRuns[4].includes('"superscript"'), "superscript mark expected");
  assert.ok(jsonRuns[5].includes('"subscript"'), "subscript mark expected");
});

test("Static CSL — export-odt.ts domToOdtContent maps CSL typographic classes to ODT XML styles", () => {
  const doc = new TestDomDocument();
  const p = doc.createElement("p");
  const span = doc.createElement("span");
  span.className = "feuillets-csl-citation feuillets-csl-font-italic";
  span.appendChild(doc.createTextNode("Italic Citation"));
  p.appendChild(span);

  const xml = domToOdtContent(p);
  assert.ok(xml.includes('text:style-name="Italic"'));
  assert.ok(xml.includes("Italic Citation"));
});

test("Static CSL — PreviewView previewTemplateCss contains CITATION_RENDER_CSS", () => {
  const tpl = {
    font: "Georgia",
    fontSize: "12pt",
    lineHeight: "1.5",
    margins: { top: "20mm", bottom: "20mm", left: "20mm", right: "20mm" },
    headings: {},
  };
  const css = previewTemplateCss(tpl);
  assert.ok(css.includes(".feuillets-csl-font-italic"));
  assert.ok(css.includes(".feuillets-csl-weight-bold"));
  assert.ok(css.includes(".feuillets-csl-variant-small-caps"));
  assert.ok(css.includes(".feuillets-csl-decoration-underline"));
  assert.ok(css.includes(".feuillets-csl-valign-sup"));
  assert.ok(css.includes(".feuillets-csl-valign-sub"));
});

test("Static CSL — static CSS classes definitions exist and are complete", () => {
  assert.ok(CITATION_RENDER_CSS.includes(".feuillets-csl-font-italic"));
  assert.ok(CITATION_RENDER_CSS.includes(".feuillets-csl-weight-bold"));
  assert.ok(CITATION_RENDER_CSS.includes(".feuillets-csl-variant-small-caps"));
  assert.ok(CITATION_RENDER_CSS.includes(".feuillets-csl-decoration-underline"));
  assert.ok(CITATION_RENDER_CSS.includes(".feuillets-csl-valign-sup"));
  assert.ok(CITATION_RENDER_CSS.includes(".feuillets-csl-valign-sub"));
});

test("Static CSL — Non-regression: Export Markdown (.md) preserves raw syntax [@citekey]", async () => {
  const f = createStaticCslFixture({ docContent: "# Chapter\n\nText with [@doe2023] raw citation." });
  const scope = { type: "file", projectRoot: f.projectRoot.path, path: f.fileA.path };
  const { exportWithScope } = await import("../src/services/compile-export.js");
  const outPath = await exportWithScope(f.app, f.settings, scope, "md", "export-test");

  assert.ok(outPath);
  const exportedFile = f.app.vault.getAbstractFileByPath(outPath);
  assert.ok(exportedFile);
  const content = await f.app.vault.read(exportedFile);
  assert.ok(content.includes("[@doe2023]"), "Markdown export must preserve raw citation syntax");
});

test("Static CSL — Continu Preview: multi-segment with text & renderText renders CSL citations in DOM", async () => {
  const f = createStaticCslFixture({ docContent: "First segment [@doe2023]." });
  const fileB = f.addFile(`${f.projectRoot.path}/Work/Chapter2.md`, "Second segment [@smith2024].");

  const container = f.doc.createElement("div");
  const p1 = f.doc.createElement("p");
  p1.appendChild(f.doc.createTextNode("First segment [@doe2023]."));
  const p2 = f.doc.createElement("p");
  p2.appendChild(f.doc.createTextNode("Second segment [@smith2024]."));
  container.appendChild(p1);
  container.appendChild(p2);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [
      { path: f.fileA.path, text: f.fileA.content, renderText: f.fileA.content },
      { path: fileB.path, text: fileB.content, renderText: fileB.content },
    ],
    documentId: createStaticDocumentId("test-continu-preview", f.projectRoot.path),
  });

  assert.equal(ok, true, "multi-segment render with text should succeed");
  const spans = container.querySelectorAll(".feuillets-csl-citation");
  assert.equal(spans.length, 2, "both citations rendered");
  assert.ok(spans[0].textContent.includes("doe2023:normal"));
  assert.ok(spans[1].textContent.includes("smith2024:normal"));
  assert.equal(p1.textContent, "First segment (doe2023:normal).");
  assert.equal(p2.textContent, "Second segment (smith2024:normal).");
});

test("Static CSL — Continu Preview fallback: multi-segment with only path reads via cachedRead and renders CSL", async () => {
  const f = createStaticCslFixture({ docContent: "First segment [@doe2023]." });
  const fileB = f.addFile(`${f.projectRoot.path}/Work/Chapter2.md`, "Second segment [@smith2024].");

  const container = f.doc.createElement("div");
  const p1 = f.doc.createElement("p");
  p1.appendChild(f.doc.createTextNode("First segment [@doe2023]."));
  const p2 = f.doc.createElement("p");
  p2.appendChild(f.doc.createTextNode("Second segment [@smith2024]."));
  container.appendChild(p1);
  container.appendChild(p2);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [
      { path: f.fileA.path },
      { path: fileB.path },
    ],
    documentId: createStaticDocumentId("test-continu-preview-fallback", f.projectRoot.path),
  });

  assert.equal(ok, true, "multi-segment render with only path should succeed via cachedRead fallback");
  const spans = container.querySelectorAll(".feuillets-csl-citation");
  assert.equal(spans.length, 2, "both citations rendered");
  assert.ok(spans[0].textContent.includes("doe2023:normal"));
  assert.ok(spans[1].textContent.includes("smith2024:normal"));
  assert.equal(p1.textContent, "First segment (doe2023:normal).");
  assert.equal(p2.textContent, "Second segment (smith2024:normal).");
});

test("Static CSL — Scope with mixed citing and non-citing segments: resolves and renders citations accurately", async () => {
  const f = createStaticCslFixture({ docContent: "Citing segment [@doe2023]." });
  const fileB = f.addFile(`${f.projectRoot.path}/Work/Chapter2.md`, "Non-citing segment with regular prose.");

  const container = f.doc.createElement("div");
  const p1 = f.doc.createElement("p");
  p1.appendChild(f.doc.createTextNode("Citing segment [@doe2023]."));
  const p2 = f.doc.createElement("p");
  p2.appendChild(f.doc.createTextNode("Non-citing segment with regular prose."));
  container.appendChild(p1);
  container.appendChild(p2);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: f.projectRoot,
    container,
    sources: [
      { path: f.fileA.path, text: f.fileA.content, renderText: f.fileA.content },
      { path: fileB.path, text: fileB.content, renderText: fileB.content },
    ],
    documentId: createStaticDocumentId("test-mixed-segments", f.projectRoot.path),
  });

  assert.equal(ok, true, "mixed segments render should succeed");
  const spans = container.querySelectorAll(".feuillets-csl-citation");
  assert.equal(spans.length, 1, "only citing segment citation rendered");
  assert.ok(spans[0].textContent.includes("doe2023:normal"));
  assert.equal(p1.textContent, "Citing segment (doe2023:normal).");
  assert.equal(p2.textContent, "Non-citing segment with regular prose.");
});

test("Static CSL — Scoped projectRoot: renders CSL using scoped projectRoot even when different from global root", async () => {
  const f = createStaticCslFixture({ docContent: "Global doc." });

  // Create nested book structure (ouvrage imbriqué)
  const nestedRoot = new TFolder(`${f.projectRoot.path}/Ouvrage`);
  const nestedWork = new TFolder(`${nestedRoot.path}/Work`);
  const nestedResearch = new TFolder(`${nestedRoot.path}/Research`);
  const nestedFile = new TFile(`${nestedWork.path}/Chapter.md`, "Nested chapter [@doe2023].");
  const nestedBib = new TFile(`${nestedResearch.path}/refs.bib`, "@article{doe2023, author={John Doe}, year={2023}}");
  const nestedCsl = new TFile(`${nestedResearch.path}/style.csl`, "<style>Nested Style</style>");

  nestedRoot.children = [nestedWork, nestedResearch];
  nestedWork.parent = nestedRoot;
  nestedResearch.parent = nestedRoot;
  nestedWork.children = [nestedFile];
  nestedFile.parent = nestedWork;
  nestedFile.stat = { mtime: 100, size: nestedFile.content.length };
  nestedResearch.children = [nestedBib, nestedCsl];
  nestedBib.parent = nestedResearch;
  nestedBib.stat = { mtime: 100, size: nestedBib.content.length };
  nestedCsl.parent = nestedResearch;
  nestedCsl.stat = { mtime: 100, size: nestedCsl.content.length };

  f.files.set(nestedRoot.path, nestedRoot);
  f.files.set(nestedWork.path, nestedWork);
  f.files.set(nestedResearch.path, nestedResearch);
  f.files.set(nestedFile.path, nestedFile);
  f.files.set(nestedBib.path, nestedBib);
  f.files.set(nestedCsl.path, nestedCsl);

  f.settings.projectMeta[nestedRoot.path] = {
    pandocCitationPreviewStyle: "csl",
    researchFolderLinks: { [nestedWork.path]: nestedResearch.path },
    folderWorkspaces: {
      Work: {
        version: 1,
        citekeyBibliographyPath: "refs.bib",
        citekeyCslPath: "style.csl",
      },
    },
  };

  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  p.appendChild(f.doc.createTextNode("Nested chapter [@doe2023]."));
  container.appendChild(p);

  const ok = await applyNativeCslToStaticRender({
    app: f.app,
    settings: f.settings,
    host: f.host,
    projectRoot: nestedRoot,
    container,
    sources: [{ path: nestedFile.path, text: nestedFile.content, renderText: nestedFile.content }],
    documentId: createStaticDocumentId("test-nested-root", nestedRoot.path),
  });

  assert.equal(ok, true, "scoped projectRoot render should succeed");
  const spans = container.querySelectorAll(".feuillets-csl-citation");
  assert.equal(spans.length, 1, "citation rendered under scoped projectRoot");
  assert.ok(spans[0].textContent.includes("doe2023:normal"));
  assert.equal(p.textContent, "Nested chapter (doe2023:normal).");
});

function addNoteCall(doc, parent, id, marker = "1") {
  const sup = doc.createElement("sup");
  sup.className = "footnote-ref";
  const link = doc.createElement("a");
  link.setAttribute("href", `#${encodeURIComponent(id)}`);
  link.setAttribute("id", `ref-${id}`);
  link.textContent = marker;
  sup.appendChild(link);
  parent.appendChild(sup);
  return sup;
}

function addNoteDefinitions(doc, container, definitions) {
  const section = doc.createElement("section");
  section.className = "footnotes";
  const ol = doc.createElement("ol");
  for (const [id, text] of definitions) {
    const li = doc.createElement("li");
    li.setAttribute("id", id);
    const paragraph = doc.createElement("p");
    paragraph.textContent = text;
    const backref = doc.createElement("a");
    backref.className = "footnote-backref";
    backref.setAttribute("href", `#ref-${id}`);
    backref.textContent = "↩";
    paragraph.appendChild(backref);
    li.appendChild(paragraph);
    ol.appendChild(li);
  }
  section.appendChild(ol);
  container.appendChild(section);
  return section;
}

function staticNoteInput(f, container) {
  return { app: f.app, settings: f.settings, host: f.host, projectRoot: f.projectRoot,
    container, sources: [{ path: f.fileA.path, text: f.fileA.content }],
    documentId: createStaticDocumentId("static-notes", f.projectRoot.path) };
}

test("Static notes: clusters interleave at first calls, irrespective of definition order", async (t) => {
  const f = createStaticCslFixture();
  t.after(() => f.host.dispose());
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  p.appendChild(f.doc.createTextNode("[@doe2023] "));
  addNoteCall(f.doc, p, "fn B");
  p.appendChild(f.doc.createTextNode(" [@smith2024] "));
  addNoteCall(f.doc, p, "fnA", "2");
  addNoteCall(f.doc, p, "fn B");
  container.appendChild(p);
  const notes = addNoteDefinitions(f.doc, container, [["fnA", "[@doe2023]"], ["fn B", "[@smith2024]"]]);
  assert.equal(await applyNativeCslToStaticRender(staticNoteInput(f, container)), true);
  assert.deepEqual(f.requests[0].clusters.map((cluster) => [cluster.items[0].id, cluster.noteIndex]), [
    ["doe2023", undefined], ["smith2024", 1], ["smith2024", undefined], ["doe2023", 2],
  ]);
  assert.equal(notes.querySelectorAll(".feuillets-csl-citation").length, 2);
  assert.equal(notes.querySelectorAll(".footnote-backref").length, 2);
  assert.equal(f.requests.length, 1);
});

test("Static notes: non-citing notes count and all citations in one note share an index", async (t) => {
  const f = createStaticCslFixture();
  t.after(() => f.host.dispose());
  const container = f.doc.createElement("div");
  const p = f.doc.createElement("p");
  addNoteCall(f.doc, p, "fn1");
  addNoteCall(f.doc, p, "fn2", "2");
  container.appendChild(p);
  addNoteDefinitions(f.doc, container, [["fn1", "Comment"], ["fn2", "[@doe2023] and [@smith2024]"]]);
  assert.equal(await applyNativeCslToStaticRender(staticNoteInput(f, container)), true);
  assert.deepEqual(f.requests[0].clusters.map((cluster) => cluster.noteIndex), [2, 2]);
});

test("Static notes: note-only citations populate the same CSL bibliography request", async (t) => {
  const f = bibliographyFixture(t, { source: "Text[^1].\n\n[^1]: [@doe2023]" });
  f.p.textContent = "Text";
  addNoteCall(f.doc, f.p, "fn1");
  const notes = addNoteDefinitions(f.doc, f.container, [["fn1", "[@doe2023]"]]);
  assert.equal(await f.run(), true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].includeBibliography, true);
  assert.equal(f.requests[0].clusters[0].noteIndex, 1);
  assert.equal(notes.querySelectorAll(".feuillets-csl-citation").length, 1);
  assert.deepEqual(f.container.querySelectorAll(".feuillets-csl-bibliography-entry").map((entry) => entry.textContent), ["Rich doe2023"]);
});

test("Static notes: ContentVariant orphan definitions have no index or bibliography entry", async (t) => {
  const f = bibliographyFixture(t);
  f.p.textContent = "Text";
  addNoteCall(f.doc, f.p, "fn2");
  const excluded = f.doc.createElement("p");
  excluded.className = "feuillets-semantic-role feuillets-role-solution";
  addNoteCall(f.doc, excluded, "fn1");
  f.container.insertBefore(excluded, f.p);
  applyContentVariant(f.container, { excludedRoles: ["solution"], questionAnswerSpace: "keep" });
  // Simulate a stale definition section retained by the Markdown renderer.
  const notes = addNoteDefinitions(f.doc, f.container, [["fn1", "[@smith2024]"], ["fn2", "[@doe2023]"]]);
  assert.equal(await f.run(), true);
  assert.deepEqual(f.requests[0].clusters.map((cluster) => [cluster.items[0].id, cluster.noteIndex]), [["doe2023", 1]]);
  assert.equal(notes.querySelectorAll("li")[0].textContent, "[@smith2024]↩");
  assert.deepEqual(f.container.querySelectorAll(".feuillets-csl-bibliography-entry").map((entry) => entry.textContent), ["Rich doe2023"]);
});

for (const failure of ["duplicate definition", "missing definition", "partial result", "null bibliography"]) {
  test(`Static notes: ${failure} preserves both body and note atomically`, async (t) => {
    const f = bibliographyFixture(t, { handler: (request) => bibliographyResult(request,
      failure === "partial result" ? { citations: [] } : failure === "null bibliography" ? { bibliography: null } : {}) });
    f.p.textContent = "[@smith2024] ";
    addNoteCall(f.doc, f.p, "fn1");
    addNoteDefinitions(f.doc, f.container, failure === "missing definition" ? [] :
      failure === "duplicate definition" ? [["fn1", "[@doe2023]"], ["fn1", "[@doe2023]"]] : [["fn1", "[@doe2023]"]]);
    const before = f.container.outerHTML;
    assert.equal(await f.run(), false);
    assert.equal(f.container.outerHTML, before);
  });
}

for (const format of ["docx", "epub", "odt"]) {
  test(`Native ${format}: rich CSL note stays a real linked note without raw citations`, async (t) => {
    const f = createStaticCslFixture({ docContent: "Text[^1].\n\n[^1]: [@doe2023]", customEngineHandler: (request) => ({
      documentId: request.documentId, revision: request.revision,
      citations: request.clusters.map((cluster) => ({ clusterId: cluster.id, plainText: "doe2023:normal",
        content: [{ type: "span", style: { fontStyle: "italic", fontWeight: "bold", fontVariant: "small-caps", textDecoration: "underline" }, children: [{ type: "text", text: "doe2023:normal" }] },
          { type: "span", style: { verticalAlign: "superscript" }, children: [{ type: "text", text: "sup" }] },
          { type: "span", style: { verticalAlign: "subscript" }, children: [{ type: "text", text: "sub" }] }],
      })), bibliography: null, diagnostics: [],
    }) });
    t.after(() => f.host.dispose());
    installBibliographyRender(t, f.doc);
    MarkdownRenderer.render = async (_app, _markdown, container) => {
      const p = f.doc.createElement("p");
      p.textContent = "Text";
      addNoteCall(f.doc, p, "fn1");
      addNoteCall(f.doc, p, "fn1");
      container.appendChild(p);
      addNoteDefinitions(f.doc, container, [["fn1", "See [@doe2023]."]]);
    };
    const exporter = { docx: exportDocx, epub: exportEpub, odt: exportOdt }[format];
    const zip = await JSZip.loadAsync(await exporter(f.app, f.settings, {
      markdown: f.fileA.content, sourcePath: f.fileA.path, title: "Notes", author: "Author",
      citationSettings: { style: "csl", bibliographyPath: "" }, cslHost: f.host, projectRoot: f.projectRoot,
    }));
    const xml = await zip.file({ docx: "word/footnotes.xml", epub: "OEBPS/chapitres.xhtml", odt: "content.xml" }[format]).async("string");
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].clusters[0].noteIndex, 1);
    assert.doesNotMatch(xml, /\[@doe2023\]/);
    assert.match(xml, /doe2023:normal/);
    if (format === "docx") {
      assert.match(xml, /<w:footnote w:id="1"/);
      for (const property of ["w:i", "w:b", "w:smallCaps", "w:u", "superscript", "subscript"]) assert.ok(xml.includes(property));
      assert.doesNotMatch(xml, /↩/);
      const body = await zip.file("word/document.xml").async("string");
      assert.match(body, /<w:footnoteReference/);
      assert.doesNotMatch(body, /doe2023:normal/);
    } else if (format === "epub") {
      assert.match(xml, /epub:type="footnotes"/);
      assert.match(xml, /feuillets-csl-font-italic/);
      assert.match(xml, /href="#ref-fn1"/);
      assert.equal((xml.match(/<li id="fn1"/g) ?? []).length, 1);
    } else {
      assert.match(xml, /<text:note text:id="Footnote1" text:note-class="footnote"/);
      assert.match(xml, /<text:note-ref text:ref-name="Footnote1"/);
      for (const style of ["Italic", "Bold", "SmallCaps", "Underline", "Superscript", "Subscript"]) assert.ok(xml.includes(`text:style-name="${style}"`));
      assert.doesNotMatch(xml, />Notes<\/text:h>|↩/);
      assert.equal((xml.match(/<text:note-body>/g) ?? []).length, 1);
    }
  });
}

test("Static notes: an unmappable split citation leaves body, notes and bibliography untouched", async (t) => {
  const f = bibliographyFixture(t);
  f.p.textContent = "[@smith2024] ";
  addNoteCall(f.doc, f.p, "fn1");
  const section = addNoteDefinitions(f.doc, f.container, [["fn1", ""]]);
  const p = section.querySelector("p");
  p.insertBefore(f.doc.createTextNode("[@doe"), p.firstChild);
  const em = f.doc.createElement("em");
  em.textContent = "2023";
  p.insertBefore(em, p.querySelector("a"));
  p.insertBefore(f.doc.createTextNode("]"), p.querySelector("a"));
  const before = f.container.outerHTML;
  assert.equal(await f.run(), false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.container.outerHTML, before);
});
