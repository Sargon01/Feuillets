import test from "node:test";
import assert from "node:assert/strict";
import { AnnotationPopover } from "../src/ui/annotation-popover.js";

/* Correctif UI (avant le lot 5) : la petite carte flottante qui remplace
   l'ancien AnnotationModal. Testée ici en isolation, avec un FakeElement
   minimal (createDiv/createEl/createSpan, comme toutes les autres vues de
   ce plugin) — aucun DOM réel, aucune globale `document`/`window`
   requise : parentEl est injecté explicitement (voir
   AnnotationPopoverOptions.parentEl). */

class FakeElement {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.attributes = {};
    this.events = new Map();
    this.style = {};
    this.text = "";
    this.value = "";
    this.removed = false;
    this.parent = null;
  }
  _createChild(tag, options = {}) {
    const child = new FakeElement(tag);
    if (options.cls) child.addClass(options.cls);
    if (options.text) child.setText(options.text);
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) child.setAttr(k, v);
    child.parent = this;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this._createChild("div", options); }
  createSpan(options = {}) { return this._createChild("span", options); }
  createEl(tag, options = {}) { return this._createChild(tag, options); }
  addClass(cls) { for (const c of cls.split(" ")) this.classes.add(c); }
  removeClass(cls) { this.classes.delete(cls); }
  setText(text) { this.text = String(text); }
  setAttr(name, value) { this.attributes[name] = value; }
  addEventListener(type, cb) { this.events.set(type, cb); }
  removeEventListener(type, cb) { if (this.events.get(type) === cb) this.events.delete(type); }
  remove() {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  contains(target) {
    if (target === this) return true;
    return this.children.some((c) => c.contains(target));
  }
  focus() { this.focused = true; }
}

function findAll(el, predicate) {
  const out = [];
  for (const child of el.children) {
    if (predicate(child)) out.push(child);
    out.push(...findAll(child, predicate));
  }
  return out;
}

function open(overrides = {}) {
  const parentEl = new FakeElement("body");
  const saved = [];
  const deleted = [];
  const popover = new AnnotationPopover({
    parentEl,
    anchor: { left: 100, right: 200, top: 50, bottom: 66 },
    text: "texte initial",
    color: "yellow",
    onSave: (text, color) => saved.push({ text, color }),
    onDelete: () => deleted.push(true),
    ...overrides,
  });
  popover.open();
  const el = parentEl.children[parentEl.children.length - 1];
  return { parentEl, popover, el, saved, deleted };
}

test("ouverture : le popover est positionné près de l'ancre (sous le passage)", () => {
  const { el } = open();
  // rect: { left: 100, right: 200, top: 50, bottom: 66 } → sous le passage, aligné à gauche.
  assert.equal(el.style.left, "100px");
  assert.equal(el.style.top, "72px"); // bottom (66) + 6
});

test("ouverture : ancre via un élément avec getBoundingClientRect (double-clic)", () => {
  const rect = { left: 40, right: 90, top: 20, bottom: 32 };
  const anchorEl = { getAttribute: () => "ann-1", getBoundingClientRect: () => rect };
  const { el } = open({ anchor: anchorEl });
  assert.equal(el.style.left, "40px");
  assert.equal(el.style.top, "38px");
});

test("le textarea est visible, focalisé, et pré-rempli", () => {
  const { el } = open({ text: "déjà écrit" });
  const textarea = findAll(el, (n) => n.tag === "textarea")[0];
  assert.ok(textarea, "un textarea est rendu");
  assert.equal(textarea.value, "déjà écrit");
  assert.equal(textarea.focused, true);
});

test("aucun titre, aucun bouton Enregistrer — seulement textarea, 4 pastilles, Supprimer en édition", () => {
  const { el } = open();
  assert.equal(findAll(el, (n) => n.tag === "h1" || n.tag === "h2" || n.tag === "h3").length, 0);
  assert.equal(findAll(el, (n) => /enregistrer|save/i.test(n.text)).length, 0);
  const dots = findAll(el, (n) => n.classes.has("feuillets-annotation-popover-color"));
  assert.equal(dots.length, 4);
  const colors = dots.map((d) => ["yellow", "green", "blue", "pink"].find((c) => d.classes.has(`feuillets-annotation-dot-${c}`)));
  assert.deepEqual(colors, ["yellow", "green", "blue", "pink"]);
  const styles = findAll(el, (n) => n.classes.has("feuillets-annotation-popover-style"));
  assert.equal(styles.length, 3, "les trois styles partagent la ligne inférieure");
});

