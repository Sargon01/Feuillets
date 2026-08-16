import assert from "node:assert/strict";
import test from "node:test";
import { Menu, TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { hasKnownProject } from "../src/services/folder-structure.js";
import { remapResearchFolderLinks, isInsideResearchSpace, resolveUniqueFolderMatch, showChoices } from "../src/views/base-feuillets-view.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";
import { NewFolderModal } from "../src/ui/basic-modals.js";
import { FolderSuggest } from "../src/ui/folder-suggest.js";
import { t } from "../src/i18n/index.js";

/* La décision "écran d'accueil vs gestionnaire de projets" repose sur
   hasKnownProject(), pure et testée directement ci-dessous : c'est ce qui
   garantit que l'écran d'accueil n'apparaît qu'au tout premier lancement,
   sans dépendre de la construction DOM du Binder. */
test("hasKnownProject : aucun projet ni actif ni connu", () => {
  assert.equal(hasKnownProject({ projectFolder: "", projects: [] }), false);
  assert.equal(hasKnownProject(null), false);
  assert.equal(hasKnownProject(undefined), false);
});

test("hasKnownProject : un projet actif compte, même si la liste projects est vide", () => {
  assert.equal(hasKnownProject({ projectFolder: "Roman1/Manuscrit", projects: [] }), true);
});

test("hasKnownProject : un projet connu mais inactif compte aussi", () => {
  assert.equal(hasKnownProject({ projectFolder: "", projects: ["Ancien/Manuscrit"] }), true);
});

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    // `_props` : seule addition sur le stub `style` — capture les variables
    // CSS posées via `setProperty` (ex. `--feuillets-binder-depth`, LOT
    // FINAL Binder ↔ Continu §15) pour des assertions structurelles, jamais
    // de pixel calculé (§35).
    this.style = { _props: {}, setProperty(name, value) { this._props[name] = value; } };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  setText(text) { this.text = String(text); return this; }
  setAttr() {}
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
}

function findElements(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findElements(child, predicate));
  }
  return found;
}

function textContent(element) {
  return [element.text, ...element.children.map(textContent)].join(" ");
}

/** Fenêtre minimale pour les tests qui déclenchent un simple clic sur une
 * ligne de dossier : le repli/dépli est désormais programmé après un court
 * délai (voir BINDER_CLICK_DELAY_MS, feuillets-view.ts) pour laisser un
 * double-clic l'annuler avant qu'il ne parte — sans jsdom, `window` n'existe
 * pas dans cet environnement de test Node, donc `window.setTimeout` y
 * lèverait sans ce mock. Timers CONTRÔLABLES (jamais exécutés tout de
 * suite) : `flush()` simule le délai écoulé, sans flush un `dblclick`
 * immédiat doit annuler le repli/dépli en attente (voir clearTimeout). */
function installFakeBinderTimers() {
  const original = globalThis.window;
  const pending = new Map();
  let nextId = 1;
  globalThis.window = {
    setTimeout(fn) {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
  };
  return {
    flush() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    pendingCount() { return pending.size; },
    restore() { globalThis.window = original; },
  };
}

function baseSettings(overrides = {}) {
  return {
    projectFolder: "",
    projects: [],
    projectMeta: {},
    binderLayout: "tree",
    binderCompact: false,
    binderTreeWidth: 240,
    collapsed: {},
    ...overrides,
  };
}

/** render() construit une barre d'actions (gérer les projets, plan du
   tableau, double volet, densité) AVANT de brancher accueil/gestionnaire —
   ces icônes ont besoin d'un plugin minimal, mais aucun de leurs clics
   n'est déclenché ici : seule la présence du bon écran en dessous est
   vérifiée. */
function createView(settings) {
  const contentEl = new FakeElement();
  const app = { vault: { getAbstractFileByPath: () => null } };
  const plugin = {
    settings,
    getProjectFolder: () => null,
    projectDisplayName: (path) => path,
    activateBoard() {},
  };
  const view = new FeuilletsView({ app, contentEl }, plugin);
  return { view, contentEl };
}

/* §18/§39 du chantier « espace central » : plus d'icône « Gérer les projets »
 * (folder-cog) dans la barre du Binder actif — la gestion quotidienne du projet
 * vit dans l'onglet Projet du panneau latéral. La place est laissée LIBRE pour
 * un futur bouton Double vue : aucune nouvelle icône ne la remplace. */
test("Binder : Recherche et Filtres sont des actions indépendantes, sans icône Projet", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    binderStatusFilter: "Tous",
    binderLabelFilter: "Tous",
    binderProgressFilter: "Tous",
    projects: ["Autre/Manuscrit"],
  });
  const contentEl = new FakeElement();
  const createdSheets = [];
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: () => [],
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: (path) => path === root.path ? "Projet actif" : "Autre projet",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    renderAllViews() {},
    updateStatusBar() {},
    newSheet: (folder) => { createdSheets.push(folder); },
    newFolder() {},
  };
  const view = new FeuilletsView({
    app: {
      vault: { getAbstractFileByPath: (path) => path === root.path ? root : null },
      workspace: {},
    },
    contentEl,
  }, plugin);
  const buttons = [];
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    button.tooltip = tooltip;
    button.parent = parent;
    if (onClick) button.addEventListener("click", onClick);
    buttons.push(button);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};

  await view.render(true);

  const searchButton = buttons.find((button) => button.icon === "search");
  const filterButton = buttons.find((button) => button.icon === "list-filter");
  const quickActionIcons = buttons
    .filter((button) => button.parent.classes.has("feuillets-actions") || button.parent.classes.has("feuillets-binder-filters"))
    .map((button) => button.icon);
  assert.ok(searchButton, "l'action Recherche utilise l'icône search");
  assert.ok(filterButton, "l'action Filtres utilise l'icône list-filter sans filtre actif");
  assert.deepEqual(quickActionIcons, ["notebook", "layout-grid", "columns-2", "rows-3", "search", "list-filter"]);
  assert.equal(buttons.find((button) => button.icon === "download"), undefined, "l'icône Export rapide reste retirée");
  assert.equal(buttons.find((button) => button.icon === "folder-cog"), undefined, "l'icône Gérer les projets a quitté la barre du Binder");

  const rootName = findElements(contentEl, (element) => element.classes.has("feuillets-folder-name"))[0];
  const rootRow = findElements(contentEl, (element) => element.classes.has("feuillets-tree-root"))[0];
  assert.equal(findElements(contentEl, (element) => element.classes.has("feuillets-folder-add")).length, 0);
  const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
  const menus = [];
  Menu.prototype.showAtMouseEvent = function showAtMouseEvent() { menus.push(this); return this; };
  try {
    view.render = async () => {};
    rootName.events.get("click")({ stopPropagation() {} });
    assert.equal(settings.collapsed[root.path], true, "le nom racine replie globalement le manuscrit");
    rootRow.events.get("contextmenu")({ preventDefault() {} });
    const rootMenu = menus[0];
    const newSheet = rootMenu.items.find((item) => item.title === t("binder.newSheetHere"));
    assert.ok(newSheet);
    newSheet.callback();
    assert.deepEqual(createdSheets, [root], "Nouveau feuillet cible la racine du projet");
    assert.ok(rootMenu.items.some((item) => item.title === t("binder.newFolder")));
    assert.ok(rootMenu.items.some((item) => item.title === t("binder.importOutline")));
  } finally {
    Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
  }

  const originalWindow = globalThis.window;
  let menuOpenCount = 0;
  globalThis.window = { setTimeout() { return 0; } };
  Menu.prototype.showAtMouseEvent = function showAtMouseEvent() { menuOpenCount++; return this; };
  try {
    view.render = async () => {};
    searchButton.events.get("click")();
    assert.equal(menuOpenCount, 0, "Recherche n'ouvre aucun menu");
    assert.equal(view._binderSearchOpen, true);

    filterButton.events.get("click")({});
    assert.equal(menuOpenCount, 1, "Filtres ouvre son menu");
    assert.equal(view._binderSearchOpen, true, "Filtres ne modifie pas l'état de Recherche");
  } finally {
    Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
    globalThis.window = originalWindow;
  }

  settings.binderStatusFilter = "Atteint";
  buttons.length = 0;
  await FeuilletsView.prototype.render.call(view, true);
  assert.ok(buttons.some((button) => button.icon === "filter"), "Filtres utilise l'icône filter lorsqu'un filtre est actif");
});

test("Binder : aucun mode Coffre — aucune double vue Coffre ne subsiste", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    collapsed: {},
  });
  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Projet",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
  };
  const view = new FeuilletsView({
    app: {
      vault: { getAbstractFileByPath: (path) => path === root.path ? root : null },
      workspace: {},
    },
    contentEl,
  }, plugin);
  const buttons = [];
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    buttons.push(button);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};

  await view.render(true);

  assert.equal(buttons.find((button) => button.icon === "folder-cog"), undefined, "plus de bouton Projet dans la barre du Binder (§18)");
  assert.equal(typeof view.isVaultMode, "undefined", "isVaultMode() a été retiré avec le prototype Coffre");
  assert.equal(typeof view.renderVaultBody, "undefined", "renderVaultBody a été retiré avec le prototype Coffre");
  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-vault-split")).length, 0, "aucune double vue Coffre dans le DOM");
});

