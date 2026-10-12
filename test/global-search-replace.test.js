import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MarkdownView } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createSearchEditor } from "./search-editor-helper.js";
import { GlobalSearchReplace, resolveSearchReplaceFiles } from "../src/services/global-search-replace.js";
import { SearchReplaceConfirmModal } from "../src/ui/search-replace-confirm-modal.js";
import { VIEW_SCRIVENINGS } from "../src/constants.js";
import { resolveEditorialRoot } from "../src/services/editorial-roots.js";
import { createProjectScope, createFolderScope, createSelectionScope } from "../src/services/compile-scope.js";
import { createProjectBackup } from "../src/services/project-backup.js";
import { setLocale } from "../src/i18n/index.js";
setLocale("en");

async function fixture(contents = { "Project/Chapter/a.md": "ney", "Project/Chapter/Sub/b.md": "ney", "Project/c.md": "ney" }, projectPath = "Project") {
  const fake = createFakeVault();
  async function folder(path) {
    if (fake.files.has(path)) return fake.files.get(path);
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) await folder(parent);
    return fake.vault.createFolder(path);
  }
  await folder(projectPath);
  for (const [path, content] of Object.entries(contents)) {
    await folder(path.split("/").slice(0, -1).join("/"));
    await fake.vault.create(path, content);
  }
  const project = fake.files.get(projectPath);
  const leaves = [];
  let activeProject = project;
  const settings = { projectFolder: projectPath, orders: {}, folderPositions: {}, compileFileName: "Compiled.md", projectMeta: {} };
  const app = { ...fake, metadataCache: { getFileCache: () => ({ frontmatter: {} }) }, workspace: { getLeavesOfType: (type) => leaves.filter((leaf) => leaf.type === type) } };
  const host = { settings, getProjectFolder: () => activeProject, getLinkedResearchFolders: () => [] };
  const service = new GlobalSearchReplace(app, host);
  function open(path, text) {
    const file = fake.files.get(path);
    const editor = createSearchEditor(text ?? file.content);
    const view = Object.assign(new MarkdownView(), { file, editor, getMode: () => "source", save: () => fake.vault.process(file, () => view.editor.getValue()) });
    const leaf = { type: "markdown", view };
    leaves.push(leaf);
    return { editor, leaf, file };
  }
  return { ...fake, app, host, settings, service, project, leaves, folder, open, scope: createProjectScope(projectPath), switchProject: (next) => { activeProject = next; } };
}
const options = { ignoreCase: true, includeYaml: false, protectMarkdown: true };
const reason = (expected) => (error) => error.reason === expected;
const originals = (f) => [...f.files.values()].filter((file) => file.extension === "md").map((file) => [file.path, file.content]);
const stateOf = (f, backup) => f.files.get(`${backup.path}.state`)?.content ?? "prepared";
const backups = (f) => [...f.files.values()].filter((file) => file.extension === "json");

test("global scope resolves active file, recursive folder and deduplicated Binder selection in Binder order", async () => {
  const f = await fixture();
  f.settings.orders["Project/Chapter"] = ["Sub", "a.md"];
  f.settings.orders.Project = ["Chapter", "c.md"];
  const paths = (scope) => resolveSearchReplaceFiles(f.app, f.host, scope).map(({ path }) => path);
  assert.deepEqual(paths({ type: "file", projectRoot: "Project", path: "Project/c.md" }), ["Project/c.md"]);
  assert.deepEqual(paths(createFolderScope("Project", "Project/Chapter/Sub")), ["Project/Chapter/Sub/b.md"]);
  assert.deepEqual(paths(createFolderScope("Project", "Project/Chapter")), ["Project/Chapter/Sub/b.md", "Project/Chapter/a.md"]);
  assert.deepEqual(paths(createSelectionScope("Project", ["Project/Chapter", "Project/Chapter/a.md", "Project/c.md"])), ["Project/Chapter/Sub/b.md", "Project/Chapter/a.md", "Project/c.md"]);
  assert.deepEqual(paths(createSelectionScope("Project", ["Project/c.md", "Project/Chapter/a.md"])), ["Project/Chapter/a.md", "Project/c.md"]);
});

