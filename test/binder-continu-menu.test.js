import { test } from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";

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

  const settings = {
    projectFolder: "Roman/Manuscrit",
    level1Role: "chapitres",
    compileFileName: "Manuscrit.md",
    orders: {},
    folderPositions: {},
    labels: [],
    statuses: [],
    projectMeta: {},
  };

  return { root, chapter, scene, otherFile, settings };
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
  return {
    workspace,
    vault: { getAbstractFileByPath: (p) => (p === project.root.path ? project.root : null), read: async () => "Texte." },
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
  const plugin = {
    settings: project.settings,
    getProjectFolder: () => project.root,
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
