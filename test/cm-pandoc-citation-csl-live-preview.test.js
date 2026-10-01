/* Native CSL Live Preview Integration Tests (Lot 7B) */

import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder, editorInfoField, editorLivePreviewField } from "obsidian";

globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
};
import {
  createPandocCitationLivePreviewExtension,
  CslCitationWidget,
  CSL_LIVE_PREVIEW_DEBOUNCE_MS,
} from "../src/utils/cm-pandoc-citation-live-preview.js";
import {
  CslCitationHost,
  DEFAULT_CSL_PROVIDER_ID,
} from "../src/services/csl-citation-host.js";
import {
  CitationEngineRegistry,
} from "../src/api/citation-engine.js";
import {
  applyPandocCitationPreview,
} from "../src/services/pandoc-citation-preview.js";
import {
  registerPandocCitationReadingMode,
} from "../src/services/pandoc-citation-reading-mode.js";
import {
  createScriveningsCitationExtension,
} from "../src/utils/cm-scrivenings-citations.js";
import { createFakeVault } from "./helpers/fake-vault.js";

class FakeWidgetElement {
  constructor(tag, options = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this._text = options.text || "";
    const el = this;
    this.classList = {
      add(...classes) {
        const current = el.classes;
        for (const cls of classes) {
          if (!current.includes(cls)) current.push(cls);
        }
        el.setAttribute("class", current.join(" "));
      },
      remove(...classes) {
        const current = el.classes.filter((c) => !classes.includes(c));
        el.setAttribute("class", current.join(" "));
      },
      contains(cls) {
        return el.classes.includes(cls);
      },
    };
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  createEl(tag, options = {}) {
    const child = new FakeWidgetElement(tag, options);
    child.ownerDocument = this.ownerDocument;
    if (options.cls) child.setAttribute("class", options.cls);
    return this.appendChild(child);
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  get classes() {
    return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  set className(value) {
    this.setAttribute("class", value);
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
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this._text = value;
    this.children = [];
  }
  addEventListener() {}
  removeEventListener() {}
}

class FakeDocument {
  constructor() {
    const doc = this;
    this.defaultView = {
      createEl(tag, options = {}) {
        const el = new FakeWidgetElement(tag);
        el.ownerDocument = doc;
        if (options.cls) el.setAttribute("class", options.cls);
        return el;
      },
      createSpan(options = {}) {
        return this.createEl("span", options);
      },
    };
    this.win = this.defaultView;
  }
  createElement(tag) {
    const el = new FakeWidgetElement(tag);
    el.ownerDocument = this;
    return el;
  }
  createTextNode(text) {
    const el = new FakeWidgetElement("#text", { text });
    el.ownerDocument = this;
    return el;
  }
}

function makeFakeDoc(text) {
  const lines = text.split("\n");
  const starts = [];
  let pos = 0;
  for (const line of lines) {
    starts.push(pos);
    pos += line.length + 1;
  }
  return {
    length: text.length,
    toString() {
      return text;
    },
    lineAt(at) {
      let idx = 0;
      for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= at) idx = i;
        else break;
      }
      const from = starts[idx];
      return { from, to: from + lines[idx].length, text: lines[idx] };
    },
  };
}

function makeFakeView({
  text,
  file,
  app,
  selection = [{ from: 99999, to: 99999 }],
  livePreview = true,
  visibleRanges = null,
}) {
  const doc = makeFakeDoc(text);
  const dispatchCalls = [];
  const dom = new FakeWidgetElement("div");
  dom.ownerDocument = new FakeDocument();
  const view = {
    state: {
      doc,
      selection: { ranges: selection },
      field(f) {
        if (f === editorInfoField) return { app, file };
        if (f === editorLivePreviewField) return livePreview;
        return undefined;
      },
    },
    visibleRanges: visibleRanges ?? [{ from: 0, to: doc.length }],
    dispatch(spec) {
      dispatchCalls.push(spec);
    },
    dom,
  };
  view.dispatchCalls = dispatchCalls;
  return view;
}

let fixtureId = 0;
function createCslFixture(options = {}) {
  const fid = ++fixtureId;
  const project = new TFolder(`PROJECT-${fid}`);
  const research = new TFolder(`PROJECT-${fid}/Research`);
  const docFile = new TFile(`PROJECT-${fid}/Doc.md`);
  docFile.stat = { mtime: 1000, size: 100 };
  docFile.content = options.docContent ?? "Some text with [@smith2024].";

  const docBFile = new TFile(`PROJECT-${fid}/DocB.md`);
  docBFile.stat = { mtime: 1000, size: 100 };
  docBFile.content = "Other text with [@doe2023].";

  const bibFile = new TFile(`PROJECT-${fid}/Research/refs.bib`);
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 1000, size: 500 };
  bibFile.content = "@article{smith2024, author={Smith}, year={2024}}\n@article{doe2023, author={Doe}, year={2023}}\n@article{alpha, author={Alpha}, year={2020}}\n@article{beta, author={Beta}, year={2021}}\n@article{gamma, author={Gamma}, year={2022}}";

