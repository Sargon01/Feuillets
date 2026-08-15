import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, MarkdownView } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ScriveningsView, openScopeInContinuOnLeaf } from "../src/views/scrivenings-view.js";
import { createSelectionScope } from "../src/services/compile-scope.js";

/* Micro-lot delta "bascule Markdown ↔ Continu dans la même leaf" — tests
 * unitaires des deux helpers ajoutés : `openScopeInContinuOnLeaf` (Markdown
 * → Continu, en place) et `ScriveningsView.collapseToSingleMember` (Continu
 * à 2 membres → Markdown, en place). Même harnais que
 * test/scrivenings-composition.test.js (vrai `ScriveningsView` +
 * `createFakeVault`), jamais un faux objet dupliquant sa surface : ce sont
 * justement les transitions de VUE qui sont testées ici. */

globalThis.window ??= {
  requestAnimationFrame: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
};

function buildProject() {
  const root = new TFolder("Roman/Manuscrit");
  const a = new TFile("Roman/Manuscrit/A.md", "Corps A original.");
  const b = new TFile("Roman/Manuscrit/B.md", "Corps B.");
  const c = new TFile("Roman/Manuscrit/C.md", "Corps C.");
  const d = new TFile("Roman/Manuscrit/D.md", "Corps D.");
  root.children = [a, b, c, d];
  a.parent = root;
  b.parent = root;
  c.parent = root;
  d.parent = root;

  const { vault } = createFakeVault([root, a, b, c, d]);
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = {
    projectFolder: root.path,
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
  };
  return { root, a, b, c, d, app, settings };
}

/** ScriveningsView réelle, montée sur une leaf FIDÈLE : `openFile` y est un
 * espion qui enregistre l'appel plutôt que de rien faire, exactement la
 * surface que `collapseToSingleMember` consomme (`this.leaf.openFile`). */
function buildView() {
  const project = buildProject();
  const openFileCalls = [];
  const plugin = { app: project.app, settings: project.settings, updateStatusBar: () => {} };
  const fakeLeaf = {
    app: project.app,
    contentEl: null,
    openFile: async (file, opts) => { openFileCalls.push({ file, opts }); },
  };
  const view = new ScriveningsView(fakeLeaf, plugin);
  view.mountEditor = () => {};
  view.destroyEditor = () => {};
  return { ...project, view, plugin, fakeLeaf, openFileCalls };
}

/* ===================== collapseToSingleMember (§9-10) ===================== */

test("collapseToSingleMember : Continu à 3+ membres refuse (toggleMember reste la voie normale)", async () => {
  const { view, a, b, c, root, openFileCalls } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path, c.path]));

  const ok = await view.collapseToSingleMember(a.path);

  assert.equal(ok, false);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path, c.path]);
  assert.deepEqual(openFileCalls, []);
});

test("collapseToSingleMember : chemin retiré non membre refuse", async () => {
  const { view, a, b, root, openFileCalls } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  const ok = await view.collapseToSingleMember("Roman/Manuscrit/Inconnu.md");

  assert.equal(ok, false);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path]);
  assert.deepEqual(openFileCalls, []);
});

test("collapseToSingleMember : 2 → 1, ouvre le fichier restant dans LA MÊME leaf (leaf.openFile), sans reconstruire Continu à 1 segment", async () => {
  const { view, a, b, root, openFileCalls, fakeLeaf } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));
  let focusedLeaf = null;
  view.plugin.app.workspace = { setActiveLeaf: (l) => { focusedLeaf = l; } };

  const ok = await view.collapseToSingleMember(a.path);

  assert.equal(ok, true);
  assert.equal(openFileCalls.length, 1, "aucune AUTRE leaf : un seul openFile, sur celle-ci");
  assert.equal(openFileCalls[0].file, b);
  assert.deepEqual(openFileCalls[0].opts, { active: true });
  assert.equal(focusedLeaf, fakeLeaf, "la même leaf est rendue active");
});

