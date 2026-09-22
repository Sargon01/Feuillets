import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder, Notice } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";
import { ResearchView } from "../src/views/research-view.js";
import { flattenFiles } from "../src/services/folder-structure.js";
import { analyzeResearchCitations } from "../src/services/research-citation-analysis.js";
import { saveCitationRegistry } from "../src/services/citation-registry.js";
import { createSourceAnchor } from "../src/services/source-anchor.js";
import { createFakeVault } from "./helpers/fake-vault.js";

globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
};
globalThis.document ??= {
  activeElement: null,
};

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
    this.attrs = new Map();
    this.value = options.value ?? "";
    this.placeholder = options.placeholder ?? "";
    this.scrollTop = 0;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.tag = options.tag || "div";
    this.style = {};
    if (options.cls) {
      this.addClass(options.cls);
    }
  }

  addClass(className) {
    for (const part of String(className).split(/\s+/)) {
      if (part) this.classes.add(part);
    }
    return this;
  }

  removeClass(className) {
    for (const part of String(className).split(/\s+/)) {
      if (part) this.classes.delete(part);
    }
    return this;
  }

  hasClass(className) {
    return this.classes.has(className);
  }

  createDiv(options = {}) {
    const child = new FakeElement(options);
    child.tag = "div";
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(options);
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
      if (!selector.startsWith(".") && child.tag === selector.toLowerCase()) return child;
      const nested = child.find(selector);
      if (nested) return nested;
    }
    return null;
  }

  findAll(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    const results = [];
    for (const child of this.children) {
      if (className && child.classes.has(className)) results.push(child);
      if (!selector.startsWith(".") && child.tag === selector.toLowerCase()) results.push(child);
      results.push(...child.findAll(selector));
    }
    return results;
  }

  querySelector(selector) {
    return this.find(selector);
  }

  querySelectorAll(selector) {
    return this.findAll(selector);
  }

  addEventListener(type, callback) {
    this.events ||= new Map();
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(callback);
  }

  dispatchEvent(type, event = {}) {
    const handlers = this.events?.get(type) || [];
    for (const h of handlers) h(event);
  }

  setText(text) {
    this.text = String(text);
    return this;
  }

  getText() {
    return this.text;
  }

  setAttr(name, value) {
    this.attrs.set(name, value);
    return this;
  }

  getAttr(name) {
    return this.attrs.get(name);
  }

  setAttribute(name, value) {
    this.attrs.set(name, value);
    return this;
  }

  getAttribute(name) {
    return this.attrs.get(name);
  }

  empty() {
    this.children = [];
    this.text = "";
    return this;
  }

  focus() {}
  blur() {}

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  contains(other) {
    if (this === other) return true;
    for (const child of this.children) {
      if (child.contains(other)) return true;
    }
    return false;
  }

  get textContent() {
    return (this.text || "") + this.children.map((c) => c.textContent).join(" ");
  }

  set textContent(val) {
    this.text = String(val);
  }
}

function createMockAppAndPlugin(vault, settings, initialActiveFile = null) {
  const registeredEvents = [];
  const eventCallbacks = new Map();
  const registerEventCallback = (event, callback) => {
    const ref = { event, callback };
    registeredEvents.push(ref);
    if (!eventCallbacks.has(event)) eventCallbacks.set(event, []);
    eventCallbacks.get(event).push(callback);
    return ref;
  };

  let currentActiveFile = initialActiveFile;
  const app = {
    vault,
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: file.frontmatter || {},
      }),
    },
    workspace: {
      getActiveFile: () => currentActiveFile,
      setActiveFile: (f) => {
        currentActiveFile = f;
      },
      on: (event, callback) => registerEventCallback(event, callback),
      trigger: (event, ...args) => {
        const cbs = eventCallbacks.get(event) || [];
        for (const cb of cbs) cb(...args);
      },
    },
  };
  vault.cachedRead = vault.read;
  vault.on = (event, callback) => registerEventCallback(event, callback);
  vault.trigger = (event, ...args) => {
    const cbs = eventCallbacks.get(event) || [];
    for (const cb of cbs) cb(...args);
  };

  if (!settings.collapsed) settings.collapsed = {};
  if (!settings.orders) settings.orders = {};
  if (!settings.folderPositions) settings.folderPositions = {};
  if (!settings.researchOrder) settings.researchOrder = {};
  const plugin = {
    settings,
    app,
    fmOf: (f) => f.frontmatter || {},
    titleFor: (f) => f.basename || f.name || f.path,
    saveSettings: async () => {},
    generateBibliographyFile: async () => {},
    getProjectFolder: () => vault.getAbstractFileByPath(settings.projectFolder),
    getWorkspaceFolder: () => null,
    getResearchRoot: () => null,
    getChronoFolder: () => null,
    getLinkedResearchFolders: () => [],
    tagsOf: () => [],
    openInsertCitation: () => {},
    renumberActiveFootnotes: () => {},
    buildNumbering: () => new Map(),
    flattenFiles: (folder) => flattenFiles(app, settings, folder),
  };

  return { app, plugin, registeredEvents, eventCallbacks };
}

