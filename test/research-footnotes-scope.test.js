import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ResearchView } from "../src/views/research-view.js";
import { t, setLocale, getLocale } from "../src/i18n/index.js";

/* Lot 2 — la section "Notes de bas de page (relecture)" doit suivre
   exactement la même portée documentaire que le reste de la vue Recherche
   (documentContext résolu une seule fois par ResearchView.render(), lot 1),
   qu'un dossier Sources existe ou non, et dans les deux branches de rendu
   (Recherche générale/héritée, et Recherche associée exactement à l'espace
   isolé). Voir src/services/research-document-context.ts. */

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
    const results = [];
    const match = (el) => {
      if (selector.startsWith(".")) return el.classes.has(selector.slice(1));
      return false;
    };
    const walk = (el) => {
      for (const child of el.children) {
        if (match(child)) results.push(child);
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
}

function makeFixture() {
  const projectRoot = new TFolder("PROJECT");
  const workA = new TFolder("PROJECT/Work-A");
  const workASub = new TFolder("PROJECT/Work-A/Sub");
  const workAExtra = new TFolder("PROJECT/Work-A-Extra");
  const workB = new TFolder("PROJECT/Work-B");

  const sceneA = new TFile("PROJECT/Work-A/Scene-A.md", "Body A[^a]\n\n[^a]: Footnote A text");
  const sceneASub = new TFile("PROJECT/Work-A/Sub/Scene-A-Sub.md", "Body sub[^b]\n\n[^b]: Footnote B text");
  const attachmentPdf = new TFile("PROJECT/Work-A/Attachment.pdf", "binary");
  const sceneAExtra = new TFile("PROJECT/Work-A-Extra/Scene-Extra.md", "Body extra[^c]\n\n[^c]: Footnote C text");
  const sceneB = new TFile("PROJECT/Work-B/Scene-B.md", "Body B[^d]\n\n[^d]: Footnote D text");

  const researchRoot = new TFolder("RESEARCH");
  const sourcesFolder = new TFolder("RESEARCH/Sources");
  const researchNote = new TFile("RESEARCH/Sources/Note.md", "---\ntitle: \"\"\n---\n");
  const workAResearch = new TFolder("RESEARCH/Work-A-Research");

  projectRoot.children = [workA, workAExtra, workB];
  workA.parent = projectRoot;
  workAExtra.parent = projectRoot;
  workB.parent = projectRoot;

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

  researchRoot.children = [sourcesFolder];
  sourcesFolder.parent = researchRoot;
  sourcesFolder.children = [researchNote];
  researchNote.parent = sourcesFolder;

  workAResearch.children = [];
  workAResearch.parent = researchRoot;

  const { vault } = createFakeVault([
    projectRoot, workA, workASub, workAExtra, workB,
    researchRoot, sourcesFolder, workAResearch,
    sceneA, sceneASub, sceneAExtra, sceneB, researchNote, attachmentPdf,
  ]);
  vault.cachedRead = async (file) => file.content || "";

  const settings = {
    projectFolder: projectRoot.path,
    projectMeta: { [projectRoot.path]: { researchFolderLinks: {} } },
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
    researchRoot, sourcesFolder, researchNote, workAResearch,
    sceneA, sceneASub, sceneAExtra, sceneB, attachmentPdf,
  };
}

function createView(fixture, { workspace = null, scopeMode = "workspace", activeFile = null, researchRootOverride } = {}) {
  // The outer "Notes de bas de page" section defaults to collapsed in
  // Project mode (§5 of the UX correction) — default it open here, as this
  // file is about the scope of its content, not its own collapse state.
  if (fixture.settings.collapsed["research:footnotes-overview"] === undefined) {
    fixture.settings.collapsed["research:footnotes-overview"] = false;
  }
  const contentEl = new FakeElement();
  let currentActiveFile = activeFile;
  const app = {
    vault: fixture.vault,
    workspace: { getActiveFile: () => currentActiveFile },
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
  view.researchActiveSubTab = "references";
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

  return { view, contentEl, setActiveFile: (file) => { currentActiveFile = file; } };
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

function footnoteLabels(contentEl) {
  return contentEl.querySelectorAll(".feuillets-footnotes-overview-label").map((el) => el.text);
}

function footnoteTexts(contentEl) {
  return contentEl.querySelectorAll(".feuillets-footnotes-overview-text").map((el) => el.text);
}

function footnoteSectionTitles(contentEl) {
  const title = t("shared.footnotes.title");
  return contentEl.querySelectorAll(".feuillets-notes-section-title").filter((el) => el.text === title);
}

function groupSummary(name, count) {
  return `${name} — ${count} note${count > 1 ? "s" : ""}`;
}

/** Reconstructs each compact tree row's "{name} — {count} note{s}" summary
 * from its dedicated .feuillets-footnotes-tree-label/-badge spans — folder
 * nodes never use .feuillets-notes-section-title (§5/§9 of the UX
 * correction). */
function footnoteGroupTitles(contentEl) {
  return contentEl.querySelectorAll(".feuillets-footnotes-tree-row").map((row) => {
    const label = row.children.find((c) => c.classes.has("feuillets-footnotes-tree-label"));
    const badge = row.children.find((c) => c.classes.has("feuillets-footnotes-tree-badge"));
    return groupSummary(label?.text || "", Number(badge?.text || "0"));
  });
}

/* --- Scope-driven content --- */

test("Project scope shows a compact group summary for every top-level folder of the project", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: null, scopeMode: "project" });
  const titles = footnoteGroupTitles(contentEl);
  assert.ok(titles.includes(groupSummary("Work-A", 2)), "Work-A groups its own footnote and its subfolder's");
  assert.ok(titles.includes(groupSummary("Work-A-Extra", 1)));
  assert.ok(titles.includes(groupSummary("Work-B", 1)));
});

