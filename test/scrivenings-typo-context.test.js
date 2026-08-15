import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { BoardView } from "../src/views/board-view.js";
import { createSelectionScope } from "../src/services/compile-scope.js";
import { formatScriveningsStats } from "../src/utils/scrivenings-stats.js";

globalThis.window ??= {
  setTimeout: () => 0,
  clearTimeout: () => {},
  requestAnimationFrame: () => 0,
};

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
 * fonctionne comme un vrai `getActiveViewOfType`.
 *
 * Micro-correctif "typographie après toggle + Maj+clic en Continu" (§1-2) :
 * `isActiveFileInProject()` ne résout plus Scrivenings via
 * `getActiveViewOfType` mais via `getCentralContinuView()` — dernière leaf
 * du `rootSplit`. `workLeafView` simule cette leaf CENTRALE indépendamment
 * de `activeView` (qui ne pilote plus que la branche BoardView, inchangée) :
 * par défaut la même vue que `activeView`, pour que les anciens tests
 * (focus non déplacé) restent valides sans modification. */
function pluginFor(vault, root, { activeFile = null, activeView = null, workLeafView = undefined } = {}) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  const rootSplit = { name: "root" };
  const leafView = workLeafView !== undefined ? workLeafView : activeView;
  const workLeaf = { getRoot: () => rootSplit, view: leafView ?? {} };
  plugin.app = {
    vault,
    workspace: {
      rootSplit,
      getActiveFile: () => activeFile,
      getActiveViewOfType: (type) => (activeView instanceof type ? activeView : null),
      getMostRecentLeaf: (r) => (r === rootSplit ? workLeaf : null),
    },
  };
  plugin.getProjectFolder = () => root;
  plugin.isActiveReviewWorkingFile = () => false;
  return plugin;
}

/** Instance minimale reconnue par `instanceof ScriveningsView`, sans passer
 * par le vrai constructeur (qui exige un WorkspaceLeaf/plugin Obsidian
 * réels) — seul `compileScope` (le getter public ajouté pour ce lot) est
 * exercé par isActiveFileInProject(). `projectRoot` par défaut celui du
 * projet actif : `getCentralContinuView()` exige désormais
 * `compileScope.projectRoot === getProjectFolder().path` (§1). */
function fakeScriveningsView(compileScope) {
  const view = Object.create(ScriveningsView.prototype);
  Object.defineProperty(view, "compileScope", { value: compileScope, enumerable: true });
  return view;
}

test("ScriveningsView active avec un scope chargé est un contexte projet", () => {
  const { vault, root } = fixture();
  const scrivenings = fakeScriveningsView({ type: "project", projectRoot: root.path });
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
  const scrivenings = fakeScriveningsView({ type: "project", projectRoot: root.path });
  const plugin = pluginFor(vault, root, { activeFile: outside, activeView: scrivenings });
  assert.equal(plugin.isActiveFileInProject(), true);
});

