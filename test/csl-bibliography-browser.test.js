import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";

test("CSL bibliography: browser layout, Preview pagination and native PDF retain structured numeric entries", { skip: !existsSync(chromium.executablePath()) }, async (t) => {
  const result = await build({
    stdin: {
      contents: `export { applyNativeCslToStaticRender, CITATION_RENDER_CSS } from "./services/pandoc-citation-static-csl.ts";
        export { CSL_BIBLIOGRAPHY_ANCHOR_MARKDOWN } from "./services/csl-bibliography-anchor.ts";
        export { paginateManuscript, exportPdf } from "./services/export-pdf.ts";
        export { resolveExportTemplate } from "./services/export-templates-custom.ts";
        export { TFile, TFolder, MarkdownRenderer } from "obsidian";`,
      resolveDir: resolve("src"),
    },
    bundle: true, write: false, format: "iife", globalName: "BibliographyTest",
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
    const api = window.BibliographyTest;
    const makeElement = (tag, options = {}, parent) => {
      const el = document.createElement(tag);
      if (options.cls) el.className = options.cls;
      if (options.text) el.textContent = options.text;
      parent?.appendChild(el);
      if (tag === "iframe") {
        el.contentWindow.print = () => { window.printedBibliography = el.contentDocument.body.textContent; };
        el.contentWindow.focus = () => {};
      }
      return el;
    };
    window.createEl = (tag, options) => makeElement(tag, options);
    window.createDiv = (options) => makeElement("div", options);
    window.createSpan = (options) => makeElement("span", options);
    HTMLElement.prototype.createEl = function (tag, options) { return makeElement(tag, options, this); };
    HTMLElement.prototype.createDiv = function (options) { return this.createEl("div", options); };
    HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
    HTMLElement.prototype.setCssStyles = function (styles) { Object.assign(this.style, styles); };
    HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
    HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
    HTMLElement.prototype.empty = function () { this.replaceChildren(); };
    const root = new api.TFolder("Book");
    const research = new api.TFolder("Book/Research");
    const file = new api.TFile("Book/Chapter.md", "[@doe2023] [@smith2024]");
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
      pandocCitationPreviewStyle: "csl", researchFolder: research.path,
      researchFolderLinks: { Book: research.path }, citekeyBibliographyPath: "refs.bib", citekeyCslPath: "style.csl",
    } } };
    const app = { vault: { getAbstractFileByPath: (path) => files.get(path), cachedRead: async (source) => source.content }, metadataCache: { getFileCache: () => ({}) } };
    const calls = [];
    const host = {
      renderPreparedDocument: async (documentId, parsedDocument, _style, _bibs, options) => {
        calls.push(options);
        const citations = parsedDocument.clusters.map((cluster, index) => ({ clusterId: cluster.id, plainText: `[${index + 1}]`, content: [{ type: "text", text: `[${index + 1}]` }] }));
        const bibliography = { layout: { hangingIndent: true, entrySpacing: 2, lineSpacing: 1.5, secondFieldAlign: "flush", maxOffset: 4 }, entries: parsedDocument.clusters.map((_cluster, index) => index + 1).map((number) => ({ itemIds: [String(number)], plainText: "Unused", content: [
          { type: "block", display: "left-margin", children: [{ type: "text", text: `[${number}]` }] },
          { type: "block", display: "right-inline", children: [{ type: "span", style: { fontStyle: "italic" }, children: [{ type: "text", text: `Structured reference ${number}` }] }] },
        ] })) };
        return { status: "ready", parsedDocument, citationByClusterId: new Map(citations.map((citation) => [citation.clusterId, citation])), result: { documentId, citations, bibliography, diagnostics: [] } };
      },
      disposeDocument: () => {},
    };
    // The renderer is deliberately simulated; Chromium supplies the real DOM and layout.
    api.MarkdownRenderer.render = async (_app, _markdown, container) => {
      container.appendChild(makeElement("p", { text: file.content }));
      const template = document.createElement("template");
      template.innerHTML = api.CSL_BIBLIOGRAPHY_ANCHOR_MARKDOWN;
      container.appendChild(template.content.cloneNode(true));
    };
    const container = makeElement("div");
    await api.MarkdownRenderer.render(app, "", container);
    document.body.appendChild(container);
    const style = makeElement("style", { text: api.CITATION_RENDER_CSS });
    document.head.appendChild(style);
    const applied = await api.applyNativeCslToStaticRender({ app, settings, host, projectRoot: root, container, sources: [{ path: file.path, text: file.content }], documentId: "browser-preview" });
    const entries = [...container.querySelectorAll(".feuillets-csl-bibliography-entry")];
    const rectangles = entries.map((entry) => {
      const left = entry.querySelector(".feuillets-csl-left-margin").getBoundingClientRect();
      const right = entry.querySelector(".feuillets-csl-right-inline").getBoundingClientRect();
      return { left: left.x, right: right.x, labelEnd: left.right, lineHeight: getComputedStyle(entry).lineHeight, spacing: getComputedStyle(entry).marginBottom };
    });
    const bodyStart = container.getBoundingClientRect().x;
    entries[0].setAttribute("data-csl-second-field-align", "margin");
    const marginStart = entries[0].querySelector(".feuillets-csl-right-inline").getBoundingClientRect().x;
    const marginLabel = entries[0].querySelector(".feuillets-csl-left-margin").getBoundingClientRect().x;
    entries[0].setAttribute("data-csl-second-field-align", "flush");
    const template = await api.resolveExportTemplate(app, settings, settings.exportTemplate);
    const pages = api.paginateManuscript(container, [], settings, template, "Book", "Author");
    file.content = Array.from({ length: 45 }, (_, index) => `[@ref${index + 1}]`).join(" ");
    await api.exportPdf(app, settings, { markdown: file.content + "\n\n" + api.CSL_BIBLIOGRAPHY_ANCHOR_MARKDOWN, title: "Book", author: "Author", sourcePath: file.path, citationSettings: { style: "csl", bibliographyPath: bib.path }, cslHost: host, projectRoot: root });
    const printed = document.querySelector("iframe").contentDocument;
    return { applied, rectangles, bodyStart, marginStart, marginLabel, pagesHtml: pages.pagesHtml, printed: window.printedBibliography, calls,
      printedPages: printed.querySelectorAll(".pdf-page").length,
      printedEntries: printed.querySelectorAll(".feuillets-csl-bibliography-entry").length,
      oversized: printed.querySelectorAll('[data-pagination-oversized="true"]').length,
    };
  });
  assert.equal(state.applied, true);
  assert.equal(state.rectangles.length, 2);
  assert.equal(state.rectangles[0].right, state.rectangles[1].right);
  assert.ok(state.rectangles.every((rect) => rect.right > rect.labelEnd));
  assert.equal(state.rectangles[0].lineHeight, "24px");
  assert.equal(state.rectangles[0].spacing, "48px");
  assert.equal(state.marginStart, state.bodyStart);
  assert.ok(state.marginLabel < state.bodyStart);
  assert.match(state.pagesHtml, /feuillets-csl-bibliography-entry/);
  assert.match(state.pagesHtml, /Structured reference 1/);
  assert.match(state.printed, /Structured reference 1/);
  assert.match(state.printed, /Structured reference 2/);
  assert.match(state.printed, /Structured reference 45/);
  assert.ok(state.printedPages > 1);
  assert.equal(state.printedEntries, 45);
  assert.equal(state.oversized, 0);
  assert.deepEqual(state.calls, [{ includeBibliography: true }, { includeBibliography: true }]);
});
