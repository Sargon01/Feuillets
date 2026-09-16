import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { MarkdownRenderer, TFile, TFolder } from "obsidian";
import { JournalView } from "../src/views/journal-view.js";
import { t } from "../src/i18n/index.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = new Map();
    this.text = options.text ?? "";
    this.style = {};
    if (options.cls) this.addClass(options.cls);
    if (options.attr) {
      for (const [name, value] of Object.entries(options.attr)) this.setAttr(name, value);
    }
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }

  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const className of classNames.split(" ")) this.classes.add(className); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs.set(name, value); }
  getAttr(name) { return this.attrs.get(name); }
  empty() { this.children = []; }
  contains() { return false; }
}

function elements(element) {
  return [element, ...element.children.flatMap(elements)];
}

function createView({ entries = [], root = new TFolder("Projet/Manuscrit"), journalFileSuffix = "", projectMeta } = {}) {
  const journal = new TFolder("Projet/Journal", entries);
  if (root) root.parent = new TFolder("Projet");
  for (const file of entries) file.parent = journal;
  const files = new Map([
    ...(root ? [[root.path, root]] : []),
    [journal.path, journal],
    ...entries.map((file) => [file.path, file]),
  ]);
  const contentEl = new FakeElement();
  const opened = [];
  const tabLeaf = { openFile(file, options) { opened.push({ file, options }); } };
  const app = {
    vault: {
      getAbstractFileByPath(path) { return files.get(path) || null; },
      async read(file) { return file.content; },
      on() { return {}; },
    },
    workspace: {
      getLeaf() { return tabLeaf; },
      setActiveLeaf() {},
      on() { return {}; },
    },
    metadataCache: { on() { return {}; } },
  };
  const calls = { render: 0, compile: 0, ensure: [] };
  const plugin = {
    settings: {
      projectFolder: root?.path,
      journalFolder: "Journal",
      journalFileSuffix,
      stats: {},
      collapsed: {},
      projectMeta: projectMeta ?? (root ? { [root.path]: {} } : {}),
    },
    getProjectFolder: () => root,
    async compileJournal() { calls.compile += 1; },
    async ensureJournalEntry(date) { calls.ensure.push(date); return new TFile("Projet/Journal/nouveau.md"); },
    async saveSettings() {},
  };
  const view = new JournalView({ app, contentEl }, plugin);
  view.renderProgressionSection = async () => {};
  return { view, contentEl, app, calls, opened, plugin };
}

test("JournalView affiche l'état vide sans projet actif", async () => {
  const { view, contentEl } = createView({ root: null });
  await view.render(true);
  assert.equal(elements(contentEl).some((element) => element.classes.has("feuillets-empty")), true);
});

test("JournalView change de mois et ouvre une date en relançant le rendu", async () => {
  const { view } = createView();
  const first = new Date(2026, 5, 1);
  view.monthCursor = first;
  view.render = async () => { view._testRenders = (view._testRenders || 0) + 1; };
  view.changeMonth(-1);
  view.changeMonth(1);
  const date = new Date(2026, 4, 12);
  view.openDay(date);
  await Promise.resolve();

  assert.equal(view.monthCursor.getMonth(), 5);
  assert.equal(view.viewedDate, date);
  assert.equal(view._testRenders, 3);
});

test("JournalView compile le carnet puis relance le rendu", async () => {
  const { view, calls } = createView();
  let rendered = 0;
  view.render = async () => { rendered += 1; };
  await view.compileCarnet();
  assert.equal(calls.compile, 1);
  assert.equal(rendered, 1);
});

test("JournalView enregistre ses trois événements avant le premier rendu", async () => {
  const { view, app } = createView();
  const events = [];
  app.workspace.on = (name) => { events.push(name); return { name }; };
  app.vault.on = (name) => { events.push(name); return { name }; };
  app.metadataCache.on = (name) => { events.push(name); return { name }; };
  const registered = [];
  let rendered = 0;
  view.registerEvent = (event) => registered.push(event);
  view.render = async () => { rendered += 1; };

  await view.onOpen();

  assert.deepEqual(events, ["file-open", "modify", "changed"]);
  assert.equal(registered.length, 3);
  assert.equal(rendered, 1);
});

