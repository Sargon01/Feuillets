import { test } from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder, MarkdownView } from "obsidian";
import { VIEW_SCRIVENINGS, VIEW_PREVIEW } from "../src/constants.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";
import { addOpenWithPreviewItem, openScopeWithPreviewBesideLeaf } from "../src/views/preview-view.js";
import {
  createFileScope,
  createFolderScope,
  createProjectScope,
  createSelectionScope,
} from "../src/services/compile-scope.js";

/* Micro-correctif « Ouvrir avec aperçu » — les points d'entrée historiques
 * doivent désormais ouvrir le VRAI couple Continu | Preview (§§ 1-18 du
 * correctif), pas seulement le fichier cliqué en Preview seule. Ce fichier
 * teste le coordinateur `BaseFeuilletsView.openScopeWithContinuAndPreview`
 * et le helper `openScopeWithPreviewBesideLeaf` (preview-view.ts), en
 * dehors du moteur Continu↔Preview du Lot 3 (jamais touché ici — les vues
 * Continu/Preview sont de simples objets exposant leur surface publique,
 * jamais de vraies instances CodeMirror/iframe). */

const ENTRY_OPEN_WITH_PREVIEW = "Ouvrir avec aperçu";

/* ----------------------------- Fixture projet ---------------------------- */

function buildProject() {
  const root = new TFolder("Roman/Manuscrit");
  root.path = "Roman/Manuscrit";
  root.name = "Manuscrit";

  const chapter = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter.path = "Roman/Manuscrit/Chapitre 1";
  chapter.name = "Chapitre 1";
  chapter.parent = root;

  const mkFile = (name, parent) => {
    const path = `${parent.path}/${name}.md`;
    const f = new TFile(path, "Texte.");
    f.path = path;
    f.name = `${name}.md`;
    f.basename = name;
    f.extension = "md";
    f.parent = parent;
    return f;
  };

  const a = mkFile("A", root);
  const b = mkFile("B", root);
  const c = mkFile("C", root);
  const d = mkFile("D", chapter);
  chapter.children = [d];
  root.children = [a, b, c, chapter];

  const settings = {
    projectFolder: root.path,
    level1Role: "chapitres",
    compileFileName: "Manuscrit.md",
    orders: {},
    folderPositions: {},
    labels: [],
    statuses: [],
    projectMeta: {},
  };

  return { root, chapter, a, b, c, d, settings };
}

function buildVaultRegistry(project) {
  const registry = new Map();
  for (const node of [project.root, project.chapter, project.a, project.b, project.c, project.d]) {
    registry.set(node.path, node);
  }
  return registry;
}

/* --------------------------- Vues fictives (surface) --------------------- */

/** Vue Continu factice, reconnue par la garde structurelle
 * `isContinuWorkView` (base-feuillets-view.ts : getViewType/compileScope/
 * openScope) ET par `isContinuSourceView` (preview-view.ts : surface
 * COMPLÈTE de ContinuSourceView) — même objet, une seule vérité, comme la
 * vraie ScriveningsView qui implémente les deux surfaces à la fois. */
function fakeContinuView(initialScope = null) {
  return {
    getViewType: () => VIEW_SCRIVENINGS,
    compileScope: initialScope,
    openScopeCalls: 0,
    async openScope(scope) {
      this.openScopeCalls++;
      this.compileScope = scope;
      return true;
    },
    refreshHostTypographyCalls: 0,
    refreshHostTypography() {
      this.refreshHostTypographyCalls++;
    },
    getMemberPaths: () => [],
    getLiveBody: () => null,
    getScrollElement: () => null,
    getScrollAnchor: () => null,
    scrollToAnchor: () => {},
    async openSingleMember() { return true; },
    async focusSourcePosition() { return true; },
  };
}

/** Même surface, mais qui refuse systématiquement `openScope` — simule la
 * sécurité anti-perte de ScriveningsView.openScope. */
function fakeRefusingContinuView(initialScope) {
  const view = fakeContinuView(initialScope);
  view.openScope = async () => false;
  return view;
}

