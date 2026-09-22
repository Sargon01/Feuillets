import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ResearchView } from "../src/views/research-view.js";
import { analyzeResearchCitations } from "../src/services/research-citation-analysis.js";
import { saveCitationRegistry, citationRegistryPath } from "../src/services/citation-registry.js";
import { t } from "../src/i18n/index.js";

/* Contextual citation scope — citations, their counters and the displayed
   bibliography become contextual to the resolved document scope
   (documentContext), decoupled from where the .bib resources themselves
   are discovered/inherited (services/citekey-bibliography.ts, unchanged).
   See services/research-citation-analysis.ts. */

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

  empty() {
    this.children = [];
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

  focus() {}
  setSelectionRange() {}

  contains() {
    return false;
  }

  get textContent() {
    return (this.text || "") + this.children.map((c) => c.textContent).join(" ");
  }
}

function makeFixture() {
  const projectRoot = new TFolder("PROJECT");
  const workA = new TFolder("PROJECT/Work-A");
  const workASub = new TFolder("PROJECT/Work-A/Sub");
  const workAExtra = new TFolder("PROJECT/Work-A-Extra");
  const workB = new TFolder("PROJECT/Work-B");

  const sceneA = new TFile(
    "PROJECT/Work-A/Scene-A.md",
    "Body A citing [@sharedKey2020], [@onlyA2021] and [@unknownInScope2024]."
  );
  const sceneASub = new TFile("PROJECT/Work-A/Sub/Scene-A-Sub.md", "Nested citing [@subKey2020].");
  const attachmentPdf = new TFile("PROJECT/Work-A/Attachment.pdf", "PDF citing [@shouldNeverCount2099].");
  const sceneAExtra = new TFile("PROJECT/Work-A-Extra/Scene-Extra.md", "Extra citing [@onlyExtra2022].");
  const sceneB = new TFile(
    "PROJECT/Work-B/Scene-B.md",
    "Body B citing [@sharedKey2020], [@onlyB2023] twice [@onlyB2023]."
  );

  for (const file of [sceneA, sceneASub, attachmentPdf, sceneAExtra, sceneB]) {
    file.stat = { mtime: 1000, size: file.content.length };
  }
  sceneA.extension = "md";
  sceneASub.extension = "md";
  attachmentPdf.extension = "pdf";
  sceneAExtra.extension = "md";
  sceneB.extension = "md";

  const researchRoot = new TFolder("PROJECT/RESEARCH");
  const sourcesFolder = new TFolder("PROJECT/RESEARCH/Sources");
  const projectNote = new TFile("PROJECT/RESEARCH/Sources/ProjectNote.md", "");
  projectNote.extension = "md";
  projectNote.frontmatter = { cite_count: 2, author: "Project Author" };
  projectNote.basename = "ProjectNote";

  const refsBib = new TFile(
    "PROJECT/RESEARCH/refs.bib",
    `@article{sharedKey2020, author = {Shared, Sam}, title = {Shared Work}, year = {2020}}
@article{onlyA2021, author = {Alpha, Ann}, title = {Alpha Work}, year = {2021}}
@article{onlyB2023, author = {Beta, Bob}, title = {Beta Work}, year = {2023}}
@article{subKey2020, author = {Sub, Sue}, title = {Sub Work}, year = {2020}}`
  );
  refsBib.extension = "bib";
  refsBib.stat = { mtime: 1000, size: refsBib.content.length };

  const workAResearch = new TFolder("PROJECT/Work-A-Research");
  const workASourcesFolder = new TFolder("PROJECT/Work-A-Research/Sources");
  const workANote = new TFile("PROJECT/Work-A-Research/Sources/WorkANote.md", "");
  workANote.extension = "md";
  workANote.frontmatter = { author: "Workspace Author" };
  workANote.basename = "WorkANote";

  projectRoot.children = [workA, workAExtra, workB, researchRoot, workAResearch];
  workA.parent = projectRoot;
  workAExtra.parent = projectRoot;
  workB.parent = projectRoot;
  researchRoot.parent = projectRoot;
  workAResearch.parent = projectRoot;

  workA.children = [workASub, sceneA, attachmentPdf];
  workASub.parent = workA;
  sceneA.parent = workA;
  attachmentPdf.parent = workA;

  workASub.children = [sceneASub];
  sceneASub.parent = workASub;

  workAExtra.children = [sceneAExtra];
  sceneAExtra.parent = workAExtra;

  workB.children = [sceneB];
  sceneB.parent = workB;

  researchRoot.children = [sourcesFolder, refsBib];
  sourcesFolder.parent = researchRoot;
  refsBib.parent = researchRoot;
  sourcesFolder.children = [projectNote];
  projectNote.parent = sourcesFolder;

  workAResearch.children = [workASourcesFolder];
  workASourcesFolder.parent = workAResearch;
  workASourcesFolder.children = [workANote];
  workANote.parent = workASourcesFolder;

  const vaultEntries = [
    projectRoot, workA, workASub, workAExtra, workB,
    researchRoot, sourcesFolder, projectNote, refsBib,
    workAResearch, workASourcesFolder, workANote,
    sceneA, sceneASub, sceneAExtra, sceneB, attachmentPdf,
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
    collapsed: {},
    researchSearch: "",
    researchTagFilter: "",
    researchOrder: {},
    labels: [],
  };

  return {
    vault, settings,
    projectRoot, workA, workASub, workAExtra, workB,
    researchRoot, sourcesFolder, projectNote, refsBib,
    workAResearch, workASourcesFolder, workANote,
    sceneA, sceneASub, sceneAExtra, sceneB, attachmentPdf,
  };
}

