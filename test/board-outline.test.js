import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { renderBoardOutline } from "../src/views/board-outline.js";

globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
};

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set((options.cls || "").split(" ").filter(Boolean));
    this.attributes = {};
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.events = new Map();
    this.text = options.text || "";
    this.parentNode = null;
  }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); child.parentNode = this; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(value) { value.split(" ").forEach((name) => this.classes.add(name)); }
  setAttr(key, value) { this.attributes[key] = value; }
  setText(value) { this.text = String(value); return this; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  async trigger(type, event = {}) { await this.events.get(type)?.({ preventDefault: () => {}, stopPropagation: () => {}, ...event }); }
}

function all(element, predicate) {
  return element.children.flatMap((child) => [ ...(predicate(child) ? [child] : []), ...all(child, predicate) ]);
}

function makeContext(root, settings = {}) {
  return {
    settings: { outlineCols: { title: true }, outlineWidths: {}, collapsed: {}, ...settings },
    outlineColumns: { title: true },
    outlineSortColumn: null,
    outlineSortDirection: null,
    numbering: new Map([["Projet/Manuscrit/Partie A/A1.md", "8"]]),
    wcMap: new Map(),
    projectType: "fiction",
    generation: 1,
    isCurrentGeneration: () => true,
    getOrderedChildren: (folder) => folder.children,
    isFrontMatter: () => false,
    passesFilter: (file) => !file.filtered,
    fm: (file) => file.__fm || {},
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    tagsOf: () => [],
    saveSettings: async () => {},
    rerender: () => {},
    onFocusFolder: () => {},
    cycleSort: () => {},
    attachColumnResize: () => {},
    isMultiSelected: () => false,
    isEditableContextTarget: () => false,
    showFileContextMenu: () => {},
    showFolderContextMenu: () => {},
    attachDragHandlers: () => {},
    handleMultiSelectClick: () => false,
    beginInlineShortTitleEdit: () => {},
    openFile: () => {},
    makeClickToEditFmArea: (parent, file, key, placeholder) => parent.createDiv({ cls: `feuillets-cell-${key}`, text: placeholder }),
    makeClickToEditFmList: (parent, file, key) => parent.createDiv({ cls: `feuillets-cell-${key}` }),
    makeTagsEditor: () => {},
    makeLabelSelect: () => {},
    makeStatusSelect: () => {},
    makeGoalInput: (parent) => parent.createEl("input"),
    fillRing: () => {},
    root,
  };
}

async function render(root, scopeFolder = root, contextSettings = {}) {
  const container = new FakeElement();
  await renderBoardOutline(container, scopeFolder, makeContext(root, contextSettings), () => {});
  return container;
}

function folder(path, children = []) { const value = new TFolder(path); value.children = children; return value; }
function file(path) { return new TFile(path); }
function names(container) { return all(container, (element) => element.classes.has("feuillets-title-text") || element.classes.has("feuillets-folder-name")).map((element) => element.text); }

test("Board outline — racine affiche toutes les branches", async () => {
  const root = folder("Projet/Manuscrit", [folder("Projet/Manuscrit/Partie A"), folder("Projet/Manuscrit/Partie B")]);
  assert.deepEqual(names(await render(root)), ["Partie A", "Partie B"]);
});

test("Board outline — scope local exclut les frères", async () => {
  const partA = folder("Projet/Manuscrit/Partie A", [file("Projet/Manuscrit/Partie A/A1.md"), file("Projet/Manuscrit/Partie A/A2.md")]);
  const partB = folder("Projet/Manuscrit/Partie B", [file("Projet/Manuscrit/Partie B/B1.md")]);
  const root = folder("Projet/Manuscrit", [partA, partB]);
  assert.deepEqual(names(await render(root, partA)), ["A1", "A2"]);
});

