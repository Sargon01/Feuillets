import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { BoardView } from "../src/views/board-view.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set((options.cls || "").split(" ").filter(Boolean));
    this.text = options.text || "";
    this.style = { setProperty: () => {} };
  }
  createDiv(options = {}) { const child = new FakeElement(options); this.children.push(child); return child; }
  createSpan(options = {}) { return this.createDiv(options); }
  addEventListener() {}
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function file(path) {
  const value = new TFile(path);
  value.__fm = {};
  return value;
}

function buildView(root, flattenFiles) {
  const plugin = {
    settings: {},
    flattenFiles,
    isFrontMatter: () => false,
    fmOf: (value) => value.__fm || {},
    shortTitleFor: (value) => value.basename,
    saveSettings: async () => {},
  };
  const view = new BoardView({ app: {}, contentEl: new FakeElement() }, plugin);
  view.renderLanesAxisBar = () => {};
  view.ensureLaneRegistry = () => {};
  view.axisValuesOf = () => [];
  view.lanesNoValueLabel = () => "Sans valeur";
  view.renderLaneRow = () => {};
  view.render = async () => {};
  return { view, plugin, root };
}

function menuTitles(menu) {
  return menu.items.filter((item) => !item.separator).map((item) => item.title);
}

test("Couloirs — les options de scope sont disponibles", () => {
  const root = folder("Projet/Manuscrit");
  const { view } = buildView(root, () => []);
  const menu = new Menu();
  view.narrativeSubview = "lanes";
  view.buildModeOptionsMenu(menu, "arcs", {
    S: view.plugin.settings,
    meta: {},
    pType: "fiction",
    wholeManuscript: false,
    outlineColumns: {},
  });
  assert.ok(menuTitles(menu).includes("Dossier par dossier"));
  assert.ok(menuTitles(menu).includes("Tout le manuscrit"));
});

test("Couloirs — le scope local exclut les branches sœurs", () => {
  const partA = folder("Projet/Manuscrit/Partie I", [file("Projet/Manuscrit/Partie I/A.md")]);
  const partB = folder("Projet/Manuscrit/Partie II", [file("Projet/Manuscrit/Partie II/B.md")]);
  const root = folder("Projet/Manuscrit", [partA, partB]);
  const seen = [];
  const { view } = buildView(root, (scope) => {
    seen.push(scope);
    return scope === partB ? partB.children : [partA.children[0], partB.children[0]];
  });
  let breadcrumb = null;
  view.renderBreadcrumbs = (...args) => { breadcrumb = args; };
  view.renderCouloirs(new FakeElement(), root, partB, false, new Map());
  assert.equal(seen[0], partB);
  assert.equal(breadcrumb[1], root);
  assert.equal(breadcrumb[2], partB);
});

test("Couloirs — le scope global utilise la racine et aucun breadcrumb local", () => {
  const part = folder("Projet/Manuscrit/Partie II", [file("Projet/Manuscrit/Partie II/B.md")]);
  const root = folder("Projet/Manuscrit", [part]);
  const seen = [];
  const { view } = buildView(root, (scope) => { seen.push(scope); return part.children; });
  let breadcrumbCalls = 0;
  view.renderBreadcrumbs = () => { breadcrumbCalls += 1; };
  view.renderCouloirs(new FakeElement(), root, part, true, new Map());
  assert.equal(seen[0], root);
  assert.equal(breadcrumbCalls, 0);
});

test("Couloirs — le numbering transmis reste global en scope local", () => {
  const part = folder("Projet/Manuscrit/Partie II", [file("Projet/Manuscrit/Partie II/B.md")]);
  const root = folder("Projet/Manuscrit", [folder("Projet/Manuscrit/Partie I"), part]);
  const numbering = new Map([[part.children[0].path, "3"]]);
  const { view } = buildView(root, (scope) => scope === part ? part.children : []);
  const received = [];
  view.renderLaneRow = (...args) => { received.push(args[5]); };
  view.renderCouloirs(new FakeElement(), root, part, false, numbering);
  assert.ok(received.length > 0);
  assert.ok(received.every((value) => value === numbering));
});
