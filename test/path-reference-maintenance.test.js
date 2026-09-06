import test from "node:test";
import assert from "node:assert/strict";
import { remapPath, remapFeuilletsPathReferences } from "../src/carnet/core/path-reference-maintenance.js";

test("remapPath only accepts exact paths and descendants", () => {
  assert.equal(remapPath("Projet/Foo/A", "Projet/Foo", "Projet/Bar"), "Projet/Bar/A");
  assert.equal(remapPath("Projet/Foo-Bar", "Projet/Foo", "Projet/Bar"), "Projet/Foo-Bar");
});

test("path maintenance remaps active settings while preserving relative Carnet scope on root rename", () => {
  const settings = { projectFolder: "Projet/Manuscrit", projects: ["Projet/Manuscrit"], projectMeta: { "Projet/Manuscrit": { researchFolderLinks: { "Projet/Manuscrit/A": "Projet/Recherche/A" }, folderCarnets: { "Recherche/Personnages": { id: "123e4567-e89b-12d3-a456-426614174000", version: 1 } } } }, orders: { "Projet": ["Manuscrit"] }, folderPositions: {}, folderGoals: {}, collapsed: { "binder:vault:Projet/Manuscrit/A": true, "analyse:x": true }, notesPinned: { "Projet/Manuscrit/A.md": ["Projet/Recherche/A.md"] } };
  const result = remapFeuilletsPathReferences(settings, "Projet", "Nouveau");
  assert.equal(result.changed, true);
  assert.equal(settings.projectFolder, "Nouveau/Manuscrit");
  assert.ok(settings.projectMeta["Nouveau/Manuscrit"]);
  assert.ok(settings.projectMeta["Nouveau/Manuscrit"].folderCarnets["Recherche/Personnages"]);
  assert.equal(settings.collapsed["analyse:x"], true);
});

test("path maintenance remaps folder workspaces on an internal move", () => {
  const settings = {
    projectFolder: "Projet/Manuscrit",
    projects: ["Projet/Manuscrit"],
    projectMeta: {
      "Projet/Manuscrit": {
        folderWorkspaces: {
          "Cours": { version: 1, wordGoal: 1000 },
          "Cours/Partie": { version: 1, wordGoal: 2000 },
        },
      },
    },
  };
  const result = remapFeuilletsPathReferences(settings, "Projet/Manuscrit/Cours", "Projet/Manuscrit/Leçons");
  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(settings.projectMeta["Projet/Manuscrit"].folderWorkspaces), ["Leçons", "Leçons/Partie"]);
});

test("path maintenance signale une collision folderWorkspaces sans perte", () => {
  const settings = {
    projectFolder: "Projet/Manuscrit",
    projects: ["Projet/Manuscrit"],
    projectMeta: {
      "Projet/Manuscrit": {
        folderWorkspaces: {
          "A": { version: 1, wordGoal: 1000 },
          "B": { version: 1, wordGoal: 2000 },
        },
      },
    },
  };
  const result = remapFeuilletsPathReferences(settings, "Projet/Manuscrit/A", "Projet/Manuscrit/B");
  const workspaces = settings.projectMeta["Projet/Manuscrit"].folderWorkspaces;
  assert.equal(result.changed, false);
  assert.deepEqual(workspaces, {
    A: { version: 1, wordGoal: 1000 },
    B: { version: 1, wordGoal: 2000 },
  });
  assert.deepEqual(result.conflicts, [{ kind: "folderWorkspaces", from: "A", to: "B" }]);
});

test("path maintenance conserve un workspace déplacé hors du projet", () => {
  const settings = {
    projectFolder: "Projet/Manuscrit",
    projects: ["Projet/Manuscrit"],
    projectMeta: {
      "Projet/Manuscrit": {
        folderWorkspaces: { "Cours": { version: 1, wordGoal: 1000 } },
      },
    },
  };
  remapFeuilletsPathReferences(settings, "Projet/Manuscrit/Cours", "Autre/Cours");
  assert.deepEqual(settings.projectMeta["Projet/Manuscrit"].folderWorkspaces, {
    Cours: { version: 1, wordGoal: 1000 },
  });
});
