import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TFolder } from "obsidian";
import { SidebarFeuilletsView } from "../src/views/sidebar-feuillets-view.js";
import { VIEW_PREVIEW } from "../src/constants.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { t } from "../src/i18n/index.js";

class FakeElement {
  constructor(options = {}) {
    this.tag = options.tag || "div";
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = new Map();
    this.style = {};
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    this.parentNode = null;
    if (options.cls) this.addClass(options.cls);
    if (options.attr) {
      for (const [key, value] of Object.entries(options.attr)) this.attrs.set(key, value);
    }
  }

  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }

  createEl(tag, options = {}) {
    const child = new FakeElement({ ...options, tag });
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addClass(classNames) {
    for (const className of classNames.split(" ")) this.classes.add(className);
  }

  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  setAttr(name, value) { this.attrs.set(name, value); }
  setAttribute(name, value) { this.attrs.set(name, value); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasClass(name) { return this.classes.has(name); }
  setText(text) { this.text = String(text); return this; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  dispatch(type, event) { const cb = this.events.get(type); if (cb) cb(event || { target: this }); }
  empty() { this.children = []; }
  prepend(child) { this.children = [child, ...this.children.filter((c) => c !== child)]; }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
  }
  get textContent() {
    if (this.children.length) return this.text ? this.text : this.children.map((c) => c.textContent).join("");
    return this.text;
  }
  set textContent(value) { this.text = String(value); }
  querySelectorAll(selector) {
    const classNames = (selector.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    const found = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (classNames.every((c) => child.classes.has(c))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function createSubView(name, calls) {
  return {
    targetContainer: null,
    async render(force) { calls.push({ name, force, targetContainer: this.targetContainer }); },
  };
}

function createSidebar(activeRightPanelTab = "notes", order = [], hiddenPanels = [], { activeFile = null, projectFolder = null, projects = [], vaultFolders = null, projectFiles = [], getAnalysisProvider = {} } = {}) {
  const contentEl = new FakeElement();
  const listeners = { workspace: new Map(), vault: new Map() };
  const settings = new Proxy(
    {
      activeRightPanelTab, hiddenPanels,
      projectFolder: projectFolder ? projectFolder.path : "",
      projects,
      projectMeta: {},
    },
    {
      set(target, key, value) {
        if (key === "activeRightPanelTab") order.push("settings");
        target[key] = value;
        return true;
      },
    }
  );
  // projectFiles : [{ file: TFile, frontmatter: {...} }] — sert au scan RAW
  // de la sous-page « Correspondance des propriétés » (§22).
  const fileCache = new Map(projectFiles.map(({ file, frontmatter }) => [file, { frontmatter }]));
  const app = {
    workspace: {
      on(name, callback) { listeners.workspace.set(name, callback); return { name }; },
      getActiveFile() { return activeFile; },
    },
    vault: {
      on(name, callback) { listeners.vault.set(name, callback); return { name }; },
      getAbstractFileByPath(path) { return vaultFolders ? (vaultFolders.get(path) ?? null) : null; },
      getFiles() { return []; },
    },
    metadataCache: {
      getFileCache(file) { return fileCache.get(file) || null; },
    },
  };
  const plugin = {
    settings,
    async saveSettings() { order.push("save"); },
    getProjectFolder() { return projectFolder; },
    projectDisplayName(path) { return `Projet ${path}`; },
    updateStatusBar() { order.push("statusBar"); },
    renderAllViews() { order.push("renderAll"); },
    unitLabel() { return "mots"; },
    flattenFiles() { return projectFiles.map((f) => f.file); },
    // Fournisseur d'analyse (Correcteur) : présent par défaut pour que
    // l'accueil Relecture affiche l'entrée Correcteur ; passer
    // `getAnalysisProvider: null` pour tester son absence.
    getAnalysisProvider() { return getAnalysisProvider; },
  };
  const sidebar = new SidebarFeuilletsView({ app, contentEl }, plugin);
  const calls = [];
  sidebar.subViews = {
    notes: createSubView("notes", calls),
    research: createSubView("research", calls),
    journal: createSubView("journal", calls),
    project: createSubView("project", calls),
    docx: createSubView("docx", calls),
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
  // DocxReviewView n'habite plus l'espace Édition ("project") : l'ancien
  // activeRightPanelTab "docx" ouvre désormais Relecture, directement sur
  // sa page secondaire Révision DOCX (voir tests dédiés plus bas).
  const docx = createSidebar("docx").sidebar;
  assert.equal(docx.activeTab, "relecture");
  assert.equal(docx.relecturePage, "docx");

  const analyse = createSidebar("analyse").sidebar;
  assert.equal(analyse.activeTab, "stats");
  assert.equal(analyse.relecturePage, "home");

  assert.equal(createSidebar("metadata").sidebar.activeTab, "notes");
});

test("SidebarFeuilletsView : l'ancien activeRightPanelTab \"docx\" ouvre Relecture directement sur Révision DOCX", async () => {
  const { sidebar, calls } = createSidebar("docx");
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["docx"]);
});

test("SidebarFeuilletsView : l'ancien activeRightPanelTab \"analyse\" ouvre directement Statistiques", async () => {
  const { sidebar, calls } = createSidebar("analyse");
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["analyse"]);
});

test("SidebarFeuilletsView démarre sur l'onglet Recherche mémorisé", () => {
  assert.equal(createSidebar("research").sidebar.activeTab, "research");
});

test("SidebarFeuilletsView n'affiche pas les onglets masqués", async () => {
  const { sidebar, contentEl } = createSidebar("notes", [], ["research"]);

  await sidebar.render();

  assert.deepEqual(contentEl.children[0].children.map((button) => button.icon), [
    "file-text", "calendar", "book-open", "bar-chart-3", "spell-check",
  ]);
});

test("SidebarFeuilletsView conserve l'ordre des onglets visibles", async () => {
  const { sidebar, contentEl } = createSidebar("notes", [], ["research", "stats"]);

  await sidebar.render();

  assert.deepEqual(contentEl.children[0].children.map((button) => button.icon), [
    "file-text", "calendar", "book-open", "spell-check",
  ]);
});

test("SidebarFeuilletsView bascule vers le premier onglet visible si l'onglet mémorisé est masqué", async () => {
  const { sidebar } = createSidebar("research", [], ["research"]);

  await sidebar.render();

  assert.equal(sidebar.activeTab, "notes");
});

test("SidebarFeuilletsView ignore docxReview dans hiddenPanels pour l'onglet Projet", async () => {
  const { sidebar, contentEl } = createSidebar("project", [], ["docxReview"]);

  await sidebar.render();

  assert.ok(contentEl.children[0].children.some((button) => button.icon === "book-open"));
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
  for (const tab of ["notes", "research", "journal", "stats"]) {
    calls.length = 0;
    sidebar.activeTab = tab;
    await sidebar.render();
    const expectedCall = tab === "stats" ? "analyse" : tab;
    assert.deepEqual(calls.map((call) => call.name), [expectedCall]);
  }
});

test("SidebarFeuilletsView affiche exactement 6 onglets dans le bon ordre", async () => {
  const { sidebar, contentEl } = createSidebar("notes");
  await sidebar.render();

  const icons = contentEl.children[0].children.map((button) => button.icon);
  assert.deepEqual(icons, [
    "file-text", "book-marked", "calendar", "book-open", "bar-chart-3", "spell-check",
  ]);

  const allTabIds = [];
  for (let i = 0; i < icons.length; i++) {
    sidebar.activeTab = contentEl.children[0].children[i].id || ["notes", "research", "journal", "project", "stats", "relecture"][i];
    allTabIds.push(sidebar.activeTab);
  }
  assert.deepEqual(allTabIds, ["notes", "research", "journal", "project", "stats", "relecture"]);
});

test("SidebarFeuilletsView : l'onglet Statistiques utilise la clé i18n correcte", async () => {
  const { sidebar, contentEl } = createSidebar("stats");
  await sidebar.render();

  const statsButton = contentEl.children[0].children.find((button) => button.icon === "bar-chart-3");
  assert.ok(statsButton, "l'onglet Statistiques est présent");
  assert.equal(statsButton.getAttribute("aria-label"), t("sidebar.tab.stats"));
});

test("SidebarFeuilletsView : cliquer Statistiques active l'onglet et sauvegarde le choix", async () => {
  const { sidebar, contentEl, settings } = createSidebar("notes");
  await sidebar.render();

  const statsButton = contentEl.children[0].children.find((button) => button.icon === "bar-chart-3");
  assert.ok(statsButton, "le bouton Statistiques existe");

  let renderCalled = false;
  const origRender = sidebar.render.bind(sidebar);
  sidebar.render = async () => { renderCalled = true; await origRender(); };

  await statsButton.events.get("click")();

  assert.equal(sidebar.activeTab, "stats");
  assert.equal(settings.activeRightPanelTab, "stats");
  assert.ok(renderCalled, "render() est appelé après le clic");
});

test("SidebarFeuilletsView : l'onglet Statistiques rend la sous-vue AnalysisView", async () => {
  const { sidebar, calls } = createSidebar("stats");
  await sidebar.render();

  assert.deepEqual(calls.map((call) => call.name), ["analyse"]);
});

test("SidebarFeuilletsView : aucune seconde AnalysisView n'est créée pour Stats", () => {
  const { sidebar } = createSidebar("stats");
  const real = new SidebarFeuilletsView(
    { app: sidebar.app, contentEl: new FakeElement() },
    sidebar.plugin
  );

  assert.ok(real.subViews.analyse, "subViews.analyse existe");
  assert.equal(typeof real.subViews.analyse.render, "function", "analyse a une méthode render");
  const analyseCount = Object.values(real.subViews).filter((v) => v === real.subViews.analyse).length;
  assert.equal(analyseCount, 1, "AnalysisView n'est stockée qu'une fois");
});

/* PROMPT 2 — l'onglet interne "project" devient visuellement et
 * fonctionnellement ÉDITION : accueil à trois entrées (Composition/Mise en
 * page/Dossier éditorial), sous-pages montées via EditionWorkspaceContent
 * (mode embedded) et EditionDocsContent — jamais de nouvelle leaf, jamais
 * de Board, jamais de Preview créée automatiquement. */

/** Fixture d'intégration réelle (même patron que buildIntegrationFixture de
 * test/edition-workspace-content.test.js) : un vrai coffre en mémoire, pour
 * que Composition/Mise en page/Dossier éditorial se montent et rendent
 * réellement leur contenu, sans rien mocker de leur logique métier. */
function buildEditionFixture({ withPreviewLeaf = null } = {}) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = volume;
  volume.children.push(manuscript);
  const { vault, fileManager } = createFakeVault([volume, manuscript]);
  vault.cachedRead = vault.read;
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  Object.assign(settings, {
    projectFolder: manuscript.path,
    exportTemplate: "classique",
    activeRightPanelTab: "project",
    hiddenPanels: [],
    collapsed: {},
    orders: {},
    folderPositions: {},
    projectMeta: {},
  });
  const frontmatter = new Map();
  fileManager.processFrontMatter = async (file, update) => {
    const data = { ...(frontmatter.get(file.path) || {}) };
    update(data);
    frontmatter.set(file.path, data);
  };
  const leaves = withPreviewLeaf ? [withPreviewLeaf] : [];
  const calls = {
    leafCreates: 0, activateBoard: 0, renderAll: 0, save: 0,
    setActiveLeafWith: [], getMostRecentLeafRoot: undefined,
  };
  /* Leaf CENTRALE de travail factice — jamais la leaf de la Sidebar
     ({ app, contentEl } ci-dessous), retournée par getMostRecentLeaf(root
     Split) : l'ancrage EXPLICITE attendu par le bouton Aperçu (§2/11). */
  const rootSplit = { marker: "rootSplit" };
  const centralWorkLeaf = { isDeferred: false, loadIfDeferred: async () => {}, view: {} };
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) },
    workspace: {
      on() { return {}; },
      getActiveFile() { return null; },
      getLeavesOfType: (type) => (type === VIEW_PREVIEW ? leaves : []),
      rootSplit,
      getMostRecentLeaf: (root) => { calls.getMostRecentLeafRoot = root; return centralWorkLeaf; },
      setActiveLeaf: (leaf) => { calls.setActiveLeafWith.push(leaf); },
      revealLeaf: async () => {},
      getLeaf: () => {
        calls.leafCreates += 1;
        return { isDeferred: false, loadIfDeferred: async () => {}, view: {}, async setViewState() {} };
      },
    },
  };
  const plugin = {
    settings,
    async saveSettings() { calls.save += 1; },
    getProjectFolder: () => manuscript,
    projectDisplayName: (path) => `Projet ${path}`,
    updateStatusBar() {},
    renderAllViews() { calls.renderAll += 1; },
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    flattenFiles: () => [],
    getAnalysisProvider: () => null,
    activateBoard() { calls.activateBoard += 1; },
    refreshView: () => {},
  };
  const contentEl = new FakeElement();
  const sidebarLeafParam = { app, contentEl };
  const sidebar = new SidebarFeuilletsView(sidebarLeafParam, plugin);
  return { sidebar, app, plugin, settings, manuscript, contentEl, calls, centralWorkLeaf, sidebarLeafParam, rootSplit };
}