test("Workspace scope shows only the footnotes of the isolated space", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const labels = footnoteLabels(contentEl);
  assert.ok(labels.includes("[^a]"), "own document's footnote must appear");
  assert.ok(labels.includes("[^b]"), "nested document's footnote must appear");
  assert.ok(!labels.includes("[^c]"), "Work-A-Extra footnote must never appear");
  assert.ok(!labels.includes("[^d]"), "sibling Work-B footnote must never appear");
});

test("a sibling space's footnotes are excluded", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workB, scopeMode: "workspace" });
  const labels = footnoteLabels(contentEl);
  assert.deepEqual(labels, ["[^d]"]);
});

test("footnotes nested inside a subfolder of the space are included", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const texts = footnoteTexts(contentEl);
  assert.ok(texts.includes("Footnote B text"), "the subfolder's footnote text must be rendered");
});

test("Work-A and Work-A-Extra are never confused", async () => {
  const fixture = makeFixture();
  const workAContent = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.ok(!footnoteLabels(workAContent).includes("[^c]"), "Work-A must never show Work-A-Extra's footnote");

  const workAExtraContent = await renderWithDocument(fixture, { workspace: fixture.workAExtra, scopeMode: "workspace" });
  assert.deepEqual(footnoteLabels(workAExtraContent), ["[^c]"]);
});

/* --- Decoupled from the Sources folder --- */

test("footnotes render even without a Sources folder", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, {
    workspace: null,
    scopeMode: "project",
    researchRootOverride: null,
  });
  assert.ok(footnoteGroupTitles(contentEl).includes(groupSummary("Work-A", 2)));
  assert.equal(footnoteSectionTitles(contentEl).length, 1);
});

/* --- Both Research branches --- */

test("footnotes render in the Research branch exactly associated with the isolated space", async () => {
  const fixture = makeFixture();
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;

  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const labels = footnoteLabels(contentEl);
  assert.ok(labels.includes("[^a]"));
  assert.ok(labels.includes("[^b]"));
  assert.ok(!labels.includes("[^c]"));
  assert.ok(!labels.includes("[^d]"));
});

test("the footnotes section never appears twice, in either Research branch", async () => {
  const fixture = makeFixture();

  const generalContent = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "project" });
  assert.equal(footnoteSectionTitles(generalContent).length, 1);

  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;
  const associatedContent = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.equal(footnoteSectionTitles(associatedContent).length, 1);
});

/* --- Independence from the active file --- */

test("changing only the active file never changes the rendered footnotes", async () => {
  const fixture = makeFixture();
  const { view, contentEl, setActiveFile } = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace", activeFile: fixture.sceneA });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    const first = footnoteLabels(contentEl);

    setActiveFile(fixture.researchNote);
    await view.render(true);
    const second = footnoteLabels(contentEl);

    setActiveFile(fixture.attachmentPdf);
    await view.render(true);
    const third = footnoteLabels(contentEl);

    setActiveFile(fixture.sceneB);
    await view.render(true);
    const fourth = footnoteLabels(contentEl);

    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
    assert.deepEqual(fourth, first);
  } finally {
    globalThis.document = prevDoc;
  }
});

/* --- Existing Project-mode behavior preserved --- */

test("Project mode keeps the existing empty state when no document has footnotes", async () => {
  const fixture = makeFixture();
  fixture.sceneA.content = "No footnote here.";
  fixture.sceneASub.content = "Nor here.";
  fixture.sceneAExtra.content = "Nor here either.";
  fixture.sceneB.content = "Still nothing.";

  const previousLocale = getLocale();
  setLocale("fr");
  try {
    const contentEl = await renderWithDocument(fixture, { workspace: null, scopeMode: "project" });
    // §5 of the UX correction: an empty Notes section is never rendered at
    // all — no title, no empty-state message left behind.
    assert.equal(footnoteSectionTitles(contentEl).length, 0);
    const emptyMessages = contentEl.querySelectorAll(".feuillets-research-empty").filter(
      (el) => el.text === t("shared.footnotes.empty")
    );
    assert.equal(emptyMessages.length, 0);
  } finally {
    setLocale(previousLocale);
  }
});

/* --- Purity: no mutation, no re-scan --- */

test("renderFootnotesOverviewSection never calls plugin.flattenFiles and never mutates documentContext.files", async () => {
  const fixture = makeFixture();
  const documentContext = {
    mode: "workspace",
    projectRoot: fixture.projectRoot,
    scopeRoot: fixture.workA,
    workspaceRoot: fixture.workA,
    files: [fixture.sceneA, fixture.sceneASub],
  };
  const originalFilesRef = documentContext.files;
  const originalOrder = documentContext.files.map((f) => f.path);

  const app = {
    vault: fixture.vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: { getActiveFile: () => null },
  };
  const plugin = {
    settings: fixture.settings,
    app,
    buildNumbering: () => new Map(),
    shortTitleFor: (f) => f.basename,
    saveSettings: async () => {},
    flattenFiles: () => {
      throw new Error("renderFootnotesOverviewSection must not call plugin.flattenFiles");
    },
  };
  const leaf = { app, contentEl: new FakeElement() };
  const view = new ResearchView(leaf, plugin);
  const container = new FakeElement();

  await view.renderFootnotesOverviewSection(container, documentContext);

  assert.equal(documentContext.files, originalFilesRef, "the files array reference must be unchanged");
  assert.deepEqual(documentContext.files.map((f) => f.path), originalOrder, "the files order/content must be unchanged");
  assert.ok(footnoteLabels(container).includes("[^a]"));
});
