import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import {
  createCitekeyTriggerExtension,
  insertCitekey,
  insertCitation,
  cleanCitationPages,
  formatCitationReferenceItem,
  isInsideOpenCitationGroup,
} from "../src/utils/cm-citekey-trigger.js";
import { CitekeyModal } from "../src/ui/citekey-modal.js";
import {
  searchBibtexCatalog,
  getCachedBibtexCatalog,
  clearBibtexCatalogCache,
} from "../src/services/bibtex-catalog.js";
import { resolveWorkspaceCitationResources } from "../src/services/workspace-citations.js";
import { ScriveningsView, ScriveningsSession, resolveCitekeySegment } from "../src/views/scrivenings-view.js";
import { buildScriveningsDocument, segmentAt } from "../src/services/scrivenings-document.js";
import { scriveningsChangeListener } from "../src/utils/cm-scrivenings.js";
import { createFakeVault } from "./helpers/fake-vault.js";

function createGenericCitationFixture() {
  const project = new TFolder("PROJECT");
  const workA = new TFolder("PROJECT/Work-A");
  const chapterA = new TFolder("PROJECT/Work-A/Chapter-A");
  const docA = new TFile("PROJECT/Work-A/Chapter-A/Document-A.md");
  docA.extension = "md";

  const workAExtra = new TFolder("PROJECT/Work-A-Extra");
  const docExtra = new TFile("PROJECT/Work-A-Extra/Document-Extra.md");
  docExtra.extension = "md";

  const workB = new TFolder("PROJECT/Work-B");
  const docB = new TFile("PROJECT/Work-B/Document-B.md");
  docB.extension = "md";

  chapterA.parent = workA;
  chapterA.children = [docA];
  docA.parent = chapterA;

  workA.parent = project;
  workA.children = [chapterA];

  workAExtra.parent = project;
  workAExtra.children = [docExtra];
  docExtra.parent = workAExtra;

  workB.parent = project;
  workB.children = [docB];
  docB.parent = workB;

  project.children = [workA, workAExtra, workB];

  // Research folders
  const projectResearch = new TFolder("RESEARCH/Project-Research");
  const projectBib = new TFile("RESEARCH/Project-Research/project.bib");
  projectBib.extension = "bib";
  projectBib.content = `@article{projectRef2020,
    author = {ProjectAuthor, Paul},
    title = {Project Level Document},
    year = {2020}
  }`;
  projectBib.stat = { mtime: 1000, size: projectBib.content.length };
  projectBib.parent = projectResearch;
  projectResearch.children = [projectBib];

  const researchA = new TFolder("RESEARCH/Research-A");
  const workABib = new TFile("RESEARCH/Research-A/workA.bib");
  workABib.extension = "bib";
  workABib.content = `@article{smith2024,
    author = {Smith, John},
    title = {Work A Reference},
    year = {2024}
  }
  @article{taylor2021,
    author = {Taylor, Tim},
    title = {Secondary Work A Reference},
    year = {2021}
  }`;
  workABib.stat = { mtime: 1001, size: workABib.content.length };
  workABib.parent = researchA;
  researchA.children = [workABib];

  const researchB = new TFolder("RESEARCH/Research-B");
  const workBBib = new TFile("RESEARCH/Research-B/workB.bib");
  workBBib.extension = "bib";
  workBBib.content = `@article{jones2023,
    author = {Jones, Alice},
    title = {Work B Reference},
    year = {2023}
  }`;
  workBBib.stat = { mtime: 1002, size: workBBib.content.length };
  workBBib.parent = researchB;
  researchB.children = [workBBib];

  const emptyBib = new TFile("RESEARCH/Research-A/empty.bib");
  emptyBib.extension = "bib";
  emptyBib.content = "% Only bibtex comments\n";
  emptyBib.stat = { mtime: 1003, size: emptyBib.content.length };
  emptyBib.parent = researchA;
  researchA.children.push(emptyBib);

  const { vault } = createFakeVault([
    project,
    workA,
    chapterA,
    docA,
    workAExtra,
    docExtra,
    workB,
    docB,
    projectResearch,
    projectBib,
    researchA,
    workABib,
    emptyBib,
    researchB,
    workBBib,
  ]);

  // Ensure cachedRead is available on vault
  vault.cachedRead = async (file) => file.content || "";

  const settings = {
    projectFolder: project.path,
    projects: [project.path],
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [project.path]: projectResearch.path,
          [workA.path]: researchA.path,
          [workB.path]: researchB.path,
        },
        citekeyBibliographyPath: "project.bib",
        folderWorkspaces: {
          "Work-A": {
            version: 1,
            citekeyBibliographyPath: "workA.bib",
          },
          "Work-B": {
            version: 1,
            citekeyBibliographyPath: "workB.bib",
          },
        },
      },
    },
  };

  const app = { vault };

  return {
    app,
    vault,
    settings,
    project,
    workA,
    chapterA,
    docA,
    workAExtra,
    docExtra,
    workB,
    docB,
    projectResearch,
    projectBib,
    researchA,
    workABib,
    emptyBib,
    researchB,
    workBBib,
  };
}

function createMockEditorView(initialText) {
  let text = initialText;
  let cursor = 0;
  let focused = false;

  return {
    state: {
      doc: {
        get length() {
          return text.length;
        },
        sliceString(from, to) {
          return text.slice(from, to);
        },
      },
      selection: {
        main: {
          get head() {
            return cursor;
          },
          get anchor() {
            return cursor;
          },
          get empty() {
            return true;
          },
        },
      },
    },
    dispatch(spec) {
      text =
        text.slice(0, spec.changes.from) +
        spec.changes.insert +
        text.slice(spec.changes.to);
      cursor = spec.selection.anchor;
    },
    focus() {
      focused = true;
    },
    getText() {
      return text;
    },
    setText(newText) {
      text = newText;
    },
    getCursor() {
      return cursor;
    },
    isFocused() {
      return focused;
    },
  };
}

function createTestPlugin(f, activeWorkspaceFolder = null) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = f.app;
  plugin.settings = f.settings;
  plugin._activeCitekeyViews = new WeakSet();
  plugin.getProjectFolder = () => f.project;
  plugin.getWorkspaceFolder = () => activeWorkspaceFolder;
  plugin.notifyContinuDocumentChanged = () => {};
  return plugin;
}

