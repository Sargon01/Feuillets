import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import JSZip from "jszip";

test("paragraph layout: measured fragments, source markers, paged notes and native exports", async (t) => {
  const bundle = await build({
    stdin: { contents: `export { injectDocumentLayoutMarkers, applyDocumentLayoutMarkers, DOCUMENT_LAYOUT_EXPORT_CSS } from "./services/document-layout.ts";
      export { createSourceAnchor } from "./services/source-anchor.ts";
      export { renderManuscriptHtml } from "./services/export-render.ts";
      export { paginateDom } from "./services/pagination-engine.ts";
      export { paginateManuscript, paginateManuscriptCooperatively, exportPdf } from "./services/export-pdf.ts";
      export { exportEpub } from "./services/export-epub.ts";
      export { exportOdt } from "./services/export-odt.ts";
      export { resolveExportTemplate } from "./services/export-templates-custom.ts";
      export { markManuscript, applySourceMarkers, applyBlockSourceMarkers } from "./views/preview-source-map.ts";
      export { MarkdownRenderer } from "obsidian";`, resolveDir: resolve("src") },
    bundle: true, write: false, format: "iife", globalName: "ParagraphTest",
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "obsidian-test-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const api = window.ParagraphTest;
    const make = (tag, options = {}, parent) => {
      const element = document.createElement(tag);
      if (options.cls) element.className = options.cls;
      if (options.text) element.textContent = options.text;
      parent?.appendChild(element);
      if (tag === "iframe") {
        element.contentWindow.focus = () => {};
        element.contentWindow.print = () => { window.paragraphPrintHtml = element.contentDocument.documentElement.outerHTML; };
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
    // Simulate the host renderer; Chromium supplies real DOM, text ranges,
    // computed typography and page measurements for every assertion below.
    api.MarkdownRenderer.render = async (_app, markdown, container) => {
      for (const chunk of markdown.split(/\n\n/u)) {
        if (!chunk.trim()) continue;
        if (chunk.startsWith("[^1]:")) {
          const section = make("section", { cls: "footnotes" }, container);
          const ol = make("ol", {}, section);
          const li = make("li", {}, ol); li.id = "fn-1";
          make("p", { text: chunk.slice(5).trim() }, li);
        } else {
          const p = make("p", {}, container);
          const [before, after] = chunk.split("[^1]");
          p.appendChild(document.createTextNode(before));
          if (after !== undefined) { const sup = make("sup", { cls: "footnote-ref" }, p); const ref = make("a", { text: "1" }, sup); ref.href = "#fn-1"; p.appendChild(document.createTextNode(after)); }
        }
      }
    };
    const centred = `Centred paragraph ${"with enough ordinary words to cross several pages. ".repeat(32)}`;
    const justified = `Justified paragraph.[^1] ${"whose ordinary words must fill the last line of every continued fragment. ".repeat(30)}`;
    const markdown = `Neighbour paragraph.\n\n${centred}\n\n${justified}\n\nFinal paragraph.[^1]\n\n[^1]: A paged footnote that must remain visible.`;
    const anchor = (quote) => { const start = markdown.indexOf(quote); return api.createSourceAnchor(markdown, start, start + quote.length); };
    const overrides = [
      { id: "c", file: "Chapter.md", kind: "paragraph-layout", anchor: anchor(centred), alignment: "center", firstLineIndentPt: 0, spacingBeforePt: 6, spacingAfterPt: 12 },
      { id: "j", file: "Chapter.md", kind: "paragraph-layout", anchor: anchor(justified), alignment: "justify", firstLineIndentPt: 18, spacingBeforePt: 0, spacingAfterPt: 6 },
      { id: "b", file: "Chapter.md", kind: "page-break-before", anchor: anchor(centred) },
    ];
    const app = { vault: { getAbstractFileByPath: () => null }, metadataCache: { getFileCache: () => ({}) } };
    const settings = { exportTemplate: "documentSimple", epubLanguage: "en" };
    const virtual = api.injectDocumentLayoutMarkers(markdown, overrides);
    const rendered = await api.renderManuscriptHtml(app, markdown, "Project/Chapter.md", overrides);
    const beforeHtml = rendered.containerEl.innerHTML;
    const paragraphCount = rendered.containerEl.children.length;
    const css = `p { margin: 8pt 0; text-indent: 12pt; }` + api.DOCUMENT_LAYOUT_EXPORT_CSS;
    const inspect = (globalAlignment) => {
      const measured = [];
      const geometry = { widthPx: 290, heightPx: 180, fontFamily: "Arial", fontSizePt: 12, lineHeight: 1.5, textAlign: globalAlignment, hyphens: false, css,
        reservedBottomAreaProvider: (nodes) => {
          for (const p of nodes.filter((node) => node.className.includes("feuillets-paragraph-alignment-"))) {
            const style = getComputedStyle(p);
            measured.push({ classes: p.className, align: style.textAlign, last: style.textAlignLast, hyphens: style.hyphens });
          }
          return null;
        },
      };
      const pages = api.paginateDom(Array.from(rendered.containerEl.children), geometry);
      const fragments = pages.flatMap((page) => page.bodyNodes).map((p) => ({ text: p.textContent, classes: p.className, align: p.style.textAlign, last: p.style.textAlignLast, indent: p.style.textIndent, before: p.style.marginTop }));
      return { pages: pages.length, fragments, measured, text: fragments.map((fragment) => fragment.text).join("") };
    };
    const left = inspect("left");
    const justify = inspect("justify");
    const sourceSegments = [{ path: "Project/Chapter.md", text: virtual }];
    const sourceBlocks = new Map([["Project/Chapter.md", { leadingSkip: 0, sections: [0, 2, 4, 6].map((line) => ({ start: { line, col: 0 }, end: { line, col: 20 } })) }]]);
    const sourceRendered = await api.renderManuscriptHtml(app, api.markManuscript(sourceSegments, "\n\n"), "Project/Chapter.md", [], null, (container) => api.applyBlockSourceMarkers(container, sourceBlocks), (container) => api.applySourceMarkers(container));
    const tpl = await api.resolveExportTemplate(app, settings, settings.exportTemplate);
    const preview = await api.paginateManuscriptCooperatively(sourceRendered.containerEl, sourceRendered.footnotes, settings, tpl, "Book", "", { hyphenationOverride: false });
    const pdf = api.paginateManuscript(sourceRendered.containerEl, sourceRendered.footnotes, settings, tpl, "Book", "", { hyphenationOverride: false });
    const input = { markdown, title: "Book", author: "", sourcePath: "Project/Chapter.md", segments: [{ path: "Project/Chapter.md", text: markdown, renderText: virtual }] };
    const epub = await api.exportEpub(app, settings, input);
    const odt = await api.exportOdt(app, settings, input);
    await api.exportPdf(app, settings, input);
    return {
      paragraphCount, beforeHtml, afterHtml: rendered.containerEl.innerHTML,
      expectedText: rendered.containerEl.textContent, markdown, virtual,
      left, justify, preview, pdf, printHtml: window.paragraphPrintHtml,
      epub: Array.from(epub), odt: Array.from(odt), sourceHtml: sourceRendered.containerEl.innerHTML,
    };
  });
  assert.equal(result.paragraphCount, 4, "technical marker blocks are removed before measuring");
  assert.equal(result.beforeHtml, result.afterHtml, "pagination only composes clones");
  assert.doesNotMatch(result.beforeHtml, /FEUILLETS_LAYOUT_/);
  for (const run of [result.left, result.justify]) {
    assert.ok(run.pages > 4);
    assert.equal(run.text, result.expectedText);
    const centred = run.fragments.filter((p) => p.classes.includes("feuillets-paragraph-alignment-center"));
    const justified = run.fragments.filter((p) => p.classes.includes("feuillets-paragraph-alignment-justify"));
    assert.ok(centred.length > 1 && justified.length > 1);
    for (const p of centred) { assert.equal(p.align, "center"); assert.equal(p.last, ""); }
    for (const p of justified.filter((p) => p.classes.includes("feuillets-pagination-fragment-continues"))) assert.equal(p.last, "justify");
    for (const p of [...centred, ...justified].filter((p) => p.classes.includes("feuillets-pagination-fragment-continuation"))) { assert.equal(p.indent, "0px"); assert.equal(p.before, "0px"); }
    assert.ok(run.measured.length > 0);
    for (const p of run.measured) {
      assert.equal(p.hyphens, "none");
      if (p.classes.includes("feuillets-paragraph-alignment-center")) { assert.equal(p.align, "center"); assert.notEqual(p.last, "justify"); }
      else { assert.equal(p.align, "justify"); if (p.classes.includes("feuillets-pagination-fragment-continues")) assert.equal(p.last, "justify"); }
    }
  }
  assert.deepEqual(result.preview, result.pdf, "Preview and PDF share exact pagination with the same policy");
  assert.match(result.sourceHtml, /data-source-path="Project\/Chapter.md"/);
  assert.match(result.preview.pagesHtml, /data-source-path="Project\/Chapter.md"/);
  assert.match(result.preview.pagesHtml, /data-source-block-path="Project\/Chapter.md"/);
  assert.match(result.preview.pagesHtml, /data-source-start-line="2"/);
  assert.match(result.preview.pagesHtml, /data-source-start-line="4"/);
  assert.match(result.preview.pagesHtml, /A paged footnote/);
  assert.doesNotMatch(result.preview.pagesHtml, /FEUILLETS_LAYOUT_|FEUILLETS-SRC:/);
  assert.match(result.printHtml, /feuillets-paragraph-alignment-center/);
  assert.match(result.printHtml, /A paged footnote/);
  assert.doesNotMatch(result.printHtml, /FEUILLETS_LAYOUT_/);
  const epubZip = await JSZip.loadAsync(Uint8Array.from(result.epub));
  const xhtml = await epubZip.file("OEBPS/chapitres.xhtml").async("string");
  for (const value of ["feuillets-paragraph-alignment-center", "text-align: center", "text-indent: 0pt", "margin-top: 6pt", "margin-bottom: 12pt", "A paged footnote"]) assert.ok(xhtml.includes(value), value);
  assert.doesNotMatch(xhtml, /FEUILLETS_LAYOUT_/);
  const odtZip = await JSZip.loadAsync(Uint8Array.from(result.odt));
  const content = await odtZip.file("content.xml").async("string");
  for (const value of ['style:parent-style-name="Standard"', 'fo:text-align="center"', 'fo:text-indent="0pt"', 'fo:margin-top="6pt"', 'fo:margin-bottom="12pt"', 'fo:break-before="page"', 'fo:text-align="justify"', 'fo:text-indent="18pt"', 'text:note-class="footnote"']) assert.ok(content.includes(value), value);
  assert.match(content, /text:style-name="Standard">Neighbour paragraph\./);
  assert.equal((content.match(/text:note-class="footnote"/g) || []).length, 1);
  assert.doesNotMatch(content, /FEUILLETS_LAYOUT_/);
});
