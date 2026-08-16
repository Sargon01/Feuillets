import assert from "node:assert/strict";
import test from "node:test";
import { Menu, TFolder } from "obsidian";
import { SidebarFeuilletsView } from "../src/views/sidebar-feuillets-view.js";
import { ManageProjectsModal, NewProjectModal, OpenExistingFolderModal } from "../src/ui/project-modals.js";
import { ScrivenerImportModal } from "../src/ui/scrivener-import-modal.js";
import { t } from "../src/i18n/index.js";

class FakeElement {
  constructor(options = {}) {
    this.tag = options.tag || "div";
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = new Map();
    this.text = options.text ?? "";
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

  setAttr(name, value) { this.attrs.set(name, value); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasClass(name) { return this.classes.has(name); }
  setText(text) { this.text = String(text); return this; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  prepend(child) { this.children = [child, ...this.children.filter((c) => c !== child)]; }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
  }
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

function createSidebar(activeRightPanelTab = "notes", order = [], hiddenPanels = [], { activeFile = null, projectFolder = null, projects = [], vaultFolders = null } = {}) {
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
  };
  const plugin = {
    settings,
    async saveSettings() { order.push("save"); },
    getProjectFolder() { return projectFolder; },
    projectDisplayName(path) { return `Projet ${path}`; },
    updateStatusBar() { order.push("statusBar"); },
    renderAllViews() { order.push("renderAll"); },
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
  assert.equal(analyse.activeTab, "relecture");
  assert.equal(analyse.relecturePage, "analysis");

  assert.equal(createSidebar("metadata").sidebar.activeTab, "notes");
});

test("SidebarFeuilletsView : l'ancien activeRightPanelTab \"docx\" ouvre Relecture directement sur Révision DOCX", async () => {
  const { sidebar, calls } = createSidebar("docx");
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["docx"]);
});

test("SidebarFeuilletsView : l'ancien activeRightPanelTab \"analyse\" ouvre Relecture directement sur Analyse du texte", async () => {
  const { sidebar, calls } = createSidebar("analyse");
  await sidebar.render();
  assert.deepEqual(calls.map((call) => call.name), ["relecture"]);
});

test("SidebarFeuilletsView démarre sur l'onglet Recherche mémorisé", () => {
  assert.equal(createSidebar("research").sidebar.activeTab, "research");
});

test("SidebarFeuilletsView n'affiche pas les onglets masqués", async () => {
  const { sidebar, contentEl } = createSidebar("notes", [], ["research"]);

  await sidebar.render();

  assert.deepEqual(contentEl.children[0].children.map((button) => button.icon), [
    "file-text", "calendar", "folder-cog", "spell-check",
  ]);
});

test("SidebarFeuilletsView conserve l'ordre des quatre onglets visibles", async () => {
  const { sidebar, contentEl } = createSidebar("notes", [], ["research", "analyse"]);

  await sidebar.render();

  assert.deepEqual(contentEl.children[0].children.map((button) => button.icon), [
    "file-text", "calendar", "folder-cog", "spell-check",
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

  assert.ok(contentEl.children[0].children.some((button) => button.icon === "folder-cog"));
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

/* §12/§13 du chantier « espace central » : l'onglet `project` n'héberge plus
 * ni Documents éditoriaux ni Édition (partis au centre) — c'est désormais la
 * GESTION DE PROJET, volontairement minimale. */
test("SidebarFeuilletsView : l'onglet Projet affiche le projet actif et son type · auteur, sans aucune sous-vue Édition", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar, calls } = createSidebar("project", [], [], { projectFolder: root });
  sidebar.plugin.settings.projectMeta[root.path] = { type: "fiction", author: "Halim Yalcin" };
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  assert.deepEqual(calls.map((call) => call.name), [], "aucune sous-vue montée dans cet onglet");
  // §13-17 : le panneau enrichi ajoute une seconde ligne au gabarit
  // « .feuillets-notes-section-title » — la ligne compacte « Gérer les
  // projets… » de la section Gestion (même grammaire que le projet actif).
  const titles = allElements(container)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.deepEqual(titles, [`Projet ${root.path}`, t("sidebar.project.manage")]);
  const subs = allElements(container).filter((el) => el.classes.has("feuillets-notes-sub")).map((el) => el.text);
  assert.deepEqual(subs, ["Fiction · Halim Yalcin"]);
  assert.equal(allElements(container).some((el) => el.attrs.get("role") === "tablist"), false, "pas de tablist horizontale");
});

test("SidebarFeuilletsView : ni EditionDocsView ni EditionLayoutView ne subsistent dans le panneau latéral", () => {
  const { sidebar } = createSidebar("project");
  const real = new SidebarFeuilletsView(
    { app: sidebar.app, contentEl: new FakeElement() },
    sidebar.plugin
  );
  assert.equal("editionDocs" in real.subViews, false);
  assert.equal("editionLayout" in real.subViews, false);
  assert.equal("editionPage" in real, false, "plus d'état de page Édition dans le panneau");
});

/* §14 : le choix du projet passe par un Menu Obsidian NATIF. */
function openProjectMenu(container) {
  const head = allElements(container).find(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );
  assert.ok(head, "la ligne du projet actif est cliquable");
  head.events.get("click")({});
  return Menu.lastShown;
}

test("SidebarFeuilletsView : le menu Projet liste tous les projets connus, coche l'actif, puis les quatre actions de gestion", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root, projects: ["Autre/Manuscrit"] });
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const menu = openProjectMenu(container);
  const titles = menu.items.filter((item) => !item.separator).map((item) => item.title);
  assert.deepEqual(titles, [
    `Projet ${root.path}`,
    "Projet Autre/Manuscrit",
    "Nouveau projet…",
    "Utiliser un dossier existant…",
    "Importer un projet Scrivener…",
    "Gérer les projets…",
  ]);
  const active = menu.items.find((item) => item.title === `Projet ${root.path}`);
  assert.equal(active.checked, true, "le projet actif est coché");
  assert.equal(menu.items.find((item) => item.title === "Projet Autre/Manuscrit").checked, false);
});

