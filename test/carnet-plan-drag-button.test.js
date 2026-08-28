import test from "node:test";
import assert from "node:assert/strict";
import { renderBinderPlanOutliner } from "../src/ui/canvas-binder-plan-outliner.js";

/* Correctif Prompt 3 (ajout) — le clic droit sur une ligne du Plan ne doit
 * JAMAIS armer un drag. Avant ce correctif, le handler `pointerdown` qui
 * initialise `drag` ne vérifiait pas `event.button` : un clic droit suivi
 * d'un léger mouvement de souris (courant juste avant l'ouverture d'un
 * menu contextuel) déclenchait donc le mode drag interne du Plan. */

globalThis.window = { setTimeout: (fn) => { fn(); return 0; } };

/* ---------------------------------------------------------------------- *
 * DOM minimal, avec un querySelector/querySelectorAll qui comprend
 * réellement les deux formes utilisées par l'outliner :
 *   - une liste de sélecteurs de classe séparés par des virgules
 *     (`clearDropMarks`) ;
 *   - une classe combinée à `[data-plan-id="…"]` (marquage `is-dragging`).
 * Sans ce câblage réel, `updateDropTarget`/`clearDropMarks` ne trouvent
 * jamais rien et le cycle de drag ne peut pas être vérifié de bout en bout.
 * ---------------------------------------------------------------------- */
