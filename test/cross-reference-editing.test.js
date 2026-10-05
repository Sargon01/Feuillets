import test from "node:test";
import assert from "node:assert/strict";
import { TFolder, MarkdownView, Modal, editorInfoField, editorLivePreviewField } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { createProjectScope, createSelectionScope, createFileScope, createFolderScope } from "../src/services/compile-scope.js";
import { detectCrossReferenceTargets } from "../src/services/cross-reference-detection.js";
import { parseImageMarkdown, formatCaptionedImageMarkdown } from "../src/services/image-markdown.js";
import { emptyCrossReferenceStore, serializeCrossReferenceStore } from "../src/services/cross-reference-model.js";
import { createCrossReferenceLink } from "../src/services/cross-reference-resolution.js";
import { crossReferenceStorePath, loadCrossReferenceStore, saveCrossReferenceStore, addCrossReferenceLinkFromContents } from "../src/services/cross-reference-store.js";
import { createCrossReferenceDetectionSession, loadCrossReferenceContext, resolveCrossReferencesInContext, crossReferenceBoundaryScope, crossReferenceProjectSettings } from "../src/services/cross-reference-context.js";
import { registerDeclaredWorkspaceRoot, unregisterDeclaredWorkspaceRoot } from "../src/services/folder-workspaces.js";
import { registerOuvrage } from "../src/services/editorial-roots.js";
import { formatCrossReference } from "../src/services/cross-reference-format.js";
import { CrossReferenceEditorController } from "../src/services/cross-reference-editor-controller.js";
import { crossReferenceReplacements, compositeCrossReferenceReplacements } from "../src/services/cross-reference-render.js";
import { buildScriveningsDocument, applyCompositeChanges, locationToCompositeOffset } from "../src/services/scrivenings-document.js";
import { ScriveningsView, ScriveningsSession } from "../src/views/scrivenings-view.js";
import { ScriveningsSegmentEditorAdapter, offsetToLineCol, lineColToOffset } from "../src/utils/scrivenings-editor-adapter.js";
import { createCrossReferenceExtension, visibleCrossReferenceReplacements, CrossReferenceWidget, notifyCrossReferenceEditors } from "../src/utils/cm-cross-references.js";
import { chooseCrossReferenceTarget, chooseCrossReferenceMode } from "../src/ui/cross-reference-modal.js";
import { setLocale } from "../src/i18n/index.js";

async function fixture() {
  const volume = new TFolder("Project");
  const root = new TFolder("Project/Manuscrit");
  root.parent = volume; volume.children = [root];
  const { vault, files, fileManager } = createFakeVault([volume, root]);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: root.path, projects: [root.path], projectMeta: { [root.path]: {} }, orders: {}, folderPositions: {} };
  const a = await vault.create(`${root.path}/A.md`, "# A\n\n![Map A](a.png)\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n");
  const b = await vault.create(`${root.path}/B.md`, "# B\n\n![Map B](b.png)");
  const ref = await vault.create(`${root.path}/Reference.md`, "Voir figure 99.");
  const annexes = await vault.createFolder(`${root.path}/Appendices`);
  await vault.create(`${annexes.path}/One.md`, "# Annex one");
  await vault.create(`${annexes.path}/Two.md`, "# Annex two");
  settings.orders[root.path] = ["A.md", "B.md", "Reference.md", "Appendices"];
  settings.orders[annexes.path] = ["Two.md", "One.md"];
  return { app, settings, root, a, b, ref, files, scope: createProjectScope(root.path) };
}

function link(state, type = "figure", targetFile = state.b, content = state.ref.content, displayMode = "type-number") {
  const detected = detectCrossReferenceTargets(targetFile.path, targetFile.content).find((target) => target.type === type);
  const start = content.indexOf("figure 99");
  return createCrossReferenceLink(emptyCrossReferenceStore(), detected, targetFile.content, state.ref.path, content, start, start + 9, displayMode);
}

function editor(value, from = value.length, to = from) {
  return {
    value, from, to,
    getValue() { return this.value; },
    getCursor(which = "to") { return offsetToLineCol(this.value, which === "from" ? this.from : this.to); },
    posToOffset(pos) { return lineColToOffset(this.value, pos); },
    offsetToPos(offset) { return offsetToLineCol(this.value, offset); },
    somethingSelected() { return this.from !== this.to; },
    getSelection() { return this.value.slice(this.from, this.to); },
    replaceRange(text, from, to = from) {
      const start = this.posToOffset(from); const end = this.posToOffset(to);
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.from = this.to = start + text.length;
    },
    replaceSelection(text) { this.replaceRange(text, this.getCursor("from"), this.getCursor("to")); },
    setCursor(pos) { this.from = this.to = this.posToOffset(pos); },
    setSelection(from, to = from) { this.from = this.posToOffset(from); this.to = this.posToOffset(to); },
    focus() {}, scrollIntoView() {},
    getLine(line) { return this.value.split("\n")[line]; }, lastLine() { return this.value.split("\n").length - 1; },
    setValue(value) { this.value = value; },
  };
}

