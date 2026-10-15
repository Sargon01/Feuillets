import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { Document, Packer } from "docx";
import JSZip from "jszip";
import { blockToParagraphs } from "../src/services/docx-blocks.js";

test("Edition refresh and local interactions preserve mounted controls", async (t) => {
  const bundle = await build({
    stdin: { contents: `export { default as FeuilletsPlugin } from "./src/main.ts";
      export { SidebarFeuilletsView } from "./src/views/sidebar-feuillets-view.ts";
      export { PreviewView } from "./src/views/preview-view.ts";
      export { EditionWorkspaceContent } from "./src/ui/edition-workspace-content.ts";
      export { LayoutEditor } from "./src/ui/layout-editor.ts";
      export { LayoutModal } from "./src/ui/layout-modal.ts";
      export { resolvePageGeometry } from "./src/services/page-geometry.ts";
      export { titleRoleCss } from "./src/utils/export-templates.ts";
      export { ExportPanel } from "./src/ui/export-panel.ts";
      export { DEFAULT_SETTINGS } from "./src/default-settings.ts";
      export * from "./src/constants.ts";
      export { t } from "./src/i18n/index.ts";
      export { createFakeVault } from "./test/helpers/fake-vault.ts";
      export { resolveExportTemplateV2, listExportTemplates } from "./src/services/export-templates-custom.ts";
      export { registerOuvrage } from "./src/services/editorial-roots.ts";
      export { createCompositionBinding } from "./src/services/ouvrage-composition.ts";
      export { createProjectScope, createFolderScope } from "./src/services/compile-scope.ts";
      export { getEditionRoot } from "./src/services/folder-structure.ts";
      export { stripFrontmatter } from "./src/services/frontmatter.ts";
      export { TFile, TFolder, Menu, Modal, Notice, stringifyYaml } from "obsidian";`, resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", globalName: "EditionTest",
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "obsidian-test", setup(builder) {
      builder.onResolve({ filter: /^@codemirror\/state$/ }, () => ({ path: resolve("node_modules/@codemirror/state/dist/index.js") }));
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  async function open(context, editionPage = "composition", withPreview = false) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    context.after(async () => {
      await page.close();
      assert.deepEqual(errors, []);
    });
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async ({ editionPage, withPreview }) => {
      const api = window.EditionTest;
      const make = (tag, options = {}, parent) => {
        const element = document.createElement(tag);
        if (options.cls) element.className = options.cls;
        if (options.text) element.textContent = options.text;
        if (options.type) element.type = options.type;
        if (options.value !== undefined) element.value = options.value;
        for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, value);
        parent?.appendChild(element);
        return element;
      };
      window.createEl = make;
      window.createDiv = (options) => make("div", options);
      window.createSpan = (options) => make("span", options);
      HTMLElement.prototype.createEl = function (tag, options) { return make(tag, options, this); };
      HTMLElement.prototype.createDiv = function (options) { return this.createEl("div", options); };
      HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
      HTMLElement.prototype.empty = function () { this.replaceChildren(); };
      HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names.flatMap((name) => name.split(" "))); };
      HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
      HTMLElement.prototype.hasClass = function (name) { return this.classList.contains(name); };
      HTMLElement.prototype.toggleClass = function (name, on) { this.classList.toggle(name, on); };
      HTMLElement.prototype.setText = function (value) { this.textContent = value; return this; };
      HTMLElement.prototype.setAttr = function (name, value) { this.setAttribute(name, value); };
      HTMLElement.prototype.isShown = function () { return !this.hidden; };
      document.head.appendChild(make("style", { text: ".feuillets-sidebar-container { height: 220px; overflow: auto; } .feuillets-edition-row, .setting-item { min-height: 60px; }" }));

      const project = new api.TFolder("Project");
      const root = new api.TFolder("Project/Manuscrit");
      root.parent = project;
      project.children.push(root);
      const front = new api.TFolder("Project/Manuscrit/Front");
      front.parent = root;
      root.children.push(front);
      const other = new api.TFolder("Other");
      const otherRoot = new api.TFolder("Other/Manuscrit");
      otherRoot.parent = other;
      other.children.push(otherRoot);
      const ouvrage = new api.TFolder("Project/Manuscrit/Volume");
      ouvrage.parent = root;
      root.children.push(ouvrage);
      const { vault, fileManager } = api.createFakeVault([project, root, front, other, otherRoot, ouvrage]);
      const secondOuvrage = await vault.createFolder(`${root.path}/Second volume`);
      const chapter = await vault.createFolder(`${ouvrage.path}/Chapter`);
      const chapterFile = await vault.create(`${chapter.path}/Scene.md`, "Chapter text");
      vault.cachedRead = vault.read;
      const titleFile = await vault.create("Project/Manuscrit/Front/Title.md", ":::titre: Initial title\n:::auteur: Initial author\n");
      const externalFile = await vault.create("Elsewhere.md", "External text");
      const frontmatter = new Map();
      const setFrontmatter = frontmatter.set.bind(frontmatter);
      frontmatter.set = (path, data) => {
        const file = vault.getAbstractFileByPath(path);
        if (file instanceof api.TFile) file.content = `---\n${api.stringifyYaml(data)}\n---\n${api.stripFrontmatter(file.content)}`;
        return setFrontmatter(path, data);
      };
      frontmatter.set(titleFile.path, { type: "titre", compile: true });
      const listeners = { vault: new Map(), workspace: new Map(), metadata: new Map() };
      const subscribe = (kind, name, callback) => {
        const callbacks = listeners[kind].get(name) || [];
        callbacks.push(callback);
        listeners[kind].set(name, callbacks);
        return { name, callback };
      };
      const emit = (kind, name, ...args) => {
        for (const callback of listeners[kind].get(name) || []) callback(...args);
      };
      vault.on = (name, callback) => subscribe("vault", name, callback);
      const writes = [];
      const modify = vault.modify;
      vault.modify = async (file, value) => {
        await modify(file, value);
        writes.push(file.path);
        emit("vault", "modify", file);
      };
      fileManager.processFrontMatter = async (file, update) => {
        const data = { ...(frontmatter.get(file.path) || {}) };
        update(data);
        frontmatter.set(file.path, data);
        writes.push(file.path);
        emit("vault", "modify", file);
      };
      const calls = { binder: 0, board: 0, preview: 0, sidebar: 0, save: 0 };
      const visible = make("div", {}, document.body);
      const preview = { view: { refreshForLayoutChange: async () => { calls.preview++; }, compileScope: { projectRoot: root.path } } };
      const leaves = new Map([
        [api.VIEW_SIDEBAR, [{ view: { containerEl: visible, render: () => { calls.binder++; } } }]],
        [api.VIEW_BOARD, [{ view: { containerEl: visible, render: () => { calls.board++; } } }]],
        [api.VIEW_PREVIEW, [preview]],
      ]);
      const app = {
        vault, fileManager,
        metadataCache: { on: (name, callback) => subscribe("metadata", name, callback), getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
        workspace: {
          on: (name, callback) => subscribe("workspace", name, callback),
          getLeavesOfType: (type) => leaves.get(type) || [],
          getActiveFile: () => null,
          getLeaf: () => null,
        },
      };
      const plugin = Object.create(api.FeuilletsPlugin.prototype);
      plugin.app = app;
      plugin.settings = structuredClone(api.DEFAULT_SETTINGS);
      Object.assign(plugin.settings, { projectFolder: root.path, projects: [root.path, otherRoot.path], activeRightPanelTab: "project", exportTemplate: "classique", projectMeta: {} });
      api.registerOuvrage(plugin.settings, root, ouvrage);
      api.registerOuvrage(plugin.settings, root, secondOuvrage);
      plugin.isLayoutReady = true;
      plugin.registerEvent = () => {};
      plugin.getProjectFolder = () => vault.getAbstractFileByPath(plugin.settings.projectFolder);
      plugin.saveSettings = async () => { calls.save++; };
      plugin.adjustSidebarWidth = () => {};
      plugin.scheduleJournalStatsUpdate = () => {};
      plugin.syncProjectPanelsVisibility = async () => {};
      plugin.unitLabel = () => "scene";
      plugin.unitLabelPlural = () => "scenes";
      plugin.getCentralPreviewView = () => null;
      plugin.activeExportScope = { type: "project", projectRoot: root.path };
      plugin.registerVaultEvents();
      let previewView = null;
      if (withPreview) {
        const previewLeaf = { app, contentEl: make("div", {}, document.body) };
        previewView = new api.PreviewView(previewLeaf, plugin);
        previewLeaf.view = previewView;
        leaves.set(api.VIEW_PREVIEW, [previewLeaf]);
        delete plugin.getCentralPreviewView;
        // Pagination is outside this test; keep the real scope and notification path.
        previewView.refreshPreview = async () => { calls.preview++; };
        await api.createCompositionBinding(plugin, root, ouvrage).update({ renamePrefix: "Volume A prefix" });
        await api.createCompositionBinding(plugin, root, secondOuvrage).update({ renamePrefix: "Volume B prefix" });
        await previewView.setCompileScope(api.createProjectScope(ouvrage.path));
      }
      const container = make("div", {}, document.body);
      const leaf = { app, contentEl: container };
      const sidebar = new api.SidebarFeuilletsView(leaf, plugin);
      sidebar.containerEl = container;
      leaf.view = sidebar;
      leaves.set(api.VIEW_SIDEBAR_FEUILLETS, [leaf]);
      const render = sidebar.render.bind(sidebar);
      sidebar.render = async () => { calls.sidebar++; await render(); };
      sidebar.editionPage = editionPage;
      let workspaceContent;
      const renderWorkspace = api.EditionWorkspaceContent.prototype.render;
      api.EditionWorkspaceContent.prototype.render = function () {
        workspaceContent = this;
        return renderWorkspace.call(this);
      };
      try {
        await sidebar.onOpen();
      } finally {
        api.EditionWorkspaceContent.prototype.render = renderWorkspace;
      }
      const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
      const navigate = async (key) => {
        const label = api.t(key);
        const row = [...container.querySelectorAll(".feuillets-project-row, .feuillets-layout-summary-row")].find((node) => node.textContent.includes(label));
        if (!row) throw new Error(`Missing navigation row: ${key}`);
        row.click();
        await settle();
      };
      const remember = (input, value) => {
        input.focus();
        input.value = value;
        if (input.selectionStart !== null) input.setSelectionRange(2, 6, "backward");
        container.scrollTop = 110;
        return { input, value, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection, scroll: container.scrollTop, title: container.querySelector(".feuillets-composition-subpage-title, .feuillets-layout-summary-title")?.textContent };
      };
      const preserved = (state) => ({
        connected: state.input.isConnected, focused: document.activeElement === state.input,
        value: state.input.value === state.value,
        selection: state.input.selectionStart === state.start && state.input.selectionEnd === state.end && state.input.selectionDirection === state.direction,
        scroll: container.scrollTop === state.scroll,
        page: container.querySelector(".feuillets-composition-subpage-title, .feuillets-layout-summary-title")?.textContent === state.title,
      });
      const setting = (key) => {
        const label = api.t(key);
        const row = [...container.querySelectorAll(".setting-item")].find((node) => node.querySelector(".setting-item-name")?.textContent === label);
        if (!row) throw new Error(`Missing setting: ${key}`);
        return row;
      };
      window.fixture = { api, app, plugin, sidebar, container, calls, root, otherRoot, ouvrage, secondOuvrage, chapter, chapterFile, previewView, workspaceContent, titleFile, frontmatter, externalFile, listeners, emit, writes, navigate, settle, remember, preserved, setting };
    }, { editionPage, withPreview });
    return page;
  }

  async function openFront(context) {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.fixture;
      f.second = await f.app.vault.create(`${f.root.path}/Front/Second.md`, ":::titre: Second title\n:::auteur: Second author\n");
      f.third = await f.app.vault.create(`${f.root.path}/Front/Third.md`, ":::titre: Third title\nUser content\n");
      f.frontmatter.set(f.second.path, { type: "titre", compile: false });
      f.frontmatter.set(f.third.path, { type: "titre", compile: false, note: "Keep this property" });
      await f.navigate("compositionSummary.beforeManuscript");
      await f.navigate("preview.export.firstPage");
      f.panel = f.workspaceContent.compositionContent.firstPagePanel;
      f.picker = f.container.querySelector(`[aria-label="${f.api.t("preview.export.usedFrontFile")}"]`);
      f.title = f.container.querySelector(`[aria-label="${f.api.t("preview.firstPageField.title")}"]`);
      f.include = f.container.querySelector(`[aria-label="${f.api.t("preview.export.includeTitlePage")}"]`);
      f.fields = [...f.container.querySelectorAll('input[type="text"]')];
      f.selectFront = (path) => {
        f.picker.value = path;
        f.picker.dispatchEvent(new Event("change"));
      };
      f.notices = [];
      f.api.Notice.onCreate = (message) => f.notices.push(message);
    });
    return page;
  }

  async function openMiniature(context, mode = "composition") {
    const page = await open(context, mode === "workspace" ? "layout" : "composition", true);
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.addStyleTag({ content: readFileSync("styles.css", "utf8") });
    await page.evaluate(async (mode) => {
      const f = window.fixture;
      f.container.style.height = "900px";
      if (mode === "modal") {
        f.modal = new f.api.LayoutModal(f.app, f.plugin, "classique", "Classic", () => { f.calls.preview++; });
        f.modal.modalEl = document.createElement("div");
        f.modal.contentEl = document.createElement("div");
        f.modal.modalEl.appendChild(f.modal.contentEl);
        document.body.appendChild(f.modal.modalEl);
        await f.modal.onOpen();
        f.editor = f.modal.editor;
      } else if (mode === "workspace") {
        f.editor = f.workspaceContent.editor;
        await f.navigate("modal.layout.categoryPage");
        f.editor.select("firstPage");
      } else {
        await f.navigate("compositionSummary.beforeManuscript");
        await f.navigate("preview.export.firstPage");
        f.editor = f.workspaceContent.compositionContent.layoutEditor;
      }
      f.miniature = f.editor.miniature;
      f.miniPage = f.miniature.pageEl;
      f.role = "titre";
      f.block = f.miniature.blockEls[f.role];
      f.originalStyle = { ...f.editor.styles[f.role] };
      f.frontContent = await f.app.vault.read(f.titleFile);
      f.notifications = 0;
      const notify = f.editor.notifyChange.bind(f.editor);
      f.editor.notifyChange = () => { f.notifications++; notify(); };
      f.saves = 0;
      const save = f.editor.saveModel.bind(f.editor);
      f.editor.saveModel = async () => { f.saves++; await save(); };
      f.pointerListeners = new Map();
      const add = document.addEventListener.bind(document);
      const remove = document.removeEventListener.bind(document);
      document.addEventListener = (name, listener, options) => {
        if (["pointermove", "pointerup", "pointercancel"].includes(name)) {
          if (!f.pointerListeners.has(name)) f.pointerListeners.set(name, new Set());
          f.pointerListeners.get(name).add(listener);
        }
        add(name, listener, options);
      };
      document.removeEventListener = (name, listener, options) => {
        f.pointerListeners.get(name)?.delete(listener);
        remove(name, listener, options);
      };
      f.cleanGesture = () => [...f.pointerListeners.values()].every((listeners) => listeners.size === 0);
      f.stableMiniature = () => f.miniPage.isConnected && f.miniature.pageEl === f.miniPage && f.miniature.blockEls[f.role] === f.block && f.block.isConnected;
      f.numericValues = () => Object.fromEntries([...f.editor.roleInputs].map(([key, input]) => [key, input.value]));
      f.calls.preview = 0;
      f.writes.length = 0;
    }, mode);
    return page;
  }

  async function beginGesture(page, dx = 0, dy = 0) {
    const point = await page.evaluate(() => {
      const f = window.fixture;
      f.block.scrollIntoView({ block: "center" });
      const bounds = f.block.getBoundingClientRect();
      f.labelBefore = f.block.firstElementChild.getBoundingClientRect().x;
      f.blockBefore = { top: bounds.top, width: bounds.width };
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.evaluate(() => { window.fixture.numericInputs = [...window.fixture.editor.roleInputs.values()]; });
    if (dx || dy) await page.mouse.move(point.x + dx, point.y + dy, { steps: 3 });
    return point;
  }

  async function openPresets(context, local = false) {
    const page = await open(context, "composition", true);
    await page.evaluate(async (local) => {
      const f = window.fixture;
      Object.assign(f.plugin.settings, {
        compileFileName: "Base manuscript.md", separator: "Base separator",
        insertFolderTitles: false, insertTitles: true, insertSceneTitles: false,
        activePreset: -1,
        compilePresets: [
          { name: "Alpha", fileName: "Alpha.md", separator: "Alpha separator", folderTitles: true, chapterTitles: false, sceneTitles: true },
          { name: "Beta", fileName: "Beta.md", separator: "Beta separator", folderTitles: false, chapterTitles: false, sceneTitles: true },
          { name: "Gamma", fileName: "Gamma.md", separator: "Gamma separator", folderTitles: true, chapterTitles: true, sceneTitles: true },
        ],
      });
      if (local) {
        f.plugin.settings.activePreset = 0;
        await f.api.createCompositionBinding(f.plugin, f.root, f.ouvrage).update({
          fileName: "Local manuscript.md", separator: "Local separator",
          folderTitles: false, chapterTitles: true, sceneTitles: false,
        });
      } else {
        const render = f.api.EditionWorkspaceContent.prototype.render;
        f.api.EditionWorkspaceContent.prototype.render = function () { f.workspaceContent = this; return render.call(this); };
        try {
          await f.previewView.setCompileScope(f.api.createProjectScope(f.root.path));
        } finally {
          f.api.EditionWorkspaceContent.prototype.render = render;
        }
      }
      await f.navigate("compositionSummary.theManuscript");
      await f.navigate("compositionSummary.structureRow");
      f.content = f.workspaceContent.compositionContent;
      const labels = {
        fileName: f.api.t("settings.fileName.name"),
        separator: f.api.t("settings.separator.name"),
        folderTitles: f.api.t("settings.insertFolderTitles.name"),
        chapterTitles: f.api.t("settings.insertTitles.name"),
        sceneTitles: f.api.t("settings.insertSceneTitles.name", { unitPlural: f.plugin.unitLabelPlural() }),
      };
      f.structureInputs = Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, f.container.querySelector(`[aria-label="${label}"]`)]));
      f.structureBody = f.container.querySelector(".feuillets-composition-body");
      f.structureTitle = f.container.querySelector(".feuillets-composition-subpage-title");
      f.presetAdd = f.container.querySelector(".feuillets-edition-preset-add-row button");
      f.structureValues = () => Object.fromEntries(Object.entries(f.structureInputs).map(([key, input]) => [key, input.type === "checkbox" ? input.checked : input.value]));
      f.effectiveValues = () => {
        const binding = f.api.createCompositionBinding(f.plugin, f.root, f.plugin.editorialRootForComposition());
        return Object.fromEntries(Object.keys(f.structureInputs).map((key) => [key, binding.value[key]]));
      };
      f.structureStable = () => f.structureBody === f.container.querySelector(".feuillets-composition-body") && f.structureTitle === f.container.querySelector(".feuillets-composition-subpage-title") && Object.entries(f.structureInputs).every(([key, input]) => input === f.container.querySelector(`[aria-label="${labels[key]}"]`));
      f.applyPreset = async (index) => {
        [...f.container.querySelectorAll("button")].filter((button) => button.textContent === f.api.t("settings.compilePresets.apply"))[index].click();
        await f.content.renderPromise;
      };
      f.deletePreset = async (index) => {
        const button = f.container.querySelectorAll(`[aria-label="${f.api.t("settings.compilePresets.deleteAria")}"]`)[index];
        button.focus({ preventScroll: true });
        f.container.scrollTop = 110;
        const scroll = f.container.scrollTop;
        button.click();
        await f.settle();
        return { stable: f.structureStable(), focused: f.presetAdd.isConnected && document.activeElement === f.presetAdd, scroll: f.container.scrollTop === scroll, removed: !button.isConnected };
      };
      f.calls.save = 0;
      f.calls.preview = 0;
      f.calls.binder = 0;
    }, local);
    return page;
  }

  await t.test("A: Structure typing survives the Vault debounce", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("compositionSummary.theManuscript");
      await f.navigate("compositionSummary.structureRow");
      f.state = f.remember(f.container.querySelector('input[type="text"]'), "Unfinished prefix");
      f.emit("vault", "modify", f.externalFile);
    });
    await page.clock.runFor(2500);
    const result = await page.evaluate(() => ({ state: window.fixture.preserved(window.fixture.state), calls: window.fixture.calls, scroll: window.fixture.state.scroll }));
    assert.ok(result.scroll > 0);
    assert.ok(Object.values(result.state).every(Boolean), JSON.stringify(result.state));
    assert.equal(result.calls.sidebar, 1);
    assert.equal(result.calls.binder, 1);
  });

  await t.test("B: Front content and metadata saves preserve the other fields", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("compositionSummary.beforeManuscript");
      await f.navigate("preview.export.firstPage");
      const inputs = [...f.container.querySelectorAll('input[type="text"]')];
      f.fields = inputs;
      f.state = f.remember(inputs[0], "Updated front title");
      inputs[0].dispatchEvent(new Event("change"));
      await f.settle();
    });
    await page.clock.runFor(2500);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const content = await f.app.vault.read(f.titleFile);
      const preserved = f.preserved(f.state);
      const fields = f.fields.every((input) => input.isConnected);
      f.container.querySelector('input[type="checkbox"]').click();
      await f.settle();
      return { preserved, fields, content, included: f.app.metadataCache.getFileCache(f.titleFile).frontmatter.compile, preview: f.calls.preview };
    });
    assert.ok(Object.values(result.preserved).every(Boolean), JSON.stringify(result.preserved));
    assert.ok(result.fields);
    assert.match(result.content, /:::titre: Updated front title/u);
    assert.equal(result.included, false);
    assert.ok(result.preview > 0);
    await page.clock.runFor(2500);
    assert.equal(await page.evaluate(() => window.fixture.calls.sidebar), 1);
  });

  await t.test("C: Layout template writes preserve the current inspector", async (context) => {
    const page = await open(context, "layout");
    await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("modal.layout.categoryPage");
      await f.navigate("modal.layout.marginsGroup");
      f.state = f.remember(f.container.querySelector("input"), "23");
      f.state.input.dispatchEvent(new Event("input"));
      await f.settle();
    });
    await page.clock.runFor(2500);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const template = await f.api.resolveExportTemplateV2(f.app, f.plugin.settings, f.plugin.settings.exportTemplate);
      return { preserved: f.preserved(f.state), writes: f.writes, template, calls: f.calls };
    });
    assert.ok(Object.values(result.preserved).every(Boolean), JSON.stringify(result.preserved));
    assert.ok(result.writes.some((path) => path.endsWith(".md")));
    assert.equal(result.template.page.marginsCm.top, 23);
    assert.equal(result.calls.sidebar, 1);
    assert.ok(result.calls.preview > 0);
  });

  await t.test("D: External modifications refresh other views and hidden panels stay safe", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.fixture;
      f.form = f.container.querySelector(".feuillets-edition-mode-surface");
      f.container.hidden = true;
      await f.app.vault.modify(f.externalFile, "Changed outside the project");
    });
    await page.clock.runFor(2500);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const stale = f.sidebar._stale;
      f.container.hidden = false;
      f.emit("workspace", "layout-change");
      await f.settle();
      return { stale, cleared: !f.sidebar._stale, same: f.form === f.container.querySelector(".feuillets-edition-mode-surface"), calls: f.calls };
    });
    assert.ok(result.stale && result.cleared && result.same);
    assert.equal(result.calls.binder, 1);
    assert.equal(result.calls.board, 1);
    assert.equal(result.calls.sidebar, 1);
  });

  await t.test("E: Context transitions fence asynchronous callbacks from the old mount", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const original = f.api.EditionWorkspaceContent.prototype.render;
      let release;
      let oldContent;
      const gate = new Promise((resolveGate) => { release = resolveGate; });
      f.api.EditionWorkspaceContent.prototype.render = async function () {
        oldContent = this;
        await gate;
        await original.call(this);
      };
      const pending = f.sidebar.render();
      f.api.EditionWorkspaceContent.prototype.render = original;
      f.plugin.settings.projectFolder = f.otherRoot.path;
      f.plugin.activeExportScope = { type: "project", projectRoot: f.otherRoot.path };
      f.plugin.settings.renamePrefix = "New project prefix";
      await f.sidebar.refreshData();
      await f.navigate("compositionSummary.theManuscript");
      await f.navigate("compositionSummary.structureRow");
      const input = f.container.querySelector('input[type="text"]');
      release();
      await pending;
      oldContent.onLayoutSummaryPageChange("page");
      const projectChanged = input.value === "New project prefix" && input.isConnected && f.sidebar.editionBackHost.children.length === 0;
      const pageUnchanged = f.sidebar.layoutSummaryPage === "home";
      f.plugin.settings.projectFolder = f.root.path;
      f.plugin.activeExportScope = { type: "project", projectRoot: f.ouvrage.path };
      await f.sidebar.refreshData();
      const scopeChanged = f.container.querySelector(".feuillets-composition-context").textContent.includes(f.ouvrage.name);
      const oldGone = !input.isConnected && !f.container.textContent.includes("New project prefix");
      return { projectChanged, pageUnchanged, scopeChanged, oldGone };
    });
    assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));
  });

  await t.test("F: Successive Vault events coalesce without rebuilding or adding listeners", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("compositionSummary.theManuscript");
      await f.navigate("compositionSummary.structureRow");
      f.state = f.remember(f.container.querySelector('input[type="text"]'), "Still typing");
      f.listenerCount = [...f.listeners.vault.values(), ...f.listeners.workspace.values()].reduce((sum, callbacks) => sum + callbacks.length, 0);
      f.emit("vault", "modify", f.externalFile);
    });
    await page.clock.runFor(1800);
    await page.evaluate(() => { const f = window.fixture; for (let i = 0; i < 8; i++) f.emit("vault", "modify", f.externalFile); });
    await page.clock.runFor(2499);
    assert.equal(await page.evaluate(() => window.fixture.calls.binder), 0);
    await page.clock.runFor(1);
    const result = await page.evaluate(() => {
      const f = window.fixture;
      return { preserved: f.preserved(f.state), calls: f.calls, listeners: [...f.listeners.vault.values(), ...f.listeners.workspace.values()].reduce((sum, callbacks) => sum + callbacks.length, 0), before: f.listenerCount };
    });
    assert.ok(Object.values(result.preserved).every(Boolean));
    assert.equal(result.calls.binder, 1);
    assert.equal(result.calls.sidebar, 1);
    assert.equal(result.listeners, result.before);
    await page.clock.runFor(5000);
    assert.equal(await page.evaluate(() => window.fixture.calls.binder), 1);
  });

  await t.test("G: Explicit refresh, reactivation, structural actions and export scope remain live", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("compositionSummary.beforeManuscript");
      await f.navigate("preview.export.firstPage");
      const oldField = f.container.querySelector('input[type="text"]');
      await f.app.vault.modify(f.titleFile, ":::titre: Externally updated title\n:::auteur: New author\n");
      f.plugin.renderAllViews(true);
      await f.settle();
      await f.navigate("compositionSummary.beforeManuscript");
      await f.navigate("preview.export.firstPage");
      const fresh = f.container.querySelector('input[type="text"]').value === "Externally updated title" && !oldField.isConnected;
      f.sidebar.activeTab = "notes";
      f.sidebar.subViews.notes.render = async () => {};
      await f.sidebar.render();
      await f.app.vault.modify(f.titleFile, ":::titre: Title after reactivation\n");
      await f.sidebar.openEditionPage("composition");
      await f.navigate("compositionSummary.beforeManuscript");
      await f.navigate("preview.export.firstPage");
      const reactivated = f.container.querySelector('input[type="text"]').value === "Title after reactivation";
      await f.sidebar.openEditionPage("documents");
      const create = [...f.container.querySelectorAll("button")].find((button) => button.textContent === f.api.t("editionDocs.createFolder"));
      create.click();
      await f.settle();
      const documents = !!f.api.getEditionRoot(f.app, f.root) && !!f.container.querySelector(".feuillets-project-actions");
      await f.sidebar.openEditionPage("composition");
      const exportPanel = new f.api.ExportPanel(f.app, f.plugin, document.createElement("div"), { onScopeChanged: () => f.sidebar.refreshData() });
      await exportPanel.setEditionScope("ouvrage", null, f.ouvrage.path);
      const scope = f.container.querySelector(".feuillets-composition-context").textContent.includes(f.ouvrage.name);
      return { fresh, reactivated, documents, scope };
    });
    assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));
  });

  await t.test("Preview scope: switching ouvrages reloads Composition and fences old callbacks", async (context) => {
    const page = await open(context, "composition", true);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("compositionSummary.theManuscript");
      await f.navigate("compositionSummary.structureRow");
      const oldField = f.container.querySelector('input[type="text"]');
      const before = oldField.value;
      const renders = f.calls.sidebar;
      const binder = f.calls.binder;
      const board = f.calls.board;
      let release;
      const pending = new Promise((resolveGate) => { release = resolveGate; }).then(() => {
        f.workspaceContent.onNavigationRootChange(true);
        f.workspaceContent.onLayoutSummaryPageChange("page");
      });
      await f.previewView.setCompileScope(f.api.createProjectScope(f.secondOuvrage.path));
      await f.navigate("compositionSummary.theManuscript");
      await f.navigate("compositionSummary.structureRow");
      const field = f.container.querySelector('input[type="text"]');
      release();
      await pending;
      const result = {
        before, after: field.value,
        root: f.plugin.editorialRootForComposition().path,
        expectedRoot: f.secondOuvrage.path,
        oldGone: !oldField.isConnected,
        callbacksIgnored: field.isConnected && f.sidebar.editionBackHost.children.length === 0 && f.sidebar.layoutSummaryPage === "home",
        renders: f.calls.sidebar - renders,
        otherViewsUnchanged: f.calls.binder === binder && f.calls.board === board,
      };
      const exportRenders = f.calls.sidebar;
      const previewRefreshes = f.calls.preview;
      f.container.querySelector(".feuillets-edition-quickexport-scope").click();
      f.api.Menu.lastShown.items.find((entry) => entry.title === f.api.t("preview.scope.project")).click();
      await f.settle();
      return {
        ...result,
        exportRenders: f.calls.sidebar - exportRenders,
        previewRefreshes: f.calls.preview - previewRefreshes,
        projectScope: f.plugin.editorialRootForComposition().path === f.root.path,
      };
    });
    assert.equal(result.before, "Volume A prefix");
    assert.equal(result.after, "Volume B prefix");
    assert.equal(result.root, result.expectedRoot);
    assert.ok(result.oldGone && result.callbacksIgnored && result.otherViewsUnchanged);
    assert.equal(result.renders, 1);
    assert.equal(result.exportRenders, 1);
    assert.equal(result.previewRefreshes, 1);
    assert.ok(result.projectScope);
  });

  await t.test("Preview scope: a chapter in the same ouvrage preserves the active form", async (context) => {
    const page = await open(context, "composition", true);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("compositionSummary.theManuscript");
      await f.navigate("compositionSummary.structureRow");
      const state = f.remember(f.container.querySelector('input[type="text"]'), "Unfinished ouvrage prefix");
      const renders = f.calls.sidebar;
      await f.previewView.setCompileScope(f.api.createFolderScope(f.ouvrage.path, f.chapter.path));
      const preserved = f.preserved(state);
      const reset = f.container.querySelector(".feuillets-composition-context button");
      reset.focus();
      state.input.dispatchEvent(new Event("change"));
      await f.settle();
      return { preserved, root: f.plugin.editorialRootForComposition().path, expectedRoot: f.ouvrage.path, renders: f.calls.sidebar - renders, scope: f.previewView.compileScope, resetStable: reset.isConnected && document.activeElement === reset };
    });
    assert.equal(result.root, result.expectedRoot);
    assert.equal(result.scope.type, "folder");
    assert.ok(Object.values(result.preserved).every(Boolean), JSON.stringify(result.preserved));
    assert.equal(result.renders, 0);
    assert.ok(result.resetStable);
  });

  await t.test("Edition scope: the mounted export bar changes ouvrage without a central Preview", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      delete f.plugin.getCentralPreviewView;
      f.app.workspace.getActiveFile = () => f.chapterFile;
      const renders = f.calls.sidebar;
      f.container.querySelector(".feuillets-edition-quickexport-scope").click();
      const item = f.api.Menu.lastShown.items.find((entry) => entry.title === f.api.t("preview.scope.ouvrage"));
      if (!item) throw new Error("Missing ouvrage scope action");
      item.click();
      await f.settle();
      return {
        noPreview: f.plugin.getCentralPreviewView() === null,
        scope: f.plugin.activeExportScope.projectRoot,
        expectedRoot: f.ouvrage.path,
        context: f.container.querySelector(".feuillets-composition-context").textContent,
        renders: f.calls.sidebar - renders,
      };
    });
    assert.ok(result.noPreview);
    assert.equal(result.scope, result.expectedRoot);
    assert.match(result.context, /Volume/u);
    assert.equal(result.renders, 1);
  });

  await t.test("Local layout: multi-digit columns and temporary empty values keep the same input", async (context) => {
    const page = await open(context, "layout");
    await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("modal.layout.categoryPage");
      await f.navigate("modal.layout.marginsGroup");
      f.columns = f.setting("modal.layout.columns").querySelector("input");
      f.margin = f.setting("modal.layout.marginTop").querySelector("input");
      f.columns.setAttribute("data-test-columns", "");
      f.state = f.remember(f.columns, "1");
      f.columns.scrollIntoView({ block: "center" });
      f.state.scroll = f.container.scrollTop;
    });
    await page.locator("[data-test-columns]").fill("2");
    await page.evaluate(() => window.fixture.settle());
    assert.ok(await page.evaluate(() => { const f = window.fixture; return f.columns.isConnected && document.activeElement === f.columns && f.margin.isConnected && !!f.setting("modal.layout.gutterPt"); }));
    await page.keyboard.type("3");
    await page.evaluate(() => window.fixture.settle());
    assert.equal(await page.evaluate(() => window.fixture.workspaceContent.editor.template.page.columns.count), 23);
    await page.locator("[data-test-columns]").fill("");
    assert.deepEqual(await page.evaluate(() => { const f = window.fixture; return { value: f.columns.value, count: f.workspaceContent.editor.template.page.columns.count, focused: document.activeElement === f.columns }; }), { value: "", count: 23, focused: true });
    await page.keyboard.type("4");
    await page.evaluate(() => window.fixture.settle());
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const template = await f.api.resolveExportTemplateV2(f.app, f.plugin.settings, f.plugin.settings.exportTemplate);
      return { count: template.page.columns.count, connected: f.columns.isConnected && f.margin.isConnected, scroll: f.container.scrollTop === f.state.scroll, page: f.container.querySelector(".feuillets-layout-summary-title").textContent === f.state.title };
    });
    assert.equal(result.count, 4);
    assert.ok(result.connected && result.scroll && result.page, JSON.stringify(result));
    await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(() => document.activeElement === window.fixture.setting("modal.layout.gutterPt").querySelector("input")));
    await page.locator("[data-test-columns]").fill("1");
    await page.evaluate(() => window.fixture.settle());
    assert.ok(await page.evaluate(() => { const f = window.fixture; return f.columns.isConnected && document.activeElement === f.columns && ![...f.container.querySelectorAll(".setting-item-name")].some((node) => node.textContent === f.api.t("modal.layout.gutterPt")); }));
  });

  await t.test("Local layout: header and footer switches preserve themselves and update only their fields", async (context) => {
    const page = await open(context, "layout");
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("modal.layout.categoryPage");
      await f.navigate("modal.layout.header");
      const states = [];
      for (const domain of ["header", "footer"]) {
        if (domain === "footer") {
          f.container.querySelector(".feuillets-layout-summary-back button").click();
          await f.settle();
          await f.navigate("modal.layout.footer");
        }
        const key = domain === "header" ? "modal.layout.enableHeader" : "modal.layout.enableFooter";
        const toggle = f.setting(key).querySelector(".checkbox-container");
        toggle.tabIndex = 0;
        toggle.focus();
        const inspector = f.container.querySelector(".feuillets-layout-inspector");
        const model = f.workspaceContent.editor.template[domain];
        if (model.enabled) { toggle.click(); await f.settle(); }
        toggle.click();
        await f.settle();
        const input = f.setting(domain === "header" ? "modal.layout.headerLeft" : "modal.layout.formatWithVars").querySelector("input");
        const state = f.remember(input, "Unsaved text with spaces ");
        input.dispatchEvent(new Event("input"));
        await f.settle();
        states.push(Object.values(f.preserved(state)).every(Boolean));
        toggle.focus();
        toggle.click();
        await f.settle();
        states.push(toggle.isConnected && document.activeElement === toggle && !input.isConnected && inspector.isConnected && !model.enabled);
        toggle.click();
        await f.settle();
        const fresh = f.setting(domain === "header" ? "modal.layout.headerLeft" : "modal.layout.formatWithVars").querySelector("input");
        states.push(fresh.value === state.value && toggle.isConnected && document.activeElement === toggle);
      }
      return states;
    });
    assert.ok(result.every(Boolean), JSON.stringify(result));
  });

  await t.test("Local Front: content, inclusion, file selection and editor actions keep live controls", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const second = await f.app.vault.create(`${f.root.path}/Front/Second title.md`, ":::titre: Second title\n:::sous-titre: Second subtitle\n:::auteur: Second author\n");
      f.frontmatter.set(second.path, { type: "titre", compile: false });
      await f.navigate("compositionSummary.beforeManuscript");
      await f.navigate("preview.export.firstPage");
      const fields = [...f.container.querySelectorAll('input[type="text"]')];
      const title = fields[0];
      const state = f.remember(title, "Edited first title");
      title.dispatchEvent(new Event("change"));
      await f.settle();
      const saved = Object.values(f.preserved(state)).every(Boolean);
      const include = f.container.querySelector('input[type="checkbox"]');
      include.focus();
      const scroll = f.container.scrollTop;
      include.click();
      await f.settle();
      const excluded = include.isConnected && document.activeElement === include && fields.every((input) => input.isConnected) && f.container.scrollTop === scroll && f.frontmatter.get(f.titleFile.path).compile === false;
      include.click();
      await f.settle();
      const picker = f.container.querySelector(`[aria-label="${f.api.t("preview.export.usedFrontFile")}"]`);
      const getFileCache = f.app.metadataCache.getFileCache;
      const cached = new Map([...f.frontmatter].map(([path, data]) => [path, { ...data }]));
      f.app.metadataCache.getFileCache = (file) => ({ frontmatter: cached.get(file.path) || {} });
      picker.focus();
      picker.value = second.path;
      picker.dispatchEvent(new Event("change"));
      await f.settle();
      const switched = picker.isConnected && document.activeElement === picker && fields.every((input) => input.isConnected) && title.value === "Second title" && fields[1].value === "Second subtitle" && fields[2].value === "Second author";
      include.focus();
      include.click();
      await f.settle();
      const inclusionTarget = !include.checked && f.frontmatter.get(second.path).compile === false && picker.value === second.path && title.value === "Second title";
      include.click();
      await f.settle();
      title.focus();
      title.value = "Edited second title";
      title.dispatchEvent(new Event("change"));
      await f.settle();
      const opened = [];
      f.app.workspace.getLeaf = () => ({ openFile: async (file) => { opened.push(file.path); } });
      f.container.querySelector(`[aria-label="${f.api.t("preview.export.openFrontFile")}"]`).click();
      await f.settle();
      const read = f.app.vault.cachedRead;
      let release;
      const pending = new Promise((resolveRead) => { release = resolveRead; });
      f.app.vault.cachedRead = (file) => file === f.titleFile ? pending.then(() => read(file)) : read(file);
      picker.value = f.titleFile.path;
      picker.dispatchEvent(new Event("change"));
      await f.settle();
      const loading = title.disabled && title.value === "";
      picker.value = second.path;
      picker.dispatchEvent(new Event("change"));
      await f.settle();
      release();
      await f.settle();
      const staleReadIgnored = picker.value === second.path && title.value === "Edited second title";
      f.app.metadataCache.getFileCache = getFileCache;
      return { saved, excluded, switched, inclusionTarget, loading, staleReadIgnored, secondContent: await f.app.vault.read(second), firstContent: await f.app.vault.read(f.titleFile), opened, expectedPath: second.path };
    });
    assert.ok(result.saved && result.excluded && result.switched && result.inclusionTarget && result.loading && result.staleReadIgnored, JSON.stringify(result));
    assert.match(result.secondContent, /Edited second title/u);
    assert.match(result.firstContent, /Edited first title/u);
    assert.deepEqual(result.opened, [result.expectedPath]);
  });

  await t.test("Local Front matter: inclusion preserves all rows, order, focus and scroll", async (context) => {
    const page = await open(context);
    await page.evaluate(async () => {
      const f = window.fixture;
      for (let i = 0; i < 8; i++) {
        const file = await f.app.vault.create(`${f.root.path}/Front/Page ${i}.md`, "Front content");
        f.frontmatter.set(file.path, { type: "preface", compile: true });
      }
      await f.navigate("compositionSummary.beforeManuscript");
      await f.navigate("frontMatter.sectionTitle");
      f.frontBody = f.container.querySelector(".feuillets-composition-body");
      f.rows = [...f.frontBody.querySelectorAll(".feuillets-edition-row")];
      f.inputs = [...f.container.querySelectorAll('input[type="checkbox"]')];
      f.frontInput = f.inputs[3];
      f.frontInput.focus();
      f.container.scrollTop = 110;
      f.frontScroll = f.container.scrollTop;
      f.frontInput.click();
      await f.settle();
      f.emit("vault", "modify", f.externalFile);
    });
    await page.clock.runFor(2500);
    const result = await page.evaluate(() => {
      const f = window.fixture;
      return { rows: f.rows.every((row, index) => row === f.frontBody.querySelectorAll(".feuillets-edition-row")[index]), inputs: f.inputs.every((input) => input.isConnected), focused: document.activeElement === f.frontInput, scroll: f.container.scrollTop === f.frontScroll, excluded: f.frontmatter.get(`${f.root.path}/Front/Page 3.md`).compile === false, renders: f.calls.sidebar };
    });
    assert.ok(result.rows && result.inputs && result.focused && result.scroll && result.excluded, JSON.stringify(result));
    assert.equal(result.renders, 1);
  });

  await t.test("Local Composition: adding, editing, applying and deleting presets preserves the surrounding form", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("compositionSummary.theManuscript");
      await f.navigate("compositionSummary.structureRow");
      const prefix = f.container.querySelector('input[type="text"]');
      const add = f.container.querySelector(".feuillets-edition-preset-add-row button");
      add.focus();
      const previous = f.plugin.settings.compilePresets.length;
      add.click();
      await f.settle();
      const added = f.plugin.settings.compilePresets.length === previous + 1 && add.isConnected && prefix.isConnected && document.activeElement === add;
      const names = [...f.container.querySelectorAll(`[aria-label="${f.api.t("settings.compilePresets.name")}"]`)];
      const name = names[names.length - 1];
      const state = f.remember(name, "Edited preset name ");
      name.dispatchEvent(new Event("change"));
      await f.settle();
      const edited = Object.values(f.preserved(state)).every(Boolean) && f.plugin.settings.compilePresets[previous].name === "Edited preset name";
      const output = [...f.container.querySelectorAll(`[aria-label="${f.api.t("settings.compilePresets.outputFile")}"]`)].at(-1);
      output.value = "Chosen output.md";
      output.dispatchEvent(new Event("change"));
      await f.settle();
      const apply = [...f.container.querySelectorAll("button")].filter((button) => button.textContent === f.api.t("settings.compilePresets.apply")).at(-1);
      apply.focus();
      apply.click();
      await f.workspaceContent.compositionContent.renderPromise;
      const mainOutput = f.container.querySelector(`[aria-label="${f.api.t("settings.fileName.name")}"]`);
      const applied = mainOutput.value === "Chosen output.md" && name.isConnected && prefix.isConnected && document.activeElement === apply;
      const del = [...f.container.querySelectorAll(`[aria-label="${f.api.t("settings.compilePresets.deleteAria")}"]`)].at(-1);
      del.focus();
      del.click();
      await f.settle();
      const deleted = f.plugin.settings.compilePresets.length === previous && prefix.isConnected && mainOutput.isConnected && add.isConnected && document.activeElement === add;
      return { added, edited, applied, deleted };
    });
    assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));
  });

  await t.test("Local editorial folders: collapse updates only descendants and keeps navigation and scroll", async (context) => {
    const page = await open(context, "documents");
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const create = [...f.container.querySelectorAll("button")].find((button) => button.textContent === f.api.t("editionDocs.createFolder"));
      create.click();
      await f.settle();
      const edition = f.api.getEditionRoot(f.app, f.root);
      const folder = await f.app.vault.createFolder(`${edition.path}/Local folder`);
      await f.app.vault.create(`${folder.path}/Child.md`, "Document content");
      for (let i = 0; i < 16; i++) await f.app.vault.create(`${edition.path}/Document ${i}.md`, "Editorial content");
      await f.sidebar.render();
      const row = [...f.container.querySelectorAll(".feuillets-edition-folder-row")].find((node) => node.textContent === folder.name);
      const neighbors = [...f.container.querySelectorAll(".feuillets-edition-file-row")];
      const toolbar = f.container.querySelector(".feuillets-project-actions");
      row.focus();
      f.container.scrollTop = 110;
      const scroll = f.container.scrollTop;
      row.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await f.settle();
      const child = [...f.container.querySelectorAll(".feuillets-edition-file-row")].find((node) => node.textContent.includes("Child.md"));
      const expanded = !!child && row.getAttribute("aria-expanded") === "true";
      row.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await f.settle();
      return { expanded, childRemoved: !child.isConnected, neighbors: neighbors.every((node) => node.isConnected), focused: document.activeElement === row, row: row.isConnected, toolbar: toolbar.isConnected, scroll: f.container.scrollTop === scroll, collapsed: f.plugin.settings.collapsed[`editionDocsFolder:${folder.path}`] === true };
    });
    assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));
  });

  await t.test("Local layout: role selection, alignment, color reset and presentation themes keep their controls", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("compositionSummary.beforeManuscript");
      await f.navigate("preview.export.firstPage");
      const picker = f.setting("modal.layout.element").querySelector("select");
      picker.focus();
      picker.value = "titre";
      picker.dispatchEvent(new Event("change"));
      await f.settle();
      const selected = picker.isConnected && document.activeElement === picker;
      const input = f.setting("modal.layout.sizePt").querySelector("input");
      const align = f.setting("modal.layout.alignment").querySelectorAll(".extra-setting-button")[0];
      align.tabIndex = 0;
      align.focus();
      align.click();
      await f.settle();
      const aligned = align.isConnected && document.activeElement === align && align.hasClass("is-active") && input.isConnected && picker.isConnected;
      await f.sidebar.openEditionPage("layout");
      await f.navigate("modal.layout.categoryText");
      await f.navigate("modal.layout.currentText");
      const font = f.setting("modal.layout.font").querySelector("input");
      const reset = f.setting("modal.layout.textColor").querySelector(".extra-setting-button");
      reset.tabIndex = 0;
      reset.focus();
      reset.click();
      await f.settle();
      const resetStable = reset.isConnected && document.activeElement === reset && font.isConnected;
      await f.sidebar.openEditionPage("layout");
      for (let i = 0; i < 2; i++) {
        f.container.querySelector(".feuillets-layout-summary-back button").click();
        await f.settle();
      }
      await f.navigate("layoutWorkspace.slides");
      const projectTheme = f.setting("layoutWorkspace.projectTheme").querySelector("select");
      const defaultTheme = f.setting("layoutWorkspace.defaultTheme").querySelector("select");
      defaultTheme.focus();
      defaultTheme.value = "dark";
      defaultTheme.dispatchEvent(new Event("change"));
      await f.settle();
      const themes = projectTheme.isConnected && defaultTheme.isConnected && document.activeElement === defaultTheme && f.plugin.settings.presentationTheme === "dark";
      let content;
      const render = f.api.EditionWorkspaceContent.prototype.render;
      f.api.EditionWorkspaceContent.prototype.render = function () { content = this; return render.call(this); };
      try {
        await f.sidebar.openEditionPage("layout");
      } finally {
        f.api.EditionWorkspaceContent.prototype.render = render;
      }
      const select = f.container.querySelector(".feuillets-layout-toolbar select");
      const inspector = f.container.querySelector(".feuillets-layout-inspector");
      const editor = content.editor;
      const templates = await f.api.listExportTemplates(f.app, f.plugin.settings);
      const open = f.api.Modal.prototype.open;
      f.api.Modal.prototype.open = function () { this.onResult("Renamed template"); };
      select.focus();
      try {
        await content.renameTemplate("Original template", templates);
      } finally {
        f.api.Modal.prototype.open = open;
      }
      const renamed = inspector.isConnected && select.isConnected && document.activeElement === select && content.editor === editor && select.selectedOptions[0].textContent === "Renamed template" && templates.find((entry) => entry.key === f.plugin.settings.exportTemplate).label === "Renamed template";
      return { selected, aligned, resetStable, themes, renamed };
    });
    assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));
  });

  await t.test("Local Annexes: creating the folder keeps the inclusion control and action button", async (context) => {
    const page = await open(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      await f.navigate("compositionSummary.afterManuscript");
      const include = f.container.querySelector(`[aria-label="${f.api.t("annexes.include")}"]`);
      const create = f.container.querySelector(`[aria-label="${f.api.t("annexes.createFolder")}"]`);
      create.focus();
      create.click();
      await f.settle();
      const stable = include.isConnected && create.isConnected && document.activeElement === create && create.getAttribute("aria-label") === f.api.t("annexes.openFolder");
      let opened = 0;
      f.app.internalPlugins = { getPluginById: () => ({ instance: { revealInFolder: () => { opened++; } } }) };
      create.click();
      return { stable, folder: !!f.app.vault.getAbstractFileByPath(`${f.root.path}/Annexes`), opened };
    });
    assert.ok(result.stable && result.folder);
    assert.equal(result.opened, 1);
  });

  await t.test("Miniature: clicks select roles locally without saving in all three hosts", async (context) => {
    for (const mode of ["workspace", "composition", "modal"]) {
      const page = await openMiniature(context, mode);
      const general = await page.evaluate(() => {
        const f = window.fixture;
        f.general = [...f.editor.inspectorEl.querySelectorAll("select, .checkbox-container")];
        return f.general.length;
      });
      const point = await beginGesture(page);
      await page.mouse.move(point.x + 2, point.y);
      await page.mouse.up();
      const result = await page.evaluate(async (mode) => {
        const f = window.fixture;
        await f.settle();
        const selected = mode === "modal" ? f.editor.selected === f.role : f.editor.selectedRole === f.role && f.editor.rolePicker.value === f.role && f.editor.selected === "firstPage";
        const stable = f.stableMiniature();
        const fields = f.numericInputs.length === 5 && f.numericInputs.every((input) => input.isConnected);
        const highlighted = f.block.hasClass("is-selected");
        const controls = mode === "modal" || f.general.every((input) => input.isConnected);
        if (mode === "modal") {
          f.miniature.headerBand.click();
          if (f.editor.selected !== "header") throw new Error("Header selection lost");
          f.miniature.footerBand.click();
          if (f.editor.selected !== "footer") throw new Error("Footer selection lost");
        }
        return { selected, stable, fields, highlighted, controls, saves: f.saves, writes: f.writes.length, notifications: f.notifications, clean: f.cleanGesture() };
      }, mode);
      assert.ok(result.selected && result.stable && result.fields && result.highlighted && result.controls && result.clean, JSON.stringify({ mode, general, ...result }));
      assert.equal(result.saves, 0);
      assert.equal(result.writes, 0);
      assert.equal(result.notifications, 0);
    }
  });

  await t.test("Miniature: vertical motion preserves the page and inspector, follows the flow and saves once on release", async (context) => {
    for (const mode of ["workspace", "composition", "modal"]) {
      const page = await openMiniature(context, mode);
      await page.evaluate(() => { const f = window.fixture; f.next = f.miniature.blockEls[f.editor.roles[1]]; f.nextTop = parseFloat(f.next.style.top); });
      await beginGesture(page, 0, 12);
      const during = await page.evaluate(() => {
        const f = window.fixture;
        const style = f.editor.styles[f.role];
        const shift = parseFloat(f.block.style.top) - (f.originalStyle.marginTopPt + f.editor.template.page.marginsCm.top * 10 * 72 / 25.4) * f.miniature.scale;
        return { stable: f.stableMiniature() && f.numericInputs.every((input) => input.isConnected), top: style.marginTopPt, before: f.originalStyle.marginTopPt, field: f.numericValues().marginTopPt, following: Math.abs(parseFloat(f.next.style.top) - f.nextTop - shift) < 0.01, saves: f.saves, writes: f.writes.length };
      });
      assert.ok(during.stable && during.following);
      assert.ok(during.top > during.before);
      assert.equal(during.field, String(during.top));
      assert.equal(during.saves, 0);
      assert.equal(during.writes, 0);
      await page.mouse.up();
      await page.waitForFunction(() => window.fixture.notifications === 1);
      const result = await page.evaluate(async () => {
        const f = window.fixture;
        await f.settle();
        const saved = await f.api.resolveExportTemplateV2(f.app, f.plugin.settings, f.editor.templateKey);
        return { saves: f.saves, writes: f.writes.length, notifications: f.notifications, preview: f.calls.preview, saved: saved.titlePage.styles[f.role].marginTopPt, current: f.editor.styles[f.role].marginTopPt, clean: f.cleanGesture(), front: f.frontContent === await f.app.vault.read(f.titleFile), stable: f.stableMiniature() };
      });
      assert.equal(result.saves, 1);
      assert.equal(result.writes, 1);
      assert.equal(result.notifications, 1);
      assert.equal(result.preview, 1, mode);
      assert.equal(result.saved, result.current);
      assert.ok(result.clean && result.front && result.stable);
    }
  });

  await t.test("Miniature: horizontal margins translate left, centered and right aligned text without changing paragraph width", async (context) => {
    for (const align of ["left", "center", "right"]) {
      const page = await openMiniature(context);
      await page.evaluate((align) => { const f = window.fixture; f.editor.styles[f.role].align = align; f.miniature.refresh(); }, align);
      for (const dx of [8, -8]) {
        await beginGesture(page, dx);
        const result = await page.evaluate(() => {
          const f = window.fixture;
          const bounds = f.block.getBoundingClientRect();
          const style = f.editor.styles[f.role];
          return { shift: f.block.firstElementChild.getBoundingClientRect().x - f.labelBefore, width: bounds.width - f.blockBefore.width, sum: style.marginLeftPt + style.marginRightPt, stable: f.stableMiniature() && f.numericInputs.every((input) => input.isConnected), fields: f.numericValues(), style: { ...style } };
        });
        assert.ok(Math.abs(result.shift - dx) < 0.5, JSON.stringify({ align, dx, ...result }));
        assert.ok(Math.abs(result.width) < 0.1);
        assert.equal(result.sum, 0);
        assert.equal(result.fields.marginLeftPt, String(result.style.marginLeftPt));
        assert.equal(result.fields.marginRightPt, String(result.style.marginRightPt));
        assert.ok(result.stable);
        await page.mouse.up();
        await page.evaluate(async () => window.fixture.settle());
      }
      assert.equal(await page.evaluate(() => window.fixture.saves), 2);
    }
  });

  await t.test("Miniature: diagonal drag preserves focused drafts and saved margins reach PDF CSS and DOCX OOXML", async (context) => {
    const page = await openMiniature(context);
    const point = await beginGesture(page);
    await page.evaluate(() => {
      const f = window.fixture;
      f.focused = f.editor.roleInputs.get("marginTopPt");
      f.focused.value = "999";
      f.focused.focus();
    });
    await page.mouse.move(point.x + 8, point.y + 12, { steps: 3 });
    assert.ok(await page.evaluate(() => {
      const f = window.fixture;
      return document.activeElement === f.focused && f.focused.value === "999" && f.numericInputs.every((input) => input.isConnected) && f.editor.styles[f.role].marginTopPt > f.originalStyle.marginTopPt && f.editor.styles[f.role].marginLeftPt > 0 && f.editor.styles[f.role].marginRightPt < 0 && f.saves === 0;
    }));
    await page.mouse.up();
    await page.waitForFunction(() => window.fixture.notifications === 1);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const template = await f.api.resolveExportTemplateV2(f.app, f.plugin.settings, f.editor.templateKey);
      const style = template.titlePage.styles[f.role];
      const sheet = document.createElement("style");
      const sample = document.createElement("div");
      sample.className = "feuillets-frontpage";
      sample.style.width = "500px";
      const paragraph = document.createElement("p");
      paragraph.setAttribute("data-fp-role", f.role);
      const text = document.createElement("span");
      text.textContent = "Centered manuscript title";
      paragraph.appendChild(text);
      sample.appendChild(paragraph);
      document.body.append(sheet, sample);
      sheet.textContent = f.api.titleRoleCss({ titlePage: { styles: { [f.role]: { ...style, marginLeftPt: 0, marginRightPt: 0 } } } });
      const before = text.getBoundingClientRect().x;
      sheet.textContent = f.api.titleRoleCss(template);
      const computed = getComputedStyle(paragraph);
      return { style, shift: text.getBoundingClientRect().x - before, left: parseFloat(computed.marginLeft), right: parseFloat(computed.marginRight), focused: document.activeElement === f.focused && f.focused.value === "999", clean: f.cleanGesture() };
    });
    assert.ok(result.focused && result.clean);
    assert.ok(Math.abs(result.shift - result.style.marginLeftPt * 96 / 72) < 0.1);
    assert.ok(Math.abs(result.left - result.style.marginLeftPt * 96 / 72) < 0.1);
    assert.ok(Math.abs(result.right - result.style.marginRightPt * 96 / 72) < 0.1);
    const paragraph = { nodeType: 1, tagName: "P", childNodes: [{ nodeType: 3, nodeValue: "Manuscript title" }], children: [], textContent: "Manuscript title", classList: { contains: () => false }, getAttribute: () => null, querySelector: () => null };
    const paragraphs = blockToParagraphs(paragraph, new Map(), { key: "classique", label: "Classic" }, {}, new Map(), { style: result.style });
    const zip = await JSZip.loadAsync(await Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] })));
    const xml = await zip.file("word/document.xml").async("string");
    assert.ok(xml.includes(`w:left="${result.style.marginLeftPt}pt"`));
    assert.ok(xml.includes(`w:right="${result.style.marginRightPt}pt"`));
    assert.ok(xml.includes(`w:before="${result.style.marginTopPt * 20}"`));
    assert.ok(xml.includes('w:jc w:val="center"'));
  });

  await t.test("Miniature: numeric margins update the same blocks and a role change cancels a pending gesture locally", async (context) => {
    for (const mode of ["composition", "modal"]) {
      const page = await openMiniature(context, mode);
      await beginGesture(page);
      await page.mouse.up();
      const result = await page.evaluate(async (mode) => {
        const f = window.fixture;
        const inputs = [...f.editor.roleInputs];
        for (const [key, value] of [["marginLeftPt", "10"], ["marginRightPt", "20"], ["marginTopPt", "50"], ["marginBottomPt", "30"]]) {
          const input = f.editor.roleInputs.get(key);
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await f.settle();
        }
        const manual = f.stableMiniature() && inputs.every(([, input]) => input.isConnected) && f.editor.styles[f.role].marginLeftPt === 10 && f.editor.styles[f.role].marginRightPt === 20 && f.editor.styles[f.role].marginTopPt === 50 && f.editor.styles[f.role].marginBottomPt === 30;
        const changedPosition = parseFloat(f.block.style.left) > 10 * f.miniature.scaleX;
        f.beforeChange = JSON.stringify(f.editor.styles[f.role]);
        f.saves = 0;
        const next = f.editor.roles[1];
        f.nextRole = next;
        f.changeRole = () => {
          if (mode === "modal") f.modal.select(next);
          else { f.editor.rolePicker.value = next; f.editor.rolePicker.dispatchEvent(new Event("change")); }
        };
        return { manual, changedPosition };
      }, mode);
      assert.ok(result.manual && result.changedPosition);
      await beginGesture(page, 6, 10);
      const switched = await page.evaluate(async () => {
        const f = window.fixture;
        f.changeRole();
        await f.settle();
        return { stable: f.stableMiniature(), restored: f.beforeChange === JSON.stringify(f.editor.styles[f.role]), selected: f.editor.selectedRole === f.nextRole || f.editor.selected === f.nextRole, clean: f.cleanGesture(), saves: f.saves };
      });
      await page.mouse.up();
      assert.ok(switched.stable && switched.restored && switched.selected && switched.clean);
      assert.equal(switched.saves, 0);
    }
  });

  await t.test("Miniature: cancellation, interruption, remount and detachment restore unsaved values and release listeners", async (context) => {
    for (const interruption of ["pointercancel", "blur", "remount", "detach", "close"]) {
      const page = await openMiniature(context, interruption === "close" ? "modal" : "composition");
      await beginGesture(page, 8, 12);
      const result = await page.evaluate(async (interruption) => {
        const f = window.fixture;
        if (interruption === "pointercancel") document.dispatchEvent(new window.PointerEvent("pointercancel", { pointerId: 1 }));
        if (interruption === "blur") window.dispatchEvent(new Event("blur"));
        if (interruption === "remount") f.miniature.mount();
        if (interruption === "detach") f.miniPage.remove();
        if (interruption === "close") f.modal.onClose();
        await f.settle();
        return { restored: JSON.stringify(f.editor.styles[f.role]) === JSON.stringify(f.originalStyle), clean: f.cleanGesture(), saves: f.saves, writes: f.writes.length, notifications: f.notifications };
      }, interruption);
      await page.mouse.up();
      assert.ok(result.restored && result.clean, JSON.stringify({ interruption, ...result }));
      assert.equal(result.saves, 0);
      assert.equal(result.writes, 0);
      assert.equal(result.notifications, 0);
    }
  });

  await t.test("Miniature: unrelated pointers and zero net displacement do not save, and outside movements stay bounded", async (context) => {
    const page = await openMiniature(context);
    let point = await beginGesture(page);
    await page.evaluate((point) => document.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 99, clientX: point.x + 80, clientY: point.y + 80 })), point);
    await page.mouse.up();
    point = await beginGesture(page, 8, 12);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    assert.ok(await page.evaluate(() => {
      const f = window.fixture;
      return f.saves === 0 && f.notifications === 0 && f.writes.length === 0 && f.cleanGesture() && JSON.stringify(f.editor.styles[f.role]) === JSON.stringify(f.originalStyle);
    }));
    point = await beginGesture(page);
    const bounded = await page.evaluate((point) => {
      const f = window.fixture;
      document.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 1, clientX: point.x + 800, clientY: point.y + 800 }));
      const paper = f.miniPage.getBoundingClientRect();
      const block = f.block.getBoundingClientRect();
      const style = f.editor.styles[f.role];
      const inside = block.left >= paper.left - 0.1 && block.right <= paper.right + 0.1 && block.bottom <= paper.bottom + 0.1;
      const finite = [style.marginTopPt, style.marginLeftPt, style.marginRightPt].every(Number.isFinite);
      const singleListeners = [...f.pointerListeners.values()].every((listeners) => listeners.size === 1);
      document.dispatchEvent(new window.PointerEvent("pointercancel", { pointerId: 1 }));
      return { inside, finite, singleListeners, clean: f.cleanGesture(), restored: JSON.stringify(style) === JSON.stringify(f.originalStyle), saves: f.saves };
    }, point);
    await page.mouse.up();
    assert.ok(bounded.inside && bounded.finite && bounded.singleListeners && bounded.clean && bounded.restored, JSON.stringify(bounded));
    assert.equal(bounded.saves, 0);
    await beginGesture(page, 6, 10);
    await page.mouse.up();
    await page.waitForFunction(() => window.fixture.notifications === 1);
    assert.ok(await page.evaluate(() => window.fixture.saves === 1 && window.fixture.cleanGesture()));
  });

  await t.test("Miniature: point conversion follows page format, orientation, scale and asymmetric page margins", async (context) => {
    const page = await openMiniature(context);
    for (const [index, size] of ["A4", "A5", "Letter"].entries()) {
      for (const orientation of ["portrait", "landscape"]) {
        const expected = await page.evaluate(({ size, orientation, height }) => {
          const f = window.fixture;
          Object.assign(f.editor.template.page, { size, orientation, marginsCm: { top: 1.8, bottom: 2.2, left: 1.3, right: 2.1 } });
          Object.assign(f.editor.styles[f.role], { marginTopPt: 20, marginLeftPt: 0, marginRightPt: 0 });
          f.miniature.options.heightPx = height;
          f.miniature.refresh();
          const geometry = f.api.resolvePageGeometry({ pageSize: size, pageOrientation: orientation });
          const scaleX = parseFloat(f.miniPage.style.width) / (geometry.widthMm * 72 / 25.4);
          const scaleY = height / (geometry.heightMm * 72 / 25.4);
          return { left: Math.round(6 / scaleX), top: 20 + Math.round(10 / scaleY), ratio: geometry.widthMm / geometry.heightMm, leftPx: 1.3 * 10 * 72 / 25.4 * scaleX, scaleX };
        }, { size, orientation, height: [200, 260, 400][index] });
        await beginGesture(page, 6, 10);
        const result = await page.evaluate(() => {
          const f = window.fixture;
          return { style: { ...f.editor.styles[f.role] }, ratio: parseFloat(f.miniPage.style.width) / parseFloat(f.miniPage.style.height), left: parseFloat(f.block.style.left), stable: f.stableMiniature() };
        });
        assert.equal(result.style.marginLeftPt, expected.left);
        assert.equal(result.style.marginRightPt, -expected.left);
        assert.equal(result.style.marginTopPt, expected.top);
        assert.ok(Math.abs(result.ratio - expected.ratio) < 0.005);
        assert.ok(Math.abs(result.left - expected.leftPx - expected.left * expected.scaleX) < 0.001);
        assert.ok(result.stable);
        await page.mouse.up();
        await page.evaluate(async () => window.fixture.settle());
      }
    }
  });

  await t.test("Preset deletion: removing the active preset displays the effective fallback without saving Composition", async (context) => {
    for (const active of [0, 2]) {
      const page = await openPresets(context);
      const result = await page.evaluate(async (active) => {
        const f = window.fixture;
        await f.applyPreset(active);
        const applied = f.structureValues();
        f.calls.save = 0;
        f.calls.preview = 0;
        f.calls.binder = 0;
        const interaction = await f.deletePreset(active);
        const displayed = f.structureValues();
        const effective = f.effectiveValues();
        const calls = { ...f.calls };
        f.structureInputs.fileName.value = "Edited after deletion.md";
        f.structureInputs.fileName.dispatchEvent(new Event("change"));
        await f.content.renderPromise;
        return { applied, displayed, effective, active: f.plugin.settings.activePreset, count: f.plugin.settings.compilePresets.length, interaction, calls, listener: f.effectiveValues().fileName === "Edited after deletion.md" };
      }, active);
      assert.notDeepEqual(result.applied, result.effective);
      assert.deepEqual(result.displayed, result.effective);
      assert.deepEqual(result.effective, { fileName: "Base manuscript.md", separator: "Base separator", folderTitles: false, chapterTitles: true, sceneTitles: false });
      assert.equal(result.active, -1);
      assert.equal(result.count, 2);
      assert.ok(result.interaction.stable && result.listener);
      assert.equal(result.calls.save, 1);
      assert.equal(result.calls.preview, 1);
      assert.equal(result.calls.binder, 1);
    }
  });

  await t.test("Preset deletion: removing an inactive preset preserves the composition and unfinished field selection", async (context) => {
    const page = await openPresets(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      await f.applyPreset(0);
      const before = f.effectiveValues();
      const state = f.remember(f.structureInputs.fileName, "Unfinished file name");
      f.calls.save = 0;
      f.calls.preview = 0;
      const interaction = await f.deletePreset(2);
      const input = state.input;
      return { before, after: f.effectiveValues(), interaction, draft: input.value === state.value && input.selectionStart === state.start && input.selectionEnd === state.end && input.selectionDirection === state.direction, active: f.plugin.settings.activePreset, save: f.calls.save, preview: f.calls.preview };
    });
    assert.deepEqual(result.after, result.before);
    assert.ok(result.draft && result.interaction.stable);
    assert.equal(result.active, 0);
    assert.equal(result.save, 1);
    assert.equal(result.preview, 0);
  });

  await t.test("Preset deletion: removing a preceding preset keeps the same active preset at its shifted index", async (context) => {
    const page = await openPresets(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      await f.applyPreset(2);
      const preset = f.plugin.settings.compilePresets[2];
      const before = f.effectiveValues();
      f.calls.preview = 0;
      f.calls.save = 0;
      const interaction = await f.deletePreset(0);
      const index = f.plugin.settings.activePreset;
      return { before, after: f.effectiveValues(), displayed: f.structureValues(), index, same: f.plugin.settings.compilePresets[index] === preset, names: f.plugin.settings.compilePresets.map((entry) => entry.name), interaction, save: f.calls.save, preview: f.calls.preview };
    });
    assert.equal(result.index, 1);
    assert.ok(result.same && result.interaction.stable);
    assert.deepEqual(result.names, ["Beta", "Gamma"]);
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(result.displayed, result.after);
    assert.equal(result.save, 1);
    assert.equal(result.preview, 0);
  });

  await t.test("Preset deletion: the persistent Add button receives focus without scrolling Structure", async (context) => {
    const page = await openPresets(context);
    const result = await page.evaluate(async () => window.fixture.deletePreset(1));
    assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));
  });

  await t.test("Preset deletion: removing a global active preset leaves an ouvrage composition and its draft independent", async (context) => {
    const page = await openPresets(context, true);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const stored = f.plugin.settings.projectMeta[f.root.path].folderWorkspaces.Volume.ouvrage.composition;
      const snapshot = JSON.stringify(stored);
      const before = f.effectiveValues();
      const state = f.remember(f.structureInputs.separator, "Unfinished local separator");
      const interaction = await f.deletePreset(0);
      const binding = f.api.createCompositionBinding(f.plugin, f.root, f.ouvrage);
      return { before, after: f.effectiveValues(), stored: JSON.stringify(stored) === snapshot && stored === f.plugin.settings.projectMeta[f.root.path].folderWorkspaces.Volume.ouvrage.composition, independent: binding.isOuvrage && !binding.isInherited, draft: state.input.value === state.value && state.input.selectionStart === state.start && state.input.selectionEnd === state.end, interaction, save: f.calls.save, preview: f.calls.preview, active: f.plugin.settings.activePreset };
    });
    assert.deepEqual(result.after, result.before);
    assert.equal(result.after.fileName, "Local manuscript.md");
    assert.ok(result.stored && result.independent && result.draft && result.interaction.stable);
    assert.equal(result.active, -1);
    assert.equal(result.save, 1);
    assert.equal(result.preview, 0);
  });

  await t.test("Front selection: delayed writes invalidate old values before saving can target the new file", async (context) => {
    const page = await openFront(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const process = f.app.fileManager.processFrontMatter;
      let release;
      const gate = new Promise((resolveGate) => { release = resolveGate; });
      f.app.fileManager.processFrontMatter = async (file, update) => { await gate; await process(file, update); };
      f.picker.focus();
      f.selectFront(f.second.path);
      const immediate = f.fields.every((input) => input.disabled && input.value === "") && f.include.disabled;
      f.title.disabled = false;
      f.include.disabled = false;
      const save = f.panel.setFirstPageField(f.second.path, "titre", "Old content forced into second file");
      const include = f.panel.setFirstPageIncluded(false);
      await f.settle();
      const blocked = !(await f.app.vault.read(f.second)).includes("Old content forced") && f.writes.length === 0;
      f.title.disabled = true;
      f.include.disabled = true;
      release();
      await Promise.all([save, include]);
      await f.settle();
      return { immediate, blocked, loaded: f.title.value === "Second title" && !f.title.disabled && !f.include.disabled, stable: f.fields.every((input) => input.isConnected) && f.picker.isConnected && document.activeElement === f.picker };
    });
    assert.ok(Object.values(result).every(Boolean), JSON.stringify(result));
  });

  await t.test("Front selection: A B A requests serialize writes and only the final request loads and notifies", async (context) => {
    const page = await openFront(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      f.selectFront(f.second.path);
      await f.settle();
      f.calls.preview = 0;
      const process = f.app.fileManager.processFrontMatter;
      let release;
      const gate = new Promise((resolveGate) => { release = resolveGate; });
      let active = 0;
      let maximum = 0;
      let calls = 0;
      f.app.fileManager.processFrontMatter = async (file, update) => {
        active++;
        maximum = Math.max(maximum, active);
        if (calls++ === 0) await gate;
        try { await process(file, update); } finally { active--; }
      };
      f.selectFront(f.titleFile.path);
      await f.settle();
      f.selectFront(f.second.path);
      f.selectFront(f.titleFile.path);
      await f.settle();
      const pendingNotifications = f.calls.preview;
      release();
      await f.settle();
      return { maximum, pendingNotifications, notifications: f.calls.preview, picker: f.picker.value, expected: f.titleFile.path, title: f.title.value, inclusions: [f.titleFile, f.second, f.third].map((file) => f.frontmatter.get(file.path).compile), enabled: f.fields.every((input) => !input.disabled), stable: f.fields.every((input) => input.isConnected) };
    });
    assert.equal(result.maximum, 1);
    assert.equal(result.pendingNotifications, 0);
    assert.equal(result.notifications, 1);
    assert.equal(result.picker, result.expected);
    assert.equal(result.title, "Initial title");
    assert.deepEqual(result.inclusions, [true, false, false]);
    assert.ok(result.enabled && result.stable);
  });

  await t.test("Front selection: fresh inclusion reads skip unchanged files despite a stale metadata cache", async (context) => {
    const page = await openFront(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const cache = new Map([...f.frontmatter].map(([path, data]) => [path, { ...data }]));
      f.app.metadataCache.getFileCache = (file) => ({ frontmatter: cache.get(file.path) || {} });
      const third = await f.app.vault.read(f.third);
      f.selectFront(f.second.path);
      await f.settle();
      const firstWrites = [...f.writes];
      f.selectFront(f.titleFile.path);
      await f.settle();
      const secondWrites = f.writes.slice(firstWrites.length);
      const notifications = f.calls.preview;
      f.selectFront(f.titleFile.path);
      await f.settle();
      return { firstWrites, secondWrites, expected: [f.titleFile.path, f.second.path], writes: f.writes.length, notifications: f.calls.preview, before: notifications, thirdUnchanged: third === await f.app.vault.read(f.third), inclusions: [f.titleFile, f.second, f.third].map((file) => f.frontmatter.get(file.path).compile) };
    });
    assert.deepEqual(result.firstWrites, result.expected);
    assert.deepEqual(result.secondWrites, result.expected);
    assert.equal(result.writes, 4);
    assert.equal(result.notifications, result.before);
    assert.deepEqual(result.inclusions, [true, false, false]);
    assert.ok(result.thirdUnchanged);
  });

  await t.test("Front selection: superseded operations never overwrite fields or notify Preview", async (context) => {
    const page = await openFront(context);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const read = f.app.vault.cachedRead;
      let release;
      const gate = new Promise((resolveGate) => { release = resolveGate; });
      f.app.vault.cachedRead = async (file) => { if (file === f.second) await gate; return read(file); };
      f.selectFront(f.second.path);
      await f.settle();
      f.selectFront(f.titleFile.path);
      await f.settle();
      const pendingNotifications = f.calls.preview;
      release();
      await f.settle();
      const notifications = f.calls.preview;
      f.frontmatter.set(f.third.path, { ...f.frontmatter.get(f.third.path), compile: true });
      const process = f.app.fileManager.processFrontMatter;
      const writeGate = new Promise((resolveGate) => { release = resolveGate; });
      f.app.fileManager.processFrontMatter = async (file, update) => { if (file === f.third) await writeGate; await process(file, update); };
      f.calls.preview = 0;
      f.selectFront(f.titleFile.path);
      await f.settle();
      f.selectFront(f.titleFile.path);
      await f.settle();
      const pendingRepairNotifications = f.calls.preview;
      release();
      await f.settle();
      return { pendingNotifications, notifications, pendingRepairNotifications, repairNotifications: f.calls.preview, selected: f.picker.value === f.titleFile.path, title: f.title.value === "Initial title", enabled: !f.title.disabled, inclusions: [f.titleFile, f.second, f.third].map((file) => f.frontmatter.get(file.path).compile) };
    });
    assert.equal(result.pendingNotifications, 0);
    assert.equal(result.notifications, 1);
    assert.equal(result.pendingRepairNotifications, 0);
    assert.equal(result.repairNotifications, 1);
    assert.ok(result.selected && result.title && result.enabled);
    assert.deepEqual(result.inclusions, [true, false, false]);
  });

  await t.test("Front selection: write and read failures prevent wrong-file saves and allow a new selection", async (context) => {
    for (const failure of ["write", "read"]) {
      const page = await openFront(context);
      const result = await page.evaluate(async (failure) => {
        const f = window.fixture;
        const process = f.app.fileManager.processFrontMatter;
        const read = f.app.vault.cachedRead;
        if (failure === "write") f.app.fileManager.processFrontMatter = async (file, update) => { if (file === f.second) throw new Error("Front write failed"); await process(file, update); };
        else f.app.vault.cachedRead = async (file) => { if (file === f.second) throw new Error("Front read failed"); return read(file); };
        f.selectFront(f.second.path);
        await f.settle();
        const failed = f.fields.every((input) => input.disabled && input.value === "") && f.picker.value === "" && !f.picker.disabled && f.calls.preview === 0 && f.notices.length === 1;
        await f.panel.setFirstPageField(f.second.path, "titre", "Forbidden content after failure");
        await f.panel.setFirstPageIncluded(false);
        const protectedContent = !(await f.app.vault.read(f.second)).includes("Forbidden content");
        f.app.fileManager.processFrontMatter = process;
        f.app.vault.cachedRead = read;
        f.selectFront(f.titleFile.path);
        await f.settle();
        return { failed, protectedContent, recovered: !f.title.disabled && f.title.value === "Initial title" && f.picker.value === f.titleFile.path, notifications: f.calls.preview, inclusions: [f.titleFile, f.second].map((file) => f.frontmatter.get(file.path).compile) };
      }, failure);
      assert.ok(result.failed && result.protectedContent && result.recovered, JSON.stringify({ failure, ...result }));
      assert.equal(result.notifications, 1);
      assert.deepEqual(result.inclusions, [true, false]);
    }
  });
});
