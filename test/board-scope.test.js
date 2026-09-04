import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { resolveBoardFolderScope } from "../src/views/board-scope.js";

function folder(path) { return new TFolder(path); }

test("Board scope — sans dossier focalisé", () => {
  const root = folder("Projet/Manuscrit");
  const scope = resolveBoardFolderScope(root, null);
  assert.equal(scope.manuscriptRoot, root);
  assert.equal(scope.currentFolder, root);
  assert.equal(scope.hasFocusedFolder, false);
});

test("Board scope — dossier descendant valide", () => {
  const root = folder("Projet/Manuscrit");
  const focused = folder("Projet/Manuscrit/Partie 1");
  const scope = resolveBoardFolderScope(root, focused);
  assert.equal(scope.manuscriptRoot, root);
  assert.equal(scope.currentFolder, focused);
  assert.equal(scope.hasFocusedFolder, true);
});

test("Board scope — racine explicitement focalisée", () => {
  const root = folder("Projet/Manuscrit");
  const scope = resolveBoardFolderScope(root, root);
  assert.equal(scope.currentFolder, root);
  assert.equal(scope.hasFocusedFolder, true);
});

test("Board scope — dossier extérieur rejeté", () => {
  const root = folder("Projet/Manuscrit");
  const scope = resolveBoardFolderScope(root, folder("Autre projet/Chapitre"));
  assert.equal(scope.currentFolder, root);
  assert.equal(scope.hasFocusedFolder, false);
});

test("Board scope — startsWith historique conservé", () => {
  const root = folder("Projet/Manuscrit");
  const focused = folder("Projet/Manuscrit-Archive");
  const scope = resolveBoardFolderScope(root, focused);
  assert.equal(scope.currentFolder, focused);
  assert.equal(scope.hasFocusedFolder, true);
});
