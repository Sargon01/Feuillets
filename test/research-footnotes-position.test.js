import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ResearchView } from "../src/views/research-view.js";
import { t } from "../src/i18n/index.js";

/* Dossiers owns the real Sources folder. Références never duplicates that
   tree: it renders only non-empty Footnotes and Bibliography sections, in
   that fixed order, or one compact empty state. */

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

  addEventListener() {}
  focus() {}
  setSelectionRange() {}

  contains() {
    return false;
  }
}

function makeFixture() {
  const projectRoot = new TFolder("PROJECT");

  const researchRoot = new TFolder("PROJECT/RESEARCH");
  const sourcesFolder = new TFolder("PROJECT/RESEARCH/Sources");
  const sourceNote = new TFile("PROJECT/RESEARCH/Sources/Note.md", "---\ntitle: \"\"\n---\n");
  const personnagesFolder = new TFolder("PROJECT/RESEARCH/Personnages");
  const hero = new TFile("PROJECT/RESEARCH/Personnages/Hero.md", "---\ntitle: \"\"\n---\n");

  const researchRootNoSources = new TFolder("PROJECT/RESEARCH-NO-SOURCES");
  const personnagesOnly = new TFolder("PROJECT/RESEARCH-NO-SOURCES/Personnages");
  const heroOnly = new TFile("PROJECT/RESEARCH-NO-SOURCES/Personnages/Hero.md", "---\ntitle: \"\"\n---\n");

  const workA = new TFolder("PROJECT/Work-A");
  const scene = new TFile("PROJECT/Work-A/Scene.md", "Body[^a] citing [@knuth1968].\n\n[^a]: Footnote A");
  workA.children = [scene];
  scene.parent = workA;

  const workAResearch = new TFolder("PROJECT/Work-A-Research");
  const workANote = new TFile("PROJECT/Work-A-Research/Note.md", "---\ntitle: \"\"\n---\n");
  workAResearch.children = [workANote];
  workANote.parent = workAResearch;

  const bibFile = new TFile(
    "PROJECT/RESEARCH/refs.bib",
    "@article{knuth1968,\n  author = {Knuth, Donald},\n  title = {Fundamental Algorithms},\n  year = {1968}\n}"
  );
  bibFile.extension = "bib";

  for (const file of [sourceNote, hero, heroOnly, scene, workANote]) {
    file.stat = { mtime: 1000, size: file.content.length };
    file.extension = "md";
  }
  bibFile.stat = { mtime: 1000, size: bibFile.content.length };

  researchRoot.children = [sourcesFolder, personnagesFolder, bibFile];
  sourcesFolder.parent = researchRoot;
  sourcesFolder.children = [sourceNote];
  sourceNote.parent = sourcesFolder;
  personnagesFolder.parent = researchRoot;
  personnagesFolder.children = [hero];
  hero.parent = personnagesFolder;
  bibFile.parent = researchRoot;

  researchRootNoSources.children = [personnagesOnly];
  personnagesOnly.parent = researchRootNoSources;
  personnagesOnly.children = [heroOnly];
  heroOnly.parent = personnagesOnly;

  projectRoot.children = [researchRoot, researchRootNoSources, workA, workAResearch];
  for (const child of projectRoot.children) child.parent = projectRoot;

  const vaultEntries = [
    projectRoot, researchRoot, sourcesFolder, sourceNote, personnagesFolder, hero,
    researchRootNoSources, personnagesOnly, heroOnly,
    workA, scene, workAResearch, workANote, bibFile,
  ];
  const { vault } = createFakeVault(vaultEntries);
  vault.cachedRead = async (file) => file.content || "";

  const settings = {
    projectFolder: projectRoot.path,
    projectMeta: {
      [projectRoot.path]: {
        researchFolderLinks: { [projectRoot.path]: researchRoot.path },
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
    researchRoot, sourcesFolder, sourceNote, personnagesFolder, hero,
    researchRootNoSources, personnagesOnly, heroOnly,
    workA, scene, workAResearch, workANote, bibFile,
  };
}

function createView(fixture, { workspace = null, scopeMode = "project", researchRootOverride, activeSubTab = "references" } = {}) {
  const contentEl = new FakeElement();
  const app = {
    vault: fixture.vault,
    workspace: { getActiveFile: () => null },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const plugin = {
    settings: fixture.settings,
    app,
    getProjectFolder: () => fixture.projectRoot,
    getWorkspaceFolder: () => workspace,
    getResearchRoot: () => (researchRootOverride !== undefined ? researchRootOverride : fixture.researchRoot),
    getChronoFolder: () => null,
    buildNumbering: () => new Map(),
    async ensureFolder() {},
    async migrateBibliographieIntoSources() {},
    async saveSettings() {},
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
    getLinkedResearchFolders: () => [],
  };
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);
  view.researchScopeMode = scopeMode;
  view.researchActiveSubTab = activeSubTab;
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
  return contentEl;
}

/** The real DOM order of the Research body's top-level sections, by their
 * own title text — one entry per direct child of .feuillets-research-body
 * that carries a .feuillets-notes-section-title (nested group titles, e.g.
 * inside the Bibliography or a grouped Footnotes tree, are never picked up
 * since `find()` stops at the first match, which is always the section's
 * own head). */
function topLevelSectionTitles(contentEl) {
  const body = contentEl.find(".feuillets-research-body");
  if (!body) return [];
  return body.children
    .map((child) => child.find(".feuillets-notes-section-title"))
    .filter(Boolean)
    .map((el) => el.text);
}

const SOURCES_TITLE = "Sources";
const FOOTNOTES_TITLE = t("shared.footnotes.title");
const BIBLIOGRAPHY_TITLE = t("shared.bibliography.title");

function referenceIndices(titles) {
  return {
    footnotes: titles.indexOf(FOOTNOTES_TITLE),
    bibliography: titles.indexOf(BIBLIOGRAPHY_TITLE),
  };
}

/* --- Computed references never leak into Dossiers --- */

test("Dossiers shows the physical Sources folder but no computed Notes or Bibliography", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project", activeSubTab: "dossiers" });
  const titles = topLevelSectionTitles(contentEl);
  assert.ok(titles.includes(SOURCES_TITLE));
  assert.ok(!titles.includes(FOOTNOTES_TITLE));
  assert.ok(!titles.includes(BIBLIOGRAPHY_TITLE));
  assert.ok(titles.includes("Personnages"));
});

/* --- Fixed DOM order within References --- */

test("References tab renders Notes then Bibliography and never a Sources tree", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  const titles = topLevelSectionTitles(contentEl);
  const { footnotes, bibliography } = referenceIndices(titles);
  assert.equal(titles.indexOf(SOURCES_TITLE), -1);
  assert.ok(footnotes > -1 && bibliography > -1);
  assert.ok(footnotes < bibliography, "Notes comes before Bibliography");
});

