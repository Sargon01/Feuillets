import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ResearchView } from "../src/views/research-view.js";
import { footnoteGroupCollapseKey } from "../src/services/research-footnotes-overview.js";
import { t } from "../src/i18n/index.js";

/* Project mode's footnotes overview follows the REAL folder hierarchy under
   documentContext.projectRoot — not a single top-level segment — and every
   node's collapse state lives under a namespaced key
   (footnoteGroupCollapseKey()), never a raw vault path, so it can never
   collide with the Binder's own use of that same path as its own collapse
   key. Workspace mode keeps the historical flat, per-file listing.
   See services/research-footnotes-overview.ts. */

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

  addEventListener(type, callback) {
    this.events ||= new Map();
    this.events.set(type, callback);
  }

  dispatchClick() {
    this.events?.get("click")?.();
  }

  focus() {}
  setSelectionRange() {}

  contains() {
    return false;
  }
}

function makeFixture() {
  const projectRoot = new TFolder("PROJECT");

  const articleTest = new TFolder("PROJECT/ARTICLE TEST");
  const article = new TFile("PROJECT/ARTICLE TEST/Article.md", "Body[^x1]\n\n[^x1]: Article footnote");
  articleTest.children = [article];
  article.parent = articleTest;

  const soy = new TFolder("PROJECT/SOY");
  const soySub = new TFolder("PROJECT/SOY/Sub");
  // A real orphan: [^orphan] is defined but never referenced anywhere in
  // the body — distinct from [^y2], which is referenced but never defined.
  const deliler = new TFile(
    "PROJECT/SOY/Deliler.md",
    "Body citing [^y2]\n\n[^orphan]: Definition never referenced"
  );
  const detail = new TFile("PROJECT/SOY/Sub/Detail.md", "Nested[^y3]\n\n[^y3]: Detail footnote");
  soy.children = [soySub, deliler];
  soySub.parent = soy;
  deliler.parent = soy;
  soySub.children = [detail];
  detail.parent = soySub;

  const warpi = new TFolder("PROJECT/WARPI");
  const warpiSub = new TFolder("PROJECT/WARPI/Sub");
  const chapter1 = new TFile(
    "PROJECT/WARPI/Chapter1.md",
    "Body[^w1] and [^w2]\n\n[^w1]: Chapter 1 footnote one\n[^w2]: Chapter 1 footnote two"
  );
  const chapter2 = new TFile("PROJECT/WARPI/Chapter2.md", "Body[^w3]\n\n[^w3]: Chapter 2 footnote");
  const warpiNote = new TFile("PROJECT/WARPI/Sub/Note.md", "Body[^w4]\n\n[^w4]: WARPI Sub footnote");
  warpi.children = [chapter1, chapter2, warpiSub];
  chapter1.parent = warpi;
  chapter2.parent = warpi;
  warpiSub.parent = warpi;
  warpiSub.children = [warpiNote];
  warpiNote.parent = warpiSub;

  const emptyTopic = new TFolder("PROJECT/EMPTY-TOPIC");
  const noFootnotes = new TFile("PROJECT/EMPTY-TOPIC/NoFootnotes.md", "Nothing to see here.");
  emptyTopic.children = [noFootnotes];
  noFootnotes.parent = emptyTopic;

  const introduction = new TFile("PROJECT/Introduction.md", "Root[^r1]\n\n[^r1]: Root footnote");
  const rootAttachment = new TFile("PROJECT/Attachment.pdf", "PDF citing [^should-never-appear]");
  rootAttachment.extension = "pdf";

  // Work-A/Deep/Nested is a genuine three-level subfolder chain — and
  // Work-A/Scene.md shares its exact filename with Work-A-Extra/Scene.md,
  // a homonym across two different branches.
  const workA = new TFolder("PROJECT/Work-A");
  const workAScene = new TFile("PROJECT/Work-A/Scene.md", "A[^wa1]\n\n[^wa1]: Work-A footnote");
  const workADeep = new TFolder("PROJECT/Work-A/Deep");
  const workANested = new TFolder("PROJECT/Work-A/Deep/Nested");
  const workAVeryDeep = new TFile("PROJECT/Work-A/Deep/Nested/VeryDeep.md", "Deep[^wad1]\n\n[^wad1]: Very deep footnote");
  workA.children = [workAScene, workADeep];
  workAScene.parent = workA;
  workADeep.parent = workA;
  workADeep.children = [workANested];
  workANested.parent = workADeep;
  workANested.children = [workAVeryDeep];
  workAVeryDeep.parent = workANested;

  const workAExtra = new TFolder("PROJECT/Work-A-Extra");
  const workAExtraScene = new TFile("PROJECT/Work-A-Extra/Scene.md", "AE[^wae1]\n\n[^wae1]: Work-A-Extra footnote");
  workAExtra.children = [workAExtraScene];
  workAExtraScene.parent = workAExtra;

  for (const file of [
    article, deliler, detail, chapter1, chapter2, warpiNote, noFootnotes,
    introduction, rootAttachment, workAScene, workAVeryDeep, workAExtraScene,
  ]) {
    file.stat = { mtime: 1000, size: file.content.length };
    if (!file.extension) file.extension = "md";
  }

  projectRoot.children = [
    articleTest, soy, warpi, emptyTopic, introduction, rootAttachment, workA, workAExtra,
  ];
  for (const child of projectRoot.children) child.parent = projectRoot;

  const vaultEntries = [
    projectRoot, articleTest, article, soy, soySub, deliler, detail,
    warpi, warpiSub, chapter1, chapter2, warpiNote, emptyTopic, noFootnotes,
    introduction, rootAttachment,
    workA, workAScene, workADeep, workANested, workAVeryDeep,
    workAExtra, workAExtraScene,
  ];
  const { vault } = createFakeVault(vaultEntries);
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
    vault, settings, projectRoot,
    articleTest, article, soy, soySub, deliler, detail,
    warpi, warpiSub, chapter1, chapter2, warpiNote, emptyTopic, noFootnotes,
    introduction, rootAttachment,
    workA, workAScene, workADeep, workANested, workAVeryDeep,
    workAExtra, workAExtraScene,
  };
}

