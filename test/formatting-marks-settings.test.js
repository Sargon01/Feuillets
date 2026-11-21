import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import FeuilletsPlugin from "../src/main.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

async function load(data) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  let saved;
  plugin.loadData = async () => structuredClone(data);
  plugin.saveData = async (value) => { saved = structuredClone(value); };
  plugin.trimStats = () => {};
  await plugin.loadSettings();
  return { plugin, saved: () => saved };
}

test("formatting marks default off for new, legacy and invalid settings", async () => {
  assert.equal(DEFAULT_SETTINGS.showFormattingMarks, false);
  for (const data of [null, {}, { liveTwoEnters: true }, { showFormattingMarks: "true" }, { showFormattingMarks: null }]) {
    assert.equal((await load(data)).plugin.settings.showFormattingMarks, false);
  }
});

test("formatting marks refresh before persistence and survive a plugin restart", async () => {
  const { plugin, saved } = await load({});
  const refreshed = [];
  plugin.formattingMarks = { refresh: () => refreshed.push(plugin.settings.showFormattingMarks) };
  await plugin.setShowFormattingMarks(true);
  assert.deepEqual(refreshed, [true]);
  assert.equal(saved().showFormattingMarks, true);
  const restarted = await load(saved());
  assert.equal(restarted.plugin.settings.showFormattingMarks, true);
  await plugin.setShowFormattingMarks(false);
  assert.deepEqual(refreshed, [true, false]);
  assert.equal((await load(saved())).plugin.settings.showFormattingMarks, false);
});

test("palette command and Appearance preference use the same setter", async () => {
  const { plugin } = await load({});
  const commands = [];
  let updates = 0;
  plugin.addCommand = (command) => commands.push(command);
  plugin.formattingMarks = { refresh() {} };
  plugin.formattingMarksSettingTab = { update: () => { updates++; } };
  plugin.registerCoreCommands();
  const command = commands.find((entry) => entry.id === "toggle-formatting-marks");
  assert.ok(command);
  await command.callback();
  assert.equal(plugin.settings.showFormattingMarks, true);
  await command.callback();
  assert.equal(plugin.settings.showFormattingMarks, false);
  assert.equal(updates, 2);
  const panel = await readFile("src/settings/feuillets-setting-tab.ts", "utf8");
  const appearance = panel.slice(panel.indexOf("private renderInterfaceCategory"), panel.indexOf("private renderPanneauxCategory"));
  assert.match(appearance, /settings\.showFormattingMarks\.name/);
  assert.match(appearance, /this\.plugin\.setShowFormattingMarks\(value\)/);
});

test("formatting marks remain exclusive to the two CodeMirror writing surfaces", async () => {
  const { readdir } = await import("node:fs/promises");
  for (const directory of ["src/services", "src/views"]) {
    for (const name of await readdir(directory)) {
      if (!/preview|export|compile|presentation/.test(name) || !name.endsWith(".ts")) continue;
      assert.doesNotMatch(await readFile(`${directory}/${name}`, "utf8"), /cm-formatting-marks|showFormattingMarks|feuillets-formatting-line-end/);
    }
  }
});
