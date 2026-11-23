import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { FakeWorkspace, wireVaultEvents, columns, readOnlyOf, settle, barOf, allElements } from "./helpers/comparison-harness.js";
import { ComparisonSession, openFeuilletsComparison, rewriteComparisonWritingLeaf } from "../src/views/comparison-view.js";
import { mountRewriteHistoryEntries, renderRewriteHistorySection } from "../src/ui/rewrite-history-section.js";
import { JournalView } from "../src/views/journal-view.js";
import { t } from "../src/i18n/index.js";
import { FakeElement } from "./helpers/comparison-harness.js";
import { RewriteHistory } from "../src/services/rewrite-history.js";
import { RewriteHistoryStore } from "../src/services/rewrite-history-store.js";

test("history comparison: both retained states are locked in Changes and Versions; no manuscript restore action", async () => {
  const before = new TFile("Projet/_Feuillets/RewriteHistory/states/before.md", "Le chat dort.");
  const after = new TFile("Projet/_Feuillets/RewriteHistory/states/after.md", "Le chien dort.");
  const manuscript = new TFile("Projet/A.md", "Texte actuel indépendant.");
  const { vault } = createFakeVault([before, after, manuscript]); wireVaultEvents(vault);
  const workspace = new FakeWorkspace(); const app = { vault, workspace };
  const manuscriptLeaf = workspace.add(); await manuscriptLeaf.openFile(manuscript);
  workspace.getLeaf = (newLeaf) => newLeaf ? workspace.add() : manuscriptLeaf;
  const session = await openFeuilletsComparison(app, { app, settings: {} }, { kind: "snapshot", sourcePath: after.path, snapshotPath: before.path, allowRestore: false, retainedPair: true });
  assert.ok(session); await settle();
  const views = columns(workspace).filter((view) => view.file !== manuscript); assert.deepEqual(views.map((view) => view.file.path), [before.path, after.path]);
  assert.ok(views.every((view) => readOnlyOf(view.cm) === true));
  const modeButton = allElements(barOf(workspace, before.path)).filter((element) => element.classes.has("feuillets-comparison-mode-button"))[1];
  modeButton.events.get("click")({ stopPropagation() {} });
  assert.equal(session.viewMode, "versions");
  assert.equal(manuscript.content, "Texte actuel indépendant.");
  assert.ok(views.every((view) => readOnlyOf(view.cm) === true));
  await session.close(); assert.ok(views.every((view) => readOnlyOf(view.cm) === false));
  assert.deepEqual(workspace.leaves, [manuscriptLeaf]);
  assert.equal(manuscriptLeaf.view.file, manuscript);
  assert.equal(after.content, "Le chien dort."); assert.equal(before.content, "Le chat dort.");
});


class SectionElement extends FakeElement {
  createEl(tag, options = {}) { const child = new SectionElement(tag, options); child.parent = this; this.children.push(child); return child; }
  setAttr(name, value) { this.setAttribute(name, value); }
  get parentElement() { return this.parent?.children.includes(this) ? this.parent : null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; }
  insertBefore(node, next) {
    node.remove(); node.parent = this;
    this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, node);
  }
}

async function journalFixture() {
  const root = new TFolder("Projet"); const file = new TFile("Projet/A.md", "Notes de travail"); file.stat = { ctime: 1 };
  file.parent = root; root.children = [file];
  const { vault, fileManager } = createFakeVault([root, file]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: { title: "Editorial title" } }) } };
  let time = 1000;
  const history = new RewriteHistory(new RewriteHistoryStore(app, root), { now: () => time++, inactivityMs: () => 600000, onError: (error) => { throw error; } });
  const settings = { automaticRewriteHistory: true, collapsed: {}, orders: {}, folderPositions: {} };
  const plugin = { app, settings, rewriteHistory: { forRoot: () => history }, async saveSettings() {} };
  const container = new SectionElement();
  const head = (parent) => JournalView.prototype.renderGroupHead.call(view, parent, "journal:rewrite-history", "history", t("rewriteHistory.title"), settings);
  const view = { plugin, async render() { container.empty(); await renderRewriteHistorySection(container, app, plugin, root, head); } };
  return { app, root, file, history, plugin, container, view };
}

