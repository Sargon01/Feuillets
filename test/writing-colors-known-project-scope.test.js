import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, MarkdownView } from "obsidian";
import FeuilletsPlugin, { isFileInsideKnownProject } from "../src/main.js";

/*
 * Bug fix "writing colors vanish when switching projects with the file
 * still open": `.feuillets-project-editor` keeps its strict historical
 * contract (the CURRENTLY ACTIVE project only) — every other behavior it
 * drives (composition directives, semantic roles, callouts, compact
 * display…) is untouched. The writing-colors feature alone now uses a
 * separate, broader class, `.feuillets-writing-editor`: any MarkdownView
 * belonging to ANY known, switchable Feuillets project (`projectFolder` +
 * `projects`), so a file left open after switching away from its project
 * keeps its custom colors instead of silently reverting to the theme.
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

function makeMarkdownLeaf(file) {
  const view = Object.assign(new MarkdownView(), { file, contentEl: new FakeElement() });
  return { view };
}

function makeVault(folders) {
  const byPath = new Map(folders.map((f) => [f.path, f]));
  return { getAbstractFileByPath: (path) => byPath.get(path) || null };
}

/* ===================== Test A/B — isFileInsideKnownProject() ===================== */

test("Test A — a file in the currently active project is a known project (both classes apply)", () => {
  const projectA = new TFolder("Roman/A");
  const file = new TFile("Roman/A/Scene.md");
  file.path = "Roman/A/Scene.md";
  const app = { vault: makeVault([projectA]) };
  const settings = { projectFolder: projectA.path, projects: [] };

  assert.equal(isFileInsideKnownProject(app, settings, file), true);
});

test("Test B — a file from an OLD project (no longer active, but remembered in settings.projects) is still a known project — the exact bug scenario", () => {
  const projectA = new TFolder("Roman/A");
  const projectB = new TFolder("Roman/B");
  const fileInA = new TFile("Roman/A/Scene.md");
  fileInA.path = "Roman/A/Scene.md";
  const app = { vault: makeVault([projectA, projectB]) };
  // projectFolder switched to B; A was preserved in settings.projects by
  // switchProject() before switching — exactly as it happens in production.
  const settings = { projectFolder: projectB.path, projects: [projectA.path] };

  assert.equal(isFileInsideKnownProject(app, settings, fileInA), true);
});

test("Test E — a note outside every known Feuillets project is never considered known", () => {
  const projectA = new TFolder("Roman/A");
  const outside = new TFile("Notes/personnel.md");
  outside.path = "Notes/personnel.md";
  const app = { vault: makeVault([projectA]) };
  const settings = { projectFolder: projectA.path, projects: [] };

  assert.equal(isFileInsideKnownProject(app, settings, outside), false);
});

test("Test E bis — null file is never a known project", () => {
  const app = { vault: makeVault([]) };
  assert.equal(isFileInsideKnownProject(app, { projectFolder: "", projects: [] }, null), false);
});

test("Test F — a stale settings.projects entry for a deleted/moved folder is silently ignored, no accidental prefix match", () => {
  const projectA = new TFolder("Roman/A");
  // "Roman/A-archive" is a REAL folder on disk, but a completely different
  // project — a loose startsWith(root.path) without the "/" boundary would
  // wrongly match it against the stale "Roman/A" entry's prefix.
  const decoyFolder = new TFolder("Roman/A-archive");
  const decoyFile = new TFile("Roman/A-archive/Scene.md");
  decoyFile.path = "Roman/A-archive/Scene.md";
  const app = { vault: makeVault([decoyFolder]) }; // "Roman/A" itself no longer resolves to a TFolder
  const settings = { projectFolder: projectA.path, projects: ["Roman/A"] };

  assert.equal(isFileInsideKnownProject(app, settings, decoyFile), false,
    "a stale project path that no longer resolves to a real TFolder must never match, and never via a boundary-less prefix");
});

/* ===================== Test C — real switchProject() ===================== */

test("Test C — switching project A -> B: A.md loses .feuillets-project-editor but KEEPS .feuillets-writing-editor", async () => {
  const projectA = new TFolder("Roman/A");
  const projectB = new TFolder("Roman/B");
  const fileA = new TFile("Roman/A/Scene.md");
  fileA.path = "Roman/A/Scene.md";
  const leafA = makeMarkdownLeaf(fileA);

  const settings = { projectFolder: projectA.path, projects: [] };
  const vault = makeVault([projectA, projectB]);
  const fakePlugin = {
    settings,
    app: {
      vault,
      workspace: {
        iterateAllLeaves: () => {},
        getLeavesOfType: (type) => (type === "markdown" ? [leafA] : []),
      },
    },
    getProjectFolder: () => vault.getAbstractFileByPath(settings.projectFolder),
    saveSettings: async () => {},
    renderAllViews: () => {},
    loadDeferredViews: FeuilletsPlugin.prototype.loadDeferredViews,
    syncProjectEditorScope: FeuilletsPlugin.prototype.syncProjectEditorScope,
    updateStatusBar: async () => {},
    scheduleJournalStatsUpdate: () => {},
  };

  // Initial sync: A.md is the active project's own file.
  fakePlugin.syncProjectEditorScope();
  assert.equal(leafA.view.contentEl.hasClass("feuillets-project-editor"), true);
  assert.equal(leafA.view.contentEl.hasClass("feuillets-writing-editor"), true);

  const ok = await FeuilletsPlugin.prototype.switchProject.call(fakePlugin, projectB.path);
  assert.equal(ok, true);
  assert.equal(settings.projectFolder, projectB.path);
  assert.ok(settings.projects.includes(projectA.path), "the outgoing project is preserved in settings.projects");

  assert.equal(leafA.view.contentEl.hasClass("feuillets-project-editor"), false,
    "A.md is no longer the active project's own editor");
  assert.equal(leafA.view.contentEl.hasClass("feuillets-writing-editor"), true,
    "but A.md is still a KNOWN project — its custom colors must not vanish");
});

/* ===================== Test D — two projects open simultaneously ===================== */

test("Test D — project B active, A.md and B.md both open: A.md keeps writing-editor only, B.md keeps both", async () => {
  const projectA = new TFolder("Roman/A");
  const projectB = new TFolder("Roman/B");
  const fileA = new TFile("Roman/A/Scene.md");
  fileA.path = "Roman/A/Scene.md";
  const fileB = new TFile("Roman/B/Scene.md");
  fileB.path = "Roman/B/Scene.md";
  const leafA = makeMarkdownLeaf(fileA);
  const leafB = makeMarkdownLeaf(fileB);

  const settings = { projectFolder: projectB.path, projects: [projectA.path] };
  const vault = makeVault([projectA, projectB]);
  const fakePlugin = {
    settings,
    app: {
      vault,
      workspace: { getLeavesOfType: (type) => (type === "markdown" ? [leafA, leafB] : []) },
    },
    getProjectFolder: () => vault.getAbstractFileByPath(settings.projectFolder),
    syncProjectEditorScope: FeuilletsPlugin.prototype.syncProjectEditorScope,
  };

  fakePlugin.syncProjectEditorScope();

  assert.equal(leafA.view.contentEl.hasClass("feuillets-project-editor"), false);
  assert.equal(leafA.view.contentEl.hasClass("feuillets-writing-editor"), true);
  assert.equal(leafB.view.contentEl.hasClass("feuillets-project-editor"), true);
  assert.equal(leafB.view.contentEl.hasClass("feuillets-writing-editor"), true);
});