/** Vue Preview factice, reconnue par `isScopeableViewWithState`
 * (setCompileScope/compileScope) — `setContinuSource` tracé (micro-correctif
 * « lien Continu ↔ Preview ») : optionnel dans le vrai typage, mais présent
 * ici pour vérifier CE QUE `openScopeWithPreviewBesideLeaf` lui transmet. */
function fakePreviewView(initialScope = null, initialSourceMode = "document") {
  // `callOrder` : journal PARTAGÉ entre setSourceMode et setCompileScope —
  // seul moyen fiable de vérifier un ORDRE relatif entre deux méthodes
  // distinctes (des compteurs séparés ne le pourraient pas).
  const callOrder = [];
  return {
    compileScope: initialScope,
    setCompileScopeCalls: 0,
    callOrder,
    async setCompileScope(scope) {
      this.setCompileScopeCalls++;
      callOrder.push("setCompileScope");
      this.compileScope = scope;
    },
    setContinuSourceCalls: [],
    setContinuSource(source) {
      this.setContinuSourceCalls.push(source);
    },
    // Bug confirmé (chemins normaux d'ouverture → sourceMode "document") :
    // tracé ici pour vérifier CE QUE `openScopeWithPreviewBesideLeaf` lui
    // transmet, et dans quel ORDRE par rapport à `setCompileScope` — jamais
    // un second garde-fou : le no-op quand déjà "document" reste la seule
    // responsabilité de la VRAIE PreviewView (voir preview-view.test.js).
    sourceMode: initialSourceMode,
    setSourceModeCalls: [],
    async setSourceMode(mode) {
      this.setSourceModeCalls.push(mode);
      callOrder.push("setSourceMode");
      this.sourceMode = mode;
    },
  };
}

/* ------------------------------ Espace de travail ------------------------- */

/**
 * Espace de travail conscient du TYPE de leaf demandé — condition
 * nécessaire depuis que « Ouvrir avec aperçu » peut créer Continu ET
 * Preview séparément (jamais confondus, contrairement à un simple tableau
 * partagé).
 */
function buildWorkspace({ scriveningsLeaves = [], previewLeaves = [] } = {}) {
  const calls = { setActiveLeaf: [], getLeafKinds: [], revealLeaf: 0 };
  const workspace = {
    getLeavesOfType: (type) => {
      if (type === VIEW_SCRIVENINGS) return scriveningsLeaves;
      if (type === VIEW_PREVIEW) return previewLeaves;
      return [];
    },
    getLeaf: (kind) => {
      calls.getLeafKinds.push(kind);
      const leaf = {
        isDeferred: false,
        loadIfDeferred: async () => {},
        setViewState: async (state) => {
          if (state.type === VIEW_SCRIVENINGS) {
            leaf.view = fakeContinuView(null);
            scriveningsLeaves.push(leaf);
          } else if (state.type === VIEW_PREVIEW) {
            leaf.view = fakePreviewView(null);
            previewLeaves.push(leaf);
          }
        },
      };
      return leaf;
    },
    setActiveLeaf: (leaf, opts) => { calls.setActiveLeaf.push({ leaf, opts }); },
    revealLeaf: () => { calls.revealLeaf++; },
  };
  return { workspace, calls, scriveningsLeaves, previewLeaves };
}

function buildApp(project, workspace) {
  const registry = buildVaultRegistry(project);
  return {
    workspace,
    vault: { getAbstractFileByPath: (p) => registry.get(p) || null, read: async () => "Texte." },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    fileManager: { processFrontMatter: async () => {}, trashFile: async () => {} },
  };
}

function buildPlugin(project, workLeaf, extra = {}) {
  return {
    settings: project.settings,
    getProjectFolder: () => project.root,
    saveSettings: async () => {},
    fmOf: () => ({}),
    labelOf: () => "",
    titleFor: (f) => f.basename,
    isSceneFile: (f) => f instanceof TFile,
    flattenFiles: () => [project.a, project.b, project.c, project.d],
    addFilesToNotebook: async () => {},
    newSheetAt: () => {},
    newSheet: () => {},
    newFolder: () => {},
    renderAllViews: () => {},
    snapshotFile: async () => "",
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    getLinkedResearchFolder: () => null,
    getResearchRoot: () => null,
    getLeafForOpeningFile: () => workLeaf,
    getCentralContinuView: () => null,
    ...extra,
  };
}