for (const [name, scope, paths] of [
  ["active sheet", { type: "file", projectRoot: "Project", path: "Project/c.md" }, ["Project/c.md"]],
  ["simple folder", createFolderScope("Project", "Project/Chapter/Sub"), ["Project/Chapter/Sub/b.md"]],
  ["recursive folder", createFolderScope("Project", "Project/Chapter"), ["Project/Chapter/a.md", "Project/Chapter/Sub/b.md"]],
  ["several selected sheets", createSelectionScope("Project", ["Project/c.md", "Project/Chapter/a.md"]), ["Project/c.md", "Project/Chapter/a.md"]],
  ["folder plus selected descendant", createSelectionScope("Project", ["Project/Chapter", "Project/Chapter/a.md"]), ["Project/Chapter/a.md", "Project/Chapter/Sub/b.md"]],
]) {
  test(`real replacement and recovery stay in the resolved ${name} scope`, async () => {
    const f = await fixture();
    const before = originals(f);
    const result = await f.service.apply(await f.service.preview(scope, "ney", "word", options));
    assert.equal(result.totalReplacements, paths.length);
    for (const [path, content] of before) assert.equal(f.files.get(path).content, paths.includes(path) ? "word" : content);
    assert.equal(await f.service.undoLast(), paths.length);
    assert.deepEqual(originals(f), before);
  });
}

test("editorial roots isolate independent and nested works; entire project stays explicit", async () => {
  const f = await fixture({ "Project/BOZLAK/a.md": "ney", "Project/NEFES/a.md": "ney", "Project/NEFES/Annex/a.md": "ney", "Project/AKSAK/a.md": "ney" });
  f.settings.projectMeta.Project = { folderWorkspaces: { BOZLAK: { ouvrage: { version: 1 } }, NEFES: { ouvrage: { version: 1 } }, "NEFES/Annex": { ouvrage: { version: 1 } }, AKSAK: { ouvrage: { version: 1 } } } };
  for (const work of ["BOZLAK", "NEFES", "NEFES/Annex", "AKSAK"]) {
    const file = f.files.get(`Project/${work}/a.md`);
    const root = resolveEditorialRoot(f.app, f.settings, f.project, file);
    assert.equal(root.path, `Project/${work}`);
    const plan = await f.service.preview(createProjectScope(root.path), "ney", "*ney*", options);
    assert.ok(plan.documents.every(({ path }) => path.startsWith(`Project/${work}/`)));
    if (work === "BOZLAK") { await f.service.apply(plan); assert.equal(f.files.get("Project/NEFES/a.md").content, "ney"); }
  }
  assert.equal(resolveSearchReplaceFiles(f.app, f.host, f.scope).length, 4);
});

for (const root of ["Project", "Project/Manuscrit", "Project/Manuscript"]) {
  test(`scope excludes technical, linked and external files for ${root}`, async () => {
    const f = await fixture({ [`${root}/Text/a.md`]: "ney", [`${root}/_Feuillets/Versions/a.md`]: "ney", [`${root}/Resources/a.md`]: "ney", [`${root}/Recherche/a.md`]: "ney", [`${root}/_Versions/a.md`]: "ney", [`${root}/Output/a.md`]: "ney", [`${root}/Compiled.md`]: "ney", [`${root}/Linked/a.md`]: "ney", "Outside/a.md": "ney" }, root);
    f.host.getLinkedResearchFolders = () => [{ folder: f.files.get(`${root}/Linked`) }];
    const before = originals(f);
    const plan = await f.service.preview(f.scope, "ney", "*ney*", options);
    assert.deepEqual(plan.documents.map(({ path }) => path), [`${root}/Text/a.md`]);
    await f.service.apply(plan);
    for (const [path, content] of before) assert.equal(f.files.get(path).content, path === `${root}/Text/a.md` ? "*ney*" : content);
    for (const path of ["Outside/a.md", `${root}/_Feuillets/Versions/a.md`, `${root}/Compiled.md`]) assert.throws(() => resolveSearchReplaceFiles(f.app, f.host, createSelectionScope(root, [path])), reason("scope"));
    const spoof = f.files.get("Outside/a.md");
    f.project.children.push(spoof);
    assert.ok(!resolveSearchReplaceFiles(f.app, f.host, f.scope).includes(spoof));
    assert.throws(() => resolveSearchReplaceFiles(f.app, f.host, createProjectScope("Outside")), reason("scope"));
  });
}