  const cslFile = new TFile(`PROJECT-${fid}/Research/style.csl`);
  cslFile.extension = "csl";
  cslFile.stat = { mtime: 1000, size: 300 };
  cslFile.content = "<style><info><title>Numeric</title></info></style>";

  project.children = [research, docFile, docBFile];
  research.parent = project;
  research.children = [bibFile, cslFile];
  bibFile.parent = research;
  cslFile.parent = research;
  docFile.parent = project;
  docBFile.parent = project;

  const { vault, files } = createFakeVault([
    project,
    research,
    docFile,
    docBFile,
    bibFile,
    cslFile,
  ]);

  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        pandocCitationPreviewStyle: options.style ?? "csl",
        researchFolderLinks: {
          [project.path]: research.path,
        },
        citekeyBibliographyPath: "refs.bib",
        citekeyCslPath: "style.csl",
      },
    },
  };

  const citationRegistry = new CitationEngineRegistry();
  const app = { vault };

  let providerCallCount = 0;
  const recordedRequests = [];
  const disposedDocuments = [];

  const provider = {
    id: DEFAULT_CSL_PROVIDER_ID,
    name: "Feuillets CSL",
    version: "2.0.0",
    renderDocument: async (req) => {
      providerCallCount++;
      recordedRequests.push(req);
      if (options.providerHandler) {
        return options.providerHandler(req);
      }
      return {
        documentId: req.documentId,
        revision: req.revision,
        citations: req.clusters.map((c, idx) => ({
          clusterId: c.id,
          plainText: `[${idx + 1}]`,
          content: [
            {
              type: "span",
              style: {},
              children: [{ type: "text", text: `[${idx + 1}]` }],
            },
          ],
        })),
        bibliography: null,
        diagnostics: [],
      };
    },
    disposeDocument: (id) => {
      disposedDocuments.push(id);
    },
  };

  if (options.registerProvider !== false) {
    citationRegistry.register(provider);
  }

  const host = new CslCitationHost({
    app,
    getSettings: () => settings,
    citationRegistry,
  });

  return {
    app,
    vault,
    files,
    settings,
    project,
    docFile,
    docBFile,
    bibFile,
    cslFile,
    host,
    citationRegistry,
    provider,
    getProviderCallCount: () => providerCallCount,
    recordedRequests,
    disposedDocuments,
  };
}

async function flush(ms = 0) {
  await new Promise((r) => setTimeout(r, ms));
  await new Promise((r) => setTimeout(r, 0));
}

function getDecoCount(decorations) {
  return Array.isArray(decorations) ? decorations.length : 0;
}

// ---------------------------------------------------------------------------
// 1. Whole-Document Correctness Test (Section 14)
// ---------------------------------------------------------------------------

