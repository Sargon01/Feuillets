import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TFolder } from "obsidian";
import { BoardView } from "../src/views/board-view.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

/* Prompt 3 — le Board redevient exclusivement le workspace historique
 * Cartes / Plan / Chemin de fer / Chronologie. Édition et Documents vivent
 * uniquement dans le panneau droit unifié. */

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = "";
    this.text = options.text ?? "";
    this.attributes = { ...(options.attr ?? {}) };
    this.style = { _props: {}, setProperty(name, value) { this._props[name] = value; }, removeProperty() {} };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  hasClass(className) { return this.classes.has(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

if (!globalThis.document) globalThis.document = { activeElement: null };

function findAll(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findAll(child, predicate));
  }
  return found;
}

function buildBoard() {
  const root = new TFolder("Projet/Manuscrit");
  const contentEl = new FakeElement();
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.projectFolder = root.path;
  settings.projectMeta = { [root.path]: { hiddenBoardModes: [] } };

  const plugin = {
    settings,
    getProjectFolder: () => root,
    saveSettings: async () => {},
    getOrderedChildren: () => [],
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    wordCountOfFolder: async () => 0,
    updateDailyStats: async () => {},
    buildNumbering: () => new Map(),
    labelsOf: () => [],
    tagsOf: () => [],
    fmOf: () => ({}),
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    refreshView: () => {},
  };

  const app = { workspace: { on: () => ({}) }, vault: { getAbstractFileByPath: () => null } };
  const view = new BoardView({ app, contentEl }, plugin);
  view.app = app;
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    button.tooltip = tooltip;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.barSep = (parent) => parent.createDiv({ cls: "feuillets-bar-sep" });
  view.renderBoard = () => {};
  view.renderBoardWholeManuscript = () => {};
  view.renderBreadcrumbs = () => {};
  view.renderOutline = async () => {};
  view.renderCheminDeFer = () => {};
  view.renderTimeline = () => {};

  return { view, contentEl, settings, root };
}

function modeButtons(contentEl) {
  return findAll(contentEl, (el) => el.tag === "button" && el.icon);
}

test("BoardView : aucune architecture centrale Documents/Édition ne subsiste", () => {
  const source = readFileSync("src/views/board-view.ts", "utf8");
  for (const forbidden of [
    "CentralSurface",
    "centralSurface",
    "setCentralSurface",
    "EditionDocsContent",
    "EditionWorkspaceContent",
    "renderDocumentsSurface",
    "renderEditionSurface",
    "openLinkedPreview",
    "closeEditionOwnedPreview",
    "editionOwnsPreview",
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} supprimé du Board`);
  }
});

test("BoardView : la barre ne contient plus que les modes/outils du Board, jamais Documents ni Édition", async () => {
  const { view, contentEl } = buildBoard();
  await view.render(true);

  const icons = modeButtons(contentEl).map((button) => button.icon);
  for (const icon of ["layout-grid", "list-tree", "git-branch", "milestone"]) {
    assert.ok(icons.includes(icon), `${icon} reste disponible`);
  }
  assert.equal(icons.includes("folder-cog"), false, "plus de Documents éditoriaux dans la barre du Board");
  assert.equal(icons.includes("panel-top"), false, "plus d'Édition dans la barre du Board");
});

test("BoardView : changer de mode conserve le comportement historique boardMode", async () => {
  const { view, contentEl, settings, root } = buildBoard();
  settings.projectMeta[root.path].boardMode = "outline";
  await view.render(true);

  const cards = modeButtons(contentEl).find((button) => button.icon === "layout-grid");
  assert.ok(cards);
  await cards.events.get("click")({});
  await Promise.resolve();

  assert.equal(settings.projectMeta[root.path].boardMode, "board");
  assert.equal(settings.boardMode, "board");
});