class TestBinderView extends BaseFeuilletsView {
  constructor(app, plugin) {
    super({ app, contentEl: null });
    this.app = app;
    this.plugin = plugin;
  }
  async render() {}
}

/* ============================================================
 * A. FICHIER SEUL — inchangé : jamais de Continu.
 * ============================================================ */

test("A. Markdown A seul → Ouvrir avec aperçu : reste Markdown, Preview A, split si absente, aucun Continu", async () => {
  const project = buildProject();
  const menu = new Menu();
  const opened = { files: [], viewStates: [] };
  const app = {
    workspace: {
      getLeaf: (kind) => {
        const leaf = {
          kind,
          openFile: async (f) => { opened.files.push(f.path); },
          setViewState: async (state) => { opened.viewStates.push(state); },
        };
        return leaf;
      },
      getLeavesOfType: () => [],
      revealLeaf: () => {},
      setActiveLeaf: () => {},
    },
    vault: { getAbstractFileByPath: (p) => (p === project.root.path ? project.root : null), read: async () => "Texte." },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const plugin = { settings: project.settings, getProjectFolder: () => project.root, saveSettings: async () => {} };

  const added = addOpenWithPreviewItem(menu, app, plugin, project.a);
  assert.equal(added, true);
  const entry = menu.items.find((i) => i.title === ENTRY_OPEN_WITH_PREVIEW);
  entry.callback();
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(opened.files, [project.a.path]);
  assert.equal(opened.viewStates.length, 1, "une seule Preview créée (split)");
  assert.equal(opened.viewStates[0].type, VIEW_PREVIEW);
});

/* ============================================================
 * B/C. CONTINU SELECTION (contiguë et discontinue)
 * ============================================================ */

test("B. Continu selection A+B+C, _binderMultiSelect vide, clic droit sur B : scope du Continu réutilisé tel quel", async () => {
  const project = buildProject();
  const scope = createSelectionScope(project.root.path, [project.a.path, project.b.path, project.c.path]);

  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: fakeContinuView(scope) };
  const { workspace, previewLeaves } = buildWorkspace({ scriveningsLeaves: [workLeaf] });
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, workLeaf, {
    getCentralContinuView: () => ({ compileScope: scope, getMemberPaths: () => [project.a.path, project.b.path, project.c.path] }),
  });
  const view = new TestBinderView(app, plugin);
  // `_binderMultiSelect` vide : ne doit rien changer (§9-11 du correctif).
  view.plugin._binderMultiSelect = undefined;

  view.showFileContextMenu({ preventDefault() {} }, project.b, project.root, 1, []);
  const entry = Menu.lastShown.items.find((i) => i.title === ENTRY_OPEN_WITH_PREVIEW);
  assert.ok(entry);

  await entry.callback();

  assert.equal(workLeaf.view.openScopeCalls, 0, "scope déjà identique : pas de recomposition");
  assert.equal(previewLeaves.length, 1);
  assert.deepEqual(previewLeaves[0].view.compileScope, scope, "jamais B seul");
});

test("C. Continu discontinu A+C+D, clic droit sur C : Preview reçoit A+C+D", async () => {
  const project = buildProject();
  const scope = createSelectionScope(project.root.path, [project.a.path, project.c.path, project.d.path]);

  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: fakeContinuView(scope) };
  const { workspace, previewLeaves } = buildWorkspace({ scriveningsLeaves: [workLeaf] });
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, workLeaf, {
    getCentralContinuView: () => ({ compileScope: scope, getMemberPaths: () => [project.a.path, project.c.path, project.d.path] }),
  });
  const view = new TestBinderView(app, plugin);

  view.showFileContextMenu({ preventDefault() {} }, project.c, project.root, 2, []);
  const entry = Menu.lastShown.items.find((i) => i.title === ENTRY_OPEN_WITH_PREVIEW);
  await entry.callback();

  assert.equal(previewLeaves.length, 1);
  assert.deepEqual(previewLeaves[0].view.compileScope, scope);
});

