import assert from "node:assert/strict";
import test from "node:test";
import {
  folderPathToWorkspaceScope,
  folderWorkspaceScopeChain,
  getFolderWorkspaceConfig,
  resolveFolderWorkspaceValue,
} from "../src/services/folder-workspaces.js";

const config = (values) => ({ version: 1, ...values });

test("folder workspaces résout le dossier exact puis ses parents", () => {
  const meta = { folderWorkspaces: {
    "Cours": config({ wordGoal: 1000, liveJustify: false }),
    "Cours/Partie": config({ wordGoal: 2000 }),
  } };
  assert.equal(folderPathToWorkspaceScope("Projet/Manuscrit", "Projet/Manuscrit/Cours/Partie/Scène"), "Cours/Partie/Scène");
  assert.deepEqual(folderWorkspaceScopeChain("Projet/Manuscrit", "Projet/Manuscrit/Cours/Partie/Scène"), ["Cours/Partie/Scène", "Cours/Partie", "Cours"]);
  assert.deepEqual(getFolderWorkspaceConfig(meta, "Cours/Partie"), config({ wordGoal: 2000 }));
  assert.equal(resolveFolderWorkspaceValue(meta, "Projet/Manuscrit", "Projet/Manuscrit/Cours/Partie/Scène", "wordGoal", 500).value, 2000);
  assert.equal(resolveFolderWorkspaceValue(meta, "Projet/Manuscrit", "Projet/Manuscrit/Cours/Partie/Scène", "liveJustify", true).value, false);
});

test("folder workspaces distingue undefined des valeurs falsy et ne mute pas la lecture", () => {
  const meta = { folderWorkspaces: {
    "A": config({ wordGoal: 0, tolerance: "" }),
    "A/B": config({ wordGoal: undefined }),
  } };
  const before = structuredClone(meta);
  assert.equal(resolveFolderWorkspaceValue(meta, "Projet", "Projet/A/B/C", "wordGoal", 900).value, 0);
  assert.equal(resolveFolderWorkspaceValue(meta, "Projet", "Projet/A/B/C", "tolerance", "global").value, "");
  assert.deepEqual(meta, before);
});

test("le manuscript root et les dossiers hors projet n'ont pas de scope local", () => {
  const meta = { folderWorkspaces: { A: config({ wordGoal: 1 }) } };
  assert.equal(folderPathToWorkspaceScope("Projet/Manuscrit", "Projet/Manuscrit"), null);
  assert.deepEqual(folderWorkspaceScopeChain("Projet/Manuscrit", "Projet/Autre"), []);
  assert.equal(resolveFolderWorkspaceValue(meta, "Projet/Manuscrit", "Projet/Autre", "wordGoal", 700).value, 700);
});
