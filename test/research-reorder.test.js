import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { ResearchView } from "../src/views/research-view.js";
import { t } from "../src/i18n/index.js";
import { RESEARCH_ORDER_DRAG_MIME } from "../src/services/research-order.js";

/* `dragleave`'s `e.relatedTarget instanceof Node` (attachResearchOrderHandle,
   attachResearchDropTarget) needs a real `Node` global to check against —
   present in every browser, absent from plain Node.js. A minimal stub is
   enough: this file only ever passes `relatedTarget: null`. */
globalThis.Node ??= class Node {};

/* Visual reordering of Research spaces/folders — drag-and-drop and the
   Monter/Descendre menu alternative. Never a Vault move (proved below by
   spying on every Vault/fileManager mutating call and asserting zero
   calls), never the Binder's own `settings.orders` (proved by a dedicated
   test), never a file (files never get a drag handle or menu entries
   here). See src/services/research-order.ts for the pure reorder logic,
   already covered independently in test/research-order.test.js. */

/* FakeElement — same contract as the other base-feuillets-view.ts test
   files (research-plus-menu.test.js, research-row-actions.test.js), plus
   what THIS file specifically needs: toggleClass (feuillets-research-
   order-drop-before/-after), getBoundingClientRect (before/after decision
   in attachResearchOrderHandle), and contains (dragleave). Never shared
   across test files, per repo convention. */
class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
    this.attrs = new Map();
    this.tag = options.tag || "div";
    this.style = {};
    this.parent = null;
    this.draggable = false;
    this.rect = { top: 0, height: 24 };
    if (options.cls) this.addClass(options.cls);
  }
  addClass(className) {
    for (const part of String(className).split(/\s+/)) if (part) this.classes.add(part);
    return this;
  }
  removeClass(className) {
    for (const part of String(className).split(/\s+/)) this.classes.delete(part);
    return this;
  }
  toggleClass(className, on) {
    if (on) this.addClass(className);
    else this.removeClass(className);
    return this;
  }
  hasClass(className) { return this.classes.has(className); }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    if (options.cls) child.addClass(options.cls);
    child.parent = this;
    this.children.push(child);
    return child;
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
  findAll(predicate) {
    const results = [];
    for (const child of this.children) {
      if (predicate(child)) results.push(child);
      results.push(...child.findAll(predicate));
    }
    return results;
  }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs.set(name, value); return this; }
  getAttr(name) { return this.attrs.get(name); }
  setAttribute(name, value) { this.attrs.set(name, value); }
  getAttribute(name) { return this.attrs.get(name); }
  addEventListener(type, callback) {
    this.events ||= new Map();
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(callback);
  }
  dispatch(type, event = {}) {
    const full = { preventDefault() {}, stopPropagation() {}, ...event };
    for (const cb of this.events?.get(type) ?? []) cb(full);
    return full;
  }
  contains(node) {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }
  getBoundingClientRect() { return this.rect; }
  click() {}
  empty() { this.children = []; }
}