test("collapseToSingleMember : retirer B au lieu de A ouvre A, symétrique", async () => {
  const { view, a, b, root, openFileCalls } = buildView();
  view.plugin.app.workspace = { setActiveLeaf: () => {} };
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  const ok = await view.collapseToSingleMember(b.path);

  assert.equal(ok, true);
  assert.equal(openFileCalls[0].file, a);
});

test("collapseToSingleMember : dirty après flush → refuse, aucune leaf ouverte, texte local (dernière frappe) conservé", async () => {
  const { view, a, b, root, openFileCalls } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  // Dernière frappe locale non sauvegardée.
  const doc = view.session.document;
  view.session.handleChanges([{ from: 0, to: doc.segments[0].to, insert: "Dernière frappe jamais perdue" }]);

  // Conflit externe : le fichier change ailleurs avant que le flush ne parte.
  a.content = "Modifié ailleurs entretemps";

  const ok = await view.collapseToSingleMember(a.path);

  assert.equal(ok, false);
  assert.equal(view.session.dirtyCount > 0, true, "le chemin en conflit doit rester dirty");
  assert.deepEqual(openFileCalls, [], "aucune ouverture Markdown tant que le conflit n'est pas résolu");
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path], "Continu conservé tel quel");
  assert.equal(
    view.session.document.segments[0].body,
    "Dernière frappe jamais perdue",
    "aucune perte de texte local"
  );
});

test("collapseToSingleMember : sérialisé avec toggleMember, jamais de course sur des clics rapides", async () => {
  const { view, a, b, c, root } = buildView();
  view.plugin.app.workspace = { setActiveLeaf: () => {} };
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  // Deux appels concurrents : le retrait de b (2→1, collapse) et un ajout
  // de c parti juste après, avant résolution du premier — la file
  // `mutationQueue` (partagée avec toggleMember) doit les sérialiser.
  const collapse = view.collapseToSingleMember(b.path);
  const toggle = view.toggleMember(c.path);

  const [collapsed] = await Promise.all([collapse, toggle]);
  assert.equal(collapsed, true);
});

/* ===================== openScopeInContinuOnLeaf (§5) ===================== */

function buildMarkdownLeaf(project, file) {
  const plugin = { app: project.app, settings: project.settings, updateStatusBar: () => {} };
  const mdView = Object.assign(new MarkdownView(), { file });
  const leaf = {
    view: mdView,
    isDeferred: false,
    setViewState: async () => {
      const nextView = new ScriveningsView(leaf, plugin);
      // @codemirror/view est un stub minimal dans ce runtime de test (pas un
      // vrai constructeur) — même patron que scrivenings-composition.test.js.
      nextView.mountEditor = () => {};
      nextView.destroyEditor = () => {};
      leaf.view = nextView;
    },
    loadIfDeferred: async () => {},
  };
  leaf.app = project.app;
  leaf.contentEl = null;
  return leaf;
}

test("openScopeInContinuOnLeaf : transforme la MÊME leaf en Continu, jamais une nouvelle", async () => {
  const project = buildProject();
  let focusedLeaf = null;
  let revealedLeaf = null;
  project.app.workspace = {
    setActiveLeaf: (l) => { focusedLeaf = l; },
    revealLeaf: async (l) => { revealedLeaf = l; },
  };
  const leaf = buildMarkdownLeaf(project, project.a);
  const scope = createSelectionScope(project.root.path, [project.a.path, project.b.path]);

  const ok = await openScopeInContinuOnLeaf(project.app, leaf, scope);

  assert.equal(ok, true);
  assert.ok(leaf.view instanceof ScriveningsView, "la vue de CETTE leaf doit être devenue Continu");
  assert.deepEqual(leaf.view.getMemberPaths(), [project.a.path, project.b.path]);
  assert.equal(focusedLeaf, leaf);
  assert.equal(revealedLeaf, leaf);
});

