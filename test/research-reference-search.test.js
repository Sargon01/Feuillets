import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers";
import { TFile, TFolder, MarkdownView } from "obsidian";
import { ReferenceCitationSettingsModal } from "../src/ui/reference-citation-settings.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";
import { ResearchView } from "../src/views/research-view.js";
import { PreviewView } from "../src/views/preview-view.js";
import { VIEW_PREVIEW } from "../src/constants.js";
import FeuilletsPlugin from "../src/main.js";
import { TextInputModal } from "../src/scenes-editor.js";
import { referenceSourceRecords, referenceBibliographyFile, searchReferenceRecords } from "../src/services/research-reference-search.js";
import { clearBibtexCatalogCache } from "../src/services/bibtex-catalog.js";
import { clearCitekeyAnalysisCache } from "../src/services/citekey-bibliography.js";
import { analyzeResearchCitations } from "../src/services/research-citation-analysis.js";
import { resolveWorkspaceCitationResources } from "../src/services/workspace-citations.js";
import { resolveDocumentCitationStyle } from "../src/services/document-citation-style.js";
import { resolvePandocCitationPreviewForFile } from "../src/services/pandoc-citation-preview.js";
import { t, setLocale, getLocale } from "../src/i18n/index.js";
import { createFakeVault } from "./helpers/fake-vault.js";

class Element {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.text = options.text || "";
    this.classes = new Set((options.cls || "").split(" "));
    this.attrs = new Map(Object.entries(options.attr || {}));
    if (options.type) this.attrs.set("type", options.type);
    if (options.value !== undefined) this.attrs.set("value", options.value);
    this.children = [];
    this.events = new Map();
    this.hidden = false;
    this.value = "";
  }
  createEl(tag, options = {}) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  setText(text) { this.text = String(text); }
  setAttr(name, value) { this.attrs.set(name, String(value)); }
  getAttr(name) { return this.attrs.get(name); }
  addClass(name) { this.classes.add(name); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  empty() { this.children = []; this.text = ""; }
  findAll(cls) { return this.children.flatMap((child) => [...(child.classes.has(cls) ? [child] : []), ...child.findAll(cls)]); }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(" "); }
  click() { if (!this.disabled) this.events.get("click")?.({ stopPropagation() {} }); }
}

