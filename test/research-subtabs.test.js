import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ResearchView } from "../src/views/research-view.js";
import FeuilletsPlugin from "../src/main.js";
import { t, getLocale, setLocale } from "../src/i18n/index.js";
import { RESEARCH_FOLDERS, researchFolderLabel, researchFolderNewName } from "../src/utils/project-modes.js";
import { NewResearchFileModal } from "../src/ui/basic-modals.js";
import { clearCitekeyAnalysisCache } from "../src/services/citekey-bibliography.js";
import { registerDeclaredWorkspaceRoot } from "../src/services/folder-workspaces.js";
import { referenceSourceFolders, referenceBibliographyFile } from "../src/services/research-reference-search.js";
import { resolveWorkspaceCitationResources } from "../src/services/workspace-citations.js";
import { resolveDocumentCitationStyleSetting } from "../src/services/document-citation-style.js";

/** Bypasses NewResearchFileModal's real DOM (the shared Modal test stub's
 * contentEl, not this file's own FakeElement — see research-view.test.js's
 * identically-named helper) and invokes its onSubmit callback directly with
 * `submittedName`, for the duration of `fn`. */
function withSimulatedResearchFileSubmit(submittedName, fn) {
  const original = NewResearchFileModal.prototype.open;
  NewResearchFileModal.prototype.open = function () {
    void this.onSubmit(submittedName);
  };
  try {
    return fn();
  } finally {
    NewResearchFileModal.prototype.open = original;
  }
}

/* The Research panel separates physical organization from computed
   references. Dossiers includes the real Sources folder and linked research
   trees without scanning document content. References provides search, Source
   creation and cited references, without duplicating Inspector footnotes. */

class FakeElement {
  constructor(options = {}) {
    this.parent = null;
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
    this.value = "";
    this.attrs = new Map();
  }

  addClass(className) {
    for (const part of String(className).split(/\s+/)) {
      if (part) this.classes.add(part);
    }
  }

  removeClass(className) {
    for (const part of String(className).split(/\s+/)) {
      this.classes.delete(part);
    }
  }

  empty() {
    this.children = [];
  }

