import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { ResearchView } from "../src/views/research-view.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { saveCitationRegistry } from "../src/services/citation-registry.js";
import { createSourceAnchor } from "../src/services/source-anchor.js";
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

  const workBResearch = new TFolder("PROJECT/Work-B-Research");
  const workBSourcesFolder = new TFolder("PROJECT/Work-B-Research/Sources");
  const workBNote = new TFile("PROJECT/Work-B-Research/Sources/WorkBNote.md", "");
  workBNote.extension = "md";
  workBNote.frontmatter = { author: "Work-B Workspace Author" };
  workBNote.basename = "WorkBNote";

  const output = new TFolder("PROJECT/_Sortie");

  // A genuine file outside the project entirely — a separate vault root.
  const outsideRoot = new TFolder("OUTSIDE");
  const outsideFile = new TFile("OUTSIDE/Outside.md", "Citing [@outsideKey2099], never part of the project.");
  outsideFile.extension = "md";
  outsideFile.stat = { mtime: 1000, size: outsideFile.content.length };
  outsideFile.parent = outsideRoot;
  outsideRoot.children = [outsideFile];

  projectRoot.children = [workA, workAExtra, workB, researchRoot, workAResearch, workBResearch, output];
  workA.parent = projectRoot;
  workAExtra.parent = projectRoot;
  workB.parent = projectRoot;
  researchRoot.parent = projectRoot;
  workAResearch.parent = projectRoot;
  workBResearch.parent = projectRoot;
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

  workBResearch.children = [workBSourcesFolder];
  workBSourcesFolder.parent = workBResearch;
  workBSourcesFolder.children = [workBNote];
  workBNote.parent = workBSourcesFolder;

  const vaultEntries = [
    projectRoot, workA, workASub, workAExtra, workB,
    researchRoot, sourcesFolder, projectNote, refsBib,
    workAResearch, workASourcesFolder, workANote,
    workBResearch, workBSourcesFolder, workBNote, output,
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
    workAResearch, workASourcesFolder, workANote,
    workBResearch, workBSourcesFolder, workBNote, output,
    sceneA, sceneASub, sceneAExtra, sceneB, attachmentPdf,
    outsideRoot, outsideFile,
  };
}

/** Seeds a real citation registry, with a REAL anchor (createSourceAnchor())
 * over an actual fragment of the citing file's content — by default the
 * file's full content, or an explicit `quote`/`start` when a test needs to
 * exercise anchor-resolution semantics specifically. */
async function seedCitationRegistry(fixture, occurrences) {
  const app = { vault: fixture.vault };
  const registry = {
    version: 1,
    citations: occurrences.map((o, i) => {
      const citingFile = fixture.vault.getAbstractFileByPath(`${fixture.projectRoot.path}/${o.file}`);
      const content = citingFile?.content || "";
      const quote = o.quote ?? content;
      const start = o.start ?? content.indexOf(quote);
      const anchor = createSourceAnchor(content, start, start + quote.length);
      if (!anchor) {
        throw new Error(`seedCitationRegistry: no real anchor could be built for "${o.file}" (quote "${quote}" not found)`);
      }
      return { id: `occ-${i}`, file: o.file, sourcePath: o.sourcePath, ...anchor };
    }),
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
  view.researchActiveSubTab = "references";
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

/* --- Document-scope coverage ---

   The Generate row is available in BOTH Project and Workspace mode (see
   the "mode gating" block further below): writing always uses exactly the
   snapshot ("generationInput") already built by renderBibliographySection()
   for the scope currently displayed — Bibliographie.md stays the single
   project-wide output file either way (generateBibliographyFile() itself
   is unchanged), so a Workspace-mode click simply overwrites it with that
   Workspace's own scoped content. */

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

/* --- The registry is the sole authority — Source identity is never
   restricted to the Sources/Bibliographie folder currently visible --- */

test("Project mode generates Sources cited from Research folders linked to several different spaces", async () => {
  const fixture = makeFixture();
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workB.path] =
    fixture.workBResearch.path;
  await seedCitationRegistry(fixture, [
    { file: "Work-A/Scene-A.md", sourcePath: fixture.workANote.path },
    { file: "Work-B/Scene-B.md", sourcePath: fixture.workBNote.path },
  ]);
  await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Workspace Author/, "Work-A's linked-Research Source must be generated in Project mode");
  assert.match(content, /Work-B Workspace Author/, "Work-B's linked-Research Source must be generated in Project mode too");
});