function controller(state, options = {}) {
  const notices = []; const choices = []; const modes = []; let changes = 0;
  const instance = new CrossReferenceEditorController({
    app: state.app, getSettings: () => state.settings, getLocale: () => options.locale ?? "fr",
    getWorkspaceFolder: () => options.getWorkspaceFolder?.() ?? null,
    chooseTarget: async (targets) => { choices.push(targets); return options.chooseTarget ? options.chooseTarget(targets) : targets.find((target) => target.detectedTarget.titleOrCaption === "Map B"); },
    chooseMode: async (items) => { modes.push(items); return options.chooseMode ? options.chooseMode(items) : options.mode ?? "type-number"; },
    notify: (notice) => notices.push(notice), changed: () => changes++,
  });
  return { instance, notices, choices, modes, changes: () => changes };
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function delayedStoreWrite(t, state) {
  const entered = deferred(); const release = deferred(); const create = state.app.vault.create;
  t.mock.method(state.app.vault, "create", async (path, content) => {
    if (path.endsWith("cross-references.json")) { entered.resolve(); await release.promise; }
    return create(path, content);
  });
  t.after(() => release.resolve());
  return { entered: entered.promise, release };
}

function continuous(state, entries, from, to = from) {
  const view = Object.create(ScriveningsView.prototype);
  view.session = { document: buildScriveningsDocument(entries) };
  const cm = {
    state: { selection: { main: { from, to, empty: from === to } } },
    dispatch(spec) {
      if (spec.changes) {
        const result = applyCompositeChanges(view.session.document, [spec.changes]); assert.ok(result);
        view.session.document = result.document;
      }
      if (spec.selection) {
        const from = spec.selection.anchor; const to = spec.selection.head ?? from;
        this.state.selection = { main: { from, to, empty: from === to } };
      }
    },
    focus() {},
  };
  Object.defineProperty(cm.state, "doc", { get: () => ({ length: view.session.document.text.length, sliceString: (from, to) => view.session.document.text.slice(from, to), toString: () => view.session.document.text }) });
  view.cm = cm;
  view._compileScope = createSelectionScope(state.root.path, entries.map((entry) => entry.file.path));
  const context = view.resolveCursorEditorContext();
  const adapter = context ? new ScriveningsSegmentEditorAdapter(cm, context.file.path, (path) => view.getSegmentByPath(path)) : null;
  const read = async (file) => { const segment = view.getSegmentByPath(file.path); return segment ? segment.frontmatter + segment.body : state.app.vault.read(file); };
  return { view, cm, context, adapter, read };
}

test("XRef context: all detected targets count with independent flat numeric sequences", async () => {
  const state = await fixture(); const context = await loadCrossReferenceContext(state.app, state.settings, state.scope);
  for (const [type, numbers] of [["section", [1, 2, 3, 4]], ["figure", [1, 2]], ["table", [1]], ["appendix", [1, 2]]]) {
    assert.deepEqual(context.targets.filter((target) => target.detectedTarget.type === type).map((target) => target.number), numbers);
  }
  assert.deepEqual(await loadCrossReferenceStore(state.app, state.settings), emptyCrossReferenceStore());
});

test("XRef context: Binder order precedes source offsets, without chapter/scene numbering", async () => {
  const state = await fixture();
  state.settings.orders[state.root.path] = ["B.md", "A.md"];
  state.settings.chapterNumbering = "parPartie"; state.settings.sceneNumbering = "hier";
  const first = await loadCrossReferenceContext(state.app, state.settings, state.scope);
  assert.equal(first.targets.filter((target) => target.detectedTarget.type === "figure")[0].detectedTarget.sourceFile, state.b.path);
  const withinA = first.targets.filter((target) => target.detectedTarget.sourceFile === state.a.path);
  assert.deepEqual(withinA.map((target) => target.detectedTarget.anchor.start), [...withinA.map((target) => target.detectedTarget.anchor.start)].sort((a, b) => a - b));
  state.settings.chapterNumbering = "aucune"; state.settings.sceneNumbering = "aucune";
  assert.deepEqual(await loadCrossReferenceContext(state.app, state.settings, state.scope), first);
});

test("XRef context: same persistent target has different numbers in different scopes", async () => {
  const state = await fixture(); const created = link(state); const snapshot = serializeCrossReferenceStore(created.store);
  const full = await resolveCrossReferencesInContext(state.app, state.settings, state.scope, created.store);
  const partial = await resolveCrossReferencesInContext(state.app, state.settings, createSelectionScope(state.root.path, [state.b.path, state.ref.path]), created.store);
  assert.equal(full.targets.get(created.target.id).number, 2); assert.equal(partial.targets.get(created.target.id).number, 1);
  assert.equal(full.targets.get(created.target.id).status, "resolved");
  assert.equal(serializeCrossReferenceStore(created.store), snapshot);
});

test("XRef context: out-of-scope is distinct from missing and has no number", async () => {
  const state = await fixture(); const created = link(state);
  const scope = createFileScope(state.root.path, state.ref.path);
  const result = await resolveCrossReferencesInContext(state.app, state.settings, scope, created.store);
  const target = result.targets.get(created.target.id);
  assert.equal(target.status, "out-of-scope"); assert.equal("number" in target, false); assert.equal(target.detectedTarget.titleOrCaption, "Map B");
  await state.app.vault.delete(state.b);
  assert.equal((await resolveCrossReferencesInContext(state.app, state.settings, scope, created.store)).targets.get(created.target.id).status, "missing");
});

test("XRef context: duplicated target remains ambiguous even outside scope", async () => {
  const state = await fixture(); const created = link(state);
  state.b.content += "\n\n" + state.b.content;
  const result = await resolveCrossReferencesInContext(state.app, state.settings, createFileScope(state.root.path, state.ref.path), created.store);
  assert.equal(result.targets.get(created.target.id).status, "ambiguous");
});

test("XRef context: current caption comes from live content", async () => {
  const state = await fixture(); const created = link(state);
  const live = state.b.content.replace("Map B", "Current caption");
  const result = await resolveCrossReferencesInContext(state.app, state.settings, state.scope, created.store, async (file) => file === state.b ? live : file.content);
  assert.equal(result.targets.get(created.target.id).detectedTarget.titleOrCaption, "Current caption");
  assert.equal(created.target.titleOrCaption, "Map B");
});

test("XRef context: unchanged files reuse one Markdown parse across resolutions and scope changes", async () => {
  const state = await fixture(); const created = link(state); const parses = [];
  const detect = createCrossReferenceDetectionSession((path, content, options) => {
    parses.push(path); return detectCrossReferenceTargets(path, content, options);
  });
  const read = async (file) => file.content;
  await resolveCrossReferencesInContext(state.app, state.settings, state.scope, created.store, read, detect);
  assert.equal(parses.filter((path) => path === state.b.path).length, 1);
  const count = parses.length;
  const partial = await resolveCrossReferencesInContext(state.app, state.settings, createSelectionScope(state.root.path, [state.b.path, state.ref.path]), created.store, read, detect);
  assert.equal(parses.length, count); assert.equal(partial.targets.get(created.target.id).number, 1);
  state.b.content = state.b.content.replace("Map B", "Current map");
  const updated = await resolveCrossReferencesInContext(state.app, state.settings, state.scope, created.store, read, detect);
  assert.equal(parses.length, count + 1); assert.equal(parses.at(-1), state.b.path);
  assert.equal(updated.targets.get(created.target.id).detectedTarget.titleOrCaption, "Current map");
});

test("XRef context: normal editor defaults to its registered editorial root and excludes technical folders", async () => {
  const state = await fixture(); const book = await state.app.vault.createFolder(`${state.root.path}/Book`);
  const file = await state.app.vault.create(`${book.path}/Sheet.md`, "# In book");
  state.settings.projectMeta[state.root.path].folderWorkspaces = { Book: { version: 1, ouvrage: { version: 1 } } };
  const technical = await state.app.vault.createFolder(`${book.path}/_Recherche`); await state.app.vault.create(`${technical.path}/Source.md`, "# Technical");
  const scope = crossReferenceBoundaryScope(state.app, state.settings, file);
  assert.deepEqual(scope, createFolderScope(state.root.path, book.path));
  assert.deepEqual((await loadCrossReferenceContext(state.app, state.settings, scope)).targets.map((target) => target.detectedTarget.titleOrCaption), ["In book"]);
});

for (const [name, parentIdentity, childIdentity, isolationLocation, expected] of [
  ["simple workspace", "workspace", null, null, "parent"],
  ["nested workspaces", "workspace", "workspace", null, "child"],
  ["workspace then work", "workspace", "ouvrage", null, "child"],
  ["work then workspace", "ouvrage", "workspace", null, "child"],
  ["both identities", null, "both", null, "child"],
  ["deeper isolation", "workspace", null, "part", "part"],
  ["wider isolation", "workspace", "workspace", "parent", "child"],
  ["unrelated isolation", "workspace", null, "sibling", "parent"],
  ["no boundary", null, null, null, "project"],
  ["ordinary overrides", "override", "override", null, "project"],
  ["isolation only", null, null, "child", "child"],
  ["equal isolation", "workspace", null, "parent", "parent"],
]) {
  test(`XRef boundary: ${name} preserves the real project and excludes unrelated isolation`, async () => {
    const state = await fixture();
    const parent = await state.app.vault.createFolder(`${state.root.path}/WARPI`);
    const child = await state.app.vault.createFolder(`${parent.path}/NEFES`);
    const part = await state.app.vault.createFolder(`${child.path}/Part I`);
    const sibling = await state.app.vault.createFolder(`${state.root.path}/Sibling`);
    const file = await state.app.vault.create(`${part.path}/Scene.md`, "# Scene");
    for (const [folder, identity] of [[parent, parentIdentity], [child, childIdentity]]) {
      if (identity === "workspace" || identity === "both") registerDeclaredWorkspaceRoot(state.settings, state.root, folder);
      if (identity === "ouvrage" || identity === "both") registerOuvrage(state.settings, state.root, folder);
      if (identity === "override") {
        state.settings.projectMeta[state.root.path].folderWorkspaces ??= {};
        state.settings.projectMeta[state.root.path].folderWorkspaces[folder.path.slice(state.root.path.length + 1)] =
          { version: 1, wordGoal: 2000, citekeyBibliographyPath: "local.bib" };
      }
    }
    const before = structuredClone(state.settings);
    const locations = { parent, child, part, sibling, project: state.root };
    const scope = crossReferenceBoundaryScope(state.app, state.settings, file, isolationLocation ? locations[isolationLocation] : null);
    assert.deepEqual(scope, expected === "project" ? state.scope : createFolderScope(state.root.path, locations[expected].path));
    assert.equal(scope.projectRoot, state.root.path);
    assert.deepEqual(state.settings, before, "boundary reads must not declare or isolate folders");
  });
}

test("XRef boundary: an isolation belonging to a different registered project is ignored", async () => {
  const state = await fixture(); const other = await state.app.vault.createFolder("Other");
  state.settings.projects.push(other.path);
  assert.deepEqual(crossReferenceBoundaryScope(state.app, state.settings, state.a, other), state.scope);
  const nestedProject = await state.app.vault.createFolder(`${state.root.path}/Independent`);
  const file = await state.app.vault.create(`${nestedProject.path}/File.md`, "# Other project");
  state.settings.projects.push(nestedProject.path);
  assert.deepEqual(crossReferenceBoundaryScope(state.app, state.settings, file, state.root), createProjectScope(nestedProject.path));
  assert.equal(crossReferenceProjectSettings(state.app, state.settings, file.path).projectFolder, nestedProject.path);
});

async function workspaceFixture() {
  const state = await fixture();
  const workspace = await state.app.vault.createFolder(`${state.root.path}/NEFES`);
  const first = await state.app.vault.createFolder(`${workspace.path}/Part I`);
  const second = await state.app.vault.createFolder(`${workspace.path}/Part II`);
  const sibling = await state.app.vault.createFolder(`${state.root.path}/Sibling`);
  const earlier = await state.app.vault.create(`${second.path}/Earlier.md`, "![Earlier map](earlier.png)");
  const target = await state.app.vault.create(`${first.path}/Target.md`, "![Current map](map.png)");
  const source = await state.app.vault.create(`${first.path}/Reference.md`, "Voir figure 99.");
  const siblingTarget = await state.app.vault.create(`${sibling.path}/Target.md`, "![Sibling map](sibling.png)");
  const siblingSource = await state.app.vault.create(`${sibling.path}/Reference.md`, "Voir ");
  registerDeclaredWorkspaceRoot(state.settings, state.root, workspace);
  registerDeclaredWorkspaceRoot(state.settings, state.root, sibling);
  state.settings.orders[workspace.path] = ["Part II", "Part I"];
  return { ...state, workspace, first, second, sibling, earlier, target, source, siblingTarget, siblingSource };
}

test("XRef native picker: workspace universe excludes siblings and keeps its sidecar at the real project", async () => {
  const state = await workspaceFixture();
  const scope = crossReferenceBoundaryScope(state.app, state.settings, state.source);
  const surface = editor("Voir ");
  const action = controller(state, { chooseTarget: (targets) => targets.find((target) => target.detectedTarget.titleOrCaption === "Current map") });
  await action.instance.insert(surface, state.source, scope);
  assert.deepEqual(action.choices[0].map((target) => target.detectedTarget.sourceFile), [state.earlier.path, state.target.path]);
  assert.equal(surface.value, "Voir image 2");
  const storeSettings = crossReferenceProjectSettings(state.app, state.settings, state.source.path);
  assert.equal(storeSettings.projectFolder, state.root.path);
  const store = await loadCrossReferenceStore(state.app, storeSettings);
  assert.equal(store.version, 1); assert.equal(store.targets[0].type, "figure");
  assert.match(serializeCrossReferenceStore(store), /"type": "figure"/);
  assert.equal(store.occurrences[0].anchor.quote, "image 2");
  assert.equal(store.targets[0].sourceFile, state.target.path);
  assert.equal(state.files.get(crossReferenceStorePath(state.app, state.settings)).content, serializeCrossReferenceStore(store));
  assert.equal([...state.files.keys()].filter((path) => path.endsWith("cross-references.json")).length, 1);
  assert.equal(crossReferenceStorePath(state.app, storeSettings), crossReferenceStorePath(state.app, state.settings));
  assert.ok(!crossReferenceStorePath(state.app, storeSettings).startsWith(`${state.workspace.path}/`));
  assert.equal(state.source.content, "Voir figure 99.");
});

test("XRef workspace appendices: reuse Annexes recognition with the true project in both folder and project scopes", async () => {
  const state = await workspaceFixture();
  const annexes = await state.app.vault.createFolder(`${state.workspace.path}/Annexes`);
  const appendix = await state.app.vault.create(`${annexes.path}/Chronology.md`, "# Chronology");
  for (const scope of [crossReferenceBoundaryScope(state.app, state.settings, state.source), state.scope]) {
    const context = await loadCrossReferenceContext(state.app, state.settings, scope);
    assert.equal(context.targets.find((target) => target.detectedTarget.sourceFile === appendix.path
      && target.detectedTarget.type === "appendix").detectedTarget.titleOrCaption, "Chronology");
    assert.equal(scope.projectRoot, state.root.path);
  }
});

test("XRef Continu: picker follows the real segment boundary while numbering keeps the exact folder scope", async () => {
  const state = await workspaceFixture();
  const entries = [{ file: state.target, content: state.target.content }, { file: state.source, content: "Voir " }];
  const current = continuous(state, entries, buildScriveningsDocument(entries).segments[1].to);
  const scope = createFolderScope(state.root.path, state.first.path); current.view._compileScope = scope;
  const action = controller(state, { chooseTarget: (targets) => targets.find((target) => target.detectedTarget.titleOrCaption === "Current map") });
  await action.instance.insert(current.adapter, state.source, current.view.compileScope, current.read);
  assert.deepEqual(action.choices[0].map((target) => target.detectedTarget.sourceFile), [state.earlier.path, state.target.path]);
  assert.equal(current.adapter.getValue(), "Voir image 1");
  assert.equal(current.view.compileScope, scope);
  const store = await loadCrossReferenceStore(state.app, state.settings);
  const resolution = await resolveCrossReferencesInContext(state.app, state.settings, scope, store, current.read);
  assert.equal(resolution.context.scope, scope);
  assert.equal(resolution.targets.get(store.targets[0].id).number, 1);
  assert.equal(crossReferenceReplacements(store, resolution, "fr")[0].text, "image 1");

  const outside = controller(state, { chooseTarget: (targets) => targets.find((target) => target.detectedTarget.titleOrCaption === "Earlier map") });
  await outside.instance.insert(current.adapter, state.source, scope, current.read);
  const withOutside = await loadCrossReferenceStore(state.app, state.settings);
  const resolved = await resolveCrossReferencesInContext(state.app, state.settings, scope, withOutside, current.read);
  const outsideTarget = withOutside.targets.find((target) => target.sourceFile === state.earlier.path);
  assert.equal(resolved.targets.get(outsideTarget.id).status, "out-of-scope");
  assert.equal(current.adapter.getValue(), "Voir image 1image 1");
});

test("XRef Continu: moving to a sibling segment changes the picker without changing the composition scope", async () => {
  const state = await workspaceFixture();
  const entries = [{ file: state.source, content: "Voir " }, { file: state.siblingSource, content: "Voir " }];
  const document = buildScriveningsDocument(entries); const current = continuous(state, entries, document.segments[0].to);
  const scope = current.view.compileScope;
  const first = controller(state, { chooseTarget: () => null });
  await first.instance.insert(current.adapter, state.source, scope, current.read);
  assert.deepEqual(first.choices[0].map((target) => target.detectedTarget.sourceFile), [state.earlier.path, state.target.path]);
  current.cm.dispatch({ selection: { anchor: document.segments[1].to } });
  const context = current.view.resolveCursorEditorContext(); assert.equal(context.file, state.siblingSource);
  const adapter = new ScriveningsSegmentEditorAdapter(current.cm, context.file.path, (path) => current.view.getSegmentByPath(path));
  const second = controller(state, { chooseTarget: () => null });
  await second.instance.insert(adapter, context.file, scope, current.read);
  assert.deepEqual(second.choices[0].map((target) => target.detectedTarget.sourceFile), [state.siblingTarget.path]);
  assert.equal(current.view.compileScope, scope);
});

test("XRef insertion: changing isolation while the picker is open invalidates the captured boundary", async () => {
  const state = await workspaceFixture(); let isolation = null; const surface = editor("Voir ");
  const action = controller(state, {
    getWorkspaceFolder: () => isolation,
    chooseTarget: (targets) => targets.find((target) => target.detectedTarget.sourceFile === state.earlier.path),
    chooseMode: () => { isolation = state.first; return "type-number"; },
  });
  await action.instance.insert(surface, state.source, crossReferenceBoundaryScope(state.app, state.settings, state.source));
  assert.equal(surface.value, "Voir "); assert.equal(action.notices.length, 1);
  assert.deepEqual(await loadCrossReferenceStore(state.app, state.settings), emptyCrossReferenceStore());
});

for (const locale of ["fr", "en"]) {
  for (const [type, expected] of [["figure", "image 2"], ["table", locale === "fr" ? "tableau 2" : "table 2"], ["section", "section 5"], ["appendix", locale === "fr" ? "annexe 1" : "appendix 1"]]) {
    test(`XRef formatting: ${locale} ${type} supports the three display modes`, () => {
      const number = Number(expected.split(" ").at(-1)); const target = { detectedTarget: { type, titleOrCaption: "Current title" }, number };
      assert.equal(formatCrossReference(target, "type-number", locale), expected);
      assert.equal(formatCrossReference(target, "number", locale), String(number));
      assert.equal(formatCrossReference(target, "title", locale), "Current title");
    });
  }
}

for (const [caption, semanticCaption] of [
  ["légende de schéma", "légende de schéma"],
  ["[Image 1] essai de légende", "essai de légende"],
  ["[Image 23] Vue générale", "Vue générale"],
  ["[Figure 4] Carte ancienne", "Carte ancienne"],
  ["Résultat comparé à [Image 1]", "Résultat comparé à [Image 1]"],
  ["[Image 2]   Vue détaillée", "Vue détaillée"],
  ["[Image 2]Vue détaillée", "Vue détaillée"],
  ["[Image 1] [Image 2] Suite", "[Image 2] Suite"],
  ["Avant [Figure 4] Carte ancienne", "Avant [Figure 4] Carte ancienne"],
  ["[Image N] Vue générale", "[Image N] Vue générale"],
  ["[Image 1.2] Vue générale", "[Image 1.2] Vue générale"],
]) {
  test(`XRef image caption: only one initial numeric prefix is removed from ${caption}`, () => {
    const markdown = formatCaptionedImageMarkdown("map.png", caption);
    assert.equal(parseImageMarkdown(markdown).caption, caption, "shared image semantics remain unchanged");
    const detected = detectCrossReferenceTargets("Project/Image.md", markdown);
    assert.equal(detected.length, 1); assert.equal(detected[0].type, "figure");
    assert.equal(detected[0].titleOrCaption, semanticCaption);
    assert.equal(detected[0].anchor.quote, markdown, "anchors still retain the complete source image");
    for (const locale of ["fr", "en"]) {
      const numbered = { detectedTarget: detected[0], number: 2 };
      assert.equal(formatCrossReference(numbered, "type-number", locale), "image 2");
      assert.equal(formatCrossReference(numbered, "number", locale), "2");
      assert.equal(formatCrossReference(numbered, "title", locale), semanticCaption);
    }
  });
}

test("XRef semantic captions: title insertion and the existing mode choices receive human caption text", async () => {
  const state = await fixture();
  state.b.content = formatCaptionedImageMarkdown("map.png", "[Image 1] essai de légende");
  const surface = editor("Voir ");
  const action = controller(state, { mode: "title", chooseTarget: (targets) => targets.find((target) => target.detectedTarget.type === "figure" && target.detectedTarget.sourceFile === state.b.path) });
  await action.instance.insert(surface, state.ref, state.scope);
  assert.equal(surface.value, "Voir essai de légende");
  assert.deepEqual(action.modes[0], [
    { mode: "type-number", text: "image 2" }, { mode: "number", text: "2" }, { mode: "title", text: "essai de légende" },
  ]);
  const store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.version, 1); assert.equal(store.targets[0].type, "figure");
  assert.equal(store.targets[0].titleOrCaption, "essai de légende");
  assert.equal(store.occurrences[0].anchor.quote, "essai de légende");
  assert.match(serializeCrossReferenceStore(store), /"type": "figure"/);
  assert.equal(parseImageMarkdown(state.b.content).caption, "[Image 1] essai de légende");
  assert.equal(state.ref.content, "Voir figure 99.");
});

