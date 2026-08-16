import assert from "node:assert/strict";
import test from "node:test";
import FeuilletsPlugin from "../src/main.js";

async function loadLegacySettings(data) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  let saved;
  plugin.loadData = async () => ({ ...data });
  plugin.saveData = async (settings) => { saved = { ...settings }; };
  plugin.trimStats = () => {};
  await plugin.loadSettings();
  return { plugin, saved: () => saved };
}

test("loadSettings migre les anciens panneaux droits vers l'Inspecteur", async () => {
  for (const [legacyKey, expectedTab] of [
    ["autoOpenNotes", "notes"],
    ["autoOpenResearch", "research"],
    ["autoOpenDocxReview", "relecture"],
    ["autoOpenProperties", "notes"],
  ]) {
    const { plugin } = await loadLegacySettings({ [legacyKey]: true });
    assert.equal(plugin.settings.autoOpenInspector, true);
    assert.equal(plugin.settings.activeRightPanelTab, expectedTab);
  }
});

test("loadSettings désactive l'Inspecteur si tous les anciens panneaux présents sont désactivés", async () => {
  const { plugin } = await loadLegacySettings({
    autoOpenNotes: false,
    autoOpenResearch: false,
    autoOpenJournal: false,
    autoOpenProject: false,
    autoOpenDocxReview: false,
    autoOpenProperties: false,
  });

  assert.equal(plugin.settings.autoOpenInspector, false);
});

test("loadSettings ne remplace pas les réglages actuels par les valeurs legacy", async () => {
  const { plugin } = await loadLegacySettings({
    autoOpenInspector: false,
    activeRightPanelTab: "journal",
    autoOpenNotes: true,
    autoOpenResearch: true,
  });

  assert.equal(plugin.settings.autoOpenInspector, false);
  assert.equal(plugin.settings.activeRightPanelTab, "journal");
});

test("loadSettings convertit les migrations historiques vers l'Inspecteur", async () => {
  const hub = await loadLegacySettings({ autoOpenHub: true, hubActiveTab: "research" });
  assert.equal(hub.plugin.settings.autoOpenInspector, true);
  assert.equal(hub.plugin.settings.activeRightPanelTab, "research");

  const progression = await loadLegacySettings({ autoOpenProgression: true });
  assert.equal(progression.plugin.settings.autoOpenInspector, true);
  assert.equal(progression.plugin.settings.activeRightPanelTab, "journal");

  const exported = await loadLegacySettings({ autoOpenExport: true });
  assert.equal(exported.plugin.settings.autoOpenInspector, true);
  assert.equal(exported.plugin.settings.activeRightPanelTab, "project");
});

test("saveSettings n'écrit plus les six anciennes clés d'ouverture", async () => {
  const { plugin, saved } = await loadLegacySettings({
    autoOpenNotes: true,
    autoOpenResearch: true,
    autoOpenJournal: true,
    autoOpenProject: true,
    autoOpenDocxReview: true,
    autoOpenProperties: true,
  });

  await plugin.saveSettings();
  for (const key of [
    "autoOpenNotes",
    "autoOpenResearch",
    "autoOpenJournal",
    "autoOpenProject",
    "autoOpenDocxReview",
    "autoOpenProperties",
  ]) {
    assert.equal(Object.hasOwn(saved(), key), false);
  }
});