/** Seeds a real citation registry (citation-registry.ts) so Source-card
 * scoped counters can be exercised against real occurrences instead of a
 * hand-rolled map — `file` paths are relative to projectRoot, exactly as
 * addCitationOccurrence stores them. */
async function seedCitationRegistry(fixture, occurrences) {
  const app = { vault: fixture.vault };
  const registry = {
    version: 1,
    citations: occurrences.map((o, i) => ({
      id: `occ-${i}`,
      file: o.file,
      sourcePath: o.sourcePath,
      start: 0,
      end: 1,
      quote: "",
      prefix: "",
      suffix: "",
    })),
  };
  await saveCitationRegistry(app, fixture.settings, registry);
  return citationRegistryPath(app, fixture.settings);
}

function createView(fixture, { workspace = null, scopeMode = "workspace", activeFile = null, cachedReadSpy } = {}) {
  const contentEl = new FakeElement();
  let currentActiveFile = activeFile;
  const app = {
    vault: cachedReadSpy
      ? { ...fixture.vault, cachedRead: async (file) => { cachedReadSpy(file.path); return fixture.vault.cachedRead(file); } }
      : fixture.vault,
    workspace: { getActiveFile: () => currentActiveFile },
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
    async ensureFolder() {},
    async migrateBibliographieIntoSources() {},
    async saveSettings() {},
    tagsOf: () => [],
    titleFor: (f) => f.basename?.replace(/\.md$/, "") ?? f.name,
    shortTitleFor: (f) => f.basename?.replace(/\.md$/, "") ?? f.name,
    fmOf: (f) => f.frontmatter || {},
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
  view.iconBtn = (parent, _icon, tooltip, onClick) => {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    btn.tooltip = tooltip;
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

  return { view, contentEl, app, setActiveFile: (file) => { currentActiveFile = file; } };
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

function bibliographyItems(contentEl) {
  return contentEl.querySelectorAll(".feuillets-research-item");
}

function bibliographySectionTitles(contentEl) {
  const title = t("shared.bibliography.title");
  return contentEl.querySelectorAll(".feuillets-notes-section-title").filter((el) => el.text === title);
}

/* --- Scope-driven citekeys (Bibliography section) --- */

test("Project mode resolves citekeys used across every document of the project", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: null, scopeMode: "project" });
  const text = contentEl.textContent;
  assert.match(text, /sharedKey2020/);
  assert.match(text, /onlyA2021/);
  assert.match(text, /onlyB2023/);
  assert.match(text, /subKey2020/);
});

