import assert from "node:assert/strict";
import test from "node:test";
import { TFile, MarkdownView } from "obsidian";
import { resolvePresentationMarkdownContext, ensurePresentationMarkdownLeaf } from "../src/utils/presentation-command-context.js";

function markdownFile(path = "Cours.md") {
  const file = new TFile(path, "");
  return file;
}

function fakeLeaf(view) {
  return { view };
}

test("resolvePresentationMarkdownContext A : MarkdownView active => fichier + sa leaf", () => {
  const file = markdownFile();
  const leaf = fakeLeaf({ file });
  const activeView = Object.assign(Object.create(MarkdownView.prototype), { file, leaf });
  const app = {
    workspace: {
      getActiveViewOfType: (type) => (type === MarkdownView ? activeView : null),
      getActiveFile: () => file,
      getLeavesOfType: () => [],
    },
  };
  const context = resolvePresentationMarkdownContext(app);
  assert.equal(context.file, file);
  assert.equal(context.workLeaf, leaf);
});

test("resolvePresentationMarkdownContext B : focus ailleurs mais getActiveFile()=Markdown avec une leaf Markdown correspondante => résoluble", () => {
  const file = markdownFile();
  const otherFile = markdownFile("Autre.md");
  const matchingLeaf = fakeLeaf({ file });
  const otherLeaf = fakeLeaf({ file: otherFile });
  const app = {
    workspace: {
      getActiveViewOfType: () => null,
      getActiveFile: () => file,
      getLeavesOfType: (type) => (type === "markdown" ? [otherLeaf, matchingLeaf] : []),
    },
  };
  const context = resolvePresentationMarkdownContext(app);
  assert.equal(context.file, file);
  assert.equal(context.workLeaf, matchingLeaf);
});

test("resolvePresentationMarkdownContext C : fichier Markdown actif sans leaf correspondante => fichier + workLeaf null", () => {
  const file = markdownFile();
  const app = {
    workspace: {
      getActiveViewOfType: () => null,
      getActiveFile: () => file,
      getLeavesOfType: () => [],
    },
  };
  const context = resolvePresentationMarkdownContext(app);
  assert.equal(context.file, file);
  assert.equal(context.workLeaf, null);
});

test("resolvePresentationMarkdownContext D : fichier non Markdown / aucun fichier => null", () => {
  const nonMarkdown = new TFile("image.png", "");
  const appNoFile = {
    workspace: { getActiveViewOfType: () => null, getActiveFile: () => null, getLeavesOfType: () => [] },
  };
  const appNonMarkdown = {
    workspace: { getActiveViewOfType: () => null, getActiveFile: () => nonMarkdown, getLeavesOfType: () => [] },
  };
  assert.equal(resolvePresentationMarkdownContext(appNoFile), null);
  assert.equal(resolvePresentationMarkdownContext(appNonMarkdown), null);
});

test("ensurePresentationMarkdownLeaf : ne crée aucune leaf si elle existe déjà", async () => {
  const file = markdownFile();
  const leaf = fakeLeaf({ file });
  const app = { workspace: { getLeaf: () => { throw new Error("ne doit pas être appelé"); } } };
  const result = await ensurePresentationMarkdownLeaf(app, { file, workLeaf: leaf });
  assert.equal(result, leaf);
});

test("ensurePresentationMarkdownLeaf : ouvre une leaf publique si nécessaire", async () => {
  const file = markdownFile();
  let opened = null;
  const newLeaf = { openFile: async (f) => { opened = f; } };
  const app = { workspace: { getLeaf: (mode) => { assert.equal(mode, "tab"); return newLeaf; } } };
  const result = await ensurePresentationMarkdownLeaf(app, { file, workLeaf: null });
  assert.equal(result, newLeaf);
  assert.equal(opened, file);
});