function matchesSimpleSelector(el, selector) {
  const m = selector.match(/^\.([a-zA-Z0-9-]+)(?:\[data-plan-id="([^"]*)"\])?$/);
  if (!m) return false;
  const [, cls, planId] = m;
  if (!el.classes.has(cls)) return false;
  if (planId !== undefined && el.dataset.planId !== planId) return false;
  return true;
}
function queryAll(root, selector) {
  const parts = selector.split(",").map((s) => s.trim());
  const out = [];
  const visit = (el) => {
    for (const c of el.children) {
      if (parts.some((p) => matchesSimpleSelector(c, p))) out.push(c);
      visit(c);
    }
  };
  visit(root);
  return out;
}

class FakeEl {
  constructor(tag = "div", options = {}, rect = { left: 0, right: 200, top: 0, bottom: 200, height: 26 }) {
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
    this.rect = rect;
    this.pointerCaptures = [];
    this.scrollTop = 0;
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
  focus() {}
  select() {}
  setPointerCapture(id) { this.pointerCaptures.push(id); }
  getBoundingClientRect() { return this.rect; }
  setAttr(n, v) { this.attrs[n] = v; }
  addEventListener(type, cb, options) {
    if (!this.events.has(type)) this.events.set(type, []);
    const capture = typeof options === "object" && options !== null ? !!options.capture : !!options;
    this.events.get(type).push({ cb, capture });
  }
  /** Listeners CAPTURE d'un type — pour appeler directement, sans dépendre
   * d'une simulation de propagation DOM réelle (ce faux DOM ne propage pas
   * entre éléments, voir `fire`). */
  captureListenersFor(type) {
    return (this.events.get(type) || []).filter((entry) => entry.capture).map((entry) => entry.cb);
  }
  querySelector(selector) {
    if (selector === "input") return this.children.find((c) => c.tag === "input" && !c.removed) || null;
    return queryAll(this, selector)[0] || null;
  }
  querySelectorAll(selector) { return queryAll(this, selector); }
  fire(type, evt = {}) { for (const { cb } of this.events.get(type) || []) cb(evt); }
}

function walk(el, out = []) { for (const c of el.children) { out.push(c); walk(c, out); } return out; }
const byClass = (el, cls) => walk(el).filter((c) => c.classes.has(cls));

function keyish(extra = {}) {
  return { stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...extra };
}

/** Deux feuillets au premier niveau, ni l'un ni l'autre ne peut accueillir
 * d'enfant (`kind: "file"`) — le drop se résout donc toujours en
 * `before`/`after`, jamais `inside`, ce qui rend le résultat déterministe
 * indépendamment de la précision géométrique de ce faux DOM. */
function renderTwoFiles(overrides = {}) {
  const items = [
    { id: "x", kind: "file", title: "X", children: [] },
    { id: "y", kind: "file", title: "Y", children: [] },
  ];
  const host = new FakeEl();
  const changes = [];
  renderBinderPlanOutliner({
    host,
    items,
    dirty: false,
    editable: true,
    onChange: (next, focusId) => changes.push({ next, focusId }),
    onRefresh: () => {},
    onApply: () => {},
    ...overrides,
  });
  const tree = byClass(host, "feuillets-plan-tree-scroll")[0];
  const rowX = byClass(host, "feuillets-plan-row").find((r) => r.dataset.planId === "x");
  const rowY = byClass(host, "feuillets-plan-row").find((r) => r.dataset.planId === "y");
  return { host, tree, rowX, rowY, changes, items };
}

/** Cycle complet : pointerdown sur X (bouton donné), mouvement au-delà du
 * seuil vers Y, relâchement sur Y. Retourne ce qui a été observé.
 *
 * `dropMarked` (classe `drop-after` posée sur Y, la cible) est le signal le
 * plus fiable qu'un drag est bien ACTIF pendant le mouvement : la marque
 * `is-dragging` posée sur la ligne SOURCE est, elle, effacée dans la même
 * frappe par `clearDropMarks()` (comportement déjà existant, hors périmètre
 * de ce correctif) — l'utiliser rendrait ce test fragile sans rien prouver
 * de plus sur le bouton. */
function runDragCycle(button) {
  const { tree, rowX, rowY, changes } = renderTwoFiles();
  rowX.fire("pointerdown", { button, target: {}, clientX: 0, clientY: 0, stopPropagation() { this.stopped = true; } });
  tree.fire("pointermove", { clientX: 0, clientY: 50 });
  const dropMarked = rowY.classes.has("drop-after");
  tree.fire("pointerup", { clientX: 0, clientY: 50, stopPropagation() { this.stopped = true; } });
  return { dropMarked, pointerCaptured: tree.pointerCaptures.length > 0, changes };
}

test("§1 — pointerdown bouton principal (0) arme une intention de drag", () => {
  const result = runDragCycle(0);
  assert.equal(result.dropMarked, true, "une cible de dépôt est résolue pendant le mouvement");
  assert.equal(result.pointerCaptured, true, "le pointeur est capturé au-delà du seuil");
  assert.equal(result.changes.length, 1, "le relâchement sur Y déclenche une réorganisation");
  assert.equal(result.changes[0].next.map((i) => i.id).join(""), "yx", "X est bien déplacé après Y");
});

test("§1 — pointerdown bouton droit (2) n'arme AUCUNE intention de drag", () => {
  const result = runDragCycle(2);
  assert.equal(result.dropMarked, false, "aucune cible de dépôt résolue, même après le mouvement");
  assert.equal(result.pointerCaptured, false, "aucune capture de pointeur");
  assert.equal(result.changes.length, 0, "aucune réorganisation : movePlanBranch n'est jamais appelée");
});

test("§1 — pointerdown bouton milieu (1) n'arme AUCUNE intention de drag", () => {
  const result = runDragCycle(1);
  assert.equal(result.dropMarked, false);
  assert.equal(result.pointerCaptured, false);
  assert.equal(result.changes.length, 0);
});

test("§3 — le pointerdown secondaire (bouton ≠ 0) stoppe sa propagation, mais ne prévient jamais son défaut", () => {
  const { rowX } = renderTwoFiles();
  const pointerdown = keyish({ button: 2, target: {}, clientX: 0, clientY: 0 });
  rowX.fire("pointerdown", pointerdown);
  // Correctif clic droit : la propagation EST stoppée (empêche le node
  // Canvas entier de recevoir ce pointerdown et de s'y accrocher pour un
  // déplacement) — `stopPropagation` n'affecte jamais le `contextmenu`,
  // un événement séparé émis indépendamment au relâchement du bouton.
  assert.equal(pointerdown.stopped, true, "la propagation du pointerdown secondaire est stoppée");
  assert.equal(pointerdown.prevented, undefined, "jamais de preventDefault : le contextmenu natif reste intact");
});

test("§2 — clic droit sur une ligne ouvre le Menu Plan (jamais un menu Canvas), sans preventDefault manquant", () => {
  const { rowX } = renderTwoFiles();
  const contextmenu = keyish({});
  rowX.fire("contextmenu", contextmenu);
  assert.equal(contextmenu.prevented, true);
  assert.equal(contextmenu.stopped, true);
});

test("§2 — contextmenu nettoie explicitement tout état de drag résiduel (armé mais non relâché)", () => {
  const { tree, rowX, rowY, changes } = renderTwoFiles();
  // Bouton principal : le drag s'arme et devient actif (mouvement > seuil),
  // une cible de dépôt est résolue sur Y.
  rowX.fire("pointerdown", { button: 0, target: {}, clientX: 0, clientY: 0, stopPropagation() {} });
  tree.fire("pointermove", { clientX: 0, clientY: 50 });
  assert.equal(rowY.classes.has("drop-after"), true, "précondition : le drag est bien actif avant le clic droit");

  rowX.fire("contextmenu", keyish({}));
  assert.equal(rowY.classes.has("drop-after"), false, "le menu contextuel retire la marque de cible de dépôt");
  assert.equal(rowX.classes.has("is-dragging"), false, "et toute marque résiduelle sur la ligne source");

  // Un relâchement qui survient malgré tout après le clic droit ne doit
  // JAMAIS terminer un drag déjà annulé par le menu contextuel.
  tree.fire("pointerup", { clientX: 0, clientY: 50, stopPropagation() {} });
  assert.equal(changes.length, 0, "aucun movePlanBranch : le clic droit avait déjà tout annulé");
});

test("§2 — clic droit + mouvement > seuil : zéro drag, zéro réorganisation", () => {
  const { tree, rowX, rowY, changes } = renderTwoFiles();
  rowX.fire("pointerdown", { button: 2, target: {}, clientX: 0, clientY: 0, stopPropagation() {} });
  tree.fire("pointermove", { clientX: 0, clientY: 80 });
  tree.fire("pointerup", { clientX: 0, clientY: 80, stopPropagation() {} });
  assert.equal(rowY.classes.has("drop-after"), false);
  assert.equal(rowX.classes.has("is-dragging"), false);
  assert.equal(changes.length, 0);
});

test("§4 — bouton gauche : un simple clic sans mouvement ne déclenche aucun drag", () => {
  const { tree, rowX, rowY, changes } = renderTwoFiles();
  rowX.fire("pointerdown", { button: 0, target: {}, clientX: 0, clientY: 0, stopPropagation() {} });
  tree.fire("pointerup", { clientX: 0, clientY: 0, stopPropagation() {} });
  assert.equal(rowX.classes.has("is-dragging"), false, "jamais de drag sans dépasser le seuil de 4px");
  assert.equal(rowY.classes.has("drop-after"), false, "aucune cible résolue : le seuil n'a jamais été franchi");
  assert.equal(changes.length, 0);
});

test("§4 — bouton gauche : un mouvement au-delà du seuil déclenche toujours le drag (comportement inchangé)", () => {
  const result = runDragCycle(0);
  assert.equal(result.dropMarked, true);
  assert.equal(result.pointerCaptured, true);
});

/* ---------------------------------------------------------------------- *
 * Correctif clic droit + Apply — écouteurs CAPTURE sur `tree` et boutons
 * du header (Prompt 3, correctif « clic droit + Apply Plan→Binder »).
 * ---------------------------------------------------------------------- */

test("tree — un pointerdown/mousedown SECONDAIRE est stoppé en phase CAPTURE, avant toute ligne", () => {
  const { tree } = renderTwoFiles();
  for (const type of ["pointerdown", "mousedown"]) {
    const [captureListener] = tree.captureListenersFor(type);
    assert.ok(captureListener, `un écouteur ${type} capture existe sur tree`);
    const evt = keyish({ button: 2 });
    captureListener(evt);
    assert.equal(evt.stopped, true, `${type} secondaire stoppé en capture`);
    assert.equal(evt.prevented, undefined, `${type} : jamais de preventDefault`);
  }
});

test("tree — le bouton principal (0) n'est jamais stoppé par les écouteurs CAPTURE", () => {
  const { tree } = renderTwoFiles();
  for (const type of ["pointerdown", "mousedown"]) {
    const [captureListener] = tree.captureListenersFor(type);
    const evt = keyish({ button: 0 });
    captureListener(evt);
    assert.equal(evt.stopped, undefined, `${type} principal : rien n'est stoppé en capture (laissé au reste du câblage)`);
  }
});

/** Bouton du header par son libellé `aria-label` — mêmes libellés que
 * `renderBinderPlanOutliner` (t("plan.action.…")). */
function headerButton(host, label) {
  return walk(host).find((c) => c.tag === "button" && c.attrs["aria-label"] === label);
}

test("§2 — chaque bouton du header stoppe pointerdown/mousedown/click/dblclick, sans preventDefault global", () => {
  const { host } = renderTwoFiles({ dirty: true });
  for (const label of ["Ajouter", "Actualiser depuis le Binder", "Appliquer au Binder"]) {
    const button = headerButton(host, label);
    assert.ok(button, `le bouton « ${label} » existe`);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) {
      const evt = keyish({});
      button.fire(type, evt);
      assert.equal(evt.stopped, true, `${label} : ${type} stoppé`);
      assert.equal(evt.prevented, undefined, `${label} : ${type} — jamais de preventDefault`);
    }
  }
});

test("§2 — le clic sur ✓ appelle onApply() exactement une fois", () => {
  let applyCalls = 0;
  const { host } = renderTwoFiles({ dirty: true, onApply: () => { applyCalls += 1; } });
  const apply = headerButton(host, "Appliquer au Binder");
  assert.equal(apply.disabled, false, "actionnable : le Plan est dirty");
  apply.fire("click", keyish({}));
  assert.equal(applyCalls, 1, "onApply() appelé exactement une fois");
  apply.fire("click", keyish({}));
  assert.equal(applyCalls, 2, "un second clic redéclenche un second appel (pas de déduplication implicite)");
});

test("§2 — ✓ désactivé quand le Plan n'est pas dirty : le clic n'appelle jamais onApply()", () => {
  let applyCalls = 0;
  const { host } = renderTwoFiles({ dirty: false, onApply: () => { applyCalls += 1; } });
  const apply = headerButton(host, "Appliquer au Binder");
  assert.equal(apply.disabled, true);
  apply.fire("click", keyish({}));
  assert.equal(applyCalls, 0, "un bouton désactivé n'appelle jamais l'action (garde `if (!button.disabled)`)");
});
