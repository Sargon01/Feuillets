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

test("les commandes Édition et export conservent leurs destinations", () => {
  const commands = [];
  const calls = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.addCommand = (command) => commands.push(command);
  plugin.activateProject = () => { calls.push("project"); };
  plugin.activateEditionLayout = () => { calls.push("layout"); };

  plugin.registerCoreCommands();

  for (const id of ["open-project", "open-export", "pdf-style-modal"]) {
    const command = commands.find((registered) => registered.id === id);
    assert.ok(command, `la commande ${id} reste enregistrée`);
    command.callback();
  }
  assert.deepEqual(calls, ["project", "layout", "layout"]);
});

test("activateEditionLayout déplie seulement Mise en page & export et la fait défiler", async () => {
  const saved = [];
  const openedTabs = [];
  const scrolled = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = {
    collapsed: {
      "editionLayout:panel": true,
      "editionComposition:panel": true,
      unrelated: false,
    },
  };
  plugin.saveSettings = async () => { saved.push(true); };
  plugin.activateSidebarView = async (tab) => { openedTabs.push(tab); };
  plugin.app = {
    workspace: {
      getLeavesOfType() {
        return [{
          view: {
            contentEl: {
              querySelector(selector) {
                assert.equal(selector, ".feuillets-edition-layout-container");
                return { scrollIntoView(options) { scrolled.push(options); } };
              },
            },
          },
        }];
      },
    },
  };

  await plugin.activateEditionLayout();

  assert.deepEqual(plugin.settings.collapsed, {
    "editionComposition:panel": true,
    unrelated: false,
  });
  assert.deepEqual(saved, [true]);
  assert.deepEqual(openedTabs, ["project"]);
  assert.deepEqual(scrolled, [{ behavior: "smooth", block: "nearest" }]);
});
