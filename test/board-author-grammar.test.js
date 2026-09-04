import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TFile, TFolder, Menu } from "obsidian";
import { BoardView, NewLaneModal, parseCsvList, listsEqual } from "../src/views/board-view.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { fr } from "../src/i18n/fr.js";
import { en } from "../src/i18n/en.js";
import { BOARD_MODES } from "../src/constants.js";
import { PROJECT_MODES, projectBoardDefaults, resolveBoardOutlineColumns } from "../src/utils/project-modes.js";

/* Le Plan utilise window.setTimeout/window.clearTimeout (idiome Obsidian) :
   stubber le global pour les tests, comme les autres fichiers du dépôt. */
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle) };

/* LOT "binder isolé + simplification cartes/plan", §10-21/§28 : grammaire
 * finale de Cartes et Plan. Cartes = Titre · POV · Statut discret · Label ·
 * Synopsis/Résumé long OU Contenu — plus jamais de mots/anneau/tags sous
 * la carte. Plan = colonnes strictement allouées par mode (synopsis+POV en
 * Fiction, résumé long en Non-fiction/Libre), jamais Notes/Nom du
 * fichier/Progression/Compiler, même sur un vieux projet. */

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = options.value ?? "";
    this.text = options.text ?? "";
    this.type = options.type ?? "";
    this.attributes = { ...(options.attr ?? {}) };
    this.style = { _props: {}, setProperty(name, value) { this._props[name] = value; }, removeProperty() {} };
    this.parentNode = {}; // Simuler un parent node pour les tests
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    child.parentNode = this; // Définir le parent du child
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  getAttr(name) { return this.attributes[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  async trigger(type, event = {}) {
    const eventWithMethods = { stopPropagation: () => {}, preventDefault: () => {}, ...event };
    await this.events.get(type)?.(eventWithMethods);
  }
  focus() {}
  select() {}
  empty() { this.children = []; }
  remove() {
    /* Comme le vrai DOM : détache l'élément de son parent (les éléments créés
       via createEl ont parentNode = le parent réel). Le flag `removed` est
       conservé pour les tests qui s'y appuyaient. */
    this.removed = true;
    if (this.parentNode && Array.isArray(this.parentNode.children)) {
      const i = this.parentNode.children.indexOf(this);
      if (i !== -1) this.parentNode.children.splice(i, 1);
    }
  }
}

function findAll(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findAll(child, predicate));
  }
  return found;
}

function findFirst(element, predicate) {
  return findAll(element, predicate)[0];
}

/* ===================== CARTES (renderCard/renderFolderCard) ===================== */

function buildCardHarness({ fm = {}, cardContent = "extrait", statuses = [] } = {}) {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const parent = new TFolder("Projet/Manuscrit");
  file.parent = parent;
  const contentEl = new FakeElement();
  const app = {
    vault: { cachedRead: async () => "Corps du feuillet." },
    workspace: {},
  };
  const plugin = {
    settings: { statuses, excerptLength: 420 },
    fmOf: () => fm,
    roleOfFile: () => "scene",
    labelOf: () => "rouge",
    labelColor: () => "#c0392b",
    shortTitleFor: () => file.basename,
  };
  const view = new BoardView({ app, contentEl }, plugin);
  view.wcMap = new Map([[file.path, 672]]);
  view.filterActive = () => true; // court-circuite attachDragHandlers, hors périmètre ici
  view.currentCardContent = cardContent;
  return { view, file, parent, contentEl, plugin };
}

test("Cartes — grammaire finale d'une carte fichier (Fiction, synopsis)", () => {
  const { view, file, parent, contentEl } = buildCardHarness({
    fm: { pov: "Camille", status: "Brouillon", synopsis: "Résumé court." },
    cardContent: "synopsis",
  });

  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});

  // Titre présent.
  assert.ok(findFirst(contentEl, (el) => el.classes.has("feuillets-card-title")), "titre attendu");
  // POV présent (défini).
  const povEl = findFirst(contentEl, (el) => el.classes.has("feuillets-card-pov"));
  assert.ok(povEl, "POV attendu");
  assert.equal(povEl.text, "Camille");
  // Statut discret présent (défini).
  const statusEl = findFirst(contentEl, (el) => el.classes.has("feuillets-card-status"));
  assert.ok(statusEl, "statut attendu");
  assert.equal(statusEl.text, "Brouillon");
  // Label (liseré) conservé.
  const card = findFirst(contentEl, (el) => el.classes.has("feuillets-card"));
  assert.equal(card.style.borderLeft, "3px solid #c0392b");
  // Contenu : Fiction → synopsis.
  const excerptCell = findFirst(contentEl, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.ok(excerptCell, "cellule d'édition du synopsis attendue");
  assert.equal(excerptCell.text, "Résumé court.");

  // Aucun bruit : ni mots, ni anneau, ni tags.
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-card-wc")).length, 0);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-ring")).length, 0);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-tags")).length, 0);
});

test("Cartes — Non-fiction/Libre : le contenu sémantique est le résumé long", () => {
  const { view, file, parent, contentEl } = buildCardHarness({
    fm: { summary: "Résumé long du chapitre." },
    cardContent: "summary",
  });

  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});

  const cell = findFirst(contentEl, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.ok(cell);
  assert.equal(cell.text, "Résumé long du chapitre.");
});

test("Cartes — Contenu = extrait : bascule sur l'extrait du corps", () => {
  const { view, file, parent, contentEl } = buildCardHarness({ fm: {}, cardContent: "extrait" });

  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});

  const excerpt = findFirst(contentEl, (el) => el.classes.has("feuillets-card-excerpt"));
  assert.ok(excerpt, "extrait attendu");
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-flat-text-cell")).length, 0);
});

test("Cartes — POV/statut absents : aucun élément vide rendu", () => {
  const { view, file, parent, contentEl } = buildCardHarness({ fm: {}, cardContent: "extrait" });

  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});

  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-card-pov")).length, 0);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-card-status")).length, 0);
});

test("Carte dossier — sans mots, sans objectif, sans anneau de progression", () => {
  const folderNote = new TFile("Projet/Manuscrit/Chapitre 1/Chapitre 1.md");
  const folder = new TFolder("Projet/Manuscrit/Chapitre 1");
  const parent = new TFolder("Projet/Manuscrit");
  folder.parent = parent;
  const contentEl = new FakeElement();
  const app = { vault: {}, workspace: {} };
  const plugin = {
    settings: {},
    folderNoteFor: () => folderNote,
    labelOf: () => "",
    labelColor: () => null,
    fmOf: () => ({ synopsis: "Synopsis du dossier." }),
    flattenFiles: () => [],
    folderGoal: () => 0,
  };
  const view = new BoardView({ app, contentEl }, plugin);
  view.wcMap = new Map();
  view.filterActive = () => true;
  view.currentCardContent = "synopsis";

  view.renderFolderCard(contentEl, parent, folder, 0, [folder], new Map(), () => {});

  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-card-wc")).length, 0);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-ring")).length, 0);
  const excerpt = findFirst(contentEl, (el) => el.classes.has("feuillets-card-excerpt"));
  assert.ok(excerpt);
  assert.equal(excerpt.text, "Synopsis du dossier.");
});

/* ===================== OPTIONS CARTES (buildModeOptionsMenu) ===================== */

function menuItemTitles(menu) {
  return menu.items.filter((i) => !i.separator).map((i) => i.title);
}

// Colonnes du menu Plan uniquement : ne garde que les entrées venant APRÈS
// l'en-tête « — Colonnes affichées — », donc jamais « Réinitialiser… » ni
// les autres options d'affichage placées au-dessus (ex. retour à la ligne).
function outlineColumnMenuTitles(menu) {
  const headerIndex = menu.items.findIndex((i) => i.title === "— Colonnes affichées —");
  return menu.items
    .slice(headerIndex + 1)
    .filter((i) => !i.separator && !i.disabled && typeof i.callback === "function" && i.checked !== undefined)
    .map((i) => i.title);
}

function buildOptionsHarness() {
  const app = {};
  const plugin = { settings: {} };
  const view = new BoardView({ app, contentEl: new FakeElement() }, plugin);
  return { view, plugin };
}

test("Options Cartes — Fiction : Portée / Synopsis+Contenu / Taille, aucun toggle Progression/Tags", () => {
  const { view } = buildOptionsHarness();
  view.currentCardContent = "synopsis";
  const menu = new Menu();
  view.buildModeOptionsMenu(menu, "board", {
    S: view.plugin.settings,
    meta: {},
    pType: "fiction",
    wholeManuscript: false,
    outlineColumns: {},
  });

  const titles = menuItemTitles(menu);
  assert.ok(titles.includes("Dossier par dossier"));
  assert.ok(titles.includes("Tout le manuscrit"));
  assert.ok(titles.includes("Corps : synopsis"), "option Synopsis attendue");
  assert.ok(titles.includes("Contenu"), "option Contenu attendue");
  assert.ok(titles.includes("Tuiles petites"));
  assert.ok(titles.includes("Tuiles moyennes"));
  assert.ok(titles.includes("Tuiles grandes"));

  assert.equal(titles.some((title) => /progress/i.test(title) || title === "Barres de progression"), false);
  assert.equal(titles.includes("Tags sur les tuiles"), false);
  // Aucun résumé long ne doit apparaître en Fiction.
  assert.equal(titles.includes("Résumé long"), false);
});

test("Options Cartes — Non-fiction/Libre : Portée / Résumé long+Contenu / Taille", () => {
  for (const pType of ["nonfiction", "free"]) {
    const { view } = buildOptionsHarness();
    view.currentCardContent = "summary";
    const menu = new Menu();
    view.buildModeOptionsMenu(menu, "board", {
      S: view.plugin.settings,
      meta: {},
      pType,
      wholeManuscript: false,
      outlineColumns: {},
    });

    const titles = menuItemTitles(menu);
    assert.ok(titles.includes("Résumé long"), `${pType} : option Résumé long attendue`);
    assert.ok(titles.includes("Contenu"), `${pType} : option Contenu attendue`);
    assert.equal(titles.includes("Corps : synopsis"), false, `${pType} : pas de Synopsis`);
  }
});

/* ===================== PLAN — colonnes (visibleCols) ===================== */

test("Plan Fiction — Titre, Synopsis, POV, Label, Statut, Tags, Date, Mots, Objectif", () => {
  const { view } = buildOptionsHarness();
  view.outlineColumns = {
    synopsis: true, pov: true, summary: false, label: true, status: true,
    tags: true, date: true, words: true, goal: true,
    notes: true, filename: true, progress: true, compile: true, compiler: true,
  };
  const ids = view.visibleCols().map((c) => c.id);
  assert.deepEqual(ids, ["title", "synopsis", "pov", "label", "status", "tags", "date", "words", "goal"]);
});

test("Plan Non-fiction/Libre — Titre, Résumé long, Label, Statut, Tags, Date, Mots, Objectif", () => {
  const { view } = buildOptionsHarness();
  view.outlineColumns = {
    synopsis: false, pov: false, summary: true, label: true, status: true,
    tags: true, date: true, words: true, goal: true,
    notes: true, filename: true, progress: true, compile: true, compiler: true,
  };
  const ids = view.visibleCols().map((c) => c.id);
  assert.deepEqual(ids, ["title", "summary", "label", "status", "tags", "date", "words", "goal"]);
});

test("Plan — Notes/Nom du fichier/Progression/Compiler jamais rendus, même stockés à true", () => {
  const { view } = buildOptionsHarness();
  view.outlineColumns = {
    synopsis: true, pov: true, label: false, status: false, tags: false, date: false,
    words: false, goal: false, notes: true, filename: true, progress: true, compile: true, compiler: true,
  };
  const ids = view.visibleCols().map((c) => c.id);
  assert.ok(!ids.includes("notes"));
  assert.ok(!ids.includes("filename"));
  assert.ok(!ids.includes("progress"));
  assert.ok(!ids.includes("compile"));
});

/* ===================== PLAN — menu des colonnes ===================== */

test("Menu Plan Fiction — colonnes proposées : Synopsis, Pov, Personnages, Fil, Label, Statut, Tags, Date, Mots, Objectif — jamais Notes/Fichier/Progression/Compiler", () => {
  const { view } = buildOptionsHarness();
  const menu = new Menu();
  view.buildModeOptionsMenu(menu, "outline", {
    S: view.plugin.settings,
    meta: {},
    pType: "fiction",
    wholeManuscript: false,
    outlineColumns: {},
  });

  assert.deepEqual(
    outlineColumnMenuTitles(menu),
    ["Synopsis", "Pov", "Personnages", "Fil", "Label", "Statut", "Tags", "Date", "Mots", "Objectif"]
  );
  assert.equal(menuItemTitles(menu).includes("Barres de progression"), false);
});

test("Menu Plan Non-fiction/Libre — colonnes proposées : Résumé long, Label, Statut, Tags, Date, Mots, Objectif", () => {
  const { view } = buildOptionsHarness();
  const menu = new Menu();
  view.buildModeOptionsMenu(menu, "outline", {
    S: view.plugin.settings,
    meta: {},
    pType: "nonfiction",
    wholeManuscript: false,
    outlineColumns: {},
  });

  assert.deepEqual(
    outlineColumnMenuTitles(menu),
    ["Résumé long", "Label", "Statut", "Tags", "Date", "Mots", "Objectif"]
  );
});

/* ===================== PLAN — cellules (renderOutlineLevel) ===================== */

function buildOutlineHarness({ children, statuses = [] } = {}) {
  const root = new TFolder("Projet/Manuscrit");
  root.children = children;
  for (const c of children) c.parent = root;

  const app = { workspace: {} };
  const plugin = {
    settings: { collapsed: {}, statuses, wordGoal: 0 },
    getOrderedChildren: (folder) => folder.children,
    isFrontMatter: () => false,
    fmOf: (file) => file.__fm || {},
    shortTitleFor: (file) => file.basename,
    saveSettings: async () => {},
  };
  const view = new BoardView({ app, contentEl: new FakeElement() }, plugin);
  view.passesFilter = () => true;
  view.attachDragHandlers = () => {};
  view.handleMultiSelectClick = () => false;
  view._renderGen = 1; // renderOutlineLevel court-circuite si gen ne matche pas ce compteur
  view.wcMap = new Map(); // toujours défini : renderOutlineLevel lit wcMap.get() pour chaque ligne
  return { view, root, app, plugin };
}

test("Plan — édition inline du pov (cellule pov, valeur brute)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: true, label: false, status: false, tags: false, date: false, words: false, goal: false };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-pov"));
  assert.ok(cell, "cellule POV attendue");
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(editArea.text, "Camille");
});

test("Plan — édition inline de la date (cellule date, placeholder —)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: true, words: false, goal: false };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-date"));
  assert.ok(cell, "cellule date attendue");
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(editArea.text, "1789-07-14");
});

test("Plan — date vide : placeholder « — »", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: true, words: false, goal: false };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-date"));
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(editArea.text, "—");
});

test("Plan — pov vide : grammaire « — » (LOT 4)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: true, label: false, status: false, tags: false, date: false, words: false, goal: false };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-pov"));
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(editArea.text, "—");
});

test("Plan — Mots seul : la cellule mots fonctionne indépendamment de l'objectif", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.wcMap = new Map([[file.path, 314]]);
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: true, goal: false };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const wordsCell = findFirst(table, (el) => el.classes.has("feuillets-cell-words"));
  assert.equal(wordsCell.text, "314");
  assert.equal(findAll(table, (el) => el.classes.has("feuillets-cell-goal")).length, 0);
});

test("Plan — Objectif : la cellule est un input numérique (jamais un texte statique), initialisé avec goal", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { goal: 1200 };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.wcMap = new Map([[file.path, 0]]);
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: false, goal: true };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const goalCell = findFirst(table, (el) => el.classes.has("feuillets-cell-goal"));
  const goalInput = findFirst(goalCell, (el) => el.tag === "input" && el.classes.has("feuillets-goal-input"));
  assert.ok(goalInput, "Objectif = input numérique (makeGoalInput), pas un texte statique");
  assert.equal(goalInput.type, "number", "input de type number");
  assert.equal(goalInput.value, "1200", "goal existant : input prérempli avec cette valeur");
  assert.equal(findAll(table, (el) => el.classes.has("feuillets-cell-words")).length, 0);
});

test("Plan — Objectif absent : input vide, placeholder = objectif projet par défaut", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.wcMap = new Map([[file.path, 0]]);
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: false, goal: true };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const goalInput = findFirst(table, (el) => el.classes.has("feuillets-goal-input"));
  assert.ok(goalInput, "input Objectif présent même sans goal");
  assert.equal(goalInput.value, "", "goal absent : input vide");
  assert.equal(goalInput.attributes.min, "0", "min=0 conservé");
  assert.equal(goalInput.attributes.placeholder, "0", "placeholder = objectif projet par défaut (wordGoal du harness)");
});

test("Plan — Objectif : modification → setFm(file, 'goal', nombre)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: false, goal: true };
  const saved = [];
  view.setFm = async (_f, key, value) => { saved.push({ key, value }); };
  view.render = async () => {};

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);
  const goalInput = findFirst(table, (el) => el.classes.has("feuillets-goal-input"));
  goalInput.value = "2500";
  await goalInput.trigger("change");

  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, "goal");
  assert.equal(saved[0].value, 2500, "nombre écrit via setFm");
});

test("Plan — Objectif vidé : setFm(file, 'goal', '') pour supprimer la clé", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { goal: 1200 };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: false, goal: true };
  const saved = [];
  view.setFm = async (_f, key, value) => { saved.push({ key, value }); };
  view.render = async () => {};

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);
  const goalInput = findFirst(table, (el) => el.classes.has("feuillets-goal-input"));
  goalInput.value = "";
  await goalInput.trigger("change");

  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, "goal");
  assert.equal(saved[0].value, "", "champ vidé → setFm avec '' (le writer supprime la clé)");
});

test("Plan — Objectif non numérique : aucune écriture NaN, setFm('goal', '')", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: false, goal: true };
  const saved = [];
  view.setFm = async (_f, key, value) => { saved.push({ key, value }); };
  view.render = async () => {};

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);
  const goalInput = findFirst(table, (el) => el.classes.has("feuillets-goal-input"));
  goalInput.value = "abc";
  await goalInput.trigger("change");

  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, "goal");
  assert.equal(saved[0].value, "", "valeur non numérique → jamais NaN, clé vidée");
});

test("Plan — Objectif négatif : jamais écrit (setFm('goal', ''))", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: false, goal: true };
  const saved = [];
  view.setFm = async (_f, key, value) => { saved.push({ key, value }); };
  view.render = async () => {};

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);
  const goalInput = findFirst(table, (el) => el.classes.has("feuillets-goal-input"));
  goalInput.value = "-500";
  await goalInput.trigger("change");

  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, "goal");
  assert.equal(saved[0].value, "", "nombre négatif jamais écrit");
});

test("Plan — Mots + Objectif ensemble", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { goal: 2000 };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.wcMap = new Map([[file.path, 987]]);
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: true, goal: true };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  assert.equal(findFirst(table, (el) => el.classes.has("feuillets-cell-words")).text, "987");
  const goalInput = findFirst(table, (el) => el.classes.has("feuillets-goal-input"));
  assert.ok(goalInput, "Objectif toujours un input quand Mots est aussi visible");
  assert.equal(goalInput.value, "2000");
});

/* ===================== PLAN — redimensionnement des colonnes (inchangé) ===================== */

test("Plan — colsTemplate() inclut la largeur POV configurée, mécanisme de resize inchangé", () => {
  const { view } = buildOptionsHarness();
  view.plugin.settings.outlineWidths = { ...DEFAULT_SETTINGS.outlineWidths };
  view.outlineColumns = { synopsis: true, pov: true, label: false, status: false, tags: false, date: false, words: false, goal: false };

  const template = view.colsTemplate();
  // "22px " (poignée) + une largeur par colonne visible (title, synopsis, pov).
  const parts = template.split(" ");
  assert.equal(parts[0], "22px");
  assert.equal(parts.length, 1 + view.visibleCols().length);
  // La largeur par défaut de la colonne POV (§8/§21) est bien prise en compte.
  assert.equal(parts[3], `${DEFAULT_SETTINGS.outlineWidths.pov}px`);
});

/* ===================== PLAN — option « Retour à la ligne des textes longs » ===================== */

function buildOutlineWrapHarness({ children, outlineWrapLongText = false, outlineColumns } = {}) {
  const root = new TFolder("Projet/Manuscrit");
  root.children = children;
  for (const c of children) c.parent = root;

  const app = { workspace: {} };
  const plugin = {
    settings: {
      collapsed: {},
      statuses: [],
      wordGoal: 0,
      outlineWidths: { ...DEFAULT_SETTINGS.outlineWidths },
      outlineWrapLongText,
    },
    getOrderedChildren: (folder) => folder.children,
    isFrontMatter: () => false,
    fmOf: (file) => file.__fm || {},
    shortTitleFor: (file) => file.basename,
    saveSettings: async () => {},
  };
  const view = new BoardView({ app, contentEl: new FakeElement() }, plugin);
  view.passesFilter = () => true;
  view.attachDragHandlers = () => {};
  view.handleMultiSelectClick = () => false;
  view._renderGen = 1;
  view.wcMap = new Map();
  view.outlineColumns = outlineColumns || {
    synopsis: true, summary: false, pov: false, label: false, status: false,
    tags: false, date: false, words: false, goal: false,
  };
  return { view, root, app, plugin };
}

test("Plan — wrap OFF : le conteneur Plan garde le comportement historique (pas de classe wrap)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { synopsis: "Un synopsis très long qui serait normalement tronqué sur une seule ligne." };
  const { view, root } = buildOutlineWrapHarness({ children: [file], outlineWrapLongText: false });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);

  const outline = findFirst(container, (el) => el.classes.has("feuillets-outline"));
  assert.ok(outline, "conteneur Plan attendu");
  assert.equal(outline.classes.has("feuillets-outline-wrap"), false);
  // La cellule Synopsis existe toujours, avec exactement le même contenu.
  const synopsisCell = findFirst(container, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(synopsisCell.text, file.__fm.synopsis);
});

test("Plan — wrap ON : la classe/état de wrap est appliqué au conteneur qui porte Synopsis", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { synopsis: "Un synopsis très long qui devrait maintenant passer à la ligne." };
  const { view, root } = buildOutlineWrapHarness({ children: [file], outlineWrapLongText: true });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);

  const outline = findFirst(container, (el) => el.classes.has("feuillets-outline"));
  assert.ok(outline.classes.has("feuillets-outline-wrap"), "classe de wrap attendue sur le conteneur Plan");
  const synopsisTitleCell = findFirst(container, (el) => el.classes.has("feuillets-cell-synopsis"));
  assert.ok(synopsisTitleCell, "cellule Synopsis toujours présente sous le conteneur en wrap");
});

test("Plan — Résumé long (Non-fiction/Libre) suit le même contrat que Synopsis", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { summary: "Un résumé long qui doit lui aussi passer à la ligne quand l'option est activée." };
  const outlineColumns = {
    synopsis: false, summary: true, pov: false, label: false, status: false,
    tags: false, date: false, words: false, goal: false,
  };
  const { view: viewOn, root: rootOn } = buildOutlineWrapHarness({ children: [file], outlineWrapLongText: true, outlineColumns });
  const containerOn = new FakeElement();
  await viewOn.renderOutline(containerOn, rootOn, new Map(), () => {}, 1);
  const outlineOn = findFirst(containerOn, (el) => el.classes.has("feuillets-outline"));
  assert.ok(outlineOn.classes.has("feuillets-outline-wrap"));
  assert.ok(findFirst(containerOn, (el) => el.classes.has("feuillets-cell-summary")), "cellule Résumé long attendue");

  const file2 = new TFile("Projet/Manuscrit/Scène 2.md");
  file2.__fm = { summary: "Idem, avec wrap désactivé cette fois." };
  const { view: viewOff, root: rootOff } = buildOutlineWrapHarness({ children: [file2], outlineWrapLongText: false, outlineColumns });
  const containerOff = new FakeElement();
  await viewOff.renderOutline(containerOff, rootOff, new Map(), () => {}, 1);
  const outlineOff = findFirst(containerOff, (el) => el.classes.has("feuillets-outline"));
  assert.equal(outlineOff.classes.has("feuillets-outline-wrap"), false);
});

test("Plan — les colonnes courtes (statut, mots) restent rendues à l'identique, wrap ON ou OFF", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { status: "Brouillon" };
  const outlineColumns = {
    synopsis: false, summary: false, pov: false, label: false, status: true,
    tags: false, date: false, words: true, goal: false,
  };

  for (const outlineWrapLongText of [false, true]) {
    const { view, root } = buildOutlineWrapHarness({ children: [file], outlineWrapLongText, outlineColumns });
    view.wcMap = new Map([[file.path, 42]]);
    const container = new FakeElement();
    await view.renderOutline(container, root, new Map(), () => {}, 1);

    // Les cellules courtes existent et gardent le même contenu — le wrap
    // (option purement CSS, scopée à Synopsis/Résumé) ne les modifie pas.
    const statusCell = findFirst(container, (el) => el.classes.has("feuillets-cell-status"));
    assert.ok(statusCell, `cellule statut attendue (wrap=${outlineWrapLongText})`);
    const wordsCell = findFirst(container, (el) => el.classes.has("feuillets-cell-words"));
    assert.equal(wordsCell.text, "42");
    // Aucune cellule Synopsis/Résumé ne doit apparaître ici : le wrap
    // n'active jamais ces colonnes de lui-même.
    assert.equal(findAll(container, (el) => el.classes.has("feuillets-cell-synopsis")).length, 0);
    assert.equal(findAll(container, (el) => el.classes.has("feuillets-cell-summary")).length, 0);
  }
});

test("Plan — basculer wrap ON/OFF ne modifie jamais le front matter (YAML) du feuillet", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const originalFm = { synopsis: "Contenu original, jamais réécrit par le simple affichage." };
  file.__fm = originalFm;

  for (const outlineWrapLongText of [false, true]) {
    const { view, root } = buildOutlineWrapHarness({ children: [file], outlineWrapLongText });
    const container = new FakeElement();
    await view.renderOutline(container, root, new Map(), () => {}, 1);
    assert.deepEqual(file.__fm, originalFm, `wrap=${outlineWrapLongText} : YAML inchangé`);
  }
});

test("Menu Plan — bascule « Retour à la ligne des textes longs » : coche l'état courant et persiste via saveSettings (même mécanisme que outlineWidths)", async () => {
  const { view } = buildOptionsHarness();
  view.plugin.settings.outlineWrapLongText = false;
  let saved = 0;
  view.plugin.saveSettings = async () => { saved++; };
  view.render = async () => {};

  const menu = new Menu();
  view.buildModeOptionsMenu(menu, "outline", {
    S: view.plugin.settings,
    meta: {},
    pType: "fiction",
    wholeManuscript: false,
    outlineColumns: {},
  });

  const item = menu.items.find((i) => i.title === "Retour à la ligne des textes longs");
  assert.ok(item, "option de menu attendue");
  assert.equal(item.checked, false, "décochée par défaut (OFF historique)");

  await item.callback();
  assert.equal(view.plugin.settings.outlineWrapLongText, true, "bascule vers ON");
  assert.equal(saved, 1, "persistée via le même saveSettings() que les autres options Plan");

  // La bascule suit le même mécanisme au rendu suivant du menu (F).
  const menu2 = new Menu();
  view.buildModeOptionsMenu(menu2, "outline", {
    S: view.plugin.settings,
    meta: {},
    pType: "fiction",
    wholeManuscript: false,
    outlineColumns: {},
  });
  const item2 = menu2.items.find((i) => i.title === "Retour à la ligne des textes longs");
  assert.equal(item2.checked, true, "préférence restaurée à partir de settings.outlineWrapLongText");
});