test("ResearchView: renderBibliographySection displays empty state when no sources or citekeys", async () => {
  const project = new TFolder("Project");
  const sourcesFolder = new TFolder("Project/_Research/Sources");
  project.children = [sourcesFolder];
  sourcesFolder.parent = project;
  sourcesFolder.children = [];

  const { vault } = createFakeVault([project, sourcesFolder]);
  const settings = { projectFolder: "Project", projectMeta: { Project: {} } };
  const { app, plugin } = createMockAppAndPlugin(vault, settings);

  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);

  const documentContext = { mode: "project", projectRoot: project, scopeRoot: project, workspaceRoot: null, files: [] };
  const citationAnalysis = { citekeyCounts: new Map(), sourceCitationCounts: new Map() };

  const container = new FakeElement();
  await view.renderBibliographySection(container, documentContext, citationAnalysis);

  const emptyEl = container.find(".feuillets-research-empty");
  assert.ok(emptyEl);
  assert.match(emptyEl.text, /Aucune source citée|No source cited/);
});

test("ResearchView: coexistence of Source cards and BibTeX citations in the same Bibliography section", async () => {
  const project = new TFolder("Project");
  const manuscript = new TFolder("Project/Manuscript");
  const scene = new TFile("Project/Manuscript/Scene.md", "Discussion [@knuth1968] and [@unknownKey].");
  scene.extension = "md";
  scene.stat = { mtime: 1000, size: scene.content.length };
  manuscript.children = [scene];
  scene.parent = manuscript;

  const resFolder = new TFolder("Project/Research");
  const bibFile = new TFile("Project/Research/refs.bib", `@article{knuth1968,
    author = {Knuth, Donald},
    title = {Fundamental Algorithms},
    year = {1968}
  }`);
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 1000, size: bibFile.content.length };
  resFolder.children = [bibFile];
  bibFile.parent = resFolder;

  const sourcesFolder = new TFolder("Project/Research/Sources");
  const sourceCard = new TFile("Project/Research/Sources/Turing.md", "");
  sourceCard.extension = "md";
  sourceCard.frontmatter = { cite_count: 3, author: "Turing, Alan" };
  sourceCard.basename = "Turing 1936";
  sourcesFolder.children = [sourceCard];
  sourceCard.parent = sourcesFolder;

  project.children = [manuscript, resFolder, sourcesFolder];
  manuscript.parent = project;
  resFolder.parent = project;
  sourcesFolder.parent = project;

  const { vault } = createFakeVault([project, manuscript, scene, resFolder, bibFile, sourcesFolder, sourceCard]);
  const settings = {
    projectFolder: "Project",
    projectMeta: {
      "Project": {
        researchFolderLinks: {
          "Project": resFolder.path,
        },
        citekeyBibliographyPath: "refs.bib",
      },
    },
  };

  const { app, plugin } = createMockAppAndPlugin(vault, settings, scene);

  // The Source counter is now always read from the citation registry, never
  // from cite_count — seed a single real occurrence, anchored to an actual
  // fragment of Scene.md's content; cite_count (3) is kept as a deliberate
  // decoy value that must not surface anywhere.
  const citingQuote = "Discussion";
  await saveCitationRegistry(app, settings, {
    version: 1,
    citations: [{
      id: "occ-1",
      file: "Manuscript/Scene.md",
      sourcePath: sourceCard.path,
      ...createSourceAnchor(scene.content, scene.content.indexOf(citingQuote), scene.content.indexOf(citingQuote) + citingQuote.length),
    }],
  });

  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);

  const documentContext = { mode: "project", projectRoot: project, scopeRoot: project, workspaceRoot: null, files: [scene] };
  const citationAnalysis = await analyzeResearchCitations(app, settings, documentContext);

  const container = new FakeElement();
  await view.renderBibliographySection(container, documentContext, citationAnalysis);

  // Check Source card rendered
  const items = container.findAll(".feuillets-research-item");
  assert.equal(items.length, 3); // 1 source card + 1 known bibtex + 1 unknown key

  const sourceCardEl = items.find((el) => el.textContent.includes("Turing"));
  assert.ok(sourceCardEl);
  assert.match(sourceCardEl.textContent, /1 citation\b/, "the registry occurrence count is used");
  assert.doesNotMatch(sourceCardEl.textContent, /3 citation/, "the stale cite_count decoy must never surface");

  // Check BibTeX known entry rendered
  const bibtexItem = container.find(".feuillets-bibtex-citation-item");
  assert.ok(bibtexItem);
  assert.match(bibtexItem.textContent, /@knuth1968/);
  assert.match(bibtexItem.textContent, /Knuth, Donald/);
  assert.match(bibtexItem.textContent, /1968/);

  // Check unknown citekey warning rendered
  const unknownItem = container.find(".feuillets-bibtex-unknown-item");
  assert.ok(unknownItem);
  assert.match(unknownItem.textContent, /@unknownKey/);
  const warningEl = container.find(".feuillets-citekey-warning");
  assert.ok(warningEl);
});