function fakeDataTransfer() {
  const data = {};
  return {
    effectAllowed: null,
    dropEffect: null,
    setData(k, v) { data[k] = v; },
    getData(k) { return data[k] ?? ""; },
    hasType(k) { return Object.prototype.hasOwnProperty.call(data, k); },
  };
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

/** Builds a ResearchView with a fully spied Vault/fileManager — every
 * mutating call is recorded, never actually a no-op silently swallowed,
 * so a test that expects zero calls fails loudly if that ever changes. */
function buildView({ linkedFolders = [] } = {}) {
  const renameFileCalls = [];
  const createFolderCalls = [];
  const createCalls = [];
  const createBinaryCalls = [];
  const modifyCalls = [];
  const trashFileCalls = [];
  const processFrontMatterCalls = [];
  const saveSettingsCalls = [];
  const renderAllViewsCalls = [];

  const app = {
    vault: {
      getAbstractFileByPath: () => null,
      createFolder: async (path) => { createFolderCalls.push(path); return folder(path); },
      create: async (path, content) => { createCalls.push({ path, content }); return new TFile(path, content); },
      createBinary: async (path, data) => { createBinaryCalls.push({ path, data }); return new TFile(path); },
      modify: async (file, content) => { modifyCalls.push({ file, content }); },
    },
    fileManager: {
      renameFile: async (source, dest) => { renameFileCalls.push({ from: source.path, to: dest }); },
      trashFile: async (file) => { trashFileCalls.push(file.path); },
      processFrontMatter: async (file, fn) => { processFrontMatterCalls.push(file.path); fn({}); },
    },
    workspace: {
      getLeaf: () => ({ openFile: async () => {} }),
      setActiveLeaf: () => {},
      trigger: () => {},
    },
  };

  const settings = {
    researchOrder: {},
    collapsed: {},
    orders: {},
    folderPositions: {},
  };

  const plugin = {
    app,
    settings,
    newFolder: () => {},
    saveSettings: async () => { saveSettingsCalls.push(true); },
    renderAllViews: (force) => { renderAllViewsCalls.push(force); },
    titleFor: (f) => f.basename,
    tagsOf: () => [],
    getLinkedResearchFolders: () => linkedFolders,
  };

  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);
  const renderCalls = [];
  view.render = async (force) => { renderCalls.push(force); };

  return {
    app, plugin, settings, view, renderCalls,
    renameFileCalls, createFolderCalls, createCalls, createBinaryCalls,
    modifyCalls, trashFileCalls, processFrontMatterCalls, saveSettingsCalls, renderAllViewsCalls,
  };
}

function itemsOf(menu) {
  return menu.items.filter((i) => !i.separator);
}

/** Simulates a full drag-and-drop reorder gesture: dragstart on `sourceTitleEl`,
 * dragover + drop on `targetRowEl` at a given fraction of its height (0 = top
 * edge -> "before", 1 = bottom edge -> "after"). Returns the dataTransfer used,
 * so callers can inspect what was actually put on it. */
function simulateOrderDrag(sourceTitleEl, targetRowEl, atFraction) {
  const dt = fakeDataTransfer();
  sourceTitleEl.dispatch("dragstart", { dataTransfer: dt });
  targetRowEl.rect = { top: 0, height: 24 };
  const clientY = atFraction * targetRowEl.rect.height;
  targetRowEl.dispatch("dragover", { dataTransfer: dt, clientY });
  const dropEvent = targetRowEl.dispatch("drop", { dataTransfer: dt, clientY });
  sourceTitleEl.dispatch("dragend", {});
  return { dt, dropEvent };
}

/* ===== 1. two top-level spaces ===== */

test("reorders two top-level Research spaces via drag-and-drop", async () => {
  const { view, settings, renderCalls } = buildView();
  const sources = folder("Projet/_Recherche/Sources");
  const notes = folder("Projet/_Recherche/Notes");
  const container = new FakeElement();
  const parentKey = "research-sections:Projet/_Recherche";
  const siblingKeys = [sources.path, notes.path];

  view.renderSection(container, "Sources", sources, undefined, undefined, undefined, undefined, undefined,
    { parentKey, key: sources.path, siblingKeys });
  view.renderSection(container, "Notes", notes, undefined, undefined, undefined, undefined, undefined,
    { parentKey, key: notes.path, siblingKeys });

  const notesTitle = container.findAll((el) => el.classes.has("feuillets-notes-section-title") && el.text === "Notes")[0];
  const sourcesHead = container.findAll((el) => el.classes.has("feuillets-notes-section-head"))
    .find((el) => el.children.some((c) => c.text === "Sources"));

  // Spec example: place "Notes" before "Sources" — drag Notes onto the TOP
  // half of Sources.
  simulateOrderDrag(notesTitle, sourcesHead, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(settings.researchOrder[parentKey], [notes.path, sources.path]);
  assert.deepEqual(renderCalls, [undefined], "only this view refreshes, once");
});

test("dropping onto the BOTTOM half places the dragged space AFTER the target", () => {
  const { view, settings } = buildView();
  const a = folder("Projet/_Recherche/A");
  const b = folder("Projet/_Recherche/B");
  const container = new FakeElement();
  const parentKey = "research-sections:Projet/_Recherche";
  const siblingKeys = [a.path, b.path];

  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined, { parentKey, key: a.path, siblingKeys });
  view.renderSection(container, "B", b, undefined, undefined, undefined, undefined, undefined, { parentKey, key: b.path, siblingKeys });

  const titleA = container.findAll((el) => el.classes.has("feuillets-notes-section-title") && el.text === "A")[0];
  const headB = container.findAll((el) => el.classes.has("feuillets-notes-section-head"))
    .find((el) => el.children.some((c) => c.text === "B"));

  simulateOrderDrag(titleA, headB, 1);

  assert.deepEqual(settings.researchOrder[parentKey], [b.path, a.path]);
});