test("Journal rewrite chronology uses shared panel headers, editorial titles and labelled comparison actions", async () => {
  const f = await journalFixture();
  f.history.observe(f.file, "Un texte ancien", "Nouveau texte", "continu"); await f.history.close();
  await f.view.render();
  assert.equal(allElements(f.container).filter((element) => element.classes.has("feuillets-rewrite-entry")).length, 0);
  allElements(f.container).find((element) => element.classes.has("feuillets-rewrite-group-toggle")).events.get("click")();
  const elements = allElements(f.container);
  assert.ok(elements.some((element) => element.text.includes("3 → 2 mots (-1)")));
  assert.ok(elements.some((element) => element.classes.has("feuillets-notes-section-head")));
  assert.ok(elements.some((element) => element.classes.has("feuillets-notes-section-icon")));
  assert.equal(elements.find((element) => element.classes.has("feuillets-notes-section-title")).text, t("rewriteHistory.title"));
  assert.equal(elements.find((element) => element.classes.has("feuillets-rewrite-title")).text, "Editorial title");
  const entry = elements.find((element) => element.classes.has("feuillets-rewrite-entry"));
  const [primary, current] = entry.children;
  assert.deepEqual(entry.children.map((element) => element.tag), ["button", "button"]);
  assert.ok(primary.getAttribute("aria-label").startsWith(t("rewriteHistory.compare")));
  assert.equal(current.getAttribute("aria-label"), t("rewriteHistory.compareCurrent"));
  assert.equal(current.getAttribute("title"), t("rewriteHistory.compareCurrentHint"));
  assert.deepEqual(current.children.map((element) => element.text), [t("rewriteHistory.compareCurrent"), t("rewriteHistory.compareCurrentShort")]);
  assert.equal(elements.some((element) => element.tag === "details" || element.tag === "summary" || element.tag === "select"), false);
  assert.equal(elements.filter((element) => element.classes.has("feuillets-rewrite-entry")).length, 1);
  assert.equal(f.file.content, "Notes de travail");
});

test("Journal rewrite section retains collapse state through the Journal's existing settings and rerenders", async () => {
  const f = await journalFixture(); f.history.observe(f.file, "A", "B", "markdown-editor"); await f.history.close(); await f.view.render();
  allElements(f.container).find((element) => element.classes.has("feuillets-notes-section-head")).events.get("click")();
  await settle();
  assert.equal(f.plugin.settings.collapsed["journal:rewrite-history"], true);
  await f.view.render(); assert.equal(allElements(f.container).some((element) => element.classes.has("feuillets-rewrite-entry")), false);
  allElements(f.container).find((element) => element.classes.has("feuillets-notes-section-head")).events.get("click")();
  await settle();
  assert.equal(allElements(f.container).filter((element) => element.classes.has("feuillets-rewrite-group")).length, 1);
  assert.equal(allElements(f.container).filter((element) => element.classes.has("feuillets-rewrite-entry")).length, 0);
  assert.equal((await f.history.list()).length, 1);
});

test("Journal rewrite chronology keeps pagination without a competing snapshot picker", async () => {
  const f = await journalFixture();
  for (let i = 0; i < 31; i++) { f.history.observe(f.file, `State ${i}`, `State ${i + 1}`, "markdown-editor"); await f.history.close(); }
  await f.view.render();
  allElements(f.container).find((element) => element.classes.has("feuillets-rewrite-group-toggle")).events.get("click")();
  const more = allElements(f.container).find((element) => element.classes.has("feuillets-rewrite-more"));
  assert.equal(allElements(f.container).filter((element) => element.classes.has("feuillets-rewrite-entry")).length, 30);
  assert.equal(more.hidden, false); more.events.get("click")();
  assert.equal(allElements(f.container).filter((element) => element.classes.has("feuillets-rewrite-entry")).length, 31);
  assert.equal(more.hidden, true);
});

const matching = (container, cls) => allElements(container).filter((element) => element.classes.has(cls));

