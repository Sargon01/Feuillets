import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder, Notice } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { ResearchView } from "../src/views/research-view.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { saveCitationRegistry } from "../src/services/citation-registry.js";
import { t } from "../src/i18n/index.js";

/* Generating Bibliographie.md must write exactly what the Research view
   currently displays for the resolved document scope — the click handler
   is wired to a snapshot already produced by renderBibliographySection(),
   never to a second, independent resolution. See
   generateBibliographyFile()'s new signature (src/main.ts) and
   ResearchBibliographyGenerationInput (services/bibliography-generator.ts). */

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
    this.attrs = new Map();
    this.value = options.value ?? "";
    this.tag = options.tag || "div";
    if (options.cls) this.addClass(options.cls);
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

  createDiv(options = {}) {
    const child = new FakeElement(options);
    child.tag = "div";
    this.children.push(child);
    return child;
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
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

  findAll(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    const results = [];
    for (const child of this.children) {
      if (className && child.classes.has(className)) results.push(child);
      results.push(...child.findAll(selector));
    }
    return results;
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

  setAttr(name, value) {
    this.attrs.set(name, value);
    return this;
  }

  empty() {
    this.children = [];
    this.text = "";
    return this;
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
  const attachmentPdf = new TFile("PROJECT/Work-A/Attachment.pdf", "%PDF-1.4 binary content");
  const sceneAExtra = new TFile("PROJECT/Work-A-Extra/Scene-Extra.md", "Extra citing [@onlyExtra2022].");
  const sceneB = new TFile("PROJECT/Work-B/Scene-B.md", "Body B citing [@sharedKey2020] and [@onlyB2023].");

  for (const file of [sceneA, sceneASub, sceneAExtra, sceneB]) {
    file.stat = { mtime: 1000, size: file.content.length };
    file.extension = "md";
  }
  attachmentPdf.stat = { mtime: 1000, size: attachmentPdf.content.length };
  attachmentPdf.extension = "pdf";

  const researchRoot = new TFolder("PROJECT/RESEARCH");
  const sourcesFolder = new TFolder("PROJECT/RESEARCH/Sources");
  const projectNote = new TFile("PROJECT/RESEARCH/Sources/ProjectNote.md", "");
  projectNote.extension = "md";
  projectNote.frontmatter = { author: "Project Author" };
  projectNote.basename = "ProjectNote";

  const refsBib = new TFile(
    "PROJECT/RESEARCH/refs.bib",
    `@article{sharedKey2020, author = {Shared, Sam}, title = {Shared Work}, year = {2020}}
@article{onlyA2021, author = {Alpha, Ann}, title = {Alpha Work}, year = {2021}}
@article{onlyB2023, author = {Beta, Bob}, title = {Beta Work}, year = {2023}}
@article{subKey2020, author = {Sub, Sue}, title = {Sub Work}, year = {2020}}
@article{onlyExtra2022, author = {Extra, Eve}, title = {Extra Work}, year = {2022}}`
  );
  refsBib.extension = "bib";
  refsBib.stat = { mtime: 1000, size: refsBib.content.length };

  const workAResearch = new TFolder("PROJECT/Work-A-Research");
  const workASourcesFolder = new TFolder("PROJECT/Work-A-Research/Sources");
  const workANote = new TFile("PROJECT/Work-A-Research/Sources/WorkANote.md", "");
  workANote.extension = "md";
  workANote.frontmatter = { author: "Workspace Author" };
  workANote.basename = "WorkANote";

  const output = new TFolder("PROJECT/_Sortie");

  // A genuine file outside the project entirely — a separate vault root.
  const outsideRoot = new TFolder("OUTSIDE");
  const outsideFile = new TFile("OUTSIDE/Outside.md", "Citing [@outsideKey2099], never part of the project.");
  outsideFile.extension = "md";
  outsideFile.stat = { mtime: 1000, size: outsideFile.content.length };
  outsideFile.parent = outsideRoot;
  outsideRoot.children = [outsideFile];

  projectRoot.children = [workA, workAExtra, workB, researchRoot, workAResearch, output];
  workA.parent = projectRoot;
  workAExtra.parent = projectRoot;
  workB.parent = projectRoot;
  researchRoot.parent = projectRoot;
  workAResearch.parent = projectRoot;
  output.parent = projectRoot;

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
    workAResearch, workASourcesFolder, workANote, output,
    sceneA, sceneASub, sceneAExtra, sceneB, attachmentPdf,
    outsideRoot, outsideFile,
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
    workAResearch, workASourcesFolder, workANote, output,
    sceneA, sceneASub, sceneAExtra, sceneB, attachmentPdf,
    outsideRoot, outsideFile,
  };
}

async function seedCitationRegistry(fixture, occurrences) {
  const app = { vault: fixture.vault };
  const registry = {
    version: 1,
    citations: occurrences.map((o, i) => ({
      id: `occ-${i}`,
      file: o.file,
      sourcePath: o.sourcePath,
      start: 0, end: 1, quote: "", prefix: "", suffix: "",
    })),
  };
  await saveCitationRegistry(app, fixture.settings, registry);
}

/** Builds a view harness whose plugin/app surface is fully instrumented:
 * cachedRead/read/getActiveFile call counts, and a captured promise for the
 * Generate button's click handler so tests can await the real completion
 * of generateBibliographyFile() instead of guessing with setTimeout(0). */
function createView(fixture, { workspace = null, scopeMode = "workspace", activeFile = null } = {}) {
  const contentEl = new FakeElement();
  let currentActiveFile = activeFile;
  const counts = { getActiveFile: 0, cachedRead: 0, read: 0 };
  const app = {
    vault: {
      ...fixture.vault,
      cachedRead: async (file) => {
        counts.cachedRead += 1;
        return fixture.vault.cachedRead(file);
      },
      read: async (file) => {
        counts.read += 1;
        return fixture.vault.read(file);
      },
    },
    workspace: {
      getActiveFile: () => {
        counts.getActiveFile += 1;
        return currentActiveFile;
      },
    },
    metadataCache: { getFileCache: (file) => ({ frontmatter: file.frontmatter || {} }) },
    fileManager: {},
  };

  let pendingGenerate = null;
  const realGenerate = FeuilletsPlugin.prototype.generateBibliographyFile;
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
    generateBibliographyFile(input) {
      pendingGenerate = realGenerate.call(this, input);
      return pendingGenerate;
    },
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

  return {
    view, contentEl, app, counts,
    setActiveFile: (file) => { currentActiveFile = file; },
    /** Dispatches the Generate button's click and awaits the exact promise
     * returned by generateBibliographyFile() — no arbitrary timers. */
    clickGenerateAndWait: async () => {
      const button = contentEl.find(".feuillets-bibliography-export-row");
      assert.ok(button, "the Generate button must be rendered");
      pendingGenerate = null;
      button.dispatchEvent("click");
      assert.ok(pendingGenerate, "clicking Generate must invoke generateBibliographyFile()");
      await pendingGenerate;
    },
  };
}

async function withDocument(fn) {
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    return await fn();
  } finally {
    globalThis.document = prevDoc;
  }
}