test("ResearchView: renderBibliographySection does not register any listeners", async () => {
  const project = new TFolder("Project");
  const sourcesFolder = new TFolder("Project/Sources");
  sourcesFolder.children = [];
  project.children = [sourcesFolder];
  sourcesFolder.parent = project;

  const { vault } = createFakeVault([project, sourcesFolder]);
  const settings = { projectFolder: "Project", projectMeta: { Project: {} } };
  const { app, plugin, registeredEvents } = createMockAppAndPlugin(vault, settings);

  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);

  const initialCount = registeredEvents.length;
  const container = new FakeElement();
  const documentContext = { mode: "project", projectRoot: project, scopeRoot: project, workspaceRoot: null, files: [] };
  const citationAnalysis = { citekeyCounts: new Map(), sourceCitationCounts: new Map() };
  await view.renderBibliographySection(container, documentContext, citationAnalysis);
  assert.equal(registeredEvents.length, initialCount, "No new events should be registered in renderBibliographySection");
});

test("ResearchView: triggers debounced render when file-open, editor-change, or modify events fire", async () => {
  const project = new TFolder("Project");
  const research = new TFolder("Project/Research");
  const sources = new TFolder("Project/Research/Sources");
  const mdFile = new TFile("Project/Scene.md", "Content");
  mdFile.extension = "md";
  const bibFile = new TFile("Project/refs.bib", "@article{k, author={K}, year={2020}}");
  bibFile.extension = "bib";
  const pngFile = new TFile("Project/image.png", "binary");
  pngFile.extension = "png";

  research.children = [sources];
  sources.parent = research;
  project.children = [research, mdFile, bibFile, pngFile];
  research.parent = project;
  mdFile.parent = project;
  bibFile.parent = project;
  pngFile.parent = project;

  const { vault } = createFakeVault([project, research, sources, mdFile, bibFile, pngFile]);
  const settings = { projectFolder: "Project", projectMeta: { Project: {} } };
  const { app, plugin } = createMockAppAndPlugin(vault, settings, mdFile);

  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);

  let renderCount = 0;
  const originalRender = view.render.bind(view);
  view.render = async (force) => {
    renderCount++;
    return originalRender(force);
  };

  await view.onOpen();
  assert.equal(renderCount, 1, "Initial render on onOpen()");

  // 1. file-open event
  app.workspace.trigger("file-open", mdFile);
  assert.equal(renderCount, 1, "Debounced: no immediate render on file-open");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(renderCount, 2, "Render fired after 150ms debounce on file-open");

  // 2. editor-change event
  app.workspace.trigger("editor-change");
  assert.equal(renderCount, 2, "Debounced: no immediate render on editor-change");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(renderCount, 3, "Render fired after 150ms debounce on editor-change");

  // 3. modify event on .md file
  app.vault.trigger("modify", mdFile);
  assert.equal(renderCount, 3, "Debounced: no immediate render on .md modify");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(renderCount, 4, "Render fired after 150ms debounce on .md modify");

  // 4. modify event on .bib file
  app.vault.trigger("modify", bibFile);
  assert.equal(renderCount, 4, "Debounced: no immediate render on .bib modify");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(renderCount, 5, "Render fired after 150ms debounce on .bib modify");

  // 5. modify event on non-.md/.bib file (e.g. .png)
  app.vault.trigger("modify", pngFile);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(renderCount, 5, "No render for non-.md/.bib modifications");
});