test("1. Workspace A uses only its .bib", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.file?.path, f.workABib.path);

  const entries = await getCachedBibtexCatalog(f.app, res.bibliography.file);
  const keys = entries.map((e) => e.key);
  assert.ok(keys.includes("smith2024"));
  assert.ok(keys.includes("taylor2021"));
  assert.equal(keys.includes("jones2023"), false);
});

test("2. no entry from Workspace B .bib appears", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  const entries = await getCachedBibtexCatalog(f.app, res.bibliography.file);
  const jonesResults = searchBibtexCatalog(entries, "jones");
  assert.equal(jonesResults.length, 0);
  assert.equal(entries.some((e) => e.key === "jones2023"), false);
});

test("3. Work-A-Extra is never considered a descendant of Work-A", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  const plugin = createTestPlugin(f, f.workA);

  const view = createMockEditorView("Document [@");
  const range = { from: 9, to: 11 };

  let modalOpened = false;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = function () {
    modalOpened = true;
  };

  try {
    // Attempting to open citekey picker for docExtra (in Work-A-Extra) with workspace Work-A
    await plugin.openCitekeyPicker(view, range, f.docExtra, f.workA);
    assert.equal(modalOpened, false);
    // Verify lock was released
    assert.equal(plugin._activeCitekeyViews.has(view), false);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("4. inheritance of .bib from parent workspace", () => {
  const f = createGenericCitationFixture();
  // Chapter-A is under Work-A, not explicitly configured in folderWorkspaces
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.file?.path, f.workABib.path);
});

test("5. .bib at project level", () => {
  const f = createGenericCitationFixture();
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.file?.path, f.projectBib.path);
});

test("6. legacy compatibility of simple project", () => {
  const legacyProject = new TFolder("LEGACY-PROJECT");
  const legacyDoc = new TFile("LEGACY-PROJECT/Document.md");
  legacyDoc.extension = "md";
  legacyDoc.parent = legacyProject;

  const legacyResearch = new TFolder("LEGACY-PROJECT/_Recherche");
  legacyResearch.parent = legacyProject;
  const legacyBib = new TFile("LEGACY-PROJECT/_Recherche/project.bib");
  legacyBib.extension = "bib";
  legacyBib.content = `@article{legacyRef2019,
    author = {LegacyAuthor, Luke},
    title = {Legacy Document},
    year = {2019}
  }`;
  legacyBib.stat = { mtime: 1004, size: legacyBib.content.length };
  legacyBib.parent = legacyResearch;
  legacyResearch.children = [legacyBib];
  legacyProject.children = [legacyDoc, legacyResearch];

  const { vault } = createFakeVault([
    legacyProject,
    legacyDoc,
    legacyResearch,
    legacyBib,
  ]);
  vault.cachedRead = async (file) => file.content || "";

  const settings = {
    projectFolder: legacyProject.path,
    projects: [legacyProject.path],
    projectMeta: {
      [legacyProject.path]: {
        pandocBibliographyPath: "project.bib",
      },
    },
  };
  const app = { vault };

  const res = resolveWorkspaceCitationResources(app, settings, legacyProject, null);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.source, "legacy");
  assert.equal(res.bibliography.file?.path, legacyBib.path);
  assert.equal(res.bibliography.researchFolder?.path, legacyResearch.path);
});