test("XRef semantic captions: old title occurrences and store snapshots stay intact while native and Continu widgets use redetection", async (t) => {
  const state = await fixture();
  state.b.content = formatCaptionedImageMarkdown("map.png", "[Image 1] essai de légende");
  state.ref.content = "Voir [Image 1] essai de légende.";
  const detected = detectCrossReferenceTargets(state.b.path, state.b.content)[0];
  const historical = { ...detected, titleOrCaption: "[Image 1] essai de légende" };
  const created = createCrossReferenceLink(emptyCrossReferenceStore(), historical, state.b.content,
    state.ref.path, state.ref.content, 5, state.ref.content.length - 1, "title");
  await saveCrossReferenceStore(state.app, state.settings, created.store);
  const saved = state.files.get(crossReferenceStorePath(state.app, state.settings)).content;
  const document = buildScriveningsDocument([{ file: state.b, content: state.b.content }, { file: state.ref, content: state.ref.content }]);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const [, Native] = createCrossReferenceExtension(state.app, () => state.settings);
  const [, Continu] = createCrossReferenceExtension(state.app, () => state.settings, (file) => state.app.vault.read(file),
    () => ({ scope: createSelectionScope(state.root.path, [state.b.path, state.ref.path]), document }));
  const nativeView = fakeRenderView(state, state.ref.content);
  const continuousView = fakeRenderView(state, document.text, null);
  const native = new Native(nativeView); const continuous = new Continu(continuousView);
  t.after(() => { native.destroy(); continuous.destroy(); });
  await renderTick(t, [nativeView, continuousView], 0);
  assert.equal(native.decorations[0].widget.text, "essai de légende");
  assert.equal(continuous.decorations[0].widget.text, "essai de légende");
  assert.equal(nativeView.state.doc.toString(), "Voir [Image 1] essai de légende.");
  assert.equal(continuousView.state.doc.toString(), document.text);
  assert.equal(state.files.get(crossReferenceStorePath(state.app, state.settings)).content, saved);
  assert.equal((await loadCrossReferenceStore(state.app, state.settings)).targets[0].titleOrCaption, "[Image 1] essai de légende");
});