test("a citation removed from the document is no longer generated", async () => {
  const fixture = makeFixture();
  await seedCitationRegistry(fixture, [
    { file: "Work-A/Scene-A.md", sourcePath: fixture.projectNote.path, quote: "sharedKey2020" },
  ]);
  fixture.sceneA.content = "Body A no longer cites anything of note.";
  fixture.sceneA.stat = { mtime: 2000, size: fixture.sceneA.content.length };

  await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
  const content = await generatedContent(fixture);
  // Scene-A-Sub.md (subKey2020) still generates real content for the
  // project — only the removed citation to projectNote must be absent.
  assert.ok(content);
  assert.match(content, /Sub, Sue/);
  assert.doesNotMatch(content, /Project Author/, "an occurrence whose anchor no longer resolves must not be generated");
});

test("the displayed Bibliography section and the generated file contain exactly the same Source fiches", async () => {
  const fixture = makeFixture();
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;
  await seedCitationRegistry(fixture, [
    { file: "Work-A/Scene-A.md", sourcePath: fixture.projectNote.path },
    { file: "Work-A/Sub/Scene-A-Sub.md", sourcePath: fixture.workANote.path },
  ]);

  const harness = await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
  const displayedNames = harness.contentEl.findAll(".feuillets-research-item-name")
    .map((el) => el.text)
    .filter((text) => /citation/.test(text));

  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.ok(displayedNames.some((t) => t.includes("ProjectNote")), "ProjectNote is displayed");
  assert.ok(displayedNames.some((t) => t.includes("WorkANote")), "WorkANote is displayed");
  assert.match(content, /Project Author/, "ProjectNote is generated, matching the displayed section");
  assert.match(content, /Workspace Author/, "WorkANote is generated, matching the displayed section");
});

/* --- BibTeX --- */

test("citekeys of the scope are generated with their resolved BibTeX entry", async () => {
  const fixture = makeFixture();
  await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/);
  assert.match(content, /Alpha Work/);
});

test("an unknown citekey stays a visible warning in the view but is never written to Bibliographie.md", async () => {
  const fixture = makeFixture();
  const harness = await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
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

test("switching the active file — a Research fiche, a PDF, a sibling space's file, or a file outside the project — never changes what is generated", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: null, scopeMode: "project", activeFile: fixture.sceneA });
  await withDocument(() => harness.view.render(true));

  await harness.clickGenerateAndWait();
  const baseline = await generatedContent(fixture);
  assert.ok(baseline);

  for (const candidate of [fixture.projectNote, fixture.attachmentPdf, fixture.sceneB, fixture.outsideFile]) {
    harness.setActiveFile(candidate);
    await harness.clickGenerateAndWait();
    assert.equal(await generatedContent(fixture), baseline, `switching the active file to ${candidate.path} must never change the generated content`);
  }
});

test("Workspace mode: switching the active file never changes what is generated for that space", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace", activeFile: fixture.sceneA });
  await withDocument(() => harness.view.render(true));

  await harness.clickGenerateAndWait();
  const baseline = await generatedContent(fixture);
  assert.ok(baseline);
  assert.match(baseline, /Alpha, Ann/);
  assert.doesNotMatch(baseline, /Beta, Bob/);

  for (const candidate of [fixture.projectNote, fixture.attachmentPdf, fixture.sceneB, fixture.outsideFile]) {
    harness.setActiveFile(candidate);
    await harness.clickGenerateAndWait();
    assert.equal(await generatedContent(fixture), baseline, `switching the active file to ${candidate.path} must never change what Work-A generates`);
  }
});

/* --- Mode gating (§1 of this correction): the Generate row is available
   in BOTH Project and Workspace mode as soon as the Bibliography section
   has at least one displayable entry — only the label names the scope.
   Bibliographie.md stays the single project-wide output file either way
   (generateBibliographyFile() itself is unchanged). --- */