/* ============================================================
 * D. CONTINU FOLDER
 * ============================================================ */

test("D. Continu = folderScope Chapitre 1, clic droit sur une scène membre : Preview reçoit exactement le folderScope", async () => {
  const project = buildProject();
  const scope = createFolderScope(project.root.path, project.chapter.path);

  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: fakeContinuView(scope) };
  const { workspace, previewLeaves } = buildWorkspace({ scriveningsLeaves: [workLeaf] });
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, workLeaf, {
    getCentralContinuView: () => ({ compileScope: scope, getMemberPaths: () => [project.d.path] }),
  });
  const view = new TestBinderView(app, plugin);

  view.showFileContextMenu({ preventDefault() {} }, project.d, project.chapter, 0, []);
  const entry = Menu.lastShown.items.find((i) => i.title === ENTRY_OPEN_WITH_PREVIEW);
  await entry.callback();

  assert.equal(previewLeaves.length, 1);
  assert.deepEqual(previewLeaves[0].view.compileScope, scope, "jamais une selection reconstruite");
});

/* ============================================================
 * E. CONTINU PROJECT
 * ============================================================ */

test("E. Continu = projectScope, clic droit sur un membre : Preview reçoit exactement le projectScope", async () => {
  const project = buildProject();
  const scope = createProjectScope(project.root.path);

  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: fakeContinuView(scope) };
  const { workspace, previewLeaves } = buildWorkspace({ scriveningsLeaves: [workLeaf] });
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, workLeaf, {
    getCentralContinuView: () => ({
      compileScope: scope,
      getMemberPaths: () => [project.a.path, project.b.path, project.c.path, project.d.path],
    }),
  });
  const view = new TestBinderView(app, plugin);

  view.showFileContextMenu({ preventDefault() {} }, project.b, project.root, 1, []);
  const entry = Menu.lastShown.items.find((i) => i.title === ENTRY_OPEN_WITH_PREVIEW);
  await entry.callback();

  assert.equal(previewLeaves.length, 1);
  assert.deepEqual(previewLeaves[0].view.compileScope, scope);
});

/* ============================================================
 * F. MULTI-SÉLECTION HISTORIQUE SANS CONTINU
 * ============================================================ */

test("F. Aucun Continu pertinent, _binderMultiSelect = A+B+C : le coordinateur ouvre Continu sélection | Preview sélection", async () => {
  const project = buildProject();

  // Leaf de travail centrale : ni Markdown ni Continu (repli exceptionnel).
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: {} };
  const { workspace, scriveningsLeaves, previewLeaves } = buildWorkspace();
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, workLeaf);
  const view = new TestBinderView(app, plugin);
  view.plugin._binderMultiSelect = new Set([project.a.path, project.b.path, project.c.path]);

  view.showFileContextMenu({ preventDefault() {} }, project.b, project.root, 1, []);
  const entry = Menu.lastShown.items.find((i) => i.title === ENTRY_OPEN_WITH_PREVIEW);
  await entry.callback();

  assert.equal(scriveningsLeaves.length, 1, "un seul Continu créé");
  const scope = scriveningsLeaves[0].view.compileScope;
  assert.equal(scope.type, "selection");
  assert.equal(scope.paths.length, 3);

  assert.equal(previewLeaves.length, 1, "une seule Preview créée, jamais un fichier seul");
  assert.deepEqual(previewLeaves[0].view.compileScope, scope);

  // La multi-sélection historique n'est jamais altérée.
  assert.equal(view.plugin._binderMultiSelect.size, 3);
});

/* ============================================================
 * G. DOSSIER
 * ============================================================ */

