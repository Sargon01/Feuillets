import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { VIEW_SCRIVENINGS } from "../src/constants.js";
import { t } from "../src/i18n/index.js";

// highlightActive (utils/dom.ts) appelle CSS.escape — absent du runtime Node
// de test (voir test/binder-continu-membership.test.js pour le même
// polyfill minimal, dupliqué ici pour ne dépendre d'aucun autre fichier).
if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle) };

/* Réordonnancement multi-feuillets par glisser-déposer dans le Binder :
   - La sélection multiple (Cmd/Ctrl+clic, Maj+clic) choisit les feuillets
   - Le drag depuis n'importe quel feuillet de la sélection entraîne le groupe
   - Le drop détermine la position (avant/après pour fichiers, avant/dans/après pour dossiers)
   - L'ordre interne du groupe suit l'ordre réel du Binder (siblings)
   - applySiblingOrder appelé UNE SEULE FOIS par opération
   - Le menu contextuel « Déplacer » reste unitaire (moveSceneFile)

   Ces tests exercent le VRAI flux DOM (mousedown/dragstart/dragover/drop)
   via attachDragHandlers et handleMultiSelectClick — pas une reconstruction
   manuelle de l'état attendu. Voir la note de diagnostic dans le compte
   rendu du correctif : le bug réel ne se voyait qu'en simulant le
   `mousedown` réel (avec modificateur encore enfoncé) avant le dragstart. */

class FakeElement {
  constructor() {
    this.children = [];
    this.classes = new Set();
    this.draggable = false;
    this.events = new Map();
  }
  createEl(tag) { const el = new FakeElement(); el.tag = tag; this.children.push(el); return el; }
  createDiv() { return this.createEl("div"); }
  createSpan() { return this.createEl("span"); }
  addClass(c) { this.classes.add(c); return this; }
  removeClass(c) { this.classes.delete(c); return this; }
  toggleClass(c, force) { if (force) this.classes.add(c); else this.classes.delete(c); return this; }
  setAttr(n, v) { if (n === "data-path") this.dataset = { path: v }; }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { top: 0, left: 0, height: 24, width: 200 }; }
  /* Plusieurs handlers peuvent être posés sur le même type d'événement sur
     un même élément (ex. plusieurs "click") — un vrai DOM les empile tous,
     contrairement à un Map à une seule entrée. */
  addEventListener(name, fn) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(fn);
  }
  fire(name, ev) {
    for (const fn of this.events.get(name) || []) fn(ev);
  }
  getAttribute(name) { if (name === "data-path") return this.dataset?.path; return null; }
  setAttribute(name, val) { this.setAttr(name, val); }
  closest() { return null; }
}

/* `data` reste inspectable après le dragstart pour vérifier exactement quels
   types MIME ont été posés — c'est tout l'objet du test §5 du correctif
   DataTransfer : un drag Binder ne doit jamais repartir avec un
   DataTransfer vide (Chromium/Electron n'engagerait pas l'opération native
   sans au moins un setData). */
function fakeDataTransfer() {
  const data = {};
  return {
    effectAllowed: null,
    dropEffect: null,
    setData(k, v) { data[k] = v; },
    getData(k) { return data[k]; },
    hasType(k) { return Object.prototype.hasOwnProperty.call(data, k); },
  };
}

class TestView extends BaseFeuilletsView {
  constructor(app, plugin) {
    super({ app, contentEl: new FakeElement() });
    this.app = app;
    this.plugin = plugin;
  }
  async render() {}
}

function makeProject() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Recherche");
  const chapterFolder = new TFolder("Projet/Manuscrit/Chapitre 1");
  const a = new TFile("Projet/Manuscrit/Chapitre 1/A.md", "A");
  const b = new TFile("Projet/Manuscrit/Chapitre 1/B.md", "B");
  const c = new TFile("Projet/Manuscrit/Chapitre 1/C.md", "C");
  const d = new TFile("Projet/Manuscrit/Chapitre 1/D.md", "D");
  const e = new TFile("Projet/Manuscrit/Chapitre 1/E.md", "E");
  const f = new TFile("Projet/Manuscrit/Chapitre 1/F.md", "F");
  const researchFile = new TFile("Projet/Recherche/Ney.md", "Recherche");

  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  manuscript.children = [chapterFolder];
  chapterFolder.parent = manuscript;
  chapterFolder.children = [a, b, c, d, e, f];
  for (const fl of [a, b, c, d, e, f]) fl.parent = chapterFolder;
  research.children = [researchFile];
  researchFile.parent = research;

  const allFiles = new Map();
  for (const fl of [volume, manuscript, research, chapterFolder, a, b, c, d, e, f, researchFile]) {
    allFiles.set(fl.path, fl);
  }
  const vault = { allFiles, getAbstractFileByPath: (p) => allFiles.get(p) || null };

  return { volume, manuscript, research, chapterFolder, a, b, c, d, e, f, researchFile, vault, canonicalOrder: [a, b, c, d, e, f] };
}