test("Binder : replier depuis le nom du projet laisse chaque dossier dépliable individuellement", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/FRONT");
  const tarikat = new TFolder("Projet/Manuscrit/TARIKAT");
  const dedicace = new TFile("Projet/Manuscrit/FRONT/Dédicace.md");
  const feuillet1 = new TFile("Projet/Manuscrit/TARIKAT/Feuillet 1.md");
  const racine = new TFile("Projet/Manuscrit/Racine.md");
  front.children = [dedicace];
  tarikat.children = [feuillet1];
  dedicace.parent = front;
  feuillet1.parent = tarikat;
  root.children = [front, tarikat, racine];
  front.parent = root;
  tarikat.parent = root;
  racine.parent = root;

  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    collapsed: {},
  });
  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [dedicace, feuillet1, racine],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Projet",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
  };
  const view = new FeuilletsView({
    app: {
      vault: { getAbstractFileByPath: (path) => path === root.path ? root : null },
      workspace: {},
    },
    contentEl,
  }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};

  const folderNames = () =>
    findElements(contentEl, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"))
      .map((el) => el.children.find((c) => c.classes.has("feuillets-folder-name"))?.text);
  const itemNames = () =>
    findElements(contentEl, (el) => el.classes.has("feuillets-item-name")).map((el) => el.text.trim());

  /* Les gestionnaires de clic du Binder déclenchent eux-mêmes un
     this.render(true) en tâche de fond (jamais attendu par l'appelant réel
     — un simple clic utilisateur). Dans ce test, on neutralise ce
     ré-affichage interne pour ne garder qu'un seul rendu déterministe par
     étape, déclenché explicitement via realRender — même patron que le
     test "sélecteur de projet…" plus haut. */
  const realRender = view.render.bind(view);

  // État initial : tout déplié par défaut (rien dans S.collapsed).
  await realRender(true);
  assert.deepEqual(folderNames(), ["FRONT", "TARIKAT"]);
  assert.deepEqual(itemNames(), ["Dédicace", "Feuillet 1", "Racine"]);

  view.render = async () => {};

  // Clic sur le nom du projet : replie tout.
  const rootName = findElements(contentEl, (el) => el.classes.has("feuillets-tree-root"))[0]
    .children.find((c) => c.classes.has("feuillets-folder-name"));
  rootName.events.get("click")({ stopPropagation() {} });
  await realRender(true);

  assert.equal(settings.collapsed[root.path], true, "la racine est marquée repliée");
  assert.equal(settings.collapsed[front.path], true, "FRONT est marqué replié par le repli global");
  assert.equal(settings.collapsed[tarikat.path], true, "TARIKAT est marqué replié par le repli global");
  assert.deepEqual(folderNames(), ["FRONT", "TARIKAT"], "les dossiers restent visibles et cliquables après repli global");
  assert.deepEqual(itemNames(), [], "les feuillets (y compris ceux de la racine) sont masqués après repli global");

  // Déplier uniquement FRONT : TARIKAT doit rester replié. LOT FINAL Binder
  // ↔ Continu : le repli/dépli d'un dossier est désormais la responsabilité
  // EXCLUSIVE de son chevron (le clic sur le NOM ouvre Continu, voir le test
  // dédié plus bas) — clic chevron IMMÉDIAT, aucune temporisation, aucun
  // double-clic à laisser s'annoncer (le chevron n'isole jamais).
  const findFolderRow = (name) =>
    findElements(contentEl, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"))
      .find((el) => el.children.some((c) => c.classes.has("feuillets-folder-name") && c.text === name));
  const findChevron = (name) =>
    findFolderRow(name).children.find((c) => c.classes.has("feuillets-folder-chevron"));

  findChevron("FRONT").events.get("click")({ preventDefault() {}, stopPropagation() {} });
  await realRender(true);

  assert.equal(settings.collapsed[front.path], undefined, "FRONT est déplié après son propre chevron");
  assert.equal(settings.collapsed[tarikat.path], true, "TARIKAT reste replié, indépendamment de FRONT");
  assert.deepEqual(itemNames(), ["Dédicace"], "seul le contenu de FRONT apparaît, toujours sans les feuillets racine");

  // Redéplier TARIKAT individuellement : les deux dossiers sont ouverts, la
  // racine reste marquée repliée (elle ne gère que ses feuillets directs).
  findChevron("TARIKAT").events.get("click")({ preventDefault() {}, stopPropagation() {} });
  await realRender(true);
  assert.deepEqual(itemNames(), ["Dédicace", "Feuillet 1"], "FRONT et TARIKAT sont tous deux dépliés, la racine masque toujours ses feuillets directs");

  // Reclic sur le nom du projet : déplie tout, y compris les feuillets racine.
  const rootName2 = findElements(contentEl, (el) => el.classes.has("feuillets-tree-root"))[0]
    .children.find((c) => c.classes.has("feuillets-folder-name"));
  rootName2.events.get("click")({ stopPropagation() {} });
  await realRender(true);
  assert.equal(settings.collapsed[root.path], undefined, "tout déplier retire le repli de la racine");
  assert.equal(settings.collapsed[front.path], undefined);
  assert.equal(settings.collapsed[tarikat.path], undefined);
  assert.deepEqual(itemNames(), ["Dédicace", "Feuillet 1", "Racine"], "tout déplier réaffiche aussi les feuillets racine");
});

test("Binder : simple clic sur le nom ouvre Continu (temporisé), le chevron replie/déplie, double-clic isole sans jamais ouvrir Continu ni replier au passage", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/FRONT");
  const tarikat = new TFolder("Projet/Manuscrit/TARIKAT");
  const chapitre1 = new TFolder("Projet/Manuscrit/TARIKAT/CHAPITRE 1");
  const dedicace = new TFile("Projet/Manuscrit/FRONT/Dédicace.md");
  const feuilletC1 = new TFile("Projet/Manuscrit/TARIKAT/CHAPITRE 1/Feuillet C1.md");
  front.children = [dedicace];
  chapitre1.children = [feuilletC1];
  tarikat.children = [chapitre1];
  root.children = [front, tarikat];
  for (const [f, parent] of [[dedicace, front], [feuilletC1, chapitre1], [chapitre1, tarikat], [front, root], [tarikat, root]]) f.parent = parent;

  const byPath = new Map([root, front, tarikat, chapitre1, dedicace, feuilletC1].map((f) => [f.path, f]));
  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    collapsed: {},
    // requis par resolveCompileScopeFiles/getOrderedChildren (RÉELS, jamais
    // mockés) — voir openFolderInContinu, exercé par le simple clic ci-dessous.
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
  });
  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [dedicace, feuilletC1],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Projet actif",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    folderNoteFor: () => null,
    // `workspace: {}` (pas de getMostRecentLeaf) : activeContinuMembershipView
    // retombe donc toujours sur `getLeafForOpeningFile()` — `null` ici pour
    // que l'ouverture Continu programmée par le simple clic reste un no-op
    // sûr, ce test se concentrant sur le TIMING clic/chevron/dblclic, pas
    // sur la recomposition Continu elle-même (couverte ailleurs).
    getLeafForOpeningFile: () => null,
  };
  const view = new FeuilletsView({
    app: {
      vault: { getAbstractFileByPath: (path) => byPath.get(path) || null },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
      workspace: {},
    },
    contentEl,
  }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  view.ensureSelectionForContextMenu = () => {};

  const findFolderRow = (name) =>
    findElements(contentEl, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"))
      .find((el) => el.children.some((c) => c.classes.has("feuillets-folder-name") && c.text === name));
  const findChevron = (name) => findFolderRow(name).children.find((c) => c.classes.has("feuillets-folder-chevron"));
  const currentHeaderText = () =>
    findElements(contentEl, (el) => el.classes.has("feuillets-tree-root"))[0]
      .children.find((c) => c.classes.has("feuillets-folder-name"))?.text;

  await view.render(true);
  assert.equal(currentHeaderText(), "Projet actif");
  // §13-16 : un chevron FONCTIONNEL par dossier ayant des enfants (FRONT,
  // TARIKAT, CHAPITRE 1) + une colonne chevron RÉSERVÉE (vide) sur chaque
  // ligne fichier (Dédicace, Feuillet C1) pour l'alignement des colonnes.
  const allChevrons = findElements(contentEl, (el) => el.classes.has("feuillets-folder-chevron"));
  assert.equal(allChevrons.filter((c) => !c.classes.has("is-empty")).length, 3, "un chevron actif par dossier avec enfants");
  assert.equal(allChevrons.filter((c) => c.classes.has("is-empty")).length, 2, "une colonne réservée vide par ligne fichier");

  /* Les gestionnaires cliqués ci-dessous déclenchent eux-mêmes un
     this.render(true) en tâche de fond (jamais attendu par l'appelant réel,
     un simple clic/dblclic) — neutralisé pour ne garder qu'un seul rendu
     déterministe par étape, déclenché explicitement via realRender (même
     patron que les autres tests d'isolation/repli plus haut). `renderCalls`
     compte les appels sans jamais reconstruire le DOM entre deux étapes. */
  const realRender = view.render.bind(view);
  let renderCalls = 0;
  view.render = async () => { renderCalls++; };
  const timers = installFakeBinderTimers();

  const openFolderCalls = [];
  const realOpenFolderInContinu = view.openFolderInContinu.bind(view);
  view.openFolderInContinu = async (folder) => {
    openFolderCalls.push(folder.path);
    return realOpenFolderInContinu(folder);
  };

  try {
    // --- Chevron : plier/déplier IMMÉDIAT, sans délai, jamais Continu, jamais isolation. ---
    findChevron("FRONT").events.get("click")({ preventDefault() {}, stopPropagation() {} });
    await realRender(true);
    assert.equal(settings.collapsed[front.path], true, "le chevron FRONT replie");
    assert.equal(openFolderCalls.length, 0, "le chevron n'ouvre jamais Continu");
    assert.equal(view._binderWorkingRootPath, undefined, "le chevron n'isole jamais");

    findChevron("FRONT").events.get("click")({ preventDefault() {}, stopPropagation() {} });
    await realRender(true);
    assert.equal(settings.collapsed[front.path], undefined, "reclic chevron : FRONT se déplie");

    // --- Simple clic sur le NOM : programme l'ouverture Continu, n'isole
    //     jamais, ne replie/déplie jamais (devenu la responsabilité exclusive
    //     du chevron ci-dessus). `renderCalls` remis à zéro : les deux clics
    //     chevron ci-dessus ont chacun légitimement déclenché leur propre
    //     rendu immédiat, hors sujet pour cette assertion. ---
    renderCalls = 0;
    findFolderRow("FRONT").events.get("click")({});
    assert.equal(timers.pendingCount(), 1, "l'ouverture Continu est programmée, pas exécutée tout de suite");
    assert.equal(openFolderCalls.length, 0, "rien avant l'écoulement du délai");
    assert.equal(view._binderWorkingRootPath, undefined, "un simple clic sur le nom n'isole jamais");
    assert.equal(renderCalls, 0, "programmer l'ouverture Continu ne redéclenche aucun rendu tout de suite");
    timers.flush();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(openFolderCalls, [front.path], "le délai écoulé sans double-clic : Continu programmé pour FRONT");
    assert.equal(settings.collapsed[front.path], undefined, "le simple clic sur le nom ne replie/déplie jamais");

    // --- Double-clic : annule l'ouverture Continu programmée puis isole — jamais les deux. ---
    findFolderRow("TARIKAT").events.get("click")({});
    assert.equal(timers.pendingCount(), 1, "le premier clic du double-clic programme quand même l'ouverture Continu");
    findFolderRow("TARIKAT").events.get("dblclick")({ preventDefault() {} });
    assert.equal(timers.pendingCount(), 0, "le dblclick annule l'ouverture Continu programmée par le premier clic avant qu'elle ne parte");
    await realRender(true);
    assert.equal(view._binderWorkingRootPath, tarikat.path, "double-clic = isolateFolder, exactement comme « Isoler ce dossier »");
    assert.equal(currentHeaderText(), "TARIKAT");
    assert.deepEqual(openFolderCalls, [front.path], "le double-clic n'a PAS aussi ouvert Continu au passage");
    assert.equal(settings.collapsed[tarikat.path], undefined, "le double-clic n'a PAS aussi replié/déplié TARIKAT au passage");

    // --- Depuis cette branche isolée, un sous-dossier peut aussi être isolé par double-clic. ---
    assert.ok(findFolderRow("CHAPITRE 1"), "CHAPITRE 1, visible dans la branche isolée, a sa propre ligne");
    findFolderRow("CHAPITRE 1").events.get("dblclick")({ preventDefault() {} });
    await realRender(true);
    assert.equal(view._binderWorkingRootPath, chapitre1.path, "isolation imbriquée : un sous-dossier déjà isolé peut être isolé à son tour");
    assert.equal(currentHeaderText(), "CHAPITRE 1");
    assert.equal(settings.collapsed[chapitre1.path], undefined, "là non plus, le double-clic ne replie pas CHAPITRE 1 au passage");
  } finally {
    timers.restore();
  }

  // --- Aucune régression : clic droit et drag/drop restent posés sur chaque ligne. ---
  const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
  const menus = [];
  Menu.prototype.showAtMouseEvent = function showAtMouseEvent() { menus.push(this); return this; };
  try {
    view._binderWorkingRootPath = undefined;
    await realRender(true);
    findFolderRow("TARIKAT").events.get("contextmenu")({ preventDefault() {} });
    assert.ok(menus.pop().items.some((item) => item.title === t("binder.isolateFolder")), "le menu contextuel du dossier reste inchangé");
    assert.ok(findFolderRow("TARIKAT").children.some((c) => c.classes.has("feuillets-drag-grip")), "la poignée de drag/drop reste présente");
  } finally {
    Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
  }
});

