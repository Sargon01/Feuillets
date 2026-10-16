import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { listCarnetWorkspaceEntries } from "../src/carnet/core/workspace-entries.js";
import { folderCarnetCanvasPath } from "../src/carnet/core/folder-carnets.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { createFakeVault } from "./helpers/fake-vault.js";

function fixture() {
  const project = new TFolder("Project"), manuscript = new TFolder("Project/Manuscript"), folder = new TFolder("Project/Manuscript/Chapter"), research = new TFolder("Project/Research/Chapter");
  manuscript.parent = project; folder.parent = manuscript; research.parent = project;
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const canvas = new TFile(folderCarnetCanvasPath(manuscript, id)), other = new TFile("Unregistered.canvas");
  const { vault, files } = createFakeVault([project, manuscript, folder, research, canvas, other]);
  const settings = { projectFolder: manuscript.path, projectMeta: { [manuscript.path]: {
    folderCarnets: { "Research/Chapter": { version: 1, id } }, researchFolderLinks: { [folder.path]: research.path },
  } } };
  const app = { vault };
  vault.getFiles = () => { throw new Error("Vault scans are forbidden"); };
  vault.create = vault.modify = () => { throw new Error("Listing must be read-only"); };
  return { app, settings, manuscript, folder, research, canvas, files };
}

test("manager lists canonical folder owners, resolves legacy aliases and shows both contexts without mutation", () => {
  const f = fixture(), before = JSON.stringify(f.settings);
  const entries = listCarnetWorkspaceEntries(f.app, f.settings, f.manuscript);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].folder, null); assert.equal(entries[0].file, null);
  assert.equal(entries[1].folder, f.folder); assert.equal(entries[1].file, f.canvas);
  assert(entries[1].context.includes(f.folder.path)); assert(entries[1].context.includes(f.research.path));
  assert.equal(JSON.stringify(f.settings), before);
});

test("missing registered files are listed for explicit creation; current folder aliases are deduplicated", () => {
  const f = fixture(); f.files.delete(f.canvas.path);
  const entries = listCarnetWorkspaceEntries(f.app, f.settings, f.manuscript, f.research);
  assert.equal(entries.length, 2); assert.equal(entries[1].file, null);
  assert.equal(Object.keys(f.settings.projectMeta[f.manuscript.path].folderCarnets).length, 1);
});

test("project notebook resolution does not generate a Binder Plan or create a missing notebook", () => {
  const f = fixture(), global = new TFile(canvasPathFor(f.app, f.manuscript)); f.files.set(global.path, global);
  assert.equal(listCarnetWorkspaceEntries(f.app, f.settings, f.manuscript)[0].file, global);
  assert.deepEqual(listCarnetWorkspaceEntries(f.app, f.settings, null), []);
});


test("duplicate Carnet names use the shortest distinguishing parent context", () => {
  const f = fixture(), parent = new TFolder("Project/Manuscript/Second"), duplicate = new TFolder("Project/Manuscript/Second/Chapter");
  parent.parent = f.manuscript; duplicate.parent = parent;
  f.files.set(parent.path, parent); f.files.set(duplicate.path, duplicate);
  f.settings.projectMeta[f.manuscript.path].folderCarnets["Manuscript/Second/Chapter"] = { version: 1, id: "123e4567-e89b-12d3-a456-426614174001" };
  const entries = listCarnetWorkspaceEntries(f.app, f.settings, f.manuscript).slice(1);
  assert.equal(new Set(entries.map((entry) => entry.label)).size, 2);
  assert(entries.every((entry) => !entry.label.startsWith("Project/")));
  assert(entries.some((entry) => entry.label === "Second/Chapter"));
  assert(entries.every((entry) => entry.context.includes("Project/")));
});