test("XRef insertion: cursor inserts exact human text and stores only a lateral relation", async () => {
  const state = await fixture(); const surface = editor("Voir "); const action = controller(state);
  await action.instance.insert(surface, state.ref, state.scope);
  assert.equal(surface.value, "Voir image 2"); assert.equal(action.notices.length, 0); assert.equal(action.changes(), 1);
  const store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.targets.length, 1); assert.equal(store.occurrences[0].anchor.quote, "image 2");
  assert.equal(store.occurrences[0].sourceFile, state.ref.path);
  assert.equal(surface.value.includes(store.targets[0].id), false);
  assert.equal(state.ref.content, "Voir figure 99.");
  assert.deepEqual(action.modes[0].map((item) => item.mode), ["type-number", "number", "title"]);
});

test("XRef insertion: selected existing text is linked without changing any character", async () => {
  const state = await fixture(); const value = "Voir ce passage précis."; const surface = editor(value, 5, 22); const action = controller(state, { mode: "title" });
  await action.instance.insert(surface, state.ref, state.scope);
  assert.equal(surface.value, value);
  const store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.occurrences[0].anchor.quote, value.slice(5, 22)); assert.equal(store.occurrences[0].displayMode, "title");
});

test("XRef insertion: footnote definition uses the same controller and live source", async () => {
  const state = await fixture(); const surface = editor("Body.[^12]\n\n[^12]: Voir "); const action = controller(state);
  await action.instance.insert(surface, state.ref, state.scope);
  assert.equal(surface.value, "Body.[^12]\n\n[^12]: Voir image 2");
  const store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.occurrences[0].anchor.start, surface.value.indexOf("image 2"));
  assert.equal(state.ref.content, "Voir figure 99.");
});

test("XRef insertion: live target contents are used without saving them", async () => {
  const state = await fixture(); const surface = editor("Voir ");
  const live = state.b.content.replace("Map B", "Unsaved map");
  const action = controller(state, { mode: "title", chooseTarget: (targets) => targets.find((target) => target.detectedTarget.titleOrCaption === "Unsaved map") });
  await action.instance.insert(surface, state.ref, state.scope, async (file) => file === state.b ? live : file.content);
  assert.equal(surface.value, "Voir Unsaved map"); assert.equal(state.b.content.includes("Unsaved"), false);
  assert.equal((await loadCrossReferenceStore(state.app, state.settings)).targets[0].titleOrCaption, "Unsaved map");
});

test("XRef insertion: failed store write keeps inserted text and reports failure", async (t) => {
  const state = await fixture(); const surface = editor("Voir "); const action = controller(state);
  const create = state.app.vault.create;
  t.mock.method(state.app.vault, "create", async (path, content) => { if (path.endsWith("cross-references.json")) throw new Error("Write failed"); return create(path, content); });
  t.mock.method(console, "error", () => {});
  await action.instance.insert(surface, state.ref, state.scope);
  assert.equal(surface.value, "Voir image 2"); assert.equal(action.notices.length, 1);
  assert.match(action.notices[0], /conservé/); assert.equal(action.changes(), 0);
});

test("XRef insertion: changed selection while picker is open cancels without writing", async () => {
  const state = await fixture(); const surface = editor("Voir ");
  const action = controller(state, { chooseMode: () => { surface.from = surface.to = 0; return "number"; } });
  await action.instance.insert(surface, state.ref, state.scope);
  assert.equal(surface.value, "Voir "); assert.equal(action.notices.length, 1);
  assert.deepEqual(await loadCrossReferenceStore(state.app, state.settings), emptyCrossReferenceStore());
});

test("XRef insertion: positions and focuses immediately, never again after store completion", async (t) => {
  const state = await fixture(); const surface = editor("Voir "); const action = controller(state); const gate = delayedStoreWrite(t, state);
  const cursor = t.mock.method(surface, "setCursor"); const focus = t.mock.method(surface, "focus");
  const pending = action.instance.insert(surface, state.ref, state.scope);
  await gate.entered;
  assert.equal(surface.value, "Voir image 2"); assert.equal(surface.from, surface.value.length);
  assert.equal(cursor.mock.callCount(), 1); assert.equal(focus.mock.callCount(), 1);
  gate.release.resolve(); await pending;
  assert.equal(cursor.mock.callCount(), 1); assert.equal(focus.mock.callCount(), 1);
  assert.equal(action.changes(), 1);
});

test("XRef insertion: moving the cursor during store writing preserves the new cursor", async (t) => {
  const state = await fixture(); const surface = editor("Voir "); const action = controller(state); const gate = delayedStoreWrite(t, state);
  const cursor = t.mock.method(surface, "setCursor");
  const pending = action.instance.insert(surface, state.ref, state.scope); await gate.entered;
  surface.setCursor(surface.offsetToPos(0)); gate.release.resolve(); await pending;
  assert.equal(surface.from, 0); assert.equal(surface.to, 0); assert.equal(cursor.mock.callCount(), 2);
});

test("XRef insertion: typing during store writing preserves the user's new text and cursor", async (t) => {
  const state = await fixture(); const surface = editor("Voir "); const action = controller(state); const gate = delayedStoreWrite(t, state);
  const cursor = t.mock.method(surface, "setCursor");
  const pending = action.instance.insert(surface, state.ref, state.scope); await gate.entered;
  surface.replaceRange("Continue. ", surface.offsetToPos(0)); const position = surface.from;
  gate.release.resolve(); await pending;
  assert.equal(surface.value, "Continue. Voir image 2"); assert.equal(surface.from, position);
  assert.equal(cursor.mock.callCount(), 1);
});

test("XRef insertion: changing the active editor during store writing never refocuses the old view", async (t) => {
  const state = await fixture(); const surface = editor("Voir "); const action = controller(state); const gate = delayedStoreWrite(t, state);
  let current = true;
  const focus = t.mock.method(surface, "focus"); const cursor = t.mock.method(surface, "setCursor");
  const pending = action.instance.insert(surface, state.ref, state.scope, async (file) => file.content, () => current);
  await gate.entered; current = false;
  gate.release.resolve(); await pending;
  assert.equal(focus.mock.callCount(), 1); assert.equal(cursor.mock.callCount(), 1);
});

