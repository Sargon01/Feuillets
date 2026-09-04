import test from "node:test";
import assert from "node:assert/strict";
import { knownProjectType, resolveType } from "../src/utils/project-modes.js";
import { migrateLegacyProjectTypes } from "../src/services/project-settings.js";

function settings(overrides = {}) {
  return {
    projectFolder: "",
    projects: [],
    projectMeta: {},
    ...overrides,
  };
}

test("legacy : les projets sans type sont figés en Fiction une seule fois", () => {
  const value = settings({
    projectFolder: "Projet/Manuscrit",
    projects: ["SeulementDansProjects"],
    projectMeta: {
      "SansType": { outlineCols: { pov: true }, planningField: "summary", newSheetIncludeSources: true },
      Inconnu: { type: "ancien-type", citationStyle: "parenthetical" },
      Fiction: { type: "fiction" },
      Nonfiction: { type: "essai" },
    },
  });

  assert.equal(migrateLegacyProjectTypes(value), 4);
  assert.equal(value.projectMeta["SansType"].type, "fiction");
  assert.equal(value.projectMeta.Inconnu.type, "fiction");
  assert.equal(value.projectMeta.SeulementDansProjects.type, "fiction");
  assert.equal(value.projectMeta["Projet/Manuscrit"].type, "fiction");
  assert.equal(value.projectMeta.Fiction.type, "fiction");
  assert.equal(value.projectMeta.Nonfiction.type, "essai");
  assert.deepEqual(value.projectMeta["SansType"].outlineCols, { pov: true });
  assert.equal(value.projectMeta["SansType"].planningField, "summary");
  assert.equal(value.projectMeta["SansType"].newSheetIncludeSources, true);
  assert.equal(value.projectMeta.Inconnu.citationStyle, "parenthetical");
  assert.equal(migrateLegacyProjectTypes(value), 0);
});

test("legacy : les alias connus restent inchangés", () => {
  for (const [type, expected] of [["fiction", "fiction"], ["roman", "fiction"], ["nouvelle", "fiction"], ["nonfiction", "nonfiction"], ["non-fiction", "nonfiction"], ["essai", "nonfiction"], ["these", "nonfiction"], ["thèse", "nonfiction"], ["article", "nonfiction"], ["free", "free"], ["libre", "free"]]) {
    assert.equal(knownProjectType(type), expected);
  }
});

test("futurs projets sans type utilisent Libre", () => {
  assert.equal(knownProjectType(undefined), null);
  assert.equal(knownProjectType("inconnu"), null);
  assert.equal(resolveType(undefined), "free");
  assert.equal(resolveType(null), "free");
  assert.equal(resolveType("inconnu"), "free");
});
