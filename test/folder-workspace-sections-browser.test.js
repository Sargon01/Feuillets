import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { chromium } from "playwright";

for (const dark of [false, true]) {
test(`workspace sections: keyboard, reference geometry and scrolling (${dark ? "dark" : "light"})`, async (context) => {
  const bundle = await build({
    stdin: { contents: `export { FolderWorkspaceModal } from "./ui/folder-workspace-modal.ts";
      export { ReferenceCitationSettingsModal } from "./ui/reference-citation-settings.ts";
      export { TFile, TFolder } from "obsidian";
      export { createFakeVault } from "../test/helpers/fake-vault.js";`, resolveDir: resolve("src") },
    bundle: true, write: false, format: "iife", globalName: "WorkspaceSectionsTest",
    external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
    plugins: [{ name: "obsidian-test-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 600, height: 420 } });
  await page.addStyleTag({ content: `:root { --size-4-1: 4px; --size-4-2: 8px; --size-4-3: 12px; --size-4-4: 16px;
    --icon-s: 16px; --font-ui-small: 13px; --text-muted: #666; --text-normal: #222;
    --interactive-accent: #6951d9; --background-modifier-border: #ddd; --font-interface: sans-serif;
    --font-ui-smaller: 12px; --text-faint: #777; --background-primary: white; }
    body { font: 14px sans-serif; background: var(--background-primary); color: var(--text-normal); }
    .setting-item { display: flex; align-items: center; gap: 12px; padding: 18px 0; border-top: 1px solid var(--background-modifier-border); }
    .setting-item-info { flex: 1; min-width: 0; }
    .setting-item-control { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
    .setting-item-description { font-size: 12px; color: var(--text-muted); }
    .extra-setting-button { display: block; width: 16px; height: 16px; }
    .checkbox-container { width: 40px; height: 20px; border-radius: 10px; background: var(--text-muted); }
    button, select, input { font: inherit; }` });
  await page.addStyleTag({ content: await readFile("styles.css", "utf8") });
  if (dark) await page.addStyleTag({ content: `:root { --background-primary: #222; --text-normal: #ddd;
    --text-muted: #aaa; --text-faint: #999; --background-modifier-border: #444; }` });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const initial = await page.evaluate(() => {
    const make = (tag, options = {}, parent) => {
      const element = document.createElement(tag);
      if (options.cls) element.className = options.cls;
      if (options.text) element.textContent = options.text;
      if (options.value !== undefined) element.value = options.value;
      if (options.type) element.type = options.type;
      for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
      parent?.appendChild(element); return element;
    };
    HTMLElement.prototype.createEl = function (tag, options) { return make(tag, options, this); };
    HTMLElement.prototype.createDiv = function (options) { return this.createEl("div", options); };
    HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
    HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
    HTMLElement.prototype.toggleClass = function (name, value) { this.classList.toggle(name, value); };
    HTMLElement.prototype.setText = function (text) { this.textContent = text; };
    HTMLElement.prototype.setAttr = function (key, value) { this.setAttribute(key, value); };
    HTMLElement.prototype.empty = function () { this.replaceChildren(); };
    const api = window.WorkspaceSectionsTest;
    const root = new api.TFolder("Project"); const folder = new api.TFolder("Project/Article");
    const file = new api.TFile("Project/Article/Scene.md", "*Original*  \n");
    const research = new api.TFolder("Research");
    const longName = "Bibliographical-resource-with-a-very-long-name-".repeat(6);
    const bib = new api.TFile(`Research/${longName}.bib`); const csl = new api.TFile(`Research/${longName}.csl`);
    root.children = [folder]; folder.parent = root; folder.children = [file]; file.parent = folder;
    research.children = [bib, csl]; bib.parent = research; csl.parent = research;
    const { vault } = api.createFakeVault([root, folder, file, research, bib, csl]);
    const settings = { projectFolder: root.path, projectMeta: { Project: { type: "fiction",
      citekeyBibliographyPath: bib.name, citekeyCslPath: csl.name, pandocCitationPreviewStyle: "author-date",
      researchFolderLinks: { [root.path]: research.path }, folderWorkspaces: {
        Article: { version: 1, workspaceRoot: true, ouvrage: { version: 1 },
          statuses: [{ name: "Draft", color: "#123456" }, { name: "Final", color: "#654321" }],
          labels: [{ name: "Scene", color: "#123456" }, { name: "Other", color: "#654321" }],
          citekeyBibliographyPath: bib.name, citekeyCslPath: csl.name, pandocCitationPreviewStyle: "author-date" },
      } } } };
    const calls = { save: 0, render: 0, citations: 0 };
    const plugin = { settings, getProjectFolder: () => root,
      saveSettings: async () => { calls.save++; }, renderAllViews: () => { calls.render++; },
      refreshCitationRendering: () => { calls.citations++; } };
    const modal = new api.FolderWorkspaceModal({ vault }, plugin, folder);
    modal.contentEl = make("div", {}, document.body);
    Object.assign(modal.contentEl.style, { width: "520px", maxHeight: "300px", overflowY: "auto" });
    modal.onOpen();
    window.workspaceFixture = { modal, settings, calls, file, snapshot: JSON.stringify(settings),
      references: modal.citationControls, bibliography: modal.contentEl.querySelector('[data-citation-setting="citekeyBibliographyPath"]') };
    return Array.from(modal.contentEl.querySelectorAll(".feuillets-workspace-section"), (section) => {
      const header = section.querySelector("button"); const content = document.getElementById(header.getAttribute("aria-controls"));
      return { key: section.dataset.workspaceSection, expanded: header.getAttribute("aria-expanded"),
        hidden: content.hidden, type: header.type, width: getComputedStyle(header).width,
        chevron: section.querySelector("svg").getAttribute("data-icon") };
    });
  });
  assert.deepEqual(initial.map(({ key, expanded, hidden }) => [key, expanded, hidden]), [
    ["views", "false", true],
    ["workflow", "false", true], ["goals", "false", true], ["typography", "false", true], ["references", "false", true],
  ]);
  for (const entry of initial) {
    assert.equal(entry.type, "button"); assert.equal(entry.width, "520px");
    assert.equal(entry.chevron, entry.hidden ? "chevron-right" : "chevron-down");
  }
  const essentials = page.locator(".feuillets-workspace-essentials");
  assert.equal(await essentials.locator(".setting-item").count(), 4);
  for (const control of await essentials.locator(".checkbox-container, select, button").all()) assert.equal(await control.isVisible(), true);
  const compact = await page.evaluate(() => {
    const content = window.workspaceFixture.modal.contentEl;
    const sections = Array.from(content.querySelectorAll(".feuillets-workspace-section"));
    return { headers: sections.map((section) => section.querySelector("button").getBoundingClientRect().height),
      essentialBorders: Array.from(content.querySelectorAll(".feuillets-workspace-essentials > .setting-item"),
        (row) => getComputedStyle(row).borderTopWidth),
      extraHeaders: content.querySelectorAll(".feuillets-workspace-essentials .feuillets-workspace-section-toggle").length };
  });
  assert.deepEqual(compact.headers, [40, 40, 40, 40, 40]);
  assert.deepEqual(compact.essentialBorders, ["0px", "0px", "0px", "0px"]);
  assert.equal(compact.extraHeaders, 0);
  await page.screenshot({ path: `/private/tmp/feuillets-workspace-compact-${dark ? "dark" : "light"}.png` });
  const header = (key) => page.locator(`[data-workspace-section="${key}"] > button`);
  const goals = page.locator('[data-workspace-section="goals"] input');
  assert.equal(await goals.first().isVisible(), false);
  await header("goals").focus(); await page.keyboard.press("Tab");
  assert.equal(await header("typography").evaluate((element) => element === document.activeElement), true,
    "Tab skips fields hidden inside the collapsed Goals section");
  await page.keyboard.press("Enter");
  assert.equal(await header("typography").getAttribute("aria-expanded"), "true");
  await header("goals").focus(); await page.keyboard.press("Space");
  assert.equal(await header("goals").getAttribute("aria-expanded"), "true");
  assert.equal(await goals.first().isVisible(), true);
  await header("typography").focus(); await page.keyboard.press("Space");
  assert.equal(await header("typography").getAttribute("aria-expanded"), "false");
  assert.equal(await header("goals").getAttribute("aria-expanded"), "true");
  await header("references").click();
  await header("references").click();
  const folded = await page.evaluate(() => {
    const f = window.workspaceFixture;
    return { calls: f.calls, settingsUnchanged: f.snapshot === JSON.stringify(f.settings),
      mounted: f.references === f.modal.citationControls && f.references.active
        && f.bibliography === f.modal.contentEl.querySelector('[data-citation-setting="citekeyBibliographyPath"]'),
      source: f.file.content };
  });
  assert.deepEqual(folded, { calls: { save: 0, render: 0, citations: 0 }, settingsUnchanged: true, mounted: true, source: "*Original*  \n" });
  await header("references").click();
  const geometry = await page.evaluate(() => {
    const f = window.workspaceFixture;
    const inspect = (container) => {
      const rows = Array.from(container.querySelectorAll(".feuillets-reference-setting"));
      return rows.map((row) => {
        const label = row.querySelector(".feuillets-reference-setting-label").getBoundingClientRect();
        const selectEl = row.querySelector("select"); const select = selectEl.getBoundingClientRect();
        const source = row.querySelector(".feuillets-reference-setting-source").getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        return { labelX: label.x, labelBottom: label.bottom, selectX: select.x, selectY: select.y,
          sourceX: source.x, sourceY: source.y, selectBottom: select.bottom,
          selectHeight: select.height,
          fits: select.right <= bounds.right + 1 && row.scrollWidth <= row.clientWidth + 1,
          title: selectEl.title, value: selectEl.value };
      });
    };
    const autonomous = new window.WorkspaceSectionsTest.ReferenceCitationSettingsModal(f.modal.app, f.modal.plugin,
      { projectRoot: f.modal.plugin.getProjectFolder(), scopeRoot: f.modal.folder, targetScope: f.modal.folder }, () => true);
    autonomous.modalEl = document.createElement("div"); document.body.appendChild(autonomous.modalEl);
    autonomous.contentEl = autonomous.modalEl.createDiv(); autonomous.onOpen();
    const result = { wide: inspect(f.modal.contentEl), narrow: inspect(autonomous.contentEl),
      noOverflow: f.modal.contentEl.scrollWidth <= f.modal.contentEl.clientWidth,
      shared: f.modal.citationControls.constructor === autonomous.controls.constructor,
      savedPath: f.settings.projectMeta.Project.folderWorkspaces.Article.citekeyBibliographyPath };
    autonomous.onClose(); autonomous.modalEl.remove(); return result;
  });
  assert.equal(geometry.shared, true); assert.equal(geometry.noOverflow, true);
  assert.equal(geometry.wide.length, 3); assert.equal(geometry.narrow.length, 3);
  assert.equal(new Set(geometry.wide.map((row) => row.labelX)).size, 1);
  assert.equal(new Set(geometry.wide.map((row) => row.selectX)).size, 1);
  for (const row of geometry.wide) {
    assert.ok(row.selectX > row.labelX); assert.equal(row.sourceX, row.selectX);
    assert.ok(row.sourceY >= row.selectBottom); assert.equal(row.fits, true);
  }
  for (const row of geometry.narrow) {
    assert.equal(row.selectX, row.labelX); assert.ok(row.selectY >= row.labelBottom);
    assert.equal(row.sourceX, row.selectX); assert.equal(row.fits, true);
    assert.ok(row.selectHeight <= 26, "Autonomous References keeps its original compact control height");
  }
  assert.equal(geometry.wide[1].value, geometry.savedPath);
  assert.ok(geometry.wide[1].title.startsWith(geometry.savedPath), "Tooltip preserves the complete resource path");
  const references = page.locator('[data-workspace-section="references"]');
  const selectBounds = () => references.locator("select").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  const originalWidths = await selectBounds();
  await references.locator(".feuillets-reference-settings-inheritance").click();
  for (const select of await references.locator("select").all()) assert.equal(await select.isDisabled(), true);
  const beforeCustomize = await page.evaluate(() => {
    const f = window.workspaceFixture;
    return { settings: JSON.stringify(f.settings), saves: f.calls.save };
  });
  await references.locator(".feuillets-reference-settings-inheritance").click();
  for (const select of await references.locator("select").all()) assert.equal(await select.isDisabled(), false);
  assert.deepEqual(await selectBounds(), originalWidths, "Customization retains column widths");
  assert.deepEqual(await page.evaluate(() => {
    const f = window.workspaceFixture;
    return { settings: JSON.stringify(f.settings), saves: f.calls.save };
  }), beforeCustomize, "Making inherited controls editable does not save preferences");
  const modeSelect = references.locator('[data-citation-setting="pandocCitationPreviewStyle"]');
  await modeSelect.focus();
  await modeSelect.evaluate((element) => { window.referenceModeNode = element; });
  await page.keyboard.press("Tab");
  assert.equal(await references.locator('[data-citation-setting="citekeyBibliographyPath"]').evaluate((element) => element === document.activeElement), true);
  await modeSelect.focus();
  await modeSelect.selectOption("csl");
  assert.equal(await modeSelect.inputValue(), "csl");
  assert.equal(await modeSelect.evaluate((element) => element === window.referenceModeNode && element.isConnected && element === document.activeElement), true);
  assert.equal(await header("references").getAttribute("aria-expanded"), "true");
  assert.equal(await references.locator(".feuillets-reference-companion-notice .setting-item-description").isVisible(), true);
  assert.equal(await references.locator(".feuillets-reference-warning").isVisible(), true,
    "Unavailable CSL companion remains a visible functional warning");
  await page.evaluate(async () => {
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const content = window.workspaceFixture.modal.contentEl; content.scrollTop = content.scrollHeight;
  });
  await page.screenshot({ path: `/private/tmp/feuillets-workspace-references-${dark ? "dark" : "light"}.png` });
  await header("references").click();
  await header("workflow").click(); await header("typography").click();
  await page.evaluate(() => {
    const f = window.workspaceFixture;
    f.pending = []; f.persisted = null; f.activeWrites = 0; f.maxWrites = 0;
    f.originalSave = f.modal.plugin.saveSettings;
    f.modal.plugin.saveSettings = () => {
      f.calls.save++; f.activeWrites++; f.maxWrites = Math.max(f.maxWrites, f.activeWrites);
      const snapshot = JSON.stringify(f.settings);
      return new Promise((resolveSave) => f.pending.push(() => { f.activeWrites--; f.persisted = snapshot; resolveSave(); }));
    };
  });
  for (const [kind, text] of [["status", "Revised draft"], ["label", "Opening scene"]]) {
    const list = page.locator(`.feuillets-workspace-${kind}-list`);
    const name = list.locator('input[type="text"]').first();
    await name.focus(); await name.fill("");
    await name.evaluate((element) => { window.editedNameNode = element; });
    for (const [index, character] of Array.from(text).entries()) {
      await page.keyboard.type(character);
      assert.deepEqual(await name.evaluate((element) => ({ connected: element.isConnected,
        same: element === window.editedNameNode, focused: element === document.activeElement,
        start: element.selectionStart, end: element.selectionEnd })),
      { connected: true, same: true, focused: true, start: index + 1, end: index + 1 });
    }
    await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Shift+ArrowLeft");
    const selection = await name.evaluate((element) => [element.selectionStart, element.selectionEnd]);
    assert.deepEqual(selection, [text.length - 2, text.length - 1]);
    const color = list.locator('input[type="color"]').first();
    await color.focus(); await color.evaluate((element) => { window.editedColorNode = element; });
    for (const value of ["#112233", "#223344", "#abcdef"]) {
      await color.evaluate((element, next) => { element.value = next; element.dispatchEvent(new Event("change", { bubbles: true })); }, value);
      assert.equal(await color.evaluate((element) => element === window.editedColorNode && element.isConnected && element === document.activeElement), true);
      assert.equal(await header("workflow").getAttribute("aria-expanded"), "true");
      assert.equal(await header("typography").getAttribute("aria-expanded"), "true");
    }
    await page.getByRole("button", { name: kind === "status" ? "Add a status" : "Add a label", exact: true }).click();
    assert.equal(await list.locator(".setting-item").count(), 3);
    assert.equal(await color.evaluate((element) => element === window.editedColorNode), true, "Adding preserves existing rows");
    await list.locator(".setting-item").last().locator(".extra-setting-button").click();
    assert.equal(await list.locator(".setting-item").count(), 2);
    assert.equal(await color.evaluate((element) => element === window.editedColorNode), true, "Deleting preserves other rows");
  }
  const typographyNumber = page.locator('[data-workspace-section="typography"] input[type="text"]').first();
  await typographyNumber.focus(); await typographyNumber.fill("18");
  await typographyNumber.evaluate((element) => { window.typographyNode = element; element.setSelectionRange(1, 2); });
  await page.evaluate(async () => {
    const f = window.workspaceFixture;
    for (let step = 0; step < 300; step++) {
      f.pending.shift()?.(); await Promise.resolve();
    }
    f.modal.plugin.saveSettings = f.originalSave;
  });
  assert.deepEqual(await typographyNumber.evaluate((element) => ({ same: element === window.typographyNode,
    connected: element.isConnected, focused: element === document.activeElement,
    selection: [element.selectionStart, element.selectionEnd] })),
  { same: true, connected: true, focused: true, selection: [1, 2] });
  assert.deepEqual(await page.evaluate(() => {
    const f = window.workspaceFixture; const config = f.settings.projectMeta.Project.folderWorkspaces.Article;
    return { ordered: f.maxWrites === 1, persisted: f.persisted === JSON.stringify(f.settings),
      statuses: config.statuses, labels: config.labels };
  }), { ordered: true, persisted: true,
    statuses: [{ name: "Revised draft", color: "#abcdef" }, { name: "Final", color: "#654321" }],
    labels: [{ name: "Opening scene", color: "#abcdef" }, { name: "Other", color: "#654321" }] });
  assert.equal(await header("workflow").getAttribute("aria-expanded"), "true");
  assert.equal(await header("typography").getAttribute("aria-expanded"), "true");
  await goals.first().focus(); await goals.first().fill("3456");
  assert.equal(await goals.first().evaluate((element) => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.workspaceFixture.settings.projectMeta.Project.folderWorkspaces.Article.wordGoal), 3456);
  const preset = page.locator('.feuillets-workspace-essentials select');
  await preset.selectOption("fiction");
  assert.equal(await header("goals").getAttribute("aria-expanded"), "true");
  assert.equal(await header("typography").getAttribute("aria-expanded"), "true");
  assert.equal(await header("workflow").getAttribute("aria-expanded"), "true");
  assert.equal(await header("references").getAttribute("aria-expanded"), "false");
  for (const key of ["views", "references"]) await header(key).click();
  const scrolling = await page.evaluate(() => {
    const f = window.workspaceFixture; const content = f.modal.contentEl;
    const result = { width: content.getBoundingClientRect().width, height: content.clientHeight,
      scrolls: content.scrollHeight > content.clientHeight, source: f.file.content };
    f.modal.onClose(); return result;
  });
  assert.deepEqual(scrolling, { width: 520, height: 300, scrolls: true, source: "*Original*  \n" });
});
}
