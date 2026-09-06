import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const baseSource = read("src/views/base-feuillets-view.ts");
const boardSource = read("src/views/board-view.ts");
const filesSource = read("src/services/project-files.ts");
const statsSource = read("src/ui/stats-modal.ts");
const mainSource = read("src/main.ts");

test("les objectifs de feuillet utilisent le dossier parent réel", () => {
  assert.match(baseSource, /workspaceWordGoalDefault\(this\.app, this\.plugin\.settings, file\.parent\)/);
  assert.match(baseSource, /workspaceTolerance\(this\.app, this\.plugin\.settings, folder\)/);
  assert.match(boardSource, /workspaceWordGoalDefault\(this\.app, this\.plugin\.settings, file\.parent\)/);
  assert.match(mainSource, /workspaceWordGoalDefault\(this\.app, this\.settings, file\.parent\)/);
  assert.match(mainSource, /workspaceTolerance\(this\.app, this\.settings, file\.parent\)/);
});

test("la création reçoit le défaut du dossier cible", () => {
  assert.match(filesSource, /workspaceWordGoalDefault\(app, settings, folder\)/);
  assert.match(filesSource, /sheetFrontmatter\(app, settings, title, position, folder\)/);
  assert.match(mainSource, /sheetFrontmatter\(this\.app, this\.settings, chapTitle \|\| "", 0, folder\)/);
});

test("les statistiques utilisent le workspace et ses objectifs effectifs", () => {
  assert.match(statsSource, /const scope = workspace \|\| root/);
  assert.match(statsSource, /plugin\.flattenFiles\(scope\)/);
  assert.match(statsSource, /workspaceTotalWordGoal\(app, plugin\.settings, scope\)/);
  assert.match(statsSource, /workspaceDeadline\(app, plugin\.settings, scope\)/);
  assert.match(statsSource, /workspaceTolerance\(this\.app, this\.plugin\.settings, folder\)/);
});

test("sessionGoal reste disponible mais non consommé par le runtime", () => {
  assert.doesNotMatch(mainSource, /workspaceSessionGoal/);
  assert.doesNotMatch(baseSource, /workspaceSessionGoal/);
  assert.doesNotMatch(boardSource, /workspaceSessionGoal/);
  assert.doesNotMatch(statsSource, /workspaceSessionGoal/);
});
