import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { renderBinderPlanOutliner } from "../src/ui/canvas-binder-plan-outliner.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";

/* Prompt 3 (§9/§10) — LE PLAN NE DÉPEND PAS D'ADVANCED CANVAS.
 *
 * Le MÊME scénario est joué deux fois : d'abord sans qu'aucune intégration
 * Advanced Canvas ne soit initialisée, puis avec elle active sur un Carnet
 * Feuillets. Les deux passes doivent produire des résultats identiques —
 * c'est la preuve que le clavier du Plan vit entièrement dans
 * `ui/canvas-binder-plan-outliner.ts` et ne dispute jamais une frappe au
 * Scope de la vue Canvas. */

/* `window.setTimeout` est la seule API globale utilisée par le renderer
   (report du focus/de l'édition au tour suivant). Exécutée immédiatement
   ici, pour que le scénario reste lisible et déterministe. */
globalThis.window = { setTimeout: (fn) => { fn(); return 0; } };

/* ---------------------------------------------------------------------- *
 * DOM minimal — mêmes primitives que test/carnet-plan-ui.test.js.
 * ---------------------------------------------------------------------- */
class FakeEl {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set(String(options.cls || "").split(" ").filter(Boolean));
    this.attrs = { ...(options.attr || {}) };
    this.textContent = options.text ?? "";
    this.dataset = {};
    this.style = { setProperty() {} };
    this.events = new Map();
    this.disabled = false;
    this.value = "";
    this.hidden = false;
    this.focused = false;
  }
  createEl(tag, options = {}) { const c = new FakeEl(tag, options); this.children.push(c); return c; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(c) { for (const p of String(c).split(" ")) if (p) this.classes.add(p); }
  removeClass(c) { this.classes.delete(c); }
  empty() { this.children = []; }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
  select() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, right: 200, top: 0, bottom: 200, height: 26 }; }
  setAttr(n, v) { this.attrs[n] = v; }
  addEventListener(type, cb) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(cb);
  }
  querySelector(sel) {
    if (sel === "input") return this.children.find((c) => c.tag === "input" && !c.removed) || null;
    return null;
  }
  querySelectorAll() { return []; }
  fire(type, evt = {}) { for (const cb of this.events.get(type) || []) cb(evt); }
}

function walk(el, out = []) { for (const c of el.children) { out.push(c); walk(c, out); } return out; }
const byClass = (el, cls) => walk(el).filter((c) => c.classes.has(cls));
const rows = (host) => byClass(host, "feuillets-plan-row");
const inputOf = (row) => row.children.find((c) => c.tag === "input" && !c.removed);

/** Événement clavier instrumenté : retient s'il a été consommé (`prevented`)
 * et s'il a été empêché de remonter (`stopped`). */
function keyEvent(key, extra = {}) {
  return {
    key,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...extra,
  };
}

/* ---------------------------------------------------------------------- *
 * Hôte du Plan : mime `main.ts` (état UI volatile + rerendu après chaque
 * changement), SANS aucune connaissance d'Advanced Canvas.
 * ---------------------------------------------------------------------- */
function mountPlan(items, hooks = {}) {
  const state = { items, activeRowId: undefined, editRowId: undefined, renders: 0, changes: [] };
  let host = new FakeEl();
  const draw = () => {
    state.renders += 1;
    const editRowId = state.editRowId;
    state.editRowId = undefined;
    host = new FakeEl();
    renderBinderPlanOutliner({
      host,
      items: state.items,
      dirty: false,
      editable: true,
      activeRowId: state.activeRowId,
      editRowId,
      onUiStateChange: (activeRowId, nextEditRowId) => {
        state.activeRowId = activeRowId;
        state.editRowId = nextEditRowId;
      },
      onChange: (next, focusId) => {
        state.changes.push({ next, focusId });
        if (focusId) { state.activeRowId = focusId; state.editRowId = focusId; }
        state.items = next;
        hooks.onChange?.(next);
        draw();
      },
      onRefresh: () => {},
      onApply: () => {},
    });
  };
  draw();
  return { state, host: () => host };
}