test("JournalView affiche la dernière entrée sans date sélectionnée", async () => {
  const older = new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nAncienne.");
  const latest = new TFile("Projet/Journal/2026-01-03.md", "---\ndate: 2026-01-03\n---\nDernière.");
  const { view } = createView({ entries: [older, latest] });
  const originalRender = MarkdownRenderer.render;
  const rendered = [];
  MarkdownRenderer.render = async (_app, body, _el, path) => { rendered.push({ body, path }); };
  try {
    await view.renderJournalSection(new FakeElement());
  } finally {
    MarkdownRenderer.render = originalRender;
  }
  assert.deepEqual(rendered, [{ body: "Dernière.", path: latest.path }]);
});

test("JournalView affiche la dernière entrée suffixée avec une date lisible, sans le suffixe", async () => {
  const entry = new TFile("Projet/Journal/2026-01-03-log.md", "---\ndate: 2026-01-03\n---\nEntrée suffixée.");
  const { view } = createView({ entries: [entry], journalFileSuffix: "log" });
  const wrapper = new FakeElement();
  const originalRender = MarkdownRenderer.render;
  const rendered = [];
  MarkdownRenderer.render = async (_app, body, _el, path) => { rendered.push({ body, path }); };
  try {
    await view.renderJournalSection(wrapper);
  } finally {
    MarkdownRenderer.render = originalRender;
  }
  assert.deepEqual(rendered, [{ body: "Entrée suffixée.", path: entry.path }]);
  const dateSpan = elements(wrapper).find((element) => element.classes.has("feuillets-journal-open-date"));
  assert.ok(dateSpan, "date affichée");
  assert.doesNotMatch(dateSpan.text, /invalid/i);
  assert.match(dateSpan.text, /2026/);
});

test("JournalView affiche l'entrée correspondant à la date sélectionnée", async () => {
  const entry = new TFile("Projet/Journal/2026-01-03.md", "---\ndate: 2026-01-03\n---\nJour choisi.");
  const { view } = createView({ entries: [entry] });
  view.viewedDate = new Date(2026, 0, 3);
  const originalRender = MarkdownRenderer.render;
  const rendered = [];
  MarkdownRenderer.render = async (_app, body, _el, path) => { rendered.push({ body, path }); };
  try {
    await view.renderJournalSection(new FakeElement());
  } finally {
    MarkdownRenderer.render = originalRender;
  }
  assert.deepEqual(rendered, [{ body: "Jour choisi.", path: entry.path }]);
});

test("JournalView permet de créer une entrée absente pour le jour sélectionné", async () => {
  const { view, contentEl, calls, opened } = createView();
  view.viewedDate = new Date(2026, 0, 4);
  let rerendered = 0;
  view.render = async () => { rerendered += 1; };
  await view.renderJournalSection(contentEl);
  const createButton = elements(contentEl).find((element) => element.tag === "button" && element.classes.has("mod-cta"));
  await createButton.events.get("click")();

  assert.deepEqual(calls.ensure, [view.viewedDate]);
  assert.equal(opened.length, 1);
  assert.equal(rerendered, 1);
});

test("JournalView ne rerend pas pendant une édition, sauf avec force", async () => {
  const { view, contentEl } = createView();
  let journalRenders = 0;
  view.renderJournalSection = async () => { journalRenders += 1; };
  view.renderProgressionSection = async () => {};
  const previousDocument = globalThis.document;
  contentEl.contains = () => true;
  globalThis.document = { activeElement: { tagName: "TEXTAREA" } };
  try {
    await view.render();
    await view.render(true);
  } finally {
    globalThis.document = previousDocument;
  }
  assert.equal(journalRenders, 1);
});