test("Journal groups survive rename and move by stable identity, with independent expansion", async () => {
  const f = await journalFixture();
  const folder = await f.app.vault.createFolder("Projet/Partie");
  const other = await f.app.vault.create("Projet/Partie/A.md", "Other text"); other.stat.ctime = 2;
  f.history.observe(f.file, "Old", "New", "markdown-editor"); await f.history.close();
  f.history.observe(other, "Before", "After", "continu"); await f.history.close();
  await f.view.render();
  let groups = matching(f.container, "feuillets-rewrite-group"); assert.equal(groups.length, 2);
  assert.equal(matching(f.container, "feuillets-rewrite-title")[0].text, matching(f.container, "feuillets-rewrite-title")[1].text);
  const keys = groups.map((group) => group.dataset.groupKey); assert.notEqual(keys[0], keys[1]);
  matching(groups[0], "feuillets-rewrite-group-toggle")[0].events.get("click")();
  matching(groups[1], "feuillets-rewrite-group-toggle")[0].events.get("keydown")({ key: "Enter", preventDefault() {} });
  assert.equal(matching(f.container, "feuillets-rewrite-entry").length, 2);
  matching(groups[1], "feuillets-rewrite-group-toggle")[0].events.get("click")();
  assert.equal(matching(f.container, "feuillets-rewrite-entry").length, 1);
  const old = f.file.path; await f.app.fileManager.renameFile(f.file, folder.path + "/Renamed.md"); f.history.rename(old, f.file.path);
  f.history.observe(f.file, "New", "Another state", "markdown-editor"); await f.history.close();
  // Model the JSON round-trip used by saveSettings/loadSettings.
  f.plugin.settings.collapsed = JSON.parse(JSON.stringify(f.plugin.settings.collapsed));
  await f.view.render(); groups = matching(f.container, "feuillets-rewrite-group");
  const renamed = groups.find((group) => group.dataset.groupKey === keys[0]);
  assert.equal(matching(renamed, "feuillets-rewrite-group-toggle")[0].getAttribute("aria-expanded"), "true");
  assert.equal(matching(renamed, "feuillets-rewrite-group-toggle")[0].getAttribute("title"), f.file.path);
  assert.equal(matching(renamed, "feuillets-rewrite-entry").length, 2);
  assert.equal(matching(groups.find((group) => group.dataset.groupKey === keys[1]), "feuillets-rewrite-entry").length, 0);
  assert.deepEqual(matching(renamed, "feuillets-rewrite-entry").map((element) => element.dataset.entryId), (await f.history.list(f.file)).map((entry) => entry.id));
});

test("Journal acceptance: 23 and 35 interventions produce only two closed main rows", async () => {
  const f = await journalFixture(); const second = await f.app.vault.create("Projet/Second.md", "Text"); second.stat.ctime = 2;
  for (const [file, count] of [[f.file, 23], [second, 35]]) for (let i = 0; i < count; i++) {
    f.history.observe(file, `Before ${i}`, `After ${i}`, "markdown-editor"); await f.history.close();
  }
  await f.view.render(); const groups = matching(f.container, "feuillets-rewrite-group");
  assert.equal(groups.length, 2); assert.equal(matching(f.container, "feuillets-rewrite-entry").length, 0);
  assert.ok(matching(groups[0], "feuillets-rewrite-group-summary")[0].text.includes("23"));
  assert.ok(matching(groups[1], "feuillets-rewrite-group-summary")[0].text.includes("35"));
  for (const group of groups) matching(group, "feuillets-rewrite-group-toggle")[0].events.get("click")();
  assert.equal(matching(f.container, "feuillets-rewrite-entry").length, 53);
  matching(groups[1], "feuillets-rewrite-more")[0].events.get("click")();
  assert.equal(matching(f.container, "feuillets-rewrite-entry").length, 58);
});