test("Plan LOT 1 — comportement d'édition de date dans le Plan reste inchangé", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: true, words: false, goal: false };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-date"));
  assert.ok(cell, "cellule date du Plan trouvée");
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(editArea.text, "1789-07-14", "valeur YAML affichée dans le Plan");
});

/* ===================== HELPER makeClickToEditFmArea (LOT 4) ===================== */

function buildFmEditHarness({ fm = {} } = {}) {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = fm;
  const plugin = {
    settings: {},
    fmOf: (f) => f.__fm || {},
  };
  const view = new BoardView({ app: { workspace: {} }, contentEl: new FakeElement() }, plugin);
  return { view, file, plugin };
}

test("LOT4 helper — cellule brute, textarea brut, setFm brut", async () => {
  const { view, file } = buildFmEditHarness({ fm: { synopsis: "Résumé court." } });
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };

  const parent = new FakeElement();
  const cell = view.makeClickToEditFmArea(parent, file, "synopsis", "Synopsis…", 6);

  assert.equal(cell.text, "Résumé court.", "cellule affiche la valeur brute sans formatter");

  await cell.trigger("click");
  const area = findFirst(parent, (el) => el.tag === "textarea");
  assert.equal(area.value, "Résumé court.", "textarea reçoit la valeur brute");

  area.value = "Résumé révisé.";
  await area.trigger("blur");
  assert.equal(setFmCalls[0].v, "Résumé révisé.", "setFm reçoit la valeur brute");
  assert.equal(cell.text, "Résumé révisé.", "cellule mise à jour avec la valeur brute");
});

test("LOT4 helper — valeur vide : placeholder affiché, clic → textarea vide", async () => {
  const { view, file } = buildFmEditHarness({ fm: {} });
  const parent = new FakeElement();
  const cell = view.makeClickToEditFmArea(parent, file, "pov", "—", 1);

  assert.equal(cell.text, "—", "placeholder affiché");
  assert.ok(cell.classes.has("is-empty"), "cellule marquée vide");

  await cell.trigger("click");
  const area = findFirst(parent, (el) => el.tag === "textarea");
  assert.ok(area, "placeholder cliquable : textarea créé");
  assert.equal(area.value, "", "textarea vide");
});

test("LOT4 helper — valeur inchangée : setFm et afterSave non appelés", async () => {
  const { view, file } = buildFmEditHarness({ fm: { pov: "Camille" } });
  let setFmCalls = 0;
  let afterSaveCalls = 0;
  view.setFm = async () => { setFmCalls++; };

  const parent = new FakeElement();
  const cell = view.makeClickToEditFmArea(parent, file, "pov", "—", 1, () => { afterSaveCalls++; });

  await cell.trigger("click");
  const area = findFirst(parent, (el) => el.tag === "textarea");
  area.value = "Camille"; // valeur inchangée
  await area.trigger("blur");

  assert.equal(setFmCalls, 0, "setFm non appelé si valeur inchangée");
  assert.equal(afterSaveCalls, 0, "afterSave non appelé si valeur inchangée");
});

/* ===================== STORY ARC — Synopsis et POV éditables (LOT 4) ===================== */

function buildArcHarness({ children = [], labels = {} } = {}) {
  const root = new TFolder("Projet/Manuscrit");
  root.children = children;
  for (const c of children) c.parent = root;

  const app = { workspace: {} };
  const plugin = {
    // Options d'affichage Story Arc (§13) actives par défaut, comme
    // DEFAULT_SETTINGS — les tests d'options les passent à false.
    settings: { arcsShowSynopsis: true, arcsShowPov: true, arcsShowCharacters: true, arcsShowThreads: true },
    getOrderedChildren: (folder) => (folder === root ? children : []),
    isFrontMatter: () => false,
    roleOfFolder: () => "partie",
    roleOfFile: () => "scene",
    labelsOf: (file) => labels[file.path] || [],
    labelColor: () => "",
    shortTitleFor: (file) => file.basename,
    getStatusColor: () => "",
    fmOf: (file) => file.__fm || {},
  };
  const view = new BoardView({ app, contentEl: new FakeElement() }, plugin);
  view.passesFilter = () => true;
  view._renderGen = 1;
  // afterSave du pov appelle this.render(true) : par défaut, le neutraliser pour
  // ne pas toucher au vrai cycle de rendu (les tests qui l'observent le remplacent).
  view.render = async () => {};
  return { view, root, app, plugin };
}

function renderArc(view, root) {
  const container = new FakeElement();
  view.renderCheminDeFer(container, root, new Map());
  return container;
}

function arcSynopsisHost(container) {
  return findFirst(container, (el) => el.classes.has("feuillets-arcs-file-synopsis"));
}

function arcPovHost(container) {
  return findFirst(container, (el) => el.classes.has("feuillets-arcs-pov"));
}

function arcPovIcon(container) {
  return findFirst(arcPovHost(container), (el) => el.classes.has("feuillets-arcs-meta-icon"));
}

function arcPovValueCell(container) {
  return findFirst(arcPovHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
}

/* LOT 5 — Personnages et Fil : mêmes helpers structurels que pov
   (host / iconHost / valueHost éditable). */
function arcCharactersHost(container) {
  return findFirst(container, (el) => el.classes.has("feuillets-arcs-personnages"));
}

function arcCharactersIcon(container) {
  return findFirst(arcCharactersHost(container), (el) => el.classes.has("feuillets-arcs-meta-icon"));
}

function arcCharactersCell(container) {
  return findFirst(arcCharactersHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
}

function arcThreadHost(container) {
  return findFirst(container, (el) => el.classes.has("feuillets-arcs-thread"));
}

function arcThreadIcon(container) {
  return findFirst(arcThreadHost(container), (el) => el.classes.has("feuillets-arcs-meta-icon"));
}

function arcThreadCell(container) {
  return findFirst(arcThreadHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
}

function filterButtonIcons(container) {
  return findAll(container, (el) => el.classes.has("feuillets-arcs-filter-btn")).map((btn) => {
    const iconEl = findFirst(btn, (el) => el.icon);
    return iconEl ? iconEl.icon : null;
  });
}

test("LOT4 Story Arc — synopsis renseigné : host + cellule + textarea brut + setFm", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille", synopsis: "Résumé court." };
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };

  const container = renderArc(view, root);
  const host = arcSynopsisHost(container);
  assert.ok(host, "host .feuillets-arcs-file-synopsis présent");

  const cell = findFirst(host, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.ok(cell, "cellule d'édition du synopsis présente");
  assert.equal(cell.text, "Résumé court.", "synopsis existant affiché");

  await cell.trigger("click");
  const area = findFirst(host, (el) => el.tag === "textarea");
  assert.ok(area, "textarea créé au clic");
  assert.equal(area.value, "Résumé court.", "textarea contient le synopsis brut");

  area.value = "Résumé révisé.";
  await area.trigger("blur");
  assert.equal(setFmCalls[0].k, "synopsis");
  assert.equal(setFmCalls[0].v, "Résumé révisé.", "setFm reçoit la nouvelle valeur synopsis");
  assert.equal(cell.text, "Résumé révisé.", "cellule mise à jour après sauvegarde");
});

test("LOT4 Story Arc — Synopsis ON + absent : host présent, « — » cliquable, textarea vide", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" }; // synopsis absent
  const { view, root } = buildArcHarness({ children: [file] });

  const container = renderArc(view, root);

  // La ligne du feuillet reste rendue (titre + rails).
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-row-file")), "ligne du feuillet rendue");

  // Option ON : le host Synopsis existe toujours, même sans valeur.
  const host = arcSynopsisHost(container);
  assert.ok(host, "host .feuillets-arcs-file-synopsis présent quand la valeur est absente (option ON)");

  const cell = findFirst(host, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(cell.text, "—", "synopsis vide affiché « — »");
  assert.ok(cell.classes.has("is-empty"), "cellule marquée vide");

  await cell.trigger("click");
  const area = findFirst(host, (el) => el.tag === "textarea");
  assert.ok(area, "« — » cliquable : textarea créé");
  assert.equal(area.value, "", "textarea vide");
});

test("LOT4 Story Arc — modifier le Synopsis ne déclenche pas de render(true)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille", synopsis: "Résumé court." };
  const { view, root } = buildArcHarness({ children: [file] });
  let renderCalls = [];
  view.setFm = async () => {};
  view.render = async (force) => { renderCalls.push(force); };

  const container = renderArc(view, root);
  const cell = findFirst(arcSynopsisHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
  await cell.trigger("click");
  const area = findFirst(arcSynopsisHost(container), (el) => el.tag === "textarea");
  area.value = "Résumé révisé.";
  await area.trigger("blur");

  assert.equal(renderCalls.length, 0, "aucun render(true) déclenché par une modification Synopsis");
});

test("LOT4 Story Arc — pov renseigné : eye + valeur brute, textarea brute, setFm brute, render(true)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = [];
  let renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async (force) => { renderCalls.push(force); };

  const container = renderArc(view, root);
  const host = arcPovHost(container);
  assert.ok(host, "host .feuillets-arcs-pov présent");

  // Icône Lucide Obsidian « eye », plus aucun libellé textuel « pov : ».
  assert.equal(arcPovIcon(container).icon, "eye", "icône Lucide Obsidian « eye »");
  const cell = arcPovValueCell(container);
  assert.equal(cell.text, "Camille", "la valeur brute est le seul texte de la ligne pov");

  await cell.trigger("click");
  const area = findFirst(host, (el) => el.tag === "textarea");
  assert.equal(area.value, "Camille", "textarea contient seulement la valeur brute");

  area.value = "Éloïse";
  await area.trigger("blur");
  assert.equal(setFmCalls[0].k, "pov");
  assert.equal(setFmCalls[0].v, "Éloïse", "setFm reçoit la valeur brute, sans icône ni libellé");
  assert.ok(renderCalls.includes(true), "render(true) appelé après vraie modification du pov");
});

test("LOT4 Story Arc — Pov ON + absent : ligne présente, eye + « — »", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { synopsis: "Résumé court." }; // pov absent
  const { view, root } = buildArcHarness({ children: [file] });

  const container = renderArc(view, root);

  // La ligne du feuillet reste rendue (titre + rails).
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-row-file")), "ligne du feuillet rendue");
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-empty")).length, 0, "aucun .feuillets-empty affiché");

  // Option ON : la ligne pov existe toujours, eye + « — ».
  assert.ok(arcPovHost(container), "ligne .feuillets-arcs-pov présente quand la valeur est absente (option ON)");
  assert.equal(arcPovIcon(container).icon, "eye", "icône eye présente");
  const cell = arcPovValueCell(container);
  assert.equal(cell.text, "—", "pov vide affiché « — »");
  assert.ok(cell.classes.has("is-empty"), "cellule marquée vide");
});

test("LOT4 Story Arc — feuillet sans aucune métadonnée d'arc : titre + « — » éditables (options ON)", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });

  const container = renderArc(view, root);

  // Pas d'état vide : rails vides mais ligne rendue.
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-empty")).length, 0, "pas d'état vide Story Arc");

  // Titre du feuillet présent.
  const title = findFirst(container, (el) => el.classes.has("feuillets-arcs-file-title"));
  assert.equal(title.text, "Scène", "titre du feuillet présent");

  // Options ON : Synopsis et pov restent des lignes éditables vides (« — »).
  assert.ok(arcSynopsisHost(container), "ligne Synopsis présente (option ON), vide → « — »");
  assert.equal(findFirst(arcSynopsisHost(container), (el) => el.classes.has("feuillets-flat-text-cell")).text, "—", "synopsis vide « — »");
  assert.ok(arcPovHost(container), "ligne pov présente (option ON)");
  assert.equal(arcPovIcon(container).icon, "eye", "icône eye présente");
  assert.equal(arcPovValueCell(container).text, "—", "pov vide eye + « — »");

  // LOT 5 : Personnages et Fil présents (options ON), valeurs vides « — ».
  assert.ok(arcCharactersHost(container), "ligne Personnages présente (option ON)");
  assert.equal(arcCharactersIcon(container).icon, "users", "icône users présente");
  assert.equal(arcCharactersCell(container).text, "—", "personnages vides → « — »");
  assert.ok(arcThreadHost(container), "ligne Fil présente (option ON)");
  assert.equal(arcThreadIcon(container).icon, "route", "icône route présente");
  assert.equal(arcThreadCell(container).text, "—", "fil vide → « — »");

  // Aucun faux label/fil/filtre créé.
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-dot")).length, 0, "aucun point de rail inventé");
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-filter-btn")).length, 0, "aucun bouton de filtre inventé");
});

test("LOT4 Story Arc — aucun feuillet : l'état vide board.arcs.empty est conservé, nouveau texte", () => {
  const { view, root } = buildArcHarness({ children: [] });

  const container = renderArc(view, root);
  const empty = findFirst(container, (el) => el.classes.has("feuillets-empty"));
  assert.ok(empty, "état vide rendu sans aucun feuillet");
  assert.equal(empty.text, "Aucun feuillet à afficher.", "message d'état vide : zéro feuillet, plus aucune consigne YAML");
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-row-file")).length, 0, "aucune ligne rendue sans feuillet");
});

test("LOT4 Story Arc — pov inchangé : aucun render(true) ni setFm", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = 0;
  let renderCalls = [];
  view.setFm = async () => { setFmCalls++; };
  view.render = async (force) => { renderCalls.push(force); };

  const container = renderArc(view, root);
  const cell = arcPovValueCell(container);
  await cell.trigger("click");
  const area = findFirst(arcPovHost(container), (el) => el.tag === "textarea");
  area.value = "Camille"; // valeur inchangée
  await area.trigger("blur");

  assert.equal(renderCalls.length, 0, "aucun render(true) si pov inchangé");
  assert.equal(setFmCalls, 0, "setFm non appelé si pov inchangé");
});

test("LOT4 Story Arc — non-régression : titre, statut, personnages, fils, rails, filtres inchangés", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {
    pov: "Camille",
    status: "Brouillon",
    synopsis: "Résumé.",
    characters: ["Alice", "Bob"],
    thread: "filA",
  };
  const { view, root } = buildArcHarness({ children: [file], labels: { [file.path]: ["rouge"] } });
  const container = renderArc(view, root);

  // Titre du feuillet inchangé.
  const title = findFirst(container, (el) => el.classes.has("feuillets-arcs-file-title"));
  assert.equal(title.text, "Scène", "titre du feuillet inchangé");

  // Statut inchangé (discret, en lecture seule).
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-status-dot")), "statut présent");

  // LOT 5 : Personnages affichés via icône users + valeur CSV jointe,
  // jamais « Avec … ».
  assert.ok(arcCharactersHost(container), "ligne Personnages présente (option ON)");
  assert.equal(arcCharactersIcon(container).icon, "users", "icône users sur la ligne Personnages");
  assert.equal(arcCharactersCell(container).text, "Alice, Bob", "personnages joints par « , », sans « Avec »");

  // LOT 5 : Fil affiché via icône route + valeur, même source que le rail.
  assert.ok(arcThreadHost(container), "ligne Fil présente (option ON)");
  assert.equal(arcThreadIcon(container).icon, "route", "icône route sur la ligne Fil");
  assert.equal(arcThreadCell(container).text, "filA", "fil affiché sans libellé « Fil : »");

  // Fils narratifs toujours affichés en rail droit.
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-dot-fil")).length, 1, "fil affiché en rail");

  // Rails gauche/droite inchangés.
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-row-rails")).length, 2, "rail gauche et rail droit présents");

  // Pov : icône eye + valeur brute, jamais « pov : … ».
  assert.equal(arcPovIcon(container).icon, "eye", "icône eye sur la ligne pov");
  assert.equal(arcPovValueCell(container).text, "Camille", "valeur pov brute, sans libellé");

  // Filtres existants conservés (label, personnage, fil, POV).
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-filter-btn")).length, 4, "4 filtres conservés");

  // Aucun changement de structure du frontmatter : povOf reste la clé canonique 'pov'.
  assert.equal(view.fm(file).pov, "Camille", "clé 'pov' inchangée, aucun alias");
});

/* ===================== STORY ARC — ouverture du fichier : titre uniquement (finition LOT 4) ===================== */

/* Permet d'observer le vrai openFileActivating sans le mocker : on fournit
   un workspace dont getLeaf()/setActiveLeaf() et une feuille openFile()
   enregistrent les appels, et on déclenche les clics réels. */
function arcOpenHarness(view) {
  let opened = null;
  let activatedLeaf = null;
  const leaf = { openFile: async (f) => { opened = f; } };
  view.app.workspace = {
    getLeaf: () => leaf,
    setActiveLeaf: (l) => { activatedLeaf = l; },
  };
  return { opened: () => opened, activatedLeaf: () => activatedLeaf };
}

test("LOT4 Story Arc — la ligne fichier n'ouvre plus le feuillet : seule l'action du titre subsiste", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille", synopsis: "Résumé court." };
  const { view, root } = buildArcHarness({ children: [file] });

  const container = renderArc(view, root);
  const row = findFirst(container, (el) => el.classes.has("feuillets-arcs-row-file"));
  const title = findFirst(container, (el) => el.classes.has("feuillets-arcs-file-title"));

  // La ligne entière n'est plus l'élément d'ouverture : ni curseur pointer,
  // ni écouteur d'ouverture porté par la ligne.
  assert.equal(row.classes.has("feuillets-clickable"), false, "la ligne n'est plus marquée cliquable");
  assert.equal(row.events.has("click"), false, "aucune ouverture globale portée par la ligne");

  // Le titre porte seul l'action d'ouverture.
  assert.ok(title.classes.has("feuillets-clickable"), "le titre est la zone cliquable");
  assert.ok(title.events.has("click"), "le titre porte l'action d'ouverture");
});

test("LOT4 Story Arc — clic sur le titre ouvre le bon feuillet", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });
  const open = arcOpenHarness(view);

  const container = renderArc(view, root);
  const title = findFirst(container, (el) => el.classes.has("feuillets-arcs-file-title"));
  await title.trigger("click");

  assert.equal(open.opened(), file, "le feuillet ouvert est celui de la ligne");
  assert.ok(open.activatedLeaf(), "la feuille est activée (openFileActivating d'origine conservé)");
});

test("LOT4 Story Arc — clic sur Synopsis n'ouvre pas le feuillet, l'édition reste fonctionnelle", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille", synopsis: "Résumé court." };
  const { view, root } = buildArcHarness({ children: [file] });
  const open = arcOpenHarness(view);

  const container = renderArc(view, root);
  const cell = findFirst(arcSynopsisHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
  await cell.trigger("click");

  assert.equal(open.opened(), null, "aucune ouverture déclenchée par le clic Synopsis");
  assert.ok(findFirst(arcSynopsisHost(container), (el) => el.tag === "textarea"), "textarea d'édition du Synopsis créé");
});

test("LOT4 Story Arc — clic sur pov n'ouvre pas le feuillet, l'édition reste fonctionnelle", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });
  const open = arcOpenHarness(view);

  const container = renderArc(view, root);
  const cell = arcPovValueCell(container);
  await cell.trigger("click");

  assert.equal(open.opened(), null, "aucune ouverture déclenchée par le clic pov");
  assert.ok(findFirst(arcPovHost(container), (el) => el.tag === "textarea"), "textarea d'édition du pov créé");
});

test("LOT4 Story Arc — sauvegarde Synopsis et pov toujours persistée via setFm, sans ouverture", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille", synopsis: "Résumé court." };
  const { view, root } = buildArcHarness({ children: [file] });
  const open = arcOpenHarness(view);
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };

  const container = renderArc(view, root);

  // Synopsis : édition + sauvegarde persistée, aucune ouverture.
  const synCell = findFirst(arcSynopsisHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
  await synCell.trigger("click");
  const synArea = findFirst(arcSynopsisHost(container), (el) => el.tag === "textarea");
  synArea.value = "Résumé révisé.";
  await synArea.trigger("blur");
  assert.equal(open.opened(), null, "sauvegarde Synopsis sans ouverture");
  assert.equal(setFmCalls[0].k, "synopsis");
  assert.equal(setFmCalls[0].v, "Résumé révisé.");

  // POV : édition + sauvegarde persistée, aucune ouverture.
  const povCell = arcPovValueCell(container);
  await povCell.trigger("click");
  const povArea = findFirst(arcPovHost(container), (el) => el.tag === "textarea");
  povArea.value = "Éloïse";
  await povArea.trigger("blur");
  assert.equal(open.opened(), null, "sauvegarde pov sans ouverture");
  assert.equal(setFmCalls[1].k, "pov");
  assert.equal(setFmCalls[1].v, "Éloïse");
});

test("LOT4/LOT5 Story Arc — options d'affichage : masquer Synopsis/pov/Personnages/Fil retire les lignes sans toucher aux données, filtres ni rails", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille", synopsis: "Résumé court.", characters: ["Alice", "Bob"] };
  const { view, root } = buildArcHarness({ children: [file], labels: { [file.path]: ["rouge"] } });

  // Défaut : les quatre lignes sont rendues (Fil vide → « — »).
  const c1 = renderArc(view, root);
  assert.ok(arcSynopsisHost(c1), "synopsis visible par défaut");
  assert.ok(arcPovHost(c1), "pov visible par défaut");
  assert.ok(arcCharactersHost(c1), "personnages visibles par défaut");
  assert.ok(arcThreadHost(c1), "fil visible par défaut (option ON, vide → « — »)");

  // Synopsis masqué : sa ligne disparaît, les autres restent.
  view.plugin.settings.arcsShowSynopsis = false;
  const c2 = renderArc(view, root);
  assert.equal(arcSynopsisHost(c2), undefined, "synopsis masqué → aucune ligne");
  assert.ok(arcPovHost(c2), "pov toujours visible");

  // pov masqué : aucune ligne pov.
  view.plugin.settings.arcsShowPov = false;
  const c3 = renderArc(view, root);
  assert.equal(arcSynopsisHost(c3), undefined, "synopsis masqué");
  assert.equal(arcPovHost(c3), undefined, "pov masqué → aucune ligne");
  assert.ok(arcCharactersHost(c3), "personnages toujours visibles");

  // Personnages masqués : titre, rails et filtres intacts.
  view.plugin.settings.arcsShowCharacters = false;
  const c4 = renderArc(view, root);
  assert.equal(arcCharactersHost(c4), undefined, "personnages masqués → aucune ligne");
  assert.ok(arcThreadHost(c4), "fil toujours visible");
  assert.ok(findFirst(c4, (el) => el.classes.has("feuillets-arcs-row-file")), "ligne du feuillet conservée");
  assert.equal(findAll(c4, (el) => el.classes.has("feuillets-arcs-row-rails")).length, 2, "rails inchangés");
  // Filtres inchangés : label (rouge), personnage (Alice, Bob) et pov (Camille).
  assert.equal(findAll(c4, (el) => el.classes.has("feuillets-arcs-filter-btn")).length, 3, "filtres inchangés");

  // Fil masqué : seule sa ligne disparaît, rails et filtres intacts.
  view.plugin.settings.arcsShowThreads = false;
  const c5 = renderArc(view, root);
  assert.equal(arcThreadHost(c5), undefined, "fil masqué → aucune ligne Fil");
  assert.equal(findAll(c5, (el) => el.classes.has("feuillets-arcs-dot-fil")).length, 0, "aucun rail Fil sans donnée");
  assert.equal(findAll(c5, (el) => el.classes.has("feuillets-arcs-filter-btn")).length, 3, "filtres inchangés (aucun fil de données)");

  // Masquer ne modifie AUCUNE donnée.
  assert.equal(view.fm(file).pov, "Camille", "donnée pov intacte");
  assert.equal(view.fm(file).synopsis, "Résumé court.", "donnée synopsis intacte");
});

/* ===================== STORY ARC — contrat final Synopsis / Pov (finition LOT 4) ===================== */

test("LOT4 finition Story Arc — Synopsis OFF : aucune ligne Synopsis, aucun espace réservé", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille", synopsis: "Résumé court." };
  const { view, root } = buildArcHarness({ children: [file] });
  view.plugin.settings.arcsShowSynopsis = false;

  const container = renderArc(view, root);
  assert.equal(arcSynopsisHost(container), undefined, "aucune ligne Synopsis quand l'option est désactivée");
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-row-file")), "la ligne du feuillet reste rendue");
});

test("LOT4 finition Story Arc — saisie d'un Synopsis vide : setFm reçoit uniquement la valeur brute", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };

  const container = renderArc(view, root);
  const cell = findFirst(arcSynopsisHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
  await cell.trigger("click");
  const area = findFirst(arcSynopsisHost(container), (el) => el.tag === "textarea");
  area.value = "Ceci est le synopsis.";
  await area.trigger("blur");

  assert.equal(setFmCalls[0].k, "synopsis");
  assert.equal(setFmCalls[0].v, "Ceci est le synopsis.", "setFm reçoit uniquement la valeur brute");
  assert.equal(cell.text, "Ceci est le synopsis.", "cellule mise à jour");
});

test("LOT4 finition Story Arc — suppression d'un Synopsis : setFm vide, ligne conservée, rendu final « — »", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { synopsis: "Résumé court." };
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };

  const container = renderArc(view, root);
  const cell = findFirst(arcSynopsisHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
  await cell.trigger("click");
  const area = findFirst(arcSynopsisHost(container), (el) => el.tag === "textarea");
  area.value = ""; // effacement complet
  await area.trigger("blur");

  assert.equal(setFmCalls[0].k, "synopsis");
  assert.equal(setFmCalls[0].v, "", "setFm reçoit la valeur vide");
  assert.ok(arcSynopsisHost(container), "option active : la ligne Synopsis reste présente");
  assert.equal(cell.text, "—", "rendu final « — »");
  assert.ok(cell.classes.has("is-empty"), "cellule re-marquée vide");
});

test("LOT4 finition Story Arc — Synopsis inchangé : aucun setFm ni render inutile", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { synopsis: "Résumé court." };
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = 0;
  let renderCalls = 0;
  view.setFm = async () => { setFmCalls++; };
  view.render = async () => { renderCalls++; };

  const container = renderArc(view, root);
  const cell = findFirst(arcSynopsisHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
  await cell.trigger("click");
  const area = findFirst(arcSynopsisHost(container), (el) => el.tag === "textarea");
  area.value = "Résumé court."; // inchangé
  await area.trigger("blur");

  assert.equal(setFmCalls, 0, "aucun setFm si Synopsis inchangé");
  assert.equal(renderCalls, 0, "aucun render inutile");
});

test("LOT4 finition Story Arc — Pov ON + présent : host, icône Lucide eye, valeur brute", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });

  const container = renderArc(view, root);
  const host = arcPovHost(container);
  assert.ok(host, "host .feuillets-arcs-pov présent (option ON)");
  assert.ok(findFirst(host, (el) => el.classes.has("feuillets-arcs-meta-value")), "valueHost présent");
  assert.equal(arcPovIcon(container).icon, "eye", "icône Lucide Obsidian « eye »");
  assert.equal(arcPovValueCell(container).text, "Camille", "valeur brute affichée, sans libellé");
});

