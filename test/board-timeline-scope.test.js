import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { BoardView } from "../src/views/board-view.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.text = options.text || "";
    this.classes = new Set((options.cls || "").split(" ").filter(Boolean));
    this.style = { removeProperty: () => {} };
  }
  createDiv(options = {}) { const child = new FakeElement(options); this.children.push(child); return child; }
  createSpan(options = {}) { return this.createDiv(options); }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    child.value = "";
    this.children.push(child);
    return child;
  }
  addEventListener() {}
  hide() {}
  show() {}
  remove() {}
  focus() {}
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function datedFile(path, date) {
  const value = new TFile(path);
  value.__fm = { date };
  return value;
}

function texts(element) {
  return [element.text, ...element.children.flatMap((child) => texts(child))].filter(Boolean);
}

function buildView(root, flattenFiles, chronoFolder = null) {
  const settings = { timelineOrder: "chrono", timelineTagFilter: "", timelineScale: "aucune" };
  const plugin = {
    settings,
    flattenFiles,
    getChronoFolder: () => chronoFolder,
    tagsOf: () => [],
    isFrontMatter: () => false,
    fmOf: (file) => file.__fm || {},
    shortTitleFor: (file) => file.basename,
    getProjectFolder: () => root,
  };
  const view = new BoardView({ app: {}, contentEl: new FakeElement() }, plugin);
  view.passesFilter = () => true;
  view.makeClickToEditFmArea = () => new FakeElement();
  view.setFm = async () => {};
  view.render = async () => {};
  return { view, plugin };
}

function menuTitles(menu) {
  return menu.items.filter((item) => !item.separator).map((item) => item.title);
}

test("Timeline — le menu de scope conserve les options Timeline historiques", () => {
  const root = folder("Projet/Manuscrit");
  const { view } = buildView(root, () => []);
  const menu = new Menu();
  view.buildModeOptionsMenu(menu, "timeline", {
    S: view.plugin.settings,
    meta: {},
    pType: "fiction",
    wholeManuscript: false,
    outlineColumns: {},
  });
  const titles = menuTitles(menu);
  assert.ok(titles.includes("Dossier par dossier"));
  assert.ok(titles.includes("Tout le manuscrit"));
  assert.ok(titles.includes("Ordre chronologique"));
  assert.ok(titles.includes("Ordre narratif"));
  assert.ok(titles.includes("Échelle : siècle"));
  assert.ok(titles.indexOf("Dossier par dossier") < titles.indexOf("Ordre chronologique"));
});

test("Timeline — global et local transmettent le dossier d'affichage", () => {
  const partB = folder("Projet/Manuscrit/Partie II");
  const root = folder("Projet/Manuscrit", [folder("Projet/Manuscrit/Partie I"), partB]);
  const { view } = buildView(root, () => []);
  const received = [];
  view.renderTimelineInner = (_container, folderValue) => { received.push(folderValue); };
  view.renderTimeline(new FakeElement(), root, new Map());
  view.renderTimeline(new FakeElement(), partB, new Map());
  assert.deepEqual(received, [root, partB]);
});

test("Timeline locale — les feuillets s'arrêtent au scope mais Research reste global", () => {
  const partA = folder("Projet/Manuscrit/Partie I", [datedFile("Projet/Manuscrit/Partie I/A.md", "1990-01-01")]);
  const partB = folder("Projet/Manuscrit/Partie II", [datedFile("Projet/Manuscrit/Partie II/B.md", "1991-01-01")]);
  const root = folder("Projet/Manuscrit", [partA, partB]);
  const research = folder("Projet/Recherche", [datedFile("Projet/Recherche/Milestone.md", "1992-01-01")]);
  const { view } = buildView(root, (scope) => scope === partB ? partB.children : [], research);
  const container = new FakeElement();
  view.renderTimeline(container, partB, new Map());
  const rendered = texts(container);
  assert.ok(rendered.includes("B"));
  assert.ok(rendered.includes("Milestone"));
  assert.equal(rendered.includes("A"), false);
});