test("References tab is independent from the presence of a physical Sources folder", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, {
    scopeMode: "project",
    researchRootOverride: fixture.researchRootNoSources,
  });
  const titles = topLevelSectionTitles(contentEl);
  const { footnotes, bibliography } = referenceIndices(titles);
  assert.equal(titles.indexOf(SOURCES_TITLE), -1);
  assert.ok(footnotes > -1 && bibliography > -1);
  assert.ok(footnotes < bibliography);
  assert.equal(titles.length, 2);
  assert.equal(contentEl.querySelectorAll(".feuillets-references-empty").length, 0);
});

test("References tab: reordering Dossiers never affects the fixed Notes then Bibliography order", async () => {
  const fixture = makeFixture();
  fixture.settings.researchOrder[`research-sections:${fixture.researchRoot.path}`] = [
    fixture.personnagesFolder.path,
  ];
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  const titles = topLevelSectionTitles(contentEl);
  const { footnotes, bibliography } = referenceIndices(titles);
  assert.ok(footnotes > -1 && footnotes < bibliography);
});

/* --- Single compact empty state when the whole scope has nothing --- */

test("References tab: a single compact empty state replaces all three sections when the scope has nothing", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, {
    workspace: fixture.personnagesOnly,
    scopeMode: "workspace",
    researchRootOverride: fixture.researchRootNoSources,
  });
  const titles = topLevelSectionTitles(contentEl);
  assert.ok(!titles.includes(SOURCES_TITLE));
  assert.ok(!titles.includes(FOOTNOTES_TITLE));
  assert.ok(!titles.includes(BIBLIOGRAPHY_TITLE));
  const emptyStates = contentEl.querySelectorAll(".feuillets-references-empty").filter(
    (el) => el.text === t("shared.research.noReferencesInScope")
  );
  assert.equal(emptyStates.length, 1, "exactly one compact empty state, never a per-section one");
  const newSourceSheetBtn = contentEl
    .querySelectorAll(".clickable-icon")
    .find((el) => el.getAttr("aria-label") === t("shared.research.newSourceSheet"));
  assert.ok(newSourceSheetBtn, "the toolbar's \"New source sheet\" action stays available even when References is empty");
});