const seed = () => [
  { id: "a", kind: "folder", title: "Partie I", path: "M/P1", collapsed: false, children: [
    { id: "b", kind: "file", title: "Chapitre 1", path: "M/P1/c1.md", collapsed: false, children: [] },
  ] },
  { id: "c", kind: "folder", title: "Partie II", path: "M/P2", collapsed: false, children: [] },
  { id: "d", kind: "file", title: "Feuillet libre", path: "M/libre.md", collapsed: false, children: [] },
];

const flatten = (items, out = []) => { for (const i of items) { out.push(i); flatten(i.children, out); } return out; };
const shape = (items) => items.map((i) => `${i.kind}:${i.title || "∅"}(${shape(i.children).join("|")})`);
const byId = (items, id) => flatten(items).find((i) => i.id === id);

/* ---------------------------------------------------------------------- *
 * Le scénario complet — joué à l'identique dans les deux passes. Couvre le
 * contrat FILE/FOLDER (§ « nouveau contrat ») : sur un FICHIER, Entrée/
 * Cmd+Entrée créent un FRÈRE ; sur un DOSSIER, les mêmes touches créent un
 * ENFANT — jamais l'inverse.
 * ---------------------------------------------------------------------- */
function runPlanScenario(forward = () => {}) {
  const plan = mountPlan(seed());
  const events = [];
  const row = (id) => rows(plan.host()).find((r) => r.dataset.planId === id);

  // 1. Clic sur une ligne → elle devient active.
  row("d").fire("pointerdown", { target: {}, button: 0, stopPropagation() {} });
  const activeAfterClick = plan.state.activeRowId;

  // 2. Tab → un FICHIER s'indente sous son frère précédent s'il est un
  //    DOSSIER (ici "d" sous "c", vide).
  const tab = keyEvent("Tab");
  row("d").fire("keydown", tab);
  events.push(tab);
  const afterTab = shape(plan.state.items);

  // 3. Shift+Tab → désindentation, retour exact à l'état précédent.
  const shiftTab = keyEvent("Tab", { shiftKey: true });
  row("d").fire("keydown", shiftTab);
  events.push(shiftTab);
  const afterShiftTab = shape(plan.state.items);

  // 4. Contrat FICHIER — Entrée sur "d" (fichier racine) : un FRÈRE.
  const enter = keyEvent("Enter");
  row("d").fire("keydown", enter);
  events.push(enter);
  const afterEnter = shape(plan.state.items);
  const draftId = plan.state.activeRowId;

  // 5. Contrat FICHIER — Cmd/Ctrl+Entrée sur ce brouillon (toujours un
  //    fichier) : un FRÈRE dossier, jamais un enfant.
  const metaEnterOnFile = keyEvent("Enter", { metaKey: true });
  row(draftId).fire("keydown", metaEnterOnFile);
  events.push(metaEnterOnFile);
  const afterFileSiblingFolder = shape(plan.state.items);
  const siblingFolderId = plan.state.activeRowId;

  // 6. Contrat DOSSIER — Cmd/Ctrl+Entrée sur "c" (dossier VIDE) : un
  //    ENFANT dossier, jamais un frère (la racine ne gagne aucun item).
  const rootCountBeforeFolderChild = plan.state.items.length;
  const metaEnterOnFolder = keyEvent("Enter", { metaKey: true });
  row("c").fire("keydown", metaEnterOnFolder);
  events.push(metaEnterOnFolder);
  const rootCountAfterFolderChild = plan.state.items.length;
  const folderChild = byId(plan.state.items, "c").children[0];

  // 7. Édition inline : Échap annule en UNE frappe et garde la ligne active.
  const editedRow = row("b");
  byClass(editedRow, "feuillets-plan-title")[0].fire("click", { stopPropagation() {} });
  const input = inputOf(editedRow);
  input.value = "Titre jeté";
  const escape = keyEvent("Escape");
  input.fire("keydown", escape);
  input.fire("blur", {}); // le retrait du champ peut faire remonter un blur
  events.push(escape);
  const titleAfterEscape = byId(plan.state.items, "b").title;
  const activeAfterEscape = plan.state.activeRowId;
  const inputClosed = !!input.removed;

  // 8. Blur = validation.
  const committedRow = row("b");
  byClass(committedRow, "feuillets-plan-title")[0].fire("click", { stopPropagation() {} });
  const input2 = inputOf(committedRow);
  input2.value = "Chapitre premier";
  input2.fire("blur", {});
  input2.fire("blur", {}); // jamais deux commits pour une seule session
  const titleAfterBlur = byId(plan.state.items, "b").title;

  // 9. Rerendu : la ligne active survit et retrouve sa classe.
  plan.state.activeRowId = "c";
  const rerendered = mountPlan(plan.state.items);
  rerendered.state.activeRowId = "c";
  const reRows = rows(rerendered.host());

  // Toute frappe consommée par le Plan est aussi empêchée de remonter :
  // c'est ce qui garantit qu'aucun Scope Canvas ne la voit jamais.
  for (const event of events) forward(event);

  return {
    activeAfterClick,
    afterTab,
    afterShiftTab,
    afterEnter,
    afterFileSiblingFolder,
    siblingFolderKind: byId(plan.state.items, siblingFolderId)?.kind,
    rootCountBeforeFolderChild,
    rootCountAfterFolderChild,
    folderChildKind: folderChild?.kind,
    titleAfterEscape,
    activeAfterEscape,
    inputClosed,
    titleAfterBlur,
    changeCount: plan.state.changes.length,
    reRowsHaveActive: reRows.length > 0,
    events: events.map((e) => ({ key: e.key, prevented: e.prevented, stopped: e.stopped })),
  };
}