function makePlugin(project, overrides = {}) {
  const sceneFiles = new Set([project.a.path, project.b.path, project.c.path, project.d.path, project.e.path, project.f.path]);
  return {
    settings: { projectFolder: project.manuscript.path },
    getProjectFolder: () => project.manuscript,
    flattenFiles: () => project.chapterFolder.children,
    isSceneFile: (fl) => sceneFiles.has(fl.path),
    moveSceneFile: async () => {},
    moveNode: async () => {},
    renderAllViews: () => {},
    shortTitleFor: (fl) => fl.basename,
    titleFor: (fl) => fl.basename,
    fmOf: () => ({}),
    labelOf: () => "",
    _binderMultiSelect: null,
    applySiblingOrder: async (parent, newOrder) => {
      project.chapterFolder.children = newOrder;
    },
    ...overrides,
  };
}

function makeApp(project) {
  return {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
}

function findItem(menu, title) {
  return menu.items.find((i) => !i.separator && i.title === title);
}

/* Construit une ligne réelle (avec attachDragHandlers posé dessus, comme
   dans feuillets-view.ts) pour chaque fichier de `siblings`, et renvoie une
   map basename -> FakeElement. */
function buildRows(view, parent, siblings, scopeEl) {
  const rows = {};
  siblings.forEach((f, i) => {
    const row = new FakeElement();
    row.setAttr("data-path", f.path);
    view.attachDragHandlers(row, row, parent, i, siblings, scopeEl);
    rows[f.basename ?? f.name] = row;
  });
  return rows;
}

/* Rejoue le VRAI mousedown posé par renderFileRow (feuillets-view.ts) sur
   chaque ligne : `shouldPreventMultiSelectMousedown` (base-feuillets-view.ts)
   est la méthode réellement appelée en production, pas une réimplémentation
   du test — un régression sur la garde y est donc détectée directement. */
function simulateGuardedMousedown(view, file, mods) {
  const e = { shiftKey: !!mods.shiftKey, metaKey: !!mods.metaKey, ctrlKey: !!mods.ctrlKey };
  return { defaultPrevented: view.shouldPreventMultiSelectMousedown(e, file.path, false) };
}

function clickEvt(mods = {}) {
  return { ...mods, preventDefault() {}, stopPropagation() {} };
}

/* 1. drag unitaire inchangé : le menu contextuel « Déplacer » appelle moveSceneFile */
test("1 — drag unitaire inchangé : menu contextuel « Déplacer » → moveSceneFile", () => {
  const project = makeProject();
  const moved = [];
  const plugin = makePlugin(project, { moveSceneFile: async (fl) => moved.push(fl) });
  const view = new TestView(makeApp(project), plugin);

  view.showFileContextMenu({ preventDefault() {} }, project.a, project.chapterFolder, 0, []);

  const menu = Menu.lastShown;
  const item = findItem(menu, t("shared.contextMenu.move"));
  assert.ok(item, "l'entrée « Déplacer » unitaire existe");
  assert.equal(findItem(menu, t("shared.contextMenu.moveManySheets", { count: "3" })), undefined, "plus d'entrée batch");

  item.callback();
  assert.deepEqual(moved, [project.a]);
});

/* 2. dragstart réel sur un membre de la sélection → dragState multi avec le
   bon groupe, dans l'ordre Binder, PUIS drop après E → A D E B C F, en un
   seul appel à applySiblingOrder. C'est le scénario §16/§17 du prompt. */
test("2 — Cmd+clic B, Cmd+clic C, drag DEPUIS C → groupe B+C, drop après E → A D E B C F", () => {
  const project = makeProject();
  let applyCallCount = 0;
  const plugin = makePlugin(project, {
    applySiblingOrder: async (parent, order) => {
      applyCallCount++;
      project.chapterFolder.children = order;
    },
  });
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  // 1. Cmd+clic B — clic complet (mousedown, garde OK car B pas encore
  //    sélectionné, puis click qui construit la sélection).
  let g = simulateGuardedMousedown(view, project.b, { ctrlKey: true });
  assert.ok(g.defaultPrevented, "1er Cmd+clic sur B non encore sélectionné : mousedown protégé comme avant");
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.b, project.chapterFolder, 1, siblings, scopeEl);

  // 2. Cmd+clic C
  g = simulateGuardedMousedown(view, project.c, { ctrlKey: true });
  assert.ok(g.defaultPrevented, "1er Cmd+clic sur C non encore sélectionné : mousedown protégé comme avant");
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.c, project.chapterFolder, 2, siblings, scopeEl);

  assert.deepEqual([...plugin._binderMultiSelect].sort(), [project.b.path, project.c.path].sort(), "sélection = B + C avant le drag");

  // 3. Cmd toujours enfoncé, mousedown sur C pour démarrer le drag : la
  //    sélection existante ne doit PAS bloquer le dragstart natif.
  g = simulateGuardedMousedown(view, project.c, { ctrlKey: true });
  assert.ok(!g.defaultPrevented, "mousedown sur un membre déjà sélectionné laisse le dragstart natif démarrer");

  // dragstart réel sur C (à travers attachDragHandlers)
  const dt = fakeDataTransfer();
  rows["C"].fire("dragstart", { target: rows["C"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });

  // DataTransfer réellement initialisé (sinon Chromium/Electron n'engage
  // pas le drag natif) : marqueur privé présent et non vide, PAS de
  // text/plain pour un batch multi (le groupe réel reste dans dragState).
  assert.ok(dt.hasType("application/x-feuillets-binder"), "marqueur MIME privé posé au dragstart multi");
  assert.ok(dt.getData("application/x-feuillets-binder"), "valeur non vide pour le marqueur");
  assert.ok(!dt.hasType("text/plain"), "pas de text/plain Canvas pour un batch multi");

  assert.ok(plugin.dragState, "dragState construit");
  assert.equal(plugin.dragState.multi, true, "dragState est un batch");
  assert.deepEqual(plugin.dragState.items.map((it) => it.path), [project.b.path, project.c.path], "groupe = B, C dans l'ordre Binder réel");

  // dragover + drop sur E, zone « après » (clientY > milieu de la ligne)
  const dt2 = fakeDataTransfer();
  rows["E"].fire("dragover", { clientY: 20, dataTransfer: dt2, preventDefault() {} });
  rows["E"].fire("drop", { clientY: 20, dataTransfer: dt2, preventDefault() {} });

  assert.deepEqual(project.chapterFolder.children.map((f) => f.basename), ["A", "D", "E", "B", "C", "F"], "ordre final B+C après E");
  assert.equal(applyCallCount, 1, "applySiblingOrder appelé une seule fois");
});