test("legacy compiled outputs are excluded using existing output naming and work compositions", async () => {
  const f = await fixture({ "Project/a.md": "ney", "Project/Compiled.md": "ney", "Project/Preset.md": "ney", "Project/Project output.md": "ney", "Project/Book/Work output.md": "ney", "Project/Manuscript.md": "ney" });
  f.settings.compileFileName = "Compiled";
  f.settings.compilePresets = [{ fileName: "Preset.md" }];
  f.settings.projectMeta.Project = { projectComposition: { fileName: "Project output" }, folderWorkspaces: { Book: { ouvrage: { composition: { fileName: "Work output.md" } } } } };
  const before = originals(f);
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  assert.deepEqual(plan.documents.map(({ path }) => path), ["Project/a.md"]);
  await f.service.apply(plan);
  for (const [path, content] of before) assert.equal(f.files.get(path).content, path === "Project/a.md" ? "word" : content);
});

test("preview plans expected text and offsets without writing; protected replacement is idempotent", async () => {
  const body = "---\ntitle: ney\n---\nney NEY *ney* **ney** _ney_ **before ney after** `ney`\n```\nney\n```\n[^1]: ney\nneyland";
  const f = await fixture({ "Project/a.md": body, "Project/b.md": "ney" });
  const before = originals(f);
  const plan = await f.service.preview(f.scope, "ney", "*ney*", { ...options, matchMode: "wholeWord" });
  assert.deepEqual(originals(f), before);
  assert.equal(backups(f).length, 0);
  assert.equal(plan.found, 9);
  assert.equal(plan.eligible, 4);
  assert.equal(plan.skipped, 5);
  assert.equal(plan.filesCount, 2);
  for (const document of plan.documents) for (const change of document.changes) {
    assert.equal(change.path, document.path);
    assert.equal(document.original.slice(change.from, change.to), change.expected);
    assert.ok(plan.occurrences.some(({ file, index }) => file.path === change.path && index === change.from));
  }
  const result = await f.service.apply(plan);
  assert.deepEqual(result, { totalReplacements: 4, filesCount: 2 });
  assert.equal(f.files.get("Project/a.md").content, body.replace("\nney NEY", "\n*ney* *ney*").replace("[^1]: ney", "[^1]: *ney*"));
  const second = await f.service.preview(f.scope, "ney", "*ney*", { ...options, matchMode: "wholeWord" });
  assert.equal(second.eligible, 0);
  assert.equal((await f.service.apply(second)).totalReplacements, 0);
  assert.equal(backups(f).length, 1);
});

for (const [name, content, query, replacement, settings, expected, count] of [
  ["apostrophes", "---\ntitle: 'ney'\n---\n'ney'\n[^1]: 'ney'", "'", "’", {}, "---\ntitle: 'ney'\n---\n’ney’\n[^1]: ’ney’", 4],
  ["case sensitive", "ney NEY Ney neyland", "ney", "word", { ignoreCase: false }, "word NEY Ney wordland", 2],
  ["literal case", "ney NEY Ney", "ney", "Word", {}, "Word Word Word", 3],
  ["accents and special characters", "café? CAFÉ? cafe? cafeX", "cafe?", "tea", { ignoreDiacritics: true }, "tea tea tea cafeX", 3],
  ["Unicode words", "été étéx préété été_ été́", "été", "", { matchMode: "wholeWord", ignoreDiacritics: true }, " étéx préété été_ ", 2],
  ["empty replacement", "ney ney", "ney", "", {}, " ", 2],
  ["literal Markdown", "ney *ney*", "ney", "*ney*", { protectMarkdown: false }, "*ney* **ney**", 2],
  ["identical replacement", "ney ney", "ney", "ney", {}, "ney ney", 0],
]) {
  test(`global replacement shares local matching rules: ${name}`, async () => {
    const f = await fixture({ "Project/a.md": content, "Project/b.md": content });
    const plan = await f.service.preview(f.scope, query, replacement, { ...options, ...settings });
    assert.equal(plan.eligible, count * 2);
    const result = await f.service.apply(plan);
    assert.equal(result.totalReplacements, count * 2);
    for (const document of plan.documents) assert.equal(document.file.content, expected);
  });
}