function editorFor(file) {
  let cursor = { line: 0, ch: file.content.length };
  const toOffset = (pos) => file.content.split("\n").slice(0, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.ch;
  return {
    getValue: () => file.content,
    getCursor: () => ({ ...cursor }),
    setCursor: (pos) => { cursor = pos; },
    posToOffset: toOffset,
    getLine: (line) => file.content.split("\n")[line],
    lastLine: () => file.content.split("\n").length - 1,
    replaceRange: (text, from, to = from) => {
      const start = toOffset(from);
      file.content = file.content.slice(0, start) + text + file.content.slice(toOffset(to));
      cursor = { line: from.line, ch: from.ch + text.length };
    },
    focus() { this.focused = true; },
  };
}

function fixture({ sources = true, bibtex = true, entries = 2 } = {}) {
  clearBibtexCatalogCache();
  clearCitekeyAnalysisCache();
  const root = new TFolder("Project");
  const research = new TFolder("Project/_Research");
  const sourceFolder = new TFolder("Project/_Research/Sources");
  const source = new TFile("Project/_Research/Sources/Smith archive.md", "");
  source.frontmatter = { creators: ["Smith Archive"], titre: "Archive collection", year: 1921 };
  const scene = new TFile("Project/Scene.md", "Body ");
  const bib = new TFile("Project/_Research/references.bib", Array.from({ length: entries }, (_, index) =>
    `@article{smith${index}, author={Smith, John}, title={Result ${index}}, year={2024}}`).join("\n"));
  const files = [root, research, scene, ...(sources ? [sourceFolder, source] : []), ...(bibtex ? [bib] : [])];
  for (const file of files) {
    file.parent = files.find((parent) => parent instanceof TFolder && parent.path === file.path.split("/").slice(0, -1).join("/")) || null;
    if (file.parent) file.parent.children.push(file);
    if (file instanceof TFile) file.stat = { mtime: 1000, size: file.content.length };
  }
  const { vault, fileManager } = createFakeVault(files);
  fileManager.processFrontMatter = async (file, callback) => { callback(file.frontmatter ||= {}); };
  const reads = [];
  vault.cachedRead = async (file) => { reads.push(file.path); return file.content; };
  const settings = {
    projectFolder: root.path, projectMeta: { [root.path]: {
      researchFolderLinks: { [root.path]: research.path },
      ...(bibtex ? { citekeyBibliographyPath: "references.bib" } : {}),
    } }, collapsed: {}, orders: {},
  };
  let target = { file: scene, editor: editorFor(scene) };
  const app = {
    vault, fileManager,
    workspace: { getActiveFile: () => target?.file || null },
    metadataCache: { getFileCache: (file) => ({ frontmatter: file.frontmatter || {} }) },
  };
  const generated = [];
  const settingsEvents = [];
  const plugin = {
    app, settings,
    getProjectFolder: () => root,
    getWorkspaceFolder: () => null,
    getReferenceCitationTarget: () => target,
    fmOf: (file) => file.frontmatter || {},
    titleFor: (file) => file.frontmatter?.title || file.basename,
    citationStyleFor: () => "footnote",
    saveSettings: async () => { settingsEvents.push("save"); },
    refreshCitationRendering: () => { settingsEvents.push("invalidate"); },
    renderAllViews: (force) => { settingsEvents.push(["refresh", force]); },
    generateBibliographyFile: async (input) => { generated.push(input); },
    quickCiteSource: FeuilletsPlugin.prototype.quickCiteSource,
    insertCitationFor: FeuilletsPlugin.prototype.insertCitationFor,
    recordCitationOccurrence: FeuilletsPlugin.prototype.recordCitationOccurrence,
    markSourceCited: FeuilletsPlugin.prototype.markSourceCited,
  };
  const view = Object.create(BaseFeuilletsView.prototype);
  Object.assign(view, { app, plugin, _renderGen: 1, render: async () => {} });
  const context = { mode: "project", projectRoot: root, scopeRoot: root, workspaceRoot: null, files: [scene] };
  const analysis = { sourceCitationCounts: new Map(), citekeyCounts: new Map() };
  const container = new Element();
  const header = new Element();
  view.renderResearchSubTabs(header, "reference-test", "references");
  let settingsModal;
  const openSettings = () => {
    if (settingsModal?.active) return settingsModal;
    const original = ReferenceCitationSettingsModal.prototype.open;
    ReferenceCitationSettingsModal.prototype.open = function () {
      settingsModal = this;
      this.contentEl = new Element();
      this.modalEl = new Element();
      this.close = () => this.onClose();
      this.onOpen();
    };
    try { header.findAll("feuillets-reference-settings-button")[0].click(); }
    finally { ReferenceCitationSettingsModal.prototype.open = original; }
    return settingsModal;
  };
  const render = () => view.renderReferencesTab(container, context, analysis);
  return { view, app, plugin, settings, root, research, source, scene, bib, reads, context, analysis, container, header, openSettings, generated, settingsEvents, render,
    setTarget: (next) => { target = next; }, getTarget: () => target };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
function inputFor(f) { return f.container.findAll("feuillets-reference-search")[0]; }
function resultsFor(f) { return f.container.findAll("feuillets-reference-result"); }
function settingFor(f, key) { return f.openSettings().contentEl.findAll("feuillets-reference-setting-select").find((select) => select.getAttr("data-citation-setting") === key); }
function optionValues(select) { return select.children.map((option) => option.getAttr("value")); }
async function changeSetting(f, key, value) {
  const modal = f.openSettings();
  if (settingFor(f, key).disabled && !modal.saving) modal.contentEl.findAll("feuillets-reference-settings-inheritance")[0]?.click();
  const select = settingFor(f, key); select.value = value; select.events.get("change")(); await settle(); }
async function rerender(f) { f.container.empty(); f.view._renderGen++; await f.render(); }
async function workspaceFixture() {
  const f = fixture();
  const workspace = await f.app.vault.createFolder("Project/Article");
  const scene = await f.app.vault.create("Project/Article/Scene.md", "Body ");
  await f.app.vault.create("Project/_Research/chicago-notes.csl", "<style/>");
  const meta = f.settings.projectMeta[f.root.path];
  meta.pandocCitationPreviewStyle = "author-date";
  meta.citekeyCslPath = "chicago-notes.csl";
  Object.assign(f.context, { mode: "workspace", scopeRoot: workspace, workspaceRoot: workspace, files: [scene] });
  f.plugin.getWorkspaceFolder = () => workspace;
  f.setTarget({ file: scene, editor: editorFor(scene) });
  return { ...f, workspace, workspaceScene: scene };
}
async function query(f, text) { const input = inputFor(f); input.value = text; input.events.get("input")(); await settle(); }

test("project settings open from the header, keep the sidebar compact, display effective values and persist through the existing project fields", async () => {
  const f = fixture();
  await f.app.vault.create("Project/_Research/chicago-notes.csl", "<style/>");
  const meta = f.settings.projectMeta[f.root.path];
  meta.pandocCitationPreviewStyle = "csl";
  meta.citekeyCslPath = "chicago-notes.csl";
  await f.render();
  assert.equal(f.container.findAll("feuillets-reference-settings").length, 0);
  assert.equal(f.container.findAll("feuillets-reference-warning").length, 0);
  const icon = f.header.findAll("feuillets-reference-settings-button")[0];
  assert.equal(icon.tag, "button");
  assert.equal(icon.getAttr("aria-haspopup"), "dialog");
  assert.equal(icon.getAttr("aria-label"), t("shared.research.bibliographySettings"));
  assert.equal(f.header.findAll("feuillets-research-subtabs")[0].findAll("feuillets-reference-settings-button").length, 0);
  for (const [key, value] of [["pandocCitationPreviewStyle", "csl"], ["citekeyBibliographyPath", "references.bib"], ["citekeyCslPath", "chicago-notes.csl"]]) {
    const select = settingFor(f, key);
    assert.equal(select.tag, "select");
    assert.ok(select.getAttr("aria-label"));
    assert.equal(select.value, value);
    assert.equal(select.getAttr("data-effective-value"), value);
    assert.equal(select.getAttr("data-inherited"), "false");
  }
  await changeSetting(f, "pandocCitationPreviewStyle", "off");
  assert.equal(meta.pandocCitationPreviewStyle, "off");
  assert.equal(meta.folderWorkspaces, undefined);
  assert.deepEqual(f.settingsEvents, ["invalidate", "save", ["refresh", true]]);
});

test("workspace controls show inherited resource names and rendering mode without creating settings", async () => {
  const f = await workspaceFixture();
  const before = structuredClone(f.settings);
  await f.render();
  for (const [key, value] of [["pandocCitationPreviewStyle", "author-date"], ["citekeyBibliographyPath", "references.bib"], ["citekeyCslPath", "chicago-notes.csl"]]) {
    const select = settingFor(f, key);
    assert.equal(select.value, "__effective__");
    assert.equal(select.disabled, true);
    assert.equal(select.getAttr("data-effective-value"), value);
    assert.equal(select.getAttr("data-inherited"), "true");
    assert.ok(optionValues(select).includes("__inherit__"));
    const effective = select.children.find((option) => option.getAttr("value") === "__effective__");
    assert.match(effective.text, new RegExp(t("modal.layout.inherited")));
    assert.equal(effective.disabled, true);
  }
  assert.deepEqual(f.settings, before);
});

for (const [key, value] of [["pandocCitationPreviewStyle", "csl"], ["citekeyBibliographyPath", "alternate.bib"], ["citekeyCslPath", "alternate.csl"]]) {
  test(`workspace override and reset preserve project and unrelated workspace settings: ${key}`, async () => {
    const f = await workspaceFixture();
    await f.app.vault.create("Project/_Research/alternate.bib", "@article{alternate,title={Alternate}}");
    await f.app.vault.create("Project/_Research/alternate.csl", "<style/>");
    const meta = f.settings.projectMeta[f.root.path];
    meta.folderWorkspaces = { Other: { version: 1, citekeyBibliographyPath: "unrelated.bib" } };
    const before = structuredClone(meta);
    await f.render();
    await changeSetting(f, key, value);
    assert.equal(meta.folderWorkspaces.Article[key], value);
    assert.deepEqual({ ...meta, folderWorkspaces: before.folderWorkspaces }, before);
    assert.deepEqual(meta.folderWorkspaces.Other, before.folderWorkspaces.Other);
    await rerender(f);
    assert.equal(settingFor(f, key).value, value);
    assert.equal(settingFor(f, key).getAttr("data-inherited"), "false");
    await changeSetting(f, key, "__inherit__");
    assert.deepEqual(meta, before);
    await rerender(f);
    assert.equal(settingFor(f, key).value, "__effective__");
    assert.equal(settingFor(f, key).getAttr("data-inherited"), "true");
    assert.deepEqual(f.settingsEvents, ["invalidate", "save", ["refresh", true], "invalidate", "save", ["refresh", true]]);
  });
}

test("rendering inheritance follows the nearest workspace and updates file and composed settings together", async () => {
  const f = await workspaceFixture();
  const nested = await f.app.vault.createFolder("Project/Article/Chapter");
  const scene = await f.app.vault.create("Project/Article/Chapter/Scene.md", "Body ");
  f.settings.projectMeta[f.root.path].folderWorkspaces = { Article: { version: 1, pandocCitationPreviewStyle: "csl" } };
  Object.assign(f.context, { scopeRoot: nested, workspaceRoot: nested, files: [scene] });
  f.plugin.getWorkspaceFolder = () => nested;
  f.setTarget({ file: scene, editor: editorFor(scene) });
  await f.render();
  assert.equal(settingFor(f, "pandocCitationPreviewStyle").getAttr("data-effective-value"), "csl");
  assert.match(settingFor(f, "pandocCitationPreviewStyle").getAttr("title"), /Article/);
  assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, scene).style, "csl");
  assert.equal(resolveDocumentCitationStyle(f.settings, f.root.path, nested.path), "csl");
  await changeSetting(f, "pandocCitationPreviewStyle", "off");
  assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, scene).style, "off");
  assert.equal(resolveDocumentCitationStyle(f.settings, f.root.path, nested.path), "off");
  assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.scene).style, "author-date");
});

