import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { resolveActiveFileResearchFolders } from "../src/services/workspace-research.js";
import { ResearchView } from "../src/views/research-view.js";
import { PROJECT_MODES } from "../src/utils/project-modes.js";

class FakeElement {
  constructor(options = {}) {
    this.parent = null;
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
    this.value = "";
    this.attrs = new Map();
    this.style = {};
    this.scrollTop = 0;
    this.selectionStart = null;
    this.selectionEnd = null;
    this.hidden = false;
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

  querySelector(selector) {
    return this.find(selector);
  }

  querySelectorAll(selector) {
    const results = [];
    const match = (el) => {
      if (selector.startsWith(".")) {
        return el.classes.has(selector.slice(1));
      }
      if (selector.startsWith("[") && selector.endsWith("]")) {
        const attrExpr = selector.slice(1, -1);
        if (attrExpr.includes("=")) {
          const [name, rawVal] = attrExpr.split("=");
          const val = rawVal.replace(/^["']|["']$/g, "");
          return el.attrs.get(name) === val;
        }
        return el.attrs.has(attrExpr);
      }
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

  focus() {}
  setSelectionRange() {}
  addEventListener(type, callback) {
    this.events ||= new Map();
    this.events.set(type, callback);
  }
  setText(text) {
    this.text = String(text);
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name) {
    return this.attrs.get(name);
  }
  setAttr(name, value) {
    this.setAttribute(name, value);
  }
  getAttr(name) {
    return this.getAttribute(name);
  }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  empty() { this.children = []; }
  contains() { return false; }
  setCssStyles() {}
}

function createFixture() {
  const project = new TFolder("PROJECT");
  const workA = new TFolder("PROJECT/Work-A");
  const sectionA = new TFolder("PROJECT/Work-A/Section-A");
  const docA = new TFile("PROJECT/Work-A/Section-A/Document-A.md", "");
  const chapterA = new TFolder("PROJECT/Work-A/Section-A/Chapter-A");
  const chapterDocA = new TFile("PROJECT/Work-A/Section-A/Chapter-A/Document-A.md", "");
  const directDoc = new TFile("PROJECT/Work-A/Direct-Document.md", "");
  const sectionB = new TFolder("PROJECT/Work-A/Section-B");
  const docB = new TFile("PROJECT/Work-A/Section-B/Document-B.md", "");
  const workB = new TFolder("PROJECT/Work-B");
  const workAExtra = new TFolder("PROJECT/Work-A-Extra");
  const docExtra = new TFile("PROJECT/Work-A-Extra/Document-Extra.md", "");

  const researchRoot = new TFolder("RESEARCH");
  const projectNotes = new TFolder("RESEARCH/Project-Notes");
  const workAResearch = new TFolder("RESEARCH/Work-A-Research");
  const sectionAResearchNested = new TFolder("RESEARCH/Work-A-Research/Section-A-Research");
  const sectionAResearchSeparate = new TFolder("RESEARCH/Section-A-Research");
  const chapterAResearch = new TFolder("RESEARCH/Chapter-A-Research");
  const directDocResearch = new TFolder("RESEARCH/Direct-Document-Research");
  const sectionBResearch = new TFolder("RESEARCH/Section-B-Research");
  const noteB = new TFile("RESEARCH/Section-B-Research/Note-B.md", "");
  const workBResearch = new TFolder("RESEARCH/Work-B-Research");
  const noteWorkB = new TFile("RESEARCH/Work-B-Research/Note-Work-B.md", "");
  const workAExtraResearch = new TFolder("RESEARCH/Work-A-Extra-Research");

  project.children = [workA, workB, workAExtra];
  workA.parent = project;
  workA.children = [sectionA, sectionB, directDoc];
  directDoc.parent = workA;
  sectionA.parent = workA;
  sectionA.children = [docA, chapterA];
  docA.parent = sectionA;
  chapterA.parent = sectionA;
  chapterA.children = [chapterDocA];
  chapterDocA.parent = chapterA;
  sectionB.parent = workA;
  sectionB.children = [docB];
  docB.parent = sectionB;
  workB.parent = project;
  workAExtra.parent = project;
  workAExtra.children = [docExtra];
  docExtra.parent = workAExtra;

  researchRoot.children = [projectNotes];
  projectNotes.parent = researchRoot;

  workAResearch.children = [sectionAResearchNested];
  sectionAResearchNested.parent = workAResearch;

  sectionBResearch.children = [noteB];
  noteB.parent = sectionBResearch;

  workBResearch.children = [noteWorkB];
  noteWorkB.parent = workBResearch;

  const { vault } = createFakeVault([
    project, workA, sectionA, docA, chapterA, chapterDocA, directDoc, sectionB, docB, workB, workAExtra, docExtra,
    researchRoot, projectNotes, workAResearch, sectionAResearchNested, sectionAResearchSeparate, chapterAResearch,
    directDocResearch, sectionBResearch, noteB, workBResearch, noteWorkB, workAExtraResearch,
  ]);

  const settings = {
    projectFolder: project.path,
    researchSearch: "",
    researchTagFilter: "",
    collapsed: {},
    orders: {},
    folderPositions: {},
    researchOrder: {},
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          "PROJECT/Work-A": "RESEARCH/Work-A-Research",
          "PROJECT/Work-A/Section-A": "RESEARCH/Work-A-Research/Section-A-Research",
          "PROJECT/Work-A/Section-B": "RESEARCH/Section-B-Research",
          "PROJECT/Work-B": "RESEARCH/Work-B-Research",
        },
      },
    },
    labels: [],
  };

  return {
    vault,
    settings,
    project,
    workA,
    sectionA,
    docA,
    chapterA,
    chapterDocA,
    directDoc,
    sectionB,
    docB,
    workB,
    workAExtra,
    docExtra,
    researchRoot,
    projectNotes,
    workAResearch,
    sectionAResearchNested,
    sectionAResearchSeparate,
    chapterAResearch,
    directDocResearch,
    sectionBResearch,
    noteB,
    workBResearch,
    noteWorkB,
    workAExtraResearch,
  };
}

function createResearchView(fixture, { currentWorkspace, activeFile }) {
  const contentEl = new FakeElement();
  let currentActiveFile = activeFile;
  fixture.vault.cachedRead = async (file) => file.content || "";
  const leaf = {
    app: {
      vault: fixture.vault,
      workspace: {
        getActiveFile: () => currentActiveFile,
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: {} }),
      },
    },
    contentEl,
  };
  const plugin = {
    settings: fixture.settings,
    app: leaf.app,
    getProjectFolder: () => fixture.project,
    getWorkspaceFolder: () => currentWorkspace,
    getResearchRoot: () => fixture.researchRoot,
    getChronoFolder: () => null,
    buildNumbering: () => new Map(),
    async ensureFolder() {},
    projectMode: () => PROJECT_MODES.fiction,
    async migrateBibliographieIntoSources() {},
    async saveSettings() {},
    tagsOf: () => [],
    titleFor: (f) => f.basename?.replace(/\.md$/, "") ?? f.name,
    fmOf: () => ({}),
    labelOf: () => "",
    labelColor: () => null,
    newFolder() {},
    flattenFiles: (folder) => {
      const results = [];
      const walk = (f) => {
        for (const c of f.children || []) {
          if (c instanceof TFile) results.push(c);
          else if (c instanceof TFolder) walk(c);
        }
      };
      walk(folder);
      return results;
    },
    getLinkedResearchFolders: () => [],
  };