test("thousands of replacements use live unsaved buffers and one real undoable transaction per editor", async () => {
  const f = await fixture({ "Project/a.md": "stale", "Project/b.md": "ney ".repeat(2000), "Project/c.md": "ney ".repeat(2000) });
  const live = "---\ntitle: ney\n---\n" + "ney ".repeat(2000);
  const { editor } = f.open("Project/a.md", live);
  editor.setSelection({ line: 3, ch: 0 }, { line: 3, ch: 3 });
  const plan = await f.service.preview(f.scope, "ney", "*ney*", options);
  const savedSelections = editor.listSelections();
  assert.equal(plan.eligible, 6000);
  await f.service.apply(plan);
  assert.equal(editor.transactions.length, 1);
  assert.equal(editor.listSelections()[0].head.ch, 5);
  assert.equal(f.files.get("Project/a.md").content, editor.getValue());
  const record = JSON.parse(backups(f)[0].content);
  assert.equal(record.documents.find(({ path }) => path === "Project/a.md").original, live);
  assert.equal(record.documents.find(({ path }) => path === "Project/a.md").disk, "stale");
  assert.equal(await new GlobalSearchReplace(f.app, f.host).undoLast(), 3);
  assert.equal(editor.getValue(), live);
  assert.equal(f.files.get("Project/a.md").content, live);
  // Cmd+Z remains a genuine local transaction; global undo is a separate command.
  editor.undo();
  assert.equal(editor.getValue(), plan.documents[0].result);
  editor.undo();
  assert.equal(editor.getValue(), live);
  assert.deepEqual(editor.listSelections(), savedSelections);
});

test("synchronized autosave of the original live buffer is accepted after preview", async () => {
  const f = await fixture();
  const { file, editor } = f.open("Project/c.md", "unsaved ney");
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  file.content = editor.getValue();
  await f.service.apply(plan);
  assert.equal(file.content, "unsaved word");
});

for (const change of ["disk", "buffer", "delete", "move", "scope", "project", "closed view"]) {
  test(`stale preview is refused before writes after ${change} change`, async () => {
    const f = await fixture();
    const before = originals(f);
    const { editor, file } = f.open("Project/c.md");
    const plan = await f.service.preview(f.scope, "ney", "word", options);
    if (change === "disk") file.content = "later text";
    if (change === "buffer") editor.edit(0, 0, "later ");
    if (change === "delete") await f.vault.delete(file);
    if (change === "move") await f.fileManager.renameFile(file, "Project/Chapter/moved.md");
    if (change === "scope") await f.vault.create("Project/new.md", "ney");
    if (change === "project") f.switchProject(await f.folder("Other"));
    if (change === "closed view") f.leaves.length = 0;
    await assert.rejects(f.service.apply(plan));
    assert.equal(backups(f).length, 0);
    for (const [path, content] of before.filter(([path]) => path !== "Project/c.md")) assert.equal(f.files.get(path).content, content);
    assert.equal(editor.transactions.length, 0);
  });
}

test("read errors interrupt preview instead of silently dropping a sheet", async () => {
  const f = await fixture();
  const originalRead = f.vault.read;
  f.vault.read = async (file) => { if (file.path === "Project/c.md") throw new Error("Read failed"); return originalRead(file); };
  await assert.rejects(f.service.preview(f.scope, "ney", "word", options), reason("read"));
  assert.equal(backups(f).length, 0);
  assert.ok(originals(f).every(([, content]) => content === "ney"));
});