function createView(fixture, { workspace = null, scopeMode = "project", activeFile = null, cachedReadSpy } = {}) {
  // The outer "Notes de bas de page" section defaults to collapsed in
  // Project mode (§5 of the UX correction) — this file is about the
  // per-folder tree it reveals once open, so default it open here unless a
  // test explicitly opts into testing the collapsed-by-default behavior.
  if (fixture.settings.collapsed["research:footnotes-overview"] === undefined) {
    fixture.settings.collapsed["research:footnotes-overview"] = false;
  }
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
    getResearchRoot: () => null,
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

const OUTER_TITLE = () => t("shared.footnotes.title");

/** The footnotes overview section's own list container — scoping every
 * other helper to it, since the Bibliography section (also rendered in
 * the same body) reuses the exact same .feuillets-notes-section-* classes
 * for its own head and would otherwise be picked up as a false group. */
function footnotesList(contentEl) {
  const heads = contentEl.querySelectorAll(".feuillets-notes-section-head");
  const footnotesHead = heads.find((head) =>
    head.children.some((c) => c.classes.has("feuillets-notes-section-title") && c.text === OUTER_TITLE())
  );
  const section = footnotesHead?.parent;
  return section?.children.find((c) => c.classes.has("feuillets-research-list")) ?? null;
}

function groupSummary(name, count) {
  return `${name} — ${count} note${count > 1 ? "s" : ""}`;
}

/** A compact tree row's reconstructed "{name} — {count} note{s}" summary —
 * from its dedicated .feuillets-footnotes-tree-label/-badge spans, never
 * from .feuillets-notes-section-title (folder nodes never use that class,
 * reserved for the outer "Notes de bas de page" section — see §5/§9 of the
 * UX correction). */
function treeRowSummary(row) {
  const label = row.children.find((c) => c.classes.has("feuillets-footnotes-tree-label"));
  const badge = row.children.find((c) => c.classes.has("feuillets-footnotes-tree-badge"));
  const count = Number(badge?.text || "0");
  return groupSummary(label?.text || "", count);
}

function groupTitles(contentEl) {
  const list = footnotesList(contentEl);
  return list ? list.querySelectorAll(".feuillets-footnotes-tree-row").map(treeRowSummary) : [];
}

function footnoteLabels(contentEl) {
  const list = footnotesList(contentEl);
  return list ? list.querySelectorAll(".feuillets-footnotes-overview-label").map((el) => el.text) : [];
}

function findGroupHeadByTitle(contentEl, title) {
  const list = footnotesList(contentEl);
  if (!list) return undefined;
  return list.querySelectorAll(".feuillets-footnotes-tree-row").find((row) => treeRowSummary(row) === title);
}

/** The real DOM parent/child relationship a folder node's tree row uses:
 * its own children (directEntries + nested folder rows) live in the
 * `.feuillets-footnotes-tree-children` div immediately following the row
 * itself, as a SIBLING under the SAME parent container — never merely
 * "somewhere in the tree". Returns null if the row has no such sibling
 * (collapsed, or a leaf with nothing to expand). */
function childrenContainerFor(row) {
  const siblings = row.parent?.children ?? [];
  const next = siblings[siblings.indexOf(row) + 1];
  return next && next.classes.has("feuillets-footnotes-tree-children") ? next : null;
}

/** Only THIS container's own direct file-entry rows (its
 * `.feuillets-footnotes-overview-group` DIRECT children) — never a deeper
 * descendant reached through a nested `.feuillets-footnotes-tree-children`
 * sub-container, which querySelectorAll() would otherwise conflate with
 * this level's own content. */
function directFootnoteLabels(childrenContainer) {
  return childrenContainer.children
    .filter((c) => c.classes.has("feuillets-footnotes-overview-group"))
    .flatMap((group) => group.querySelectorAll(".feuillets-footnotes-overview-label").map((el) => el.text));
}

/* --- Real hierarchy --- */

test("a three-level folder chain (Work-A/Deep/Nested) is represented as nested groups", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  assert.ok(groupTitles(contentEl).includes(groupSummary("Work-A", 2)), "Work-A's recursive total includes its own file and Deep/Nested's");
});