test("ResearchView: active file changes never affect displayed references, only the resolved workspace scope does", async () => {
  const project = new TFolder("Project");
  const resFolder = new TFolder("Project/_Research");
  const sourcesFolder = new TFolder("Project/_Research/Sources");
  resFolder.children = [sourcesFolder];
  sourcesFolder.parent = resFolder;

  const branchA = new TFolder("Project/BranchA");
  const resA = new TFolder("Project/BranchA/Research");
  const bibA = new TFile("Project/BranchA/Research/refsA.bib", `@article{knuth1968, author={Knuth, Donald}, title={Fundamental Algorithms}, year={1968}}`);
  bibA.extension = "bib";
  bibA.stat = { mtime: 1000, size: bibA.content.length };
  resA.children = [bibA];
  bibA.parent = resA;
  const sceneA = new TFile("Project/BranchA/SceneA.md", "Scene A citing [@knuth1968].");
  sceneA.extension = "md";
  sceneA.stat = { mtime: 1000, size: sceneA.content.length };
  branchA.children = [resA, sceneA];
  resA.parent = branchA;
  sceneA.parent = branchA;

  const branchB = new TFolder("Project/BranchB");
  const resB = new TFolder("Project/BranchB/Research");
  const bibB = new TFile("Project/BranchB/Research/refsB.bib", `@article{turing1936, author={Turing, Alan}, title={Computable Numbers}, year={1936}}`);
  bibB.extension = "bib";
  bibB.stat = { mtime: 1000, size: bibB.content.length };
  resB.children = [bibB];
  bibB.parent = resB;
  const sceneB = new TFile("Project/BranchB/SceneB.md", "Scene B citing [@turing1936].");
  sceneB.extension = "md";
  sceneB.stat = { mtime: 1000, size: sceneB.content.length };
  branchB.children = [resB, sceneB];
  resB.parent = branchB;
  sceneB.parent = branchB;

  project.children = [resFolder, branchA, branchB];
  resFolder.parent = project;
  branchA.parent = project;
  branchB.parent = project;

  const { vault } = createFakeVault([project, resFolder, sourcesFolder, branchA, resA, bibA, sceneA, branchB, resB, bibB, sceneB]);
  vault.cachedRead = vault.read;
  const settings = {
    projectFolder: "Project",
    projectMeta: {
      "Project": {
        researchFolderLinks: {
          "Project/_Research": resFolder.path,
          "Project/BranchA": resA.path,
          "Project/BranchB": resB.path,
        },
        folderWorkspaces: {
          "BranchA": { citekeyBibliographyPath: "refsA.bib" },
          "BranchB": { citekeyBibliographyPath: "refsB.bib" },
        },
      },
    },
  };

  const { app, plugin } = createMockAppAndPlugin(vault, settings, sceneA);
  // The Espace actually selected by the user is BranchA — this, not the
  // active file, is what must drive the displayed references.
  plugin.getWorkspaceFolder = () => branchA;
  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);

  // Initial open with sceneA active
  await view.onOpen();
  assert.ok(contentEl.textContent.includes("Knuth, Donald"), "First render displays Knuth from BranchA's scope");
  assert.ok(!contentEl.textContent.includes("Turing, Alan"), "First render does not display Turing");

  // Change ONLY the active file to sceneB (BranchB's document) and trigger a
  // real file-open event — the Espace (BranchA) itself never changes.
  app.workspace.setActiveFile(sceneB);
  app.workspace.trigger("file-open", sceneB);

  // Wait for the 150ms debounce to fire
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.ok(contentEl.textContent.includes("Knuth, Donald"), "After the debounce, the active file change alone never changes the displayed references");
  assert.ok(!contentEl.textContent.includes("Turing, Alan"), "Turing must not appear merely because BranchB's file became active");

  // A genuine scope change — the user actually switching Espace to BranchB —
  // must, by contrast, update what is displayed.
  plugin.getWorkspaceFolder = () => branchB;
  await view.render(true);

  assert.ok(contentEl.textContent.includes("Turing, Alan"), "Switching the Espace itself to BranchB now displays Turing");
  assert.ok(!contentEl.textContent.includes("Knuth, Donald"), "BranchA's reference no longer appears once the Espace has changed");
});

