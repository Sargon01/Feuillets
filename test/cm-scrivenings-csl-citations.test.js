import test from "node:test";
import { partialCslResult, partialCslSource } from "./helpers/csl-partial-result.js";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { Decoration } from "@codemirror/view";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  createScriveningsCitationExtension,
} from "../src/utils/cm-scrivenings-citations.js";
import {
  CslCitationWidget,
} from "../src/utils/cm-pandoc-citation-live-preview.js";
import {
  CslCitationHost,
} from "../src/services/csl-citation-host.js";
import {
  CitationEngineRegistry,
} from "../src/api/citation-engine.js";
import {
  buildScriveningsDocument,
  boundaryOffsets,
} from "../src/services/scrivenings-document.js";
import {
  ScriveningsView,
} from "../src/views/scrivenings-view.js";

globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
  requestAnimationFrame: (cb) => { cb(); return 0; },
};

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
      toggle(cls, force) {
        const has = el.classes.includes(cls);
        const shouldAdd = force !== undefined ? Boolean(force) : !has;
        if (shouldAdd) this.add(cls);
        else this.remove(cls);
        return shouldAdd;
      },
    };
  }
  empty() {
    this.children = [];
  }
  createDiv(options = {}) {
    return this.createEl("div", options);
  }
  contains(node) {
    if (node === this) return true;
    for (const child of this.children) {
      if (child.contains?.(node)) return true;
    }
    return false;
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
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  addEventListener() {}
  removeEventListener() {}
}

class FakeDocument {
  constructor() {
    const doc = this;
    this.defaultView = {
      createEl(tag, options = {}) {
        const el = new FakeWidgetElement(tag, options);
        el.ownerDocument = doc;
        if (options.cls) el.setAttribute("class", options.cls);
        return el;
      },
      createSpan(options = {}) {
        return this.createEl("span", options);
      },
    };
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

function installFakeCreateEl() {
  globalThis.createEl = (tag, options = {}) => new FakeWidgetElement(tag, options);
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
}
installFakeCreateEl();

const FAKE_BOUNDARIES_FIELD = Symbol("scrivenings-boundaries-field-csl-test");

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
    sliceString(from, to) {
      return text.slice(from, to === undefined ? text.length : to);
    },
  };
}

function makeFakeView({
  text,
  boundaries,
  selection = [{ from: 99999, to: 99999 }],
  visibleRanges = null,
}) {
  const doc = makeFakeDoc(text);
  const dispatchCalls = [];
  const dom = new FakeWidgetElement("div");
  dom.ownerDocument = new FakeDocument();
  let currentBoundaries = boundaries;
  const view = {
    state: {
      doc,
      selection: { ranges: selection },
      field(f) {
        if (f === FAKE_BOUNDARIES_FIELD) return currentBoundaries;
        return undefined;
      },
    },
    visibleRanges: visibleRanges ?? [{ from: 0, to: doc.length }],
    dispatch(spec) {
      dispatchCalls.push(spec);
    },
    dom,
    setBoundaries(b) {
      currentBoundaries = b;
    },
    setText(newText) {
      this.state.doc = makeFakeDoc(newText);
      this.visibleRanges = [{ from: 0, to: this.state.doc.length }];
    },
    setSelection(ranges) {
      this.state.selection = { ranges };
    },
    setVisibleRanges(ranges) {
      this.visibleRanges = ranges;
    },
  };
  view.dispatchCalls = dispatchCalls;
  return view;
}

async function flush(ms = 0) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let fixtureId = 0;

function createMockProvider(overrides = {}) {
  return {
    id: "feuillets-csl",
    name: "Feuillets CSL",
    version: "2.0.0",
    renderDocument: async (req) => ({
      documentId: req.documentId,
      revision: req.revision,
      citations: req.clusters.map((c) => ({
        clusterId: c.id,
        plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
        content: [
          {
            type: "span",
            style: { fontStyle: "normal" },
            children: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          },
        ],
      })),
      bibliography: null,
      diagnostics: [],
    }),
    disposeDocument: (_id) => {},
    ...overrides,
  };
}