test("CSL Live Preview: whole-document correctness with numeric ordering and viewport clipping", async () => {
  const text = `[@alpha]\n${"\n".repeat(80)}[@beta]`;
  const f = createCslFixture();

  const alphaClusterId = "citation:0:8";
  const betaClusterId = `citation:${text.indexOf("[@beta]")}:${text.indexOf("[@beta]") + 7}`;

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  // Set visibleRanges so only [@beta] is in view
  const betaPos = text.indexOf("[@beta]");
  const view = makeFakeView({
    text,
    file: f.docFile,
    app: f.app,
    visibleRanges: [{ from: betaPos - 10, to: text.length }],
  });

  const instance = new PluginClass(view);
  await flush(10);

  // Verify provider was called with whole document containing BOTH clusters
  assert.equal(f.getProviderCallCount(), 1);
  const lastReq = f.recordedRequests[0];
  assert.equal(lastReq.clusters.length, 2);
  assert.equal(lastReq.clusters[0].id, alphaClusterId);
  assert.equal(lastReq.clusters[1].id, betaClusterId);

  // Verify decorations: only beta is visible in the viewport, and its widget is [2] (NOT [1])
  const decos = instance.decorations;
  assert.equal(getDecoCount(decos), 1);
  assert.equal(decos[0].from, betaPos);
  assert.equal(decos[0].to, betaPos + 7);
  assert.ok(decos[0].widget instanceof CslCitationWidget);
  assert.equal(decos[0].widget.clusterId, betaClusterId);
  assert.equal(decos[0].widget.citation.plainText, "[2]");

  // Verify widget DOM rendering
  const dom = decos[0].widget.toDOM(view);
  assert.equal(dom.className, "feuillets-csl-citation");
  assert.equal(dom.textContent, "[2]");
});

// ---------------------------------------------------------------------------
// 2. Two Panes Same File (Section 33)
// ---------------------------------------------------------------------------

test("CSL Live Preview: two panes on same file have independent document sessions; destroying pane A keeps pane B intact", async () => {
  const text = "Shared file content with [@smith2024].";
  const f = createCslFixture();

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const viewA = makeFakeView({ text, file: f.docFile, app: f.app });
  const viewB = makeFakeView({ text, file: f.docFile, app: f.app });

  const instanceA = new PluginClass(viewA);
  const instanceB = new PluginClass(viewB);
  await flush(10);

  assert.equal(f.getProviderCallCount(), 2);
  const docIdA = f.recordedRequests[0].documentId;
  const docIdB = f.recordedRequests[1].documentId;
  assert.notEqual(docIdA, docIdB, "Pane A and Pane B must receive distinct documentIds");

  assert.equal(getDecoCount(instanceA.decorations), 1);
  assert.equal(getDecoCount(instanceB.decorations), 1);

  // Destroy pane A
  instanceA.destroy();
  assert.ok(f.disposedDocuments.includes(docIdA), "Pane A session must be disposed");
  assert.ok(!f.disposedDocuments.includes(docIdB), "Pane B session must NOT be disposed");

  // Pane B remains rendered and functional
  assert.equal(getDecoCount(instanceB.decorations), 1);
  assert.ok(instanceB.decorations[0].widget instanceof CslCitationWidget);
});

// ---------------------------------------------------------------------------
// 3. File Switch in Same View (Section 34)
// ---------------------------------------------------------------------------

