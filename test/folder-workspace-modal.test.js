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
  assert.match(modalSource, /modal\.folderWorkspace\.workflow/);
  assert.match(modalSource, /modal\.folderWorkspace\.goals/);
  assert.match(modalSource, /workspaceStatuses\(/);
  assert.match(modalSource, /workspaceLabels\(/);
  assert.match(modalSource, /workspaceFavoriteTags\(/);
  assert.match(modalSource, /workspaceWordGoalDefault\(/);
  assert.match(modalSource, /workspaceTotalWordGoal\(/);
  assert.match(modalSource, /workspaceSessionGoal\(/);
  assert.match(modalSource, /workspaceDeadline\(/);
  assert.match(modalSource, /workspaceFieldSource\(/);
  assert.match(modalSource, /saveLocalField/);
  assert.match(modalSource, /resetLocalField/);
  assert.doesNotMatch(modalSource, /projectMeta\[projectRootPath\]\.type\s*=/);
});

test("workspace reset removes only the configured folder entry", () => {
  assert.match(modalSource, /delete next\[relativeScope\]/);
  assert.match(modalSource, /delete meta\.folderWorkspaces/);
  assert.doesNotMatch(modalSource, /for \(const .*folderWorkspaces/);
});

/* REFACTORISATION — statut d'ouvrage intégré à l'espace de travail : l'ancien
 * menu contextuel Binder (« Définir comme ouvrage » / « Retirer le statut
 * d'ouvrage ») est remplacé par une option dans cette modale, exclusivement
 * lue et écrite via services/editorial-roots.ts. */
test("workspace modal expose l'option ouvrage via les API editorial-roots existantes", () => {
  assert.match(modalSource, /import \{ isOuvrageRoot, ouvrageRelativePath, registerOuvrage, unregisterOuvrage \} from "\.\.\/services\/editorial-roots\.js";/);
  assert.match(modalSource, /renderOuvrageOption/);
  assert.match(modalSource, /t\("modal\.folderWorkspace\.defineAsOuvrage"\)/);
  assert.match(modalSource, /isOuvrageRoot\(this\.app, this\.plugin\.settings, projectRoot, this\.folder\)/);
  assert.match(modalSource, /registerOuvrage\(this\.plugin\.settings, projectRoot, this\.folder\)/);
  assert.match(modalSource, /unregisterOuvrage\(this\.plugin\.settings, projectRoot, this\.folder\)/);
});

test("workspace modal : l'option ouvrage exclut la racine globale, Front et ses descendants, et les dossiers préfixés par _", () => {
  assert.match(modalSource, /const rel = ouvrageRelativePath\(projectRoot\.path, this\.folder\.path\);\s*if \(!rel\) return;/);
  assert.match(modalSource, /this\.folder\.name\.startsWith\("_"\)/);
  assert.match(modalSource, /normalizePath\(`\$\{projectRoot\.path\}\/Front`\)/);
  assert.match(modalSource, /this\.folder\.name === "Front" \|\| this\.folder\.path\.split\("\/"\)\.includes\("Front"\)/);
});