test("JournalView ouvre une entrée sans modifier son contenu", async () => {
  const entry = new TFile("Projet/Journal/2026-01-03.md", "---\ndate: 2026-01-03\n---\nInchangée.");
  const { view, opened } = createView({ entries: [entry] });
  const wrapper = new FakeElement();
  const originalRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async () => {};
  try {
    await view.renderJournalSection(wrapper);
  } finally {
    MarkdownRenderer.render = originalRender;
  }
  const dateLink = elements(wrapper).find((element) => element.classes.has("feuillets-journal-open-date"));
  dateLink.events.get("click")();

  assert.equal(opened[0].file, entry);
  assert.equal(entry.content, "---\ndate: 2026-01-03\n---\nInchangée.");
});

test("JournalView : le calendrier n'affiche que les statistiques du projet actif, jamais un autre projet ni l'historique legacy", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const projectMeta = {
    [root.path]: { journalStats: { [key]: { start: 1000, latest: 1300 } } },
    "Autre/Manuscrit": { journalStats: { [key]: { start: 1000, latest: 9999 } } },
  };
  const { view, contentEl } = createView({ root, projectMeta });
  view.plugin.settings.stats = { [key]: { start: 1000, latest: 5000 } };

  await view.render(true);

  const todayCell = elements(contentEl).find((el) => el.classes.has("feuillets-journal-cell-today"));
  assert.ok(todayCell, "cellule du jour trouvée");
  const title = todayCell.getAttr("title");
  assert.match(title, /\b300\b/);
  assert.doesNotMatch(title, /9999/);
  assert.doesNotMatch(title, /5000/);
});

// ==================== Accessibilité et navigation du calendrier ====================

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayButtons(contentEl) {
  return elements(contentEl).filter((el) => el.tag === "button" && el.classes.has("feuillets-journal-cell"));
}

function findDayButton(contentEl, day) {
  return dayButtons(contentEl).find((cell) =>
    cell.children.some((child) => child.classes.has("feuillets-journal-daynum") && child.text === String(day))
  );
}

test("JournalView : les contrôles Mois précédent/suivant sont de vrais boutons accessibles qui changent le mois", async () => {
  const { view, contentEl } = createView();
  view.monthCursor = new Date(2026, 5, 1);
  await view.render(true);

  const navButtons = elements(contentEl).filter((el) => el.tag === "button" && el.classes.has("feuillets-journal-nav-btn"));
  assert.equal(navButtons.length, 2, "deux boutons de navigation (précédent, suivant)");
  const [prevBtn, nextBtn] = navButtons;
  assert.equal(prevBtn.getAttr("aria-label"), t("journal.previousMonth"));
  assert.equal(nextBtn.getAttr("aria-label"), t("journal.nextMonth"));

  let renders = 0;
  view.render = async () => { renders += 1; };
  prevBtn.events.get("click")();
  assert.equal(view.monthCursor.getMonth(), 4, "mois précédent appliqué");
  nextBtn.events.get("click")();
  assert.equal(view.monthCursor.getMonth(), 5, "mois suivant ramène au mois de départ");
  assert.equal(renders, 2);
});