test("CSL Live Preview: file switch in same view disposes old session and creates distinct session for new file", async () => {
  const f = createCslFixture();

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const view = makeFakeView({
    text: "Doc A with [@smith2024].",
    file: f.docFile,
    app: f.app,
  });

  const instance = new PluginClass(view);
  await flush(10);

  assert.equal(f.getProviderCallCount(), 1);
  const docIdA = f.recordedRequests[0].documentId;
  assert.equal(getDecoCount(instance.decorations), 1);
  assert.equal(instance.decorations[0].widget.citation.plainText, "[1]");

  // Switch file in same view
  const newText = "Doc B with [@doe2023].";
  const newDoc = makeFakeDoc(newText);
  view.state.doc = newDoc;
  view.state.field = (field) => {
    if (field === editorInfoField) return { app: f.app, file: f.docBFile };
    if (field === editorLivePreviewField) return true;
    return undefined;
  };
  view.visibleRanges = [{ from: 0, to: newText.length }];

  instance.update({ view, docChanged: true });
  await flush(10);

  assert.ok(f.disposedDocuments.includes(docIdA), "Old documentId must be disposed on file switch");
  assert.equal(f.getProviderCallCount(), 2);
  const docIdB = f.recordedRequests[1].documentId;
  assert.notEqual(docIdA, docIdB, "New file must have distinct documentId");

  assert.equal(getDecoCount(instance.decorations), 1);
  assert.equal(instance.decorations[0].widget.clusterId, "citation:11:21");
});

// ---------------------------------------------------------------------------
// 4. Document Edit / Revision Behavior (Section 35)
// ---------------------------------------------------------------------------

test("CSL Live Preview: editing and appending citations updates revisions and outputs without stale widgets", async () => {
  const f = createCslFixture();

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  let text = "[@alpha]";
  const view = makeFakeView({ text, file: f.docFile, app: f.app });
  const instance = new PluginClass(view);
  await flush(10);

  assert.equal(f.getProviderCallCount(), 1);
  assert.equal(getDecoCount(instance.decorations), 1);
  assert.equal(instance.decorations[0].widget.clusterId, "citation:0:8");
  assert.equal(instance.decorations[0].widget.citation.plainText, "[1]");

  // Append [@beta]
  text = "[@alpha]\n[@beta]";
  view.state.doc = makeFakeDoc(text);
  view.visibleRanges = [{ from: 0, to: text.length }];
  instance.update({ view, docChanged: true });

  // During debounce, decorations fail closed to raw markdown
  assert.equal(getDecoCount(instance.decorations), 0);

  // Wait for debounce to elapse
  await flush(CSL_LIVE_PREVIEW_DEBOUNCE_MS + 20);

  assert.equal(f.getProviderCallCount(), 2);
  assert.equal(getDecoCount(instance.decorations), 2);
  assert.equal(instance.decorations[0].widget.citation.plainText, "[1]");
  assert.equal(instance.decorations[1].widget.citation.plainText, "[2]");

  // Modify alpha to gamma
  text = "[@gamma]\n[@beta]";
  view.state.doc = makeFakeDoc(text);
  view.visibleRanges = [{ from: 0, to: text.length }];
  instance.update({ view, docChanged: true });

  await flush(CSL_LIVE_PREVIEW_DEBOUNCE_MS + 20);

  assert.equal(f.getProviderCallCount(), 3);
  assert.equal(getDecoCount(instance.decorations), 2);
  const clusterIds = instance.decorations.map((d) => d.widget.clusterId);
  assert.ok(clusterIds.includes("citation:0:8"));
  assert.ok(clusterIds.includes("citation:9:16"));
});

// ---------------------------------------------------------------------------
// 5. Selection / Viewport Changes Must NOT Call Provider (Section 36)
// ---------------------------------------------------------------------------