test("citation candidates use the associated research only, filter extensions and include nested files", async () => {
  const f = await workspaceFixture();
  const local = await f.app.vault.createFolder("LocalResearch");
  await f.app.vault.createFolder("LocalResearch/Nested");
  await f.app.vault.create("LocalResearch/Nested/local.bib", "");
  await f.app.vault.create("LocalResearch/local.CSL", "<style/>");
  await f.app.vault.create("LocalResearch/not-a-bibliography.md", "");
  await f.app.vault.createFolder("ForeignResearch");
  await f.app.vault.create("ForeignResearch/foreign.bib", "");
  await f.app.vault.create("ForeignResearch/foreign.csl", "");
  f.settings.projectMeta[f.root.path].researchFolderLinks[f.workspace.path] = local.path;
  const before = structuredClone(f.settings.projectMeta[f.root.path]);
  await f.render();
  assert.deepEqual(optionValues(settingFor(f, "citekeyBibliographyPath")), ["__inherit__", "", "Nested/local.bib", "__effective__"]);
  assert.deepEqual(optionValues(settingFor(f, "citekeyCslPath")), ["__inherit__", "", "local.CSL", "__effective__"]);
  assert.equal(settingFor(f, "citekeyBibliographyPath").getAttr("data-effective-value"), "references.bib", "Inherited resource retains its owning Research folder");
  await changeSetting(f, "citekeyBibliographyPath", "Nested/local.bib");
  assert.equal(f.settings.projectMeta[f.root.path].folderWorkspaces.Article.citekeyBibliographyPath, "Nested/local.bib");
  const projectFields = structuredClone(f.settings.projectMeta[f.root.path]);
  delete projectFields.folderWorkspaces;
  assert.deepEqual(projectFields, before);
  assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.workspaceScene).bibliographyPath, "LocalResearch/Nested/local.bib");
});

test("CSL selection never enables Native CSL and project bibliography selection clears only the legacy project alias", async () => {
  const f = fixture();
  const meta = f.settings.projectMeta[f.root.path];
  meta.pandocCitationPreviewStyle = "author-date";
  meta.pandocBibliographyPath = "legacy.bib";
  await f.app.vault.create("Project/_Research/new.csl", "<style/>");
  await f.app.vault.create("Project/_Research/new.bib", "@article{new,title={New}}");
  await f.render();
  await changeSetting(f, "citekeyCslPath", "new.csl");
  assert.equal(meta.pandocCitationPreviewStyle, "author-date");
  assert.equal(meta.pandocBibliographyPath, "legacy.bib");
  await rerender(f);
  await changeSetting(f, "citekeyBibliographyPath", "new.bib");
  assert.equal(meta.citekeyBibliographyPath, "new.bib");
  assert.equal(meta.pandocBibliographyPath, undefined);
});

test("Source-only controls work without bibliography or CSL files and reset keeps unrelated workspace configuration", async () => {
  const f = fixture({ bibtex: false });
  await f.render();
  for (const key of ["citekeyBibliographyPath", "citekeyCslPath"]) {
    assert.deepEqual(optionValues(settingFor(f, key)), ["__inherit__", "", "__effective__"]);
    assert.equal(settingFor(f, key).getAttr("data-effective-value"), "");
  }
  await changeSetting(f, "pandocCitationPreviewStyle", "csl");
  await rerender(f);
  await query(f, "smith");
  assert.equal(resultsFor(f).length, 1);
  let source;
  f.plugin.quickCiteSource = (file) => { source = file; };
  resultsFor(f)[0].findAll("feuillets-reference-cite")[0].click();
  assert.equal(source, f.source);
  const w = await workspaceFixture();
  w.settings.projectMeta[w.root.path].folderWorkspaces = { Article: { version: 1, wordGoal: 1500, citekeyCslPath: "" } };
  await w.render();
  await changeSetting(w, "citekeyCslPath", "__inherit__");
  assert.deepEqual(w.settings.projectMeta[w.root.path].folderWorkspaces.Article, { version: 1, wordGoal: 1500 });
});

test("stale controls and forged foreign candidates cannot change citation configuration", async () => {
  for (const change of ["workspace", "project", "closed", "foreign candidate"]) {
    const f = await workspaceFixture();
    await f.render();
    f.openSettings().contentEl.findAll("feuillets-reference-settings-inheritance")[0].click();
    const before = structuredClone(f.settings);
    if (change === "workspace") f.plugin.getWorkspaceFolder = () => new TFolder("Project/Other");
    if (change === "project") f.plugin.getProjectFolder = () => new TFolder("Elsewhere");
    if (change === "closed") {
      const select = settingFor(f, "citekeyBibliographyPath");
      f.openSettings().onClose();
      select.value = "references.bib";
      select.events.get("change")();
      await settle();
      assert.deepEqual(f.settings, before);
      continue;
    }
    await changeSetting(f, "citekeyBibliographyPath", change === "foreign candidate" ? "foreign.bib" : "references.bib");
    assert.deepEqual(f.settings, before);
    assert.deepEqual(f.settingsEvents, []);
  }
});

test("non-isolated project aggregation uses the active workspace's CSL context without editing project settings", async () => {
  const f = await workspaceFixture();
  const meta = f.settings.projectMeta[f.root.path];
  await f.app.vault.create("Project/_Research/local.bib", "@article{local,title={Local}}");
  meta.folderWorkspaces = { Article: { version: 1, pandocCitationPreviewStyle: "csl", citekeyBibliographyPath: "local.bib", citekeyCslPath: "chicago-notes.csl" } };
  Object.assign(f.context, { mode: "project", scopeRoot: f.root, workspaceRoot: null });
  f.plugin.getWorkspaceFolder = () => null;
  f.analysis.citekeyCounts.set("local", 1);
  await f.render();
  const resolved = resolvePandocCitationPreviewForFile(f.app, f.settings, f.workspaceScene);
  assert.equal(settingFor(f, "pandocCitationPreviewStyle").value, resolved.style);
  assert.equal(settingFor(f, "citekeyBibliographyPath").getAttr("data-effective-value"), "local.bib");
  assert.equal(settingFor(f, "citekeyCslPath").getAttr("data-effective-value"), "chicago-notes.csl");
  assert.equal(referenceBibliographyFile(f.app, f.settings, f.context, f.workspaceScene).path, resolved.bibliographyPath);
  assert.equal(f.container.findAll("feuillets-reference-warning").length, 0);
  assert.match(f.container.findAll("feuillets-reference-cited")[0].textContent, /Local/);
  await query(f, "local");
  assert.equal(resultsFor(f).length, 1);
  resultsFor(f)[0].findAll("feuillets-reference-cite")[0].click();
  assert.equal(f.workspaceScene.content, "Body [@local]");
  await changeSetting(f, "pandocCitationPreviewStyle", "off");
  assert.equal(meta.pandocCitationPreviewStyle, "author-date");
  assert.equal(meta.folderWorkspaces.Article.pandocCitationPreviewStyle, "off");
});

