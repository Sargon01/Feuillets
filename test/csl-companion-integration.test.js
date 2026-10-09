import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";

// Run with FEUILLETS_CSL_SOURCE=/path/to/Feuillets-CSL. Neither private fixture
// content nor rendered metadata is written to logs or included in this repository.
const companion = process.env.FEUILLETS_CSL_SOURCE;
const available = companion && existsSync(resolve(companion, "main.ts")) && existsSync(chromium.executablePath());

test("real Feuillets CSL: registration, resources and all rendering surfaces isolate bibliography errors", { skip: !available }, async (t) => {
  const bundle = await build({
    stdin: { contents: `export { default as CompanionPlugin } from ${JSON.stringify(resolve(companion, "main.ts"))};
      export { CslCitationHost } from "./services/csl-citation-host.ts";
      export { CitationEngineRegistry, validateCitationClusterResults } from "./api/citation-engine.ts";
      export { buildScriveningsDocument, boundaryOffsets } from "./services/scrivenings-document.ts";
      export { createScriveningsCitationExtension } from "./utils/cm-scrivenings-citations.ts";
      export { createPandocCitationLivePreviewExtension } from "./utils/cm-pandoc-citation-live-preview.ts";
      export { registerPandocCitationReadingMode } from "./services/pandoc-citation-reading-mode.ts";
      export { applyNativeCslToStaticRender } from "./services/pandoc-citation-static-csl.ts";
      export { parsePandocCitationDocument } from "./services/pandoc-citation-parser.ts";
      export { PreviewView } from "./views/preview-view.ts";
      export { EditorState, StateField } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export { TFile, TFolder, Plugin, MarkdownRenderer, editorInfoField, editorLivePreviewField } from "obsidian";`, resolveDir: resolve("src") },
    bundle: true, write: false, format: "iife", globalName: "CslIntegration", platform: "browser", loader: { ".xml": "text" },
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "obsidian-test-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian-with-editor-fields", namespace: "obsidian-with-editor-fields" }));
      builder.onLoad({ filter: /.*/, namespace: "obsidian-with-editor-fields" }, () => ({
        contents: `export * from ${JSON.stringify(resolve("test/obsidian-runtime-stub.mjs"))};
          import { StateField } from ${JSON.stringify(resolve("node_modules/@codemirror/state/dist/index.js"))};
          export const editorInfoField = StateField.define({create: () => null, update: value => value});
          export const editorLivePreviewField = StateField.define({create: () => false, update: value => value});`,
        resolveDir: resolve("test"),
      }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const scenarios = [{ label: "synthetic", bib: `@book{known,title={Synthetic Study},author={Example, Alice},year={2020}}
    @misc{misc,title={Miscellaneous Work},author={Sample, Bob},publisher={Synthetic Press},year={2021}}
    @customtype{unsupported,title={Rejected}}
    @book{ambiguous,title={First},year={2020}}
    @book{ambiguous,title={Second},year={2021}}
    @book{cycle,title={Cyclic Parent},crossref={cycle}}
    @incollection{dependent,title={Dependent Child},crossref={ambiguous}}
    @book{crossSourceDuplicate,title={First Source}}`,
    xml: readFileSync(resolve(companion, "test/fixtures/styles/chicago-notes-bibliography-public.csl"), "utf8"),
    keys: ["known", "misc"], failed: ["missing", "ambiguous", "unsupported", "cycle", "dependent"],
    expectedCodes: ["UNKNOWN_CITEKEY", "DUPLICATE_CITEKEY", "UNSUPPORTED_BIBTEX_TYPE", "CYCLIC_CROSSREF", "AMBIGUOUS_CROSSREF"] }];
  if (process.env.CSL_PRIVATE_BIB && process.env.CSL_PRIVATE_STYLE) {
    assert.ok(process.env.CSL_PRIVATE_KEYS, "CSL_PRIVATE_KEYS must supply a JSON array of valid keys for the private scenario");
    scenarios.push({
    label: "private", bib: readFileSync(process.env.CSL_PRIVATE_BIB, "utf8"), xml: readFileSync(process.env.CSL_PRIVATE_STYLE, "utf8"),
    keys: JSON.parse(process.env.CSL_PRIVATE_KEYS),
    failed: ["syntheticUnknown9999"], expectedCodes: ["UNKNOWN_CITEKEY"],
    });
  }
  if (process.env.CSL_DEMO_BIB && process.env.CSL_DEMO_STYLE) {
    const bib = readFileSync(process.env.CSL_DEMO_BIB, "utf8");
    for (const [label, style] of [["developer-demo", process.env.CSL_DEMO_STYLE], ["developer-bib-private-style", process.env.CSL_PRIVATE_STYLE]]) {
      if (style) scenarios.push({ label, bib, xml: readFileSync(style, "utf8"), keys: ["feuilletsChicagoTest2026"], failed: ["syntheticUnknown9999"], expectedCodes: ["UNKNOWN_CITEKEY"] });
    }
  }
  for (const scenario of scenarios) await t.test(scenario.label, async () => {
    const state = await page.evaluate(async (input) => {
      const api = window.CslIntegration;
      const make = (tag, options = {}, parent) => {
        const el = document.createElement(tag);
        if (options.cls) el.className = options.cls;
        if (options.text) el.textContent = options.text;
        for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
        parent?.appendChild(el);
        return el;
      };
      window.createEl = (tag, options) => make(tag, options);
      window.createDiv = (options) => make("div", options);
      window.createSpan = (options) => make("span", options);
      HTMLElement.prototype.createEl = function (tag, options) { return make(tag, options, this); };
      HTMLElement.prototype.createDiv = function (options) { return this.createEl("div", options); };
      HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
      HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
      HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
      HTMLElement.prototype.setAttr = function (key, value) { this.setAttribute(key, value); };
      HTMLElement.prototype.setCssStyles = function (styles) { Object.assign(this.style, styles); };
      HTMLElement.prototype.empty = function () { this.replaceChildren(); };
      const timers = [];
      api.Plugin.prototype.registerInterval = (id) => timers.push(id);
      api.Plugin.prototype.onunload = () => {};
      const root = new api.TFolder("Book");
      const draft = new api.TFolder("Book/Draft");
      const research = new api.TFolder("Book/Research");
      const markdown = [...input.keys.map((key) => `[@${key}]`), ...input.failed.map((key) => `[@${input.keys[0]}; @${key}]`), `[@${input.keys[0]}]`, "End of document."].join("\n\n");
      const file = new api.TFile("Book/Draft/Chapter.md", markdown);
      const bib = new api.TFile("Book/Research/library.bib", input.bib);
      const style = new api.TFile("Book/Research/style.csl", input.xml);
      const alternateBib = new api.TFile("Book/Research/alternate.bib", input.bib);
      const alternateStyle = new api.TFile("Book/Research/alternate.csl", input.xml);
      const files = [root, draft, research, file, bib, style, alternateBib, alternateStyle];
      root.children = [draft, research]; draft.parent = root; research.parent = root;
      draft.children = [file]; file.parent = draft;
      research.children = [bib, style, alternateBib, alternateStyle];
      for (const item of research.children) { item.parent = research; item.stat = { mtime: 1, size: item.content.length }; }
      const indexed = new Map(files.map((item) => [item.path, item]));
      const settings = { projectFolder: "Book", exportTemplate: "documentSimple", projectMeta: { Book: {
        pandocCitationPreviewStyle: "csl", researchFolderLinks: { Book: research.path },
        citekeyBibliographyPath: "library.bib", citekeyCslPath: "style.csl",
      } } };
      const registry = new api.CitationEngineRegistry();
      const citationApi = { apiVersion: 2, registerProvider: (p) => registry.register(p), unregisterProvider: (id) => registry.unregister(id), getProvider: (id) => registry.get(id) };
      const app = { plugins: { plugins: { feuillets: { api: { citations: citationApi } } } },
        workspace: { onLayoutReady: (cb) => cb(), getLeavesOfType: () => [] },
        vault: { getAbstractFileByPath: (path) => indexed.get(path), cachedRead: async (source) => source.content, read: async (source) => source.content },
        metadataCache: { getFileCache: () => ({}) } };
      const plugin = new api.CompanionPlugin(app, { version: "test" });
      plugin.onload();
      const provider = registry.get("feuillets-csl");
      const registered = provider === plugin.getProvider() && plugin.isConnected();
      const render = provider.renderDocument.bind(provider);
      const requests = [];
      const results = [];
      provider.renderDocument = async (req) => { requests.push(req); const result = await render(req); results.push(result); return result; };
      const host = new api.CslCitationHost({ app, settings, citationRegistry: registry });
      const initial = await host.renderDocument("resource-proof", markdown, root, file);
      const cached = await host.renderDocument("resource-proof", markdown, root, file);
      const cacheHit = initial === cached && requests.length === 1;
      settings.projectMeta.Book.folderWorkspaces = { Draft: { citekeyBibliographyPath: "alternate.bib", citekeyCslPath: "alternate.csl" } };
      const overridden = await host.renderDocument("resource-proof", markdown, root, file);
      const overrideResolved = requests.at(-1).style.id === alternateStyle.path && requests.at(-1).bibliographies[0].id === alternateBib.path;
      host.invalidateResource(alternateBib.path);
      await host.renderDocument("resource-proof", markdown, root, file);
      const invalidationRendered = requests.length === 3;

      const doc = api.buildScriveningsDocument([{ file, content: markdown }]);
      const boundaries = api.boundaryOffsets(doc);
      const field = api.StateField.define({ create: () => boundaries, update: (value) => value });
      const Extension = api.createScriveningsCitationExtension(field, app, () => settings, [file], { document: doc, projectRoot: root, getHost: () => host });
      const editorParent = make("div", {}, document.body);
      const view = new api.EditorView({ parent: editorParent, state: api.EditorState.create({ doc: doc.text,
        selection: { anchor: doc.text.length }, extensions: [field, Extension] }) });
      for (let attempt = 0; attempt < 30 && view.dom.querySelectorAll(".feuillets-csl-citation").length < input.keys.length + 1; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const instance = view.plugin(Extension);
      const decorations = [];
      instance.decorations.between(0, doc.text.length, (from, to, value) => decorations.push({ from, to, widget: value.spec.widget }));
      const continu = { count: decorations.length, allNonempty: decorations.every((d) => d.widget.citation.plainText.length > 0),
        widgetCount: view.dom.querySelectorAll(".feuillets-csl-citation").length,
        rawFailed: input.failed.every((key) => view.dom.textContent.includes(`[@${input.keys[0]}; @${key}]`)),
        rawKeys: decorations.map((d) => doc.text.slice(d.from, d.to)), sourceUnchanged: file.content === markdown && view.state.doc.toString() === doc.text };
      view.destroy(); editorParent.remove();

      const liveExtension = api.createPandocCitationLivePreviewExtension(() => settings, () => host);
      const liveParent = make("div", {}, document.body);
      const liveView = new api.EditorView({ parent: liveParent, state: api.EditorState.create({ doc: markdown,
        selection: { anchor: markdown.length }, extensions: [api.editorInfoField.init(() => ({ app, file })),
          api.editorLivePreviewField.init(() => true), liveExtension] }) });
      for (let attempt = 0; attempt < 50 && liveView.dom.querySelectorAll(".feuillets-csl-citation").length < input.keys.length + 1; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const live = { count: liveView.dom.querySelectorAll(".feuillets-csl-citation").length,
        rawFailed: input.failed.every((key) => liveView.dom.textContent.includes(`[@${input.keys[0]}; @${key}]`)),
        sourceUnchanged: liveView.state.doc.toString() === markdown };
      liveView.destroy(); liveParent.remove();

      const readingContainer = make("div", {}, document.body);
      for (const paragraph of markdown.split(/\n\n/)) make("p", { text: paragraph }, readingContainer);
      let postprocessor;
      const readingCleanup = [];
      api.registerPandocCitationReadingMode({ app, settings, cslCitationHost: host,
        register: (cleanup) => readingCleanup.push(cleanup), registerMarkdownPostProcessor: (callback) => { postprocessor = callback; } });
      await postprocessor(readingContainer, { sourcePath: file.path, docId: "integration-reading",
        getSectionInfo: () => ({ text: markdown, lineStart: 0, lineEnd: markdown.split("\n").length - 1 }),
        addChild: (child) => readingCleanup.push(() => child.onunload()) });
      const reading = { count: readingContainer.querySelectorAll(".feuillets-csl-citation").length,
        rawFailed: input.failed.every((key) => readingContainer.textContent.includes(`[@${input.keys[0]}; @${key}]`)) };
      readingCleanup.forEach((cleanup) => cleanup()); readingContainer.remove();

      const anchorAttribute = "data-feuillets-csl-bibliography-anchor";
      const staticContainer = make("div", {}, document.body);
      for (const paragraph of markdown.split(/\n\n/)) make("p", { text: paragraph }, staticContainer);
      const call = make("sup", { cls: "footnote-ref" }, staticContainer);
      make("a", { text: "1", attr: { href: "#fn-audit" } }, call);
      const notes = make("section", { cls: "footnotes" }, staticContainer);
      const list = make("ol", {}, notes);
      make("li", { text: `[@${input.keys[0]}]`, attr: { id: "fn-audit" } }, list);
      make("div", { attr: { [anchorAttribute]: "true" } }, staticContainer);
      const staticSource = `${markdown}\n\nA note[^audit].\n\n[^audit]: [@${input.keys[0]}]`;
      const staticSuccess = await api.applyNativeCslToStaticRender({ app, settings, host, projectRoot: root,
        container: staticContainer, sources: [{ file, path: file.path, text: staticSource }], documentId: "integration-static" });
      const staticRender = { success: staticSuccess, count: staticContainer.querySelectorAll(".feuillets-csl-citation").length,
        footnoteCount: notes.querySelectorAll(".feuillets-csl-citation").length,
        bibliographyCount: staticContainer.querySelectorAll(".feuillets-csl-bibliography-entry").length,
        rawFailed: input.failed.every((key) => staticContainer.textContent.includes(`[@${input.keys[0]}; @${key}]`)) };
      const bibliographyDiagnostics = results.at(-1).diagnostics.map((d) => d.code);
      staticContainer.remove();

      // Exercise PreviewView's actual render method, CSL callback, pagination
      // and iframe. Only MarkdownRenderer and unrelated chrome are stubbed.
      api.MarkdownRenderer.render = async (_app, text, container) => {
        for (const paragraph of text.split(/\n\n/)) {
          if (paragraph.startsWith(`<div ${anchorAttribute}=`)) make("div", { attr: { [anchorAttribute]: "true" } }, container);
          else make("p", { text: paragraph }, container);
        }
      };
      const preview = Object.create(api.PreviewView.prototype);
      Object.defineProperty(preview, "mode", { value: "scene" });
      Object.assign(preview, { app, plugin: { settings, cslCitationHost: host, getProjectFolder: () => root }, refreshGeneration: 1,
        scaledContainer: make("div", {}, document.body), zoomScale: 1, updateUI: () => {},
        onFrameLoad: (_generation, frame) => { preview.previewFrame = frame; } });
      await preview.renderPreviewSource({ projectRootPath: root.path, citationScopeFolderPath: draft.path, sourcePath: file.path,
        markdown: `${markdown}\n\n<div ${anchorAttribute}="true"></div>`, title: "Synthetic document", subtitle: "Chapter" }, 1, null, () => {});
      const iframe = preview.pendingFrame ?? preview.previewFrame;
      if (!iframe.contentDocument?.querySelector(".pdf-page")) await new Promise((resolve) => iframe.addEventListener("load", resolve, { once: true }));
      const previewDoc = iframe.contentDocument;
      const visible = { count: previewDoc.querySelectorAll(".feuillets-csl-citation").length,
        rawFailed: input.failed.every((key) => previewDoc.body.textContent.includes(`[@${input.keys[0]}; @${key}]`)),
        rawValid: input.keys.some((key) => previewDoc.body.textContent.includes(`[@${key}]`)),
        paginated: previewDoc.querySelectorAll(".pdf-page").length > 0,
        bibliographyCount: previewDoc.querySelectorAll(".feuillets-csl-bibliography-entry").length };
      preview.scaledContainer.remove();
      const checked = results[0];
      const clusters = requests[0].clusters;
      const contract = api.validateCitationClusterResults(clusters, checked).valid;
      const rejection = [];
      const rejected = (result) => !api.validateCitationClusterResults(clusters, result).valid;
      rejection.push(rejected({ ...checked, diagnostics: [...checked.diagnostics, { code: "CSL_STYLE_ERROR", severity: "error", message: "Fatal" }] }));
      rejection.push(rejected({ ...checked, diagnostics: checked.diagnostics.filter((d) => d.severity !== "error") }));
      rejection.push(rejected({ ...checked, diagnostics: checked.diagnostics.map((d) => d.severity === "error" ? { ...d, citekey: "foreign" } : d) }));
      rejection.push(rejected({ ...checked, diagnostics: checked.diagnostics.map((d) => d.severity === "error" ? { ...d, clusterId: "foreign" } : d) }));
      rejection.push(rejected({ ...checked, citations: [...checked.citations, checked.citations[0]] }));
      const dataPassedIntact = requests.every((req) => req.style.xml === input.xml && req.bibliographies.length === 1 && req.bibliographies[0].content === input.bib);
      const errorCodes = checked.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
      const statuses = [initial.status, overridden.status];
      let multipleSources = null;
      let resourceRepair = null;
      let fatalStyle = null;
      if (input.label === "synthetic") {
        const secondFolder = new api.TFolder("Book/Second");
        const secondMarkdown = "[@second]\n\n[@crossSourceDuplicate]\n\n[@known; @crossSourceDuplicate]\n\nEnd.";
        const secondFile = new api.TFile("Book/Second/Chapter.md", secondMarkdown);
        const secondBib = new api.TFile("Book/Research/second.bib", "@book{second,title={Independent Second Source},year={2024}}@book{crossSourceDuplicate,title={Conflicting Second Source}}");
        secondFolder.parent = root; secondFile.parent = secondFolder; secondFolder.children = [secondFile];
        secondBib.parent = research; secondBib.stat = { mtime: 1, size: secondBib.content.length };
        for (const item of [secondFolder, secondFile, secondBib]) indexed.set(item.path, item);
        settings.projectMeta.Book.folderWorkspaces.Second = { citekeyBibliographyPath: "second.bib", citekeyCslPath: "alternate.csl" };
        const prepared = api.parsePandocCitationDocument("[@known]\n\n[@second]\n\n[@crossSourceDuplicate]\n\n[@known; @crossSourceDuplicate]");
        const snapshot = await host.renderPreparedDocument("integration-multiple", prepared, alternateStyle, [alternateBib, secondBib], { includeBibliography: true });
        const compositeDoc = api.buildScriveningsDocument([{ file, content: markdown }, { file: secondFile, content: secondMarkdown }]);
        const compositeBoundaries = api.StateField.define({ create: () => api.boundaryOffsets(compositeDoc), update: (value) => value });
        const compositeExtension = api.createScriveningsCitationExtension(compositeBoundaries, app, () => settings, [file, secondFile],
          { document: compositeDoc, projectRoot: root, getHost: () => host });
        const compositeParent = make("div", {}, document.body);
        const compositeView = new api.EditorView({ parent: compositeParent, state: api.EditorState.create({ doc: compositeDoc.text,
          selection: { anchor: compositeDoc.text.length }, extensions: [compositeBoundaries, compositeExtension] }) });
        for (let attempt = 0; attempt < 50 && compositeView.dom.querySelectorAll(".feuillets-csl-citation").length < input.keys.length + 2; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        multipleSources = { status: snapshot.status, citations: snapshot.result?.citations.length,
          errors: snapshot.result?.diagnostics.filter((d) => d.severity === "error").map((d) => d.code),
          bibliographyCount: snapshot.result?.bibliography?.entries.length,
          widgets: compositeView.dom.querySelectorAll(".feuillets-csl-citation").length,
          rawAmbiguous: compositeView.dom.textContent.includes("[@crossSourceDuplicate]") && compositeView.dom.textContent.includes("[@known; @crossSourceDuplicate]"),
          sourceUnchanged: compositeView.state.doc.toString() === compositeDoc.text,
          twoFilesPassed: requests.at(-1).bibliographies.length === 2 && requests.at(-1).bibliographies.some((item) => item.content === secondBib.content) };
        compositeView.destroy(); compositeParent.remove();

        alternateBib.content = [...input.keys, ...input.failed].map((key) => `@book{${key},title={Repaired ${key}},author={Example, Alice},year={2024}}`).join("\n");
        alternateBib.stat = { mtime: 2, size: alternateBib.content.length };
        host.invalidateResource(alternateBib.path);
        const repaired = await host.renderDocument("resource-proof", markdown, root, file);
        resourceRepair = { status: repaired.status, citations: repaired.result?.citations.length,
          errors: repaired.result?.diagnostics.filter((d) => d.severity === "error").length,
          newContentPassed: requests.at(-1).bibliographies[0].content === alternateBib.content,
          newVersionPassed: requests.at(-1).bibliographies[0].version !== requests[1].bibliographies[0].version };
        alternateStyle.content = "<style>";
        alternateStyle.stat = { mtime: 2, size: alternateStyle.content.length };
        host.invalidateResource(alternateStyle.path);
        const fatal = await host.renderDocument("fatal-style-proof", markdown, root, file);
        const fatalResult = results.at(-1);
        fatalStyle = { status: fatal.status, citations: fatalResult.citations.length,
          bibliographyAbsent: fatalResult.bibliography === null,
          explicitGlobalError: fatalResult.diagnostics.some((d) => d.severity === "error" && !d.clusterId),
          rejectedByContract: !api.validateCitationClusterResults(requests.at(-1).clusters, fatalResult).valid };
      }
      host.dispose(); plugin.onunload(); timers.forEach(clearInterval);
      return { registered, cacheHit, overrideResolved, invalidationRendered, dataPassedIntact, statuses, contract, rejection,
        errorCodes, continu, live, reading, staticRender, visible, bibliographyDiagnostics, multipleSources, resourceRepair, fatalStyle };
    }, scenario);
    assert.equal(state.registered, true);
    assert.deepEqual(state.statuses, ["ready", "ready"]);
    assert.equal(state.cacheHit, true);
    assert.equal(state.overrideResolved, true);
    assert.equal(state.invalidationRendered, true);
    assert.equal(state.dataPassedIntact, true);
    assert.equal(state.contract, true);
    assert.ok(state.rejection.every(Boolean));
    assert.deepEqual(state.errorCodes, scenario.expectedCodes);
    assert.equal(state.continu.count, scenario.keys.length + 1);
    assert.equal(state.continu.widgetCount, scenario.keys.length + 1);
    assert.equal(state.continu.rawFailed, true);
    assert.equal(state.continu.allNonempty, true);
    assert.deepEqual(state.continu.rawKeys, [...scenario.keys.map((key) => `[@${key}]`), `[@${scenario.keys[0]}]`]);
    assert.equal(state.continu.sourceUnchanged, true);
    assert.equal(state.live.count, scenario.keys.length + 1);
    assert.equal(state.live.rawFailed, true);
    assert.equal(state.live.sourceUnchanged, true);
    assert.equal(state.reading.count, scenario.keys.length + 1);
    assert.equal(state.reading.rawFailed, true);
    assert.equal(state.staticRender.success, true);
    assert.equal(state.staticRender.count, scenario.keys.length + 2);
    assert.equal(state.staticRender.footnoteCount, 1);
    assert.equal(state.staticRender.bibliographyCount, scenario.keys.length, JSON.stringify({ staticRender: state.staticRender, diagnostics: state.bibliographyDiagnostics }));
    assert.equal(state.staticRender.rawFailed, true);
    assert.equal(state.visible.count, scenario.keys.length + 1);
    assert.equal(state.visible.rawFailed, true);
    assert.equal(state.visible.rawValid, false);
    assert.equal(state.visible.paginated, true);
    assert.equal(state.visible.bibliographyCount, scenario.keys.length);
    if (scenario.label === "synthetic") {
      assert.deepEqual(state.multipleSources, { status: "ready", citations: 2, errors: ["DUPLICATE_CITEKEY", "DUPLICATE_CITEKEY"],
        bibliographyCount: 2, widgets: scenario.keys.length + 2, rawAmbiguous: true, sourceUnchanged: true, twoFilesPassed: true });
      assert.deepEqual(state.resourceRepair, { status: "ready", citations: scenario.keys.length + scenario.failed.length + 1,
        errors: 0, newContentPassed: true, newVersionPassed: true });
      assert.deepEqual(state.fatalStyle, { status: "engine-error", citations: 0, bibliographyAbsent: true,
        explicitGlobalError: true, rejectedByContract: true });
    }
  });
});
