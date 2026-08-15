import assert from "node:assert/strict";
import test from "node:test";
import { Setting } from "obsidian";
import { t } from "../src/i18n/index.js";
import { FeuilletsSettingTab } from "../src/settings/feuillets-setting-tab.js";

/* Ajustement "aperçu du Binder" §10-11 : la section Binder du panneau
 * Paramètres est mise en cohérence avec le menu local (Binder ↔
 * showSplitPaneOptionsMenu, feuillets-view.ts) —
 * - retire les contrôles devenus sans effet (tags/statut/progression/mots) ;
 * - garde liseré de label, aperçu de la fiche, nombre de lignes ;
 * - propose EXACTEMENT la même grammaire d'aperçu que le menu local
 *   (Fiction : Aucun/Extrait/Synopsis ; Non-fiction/Libre :
 *   Aucun/Extrait/Résumé long — jamais les deux champs sémantiques
 *   ensemble, jamais Notes de travail ni Tags) ;
 * - borne le slider de lignes à 1-3. */

class FakeElement {
  createDiv() { return new FakeElement(); }
  createSpan() { return new FakeElement(); }
  createEl() { return new FakeElement(); }
  empty() {}
  addEventListener() {}
  setText() { return this; }
}

function captureControls() {
  const methods = ["setName", "setDesc", "addToggle", "addSlider", "addDropdown", "addText", "addButton"];
  const previous = Object.fromEntries(methods.map((name) => [name, Setting.prototype[name]]));
  const toggles = [];
  const sliders = [];
  const dropdowns = [];

  Setting.prototype.setName = function (name) { this.name = name; return this; };
  Setting.prototype.setDesc = function () { return this; };
  Setting.prototype.addToggle = function (configure) {
    const control = {
      setValue() { return this; },
      onChange(cb) { this.change = cb; return this; },
    };
    configure(control);
    toggles.push({ name: this.name, change: control.change });
    return this;
  };
  Setting.prototype.addSlider = function (configure) {
    const control = {
      limits: null,
      value: undefined,
      setLimits(min, max, step) { this.limits = [min, max, step]; return this; },
      setValue(v) { this.value = v; return this; },
      onChange(cb) { this.change = cb; return this; },
    };
    configure(control);
    sliders.push({ name: this.name, limits: control.limits, value: control.value, change: control.change });
    return this;
  };
  Setting.prototype.addDropdown = function (configure) {
    const control = {
      options: [],
      value: undefined,
      addOption(key, label) { this.options.push({ key, label }); return this; },
      setValue(v) { this.value = v; return this; },
      onChange(cb) { this.change = cb; return this; },
    };
    configure(control);
    dropdowns.push({ name: this.name, options: control.options, value: control.value, change: control.change });
    return this;
  };
  for (const method of ["addText", "addButton"]) {
    Setting.prototype[method] = function (configure) {
      configure({ setValue() { return this; }, setButtonText() { return this; }, onClick() { return this; }, onChange() { return this; } });
      return this;
    };
  }

  return { toggles, sliders, dropdowns, restore: () => Object.assign(Setting.prototype, previous) };
}

function createSettings(overrides = {}) {
  return {
    activeRightPanelTab: "notes",
    hiddenPanels: [],
    projectMeta: {},
    hiddenBoardModes: [],
    autoOpenBinder: true,
    autoOpenInspector: true,
    binderShowLabels: true,
    binderShowTags: true,
    binderShowStatus: true,
    binderShowProgress: true,
    binderShowWords: true,
    listPanePreviewField: "synopsis",
    listPanePreviewLines: 2,
    tileSize: 240,
    ...overrides,
  };
}

function createTab(settings, cardContent) {
  const calls = { save: 0, render: 0 };
  const plugin = {
    settings,
    projectMode: () => ({ researchFolders: {}, defaults: { cardContent } }),
    unitLabel: () => "feuillet",
    getProjectFolder: () => null,
    refreshView() {},
    saveSettings: async () => { calls.save += 1; },
    renderAllViews: () => { calls.render += 1; },
  };
  return { tab: new FeuilletsSettingTab({}, plugin), calls };
}

/* ===================== 10 — plus de tags/statut/progression/mots ===================== */

test("10. Paramètres Binder : ne contiennent plus les contrôles tags/statut/progression/mots, gardent le liseré de label", async () => {
  const settings = createSettings();
  const { tab } = createTab(settings, "synopsis");
  const { toggles, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  const names = toggles.map((tg) => tg.name);
  assert.ok(names.includes(t("binder.display.labelStripes")), "le liseré de label doit rester réglable");
  assert.ok(!names.includes(t("binder.display.tagChips")), "plus de contrôle tags");
  assert.ok(!names.includes(t("binder.display.statusDot")), "plus de contrôle statut");
  assert.ok(!names.includes(t("binder.display.progressBars")), "plus de contrôle progression");
  assert.ok(!names.includes(t("binder.display.wordCountNumbers")), "plus de contrôle mots");
});

test("10bis. Paramètres Binder : le slider de lignes d'aperçu est borné à 1-3", async () => {
  const settings = createSettings({ listPanePreviewLines: 6 });
  const { tab } = createTab(settings, "synopsis");
  const { sliders, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  const linesSlider = sliders.find((s) => s.name === t("settings.previewLines.name"));
  assert.ok(linesSlider, "le slider de lignes doit exister");
  assert.deepEqual(linesSlider.limits, [1, 3, 1]);
  assert.equal(linesSlider.value, 3, "une ancienne valeur 6 doit être affichée bornée à 3");
});

/* ===================== 11 — même grammaire que le menu local ===================== */

test("11. Fiction : le dropdown Paramètres propose exactement none/extrait/synopsis", async () => {
  const settings = createSettings();
  const { tab } = createTab(settings, "synopsis");
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  const fieldDropdown = dropdowns.find((d) => d.name === t("settings.previewField.name"));
  assert.ok(fieldDropdown);
  assert.deepEqual(fieldDropdown.options.map((o) => o.key), ["none", "extrait", "synopsis"]);
});

test("11bis. Non-fiction/Libre : le dropdown Paramètres propose exactement none/extrait/summary", async () => {
  const settings = createSettings();
  const { tab } = createTab(settings, "summary");
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  const fieldDropdown = dropdowns.find((d) => d.name === t("settings.previewField.name"));
  assert.ok(fieldDropdown);
  assert.deepEqual(fieldDropdown.options.map((o) => o.key), ["none", "extrait", "summary"]);
});

test("11ter. ancienne valeur 'summary' affichée dans un projet Fiction : le dropdown est positionné sur synopsis, jamais sur une option absente", async () => {
  const settings = createSettings({ listPanePreviewField: "summary" });
  const { tab } = createTab(settings, "synopsis");
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  const fieldDropdown = dropdowns.find((d) => d.name === t("settings.previewField.name"));
  assert.equal(fieldDropdown.value, "synopsis");
  assert.ok(fieldDropdown.options.some((o) => o.key === fieldDropdown.value), "la valeur affichée doit être une option réellement proposée");
});

test("11quater. ancienne valeur 'tags' : le dropdown est positionné sur none", async () => {
  const settings = createSettings({ listPanePreviewField: "tags" });
  const { tab } = createTab(settings, "synopsis");
  const { dropdowns, restore } = captureControls();
  try {
    tab.renderPanneauxCategory(new FakeElement());
  } finally {
    restore();
  }

  const fieldDropdown = dropdowns.find((d) => d.name === t("settings.previewField.name"));
  assert.equal(fieldDropdown.value, "none");
});