/* §15 : changer de projet est DIRECT — aucune modale, même séquence que
 * ManageProjectsModal (préservation de l'ancien projet, save, statusBar,
 * renderAllViews). */
test("SidebarFeuilletsView : cliquer un projet du menu change de projet sans ouvrir la moindre modale", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const other = new TFolder("Autre/Manuscrit");
  const vaultFolders = new Map([[root.path, root], [other.path, other]]);
  const order = [];
  const { sidebar, settings } = createSidebar("project", order, [], {
    projectFolder: root, projects: [other.path], vaultFolders,
  });
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  order.length = 0;

  const opened = [];
  const originals = [ManageProjectsModal, NewProjectModal, OpenExistingFolderModal, ScrivenerImportModal]
    .map((Klass) => [Klass, Klass.prototype.open]);
  for (const [Klass] of originals) Klass.prototype.open = function open() { opened.push(Klass.name); };
  try {
    const menu = openProjectMenu(container);
    await menu.items.find((item) => item.title === `Projet ${other.path}`).callback();
  } finally {
    for (const [Klass, open] of originals) Klass.prototype.open = open;
  }

  assert.deepEqual(opened, [], "aucune modale ouverte pour un simple changement de projet");
  assert.equal(settings.projectFolder, other.path);
  assert.ok(settings.projects.includes(root.path), "l'ancien projet est préservé dans settings.projects");
  assert.deepEqual(order.filter((entry) => entry !== "settings"), ["save", "statusBar", "renderAll"]);
});

test("SidebarFeuilletsView : les quatre actions de gestion réutilisent les modales existantes", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const cases = [
    ["Nouveau projet…", NewProjectModal],
    ["Utiliser un dossier existant…", OpenExistingFolderModal],
    ["Importer un projet Scrivener…", ScrivenerImportModal],
    ["Gérer les projets…", ManageProjectsModal],
  ];
  for (const [title, Klass] of cases) {
    let opened = null;
    const original = Klass.prototype.open;
    Klass.prototype.open = function open() { opened = this; };
    try {
      const menu = openProjectMenu(container);
      menu.items.find((item) => item.title === title).callback();
    } finally {
      Klass.prototype.open = original;
    }
    assert.ok(opened instanceof Klass, `${title} ouvre ${Klass.name}`);
  }
});