async function renderAndClickGenerate(fixture, options) {
  const harness = createView(fixture, options);
  await withDocument(() => harness.view.render(true));
  await harness.clickGenerateAndWait();
  return harness;
}

/** Always reads through the fixture's own vault, independent of any
 * instrumented/spied app.vault used by a harness, so this assertion read
 * is never confused with a read performed by the generator itself. */
async function generatedContent(fixture) {
  const file = fixture.vault.getAbstractFileByPath(`${fixture.projectRoot.path}/_Sortie/Bibliographie.md`);
  if (!file) return null;
  return fixture.vault.read(file);
}

/* --- Document-scope coverage --- */

test("Project mode generates the references cited across the whole project", async () => {
  const fixture = makeFixture();
  await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Shared, Sam/);
  assert.match(content, /Alpha, Ann/);
  assert.match(content, /Beta, Bob/);
  assert.match(content, /Sub, Sue/);
});

test("Workspace mode generates only the references cited inside that space", async () => {
  const fixture = makeFixture();
  await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Shared, Sam/);
  assert.match(content, /Alpha, Ann/);
  assert.doesNotMatch(content, /Beta, Bob/);
});

test("a sibling space is excluded from the generated file", async () => {
  const fixture = makeFixture();
  await renderAndClickGenerate(fixture, { workspace: fixture.workB, scopeMode: "workspace" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Beta, Bob/);
  assert.doesNotMatch(content, /Alpha, Ann/);
});

test("a subfolder of the space is included in the generated file", async () => {
  const fixture = makeFixture();
  await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const content = await generatedContent(fixture);
  assert.match(content, /Sub, Sue/, "Scene-A-Sub.md's citekey is nested but still inside Work-A");
});

test("Work-A and Work-A-Extra are two distinct scope boundaries, proven in both directions", async () => {
  const workAFixture = makeFixture();
  await renderAndClickGenerate(workAFixture, { workspace: workAFixture.workA, scopeMode: "workspace" });
  const workAContent = await generatedContent(workAFixture);
  assert.ok(workAContent);
  assert.match(workAContent, /Alpha, Ann/, "Work-A's own reference is generated");
  assert.doesNotMatch(workAContent, /Extra, Eve/, "Work-A-Extra's reference must never appear for Work-A");

  const extraFixture = makeFixture();
  await renderAndClickGenerate(extraFixture, { workspace: extraFixture.workAExtra, scopeMode: "workspace" });
  const extraContent = await generatedContent(extraFixture);
  assert.ok(extraContent);
  assert.match(extraContent, /Extra, Eve/, "Work-A-Extra's own reference is generated");
  assert.doesNotMatch(extraContent, /Alpha, Ann/, "Work-A's reference must never appear for Work-A-Extra");
  assert.doesNotMatch(extraContent, /Shared, Sam/, "no reference belonging to Work-A leaks into Work-A-Extra");
  assert.doesNotMatch(extraContent, /Sub, Sue/, "no reference belonging to Work-A leaks into Work-A-Extra");
});

test("a reference cited only outside the current scope is excluded from the generated file", async () => {
  const fixture = makeFixture();
  await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.doesNotMatch(content, /Beta, Bob/);
});

/* --- Source fiches --- */

test("a Source fiche cited in scope via the citation registry is generated", async () => {
  const fixture = makeFixture();
  await seedCitationRegistry(fixture, [{ file: "Work-A/Scene-A.md", sourcePath: fixture.workANote.path }]);
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;
  await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Workspace Author/);
});

