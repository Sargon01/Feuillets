import test from "node:test";
import assert from "node:assert/strict";
import { Menu } from "obsidian";
import { renderBinderPlanOutliner } from "../src/ui/canvas-binder-plan-outliner.js";

/* UI outliner (correctif Prompt 3, §3/§4/§6). Vérifie l'APPARENCE
   structurelle (pas de champ encadré au repos) et les créations
   explicites — jamais le rendu pixel, hors de portée d'un test unitaire. */

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
  focus() {} select() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, right: 200, top: 0, bottom: 200, height: 26 }; }
  setAttr(n, v) { this.attrs[n] = v; }
  addEventListener(type, cb) { (this.events.get(type) || this.events.set(type, []).get(type)).push(cb); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  fire(type, evt = {}) { for (const cb of this.events.get(type) || []) cb(evt); }
}
// addEventListener robuste
FakeEl.prototype.addEventListener = function (type, cb) {
  if (!this.events.has(type)) this.events.set(type, []);
  this.events.get(type).push(cb);
};

function walk(el, out = []) { for (const c of el.children) { out.push(c); walk(c, out); } return out; }
const byClass = (el, cls) => walk(el).filter((c) => c.classes.has(cls));

function render(items, overrides = {}) {
  const host = new FakeEl();
  const changes = [];
  renderBinderPlanOutliner({
    host, items, dirty: false, editable: true,
    onChange: (next, focusId) => changes.push({ next, focusId }),
    onRefresh: () => {}, onApply: () => {},
    ...overrides,
  });
  return { host, changes };
}

const tree = () => [
  { id: "f1", kind: "folder", title: "Chapitre 1", path: "M/C1", collapsed: false, children: [
    { id: "s1", kind: "file", title: "carnet 1", path: "M/C1/a.md", collapsed: false, children: [] },
  ] },
  { id: "s2", kind: "file", title: "Leçon 2", path: "M/b.md", collapsed: false, children: [] },
];

test("§3 — au repos le titre est du TEXTE, jamais un champ encadré", () => {
  const { host } = render(tree());
  const titles = byClass(host, "feuillets-plan-title");
  assert.equal(titles.length, 3, "une ligne racine, son enfant, et la seconde racine");
  for (const title of titles) assert.equal(title.tag, "span", "un span, pas un <input>");
  assert.equal(walk(host).filter((c) => c.tag === "input").length, 0, "aucun <input> au repos");
});

test("§3 — le champ d'édition n'apparaît qu'au clic sur le titre", () => {
  const { host } = render(tree());
  const title = byClass(host, "feuillets-plan-title")[0];
  title.fire("click", { stopPropagation() {} });
  const row = byClass(host, "feuillets-plan-row")[0];
  assert.ok(row.children.some((c) => c.tag === "input"), "le champ apparaît à l'édition");
  assert.equal(title.hidden, true, "le texte au repos s'efface pendant l'édition");
});

test("§3 — chevron seulement sur une ligne qui a des enfants", () => {
  const { host } = render(tree());
  assert.equal(byClass(host, "feuillets-plan-toggle").length, 1, "seul Chapitre 1 en a un");
  assert.equal(byClass(host, "feuillets-plan-toggle-space").length, 2, "les autres gardent l'alignement");
});

test("§4 — le bouton + propose Nouveau feuillet et Nouveau dossier", () => {
  const { host, changes } = render(tree());
  const add = walk(host).find((c) => c.tag === "button" && c.attrs["aria-label"] === "Ajouter");
  assert.ok(add, "le bouton + existe dans l'en-tête");
  add.fire("click", { stopPropagation() {} });

  const menu = Menu.lastShown;
  assert.deepEqual(menu.items.filter((i) => !i.separator).map((i) => i.title), ["Nouveau feuillet", "Nouveau dossier"]);

  menu.items[1].callback(); // Nouveau dossier
  assert.equal(changes.length, 1);
  const added = changes[0].next.at(-1);
  assert.equal(added.kind, "draft-folder", "un vrai dossier brouillon, pas un draft ambigu");
  assert.equal(changes[0].focusId, added.id, "son titre prend le focus pour être nommé aussitôt");
});

test("§4 — le bouton + crée un feuillet brouillon à la racine", () => {
  const { host, changes } = render(tree());
  walk(host).find((c) => c.tag === "button" && c.attrs["aria-label"] === "Ajouter").fire("click", { stopPropagation() {} });
  Menu.lastShown.items[0].callback();
  const added = changes[0].next.at(-1);
  assert.equal(added.kind, "draft-file");
  assert.equal(changes[0].next.length, 3, "ajouté à la racine du Plan");
});