test("ScriveningsView active + scope valide : reconnue MÊME sans aucun fichier actif (getActiveFile() === null)", () => {
  const { vault, root } = fixture();
  const scrivenings = fakeScriveningsView({ type: "project", projectRoot: root.path });
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

/* ===================== §14 — focus Binder (micro-correctif) ============= */

test("§14. Binder a le focus (getActiveViewOfType===null) mais la dernière leaf centrale est Continu : contexte projet reconnu", () => {
  const { vault, root } = fixture();
  const scrivenings = fakeScriveningsView({ type: "project", projectRoot: root.path });
  // `activeView` reste `null` (comme le retournerait réellement
  // `getActiveViewOfType` quand la sidebar a le focus) — seule la leaf
  // centrale de travail porte la vue Continu.
  const plugin = pluginFor(vault, root, { activeFile: null, activeView: null, workLeafView: scrivenings });
  assert.equal(plugin.isActiveFileInProject(), true);
});

test("§14. Dernière leaf centrale = Markdown hors projet + Continu ouvert ailleurs (pas la leaf centrale) : false", () => {
  const { vault, root } = fixture();
  const outsideMarkdownView = {}; // ni BoardView ni ScriveningsView
  const plugin = pluginFor(vault, root, { activeFile: new TFile("Ailleurs.md", ""), activeView: null, workLeafView: outsideMarkdownView });
  assert.equal(plugin.isActiveFileInProject(), false);
});

test("§14. Continu central d'un AUTRE projectRoot : false", () => {
  const { vault, root } = fixture();
  const scrivenings = fakeScriveningsView({ type: "project", projectRoot: "Autre/Manuscrit" });
  const plugin = pluginFor(vault, root, { activeFile: null, activeView: null, workLeafView: scrivenings });
  assert.equal(plugin.isActiveFileInProject(), false);
});

/* ===================== §15 — status bar, focus Binder =================== */

function realProjectFixture() {
  const root = new TFolder("Roman/Manuscrit");
  const a = new TFile("Roman/Manuscrit/A.md", "Corps A.");
  const b = new TFile("Roman/Manuscrit/B.md", "Corps B.");
  const c = new TFile("Roman/Manuscrit/C.md", "Corps C.");
  a.basename = "A"; b.basename = "B"; c.basename = "C";
  root.children = [a, b, c];
  a.parent = root; b.parent = root; c.parent = root;
  const { vault } = createFakeVault([root, a, b, c]);
  return { vault, root, a, b, c };
}

function buildRealContinuLeaf(root, vault) {
  const appForView = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: root.path, orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };
  const scriveningsPlugin = { app: appForView, settings, updateStatusBar: () => {} };
  const fakeLeaf = { app: appForView, contentEl: null, openFile: async () => {} };
  const view = new ScriveningsView(fakeLeaf, scriveningsPlugin);
  view.mountEditor = () => {};
  view.destroyEditor = () => {};
  return { view, appForView };
}

function fakeStatusEl() {
  return {
    _text: "",
    setText(txt) { this._text = txt; },
    addClass() {},
    removeClass() {},
  };
}

test("§15. Status bar : Continu central A+B+C survit au focus Binder (getActiveViewOfType===null), affiche les stats du GROUPE", async () => {
  const { vault, root, a, b, c } = realProjectFixture();
  const { view } = buildRealContinuLeaf(root, vault);
  await view.openScope(createSelectionScope(root.path, [a.path, b.path, c.path]));

  const plugin = Object.create(FeuilletsPlugin.prototype);
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view };
  plugin.app = {
    vault,
    workspace: {
      rootSplit,
      getActiveFile: () => null,
      // Le Binder a le focus : plus aucune vue "globalement active".
      getActiveViewOfType: () => null,
      getMostRecentLeaf: (r) => (r === rootSplit ? workLeaf : null),
    },
  };
  plugin.getProjectFolder = () => root;
  plugin.statusEl = fakeStatusEl();

  await plugin.updateStatusBar();

  assert.equal(plugin.statusEl._text, formatScriveningsStats(view.getGroupStats()));
  assert.notEqual(plugin.statusEl._text, "");
});

/* ===================== §20 — typographie pendant toute composition ======
 * Ne calcule aucun CSS ici (interdit) — vérifie uniquement le CONTRAT qui
 * le pilote : `isActiveFileInProject()` reste `true` avant ET après un
 * toggle simple et un ajout en lot (`addMembers`), pendant tout ce temps le
 * Binder a le focus (getActiveViewOfType === null). */

test("§20. isActiveFileInProject() reste vrai avant/après toggleMember et addMembers, Binder ayant le focus", async () => {
  const { vault, root, a, b, c } = realProjectFixture();
  const { view } = buildRealContinuLeaf(root, vault);
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  const plugin = Object.create(FeuilletsPlugin.prototype);
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view };
  plugin.app = {
    vault,
    workspace: {
      rootSplit,
      getActiveFile: () => null,
      getActiveViewOfType: () => null,
      getMostRecentLeaf: (r) => (r === rootSplit ? workLeaf : null),
    },
  };
  plugin.getProjectFolder = () => root;
  plugin.isActiveReviewWorkingFile = () => false;

  assert.equal(plugin.isActiveFileInProject(), true, "avant toute composition");

  await view.toggleMember(c.path);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path, c.path]);
  assert.equal(plugin.isActiveFileInProject(), true, "après toggleMember (ajout de C)");

  await view.toggleMember(b.path);
  assert.deepEqual(view.getMemberPaths(), [a.path, c.path]);
  assert.equal(plugin.isActiveFileInProject(), true, "après toggleMember (retrait de B)");

  await view.addMembers([a.path, b.path]);
  // Ordre canonique du Binder (resolveCompileScopeFiles), jamais l'ordre
  // d'appel de addMembers : a,c déjà membres + b ajouté → a,b,c.
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path, c.path]);
  assert.equal(plugin.isActiveFileInProject(), true, "après addMembers batch");
});
