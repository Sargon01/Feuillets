import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, Notice, TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { isProjectDraft, ProjectDraftAutoRenamer } from "../src/services/project-drafts.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { t } from "../src/i18n/index.js";

function commandSet(plugin) {
  const commands = [];
  plugin.addCommand = (command) => commands.push(command);
  plugin.registerCoreCommands();
  return new Map(commands.map((command) => [command.id, command]));
}

function pluginForCommand(root = null) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { workspace: { getActiveFile: () => null, getActiveViewOfType: () => null, getLeavesOfType: () => [] } };
  plugin.settings = { projects: [] };
  plugin.getProjectFolder = () => root;
  return plugin;
}

test("la commande de brouillon rapide est enregistrée sans raccourci imposé", () => {
  const command = commandSet(pluginForCommand()).get("create-quick-draft");
  assert.equal(command.name, t("main.cmd.createQuickDraft"));
  assert.equal(command.hotkeys, undefined);
});

test("la disponibilité de la commande ne crée rien et son exécution orchestre une seule création", () => {
  const withoutProject = pluginForCommand();
  const unavailable = commandSet(withoutProject).get("create-quick-draft");
  assert.equal(unavailable.checkCallback(true), false);

  const root = new TFolder("WARPI");
  const plugin = pluginForCommand(root);
  let creations = 0;
  plugin.createQuickDraft = () => { creations += 1; };
  const command = commandSet(plugin).get("create-quick-draft");
  assert.equal(command.checkCallback(true), true);
  assert.equal(creations, 0);
  assert.equal(command.checkCallback(false), true);
  assert.equal(creations, 1);
});

test("createQuickDraft crée un brouillon libre, l'ouvre actif et place le curseur avec le focus", async () => {
  const root = new TFolder("WARPI");
  const { vault } = createFakeVault([root]);
  const editor = {
    lastLine: () => 4,
    getLine: () => "",
    setCursorCalls: [],
    setCursor(position) { this.setCursorCalls.push(position); },
    focusCalls: 0,
    focus() { this.focusCalls += 1; },
  };
  const leaf = {
    view: null,
    openFileCalls: [],
    async openFile(file, options) {
      this.openFileCalls.push({ file, options });
      this.view = Object.assign(new MarkdownView(), { file, editor });
    },
  };
  const activeLeaves = [];
  const app = {
    vault,
    workspace: { setActiveLeaf(value, options) { activeLeaves.push({ value, options }); } },
  };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.getProjectFolder = () => root;
  plugin.getLeafForOpeningFile = () => leaf;
  let notices = 0;
  const previousNotice = Notice.onCreate;
  Notice.onCreate = () => { notices += 1; };
  try {
    const file = await plugin.createQuickDraft();
    assert.equal(file.path, "WARPI/_Feuillets/Drafts/Sans titre.md");
    assert.equal(file.content, "---\nstatus: Brouillon\n---\n\n");
    assert.deepEqual(leaf.openFileCalls, [{ file, options: { active: true } }]);
    assert.deepEqual(activeLeaves, [{ value: leaf, options: { focus: true } }]);
    assert.deepEqual(editor.setCursorCalls, [{ line: 4, ch: 0 }]);
    assert.equal(editor.focusCalls, 1);
    assert.equal(notices, 0);
  } finally {
    Notice.onCreate = previousNotice;
  }
});

test("createQuickDraft signale l'absence de projet et les erreurs sans ouvrir de feuille", async () => {
  const noProject = Object.create(FeuilletsPlugin.prototype);
  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    noProject.app = { workspace: {} };
    noProject.getProjectFolder = () => null;
    noProject.getLeafForOpeningFile = () => { throw new Error("leaf inattendue"); };
    assert.equal(await noProject.createQuickDraft(), null);
    assert.deepEqual(notices, [t("main.notice.projectFolderNotFound")]);

    const root = new TFolder("WARPI");
    const failingVault = createFakeVault([root]).vault;
    failingVault.create = async () => { throw new Error("création refusée"); };
    const failing = Object.create(FeuilletsPlugin.prototype);
    failing.app = { vault: failingVault, workspace: {} };
    failing.getProjectFolder = () => root;
    failing.getLeafForOpeningFile = () => { throw new Error("leaf inattendue"); };
    assert.equal(await failing.createQuickDraft(), null);
    assert.equal(notices.at(-1), t("main.notice.quickDraftCreateFailed", { message: "création refusée" }));
  } finally {
    Notice.onCreate = previousNotice;
  }
});

test("le cycle de vie du vault transmet les événements au renommeur de brouillons", () => {
  const handlers = new Map();
  const events = [];
  const file = new TFile("WARPI/_Feuillets/Drafts/Sans titre.md");
  const calls = { schedule: [], rename: [], cancel: 0, dispose: 0 };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { projectFolder: "WARPI", projects: [], projectMeta: {} };
  plugin.projectDraftAutoRenamer = {
    schedule(value) { calls.schedule.push(value); },
    handleRename(value, oldPath) { calls.rename.push([value, oldPath]); },
    cancel() { calls.cancel += 1; },
    dispose() { calls.dispose += 1; },
  };
  plugin.isLayoutReady = false;
  plugin.registerEvent = (event) => events.push(event);
  plugin.register = (cleanup) => events.push(cleanup);
  plugin.refreshView = () => {};
  plugin.maybeAutoInitializeResearchFile = async () => {};
  plugin.maybeRenameResearchFile = () => {};
  plugin.handleFilChanged = () => {};
  plugin.renderStaleViews = () => {};
  plugin.syncProjectPanelsVisibility = async () => {};
  plugin.getProjectFolder = () => new TFolder("WARPI");
  plugin.saveSettings = async () => {};
  plugin.updateStatusBar = async () => {};
  const on = (name, callback) => {
    handlers.set(name, callback);
    return { name };
  };
  plugin.app = {
    vault: {
      on,
      getAbstractFileByPath: (path) => path === "WARPI" ? new TFolder("WARPI") : null,
    },
    metadataCache: { on },
    workspace: { on },
  };
  plugin.registerVaultEvents();
  handlers.get("modify")(file);
  handlers.get("rename")(file, "WARPI/_Feuillets/Drafts/Sans titre.md");
  handlers.get("delete")(file);
  assert.deepEqual(calls.schedule, [file]);
  assert.deepEqual(calls.rename, [[file, "WARPI/_Feuillets/Drafts/Sans titre.md"]]);
  assert.equal(calls.cancel, 1);

});