test("G. Ouvrir avec aperçu (dossier) : la leaf de travail devient Continu folderScope, Preview folderScope créée à côté", async () => {
  const project = buildProject();
  const workLeaf = {
    isDeferred: false,
    loadIfDeferred: async () => {},
    view: Object.assign(new MarkdownView(), { file: project.a }),
    setViewState: async (state) => {
      if (state.type === VIEW_SCRIVENINGS) workLeaf.view = fakeContinuView(null);
    },
  };
  const { workspace, scriveningsLeaves, previewLeaves } = buildWorkspace();
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, workLeaf);
  const view = new TestBinderView(app, plugin);

  view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, []);
  const entry = Menu.lastShown.items.find((i) => i.title === ENTRY_OPEN_WITH_PREVIEW);
  assert.ok(entry);

  await entry.callback();

  const expected = createFolderScope(project.root.path, project.chapter.path);
  // `openScopeInContinuOnLeaf` transforme la leaf EN PLACE (setViewState),
  // jamais via `workspace.getLeaf` — `scriveningsLeaves` (qui ne suit que
  // les leaves créées par `workspace.getLeaf`) reste donc vide ici.
  assert.equal(scriveningsLeaves.length, 0, "aucune NOUVELLE leaf Continu créée par workspace.getLeaf");
  assert.equal(workLeaf.view.getViewType(), VIEW_SCRIVENINGS, "la MÊME leaf devient Continu, en place");
  assert.deepEqual(workLeaf.view.compileScope, expected);

  assert.equal(previewLeaves.length, 1);
  assert.deepEqual(previewLeaves[0].view.compileScope, expected);
});

/* ============================================================
 * H. MANUSCRIT / PROJET
 * ============================================================ */

test("H. Coordinateur avec un projectScope : Continu projet | Preview projet côte à côte", async () => {
  const project = buildProject();
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: {} };
  const { workspace, scriveningsLeaves, previewLeaves } = buildWorkspace();
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, workLeaf);
  const view = new TestBinderView(app, plugin);

  const scope = createProjectScope(project.root.path);
  await view.openScopeWithContinuAndPreview(scope);

  assert.equal(scriveningsLeaves.length, 1);
  assert.deepEqual(scriveningsLeaves[0].view.compileScope, scope);
  assert.equal(previewLeaves.length, 1);
  assert.deepEqual(previewLeaves[0].view.compileScope, scope);
});

test("H bis. Le menu manuscrit (FeuilletsView) route bien vers le coordinateur, pas vers openScopeWithPreview", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/views/feuillets-view.ts", "utf8");
  const rootMenuSection = source.slice(source.indexOf('const menuTitle = t("shared.contextMenu.openWithPreview")'));
  const firstHandler = rootMenuSection.slice(0, rootMenuSection.indexOf("binder.openInContinu"));
  assert.ok(firstHandler.includes("createProjectScope(root.path)"));
  assert.ok(firstHandler.includes("this.openScopeWithContinuAndPreview(scope)"));
  assert.ok(!firstHandler.includes("openScopeWithPreview(this.app"));
});

/* ============================================================
 * I/J/K/L — Disposition (helper openScopeWithPreviewBesideLeaf direct)
 * ============================================================ */

test("I. Preview absente : workLeaf active AVANT le split, getLeaf(\"split\") appelé une seule fois, jamais \"tab\", focus final sur workLeaf", async () => {
  const project = buildProject();
  const scope = createFileScope(project.root.path, project.a.path);
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: fakeContinuView(scope) };
  const { workspace, calls, previewLeaves } = buildWorkspace();
  const app = buildApp(project, workspace);

  const leaf = await openScopeWithPreviewBesideLeaf(app, scope, workLeaf);

  assert.ok(leaf);
  assert.deepEqual(calls.getLeafKinds, ["split"], "getLeaf(\"split\") exactement une fois, jamais \"tab\"");
  assert.equal(previewLeaves.length, 1);
  assert.deepEqual(previewLeaves[0].view.compileScope, scope);

  // workLeaf doit avoir été rendue active AVANT la création du split, puis
  // une dernière fois à la fin (focus final).
  const workLeafActivations = calls.setActiveLeaf.filter((c) => c.leaf === workLeaf);
  assert.ok(workLeafActivations.length >= 2, "activée avant le split, puis focus final");
  assert.ok(workLeafActivations.every((c) => c.opts && c.opts.focus));
  assert.equal(calls.setActiveLeaf[calls.setActiveLeaf.length - 1].leaf, workLeaf, "le tout dernier appel cible workLeaf");
});

