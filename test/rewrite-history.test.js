import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { RewriteHistory } from "../src/services/rewrite-history.js";
import { RewriteHistoryStore, rewriteHistoryPath } from "../src/services/rewrite-history-store.js";
import { ScriveningsSession } from "../src/views/scrivenings-view.js";
import { buildScriveningsDocument } from "../src/services/scrivenings-document.js";
import { snapshotFile, listSnapshotFiles } from "../src/services/project-files.js";

function fixture(paths = ["Projet/A.md", "Projet/Partie/A.md", "Projet/C.md"]) {
  const root = new TFolder("Projet");
  const part = new TFolder("Projet/Partie"); part.parent = root;
  const files = paths.map((path, i) => { const file = new TFile(path, "Un texte"); file.stat = { ctime: i + 1, mtime: 100, size: 8 }; file.parent = path.includes("Partie/") ? part : root; return file; });
  root.children = [part, ...files.filter((f) => f.parent === root)]; part.children = files.filter((f) => f.parent === part);
  const { vault, fileManager } = createFakeVault([root, part, ...files]);
  const app = { vault }; let time = 1000; const errors = [];
  const options = { now: () => time, inactivityMs: () => 600000, onError: (error) => errors.push(error) };
  const history = new RewriteHistory(new RewriteHistoryStore(app, root), options);
  return { app, root, files, vault, fileManager, errors, history, options, setTime: (value) => { time = value; }, restart: () => new RewriteHistory(new RewriteHistoryStore(app, root), options) };
}
async function content(history, hash) { return history.store.app.vault.read(await history.store.state(hash)); }

test("history: opening and listing do not create folders or snapshots", async () => {
  const f = fixture(); await f.history.list(f.files[0]);
  assert.equal(f.vault.getAbstractFileByPath(rewriteHistoryPath(f.root)), null);
});

test("history: first edit retains exact pre-edit source before the source is saved", async () => {
  const f = fixture(); const file = f.files[0];
  const before = "---\ntitle: A\n---\nLe texte initial";
  f.history.observe(file, before, "Le texte réécrit", "markdown-editor");
  file.content = "Une autre sauvegarde";
  await f.history.drain();
  const pending = (await f.history.store.entries())[0];
  assert.equal(await content(f.history, pending.before), before);
  assert.equal(pending.status, "pending");
  assert.equal((await f.history.list(file)).length, 0);
  await f.history.close(); const [entry] = await f.history.list(file);
  assert.equal(await content(f.history, entry.after), "Le texte réécrit");
  assert.equal(entry.initialWords, 3); assert.equal(entry.finalWords, 3); assert.equal(entry.delta, 0);
});

test("history: nearby edits coalesce, preserve start time and use the final content", async () => {
  const f = fixture(); const file = f.files[0];
  f.history.observe(file, "A", "A B", "markdown-editor");
  f.setTime(2000); f.history.observe(file, "A B", "A B C", "markdown-editor");
  await f.history.tick(); assert.equal((await f.history.store.entries()).length, 1);
  f.setTime(602001); await f.history.tick();
  const [entry] = await f.history.list();
  assert.equal(entry.startedAt, 1000); assert.equal(entry.endedAt, 2000);
  assert.equal(entry.delta, 2); assert.equal(await content(f.history, entry.after), "A B C");
});

test("history: multiple interventions on the same day, even without a timer tick", async () => {
  const f = fixture(); const file = f.files[0];
  f.history.observe(file, "A", "B", "markdown-editor");
  f.setTime(601000); f.history.observe(file, "B", "C", "markdown-editor");
  await f.history.close(); const entries = await f.history.list(file);
  assert.equal(entries.length, 2); assert.notEqual(entries[0].id, entries[1].id);
  assert.equal(entries[0].before, entries[1].after, "identical states are shared");
  assert.equal(await content(f.history, entries[1].after), "B");
});

