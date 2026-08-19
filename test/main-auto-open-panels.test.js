import assert from "node:assert/strict";
import test from "node:test";
import { Notice, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { VIEW_SIDEBAR_FEUILLETS } from "../src/constants.js";
import { t } from "../src/i18n/index.js";
import { ManageProjectsModal } from "../src/ui/project-modals.js";

function createPlugin(autoOpenInspector, restoredInspector = false) {
  let onLayoutReady;
  const inspectorLeaves = restoredInspector ? [{ detach() {} }] : [];
  const created = [];
  const workspace = {
    onLayoutReady(callback) { onLayoutReady = callback; },
    on() { return {}; },
    getLeavesOfType(type) {
      return type === VIEW_SIDEBAR_FEUILLETS ? inspectorLeaves : [];
    },
    getRightLeaf() {
      return {
        async setViewState(state) {
          created.push(state);
          inspectorLeaves.push({ detach() {} });
        },
      };
    },
  };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { workspace, vault: { getAbstractFileByPath() { return null; } } };
  plugin.settings = { autoOpenBinder: false, autoOpenInspector, projects: [] };
  plugin.getProjectFolder = () => new TFolder("Projet/Manuscrit");
  plugin.adjustSidebarWidth = () => {};
  plugin.loadDeferredViews = async () => {};
  plugin.registerEvent = () => {};
  plugin.registerAutoOpenPanels();
  return { created, onLayoutReady };
}

test("registerAutoOpenPanels crée l'Inspecteur seulement si autoOpenInspector est actif", async () => {
  const enabled = createPlugin(true);
  await enabled.onLayoutReady();
  assert.deepEqual(enabled.created, [{ type: VIEW_SIDEBAR_FEUILLETS, active: false }]);

  const disabled = createPlugin(false);
  await disabled.onLayoutReady();
  assert.deepEqual(disabled.created, []);
});

test("registerAutoOpenPanels conserve un Inspecteur restauré si autoOpenInspector est inactif", async () => {
  const { created, onLayoutReady } = createPlugin(false, true);

  await onLayoutReady();

  assert.deepEqual(created, []);
});

test("activateSidebarView refuse d'ouvrir un onglet Inspecteur masqué", async () => {
  let opened = false;
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { hiddenPanels: ["research"] };
  plugin.app = {
    workspace: {
      getLeavesOfType() { return []; },
      getRightLeaf() {
        return { async setViewState() { opened = true; } };
      },
    },
  };
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    await plugin.activateSidebarView("research");
  } finally {
    Notice.onCreate = null;
  }

  assert.equal(opened, false);
  assert.deepEqual(plugin.settings.hiddenPanels, ["research"]);
  assert.deepEqual(notices, [t("sidebar.notice.tabHidden")]);
});

test("les activateurs d'onglets Inspecteur délèguent au point central", async () => {
  const calls = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.activateSidebarView = async (tabId) => { calls.push(tabId); };

  for (const method of ["activateNotes", "activateResearch", "activateJournal", "activateProject"]) {
    await plugin[method]();
  }

  assert.deepEqual(calls, ["notes", "research", "journal", "project"]);
});

test("registerRibbonIcons enregistre uniquement Binder, Tableau et Mode concentration", () => {
  const registered = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { hiddenPanels: [] };
  plugin.addRibbonIcon = (icon) => {
    registered.push(icon);
    return { remove() {} };
  };

  plugin.registerRibbonIcons();

  assert.deepEqual(Object.keys(plugin._ribbonEls), ["sidebar", "board", "concentration"]);
  assert.deepEqual(registered, ["files", "layout-grid", "focus"]);
  assert.equal("journal" in plugin._ribbonEls, false);
  assert.equal("project" in plugin._ribbonEls, false);
});

test("manage-projects ouvre ManageProjectsModal sans activer l'onglet Édition", () => {
  const commands = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = {};
  plugin.addCommand = (command) => commands.push(command);
  let activateProjectCalls = 0;
  plugin.activateProject = () => { activateProjectCalls++; };
  const originalOpen = ManageProjectsModal.prototype.open;
  let openedModal = null;
  ManageProjectsModal.prototype.open = function open() {
    openedModal = this;
    return this;
  };
  try {
    plugin.registerCoreCommands();
    const command = commands.find(({ id }) => id === "manage-projects");

    assert.ok(command, "la commande manage-projects reste enregistrée");
    command.callback();
    assert.ok(openedModal instanceof ManageProjectsModal);
    assert.equal(openedModal.app, plugin.app);
    assert.equal(openedModal.plugin, plugin);
    assert.equal(activateProjectCalls, 0);
  } finally {
    ManageProjectsModal.prototype.open = originalOpen;
  }
});