test("I bis. Preview réutilisée initialement en Support papier : openScopeWithPreviewBesideLeaf la ramène en document AVANT le scope demandé", async () => {
  const project = buildProject();
  const scope = createFileScope(project.root.path, project.a.path);
  const existingPreview = {
    view: fakePreviewView(createFileScope(project.root.path, project.b.path), "presentation-paper"),
  };
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: fakeContinuView(scope) };
  const { workspace, previewLeaves } = buildWorkspace({ previewLeaves: [existingPreview] });
  const app = buildApp(project, workspace);

  await openScopeWithPreviewBesideLeaf(app, scope, workLeaf);

  assert.deepEqual(existingPreview.view.setSourceModeCalls, ["document"], "le chemin NORMAL réinitialise toujours sourceMode à document");
  assert.equal(existingPreview.view.sourceMode, "document");
  assert.deepEqual(existingPreview.view.compileScope, scope, "le scope demandé est bien appliqué, pas conservé au hasard");
  assert.equal(previewLeaves.length, 1, "aucun doublon");

  // Ordre : le reset sourceMode précède le scope — jamais l'inverse, pour
  // qu'une Preview réutilisée ne rende jamais le pipeline papier avec un
  // scope qui n'en est pas un.
  assert.deepEqual(existingPreview.view.callOrder, ["setSourceMode", "setCompileScope"], "setSourceMode(\"document\") précède toujours setCompileScope");
});

test("J. Preview déjà existante : aucune nouvelle leaf, aucun split, réutilisée sans être déplacée", async () => {
  const project = buildProject();
  const scope = createFileScope(project.root.path, project.a.path);
  const existingPreview = { view: fakePreviewView(createFileScope(project.root.path, project.b.path)) };
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: fakeContinuView(scope) };
  const { workspace, calls, previewLeaves } = buildWorkspace({ previewLeaves: [existingPreview] });
  const app = buildApp(project, workspace);

  const leaf = await openScopeWithPreviewBesideLeaf(app, scope, workLeaf);

  assert.equal(leaf, existingPreview, "la Preview existante est réutilisée telle quelle");
  assert.equal(calls.getLeafKinds.length, 0, "aucun getLeaf(\"split\") ni getLeaf(\"tab\")");
  assert.equal(previewLeaves.length, 1, "aucun doublon");
  assert.deepEqual(existingPreview.view.compileScope, scope, "le nouveau scope est transmis");
});

test("K. Continu déjà sur le bon scope : pas de recomposition inutile, Preview seulement ouverte/réutilisée", async () => {
  const project = buildProject();
  const scope = createFolderScope(project.root.path, project.chapter.path);
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: fakeContinuView(scope) };
  const { workspace, scriveningsLeaves, previewLeaves } = buildWorkspace({ scriveningsLeaves: [workLeaf] });
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, workLeaf, {
    getCentralContinuView: () => ({ compileScope: scope, getMemberPaths: () => [project.d.path] }),
  });
  const view = new TestBinderView(app, plugin);

  await view.openScopeWithContinuAndPreview(scope);

  assert.equal(workLeaf.view.openScopeCalls, 0, "compileScope déjà identique : openScope jamais appelé");
  assert.equal(scriveningsLeaves.length, 1);
  assert.equal(previewLeaves.length, 1);
  assert.deepEqual(previewLeaves[0].view.compileScope, scope);
});

test("L. Continu refuse openScope (sécurité anti-perte) : Preview n'est jamais ouverte sur le nouveau scope", async () => {
  const project = buildProject();
  const currentScope = createFileScope(project.root.path, project.a.path);
  const requestedScope = createFileScope(project.root.path, project.b.path);
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: fakeRefusingContinuView(currentScope) };
  const { workspace, previewLeaves } = buildWorkspace({ scriveningsLeaves: [workLeaf] });
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, workLeaf);
  const view = new TestBinderView(app, plugin);

  await view.openScopeWithContinuAndPreview(requestedScope);

  assert.equal(previewLeaves.length, 0, "Preview jamais ouverte sur un scope que Continu a refusé");
  assert.deepEqual(workLeaf.view.compileScope, currentScope, "aucun état divergent : Continu garde son ancien scope");
});