test("opening Work-A, then Deep, then Nested reveals the very deep file's row nested under its real DOM parent at every level", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "Work-A")] = false;
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "Work-A/Deep")] = false;
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "Work-A/Deep/Nested")] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });

  const workARow = findGroupHeadByTitle(contentEl, groupSummary("Work-A", 2));
  assert.ok(workARow, "Work-A's own row exists");
  const workAChildren = childrenContainerFor(workARow);
  assert.ok(workAChildren, "Work-A is open: it has a children container");

  // Work-A's own file (workAScene, [^wa1]) is a DIRECT child — never
  // confused with Deep's own nested content.
  assert.deepEqual(directFootnoteLabels(workAChildren), ["[^wa1]"], "Work-A's own direct file row lives directly under Work-A, not under Deep");

  const deepRow = workAChildren.querySelectorAll(".feuillets-footnotes-tree-row")
    .find((row) => treeRowSummary(row) === groupSummary("Deep", 1));
  assert.ok(deepRow, "Deep's own row exists, nested directly under Work-A's children container");
  assert.equal(deepRow.parent, workAChildren, "Deep's row is a direct child of Work-A's own children container — not a grandchild");

  const deepChildren = childrenContainerFor(deepRow);
  assert.ok(deepChildren, "Deep is open: it has a children container");
  assert.deepEqual(directFootnoteLabels(deepChildren), [], "Deep has no direct file of its own — only its Nested subfolder");

  const nestedRow = deepChildren.querySelectorAll(".feuillets-footnotes-tree-row")
    .find((row) => treeRowSummary(row) === groupSummary("Nested", 1));
  assert.ok(nestedRow, "Nested's own row exists, nested directly under Deep's children container");
  assert.equal(nestedRow.parent, deepChildren, "Nested's row is a direct child of Deep's own children container — not of Work-A's");

  const nestedChildren = childrenContainerFor(nestedRow);
  assert.ok(nestedChildren, "Nested is open: it has a children container");
  assert.deepEqual(
    directFootnoteLabels(nestedChildren),
    ["[^wad1]"],
    "VeryDeep.md's own footnote row lives directly under Nested — the correct grandchild parent, not under Work-A or Deep"
  );

  // The very deep file's row is real DOM descendant of Work-A's own
  // children container (three levels down), never a sibling promoted to
  // the wrong level.
  assert.ok(
    workAChildren.querySelectorAll(".feuillets-footnotes-overview-label").some((el) => el.text === "[^wad1]"),
    "[^wad1] is a genuine descendant of Work-A's subtree"
  );
});

