import { test } from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { buildScopeClipboardText } from "../src/services/scrivenings-clipboard-source.js";
import { createFileScope, createFolderScope, createSelectionScope } from "../src/services/compile-scope.js";

/* Fix: a single-file scope must never inject its ancestor folders' titles —
   the user asked to copy that one sheet, not to reconstruct its parent
   hierarchy. Folder/project/selection scopes keep titling ancestors exactly
   as before (see binder-copy-folder-contents.test.js and
   scrivenings-folder-titles.test.js for their own non-regression coverage;
   this file only isolates the file-scope rule at the engine level,
   independent of the Binder menu). */

function makeFile(path, content) {
  const file = new TFile(path, content);
  file.path = path;
  file.name = path.split("/").pop();
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";
  return file;
}

function makeFolder(path, children = []) {
  const folder = new TFolder(path);
  folder.path = path;
  folder.name = path.split("/").pop();
  folder.children = children;
  for (const c of children) c.parent = folder;
  return folder;
}

function buildFixture() {
  // Roman/Manuscrit/Chapter 1/Scene.md — one level of nesting.
  const shallowScene = makeFile("Roman/Manuscrit/Chapter 1/Scene.md", "Shallow scene body.\n");
  const chapter1 = makeFolder("Roman/Manuscrit/Chapter 1", [shallowScene]);

  // Roman/Manuscrit/Part I/Chapter 2/Scene.md — two levels of nesting.
  const deepScene = makeFile("Roman/Manuscrit/Part I/Chapter 2/Scene.md", "Deep scene body.\n");
  const chapter2 = makeFolder("Roman/Manuscrit/Part I/Chapter 2", [deepScene]);
  const partI = makeFolder("Roman/Manuscrit/Part I", [chapter2]);

  const root = makeFolder("Roman/Manuscrit", [chapter1, partI]);

  const all = new Map();
  const register = (n) => { all.set(n.path, n); (n.children || []).forEach(register); };
  register(root);

  const app = {
    vault: {
      getAbstractFileByPath: (p) => all.get(p) || null,
      read: async (f) => f.content,
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const settings = {
    projectFolder: root.path,
    level1Role: "parties",
    orders: {},
    folderPositions: {},
    labels: [],
    statuses: [],
    projectMeta: {},
  };

  return { app, settings, root, chapter1, shallowScene, partI, chapter2, deepScene };
}

test("Test 1 — a file in one chapter: file title and body, never '# Chapter 1'", async () => {
  const fx = buildFixture();
  const scope = createFileScope(fx.root.path, fx.shallowScene.path);
  const text = await buildScopeClipboardText(fx.app, fx.settings, scope);

  assert.match(text, /^#{1,6}\s+Scene$/m, "the sheet's own title is still resolved by titleFor");
  assert.match(text, /Shallow scene body\./);
  assert.doesNotMatch(text, /^#{1,6}\s+Chapter 1$/m);
});

test("Test 2 — a deeply nested file: neither 'Part I' nor 'Chapter 2' appear as structure titles", async () => {
  const fx = buildFixture();
  const scope = createFileScope(fx.root.path, fx.deepScene.path);
  const text = await buildScopeClipboardText(fx.app, fx.settings, scope);

  assert.match(text, /^#{1,6}\s+Scene$/m);
  assert.match(text, /Deep scene body\./);
  assert.doesNotMatch(text, /^#{1,6}\s+Part I$/m);
  assert.doesNotMatch(text, /^#{1,6}\s+Chapter 2$/m);
});

test("Test 3 — non-regression, folder scope: the ancestor chain within the folder is still titled", async () => {
  const fx = buildFixture();
  const scope = createFolderScope(fx.root.path, fx.partI.path);
  const text = await buildScopeClipboardText(fx.app, fx.settings, scope);

  assert.match(text, /^#{1,6}\s+Chapter 2$/m, "folder scopes still title the structure, exactly as before");
  assert.match(text, /Deep scene body\./);
});

test("Test 4 — non-regression, selection scope: folder titles are not suppressed for a multi-sheet selection", async () => {
  const fx = buildFixture();
  const scope = createSelectionScope(fx.root.path, [fx.shallowScene.path, fx.deepScene.path]);
  const text = await buildScopeClipboardText(fx.app, fx.settings, scope);

  assert.match(text, /^#{1,6}\s+Chapter 1$/m, "a multi-sheet selection keeps the structural titles it needs");
  assert.match(text, /^#{1,6}\s+Part I$/m);
  assert.match(text, /^#{1,6}\s+Chapter 2$/m);
});

test("a single-file scope's own text equals exactly the folder scope's segment for that same file, minus the ancestor title lines", async () => {
  const fx = buildFixture();
  const fileScope = createFileScope(fx.root.path, fx.deepScene.path);
  const folderScope = createFolderScope(fx.root.path, fx.chapter2.path);

  const fileText = await buildScopeClipboardText(fx.app, fx.settings, fileScope);
  const folderText = await buildScopeClipboardText(fx.app, fx.settings, folderScope);

  // Same single sheet in both cases: the folder-scope text is exactly the
  // ancestor title line followed by the file-scope text — proof this is the
  // same shared engine with scope-specific folder-title rules, not a
  // reconstruction of an arbitrary hierarchy.
  assert.equal(folderText, `## Chapter 2\n\n${fileText}`);
});
