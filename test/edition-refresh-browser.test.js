import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Edition automatic refresh preserves mounted interactions", async (t) => {
  const bundle = await build({
    stdin: { contents: `export { default as FeuilletsPlugin } from "./src/main.ts";
      export { SidebarFeuilletsView } from "./src/views/sidebar-feuillets-view.ts";
      export { PreviewView } from "./src/views/preview-view.ts";
      export { EditionWorkspaceContent } from "./src/ui/edition-workspace-content.ts";
      export { ExportPanel } from "./src/ui/export-panel.ts";
      export { DEFAULT_SETTINGS } from "./src/default-settings.ts";
      export * from "./src/constants.ts";
      export { t } from "./src/i18n/index.ts";
      export { createFakeVault } from "./test/helpers/fake-vault.ts";
      export { resolveExportTemplateV2 } from "./src/services/export-templates-custom.ts";
      export { registerOuvrage } from "./src/services/editorial-roots.ts";
      export { createCompositionBinding } from "./src/services/ouvrage-composition.ts";
      export { createProjectScope, createFolderScope } from "./src/services/compile-scope.ts";
      export { getEditionRoot } from "./src/services/folder-structure.ts";
      export { TFile, TFolder, Menu } from "obsidian";`, resolveDir: resolve(".") },
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
      const frontmatter = new Map([[titleFile.path, { type: "titre", compile: true }]]);
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
      window.fixture = { api, app, plugin, sidebar, container, calls, root, otherRoot, ouvrage, secondOuvrage, chapter, chapterFile, previewView, workspaceContent, titleFile, externalFile, listeners, emit, writes, navigate, settle, remember, preserved };
    }, { editionPage, withPreview });
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
      return { preserved: f.preserved(state), root: f.plugin.editorialRootForComposition().path, expectedRoot: f.ouvrage.path, renders: f.calls.sidebar - renders, scope: f.previewView.compileScope };
    });
    assert.equal(result.root, result.expectedRoot);
    assert.equal(result.scope.type, "folder");
    assert.ok(Object.values(result.preserved).every(Boolean), JSON.stringify(result.preserved));
    assert.equal(result.renders, 0);
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
});
