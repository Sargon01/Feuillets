import test from "node:test";
import assert from "node:assert/strict";
import FeuilletsPlugin from "../src/main.js";
import { PreviewView } from "../src/views/preview-view.js";
import { VIEW_PREVIEW } from "../src/constants.js";
import { createFileScope, createFolderScope, createProjectScope, createSelectionScope } from "../src/services/compile-scope.js";

/* LOT 3, §1.A — FeuilletsPlugin.syncExistingPreviewScope(). Vérifie
 * UNIQUEMENT le médiateur main.ts, jamais un second résolveur de scope :
 * les CompileScope passés ici sont construits comme le ferait
 * ScriveningsView/FeuilletsView, reçus tels quels par une fausse
 * PreviewView (`Object.create(PreviewView.prototype)`, comme le patron déjà
 * utilisé par test/scrivenings-typo-context.test.js pour ScriveningsView).
 *
 * Barrière absolue vérifiée par construction : le faux `workspace` ne
 * déclare QUE `getLeavesOfType` — un appel accidentel à `getLeaf()` ou
 * toute autre méthode de création/activation de leaf ferait échouer le
 * test avec un TypeError explicite (« is not a function »). */

globalThis.window ??= {
  setTimeout: () => 0,
  clearTimeout: () => {},
  requestAnimationFrame: () => 0,
};

const PROJECT_ROOT = "Roman/Manuscrit";

/** Fausse leaf Preview, reconnue `instanceof PreviewView` par la garde de
 * type de syncExistingPreviewScope — `compileScope` posé comme propriété
 * propre (le getter réel reste inchangé, voir PreviewView §7 du lot).
 * `followCompileScope` est un espion : c'est la SEULE méthode que le
 * médiateur a le droit d'appeler sur cette vue. */
function fakePreviewLeaf(compileScope, { deferred = false } = {}) {
  const calls = [];
  const view = Object.create(PreviewView.prototype);
  Object.defineProperty(view, "compileScope", { value: compileScope, enumerable: true, configurable: true });
  view.followCompileScope = async (scope, anchor) => { calls.push({ scope, anchor }); };
  let loadIfDeferredCalled = false;
  const leaf = {
    view,
    isDeferred: deferred,
    loadIfDeferred: async () => { loadIfDeferredCalled = true; },
  };
  return { leaf, calls, wasLoaded: () => loadIfDeferredCalled };
}

function pluginWithPreviewLeaves(leaves) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = {
    workspace: {
      getLeavesOfType: (type) => (type === VIEW_PREVIEW ? leaves : []),
    },
  };
  return plugin;
}

test("A. Aucun Preview ouvert + passage en Continu : rien n'est créé (le faux workspace n'expose même pas de méthode de création de leaf)", async () => {
  const plugin = pluginWithPreviewLeaves([]);
  await plugin.syncExistingPreviewScope(createProjectScope(PROJECT_ROOT));
  // Ne pas avoir levé d'exception prouve qu'aucune tentative de création de
  // leaf n'a eu lieu : return immédiat sur leaves.length === 0.
});

test("B. Preview A existant + Shift A+B+C : même leaf, scope selection reçu, aucune nouvelle leaf Preview", async () => {
  const { leaf, calls } = fakePreviewLeaf(createFileScope(PROJECT_ROOT, "A.md"));
  const plugin = pluginWithPreviewLeaves([leaf]);
  const scope = createSelectionScope(PROJECT_ROOT, ["A.md", "B.md", "C.md"]);

  await plugin.syncExistingPreviewScope(scope, null);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].scope, scope);
  assert.equal(calls[0].anchor, null);
});

test("C. Cmd/Ctrl ajoute E : le Preview lié reçoit A+B+C+E", async () => {
  const { leaf, calls } = fakePreviewLeaf(createSelectionScope(PROJECT_ROOT, ["A.md", "B.md", "C.md"]));
  const plugin = pluginWithPreviewLeaves([leaf]);
  const scope = createSelectionScope(PROJECT_ROOT, ["A.md", "B.md", "C.md", "E.md"]);

  await plugin.syncExistingPreviewScope(scope, null);

  assert.deepEqual(calls[0].scope, scope);
});

test("D. Cmd/Ctrl retire B : le Preview lié reçoit A+C+E", async () => {
  const { leaf, calls } = fakePreviewLeaf(createSelectionScope(PROJECT_ROOT, ["A.md", "B.md", "C.md", "E.md"]));
  const plugin = pluginWithPreviewLeaves([leaf]);
  const scope = createSelectionScope(PROJECT_ROOT, ["A.md", "C.md", "E.md"]);

  await plugin.syncExistingPreviewScope(scope, null);

  assert.deepEqual(calls[0].scope, scope);
});