test("LOT4 finition Story Arc — aucun texte « Pov : », « pov : » ni « POV : » devant la valeur", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });

  const container = renderArc(view, root);
  const text = findAll(arcPovHost(container), (el) => typeof el.text === "string" && el.text.length > 0).map((el) => el.text).join(" | ");
  assert.equal(/^pov\s*:/i.test(arcPovValueCell(container).text), false, "la valeur brute est le seul texte de la ligne pov");
  assert.equal(text.includes("pov"), false, `aucun libellé « pov » dans la ligne pov (contenu : "${text}")`);
});

test("LOT4 finition Story Arc — clic sur « — » du pov : textarea vide", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {}; // pov absent
  const { view, root } = buildArcHarness({ children: [file] });

  const container = renderArc(view, root);
  const cell = arcPovValueCell(container);
  await cell.trigger("click");
  const area = findFirst(arcPovHost(container), (el) => el.tag === "textarea");
  assert.ok(area, "textarea créé au clic sur « — »");
  assert.equal(area.value, "", "textarea vide");
});

test("LOT4 finition Story Arc — sauvegarde « Deli » : setFm reçoit uniquement « Deli »", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };

  const container = renderArc(view, root);
  const cell = arcPovValueCell(container);
  await cell.trigger("click");
  const area = findFirst(arcPovHost(container), (el) => el.tag === "textarea");
  area.value = "Deli";
  await area.trigger("blur");

  assert.equal(setFmCalls[0].k, "pov");
  assert.equal(setFmCalls[0].v, "Deli", "setFm reçoit uniquement « Deli », sans icône ni libellé");
  assert.equal(cell.text, "Deli", "valeur brute affichée après sauvegarde");
});

test("LOT4 finition Story Arc — ni icône ni libellé n'entre dans textarea, setFm ou YAML", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Deli" };
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };

  const container = renderArc(view, root);
  const cell = arcPovValueCell(container);
  await cell.trigger("click");
  const area = findFirst(arcPovHost(container), (el) => el.tag === "textarea");
  assert.equal(area.value, "Deli", "textarea contient uniquement la valeur brute, jamais « Pov : Deli »");
  area.value = "Éloïse";
  await area.trigger("blur");
  assert.equal(setFmCalls[0].v, "Éloïse", "setFm reçoit uniquement la valeur brute");
  assert.equal(view.fm(file).pov, "Deli", "YAML brut 'pov' inchangé par l'affichage");
});

test("LOT4 finition Story Arc — Pov OFF : aucune ligne pov ni icône eye, donnée intacte", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });
  view.plugin.settings.arcsShowPov = false;

  const container = renderArc(view, root);
  assert.equal(arcPovHost(container), undefined, "aucune ligne .feuillets-arcs-pov");
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-meta-icon") && el.icon === "eye").length, 0, "aucune icône eye");
  // LOT 5 : les autres lignes d'information (Personnages, Fil) restent actives.
  assert.equal(arcCharactersIcon(container).icon, "users", "icône users conservée (ligne Personnages)");
  assert.equal(arcThreadIcon(container).icon, "route", "icône route conservée (ligne Fil)");
  assert.equal(view.fm(file).pov, "Camille", "donnée YAML pov intacte");
});

test("LOT4 finition Story Arc — suppression d'un pov : donnée vidée, option active → eye + « — »", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };

  const container = renderArc(view, root);
  const cell = arcPovValueCell(container);
  await cell.trigger("click");
  const area = findFirst(arcPovHost(container), (el) => el.tag === "textarea");
  area.value = ""; // effacement complet
  await area.trigger("blur");

  assert.equal(setFmCalls[0].k, "pov");
  assert.equal(setFmCalls[0].v, "", "setFm reçoit la valeur vide");
  assert.ok(arcPovHost(container), "option active : la ligne pov reste présente");
  assert.equal(arcPovIcon(container).icon, "eye", "icône eye conservée");
  assert.equal(arcPovValueCell(container).text, "—", "rendu final eye + « — »");
});

/* ===================== STORY ARC — options « Informations affichées » (finition LOT 4) ===================== */

test("LOT4/LOT5 finition options Story Arc — le menu distingue Trame et Couloirs", () => {
  const { view } = buildOptionsHarness();
  const context = {
    S: view.plugin.settings,
    meta: {},
    pType: "fiction",
    wholeManuscript: false,
    outlineColumns: {},
  };

  const trameMenu = new Menu();
  view.narrativeSubview = "trame";
  view.buildModeOptionsMenu(trameMenu, "arcs", context);
  assert.ok(menuItemTitles(trameMenu).includes("Dossier par dossier"));
  assert.ok(menuItemTitles(trameMenu).includes("Tout le manuscrit"));
  assert.deepEqual(menuItemTitles(trameMenu).slice(2), ["— Informations affichées —", "Synopsis", "Pov", "Personnages", "Fil"]);

  const lanesMenu = new Menu();
  view.narrativeSubview = "lanes";
  view.buildModeOptionsMenu(lanesMenu, "arcs", context);
  assert.equal(menuItemTitles(lanesMenu).includes("Dossier par dossier"), false);
  assert.equal(menuItemTitles(lanesMenu).includes("Tout le manuscrit"), false);
});

test("LOT4/LOT5 finition options Story Arc — arcsShowSynopsis/Pov/Characters/Threads sont true par défaut", () => {
  assert.equal(DEFAULT_SETTINGS.arcsShowSynopsis, true);
  assert.equal(DEFAULT_SETTINGS.arcsShowPov, true);
  assert.equal(DEFAULT_SETTINGS.arcsShowCharacters, true);
  assert.equal(DEFAULT_SETTINGS.arcsShowThreads, true, "arcsShowThreads présent et actif par défaut");
});

for (const [key, label] of [
  ["arcsShowSynopsis", "Synopsis"],
  ["arcsShowPov", "Pov"],
  ["arcsShowCharacters", "Personnages"],
  ["arcsShowThreads", "Fil"],
]) {
  test(`LOT4 finition options Story Arc — bascule « ${label} » : saveSettings + render(true)`, async () => {
    const { view, plugin } = buildOptionsHarness();
    plugin.settings[key] = true;
    let saved = 0;
    const renderCalls = [];
    plugin.saveSettings = async () => { saved++; };
    view.render = async (force) => { renderCalls.push(force); };

    const menu = new Menu();
    view.buildModeOptionsMenu(menu, "arcs", {
      S: plugin.settings,
      meta: {},
      pType: "fiction",
      wholeManuscript: false,
      outlineColumns: {},
    });

    const item = menu.items.find((i) => i.title === label);
    assert.ok(item, `option « ${label} » présente`);
    assert.equal(item.checked, true, `« ${label} » cochée par défaut`);
    // Désactivation : true → false
    await item.callback();
    assert.equal(plugin.settings[key], false, `« ${label} » basculée à false`);
    assert.equal(saved, 1, "persisté via saveSettings");
    assert.deepEqual(renderCalls, [true], `render(true) forcé pour « ${label} » (pas render non-forcé)`);
    // Réactivation : false → true
    await item.callback();
    assert.equal(plugin.settings[key], true, `« ${label} » basculée de nouveau à true`);
    assert.equal(saved, 2, "persisté à chaque bascule");
    assert.deepEqual(renderCalls, [true, true], `render(true) forcé à chaque bascule de « ${label} »`);
  });
}

/* ===================== STORY ARC — barre de filtres (finition LOT 4) ===================== */

test("LOT4 finition Story Arc — aucune donnée filtrable : aucune .feuillets-arcs-filter-bar", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {}; // ni label, ni personnage, ni fil, ni pov
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-filter-bar")).length, 0, "pas de barre de filtres");
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-row-file")), "les lignes restent visibles");
});

test("LOT4 finition Story Arc — présence d'un label : filter bar présente", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file], labels: { [file.path]: ["rouge"] } });
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "barre présente");
  assert.deepEqual(filterButtonIcons(container), ["map-pin"]);
});

test("LOT4 finition Story Arc — présence d'un personnage : filter bar présente", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Alice"] };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "barre présente");
  assert.deepEqual(filterButtonIcons(container), ["users"]);
});

test("LOT4 finition Story Arc — présence d'un fil : filter bar présente", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "filA" };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "barre présente");
  assert.deepEqual(filterButtonIcons(container), ["route"]);
});

test("LOT4 finition Story Arc — présence d'un pov : filter bar présente", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "barre présente");
  assert.deepEqual(filterButtonIcons(container), ["eye"]);
});

test("LOT4 finition Story Arc — arcsShowPov false + pov réel : filtre Pov toujours disponible", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { pov: "Camille" };
  const { view, root } = buildArcHarness({ children: [file] });
  view.plugin.settings.arcsShowPov = false; // masquage visuel uniquement
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "filtre Pov conservé");
  assert.deepEqual(filterButtonIcons(container), ["eye"]);
});

test("LOT4 finition Story Arc — arcsShowCharacters false + personnages réels : filtre Personnage toujours disponible", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Alice", "Bob"] };
  const { view, root } = buildArcHarness({ children: [file] });
  view.plugin.settings.arcsShowCharacters = false; // masquage visuel uniquement
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "filtre Personnage conservé");
  assert.deepEqual(filterButtonIcons(container), ["users"]);
});

/* ===================== STORY ARC — filtre obsolète : barre maintenue (micro-correctif final-v2) ===================== */

test("LOT4 final-v2 — filtre Pov obsolète : barre présente, bouton eye conservé", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {}; // plus aucun pov réel : Camille a été supprimé
  const { view, root } = buildArcHarness({ children: [file] });
  view.selectedPov = "Camille"; // sélection devenue obsolète
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "barre présente malgré zéro donnée filtrable");
  assert.deepEqual(filterButtonIcons(container), ["eye"]);
  const btn = findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-btn"));
  assert.ok(btn.classes.has("is-active"), "bouton marqué actif");
  assert.equal(findFirst(btn, (el) => el.classes.has("feuillets-arcs-filter-btn-label")).text, "Camille", "bouton affiche la valeur obsolète sélectionnée");
});

test("LOT4 final-v2 — filtre Personnage obsolète : bouton users conservé", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {}; // plus aucun personnage réel
  const { view, root } = buildArcHarness({ children: [file] });
  view.selectedPerso = "Alice";
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "barre présente");
  assert.deepEqual(filterButtonIcons(container), ["users"]);
});

test("LOT4 final-v2 — filtre Fil obsolète : bouton route conservé", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {}; // plus aucun fil réel
  const { view, root } = buildArcHarness({ children: [file] });
  view.selectedFil = "filA";
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "barre présente");
  assert.deepEqual(filterButtonIcons(container), ["route"]);
});

test("LOT4 final-v2 — filtre Label obsolète : bouton map-pin conservé", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {}; // plus aucun label réel
  const { view, root } = buildArcHarness({ children: [file] });
  view.selectedLabel = "rouge";
  const container = renderArc(view, root);
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "barre présente");
  assert.deepEqual(filterButtonIcons(container), ["map-pin"]);
});

test("LOT4 final-v2 — aucun filtre actif + aucune donnée filtrable : aucune barre", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  view.selectedPov = undefined;
  view.selectedLabel = undefined;
  view.selectedPerso = undefined;
  view.selectedFil = undefined;
  const container = renderArc(view, root);
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-filter-bar")).length, 0, "pas de barre de filtres");
});

test("LOT4 final-v2 — filtre obsolète remis à \"\" puis rendu sans données : aucune barre", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  view.selectedPov = "Camille";
  assert.ok(findFirst(renderArc(view, root), (el) => el.classes.has("feuillets-arcs-filter-bar")), "barre présente tant que le filtre est actif");
  view.selectedPov = ""; // « Tous » sélectionné : filtre retiré
  const container = renderArc(view, root);
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-filter-bar")).length, 0, "plus de barre sans données ni filtre actif");
});

/* ===================== STORY ARC — état vide (finition LOT 4) ===================== */

test("LOT4 finition Story Arc — un feuillet fm={} : aucun état vide global, titre visible", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-empty")).length, 0, "pas d'état vide global");
  assert.equal(findFirst(container, (el) => el.classes.has("feuillets-arcs-file-title")).text, "Scène", "titre visible");
});

test("LOT4/LOT5 finition Story Arc — fm={} avec toutes les options ON : « — » éditables sur les 4 lignes", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);

  const synCell = findFirst(arcSynopsisHost(container), (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(synCell.text, "—", "synopsis vide → « — »");
  assert.equal(arcPovIcon(container).icon, "eye", "icône eye présente");
  assert.equal(arcPovValueCell(container).text, "—", "pov vide → « — »");
  // LOT 5 : Personnages et Fil présents, valeurs vides → « — » (pas d'invention).
  assert.ok(arcCharactersHost(container), "ligne Personnages présente (option ON)");
  assert.equal(arcCharactersIcon(container).icon, "users", "icône users");
  assert.equal(arcCharactersCell(container).text, "—", "personnages vides → « — »");
  assert.ok(arcThreadHost(container), "ligne Fil présente (option ON)");
  assert.equal(arcThreadIcon(container).icon, "route", "icône route");
  assert.equal(arcThreadCell(container).text, "—", "fil vide → « — »");
});

test("LOT4/LOT5 finition Story Arc — fm={} avec toutes les options OFF : seulement le titre", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  view.plugin.settings.arcsShowSynopsis = false;
  view.plugin.settings.arcsShowPov = false;
  view.plugin.settings.arcsShowCharacters = false;
  view.plugin.settings.arcsShowThreads = false;
  const container = renderArc(view, root);

  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-file-title")), "titre présent");
  assert.equal(arcSynopsisHost(container), undefined, "aucun synopsis");
  assert.equal(arcPovHost(container), undefined, "aucune ligne pov");
  assert.equal(arcCharactersHost(container), undefined, "aucune ligne Personnages");
  assert.equal(arcThreadHost(container), undefined, "aucune ligne Fil");
});

/* ===================== i18n — typographie finale Pov / pov (LOT 4) ===================== */

test("LOT4 i18n — board.col.pov est le libellé autonome « Pov » (FR et EN)", () => {
  assert.equal(fr["board.col.pov"], "Pov");
  assert.equal(en["board.col.pov"], "Pov");
});

test("LOT4 i18n — board.arcs.povLine reste une clé de compatibilité « pov : {pov} » (FR) / « pov: {pov} » (EN)", () => {
  assert.equal(fr["board.arcs.povLine"], "pov : {pov}");
  assert.equal(en["board.arcs.povLine"], "pov: {pov}");
});

test("LOT4 i18n — board.arcs.povFilterName est le libellé autonome « Pov »", () => {
  assert.equal(fr["board.arcs.povFilterName"], "Pov");
  assert.equal(en["board.arcs.povFilterName"], "Pov");
});

test("LOT4 i18n — l'option Story Arc affiche le libellé autonome « Pov »", () => {
  assert.equal(fr["board.options.arcsShowPov"], "Pov");
  assert.equal(en["board.options.arcsShowPov"], "Pov");
});

test("LOT4 i18n — sidebar.project.mappingField.pov est le libellé autonome « Pov »", () => {
  assert.equal(fr["sidebar.project.mappingField.pov"], "Pov");
  assert.equal(en["sidebar.project.mappingField.pov"], "Pov");
});

test("LOT4 i18n — board.filter.povHeader contient « Pov » (majuscule initiale)", () => {
  assert.match(fr["board.filter.povHeader"], /Pov/);
  assert.match(en["board.filter.povHeader"], /Pov/);
  assert.equal(fr["board.filter.povHeader"].startsWith("— Pov"), true, "en-tête FR « — Pov — »");
  assert.equal(en["board.filter.povHeader"].startsWith("— Pov"), true, "en-tête EN « — Pov — »");
});

test("LOT4 i18n — board.filter.noPov contient « pov » minuscule dans la phrase", () => {
  assert.match(fr["board.filter.noPov"], /pov/);
  assert.match(en["board.filter.noPov"], /pov/);
  assert.equal(fr["board.filter.noPov"].includes("Pov"), false, "pas de majuscule hors début de phrase (FR)");
  assert.equal(en["board.filter.noPov"].includes("Pov"), false, "pas de majuscule hors début de phrase (EN)");
});

test("LOT4 i18n — board.card.editPov contient « pov » minuscule dans la phrase", () => {
  assert.match(fr["board.card.editPov"], /pov/);
  assert.match(en["board.card.editPov"], /pov/);
  assert.equal(fr["board.card.editPov"].includes("Pov"), false);
  assert.equal(en["board.card.editPov"].includes("Pov"), false);
});

test("LOT4 i18n — board.card.povFieldLabel contient « (pov) »", () => {
  assert.match(fr["board.card.povFieldLabel"], /\(pov\)/);
  assert.match(en["board.card.povFieldLabel"], /\(pov\)/);
});

test("LOT4 i18n — board.arcs.empty : « Aucun feuillet à afficher. » / « No sheets to display. »", () => {
  assert.equal(fr["board.arcs.empty"], "Aucun feuillet à afficher.");
  assert.equal(en["board.arcs.empty"], "No sheets to display.");
});

test("LOT4 i18n — board.outline.povPlaceholder est le libellé autonome « Pov… » (FR et EN)", () => {
  assert.equal(fr["board.outline.povPlaceholder"], "Pov…");
  assert.equal(en["board.outline.povPlaceholder"], "Pov…");
});

test("LOT4 i18n — les libellés visibles concernés ne contiennent plus « POV » en toutes capitales", () => {
  const visibleKeys = [
    "board.filter.noPov",
    "board.filter.povHeader",
    "board.filter.tooltip",
    "board.col.pov",
    "board.card.editPov",
    "board.card.povFieldLabel",
    "board.outline.povPlaceholder",
    "board.arcs.empty",
    "board.arcs.povFilterName",
    "board.arcs.povLine",
    "sidebar.project.mappingField.pov",
    "board.options.arcsShowPov",
  ];
  for (const key of visibleKeys) {
    assert.ok(fr[key], `${key} manque en FR`);
    assert.ok(en[key], `${key} manque en EN`);
    assert.equal(fr[key].includes("POV"), false, `FR ${key} ne doit plus contenir POV`);
    assert.equal(en[key].includes("POV"), false, `EN ${key} ne doit plus contenir POV`);
  }
});

/* ===================== PLAN — grammaire « — » des cellules vides (LOT 4) ===================== */

function outlineEditHarness({ fm = {}, cols = {} } = {}) {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = fm;
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = {
    synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: false, goal: false,
    ...cols,
  };
  return { file, view, root };
}

async function renderOutlineTable(view, root) {
  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);
  return table;
}

function outlineCellEditArea(table, colClass) {
  const cell = findFirst(table, (el) => el.classes.has(`feuillets-cell-${colClass}`));
  return findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
}

test("LOT4 Plan — Synopsis vide affiche exactement « — », cliquable", async () => {
  const { view, root } = outlineEditHarness({ fm: {}, cols: { synopsis: true } });
  const table = await renderOutlineTable(view, root);
  const editArea = outlineCellEditArea(table, "synopsis");
  assert.equal(editArea.text, "—", "synopsis vide affiché « — »");
  assert.ok(editArea.classes.has("is-empty"), "cellule marquée vide");
  assert.ok(editArea.events.has("click"), "« — » cliquable");
});

test("LOT4 Plan — clic sur « — » Synopsis → textarea vide, sauvegarde persistée", async () => {
  const { view, root } = outlineEditHarness({ fm: {}, cols: { synopsis: true } });
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };
  const table = await renderOutlineTable(view, root);
  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-synopsis"));
  const editArea = outlineCellEditArea(table, "synopsis");
  await editArea.trigger("click");
  const area = findFirst(cell, (el) => el.tag === "textarea");
  assert.ok(area, "textarea créé au clic sur « — »");
  assert.equal(area.value, "", "textarea vide");
  area.value = "Nouveau synopsis.";
  await area.trigger("blur");
  assert.equal(setFmCalls[0].k, "synopsis");
  assert.equal(setFmCalls[0].v, "Nouveau synopsis.", "sauvegarde persistée");
  assert.equal(editArea.text, "Nouveau synopsis.", "valeur remplie affichée ensuite");
});

test("LOT4 Plan — pov vide affiche exactement « — », cliquable", async () => {
  const { view, root } = outlineEditHarness({ fm: {}, cols: { pov: true } });
  const table = await renderOutlineTable(view, root);
  const editArea = outlineCellEditArea(table, "pov");
  assert.equal(editArea.text, "—", "pov vide affiché « — »");
  assert.ok(editArea.classes.has("is-empty"), "cellule marquée vide");
  assert.ok(editArea.events.has("click"), "« — » cliquable");
});

test("LOT4 Plan — clic sur « — » pov → textarea vide, sauvegarde persistée", async () => {
  const { view, root } = outlineEditHarness({ fm: {}, cols: { pov: true } });
  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };
  const table = await renderOutlineTable(view, root);
  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-pov"));
  const editArea = outlineCellEditArea(table, "pov");
  await editArea.trigger("click");
  const area = findFirst(cell, (el) => el.tag === "textarea");
  assert.ok(area, "textarea créé au clic sur « — »");
  assert.equal(area.value, "", "textarea vide");
  area.value = "Deli";
  await area.trigger("blur");
  assert.equal(setFmCalls[0].k, "pov");
  assert.equal(setFmCalls[0].v, "Deli", "sauvegarde persistée");
  assert.equal(editArea.text, "Deli", "valeur brute affichée après saisie");
});

test("LOT4 Plan — valeur Synopsis existante reste affichée normalement", async () => {
  const { view, root } = outlineEditHarness({ fm: { synopsis: "Résumé court." }, cols: { synopsis: true } });
  const table = await renderOutlineTable(view, root);
  const editArea = outlineCellEditArea(table, "synopsis");
  assert.equal(editArea.text, "Résumé court.", "synopsis existant affiché tel quel");
  assert.equal(editArea.classes.has("is-empty"), false, "cellule non marquée vide");
});

test("LOT4 Plan — valeur pov existante reste affichée normalement", async () => {
  const { view, root } = outlineEditHarness({ fm: { pov: "Camille" }, cols: { pov: true } });
  const table = await renderOutlineTable(view, root);
  const editArea = outlineCellEditArea(table, "pov");
  assert.equal(editArea.text, "Camille", "pov existant affiché tel quel");
  assert.equal(editArea.classes.has("is-empty"), false, "cellule non marquée vide");
});

/* ===================== CSS — neutralisation hover + pre-wrap (LOT 4) ===================== */

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

test("LOT4 CSS — .feuillets-arcs-row-file:hover n'existe plus (la ligne entière n'est plus cliquable)", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  assert.equal(css.includes(".feuillets-arcs-row-file:hover"), false, "règle .feuillets-arcs-row-file:hover supprimée");
  // La ligne garde son bloc de base (flex), sans fond de survol global.
  assert.match(css, /\.feuillets-arcs-row-file\s*\{\s*display:\s*flex;/);
});

test("LOT4 CSS — hover des cellules Plan/Story Arc/Chronologie neutralisé, hover global conservé, sans !important", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  // Le hover global reste actif pour les autres vues (Cartes, Notes…).
  assert.match(css, /\.feuillets-flat-text-cell:hover\s*\{\s*background:\s*var\(--background-modifier-hover\);\s*\}/);
  // Chaque sélecteur local de neutralisation est présent (Plan, Synopsis,
  // Personnages, Fil, pov, Chronologie).
  for (const selector of [
    ".feuillets-outline .feuillets-flat-text-cell:hover",
    ".feuillets-outline-wrap .feuillets-flat-text-cell:hover",
    ".feuillets-arcs-file-synopsis > .feuillets-flat-text-cell:hover",
    ".feuillets-arcs-personnages > .feuillets-arcs-meta-value > .feuillets-flat-text-cell:hover",
    ".feuillets-arcs-thread > .feuillets-arcs-meta-value > .feuillets-flat-text-cell:hover",
    ".feuillets-arcs-pov > .feuillets-arcs-meta-value > .feuillets-flat-text-cell:hover",
    ".feuillets-timeline-syn > .feuillets-flat-text-cell:hover",
  ]) {
    assert.ok(css.includes(selector.replace(/\s+/g, " ")), `sélecteur présent : ${selector}`);
  }
  // Le bloc partagé de neutralisation passe à transparent, sans !important.
  const block = css.match(/\.feuillets-timeline-syn\s*>\s*\.feuillets-flat-text-cell:hover\s*\{\s*background:\s*transparent;\s*\}/);
  assert.ok(block, "bloc de neutralisation à transparent");
  assert.equal(block[0].includes("!important"), false, "aucun !important");
});

test("LOT4 CSS — les styles pov (flex, icône 13px, valeur flexible) sont présents, aucune couleur codée en dur", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  assert.match(css, /\.feuillets-arcs-pov\s*\{\s*display:\s*flex;\s*align-items:\s*center;\s*gap:\s*var\(--size-4-1\);/);
  assert.match(css, /\.feuillets-arcs-meta-icon\s*\{\s*display:\s*flex;\s*align-items:\s*center;\s*flex-shrink:\s*0;\s*color:\s*inherit;\s*\}/);
  assert.match(css, /\.feuillets-arcs-meta-icon\s*\.svg-icon\s*\{\s*width:\s*13px;\s*height:\s*13px;\s*\}/);
  assert.match(css, /\.feuillets-arcs-meta-value\s*\{\s*min-width:\s*0;\s*flex:\s*1;\s*\}/);
  assert.match(css, /\.feuillets-arcs-meta-value\s*>\s*\.feuillets-flat-text-cell\s*\{\s*font-size:\s*inherit;\s*color:\s*inherit;\s*line-height:\s*inherit;\s*padding:\s*0;\s*\}/);
});

test("LOT4 CSS — Synopsis Story Arc et Chronologie : white-space pre-wrap (wrap auto + retours manuels)", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  assert.match(css, /\.feuillets-arcs-file-synopsis\s*>\s*\.feuillets-flat-text-cell[^{]*\{\s*[^}]*white-space:\s*pre-wrap;/);
  assert.match(css, /\.feuillets-timeline-syn\s*>\s*\.feuillets-flat-text-cell[^{]*\{\s*[^}]*white-space:\s*pre-wrap;/);
});

test("LOT4/LOT5 CSS — aucune règle !important dans les blocs arcs récents (row-file, synopsis, pov, meta, personnages, thread)", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  const blocks = css.split("}").filter((b) => /\.feuillets-arcs-(row-file|file-synopsis|pov|meta-|personnages|thread)/.test(b));
  for (const block of blocks) {
    assert.equal(block.includes("!important"), false, `aucun !important dans : ${block.trim().slice(0, 80)}`);
  }
});

