import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, TFile, TFolder } from "obsidian";
import { CitationEngineRegistry } from "../src/api/citation-engine.js";
import { CslCitationHost } from "../src/services/csl-citation-host.js";
import { registerPandocCitationReadingMode, refreshPandocCitationReadingModeViews } from "../src/services/pandoc-citation-reading-mode.js";
import { createFakeVault } from "./helpers/fake-vault.js";

class ReadingNode {
  constructor(doc, tag, value = "") {
    this.ownerDocument = doc;
    this.nodeType = tag === "#text" ? 3 : 1;
    this.tagName = tag.toUpperCase();
    this.nodeValue = value;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.classList = new Set();
    this.classList.contains = (value) => this.classList.has(value);
  }
  get parentElement() { return this.parentNode; }
  get className() { return [...this.classList].join(" "); }
  set className(value) {
    this.classList.clear();
    for (const name of value.split(/\s+/).filter(Boolean)) this.classList.add(name);
  }
  get textContent() {
    return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(value) {
    this.childNodes = [];
    this.appendChild(this.ownerDocument.createTextNode(value));
  }
  setAttribute(name, value) { this.attrs.set(name, value); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, reference) {
    node.parentNode?.removeChild(node);
    const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }
  querySelectorAll(selector) {
    const matches = [];
    for (const node of this.childNodes) {
      if (selector.startsWith(".") ? node.classList.has(selector.slice(1)) : node.tagName === selector.toUpperCase()) matches.push(node);
      matches.push(...node.querySelectorAll(selector));
    }
    return matches;
  }
}

class ReadingDocument {
  createElement(tag) { return new ReadingNode(this, tag); }
  createTextNode(value) { return new ReadingNode(this, "#text", value); }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function providerResult(request, format = (_cluster, index) => `[${index + 1}]`) {
  return {
    documentId: request.documentId, revision: request.revision,
    citations: request.clusters.map((cluster, index) => {
      const text = format(cluster, index);
      return { clusterId: cluster.id, plainText: text, content: [{ type: "span", style: { fontStyle: "italic" }, children: [{ type: "text", text }] }] };
    }),
    bibliography: null, diagnostics: [],
  };
}

let fixtureSequence = 0;
function fixture(t, { source = "Text [@smith2024].", provider = true, handler, style = "csl" } = {}) {
  const root = new TFolder(`READING-${++fixtureSequence}`);
  const articleA = new TFolder(`${root.path}/Article-A`);
  const articleB = new TFolder(`${root.path}/Article-B`);
  const researchA = new TFolder(`${root.path}/Research-A`);
  const researchB = new TFolder(`${root.path}/Research-B`);
  const docA = new TFile(`${articleA.path}/A.md`, source);
  const docB = new TFile(`${articleB.path}/B.md`, "Other [@beta].");
  const bibA = new TFile(`${researchA.path}/refs-a.bib`, "@article{smith2024,author={Smith},year={2024}}");
  const bibB = new TFile(`${researchB.path}/refs-b.bib`, "@article{beta,author={Beta},year={2020}}");
  const cslA = new TFile(`${researchA.path}/style-a.csl`, "<style>Author Date A</style>");
  const cslB = new TFile(`${researchB.path}/style-b.csl`, "<style>Numeric B</style>");
  root.children = [articleA, articleB, researchA, researchB];
  for (const folder of root.children) folder.parent = root;
  for (const [folder, files] of [[articleA, [docA]], [articleB, [docB]], [researchA, [bibA, cslA]], [researchB, [bibB, cslB]]]) {
    folder.children = files;
    for (const file of files) {
      file.parent = folder;
      file.stat = { mtime: 100, size: file.content.length };
    }
  }
  const { vault, files, fileManager } = createFakeVault([root, ...root.children, docA, docB, bibA, bibB, cslA, cslB]);
  const settings = {
    projectFolder: root.path,
    projectMeta: { [root.path]: {
      pandocCitationPreviewStyle: style,
      researchFolderLinks: { [articleA.path]: researchA.path, [articleB.path]: researchB.path },
      folderWorkspaces: {
        "Article-A": { version: 1, citekeyBibliographyPath: "refs-a.bib", citekeyCslPath: "style-a.csl" },
        "Article-B": { version: 1, citekeyBibliographyPath: "refs-b.bib", citekeyCslPath: "style-b.csl" },
      },
    } },
  };
  const leaves = [];
  const app = {
    vault,
    workspace: {
      getLeavesOfType: () => leaves,
      getActiveFile: () => { throw new Error("Active file must never be consulted"); },
    },
  };
  const registry = new CitationEngineRegistry();
  const requests = [];
  const disposed = [];
  const engine = {
    id: "feuillets-csl", name: "Reading test engine", version: "1.0",
    renderDocument: async (request) => {
      requests.push(request);
      return handler ? handler(request) : providerResult(request);
    },
    disposeDocument: (id) => disposed.push(id),
  };
  if (provider) registry.register(engine);
  const host = new CslCitationHost({ app, getSettings: () => settings, citationRegistry: registry });
  let process;
  const cleanups = [];
  const plugin = {
    app, settings, cslCitationHost: host,
    register: (callback) => cleanups.push(callback),
    registerMarkdownPostProcessor: (callback) => { process = callback; },
  };
  registerPandocCitationReadingMode(plugin);
  t.after(() => { cleanups.forEach((callback) => callback()); host.dispose(); });
  let viewSeq = 0;
  const pane = (file = docA, ownerDocument = new ReadingDocument()) => {
    const contextId = `renderer-${++viewSeq}`;
    const renderChildren = [];
    const unload = () => renderChildren.splice(0).forEach((child) => child.unload());
    const rerenders = [];
    const view = Object.assign(new MarkdownView(), {
      file, getMode: () => "preview",
      register: () => { throw new Error("Session ownership must use the public context lifecycle"); },
      previewMode: { containerEl: ownerDocument.createElement("div"), rerender: (full) => { rerenders.push(full); unload(); } },
    });
    const leaf = { view };
    leaves.push(leaf);
    return {
      view, contextId, ownerDocument, rerenders, renderChildren, unload,
      close: () => { leaves.splice(leaves.indexOf(leaf), 1); unload(); },
      openFile: (file) => { view.file = file; unload(); },
    };
  };
  const section = (pane, { text, start = 0, end = start, info, tag = "p" } = {}) => {
    const el = pane.ownerDocument.createElement(tag);
    if (text !== undefined) el.textContent = text;
    const children = [];
    const ctx = {
      docId: pane.contextId, sourcePath: pane.view.file.path,
      getSectionInfo: () => info === undefined ? { text: pane.view.file.content, lineStart: start, lineEnd: end } : info,
      addChild: (child) => { children.push(child); pane.renderChildren.push(child); child.load(); },
    };
    return { el, ctx, children, run: () => process(el, ctx), unload: () => children.forEach((child) => child.unload()) };
  };
  const modifyResource = (file) => { host.invalidateResource(file.path); refreshPandocCitationReadingModeViews(plugin, file); };
  return { app, vault, files, fileManager, settings, root, articleA, articleB, researchA, docA, docB, bibA, bibB, cslA, cslB, registry, engine, host, plugin, requests, disposed, pane, section, modifyResource };
}

for (const [name, source, output, verify] of [
  ["simple", "[@smith2024]", "(Smith 2024)", (cluster) => assert.equal(cluster.items[0].id, "smith2024")],
  ["locator", "[@doe2023, p. 42]", "(Doe et Brown 2023, 42)", (cluster) => { assert.equal(cluster.items[0].locator, "42"); assert.equal(cluster.items[0].label, "page"); }],
  ["group", "[@smith2024; @garcia2020, pp. 12–14]", "(Smith 2024; García Márquez 2020, 12–14)", (cluster) => assert.equal(cluster.items.length, 2)],
  ["narrative", "@who2021", "World Health Organization (2021)", (cluster) => assert.equal(cluster.items[0].mode, "composite")],
  ["suppress author", "[-@smith2024]", "(2024)", (cluster) => assert.equal(cluster.items[0].mode, "suppress-author")],
]) {
  test(`CSL Reading Mode: ${name} uses the host AST and original global cluster`, async (t) => {
    const f = fixture(t, { source, handler: (req) => providerResult(req, () => output) });
    const s = f.section(f.pane(), { text: source });
    await s.run();
    assert.equal(s.el.textContent, output);
    assert.equal(s.el.querySelectorAll(".feuillets-csl-citation").length, 1);
    verify(f.requests[0].clusters[0]);
    assert.equal(f.requests[0].clusters[0].id, `citation:0:${source.length}`);
    assert.equal(f.requests[0].clusters[0].noteIndex, undefined);
    assert.equal(f.requests[0].includeBibliography, false);
    assert.equal(s.el.querySelectorAll(".feuillets-csl-font-italic").length, 1);
  });
}

test("CSL Reading Mode: space-separated clusters both render parenthetically without stray brackets", async (t) => {
  const source = "[@doe2023] [@doe2023; @smith2024]";
  const f = fixture(t, { source, handler: (req) => providerResult(req, (cluster) => {
    const names = cluster.items.map((item) => item.id === "doe2023" ? "Doe et Brown 2023" : "Smith 2024");
    return cluster.items[0].mode === "composite" ? "Doe et Brown (2023)" : `(${names.join("; ")})`;
  }) });
  const s = f.section(f.pane(), { text: source });
  await s.run();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].clusters.map(({ id, items }) => ({ id, items })), [
    { id: "citation:0:10", items: [{ id: "doe2023" }] },
    { id: "citation:11:33", items: [{ id: "doe2023" }, { id: "smith2024" }] },
  ]);
  assert.equal(f.requests[0].clusters[0].items[0].mode ?? "normal", "normal");
  assert.equal(s.el.textContent, "(Doe et Brown 2023) (Doe et Brown 2023; Smith 2024)");
  assert.deepEqual(s.el.querySelectorAll(".feuillets-csl-citation").map((el) => el.getAttribute("data-cluster-id")), ["citation:0:10", "citation:11:33"]);
});