/* 3. B+D avant F → A C E B D F */
test("3 — B+D avant F → A C E B D F", () => {
  const project = makeProject();
  let applyCallCount = 0;
  const plugin = makePlugin(project, {
    applySiblingOrder: async (parent, order) => {
      applyCallCount++;
      project.chapterFolder.children = order;
    },
  });
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.b, project.chapterFolder, 1, siblings, scopeEl);
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.d, project.chapterFolder, 3, siblings, scopeEl);

  const dt = fakeDataTransfer();
  rows["D"].fire("dragstart", { target: rows["D"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });
  assert.equal(plugin.dragState.multi, true);
  assert.deepEqual(plugin.dragState.items.map((it) => it.path), [project.b.path, project.d.path]);

  // Drop AVANT F : zone haute (clientY < milieu)
  const dt2 = fakeDataTransfer();
  rows["F"].fire("dragover", { clientY: 5, dataTransfer: dt2, preventDefault() {} });
  rows["F"].fire("drop", { clientY: 5, dataTransfer: dt2, preventDefault() {} });

  assert.deepEqual(project.chapterFolder.children.map((f) => f.basename), ["A", "C", "E", "B", "D", "F"]);
  assert.equal(applyCallCount, 1);
});

/* 4. sélection effectuée E puis B puis C : ordre déplacé B C E (ordre Binder,
   jamais l'ordre de clic) */
test("4 — sélection E puis B puis C → drag → groupe déplacé B C E (ordre Binder)", () => {
  const project = makeProject();
  const plugin = makePlugin(project);
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.e, project.chapterFolder, 4, siblings, scopeEl);
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.b, project.chapterFolder, 1, siblings, scopeEl);
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.c, project.chapterFolder, 2, siblings, scopeEl);

  const dt = fakeDataTransfer();
  rows["C"].fire("dragstart", { target: rows["C"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(plugin.dragState.items.map((it) => it.path), [project.b.path, project.c.path, project.e.path], "groupe = B, C, E dans l'ordre Binder, jamais l'ordre de clic");
});

/* 5. drag commencé depuis un feuillet hors sélection : déplacement unitaire */
test("5 — B+D sélectionnés, drag depuis C (hors sélection) → déplacement unitaire", () => {
  const project = makeProject();
  const plugin = makePlugin(project);
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  plugin._binderMultiSelect = new Set([project.b.path, project.d.path]);

  const dt = fakeDataTransfer();
  rows["C"].fire("dragstart", { target: rows["C"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });

  assert.ok(!plugin.dragState.multi, "dragState.multi=false pour élément hors sélection");
  assert.equal(plugin.dragState.path, project.c.path, "seul l'élément saisi");
});

/* 6. sélection avec parents différents : déplacement unitaire (cas D) */
test("6 — sélection parents différents → drag unitaire du feuillet réellement saisi", () => {
  const project = makeProject();
  const otherFolder = new TFolder("Projet/Manuscrit/Chapitre 2");
  otherFolder.parent = project.manuscript;
  const g = new TFile("Projet/Manuscrit/Chapitre 2/G.md", "G");
  g.parent = otherFolder;
  otherFolder.children = [g];
  project.vault.allFiles.set(g.path, g);
  project.vault.allFiles.set(otherFolder.path, otherFolder);

  const plugin = makePlugin(project);
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  plugin._binderMultiSelect = new Set([project.a.path, g.path]); // parents différents

  const dt = fakeDataTransfer();
  rows["A"].fire("dragstart", { target: rows["A"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });

  assert.ok(!plugin.dragState.multi, "dragState.multi=false si le groupe filtré ne contient qu'un seul sibling réel");
  assert.equal(plugin.dragState.path, project.a.path);
});

/* 7. no-op : drop à la position actuelle → applySiblingOrder non appelé */
test("7 — no-op (C+D droppés à leur position actuelle) → applySiblingOrder non appelé", () => {
  const project = makeProject();
  let applyCallCount = 0;
  const plugin = makePlugin(project, {
    applySiblingOrder: async () => { applyCallCount++; },
  });
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.c, project.chapterFolder, 2, siblings, scopeEl);
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.d, project.chapterFolder, 3, siblings, scopeEl);

  const dt = fakeDataTransfer();
  rows["C"].fire("dragstart", { target: rows["C"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });

  // Drop sur C lui-même (zone "avant", membre du groupe) : no-op attendu.
  const dt2 = fakeDataTransfer();
  rows["C"].fire("dragover", { clientY: 5, dataTransfer: dt2, preventDefault() {} });
  rows["C"].fire("drop", { clientY: 5, dataTransfer: dt2, preventDefault() {} });

  assert.equal(applyCallCount, 0, "applySiblingOrder non appelé");
});

/* 8. openMoveManyModal jamais appelé pour ce batch (menu contextuel comme
   avant, et aucune trace de la fonction dans le flux drag) */
test("8 — openMoveManyModal jamais appelé pour le réordonnancement multi Binder", () => {
  const project = makeProject();
  const plugin = makePlugin(project);
  plugin.openMoveManyModal = () => { throw new Error("openMoveManyModal ne doit pas être appelée"); };

  const view = new TestView(makeApp(project), plugin);
  view.showFileContextMenu({ preventDefault() {} }, project.b, project.chapterFolder, 1, []);

  const menu = Menu.lastShown;
  const item = findItem(menu, t("shared.contextMenu.move"));
  assert.ok(item, "seule l'entrée unitaire « Déplacer »");
  assert.equal(findItem(menu, t("shared.contextMenu.moveManySheets", { count: "3" })), undefined);

  let called = false;
  plugin.moveSceneFile = async () => { called = true; };
  item.callback();
  assert.ok(called, "moveSceneFile appelé pour le fichier cliqué");

  // Batch réel : drag B+C, drop après E — openMoveManyModal ne doit jamais
  // être sollicité (voir throw ci-dessus, qui ferait échouer ce test).
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.b, project.chapterFolder, 1, siblings, scopeEl);
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.c, project.chapterFolder, 2, siblings, scopeEl);
  const dt = fakeDataTransfer();
  rows["C"].fire("dragstart", { target: rows["C"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });
  const dt2 = fakeDataTransfer();
  rows["E"].fire("dragover", { clientY: 20, dataTransfer: dt2, preventDefault() {} });
  rows["E"].fire("drop", { clientY: 20, dataTransfer: dt2, preventDefault() {} });
});

/* 9. dragend nettoie le drag state */
test("9 — dragend nettoie le drag state (batch et unitaire)", () => {
  const project = makeProject();
  const plugin = makePlugin(project);
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.b, project.chapterFolder, 1, siblings, scopeEl);
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.c, project.chapterFolder, 2, siblings, scopeEl);

  const dt = fakeDataTransfer();
  rows["C"].fire("dragstart", { target: rows["C"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });
  assert.ok(plugin.dragState, "dragState présent après dragstart");

  rows["C"].fire("dragend", {});
  assert.equal(plugin.dragState, null, "dragState nettoyé après dragend");

  // La sélection utilisateur, elle, doit survivre (comportement historique :
  // seul un drop réussi la recompose, un dragend seul ne la vide jamais).
  assert.deepEqual([...plugin._binderMultiSelect].sort(), [project.b.path, project.c.path].sort());
});