/* PROMPT 2 (« panneau droit Projet → Édition ») : `open-export` et
 * `pdf-style-modal` passent toujours par le point d'entrée unique
 * `activateCentralSurface(surface, editionMode)`. `open-project`, lui, ne
 * force plus la surface centrale historique — il ouvre désormais le chemin
 * latéral existant (`plugin.activateProject()`, tab interne "project",
 * visible comme Édition dans SidebarFeuilletsView). */
test("open-export / pdf-style-modal passent par activateCentralSurface avec le bon mode ; open-project ouvre le panneau latéral", async () => {
  const commands = [];
  const calls = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.addCommand = (command) => commands.push(command);
  let activateProjectCalls = 0;
  plugin.activateProject = () => { activateProjectCalls += 1; };
  plugin.activateCentralSurface = async (surface, mode) => { calls.push([surface, mode]); };

  plugin.registerCoreCommands();

  for (const id of ["open-project", "open-export", "pdf-style-modal"]) {
    const command = commands.find((registered) => registered.id === id);
    assert.ok(command, `la commande ${id} reste enregistrée`);
    command.callback();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [
    ["edition", "export"],
    ["edition", "layout"],
  ]);
  assert.equal(activateProjectCalls, 1, "open-project ouvre le panneau latéral (activateProject), pas la surface centrale");
});

/* `open-board` conserve son comportement historique : la surface centrale
 * n'est jamais forcée par cette commande. */
test("open-board garde son comportement historique (activateBoard, aucune surface forcée)", () => {
  const commands = [];
  const calls = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.addCommand = (command) => commands.push(command);
  plugin.activateBoard = () => { calls.push("board"); };
  plugin.activateCentralSurface = async () => { calls.push("central"); };

  plugin.registerCoreCommands();
  commands.find((registered) => registered.id === "open-board").callback();

  assert.deepEqual(calls, ["board"]);
});

/* Correctif "les contrôles Export ne fonctionnent pas" (§3/§5C) : les
 * commandes directes export-docx/export-pdf/export-epub restent câblées
 * exactement comme avant le dernier lot UX — this.exportFile(format), le
 * même moteur qu'avant, jamais un second chemin. */
test("export-docx / export-pdf / export-epub restent câblées à this.exportFile(format), inchangé par le dernier lot UX", () => {
  const commands = [];
  const calls = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.addCommand = (command) => commands.push(command);
  plugin.exportFile = (format) => { calls.push(format); };

  plugin.registerCoreCommands();

  for (const [id, expectedFormat] of [["export-docx", "docx"], ["export-epub", "epub"], ["export-pdf", "pdf"]]) {
    const command = commands.find((registered) => registered.id === id);
    assert.ok(command, `la commande ${id} reste enregistrée`);
    calls.length = 0;
    command.callback();
    assert.deepEqual(calls, [expectedFormat], `${id} atteint bien exportFile("${expectedFormat}")`);
  }
});

/* §11 : activateCentralSurface réutilise la leaf VIEW_BOARD existante — elle
 * n'en crée jamais une seconde et ne crée aucune leaf « Édition ». */
test("activateCentralSurface réutilise la leaf Tableau et lui transmet la surface", async () => {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  const received = [];
  const boardLeaf = {
    isDeferred: false,
    loadIfDeferred: async () => {},
    view: {
      async setCentralSurface(surface, mode) { received.push([surface, mode]); },
    },
  };
  let activateBoardCalls = 0;
  plugin.activateBoard = async () => { activateBoardCalls += 1; };
  plugin.app = {
    workspace: {
      getLeavesOfType: (type) => (type === "feuillets-board" ? [boardLeaf] : []),
    },
  };

  await plugin.activateCentralSurface("edition", "layout");

  assert.equal(activateBoardCalls, 1, "la leaf Tableau est révélée/réutilisée par activateBoard");
  assert.deepEqual(received, [["edition", "layout"]]);
});