  const view = new ResearchView(leaf, plugin);
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

  return {
    view,
    contentEl,
    setActiveFile: (file) => {
      currentActiveFile = file;
    },
  };
}

/* =========================================================================
   Unit tests: resolveActiveFileResearchFolders (A1 - A10)
   ========================================================================= */

test("A1: returns empty array when workspaceFolder is invalid or missing", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  assert.deepEqual(resolveActiveFileResearchFolders(app, fixture.settings, null, fixture.docA), []);
  assert.deepEqual(resolveActiveFileResearchFolders(app, fixture.settings, undefined, fixture.docA), []);
  assert.deepEqual(resolveActiveFileResearchFolders(app, fixture.settings, fixture.docA, fixture.docA), []);
});

test("A2: returns empty array when activeFile is invalid or missing", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  assert.deepEqual(resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, null), []);
  assert.deepEqual(resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, undefined), []);
  assert.deepEqual(resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.sectionA), []);
});

test("A3: returns empty array when activeFile is outside workspaceFolder", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  const rootDoc = new TFile("PROJECT/Root.md", "");
  rootDoc.parent = fixture.project;
  fixture.vault.create("PROJECT/Root.md", "");

  // activeFile is in a sibling workspace (Work-B), outside Work-A
  assert.deepEqual(resolveActiveFileResearchFolders(app, fixture.settings, fixture.workB, fixture.docA), []);
  // activeFile is at project root, outside Work-A
  assert.deepEqual(resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, rootDoc), []);
});