test("Board outline — scope imbriqué exclut les parents et frères", async () => {
  const chapterA1 = folder("Projet/Manuscrit/Partie A/Chapitre A1", [file("Projet/Manuscrit/Partie A/Chapitre A1/Scene.md")]);
  const partA = folder("Projet/Manuscrit/Partie A", [chapterA1, folder("Projet/Manuscrit/Partie A/Chapitre A2", [file("Projet/Manuscrit/Partie A/Chapitre A2/Other.md")])]);
  const root = folder("Projet/Manuscrit", [partA]);
  assert.deepEqual(names(await render(root, chapterA1)), ["Scene"]);
});

test("Board outline — tri actif reste limité au scope", async () => {
  const partA = folder("Projet/Manuscrit/Partie A", [file("Projet/Manuscrit/Partie A/Z.md"), file("Projet/Manuscrit/Partie A/A.md")]);
  const root = folder("Projet/Manuscrit", [partA, file("Projet/Manuscrit/B.md")]);
  const context = makeContext(root);
  context.outlineSortColumn = "title";
  context.outlineSortDirection = "asc";
  const container = new FakeElement();
  await renderBoardOutline(container, partA, context, () => {});
  assert.deepEqual(names(container), ["A", "Z"]);
});

test("Board outline — filtre reste limité au scope", async () => {
  const visible = file("Projet/Manuscrit/Partie A/visible.md");
  const filtered = file("Projet/Manuscrit/Partie A/filtered.md");
  filtered.filtered = true;
  const partA = folder("Projet/Manuscrit/Partie A", [visible, filtered]);
  const root = folder("Projet/Manuscrit", [partA, file("Projet/Manuscrit/Partie B/outside.md")]);
  assert.deepEqual(names(await render(root, partA)), ["visible"]);
});

test("Board outline — DOM principal et self-file restent uniques", async () => {
  const self = file("Projet/Manuscrit/Partie A.md");
  const scope = folder("Projet/Manuscrit/Partie A", [self]);
  const root = folder("Projet/Manuscrit", [scope]);
  const container = await render(root, scope);
  assert.equal(all(container, (element) => element.classes.has("feuillets-outline")).length, 1);
  assert.equal(all(container, (element) => element.classes.has("feuillets-row-head")).length, 1);
  assert.equal(names(container).filter((name) => name === "Partie A").length, 1);
});

test("Board outline — le double-clic du nom demande sa focalisation sans collapse", async () => {
  const child = folder("Projet/Manuscrit/Partie A");
  const root = folder("Projet/Manuscrit", [child]);
  const context = makeContext(root);
  let focused = null;
  let collapsed = false;
  context.onFocusFolder = (value) => { focused = value; };
  context.saveSettings = async () => { collapsed = true; };
  const container = new FakeElement();
  await renderBoardOutline(container, root, context, () => {});
  const folderName = all(container, (element) => element.classes.has("feuillets-folder-name"))[0];
  assert.ok(folderName);
  await folderName.trigger("dblclick");
  assert.equal(focused, child);
  assert.equal(collapsed, false);
});

test("Board outline — le clic simple plie et demande le rerender", async () => {
  const child = folder("Projet/Manuscrit/Partie A");
  const root = folder("Projet/Manuscrit", [child]);
  const context = makeContext(root);
  const calls = [];
  context.saveSettings = async () => { calls.push("save"); };
  context.rerender = () => { calls.push("render"); };
  const container = new FakeElement();
  await renderBoardOutline(container, root, context, () => {});
  const titleCell = all(container, (element) => element.classes.has("feuillets-cell-title"))[0];
  await titleCell.trigger("click");
  assert.equal(context.settings.collapsed[child.path], true);
  assert.deepEqual(calls, ["save", "render"]);
});

test("Board outline — aucune action folder-open dédiée n'est rendue", async () => {
  const child = folder("Projet/Manuscrit/Partie A");
  const root = folder("Projet/Manuscrit", [child]);
  const container = await render(root);
  assert.equal(all(container, (element) => element.attributes["aria-label"] === "folder-open").length, 0);
  assert.equal(all(container, (element) => element.classes.has("clickable-icon")).length, 0);
});