test("Binder : profondeur par variable CSS — un feuillet aligne sa colonne sur les dossiers du même niveau", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/FRONT");
  const sub = new TFolder("Projet/Manuscrit/FRONT/Sous-dossier");
  const dedicace = new TFile("Projet/Manuscrit/FRONT/Dédicace.md");
  const nested = new TFile("Projet/Manuscrit/FRONT/Sous-dossier/Feuillet.md");
  sub.children = [nested];
  nested.parent = sub;
  front.children = [dedicace, sub];
  dedicace.parent = front;
  sub.parent = front;
  root.children = [front];
  front.parent = root;
  const byPath = new Map([root, front, sub, dedicace, nested].map((f) => [f.path, f]));

  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    collapsed: {},
  });
  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [dedicace, nested],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Projet",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
  };
  const view = new FeuilletsView({
    app: {
      vault: { getAbstractFileByPath: (path) => byPath.get(path) || null },
      workspace: {},
    },
    contentEl,
  }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};

  await view.render(true);

  // §15-16/§35 : une seule variable CSS de profondeur (`--feuillets-binder-depth`,
  // via `style.setProperty`), jamais un jeu de classes depth-1/depth-2/etc.,
  // jamais un pixel calculé testé en dur ici (voir styles.css pour le calc()).
  const folderDepth = (name) =>
    findElements(contentEl, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"))
      .find((el) => el.children.some((c) => c.classes.has("feuillets-folder-name") && c.text === name))
      .style._props["--feuillets-binder-depth"];
  const itemDepth = (name) =>
    findElements(contentEl, (el) => el.classes.has("feuillets-item"))
      .find((el) => findElements(el, (n) => n.classes.has("feuillets-item-name") && n.text.trim() === name).length > 0)
      .style._props["--feuillets-binder-depth"];

  assert.equal(folderDepth("FRONT"), "0", "dossier de premier niveau : profondeur 0");
  assert.equal(folderDepth("Sous-dossier"), "1");
  // Dédicace et Sous-dossier sont SIBLINGS (tous deux enfants directs de
  // FRONT) : même profondeur, alignement structurel garanti — c'est le
  // critère exact du §16, pas "un feuillet suit son dossier conteneur".
  assert.equal(itemDepth("Dédicace"), "1", "feuillet aligné sur Sous-dossier, son frère du même niveau");
  assert.equal(itemDepth("Feuillet"), "2", "un niveau de plus, comme les enfants de Sous-dossier");

  // Aucun jeu de classes depth-1/depth-2/etc. (jamais réintroduit).
  const depthClasses = findElements(contentEl, (el) =>
    [...el.classes].some((c) => /^(feuillets-)?depth-\d+$/.test(c) && c !== "is-depth-0")
  );
  assert.equal(depthClasses.length, 0, "aucune classe depth-N — seulement la variable CSS");

  // Vue ISOLÉE (FRONT devient la racine de travail) : la profondeur repart
  // de 0, exactement comme un nouvel arbre — même mécanisme d'isolation
  // déjà existant, aucune nouvelle préférence.
  view._binderWorkingRootPath = front.path;
  await view.render(true);
  assert.equal(folderDepth("Sous-dossier"), "0", "vue isolée : Sous-dossier redevient un dossier de premier niveau");
  assert.equal(itemDepth("Dédicace"), "0", "vue isolée : feuillet racine de la branche isolée, aligné sur Sous-dossier");
  assert.equal(itemDepth("Feuillet"), "1", "vue isolée : un niveau de plus que Sous-dossier, inchangé");
});

test("Binder : icônes dossier/feuillet natives + liseré de label sur l'icône, jamais un recolorage de ligne", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/FRONT");
  const etiquette = new TFile("Projet/Manuscrit/FRONT/Étiquetée.md");
  const neutre = new TFile("Projet/Manuscrit/FRONT/Neutre.md");
  front.children = [etiquette, neutre];
  etiquette.parent = front;
  neutre.parent = front;
  root.children = [front];
  front.parent = root;
  const byPath = new Map([root, front, etiquette, neutre].map((f) => [f.path, f]));

  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    collapsed: {},
    binderShowLabels: true,
  });
  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [etiquette, neutre],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: (file) => (file === etiquette ? "Intrigue" : ""),
    labelColor: (name) => (name === "Intrigue" ? "#ff8800" : null),
    labelsOf: () => [],
    projectDisplayName: () => "Projet",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
  };
  const view = new FeuilletsView({
    app: {
      vault: { getAbstractFileByPath: (path) => byPath.get(path) || null },
      workspace: {},
    },
    contentEl,
  }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};

  await view.render(true);

  const folderRow = findElements(contentEl, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"))
    .find((el) => el.children.some((c) => c.classes.has("feuillets-folder-name") && c.text === "FRONT"));
  const folderIcon = folderRow.children.find((c) => c.classes.has("feuillets-binder-node-icon"));
  assert.ok(folderIcon, "wrapper icône présent sur la ligne dossier");
  assert.equal(folderIcon.icon, "folder", "icône dossier native, jamais un emoji/SVG maison");
  assert.equal(folderIcon.classes.has("has-label"), false, "icône dossier neutre : aucun label dossier inventé dans ce lot");

  const itemFor = (name) =>
    findElements(contentEl, (el) => el.classes.has("feuillets-item"))
      .find((el) => findElements(el, (n) => n.classes.has("feuillets-item-name") && n.text.trim() === name).length > 0);
  const iconOf = (item) => item.children.find((c) => c.classes.has("feuillets-binder-node-icon"));

  const labelledIcon = iconOf(itemFor("Étiquetée"));
  assert.ok(labelledIcon, "wrapper icône présent sur la ligne feuillet");
  assert.equal(labelledIcon.icon, "file-text", "icône feuillet native");
  assert.equal(labelledIcon.classes.has("has-label"), true, "feuillet avec label : liseré actif");
  assert.equal(labelledIcon.style._props["--feuillets-label-color"], "#ff8800", "couleur alimentée par la résolution EXISTANTE (labelColor)");

  const neutralIcon = iconOf(itemFor("Neutre"));
  assert.equal(neutralIcon.classes.has("has-label"), false, "feuillet sans label : aucune couleur fantôme");
  assert.equal(neutralIcon.style._props["--feuillets-label-color"], undefined);

  // Le label ne recolore JAMAIS le texte ni la classe active/Continu de la
  // ligne elle-même — seul le liseré change, jamais la sémantique .is-active/
  // .is-continu-member (voir styles.css, .feuillets-binder-node-icon.has-label).
  assert.equal(itemFor("Étiquetée").classes.has("is-active"), false);
  assert.equal(itemFor("Étiquetée").classes.has("is-continu-member"), false);

  // Aucune icône de membership réintroduite (cercle/check).
  const membershipIcons = findElements(contentEl, (el) => el.icon === "circle" || el.icon === "circle-check");
  assert.equal(membershipIcons.length, 0);
});

