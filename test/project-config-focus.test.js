import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("src/ui/project-config-content.ts", `file://${process.cwd()}/`), "utf8");

test("Les éditions Objectifs, Statuts, Labels et Tags sauvegardent sans rerender", () => {
  for (const method of ["renderProjectGoalsPage", "renderProjectStatusesPage", "renderProjectLabelsPage", "renderProjectTagsPage"]) {
    assert.match(source, new RegExp(`private ${method}\\(`));
  }
  assert.match(source, /setValue\(String\(getValue\(\)\)\)\.onChange\(\(v\) => \{[\s\S]*?void this\.plugin\.saveSettings\(\);/);
  assert.match(source, /arr\[i\]\.name = v\.trim\(\) \|\|[\s\S]*?void this\.plugin\.saveSettings\(\);/);
  assert.match(source, /favoriteTags = \[[\s\S]*?void this\.plugin\.saveSettings\(\);/);
});

test("Un mapping ordinaire ne demande plus de rerender, une nouvelle propriété oui", () => {
  assert.match(source, /this\.applyMapping\(path, field, name\);\s+this\.requestRender\(\);/);
  assert.match(source, /void this\.plugin\.saveSettings\(\);\s+this\.plugin\.renderAllViews\(true\);\s+\}/);
});