test("history: arbitrary chapter order and homonymous sheets remain independent", async () => {
  const f = fixture();
  f.history.observe(f.files[0], "A", "A un", "markdown-editor");
  f.setTime(2000); f.history.observe(f.files[2], "C", "C deux", "markdown-editor");
  f.setTime(3000); f.history.observe(f.files[1], "B", "B trois", "continu");
  f.setTime(4000); f.history.observe(f.files[0], "A un", "A quatre", "markdown-editor");
  await f.history.close(); const all = await f.history.list();
  assert.equal(all.length, 3); assert.equal(new Set(all.map((e) => e.sheetId)).size, 3);
  assert.equal((await f.history.list(f.files[0]))[0].endedAt, 4000);
});

test("history: deletions have signed negative deltas and net-zero rewrites are retained", async () => {
  const f = fixture();
  f.history.observe(f.files[0], "Un deux trois", "Un", "markdown-editor");
  f.history.observe(f.files[1], "Le chat", "Un chien", "continu");
  await f.history.close();
  assert.equal((await f.history.list(f.files[0]))[0].delta, -2);
  assert.equal((await f.history.list(f.files[1]))[0].delta, 0);
});

test("history: metadata-only edits and undo back to the initial body produce no entry", async () => {
  const f = fixture(); const file = f.files[0];
  f.history.observe(file, "---\ntitle: A\n---\nTexte", "---\ntitle: B\n---\nTexte", "markdown-editor");
  await f.history.close(); assert.equal((await f.history.store.entries()).length, 0);
  f.history.observe(file, "Texte", "Réécrit", "markdown-editor");
  f.history.observe(file, "Réécrit", "---\ntitle: C\n---\nTexte", "markdown-editor");
  await f.history.close(); assert.equal((await f.history.list()).length, 0);
});

test("history: redo after a closed undo intervention creates a new entry", async () => {
  const f = fixture(); const file = f.files[0];
  f.history.observe(file, "A", "B", "markdown-editor");
  f.history.observe(file, "B", "A", "markdown-editor");
  await f.history.close(); f.history.observe(file, "A", "B", "markdown-editor");
  await f.history.close(); assert.equal((await f.history.list(file)).length, 1);
});

test("history: rename and move preserve sheet identity and current path", async () => {
  const f = fixture(); const file = f.files[0];
  f.history.observe(file, "A", "B", "markdown-editor"); await f.history.close();
  const id = (await f.history.list(file))[0].sheetId;
  const old = file.path; await f.fileManager.renameFile(file, "Projet/Partie/Renommé.md"); f.history.rename(old, file.path);
  f.history.observe(file, "B", "C", "markdown-editor"); await f.history.close();
  const entries = await f.history.list(file); assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.sheetId === id));
  assert.equal(f.history.currentPath(entries[1]), file.path);
  assert.equal((await f.restart().list(file)).length, 2);
});

test("history: deleted and recreated paths get a new identity", async () => {
  const f = fixture(); const file = f.files[0];
  f.history.observe(file, "A", "B", "markdown-editor"); await f.history.close();
  const id = (await f.history.list(file))[0].sheetId;
  f.history.remove(file.path); await f.history.drain();
  const replacement = new TFile(file.path, "C"); replacement.stat = { ...file.stat };
  f.history.observe(replacement, "C", "D", "markdown-editor"); await f.history.close();
  const [entry] = await f.history.list(replacement); assert.notEqual(entry.sheetId, id);
  assert.equal((await f.history.list(replacement)).length, 1); assert.equal((await f.history.list()).length, 2);
});

test("history: pending intervention recovers from a durable checkpoint after restart", async () => {
  const f = fixture(); const file = f.files[0];
  f.history.observe(file, "Avant", "Après", "markdown-editor"); await f.history.drain();
  f.history.observe(file, "Après", "Après encore", "markdown-editor"); await f.history.tick();
  const restarted = f.restart(); const [entry] = await restarted.list(file);
  assert.ok(entry.recovered); assert.equal(await content(restarted, entry.after), "Après encore");
  assert.equal(entry.status, "complete"); assert.equal(entry.checkpoint, undefined);
  assert.equal((await f.restart().list(file)).length, 1);
});