test("CSL Reading Mode: concurrent detached sections share one full numeric document, even when B runs first", async (t) => {
  const source = "Section A [@alpha].\n\nSection B [@beta].";
  const gate = deferred();
  const entered = deferred();
  const f = fixture(t, { source, handler: async (req) => { entered.resolve(); await gate.promise; return providerResult(req); } });
  let documentReads = 0;
  const read = f.vault.read;
  f.vault.read = (file) => { if (file === f.docA) documentReads++; return read(file); };
  const pane = f.pane();
  const a = f.section(pane, { text: "Section A [@alpha].", start: 0 });
  const b = f.section(pane, { text: "Section B [@beta].", start: 2 });
  assert.equal(a.ctx.docId, b.ctx.docId);
  const runs = [b.run(), a.run()];
  await entered.promise;
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].documentId, `reading-mode:${a.ctx.docId}:${f.docA.path}`);
  assert.deepEqual(f.requests[0].clusters.map((cluster) => cluster.items[0].id), ["alpha", "beta"]);
  gate.resolve();
  await Promise.all(runs);
  assert.equal(a.el.textContent, "Section A [1].");
  assert.equal(b.el.textContent, "Section B [2].");
  const again = f.section(pane, { text: "Section B [@beta].", start: 2 });
  await again.run();
  assert.equal(again.el.textContent, "Section B [2].");
  assert.equal(f.requests.length, 1);
  assert.equal(documentReads, 1);
  assert.equal(f.requests[0].revision, 1);
});

