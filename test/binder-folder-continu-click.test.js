import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, MarkdownView } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { VIEW_SCRIVENINGS } from "../src/constants.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* LOT FINAL Binder ↔ Continu, §11-14/§25 : clic simple sur le NOM d'un
 * dossier → `FeuilletsView.openFolderInContinu(folder)` ouvre ce dossier en
 * Continu dans la LEAF DE TRAVAIL CENTRALE — jamais une nouvelle leaf
 * (jamais `getLeaf("tab")`/`getLeaf("split")`). Ce fichier teste le
 * MÉCANISME lui-même (même-leaf, réutilisation d'un Continu déjà actif,
 * dossier vide) avec une VRAIE `ScriveningsView` (comme
 * binder-markdown-continu-transition.test.js) — le TIMING clic/dblclic/
 * chevron est déjà couvert par feuillets-view-onboarding.test.js. */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
  requestAnimationFrame: () => 0,
};

function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");
  const chapitre1 = new TFolder("Roman/Manuscrit/Chapitre 1");
  const a = new TFile("Roman/Manuscrit/Chapitre 1/A.md", "Corps A.");
  const b = new TFile("Roman/Manuscrit/Chapitre 1/B.md", "Corps B.");
  const vide = new TFolder("Roman/Manuscrit/Vide");
  a.basename = "A"; b.basename = "B";
  chapitre1.children = [a, b];
  root.children = [chapitre1, vide];
  a.parent = chapitre1; b.parent = chapitre1; chapitre1.parent = root; vide.parent = root;

  const { vault } = createFakeVault([root, chapitre1, a, b, vide]);
  return { root, chapitre1, a, b, vide, vault };
}

/** Construit un Binder + UNE leaf de travail centrale réutilisée partout —
 * même patron que binder-markdown-continu-transition.test.js. */
function buildHarness(fixture, { workLeafFile = null } = {}) {
  const { root, vault } = fixture;
  const settings = {
    projectFolder: root.path,
    binderSelectedPath: root.path,
    collapsed: {},
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
  };

  const rootSplit = { name: "root" };
  const scriveningsPlugin = { app: null, settings, updateStatusBar: () => {} };
  const setViewStateCalls = [];

  const workLeaf = {
    isDeferred: false,
    getRoot: () => rootSplit,
    loadIfDeferred: async () => {},
    setViewState: async (state) => {
      setViewStateCalls.push(state);
      const nextView = new ScriveningsView(workLeaf, scriveningsPlugin);
      nextView.mountEditor = () => {};
      nextView.destroyEditor = () => {};
      workLeaf.view = nextView;
    },
    openFile: async (file) => {
      workLeaf.view = Object.assign(new MarkdownView(), { file });
    },
  };
  workLeaf.view = workLeafFile ? Object.assign(new MarkdownView(), { file: workLeafFile }) : {};

  const getLeafForOpeningFileCalls = [];
  const workspace = {
    leftSplit: { name: "left" },
    rightSplit: { name: "right" },
    rootSplit,
    getMostRecentLeaf: (r) => (r === rootSplit ? workLeaf : null),
    getLeavesOfType: () => [],
    setActiveLeaf: () => {},
    revealLeaf: async () => {},
  };

  const app = { vault, workspace, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  scriveningsPlugin.app = app;
  workLeaf.app = app;
  workLeaf.contentEl = null;

  const plugin = {
    settings,
    getProjectFolder: () => root,
    getLeafForOpeningFile: () => { getLeafForOpeningFileCalls.push(true); return workLeaf; },
  };

  // `contentEl` minimal : `refreshContinuMembershipHighlight` (appelée après
  // une ouverture Continu réussie) y cherche les lignes `.feuillets-item` —
  // ce test n'exerce aucun rendu DOM réel du Binder, juste `querySelectorAll`
  // en no-op.
  const contentEl = { querySelectorAll: () => [] };
  const view = new FeuilletsView({ app, contentEl }, plugin);

  return { view, plugin, app, workLeaf, setViewStateCalls, getLeafForOpeningFileCalls, ...fixture };
}

test("clic simple dossier, leaf centrale Markdown : la MÊME leaf devient Continu, ordre Binder", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });

  await h.view.openFolderInContinu(fixture.chapitre1);

  assert.ok(h.workLeaf.view instanceof ScriveningsView, "la MÊME leaf devient Continu");
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.b.path]);
  assert.equal(h.setViewStateCalls.length, 1, "un seul changement de vue, sur cette leaf");
  assert.equal(h.setViewStateCalls[0].type, VIEW_SCRIVENINGS);
});

test("clic simple dossier, leaf centrale DÉJÀ Continu : recharge ce scope sur place (openScope), jamais openScopeInContinuOnLeaf", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });

  // Établit un Continu existant sur la même leaf (fichier seul, projet racine).
  await h.view.openFolderInContinu(fixture.chapitre1);
  const continuView = h.workLeaf.view;
  assert.ok(continuView instanceof ScriveningsView);
  assert.equal(h.setViewStateCalls.length, 1);

  await h.view.openFolderInContinu(fixture.root);

  assert.equal(h.workLeaf.view, continuView, "toujours la même instance Continu, jamais une nouvelle");
  assert.deepEqual(h.workLeaf.view.getMemberPaths(), [fixture.a.path, fixture.b.path]);
  assert.equal(h.setViewStateCalls.length, 1, "aucun setViewState supplémentaire — openScope recharge en place");
});

test("dossier vide (aucun feuillet Markdown admissible) : clic simple ne crée jamais de Continu vide, vue centrale inchangée", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });

  await h.view.openFolderInContinu(fixture.vide);

  assert.ok(h.workLeaf.view instanceof MarkdownView, "la vue centrale reste exactement ce qu'elle était");
  assert.equal(h.workLeaf.view.file, fixture.a);
  assert.equal(h.setViewStateCalls.length, 0, "aucun changement de vue déclenché pour un dossier vide");
});

test("clic simple dossier : jamais getLeaf(\"tab\")/getLeaf(\"split\") — aucune leaf créée, réutilise le mécanisme same-leaf validé", async () => {
  const fixture = buildFixture();
  const h = buildHarness(fixture, { workLeafFile: fixture.a });
  let getLeafTabOrSplitCalls = 0;
  h.app.workspace.getLeaf = (kind) => {
    if (kind === "tab" || kind === "split") getLeafTabOrSplitCalls++;
    return h.workLeaf;
  };

  await h.view.openFolderInContinu(fixture.chapitre1);

  assert.equal(getLeafTabOrSplitCalls, 0, "jamais getLeaf(\"tab\")/getLeaf(\"split\")");
  assert.ok(h.workLeaf.view instanceof ScriveningsView);
});
