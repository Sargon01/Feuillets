import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCategoryTabBar } from "../src/settings/settings-category-tabs.js";

/* Composant DOM pur, sans Obsidian ni PluginSettingTab : testé avec un
 * élément minimal reconstituant seulement les méthodes qu'il utilise
 * réellement (empty, addClass, createEl, addEventListener). */
class FakeElement {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this._text = "";
    this._listeners = new Map();
  }
  empty() { this.children = []; }
  addClass(...names) { for (const n of names) this.classes.add(n); }
  hasClass(name) { return this.classes.has(name); }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag);
    if (options.cls) child.addClass(...String(options.cls).split(/\s+/));
    if (options.text) child._text = options.text;
    this.children.push(child);
    return child;
  }
  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }
  click() {
    for (const handler of this._listeners.get("click") || []) handler();
  }
}

const ORDER = ["Projet", "Écriture", "Interface", "Panneaux latéraux", "Correction", "Export"];
const LABELS = {
  "Projet": "Projet",
  "Écriture": "Écriture",
  "Interface": "Interface",
  "Panneaux latéraux": "Panneaux latéraux",
  "Correction": "Correction",
  "Export": "Export",
};

test("renderCategoryTabBar : un bouton par catégorie, dans l'ordre, avec le bon libellé", () => {
  const container = new FakeElement();
  renderCategoryTabBar(container, { categories: ORDER, labels: LABELS, active: "Projet", onSelect: () => {} });

  assert.equal(container.hasClass("feuillets-settings-tabs"), true);
  assert.equal(container.children.length, ORDER.length);
  assert.deepEqual(container.children.map((c) => c._text), ORDER.map((name) => LABELS[name]));
  for (const btn of container.children) assert.equal(btn.hasClass("feuillets-settings-tab-btn"), true);
});

test("renderCategoryTabBar : seule la catégorie active porte is-active", () => {
  const container = new FakeElement();
  renderCategoryTabBar(container, { categories: ORDER, labels: LABELS, active: "Correction", onSelect: () => {} });

  const activeButtons = container.children.filter((c) => c.hasClass("is-active"));
  assert.equal(activeButtons.length, 1);
  assert.equal(activeButtons[0]._text, "Correction");
});

test("renderCategoryTabBar : repli sur le nom brut si aucun libellé fourni", () => {
  const container = new FakeElement();
  renderCategoryTabBar(container, { categories: ["Sans label"], labels: {}, active: "Sans label", onSelect: () => {} });

  assert.equal(container.children[0]._text, "Sans label");
});

test("renderCategoryTabBar : le clic transmet le nom de la catégorie visée", () => {
  const container = new FakeElement();
  const clicked = [];
  renderCategoryTabBar(container, { categories: ORDER, labels: LABELS, active: "Projet", onSelect: (name) => clicked.push(name) });

  container.children[3].click();
  assert.deepEqual(clicked, ["Panneaux latéraux"]);
});

test("renderCategoryTabBar : appelée deux fois, vide le conteneur avant de le reconstruire (pas de doublons)", () => {
  const container = new FakeElement();
  renderCategoryTabBar(container, { categories: ORDER, labels: LABELS, active: "Projet", onSelect: () => {} });
  renderCategoryTabBar(container, { categories: ORDER, labels: LABELS, active: "Export", onSelect: () => {} });

  assert.equal(container.children.length, ORDER.length);
  const activeButtons = container.children.filter((c) => c.hasClass("is-active"));
  assert.equal(activeButtons.length, 1);
  assert.equal(activeButtons[0]._text, "Export");
});
