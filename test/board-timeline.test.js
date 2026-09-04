import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { BoardView } from "../src/views/board-view.js";

globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle) };

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = options.value ?? "";
    this.text = options.text ?? "";
    this.style = { _props: {}, setProperty: (name, value) => { this.style._props[name] = value; }, removeProperty: () => {} };
    this.parentNode = {};
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); child.parentNode = this; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  setText(value) { this.text = String(value); return this; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  async trigger(type, event = {}) { await this.events.get(type)?.({ stopPropagation: () => {}, ...event }); }
  focus() {}
  empty() { this.children = []; }
  remove() { if (this.parentNode && Array.isArray(this.parentNode.children)) { const index = this.parentNode.children.indexOf(this); if (index >= 0) this.parentNode.children.splice(index, 1); } }
}

function findAll(element, predicate) {
  const result = [];
  for (const child of element.children) {
    if (predicate(child)) result.push(child);
    result.push(...findAll(child, predicate));
  }
  return result;
}

function findFirst(element, predicate) { return findAll(element, predicate)[0]; }

function buildTimelineHarness({ children = [], milestones = [] } = {}) {
  const root = new TFolder("Projet/Manuscrit");
  root.children = children;
  for (const child of children) child.parent = root;
  const chronoFolder = new TFolder("Projet/Chronologie");
  chronoFolder.children = milestones;
  for (const milestone of milestones) milestone.parent = chronoFolder;
  const settings = { timelineOrder: "chrono", timelineTagFilter: "", timelineScale: "annee", collapsed: {} };
  const plugin = {
    settings,
    flattenFiles: (folder) => folder === root ? children : [],
    isFrontMatter: () => false,
    fmOf: (file) => file.__fm || {},
    shortTitleFor: (file) => file.basename,
    getChronoFolder: () => chronoFolder,
    tagsOf: (file) => file.__tags || [],
    saveSettings: async () => {},
  };
  const view = new BoardView({ app: { workspace: { getLeaf: () => ({}) } }, contentEl: new FakeElement() }, plugin);
  view.passesFilter = () => true;
  return { view, root, chronoFolder, plugin, settings };
}

function render(harness) {
  const container = new FakeElement();
  harness.view.renderTimelineInner(container, harness.root, new Map());
  return container;
}

function dated(path, date, extra = {}) { const file = new TFile(path); file.__fm = { date, ...extra }; return file; }

test("Timeline — rendu initial conserve item.display et les classes", () => {
  const harness = buildTimelineHarness({ children: [dated("Projet/Manuscrit/focus.md", "1789-07-14")] });
  const container = render(harness);
  const date = findFirst(container, (element) => element.classes.has("feuillets-timeline-date-display"));
  assert.ok(date?.text);
  assert.ok(findFirst(container, (element) => element.classes.has("feuillets-timeline")));
  const dateContainer = findFirst(container, (element) => element.classes.has("feuillets-timeline-date"));
  const textarea = findFirst(dateContainer, (element) => element.tag === "textarea");
  assert.equal(textarea, undefined, "textarea non présent au rendu initial");
});

test("Timeline — date utilise la valeur YAML brute et sauvegarde seulement si modifiée", async () => {
  const file = dated("Projet/Manuscrit/focus.md", "1789-07-14");
  const harness = buildTimelineHarness({ children: [file] });
  const calls = [];
  const renders = [];
  harness.view.setFm = async (target, key, value) => calls.push({ target, key, value });
  harness.view.render = async (force) => renders.push(force);
  const container = render(harness);
  const dateContainer = findFirst(container, (element) => element.classes.has("feuillets-timeline-date"));
  await findFirst(dateContainer, (element) => element.classes.has("feuillets-timeline-date-display")).trigger("click");
  const textarea = findFirst(dateContainer, (element) => element.tag === "textarea");
  assert.ok(textarea, "textarea créé au clic");
  assert.equal(textarea.value, "1789-07-14");
  assert.ok(textarea.classes.has("feuillets-flat-textarea"), "textarea a classe feuillets-flat-textarea");
  assert.ok(textarea.classes.has("feuillets-autosize"), "textarea a classe feuillets-autosize");
  textarea.value = "1812-12-25";
  await textarea.trigger("blur");
  assert.deepEqual(calls.map(({ key, value }) => ({ key, value })), [{ key: "date", value: "1812-12-25" }]);
  assert.deepEqual(renders, [true]);
});

