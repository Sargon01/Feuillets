import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(`${process.cwd()}/src/views/notes-view.ts`, "utf8");
const start = source.indexOf("const planningField = projectPlanningField");
const end = source.indexOf("// Références du passage", start);
const planningBlock = source.slice(start, end);

test("NotesView utilise le planningField runtime, pas le ProjectType", () => {
  assert.match(source, /projectPlanningField/);
  assert.doesNotMatch(source, /getProjectType/);
  assert.match(planningBlock, /planningField === "synopsis"/);
  assert.match(planningBlock, /planningField === "summary"/);
  assert.doesNotMatch(planningBlock, /"fiction"|"nonfiction"|"free"/);
});
