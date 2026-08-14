import test from "node:test";
import assert from "node:assert/strict";
import { editorInfoField } from "obsidian";
import { WidgetType } from "@codemirror/view";
import {
  ComparisonActionsWidget, ComparisonLabelWidget,
  applyComparisonDecorations, clearComparisonDecorations, comparisonClickExtension,
  comparisonDecorationField, comparisonDecorationRanges, comparisonEditorCmView, comparisonReadOnlyField,
  onComparisonClick, setComparisonDecorationsEffect, setComparisonReadOnly, setComparisonReadOnlyEffect,
} from "../src/utils/cm-comparison-decorations.js";

test("décorations : elles sont temporaires, jamais persistées dans le document", () => {
  const dispatched = [];
  const view = { state: { doc: { length: 40 } }, dispatch: (spec) => dispatched.push(spec.effects) };
  applyComparisonDecorations(view, [{ type: "mark", from: 3, to: 10, class: "cm-comparison-deleted", role: "change", index: 0 }]);
  clearComparisonDecorations(view);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[0].value.length, 1);
  assert.ok(dispatched[1].value.none, "l'effacement est explicite, jamais un simple oubli");
  const unrelated = { is: () => false, value: [] };
  assert.doesNotThrow(() => comparisonDecorationField.update({ map: () => [] }, { docChanged: false, changes: null, effects: [unrelated] }));
  assert.deepEqual(comparisonDecorationField.update([], { docChanged: false, changes: null, effects: [{ is: (type) => type === setComparisonDecorationsEffect, value: ["next"] }] }), ["next"]);
});

test("décorations : une position hors texte n'est jamais inventée", () => {
  const ranges = comparisonDecorationRanges([
    { type: "mark", from: 5, to: 99, class: "x", role: "change", index: 0 },
    { type: "mark", from: -1, to: 3, class: "x", role: "change", index: 1 },
    { type: "mark", from: 8, to: 3, class: "x", role: "change", index: 2 },
    { type: "label", at: 99, side: 1, class: "l", text: "z", index: 3 },
  ], 10);
  assert.deepEqual(ranges, []);
});

test("décorations : chaque type porte de quoi être cliqué, changement ou note", () => {
  const ranges = comparisonDecorationRanges([
    { type: "mark", from: 0, to: 2, class: "a", role: "change", index: 4 },
    { type: "mark", from: 3, to: 5, class: "b", role: "note", index: 7 },
    { type: "label", at: 6, side: 1, class: "cm-comparison-move-label", text: "Déplacé 1 ↓", index: 4 },
  ], 10);
  assert.deepEqual(ranges[0].attributes, { "data-comparison-change": "4" });
  assert.deepEqual(ranges[1].attributes, { "data-comparison-note": "7" });
  assert.equal(ranges[2].widget.text, "Déplacé 1 ↓", "le libellé relie les deux emplacements, sans copier le texte déplacé");
});

test("décorations : les widgets se redessinent quand leur état change, jamais figés", () => {
  const label = new ComparisonLabelWidget(2, "cm-comparison-move-label", "Déplacé ↓");
  assert.ok(label instanceof WidgetType);
  assert.equal(label.eq(new ComparisonLabelWidget(2, "cm-comparison-move-label", "Déplacé ↓")), true);
  assert.equal(label.eq(new ComparisonLabelWidget(2, "cm-comparison-move-label is-active", "Déplacé ↓")), false);
  const spec = { type: "actions", at: 3, index: 0, label: "Ajout", hint: null, buttons: [] };
  assert.equal(new ComparisonActionsWidget(spec).eq(new ComparisonActionsWidget({ ...spec })), true);
  assert.equal(new ComparisonActionsWidget(spec).eq(new ComparisonActionsWidget({ ...spec, label: "Suppression" })), false);
});