/* 10. même construction du drag state dans le second volet (arbre) : le
   test ci-dessus utilise déjà attachDragHandlers/handleMultiSelectClick,
   exactement les mêmes méthodes partagées que celles appelées par
   renderTreeFolders / renderHierarchyContents pour le volet arbre (voir
   feuillets-view.ts) — aucune logique dupliquée à tester séparément. Ce
   test construit malgré tout un second jeu de lignes indépendant pour
   vérifier qu'il n'y a pas d'état caché partagé entre deux "volets". */
test("10 — second jeu de lignes (volet arbre simulé) : même comportement batch", () => {
  const project = makeProject();
  let applyCallCount = 0;
  const plugin = makePlugin(project, {
    applySiblingOrder: async (parent, order) => {
      applyCallCount++;
      project.chapterFolder.children = order;
    },
  });
  const view = new TestView(makeApp(project), plugin);

  // Volet 1
  const scopeEl1 = new FakeElement();
  const siblings = project.chapterFolder.children;
  buildRows(view, project.chapterFolder, siblings, scopeEl1);

  // Volet 2 : mêmes fichiers, lignes DOM distinctes (comme l'arbre à droite)
  const scopeEl2 = new FakeElement();
  const rows2 = buildRows(view, project.chapterFolder, siblings, scopeEl2);

  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.b, project.chapterFolder, 1, siblings, scopeEl2);
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.c, project.chapterFolder, 2, siblings, scopeEl2);

  const dt = fakeDataTransfer();
  rows2["C"].fire("dragstart", { target: rows2["C"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });
  assert.equal(plugin.dragState.multi, true);
  assert.deepEqual(plugin.dragState.items.map((it) => it.path), [project.b.path, project.c.path]);

  const dt2 = fakeDataTransfer();
  rows2["E"].fire("dragover", { clientY: 20, dataTransfer: dt2, preventDefault() {} });
  rows2["E"].fire("drop", { clientY: 20, dataTransfer: dt2, preventDefault() {} });

  assert.deepEqual(project.chapterFolder.children.map((f) => f.basename), ["A", "D", "E", "B", "C", "F"]);
  assert.equal(applyCallCount, 1);
});

/* 11. Contrat DataTransfer natif — TFile unitaire pose le marqueur privé ET
   le text/plain historique (Canvas/Advanced Canvas) ; TFolder unitaire ne
   pose que le marqueur privé, jamais de text/plain. Le marqueur privé sert
   uniquement à engager le drag HTML natif — il n'est jamais lu au drop
   (le groupe réel reste `plugin.dragState`, inchangé par ce correctif). */
