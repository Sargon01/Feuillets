import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
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
  createEl(_tag, options = {}) { const child = new FakeElement(options); this.children.push(child); return child; }
  addEventListener() {}
  setText(value) { this.text = String(value); return this; }
  hide() {}
  show() {}
  focus() {}
  remove() {}
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function file(path, date) {
  const value = new TFile(path);
  value.__fm = { date };
  return value;
}

function buildView(root, researchRoot, links = new Map()) {
  const settings = { timelineOrder: "chrono", timelineTagFilter: "", timelineScale: "aucune" };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getOrderedChildren: (current) => current.children,
    getLinkedResearchFolder: (node) => links.get(node.path) || null,
    getChronoFolder: () => researchRoot,
    flattenFiles: (current) => {
      const result = [];
      const visit = (folderValue) => {
        for (const child of folderValue.children) {
          if (child instanceof TFolder) visit(child);
          else result.push(child);
        }
      };
      visit(current);
      return result;
    },
    isFrontMatter: () => false,
    fmOf: (target) => target.__fm || {},
    tagsOf: (target) => target.__tags || [],
    shortTitleFor: (target) => target.basename,
  };
  const view = new BoardView({ app: { workspace: { getLeaf: () => ({}) } }, contentEl: new FakeElement() }, plugin);
  view.passesFilter = () => true;
  view.makeClickToEditFmArea = () => new FakeElement();
  view.setFm = async () => {};
  return { view, plugin };
}

function texts(element) {
  return [element.text, ...element.children.flatMap((child) => texts(child))].filter(Boolean);
}

test("Research local — parcours Binder ordonné, dossier courant et fichier descendant", () => {
  const researchA = folder("Recherche/A");
  const researchB = folder("Recherche/B");
  const scene = file("Projet/Manuscrit/Partie II/Chapitre 3/Scene.md", "1992-01-01");
  const chapter = folder("Projet/Manuscrit/Partie II/Chapitre 3", [scene]);
  const part = folder("Projet/Manuscrit/Partie II", [chapter]);
  const root = folder("Projet/Manuscrit", [folder("Projet/Manuscrit/Partie I"), part]);
  const links = new Map([[part.path, researchA], [chapter.path, researchB], [scene.path, researchA]]);
  const { view } = buildView(root, folder("Recherche/Global"), links);
  assert.deepEqual(view.collectLinkedResearchFolders(part), [researchA, researchB]);
});

test("Research local — ancêtre, branche sœur et fallback global exclus", () => {
  const researchParent = folder("Recherche/Parent");
  const researchSibling = folder("Recherche/Sibling");
  const partA = folder("Projet/Manuscrit/Partie I");
  const partB = folder("Projet/Manuscrit/Partie II", [folder("Projet/Manuscrit/Partie II/Chapitre 3")]);
  const root = folder("Projet/Manuscrit", [partA, partB]);
  const links = new Map([[root.path, researchParent], [partA.path, researchSibling]]);
  const { view } = buildView(root, folder("Recherche/Global"), links);
  assert.deepEqual(view.collectLinkedResearchFolders(partB), []);
});

test("Research Timeline — global utilise la source historique unique", () => {
  const root = folder("Projet/Manuscrit", [file("Projet/Manuscrit/Scene.md", "1990-01-01")]);
  const global = folder("Recherche/Global", [file("Recherche/Global/Milestone.md", "1991-01-01")]);
  const { view } = buildView(root, global);
  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map(), [global]);
  assert.ok(texts(container).includes("Milestone"));
});

test("Research Timeline — plusieurs sources et fichier chevauché sans doublon", () => {
  const root = folder("Projet/Manuscrit");
  const nestedFile = file("Recherche/A/Sub/Milestone.md", "1991-01-01");
  const sub = folder("Recherche/A/Sub", [nestedFile]);
  const researchA = folder("Recherche/A", [sub]);
  const { view } = buildView(root, null);
  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map(), [researchA, sub]);
  assert.equal(texts(container).filter((value) => value === "Milestone").length, 1);
});

test("Research Timeline — source locale vide sans fallback global", () => {
  const root = folder("Projet/Manuscrit");
  const global = folder("Recherche/Global", [file("Recherche/Global/GlobalMilestone.md", "1991-01-01")]);
  const { view } = buildView(root, global);
  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map(), []);
  assert.equal(texts(container).includes("GlobalMilestone"), false);
});
