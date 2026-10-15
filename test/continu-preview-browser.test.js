import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Continu and Preview follow the active reader", async (t) => {
  const bundle = await build({
    stdin: { contents: `export { default as FeuilletsPlugin } from "./src/main.ts";
      export { PreviewView } from "./src/views/preview-view.ts";
      export { ScriveningsView } from "./src/views/scrivenings-view.ts";
      export { frenchTypography } from "./src/utils/core.ts";
      export { computeScriveningsWordCounts } from "./src/utils/scrivenings-stats.ts";
      export { buildScriveningsDocument } from "./src/services/scrivenings-document.ts";
      export { EditorState } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export { createEditorCursorTrackingExtension } from "./src/services/editor-cursor-tracking.ts";
      export { editorInfoField } from "obsidian";
      export { LayoutEditor } from "./src/ui/layout-editor.ts";
      export { DEFAULT_SETTINGS } from "./src/default-settings.ts";
      export { createFakeVault } from "./test/helpers/fake-vault.ts";
      export { createSelectionScope, createFileScope, createFolderScope } from "./src/services/compile-scope.ts";
      export { resolveExportTemplateV2 } from "./src/services/export-templates-custom.ts";
      export { MarkdownRenderer, TFolder } from "obsidian";`, resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", globalName: "ReadingTest",
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "obsidian-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
      builder.onLoad({ filter: /obsidian-runtime-stub\.mjs$/ }, ({ path }) => ({
        contents: 'import { StateField } from "@codemirror/state";\n' + readFileSync(path, "utf8")
          .replace('export const editorInfoField = { __brand: "editorInfoField" };', 'export const editorInfoField = StateField.define({ create: () => ({ file: null }), update: (value) => value });'),
        loader: "js",
      }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  async function open(context, sync = false, mounted = false) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    context.after(async () => {
      await page.evaluate(async () => { await window.reading?.view.onClose(); window.reading?.markdown?.destroy(); if (window.reading?.mounted) window.reading.continu.destroyEditor(); else window.reading?.cm?.destroy(); });
      await page.close();
      assert.deepEqual(errors, []);
    });
    await page.addStyleTag({ content: readFileSync("styles.css", "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async ({ sync, mounted }) => {
      const api = window.ReadingTest;
      document.documentElement.style.setProperty("--background-modifier-hover", "rgba(0, 0, 0, 0.08)");
      document.documentElement.style.setProperty("--text-muted", "#666");
      const make = (tag, options = {}, parent) => {
        const el = document.createElement(tag);
        if (options.cls) el.className = options.cls;
        if (options.text) el.textContent = options.text;
        if (options.type) el.type = options.type;
        if (options.value !== undefined) el.value = options.value;
        for (const [name, value] of Object.entries(options.attr || {})) el.setAttribute(name, value);
        parent?.appendChild(el);
        return el;
      };
      window.createEl = make;
      window.createDiv = (options) => make("div", options);
      window.createSpan = (options) => make("span", options);
      HTMLElement.prototype.createEl = function (tag, options) { return make(tag, options, this); };
      HTMLElement.prototype.createDiv = function (options) { return this.createEl("div", options); };
      HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
      HTMLElement.prototype.empty = function () { this.replaceChildren(); };
      HTMLElement.prototype.setText = function (text) { this.textContent = text; return this; };
      HTMLElement.prototype.setAttr = function (name, value) { this.setAttribute(name, value); };
      HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names.flatMap((name) => name.split(" "))); };
      HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
      HTMLElement.prototype.toggleClass = function (name, on) { this.classList.toggle(name, on); };
      HTMLElement.prototype.hasClass = function (name) { return this.classList.contains(name); };
      HTMLElement.prototype.setCssStyles = function (styles) { Object.assign(this.style, styles); };
      HTMLElement.prototype.isShown = function () { return !this.hidden; };
      api.MarkdownRenderer.render = async (_app, markdown, container) => {
        for (const paragraph of markdown.split(/\n\n/u)) {
          if (paragraph.trim()) container.createEl("p", { text: paragraph });
        }
      };
      const root = new api.TFolder("Project/Manuscrit");
      const { vault, fileManager } = api.createFakeVault([root]);
      vault.cachedRead = vault.read;
      const files = [];
      const metadata = new Map();
      for (let index = 0; index < 9; index++) {
        const paragraphs = Array.from({ length: 6 }, (_, line) => `File ${index}, paragraph ${line}. ${"This is a stable reading passage with ordinary words. ".repeat(12)}`);
        const file = await vault.create(`${root.path}/Scene ${index}.md`, paragraphs.join("\n\n"));
        files.push(file);
        metadata.set(file.path, { frontmatter: { compile: true, role: "scene" }, sections: paragraphs.map((paragraph, line) => ({ type: "paragraph", position: { start: { line: line * 2, col: 0 }, end: { line: line * 2, col: paragraph.length } } })) });
      }
      fileManager.processFrontMatter = async (file, update) => {
        const data = { ...(metadata.get(file.path)?.frontmatter || {}) };
        update(data);
        metadata.set(file.path, { frontmatter: data });
      };
      const sourceHost = make("div", {}, document.body);
      const source = make("div", { cls: "cm-scroller" }, sourceHost);
      source.style.height = "250px";
      source.style.overflow = "auto";
      const sourceBody = make("div", {}, source);
      sourceBody.style.height = "4000px";
      let active = files[0];
      const listeners = new Map();
      const emit = (name) => { for (const callback of listeners.get(name) || []) callback(); };
      const opened = [];
      const previews = [];
      const sourceLeaf = {
        view: { file: active, contentEl: sourceHost },
        openFile: async (file) => {
          opened.push(file.path);
          active = file;
          sourceLeaf.view.file = file;
          source.scrollTop = 0;
          emit("file-open");
        },
      };
      const app = { vault, fileManager, metadataCache: { getFileCache: (file) => metadata.get(file.path) || {} }, workspace: {
        on: (name, callback) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); return { name, callback }; },
        getActiveFile: () => active,
        getActiveViewOfType: (Type) => Type === api.PreviewView ? (window.reading?.activePreview || null) : sourceLeaf.view,
        getLeavesOfType: (type) => type === "markdown" ? [sourceLeaf] : type === "feuillets-manuscript-preview" ? previews : [],
        getLeaf: () => sourceLeaf,
        setActiveLeaf: () => {},
      } };
      const settings = structuredClone(api.DEFAULT_SETTINGS);
      Object.assign(settings, { projectFolder: root.path, projects: [root.path], previewMode: mounted ? "chapter" : "manuscript", exportTemplate: "classique", insertFolderTitles: false, insertTitles: false, insertSceneTitles: false });
      const plugin = Object.assign(Object.create(api.FeuilletsPlugin.prototype), {
        _editorCursorListeners: new Set(),
        app, settings, getProjectFolder: () => root, saveSettings: async () => {}, getLeafForOpeningFile: () => sourceLeaf,
        getCentralContinuView: () => window.reading?.view.explicitContinuSource ? window.reading.continu : null,
        getAnalysisProvider: () => null,
        notifyReferenceContextChanged: () => {},
        isValidEditorialRootPath: (path) => path === root.path,
        registerEvent: () => {},
        addStatusBarItem: () => {
          const bar = make("div", { cls: "status-bar" }, document.body);
          Object.assign(bar.style, { position: "fixed", bottom: "0px", right: "0px", height: "24px" });
          return make("div", {}, bar);
        },
      });
      plugin.registerStatusBar();
      const contentEl = make("div", {}, document.body);
      contentEl.style.height = "500px";
      contentEl.style.width = "900px";
      const leaf = { app, contentEl };
      const view = new api.PreviewView(leaf, plugin);
      leaf.view = view;
      previews.push(leaf);
      view._compileScope = api.createSelectionScope(root.path, files.map((file) => file.path));
      view.zoomMode = "manual";
      view.zoomScale = 0.7;
      if (sync) view.synchronizedFeuilletPath = files[0].path;
      const frames = [];
      const load = view.onFrameLoad.bind(view);
      view.onFrameLoad = (...args) => {
        load(...args);
        frames.push({ frame: args[1], position: view.previewViewport.scrollTop });
      };
      const settle = () => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      window.reading = { api, view, app, plugin, root, files, source, sourceLeaf, opened, frames, settle, previews, emit, metadata };
      await view.onOpen();
    }, { sync, mounted });
    await page.waitForFunction(() => window.reading.frames.length > 0 && !window.reading.view.refreshInFlight);
    await page.evaluate(() => window.reading.settle());
    await page.evaluate(async (mounted) => {
      const f = window.reading;
      f.mounted = mounted;
      const host = document.body.createDiv();
      const entries = await Promise.all(f.files.map(async (file) => ({ file, content: await f.app.vault.cachedRead(file) })));
      f.document = f.api.buildScriveningsDocument(entries);
      f.continu = new f.api.ScriveningsView({ app: f.app, contentEl: host }, f.plugin);
      f.continu.session.load(f.document);
      f.continu.wordCounts = f.api.computeScriveningsWordCounts(f.document);
      f.continu._compileScope = f.view.compileScope;
      if (mounted) {
        f.continu.mountEditor();
        f.cm = f.continu.editorView;
        f.cm.dom.style.height = "360px";
        f.cm.dom.style.width = "540px";
        f.cm.scrollDOM.style.overflow = "auto";
      } else f.cm = new f.api.EditorView({ parent: host, state: f.api.EditorState.create({ doc: f.document.text, extensions: [
        ...(typeof f.continu.handleFocusScroll === "function" ? [f.api.EditorView.scrollHandler.of((_view, range) => f.continu.handleFocusScroll(range.head))] : []),
        f.api.EditorView.lineWrapping,
        f.api.EditorView.theme({ "&": { height: "360px", width: "540px" }, ".cm-scroller": { overflow: "auto", fontFamily: "serif", fontSize: "14px", lineHeight: "1.4" } }),
      ] }) });
      f.continu.cm = f.cm;
      f.sourceScrolls = [];
      f.cm.scrollDOM.addEventListener("scroll", () => f.sourceScrolls.push({ top: f.cm.scrollDOM.scrollTop, protected: f.view.syncingFromPreview, preview: f.view.previewViewport.scrollTop }));
      f.position = (index, line) => {
        const segment = f.document.segments[index];
        return segment.from + segment.body.split("\n").slice(0, line).reduce((length, text) => length + text.length + 1, 0);
      };
      f.paragraph = (index, line = 4) => [...f.view.previewFrame.contentDocument.querySelectorAll("[data-source-block-path]")]
        .find((block) => block.getAttribute("data-source-block-path") === f.files[index].path && Number(block.getAttribute("data-source-start-line")) === line);
      f.offset = (index, line = 4) => f.paragraph(index, line).getBoundingClientRect().top + f.view.frameTopWithinScroll() - f.view.previewViewport.scrollTop;
      f.read = async (index, line = 4) => { f.view.previewViewport.scrollTop += f.offset(index, line) + 20; await f.settle(); };
      f.idle = async () => { for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame); };
      f.cmRead = async (index, line = 4, fraction = 0.2) => {
        const pos = f.position(index, line);
        f.cm.dispatch({ effects: f.api.EditorView.scrollIntoView(pos, { y: "start", yMargin: 80 }) });
        await f.idle();
        const top = f.cm.documentTop + f.cm.lineBlockAt(pos).top - f.cm.scrollDOM.getBoundingClientRect().top;
        f.cm.scrollDOM.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 1 }));
        f.cm.scrollDOM.scrollTop += top - fraction * f.cm.scrollDOM.clientHeight;
        await f.idle();
      };
      f.prepare = async (index, visible = true, line = 4) => {
        f.view.setContinuSource(null);
        if (visible) await f.cmRead(index, line);
        else { f.cm.scrollDOM.scrollTop = 0; await f.idle(); }
        await f.read(index, line);
        f.view.setContinuSource(f.continu);
        await f.settle();
      };
      f.click = async (index, line = 4) => {
        f.paragraph(index, line).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
        await f.idle();
      };
      await f.idle();
    }, mounted);
    return page;
  }

  async function refresh(page) {
    const count = await page.evaluate(async () => {
      const f = window.reading;
      const count = f.frames.length;
      await f.view.refreshPreview();
      return count;
    });
    await page.waitForFunction((count) => window.reading.frames.length > count && !window.reading.view.refreshInFlight, count);
    await page.evaluate(() => window.reading.settle());
  }


  async function openNative(context, linked) {
    const page = await open(context, false, true);
    await page.evaluate(async (linked) => {
      const f = window.reading;
      f.view.setContinuSource(null);
      f.source.parentElement.style.display = "none";
      Object.assign(f.continu.contentEl.style, { position: "fixed", left: "0px", top: "0px", width: "540px", height: "600px" });
      Object.assign(f.view.contentEl.style, { position: "fixed", left: "560px", top: "0px", width: "600px", height: "600px" });
      f.cm.dispatch({ effects: f.api.EditorView.scrollIntoView(f.position(4, 4), { y: "start", yMargin: 80 }) });
      await f.idle();
      if (linked) { f.view.explicitContinuSource = f.continu; f.view.bindSourcePane(); }
      await f.idle();
      f.nativeWheelTops = [];
      f.cm.scrollDOM.addEventListener("wheel", () => f.nativeWheelTops.push(f.cm.scrollDOM.scrollTop), { capture: true });
    }, linked);
    return page;
  }

  await t.test("Native Markdown cursor changes move only the Preview marker", async (context) => {
    const page = await openNative(context, false);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      await f.sourceLeaf.openFile(f.files[4]);
      const host = document.body.createDiv();
      Object.assign(host.style, { position: "fixed", left: "0px", top: "0px" });
      const text = await f.app.vault.read(f.files[4]);
      f.markdown = new f.api.EditorView({ parent: host, state: f.api.EditorState.create({ doc: text, extensions: [
        f.api.EditorView.lineWrapping,
        f.api.EditorView.theme({ "&": { height: "360px", width: "540px" }, ".cm-scroller": { overflow: "auto" } }),
        f.api.editorInfoField.init(() => ({ file: f.files[4] })),
        f.api.createEditorCursorTrackingExtension((change) => f.plugin.notifyEditorCursorChanged(change)),
      ] }) });
      f.sourceLeaf.view.contentEl = host;
      f.sourceLeaf.view.editor = { getValue: () => f.markdown.state.doc.toString() };
      f.view.bindSourcePane();
      f.cursorSignals = [];
      f.plugin.registerEditorCursorListener((change) => f.cursorSignals.push(change));
      await f.idle();
      f.markdown.dispatch({ effects: f.api.EditorView.scrollIntoView(f.markdown.state.doc.line(5).from, { y: "start", yMargin: 20 }) });
      await f.idle();
      await f.read(4);
      return { source: f.markdown.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop,
        pages: f.view.previewFrame.contentDocument.querySelectorAll(".pdf-page").length };
    });
    const selected = await page.evaluate(async () => {
      const f = window.reading;
      const offset = f.markdown.state.doc.line(5).from + 50;
      f.markdown.dispatch({ selection: { anchor: offset } });
      f.markdown.focus();
      await f.idle();
      return { marker: { ...f.view.previewFrame.contentDocument.querySelector(".feuillets-preview-caret-marker")?.dataset },
        source: f.markdown.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop };
    });
    assert.equal(Number(selected.marker.line), 4);
    assert.equal(Number(selected.marker.ch), 50);
    assert.equal(selected.marker.precision, "line");
    assert.equal(selected.source, before.source);
    assert.equal(selected.preview, before.preview);
    await page.keyboard.press("ArrowRight");
    const after = await page.evaluate(async () => {
      const f = window.reading;
      await f.idle();
      const marker = f.view.previewFrame.contentDocument.querySelector(".feuillets-preview-caret-marker");
      return { marker: { ...marker?.dataset }, source: f.markdown.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop,
        pages: f.view.previewFrame.contentDocument.querySelectorAll(".pdf-page").length, signals: f.cursorSignals.length };
    });
    assert.equal(Number(after.marker.ch), 51);
    assert.equal(after.source, before.source);
    assert.equal(after.preview, before.preview);
    assert.equal(after.pages, before.pages);
    assert.equal(after.signals, 2);
  });

  await t.test("A native Continu mouse click marks the matching Preview text without highlighting or scrolling", async (context) => {
    const page = await openNative(context, true);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(f.continu);
      f.cm.dispatch({ selection: { anchor: f.position(4, 4) } });
      await f.idle();
      const rect = f.cm.coordsAtPos(f.position(4, 4) + 60);
      return { source: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop, x: rect.left + 1, y: rect.top + 2 };
    });
    await page.mouse.click(before.x, before.y);
    await page.evaluate(() => window.reading.idle());
    const after = await page.evaluate(() => {
      const f = window.reading;
      const marker = f.view.previewFrame.contentDocument.querySelector(".feuillets-preview-caret-marker");
      const active = f.cm.dom.querySelector(".cm-activeLine");
      return { source: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop, active: !!active,
        activeText: f.cm.state.doc.lineAt(f.cm.state.selection.main.head).text, cursor: { line: 4, ch: f.cm.state.selection.main.head - f.position(4, 4) }, marker: marker ? { ...marker.dataset } : null };
    });
    assert.equal(after.active, false);
    assert.ok(after.activeText.includes("File 4, paragraph 2"));
    assert.equal(after.marker?.precision, "line");
    assert.equal(Number(after.marker.line), after.cursor.line);
    assert.equal(Number(after.marker.ch), after.cursor.ch);
    assert.equal(after.source, before.source);
    assert.equal(after.preview, before.preview);
  });

  await t.test("Native keyboard movement updates the Preview line marker and preserves both viewports", async (context) => {
    const page = await openNative(context, true);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(f.continu);
      f.cm.dispatch({ selection: { anchor: f.position(4, 4) + 60 } });
      f.cm.focus();
      await f.idle();
      const doc = f.view.previewFrame.contentDocument;
      return { source: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop, ch: f.cm.state.selection.main.head - f.position(4, 4),
        height: f.view.naturalPagesHeight, pages: doc.querySelectorAll(".pdf-page").length };
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const after = await page.evaluate(async () => {
      const f = window.reading;
      await f.idle();
      const doc = f.view.previewFrame.contentDocument;
      const marker = doc.querySelector(".feuillets-preview-caret-marker");
      const block = f.paragraph(4);
      const style = doc.defaultView.getComputedStyle(block);
      return { source: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop, marker: marker ? { ...marker.dataset } : null,
        height: f.view.naturalPagesHeight, pages: doc.querySelectorAll(".pdf-page").length, outline: style.outlineStyle, background: style.backgroundColor };
    });
    assert.equal(Number(after.marker?.ch), before.ch + 2);
    assert.equal(after.source, before.source);
    assert.equal(after.preview, before.preview);
    assert.equal(after.pages, before.pages);
    assert.equal(after.height, before.height);
    assert.equal(after.outline, "none");
    assert.equal(after.background, "rgba(0, 0, 0, 0)");
  });

  await t.test("A native Preview click resolves the clicked character without highlighting or centering Continu", async (context) => {
    const page = await openNative(context, true);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(f.continu);
      f.cm.dispatch({ selection: { anchor: f.position(4, 4) } });
      await f.idle();
      const block = f.paragraph(4);
      if (typeof block.ownerDocument.caretPositionFromPoint !== "function") throw new Error("Native caretPositionFromPoint is unavailable");
      block.ownerDocument.caretRangeFromPoint = () => { throw new Error("Deprecated caret API must not be used"); };
      const range = block.ownerDocument.createRange();
      range.setStart(block.firstChild, 90);
      range.setEnd(block.firstChild, 91);
      const rect = range.getBoundingClientRect();
      const frame = f.view.previewFrame.getBoundingClientRect();
      return { x: frame.left + rect.left + 0.1, y: frame.top + rect.top + 2, source: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop,
        expected: f.position(4, 4) + 90 };
    });
    await page.mouse.click(before.x, before.y);
    const after = await page.evaluate(async () => {
      const f = window.reading;
      await f.idle();
      return { caret: f.cm.state.selection.main.head, source: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop,
        active: !!f.cm.dom.querySelector(".cm-activeLine"), marker: { ...f.view.previewFrame.contentDocument.querySelector(".feuillets-preview-caret-marker")?.dataset } };
    });
    assert.equal(after.caret, before.expected);
    assert.equal(after.active, false);
    assert.equal(Number(after.marker.ch), 90);
    assert.equal(after.source, before.source);
    assert.equal(after.preview, before.preview);
  });

  await t.test("The latest Continu caret, including a sheet change, survives a Preview refresh", async (context) => {
    const page = await openNative(context, true);
    const expected = await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(f.continu);
      for (const [file, ch] of [[4, 70], [5, 30], [6, 90]]) f.cm.dispatch({ selection: { anchor: f.position(file, 4) + ch } });
      await f.idle();
      return { path: f.files[6].path, line: 4, ch: 90 };
    });
    await refresh(page);
    const actual = await page.evaluate(async () => { await window.reading.idle(); return { ...window.reading.view.previewFrame.contentDocument.querySelector(".feuillets-preview-caret-marker")?.dataset }; });
    assert.equal(actual.path, expected.path);
    assert.equal(Number(actual.line), expected.line);
    assert.equal(Number(actual.ch), expected.ch);
  });

  await t.test("Markdown formatting preserves the verified cursor line and both viewports", async (context) => {
    const page = await openNative(context, false);
    const results = await page.evaluate(async () => {
      const f = window.reading;
      f.sourceLeaf.view.file = f.files[4];
      const host = document.body.createDiv();
      Object.assign(host.style, { position: "fixed", left: "0px", top: "0px" });
      f.markdown = new f.api.EditorView({ parent: host, state: f.api.EditorState.create({ doc: "", extensions: [
        f.api.EditorView.lineWrapping,
        f.api.EditorView.theme({ "&": { height: "360px", width: "540px" }, ".cm-scroller": { overflow: "auto" } }),
        f.api.editorInfoField.init(() => ({ file: f.files[4] })),
        f.api.createEditorCursorTrackingExtension((change) => f.plugin.notifyEditorCursorChanged(change)),
      ] }) });
      f.sourceLeaf.view.contentEl = host;
      f.sourceLeaf.view.editor = { getValue: () => f.markdown.state.doc.toString() };
      const block = f.paragraph(4, 0);
      block.setAttribute("data-source-start-line", "0");
      block.setAttribute("data-source-start-col", "0");
      block.setAttribute("data-source-end-line", "4");
      const results = [];
      for (const [name, source, html, words] of [
        ["plain", "First passage with ordinary words. A second passage follows.", "First passage with ordinary words. A second passage follows.", ["First", "second"]],
        ["italic", "Un frère chante un *nefes*. Sa voix recouvre à peine les hurlements.", "Un frère chante un <em>nefes</em>. Sa voix recouvre à peine les hurlements.", ["chante", "nefes", "hurlements"]],
        ["mixed", "*one* **two** ***three*** [four](https://example.test) and *five*.", '<em>one</em> <strong>two</strong> <em><strong>three</strong></em> <a href="https://example.test">four</a> and <em>five</em>.', ["one", "two", "three", "four", "five"]],
        ["lines", "First line with words.\nSecond line contains *italic* text.\nA final line follows.", "First line with words.\nSecond line contains <em>italic</em> text.\nA final line follows.", ["First", "italic", "final"]],
      ]) {
        f.markdown.dispatch({ changes: { from: 0, to: f.markdown.state.doc.length, insert: source } });
        block.setAttribute("data-source-text", source);
        block.innerHTML = html;
        await f.idle();
        f.view.previewViewport.scrollTop += block.getBoundingClientRect().top + f.view.frameTopWithinScroll() - f.view.previewViewport.scrollTop - 80;
        await f.idle();
        for (const word of words) {
          const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          let target;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const index = node.data.indexOf(word);
            if (index < 0) continue;
            const range = block.ownerDocument.createRange();
            range.setStart(node, index + 1);
            range.setEnd(node, index + 2);
            target = range.getBoundingClientRect();
            break;
          }
          const before = { source: f.markdown.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop };
          f.markdown.dispatch({ selection: { anchor: source.indexOf(word) + 1 } });
          await f.idle();
          const marker = block.ownerDocument.querySelector(".feuillets-preview-caret-marker");
          const rect = marker?.getBoundingClientRect();
          results.push({ name, word, precision: marker?.dataset.precision, error: Math.abs(rect.top - target.top), heightError: Math.abs(rect.height - target.height),
            before, after: { source: f.markdown.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop } });
        }
      }
      return results;
    });
    assert.equal(results.length, 13);
    for (const result of results) {
      assert.equal(result.precision, "line", `${result.name}: ${result.word}`);
      assert.ok(result.error < 1, JSON.stringify(result));
      assert.ok(result.heightError < 1, JSON.stringify(result));
      assert.deepEqual(result.after, result.before);
    }
  });

  await t.test("Transformed source text uses a distinct block fallback instead of claiming exact line mapping", async (context) => {
    const page = await openNative(context, true);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      const block = f.paragraph(4);
      block.textContent = "A transformed rendered paragraph";
      f.cm.dispatch({ selection: { anchor: f.position(4, 4) + 30 } });
      await f.idle();
      const marker = f.view.previewFrame.contentDocument.querySelector(".feuillets-preview-caret-marker");
      const bounds = block.getBoundingClientRect();
      const markerBounds = marker?.getBoundingClientRect();
      return { topError: Math.abs(markerBounds.top - bounds.top), height: markerBounds.height, precision: marker?.dataset.precision, dashed: marker?.classList.contains("is-block-fallback"), border: marker && marker.ownerDocument.defaultView.getComputedStyle(marker).borderLeftStyle };
    });
    assert.ok(result.topError < 1);
    assert.ok(result.height <= 12);
    assert.equal(result.precision, "block");
    assert.equal(result.dashed, true);
    assert.equal(result.border, "dashed");
  });

  await t.test("The native bottom status keeps statistics and reading context without a top status", async (context) => {
    const page = await openNative(context, true);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.plugin.updateStatusBar();
      const stats = f.plugin.statusStatsEl?.textContent || f.plugin.statusEl.textContent;
      await f.read(7);
      await f.idle();
      const reading = f.plugin.statusPreviewEl?.textContent || "";
      const parent = f.plugin.statusPreviewEl?.closest(".status-bar");
      const top = f.view.statusEl?.textContent || "";
      await f.read(3);
      await f.idle();
      const nextReading = f.plugin.statusPreviewEl?.textContent || "";
      f.view.setStatus("rendering");
      const rendering = f.view.status;
      f.view.setStatus("error");
      const error = f.view.status;
      f.activePreview = f.view;
      f.emit("active-leaf-change");
      f.emit("layout-change");
      await f.idle();
      const preserved = f.plugin.statusStatsEl?.textContent || f.plugin.statusEl.textContent;
      await f.view.onClose();
      f.emit("layout-change");
      return { stats, preserved, reading, nextReading, parent: !!parent, bottom: parent?.getBoundingClientRect().bottom, viewportHeight: window.innerHeight, top, rendering, error, visibleAfterClose: f.plugin.statusPreviewEl ? !f.plugin.statusPreviewEl.hidden : false, afterClose: f.plugin.statusPreviewEl?.textContent || "" };
    });
    assert.ok(result.stats.length > 0);
    assert.equal(result.preserved, result.stats);
    assert.ok(result.reading.includes("Scene 7"), result.reading);
    assert.ok(result.reading.includes("Page"), result.reading);
    assert.notEqual(result.nextReading, result.reading);
    assert.ok(result.nextReading.includes("Scene 3"), result.nextReading);
    assert.equal(result.parent, true);
    assert.equal(result.bottom, result.viewportHeight);
    assert.ok(!result.top.includes("Page"), result.top);
    assert.equal(result.top, "");
    assert.equal(result.rendering, "rendering");
    assert.equal(result.error, "error");
    assert.equal(result.visibleAfterClose, false);
    assert.equal(result.afterClose, "");
  });

  await t.test("A caret inside a paragraph split over pages marks its own rendered line", async (context) => {
    const page = await openNative(context, true);
    await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(null);
      const parts = (await f.app.vault.read(f.files[4])).split("\n\n");
      parts[2] = parts[2].repeat(8);
      await f.app.vault.modify(f.files[4], parts.join("\n\n"));
      f.metadata.get(f.files[4].path).sections[2].position.end.col = parts[2].length;
      f.continu.destroyEditor();
      f.document = f.api.buildScriveningsDocument(await Promise.all(f.files.map(async (file) => ({ file, content: await f.app.vault.read(file) }))));
      f.continu.session.load(f.document);
      f.continu.mountEditor();
      f.cm = f.continu.editorView;
      f.cm.dom.style.height = "360px";
      f.cm.dom.style.width = "540px";
    });
    await refresh(page);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      const pos = f.position(4, 4) + 3000;
      f.cm.dispatch({ selection: { anchor: pos }, effects: f.api.EditorView.scrollIntoView(pos, { y: "nearest" }) });
      await f.idle();
      f.view.setContinuSource(f.continu);
      f.plugin.notifyContinuSelectionChanged(f.continu);
      await f.idle();
      const doc = f.view.previewFrame.contentDocument;
      const fragments = [...doc.querySelectorAll(`[data-source-block-path="${f.files[4].path}"][data-source-start-line="4"]`)];
      const marker = doc.querySelector(".feuillets-preview-caret-marker");
      const rect = marker?.getBoundingClientRect();
      const index = fragments.findIndex((fragment) => { const box = fragment.getBoundingClientRect(); return rect && rect.top >= box.top && rect.bottom <= box.bottom; });
      return { fragments: fragments.length, index, marker: marker ? { ...marker.dataset } : null, source: f.cm.scrollDOM.scrollTop };
    });
    assert.ok(result.fragments > 2, JSON.stringify(result));
    assert.ok(result.index > 0, JSON.stringify(result));
    assert.equal(result.marker?.precision, "line");
    assert.equal(Number(result.marker.ch), 3000);
  });

  await t.test("Formatted text split over pages keeps the verified cursor geometry", async (context) => {
    const page = await openNative(context, true);
    await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(null);
      const parts = (await f.app.vault.read(f.files[4])).split("\n\n");
      parts[2] = (`A *nefes* begins this passage. ${parts[2]}`).repeat(8);
      f.api.MarkdownRenderer.render = async (_app, markdown, container) => {
        for (const paragraph of markdown.split(/\n\n/u)) {
          if (!paragraph.trim()) continue;
          const p = container.createEl("p");
          paragraph.split("*nefes*").forEach((part, index) => {
            if (index) p.createEl("em", { text: "nefes" });
            p.appendChild(p.ownerDocument.createTextNode(part));
          });
        }
      };
      await f.app.vault.modify(f.files[4], parts.join("\n\n"));
      f.metadata.get(f.files[4].path).sections[2].position.end.col = parts[2].length;
      f.continu.destroyEditor();
      f.document = f.api.buildScriveningsDocument(await Promise.all(f.files.map(async (file) => ({ file, content: await f.app.vault.read(file) }))));
      f.continu.session.load(f.document);
      f.continu.mountEditor();
      f.cm = f.continu.editorView;
      f.cm.dom.style.height = "360px";
      f.cm.dom.style.width = "540px";
    });
    await refresh(page);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      const pos = f.position(4, 4) + 3000;
      f.cm.dispatch({ selection: { anchor: pos }, effects: f.api.EditorView.scrollIntoView(pos, { y: "nearest" }) });
      await f.idle();
      f.view.setContinuSource(f.continu);
      f.plugin.notifyContinuSelectionChanged(f.continu);
      await f.idle();
      const doc = f.view.previewFrame.contentDocument;
      const fragments = [...doc.querySelectorAll(`[data-source-block-path="${f.files[4].path}"][data-source-start-line="4"]`)];
      const marker = doc.querySelector(".feuillets-preview-caret-marker");
      const rect = marker?.getBoundingClientRect();
      const index = fragments.findIndex((fragment) => { const box = fragment.getBoundingClientRect(); return rect && rect.top >= box.top && rect.bottom <= box.bottom; });
      const raw = fragments[0].getAttribute("data-source-text");
      let offset = raw.slice(0, 3000).replaceAll("*", "").length;
      let expected;
      for (const fragment of fragments) {
        const walker = doc.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (offset >= node.length) { offset -= node.length; continue; }
          const range = doc.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          expected = range.getBoundingClientRect();
          break;
        }
        if (expected) break;
      }
      return { error: Math.abs(rect.top - expected.top), heightError: Math.abs(rect.height - expected.height), fragments: fragments.length, index, marker: marker ? { ...marker.dataset } : null, source: f.cm.scrollDOM.scrollTop };
    });
    assert.ok(result.error < 1, JSON.stringify(result));
    assert.ok(result.heightError < 1, JSON.stringify(result));
    assert.ok(result.fragments > 2, JSON.stringify(result));
    assert.ok(result.index > 0, JSON.stringify(result));
    assert.equal(result.marker?.precision, "line");
    assert.equal(Number(result.marker.ch), 3000);
  });

  await t.test("French typography through compilation preserves paginated caret mapping in both directions", async (context) => {
    const page = await openNative(context, true);
    await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(null);
      const parts = (await f.app.vault.read(f.files[4])).split("\n\n");
      f.plugin.settings.exportFrenchTypography = true;
      parts[2] = (`D'abord: "Un *nefes*..." puis d'autres voix! ${parts[2]}`).repeat(8);
      f.api.MarkdownRenderer.render = async (_app, markdown, container) => {
        for (const paragraph of markdown.split(/\n\n/u)) {
          if (!paragraph.trim()) continue;
          const p = container.createEl("p");
          paragraph.split("*nefes*").forEach((part, index) => {
            if (index) p.createEl("em", { text: "nefes" });
            p.appendChild(p.ownerDocument.createTextNode(part));
          });
        }
      };
      await f.app.vault.modify(f.files[4], parts.join("\n\n"));
      f.metadata.get(f.files[4].path).sections[2].position.end.col = parts[2].length;
      f.continu.destroyEditor();
      f.document = f.api.buildScriveningsDocument(await Promise.all(f.files.map(async (file) => ({ file, content: await f.app.vault.read(file) }))));
      f.continu.session.load(f.document);
      f.continu.mountEditor();
      f.cm = f.continu.editorView;
      f.cm.dom.style.height = "360px";
      f.cm.dom.style.width = "540px";
    });
    await refresh(page);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      const source = f.continu.getLiveBody(f.files[4].path).split("\n\n")[2];
      const target = source.indexOf("nefes", 3000) + 2;
      const pos = f.position(4, 4) + target;
      f.cm.dispatch({ selection: { anchor: pos }, effects: f.api.EditorView.scrollIntoView(pos, { y: "nearest" }) });
      await f.idle();
      f.view.setContinuSource(f.continu);
      f.plugin.notifyContinuSelectionChanged(f.continu);
      await f.idle();
      const doc = f.view.previewFrame.contentDocument;
      const fragments = [...doc.querySelectorAll(`[data-source-block-path="${f.files[4].path}"][data-source-start-line="4"]`)];
      const marker = doc.querySelector(".feuillets-preview-caret-marker");
      const rect = marker?.getBoundingClientRect();
      const index = fragments.findIndex((fragment) => { const box = fragment.getBoundingClientRect(); return rect && rect.top >= box.top && rect.bottom <= box.bottom; });
      const raw = fragments[0].getAttribute("data-source-text");
      const visible = f.api.frenchTypography(raw, false).replaceAll("*", "");
      const occurrence = raw.slice(0, target).split("nefes").length - 1;
      let offset = -1;
      for (let count = 0; count <= occurrence; count++) offset = visible.indexOf("nefes", offset + 1);
      offset += 2;
      const rendered = fragments.map((fragment) => fragment.textContent).join("");
      let expected;
      for (const fragment of fragments) {
        const walker = doc.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (offset >= node.length) { offset -= node.length; continue; }
          const range = doc.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          expected = range.getBoundingClientRect();
          break;
        }
        if (expected) break;
      }
      const clicked = f.view.sourcePositionAtClick(fragments[index], { clientX: expected.left + 0.1, clientY: expected.top + 2 });
      const frame = f.view.previewFrame.getBoundingClientRect();
      f.cm.dispatch({ selection: { anchor: pos - 1 } });
      await f.idle();
      return { target, visible, rendered, clicked, expectedCaret: pos, x: frame.left + expected.left + 0.1, y: frame.top + expected.top + 2,
        preview: f.view.previewViewport.scrollTop, error: Math.abs(rect.top - expected.top), heightError: Math.abs(rect.height - expected.height), fragments: fragments.length, index, marker: marker ? { ...marker.dataset } : null, source: f.cm.scrollDOM.scrollTop };
    });
    assert.ok(result.error < 1, JSON.stringify(result));
    assert.ok(result.heightError < 1, JSON.stringify(result));
    assert.ok(result.fragments > 2, JSON.stringify(result));
    assert.ok(result.index > 0, JSON.stringify(result));
    assert.equal(result.marker?.precision, "line");
    assert.equal(Number(result.marker.ch), result.target);
    assert.equal(result.rendered, result.visible);
    assert.ok(result.rendered.includes("d’autres"));
    assert.ok(result.rendered.includes("…"));
    assert.ok(result.rendered.includes("«\u202f"));
    assert.equal(result.clicked.line, 4);
    assert.equal(result.clicked.ch, result.target);
    await page.mouse.click(result.x, result.y);
    const after = await page.evaluate(async () => {
      const f = window.reading;
      await f.idle();
      return { caret: f.cm.state.selection.main.head, source: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop };
    });
    assert.equal(after.caret, result.expectedCaret);
    assert.equal(after.source, result.source);
    assert.equal(after.preview, result.preview);
  });

  await t.test("Reading status changes preserve Markdown word goals and character statistics", async (context) => {
    const page = await openNative(context, false);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      f.metadata.get(f.files[0].path).frontmatter.goal = 20;
      f.sourceLeaf.view.editor = { getValue: () => "one two three" };
      await f.plugin.updateStatusBar();
      const stats = f.plugin.statusStatsEl.textContent;
      const classes = f.plugin.statusEl.className;
      await f.read(7);
      await f.idle();
      return { stats, after: f.plugin.statusStatsEl.textContent, classes, afterClasses: f.plugin.statusEl.className, reading: f.plugin.statusPreviewEl.textContent };
    });
    assert.ok(result.stats.includes("3 / 20"), result.stats);
    assert.ok(result.stats.includes("13"), result.stats);
    assert.equal(result.after, result.stats);
    assert.equal(result.afterClasses, result.classes);
    assert.ok(result.reading.includes("Scene 7"), result.reading);
  });

  await t.test("Zoom repositions the cursor marker in the line margin without repaginating", async (context) => {
    const page = await openNative(context, true);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(f.continu);
      f.cm.dispatch({ selection: { anchor: f.position(4, 4) + 60 } });
      await f.idle();
      const frame = f.view.previewFrame;
      const pages = frame.contentDocument.querySelectorAll(".pdf-page").length;
      const source = f.cm.scrollDOM.scrollTop;
      f.view.setZoom(0.85, "manual");
      await f.idle();
      const block = f.paragraph(4);
      const range = block.ownerDocument.createRange();
      range.setStart(block.firstChild, 60);
      range.setEnd(block.firstChild, 61);
      const line = range.getBoundingClientRect();
      const marker = block.ownerDocument.querySelector(".feuillets-preview-caret-marker").getBoundingClientRect();
      return { pages, afterPages: frame.contentDocument.querySelectorAll(".pdf-page").length, sameFrame: frame === f.view.previewFrame,
        source, afterSource: f.cm.scrollDOM.scrollTop, lineTop: line.top, markerTop: marker.top, markerRight: marker.right, blockLeft: block.getBoundingClientRect().left };
    });
    assert.equal(result.sameFrame, true);
    assert.equal(result.afterPages, result.pages);
    assert.equal(result.afterSource, result.source);
    assert.ok(Math.abs(result.lineTop - result.markerTop) < 1, JSON.stringify(result));
    assert.ok(result.markerRight < result.blockLeft, JSON.stringify(result));
  });

  await t.test("Reading status ignores a hidden Preview and clears only after the last relevant view closes", async (context) => {
    const page = await openNative(context, true);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(f.continu);
      await f.read(4);
      await f.idle();
      const host = document.body.createDiv();
      host.style.height = "500px";
      host.style.width = "600px";
      const leaf = { app: f.app, contentEl: host };
      const other = new f.api.PreviewView(leaf, f.plugin);
      leaf.view = other;
      other._compileScope = f.view.compileScope;
      f.previews.unshift(leaf);
      await other.onOpen();
      for (let index = 0; index < 20 && !other.frameLoaded; index++) await new Promise(requestAnimationFrame);
      host.style.display = "none";
      f.plugin.updatePreviewStatusBar();
      const visible = f.plugin.statusPreviewEl.textContent;
      await other.onClose();
      f.emit("layout-change");
      const afterHiddenClose = f.plugin.statusPreviewEl.textContent;
      await f.view.onClose();
      f.emit("layout-change");
      return { visible, afterHiddenClose, hidden: f.plugin.statusPreviewEl.hidden };
    });
    assert.ok(result.visible.includes("Scene 4"), result.visible);
    assert.equal(result.afterHiddenClose, result.visible);
    assert.equal(result.hidden, true);
  });

  for (const linked of [false, true]) {
    await t.test(`Native Continu wheel scrolling remains stable ${linked ? "with linked Preview" : "without linked Preview"}`, async (context) => {
      const page = await openNative(context, linked);
      await page.mouse.move(270, 180);
      for (const delta of [70, -70]) {
        const before = await page.evaluate(() => ({ source: window.reading.cm.scrollDOM.scrollTop, preview: window.reading.view.previewViewport.scrollTop }));
        for (let index = 0; index < 8; index++) await page.mouse.wheel(0, delta);
        await page.evaluate(() => window.reading.idle());
        const after = await page.evaluate(() => ({ source: window.reading.cm.scrollDOM.scrollTop, preview: window.reading.view.previewViewport.scrollTop }));
        assert.ok(Math.abs(after.source - before.source - 8 * delta) < 2, JSON.stringify({ before, after, delta }));
        if (linked) assert.ok((after.preview - before.preview) * delta > 0, JSON.stringify({ before, after }));
        else assert.equal(after.preview, before.preview);
        await page.waitForTimeout(250);
        const settled = await page.evaluate(() => window.reading.cm.scrollDOM.scrollTop);
        assert.equal(settled, after.source);
      }
    });
  }

  await t.test("Native Continu wheel scrolling takes over after a Preview wheel gesture", async (context) => {
    const page = await openNative(context, true);
    await page.mouse.move(850, 180);
    await page.mouse.wheel(0, -400);
    await page.mouse.move(270, 180);
    for (let index = 0; index < 8; index++) await page.mouse.wheel(0, 70);
    await page.evaluate(() => window.reading.idle());
    const result = await page.evaluate(() => ({ top: window.reading.cm.scrollDOM.scrollTop, beforeLastWheel: window.reading.nativeWheelTops.at(-1) }));
    assert.ok(Math.abs(result.top - result.beforeLastWheel - 70) < 2, JSON.stringify(result));
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.reading.cm.scrollDOM.scrollTop), result.top);
  });

  await t.test("Native Continu restores its reading position after a scope recomposition", async (context) => {
    const page = await openNative(context, false);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      f.plugin.syncExistingPreviewScope = async () => {};
      f.continu.contentEl.style.height = "360px";
      await f.idle();
      const before = f.continu.getScrollAnchor();
      const oldEditor = f.cm;
      const restored = await f.continu.openScope(f.api.createSelectionScope(f.root.path, f.files.slice(1).map((file) => file.path)));
      f.cm = f.continu.editorView;
      await f.idle();
      const after = f.continu.getScrollAnchor();
      return { restored, before, after, scroll: f.cm.scrollDOM.scrollTop, replaced: oldEditor !== f.cm, dirty: f.continu.session.dirtyCount };
    });
    assert.equal(result.restored, true);
    assert.equal(result.replaced, true);
    assert.ok(result.scroll > 0);
    assert.equal(result.after.path, result.before.path);
    assert.ok(Math.abs(result.after.progress - result.before.progress) < 0.02, JSON.stringify(result));
    assert.equal(result.dirty, 0);
  });

  await t.test("Preview controls use the iframe's native document without Obsidian helpers", async (context) => {
    const page = await openNative(context, false);
    const result = await page.evaluate(() => {
      const f = window.reading;
      const doc = f.view.previewFrame.contentDocument;
      const titlePage = doc.createElement("section");
      const title = doc.createElement("p");
      const generated = doc.createElement("p");
      titlePage.append(title, generated);
      doc.body.appendChild(titlePage);
      f.view.addTitleRoleControls(title, "titre", f.files[0].path);
      f.view.addTitlePageControls(titlePage);
      let edits = 0;
      f.view.addGeneratedTitleRoleControls(generated, "titre", () => { edits++; });
      generated.nextElementSibling.querySelector("button").click();
      return { helpers: typeof title.createEl, role: title.nextElementSibling.querySelectorAll("button").length,
        page: titlePage.querySelector(".feuillets-preview-title-page-controls").querySelectorAll("button").length,
        generated: generated.nextElementSibling.querySelectorAll("button").length, edits,
        native: [...titlePage.querySelectorAll("button, span")].every((element) => element.ownerDocument === doc) };
    });
    assert.equal(result.helpers, "undefined");
    assert.equal(result.role, 7);
    assert.equal(result.page, 4);
    assert.equal(result.generated, 5);
    assert.equal(result.edits, 1);
    assert.equal(result.native, true);
  });

  await t.test("A native Preview iframe supports linking, caret navigation and reading refresh", async (context) => {
    const page = await openNative(context, true);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      f.view.setContinuSource(f.continu);
      await f.idle();
      return { source: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop, path: f.files[4].path };
    });
    await page.frameLocator("iframe").locator(`[data-source-block-path="${before.path}"][data-source-start-line="4"]`).first().click({ position: { x: 1, y: 1 } });
    await page.evaluate(() => window.reading.idle());
    const clicked = await page.evaluate(() => {
      const f = window.reading;
      return { source: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop, caret: f.cm.state.selection.main.head, expected: f.position(4, 4) };
    });
    assert.equal(clicked.caret, clicked.expected);
    assert.equal(clicked.source, before.source);
    assert.equal(clicked.preview, before.preview);
    await refresh(page);
    await page.evaluate(() => window.reading.idle());
    const after = await page.evaluate(() => ({ source: window.reading.cm.scrollDOM.scrollTop, preview: window.reading.view.previewViewport.scrollTop }));
    assert.equal(after.source, before.source);
    assert.ok(Math.abs(after.preview - before.preview) < 2, JSON.stringify({ before, after }));
    assert.equal(await page.evaluate(() => window.reading.view.syncingFromEditor), false);
  });

  await t.test("A visible click moves the caret without moving either viewport", async (context) => {
    const page = await open(context);
    const before = await page.evaluate(async () => { const f = window.reading; await f.prepare(4); return { cm: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop }; });
    const after = await page.evaluate(async () => { const f = window.reading; await f.click(4); return { cm: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop, caret: f.cm.state.selection.main.head, expected: f.position(4, 4) }; });
    assert.equal(after.caret, after.expected);
    assert.ok(Math.abs(after.cm - before.cm) < 2, JSON.stringify({ before, after }));
    assert.equal(after.preview, before.preview);
  });

  await t.test("An offscreen click reveals the caret at the nearest edge without a preview rebound", async (context) => {
    const page = await open(context);
    const before = await page.evaluate(async () => { const f = window.reading; await f.prepare(4, false); return f.view.previewViewport.scrollTop; });
    const after = await page.evaluate(async () => {
      const f = window.reading;
      await f.click(4);
      const pos = f.cm.state.selection.main.head;
      const rect = f.cm.coordsAtPos(pos);
      const viewport = f.cm.scrollDOM.getBoundingClientRect();
      return { y: rect.top - viewport.top, height: viewport.height, preview: f.view.previewViewport.scrollTop, scrolls: f.sourceScrolls };
    });
    assert.ok(after.y > after.height * 0.8 && after.y < after.height, JSON.stringify(after));
    assert.equal(after.preview, before, JSON.stringify(after));
  });

  await t.test("A delayed scroll event from CodeMirror cannot echo after the guard is released", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4, false);
      const before = f.view.previewViewport.scrollTop;
      await f.click(4);
      await new Promise((resolve) => setTimeout(resolve, 250));
      f.cm.scrollDOM.dispatchEvent(new Event("scroll"));
      await f.idle();
      return { before, after: f.view.previewViewport.scrollTop, protected: f.view.syncingFromPreview, scrolls: f.sourceScrolls };
    });
    assert.equal(result.protected, false);
    assert.equal(result.after, result.before, JSON.stringify(result));
  });

  await t.test("The last rapid click wins even when older file reads resolve later", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4);
      const read = f.app.vault.cachedRead;
      const gates = new Map();
      f.app.vault.cachedRead = async (file) => {
        const raw = await read(file);
        await new Promise((resolve) => gates.set(file.path, resolve));
        return raw;
      };
      f.paragraph(3).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      f.paragraph(4).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve(); await Promise.resolve();
      gates.get(f.files[4].path)();
      await f.idle();
      gates.get(f.files[3].path)();
      await f.idle();
      return { caret: f.cm.state.selection.main.head, expected: f.position(4, 4) };
    });
    assert.equal(result.caret, result.expected);
  });

  await t.test("Continu aligns the visible paragraph and marks it without repagination", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(1);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const frame = f.view.previewFrame;
      const pages = frame.contentDocument.querySelectorAll(".pdf-page").length;
      await f.cmRead(5);
      const sourceY = (f.cm.documentTop + f.cm.lineBlockAt(f.position(5, 4)).top - f.cm.scrollDOM.getBoundingClientRect().top) / f.cm.scrollDOM.clientHeight;
      const previewY = f.offset(5) / f.view.previewViewport.clientHeight;
      const marker = frame.contentDocument.querySelector(".feuillets-preview-followed-block");
      return { sourceY, previewY, connected: frame === f.view.previewFrame, pages, afterPages: frame.contentDocument.querySelectorAll(".pdf-page").length, markers: frame.contentDocument.querySelectorAll(".feuillets-preview-followed-block").length,
        outline: marker ? parseFloat(frame.contentWindow.getComputedStyle(marker).outlineWidth) : 0 };
    });
    assert.ok(Math.abs(result.sourceY - result.previewY) < 0.08, JSON.stringify(result));
    assert.ok(result.markers > 0);
    assert.ok(result.outline > 0);
    assert.ok(result.connected);
    assert.equal(result.pages, result.afterPages);
  });

  await t.test("A source gesture before CodeMirror measurement cancels the pending click scroll", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4, false);
      f.paragraph(4).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      f.cm.scrollDOM.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 100 }));
      f.cm.scrollDOM.scrollTop = 100;
      await f.idle();
      return f.cm.scrollDOM.scrollTop;
    });
    assert.ok(Math.abs(result - 100) < 2, String(result));
  });

  await t.test("A manual Continu scroll immediately after a click remains authoritative", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4);
      await f.click(4);
      const caret = f.cm.state.selection.main.head;
      const before = f.view.previewViewport.scrollTop;
      f.cm.scrollDOM.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 150 }));
      f.cm.scrollDOM.scrollTop += 150;
      const top = f.cm.scrollDOM.scrollTop;
      await f.idle();
      return { before, after: f.view.previewViewport.scrollTop, top, finalTop: f.cm.scrollDOM.scrollTop, caret, finalCaret: f.cm.state.selection.main.head };
    });
    assert.notEqual(result.after, result.before);
    assert.equal(result.top, result.finalTop);
    assert.equal(result.caret, result.finalCaret);
  });

  await t.test("A manual Preview scroll immediately after a click is not pulled back", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4);
      await f.click(4);
      const source = f.cm.scrollDOM.scrollTop;
      f.view.previewViewport.scrollTop += 300;
      const top = f.view.previewViewport.scrollTop;
      await f.idle();
      f.cm.scrollDOM.dispatchEvent(new Event("scroll"));
      await f.idle();
      return { top, final: f.view.previewViewport.scrollTop, source, finalSource: f.cm.scrollDOM.scrollTop, markers: f.view.previewFrame.contentDocument.querySelectorAll(".feuillets-preview-followed-block").length };
    });
    assert.equal(result.final, result.top);
    assert.notEqual(result.finalSource, result.source);
    assert.equal(result.markers, 0);
  });

  await t.test("The followed block remains at the same relative height across several sheets", async (context) => {
    const page = await open(context);
    await page.evaluate(() => {
      const f = window.reading;
      f.continu._compileScope = f.api.createFolderScope(f.root.path, f.root.path);
      f.frameCount = f.frames.length;
      return f.view.setCompileScope(f.continu.compileScope);
    });
    await page.waitForFunction(() => window.reading.frames.length > window.reading.frameCount && !window.reading.view.refreshInFlight);
    await page.evaluate(() => window.reading.prepare(1));
    for (const index of [1, 4, 7]) {
      const result = await page.evaluate(async (index) => {
        const f = window.reading;
        await f.cmRead(index);
        const sourceY = (f.cm.documentTop + f.cm.lineBlockAt(f.position(index, 4)).top - f.cm.scrollDOM.getBoundingClientRect().top) / f.cm.scrollDOM.clientHeight;
        const mark = f.view.previewFrame.contentDocument.querySelector(".feuillets-preview-followed-block");
        const rect = mark.getBoundingClientRect();
        const path = mark.getAttribute("data-source-block-path");
        f.view.markFollowedBlock([]);
        const unmarked = mark.getBoundingClientRect();
        return { sourceY, previewY: f.offset(index) / f.view.previewViewport.clientHeight, path, expected: f.files[index].path, size: [rect.width, rect.height], unmarkedSize: [unmarked.width, unmarked.height] };
      }, index);
      assert.equal(result.path, result.expected);
      assert.ok(Math.abs(result.sourceY - result.previewY) < 0.08, JSON.stringify(result));
      assert.deepEqual(result.size, result.unmarkedSize);
    }
    assert.equal(await page.evaluate(() => window.reading.opened.length), 0);
  });

  await t.test("A paragraph split across pages follows its text progress rather than the page gap", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.reading;
      const parts = (await f.app.vault.read(f.files[4])).split("\n\n");
      parts[2] = parts[2].repeat(8);
      await f.app.vault.modify(f.files[4], parts.join("\n\n"));
      f.view.setContinuSource(null);
      f.document = f.api.buildScriveningsDocument(await Promise.all(f.files.map(async (file) => ({ file, content: await f.app.vault.read(file) }))));
      f.continu.session.load(f.document);
      f.cm.dispatch({ changes: { from: 0, to: f.cm.state.doc.length, insert: f.document.text } });
      await f.idle();
    });
    await refresh(page);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4);
      const pos = f.position(4, 4);
      const block = f.cm.lineBlockAt(pos);
      const target = f.cm.documentTop + block.top + (block.bottom - block.top) * 0.6 - f.cm.scrollDOM.getBoundingClientRect().top;
      f.cm.scrollDOM.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 1 }));
      f.cm.scrollDOM.scrollTop += target;
      await f.idle();
      const anchor = f.continu.getScrollAnchor();
      const fragments = [...f.view.previewFrame.contentDocument.querySelectorAll(".feuillets-preview-followed-block")];
      const reference = f.view.previewViewport.scrollTop + f.view.previewViewport.clientHeight / 3 - f.view.frameTopWithinScroll();
      const visible = fragments.findIndex((fragment) => { const rect = fragment.getBoundingClientRect(); return reference >= rect.top - 2 && reference <= rect.bottom + 2; });
      return { line: anchor.block?.line, fragments: fragments.length, visible, top: f.view.previewViewport.scrollTop, source: f.cm.scrollDOM.scrollTop };
    });
    assert.equal(result.line, 4);
    assert.ok(result.fragments > 2);
    assert.ok(result.visible > 0, JSON.stringify(result));
  });

  await t.test("The existing status identifies the visible sheet and page even without synchronization", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.read(7);
      await f.idle();
      const pages = [...f.view.previewFrame.contentDocument.querySelectorAll(".pdf-page")];
      const reference = f.view.previewViewport.clientHeight / 3;
      const index = pages.findIndex((page) => page.getBoundingClientRect().bottom + f.view.frameTopWithinScroll() - f.view.previewViewport.scrollTop >= reference);
      return { label: f.plugin.statusPreviewEl.textContent, expected: `Page ${index + 1}/${pages.length}`, name: f.files[7].basename, hidden: f.plugin.statusPreviewEl.hidden, top: f.view.statusEl?.textContent || "", sync: f.view.syncScrollEnabled };
    });
    assert.equal(result.sync, false);
    assert.equal(result.hidden, false);
    assert.ok(result.label.includes(result.name), result.label);
    assert.ok(result.label.includes(result.expected), result.label);
    assert.ok(!result.top.includes(result.expected));
  });

  await t.test("An asynchronous refresh preserves reading and the clicked marker", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4);
      const collect = f.view.collectSource.bind(f.view);
      f.view.collectSource = async (...args) => {
        const source = await collect(...args);
        await new Promise((resolve) => { f.releaseRender = resolve; });
        return source;
      };
      f.frameCount = f.frames.length;
      void f.view.refreshPreview();
    });
    await page.waitForFunction(() => !!window.reading.releaseRender);
    const before = await page.evaluate(async () => { const f = window.reading; await f.click(4, 6); return f.view.previewViewport.scrollTop; });
    await page.evaluate(() => window.reading.releaseRender());
    await page.waitForFunction(() => window.reading.frames.length > window.reading.frameCount && !window.reading.view.refreshInFlight);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.idle();
      return { top: f.view.previewViewport.scrollTop, caret: f.cm.state.selection.main.head, expected: f.position(4, 6), marker: f.view.previewFrame.contentDocument.querySelector(".feuillets-preview-followed-block")?.getAttribute("data-source-start-line") };
    });
    assert.ok(Math.abs(result.top - before) < 2);
    assert.equal(result.caret, result.expected);
    assert.equal(result.marker, "6");
  });

  await t.test("Changing scope rejects a click whose source read belongs to the previous context", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4);
      const read = f.app.vault.cachedRead;
      f.app.vault.cachedRead = async (file) => {
        const raw = await read(file);
        if (file === f.files[4]) await new Promise((resolve) => { f.releaseClick = resolve; });
        return raw;
      };
      f.beforeCaret = f.cm.state.selection.main.head;
      f.paragraph(4).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await page.waitForFunction(() => !!window.reading.releaseClick);
    await page.evaluate(() => { const f = window.reading; f.frameCount = f.frames.length; return f.view.setCompileScope(f.api.createFileScope(f.root.path, f.files[8].path)); });
    await page.waitForFunction(() => window.reading.frames.length > window.reading.frameCount && !window.reading.view.refreshInFlight);
    const result = await page.evaluate(async () => { const f = window.reading; f.releaseClick(); await f.idle(); return { before: f.beforeCaret, caret: f.cm.state.selection.main.head, text: f.view.previewFrame.contentDocument.body.textContent }; });
    assert.equal(result.caret, result.before);
    assert.ok(result.text.includes("File 8, paragraph"));
    assert.ok(!result.text.includes("File 4, paragraph"));
  });

  await t.test("A single-sheet Markdown click retains its editor behavior without moving the preview", async (context) => {
    const page = await open(context);
    await page.evaluate(() => { const f = window.reading; f.frameCount = f.frames.length; return f.view.setCompileScope(f.api.createFileScope(f.root.path, f.files[4].path)); });
    await page.waitForFunction(() => window.reading.frames.length > window.reading.frameCount && !window.reading.view.refreshInFlight);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      f.sourceLeaf.view.editor = { getValue: () => f.document.segments[4].body, setCursor: (position) => { f.cursor = position; }, scrollIntoView: () => { f.source.scrollTop = 200; }, focus: () => {} };
      await f.read(4);
      const top = f.view.previewViewport.scrollTop;
      await f.click(4);
      await new Promise((resolve) => setTimeout(resolve, 250));
      f.source.dispatchEvent(new Event("scroll"));
      await f.idle();
      return { top, final: f.view.previewViewport.scrollTop, cursor: f.cursor, opened: f.opened, path: f.files[4].path, kind: f.view.syncKind };
    });
    assert.deepEqual(result.cursor, { line: 4, ch: 0 });
    assert.equal(result.kind, "markdown");
    assert.deepEqual(result.opened, [result.path]);
    assert.equal(result.final, result.top);
  });

  await t.test("Links and interactive controls retain their own click behavior", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4);
      let clicks = 0;
      const before = f.cm.state.selection.main.head;
      for (const tag of ["a", "button"]) {
        const control = f.view.previewFrame.contentDocument.createElement(tag);
        control.addEventListener("click", (event) => { event.preventDefault(); clicks++; });
        f.paragraph(4).appendChild(control);
        control.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      }
      await f.idle();
      return { clicks, before, caret: f.cm.state.selection.main.head };
    });
    assert.equal(result.clicks, 2);
    assert.equal(result.caret, result.before);
  });

  await t.test("A subsequent editor transaction retains its native caret scrolling", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4, false);
      f.paragraph(4).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      f.cm.scrollDOM.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      const pos = f.position(4, 4);
      f.cm.dispatch({ selection: { anchor: pos }, effects: f.api.EditorView.scrollIntoView(pos, { y: "nearest", yMargin: 0 }) });
      await f.idle();
      return { caret: f.cm.state.selection.main.head, pos, top: f.cm.scrollDOM.scrollTop };
    });
    assert.equal(result.caret, result.pos);
    assert.ok(result.top > 1000);
  });

  await t.test("A linked single-sheet Continu keeps the same click and alignment behavior", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.reading;
      f.files = [f.files[3]];
      f.document = f.api.buildScriveningsDocument([{ file: f.files[0], content: await f.app.vault.read(f.files[0]) }]);
      f.continu.session.load(f.document);
      f.cm.dispatch({ changes: { from: 0, to: f.cm.state.doc.length, insert: f.document.text } });
      f.continu._compileScope = f.api.createFileScope(f.root.path, f.files[0].path);
      f.frameCount = f.frames.length;
      await f.view.setCompileScope(f.continu.compileScope);
    });
    await page.waitForFunction(() => window.reading.frames.length > window.reading.frameCount && !window.reading.view.refreshInFlight);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(0);
      const before = { top: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop };
      await f.click(0);
      return { before, top: f.cm.scrollDOM.scrollTop, preview: f.view.previewViewport.scrollTop, caret: f.cm.state.selection.main.head, expected: f.position(0, 4), linked: f.view.linkedContinuView() === f.continu };
    });
    assert.ok(result.linked);
    assert.equal(result.caret, result.expected);
    assert.equal(result.top, result.before.top);
    assert.equal(result.preview, result.before.preview);
  });

  await t.test("A wheel gesture inside the preview takes ownership during a source synchronization", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.reading;
      await f.prepare(4);
      const release = f.view.releaseAfterFrame.bind(f.view);
      let gesture = false;
      let requested = 0;
      let source = 0;
      f.view.releaseAfterFrame = (callback) => {
        release(callback);
        if (f.view.syncingFromEditor && !gesture) {
          gesture = true;
          source = f.cm.scrollDOM.scrollTop;
          f.paragraph(4).dispatchEvent(new window.WheelEvent("wheel", { bubbles: true, deltaY: 200 }));
          f.view.previewViewport.scrollTop += 200;
          requested = f.view.previewViewport.scrollTop;
        }
      };
      f.cm.scrollDOM.dispatchEvent(new window.WheelEvent("wheel", { deltaY: 100 }));
      f.cm.scrollDOM.scrollTop += 100;
      await f.idle();
      return { gesture, requested, top: f.view.previewViewport.scrollTop, source, finalSource: f.cm.scrollDOM.scrollTop };
    });
    assert.ok(result.gesture);
    assert.equal(result.top, result.requested);
    assert.notEqual(result.source, result.finalSource, JSON.stringify(result));
  });
});
