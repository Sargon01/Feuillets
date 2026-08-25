import assert from "node:assert/strict";
import test from "node:test";
import { PresentationPdfExportModal } from "../src/ui/presentation-pdf-export-modal.js";

/* La modale n'utilise plus `Setting` : elle compose trois RUBRIQUES titrées,
   chacune avec une grille de cartes cliquables, dans le langage visuel des
   autres modales Feuillets (voir styles.css,
   `.feuillets-presentation-export-*`). FakeElement minimal, même convention
   que le reste de la suite — aucun DOM réel requis. */
class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attributes = options.attr ?? {};
    this.text = options.text ?? "";
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); child.parent = this; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of String(names).split(" ")) if (name) this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}
function withClass(root, cls) {
  return allElements(root).filter((el) => el.classes.has(cls));
}

function openModal() {
  const choices = [];
  const modal = new PresentationPdfExportModal({}, (choice) => choices.push(choice));
  modal.modalEl = new FakeElement();
  modal.titleEl = new FakeElement();
  modal.contentEl = new FakeElement();
  let closed = 0;
  modal.close = () => { closed++; };
  modal.onOpen();
  return { modal, choices, closed: () => closed };
}

test("modale d'export : trois rubriques titrées (Présentation / Support / Plan), chacune avec sa description et son icône", () => {
  const { modal } = openModal();

  assert.equal(modal.modalEl.classes.has("feuillets-presentation-export-modal"), true, "classe de modale Feuillets posée");
  assert.equal(modal.titleEl.text, "Exporter en PDF");

  const groups = withClass(modal.contentEl, "feuillets-presentation-export-group");
  assert.equal(groups.length, 3, "trois rubriques, jamais une liste plate de six lignes");

  const titles = withClass(modal.contentEl, "feuillets-presentation-export-group-title").map((el) => el.text);
  assert.deepEqual(titles, ["Présentation", "Support à distribuer", "Plan de présentation"]);

  for (const group of groups) {
    assert.equal(withClass(group, "feuillets-presentation-export-group-icon").length, 1);
    const desc = withClass(group, "feuillets-presentation-export-group-desc")[0];
    assert.ok(desc && desc.text.length > 0, "chaque rubrique explique son usage");
  }
});

test("modale d'export : 2 + 3 + 2 options, chacune avec un libellé et un rappel d'usage", () => {
  const { modal } = openModal();
  const groups = withClass(modal.contentEl, "feuillets-presentation-export-group");
  const optionsOf = (group) => withClass(group, "feuillets-presentation-export-option");

  assert.deepEqual(groups.map((g) => optionsOf(g).length), [2, 3, 2]);

  for (const group of groups) {
    for (const option of optionsOf(group)) {
      // div[role=button] et NON <button> : Obsidian impose aux boutons de
      // ses modales une hauteur fixe + white-space: nowrap qui faisait
      // déborder le texte sur la rubrique suivante.
      assert.equal(option.tag, "div");
      assert.equal(option.attributes.role, "button");
      assert.equal(option.attributes.tabindex, "0", "reste atteignable au clavier");
      assert.ok(withClass(option, "feuillets-presentation-export-option-label")[0].text.length > 0);
      assert.ok(withClass(option, "feuillets-presentation-export-option-hint")[0].text.length > 0);
    }
  }
});

test("modale d'export : le Support propose 2, 4 ET 6 diapositives par page", () => {
  const { modal } = openModal();
  const handoutGroup = withClass(modal.contentEl, "feuillets-presentation-export-group")[1];
  const labels = withClass(handoutGroup, "feuillets-presentation-export-option-label").map((el) => el.text);
  assert.deepEqual(labels, ["2 diapositives par page", "4 diapositives par page", "6 diapositives par page"]);
});

test("modale d'export : chaque clic notifie le bon choix et ferme la modale", () => {
  const expected = [
    { kind: "presentation", pageFormat: "16:9" },
    { kind: "presentation", pageFormat: "a4-landscape" },
    { kind: "handout", slidesPerPage: 2 },
    { kind: "handout", slidesPerPage: 4 },
    { kind: "handout", slidesPerPage: 6 },
    { kind: "plan", scope: "all" },
    { kind: "plan", scope: "notes-only" },
  ];
  expected.forEach((choice, index) => {
    const { modal, choices, closed } = openModal();
    const options = withClass(modal.contentEl, "feuillets-presentation-export-option");
    assert.equal(options.length, expected.length, "sept options au total");
    options[index].events.get("click")();
    assert.deepEqual(choices, [choice]);
    assert.equal(closed(), 1, "la modale se ferme après le choix");
  });
});

test("modale d'export : aucun texte français codé en dur — tout passe par t(...)", () => {
  const { modal } = openModal();
  for (const el of allElements(modal.contentEl)) {
    if (!el.classes.has("feuillets-presentation-export-option-label")) continue;
    assert.notEqual(el.text, "", "un libellé vide trahirait une clé i18n manquante");
    assert.doesNotMatch(el.text, /^presentation\./, "jamais la clé brute affichée à la place du texte");
  }
});

test("modale d'export : une option s'active aussi au clavier (Entrée et Espace)", () => {
  for (const key of ["Enter", " "]) {
    const { modal, choices, closed } = openModal();
    const option = withClass(modal.contentEl, "feuillets-presentation-export-option")[0];
    let prevented = 0;
    option.events.get("keydown")({ key, preventDefault: () => { prevented++; } });
    assert.deepEqual(choices, [{ kind: "presentation", pageFormat: "16:9" }], `activation par « ${key} »`);
    assert.equal(prevented, 1, "le défilement par Espace est neutralisé");
    assert.equal(closed(), 1);
  }
});

test("modale d'export : une autre touche n'active rien", () => {
  const { modal, choices } = openModal();
  const option = withClass(modal.contentEl, "feuillets-presentation-export-option")[0];
  option.events.get("keydown")({ key: "a", preventDefault: () => {} });
  assert.deepEqual(choices, []);
});
