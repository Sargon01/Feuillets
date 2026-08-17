import assert from "node:assert/strict";
import test from "node:test";
import { Menu, Notice, TFile, TFolder } from "obsidian";
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
    "file-text", "calendar", "folder-cog", "bar-chart-3", "spell-check",
  ]);
});

test("SidebarFeuilletsView conserve l'ordre des onglets visibles", async () => {
  const { sidebar, contentEl } = createSidebar("notes", [], ["research", "stats"]);

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
    "file-text", "book-marked", "calendar", "folder-cog", "bar-chart-3", "spell-check",
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
  // Chantier « panneau Projet + métadonnées + mapping YAML » : le sommaire
  // compact liste désormais Objectifs/Statuts/Labels/Tags/Informations en
  // plus de la ligne « Gérer les projets… » — même grammaire que le projet
  // actif (.feuillets-notes-section-title), aucune sous-vue montée.
  const titles = allElements(container)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.deepEqual(titles, [
    `Projet ${root.path}`,
    t("sidebar.project.rowGoals"),
    t("sidebar.project.rowMapping"),
    t("sidebar.project.rowStatuses"),
    t("sidebar.project.rowLabels"),
    t("sidebar.project.rowTags"),
    t("sidebar.project.rowInfo"),
    t("sidebar.project.reveal"),
    t("sidebar.project.manage"),
  ]);
  const subs = allElements(container).filter((el) => el.classes.has("feuillets-notes-sub")).map((el) => el.text);
  assert.deepEqual(subs, ["Fiction · Halim Yalcin"]);
  assert.equal(allElements(container).some((el) => el.attrs.get("role") === "tablist"), false, "pas de tablist horizontale");
});

test("SidebarFeuilletsView : Projet crée un wrapper intérieur .feuillets-notes-container contenant HOME, sous-pages et barre Retour", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });

  // HOME : la racine reçue ne porte que le wrapper, qui porte tout le contenu.
  const homeContainer = new FakeElement();
  await sidebar.renderProjectTab(homeContainer);
  let wrappers = homeContainer.children.filter((el) => el.classes.has("feuillets-notes-container"));
  assert.equal(wrappers.length, 1, "un seul wrapper intérieur");
  assert.equal(homeContainer.children.length, 1, "aucun contenu Projet directement dans la racine reçue");
  const homeTitles = allElements(wrappers[0])
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);
  assert.ok(homeTitles.includes(`Projet ${root.path}`), "HOME Projet est dans le wrapper");

  // Sous-page : barre Retour et contenu dans le même wrapper, rien à la racine.
  sidebar.projectPage = "goals";
  const subContainer = new FakeElement();
  await sidebar.renderProjectTab(subContainer);
  wrappers = subContainer.children.filter((el) => el.classes.has("feuillets-notes-container"));
  assert.equal(wrappers.length, 1, "un seul wrapper pour la sous-page");
  assert.equal(subContainer.children.length, 1, "aucun contenu de sous-page à la racine");
  const backBar = allElements(wrappers[0]).find((el) => el.classes.has("feuillets-notes-back-bar"));
  assert.ok(backBar, "barre Retour Projet dans le wrapper");
  const subheads = allElements(wrappers[0])
    .filter((el) => el.classes.has("feuillets-settings-subhead"))
    .map((el) => el.text);
  assert.ok(subheads.includes(t("sidebar.project.rowGoals")), "sous-page Objectifs rendue dans le wrapper");
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
test("SidebarFeuilletsView : sous-page « Informations » édite ProjectMeta comme ManageProjectsModal (§10)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  sidebar.plugin.settings.projectMeta[root.path] = { type: "fiction", author: "Halim Yalcin" };
  sidebar.projectPage = "info";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const section = allElements(container).find((el) => Array.isArray(el._settings));
  assert.ok(section, "la sous-page Informations rend au moins un Setting");
  const byName = Object.fromEntries(section._settings.map((s) => [s.name, s]));

  // Nom : pas de surcharge -> champ vide, `projectDisplayName` en placeholder
  // (jamais une valeur inventée dans le champ lui-même).
  assert.equal(byName[t("modal.manageProjects.nameField")].controls[0].value, "");
  assert.equal(byName[t("modal.manageProjects.nameField")].controls[0].placeholder, `Projet ${root.path}`);
  // Auteur : déjà dans ProjectMeta -> repris tel quel.
  assert.equal(byName[t("modal.manageProjects.authorField")].controls[0].value, "Halim Yalcin");
  // Type : dropdown sur la valeur ProjectMeta actuelle.
  assert.equal(byName[t("modal.manageProjects.typeField")].controls[0].value, "fiction");
  // Description absente de ProjectMeta -> champ vide, rien d'inventé.
  assert.equal(byName[t("modal.manageProjects.descriptionField")].controls[0].value, "");
  // Fiction : pas de style de citation (non-fiction uniquement, §10).
  assert.equal(t("settings.citationStyle.name") in byName, false);

  // Éditer l'Auteur écrit exactement où ManageProjectsModal écrit déjà —
  // aucun second système de métadonnées (§10).
  byName[t("modal.manageProjects.authorField")].controls[0].changeHandler("Nouvel auteur");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].author, "Nouvel auteur");

  // Nom/Icône/Type/Description s'écrivent au même endroit (Phase E, §26 :
  // condition de suppression de Paramètres → Projet — chaque contrôle doit
  // être RÉELLEMENT écrivable depuis la sidebar).
  byName[t("modal.manageProjects.nameField")].controls[0].changeHandler("Nom perso");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].name, "Nom perso");
  byName[t("modal.manageProjects.iconField")].controls[0].changeHandler("book");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].icon, "book");
  byName[t("modal.manageProjects.descriptionField")].controls[0].changeHandler("Une description");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].description, "Une description");
  byName[t("modal.manageProjects.typeField")].controls[0].select("nonfiction");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].type, "nonfiction");
});