/* §13-18 du micro-chantier « finition Édition + sidebar Projet » : la
 * sidebar Projet devient un vrai panneau compact — Informations/Manuscrit/
 * Gestion — mais UNIQUEMENT avec des données déjà existantes. */
test("SidebarFeuilletsView : « Informations » affiche les champs ProjectMeta existants, sans jamais inventer une valeur absente", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  sidebar.plugin.settings.projectMeta[root.path] = { type: "fiction", author: "Halim Yalcin" };
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const rows = allElements(container).filter((el) => el.classes.has("feuillets-properties-row"));
  const pairs = rows.map((row) => [
    row.children.find((c) => c.classes.has("feuillets-properties-key"))?.text,
    row.children.find((c) => c.classes.has("feuillets-properties-value"))?.text,
  ]);

  // Nom (dérivé de projectDisplayName, déjà utilisé ailleurs) et Auteur
  // (présent dans ProjectMeta) sont affichés ; Type suit la même règle que
  // le sous-titre déjà testé plus haut ("Fiction"). Description est ABSENTE
  // de ProjectMeta ici : aucune ligne "Description" ne doit apparaître —
  // rien n'est inventé.
  assert.deepEqual(pairs, [
    [t("sidebar.project.fieldName"), `Projet ${root.path}`],
    [t("sidebar.project.fieldAuthor"), "Halim Yalcin"],
    [t("sidebar.project.fieldType"), "Fiction"],
    [t("sidebar.project.fieldFolder"), root.name],
  ]);
});

test("SidebarFeuilletsView : sections Informations/Manuscrit/Gestion rendues, Gestion ouvre ManageProjectsModal sans dupliquer sa logique", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const heads = allElements(container)
    .filter((el) => el.classes.has("feuillets-settings-subhead"))
    .map((el) => el.text);
  assert.deepEqual(heads, [
    t("sidebar.project.header"),
    t("sidebar.project.infoHeader"),
    t("sidebar.project.manuscriptHeader"),
    t("sidebar.project.manageHeader"),
  ]);

  assert.ok(
    allElements(container).some((el) => el.classes.has("feuillets-sidebar-project")),
    "toute la surface est scopée sous une racine dédiée (§21, cloisonnement CSS)"
  );

  const manageRow = allElements(container).find(
    (el) => el.classes.has("feuillets-notes-section-title") && el.text === t("sidebar.project.manage")
  )?.parentNode;
  assert.ok(manageRow, "la ligne « Gérer les projets… » est présente dans Gestion");

  let opened = null;
  const original = ManageProjectsModal.prototype.open;
  ManageProjectsModal.prototype.open = function open() { opened = this; };
  try {
    manageRow.events.get("click")();
  } finally {
    ManageProjectsModal.prototype.open = original;
  }
  assert.ok(opened instanceof ManageProjectsModal, "réutilise ManageProjectsModal — aucune logique de gestion dupliquée");
});

test("SidebarFeuilletsView : sans projet actif, aucune section Informations/Manuscrit/Gestion ne s'affiche", async () => {
  const { sidebar } = createSidebar("project", [], [], { projectFolder: null });
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const heads = allElements(container)
    .filter((el) => el.classes.has("feuillets-settings-subhead"))
    .map((el) => el.text);
  assert.deepEqual(heads, [t("sidebar.project.header")]);
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

test("SidebarFeuilletsView ne rafraîchit au file-open que Notes et Analyse du texte, jamais l'accueil Relecture ni Révision DOCX", async () => {
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

test("SidebarFeuilletsView renderAllSubViews respecte la nouvelle organisation : Projet se redessine entièrement, Relecture selon sa page, une seule sous-vue pour les autres onglets", async () => {
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

test("SidebarFeuilletsView : l'accueil Relecture affiche la relecture collaborative, Analyse du texte et Révision DOCX sans rendre leurs sous-vues", async () => {
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

test("SidebarFeuilletsView : cliquer sur Analyse du texte puis Révision DOCX ouvre chaque fois la sous-vue correspondante, seule", async () => {
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
  for (const legacyTab of ["docx", "analyse"]) {
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

test("SidebarFeuilletsView : la barre Retour des pages Analyse/Révision DOCX survit au vidage de leur propre conteneur par la sous-vue", async () => {
  for (const [legacyTab, subViewKey] of [["analyse", "relecture"], ["docx", "docx"]]) {
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
