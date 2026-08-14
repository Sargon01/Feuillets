import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { CompareFilesModal, PickFileModal } from "../src/ui/diff-modal.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    this.value = "";
    this.style = {};
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }

  createDiv(options = {}) {
    return this.createEl("div", options);
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  addClass(classNames) {
    for (const className of classNames.split(" ")) this.classes.add(className);
  }

  setText(text) {
    this.text = String(text);
    return this;
  }

  setAttr() {}

  addEventListener(type, callback) {
    this.events.set(type, callback);
  }

  empty() {
    this.children = [];
    this.buttonComponents = [];
  }

  focus() {}

  remove() {
    this.removed = true;
  }
}

function elements(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...elements(child, predicate));
  }
  return found;
}

function textContent(element) {
  return [element.text, ...element.children.map(textContent)].join("");
}


function prepareModal(modal, app) {
  modal.app = app;
  modal.contentEl = new FakeElement();
  modal.modalEl = new FakeElement();
  modal.close = () => {};
  return modal;
}

test("CompareFilesModal retire le frontmatter et rend les deux modes de diff", async () => {
  const fileA = new TFile("Projet/a.md", "---\ntitle: A\n---\nancien texte");
  const fileB = new TFile("Projet/b.md", "---\ntitle: B\n---\nnouveau texte");
  const app = { vault: { async read(file) { return file.content; } } };
  const modal = prepareModal(new CompareFilesModal(app, null, fileA, fileB), app);

  await modal.render();
  const splitText = textContent(modal.contentEl);
  assert.match(splitText, /ancien texte/);
  assert.match(splitText, /nouveau texte/);
  assert.doesNotMatch(splitText, /title: A|title: B/);
  assert.equal(elements(modal.contentEl, (element) => element.classes.has("feuillets-diff-split-container")).length, 1);

  modal.mode = "inline";
  await modal.render();
  assert.equal(elements(modal.contentEl, (element) => element.classes.has("feuillets-diff-inline-container")).length, 1);
});

test("PickFileModal filtre sans accent et exclut le feuillet courant", () => {
  const root = new TFolder("Projet");
  const current = new TFile("Projet/courant.md");
  const match = new TFile("Projet/Élodie.md");
  const other = new TFile("Projet/Autre.md");
  root.children = [current, match, other];
  for (const file of root.children) file.parent = root;
  const plugin = {
    getProjectFolder: () => root,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    shortTitleFor: (file) => file.basename,
  };
  const modal = prepareModal(new PickFileModal({}, plugin, current, () => {}), {});
  modal.filter = "elodie";

  modal.render();

  const rendered = textContent(modal.contentEl);
  assert.match(rendered, /Élodie/);
  assert.doesNotMatch(rendered, /courant|Autre/);
});
