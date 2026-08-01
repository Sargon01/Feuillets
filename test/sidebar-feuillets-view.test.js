import assert from "node:assert/strict";
import test from "node:test";
import { SidebarFeuilletsView } from "../src/views/sidebar-feuillets-view.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = new Map();
    if (options.cls) this.addClass(options.cls);
  }

  createDiv(options = {}) {
    const child = new FakeElement(options);
    this.children.push(child);
    return child;
  }

  addClass(classNames) {
    for (const className of classNames.split(" ")) this.classes.add(className);
  }

  setAttr(name, value) { this.attrs.set(name, value); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
}

function createSubView(name, calls) {
  return {
    targetContainer: null,
    async render(force) { calls.push({ name, force, targetContainer: this.targetContainer }); },
  };
}

function createSidebar(activeRightPanelTab = "notes", order = []) {
  const contentEl = new FakeElement();
  const listeners = { workspace: new Map(), vault: new Map() };
  const settings = new Proxy(
    { activeRightPanelTab },
    {
      set(target, key, value) {
        if (key === "activeRightPanelTab") order.push("settings");
        target[key] = value;
        return true;
      },
    }
  );
  const app = {
    workspace: { on(name, callback) { listeners.workspace.set(name, callback); return { name }; } },
    vault: { on(name, callback) { listeners.vault.set(name, callback); return { name }; } },
  };
  const plugin = {
    settings,
    async saveSettings() { order.push("save"); },
  };
  const sidebar = new SidebarFeuilletsView({ app, contentEl }, plugin);
  const calls = [];
  sidebar.subViews = {
    notes: createSubView("notes", calls),
    research: createSubView("research", calls),
    journal: createSubView("journal", calls),
    project: createSubView("project", calls),
    docx: createSubView("docx", calls),
    editionDocs: createSubView("editionDocs", calls),
    analyse: {
      ...createSubView("analyse", calls),
      _chaptersCache: "chapters",
      _vocabCache: "vocab",
      _dashboardCache: "dashboard",
      _romanVocabCache: "roman",
    },
  };
  return { sidebar, contentEl, settings, listeners, calls, order };
}

test("SidebarFeuilletsView remplace les onglets historiques docx et metadata", () => {
  assert.equal(createSidebar("docx").sidebar.activeTab, "project");
  assert.equal(createSidebar("metadata").sidebar.activeTab, "notes");
});

test("SidebarFeuilletsView sauvegarde l'onglet avant de relancer le rendu", async () => {
  const { sidebar, contentEl, order } = createSidebar("notes");
  await sidebar.render();
  const projectButton = contentEl.children[0].children[3];
  let activeTab = sidebar.activeTab;
  Object.defineProperty(sidebar, "activeTab", {
    get: () => activeTab,
    set: (value) => { order.push("activeTab"); activeTab = value; },
  });
  sidebar.render = async () => { order.push("render"); };

  await projectButton.events.get("click")();

  assert.deepEqual(order, ["activeTab", "settings", "save", "render"]);
});

test("SidebarFeuilletsView rend uniquement la sous-vue de l'onglet sélectionné", async () => {
  const { sidebar, calls } = createSidebar();
  for (const tab of ["notes", "research", "journal", "analyse"]) {
    calls.length = 0;
    sidebar.activeTab = tab;
    await sidebar.render();
    assert.deepEqual(calls.map((call) => call.name), [tab]);
  }
});

test("SidebarFeuilletsView rend Révision DOCX et les documents éditoriaux dans le nouvel onglet Édition", async () => {
  const { sidebar, calls } = createSidebar("project");
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  assert.deepEqual(calls.map((call) => call.name), ["docx", "editionDocs"]);
  assert.equal(container.children.length, 2);
});

test("SidebarFeuilletsView ne rafraîchit au file-open que les onglets liés au feuillet", async () => {
  const { sidebar, listeners, calls } = createSidebar();
  const registered = [];
  sidebar.registerEvent = (event) => registered.push(event);
  sidebar.render = async () => {};
  await sidebar.onOpen();

  for (const tab of ["notes", "research", "journal", "project", "analyse"]) {
    calls.length = 0;
    sidebar.activeTab = tab;
    listeners.workspace.get("file-open")();
    await Promise.resolve();
    assert.deepEqual(calls.map((call) => call.name), ["notes", "analyse"].includes(tab) ? [tab] : []);
  }
  assert.equal(registered.length, 2);
});

test("SidebarFeuilletsView invalide les caches Analyse à la modification", async () => {
  const { sidebar, listeners } = createSidebar();
  sidebar.registerEvent = () => {};
  sidebar.render = async () => {};
  await sidebar.onOpen();
  listeners.vault.get("modify")();

  assert.equal(sidebar.subViews.analyse._chaptersCache, null);
  assert.equal(sidebar.subViews.analyse._dashboardCache, null);
  assert.equal(sidebar.subViews.notes.targetContainer, null);
});

test("SidebarFeuilletsView rend Révision DOCX et documents éditoriaux pour l'onglet Édition, une seule sous-vue pour les autres", async () => {
  const { sidebar, calls } = createSidebar("project");
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["docx", "editionDocs"]);

  calls.length = 0;
  sidebar.activeTab = "research";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["research"]);
});

test("SidebarFeuilletsView utilise le rendu Édition pour un onglet invalide sans écrire les réglages", async () => {
  const { sidebar, settings, calls } = createSidebar("invalide");
  await sidebar.render();

  assert.equal(settings.activeRightPanelTab, "invalide");
  assert.deepEqual(calls.map((call) => call.name), ["docx", "editionDocs"]);
});