test("CSL Reading Mode: repeated keys map to distinct global clusters across and within sections", async (t) => {
  const source = "[@alpha] then [@alpha, p. 9] then [@alpha].\n\nAgain [@alpha].";
  const f = fixture(t, { source });
  const pane = f.pane();
  const a = f.section(pane, { text: source.split("\n")[0] });
  const b = f.section(pane, { text: "Again [@alpha].", start: 2 });
  await Promise.all([b.run(), a.run()]);
  assert.equal(a.el.textContent, "[1] then [2] then [3].");
  assert.equal(b.el.textContent, "Again [4].");
  assert.equal(new Set(a.el.querySelectorAll(".feuillets-csl-citation").map((el) => el.getAttribute("data-cluster-id"))).size, 3);
});

test("CSL Reading Mode: two panes of one file have independent sessions and A destruction leaves B working", async (t) => {
  const f = fixture(t);
  const a = f.pane();
  const b = f.pane();
  await Promise.all([f.section(a, { text: f.docA.content }).run(), f.section(b, { text: f.docA.content }).run()]);
  const [idA, idB] = f.requests.map((req) => req.documentId);
  assert.notEqual(idA, idB);
  assert.equal(idA, `reading-mode:${a.contextId}:${f.docA.path}`);
  assert.equal(idB, `reading-mode:${b.contextId}:${f.docA.path}`);
  a.close();
  assert.deepEqual(f.disposed, [idA]);
  const again = f.section(b, { text: f.docA.content });
  await again.run();
  assert.equal(again.el.textContent, "Text [1].");
  assert.equal(f.requests.length, 2);
  assert.ok(f.host.getLatestSnapshot(idB));
});

test("CSL Reading Mode: ctx.sourcePath selects independent inherited bibliography and style scopes", async (t) => {
  const f = fixture(t);
  await Promise.all([
    f.section(f.pane(f.docA), { text: f.docA.content }).run(),
    f.section(f.pane(f.docB), { text: f.docB.content }).run(),
  ]);
  assert.deepEqual(f.requests.map((req) => [req.bibliographies[0].id, req.style.id]), [[f.bibA.path, f.cslA.path], [f.bibB.path, f.cslB.path]]);
});