test("a Source fiche cited only outside the scope is excluded from the generated file", async () => {
  const fixture = makeFixture();
  await seedCitationRegistry(fixture, [{ file: "Work-B/Scene-B.md", sourcePath: fixture.workANote.path }]);
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;
  await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const content = await generatedContent(fixture);
  // Work-A still generates real content from its own citekeys (sharedKey2020,
  // onlyA2021) — only the Source fiche cited exclusively from Work-B must be absent.
  assert.ok(content);
  assert.doesNotMatch(content, /Workspace Author/, "workANote is only cited from Work-B, never from Work-A");
});

test("a stale or artificial cite_count value never affects the generated file", async () => {
  const fixture = makeFixture();
  fixture.projectNote.frontmatter.cite_count = 42;
  await seedCitationRegistry(fixture, [{ file: "Work-A/Scene-A.md", sourcePath: fixture.projectNote.path }]);
  await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Project Author/);
  assert.doesNotMatch(content, /42/);
});

test("a Source fiche with cite_count > 0 but no occurrence in scope is excluded from the generated file", async () => {
  const fixture = makeFixture();
  fixture.projectNote.frontmatter.cite_count = 5;
  // No registry occurrence seeded at all for projectNote.
  await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
  const content = await generatedContent(fixture);
  // The project's real citekeys still generate content — only the stale
  // cite_count-only fiche must be absent.
  assert.ok(content);
  assert.doesNotMatch(content, /Project Author/, "cite_count alone, with no registry occurrence, must never mark a fiche as cited");
});

/* --- BibTeX --- */

test("citekeys of the scope are generated with their resolved BibTeX entry", async () => {
  const fixture = makeFixture();
  await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/);
  assert.match(content, /Alpha Work/);
});

test("a .bib defined at the project level is still inherited in Workspace mode", async () => {
  const fixture = makeFixture();
  // citekeyBibliographyPath is only configured at the project level.
  await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/, "onlyA2021 resolves via the inherited project-level refs.bib");
});

test("an unknown citekey stays a visible warning in the view but is never written to Bibliographie.md", async () => {
  const fixture = makeFixture();
  const harness = await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const unknownWarning = harness.contentEl.findAll(".feuillets-bibtex-unknown-item").find(
    (el) => el.textContent.includes("unknownInScope2024")
  );
  assert.ok(unknownWarning, "the unknown citekey is displayed as a warning in the view");

  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.doesNotMatch(content, /unknownInScope2024/, "the unknown citekey is never written as a fake entry");
});

