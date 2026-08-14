import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { ComparisonSession } from "../src/views/comparison-view.js";

/**
 * isActiveFileInProject() pilote toute la grammaire d'édition partagée
 * (interligne, largeur de texte, alinéas — voir applyLiveTypoClasses dans
 * src/main.ts). Les deux colonnes d'une comparaison sont maintenant de vraies
 * vues Markdown, mais celle de DROITE est un document interne, hors
 * Manuscrit : sans ce rattachement au feuillet de gauche, les deux textes ne
 * se composeraient pas pareil — exactement l'écart que la comparaison doit
 * rendre impossible.
 */

function fixture() {
  const root = new TFolder("Roman/Manuscrit");
  const file = new TFile("Roman/Manuscrit/Chapitre.md", "Texte.");
  const outside = new TFile("Ailleurs.md", "Hors projet.");
  root.children = [file]; file.parent = root;
  const { vault } = createFakeVault([root, file, outside]);
  return { vault, root, file, outside };
}

function pluginFor(vault, root, activeFile = null) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { vault, workspace: { getActiveFile: () => activeFile, getActiveViewOfType: () => null } };
  plugin.getProjectFolder = () => root;
  plugin.isActiveReviewWorkingFile = () => false;
  return plugin;
}

/** Comparaison ouverte, sans workspace : seul le contexte exposé compte ici. */
function withComparison(sourcePath, comparedPath, run) {
  const previous = ComparisonSession.current;
  ComparisonSession.current = { sourcePath, comparedPath };
  try { return run(); } finally { ComparisonSession.current = previous; }
}

test("le document comparé d'une comparaison hérite du contexte du vrai feuillet", () => {
  const { vault, root, file } = fixture();
  const right = new TFile("_Feuillets/Relectures/r/comparison/one.md", "Version du relecteur.");
  const plugin = pluginFor(vault, root, right);
  assert.equal(withComparison(file.path, right.path, () => plugin.isActiveFileInProject()), true);
});

test("un feuillet hors projet ne rend pas le document comparé projet pour autant", () => {
  const { vault, root, outside } = fixture();
  const right = new TFile("_Feuillets/Relectures/r/comparison/one.md", "Version du relecteur.");
  const plugin = pluginFor(vault, root, right);
  assert.equal(withComparison(outside.path, right.path, () => plugin.isActiveFileInProject()), false);
});

test("hors comparaison, isActiveFileInProject retombe sur getActiveFile() comme avant", () => {
  const { vault, root, file } = fixture();
  assert.equal(pluginFor(vault, root, file).isActiveFileInProject(), true);
  assert.equal(pluginFor(vault, root, new TFile("Ailleurs.md", "")).isActiveFileInProject(), false);
});

test("le vrai feuillet reste un feuillet ordinaire pendant la comparaison", () => {
  const { vault, root, file } = fixture();
  const plugin = pluginFor(vault, root, file);
  assert.equal(withComparison(file.path, "_Feuillets/Relectures/r/comparison/one.md", () => plugin.isActiveFileInProject()), true);
});
