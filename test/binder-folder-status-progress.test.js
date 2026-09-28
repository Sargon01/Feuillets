import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { folderNoteFor } from "../src/services/folder-notes.js";
import { folderGoal } from "../src/services/frontmatter.js";

/* Micro-lot "repère d'avancement sans dashboard" — folder-row coverage:
 * a collapsed part/chapter must show its own status dot and progress ring,
 * read-only from its existing folder note and from the descendant sheets'
 * word counts, WITHOUT rendering its children and WITHOUT ever creating a
 * folder note. Same minimal harness as test/binder-minimal-rendering.test.js
 * (duplicated per this repo's convention), but with the REAL
 * folderNoteFor()/folderGoal() service functions bound on the fake plugin,
 * so the folder-row indicator path is exercised for real, not stubbed out. */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle) };

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = {};
    this.text = options.text ?? "";
    this.style = { _props: {}, setProperty(name, value) { this._props[name] = value; } };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  scrollIntoView() {}
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs[name] = value; }
  getAttr(name) { return this.attrs[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    const classNames = (selector.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    const attrNames = (selector.match(/\[[\w-]+\]/g) || []).map((a) => a.slice(1, -1));
    const matches = [];
    const walk = (el) => {
      for (const child of el.children) {
        const classOk = classNames.every((c) => child.classes.has(c));
        const attrOk = attrNames.every((a) => Object.prototype.hasOwnProperty.call(child.attrs, a));
        if (classOk && attrOk) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
}

function findAll(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findAll(child, predicate));
  }
  return found;
}

function rowFor(contentEl, path) {
  return contentEl.querySelectorAll(".feuillets-folder-row[data-path]").find((el) => el.getAttr("data-path") === path);
}

/*
 * Roman/Manuscrit/
 *   Chapitre 1/
 *     Chapitre 1.md   (folder note, status "Brouillon")
 *     A.md            (400 words)
 *     B.md            (600 words)
 *   Chapitre 2/       (no folder note, no goal)
 *     C.md            (300 words)
 */
function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");

  const chapter1 = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter1.name = "Chapitre 1";
  const chapter1Note = new TFile("Roman/Manuscrit/Chapitre 1/Chapitre 1.md");
  chapter1Note.basename = "Chapitre 1";
  const a = new TFile("Roman/Manuscrit/Chapitre 1/A.md");
  a.basename = "A";
  const b = new TFile("Roman/Manuscrit/Chapitre 1/B.md");
  b.basename = "B";
  chapter1.children = [chapter1Note, a, b];
  chapter1Note.parent = chapter1;
  a.parent = chapter1;
  b.parent = chapter1;

  const chapter2 = new TFolder("Roman/Manuscrit/Chapitre 2");
  chapter2.name = "Chapitre 2";
  const c = new TFile("Roman/Manuscrit/Chapitre 2/C.md");
  c.basename = "C";
  chapter2.children = [c];
  c.parent = chapter2;

  root.children = [chapter1, chapter2];
  chapter1.parent = root;
  chapter2.parent = root;

  const byPath = new Map();
  for (const node of [root, chapter1, chapter1Note, a, b, chapter2, c]) byPath.set(node.path, node);

  const frontmatterByPath = new Map([
    [chapter1Note.path, { status: "Brouillon" }],
  ]);

  return { root, chapter1, chapter1Note, a, b, chapter2, c, byPath, frontmatterByPath };
}

function buildView(fixture, { settingsOverrides = {}, folderGoals = {} } = {}) {
  const { root, byPath, frontmatterByPath } = fixture;
  const settings = {
    projectFolder: root.path,
    binderSelectedPath: root.path,
    projects: [],
    projectMeta: {},
    binderLayout: "tree",
    binderCompact: false,
    binderTreeWidth: 240,
    collapsed: {},
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    binderShowLabels: false,
    binderShowTags: false,
    binderShowStatus: true,
    binderShowProgress: true,
    binderShowWords: false,
    listPanePreviewField: "none",
    listPanePreviewLines: 2,
    folderGoals,
    ...settingsOverrides,
  };
  const contentEl = new FakeElement();
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: {} };
  const app = {
    vault: {
      getAbstractFileByPath: (path) => byPath.get(path) || null,
      cachedRead: async () => "Contenu.",
      create: async () => { throw new Error("a read-only Binder render must never create a folder note"); },
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: {
      leftSplit: { name: "left" },
      rightSplit: { name: "right" },
      rootSplit,
      getLeavesOfType: () => [],
      getActiveViewOfType: () => null,
      getMostRecentLeaf: (splitRoot) => (splitRoot === rootSplit ? workLeaf : null),
      setActiveLeaf: () => {},
      revealLeaf: async () => {},
    },
  };

  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: (folder) => {
      const results = [];
      const walk = (f) => {
        for (const child of f.children || []) {
          if (child instanceof TFile && child.basename !== f.name) results.push(child);
          else if (child instanceof TFolder) walk(child);
        }
      };
      walk(folder);
      return results;
    },
    getWordCounts: async (files) => new Map(files.map((f) => [f.path, { wc: f.path === fixture.a.path ? 400 : f.path === fixture.b.path ? 600 : f.path === fixture.c.path ? 300 : 0 }])),
    buildNumbering: () => new Map(),
    fmOf: (file) => frontmatterByPath.get(file.path) || {},
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    tagsOf: () => [],
    labelOf: () => "",
    labelsOf: () => [],
    labelColor: () => null,
    roleOfFile: () => "scene",
    projectDisplayName: () => "Roman",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    getLeafForOpeningFile: () => workLeaf,
    getStatusColor: (name) => (name ? "#00ff00" : null),
    folderNoteFor: (folder) => folderNoteFor(app, folder),
    folderGoal: (folder) => folderGoal(settings, folder),
  };

  const view = new FeuilletsView({ app, contentEl }, plugin);
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  return { view, contentEl, app, plugin, settings };
}