test("A4: returns empty array when activeFile is directly under workspaceFolder with no associations", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  const directDoc = new TFile("PROJECT/Work-A/Direct.md", "");
  directDoc.parent = fixture.workA;
  fixture.vault.create("PROJECT/Work-A/Direct.md", "");

  const result = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, directDoc);
  assert.deepEqual(result, []);
});

test("A5: resolves intermediate branch folder associations between workspace and active file", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };

  const result = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.docA);
  assert.equal(result.length, 1);
  assert.equal(result[0].folder.path, fixture.sectionAResearchNested.path);
  assert.equal(result[0].binderNode.path, fixture.sectionA.path);
});

test("A6: resolves active file direct association if present", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  links["PROJECT/Work-A/Section-A/Document-A.md"] = "RESEARCH/Section-A-Research";

  const result = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.docA);
  assert.equal(result.length, 2);
  assert.equal(result[0].folder.path, fixture.sectionAResearchNested.path);
  assert.equal(result[0].binderNode.path, fixture.sectionA.path);
  assert.equal(result[1].folder.path, fixture.sectionAResearchSeparate.path);
  assert.equal(result[1].binderNode.path, fixture.docA.path);
});

test("A7: strictly excludes sibling folder associations", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };

  // docA is in Section-A; Section-B is a sibling
  const result = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.docA);
  const foundPaths = result.map((r) => r.folder.path);
  assert.ok(!foundPaths.includes("RESEARCH/Section-B-Research"));
});

test("A8: excludes workspace boundary folder itself and ancestor folders outside workspace", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };

  const result = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.docA);
  const binderPaths = result.map((r) => r.binderNode.path);
  assert.ok(!binderPaths.includes("PROJECT/Work-A"), "workspace folder itself is not included");
  assert.ok(!binderPaths.includes("PROJECT"), "ancestor of workspace is not included");
});

test("A9: deduplicates multiple branch associations pointing to the same research folder preserving first occurrence", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  // Both Section-A and Document-A point to the same target folder
  links["PROJECT/Work-A/Section-A"] = "RESEARCH/Section-A-Research";
  links["PROJECT/Work-A/Section-A/Document-A.md"] = "RESEARCH/Section-A-Research";

  const result = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.docA);
  assert.equal(result.length, 1);
  assert.equal(result[0].folder.path, "RESEARCH/Section-A-Research");
  assert.equal(result[0].binderNode.path, fixture.sectionA.path);
});

test("A10: cleanly ignores non-existent or orphaned research folder targets without mutating settings", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  links["PROJECT/Work-A/Section-A"] = "RESEARCH/NonExistent";
  const before = JSON.stringify(fixture.settings);

  const result = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.docA);
  assert.deepEqual(result, []);
  assert.equal(JSON.stringify(fixture.settings), before);
});

/* =========================================================================
   Integration tests: ResearchView (B, C, D)
   ========================================================================= */

test("B: ResearchView renders isolated workspace research and gives access to active branch research while excluding siblings", async () => {
  const fixture = createFixture();
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  // Section-A has separate external research folder (not physically nested in Work-A-Research)
  links["PROJECT/Work-A/Section-A"] = "RESEARCH/Section-A-Research";

  const { view, contentEl } = createResearchView(fixture, {
    currentWorkspace: fixture.workA,
    activeFile: fixture.docA,
  });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render();
  } finally {
    globalThis.document = prevDoc;
  }

  // Primary workspace research for Work-A must be rendered
  const workAHeaders = contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Work-A-Research"]');
  assert.equal(workAHeaders.length, 1, "Work-A-Research must be rendered as primary workspace research");

  // Active branch research (Section-A-Research) must be rendered
  const sectionAHeaders = contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Section-A-Research"]');
  assert.equal(sectionAHeaders.length, 1, "Section-A-Research must be accessible in the research panel");

  // Sibling research (Section-B-Research) must NOT appear
  const sectionBHeaders = contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Section-B-Research"]');
  assert.equal(sectionBHeaders.length, 0, "Sibling Section-B-Research must not appear");
});