test("XRef insertion: linking selected text leaves both text and selection intact throughout persistence", async (t) => {
  const state = await fixture(); const value = "Voir ce passage précis."; const surface = editor(value, 5, 22);
  const action = controller(state); const gate = delayedStoreWrite(t, state);
  const cursor = t.mock.method(surface, "setCursor"); const focus = t.mock.method(surface, "focus");
  const pending = action.instance.insert(surface, state.ref, state.scope); await gate.entered;
  assert.equal(surface.value, value); assert.deepEqual([surface.from, surface.to], [5, 22]);
  gate.release.resolve(); await pending;
  assert.equal(surface.value, value); assert.deepEqual([surface.from, surface.to], [5, 22]);
  assert.equal(cursor.mock.callCount(), 0); assert.equal(focus.mock.callCount(), 0);
});

test("XRef insertion: rejected delayed store write keeps inserted text and the user's current selection", async (t) => {
  const state = await fixture(); const surface = editor("Voir "); const action = controller(state); const gate = delayedStoreWrite(t, state);
  const cursor = t.mock.method(surface, "setCursor"); const focus = t.mock.method(surface, "focus");
  t.mock.method(console, "error", () => {});
  const pending = action.instance.insert(surface, state.ref, state.scope); await gate.entered;
  surface.setSelection(surface.offsetToPos(0), surface.offsetToPos(4));
  gate.release.reject(new Error("Write failed")); await pending;
  assert.equal(surface.value, "Voir image 2"); assert.deepEqual([surface.from, surface.to], [0, 4]);
  assert.equal(cursor.mock.callCount(), 1); assert.equal(focus.mock.callCount(), 1);
  assert.equal(action.notices.length, 1); assert.match(action.notices[0], /conservé/);
});

test("XRef store: explicit live-content additions retain atomic target reuse under concurrency", async () => {
  const state = await fixture(); const target = detectCrossReferenceTargets(state.b.path, state.b.content).find((target) => target.type === "figure");
  await Promise.all(["number", "title"].map((mode) => addCrossReferenceLinkFromContents(state.app, state.settings, target, state.b.content, state.ref, "see map", 4, 7, mode)));
  const store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.targets.length, 1); assert.equal(store.occurrences.length, 2);
});

test("XRef Continu: cursor resolves the real file and all offset spaces with frontmatter", async () => {
  const state = await fixture();
  const entries = [{ file: state.a, content: "First body" }, { file: state.ref, content: "---\ntitle: R\n---\nVoir " }];
  const doc = buildScriveningsDocument(entries); const segment = doc.segments[1];
  const current = continuous(state, entries, segment.to);
  assert.equal(current.context.file, state.ref); assert.equal(current.context.segment.path, state.ref.path);
  assert.equal(current.context.compositeOffset, segment.to); assert.equal(current.context.bodyOffset, 5);
  assert.equal(current.context.fileOffset, segment.frontmatter.length + 5);
  assert.ok(current.adapter instanceof ScriveningsSegmentEditorAdapter);
});

test("XRef Continu: selections spanning two files are rejected without clamping into a file", async () => {
  const state = await fixture(); const entries = [{ file: state.a, content: "First" }, { file: state.ref, content: "Second" }];
  const current = continuous(state, entries, 0, 10);
  assert.equal(current.view.resolveCursorEditorContext(), null); assert.equal(current.adapter, null);
});

test("XRef Continu: inserts in the correct segment, keeps neighboring content and uses its scope", async () => {
  const state = await fixture(); const entries = [{ file: state.b, content: state.b.content }, { file: state.ref, content: "---\ntitle: R\n---\nVoir " }];
  const current = continuous(state, entries, buildScriveningsDocument(entries).segments[1].to); const action = controller(state);
  const neighbor = current.view.getSegmentByPath(state.b.path).body;
  await action.instance.insert(current.adapter, state.ref, current.view.compileScope, current.read);
  assert.equal(current.view.getSegmentByPath(state.ref.path).body, "Voir image 1");
  assert.equal(current.view.getSegmentByPath(state.b.path).body, neighbor);
  const store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.occurrences[0].anchor.start, "---\ntitle: R\n---\n".length + 5);
  assert.equal(store.occurrences[0].sourceFile, state.ref.path);
});

test("XRef Continu: root picker allows an out-of-scope target and insertion uses its root number", async () => {
  const state = await fixture(); const entries = [{ file: state.ref, content: "Voir " }];
  const current = continuous(state, entries, 5); const action = controller(state);
  await action.instance.insert(current.adapter, state.ref, current.view.compileScope, current.read);
  assert.equal(current.view.getSegmentByPath(state.ref.path).body, "Voir image 2");
  assert.ok(action.choices[0].some((target) => target.detectedTarget.sourceFile === state.b.path));
  const store = await loadCrossReferenceStore(state.app, state.settings);
  const resolution = await resolveCrossReferencesInContext(state.app, state.settings, current.view.compileScope, store, current.read);
  assert.equal(resolution.targets.get(store.targets[0].id).status, "out-of-scope");
});

test("XRef Continu: footnote insertion and selected-text linking use the segment adapter", async () => {
  const state = await fixture(); const content = "---\ntitle: R\n---\nBody.[^1]\n\n[^1]: Voir ";
  const entries = [{ file: state.a, content: "Neighbor" }, { file: state.ref, content }];
  const doc = buildScriveningsDocument(entries); const current = continuous(state, entries, doc.segments[1].to); const action = controller(state);
  await action.instance.insert(current.adapter, state.ref, current.view.compileScope, current.read);
  assert.equal(current.adapter.getValue(), content + "image 1");
  assert.equal(current.view.getSegmentByPath(state.a.path).body, "Neighbor");
  const before = current.adapter.getValue(); const from = before.indexOf("image 1");
  current.adapter.setSelection(current.adapter.offsetToPos(from), current.adapter.offsetToPos(from + "image 1".length));
  await action.instance.insert(current.adapter, state.ref, current.view.compileScope, current.read);
  assert.equal(current.adapter.getValue(), before);
});

test("XRef render: contextual numbering changes widgets while source and store stay unchanged", async () => {
  const state = await fixture(); const created = link(state); const snapshot = serializeCrossReferenceStore(created.store);
  const full = await resolveCrossReferencesInContext(state.app, state.settings, state.scope, created.store);
  const partial = await resolveCrossReferencesInContext(state.app, state.settings, createSelectionScope(state.root.path, [state.b.path, state.ref.path]), created.store);
  assert.equal(crossReferenceReplacements(created.store, full, "fr")[0].text, "image 2");
  assert.equal(crossReferenceReplacements(created.store, partial, "fr")[0].text, "image 1");
  assert.equal(state.ref.content, "Voir figure 99."); assert.equal(serializeCrossReferenceStore(created.store), snapshot);
});

test("XRef render: title mode uses the current label and notes use identical replacements", async () => {
  const state = await fixture(); const content = "Body.[^1]\n\n[^1]: Voir figure 99.";
  const created = link(state, "figure", state.b, content, "title");
  const live = state.b.content.replace("Map B", "New map title");
  const resolution = await resolveCrossReferencesInContext(state.app, state.settings, state.scope, created.store, async (file) => file === state.b ? live : file === state.ref ? content : file.content);
  const replacements = crossReferenceReplacements(created.store, resolution, "fr");
  assert.equal(replacements.length, 1); assert.equal(replacements[0].text, "New map title");
  assert.equal(replacements[0].from, content.indexOf("figure 99"));
});

for (const status of ["missing", "ambiguous", "out-of-scope"]) {
  test(`XRef render: ${status} target keeps raw human Markdown`, async () => {
    const state = await fixture(); const created = link(state);
    const resolution = { targets: new Map([[created.target.id, { status }]]), occurrences: new Map([[created.occurrence.id, { status: "attached", range: { start: 5, end: 14 } }]]) };
    assert.deepEqual(crossReferenceReplacements(created.store, resolution, "fr"), []);
  });
}

test("XRef render: detached occurrences never produce replacements", async () => {
  const state = await fixture(); const created = link(state);
  const result = await resolveCrossReferencesInContext(state.app, state.settings, state.scope, created.store, async (file) => file === state.ref ? "Deleted reference" : file.content);
  assert.deepEqual(crossReferenceReplacements(created.store, result, "fr"), []);
});

for (const [name, live, selection, expected] of [
  ["Live Preview", true, [{ from: 0, to: 0 }], 1], ["Source", false, [{ from: 0, to: 0 }], 0],
  ["cursor inside", true, [{ from: 7, to: 7 }], 0], ["cursor at start", true, [{ from: 5, to: 5 }], 0],
  ["cursor at end", true, [{ from: 14, to: 14 }], 1], ["overlapping selection", true, [{ from: 0, to: 9 }], 0],
  ["reversed selection", true, [{ from: 20, to: 8 }], 0], ["adjacent selection", true, [{ from: 0, to: 5 }], 1],
]) {
  test(`XRef render: ${name} follows the shared cursor-reveal rule`, () => {
    const ranges = [{ from: 5, to: 14, sourceFile: "File.md", text: "image 2" }];
    assert.equal(visibleCrossReferenceReplacements(ranges, { ranges: selection }, live).length, expected);
  });
}