test("dropping a space on itself changes nothing", () => {
  const { view, settings, renderCalls } = buildView();
  const a = folder("Projet/_Recherche/A");
  const container = new FakeElement();
  const parentKey = "research-sections:Projet/_Recherche";
  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined, { parentKey, key: a.path, siblingKeys: [a.path] });

  const titleA = container.findAll((el) => el.classes.has("feuillets-notes-section-title"))[0];
  const headA = container.findAll((el) => el.classes.has("feuillets-notes-section-head"))[0];
  simulateOrderDrag(titleA, headA, 0);

  assert.equal(settings.researchOrder[parentKey], undefined, "no-op self-drop must never write an order");
  assert.deepEqual(renderCalls, [], "a no-op reorder must never trigger a refresh");
});

/* ===== 2. two folders directly inside a space ===== */

test("reorders two folders directly inside a Research space (real subfolder listing, not hand-built context)", () => {
  const { view, settings } = buildView();
  const a = folder("Projet/_Recherche/Personnages/Alpha");
  const b = folder("Projet/_Recherche/Personnages/Beta");
  const main = folder("Projet/_Recherche/Personnages", [a, b]);
  const container = new FakeElement();

  view.renderSection(container, "Personnages", main);

  const list = container.find(".feuillets-research-list");
  const rows = list.findAll((el) => el.classes.has("feuillets-research-subfolder") && el.parent === list);
  // Alphabetical base order: Alpha then Beta.
  const alphaRow = rows.find((r) => r.findAll((c) => c.classes.has("feuillets-research-item-name")).some((n) => n.text === "Alpha"));
  const betaRow = rows.find((r) => r.findAll((c) => c.classes.has("feuillets-research-item-name")).some((n) => n.text === "Beta"));
  const alphaTitle = alphaRow.findAll((c) => c.classes.has("feuillets-research-item-name"))[0];
  const betaHeader = betaRow.find(".feuillets-research-item-header");

  simulateOrderDrag(alphaTitle, betaHeader, 1); // Alpha after Beta.

  assert.deepEqual(settings.researchOrder[main.path], [b.path, a.path]);
});

/* ===== 3. two nested subfolders (a subfolder's own children) ===== */

test("reorders two nested subfolders, several levels deep", () => {
  const { view, settings } = buildView();
  const x = folder("Projet/_Recherche/Personnages/Principaux/X");
  const y = folder("Projet/_Recherche/Personnages/Principaux/Y");
  const principaux = folder("Projet/_Recherche/Personnages/Principaux", [x, y]);
  const main = folder("Projet/_Recherche/Personnages", [principaux]);
  const container = new FakeElement();

  view.renderSection(container, "Personnages", main);

  const nested = container.find(".feuillets-research-nested");
  assert.ok(nested, "Principaux must be expanded and its own subfolder list present");
  const rows = nested.findAll((el) => el.classes.has("feuillets-research-subfolder") && el.parent === nested);
  const xRow = rows.find((r) => r.findAll((c) => c.classes.has("feuillets-research-item-name")).some((n) => n.text === "X"));
  const yRow = rows.find((r) => r.findAll((c) => c.classes.has("feuillets-research-item-name")).some((n) => n.text === "Y"));
  const xTitle = xRow.findAll((c) => c.classes.has("feuillets-research-item-name"))[0];
  const yHeader = yRow.find(".feuillets-research-item-header");

  simulateOrderDrag(xTitle, yHeader, 0); // X before Y (already the case — proves the parentKey/order write path).

  assert.deepEqual(settings.researchOrder[principaux.path], [x.path, y.path]);
});

