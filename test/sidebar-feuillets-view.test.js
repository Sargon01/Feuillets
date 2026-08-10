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

function createSidebar(activeRightPanelTab = "notes", order = [], hiddenPanels = []) {
  const contentEl = new FakeElement();
  const listeners = { workspace: new Map(), vault: new Map() };
  const settings = new Proxy(
    { activeRightPanelTab, hiddenPanels },
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
    editionComposition: createSubView("editionComposition", calls),
    editionLayout: createSubView("editionLayout", calls),
    editionExport: createSubView("editionExport", calls),
    analyse: {
      ...createSubView("analyse", calls),
      _chaptersCache: "chapters",
      _vocabCache: "vocab",
      _dashboardCache: "dashboard",
      _romanVocabCache: "roman",
    },
    relecture: createSubView("relecture", calls),
  };
  return { sidebar, contentEl, settings, listeners, calls, order };
}

test("SidebarFeuilletsView remplace les onglets historiques docx et metadata", () => {
  assert.equal(createSidebar("docx").sidebar.activeTab, "project");
  assert.equal(createSidebar("metadata").sidebar.activeTab, "notes");
});

test("SidebarFeuilletsView démarre sur l'onglet Recherche mémorisé", () => {
  assert.equal(createSidebar("research").sidebar.activeTab, "research");
});

test("SidebarFeuilletsView n'affiche pas les onglets masqués", async () => {
  const { sidebar, contentEl } = createSidebar("notes", [], ["research"]);

  await sidebar.render();

  assert.deepEqual(contentEl.children[0].children.map((button) => button.icon), [
    "file-text", "calendar", "file-edit", "spell-check",
  ]);
});

test("SidebarFeuilletsView conserve l'ordre des quatre onglets visibles", async () => {
  const { sidebar, contentEl } = createSidebar("notes", [], ["research", "analyse"]);

  await sidebar.render();

  assert.deepEqual(contentEl.children[0].children.map((button) => button.icon), [
    "file-text", "calendar", "file-edit", "spell-check",
  ]);
});

test("SidebarFeuilletsView bascule vers le premier onglet visible si l'onglet mémorisé est masqué", async () => {
  const { sidebar } = createSidebar("research", [], ["research"]);

  await sidebar.render();

  assert.equal(sidebar.activeTab, "notes");
});

test("SidebarFeuilletsView ignore docxReview dans hiddenPanels pour l'onglet Édition", async () => {
  const { sidebar, contentEl } = createSidebar("project", [], ["docxReview"]);

  await sidebar.render();

  assert.ok(contentEl.children[0].children.some((button) => button.icon === "file-edit"));
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
  for (const tab of ["notes", "research", "journal"]) {
    calls.length = 0;
    sidebar.activeTab = tab;
    await sidebar.render();
    assert.deepEqual(calls.map((call) => call.name), [tab]);
  }
});

test("SidebarFeuilletsView rend les cinq sections de l'espace Édition dans l'ordre, dans un seul conteneur feuillets-edition-workspace", async () => {
  const { sidebar, calls } = createSidebar("project");
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  // Ordre Phase 2 : Documents éditoriaux → Composition de l'ouvrage → Mise
  // en page → Exporter → Révision DOCX.
  assert.deepEqual(
    calls.map((call) => call.name),
    ["editionDocs", "editionComposition", "editionLayout", "editionExport", "docx"]
  );
  assert.equal(container.children.length, 1, "un seul conteneur .feuillets-edition-workspace");
  const workspace = container.children[0];
  assert.ok(workspace.classes.has("feuillets-edition-workspace"));
  assert.equal(workspace.children.length, 5, "les cinq sous-vues, sans wrapper feuillets-merged-section");
});

test("SidebarFeuilletsView : correctif alignement — les cinq sections partagent le même conteneur .feuillets-edition-section-container", async () => {
  const { sidebar } = createSidebar("project");
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const workspace = container.children[0];
  for (const sectionContainer of workspace.children) {
    assert.ok(
      sectionContainer.classes.has("feuillets-edition-section-container"),
      "chaque sous-vue de l'espace Édition reçoit le conteneur frère commun"
    );
  }
  assert.ok(
    workspace.children[0].classes.has("is-first-edition-section"),
    "seule la toute première section (Documents éditoriaux) porte is-first-edition-section"
  );
  for (const sectionContainer of workspace.children.slice(1)) {
    assert.equal(
      sectionContainer.classes.has("is-first-edition-section"),
      false,
      "les sections suivantes ne portent pas is-first-edition-section"
    );
  }
});

test("SidebarFeuilletsView ne rafraîchit au file-open que les onglets liés au feuillet", async () => {
  const { sidebar, listeners, calls } = createSidebar();
  const registered = [];
  sidebar.registerEvent = (event) => registered.push(event);
  sidebar.render = async () => {};
  await sidebar.onOpen();

  for (const tab of ["notes", "research", "journal", "project", "relecture"]) {
    calls.length = 0;
    sidebar.activeTab = tab;
    listeners.workspace.get("file-open")();
    await Promise.resolve();
    assert.deepEqual(calls.map((call) => call.name), ["notes", "relecture"].includes(tab) ? [tab] : []);
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

test("SidebarFeuilletsView rend les cinq sous-vues de l'espace Édition, une seule sous-vue pour les autres onglets", async () => {
  const { sidebar, calls } = createSidebar("project");
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(
    calls.map((call) => call.name),
    ["docx", "editionDocs", "editionComposition", "editionLayout", "editionExport"]
  );

  calls.length = 0;
  sidebar.activeTab = "research";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["research"]);
});

test("SidebarFeuilletsView utilise le rendu Édition pour un onglet invalide sans écrire les réglages", async () => {
  const { sidebar, settings, calls } = createSidebar("invalide");
  await sidebar.render();

  assert.equal(settings.activeRightPanelTab, "invalide");
  assert.deepEqual(
    calls.map((call) => call.name),
    ["editionDocs", "editionComposition", "editionLayout", "editionExport", "docx"]
  );
});