test("ResearchView: content modification updates occurrences and unknown citekeys via modify event", async () => {
  const project = new TFolder("Project");
  const resFolder = new TFolder("Project/_Research");
  const sourcesFolder = new TFolder("Project/_Research/Sources");
  const bibFile = new TFile("Project/_Research/refs.bib", `@article{knuth1968, author={Knuth, Donald}, title={Algorithms}, year={1968}}`);
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 1000, size: bibFile.content.length };
  resFolder.children = [sourcesFolder, bibFile];
  sourcesFolder.parent = resFolder;
  bibFile.parent = resFolder;

  const scene = new TFile("Project/Scene.md", "Discussion [@knuth1968] and [@unknownKey].");
  scene.extension = "md";
  scene.stat = { mtime: 1000, size: scene.content.length };

  project.children = [resFolder, scene];
  resFolder.parent = project;
  scene.parent = project;

  const { vault } = createFakeVault([project, resFolder, sourcesFolder, bibFile, scene]);
  vault.cachedRead = vault.read;
  const settings = {
    projectFolder: "Project",
    projectMeta: {
      "Project": {
        researchFolderLinks: {
          "Project": resFolder.path,
        },
        citekeyBibliographyPath: "refs.bib",
      },
    },
  };

  const { app, plugin } = createMockAppAndPlugin(vault, settings, scene);
  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);

  await view.onOpen();

  const initialKnown = contentEl.find(".feuillets-bibtex-citation-item");
  assert.ok(initialKnown);
  assert.match(initialKnown.textContent, /1 citation/);
  const initialUnknown = contentEl.find(".feuillets-bibtex-unknown-item");
  assert.ok(initialUnknown);
  assert.match(initialUnknown.textContent, /@unknownKey/);
  assert.match(initialUnknown.textContent, /1 citation/);
  assert.ok(!contentEl.textContent.includes("@secondUnknown"));

  // Modify content and mtime of scene
  scene.content = "Discussion [@knuth1968] again [@knuth1968] and [@unknownKey] twice [@unknownKey] plus [@secondUnknown].";
  scene.stat = { mtime: 2000, size: scene.content.length };

  // Trigger real vault modify event
  app.vault.trigger("modify", scene);

  // Before debounce completes
  const intermediateKnown = contentEl.find(".feuillets-bibtex-citation-item");
  assert.match(intermediateKnown.textContent, /1 citation/, "Before debounce timeout, display has not changed yet");

  // Wait for 150ms debounce
  await new Promise((resolve) => setTimeout(resolve, 200));

  const updatedKnown = contentEl.find(".feuillets-bibtex-citation-item");
  assert.ok(updatedKnown);
  assert.match(updatedKnown.textContent, /2 citations/, "Occurrences updated to 2 citations");

  const unknownItems = contentEl.findAll(".feuillets-bibtex-unknown-item");
  assert.equal(unknownItems.length, 2, "Two unknown citekey items displayed");
  const unknown1 = unknownItems.find((el) => el.textContent.includes("@unknownKey"));
  assert.ok(unknown1);
  assert.match(unknown1.textContent, /2 citations/, "unknownKey occurrences updated to 2 citations");
  const unknown2 = unknownItems.find((el) => el.textContent.includes("@secondUnknown"));
  assert.ok(unknown2);
  assert.match(unknown2.textContent, /1 citation/, "New unknownKey secondUnknown displayed with 1 citation");
});

