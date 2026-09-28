import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, MarkdownView } from "obsidian";
import FeuilletsPlugin from "../src/main.js";

/*
 * Bug fix "writing colors / .feuillets-project-editor missing until the
 * first click": at layout-ready, a restored Markdown leaf can still be
 * `isDeferred` when syncProjectEditorScope() first runs — it sees a
 * placeholder, not a real MarkdownView, and skips that leaf. Nothing
 * resyncs `.feuillets-project-editor` again until the user's first
 * file-open/active-leaf-change (a click). loadDeferredViews() must now
 * resync immediately once it has actually turned a deferred placeholder
 * into its real view — never waiting for a click.
 */

class FakeElement {
  constructor() {
    this.classes = new Set();
  }
  addClass(cls) { this.classes.add(cls); }
  removeClass(cls) { this.classes.delete(cls); }
  toggleClass(cls, on) { on ? this.classes.add(cls) : this.classes.delete(cls); }
  hasClass(cls) { return this.classes.has(cls); }
}

function makeMarkdownLeaf(file, { deferred = false } = {}) {
  const view = Object.assign(new MarkdownView(), { file, contentEl: new FakeElement() });
  const leaf = {
    isDeferred: deferred,
    view: deferred ? { getViewType: () => "markdown" } : view,
    loadIfDeferred: async () => {
      leaf.isDeferred = false;
      leaf.view = view;
    },
  };
  return leaf;
}

/* ===================== Test E/H — loadDeferredViews() call order ===================== */

test("Test E — loadDeferredViews() calls syncProjectEditorScope() only AFTER every deferred leaf has actually finished loading", async () => {
  const calls = [];
  let resolveLoad;
  const loadGate = new Promise((resolve) => { resolveLoad = resolve; });
  const deferredLeaf = {
    isDeferred: true,
    loadIfDeferred: async () => {
      await loadGate;
      calls.push("leaf-loaded");
      deferredLeaf.isDeferred = false;
    },
  };
  const fakePlugin = {
    app: { workspace: { iterateAllLeaves: (cb) => cb(deferredLeaf) } },
    syncProjectEditorScope: () => calls.push("sync"),
  };

  const pending = FeuilletsPlugin.prototype.loadDeferredViews.call(fakePlugin);
  assert.deepEqual(calls, [], "sync must not happen before the leaf has finished loading");
  resolveLoad();
  await pending;

  assert.deepEqual(calls, ["leaf-loaded", "sync"], "sync happens exactly once, right after loading completes");
});

test("Test H — loadDeferredViews() with zero deferred leaves never calls syncProjectEditorScope()", async () => {
  const calls = [];
  const loadedLeaf = { isDeferred: false, loadIfDeferred: async () => { calls.push("should never run"); } };
  const fakePlugin = {
    app: { workspace: { iterateAllLeaves: (cb) => cb(loadedLeaf) } },
    syncProjectEditorScope: () => calls.push("sync"),
  };

  await FeuilletsPlugin.prototype.loadDeferredViews.call(fakePlugin);

  assert.deepEqual(calls, [], "no leaf loaded, no unnecessary resync burst");
});

/* ===================== Test F/G — real integration ===================== */

function makeAppFor(root, deferredLeaf) {
  return {
    vault: { getAbstractFileByPath: (path) => (path === root.path ? root : null) },
    workspace: {
      iterateAllLeaves: (cb) => cb(deferredLeaf),
      getLeavesOfType: (type) => (type === "markdown" ? [deferredLeaf] : []),
    },
  };
}

test("Test F — after loadDeferredViews(), a restored project Markdown leaf carries BOTH .feuillets-project-editor and .feuillets-writing-editor with no file-open/active-leaf-change/click", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const inProjectFile = new TFile("Roman/Manuscrit/Scene.md");
  inProjectFile.path = "Roman/Manuscrit/Scene.md";
  const deferredLeaf = makeMarkdownLeaf(inProjectFile, { deferred: true });

  const fakePlugin = {
    settings: { projectFolder: root.path, projects: [] },
    app: makeAppFor(root, deferredLeaf),
    getProjectFolder: () => root,
    syncProjectEditorScope: FeuilletsPlugin.prototype.syncProjectEditorScope,
  };

  assert.equal(deferredLeaf.isDeferred, true, "sanity: the fixture reproduces the exact reported deferred state");

  await FeuilletsPlugin.prototype.loadDeferredViews.call(fakePlugin);

  assert.equal(deferredLeaf.isDeferred, false, "the placeholder was actually loaded");
  assert.equal(deferredLeaf.view.contentEl.hasClass("feuillets-project-editor"), true,
    "the real view is classed immediately, without any click or workspace event");
  assert.equal(deferredLeaf.view.contentEl.hasClass("feuillets-writing-editor"), true,
    "the active project is also always a known, writing-colors-eligible project");
});

test("Test G — a MarkdownView outside every known project never receives .feuillets-project-editor NOR .feuillets-writing-editor after this resync", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const outsideFile = new TFile("Autre/Note.md");
  outsideFile.path = "Autre/Note.md";
  const deferredLeaf = makeMarkdownLeaf(outsideFile, { deferred: true });

  const fakePlugin = {
    settings: { projectFolder: root.path, projects: [] },
    app: makeAppFor(root, deferredLeaf),
    getProjectFolder: () => root,
    syncProjectEditorScope: FeuilletsPlugin.prototype.syncProjectEditorScope,
  };

  await FeuilletsPlugin.prototype.loadDeferredViews.call(fakePlugin);

  assert.equal(deferredLeaf.view.contentEl.hasClass("feuillets-project-editor"), false,
    "a note outside the active project is never classed as a project editor");
  assert.equal(deferredLeaf.view.contentEl.hasClass("feuillets-writing-editor"), false,
    "an ordinary note outside every known Feuillets project keeps the theme's normal colors");
});