test("XRef Continu render: file-local ranges map through the composite source map including frontmatter", async () => {
  const state = await fixture(); const content = "---\ntitle: R\n---\n[^1]: Voir figure 99.";
  const created = link(state, "figure", state.b, content);
  const document = buildScriveningsDocument([{ file: state.a, content: state.a.content }, { file: state.ref, content }, { file: state.b, content: state.b.content }]);
  const result = await resolveCrossReferencesInContext(state.app, state.settings, state.scope, created.store, async (file) => file === state.ref ? content : file.content);
  const local = crossReferenceReplacements(created.store, result, "fr"); const composite = compositeCrossReferenceReplacements(document, local);
  assert.equal(composite[0].text, local[0].text);
  const segment = document.segments[1];
  assert.equal(composite[0].from, locationToCompositeOffset(document, state.ref.path, content.indexOf("figure 99") - segment.frontmatter.length));
  assert.equal(document.text.slice(composite[0].from, composite[0].to), "figure 99");
});

test("XRef widget: textContent creates plain text, with no HTML interpretation or identifier", () => {
  const widget = new CrossReferenceWidget("<caption>");
  const ownerDocument = { createElement: (tag) => ({ tag }) };
  const dom = widget.toDOM({ dom: { ownerDocument } });
  assert.equal(dom.tag, "span"); assert.equal(dom.textContent, "<caption>");
  assert.equal(widget.eq(new CrossReferenceWidget("<caption>")), true);
  assert.equal(widget.eq(new CrossReferenceWidget("other")), false);
});

test("XRef picker: searches type, root number, current label and source file; modes default to type-number", async (t) => {
  setLocale("fr"); const state = await fixture(); const context = await loadCrossReferenceContext(state.app, state.settings, state.scope);
  const opened = []; t.mock.method(Modal.prototype, "open", function () { opened.push(this); });
  const pending = chooseCrossReferenceTarget(state.app, context.targets);
  const modal = opened[0]; const target = modal.getItems().find((target) => target.detectedTarget.titleOrCaption === "Map B");
  assert.equal(modal.getItemText(target), `image 2 — Map B — ${state.b.path}`);
  assert.equal(target.detectedTarget.type, "figure");
  modal.onClose(); modal.onChooseItem(target); assert.equal(await pending, target);
  const options = ["type-number", "number", "title"].map((mode) => ({ mode, text: formatCrossReference(target, mode, "fr") }));
  const modePending = chooseCrossReferenceMode(state.app, options); const modeModal = opened[1];
  assert.equal(modeModal.getItems()[0].mode, "type-number");
  modeModal.onChooseItem(options[0]); assert.equal(await modePending, "type-number");
  const cancelled = chooseCrossReferenceTarget(state.app, context.targets); opened[2].onClose(); assert.equal(await cancelled, null);
});

for (const locale of ["fr", "en"]) {
  test(`XRef picker: stable type grouping, two-level native suggestions and complete fuzzy text (${locale})`, async (t) => {
    setLocale(locale); const state = await fixture();
    state.b.content = "# B\n\n" + formatCaptionedImageMarkdown("map.png", "[Image 1] essai de légende");
    await state.app.vault.delete(state.app.vault.getAbstractFileByPath(`${state.root.path}/Appendices/One.md`));
    const context = await loadCrossReferenceContext(state.app, state.settings, state.scope);
    const snapshot = structuredClone(context);
    const presented = []; t.mock.method(Modal.prototype, "open", function () { presented.push(this); });
    const pending = chooseCrossReferenceTarget(state.app, context.targets);
    const modal = presented[0]; const items = modal.getItems();
    assert.deepEqual(items.map((target) => target.detectedTarget.type), ["figure", "figure", "table", "appendix", "section", "section", "section"]);
    for (const type of ["figure", "table", "appendix", "section"]) {
      assert.deepEqual(items.filter((target) => target.detectedTarget.type === type),
        context.targets.filter((target) => target.detectedTarget.type === type), "document order inside each group must remain intact");
    }
    for (const target of items) {
      assert.equal(target.number, context.targets.find((original) => original === target).number);
      assert.ok(modal.getItemText(target).includes(target.detectedTarget.sourceFile));
    }
    assert.deepEqual(context, snapshot, "presentation must not mutate numbering, scope, anchors or sourceOrder");
    const image = items[1]; assert.equal(image.number, 2);
    assert.equal(modal.getItemText(image), `image 2 — essai de légende — ${state.b.path}`);
    for (const query of ["image", "essai de légende", "B.md", state.root.path]) {
      assert.ok(modal.getItemText(image).includes(query), "native fuzzy matching retains every searchable component");
    }
    assert.ok(modal.getItemText(items[2]).includes(locale === "fr" ? "tableau" : "table"));
    assert.ok(modal.getItemText(items[3]).includes(locale === "fr" ? "annexe" : "appendix"));
    assert.ok(modal.getItemText(items[4]).includes("section"));
    const row = modal.contentEl;
    row.createDiv({ text: "Obsolete suggestion" });
    modal.renderSuggestion({ item: image, match: { score: 1, matches: [] } }, row);
    assert.equal(row.hasClass("is-complex"), true);
    assert.equal(row.children.length, 1);
    const content = row.querySelector(".suggestion-content");
    assert.equal(content.children.length, 2);
    assert.equal(content.querySelector(".suggestion-title").textContent, "image 2 — essai de légende");
    assert.equal(content.querySelector(".suggestion-note").textContent, state.b.path);
    modal.renderSuggestion({ item: items[2], match: { score: 1, matches: [] } }, row);
    assert.equal(row.children.length, 1, "rerendering replaces the previous row rather than accumulating it");
    assert.equal(row.querySelector(".suggestion-title").textContent, `${formatCrossReference(items[2], "type-number", locale)} — ${items[2].detectedTarget.titleOrCaption}`);
    modal.onChooseItem(image); assert.equal(await pending, image);
    modal.onClose();
    assert.deepEqual(context, snapshot);
    assert.equal(parseImageMarkdown(state.b.content.split("\n").at(-1)).caption, "[Image 1] essai de légende");
  });
}

test("XRef command: a single palette entry delegates normal Markdown insertion", async () => {
  const state = await fixture(); const native = Object.create(MarkdownView.prototype);
  native.file = state.ref; native.editor = editor("Voir ");
  native.getMode = () => "source";
  state.app.workspace = { getActiveViewOfType: (type) => type === MarkdownView ? native : null };
  const commands = []; const plugin = { app: state.app, settings: state.settings, addCommand: (command) => commands.push(command) };
  FeuilletsPlugin.prototype.registerCrossReferenceCommand.call(plugin);
  assert.equal(commands.length, 1); assert.equal(commands[0].id, "cross-reference"); assert.equal(commands[0].checkCallback(true), true);
});

test("XRef command: native numbering and controller picker receive the same applicable isolation", async (t) => {
  const state = await workspaceFixture(); const native = Object.create(MarkdownView.prototype);
  native.file = state.source; native.editor = editor("Voir "); native.getMode = () => "source";
  state.app.workspace = { getActiveViewOfType: (type) => type === MarkdownView ? native : null };
  const commands = []; let isolation = state.first;
  const plugin = { app: state.app, settings: state.settings, getWorkspaceFolder: () => isolation,
    addCommand: (command) => commands.push(command) };
  const insert = t.mock.method(CrossReferenceEditorController.prototype, "insert", async function (_editor, _file, scope) {
    assert.deepEqual(scope, crossReferenceBoundaryScope(state.app, state.settings, state.source, isolation));
    assert.equal(this.deps.getWorkspaceFolder(), isolation);
  });
  FeuilletsPlugin.prototype.registerCrossReferenceCommand.call(plugin);
  assert.equal(commands[0].checkCallback(false), true);
  assert.deepEqual(insert.mock.calls[0].arguments[2], createFolderScope(state.root.path, state.first.path));
  isolation = state.root;
  assert.equal(commands[0].checkCallback(false), true);
  assert.deepEqual(insert.mock.calls[1].arguments[2], createFolderScope(state.root.path, state.workspace.path));
});

test("XRef command: Reading mode is unavailable and never calls the insertion controller", async (t) => {
  const state = await fixture(); const native = Object.create(MarkdownView.prototype);
  native.file = state.ref; native.editor = editor("Voir "); native.getMode = () => "preview";
  state.app.workspace = { getActiveViewOfType: (type) => type === MarkdownView ? native : null };
  const commands = []; const plugin = { app: state.app, settings: state.settings, addCommand: (command) => commands.push(command) };
  const insert = t.mock.method(CrossReferenceEditorController.prototype, "insert", async () => {});
  FeuilletsPlugin.prototype.registerCrossReferenceCommand.call(plugin);
  assert.equal(commands[0].checkCallback(true), false); assert.equal(commands[0].checkCallback(false), false);
  assert.equal(insert.mock.callCount(), 0); assert.equal(native.editor.value, "Voir ");
});