test("Journal closed groups scale with sheets, never read historical Markdown and expand locally", async (context) => {
  const f = await journalFixture(); const entries = []; let resolutions = 0;
  for (let sheet = 0; sheet < 300; sheet++) {
    const file = await f.app.vault.create(`Projet/Sheet ${sheet}.md`, "Text");
    for (let i = 0; i < 40; i++) entries.push({ id: `${sheet}-${i}`, sheetId: String(sheet), projectId: "project", path: file.path, startedAt: i, endedAt: i + 1, initialWords: 1, finalWords: 2, delta: 1, before: "unused", after: "unused", origins: [], status: "complete" });
  }
  let listings = 0;
  f.plugin.rewriteHistory.forRoot = () => ({ async list() { listings++; return entries; }, currentPath(entry) { resolutions++; return entry.path; }, store: { state() { throw Error("Historical Markdown read during display"); } } });
  f.app.vault.getFiles = () => { throw Error("Global vault scan during display"); };
  f.app.vault.read = () => { throw Error("Disk read during metadata display"); };
  const start = performance.now(); await f.view.render();
  context.diagnostic(`300 sheets / 12000 interventions, closed render: ${(performance.now() - start).toFixed(1)} ms`);
  assert.equal(listings, 1); assert.equal(resolutions, 300);
  assert.equal(matching(f.container, "feuillets-rewrite-group").length, 300);
  assert.equal(matching(f.container, "feuillets-rewrite-entry").length, 0);
  assert.ok(allElements(f.container).length < 3400);
  const toggles = matching(f.container, "feuillets-rewrite-group-toggle");
  toggles[0].events.get("click")(); assert.equal(matching(f.container, "feuillets-rewrite-entry").length, 30);
  toggles[1].events.get("click")(); assert.equal(matching(f.container, "feuillets-rewrite-entry").length, 60);
  toggles[0].events.get("click")(); assert.equal(matching(f.container, "feuillets-rewrite-entry").length, 30);
  assert.equal(listings, 1); assert.equal(resolutions, 300);
});

test("Journal background refresh keeps the same focused control and paginated rows when a new intervention arrives", async () => {
  const f = await journalFixture();
  for (let i = 0; i < 35; i++) { f.history.observe(f.file, `Old ${i}`, `New ${i}`, "markdown-editor"); await f.history.close(); }
  const refresh = () => renderRewriteHistorySection(f.container, f.app, f.plugin, f.root,
    (parent) => JournalView.prototype.renderGroupHead.call(f.view, parent, "journal:rewrite-history", "history", t("rewriteHistory.title"), f.plugin.settings));
  await refresh();
  const [toggle] = matching(f.container, "feuillets-rewrite-group-toggle");
  toggle.events.get("click")();
  matching(f.container, "feuillets-rewrite-more")[0].events.get("click")();
  const previous = matching(f.container, "feuillets-rewrite-entry");
  const focused = matching(previous[33], "feuillets-rewrite-primary")[0];
  focused.ownerDocument = { activeElement: focused };
  await refresh();
  f.history.observe(f.file, "New", "Newest", "markdown-editor"); await f.history.close();
  await refresh();
  assert.equal(matching(f.container, "feuillets-rewrite-group-toggle")[0], toggle);
  const result = matching(f.container, "feuillets-rewrite-entry");
  assert.equal(result.length, 36);
  assert.deepEqual(result.slice(1), previous);
  assert.equal(matching(result[34], "feuillets-rewrite-primary")[0], focused);
});

test("intervention buttons open one comparison each with the correct historical states", async () => {
  const f = await journalFixture();
  const workspace = new FakeWorkspace();
  f.app.workspace = workspace;
  wireVaultEvents(f.app.vault);
  const original = workspace.add();
  await original.openFile(f.file);
  original.view.editor.getValue = () => "Unsaved manuscript";
  workspace.getMostRecentLeaf = () => original;
  f.history.observe(f.file, "Before the rewrite", "After the rewrite", "markdown-editor");
  await f.history.close();
  const entries = await f.history.list(f.file);
  const [entry] = entries;
  const before = await f.history.store.state(entry.before);
  const after = await f.history.store.state(entry.after);
  mountRewriteHistoryEntries(f.container, f.history, f.plugin, true)(entries);
  const [row] = matching(f.container, "feuillets-rewrite-entry");
  const [primary, current] = row.children;
  let returnedFocus = false;
  primary.isConnected = true;
  primary.win = { requestAnimationFrame: (callback) => callback() };
  primary.getClientRects = () => [{}];
  primary.focus = (options) => { returnedFocus = options.preventScroll; };
  assert.equal(row.events.has("click"), false);
  primary.events.get("click")();
  await settle();
  const retained = ComparisonSession.current;
  assert.deepEqual(retained.spec, { kind: "snapshot", sourcePath: after.path, snapshotPath: before.path, allowRestore: false, retainedPair: true });
  assert.deepEqual(columns(workspace).filter((view) => view !== original.view).map((view) => view.file.path), [before.path, after.path]);
  await retained.close(true);
  assert.equal(returnedFocus, true);
  current.events.get("click")();
  await settle();
  const withCurrent = ComparisonSession.current;
  assert.notEqual(withCurrent, retained);
  assert.equal(withCurrent.spec.sourcePath, f.file.path);
  assert.equal(withCurrent.spec.snapshotPath, after.path);
  assert.equal(withCurrent.spec.allowRestore, false);
  assert.deepEqual(columns(workspace).map((view) => view.file.path), [after.path, f.file.path]);
  assert.equal(original.view.editor.getValue(), "Unsaved manuscript");
  await withCurrent.close();
  assert.deepEqual(workspace.leaves, [original]);
  assert.equal(f.file.content, "Notes de travail");
});

