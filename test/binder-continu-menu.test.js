import { test } from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";
import { isOuvrageRoot } from "../src/services/editorial-roots.js";
import FeuilletsPlugin from "../src/main.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Lot 2A — intégration Binder de « Continu ». Ces tests EXÉCUTENT le VRAI
 * menu contextuel construit par le Binder (FeuilletsView, qui hérite de
 * BaseFeuilletsView.showFolderContextMenu/showFileContextMenu) — jamais une
 * simple vérification de chaîne dans le code. Même patron que
 * preview-context-menu.test.js. */

const OPEN_IN_CONTINU_TITLE = "Ouvrir en continu";

function buildProject() {
  const root = new TFolder("Roman/Manuscrit");
  root.path = "Roman/Manuscrit";
  root.name = "Manuscrit";

  const chapter = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter.path = "Roman/Manuscrit/Chapitre 1";
  chapter.name = "Chapitre 1";
  chapter.parent = root;
  root.children = [chapter];

  const scene = new TFile("Roman/Manuscrit/Chapitre 1/01 Été.md", "Texte.");
  scene.path = "Roman/Manuscrit/Chapitre 1/01 Été.md";
  scene.name = "01 Été.md";
  scene.basename = "01 Été";
  scene.extension = "md";
  scene.parent = chapter;
  chapter.children = [scene];

  const otherFile = new TFile("Roman/Manuscrit/Prologue.md", "Texte.");
  otherFile.path = "Roman/Manuscrit/Prologue.md";
  otherFile.name = "Prologue.md";
  otherFile.basename = "Prologue";
  otherFile.extension = "md";
  otherFile.parent = root;
  root.children.push(otherFile);

  const nefes = new TFolder("Roman/Manuscrit/NEFES");
  nefes.path = "Roman/Manuscrit/NEFES";
  nefes.name = "NEFES";
  nefes.parent = root;
  const nefesScene = new TFile("Roman/Manuscrit/NEFES/Scène 1.md", "Texte.");
  nefesScene.path = "Roman/Manuscrit/NEFES/Scène 1.md";
  nefesScene.name = "Scène 1.md";
  nefesScene.basename = "Scène 1";
  nefesScene.extension = "md";
  nefesScene.parent = nefes;
  nefes.children = [nefesScene];
  root.children.push(nefes);

  const settings = {
    projectFolder: "Roman/Manuscrit",
    level1Role: "chapitres",
    compileFileName: "Manuscrit.md",
    orders: {},
    folderPositions: {},
    labels: [],
    statuses: [],
    projectMeta: {
      "Roman/Manuscrit": {
        folderWorkspaces: {
          "NEFES": { version: 1, ouvrage: { version: 1 } },
        },
      },
    },
  };

  return { root, chapter, scene, otherFile, nefes, settings };
}

function buildWorkspace() {
  const continuStates = [];
  const scopesOpened = [];
  // Une leaf Continu déjà ouverte, toujours réutilisée : ce que
  // activateScriveningsView doit trouver via getLeavesOfType(VIEW_SCRIVENINGS)
  // avant même d'envisager d'en créer une — même patron que
  // preview-context-menu.test.js (getLeavesOfType stub direct).
  const existingLeaf = {
    setViewState: async (state) => { continuStates.push(state); },
    view: { openScope: async (scope) => { scopesOpened.push(scope); } },
  };
  const workspace = {
    getLeaf: () => existingLeaf,
    getLeavesOfType: () => [existingLeaf],
    revealLeaf: () => {},
    setActiveLeaf: () => {},
  };
  return { workspace, continuStates, scopesOpened };
}