test("generation works without any Sources folder, using only BibTeX citations", async () => {
  const projectRoot = new TFolder("SOLO");
  const researchRoot = new TFolder("SOLO/RESEARCH");
  const bibFile = new TFile("SOLO/RESEARCH/refs.bib", `@article{lonelyKey, author = {Lonely, Lou}, title = {Lonely Work}, year = {2019}}`);
  bibFile.extension = "bib";
  bibFile.stat = { mtime: 1000, size: bibFile.content.length };
  const scene = new TFile("SOLO/Scene.md", "Citing [@lonelyKey].");
  scene.extension = "md";
  scene.stat = { mtime: 1000, size: scene.content.length };
  const output = new TFolder("SOLO/_Sortie");

  projectRoot.children = [researchRoot, scene, output];
  researchRoot.parent = projectRoot;
  scene.parent = projectRoot;
  output.parent = projectRoot;
  researchRoot.children = [bibFile];
  bibFile.parent = researchRoot;

  const { vault } = createFakeVault([projectRoot, researchRoot, bibFile, scene, output]);
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
  const fixture = { vault, settings, projectRoot, researchRoot };
  await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Lonely, Lou/);
});

/* --- Stability across every kind of active-file change --- */

test("switching the active file to a Research fiche never changes what is generated", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace", activeFile: fixture.sceneA });
  await withDocument(() => harness.view.render(true));

  harness.setActiveFile(fixture.projectNote); // a genuine Research fiche
  await harness.clickGenerateAndWait();

  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/);
  assert.doesNotMatch(content, /Beta, Bob/);
  assert.doesNotMatch(content, /Extra, Eve/);
});

test("switching the active file to a PDF never changes what is generated", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace", activeFile: fixture.sceneA });
  await withDocument(() => harness.view.render(true));

  assert.equal(fixture.attachmentPdf.extension, "pdf");
  harness.setActiveFile(fixture.attachmentPdf);
  await harness.clickGenerateAndWait();

  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/);
  assert.doesNotMatch(content, /Beta, Bob/);
  assert.doesNotMatch(content, /Extra, Eve/);
});

test("switching the active file to a sibling space's file never changes what is generated", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace", activeFile: fixture.sceneA });
  await withDocument(() => harness.view.render(true));

  harness.setActiveFile(fixture.sceneB); // Work-B's own Markdown file
  await harness.clickGenerateAndWait();

  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/);
  assert.doesNotMatch(content, /Beta, Bob/, "Work-B's reference must never leak in from the active file alone");
  assert.doesNotMatch(content, /Extra, Eve/);
});

test("switching the active file to a file outside the project never changes what is generated", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace", activeFile: fixture.sceneA });
  await withDocument(() => harness.view.render(true));

  harness.setActiveFile(fixture.outsideFile); // a real file outside PROJECT entirely
  await harness.clickGenerateAndWait();

  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/);
  assert.doesNotMatch(content, /outsideKey2099/, "a citekey from a file outside the project must never appear");
  assert.doesNotMatch(content, /Beta, Bob/);
  assert.doesNotMatch(content, /Extra, Eve/);
});

test("the associatedWorkspaceFolder branch also wires the button to the correct context", async () => {
  const fixture = makeFixture();
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;
  await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/);
  assert.doesNotMatch(content, /Beta, Bob/);
});

/* --- No recomputation triggered by the click --- */

test("clicking Generate triggers no additional scan: no getActiveFile(), no cachedRead(), no read()", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  await withDocument(() => harness.view.render(true));

  const countsAfterRender = { ...harness.counts };
  await harness.clickGenerateAndWait();

  assert.equal(harness.counts.cachedRead, countsAfterRender.cachedRead, "no new cachedRead() call during the click");
  assert.equal(harness.counts.read, countsAfterRender.read, "no new read() call during the click — this would catch a regression bypassing cachedRead");
  assert.equal(harness.counts.getActiveFile, countsAfterRender.getActiveFile, "no new getActiveFile() call during the click");

  // The generated content is verified afterwards, through the fixture's own
  // vault — never through the instrumented app.vault above, so this
  // assertion read is never mistaken for a read performed by the generator.
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/);
});