/* ===== 7/8. Monter/Descendre, first/last protection ===== */

test("Monter/Descendre reorder two siblings the same way drag-and-drop does", () => {
  const { view, settings } = buildView();
  const a = folder("Projet/_Recherche/A");
  const b = folder("Projet/_Recherche/B");
  const c = folder("Projet/_Recherche/C");
  const container = new FakeElement();
  const parentKey = "research-sections:Projet/_Recherche";
  const siblingKeys = [a.path, b.path, c.path];

  for (const [title, f] of [["A", a], ["B", b], ["C", c]]) {
    view.renderSection(container, title, f, undefined, undefined, undefined, undefined, undefined, { parentKey, key: f.path, siblingKeys });
  }

  const heads = container.findAll((el) => el.classes.has("feuillets-notes-section-head"));
  const headB = heads.find((h) => h.children.some((c) => c.text === "B"));
  const menuBtn = headB.findAll((el) => el.tag === "button")[0];
  menuBtn.dispatch("click", {});

  const menu = Menu.lastShown;
  const moveUp = itemsOf(menu).find((i) => i.title === t("shared.research.moveUp"));
  const moveDown = itemsOf(menu).find((i) => i.title === t("shared.research.moveDown"));
  assert.ok(moveUp && !moveUp.disabled, "B is neither first nor last: Monter must be enabled");
  assert.ok(moveDown && !moveDown.disabled, "B is neither first nor last: Descendre must be enabled");

  moveUp.callback();
  assert.deepEqual(settings.researchOrder[parentKey], [b.path, a.path, c.path]);
});

test("Monter is disabled for the first sibling, Descendre for the last", () => {
  const { view } = buildView();
  const a = folder("Projet/_Recherche/A");
  const b = folder("Projet/_Recherche/B");
  const container = new FakeElement();
  const parentKey = "research-sections:Projet/_Recherche";
  const siblingKeys = [a.path, b.path];

  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined, { parentKey, key: a.path, siblingKeys });
  view.renderSection(container, "B", b, undefined, undefined, undefined, undefined, undefined, { parentKey, key: b.path, siblingKeys });

  const heads = container.findAll((el) => el.classes.has("feuillets-notes-section-head"));
  const headA = heads.find((h) => h.children.some((c) => c.text === "A"));
  const headB = heads.find((h) => h.children.some((c) => c.text === "B"));

  headA.findAll((el) => el.tag === "button")[0].dispatch("click", {});
  const menuA = Menu.lastShown;
  assert.equal(itemsOf(menuA).find((i) => i.title === t("shared.research.moveUp")).disabled, true, "first item: Monter disabled");
  assert.equal(itemsOf(menuA).find((i) => i.title === t("shared.research.moveDown")).disabled, undefined, "first item, not last: Descendre enabled");

  headB.findAll((el) => el.tag === "button")[0].dispatch("click", {});
  const menuB = Menu.lastShown;
  assert.equal(itemsOf(menuB).find((i) => i.title === t("shared.research.moveDown")).disabled, true, "last item: Descendre disabled");
  assert.equal(itemsOf(menuB).find((i) => i.title === t("shared.research.moveUp")).disabled, undefined, "last item, not first: Monter enabled");
});

test("a single item has both Monter and Descendre disabled", () => {
  const { view } = buildView();
  const a = folder("Projet/_Recherche/A");
  const container = new FakeElement();
  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined,
    { parentKey: "p", key: a.path, siblingKeys: [a.path] });

  container.find(".feuillets-notes-section-head").findAll((el) => el.tag === "button")[0].dispatch("click", {});
  const menu = Menu.lastShown;
  assert.equal(itemsOf(menu).find((i) => i.title === t("shared.research.moveUp")).disabled, true);
  assert.equal(itemsOf(menu).find((i) => i.title === t("shared.research.moveDown")).disabled, true);
});

