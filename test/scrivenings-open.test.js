import test from "node:test";
import assert from "node:assert/strict";
import { activateScriveningsView, openScopeInContinu } from "../src/views/scrivenings-view.js";
import { VIEW_SCRIVENINGS } from "../src/constants.js";

/* ===================== activateScriveningsView (Lot 2A §2) ===================== */

test("activateScriveningsView : réutilise une leaf Continu déjà ouverte", async () => {
  let revealedLeaf = null;
  const existingLeaf = { setViewState: async () => {} };
  const app = {
    workspace: {
      getLeavesOfType: (type) => (type === VIEW_SCRIVENINGS ? [existingLeaf] : []),
      getLeaf: () => null,
      revealLeaf: (leaf) => { revealedLeaf = leaf; },
    },
  };

  const leaf = await activateScriveningsView(app);

  assert.equal(leaf, existingLeaf, "doit retourner la leaf existante");
  assert.equal(revealedLeaf, existingLeaf, "doit révéler la leaf existante, jamais en empiler une seconde");
});

test("activateScriveningsView : crée un onglet si aucune vue Continu n'est ouverte", async () => {
  let revealedLeaf = null;
  let createdState = null;
  const newLeaf = { setViewState: async (state) => { createdState = state; } };
  const app = {
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: (type) => (type === "tab" ? newLeaf : null),
      revealLeaf: (leaf) => { revealedLeaf = leaf; },
    },
  };

  const leaf = await activateScriveningsView(app);

  assert.equal(leaf, newLeaf);
  assert.equal(createdState.type, VIEW_SCRIVENINGS);
  assert.equal(createdState.active, true);
  assert.equal(revealedLeaf, newLeaf);
});

test("activateScriveningsView : charge une leaf différée avant de la retourner", async () => {
  const realView = { openScope: async () => {} };
  const deferredLeaf = {
    isDeferred: true,
    loadIfDeferred: async () => {
      deferredLeaf.isDeferred = false;
      deferredLeaf.view = realView;
    },
    view: {},
  };
  const app = {
    workspace: {
      getLeavesOfType: (type) => (type === VIEW_SCRIVENINGS ? [deferredLeaf] : []),
      getLeaf: () => null,
      revealLeaf: () => {},
    },
  };

  const leaf = await activateScriveningsView(app);

  assert.equal(leaf.isDeferred, false, "la leaf différée doit avoir été chargée");
  assert.equal(leaf.view, realView, "le placeholder doit avoir été remplacé par la vraie vue");
});

/* ===================== openScopeInContinu (Lot 2A §2) ===================== */

test("openScopeInContinu : transmet le scope à la vue, révèle sa leaf et lui rend le focus", async () => {
  let openedScope = null;
  let revealedLeaf = null;
  let focusedLeaf = null;
  const view = { openScope: async (scope) => { openedScope = scope; } };
  const leaf = { setViewState: async () => {}, view };
  const app = {
    workspace: {
      getLeavesOfType: (type) => (type === VIEW_SCRIVENINGS ? [leaf] : []),
      getLeaf: () => null,
      revealLeaf: (l) => { revealedLeaf = l; },
      setActiveLeaf: (l) => { focusedLeaf = l; },
    },
  };
  const scope = { type: "folder", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Chapitre 1" };

  const returnedLeaf = await openScopeInContinu(app, scope);

  assert.equal(returnedLeaf, leaf);
  assert.deepEqual(openedScope, scope, "le scope exact doit atteindre la vue, sans transformation");
  assert.equal(revealedLeaf, leaf);
  assert.equal(focusedLeaf, leaf, "le focus final doit revenir à Continu");
});

test("openScopeInContinu : une leaf différée non chargée n'échoue pas silencieusement une fois chargée", async () => {
  let openedScope = null;
  const realView = { openScope: async (scope) => { openedScope = scope; } };
  const deferredLeaf = {
    isDeferred: true,
    setViewState: async () => {},
    loadIfDeferred: async () => {
      deferredLeaf.isDeferred = false;
      deferredLeaf.view = realView;
    },
    view: {},
  };
  const app = {
    workspace: {
      getLeavesOfType: (type) => (type === VIEW_SCRIVENINGS ? [deferredLeaf] : []),
      getLeaf: () => null,
      revealLeaf: () => {},
      setActiveLeaf: () => {},
    },
  };
  const scope = { type: "project", projectRoot: "Projet/Manuscrit" };

  await openScopeInContinu(app, scope);

  assert.deepEqual(openedScope, scope, "la portée doit atteindre la VRAIE vue malgré le report de chargement");
});