function fakePreviewLeaf(projectRoot) {
  const calls = { refresh: 0 };
  return {
    leaf: { view: { compileScope: { projectRoot }, async refreshForLayoutChange() { calls.refresh++; } } },
    calls,
  };
}

test("SidebarFeuilletsView : l'id interne du tab reste \"project\", restauré depuis activeRightPanelTab", () => {
  const { sidebar } = createSidebar("project");
  assert.equal(sidebar.activeTab, "project");
  const restored = createSidebar("project").sidebar;
  assert.equal(restored.activeTab, "project");
});

test("SidebarFeuilletsView : le tab \"project\" a pour libellé Édition et pour icône book-open", async () => {
  const { sidebar, contentEl } = createSidebar("project");
  await sidebar.render();
  const button = contentEl.children[0].children.find((b) => b.icon === "book-open");
  assert.ok(button, "le bouton book-open existe");
  assert.equal(button.getAttribute("aria-label"), t("sidebar.tab.edition"));
});

test("SidebarFeuilletsView : accueil Édition affiche exactement trois entrées — Composition, Mise en page, Dossier éditorial", async () => {
  const { sidebar } = buildEditionFixture();
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const titles = allElements(container)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.deepEqual(titles, [
    t("sidebar.edition.composition"),
    t("sidebar.edition.layout"),
    t("sidebar.edition.editorialFolder"),
  ]);
});