test("a parent folder's counter is the recursive total of its own files and every descendant", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  // SOY direct: 2 rows (orphan def + ref-without-def). Sub: 1 row. Total: 3.
  assert.ok(groupTitles(contentEl).includes(groupSummary("SOY", 3)));
});

test("a subfolder keeps its own counter distinct from its parent's", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY")] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  assert.ok(groupTitles(contentEl).includes(groupSummary("Sub", 1)), "SOY/Sub's own counter (1) is distinct from SOY's total (3)");
});

test("a parent's direct files are listed separately from its subfolder's files", async () => {
  const fixture = makeFixture();
  const soyKey = footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY");
  const subKey = footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY/Sub");
  fixture.settings.collapsed[soyKey] = false;
  fixture.settings.collapsed[subKey] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  const labels = footnoteLabels(contentEl);
  assert.ok(labels.includes("[^orphan]"), "Deliler.md's own row is shown directly under SOY");
  assert.ok(labels.includes("[^y3]"), "Detail.md's row is shown, nested under SOY/Sub");
});

test("two subfolders named \"Sub\" under different parents remain fully distinct", async () => {
  const fixture = makeFixture();
  const soySubKey = footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY/Sub");
  const warpiSubKey = footnoteGroupCollapseKey(fixture.projectRoot.path, "WARPI/Sub");
  assert.notEqual(soySubKey, warpiSubKey, "same folder name under different parents must yield different keys");

  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY")] = false;
  fixture.settings.collapsed[soySubKey] = false;
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "WARPI")] = false;
  fixture.settings.collapsed[warpiSubKey] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  const labels = footnoteLabels(contentEl);
  assert.ok(labels.includes("[^y3]"), "SOY/Sub's own file is shown");
  assert.ok(labels.includes("[^w4]"), "WARPI/Sub's own file is shown, never merged with SOY/Sub");
});

test("two files named \"Scene.md\" in different branches remain distinct", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "Work-A")] = false;
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "Work-A-Extra")] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  const labels = footnoteLabels(contentEl);
  assert.ok(labels.includes("[^wa1]"), "Work-A/Scene.md's own footnote is shown");
  assert.ok(labels.includes("[^wae1]"), "Work-A-Extra/Scene.md's own footnote is shown, never confused with Work-A's");
});

test("files directly at the project root use the \"root files\" group", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  assert.ok(groupTitles(contentEl).includes(groupSummary(t("shared.footnotes.rootFilesGroup"), 1)));
});

test("a top-level folder with no footnote content anywhere in its subtree produces no group at all", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  assert.ok(!groupTitles(contentEl).some((title) => title.startsWith("EMPTY-TOPIC")));
});

test("a PDF attachment at the project root never creates or joins a group", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  assert.equal(
    groupTitles(contentEl).find((title) => title.startsWith(t("shared.footnotes.rootFilesGroup"))),
    groupSummary(t("shared.footnotes.rootFilesGroup"), 1),
    "only Introduction.md's row is counted, never the PDF's"
  );
});

/* --- Row semantics --- */