test("XRef command: Continu remains available without a native source-mode view", async (t) => {
  const state = await fixture(); const current = continuous(state, [{ file: state.ref, content: "Voir " }], 5);
  const native = { getMode: () => "preview" };
  state.app.workspace = { getActiveViewOfType: (type) => type === ScriveningsView ? current.view : type === MarkdownView ? native : null };
  const commands = []; const plugin = { app: state.app, settings: state.settings, addCommand: (command) => commands.push(command) };
  const insert = t.mock.method(CrossReferenceEditorController.prototype, "insert", async () => {});
  FeuilletsPlugin.prototype.registerCrossReferenceCommand.call(plugin);
  assert.equal(commands[0].checkCallback(true), true); assert.equal(commands[0].checkCallback(false), true);
  assert.equal(insert.mock.callCount(), 1); assert.ok(insert.mock.calls[0].arguments[0] instanceof ScriveningsSegmentEditorAdapter);
});

test("XRef command: switching to Reading while the picker is open prevents insertion", async (t) => {
  const state = await fixture(); const native = Object.create(MarkdownView.prototype); let mode = "source";
  native.file = state.ref; native.editor = editor("Voir "); native.getMode = () => mode;
  state.app.workspace = { getActiveViewOfType: (type) => type === MarkdownView ? native : null };
  const commands = []; const plugin = { app: state.app, settings: state.settings, addCommand: (command) => commands.push(command) };
  const entered = deferred(); const release = deferred(); const done = deferred();
  const original = CrossReferenceEditorController.prototype.insert;
  t.mock.method(CrossReferenceEditorController.prototype, "insert", async function (surface, file, scope, _read, isCurrent) {
    const action = controller(state, { chooseMode: async () => { entered.resolve(); await release.promise; return "type-number"; } });
    await original.call(action.instance, surface, file, scope, async (target) => target.content, isCurrent);
    done.resolve(action);
  });
  FeuilletsPlugin.prototype.registerCrossReferenceCommand.call(plugin);
  assert.equal(commands[0].checkCallback(false), true); await entered.promise;
  mode = "preview"; release.resolve(); const action = await done.promise;
  assert.equal(native.editor.value, "Voir "); assert.equal(action.notices.length, 1);
  assert.deepEqual(await loadCrossReferenceStore(state.app, state.settings), emptyCrossReferenceStore());
});

function fakeRenderView(state, text, file = state.ref) {
  let source = text; let live = true; let ranges = [{ from: 0, to: 0 }];
  const view = {
    state: {
      get doc() { return { length: source.length, toString: () => source }; },
      get selection() { return { ranges }; },
      field(field) { return field === editorInfoField ? { file } : field === editorLivePreviewField ? live : undefined; },
    }, dom: {}, effects: [],
    dispatch(spec) { this.effects.push(spec.effects); },
    source(value) { source = value; }, live(value) { live = value; }, selection(value) { ranges = value; },
  };
  return view;
}

