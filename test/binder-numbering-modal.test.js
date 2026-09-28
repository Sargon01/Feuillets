import { test } from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { NumberingModal } from "../src/ui/numbering-modal.js";
import { createCompositionBinding } from "../src/services/ouvrage-composition.js";
import { t, setLocale, getLocale } from "../src/i18n/index.js";

/* Binder shortcut to the numbering fields — no new setting, no parallel
   storage: the modal is just a thin UI in front of createCompositionBinding,
   the exact same binding Édition → Composition → Structure uses. */

function buildRoot() {
  const root = new TFolder("Roman/Manuscrit");
  root.path = "Roman/Manuscrit";
  root.name = "Manuscrit";
  return root;
}

function buildSettings(overrides = {}) {
  return {
    projectFolder: "Roman/Manuscrit",
    level1Role: "parties",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    autoRename: false,
    renamePrefix: "chapitre",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: false,
    footnoteRenumberOnCompile: true,
    separator: "",
    compilePresets: [],
    activePreset: -1,
    compileFileName: "Manuscrit.md",
    projectMeta: {},
    ...overrides,
  };
}

function buildHost(settings) {
  const refreshCalls = [];
  const saveCalls = [];
  return {
    settings,
    saveSettings: async () => { saveCalls.push(true); },
    refreshBinderViews: () => { refreshCalls.push(true); },
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    refreshCalls,
    saveCalls,
  };
}

/* --------------------------- Test A / Test B / Test C -------------------- */

function buildViewForDisplayMenu(root, plugin) {
  class TestBinderView extends FeuilletsView {
    constructor() { super({ app: plugin.app, contentEl: null }); this.app = plugin.app; this.plugin = plugin; }
    async render() {}
  }
  return new TestBinderView();
}

test("Test A — the Affichage menu shows 'Numérotation…' / 'Numbering…' exactly once, with the list-ordered icon", () => {
  const root = buildRoot();
  const app = { vault: { getAbstractFileByPath: (p) => (p === root.path ? root : null) } };
  const plugin = { app, getProjectFolder: () => root, settings: buildSettings() };
  const view = buildViewForDisplayMenu(root, plugin);
  const initial = getLocale();
  try {
    for (const locale of ["fr", "en"]) {
      setLocale(locale);
      const menu = new Menu();
      view.buildDisplayOptionsMenu(menu);
      const items = menu.items.filter((i) => i.title === t("binder.numbering"));
      assert.equal(items.length, 1, `entry present exactly once under locale "${locale}"`);
      assert.equal(items[0].title, locale === "fr" ? "Numérotation…" : "Numbering…");
      assert.equal(items[0].icon, "list-ordered");
    }
  } finally {
    setLocale(initial);
  }
});

test("Test B — the project root's context menu no longer contains 'Numérotation…'", () => {
  const root = buildRoot();
  const app = { vault: { getAbstractFileByPath: (p) => (p === root.path ? root : null) } };
  const view = buildViewForDisplayMenu(root, { app, getProjectFolder: () => root, settings: buildSettings() });
  view.showProjectRootContextMenu({ preventDefault() {} }, root);
  const items = Menu.lastShown.items.filter((i) => i.title === t("binder.numbering"));
  assert.equal(items.length, 0);
});

test("a single sheet's context menu never had the 'Numérotation…' entry (non-regression)", () => {
  const root = buildRoot();
  const chapter = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter.path = "Roman/Manuscrit/Chapitre 1";
  chapter.name = "Chapitre 1";
  chapter.parent = root;
  const scene = new TFile("Roman/Manuscrit/Chapitre 1/Scene.md", "Texte.");
  scene.path = "Roman/Manuscrit/Chapitre 1/Scene.md";
  scene.name = "Scene.md";
  scene.basename = "Scene";
  scene.extension = "md";
  scene.parent = chapter;
  chapter.children = [scene];
  root.children = [chapter];

  const files = new Map([[root.path, root], [chapter.path, chapter], [scene.path, scene]]);
  const app = {
    vault: { getAbstractFileByPath: (p) => files.get(p) || null },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    fileManager: { processFrontMatter: async () => {}, trashFile: async () => {} },
  };
  const settings = buildSettings();
  const plugin = {
    app,
    settings,
    getProjectFolder: () => root,
    isSceneFile: (f) => f && f.extension === "md",
    titleFor: (f) => f.basename,
    shortTitleFor: (f) => f.basename,
    fmOf: () => ({}),
    labelOf: () => "",
    saveSettings: async () => {},
    renderAllViews: () => {},
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    getLinkedResearchFolder: () => null,
    getResearchRoot: () => null,
  };
  const view = buildViewForDisplayMenu(root, plugin);
  view.showFileContextMenu({ preventDefault() {} }, scene, chapter, 0, []);
  const items = Menu.lastShown.items.filter((i) => i.title === t("binder.numbering"));
  assert.equal(items.length, 0);
});

