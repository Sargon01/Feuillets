import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { ResearchView } from "../src/views/research-view.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
  }

  addClass(className) {
    this.classes.add(className);
  }

  createDiv(options = {}) {
    const child = new FakeElement(options);
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }

  setText(text) {
    this.text = String(text);
  }

  empty() {
    this.children = [];
  }

  contains() {
    return false;
  }
}

function createView(plugin, vault = {}) {
  const contentEl = new FakeElement();
  const leaf = { app: { vault }, contentEl };
  return new ResearchView(leaf, plugin);
}

test("ResearchView affiche l'état vide sans dossier de projet", async () => {
  const view = createView({ getProjectFolder: () => null });
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };

  try {
    await view.render();
  } finally {
    globalThis.document = previousDocument;
  }

  assert.equal(view.contentEl.classes.has("feuillets-research-container"), true);
  assert.equal(view.contentEl.children.length, 1);
  assert.equal(view.contentEl.children[0].classes.has("feuillets-empty"), true);
});

test("ResearchView conserve le rendu du fichier encore présent", async () => {
  const root = new TFolder("Projet");
  const file = new TFile("Projet/_Recherche/note.md");
  const view = createView(
    { getProjectFolder: () => root },
    { getAbstractFileByPath: (path) => (path === file.path ? file : null) }
  );
  view.viewingFile = file;
  let rendered;
  view.renderFileView = async (container, currentFile, currentRoot) => {
    rendered = { container, currentFile, currentRoot };
  };

  await view.render(true);

  assert.deepEqual(rendered, {
    container: view.contentEl,
    currentFile: file,
    currentRoot: root,
  });
  assert.equal(view.viewingFile, file);
});

test("ResearchView délègue le rendu normal au corps Recherche", async () => {
  const root = new TFolder("Projet");
  const view = createView({ getProjectFolder: () => root });
  let rendered;
  view.renderResearchBody = async (container, currentRoot, generation) => {
    rendered = { container, currentRoot, generation };
  };

  await view.render(true);

  assert.deepEqual(rendered, {
    container: view.contentEl,
    currentRoot: root,
    generation: 1,
  });
});
