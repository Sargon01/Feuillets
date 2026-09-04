import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import {
  newSheetIncludeSourcesForProjectType,
  planningFieldForProjectType,
  projectNewSheetIncludeSources,
  projectPlanningField,
} from "../src/services/project-settings.js";
import { createMinimalProject } from "../src/services/project-files.js";
import { createFakeVault } from "./helpers/fake-vault.js";

function settingsFor(path, meta = {}) {
  return {
    projectFolder: path,
    projectMeta: { [path]: meta },
  };
}

function appFor(path) {
  const folder = new TFolder(path);
  const { vault } = createFakeVault([folder]);
  return { app: { vault }, folder };
}

test("les fallbacks runtime suivent les presets historiques", () => {
  assert.equal(planningFieldForProjectType("fiction"), "synopsis");
  assert.equal(planningFieldForProjectType("nonfiction"), "summary");
  assert.equal(planningFieldForProjectType("free"), "summary");
  assert.equal(planningFieldForProjectType(undefined), "summary");
  assert.equal(planningFieldForProjectType("unknown"), "summary");

  assert.equal(newSheetIncludeSourcesForProjectType("fiction"), false);
  assert.equal(newSheetIncludeSourcesForProjectType("nonfiction"), true);
  assert.equal(newSheetIncludeSourcesForProjectType("free"), true);
  assert.equal(newSheetIncludeSourcesForProjectType(undefined), true);
  assert.equal(newSheetIncludeSourcesForProjectType("unknown"), true);
});

test("les préférences persistées valides priment sur le type", () => {
  const { app } = appFor("Projet/Manuscrit");
  const settings = settingsFor("Projet/Manuscrit", {
    type: "fiction",
    planningField: "summary",
    newSheetIncludeSources: true,
  });
  assert.equal(projectPlanningField(app, settings), "summary");
  assert.equal(projectNewSheetIncludeSources(app, settings), true);

  settings.projectMeta["Projet/Manuscrit"] = {
    type: "free",
    planningField: "synopsis",
    newSheetIncludeSources: false,
  };
  assert.equal(projectPlanningField(app, settings), "synopsis");
  assert.equal(projectNewSheetIncludeSources(app, settings), false);
});

test("les projets legacy retombent sur le type sans mutation", () => {
  const { app } = appFor("Projet/Manuscrit");
  for (const [type, planningField, includeSources] of [
    ["fiction", "synopsis", false],
    ["nonfiction", "summary", true],
    ["free", "summary", true],
    [undefined, "summary", true],
  ]) {
    const settings = settingsFor("Projet/Manuscrit", type === undefined ? {} : { type });
    const before = structuredClone(settings.projectMeta);
    assert.equal(projectPlanningField(app, settings), planningField);
    assert.equal(projectNewSheetIncludeSources(app, settings), includeSources);
    assert.deepEqual(settings.projectMeta, before);
  }

  const absent = { projectFolder: "Projet/Manuscrit", projectMeta: {} };
  const before = structuredClone(absent);
  assert.equal(projectPlanningField(app, absent), "summary");
  assert.equal(projectNewSheetIncludeSources(app, absent), true);
  assert.deepEqual(absent, before);
});

test("une valeur persistée invalide est ignorée sans être corrigée", () => {
  const { app } = appFor("Projet/Manuscrit");
  const settings = settingsFor("Projet/Manuscrit", { type: "nonfiction", planningField: "invalid" });
  const before = structuredClone(settings.projectMeta);
  assert.equal(projectPlanningField(app, settings), "summary");
  assert.equal(projectNewSheetIncludeSources(app, settings), true);
  assert.deepEqual(settings.projectMeta, before);
});

test("createMinimalProject initialise les deux préférences pour chaque preset", async () => {
  for (const [type, planningField, includeSources] of [
    ["fiction", "synopsis", false],
    ["nonfiction", "summary", true],
    ["free", "summary", true],
  ]) {
    const { vault } = createFakeVault([]);
    const settings = structuredClone(DEFAULT_SETTINGS);
    const result = await createMinimalProject({ vault }, settings, { name: `Projet ${type}`, type });
    const meta = settings.projectMeta[result.manuscritPath];
    assert.equal(meta.planningField, planningField);
    assert.equal(meta.newSheetIncludeSources, includeSources);
  }
});