test("lecture seule : le verrou est porté par l'état de CETTE vue, et se relève", () => {
  const dispatched = [];
  const view = { state: { doc: { length: 3 } }, dispatch: (spec) => dispatched.push(spec.effects) };
  setComparisonReadOnly(view, true);
  setComparisonReadOnly(view, false);
  assert.deepEqual(dispatched.map((effect) => effect.value), [true, false]);
  assert.equal(comparisonReadOnlyField.create(), false, "aucun autre éditeur du coffre n'est touché");
  assert.equal(comparisonReadOnlyField.update(false, { docChanged: false, changes: null, effects: [{ is: (type) => type === setComparisonReadOnlyEffect, value: true }] }), true);
  const provided = comparisonReadOnlyField.provide("field");
  assert.deepEqual(provided.map((facet) => facet.facet), ["readOnly", "editable"], "l'état ET l'édition DOM sont verrouillés");
  assert.equal(provided[1].get(true), false, "verrouillé ⇒ non éditable");
});

test("accès à la vue CM6 : jamais deviné quand il est absent", () => {
  assert.equal(comparisonEditorCmView(null), null);
  assert.equal(comparisonEditorCmView({}), null);
  const cm = { dispatch() {} };
  assert.equal(comparisonEditorCmView({ cm }), cm);
});

/* `comparisonClickExtension` distingue `event.target instanceof HTMLElement`
   avant d'appeler `.closest()`, comme les autres extensions CodeMirror de ce
   plugin — absent en Node, fourni ici comme ailleurs. */
class FakeHTMLElement {
  constructor(attrs = {}) { this.attrs = attrs; }
  closest(selector) {
    const names = [...selector.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
    return names.some((name) => name in this.attrs) ? this : null;
  }
  getAttribute(name) { return this.attrs[name] ?? null; }
  getBoundingClientRect() { return { left: 4, bottom: 8 }; }
}
function withHTMLElement(run) {
  const previous = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeHTMLElement;
  try { return run(); } finally { globalThis.HTMLElement = previous; }
}
const fakeView = (path) => ({ state: { field: (field) => (field === editorInfoField ? { file: path ? { path } : undefined } : undefined) } });

test("clic : cliquer une marque ne consomme jamais l'événement — le texte reste éditable normalement", () => withHTMLElement(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const handlers = comparisonClickExtension();
    assert.equal(handlers.click({ target: new FakeHTMLElement({ "data-comparison-change": "4" }) }, fakeView("Un.md")), false);
    assert.equal(handlers.click({ target: new FakeHTMLElement({ "data-comparison-note": "1" }) }, fakeView("Un.md")), false);
    assert.deepEqual(received.map((detail) => [detail.path, detail.index, detail.action]), [["Un.md", 4, "select"], ["Un.md", 1, "note"]]);
    assert.deepEqual([received[1].x, received[1].y], [4, 8], "le menu d'une note s'ouvre sous son passage");
  } finally { unsubscribe(); }
}));

test("clic : seul un bouton de décision intercepte réellement — c'est un contrôle, pas du texte", () => withHTMLElement(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const handlers = comparisonClickExtension();
    assert.equal(handlers.click({ target: new FakeHTMLElement({ "data-comparison-change": "2", "data-comparison-action": "apply" }) }, fakeView("Un.md")), true);
    assert.deepEqual(received, [{ path: "Un.md", index: 2, action: "apply" }]);
    // Une action inconnue ne déclenche rien : la décision reste fermée.
    assert.equal(handlers.click({ target: new FakeHTMLElement({ "data-comparison-change": "2", "data-comparison-action": "delete" }) }, fakeView("Un.md")), false);
    assert.equal(received.length, 1);
  } finally { unsubscribe(); }
}));

test("clic : le bouton × ferme sans jamais décider — action dédiée, distincte de toute décision", () => withHTMLElement(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const handlers = comparisonClickExtension();
    const handled = handlers.click({ target: new FakeHTMLElement({ "data-comparison-close": "3" }) }, fakeView("Un.md"));
    assert.equal(handled, true, "le clic est un vrai contrôle, comme un bouton de décision");
    assert.deepEqual(received, [{ path: "Un.md", index: -1, action: "dismiss" }]);
  } finally { unsubscribe(); }
}));

