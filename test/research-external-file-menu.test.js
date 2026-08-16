import assert from "node:assert/strict";
import test from "node:test";
import { TFile, Menu } from "obsidian";
import { ResearchView } from "../src/views/research-view.js";
import { t } from "../src/i18n/index.js";

/* Micro-correctif "navigation des fichiers Recherche externes" (dernier lot
 * avant Feuillets 2.5, §16-18) : showResearchFileContextMenu(navigationOnly)
 * — fichier Recherche interne : menu complet inchangé ; fichier d'un
 * dossier Recherche externe associé : Ouvrir dans un nouvel onglet / Ouvrir
 * côte à côte SEULEMENT, jamais Renommer/Dupliquer/Corbeille. Voir aussi
 * test/research-linked-folders.test.js pour la présence du bouton ⋯ côté
 * rendu (renderResearchFileRow). */

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
  }
  addClass(className) { for (const p of String(className).split(/\s+/)) if (p) this.classes.add(p); }
  removeClass(className) { for (const p of String(className).split(/\s+/)) this.classes.delete(p); }
  createDiv(options = {}) { return this.createEl("div", options); }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }
  createSpan(options = {}) { return this.createEl("span", options); }
  setText(text) { this.text = String(text); }
}

function createView() {
  const contentEl = new FakeElement();
  const plugin = { titleFor: (f) => f.basename };
  const leaf = { app: { vault: {} }, contentEl };
  return new ResearchView(leaf, plugin);
}

function menuTitlesFor(view, file, navigationOnly) {
  const menus = [];
  const original = Menu.prototype.showAtMouseEvent;
  Menu.prototype.showAtMouseEvent = function () { menus.push(this); };
  try {
    view.showResearchFileContextMenu({}, file, navigationOnly);
  } finally {
    Menu.prototype.showAtMouseEvent = original;
  }
  return menus[0].items.filter((i) => !i.separator).map((i) => i.title);
}

test("fichier Recherche interne : menu complet inchangé (ouvrir, renommer, dupliquer, corbeille)", () => {
  const view = createView();
  const file = new TFile("Projet/_Recherche/Notice.md");
  const titles = menuTitlesFor(view, file, false);

  assert.deepEqual(titles, [
    t("binder.research.openNewTab"),
    t("binder.research.openSplit"),
    t("binder.research.renameFile"),
    t("shared.duplicate"),
    t("shared.trash"),
  ]);
});

test("fichier Recherche interne : navigationOnly par défaut est false (menu complet même sans 3e argument)", () => {
  const view = createView();
  const file = new TFile("Projet/_Recherche/Notice.md");
  const titles = menuTitlesFor(view, file, undefined);
  assert.ok(titles.includes(t("shared.trash")));
});

test("fichier d'un dossier Recherche externe associé : navigation uniquement, jamais renommer/dupliquer/corbeille", () => {
  const view = createView();
  const file = new TFile("Vault/Docs/Notice.md");
  const titles = menuTitlesFor(view, file, true);

  assert.deepEqual(titles, [
    t("binder.research.openNewTab"),
    t("binder.research.openSplit"),
  ]);
  assert.equal(titles.includes(t("binder.research.renameFile")), false);
  assert.equal(titles.includes(t("shared.duplicate")), false);
  assert.equal(titles.includes(t("shared.trash")), false);
});

test("« côte à côte » (fichier externe) demande bien une leaf split verticale avec le bon fichier", () => {
  const view = createView();
  const file = new TFile("Vault/Docs/Notice.md");
  const splitCalls = [];
  view.app.workspace = {
    getLeaf: (kind, dir) => {
      if (kind === "split") splitCalls.push(dir);
      return { openFile: async () => {}, kind };
    },
    setActiveLeaf: () => {},
  };

  const menus = [];
  const original = Menu.prototype.showAtMouseEvent;
  Menu.prototype.showAtMouseEvent = function () { menus.push(this); };
  try {
    view.showResearchFileContextMenu({}, file, true);
  } finally {
    Menu.prototype.showAtMouseEvent = original;
  }

  const splitItem = menus[0].items.find((i) => i.title === t("binder.research.openSplit"));
  assert.ok(splitItem);
  splitItem.callback();

  assert.deepEqual(splitCalls, ["vertical"]);
});