test("7. explicit disablement", async () => {
  const f = createGenericCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"].citekeyBibliographyPath = "";

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  assert.equal(res.bibliography.status, "disabled");
  assert.equal(res.bibliography.file, null);

  const plugin = createTestPlugin(f, f.workA);
  const view = createMockEditorView("[@");
  const range = { from: 0, to: 2 };
  let opened = false;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = () => { opened = true; };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.equal(opened, false);
    assert.equal(plugin._activeCitekeyViews.has(view), false);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("8. missing file", async () => {
  const f = createGenericCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"].citekeyBibliographyPath = "nonexistent.bib";

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  assert.equal(res.bibliography.status, "missing_file");
  assert.equal(res.bibliography.file, null);

  const plugin = createTestPlugin(f, f.workA);
  const view = createMockEditorView("[@");
  const range = { from: 0, to: 2 };
  let opened = false;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = () => { opened = true; };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.equal(opened, false);
    assert.equal(plugin._activeCitekeyViews.has(view), false);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("9. invalid path", async () => {
  const f = createGenericCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"].citekeyBibliographyPath = "../outside.bib";

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  assert.equal(res.bibliography.status, "invalid_path");
  assert.equal(res.bibliography.file, null);

  const plugin = createTestPlugin(f, f.workA);
  const view = createMockEditorView("[@");
  const range = { from: 0, to: 2 };
  let opened = false;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = () => { opened = true; };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.equal(opened, false);
    assert.equal(plugin._activeCitekeyViews.has(view), false);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("10. unlinked Research folder", async () => {
  const f = createGenericCitationFixture();
  // Sub-case 1: Work-A unlinked from research folder, inherits project research where workA.bib is missing
  delete f.settings.projectMeta[f.project.path].researchFolderLinks[f.workA.path];

  const resMissing = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  assert.equal(resMissing.bibliography.status, "missing_file");

  // Sub-case 2: unbound_research when no research folder is configured anywhere in hierarchy
  delete f.settings.projectMeta[f.project.path].researchFolderLinks[f.project.path];
  f.settings.projectMeta[f.project.path].researchFolderLinks = {};

  const resUnbound = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  assert.equal(resUnbound.bibliography.status, "unbound_research");
  assert.equal(resUnbound.bibliography.file, null);

  const plugin = createTestPlugin(f, f.workA);
  const view = createMockEditorView("[@");
  const range = { from: 0, to: 2 };
  let opened = false;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = () => { opened = true; };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.equal(opened, false);
    assert.equal(plugin._activeCitekeyViews.has(view), false);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("11. empty .bib file", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"].citekeyBibliographyPath = "empty.bib";

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.file?.path, f.emptyBib.path);

  const plugin = createTestPlugin(f, f.workA);
  const view = createMockEditorView("[@");
  const range = { from: 0, to: 2 };
  let opened = false;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = () => { opened = true; };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.equal(opened, false);
    assert.equal(plugin._activeCitekeyViews.has(view), false);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("12. none of these cases modify settings and unconfigured status is detected", () => {
  const f = createGenericCitationFixture();
  const beforeJson = JSON.stringify(f.settings);

  resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workB);
  resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);

  const afterJson = JSON.stringify(f.settings);
  assert.equal(afterJson, beforeJson);

  const emptyMetaSettings = {
    projectFolder: f.project.path,
    projects: [f.project.path],
    projectMeta: {
      [f.project.path]: {
        researchFolderLinks: {},
        folderWorkspaces: {},
      },
    },
  };
  const resNotConfigured = resolveWorkspaceCitationResources(f.app, emptyMetaSettings, f.project, f.workAExtra);
  assert.equal(resNotConfigured.bibliography.status, "not_configured");
  assert.equal(resNotConfigured.bibliography.file, null);
});

test("13. user typing of [@ triggers exactly once", () => {
  let triggers = 0;
  let receivedRange = null;

  const extension = createCitekeyTriggerExtension((_view, range) => {
    triggers++;
    receivedRange = range;
  });

  const listener = extension.fn || extension.value || extension;
  const mockView = createMockEditorView("Hello [@");
  const cursor = 8;

  listener({
    docChanged: true,
    view: mockView,
    transactions: [
      {
        docChanged: true,
        isUserEvent: (ev) => ev === "input.type",
        startState: {
          selection: { main: { empty: true, head: cursor - 2 } },
        },
        state: {
          selection: { main: { empty: true, head: cursor } },
          doc: {
            length: 8,
            sliceString: (from, to) => "Hello [@".slice(from, to),
          },
        },
        changes: {
          iterChanges: (fn) => {
            fn(cursor - 2, cursor - 2, cursor - 2, cursor, { toString: () => "[@" });
          },
        },
      },
    ],
  });

  assert.equal(triggers, 1);
  assert.deepEqual(receivedRange, { from: 6, to: 8 });
});

test("14. paste of [@ does not trigger", () => {
  let triggers = 0;
  const extension = createCitekeyTriggerExtension(() => { triggers++; });
  const listener = extension.fn || extension.value || extension;
  const cursor = 8;

  listener({
    docChanged: true,
    view: createMockEditorView("Hello [@"),
    transactions: [
      {
        docChanged: true,
        isUserEvent: (ev) => ev === "input.paste",
        startState: { selection: { main: { empty: true, head: cursor - 2 } } },
        state: {
          selection: { main: { empty: true, head: cursor } },
          doc: { length: 8, sliceString: (from, to) => "Hello [@".slice(from, to) },
        },
        changes: {
          iterChanges: (fn) => {
            fn(cursor - 2, cursor - 2, cursor - 2, cursor, { toString: () => "[@" });
          },
        },
      },
    ],
  });

  assert.equal(triggers, 0);
});

test("15. undo and redo do not trigger", () => {
  let triggers = 0;
  const extension = createCitekeyTriggerExtension(() => { triggers++; });
  const listener = extension.fn || extension.value || extension;
  const cursor = 8;

  for (const ev of ["history.undo", "history.redo"]) {
    listener({
      docChanged: true,
      view: createMockEditorView("Hello [@"),
      transactions: [
        {
          docChanged: true,
          isUserEvent: (event) => event === ev,
          startState: { selection: { main: { empty: true, head: cursor } } },
          state: {
            selection: { main: { empty: true, head: cursor } },
            doc: { length: 8, sliceString: (from, to) => "Hello [@".slice(from, to) },
          },
          changes: {
            iterChanges: (fn) => {
              fn(cursor - 2, cursor - 2, cursor - 2, cursor, { toString: () => "[@" });
            },
          },
        },
      ],
    });
  }

  assert.equal(triggers, 0);
});

test("16. programmatic dispatch does not trigger", () => {
  let triggers = 0;
  const extension = createCitekeyTriggerExtension(() => { triggers++; });
  const listener = extension.fn || extension.value || extension;
  const cursor = 8;

  listener({
    docChanged: true,
    view: createMockEditorView("Hello [@"),
    transactions: [
      {
        docChanged: true,
        startState: { selection: { main: { empty: true, head: cursor } } },
        state: {
          selection: { main: { empty: true, head: cursor } },
          doc: { length: 8, sliceString: (from, to) => "Hello [@".slice(from, to) },
        },
        changes: {
          iterChanges: (fn) => {
            fn(cursor - 2, cursor - 2, cursor - 2, cursor, { toString: () => "[@" });
          },
        },
      },
    ],
  });

  assert.equal(triggers, 0);
});

test("17. selection replacement does not trigger", () => {
  let triggers = 0;
  const extension = createCitekeyTriggerExtension(() => { triggers++; });
  const listener = extension.fn || extension.value || extension;
  const cursor = 8;

  listener({
    docChanged: true,
    view: createMockEditorView("Hello [@"),
    transactions: [
      {
        docChanged: true,
        isUserEvent: (ev) => ev === "input.type",
        startState: { selection: { main: { empty: false, head: cursor } } },
        state: {
          selection: { main: { empty: true, head: cursor } },
          doc: { length: 8, sliceString: (from, to) => "Hello [@".slice(from, to) },
        },
        changes: {
          iterChanges: (fn) => {
            fn(cursor - 4, cursor - 2, cursor - 2, cursor, { toString: () => "[@" });
          },
        },
      },
    ],
  });

  assert.equal(triggers, 0);
});

test("18. closing modal preserves exactly [@", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  const plugin = createTestPlugin(f, f.workA);

  const view = createMockEditorView("Text [@ more");
  const range = { from: 5, to: 7 };

  let capturedModal = null;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = function () {
    capturedModal = this;
  };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.ok(capturedModal);
    assert.equal(plugin._activeCitekeyViews.has(view), true);

    capturedModal.onClose();

    assert.equal(view.getText(), "Text [@ more");
    assert.equal(plugin._activeCitekeyViews.has(view), false);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("19. selecting smith2024 produces exactly [@smith2024]", () => {
  const view = createMockEditorView("Draft [@");
  const range = { from: 6, to: 8 };

  const success = insertCitekey(view, range, "smith2024");
  assert.equal(success, true);
  assert.equal(view.getText(), "Draft [@smith2024]");
});

test("20. selecting with existing ] never produces ]]", () => {
  const view = createMockEditorView("Draft [@]");
  const range = { from: 6, to: 8 };

  const success = insertCitekey(view, range, "smith2024");
  assert.equal(success, true);
  assert.equal(view.getText(), "Draft [@smith2024]");
});

test("21. exact cursor position after insertion", () => {
  // Case A: without existing ]
  const viewA = createMockEditorView("Prefix [@ suffix");
  insertCitekey(viewA, { from: 7, to: 9 }, "smith2024");
  assert.equal(viewA.getText(), "Prefix [@smith2024] suffix");
  assert.equal(viewA.getCursor(), 7 + "[@smith2024]".length);
  assert.equal(viewA.isFocused(), true);

  // Case B: with existing ]
  const viewB = createMockEditorView("Prefix [@] suffix");
  insertCitekey(viewB, { from: 7, to: 9 }, "smith2024");
  assert.equal(viewB.getText(), "Prefix [@smith2024] suffix");
  assert.equal(viewB.getCursor(), 7 + "[@smith2024]".length);
  assert.equal(viewB.isFocused(), true);
});

test("22. stale range before opening: no modal", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  const plugin = createTestPlugin(f, f.workA);

  const view = createMockEditorView("Text modified");
  const staleRange = { from: 0, to: 2 };

  let opened = false;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = () => { opened = true; };

  try {
    await plugin.openCitekeyPicker(view, staleRange, f.docA, f.workA);
    assert.equal(opened, false);
    assert.equal(plugin._activeCitekeyViews.has(view), false);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("23. stale range before selection: no insertion", () => {
  const view = createMockEditorView("Original text [@");
  const range = { from: 14, to: 16 };

  // Doc text is modified before user confirms selection
  view.setText("Original text modified");

  const success = insertCitekey(view, range, "smith2024");
  assert.equal(success, false);
  assert.equal(view.getText(), "Original text modified");
});

test("24. two concurrent triggers: only one modal", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  const plugin = createTestPlugin(f, f.workA);

  const view = createMockEditorView("[@");
  const range = { from: 0, to: 2 };

  let openCount = 0;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = () => { openCount++; };

  try {
    const p1 = plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    const p2 = plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    await Promise.all([p1, p2]);

    assert.equal(openCount, 1);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("25. lock is released after closing", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  const plugin = createTestPlugin(f, f.workA);

  const view = createMockEditorView("[@");
  const range = { from: 0, to: 2 };

  let capturedModal = null;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = function () {
    capturedModal = this;
  };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.equal(plugin._activeCitekeyViews.has(view), true);

    capturedModal.onClose();
    assert.equal(plugin._activeCitekeyViews.has(view), false);

    let secondModalOpened = false;
    CitekeyModal.prototype.open = () => { secondModalOpened = true; };
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.equal(secondModalOpened, true);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("26. lock is released after error or empty catalog", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"].citekeyBibliographyPath = "empty.bib";
  const plugin = createTestPlugin(f, f.workA);

  const view = createMockEditorView("[@");
  const range = { from: 0, to: 2 };

  await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
  assert.equal(plugin._activeCitekeyViews.has(view), false);
});

test("27. resolveCitekeySegment directly handles all segment boundaries and bounds", () => {
  const f = createGenericCitationFixture();
  f.docA.content = "Segment One Body";
  f.docB.content = "Segment Two Body";

  const doc = buildScriveningsDocument([
    { file: f.docA, content: f.docA.content },
    { file: f.docB, content: f.docB.content },
  ]);

  const seg1 = doc.segments[0];
  const seg2 = doc.segments[1];

  // 1. Inside segment 1
  const inSeg1 = resolveCitekeySegment(doc, { from: seg1.from + 2, to: seg1.from + 4 });
  assert.ok(inSeg1);
  assert.equal(inSeg1.file.path, f.docA.path);

  // 2. Inside segment 2
  const inSeg2 = resolveCitekeySegment(doc, { from: seg2.from + 2, to: seg2.from + 4 });
  assert.ok(inSeg2);
  assert.equal(inSeg2.file.path, f.docB.path);

  // 3. Crossing junction between segment 1 and segment 2
  const crossingJunction = resolveCitekeySegment(doc, { from: seg1.to - 1, to: seg1.to + 1 });
  assert.equal(crossingJunction, null);

  const crossingBoundary = resolveCitekeySegment(doc, { from: seg1.to, to: seg2.from });
  assert.equal(crossingBoundary, null);

  // 4. Out of bounds
  assert.equal(resolveCitekeySegment(doc, { from: -1, to: 1 }), null);
  assert.equal(resolveCitekeySegment(doc, { from: 5, to: 3 }), null);
  assert.equal(resolveCitekeySegment(doc, { from: doc.text.length + 5, to: doc.text.length + 7 }), null);
});

test("28. Continu resolves real file of the segment", () => {
  const f = createGenericCitationFixture();
  const mockDoc = {
    text: "Segment One Body\n\nSegment Two Body",
    segments: [
      { from: 0, to: 16, file: f.docA, path: f.docA.path, body: "Segment One Body" },
      { from: 18, to: 34, file: f.docB, path: f.docB.path, body: "Segment Two Body" },
    ],
  };

  const seg1 = segmentAt(mockDoc, 5);
  assert.equal(seg1?.file.path, f.docA.path);

  const seg2 = segmentAt(mockDoc, 25);
  assert.equal(seg2?.file.path, f.docB.path);
});

test("29. Continu respects folder scope", () => {
  const f = createGenericCitationFixture();
  const plugin = createTestPlugin(f, null);
  const fakeLeaf = {
    app: f.app,
    contentEl: {
      empty() {},
      addClass() {},
      createDiv() { return { createDiv() { return {}; }, addClass() {} }; },
    },
  };

  const view = new ScriveningsView(fakeLeaf, plugin);
  view["_compileScope"] = {
    type: "folder",
    path: f.workA.path,
    projectRoot: f.project.path,
  };

  const res = view["resolveContinuousWorkspaceFolder"]();
  assert.equal(res.ok, true);
  assert.equal(res.folder?.path, f.workA.path);
});

test("30. Continu respects project scope", () => {
  const f = createGenericCitationFixture();
  const plugin = createTestPlugin(f, null);
  const fakeLeaf = {
    app: f.app,
    contentEl: {
      empty() {},
      addClass() {},
      createDiv() { return { createDiv() { return {}; }, addClass() {} }; },
    },
  };

  const view = new ScriveningsView(fakeLeaf, plugin);
  view["_compileScope"] = {
    type: "project",
    projectRoot: f.project.path,
  };

  const res = view["resolveContinuousWorkspaceFolder"]();
  assert.equal(res.ok, true);
  assert.equal(res.folder?.path, f.project.path);
});

test("31. Continu uses Binder workspace for file and selection", () => {
  const f = createGenericCitationFixture();
  const plugin = createTestPlugin(f, f.workA);
  const fakeLeaf = {
    app: f.app,
    contentEl: {
      empty() {},
      addClass() {},
      createDiv() { return { createDiv() { return {}; }, addClass() {} }; },
    },
  };

  const view = new ScriveningsView(fakeLeaf, plugin);

  view["_compileScope"] = {
    type: "file",
    path: f.docA.path,
    projectRoot: f.project.path,
  };
  const resFile = view["resolveContinuousWorkspaceFolder"]();
  assert.equal(resFile.ok, true);
  assert.equal(resFile.folder?.path, f.workA.path);

  view["_compileScope"] = {
    type: "selection",
    paths: [f.docA.path],
    projectRoot: f.project.path,
  };
  const resSelection = view["resolveContinuousWorkspaceFolder"]();
  assert.equal(resSelection.ok, true);
  assert.equal(resSelection.folder?.path, f.workA.path);
});

test("32. Continu never crosses a segment boundary", () => {
  const f = createGenericCitationFixture();
  f.docA.content = "Segment One Body";
  f.docB.content = "Segment Two Body";

  const doc = buildScriveningsDocument([
    { file: f.docA, content: f.docA.content },
    { file: f.docB, content: f.docB.content },
  ]);

  const seg1 = doc.segments[0];
  const range = { from: seg1.to - 1, to: seg1.to + 1 };
  assert.equal(resolveCitekeySegment(doc, range), null);
});

test("33. Continu triggers normal save pipeline via scriveningsChangeListener", async () => {
  const f = createGenericCitationFixture();
  let vaultModifyCalls = 0;
  let vaultProcessCalls = 0;
  f.vault.modify = async (file, content) => {
    vaultModifyCalls++;
    file.content = content;
  };
  f.vault.process = async (file, fn) => {
    vaultProcessCalls++;
    file.content = fn(file.content || "");
    return file.content;
  };

  const plugin = createTestPlugin(f, f.workA);
  const fakeLeaf = {
    app: f.app,
    contentEl: {
      empty() {},
      addClass() {},
      createDiv() { return { createDiv() { return {}; }, addClass() {} }; },
    },
  };

  const continuView = new ScriveningsView(fakeLeaf, plugin);
  const session = new ScriveningsSession({
    app: f.app,
    scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
    cancelTimeout: (id) => clearTimeout(id),
    notify: () => {},
  });
  continuView["session"] = session;

  f.docA.content = "Section A: [@ and details";
  f.docB.content = "Section B: untouched content";

  const doc = buildScriveningsDocument([
    { file: f.docA, content: f.docA.content },
    { file: f.docB, content: f.docB.content },
  ]);

  continuView.session.load(doc);
  assert.equal(continuView.session.dirtyCount, 0);

  const changeListenerExt = scriveningsChangeListener((changes) => {
    continuView["handleEditorChanges"](changes);
  });

  const range = { from: 11, to: 13 };
  const seg = resolveCitekeySegment(continuView.session.document, range);
  assert.ok(seg);
  assert.equal(seg.file.path, f.docA.path);

  let currentDocText = doc.text;
  const mockView = {
    state: {
      doc: {
        get length() { return currentDocText.length; },
        sliceString(from, to) { return currentDocText.slice(from, to); },
      },
    },
    dispatch(spec) {
      if (spec.changes) {
        const { from, to, insert } = spec.changes;
        currentDocText = currentDocText.slice(0, from) + insert + currentDocText.slice(to);
        changeListenerExt.fn({
          docChanged: true,
          changes: {
            iterChanges(fn) {
              fn(from, to, from, from + insert.length, { toString: () => insert });
            },
          },
        });
      }
    },
  };

  const success = insertCitekey(mockView, range, "smith2024");
  assert.equal(success, true);

  const currentDoc = continuView.session.document;
  assert.ok(currentDoc);
  assert.equal(currentDoc.segments[0].body, "Section A: [@smith2024] and details");
  assert.equal(currentDoc.segments[1].body, "Section B: untouched content");

  assert.equal(continuView.session.dirtyCount, 1);
  assert.equal(continuView.session.isDirty(f.docA.path), true);
  assert.equal(continuView.session.isDirty(f.docB.path), false);

  assert.equal(vaultModifyCalls, 0);
  assert.equal(vaultProcessCalls, 0);

  await continuView.session.flush();

  assert.equal(continuView.session.dirtyCount, 0);
  assert.equal(continuView.session.isDirty(f.docA.path), false);
  assert.equal(f.docA.content, "Section A: [@smith2024] and details");
  assert.equal(f.docB.content, "Section B: untouched content");
  assert.ok(vaultModifyCalls + vaultProcessCalls > 0);
});

test("34. no direct Vault write is performed", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  let vaultWriteCalls = 0;
  f.vault.modify = async () => { vaultWriteCalls++; };
  f.vault.process = async () => { vaultWriteCalls++; return ""; };

  const plugin = createTestPlugin(f, f.workA);
  const view = createMockEditorView("Hello [@");
  const range = { from: 6, to: 8 };

  let capturedModal = null;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = function () {
    capturedModal = this;
  };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.ok(capturedModal);

    capturedModal.addReference("smith2024");
    capturedModal.insert();

    assert.equal(view.getText(), "Hello [@smith2024]");
    assert.equal(vaultWriteCalls, 0);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("35. settings JSON remains identical before and after search/insertion", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  const beforeJson = JSON.stringify(f.settings);

  const plugin = createTestPlugin(f, f.workA);
  const view = createMockEditorView("Hello [@");
  const range = { from: 6, to: 8 };

  let capturedModal = null;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = function () {
    capturedModal = this;
  };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workA);
    assert.ok(capturedModal);

    const suggestions = capturedModal.getSuggestions("smith");
    assert.equal(suggestions.length, 1);

    capturedModal.addReference(suggestions[0]);
    capturedModal.insert();
    assert.equal(view.getText(), "Hello [@smith2024]");

    const afterJson = JSON.stringify(f.settings);
    assert.equal(afterJson, beforeJson);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("36. same .bib resolved with and without workspace isolation", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();

  // Without isolation (active workspace is null)
  const pluginNoIso = createTestPlugin(f, null);
  const view1 = createMockEditorView("Doc [@");
  let modalNoIso = null;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = function () {
    modalNoIso = this;
  };

  try {
    await pluginNoIso.openCitekeyPicker(view1, { from: 4, to: 6 }, f.docA, null);
    assert.ok(modalNoIso);
    const keysNoIso = modalNoIso.entries.map((e) => e.key);
    assert.ok(keysNoIso.includes("smith2024"));
    assert.ok(keysNoIso.includes("taylor2021"));
    assert.equal(keysNoIso.includes("jones2023"), false);

    // With isolation to Work-A
    const pluginWithIso = createTestPlugin(f, f.workA);
    const view2 = createMockEditorView("Doc [@");
    let modalWithIso = null;
    CitekeyModal.prototype.open = function () {
      modalWithIso = this;
    };

    await pluginWithIso.openCitekeyPicker(view2, { from: 4, to: 6 }, f.docA, f.workA);
    assert.ok(modalWithIso);
    const keysWithIso = modalWithIso.entries.map((e) => e.key);
    assert.deepEqual(keysWithIso, keysNoIso);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("37. file outside isolated folder is rejected", async () => {
  clearBibtexCatalogCache();
  const f = createGenericCitationFixture();
  // Plugin is isolated to Work-B, but document belongs to Work-A
  const plugin = createTestPlugin(f, f.workB);
  const view = createMockEditorView("Doc [@");
  const range = { from: 4, to: 6 };

  let opened = false;
  const originalOpen = CitekeyModal.prototype.open;
  CitekeyModal.prototype.open = () => {
    opened = true;
  };

  try {
    await plugin.openCitekeyPicker(view, range, f.docA, f.workB);
    assert.equal(opened, false);
    assert.equal(plugin._activeCitekeyViews.has(view), false);
  } finally {
    CitekeyModal.prototype.open = originalOpen;
  }
});

test("38. exact citation formats: single, single with page, range, and multiple", () => {
  // Single reference without page
  const view1 = createMockEditorView("Intro [@");
  insertCitation(view1, { from: 6, to: 8 }, [{ key: "smith2024" }]);
  assert.equal(view1.getText(), "Intro [@smith2024]");

  // Single reference with page (raw number)
  const view2 = createMockEditorView("Intro [@");
  insertCitation(view2, { from: 6, to: 8 }, [{ key: "smith2024", pages: "42" }]);
  assert.equal(view2.getText(), "Intro [@smith2024, p. 42]");

  // Single reference with page (prefixed with p.)
  const view2b = createMockEditorView("Intro [@");
  insertCitation(view2b, { from: 6, to: 8 }, [{ key: "smith2024", pages: "p. 42" }]);
  assert.equal(view2b.getText(), "Intro [@smith2024, p. 42]");

  // Page range with hyphen 42-44
  const view3a = createMockEditorView("Intro [@");
  insertCitation(view3a, { from: 6, to: 8 }, [{ key: "smith2024", pages: "42-44" }]);
  assert.equal(view3a.getText(), "Intro [@smith2024, pp. 42–44]");

  // Page range with en-dash 42–44
  const view3b = createMockEditorView("Intro [@");
  insertCitation(view3b, { from: 6, to: 8 }, [{ key: "smith2024", pages: "42–44" }]);
  assert.equal(view3b.getText(), "Intro [@smith2024, pp. 42–44]");

  // Page range with pp. prefix
  const view3c = createMockEditorView("Intro [@");
  insertCitation(view3c, { from: 6, to: 8 }, [{ key: "smith2024", pages: "pp. 42-44" }]);
  assert.equal(view3c.getText(), "Intro [@smith2024, pp. 42–44]");

  // Multiple references
  const view4 = createMockEditorView("Intro [@");
  insertCitation(view4, { from: 6, to: 8 }, [
    { key: "smith2024", pages: "42" },
    { key: "doe2023" },
  ]);
  assert.equal(view4.getText(), "Intro [@smith2024, p. 42; @doe2023]");
});

test("39. cleaning pages rejects carriage returns, newlines, brackets, and semicolons", () => {
  assert.equal(cleanCitationPages("42\r\n"), "42");
  assert.equal(cleanCitationPages("42]"), "42");
  assert.equal(cleanCitationPages("42; 44"), "42 44");
  assert.equal(cleanCitationPages("\r\n42–44;]\n"), "42–44");

  const formatted = formatCitationReferenceItem({
    key: "smith2024",
    pages: "42\r\n];",
  });
  assert.equal(formatted, "@smith2024, p. 42");

  const app = { vault: {} };
  const entries = [
    { key: "smith2024", authors: ["Smith, John"], title: "Title", year: "2024" },
  ];
  const modal = new CitekeyModal(app, entries, () => {});
  modal.addReference("smith2024", "42\r\n;]");
  assert.equal(modal.getSelectedItems()[0].pages, "42");

  modal.setReferencePages("smith2024", "42-44\n;]");
  assert.equal(modal.getSelectedItems()[0].pages, "42-44");
});

test("40. continuation trigger after ; @ inside open citation group", () => {
  let triggeredType = null;
  let triggeredRange = null;

  const extension = createCitekeyTriggerExtension((_view, range, triggerType) => {
    triggeredType = triggerType;
    triggeredRange = range;
  });

  const listener = extension.fn || extension.value || extension;
  const initialText = "Discussion [@smith2024, p. 42; @";
  const mockView = createMockEditorView(initialText);
  const cursor = initialText.length;

  listener({
    docChanged: true,
    view: mockView,
    transactions: [
      {
        docChanged: true,
        isUserEvent: (ev) => ev === "input.type",
        startState: {
          selection: { main: { empty: true, head: cursor - 1 } },
        },
        state: {
          selection: { main: { empty: true, head: cursor } },
          doc: {
            length: cursor,
            sliceString: (from, to) => initialText.slice(from, to),
          },
        },
        changes: {
          iterChanges: (fn) => {
            fn(cursor - 1, cursor - 1, cursor - 1, cursor, { toString: () => "@" });
          },
        },
      },
    ],
  });

  assert.equal(triggeredType, "continue_group");
  assert.deepEqual(triggeredRange, { from: cursor - 1, to: cursor });
});

test("41. continuation insertion preserves existing ]", () => {
  // Case with existing ]
  const view1 = createMockEditorView("Discussion [@smith2024, p. 42; @] and more");
  const range1 = { from: 31, to: 32 }; // Covering @
  const success1 = insertCitation(view1, range1, [{ key: "taylor2021" }], "continue_group");
  assert.equal(success1, true);
  assert.equal(view1.getText(), "Discussion [@smith2024, p. 42; @taylor2021] and more");

  // Case without existing ]
  const view2 = createMockEditorView("Discussion [@smith2024, p. 42; @");
  const range2 = { from: 31, to: 32 }; // Covering @
  const success2 = insertCitation(view2, range2, [{ key: "taylor2021" }], "continue_group");
  assert.equal(success2, true);
  assert.equal(view2.getText(), "Discussion [@smith2024, p. 42; @taylor2021]");
});

test("42. continuation trigger does not fire outside open citation group", () => {
  let triggers = 0;
  const extension = createCitekeyTriggerExtension(() => {
    triggers++;
  });
  const listener = extension.fn || extension.value || extension;

  const testCases = [
    "Normal sentence; @",
    "Closed [@smith2024] sentence; @",
    "[Bracketed non-cite; @",
  ];

  for (const text of testCases) {
    const cursor = text.length;
    listener({
      docChanged: true,
      view: createMockEditorView(text),
      transactions: [
        {
          docChanged: true,
          isUserEvent: (ev) => ev === "input.type",
          startState: { selection: { main: { empty: true, head: cursor - 1 } } },
          state: {
            selection: { main: { empty: true, head: cursor } },
            doc: { length: cursor, sliceString: (from, to) => text.slice(from, to) },
          },
          changes: {
            iterChanges: (fn) => {
              fn(cursor - 1, cursor - 1, cursor - 1, cursor, { toString: () => "@" });
            },
          },
        },
      ],
    });
  }

  assert.equal(triggers, 0);

  // Direct check of helper
  assert.equal(isInsideOpenCitationGroup({ sliceString: () => "Some text; " }, 11), false);
  assert.equal(isInsideOpenCitationGroup({ sliceString: () => "[@smith2024] other; " }, 20), false);
  assert.equal(isInsideOpenCitationGroup({ sliceString: () => "Text [@smith2024; " }, 18), true);
});

test("43. Cancel or Escape preserves initial text exactly without partial insertion", () => {
  const view = createMockEditorView("Original [@ untouched");
  const entries = [
    { key: "smith2024", authors: ["Smith, John"], title: "Title", year: "2024" },
  ];

  let insertedCalled = false;
  let closeCalled = false;

  const modal = new CitekeyModal(
    { vault: {} },
    entries,
    () => { insertedCalled = true; },
    () => { closeCalled = true; },
  );

  modal.open();
  modal.addReference("smith2024");
  // User cancels instead of inserting
  modal.cancel();

  assert.equal(insertedCalled, false);
  assert.equal(closeCalled, true);
  assert.equal(view.getText(), "Original [@ untouched");

  // Insert button cannot trigger if no reference selected
  const emptyModal = new CitekeyModal(
    { vault: {} },
    entries,
    () => { insertedCalled = true; },
  );
  emptyModal.open();
  emptyModal.insert();
  assert.equal(insertedCalled, false);
});

test("44. stale range cleanly aborts insertion", () => {
  const view = createMockEditorView("Document [@");
  const staleRange = { from: 0, to: 2 }; // Points to "Do", not "[@"

  const resultOpen = insertCitation(view, staleRange, [{ key: "smith2024" }], "open_group");
  assert.equal(resultOpen, false);
  assert.equal(view.getText(), "Document [@");

  const resultContinue = insertCitation(view, staleRange, [{ key: "smith2024" }], "continue_group");
  assert.equal(resultContinue, false);
  assert.equal(view.getText(), "Document [@");
});

test("45. CitekeyModal composer: search, duplicate prevention, and removal", () => {
  const entries = [
    { key: "smith2024", authors: ["Smith, John"], title: "Smith Article", year: "2024" },
    { key: "taylor2021", authors: ["Taylor, Tim"], title: "Taylor Book", year: "2021" },
  ];

  const modal = new CitekeyModal({ vault: {} }, entries, () => {});

  // Search
  const resultsSmith = modal.getSuggestions("smith");
  assert.equal(resultsSmith.length, 1);
  assert.equal(resultsSmith[0].key, "smith2024");

  const resultsYear = modal.getSuggestions("2021");
  assert.equal(resultsYear.length, 1);
  assert.equal(resultsYear[0].key, "taylor2021");

  // Add references
  const added1 = modal.addReference("smith2024");
  assert.equal(added1, true);
  assert.equal(modal.getSelectedItems().length, 1);

  // Duplicate rejection
  const addedDup = modal.addReference("smith2024");
  assert.equal(addedDup, false);
  assert.equal(modal.getSelectedItems().length, 1);

  // Add second reference
  const added2 = modal.addReference("taylor2021", "15");
  assert.equal(added2, true);
  assert.equal(modal.getSelectedItems().length, 2);

  // Removal
  const removed = modal.removeReference("smith2024");
  assert.equal(removed, true);
  assert.equal(modal.getSelectedItems().length, 1);
  assert.equal(modal.getSelectedItems()[0].entry.key, "taylor2021");
  assert.equal(modal.getSelectedItems()[0].pages, "15");
});

test("46. immediate filtering on input from first letter across key, author, title, and year", () => {
  const entries = [
    { key: "smith2024", authors: ["Smith, John"], title: "Quantum Computing", year: "2024" },
    { key: "taylor2021", authors: ["Taylor, Tim"], title: "Deep Learning", year: "2021" },
    { key: "alvarez1998", authors: ["Alvarez, Maria"], title: "Binary Tree Index", year: "1998" },
  ];

  const modal = new CitekeyModal({ vault: {} }, entries, () => {});
  modal.open();
  const input = modal.getSearchInput();
  assert.ok(input);

  // 1. Filter by key/author starting letter 's' (matches only smith2024)
  input.value = "s";
  input.dispatchEvent({ type: "input" });
  let results = modal.getSearchResults();
  assert.equal(results.length, 1);
  assert.equal(results[0].key, "smith2024");

  // 2. Filter by author name starting letter 'm' from "Maria"
  input.value = "maria";
  input.dispatchEvent({ type: "input" });
  results = modal.getSearchResults();
  assert.equal(results.length, 1);
  assert.equal(results[0].key, "alvarez1998");

  // 3. Filter by title keyword from first letter 'd'
  input.value = "deep";
  input.dispatchEvent({ type: "input" });
  results = modal.getSearchResults();
  assert.equal(results.length, 1);
  assert.equal(results[0].key, "taylor2021");

  // 4. Filter by year '1998'
  input.value = "1998";
  input.dispatchEvent({ type: "input" });
  results = modal.getSearchResults();
  assert.equal(results.length, 1);
  assert.equal(results[0].key, "alvarez1998");
});

test("47. results in DOM are capped at exactly 30 entries with hundreds of entries", () => {
  const entries = [];
  for (let i = 1; i <= 250; i++) {
    const padded = String(i).padStart(3, "0");
    entries.push({
      key: `ref${padded}`,
      authors: [`Author ${padded}`],
      title: `Document ${padded} Title`,
      year: "2020",
    });
  }

  const modal = new CitekeyModal({ vault: {} }, entries, () => {});
  modal.open();

  // Without query: first 30 entries
  assert.equal(modal.getSearchResults().length, 30);
  const itemsInitial = modal.contentEl.querySelectorAll(".feuillets-citekey-result-item");
  assert.equal(itemsInitial.length, 30);

  // With a broad query matching all: capped at 30 entries
  const input = modal.getSearchInput();
  assert.ok(input);
  input.value = "doc";
  input.dispatchEvent({ type: "input" });

  assert.equal(modal.getSearchResults().length, 30);
  const itemsFiltered = modal.contentEl.querySelectorAll(".feuillets-citekey-result-item");
  assert.equal(itemsFiltered.length, 30);
});

test("48. keyboard navigation with ArrowUp, ArrowDown, and Enter selection", () => {
  const entries = [
    { key: "alpha2020", authors: ["Author A"], title: "First Title", year: "2020" },
    { key: "beta2021", authors: ["Author B"], title: "Second Title", year: "2021" },
    { key: "gamma2022", authors: ["Author C"], title: "Third Title", year: "2022" },
  ];

  const modal = new CitekeyModal({ vault: {} }, entries, () => {});
  modal.open();

  const input = modal.getSearchInput();
  assert.ok(input);

  // Initial active index is 0
  assert.equal(modal.getActiveIndex(), 0);
  let activeItems = modal.contentEl.querySelectorAll(".feuillets-citekey-result-active");
  assert.equal(activeItems.length, 1);
  assert.ok(activeItems[0].querySelector(".feuillets-citekey-result-key")?.getText().includes("alpha2020"));

  // ArrowDown -> active index 1
  input.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault() {} });
  assert.equal(modal.getActiveIndex(), 1);
  activeItems = modal.contentEl.querySelectorAll(".feuillets-citekey-result-active");
  assert.ok(activeItems[0].querySelector(".feuillets-citekey-result-key")?.getText().includes("beta2021"));

  // ArrowDown -> active index 2
  input.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault() {} });
  assert.equal(modal.getActiveIndex(), 2);
  activeItems = modal.contentEl.querySelectorAll(".feuillets-citekey-result-active");
  assert.ok(activeItems[0].querySelector(".feuillets-citekey-result-key")?.getText().includes("gamma2022"));

  // ArrowDown beyond end -> stays at 2
  input.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault() {} });
  assert.equal(modal.getActiveIndex(), 2);

  // ArrowUp -> active index 1
  input.dispatchEvent({ type: "keydown", key: "ArrowUp", preventDefault() {} });
  assert.equal(modal.getActiveIndex(), 1);
  activeItems = modal.contentEl.querySelectorAll(".feuillets-citekey-result-active");
  assert.ok(activeItems[0].querySelector(".feuillets-citekey-result-key")?.getText().includes("beta2021"));

  // Enter -> adds beta2021
  input.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.equal(modal.getSelectedItems().length, 1);
  assert.equal(modal.getSelectedItems()[0].entry.key, "beta2021");
});

test("49. search input is cleared and focus restored after keyboard and click additions and removal", () => {
  const entries = [
    { key: "alpha2020", authors: ["Author A"], title: "First Title", year: "2020" },
    { key: "beta2021", authors: ["Author B"], title: "Second Title", year: "2021" },
  ];

  const modal = new CitekeyModal({ vault: {} }, entries, () => {});
  modal.open();
  const input = modal.getSearchInput();
  assert.ok(input);
  assert.equal(input.isFocused(), true);

  // 1. Add via keyboard Enter
  input.value = "alpha";
  input.dispatchEvent({ type: "input" });
  assert.equal(input.value, "alpha");

  input.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.equal(modal.getSelectedItems().length, 1);
  assert.equal(input.value, "");
  assert.equal(input.isFocused(), true);

  // 2. Add via mouse click
  input.value = "beta";
  input.dispatchEvent({ type: "input" });
  const resultItems = modal.contentEl.querySelectorAll(".feuillets-citekey-result-item");
  assert.equal(resultItems.length, 1);
  resultItems[0].click();

  assert.equal(modal.getSelectedItems().length, 2);
  assert.equal(input.value, "");
  assert.equal(input.isFocused(), true);

  // 3. Remove via remove button
  const removeButtons = modal.contentEl.querySelectorAll(".feuillets-citekey-remove-btn");
  assert.equal(removeButtons.length, 2);
  removeButtons[0].click();

  assert.equal(modal.getSelectedItems().length, 1);
  assert.equal(input.isFocused(), true);
});

test("50. duplicate prevention across click and enter interactions", () => {
  const entries = [
    { key: "alpha2020", authors: ["Author A"], title: "First Title", year: "2020" },
  ];

  const modal = new CitekeyModal({ vault: {} }, entries, () => {});
  modal.open();
  const input = modal.getSearchInput();
  assert.ok(input);

  // Add first time
  input.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.equal(modal.getSelectedItems().length, 1);

  // Try adding second time via Enter
  input.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {} });
  assert.equal(modal.getSelectedItems().length, 1);

  // Try adding second time via Click
  const resultItem = modal.contentEl.querySelector(".feuillets-citekey-result-item");
  assert.ok(resultItem);
  resultItem.click();
  assert.equal(modal.getSelectedItems().length, 1);
});

test("51. reference removal updates DOM and insert button state", () => {
  const entries = [
    { key: "alpha2020", authors: ["Author A"], title: "First Title", year: "2020" },
    { key: "beta2021", authors: ["Author B"], title: "Second Title", year: "2021" },
  ];

  const modal = new CitekeyModal({ vault: {} }, entries, () => {});
  modal.open();

  const insertBtn = modal.contentEl.querySelector(".feuillets-citekey-insert-btn");
  assert.ok(insertBtn);
  assert.equal(insertBtn.disabled, true);

  // Add reference
  modal.addReference("alpha2020");
  assert.equal(insertBtn.disabled, false);
  let rows = modal.contentEl.querySelectorAll(".feuillets-citekey-selected-row");
  assert.equal(rows.length, 1);

  // Remove reference
  const removeBtn = modal.contentEl.querySelector(".feuillets-citekey-remove-btn");
  assert.ok(removeBtn);
  removeBtn.click();

  rows = modal.contentEl.querySelectorAll(".feuillets-citekey-selected-row");
  assert.equal(rows.length, 0);
  assert.equal(modal.getSelectedItems().length, 0);
  assert.equal(insertBtn.disabled, true);
});