test("Workspace mode resolves only the citekeys of the isolated space", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const text = contentEl.textContent;
  assert.match(text, /sharedKey2020/, "own document's citekey must appear");
  assert.match(text, /onlyA2021/, "own document's citekey must appear");
  assert.doesNotMatch(text, /onlyB2023/, "Work-B's citekey must never appear");
  assert.doesNotMatch(text, /onlyExtra2022/, "Work-A-Extra's citekey must never appear");
});

test("citekeys nested inside a subfolder of the space are included", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.match(contentEl.textContent, /subKey2020/, "the subfolder's citekey must be resolved");
});

test("a sibling space's citekeys are excluded", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workB, scopeMode: "workspace" });
  const text = contentEl.textContent;
  assert.match(text, /onlyB2023/);
  assert.doesNotMatch(text, /onlyA2021/);
  assert.doesNotMatch(text, /subKey2020/);
});

test("Work-A and Work-A-Extra citekeys are never confused", async () => {
  const fixture = makeFixture();
  const workAContent = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.doesNotMatch(workAContent.textContent, /onlyExtra2022/);

  const workAExtraContent = await renderWithDocument(fixture, { workspace: fixture.workAExtra, scopeMode: "workspace" });
  assert.match(workAExtraContent.textContent, /onlyExtra2022/);
  assert.doesNotMatch(workAExtraContent.textContent, /onlyA2021/);
});

test("the same citekey used inside and outside the space is counted per scope, not globally", async () => {
  const fixture = makeFixture();
  const workAContent = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const workAItem = bibliographyItems(workAContent).find((el) => el.textContent.includes("sharedKey2020"));
  assert.ok(workAItem);
  assert.match(workAItem.textContent, /1 citation\b/, "sharedKey2020 is used once inside Work-A");

  const workBContent = await renderWithDocument(fixture, { workspace: fixture.workB, scopeMode: "workspace" });
  const workBSharedItem = bibliographyItems(workBContent).find((el) => el.textContent.includes("sharedKey2020"));
  assert.ok(workBSharedItem);
  assert.match(workBSharedItem.textContent, /1 citation\b/, "sharedKey2020 is used once inside Work-B");
  const onlyBItem = bibliographyItems(workBContent).find((el) => el.textContent.includes("onlyB2023"));
  assert.ok(onlyBItem);
  assert.match(onlyBItem.textContent, /2 citations/, "the existing occurrence-counting semantics (2 uses) are preserved");
});

test("a reference cited only outside the current scope is excluded from the space's Bibliography", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.doesNotMatch(contentEl.textContent, /Beta, Bob/, "onlyB2023's resolved entry must not leak into Work-A");
});

test("a space-local citekey resolves against a .bib file inherited from the project", async () => {
  const fixture = makeFixture();
  // No citekeyBibliographyPath configured on Work-A itself — only at project level.
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const known = contentEl.find(".feuillets-bibtex-citation-item");
  assert.ok(known);
  const knownItems = bibliographyItems(contentEl).filter((el) => el.classes.has("feuillets-bibtex-citation-item"));
  const onlyAItem = knownItems.find((el) => el.textContent.includes("onlyA2021"));
  assert.ok(onlyAItem, "onlyA2021 resolves via the project-level refs.bib even though Work-A declares no .bib of its own");
  assert.match(onlyAItem.textContent, /Alpha, Ann/);
});

test("an unknown citekey cited inside the space is displayed as an unknown reference", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const unknownItems = bibliographyItems(contentEl).filter((el) => el.classes.has("feuillets-bibtex-unknown-item"));
  const unknownInScope = unknownItems.find((el) => el.textContent.includes("unknownInScope2024"));
  assert.ok(unknownInScope, "unknownInScope2024 must be flagged as an unknown citekey inside Work-A");
});