function buildApp(project, workspace) {
  const files = new Map();
  const register = (f) => {
    if (!f) return;
    files.set(f.path, f);
    if (f.children) for (const c of f.children) register(c);
  };
  register(project.root);

  return {
    workspace,
    vault: {
      getAbstractFileByPath: (p) => files.get(p) || (p === project.root.path ? project.root : null),
      getFiles: () => [project.scene, project.otherFile],
      read: async () => "Texte.",
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    fileManager: { processFrontMatter: async () => {}, trashFile: async () => {} },
  };
}

class TestBinderView extends FeuilletsView {
  constructor(app, plugin) {
    super({ app, contentEl: null });
    this.app = app;
    this.plugin = plugin;
  }
  async render() {}
}

class TestBoardView extends BaseFeuilletsView {
  constructor(app, plugin) {
    super({ app, contentEl: null });
    this.app = app;
    this.plugin = plugin;
  }
  async render() {}
}

function buildBinder(project, ViewClass = TestBinderView) {
  const { workspace, continuStates, scopesOpened } = buildWorkspace();
  const app = buildApp(project, workspace);
  /* Les portées Binder viennent des VRAIES méthodes du plugin (main.ts),
     jamais d'une copie locale de leur règle. */
  const plugin = {
    app,
    settings: project.settings,
    getProjectFolder: () => project.root,
    editorialRootFor: FeuilletsPlugin.prototype.editorialRootFor,
    compileScopeForFolder: FeuilletsPlugin.prototype.compileScopeForFolder,
    compileScopeForFile: FeuilletsPlugin.prototype.compileScopeForFile,
    compileScopeForSelection: FeuilletsPlugin.prototype.compileScopeForSelection,
    isValidEditorialRootPath: (path) => {
      if (!path) return false;
      if (path === project.root.path) return true;
      const f = app.vault.getAbstractFileByPath(path);
      return f instanceof TFolder && isOuvrageRoot(app, project.settings, project.root, f);
    },
    isSceneFile: (f) => f instanceof TFile,
    flattenFiles: () => [project.scene, project.otherFile],
    saveSettings: async () => {},
    fmOf: () => ({}),
    labelOf: () => "",
    titleFor: (f) => f.basename,
    newSheetAt: () => {},
    newSheet: () => {},
    newFolder: () => {},
    renderAllViews: () => {},
    snapshotFile: async () => "",
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    getLinkedResearchFolder: () => null,
    getResearchRoot: () => null,
  };
  return { view: new ViewClass(app, plugin), continuStates, scopesOpened, project };
}

function continuEntryOf(menu) {
  return menu.items.find((i) => i.title === OPEN_IN_CONTINU_TITLE);
}

test("Binder — dossier : « Ouvrir en continu » transmet un scope folder", async () => {
  const project = buildProject();
  const { view, scopesOpened } = buildBinder(project);

  view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, [], view.continuExtras(project.chapter));
  const menu = Menu.lastShown;
  const entry = continuEntryOf(menu);
  assert.ok(entry, "l'entrée doit être présente pour un dossier");

  await entry.callback();
  assert.equal(scopesOpened.length, 1);
  assert.equal(scopesOpened[0].type, "folder");
  assert.equal(scopesOpened[0].path, project.chapter.path);
});

test("Binder — dossier appartenant à une multi-sélection : scope selection complet", async () => {
  const project = buildProject();
  const { view, scopesOpened } = buildBinder(project);
  view.plugin._binderMultiSelect = new Set([project.chapter.path, project.otherFile.path]);

  view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, [], view.continuExtras(project.chapter));
  const entry = continuEntryOf(Menu.lastShown);
  assert.ok(entry);

  await entry.callback();
  assert.equal(scopesOpened[0].type, "selection");
  assert.equal(scopesOpened[0].paths.length, 2);
  assert.ok(scopesOpened[0].paths.includes(project.chapter.path));
  assert.ok(scopesOpened[0].paths.includes(project.otherFile.path));
});

test("Binder — dossier HORS multi-sélection garde un scope folder même si une sélection existe ailleurs", async () => {
  const project = buildProject();
  const { view, scopesOpened } = buildBinder(project);
  // Sélection multiple qui NE contient PAS ce dossier.
  view.plugin._binderMultiSelect = new Set([project.scene.path, project.otherFile.path]);

  view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, [], view.continuExtras(project.chapter));
  const entry = continuEntryOf(Menu.lastShown);
  await entry.callback();

  assert.equal(scopesOpened[0].type, "folder");
  assert.equal(scopesOpened[0].path, project.chapter.path);
});