test("LOT4 CSS — grammaire commune des cellules du Plan : alignement, typographie héritée, min-height, jamais de hauteur fixe (§33)", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  // Bloc partagé : toutes les cellules des lignes Plan (vue et wrap)
  // s'alignent verticalement, en box-sizing border-box et en typographie
  // héritée de la ligne — uniforme avec Label/Date/Mots/Objectif.
  const shared = css.match(/\.feuillets-outline \.feuillets-cell,.*?\}/s)?.[0] ?? "";
  assert.ok(shared, "bloc partagé des cellules Plan présent");
  assert.match(shared, /box-sizing:\s*border-box/, "box-sizing border-box");
  assert.match(shared, /align-items:\s*center/, "alignement vertical centré");
  assert.match(shared, /font-size:\s*inherit/, "font-size héritée");
  assert.match(shared, /line-height:\s*inherit/, "line-height héritée");
  assert.equal(shared.includes("!important"), false, "aucun !important");
  assert.equal(/(^|;)\s*height:/.test(shared), false, "aucune hauteur fixe dans le bloc partagé");

  // Titre et valeurs « cliquer pour écrire » : typographie héritée, plus de
  // padding vertical qui gonflerait la ligne au-dessus de ses voisines.
  const values = css.match(/\.feuillets-outline \.feuillets-cell \.feuillets-flat-text-cell,.*?\}/s)?.[0] ?? "";
  assert.ok(values, "bloc titre/valeurs présent");
  assert.match(values, /font-size:\s*inherit/, "titre/valeurs : font-size héritée");
  assert.match(values, /line-height:\s*inherit/, "titre/valeurs : line-height héritée");
  assert.match(values, /padding-top:\s*0/, "titre/valeurs : padding-top 0");
  assert.match(values, /padding-bottom:\s*0/, "titre/valeurs : padding-bottom 0");

  // La ligne grandit naturellement : min-height (22px), jamais height fixe.
  const rowBlock = css.match(/\.feuillets-row\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(rowBlock, "bloc .feuillets-row présent");
  assert.match(rowBlock, /min-height:\s*22px/, "la ligne Plan croît par min-height");
  assert.equal(/(^|;)\s*height:/.test(rowBlock), false, "aucune hauteur fixe destructrice sur les lignes");
});

test("LOT4 CSS — édition inline SANS BOX, scopée .feuillets-board-container (rename, textarea, objectif) (§24/§25/§34)", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  // Un SEUL bloc partagé gouverne les trois éditeurs inline : renommage
  // short_title, textareas cliquer-pour-écrire (Synopsis/Date/…) et input
  // Objectif. Il est scopé sous .feuillets-board-container (Plan, Cartes,
  // Chemin de fer/Trame, Chronologie) — jamais le Binder.
  const shared = css.match(/\.feuillets-board-container input\.feuillets-inline-rename,.*?\}/s)?.[0] ?? "";
  assert.ok(shared, "bloc partagé des éditeurs inline présent");
  assert.match(shared, /background:\s*transparent/, "fond transparent (pas de formulaire)");
  assert.match(shared, /border:\s*0/, "aucune bordure");
  assert.match(shared, /box-shadow:\s*none/, "aucune ombre");
  assert.match(shared, /border-radius:\s*0/, "pas de coins de boîte");
  assert.match(shared, /padding:\s*0/, "aucun padding qui gonflerait la ligne");
  assert.match(shared, /font:\s*inherit/, "typographie héritée");
  assert.match(shared, /line-height:\s*inherit/, "hauteur de ligne héritée");
  assert.equal(shared.includes("!important"), false, "aucun !important");
  // Les trois sélecteurs sont bien DANS ce bloc scopé.
  assert.ok(shared.includes(".feuillets-board-container input.feuillets-inline-rename"), "rename scopé");
  assert.ok(shared.includes(".feuillets-board-container textarea.feuillets-flat-textarea"), "textarea scopé");
  assert.ok(shared.includes(".feuillets-board-container input.feuillets-goal-input"), "goal scopé");

  // Le focus ne rétablit PAS la boîte : le caret signale l'édition.
  const focusBlock = css.match(/\.feuillets-board-container input\.feuillets-inline-rename:focus,.*?\}/s)?.[0] ?? "";
  assert.ok(focusBlock, "bloc :focus présent");
  assert.match(focusBlock, /background:\s*transparent/, "focus : toujours transparent");
  assert.match(focusBlock, /border-color:\s*transparent/, "focus : bordure toujours invisible");
  assert.match(focusBlock, /box-shadow:\s*none/, "focus : aucune ombre");
  assert.equal(focusBlock.includes("!important"), false, "aucun !important au focus");

  // Aucun sélecteur GLOBAL input { } / textarea { } introduit (tout reste scopé).
  assert.equal(/^\s*input\s*\{/m.test(css), false, "aucun sélecteur global input {");
  assert.equal(/^\s*textarea\s*\{/m.test(css), false, "aucun sélecteur global textarea {");
});

/* ===================== STORY ARC — Personnages et Fil éditables (LOT 5) ===================== */

/* §25 — parseCsvList : normalisation CSV des listes Personnages/Fil. */

test("LOT5 parseCsvList — « Kemal, Arif » → [Kemal, Arif]", () => {
  assert.deepEqual(parseCsvList("Kemal, Arif"), ["Kemal", "Arif"]);
});

test("LOT5 parseCsvList — espaces autour des virgules ignorés", () => {
  assert.deepEqual(parseCsvList(" Kemal , Arif "), ["Kemal", "Arif"]);
});

test("LOT5 parseCsvList — entrées vides supprimées", () => {
  assert.deepEqual(parseCsvList(" Kemal, , Arif, "), ["Kemal", "Arif"]);
});

test("LOT5 parseCsvList — doublons exacts supprimés, première occurrence conservée", () => {
  assert.deepEqual(parseCsvList("Kemal, Arif, Kemal"), ["Kemal", "Arif"]);
});

test("LOT5 parseCsvList — ordre préservé, jamais de tri alphabétique", () => {
  assert.deepEqual(parseCsvList("Arif, Kemal, Sophie"), ["Arif", "Kemal", "Sophie"]);
});

test("LOT5 parseCsvList — chaîne vide → []", () => {
  assert.deepEqual(parseCsvList(""), []);
  assert.deepEqual(parseCsvList("   "), []);
});

/* §12 — listsEqual : mêmes longueur, éléments et ordre. */

test("LOT5 listsEqual — vrai pour listes identiques (vide comprise), faux sinon", () => {
  assert.equal(listsEqual([], []), true);
  assert.equal(listsEqual(["Kemal"], ["Kemal"]), true);
  assert.equal(listsEqual(["Kemal", "Arif"], ["Kemal", "Arif"]), true);
  assert.equal(listsEqual(["Kemal", "Arif"], ["Arif", "Kemal"]), false, "l'ordre compte");
  assert.equal(listsEqual(["Kemal", "Arif"], ["Kemal"]), false, "la longueur compte");
  assert.equal(listsEqual([], ["Kemal"]), false, "la liste vide ne vaut que []");
});

/* §26 — Personnages : ligne users + valeur CSV éditable. */

test("LOT5 Personnages — option ON + présents : ligne, icône users, valeur jointe", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal", "Arif"] };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  assert.ok(arcCharactersHost(container), "ligne Personnages présente (option ON)");
  assert.equal(arcCharactersIcon(container).icon, "users", "icône Lucide « users »");
  assert.equal(arcCharactersCell(container).text, "Kemal, Arif", "personnages joints par « , », sans « Avec »");
});

test("LOT5 Personnages — option ON + aucun : ligne présente, users + « — »", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  assert.ok(arcCharactersHost(container), "ligne Personnages présente (option ON)");
  assert.equal(arcCharactersIcon(container).icon, "users", "icône users");
  assert.equal(arcCharactersCell(container).text, "—", "aucun personnage → « — »");
});

test("LOT5 Personnages — option OFF : aucune ligne, donnée intacte", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal"] };
  const { view, root } = buildArcHarness({ children: [file] });
  view.plugin.settings.arcsShowCharacters = false;
  const container = renderArc(view, root);
  assert.equal(arcCharactersHost(container), undefined, "aucune ligne Personnages");
  assert.equal(view.fm(file).characters[0], "Kemal", "donnée YAML intacte");
});

test("LOT5 Personnages — clic sur « — » : textarea vide", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  await arcCharactersCell(container).trigger("click");
  const area = findFirst(arcCharactersHost(container), (el) => el.tag === "textarea");
  assert.ok(area, "textarea créé au clic sur « — »");
  assert.equal(area.value, "", "textarea vide");
});

test("LOT5 Personnages — clic sur une valeur existante : textarea pré-rempli", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal", "Arif"] };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  await arcCharactersCell(container).trigger("click");
  const area = findFirst(arcCharactersHost(container), (el) => el.tag === "textarea");
  assert.equal(area.value, "Kemal, Arif", "textarea pré-rempli, jamais « Personnages : … »");
});

test("LOT5 Personnages — modification réelle : setFm(characters, tableau normalisé) + render(true)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal"] };
  const { view, root } = buildArcHarness({ children: [file] });
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };
  view.render = async (force) => { renderCalls.push(force); };

  const container = renderArc(view, root);
  await arcCharactersCell(container).trigger("click");
  const area = findFirst(arcCharactersHost(container), (el) => el.tag === "textarea");
  area.value = "Kemal, Arif, Kemal"; // doublon à nettoyer
  await area.trigger("blur");

  assert.equal(setFmCalls.length, 1, "setFm appelé une seule fois");
  assert.equal(setFmCalls[0].k, "characters", "clé logique characters");
  assert.deepEqual(setFmCalls[0].v, ["Kemal", "Arif"], "setFm reçoit le tableau normalisé (doublon retiré)");
  assert.deepEqual(renderCalls, [true], "render(true) déclenché après modification");
});

test("LOT5 Personnages — valeur inchangée : aucun setFm ni render", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal", "Arif"] };
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = 0;
  let renderCalls = 0;
  view.setFm = async () => { setFmCalls++; };
  view.render = async () => { renderCalls++; };

  const container = renderArc(view, root);
  await arcCharactersCell(container).trigger("click");
  const area = findFirst(arcCharactersHost(container), (el) => el.tag === "textarea");
  area.value = "Kemal, Arif"; // inchangé
  await area.trigger("blur");

  assert.equal(setFmCalls, 0, "aucun setFm si valeur inchangée");
  assert.equal(renderCalls, 0, "aucun render inutile");
});

test("LOT5 Personnages — suppression complète : setFm(characters, []), render, nouveau rendu users + « — »", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal"] };
  const { view, root } = buildArcHarness({ children: [file] });
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); f.__fm = { ...f.__fm, [k]: v }; };
  view.render = async (force) => { renderCalls.push(force); };

  const container = renderArc(view, root);
  await arcCharactersCell(container).trigger("click");
  const area = findFirst(arcCharactersHost(container), (el) => el.tag === "textarea");
  area.value = ""; // effacement complet
  await area.trigger("blur");

  assert.equal(setFmCalls[0].k, "characters", "clé logique characters");
  assert.deepEqual(setFmCalls[0].v, [], "setFm reçoit [] pour vider");
  assert.deepEqual(renderCalls, [true], "render(true) déclenché");

  // Nouveau rendu sur le frontmatter mis à jour : ligne conservée, « — ».
  const c2 = renderArc(view, root);
  assert.ok(arcCharactersHost(c2), "option active : ligne Personnages présente");
  assert.equal(arcCharactersIcon(c2).icon, "users", "icône users conservée");
  assert.equal(arcCharactersCell(c2).text, "—", "rendu final users + « — »");
});

test("LOT5 Personnages — ancien YAML chaîne + validation identique : aucune écriture", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: "Kemal, Arif" }; // forme physique ancienne
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = 0;
  view.setFm = async () => { setFmCalls++; };

  const container = renderArc(view, root);
  assert.equal(arcCharactersCell(container).text, "Kemal, Arif", "chaîne lue comme liste et jointe");
  await arcCharactersCell(container).trigger("click");
  const area = findFirst(arcCharactersHost(container), (el) => el.tag === "textarea");
  area.value = "Kemal, Arif"; // identique à la lecture
  await area.trigger("blur");

  assert.equal(setFmCalls, 0, "aucune migration ni écriture si la liste est identique");
});

/* §27 — Fil : ligne route + valeur CSV éditable, même grammaire. */

test("LOT5 Fil — option ON + présents : ligne, icône route, valeur jointe", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "Enquête, Héritage" };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  assert.ok(arcThreadHost(container), "ligne Fil présente (option ON)");
  assert.equal(arcThreadIcon(container).icon, "route", "icône Lucide « route »");
  assert.equal(arcThreadCell(container).text, "Enquête, Héritage", "fils joints par « , », sans « Fil : »");
});

test("LOT5 Fil — option ON + aucun : ligne présente, route + « — »", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  assert.ok(arcThreadHost(container), "ligne Fil présente (option ON)");
  assert.equal(arcThreadIcon(container).icon, "route", "icône route");
  assert.equal(arcThreadCell(container).text, "—", "aucun fil → « — »");
});

test("LOT5 Fil — option OFF : aucune ligne, donnée intacte", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "Enquête" };
  const { view, root } = buildArcHarness({ children: [file] });
  view.plugin.settings.arcsShowThreads = false;
  const container = renderArc(view, root);
  assert.equal(arcThreadHost(container), undefined, "aucune ligne Fil");
  assert.equal(view.fm(file).thread, "Enquête", "donnée YAML intacte");
});

test("LOT5 Fil — clic sur « — » : textarea vide", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  await arcThreadCell(container).trigger("click");
  const area = findFirst(arcThreadHost(container), (el) => el.tag === "textarea");
  assert.ok(area, "textarea créé au clic sur « — »");
  assert.equal(area.value, "", "textarea vide");
});

test("LOT5 Fil — clic sur une valeur existante : textarea pré-rempli", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: ["Enquête", "Héritage"] };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  await arcThreadCell(container).trigger("click");
  const area = findFirst(arcThreadHost(container), (el) => el.tag === "textarea");
  assert.equal(area.value, "Enquête, Héritage", "textarea pré-rempli, jamais « Fil : … »");
});

test("LOT5 Fil — modification réelle : setFm(thread, tableau normalisé) + render(true)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "Enquête" };
  const { view, root } = buildArcHarness({ children: [file] });
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };
  view.render = async (force) => { renderCalls.push(force); };

  const container = renderArc(view, root);
  await arcThreadCell(container).trigger("click");
  const area = findFirst(arcThreadHost(container), (el) => el.tag === "textarea");
  area.value = "Héritage, Enquête"; // ordre préservé tel quel
  await area.trigger("blur");

  assert.equal(setFmCalls.length, 1, "setFm appelé une seule fois");
  assert.equal(setFmCalls[0].k, "thread", "clé logique thread");
  assert.deepEqual(setFmCalls[0].v, ["Héritage", "Enquête"], "ordre saisi conservé (pas de tri)");
  assert.deepEqual(renderCalls, [true], "render(true) déclenché après modification");
});

test("LOT5 Fil — valeur inchangée : aucun setFm ni render", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "Enquête" };
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = 0;
  let renderCalls = 0;
  view.setFm = async () => { setFmCalls++; };
  view.render = async () => { renderCalls++; };

  const container = renderArc(view, root);
  await arcThreadCell(container).trigger("click");
  const area = findFirst(arcThreadHost(container), (el) => el.tag === "textarea");
  area.value = "Enquête"; // inchangé
  await area.trigger("blur");

  assert.equal(setFmCalls, 0, "aucun setFm si valeur inchangée");
  assert.equal(renderCalls, 0, "aucun render inutile");
});

test("LOT5 Fil — suppression complète : setFm(thread, []), render, nouveau rendu route + « — »", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "Enquête" };
  const { view, root } = buildArcHarness({ children: [file] });
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); f.__fm = { ...f.__fm, [k]: v }; };
  view.render = async (force) => { renderCalls.push(force); };

  const container = renderArc(view, root);
  await arcThreadCell(container).trigger("click");
  const area = findFirst(arcThreadHost(container), (el) => el.tag === "textarea");
  area.value = ""; // effacement complet
  await area.trigger("blur");

  assert.equal(setFmCalls[0].k, "thread", "clé logique thread");
  assert.deepEqual(setFmCalls[0].v, [], "setFm reçoit [] pour vider");
  assert.deepEqual(renderCalls, [true], "render(true) déclenché");

  // Nouveau rendu : ligne conservée, « — », plus aucun rail de fil.
  const c2 = renderArc(view, root);
  assert.ok(arcThreadHost(c2), "option active : ligne Fil présente");
  assert.equal(arcThreadIcon(c2).icon, "route", "icône route conservée");
  assert.equal(arcThreadCell(c2).text, "—", "rendu final route + « — »");
  assert.equal(findAll(c2, (el) => el.classes.has("feuillets-arcs-dot-fil")).length, 0, "aucun rail Fil restant");
});

test("LOT5 Fil — ancien YAML chaîne + validation identique : aucune écriture", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "Enquête, Héritage" }; // forme physique ancienne (fil:)
  const { view, root } = buildArcHarness({ children: [file] });
  let setFmCalls = 0;
  view.setFm = async () => { setFmCalls++; };

  const container = renderArc(view, root);
  assert.equal(arcThreadCell(container).text, "Enquête, Héritage", "chaîne lue comme liste et jointe");
  await arcThreadCell(container).trigger("click");
  const area = findFirst(arcThreadHost(container), (el) => el.tag === "textarea");
  area.value = "Enquête, Héritage"; // identique à la lecture
  await area.trigger("blur");

  assert.equal(setFmCalls, 0, "aucune migration ni écriture si la liste est identique");
});

/* §28 — rerendu et filtres : après une vraie modification, les données
   logiques relues alimentent ligne, filtres et rails. */

test("LOT5 rerendu — ajout d'un personnage : setFm persiste, nouveau rendu met ligne et filtre à jour", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal"] };
  const { view, root } = buildArcHarness({ children: [file] });
  view.setFm = async (f, k, v) => { f.__fm = { ...f.__fm, [k]: v }; };
  view.render = async () => {};

  const c1 = renderArc(view, root);
  assert.ok(findFirst(c1, (el) => el.classes.has("feuillets-arcs-filter-btn")), "filtre Personnage présent");

  await arcCharactersCell(c1).trigger("click");
  const area = findFirst(arcCharactersHost(c1), (el) => el.tag === "textarea");
  area.value = "Kemal, Arif";
  await area.trigger("blur");

  // Nouveau rendu sur le frontmatter logique mis à jour.
  const c2 = renderArc(view, root);
  assert.equal(arcCharactersCell(c2).text, "Kemal, Arif", "ligne à jour après render");
  assert.equal(filterButtonIcons(c2).includes("users"), true, "filtre Personnage conservé");
});

test("LOT5 rerendu — ajout d'un fil : setFm persiste, nouveau rendu met ligne, filtre et rail à jour", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "Enquête" };
  const { view, root } = buildArcHarness({ children: [file] });
  view.setFm = async (f, k, v) => { f.__fm = { ...f.__fm, [k]: v }; };
  view.render = async () => {};

  const c1 = renderArc(view, root);
  assert.ok(findFirst(c1, (el) => el.classes.has("feuillets-arcs-filter-btn")), "filtre Fil présent");
  assert.equal(findAll(c1, (el) => el.classes.has("feuillets-arcs-dot-fil")).length, 1, "rail Fil présent");

  await arcThreadCell(c1).trigger("click");
  const area = findFirst(arcThreadHost(c1), (el) => el.tag === "textarea");
  area.value = "Enquête, Héritage";
  await area.trigger("blur");

  const c2 = renderArc(view, root);
  assert.equal(arcThreadCell(c2).text, "Enquête, Héritage", "ligne à jour après render");
  assert.equal(filterButtonIcons(c2).includes("route"), true, "filtre Fil conservé");
  assert.equal(findAll(c2, (el) => el.classes.has("feuillets-arcs-dot-fil")).length, 2, "rail Fil à jour");
});

test("LOT5 rerendu — arcsShowThreads false + fils réels : filtre Fil et rails toujours disponibles", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "Enquête" };
  const { view, root } = buildArcHarness({ children: [file] });
  view.plugin.settings.arcsShowThreads = false;
  const container = renderArc(view, root);
  assert.equal(arcThreadHost(container), undefined, "aucune ligne Fil (masquage visuel seul)");
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "filtre Fil conservé");
  assert.equal(filterButtonIcons(container).includes("route"), true, "bouton de filtre Fil présent");
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-arcs-dot-fil")).length, 1, "rail Fil conservé");
});

test("LOT5 rerendu — arcsShowCharacters false + personnages réels : filtre Personnage toujours disponible", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal"] };
  const { view, root } = buildArcHarness({ children: [file] });
  view.plugin.settings.arcsShowCharacters = false;
  const container = renderArc(view, root);
  assert.equal(arcCharactersHost(container), undefined, "aucune ligne Personnages");
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar")), "filtre Personnage conservé");
  assert.equal(filterButtonIcons(container).includes("users"), true, "bouton de filtre Personnage présent");
});

/* §29 — options : toutes couvertes par les tests LOT4/LOT5 mis à jour
   (défaut arcsShowThreads=true, ordre du menu, bascule Fil → saveSettings +
   render(true) dans la boucle, les trois options existantes inchangées). */

/* §30 — DOM / icônes : jamais de libellé textuel, icône jamais détruite. */

test("LOT5 DOM — aucune chaîne « Avec » dans la ligne Personnages", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Alice", "Bob"] };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  const host = arcCharactersHost(container);
  const texts = findAll(host, (el) => typeof el.text === "string" && el.text.length > 0).map((el) => el.text);
  assert.equal(texts.some((t) => t.includes("Avec")), false, `aucun « Avec … » dans la ligne (contenu : ${texts.join(" | ")})`);
  assert.equal(arcCharactersCell(container).text, "Alice, Bob", "la valeur brute est le seul texte de la ligne");
});

test("LOT5 DOM — aucun libellé « Personnages » / « Personnages : » devant la valeur", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal"] };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  const host = arcCharactersHost(container);
  const texts = findAll(host, (el) => typeof el.text === "string" && el.text.length > 0).map((el) => el.text);
  assert.equal(texts.some((t) => /^personnages/i.test(t.trim())), false, `aucun libellé « Personnages : » (contenu : ${texts.join(" | ")})`);
  assert.equal(arcCharactersCell(container).text, "Kemal", "valeur brute seule, sans libellé");
});

test("LOT5 DOM — aucun libellé « Fil » / « Fil : » devant la valeur", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { thread: "Enquête" };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);
  const host = arcThreadHost(container);
  const texts = findAll(host, (el) => typeof el.text === "string" && el.text.length > 0).map((el) => el.text);
  assert.equal(texts.some((t) => /^fil/i.test(t.trim())), false, `aucun libellé « Fil : » (contenu : ${texts.join(" | ")})`);
  assert.equal(arcThreadCell(container).text, "Enquête", "valeur brute seule, sans libellé");
});

test("LOT5 DOM — l'icône ne disparaît jamais pendant l'édition de la valeur", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal"], thread: "Enquête" };
  const { view, root } = buildArcHarness({ children: [file] });
  const container = renderArc(view, root);

  // Personnages : iconHost et valueHost sont frères.
  const host = arcCharactersHost(container);
  const iconHost = findFirst(host, (el) => el.classes.has("feuillets-arcs-meta-icon"));
  const valueHost = findFirst(host, (el) => el.classes.has("feuillets-arcs-meta-value"));
  assert.ok(iconHost && valueHost, "iconHost et valueHost présents");
  assert.equal(valueHost.children.includes(iconHost), false, "l'icône n'est pas dans la cellule éditée");

  await arcCharactersCell(container).trigger("click");
  const area = findFirst(host, (el) => el.tag === "textarea");
  assert.ok(area, "textarea dans valueHost");
  assert.equal(iconHost.children.includes(area), false, "le textarea n'est pas dans l'iconHost");
  assert.equal(arcCharactersIcon(container).icon, "users", "icône users toujours présente pendant l'édition");

  // Fil : même structure.
  const threadHost = arcThreadHost(container);
  const threadIconHost = findFirst(threadHost, (el) => el.classes.has("feuillets-arcs-meta-icon"));
  const threadValueHost = findFirst(threadHost, (el) => el.classes.has("feuillets-arcs-meta-value"));
  assert.ok(threadIconHost && threadValueHost, "iconHost et valueHost du Fil présents");
  assert.equal(threadValueHost.children.includes(threadIconHost), false, "l'icône route hors de la cellule");
});

/* §31 — anti-doublons (intégration légère) : makeClickToEditFmList ne passe à
   setFm que les clés LOGIQUES characters/thread, jamais un alias physique. */

test("LOT5 anti-doublons — setFm reçoit uniquement les clés logiques characters/thread", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildArcHarness({ children: [file] });
  const setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };

  const container = renderArc(view, root);
  await arcCharactersCell(container).trigger("click");
  const charsArea = findFirst(arcCharactersHost(container), (el) => el.tag === "textarea");
  charsArea.value = "Kemal, Arif";
  await charsArea.trigger("blur");

  await arcThreadCell(container).trigger("click");
  const threadArea = findFirst(arcThreadHost(container), (el) => el.tag === "textarea");
  threadArea.value = "Enquête, Héritage";
  await threadArea.trigger("blur");

  assert.deepEqual(setFmCalls.map((c) => c.k), ["characters", "thread"], "clés logiques uniquement — jamais personnages/persos/fil");
  assert.deepEqual(setFmCalls[0].v, ["Kemal", "Arif"], "valeur personnages normalisée");
  assert.deepEqual(setFmCalls[1].v, ["Enquête", "Héritage"], "valeur fil normalisée");
});

/* CSS — grammaire flex de Personnages et Fil (même que pov). */

test("LOT5 CSS — Personnages et Fil : flex row, gap Obsidian, aucune couleur codée en dur", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  assert.match(css, /\.feuillets-arcs-personnages,\s*\.feuillets-arcs-thread\s*\{\s*display:\s*flex;\s*align-items:\s*center;\s*gap:\s*var\(--size-4-1\);/);
  assert.match(css, /\.feuillets-arcs-meta-icon\s*\.svg-icon\s*\{\s*width:\s*13px;\s*height:\s*13px;\s*\}/);
  assert.match(css, /\.feuillets-arcs-meta-value\s*>\s*\.feuillets-flat-text-cell\s*\{\s*font-size:\s*inherit;\s*color:\s*inherit;\s*line-height:\s*inherit;\s*padding:\s*0;\s*\}/);
  // Le bloc flex Personnages/Fil n'emploie que des variables Obsidian, jamais
  // une couleur hex/rgb codée en dur.
  const block = css.split("}").find((b) => b.includes(".feuillets-arcs-personnages") && b.includes(".feuillets-arcs-thread"));
  assert.ok(block, "bloc flex Personnages/Fil présent");
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(block), false, "aucune couleur hex dans le bloc Personnages/Fil");
  assert.equal(/rgb\(/.test(block), false, "aucune couleur rgb() dans le bloc Personnages/Fil");
});

/* ===================== LOT 5C — COULOIRS (sous-vue « lanes ») =====================
   Couloirs n'est PAS un mode : c'est une sous-vue de l'espace narratif
   (arcs), pilotée par l'état de SESSION narrativeSubview ("trame" | "lanes")
   et laneAxis ("label" | "character" | "thread" | "pov", ordre
   imposé). Registre de lignes en mémoire (jamais retiré), drag qui ne
   modifie QUE le champ d'axe (label/characters/thread/pov), cartes
   RECTANGULAIRES opaques numéro+titre sur une ligne + synopsis (max 3
   lignes). La barre d'axe vit dans le contenu Couloirs (même grammaire que
   la barre de filtres Trame) ; la barre narrative ne porte qu'un sélecteur
   compact de sous-vue. */

function mkLaneFile(name, fm) {
  const file = new TFile(`Projet/Manuscrit/${name}.md`);
  file.__fm = fm || {};
  return file;
}

