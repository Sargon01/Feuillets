import assert from "node:assert/strict";
import test from "node:test";
import { Notice, Setting } from "obsidian";
import { t } from "../src/i18n/index.js";
import { FeuilletsSettingTab } from "../src/settings/feuillets-setting-tab.js";

class FakeElement {
  createDiv() { return new FakeElement(); }
  createSpan() { return new FakeElement(); }
  createEl() { return new FakeElement(); }
  empty() {}
  addEventListener() {}
  setText() { return this; }
}

function captureToggleControls() {
  const methods = ["setName", "setDesc", "addToggle", "addSlider", "addDropdown", "addText", "addButton"];
  const previous = Object.fromEntries(methods.map((name) => [name, Setting.prototype[name]]));
  const controls = [];
  const component = () => ({
    setValue() { return this; },
    setLimits() { return this; },
    addOption() { return this; },
    setButtonText() { return this; },
    onClick() { return this; },
    onChange(callback) { this.change = callback; return this; },
  });
  Setting.prototype.setName = function (name) { this.name = name; return this; };
  Setting.prototype.setDesc = function () { return this; };
  Setting.prototype.addToggle = function (configure) {
    const control = component();
    configure(control);
    controls.push({ name: this.name, change: control.change });
    return this;
  };
  for (const method of ["addSlider", "addDropdown", "addText", "addButton"]) {
    Setting.prototype[method] = function (configure) { configure(component()); return this; };
  }
  return { controls, restore: () => Object.assign(Setting.prototype, previous) };
}

function createSettings(activeRightPanelTab, hiddenPanels) {
  return {
    activeRightPanelTab,
    hiddenPanels,
    projectMeta: {},
    hiddenBoardModes: [],
    autoOpenBinder: true,
    autoOpenInspector: true,
  };
}

function createTab(settings) {
  const calls = { save: 0, render: 0 };
  const plugin = {
    settings,
    projectMode: () => ({ researchFolders: {} }),
    unitLabel: () => "feuillet",
    getProjectFolder: () => null,
    refreshView() {},
    saveSettings: async () => { calls.save += 1; },
    renderAllViews: () => { calls.render += 1; },
  };
  return { tab: new FeuilletsSettingTab({}, plugin), calls };
}

test("Réglages : masquer l'onglet actif choisit le premier onglet Inspecteur visible", async () => {
  const settings = createSettings("research", []);
  const { tab, calls } = createTab(settings);
  const { controls, restore } = captureToggleControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
    await controls.find((control) => control.name === t("sidebar.tab.research")).change(false);
  } finally {
    restore();
  }

  assert.deepEqual(settings.hiddenPanels, ["research"]);
  assert.equal(settings.activeRightPanelTab, "notes");
  assert.deepEqual(calls, { save: 1, render: 1 });
});

test("Réglages : le dernier onglet Inspecteur visible ne peut pas être masqué", async () => {
  const settings = createSettings("notes", ["research", "journal", "project", "analyse", "relecture"]);
  const { tab, calls } = createTab(settings);
  const { controls, restore } = captureToggleControls();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    tab.renderPanneauxCategory(new FakeElement());
    await controls.find((control) => control.name === t("sidebar.tab.notes")).change(false);
  } finally {
    Notice.onCreate = null;
    restore();
  }

  assert.equal(settings.hiddenPanels.includes("notes"), false);
  assert.deepEqual(calls, { save: 0, render: 0 });
  assert.equal(notices.length, 1);
});
