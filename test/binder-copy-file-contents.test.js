import { test } from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import FeuilletsPlugin from "../src/main.js";
import { t } from "../src/i18n/index.js";
import { buildScopeClipboardText } from "../src/services/scrivenings-clipboard-source.js";

/* « Copier le contenu » on a SINGLE sheet — same pipeline as the folder
   entry (buildScopeClipboardText, see binder-copy-folder-contents.test.js)
   and as Continu's own Cmd+A/Cmd+C copy: never a second engine, never a raw
   vault.read(file). Same fixture/plugin pattern as binder-continu-menu.test.js,
   which already exercises the real menu built by showFileContextMenu. */

function makeFile(path, content) {
  const file = new TFile(path, content);
  file.path = path;
  file.name = path.split("/").pop();
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";
  return file;
}

function frontmatterOf(content) {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const [k, ...rest] = line.split(":");
    fm[k.trim()] = rest.join(":").trim();
  }
  return fm;
}

function buildProject() {
  const root = new TFolder("Roman/Manuscrit");
  root.path = "Roman/Manuscrit";
  root.name = "Manuscrit";

  const chapter = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter.path = "Roman/Manuscrit/Chapitre 1";
  chapter.name = "Chapitre 1";
  chapter.parent = root;

  const scene = makeFile("Roman/Manuscrit/Chapitre 1/Scène.md", "---\ntitle: Scène titrée\n---\n\nLe jour se leva.\n");
  scene.parent = chapter;
  chapter.children = [scene];

  const otherScene = makeFile("Roman/Manuscrit/Prologue.md", "Texte du prologue.\n");
  otherScene.parent = root;
  root.children = [chapter, otherScene];

  const settings = {
    projectFolder: root.path,
    level1Role: "chapitres",
    compileFileName: "Manuscrit.md",
    orders: {},
    folderPositions: {},
    labels: [],
    statuses: [],
    projectMeta: {},
  };

  return { root, chapter, scene, otherScene, settings };
}

function buildApp(project) {
  const files = new Map();
  const register = (f) => {
    if (!f) return;
    files.set(f.path, f);
    if (f.children) for (const c of f.children) register(c);
  };
  register(project.root);

  return {
    workspace: {
      getLeaf: () => { throw new Error("workspace must not be touched by a clipboard copy"); },
      getLeavesOfType: () => [],
    },
    vault: {
      getAbstractFileByPath: (p) => files.get(p) || null,
      getFiles: () => [project.scene, project.otherScene],
      read: async (f) => f.content,
      cachedRead: async (f) => f.content,
      modify: async () => { throw new Error("a copy must never write to the vault"); },
      create: async () => { throw new Error("a copy must never write to the vault"); },
    },
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatterOf(f.content || "") }) },
    fileManager: { processFrontMatter: async () => {}, trashFile: async () => {} },
  };
}

function buildView(project) {
  const app = buildApp(project);
  const plugin = {
    app,
    settings: project.settings,
    getProjectFolder: () => project.root,
    editorialRootFor: FeuilletsPlugin.prototype.editorialRootFor,
    compileScopeForFile: FeuilletsPlugin.prototype.compileScopeForFile,
    compileScopeForFolder: FeuilletsPlugin.prototype.compileScopeForFolder,
    compileScopeForSelection: FeuilletsPlugin.prototype.compileScopeForSelection,
    isValidEditorialRootPath: (path) => path === project.root.path,
    isSceneFile: (f) => f instanceof TFile,
    flattenFiles: () => [project.scene, project.otherScene],
    saveSettings: async () => {},
    fmOf: (f) => frontmatterOf(f.content || ""),
    labelOf: () => "",
    titleFor: (f) => f.basename,
    shortTitleFor: (f) => f.basename,
    renderAllViews: () => {},
    snapshotFile: async () => "",
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    getLinkedResearchFolder: () => null,
    getResearchRoot: () => null,
  };
  class TestBinderView extends FeuilletsView {
    constructor() { super({ app, contentEl: null }); this.app = app; this.plugin = plugin; }
    async render() {}
  }
  return { view: new TestBinderView(), app, plugin };
}

function withClipboard(writeText) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const calls = [];
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async (text) => { calls.push(text); return writeText(text); } } },
    configurable: true,
    writable: true,
  });
  return {
    calls,
    restore: () => {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
      else delete globalThis.navigator;
    },
  };
}