test("ResearchView: no refresh occurs after view closure", async () => {
  const project = new TFolder("Project");
  const research = new TFolder("Project/Research");
  const mdFile = new TFile("Project/Scene.md", "content");
  mdFile.extension = "md";
  const bibFile = new TFile("Project/refs.bib", "@article{k, author={K}, year={2020}}");
  bibFile.extension = "bib";

  project.children = [research, mdFile, bibFile];
  research.parent = project;
  mdFile.parent = project;
  bibFile.parent = project;

  const { vault } = createFakeVault([project, research, mdFile, bibFile]);
  const settings = { projectFolder: "Project", projectMeta: { Project: {} } };
  const { app, plugin } = createMockAppAndPlugin(vault, settings, mdFile);

  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);

  let renderCount = 0;
  const originalRender = view.render.bind(view);
  view.render = async (force) => {
    renderCount++;
    return originalRender(force);
  };

  await view.onOpen();
  assert.equal(renderCount, 1, "Initial render on onOpen()");

  // Close the view
  await view.onClose();
  assert.equal(view._isClosed, true, "View is marked as closed");
  assert.equal(view._bibliographyListenersSetup, false, "Setup flag is reset on close");
  assert.equal(view._bibliographyDebounceTimer, null, "Debounce timer is null after close");

  // Trigger all lifecycle events
  app.workspace.trigger("file-open", mdFile);
  app.workspace.trigger("active-leaf-change");
  app.workspace.trigger("editor-change");
  app.vault.trigger("modify", mdFile);
  app.vault.trigger("modify", bibFile);

  // Wait for 150ms debounce period
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(renderCount, 1, "No render call occurs after view is closed");
  assert.equal(view._bibliographyDebounceTimer, null, "Debounce timer remains null");
});

test("BaseFeuilletsView: subclasses other than ResearchView do not register bibliography lifecycle listeners", async () => {
  class OtherFeuilletsView extends BaseFeuilletsView {
    getViewType() {
      return "other";
    }
    getDisplayText() {
      return "Other";
    }
    getIcon() {
      return "file";
    }
    async render() {}
  }

  const project = new TFolder("Project");
  const { vault } = createFakeVault([project]);
  const settings = { projectFolder: "Project", projectMeta: { Project: {} } };
  const { app, plugin, registeredEvents } = createMockAppAndPlugin(vault, settings);

  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const otherView = new OtherFeuilletsView(leaf, plugin);

  // Subclasses of BaseFeuilletsView must not have bibliography listeners or properties
  assert.equal(typeof otherView.setupBibliographyLifecycleListeners, "undefined", "setupBibliographyLifecycleListeners must not exist on other views");
  assert.equal(typeof otherView._bibliographyListenersSetup, "undefined", "_bibliographyListenersSetup must not exist on other views");
  assert.equal(typeof otherView._bibliographyDebounceTimer, "undefined", "_bibliographyDebounceTimer must not exist on other views");
  assert.equal(typeof otherView._isClosed, "undefined", "_isClosed must not exist on other views");

  // Instantiating and invoking lifecycle methods must register 0 events
  if (typeof otherView.onload === "function") {
    otherView.onload();
  }
  assert.equal(registeredEvents.length, 0, "No bibliography listeners registered by non-ResearchView subclass");
});

test("ResearchView: multiple opens and renders do not duplicate listeners", async () => {
  const project = new TFolder("Project");
  const { vault } = createFakeVault([project]);
  const settings = { projectFolder: "Project", projectMeta: { Project: {} } };
  const { app, plugin, registeredEvents } = createMockAppAndPlugin(vault, settings);

  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);

  await view.onOpen();
  const initialListenerCount = registeredEvents.length;
  assert.ok(initialListenerCount >= 4, "Registers active-leaf-change, file-open, editor-change, and modify");

  // Call onOpen() again
  await view.onOpen();
  assert.equal(registeredEvents.length, initialListenerCount, "Repeated onOpen() must not add listeners");

  // Call render() multiple times
  for (let i = 0; i < 5; i++) {
    await view.render(true);
  }
  assert.equal(registeredEvents.length, initialListenerCount, "Repeated render() must not duplicate listeners");

  // Call setupBibliographyLifecycleListeners() directly
  view.setupBibliographyLifecycleListeners();
  assert.equal(registeredEvents.length, initialListenerCount, "setupBibliographyLifecycleListeners() guard prevents duplication");
});

