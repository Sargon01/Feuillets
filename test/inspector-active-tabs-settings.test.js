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

/* Capture à la fois les toggles et les dropdowns posés pendant un rendu —
   les toggles des 6 panneaux de l'Inspecteur et le dropdown « onglet
   initial ». Retourne `{ toggles, dropdowns, restore }` ; les toggles sont
   filtrés par libellé dans les tests (la catégorie contient aussi les
   modes de Cartes, etc.). */
function captureControls() {
  const methods = ["setName", "setDesc", "addToggle", "addSlider", "addDropdown", "addText", "addButton"];
  const previous = Object.fromEntries(methods.map((name) => [name, Setting.prototype[name]]));
  const toggles = [];
  const dropdowns = [];
  const toggleComponent = () => ({
    setValue() { return this; },
    setLimits() { return this; },
    addOption() { return this; },
    setButtonText() { return this; },
    onClick() { return this; },
    onChange(callback) { this.change = callback; return this; },
  });
  const dropdownComponent = () => ({
    options: [],
    setValue(v) { this.value = v; return this; },
    setLimits() { return this; },
    addOption(key, label) { this.options.push([key, label]); return this; },
    setButtonText() { return this; },
    onClick() { return this; },
    onChange(callback) { this.change = callback; return this; },
  });
  Setting.prototype.setName = function (name) { this.name = name; return this; };
  Setting.prototype.setDesc = function () { return this; };
  Setting.prototype.addToggle = function (configure) {
    const control = toggleComponent();
    configure(control);
    toggles.push({ name: this.name, change: control.change });
    return this;
  };
  Setting.prototype.addDropdown = function (configure) {
    const control = dropdownComponent();
    configure(control);
    dropdowns.push({ name: this.name, options: control.options, value: control.value, change: control.change });
    return this;
  };
  for (const method of ["addSlider", "addText", "addButton"]) {
    Setting.prototype[method] = function (configure) { configure(toggleComponent()); return this; };
  }
  return { toggles, dropdowns, restore: () => Object.assign(Setting.prototype, previous) };
}

const PANEL_LABELS = new Set([
  t("sidebar.tab.notes"),
  t("sidebar.tab.research"),
  t("sidebar.tab.journal"),
  t("sidebar.tab.project"),
  t("sidebar.tab.stats"),
  t("sidebar.tab.proofreading"),
]);
const panelToggles = (toggles) => toggles.filter((c) => PANEL_LABELS.has(c.name));
const initialTabDropdown = (dropdowns) =>
  dropdowns.find((d) => d.name === t("settings.inspectorInitialTab.name"));

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