/* ============================================================
 * M/N/O — Priorité au Continu central existant (micro-correctif
 * « Nouvel onglet parasite ») : `plugin.getLeafForOpeningFile()` ne doit
 * JAMAIS être appelé quand un Continu central pertinent existe déjà — sa
 * propre leaf est retrouvée par IDENTITÉ (`leaf.view === centralContinu`).
 * ============================================================ */

test("M. Continu central existant (scope différent) : jamais getLeafForOpeningFile, sa propre leaf réutilisée, aucun \"Nouvel onglet\"", async () => {
  const project = buildProject();
  const currentScope = createFolderScope(project.root.path, project.chapter.path);
  const requestedScope = createProjectScope(project.root.path);

  const continuView = fakeContinuView(currentScope);
  const continuLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: continuView };

  const { workspace, calls, previewLeaves } = buildWorkspace({ scriveningsLeaves: [continuLeaf] });
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, null, {
    getCentralContinuView: () => continuView,
    getLeafForOpeningFile: () => {
      throw new Error("getLeafForOpeningFile ne doit jamais être appelé quand un Continu central existe");
    },
  });
  const view = new TestBinderView(app, plugin);

  await view.openScopeWithContinuAndPreview(requestedScope);

  assert.equal(continuView.openScopeCalls, 1, "recomposition attendue : le scope demandé diffère");
  assert.deepEqual(continuView.compileScope, requestedScope);
  assert.equal(calls.getLeafKinds.includes("tab"), false, "jamais getLeaf(\"tab\") — aucune EmptyView créée");
  assert.equal(previewLeaves.length, 1, "une seule Preview, créée via getLeaf(\"split\")");
  assert.deepEqual(calls.getLeafKinds, ["split"]);
  assert.deepEqual(previewLeaves[0].view.compileScope, requestedScope);
  assert.ok(
    calls.setActiveLeaf.some((c) => c.leaf === continuLeaf && c.opts && c.opts.focus),
    "le focus final revient à la leaf Continu réelle, jamais à une leaf neuve"
  );
});

test("N. Continu central déjà sur le scope demandé : aucune recomposition, getLeafForOpeningFile jamais appelé", async () => {
  const project = buildProject();
  const scope = createFolderScope(project.root.path, project.chapter.path);

  const continuView = fakeContinuView(scope);
  const continuLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: continuView };
  const { workspace, previewLeaves } = buildWorkspace({ scriveningsLeaves: [continuLeaf] });
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, null, {
    getCentralContinuView: () => continuView,
    getLeafForOpeningFile: () => {
      throw new Error("getLeafForOpeningFile ne doit jamais être appelé quand un Continu central existe");
    },
  });
  const view = new TestBinderView(app, plugin);

  await view.openScopeWithContinuAndPreview(scope);

  assert.equal(continuView.openScopeCalls, 0, "scope déjà identique : pas de recomposition");
  assert.equal(previewLeaves.length, 1, "Preview ouverte/réutilisée normalement");
  assert.deepEqual(previewLeaves[0].view.compileScope, scope);
});