test("history/current compares the unsaved Markdown buffer and keeps the writing leaf and history read-only", async () => {
  const retained = new TFile("Projet/_Feuillets/RewriteHistory/states/older.md", "Original text.");
  const manuscript = new TFile("Projet/Chapitre.md", "Saved text.");
  const { vault } = createFakeVault([retained, manuscript]); wireVaultEvents(vault);
  const workspace = new FakeWorkspace(); const app = { vault, workspace };
  const original = workspace.add(); await original.openFile(manuscript);
  original.view.editor.getValue = () => "Unsaved text.";
  workspace.getMostRecentLeaf = () => original;
  let wrote = false;
  vault.modify = () => { wrote = true; };
  const session = await openFeuilletsComparison(app, { app, settings: {} }, {
    kind: "snapshot", sourcePath: manuscript.path, snapshotPath: retained.path, allowRestore: false,
    historyCurrent: { date: "22/11/2026" },
  });
  assert.ok(session);
  await settle();
  const [before, after] = workspace.leaves;
  assert.equal(after, original);
  assert.equal(rewriteComparisonWritingLeaf(before), original);
  assert.ok(columns(workspace).every((view) => readOnlyOf(view.cm)));
  const bar = barOf(workspace, retained.path);
  assert.ok(allElements(bar).some((element) => element.text === t("rewriteHistory.editorText")));
  assert.ok(allElements(bar).some((element) => element.text.includes("22/11/2026")));
  await session.close();
  assert.deepEqual(workspace.leaves, [original]);
  assert.equal(readOnlyOf(original.view.cm), false);
  assert.equal(original.view.editor.getValue(), "Unsaved text.");
  assert.equal(manuscript.content, "Saved text.");
  assert.equal(wrote, false);
});

test("history/current with a Continu writing leaf labels the saved fallback and cleans up both comparison leaves", async () => {
  const retained = new TFile("Projet/_Feuillets/RewriteHistory/states/older.md", "Original text.");
  const manuscript = new TFile("Projet/Chapitre.md", "Saved text.");
  const { vault } = createFakeVault([retained, manuscript]); wireVaultEvents(vault);
  const workspace = new FakeWorkspace(); const app = { vault, workspace };
  const continu = workspace.add();
  continu.view = { getViewType: () => "feuillets-scrivenings" };
  workspace.getMostRecentLeaf = () => continu;
  const session = await openFeuilletsComparison(app, { app, settings: {} }, {
    kind: "snapshot", sourcePath: manuscript.path, snapshotPath: retained.path, allowRestore: false,
    historyCurrent: { date: "22/11/2026" },
  });
  assert.ok(session);
  const before = workspace.leaves.find((leaf) => leaf.view.file === retained);
  const after = workspace.leaves.find((leaf) => leaf.view.file === manuscript);
  assert.equal(rewriteComparisonWritingLeaf(before), continu);
  assert.equal(rewriteComparisonWritingLeaf(after), continu);
  assert.ok(allElements(barOf(workspace, retained.path)).some((element) => element.text === t("rewriteHistory.savedText")));
  await session.close();
  assert.deepEqual(workspace.leaves, [continu]);
});
