import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { MarkdownView, Menu, TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { PreviewView } from "../src/views/preview-view.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { loadLayoutStore, saveLayoutStore } from "../src/services/layout-store.js";
import { createSourceAnchor } from "../src/services/source-anchor.js";
import { injectDocumentLayoutMarkers } from "../src/services/document-layout.js";
import { t } from "../src/i18n/index.js";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";

// Obsidian's desktop showAtPosition copies enabled/checked into Electron's
// template. Later MenuItem mutations cannot update that displayed template.
class NativeMenu extends Menu {
  showAtPosition(position, doc) {
    this.position = position;
    this.doc = doc;
    const snapshot = (items) => items.map((item) => {
      const enabled = !item.disabled;
      return {
        title: item.title, enabled, checked: item.checked,
        children: item.submenu ? snapshot(item.submenu.items) : undefined,
        click: async () => {
          if (enabled && !item.disabled) return item.callback?.();
        },
      };
    });
    this.nativeItems = snapshot(this.items);
    return this;
  }
  showAtMouseEvent(event) {
    return this.showAtPosition({ x: event.clientX, y: event.clientY }, event.doc);
  }
}

function harness(source, fromLine, headLine = fromLine, pointerOffset) {
  const volume = new TFolder("Project");
  const manuscript = new TFolder("Project/Manuscript");
  const file = new TFile(`${manuscript.path}/Scene.md`, source);
  volume.children = [manuscript]; manuscript.parent = volume;
  manuscript.children = [file]; file.parent = manuscript;
  const { vault, files } = createFakeVault([volume, manuscript, file]);
  const handlers = {};
  const preview = Object.create(PreviewView.prototype);
  const rendered = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { projectFolder: manuscript.path };
  plugin.app = { vault, workspace: {
    on(name, callback) { (handlers[name] ||= []).push(callback); return {}; },
    getLeavesOfType: () => [{ view: preview }],
  } };
  plugin.getProjectFolder = () => manuscript;
  plugin.registerEvent = () => {};
  plugin.refreshDocumentLayoutPageBreaks = async () => {};
  preview.refreshPreview = async () => {
    const store = await loadLayoutStore(plugin.app, plugin.settings);
    rendered.push(injectDocumentLayoutMarkers(source, store.overrides));
  };
  plugin._lastContextMenuCoords = pointerOffset === undefined ? null : { x: 120, y: 240 };
  const editor = {
    getValue: () => source,
    getCursor: (side) => ({ line: side === "from" ? fromLine : headLine, ch: 0 }),
    replaceRange: () => { throw new Error("Source must not be edited"); },
    cm: pointerOffset === undefined ? undefined : { posAtCoords: () => pointerOffset },
  };
  const view = new MarkdownView(); view.file = file;
  plugin.registerLayoutDirectiveContextMenu();
  const open = async (MenuType = NativeMenu) => {
    const menu = new MenuType();
    handlers["editor-menu"][0](menu, editor, view);
    menu.showAtMouseEvent({ clientX: 120, clientY: 240, doc: { marker: "same-document" } });
    await setImmediate();
    return menu;
  };
  return { plugin, editor, file, files, rendered, open, handlers, view };
}

function layoutEntries(menu) {
  return menu.nativeItems.find((item) => item.title === t("editorMenu.layoutDirective"))?.children;
}
async function click(entry) {
  assert.ok(entry, "native command must exist");
  assert.equal(entry.enabled, true, "displayed native command must be enabled");
  await entry.click();
  await setImmediate();
}

for (const scenario of [
  { name: "italic at the right-click position with the cursor still on a heading", source: "# Heading\n\n*Février 1997*\n\nNeighbour.", from: 0, pointer: 14, quote: "*Février 1997*" },
  { name: "selected paragraph ending at the following blank line", source: "# Heading\n\nKemal descendit dans la fosse. Il déposa le corps enveloppé de son linceul…\n\nNeighbour.", from: 2, head: 3, quote: "Kemal descendit dans la fosse. Il déposa le corps enveloppé de son linceul…" },
  { name: "cursor without a selection", source: "Before.\n\nAn ordinary paragraph.\n\nAfter.", from: 2, quote: "An ordinary paragraph." },
  { name: "multiline paragraph", source: "Before.\n\nFirst line with **bold** text.\nSecond line with *emphasis*.\n\nAfter.", from: 3, quote: "First line with **bold** text.\nSecond line with *emphasis*." },
]) {
  test(`native layout: activation, execution, storage and refresh for ${scenario.name}`, async () => {
    const h = harness(scenario.source, scenario.from, scenario.head, scenario.pointer);
    const menu = await h.open();
    const entries = layoutEntries(menu);
    assert.ok(entries?.find((item) => item.title === t("editorMenu.layout.alignment")), "typography must target the clicked/selected paragraph");
    const alignment = entries[0].children;
    assert.equal(alignment[0].checked, true);
    await click(alignment[2]);
    let store = await loadLayoutStore(h.plugin.app, h.plugin.settings);
    const local = store.overrides.find((item) => item.kind === "paragraph-layout");
    assert.equal(local.alignment, "center");
    assert.equal(local.anchor.quote, scenario.quote);
    assert.ok([...h.files.keys()].some((path) => path.endsWith("/layout.json")));
    assert.match(h.rendered.at(-1), /FEUILLETS_LAYOUT_PARAGRAPH_ALIGNMENT_CENTER/);
    const reopened = layoutEntries(await h.open());
    assert.equal(reopened[0].children[2].checked, true, "native snapshot must reflect stored alignment");
    await click(reopened[1].children[3]);
    await click(reopened[2].children[0].children[2]);
    await click(reopened[2].children[1].children[3]);
    await click(reopened[3]);
    store = await loadLayoutStore(h.plugin.app, h.plugin.settings);
    assert.deepEqual(store.overrides.filter((item) => item.kind === "paragraph-layout").map((item) => [item.alignment, item.firstLineIndentPt, item.spacingBeforePt, item.spacingAfterPt]), [["center", 18, 6, 12]]);
    assert.equal(store.overrides.filter((item) => item.kind === "page-break-before").length, 1);
    assert.match(h.rendered.at(-1), /FEUILLETS_LAYOUT_PAGE_BREAK_BEFORE/);
    const reset = layoutEntries(await h.open());
    assert.equal(reset[3].checked, true);
    await click(reset[0].children[0]);
    store = await loadLayoutStore(h.plugin.app, h.plugin.settings);
    assert.equal(store.overrides.find((item) => item.kind === "paragraph-layout").alignment, undefined);
    for (const entry of [reset[1].children[0], reset[2].children[0].children[0], reset[2].children[1].children[0], reset[3]]) await click(entry);
    assert.deepEqual((await loadLayoutStore(h.plugin.app, h.plugin.settings)).overrides, []);
    assert.equal(h.rendered.at(-1), scenario.source, "default must restore unmodified composition input");
    assert.deepEqual(Buffer.from(await h.plugin.app.vault.read(h.file)), Buffer.from(scenario.source));
  });
}

test("native layout: waits for delayed layout.json before taking the enabled/checked snapshot", async () => {
  const source = "*Février 1997*";
  const h = harness(source, 0);
  await saveLayoutStore(h.plugin.app, h.plugin.settings, { version: 2, overrides: [{ id: "existing", file: "Scene.md", kind: "paragraph-layout", anchor: createSourceAnchor(source, 0, source.length), alignment: "right" }] });
  const read = h.plugin.app.vault.read;
  let finishRead;
  const pendingRead = new Promise((resolve) => { finishRead = resolve; });
  h.plugin.app.vault.read = async (file) => {
    if (file.path.endsWith("/layout.json")) await pendingRead;
    return read(file);
  };
  const menu = new NativeMenu();
  h.handlers["editor-menu"][0](menu, h.editor, h.view);
  const doc = { marker: "preserved-document" };
  assert.equal(menu.showAtPosition({ x: 4, y: 8 }, doc), menu);
  assert.equal(menu.nativeItems, undefined, "native display must await stored state");
  finishRead(); await setImmediate();
  assert.equal(layoutEntries(menu)[0].children[3].checked, true);
  assert.equal(layoutEntries(menu)[0].children[3].enabled, true);
  assert.deepEqual(menu.position, { x: 4, y: 8 }); assert.equal(menu.doc, doc);
  await click(layoutEntries(menu)[0].children[2]);
  assert.equal((await loadLayoutStore(h.plugin.app, h.plugin.settings)).overrides[0].alignment, "center");
});

test("native layout: callback retains the clicked anchor when the cursor moves after opening", async () => {
  const source = "First.\n\n*Février 1997*\n\nLast.";
  const h = harness(source, 2);
  const menu = await h.open();
  h.editor.getCursor = () => ({ line: 4, ch: 0 });
  await click(layoutEntries(menu)[0].children[2]);
  assert.equal((await loadLayoutStore(h.plugin.app, h.plugin.settings)).overrides[0].anchor.quote, "*Février 1997*");
});

test("native layout: incompatible blocks keep typography unavailable and existing page breaks executable", async () => {
  for (const source of ["# Heading", "- List item", "```js\nconst value = 1;\n```", "![[image.png]]"]) {
    const h = harness(source, 0);
    const entries = layoutEntries(await h.open());
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, t("modal.layoutDirective.pageBreakBefore"));
    await click(entries[0]);
    assert.equal((await loadLayoutStore(h.plugin.app, h.plugin.settings)).overrides[0].kind, "page-break-before");
    assert.deepEqual(Buffer.from(await h.plugin.app.vault.read(h.file)), Buffer.from(source));
  }
});