function buildLanesHarness({ files = [], appOverride = {} } = {}) {
  const root = new TFolder("Projet/Manuscrit");
  root.children = files;
  for (const f of files) f.parent = root;
  const leaf = { openFile: async () => {} };
  const app = {
    workspace: { getLeaf: () => leaf, setActiveLeaf: () => {} },
    vault: { getAbstractFileByPath: (path) => files.find((f) => f.path === path) || null },
    ...appOverride,
  };
  const plugin = {
    settings: {},
    flattenFiles: (folder) => (folder === root ? files : []),
    isFrontMatter: () => false,
    fmOf: (file) => file.__fm || {},
    shortTitleFor: (file) => file.basename,
    /* Même surface que le vrai plugin (main.ts) : labelsOf liste multi-valeurs,
       labelOf le premier label, labelColor la couleur configurée. */
    labelsOf: (file) => {
      const f = file.__fm || {};
      const l = f.label !== undefined ? f.label : f.labels;
      if (Array.isArray(l)) return l.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
      if (typeof l === "string" && l.trim()) return l.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
      return l ? [String(l).trim()] : [];
    },
    labelOf: (file) => {
      const f = file.__fm || {};
      const l = f.label !== undefined ? f.label : f.labels;
      if (Array.isArray(l)) return String(l[0] ?? "").trim();
      return l ? String(l).trim() : "";
    },
    labelColor: (name) => (name ? "#c0392b" : null),
    moveNode: async () => {},
  };
  const view = new BoardView({ app, contentEl: new FakeElement() }, plugin);
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    button.tooltip = tooltip;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.passesFilter = () => true;
  view.render = async () => {};
  view.setFm = async () => {};
  /* Couloirs = Fiction : le champ textuel des cartes est la synopsis (champ
     sémantique du projet via lanesPlanningField — lanesProjectType par
     défaut "fiction"). */
  view.currentCardContent = "synopsis";
  return { view, root, files, app, leaf, plugin };
}

function renderCouloirs(view, root, opts = {}) {
  const container = new FakeElement();
  view.renderCouloirs(
    container,
    root,
    opts.currentFolder || root,
    opts.wholeManuscript !== undefined ? opts.wholeManuscript : true,
    opts.numbering || new Map()
  );
  return container;
}

/* LOT 5C structure : les noms de lignes vivent dans le GUTTER fixe
   (feuillets-lanes-gutter-label), les pistes dans le canevas (feuillets-lanes-
   row). Le rendu crée les deux nœuds jumeaux dans le MÊME ordre (mêmes
   itérations) : la piste d'une ligne est retrouvée par l'index de son libellé
   dans le gutter (§19). */
function lanesLabels(container) {
  return findAll(container, (el) => el.classes.has("feuillets-lanes-gutter-label")).map((l) => l.text);
}

function laneRow(container, labelText) {
  const labels = findAll(container, (el) => el.classes.has("feuillets-lanes-gutter-label"));
  const idx = labels.findIndex((l) => l.text === labelText);
  if (idx === -1) return null;
  return findAll(container, (el) => el.classes.has("feuillets-lanes-row"))[idx] || null;
}

function gutterLabel(container, labelText) {
  return findAll(container, (el) => el.classes.has("feuillets-lanes-gutter-label")).find((l) => l.text === labelText);
}

function laneTrack(row) {
  return findFirst(row, (el) => el.classes.has("feuillets-lanes-track"));
}

function laneLine(row) {
  return findFirst(row, (el) => el.classes.has("feuillets-lane-line"));
}

function laneSlots(container, labelText) {
  const row = laneRow(container, labelText);
  if (!row) return [];
  const track = laneTrack(row);
  return track ? findAll(track, (el) => el.classes.has("feuillets-lanes-slot")) : [];
}

function cardInSlot(slot) {
  return findFirst(slot, (el) => el.classes.has("feuillets-lanes-card"));
}

function cardHead(card) {
  return findFirst(card, (el) => el.classes.has("feuillets-lanes-card-head"));
}

function cardTitle(card) {
  return findFirst(card, (el) => el.classes.has("feuillets-lanes-card-title"));
}

function cardIndex(slot) {
  return Number(slot.getAttr("data-index"));
}

/** Vide la file de microtasks : les listeners de drop sont synchrones et
   poursuivent leur travail async (setFm, render) derrière un `void` — on
   attend ici la fin de cette continuation avant d'observer les appels. */
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* ----- §20 — ARCHITECTURE : exactement 4 MODES ----- */

test("LOT5C — BOARD_MODES = exactement [board, outline, arcs, timeline] : Couloirs est une sous-vue de arcs, jamais un mode", () => {
  assert.deepEqual(BOARD_MODES.map(([k]) => k), ["board", "outline", "arcs", "timeline"]);
  assert.equal(BOARD_MODES.find(([k]) => k === "arcs")[1], "Chemin de fer");
  assert.equal(BOARD_MODES.some(([k]) => k === "lanes"), false, "Couloirs n'est pas un mode");
});

test("LOT5C — i18n : plus de board.mode.lanes ni de sous-vue Grille ; les sous-vues narratif existent FR/EN", () => {
  assert.equal(fr["board.mode.lanes"], undefined, "clé mode lanes supprimée (FR)");
  assert.equal(en["board.mode.lanes"], undefined, "clé mode lanes supprimée (EN)");
  assert.equal(fr["board.narrative.trame"], "Trame");
  assert.equal(fr["board.narrative.lanes"], "Couloirs");
  assert.equal(fr["board.narrative.grid"], undefined, "clé sous-vue Grille supprimée (FR)");
  assert.equal(en["board.narrative.trame"], "Rails");
  assert.equal(en["board.narrative.lanes"], "Lanes");
  assert.equal(en["board.narrative.grid"], undefined, "clé sous-vue Grille supprimée (EN)");
});

test("LOT5C — les défauts hiddenBoardModes ne contiennent jamais lanes", () => {
  for (const key of ["fiction", "nonfiction", "free"]) {
    assert.equal(PROJECT_MODES[key].boardDefaults.hiddenBoardModes.includes("lanes"), false, `${key} : lanes absent`);
  }
  assert.deepEqual(PROJECT_MODES.fiction.boardDefaults.hiddenBoardModes, ["timeline"]);
  assert.deepEqual(PROJECT_MODES.nonfiction.boardDefaults.hiddenBoardModes, ["arcs", "timeline"]);
  assert.deepEqual(PROJECT_MODES.free.boardDefaults.hiddenBoardModes, ["arcs", "timeline"]);
});

test("LOT5C — projectBoardDefaults : lanes absent de tous les types", () => {
  assert.ok(!projectBoardDefaults("fiction").hiddenBoardModes.includes("lanes"));
  assert.ok(!projectBoardDefaults("nonfiction").hiddenBoardModes.includes("lanes"));
  assert.ok(!projectBoardDefaults("free").hiddenBoardModes.includes("lanes"));
});

test("LOT5C — BoardView par défaut : sous-vue Trame, axe Label, registre vide, jamais persisté", () => {
  const { view, plugin } = buildLanesHarness({ files: [] });
  assert.equal(view.narrativeSubview, "trame", "défaut = Trame (Chemin de fer gelé)");
  assert.equal(view.laneAxis, "label", "défaut = axe Label (premier de l'ordre imposé)");
  assert.deepEqual(view.laneRegistry, { label: [], character: [], thread: [], pov: [] }, "registre initial vide (4 axes)");
  assert.equal(plugin.settings.lanesAxis, undefined, "aucun réglage lanesAxis jamais créé");
  assert.equal(plugin.settings.narrativeSubview, undefined, "aucun réglage narrativeSubview jamais créé");
});

test("LOT5C — type NarrativeSubview/LaneAxis compilent : aucune union élargie en string", () => {
  /* Propriété de TYPES vérifiée par la compilation (npm run build) — preuve
     runtime : le registre n'accepte que les QUATRE axes et la sous-vue n'est
     jamais persistée. */
  const { view } = buildLanesHarness({ files: [] });
  for (const axis of ["label", "character", "thread", "pov"]) {
    assert.ok(axis in view.laneRegistry, `${axis} est un axe du registre`);
  }
});

/* ----- §21 — SESSION : SOUS-VUES ET BARRE NARRATIVE ----- */

/** Board monté avec les rendus de surface neutralisés — la MÉCANIQUE de
   l'espace narratif (migration, barre, routing), pas le contenu des vues
   (couvert par les tests renderCouloirs ci-dessous). */
function buildNarrativeHarness({ boardMode = "arcs", type = "fiction" } = {}) {
  if (!globalThis.document) globalThis.document = { activeElement: null };
  const root = new TFolder("Projet/Manuscrit");
  const contentEl = new FakeElement();
  const workspace = {
    getLeavesOfType: () => [],
    getLeaf: () => ({ isDeferred: false, loadIfDeferred: async () => {}, setViewState: async () => {}, detach() {} }),
    setActiveLeaf: () => {},
    revealLeaf: () => {},
    on: () => ({}),
  };
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.projectFolder = root.path;
  settings.projectMeta = { [root.path]: { type, boardMode } };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    saveSettings: async () => {},
    getOrderedChildren: () => [],
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    wordCountOfFolder: async () => 0,
    updateDailyStats: async () => {},
    buildNumbering: () => new Map(),
    labelsOf: () => [],
    labelOf: () => "",
    labelColor: () => null,
    tagsOf: () => [],
    fmOf: () => ({}),
    isFrontMatter: () => false,
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    refreshView: () => {},
    _binderMultiSelect: new Set(),
  };
  const app = { workspace, vault: { getAbstractFileByPath: () => null } };
  const view = new BoardView({ app, contentEl }, plugin);
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    button.tooltip = tooltip;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.barSep = (parent) => parent.createDiv({ cls: "feuillets-bar-sep" });
  view.renderBoard = () => {};
  view.renderBoardWholeManuscript = () => {};
  view.renderBreadcrumbs = () => {};
  view.renderOutline = async () => {};
  view.renderCheminDeFer = () => {};
  view.renderCouloirs = () => {};
  view.renderTimeline = () => {};
  view.passesFilter = () => true;
  return { view, contentEl, plugin, settings, root, app };
}

function narrativeBar(container) {
  return findFirst(container, (el) => el.classes.has("feuillets-narrative-bar"));
}

function narrativePlus(container) {
  const bar = narrativeBar(container);
  if (!bar) return null;
  return findAll(bar, (el) => el.tag === "button" && el.icon === "plus")[0];
}

test("LOT5C — migration défensive : boardMode 'lanes' persisté → arcs + sous-vue Couloirs (local, jamais réécrit)", async () => {
  const { view, settings, root } = buildNarrativeHarness({ boardMode: "lanes" });
  let couloirsCalled = 0;
  view.renderCouloirs = () => { couloirsCalled += 1; };
  await view.render(true);
  assert.equal(couloirsCalled, 1, "renderCouloirs appelé (mode normalisé en arcs)");
  assert.equal(view.narrativeSubview, "lanes", "sous-vue Couloirs sélectionnée localement");
  assert.equal(view._lanesMigrated, true, "drapeau de migration posé");
  assert.equal(settings.projectMeta[root.path].boardMode, "lanes", "boardMode persisté JAMAIS réécrit sur le disque");
  assert.equal(settings.boardMode, DEFAULT_SETTINGS.boardMode, "réglage global boardMode inchangé");
  assert.equal(settings.lanesAxis, undefined, "aucun réglage lanesAxis créé par la migration");
});

test("LOT5C — narrativeSubview survit à render(true) et aux allers-retours de mode (état de SESSION)", async () => {
  const { view, settings, root } = buildNarrativeHarness({ boardMode: "arcs" });
  view.narrativeSubview = "lanes";
  view.laneAxis = "thread";
  await view.render(true);
  assert.equal(view.narrativeSubview, "lanes", "préservé après render(true)");
  assert.equal(view.laneAxis, "thread", "axe préservé après render(true)");
  /* Aller-retour de mode : l'état de session ne se réinitialise pas. */
  settings.projectMeta[root.path].boardMode = "outline";
  await view.render(true);
  assert.equal(view.narrativeSubview, "lanes", "préservé après un aller-retour vers un autre mode");
  /* Retour arcs → Couloirs retrouvé. */
  settings.projectMeta[root.path].boardMode = "arcs";
  let couloirsCalled = 0;
  view.renderCouloirs = () => { couloirsCalled += 1; };
  await view.render(true);
  assert.equal(couloirsCalled, 1, "retour arcs → renderCouloirs (sous-vue préservée)");
});

test("LOT5C — barre narrative en mode arcs : sélecteur compact de sous-vue, exactement Trame/Couloirs, sans Axe ni '+'", async () => {
  const { view, contentEl } = buildNarrativeHarness({ boardMode: "arcs" });
  await view.render(true);
  const bar = narrativeBar(contentEl);
  assert.ok(bar, "barre narrative rendue sous la barre principale");
  /* Un SEUL sélecteur compact (pilule icône+libellé+chevron), plus de 3
     boutons de sous-vues étalés. */
  const selector = findFirst(bar, (el) => el.classes.has("feuillets-narrative-subview-btn"));
  assert.ok(selector, "sélecteur compact présent");
  const label = findFirst(selector, (el) => el.classes.has("feuillets-narrative-btn-label"));
  assert.equal(label.text, "Trame", "face = sous-vue courante (Trame)");
  assert.equal(narrativePlus(contentEl), undefined, "pas de bouton '+' dans la barre narrative (il vit dans la barre d'axe Couloirs)");
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-narrative-axis-label")).length, 0, "pas de libellé Axe");
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-narrative-sep")).length, 0, "plus de séparateurs de groupe");
  /* Le Menu natif ne propose que les DEUX sous-vues existantes : Trame et
     Couloirs. Plus aucune entrée Grille, aucune icône grid-3x3, aucune
     sous-vue grid. */
  Menu.lastShown = null;
  await selector.trigger("click", { clientX: 1, clientY: 2 });
  const menu = Menu.lastShown;
  assert.ok(menu, "Menu ouvert");
  assert.deepEqual(
    menu.items.map((i) => [i.title, i.icon, i.disabled === true]),
    [["Trame", "waypoint", false], ["Couloirs", "rows-3", false]],
    "Menu : Trame waypoint, Couloirs rows-3 — exactement 2 entrées, aucune Grille"
  );
  assert.equal(menu.items.length, 2, "le sélecteur narratif contient exactement 2 entrées (Trame, Couloirs)");
  assert.equal(menu.items.some((i) => i.icon === "grid-3x3"), false, "aucune icône grid-3x3 dans le Menu");
  assert.equal(menu.items.some((i) => i.title === "Grille"), false, "aucune entrée Grille dans le Menu");
  assert.equal(menu.items[0].checked, true, "entrée courante (Trame) cochée via le Menu natif");
});

test("LOT5C — Couloirs actif : le sélecteur affiche Couloirs ; l'axe vit dans le contenu, la bascule se fait par le Menu (session)", async () => {
  const { view, contentEl } = buildNarrativeHarness({ boardMode: "arcs" });
  view.narrativeSubview = "lanes";
  await view.render(true);
  const bar = narrativeBar(contentEl);
  const selector = findFirst(bar, (el) => el.classes.has("feuillets-narrative-subview-btn"));
  const iconHost = findFirst(selector, (el) => el.classes.has("feuillets-narrative-btn-icon"));
  const label = findFirst(selector, (el) => el.classes.has("feuillets-narrative-btn-label"));
  assert.equal(iconHost.icon, "rows-3", "face Couloirs (rows-3)");
  assert.equal(label.text, "Couloirs", "libellé Couloirs");
  /* Plus AUCUN contrôle d'axe dans la barre narrative. */
  assert.equal(findAll(bar, (el) => el.classes.has("feuillets-arcs-filter-btn")).length, 0, "l'axe n'est pas dans la barre narrative");
  /* Choisir une sous-vue par le Menu → bascule de session. */
  Menu.lastShown = null;
  await selector.trigger("click", { clientX: 1, clientY: 2 });
  Menu.lastShown.items[1].callback(); // Couloirs déjà courant → aucune bascule
  assert.equal(view.narrativeSubview, "lanes", "Couloirs conservé");
  Menu.lastShown.items[0].callback(); // Trame
  assert.equal(view.narrativeSubview, "trame", "retour Trame par le Menu");
  /* L'axe reste un état de session indépendant de la sous-vue. */
  view.laneAxis = "character";
  assert.equal(view.laneAxis, "character", "axe de session conservé hors de la barre narrative");
});

test("LOT5C — le menu 'Modes affichés' n'offre jamais Couloirs (pas un mode)", async () => {
  /* Le menu ne dérive que de BOARD_MODES (4 modes) : Couloirs n'y est jamais
     proposé comme mode à masquer/afficher. Vérifié par la construction du
     menu : aucune clé board.mode.lanes, et les sous-vues vivent dans la
     barre narrative, pas dans le sélecteur de modes. */
  const { view, contentEl } = buildNarrativeHarness({ boardMode: "arcs" });
  await view.render(true);
  const modeGroup = findFirst(contentEl, (el) => el.classes.has("feuillets-mode-group"));
  assert.ok(modeGroup, "groupe de modes présent");
  const modeIcons = findAll(modeGroup, (el) => el.tag === "button" && el.icon).map((b) => b.icon);
  assert.equal(modeIcons.includes("columns-2"), false, "aucune icône Couloirs dans le groupe de modes");
  assert.equal(modeIcons.includes("lanes"), false);
});

/* ----- §22 — REGISTRE DE LIGNES ----- */

test("LOT5C — registre : lignes = première apparition dans l'ordre narratif, 'Sans pov' TOUJOURS en dernier", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
    mkLaneFile("C", { pov: "Deli" }),
    mkLaneFile("D", { pov: "Kemal" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["Deli", "Kali", "Kemal", "Sans pov"], "première apparition, jamais alphabétique, Sans pov en dernier");
});

test("LOT5C — ordre non alphabétique conservé (Kemal avant Deli)", () => {
  const files = [
    mkLaneFile("A", { pov: "Kemal" }),
    mkLaneFile("B", { pov: "Deli" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["Kemal", "Deli", "Sans pov"]);
});

test("LOT5C — 'Sans pov' visible et en dernier MÊME si aucun feuillet n'en a besoin", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["Deli", "Kali", "Sans pov"], "Sans pov toujours rendu, toujours cible de drop");
  const sansRow = laneRow(container, "Sans pov");
  assert.ok(sansRow, "ligne Sans pov présente");
  assert.ok(laneTrack(sansRow), "Sans pov est bien une cible de drop (track présent)");
});

test("LOT5C — tous sans Pov → une seule ligne 'Sans pov' avec toutes les cartes (pas d'état vide)", () => {
  const files = [
    mkLaneFile("A", {}),
    mkLaneFile("B", {}),
    mkLaneFile("C", {}),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["Sans pov"]);
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-lanes-card")).length, 3, "les 3 cartes rendues");
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-empty")).length, 0, "pas d'état vide quand des feuillets existent");
});

test("LOT5C — aucun feuillet dans le périmètre → état vide", () => {
  const { view, root } = buildLanesHarness({ files: [] });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  const empty = findFirst(container, (el) => el.classes.has("feuillets-empty"));
  assert.ok(empty, "état vide rendu");
  assert.equal(empty.text, "Aucun feuillet à afficher.");
});

test("LOT5C — nouvelle valeur découverte au re-rendu → ajoutée à la FIN du registre (jamais triée)", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const c1 = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(c1), ["Deli", "Kali", "Sans pov"]);
  files.push(mkLaneFile("C", { pov: "Kemal" }));
  const c2 = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(c2), ["Deli", "Kali", "Kemal", "Sans pov"], "Kemal ajouté à la fin, ordre préservé");
});

test("LOT5C — le registre n'est JAMAIS retiré : un filtre qui masque un feuillet garde sa ligne", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  renderCouloirs(view, root);
  view.passesFilter = (file) => file.basename === "A";
  const c2 = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(c2), ["Deli", "Kali", "Sans pov"], "Kali reste au registre malgré le filtre (session)");
  assert.equal(findAll(c2, (el) => el.classes.has("feuillets-lanes-card")).length, 1, "seule la carte A rendue");
});

test("LOT5C — passesFilter() reste appliqué aux feuillets Couloirs", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const kept = [files[0]];
  view.passesFilter = (file) => kept.includes(file);
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["Deli", "Sans pov"], "seul le feuillet filtré alimente le registre");
  const cards = findAll(container, (el) => el.classes.has("feuillets-lanes-card"));
  assert.equal(cards.length, 1);
  assert.equal(cardTitle(cards[0]).text, "A");
});

test("LOT5C — les filtres locaux du Chemin de fer (selected*) ne filtrent PAS Couloirs", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.selectedLabel = "rouge";
  view.selectedPerso = "Kemal";
  view.selectedFil = "Enquête";
  view.selectedPov = "Kali";
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["Deli", "Kali", "Sans pov"], "les deux couloirs rendus malgré les filtres locaux");
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-lanes-card")).length, 2);
});

/* ----- §23 — POSITION NARRATIVE ET GÉOMÉTRIE ----- */

test("LOT5C — position narrative : A=Deli index 0, D=Deli index 3", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
    mkLaneFile("C", { pov: "Kali" }),
    mkLaneFile("D", { pov: "Deli" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);

  const deliSlots = laneSlots(container, "Deli");
  assert.equal(deliSlots.length, 4, "track Deli : 4 slots pour 4 feuillets");
  assert.equal(cardIndex(deliSlots[0]), 0);
  assert.equal(cardTitle(cardInSlot(deliSlots[0])).text, "A", "A dans le slot 0 de Deli");
  assert.equal(cardIndex(deliSlots[3]), 3);
  assert.equal(cardTitle(cardInSlot(deliSlots[3])).text, "D", "D dans le slot 3 de Deli");
  assert.equal(cardInSlot(deliSlots[1]), undefined, "slot 1 vide dans Deli (B est Kali)");
  assert.equal(cardInSlot(deliSlots[2]), undefined, "slot 2 vide dans Deli (C est Kali)");
});

test("LOT5C — chaque track possède exactement autant de slots que de feuillets visibles", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
    mkLaneFile("C", { pov: "Kali" }),
    mkLaneFile("D", { pov: "Deli" }),
    mkLaneFile("E", {}),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  for (const label of ["Deli", "Kali", "Sans pov"]) {
    assert.equal(laneSlots(container, label).length, files.length, `${label} : ${files.length} slots`);
  }
});

test("LOT5C — chaque feuillet n'est rendu qu'une seule fois par ligne, à son index narratif", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
    mkLaneFile("C", { pov: "Kali" }),
    mkLaneFile("D", { pov: "Deli" }),
    mkLaneFile("E", {}),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  const cards = findAll(container, (el) => el.classes.has("feuillets-lanes-card"));
  assert.equal(cards.length, files.length, "5 cartes pour 5 feuillets — jamais regroupées par Pov");
  for (let i = 0; i < files.length; i++) {
    const slot = findAll(container, (el) => el.classes.has("feuillets-lanes-slot")).find(
      (s) => cardInSlot(s) && cardTitle(cardInSlot(s)).text === files[i].basename
    );
    assert.ok(slot, `${files[i].basename} rendu`);
    assert.equal(cardIndex(slot), i, `${files[i].basename} à l'index narratif ${i}`);
  }
});

test("LOT5C — chaque track porte un vrai nœud de ligne continue .feuillets-lane-line", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  for (const label of ["Deli", "Kali", "Sans pov"]) {
    const row = laneRow(container, label);
    assert.ok(laneLine(row), `${label} : ligne continue présente`);
    assert.equal(findAll(laneTrack(row), (el) => el.classes.has("feuillets-lane-line")).length, 1, `${label} : exactement une ligne`);
  }
});

test("LOT5C — un feuillet multi-valeurs (Label) apparaît dans CHAQUE ligne correspondante", () => {
  const files = [
    mkLaneFile("A", { label: ["rouge", "bleu"] }),
    mkLaneFile("B", { label: "vert" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "label";
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["rouge", "bleu", "vert", "Sans label"], "première apparition multi-valeurs");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "rouge")[0])).text, "A", "A dans rouge (index 0)");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "bleu")[0])).text, "A", "A dans bleu (index 0)");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "vert")[1])).text, "B", "B dans vert (index 1)");
});

test("LOT5C — axe Fil : lignes par fils (multi-valeurs), 'Sans fil' en dernier", () => {
  const files = [
    mkLaneFile("A", { thread: ["Enquête", "Romance"] }),
    mkLaneFile("B", { thread: "Action" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "thread";
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["Enquête", "Romance", "Action", "Sans fil"], "fils multi-valeurs, première apparition");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "Enquête")[0])).text, "A");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "Romance")[0])).text, "A");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "Action")[1])).text, "B");
});

/* ----- §24 — CARTE COULOIRS ----- */

test("LOT5C — carte : titre via la résolution existante (shortTitleFor)", () => {
  const files = [mkLaneFile("Scène 12", { pov: "Deli" })];
  const { view, root, plugin } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  plugin.shortTitleFor = () => "Titre Résolu";
  const container = renderCouloirs(view, root);
  const card = findFirst(container, (el) => el.classes.has("feuillets-lanes-card"));
  assert.equal(cardTitle(card).text, "Titre Résolu", "même résolution de titre que les autres vues");
});