test("existing citation refresh invalidates the host and refreshes open Preview surfaces", () => {
  const events = [];
  const preview = Object.create(PreviewView.prototype);
  preview.refreshPreview = async () => { events.push("preview"); };
  const plugin = {
    cslCitationHost: { invalidateAllResources: () => { events.push("host"); } },
    app: { workspace: { getLeavesOfType: (type) => { assert.equal(type, VIEW_PREVIEW); return [{ view: preview }, { view: {} }]; } } },
  };
  FeuilletsPlugin.prototype.refreshCitationRendering.call(plugin);
  assert.deepEqual(events, ["host", "preview"]);
});

for (const [name, options] of [["Source only", { bibtex: false }], ["BibTeX only", { sources: false }], ["mixed", {}], ["neither", { sources: false, bibtex: false }]]) {
  test(`References always has accessible search: ${name}`, async () => {
    const f = fixture(options);
    await f.render();
    const input = inputFor(f);
    assert.equal(input.tag, "input");
    assert.equal(input.getAttr("aria-label"), t("shared.research.searchReferences"));
    assert.equal(input.getAttr("placeholder"), t("shared.research.searchReferences"));
    assert.equal(f.container.findAll("feuillets-footnotes-overview").length, 0);
    assert.equal(resultsFor(f).length, 0);
  });
}

test("Source-only search uses ZotFlow-compatible metadata and excludes attachments", async () => {
  const f = fixture({ bibtex: false });
  const attachment = new TFile(`${f.source.parent.path}/attachment.pdf`, "binary");
  f.source.parent.children.push(attachment);
  await f.render();
  for (const term of ["smith", "collection", "1921", "archive"]) {
    await query(f, term);
    assert.equal(resultsFor(f).length, 1);
    assert.match(resultsFor(f)[0].textContent, /Smith Archive.*Archive collection.*Source/);
  }
  await query(f, "attachment");
  assert.equal(resultsFor(f).length, 0);
  assert.match(f.container.textContent, new RegExp(t("shared.research.noMatchingReference")));
  assert.deepEqual(f.reads, []);
});