function createCslContinuFixture(options = {}) {
  const fid = ++fixtureId;
  const project = new TFolder(`PROJECT-${fid}`);
  const manuscript = new TFolder(`${project.path}/Manuscript`);
  const research = new TFolder(`${project.path}/Research`);

  const docA = new TFile(`${manuscript.path}/DocA.md`);
  docA.content = options.docAContent ?? "Texte A [@smith2024].";
  docA.extension = "md";

  const docB = new TFile(`${manuscript.path}/DocB.md`);
  docB.content = options.docBContent ?? "Texte B [@doe2023].";
  docB.extension = "md";

  const docC = new TFile(`${manuscript.path}/DocC.md`);
  docC.content = options.docCContent ?? "Texte C [@johnson2022].";
  docC.extension = "md";

  const bibFile = new TFile(`${research.path}/refs.bib`);
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 100, size: 500 };
  bibFile.content = `@article{smith2024, author={Smith}, year={2024}}
@article{doe2023, author={Doe}, year={2023}}
@article{johnson2022, author={Johnson}, year={2022}}`;

  const cslFile = new TFile(`${research.path}/style.csl`);
  cslFile.extension = "csl";
  cslFile.stat = { mtime: 200, size: 300 };
  cslFile.content = "<style><info><title>APA</title></info></style>";

  project.children = [manuscript, research];
  manuscript.parent = project;
  research.parent = project;
  manuscript.children = [docA, docB, docC];
  docA.parent = manuscript;
  docB.parent = manuscript;
  docC.parent = manuscript;
  research.children = [bibFile, cslFile];
  bibFile.parent = research;
  cslFile.parent = research;

  const extraFiles = options.extraFiles ?? [];
  for (const ef of extraFiles) {
    research.children.push(ef);
    ef.parent = research;
  }

  const { vault } = createFakeVault([
    project,
    manuscript,
    research,
    docA,
    docB,
    docC,
    bibFile,
    cslFile,
    ...extraFiles,
  ]);

  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        pandocCitationPreviewStyle: options.previewStyle ?? "csl",
        researchFolderLinks: {
          [project.path]: research.path,
        },
        citekeyBibliographyPath: "refs.bib",
        citekeyCslPath: "style.csl",
        ...(options.extraProjectMeta ?? {}),
      },
    },
  };

  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };

  const registry = new CitationEngineRegistry();
  const provider = createMockProvider(options.providerOverrides ?? {});
  registry.register(provider);

  const host = new CslCitationHost({
    app,
    settings,
    citationRegistry: registry,
  });

  return {
    app,
    settings,
    project,
    manuscript,
    research,
    docA,
    docB,
    docC,
    bibFile,
    cslFile,
    registry,
    provider,
    host,
  };
}

function mountCslContinu(f, files, { selection, visibleRanges } = {}) {
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const boundaries = boundaryOffsets(doc);
  const view = makeFakeView({ text: doc.text, boundaries, selection, visibleRanges });

  const cslContext = {
    document: doc,
    projectRoot: f.project,
    getHost: () => f.host,
  };

  const PluginClass = createScriveningsCitationExtension(
    FAKE_BOUNDARIES_FIELD,
    f.app,
    () => f.settings,
    files,
    cslContext
  );

  const instance = new PluginClass(view);
  return { doc, boundaries, view, instance, cslContext };
}

for (const grouped of [false, true]) {
  test(`Continu CSL renders valid citations around an unknown ${grouped ? "group" : "citation"}`, async (t) => {
    const source = partialCslSource(grouped);
    const f = createCslContinuFixture({ docAContent: source,
      providerOverrides: { renderDocument: async (request) => partialCslResult(request) } });
    const { instance, view, doc } = mountCslContinu(f, [f.docA]);
    t.after(() => { instance.destroy(); f.host.dispose(); });
    await flush(10);
    instance.update({ view });
    assert.equal(instance.decorations.length, 2);
    assert.deepEqual(instance.decorations.map(({ from, to }) => doc.text.slice(from, to)), ["[@known2026]", "[@known2026]"]);
    assert.ok(instance.decorations.every(({ widget }) => widget.citation.plainText === "Rendered known2026"));
    assert.equal(f.docA.content, source);
    assert.equal(view.state.doc.toString(), doc.text);
  });
}