test("a real never-cited definition is counted, rendered once, and marked orphan with the correct tooltip", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY")] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });

  const list = footnotesList(contentEl);
  const orphanLabelEls = list.querySelectorAll(".feuillets-footnotes-overview-label").filter((el) => el.text === "[^orphan]");
  assert.equal(orphanLabelEls.length, 1, "[^orphan] appears exactly once");

  const row = orphanLabelEls[0].parent;
  assert.ok(row.classes.has("feuillets-footnotes-overview-orphan"), "the row carries the orphan class");
  assert.equal(row.getAttr("title"), t("shared.footnotes.definedNeverCited"));
});

test("a reference without a definition is counted as its own row", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY")] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  assert.ok(footnoteLabels(contentEl).includes("[^y2]"));
});

test("a valid reference to an existing definition is never counted twice", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "ARTICLE TEST")] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  const labels = footnoteLabels(contentEl).filter((l) => l === "[^x1]");
  assert.equal(labels.length, 1, "[^x1] is defined and cited — exactly one row, not two");
});

test("the general empty state still applies when no group has any footnote", async () => {
  const fixture = makeFixture();
  for (const file of [
    fixture.article, fixture.deliler, fixture.detail, fixture.chapter1, fixture.chapter2, fixture.warpiNote,
    fixture.introduction, fixture.workAScene, fixture.workAVeryDeep, fixture.workAExtraScene,
  ]) {
    file.content = "Nothing here.";
    file.stat = { mtime: 2000, size: file.content.length };
  }
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  // §5/§8 of the UX correction: an empty Notes section is never rendered at
  // all (no title, no empty-state message) — with Sources and Bibliography
  // also empty in this fixture, the References tab falls back to its own
  // single compact empty state instead.
  assert.equal(footnotesList(contentEl), null, "no Notes section is rendered when the scope has no footnote");
  assert.equal(groupTitles(contentEl).length, 0);
  const tabEmpty = contentEl.querySelectorAll(".feuillets-references-empty").filter(
    (el) => el.text === t("shared.research.noReferencesInScope")
  );
  assert.equal(tabEmpty.length, 1);
});

/* --- Collapse and persistence --- */

test("groups are collapsed by default when their key is absent from settings.collapsed", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  assert.ok(!footnoteLabels(contentEl).includes("[^x1]"), "a fresh group renders no detail rows by default");
  assert.ok(groupTitles(contentEl).includes(groupSummary("ARTICLE TEST", 1)), "but its summary is still shown");
});

test("a parent and its child open independently of one another", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY")] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  // SOY is open but SOY/Sub is not: only SOY's own direct row is visible.
  const labels = footnoteLabels(contentEl);
  assert.ok(labels.includes("[^orphan]"), "SOY's own content is visible once SOY is open");
  assert.ok(!labels.includes("[^y3]"), "SOY/Sub's content stays hidden until it is opened too");
  assert.ok(groupTitles(contentEl).includes(groupSummary("Sub", 1)), "but SOY/Sub's own summary is shown once SOY is open");
});

test("an explicitly opened group is restored open after a new render", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "ARTICLE TEST")] = false;
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  assert.ok(footnoteLabels(contentEl).includes("[^x1]"));
});

test("toggling one group never changes another group's state", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "ARTICLE TEST")] = false;
  const { view, contentEl } = createView(fixture, { scopeMode: "project" });
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    const warpiHead = findGroupHeadByTitle(contentEl, groupSummary("WARPI", 4));
    assert.ok(warpiHead, "WARPI's collapsed head is rendered");
    warpiHead.dispatchClick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(
      fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "WARPI")],
      false,
      "clicking WARPI opens only WARPI"
    );
    assert.equal(
      fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "ARTICLE TEST")],
      false,
      "ARTICLE TEST's own state is untouched"
    );
  } finally {
    globalThis.document = prevDoc;
  }
});