test("SidebarFeuilletsView : sous-page « Informations » écrit le style de citation en non-fiction (§10)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  sidebar.plugin.settings.projectMeta[root.path] = { type: "nonfiction" };
  sidebar.projectPage = "info";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const section = allElements(container).find((el) => Array.isArray(el._settings));
  const byName = Object.fromEntries(section._settings.map((s) => [s.name, s]));
  byName[t("settings.citationStyle.name")].controls[0].select("parenthetical");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].citationStyle, "parenthetical");
});

test("SidebarFeuilletsView : sous-page « Informations » affiche le style de citation en non-fiction uniquement (§10)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  sidebar.plugin.settings.projectMeta[root.path] = { type: "nonfiction" };
  sidebar.projectPage = "info";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const section = allElements(container).find((el) => Array.isArray(el._settings));
  const byName = Object.fromEntries(section._settings.map((s) => [s.name, s]));
  assert.ok(t("settings.citationStyle.name") in byName, "le style de citation apparaît en non-fiction");
});

test("SidebarFeuilletsView : sections Manuscrit/Métadonnées/Informations/Gestion rendues, Gestion ouvre ManageProjectsModal sans dupliquer sa logique", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  // Chantier « panneau Projet + métadonnées + mapping YAML » (§1) : ordre
  // MANUSCRIT / MÉTADONNÉES / INFORMATIONS / GESTION, mapping YAML absent
  // pour l'instant (Phase D).
  const heads = allElements(container)
    .filter((el) => el.classes.has("feuillets-settings-subhead"))
    .map((el) => el.text);
  assert.deepEqual(heads, [
    t("sidebar.project.header"),
    t("sidebar.project.manuscriptHeader"),
    t("sidebar.project.metadataHeader"),
    t("sidebar.project.infoHeader"),
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

test("SidebarFeuilletsView : « Révéler dans l'Explorateur » appelle le plugin natif file-explorer sans dupliquer de logique", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  const revealed = [];
  sidebar.app.internalPlugins = {
    getPluginById: (id) => id === "file-explorer" ? { instance: { revealInFolder: (f) => revealed.push(f) } } : undefined,
  };
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const revealRow = allElements(container).find(
    (el) => el.classes.has("feuillets-notes-section-title") && el.text === t("sidebar.project.reveal")
  )?.parentNode;
  assert.ok(revealRow, "la ligne « Révéler dans l'Explorateur » est présente dans Gestion");
  revealRow.events.get("click")();
  assert.deepEqual(revealed, [root]);
});

test("SidebarFeuilletsView : les entrées Objectifs/Statuts/Labels/Tags/Informations naviguent vers leur sous-page avec barre Retour", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  const cases = [
    [t("sidebar.project.rowGoals"), "goals"],
    [t("sidebar.project.rowStatuses"), "statuses"],
    [t("sidebar.project.rowLabels"), "labels"],
    [t("sidebar.project.rowTags"), "tags"],
    [t("sidebar.project.rowInfo"), "info"],
  ];
  for (const [label, page] of cases) {
    sidebar.projectPage = "home";
    const container = new FakeElement();
    await sidebar.renderProjectTab(container);
    const row = allElements(container).find(
      (el) => el.classes.has("feuillets-notes-section-title") && el.text === label
    )?.parentNode;
    assert.ok(row, `la ligne « ${label} » est présente`);
    row.events.get("click")();
    assert.equal(sidebar.projectPage, page, `clic sur « ${label} » ouvre la sous-page ${page}`);

    // La sous-page affiche la barre Retour partagée (renderBackBar) — même
    // gabarit que Relecture/Édition.
    const subContainer = new FakeElement();
    await sidebar.renderProjectTab(subContainer);
    const backBar = allElements(subContainer).find((el) => el.classes.has("feuillets-notes-back-bar"));
    assert.ok(backBar, `la sous-page ${page} affiche la barre Retour`);
    const backBtn = backBar.children.find((el) => el.classes.has("feuillets-back-btn"));
    backBtn.events.get("click")();
    assert.equal(sidebar.projectPage, "home", "Retour ramène à l'accueil du panneau Projet");
  }
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

/* Chantier « panneau Projet + métadonnées + mapping YAML », Phase B — §9,
 * §34 et l'exigence de sécurité additionnelle #4 (reset-to-inherited). */
test("SidebarFeuilletsView : sous-page « Objectifs » écrit la surcharge projet et propose un retour au réglage global", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  sidebar.plugin.settings.wordGoal = 1500;
  sidebar.projectPage = "goals";
  let container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const section = allElements(container).find((el) => Array.isArray(el._settings));
  const byName = Object.fromEntries(section._settings.map((s) => [s.name, s]));
  const wordGoalSetting = byName[t("settings.wordGoal.name", { unit: "mots" })];
  // Aucune surcharge : la valeur affichée EST la valeur globale, et aucun
  // bouton de réinitialisation n'apparaît encore.
  assert.equal(wordGoalSetting.controls[0].value, "1500");
  assert.equal(wordGoalSetting.controls.some((c) => c.type === "extra"), false);

  wordGoalSetting.controls[0].changeHandler("900");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].wordGoal, 900);
  // Le réglage global n'est JAMAIS muté par le panneau Projet (exigence #2).
  assert.equal(sidebar.plugin.settings.wordGoal, 1500);

  // Une fois la surcharge posée, le bouton de réinitialisation apparaît et
  // SUPPRIME la surcharge (jamais une copie de la valeur globale, §4).
  container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const section2 = allElements(container).find((el) => Array.isArray(el._settings));
  const wordGoalSetting2 = Object.fromEntries(section2._settings.map((s) => [s.name, s]))[t("settings.wordGoal.name", { unit: "mots" })];
  const resetBtn = wordGoalSetting2.controls.find((c) => c.type === "extra");
  assert.ok(resetBtn, "le bouton de réinitialisation apparaît une fois la surcharge posée");
  resetBtn.clickHandler();
  assert.equal("wordGoal" in sidebar.plugin.settings.projectMeta[root.path], false, "delete, jamais une copie de la valeur globale");
});