test("openScopeInContinuOnLeaf : refuse si la leaf n'affiche pas un MarkdownView, rien n'est modifié", async () => {
  const project = buildProject();
  let setViewStateCalled = false;
  const leaf = { view: {}, setViewState: async () => { setViewStateCalled = true; } };
  const scope = createSelectionScope(project.root.path, [project.a.path, project.b.path]);

  const ok = await openScopeInContinuOnLeaf(project.app, leaf, scope);

  assert.equal(ok, false);
  assert.equal(setViewStateCalled, false, "aucune transformation tentée");
});

test("openScopeInContinuOnLeaf : charge une leaf différée avant openScope", async () => {
  const project = buildProject();
  project.app.workspace = { setActiveLeaf: () => {}, revealLeaf: async () => {} };
  const plugin = { app: project.app, settings: project.settings, updateStatusBar: () => {} };
  const mdView = Object.assign(new MarkdownView(), { file: project.a });
  const leaf = {
    view: mdView,
    isDeferred: false,
    setViewState: async () => {
      leaf.view = {}; // placeholder différé, comme le ferait réellement Obsidian
      leaf.isDeferred = true;
    },
    loadIfDeferred: async () => {
      leaf.isDeferred = false;
      const nextView = new ScriveningsView(leaf, plugin);
      nextView.mountEditor = () => {};
      nextView.destroyEditor = () => {};
      leaf.view = nextView;
    },
  };
  leaf.app = project.app;
  leaf.contentEl = null;
  const scope = createSelectionScope(project.root.path, [project.a.path, project.b.path]);

  const ok = await openScopeInContinuOnLeaf(project.app, leaf, scope);

  assert.equal(ok, true);
  assert.equal(leaf.isDeferred, false);
  assert.ok(leaf.view instanceof ScriveningsView);
  assert.deepEqual(leaf.view.getMemberPaths(), [project.a.path, project.b.path]);
});

/* ===================== §14 — ordre du cycle same-leaf, typographie ======
 * Micro-correctif "focus binder + 2→1 + typographie same-leaf" : prouve
 * l'ORDRE exact des étapes de `openScopeInContinuOnLeaf`, sans jamais
 * calculer de CSS ici (interdit, voir §9 du correctif) — seulement la
 * séquence des appels instrumentés. */

test("openScopeInContinuOnLeaf : ordre exact — setViewState(active:false), openScope, setActiveLeaf, puis réapplication typographique", async () => {
  const project = buildProject();
  const calls = [];
  project.app.workspace = {
    setActiveLeaf: () => { calls.push("setActiveLeaf"); },
    revealLeaf: async () => {},
  };
  const plugin = {
    app: project.app,
    settings: project.settings,
    updateStatusBar: () => {},
    applyLiveTypoClasses: () => { calls.push("applyLiveTypoClasses"); },
    applyIndentClass: () => { calls.push("applyIndentClass"); },
  };
  const mdView = Object.assign(new MarkdownView(), { file: project.a });
  const leaf = {
    view: mdView,
    isDeferred: false,
    setViewState: async (state) => {
      calls.push(`setViewState:active=${state.active}`);
      const nextView = new ScriveningsView(leaf, plugin);
      nextView.mountEditor = () => {};
      nextView.destroyEditor = () => {};
      const realOpenScope = nextView.openScope.bind(nextView);
      nextView.openScope = async (scope) => {
        calls.push("openScope:start");
        const ok = await realOpenScope(scope);
        calls.push("openScope:end");
        return ok;
      };
      leaf.view = nextView;
    },
    loadIfDeferred: async () => {},
  };
  leaf.app = project.app;
  leaf.contentEl = null;
  const scope = createSelectionScope(project.root.path, [project.a.path, project.b.path]);

  const ok = await openScopeInContinuOnLeaf(project.app, leaf, scope);

  assert.equal(ok, true);
  assert.deepEqual(calls, [
    "setViewState:active=false",
    "openScope:start",
    "openScope:end",
    "setActiveLeaf",
    "applyLiveTypoClasses",
    "applyIndentClass",
  ]);
});