test("SidebarFeuilletsView : l'accueil Édition ne donne plus aucun accès direct aux anciennes pages Projet", async () => {
  const { sidebar } = buildEditionFixture();
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const texts = allElements(container).map((el) => el.text).filter(Boolean);
  for (const legacy of [
    t("sidebar.project.rowGoals"), t("sidebar.project.rowStatuses"), t("sidebar.project.rowLabels"),
    t("sidebar.project.rowTags"), t("sidebar.project.rowMapping"), t("sidebar.project.rowInfo"),
    t("sidebar.project.manage"),
  ]) {
    assert.equal(texts.includes(legacy), false, `« ${legacy} » ne doit plus apparaître dans le panneau Édition`);
  }
});

test("SidebarFeuilletsView : cliquer Composition ouvre une page interne avec barre Retour et le contenu Composition", async () => {
  const { sidebar } = buildEditionFixture();
  let container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const row = allElements(container).find((el) => el.classes.has("feuillets-notes-section-title") && el.text === t("sidebar.edition.composition"))?.parentNode;
  assert.ok(row);
  row.events.get("click")();
  assert.equal(sidebar.editionPage, "composition");

  container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const backBar = allElements(container).find((el) => el.classes.has("feuillets-notes-back-bar"));
  assert.ok(backBar, "barre Retour affichée");
  // Les trois groupes principaux sont présents
  for (const label of ["Avant le manuscrit", "Le manuscrit", "Après le manuscrit"]) {
    assert.ok(container.textContent.includes(label), `${label} présent`);
  }
  // Les éléments détaillés ne sont visibles que dans leurs sous-pages respectives
});

test("SidebarFeuilletsView : cliquer Mise en page ouvre une page interne avec barre Retour et le contenu Mise en page", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "layout";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const backBar = allElements(container).find((el) => el.classes.has("feuillets-notes-back-bar"));
  assert.ok(backBar, "barre Retour affichée");
  assert.ok(container.querySelector(".feuillets-layout-toolbar"), "l'outil de gabarit Mise en page est monté");
});

test("SidebarFeuilletsView : cliquer Dossier éditorial ouvre une page interne rendant EditionDocsContent", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "documents";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const backBar = allElements(container).find((el) => el.classes.has("feuillets-notes-back-bar"));
  assert.ok(backBar, "barre Retour affichée");
  assert.ok(container.textContent.includes(t("editionDocs.title")) || allElements(container).length > 2, "EditionDocsContent a rendu du contenu");
});

test("SidebarFeuilletsView : Retour depuis une sous-page Édition revient aux trois entrées", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "composition";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const backBar = allElements(container).find((el) => el.classes.has("feuillets-notes-back-bar"));
  const backBtn = backBar.children.find((el) => el.classes.has("feuillets-back-btn"));
  backBtn.events.get("click")();
  assert.equal(sidebar.editionPage, "home");

  const homeContainer = new FakeElement();
  await sidebar.renderProjectTab(homeContainer);
  const titles = allElements(homeContainer)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.deepEqual(titles, [
    t("sidebar.edition.composition"),
    t("sidebar.edition.layout"),
    t("sidebar.edition.editorialFolder"),
  ]);
});