test("LOT5C — carte : numéro + titre sur la MÊME ligne (head), numéro avant titre", () => {
  const files = [mkLaneFile("A", { pov: "Deli" })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  const card = findFirst(container, (el) => el.classes.has("feuillets-lanes-card"));
  const head = cardHead(card);
  assert.ok(head, "en-tête de carte présent (même ligne)");
  assert.ok(head.children[0].classes.has("feuillets-lanes-card-num"), "1er enfant = numéro");
  assert.ok(head.children[1].classes.has("feuillets-lanes-card-title"), "2e enfant = titre (même ligne)");
});

test("LOT5C — carte : synopsis présent → affiché ; absent → aucun nœud ni espace réservé", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli", synopsis: "Résumé de A." }),
    mkLaneFile("B", { pov: "Deli" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  const cards = findAll(container, (el) => el.classes.has("feuillets-lanes-card"));
  const synopses = findAll(container, (el) => el.classes.has("feuillets-lanes-card-synopsis"));
  assert.equal(synopses.length, 1, "une seule synopsis (celle de A)");
  assert.equal(synopses[0].text, "Résumé de A.");
  assert.equal(
    findAll(cards[1], (el) => el.classes.has("feuillets-lanes-card-synopsis")).length,
    0,
    "B sans synopsis → aucun nœud synopsis, aucun espace réservé"
  );
});

test("LOT5C — carte : Pov non répété dans la carte", () => {
  const files = [mkLaneFile("A", { pov: "Deli" })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  const card = findFirst(container, (el) => el.classes.has("feuillets-lanes-card"));
  assert.equal(findAll(card, (el) => el.classes.has("feuillets-card-pov")).length, 0, "aucune classe pov carte");
  assert.equal(findAll(card, (el) => el.classes.has("feuillets-lanes-card-pov")).length, 0);
  const title = cardTitle(card).text;
  assert.equal(title.includes("Deli"), false, "le libellé de la ligne n'est pas répété dans la carte");
});

test("LOT5C — carte : contenu LIMITÉ à numéro+titre+synopsis — jamais Pov/Label/Fil/Statut/Tags/date/goal/progression/boutons", () => {
  const files = [mkLaneFile("A", {
    pov: "Deli", arc: "Arc1", label: "rouge", thread: "Enquête", status: "Brouillon",
    characters: ["Kemal"], tags: ["x"], date: "2026-01-01", goal: 500, progress: 10,
    synopsis: "Résumé.",
  })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  const card = findFirst(container, (el) => el.classes.has("feuillets-lanes-card"));
  const texts = findAll(card, () => true).map((el) => el.text).join(" ");
  for (const banned of ["Deli", "Arc1", "rouge", "Enquête", "Brouillon", "Kemal", "x", "2026-01-01", "500"]) {
    assert.equal(texts.includes(banned), false, `texte interdit : ${banned}`);
  }
  for (const cls of ["feuillets-card-pov", "feuillets-lanes-card-pov", "feuillets-card-status", "feuillets-card-label", "feuillets-lanes-card-label", "feuillets-card-tags", "feuillets-tags", "feuillets-ring", "feuillets-card-goal"]) {
    assert.equal(findAll(card, (el) => el.classes.has(cls)).length, 0, `aucun élément ${cls}`);
  }
  assert.equal(findAll(card, (el) => el.tag === "button").length, 0, "aucun bouton dans la carte");
});

test("LOT5C — carte : liseré Label via labelColor, quel que soit l'axe courant", () => {
  const files = [
    mkLaneFile("A", { pov: "Deli", label: "rouge" }),
    mkLaneFile("B", { pov: "Deli" }),
  ];
  const { view, root, plugin } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  const cards = findAll(container, (el) => el.classes.has("feuillets-lanes-card"));
  assert.equal(cards[0].style.borderLeft, "3px solid #c0392b", "liseré = couleur Label existante (labelColor)");
  assert.equal(cards[1].style.borderLeft, undefined, "pas de Label → aucun faux liseré coloré (bordure neutre CSS)");
  const texts = findAll(cards[0], () => true).map((el) => el.text).join(" ");
  assert.equal(texts.includes("rouge"), false, "le nom du Label n'apparaît jamais dans la carte");
  /* Axe Label : le liseré reste présent (indépendant du regroupement). */
  view.laneAxis = "label";
  const container2 = renderCouloirs(view, root);
  const cards2 = findAll(container2, (el) => el.classes.has("feuillets-lanes-card"));
  assert.equal(cards2[0].style.borderLeft, "3px solid #c0392b", "liseré conservé en axe Label");
  /* La couleur vient de labelColor, jamais d'un littéral codé en dur. */
  plugin.labelColor = (name) => (name ? "#123456" : null);
  const container3 = renderCouloirs(view, root);
  const card3 = findFirst(container3, (el) => el.classes.has("feuillets-lanes-card"));
  assert.equal(card3.style.borderLeft, "3px solid #123456");
});

test("LOT5C — clic sur le titre → ouverture standard du fichier (openFileActivating)", async () => {
  const files = [mkLaneFile("A", { pov: "Deli" })];
  const { view, root, leaf } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  let opened = null;
  leaf.openFile = async (f) => { opened = f; };
  const container = renderCouloirs(view, root);
  const card = findFirst(container, (el) => el.classes.has("feuillets-lanes-card"));
  await cardTitle(card).trigger("click");
  assert.equal(opened, files[0], "openFileActivating ouvre le feuillet standard");
});

test("LOT5C — un drag ne déclenche jamais le clic d'ouverture du titre", async () => {
  const files = [mkLaneFile("A", { pov: "Deli" })];
  const { view, root, leaf } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  let opened = null;
  leaf.openFile = async (f) => { opened = f; };
  const container = renderCouloirs(view, root);
  const card = findFirst(container, (el) => el.classes.has("feuillets-lanes-card"));
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await cardTitle(card).trigger("click");
  assert.equal(opened, null, "le drag en cours verrouille l'ouverture par clic");
});

/* ----- §25 — DRAG : POV SCALAIRE, LABEL/FIL MULTI-VALEURS ----- */

test("LOT5C — drag Deli → Kali : setFm(file, 'pov', 'Kali') puis render(true)", async () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async () => { renderCalls.push(true); };

  const container = renderCouloirs(view, root);
  const card = cardInSlot(laneSlots(container, "Deli")[0]);
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Kali")).trigger("drop");
  await flushMicrotasks();

  assert.equal(setFmCalls.length, 1, "setFm appelé une fois");
  assert.equal(setFmCalls[0].f, files[0], "fichier glissé");
  assert.equal(setFmCalls[0].k, "pov", "clé logique pov");
  assert.equal(setFmCalls[0].v, "Kali", "valeur Kali");
  assert.deepEqual(renderCalls, [true], "render(true) après sauvegarde");
});

test("LOT5C — drag Kali → Sans pov : setFm(file, 'pov', '') puis render(true)", async () => {
  const files = [
    mkLaneFile("A", { pov: "Kali" }),
    mkLaneFile("B", { pov: "Deli" }),
    mkLaneFile("C", {}),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async () => { renderCalls.push(true); };

  const container = renderCouloirs(view, root);
  assert.ok(laneRow(container, "Sans pov"), "couloir Sans pov présent");
  const card = cardInSlot(laneSlots(container, "Kali")[0]);
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Sans pov")).trigger("drop");
  await flushMicrotasks();

  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].k, "pov");
  assert.equal(setFmCalls[0].v, "", "Sans pov → pov vide, la propriété sera supprimée par setFm");
  assert.deepEqual(renderCalls, [true]);
});

test("LOT5C — drop sur sa propre ligne (Pov ou Sans) : aucune écriture, aucun render", async () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", {}),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };
  view.render = async () => { renderCalls.push(true); };

  const container = renderCouloirs(view, root);
  const cardA = cardInSlot(laneSlots(container, "Deli")[0]);
  await cardA.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Deli")).trigger("drop");
  await flushMicrotasks();
  const cardB = cardInSlot(laneSlots(container, "Sans pov")[1]);
  await cardB.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Sans pov")).trigger("drop");
  await flushMicrotasks();

  assert.equal(setFmCalls.length, 0, "aucune écriture sur sa propre ligne (Pov ou Sans)");
  assert.equal(renderCalls.length, 0, "aucun render");
});

test("LOT5C — après changement de Pov : index horizontal du fichier inchangé", async () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
    mkLaneFile("C", { pov: "Deli" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.setFm = async (f, k, v) => { f.__fm = { ...f.__fm, [k]: v }; };

  const container = renderCouloirs(view, root);
  const cardA = cardInSlot(laneSlots(container, "Deli")[0]);
  assert.equal(cardTitle(cardA).text, "A");
  await cardA.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Kali")).trigger("drop");
  await flushMicrotasks();

  const container2 = renderCouloirs(view, root);
  const kaliSlots2 = laneSlots(container2, "Kali");
  assert.equal(cardTitle(cardInSlot(kaliSlots2[0])).text, "A", "A à l'index 0 du couloir Kali");
  assert.equal(cardTitle(cardInSlot(kaliSlots2[1])).text, "B", "B inchangé à l'index 1");
  const deliSlots2 = laneSlots(container2, "Deli");
  assert.equal(cardInSlot(deliSlots2[0]), undefined, "Deli vide à l'index 0 après le départ de A");
  assert.equal(cardTitle(cardInSlot(deliSlots2[2])).text, "C", "C inchangé à l'index 2");
});

test("LOT5C — le drag Couloirs n'appelle aucune fonction de réordonnancement Binder/manuscrit", async () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root, plugin } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const reorderCalls = [];
  plugin.moveNode = async () => { reorderCalls.push("moveNode"); };
  view.moveFile = async () => { reorderCalls.push("moveFile"); };

  const container = renderCouloirs(view, root);
  const card = cardInSlot(laneSlots(container, "Deli")[0]);
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Kali")).trigger("drop");
  await flushMicrotasks();

  assert.deepEqual(reorderCalls, [], "aucune opération de déplacement physique du fichier");
});

test("LOT5C — LABEL multi-valeurs : [A,C] A→B donne [C,B] (ordre préservé, source seule retirée)", async () => {
  const files = [
    mkLaneFile("X", { label: ["A", "C"] }),
    mkLaneFile("Y", { label: "B" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "label";
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async () => { renderCalls.push(true); };
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["A", "C", "B", "Sans label"]);
  const card = cardInSlot(laneSlots(container, "A")[0]); // X, source = "A"
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "B")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].k, "label", "clé frontmatter label en axe Label");
  assert.deepEqual(setFmCalls[0].v, ["C", "B"], "[A,C] A→B = [C,B] — ordre préservé");
  assert.deepEqual(renderCalls, [true]);
});

test("LOT5C — LABEL multi-valeurs : [A,B,C] A→B donne [B,C] (aucun doublon)", async () => {
  const files = [mkLaneFile("X", { label: ["A", "B", "C"] })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "label";
  const setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async () => {};
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["A", "B", "C", "Sans label"]);
  const card = cardInSlot(laneSlots(container, "A")[0]); // X, source = "A"
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "B")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, 1);
  assert.deepEqual(setFmCalls[0].v, ["B", "C"], "[A,B,C] A→B = [B,C] — B déjà présent, pas de doublon");
});

test("LOT5C — LABEL multi-valeurs : [A,C] A→Sans donne [C] (le champ sera réécrit sans la source)", async () => {
  const files = [mkLaneFile("X", { label: ["A", "C"] })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "label";
  const setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async () => {};
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["A", "C", "Sans label"]);
  const card = cardInSlot(laneSlots(container, "A")[0]); // X, source = "A"
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Sans label")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, 1);
  assert.deepEqual(setFmCalls[0].v, ["C"], "[A,C] A→Sans = [C]");
});

test("LOT5C — LABEL multi-valeurs : feuillet sans label → B donne [B]", async () => {
  const files = [
    mkLaneFile("X", {}),
    mkLaneFile("Y", { label: "B" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "label";
  const setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async () => {};
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["B", "Sans label"]);
  const card = cardInSlot(laneSlots(container, "Sans label")[0]); // X, source = ""
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "B")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, 1);
  assert.deepEqual(setFmCalls[0].v, ["B"], "[] → B = [B]");
});

test("LOT5C — FIL multi-valeurs : [A,C] A→B donne [C,B] via setFm(file, 'thread', …)", async () => {
  const files = [
    mkLaneFile("X", { thread: ["A", "C"] }),
    mkLaneFile("Y", { thread: "B" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "thread";
  const setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async () => {};
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["A", "C", "B", "Sans fil"]);
  const card = cardInSlot(laneSlots(container, "A")[0]); // X, source = "A"
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "B")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].k, "thread", "clé frontmatter thread en axe Fil");
  assert.deepEqual(setFmCalls[0].v, ["C", "B"], "[A,C] A→B = [C,B]");
});

test("LOT5C — drop sur sa propre ligne en multi-valeurs : aucune écriture", async () => {
  const files = [
    mkLaneFile("X", { label: ["A"] }),
    mkLaneFile("Y", { label: "B" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "label";
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ k, v }); };
  view.render = async () => { renderCalls.push(true); };
  const container = renderCouloirs(view, root);
  const card = cardInSlot(laneSlots(container, "A")[0]); // X, source = "A"
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "A")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, 0, "source === cible → aucune écriture");
  assert.equal(renderCalls.length, 0, "aucun render");
});

test("LOT5C — accent discret pendant le survol d'un drop : classe dragover sur la LIGNE (label + ligne)", async () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const container = renderCouloirs(view, root);
  const card = cardInSlot(laneSlots(container, "Deli")[0]);
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  const kaliRow = laneRow(container, "Kali");
  await laneTrack(kaliRow).trigger("dragover", { dataTransfer: {} });
  assert.ok(kaliRow.classes.has("feuillets-lanes-dragover"), "la ligne porte l'accent pendant le survol");
  assert.ok(gutterLabel(container, "Kali").classes.has("feuillets-lanes-dragover"), "le libellé du GUTTER porte aussi l'accent pendant le survol");
  await laneTrack(kaliRow).trigger("dragleave");
  assert.equal(kaliRow.classes.has("feuillets-lanes-dragover"), false, "accent retiré en quittant le survol");
  assert.equal(gutterLabel(container, "Kali").classes.has("feuillets-lanes-dragover"), false, "accent du libellé retiré en quittant le survol");
});

/* ----- §26 — CRÉATION DE LIGNE (barre '+') ----- */

test("LOT5C — createLane : valeur vide après trim → rien", () => {
  const { view } = buildLanesHarness({ files: [] });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const renderCalls = [];
  view.render = async () => { renderCalls.push(true); };
  view.createLane("pov", "   ");
  assert.deepEqual(view.laneRegistry.pov, [], "aucune ligne créée pour une valeur vide");
  assert.equal(renderCalls.length, 0);
});

test("LOT5C — createLane : doublon exact → rien", () => {
  const files = [mkLaneFile("A", { pov: "Deli" })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  renderCouloirs(view, root); // sème le registre : ["Deli"]
  const renderCalls = [];
  view.render = async () => { renderCalls.push(true); };
  view.createLane("pov", "Deli");
  assert.deepEqual(view.laneRegistry.pov, ["Deli"], "doublon non ajouté");
  assert.equal(renderCalls.length, 0, "aucun render pour un doublon");
});

test("LOT5C — createLane : nouvelle valeur → ajoutée à la FIN du registre + render(true), aucun YAML", () => {
  const files = [mkLaneFile("A", { pov: "Deli" })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  renderCouloirs(view, root);
  const renderCalls = [];
  view.render = async () => { renderCalls.push(true); };
  view.createLane("pov", "  Kemal  ");
  assert.deepEqual(view.laneRegistry.pov, ["Deli", "Kemal"], "Kemal ajouté à la fin (trim)");
  assert.deepEqual(renderCalls, [true], "render(true) déclenché");
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["Deli", "Kemal", "Sans pov"], "la nouvelle ligne est rendue (sans feuillet)");
});

test("LOT5C — createLane : ligne créée sur un axe ≠ axe courant → registre alimenté mais aucun render", () => {
  const { view } = buildLanesHarness({ files: [] });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "pov";
  const renderCalls = [];
  view.render = async () => { renderCalls.push(true); };
  view.createLane("label", "bleu");
  assert.deepEqual(view.laneRegistry.label, ["bleu"], "registre label alimenté");
  assert.deepEqual(view.laneRegistry.pov, [], "registre pov intact");
  assert.equal(renderCalls.length, 0, "pas de render pour un axe non affiché");
});

test("LOT5C — openNewLaneModal ouvre une NewLaneModal avec l'axe courant", () => {
  const { view } = buildLanesHarness({ files: [] });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  view.laneAxis = "label";
  const opened = [];
  const orig = NewLaneModal.prototype.open;
  NewLaneModal.prototype.open = function () { opened.push(this); };
  try {
    view.openNewLaneModal();
    assert.equal(opened.length, 1, "une modale ouverte");
    assert.equal(opened[0].axis, "label", "axe courant transmis à la modale");
  } finally {
    NewLaneModal.prototype.open = orig;
  }
});

test("LOT5C — NewLaneModal.submit : délègue à createLane puis ferme", () => {
  const { view, app } = buildLanesHarness({ files: [] });
  view.laneAxis = "pov";  /* harnais : fil conducteur métier = axe Pov (le vrai défaut d'instance label est vérifié au-dessus) */
  const created = [];
  view.createLane = (axis, raw) => { created.push({ axis, raw }); };
  const modal = new NewLaneModal(app, view, "pov");
  let closed = false;
  modal.close = () => { closed = true; };
  modal.submit("  Kemal  ");
  assert.deepEqual(created, [{ axis: "pov", raw: "  Kemal  " }], "createLane reçoit la valeur brute (trim dans createLane)");
  assert.equal(modal.value, "  Kemal  ", "this.value mémorisé");
  assert.equal(closed, true, "modale fermée après soumission");
});

/* ----- §26 bis — CSS Couloirs ----- */

function cssRule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

test("LOT5C CSS — sélecteurs Couloirs présents, aucune couleur codée ni !important dans le bloc", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  for (const selector of [
    ".feuillets-lanes-area",
    ".feuillets-lanes-gutter",
    ".feuillets-lanes-gutter-label",
    ".feuillets-lanes-scroll",
    ".feuillets-lanes",
    ".feuillets-lanes-row",
    ".feuillets-lanes-track",
    ".feuillets-lanes-slot",
    ".feuillets-lanes-card",
    ".feuillets-lanes-card-head",
    ".feuillets-lanes-card-num",
    ".feuillets-lanes-card-title",
    ".feuillets-lanes-card-synopsis",
    ".feuillets-lane-line",
    ".feuillets-narrative-bar",
    ".feuillets-narrative-subview-btn",
    ".feuillets-narrative-btn-chevron",
    ".feuillets-lanes-axis-active",
  ]) {
    assert.ok(css.includes(selector), `sélecteur ${selector} présent`);
  }
  /* LOT 5C structure : plus AUCUN libellé sticky dans les pistes — les noms
     vivent dans le gutter fixe, le canevas est la SEULE zone scrollable. */
  assert.equal(css.includes(".feuillets-lanes-label"), false, "plus de libellé de ligne dans les pistes (gutter)");
  assert.match(css, /\.feuillets-lanes-gutter\s*\{\s*flex-shrink:\s*0;/);
  assert.match(css, /\.feuillets-lanes-scroll\s*\{\s*[^}]*overflow-x:\s*auto;/);
  const lanesBlocks = css.split("}").filter((b) => b.includes(".feuillets-lanes"));
  assert.ok(lanesBlocks.length > 0, "blocs Couloirs présents");
  for (const b of lanesBlocks) {
    assert.equal(/#[0-9a-f]{3,8}\b/i.test(b), false, "aucune couleur hex dans le bloc Couloirs");
    assert.equal(/rgb\(/.test(b), false, "aucune couleur rgb() dans le bloc Couloirs");
    assert.equal(/!important/.test(b), false, "aucun !important dans le bloc Couloirs");
  }
});

test("LOT5C CSS — carte RECTANGULAIRE opaque (largeur > hauteur), posée DEVANT la bande, aucun voile au drag", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  const lanesBlock = cssRule(css, ".feuillets-lanes-area");
  assert.ok(lanesBlock.includes("--feuillets-lane-card-w: 190px"), "largeur de carte COMPACTE définie dans .feuillets-lanes-area (ancêtre commun gutter + canevas)");
  assert.ok(lanesBlock.includes("--feuillets-lane-card-h: 110px"), "hauteur de carte COMPACTE définie dans .feuillets-lanes-area (190 > 110 : PAS carrée)");
  assert.ok(lanesBlock.includes("--feuillets-lane-slot-w: 208px"), "slot = carte + gap (208px)");
  const card = cssRule(css, ".feuillets-lanes-card");
  assert.ok(card.includes("width: var(--feuillets-lane-card-w);"), "largeur de carte = variable w");
  assert.ok(card.includes("height: var(--feuillets-lane-card-h);"), "hauteur de carte = variable h (largeur ≠ hauteur)");
  assert.ok(card.includes("background: var(--background-primary)"), "carte totalement OPAQUE (fond primaire)");
  assert.ok(card.includes("z-index: 1"), "carte au premier plan (au-dessus de la bande)");
  const dragging = cssRule(css, ".feuillets-lanes-card.feuillets-dragging");
  assert.equal(/opacity/.test(dragging), false, "aucune transparence de la carte pendant le drag");
  const slot = cssRule(css, ".feuillets-lanes-slot");
  assert.ok(slot.includes("flex: 0 0 var(--feuillets-lane-slot-w);"), "slot invisible à l'empreinte var(--feuillets-lane-slot-w) (position narrative fixe)");
  assert.equal(/\bwidth:\s*\d+px\b/.test(card), false, "aucune largeur en pixels codée en dur dans la carte");
});

test("LOT5C CSS — numéro + titre sur la MÊME ligne (head flex), titre une ligne à ellipse", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  const head = cssRule(css, ".feuillets-lanes-card-head");
  assert.ok(head.includes("display: flex"), "head en ligne (numéro + titre côte à côte)");
  const title = cssRule(css, ".feuillets-lanes-card-title");
  assert.ok(title.includes("white-space: nowrap"), "titre sur UNE ligne");
  assert.ok(title.includes("text-overflow: ellipsis"), "titre tronqué par ellipse si trop long");
  assert.ok(title.includes("font-weight: 600"), "titre en gras (priorité visuelle)");
});

test("LOT5C CSS — synopsis : max 3 lignes visuelles via line-height × 3, PAS de -webkit-line-clamp", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  const synopsis = cssRule(css, ".feuillets-lanes-card-synopsis");
  assert.ok(synopsis.includes("line-height: 1.4"), "line-height fixé");
  assert.ok(synopsis.includes("max-height: calc(1.4em * 3)"), "3 lignes visuelles bornées par la hauteur calculée");
  assert.ok(synopsis.includes("overflow: hidden"), "débordement coupé");
  assert.equal(synopsis.includes("-webkit-line-clamp"), false, "interdit : webkit line-clamp (§10)");
  assert.equal(synopsis.includes("display: -webkit-box"), false, "interdit : boîte webkit (§10)");
  /* Le titre non plus n'utilise jamais de line-clamp. */
  const title = cssRule(css, ".feuillets-lanes-card-title");
  assert.equal(title.includes("-webkit-line-clamp"), false, "titre : jamais de line-clamp");
});

test("LOT5C CSS — positions vides invisibles (aucun cadre/fond) et VRAIE BANDE colorable au centre", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  const slot = cssRule(css, ".feuillets-lanes-slot");
  assert.equal(slot.includes("border"), false, "slot vide : aucun cadre");
  assert.equal(slot.includes("background"), false, "slot vide : aucun fond");
  const line = cssRule(css, ".feuillets-lane-line");
  assert.ok(line.includes("top: 50%"), "bande centrée verticalement sur la piste");
  assert.ok(line.includes("background: var(--feuillets-lane-color, var(--background-modifier-border))"), "bande colorable via la propriété inline, repli natif discret");
  assert.ok(line.includes("position: absolute"), "bande en nœud absolu (passe derrière les cartes)");
  assert.ok(line.includes("height: 4px"), "bande de 4px (§6 : épaisseur 4 à 6 px)");
  /* Accent discret du survol : la ligne ET le label de la LIGNE dragover
     partagent une règle combinée (sélecteurs séparés par une virgule). */
  const accentStart = css.indexOf(".feuillets-lanes-row.feuillets-lanes-dragover");
  assert.ok(accentStart !== -1, "règle d'accent dragover présente");
  const accentEnd = css.indexOf("}", accentStart);
  const accent = css.slice(accentStart, accentEnd);
  assert.ok(accent.includes(".feuillets-lane-line"), "règle d'accent couvre la ligne continue");
  assert.ok(accent.includes(".feuillets-lanes-gutter-label"), "règle d'accent couvre le nom de ligne (gutter)");
  assert.ok(accent.includes("background: var(--interactive-accent)"), "ligne accentuée au survol d'un drop");
  assert.ok(accent.includes("color: var(--interactive-accent)"), "label accentué au survol d'un drop");
  assert.equal(/grid|cell|slot/.test(accent), false, "l'accent ne révèle jamais de slots/cellules");
});


/* ===================== PLAN — colonnes Personnages / Fil (Fiction uniquement, §5-6/§20) ===================== */

test("Plan Fiction — Personnages et Fil disponibles, placés après Pov et avant Label", () => {
  const { view } = buildOptionsHarness();
  view.outlineColumns = {
    synopsis: true, pov: true, summary: false, characters: true, thread: true,
    label: true, status: true, tags: true, date: true, words: true, goal: true,
  };
  const ids = view.visibleCols().map((c) => c.id);
  assert.deepEqual(
    ids,
    ["title", "synopsis", "pov", "characters", "thread", "label", "status", "tags", "date", "words", "goal"]
  );
});

test("Plan Non-fiction/Libre — jamais de Personnages/Fil, même stockés à true (intégration resolveBoardOutlineColumns → visibleCols)", () => {
  for (const pType of ["nonfiction", "free"]) {
    const { view } = buildOptionsHarness();
    const stored = { characters: true, thread: true, summary: true, label: true, status: true, tags: true, date: true, words: true, goal: true };
    view.outlineColumns = resolveBoardOutlineColumns(pType, stored);
    const ids = view.visibleCols().map((c) => c.id);
    assert.ok(ids.includes("summary"), `${pType} : résumé présent`);
    assert.ok(!ids.includes("characters"), `${pType} : pas de Personnages`);
    assert.ok(!ids.includes("thread"), `${pType} : pas de Fil`);
  }
});

test("Menu Plan Non-fiction/Libre — jamais Personnages/Fil proposés", () => {
  for (const pType of ["nonfiction", "free"]) {
    const { view } = buildOptionsHarness();
    const menu = new Menu();
    view.buildModeOptionsMenu(menu, "outline", {
      S: view.plugin.settings,
      meta: {},
      pType,
      wholeManuscript: false,
      outlineColumns: {},
    });
    const titles = outlineColumnMenuTitles(menu);
    assert.equal(titles.includes("Personnages"), false, pType);
    assert.equal(titles.includes("Fil"), false, pType);
  }
});

test("Plan — Personnages/Fil présents, mais Compile/Filename/Progress/Notes jamais, même stockés à true", () => {
  const { view } = buildOptionsHarness();
  view.outlineColumns = {
    synopsis: true, pov: true, characters: true, thread: true, label: false, status: false,
    tags: false, date: false, words: false, goal: false,
    notes: true, filename: true, progress: true, compile: true, compiler: true,
  };
  const ids = view.visibleCols().map((c) => c.id);
  assert.ok(ids.includes("characters"));
  assert.ok(ids.includes("thread"));
  assert.ok(!ids.includes("notes"));
  assert.ok(!ids.includes("filename"));
  assert.ok(!ids.includes("progress"));
  assert.ok(!ids.includes("compile"));
});

test("Plan — Personnages : valeur affichée jointe par virgule", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal", "Arif"], thread: [] };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, summary: false, pov: false, characters: true, thread: true, label: false, status: false, tags: false, date: false, words: false, goal: false };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-characters"));
  assert.ok(cell, "cellule Personnages attendue");
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(editArea.text, "Kemal, Arif");
});

test("Plan — Personnages vides : « — »", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, summary: false, pov: false, characters: true, thread: true, label: false, status: false, tags: false, date: false, words: false, goal: false };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-characters"));
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(editArea.text, "—");
});

test("Plan — Personnages : clic → éditeur liste → sauvegarde vers characters", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: ["Kemal"] };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, summary: false, pov: false, characters: true, thread: true, label: false, status: false, tags: false, date: false, words: false, goal: false };
  const saved = [];
  view.setFm = async (_f, key, value) => { saved.push({ key, value }); };
  view.render = async () => {};

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);
  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-characters"));
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  await editArea.trigger("click");

  const textarea = findFirst(table, (el) => el.tag === "textarea");
  assert.ok(textarea, "textarea de saisie CSV attendu");
  textarea.value = "Kemal, Zeynep, Kemal";
  await textarea.trigger("blur");

  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, "characters");
  assert.deepEqual(saved[0].value, ["Kemal", "Zeynep"], "CSV normalisé, ordre conservé, doublon retiré");
});

test("Plan — Fil : même contrat vers thread", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { characters: [], thread: ["Intrigue A"] };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, summary: false, pov: false, characters: true, thread: true, label: false, status: false, tags: false, date: false, words: false, goal: false };
  const saved = [];
  view.setFm = async (_f, key, value) => { saved.push({ key, value }); };
  view.render = async () => {};

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-thread"));
  assert.ok(cell, "cellule Fil attendue");
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(editArea.text, "Intrigue A");

  await editArea.trigger("click");
  const textarea = findFirst(table, (el) => el.tag === "textarea");
  textarea.value = "Intrigue A, Intrigue B";
  await textarea.trigger("blur");

  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, "thread");
  assert.deepEqual(saved[0].value, ["Intrigue A", "Intrigue B"]);
});

/* ===================== PLAN — tri visuel session-only (§8-16/§21) ===================== */