test("native layout: flat fallback is enabled, checked and writes the selected property", async () => {
  class FlatNativeMenu extends NativeMenu {
    addItem(callback) { return super.addItem((item) => { delete item.setSubmenu; callback(item); }); }
  }
  const h = harness("*Février 1997*", 0);
  const menu = await h.open(FlatNativeMenu);
  const alignment = menu.nativeItems.find((item) => item.title.endsWith(t("editorMenu.layout.center")));
  await click(alignment);
  assert.equal((await loadLayoutStore(h.plugin.app, h.plugin.settings)).overrides[0].alignment, "center");
  const reopened = await h.open(FlatNativeMenu);
  assert.equal(reopened.nativeItems.find((item) => item.title === alignment.title).checked, true);
});

test("native layout: response-area callback stays enabled and opens the existing modal", async () => {
  const h = harness("> [!questions]\n> 1. First?\n> 2. Second?", 2);
  let captured;
  h.plugin.openLayoutDirectiveModal = async (...args) => { captured = args; };
  const entry = layoutEntries(await h.open()).find((item) => item.title === t("editorMenu.layout.answerArea"));
  await click(entry);
  assert.equal(captured[0], h.editor); assert.equal(captured[1], h.file);
  assert.equal(h.editor.getValue().slice(captured[2].question.anchor.startOffset, captured[2].question.anchor.endOffset), "> 2. Second?");
});