test("CSL Reading Mode: missing provider appears then disappears, waking existing panes without reopening", async (t) => {
  const f = fixture(t, { provider: false });
  const pane = f.pane();
  const raw = f.section(pane, { text: f.docA.content });
  await raw.run();
  assert.equal(raw.el.textContent, f.docA.content);
  assert.equal(f.requests.length, 0);
  f.registry.register(f.engine);
  await Promise.resolve();
  assert.deepEqual(pane.rerenders, [true]);
  raw.unload();
  const rendered = f.section(pane, { text: f.docA.content });
  await rendered.run();
  assert.equal(rendered.el.textContent, "Text [1].");
  f.registry.unregister(f.engine.id);
  await Promise.resolve();
  assert.deepEqual(pane.rerenders, [true, true]);
  rendered.unload();
  const rawAgain = f.section(pane, { text: f.docA.content });
  await rawAgain.run();
  assert.equal(rawAgain.el.textContent, f.docA.content);
  assert.equal(f.requests.length, 1);
});

for (const [name, handler] of [
  ["engine exception", () => { throw new Error("Engine error"); }],
  ["invalid result", () => ({ citations: "invalid" })],
  ["UNKNOWN_CITEKEY", (req) => ({ ...providerResult(req), citations: [], diagnostics: [{ severity: "error", code: "UNKNOWN_CITEKEY", message: "Unknown key" }] })],
  ["UNKNOWN_CITEKEY with partial output", (req) => ({ ...providerResult(req), diagnostics: [{ severity: "error", code: "UNKNOWN_CITEKEY", message: "Unknown key" }] })],
  ["missing global cluster", (req) => ({ ...providerResult(req), citations: providerResult(req).citations.slice(0, 1) })],
]) {
  test(`CSL Reading Mode: ${name} leaves the whole document raw without legacy fallback`, async (t) => {
    const source = "[@smith2024]\n\n[@unknown]";
    const f = fixture(t, { source, handler });
    const pane = f.pane();
    const a = f.section(pane, { text: "[@smith2024]" });
    const b = f.section(pane, { text: "[@unknown]", start: 2 });
    await Promise.all([a.run(), b.run()]);
    assert.equal(a.el.textContent, "[@smith2024]");
    assert.equal(b.el.textContent, "[@unknown]");
    assert.equal(f.requests.length, 1);
  });
}

for (const key of ["bibA", "cslA"]) {
  test(`CSL Reading Mode: modifying ${key} refreshes only dependent panes, coalesces rerenders and never loops`, async (t) => {
    const f = fixture(t);
    const a = f.pane();
    const b = f.pane(f.docB);
    await Promise.all([f.section(a, { text: f.docA.content }).run(), f.section(b, { text: f.docB.content }).run()]);
    f[key].content += " changed";
    f[key].stat.mtime++;
    f.modifyResource(f[key]);
    await Promise.resolve();
    assert.deepEqual(a.rerenders, [true]);
    assert.deepEqual(b.rerenders, []);
    await f.section(a, { text: f.docA.content }).run();
    await Promise.resolve();
    assert.equal(f.requests.length, 3);
    assert.deepEqual(a.rerenders, [true]);
    assert.equal(f.requests[2].documentId, f.requests[0].documentId);
    assert.equal(key === "bibA" ? f.requests[2].bibliographies[0].content : f.requests[2].style.xml, f[key].content);
  });
}

test("CSL Reading Mode: changing citekeyCslPath wakes the current pane and resolves the new style", async (t) => {
  const f = fixture(t, { handler: (req) => providerResult(req, () => req.style.xml) });
  const pane = f.pane();
  await f.section(pane, { text: f.docA.content }).run();
  const newStyle = new TFile(`${f.researchA.path}/new-style.csl`, "<style>New style</style>");
  newStyle.stat = { mtime: 200, size: newStyle.content.length };
  newStyle.parent = f.researchA;
  f.files.set(newStyle.path, newStyle);
  f.settings.projectMeta[f.root.path].folderWorkspaces["Article-A"].citekeyCslPath = "new-style.csl";
  f.host.invalidateAllResources();
  await Promise.resolve();
  assert.deepEqual(pane.rerenders, [true]);
  const s = f.section(pane, { text: f.docA.content });
  await s.run();
  assert.equal(f.requests[1].style.id, newStyle.path);
  assert.equal(s.el.textContent, `Text ${newStyle.content}.`);
});

test("CSL Reading Mode: style changes to off and back to CSL refresh without reload", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  await f.section(pane, { text: f.docA.content }).run();
  f.settings.projectMeta[f.root.path].pandocCitationPreviewStyle = "off";
  f.host.invalidateAllResources();
  await Promise.resolve();
  const off = f.section(pane, { text: f.docA.content });
  await off.run();
  assert.equal(off.el.textContent, f.docA.content);
  assert.equal(f.requests.length, 1);
  f.settings.projectMeta[f.root.path].pandocCitationPreviewStyle = "csl";
  f.host.invalidateAllResources();
  await Promise.resolve();
  const csl = f.section(pane, { text: f.docA.content });
  await csl.run();
  assert.equal(csl.el.textContent, "Text [1].");
  assert.deepEqual(pane.rerenders, [true, true]);
});