test("JournalView : le bouton Aujourd'hui est accessible, replace le mois courant, sélectionne aujourd'hui et ne rend qu'une fois", async () => {
  const { view, contentEl } = createView();
  view.monthCursor = new Date(2020, 0, 1);
  view.viewedDate = new Date(2020, 0, 15);
  await view.render(true);

  const todayBtn = elements(contentEl).find((el) => el.tag === "button" && el.classes.has("feuillets-journal-today-btn"));
  assert.ok(todayBtn, "bouton Aujourd'hui trouvé");
  assert.equal(todayBtn.getAttr("aria-label"), t("journal.today"));

  let renders = 0;
  view.render = async () => { renders += 1; };
  todayBtn.events.get("click")();

  const now = new Date();
  assert.equal(view.monthCursor.getFullYear(), now.getFullYear());
  assert.equal(view.monthCursor.getMonth(), now.getMonth());
  assert.equal(view.monthCursor.getDate(), 1, "monthCursor ramené au premier jour du mois courant");
  assert.equal(view.viewedDate.getFullYear(), now.getFullYear());
  assert.equal(view.viewedDate.getMonth(), now.getMonth());
  assert.equal(view.viewedDate.getDate(), now.getDate(), "viewedDate ramené à aujourd'hui, normalisé année/mois/jour");
  assert.equal(renders, 1, "un seul rendu déclenché");
});

test("JournalView : les jours réels sont des boutons type=\"button\", les cellules de remplissage restent des div non interactives", async () => {
  const { view, contentEl } = createView();
  view.monthCursor = new Date(2026, 8, 1); // septembre 2026 : 1er = mardi, une cellule de remplissage
  await view.render(true);

  const filler = elements(contentEl).find((el) => el.classes.has("feuillets-journal-cell-empty"));
  assert.ok(filler, "au moins une cellule de remplissage");
  assert.equal(filler.tag, "div", "la cellule de remplissage n'est pas un bouton");
  assert.equal(filler.events.has("click"), false);

  const realDays = dayButtons(contentEl);
  assert.ok(realDays.length >= 28, "tous les jours réels du mois sont rendus");
  for (const cell of realDays) {
    assert.equal(cell.tag, "button");
    assert.equal(cell.getAttr("type"), "button");
  }
});

test("JournalView : le jour courant porte aria-current=\"date\"", async () => {
  const { view, contentEl } = createView();
  await view.render(true);

  const todayCell = elements(contentEl).find((el) => el.tag === "button" && el.classes.has("feuillets-journal-cell-today"));
  assert.ok(todayCell, "cellule du jour courant trouvée");
  assert.equal(todayCell.getAttr("aria-current"), "date");
});

test("JournalView : le jour sélectionné porte feuillets-journal-cell-selected et aria-pressed=\"true\", les autres aria-pressed=\"false\"", async () => {
  const { view, contentEl } = createView();
  const today = new Date();
  view.viewedDate = new Date(today.getFullYear(), today.getMonth(), 1);
  await view.render(true);

  const cells = dayButtons(contentEl);
  const selected = cells.filter((cell) => cell.classes.has("feuillets-journal-cell-selected"));
  assert.equal(selected.length, 1, "un seul jour sélectionné");
  assert.equal(selected[0].getAttr("aria-pressed"), "true");

  const others = cells.filter((cell) => !cell.classes.has("feuillets-journal-cell-selected"));
  assert.ok(others.length > 0);
  for (const cell of others) assert.equal(cell.getAttr("aria-pressed"), "false");
});

test("JournalView : aujourd'hui peut être courant sans être sélectionné, et une autre date peut être sélectionnée", async () => {
  const { view, contentEl } = createView();
  const today = new Date();
  // Sélectionne un jour différent d'aujourd'hui (jour 1, sauf si c'est déjà
  // aujourd'hui — dans ce cas jour 2, toujours valide dans tout mois).
  const otherDay = today.getDate() === 1 ? 2 : 1;
  view.viewedDate = new Date(today.getFullYear(), today.getMonth(), otherDay);
  await view.render(true);

  const todayCell = elements(contentEl).find((el) => el.tag === "button" && el.classes.has("feuillets-journal-cell-today"));
  const selectedCell = dayButtons(contentEl).find((el) => el.classes.has("feuillets-journal-cell-selected"));
  assert.ok(todayCell);
  assert.ok(selectedCell);
  assert.notEqual(todayCell, selectedCell, "aujourd'hui et le jour sélectionné sont deux cellules distinctes ici");
  assert.equal(todayCell.classes.has("feuillets-journal-cell-selected"), false);
  assert.equal(selectedCell.classes.has("feuillets-journal-cell-today"), false);
});

