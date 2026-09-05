import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modalSource = readFileSync("src/ui/folder-workspace-modal.ts", "utf8");
const binderSource = readFileSync("src/views/feuillets-view.ts", "utf8");

test("workspace folder context menu opens the local configuration modal only for descendants", () => {
  assert.match(binderSource, /folderWorkspaceExtras\(folder: TFolder\)/);
  assert.match(binderSource, /folderPathToWorkspaceScope\(projectRoot\.path, folder\.path\)/);
  assert.match(binderSource, /new FolderWorkspaceModal\(this\.app, this\.plugin, folder\)\.open\(\)/);
  assert.match(binderSource, /this\.folderWorkspaceExtras\(child\)\(menu\)/);
  assert.match(binderSource, /this\.folderWorkspaceExtras\(treeRoot\)\(menu\)/);
});

test("workspace modal reads provenance without creating settings and applies only preset fields", () => {
  assert.match(modalSource, /folderWorkspaceScopeChain/);
  assert.match(modalSource, /getFolderWorkspaceConfig/);
  assert.match(modalSource, /workspaceScopeToFolderPath/);
  assert.match(modalSource, /localConfig\s*\?/);
  assert.match(modalSource, /inheritedFromParent/);
  assert.match(modalSource, /inheritedFromProject/);
  assert.match(modalSource, /preset,/);
  assert.match(modalSource, /planningField:/);
  assert.match(modalSource, /newSheetIncludeSources:/);
  assert.match(modalSource, /cardContent:/);
  assert.match(modalSource, /hiddenBoardModes:/);
  assert.match(modalSource, /outlineCols:/);
  assert.doesNotMatch(modalSource, /projectMeta\[projectRootPath\]\.type\s*=/);
});

test("workspace reset removes only the configured folder entry", () => {
  assert.match(modalSource, /delete next\[relativeScope\]/);
  assert.match(modalSource, /delete meta\.folderWorkspaces/);
  assert.doesNotMatch(modalSource, /for \(const .*folderWorkspaces/);
});