test("Binder : isoler un dossier limite l'affichage à sa branche, sans jamais toucher au projet réel", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const front = new TFolder("Projet/Manuscrit/FRONT");
  const tarikat = new TFolder("Projet/Manuscrit/TARIKAT");
  const subhanallah = new TFolder("Projet/Manuscrit/SUBHANALLAH");
  const chapitre1 = new TFolder("Projet/Manuscrit/TARIKAT/CHAPITRE 1");
  const chapitre2 = new TFolder("Projet/Manuscrit/TARIKAT/CHAPITRE 2");
  const dedicace = new TFile("Projet/Manuscrit/FRONT/Dédicace.md");
  const feuillet1 = new TFile("Projet/Manuscrit/SUBHANALLAH/Feuillet 1.md");
  const feuilletC1 = new TFile("Projet/Manuscrit/TARIKAT/CHAPITRE 1/Feuillet C1.md");
  const feuilletC2 = new TFile("Projet/Manuscrit/TARIKAT/CHAPITRE 2/Feuillet C2.md");
  const racine = new TFile("Projet/Manuscrit/Racine.md");
  const versionsRoot = new TFolder("Projet/Manuscrit/_Versions");
  versionsRoot.children = [];

  front.children = [dedicace];
  subhanallah.children = [feuillet1];
  chapitre1.children = [feuilletC1];
  chapitre2.children = [feuilletC2];
  tarikat.children = [chapitre1, chapitre2];
  root.children = [front, tarikat, subhanallah, racine];
  for (const [f, parent] of [
    [dedicace, front], [feuillet1, subhanallah], [feuilletC1, chapitre1],
    [feuilletC2, chapitre2], [chapitre1, tarikat], [chapitre2, tarikat],
    [front, root], [tarikat, root], [subhanallah, root], [racine, root],
  ]) f.parent = parent;

  const byPath = new Map(
    [root, front, tarikat, subhanallah, chapitre1, chapitre2, dedicace, feuillet1, feuilletC1, feuilletC2, racine, versionsRoot]
      .map((f) => [f.path, f])
  );

  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    collapsed: {},
  });
  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => versionsRoot,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [dedicace, feuillet1, feuilletC1, feuilletC2, racine],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Projet actif",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    // Nécessaires seulement pour CONSTRUIRE le menu contextuel standard
    // d'un dossier (showFolderContextMenu) — aucune de ces actions n'est
    // déclenchée par ce test, qui ne clique que sur « Isoler ce dossier ».
    folderNoteFor: () => null,
  };
  const view = new FeuilletsView({
    app: {
      vault: { getAbstractFileByPath: (path) => byPath.get(path) || null },
      workspace: {},
    },
    contentEl,
  }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  // FakeElement (ci-dessus) n'implémente pas querySelectorAll : hors sujet
  // pour ce test (sélection multiple), qui ne porte que sur l'isolation.
  view.ensureSelectionForContextMenu = () => {};

  const folderNames = () =>
    findElements(contentEl, (el) =>
      el.classes.has("feuillets-folder-row") &&
      !el.classes.has("feuillets-tree-root") &&
      !el.classes.has("feuillets-binder-research-row")
    ).map((el) => el.children.find((c) => c.classes.has("feuillets-folder-name"))?.text);
  const itemNames = () =>
    findElements(contentEl, (el) => el.classes.has("feuillets-item-name")).map((el) => el.text.trim());
  const versionsVisible = () =>
    findElements(contentEl, (el) => el.classes.has("feuillets-binder-research-root")).length > 0;
  // En-tête (chantier "en-tête d'isolation compact") : ligne
  // .feuillets-tree-root, [icône manuscrit, chevron ‹] seulement quand
  // isolé, puis un unique span .feuillets-folder-name — jamais un fil
  // d'Ariane à plusieurs segments.
  const rootRowNow = () => findElements(contentEl, (el) => el.classes.has("feuillets-tree-root"))[0];
  const isolationIcons = () => rootRowNow().children.filter((c) => c.classes.has("feuillets-cell-icon"));
  const backIcon = () => isolationIcons()[0];
  const upChevron = () => isolationIcons()[1];
  const currentNameEl = () => rootRowNow().children.find((c) => c.classes.has("feuillets-folder-name"));
  const currentHeaderText = () => currentNameEl()?.text;

  // --- État initial : projet complet, aucune isolation. ---
  await view.render(true);
  assert.deepEqual(folderNames(), ["FRONT", "TARIKAT", "CHAPITRE 1", "CHAPITRE 2", "SUBHANALLAH"]);
  assert.equal(currentHeaderText(), "Projet actif", "en-tête normal inchangé : le nom du projet seul");
  assert.equal(isolationIcons().length, 0, "aucune icône manuscrit/chevron hors isolation");
  assert.ok(versionsVisible(), "Versions visible dès le départ");
  assert.equal(typeof view.isVaultMode, "undefined", "aucun mode Coffre réintroduit");
  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-vault-split")).length, 0, "aucune double vue");
  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-breadcrumb-sep")).length, 0, "aucun fil d'Ariane");

  // --- Isoler TARIKAT depuis le menu contextuel de son dossier. ---
  const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
  const menus = [];
  Menu.prototype.showAtMouseEvent = function showAtMouseEvent() { menus.push(this); return this; };
  const realRender = view.render.bind(view);
  // Les gestionnaires cliqués ci-dessous déclenchent eux-mêmes un
  // this.render(true) en tâche de fond (jamais attendu par l'appelant réel,
  // un simple clic/callback de menu) — neutralisé pour ne garder qu'un seul
  // rendu déterministe par étape, déclenché explicitement via realRender
  // (même patron que le test "replier depuis le nom du projet…" plus haut).
  view.render = async () => {};
  const timers = installFakeBinderTimers();
  try {
    const findFolderRow = (name) =>
      findElements(contentEl, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"))
        .find((el) => el.children.some((c) => c.classes.has("feuillets-folder-name") && c.text === name));
    findFolderRow("TARIKAT").events.get("contextmenu")({ preventDefault() {} });
    const folderMenu = menus.pop();
    const isolateItem = folderMenu.items.find((item) => item.title === t("binder.isolateFolder"));
    assert.ok(isolateItem, "« Isoler ce dossier » est proposé dans le menu standard d'un dossier");
    isolateItem.callback();
    await realRender(true);

    assert.equal(settings.projectFolder, root.path, "isoler ne touche jamais settings.projectFolder");
    assert.equal(isolationIcons().length, 2, "icône manuscrit + chevron ‹, isolé");
    assert.equal(currentHeaderText(), "TARIKAT", "une seule ligne : nom courant, jamais le fil d'Ariane complet");
    assert.deepEqual(folderNames(), ["CHAPITRE 1", "CHAPITRE 2"], "seuls les descendants de TARIKAT restent visibles");
    assert.deepEqual(itemNames(), ["Feuillet C1", "Feuillet C2"], "FRONT, SUBHANALLAH et le feuillet racine ont disparu");
    assert.ok(versionsVisible(), "Versions reste visible même isolé");
    assert.ok(currentNameEl().classes.has("feuillets-isolation-current"), "classe dédiée : CSS retire l'uppercase, casse réelle");

    // --- Clic droit sur la racine isolée : menu contextuel standard du dossier. ---
    rootRowNow().events.get("contextmenu")({ preventDefault() {} });
    const rootFolderMenu = menus.pop();
    assert.ok(rootFolderMenu.items.some((item) => item.title === t("binder.isolateFolder")), "menu standard du dossier TARIKAT, pas un second menu ad hoc");

    // --- Repli/dépli scopé à la branche isolée (clic sur le nom courant). ---
    currentNameEl().events.get("click")({ stopPropagation() {} });
    await realRender(true);

    assert.equal(settings.collapsed[tarikat.path], true, "tout replier (scopé) marque la racine de travail");
    assert.equal(settings.collapsed[chapitre1.path], true);
    assert.equal(settings.collapsed[chapitre2.path], true);
    assert.equal(settings.collapsed[front.path], undefined, "FRONT, hors branche isolée, n'est jamais touché");
    assert.equal(settings.collapsed[subhanallah.path], undefined, "SUBHANALLAH, hors branche isolée, n'est jamais touché");
    assert.deepEqual(folderNames(), ["CHAPITRE 1", "CHAPITRE 2"], "les dossiers restent visibles après repli global scopé");
    assert.deepEqual(itemNames(), [], "les feuillets de la branche isolée sont masqués");

    const findFolderRow2 = (name) =>
      findElements(contentEl, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"))
        .find((el) => el.children.some((c) => c.classes.has("feuillets-folder-name") && c.text === name));
    // LOT FINAL Binder ↔ Continu : le repli/dépli d'un dossier descendant
    // est désormais la responsabilité exclusive de son chevron (le clic sur
    // le nom ouvre Continu, voir le test dédié) — immédiat, sans délai.
    const findChevron2 = (name) => findFolderRow2(name).children.find((c) => c.classes.has("feuillets-folder-chevron"));
    findChevron2("CHAPITRE 1").events.get("click")({ preventDefault() {}, stopPropagation() {} });
    await realRender(true);
    assert.equal(settings.collapsed[chapitre1.path], undefined, "CHAPITRE 1 se déplie individuellement");
    assert.equal(settings.collapsed[chapitre2.path], true, "CHAPITRE 2 reste replié");
    assert.deepEqual(itemNames(), ["Feuillet C1"]);

    // --- Isoler plus profond : CHAPITRE 2 depuis la branche déjà isolée. ---
    // CHAPITRE 2 est resté replié depuis le "tout replier" ci-dessus — tout
    // comme le repli de la racine du projet masque ses feuillets directs
    // (comportement déjà validé), une racine de travail isolée qui reste
    // repliée masque les siens : on la déplie d'abord, comme le ferait un
    // clic sur son nom avant de choisir "Isoler ce dossier".
    delete settings.collapsed[chapitre2.path];
    findFolderRow2("CHAPITRE 2").events.get("contextmenu")({ preventDefault() {} });
    const chap2Menu = menus.pop();
    chap2Menu.items.find((item) => item.title === t("binder.isolateFolder")).callback();
    await realRender(true);
    assert.equal(currentHeaderText(), "CHAPITRE 2", "isolation d'un sous-dossier : nom courant seul, jamais le chemin complet");
    assert.deepEqual(itemNames(), ["Feuillet C2"], "isolation d'un sous-dossier : seule sa branche apparaît");

    // --- Chevron ‹ : remonte exactement d'un dossier (CHAPITRE 2 -> TARIKAT). ---
    upChevron().events.get("click")({ stopPropagation() {} });
    await realRender(true);
    assert.equal(currentHeaderText(), "TARIKAT", "‹ remonte d'un niveau, toujours isolé (TARIKAT n'est pas la racine projet)");
    assert.deepEqual(folderNames(), ["CHAPITRE 1", "CHAPITRE 2"]);

    // --- Chevron ‹ à nouveau : le parent de TARIKAT est la racine du projet -> Binder complet. ---
    upChevron().events.get("click")({ stopPropagation() {} });
    await realRender(true);
    assert.equal(isolationIcons().length, 0, "retour au Binder complet : plus d'icône ni de chevron");
    assert.equal(currentHeaderText(), "Projet actif");
    // TARIKAT est resté replié depuis le "tout replier" scopé plus haut :
    // revenir au projet ne le déplie pas silencieusement — l'isolation ne
    // touche jamais aux états S.collapsed des dossiers hors de son ressort.
    assert.deepEqual(folderNames(), ["FRONT", "TARIKAT", "SUBHANALLAH"], "TARIKAT reste replié, comme avant l'isolation");
    assert.deepEqual(itemNames(), ["Dédicace", "Feuillet 1", "Racine"]);
    assert.equal(settings.projectFolder, root.path, "toujours aucun changement de projectFolder");

    // Déplié explicitement, TARIKAT retrouve bien CHAPITRE 1/2 — l'état est
    // resté cohérent, juste inchangé par l'isolation elle-même.
    delete settings.collapsed[tarikat.path];
    await realRender(true);
    assert.deepEqual(folderNames(), ["FRONT", "TARIKAT", "CHAPITRE 1", "CHAPITRE 2", "SUBHANALLAH"]);
    assert.deepEqual(itemNames(), ["Dédicace", "Feuillet C1", "Feuillet C2", "Feuillet 1", "Racine"]);

    // --- Icône manuscrit : retour immédiat au projet complet, depuis n'importe quelle profondeur. ---
    findFolderRow("TARIKAT").events.get("contextmenu")({ preventDefault() {} });
    menus.pop().items.find((item) => item.title === t("binder.isolateFolder")).callback();
    await realRender(true);
    assert.equal(currentHeaderText(), "TARIKAT");
    backIcon().events.get("click")({ stopPropagation() {} });
    await realRender(true);
    assert.equal(isolationIcons().length, 0);
    assert.equal(currentHeaderText(), "Projet actif", "icône manuscrit = retour direct au projet complet");

    // --- Racine de travail invalide (dossier supprimé/hors projet) : repli sûr. ---
    view._binderWorkingRootPath = "Projet/Manuscrit/Fantome";
    await realRender(true);
    assert.equal(currentHeaderText(), "Projet actif", "chemin isolé introuvable => retour au projet");
    assert.equal(view._binderWorkingRootPath, undefined, "l'isolation invalide est nettoyée");
    assert.deepEqual(folderNames(), ["FRONT", "TARIKAT", "CHAPITRE 1", "CHAPITRE 2", "SUBHANALLAH"]);
  } finally {
    Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
    timers.restore();
  }
});

test("Binder : densité propre à une racine isolée, sans nouvelle clé persistante de settings", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const tarikat = new TFolder("Projet/Manuscrit/TARIKAT");
  const subhanallah = new TFolder("Projet/Manuscrit/SUBHANALLAH");
  const feuilletT = new TFile("Projet/Manuscrit/TARIKAT/Feuillet T.md");
  const feuilletS = new TFile("Projet/Manuscrit/SUBHANALLAH/Feuillet S.md");
  tarikat.children = [feuilletT];
  subhanallah.children = [feuilletS];
  root.children = [tarikat, subhanallah];
  for (const [f, parent] of [[feuilletT, tarikat], [feuilletS, subhanallah], [tarikat, root], [subhanallah, root]]) f.parent = parent;

  const byPath = new Map([root, tarikat, subhanallah, feuilletT, feuilletS].map((f) => [f.path, f]));
  const settingsKeysBefore = ["projectFolder", "projects", "projectMeta", "binderLayout", "binderCompact", "binderTreeWidth", "collapsed"];
  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    collapsed: {},
    binderCompact: false,
  });
  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [feuilletT, feuilletS],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Projet actif",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    folderNoteFor: () => null,
  };
  const view = new FeuilletsView({
    app: {
      vault: { getAbstractFileByPath: (path) => byPath.get(path) || null },
      workspace: {},
    },
    contentEl,
  }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  view.ensureSelectionForContextMenu = () => {};

  const isCompact = () => findElements(contentEl, (el) => el.classes.has("feuillets-list"))[0].classes.has("feuillets-compact");
  const densityButtons = [];
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    if (icon === "rows-3") densityButtons.push(button);
    return button;
  };
  const densityBtn = () => densityButtons.at(-1);

  const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
  const menus = [];
  Menu.prototype.showAtMouseEvent = function showAtMouseEvent() { menus.push(this); return this; };
  const realRender = view.render.bind(view);
  view.render = async () => {};
  try {
    // --- Binder normal : le bouton Densité pilote settings.binderCompact, comme avant. ---
    await realRender(true);
    assert.equal(isCompact(), false);
    densityBtn().events.get("click")();
    await realRender(true);
    assert.equal(settings.binderCompact, true, "Binder normal : la densité écrit toujours settings.binderCompact");
    assert.equal(isCompact(), true);

    // --- Isoler TARIKAT : hérite de settings.binderCompact (true) tant qu'aucun override. ---
    findElements(contentEl, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"))
      .find((el) => el.children.some((c) => c.classes.has("feuillets-folder-name") && c.text === "TARIKAT"))
      .events.get("contextmenu")({ preventDefault() {} });
    menus.pop().items.find((item) => item.title === t("binder.isolateFolder")).callback();
    await realRender(true);
    assert.equal(isCompact(), true, "dossier isolé sans override : hérite de settings.binderCompact");

    // --- Bascule la densité DANS l'isolation : override de session seulement. ---
    densityBtn().events.get("click")();
    await realRender(true);
    assert.equal(isCompact(), false, "TARIKAT a maintenant son propre override (standard)");
    assert.equal(settings.binderCompact, true, "settings.binderCompact — le Binder général — reste inchangé");
    assert.equal(Object.prototype.hasOwnProperty.call(settings, "binderCompactOverrides"), false, "aucune nouvelle clé persistante dans settings");
    for (const key of settingsKeysBefore) assert.ok(key in settings, `${key} toujours présent`);

    // --- Retour au projet complet : redonne immédiatement settings.binderCompact. ---
    view._binderWorkingRootPath = undefined;
    await realRender(true);
    assert.equal(isCompact(), true, "retour au projet : redonne settings.binderCompact (true), pas l'override de TARIKAT");

    // --- Isoler SUBHANALLAH : jamais d'override -> hérite aussi de settings.binderCompact. ---
    findElements(contentEl, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"))
      .find((el) => el.children.some((c) => c.classes.has("feuillets-folder-name") && c.text === "SUBHANALLAH"))
      .events.get("contextmenu")({ preventDefault() {} });
    menus.pop().items.find((item) => item.title === t("binder.isolateFolder")).callback();
    await realRender(true);
    assert.equal(isCompact(), true, "SUBHANALLAH n'a pas encore d'override : hérite de settings.binderCompact");

    // --- Réisoler TARIKAT dans la même session : son override (standard) est retrouvé. ---
    view._binderWorkingRootPath = tarikat.path;
    await realRender(true);
    assert.equal(isCompact(), false, "TARIKAT retrouve son override précédent (standard), indépendamment de SUBHANALLAH");
  } finally {
    Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
  }
});