for (const style of ["footnote", "parenthetical"]) {
  for (const origin of ["search result", "cited row"]) {
    test(`Source ${origin} preserves ${style}, page prompt, repeat behavior and real registry/bookkeeping`, async () => {
      const f = fixture({ bibtex: false });
      f.plugin.citationStyleFor = () => style;
      if (origin === "cited row") f.analysis.sourceCitationCounts.set(f.source.path, 1);
      await f.render();
      if (origin === "search result") await query(f, "smith");
      const button = f.container.findAll("feuillets-reference-cite")[0];
      assert.equal(button.tag, "button");
      assert.ok(button.getAttr("title"));
      assert.ok(button.getAttr("aria-label"));
      const original = TextInputModal.prototype.open;
      let prompts = 0;
      TextInputModal.prototype.open = function () { prompts++; void this.onSubmit({ page: "42" }); };
      try { button.click(); await settle(); button.click(); await settle(); } finally { TextInputModal.prototype.open = original; }
      assert.equal(prompts, 2);
      assert.match(f.scene.content, /42/);
      assert.match(f.scene.content, /[Ii]bid/);
      assert.equal(f.source.frontmatter.cite_count, 2);
      assert.doesNotMatch(f.scene.content, /\[@/);
      if (style === "footnote") assert.match(f.scene.content, /\[\^1\]/);
      else assert.doesNotMatch(f.scene.content, /\[\^/);
      const analysis = await analyzeResearchCitations(f.app, f.settings, f.context);
      assert.equal(analysis.sourceCitationCounts.get(f.source.path), 2);
      f.container.empty();
      Object.assign(f.analysis, analysis);
      f.view._renderGen++;
      await f.render();
      const generate = f.container.findAll("feuillets-bibliography-export-row")[0];
      assert.ok(generate);
      generate.click();
      assert.deepEqual(f.generated[0].sourceFiles, [f.source]);
      assert.deepEqual(f.generated[0].bibtexEntries, []);
    });
  }
}

for (const [configuration, options] of [["Source only", { bibtex: false }], ["BibTeX only", { sources: false }], ["mixed", {}]]) {
  test(`valid cited rows expose accessible Cite actions: ${configuration}`, async () => {
    const f = fixture(options);
    if (options.sources !== false) f.analysis.sourceCitationCounts.set(f.source.path, 3);
    if (options.bibtex !== false) f.analysis.citekeyCounts.set("smith1", 2);
    f.analysis.citekeyCounts.set("unknown", 1);
    await f.render();
    const cited = f.container.findAll("feuillets-reference-cited")[0];
    const buttons = cited.findAll("feuillets-reference-cite");
    assert.equal(buttons.length, configuration === "mixed" ? 2 : 1);
    for (const button of buttons) {
      assert.equal(button.tag, "button");
      assert.equal(button.getAttr("type"), "button");
      assert.equal(button.disabled, false);
      assert.equal(button.text, t("shared.research.cite"));
      assert.ok(button.getAttr("aria-label"));
      assert.ok(button.getAttr("title"));
    }
    const warnings = cited.findAll("feuillets-bibtex-unknown-item");
    assert.equal(warnings.length, options.bibtex === false ? 0 : 1);
    for (const warning of warnings) assert.equal(warning.findAll("feuillets-reference-cite").length, 0);
    let sourceCall;
    f.plugin.quickCiteSource = (file, target) => { sourceCall = { file, target }; };
    if (options.sources !== false) {
      let stopped = false;
      buttons[0].events.get("click")({ stopPropagation: () => { stopped = true; } });
      assert.equal(stopped, true, "Cite must not open the Source row");
      assert.deepEqual(sourceCall, { file: f.source, target: f.getTarget() });
      assert.equal(f.view.viewingFile, undefined);
      assert.match(cited.textContent, /3/);
    }
    if (options.bibtex !== false) {
      f.getTarget().editor.setCursor({ line: 0, ch: 2 });
      buttons.at(-1).click();
      assert.equal(f.scene.content, "Bo[@smith1]dy ");
      assert.equal(f.getTarget().editor.focused, true);
      assert.match(cited.textContent, /2/);
    }
    assert.equal(resultsFor(f).length, 0);
  });
}

test("cited actions fail cleanly without an editor or after the insertion context changes", async () => {
  for (const change of ["missing editor", "different editor", "different workspace"]) {
    const f = fixture();
    f.analysis.sourceCitationCounts.set(f.source.path, 1);
    f.analysis.citekeyCounts.set("smith0", 1);
    if (change === "missing editor") f.setTarget(null);
    await f.render();
    let sourceCalls = 0;
    f.plugin.quickCiteSource = () => { sourceCalls++; };
    const buttons = f.container.findAll("feuillets-reference-cited")[0].findAll("feuillets-reference-cite");
    assert.equal(buttons.length, 2);
    if (change === "different editor") f.setTarget({ file: f.scene, editor: editorFor(f.scene) });
    if (change === "different workspace") f.plugin.getWorkspaceFolder = () => new TFolder("Project/Other");
    for (const button of buttons) {
      if (change === "missing editor") {
        assert.equal(button.disabled, true);
        assert.equal(button.getAttr("title"), t("main.notice.openSceneBeforeCitation"));
      }
      button.click();
    }
    assert.equal(sourceCalls, 0);
    assert.equal(f.scene.content, "Body ");
  }
});

test("BibTeX search supports citekey, author, title and year without re-reading the file", async () => {
  const f = fixture({ sources: false });
  await f.render();
  for (const [term, count] of [["smith1", 1], ["smith", 2], ["result 0", 1], ["2024", 2]]) {
    await query(f, term);
    assert.equal(resultsFor(f).length, count);
  }
  assert.deepEqual(f.reads, [f.bib.path]);
});

test("BibTeX Cite inserts Pandoc syntax at the current cursor and focuses the editor", async () => {
  const f = fixture({ sources: false });
  await f.render();
  await query(f, "smith1");
  f.getTarget().editor.setCursor({ line: 0, ch: 2 });
  f.container.findAll("feuillets-reference-cite")[0].click();
  assert.equal(f.scene.content, "Bo[@smith1]dy ");
  assert.equal(f.getTarget().editor.focused, true);
});

test("mixed results keep Source and BibTeX paths independent even with the same search term", async () => {
  const f = fixture();
  await f.render();
  await query(f, "smith");
  assert.equal(resultsFor(f).length, 3);
  let chosen;
  f.plugin.quickCiteSource = (file, target) => { chosen = { file, target }; };
  resultsFor(f)[0].findAll("feuillets-reference-cite")[0].click();
  assert.equal(chosen.file, f.source);
  assert.equal(chosen.target, f.getTarget());
  resultsFor(f)[1].findAll("feuillets-reference-cite")[0].click();
  assert.equal(f.scene.content, "Body [@smith0]");
  assert.equal(f.source.frontmatter.cite_count, undefined);
});

test("1,000-entry catalogue creates no blank-query result rows and at most 30 search rows", async () => {
  const f = fixture({ sources: false, entries: 1000 });
  await f.render();
  assert.equal(resultsFor(f).length, 0);
  assert.equal(f.reads.length, 1, "the existing cited-list collector can warm the catalogue cache without creating rows");
  await query(f, "smith");
  assert.equal(resultsFor(f).length, 30);
  await query(f, "result 999");
  assert.equal(resultsFor(f).length, 1);
  assert.equal(f.reads.length, 1);
});

test("clearing search restores the same cited list and scoped bibliography snapshot, including unknown keys", async () => {
  const f = fixture();
  f.analysis.sourceCitationCounts.set(f.source.path, 2);
  f.analysis.citekeyCounts = new Map([["smith0", 3], ["unknown", 1]]);
  await f.render();
  const cited = f.container.findAll("feuillets-reference-cited")[0];
  assert.match(cited.textContent, new RegExp(t("shared.research.citedReferences")));
  assert.match(cited.textContent, /unknown/);
  const generate = cited.findAll("feuillets-bibliography-export-row")[0];
  const citeButtons = cited.findAll("feuillets-reference-cite");
  assert.equal(citeButtons.length, 2);
  await query(f, "smith");
  assert.equal(cited.hidden, true);
  await query(f, "");
  assert.equal(cited.hidden, false);
  assert.equal(resultsFor(f).length, 0);
  assert.equal(cited.findAll("feuillets-bibliography-export-row")[0], generate);
  assert.deepEqual(cited.findAll("feuillets-reference-cite"), citeButtons);
  citeButtons[1].click();
  assert.equal(f.scene.content, "Body [@smith0]");
  generate.click();
  assert.deepEqual(f.generated[0].sourceFiles, [f.source]);
  assert.equal(f.generated[0].bibtexEntries.length, 1);
  assert.equal(f.generated[0].bibtexEntries[0].title, "Result 0");
  assert.equal(f.generated[0].projectRoot, f.root);
});

test("BibTeX-only cited references still generate a bibliography", async () => {
  const f = fixture({ sources: false });
  f.analysis.citekeyCounts.set("smith1", 1);
  await f.render();
  f.container.findAll("feuillets-bibliography-export-row")[0].click();
  assert.deepEqual(f.generated[0].sourceFiles, []);
  assert.equal(f.generated[0].bibtexEntries[0].title, "Result 1");
});

test("no configured references is a compact empty state, never a BibTeX error", async () => {
  const f = fixture({ sources: false, bibtex: false });
  await f.render();
  assert.match(f.container.textContent, new RegExp(t("shared.research.noReferenceSources")));
  await query(f, "smith");
  assert.equal(resultsFor(f).length, 0);
  assert.equal(f.reads.length, 0);
});

test("isolated Workspace search excludes another branch's Source and bibliography", async () => {
  const f = fixture();
  const branch = await f.app.vault.createFolder("Project/Branch");
  const other = await f.app.vault.createFolder("Project/Branch-Extra");
  const scene = await f.app.vault.create(`${branch.path}/Scene.md`, "Body ");
  const external = await f.app.vault.createFolder("BranchResearch");
  await f.app.vault.createFolder("BranchResearch/Sources");
  const source = await f.app.vault.create("BranchResearch/Sources/Local.md", "");
  source.frontmatter = { author: "Local Scholar", title: "Local archive" };
  const bib = await f.app.vault.create("BranchResearch/local.bib", "@article{localKey, author={Local Scholar}, title={Local result}, year={2020}}");
  const foreign = await f.app.vault.createFolder("ForeignResearch");
  await f.app.vault.createFolder("ForeignResearch/Sources");
  const foreignSource = await f.app.vault.create("ForeignResearch/Sources/Foreign.md", "");
  foreignSource.frontmatter = { author: "Local Foreign Scholar" };
  await f.app.vault.create("ForeignResearch/foreign.bib", "@article{foreignKey, title={Local foreign work}}");
  const meta = f.settings.projectMeta[f.root.path];
  meta.researchFolderLinks[branch.path] = external.path;
  meta.researchFolderLinks[other.path] = foreign.path;
  meta.folderWorkspaces = { Branch: { citekeyBibliographyPath: "local.bib" }, "Branch-Extra": { citekeyBibliographyPath: "foreign.bib" } };
  Object.assign(f.context, { mode: "workspace", scopeRoot: branch, workspaceRoot: branch, files: [scene] });
  f.plugin.getWorkspaceFolder = () => branch;
  f.setTarget({ file: scene, editor: editorFor(scene) });
  f.analysis.sourceCitationCounts.set(source.path, 1);
  f.analysis.citekeyCounts = new Map([["localKey", 2], ["foreignKey", 1]]);
  assert.equal(referenceBibliographyFile(f.app, f.settings, f.context, f.scene), bib, "out-of-scope editor falls back to the displayed workspace");
  await f.render();
  const cited = f.container.findAll("feuillets-reference-cited")[0];
  assert.equal(cited.findAll("feuillets-reference-cite").length, 2);
  assert.equal(cited.findAll("feuillets-bibtex-unknown-item")[0].findAll("feuillets-reference-cite").length, 0);
  let sourceChosen;
  f.plugin.quickCiteSource = (file) => { sourceChosen = file; };
  cited.findAll("feuillets-reference-cite")[0].click();
  assert.equal(sourceChosen, source);
  cited.findAll("feuillets-reference-cite")[1].click();
  assert.equal(scene.content, "Body [@localKey]");
  await query(f, "local");
  assert.equal(resultsFor(f).length, 2);
  assert.doesNotMatch(f.container.findAll("feuillets-reference-results")[0].textContent, /Foreign|foreign/);
  assert.deepEqual(f.reads, [bib.path]);
});

test("old asynchronous search cannot replace a newer query", async () => {
  const f = fixture({ sources: false });
  let release;
  await f.render();
  clearBibtexCatalogCache();
  f.app.vault.cachedRead = () => new Promise((resolve) => { release = resolve; });
  await query(f, "smith0");
  await query(f, "smith1");
  release(f.bib.content);
  await settle();
  assert.equal(resultsFor(f).length, 1);
  assert.match(resultsFor(f)[0].textContent, /smith1/);
  assert.doesNotMatch(resultsFor(f)[0].textContent, /smith0/);
});

for (const change of ["clear", "file", "scope", "render", "bibliography", "sources"]) {
  test(`pending search fails closed after ${change} changes`, async () => {
    const f = fixture({ sources: false });
    let release;
    await f.render();
    clearBibtexCatalogCache();
    f.app.vault.cachedRead = () => new Promise((resolve) => { release = resolve; });
    await query(f, "smith");
    if (change === "clear") await query(f, "");
    if (change === "file") f.setTarget({ file: new TFile("Elsewhere.md"), editor: {} });
    if (change === "scope") f.plugin.getWorkspaceFolder = () => new TFolder("Project/Other");
    if (change === "render") f.view._renderGen++;
    if (change === "bibliography") f.bib.stat.mtime++;
    if (change === "sources") await f.app.vault.createFolder("Project/_Research/Sources");
    release(f.bib.content);
    await settle();
    assert.equal(resultsFor(f).length, 0);
  });
}

test("changing editor after search cannot insert a result in the wrong document", async () => {
  const f = fixture({ sources: false });
  await f.render();
  await query(f, "smith");
  const button = f.container.findAll("feuillets-reference-cite")[0];
  f.setTarget({ file: new TFile("Elsewhere.md"), editor: {} });
  button.click();
  assert.equal(f.scene.content, "Body ");
});

test("both origins together remain capped at 30 and blank queries never enumerate records", () => {
  const f = fixture();
  const source = referenceSourceRecords(f.app, f.settings, f.context, f.plugin.fmOf)[0];
  const sources = Array.from({ length: 100 }, () => source);
  const entries = Array.from({ length: 100 }, (_, index) => ({ key: `smith${index}`, authors: ["Smith"], title: "Smith", year: "2024" }));
  assert.equal(searchReferenceRecords(sources, entries, "smith").length, 30);
  assert.equal(searchReferenceRecords(sources, entries, "smith").filter((record) => record.kind === "source").length, 15);
  assert.deepEqual(searchReferenceRecords(sources, entries, " "), []);
});

test("search strings are localized in English and French", async () => {
  const locale = getLocale();
  try {
    for (const [language, expected] of [["en", "Search references…"], ["fr", "Rechercher une référence…"]]) {
      setLocale(language);
      const f = fixture();
      await f.render();
      assert.equal(inputFor(f).getAttr("aria-label"), expected);
    }
  } finally { setLocale(locale); }
});

test("reference controls use theme variables and narrow-sidebar layout in both themes", async () => {
  const css = await readFile(new URL("../../styles.css", import.meta.url), "utf8");
  const rules = css.match(/\.feuillets-reference-search \{[^}]+\}|\.feuillets-reference-details \{[^}]+\}|\.feuillets-reference-origin \{[^}]+\}/g).join("\n");
  assert.match(rules, /width: 100%/);
  assert.match(rules, /min-width: 0/);
  assert.match(rules, /var\(--background-primary\)/);
  assert.match(rules, /var\(--text-normal\)/);
  assert.match(rules, /var\(--text-muted\)/);
  assert.doesNotMatch(rules, /!important|:has\(|#[0-9a-f]{3,6}/i);
});

test("sidebar target retrieval pairs the remembered Markdown editor with its file", () => {
  const file = new TFile("Project/Scene.md", "Body");
  const view = Object.create(MarkdownView.prototype);
  Object.assign(view, { file, editor: editorFor(file) });
  const plugin = { app: { workspace: { activeEditor: null, getActiveViewOfType: () => null, getMostRecentLeaf: () => null } }, _lastMarkdownLeaf: { view } };
  assert.deepEqual(FeuilletsPlugin.prototype.getReferenceCitationTarget.call(plugin), { file, editor: view.editor });
});

test("unrelated Markdown and BibTeX modifications do not rebuild the References panel", async () => {
  const f = fixture();
  await f.render();
  const scheduled = [];
  const listeners = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout: (callback) => { scheduled.push(callback); return 1; }, clearTimeout() {} };
  const view = Object.create(ResearchView.prototype);
  Object.assign(view, { app: f.app, plugin: f.plugin, researchActiveSubTab: "references", referenceRefreshPaths: f.view.referenceRefreshPaths, registerEvent() {} });
  f.app.workspace.on = (event, callback) => { listeners.set(`workspace:${event}`, callback); };
  f.app.vault.on = (event, callback) => { listeners.set(`vault:${event}`, callback); };
  let renders = 0;
  view.render = async () => { renders++; };
  try {
    view.setupBibliographyLifecycleListeners();
    const modify = listeners.get("vault:modify");
    modify(new TFile("Unrelated/Notes.md"));
    modify(new TFile("Unrelated/references.bib"));
    assert.equal(scheduled.length, 0);
    for (const file of [f.scene, f.source, f.bib]) modify(file);
    assert.equal(scheduled.length, 3);
    scheduled.at(-1)();
    assert.equal(renders, 1);
  } finally { globalThis.window = previousWindow; }
});