test("CSL Live Preview: cursor movement and viewport scroll do NOT call provider; cursor reveals raw syntax", async () => {
  const text = "Start [@smith2024] middle [@doe2023] end.";
  const f = createCslFixture();

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const view = makeFakeView({ text, file: f.docFile, app: f.app, selection: [{ from: 0, to: 0 }] });
  const instance = new PluginClass(view);
  await flush(10);

  assert.equal(f.getProviderCallCount(), 1);
  assert.equal(getDecoCount(instance.decorations), 2);

  // 1. Move cursor between citations (pos 20)
  view.state.selection = { ranges: [{ from: 20, to: 20 }] };
  instance.update({ view, selectionSet: true });
  assert.equal(f.getProviderCallCount(), 1, "Cursor move must not call provider");
  assert.equal(getDecoCount(instance.decorations), 2);

  // 2. Move cursor INSIDE smith2024 (pos 8) -> click-to-reveal raw syntax
  view.state.selection = { ranges: [{ from: 8, to: 8 }] };
  instance.update({ view, selectionSet: true });
  assert.equal(f.getProviderCallCount(), 1, "Cursor inside citation must not call provider");
  assert.equal(getDecoCount(instance.decorations), 1, "Overlapped citation must be undecorated");
  assert.equal(instance.decorations[0].widget.clusterId, "citation:26:36");

  // 3. Move cursor away
  view.state.selection = { ranges: [{ from: 0, to: 0 }] };
  instance.update({ view, selectionSet: true });
  assert.equal(f.getProviderCallCount(), 1, "Leaving citation must not call provider");
  assert.equal(getDecoCount(instance.decorations), 2, "Both citations refolded");

  // 4. Scroll viewport (only doe2023 in view)
  view.visibleRanges = [{ from: 25, to: text.length }];
  instance.update({ view, viewportChanged: true });
  assert.equal(f.getProviderCallCount(), 1, "Viewport scroll must not call provider");
  assert.equal(getDecoCount(instance.decorations), 1);
  assert.equal(instance.decorations[0].widget.clusterId, "citation:26:36");
});

// ---------------------------------------------------------------------------
// 6. Protected Contexts (Section 37)
// ---------------------------------------------------------------------------

test("CSL Live Preview: citations in protected contexts are never folded into CSL widgets", async () => {
  const text = `---
author: [@smith2024]
---
Valid [@smith2024] citation.

\`\`\`markdown
Code block [@smith2024]
\`\`\`

Inline \`[@smith2024]\` code.

<!-- Comment [@smith2024] -->

<pre>[@smith2024]</pre>

Wiki [[@smith2024]] link.

Escaped \\@[smith2024] citation.

URL https://example.com/@smith2024 and email test@smith2024.com
`;

  const f = createCslFixture();
  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const view = makeFakeView({ text, file: f.docFile, app: f.app });
  const instance = new PluginClass(view);
  await flush(10);

  // Exactly 1 citation should be folded: the valid "Valid [@smith2024] citation."
  assert.equal(getDecoCount(instance.decorations), 1);
  const deco = instance.decorations[0];
  const validStart = text.indexOf("[@smith2024] citation");
  assert.equal(deco.from, validStart);
  assert.equal(deco.to, validStart + 12);
});

// ---------------------------------------------------------------------------
// 7. Markdown Link Label vs Destination (Section 38)
// ---------------------------------------------------------------------------

test("CSL Live Preview: citation in markdown link label folds, while destination remains untouched", async () => {
  const text = "[see @doe2023](https://example.com) and [label](https://example.com/@doe2023)";
  const f = createCslFixture();

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const view = makeFakeView({ text, file: f.docFile, app: f.app });
  const instance = new PluginClass(view);
  await flush(10);

  assert.equal(getDecoCount(instance.decorations), 1);
  const deco = instance.decorations[0];
  assert.equal(deco.from, 5);
  assert.equal(deco.to, 13);
  assert.equal(deco.widget.clusterId, "citation:5:13");
});

// ---------------------------------------------------------------------------
// 8. CSL Syntax Coverage (Section 39)
// ---------------------------------------------------------------------------

test("CSL Live Preview: diverse Pandoc citation syntax shapes all fold into CslCitationWidgets", async () => {
  const text = [
    "[@smith2024]",
    "[@smith2024; @doe2023]",
    "[@smith2024, p. 42]",
    "[-@smith2024]",
    "[see @smith2024]",
    "@smith2024",
    "@{smith2024}",
  ].join("\n");

  const f = createCslFixture();
  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const view = makeFakeView({ text, file: f.docFile, app: f.app });
  const instance = new PluginClass(view);
  await flush(10);

  assert.equal(getDecoCount(instance.decorations), 7);
  for (const deco of instance.decorations) {
    assert.ok(deco.widget instanceof CslCitationWidget);
  }
});