for (const failure of ["create", "verification"]) {
  test(`backup ${failure} failure prevents the first source write`, async () => {
    const f = await fixture();
    const before = originals(f);
    const plan = await f.service.preview(f.scope, "ney", "word", options);
    const create = f.vault.create;
    f.vault.create = async (path, content) => {
      if (path.endsWith(".json") && failure === "create") throw new Error("No space");
      return create(path, path.endsWith(".json") ? "corrupt" : content);
    };
    await assert.rejects(f.service.apply(plan), reason("backup"));
    assert.deepEqual(originals(f), before);
  });
}

for (const restorationFails of [false, true]) {
  test(`third-file failure ${restorationFails ? "preserves recoverable originals on restore failure" : "restores the complete operation"}`, async () => {
    const f = await fixture();
    const { editor } = f.open("Project/Chapter/a.md", "unsaved ney");
    const plan = await f.service.preview(f.scope, "ney", "word", options);
    const process = f.vault.process;
    let writes = 0;
    f.vault.process = async (file, callback) => {
      writes++;
      if (writes === 3 || restorationFails && file.path === "Project/Chapter/a.md" && writes > 3) throw new Error("Write failed");
      return process(file, callback);
    };
    await assert.rejects(f.service.apply(plan), reason(restorationFails ? "recovery" : "write"));
    assert.equal(editor.getValue(), "unsaved ney");
    assert.equal(f.files.get("Project/Chapter/Sub/b.md").content, "ney");
    assert.equal(f.files.get("Project/c.md").content, "ney");
    const record = JSON.parse(backups(f)[0].content);
    assert.equal(stateOf(f, backups(f)[0]), restorationFails ? "conflicts" : "restored");
    assert.equal(record.documents.length, 3);
    if (restorationFails) {
      f.vault.process = process;
      assert.equal(await new GlobalSearchReplace(f.app, f.host).undoLast(), 3);
      assert.equal(f.files.get("Project/Chapter/a.md").content, "unsaved ney");
    }
  });
}

test("undo preflights every file and refuses later edits without restoring any other sheet", async () => {
  const f = await fixture();
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  await f.service.apply(plan);
  f.files.get("Project/c.md").content = "later words";
  await assert.rejects(f.service.undoLast(), reason("conflict"));
  assert.equal(f.files.get("Project/Chapter/a.md").content, "word");
  assert.equal(f.files.get("Project/c.md").content, "later words");
  assert.equal(stateOf(f, backups(f)[0]), "complete");
});

test("an undo write failure stops restoration and preserves a recoverable operation", async () => {
  const f = await fixture();
  await f.service.apply(await f.service.preview(f.scope, "ney", "word", options));
  const immutable = backups(f)[0].content;
  const process = f.vault.process;
  f.vault.process = async () => { throw new Error("Restore failed"); };
  await assert.rejects(f.service.undoLast(), reason("recovery"));
  assert.ok(originals(f).every(([, content]) => content === "word"));
  assert.equal(backups(f)[0].content, immutable);
  f.vault.process = process;
  assert.equal(await new GlobalSearchReplace(f.app, f.host).undoLast(), 3);
  assert.ok(originals(f).every(([, content]) => content === "ney"));
});

test("interrupted operations remain recoverable after restart from the durable record", async () => {
  const f = await fixture();
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  await f.service.apply(plan);
  const backup = backups(f)[0];
  await f.vault.delete(f.files.get(`${backup.path}.state`));
  f.files.get("Project/c.md").content = "ney";
  assert.equal(await new GlobalSearchReplace(f.app, f.host).undoLast(), 3);
  assert.ok(originals(f).every(([, content]) => content === "ney"));
});