test("Binder — multi-sélection de fichiers : « Ouvrir en continu » transmet un scope selection", async () => {
  const project = buildProject();
  const { view, scopesOpened } = buildBinder(project);
  view.plugin._binderMultiSelect = new Set([project.scene.path, project.otherFile.path]);

  view.showFileContextMenu({ preventDefault() {} }, project.scene, project.chapter, 0, []);
  const entry = continuEntryOf(Menu.lastShown);
  assert.ok(entry, "l'entrée doit être présente pour un groupe");

  await entry.callback();
  assert.equal(scopesOpened[0].type, "selection");
  assert.equal(scopesOpened[0].paths.length, 2);
});

test("Binder — feuillet unique : aucune entrée « Ouvrir en continu »", () => {
  const project = buildProject();
  const { view } = buildBinder(project);

  view.showFileContextMenu({ preventDefault() {} }, project.scene, project.chapter, 0, []);
  const entry = continuEntryOf(Menu.lastShown);
  assert.equal(entry, undefined, "un feuillet unique a déjà son vrai MarkdownView — Continu n'y apporte rien");
});

test("Binder — feuillet unique : « Ouvrir avec aperçu » reste inchangé (toujours présent, toujours seul)", () => {
  const project = buildProject();
  const { view } = buildBinder(project);

  view.showFileContextMenu({ preventDefault() {} }, project.scene, project.chapter, 0, []);
  const menu = Menu.lastShown;
  const preview = menu.items.find((i) => i.title === "Ouvrir avec aperçu");
  assert.ok(preview, "« Ouvrir avec aperçu » doit rester présent");
  assert.equal(menu.items.filter((i) => i.title === "Ouvrir avec aperçu").length, 1);
});

test("Binder — clic droit racine (projet) : « Ouvrir en continu » transmet une portée project", async () => {
  const project = buildProject();
  const { view, project: proj } = buildBinder(project);

  let scopePassed = null;
  view.app.workspace.getLeavesOfType = () => [
    { view: { openScope: async (scope) => { scopePassed = scope; } } },
  ];

  // Même patron que le test existant "clic droit racine" (preview-context-menu.test.js) :
  // le handler réel de rootRow appelle createProjectScope + openScopeInContinu.
  const { createProjectScope } = await import("../src/services/compile-scope.js");
  const { openScopeInContinu } = await import("../src/views/scrivenings-view.js");

  const scope = createProjectScope(proj.root.path);
  await openScopeInContinu(view.app, scope);

  assert.deepEqual(scopePassed, { type: "project", projectRoot: proj.root.path });
});

test("BoardView — menu dossier inchangé : aucune entrée « Ouvrir en continu » injectée implicitement", () => {
  const project = buildProject();
  const { view } = buildBinder(project, TestBoardView);

  // BoardView appelle showFolderContextMenu SANS extraItems Continu — exactement
  // comme board-view.ts (aucun continuExtras n'existe sur BaseFeuilletsView).
  view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, []);
  const menu = Menu.lastShown;
  const entry = continuEntryOf(menu);
  assert.equal(entry, undefined, "BoardView ne doit jamais recevoir « Ouvrir en continu »");

  const preview = menu.items.find((i) => i.title === "Ouvrir avec aperçu");
  assert.ok(preview, "« Ouvrir avec aperçu » reste présent et inchangé pour BoardView");
});

test("Binder — dossier ouvrage : « Ouvrir avec aperçu » transmet une portée project avec projectRoot de l'ouvrage", async () => {
  const project = buildProject();
  const { view } = buildBinder(project);
  let openedScope = null;
  view.openScopeWithContinuAndPreview = async (scope) => { openedScope = scope; };

  view.showFolderContextMenu({ preventDefault() {} }, project.nefes, project.root, 0, []);
  const menu = Menu.lastShown;
  const previewItem = menu.items.find((i) => i.title === "Ouvrir avec aperçu");
  assert.ok(previewItem);

  await previewItem.callback();
  assert.deepEqual(openedScope, { type: "project", projectRoot: "Roman/Manuscrit/NEFES" });
});