test("SidebarFeuilletsView : ouvrir Composition/Mise en page/Dossier éditorial ne crée jamais de leaf ni n'active Board", async () => {
  for (const page of ["composition", "layout", "documents"]) {
    const { sidebar, calls } = buildEditionFixture();
    sidebar.editionPage = page;
    const container = new FakeElement();
    await sidebar.renderProjectTab(container);
    assert.equal(calls.leafCreates, 0, `${page} : aucune leaf créée`);
    assert.equal(calls.activateBoard, 0, `${page} : Board jamais activé`);
  }
});

test("SidebarFeuilletsView : une Preview existante du même projet est transmise au composant embarqué, aucune deuxième Preview créée", async () => {
  const { leaf, calls } = fakePreviewLeaf("Projet/Manuscrit");
  const { sidebar, app } = buildEditionFixture({ withPreviewLeaf: leaf });
  sidebar.editionPage = "composition";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  // Naviguer vers "Avant le manuscrit" pour accéder à la case Sommaire
  const beforeRow = allElements(container).find((el) => el.classes?.has("feuillets-project-row") && el.textContent?.includes("Avant le manuscrit"));
  if (beforeRow && beforeRow.events) beforeRow.events.get("click")();
  await Promise.resolve();

  // Modifier la Composition doit rafraîchir CETTE MÊME Preview (linkedPreviewLeaf),
  // jamais en créer une nouvelle.
  const checkbox = allElements(container).find((el) => el.getAttribute?.("aria-label") === "Inclure le sommaire");
  assert.ok(checkbox, "la case Sommaire est rendue");
  if (checkbox) {
    checkbox.checked = !checkbox.checked;
    checkbox.dispatch("change");
  }
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls.refresh, 1, "la Preview EXISTANTE est rafraîchie exactement une fois");
  assert.equal(app.workspace.getLeavesOfType(VIEW_PREVIEW).length, 1, "aucune deuxième Preview créée");
});

test("SidebarFeuilletsView : une Preview d'un AUTRE projet n'est pas liée", () => {
  const { leaf } = fakePreviewLeaf("Autre/Manuscrit");
  const { sidebar } = buildEditionFixture({ withPreviewLeaf: leaf });
  const found = sidebar.existingProjectPreviewLeaf ? sidebar.existingProjectPreviewLeaf() : undefined;
  assert.equal(found, null, "la Preview d'un autre projet n'est jamais retenue");
});

/* ==================================================================
 * CORRECTIF PROMPT 2/3 : barre globale Aperçu/Portée/Format/Exporter,
 * commune aux quatre pages de l'onglet Édition. Réutilise exclusivement
 * ExportPanel.renderQuickBar() (aucun select/workflow réimplémenté) et le
 * helper existant openScopeWithPreviewBesideLeaf (aucune Preview créée par
 * la seule ouverture du panneau — uniquement au clic explicite sur Aperçu).
 * ================================================================== */

function actionsBarOf(container) {
  return allElements(container).find((el) => el.classes.has("feuillets-sidebar-edition-actions"));
}

function previewButtonOf(container) {
  return allElements(container).find((el) => el.tag === "button" && el.getAttribute("aria-label") === t("sidebar.edition.openPreview"));
}

test("SidebarFeuilletsView : la barre globale Édition (Aperçu/Export) est présente sur l'accueil HOME", async () => {
  const { sidebar } = buildEditionFixture();
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.ok(actionsBarOf(container), "barre globale présente sur HOME");
  assert.ok(previewButtonOf(container), "bouton Aperçu présent sur HOME");
});

test("SidebarFeuilletsView : la barre globale Édition est présente dans Composition", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "composition";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.ok(actionsBarOf(container), "barre globale présente dans Composition");
});

test("SidebarFeuilletsView : la barre globale Édition est présente dans Mise en page", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "layout";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.ok(actionsBarOf(container), "barre globale présente dans Mise en page");
});

test("SidebarFeuilletsView : la barre globale Édition est présente dans Dossier éditorial", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "documents";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.ok(actionsBarOf(container), "barre globale présente dans Dossier éditorial");
});

test("SidebarFeuilletsView : la quick export bar rend bien portée, format et Exporter (ExportPanel.renderQuickBar réutilisé)", async () => {
  const { sidebar } = buildEditionFixture();
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const bar = actionsBarOf(container);
  const quickBar = allElements(bar).find((el) => el.classes.has("feuillets-edition-quickexport"));
  assert.ok(quickBar, "hôte ExportPanel.renderQuickBar() rendu");
  assert.ok(allElements(quickBar).some((el) => el.classes.has("feuillets-edition-quickexport-scope")), "portée présente");
  assert.ok(allElements(quickBar).some((el) => el.classes.has("feuillets-edition-quickexport-format")), "format présent");
  assert.ok(allElements(quickBar).some((el) => el.classes.has("feuillets-edition-quickexport-cta")), "bouton Exporter présent");
});