function copyItemFor(fx, file, parent) {
  fx.view.showFileContextMenu({ preventDefault() {} }, file, parent, 0, []);
  return Menu.lastShown.items.filter((i) => i.title === t("binder.copyContents"));
}

test("Test 1 — a single sheet's context menu carries 'Copier le contenu' / 'Copy contents'", () => {
  const project = buildProject();
  const fx = buildView(project);
  const items = copyItemFor(fx, project.scene, project.chapter);
  assert.equal(items.length, 1, "the entry must be present exactly once");
  assert.equal(items[0].title, t("binder.copyContents"));
});

test("Test 2 — the entry is never added twice", () => {
  const project = buildProject();
  const fx = buildView(project);
  const items = copyItemFor(fx, project.scene, project.chapter);
  assert.equal(items.length, 1);
});

test("Test 3 — clicking the entry copies exactly buildScopeClipboardText(fileScope), not a raw vault.read", async () => {
  const project = buildProject();
  const fx = buildView(project);
  const items = copyItemFor(fx, project.scene, project.chapter);
  const clip = withClipboard(async () => {});
  try {
    await items[0].callback();
  } finally {
    clip.restore();
  }
  assert.equal(clip.calls.length, 1);

  const expectedScope = fx.plugin.compileScopeForFile(project.scene);
  assert.equal(expectedScope.type, "file");
  assert.equal(expectedScope.path, project.scene.path);
  const expectedText = await buildScopeClipboardText(fx.app, project.settings, expectedScope);

  assert.equal(clip.calls[0], expectedText);
  // The frontmatter is stripped and the title is rendered as a heading —
  // proof this went through the shared engine, not a bare vault.read(file).
  assert.doesNotMatch(clip.calls[0], /^---$/m);
  assert.match(clip.calls[0], /^#{1,6} Scène titrée$/m);
  assert.match(clip.calls[0], /Le jour se leva\./);
  // The fix this file guards: a single-sheet copy never injects its parent
  // folder's name as a structure title.
  assert.equal(clip.calls[0].includes("# Chapitre 1"), false);
  assert.doesNotMatch(clip.calls[0], /^#{1,6}\s+Chapitre 1$/m);
});

/* The scope-specific rule, not an arbitrary Continu-hierarchy equivalence:
 * the menu's single-file copy shares the exact same engine as a folder
 * scope would use for the very same sheet (buildScopeClipboardText /
 * createScriveningsClipboardRules), but the file scope deliberately
 * excludes ancestor folder titles while the folder scope keeps them — see
 * scrivenings-clipboard-file-scope.test.js for the isolated engine-level
 * coverage of that divergence. A plain equality with a second
 * `compileScopeForFile` call (the exact call the menu itself makes) would
 * only restate the production code, never catch a missing ancestor-title
 * exclusion — this is why the comparison here is against a FOLDER scope. */
test("Test 4 — the menu's single-sheet copy uses the same shared engine as a folder scope on the same sheet, but omits that folder's own title", async () => {
  const project = buildProject();
  const fx = buildView(project);
  const items = copyItemFor(fx, project.scene, project.chapter);
  const clip = withClipboard(async () => {});
  try {
    await items[0].callback();
  } finally {
    clip.restore();
  }

  const { createFolderScope } = await import("../src/services/compile-scope.js");
  const folderScopeForSameSheet = createFolderScope(project.root.path, project.chapter.path);
  const folderText = await buildScopeClipboardText(fx.app, project.settings, folderScopeForSameSheet);

  assert.equal(folderText, `# Chapitre 1\n\n${clip.calls[0]}`, "same engine, same sheet text — the folder scope just adds its own title on top");
});

test("Test 5 — a right-click on a multi-selected group never gets the single-sheet copy entry; group behavior is unchanged", () => {
  const project = buildProject();
  const fx = buildView(project);
  fx.plugin._binderMultiSelect = new Set([project.scene.path, project.otherScene.path]);

  const items = copyItemFor(fx, project.scene, project.chapter);
  assert.equal(items.length, 0, "the group case keeps its existing Continu/compilation-only behavior");
});

test("clipboard failure is a clean no-op, and an empty scope writes nothing", async () => {
  const project = buildProject();
  const fx = buildView(project);

  // Failure case: same policy as folder copy — no throw, no write.
  const items = copyItemFor(fx, project.scene, project.chapter);
  const failingClip = withClipboard(async () => { throw new Error("denied"); });
  try {
    await items[0].callback();
  } finally {
    failingClip.restore();
  }
});