test("the Generate row renders in Workspace mode too, once the space has a displayable Bibliography", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  await withDocument(() => harness.view.render(true));
  assert.ok(harness.contentEl.find(".feuillets-bibliography-export-row"));
});

test("the associatedWorkspaceFolder branch renders a Generate row too, scoped to that space", async () => {
  const fixture = makeFixture();
  fixture.settings.projectMeta[fixture.projectRoot.path].researchFolderLinks[fixture.workA.path] =
    fixture.workAResearch.path;
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  await withDocument(() => harness.view.render(true));
  assert.ok(harness.contentEl.find(".feuillets-bibliography-export-row"));
});

test("the Generate row's label is exactly \"Générer la bibliographie du projet\" in Project mode", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: null, scopeMode: "project" });
  await withDocument(() => harness.view.render(true));
  const button = harness.contentEl.find(".feuillets-bibliography-export-row");
  assert.ok(button);
  assert.equal(button.textContent.trim(), t("shared.bibliography.generateProject"));
  assert.equal(t("shared.bibliography.generateProject"), "Générer la bibliographie du projet");
});

test("the Generate row's label is exactly \"Générer la bibliographie de cet espace\" in Workspace mode", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  await withDocument(() => harness.view.render(true));
  const button = harness.contentEl.find(".feuillets-bibliography-export-row");
  assert.ok(button);
  assert.equal(button.textContent.trim(), t("shared.bibliography.generateWorkspace"));
  assert.equal(t("shared.bibliography.generateWorkspace"), "Générer la bibliographie de cet espace");
});

test("clicking Generate in Workspace mode triggers no additional scan either", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  await withDocument(() => harness.view.render(true));

  const countsAfterRender = { ...harness.counts };
  await harness.clickGenerateAndWait();

  assert.equal(harness.counts.cachedRead, countsAfterRender.cachedRead);
  assert.equal(harness.counts.read, countsAfterRender.read);
  assert.equal(harness.counts.getActiveFile, countsAfterRender.getActiveFile);

  const content = await generatedContent(fixture);
  assert.ok(content);
  assert.match(content, /Alpha, Ann/);
  assert.doesNotMatch(content, /Beta, Bob/);
});

/* --- No recomputation triggered by the click --- */

test("clicking Generate triggers no additional scan: no getActiveFile(), no cachedRead(), no read()", async () => {
  const fixture = makeFixture();
  const harness = createView(fixture, { workspace: null, scopeMode: "project" });
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

test("a genuinely empty scope renders no Bibliography section at all — no header, no Generate row", async () => {
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

  const harness = createView(fixture, { workspace: null, scopeMode: "project" });
  harness.view.researchActiveSubTab = "references";
  await withDocument(() => harness.view.render(true));

  // An empty Bibliography is never rendered at all: no header, no permanent
  // Bibliography-specific empty message and no Generate row.
  const titles = harness.contentEl.findAll(".feuillets-notes-section-title").filter(
    (el) => el.text === t("shared.bibliography.title")
  );
  assert.equal(titles.length, 0, "no Bibliography section at all");
  assert.equal(harness.contentEl.find(".feuillets-bibliography-export-row"), null);
  const staleEmptyMessage = harness.contentEl.findAll(".feuillets-research-empty").find(
    (el) => el.text === t("shared.bibliography.empty")
  );
  assert.equal(staleEmptyMessage, undefined);

  assert.ok(
    harness.contentEl.findAll(".feuillets-references-empty").some(
      (el) => el.text === t("shared.research.noReferencesInScope")
    ),
    "References uses one compact tab-wide empty state"
  );

  assert.equal(await generatedContent(fixture), null, "nothing was ever generated for this scope");
});

test("the Bibliography section title is unique when generation is non-empty", async () => {
  const fixture = makeFixture();
  const harness = await renderAndClickGenerate(fixture, { workspace: null, scopeMode: "project" });
  const title = t("shared.bibliography.title");
  const titles = harness.contentEl.findAll(".feuillets-notes-section-title").filter((el) => el.text === title);
  assert.equal(titles.length, 1);
});
