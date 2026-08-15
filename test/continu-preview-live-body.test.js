import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { PreviewView } from "../src/views/preview-view.js";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { createSelectionScope } from "../src/services/compile-scope.js";

/* LOT 3, §8/§9/§10/§28 — corps vivant de Continu dans Preview, et debounce
 * du rafraîchissement déclenché par une frappe. Deux couches testées
 * séparément :
 *  - ScriveningsView.getLiveBody() + handleEditorChanges() →
 *    notifyContinuDocumentChanged (côté Continu, plugin.ts factice) ;
 *  - PreviewView.readFileForPreview() + onContinuDocumentChanged() (côté
 *    Preview, instance minimale via Object.create — même patron que
 *    test/scrivenings-typo-context.test.js pour ScriveningsView). */

globalThis.window ??= {
  requestAnimationFrame: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
};

const PROJECT_ROOT = "Roman/Manuscrit";

/* ===================== ScriveningsView.getLiveBody / notify ===================== */

function buildContinuProject() {
  const root = new TFolder(PROJECT_ROOT);
  const a = new TFile(`${PROJECT_ROOT}/A.md`, "---\ntitle: A\n---\nCorps A original.");
  const b = new TFile(`${PROJECT_ROOT}/B.md`, "Corps B original.");
  root.children = [a, b];
  a.parent = root;
  b.parent = root;

  const { vault } = createFakeVault([root, a, b]);
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: root.path, orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };
  return { root, a, b, app, settings };
}

function buildContinuView() {
  const project = buildContinuProject();
  const notifyCalls = [];
  const plugin = {
    app: project.app,
    settings: project.settings,
    updateStatusBar: () => {},
    notifyContinuDocumentChanged: (paths) => notifyCalls.push([...paths]),
  };
  const fakeLeaf = { app: project.app, contentEl: null, openFile: async () => {} };
  const view = new ScriveningsView(fakeLeaf, plugin);
  view.mountEditor = () => {};
  view.destroyEditor = () => {};
  return { ...project, view, plugin, notifyCalls };
}

test("getLiveBody : renvoie le corps vivant du segment, jamais le frontmatter", async () => {
  const { view, a, b, root } = buildContinuView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  assert.equal(view.getLiveBody(a.path), "Corps A original.");
  assert.equal(view.getLiveBody(b.path), "Corps B original.");
});

test("getLiveBody : null si aucun scope chargé, ou si path absent de la composition", async () => {
  const { view, a, b, root } = buildContinuView();
  assert.equal(view.getLiveBody(a.path), null, "aucun scope chargé encore");

  await view.openScope(createSelectionScope(root.path, [a.path]));
  assert.equal(view.getLiveBody(b.path), null, "b n'appartient pas à la composition affichée");
});

test("M. getLiveBody() ne modifie ni le dirty state, ni le disque, ni le frontmatter, ni le scope", async () => {
  const { view, a, b, root } = buildContinuView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  const scopeBefore = view.compileScope;
  const dirtyBefore = view.session.dirtyCount;
  const diskBefore = a.content;

  view.getLiveBody(a.path);
  view.getLiveBody(b.path);
  view.getLiveBody("inexistant.md");

  assert.equal(view.session.dirtyCount, dirtyBefore);
  assert.equal(a.content, diskBefore);
  assert.equal(view.compileScope, scopeBefore);
  assert.equal(view.session.document.segments[0].frontmatter, "---\ntitle: A\n---\n");
});

test("frappe ACCEPTÉE : notifie Preview avec les chemins réellement touchés", async () => {
  const { view, a, b, root, notifyCalls } = buildContinuView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));
  const doc = view.session.document;

  // Édition contenue dans le segment A seul — jamais la jonction.
  view.handleEditorChanges([{ from: doc.segments[0].from, to: doc.segments[0].from, insert: "X" }]);

  assert.equal(notifyCalls.length, 1);
  assert.deepEqual(notifyCalls[0], [a.path]);
});

test("P. modification rejetée par le boundary guard : aucune notification Preview", async () => {
  const { view, a, b, root, notifyCalls } = buildContinuView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));
  const doc = view.session.document;

  // Change qui touche exactement la jonction structurelle entre A et B :
  // rejeté par applyCompositeChanges (voir services/scrivenings-document.ts).
  view.handleEditorChanges([{ from: doc.segments[0].to, to: doc.segments[1].from, insert: "x" }]);

  assert.deepEqual(notifyCalls, [], "aucune notification pour un changement rejeté");
});

/* ===================== PreviewView.readFileForPreview (Continu lié) ===================== */

function fakePreviewView({ compileScope = null, continu = null } = {}) {
  const view = Object.create(PreviewView.prototype);
  Object.defineProperty(view, "compileScope", { value: compileScope, enumerable: true, configurable: true });
  view.plugin = { getCentralContinuView: () => continu, settings: {} };
  view.app = { workspace: { getLeavesOfType: () => [] } };
  view.lastEditorChangeAt = 0;
  view.lastFileSwitchAt = 0;
  return view;
}

const SCOPE = createSelectionScope(PROJECT_ROOT, ["A.md", "B.md"]);

test("K. disque = ancienne version, Continu = corps vivant : Preview reçoit la nouvelle version", async () => {
  const file = new TFile(`${PROJECT_ROOT}/A.md`, "");
  const continu = { compileScope: SCOPE, getLiveBody: (path) => (path === file.path ? "Nouvelle version vivante." : null) };
  const view = fakePreviewView({ compileScope: SCOPE, continu });

  const result = await view.readFileForPreview(file, async () => "Ancienne version disque.");

  assert.equal(result, "Nouvelle version vivante.");
});