// ---------------------------------------------------------------------------
// 9. Provider Appears / Disappears (Sections 31 & 32)
// ---------------------------------------------------------------------------

test("CSL Live Preview: provider appears dynamically wakes view; provider disappears returns to raw syntax", async () => {
  const text = "Testing [@smith2024].";
  const f = createCslFixture({ registerProvider: false });

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const view = makeFakeView({ text, file: f.docFile, app: f.app });
  const instance = new PluginClass(view);
  await flush(10);

  // Provider not yet registered: raw syntax (0 decorations)
  assert.equal(getDecoCount(instance.decorations), 0);

  // Feuillets CSL registers provider later
  f.citationRegistry.register(f.provider);
  await flush(20);

  // View should be awakened and decorated
  assert.equal(getDecoCount(instance.decorations), 1);
  assert.ok(instance.decorations[0].widget instanceof CslCitationWidget);

  // Provider unregisters
  f.citationRegistry.unregister(f.provider.id);
  await flush(20);

  // View returns to raw syntax
  assert.equal(getDecoCount(instance.decorations), 0);
});

// ---------------------------------------------------------------------------
// 10. Source Mode (Section 18)
// ---------------------------------------------------------------------------

test("CSL Live Preview: source mode shows raw Markdown and disposes CSL host session", async () => {
  const text = "Testing [@smith2024].";
  const f = createCslFixture();

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  // Live preview mode initially
  const view = makeFakeView({ text, file: f.docFile, app: f.app, livePreview: true });
  const instance = new PluginClass(view);
  await flush(10);

  assert.equal(getDecoCount(instance.decorations), 1);
  const docId = f.recordedRequests[0].documentId;

  // Switch to Source mode (editorLivePreviewField === false)
  view.state.field = (fld) => {
    if (fld === editorInfoField) return { app: f.app, file: f.docFile };
    if (fld === editorLivePreviewField) return false;
    return undefined;
  };
  instance.update({ view });

  // Must not have any decorations in Source mode
  assert.equal(getDecoCount(instance.decorations), 0);
  assert.ok(f.disposedDocuments.includes(docId), "Session must be disposed when entering Source mode");
});

// ---------------------------------------------------------------------------
// 11. Resource Invalidation Events (Sections 28, 29, 30)
// ---------------------------------------------------------------------------

test("CSL Live Preview: resource modify and invalidateAllResources wake subscribed views", async () => {
  const text = "Testing [@smith2024].";
  const f = createCslFixture();

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const view = makeFakeView({ text, file: f.docFile, app: f.app });
  const _instance = new PluginClass(view);
  await flush(10);

  assert.equal(f.getProviderCallCount(), 1);

  // Invalidate specific resource
  f.host.invalidateResource(f.bibFile.path);
  await flush(20);

  assert.equal(f.getProviderCallCount(), 2, "Resource invalidation must wake view");

  // Invalidate all resources (e.g. settings change)
  f.host.invalidateAllResources();
  await flush(20);

  assert.equal(f.getProviderCallCount(), 3, "Global invalidation must wake view");
});

// ---------------------------------------------------------------------------
// 12. Quarantine Verification (Sections 42, 43, 44)
// ---------------------------------------------------------------------------

test("Quarantine: style === 'csl' keeps Reading Mode raw (does not run legacy author-date)", () => {
  const f = createCslFixture();
  const registeredProcessors = [];
  const fakePlugin = {
    app: f.app,
    settings: f.settings,
    registerMarkdownPostProcessor: (fn) => registeredProcessors.push(fn),
    registerEvent: () => {},
  };

  registerPandocCitationReadingMode(fakePlugin);
  assert.equal(registeredProcessors.length, 1);

  const container = new FakeWidgetElement("div");
  const p = container.createEl("p");
  p.textContent = "Text with [@smith2024].";

  const context = {
    sourcePath: f.docFile.path,
    addChild: () => {},
  };

  registeredProcessors[0](container, context);

  // Must remain raw markdown!
  assert.equal(p.textContent, "Text with [@smith2024].");
});