test("an unknown citekey cited only outside the space is excluded", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.doesNotMatch(contentEl.textContent, /onlyExtra2022/, "Work-A-Extra's unknown citekey must never appear for Work-A");
});

test("PDF attachments are never scanned for citekeys", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.doesNotMatch(contentEl.textContent, /shouldNeverCount2099/, "the .pdf attachment's fake citekey must never surface");
});

/* --- Contextual Source-card counters --- */

test("Project mode uses the contextual citation registry, not the stale cite_count field", async () => {
  const fixture = makeFixture();
  // cite_count deliberately disagrees with the real occurrences below — it
  // must never be read to decide what is displayed.
  fixture.projectNote.frontmatter.cite_count = 99;

  // A second Source fiche whose cite_count claims it is cited, but with no
  // matching occurrence anywhere in the project's citation registry.
  const staleNote = new TFile("PROJECT/RESEARCH/Sources/StaleNote.md", "");
  staleNote.extension = "md";
  staleNote.frontmatter = { cite_count: 7, author: "Stale Author" };
  staleNote.basename = "StaleNote";
  staleNote.parent = fixture.sourcesFolder;
  fixture.sourcesFolder.children.push(staleNote);

  await seedCitationRegistry(fixture, [
    { file: "Work-A/Scene-A.md", sourcePath: fixture.projectNote.path },
    { file: "Work-A/Sub/Scene-A-Sub.md", sourcePath: fixture.projectNote.path },
    { file: "Work-B/Scene-B.md", sourcePath: fixture.projectNote.path },
  ]);

  const contentEl = await renderWithDocument(fixture, { workspace: null, scopeMode: "project" });
  // The Sources folder browser also lists "ProjectNote" as a plain row —
  // only the aggregated Bibliography entry carries the citation count.
  const sourceItem = bibliographyItems(contentEl).find(
    (el) => el.textContent.includes("ProjectNote") && /citation/.test(el.textContent)
  );
  assert.ok(sourceItem);
  assert.match(sourceItem.textContent, /3 citations/, "the displayed count matches the 3 registry occurrences within documentContext.files");
  assert.doesNotMatch(sourceItem.textContent, /99 citation/, "the stale cite_count value must never be used");

  const staleItem = bibliographyItems(contentEl).find(
    (el) => el.textContent.includes("StaleNote") && /citation/.test(el.textContent)
  );
  assert.equal(staleItem, undefined, "a fiche with cite_count > 0 but no matching occurrence in scope must not be presented as cited");
});

test("Workspace mode scopes Source-card counters to the space's own citation occurrences", async () => {
  const fixture = makeFixture();
  await seedCitationRegistry(fixture, [
    { file: "Work-A/Scene-A.md", sourcePath: fixture.workANote.path },
    { file: "Work-A/Sub/Scene-A-Sub.md", sourcePath: fixture.workANote.path },
    { file: "Work-B/Scene-B.md", sourcePath: fixture.workANote.path },
    { file: "Work-A-Extra/Scene-Extra.md", sourcePath: fixture.workANote.path },
  ]);
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;

  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const sourceItem = bibliographyItems(contentEl).find(
    (el) => el.textContent.includes("WorkANote") && /citation/.test(el.textContent)
  );
  assert.ok(sourceItem, "the Source card cited from within Work-A must appear");
  assert.match(
    sourceItem.textContent,
    /2 citations/,
    "only the 2 occurrences inside Work-A (own scene + subfolder scene) are counted — Work-B and Work-A-Extra are excluded"
  );
});

/* --- Bibliography rendered in every branch, exactly once --- */