test("L. disque = frontmatter + ancien corps, Continu = nouveau corps : Preview reçoit EXACTEMENT frontmatter disque + nouveau corps", async () => {
  const file = new TFile(`${PROJECT_ROOT}/A.md`, "");
  const raw = "---\ntitle: Chapitre\n---\nAncien corps.";
  const continu = { compileScope: SCOPE, getLiveBody: () => "Nouveau corps." };
  const view = fakePreviewView({ compileScope: SCOPE, continu });

  const result = await view.readFileForPreview(file, async () => raw);

  assert.equal(result, "---\ntitle: Chapitre\n---\nNouveau corps.");
});

test("Continu NON lié (scope différent) : repli intégral sur le pipeline historique (fallbackRead)", async () => {
  const file = new TFile(`${PROJECT_ROOT}/A.md`, "");
  const continu = { compileScope: createSelectionScope(PROJECT_ROOT, ["C.md"]), getLiveBody: () => "ne doit jamais être lu" };
  const view = fakePreviewView({ compileScope: SCOPE, continu });

  const result = await view.readFileForPreview(file, async () => "Contenu disque inchangé.");

  assert.equal(result, "Contenu disque inchangé.");
});

test("Continu lié mais fichier absent de sa composition (getLiveBody → null) : repli sur fallbackRead", async () => {
  const file = new TFile(`${PROJECT_ROOT}/Z.md`, "");
  const continu = { compileScope: SCOPE, getLiveBody: () => null };
  const view = fakePreviewView({ compileScope: SCOPE, continu });

  const result = await view.readFileForPreview(file, async () => "Contenu disque Z.");

  assert.equal(result, "Contenu disque Z.");
});

/* ===================== PreviewView.onContinuDocumentChanged (debounce) ===== */

function makeTrackingWindow() {
  let nextId = 1;
  const scheduled = new Map();
  const setTimeoutCalls = [];
  const clearTimeoutCalls = [];
  const win = {
    setTimeout: (cb, ms) => {
      const id = nextId++;
      scheduled.set(id, cb);
      setTimeoutCalls.push(ms);
      return id;
    },
    clearTimeout: (id) => {
      scheduled.delete(id);
      clearTimeoutCalls.push(id);
    },
    requestAnimationFrame: () => 0,
  };
  return { win, scheduled, setTimeoutCalls, clearTimeoutCalls };
}

function fakePreviewViewForRefresh(continu) {
  const view = Object.create(PreviewView.prototype);
  view.plugin = { getCentralContinuView: () => continu, settings: { previewMode: "scene" } };
  Object.defineProperty(view, "compileScope", { value: continu?.compileScope ?? null, enumerable: true, configurable: true });
  view.closed = false;
  view.lastPreviewScrollAt = 0;
  view.refreshTimer = null;
  const refreshCalls = [];
  view.refreshPreview = async () => { refreshCalls.push(true); };
  view.setStatus = () => {};
  return { view, refreshCalls };
}

test("N. 10 frappes rapides : un seul timer de refresh coalescé, ~850 ms, refreshPreview() appelé UNE seule fois", () => {
  const { win, scheduled, setTimeoutCalls, clearTimeoutCalls } = makeTrackingWindow();
  const realWindow = globalThis.window;
  globalThis.window = win;
  try {
    const continu = { compileScope: SCOPE, getMemberPaths: () => ["A.md", "B.md"] };
    const { view, refreshCalls } = fakePreviewViewForRefresh(continu);

    for (let i = 0; i < 10; i++) view.onContinuDocumentChanged(["A.md"]);

    assert.equal(setTimeoutCalls.length, 10, "chaque frappe réarme le timer");
    assert.ok(setTimeoutCalls.every((ms) => ms === 850), "toujours le délai Continu (~850 ms)");
    assert.equal(clearTimeoutCalls.length, 9, "les 9 premiers timers sont annulés — un seul reste programmé");
    assert.equal(refreshCalls.length, 0, "aucun rendu synchrone pendant la frappe");

    // Déclenche le DERNIER timer resté programmé.
    const lastId = Math.max(...scheduled.keys());
    scheduled.get(lastId)();

    assert.equal(refreshCalls.length, 1, "un seul rafraîchissement Preview au final");
  } finally {
    globalThis.window = realWindow;
  }
});

test("O. touchedPath hors des membres de Continu : aucun refresh programmé", () => {
  const { win, setTimeoutCalls } = makeTrackingWindow();
  const realWindow = globalThis.window;
  globalThis.window = win;
  try {
    const continu = { compileScope: SCOPE, getMemberPaths: () => ["A.md", "B.md"] };
    const { view } = fakePreviewViewForRefresh(continu);

    view.onContinuDocumentChanged(["Z.md"]);

    assert.deepEqual(setTimeoutCalls, [], "aucun touchedPath appartenant au Continu : rien à programmer");
  } finally {
    globalThis.window = realWindow;
  }
});

test("onContinuDocumentChanged : sans Continu lié, aucun refresh programmé", () => {
  const { win, setTimeoutCalls } = makeTrackingWindow();
  const realWindow = globalThis.window;
  globalThis.window = win;
  try {
    const { view } = fakePreviewViewForRefresh(null);

    view.onContinuDocumentChanged(["A.md"]);

    assert.deepEqual(setTimeoutCalls, []);
  } finally {
    globalThis.window = realWindow;
  }
});