test("11 — DataTransfer natif : TFile single (marqueur + text/plain), TFolder single (marqueur seul)", () => {
  const project = makeProject();
  const plugin = makePlugin(project);
  const view = new TestView(makeApp(project), plugin);

  // TFile unitaire : dragstart sur A, aucune multi-sélection.
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  const dtFile = fakeDataTransfer();
  rows["A"].fire("dragstart", { target: rows["A"], dataTransfer: dtFile, preventDefault() {}, stopPropagation() {} });

  assert.ok(dtFile.hasType("application/x-feuillets-binder"), "TFile single : marqueur privé posé");
  assert.ok(dtFile.getData("application/x-feuillets-binder"), "TFile single : valeur non vide");
  assert.ok(dtFile.hasType("text/plain"), "TFile single : text/plain Canvas préservé");
  assert.equal(dtFile.getData("text/plain"), project.a.path, "TFile single : text/plain = path historique");
  // Correctif « drag Binder/Recherche → vrai FileNode » (§4) : MIME privé
  // supplémentaire, lu par le drop Carnet — jamais posé pour un TFolder ni
  // une sélection multiple.
  assert.ok(dtFile.hasType("application/x-feuillets-file"), "TFile single : MIME FileNode posé");
  assert.equal(dtFile.getData("application/x-feuillets-file"), project.a.path, "TFile single : chemin vault exact");

  // TFolder unitaire : dragstart sur le dossier Chapitre 1, sibling de
  // Recherche sous Manuscrit.
  const manuscriptSiblings = project.manuscript.children;
  const folderScopeEl = new FakeElement();
  const folderRows = buildRows(view, project.manuscript, manuscriptSiblings, folderScopeEl);

  const dtFolder = fakeDataTransfer();
  folderRows["Chapitre 1"].fire("dragstart", { target: folderRows["Chapitre 1"], dataTransfer: dtFolder, preventDefault() {}, stopPropagation() {} });

  assert.ok(dtFolder.hasType("application/x-feuillets-binder"), "TFolder single : marqueur privé posé");
  assert.ok(dtFolder.getData("application/x-feuillets-binder"), "TFolder single : valeur non vide");
  assert.ok(!dtFolder.hasType("text/plain"), "TFolder single : pas de text/plain");
  assert.ok(!dtFolder.hasType("application/x-feuillets-file"), "TFolder single : jamais le MIME FileNode");
});