test("B2: the complete Research panel lists office attachments from the workspace research folder", async () => {
  const fixture = createFixture();
  const guide = new TFile("RESEARCH/Work-A-Research/Guide.docx", "");
  const workbook = new TFile("RESEARCH/Work-A-Research/Data.xlsx", "");
  guide.parent = fixture.workAResearch;
  workbook.parent = fixture.workAResearch;
  fixture.workAResearch.children.push(guide, workbook);

  const { view, contentEl } = createResearchView(fixture, {
    currentWorkspace: fixture.workA,
    activeFile: fixture.docA,
  });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render();
  } finally {
    globalThis.document = prevDoc;
  }

  const names = contentEl
    .querySelectorAll(".feuillets-research-item-name")
    .map((element) => element.text);
  assert.ok(names.includes("Guide.docx"), "DOCX must be listed by the complete Research panel");
  assert.ok(names.includes("Data.xlsx"), "XLSX must be listed by the complete Research panel");
});

test("C: ResearchView displays section research without duplication when the section itself is isolated", async () => {
  const fixture = createFixture();
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  links["PROJECT/Work-A/Section-A"] = "RESEARCH/Section-A-Research";

  // Section-A is now isolated
  const { view, contentEl } = createResearchView(fixture, {
    currentWorkspace: fixture.sectionA,
    activeFile: fixture.docA,
  });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render();
  } finally {
    globalThis.document = prevDoc;
  }

  // Section-A-Research is the main research folder
  const sectionAHeaders = contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Section-A-Research"]');
  assert.equal(sectionAHeaders.length, 1, "Section-A-Research must appear exactly once without duplicates");

  // Work-A research is outside isolated Section-A boundary and not rendered as workspace research
  const workAHeaders = contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Work-A-Research"]');
  assert.equal(workAHeaders.length, 0, "Work-A-Research must not be rendered when Section-A is isolated");
});

test("D: ResearchView prevents duplicate section rendering when active branch research is physically nested under workspace research", async () => {
  const fixture = createFixture();
  // Section-A-Research is physically located inside Work-A-Research:
  // "RESEARCH/Work-A-Research/Section-A-Research"
  // Both Work-A and Section-A have associations
  const { view, contentEl } = createResearchView(fixture, {
    currentWorkspace: fixture.workA,
    activeFile: fixture.docA,
  });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render();
  } finally {
    globalThis.document = prevDoc;
  }

  // Section-A-Research is rendered inside Work-A-Research's subfolder tree,
  // and must NOT be rendered a second time as a separate root section
  const nestedHeaders = contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Work-A-Research/Section-A-Research"]');
  assert.equal(nestedHeaders.length, 1, "Physically nested Section-A-Research must appear exactly once in the DOM");
});

/* =========================================================================
   Missing regression tests (1 - 6)
   ========================================================================= */

test("Regression 1: multi-level branch chain resolves in broad-to-narrow order and excludes workspace research", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  links["PROJECT/Work-A"] = "RESEARCH/Work-A-Research";
  links["PROJECT/Work-A/Section-A"] = "RESEARCH/Section-A-Research";
  links["PROJECT/Work-A/Section-A/Chapter-A"] = "RESEARCH/Chapter-A-Research";

  const results = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.chapterDocA);

  assert.equal(results.length, 2);
  assert.equal(results[0].folder.path, "RESEARCH/Section-A-Research");
  assert.equal(results[0].binderNode.path, "PROJECT/Work-A/Section-A");
  assert.equal(results[1].folder.path, "RESEARCH/Chapter-A-Research");
  assert.equal(results[1].binderNode.path, "PROJECT/Work-A/Section-A/Chapter-A");

  // Assert Work-A's own research is excluded because it is the main workspace research
  const returnedPaths = results.map((r) => r.folder.path);
  assert.ok(!returnedPaths.includes("RESEARCH/Work-A-Research"));
});