test("SidebarFeuilletsView : sous-page « Objectifs » — tolérance/objectif global/date limite/objectif de session sont réellement écrivables (Phase E, §9)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  Object.assign(sidebar.plugin.settings, { tolerance: 50, projectWordGoal: 80000, deadlineDate: "2027-01-01", sessionGoal: 500 });
  sidebar.projectPage = "goals";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const section = allElements(container).find((el) => Array.isArray(el._settings));
  const byName = Object.fromEntries(section._settings.map((s) => [s.name, s]));

  byName[t("settings.tolerance.name")].controls[0].changeHandler("20");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].tolerance, 20);

  byName[t("settings.projectWordGoal.name")].controls[0].changeHandler("60000");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].projectWordGoal, 60000);

  byName[t("settings.sessionGoal.name")].controls[0].changeHandler("300");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].sessionGoal, 300);

  byName[t("settings.deadline.name")].controls[0].changeHandler("2026-06-01");
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].deadlineDate, "2026-06-01");

  // Aucun de ces réglages globaux n'a été muté (exigence de sécurité #2).
  assert.equal(sidebar.plugin.settings.tolerance, 50);
  assert.equal(sidebar.plugin.settings.projectWordGoal, 80000);
  assert.equal(sidebar.plugin.settings.deadlineDate, "2027-01-01");
  assert.equal(sidebar.plugin.settings.sessionGoal, 500);
});