test("search and Cite buttons fit a narrow sidebar and support keyboard use in light and dark themes", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const f = fixture({ entries: 1000 });
    const cslName = "Chicago Notes and Bibliography with a long descriptive filename.csl";
    await f.app.vault.create(`Project/_Research/${cslName}`, "<style/>");
    f.settings.projectMeta[f.root.path].citekeyCslPath = cslName;
    f.analysis.sourceCitationCounts.set(f.source.path, 3);
    f.analysis.citekeyCounts.set("smith0", 2);
    await f.render();
    const serialize = (element) => ({
      tag: element.tag, text: element.text, classes: [...element.classes].join(" "),
      attrs: Object.fromEntries(element.attrs), hidden: element.hidden, disabled: Boolean(element.disabled), value: element.value,
      children: element.children.map(serialize),
    });
    const citedTree = serialize(f.container);
    citedTree.children.unshift(serialize(f.header));
    await query(f, "smith");
    const searchTree = serialize(f.container);
    searchTree.children.unshift(serialize(f.header));
    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await page.setContent('<div id="sidebar" class="feuillets-research-container" style="width:240px"></div>');
    await page.addStyleTag({ content: await readFile(new URL("../../styles.css", import.meta.url), "utf8") });
    await page.addStyleTag({ content: `
      :root { --size-4-1:4px; --size-4-2:8px; --size-4-3:12px; --font-ui-small:12px; --font-ui-smaller:11px; --radius-s:4px; }
      .theme-light { --background-primary:white; --text-normal:black; --text-muted:gray; --background-modifier-border:gray; }
      .theme-dark { --background-primary:black; --text-normal:white; --text-muted:silver; --background-modifier-border:gray; }
    ` });
    const backgrounds = [];
    for (const [mode, tree] of [["cited", citedTree], ["search", searchTree]]) {
      await page.evaluate((tree) => {
        const build = (data) => {
          const element = document.createElement(data.tag);
          element.textContent = data.text;
          element.className = data.classes;
          for (const [key, value] of Object.entries(data.attrs)) element.setAttribute(key, value);
          element.hidden = data.hidden;
          if (["button", "select", "option"].includes(data.tag)) element.disabled = data.disabled;
          for (const child of data.children) element.appendChild(build(child));
          if (data.tag === "select") element.value = data.value;
          return element;
        };
        const sidebar = document.getElementById("sidebar");
        sidebar.replaceChildren(build(tree));
        sidebar.dataset.clicks = "0";
        sidebar.querySelectorAll(".feuillets-reference-cite").forEach((button) => button.addEventListener("click", () => {
          sidebar.dataset.clicks = String(Number(sidebar.dataset.clicks) + 1);
        }));
      }, tree);
      for (const theme of ["theme-light", "theme-dark"]) {
        await page.evaluate((className) => { document.body.className = className; }, theme);
        const layout = await page.evaluate((mode) => {
          const sidebar = document.getElementById("sidebar");
          const input = sidebar.querySelector(".feuillets-reference-search");
          const first = sidebar.querySelector(`.${mode === "cited" ? "feuillets-reference-cited" : "feuillets-reference-results"} .feuillets-reference-cite`);
          return {
            width: sidebar.clientWidth, scroll: sidebar.scrollWidth,
            inputWidth: input.getBoundingClientRect().width,
            buttonRight: first.getBoundingClientRect().right - sidebar.getBoundingClientRect().left,
            background: getComputedStyle(input).backgroundColor,
            count: sidebar.querySelectorAll(".feuillets-reference-result").length,
            controls: Array.from(sidebar.querySelectorAll(".feuillets-reference-setting-select")).map((select) => ({
              right: select.getBoundingClientRect().right - sidebar.getBoundingClientRect().left,
              height: select.getBoundingClientRect().height,
              label: select.getAttribute("aria-label"),
              background: getComputedStyle(select).backgroundColor,
            })),
          };
        }, mode);
        assert.equal(layout.count, mode === "search" ? 30 : 0);
        assert.equal(layout.scroll, layout.width);
        assert.ok(layout.inputWidth <= 240 && layout.buttonRight <= 240);
        assert.equal(layout.controls.length, 0);
        await page.locator(".feuillets-reference-settings-button").focus();
        assert.equal(await page.locator(".feuillets-reference-settings-button").getAttribute("aria-haspopup"), "dialog");
        backgrounds.push(layout.background);
        await page.locator(".feuillets-reference-search").focus();
        await page.keyboard.press("Tab");
        if (mode === "cited") await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains("feuillets-reference-cite")), true);
        await page.keyboard.press("Enter");
      }
      assert.equal(await page.locator("#sidebar").getAttribute("data-clicks"), "2");
    }
    assert.notEqual(backgrounds[0], backgrounds[1]);
    const modal = f.openSettings();
    const modalTree = serialize(modal.contentEl);
    await page.setViewportSize({ width: 264, height: 900 });
    await page.evaluate((tree) => {
      const build = (data) => {
        const element = document.createElement(data.tag);
        element.textContent = data.text;
        element.className = data.classes;
        for (const [key, value] of Object.entries(data.attrs)) element.setAttribute(key, value);
        if (["button", "select", "option"].includes(data.tag)) element.disabled = data.disabled;
        for (const child of data.children) element.appendChild(build(child));
        if (data.tag === "select") element.value = data.value;
        return element;
      };
      const dialog = document.createElement("div");
      dialog.id = "settings-dialog";
      dialog.className = "modal feuillets-reference-settings-modal";
      dialog.setAttribute("role", "dialog");
      dialog.appendChild(build(tree));
      document.body.replaceChildren(dialog);
    }, modalTree);
    const dialogBackgrounds = [];
    for (const theme of ["theme-light", "theme-dark"]) {
      await page.evaluate((className) => { document.body.className = className; }, theme);
      const layout = await page.evaluate(() => {
        const dialog = document.getElementById("settings-dialog");
        return { width: dialog.clientWidth, scroll: dialog.scrollWidth, controls: [...dialog.querySelectorAll("select")].map((select) => ({
          right: select.getBoundingClientRect().right - dialog.getBoundingClientRect().left,
          height: select.getBoundingClientRect().height,
          label: select.getAttribute("aria-label"), background: getComputedStyle(select).backgroundColor,
        })) };
      });
      assert.equal(layout.width, 240);
      assert.equal(layout.scroll, layout.width);
      assert.equal(layout.controls.length, 3);
      for (const control of layout.controls) {
        assert.ok(control.right <= 240 && control.height <= 26);
        assert.ok(control.label);
      }
      dialogBackgrounds.push(layout.controls[0].background);
      await page.locator("select").first().focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("data-citation-setting")), "citekeyBibliographyPath");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("data-citation-setting")), "citekeyCslPath");
    }
    assert.notEqual(dialogBackgrounds[0], dialogBackgrounds[1]);
  } finally { await browser.close(); }
});