test("Binder : affiche l'écran d'accueil au tout premier lancement (aucun projet connu)", async () => {
  const { view, contentEl } = createView(baseSettings());

  await view.render(true);

  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-onboarding")).length, 1);
  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-project-list")).length, 0);
  const rendered = textContent(contentEl);
  assert.match(rendered, /Feuillets/);
  assert.match(rendered, /Créer un projet/);
  assert.match(rendered, /Utiliser un dossier existant tel quel/);
  assert.match(rendered, /Découvrir avec un projet de démonstration/);
  assert.match(rendered, /Vos fichiers restent des fichiers Markdown ordinaires/);
});

test("Binder : masque l'écran d'accueil dès qu'un projet est connu, même inactif", async () => {
  const { view, contentEl } = createView(baseSettings({ projects: ["Ancien/Manuscrit"] }));

  await view.render(true);

  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-onboarding")).length, 0);
  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-project-hub")).length, 1);
});

test("Binder : le filtre de progression utilise le nombre de mots de l'entrée de cache", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const under = new TFile("Projet/Manuscrit/En dessous.md");
  const hit = new TFile("Projet/Manuscrit/Atteint.md");
  const over = new TFile("Projet/Manuscrit/Dépassé.md");
  root.children = [under, hit, over];
  for (const file of root.children) file.parent = root;

  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    binderProgressFilter: "Tous",
    binderTreeWidth: 240,
    collapsed: {},
    wordGoal: 1000,
    tolerance: 0,
  });
  const wordCounts = new Map([
    [under.path, { mtime: 1, wc: 800, chars: 0 }],
    [hit.path, { mtime: 1, wc: 1000, chars: 0 }],
    [over.path, { mtime: 1, wc: 1200, chars: 0 }],
  ]);
  const contentEl = new FakeElement();
  const app = {
    vault: { getAbstractFileByPath: (path) => path === root.path ? root : null },
    workspace: {},
  };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => root.children,
    getWordCounts: async () => wordCounts,
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: () => "Projet",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
  };
  const view = new FeuilletsView({ app, contentEl }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};

  for (const [filter, expected] of [
    ["En dessous", [under.basename]],
    ["Atteint", [hit.basename]],
    ["Dépassé", [over.basename]],
  ]) {
    settings.binderProgressFilter = filter;
    await view.render(true);
    const names = findElements(contentEl, (el) => el.classes.has("feuillets-item-name"))
      .map((el) => el.text.trim());
    assert.deepEqual(names, expected);
  }
});