test("clic : hors de toute décoration, on notifie quand même — de quoi fermer un cartouche resté ouvert ailleurs", () => withHTMLElement(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const handlers = comparisonClickExtension();
    const handled = handlers.click({ target: new FakeHTMLElement({}) }, fakeView("Un.md"));
    assert.equal(handled, false, "jamais consommé : un clic ordinaire reste un clic ordinaire");
    assert.deepEqual(received, [{ path: "Un.md", index: -1, action: "dismiss" }]);
  } finally { unsubscribe(); }
}));

test("clic : sans fichier identifiable, ou désabonné, personne n'est notifié", () => withHTMLElement(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  const handlers = comparisonClickExtension();
  try {
    assert.equal(handlers.click({ target: new FakeHTMLElement({ "data-comparison-change": "0" }) }, fakeView(undefined)), false);
    assert.deepEqual(received, []);
  } finally { unsubscribe(); }
  handlers.click({ target: new FakeHTMLElement({ "data-comparison-change": "1" }) }, fakeView("Un.md"));
  assert.deepEqual(received, []);
}));

test("double-clic : recentre le changement — jamais une décision", () => withHTMLElement(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const handlers = comparisonClickExtension();
    const handled = handlers.dblclick({ target: new FakeHTMLElement({ "data-comparison-change": "6" }) }, fakeView("Un.md"));
    assert.equal(handled, false, "jamais consommé : le double-clic natif (sélection de mot) continue de fonctionner");
    assert.deepEqual(received, [{ path: "Un.md", index: 6, action: "recenter" }]);
  } finally { unsubscribe(); }
}));

test("double-clic : ignoré sur un bouton de décision ou de fermeture — déjà leur propre comportement au simple clic", () => withHTMLElement(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const handlers = comparisonClickExtension();
    handlers.dblclick({ target: new FakeHTMLElement({ "data-comparison-change": "1", "data-comparison-action": "apply" }) }, fakeView("Un.md"));
    handlers.dblclick({ target: new FakeHTMLElement({ "data-comparison-close": "1" }) }, fakeView("Un.md"));
    assert.deepEqual(received, []);
  } finally { unsubscribe(); }
}));

test("Échap : ferme sans jamais consommer la touche — Obsidian garde son propre usage", () => withHTMLElement(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const handlers = comparisonClickExtension();
    const handled = handlers.keydown({ key: "Escape" }, fakeView("Un.md"));
    assert.equal(handled, false);
    assert.deepEqual(received, [{ path: "Un.md", index: -1, action: "dismiss" }]);
    // Une autre touche ne déclenche rien.
    handlers.keydown({ key: "Enter" }, fakeView("Un.md"));
    assert.equal(received.length, 1);
  } finally { unsubscribe(); }
}));

/* --- Cartouche : une seule voie d'événement --------------------------------
   Un cartouche vit dans un widget CM6 (contenu inséré, pas du texte réel).
   Par défaut, CodeMirror ignore TOUT événement dont la cible est à
   l'intérieur d'un widget (`WidgetType.ignoreEvent`) — avant même que
   `comparisonClickExtension()` (`domEventHandlers`) ne soit consultée : c'est
   la cause exacte pour laquelle Restaurer et × restaient inertes, PAS une
   histoire de délégation manquante. Le correctif est `ignoreEvent()`, pas un
   second mécanisme d'écoute : ces tests vérifient qu'AUCUN écouteur n'est
   posé sur les boutons (FakeWidgetElement ne définit même pas
   `addEventListener` — l'appeler ferait échouer le test) et que le clic
   remonté par CodeMirror atteint bien `comparisonClickExtension()`, sur un
   DOM réellement imbriqué (bouton → span, comme `toDOM()` le construit
   vraiment), jamais un attribut posé à plat sur une fausse cible. */