test("changement de style : état visible et callback immédiat", () => {
  const changes = [];
  const { el } = open({ style: "highlight", onStyleChange: (style) => changes.push(style) });
  const styles = findAll(el, (n) => n.classes.has("feuillets-annotation-popover-style"));
  assert.equal(styles[0].classes.has("is-selected"), true);
  styles[1].events.get("click")();
  assert.equal(styles[0].classes.has("is-selected"), false);
  assert.equal(styles[1].classes.has("is-selected"), true);
  assert.deepEqual(changes, ["underline"]);
});

test("modification du texte sauvegardée à la fermeture (Escape)", () => {
  const { el, parentEl, saved } = open({ text: "avant" });
  const textarea = findAll(el, (n) => n.tag === "textarea")[0];
  textarea.value = "après modification";
  textarea.events.get("input")();

  parentEl.events.get("keydown")({ key: "Escape" });

  assert.deepEqual(saved, [{ text: "après modification", color: "yellow" }]);
  assert.equal(el.removed, true);
});

test("changement de couleur sauvegardé à la fermeture", () => {
  const { el, parentEl, saved } = open({ color: "yellow" });
  const greenDot = findAll(el, (n) => n.classes.has("feuillets-annotation-dot-green"))[0];
  greenDot.events.get("click")();

  parentEl.events.get("keydown")({ key: "Escape" });

  assert.deepEqual(saved, [{ text: "texte initial", color: "green" }]);
});

test("la pastille sélectionnée porte la classe is-selected, mise à jour au clic", () => {
  const { el } = open({ color: "blue" });
  const dots = findAll(el, (n) => n.classes.has("feuillets-annotation-popover-color"));
  const blue = dots.find((d) => d.classes.has("feuillets-annotation-dot-blue"));
  const pink = dots.find((d) => d.classes.has("feuillets-annotation-dot-pink"));
  assert.equal(blue.classes.has("is-selected"), true);

  pink.events.get("click")();

  assert.equal(blue.classes.has("is-selected"), false);
  assert.equal(pink.classes.has("is-selected"), true);
});

test("Supprimer : supprime sans sauvegarder le texte en cours", () => {
  const { el, deleted, saved } = open();
  const deleteBtn = findAll(el, (n) => n.classes.has("feuillets-annotation-popover-delete"))[0];
  assert.ok(deleteBtn, "l'action Supprimer est affichée en édition (onDelete fourni)");

  deleteBtn.events.get("click")();

  assert.deepEqual(deleted, [true]);
  assert.deepEqual(saved, [], "onSave n'est jamais appelé après une suppression");
  assert.equal(el.removed, true);
});

test("en création (sans onDelete), aucune action Supprimer n'est affichée", () => {
  const { el } = open({ onDelete: undefined });
  assert.equal(findAll(el, (n) => n.classes.has("feuillets-annotation-popover-delete")).length, 0);
});

test("Escape ferme le popover et retire ses écouteurs", () => {
  const { el, parentEl, saved } = open();
  assert.equal(parentEl.events.has("keydown"), true);
  assert.equal(parentEl.events.has("mousedown"), true);

  parentEl.events.get("keydown")({ key: "Escape" });

  assert.equal(el.removed, true);
  assert.equal(saved.length, 1);
  assert.equal(parentEl.events.has("keydown"), false, "l'écouteur keydown est retiré à la fermeture");
  assert.equal(parentEl.events.has("mousedown"), false, "l'écouteur mousedown est retiré à la fermeture");
});

test("une touche différente d'Escape ne ferme pas le popover", () => {
  const { el, parentEl, saved } = open();
  parentEl.events.get("keydown")({ key: "Enter" });
  assert.equal(el.removed, false);
  assert.equal(saved.length, 0);
});

test("clic extérieur ferme et sauvegarde", () => {
  const { el, parentEl, saved } = open({ text: "note" });
  const outside = new FakeElement("div"); // jamais rattaché au popover
  parentEl.events.get("mousedown")({ target: outside });

  assert.equal(el.removed, true);
  assert.deepEqual(saved, [{ text: "note", color: "yellow" }]);
});

test("clic à l'intérieur du popover (ex. une pastille) ne ferme pas", () => {
  const { el, parentEl, saved } = open();
  const dot = findAll(el, (n) => n.classes.has("feuillets-annotation-popover-color"))[0];
  parentEl.events.get("mousedown")({ target: dot });

  assert.equal(el.removed, false);
  assert.equal(saved.length, 0);
});

test("close() est idempotent : onSave n'est appelé qu'une seule fois", () => {
  const { popover, saved } = open();
  popover.close();
  popover.close();
  assert.equal(saved.length, 1);
});