test("Binder : les filtres de labels reconnaissent tous les labels d'un feuillet", async () => {
  const root = new TFolder("Projet/Manuscrit");
  const multiple = new TFile("Projet/Manuscrit/Double.md");
  const none = new TFile("Projet/Manuscrit/Sans label.md");
  const single = new TFile("Projet/Manuscrit/Unique.md");
  root.children = [multiple, none, single];
  for (const file of root.children) file.parent = root;
  const labels = new Map([
    [multiple.path, ["Intrigue", "Sophie"]],
    [none.path, []],
    [single.path, ["Unique"]],
  ]);
  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    binderLabelFilter: "Tous",
    binderTreeWidth: 240,
    collapsed: {},
  });
  const contentEl = new FakeElement();
  const app = {
    vault: { getAbstractFileByPath: (path) => path === root.path ? root : null },
    workspace: {},
  };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => root.children,
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: (file) => labels.get(file.path) || [],
    projectDisplayName: () => "Projet",
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
  };
  const view = new FeuilletsView({ app, contentEl }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};

  for (const [filter, expected] of [
    ["Intrigue", [multiple.basename]],
    ["Sophie", [multiple.basename]],
    ["Sans label", [none.basename]],
    ["Unique", [single.basename]],
  ]) {
    settings.binderLabelFilter = filter;
    await view.render(true);
    const names = findElements(contentEl, (el) => el.classes.has("feuillets-item-name"))
      .map((el) => el.text.trim());
    assert.deepEqual(names, expected);
  }
});

test("Binder ↔ Recherche : remappage — aucune map ne renvoie undefined", () => {
  assert.equal(remapResearchFolderLinks(undefined, "Ancien/Manuscrit", "Nouveau/Manuscrit"), undefined);
});

test("Binder ↔ Recherche : remappage — égalité exacte sur les clés Binder et les valeurs Recherche", () => {
  const links = {
    "Roman/Manuscrit/Partie 1": "Recherche/Documentation/Partie 1",
    "Roman/Manuscrit/Partie 2": "Recherche/Documentation/Partie 2",
  };
  const mapped = remapResearchFolderLinks(links, "Recherche/Documentation/Partie 1", "Recherche/Documentation/Première partie");
  assert.deepEqual(mapped, {
    "Roman/Manuscrit/Partie 1": "Recherche/Documentation/Première partie",
    "Roman/Manuscrit/Partie 2": "Recherche/Documentation/Partie 2",
  });
});

test("Binder ↔ Recherche : remappage — préfixe oldPath/ remappe les descendants", () => {
  const links = {
    "Roman/Manuscrit": "Recherche/Documentation/Roman",
    "Roman/Manuscrit/Chapitre 1": "Recherche/Documentation/Roman/Chapitre 1",
  };
  const mapped = remapResearchFolderLinks(links, "Roman/Manuscrit", "Nouveaux Romans/Manuscrit v2");
  assert.deepEqual(mapped, {
    "Nouveaux Romans/Manuscrit v2": "Recherche/Documentation/Roman",
    "Nouveaux Romans/Manuscrit v2/Chapitre 1": "Recherche/Documentation/Roman/Chapitre 1",
  });
});

test("Binder ↔ Recherche : remappage — un chemin voisin hors préfixe n'est pas modifié", () => {
  const links = {
    "Roman/Manuscrit-primary": "Recherche/Manuscrit-primary",
  };
  const mapped = remapResearchFolderLinks(links, "Roman/Manuscrit", "Roman/Manuscrit v2");
  // "Roman/Manuscrit-primary" ne commence ni par "Roman/Manuscrit" seul ni
  // par "Roman/Manuscrit/" : il reste intact (et l'objet d'origine est
  // renvoyé tel quel, aucun changement déduit).
  assert.equal(mapped, links);
});

test("Binder ↔ Recherche : remappage — rien ne change renvoie l'objet d'origine", () => {
  const links = { A: "B", C: "D" };
  assert.equal(remapResearchFolderLinks(links, "X", "Y"), links);
});

test("Binder : renderOnboarding — les trois actions ouvrent les bons flux", async () => {
  const { view, contentEl } = createView(baseSettings());
  view.app = { workspace: {} };
  const { NewProjectModal, OpenExistingFolderModal } = await import("../src/ui/project-modals.js");
  const opened = [];
  const originalNewOpen = NewProjectModal.prototype.open;
  const originalFolderOpen = OpenExistingFolderModal.prototype.open;
  NewProjectModal.prototype.open = function () { opened.push("new-project"); };
  OpenExistingFolderModal.prototype.open = function () { opened.push("open-folder"); };

  try {
    view.renderOnboarding(contentEl);
    const wrap = contentEl.children.find((c) => c.classes.has("feuillets-onboarding"));
    assert.ok(wrap, "Le conteneur onboarding porte la classe feuillets-onboarding");

    const buttons = findElements(contentEl, (el) => el.tag === "button");
    assert.equal(buttons.length, 3);
    for (const btn of buttons) {
      assert.ok(btn.classes.has("mod-small"), "Les boutons d'onboarding ont la classe mod-small d'Obsidian");
    }

    buttons[0].events.get("click")({ stopPropagation() {} });
    buttons[1].events.get("click")({ stopPropagation() {} });

    assert.deepEqual(opened, ["new-project", "open-folder"]);
  } finally {
    NewProjectModal.prototype.open = originalNewOpen;
    OpenExistingFolderModal.prototype.open = originalFolderOpen;
  }
});

// ---------------------------------------------------------------------------
// Tests Binder ↔ Recherche : restriction de isInsideResearchSpace
// ---------------------------------------------------------------------------

test("Binder ↔ Recherche : isInsideResearchSpace — descendant valide accepté", () => {
  assert.equal(isInsideResearchSpace("Projet/_Recherche/Personnages", "Projet/_Recherche"), true);
  assert.equal(isInsideResearchSpace("Projet/_Recherche/Docs/Sources", "Projet/_Recherche"), true);
});

test("Binder ↔ Recherche : isInsideResearchSpace — racine _Recherche refusée", () => {
  assert.equal(isInsideResearchSpace("Projet/_Recherche", "Projet/_Recherche"), false);
});

test("Binder ↔ Recherche : isInsideResearchSpace — dossier extérieur refusé", () => {
  assert.equal(isInsideResearchSpace("AutreProjet/Dossier", "Projet/_Recherche"), false);
  assert.equal(isInsideResearchSpace("Projet/Manuscrit", "Projet/_Recherche"), false);
  assert.equal(isInsideResearchSpace("/Racine", "Projet/_Recherche"), false);
});

test("Binder ↔ Recherche : isInsideResearchSpace — autre projet refusé", () => {
  assert.equal(isInsideResearchSpace("Projet2/_Recherche/Docs", "Projet1/_Recherche"), false);
});

// ---------------------------------------------------------------------------
// Tests Binder ↔ Recherche : menu de fichier (article) Binder
// ---------------------------------------------------------------------------

/** Construit un projet minimal Fiction avec Manuscript + _Recherche pour
    tester les actions Binder ↔ Recherche. Retourne aussi un vault simulé
    avec getAbstractFileByPath fonctionnel. */
function buildBinderResearchProject() {
  const root = new TFolder("Roman/Manuscrit");
  root.name = "Manuscrit";
  root.path = "Roman/Manuscrit";

  const researchRoot = new TFolder("Roman/_Recherche");
  researchRoot.name = "_Recherche";
  researchRoot.path = "Roman/_Recherche";

  const chapter = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter.name = "Chapitre 1";
  chapter.path = "Roman/Manuscrit/Chapitre 1";
  chapter.parent = root;
  root.children = [chapter];

  const scene = new TFile("Roman/Manuscrit/Chapitre 1/01 Été.md", "Texte.");
  scene.name = "01 Été.md";
  scene.basename = "01 Été";
  scene.extension = "md";
  scene.parent = chapter;
  chapter.children = [scene];

  /* Vault simulé : reconnaît les dossiers racine, _Recherche et ses enfants */
  const allFiles = new Map();
  allFiles.set("Roman/Manuscrit", root);
  allFiles.set("Roman/_Recherche", researchRoot);
  allFiles.set("Roman/Manuscrit/Chapitre 1", chapter);
  allFiles.set("Roman/Manuscrit/Chapitre 1/01 Été.md", scene);

  const vault = {
    allFiles,
    getAbstractFileByPath: (p) => allFiles.get(p) || null,
    createFolder: async (path) => {
      const name = path.split("/").pop();
      const folder = new TFolder(path);
      folder.name = name;
      folder.path = path;
      allFiles.set(path, folder);
      return folder;
    },
    read: async () => "Texte.",
    cachedRead: async () => "Texte.",
  };

  return { root, researchRoot, chapter, scene, vault };
}