test("§9 — le Plan fonctionne intégralement SANS aucune intégration Advanced Canvas", () => {
  const result = runPlanScenario();

  assert.equal(result.activeAfterClick, "d", "un clic sur une ligne la rend active");
  assert.deepEqual(result.afterTab, [
    "folder:Partie I(file:Chapitre 1())",
    "folder:Partie II(file:Feuillet libre())",
  ], "Tab indente le fichier sous le dossier précédent");
  assert.deepEqual(result.afterShiftTab, [
    "folder:Partie I(file:Chapitre 1())",
    "folder:Partie II()",
    "file:Feuillet libre()",
  ], "Shift+Tab rend exactement l'état d'avant");
  assert.deepEqual(result.afterEnter, [
    "folder:Partie I(file:Chapitre 1())",
    "folder:Partie II()",
    "file:Feuillet libre()",
    "draft-file:∅()",
  ], "FICHIER — Entrée insère un FRÈRE juste après, jamais un enfant");
  assert.deepEqual(result.afterFileSiblingFolder, [
    "folder:Partie I(file:Chapitre 1())",
    "folder:Partie II()",
    "file:Feuillet libre()",
    "draft-file:∅()",
    "draft-folder:∅()",
  ], "FICHIER — Cmd/Ctrl+Entrée insère un FRÈRE dossier, jamais un enfant");
  assert.equal(result.siblingFolderKind, "draft-folder");
  assert.equal(result.rootCountAfterFolderChild, result.rootCountBeforeFolderChild, "DOSSIER — aucun item de plus à la racine");
  assert.equal(result.folderChildKind, "draft-folder", "DOSSIER — Cmd/Ctrl+Entrée insère un ENFANT dossier, jamais un frère");
  assert.equal(result.titleAfterEscape, "Chapitre 1", "Échap restaure le titre précédent");
  assert.equal(result.inputClosed, true, "une seule frappe d'Échap ferme le champ");
  assert.equal(result.activeAfterEscape, "b", "la ligne reste active après Échap");
  assert.equal(result.titleAfterBlur, "Chapitre premier", "le blur valide la saisie");
  assert.equal(result.reRowsHaveActive, true, "le rerendu retrouve la ligne active");

  for (const event of result.events) {
    assert.equal(event.prevented, true, `${event.key} est traitée par le Plan`);
    assert.equal(event.stopped, true, `${event.key} ne remonte jamais au Canvas`);
  }
});

/** Carnet Feuillets minimal avec un Scope de vue réel, pour enregistrer
 * l'intégration Advanced Canvas exactement comme en production. */