test("without an order context (e.g. a genuinely non-reorderable call), no Monter/Descendre items appear", () => {
  const { view } = buildView();
  const a = folder("Projet/_Recherche/A");
  const container = new FakeElement();
  view.renderSection(container, "A", a);

  container.find(".feuillets-notes-section-head").findAll((el) => el.tag === "button")[0].dispatch("click", {});
  const menu = Menu.lastShown;
  assert.equal(itemsOf(menu).some((i) => i.title === t("shared.research.moveUp")), false);
  assert.equal(itemsOf(menu).some((i) => i.title === t("shared.research.moveDown")), false);
});

/* ===== 9/10/11/12/13. never touches the Vault ===== */

test("reordering never renames, creates, deletes, or otherwise mutates any file or folder", () => {
  const harness = buildView();
  const { view, settings } = harness;
  const a = folder("Projet/_Recherche/A");
  const b = folder("Projet/_Recherche/B");
  const container = new FakeElement();
  const parentKey = "research-sections:Projet/_Recherche";
  const siblingKeys = [a.path, b.path];
  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined, { parentKey, key: a.path, siblingKeys });
  view.renderSection(container, "B", b, undefined, undefined, undefined, undefined, undefined, { parentKey, key: b.path, siblingKeys });

  const titleA = container.findAll((el) => el.classes.has("feuillets-notes-section-title") && el.text === "A")[0];
  const headB = container.findAll((el) => el.classes.has("feuillets-notes-section-head")).find((h) => h.children.some((c) => c.text === "B"));
  simulateOrderDrag(titleA, headB, 0);

  const originalPathA = a.path;
  const originalNameA = a.name;
  assert.equal(a.path, originalPathA, "the folder's real Vault path never changes");
  assert.equal(a.name, originalNameA, "the folder is never renamed");
  assert.deepEqual(harness.renameFileCalls, []);
  assert.deepEqual(harness.createFolderCalls, []);
  assert.deepEqual(harness.createCalls, []);
  assert.deepEqual(harness.createBinaryCalls, []);
  assert.deepEqual(harness.modifyCalls, []);
  assert.deepEqual(harness.trashFileCalls, []);
  assert.deepEqual(harness.processFrontMatterCalls, [], "frontmatter is never touched by a reorder");
  assert.ok(settings.researchOrder[parentKey], "only the settings order map changed");
});

/* ===== 14. files stay excluded from reordering ===== */

test("a Research file never gets a drag handle or reorder menu entries — only folders do", () => {
  const { view } = buildView();
  const main = folder("Projet/_Recherche/Sources");
  const note = new TFile("Projet/_Recherche/Sources/Note.md");
  main.children = [note];
  note.parent = main;
  const container = new FakeElement();

  view.renderSection(container, "Sources", main);

  const fileName = container.findAll((el) => el.classes.has("feuillets-research-item-name") && el.text === "Note")[0];
  assert.ok(fileName, "the file row must still render");
  assert.equal(fileName.draggable, false, "a file's name must never become draggable for reordering");
  assert.equal(fileName.hasClass("feuillets-research-order-handle"), false);
});

/* ===== 15. existing file drag-and-drop keeps working, fully isolated ===== */