test("Test D — a folder with a status in its folder note shows the same compact status dot, read-only, no note created", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const row = rowFor(contentEl, fixture.chapter1.path);
  assert.ok(row, "Chapitre 1's row must exist");
  const dots = findAll(row, (el) => el.classes.has("feuillets-status-dot"));
  assert.equal(dots.length, 1);
  assert.equal(dots[0].style.background, "#00ff00");
});

test("Test D — a folder without a folder note shows no status dot, and no note is ever created merely by rendering", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const row = rowFor(contentEl, fixture.chapter2.path);
  assert.ok(row, "Chapitre 2's row must exist");
  assert.equal(findAll(row, (el) => el.classes.has("feuillets-status-dot")).length, 0);
});

test("Test F — a folder's progress ring reflects the sum of its descendant sheets against folderGoal(), without opening the folder", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { folderGoals: { [fixture.chapter1.path]: 2000 } });
  await view.render(true);

  const row = rowFor(contentEl, fixture.chapter1.path);
  const rings = findAll(row, (el) => el.classes.has("feuillets-ring"));
  assert.equal(rings.length, 1);
  assert.equal(rings[0].style._props["--pct"], "50%", "400 + 600 = 1000 out of a 2000 goal is 50%");
  assert.equal(rings[0].getAttr("aria-valuenow"), "50");
  // No permanent percentage text anywhere on the row.
  assert.doesNotMatch(row.text || "", /%/);
});

test("Test G — a folder without a valid goal shows no ring at all, never an empty placeholder", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const row = rowFor(contentEl, fixture.chapter2.path);
  assert.equal(findAll(row, (el) => el.classes.has("feuillets-ring")).length, 0);
});

test("Test H — a COLLAPSED folder still shows its own status dot and progress ring on its own row, without rendering its children", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, {
    settingsOverrides: { collapsed: { [fixture.chapter1.path]: true } },
    folderGoals: { [fixture.chapter1.path]: 2000 },
  });
  await view.render(true);

  const row = rowFor(contentEl, fixture.chapter1.path);
  assert.ok(row, "the collapsed folder's own row must still exist");
  assert.equal(findAll(row, (el) => el.classes.has("feuillets-status-dot")).length, 1);
  assert.equal(findAll(row, (el) => el.classes.has("feuillets-ring")).length, 1);
  // Its children are indeed not rendered while collapsed.
  assert.equal(rowFor(contentEl, fixture.a.path), undefined);
  assert.equal(contentEl.querySelectorAll(".feuillets-item[data-path]").find((el) => el.getAttr("data-path") === fixture.a.path), undefined);
});

test("Test I — indicators belong to the folder's own row, never a second row or a nested block", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { folderGoals: { [fixture.chapter1.path]: 2000 } });
  await view.render(true);

  const row = rowFor(contentEl, fixture.chapter1.path);
  const indicators = findAll(row, (el) => el.classes.has("feuillets-binder-indicators"));
  assert.equal(indicators.length, 1);
  // The indicators container is a DIRECT child of the row, exactly like the
  // folder-name span — same flex line, no wrapper row of its own.
  assert.ok(row.children.includes(indicators[0]), "indicators sit directly in the folder row, not in a secondary container");
});

test("Test J — binderShowStatus/Progress off leaves the folder row exactly as before: no indicators at all", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, {
    settingsOverrides: { binderShowStatus: false, binderShowProgress: false },
    folderGoals: { [fixture.chapter1.path]: 2000 },
  });
  await view.render(true);

  const row = rowFor(contentEl, fixture.chapter1.path);
  assert.equal(findAll(row, (el) => el.classes.has("feuillets-binder-indicators")).length, 0);
  assert.equal(findAll(row, (el) => el.classes.has("feuillets-status-dot")).length, 0);
  assert.equal(findAll(row, (el) => el.classes.has("feuillets-ring")).length, 0);
});