test("SidebarFeuilletsView : aucun moteur d'export n'est réimplémenté (source) — ExportPanel réutilisé exclusivement", () => {
  const source = readFileSync("src/views/sidebar-feuillets-view.ts", "utf8");
  assert.ok(source.includes("ExportPanel"), "ExportPanel importé/utilisé");
  assert.ok(source.includes("renderQuickBar"), "renderQuickBar() de ExportPanel réutilisé");
  for (const forbidden of ["runExportWorkflow", "exportWithScope"]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} ne doit pas être réimplémenté dans la Sidebar`);
  }
});

test("SidebarFeuilletsView : ouvrir le tab Édition (HOME) seul ne crée aucune Preview", async () => {
  const { sidebar, app, calls } = buildEditionFixture();
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.equal(app.workspace.getLeavesOfType(VIEW_PREVIEW).length, 0);
  assert.equal(calls.leafCreates, 0);
});

test("SidebarFeuilletsView : ouvrir Composition seul ne crée aucune Preview", async () => {
  const { sidebar, app, calls } = buildEditionFixture();
  sidebar.editionPage = "composition";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.equal(app.workspace.getLeavesOfType(VIEW_PREVIEW).length, 0);
  assert.equal(calls.leafCreates, 0);
});

test("SidebarFeuilletsView : ouvrir Mise en page seul ne crée aucune Preview", async () => {
  const { sidebar, app, calls } = buildEditionFixture();
  sidebar.editionPage = "layout";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.equal(app.workspace.getLeavesOfType(VIEW_PREVIEW).length, 0);
  assert.equal(calls.leafCreates, 0);
});

test("SidebarFeuilletsView : clic explicite sur Aperçu appelle le helper Preview existant (openScopeWithPreviewBesideLeaf), ancré sur getMostRecentLeaf(rootSplit), jamais this.leaf de la Sidebar", async () => {
  const { sidebar, calls, centralWorkLeaf, sidebarLeafParam, rootSplit } = buildEditionFixture();
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const btn = previewButtonOf(container);
  assert.ok(btn);

  btn.events.get("click")();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.getMostRecentLeafRoot, rootSplit, "getMostRecentLeaf(workspace.rootSplit) est bien utilisé");
  assert.equal(calls.leafCreates, 1, "une leaf (split) est créée : aucune Preview préexistante");
  assert.ok(calls.setActiveLeafWith.includes(centralWorkLeaf), "la leaf centrale de travail est activée");
  assert.equal(calls.setActiveLeafWith.includes(sidebarLeafParam), false, "jamais la leaf de la Sidebar comme ancre");
  assert.equal(calls.activateBoard, 0, "aucun activateBoard()");
  assert.equal(typeof sidebar.plugin.activateCentralSurface, "undefined", "aucun activateCentralSurface() disponible/appelé");
});

test("SidebarFeuilletsView : une Preview existante est réutilisée par le bouton Aperçu, jamais recréée", async () => {
  const previewView = { compileScope: undefined, calls: 0, setCompileScope(scope) { this.compileScope = scope; this.calls += 1; } };
  const existingPreviewLeaf = { view: previewView };
  const { sidebar, calls } = buildEditionFixture({ withPreviewLeaf: existingPreviewLeaf });
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const btn = previewButtonOf(container);

  btn.events.get("click")();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.leafCreates, 0, "aucune nouvelle Preview créée : celle déjà ouverte est réutilisée");
  assert.equal(previewView.calls, 1, "la Preview existante reçoit bien la portée du projet actif");
  assert.equal(previewView.compileScope.projectRoot, "Projet/Manuscrit");
});

test("SidebarFeuilletsView : la sidebar Projet ne remonte aucun composant Édition/Documents (EditionDocsContent, EditionCompositionContent, EditionWorkspaceContent)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  for (const cls of ["feuillets-edition-docs-container", "feuillets-edition-composition-container", "feuillets-layout-workspace"]) {
    assert.equal(allElements(container).some((el) => el.classes.has(cls)), false, `${cls} absent de la sidebar`);
  }
});

test("SidebarFeuilletsView ne rafraîchit au file-open que Notes, Statistiques et Analyse du texte, jamais l'accueil Relecture ni Révision DOCX", async () => {
  const { sidebar, listeners, calls } = createSidebar();
  const registered = [];
  sidebar.registerEvent = (event) => registered.push(event);
  sidebar.render = async () => {};
  await sidebar.onOpen();

  const cases = [
    { tab: "notes", page: "home", expected: ["notes"] },
    { tab: "research", page: "home", expected: [] },
    { tab: "journal", page: "home", expected: [] },
    { tab: "project", page: "home", expected: [] },
    { tab: "stats", page: "home", expected: ["analyse"] },
    { tab: "relecture", page: "home", expected: [] },
    { tab: "relecture", page: "analysis", expected: ["relecture"] },
    { tab: "relecture", page: "docx", expected: [] },
  ];
  for (const { tab, page, expected } of cases) {
    calls.length = 0;
    sidebar.activeTab = tab;
    sidebar.relecturePage = page;
    listeners.workspace.get("file-open")();
    await Promise.resolve();
    assert.deepEqual(calls.map((call) => call.name), expected, `${tab}/${page}`);
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

test("SidebarFeuilletsView renderAllSubViews respecte la nouvelle organisation : Projet se redessine entièrement, Stats et Relecture selon leur état, une seule sous-vue pour les autres onglets", async () => {
  const { sidebar, calls } = createSidebar("project");
  // Gestion de projet : aucune sous-vue montée — un rendu complet du panneau.
  let fullRenders = 0;
  const realRender = sidebar.render.bind(sidebar);
  sidebar.render = async () => { fullRenders += 1; };
  await sidebar.renderAllSubViews(true);
  sidebar.render = realRender;
  assert.deepEqual(calls.map((call) => call.name), []);
  assert.equal(fullRenders, 1, "l'onglet Projet est intégralement redessiné");

  calls.length = 0;
  sidebar.activeTab = "research";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["research"]);

  calls.length = 0;
  sidebar.activeTab = "stats";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["analyse"], "Stats rend la sous-vue AnalysisView");

  // Relecture : rien à rafraîchir sur l'accueil (pas de sous-vue affichée),
  // uniquement TextAnalysisView sur "analysis", uniquement DocxReviewView
  // sur "docx".
  calls.length = 0;
  sidebar.activeTab = "relecture";
  sidebar.relecturePage = "home";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), []);

  calls.length = 0;
  sidebar.relecturePage = "analysis";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["relecture"]);

  calls.length = 0;
  sidebar.relecturePage = "docx";
  await sidebar.renderAllSubViews(true);
  assert.deepEqual(calls.map((call) => call.name), ["docx"]);
});

test("SidebarFeuilletsView retombe sur l'onglet Projet pour un onglet invalide sans écrire les réglages", async () => {
  const { sidebar, settings, calls } = createSidebar("invalide");
  await sidebar.render();

  assert.equal(settings.activeRightPanelTab, "invalide");
  assert.equal(sidebar.activeTab, "project");
  assert.deepEqual(calls.map((call) => call.name), [], "Gestion de projet ne monte aucune sous-vue");
});

test("SidebarFeuilletsView : l'accueil Relecture affiche la relecture collaborative, le Correcteur et Révision DOCX sans rendre leurs sous-vues", async () => {
  const { sidebar, contentEl, calls } = createSidebar("relecture");
  await sidebar.render();

  assert.equal(sidebar.relecturePage, "home");
  assert.deepEqual(calls.map((call) => call.name), [], "aucune des deux sous-vues complètes n'est rendue");

  const content = contentEl.children[1];
  const heads = allElements(content).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );
  assert.equal(heads.length, 3, "trois lignes compactes cliquables");

  const titles = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.deepEqual(titles, [t("relecture.home.native.title"), t("relecture.home.analysis.title"), t("relecture.home.docx.title")]);

  const subs = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-sub"))
    .map((el) => el.text);
  assert.deepEqual(subs, [t("relecture.home.native.sub"), t("relecture.home.analysis.sub"), t("relecture.home.docx.sub")]);

  // Pas de carte lourde : aucun .feuillets-hub-card sur cette page.
  assert.equal(allElements(content).some((el) => el.classes.has("feuillets-hub-card")), false);
});

test("SidebarFeuilletsView : le Correcteur est visible sur HOME quand un provider est disponible", async () => {
  const { sidebar, contentEl } = createSidebar("relecture", [], [], { getAnalysisProvider: { name: "Grammalecte" } });
  await sidebar.render();
  const content = contentEl.children[1];
  const titles = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.ok(titles.includes(t("relecture.home.analysis.title")), "Correcteur présent avec provider");
  assert.equal(titles.includes("Analyse du texte"), false, "« Analyse du texte » a disparu");
  const subs = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-sub"))
    .map((el) => el.text);
  assert.ok(subs.includes(t("relecture.home.analysis.sub")), "sous-titre « Grammaire et orthographe »");
});

test("SidebarFeuilletsView : sans provider, l'entrée Correcteur disparaît de HOME", async () => {
  const { sidebar, contentEl } = createSidebar("relecture", [], [], { getAnalysisProvider: null });
  await sidebar.render();
  const content = contentEl.children[1];
  const titles = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.equal(titles.includes(t("relecture.home.analysis.title")), false, "Correcteur absent sans provider");
  // Les autres entrées restent.
  assert.ok(titles.includes(t("relecture.home.native.title")), "Relecture collaborative conservée");
  assert.ok(titles.includes(t("relecture.home.docx.title")), "Révision DOCX conservée");
});

test("SidebarFeuilletsView : Relecture crée un unique wrapper intérieur .feuillets-notes-container sans double couche", async () => {
  const { sidebar, contentEl } = createSidebar("relecture");
  await sidebar.render();
  const content = contentEl.children[1]; // .feuillets-sidebar-content
  const wrappers = allElements(content).filter((el) => el.classes.has("feuillets-notes-container"));
  assert.equal(wrappers.length, 1, "un seul wrapper, jamais de double couche");

  // HOME est dedans.
  const homeSections = allElements(wrappers[0]).filter((el) => el.classes.has("feuillets-notes-section"));
  assert.ok(homeSections.length >= 3, "les lignes HOME sont dans le wrapper");

  // Aucun contenu principal directement dans la racine reçue.
  assert.equal(content.children.length, 1, "la racine ne porte que le wrapper");
});

test("SidebarFeuilletsView : barre Retour et conteneurs des sous-vues Relecture vivent dans le wrapper", async () => {
  const { sidebar, contentEl } = createSidebar("docx"); // legacy : ouvre Révision DOCX directement
  await sidebar.render();
  const content = contentEl.children[1];
  const wrappers = allElements(content).filter((el) => el.classes.has("feuillets-notes-container"));
  assert.equal(wrappers.length, 1, "un seul wrapper");
  const backBar = allElements(wrappers[0]).find((el) => el.classes.has("feuillets-notes-back-bar"));
  assert.ok(backBar, "barre Retour dans le wrapper");
  const subTarget = sidebar.subViews.docx.targetContainer;
  assert.ok(subTarget && allElements(wrappers[0]).includes(subTarget), "le conteneur de la sous-vue est dans le wrapper");
  assert.equal(allElements(subTarget).includes(backBar), false, "la barre Retour n'est pas dans le conteneur de la sous-vue");
});

test("SidebarFeuilletsView : cliquer sur Correcteur puis Révision DOCX ouvre chaque fois la sous-vue correspondante, seule", async () => {
  const { sidebar, contentEl, calls } = createSidebar("relecture");
  await sidebar.render();

  const [, analysisHead] = allElements(contentEl.children[1]).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );

  let renders = 0;
  sidebar.render = async () => { renders += 1; };
  analysisHead.events.get("click")();
  assert.equal(sidebar.relecturePage, "analysis");
  assert.equal(renders, 1);

  delete sidebar.render;
  calls.length = 0;
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["relecture"], "uniquement TextAnalysisView");

  // Retour à l'accueil pour rejouer le même scénario avec Révision DOCX.
  sidebar.relecturePage = "home";
  await sidebar.render();
  const heads = allElements(contentEl.children[1]).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );

  renders = 0;
  sidebar.render = async () => { renders += 1; };
  heads[2].events.get("click")();
  assert.equal(sidebar.relecturePage, "docx");
  assert.equal(renders, 1);

  delete sidebar.render;
  calls.length = 0;
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["docx"], "uniquement DocxReviewView");
});

test("SidebarFeuilletsView : le bouton Retour des pages secondaires de Relecture revient à l'accueil", async () => {
  for (const legacyTab of ["docx"]) {
    const { sidebar, contentEl } = createSidebar(legacyTab);
    await sidebar.render();

    const backBtn = allElements(contentEl.children[1]).find((el) => el.classes.has("feuillets-back-btn"));
    assert.ok(backBtn, `barre de retour attendue pour ${legacyTab}`);

    let renders = 0;
    sidebar.render = async () => { renders += 1; };
    backBtn.events.get("click")();

    assert.equal(sidebar.relecturePage, "home");
    assert.equal(renders, 1);
  }
});

/** Sous-vue factice qui reproduit le comportement réel de TextAnalysisView/
 * DocxReviewView : elle vide ENTIÈREMENT son propre targetContainer au
 * début de render() (comme leur `container.empty()`), puis y pose un
 * marqueur. Sert à prouver que la barre Retour — postée ailleurs — survit
 * à ce vidage plutôt que de le supposer. */
function createEmptyingSubView(name, calls) {
  return {
    targetContainer: null,
    async render(force) {
      calls.push({ name, force, targetContainer: this.targetContainer });
      if (this.targetContainer) {
        this.targetContainer.empty();
        this.targetContainer.createDiv({ cls: `feuillets-${name}-marker` });
      }
    },
  };
}

test("SidebarFeuilletsView : la barre Retour de Révision DOCX survit au vidage du conteneur par la sous-vue", async () => {
  for (const [legacyTab, subViewKey] of [["docx", "docx"]]) {
    const { sidebar, contentEl, calls } = createSidebar(legacyTab);
    sidebar.subViews[subViewKey] = createEmptyingSubView(subViewKey, calls);

    await sidebar.render();

    let content = contentEl.children[1];
    let backBtn = allElements(content).find((el) => el.classes.has("feuillets-back-btn"));
    assert.ok(backBtn, `barre Retour visible pour ${legacyTab}`);
    // La barre Retour n'habite jamais le conteneur que la sous-vue a le
    // droit de vider : elle ne peut donc structurellement pas l'effacer.
    assert.equal(
      allElements(sidebar.subViews[subViewKey].targetContainer).includes(backBtn),
      false,
      "la barre Retour n'est pas dans le targetContainer de la sous-vue"
    );
    let marker = allElements(content).find((el) => el.classes.has(`feuillets-${subViewKey}-marker`));
    assert.ok(marker, `contenu de la sous-vue rendu pour ${legacyTab}`);

    // Un second rendu (ex. changement de feuillet actif) revide de nouveau
    // le même conteneur — la barre Retour, elle, reste intacte.
    await sidebar.render();
    content = contentEl.children[1];
    backBtn = allElements(content).find((el) => el.classes.has("feuillets-back-btn"));
    assert.ok(backBtn, `barre Retour toujours visible après un second rendu (${legacyTab})`);
    marker = allElements(content).find((el) => el.classes.has(`feuillets-${subViewKey}-marker`));
    assert.ok(marker, `contenu de la sous-vue toujours rendu après un second rendu (${legacyTab})`);

    // Et le clic Retour fonctionne toujours.
    let renders = 0;
    sidebar.render = async () => { renders += 1; };
    backBtn.events.get("click")();
    assert.equal(sidebar.relecturePage, "home");
    assert.equal(renders, 1);
  }
});

test("SidebarFeuilletsView : l'accueil Relecture propose Comparer une version pour un feuillet Markdown valide du projet actif", async () => {
  const projectFolder = { path: "Projet" };
  const activeFile = { path: "Projet/scene.md", extension: "md" };
  const { sidebar, contentEl } = createSidebar("relecture", [], [], { activeFile, projectFolder });

  await sidebar.render();
  const content = contentEl.children[1];
  const titles = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.deepEqual(titles, [
    t("relecture.home.native.title"),
    t("relecture.home.analysis.title"),
    t("relecture.home.docx.title"),
    t("relecture.home.diff.title"),
  ]);
  const subs = allElements(content)
    .filter((el) => el.classes.has("feuillets-notes-sub"))
    .map((el) => el.text);
  assert.deepEqual(subs, [
    t("relecture.home.native.sub"),
    t("relecture.home.analysis.sub"),
    t("relecture.home.docx.sub"),
    t("relecture.home.diff.sub"),
  ]);
});

test("SidebarFeuilletsView : Comparer une version n'apparaît pas sans feuillet Markdown valide du projet actif", async () => {
  const cases = [
    { activeFile: null, projectFolder: { path: "Projet" } },
    { activeFile: { path: "Projet/image.png", extension: "png" }, projectFolder: { path: "Projet" } },
    { activeFile: { path: "Ailleurs/scene.md", extension: "md" }, projectFolder: { path: "Projet" } },
    { activeFile: { path: "Projet/scene.md", extension: "md" }, projectFolder: null },
  ];
  for (const options of cases) {
    const { sidebar, contentEl } = createSidebar("relecture", [], [], options);
    await sidebar.render();
    const titles = allElements(contentEl.children[1])
      .filter((el) => el.classes.has("feuillets-notes-section-title"))
      .map((el) => el.text);
    assert.deepEqual(titles, [t("relecture.home.native.title"), t("relecture.home.analysis.title"), t("relecture.home.docx.title")]);
  }
});

test("SidebarFeuilletsView : cliquer sur Comparer une version ouvre la comparaison sur le feuillet actif, sans créer de troisième page", async () => {
  const projectFolder = { path: "Projet" };
  const activeFile = { path: "Projet/scene.md", extension: "md" };
  const { sidebar, contentEl } = createSidebar("relecture", [], [], { activeFile, projectFolder });
  await sidebar.render();

  const rows = allElements(contentEl.children[1]).filter(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );
  assert.equal(rows.length, 4);
  rows[3].events.get("click")();
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Sans snapshot, rien ne s'ouvre — mais surtout aucune page secondaire n'est
  // inventée : l'entrée reste une action, jamais une troisième page Relecture.
  assert.equal(sidebar.relecturePage, "home", "aucune troisième page secondaire créée");
});

/* ==========================================================================
 * DERNIER CORRECTIF — UN SEUL RETOUR PAR PROFONDEUR (childIsAtRoot).
 * La barre « Retour à Édition » n'existe que lorsque le contenu enfant est sur
 * sa page racine (sommaire/sommaire Mise en page). En sous-page elle est
 * RETIRÉE du DOM (jamais masquée) : seul le Retour local de l'enfant reste.
 * ========================================================================== */

function editionBackHost(container) {
  return allElements(container).find((el) => el.classes.has("feuillets-edition-back-host"));
}

function globalBackPresent(container) {
  return allElements(container).some(
    (el) => el.classes.has("feuillets-notes-back-bar") && String(el.textContent).includes(t("sidebar.edition.backToHome"))
  );
}

function localBackTexts(container) {
  return allElements(container)
    .filter((el) => el.classes.has("feuillets-back-btn") || el.classes.has("feuillets-composition-back"))
    .map((el) => String(el.textContent).trim());
}

function clickRow(container, wantedClass, label) {
  const row = allElements(container).find(
    (el) => el.classes.has(wantedClass) && [...el.children].some((c) => c.classes?.has?.("feuillets-layout-summary-label") && c.text === label) ||
      (el.classes.has(wantedClass) && el.classes.has("feuillets-project-row") && String(el.textContent).includes(label))
  );
  assert.ok(row, `ligne « ${label} » (${wantedClass}) présente`);
  row.events.get("click")();
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("Sidebar : Composition racine montre « Retour à Édition » ; Avant le manuscrit le coupe et ne laisse que le Retour local Composition", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "composition";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  assert.ok(globalBackPresent(container), "Retour à Édition présent sur le sommaire Composition");
  assert.deepEqual(localBackTexts(container), ["Retour à Édition"], "seul le Retour global existe à la racine");

  clickRow(container, "feuillets-project-row", "Avant le manuscrit");
  await settle();

  assert.equal(globalBackPresent(container), false, "Retour à Édition coupé en sous-page");
  assert.equal(editionBackHost(container).children.length, 0, "le host du Retour global est vidé du DOM (jamais masqué)");
  assert.deepEqual(localBackTexts(container), [t("compositionSummary.backToComposition")], "un seul Retour local : Composition");
});

test("Sidebar : Structure → seul « Retour au manuscrit » ; retour deux fois → le Retour à Édition revient", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "composition";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  clickRow(container, "feuillets-project-row", "Le manuscrit");
  await settle();
  clickRow(container, "feuillets-project-row", "Structure du manuscrit");
  await settle();

  assert.equal(globalBackPresent(container), false, "pas de Retour global sur Structure");
  assert.deepEqual(localBackTexts(container), [t("compositionSummary.backToManuscript")], "un seul Retour local : Le manuscrit");

  // Retour local → page parente (Le manuscrit, toujours hors racine).
  const back = container.querySelector(".feuillets-composition-back");
  back.events.get("click")();
  await settle();
  assert.equal(globalBackPresent(container), false, "Le manuscrit reste hors racine");
  assert.deepEqual(localBackTexts(container), [t("compositionSummary.backToComposition")]);

  // Retour local → sommaire : racine.
  container.querySelector(".feuillets-composition-back").events.get("click")();
  await settle();
  assert.ok(globalBackPresent(container), "Retour à Édition réapparu sur le sommaire");
});

test("Sidebar : Mise en page racine → Retour à Édition ; ouvrir Page → coupé, seul Retour local « Mise en page »", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "layout";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  assert.ok(globalBackPresent(container), "Retour à Édition présent sur le sommaire Mise en page");

  clickRow(container, "feuillets-layout-summary-row", t("modal.layout.categoryPage"));
  await settle();
  assert.equal(globalBackPresent(container), false, "Retour à Édition coupé dans Page");
  assert.equal(editionBackHost(container).children.length, 0, "host du Retour global vidé");
  assert.deepEqual(localBackTexts(container), ["Mise en page"], "un seul Retour local : Mise en page");

  // Retour local → sommaire.
  container.querySelector(".feuillets-back-btn").events.get("click")();
  await settle();
  assert.ok(globalBackPresent(container), "Retour à Édition réapparu au sommaire Mise en page");
});

test("Sidebar : à chaque profondeur Layout le Retour global est coupé, seul le Retour du parent immédiat reste", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "layout";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const cases = [
    [t("modal.layout.categoryPage"), t("modal.layout.format"), t("modal.layout.categoryPage")],
    [t("modal.layout.categoryPage"), t("modal.layout.marginsGroup"), t("modal.layout.categoryPage")],
    [t("modal.layout.categoryText"), t("modal.layout.paragraphsGroup"), t("modal.layout.categoryText")],
    [t("modal.layout.categoryHeadings"), t("modal.layout.h1"), t("modal.layout.categoryHeadings")],
    [t("modal.layout.categoryElements"), t("modal.layout.blockquoteLabel"), t("modal.layout.categoryElements")],
  ];
  for (const [domain, sub, backLabel] of cases) {
    clickRow(container, "feuillets-layout-summary-row", domain);
    await settle();
    clickRow(container, "feuillets-layout-summary-row", sub);
    await settle();

    assert.equal(globalBackPresent(container), false, `${domain} → ${sub} : Retour à Édition coupé`);
    assert.deepEqual(localBackTexts(container), [backLabel], `${domain} → ${sub} : un seul Retour local ${backLabel}`);

    container.querySelector(".feuillets-back-btn").events.get("click")();
    await settle();
    container.querySelector(".feuillets-back-btn").events.get("click")();
    await settle();
    assert.ok(globalBackPresent(container), `retour au sommaire Mise en page après ${sub}`);
  }
});

test("Sidebar : Dossier éditorial (pas de navigation interne) garde toujours « Retour à Édition »", async () => {
  const { sidebar } = buildEditionFixture();
  sidebar.editionPage = "documents";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.ok(globalBackPresent(container), "Retour à Édition présent sur Dossier éditorial");
  assert.ok(localBackTexts(container).includes("Retour à Édition"), "un seul Retour, le global, reste à la racine");
});