test("history: persistence failure keeps the exact initial state for ordered retry", async () => {
  const f = fixture(); const create = f.vault.create; let fail = true;
  f.vault.create = async (...args) => { if (fail) throw new Error("disk full"); return create(...args); };
  f.history.observe(f.files[0], "Avant", "Après", "continu"); await f.history.drain();
  assert.equal(f.history.hasError, true); assert.equal(f.errors.length, 1);
  f.history.observe(f.files[0], "Après", "Après encore", "continu");
  fail = false; await f.history.close();
  assert.equal(f.history.hasError, false); const [entry] = await f.history.list();
  assert.equal(await content(f.history, entry.before), "Avant");
  assert.equal(await content(f.history, entry.after), "Après encore");
  assert.equal((await f.history.store.entries()).length, 1);
});

test("history: concurrent JSON changes are preserved and a failed write is reported", async () => {
  const f = fixture(); f.history.observe(f.files[0], "A", "B", "markdown-editor"); await f.history.drain();
  const index = f.vault.getAbstractFileByPath(`${f.history.store.path}/index.json`);
  const changed = index.content + "\n"; index.content = changed;
  f.history.observe(f.files[1], "C", "D", "markdown-editor"); await f.history.close();
  assert.equal(index.content, changed); assert.ok(f.history.hasError); assert.equal(f.errors.length, 1);
});

test("history: malformed index and missing or modified states fail safely", async () => {
  const f = fixture(); f.history.observe(f.files[0], "A", "B", "continu"); await f.history.close();
  const [entry] = await f.history.list(); const state = await f.history.store.state(entry.before);
  state.content = "altered"; await assert.rejects(() => f.history.store.state(entry.before), /changed/);
  await f.vault.delete(state); await assert.rejects(() => f.history.store.state(entry.before), /missing/);
  const index = f.vault.getAbstractFileByPath(`${f.history.store.path}/index.json`); index.content = "{";
  const restarted = f.restart(); assert.deepEqual(await restarted.list(), []); assert.ok(restarted.hasError);
  assert.equal(index.content, "{");
});

test("history: same timestamps do not collide and repeated notifications are deduplicated", async () => {
  const f = fixture(); const file = f.files[0];
  for (let i = 0; i < 3; i++) {
    f.history.observe(file, `A${i}`, `B${i}`, "markdown-editor");
    f.history.observe(file, `A${i}`, `B${i}`, "external-or-other");
    await f.history.close();
  }
  const entries = await f.history.list(); assert.equal(entries.length, 3); assert.equal(new Set(entries.map((e) => e.id)).size, 3);
});

test("history: divergent editors preserve separate real chains without fabricating a baseline", async () => {
  const f = fixture(); const file = f.files[0];
  f.history.observe(file, "A", "B", "markdown-editor");
  f.history.observe(file, "A", "C", "continu"); await f.history.close();
  const entries = await f.history.list(); assert.equal(entries.length, 2); assert.equal(entries[0].before, entries[1].before);
});

test("history: Continu captures only accepted changed segments before deferred saves", async () => {
  const f = fixture(); const captured = [];
  const session = new ScriveningsSession({ app: f.app, scheduleTimeout: () => 1, cancelTimeout() {},
    observeRewrite: (file, before, after) => { captured.push(file.path); f.history.observe(file, before, after, "continu"); } });
  const document = buildScriveningsDocument(f.files.map((file) => ({ file, content: file.content })));
  session.load(document); assert.equal(captured.length, 0);
  session.handleChanges([{ from: 0, to: 2, insert: "Autre" }, { from: document.segments[2].from, to: document.segments[2].from + 2, insert: "Dernier" }]);
  assert.deepEqual(captured, [f.files[0].path, f.files[2].path]);
  assert.equal(f.files[0].content, "Un texte");
  await f.history.drain(); await session.flush(); await f.history.close();
  assert.equal((await f.history.list()).length, 2); assert.equal((await f.history.list(f.files[1])).length, 0);
  assert.equal(f.files[0].content, "Autre texte"); session.destroy();
});

