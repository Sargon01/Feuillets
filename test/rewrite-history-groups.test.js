import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { rewriteHistoryGroups } from "../src/ui/rewrite-history-groups.js";

const entry = (id, sheetId, path, startedAt = 1) => ({ id, sheetId, projectId: "project", path, startedAt, endedAt: startedAt + 1 });

test("rewrite groups follow nested Binder order, saved names, folder positions and frontmatter order", async () => {
  const root = new TFolder("Projet"); const { vault } = createFakeVault([root]);
  const z = await vault.createFolder("Projet/Z"); const a = await vault.createFolder("Projet/A");
  const nested = await vault.createFolder("Projet/Z/Nested");
  const ignored = await vault.createFolder("Projet/No history");
  Object.defineProperty(ignored, "children", { get() { throw Error("Unnecessary branch scan"); } });
  const paths = ["Projet/A/First.md", "Projet/Z/Alpha.md", "Projet/Z/Zulu.md", "Projet/Z/Nested/Scene.md", "Projet/Last.md"];
  for (const path of paths) await vault.create(path, "Text");
  const app = { vault, metadataCache: { getFileCache(file) { return { frontmatter: { order: file.name === "Zulu.md" ? 1 : 2 } }; } } };
  const settings = { orders: { [root.path]: [z.name, "Last.md", a.name] }, folderPositions: { [nested.path]: 0 } };
  const events = paths.map((path, i) => entry(String(i), String(i), path));
  const groups = rewriteHistoryGroups(app, settings, root, events, (event) => event.path);
  assert.deepEqual(groups.map((group) => group.path), [paths[3], paths[2], paths[1], paths[4], paths[0]]);
  settings.orders[z.path] = ["Alpha.md", "Nested", "Zulu.md"];
  assert.deepEqual(rewriteHistoryGroups(app, settings, root, events, (event) => event.path).map((group) => group.path), [paths[1], paths[3], paths[2], paths[4], paths[0]]);
});

test("rewrite groups use stable identity, sort interventions and keep deleted/recreated paths separate", async () => {
  const root = new TFolder("Projet"); const { vault } = createFakeVault([root]);
  const file = await vault.create("Projet/Renamed.md", "Text");
  const events = [entry("old-1", "old", file.path, 1), entry("new-1", "new", file.path, 2), entry("old-2", "old", file.path, 3)];
  const calls = [];
  const groups = rewriteHistoryGroups({ vault }, { orders: {}, folderPositions: {} }, root, events, (event) => { calls.push(event.sheetId); return event.sheetId === "new" ? file.path : null; });
  assert.deepEqual(calls, ["old", "new"]);
  assert.equal(groups.length, 2); assert.equal(groups[0].file, file);
  assert.equal(groups[1].path, null); assert.notEqual(groups[0].key, groups[1].key);
  assert.deepEqual(groups[1].entries.map((event) => event.id), ["old-2", "old-1"]);
  assert.equal(groups[1].latestAt, 4);
  assert.deepEqual(events.map((event) => event.id), ["old-1", "new-1", "old-2"]);
});
