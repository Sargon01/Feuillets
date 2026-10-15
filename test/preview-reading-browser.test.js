import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Preview refresh preserves the reader's passage", async (t) => {
  const bundle = await build({
    stdin: { contents: `export { PreviewView } from "./src/views/preview-view.ts";
      export { LayoutEditor } from "./src/ui/layout-editor.ts";
      export { DEFAULT_SETTINGS } from "./src/default-settings.ts";
      export { createFakeVault } from "./test/helpers/fake-vault.ts";
      export { createSelectionScope, createFileScope } from "./src/services/compile-scope.ts";
      export { resolveExportTemplateV2 } from "./src/services/export-templates-custom.ts";
      export { MarkdownRenderer, TFolder } from "obsidian";`, resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", globalName: "ReadingTest",
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "obsidian-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  async function open(context, sync = false) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    context.after(async () => {
      await page.evaluate(() => window.reading?.view.onClose());
      await page.close();
      assert.deepEqual(errors, []);
    });
    await page.addStyleTag({ content: readFileSync("styles.css", "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async (sync) => {
      const api = window.ReadingTest;
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
        getActiveViewOfType: () => sourceLeaf.view,
        getLeavesOfType: (type) => type === "markdown" ? [sourceLeaf] : [],
        getLeaf: () => sourceLeaf,
        setActiveLeaf: () => {},
      } };
      const settings = structuredClone(api.DEFAULT_SETTINGS);
      Object.assign(settings, { projectFolder: root.path, projects: [root.path], previewMode: "manuscript", exportTemplate: "classique", insertFolderTitles: false, insertTitles: false, insertSceneTitles: false });
      const plugin = { settings, getProjectFolder: () => root, saveSettings: async () => {}, getLeafForOpeningFile: () => sourceLeaf };
      const contentEl = make("div", {}, document.body);
      contentEl.style.height = "500px";
      contentEl.style.width = "900px";
      const leaf = { app, contentEl };
      const view = new api.PreviewView(leaf, plugin);
      leaf.view = view;
      view._compileScope = api.createSelectionScope(root.path, files.map((file) => file.path));
      view.zoomMode = "manual";
      view.zoomScale = 0.7;
      if (sync) view.synchronizedFeuilletPath = files[0].path;
      const frames = [];
      const load = view.onFrameLoad.bind(view);
      view.onFrameLoad = (...args) => {
        const prototype = args[1].contentWindow.HTMLElement.prototype;
        for (const name of ["createEl", "createDiv", "createSpan", "empty", "setText", "setAttr", "addClass", "removeClass", "toggleClass", "hasClass", "setCssStyles", "isShown"]) prototype[name] = HTMLElement.prototype[name];
        load(...args);
        frames.push({ frame: args[1], position: view.previewViewport.scrollTop });
      };
      const settle = () => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      const offset = (index, line = 4) => {
        const blocks = [...view.previewFrame.contentDocument.querySelectorAll("[data-source-block-path]")];
        const block = blocks.find((node) => node.getAttribute("data-source-block-path") === files[index].path && Number(node.getAttribute("data-source-start-line")) === line);
        if (!block) throw new Error(`Missing source block: ${index}:${line}`);
        return block.getBoundingClientRect().top + view.frameTopWithinScroll() - view.previewViewport.scrollTop;
      };
      const read = async (index, line = 4) => {
        view.previewViewport.scrollTop += offset(index, line) + 20;
        await settle();
      };
      window.reading = { api, view, app, plugin, root, files, source, sourceLeaf, opened, frames, settle, offset, read };
      await view.onOpen();
    }, sync);
    await page.waitForFunction(() => window.reading.frames.length > 0 && !window.reading.view.refreshInFlight);
    await page.evaluate(() => window.reading.settle());
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

  async function pauseRender(page) {
    await page.evaluate(() => {
      const f = window.reading;
      const collect = f.view.collectSource.bind(f.view);
      const gate = new Promise((release) => { f.releaseRender = release; });
      f.view.collectSource = async (...args) => {
        const source = await collect(...args);
        f.view.collectSource = collect;
        f.renderPaused = true;
        await gate;
        return source;
      };
      f.frameCount = f.frames.length;
      void f.view.refreshPreview();
    });
    await page.waitForFunction(() => window.reading.renderPaused);
  }

  async function finishRender(page, count = 1) {
    await page.evaluate(() => window.reading.releaseRender());
    await page.waitForFunction((count) => window.reading.frames.length >= window.reading.frameCount + count && !window.reading.view.refreshInFlight, count);
    await page.evaluate(() => window.reading.settle());
  }

  await t.test("A: mid-document refresh preserves reading with Markdown synchronization active", async (context) => {
    const page = await open(context, true);
    const before = await page.evaluate(async () => { const f = window.reading; await f.read(4); return { position: f.view.previewViewport.scrollTop, offset: f.offset(4) }; });
    await page.waitForTimeout(250);
    await refresh(page);
    const after = await page.evaluate(() => ({ position: window.reading.view.previewViewport.scrollTop, offset: window.reading.offset(4), enabled: window.reading.view.syncScrollEnabled }));
    assert.ok(after.enabled);
    assert.ok(Math.abs(after.position - before.position) < 2, JSON.stringify({ before, after }));
    assert.ok(Math.abs(after.offset - before.offset) < 2);
  });

  await t.test("B: repagination preserves a source paragraph rather than its former page number", async (context) => {
    const page = await open(context);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      await f.read(4);
      const count = f.view.previewFrame.contentDocument.querySelectorAll(".pdf-page").length;
      const editor = new f.api.LayoutEditor(f.app, f.plugin, document.createElement("div"), "classique", { mode: "modal" });
      await editor.load();
      editor.template.body.fontSizePt = 18;
      await editor.saveTemplate();
      return { count, offset: f.offset(4) };
    });
    await refresh(page);
    const after = await page.evaluate(() => ({ count: window.reading.view.previewFrame.contentDocument.querySelectorAll(".pdf-page").length, offset: window.reading.offset(4) }));
    assert.notEqual(after.count, before.count);
    assert.ok(Math.abs(after.offset - before.offset) < 80, JSON.stringify({ before, after }));
  });

  for (const index of [4, 8]) {
    await t.test(`Reading file ${index} survives refresh with synchronization disabled`, async (context) => {
      const page = await open(context);
      const before = await page.evaluate(async (index) => {
        const f = window.reading;
        await f.read(index);
        f.scrollWrites = 0;
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
        Object.defineProperty(f.view.previewViewport, "scrollTop", {
          get() { return descriptor.get.call(this); },
          set(value) { f.scrollWrites++; descriptor.set.call(this, value); },
        });
        return f.view.previewViewport.scrollTop;
      }, index);
      await refresh(page);
      const after = await page.evaluate(() => ({ position: window.reading.view.previewViewport.scrollTop, enabled: window.reading.view.syncScrollEnabled, writes: window.reading.scrollWrites }));
      assert.equal(after.enabled, false);
      assert.ok(Math.abs(after.position - before) < 2);
      assert.equal(after.writes, 0);
    });
  }

  await t.test("A provisional render never replaces a passage outside its partial scope", async (context) => {
    const page = await open(context);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      await f.read(8);
      f.frameCount = f.frames.length;
      f.view.progressivePreviewScope = async () => f.api.createSelectionScope(f.root.path, f.files.slice(0, 3).map((file) => file.path));
      return f.view.previewViewport.scrollTop;
    });
    await page.evaluate(() => window.reading.view.refreshPreview());
    await page.waitForFunction(() => window.reading.frames.length >= window.reading.frameCount + 2 && !window.reading.view.refreshInFlight);
    await page.evaluate(() => window.reading.settle());
    const positions = await page.evaluate(() => window.reading.frames.slice(window.reading.frameCount).map((frame) => frame.position));
    assert.ok(positions.every((position) => Math.abs(position - before) < 2), JSON.stringify({ before, positions }));
  });

  await t.test("Manual reading during recalculation takes precedence over its initial anchor", async (context) => {
    const page = await open(context);
    await page.evaluate(() => window.reading.read(3));
    await pauseRender(page);
    const before = await page.evaluate(async () => { await window.reading.read(6); return window.reading.view.previewViewport.scrollTop; });
    await finishRender(page);
    const after = await page.evaluate(() => window.reading.view.previewViewport.scrollTop);
    assert.ok(Math.abs(after - before) < 2, JSON.stringify({ before, after }));
  });

  await t.test("Successive notifications coalesce without restoring an older reading position", async (context) => {
    const page = await open(context);
    await page.evaluate(() => window.reading.read(3));
    await pauseRender(page);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      void f.view.refreshPreview();
      void f.view.refreshPreview();
      await f.read(6);
      return f.view.previewViewport.scrollTop;
    });
    await finishRender(page, 2);
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({ top: window.reading.view.previewViewport.scrollTop, frames: window.reading.frames.length - window.reading.frameCount }));
    assert.equal(after.frames, 2);
    assert.ok(Math.abs(after.top - before) < 2, JSON.stringify({ before, after }));
  });

  await t.test("Automatic file opening cannot rewind a later manual scroll", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.reading;
      f.view._compileScope = null;
      const openFile = f.sourceLeaf.openFile;
      f.sourceLeaf.openFile = async (...args) => {
        f.sourceLeaf.openFile = openFile;
        await new Promise((release) => { f.releaseOpen = release; });
        return openFile(...args);
      };
      await f.read(4);
    });
    await page.waitForFunction(() => !!window.reading.releaseOpen);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      f.view.previewViewport.scrollTop += 100;
      await f.settle();
      const top = f.view.previewViewport.scrollTop;
      f.releaseOpen();
      return top;
    });
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({ top: window.reading.view.previewViewport.scrollTop, opened: window.reading.opened.length }));
    assert.ok(after.opened > 0);
    assert.ok(Math.abs(after.top - before) < 2, JSON.stringify({ before, after }));
  });

  await t.test("Scrolling alone does not render or write another preview position", async (context) => {
    const page = await open(context);
    const before = await page.evaluate(async () => { const f = window.reading; await f.read(5); return { top: f.view.previewViewport.scrollTop, frames: f.frames.length }; });
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({ top: window.reading.view.previewViewport.scrollTop, frames: window.reading.frames.length }));
    assert.deepEqual(after, before);
  });

  await t.test("A committed miniature gesture refreshes the preview once and preserves reading", async (context) => {
    const page = await open(context);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      await f.read(5);
      const host = document.body.createDiv();
      f.saved = 0;
      f.editor = new f.api.LayoutEditor(f.app, f.plugin, host, "classique", { mode: "workspace", onChange: () => { f.saved++; void f.view.refreshPreview(); } });
      await f.editor.renderStandaloneFirstPage(host);
      f.block = f.editor.miniature.blockEls.titre;
      f.frameCount = f.frames.length;
      return f.view.previewViewport.scrollTop;
    });
    await page.evaluate(() => {
      const block = window.reading.block;
      block.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100 }));
      document.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 115, clientY: 115 }));
      document.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 115, clientY: 115 }));
    });
    await page.waitForFunction(() => window.reading.frames.length > window.reading.frameCount && !window.reading.view.refreshInFlight);
    await page.evaluate(() => window.reading.settle());
    const after = await page.evaluate(() => ({ top: window.reading.view.previewViewport.scrollTop, saved: window.reading.saved, connected: window.reading.block.isConnected }));
    assert.equal(after.saved, 1);
    assert.ok(after.connected);
    assert.ok(Math.abs(after.top - before) < 2);
  });

  await t.test("Continu synchronization preserves reading on refresh and still accepts deliberate source navigation", async (context) => {
    const page = await open(context);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      f.continu = {
        compileScope: f.view.compileScope,
        getMemberPaths: () => f.files.map((file) => file.path),
        getLiveBody: () => null,
        getScrollElement: () => f.source,
        getScrollAnchor: () => ({ path: f.files[0].path, progress: 0 }),
        scrollToAnchor: () => {},
      };
      f.view.setContinuSource(f.continu);
      await f.settle();
      await f.read(4);
      return f.view.previewViewport.scrollTop;
    });
    await page.waitForTimeout(250);
    await refresh(page);
    const top = await page.evaluate(() => window.reading.view.previewViewport.scrollTop);
    assert.ok(Math.abs(top - before) < 2);
    await page.evaluate(() => {
      const f = window.reading;
      f.continu.getScrollAnchor = () => ({ path: f.files[2].path, progress: 0.5 });
      f.source.scrollTop += 1;
      f.source.dispatchEvent(new Event("scroll"));
    });
    await page.evaluate(() => window.reading.settle());
    const navigated = await page.evaluate(() => ({ top: window.reading.view.previewViewport.scrollTop, section: window.reading.view.sectionForPath(window.reading.files[2].path) }));
    assert.ok(navigated.top >= navigated.section.top);
    assert.ok(navigated.top < navigated.section.top + navigated.section.height);
    assert.notEqual(navigated.top, top);
  });

  await t.test("The complete progressive pass respects reading moved within the provisional preview", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.reading;
      await f.read(1);
      f.view.progressivePreviewScope = async () => f.api.createSelectionScope(f.root.path, f.files.slice(0, 3).map((file) => file.path));
      const collect = f.view.collectSource.bind(f.view);
      f.view.collectSource = async (...args) => {
        const source = await collect(...args);
        if (args[2]) await new Promise((release) => { f.releaseComplete = release; });
        return source;
      };
      f.frameCount = f.frames.length;
      void f.view.refreshPreview();
    });
    await page.waitForFunction(() => !!window.reading.releaseComplete);
    const before = await page.evaluate(async () => {
      const f = window.reading;
      const provisional = !f.view.previewFrame.contentDocument.querySelector(`[data-source-path="${f.files[8].path}"]`);
      await f.read(2);
      return { provisional, top: f.view.previewViewport.scrollTop };
    });
    assert.ok(before.provisional);
    await page.evaluate(() => window.reading.releaseComplete());
    await page.waitForFunction(() => window.reading.frames.length >= window.reading.frameCount + 2 && !window.reading.view.refreshInFlight);
    await page.evaluate(() => window.reading.settle());
    const after = await page.evaluate(() => window.reading.view.previewViewport.scrollTop);
    assert.ok(Math.abs(after - before.top) < 2, JSON.stringify({ before, after }));
  });

  await t.test("An explicit scope change invalidates a render from the previous document", async (context) => {
    const page = await open(context);
    await page.evaluate(() => window.reading.read(4));
    await pauseRender(page);
    await page.evaluate(() => {
      const f = window.reading;
      void f.view.setCompileScope(f.api.createFileScope(f.root.path, f.files[8].path));
    });
    await page.waitForFunction(() => window.reading.frames.length > window.reading.frameCount && !window.reading.view.refreshInFlight);
    await page.evaluate(async () => { window.reading.releaseRender(); await window.reading.settle(); });
    const result = await page.evaluate(() => ({ scope: window.reading.view.compileScope.path, text: window.reading.view.previewFrame.contentDocument.body.textContent, frameCount: window.reading.frames.length - window.reading.frameCount }));
    assert.ok(result.scope.endsWith("Scene 8.md"));
    assert.ok(result.text.includes("File 8, paragraph"));
    assert.ok(!result.text.includes("File 4, paragraph"));
    assert.equal(result.frameCount, 1);
  });

  await t.test("Legacy mode navigation takes precedence over an unfinished refresh", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.reading;
      await f.read(4);
      f.view._compileScope = null;
    });
    await pauseRender(page);
    await page.evaluate(() => window.reading.view.setMode("scene"));
    await page.waitForFunction(() => window.reading.frames.length > window.reading.frameCount && !window.reading.view.refreshInFlight, null, { timeout: 5000 });
    await page.evaluate(async () => { window.reading.releaseRender(); await window.reading.settle(); });
    const result = await page.evaluate(() => ({ text: window.reading.view.previewFrame.contentDocument.body.textContent, frames: window.reading.frames.length - window.reading.frameCount }));
    assert.ok(result.text.includes("File 0, paragraph"));
    assert.ok(!result.text.includes("File 4, paragraph"));
    assert.equal(result.frames, 1);
  });
});