test("duplicate views are blocked; identical editor instances are safe; opening Continu invalidates preview", async () => {
  const f = await fixture();
  const first = f.open("Project/c.md", "unsaved ney");
  const second = f.open("Project/c.md", "different ney");
  await assert.rejects(f.service.preview(f.scope, "ney", "word", options), reason("views"));
  second.leaf.view.editor = first.editor;
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  f.leaves.push({ type: VIEW_SCRIVENINGS, view: { getMemberPaths: () => ["Project/c.md"] } });
  await assert.rejects(f.service.apply(plan), reason("continu"));
  await assert.rejects(f.service.preview(f.scope, "ney", "word", options), reason("continu"));
  assert.equal(first.editor.transactions.length, 0);
  assert.equal(backups(f).length, 0);
});

test("several open tabs save their own unsaved buffers through the native view path", async () => {
  const f = await fixture();
  const first = f.open("Project/c.md", "first ney");
  const second = f.open("Project/Chapter/a.md", "second ney");
  await f.service.apply(await f.service.preview(f.scope, "ney", "word", options));
  assert.equal(first.editor.getValue(), "first word");
  assert.equal(second.editor.getValue(), "second word");
  assert.equal(first.file.content, first.editor.getValue());
  assert.equal(second.file.content, second.editor.getValue());
  assert.equal(first.editor.transactions.length, 1);
  assert.equal(second.editor.transactions.length, 1);
  await f.service.undoLast();
  assert.equal(first.file.content, "first ney");
  assert.equal(second.file.content, "second ney");
});

test("Continu outside the explicit file scope is untouched and does not block that scope", async () => {
  const f = await fixture();
  f.leaves.push({ type: VIEW_SCRIVENINGS, view: { getMemberPaths: () => ["Project/c.md"] } });
  const scope = { type: "file", projectRoot: "Project", path: "Project/Chapter/a.md" };
  await f.service.apply(await f.service.preview(scope, "ney", "word", options));
  assert.equal(f.files.get("Project/c.md").content, "ney");
});

test("loading or recomposing Continu blocks writes while its future members are unknown", async () => {
  const f = await fixture();
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  f.leaves.push({ type: VIEW_SCRIVENINGS, view: { getMemberPaths: () => [], editorView: null } });
  await assert.rejects(f.service.apply(plan), reason("continuLoading"));
  assert.equal(backups(f).length, 0);
  assert.ok(originals(f).every(([, content]) => content === "ney"));
});

test("preview snapshots matching options before asynchronous reads", async () => {
  const f = await fixture({ "Project/a.md": "NEY", "Project/b.md": "NEY" });
  const settings = { ...options };
  const read = f.vault.read;
  f.vault.read = async (file) => { settings.ignoreCase = false; return read(file); };
  const plan = await f.service.preview(f.scope, "ney", "word", settings);
  assert.equal(plan.eligible, 2);
  await f.service.apply(plan);
  assert.ok(originals(f).every(([, content]) => content === "word"));
});

test("switching away and back to the same project invalidates the previous confirmation", async () => {
  const f = await fixture();
  const before = originals(f);
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  f.service.invalidateContext();
  await assert.rejects(f.service.apply(plan), reason("project"));
  assert.deepEqual(originals(f), before);
  assert.equal(backups(f).length, 0);
});

test("project changes during the operation restore only the original authorized files", async () => {
  const f = await fixture();
  const other = await f.folder("Other");
  const outside = await f.vault.create("Other/a.md", "ney");
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  const process = f.vault.process;
  let changed = false;
  f.vault.process = async (file, callback) => {
    const result = await process(file, callback);
    if (!changed) { changed = true; f.switchProject(other); }
    return result;
  };
  await assert.rejects(f.service.apply(plan), reason("project"));
  assert.equal(outside.content, "ney");
  assert.ok(originals(f).every(([, content]) => content === "ney"));
});

test("a later edit during failure is kept and the conflicting path is reported", async () => {
  const f = await fixture();
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  const process = f.vault.process;
  let writes = 0;
  f.vault.process = async (file, callback) => {
    if (++writes === 3) {
      f.files.get("Project/Chapter/a.md").content = "later edit";
      throw new Error("Write failed");
    }
    return process(file, callback);
  };
  await assert.rejects(f.service.apply(plan), (error) => error.reason === "recovery" && error.paths.includes("Project/Chapter/a.md") && error.backupPath.endsWith(".json"));
  assert.equal(f.files.get("Project/Chapter/a.md").content, "later edit");
  assert.equal(f.files.get("Project/Chapter/Sub/b.md").content, "ney");
});