test("§4 — menu contextuel : après/enfant, l'enfant seulement si la ligne l'accepte", () => {
  const { host, changes } = render(tree());
  const rows = byClass(host, "feuillets-plan-row");

  // Ligne DOSSIER : après + enfant.
  rows[0].fire("contextmenu", { preventDefault() {}, stopPropagation() {} });
  let titles = Menu.lastShown.items.filter((i) => !i.separator).map((i) => i.title);
  assert.deepEqual(titles, ["Nouveau feuillet après", "Nouveau dossier après", "Nouveau feuillet enfant", "Nouveau dossier enfant"]);

  // Ligne FICHIER : jamais d'enfant.
  rows[1].fire("contextmenu", { preventDefault() {}, stopPropagation() {} });
  titles = Menu.lastShown.items.filter((i) => !i.separator).map((i) => i.title);
  assert.deepEqual(titles, ["Nouveau feuillet après", "Nouveau dossier après"], "aucun enfant sous un feuillet");

  // « enfant » place bien dans les enfants.
  rows[0].fire("contextmenu", { preventDefault() {}, stopPropagation() {} });
  Menu.lastShown.items.find((i) => i.title === "Nouveau dossier enfant").callback();
  const parent = changes.at(-1).next.find((i) => i.id === "f1");
  assert.equal(parent.children.at(-1).kind, "draft-folder");
});

test("§5 — sur un FICHIER, Entrée crée un frère ; Cmd/Ctrl+Entrée un dossier frère", () => {
  const { host, changes } = render(tree());
  const rows = byClass(host, "feuillets-plan-row");
  const row = rows[2]; // "Leçon 2" — un feuillet à la racine, aucun enfant possible
  byClass(row, "feuillets-plan-title")[0].fire("click", { stopPropagation() {} });
  const input = row.children.find((c) => c.tag === "input");

  input.fire("keydown", { key: "Enter", preventDefault() {}, stopPropagation() {} });
  assert.equal(changes.at(-1).next[2].kind, "draft-file", "un frère, juste après le feuillet");
  assert.equal(changes.at(-1).next.length, 3, "jamais ajouté comme enfant : un fichier n'en accueille aucun");

  input.fire("keydown", { key: "Enter", metaKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(changes.at(-1).next[2].kind, "draft-folder");
});

test("§5 — sur un DOSSIER, Entrée crée un enfant ; Cmd/Ctrl+Entrée un dossier enfant (jamais un frère)", () => {
  const { host, changes } = render(tree());
  const row = byClass(host, "feuillets-plan-row")[0]; // "Chapitre 1", dossier déplié avec un enfant
  byClass(row, "feuillets-plan-title")[0].fire("click", { stopPropagation() {} });
  const input = row.children.find((c) => c.tag === "input");

  input.fire("keydown", { key: "Enter", preventDefault() {}, stopPropagation() {} });
  assert.equal(changes.at(-1).next.length, 2, "jamais ajouté comme frère : toujours 2 items à la racine");
  const folder = changes.at(-1).next[0];
  assert.equal(folder.children.length, 2, "le nouvel enfant rejoint le seul déjà présent");
  assert.equal(folder.children[1].kind, "draft-file");

  input.fire("keydown", { key: "Enter", metaKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(changes.at(-1).next[0].children[1].kind, "draft-folder", "Cmd/Ctrl+Entrée : enfant DOSSIER, toujours un enfant");
});

test("clavier Plan — Tab indent, Shift+Tab outdent et Entrée restent dans le Plan", () => {
  const { host, changes } = render(tree());
  const rows = byClass(host, "feuillets-plan-row");
  const event = (key, extra = {}) => {
    const state = { prevented: false, stopped: false, key, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    return state;
  };

  const tab = event("Tab");
  rows[2].fire("keydown", tab);
  assert.equal(tab.prevented, true);
  assert.equal(tab.stopped, true);
  assert.equal(changes.at(-1).next[0].children.at(-1).id, "s2", "Tab indente sous le frère précédent admissible");

  const outdent = event("Tab", { shiftKey: true });
  rows[1].fire("keydown", outdent);
  assert.equal(outdent.prevented, true);
  assert.equal(outdent.stopped, true);

  const enter = event("Enter");
  rows[2].fire("keydown", enter);
  assert.equal(enter.prevented, true);
  assert.equal(enter.stopped, true);
  assert.equal(changes.at(-1).next.at(-1).kind, "draft-file", "Entrée crée un frère");
});

test("§6 — chaque ligne est draggable et la branche entière suit", () => {
  const { host } = render(tree());
  const rows = byClass(host, "feuillets-plan-row");
  for (const row of rows) {
    assert.ok(row.events.has("pointerdown"), "toute la ligne est saisissable, pas une poignée");
  }
  assert.ok(byClass(host, "feuillets-plan-tree-scroll")[0].events.has("pointerup"), "le cycle est suivi au niveau du tree");
});

test("hors périmètre — le Plan s'affiche en lecture seule, sans bouton actif", () => {
  const host = new FakeEl();
  renderBinderPlanOutliner({
    host, items: tree(), dirty: false, editable: false,
    onChange: () => {}, onRefresh: () => {}, onApply: () => {},
  });
  assert.equal(byClass(host, "feuillets-plan-row").length, 0, "aucune ligne éditable");
  assert.ok(byClass(host, "feuillets-plan-empty").length > 0, "un message explique l'indisponibilité");
  for (const b of walk(host).filter((c) => c.tag === "button")) assert.equal(b.disabled, true);
});