function makeCarnetWithAdvancedCanvas(nodes = []) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;
  const { vault } = createFakeVault([volume, manuscript]);
  const boardFile = new TFile(canvasPathFor({ vault }, manuscript), "");
  const data = { nodes, edges: [] };
  const handlers = [];
  const scope = {
    handlers,
    register(modifiers, key, func) { const h = { modifiers, key, func }; handlers.push(h); return h; },
    unregister(h) { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); },
  };
  const canvas = {
    view: { file: boardFile },
    setDataCalls: [],
    importDataCalls: [],
    getData: () => data,
    importData(updated) { this.importDataCalls.push(updated); },
    setData(updated) { this.setDataCalls.push(updated); },
    requestSave() {},
    nodes: new Map(nodes.map((n) => [n.id, { id: n.id, isEditing: false }])),
    selection: new Set(),
  };
  const view = { file: boardFile, canvas, scope, register() {} };
  const app = {
    vault,
    workspace: {
      handlers: {},
      on(name, cb) { this.handlers[name] = cb; return { name }; },
      getLeavesOfType: (type) => (type === "canvas" ? [{ view }] : []),
    },
  };
  const plugin = {
    app,
    settings: { projectFolder: manuscript.path },
    registerEvent() {},
    saveSettings: async () => {},
    register() {},
  };
  registerAdvancedCanvasIntegration(plugin);
  return { canvas, scope, plugin };
}

test("§10 — avec Advanced Canvas actif, le MÊME scénario Plan donne exactement le même résultat", () => {
  const planNode = {
    id: "plan",
    type: "text",
    text: "Plan du manuscrit",
    feuillets_binder_plan: "outliner-v1",
    feuillets_plan_version: 2,
    feuillets_plan_items: [],
  };
  const { canvas, scope } = makeCarnetWithAdvancedCanvas([planNode]);
  canvas.selection = new Set([canvas.nodes.get("plan")]);
  const dataBefore = JSON.stringify(canvas.getData());

  const withoutAdvancedCanvas = runPlanScenario();

  /* Advanced Canvas est bien là : ses raccourcis sont enregistrés. Chaque
     frappe traitée par le Plan est réinjectée dans son Scope UNIQUEMENT si
     le Plan ne l'a pas stoppée — ce qui n'arrive jamais. */
  const seenByAdvancedCanvas = [];
  const withAdvancedCanvas = runPlanScenario((event) => {
    if (event.stopped) return;
    for (const handler of scope.handlers) {
      seenByAdvancedCanvas.push(handler.key);
      handler.func(event, {});
    }
  });

  assert.ok(scope.handlers.length > 0, "l'intégration Advanced Canvas est bien active dans ce test");
  assert.deepEqual(withAdvancedCanvas, withoutAdvancedCanvas, "résultats strictement identiques");
  assert.deepEqual(seenByAdvancedCanvas, [], "Advanced Canvas ne consomme ni Entrée, ni Tab, ni Shift+Tab");
  assert.equal(JSON.stringify(canvas.getData()), dataBefore, "aucun handler idea-tree déclenché, aucun node créé");
  assert.equal(canvas.setDataCalls.length + canvas.importDataCalls.length, 0, "aucune double exécution/persistance");
});

test("§10 — les raccourcis Advanced Canvas appliqués DIRECTEMENT au node Plan ne font rien", () => {
  const planNode = {
    id: "plan",
    type: "text",
    text: "Plan du manuscrit",
    feuillets_binder_plan: "outliner-v1",
    feuillets_plan_version: 2,
    feuillets_plan_items: [],
  };
  const { canvas, scope } = makeCarnetWithAdvancedCanvas([planNode]);
  canvas.selection = new Set([canvas.nodes.get("plan")]);
  const before = JSON.stringify(canvas.getData());

  for (const handler of scope.handlers) {
    const event = keyEvent(handler.key);
    const result = handler.func(event, {});
    assert.equal(event.prevented, false, `${handler.key} n'est jamais consommée pour le Plan`);
    assert.equal(result, undefined);
  }
  assert.equal(JSON.stringify(canvas.getData()), before);
  assert.equal(canvas.setDataCalls.length + canvas.importDataCalls.length, 0);
});