test("CSL Reading Mode: popout AST nodes all use the pane ownerDocument, with safe links only", async (t) => {
  const f = fixture(t, { handler: (req) => {
    const result = providerResult(req);
    result.citations[0].content = [
      { type: "link", href: "javascript:alert(1)", children: [{ type: "text", text: "Unsafe" }] },
      { type: "link", href: "https://example.com", children: [{ type: "text", text: "Safe" }] },
    ];
    return result;
  } });
  const popout = new ReadingDocument();
  const s = f.section(f.pane(f.docA, popout), { text: f.docA.content });
  await s.run();
  const verify = (node) => { assert.equal(node.ownerDocument, popout); node.childNodes.forEach(verify); };
  verify(s.el);
  assert.equal(s.el.querySelectorAll("a").length, 1);
  assert.equal(s.el.querySelectorAll("a")[0].href, "https://example.com");
  assert.equal(s.el.querySelectorAll(".feuillets-csl-link-disabled").length, 1);
});

test("CSL Reading Mode: protected DOM contexts and Markdown link destinations remain untouched", async (t) => {
  const source = "[@smith2024] `[@smith2024]` <pre>[@smith2024]</pre> <script>[@smith2024]</script> <style>[@smith2024]</style> [see @who2021](https://example.com/@who2021)";
  const f = fixture(t, { source });
  const s = f.section(f.pane());
  s.el.appendChild(s.el.ownerDocument.createTextNode("[@smith2024] "));
  for (const tag of ["code", "pre", "script", "style", "a"]) {
    const el = s.el.ownerDocument.createElement(tag);
    el.textContent = tag === "a" ? "see @who2021" : "[@smith2024]";
    if (tag === "a") el.setAttribute("href", "https://example.com/@who2021");
    s.el.appendChild(el);
  }
  await s.run();
  assert.equal(s.el.querySelectorAll(".feuillets-csl-citation").length, 1);
  for (const tag of ["code", "pre", "script", "style"]) assert.equal(s.el.querySelectorAll(tag)[0].textContent, "[@smith2024]");
  assert.equal(s.el.querySelectorAll("a")[0].textContent, "see @who2021");
  assert.equal(s.el.querySelectorAll("a")[0].getAttribute("href"), "https://example.com/@who2021");
});

test("CSL Reading Mode: inline notes stay raw and the host retains only the inner cluster without noteIndex", async (t) => {
  const source = "^[Voir [@doe2023, p. 57] pour une discussion.]";
  const f = fixture(t, { source });
  const s = f.section(f.pane(), { text: source });
  await s.run();
  assert.equal(s.el.textContent, source);
  assert.deepEqual(f.requests[0].clusters, [{ id: "citation:7:24", items: [{ id: "doe2023", locator: "57", label: "page" }] }]);
  assert.equal(f.requests[0].clusters[0].noteIndex, undefined);
  assert.equal(f.requests[0].includeBibliography, false);
});

for (const [name, options] of [
  ["null section", { info: null }],
  ["stale source", { info: { text: "Wrong source", lineStart: 0, lineEnd: 0 } }],
  ["invalid lines", { start: 9, end: 9 }],
  ["missing DOM occurrence", { text: "Text with no citation" }],
  ["ambiguous duplicate DOM", { text: "[@smith2024] and [@smith2024]" }],
]) {
  test(`CSL Reading Mode: ${name} fails closed`, async (t) => {
    const f = fixture(t);
    const s = f.section(f.pane(), { text: f.docA.content, ...options });
    const before = s.el.textContent;
    await s.run();
    assert.equal(s.el.textContent, before);
    assert.equal(s.el.querySelectorAll(".feuillets-csl-citation").length, 0);
  });
}

test("CSL Reading Mode: last section teardown disposes a session; other section teardown does not", async (t) => {
  const f = fixture(t, { source: "[@alpha]\n\n[@beta]" });
  const pane = f.pane();
  const a = f.section(pane, { text: "[@alpha]" });
  const b = f.section(pane, { text: "[@beta]", start: 2 });
  await Promise.all([a.run(), b.run()]);
  const id = f.requests[0].documentId;
  a.unload();
  assert.deepEqual(f.disposed, []);
  b.unload();
  assert.deepEqual(f.disposed, [id]);
  await f.section(pane, { text: "[@beta]", start: 2 }).run();
  assert.equal(f.requests[1].documentId, id);
  assert.equal(f.requests[1].revision, 1);
});

test("CSL Reading Mode: file switch disposes the old session even when the new file has no citation", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  await f.section(pane, { text: f.docA.content }).run();
  const id = f.requests[0].documentId;
  pane.openFile(f.docB);
  assert.deepEqual(f.disposed, [id]);
  await f.section(pane, { text: f.docB.content }).run();
  assert.notEqual(f.requests[1].documentId, id);
});

