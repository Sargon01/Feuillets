import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";

// Chromium supplies real DOM/layout; the Markdown renderer and CSL provider are simulated.
test("CSL notes: Preview and native PDF keep rich notes at the bottom of the first call page", { skip: !existsSync(chromium.executablePath()) }, async (t) => {
  const result = await build({
    stdin: { contents: `export { renderManuscriptHtml } from "./services/export-render.ts";
      export { applyNativeCslToStaticRender, CITATION_RENDER_CSS } from "./services/pandoc-citation-static-csl.ts";
      export { paginateManuscript, exportPdf } from "./services/export-pdf.ts";
      export { resolveExportTemplate } from "./services/export-templates-custom.ts";
      export { TFile, TFolder, MarkdownRenderer } from "obsidian";`, resolveDir: resolve("src") },
    bundle: true, write: false, format: "iife", globalName: "NotesTest",
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "obsidian-test-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const state = await page.evaluate(async () => {
    const api = window.NotesTest;
    const make = (tag, options = {}, parent) => {
      const element = document.createElement(tag);
      if (options.cls) element.className = options.cls;
      if (options.text) element.textContent = options.text;
      for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
      parent?.appendChild(element);
      if (tag === "iframe") {
        element.contentWindow.print = () => {};
        element.contentWindow.focus = () => {};
      }
      return element;
    };
    window.createEl = (tag, options) => make(tag, options);
    window.createDiv = (options) => make("div", options);
    window.createSpan = (options) => make("span", options);
    HTMLElement.prototype.createEl = function (tag, options) { return make(tag, options, this); };
    HTMLElement.prototype.createDiv = function (options) { return this.createEl("div", options); };
    HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
    HTMLElement.prototype.setCssStyles = function (styles) { Object.assign(this.style, styles); };
    HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
    HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
    HTMLElement.prototype.empty = function () { this.replaceChildren(); };
    const root = new api.TFolder("Book");
    const research = new api.TFolder("Book/Research");
    const file = new api.TFile("Book/Chapter.md", "Text[^1].\n\n[^1]: See [@doe2023].");
    const bib = new api.TFile("Book/Research/refs.bib", "Mock bibliography");
    const csl = new api.TFile("Book/Research/style.csl", "Mock style");
    root.children = [research, file];
    research.parent = root;
    file.parent = root;
    research.children = [bib, csl];
    bib.parent = research;
    csl.parent = research;
    const files = new Map([root, research, file, bib, csl].map((item) => [item.path, item]));
    const settings = { projectFolder: root.path, exportTemplate: "documentSimple", projectMeta: { Book: {
      researchFolder: research.path, researchFolderLinks: { Book: research.path }, citekeyBibliographyPath: "refs.bib", citekeyCslPath: "style.csl",
    } } };
    const app = { vault: { getAbstractFileByPath: (path) => files.get(path), cachedRead: async (source) => source.content }, metadataCache: { getFileCache: () => ({}) } };
    const requests = [];
    const host = {
      renderPreparedDocument: async (_id, parsedDocument) => {
        requests.push(parsedDocument.clusters.map((cluster) => cluster.noteIndex));
        const citations = parsedDocument.clusters.map((cluster) => ({ clusterId: cluster.id,
          plainText: "Rich source", content: [{ type: "span", style: { fontStyle: "italic" }, children: [{ type: "text", text: "Rich source" }] }] }));
        return { status: "ready", parsedDocument, citationByClusterId: new Map(citations.map((citation) => [citation.clusterId, citation])), result: { citations, bibliography: null, diagnostics: [] } };
      }, disposeDocument: () => {},
    };
    api.MarkdownRenderer.render = async (_app, _markdown, container) => {
      for (let index = 0; index < 65; index++) {
        const p = make("p", { text: `Paragraph ${index}. ` + "Prose fills the page. ".repeat(10) }, container);
        if (index === 25 || index === 55) {
          const sup = make("sup", { cls: "footnote-ref" }, p);
          make("a", { text: "1", attr: { href: "#fn1", id: `fnref${index}` } }, sup);
        }
      }
      const section = make("section", { cls: "footnotes" }, container);
      const ol = make("ol", {}, section);
      const li = make("li", { attr: { id: "fn1" } }, ol);
      const p = make("p", { text: "See [@doe2023]." }, li);
      make("a", { text: "↩", cls: "footnote-backref", attr: { href: "#fnref25" } }, p);
    };
    make("style", { text: api.CITATION_RENDER_CSS }, document.head);
    const afterVariant = (container) => api.applyNativeCslToStaticRender({ app, settings, host, projectRoot: root, container,
      sources: [{ path: file.path, text: file.content }], documentId: "notes-preview" });
    const rendered = await api.renderManuscriptHtml(app, file.content, file.path, [], null, undefined, afterVariant);
    const template = await api.resolveExportTemplate(app, settings, settings.exportTemplate);
    const preview = api.paginateManuscript(rendered.containerEl, rendered.footnotes, settings, template, "Book", "Author");
    const previewRoot = make("div", {}, document.body);
    const markup = document.createElement("template");
    markup.innerHTML = preview.pagesHtml;
    previewRoot.appendChild(markup.content.cloneNode(true));
    await api.exportPdf(app, settings, { markdown: file.content, title: "Book", author: "Author", sourcePath: file.path,
      citationSettings: { style: "csl", bibliographyPath: bib.path }, cslHost: host, projectRoot: root });
    const printed = document.querySelector("iframe").contentDocument;
    const inspect = (scope) => {
      const pages = [...scope.querySelectorAll(".pdf-page")];
      const callPages = pages.flatMap((p, index) => p.querySelector("sup.footnote-ref") ? [index] : []);
      const notePages = pages.flatMap((p, index) => p.querySelector(".pdf-page-footnotes") ? [index] : []);
      const area = scope.querySelector(".pdf-page-footnotes");
      return { pageCount: pages.length, callPages, notePages, bottom: area.style.bottom,
        rich: area.querySelector(".feuillets-csl-font-italic")?.textContent,
        noteCount: scope.querySelectorAll(".pdf-page-footnote-content").length,
        raw: (scope.textContent ?? scope.body?.textContent ?? "").includes("[@doe2023]") };
    };
    return { preview: inspect(previewRoot), pdf: inspect(printed), requests,
      cloneRich: rendered.footnotes[0].contentElement.querySelector(".feuillets-csl-font-italic")?.textContent };
  });
  for (const surface of [state.preview, state.pdf]) {
    assert.ok(surface.pageCount > 1);
    assert.equal(surface.notePages[0], surface.callPages[0]);
    assert.equal(surface.noteCount, 1);
    assert.equal(surface.bottom, "0px");
    assert.equal(surface.rich, "Rich source");
    assert.equal(surface.raw, false);
  }
  assert.equal(state.cloneRich, "Rich source");
  assert.deepEqual(state.requests, [[1], [1]]);
});