test("generateBibliographyFile(): writes real Bibliographie.md from an explicit snapshot, combining Source entries and BibTeX entries with no scope resolution of its own", async () => {
  const project = new TFolder("Project");
  const output = new TFolder("Project/_Sortie");
  const sourcesFolder = new TFolder("Project/Sources");
  const sourceCard = new TFile("Project/Sources/Turing.md", "");
  sourceCard.extension = "md";
  sourceCard.frontmatter = { author: "Turing, Alan", title: "Computing Machinery and Intelligence", date: "1950" };
  sourceCard.basename = "Turing 1950";
  sourcesFolder.children = [sourceCard];
  sourceCard.parent = sourcesFolder;

  project.children = [output, sourcesFolder];
  output.parent = project;
  sourcesFolder.parent = project;

  const { vault } = createFakeVault([project, output, sourcesFolder, sourceCard]);
  const settings = { projectFolder: "Project", projectMeta: { Project: {} } };

  const { plugin } = createMockAppAndPlugin(vault, settings);
  plugin.generateBibliographyFile = FeuilletsPlugin.prototype.generateBibliographyFile;

  // Built exactly like renderBibliographySection's snapshot — no active file,
  // no re-resolution: the generator trusts this input as-is. An unknown
  // citekey is never part of bibtexEntries by contract (it only ever
  // reaches unknownKeys, which the caller never forwards here), so
  // "excludes unknown keys" is exercised by simply never including one.
  const input = {
    projectRoot: project,
    sourceFiles: [sourceCard],
    bibtexEntries: [{
      author: "Knuth, Donald",
      title: "Fundamental Algorithms",
      date: "1968",
      citekey: "knuth1968",
      bibliographyFilePath: "Project/refs.bib",
    }],
  };

  await plugin.generateBibliographyFile(input);

  const generatedFile = vault.getAbstractFileByPath("Project/_Sortie/Bibliographie.md");
  assert.ok(generatedFile instanceof TFile, "Bibliographie.md must be generated on disk");

  const content = await vault.read(generatedFile);
  assert.match(content, /# Bibliographie/);
  // Source entry included
  assert.match(content, /Turing, Alan/);
  assert.match(content, /Computing Machinery and Intelligence/);
  // BibTeX entry included
  assert.match(content, /Knuth, Donald/);
  assert.match(content, /Fundamental Algorithms/);
});

test("generateBibliographyFile(): replaces an existing Bibliographie.md instead of duplicating it", async () => {
  const project = new TFolder("Project");
  const output = new TFolder("Project/_Sortie");
  const existing = new TFile("Project/_Sortie/Bibliographie.md", "# Bibliographie\n\nStale content.\n");
  output.children = [existing];
  existing.parent = output;
  project.children = [output];
  output.parent = project;

  const { vault } = createFakeVault([project, output, existing]);
  const settings = { projectFolder: "Project", projectMeta: { Project: {} } };
  const { plugin } = createMockAppAndPlugin(vault, settings);
  plugin.generateBibliographyFile = FeuilletsPlugin.prototype.generateBibliographyFile;

  const input = {
    projectRoot: project,
    sourceFiles: [],
    bibtexEntries: [{ author: "Fresh, Faye", title: "Fresh Work", date: "2024", citekey: "fresh2024", bibliographyFilePath: "Project/refs.bib" }],
  };
  await plugin.generateBibliographyFile(input);

  const files = vault.getFiles().filter((f) => f.path === "Project/_Sortie/Bibliographie.md");
  assert.equal(files.length, 1, "no duplicate file is created");
  const content = await vault.read(files[0]);
  assert.match(content, /Fresh, Faye/);
  assert.doesNotMatch(content, /Stale content/);
});

test("generateBibliographyFile(): an empty snapshot keeps the existing empty-state notice behavior", async () => {
  const project = new TFolder("Project");
  const { vault } = createFakeVault([project]);
  const settings = { projectFolder: "Project", projectMeta: { Project: {} } };
  const { plugin } = createMockAppAndPlugin(vault, settings);
  plugin.generateBibliographyFile = FeuilletsPlugin.prototype.generateBibliographyFile;

  const notices = [];
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    const input = { projectRoot: project, sourceFiles: [], bibtexEntries: [] };
    await plugin.generateBibliographyFile(input);
  } finally {
    Notice.onCreate = previousOnCreate;
  }

  assert.equal(vault.getAbstractFileByPath("Project/_Sortie/Bibliographie.md"), null, "nothing is written when there is nothing to generate");
  assert.ok(notices.some((m) => /Aucune source citée|No source cited/.test(m)), "the existing empty-state notice is still shown");
});