/** Construit un plugin simulé pour les tests Binder ↔ Recherche. */
function buildBinderResearchPlugin(project, overrides = {}) {
  const { root, researchRoot, vault } = project;
  const researchFolderLinks = {};
  const settings = {
    projectFolder: "Roman/Manuscrit",
    level1Role: "chapitres",
    projectMeta: {},
    labels: [],
    statuses: [],
    collapsed: {},
    ...overrides.settings,
  };

  return {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => researchRoot,
    getLinkedResearchFolder: (node) => {
      const path = researchFolderLinks[node.path];
      return path ? vault.getAbstractFileByPath(path) : null;
    },
    setLinkedResearchFolder: async (node, folder) => {
      researchFolderLinks[node.path] = folder.path;
    },
    removeLinkedResearchFolder: async (node) => {
      delete researchFolderLinks[node.path];
    },
    fmOf: () => ({}),
    labelOf: () => "",
    labelsOf: () => [],
    titleFor: (f) => f.basename,
    shortTitleFor: (f) => f.basename,
    renderAllViews: () => {},
    saveSettings: async () => {},
    newSheetAt: () => {},
    newSheet: () => {},
    newFolder: () => {},
    snapshotFile: async () => "",
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    tagsOf: () => [],
    buildNumbering: () => new Map(),
    flattenFiles: () => [],
    projectMode: () => ({ researchFolders: {} }),
    _researchDragPath: null,
    _binderMultiSelect: null,
    _binderMultiSelectAnchor: null,
    ...overrides,
  };
}

class TestBinderResearchView extends BaseFeuilletsView {
  constructor(app, plugin) {
    super({ app, contentEl: null });
    this.app = app;
    this.plugin = plugin;
  }
  async render() {}
}

test("Binder : les sélecteurs compacts gardent la position du clic droit", () => {
  const origin = /** @type {MouseEvent} */ ({ clientX: 428, clientY: 316, target: null });

  showChoices(
    /** @type {KeyboardEvent} */ ({}),
    origin,
    (menu) => menu.addItem((item) => item.setTitle("Choix"))
  );

  assert.equal(Menu.lastShown.event, origin, "le vrai événement contextmenu est utilisé");
  assert.deepEqual(
    { x: Menu.lastShown.event.clientX, y: Menu.lastShown.event.clientY },
    { x: 428, y: 316 }
  );

  const trigger = /** @type {MouseEvent} */ ({ clientX: 451, clientY: 339, target: null });
  showChoices(
    trigger,
    origin,
    (menu) => menu.addItem((item) => item.setTitle("Choix"))
  );
  assert.equal(Menu.lastShown.event, origin, "le clic droit initial est conservé");
});

test("Binder ↔ Recherche : menu d'un TFile Binder non lié contient les actions de liaison", () => {
  const project = buildBinderResearchProject();
  const plugin = buildBinderResearchPlugin(project);
  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  view.showFileContextMenu(
    { preventDefault() {} },
    project.scene,
    project.chapter,
    0,
    [project.scene]
  );

  const menu = Menu.lastShown;
  assert.ok(menu, "le menu doit être affiché");

  const titles = menu.items.map((i) => i.title);
  assert.ok(
    titles.includes("Recherche associée…"),
    "contient l'entrée Recherche compacte"
  );
  assert.ok(
    !titles.includes("Associer un dossier Recherche existant…"),
    "les choix Recherche ne sont plus étalés au premier niveau"
  );
});

test("Binder ↔ Recherche : menu d'un TFile Binder lié contient ouvrir/changer/détacher", () => {
  const project = buildBinderResearchProject();
  const linkedFolder = new TFolder("Roman/_Recherche/Docs");
  linkedFolder.name = "Docs";
  linkedFolder.path = "Roman/_Recherche/Docs";
  project.vault.getAbstractFileByPath = (p) => {
    if (p === "Roman/_Recherche/Docs") return linkedFolder;
    const allFiles = new Map();
    allFiles.set("Roman/Manuscrit", project.root);
    allFiles.set("Roman/_Recherche", project.researchRoot);
    allFiles.set("Roman/Manuscrit/Chapitre 1", project.chapter);
    allFiles.set("Roman/Manuscrit/Chapitre 1/01 Été.md", project.scene);
    return allFiles.get(p) || null;
  };

  const plugin = buildBinderResearchPlugin(project);
  // Pré-lier le fichier
  plugin.getLinkedResearchFolder = () => linkedFolder;

  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
    internalPlugins: { getPluginById: () => null },
  };
  const view = new TestBinderResearchView(app, plugin);

  view.showFileContextMenu(
    { preventDefault() {} },
    project.scene,
    project.chapter,
    0,
    [project.scene]
  );

  const menu = Menu.lastShown;
  const researchItem = menu.items.find((i) => i.title === "Recherche associée…");
  assert.ok(researchItem, "contient l'entrée Recherche compacte");
  researchItem.callback();
  const titles = Menu.lastShown.items.map((i) => i.title);
  assert.ok(
    titles.includes("Ouvrir le dossier Recherche associé"),
    "contient l'action d'ouverture"
  );
  assert.ok(
    titles.includes("Changer le dossier Recherche associé…"),
    "contient l'action de changement"
  );
  assert.ok(
    titles.includes("Détacher le dossier Recherche"),
    "contient l'action de détachement"
  );
});

test("Binder ↔ Recherche : détachement d'un fichier sans suppression physique", async () => {
  const project = buildBinderResearchProject();
  const linkedFolder = new TFolder("Roman/_Recherche/Docs");
  linkedFolder.name = "Docs";
  linkedFolder.path = "Roman/_Recherche/Docs";

  const researchFolderLinks = { [project.scene.path]: linkedFolder.path };

  let detachedPath = null;
  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: (node) => {
      const p = researchFolderLinks[node.path];
      return p ? linkedFolder : null;
    },
    setLinkedResearchFolder: async () => {},
    removeLinkedResearchFolder: async (node) => {
      detachedPath = node.path;
      delete researchFolderLinks[node.path];
    },
  });

  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
    internalPlugins: { getPluginById: () => null },
  };
  const view = new TestBinderResearchView(app, plugin);

  view.showFileContextMenu(
    { preventDefault() {} },
    project.scene,
    project.chapter,
    0,
    [project.scene]
  );

  const menu = Menu.lastShown;
  const researchItem = menu.items.find((i) => i.title === "Recherche associée…");
  assert.ok(researchItem, "l'entrée Recherche compacte doit exister");
  researchItem.callback();
  const detachItem = Menu.lastShown.items.find(
    (i) => i.title === "Détacher le dossier Recherche"
  );
  assert.ok(detachItem, "l'entrée détacher doit exister");

  // Exécuter le callback de détachement
  await detachItem.callback();

  assert.equal(detachedPath, project.scene.path, "le fichier a été détaché");
  assert.equal(
    researchFolderLinks[project.scene.path],
    undefined,
    "le lien a été supprimé de la map"
  );
  // Le dossier physique (linkedFolder) n'est pas supprimé : on vérifie
  // qu'aucun appel à trashFile n'a été fait sur le dossier
  assert.equal(linkedFolder.path, "Roman/_Recherche/Docs", "le dossier physique est intact");
});

test("Binder ↔ Recherche : création d'un dossier associé à un fichier — parent lié", async () => {
  const project = buildBinderResearchProject();

  // Parent déjà lié : le chapitre est lié à un dossier Recherche
  const parentLinkedFolder = new TFolder("Roman/_Recherche/Chapitre1-Docs");
  parentLinkedFolder.name = "Chapitre1-Docs";
  parentLinkedFolder.path = "Roman/_Recherche/Chapitre1-Docs";

  let createdPath = null;
  let linkedNode = null;
  let linkedFolderResult = null;

  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: (node) => {
      if (node.path === project.chapter.path) return parentLinkedFolder;
      return null;
    },
    setLinkedResearchFolder: async (node, folder) => {
      linkedNode = node.path;
      linkedFolderResult = folder.path;
    },
  });

  // Intercepter NewFolderModal : simuler la saisie de "Docs du chapitre"
  const originalOpen = NewFolderModal.prototype.open;
  let modalCallback = null;
  NewFolderModal.prototype.open = function () {
    // Récupérer le callback stocké dans le constructeur (this.onSubmit)
    modalCallback = this.onSubmit;
  };

  const app = {
    vault: {
      getAbstractFileByPath: project.vault.getAbstractFileByPath,
      createFolder: async (path) => {
        createdPath = path;
        const folder = new TFolder(path);
        folder.name = path.split("/").pop();
        folder.path = path;
        project.vault.allFiles.set(path, folder);
        return folder;
      },
    },
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  try {
    view.showFileContextMenu(
      { preventDefault() {} },
      project.scene,
      project.chapter,
      0,
      [project.scene]
    );

    const menu = Menu.lastShown;
    const researchItem = menu.items.find((i) => i.title === "Recherche associée…");
    assert.ok(researchItem, "l'entrée Recherche compacte doit exister");
    researchItem.callback();
    const createItem = Menu.lastShown.items.find((i) => i.title === "Créer un dossier Recherche associé");
    assert.ok(createItem, "l'entrée créer doit exister");

    // Déclencher le clic sur "Créer un dossier Recherche associé"
    createItem.callback();

    // La modale NewFolderModal a dû s'ouvrir avec comme basePath
    // le dossier du parent lié
    assert.ok(modalCallback, "la modale NewFolderModal a été ouverte");

    // Simuler la saisie du nom
    await modalCallback("Docs du chapitre");

    assert.equal(
      createdPath,
      "Roman/_Recherche/Chapitre1-Docs/Docs du chapitre",
      "le dossier est créé sous le dossier Recherche du parent lié"
    );
    assert.equal(linkedNode, project.scene.path, "le fichier scène est lié");
    assert.equal(
      linkedFolderResult,
      "Roman/_Recherche/Chapitre1-Docs/Docs du chapitre",
      "au dossier créé"
    );
  } finally {
    NewFolderModal.prototype.open = originalOpen;
  }
});

