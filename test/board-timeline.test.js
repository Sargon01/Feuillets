import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { BoardView } from "../src/views/board-view.js";
import { parseStoryDate } from "../src/utils/core.js";

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

function timelineHeadings(container) {
  return findAll(container, (element) => element.classes.has("feuillets-timeline-year")).map((element) => element.text);
}

function timelineTitles(container) {
  return findAll(container, (element) => element.classes.has("feuillets-timeline-title")).map((element) => element.text);
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

test("Timeline — l'échelle année est la valeur par défaut", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/focus.md", "1789-01-01"),
    dated("Projet/Manuscrit/parent-a.md", "1789-07-14"),
    dated("Projet/Manuscrit/parent-b.md", "1790-01-01"),
  ] });
  harness.settings.timelineScale = "";
  const container = render(harness);
  assert.deepEqual(timelineHeadings(container), ["1789", "1790"]);
  assert.equal(timelineTitles(container).length, 3);
});

test("Timeline — l'échelle mois ne crée pas de janvier pour une année seule", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/focus.md", "1789"),
    dated("Projet/Manuscrit/parent-a.md", "1789-07-01"),
    dated("Projet/Manuscrit/parent-b.md", "1789-07-14"),
    dated("Projet/Manuscrit/child-a.md", "1789-08-01"),
  ] });
  harness.settings.timelineScale = "mois";
  assert.deepEqual(timelineHeadings(render(harness)), ["1789", "1789-07", "1789-08"]);
});

test("Timeline — l'échelle jour utilise la précision existante et garde l'ordre des heures", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/focus.md", "1789-07"),
    dated("Projet/Manuscrit/parent-a.md", "1789-07-14 09:00"),
    dated("Projet/Manuscrit/parent-b.md", "1789-07-14 18:00"),
    dated("Projet/Manuscrit/child-a.md", "1789-07-15"),
  ] });
  harness.settings.timelineScale = "jour";
  const container = render(harness);
  assert.deepEqual(timelineHeadings(container), ["1789-07", "1789-07-14", "1789-07-15"]);
  assert.deepEqual(timelineTitles(container), ["focus", "parent-a", "parent-b", "child-a"]);
});

test("Timeline — l'échelle siècle utilise les bornes historiques, sans année zéro", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/focus.md", "1701"),
    dated("Projet/Manuscrit/parent-a.md", "1789"),
    dated("Projet/Manuscrit/parent-b.md", "1800"),
    dated("Projet/Manuscrit/child-a.md", "1801"),
    dated("Projet/Manuscrit/child-b.md", "-44"),
  ] });
  harness.settings.timelineScale = "siecle";
  assert.deepEqual(timelineHeadings(render(harness)), ["-100–-1", "1701–1800", "1801–1900"]);
});

test("Timeline — sans en-têtes conserve uniquement les items", () => {
  const harness = buildTimelineHarness({ children: [dated("Projet/Manuscrit/focus.md", "1789-07-14")] });
  harness.settings.timelineScale = "aucune";
  const container = render(harness);
  assert.equal(timelineHeadings(container).length, 0);
  assert.equal(timelineTitles(container).length, 1);
});

test("Timeline — en ordre narratif, une période retrouvée recrée son en-tête", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/A.md", "2001"),
    dated("Projet/Manuscrit/B.md", "1998"),
    dated("Projet/Manuscrit/C.md", "2001"),
  ] });
  harness.settings.timelineOrder = "narratif";
  harness.settings.timelineScale = "annee";
  const container = render(harness);
  assert.deepEqual(timelineHeadings(container), ["2001", "1998", "2001"]);
  assert.deepEqual(timelineTitles(container), ["A", "B", "C"]);
});

test("Timeline — jalon Recherche daté est ancré après le premier feuillet du jour", () => {
  const milestone = dated("Projet/Chronologie/milestone.md", "2001-01-01");
  const harness = buildTimelineHarness({
    children: [dated("Projet/Manuscrit/A.md", "2001-01-01"), dated("Projet/Manuscrit/B.md", "2002-01-01")],
    milestones: [milestone],
  });
  harness.settings.timelineOrder = "narratif";
  harness.settings.timelineScale = "annee";
  const container = render(harness);
  assert.deepEqual(timelineTitles(container), ["A", "milestone", "B"]);
});