test("a reorder drag never sets _researchDragPath (the file-move mechanism's own state), and vice versa", () => {
  const { view, plugin } = buildView();
  const a = folder("Projet/_Recherche/A");
  const b = folder("Projet/_Recherche/B");
  const container = new FakeElement();
  const parentKey = "p";
  const siblingKeys = [a.path, b.path];
  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined, { parentKey, key: a.path, siblingKeys });
  view.renderSection(container, "B", b, undefined, undefined, undefined, undefined, undefined, { parentKey, key: b.path, siblingKeys });

  const titleA = container.findAll((el) => el.classes.has("feuillets-notes-section-title") && el.text === "A")[0];
  const dt = fakeDataTransfer();
  titleA.dispatch("dragstart", { dataTransfer: dt });

  assert.equal(plugin._researchDragPath, undefined, "a reorder drag must never populate the file-move drag state");
  assert.ok(dt.hasType(RESEARCH_ORDER_DRAG_MIME), "the reorder drag uses its own dedicated MIME");
  assert.equal(dt.hasType("application/x-feuillets-file"), false);
  assert.equal(dt.hasType("text/plain"), false, "a space's title never carries a wiki-link payload");
});

test("the existing file/subfolder move drag-and-drop is untouched: it still sets _researchDragPath, never _researchOrderDrag", () => {
  const { view, plugin } = buildView();
  const file = new TFile("Projet/_Recherche/Sources/Note.md");
  const row = new FakeElement();
  view.attachResearchDragSource(row, file);
  const dt = fakeDataTransfer();
  row.dispatch("dragstart", { dataTransfer: dt });

  assert.equal(plugin._researchDragPath, file.path);
  assert.equal(plugin._researchOrderDrag, undefined, "the existing move mechanism must never touch the reorder drag state");
  assert.ok(dt.hasType("application/x-feuillets-file"));
  assert.equal(dt.hasType(RESEARCH_ORDER_DRAG_MIME), false);
});

/* ===== 16. Binder / compile order stays untouched ===== */

test("reordering Research spaces/folders never writes to settings.orders (the Binder's own order map)", () => {
  const harness = buildView();
  const { view, settings } = harness;
  settings.orders["Projet/Manuscrit"] = ["Chapitre 1", "Chapitre 2"];
  const bindersOrdersSnapshot = JSON.parse(JSON.stringify(settings.orders));

  const a = folder("Projet/_Recherche/A");
  const b = folder("Projet/_Recherche/B");
  const container = new FakeElement();
  const parentKey = "research-sections:Projet/_Recherche";
  const siblingKeys = [a.path, b.path];
  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined, { parentKey, key: a.path, siblingKeys });
  view.renderSection(container, "B", b, undefined, undefined, undefined, undefined, undefined, { parentKey, key: b.path, siblingKeys });
  const titleA = container.findAll((el) => el.classes.has("feuillets-notes-section-title") && el.text === "A")[0];
  const headB = container.findAll((el) => el.classes.has("feuillets-notes-section-head")).find((h) => h.children.some((c) => c.text === "B"));
  simulateOrderDrag(titleA, headB, 1);

  // Also exercise Monter/Descendre, same guarantee.
  headB.findAll((el) => el.tag === "button")[0].dispatch("click", {});
  const moveUp = itemsOf(Menu.lastShown).find((i) => i.title === t("shared.research.moveUp"));
  moveUp.callback();

  assert.deepEqual(settings.orders, bindersOrdersSnapshot, "the Binder's own order map must be byte-for-byte unchanged");
  assert.ok(settings.researchOrder[parentKey], "only researchOrder — a fully separate map — changed");
});

/* ===== 18. visual before/after insertion indicators ===== */