test("Quarantine: style === 'csl' keeps Continu raw (does not build legacy decorations)", () => {
  const f = createCslFixture();
  const ext = createScriveningsCitationExtension(f.app, () => f.settings);
  assert.ok(ext, "Scrivenings citation extension created");
});

test("Quarantine: applyPandocCitationPreview does nothing when style === 'csl'", async () => {
  const f = createCslFixture();
  const container = new FakeWidgetElement("div");
  const p = container.createEl("p");
  p.textContent = "Text with [@smith2024].";

  await applyPandocCitationPreview(f.app, container, "csl", f.bibFile.path);

  // Must remain raw markdown!
  assert.equal(p.textContent, "Text with [@smith2024].");
});

// ---------------------------------------------------------------------------
// 13. Audit Invariants: ownerDocument, citekeyCslPath change, vault rename
// ---------------------------------------------------------------------------

test("CSL Live Preview: toDOM strictly uses view.dom.ownerDocument and creates all nodes on that document without global fallback", () => {
  const popoutDoc = new FakeDocument();
  popoutDoc.isPopout = true;

  const fakeView = {
    dom: {
      ownerDocument: popoutDoc,
    },
  };

  const citation = {
    clusterId: "c1",
    plainText: "(Smith 2024)",
    content: [
      {
        type: "span",
        style: { fontStyle: "italic" },
        children: [
          { type: "text", text: "Smith 2024" },
        ],
      },
    ],
  };

  const widget = new CslCitationWidget("c1", citation);
  const dom = widget.toDOM(fakeView);

  assert.equal(dom.ownerDocument, popoutDoc, "Root span must belong to popoutDoc");
  assert.equal(dom.ownerDocument.isPopout, true);
  assert.equal(dom.children.length, 1);
  assert.equal(dom.children[0].ownerDocument, popoutDoc, "Child span must belong to popoutDoc");
  assert.equal(dom.children[0].children[0].ownerDocument, popoutDoc, "Text node must belong to popoutDoc");
});

test("CSL Live Preview: changing citekeyCslPath from style A to style B invalidates old sessions and renders style B without reload", async () => {
  const f = createCslFixture();
  const text = "Citing [@smith2024].";

  // Create style B file in vault
  const styleBFile = new TFile(`${f.project.path}/Research/style-b.csl`);
  styleBFile.extension = "csl";
  styleBFile.stat = { mtime: 99999, size: 400 };
  styleBFile.content = "<style><info><title>Style B</title></info></style>";
  styleBFile.parent = f.cslFile.parent;
  f.cslFile.parent.children.push(styleBFile);
  f.files.set(styleBFile.path, styleBFile);

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const view = makeFakeView({ text, file: f.docFile, app: f.app });
  const instance = new PluginClass(view);
  await flush(10);

  assert.equal(getDecoCount(instance.decorations), 1);
  assert.equal(f.getProviderCallCount(), 1);
  const lastReq1 = f.recordedRequests[f.recordedRequests.length - 1];
  assert.equal(lastReq1.style.id, f.cslFile.path);

  // Switch project setting to style B (as user selects in project settings dropdown)
  f.settings.projectMeta[f.project.path].citekeyCslPath = "style-b.csl";

  // Trigger refreshCitationRendering (as project settings modal does)
  f.host.invalidateAllResources();
  await flush(20);

  // Existing Live Preview must be awakened and render with style B
  assert.equal(f.getProviderCallCount(), 2, "Live preview must re-render after CSL setting change");
  const lastReq2 = f.recordedRequests[f.recordedRequests.length - 1];
  assert.equal(lastReq2.style.id, styleBFile.path, "Render must resolve style B");
  assert.equal(getDecoCount(instance.decorations), 1);
});