test("Timeline — l'ordre Binder reste prioritaire pour l'ancrage narratif", () => {
  const harness = buildTimelineHarness({
    children: [
      dated("Projet/Manuscrit/A.md", "2005-01-01"),
      dated("Projet/Manuscrit/B.md", "1990-01-01"),
      dated("Projet/Manuscrit/C.md", "2010-01-01"),
    ],
    milestones: [dated("Projet/Chronologie/J.md", "1990-01-01")],
  });
  harness.settings.timelineOrder = "narratif";
  assert.deepEqual(timelineTitles(render(harness)), ["A", "B", "J", "C"]);
});

test("Timeline — un jalon est attaché à la première occurrence narrative du jour", () => {
  const harness = buildTimelineHarness({
    children: [
      dated("Projet/Manuscrit/A.md", "2001-01-01"),
      dated("Projet/Manuscrit/B.md", "1998-01-01"),
      dated("Projet/Manuscrit/C.md", "2001-01-01"),
    ],
    milestones: [dated("Projet/Chronologie/J.md", "2001-01-01")],
  });
  harness.settings.timelineOrder = "narratif";
  assert.deepEqual(timelineTitles(render(harness)), ["A", "J", "B", "C"]);
});

test("Timeline — plusieurs jalons d'une même ancre gardent leur ordre de collecte", () => {
  const harness = buildTimelineHarness({
    children: [dated("Projet/Manuscrit/A.md", "2001-01-01"), dated("Projet/Manuscrit/B.md", "2002-01-01")],
    milestones: [
      dated("Projet/Chronologie/J2.md", "2001-01-01 18:00"),
      dated("Projet/Chronologie/J1.md", "2001-01-01 09:00"),
    ],
  });
  harness.settings.timelineOrder = "narratif";
  assert.deepEqual(timelineTitles(render(harness)), ["A", "J2", "J1", "B"]);
});

test("Timeline — les jalons non ancrés restent après les feuillets dans leur ordre de collecte", () => {
  const harness = buildTimelineHarness({
    children: [dated("Projet/Manuscrit/A.md", "2001-01-01"), dated("Projet/Manuscrit/B.md", "2002-01-01")],
    milestones: [
      dated("Projet/Chronologie/J1.md", "1990-01-01"),
      dated("Projet/Chronologie/J2.md", "2030-01-01"),
    ],
  });
  harness.settings.timelineOrder = "narratif";
  assert.deepEqual(timelineTitles(render(harness)), ["A", "B", "J1", "J2"]);
});

test("Timeline — l'heure ne modifie pas l'ancrage narratif", () => {
  const harness = buildTimelineHarness({
    children: [dated("Projet/Manuscrit/A.md", "2001-01-01 18:00"), dated("Projet/Manuscrit/B.md", "2002-01-01")],
    milestones: [dated("Projet/Chronologie/J.md", "2001-01-01 09:00")],
  });
  harness.settings.timelineOrder = "narratif";
  assert.deepEqual(timelineTitles(render(harness)), ["A", "J", "B"]);
});

test("Timeline — une précision différente n'ancre pas un jalon", () => {
  const harness = buildTimelineHarness({
    children: [dated("Projet/Manuscrit/A.md", "1756"), dated("Projet/Manuscrit/B.md", "1757")],
    milestones: [
      dated("Projet/Chronologie/J.md", "1756-01-05"),
      dated("Projet/Chronologie/K.md", "1757"),
    ],
  });
  harness.settings.timelineOrder = "narratif";
  assert.deepEqual(timelineTitles(render(harness)), ["A", "B", "K", "J"]);
});

test("parseStoryDate — conserve le sort journalier et expose heure/minute sans inventer minuit", () => {
  const morning = parseStoryDate("1789-07-14 09:30");
  const evening = parseStoryDate("1789-07-14 18:00");
  const dateOnly = parseStoryDate("1789-07-14");
  assert.equal(morning.sort, 17890714);
  assert.equal(evening.sort, morning.sort);
  assert.equal(morning.hour, 9);
  assert.equal(morning.minute, 30);
  assert.equal(evening.hour, 18);
  assert.equal(evening.minute, 0);
  assert.equal(dateOnly.hour, undefined);
});