  createDiv(options = {}) {
    const child = new FakeElement(options);
    child.parent = this;
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.parent = this;
    child.tag = tag;
    if (options.cls) child.addClass(options.cls);
    for (const [name, value] of Object.entries(options.attr || {})) child.setAttr(name, value);
    this.children.push(child);
    return child;
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  find(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    for (const child of this.children) {
      if (className && child.classes.has(className)) return child;
      const nested = child.find(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    const results = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (className && child.classes.has(className)) results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  setText(text) {
    this.text = String(text);
  }

  setAttr(name, value) {
    this.attrs.set(name, value);
  }

  getAttr(name) {
    return this.attrs.get(name);
  }

  addEventListener(type, callback) {
    this.events ||= new Map();
    this.events.set(type, callback);
  }

  dispatchClick() {
    // A minimal fake MouseEvent: some real click handlers (the "+" create
    // button wired by renderCollapsibleHead, utils/dom.ts) call
    // `e.stopPropagation()` on it — harmless no-op for every other
    // listener here, which never reads its argument at all.
    this.events?.get("click")?.({ stopPropagation() {}, preventDefault() {} });
  }

  focus() {}
  select() {}
  setSelectionRange() {}

  contains() {
    return false;
  }

  get textContent() {
    return (this.text || "") + this.children.map((c) => c.textContent).join(" ");
  }
}

function makeFixture({ includeSources = true } = {}) {
  const projectRoot = new TFolder("PROJECT");
  const researchRoot = new TFolder("PROJECT/RESEARCH");
  const personnagesFolder = new TFolder("PROJECT/RESEARCH/Personnages");
  const hero = new TFile("PROJECT/RESEARCH/Personnages/Hero.md", "---\ntitle: \"\"\n---\n");
  const sourcesFolder = new TFolder("PROJECT/RESEARCH/Sources");
  const existingSourceNote = new TFile("PROJECT/RESEARCH/Sources/Existing.md", "---\ntitle: \"\"\n---\n");

  const workA = new TFolder("PROJECT/Work-A");
  const sceneA = new TFile("PROJECT/Work-A/Scene.md", "Body[^a] citing [@knuth1968].\n\n[^a]: Footnote A");
  workA.children = [sceneA];
  sceneA.parent = workA;
  const workAResearch = new TFolder("PROJECT/Work-A-Research");
  const workANote = new TFile("PROJECT/Work-A-Research/Note.md", "---\ntitle: \"\"\n---\n");
  workAResearch.children = [workANote];
  workANote.parent = workAResearch;

  const workAExtra = new TFolder("PROJECT/Work-A-Extra");
  const sceneAExtra = new TFile("PROJECT/Work-A-Extra/Scene.md", "Extra body, nothing special.");
  workAExtra.children = [sceneAExtra];
  sceneAExtra.parent = workAExtra;
  const workAExtraResearch = new TFolder("PROJECT/Work-A-Extra-Research");
  const workAExtraNote = new TFile("PROJECT/Work-A-Extra-Research/Note.md", "---\ntitle: \"\"\n---\n");
  workAExtraResearch.children = [workAExtraNote];
  workAExtraNote.parent = workAExtraResearch;

  const bibFile = new TFile(
    "PROJECT/RESEARCH/refs.bib",
    "@article{knuth1968,\n  author = {Knuth, Donald},\n  title = {Fundamental Algorithms},\n  year = {1968}\n}"
  );
  bibFile.extension = "bib";

  clearCitekeyAnalysisCache();
  for (const file of [hero, existingSourceNote, sceneA, sceneAExtra, workANote, workAExtraNote]) {
    Object.defineProperty(file, "stat", {
      get() {
        return { mtime: this._mtime || 1000, size: (this.content || "").length };
      },
      set(val) {
        this._mtime = val?.mtime || 1000;
      },
      configurable: true,
    });
    file.extension = "md";
  }
  bibFile.stat = { mtime: 1000, size: bibFile.content.length };

  researchRoot.children = includeSources ? [personnagesFolder, sourcesFolder, bibFile] : [personnagesFolder, bibFile];
  personnagesFolder.parent = researchRoot;
  personnagesFolder.children = [hero];
  hero.parent = personnagesFolder;
  sourcesFolder.parent = researchRoot;
  sourcesFolder.children = [existingSourceNote];
  existingSourceNote.parent = sourcesFolder;
  bibFile.parent = researchRoot;

  projectRoot.children = [researchRoot, workA, workAResearch, workAExtra, workAExtraResearch];
  for (const child of projectRoot.children) child.parent = projectRoot;

  const vaultEntries = [
    projectRoot, researchRoot, personnagesFolder, hero, bibFile,
    workA, sceneA, workAResearch, workANote,
    workAExtra, sceneAExtra, workAExtraResearch, workAExtraNote,
    ...(includeSources ? [sourcesFolder, existingSourceNote] : []),
  ];
  const { vault } = createFakeVault(vaultEntries);
  vault.cachedRead = async (file) => file.content || "";

  const settings = {
    projectFolder: projectRoot.path,
    projectMeta: {
      [projectRoot.path]: {
        researchFolderLinks: {
          [projectRoot.path]: researchRoot.path,
          [workA.path]: workAResearch.path,
          [workAExtra.path]: workAExtraResearch.path,
        },
        citekeyBibliographyPath: "refs.bib",
      },
    },
    orders: {},
    folderPositions: {},
    collapsed: { "research:footnotes-overview": false },
    researchSearch: "",
    researchTagFilter: "",
    researchOrder: {},
    labels: [],
  };

  return {
    vault, settings, projectRoot,
    researchRoot, personnagesFolder, hero, sourcesFolder, existingSourceNote, bibFile,
    workA, sceneA, workAResearch, workANote,
    workAExtra, sceneAExtra, workAExtraResearch, workAExtraNote,
  };
}

function createView(fixture, { workspace = null, scopeMode = "project", activeFile = null, ensureFolderSpy, cachedReadSpy } = {}) {
  const contentEl = new FakeElement();
  const app = {
    vault: cachedReadSpy
      ? { ...fixture.vault, cachedRead: async (file) => { cachedReadSpy(file.path); return fixture.vault.cachedRead(file); } }
      : fixture.vault,
    workspace: {
      getActiveFile: () => activeFile,
      getLeaf: () => ({ openFile: async () => {} }),
      setActiveLeaf: () => {},
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const plugin = {
    settings: fixture.settings,
    app,
    getProjectFolder: () => fixture.projectRoot,
    getWorkspaceFolder: () => workspace,
    getResearchRoot: () => fixture.researchRoot,
    getChronoFolder: () => null,
    buildNumbering: () => new Map(),
    async ensureFolder(path) {
      ensureFolderSpy?.(path);
      const existing = fixture.vault.getAbstractFileByPath(path);
      if (existing) return existing;
      return new TFolder(path);
    },
    async migrateBibliographieIntoSources() {},
    async saveSettings() { fixture.settings.saveSettingsCalls = (fixture.settings.saveSettingsCalls || 0) + 1; },
    tagsOf: () => [],
    titleFor: (f) => f.basename?.replace(/\.md$/, "") ?? f.name,
    shortTitleFor: (f) => f.basename?.replace(/\.md$/, "") ?? f.name,
    fmOf: () => ({}),
    labelOf: () => "",
    labelColor: () => null,
    newFolder() {},
    quickCiteSource() {},
    openInsertCitation() {},
    renumberActiveFootnotes() {},
    generateBibliographyFile: async () => {},
    flattenFiles: (folder) => {
      const results = [];
      const walk = (f) => {
        for (const c of f.children || []) {
          if (c instanceof TFile) results.push(c);
          else if (c instanceof TFolder) walk(c);
        }
      };
      if (folder) walk(folder);
      return results;
    },
    getLinkedResearchFolders: () => Object.entries(fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks)
      .filter(([binderPath]) => binderPath !== fixture.projectRoot.path)
      .map(([binderPath, researchPath]) => ({
        folder: fixture.vault.getAbstractFileByPath(researchPath),
        binderNodes: [fixture.vault.getAbstractFileByPath(binderPath)].filter(Boolean),
      }))
      .filter((entry) => entry.folder instanceof TFolder),
  };
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);
  view.researchScopeMode = scopeMode;
  view.iconBtn = (parent, _icon, tooltip, onClick) => {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  };
  view.attachResearchDropTarget = () => {};
  view.attachResearchDragSource = () => {};
  view.addPreviewBtn = () => new FakeElement();
  view.showResearchFolderContextMenu = () => {};
  view.showResearchFileContextMenu = () => {};
  view.filterEntities = () => {};
  view.renderSavedFiltersButton = () => {};

  return { view, contentEl };
}

async function renderWithDocument(fixture, options) {
  const { view, contentEl } = createView(fixture, options);
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
  } finally {
    globalThis.document = prevDoc;
  }
  return { view, contentEl };
}

const SOURCES_TITLE = researchFolderLabel(RESEARCH_FOLDERS, "sources");
const FOOTNOTES_TITLE = t("shared.footnotes.title");
const BIBLIOGRAPHY_TITLE = t("shared.research.citedReferences");

async function persistentReferenceFixture() {
  const f = makeFixture();
  registerDeclaredWorkspaceRoot(f.settings, f.projectRoot, f.workA);
  registerDeclaredWorkspaceRoot(f.settings, f.projectRoot, f.workAExtra);
  f.settings.workspaceFolderPath = "";
  const sources = await f.vault.createFolder(`${f.workAResearch.path}/Sources`);
  await f.vault.create(`${sources.path}/Local source.md`, "Local source");
  const bib = await f.vault.create(`${f.workAResearch.path}/local.bib`,
    "@article{knuth1968, title={Local Algorithms}, author={Local Author}, year={2024}}\n@article{unused, title={Uncited local reference}}");
  const csl = await f.vault.create(`${f.workAResearch.path}/local.csl`, "<style/>");
  Object.assign(f.settings.projectMeta.PROJECT.folderWorkspaces["Work-A"], {
    pandocCitationPreviewStyle: "off", citekeyBibliographyPath: "local.bib", citekeyCslPath: "local.csl",
  });
  f.sceneAExtra.content = "Sibling cites [@foreign].";
  return { ...f, sources, bib, csl };
}

async function referencePanelSnapshot(f, { workspace = null, editorFile = f.sceneA, activeFile = f.sceneA } = {}) {
  const { view, contentEl } = createView(f, { workspace, scopeMode: "workspace", activeFile });
  view.researchActiveSubTab = "references";
  let receivedContext;
  let generationContext;
  let generationInput;
  let sourceTarget;
  const editor = {
    getCursor: () => ({ line: 0, ch: editorFile.content.length }),
    replaceRange: (text) => { editorFile.content += text; },
    focus() {},
  };
  view.plugin.getReferenceCitationTarget = () => ({ file: editorFile, editor });
  const references = view.renderReferencesTab;
  view.renderReferencesTab = function (container, context, ...args) {
    receivedContext = context;
    return references.call(this, container, context, ...args);
  };
  const bibliography = view.renderBibliographySection;
  view.renderBibliographySection = function (container, context, ...args) {
    generationContext = context;
    return bibliography.call(this, container, context, ...args);
  };
  view.plugin.generateBibliographyFile = async (input) => { generationInput = input; };
  view.promptCreateSourceSheetLazily = (target) => { sourceTarget = target; };
  await view.render(true);
  newSourceSheetButton(contentEl).dispatchClick();
  const exportButton = contentEl.find(".feuillets-bibliography-export-row");
  exportButton?.dispatchClick();
  const resources = resolveWorkspaceCitationResources(view.app, f.settings, f.projectRoot, activeFile);
  view.referenceSearchQuery = "local";
  await view.render(true);
  return {
    root: receivedContext.scopeRoot.path,
    workspace: receivedContext.workspaceRoot?.path ?? null,
    mode: receivedContext.mode,
    files: receivedContext.files.map((file) => file.path),
    caption: contentEl.find(".feuillets-reference-setting-scope")?.text,
    sourceTarget,
    sourceFolders: referenceSourceFolders(view.app, f.settings, receivedContext).map((folder) => folder.path),
    insertionFolders: FeuilletsPlugin.prototype.getCitationFolders.call(view.plugin).map((folder) => folder.path),
    bibliography: referenceBibliographyFile(view.app, f.settings, receivedContext, activeFile)?.path,
    csl: resources.csl.file?.path,
    style: resolveDocumentCitationStyleSetting(f.settings, f.projectRoot.path, receivedContext.scopeRoot.path).value,
    references: contentEl.querySelectorAll(".feuillets-research-item-name").map((element) => element.text),
    generationRoot: generationContext.scopeRoot.path,
    generationFiles: generationContext.files.map((file) => file.path),
    generationLabel: exportButton?.getAttr("aria-label"),
    generatedKeys: generationInput?.bibtexEntries.map((entry) => entry.citekey),
    warnings: contentEl.querySelectorAll(".feuillets-citekey-warning").map((element) => element.text),
    searchResults: contentEl.querySelectorAll(".feuillets-reference-title").map((element) => element.text),
    insertionAvailable: contentEl.querySelectorAll(".feuillets-reference-cite").map((element) => !element.disabled),
  };
}

for (const staleEditor of [false, true]) {
  test(`full References panel: persistent workspace equals the same isolation (stale editor: ${staleEditor})`, async () => {
    const f = await persistentReferenceFixture();
    const before = structuredClone(f.settings);
    const editorFile = staleEditor ? f.sceneAExtra : f.sceneA;
    const plain = await referencePanelSnapshot(f, { editorFile });
    const isolated = await referencePanelSnapshot(f, { workspace: f.workA, editorFile });
    assert.deepEqual(plain, isolated);
    assert.equal(plain.root, f.workA.path);
    assert.equal(plain.workspace, f.workA.path);
    assert.equal(plain.mode, "workspace");
    assert.equal(plain.caption, t("shared.research.citationWorkspaceScope", { name: f.workA.name }));
    assert.equal(plain.sourceTarget, f.workAResearch.path);
    assert.ok(plain.sourceFolders.includes(f.sources.path));
    assert.deepEqual(plain.insertionFolders, plain.sourceFolders);
    assert.ok(!plain.sourceFolders.some((path) => path.startsWith(f.workAExtraResearch.path + "/")));
    assert.equal(plain.bibliography, f.bib.path);
    assert.equal(plain.csl, f.csl.path);
    assert.equal(plain.style, "off");
    assert.ok(plain.references.some((text) => text.includes("Local Algorithms")));
    assert.ok(plain.references.every((text) => !text.includes("foreign") && !text.includes("Uncited")));
    assert.equal(plain.generationRoot, f.workA.path);
    assert.deepEqual(plain.generationFiles, [f.sceneA.path]);
    assert.equal(plain.generationLabel, t("shared.bibliography.generateWorkspace"));
    assert.deepEqual(plain.generatedKeys, ["knuth1968"]);
    assert.deepEqual(plain.warnings, []);
    assert.deepEqual(plain.searchResults, ["Local source", "Local Algorithms", "Uncited local reference"]);
    assert.ok(plain.insertionAvailable.every((available) => available === !staleEditor));
    assert.deepEqual(f.settings, before, "reference normalization must not change isolation or persisted settings");
  });
}

test("full References panel: ordinary overrides do not declare a context boundary", async () => {
  const f = await persistentReferenceFixture();
  delete f.settings.projectMeta.PROJECT.folderWorkspaces["Work-A"].workspaceRoot;
  const panel = await referencePanelSnapshot(f);
  assert.equal(panel.root, f.projectRoot.path);
  assert.equal(panel.caption, t("shared.research.citationProjectScope", { name: f.projectRoot.name }));
  assert.equal(panel.bibliography, f.bib.path, "ordinary overrides still affect document resources");
  assert.ok(panel.references.some((text) => text.includes("foreign")));
});

test("full References panel: nested workspaces and wider/narrower isolation share the same root resolver", async () => {
  const f = await persistentReferenceFixture();
  const nested = await f.vault.createFolder(`${f.workA.path}/Nested`);
  const part = await f.vault.createFolder(`${nested.path}/Part`);
  const scene = await f.vault.create(`${part.path}/Scene.md`, "See [@knuth1968].");
  registerDeclaredWorkspaceRoot(f.settings, f.projectRoot, nested);
  const before = structuredClone(f.settings);
  for (const [activeFile, workspace, expected] of [
    [f.sceneA, null, f.workA],
    [scene, null, nested],
    [scene, f.workA, nested],
    [scene, part, part],
    [scene, f.workAExtra, nested],
  ]) {
    const panel = await referencePanelSnapshot(f, { activeFile, editorFile: activeFile, workspace });
    assert.equal(panel.root, expected.path);
    assert.equal(panel.workspace, expected.path);
    assert.equal(panel.generationRoot, expected.path);
    assert.ok(panel.files.includes(activeFile.path));
    assert.ok(!panel.files.includes(f.sceneAExtra.path));
    assert.equal(panel.sourceTarget, f.workAResearch.path, "existing ancestor Research association is preserved");
    assert.equal(panel.bibliography, f.bib.path);
    assert.equal(panel.csl, f.csl.path);
    assert.equal(panel.style, "off");
  }
  assert.deepEqual(f.settings, before);
});

function sectionTitles(contentEl) {
  return contentEl.querySelectorAll(".feuillets-notes-section-title").map((el) => el.text);
}

function tabs(contentEl) {
  return contentEl.querySelectorAll(".feuillets-research-subtab");
}

function _toolbarAction(contentEl, label) {
  return contentEl
    .querySelectorAll(".clickable-icon")
    .find((element) => element.getAttr("aria-label") === label);
}

/* --- Default tab and accessibility --- */

test("Dossiers is the sub-tab selected by default", async () => {
  const fixture = makeFixture();
  const { contentEl } = await renderWithDocument(fixture, {});
  const titles = sectionTitles(contentEl);
  assert.ok(titles.includes("Personnages"), "Dossiers content is shown by default");
  assert.ok(titles.includes(SOURCES_TITLE));
  assert.ok(!titles.includes(FOOTNOTES_TITLE));
  assert.ok(!titles.includes(BIBLIOGRAPHY_TITLE));
});

test("the sub-tab bar carries a tablist/tab/tabpanel accessible structure", async () => {
  const fixture = makeFixture();
  const { contentEl } = await renderWithDocument(fixture, {});
  const list = contentEl.find(".feuillets-research-subtabs");
  assert.ok(list);
  assert.equal(list.getAttr("role"), "tablist");

  const [dossiersTab, referencesTab] = tabs(contentEl);
  assert.ok(dossiersTab && referencesTab);
  assert.equal(dossiersTab.getAttr("role"), "tab");
  assert.equal(dossiersTab.getAttr("aria-selected"), "true");
  assert.equal(referencesTab.getAttr("aria-selected"), "false");
  assert.equal(dossiersTab.text, t("shared.research.subtabFolders"));
  assert.equal(referencesTab.text, t("shared.research.subtabReferences"));

  const panel = contentEl.find(".feuillets-research-body");
  assert.equal(panel.getAttr("role"), "tabpanel");
});

test("References exposes Source creation and reference search, without citation or footnote toolbar icons", async () => {
  const fixture = makeFixture();
  const { view, contentEl } = createView(fixture, { scopeMode: "project" });
  view.researchActiveSubTab = "references";
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
  } finally {
    globalThis.document = prevDoc;
  }

  assert.equal(contentEl.find(".feuillets-binder-search"), null, "folder search only acts on folder rows, kept out of References");
  const labels = contentEl
    .querySelectorAll(".clickable-icon")
    .map((element) => element.getAttr("aria-label"));
  assert.deepEqual(labels, [
    t("shared.research.newSourceSheet"),
    t("shared.research.bibliographySettings"),
  ]);
  assert.equal(contentEl.find(".feuillets-research-subtabs").find(".feuillets-reference-settings-button"), null);
  assert.equal(contentEl.find(".feuillets-reference-settings"), null);
  assert.ok(contentEl.find(".feuillets-reference-search"));
});

/* --- Switching and persistence --- */

test("clicking the Références tab switches content, and clicking Dossiers again restores it", async () => {
  const fixture = makeFixture();
  const { contentEl } = await renderWithDocument(fixture, {});

  const referencesTab = tabs(contentEl).find((el) => el.text === t("shared.research.subtabReferences"));
  referencesTab.dispatchClick();
  // The click handler's view.render(true) is fire-and-forget (void) —
  // await a microtask turn so it completes before asserting.
  await new Promise((resolve) => setTimeout(resolve, 0));

  let titles = sectionTitles(contentEl);
  assert.ok(!titles.includes("Personnages"), "Dossiers content is gone once References is active");
  assert.ok(!titles.includes(SOURCES_TITLE), "References never duplicates the physical Sources folder");
  assert.ok(!titles.includes(FOOTNOTES_TITLE), "Footnotes remain in the Inspector");
  assert.ok(titles.includes(BIBLIOGRAPHY_TITLE));

  const dossiersTab = tabs(contentEl).find((el) => el.text === t("shared.research.subtabFolders"));
  dossiersTab.dispatchClick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  titles = sectionTitles(contentEl);
  assert.ok(titles.includes("Personnages"), "Dossiers content is restored");
  assert.ok(titles.includes(SOURCES_TITLE));
});

test("the active sub-tab survives an unrelated rerender of the same view", async () => {
  const fixture = makeFixture();
  const { view, contentEl } = await renderWithDocument(fixture, {});
  view.researchActiveSubTab = "references";
  await view.render(true);
  assert.ok(sectionTitles(contentEl).includes(BIBLIOGRAPHY_TITLE));

  // A second, unrelated rerender (e.g. triggered by a vault event) must not
  // reset the sub-tab back to Dossiers.
  await view.render(true);
  assert.ok(sectionTitles(contentEl).includes(BIBLIOGRAPHY_TITLE), "still on References after a second render");
});

/* --- Performance: Dossiers never scans documents --- */

test("no citation analysis, footnote extraction or .bib resolution runs while Dossiers is active", async () => {
  const fixture = makeFixture();
  const reads = [];
  const { contentEl } = await renderWithDocument(fixture, { cachedReadSpy: (path) => reads.push(path) });
  assert.ok(sectionTitles(contentEl).includes("Personnages"), "sanity: Dossiers did render its own content");
  assert.deepEqual(reads, [], "no Markdown or .bib file content was ever read while Dossiers is active");
});

/* --- Categories: Recherche du projet vs Recherches liées --- */

test("\"Recherche du projet\" contains the project's physical folders, including Sources, but not linked research", async () => {
  const fixture = makeFixture();
  const { contentEl } = await renderWithDocument(fixture, { scopeMode: "project" });
  const projectHead = contentEl.find(".feuillets-research-category-head");
  assert.ok(projectHead);
  assert.equal(projectHead.text, t("shared.research.projectResearch"));

  const titles = sectionTitles(contentEl);
  assert.ok(titles.includes("Personnages"));
  assert.ok(titles.includes(SOURCES_TITLE), "Sources remains browsable as a physical folder in Dossiers");
});

test("\"Recherches liées\" holds only associated Binder folders, and the literal text \"Espaces\" never appears", async () => {
  const fixture = makeFixture();
  const { contentEl } = await renderWithDocument(fixture, { scopeMode: "project" });
  const titles = sectionTitles(contentEl);
  assert.ok(titles.includes(fixture.workAResearch.name), "Work-A's linked Research folder is shown under Recherches liées");
  assert.ok(!titles.some((title) => title === "Espaces"), "the old \"Espaces\" wording is gone");
  const linkedHead = contentEl.querySelectorAll(".feuillets-notes-section-title").find((el) => el.text === t("shared.research.linkedResearch"));
  assert.ok(linkedHead, "the \"Recherches liées\" group title is rendered");
});

test("Workspace mode's Recherches liées shows only the matching branch — Work-A and Work-A-Extra never mix", async () => {
  const fixture = makeFixture();
  const { contentEl: workAContent } = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const workATitles = sectionTitles(workAContent);
  assert.ok(!workATitles.includes(fixture.workAExtraResearch.name), "Work-A-Extra's linked folder never appears while scoped to Work-A");

  const { contentEl: workAExtraContent } = await renderWithDocument(fixture, { workspace: fixture.workAExtra, scopeMode: "workspace" });
  const workAExtraTitles = sectionTitles(workAExtraContent);
  assert.ok(!workAExtraTitles.includes(fixture.workAResearch.name), "Work-A's linked folder never appears while scoped to Work-A-Extra");
});

/* --- Sources: optional, never auto-created, created on demand only --- */

test("no Sources folder is ever created merely by rendering, in either sub-tab", async () => {
  const fixture = makeFixture({ includeSources: false });

  const ensureCalls = [];
  const { view, contentEl } = createView(fixture, { scopeMode: "project", ensureFolderSpy: (path) => ensureCalls.push(path) });
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true); // Dossiers (default)
    assert.deepEqual(ensureCalls, [], "no folder is created while rendering Dossiers");
    assert.ok(!sectionTitles(contentEl).includes(SOURCES_TITLE));

    view.researchActiveSubTab = "references";
    await view.render(true); // Références
    assert.deepEqual(ensureCalls, [], "no folder is created merely by rendering Références either");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("an existing Sources fiche remains visible in Dossiers and is not duplicated in References", async () => {
  const fixture = makeFixture();
  const { view, contentEl } = createView(fixture, { scopeMode: "project" });
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    let names = contentEl.querySelectorAll(".feuillets-research-item-name").map((el) => el.text);
    assert.ok(names.includes("Existing"));

    view.researchActiveSubTab = "references";
    await view.render(true);
    names = contentEl.querySelectorAll(".feuillets-research-item-name").map((el) => el.text);
    assert.ok(!names.includes("Existing"), "the uncited Source sheet is not a computed reference");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("an empty physical Sources folder stays visible in Dossiers but never creates a References section", async () => {
  const fixture = makeFixture();
  fixture.sourcesFolder.children = [];
  const { view, contentEl } = createView(fixture, { scopeMode: "project" });
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    assert.ok(sectionTitles(contentEl).includes(SOURCES_TITLE));
    view.researchActiveSubTab = "references";
    await view.render(true);
  } finally {
    globalThis.document = prevDoc;
  }
  assert.ok(!sectionTitles(contentEl).includes(SOURCES_TITLE));
});

/** The toolbar's "New source sheet" action — a real, always-present
 * `.clickable-icon` `<button>` identified by its aria-label, never a
 * standalone row inside the tab's own content (there is no such row: the
 * action lives in the toolbar regardless of whether References currently
 * has anything to show). */
function newSourceSheetButton(contentEl) {
  return contentEl
    .querySelectorAll(".clickable-icon")
    .find((el) => el.getAttr("aria-label") === t("shared.research.newSourceSheet"));
}

test("\"Nouvelle fiche source\" opens its dialog before anything is created, and cancelling it creates nothing", async () => {
  const fixture = makeFixture({ includeSources: false });
  fixture.sceneA.content = "Plain text without footnotes.";

  const ensureCalls = [];
  const { view, contentEl } = createView(fixture, { scopeMode: "project", ensureFolderSpy: (path) => ensureCalls.push(path) });
  view.researchActiveSubTab = "references";

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    assert.deepEqual(ensureCalls, [], "no folder is created merely by rendering the action");

    const action = newSourceSheetButton(contentEl);
    assert.ok(action, "the toolbar action is available even when no Sources folder exists");
    assert.equal(action.tag, "button", "a real <button>, keyboard-accessible via native Enter/Space");

    // Cancelling (the modal's open() is never confirmed here) must create
    // exactly zero folder, zero file, zero settings write.
    const originalOpen = NewResearchFileModal.prototype.open;
    let opened = false;
    NewResearchFileModal.prototype.open = function () { opened = true; };
    try {
      action.dispatchClick();
    } finally {
      NewResearchFileModal.prototype.open = originalOpen;
    }
    assert.ok(opened, "the dialog opens on click, before anything else happens");
    assert.deepEqual(ensureCalls, [], "cancelling the dialog never resolves/creates the Sources folder");
    assert.equal(fixture.settings.saveSettingsCalls || 0, 0);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("\"Nouvelle fiche source\": confirming the dialog resolves/creates the Sources folder only THEN, and writes the sheet into it", async () => {
  const fixture = makeFixture({ includeSources: false });
  fixture.sceneA.content = "Plain text without footnotes.";

  const ensureCalls = [];
  const { view, contentEl } = createView(fixture, { scopeMode: "project", ensureFolderSpy: (path) => ensureCalls.push(path) });
  view.researchActiveSubTab = "references";

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);

    const action = newSourceSheetButton(contentEl);
    assert.ok(action);

    withSimulatedResearchFileSubmit("Mon document", () => {
      action.dispatchClick();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // ensureResearchCategoryFolder() resolves/creates the folder, and the
    // shared file-writing tail (createResearchFileInFolder(), also used by
    // promptCreateResearchFile()) defensively re-ensures it before writing
    // — both calls target the same already-resolved path, idempotently;
    // what matters here is that NEITHER ran before confirmation (see the
    // cancellation test above).
    assert.ok(ensureCalls.length >= 1, "the Sources folder is resolved/created only after confirmation");
    assert.ok(ensureCalls.every((path) => path === ensureCalls[0]), "every call targets the same resolved folder");
    const targetFolderPath = ensureCalls[0];
    assert.equal(targetFolderPath, `${fixture.researchRoot.path}/Sources`);
    const created = fixture.vault.getAbstractFileByPath(`${targetFolderPath}/Mon document.md`);
    assert.ok(created, "the confirmed sheet is written into the now-resolved Sources folder");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("Workspace References creates a Source in the linked research folder without rendering that folder", async () => {
  const fixture = makeFixture();
  fixture.sceneA.content = "Plain text without footnotes.";
  const ensureCalls = [];
  const { view, contentEl } = createView(fixture, {
    workspace: fixture.workA,
    scopeMode: "workspace",
    ensureFolderSpy: (path) => ensureCalls.push(path),
  });
  view.researchActiveSubTab = "references";

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    assert.ok(!sectionTitles(contentEl).includes(fixture.workAResearch.name));
    assert.ok(!sectionTitles(contentEl).includes(SOURCES_TITLE));

    const action = newSourceSheetButton(contentEl);
    assert.ok(action);
    withSimulatedResearchFileSubmit("Source locale", () => action.dispatchClick());
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(ensureCalls.length >= 1);
    assert.ok(
      ensureCalls.every((path) => path === `${fixture.workAResearch.path}/Sources`),
      "all writes target the linked research folder's Sources subfolder"
    );
  } finally {
    globalThis.document = prevDoc;
  }
});

/* ==================== i18n final touch-ups: locale-correct default names,
 * through the real production render() path (not researchFolderNewName()
 * called in isolation) ==================== */

function createEntryButton(contentEl, sectionTitle) {
  return contentEl
    .querySelectorAll(".clickable-icon")
    .find((element) => element.getAttr("aria-label") === t("shared.createEntry", { title: sectionTitle.toLowerCase() }));
}

/** Bypasses the real `Menu` (showResearchCreateMenu opens an Obsidian
 * context menu for a folder-backed section) and captures the exact
 * `createFiche` callback it was given — the same production arrow function
 * `renderResearchBody()` builds per research folder (base-feuillets-
 * view.ts) — so a test can invoke it directly instead of simulating menu
 * navigation. */
function withCapturedCreateFiche(folderPath, fn) {
  const original = ResearchView.prototype.showResearchCreateMenu;
  let captured = null;
  ResearchView.prototype.showResearchCreateMenu = function (_evt, folder, createFiche) {
    if (folder.path === folderPath) captured = createFiche;
  };
  try {
    fn();
  } finally {
    ResearchView.prototype.showResearchCreateMenu = original;
  }
  return captured;
}

test("Personnages creation proposes and creates the locale-correct default name — 'New character' (en) / 'Nouveau personnage' (fr) — through the real render() path", async () => {
  const initial = getLocale();
  try {
    const cases = [
      ["en", "New character"],
      ["fr", "Nouveau personnage"],
    ];
    for (const [locale, expected] of cases) {
      setLocale(locale);
      // Sanity: matches the i18n dictionary itself, never hand-typed twice.
      assert.equal(researchFolderNewName("personnages", locale), expected);

      const fixture = makeFixture();
      const { contentEl } = await renderWithDocument(fixture, {});
      const sectionTitle = researchFolderLabel(RESEARCH_FOLDERS, "personnages");
      const button = createEntryButton(contentEl, sectionTitle);
      assert.ok(button, `create button found under locale "${locale}"`);

      const createFiche = withCapturedCreateFiche(fixture.personnagesFolder.path, () => button.dispatchClick());
      assert.ok(createFiche, "showResearchCreateMenu received the real per-folder onCreate callback");

      const original = NewResearchFileModal.prototype.open;
      let capturedDefaultName = null;
      NewResearchFileModal.prototype.open = function () {
        capturedDefaultName = this.defaultName;
        void this.onSubmit(this.defaultName);
      };
      try {
        await createFiche();
      } finally {
        NewResearchFileModal.prototype.open = original;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(capturedDefaultName, expected, `proposed default name under locale "${locale}"`);
      const created = fixture.vault.getAbstractFileByPath(`${fixture.personnagesFolder.path}/${expected}.md`);
      assert.ok(created, `the file is actually created under the name "${expected}.md"`);
    }
  } finally {
    setLocale(initial);
  }
});

test("Sources creation proposes the locale-correct default name — 'New source' (en) / 'Nouvelle source' (fr) — through the real render() path", async () => {
  const initial = getLocale();
  try {
    const cases = [
      ["en", "New source"],
      ["fr", "Nouvelle source"],
    ];
    for (const [locale, expected] of cases) {
      setLocale(locale);
      assert.equal(researchFolderNewName("sources", locale), expected);

      const fixture = makeFixture({ includeSources: false });
      const { view, contentEl } = createView(fixture, { scopeMode: "project" });
      view.researchActiveSubTab = "references";
      const prevDoc = globalThis.document;
      globalThis.document = { activeElement: null };
      let button;
      try {
        await view.render(true);
        button = newSourceSheetButton(contentEl);
      } finally {
        globalThis.document = prevDoc;
      }
      assert.ok(button, `"new source" toolbar action found under locale "${locale}"`);

      const original = NewResearchFileModal.prototype.open;
      let capturedDefaultName = null;
      NewResearchFileModal.prototype.open = function () {
        capturedDefaultName = this.defaultName;
        void this.onSubmit(this.defaultName);
      };
      try {
        button.dispatchClick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        NewResearchFileModal.prototype.open = original;
      }

      assert.equal(capturedDefaultName, expected, `proposed default name under locale "${locale}"`);
      const created = fixture.vault.getAbstractFileByPath(`${fixture.researchRoot.path}/Sources/${expected}.md`);
      assert.ok(created, `the file is actually created under the name "${expected}.md"`);
    }
  } finally {
    setLocale(initial);
  }
});

test("Custom research folder creation localizes only the generic prefix, never the user-given folder name — 'New theme' (en) / 'Nouveau theme' (fr) — through the real render() path", async () => {
  const initial = getLocale();
  try {
    const cases = [
      ["en", "New theme"],
      ["fr", "Nouveau theme"],
    ];
    for (const [locale, expected] of cases) {
      setLocale(locale);
      // Sanity: matches the i18n dictionary itself, never hand-typed twice.
      assert.equal(t("research.newEntry.generic", { folder: "theme" }), expected);

      const fixture = makeFixture();
      const themesFolder = await fixture.vault.createFolder(`${fixture.researchRoot.path}/Themes`);
      const { contentEl } = await renderWithDocument(fixture, {});
      const button = createEntryButton(contentEl, themesFolder.name);
      assert.ok(button, `create button found for the custom folder under locale "${locale}"`);

      const createFiche = withCapturedCreateFiche(themesFolder.path, () => button.dispatchClick());
      assert.ok(createFiche, "showResearchCreateMenu received the real per-folder onCreate callback");

      const original = NewResearchFileModal.prototype.open;
      let capturedDefaultName = null;
      NewResearchFileModal.prototype.open = function () {
        capturedDefaultName = this.defaultName;
        void this.onSubmit(this.defaultName);
      };
      try {
        await createFiche();
      } finally {
        NewResearchFileModal.prototype.open = original;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(capturedDefaultName, expected, `proposed default name under locale "${locale}"`);
      const created = fixture.vault.getAbstractFileByPath(`${themesFolder.path}/${expected}.md`);
      assert.ok(created, `the file is actually created under the name "${expected}.md"`);
    }
  } finally {
    setLocale(initial);
  }
});