test("homonymous sheets, rapid operations and ZIP rotation retain separate exact originals", async () => {
  const f = await fixture({ "Project/A/scene.md": "ney A", "Project/B/scene.md": "ney B" });
  for (const [query, replacement] of [["ney", "word"], ["word", "text"]]) await f.service.apply(await f.service.preview(f.scope, query, replacement, options));
  assert.equal(backups(f).length, 2);
  assert.equal(new Set(backups(f).map(({ path }) => path)).size, 2);
  await f.vault.create("Project/_Feuillets/Backups/old.zip", "older ZIP");
  await createProjectBackup(f.app, f.project, { backupKeepCount: 1 });
  assert.equal(f.files.has("Project/_Feuillets/Backups/old.zip"), false);
  assert.equal(backups(f).length, 2);
  assert.equal(await f.service.undoLast(), 2);
  assert.equal(f.files.get("Project/A/scene.md").content, "word A");
  assert.equal(await f.service.undoLast(), 2);
  assert.equal(f.files.get("Project/B/scene.md").content, "ney B");
});

test("status write failure preserves immutable originals and rolls back source changes", async () => {
  const f = await fixture();
  const before = originals(f);
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  const create = f.vault.create;
  f.vault.create = async (path, content) => {
    if (path.endsWith(".state")) throw new Error("Status write failed");
    return create(path, content);
  };
  await assert.rejects(f.service.apply(plan), reason("recovery"));
  assert.deepEqual(originals(f), before);
  const record = JSON.parse(backups(f)[0].content);
  assert.deepEqual(record.documents.map(({ path, original }) => [path, original]).sort(), before.sort());
  f.vault.create = create;
  assert.equal(await new GlobalSearchReplace(f.app, f.host).undoLast(), 3);
});

test("a backup created in the same clock tick remains ordered across service restarts", async () => {
  const f = await fixture();
  const clock = Date.now;
  Date.now = () => 1700000000000;
  try {
    await f.service.apply(await f.service.preview(f.scope, "ney", "word", options));
    const restarted = new GlobalSearchReplace(f.app, f.host);
    await restarted.apply(await restarted.preview(f.scope, "word", "text", options));
    assert.equal(await restarted.undoLast(), 3);
    assert.ok(originals(f).every(([, content]) => content === "word"));
  } finally { Date.now = clock; }
});

