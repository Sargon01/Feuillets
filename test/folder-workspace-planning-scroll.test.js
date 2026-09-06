import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const workspaceSource = read("src/services/folder-workspaces.ts");
const filesSource = read("src/services/project-files.ts");
const notesSource = read("src/views/notes-view.ts");
const boardSource = read("src/views/board-view.ts");
const modalSource = read("src/ui/folder-workspace-modal.ts");

test("les préférences planning locales suivent l'héritage workspace", () => {
  assert.match(workspaceSource, /export function workspacePlanningField/);
  assert.match(workspaceSource, /export function workspaceNewSheetIncludeSources/);
  assert.match(workspaceSource, /projectPlanningField\(app, settings\)/);
  assert.match(workspaceSource, /projectNewSheetIncludeSources\(app, settings\)/);
  assert.match(workspaceSource, /export function workspaceCardContent/);
  assert.match(workspaceSource, /export function workspaceHiddenBoardModes/);
  assert.match(workspaceSource, /export function workspaceOutlineColumns/);
});

test("création et vues utilisent le planning du dossier affiché", () => {
  assert.match(filesSource, /workspacePlanningField\(app, settings, folder\)/);
  assert.match(filesSource, /workspaceNewSheetIncludeSources\(app, settings, folder\)/);
  assert.match(notesSource, /workspacePlanningField\(this\.app, this\.plugin\.settings, file\.parent\)/);
  assert.match(boardSource, /workspacePlanningField\(this\.app, S, workflowFolder\)/);
  assert.match(boardSource, /workspaceCardContent\(this\.app, S, workflowFolder, planningField\)/);
  assert.match(boardSource, /workspaceHiddenBoardModes\(this\.app, S, workflowFolder\)/);
  assert.match(boardSource, /workspaceOutlineColumns\(this\.app, S, workflowFolder, planningField\)/);
});

test("les rerenders structurels du modal conservent le viewport", () => {
  assert.match(modalSource, /const scrollTop = this\.contentEl\.scrollTop/);
  assert.match(modalSource, /this\.renderContent\(\)/);
  assert.match(modalSource, /this\.contentEl\.scrollTop = scrollTop/);
  assert.match(modalSource, /window\.requestAnimationFrame\(\(\) => \{ this\.contentEl\.scrollTop = scrollTop; \}\)/);
  assert.match(modalSource, /saveLocalField[\s\S]{0,500}if \(structural\)/);
});

test("les listes Statuts et Labels se rafraîchissent dans des conteneurs stables", () => {
  assert.match(modalSource, /feuillets-workspace-status-list/);
  assert.match(modalSource, /feuillets-workspace-label-list/);
  assert.match(modalSource, /saveLocalListField/);
  assert.doesNotMatch(modalSource, /saveLocalListField[\s\S]{0,300}rerenderContent\(\)/);
  assert.match(modalSource, /contentEl\.addClass\("feuillets-project-modal"\)/);
  assert.match(modalSource, /feuillets-modal-title-row/);
  assert.match(modalSource, /feuillets-settings-subhead/);
});

test("les quatre vues et les réglages du Plan restent configurables localement", () => {
  assert.match(modalSource, /workspaceHiddenBoardModes\(this\.app, this\.plugin\.settings, this\.folder\)/);
  assert.match(modalSource, /\["board", t\("board\.mode\.board"\)\]/);
  assert.match(modalSource, /\["outline", t\("board\.mode\.outline"\)\]/);
  assert.match(modalSource, /\["arcs", t\("board\.mode\.arcs"\)\]/);
  assert.match(modalSource, /\["timeline", t\("board\.mode\.timeline"\)\]/);
  assert.match(modalSource, /workspaceOutlineColumns\(this\.app, this\.plugin\.settings, this\.folder, planningField\)/);
  assert.match(modalSource, /workspaceCardContent\(this\.app, this\.plugin\.settings, this\.folder, planningField\)/);
  assert.match(modalSource, /"hiddenBoardModes", next, true/);
  assert.match(modalSource, /"outlineCols", next, true/);
  assert.match(modalSource, /"cardContent", value, true/);
  assert.doesNotMatch(modalSource, /workspace.*boardMode/);
});

test("Board revient vers Cartes puis Plan lorsqu'un mode devient invisible", () => {
  assert.match(boardSource, /const preferredModes = \["board", "outline"\]/);
  assert.match(boardSource, /preferredModes\.find\(\(candidate\) => visibleModes\.includes\(candidate\)\)/);
  assert.doesNotMatch(boardSource, /if\s*\([^)]*projectType[^)]*\)[\s\S]{0,100}hiddenBoardModes/);
});

test("les menus Board écrivent dans le workspace exact lorsqu'il est isolé", () => {
  assert.match(workspaceSource, /export function ensureExactFolderWorkspaceConfig/);
  assert.match(boardSource, /workspaceFolder: localWorkspaceActive \? focusedFolder : null/);
  assert.match(boardSource, /config\.hiddenBoardModes = \[\.\.\.arr\]/);
  assert.match(boardSource, /config\.cardContent = val/);
  assert.match(boardSource, /config\.outlineCols = nextOutlineColumns/);
  assert.match(boardSource, /meta\.hiddenBoardModes = arr/);
  assert.match(boardSource, /S\.hiddenBoardModes = arr/);
  assert.match(boardSource, /meta\.cardContent = val/);
  assert.match(boardSource, /S\.cardContent = val/);
  assert.match(boardSource, /meta\.outlineCols = nextOutlineColumns/);
  assert.match(boardSource, /S\.outlineCols = \{ \.\.\.nextOutlineColumns \}/);
});