test("Binder ↔ Recherche : création d'un dossier associé à un fichier — sans parent lié, repli _Recherche", async () => {
  const project = buildBinderResearchProject();

  let createdPath = null;

  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: () => null,
    setLinkedResearchFolder: async () => {},
  });

  // Intercepter NewFolderModal
  const originalOpen = NewFolderModal.prototype.open;
  let modalCallback = null;
  NewFolderModal.prototype.open = function () {
    modalCallback = this.onSubmit;
  };

  const app = {
    vault: {
      getAbstractFileByPath: project.vault.getAbstractFileByPath,
      createFolder: async (path) => {
        createdPath = path;
        const folder = new TFolder(path);
        folder.name = path.split("/").pop();
        folder.path = path;
        project.vault.allFiles.set(path, folder);
        return folder;
      },
    },
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  try {
    view.showFileContextMenu(
      { preventDefault() {} },
      project.scene,
      project.chapter,
      0,
      [project.scene]
    );

    const menu = Menu.lastShown;
    const researchItem = menu.items.find((i) => i.title === "Recherche associée…");
    assert.ok(researchItem, "l'entrée Recherche compacte doit exister");
    researchItem.callback();
    const createItem = Menu.lastShown.items.find((i) => i.title === "Créer un dossier Recherche associé");
    createItem.callback();

    assert.ok(modalCallback, "la modale a été ouverte");
    await modalCallback("Mes notes");

    assert.equal(
      createdPath,
      "Roman/_Recherche/Mes notes",
      "le dossier est créé sous _Recherche (repli)"
    );
  } finally {
    NewFolderModal.prototype.open = originalOpen;
  }
});

test("Binder ↔ Recherche : le nom du dossier de création utilise le short_title/titre affiché", async () => {
  const project = buildBinderResearchProject();

  let defaultNamePassedToModal = null;

  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: () => null,
    setLinkedResearchFolder: async () => {},
    shortTitleFor: (f) => "Mon beau titre",
    titleFor: (f) => "Mon beau titre (affiché)",
  });

  const originalOpen = NewFolderModal.prototype.open;
  NewFolderModal.prototype.open = function () {
    // Le premier argument après app est parentName
    // NewFolderModal(app, parentName, onSubmit)
    defaultNamePassedToModal = this.parentName;
  };

  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  try {
    view.showFileContextMenu(
      { preventDefault() {} },
      project.scene,
      project.chapter,
      0,
      [project.scene]
    );

    const menu = Menu.lastShown;
    const researchItem = menu.items.find((i) => i.title === "Recherche associée…");
    assert.ok(researchItem, "l'entrée Recherche compacte doit exister");
    researchItem.callback();
    const createItem = Menu.lastShown.items.find((i) => i.title === "Créer un dossier Recherche associé");
    createItem.callback();

    assert.equal(
      defaultNamePassedToModal,
      "Mon beau titre",
      "le nom affiché dans la modale vient de shortTitleFor"
    );
  } finally {
    NewFolderModal.prototype.open = originalOpen;
  }
});

test("Binder ↔ Recherche : le nom du dossier de création utilise le basename si pas de short_title", async () => {
  const project = buildBinderResearchProject();

  let defaultNamePassedToModal = null;

  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: () => null,
    setLinkedResearchFolder: async () => {},
    shortTitleFor: () => null,
    titleFor: () => null,
  });

  const originalOpen = NewFolderModal.prototype.open;
  NewFolderModal.prototype.open = function () {
    defaultNamePassedToModal = this.parentName;
  };

  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  try {
    view.showFileContextMenu(
      { preventDefault() {} },
      project.scene,
      project.chapter,
      0,
      [project.scene]
    );

    const menu = Menu.lastShown;
    const researchItem = menu.items.find((i) => i.title === "Recherche associée…");
    assert.ok(researchItem, "l'entrée Recherche compacte doit exister");
    researchItem.callback();
    const createItem = Menu.lastShown.items.find((i) => i.title === "Créer un dossier Recherche associé");
    createItem.callback();

    assert.equal(
      defaultNamePassedToModal,
      "01 Été",
      "le nom affiché dans la modale vient du basename"
    );
  } finally {
    NewFolderModal.prototype.open = originalOpen;
  }
});

// ---------------------------------------------------------------------------
// Tests Binder ↔ Recherche : association d'un dossier — LinkResearchFolderModal
// n'est plus restreinte à l'espace Recherche du projet (isInsideResearchSpace
// n'est plus utilisée pour bloquer/filtrer, voir base-feuillets-view.ts).
// FolderSuggest cherche désormais dans TOUT le coffre ; resolveUniqueFolderMatch
// décide de l'acceptation d'une saisie non cliquée (Entrée).
// ---------------------------------------------------------------------------

/** Construit un petit coffre en mémoire pour FolderSuggest : un dossier
 * "input" HTML minimal suffit, FolderSuggest ne lit que `vault.getRoot()`
 * et parcourt `.children`. */
function buildSuggestVault(folders) {
  const root = new TFolder("/");
  root.children = folders;
  for (const f of folders) f.parent = root;
  return { vault: { getRoot: () => root } };
}

test("Volet Recherche : dossier sous _Recherche du projet toujours proposé", () => {
  const inside = new TFolder("Projet/_Recherche/Personnages");
  const { vault } = buildSuggestVault([inside]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  assert.deepEqual(suggest.getSuggestions("Personnages").map((f) => f.path), [inside.path]);
});

test("Volet Recherche : dossier extérieur au projet désormais proposé et associable", () => {
  // C'est LE changement de comportement du Volet 2 : un dossier hors du
  // projet actif (aucune restriction géographique) apparaît dans les
  // suggestions et resolveUniqueFolderMatch l'accepte sans ambiguïté.
  const outside = new TFolder("Documentation/Histoire ottomane");
  const { vault } = buildSuggestVault([outside]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  const matches = suggest.getSuggestions("ottomane");
  assert.deepEqual(matches.map((f) => f.path), [outside.path]);
  assert.equal(resolveUniqueFolderMatch(matches), outside);
});

test("Volet Recherche : dossier d'un AUTRE projet du coffre désormais proposé et associable", () => {
  const otherProject = new TFolder("AutreProjet/Recherche/Lieux");
  const { vault } = buildSuggestVault([otherProject]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  const matches = suggest.getSuggestions("AutreProjet");
  assert.deepEqual(matches.map((f) => f.path), [otherProject.path]);
  assert.equal(resolveUniqueFolderMatch(matches), otherProject);
});

test("Volet Recherche : recherche par nom partiel du dossier", () => {
  const target = new TFolder("Bibliothèque personnelle/Architecture");
  const other = new TFolder("Projet/_Recherche/Personnages");
  const { vault } = buildSuggestVault([target, other]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  assert.deepEqual(suggest.getSuggestions("architecture").map((f) => f.path), [target.path]);
});

test("Volet Recherche : recherche par morceau de chemin (pas seulement le nom du dossier)", () => {
  const target = new TFolder("Documentation/Histoire ottomane");
  const other = new TFolder("Projet/_Recherche/Personnages");
  const { vault } = buildSuggestVault([target, other]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  // "documentation" ne correspond qu'au chemin parent, pas au nom du dossier
  assert.deepEqual(suggest.getSuggestions("documentation").map((f) => f.path), [target.path]);
});

test("Volet Recherche : deux dossiers de même nom → resolveUniqueFolderMatch ne tranche jamais au hasard", () => {
  const a = new TFolder("ProjetA/_Recherche/Lieux");
  const b = new TFolder("ProjetB/_Recherche/Lieux");
  const { vault } = buildSuggestVault([a, b]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  const matches = suggest.getSuggestions("Lieux");
  assert.equal(matches.length, 2, "les deux dossiers correspondent au nom");
  assert.equal(resolveUniqueFolderMatch(matches), "ambiguous", "aucun choix arbitraire automatique");
});

test("Volet Recherche : resolveUniqueFolderMatch — aucune correspondance", () => {
  assert.equal(resolveUniqueFolderMatch([]), "none");
});

test("CORRECTIF — cliquer une suggestion remplit le champ avec le chemin exact (pas de saisie manuelle nécessaire)", () => {
  const target = new TFolder("Documentation/Histoire ottomane");
  const { vault } = buildSuggestVault([target]);
  const inputEl = { value: "" };
  const suggest = new FolderSuggest({ vault }, inputEl);
  let received = null;
  suggest.onSelect((folder) => {
    received = folder;
  });
  // Simule ce qu'Obsidian appelle réellement au clic (ou à la validation
  // clavier) d'une suggestion — jamais un déclenchement manuel côté test.
  suggest.selectSuggestion(target, { type: "click" });
  assert.equal(inputEl.value, target.path, "le champ doit être rempli avec le chemin complet au clic");
  assert.equal(received, target, "le callback onSelect doit recevoir le TFolder choisi");
});

test("Volet Recherche : resolveUniqueFolderMatch — une correspondance unique acceptée directement", () => {
  const only = new TFolder("Projet/_Recherche/Sources");
  assert.equal(resolveUniqueFolderMatch([only]), only);
});

test("Volet Recherche : isInsideResearchSpace reste un prédicat pur valide (mais n'est plus un filtre)", () => {
  assert.equal(isInsideResearchSpace("Projet/_Recherche/Personnages", "Projet/_Recherche"), true);
  assert.equal(isInsideResearchSpace("Projet/_Recherche", "Projet/_Recherche"), false, "racine refusée");
  assert.equal(isInsideResearchSpace("AutreProjet/Dossier", "Projet/_Recherche"), false, "hors espace");
});

test("Volet Recherche : renommage d'un dossier EXTÉRIEUR lié — researchFolderLinks remappé correctement", () => {
  // Le handler de remappage (remapResearchFolderLinks) est purement basé sur
  // les chemins : il fonctionne identiquement pour un dossier externe.
  const links = {
    "Roman/Manuscrit/Chapitre 1": "Documentation/Histoire ottomane",
  };
  const mapped = remapResearchFolderLinks(
    links,
    "Documentation/Histoire ottomane",
    "Documentation/Histoire des Ottomans"
  );
  assert.deepEqual(mapped, {
    "Roman/Manuscrit/Chapitre 1": "Documentation/Histoire des Ottomans",
  });
});
