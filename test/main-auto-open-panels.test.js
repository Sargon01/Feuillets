import assert from "node:assert/strict";
import test from "node:test";
import { Notice, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { VIEW_SIDEBAR_FEUILLETS } from "../src/constants.js";
import { t } from "../src/i18n/index.js";

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