test("CSL Reading Mode: destroying a pane during the Vault read never creates a late provider session", async (t) => {
  const f = fixture(t);
  const gate = deferred();
  const baseRead = f.vault.read;
  f.vault.read = async (file) => { if (file === f.docA) await gate.promise; return baseRead(file); };
  const pane = f.pane();
  const s = f.section(pane, { text: f.docA.content });
  const run = s.run();
  pane.close();
  gate.resolve();
  await run;
  assert.equal(f.requests.length, 0);
  assert.equal(s.el.textContent, f.docA.content);
});

test("CSL Reading Mode: invalidating during provider rendering prevents stale DOM writes", async (t) => {
  const gate = deferred();
  const entered = deferred();
  const f = fixture(t, { handler: async (req) => { entered.resolve(); await gate.promise; return providerResult(req); } });
  const pane = f.pane();
  const s = f.section(pane, { text: f.docA.content });
  const run = s.run();
  await entered.promise;
  f.registry.unregister(f.engine.id);
  gate.resolve();
  await run;
  assert.equal(s.el.textContent, f.docA.content);
  assert.deepEqual(f.disposed, [f.requests[0].documentId]);
});

test("CSL Reading Mode: create/delete/rename global invalidation wakes unavailable and ready panes", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  f.files.delete(f.cslA.path);
  const missing = f.section(pane, { text: f.docA.content });
  await missing.run();
  assert.equal(missing.el.textContent, f.docA.content);
  f.files.set(f.cslA.path, f.cslA);
  f.host.invalidateAllResources();
  await Promise.resolve();
  const ready = f.section(pane, { text: f.docA.content });
  await ready.run();
  assert.equal(ready.el.textContent, "Text [1].");
  f.files.delete(f.cslA.path);
  f.host.invalidateAllResources();
  await Promise.resolve();
  const deleted = f.section(pane, { text: f.docA.content });
  await deleted.run();
  assert.equal(deleted.el.textContent, f.docA.content);
  f.files.set(f.cslA.path, f.cslA);
  await f.fileManager.renameFile(f.cslA, `${f.researchA.path}/renamed.csl`);
  f.settings.projectMeta[f.root.path].folderWorkspaces["Article-A"].citekeyCslPath = "renamed.csl";
  f.host.invalidateAllResources();
  await Promise.resolve();
  await f.section(pane, { text: f.docA.content }).run();
  assert.equal(f.requests.at(-1).style.id, f.cslA.path);
  assert.deepEqual(pane.rerenders, [true, true, true]);
});

for (const key of ["citekeyBibliographyPath", "citekeyCslPath"]) {
  test(`CSL Reading Mode: missing or invalid ${key} remains raw`, async (t) => {
    const f = fixture(t);
    const pane = f.pane();
    const config = f.settings.projectMeta[f.root.path].folderWorkspaces["Article-A"];
    for (const path of ["", "missing.file", "../unsafe.file"]) {
      config[key] = path;
      f.host.invalidateAllResources();
      const s = f.section(pane, { text: f.docA.content });
      await s.run();
      assert.equal(s.el.textContent, f.docA.content);
      assert.equal(f.requests.length, 0);
    }
  });
}

test("CSL Reading Mode: changing bibliography settings reads the new resource", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  await f.section(pane, { text: f.docA.content }).run();
  const bib = new TFile(`${f.researchA.path}/new.bib`, "@book{smith2024,author={Smith},year={2025}}");
  bib.stat = { mtime: 200, size: bib.content.length };
  bib.parent = f.researchA;
  f.files.set(bib.path, bib);
  f.settings.projectMeta[f.root.path].folderWorkspaces["Article-A"].citekeyBibliographyPath = "new.bib";
  f.host.invalidateAllResources();
  await Promise.resolve();
  await f.section(pane, { text: f.docA.content }).run();
  assert.equal(f.requests[1].bibliographies[0].id, bib.path);
  assert.equal(f.requests[1].bibliographies[0].content, bib.content);
});

test("CSL Reading Mode: off never calls the provider", async (t) => {
  const f = fixture(t, { style: "off" });
  const s = f.section(f.pane(), { text: f.docA.content });
  await s.run();
  assert.equal(s.el.textContent, f.docA.content);
  assert.equal(s.children.length, 0);
  assert.equal(f.requests.length, 0);
});

test("CSL Reading Mode: section metadata changing during render prevents stale replacements", async (t) => {
  const entered = deferred();
  const gate = deferred();
  const f = fixture(t, { handler: async (req) => { entered.resolve(); await gate.promise; return providerResult(req); } });
  const s = f.section(f.pane(), { text: f.docA.content });
  const run = s.run();
  await entered.promise;
  s.ctx.getSectionInfo = () => ({ text: "Changed", lineStart: 0, lineEnd: 0 });
  gate.resolve();
  await run;
  assert.equal(s.el.textContent, f.docA.content);
});