test("drag Binder — sélection multiple : jamais le MIME FileNode (comportement actuel intact)", () => {
  const project = makeProject();
  const plugin = makePlugin(project);
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  plugin._binderMultiSelect = new Set([project.a.path, project.c.path]);
  const dt = fakeDataTransfer();
  rows["C"].fire("dragstart", { target: rows["C"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });

  assert.ok(dt.hasType("application/x-feuillets-binder"), "marqueur Binder multi toujours posé (comportement inchangé)");
  assert.ok(!dt.hasType("application/x-feuillets-file"), "jamais le MIME FileNode pour une sélection multiple");
});

/* 12. toggleBinderReorderSelection (correctif final multi-drag, §3) : le
   helper réutilisé par le geste Option/Alt initialise `_binderMultiSelect`,
   toggle le path, déplace l'ancre, rafraîchit les classes — exactement ce
   que faisait la branche Cmd/Ctrl historique de handleMultiSelectClick. */
test("12 — toggleBinderReorderSelection : initialise, toggle, ancre, refresh", () => {
  const project = makeProject();
  const plugin = makePlugin(project);
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  buildRows(view, project.chapterFolder, siblings, scopeEl);

  assert.equal(plugin._binderMultiSelect, null, "pas de sélection avant le premier toggle");

  view.toggleBinderReorderSelection(project.b.path, project.chapterFolder.path, 1, scopeEl);
  assert.ok(plugin._binderMultiSelect.has(project.b.path), "B ajouté");
  assert.deepEqual(plugin._binderMultiSelectAnchor, { parentPath: project.chapterFolder.path, index: 1 });

  view.toggleBinderReorderSelection(project.b.path, project.chapterFolder.path, 1, scopeEl);
  assert.ok(!plugin._binderMultiSelect.has(project.b.path), "second toggle retire B");
});

/* 13. shouldPreventMultiSelectMousedown traite Option/Alt exactement comme
   Maj/Cmd/Ctrl : premier mousedown sur un fichier non encore sélectionné
   protégé, mousedown sur un membre déjà sélectionné laisse le dragstart
   natif s'amorcer (correctif §4). */
test("13 — shouldPreventMultiSelectMousedown : Option/Alt suit la même règle que Maj/Cmd/Ctrl", () => {
  const project = makeProject();
  const plugin = makePlugin(project);
  const view = new TestView(makeApp(project), plugin);

  assert.equal(view.shouldPreventMultiSelectMousedown({ shiftKey: false, ctrlKey: false, metaKey: false, altKey: true }, project.b.path, false), true, "premier Alt+mousedown sur B non sélectionné : protégé");

  plugin._binderMultiSelect = new Set([project.b.path]);
  assert.equal(view.shouldPreventMultiSelectMousedown({ shiftKey: false, ctrlKey: false, metaKey: false, altKey: true }, project.b.path, false), false, "Alt+mousedown sur B déjà sélectionné : laisse le dragstart natif démarrer");
});

/* 14. sélection contenant un TFolder → drag unitaire (contrat strict §5) */
test("14 — sélection B (TFile) + un dossier sibling → drag unitaire du feuillet réellement saisi", () => {
  const project = makeProject();
  const plugin = makePlugin(project);
  const view = new TestView(makeApp(project), plugin);

  // Un VRAI sibling TFolder de B (même parent, dans le même tableau
  // `siblings`) — sans quoi le batch retomberait de toute façon en single
  // simplement parce que le dossier n'apparaît pas dans `siblings`, sans
  // jamais exercer la vérification stricte "tous TFile" elle-même.
  const subFolder = new TFolder("Projet/Manuscrit/Chapitre 1/Sous-dossier");
  subFolder.parent = project.chapterFolder;
  project.chapterFolder.children = [...project.chapterFolder.children, subFolder];
  project.vault.allFiles.set(subFolder.path, subFolder);

  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  plugin._binderMultiSelect = new Set([project.b.path, subFolder.path]);

  const dt = fakeDataTransfer();
  rows["B"].fire("dragstart", { target: rows["B"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });

  assert.ok(!plugin.dragState.multi, "un TFolder sibling dans la sélection annule le batch");
  assert.equal(plugin.dragState.path, project.b.path);
});

/* 15. drop sur un membre du groupe qui produit réellement un nouvel ordre :
   pas de return prématuré parce que la cible appartient à la sélection
   (correctif §8) — B+D sélectionnés, drop APRÈS B (membre du groupe) doit
   quand même réordonner. */
test("15 — B+D sélectionnés, drop APRÈS B (membre du groupe) → réordonnancement réel, pas de no-op", () => {
  const project = makeProject();
  let applyCallCount = 0;
  const plugin = makePlugin(project, {
    applySiblingOrder: async (parent, order) => {
      applyCallCount++;
      project.chapterFolder.children = order;
    },
  });
  const view = new TestView(makeApp(project), plugin);
  const scopeEl = new FakeElement();
  const siblings = project.chapterFolder.children;
  const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.b, project.chapterFolder, 1, siblings, scopeEl);
  view.handleMultiSelectClick(clickEvt({ ctrlKey: true }), project.d, project.chapterFolder, 3, siblings, scopeEl);

  const dt = fakeDataTransfer();
  rows["D"].fire("dragstart", { target: rows["D"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });

  // Drop sur B lui-même, zone "après" (clientY > milieu).
  const dt2 = fakeDataTransfer();
  rows["B"].fire("dragover", { clientY: 20, dataTransfer: dt2, preventDefault() {} });
  rows["B"].fire("drop", { clientY: 20, dataTransfer: dt2, preventDefault() {} });

  assert.deepEqual(project.chapterFolder.children.map((f) => f.basename), ["A", "B", "D", "C", "E", "F"]);
  assert.equal(applyCallCount, 1, "un vrai changement d'ordre est appliqué, pas de return prématuré");
});

/* 16. régression drag SINGLE vers le bas (correctif §9/§15) : l'ancien
   `reordered.splice(effectiveIndex, 0, moved)` appliqué APRÈS un
   `splice(from, 1)` était décalé d'un cran quand on descend. */
test("16 — drag SINGLE B vers le bas : BEFORE D → A C B D E, AFTER D → A C D B E", () => {
  const project = makeProject();

  // BEFORE D
  {
    const plugin = makePlugin(project, {
      applySiblingOrder: async (parent, order) => { project.chapterFolder.children = order; },
    });
    project.chapterFolder.children = [project.a, project.b, project.c, project.d, project.e, project.f];
    const view = new TestView(makeApp(project), plugin);
    const scopeEl = new FakeElement();
    const siblings = project.chapterFolder.children;
    const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

    const dt = fakeDataTransfer();
    rows["B"].fire("dragstart", { target: rows["B"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });
    const dt2 = fakeDataTransfer();
    // Drop AVANT D (zone haute, clientY < milieu)
    rows["D"].fire("dragover", { clientY: 5, dataTransfer: dt2, preventDefault() {} });
    rows["D"].fire("drop", { clientY: 5, dataTransfer: dt2, preventDefault() {} });

    assert.deepEqual(project.chapterFolder.children.map((f) => f.basename), ["A", "C", "B", "D", "E", "F"]);
  }

  // AFTER D
  {
    project.chapterFolder.children = [project.a, project.b, project.c, project.d, project.e, project.f];
    const plugin = makePlugin(project, {
      applySiblingOrder: async (parent, order) => { project.chapterFolder.children = order; },
    });
    const view = new TestView(makeApp(project), plugin);
    const scopeEl = new FakeElement();
    const siblings = project.chapterFolder.children;
    const rows = buildRows(view, project.chapterFolder, siblings, scopeEl);

    const dt = fakeDataTransfer();
    rows["B"].fire("dragstart", { target: rows["B"], dataTransfer: dt, preventDefault() {}, stopPropagation() {} });
    const dt2 = fakeDataTransfer();
    // Drop APRÈS D (zone basse, clientY > milieu)
    rows["D"].fire("dragover", { clientY: 20, dataTransfer: dt2, preventDefault() {} });
    rows["D"].fire("drop", { clientY: 20, dataTransfer: dt2, preventDefault() {} });

    assert.deepEqual(project.chapterFolder.children.map((f) => f.basename), ["A", "C", "D", "B", "E", "F"]);
  }
});

/* ==========================================================================
   §11/§12 du correctif final multi-drag — tests via le VRAI
   `FeuilletsView.render()` et les vraies rows (pas un appel direct à
   handleMultiSelectClick). Harnais adapté de test/binder-continu-membership
   .test.js (même FakeElement enrichie, même fabrique de faux Continu) mais
   SANS stubber `attachDragHandlers` : on veut le vrai dragstart/dragover/
   drop natif déclenché par le rendu réel.
   ========================================================================== */

class RenderFakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = {};
    this.text = options.text ?? "";
    this.style = { setProperty() {} };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new RenderFakeElement(options);
    child.tag = tag;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  scrollIntoView() {}
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs[name] = value; }
  getAttr(name) { return this.attrs[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    const classNames = (selector.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    const attrNames = (selector.match(/\[[\w-]+\]/g) || []).map((a) => a.slice(1, -1));
    const matches = [];
    const walk = (el) => {
      for (const child of el.children) {
        const classOk = classNames.every((c) => child.classes.has(c));
        const attrOk = attrNames.every((a) => Object.prototype.hasOwnProperty.call(child.attrs, a));
        if (classOk && attrOk) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
  getBoundingClientRect() { return { top: 0, left: 0, height: 24, width: 200 }; }
  closest() { return null; }
}

function renderFixture() {
  const root = new TFolder("Roman/Manuscrit");
  const names = ["A", "B", "C", "D", "E", "F"];
  const files = names.map((n) => new TFile(`Roman/Manuscrit/${n}.md`));
  root.children = files;
  for (const f of files) f.parent = root;
  const byName = Object.fromEntries(names.map((n, i) => [n, files[i]]));
  return { root, files, byName };
}

function buildRenderView({ root, files }, { activeContinuView = null } = {}) {
  const allFiles = new Map();
  allFiles.set(root.path, root);
  for (const f of files) allFiles.set(f.path, f);

  const settings = {
    projectFolder: root.path,
    projects: [],
    projectMeta: {},
    binderLayout: "tree",
    binderCompact: false,
    binderTreeWidth: 240,
    collapsed: {},
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    binderSelectedPath: root.path,
  };
  const contentEl = new RenderFakeElement();
  const openedLeaf = { opened: [] };
  const leaf = { openFile: async (file) => { openedLeaf.opened.push(file.path); } };
  const applySiblingOrderCalls = [];
  const moveNodeCalls = [];
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => root.children,
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Roman",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    getLeafForOpeningFile: () => leaf,
    moveNode: async (...args) => { moveNodeCalls.push(args); },
    applySiblingOrder: async (parent, order) => {
      applySiblingOrderCalls.push(order.map((f) => f.basename));
      root.children = order;
    },
    renderAllViews: () => {},
  };
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: activeContinuView ?? {} };
  const view = new FeuilletsView(
    {
      app: {
        vault: { getAbstractFileByPath: (path) => allFiles.get(path) || null },
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
        workspace: {
          leftSplit: { name: "left" },
          rightSplit: { name: "right" },
          rootSplit,
          getLeavesOfType: () => [],
          getActiveViewOfType: (Type) => (Type === ScriveningsView ? activeContinuView : null),
          getMostRecentLeaf: (splitRoot) => (splitRoot === rootSplit ? workLeaf : null),
          setActiveLeaf: () => {},
          revealLeaf: async () => {},
        },
      },
      contentEl,
    },
    plugin
  );
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.updateActiveHighlight = () => {};
  // Volontairement PAS de `view.attachDragHandlers = () => {}` ici : ces
  // tests exercent le vrai dragstart/dragover/drop natif.
  return { view, contentEl, plugin, openedLeaf, applySiblingOrderCalls, moveNodeCalls };
}

/** Copié de test/binder-continu-membership.test.js (surface minimale exigée
 * par isContinuMembershipView) — dupliqué ici pour ne dépendre d'aucun
 * autre fichier de test. */
function fakeContinuView(projectRoot, members) {
  const set = new Set(members);
  const setMembersCalls = [];
  return {
    compileScope: { type: "selection", projectRoot, paths: [...set] },
    getViewType: () => VIEW_SCRIVENINGS,
    getMemberPaths: () => [...set],
    hasMember: (path) => set.has(path),
    toggleMember: async (path) => { set.has(path) ? set.delete(path) : set.add(path); return true; },
    collapseToSingleMember: async () => false,
    addMembers: async (paths) => { for (const path of paths) set.add(path); return true; },
    openScope: async () => true,
    openSingleMember: async () => true,
    setMembers: async (paths) => {
      const deduped = [...new Set(paths)];
      setMembersCalls.push(deduped);
      set.clear();
      for (const path of deduped) set.add(path);
      return true;
    },
    _setMembersCalls: setMembersCalls,
  };
}

function itemFor(contentEl, path) {
  return contentEl.querySelectorAll(".feuillets-item[data-path]").find((el) => el.getAttr("data-path") === path);
}

function realClick(el, modifiers = {}) {
  let prevented = false, stopped = false;
  el.events.get("click")({
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
    shiftKey: !!modifiers.shiftKey,
    ctrlKey: !!modifiers.ctrlKey,
    metaKey: !!modifiers.metaKey,
    altKey: !!modifiers.altKey,
  });
  return { prevented, stopped };
}

function realDragstart(el, dataTransfer) {
  const handler = el.events.get("dragstart");
  handler({ target: el, dataTransfer, preventDefault() {}, stopPropagation() {} });
}

function realDragAndDrop(el, dataTransfer, clientY) {
  el.events.get("dragover")({ clientY, dataTransfer, preventDefault() {} });
  el.events.get("drop")({ clientY, dataTransfer, preventDefault() {} });
}

/* 17. §11 — VRAI render() : Option/Alt+clic B, Option/Alt+clic C construit
   `_binderMultiSelect` (jamais Continu/promotion/ouverture Markdown), puis
   dragstart sur C entraîne le groupe, drop après E réordonne en un seul
   applySiblingOrder. */
test("17 — VRAI render() : Option/Alt+clic B puis C → sélection dédiée, drag groupé, drop après E → A D E B C F", async () => {
  const fixture = renderFixture();
  const { view, contentEl, plugin, openedLeaf, applySiblingOrderCalls, moveNodeCalls } = buildRenderView(fixture);
  await view.render(true);

  const itemB = itemFor(contentEl, fixture.byName.B.path);
  const itemC = itemFor(contentEl, fixture.byName.C.path);

  const c1 = realClick(itemB, { altKey: true });
  const c2 = realClick(itemC, { altKey: true });

  assert.equal(c1.prevented, true);
  assert.equal(c1.stopped, true);
  assert.equal(c2.prevented, true);
  assert.equal(c2.stopped, true);

  assert.deepEqual([...plugin._binderMultiSelect].sort(), [fixture.byName.B.path, fixture.byName.C.path].sort(), "_binderMultiSelect = {B, C}");
  assert.equal(itemB.classes.has("is-selected"), true);
  assert.equal(itemC.classes.has("is-selected"), true);
  assert.deepEqual(openedLeaf.opened, [], "aucune ouverture Markdown déclenchée par Option/Alt+clic");

  const dt = fakeDataTransfer();
  realDragstart(itemC, dt);
  assert.equal(plugin.dragState.multi, true);
  assert.deepEqual(plugin.dragState.items.map((it) => it.path), [fixture.byName.B.path, fixture.byName.C.path]);

  const itemE = itemFor(contentEl, fixture.byName.E.path);
  const dt2 = fakeDataTransfer();
  realDragAndDrop(itemE, dt2, 20); // zone "après"

  assert.deepEqual(fixture.root.children.map((f) => f.basename), ["A", "D", "E", "B", "C", "F"]);
  assert.equal(applySiblingOrderCalls.length, 1, "applySiblingOrder appelé une seule fois");
  assert.equal(moveNodeCalls.length, 0, "aucun moveNode pour un batch multi");
});

/* 18. §12 — Continu A+D déjà actif : Option/Alt+clic B puis C construit
   `_binderMultiSelect` = {B, C} SANS toucher à la composition Continu
   (aucun appel setMembers), puis le drag B+C après E réordonne le Binder —
   les deux états coexistent sans collision. */
test("18 — Continu A+D actif + Option/Alt+clic B,C : coexistence sans collision, puis drag B+C après E", async () => {
  const fixture = renderFixture();
  const continuView = fakeContinuView(fixture.root.path, [fixture.byName.A.path, fixture.byName.D.path]);
  const { view, contentEl, plugin, applySiblingOrderCalls, moveNodeCalls } = buildRenderView(fixture, { activeContinuView: continuView });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.byName.A.path);
  const itemD = itemFor(contentEl, fixture.byName.D.path);
  assert.equal(itemA.classes.has("is-continu-member"), true);
  assert.equal(itemD.classes.has("is-continu-member"), true);

  const itemB = itemFor(contentEl, fixture.byName.B.path);
  const itemC = itemFor(contentEl, fixture.byName.C.path);
  realClick(itemB, { altKey: true });
  realClick(itemC, { altKey: true });

  assert.deepEqual(continuView._setMembersCalls, [], "aucun appel setMembers lié à Option/Alt");
  assert.deepEqual(continuView.getMemberPaths().sort(), [fixture.byName.A.path, fixture.byName.D.path].sort(), "Continu reste exactement A+D");
  assert.deepEqual([...plugin._binderMultiSelect].sort(), [fixture.byName.B.path, fixture.byName.C.path].sort());
  assert.equal(itemB.classes.has("is-selected"), true);
  assert.equal(itemC.classes.has("is-selected"), true);
  // A+D conservent leur surbrillance Continu, inchangée par le geste Alt.
  assert.equal(itemA.classes.has("is-continu-member"), true);
  assert.equal(itemD.classes.has("is-continu-member"), true);

  const dt = fakeDataTransfer();
  realDragstart(itemC, dt);
  const itemE = itemFor(contentEl, fixture.byName.E.path);
  const dt2 = fakeDataTransfer();
  realDragAndDrop(itemE, dt2, 20);

  assert.deepEqual(fixture.root.children.map((f) => f.basename), ["A", "D", "E", "B", "C", "F"]);
  assert.equal(applySiblingOrderCalls.length, 1);
  assert.equal(moveNodeCalls.length, 0);
  assert.deepEqual(continuView.getMemberPaths().sort(), [fixture.byName.A.path, fixture.byName.D.path].sort(), "composition Continu toujours A+D après le drag Binder");
});