test("CSL Live Preview: vault rename across .csl/.bib and other extensions invalidates resources", () => {
  const f = createCslFixture();
  let refreshCalled = false;
  const fakePlugin = {
    cslCitationHost: f.host,
    refreshCitationRendering() {
      refreshCalled = true;
      this.cslCitationHost?.invalidateAllResources();
    },
  };

  const handleRename = (file, oldPath) => {
    const ext = file.extension.toLowerCase();
    const oldExt = oldPath.split(".").pop()?.toLowerCase();
    if (ext === "bib" || ext === "csl" || oldExt === "bib" || oldExt === "csl") {
      fakePlugin.refreshCitationRendering();
    }
  };

  // 1. style.csl -> style.txt (oldExt is csl)
  refreshCalled = false;
  handleRename({ extension: "txt", path: "style.txt" }, "style.csl");
  assert.equal(refreshCalled, true, "Renaming .csl to .txt must trigger refresh");

  // 2. style.txt -> style.csl (new ext is csl)
  refreshCalled = false;
  handleRename({ extension: "csl", path: "style.csl" }, "style.txt");
  assert.equal(refreshCalled, true, "Renaming .txt to .csl must trigger refresh");

  // 3. refs.bib -> refs.txt (oldExt is bib)
  refreshCalled = false;
  handleRename({ extension: "txt", path: "refs.txt" }, "refs.bib");
  assert.equal(refreshCalled, true, "Renaming .bib to .txt must trigger refresh");

  // 4. refs.txt -> refs.bib (new ext is bib)
  refreshCalled = false;
  handleRename({ extension: "bib", path: "refs.bib" }, "refs.txt");
  assert.equal(refreshCalled, true, "Renaming .txt to .bib must trigger refresh");

  // 5. unrelated rename: note.md -> note2.md
  refreshCalled = false;
  handleRename({ extension: "md", path: "note2.md" }, "note.md");
  assert.equal(refreshCalled, false, "Renaming .md to .md must not trigger citation refresh");
});

test("CSL Live Preview: inline footnote with citation decorates only the citation span without absorbing note", async () => {
  const text = "^[Voir [@doe2023, p. 57] pour une discussion méthodologique.]";
  const f = createCslFixture();

  const PluginClass = createPandocCitationLivePreviewExtension(
    () => f.settings,
    () => f.host
  );

  const view = makeFakeView({ text, file: f.docFile, app: f.app });
  const instance = new PluginClass(view);
  await flush(10);

  // 1. Host receives the whole document
  assert.equal(f.getProviderCallCount(), 1);
  const req = f.recordedRequests[0];
  assert.ok(req);
  assert.equal(req.clusters.length, 1);

  // 2. Transmitted cluster corresponds strictly to [@doe2023, p. 57]
  const cluster = req.clusters[0];
  assert.equal(cluster.id, "citation:7:24");
  assert.equal(cluster.items.length, 1);
  assert.equal(cluster.items[0].id, "doe2023");
  assert.equal(cluster.items[0].locator, "57");
  assert.equal(cluster.items[0].label, "page");

  // 3. noteIndex is strictly undefined
  assert.equal(cluster.noteIndex, undefined);

  // 4. Decoration in CodeMirror spans ONLY [7, 24], never the whole note
  const decos = instance.decorations;
  assert.equal(getDecoCount(decos), 1);
  assert.equal(decos[0].from, 7);
  assert.equal(decos[0].to, 24);
  assert.ok(decos[0].widget instanceof CslCitationWidget);
  assert.equal(decos[0].widget.clusterId, "citation:7:24");

  // 5. The surrounding note text is completely preserved in doc
  assert.equal(text.slice(0, decos[0].from), "^[Voir ");
  assert.equal(text.slice(decos[0].to), " pour une discussion méthodologique.]");
});