test("CSL Reading Mode: reordered DOM and split citation syntax remain raw", async (t) => {
  const f = fixture(t, { source: "[@alpha] and [@beta]" });
  const pane = f.pane();
  const reordered = f.section(pane, { text: "[@beta] and [@alpha]" });
  await reordered.run();
  assert.equal(reordered.el.textContent, "[@beta] and [@alpha]");
  const split = f.section(pane);
  split.el.appendChild(pane.ownerDocument.createTextNode("[@al"));
  const emphasis = pane.ownerDocument.createElement("em");
  emphasis.textContent = "pha]";
  split.el.appendChild(emphasis);
  await split.run();
  assert.equal(split.el.textContent, "[@alpha]");
  assert.equal(split.el.querySelectorAll(".feuillets-csl-citation").length, 0);
});

test("CSL Reading Mode: missing or inconsistent public renderer identity fails closed", async (t) => {
  const f = fixture(t);
  const a = f.pane();
  const s = f.section(a, { text: f.docA.content });
  for (const docId of [undefined, null, "", "   "]) {
    s.ctx.docId = docId;
    await s.run();
    assert.equal(f.requests.length, 0);
    assert.equal(s.el.textContent, f.docA.content);
  }
  s.ctx.docId = a.contextId;
  await s.run();
  const b = f.pane();
  const inconsistent = f.section(b, { text: f.docA.content });
  inconsistent.ctx.docId = a.contextId;
  await inconsistent.run();
  assert.equal(f.requests.length, 1);
  assert.equal(inconsistent.el.textContent, f.docA.content);
});

test("CSL Reading Mode: ancestor protection applies to fragments nested in links, code, embeds and callouts", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  for (const [tag, cls] of [["a", ""], ["code", ""], ["div", "internal-embed"], ["div", "callout"]]) {
    const parent = pane.ownerDocument.createElement(tag);
    parent.classList.add(cls);
    const s = f.section(pane, { text: f.docA.content });
    parent.appendChild(s.el);
    await s.run();
    assert.equal(s.el.textContent, f.docA.content);
  }
});

test("CSL Reading Mode: section unload during provider rendering and renderer destruction release the session", async (t) => {
  const entered = deferred();
  const gate = deferred();
  const f = fixture(t, { handler: async (req) => { entered.resolve(); await gate.promise; return providerResult(req); } });
  const pane = f.pane();
  const s = f.section(pane, { text: f.docA.content });
  const run = s.run();
  await entered.promise;
  s.unload();
  gate.resolve();
  await run;
  assert.equal(s.el.textContent, f.docA.content);
  assert.deepEqual(f.disposed, [f.requests[0].documentId]);
  await f.section(pane, { text: f.docA.content }).run();
  pane.close();
  assert.equal(f.disposed.length, 2);
});

test("CSL Reading Mode: CRLF section offsets and saved Markdown changes retain global order", async (t) => {
  const f = fixture(t, { source: "Start [@alpha].\r\n\r\nThen [@beta]." });
  const pane = f.pane();
  const b = f.section(pane, { text: "Then [@beta].", start: 2 });
  await b.run();
  assert.equal(b.el.textContent, "Then [2].");
  f.docA.content = "Start [@gamma].\r\n\r\nThen [@beta].";
  const changed = f.section(pane, { text: "Start [@gamma].", start: 0 });
  await changed.run();
  assert.equal(changed.el.textContent, "Start [1].");
  assert.equal(f.requests[1].revision, 2);
  assert.deepEqual(f.requests[1].clusters.map((cluster) => cluster.items[0].id), ["gamma", "beta"]);
});

test("CSL Reading Mode: invalid providers and failed Vault reads leave raw syntax", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  const originalRender = f.engine.renderDocument;
  f.engine.renderDocument = null;
  const invalid = f.section(pane, { text: f.docA.content });
  await invalid.run();
  assert.equal(invalid.el.textContent, f.docA.content);
  assert.equal(f.requests.length, 0);
  f.engine.renderDocument = originalRender;
  const read = f.vault.read;
  for (const failedFile of [f.docA, f.bibA, f.cslA]) {
    f.vault.read = (file) => file === failedFile ? Promise.reject(new Error("Read failure")) : read(file);
    f.host.invalidateAllResources();
    const s = f.section(pane, { text: f.docA.content });
    await s.run();
    assert.equal(s.el.textContent, f.docA.content);
    assert.equal(f.requests.length, 0);
  }
});