test("workspace customization is explicit and opening/enabling it never copies inherited project values", async () => {
  const f = await workspaceFixture();
  await f.render();
  const before = structuredClone(f.settings);
  const modal = f.openSettings();
  assert.match(modal.contentEl.textContent, new RegExp(t("shared.research.citationWorkspaceScope", { name: "Article" }).replace(/[()]/g, "\\$&")));
  assert.equal(modal.contentEl.findAll("feuillets-reference-setting-select").every((select) => select.disabled), true);
  const action = modal.contentEl.findAll("feuillets-reference-settings-inheritance")[0];
  assert.equal(action.text, t("shared.research.citationUseSpecific"));
  action.click();
  assert.deepEqual(f.settings, before);
  assert.deepEqual(f.settingsEvents, []);
  assert.equal(modal.contentEl.findAll("feuillets-reference-setting-select").some((select) => select.disabled), false);
  await changeSetting(f, "citekeyCslPath", "");
  assert.deepEqual(f.settings.projectMeta[f.root.path].folderWorkspaces.Article, { version: 1, citekeyCslPath: "" });
  assert.equal(settingFor(f, "citekeyBibliographyPath").getAttr("data-inherited"), "true");
  assert.equal(settingFor(f, "pandocCitationPreviewStyle").getAttr("data-inherited"), "true");
});

test("return to inherited settings deletes all local citation fields and preserves the workspace's other configuration", async () => {
  const f = await workspaceFixture();
  const meta = f.settings.projectMeta[f.root.path];
  meta.folderWorkspaces = { Article: { version: 1, wordGoal: 1200, pandocCitationPreviewStyle: "off", citekeyBibliographyPath: "", citekeyCslPath: "" } };
  await f.render();
  const modal = f.openSettings();
  assert.equal(settingFor(f, "pandocCitationPreviewStyle").getAttr("data-effective-value"), "off");
  assert.equal(settingFor(f, "citekeyBibliographyPath").getAttr("data-effective-value"), "");
  assert.equal(f.container.findAll("feuillets-reference-warning").length, 0);
  const action = modal.contentEl.findAll("feuillets-reference-settings-inheritance")[0];
  assert.equal(action.text, t("shared.research.citationReturnInherited"));
  action.click();
  await settle();
  assert.deepEqual(meta.folderWorkspaces.Article, { version: 1, wordGoal: 1200 });
  assert.equal(meta.pandocCitationPreviewStyle, "author-date");
  assert.equal(meta.citekeyBibliographyPath, "references.bib");
  assert.equal(meta.citekeyCslPath, "chicago-notes.csl");
  assert.equal(settingFor(f, "citekeyBibliographyPath").getAttr("data-effective-value"), "references.bib");
  assert.equal(settingFor(f, "citekeyBibliographyPath").disabled, true);
});