test("Regression 2: real active-file transition removes old branch research and renders new active target", async () => {
  const fixture = createFixture();
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  links["PROJECT/Work-A"] = "RESEARCH/Work-A-Research";
  links["PROJECT/Work-A/Section-A"] = "RESEARCH/Section-A-Research";
  links["PROJECT/Work-A/Section-A/Chapter-A"] = "RESEARCH/Chapter-A-Research";
  links["PROJECT/Work-A/Direct-Document.md"] = "RESEARCH/Direct-Document-Research";

  const { view, contentEl, setActiveFile } = createResearchView(fixture, {
    currentWorkspace: fixture.workA,
    activeFile: fixture.chapterDocA,
  });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    // Initial render with chapterDocA active
    await view.render();

    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Section-A-Research"]').length, 1);
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Chapter-A-Research"]').length, 1);
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Direct-Document-Research"]').length, 0);

    // Transition active file to direct document
    setActiveFile(fixture.directDoc);
    await view.render(true);

    // Assert Section-A-Research and Chapter-A-Research disappear
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Section-A-Research"]').length, 0);
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Chapter-A-Research"]').length, 0);

    // Assert Direct-Document-Research appears
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Direct-Document-Research"]').length, 1);

    // Assert Work-A-Research remains as primary workspace research
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Work-A-Research"]').length, 1);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("Regression 3: workspace-to-project mode transition disables active-branch projection and preserves project view", async () => {
  const fixture = createFixture();
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  links["PROJECT/Work-A"] = "RESEARCH/Work-A-Research";
  links["PROJECT/Work-A/Section-A"] = "RESEARCH/Section-A-Research";

  const { view, contentEl } = createResearchView(fixture, {
    currentWorkspace: fixture.workA,
    activeFile: fixture.docA,
  });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    // Workspace mode render
    await view.render();
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Section-A-Research"]').length, 1);

    // Switch view mode to project
    view.researchScopeMode = "project";
    await view.render(true);

    // Assert active-branch projected section is not rendered as additional workspace section
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Section-A-Research"]').length, 0);

    // Assert project-mode rendering is intact (project notes rendered under research root)
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Project-Notes"]').length, 1);
    assert.ok(contentEl.find(".feuillets-research-body") !== null);
  } finally {
    globalThis.document = prevDoc;
  }
});

test("Regression 4: strict path boundary ensures Work-A is not treated as ancestor of Work-A-Extra", async () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  links["PROJECT/Work-A"] = "RESEARCH/Work-A-Research";
  links["PROJECT/Work-A-Extra"] = "RESEARCH/Work-A-Extra-Research";

  // Resolver call: Work-A with active Document-Extra (in Work-A-Extra)
  const results = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.docExtra);
  assert.deepEqual(results, []);

  // View integration: verify Work-A-Extra-Research is not rendered
  const { view, contentEl } = createResearchView(fixture, {
    currentWorkspace: fixture.workA,
    activeFile: fixture.docExtra,
  });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render();
    assert.equal(
      contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Work-A-Extra-Research"]').length,
      0,
      "No research associated with Work-A-Extra must be rendered"
    );
  } finally {
    globalThis.document = prevDoc;
  }
});

test("Regression 5: DOM sibling and outside research folders and their files are strictly excluded", async () => {
  const fixture = createFixture();
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  links["PROJECT/Work-A"] = "RESEARCH/Work-A-Research";
  links["PROJECT/Work-A/Section-A"] = "RESEARCH/Section-A-Research";
  links["PROJECT/Work-A/Section-B"] = "RESEARCH/Section-B-Research";
  links["PROJECT/Work-B"] = "RESEARCH/Work-B-Research";

  const { view, contentEl } = createResearchView(fixture, {
    currentWorkspace: fixture.workA,
    activeFile: fixture.docA,
  });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render();

    // Assert Section-B-Research and Work-B-Research headers/sections are absent
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Section-B-Research"]').length, 0);
    assert.equal(contentEl.querySelectorAll('[data-research-folder-path="RESEARCH/Work-B-Research"]').length, 0);

    // Assert no file from either folder is rendered in the panel body
    assert.equal(contentEl.querySelectorAll('[data-path="RESEARCH/Section-B-Research/Note-B.md"]').length, 0);
    assert.equal(contentEl.querySelectorAll('[data-path="RESEARCH/Work-B-Research/Note-Work-B.md"]').length, 0);

    // Search all rendered item names
    const itemNames = contentEl.querySelectorAll(".feuillets-research-item-name").map((el) => el.text);
    assert.ok(!itemNames.includes("Note-B"));
    assert.ok(!itemNames.includes("Note-Work-B"));
  } finally {
    globalThis.document = prevDoc;
  }
});

test("Regression 6: normal valid resolution does not mutate settings.projectMeta", () => {
  const fixture = createFixture();
  const app = { vault: fixture.vault };
  const links = fixture.settings.projectMeta[fixture.project.path].researchFolderLinks;
  links["PROJECT/Work-A"] = "RESEARCH/Work-A-Research";
  links["PROJECT/Work-A/Section-A"] = "RESEARCH/Section-A-Research";
  links["PROJECT/Work-A/Section-A/Chapter-A"] = "RESEARCH/Chapter-A-Research";

  const before = JSON.stringify(fixture.settings.projectMeta);
  const results = resolveActiveFileResearchFolders(app, fixture.settings, fixture.workA, fixture.chapterDocA);

  assert.equal(results.length, 2);
  const after = JSON.stringify(fixture.settings.projectMeta);
  assert.equal(after, before);
});