function buildOutlineSortHarness({ children, wc = {}, outlineColumns } = {}) {
  const root = new TFolder("Projet/Manuscrit");
  root.children = children;
  for (const c of children) c.parent = root;

  const app = { workspace: {} };
  const dragCalls = [];
  const plugin = {
    settings: {
      collapsed: {},
      statuses: [],
      wordGoal: 0,
      outlineWidths: { ...DEFAULT_SETTINGS.outlineWidths },
      outlineWrapLongText: false,
    },
    getOrderedChildren: (folder) => folder.children,
    isFrontMatter: () => false,
    fmOf: (file) => file.__fm || {},
    shortTitleFor: (file) => file.basename,
    saveSettings: async () => {},
    labelsOf: () => [],
    tagsOf: () => [],
    labelOf: () => "",
  };
  const view = new BoardView({ app, contentEl: new FakeElement() }, plugin);
  view.passesFilter = () => true;
  view.attachDragHandlers = (...args) => { dragCalls.push(args); };
  view.handleMultiSelectClick = () => false;
  view._renderGen = 1;
  view.wcMap = new Map(Object.entries(wc).map(([k, v]) => [k, v]));
  view.outlineColumns = outlineColumns || {
    synopsis: false, summary: false, pov: false, characters: false, thread: false,
    label: false, status: false, tags: false, date: true, words: true, goal: true,
  };
  view.render = async () => {};
  return { view, root, plugin, dragCalls };
}

function outlineSceneTitles(container) {
  return findAll(container, (el) => el.classes.has("feuillets-row-scene"))
    .map((row) => findFirst(row, (el) => el.classes.has("feuillets-title-text"))?.text ?? null);
}

function outlineFolderNames(container) {
  return findAll(container, (el) => el.classes.has("feuillets-row-folder"))
    .map((row) => findFirst(row, (el) => el.classes.has("feuillets-folder-name"))?.text ?? null);
}

function headCellByLabel(container, label) {
  return findAll(container, (el) => el.classes.has("feuillets-col-head-cell"))
    .find((h) => findAll(h, (el) => el.tag === "span").some((s) => s.text === label));
}

function sortIndicatorFor(container, label) {
  const cell = headCellByLabel(container, label);
  const ind = cell ? findFirst(cell, (el) => el.classes.has("feuillets-sort-indicator")) : null;
  return ind?.text ?? "";
}

function sortIndicators(container) {
  return findAll(container, (el) => el.classes.has("feuillets-sort-indicator")).map((i) => i.text);
}

test("Plan — tri : état initial = ordre Binder, aucune flèche, drag actif", async () => {
  const beta = new TFile("Projet/Manuscrit/Beta.md");
  const alpha = new TFile("Projet/Manuscrit/Alpha.md");
  const { view, root, dragCalls } = buildOutlineSortHarness({ children: [beta, alpha] });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);

  assert.equal(view.outlineSortColumn, null);
  assert.equal(view.outlineSortDirection, null);
  assert.deepEqual(outlineSceneTitles(container), ["Beta", "Alpha"], "ordre Binder réel");
  assert.ok(dragCalls.length > 0, "drag attaché à l'ordre Binder");
  assert.ok(sortIndicators(container).every((t) => t === ""), "aucune flèche à l'état initial");
});

test("Plan — tri : 1er clic Titre = ascendant A→Z, flèche ↑, drag désactivé", async () => {
  const beta = new TFile("Projet/Manuscrit/Beta.md");
  const alpha = new TFile("Projet/Manuscrit/Alpha.md");
  const { view, root, dragCalls } = buildOutlineSortHarness({ children: [beta, alpha] });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const titleHead = headCellByLabel(container, "Feuillet");
  assert.ok(titleHead, "en-tête Titre attendu");
  await titleHead.trigger("click");

  assert.equal(view.outlineSortColumn, "title");
  assert.equal(view.outlineSortDirection, "asc");

  const container2 = new FakeElement();
  dragCalls.length = 0;
  await view.renderOutline(container2, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(container2), ["Alpha", "Beta"], "A→Z");
  assert.equal(sortIndicatorFor(container2, "Feuillet"), "↑", "flèche ascendante");
  assert.equal(dragCalls.length, 0, "drag désactivé pendant le tri");
});

test("Plan — tri : 2e clic Titre = descendant Z→A, flèche ↓", async () => {
  const beta = new TFile("Projet/Manuscrit/Beta.md");
  const alpha = new TFile("Projet/Manuscrit/Alpha.md");
  const { view, root, dragCalls } = buildOutlineSortHarness({ children: [beta, alpha] });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const titleHead = headCellByLabel(container, "Feuillet");
  await titleHead.trigger("click"); // asc
  await titleHead.trigger("click"); // desc
  assert.equal(view.outlineSortColumn, "title");
  assert.equal(view.outlineSortDirection, "desc");

  const container2 = new FakeElement();
  dragCalls.length = 0;
  await view.renderOutline(container2, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(container2), ["Beta", "Alpha"], "Z→A");
  assert.equal(sortIndicatorFor(container2, "Feuillet"), "↓", "flèche descendante");
  assert.equal(dragCalls.length, 0, "drag toujours désactivé");
});

test("Plan — tri : 3e clic Titre = retour ordre Binder exact, aucune flèche, drag réactivé", async () => {
  const beta = new TFile("Projet/Manuscrit/Beta.md");
  const alpha = new TFile("Projet/Manuscrit/Alpha.md");
  const { view, root, dragCalls } = buildOutlineSortHarness({ children: [beta, alpha] });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const titleHead = headCellByLabel(container, "Feuillet");
  await titleHead.trigger("click");
  await titleHead.trigger("click");
  await titleHead.trigger("click");

  assert.equal(view.outlineSortColumn, null);
  assert.equal(view.outlineSortDirection, null);

  const container2 = new FakeElement();
  dragCalls.length = 0;
  await view.renderOutline(container2, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(container2), ["Beta", "Alpha"], "ordre Binder exact restauré");
  assert.ok(sortIndicators(container2).every((t) => t === ""), "plus aucune flèche");
  assert.ok(dragCalls.length > 0, "drag immédiatement réactivé");
});

test("Plan — tri : cliquer une autre colonne abandonne la précédente (Date ascendant)", async () => {
  const fileA = new TFile("Projet/Manuscrit/A.md");
  fileA.__fm = { date: "2020-01-01" };
  const fileB = new TFile("Projet/Manuscrit/B.md");
  fileB.__fm = { date: "1999-12-31" };
  const { view, root } = buildOutlineSortHarness({ children: [fileA, fileB] });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  await headCellByLabel(container, "Feuillet").trigger("click");
  assert.equal(view.outlineSortColumn, "title");
  await headCellByLabel(container, "Date").trigger("click");

  assert.equal(view.outlineSortColumn, "date", "nouvelle colonne active");
  assert.equal(view.outlineSortDirection, "asc");

  const container2 = new FakeElement();
  await view.renderOutline(container2, root, new Map(), () => {}, 1);
  assert.equal(sortIndicatorFor(container2, "Feuillet"), "", "Titre plus actif");
  assert.equal(sortIndicatorFor(container2, "Date"), "↑");
  assert.deepEqual(outlineSceneTitles(container2), ["B", "A"], "date 1999 avant 2020");
});

test("Plan — tri Mots : numérique, pas lexical", async () => {
  const fileA = new TFile("Projet/Manuscrit/A.md");
  const fileB = new TFile("Projet/Manuscrit/B.md");
  const fileC = new TFile("Projet/Manuscrit/C.md");
  const { view, root } = buildOutlineSortHarness({
    children: [fileA, fileB, fileC],
    wc: { "Projet/Manuscrit/A.md": 50, "Projet/Manuscrit/B.md": 2, "Projet/Manuscrit/C.md": 10 },
  });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  await headCellByLabel(container, "Mots").trigger("click");
  assert.equal(view.outlineSortColumn, "words");

  const container2 = new FakeElement();
  await view.renderOutline(container2, root, new Map(), () => {}, 1);
  // numérique : 2, 10, 50 (un tri lexical donnerait « 10 » avant « 2 »)
  assert.deepEqual(outlineSceneTitles(container2), ["B", "C", "A"]);
});

test("Plan — tri : valeurs vides toujours en dernier, dans les deux directions", async () => {
  const empty = new TFile("Projet/Manuscrit/A.md");
  empty.__fm = {};
  const older = new TFile("Projet/Manuscrit/C.md");
  older.__fm = { date: "1999-12-31" };
  const withDate = new TFile("Projet/Manuscrit/B.md");
  withDate.__fm = { date: "2020-01-01" };
  const { view, root } = buildOutlineSortHarness({ children: [empty, older, withDate] });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const dateHead = headCellByLabel(container, "Date");

  await dateHead.trigger("click"); // asc
  const cAsc = new FakeElement();
  await view.renderOutline(cAsc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cAsc), ["C", "B", "A"], "asc : renseignées d'abord (1999, 2020), vide à la fin");

  await dateHead.trigger("click"); // desc
  const cDesc = new FakeElement();
  await view.renderOutline(cDesc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cDesc), ["B", "C", "A"], "desc : la valeur vide ne remonte jamais en tête");
});

test("Plan — tri : à valeur égale, ordre Binder conservé (stable)", async () => {
  const fileC = new TFile("Projet/Manuscrit/C.md");
  fileC.__fm = { status: "Final" };
  const fileA = new TFile("Projet/Manuscrit/A.md");
  fileA.__fm = { status: "Brouillon" };
  const fileB = new TFile("Projet/Manuscrit/B.md");
  fileB.__fm = { status: "Brouillon" };
  const { view, root } = buildOutlineSortHarness({ children: [fileC, fileA, fileB] });
  view.outlineColumns = { ...view.outlineColumns, status: true };

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  await headCellByLabel(container, "Statut").trigger("click");

  const container2 = new FakeElement();
  await view.renderOutline(container2, root, new Map(), () => {}, 1);
  // Brouillon (A, B) puis Final (C) ; A avant B = ordre Binder conservé à égalité
  assert.deepEqual(outlineSceneTitles(container2), ["A", "B", "C"]);
});

test("Plan — tri GLOBAL : fixture obligatoire §37 (4 feuillets, 2 dossiers) trie TOUS ensemble, puis revient au Binder", async () => {
  /* §37 — fixture obligatoire :
       Chapitre A → [Zeta, Beta]     Chapitre B → [Alpha, Gamma]
     Ordre Binder = Zeta, Beta, Alpha, Gamma.
     1er clic (titre ASC) : Alpha, Beta, Gamma, Zeta — AUCUNE ligne dossier
     2e clic (titre DESC) : Zeta, Gamma, Beta, Alpha
     3e clic : retour Binder — dossiers dans l'ordre d'origine, enfants
               identiques, états repliés préservés. Pendant le tri le drag
               est désactivé ; au retour Binder il réapparaît. */
  const folderA = new TFolder("Projet/Manuscrit/Chapitre A");
  const zeta = new TFile("Projet/Manuscrit/Chapitre A/Zeta.md");
  const beta = new TFile("Projet/Manuscrit/Chapitre A/Beta.md");
  folderA.children = [zeta, beta];
  zeta.parent = folderA;
  beta.parent = folderA;

  const folderB = new TFolder("Projet/Manuscrit/Chapitre B");
  const alpha = new TFile("Projet/Manuscrit/Chapitre B/Alpha.md");
  const gamma = new TFile("Projet/Manuscrit/Chapitre B/Gamma.md");
  folderB.children = [alpha, gamma];
  alpha.parent = folderB;
  gamma.parent = folderB;

  const { view, root, dragCalls } = buildOutlineSortHarness({ children: [folderA, folderB] });

  // État initial — hiérarchie Binder complète, drag branché partout.
  const initial = new FakeElement();
  await view.renderOutline(initial, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineFolderNames(initial), ["Chapitre A", "Chapitre B"], "dossiers rendus initialement");
  assert.deepEqual(outlineSceneTitles(initial), ["Zeta", "Beta", "Alpha", "Gamma"], "ordre Binder initial : Zeta, Beta, Alpha, Gamma");
  assert.equal(dragCalls.length, 6, "drag initial : 2 dossiers + 4 feuillets");

  const titleHead = headCellByLabel(initial, "Feuillet");
  assert.ok(titleHead, "en-tête Feuillet présent");

  // 1er clic → titre ASC : liste PLATE GLOBALE, sans aucune ligne dossier.
  await titleHead.trigger("click");
  const cAsc = new FakeElement();
  dragCalls.length = 0;
  await view.renderOutline(cAsc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineFolderNames(cAsc), [], "ASC : aucune ligne dossier (liste plate)");
  assert.deepEqual(outlineSceneTitles(cAsc), ["Alpha", "Beta", "Gamma", "Zeta"], "ASC global : Alpha, Beta, Gamma, Zeta");
  assert.equal(dragCalls.length, 0, "drag désactivé pendant le tri");

  // 2e clic → DESC.
  await titleHead.trigger("click");
  const cDesc = new FakeElement();
  await view.renderOutline(cDesc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineFolderNames(cDesc), [], "DESC : toujours aucune ligne dossier");
  assert.deepEqual(outlineSceneTitles(cDesc), ["Zeta", "Gamma", "Beta", "Alpha"], "DESC global : Zeta, Gamma, Beta, Alpha");

  // 3e clic → retour Binder : hiérarchie exactement identique, drag réactivé.
  await titleHead.trigger("click");
  const back = new FakeElement();
  dragCalls.length = 0;
  await view.renderOutline(back, root, new Map(), () => {}, 1);
  assert.equal(view.outlineSortColumn, null, "3e clic : plus de tri actif");
  assert.deepEqual(outlineFolderNames(back), ["Chapitre A", "Chapitre B"], "dossiers réapparus dans l'ordre Binder");
  assert.deepEqual(outlineSceneTitles(back), ["Zeta", "Beta", "Alpha", "Gamma"], "enfants d'origine, ordre Binder préservé");
  assert.equal(dragCalls.length, 6, "drag réactivé au retour Binder");
});

test("Plan — tri GLOBAL : un dossier replié PARTICIPE au tri, et le repli survit au retour Binder (§38)", async () => {
  /* §38 : le repli est purement DISPLAY, jamais un filtre — les feuillets
     d'un dossier replié participent au tri global. Au 3e clic, la hiérarchie
     réapparaît telle quelle : dossier toujours replié, état jamais muté. */
  const folderA = new TFolder("Projet/Manuscrit/Chapitre A");
  const zeta = new TFile("Projet/Manuscrit/Chapitre A/Zeta.md");
  const alpha = new TFile("Projet/Manuscrit/Chapitre A/Alpha.md");
  folderA.children = [zeta, alpha];
  zeta.parent = folderA;
  alpha.parent = folderA;

  const folderB = new TFolder("Projet/Manuscrit/Chapitre B");
  const mid = new TFile("Projet/Manuscrit/Chapitre B/Mid.md");
  folderB.children = [mid];
  mid.parent = folderB;

  const { view, root } = buildOutlineSortHarness({ children: [folderA, folderB] });
  view.plugin.settings.collapsed[folderA.path] = true;
  const collapsedBefore = { ...view.plugin.settings.collapsed };

  const initial = new FakeElement();
  await view.renderOutline(initial, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineFolderNames(initial), ["Chapitre A", "Chapitre B"], "Binder : les deux dossiers");
  assert.deepEqual(outlineSceneTitles(initial), ["Mid"], "Binder : Chapitre A replié, seul Mid rendu");

  const titleHead = headCellByLabel(initial, "Feuillet");
  await titleHead.trigger("click"); // tri titre ASC
  const cAsc = new FakeElement();
  await view.renderOutline(cAsc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cAsc), ["Alpha", "Mid", "Zeta"], "repli ≠ filtre : Alpha et Zeta participent au tri");

  await titleHead.trigger("click"); // desc
  await titleHead.trigger("click"); // retour Binder
  const back = new FakeElement();
  await view.renderOutline(back, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineFolderNames(back), ["Chapitre A", "Chapitre B"], "dossiers réapparus");
  assert.deepEqual(outlineSceneTitles(back), ["Mid"], "Chapitre A toujours replié au retour Binder");
  assert.deepEqual(view.plugin.settings.collapsed, collapsedBefore, "l'état replié n'a jamais été muté par le tri");
  const folderRow = findFirst(back, (el) => el.classes.has("feuillets-row-folder"));
  const chevron = findFirst(folderRow, (el) => el.classes.has("feuillets-chevron"));
  assert.equal(chevron.text, "▸", "chevron d'état replié inchangé");
});

test("Plan — tri Date via le moteur temporel Feuillets : dates naturelles (§12/§20)", async () => {
  /* §12/§20 : le tri Date passe par parseStoryDate (le moteur temporel
     Feuillets), jamais localeCompare sur la chaîne brute. « vers 1650 »,
     « janvier 1787 », « 11 juin 1876 », « 24 avril 1988 » se trient en
     1650, 1787, 1876, 1988 — un tri lexicographique donnerait juin/avril/
     janvier/vers, donc ce test prouve bien le moteur. */
  const vers = new TFile("Projet/Manuscrit/Vers.md");
  vers.__fm = { date: "vers 1650" };
  const janvier = new TFile("Projet/Manuscrit/Janvier.md");
  janvier.__fm = { date: "janvier 1787" };
  const juin = new TFile("Projet/Manuscrit/Juin.md");
  juin.__fm = { date: "11 juin 1876" };
  const avril = new TFile("Projet/Manuscrit/Avril.md");
  avril.__fm = { date: "24 avril 1988" };
  const { view, root } = buildOutlineSortHarness({ children: [vers, janvier, juin, avril] });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const dateHead = headCellByLabel(container, "Date");
  assert.ok(dateHead, "en-tête Date présent");

  await dateHead.trigger("click"); // asc
  const cAsc = new FakeElement();
  await view.renderOutline(cAsc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cAsc), ["Vers", "Janvier", "Juin", "Avril"], "ASC : 1650, 1787, 1876, 1988");

  await dateHead.trigger("click"); // desc
  const cDesc = new FakeElement();
  await view.renderOutline(cDesc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cDesc), ["Avril", "Juin", "Janvier", "Vers"], "DESC : 1988, 1876, 1787, 1650");
});

test("Plan — tri Date : année avant J.-C. triée avant les dates positives (§12)", async () => {
  const bce = new TFile("Projet/Manuscrit/BCE.md");
  bce.__fm = { date: "44 av. J.-C." };
  const juin = new TFile("Projet/Manuscrit/Juin.md");
  juin.__fm = { date: "11 juin 1876" };
  const { view, root } = buildOutlineSortHarness({ children: [juin, bce] });
  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  await headCellByLabel(container, "Date").trigger("click"); // asc
  const cAsc = new FakeElement();
  await view.renderOutline(cAsc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cAsc), ["BCE", "Juin"], "-44 avant 1876");
});

test("Plan — tri Date : date non reconnue = vide, toujours en dernier (§12)", async () => {
  const invalide = new TFile("Projet/Manuscrit/Invalide.md");
  invalide.__fm = { date: "pas une date" };
  const datée = new TFile("Projet/Manuscrit/Datée.md");
  datée.__fm = { date: "1789-07-14" };
  const { view, root } = buildOutlineSortHarness({ children: [invalide, datée] });
  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const dateHead = headCellByLabel(container, "Date");

  await dateHead.trigger("click"); // asc
  const cAsc = new FakeElement();
  await view.renderOutline(cAsc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cAsc), ["Datée", "Invalide"], "asc : reconnue d'abord, invalide en dernier");

  await dateHead.trigger("click"); // desc
  const cDesc = new FakeElement();
  await view.renderOutline(cDesc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cDesc), ["Datée", "Invalide"], "desc : l'invalide ne remonte jamais en tête");
});

test("Plan — tri Objectif : fm.goal explicite, SANS fallback projet (§13/§14)", async () => {
  /* §13-14 : le tri lit fm.goal brut. Un feuillet SANS goal est vide et passe
     en dernier, même si le projet a un wordGoal — goalFor()/
     projectWordGoalDefault() ne sont jamais appelés pour trier. */
  const a = new TFile("Projet/Manuscrit/A.md");
  a.__fm = { goal: 500 };
  const b = new TFile("Projet/Manuscrit/B.md");
  b.__fm = {}; // sans goal
  const c = new TFile("Projet/Manuscrit/C.md");
  c.__fm = { goal: 100 };
  const { view, root } = buildOutlineSortHarness({ children: [a, b, c] });
  view.plugin.settings.wordGoal = 400; // prouve qu'aucun fallback n'est utilisé

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const goalHead = headCellByLabel(container, "Objectif");
  assert.ok(goalHead, "en-tête Objectif présent");

  await goalHead.trigger("click"); // asc
  const cAsc = new FakeElement();
  await view.renderOutline(cAsc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cAsc), ["C", "A", "B"], "asc : 100, 500, sans-goal en dernier (jamais 400)");

  await goalHead.trigger("click"); // desc
  const cDesc = new FakeElement();
  await view.renderOutline(cDesc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cDesc), ["A", "C", "B"], "desc : 500, 100, sans-goal toujours en dernier");
});

test("Plan — tri Objectif : goal 0 est une VRAIE valeur, pas un vide (§14)", async () => {
  const zero = new TFile("Projet/Manuscrit/Zero.md");
  zero.__fm = { goal: 0 };
  const cinq = new TFile("Projet/Manuscrit/Cinq.md");
  cinq.__fm = { goal: 5 };
  const vide = new TFile("Projet/Manuscrit/Vide.md");
  vide.__fm = {};
  const { view, root } = buildOutlineSortHarness({ children: [zero, vide, cinq] });
  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  await headCellByLabel(container, "Objectif").trigger("click"); // asc
  const cAsc = new FakeElement();
  await view.renderOutline(cAsc, root, new Map(), () => {}, 1);
  assert.deepEqual(outlineSceneTitles(cAsc), ["Zero", "Cinq", "Vide"], "0 puis 5, vide en dernier");
});

test("Plan — Objectif modifié pendant un tri Objectif : re-render immédiat (§16)", async () => {
  /* §16 : tri Objectif actif + édition du goal d'un feuillet → la liste se
     re-trie aussitôt : le change du goal relance render(true), le même
     mécanisme que les autres éditeurs de métadonnée (aucun système réactif
     ajouté). */
  const a = new TFile("Projet/Manuscrit/A.md");
  a.__fm = { goal: 500 };
  const b = new TFile("Projet/Manuscrit/B.md");
  b.__fm = {};
  const { view, root } = buildOutlineSortHarness({ children: [a, b] });
  view.setFm = async (_file, key, value) => { if (key === "goal") b.__fm.goal = value; };
  const rendered = [];
  view.render = async () => { rendered.push("render"); };

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  await headCellByLabel(container, "Objectif").trigger("click"); // tri goal asc
  rendered.length = 0;

  const sorted = new FakeElement();
  await view.renderOutline(sorted, root, new Map(), () => {}, 1);
  const goalInputs = findAll(sorted, (el) => el.classes.has("feuillets-goal-input"));
  const lastInput = goalInputs[goalInputs.length - 1]; // B, sans goal, est dernier
  assert.ok(lastInput, "un input goal rendu par ligne");
  lastInput.value = "10";
  await lastInput.trigger("change");
  await new Promise((r) => setTimeout(r, 0)); // laisser la microtâche async finir
  assert.ok(rendered.length >= 1, "re-render déclenché après édition du goal sous tri Objectif");
});

/* ===================== PLAN — double-clic sur titre → édition short_title (§17-19/§22/§36) =====================
   Le double-clic sur un titre du Plan N'ÉDITE PAS le nom physique du fichier :
   il ouvre un input inline prérempli avec le titre COURT (shortTitleFor) et
   écrit la clé logique short_title via setFm. Le chemin, le basename, le
   dossier, l'ordre Binder, l'extension et le contenu du fichier ne bougent
   JAMAIS — et fileManager.renameFile n'est jamais appelé. */

function buildRenameHarness({ children } = {}) {
  const root = new TFolder("Projet/Manuscrit");
  root.children = children;
  for (const c of children) c.parent = root;
  const setFmCalls = [];
  const renamed = [];
  const app = {
    workspace: { setActiveLeaf: () => {}, getLeaf: () => ({ openFile: async () => {} }) },
    vault: {},
    fileManager: {
      renameFile: async (file, dest) => { renamed.push({ from: file.path, to: dest }); },
    },
  };
  const plugin = {
    settings: {
      collapsed: {},
      statuses: [],
      wordGoal: 0,
      outlineWidths: { ...DEFAULT_SETTINGS.outlineWidths },
      outlineWrapLongText: false,
    },
    getOrderedChildren: (folder) => folder.children,
    isFrontMatter: () => false,
    fmOf: (file) => file.__fm || {},
    shortTitleFor: (file) => (file.__fm && file.__fm.short_title) || file.basename,
    saveSettings: async () => {},
  };
  const view = new BoardView({ app, contentEl: new FakeElement() }, plugin);
  view.passesFilter = () => true;
  view.attachDragHandlers = () => {};
  view.handleMultiSelectClick = () => false;
  view._renderGen = 1;
  view.wcMap = new Map();
  view.outlineColumns = { synopsis: false, summary: false, pov: false, characters: false, thread: false, label: false, status: false, tags: false, date: false, words: false, goal: false };
  view.render = async () => {};
  view.setFm = async (f, key, value) => { setFmCalls.push({ path: f.path, key, value }); };
  return { view, root, app, setFmCalls, renamed };
}

async function openInlineRename(view, root, titleText) {
  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const titleSpan = findAll(container, (el) => el.classes.has("feuillets-title-text")).find((s) => s.text === titleText);
  assert.ok(titleSpan, `titre « ${titleText} » attendu`);
  await titleSpan.trigger("dblclick");
  const input = findFirst(container, (el) => el.classes.has("feuillets-inline-rename"));
  return { container, input, titleSpan };
}

test("Plan — double-clic : le titre affiché est shortTitleFor (short_title prioritaire, jamais basename)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { short_title: "Titre court" };
  const { view, root } = buildRenameHarness({ children: [file] });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const titleSpan = findFirst(container, (el) => el.classes.has("feuillets-title-text"));
  assert.equal(titleSpan.text, "Titre court", "le Plan affiche le short_title, pas le basename du fichier");
});

test("Plan — double-clic : input inline prérempli avec le titre court", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { short_title: "Titre court" };
  const { view, root } = buildRenameHarness({ children: [file] });
  const { input } = await openInlineRename(view, root, "Titre court");
  assert.ok(input, "input d'édition inline attendu");
  assert.equal(input.value, "Titre court", "prérempli avec le titre COURANT (shortTitleFor), pas le basename");
});

test("Plan — double-clic : n'ouvre PAS le feuillet (aucun clic parasite)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const { view, root, setFmCalls } = buildRenameHarness({ children: [file] });
  view.outlineDblClickDelayMs = 5;
  let opened = null;
  view.app.workspace.getLeaf = () => ({ openFile: async (f) => { opened = f.path; } });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const titleSpan = findFirst(container, (el) => el.classes.has("feuillets-title-text"));
  await titleSpan.trigger("click");   // un clic pose la temporisation d'ouverture
  await titleSpan.trigger("dblclick"); // le double-clic l'annule
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(opened, null, "le double-clic annule l'ouverture temporisée : aucun feuillet ouvert");
  assert.ok(findFirst(container, (el) => el.classes.has("feuillets-inline-rename")), "l'éditeur inline est bien ouvert");
  assert.equal(setFmCalls.length, 0, "aucune écriture pendant l'édition");
});