test("O. Continu central + Preview déjà ouverte : aucune nouvelle leaf (ni split ni tab), focus final sur Continu", async () => {
  const project = buildProject();
  const scope = createProjectScope(project.root.path);

  const continuView = fakeContinuView(scope);
  const continuLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: continuView };
  const existingPreview = { view: fakePreviewView(createFileScope(project.root.path, project.a.path)) };
  const { workspace, calls, previewLeaves } = buildWorkspace({
    scriveningsLeaves: [continuLeaf],
    previewLeaves: [existingPreview],
  });
  const app = buildApp(project, workspace);
  const plugin = buildPlugin(project, null, {
    getCentralContinuView: () => continuView,
    getLeafForOpeningFile: () => {
      throw new Error("getLeafForOpeningFile ne doit jamais être appelé quand un Continu central existe");
    },
  });
  const view = new TestBinderView(app, plugin);

  await view.openScopeWithContinuAndPreview(scope);

  assert.equal(calls.getLeafKinds.length, 0, "aucune nouvelle leaf créée (ni split ni tab)");
  assert.equal(previewLeaves.length, 1, "aucun doublon de Preview");
  assert.equal(previewLeaves[0], existingPreview, "la Preview existante est réutilisée telle quelle");
  assert.deepEqual(existingPreview.view.compileScope, scope, "le nouveau scope lui est transmis");
  assert.ok(
    calls.setActiveLeaf.some((c) => c.leaf === continuLeaf && c.opts && c.opts.focus),
    "le focus final revient à Continu"
  );
});

/* ============================================================
 * P/Q — Lien Continu → Preview posé PAR openScopeWithPreviewBesideLeaf
 * (micro-correctif « lien Continu ↔ Preview ») : le VRAI mécanisme
 * couvert, pas un plugin stub qui renverrait artificiellement Continu via
 * getCentralContinuView — le lien vient ICI de workLeaf.view lui-même.
 * ============================================================ */

test("P. openScopeWithPreviewBesideLeaf : workLeaf.view Continu-shaped → preview.setContinuSource(workLeaf.view) avant setCompileScope", async () => {
  const project = buildProject();
  const scope = createFolderScope(project.root.path, project.chapter.path);
  const continuView = fakeContinuView(scope);
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: continuView };
  const { workspace, previewLeaves } = buildWorkspace();
  const app = buildApp(project, workspace);

  await openScopeWithPreviewBesideLeaf(app, scope, workLeaf);

  assert.equal(previewLeaves.length, 1);
  const previewView = previewLeaves[0].view;
  assert.equal(previewView.setContinuSourceCalls.length, 1);
  assert.equal(previewView.setContinuSourceCalls[0], continuView, "reçoit EXACTEMENT workLeaf.view, jamais une reconstruction");
  assert.equal(previewView.setCompileScopeCalls, 1);
});

test("Q. openScopeWithPreviewBesideLeaf : workLeaf.view NON Continu (mono-fichier Markdown) → preview.setContinuSource(null)", async () => {
  const project = buildProject();
  const scope = createFileScope(project.root.path, project.a.path);
  // Ne ressemble PAS à un Continu (pas de getMemberPaths/getScrollAnchor/…) —
  // exactement la forme d'un vrai MarkdownView.
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: { file: project.a } };
  const { workspace, previewLeaves } = buildWorkspace();
  const app = buildApp(project, workspace);

  await openScopeWithPreviewBesideLeaf(app, scope, workLeaf);

  const previewView = previewLeaves[0].view;
  assert.equal(previewView.setContinuSourceCalls.length, 1);
  assert.equal(previewView.setContinuSourceCalls[0], null, "protège intégralement le parcours mono-fichier Markdown");
});

test("R. openScopeWithPreviewBesideLeaf : Preview déjà rendue sur le même scope reçoit quand même setContinuSource (cas §4 : lien posé APRÈS coup)", async () => {
  const project = buildProject();
  const scope = createFolderScope(project.root.path, project.chapter.path);
  const continuView = fakeContinuView(scope);
  const workLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: continuView };
  const existingPreview = { view: fakePreviewView(scope) }; // déjà sur LE MÊME scope
  const { workspace } = buildWorkspace({ previewLeaves: [existingPreview] });
  const app = buildApp(project, workspace);

  await openScopeWithPreviewBesideLeaf(app, scope, workLeaf);

  assert.equal(existingPreview.view.setContinuSourceCalls.length, 1);
  assert.equal(existingPreview.view.setContinuSourceCalls[0], continuView);
  // Scope déjà identique : setCompileScope n'a pas besoin d'être rappelé.
  assert.equal(existingPreview.view.setCompileScopeCalls, 0);
});
