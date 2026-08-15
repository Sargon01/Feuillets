import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { BoardView } from "../src/views/board-view.js";

/**
 * LOT 1.2 — ScriveningsView active avec un scope Feuillets valide DOIT être
 * reconnue comme un contexte projet par isActiveFileInProject(), même
 * système que BoardView (voir main.ts) : applyLiveTypoClasses() et
 * applyIndentClass() en dépendent directement pour rester actifs pendant
 * l'édition Scrivenings. Ce comportement ne doit dépendre ni du dernier
 * vrai fichier Markdown actif, ni d'aucun autre type de vue.
 */

function fixture() {
  const root = new TFolder("Roman/Manuscrit");
  const file = new TFile("Roman/Manuscrit/Chapitre.md", "Texte.");
  root.children = [file];
  file.parent = root;
  const { vault } = createFakeVault([root, file]);
  return { vault, root, file };
}

/** `activeView` simule le retour de `getActiveViewOfType` — `null` par
 * défaut (aucune vue Feuillets active), sinon une instance factice avec
 * `constructor === type` pour que la distinction BoardView/ScriveningsView
 * fonctionne comme un vrai `getActiveViewOfType`. */
function pluginFor(vault, root, { activeFile = null, activeView = null } = {}) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = {
    vault,
    workspace: {
      getActiveFile: () => activeFile,
      getActiveViewOfType: (type) => (activeView instanceof type ? activeView : null),
    },
  };
  plugin.getProjectFolder = () => root;
  plugin.isActiveReviewWorkingFile = () => false;
  return plugin;
}

/** Instance minimale reconnue par `instanceof ScriveningsView`, sans passer
 * par le vrai constructeur (qui exige un WorkspaceLeaf/plugin Obsidian
 * réels) — seul `compileScope` (le getter public ajouté pour ce lot) est
 * exercé par isActiveFileInProject(). */
function fakeScriveningsView(compileScope) {
  const view = Object.create(ScriveningsView.prototype);
  Object.defineProperty(view, "compileScope", { value: compileScope, enumerable: true });
  return view;
}

test("ScriveningsView active avec un scope chargé est un contexte projet", () => {
  const { vault, root } = fixture();
  const scrivenings = fakeScriveningsView({ kind: "manuscript" });
  const plugin = pluginFor(vault, root, { activeFile: null, activeView: scrivenings });
  assert.equal(plugin.isActiveFileInProject(), true);
});

test("ScriveningsView active mais sans scope encore chargé (compileScope null) : pas un contexte projet par ce biais", () => {
  const { vault, root } = fixture();
  const scrivenings = fakeScriveningsView(null);
  const plugin = pluginFor(vault, root, { activeFile: null, activeView: scrivenings });
  assert.equal(plugin.isActiveFileInProject(), false);
});

test("ScriveningsView active + scope valide : reconnue MÊME si le dernier vrai fichier actif est hors projet", () => {
  const { vault, root } = fixture();
  const outside = new TFile("Ailleurs.md", "Hors projet.");
  const scrivenings = fakeScriveningsView({ kind: "manuscript" });
  const plugin = pluginFor(vault, root, { activeFile: outside, activeView: scrivenings });
  assert.equal(plugin.isActiveFileInProject(), true);
});

test("ScriveningsView active + scope valide : reconnue MÊME sans aucun fichier actif (getActiveFile() === null)", () => {
  const { vault, root } = fixture();
  const scrivenings = fakeScriveningsView({ kind: "manuscript" });
  const plugin = pluginFor(vault, root, { activeFile: null, activeView: scrivenings });
  assert.equal(plugin.isActiveFileInProject(), true);
});

test("aucune vue Feuillets active : le comportement d'origine (dernier fichier actif) est inchangé", () => {
  const { vault, root, file } = fixture();
  assert.equal(pluginFor(vault, root, { activeFile: file }).isActiveFileInProject(), true);
  assert.equal(pluginFor(vault, root, { activeFile: new TFile("Ailleurs.md", "") }).isActiveFileInProject(), false);
});

test("la reconnaissance de ScriveningsView ne s'étend pas à BoardView ni réciproquement", () => {
  const { vault, root } = fixture();
  const board = Object.create(BoardView.prototype);
  const plugin = pluginFor(vault, root, { activeFile: null, activeView: board });
  // BoardView reste reconnue par sa propre branche existante — la nouvelle
  // branche Scrivenings ne doit ni la casser ni s'y substituer.
  assert.equal(plugin.isActiveFileInProject(), true);
});