test("Timeline — chrono trie les heures puis les minutes du même jour", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/evening.md", "1789-07-14 18:00"),
    dated("Projet/Manuscrit/morning.md", "1789-07-14 09:00"),
    dated("Projet/Manuscrit/noon.md", "1789-07-14 12:30"),
  ] });
  assert.deepEqual(timelineTitles(render(harness)), ["morning", "noon", "evening"]);
});

test("Timeline — date seule avant minuit explicite puis heure horodatée", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/evening.md", "1789-07-14 09:00"),
    dated("Projet/Manuscrit/date-only.md", "1789-07-14"),
    dated("Projet/Manuscrit/midnight.md", "1789-07-14 00:00"),
  ] });
  assert.deepEqual(timelineTitles(render(harness)), ["date-only", "midnight", "evening"]);
});

test("Timeline — chrono trie les minutes", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/late.md", "1789-07-14 09:45"),
    dated("Projet/Manuscrit/early.md", "1789-07-14 09:05"),
    dated("Projet/Manuscrit/middle.md", "1789-07-14 09:30"),
  ] });
  assert.deepEqual(timelineTitles(render(harness)), ["early", "middle", "late"]);
});

test("Timeline — mêmes horodatages et dates seules conservent l'ordre stable", () => {
  const timed = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/A.md", "1789-07-14 09:30"),
    dated("Projet/Manuscrit/B.md", "1789-07-14 09:30"),
    dated("Projet/Manuscrit/C.md", "1789-07-14 09:30"),
  ] });
  const undated = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/A.md", "1789-07-14"),
    dated("Projet/Manuscrit/B.md", "1789-07-14"),
    dated("Projet/Manuscrit/C.md", "1789-07-14"),
  ] });
  assert.deepEqual(timelineTitles(render(timed)), ["A", "B", "C"]);
  assert.deepEqual(timelineTitles(render(undated)), ["A", "B", "C"]);
});

test("Timeline — le jour reste prioritaire sur l'heure", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/A.md", "1789-07-15 00:01"),
    dated("Projet/Manuscrit/B.md", "1789-07-14 23:59"),
    dated("Projet/Manuscrit/C.md", "1789-07-13 18:00"),
  ] });
  assert.deepEqual(timelineTitles(render(harness)), ["C", "B", "A"]);
});

test("Timeline — le mode narratif ignore l'heure", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/A.md", "1789-07-14 18:00"),
    dated("Projet/Manuscrit/B.md", "1789-07-14 09:00"),
    dated("Projet/Manuscrit/C.md", "1789-07-14 12:00"),
  ] });
  harness.settings.timelineOrder = "narratif";
  assert.deepEqual(timelineTitles(render(harness)), ["A", "B", "C"]);
});

test("Timeline — l'échelle jour reste unique pour plusieurs heures du même jour", () => {
  const harness = buildTimelineHarness({ children: [
    dated("Projet/Manuscrit/evening.md", "1789-07-14 18:00"),
    dated("Projet/Manuscrit/morning.md", "1789-07-14 09:00"),
  ] });
  harness.settings.timelineScale = "jour";
  const container = render(harness);
  assert.deepEqual(timelineTitles(container), ["morning", "evening"]);
  assert.deepEqual(timelineHeadings(container), ["1789-07-14"]);
});

test("Timeline — jalons Recherche horodatés sont triés en chrono", () => {
  const evening = dated("Projet/Chronologie/evening.md", "1789-07-14 18:00");
  const morning = dated("Projet/Chronologie/morning.md", "1789-07-14 09:00");
  const harness = buildTimelineHarness({ milestones: [evening, morning] });
  assert.deepEqual(timelineTitles(render(harness)), ["morning", "evening"]);
  assert.equal(findAll(render(harness), (element) => element.classes.has("feuillets-timeline-milestone")).length, 2);
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