test("CSL Reading Mode: public context alone identifies detached sections without consulting MarkdownView", async (t) => {
  const f = fixture(t);
  const pane = f.pane(f.docB);
  Object.defineProperty(pane.view.previewMode, "docId", {
    get: () => { throw new Error("Private renderer identity must never be read"); },
  });
  f.app.workspace.getLeavesOfType = () => { throw new Error("Rendering must not search for a MarkdownView"); };
  const s = f.section(pane, { text: f.docA.content, info: { text: f.docA.content, lineStart: 0, lineEnd: 0 } });
  s.ctx.docId = "public-context-only";
  s.ctx.sourcePath = f.docA.path;
  await s.run();
  assert.equal(s.el.textContent, "Text [1].");
  assert.equal(f.requests[0].documentId, `reading-mode:public-context-only:${f.docA.path}`);
  assert.equal(f.requests[0].bibliographies[0].id, f.bibA.path);
  assert.equal(f.requests[0].style.id, f.cslA.path);
  s.unload();
  assert.deepEqual(f.disposed, [f.requests[0].documentId]);
});

test("CSL Reading Mode: sourcePath change in one context disposes the old session before delayed section teardown", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  const old = f.section(pane, { text: f.docA.content });
  await old.run();
  const idA = f.requests[0].documentId;
  pane.view.file = f.docB;
  const next = f.section(pane, { text: f.docB.content });
  assert.equal(old.ctx.docId, next.ctx.docId);
  await next.run();
  const idB = f.requests[1].documentId;
  assert.equal(idB, `reading-mode:${next.ctx.docId}:${f.docB.path}`);
  assert.deepEqual(f.disposed, [idA]);
  old.unload();
  assert.deepEqual(f.disposed, [idA]);
  assert.ok(f.host.getLatestSnapshot(idB));
  pane.close();
  assert.deepEqual(f.disposed, [idA, idB]);
});

test("CSL Reading Mode: a context switching to off disposes its old session without rendering the new file", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  await f.section(pane, { text: f.docA.content }).run();
  f.settings.projectMeta[f.root.path].pandocCitationPreviewStyle = "off";
  pane.view.file = f.docB;
  const s = f.section(pane, { text: f.docB.content });
  await s.run();
  assert.deepEqual(f.disposed, [f.requests[0].documentId]);
  assert.equal(f.requests.length, 1);
  assert.equal(s.el.textContent, f.docB.content);
});

test("CSL Reading Mode: destructive rerender keeps the public documentId and disposes every provider generation", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  for (let i = 0; i < 3; i++) {
    await f.section(pane, { text: f.docA.content }).run();
    pane.view.previewMode.rerender(true);
  }
  const id = `reading-mode:${pane.contextId}:${f.docA.path}`;
  assert.deepEqual(f.requests.map((request) => request.documentId), [id, id, id]);
  assert.deepEqual(f.requests.map((request) => request.revision), [1, 1, 1]);
  assert.deepEqual(f.disposed, [id, id, id]);
  assert.equal(f.host.getLatestSnapshot(id), null);
});

test("CSL Reading Mode: replacement renderer context receives a new session after the old children unload", async (t) => {
  const f = fixture(t);
  const pane = f.pane();
  await f.section(pane, { text: f.docA.content }).run();
  const previousId = f.requests[0].documentId;
  pane.unload();
  pane.contextId = "replacement-renderer";
  await f.section(pane, { text: f.docA.content }).run();
  assert.deepEqual(f.disposed, [previousId]);
  assert.equal(f.requests[1].documentId, `reading-mode:replacement-renderer:${f.docA.path}`);
  assert.equal(f.host.getLatestSnapshot(previousId), null);
});

for (const property of ["docId", "sourcePath"]) {
  test(`CSL Reading Mode: changing or losing public ${property} during rendering leaves the section raw`, async (t) => {
    for (const missing of [false, true]) {
      const entered = deferred();
      const gate = deferred();
      const f = fixture(t, { handler: async (request) => { entered.resolve(); await gate.promise; return providerResult(request); } });
      const s = f.section(f.pane(), { text: f.docA.content });
      const run = s.run();
      await entered.promise;
      s.ctx[property] = missing ? undefined : property === "docId" ? "changed-renderer" : f.docB.path;
      gate.resolve();
      await run;
      assert.equal(s.el.textContent, f.docA.content);
      s.unload();
      assert.deepEqual(f.disposed, [f.requests[0].documentId]);
    }
  });
}

test("CSL Reading Mode: missing public sourcePath fails closed before Vault lookup", async (t) => {
  const f = fixture(t);
  const s = f.section(f.pane(), { text: f.docA.content });
  f.vault.getAbstractFileByPath = () => { throw new Error("Missing source identity must not be resolved"); };
  for (const path of [undefined, null, "", "   "]) {
    s.ctx.sourcePath = path;
    await s.run();
    assert.equal(s.el.textContent, f.docA.content);
  }
  assert.equal(f.requests.length, 0);
});