async function waitFor(testPredicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (testPredicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Cross-reference render did not finish");
}

test("XRef CodeMirror: live widget, raw Source mode, cursor reveal and read-only refresh", async (t) => {
  const state = await fixture(); const created = link(state); await saveCrossReferenceStore(state.app, state.settings, created.store);
  const saved = state.files.get(crossReferenceStorePath(state.app, state.settings)).content;
  const modify = t.mock.method(state.app.vault, "modify"); const create = t.mock.method(state.app.vault, "create");
  const [field, Plugin] = createCrossReferenceExtension(state.app, () => state.settings);
  const view = fakeRenderView(state, state.ref.content); const plugin = new Plugin(view); t.after(() => plugin.destroy());
  await waitFor(() => plugin.decorations.length === 1);
  assert.ok(plugin.decorations[0].widget instanceof CrossReferenceWidget); assert.equal(plugin.decorations[0].widget.text, "image 2");
  let fieldValue = field.update(field.create(), { state: view.state, docChanged: false, effects: [view.effects.at(-1)] });
  assert.equal(fieldValue.decorations.length, 1);
  view.selection([{ from: 6, to: 6 }]); plugin.update({ view, selectionSet: true }); assert.equal(plugin.decorations.length, 0);
  fieldValue = field.update(fieldValue, { state: view.state, docChanged: false, effects: [] }); assert.equal(fieldValue.decorations.length, 0);
  view.selection([{ from: 0, to: 0 }]); view.live(false); plugin.update({ view }); assert.equal(plugin.decorations.length, 0);
  notifyCrossReferenceEditors(state.app); await waitFor(() => view.effects.length >= 2);
  assert.equal(modify.mock.callCount(), 0); assert.equal(create.mock.callCount(), 0);
  assert.equal(state.files.get(crossReferenceStorePath(state.app, state.settings)).content, saved);
  assert.equal(view.state.doc.toString(), "Voir figure 99.");
});

test("XRef CodeMirror: Continu uses the shared widget and refreshes with scope changes", async (t) => {
  const state = await fixture(); const created = link(state); await saveCrossReferenceStore(state.app, state.settings, created.store);
  let document = buildScriveningsDocument([{ file: state.b, content: state.b.content }, { file: state.ref, content: state.ref.content }]);
  let scope = createSelectionScope(state.root.path, [state.b.path, state.ref.path]);
  const view = fakeRenderView(state, document.text, null);
  const [, Plugin] = createCrossReferenceExtension(state.app, () => state.settings, (file) => state.app.vault.read(file), () => ({ scope, document }));
  const plugin = new Plugin(view); t.after(() => plugin.destroy());
  await waitFor(() => plugin.decorations.length === 1);
  assert.equal(plugin.decorations[0].widget.text, "image 1");
  assert.equal(document.text.slice(plugin.decorations[0].from, plugin.decorations[0].to), "figure 99");
  document = buildScriveningsDocument([{ file: state.a, content: state.a.content }, { file: state.b, content: state.b.content }, { file: state.ref, content: state.ref.content }]);
  scope = createSelectionScope(state.root.path, [state.a.path, state.b.path, state.ref.path]); view.source(document.text);
  plugin.update({ view, docChanged: true }); notifyCrossReferenceEditors(state.app);
  await waitFor(() => plugin.decorations.length === 1 && plugin.decorations[0].widget.text === "image 2");
  assert.equal(state.ref.content, "Voir figure 99.");
});

test("XRef CodeMirror: content changes reread only the affected file, not the whole project", async (t) => {
  const state = await fixture(); await saveCrossReferenceStore(state.app, state.settings, link(state).store);
  const reads = []; const read = async (file) => { reads.push(file.path); return file.content; };
  const [, Plugin] = createCrossReferenceExtension(state.app, () => state.settings, read);
  const view = fakeRenderView(state, state.ref.content); const plugin = new Plugin(view); t.after(() => plugin.destroy());
  await waitFor(() => plugin.decorations.length === 1); const first = reads.length;
  view.source("Introduction.\n" + state.ref.content); plugin.update({ view, docChanged: true });
  const effects = view.effects.length;
  await waitFor(() => view.effects.length > effects);
  assert.equal(reads.length, first); assert.equal(plugin.decorations[0].widget.text, "image 2");
  state.a.content = state.a.content.replace("![Map A](a.png)", "Decoration only");
  notifyCrossReferenceEditors(state.app, 0, [state.a.path]);
  await waitFor(() => plugin.decorations[0]?.widget.text === "image 1");
  assert.deepEqual(reads.slice(first), [state.a.path]);
});

function acceptedContinu(state, entries) {
  const view = Object.create(ScriveningsView.prototype);
  view.plugin = { app: state.app, settings: state.settings };
  view.wordCounts = new Map();
  view.session = new ScriveningsSession({ app: state.app, scheduleTimeout: () => 0, cancelTimeout: () => {} });
  view.session.load(buildScriveningsDocument(entries));
  return view;
}

async function renderTick(t, views, milliseconds) {
  const pending = (Array.isArray(views) ? views : [views]).map((view) => {
    const completed = deferred(); const dispatch = view.dispatch;
    const mock = t.mock.method(view, "dispatch", function (spec) { dispatch.call(this, spec); completed.resolve(); });
    return { completed: completed.promise, mock };
  });
  t.mock.timers.tick(milliseconds); await Promise.all(pending.map(({ completed }) => completed));
  for (const { mock } of pending) mock.mock.restore();
}

test("XRef native widgets: isolation set/clear and workspace registration/removal refresh without edits", async (t) => {
  const state = await workspaceFixture();
  const detected = detectCrossReferenceTargets(state.target.path, state.target.content)[0];
  assert.equal(detected.type, "figure");
  const created = createCrossReferenceLink(emptyCrossReferenceStore(), detected, state.target.content,
    state.source.path, state.source.content, 5, 14, "type-number");
  await saveCrossReferenceStore(state.app, state.settings, created.store);
  const snapshot = state.files.get(crossReferenceStorePath(state.app, state.settings)).content;
  const plugin = {
    app: state.app, settings: state.settings, workspaceFolderPath: undefined,
    getProjectFolder: () => state.root,
    getWorkspaceFolder: FeuilletsPlugin.prototype.getWorkspaceFolder,
    renderAllViews: t.mock.fn(), trimStats: () => {}, saveData: t.mock.fn(async () => {}),
  };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const [, Plugin] = createCrossReferenceExtension(state.app, () => state.settings, (file) => state.app.vault.read(file),
    undefined, () => plugin.getWorkspaceFolder());
  const view = fakeRenderView(state, state.source.content, state.source);
  const renderer = new Plugin(view); t.after(() => renderer.destroy());
  await renderTick(t, view, 0);
  assert.equal(renderer.decorations[0].widget.text, "image 2");
  FeuilletsPlugin.prototype.setWorkspaceFolder.call(plugin, state.first);
  await renderTick(t, view, 0);
  assert.equal(renderer.decorations[0].widget.text, "image 1");
  const effects = view.effects.length;
  FeuilletsPlugin.prototype.setWorkspaceFolder.call(plugin, state.first);
  t.mock.timers.tick(0); await Promise.resolve();
  assert.equal(view.effects.length, effects, "identical isolation does not queue another XRef refresh");
  FeuilletsPlugin.prototype.clearWorkspaceFolder.call(plugin);
  await renderTick(t, view, 0); assert.equal(renderer.decorations[0].widget.text, "image 2");
  assert.equal(plugin.workspaceFolderPath, undefined);
  unregisterDeclaredWorkspaceRoot(state.settings, state.root, state.workspace);
  await FeuilletsPlugin.prototype.saveSettings.call(plugin);
  await renderTick(t, view, 350); assert.equal(renderer.decorations[0].widget.text, "image 4");
  registerDeclaredWorkspaceRoot(state.settings, state.root, state.workspace);
  await FeuilletsPlugin.prototype.saveSettings.call(plugin);
  await renderTick(t, view, 350); assert.equal(renderer.decorations[0].widget.text, "image 2");
  for (let index = 0; index < 3; index++) {
    notifyCrossReferenceEditors(state.app); await renderTick(t, view, 0);
    assert.equal(renderer.decorations.length, 1);
    assert.equal(renderer.decorations[0].widget.text, "image 2");
  }
  assert.equal(view.state.doc.toString(), state.source.content);
  assert.equal(state.files.get(crossReferenceStorePath(state.app, state.settings)).content, snapshot);
  assert.equal(plugin.workspaceFolderPath, undefined);
  renderer.destroy(); const afterDestroy = view.effects.length;
  notifyCrossReferenceEditors(state.app); t.mock.timers.tick(350); await Promise.resolve();
  assert.equal(view.effects.length, afterDestroy, "destroyed editors unsubscribe from invalidation");
});

test("XRef Continu widgets: exact host scope remains the numbering scope regardless of boundaries", async (t) => {
  const state = await workspaceFixture();
  const detected = detectCrossReferenceTargets(state.target.path, state.target.content)[0];
  const created = createCrossReferenceLink(emptyCrossReferenceStore(), detected, state.target.content,
    state.source.path, state.source.content, 5, 14, "type-number");
  await saveCrossReferenceStore(state.app, state.settings, created.store);
  const document = buildScriveningsDocument([{ file: state.target, content: state.target.content }, { file: state.source, content: state.source.content }]);
  const scope = createFolderScope(state.root.path, state.first.path);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const [, Plugin] = createCrossReferenceExtension(state.app, () => state.settings, (file) => state.app.vault.read(file),
    () => ({ scope, document }), () => state.workspace);
  const view = fakeRenderView(state, document.text, null); const renderer = new Plugin(view); t.after(() => renderer.destroy());
  await renderTick(t, view, 0);
  assert.equal(renderer.decorations[0].widget.text, "image 1");
  unregisterDeclaredWorkspaceRoot(state.settings, state.root, state.workspace);
  notifyCrossReferenceEditors(state.app); await renderTick(t, view, 0);
  assert.equal(renderer.decorations[0].widget.text, "image 1");
  assert.equal(renderer.decorations[0].from, locationToCompositeOffset(document, state.source.path, 5));
  assert.equal(view.state.doc.toString(), document.text);
});

for (const filename of ["A.md", "B.md"]) {
  test(`XRef Continu: accepted edit in ${filename} invalidates only its true path`, async (t) => {
    const state = await fixture(); await saveCrossReferenceStore(state.app, state.settings, link(state).store);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const current = acceptedContinu(state, [state.a, state.b].map((file) => ({ file, content: file.content })));
    const reads = []; const read = async (file) => {
      reads.push(file.path); const segment = current.getSegmentByPath(file.path);
      return segment ? segment.frontmatter + segment.body : file.content;
    };
    const [, Plugin] = createCrossReferenceExtension(state.app, () => state.settings, read);
    const view = fakeRenderView(state, state.ref.content); const plugin = new Plugin(view); t.after(() => plugin.destroy());
    await renderTick(t, view, 0); reads.length = 0;
    const changed = current.session.document.segments.find((segment) => segment.file.name === filename);
    current.handleEditorChanges([{ from: changed.to, to: changed.to, insert: "\nNew text" }]);
    assert.deepEqual(reads, [], "accepted-change notification never reads Markdown to discover touched files");
    await renderTick(t, view, 350);
    assert.deepEqual(reads, [changed.path], "other segments retain their cached content");
    assert.equal(state.a.content.includes("New text"), false); assert.equal(state.b.content.includes("New text"), false);
  });
}

test("XRef Continu: a valid two-file transaction invalidates only those two paths", async (t) => {
  const state = await fixture(); await saveCrossReferenceStore(state.app, state.settings, link(state).store);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const current = acceptedContinu(state, [state.a, state.b, state.ref].map((file) => ({ file, content: file.content })));
  const reads = []; const read = async (file) => { reads.push(file.path); const segment = current.getSegmentByPath(file.path); return segment ? segment.frontmatter + segment.body : file.content; };
  const [, Plugin] = createCrossReferenceExtension(state.app, () => state.settings, read);
  const view = fakeRenderView(state, state.ref.content); const plugin = new Plugin(view); t.after(() => plugin.destroy());
  await renderTick(t, view, 0); reads.length = 0;
  current.handleEditorChanges(current.session.document.segments.slice(0, 2).map((segment) => ({ from: segment.to, to: segment.to, insert: "\nMore" })));
  assert.deepEqual(reads, []); await renderTick(t, view, 350);
  assert.deepEqual(reads, [state.a.path, state.b.path]);
});

test("XRef Continu: the render plugin never infers touched paths from the full composition", async (t) => {
  const state = await fixture(); t.mock.timers.enable({ apis: ["setTimeout"] });
  const host = t.mock.fn(() => { throw new Error("docChanged must not inspect the full composition"); });
  const read = t.mock.fn(async (file) => file.content);
  const [, Plugin] = createCrossReferenceExtension(state.app, () => state.settings, read, host);
  const view = fakeRenderView(state, "Composite", null); const plugin = new Plugin(view); t.after(() => plugin.destroy());
  plugin.update({ view, docChanged: true });
  assert.equal(host.mock.callCount(), 0); assert.equal(read.mock.callCount(), 0);
});

test("XRef MarkdownView: docChanged invalidates only the current source path in other editors", async (t) => {
  const state = await fixture(); await saveCrossReferenceStore(state.app, state.settings, link(state).store);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let liveA = state.a.content; const reads = [];
  const [, Plugin] = createCrossReferenceExtension(state.app, () => state.settings, async (file) => { reads.push(file.path); return file === state.a ? liveA : file.content; });
  const observer = fakeRenderView(state, state.ref.content); const watcher = new Plugin(observer); t.after(() => watcher.destroy());
  await renderTick(t, observer, 0);
  const native = fakeRenderView(state, liveA, state.a); const writer = new Plugin(native); t.after(() => writer.destroy());
  await renderTick(t, native, 0); reads.length = 0;
  liveA += "\nNew text"; native.source(liveA); writer.update({ view: native, docChanged: true });
  await renderTick(t, observer, 350);
  assert.deepEqual(reads, [state.a.path]);
});

test("XRef store: a sidecar modification refreshes every registered editor without scope invalidation", async (t) => {
  const state = await fixture(); const created = link(state); await saveCrossReferenceStore(state.app, state.settings, created.store);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const [, Plugin] = createCrossReferenceExtension(state.app, () => state.settings);
  const first = fakeRenderView(state, state.ref.content); const second = fakeRenderView(state, state.ref.content);
  const a = new Plugin(first); const b = new Plugin(second); t.after(() => { a.destroy(); b.destroy(); });
  await renderTick(t, [first, second], 0); assert.equal(b.decorations[0].widget.text, "image 2");
  created.store.occurrences[0].displayMode = "title"; await saveCrossReferenceStore(state.app, state.settings, created.store);
  notifyCrossReferenceEditors(state.app, 350, [crossReferenceStorePath(state.app, state.settings)]);
  await renderTick(t, [first, second], 350);
  assert.equal(a.decorations[0].widget.text, "Map B"); assert.equal(b.decorations[0].widget.text, "Map B");
});