test("openScopeInContinuOnLeaf : jamais active:true avant que le scope soit chargé", async () => {
  const project = buildProject();
  project.app.workspace = { setActiveLeaf: () => {}, revealLeaf: async () => {} };
  const plugin = { app: project.app, settings: project.settings, updateStatusBar: () => {} };
  const mdView = Object.assign(new MarkdownView(), { file: project.a });
  const setViewStateCalls = [];
  const leaf = {
    view: mdView,
    isDeferred: false,
    setViewState: async (state) => {
      setViewStateCalls.push(state);
      const nextView = new ScriveningsView(leaf, plugin);
      nextView.mountEditor = () => {};
      nextView.destroyEditor = () => {};
      leaf.view = nextView;
    },
    loadIfDeferred: async () => {},
  };
  leaf.app = project.app;
  leaf.contentEl = null;
  const scope = createSelectionScope(project.root.path, [project.a.path, project.b.path]);

  await openScopeInContinuOnLeaf(project.app, leaf, scope);

  assert.equal(setViewStateCalls.length, 1);
  assert.equal(setViewStateCalls[0].active, false, "jamais active:true avant openScope");
});

/* ===================== §18 — addMembers (ajout en lot) =================== */

test("§18A. addMembers([B,C,D]) sur A+B : ajoute C et D, B n'est PAS retiré → A+B+C+D", async () => {
  const { view, a, b, c, d, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  const ok = await view.addMembers([b.path, c.path, d.path]);

  assert.equal(ok, true);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path, c.path, d.path]);
});

test("§18B. addMembers([A,B]) sur A+B : aucun ajout réel, true sans reconstruction inutile", async () => {
  const { view, a, b, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  let openScopeCalls = 0;
  const realOpenScope = view.openScope.bind(view);
  view.openScope = async (scope) => { openScopeCalls++; return realOpenScope(scope); };

  const ok = await view.addMembers([a.path, b.path]);

  assert.equal(ok, true);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path]);
  assert.equal(openScopeCalls, 0, "aucune reconstruction quand rien de nouveau n'est ajouté");
});

test("§18C. addMembers sérialisé avec toggleMember/collapseToSingleMember via mutationQueue : clics rapides jamais en course", async () => {
  const { view, a, b, c, d, root } = buildView();
  view.plugin.app.workspace = { setActiveLeaf: () => {} };
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  // Trois opérations concurrentes, doivent s'exécuter dans leur ordre
  // d'arrivée sur la MÊME mutationQueue.
  const add = view.addMembers([c.path, d.path]);
  const toggle = view.toggleMember(a.path);

  const [addOk, toggleOk] = await Promise.all([add, toggle]);

  assert.equal(addOk, true);
  assert.equal(toggleOk, true);
  // addMembers résolu en premier (a,b,c,d), puis toggleMember retire a.
  assert.deepEqual(view.getMemberPaths(), [b.path, c.path, d.path]);
});

test("§18D. addMembers : dirty/conflit après flush → openScope refusé, composition ORIGINALE conservée, false", async () => {
  const { view, a, b, c, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  // Dernière frappe locale non sauvegardée sur A.
  const doc = view.session.document;
  view.session.handleChanges([{ from: 0, to: doc.segments[0].to, insert: "Dernière frappe jamais perdue" }]);

  // Conflit externe : le fichier change ailleurs avant que le flush ne parte.
  a.content = "Modifié ailleurs entretemps";

  const ok = await view.addMembers([c.path]);

  assert.equal(ok, false);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path], "composition originale conservée, C jamais ajouté");
  assert.equal(view.session.dirtyCount > 0, true, "le chemin en conflit reste dirty");
  assert.equal(
    view.session.document.segments[0].body,
    "Dernière frappe jamais perdue",
    "aucune perte de texte local"
  );
});