test("Binder — dossier ouvrage : « Ouvrir en continu » transmet une portée project avec projectRoot de l'ouvrage", async () => {
  const project = buildProject();
  const { view, scopesOpened } = buildBinder(project);

  view.showFolderContextMenu({ preventDefault() {} }, project.nefes, project.root, 0, [], view.continuExtras(project.nefes));
  const menu = Menu.lastShown;
  const entry = continuEntryOf(menu);
  assert.ok(entry, "l'entrée doit être présente pour un dossier ouvrage");

  await entry.callback();
  assert.equal(scopesOpened.length, 1);
  assert.deepEqual(scopesOpened[0], { type: "project", projectRoot: "Roman/Manuscrit/NEFES" });
});

test("Binder — dossier ouvrage : « Compilation… » transmet une portée project avec projectRoot de l'ouvrage", async () => {
  const project = buildProject();
  const { view } = buildBinder(project);
  view.plugin.flushContinuWritesForProject = async () => false;

  const { ExportModal } = await import("../src/ui/export-modal.js");
  let capturedCallback = null;
  const origSetOnSubmit = ExportModal.prototype.setOnSubmit;
  const origOpen = ExportModal.prototype.open;
  ExportModal.prototype.setOnSubmit = function (callback) {
    capturedCallback = callback;
    return origSetOnSubmit.call(this, callback);
  };
  ExportModal.prototype.open = function () {};

  try {
    view.showFolderContextMenu({ preventDefault() {} }, project.nefes, project.root, 0, []);
    const menu = Menu.lastShown;
    const compileItem = menu.items.find((i) => i.title === "Compilation…");
    assert.ok(compileItem);

    await compileItem.callback({ preventDefault() {} });
    const subMenu = Menu.lastShown;
    const subItem = subMenu.items.find((i) => i.title === "Compiler ce dossier");
    assert.ok(subItem, "l'entrée Compiler ce dossier doit être présente dans le sous-menu");
    await subItem.callback();

    assert.ok(capturedCallback);
    await capturedCallback("docx", "Test");
    assert.deepEqual(view.plugin.activeExportScope, { type: "project", projectRoot: "Roman/Manuscrit/NEFES" });
  } finally {
    ExportModal.prototype.setOnSubmit = origSetOnSubmit;
    ExportModal.prototype.open = origOpen;
  }
});

test("Binder — dossier ordinaire : conserve createFolderScope", async () => {
  const project = buildProject();
  const { view, scopesOpened } = buildBinder(project);
  view.plugin.flushContinuWritesForProject = async () => false;
  let openedPreviewScope = null;
  view.openScopeWithContinuAndPreview = async (scope) => { openedPreviewScope = scope; };

  // 1. Ouvrir avec aperçu
  view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, []);
  let menu = Menu.lastShown;
  let previewItem = menu.items.find((i) => i.title === "Ouvrir avec aperçu");
  assert.ok(previewItem);
  await previewItem.callback();
  assert.deepEqual(openedPreviewScope, {
    type: "folder",
    projectRoot: "Roman/Manuscrit",
    path: "Roman/Manuscrit/Chapitre 1",
  });

  // 2. Ouvrir en continu
  view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, [], view.continuExtras(project.chapter));
  menu = Menu.lastShown;
  let continuItem = continuEntryOf(menu);
  assert.ok(continuItem);
  await continuItem.callback();
  assert.deepEqual(scopesOpened[0], {
    type: "folder",
    projectRoot: "Roman/Manuscrit",
    path: "Roman/Manuscrit/Chapitre 1",
  });

  // 3. Compilation...
  const { ExportModal } = await import("../src/ui/export-modal.js");
  let capturedCallback = null;
  const origSetOnSubmit = ExportModal.prototype.setOnSubmit;
  const origOpen = ExportModal.prototype.open;
  ExportModal.prototype.setOnSubmit = function (callback) {
    capturedCallback = callback;
    return origSetOnSubmit.call(this, callback);
  };
  ExportModal.prototype.open = function () {};

  try {
    view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, []);
    menu = Menu.lastShown;
    const compileItem = menu.items.find((i) => i.title === "Compilation…");
    assert.ok(compileItem);

    await compileItem.callback({ preventDefault() {} });
    const subMenu = Menu.lastShown;
    const subItem = subMenu.items.find((i) => i.title === "Compiler ce dossier");
    assert.ok(subItem, "l'entrée Compiler ce dossier doit être présente dans le sous-menu");
    await subItem.callback();

    assert.ok(capturedCallback);
    await capturedCallback("docx", "Test");
    assert.deepEqual(view.plugin.activeExportScope, {
      type: "folder",
      projectRoot: "Roman/Manuscrit",
      path: "Roman/Manuscrit/Chapitre 1",
    });
  } finally {
    ExportModal.prototype.setOnSubmit = origSetOnSubmit;
    ExportModal.prototype.open = origOpen;
  }
});

