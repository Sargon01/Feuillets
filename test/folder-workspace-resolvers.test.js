import assert from "node:assert/strict";
import test from "node:test";
import { TFolder } from "obsidian";
import {
  workspaceDeadline,
  workspaceFavoriteTags,
  workspaceLabels,
  workspaceSessionGoal,
  workspaceStatuses,
  workspaceTolerance,
  workspaceTotalWordGoal,
  workspaceWordGoalDefault,
} from "../src/services/folder-workspaces.js";

const rootPath = "Projet/Manuscrit";
const root = new TFolder(rootPath);
const folder = new TFolder(`${rootPath}/Cours/3e/EMC`);
const parent = new TFolder(`${rootPath}/Cours`);
const outside = new TFolder("Autre/EMC");

function settings(overrides = {}) {
  return {
    projectFolder: rootPath,
    projectMeta: {
      [rootPath]: {
        statuses: [{ name: "Projet", color: "red" }],
        labels: ["projet"],
        favoriteTags: ["projet"],
        wordGoal: 500,
        tolerance: 10,
        projectWordGoal: 1000,
        deadlineDate: "2026-01-01",
        sessionGoal: 3,
        ...(overrides.meta || {}),
      },
    },
    statuses: [{ name: "Global", color: "blue" }],
    labels: ["global"],
    favoriteTags: ["global"],
    wordGoal: 100,
    tolerance: 5,
    projectWordGoal: 200,
    deadlineDate: "2027-01-01",
    sessionGoal: 1,
    ...overrides,
  };
}

function app() {
  return { vault: { getAbstractFileByPath: (path) => path === rootPath ? root : null } };
}

test("les résolveurs workspace suivent enfant, parent, projet puis global", () => {
  const S = settings({ meta: {
    folderWorkspaces: {
      Cours: {
        version: 1,
        statuses: [{ name: "Parent", color: "green" }],
        wordGoal: 0,
        deadlineDate: "",
      },
      "Cours/3e/EMC": {
        version: 1,
        labels: [],
        favoriteTags: [],
        tolerance: 0,
        projectWordGoal: 0,
        sessionGoal: 0,
      },
    },
  } });
  const A = app();
  assert.deepEqual(workspaceStatuses(A, S, folder), [{ name: "Parent", color: "green" }]);
  assert.deepEqual(workspaceLabels(A, S, folder), []);
  assert.deepEqual(workspaceFavoriteTags(A, S, folder), []);
  assert.equal(workspaceWordGoalDefault(A, S, folder), 0);
  assert.equal(workspaceTolerance(A, S, folder), 0);
  assert.equal(workspaceTotalWordGoal(A, S, folder), 0);
  assert.equal(workspaceDeadline(A, S, folder), "");
  assert.equal(workspaceSessionGoal(A, S, folder), 0);
});

test("racine, null et hors projet utilisent les résolveurs projet", () => {
  const S = settings();
  const A = app();
  for (const current of [root, null, outside]) {
    assert.equal(workspaceWordGoalDefault(A, S, current), 500);
    assert.equal(workspaceDeadline(A, S, current), "2026-01-01");
    assert.deepEqual(workspaceLabels(A, S, current), ["projet"]);
  }
  assert.deepEqual(workspaceStatuses(A, S, parent), [{ name: "Projet", color: "red" }]);
});

test("un preset seul n'est pas une valeur résolue et la lecture ne mute rien", () => {
  const S = settings({ meta: { folderWorkspaces: { Cours: { version: 1, preset: "fiction" } } } });
  const before = structuredClone(S);
  const A = app();
  assert.equal(workspaceWordGoalDefault(A, S, parent), 500);
  assert.equal(workspaceTolerance(A, S, parent), 10);
  assert.equal(workspaceSessionGoal(A, S, parent), 3);
  assert.deepEqual(S, before);
});