test("clicking a group toggles only its own collapsed state, alternating correctly", async () => {
  const fixture = makeFixture();
  const { view, contentEl } = createView(fixture, { scopeMode: "project" });
  const key = footnoteGroupCollapseKey(fixture.projectRoot.path, "ARTICLE TEST");
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    findGroupHeadByTitle(contentEl, groupSummary("ARTICLE TEST", 1)).dispatchClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fixture.settings.collapsed[key], false, "first click opens the group");

    findGroupHeadByTitle(contentEl, groupSummary("ARTICLE TEST", 1)).dispatchClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fixture.settings.collapsed[key], true, "second click collapses it again");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("no settings write happens during a plain render", async () => {
  const fixture = makeFixture();
  let saveCount = 0;
  const { view, contentEl } = createView(fixture, { scopeMode: "project" });
  view.plugin.saveSettings = async () => { saveCount += 1; };
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
  } finally {
    globalThis.document = prevDoc;
  }
  assert.equal(saveCount, 0);
  void contentEl;
});

/* --- No collision with the Binder's own collapse keys --- */

test("a footnote group's collapse key is never equal to the Binder's raw folder path", () => {
  const fixture = makeFixture();
  const key = footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY");
  assert.notEqual(key, fixture.soy.path);
  assert.notEqual(key, "PROJECT/SOY");
});

test("toggling the SOY footnote group never touches the Binder's own settings.collapsed[\"PROJECT/SOY\"] entry", async () => {
  const fixture = makeFixture();
  // Simulate a pre-existing Binder-owned entry at the raw folder path.
  fixture.settings.collapsed["PROJECT/SOY"] = "binder-owned-value";

  const { view, contentEl } = createView(fixture, { scopeMode: "project" });
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    findGroupHeadByTitle(contentEl, groupSummary("SOY", 3)).dispatchClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.document = prevDoc;
  }

  assert.equal(fixture.settings.collapsed["PROJECT/SOY"], "binder-owned-value", "the Binder's raw-path entry is untouched");
  assert.equal(
    fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY")],
    false,
    "only the namespaced footnote-group key changed"
  );
});

/* --- Group order --- */

test("group order follows documentContext.files, not alphabetical order", async () => {
  const fixture = makeFixture();
  // The Binder's persisted custom order (settings.orders, the same
  // mechanism getOrderedChildren() already honors) is deliberately NOT
  // alphabetical, to prove groups follow it rather than a parallel sort.
  fixture.settings.orders[fixture.projectRoot.path] = [
    "Work-A", "WARPI", "ARTICLE TEST", "SOY", "EMPTY-TOPIC", "Introduction.md", "Work-A-Extra",
  ];
  const contentEl = await renderWithDocument(fixture, { scopeMode: "project" });
  const titles = groupTitles(contentEl);
  const order = [
    groupSummary("Work-A", 2),
    groupSummary("WARPI", 4),
    groupSummary("ARTICLE TEST", 1),
    groupSummary("SOY", 3),
    groupSummary(t("shared.footnotes.rootFilesGroup"), 1),
    groupSummary("Work-A-Extra", 1),
  ].filter((title) => titles.includes(title));
  const actualOrder = titles.filter((title) => order.includes(title));
  assert.deepEqual(actualOrder, order, "groups must appear in the order their files are first encountered");
});

/* --- Workspace mode is untouched --- */

test("Workspace mode never introduces a hierarchical group", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.deepEqual(groupTitles(contentEl), [], "no per-folder group titles in Workspace mode");
});

test("Workspace mode keeps rendering the same flat detail as before", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  const labels = footnoteLabels(contentEl);
  assert.ok(labels.includes("[^wa1]"), "Work-A's own footnote is rendered directly, no collapsed wrapper");
  assert.ok(labels.includes("[^wad1]"), "Work-A/Deep/Nested/VeryDeep.md's footnote is rendered too, flat, no wrapper");
});

test("Workspace scope excludes a sibling space's files", async () => {
  const fixture = makeFixture();
  const contentEl = await renderWithDocument(fixture, { workspace: fixture.workA, scopeMode: "workspace" });
  assert.ok(!footnoteLabels(contentEl).includes("[^wae1]"), "Work-A-Extra's footnote must never appear for Work-A");
});