test("JournalView : quand viewedDate est null, aucune cellule n'est sélectionnée", async () => {
  const { view, contentEl } = createView();
  view.viewedDate = null;
  await view.render(true);

  const selected = elements(contentEl).filter((el) => el.classes.has("feuillets-journal-cell-selected"));
  assert.equal(selected.length, 0);
});

test("JournalView : le aria-label d'un jour contient la date, le nombre de mots et l'indication d'entrée quand elle existe", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const today = new Date();
  const key = dayKey(today);
  const entry = new TFile(`Projet/Journal/${key}.md`, `---\ndate: ${key}\n---\nAujourd'hui.`);
  const projectMeta = { [root.path]: { journalStats: { [key]: { start: 1000, latest: 1450 } } } };
  const { view, contentEl } = createView({ root, entries: [entry], projectMeta });
  await view.render(true);

  const todayCell = elements(contentEl).find((el) => el.tag === "button" && el.classes.has("feuillets-journal-cell-today"));
  assert.ok(todayCell);
  const label = todayCell.getAttr("aria-label");
  assert.match(label, /450/, "le nombre de mots (delta) figure dans le libellé");
  assert.match(label, new RegExp(String(today.getFullYear())), "la date complète figure dans le libellé");
  assert.match(label, new RegExp(t("journal.entryAvailable")), "l'entrée existante est indiquée");
  assert.equal(todayCell.getAttr("title"), label);
});

test("JournalView : le aria-label n'indique pas d'entrée quand aucune n'existe pour ce jour", async () => {
  const { view, contentEl } = createView();
  await view.render(true);

  const todayCell = elements(contentEl).find((el) => el.tag === "button" && el.classes.has("feuillets-journal-cell-today"));
  assert.ok(todayCell);
  assert.doesNotMatch(todayCell.getAttr("aria-label"), new RegExp(t("journal.entryAvailable")));
});

test("JournalView : le pluriel de journal.dayWordsAria distingue 0, 1 et 2 mots", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const today = new Date();
  const dateFor = (day) => new Date(today.getFullYear(), today.getMonth(), day);
  const projectMeta = {
    [root.path]: {
      journalStats: {
        [dayKey(dateFor(2))]: { start: 100, latest: 101 }, // delta 1
        [dayKey(dateFor(3))]: { start: 100, latest: 102 }, // delta 2
      },
    },
  };
  const { view, contentEl } = createView({ root, projectMeta });
  await view.render(true);

  const cellZero = findDayButton(contentEl, 1); // aucune entrée dans journalStats -> delta 0
  const cellOne = findDayButton(contentEl, 2);
  const cellTwo = findDayButton(contentEl, 3);
  assert.ok(cellZero && cellOne && cellTwo);

  assert.match(cellZero.getAttr("aria-label"), /\b0 mots\b/);
  assert.match(cellOne.getAttr("aria-label"), /\b1 mot\b/);
  assert.doesNotMatch(cellOne.getAttr("aria-label"), /\b1 mots\b/);
  assert.match(cellTwo.getAttr("aria-label"), /\b2 mots\b/);
});

test("styles.css : focus-visible et l'état sélectionné du calendrier sont définis, sans !important", async () => {
  const css = await readFile("styles.css", "utf8");
  const start = css.indexOf(".feuillets-journal-cell {");
  const end = css.indexOf(".feuillets-journal-last-entry-date", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const journalCellBlock = css.slice(start, end);

  assert.match(journalCellBlock, /\.feuillets-journal-cell-selected/);
  assert.match(journalCellBlock, /\.feuillets-journal-cell:focus-visible/);
  assert.match(journalCellBlock, /\.feuillets-journal-nav-btn:focus-visible/);
  assert.doesNotMatch(journalCellBlock, /!important/);
});
