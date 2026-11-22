import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Notice } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { RewriteHistoryController } from "../src/services/rewrite-history-controller.js";
import { wireVaultEvents, settle } from "./helpers/comparison-harness.js";

function fixture() {
  globalThis.window.setInterval ??= (...args) => setInterval(...args);
  globalThis.window.clearInterval ??= (handle) => clearInterval(handle);
  const a = new TFile("Articles/A.md", "Avant"); a.stat = { ctime: 1, mtime: 10 };
  const b = new TFile("Roman/Manuscrit/B.md", "Initial"); b.stat = { ctime: 2, mtime: 10 };
  const root = new TFolder("Articles", [a]); a.parent = root;
  const project = new TFolder("Roman"); const second = new TFolder("Roman/Manuscrit", [b]); second.parent = project; b.parent = second;
  const aux = new TFolder("Articles/_Feuillets"); aux.parent = root; root.children.push(aux);
  const research = new TFolder("Articles/_Feuillets/Recherche"); research.parent = aux;
  const versions = new TFolder("Articles/_Feuillets/Versions"); versions.parent = aux; aux.children = [research, versions];
  const r = new TFile(research.path + "/Note.md", "Sources"); r.parent = research; research.children = [r];
  const v = new TFile(versions.path + "/Version.md", "Version"); v.parent = versions; versions.children = [v];
  const { vault } = createFakeVault([root, project, second, a, b, aux, research, versions, r, v]); wireVaultEvents(vault);
  const app = { vault, metadataCache: { getFileCache: () => ({}) }, workspace: { onLayoutReady() {}, on() { return {}; } } };
  const settings = { projectFolder: root.path, projects: [second.path], orders: {}, folderPositions: {}, projectMeta: {}, automaticRewriteHistory: true, rewriteHistoryInactivityMinutes: 10 };
  const host = { app, settings, registerEditorExtension() {}, registerEvent() {}, refreshRewriteHistoryViews() {} };
  const controller = new RewriteHistoryController(host);
  return { app, host, settings, controller, root, second, a, b, r, v, vault };
}

test("history controller: project switches retain separate project references", async () => {
  const f = fixture(); await f.controller.refresh();
  f.controller.observe(f.a, "Avant", "Après", "markdown-editor");
  await f.controller.close(); f.settings.projectFolder = f.second.path; f.settings.projects = [f.root.path]; await f.controller.refresh();
  f.controller.observe(f.b, "Initial", "Suite", "continu");
  f.controller.observe(f.a, "Après", "Encore", "markdown-editor");
  await f.controller.dispose();
  const first = await f.controller.forRoot(f.root).list(); const second = await f.controller.forRoot(f.second).list();
  assert.equal(first.length, 2); assert.equal(second.length, 1); assert.notEqual(first[0].projectId, second[0].projectId);
  assert.ok(f.vault.getAbstractFileByPath("Roman/_Feuillets/RewriteHistory/index.json"));
  assert.ok(f.vault.getAbstractFileByPath("Articles/_Feuillets/RewriteHistory/index.json"));
});

test("history controller: Research, Versions, auxiliaries and folder notes are excluded", async () => {
  const f = fixture();
  assert.equal(f.controller.rootFor(f.a), f.root);
  assert.equal(f.controller.rootFor(f.r), null); assert.equal(f.controller.rootFor(f.v), null);
  f.controller.observe(f.r, "Sources", "Changed", "markdown-editor");
  f.controller.observe(f.v, "Version", "Changed", "continu");
  await f.controller.close(); assert.equal((await f.controller.forRoot(f.root).list()).length, 0);
  assert.equal(f.vault.getAbstractFileByPath("Articles/_Feuillets/Snapshots"), null);
});

test("history controller: disabled option captures nothing and enabling only primes memory", async () => {
  const f = fixture(); f.settings.automaticRewriteHistory = false;
  f.controller.observe(f.a, "Avant", "Après", "markdown-editor"); await f.controller.refresh();
  assert.equal((await f.controller.forRoot(f.root).list()).length, 0);
  f.settings.automaticRewriteHistory = true; await f.controller.refresh();
  assert.equal(f.vault.getAbstractFileByPath("Articles/_Feuillets/Snapshots"), null);
  await f.controller.dispose();
});

test("history controller: known external changes keep the actually cached baseline; editor echoes deduplicate", async () => {
  const f = fixture(); f.controller.install(); await f.controller.refresh();
  f.a.content = "Externe"; f.vault.emit("modify", f.a); await settle();
  await f.controller.close(); const [entry] = await f.controller.forRoot(f.root).list(f.a);
  assert.deepEqual(entry.origins, ["external-or-other"]);
  assert.equal(await f.vault.read(await f.controller.forRoot(f.root).store.state(entry.before)), "Avant");
  f.controller.observe(f.a, "Externe", "Dans éditeur", "markdown-editor"); f.a.content = "Dans éditeur";
  f.vault.emit("modify", f.a); await settle(); await f.controller.close();
  assert.equal((await f.controller.forRoot(f.root).list(f.a)).length, 2);
  await f.controller.dispose();
});

test("history controller: an unknown external baseline is reported without an invented before-state", async () => {
  const f = fixture(); const notices = []; Notice.onCreate = (message) => notices.push(message);
  try {
    f.controller.install(); f.a.content = "Unknown prior state"; f.vault.emit("modify", f.a); await settle(); await f.controller.close();
    assert.equal((await f.controller.forRoot(f.root).list()).length, 0); assert.equal(notices.length, 1);
  } finally { Notice.onCreate = null; await f.controller.dispose(); }
});