test("Timeline — date inchangée ne rerend pas", async () => {
  const harness = buildTimelineHarness({ children: [dated("Projet/Manuscrit/focus.md", "1789-07-14")] });
  const renders = [];
  harness.view.render = async (force) => renders.push(force);
  const container = render(harness);
  const dateContainer = findFirst(container, (element) => element.classes.has("feuillets-timeline-date"));
  await findFirst(dateContainer, (element) => element.classes.has("feuillets-timeline-date-display")).trigger("click");
  await findFirst(dateContainer, (element) => element.tag === "textarea").trigger("blur");
  assert.deepEqual(renders, []);
});

test("Timeline — synopsis vide et multilignes passent par le helper Board", () => {
  const harness = buildTimelineHarness({ children: [dated("Projet/Manuscrit/focus.md", "1789-07-14", { synopsis: "line 1\nline 2" })] });
  const container = render(harness);
  const synopsisContainer = findFirst(container, (element) => element.classes.has("feuillets-timeline-syn"));
  assert.ok(synopsisContainer, "conteneur synopsis attendu");
  const cell = findFirst(synopsisContainer, (element) => element.classes.has("feuillets-flat-text-cell"));
  assert.ok(cell, "cellule synopsis attendue");
  assert.ok(cell.classes.has("feuillets-clamp-text"), "classe clamp-text présente");
  assert.equal(cell.text, "line 1\nline 2");
  assert.equal(cell.style._props["--max-lines"], "6");
});

test("Timeline — synopsis vide affiche le tiret et reste éditable", () => {
  const harness = buildTimelineHarness({ children: [dated("Projet/Manuscrit/focus.md", "1789-07-14")] });
  const container = render(harness);
  const synopsisContainer = findFirst(container, (element) => element.classes.has("feuillets-timeline-syn"));
  const cell = findFirst(synopsisContainer, (element) => element.classes.has("feuillets-flat-text-cell"));
  assert.equal(cell.text, "—");
  assert.ok(cell.classes.has("is-empty"));
  assert.ok(cell.events.has("click"));
});

test("Timeline — titre possède toujours son ouverture", () => {
  const harness = buildTimelineHarness({ children: [dated("Projet/Manuscrit/focus.md", "1789-07-14")] });
  const title = findFirst(render(harness), (element) => element.classes.has("feuillets-timeline-title"));
  assert.ok(title.events.has("click"));
});

test("Menu Chronologie — ordre, filtre récursif et échelle conservent leur contrat", async () => {
  const nested = new TFolder("Projet/Chronologie/branch");
  const milestone = dated("Projet/Chronologie/branch/milestone.md", "1789-07-14");
  milestone.__tags = ["event"];
  nested.children = [milestone];
  const harness = buildTimelineHarness({ children: [dated("Projet/Manuscrit/focus.md", "1789-07-14")] });
  harness.chronoFolder.children = [nested];
  let saves = 0;
  let renders = 0;
  const menu = new Menu();
  harness.view.buildModeOptionsMenu(menu, "timeline", { S: harness.settings, meta: {}, pType: "fiction", wholeManuscript: false, outlineColumns: {} });
  const titles = menu.items.filter((item) => !item.separator).map((item) => item.title);
  assert.ok(titles.includes("Ordre chronologique"));
  assert.ok(titles.includes("Ordre narratif"));
  assert.ok(titles.includes("#event"));
  assert.deepEqual(
    titles.filter((title) => title.startsWith("Échelle :")),
    ["Échelle : siècle", "Échelle : année", "Échelle : mois", "Échelle : jour", "Échelle : sans en-têtes"]
  );
  harness.plugin.saveSettings = async () => { saves += 1; };
  harness.view.render = async () => { renders += 1; };
  const narrative = menu.items.find((item) => item.title === "Ordre narratif");
  await narrative.callback();
  assert.equal(harness.settings.timelineOrder, "narratif");
  const tag = menu.items.find((item) => item.title === "#event");
  await tag.callback();
  assert.equal(harness.settings.timelineTagFilter, "event");
  const scale = menu.items.find((item) => item.title === "Échelle : mois");
  await scale.callback();
  assert.equal(harness.settings.timelineScale, "mois");
  assert.equal(saves, 3);
  assert.equal(renders, 3);
});