class FakeWidgetElement {
  constructor(tag, options = {}) {
    this.tag = tag; this.cls = options.cls; this.text = options.text;
    this.attrs = {}; this.children = []; this.parent = null;
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  closest(selector) {
    const names = [...selector.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
    for (let node = this; node; node = node.parent) if (names.some((name) => name in node.attrs)) return node;
    return null;
  }
  getBoundingClientRect() { return { left: 4, bottom: 8 }; }
}
function withWidgetDom(run) {
  const previousCreateEl = globalThis.createEl;
  const previousHTMLElement = globalThis.HTMLElement;
  globalThis.createEl = (tag, options = {}) => new FakeWidgetElement(tag, options);
  globalThis.HTMLElement = FakeWidgetElement;
  try { return run(); }
  finally { globalThis.createEl = previousCreateEl; globalThis.HTMLElement = previousHTMLElement; }
}

test("cartouche : ignoreEvent laisse remonter exactement ce que comparisonClickExtension écoute, rien de plus", () => {
  const widget = new ComparisonActionsWidget({ type: "actions", at: 3, index: 0, label: "Ajout", hint: null, buttons: [] });
  assert.equal(widget.ignoreEvent({ type: "click" }), false, "sinon eventBelongsToEditor() arrête le clic avant comparisonClickExtension");
  assert.equal(widget.ignoreEvent({ type: "dblclick" }), false);
  assert.equal(widget.ignoreEvent({ type: "keydown" }), false, "Échap doit remonter même si le focus est resté sur un bouton du cartouche");
  assert.equal(widget.ignoreEvent({ type: "mousedown" }), true, "tout le reste garde le comportement par défaut de CodeMirror");
  assert.equal(widget.ignoreEvent({ type: "focusout" }), true);
});

test("cartouche : Restaurer n'a aucun écouteur propre — le clic remonté par CodeMirror atteint le gestionnaire central", () => withWidgetDom(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const spec = { type: "actions", at: 3, index: 5, label: "Suppression", hint: null, buttons: [{ action: "restore", text: "Restaurer ce passage", cta: true }] };
    const zone = new ComparisonActionsWidget(spec).toDOM();
    const button = zone.children.find((child) => child.getAttribute("data-comparison-action") === "restore");
    assert.ok(button, "le bouton existe dans le DOM réel, imbriqué, produit par toDOM()");
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.parent, zone, "vraiment un descendant du cartouche, jamais un attribut posé à plat");
    // Le seul chemin restant : comparisonClickExtension() lui-même, exactement
    // comme CodeMirror l'appellerait une fois l'événement laissé remonter.
    const handled = comparisonClickExtension().click({ target: button }, fakeView("Un.md"));
    assert.equal(handled, true, "un contrôle, pas du texte");
    assert.deepEqual(received, [{ path: "Un.md", index: 5, action: "restore" }]);
  } finally { unsubscribe(); }
}));

test("cartouche : × traverse le même DOM imbriqué réel jusqu'au gestionnaire central — cause commune, même correctif", () => withWidgetDom(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const spec = { type: "actions", at: 3, index: 5, label: "Suppression", hint: null, buttons: [] };
    const zone = new ComparisonActionsWidget(spec).toDOM();
    const close = zone.children.find((child) => child.getAttribute("data-comparison-close") !== null);
    assert.ok(close, "le bouton × existe");
    assert.equal(close.getAttribute("type"), "button");
    const handled = comparisonClickExtension().click({ target: close }, fakeView("Un.md"));
    assert.equal(handled, true, "fermer est un vrai contrôle, comme une décision");
    // × ferme sans jamais décider : un index sentinelle, jamais celui du changement.
    assert.deepEqual(received, [{ path: "Un.md", index: -1, action: "dismiss" }]);
  } finally { unsubscribe(); }
}));

test("cartouche : sans fichier identifiable, le clic remonté ne notifie personne — comme tout autre clic de comparisonClickExtension", () => withWidgetDom(() => {
  const received = [];
  const unsubscribe = onComparisonClick((detail) => received.push(detail));
  try {
    const spec = { type: "actions", at: 3, index: 5, label: "Suppression", hint: null, buttons: [{ action: "restore", text: "Restaurer ce passage", cta: true }] };
    const zone = new ComparisonActionsWidget(spec).toDOM();
    const button = zone.children.find((child) => child.getAttribute("data-comparison-action") === "restore");
    const handled = comparisonClickExtension().click({ target: button }, fakeView(undefined));
    assert.equal(handled, false);
    assert.deepEqual(received, []);
  } finally { unsubscribe(); }
}));