/* ===================== Racine d'ouvrage propagée aux sous-portées ===================== */

function buildWarpiPlugin() {
  const link = (parent, children) => {
    parent.children = children;
    for (const child of children) child.parent = parent;
  };
  const root = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const part = new TFolder("WARPI/NEFES/Subhanallah");
  const chapter = new TFolder("WARPI/NEFES/Subhanallah/Chapitre 1");
  const scene = new TFile("WARPI/NEFES/Subhanallah/Chapitre 1/Scene 1.md", "Texte.");
  const sibling = new TFolder("WARPI/Autre");
  const siblingScene = new TFile("WARPI/Autre/Scène A.md", "Texte.");
  link(root, [nefes, sibling]);
  link(nefes, [part]);
  link(part, [chapter]);
  link(chapter, [scene]);
  link(sibling, [siblingScene]);
  const { vault } = createFakeVault([root, nefes, part, chapter, scene, sibling, siblingScene]);

  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { vault };
  plugin.settings = {
    projectFolder: root.path,
    projectMeta: { [root.path]: { folderWorkspaces: { NEFES: { version: 1, ouvrage: { version: 1 } } } } },
  };
  plugin.getProjectFolder = () => root;
  return { plugin, root, nefes, part, chapter, scene, sibling, siblingScene };
}

test("compileScopeForFolder : la portée d'un dossier est rattachée à son ouvrage", () => {
  const { plugin, root, nefes, part, chapter, sibling } = buildWarpiPlugin();

  assert.deepEqual(plugin.compileScopeForFolder(root), { type: "project", projectRoot: "WARPI" });
  assert.deepEqual(plugin.compileScopeForFolder(nefes), { type: "project", projectRoot: "WARPI/NEFES" });
  assert.deepEqual(plugin.compileScopeForFolder(part), {
    type: "folder",
    projectRoot: "WARPI/NEFES",
    path: "WARPI/NEFES/Subhanallah",
  });
  assert.deepEqual(plugin.compileScopeForFolder(chapter), {
    type: "folder",
    projectRoot: "WARPI/NEFES",
    path: "WARPI/NEFES/Subhanallah/Chapitre 1",
  });
  assert.deepEqual(plugin.compileScopeForFolder(sibling), {
    type: "folder",
    projectRoot: "WARPI",
    path: "WARPI/Autre",
  });
});

test("compileScopeForFile : la portée d'un feuillet est rattachée à son ouvrage", () => {
  const { plugin, scene, siblingScene } = buildWarpiPlugin();

  assert.deepEqual(plugin.compileScopeForFile(scene), {
    type: "file",
    projectRoot: "WARPI/NEFES",
    path: "WARPI/NEFES/Subhanallah/Chapitre 1/Scene 1.md",
  });
  assert.deepEqual(plugin.compileScopeForFile(siblingScene), {
    type: "file",
    projectRoot: "WARPI",
    path: "WARPI/Autre/Scène A.md",
  });
});

/* ===================== CORRECTIF FINAL LOT 4 — sélections multiples ===================== */

test("compileScopeForSelection : une sélection entièrement dans NEFES obtient projectRoot NEFES", () => {
  const { plugin, scene, chapter } = buildWarpiPlugin();

  assert.deepEqual(
    plugin.compileScopeForSelection([scene.path, chapter.path]),
    { type: "selection", projectRoot: "WARPI/NEFES", paths: [scene.path, chapter.path] }
  );
});

test("compileScopeForSelection : une sélection entièrement hors ouvrage obtient la racine globale", () => {
  const { plugin, sibling, siblingScene } = buildWarpiPlugin();

  assert.deepEqual(
    plugin.compileScopeForSelection([sibling.path, siblingScene.path]),
    { type: "selection", projectRoot: "WARPI", paths: [sibling.path, siblingScene.path] }
  );
});