test("Timeline — les jalons ignorent le filtre général et suivent seulement le tag Timeline", () => {
  const milestone = dated("Projet/Chronologie/milestone.md", "1789-07-14");
  milestone.__tags = ["event"];
  const harness = buildTimelineHarness({ children: [], milestones: [milestone] });
  harness.settings.timelineTagFilter = "event";
  harness.view.passesFilter = () => false;
  const container = render(harness);
  assert.equal(findAll(container, (element) => element.classes.has("feuillets-timeline-milestone")).length, 1);
});

test("LOT4 Chronologie — Synopsis vide affiche exactement « — », cliquable", () => {
  const harness = buildTimelineHarness({ children: [dated("Projet/Manuscrit/focus.md", "1789-07-14")] });
  const container = render(harness);
  const synopsisContainer = findFirst(container, (element) => element.classes.has("feuillets-timeline-syn"));
  const cell = findFirst(synopsisContainer, (element) => element.classes.has("feuillets-flat-text-cell"));
  assert.equal(cell.text, "—");
  assert.ok(cell.classes.has("is-empty"));
  assert.ok(cell.events.has("click"));
});

test("LOT4 Chronologie — clic sur « — » → textarea vide, sauvegarde via setFm", async () => {
  const file = dated("Projet/Manuscrit/focus.md", "1789-07-14");
  const harness = buildTimelineHarness({ children: [file] });
  const calls = [];
  harness.view.setFm = async (target, key, value) => calls.push({ target, key, value });
  const container = render(harness);
  const synopsisContainer = findFirst(container, (element) => element.classes.has("feuillets-timeline-syn"));
  const cell = findFirst(synopsisContainer, (element) => element.classes.has("feuillets-flat-text-cell"));
  await cell.trigger("click");
  const area = findFirst(synopsisContainer, (element) => element.tag === "textarea");
  assert.equal(area.value, "");
  area.value = "new synopsis";
  await area.trigger("blur");
  assert.deepEqual(calls.map(({ key, value }) => ({ key, value })), [{ key: "synopsis", value: "new synopsis" }]);
  assert.equal(cell.text, "new synopsis");
});

test("LOT4 Chronologie — synopsis existant, date et titre restent éditables/ouvrables", () => {
  const harness = buildTimelineHarness({ children: [dated("Projet/Manuscrit/focus.md", "1789-07-14", { synopsis: "Résumé court." })] });
  const container = render(harness);
  const synopsisContainer = findFirst(container, (element) => element.classes.has("feuillets-timeline-syn"));
  const cell = findFirst(synopsisContainer, (element) => element.classes.has("feuillets-flat-text-cell"));
  const date = findFirst(container, (element) => element.classes.has("feuillets-timeline-date-display"));
  const title = findFirst(container, (element) => element.classes.has("feuillets-timeline-title"));
  assert.equal(cell.text, "Résumé court.");
  assert.ok(cell.events.has("click"));
  assert.ok(date.events.has("click"));
  assert.ok(title.events.has("click"));
});