test("SidebarFeuilletsView : sous-page « Statuts » clone settings.statuses au premier changement seulement (§6)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  sidebar.plugin.settings.statuses = [{ name: "Idée", color: "#111111" }];
  sidebar.projectPage = "statuses";

  // Simplement OUVRIR la sous-page ne crée AUCUNE surcharge (§6).
  let container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.equal(sidebar.plugin.settings.projectMeta[root.path]?.statuses, undefined, "lecture seule : aucune surcharge créée en ouvrant le panneau");

  const section = allElements(container).find((el) => Array.isArray(el._settings));
  const nameSetting = section._settings[0];
  nameSetting.controls[0].changeHandler("Brouillon");
  assert.deepEqual(
    sidebar.plugin.settings.projectMeta[root.path].statuses,
    [{ name: "Brouillon", color: "#111111" }],
    "la surcharge est un CLONE modifié, le tableau global n'est jamais muté"
  );
  assert.deepEqual(sidebar.plugin.settings.statuses, [{ name: "Idée", color: "#111111" }], "settings.statuses global intact");
});

test("SidebarFeuilletsView : sous-page « Labels » clone settings.labels au premier changement seulement (§7)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  sidebar.plugin.settings.labels = [{ name: "Rouge", color: "#e0524f" }];
  sidebar.projectPage = "labels";

  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  assert.equal(sidebar.plugin.settings.projectMeta[root.path]?.labels, undefined);

  const section = allElements(container).find((el) => Array.isArray(el._settings));
  const nameSetting = section._settings[0];
  nameSetting.controls[0].changeHandler("Urgence");
  assert.deepEqual(sidebar.plugin.settings.projectMeta[root.path].labels, [{ name: "Urgence", color: "#e0524f" }]);
  assert.deepEqual(sidebar.plugin.settings.labels, [{ name: "Rouge", color: "#e0524f" }], "settings.labels global intact");
});

test("SidebarFeuilletsView : sous-page « Tags » édite favoriteTags et propose un retour au réglage global (§8)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root });
  sidebar.plugin.settings.favoriteTags = ["global"];
  sidebar.projectPage = "tags";

  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  const section = allElements(container).find((el) => Array.isArray(el._settings));
  const tagsSetting = section._settings[0];
  assert.equal(tagsSetting.controls[0].value, "global");

  tagsSetting.controls[0].changeHandler("un, deux,#trois");
  assert.deepEqual(sidebar.plugin.settings.projectMeta[root.path].favoriteTags, ["un", "deux", "trois"]);
  assert.deepEqual(sidebar.plugin.settings.favoriteTags, ["global"], "settings.favoriteTags global intact");
});

test("SidebarFeuilletsView : changer de projet depuis une sous-page ramène l'accueil du nouveau projet (§38)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const other = new TFolder("Autre/Manuscrit");
  const vaultFolders = new Map([[root.path, root], [other.path, other]]);
  const { sidebar } = createSidebar("project", [], [], { projectFolder: root, projects: [other.path], vaultFolders });
  sidebar.projectPage = "statuses";

  await sidebar.switchProject(other.path);
  assert.equal(sidebar.projectPage, "home", "aucun état résiduel de sous-page après changement de projet");
  assert.equal(sidebar.plugin.settings.projectFolder, other.path);
});

/* Chantier « panneau Projet + métadonnées + mapping YAML », Phase D —
 * §21-24 : sous-page « Correspondance des propriétés ». */
function openMappingMenu(container, fieldLabel) {
  const row = allElements(container).find(
    (el) => el.classes.has("feuillets-notes-section-title") && el.text === fieldLabel
  )?.parentNode;
  assert.ok(row, `la ligne « ${fieldLabel} » est présente`);
  row.events.get("click")({});
  return Menu.lastShown;
}