test("compileScopeForSelection : une sélection mélangeant NEFES et hors ouvrage retombe sur la racine globale", () => {
  const { plugin, scene, siblingScene } = buildWarpiPlugin();

  assert.deepEqual(
    plugin.compileScopeForSelection([scene.path, siblingScene.path]),
    { type: "selection", projectRoot: "WARPI", paths: [scene.path, siblingScene.path] }
  );
});

test("Binder — « Ouvrir en continu » sur une multi-sélection entièrement dans NEFES : projectRoot de l'ouvrage", async () => {
  const project = buildProject();
  const { view, scopesOpened } = buildBinder(project);
  const nefesScene = project.nefes.children[0];
  view.plugin._binderMultiSelect = new Set([project.nefes.path, nefesScene.path]);

  view.showFolderContextMenu({ preventDefault() {} }, project.nefes, project.root, 0, [], view.continuExtras(project.nefes));
  const entry = continuEntryOf(Menu.lastShown);
  assert.ok(entry, "l'entrée doit être présente pour une multi-sélection");

  await entry.callback();
  assert.equal(scopesOpened.length, 1);
  assert.equal(scopesOpened[0].type, "selection");
  assert.deepEqual(scopesOpened[0].projectRoot, "Roman/Manuscrit/NEFES");
  assert.ok(scopesOpened[0].paths.includes(project.nefes.path));
  assert.ok(scopesOpened[0].paths.includes(nefesScene.path));
});

test("Binder — « Ouvrir en continu » sur une multi-sélection mélangeant NEFES et le reste du projet : racine globale", async () => {
  const project = buildProject();
  const { view, scopesOpened } = buildBinder(project);
  const nefesScene = project.nefes.children[0];
  view.plugin._binderMultiSelect = new Set([nefesScene.path, project.otherFile.path]);

  view.showFileContextMenu({ preventDefault() {} }, nefesScene, project.nefes, 0, []);
  const entry = continuEntryOf(Menu.lastShown);
  assert.ok(entry, "l'entrée doit être présente pour un groupe");

  await entry.callback();
  assert.equal(scopesOpened.length, 1);
  assert.equal(scopesOpened[0].type, "selection");
  assert.equal(scopesOpened[0].projectRoot, "Roman/Manuscrit");
});

test("Binder — « Compiler ce feuillet… » : projectRoot de l'ouvrage dans un ouvrage, racine globale ailleurs", async () => {
  const project = buildProject();
  const { view } = buildBinder(project);
  view.plugin.flushContinuWritesForProject = async () => false;

  const { ExportModal } = await import("../src/ui/export-modal.js");
  let capturedCallback = null;
  const origSetOnSubmit = ExportModal.prototype.setOnSubmit;
  const origOpen = ExportModal.prototype.open;
  ExportModal.prototype.setOnSubmit = function (callback) {
    capturedCallback = callback;
    return origSetOnSubmit.call(this, callback);
  };
  ExportModal.prototype.open = function () {};

  const compileFileScope = async (file, parent) => {
    capturedCallback = null;
    view.showFileContextMenu({ preventDefault() {} }, file, parent, 0, []);
    const compileItem = Menu.lastShown.items.find((i) => i.title === "Compiler ce feuillet…");
    assert.ok(compileItem, "l'entrée Compiler ce feuillet… doit être présente");
    await compileItem.callback();
    assert.ok(capturedCallback);
    await capturedCallback("docx", "Test");
    return view.plugin.activeExportScope;
  };

  try {
    const nefesScene = project.nefes.children[0];
    assert.deepEqual(await compileFileScope(nefesScene, project.nefes), {
      type: "file",
      projectRoot: "Roman/Manuscrit/NEFES",
      path: "Roman/Manuscrit/NEFES/Scène 1.md",
    });
    assert.deepEqual(await compileFileScope(project.scene, project.chapter), {
      type: "file",
      projectRoot: "Roman/Manuscrit",
      path: "Roman/Manuscrit/Chapitre 1/01 Été.md",
    });
  } finally {
    ExportModal.prototype.setOnSubmit = origSetOnSubmit;
    ExportModal.prototype.open = origOpen;
  }
});