test("modal stays usable through References refresh and writes independent fields through existing invalidation", async () => {
  const f = await workspaceFixture();
  await f.render();
  const modal = f.openSettings();
  await changeSetting(f, "pandocCitationPreviewStyle", "csl");
  await rerender(f);
  assert.equal(f.openSettings(), modal);
  await changeSetting(f, "citekeyCslPath", "");
  assert.deepEqual(f.settings.projectMeta[f.root.path].folderWorkspaces.Article, { version: 1, pandocCitationPreviewStyle: "csl", citekeyCslPath: "" });
  assert.deepEqual(f.settingsEvents, ["invalidate", "save", ["refresh", true], "invalidate", "save", ["refresh", true]]);
});

test("an active-file context change while a settings modal is open cannot write to the previous workspace", async () => {
  const f = await workspaceFixture();
  await f.render();
  f.openSettings().contentEl.findAll("feuillets-reference-settings-inheritance")[0].click();
  const select = settingFor(f, "pandocCitationPreviewStyle");
  const before = structuredClone(f.settings);
  f.setTarget({ file: f.scene, editor: editorFor(f.scene) });
  select.value = "csl";
  select.events.get("change")();
  await settle();
  assert.deepEqual(f.settings, before);
  assert.deepEqual(f.settingsEvents, []);
});

test("isolated References settings ignore an out-of-scope editor and retain the displayed workspace", async () => {
  const f = await workspaceFixture();
  const meta = f.settings.projectMeta[f.root.path];
  meta.folderWorkspaces = { Article: { version: 1, pandocCitationPreviewStyle: "off" } };
  f.setTarget({ file: f.scene, editor: editorFor(f.scene) });
  await f.render();
  assert.equal(settingFor(f, "pandocCitationPreviewStyle").getAttr("data-effective-value"), "off");
  await changeSetting(f, "pandocCitationPreviewStyle", "csl");
  assert.equal(meta.folderWorkspaces.Article.pandocCitationPreviewStyle, "csl");
  assert.equal(meta.pandocCitationPreviewStyle, "author-date");
  await query(f, "smith");
  assert.equal(resultsFor(f).every((row) => row.findAll("feuillets-reference-cite")[0].disabled), true);
});

test("parent workspace resource inheritance matches the active renderer and returning to inheritance never copies values", async () => {
  const f = await workspaceFixture();
  const nested = await f.app.vault.createFolder("Project/Article/Section");
  const scene = await f.app.vault.create("Project/Article/Section/Scene.md", "Body ");
  const local = await f.app.vault.createFolder("ArticleResearch");
  await f.app.vault.create("ArticleResearch/article.bib", "@article{article,title={Article}}");
  await f.app.vault.create("ArticleResearch/article.csl", "<style/>");
  const meta = f.settings.projectMeta[f.root.path];
  meta.researchFolderLinks[f.workspace.path] = local.path;
  meta.folderWorkspaces = { Article: { version: 1, pandocCitationPreviewStyle: "csl", citekeyBibliographyPath: "article.bib", citekeyCslPath: "article.csl" } };
  const before = structuredClone(meta);
  Object.assign(f.context, { files: [scene], scopeRoot: nested, workspaceRoot: nested });
  f.plugin.getWorkspaceFolder = () => nested;
  f.setTarget({ file: scene, editor: editorFor(scene) });
  await f.render();
  const resolved = resolvePandocCitationPreviewForFile(f.app, f.settings, scene);
  for (const [field, value] of [["pandocCitationPreviewStyle", resolved.style], ["citekeyBibliographyPath", "article.bib"], ["citekeyCslPath", "article.csl"]]) {
    assert.equal(settingFor(f, field).getAttr("data-effective-value"), value);
    assert.match(settingFor(f, field).getAttr("title"), /Article/);
  }
  assert.equal(resolved.bibliographyPath, "ArticleResearch/article.bib");
  assert.equal(resolveWorkspaceCitationResources(f.app, f.settings, f.root, scene).csl.file.path, "ArticleResearch/article.csl");
  assert.equal(f.container.findAll("feuillets-reference-warning").length, 0);
  await changeSetting(f, "citekeyBibliographyPath", "");
  assert.equal(meta.folderWorkspaces["Article/Section"].citekeyBibliographyPath, "");
  await changeSetting(f, "citekeyBibliographyPath", "__inherit__");
  assert.deepEqual(meta, before);
});

test("direct-file Research associations display the same effective resources as CSL rendering", async () => {
  const f = fixture();
  const local = await f.app.vault.createFolder("FileResearch");
  await f.app.vault.create("FileResearch/file.bib", "@article{file,title={File}}");
  await f.app.vault.create("FileResearch/file.csl", "<style/>");
  const meta = f.settings.projectMeta[f.root.path];
  meta.researchFolderLinks = { [f.scene.path]: local.path };
  meta.citekeyBibliographyPath = "file.bib";
  meta.citekeyCslPath = "file.csl";
  meta.pandocCitationPreviewStyle = "csl";
  await f.render();
  const resolved = resolvePandocCitationPreviewForFile(f.app, f.settings, f.scene);
  assert.equal(resolved.bibliographyPath, "FileResearch/file.bib");
  assert.equal(resolveWorkspaceCitationResources(f.app, f.settings, f.root, f.scene).csl.file.path, "FileResearch/file.csl");
  assert.equal(settingFor(f, "citekeyBibliographyPath").getAttr("data-effective-value"), "file.bib");
  assert.equal(settingFor(f, "citekeyCslPath").getAttr("data-effective-value"), "file.csl");
  assert.equal(f.container.findAll("feuillets-reference-warning").length, 0);
});

test("References only shows compact resource warnings for a rendering mode that needs missing resources", async () => {
  const f = fixture({ bibtex: false });
  await f.render();
  assert.equal(f.container.findAll("feuillets-reference-warning").length, 0);
  assert.equal(f.container.findAll("feuillets-reference-settings").length, 0);
  await changeSetting(f, "pandocCitationPreviewStyle", "author-date");
  await rerender(f);
  assert.deepEqual(f.container.findAll("feuillets-reference-warning").map((row) => row.text), [t("shared.research.citationBibliographyMissing")]);
  await changeSetting(f, "pandocCitationPreviewStyle", "csl");
  await rerender(f);
  assert.deepEqual(f.container.findAll("feuillets-reference-warning").map((row) => row.text), [t("shared.research.citationBibliographyMissing"), t("shared.research.citationStyleMissing")]);
  await query(f, "smith");
  assert.equal(resultsFor(f).length, 1);
});
