import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
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
import { inlineChildren } from "../src/services/docx-blocks.js";
import { domToOdtContent } from "../src/services/export-odt.js";
import { previewTemplateCss } from "../src/views/preview-view.js";
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
    const classSet = new Set();
    this.classList = classSet;
    classSet.contains = (val) => classSet.has(val);
  }

  get parentElement() {
    return this.parentNode;
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
    if (selector.startsWith(".")) {
      return this.classList.has(selector.slice(1));
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