test("changing the active file never changes Project mode's groups or counters", async () => {
  const fixture = makeFixture();
  const { view, contentEl, setActiveFile } = createView(fixture, { scopeMode: "project", activeFile: fixture.article });
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    await view.render(true);
    const first = groupTitles(contentEl);

    setActiveFile(fixture.introduction);
    await view.render(true);
    assert.deepEqual(groupTitles(contentEl), first);

    setActiveFile(fixture.rootAttachment);
    await view.render(true);
    assert.deepEqual(groupTitles(contentEl), first);

    setActiveFile(fixture.workAExtraScene);
    await view.render(true);
    assert.deepEqual(groupTitles(contentEl), first);
  } finally {
    globalThis.document = prevDoc;
  }
});

/* --- Reads and scans --- */

test("the exact set of eligible Markdown files is read, each exactly once, and PDFs/attachments are never read", async () => {
  // Calls renderFootnotesOverviewSection() directly, isolated from the
  // Bibliography section's own independent citekey scan (both are called
  // in the same page render, and each legitimately reads the same files
  // once for its own purpose — see research-citations-scope.test.js's
  // equivalent invariant for that section).
  const fixture = makeFixture();
  fixture.settings.collapsed[footnoteGroupCollapseKey(fixture.projectRoot.path, "SOY")] = false;
  const eligibleMarkdownFiles = [
    fixture.article, fixture.deliler, fixture.detail, fixture.chapter1, fixture.chapter2, fixture.warpiNote,
    fixture.noFootnotes, fixture.introduction, fixture.workAScene, fixture.workAVeryDeep, fixture.workAExtraScene,
  ];
  const documentContext = {
    mode: "project",
    projectRoot: fixture.projectRoot,
    scopeRoot: fixture.projectRoot,
    workspaceRoot: null,
    // rootAttachment (a .pdf) is deliberately included here — proving the
    // section's OWN extension filter excludes it, not merely that the
    // caller never handed it one.
    files: [...eligibleMarkdownFiles, fixture.rootAttachment],
  };
  const reads = [];
  const app = {
    vault: { ...fixture.vault, cachedRead: async (file) => { reads.push(file.path); return fixture.vault.cachedRead(file); } },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: { getActiveFile: () => null },
  };
  const plugin = {
    settings: fixture.settings,
    app,
    buildNumbering: () => new Map(),
    shortTitleFor: (f) => f.basename,
    saveSettings: async () => {},
  };
  const leaf = { app, contentEl: new FakeElement() };
  const view = new ResearchView(leaf, plugin);
  const container = new FakeElement();

  await view.renderFootnotesOverviewSection(container, documentContext);

  const expectedPaths = eligibleMarkdownFiles.map((f) => f.path).sort();
  const readPaths = [...reads].sort();
  assert.deepEqual(readPaths, expectedPaths, "the set of read paths is exactly the eligible Markdown files — no more, no less");

  const counts = new Map();
  for (const path of reads) counts.set(path, (counts.get(path) || 0) + 1);
  for (const path of expectedPaths) {
    assert.equal(counts.get(path), 1, `${path} must be read exactly once`);
  }

  assert.ok(!reads.includes(fixture.rootAttachment.path), "the PDF attachment is never read");
});

test("renderFootnotesOverviewSection never calls plugin.flattenFiles in Project mode", async () => {
  const fixture = makeFixture();
  fixture.settings.collapsed["research:footnotes-overview"] = false;
  const documentContext = {
    mode: "project",
    projectRoot: fixture.projectRoot,
    scopeRoot: fixture.projectRoot,
    workspaceRoot: null,
    files: [fixture.article, fixture.deliler, fixture.detail, fixture.chapter1, fixture.chapter2, fixture.introduction, fixture.rootAttachment],
  };
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

  assert.ok(groupTitles(container).includes(groupSummary("ARTICLE TEST", 1)));
});
