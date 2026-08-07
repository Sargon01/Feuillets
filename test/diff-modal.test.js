import assert from "node:assert/strict";
import test from "node:test";
import { Notice, TFile, TFolder } from "obsidian";
import { ConfirmModal } from "../src/ui/basic-modals.js";
import { CompareFilesModal, DiffModal, PickFileModal } from "../src/ui/diff-modal.js";
import { createFakeVault } from "./helpers/fake-vault.js";

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

function buttonComponents(element) {
  return [
    ...(element.buttonComponents ?? []),
    ...element.children.flatMap(buttonComponents),
  ];
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

test("DiffModal affiche l'état vide lorsqu'aucun snapshot n'est disponible", async () => {
  const current = new TFile("Projet/scene.md", "texte");
  const app = { vault: { getAbstractFileByPath() { return null; } } };
  const modal = prepareModal(new DiffModal(app, current), app);

  await modal.onOpen();

  assert.equal(elements(modal.contentEl, (element) => element.classes.has("feuillets-empty")).length, 1);
});

test("DiffModal restaure après snapshot, lecture, écriture, notification puis fermeture", async () => {
  const root = new TFolder("Projet");
  const current = new TFile("Projet/scene.md", "version actuelle");
  const snapshot = new TFile("Projet/Snapshots/scene/ancien.md", "version sauvegardée");
  const { vault } = createFakeVault([root, current, snapshot]);
  const order = [];
  const app = {
    vault: {
      ...vault,
      async read(file) {
        order.push(`read:${file.path}`);
        return vault.read(file);
      },
      async modify(file, content) {
        order.push(`modify:${file.path}`);
        await vault.modify(file, content);
      },
    },
  };
  const plugin = {
    getProjectFolder: () => root,
    snapshotFile: async () => { order.push("snapshot"); },
    shortTitleFor: (file) => file.basename,
  };
  const modal = prepareModal(new DiffModal(app, plugin, current, snapshot), app);
  modal.snapshots = [snapshot];
  modal.selectedSnapshot = snapshot;
  modal.close = () => { order.push("close"); };
  const originalOpen = ConfirmModal.prototype.open;
  let confirm;
  ConfirmModal.prototype.open = function () {
    confirm = this.onConfirm;
  };
  Notice.onCreate = () => { order.push("notice"); };

  try {
    await modal.renderModalContent();
    order.length = 0;
    const restore = buttonComponents(modal.contentEl)[0];
    restore.callback();
    await confirm();
  } finally {
    ConfirmModal.prototype.open = originalOpen;
    Notice.onCreate = null;
  }

  assert.equal(current.content, "version sauvegardée");
  assert.deepEqual(order, [
    "snapshot",
    `read:${snapshot.path}`,
    `modify:${current.path}`,
    "notice",
    "close",
  ]);
});

// LOT 6 (docx-review) — `allowRestore` : rétrocompatible (défaut `true`,
// TOUS les usages existants — dont le test précédent — continuent de
// permettre la restauration exactement comme avant ce lot), désactivable
// pour "Comparer l'origine"/"Comparer la destination" d'un déplacement
// inter-feuillets (voir docx-review-view.ts#openTraceCompare).
test("DiffModal — allowRestore=false masque le bouton Restaurer, sans toucher au reste du rendu", async () => {
  const root = new TFolder("Projet");
  const current = new TFile("Projet/scene.md", "version actuelle");
  const snapshot = new TFile("Projet/Snapshots/scene/ancien.md", "version sauvegardée");
  const { vault } = createFakeVault([root, current, snapshot]);
  const app = { vault };
  const plugin = {
    getProjectFolder: () => root,
    snapshotFile: async () => {},
    shortTitleFor: (file) => file.basename,
  };
  const modal = prepareModal(new DiffModal(app, plugin, current, snapshot, false), app);
  modal.snapshots = [snapshot];
  modal.selectedSnapshot = snapshot;

  await modal.renderModalContent();

  assert.equal(buttonComponents(modal.contentEl).length, 1, "seul le bouton Fermer reste");
  assert.equal(textContent(modal.contentEl).includes("version actuelle"), true);
});

test("DiffModal — allowRestore omis (constructeur sans plugin) équivaut à true", async () => {
  const current = new TFile("Projet/scene.md", "texte");
  const app = { vault: { getAbstractFileByPath() { return null; } } };
  const modal = prepareModal(new DiffModal(app, current), app);
  assert.equal(modal.allowRestore, true);
});
