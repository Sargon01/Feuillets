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