test("SidebarFeuilletsView : « Correspondance des propriétés » propose la clé par défaut puis les propriétés RAW détectées dans le manuscrit actif", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const sceneA = new TFile("Roman/Manuscrit/A.md");
  const sceneB = new TFile("Roman/Manuscrit/B.md");
  const { sidebar } = createSidebar("project", [], [], {
    projectFolder: root,
    projectFiles: [
      { file: sceneA, frontmatter: { Synopsis: "x", State: "Draft" } },
      { file: sceneB, frontmatter: { synopsis: "y" } },
    ],
  });
  sidebar.projectPage = "mapping";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const menu = openMappingMenu(container, t("sidebar.project.mappingField.synopsis"));
  const titles = menu.items.filter((i) => !i.separator).map((i) => i.title);
  const defaultTitle = t("sidebar.project.mappingDefault", { field: t("sidebar.project.mappingField.synopsis") });
  assert.deepEqual(titles, [defaultTitle, "State", "synopsis", "Synopsis"]);
  assert.equal(menu.items.find((i) => i.title === defaultTitle).checked, true, "aucun mapping configuré -> l'option par défaut est cochée");
});

test("SidebarFeuilletsView : choisir une propriété RAW écrit propertyMap, sans modifier aucun fichier (§23)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const scene = new TFile("Roman/Manuscrit/A.md");
  const { sidebar, order } = createSidebar("project", [], [], {
    projectFolder: root,
    projectFiles: [{ file: scene, frontmatter: { State: "Draft" } }],
  });
  sidebar.projectPage = "mapping";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);
  order.length = 0;

  const menu = openMappingMenu(container, t("sidebar.project.mappingField.status"));
  menu.items.find((i) => i.title === "State").callback();

  assert.deepEqual(sidebar.plugin.settings.projectMeta[root.path].propertyMap, { status: "State" });
  assert.deepEqual(order.filter((e) => e !== "settings"), ["save", "renderAll"]);
});

test("SidebarFeuilletsView : revenir à « Propriété Feuillets par défaut » supprime la surcharge (et propertyMap devenu vide)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const scene = new TFile("Roman/Manuscrit/A.md");
  const { sidebar } = createSidebar("project", [], [], {
    projectFolder: root,
    projectFiles: [{ file: scene, frontmatter: { State: "Draft" } }],
  });
  sidebar.plugin.settings.projectMeta[root.path] = { propertyMap: { status: "State" } };
  sidebar.projectPage = "mapping";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const menu = openMappingMenu(container, t("sidebar.project.mappingField.status"));
  const defaultTitle = t("sidebar.project.mappingDefault", { field: t("sidebar.project.mappingField.status") });
  menu.items.find((i) => i.title === defaultTitle).callback();

  assert.equal("propertyMap" in sidebar.plugin.settings.projectMeta[root.path], false, "propertyMap vide entièrement supprimé");
});

test("SidebarFeuilletsView : une collision entre deux champs mappés vers la même propriété est refusée (§24)", async () => {
  const root = new TFolder("Roman/Manuscrit");
  const scene = new TFile("Roman/Manuscrit/A.md");
  const { sidebar } = createSidebar("project", [], [], {
    projectFolder: root,
    projectFiles: [{ file: scene, frontmatter: { Description: "x" } }],
  });
  sidebar.plugin.settings.projectMeta[root.path] = { propertyMap: { synopsis: "Description" } };
  sidebar.projectPage = "mapping";
  const container = new FakeElement();
  await sidebar.renderProjectTab(container);

  const notices = [];
  const original = Notice.onCreate;
  Notice.onCreate = (msg) => notices.push(msg);
  try {
    const menu = openMappingMenu(container, t("sidebar.project.mappingField.summary"));
    menu.items.find((i) => i.title === "Description").callback();
  } finally {
    Notice.onCreate = original;
  }

  assert.equal(notices.length, 1, "une Notice de collision est affichée");
  assert.equal(
    sidebar.plugin.settings.projectMeta[root.path].propertyMap.summary,
    undefined,
    "aucune collision silencieuse : le second mapping n'est pas écrit"
  );
  assert.equal(sidebar.plugin.settings.projectMeta[root.path].propertyMap.synopsis, "Description", "le premier mapping reste intact");
});