test("dragover on the top half shows the \"before\" indicator, the bottom half shows \"after\", never both", () => {
  const { view } = buildView();
  const a = folder("Projet/_Recherche/A");
  const b = folder("Projet/_Recherche/B");
  const container = new FakeElement();
  const parentKey = "p";
  const siblingKeys = [a.path, b.path];
  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined, { parentKey, key: a.path, siblingKeys });
  view.renderSection(container, "B", b, undefined, undefined, undefined, undefined, undefined, { parentKey, key: b.path, siblingKeys });

  const titleA = container.findAll((el) => el.classes.has("feuillets-notes-section-title") && el.text === "A")[0];
  const headB = container.findAll((el) => el.classes.has("feuillets-notes-section-head")).find((h) => h.children.some((c) => c.text === "B"));
  headB.rect = { top: 0, height: 24 };

  const dt = fakeDataTransfer();
  titleA.dispatch("dragstart", { dataTransfer: dt });

  headB.dispatch("dragover", { dataTransfer: dt, clientY: 2 });
  assert.equal(headB.hasClass("feuillets-research-order-drop-before"), true);
  assert.equal(headB.hasClass("feuillets-research-order-drop-after"), false);

  headB.dispatch("dragover", { dataTransfer: dt, clientY: 22 });
  assert.equal(headB.hasClass("feuillets-research-order-drop-before"), false);
  assert.equal(headB.hasClass("feuillets-research-order-drop-after"), true);

  headB.dispatch("dragleave", { relatedTarget: null });
  assert.equal(headB.hasClass("feuillets-research-order-drop-before"), false);
  assert.equal(headB.hasClass("feuillets-research-order-drop-after"), false);
});

test("the drop indicator is cleared after a completed drop", () => {
  const { view } = buildView();
  const a = folder("Projet/_Recherche/A");
  const b = folder("Projet/_Recherche/B");
  const container = new FakeElement();
  const parentKey = "p";
  const siblingKeys = [a.path, b.path];
  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined, { parentKey, key: a.path, siblingKeys });
  view.renderSection(container, "B", b, undefined, undefined, undefined, undefined, undefined, { parentKey, key: b.path, siblingKeys });
  const titleA = container.findAll((el) => el.classes.has("feuillets-notes-section-title") && el.text === "A")[0];
  const headB = container.findAll((el) => el.classes.has("feuillets-notes-section-head")).find((h) => h.children.some((c) => c.text === "B"));

  simulateOrderDrag(titleA, headB, 0);

  assert.equal(headB.hasClass("feuillets-research-order-drop-before"), false);
  assert.equal(headB.hasClass("feuillets-research-order-drop-after"), false);
});

/* ===== 19. collapse/expand state preserved across a reorder ===== */

test("a reorder never touches settings.collapsed — expand/collapse state survives untouched", () => {
  const { view, settings } = buildView();
  const a = folder("Projet/_Recherche/A");
  const b = folder("Projet/_Recherche/B");
  settings.collapsed[b.path] = true;
  const collapsedSnapshot = { ...settings.collapsed };
  const container = new FakeElement();
  const parentKey = "p";
  const siblingKeys = [a.path, b.path];
  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined, { parentKey, key: a.path, siblingKeys });
  // B is collapsed: renderSection still renders its head + order handle even collapsed.
  view.renderSection(container, "B", b, undefined, undefined, undefined, undefined, undefined, { parentKey, key: b.path, siblingKeys });

  const titleA = container.findAll((el) => el.classes.has("feuillets-notes-section-title") && el.text === "A")[0];
  const headB = container.findAll((el) => el.classes.has("feuillets-notes-section-head")).find((h) => h.children.some((c) => c.text === "B"));
  simulateOrderDrag(titleA, headB, 0);

  assert.deepEqual(settings.collapsed, collapsedSnapshot);
});

/* ===== presence in the generic "..." menu ===== */

test("the generic \"...\" menu keeps its existing entries alongside Monter/Descendre — nothing is replaced", () => {
  const { view } = buildView();
  const a = folder("Projet/_Recherche/A");
  const container = new FakeElement();
  view.renderSection(container, "A", a, undefined, undefined, undefined, undefined, undefined,
    { parentKey: "p", key: a.path, siblingKeys: [a.path] });

  container.find(".feuillets-notes-section-head").findAll((el) => el.tag === "button")[0].dispatch("click", {});
  const titles = itemsOf(Menu.lastShown).map((i) => i.title);
  assert.ok(titles.includes(t("binder.newSubfolder")));
  assert.ok(titles.includes(t("shared.contextMenu.rename")));
  assert.ok(titles.includes(t("shared.contextMenu.trashFolder")));
  assert.ok(titles.includes(t("shared.research.moveUp")));
  assert.ok(titles.includes(t("shared.research.moveDown")));
});
