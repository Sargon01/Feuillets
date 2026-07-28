import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownRenderer, TFile, TFolder } from "obsidian";
import { JournalView } from "../src/views/journal-view.js";

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

function createView({ entries = [], root = new TFolder("Projet/Manuscrit") } = {}) {
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
    settings: { projectFolder: root?.path, journalFolder: "Journal", stats: {}, collapsed: {} },
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