test("generateBibliographyFile(input) never touches document-scope, workspace or content-scanning primitives", async () => {
  const fixture = makeFixture();
  const writes = new Map();

  // A hostile app surface: no `workspace` at all (any getActiveFile()-style
  // access throws immediately), and no cachedRead/read (any attempt to
  // re-scan a document or a .bib catalog — the sole reason
  // resolveResearchDocumentContext(), flattenFiles(),
  // analyzeResearchCitations(), collectScopeCitedBibtexEntries() or
  // collectDocumentScopeCitedBibtexEntries() would ever touch the vault —
  // throws immediately). Only the primitives generateBibliographyFile()
  // legitimately needs for combining and writing are present.
  const hostileApp = {
    vault: {
      getAbstractFileByPath: (path) => fixture.vault.getAbstractFileByPath(path),
      create: async (path, content) => { writes.set(path, content); return { path }; },
      modify: async (file, content) => { writes.set(file.path, content); },
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: file.frontmatter || {} }),
    },
  };
  const plugin = {
    app: hostileApp,
    settings: fixture.settings,
    generateBibliographyFile: FeuilletsPlugin.prototype.generateBibliographyFile,
  };

  const input = {
    projectRoot: fixture.projectRoot,
    sourceFiles: [fixture.projectNote],
    bibtexEntries: [{ author: "Alpha, Ann", title: "Alpha Work", date: "2021", citekey: "onlyA2021" }],
  };

  await plugin.generateBibliographyFile(input);

  const content = writes.get(`${fixture.projectRoot.path}/_Sortie/Bibliographie.md`);
  assert.ok(content, "the hostile environment did not prevent a correct write — no scan was ever attempted");
  assert.match(content, /Alpha, Ann/);
  assert.match(content, /Project Author/);
});

/* --- Empty scope --- */

test("a genuinely empty scope shows the exact empty-state text, keeps the Generate button, writes nothing, and still notices", async () => {
  const projectRoot = new TFolder("EMPTY");
  const researchRoot = new TFolder("EMPTY/RESEARCH");
  const sourcesFolder = new TFolder("EMPTY/RESEARCH/Sources");
  const uncitedNote = new TFile("EMPTY/RESEARCH/Sources/Uncited.md", "");
  uncitedNote.extension = "md";
  uncitedNote.frontmatter = { author: "Never Cited" };
  uncitedNote.basename = "Uncited";
  const scene = new TFile("EMPTY/Scene.md", "Plain prose, no citation at all.");
  scene.extension = "md";
  scene.stat = { mtime: 1000, size: scene.content.length };

  projectRoot.children = [researchRoot, scene];
  researchRoot.parent = projectRoot;
  scene.parent = projectRoot;
  researchRoot.children = [sourcesFolder];
  sourcesFolder.parent = researchRoot;
  sourcesFolder.children = [uncitedNote];
  uncitedNote.parent = sourcesFolder;

  const { vault } = createFakeVault([projectRoot, researchRoot, sourcesFolder, uncitedNote, scene]);
  vault.cachedRead = async (file) => file.content || "";
  const settings = {
    projectFolder: projectRoot.path,
    projectMeta: { [projectRoot.path]: { researchFolderLinks: { [projectRoot.path]: researchRoot.path } } },
    orders: {}, folderPositions: {}, collapsed: {}, researchSearch: "", researchTagFilter: "", researchOrder: {}, labels: [],
  };
  const fixture = { vault, settings, projectRoot, researchRoot };

  const notices = [];
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  let harness;
  try {
    harness = createView(fixture, { workspace: null, scopeMode: "project" });
    await withDocument(() => harness.view.render(true));

    const titles = harness.contentEl.findAll(".feuillets-notes-section-title").filter(
      (el) => el.text === t("shared.bibliography.title")
    );
    assert.equal(titles.length, 1, "exactly one Bibliography section");

    // The footnotes overview section also renders its own
    // ".feuillets-research-empty" message before Bibliography — match on
    // the exact expected wording, not just the first element of that class.
    const emptyEl = harness.contentEl.findAll(".feuillets-research-empty").find(
      (el) => el.text === t("shared.bibliography.empty")
    );
    assert.ok(emptyEl, "the Bibliography section's own empty-state element is rendered");

    const button = harness.contentEl.find(".feuillets-bibliography-export-row");
    assert.ok(button, "the Generate button remains present even for an empty scope");

    await harness.clickGenerateAndWait();
  } finally {
    Notice.onCreate = previousOnCreate;
  }

  const content = await generatedContent(fixture);
  assert.equal(content, null, "clicking Generate on an empty scope writes no Bibliographie.md");
  assert.ok(notices.some((m) => /Aucune source citée|No source cited/.test(m)), "the existing empty-state notice is still emitted");
});

test("the Bibliography section title is unique when generation is non-empty", async () => {
  const fixture = makeFixture();
  const harness = await renderAndClickGenerate(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const title = t("shared.bibliography.title");
  const titles = harness.contentEl.findAll(".feuillets-notes-section-title").filter((el) => el.text === title);
  assert.equal(titles.length, 1);
});
