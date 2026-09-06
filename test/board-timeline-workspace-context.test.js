import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { BoardView } from "../src/views/board-view.js";

class FakeElement {
  constructor() { this.children = []; this.style = {}; }
  createDiv() { const child = new FakeElement(); this.children.push(child); return child; }
  createSpan() { return this.createDiv(); }
  createEl() { return this.createDiv(); }
  addEventListener() {}
  empty() { this.children = []; }
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function file(path) { return new TFile(path); }

function buildView({ root, researchRoot, links, projectLinks, extraFolders = [] }) {
  const folders = new Map();
  const register = (node) => {
    folders.set(node.path, node);
    if (node instanceof TFolder) for (const child of node.children) register(child);
  };
  register(root);
  for (const node of [researchRoot, ...links.values(), ...extraFolders]) {
    if (node instanceof TFolder) register(node);
  }
  const settings = {
    projectFolder: root.path,
    projectMeta: { [root.path]: { researchFolderLinks: Object.fromEntries(projectLinks) } },
    timelineOrder: "chrono",
    timelineTagFilter: "",
    timelineScale: "aucune",
  };
  const app = { vault: { getAbstractFileByPath: (path) => folders.get(path) || null } };
  const plugin = {
    settings,
    getChronoFolder: () => researchRoot,
    getLinkedResearchFolder: (node) => links.get(node.path) || null,
    getOrderedChildren: (current) => current.children,
    getProjectFolder: () => root,
  };
  const view = new BoardView({ app, contentEl: new FakeElement() }, plugin);
  return view;
}

test("Timeline workspace — global only when wholeManuscript is enabled", () => {
  const root = folder("Projet/Manuscrit", [folder("Projet/Manuscrit/Roman")]);
  const chronology = folder("Projet/Chronologie");
  const local = folder("Projet/Recherche/Local");
  const view = buildView({
    root,
    researchRoot: chronology,
    links: new Map(),
    projectLinks: new Map([["Projet/Manuscrit/Roman", local.path]]),
  });
  assert.deepEqual(view.resolveTimelineResearchFolders(true, root.children[0], root.children[0]), [chronology]);
});

test("Timeline workspace — sans workspace conserve la collecte F1 locale", () => {
  const linked = folder("Projet/Recherche/Direct");
  const scene = file("Projet/Manuscrit/Roman/Scene.md");
  const current = folder("Projet/Manuscrit/Roman", [scene]);
  const root = folder("Projet/Manuscrit", [current]);
  const chronology = folder("Projet/Chronologie");
  const view = buildView({ root, researchRoot: chronology, links: new Map([[scene.path, linked]]), projectLinks: new Map() });
  assert.deepEqual(view.resolveTimelineResearchFolders(false, current, null), [linked]);
});

test("Timeline workspace — sources globales, héritées et TFile sont dédupliquées physiquement", () => {
  const exactWorkspace = folder("Projet/Manuscrit/Roman", [
    folder("Projet/Manuscrit/Roman/Chapitre", [
      file("Projet/Manuscrit/Roman/Chapitre/Scene.md"),
      file("Projet/Manuscrit/Roman/Chapitre/Other.md"),
    ]),
  ]);
  const sibling = folder("Projet/Manuscrit/Cours", [file("Projet/Manuscrit/Cours/Scene.md")]);
  const root = folder("Projet/Manuscrit", [exactWorkspace, sibling]);
  const chronology = folder("Projet/Chronologie");
  const effective = folder("Projet/Recherche/Roman");
  const nested = folder("Projet/Recherche/Roman/Feuille");
  const external = folder("Projet/Recherche/Externe");
  const links = new Map([
    ["Projet/Manuscrit/Roman/Chapitre/Scene.md", nested],
    ["Projet/Manuscrit/Roman/Chapitre/Other.md", external],
    ["Projet/Manuscrit/Cours/Scene.md", folder("Projet/Recherche/Frere")],
  ]);
  const projectLinks = new Map([
    ["Projet/Manuscrit/Roman", effective.path],
  ]);
  const view = buildView({ root, researchRoot: chronology, links, projectLinks, extraFolders: [effective, nested, external] });
  const result = view.resolveTimelineResearchFolders(false, exactWorkspace, exactWorkspace);
  assert.deepEqual(result.map((value) => value.path), [
    chronology.path,
    effective.path,
    external.path,
  ]);
  assert.equal(result.includes(nested), false, "un lien TFile descendant ne crée pas une seconde racine");
  assert.equal(result.some((value) => value.path.endsWith("Frere")), false, "le workspace frère est exclu");
});

test("Timeline workspace — sans lien local, la résolution 6A conserve le fallback Recherche projet", () => {
  const workspace = folder("Projet/Manuscrit/Roman");
  const root = folder("Projet/Manuscrit", [workspace]);
  const chronology = folder("Projet/Chronologie");
  const projectResearch = folder("Projet/Manuscrit/_Recherche");
  const view = buildView({ root, researchRoot: chronology, links: new Map(), projectLinks: new Map(), extraFolders: [projectResearch] });
  const result = view.resolveTimelineResearchFolders(false, workspace, workspace);
  assert.deepEqual(result.map((value) => value.path), [chronology.path]);
});

test("Timeline workspace — le fallback Recherche projet ne fuit pas la Chronologie d'un espace frère", () => {
  const partOneResearch = folder("Projet/Manuscrit/_Recherche/Partie 1", [folder("Projet/Manuscrit/_Recherche/Partie 1/Chronologie")]);
  const projectResearch = folder("Projet/Manuscrit/_Recherche", [partOneResearch]);
  const partTwo = folder("Projet/Manuscrit/Partie 2");
  const root = folder("Projet/Manuscrit", [partTwo]);
  const chronology = folder("Projet/Chronologie");
  const view = buildView({
    root,
    researchRoot: chronology,
    links: new Map(),
    projectLinks: new Map(),
    extraFolders: [projectResearch, partOneResearch, partOneResearch.children[0]],
  });

  const result = view.resolveTimelineResearchFolders(false, partTwo, partTwo);
  assert.deepEqual(result.map((value) => value.path), [chronology.path]);
  assert.equal(result.some((value) => value.path.includes("Partie 1")), false);
});