test("native layout: unreadable layout.json never enables a misleading mutation", async () => {
  const h = harness("Paragraph.", 0);
  await saveLayoutStore(h.plugin.app, h.plugin.settings, { version: 2, overrides: [{ id: "existing", file: "Scene.md", kind: "page-break-before", anchor: createSourceAnchor("Paragraph.", 0, 10) }] });
  const layout = [...h.files.values()].find((file) => file.path.endsWith("/layout.json"));
  await h.plugin.app.vault.modify(layout, "invalid json");
  const entries = layoutEntries(await h.open());
  assert.equal(entries[0].children[2].enabled, false);
  await entries[0].children[2].click();
  assert.equal(await h.plugin.app.vault.read(layout), "invalid json");
});

test("native layout: executed menu commands reach the composed DOM and default restores template geometry", async (context) => {
  const source = "*Février 1997*\n\nNeighbour.";
  const h = harness(source, 0);
  const entries = layoutEntries(await h.open());
  await click(entries[0].children[2]);
  await click(entries[1].children[1]);
  await click(entries[2].children[0].children[2]);
  await click(entries[2].children[1].children[3]);
  const overrides = (await loadLayoutStore(h.plugin.app, h.plugin.settings)).overrides;
  const bundle = await build({
    stdin: { contents: `export { renderManuscriptHtml } from "./services/export-render.ts";
      export { MarkdownRenderer } from "obsidian";`, resolveDir: resolve("src") },
    bundle: true, write: false, format: "iife", globalName: "MenuRenderTest",
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "obsidian-test-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async ({ source, overrides }) => {
    const make = (tag, options = {}, parent) => {
      const el = document.createElement(tag);
      if (options.cls) el.className = options.cls;
      if (options.text) el.textContent = options.text;
      parent?.appendChild(el); return el;
    };
    window.createDiv = (options) => make("div", options);
    HTMLElement.prototype.createEl = function (tag, options) { return make(tag, options, this); };
    HTMLElement.prototype.createDiv = function (options) { return this.createEl("div", options); };
    HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
    HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
    HTMLElement.prototype.empty = function () { this.replaceChildren(); };
    const api = window.MenuRenderTest;
    // Host Markdown rendering is simulated; composition and computed DOM
    // geometry use the actual production pipeline in Chromium.
    api.MarkdownRenderer.render = async (_app, markdown, container) => {
      for (const chunk of markdown.split(/\n\n/u)) {
        const paragraph = make("p", {}, container);
        if (chunk.startsWith("*") && chunk.endsWith("*")) make("em", { text: chunk.slice(1, -1) }, paragraph);
        else paragraph.textContent = chunk;
      }
    };
    const style = make("style", { text: "p { text-align: justify; text-indent: 18pt; margin-top: 0; margin-bottom: 6pt; }" }, document.head);
    const app = { vault: { getAbstractFileByPath: () => null }, metadataCache: { getFileCache: () => ({}) } };
    const render = async (properties) => {
      const { containerEl } = await api.renderManuscriptHtml(app, source, "Project/Manuscript/Scene.md", properties);
      document.body.appendChild(containerEl);
      const p = containerEl.querySelector("p");
      const computed = getComputedStyle(p);
      const result = { align: computed.textAlign, indent: computed.textIndent, before: computed.marginTop, after: computed.marginBottom, italic: p.querySelector("em")?.textContent, neighbour: getComputedStyle(p.nextElementSibling).textAlign, markers: containerEl.textContent.includes("FEUILLETS_LAYOUT_") };
      containerEl.remove(); return result;
    };
    const local = await render(overrides);
    const defaults = await render([]);
    style.remove(); return { local, defaults };
  }, { source, overrides });
  assert.deepEqual(result.local, { align: "center", indent: "0px", before: "8px", after: "16px", italic: "Février 1997", neighbour: "justify", markers: false });
  assert.deepEqual(result.defaults, { align: "justify", indent: "24px", before: "0px", after: "8px", italic: "Février 1997", neighbour: "justify", markers: false });
  assert.deepEqual(Buffer.from(await h.plugin.app.vault.read(h.file)), Buffer.from(source));
});