test("real disk writes preserve exact originals before application and survive restart for undo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "feuillets-search-replace-"));
  try {
    const f = await fixture({ "Project/A/scene.md": "---\ntitle: 'ney'\n---\n'ney'", "Project/B/scene.md": "[^1]: 'ney'" });
    for (const [path, content] of originals(f)) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), content, "utf8");
    }
    const create = f.vault.create;
    const createFolder = f.vault.createFolder;
    f.vault.createFolder = async (path) => { await mkdir(join(directory, path), { recursive: true }); return createFolder(path); };
    f.vault.read = (file) => readFile(join(directory, file.path), "utf8");
    f.vault.create = async (path, content) => { await writeFile(join(directory, path), content, { encoding: "utf8", flag: "wx" }); return create(path, content); };
    f.vault.modify = async (file, content) => { await writeFile(join(directory, file.path), content, "utf8"); file.content = content; };
    let firstWrite = true;
    f.vault.process = async (file, callback) => {
      if (firstWrite) {
        firstWrite = false;
        const record = JSON.parse(await readFile(join(directory, backups(f)[0].path), "utf8"));
        for (const document of record.documents) assert.equal(await readFile(join(directory, document.path), "utf8"), document.original);
      }
      const result = callback(await f.vault.read(file));
      await f.vault.modify(file, result);
      return result;
    };
    const before = originals(f);
    const plan = await f.service.preview(f.scope, "'", "’", options);
    await f.service.apply(plan);
    for (const document of plan.documents) assert.equal(await readFile(join(directory, document.path), "utf8"), document.result);
    const immutable = await readFile(join(directory, backups(f)[0].path), "utf8");
    assert.equal(await new GlobalSearchReplace(f.app, f.host).undoLast(), 2);
    for (const [path, content] of before) assert.equal(await readFile(join(directory, path), "utf8"), content);
    assert.equal(await readFile(join(directory, backups(f)[0].path), "utf8"), immutable);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("confirmation renders groups lazily, cancels without writes and settles a double click only once", async () => {
  const contents = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`Project/${i}.md`, "ney ".repeat(150)]));
  const f = await fixture(contents);
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  const modal = new SearchReplaceConfirmModal(f.app, plan, "Project");
  const confirmation = modal.confirm();
  assert.equal(modal.contentEl.querySelectorAll("details").length, 20);
  assert.equal(modal.contentEl.querySelectorAll("summary").length, 20);
  const details = modal.contentEl.querySelector("details");
  assert.equal(details.querySelectorAll("span").length, 0);
  details.open = true;
  details.dispatchEvent({ type: "toggle" });
  assert.equal(details.querySelectorAll("span").length, 200);
  details.querySelector("button").click();
  assert.equal(details.querySelectorAll("span").length, 400);
  const confirm = modal.contentEl.querySelectorAll("button").find((button) => button.textContent === "Replace in 45 sheets");
  confirm.click(); confirm.click();
  assert.equal(await confirmation, true);
  assert.equal(confirm.disabled, true);
  assert.equal(backups(f).length, 0);
  const closing = new SearchReplaceConfirmModal(f.app, plan, "Project");
  const cancelled = closing.confirm();
  closing.onClose();
  assert.equal(await cancelled, false);
  assert.deepEqual(originals(f), Object.entries(contents));
});

test("concurrent confirmations cannot apply the same operation twice", async () => {
  const f = await fixture();
  const plan = await f.service.preview(f.scope, "ney", "word", options);
  const first = f.service.apply(plan);
  await assert.rejects(f.service.apply(plan), reason("busy"));
  await first;
  assert.equal(backups(f).length, 1);
  await assert.rejects(f.service.apply(plan), reason("changed"));
});

test("undo status reads the durable record after restart without writing and agrees with conflict validation", async () => {
  const f = await fixture();
  assert.equal(await f.service.getUndoStatus(), null);
  await f.service.apply(await f.service.preview(f.scope, "ney", "word", options));
  const restarted = new GlobalSearchReplace(f.app, f.host);
  const before = [...f.files.values()].map((file) => [file.path, file.content]);
  assert.deepEqual(await restarted.getUndoStatus(), { totalReplacements: 3, filesCount: 3, complete: true });
  assert.deepEqual([...f.files.values()].map((file) => [file.path, file.content]), before);
  const { editor } = f.open("Project/c.md");
  editor.edit(0, 0, "later ");
  const status = await restarted.getUndoStatus();
  assert.equal(status.error.reason, "conflict");
  assert.deepEqual(status.error.paths, ["Project/c.md"]);
  await assert.rejects(restarted.undoLast(), reason("conflict"));
  editor.undo();
  assert.equal((await restarted.getUndoStatus()).error, undefined);
  await restarted.undoLast();
  assert.equal(await restarted.getUndoStatus(), null);
});

test("undo status refuses unreadable or invalid backups and does not advertise an operation from another project", async () => {
  const f = await fixture();
  await f.service.apply(await f.service.preview(f.scope, "ney", "word", options));
  const record = backups(f)[0];
  const original = record.content;
  record.content = JSON.stringify({ version: 1 });
  await assert.rejects(f.service.getUndoStatus(), reason("backup"));
  record.content = original;
  const elsewhere = await f.folder("Elsewhere");
  f.switchProject(elsewhere);
  assert.equal(await f.service.getUndoStatus(), null);
});