test("history: legacy manual snapshots coexist untouched and remain discoverable", async () => {
  const f = fixture(); const file = f.files[0];
  await snapshotFile(f.app, file, f.root);
  const before = listSnapshotFiles(f.app, file, f.root); assert.equal(before.length, 1);
  f.history.observe(file, "Un texte", "Autre texte", "continu"); await f.history.close();
  assert.deepEqual(listSnapshotFiles(f.app, file, f.root).map((s) => s.path), before.map((s) => s.path));
  assert.equal(await f.vault.read(before[0]), "Un texte");
});

test("history: configured inactivity and simultaneous flushes keep one durable entry", async () => {
  const f = fixture(); f.options.inactivityMs = () => 60000;
  f.history.observe(f.files[0], "Avant", "Après", "markdown-editor");
  f.setTime(60999); await f.history.tick(); assert.equal((await f.history.list()).length, 0);
  f.setTime(61000); await Promise.all([f.history.tick(), f.history.close(), f.history.drain()]);
  assert.equal((await f.history.list()).length, 1);
});

test("history: a failed final-state write leaves a restartable checkpoint", async () => {
  const f = fixture(); f.history.observe(f.files[0], "Avant", "Après", "continu"); await f.history.drain();
  const create = f.vault.create;
  f.vault.create = async (path, text) => { if (path.endsWith(".md")) throw new Error("disk full"); return create(path, text); };
  await f.history.close(); assert.ok(f.history.hasError);
  const pending = await f.history.store.entries(); assert.equal(pending[0].status, "pending");
  f.vault.create = create; const restarted = f.restart(); const [entry] = await restarted.list();
  assert.ok(entry.recovered); assert.equal(await content(restarted, entry.before), "Avant");
  assert.equal(await content(restarted, entry.after), "Après");
});

test("history: a failing observer never prevents Continu edits and manuscript persistence", async () => {
  const f = fixture(); const notices = [];
  const session = new ScriveningsSession({ app: f.app, scheduleTimeout: () => 1, cancelTimeout() {}, notify: (message) => notices.push(message),
    observeRewrite: () => { throw new Error("history observer unavailable"); } });
  f.files[0].content = "Avant";
  session.load(buildScriveningsDocument([{ file: f.files[0], content: "Avant" }]));
  assert.ok(session.handleChanges([{ from: 0, to: 5, insert: "Après" }]));
  await session.flush(); assert.equal(f.files[0].content, "Après"); assert.equal(notices.length, 1); session.destroy();
});

test("history: pending writes never recreate a removed adopted project", async () => {
  const f = fixture();
  await f.vault.delete(f.root);
  f.history.observe(f.files[0], "Avant", "Après", "markdown-editor"); await f.history.close();
  assert.equal(f.vault.getAbstractFileByPath(f.root.path), null);
  assert.ok(f.history.hasError);
  assert.equal(f.vault.getAbstractFileByPath(rewriteHistoryPath(f.root)), null);
});

test("history: a sheet named after the history namespace keeps its manual snapshots separate", async () => {
  const f = fixture(["Projet/RewriteHistory.md"]); const file = f.files[0];
  await snapshotFile(f.app, file, f.root);
  f.history.observe(file, "Un texte", "Autre texte", "markdown-editor"); await f.history.close();
  const manual = listSnapshotFiles(f.app, file, f.root);
  assert.equal(manual.length, 1); assert.ok(manual[0].path.includes("Snapshots/RewriteHistory/"));
  assert.ok(f.history.store.path.endsWith("_Feuillets/RewriteHistory"));
  assert.equal((await f.history.list(file)).length, 1);
  assert.equal(await f.vault.read(manual[0]), "Un texte");
});
