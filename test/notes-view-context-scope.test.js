import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { TFile, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { NotesView } = await import(modulePath("src/views/notes-view.js"));
const { buildContextIndex } = await import(modulePath("src/services/context-index.js"));

if (!globalThis.document) {
  globalThis.document = { activeElement: null };
}

function createHierarchicalFixture() {
  const projectRoot = new TFolder("PROJECT");

  const globalResearch = new TFolder("PROJECT/Global-Research");
  globalResearch.parent = projectRoot;

  const cycle = new TFolder("PROJECT/Cycle");
  cycle.parent = projectRoot;
  const cycleResearch = new TFolder("PROJECT/Cycle/Cycle-Research");
  cycleResearch.parent = cycle;

  const volumeA = new TFolder("PROJECT/Cycle/Volume-A");
  volumeA.parent = cycle;
  const volumeAResearch = new TFolder("PROJECT/Cycle/Volume-A/Volume-A-Research");
  volumeAResearch.parent = volumeA;

  const chapter1 = new TFolder("PROJECT/Cycle/Volume-A/Chapter-1");
  chapter1.parent = volumeA;
  const chapter1Research = new TFolder("PROJECT/Cycle/Volume-A/Chapter-1/Chapter-1-Research");
  chapter1Research.parent = chapter1;
  const docA = new TFile("PROJECT/Cycle/Volume-A/Chapter-1/Document-A.md");
  docA.parent = chapter1;

  const chapter2 = new TFolder("PROJECT/Cycle/Volume-A/Chapter-2");
  chapter2.parent = volumeA;
  const docB = new TFile("PROJECT/Cycle/Volume-A/Chapter-2/Document-B.md");
  docB.parent = chapter2;

  const volumeB = new TFolder("PROJECT/Cycle/Volume-B");
  volumeB.parent = cycle;
  const volumeBResearch = new TFolder("PROJECT/Cycle/Volume-B/Volume-B-Research");
  volumeBResearch.parent = volumeB;
  const docC = new TFile("PROJECT/Cycle/Volume-B/Document-C.md");
  docC.parent = volumeB;

  const courses = new TFolder("PROJECT/Courses");
  courses.parent = projectRoot;
  const coursesResearch = new TFolder("PROJECT/Courses/Courses-Research");
  coursesResearch.parent = courses;
  const courseDoc = new TFile("PROJECT/Courses/Course-Document.md");
  courseDoc.parent = courses;

  const soy = new TFolder("PROJECT/Soy");
  soy.parent = projectRoot;
  const soyResearch = new TFolder("PROJECT/Soy/Soy-Research");
  soyResearch.parent = soy;

  const researchLinks = new Map([
    [projectRoot.path, globalResearch],
    [cycle.path, cycleResearch],
    [volumeA.path, volumeAResearch],
    [chapter1.path, chapter1Research],
    [volumeB.path, volumeBResearch],
    [courses.path, coursesResearch],
    [soy.path, soyResearch],
  ]);

  let activeWorkspaceFolder = null;

  const app = {
    vault: {
      getAbstractFileByPath(path) {
        const all = [
          projectRoot, globalResearch,
          cycle, cycleResearch,
          volumeA, volumeAResearch,
          chapter1, chapter1Research, docA,
          chapter2, docB,
          volumeB, volumeBResearch, docC,
          courses, coursesResearch, courseDoc,
          soy, soyResearch,
        ];
        return all.find((item) => item.path === path) ?? null;
      },
      cachedRead: async (file) => file.content ?? "",
      on: () => ({}),
    },
    workspace: {
      getActiveFile: () => null,
      getLeaf: () => ({}),
      on: () => ({}),
    },
    metadataCache: {
      on: () => ({}),
      getFileCache: () => null,
    },
  };

  const plugin = {
    settings: {
      collapsed: {},
      notesSectionOrder: [],
      notesShowEntities: true,
      notesShowFootnotes: true,
      notesShowNotes: true,
      notesShowResume: true,
      notesShowSynopsis: true,
      notesPinned: {},
      projectMeta: {
        [projectRoot.path]: {
          researchFolderLinks: Object.fromEntries(
            [...researchLinks.entries()].map(([k, v]) => [k, v.path])
          ),
        },
      },
    },
    getProjectFolder: () => projectRoot,
    getResearchRoot: () => soyResearch,
    getWorkspaceFolder: () => activeWorkspaceFolder,
    getLinkedResearchFolder: (node) => researchLinks.get(node.path) ?? null,
  };

  const contentEl = {
    children: [],
    createEl: () => contentEl,
    createDiv: () => contentEl,
    createSpan: () => contentEl,
    empty: () => {},
    addEventListener: () => {},
  };

  const leaf = { app, contentEl };
  const view = new NotesView(leaf, plugin);

  return {
    view,
    plugin,
    setWorkspaceFolder: (folder) => { activeWorkspaceFolder = folder; },
    setFileResearchLink: (filePath, folder) => {
      const persisted = plugin.settings.projectMeta[projectRoot.path].researchFolderLinks;
      if (folder) {
        researchLinks.set(filePath, folder);
        persisted[filePath] = folder.path;
      } else {
        researchLinks.delete(filePath);
        delete persisted[filePath];
      }
    },
    projectRoot,
    globalResearch,
    cycle,
    cycleResearch,
    volumeA,
    volumeAResearch,
    chapter1,
    chapter1Research,
    docA,
    chapter2,
    docB,
    volumeB,
    volumeBResearch,
    docC,
    courses,
    coursesResearch,
    courseDoc,
    soy,
    soyResearch,
  };
}

test("1. Document-A shows exactly Chapter-1-Research, Volume-A-Research, Cycle-Research, Global-Research", () => {
  const fixture = createHierarchicalFixture();
  const sources = fixture.view["contextSourcesFor"](fixture.docA);
  const paths = sources.map((s) => s.path);

  assert.deepEqual(paths, [
    fixture.chapter1Research.path,
    fixture.volumeAResearch.path,
    fixture.cycleResearch.path,
    fixture.globalResearch.path,
  ]);
  assert.ok(!paths.includes(fixture.soyResearch.path), "Soy-Research must be absent");
  assert.ok(!paths.includes(fixture.coursesResearch.path), "Courses-Research must be absent");
  assert.ok(!paths.includes(fixture.volumeBResearch.path), "Volume-B-Research must be absent");
});

test("2. With Binder isolated on Chapter-1, Document-A has exactly the same four sources as above", () => {
  const fixture = createHierarchicalFixture();
  fixture.setWorkspaceFolder(fixture.chapter1);
  const sources = fixture.view["contextSourcesFor"](fixture.docA);
  const paths = sources.map((s) => s.path);

  assert.deepEqual(paths, [
    fixture.chapter1Research.path,
    fixture.volumeAResearch.path,
    fixture.cycleResearch.path,
    fixture.globalResearch.path,
  ]);
});

test("3. Document-B shows Volume-A-Research, Cycle-Research, Global-Research", () => {
  const fixture = createHierarchicalFixture();
  const sources = fixture.view["contextSourcesFor"](fixture.docB);
  const paths = sources.map((s) => s.path);

  assert.deepEqual(paths, [
    fixture.volumeAResearch.path,
    fixture.cycleResearch.path,
    fixture.globalResearch.path,
  ]);
  assert.ok(!paths.includes(fixture.chapter1Research.path), "Chapter-1-Research must be absent");
  assert.ok(!paths.includes(fixture.soyResearch.path), "Soy-Research must be absent");
  assert.ok(!paths.includes(fixture.coursesResearch.path), "Courses-Research must be absent");
  assert.ok(!paths.includes(fixture.volumeBResearch.path), "Volume-B-Research must be absent");
});

test("4. Document-C shows Volume-B-Research, Cycle-Research, Global-Research", () => {
  const fixture = createHierarchicalFixture();
  const sources = fixture.view["contextSourcesFor"](fixture.docC);
  const paths = sources.map((s) => s.path);

  assert.deepEqual(paths, [
    fixture.volumeBResearch.path,
    fixture.cycleResearch.path,
    fixture.globalResearch.path,
  ]);
  assert.ok(!paths.includes(fixture.volumeAResearch.path), "Volume-A-Research must be absent");
  assert.ok(!paths.includes(fixture.chapter1Research.path), "Chapter-1-Research must be absent");
});

test("5. Course-Document shows Courses-Research, Global-Research", () => {
  const fixture = createHierarchicalFixture();
  const sources = fixture.view["contextSourcesFor"](fixture.courseDoc);
  const paths = sources.map((s) => s.path);

  assert.deepEqual(paths, [
    fixture.coursesResearch.path,
    fixture.globalResearch.path,
  ]);
  assert.ok(!paths.includes(fixture.cycleResearch.path), "Cycle-Research must be absent");
  assert.ok(!paths.includes(fixture.volumeAResearch.path), "Volume-A-Research must be absent");
  assert.ok(!paths.includes(fixture.volumeBResearch.path), "Volume-B-Research must be absent");
  assert.ok(!paths.includes(fixture.soyResearch.path), "Soy-Research must be absent");
});

test("6. A research folder linked directly to Document-A is displayed before every folder-level source", () => {
  const fixture = createHierarchicalFixture();
  const docAResearch = new TFolder("PROJECT/Cycle/Volume-A/Chapter-1/DocA-Direct-Research");
  fixture.setFileResearchLink(fixture.docA.path, docAResearch);

  const sources = fixture.view["contextSourcesFor"](fixture.docA);
  const paths = sources.map((s) => s.path);

  assert.deepEqual(paths, [
    docAResearch.path,
    fixture.chapter1Research.path,
    fixture.volumeAResearch.path,
    fixture.cycleResearch.path,
    fixture.globalResearch.path,
  ]);
  assert.equal(sources[0].kind, "feuillet");
});

test("7. The same research folder path is never included twice", () => {
  const fixture = createHierarchicalFixture();
  fixture.setFileResearchLink(fixture.docA.path, fixture.chapter1Research);

  const sources = fixture.view["contextSourcesFor"](fixture.docA);
  const paths = sources.map((s) => s.path);
  const uniquePaths = new Set(paths);

  assert.equal(paths.length, uniquePaths.size, "All source paths must be unique");
  assert.equal(sources[0].path, fixture.chapter1Research.path);
  assert.equal(sources[0].kind, "feuillet", "Direct document link takes precedence in deduplication");
});

test("8. Soy-Research is never displayed for Document-A, even though plugin.getResearchRoot() returns Soy-Research", () => {
  const fixture = createHierarchicalFixture();
  assert.equal(fixture.plugin.getResearchRoot().path, fixture.soyResearch.path);

  const sources = fixture.view["contextSourcesFor"](fixture.docA);
  const paths = sources.map((s) => s.path);

  assert.ok(!paths.includes(fixture.soyResearch.path), "Soy-Research must never be included for Document-A");
});

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    this.attributes = options.attr ?? {};
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    child.parentEl = this;
    this.children.push(child);
    return child;
  }

  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const className of classNames.split(" ")) this.classes.add(className); }
  removeClass(className) { this.classes.delete(className); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  removeEventListener(type, callback) { if (this.events.get(type) === callback) this.events.delete(type); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
  remove() {
    if (this.parentEl) this.parentEl.children = this.parentEl.children.filter((c) => c !== this);
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function citedNames(contentEl) {
  return allElements(contentEl)
    .filter((el) => el.classes.has("feuillets-entity-name"))
    .map((el) => el.text.replace(/^•\s*/, ""));
}

test("9. isCandidateInSources validates exact matches and subpaths while rejecting siblings and bare prefixes", () => {
  const fixture = createHierarchicalFixture();
  const sources = [
    { path: "PROJECT/Project-Research", kind: "project-research" },
    { path: "PROJECT/Cycle/Volume-A/Chapter-1/Chapter-1-Research", kind: "chapter" },
  ];

  // Exact folder matches
  assert.ok(fixture.view["isCandidateInSources"]("PROJECT/Project-Research", sources));
  assert.ok(fixture.view["isCandidateInSources"]("PROJECT/Cycle/Volume-A/Chapter-1/Chapter-1-Research", sources));

  // Child files within source folder
  assert.ok(fixture.view["isCandidateInSources"]("PROJECT/Project-Research/Allowed-Person.md", sources));
  assert.ok(fixture.view["isCandidateInSources"]("PROJECT/Cycle/Volume-A/Chapter-1/Chapter-1-Research/Note.md", sources));
  assert.ok(fixture.view["isCandidateInSources"]("PROJECT/Project-Research/Subfolder/Nested.md", sources));

  // Reject sibling research folders
  assert.equal(fixture.view["isCandidateInSources"]("PROJECT/Soy/Soy-Research/Leaked.md", sources), false);

  // Reject bare prefix without trailing slash
  assert.equal(fixture.view["isCandidateInSources"]("PROJECT/Project-Research-2/Other.md", sources), false);
  assert.equal(fixture.view["isCandidateInSources"]("PROJECT/Project-ResearchExtra/Other.md", sources), false);
});

test("10. Integration: CONTEXT panel filters actual context results by allowed research sources", async () => {
  const projectRoot = new TFolder("PROJECT");
  const projectResearch = new TFolder("PROJECT/Project-Research");
  projectResearch.parent = projectRoot;
  const allowedPerson = new TFile("PROJECT/Project-Research/Allowed-Person.md");
  allowedPerson.parent = projectResearch;
  allowedPerson.basename = "Allowed-Person";
  allowedPerson.content = "Research details about Allowed-Person";
  projectResearch.children = [allowedPerson];

  const workA = new TFolder("PROJECT/Work-A");
  workA.parent = projectRoot;
  const workAResearch = new TFolder("PROJECT/Work-A/Work-Research");
  workAResearch.parent = workA;
  workAResearch.children = [];

  const nestedFolder = new TFolder("PROJECT/Work-A/Nested-Folder");
  nestedFolder.parent = workA;
  const nestedResearch = new TFolder("PROJECT/Work-A/Nested-Folder/Nested-Research");
  nestedResearch.parent = nestedFolder;
  nestedResearch.children = [];

  const docA = new TFile("PROJECT/Work-A/Nested-Folder/Document-A.md");
  docA.parent = nestedFolder;
  docA.basename = "Document-A";
  docA.content = "In this passage, Allowed-Person is present while Leaked-Person-One and Leaked-Person-Two are mentioned.";
  nestedFolder.children = [nestedResearch, docA];
  workA.children = [workAResearch, nestedFolder];

  const soy = new TFolder("PROJECT/Soy");
  soy.parent = projectRoot;
  const soyResearch = new TFolder("PROJECT/Soy/Soy-Research");
  soyResearch.parent = soy;
  const leakedPersonOne = new TFile("PROJECT/Soy/Soy-Research/Leaked-Person-One.md");
  leakedPersonOne.parent = soyResearch;
  leakedPersonOne.basename = "Leaked-Person-One";
  leakedPersonOne.content = "Research details about Leaked-Person-One";
  const leakedPersonTwo = new TFile("PROJECT/Soy/Soy-Research/Leaked-Person-Two.md");
  leakedPersonTwo.parent = soyResearch;
  leakedPersonTwo.basename = "Leaked-Person-Two";
  leakedPersonTwo.content = "Research details about Leaked-Person-Two";
  soyResearch.children = [leakedPersonOne, leakedPersonTwo];
  soy.children = [soyResearch];

  projectRoot.children = [projectResearch, workA, soy];

  const allFiles = [
    projectRoot, projectResearch, allowedPerson,
    workA, workAResearch,
    nestedFolder, nestedResearch, docA,
    soy, soyResearch, leakedPersonOne, leakedPersonTwo,
  ];
  const filesByPath = new Map(allFiles.map((f) => [f.path, f]));

  const researchLinks = new Map([
    [projectRoot.path, projectResearch],
    [workA.path, workAResearch],
    [nestedFolder.path, nestedResearch],
    [soy.path, soyResearch],
  ]);

  const app = {
    vault: {
      getAbstractFileByPath: (path) => filesByPath.get(path) ?? null,
      cachedRead: async (file) => file.content ?? "",
      on: () => ({}),
    },
    workspace: {
      getActiveFile: () => docA,
      getActiveViewOfType: () => null,
      on: () => ({}),
    },
    metadataCache: {
      on: () => ({}),
      getFileCache: () => null,
    },
  };

  const plugin = {
    settings: {
      collapsed: {},
      notesSectionOrder: [],
      notesShowEntities: true,
      notesShowFootnotes: true,
      notesShowNotes: true,
      notesShowResume: true,
      notesShowSynopsis: true,
      notesPinned: {},
      projectMeta: {
        [projectRoot.path]: {
          researchFolderLinks: Object.fromEntries(
            [...researchLinks.entries()].map(([k, v]) => [k, v.path])
          ),
        },
      },
    },
    getProjectFolder: () => projectRoot,
    getResearchRoot: () => soyResearch,
    getWorkspaceFolder: () => null,
    getLinkedResearchFolder: (node) => researchLinks.get(node.path) ?? null,
    titleFor: (file) => file.basename,
    tagsOf: () => [],
    parseStoryDate: () => null,
    getChronoFolder: () => null,
    isFrontMatter: () => false,
    hasSources: () => false,
    saveSettings: async () => {},
  };

  // 1. Verify that before NotesView filtering, the complete research index contains all three candidates
  const allResearchDocs = [
    { path: allowedPerson.path, basename: allowedPerson.basename, title: "Allowed-Person" },
    { path: leakedPersonOne.path, basename: leakedPersonOne.basename, title: "Leaked-Person-One" },
    { path: leakedPersonTwo.path, basename: leakedPersonTwo.basename, title: "Leaked-Person-Two" },
  ];
  const allResearchSources = [
    { path: nestedResearch.path, kind: "chapter" },
    { path: workAResearch.path, kind: "chapter" },
    { path: projectResearch.path, kind: "project-research" },
    { path: soyResearch.path, kind: "chapter" },
  ];
  const fullIndex = buildContextIndex(allResearchDocs, allResearchSources);
  assert.equal(fullIndex.length, 3, "Complete index before NotesView filtering must contain all 3 candidates");
  assert.ok(fullIndex.some((c) => c.path === allowedPerson.path));
  assert.ok(fullIndex.some((c) => c.path === leakedPersonOne.path));
  assert.ok(fullIndex.some((c) => c.path === leakedPersonTwo.path));

  // 2. Real NotesView rendering pipeline
  const contentEl = new FakeElement();
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = () => ({});

  await view.renderCitedEntities(contentEl, docA, null, []);

  const rendered = citedNames(contentEl);
  assert.deepEqual(rendered, ["Allowed-Person"]);
  assert.ok(!rendered.includes("Leaked-Person-One"), "Leaked-Person-One must never be rendered");
  assert.ok(!rendered.includes("Leaked-Person-Two"), "Leaked-Person-Two must never be rendered");

  // 3. Even if collectContextDocuments returns all candidates from the entire vault:
  const broadContentEl = new FakeElement();
  const broadView = new NotesView({ app, contentEl: broadContentEl }, plugin);
  broadView.fm = () => ({});
  broadView["collectContextDocuments"] = () => allResearchDocs;

  await broadView.renderCitedEntities(broadContentEl, docA, null, []);
  const broadRendered = citedNames(broadContentEl);
  assert.deepEqual(broadRendered, ["Allowed-Person"]);
  assert.ok(!broadRendered.includes("Leaked-Person-One"), "Leaked-Person-One must never be rendered even with broad collection");
  assert.ok(!broadRendered.includes("Leaked-Person-Two"), "Leaked-Person-Two must never be rendered even with broad collection");
});

function pinnedSection(contentEl) {
  return allElements(contentEl).find((el) => el.classes.has("feuillets-pinned-section"));
}

function relatedDocsSection(contentEl) {
  return allElements(contentEl).find((el) => el.classes.has("feuillets-related-docs-section"));
}

function reliableSection(contentEl) {
  return allElements(contentEl).find((el) =>
    el.classes.has("feuillets-notes-section") &&
    !el.classes.has("feuillets-context-pinned") &&
    !el.classes.has("feuillets-context-related")
  );
}

function relatedDocNames(contentEl) {
  const section = relatedDocsSection(contentEl);
  if (!section) return [];
  return allElements(section)
    .filter((el) => el.classes.has("feuillets-related-doc-name"))
    .map((el) => el.text.replace(/^•\s*/, ""));
}

function pinnedNames(contentEl) {
  const section = pinnedSection(contentEl);
  if (!section) return [];
  return allElements(section)
    .filter((el) => el.classes.has("feuillets-entity-name"))
    .map((el) => el.text.replace(/^•\s*/, ""));
}

function fakeEditor(text, cursorOffset = 0) {
  const lines = text.split(/\r?\n/);
  let cur = 0;
  let cursorLine = 0;
  let cursorCh = 0;
  for (let i = 0; i < lines.length; i++) {
    if (cursorOffset >= cur && cursorOffset <= cur + lines[i].length) {
      cursorLine = i;
      cursorCh = cursorOffset - cur;
      break;
    }
    cur += lines[i].length + 1;
  }
  return {
    getValue: () => text,
    getCursor: () => ({ line: cursorLine, ch: cursorCh }),
    posToOffset: () => cursorOffset,
  };
}

function setActiveEditor(app, file, editor, mode = "source") {
  const activeView = { file, editor, contentEl: new FakeElement(), getMode: () => mode };
  app.workspace.getActiveViewOfType = () => activeView;
  return activeView;
}

function installFakeTimers() {
  const previousWindow = globalThis.window;
  const timers = new Map();
  let nextId = 1;
  globalThis.window = {
    setTimeout: (fn) => { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  return {
    pendingCount: () => timers.size,
    runAll() {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
    restore() { globalThis.window = previousWindow; },
  };
}

function createFullTestEnvironment() {
  const projectRoot = new TFolder("PROJECT");
  const projectResearch = new TFolder("PROJECT/Project-Research");
  projectResearch.parent = projectRoot;

  const allowedPerson = new TFile("PROJECT/Project-Research/Allowed-Person.md");
  allowedPerson.parent = projectResearch;
  allowedPerson.basename = "Allowed-Person";
  allowedPerson.content = "Research on Allowed-Person.";

  const allowedMilestone = new TFile("PROJECT/Project-Research/Allowed-Milestone.md");
  allowedMilestone.parent = projectResearch;
  allowedMilestone.basename = "Allowed-Milestone";
  allowedMilestone.content = "Chronology milestone in project research.";

  projectResearch.children = [allowedPerson, allowedMilestone];

  const workA = new TFolder("PROJECT/Work-A");
  workA.parent = projectRoot;
  const workAResearch = new TFolder("PROJECT/Work-A/Work-Research");
  workAResearch.parent = workA;
  workAResearch.children = [];

  const nestedFolder = new TFolder("PROJECT/Work-A/Nested-Folder");
  nestedFolder.parent = workA;
  const nestedResearch = new TFolder("PROJECT/Work-A/Nested-Folder/Nested-Research");
  nestedResearch.parent = nestedFolder;

  const relatedDocOne = new TFile("PROJECT/Work-A/Nested-Folder/Nested-Research/Related-Document-One.md");
  relatedDocOne.parent = nestedResearch;
  relatedDocOne.basename = "Related-Document-One";
  relatedDocOne.content = "The archipelago navigator navigated across stormy waters.";
  relatedDocOne.stat = { mtime: 1 };

  const relatedDocTwo = new TFile("PROJECT/Work-A/Nested-Folder/Nested-Research/Related-Document-Two.md");
  relatedDocTwo.parent = nestedResearch;
  relatedDocTwo.basename = "Related-Document-Two";
  relatedDocTwo.content = "The astronomy observatory recorded celestial phenomena.";
  relatedDocTwo.stat = { mtime: 1 };

  const relatedDocThree = new TFile("PROJECT/Work-A/Nested-Folder/Nested-Research/Related-Document-Three.md");
  relatedDocThree.parent = nestedResearch;
  relatedDocThree.basename = "Related-Document-Three";
  relatedDocThree.content = "The botanical manuscript cataloged therapeutic alpine plants.";
  relatedDocThree.stat = { mtime: 1 };

  nestedResearch.children = [relatedDocOne, relatedDocTwo, relatedDocThree];

  const docA = new TFile("PROJECT/Work-A/Nested-Folder/Document-A.md");
  docA.parent = nestedFolder;
  docA.basename = "Document-A";
  docA.content = "";
  docA.stat = { mtime: 1 };

  nestedFolder.children = [nestedResearch, docA];
  workA.children = [workAResearch, nestedFolder];

  const soy = new TFolder("PROJECT/Soy");
  soy.parent = projectRoot;
  const soyResearch = new TFolder("PROJECT/Soy/Soy-Research");
  soyResearch.parent = soy;

  const leakedPerson = new TFile("PROJECT/Soy/Soy-Research/Leaked-Person.md");
  leakedPerson.parent = soyResearch;
  leakedPerson.basename = "Leaked-Person";
  leakedPerson.content = "Leaked person details.";

  const leakedMilestone = new TFile("PROJECT/Soy/Soy-Research/Leaked-Milestone.md");
  leakedMilestone.parent = soyResearch;
  leakedMilestone.basename = "Leaked-Milestone";
  leakedMilestone.content = "Leaked milestone details.";

  const pinnedExternal = new TFile("PROJECT/Soy/Soy-Research/Pinned-External.md");
  pinnedExternal.parent = soyResearch;
  pinnedExternal.basename = "Pinned-External";
  pinnedExternal.content = "Pinned external note.";

  soyResearch.children = [leakedPerson, leakedMilestone, pinnedExternal];
  soy.children = [soyResearch];

  projectRoot.children = [projectResearch, workA, soy];

  const allFiles = [
    projectRoot, projectResearch, allowedPerson, allowedMilestone,
    workA, workAResearch,
    nestedFolder, nestedResearch, relatedDocOne, relatedDocTwo, relatedDocThree, docA,
    soy, soyResearch, leakedPerson, leakedMilestone, pinnedExternal,
  ];
  const filesByPath = new Map(allFiles.map((f) => [f.path, f]));

  const researchLinks = new Map([
    [projectRoot.path, projectResearch],
    [workA.path, workAResearch],
    [nestedFolder.path, nestedResearch],
    [soy.path, soyResearch],
  ]);

  const frontmatterByPath = new Map([
    [docA.path, { date: "1826" }],
    [allowedMilestone.path, { date: "1826" }],
    [leakedMilestone.path, { date: "1826" }],
  ]);

  const sharedStoryDate = { raw: "1826", sort: 18260000, y: 1826, m: null, d: null, approx: false };

  const app = {
    vault: {
      getAbstractFileByPath: (path) => filesByPath.get(path) ?? null,
      cachedRead: async (file) => file.content ?? "",
      on: () => ({}),
    },
    workspace: {
      getActiveFile: () => docA,
      getActiveViewOfType: () => null,
      getLeaf: () => ({}),
      on: () => ({}),
    },
    metadataCache: {
      on: () => ({}),
      getFileCache: () => null,
    },
  };

  const plugin = {
    settings: {
      collapsed: {},
      notesSectionOrder: ["Synopsis", "Résumé", "Notes"],
      notesShowEntities: true,
      notesShowFootnotes: true,
      notesShowNotes: true,
      notesShowResume: true,
      notesShowSynopsis: true,
      notesPinned: {},
      projectMeta: {
        [projectRoot.path]: {
          researchFolderLinks: Object.fromEntries(
            [...researchLinks.entries()].map(([k, v]) => [k, v.path])
          ),
        },
      },
    },
    getProjectFolder: () => projectRoot,
    getResearchRoot: () => soyResearch,
    getWorkspaceFolder: () => null,
    getLinkedResearchFolder: (node) => researchLinks.get(node.path) ?? null,
    titleFor: (file) => file.basename,
    tagsOf: () => [],
    roleOfFolder: () => "chapitre",
    parseStoryDate: (raw) => (raw === "1826" ? sharedStoryDate : null),
    getChronoFolder: () => projectRoot,
    isFrontMatter: () => false,
    hasSources: () => false,
    saveSettings: async () => {},
  };

  return {
    app,
    plugin,
    projectRoot,
    projectResearch,
    allowedPerson,
    allowedMilestone,
    workA,
    workAResearch,
    nestedFolder,
    nestedResearch,
    relatedDocOne,
    relatedDocTwo,
    relatedDocThree,
    docA,
    soy,
    soyResearch,
    leakedPerson,
    leakedMilestone,
    pinnedExternal,
    sharedStoryDate,
    frontmatterByPath,
  };
}

test("11. Integration: Chronological milestones from sibling research workspaces are filtered out", async () => {
  const env = createFullTestEnvironment();
  const { app, plugin, docA, allowedMilestone, leakedMilestone, allowedPerson, leakedPerson, pinnedExternal } = env;

  docA.content = "In this passage, Allowed-Person and Leaked-Person are mentioned in the text.";
  plugin.settings.notesPinned[docA.path] = [pinnedExternal.path];

  const contentEl = new FakeElement();
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = (file) => env.frontmatterByPath.get(file.path) ?? {};
  view.currentFile = docA;

  const fm = view.fm(docA);
  const sceneDate = plugin.parseStoryDate(fm.date, docA);
  assert.ok(sceneDate, "Scene date must be resolved");

  const chronoFolder = plugin.getChronoFolder();
  const jalons = [];
  if (sceneDate && chronoFolder) {
    const walk = (folder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md") {
          const d = plugin.parseStoryDate(view.fm(child).date, child);
          if (d && d.sort === sceneDate.sort) jalons.push(child);
        }
      }
    };
    walk(chronoFolder);
  }

  // Assertion 3: Leaked-Milestone existed in the chronological input before filtering
  assert.ok(jalons.some((j) => j.path === leakedMilestone.path), "Leaked-Milestone existed in the chronological input before filtering");
  assert.ok(jalons.some((j) => j.path === allowedMilestone.path), "Allowed-Milestone existed in the chronological input before filtering");

  await view.renderCitedEntities(contentEl, docA, sceneDate, jalons);

  const rendered = citedNames(contentEl);

  // Assertion 1: Allowed-Milestone is rendered
  assert.ok(rendered.includes("Allowed-Milestone"), "Allowed-Milestone is rendered");

  // Assertion 2: Leaked-Milestone is not rendered
  assert.ok(!rendered.includes("Leaked-Milestone"), "Leaked-Milestone is not rendered");

  // Assertion 4: Allowed-Person remains usable through normal context matcher
  assert.ok(rendered.includes(allowedPerson.basename), "Allowed-Person remains usable through normal context matcher");

  // Assertion 5: Leaked-Person is not rendered
  assert.ok(!rendered.includes(leakedPerson.basename), "Leaked-Person is not rendered");

  // Assertion 6: An explicitly pinned external file remains in the pinned section
  const pinned = pinnedNames(contentEl);
  assert.deepEqual(pinned, ["Pinned-External"], "An explicitly pinned external file remains in the pinned section");
});

test("12. Integration: Related documents are strictly based on the paragraph containing the real cursor", async () => {
  const env = createFullTestEnvironment();
  const { app, plugin, docA } = env;

  const para1 = "The archipelago navigator sailed through severe ocean storms.";
  const para2 = "The astronomy observatory tracked anomalous planetary alignments.";
  const para3 = "The botanical manuscript recorded rare alpine medicinal herbs.";
  const fullText = [para1, para2, para3].join("\n\n");
  docA.content = fullText;

  const contentEl = new FakeElement();
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = (file) => env.frontmatterByPath.get(file.path) ?? {};
  view.currentFile = docA;

  const offsetPara2 = fullText.indexOf(para2) + 5;
  const activeView = setActiveEditor(app, docA, fakeEditor(fullText, offsetPara2));

  await view.renderCitedEntities(contentEl, docA, null, []);

  // Assertion 1: Related-Document-Two is rendered
  assert.deepEqual(relatedDocNames(contentEl), ["Related-Document-Two"], "Related-Document-Two is rendered for paragraph two");

  // Assertion 2: Related-Document-One is not rendered
  assert.ok(!relatedDocNames(contentEl).includes("Related-Document-One"), "Related-Document-One is not rendered");

  // Assertion 3: Related-Document-Three is not rendered
  assert.ok(!relatedDocNames(contentEl).includes("Related-Document-Three"), "Related-Document-Three is not rendered");

  // Trigger cursor event refresh to paragraph three
  const timers = installFakeTimers();
  try {
    const offsetPara3 = fullText.indexOf(para3) + 5;
    activeView.editor = fakeEditor(fullText, offsetPara3);
    let renderPromise = null;
    const origRender = view.render.bind(view);
    view.render = () => {
      renderPromise = origRender();
      return renderPromise;
    };
    activeView.contentEl.events.get("keyup")();
    timers.runAll();
    if (renderPromise) await renderPromise;
  } finally {
    timers.restore();
  }

  // Assertion 4: Moving the cursor to paragraph three replaces results with Related-Document-Three
  assert.deepEqual(relatedDocNames(contentEl), ["Related-Document-Three"], "Results replaced with Related-Document-Three");
  assert.ok(!relatedDocNames(contentEl).includes("Related-Document-Two"), "Related-Document-Two is no longer rendered");

  // Assertion 5: The section is not duplicated after refresh
  const relatedSections = allElements(contentEl).filter((el) => el.classes.has("feuillets-related-docs-section"));
  assert.equal(relatedSections.length, 1, "The section is not duplicated after refresh");

  // Assertion 6: The file content is not modified
  assert.equal(docA.content, fullText, "The file content is not modified");
});

test("13. Fallback: No active editor for the exact file leaves related documents absent while reliable context uses full-sheet fallback", async () => {
  const env = createFullTestEnvironment();
  const { app, plugin, docA } = env;

  docA.content = "In this passage, Allowed-Person is mentioned alongside the astronomy observatory.";
  app.workspace.getActiveViewOfType = () => null;

  const contentEl = new FakeElement();
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = (file) => env.frontmatterByPath.get(file.path) ?? {};
  view.currentFile = docA;

  await view.renderCitedEntities(contentEl, docA, null, []);

  // Related documents is absent
  assert.equal(relatedDocsSection(contentEl), undefined, "Related documents section must be absent when no active editor exists");
  assert.deepEqual(relatedDocNames(contentEl), []);

  // Reliable CONTEXT still uses its historical full-sheet fallback
  assert.ok(reliableSection(contentEl), "Reliable CONTEXT section exists");
  const reliable = citedNames(contentEl);
  assert.ok(reliable.includes("Allowed-Person"), "Reliable CONTEXT uses historical full-sheet fallback");
});

test("14. Fallback: Reading mode leaves related documents absent without exception", async () => {
  const env = createFullTestEnvironment();
  const { app, plugin, docA } = env;

  docA.content = "In this passage, Allowed-Person is mentioned alongside the astronomy observatory.";
  setActiveEditor(app, docA, fakeEditor(docA.content, 10), "preview");

  const contentEl = new FakeElement();
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = (file) => env.frontmatterByPath.get(file.path) ?? {};
  view.currentFile = docA;

  await view.renderCitedEntities(contentEl, docA, null, []);

  // Related documents is absent
  assert.equal(relatedDocsSection(contentEl), undefined, "Related documents section must be absent in Reading mode");
  assert.deepEqual(relatedDocNames(contentEl), []);

  // Reliable CONTEXT still works
  const reliable = citedNames(contentEl);
  assert.ok(reliable.includes("Allowed-Person"), "Reliable CONTEXT still works in Reading mode");
});

test("15. Fallback: Cursor on a blank line leaves related documents absent", async () => {
  const env = createFullTestEnvironment();
  const { app, plugin, docA } = env;

  const fullText = "The astronomy observatory recorded celestial phenomena.\n\n\n\nThe botanical manuscript cataloged plants.";
  docA.content = fullText;

  const blankLineOffset = fullText.indexOf("\n\n") + 1;
  setActiveEditor(app, docA, fakeEditor(fullText, blankLineOffset));

  const contentEl = new FakeElement();
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = (file) => env.frontmatterByPath.get(file.path) ?? {};
  view.currentFile = docA;

  await view.renderCitedEntities(contentEl, docA, null, []);

  assert.equal(relatedDocsSection(contentEl), undefined, "Related documents section must be absent when cursor is on a blank line");
  assert.deepEqual(relatedDocNames(contentEl), []);
});

test("16. Fallback: Two identical paragraphs at different positions change tracked identity and trigger refresh", async () => {
  const env = createFullTestEnvironment();
  const { app, plugin, docA } = env;

  const repeatedText = "The astronomy observatory recorded celestial phenomena.";
  const middleText = "A completely different middle paragraph separating the identical blocks.";
  const fullText = [repeatedText, middleText, repeatedText].join("\n\n");
  docA.content = fullText;

  const offsetFirst = 5;
  const offsetSecond = fullText.lastIndexOf(repeatedText) + 5;

  const contentEl = new FakeElement();
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = (file) => env.frontmatterByPath.get(file.path) ?? {};
  view.currentFile = docA;

  const activeView = setActiveEditor(app, docA, fakeEditor(fullText, offsetFirst));
  await view.renderCitedEntities(contentEl, docA, null, []);

  const firstIdentity = view["lastCursorParagraphIdentity"];
  assert.ok(firstIdentity, "First paragraph identity must be recorded");

  activeView.editor = fakeEditor(fullText, offsetSecond);
  const secondParagraph = view["cursorParagraph"](docA);
  assert.ok(secondParagraph, "Second paragraph must be resolved");
  assert.equal(secondParagraph.text, repeatedText, "Paragraph texts must be identical");
  assert.notEqual(secondParagraph.identity, firstIdentity, "Tracked identity must differ by position");

  const timers = installFakeTimers();
  try {
    let refreshCount = 0;
    const origRender = view.render.bind(view);
    view.render = async (...args) => {
      refreshCount++;
      return origRender(...args);
    };
    activeView.contentEl.events.get("keyup")();
    timers.runAll();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(refreshCount, 1, "Refresh must trigger when moving between identical paragraphs at different positions");

    activeView.editor = fakeEditor(fullText, offsetSecond + 2); // within same paragraph
    activeView.contentEl.events.get("keyup")();
    timers.runAll();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(refreshCount, 1, "Refresh must NOT trigger when moving within the same paragraph");
  } finally {
    timers.restore();
  }
});

function createRealContainerEnvironment() {
  const projectRoot = new TFolder("PROJECT");

  const workA = new TFolder("PROJECT/Work-A");
  workA.parent = projectRoot;

  const nestedFolder = new TFolder("PROJECT/Work-A/Nested-Folder");
  nestedFolder.parent = workA;

  const docA = new TFile("PROJECT/Work-A/Nested-Folder/Document-A.md");
  docA.parent = nestedFolder;
  docA.basename = "Document-A";
  docA.content = "";
  docA.stat = { mtime: 1 };

  nestedFolder.children = [docA];
  workA.children = [nestedFolder];

  const workB = new TFolder("PROJECT/Work-B");
  workB.parent = projectRoot;
  workB.children = [];

  const feuillets = new TFolder("PROJECT/_Feuillets");
  feuillets.parent = projectRoot;

  const researchContainer = new TFolder("PROJECT/_Feuillets/Research");
  researchContainer.parent = feuillets;

  const researchA = new TFolder("PROJECT/_Feuillets/Research/Research-A");
  researchA.parent = researchContainer;

  const workResearch = new TFolder("PROJECT/_Feuillets/Research/Research-A/Work-Research");
  workResearch.parent = researchA;

  const allowedPerson = new TFile("PROJECT/_Feuillets/Research/Research-A/Work-Research/Allowed-Person.md");
  allowedPerson.parent = workResearch;
  allowedPerson.basename = "Allowed-Person";
  allowedPerson.content = "Research details about Allowed-Person.";
  allowedPerson.stat = { mtime: 1 };
  workResearch.children = [allowedPerson];

  const nestedResearch = new TFolder("PROJECT/_Feuillets/Research/Research-A/Nested-Research");
  nestedResearch.parent = researchA;
  nestedResearch.children = [];

  researchA.children = [workResearch, nestedResearch];

  const soy = new TFolder("PROJECT/_Feuillets/Research/Soy");
  soy.parent = researchContainer;

  const leakedPerson = new TFile("PROJECT/_Feuillets/Research/Soy/Leaked-Person.md");
  leakedPerson.parent = soy;
  leakedPerson.basename = "Leaked-Person";
  leakedPerson.content = "Research details about Leaked-Person.";
  leakedPerson.stat = { mtime: 1 };

  const leakedMilestone = new TFile("PROJECT/_Feuillets/Research/Soy/Leaked-Milestone.md");
  leakedMilestone.parent = soy;
  leakedMilestone.basename = "Leaked-Milestone";
  leakedMilestone.content = "Chronology milestone in leaked research.";
  leakedMilestone.stat = { mtime: 1 };

  soy.children = [leakedPerson, leakedMilestone];
  researchContainer.children = [researchA, soy];
  feuillets.children = [researchContainer];
  projectRoot.children = [workA, workB, feuillets];

  const allFiles = [
    projectRoot,
    workA,
    nestedFolder,
    docA,
    workB,
    feuillets,
    researchContainer,
    researchA,
    workResearch,
    allowedPerson,
    nestedResearch,
    soy,
    leakedPerson,
    leakedMilestone,
  ];
  const filesByPath = new Map(allFiles.map((f) => [f.path, f]));

  const researchFolderLinks = {
    [workA.path]: workResearch.path,
    [nestedFolder.path]: nestedResearch.path,
    [workB.path]: soy.path,
  };

  const frontmatterByPath = new Map([
    [docA.path, { date: "1826" }],
    [allowedPerson.path, {}],
    [leakedPerson.path, {}],
    [leakedMilestone.path, { date: "1826" }],
  ]);

  const sharedStoryDate = { raw: "1826", sort: 18260000, y: 1826, m: null, d: null, approx: false };

  const app = {
    vault: {
      getAbstractFileByPath: (path) => filesByPath.get(path) ?? null,
      cachedRead: async (file) => file.content ?? "",
      on: () => ({}),
    },
    workspace: {
      getActiveFile: () => docA,
      getActiveViewOfType: () => null,
      getLeaf: () => ({}),
      on: () => ({}),
    },
    metadataCache: {
      on: () => ({}),
      getFileCache: () => null,
    },
  };

  const plugin = {
    settings: {
      collapsed: {},
      notesSectionOrder: ["Synopsis", "Résumé", "Notes"],
      notesShowEntities: true,
      notesShowFootnotes: true,
      notesShowNotes: true,
      notesShowResume: true,
      notesShowSynopsis: true,
      notesPinned: {},
      projectMeta: {
        [projectRoot.path]: {
          researchFolderLinks: { ...researchFolderLinks },
        },
      },
    },
    getProjectFolder: () => projectRoot,
    getResearchRoot: () => researchContainer,
    getWorkspaceFolder: () => null,
    getLinkedResearchFolder: (node) => {
      const targetPath = plugin.settings.projectMeta[projectRoot.path]?.researchFolderLinks?.[node.path];
      if (!targetPath) return null;
      const targetFile = filesByPath.get(targetPath);
      return targetFile instanceof TFolder ? targetFile : null;
    },
    titleFor: (file) => file.basename,
    tagsOf: () => [],
    roleOfFolder: () => "chapitre",
    parseStoryDate: (raw) => (raw === "1826" ? sharedStoryDate : null),
    getChronoFolder: () => researchContainer,
    isFrontMatter: () => false,
    hasSources: () => false,
    saveSettings: async () => {},
  };

  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new NotesView(leaf, plugin);
  view.fm = (file) => frontmatterByPath.get(file.path) ?? {};
  view.currentFile = docA;

  return {
    app,
    plugin,
    view,
    contentEl,
    projectRoot,
    workA,
    nestedFolder,
    docA,
    workB,
    feuillets,
    researchContainer,
    researchA,
    workResearch,
    allowedPerson,
    nestedResearch,
    soy,
    leakedPerson,
    leakedMilestone,
    sharedStoryDate,
    frontmatterByPath,
    filesByPath,
  };
}

test("17. Regression: Canonical research storage container is not added when explicit associations exist", () => {
  const env = createRealContainerEnvironment();
  const sources = env.view["contextSourcesFor"](env.docA);
  const paths = sources.map((s) => s.path);

  // 1. It contains Nested-Research
  assert.ok(paths.includes(env.nestedResearch.path), "Must contain Nested-Research");
  // 2. It contains Work-Research
  assert.ok(paths.includes(env.workResearch.path), "Must contain Work-Research");
  // 3. It does not contain PROJECT/_Feuillets/Research
  assert.ok(!paths.includes(env.researchContainer.path), "Must not contain canonical research storage container");
  // 4. It does not contain Soy
  assert.ok(!paths.includes(env.soy.path), "Must not contain Soy");
  // 5. Every returned source comes from an explicit link on the file's ancestor chain
  assert.deepEqual(paths, [env.nestedResearch.path, env.workResearch.path]);
});

test("18. Real render: sibling research documents and milestones below Soy never leak into CONTEXT or related documents", async () => {
  const env = createRealContainerEnvironment();
  const { app, docA, allowedPerson, leakedPerson, leakedMilestone, contentEl, view, plugin, soy, researchContainer } = env;

  docA.content = "In this passage, Allowed-Person is present and Leaked-Person is also mentioned.";

  // Set up active editor so cursor tracking and related documents are active
  setActiveEditor(app, docA, fakeEditor(docA.content, 5));

  // Give Document-A and Leaked-Milestone the same story date
  const sceneDate = plugin.parseStoryDate(view.fm(docA).date, docA);
  assert.ok(sceneDate, "Scene date must be resolved");

  // Collect chronological milestones before NotesView filtering
  const chronoFolder = plugin.getChronoFolder();
  const jalons = [];
  const walk = (folder) => {
    for (const child of folder.children) {
      if (child instanceof TFolder) walk(child);
      else if (child instanceof TFile && child.extension === "md") {
        const d = plugin.parseStoryDate(view.fm(child).date, child);
        if (d && d.sort === sceneDate.sort) jalons.push(child);
      }
    }
  };
  walk(chronoFolder);

  // Leaked-Milestone existed in the chronological input before NotesView filtering
  assert.ok(jalons.some((j) => j.path === leakedMilestone.path), "Leaked-Milestone must be present in input jalons before filtering");

  // Ensure broad vault/index input contains Leaked-Person before NotesView filtering
  const allVaultDocs = [
    { path: allowedPerson.path, basename: allowedPerson.basename, title: allowedPerson.basename, tags: [], aliases: [] },
    { path: leakedPerson.path, basename: leakedPerson.basename, title: leakedPerson.basename, tags: [], aliases: [] },
  ];
  view["collectContextDocuments"] = (_sources) => allVaultDocs;

  // Exercise the real NotesView rendering path
  await view.renderCitedEntities(contentEl, docA, sceneDate, jalons);

  const rendered = citedNames(contentEl);

  // Allowed-Person is rendered in reliable CONTEXT
  assert.ok(rendered.includes(allowedPerson.basename), "Allowed-Person must be rendered in reliable CONTEXT");
  // Leaked-Person is not rendered
  assert.ok(!rendered.includes(leakedPerson.basename), "Leaked-Person must not be rendered");
  // Leaked-Milestone is not rendered
  assert.ok(!rendered.includes(leakedMilestone.basename), "Leaked-Milestone must not be rendered");

  // No rendered reliable-context item has a path below PROJECT/_Feuillets/Research/Soy
  const allContextRows = allElements(contentEl).filter((el) => el.classes.has("feuillets-entity-row"));
  for (const row of allContextRows) {
    const titleEl = allElements(row).find((el) => el.classes.has("feuillets-entity-name"));
    const title = titleEl ? titleEl.text.replace(/^•\s*/, "") : "";
    assert.notEqual(title, leakedPerson.basename, "No row should have Leaked-Person title");
    assert.notEqual(title, leakedMilestone.basename, "No row should have Leaked-Milestone title");
  }

  // Related documents also contain no file below Soy
  const relatedNames = relatedDocNames(contentEl);
  assert.ok(!relatedNames.includes(leakedPerson.basename), "Related documents must not contain Leaked-Person");
  assert.ok(!relatedNames.includes(leakedMilestone.basename), "Related documents must not contain Leaked-Milestone");

  // Common research container is never present in resolved sources
  const resolvedSources = view["contextSourcesFor"](docA);
  assert.ok(!resolvedSources.some((s) => s.path === researchContainer.path), "Common research container must never be present in resolved sources");
  assert.ok(!resolvedSources.some((s) => s.path.startsWith(soy.path)), "Soy or children must never be present in resolved sources");

  // Also verify contentSourcesFor(docA) contains no container or Soy path
  const contentSources = view["contentSourcesFor"](docA);
  assert.ok(!contentSources.some((s) => s.path === researchContainer.path), "Common research container must not be present in content sources");
  assert.ok(!contentSources.some((s) => s.path.startsWith(soy.path)), "Soy must not be present in content sources");
});

test("19. Edge 1: Explicit project-root association is included normally", () => {
  const env = createRealContainerEnvironment();
  const projectResearch = new TFolder("PROJECT/_Feuillets/Research/Project-Research");
  projectResearch.parent = env.researchContainer;
  env.filesByPath.set(projectResearch.path, projectResearch);

  // Set explicit link on projectRoot
  env.plugin.settings.projectMeta[env.projectRoot.path].researchFolderLinks[env.projectRoot.path] = projectResearch.path;

  const sources = env.view["contextSourcesFor"](env.docA);
  const paths = sources.map((s) => s.path);

  assert.ok(paths.includes(projectResearch.path), "Project-Research must be included from explicit project-root link");
  const projectSource = sources.find((s) => s.path === projectResearch.path);
  assert.equal(projectSource?.kind, "project-research");
  assert.ok(!paths.includes(env.researchContainer.path), "Common research container must not be included");
});

test("20. Edge 2: Explicit associations exist only on sibling branch leaves contextSourcesFor empty without fallback", () => {
  const env = createRealContainerEnvironment();
  // Sibling association only
  env.plugin.settings.projectMeta[env.projectRoot.path].researchFolderLinks = {
    [env.workB.path]: env.soy.path,
  };

  const sources = env.view["contextSourcesFor"](env.docA);
  assert.deepEqual(sources, [], "contextSourcesFor must be empty when Document-A has no links on ancestor chain");
  assert.ok(!sources.some((s) => s.path === env.researchContainer.path), "Must not fall back to canonical container");
  assert.ok(!sources.some((s) => s.path === env.soy.path), "Must not include sibling link");
});

test("21. Edge 3: Legacy project with absent or empty researchFolderLinks preserves historical fallback without mutating settings", () => {
  const env = createRealContainerEnvironment();
  // 1. Absent researchFolderLinks
  delete env.plugin.settings.projectMeta[env.projectRoot.path].researchFolderLinks;
  const originalSettingsJson = JSON.stringify(env.plugin.settings);

  const sourcesAbsent = env.view["contextSourcesFor"](env.docA);
  const pathsAbsent = sourcesAbsent.map((s) => s.path);

  assert.ok(pathsAbsent.includes(env.researchContainer.path), "Legacy fallback includes getResearchRoot()");
  const fallbackSource = sourcesAbsent.find((s) => s.path === env.researchContainer.path);
  assert.equal(fallbackSource?.kind, "project-research");
  assert.equal(JSON.stringify(env.plugin.settings), originalSettingsJson, "Settings must not be mutated when researchFolderLinks is absent");

  // 2. Empty researchFolderLinks object {}
  env.plugin.settings.projectMeta[env.projectRoot.path].researchFolderLinks = {};
  const emptySettingsJson = JSON.stringify(env.plugin.settings);

  const sourcesEmpty = env.view["contextSourcesFor"](env.docA);
  const pathsEmpty = sourcesEmpty.map((s) => s.path);

  assert.ok(pathsEmpty.includes(env.researchContainer.path), "Legacy fallback includes getResearchRoot() when researchFolderLinks is empty");
  assert.equal(JSON.stringify(env.plugin.settings), emptySettingsJson, "Settings must not be mutated when researchFolderLinks is empty");
});

test("22. Edge 4: Stale configured association does not trigger fallback to canonical container", () => {
  const env = createRealContainerEnvironment();
  // Point to a non-existent path
  env.plugin.settings.projectMeta[env.projectRoot.path].researchFolderLinks = {
    [env.workA.path]: "PROJECT/_Feuillets/Research/Research-A/Deleted-Work-Research",
  };

  const sources = env.view["contextSourcesFor"](env.docA);
  const paths = sources.map((s) => s.path);

  assert.ok(!paths.includes(env.researchContainer.path), "Stale association must not fall back to canonical container");
  assert.deepEqual(sources, [], "Sources must be empty when configured target no longer exists");
});