test("Continu CSL: simple citation in one segment produces CslCitationWidget", async () => {
  const f = createCslContinuFixture({ docAContent: "Texte [@smith2024]." });
  const { instance, view } = mountCslContinu(f, [f.docA]);

  await flush(10);
  instance.update({ view });

  assert.ok(Array.isArray(instance.decorations));
  assert.equal(instance.decorations.length, 1);
  const deco = instance.decorations[0];
  assert.ok(deco.widget instanceof CslCitationWidget);
  assert.equal(deco.widget.citation.plainText, "(smith2024, 2024)");

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: two segments, same style, different bibliographies sent as 1 document request", async () => {
  const bibB = new TFile("PROJECT-extra/bibB.bib");
  bibB.extension = "bib";
  bibB.stat = { mtime: 300, size: 200 };
  bibB.content = "@article{doe2023, author={Doe}, year={2023}}";

  let capturedRequest = null;
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024]",
    docBContent: "B [@doe2023]",
    extraFiles: [bibB],
    providerOverrides: {
      renderDocument: async (req) => {
        capturedRequest = req;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id})`,
            content: [{ type: "text", text: `(${c.items[0]?.id})` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const { instance, view } = mountCslContinu(f, [f.docA, f.docB]);
  await flush(10);
  instance.update({ view });

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.clusters.length, 2);
  assert.equal(capturedRequest.clusters[0].items[0].id, "smith2024");
  assert.equal(capturedRequest.clusters[1].items[0].id, "doe2023");

  assert.ok(Array.isArray(instance.decorations));
  assert.equal(instance.decorations.length, 2);

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: NUMERICAL / VIEWPORT — provider receives 3 clusters, visible segment 3 displays [3], never [1]", async () => {
  let capturedRequest = null;
  const f = createCslContinuFixture({
    docAContent: "Premier [@smith2024].",
    docBContent: "Deuxieme [@doe2023].",
    docCContent: "Troisieme [@johnson2022].",
    providerOverrides: {
      renderDocument: async (req) => {
        capturedRequest = req;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c, i) => ({
            clusterId: c.id,
            plainText: `[${i + 1}]`,
            content: [{ type: "text", text: `[${i + 1}]` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA, f.docB, f.docC];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const boundaries = boundaryOffsets(doc);

  // Segment 3 bounds: doc.segments[2]
  const seg3 = doc.segments[2];
  const visibleRanges = [{ from: seg3.from, to: seg3.to }];

  const view = makeFakeView({ text: doc.text, boundaries, visibleRanges });
  const cslContext = {
    document: doc,
    projectRoot: f.project,
    getHost: () => f.host,
  };

  const PluginClass = createScriveningsCitationExtension(
    FAKE_BOUNDARIES_FIELD,
    f.app,
    () => f.settings,
    files,
    cslContext
  );

  const instance = new PluginClass(view);
  await flush(10);
  instance.update({ view });

  // Provider MUST receive all 3 clusters in full manuscript order
  assert.ok(capturedRequest);
  assert.equal(capturedRequest.clusters.length, 3);
  assert.equal(capturedRequest.clusters[0].items[0].id, "smith2024");
  assert.equal(capturedRequest.clusters[1].items[0].id, "doe2023");
  assert.equal(capturedRequest.clusters[2].items[0].id, "johnson2022");

  // But only segment 3 is in visibleRanges -> only 1 decoration
  assert.ok(Array.isArray(instance.decorations));
  assert.equal(instance.decorations.length, 1);
  const deco = instance.decorations[0];
  assert.ok(deco.widget instanceof CslCitationWidget);
  assert.equal(deco.widget.citation.plainText, "[3]", "Segment 3 must be numbered [3], never [1]");

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: scroll recomputes visible decorations without new provider query", async () => {
  let renderCallCount = 0;
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024].",
    docBContent: "B [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        renderCallCount++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c, i) => ({
            clusterId: c.id,
            plainText: `[${i + 1}]`,
            content: [{ type: "text", text: `[${i + 1}]` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA, f.docB];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const boundaries = boundaryOffsets(doc);

  // Visible: only segment 1
  const seg1 = doc.segments[0];
  const seg2 = doc.segments[1];
  const view = makeFakeView({ text: doc.text, boundaries, visibleRanges: [{ from: seg1.from, to: seg1.to }] });

  const cslContext = {
    document: doc,
    projectRoot: f.project,
    getHost: () => f.host,
  };

  const PluginClass = createScriveningsCitationExtension(
    FAKE_BOUNDARIES_FIELD,
    f.app,
    () => f.settings,
    files,
    cslContext
  );

  const instance = new PluginClass(view);
  await flush(10);
  instance.update({ view });

  assert.equal(renderCallCount, 1);
  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].widget.citation.plainText, "[1]");

  // Scroll to segment 2
  view.setVisibleRanges([{ from: seg2.from, to: seg2.to }]);
  instance.update({ view, viewportChanged: true });

  assert.equal(renderCallCount, 1, "Scroll should NOT trigger a new provider call");
  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].widget.citation.plainText, "[2]");

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: cursor reveal leaves targeted citation raw while folding other citations", async () => {
  const f = createCslContinuFixture({
    docAContent: "Debut [@smith2024] milieu [@doe2023] fin.",
  });

  const { instance, view } = mountCslContinu(f, [f.docA]);
  await flush(10);
  instance.update({ view });

  assert.equal(instance.decorations.length, 2);

  // Place cursor inside first citation [@smith2024] at offset 10
  view.setSelection([{ from: 10, to: 10 }]);
  instance.update({ view, selectionSet: true });

  assert.equal(instance.decorations.length, 1, "First citation should be revealed in raw syntax");
  assert.equal(instance.decorations[0].widget.citation.plainText, "(doe2023, 2024)");

  // Move cursor to end of document (outside citations)
  view.setSelection([{ from: 38, to: 38 }]);
  instance.update({ view, selectionSet: true });

  assert.equal(instance.decorations.length, 2, "Both citations should be folded again");

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: prose edit before citations preserves rendering without new provider query", async () => {
  let renderCallCount = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte [@smith2024].",
    providerOverrides: {
      renderDocument: async (req) => {
        renderCallCount++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: [
            {
              clusterId: req.clusters[0]?.id ?? "citation:0:10",
              plainText: "(Smith, 2024)",
              content: [{ type: "text", text: "(Smith, 2024)" }],
            },
          ],
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const { instance, view } = mountCslContinu(f, [f.docA]);
  await flush(10);
  instance.update({ view });

  assert.equal(renderCallCount, 1);
  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].from, 6);
  assert.equal(instance.decorations[0].to, 18);

  // Prepend prose: "Nouveau preambule. Texte [@smith2024]."
  const newText = "Nouveau preambule. Texte [@smith2024].";
  view.setText(newText);
  instance.update({ view, docChanged: true });

  assert.equal(renderCallCount, 1, "Prose edit with semantically equal citations should NOT query provider");
  assert.equal(instance.decorations.length, 1, "Decorations should remain visible immediately");
  // Offset shifted by 19 characters ("Nouveau preambule. ")
  assert.equal(instance.decorations[0].from, 25);
  assert.equal(instance.decorations[0].to, 37);

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: citation change clears decorations immediately, folds after provider resolves", async () => {
  let resolveProvider = null;
  const f = createCslContinuFixture({
    docAContent: "Texte [@smith2024].",
    providerOverrides: {
      renderDocument: async (req) => {
        const p = new Promise((resolve) => {
          resolveProvider = resolve;
        });
        await p;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: [
            {
              clusterId: req.clusters[0]?.id ?? "c",
              plainText: `(${req.clusters[0]?.items[0]?.id})`,
              content: [{ type: "text", text: `(${req.clusters[0]?.items[0]?.id})` }],
            },
          ],
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const { instance, view } = mountCslContinu(f, [f.docA]);
  await flush(10);
  assert.ok(typeof resolveProvider === "function");
  resolveProvider();
  await flush(10);
  instance.update({ view });

  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].widget.citation.plainText, "(smith2024)");

  // Change citekey: [@doe2023]
  view.setText("Texte [@doe2023].");
  instance.update({ view, docChanged: true });

  // Immediately raw syntax: 0 decorations
  assert.ok(instance.decorations === Decoration.none || instance.decorations.length === 0);

  // Let debounce fire (150ms)
  await flush(160);

  // Provider call in flight, resolve it
  assert.ok(typeof resolveProvider === "function");
  resolveProvider();
  await flush(10);

  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].widget.citation.plainText, "(doe2023)");

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: missing resource on one citing segment fails closed across entire Continu", async () => {
  let providerCalled = false;
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024].",
    docBContent: "B [@doe2023].",
    providerOverrides: {
      renderDocument: async () => {
        providerCalled = true;
        throw new Error("Should not be called");
      },
    },
  });

  // Break bibliography configuration for segment B
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "nonexistent.bib";

  const { instance, view } = mountCslContinu(f, [f.docA, f.docB]);
  await flush(10);
  instance.update({ view });

  assert.equal(providerCalled, false, "Provider must not be called when resources are unavailable");
  assert.ok(instance.decorations === Decoration.none || instance.decorations.length === 0);

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: conflicting CSL styles across citing segments fails closed", async () => {
  const style2 = new TFile("PROJECT/Research/style2.csl");
  style2.extension = "csl";
  style2.stat = { mtime: 500, size: 200 };
  style2.content = "<style><info><title>IEEE</title></info></style>";

  let providerCalled = false;
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024].",
    docBContent: "B [@doe2023].",
    extraFiles: [style2],
    extraProjectMeta: {
      folderWorkspaces: {
        Manuscript: {
          version: 1,
          citekeyCslPath: "style2.csl",
        },
      },
    },
    providerOverrides: {
      renderDocument: async () => {
        providerCalled = true;
        throw new Error("Should not be called");
      },
    },
  });

  const { instance, view } = mountCslContinu(f, [f.docA, f.docB]);
  await flush(10);
  instance.update({ view });

  assert.equal(providerCalled, false);
  assert.ok(instance.decorations === Decoration.none || instance.decorations.length === 0);

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: non-citing segment with broken config does not invalidate citing segments", async () => {
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024].",
    docBContent: "B sans aucune citation.",
  });

  const { instance, view } = mountCslContinu(f, [f.docA, f.docB]);
  await flush(10);
  instance.update({ view });

  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].widget.citation.plainText, "(smith2024, 2024)");

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: provider absent fails closed into raw syntax", async () => {
  const f = createCslContinuFixture({ docAContent: "A [@smith2024]." });
  // Unregister provider
  f.registry.unregister("feuillets-csl");

  const { instance, view } = mountCslContinu(f, [f.docA]);
  await flush(10);
  instance.update({ view });

  assert.ok(instance.decorations === Decoration.none || instance.decorations.length === 0);

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: engine error fails closed into raw syntax", async () => {
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024].",
    providerOverrides: {
      renderDocument: async () => {
        throw new Error("Engine crashed");
      },
    },
  });

  const { instance, view } = mountCslContinu(f, [f.docA]);
  await flush(10);
  instance.update({ view });

  assert.ok(instance.decorations === Decoration.none || instance.decorations.length === 0);

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: diagnostic with severity error fails closed into raw syntax", async () => {
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024].",
    providerOverrides: {
      renderDocument: async (req) => ({
        documentId: req.documentId,
        revision: req.revision,
        citations: [
          {
            clusterId: req.clusters[0]?.id ?? "c",
            plainText: "(Smith)",
            content: [{ type: "text", text: "(Smith)" }],
          },
        ],
        bibliography: null,
        diagnostics: [
          {
            code: "csl-error",
            message: "Fatal CSL parsing error",
            severity: "error",
          },
        ],
      }),
    },
  });

  const { instance, view } = mountCslContinu(f, [f.docA]);
  await flush(10);
  instance.update({ view });

  assert.ok(instance.decorations === Decoration.none || instance.decorations.length === 0);

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: incomplete result fails closed into raw syntax", async () => {
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024] et [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => ({
        documentId: req.documentId,
        revision: req.revision,
        // Only 1 citation returned while 2 clusters were requested
        citations: [
          {
            clusterId: req.clusters[0]?.id ?? "c",
            plainText: "(Smith)",
            content: [{ type: "text", text: "(Smith)" }],
          },
        ],
        bibliography: null,
        diagnostics: [],
      }),
    },
  });

  const { instance, view } = mountCslContinu(f, [f.docA]);
  await flush(10);
  instance.update({ view });

  assert.ok(instance.decorations === Decoration.none || instance.decorations.length === 0);

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: two simultaneous Continu views receive distinct documentIds", async () => {
  const capturedIds = [];
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024].",
    providerOverrides: {
      renderDocument: async (req) => {
        capturedIds.push(req.documentId);
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: [
            {
              clusterId: req.clusters[0]?.id ?? "c",
              plainText: "(Smith)",
              content: [{ type: "text", text: "(Smith)" }],
            },
          ],
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const m1 = mountCslContinu(f, [f.docA]);
  const m2 = mountCslContinu(f, [f.docA]);

  await flush(10);

  assert.equal(capturedIds.length, 2);
  assert.notEqual(capturedIds[0], capturedIds[1]);
  assert.match(capturedIds[0], /^scrivenings:\d+:/);
  assert.match(capturedIds[1], /^scrivenings:\d+:/);

  m1.instance.destroy();
  m2.instance.destroy();
  f.host.dispose();
});

test("Continu CSL: destroy unregisters and disposes host session", async () => {
  let disposedId = null;
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024].",
    providerOverrides: {
      disposeDocument: (id) => {
        disposedId = id;
      },
    },
  });

  const { instance } = mountCslContinu(f, [f.docA]);
  await flush(10);

  assert.equal(disposedId, null);
  instance.destroy();
  assert.ok(disposedId);
  assert.match(disposedId, /^scrivenings:\d+:/);

  f.host.dispose();
});

test("Continu CSL: recomposition disposes previous documentId and uses fresh documentId", async () => {
  const disposedIds = [];
  const requestedIds = [];
  const f = createCslContinuFixture({
    docAContent: "A [@smith2024].",
    providerOverrides: {
      renderDocument: async (req) => {
        requestedIds.push(req.documentId);
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: [
            {
              clusterId: req.clusters[0]?.id ?? "c",
              plainText: "(Smith)",
              content: [{ type: "text", text: "(Smith)" }],
            },
          ],
          bibliography: null,
          diagnostics: [],
        };
      },
      disposeDocument: (id) => {
        disposedIds.push(id);
      },
    },
  });

  const m1 = mountCslContinu(f, [f.docA]);
  await flush(10);

  m1.instance.destroy();
  assert.equal(disposedIds.length, 1);
  assert.equal(disposedIds[0], requestedIds[0]);

  const m2 = mountCslContinu(f, [f.docA]);
  await flush(10);

  assert.equal(requestedIds.length, 2);
  assert.notEqual(requestedIds[0], requestedIds[1]);

  m2.instance.destroy();
  assert.equal(disposedIds.length, 2);
  assert.equal(disposedIds[1], requestedIds[1]);

  f.host.dispose();
});

test("Continu CSL: document with no citekeys triggers zero provider calls", async () => {
  let providerCalled = false;
  const f = createCslContinuFixture({
    docAContent: "Texte pur sans aucune citation.",
    providerOverrides: {
      renderDocument: async () => {
        providerCalled = true;
        throw new Error("Should not be called");
      },
    },
  });

  const { instance, view } = mountCslContinu(f, [f.docA]);
  await flush(10);
  instance.update({ view });

  assert.equal(providerCalled, false);
  assert.ok(instance.decorations === Decoration.none || instance.decorations.length === 0);

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: style off triggers zero CSL calls", async () => {
  let providerCalled = false;
  const f = createCslContinuFixture({
    docAContent: "Texte [@smith2024].",
    previewStyle: "off",
    providerOverrides: {
      renderDocument: async () => {
        providerCalled = true;
        throw new Error("Should not be called");
      },
    },
  });

  const { instance, view } = mountCslContinu(f, [f.docA]);
  await flush(10);
  instance.update({ view });

  assert.equal(providerCalled, false);
  assert.ok(instance.decorations === Decoration.none || instance.decorations.length === 0);

  instance.destroy();
  f.host.dispose();
});

test("ScriveningsView Integration: mountEditor passes mounted document, projectRoot, and host access", async () => {
  let capturedRequest = null;
  const f = createCslContinuFixture({
    docAContent: "Contenu A [@smith2024].",
    providerOverrides: {
      renderDocument: async (req) => {
        capturedRequest = req;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: [
            {
              clusterId: req.clusters[0]?.id ?? "c",
              plainText: "(Smith)",
              content: [{ type: "text", text: "(Smith)" }],
            },
          ],
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));

  let hostAccessCount = 0;
  const scope = {
    type: "project",
    projectRoot: f.project.path,
    path: f.project.path,
  };

  const fakeContentEl = new FakeWidgetElement("div");
  const fakeLeaf = {
    app: f.app,
    contentEl: fakeContentEl,
  };

  const fakePlugin = {
    app: f.app,
    settings: f.settings,
    get cslCitationHost() {
      hostAccessCount++;
      return f.host;
    },
    updateStatusBar: () => {},
  };

  const view = new ScriveningsView(fakeLeaf, fakePlugin);
  view.contentEl = fakeContentEl;
  view._compileScope = scope;
  view.session.load(doc);

  // Call mountEditor
  view.mountEditor();

  assert.ok(view.cm);
  assert.ok(hostAccessCount > 0, "mountEditor must pass getHost accessing plugin.cslCitationHost");

  // Let CSL host process
  await flush(10);
  assert.ok(capturedRequest, "Provider should receive document request initiated via mountEditor");
  assert.ok(capturedRequest.documentId.includes(f.project.path), "documentId should incorporate projectRoot");
  assert.equal(capturedRequest.clusters[0].items[0].id, "smith2024", "Mounted document clusters should be passed");

  view.destroyEditor();
  f.host.dispose();
});

test("Continu CSL: citation insertion debounces with stable output and finite Host calls", async () => {
  let hostCalls = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        hostCalls++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
            content: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const scope = { type: "project", projectRoot: f.project.path, path: f.project.path };
  const fakeContentEl = new FakeWidgetElement("div");
  const fakeLeaf = { app: f.app, contentEl: fakeContentEl };
  const fakePlugin = { app: f.app, settings: f.settings, cslCitationHost: f.host, updateStatusBar: () => {} };
  const view = new ScriveningsView(fakeLeaf, fakePlugin);
  view.contentEl = fakeContentEl;
  view._compileScope = scope;
  view.session.load(doc);
  view.mountEditor();

  await flush(20);
  assert.equal(hostCalls, 1, "Initial mount must make exactly 1 host call");

  // Insert [@smith2024]
  view.cm.dispatch({
    changes: { from: 5, to: 5, insert: " [@smith2024]" },
    selection: { anchor: 20 },
  });

  // Let debounce and host render process
  await flush(250);

  // Host calls must be FINITE and exactly 2 (initial + 1 for insertion)
  assert.equal(hostCalls, 2, "After citation insertion, host call count must be exactly 2 (no loop)");

  view.destroyEditor();
  f.host.dispose();
});

test("Continu CSL: empty dispatch after Host completion rebuilds decorations without another Host call", async () => {
  let hostCalls = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        hostCalls++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
            content: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const scope = { type: "project", projectRoot: f.project.path, path: f.project.path };
  const fakeContentEl = new FakeWidgetElement("div");
  const fakeLeaf = { app: f.app, contentEl: fakeContentEl };
  const fakePlugin = { app: f.app, settings: f.settings, cslCitationHost: f.host, updateStatusBar: () => {} };
  const view = new ScriveningsView(fakeLeaf, fakePlugin);
  view.contentEl = fakeContentEl;
  view._compileScope = scope;
  view.session.load(doc);
  view.mountEditor();

  await flush(20);
  assert.equal(hostCalls, 1);

  // Dispatch empty transaction
  view.cm.dispatch({});
  await flush(50);

  assert.equal(hostCalls, 1, "Empty dispatch must trigger ZERO new host calls");

  view.destroyEditor();
  f.host.dispose();
});

test("Continu CSL: selection-only updates make no additional Host calls", async () => {
  let hostCalls = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        hostCalls++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
            content: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const scope = { type: "project", projectRoot: f.project.path, path: f.project.path };
  const fakeContentEl = new FakeWidgetElement("div");
  const fakeLeaf = { app: f.app, contentEl: fakeContentEl };
  const fakePlugin = { app: f.app, settings: f.settings, cslCitationHost: f.host, updateStatusBar: () => {} };
  const view = new ScriveningsView(fakeLeaf, fakePlugin);
  view.contentEl = fakeContentEl;
  view._compileScope = scope;
  view.session.load(doc);
  view.mountEditor();

  await flush(20);
  assert.equal(hostCalls, 1);

  // Move selection inside citation
  view.cm.dispatch({ selection: { anchor: 8 } });
  await flush(20);

  assert.equal(hostCalls, 1, "Moving cursor inside citation must trigger ZERO new host calls");

  // Move selection outside citation
  view.cm.dispatch({ selection: { anchor: 0 } });
  await flush(20);

  assert.equal(hostCalls, 1, "Moving cursor outside citation must trigger ZERO new host calls");

  view.destroyEditor();
  f.host.dispose();
});

test("Continu CSL: viewport-only updates make no additional Host calls", async () => {
  let hostCalls = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        hostCalls++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
            content: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const scope = { type: "project", projectRoot: f.project.path, path: f.project.path };
  const fakeContentEl = new FakeWidgetElement("div");
  const fakeLeaf = { app: f.app, contentEl: fakeContentEl };
  const fakePlugin = { app: f.app, settings: f.settings, cslCitationHost: f.host, updateStatusBar: () => {} };
  const view = new ScriveningsView(fakeLeaf, fakePlugin);
  view.contentEl = fakeContentEl;
  view._compileScope = scope;
  view.session.load(doc);
  view.mountEditor();

  await flush(20);
  assert.equal(hostCalls, 1);

  // Change visibleRanges and notify plugins
  view.cm.visibleRanges = [{ from: 0, to: 5 }];
  for (const plugin of view.cm.plugins) {
    plugin.update?.({ view: view.cm, state: view.cm.state, docChanged: false, viewportChanged: true });
  }
  await flush(20);

  assert.equal(hostCalls, 1, "Viewport change must trigger ZERO new host calls");

  view.destroyEditor();
  f.host.dispose();
});

test("Continu CSL: prose typing projects new offsets without additional Host calls", async () => {
  let hostCalls = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        hostCalls++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
            content: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const scope = { type: "project", projectRoot: f.project.path, path: f.project.path };
  const fakeContentEl = new FakeWidgetElement("div");
  const fakeLeaf = { app: f.app, contentEl: fakeContentEl };
  const fakePlugin = { app: f.app, settings: f.settings, cslCitationHost: f.host, updateStatusBar: () => {} };
  const view = new ScriveningsView(fakeLeaf, fakePlugin);
  view.contentEl = fakeContentEl;
  view._compileScope = scope;
  view.session.load(doc);
  view.mountEditor();

  await flush(20);
  assert.equal(hostCalls, 1);

  // Insert pure prose at the beginning
  view.cm.dispatch({
    changes: { from: 0, to: 0, insert: "Preambule. " },
  });

  await flush(200);

  assert.equal(hostCalls, 1, "Prose typing with semantically identical citations must trigger ZERO new host calls");

  view.destroyEditor();
  f.host.dispose();
});

test("Continu CSL: citation changes trigger exactly one render cycle", async () => {
  let hostCalls = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        hostCalls++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
            content: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const scope = { type: "project", projectRoot: f.project.path, path: f.project.path };
  const fakeContentEl = new FakeWidgetElement("div");
  const fakeLeaf = { app: f.app, contentEl: fakeContentEl };
  const fakePlugin = { app: f.app, settings: f.settings, cslCitationHost: f.host, updateStatusBar: () => {} };
  const view = new ScriveningsView(fakeLeaf, fakePlugin);
  view.contentEl = fakeContentEl;
  view._compileScope = scope;
  view.session.load(doc);
  view.mountEditor();

  await flush(20);
  assert.equal(hostCalls, 1);

  // Change citekey from doe2023 to smith2024
  view.cm.dispatch({
    changes: { from: 8, to: 15, insert: "smith2024" },
  });

  await flush(250);

  assert.equal(hostCalls, 2, "Changing citekey must trigger exactly 1 new host call (total 2)");

  view.destroyEditor();
  f.host.dispose();
});

test("Continu CSL: resource invalidation triggers exactly one immediate render", async () => {
  let hostCalls = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        hostCalls++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
            content: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const scope = { type: "project", projectRoot: f.project.path, path: f.project.path };
  const fakeContentEl = new FakeWidgetElement("div");
  const fakeLeaf = { app: f.app, contentEl: fakeContentEl };
  const fakePlugin = { app: f.app, settings: f.settings, cslCitationHost: f.host, updateStatusBar: () => {} };
  const view = new ScriveningsView(fakeLeaf, fakePlugin);
  view.contentEl = fakeContentEl;
  view._compileScope = scope;
  view.session.load(doc);
  view.mountEditor();

  await flush(20);
  assert.equal(hostCalls, 1);

  // Invalidate .bib resource
  f.host.invalidateResource(f.bibFile.path);
  await flush(50);

  assert.equal(hostCalls, 2, "Resource invalidation must trigger exactly 1 new host call (total 2)");

  view.destroyEditor();
  f.host.dispose();
});

test("Continu CSL: delayed boundaries trigger one initial render when they become available", async () => {
  let hostCalls = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte A [@smith2024].",
    docBContent: "Texte B [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        hostCalls++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
            content: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA, f.docB];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const cslContext = {
    document: doc,
    projectRoot: f.project,
    getHost: () => f.host,
  };

  // Étape 1 : EditorState initial SANS frontières valides (boundaries = [])
  const view = makeFakeView({ text: doc.text, boundaries: [] });
  const PluginClass = createScriveningsCitationExtension(
    FAKE_BOUNDARIES_FIELD,
    f.app,
    () => f.settings,
    files,
    cslContext
  );

  const instance = new PluginClass(view);
  await flush(20);

  // Attendu Étape 1 : 0 appel Host, 0 décoration CSL, syntaxe brute
  assert.equal(hostCalls, 0, "Étape 1 : sans frontières valides, ZERO appel Host");
  assert.ok(
    instance.decorations === Decoration.none || instance.decorations.length === 0,
    "Étape 1 : syntaxe brute, aucune décoration"
  );

  // Étape 2 : simulation de la transaction interne qui installe scriveningsBoundariesField
  // SANS modifier le texte : docChanged === false
  view.setBoundaries(boundaryOffsets(doc));
  instance.update({ view, docChanged: false });

  // Attente de la résolution du Host (delayMs = 0)
  await flush(50);

  // Attendu Étape 2 : exactement 1 appel Host initial SANS frappe utilisateur
  assert.equal(hostCalls, 1, "Étape 2 : frontières prêtes, exactement 1 appel Host initial sans frappe");
  assert.ok(instance.decorations.length >= 2, "Étape 2 : citations rendues CSL après résolution");

  // Étape 3 : empty dispatch supplémentaire
  instance.update({ view, docChanged: false });
  await flush(20);

  // Attendu Étape 3 : toujours 1 seul appel Host total, aucune nouvelle requête
  assert.equal(hostCalls, 1, "Étape 3 : empty dispatch ne déclenche aucun appel Host supplémentaire");

  instance.destroy();
  f.host.dispose();
});

test("Continu CSL: mounted multi-segment ScriveningsView renders citations without typing", async () => {
  let hostCalls = 0;
  const f = createCslContinuFixture({
    docAContent: "Texte A [@smith2024].",
    docBContent: "Texte B [@doe2023].",
    providerOverrides: {
      renderDocument: async (req) => {
        hostCalls++;
        return {
          documentId: req.documentId,
          revision: req.revision,
          citations: req.clusters.map((c) => ({
            clusterId: c.id,
            plainText: `(${c.items[0]?.id ?? "anon"}, 2024)`,
            content: [{ type: "text", text: `(${c.items[0]?.id ?? "anon"}, 2024)` }],
          })),
          bibliography: null,
          diagnostics: [],
        };
      },
    },
  });

  const files = [f.docA, f.docB];
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const scope = { type: "project", projectRoot: f.project.path, path: f.project.path };
  const fakeContentEl = new FakeWidgetElement("div");
  const fakeLeaf = { app: f.app, contentEl: fakeContentEl };
  const fakePlugin = { app: f.app, settings: f.settings, cslCitationHost: f.host, updateStatusBar: () => {} };
  const view = new ScriveningsView(fakeLeaf, fakePlugin);
  view.contentEl = fakeContentEl;
  view._compileScope = scope;
  view.session.load(doc);

  // mountEditor crée EditorView puis appelle setScriveningsDecorations
  view.mountEditor();

  await flush(50);

  // SANS aucune frappe utilisateur, les citations doivent être rendues avec exactement 1 appel Host
  assert.equal(hostCalls, 1, "mountEditor avec 2 segments doit déclencher exactement 1 appel Host");

  view.destroyEditor();
  f.host.dispose();
});


test("CSL Continu: global note indices include non-citing notes and scrolling reuses the document", async (t) => {
  const requests = [];
  const f = createCslContinuFixture({
    docAContent: "Text[^a] ^[Comment].\n\n[^a]: See [@smith2024]",
    docBContent: "Text.^[See [@doe2023]]",
    providerOverrides: { renderDocument: async (request) => {
      requests.push(request);
      return { documentId: request.documentId, revision: request.revision,
        citations: request.clusters.map((cluster) => ({ clusterId: cluster.id, plainText: `Note ${cluster.noteIndex}`, content: [{ type: "text", text: `Note ${cluster.noteIndex}` }] })),
        bibliography: null, diagnostics: [] };
    } },
  });
  const mounted = mountCslContinu(f, [f.docA, f.docB]);
  t.after(() => { mounted.instance.destroy(); f.host.dispose(); });
  await flush(10);
  assert.deepEqual(requests[0].clusters.map((cluster) => cluster.noteIndex), [1, 3]);
  mounted.view.visibleRanges = [{ from: mounted.doc.segments[1].from, to: mounted.doc.segments[1].to }];
  mounted.instance.update({ view: mounted.view, viewportChanged: true });
  await flush(10);
  assert.equal(requests.length, 1);
  assert.equal(mounted.instance.decorations.length, 1);
  assert.equal(mounted.instance.decorations[0].widget.citation.plainText, "Note 3");
});