test("l'initialisation de production nettoie l'instance du renommeur", () => {
  const cleanups = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  const root = new TFolder("WARPI");
  plugin.app = { vault: { getAbstractFileByPath: () => null } };
  plugin.getProjectFolder = () => root;
  plugin.register = (cleanup) => cleanups.push(cleanup);

  plugin.initializeProjectDraftAutoRenamer();

  assert.ok(plugin.projectDraftAutoRenamer instanceof ProjectDraftAutoRenamer);
  const renamer = plugin.projectDraftAutoRenamer;
  let disposeCalls = 0;
  const dispose = renamer.dispose.bind(renamer);
  renamer.dispose = () => {
    disposeCalls += 1;
    dispose();
  };

  assert.equal(cleanups.length, 1);
  cleanups[0]();
  assert.equal(disposeCalls, 1);
  assert.equal(plugin.projectDraftAutoRenamer, null);
});

function moveNodeFixture(withCollision = false, ordinary = false) {
  const root = new TFolder("textes");
  const auxiliary = new TFolder("textes/_Feuillets");
  const drafts = new TFolder("textes/_Feuillets/Drafts");
  const destination = new TFolder(ordinary ? "textes/Chapitre" : "textes/Humeur");
  const sourceFile = new TFile(
    ordinary ? "textes/Chapitre.md" : "textes/_Feuillets/Drafts/Humeur.md",
    "---\nstatus: Brouillon\n---\n\n"
  );
  const collision = withCollision ? new TFile("textes/Humeur/Humeur 2.md", "existant") : null;
  root.children = [auxiliary, destination];
  auxiliary.parent = root;
  drafts.parent = auxiliary;
  auxiliary.children = [drafts];
  destination.parent = root;
  destination.children = collision ? [collision] : [];
  sourceFile.parent = ordinary ? root : drafts;
  if (ordinary) root.children.push(sourceFile);
  else drafts.children = [sourceFile];
  if (collision) collision.parent = destination;
  const { vault, fileManager } = createFakeVault([root, auxiliary, drafts, destination, sourceFile, ...(collision ? [collision] : [])]);
  vault.cachedRead = vault.read;
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  plugin.settings = { projectFolder: root.path, compileFileName: "main.md", orders: {}, folderPositions: {}, autoRename: false };
  plugin.getProjectFolder = () => root;
  plugin.getOrderedChildren = FeuilletsPlugin.prototype.getOrderedChildren.bind(plugin);
  plugin.pushHistory = () => {};
  plugin.writeOrder = async () => {};
  plugin.titleFor = (file) => file.basename;
  return { plugin, root, drafts, destination, sourceFile };
}

test("moveNode promeut un brouillon vers Humeur 2 sans le rendre note de dossier", async () => {
  const fixture = moveNodeFixture();
  const previousNotice = Notice.onCreate;
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    await fixture.plugin.moveNode(fixture.sourceFile, fixture.drafts, fixture.destination, Number.MAX_SAFE_INTEGER);
    assert.equal(fixture.sourceFile.path, "textes/Humeur/Humeur 2.md");
    assert.equal(fixture.sourceFile.parent, fixture.destination);
    assert.ok(fixture.plugin.getOrderedChildren(fixture.destination).includes(fixture.sourceFile));
    assert.equal(isProjectDraft(fixture.root, fixture.sourceFile), false);
    assert.equal(notices.at(-1), t("main.notice.moved", { name: "Humeur 2" }));
  } finally {
    Notice.onCreate = previousNotice;
  }
});

test("moveNode promeut un brouillon en Humeur 3 en cas de collision", async () => {
  const fixture = moveNodeFixture(true);
  await fixture.plugin.moveNode(fixture.sourceFile, fixture.drafts, fixture.destination, Number.MAX_SAFE_INTEGER);
  assert.equal(fixture.sourceFile.path, "textes/Humeur/Humeur 3.md");
});

test("moveNode conserve la convention des notes de dossier pour un fichier ordinaire", async () => {
  const fixture = moveNodeFixture(false, true);
  const previousNotice = Notice.onCreate;
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    await fixture.plugin.moveNode(fixture.sourceFile, fixture.root, fixture.destination, Number.MAX_SAFE_INTEGER);
    assert.equal(fixture.sourceFile.path, "textes/Chapitre/Chapitre.md");
    assert.equal(fixture.plugin.getOrderedChildren(fixture.destination).includes(fixture.sourceFile), false);
    assert.equal(notices.at(-1), t("main.notice.becameFolderNote", { name: "Chapitre.md", folder: "Chapitre" }));
  } finally {
    Notice.onCreate = previousNotice;
  }
});