test("Réglages : l'Inspecteur expose exactement 6 panneaux dans l'ordre de SIDEBAR_TABS", () => {
  const { tab } = createTab(createSettings("notes", []));
  const { toggles, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  const labels = panelToggles(toggles).map((control) => control.name);
  assert.deepEqual(labels, [
    t("sidebar.tab.notes"),
    t("sidebar.tab.research"),
    t("sidebar.tab.journal"),
    t("sidebar.tab.project"),
    t("sidebar.tab.stats"),
    t("sidebar.tab.proofreading"),
  ]);
});

test("Réglages : Statistiques utilise la clé sidebar.tab.stats", () => {
  const { tab } = createTab(createSettings("notes", []));
  const { toggles, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  assert.equal(panelToggles(toggles).length, 6);
  assert.ok(panelToggles(toggles).some((control) => control.name === t("sidebar.tab.stats")));
});

test("Réglages : le dropdown de l'onglet initial contient stats entre project et relecture", () => {
  const { tab } = createTab(createSettings("notes", []));
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  const initialTab = initialTabDropdown(dropdowns);
  assert.ok(initialTab, "dropdown « onglet initial » présent");
  assert.deepEqual(initialTab.options.map(([key]) => key), [
    "notes", "research", "journal", "project", "stats", "relecture",
  ]);
  const statsOption = initialTab.options.find(([key]) => key === "stats");
  assert.deepEqual(statsOption, ["stats", t("sidebar.tab.stats")]);
});

test("Réglages : choisir Statistiques dans le dropdown écrit activeRightPanelTab === \"stats\"", async () => {
  const settings = createSettings("notes", []);
  const { tab, calls } = createTab(settings);
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
    await initialTabDropdown(dropdowns).change("stats");
  } finally {
    restore();
  }

  assert.equal(settings.activeRightPanelTab, "stats");
  assert.equal(calls.save, 1);
});

test("Réglages : activeRightPanelTab \"stats\" affiche stats dans le dropdown initial", () => {
  const { tab } = createTab(createSettings("stats", []));
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  assert.equal(initialTabDropdown(dropdowns).value, "stats");
});

test("Réglages : legacy \"analyse\" affiche stats dans le dropdown initial", () => {
  const { tab } = createTab(createSettings("analyse", []));
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  assert.equal(initialTabDropdown(dropdowns).value, "stats");
});

test("Réglages : legacy \"docx\" affiche relecture dans le dropdown initial", () => {
  const { tab } = createTab(createSettings("docx", []));
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  assert.equal(initialTabDropdown(dropdowns).value, "relecture");
});

test("Réglages : legacy \"metadata\" affiche notes dans le dropdown initial", () => {
  const { tab } = createTab(createSettings("metadata", []));
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  assert.equal(initialTabDropdown(dropdowns).value, "notes");
});

test("Réglages : masquer Statistiques l'ajoute à hiddenPanels", async () => {
  const settings = createSettings("notes", []);
  const { tab, calls } = createTab(settings);
  const { toggles, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
    await panelToggles(toggles).find((c) => c.name === t("sidebar.tab.stats")).change(false);
  } finally {
    restore();
  }

  assert.ok(settings.hiddenPanels.includes("stats"));
  assert.deepEqual(calls, { save: 1, render: 1 });
});

test("Réglages : réafficher Statistiques le retire de hiddenPanels", async () => {
  const settings = createSettings("notes", ["stats"]);
  const { tab, calls } = createTab(settings);
  const { toggles, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
    await panelToggles(toggles).find((c) => c.name === t("sidebar.tab.stats")).change(true);
  } finally {
    restore();
  }

  assert.equal(settings.hiddenPanels.includes("stats"), false);
  assert.deepEqual(calls, { save: 1, render: 1 });
});

test("Réglages : masquer Statistiques alors qu'il est actif sélectionne le premier onglet visible", async () => {
  const settings = createSettings("stats", []);
  const { tab, calls } = createTab(settings);
  const { toggles, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
    await panelToggles(toggles).find((c) => c.name === t("sidebar.tab.stats")).change(false);
  } finally {
    restore();
  }

  assert.ok(settings.hiddenPanels.includes("stats"));
  assert.equal(settings.activeRightPanelTab, "notes", "premier onglet encore visible");
  assert.deepEqual(calls, { save: 1, render: 1 });
});

test("Réglages : masquer l'onglet actif choisit le premier onglet Inspecteur visible", async () => {
  const settings = createSettings("research", []);
  const { tab, calls } = createTab(settings);
  const { toggles, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
    await panelToggles(toggles).find((c) => c.name === t("sidebar.tab.research")).change(false);
  } finally {
    restore();
  }

  assert.deepEqual(settings.hiddenPanels, ["research"]);
  assert.equal(settings.activeRightPanelTab, "notes");
  assert.deepEqual(calls, { save: 1, render: 1 });
});

test("Réglages : le dernier onglet Inspecteur visible ne peut pas être masqué", async () => {
  const settings = createSettings("notes", ["research", "journal", "project", "stats", "relecture"]);
  const { tab, calls } = createTab(settings);
  const { toggles, restore } = captureControls();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    tab.renderPanneauxCategory(new FakeElement());
    await panelToggles(toggles).find((c) => c.name === t("sidebar.tab.notes")).change(false);
  } finally {
    Notice.onCreate = null;
    restore();
  }

  assert.equal(settings.hiddenPanels.includes("notes"), false);
  assert.deepEqual(calls, { save: 0, render: 0 });
  assert.equal(notices.length, 1);
});

test("Réglages : l'UI ne propose ni n'écrit jamais \"analyse\"", async () => {
  const settings = createSettings("notes", []);
  const { tab, calls } = createTab(settings);
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
    const initialTab = initialTabDropdown(dropdowns);
    assert.ok(!initialTab.options.some(([key]) => key === "analyse"), "aucune option analyse");
    for (const [key] of initialTab.options) {
      await initialTab.change(key);
      assert.notEqual(settings.activeRightPanelTab, "analyse", `choix « ${key} » n'écrit jamais analyse`);
    }
  } finally {
    restore();
  }

  assert.equal(calls.save, 6, "un seul enregistrement par choix du dropdown");
});