test("Plan — Enter : écrit short_title via setFm, JAMAIS fileManager.renameFile", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const { view, root, setFmCalls, renamed } = buildRenameHarness({ children: [file] });
  const { container, input } = await openInlineRename(view, root, "Scène");
  input.value = "Chapitre 1";
  await input.trigger("keydown", { key: "Enter" });

  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].path, "Projet/Manuscrit/Scène.md", "fichier cible = le feuillet, chemin inchangé");
  assert.equal(setFmCalls[0].key, "short_title");
  assert.equal(setFmCalls[0].value, "Chapitre 1");
  assert.equal(renamed.length, 0, "AUCUN appel à fileManager.renameFile — pas de renommage physique");
  assert.ok(!findFirst(container, (el) => el.classes.has("feuillets-inline-rename")), "input retiré après validation");
});

test("Plan — blur valide aussi : setFm(file, 'short_title', valeur)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const { view, root, setFmCalls, renamed } = buildRenameHarness({ children: [file] });
  const { input } = await openInlineRename(view, root, "Scène");
  input.value = "Chapitre 2";
  await input.trigger("blur");
  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].key, "short_title");
  assert.equal(setFmCalls[0].value, "Chapitre 2");
  assert.equal(renamed.length, 0);
});

test("Plan — Escape : annule, aucune écriture, titre restauré", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const { view, root, setFmCalls, renamed } = buildRenameHarness({ children: [file] });
  const { container, input, titleSpan } = await openInlineRename(view, root, "Scène");
  input.value = "Chapitre 3";
  await input.trigger("keydown", { key: "Escape" });
  assert.equal(setFmCalls.length, 0, "aucune écriture sur Escape");
  assert.equal(renamed.length, 0);
  assert.ok(!findFirst(container, (el) => el.classes.has("feuillets-inline-rename")), "input retiré");
  assert.equal(titleSpan.hidden, false, "titre réaffiché");
  assert.equal(titleSpan.text, "Scène", "titre d'origine conservé");
});

test("Plan — valeur inchangée : no-op, aucune écriture", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { short_title: "Titre court" };
  const { view, root, setFmCalls, renamed } = buildRenameHarness({ children: [file] });
  const { input } = await openInlineRename(view, root, "Titre court");
  input.value = "Titre court";
  await input.trigger("keydown", { key: "Enter" });
  assert.equal(setFmCalls.length, 0, "titre inchangé : aucune écriture");
  assert.equal(renamed.length, 0);
});

test("Plan — valeur vidée : setFm(file, 'short_title', '') pour retirer la clé", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { short_title: "Titre court" };
  const { view, root, setFmCalls, renamed } = buildRenameHarness({ children: [file] });
  const { input } = await openInlineRename(view, root, "Titre court");
  input.value = "   ";
  await input.trigger("keydown", { key: "Enter" });
  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].key, "short_title");
  assert.equal(setFmCalls[0].value, "", "champ vidé → '' (le writer supprime la clé)");
  assert.equal(renamed.length, 0, "toujours aucun renommage physique");
});

test("Plan — le double-clic ne change ni le chemin, ni le basename, ni l'ordre Binder, ni le contenu", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { status: "Brouillon", characters: ["Kemal"] };
  const { view, root, setFmCalls, renamed } = buildRenameHarness({ children: [file] });
  const { input } = await openInlineRename(view, root, "Scène");
  input.value = "Chapitre 4";
  await input.trigger("keydown", { key: "Enter" });

  assert.equal(file.path, "Projet/Manuscrit/Scène.md", "chemin absolument inchangé");
  assert.equal(file.basename, "Scène", "basename inchangé");
  assert.equal(file.name, "Scène.md", "nom de fichier inchangé");
  assert.equal(file.parent.path, "Projet/Manuscrit", "dossier inchangé");
  assert.equal(root.children[0], file, "ordre Binder inchangé (le fichier reste à sa place)");
  assert.deepEqual(file.__fm, { status: "Brouillon", characters: ["Kemal"] }, "autres clés YAML intactes");
  assert.equal(setFmCalls[0].key, "short_title", "la SEULE clé écrite est short_title");
  assert.equal(renamed.length, 0, "fileManager.renameFile jamais appelé");
});

test("Plan — simple clic ouvre le feuillet, ne déclenche pas l'éditeur inline", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const { view, root, setFmCalls, renamed } = buildRenameHarness({ children: [file] });
  view.outlineDblClickDelayMs = 5;
  let opened = null;
  view.app.workspace.getLeaf = () => ({ openFile: async (f) => { opened = f.path; } });

  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const titleSpan = findFirst(container, (el) => el.classes.has("feuillets-title-text"));
  await titleSpan.trigger("click");

  assert.equal(opened, null, "ouverture temporisée en attente (simple clic)");
  assert.ok(!findFirst(container, (el) => el.classes.has("feuillets-inline-rename")), "pas d'éditeur inline au simple clic");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(opened, "Projet/Manuscrit/Scène.md", "simple clic : le feuillet s'ouvre");
  assert.equal(setFmCalls.length, 0);
  assert.equal(renamed.length, 0);
});

/* ===================== CARTES — double-clic sur titre de carte → short_title (§20/§37) ===================== */

function buildCardShortTitleHarness({ fm = {}, siblings = null } = {}) {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = fm;
  const parent = new TFolder("Projet/Manuscrit");
  file.parent = parent;
  parent.children = siblings ?? [file];
  for (const c of parent.children) c.parent = parent;
  const contentEl = new FakeElement();
  const setFmCalls = [];
  const renamed = [];
  const app = {
    vault: { cachedRead: async () => "Corps du feuillet." },
    workspace: {},
    fileManager: {
      renameFile: async (f, dest) => { renamed.push({ from: f.path, to: dest }); },
    },
  };
  const plugin = {
    settings: { statuses: [], excerptLength: 420 },
    fmOf: (f) => f.__fm || {},
    roleOfFile: () => "scene",
    labelOf: () => "",
    labelColor: () => null,
    shortTitleFor: (f) => (f.__fm && f.__fm.short_title) || f.basename,
  };
  const view = new BoardView({ app, contentEl }, plugin);
  view.wcMap = new Map([[file.path, 672]]);
  view.filterActive = () => true;
  view.currentCardContent = "extrait";
  view.render = async () => {};
  view.setFm = async (f, key, value) => { setFmCalls.push({ path: f.path, key, value }); };
  return { view, file, parent, contentEl, plugin, setFmCalls, renamed };
}

function cardTitleEl(contentEl) {
  return findFirst(contentEl, (el) => el.classes.has("feuillets-card-title"));
}

test("Cartes — le titre de carte affiche shortTitleFor (short_title prioritaire)", () => {
  const { view, file, parent, contentEl } = buildCardShortTitleHarness({ fm: { short_title: "Titre court" } });
  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});
  const title = cardTitleEl(contentEl);
  assert.ok(title, "titre de carte attendu");
  assert.equal(title.text, "Titre court", "short_title affiché, pas le basename");
});

test("Cartes — double-clic sur le titre : input prérempli, jamais de renommage", () => {
  const { view, file, parent, contentEl } = buildCardShortTitleHarness({ fm: { short_title: "Titre court" } });
  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});
  const title = cardTitleEl(contentEl);
  assert.equal(title.text, "Titre court");
  awaitCardDblClick(title);
  const input = findFirst(contentEl, (el) => el.classes.has("feuillets-inline-rename"));
  assert.ok(input, "input inline dans le titre de carte");
  assert.equal(input.value, "Titre court", "prérempli avec le titre courant");
});

test("Cartes — Enter sur le titre : écrit short_title via setFm, chemin et ordre intacts", async () => {
  const { view, file, parent, contentEl, setFmCalls, renamed } = buildCardShortTitleHarness({ fm: {} });
  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});
  const input = await openCardShortTitle(contentEl);
  input.value = "Nouveau titre";
  await input.trigger("keydown", { key: "Enter" });

  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].path, "Projet/Manuscrit/Scène.md", "chemin de la carte inchangé");
  assert.equal(setFmCalls[0].key, "short_title");
  assert.equal(setFmCalls[0].value, "Nouveau titre");
  assert.equal(renamed.length, 0, "fileManager.renameFile jamais appelé");
  assert.equal(file.path, "Projet/Manuscrit/Scène.md", "chemin du fichier intact");
  assert.deepEqual(parent.children, [file], "ordre du dossier (Binder) intact");
});

test("Cartes — blur sur le titre : sauvegarde aussi", async () => {
  const { view, file, parent, contentEl, setFmCalls, renamed } = buildCardShortTitleHarness({ fm: {} });
  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});
  const input = await openCardShortTitle(contentEl);
  input.value = "Autre titre";
  await input.trigger("blur");
  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].key, "short_title");
  assert.equal(setFmCalls[0].value, "Autre titre");
  assert.equal(renamed.length, 0);
});

test("Cartes — Escape sur le titre : annule, titre restauré, aucune écriture", async () => {
  const { view, file, parent, contentEl, setFmCalls, renamed } = buildCardShortTitleHarness({ fm: { short_title: "Titre court" } });
  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});
  const title = cardTitleEl(contentEl);
  const input = await openCardShortTitle(contentEl);
  input.value = "À jeter";
  await input.trigger("keydown", { key: "Escape" });
  assert.equal(setFmCalls.length, 0, "Escape : aucune écriture");
  assert.equal(renamed.length, 0);
  assert.ok(!findFirst(contentEl, (el) => el.classes.has("feuillets-inline-rename")), "input retiré");
  assert.equal(title.text, "Titre court", "titre restauré sur la carte");
});

test("Cartes — valeur vidée : setFm(file, 'short_title', '')", async () => {
  const { view, file, parent, contentEl, setFmCalls, renamed } = buildCardShortTitleHarness({ fm: { short_title: "Titre court" } });
  view.renderCard(contentEl, parent, file, 0, [file], new Map([[file.path, "1"]]), () => {});
  const input = await openCardShortTitle(contentEl);
  input.value = "";
  await input.trigger("keydown", { key: "Enter" });
  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].key, "short_title");
  assert.equal(setFmCalls[0].value, "", "champ vidé → '' (clé retirée)");
  assert.equal(renamed.length, 0);
});

async function openCardShortTitle(contentEl) {
  const title = cardTitleEl(contentEl);
  awaitCardDblClick(title);
  const input = findFirst(contentEl, (el) => el.classes.has("feuillets-inline-rename"));
  assert.ok(input, "input inline du titre de carte attendu");
  return input;
}

async function awaitCardDblClick(el) {
  await el.trigger("dblclick");
}

/* ===================== Bouton « + » Cartes/Plan (§22-24/§39) =====================
   Un SEUL bouton « + » dans la barre principale, présent en Cartes et en
   Plan UNIQUEMENT (jamais Chemin de fer/Couloirs/Chronologie/Documents/
   Édition). Son menu propose « Nouveau feuillet ici » et « Nouveau dossier… »
   et crée TOUJOURS via le moteur du Binder (plugin.newSheet / plugin.newFolder)
   — la cible est une racine structurelle réelle : dossier courant affiché en
   Cartes, racine du manuscrit en Plan et en Cartes « Tout le manuscrit ». */

function buildPlusButtonHarness({ boardMode = "board", wholeManuscript = false, empty = false } = {}) {
  const harness = buildNarrativeHarness({ boardMode });
  const { view, plugin, settings, root } = harness;
  if (wholeManuscript) settings.projectMeta[root.path].boardWholeManuscript = true;
  if (empty) root.children = [];
  const created = [];
  plugin.newSheet = (target) => { created.push({ kind: "sheet", target }); };
  plugin.newFolder = (target) => { created.push({ kind: "folder", target }); };
  view.app.vault.create = () => { created.push({ kind: "vault.create" }); };
  view.app.vault.createFolder = () => { created.push({ kind: "vault.createFolder" }); };
  return { ...harness, created };
}

function plusButton(container) {
  return findAll(container, (el) => el.tag === "button" && el.icon === "plus")[0];
}

test("Cartes — bouton « + » présent ; menu = Nouveau feuillet ici / Nouveau dossier, cible = dossier courant", async () => {
  const { view, contentEl, created, root } = buildPlusButtonHarness({ boardMode: "board" });
  await view.render(true);
  const plus = plusButton(contentEl);
  assert.ok(plus, "bouton « + » présent en mode Cartes");
  Menu.lastShown = null;
  await plus.trigger("click", { clientX: 1, clientY: 2 });
  const menu = Menu.lastShown;
  assert.ok(menu, "menu de création ouvert");
  assert.deepEqual(
    menu.items.map((i) => [i.title, i.icon]),
    [["Nouveau feuillet ici", "file-plus"], ["Nouveau dossier…", "folder-plus"]],
    "menu exact du Binder : feuillet puis dossier"
  );
  /* cible : dossier courant affiché (racine ici, aucun focus) */
  menu.items[0].callback();
  assert.equal(created[0].kind, "sheet");
  assert.equal(created[0].target.path, root.path, "nouveau feuillet dans le dossier courant");
  menu.items[1].callback();
  assert.equal(created[1].kind, "folder");
  assert.equal(created[1].target.path, root.path, "nouveau dossier dans le dossier courant");
});

test("Cartes — « Tout le manuscrit » : la cible du « + » devient la racine", async () => {
  const { view, contentEl, created, root } = buildPlusButtonHarness({ boardMode: "board", wholeManuscript: true });
  await view.render(true);
  const plus = plusButton(contentEl);
  assert.ok(plus, "« + » présent aussi en tout-manuscrit");
  Menu.lastShown = null;
  await plus.trigger("click", { clientX: 1, clientY: 2 });
  const menu = Menu.lastShown;
  menu.items[0].callback();
  assert.equal(created[0].target.path, root.path, "cible = racine du manuscrit en tout-manuscrit");
});

test("Cartes — dossier courant navigué : la cible du « + » est ce dossier", async () => {
  const { view, contentEl, created, root } = buildPlusButtonHarness({ boardMode: "board" });
  const sub = new TFolder("Projet/Manuscrit/Chapitre 1");
  sub.parent = root;
  view.app.vault.getAbstractFileByPath = (p) => (p === sub.path ? sub : null);
  view.focusedFolderPath = sub.path;
  await view.render(true);
  const plus = plusButton(contentEl);
  assert.ok(plus);
  Menu.lastShown = null;
  await plus.trigger("click", { clientX: 1, clientY: 2 });
  Menu.lastShown.items[0].callback();
  assert.equal(created[0].target.path, sub.path, "cible = dossier courant réellement affiché");
});

test("Plan — bouton « + » présent, cible = racine du manuscrit", async () => {
  const { view, contentEl, created, root } = buildPlusButtonHarness({ boardMode: "outline" });
  await view.render(true);
  const plus = plusButton(contentEl);
  assert.ok(plus, "bouton « + » présent en mode Plan");
  Menu.lastShown = null;
  await plus.trigger("click", { clientX: 1, clientY: 2 });
  const menu = Menu.lastShown;
  assert.deepEqual(
    menu.items.map((i) => [i.title, i.icon]),
    [["Nouveau feuillet ici", "file-plus"], ["Nouveau dossier…", "folder-plus"]],
    "même menu que le Binder en Plan"
  );
  menu.items[0].callback();
  menu.items[1].callback();
  assert.equal(created[0].target.path, root.path, "feuillet créé à la racine du manuscrit");
  assert.equal(created[1].target.path, root.path, "dossier créé à la racine du manuscrit");
});

test("Chemin de fer (arcs) : aucun bouton « + »", async () => {
  const { view, contentEl } = buildPlusButtonHarness({ boardMode: "arcs" });
  await view.render(true);
  assert.equal(plusButton(contentEl), undefined, "pas de « + » en mode narratif (arcs)");
});

test("Chronologie (timeline) : aucun bouton « + »", async () => {
  /* Fiction masque timeline par défaut : on la rend explicitement visible pour
     tester le vrai mode Chronologie (sinon le mode retomberait sur Cartes). */
  const { view, contentEl, settings, root } = buildPlusButtonHarness({ boardMode: "timeline" });
  settings.projectMeta[root.path].hiddenBoardModes = [];
  await view.render(true);
  assert.equal(plusButton(contentEl), undefined, "pas de « + » en Chronologie");
});

test("Manuscrit vide : le « + » reste présent pour créer le premier feuillet", async () => {
  const { view, contentEl, created, root } = buildPlusButtonHarness({ boardMode: "board", empty: true });
  await view.render(true);
  const plus = plusButton(contentEl);
  assert.ok(plus, "« + » présent même dans un manuscrit vide");
  Menu.lastShown = null;
  await plus.trigger("click", { clientX: 1, clientY: 2 });
  Menu.lastShown.items[0].callback();
  assert.equal(created[0].kind, "sheet");
  assert.equal(created[0].target.path, root.path, "premier feuillet créé à la racine");
});

/* ===================== Plan — menus contextuels partagés (§41) =====================
   Le clic-droit d'une ligne du Plan (feuillet ou dossier) OUVRE LES MÊMES
   menus partagés que Cartes/Binder (showFileContextMenu / showFolderContextMenu
   de BaseFeuilletsView) — jamais un menu parallèle. `i` et `children` passés
   sont l'indice et les siblings Binder RÉELS, même pendant un tri visuel. */

function buildContextMenuHarness({ children, sort = null } = {}) {
  const { view, root } = buildOutlineSortHarness({ children });
  const fileMenuCalls = [];
  const folderMenuCalls = [];
  view.showFileContextMenu = (...args) => { fileMenuCalls.push(args); };
  view.showFolderContextMenu = (...args) => { folderMenuCalls.push(args); };
  if (sort) {
    view.outlineSortColumn = sort.column;
    view.outlineSortDirection = sort.direction;
  }
  return { view, root, fileMenuCalls, folderMenuCalls };
}

test("Plan — clic-droit sur une ligne feuillet : showFileContextMenu(parentFolder, indice Binder, siblings)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const { view, root, fileMenuCalls, folderMenuCalls } = buildContextMenuHarness({ children: [file] });
  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const row = findFirst(container, (el) => el.classes.has("feuillets-row-scene"));
  assert.ok(row, "ligne feuillet rendue");
  await row.trigger("contextmenu");
  assert.equal(fileMenuCalls.length, 1, "menu partagé du feuillet ouvert");
  const [_evt, f, parentFolder, i, children] = fileMenuCalls[0];
  assert.equal(f.path, "Projet/Manuscrit/Scène.md");
  assert.equal(parentFolder.path, "Projet/Manuscrit");
  assert.equal(i, 0, "indice Binder");
  assert.deepEqual(children.map((c) => c.path), ["Projet/Manuscrit/Scène.md"], "siblings Binder");
  assert.equal(folderMenuCalls.length, 0, "aucun menu dossier");
});

test("Plan — clic-droit sur une ligne dossier : showFolderContextMenu(parentFolder, indice Binder, siblings)", async () => {
  const folder = new TFolder("Projet/Manuscrit/Chapitre 1");
  const { view, root, fileMenuCalls, folderMenuCalls } = buildContextMenuHarness({ children: [folder] });
  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const row = findFirst(container, (el) => el.classes.has("feuillets-row-folder"));
  assert.ok(row, "ligne dossier rendue");
  await row.trigger("contextmenu");
  assert.equal(folderMenuCalls.length, 1, "menu partagé du dossier ouvert");
  const [_evt, f, parentFolder, i, _children] = folderMenuCalls[0];
  assert.equal(f.path, "Projet/Manuscrit/Chapitre 1");
  assert.equal(parentFolder.path, "Projet/Manuscrit");
  assert.equal(i, 0, "indice Binder");
  assert.equal(fileMenuCalls.length, 0, "aucun menu feuillet");
});

test("Plan — tri actif : le clic-droit garde l'indice et les siblings Binder, pas l'ordre visuel", async () => {
  /* Ordre Binder : [Beta, Alpha]. Tri titre asc → visuel [Alpha, Beta].
     Le clic-droit d'Alpha doit pourtant rapporter l'indice Binder 1 et les
     siblings Binder [Beta, Alpha] — le menu ne lit jamais l'ordre trié. */
  const beta = new TFile("Projet/Manuscrit/Beta.md");
  const alpha = new TFile("Projet/Manuscrit/Alpha.md");
  const { view, root, fileMenuCalls } = buildContextMenuHarness({ children: [beta, alpha], sort: { column: "title", direction: "asc" } });
  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const rows = findAll(container, (el) => el.classes.has("feuillets-row-scene"));
  assert.deepEqual(
    rows.map((r) => findFirst(r, (el) => el.classes.has("feuillets-title-text"))?.text),
    ["Alpha", "Beta"],
    "ordre VISUEL trié : Alpha puis Beta"
  );
  await rows[0].trigger("contextmenu"); // clic-droit sur Alpha (première ligne visuelle)
  assert.equal(fileMenuCalls.length, 1);
  const [_evt, f, _parentFolder, i, children] = fileMenuCalls[0];
  assert.equal(f.path, "Projet/Manuscrit/Alpha.md");
  assert.equal(i, 1, "indice BINDER d'Alpha = 1, pas sa position visuelle 0");
  assert.deepEqual(children.map((c) => c.path), ["Projet/Manuscrit/Beta.md", "Projet/Manuscrit/Alpha.md"], "siblings Binder réels");
});

test("Plan — tri GLOBAL : le clic-droit rapporte parent/indice/siblings Binder réels, pas la position visuelle", async () => {
  /* §37/§40 : dans la liste plate triée, le menu lit le vrai contexte Binder
     du feuillet — parentFolder = son dossier réel, indice = position dans CE
     dossier, siblings = les enfants de CE dossier. Alpha est visuellement la
     PREMIÈRE ligne, mais son contexte est dossier Chapitre A, indice 1,
     siblings [Zeta, Alpha]. */
  const folderA = new TFolder("Projet/Manuscrit/Chapitre A");
  const zeta = new TFile("Projet/Manuscrit/Chapitre A/Zeta.md");
  const alpha = new TFile("Projet/Manuscrit/Chapitre A/Alpha.md");
  folderA.children = [zeta, alpha];
  zeta.parent = folderA;
  alpha.parent = folderA;

  const folderB = new TFolder("Projet/Manuscrit/Chapitre B");
  const beta = new TFile("Projet/Manuscrit/Chapitre B/Beta.md");
  folderB.children = [beta];
  beta.parent = folderB;

  const { view, root, fileMenuCalls } = buildContextMenuHarness({
    children: [folderA, folderB],
    sort: { column: "title", direction: "asc" },
  });
  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const rows = findAll(container, (el) => el.classes.has("feuillets-row-scene"));
  assert.deepEqual(
    rows.map((r) => findFirst(r, (el) => el.classes.has("feuillets-title-text"))?.text),
    ["Alpha", "Beta", "Zeta"],
    "ordre visuel trié : Alpha, Beta, Zeta"
  );
  await rows[0].trigger("contextmenu"); // Alpha, première ligne VISUELLE
  assert.equal(fileMenuCalls.length, 1);
  const [_evt, f, parentFolder, i, children] = fileMenuCalls[0];
  assert.equal(f.path, "Projet/Manuscrit/Chapitre A/Alpha.md");
  assert.equal(parentFolder.path, "Projet/Manuscrit/Chapitre A", "parent réel = Chapitre A");
  assert.equal(i, 1, "indice réel dans Chapitre A = 1, pas la position visuelle 0");
  assert.deepEqual(
    children.map((c) => c.path),
    ["Projet/Manuscrit/Chapitre A/Zeta.md", "Projet/Manuscrit/Chapitre A/Alpha.md"],
    "siblings réels = enfants de Chapitre A"
  );
});

test("Plan — clic-droit dans un champ éditable : le menu de ligne ne s'ouvre jamais (§15)", async () => {
  /* §15 : la garde précède TOUT preventDefault. Sur un input/textarea/select/
     contenteditable, le clic droit laisse le menu natif du champ — le menu
     partagé Feuillets n'est pas ouvert et preventDefault n'est pas exécuté. */
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const { view, root, fileMenuCalls } = buildContextMenuHarness({ children: [file] });
  const container = new FakeElement();
  await view.renderOutline(container, root, new Map(), () => {}, 1);
  const row = findFirst(container, (el) => el.classes.has("feuillets-row-scene"));
  assert.ok(row, "ligne feuillet rendue");

  // Cible INPUT (champ objectif) → aucun menu, aucun preventDefault.
  let prevented = false;
  await row.trigger("contextmenu", {
    target: { tagName: "INPUT" },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(fileMenuCalls.length, 0, "INPUT : aucun menu Feuillets");
  assert.equal(prevented, false, "INPUT : preventDefault jamais exécuté");

  // Cible TEXTAREA (champ métadonnée cliquer-pour-écrire) → aucun menu.
  await row.trigger("contextmenu", { target: { tagName: "TEXTAREA" } });
  assert.equal(fileMenuCalls.length, 0, "TEXTAREA : aucun menu Feuillets");

  // Cible contenteditable → aucun menu.
  await row.trigger("contextmenu", { target: { tagName: "DIV", isContentEditable: true } });
  assert.equal(fileMenuCalls.length, 0, "contenteditable : aucun menu Feuillets");

  // L'input goal RÉELLEMENT rendu (cible FakeElement, pas synthétique) est
  // aussi protégé — la garde retombe sur `tag` quand tagName est absent.
  const goalInput = findFirst(container, (el) => el.classes.has("feuillets-goal-input"));
  assert.ok(goalInput, "input goal rendu");
  const before = fileMenuCalls.length;
  await row.trigger("contextmenu", { target: goalInput });
  assert.equal(fileMenuCalls.length, before, "clic droit sur l'input goal réel : pas de menu");

  // Une ligne de dossier : la garde s'applique aussi à son menu partagé.
  const folder = new TFolder("Projet/Manuscrit/Chapitre 1");
  const { view: v2, root: r2, folderMenuCalls } = buildContextMenuHarness({ children: [folder] });
  const c2 = new FakeElement();
  await v2.renderOutline(c2, r2, new Map(), () => {}, 1);
  const folderRow = findFirst(c2, (el) => el.classes.has("feuillets-row-folder"));
  await folderRow.trigger("contextmenu", { target: { tagName: "INPUT" } });
  assert.equal(folderMenuCalls.length, 0, "dossier INPUT : aucun menu dossier");

  // Une cellule normale reste un clic-droit → menu partagé du feuillet.
  const beforeNormal = fileMenuCalls.length;
  await row.trigger("contextmenu", { target: {} });
  assert.equal(fileMenuCalls.length, beforeNormal + 1, "cellule normale : le menu s'ouvre toujours");
});

/* ===================== Création strictement via le moteur du Binder (§42) =====================
   Le bouton « + » (Cartes comme Plan) passe exclusivement par
   plugin.newSheet / plugin.newFolder du moteur de création du Binder — jamais
   de vault.create / vault.createFolder directement, jamais de sélecteur de
   destination supplémentaire. */

test("Création — le « + » n'appelle JAMAIS vault.create ni vault.createFolder", async () => {
  const { view, contentEl, created } = buildPlusButtonHarness({ boardMode: "board" });
  await view.render(true);
  const plus = plusButton(contentEl);
  assert.ok(plus);
  Menu.lastShown = null;
  await plus.trigger("click", { clientX: 1, clientY: 2 });
  const menu = Menu.lastShown;
  menu.items[0].callback();
  menu.items[1].callback();
  assert.equal(created.length, 2, "exactement deux créations (feuillet + dossier)");
  assert.deepEqual(created.map((c) => c.kind), ["sheet", "folder"], "uniquement via le moteur du Binder — vault.create/vault.createFolder jamais appelés");
});