test("E. Retour à A seul : le Preview lié reçoit le fileScope A, ancre null", async () => {
  const { leaf, calls } = fakePreviewLeaf(createSelectionScope(PROJECT_ROOT, ["A.md", "C.md"]));
  const plugin = pluginWithPreviewLeaves([leaf]);
  const scope = createFileScope(PROJECT_ROOT, "A.md");

  await plugin.syncExistingPreviewScope(scope, null);

  assert.deepEqual(calls[0].scope, scope);
  assert.equal(calls[0].anchor, null);
});

test("F. Clic dossier : le Preview lié reçoit le folderScope", async () => {
  const { leaf, calls } = fakePreviewLeaf(createFileScope(PROJECT_ROOT, "A.md"));
  const plugin = pluginWithPreviewLeaves([leaf]);
  const scope = createFolderScope(PROJECT_ROOT, `${PROJECT_ROOT}/Chapitre1`);

  await plugin.syncExistingPreviewScope(scope, null);

  assert.deepEqual(calls[0].scope, scope);
});

test("G. Projet/manuscrit : le Preview lié reçoit le projectScope", async () => {
  const { leaf, calls } = fakePreviewLeaf(createFolderScope(PROJECT_ROOT, `${PROJECT_ROOT}/Chapitre1`));
  const plugin = pluginWithPreviewLeaves([leaf]);
  const scope = createProjectScope(PROJECT_ROOT);

  await plugin.syncExistingPreviewScope(scope, null);

  assert.deepEqual(calls[0].scope, scope);
});

test("H. Clic simple fichier depuis Markdown : le Preview existant passe au fileScope correspondant", async () => {
  const { leaf, calls } = fakePreviewLeaf(createFolderScope(PROJECT_ROOT, `${PROJECT_ROOT}/Chapitre1`));
  const plugin = pluginWithPreviewLeaves([leaf]);
  const scope = createFileScope(PROJECT_ROOT, "D.md");

  await plugin.syncExistingPreviewScope(scope, null);

  assert.deepEqual(calls[0].scope, scope);
});

test("I. Preview d'un AUTRE projectRoot : jamais modifié", async () => {
  const { leaf, calls } = fakePreviewLeaf(createProjectScope("Autre/Manuscrit"));
  const plugin = pluginWithPreviewLeaves([leaf]);

  await plugin.syncExistingPreviewScope(createProjectScope(PROJECT_ROOT), null);

  assert.deepEqual(calls, []);
});

test("J. Plusieurs Preview du même projet : au maximum le premier pertinent est synchronisé", async () => {
  const other = fakePreviewLeaf(createProjectScope("Autre/Manuscrit"));
  const first = fakePreviewLeaf(createFileScope(PROJECT_ROOT, "A.md"));
  const second = fakePreviewLeaf(createFileScope(PROJECT_ROOT, "A.md"));
  const plugin = pluginWithPreviewLeaves([other.leaf, first.leaf, second.leaf]);
  const scope = createProjectScope(PROJECT_ROOT);

  await plugin.syncExistingPreviewScope(scope, null);

  assert.equal(other.calls.length, 0);
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 0, "au maximum le premier pertinent, jamais un deuxième");
});

test("Preview différé (placeholder, vue pas encore réelle) : jamais choisi, jamais forcé au chargement", async () => {
  const deferredLeaf = {
    view: {}, // placeholder Obsidian ≥ 1.7 : pas encore une vraie PreviewView
    isDeferred: true,
    loadIfDeferred: async () => { throw new Error("ne doit jamais être appelé pour une leaf non pertinente"); },
  };
  const plugin = pluginWithPreviewLeaves([deferredLeaf]);

  await plugin.syncExistingPreviewScope(createProjectScope(PROJECT_ROOT), null);
  // Aucune exception : loadIfDeferred() n'a jamais été appelé sur cette leaf.
});

test("ancre transmise telle quelle au Preview lié", async () => {
  const { leaf, calls } = fakePreviewLeaf(createFileScope(PROJECT_ROOT, "A.md"));
  const plugin = pluginWithPreviewLeaves([leaf]);
  const scope = createSelectionScope(PROJECT_ROOT, ["A.md", "B.md"]);
  const anchor = { path: "A.md", progress: 0.5 };

  await plugin.syncExistingPreviewScope(scope, anchor);

  assert.deepEqual(calls[0].anchor, anchor);
});