test("the Bibliography section renders without any Sources folder", async () => {
  const projectRoot = new TFolder("SOLO");
  const researchRoot = new TFolder("SOLO/RESEARCH");
  const bibFile = new TFile("SOLO/RESEARCH/refs.bib", `@article{lonelyKey, author = {Lonely, Lou}, title = {Lonely Work}, year = {2019}}`);
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 1000, size: bibFile.content.length };
  const scene = new TFile("SOLO/Scene.md", "Citing [@lonelyKey].");
  scene.extension = "md";
  scene.stat = { mtime: 1000, size: scene.content.length };

  projectRoot.children = [researchRoot, scene];
  researchRoot.parent = projectRoot;
  scene.parent = projectRoot;
  researchRoot.children = [bibFile];
  bibFile.parent = researchRoot;

  const { vault } = createFakeVault([projectRoot, researchRoot, bibFile, scene]);
  vault.cachedRead = async (file) => file.content || "";
  const settings = {
    projectFolder: projectRoot.path,
    projectMeta: {
      [projectRoot.path]: {
        researchFolderLinks: { [projectRoot.path]: researchRoot.path },
        citekeyBibliographyPath: "refs.bib",
      },
    },
    orders: {}, folderPositions: {}, collapsed: {}, researchSearch: "", researchTagFilter: "", researchOrder: {}, labels: [],
  };

  const fixture = { vault, settings, projectRoot, researchRoot, workA: null };
  const contentEl = await renderWithDocument(fixture, { workspace: null, scopeMode: "project" });
  assert.match(contentEl.textContent, /lonelyKey/);
  assert.equal(bibliographySectionTitles(contentEl).length, 1);
});

test("the Bibliography section renders in the Research branch exactly associated with the isolated space", async () => {
  const fixture = makeFixture();
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;

  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.match(contentEl.textContent, /onlyA2021/);
  assert.doesNotMatch(contentEl.textContent, /onlyB2023/);
  assert.equal(bibliographySectionTitles(contentEl).length, 1);
});

test("the Bibliography section never appears twice, in either Research branch", async () => {
  const fixture = makeFixture();

  const generalContent = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "project" });
  assert.equal(bibliographySectionTitles(generalContent).length, 1);

  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;
  const associatedContent = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.equal(bibliographySectionTitles(associatedContent).length, 1);
});

test("a legacy Bibliographie folder without any Sources folder is never rendered as a duplicate Bibliography section", async () => {
  const projectRoot = new TFolder("LEGACY");
  const researchRoot = new TFolder("LEGACY/RESEARCH");
  const bibliographieFolder = new TFolder("LEGACY/RESEARCH/Bibliographie");
  const legacyRef = new TFile("LEGACY/RESEARCH/Bibliographie/LegacyRef.md", "");
  legacyRef.extension = "md";
  legacyRef.frontmatter = { author: "Legacy Author" };
  legacyRef.basename = "LegacyRef";
  const scene = new TFile("LEGACY/Scene.md", "Discussing (Legacy Author, 2020) at length.");
  scene.extension = "md";
  scene.stat = { mtime: 1000, size: scene.content.length };

  projectRoot.children = [researchRoot, scene];
  researchRoot.parent = projectRoot;
  scene.parent = projectRoot;
  researchRoot.children = [bibliographieFolder];
  bibliographieFolder.parent = researchRoot;
  bibliographieFolder.children = [legacyRef];
  legacyRef.parent = bibliographieFolder;

  const { vault } = createFakeVault([projectRoot, researchRoot, bibliographieFolder, legacyRef, scene]);
  vault.cachedRead = async (file) => file.content || "";
  const settings = {
    projectFolder: projectRoot.path,
    projectMeta: { [projectRoot.path]: { researchFolderLinks: { [projectRoot.path]: researchRoot.path } } },
    orders: {}, folderPositions: {}, collapsed: {}, researchSearch: "", researchTagFilter: "", researchOrder: {}, labels: [],
  };
  const fixture = { vault, settings, projectRoot, researchRoot, workA: null };

  await seedCitationRegistry(fixture, [{ file: "Scene.md", sourcePath: legacyRef.path }]);

  const contentEl = await renderWithDocument(fixture, { workspace: null, scopeMode: "project" });

  assert.equal(bibliographySectionTitles(contentEl).length, 1, "exactly one visible Bibliography title, no raw legacy-folder duplicate");

  const legacyItems = bibliographyItems(contentEl).filter(
    (el) => el.textContent.includes("LegacyRef") && /citation/.test(el.textContent)
  );
  assert.equal(legacyItems.length, 1, "the cited legacy fiche appears exactly once, never duplicated");
  assert.match(legacyItems[0].textContent, /1 citation\b/, "the contextual citation is displayed");
});

