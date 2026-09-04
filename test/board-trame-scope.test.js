import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { BoardView } from "../src/views/board-view.js";

globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
};

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set((options.cls || "").split(" ").filter(Boolean));
    this.text = options.text || "";
    this.events = new Map();
    this.style = { setProperty: () => {} };
  }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(value) { value.split(" ").forEach((name) => this.classes.add(name)); }
  setAttr() {}
  setText(value) { this.text = String(value); return this; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  querySelectorAll(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    return all(this, (element) => element.classes.has(className));
  }
  async trigger(type, event = {}) {
    await this.events.get(type)?.({ preventDefault: () => {}, stopPropagation: () => {}, ...event });
  }
}

function all(element, predicate) {
  return element.children.flatMap((child) => [ ...(predicate(child) ? [child] : []), ...all(child, predicate) ]);
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function file(path, role = "scene", frontmatter = {}) {
  const value = new TFile(path);
  value.__role = role;
  value.__fm = frontmatter;
  return value;
}

function buildView(root, settings = {}) {
  const plugin = {
    settings: {
      arcsShowSynopsis: false,
      arcsShowPov: false,
      arcsShowCharacters: false,
      arcsShowThreads: false,
      ...settings,
    },
    getProjectFolder: () => root,
    getOrderedChildren: (value) => value.children,
    roleOfFolder: () => "partie",
    roleOfFile: (value) => value.__role,
    isFrontMatter: () => false,
    labelsOf: () => [],
    fmOf: (value) => value.__fm,
    shortTitleFor: (value) => value.basename,
    labelColor: () => "",
    saveSettings: async () => {},
  };
  const view = new BoardView({ app: {}, contentEl: new FakeElement() }, plugin);
  view.render = async () => {};
  return { view, plugin };
}

function visibleTexts(container) {
  return all(container, (element) => element.text !== "").map((element) => element.text);
}

test("Trame locale — le renderer reçoit une branche et exclut ses frères", () => {
  const partA = folder("Projet/Manuscrit/Partie A", [file("Projet/Manuscrit/Partie A/A.md")]);
  const partB = folder("Projet/Manuscrit/Partie B", [file("Projet/Manuscrit/Partie B/B.md")]);
  const root = folder("Projet/Manuscrit", [partA, partB]);
  const { view } = buildView(root);
  const container = new FakeElement();
  view.renderCheminDeFer(container, partB, new Map([[partB.path, "8"]]));
  const texts = visibleTexts(container);
  assert.ok(texts.includes("B"));
  assert.equal(texts.includes("Partie A"), false);
  assert.equal(texts.includes("A"), false);
});

test("Trame — le double-clic du titre d'un dossier focalise le vrai TFolder", async () => {
  const partB = folder("Projet/Manuscrit/Partie B", [file("Projet/Manuscrit/Partie B/B.md")]);
  const root = folder("Projet/Manuscrit", [partB]);
  const { view, plugin } = buildView(root);
  view.plugin.settings.projectMeta = { [root.path]: {} };
  let renders = 0;
  view.render = async () => { renders += 1; };
  const container = new FakeElement();
  view.renderCheminDeFer(container, root, new Map());
  const title = all(container, (element) => element.classes.has("feuillets-arcs-folder-title"))[0];
  await title.trigger("dblclick");
  assert.equal(view.focusedFolderPath, partB.path);
  assert.equal(plugin.settings.boardWholeManuscript, false);
  assert.equal(plugin.settings.projectMeta[root.path].boardWholeManuscript, false);
  assert.equal(renders, 1);
});