test("Test C — Numérotation… always opens on the true global project root, even while the Binder is isolated on a subfolder", () => {
  const root = buildRoot();
  const isolatedChapter = new TFolder("Roman/Manuscrit/Chapitre 4");
  isolatedChapter.path = "Roman/Manuscrit/Chapitre 4";
  isolatedChapter.name = "Chapitre 4";
  isolatedChapter.parent = root;
  const files = new Map([[root.path, root], [isolatedChapter.path, isolatedChapter]]);
  const app = { vault: { getAbstractFileByPath: (p) => files.get(p) || null } };
  // The Binder is isolated on the subfolder — getProjectFolder() must still
  // be consulted for Numérotation…, never the isolated/selected folder.
  const plugin = {
    app,
    getProjectFolder: () => root,
    getBinderWorkingRoot: () => isolatedChapter,
    settings: { ...buildSettings(), binderSelectedPath: isolatedChapter.path },
  };
  const view = buildViewForDisplayMenu(root, plugin);
  const menu = new Menu();
  view.buildDisplayOptionsMenu(menu);
  const item = menu.items.find((i) => i.title === t("binder.numbering"));
  assert.ok(item, "Numérotation… must be present");

  const originalOpen = NumberingModal.prototype.open;
  let capturedGlobalRoot = null;
  let capturedEditorialRoot = null;
  NumberingModal.prototype.open = function () {
    capturedGlobalRoot = this.globalRoot;
    capturedEditorialRoot = this.editorialRoot;
  };
  try {
    item.callback();
  } finally {
    NumberingModal.prototype.open = originalOpen;
  }

  assert.equal(capturedGlobalRoot, root, "receives the true global project root");
  assert.equal(capturedEditorialRoot, root, "never the isolated subfolder");
  assert.notEqual(capturedGlobalRoot, isolatedChapter);
});

/* ------------------------------- Test C-G -------------------------------- */

test("Test C — the modal's three controls reflect the binding's initial values exactly", () => {
  const root = buildRoot();
  const settings = buildSettings({ level1Role: "parties", chapterNumbering: "continu", sceneNumbering: "hier" });
  const host = buildHost(settings);
  const modal = new NumberingModal({}, host, root);
  modal.onOpen();

  const [level1RoleSetting, chapterNumberingSetting, sceneNumberingSetting] = modal.contentEl._settings;
  assert.equal(level1RoleSetting.controls[0].value, "parties");
  assert.equal(chapterNumberingSetting.controls[0].value, "continu");
  assert.equal(sceneNumberingSetting.controls[0].value, "hier");
});

test("Test D — changing a control writes through binding.update(), never plugin.settings directly", async () => {
  const root = buildRoot();
  const settings = buildSettings({ chapterNumbering: "continu" });
  const host = buildHost(settings);
  const modal = new NumberingModal({}, host, root);
  modal.onOpen();

  const chapterNumberingSetting = modal.contentEl._settings[1];
  chapterNumberingSetting.controls[0].select("aucune");
  await new Promise((resolve) => setTimeout(resolve, 0));

  // For the global root, createCompositionBinding writes to the exact
  // historical field applyGlobalCompositionPatch always used — never a new
  // location invented by this modal.
  assert.equal(settings.chapterNumbering, "aucune");
});

test("Test E — a change refreshes the Binder via the binding's own refreshBinderViews(), no second mechanism", async () => {
  const root = buildRoot();
  const settings = buildSettings();
  const host = buildHost(settings);
  const modal = new NumberingModal({}, host, root);
  modal.onOpen();

  assert.equal(host.refreshCalls.length, 0, "no refresh merely from opening the modal");
  modal.contentEl._settings[1].controls[0].select("parPartie");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.refreshCalls.length, 1, "exactly the binding's own refreshBinderViews() call");
  assert.equal(host.saveCalls.length, 1);
});

test("Test F — no parallel storage: the modal's write lands exactly where createCompositionBinding() for the same root reads it back", async () => {
  const root = buildRoot();
  const settings = buildSettings({ sceneNumbering: "hier" });
  const host = buildHost(settings);
  const modal = new NumberingModal({}, host, root);
  modal.onOpen();

  modal.contentEl._settings[2].controls[0].select("continue");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const compositionBinding = createCompositionBinding(host, root, root);
  assert.equal(compositionBinding.value.sceneNumbering, "continue", "Composition's own binding reads the same value back, immediately");
});

test("Test G — synchronization both ways between the Binder modal and Composition's binding", async () => {
  const root = buildRoot();
  const settings = buildSettings({ level1Role: "parties" });
  const host = buildHost(settings);

  // Binder modal -> Composition.
  const modal = new NumberingModal({}, host, root);
  modal.onOpen();
  modal.contentEl._settings[0].controls[0].select("chapitres");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(createCompositionBinding(host, root, root).value.level1Role, "chapitres");

  // Composition (its own binding instance) -> re-opening the Binder modal.
  const compositionBinding = createCompositionBinding(host, root, root);
  await compositionBinding.update({ level1Role: "parties" });
  const reopened = new NumberingModal({}, host, root);
  reopened.onOpen();
  assert.equal(reopened.contentEl._settings[0].controls[0].value, "parties");
});