/* --- Independence from the active file --- */

test("changing only the active file never changes the displayed citekeys or Source counters", async () => {
  const fixture = makeFixture();
  const { view, contentEl, setActiveFile } = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace", activeFile: fixture.sceneA });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    const first = contentEl.textContent;

    setActiveFile(fixture.projectNote);
    await view.render(true);
    assert.equal(contentEl.textContent, first);

    setActiveFile(fixture.attachmentPdf);
    await view.render(true);
    assert.equal(contentEl.textContent, first);

    setActiveFile(fixture.sceneB);
    await view.render(true);
    assert.equal(contentEl.textContent, first);
  } finally {
    globalThis.document = prevDoc;
  }
});

/* --- Purity: single pass, no mutation, no flattenFiles --- */

test("analyzeResearchCitations never mutates documentContext.files and relies solely on the given files", async () => {
  const fixture = makeFixture();
  const documentContext = {
    mode: "workspace",
    projectRoot: fixture.projectRoot,
    scopeRoot: fixture.workA,
    workspaceRoot: fixture.workA,
    files: [fixture.sceneA],
  };
  const originalRef = documentContext.files;
  const originalOrder = documentContext.files.map((f) => f.path);

  const app = { vault: fixture.vault };
  const analysis = await analyzeResearchCitations(app, fixture.settings, documentContext);

  assert.equal(documentContext.files, originalRef);
  assert.deepEqual(documentContext.files.map((f) => f.path), originalOrder);

  // sceneASub was never included in `files` — a re-walk via flattenFiles()
  // would have picked up its citekey; this proves no such re-walk happened.
  assert.ok(analysis.citekeyCounts.has("sharedKey2020"));
  assert.ok(!analysis.citekeyCounts.has("subKey2020"), "must never re-derive the scope from disk");
});

test("the citation analysis is computed exactly once per Research render", async () => {
  const fixture = makeFixture();
  const reads = [];
  const contentEl = await renderWithDocument(fixture, {
    workspace: fixture.workA,
    scopeMode: "workspace",
    cachedReadSpy: (path) => reads.push(path),
  });
  assert.match(contentEl.textContent, /sharedKey2020/);
  // Scene-A.md is legitimately read twice per render: once by the
  // footnotes overview scan, once by the citation analysis. A third read
  // would mean the citation analysis itself ran more than once (e.g. once
  // for the Source counters, once more for the Bibliography section).
  const sceneAReads = reads.filter((p) => p === fixture.sceneA.path);
  assert.equal(sceneAReads.length, 2, "Scene-A.md must be read once for footnotes and once for the citation analysis — never more");
});

/* --- Footnote regression coverage --- */

test("footnotes and the contextual Bibliography coexist correctly in the same render", async () => {
  const fixture = makeFixture();
  fixture.sceneA.content = "Body A[^a] citing [@sharedKey2020].\n\n[^a]: Footnote A text";
  fixture.sceneA.stat = { mtime: 2000, size: fixture.sceneA.content.length };

  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const footnoteTitle = t("shared.footnotes.title");
  const footnoteTitles = contentEl.querySelectorAll(".feuillets-notes-section-title").filter((el) => el.text === footnoteTitle);
  assert.equal(footnoteTitles.length, 1);
  assert.match(contentEl.textContent, /Footnote A text/);
  assert.match(contentEl.textContent, /sharedKey2020/);
  assert.equal(bibliographySectionTitles(contentEl).length, 1);
});
