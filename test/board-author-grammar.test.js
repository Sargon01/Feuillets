import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { BoardView } from "../src/views/board-view.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

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
    this.value = "";
    this.text = options.text ?? "";
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
  empty() { this.children = []; }
  remove() { this.removed = true; }
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

test("Menu Plan Fiction — colonnes proposées : Synopsis, POV, Label, Statut, Tags, Date, Mots, Objectif — jamais Notes/Fichier/Progression/Compiler", () => {
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
    ["Synopsis", "POV", "Label", "Statut", "Tags", "Date", "Mots", "Objectif"]
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

test("Plan — édition inline du POV (cellule pov, placeholder POV…)", async () => {
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

test("Plan — POV vide : placeholder « POV… »", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = {};
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.outlineColumns = { synopsis: false, pov: true, label: false, status: false, tags: false, date: false, words: false, goal: false };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const cell = findFirst(table, (el) => el.classes.has("feuillets-cell-pov"));
  const editArea = findFirst(cell, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(editArea.text, "POV…");
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

test("Plan — Objectif seul : la cellule objectif fonctionne indépendamment des mots", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { goal: 1200 };
  const { view, root } = buildOutlineHarness({ children: [file] });
  view.wcMap = new Map([[file.path, 0]]);
  view.outlineColumns = { synopsis: false, pov: false, label: false, status: false, tags: false, date: false, words: false, goal: true };

  const table = new FakeElement();
  await view.renderOutlineLevel(table, root, 0, new Map(), () => {}, view.visibleCols(), { count: 0 }, 1);

  const goalCell = findFirst(table, (el) => el.classes.has("feuillets-cell-goal"));
  assert.equal(goalCell.text, "1200");
  assert.equal(findAll(table, (el) => el.classes.has("feuillets-cell-words")).length, 0);
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
  assert.equal(findFirst(table, (el) => el.classes.has("feuillets-cell-goal")).text, "2000");
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

/* ===================== TIMELINE — édition inline (renderTimelineInner) ===================== */

function buildTimelineHarness({ children = [] } = {}) {
  const root = new TFolder("Projet/Chronologie");
  root.children = children;
  for (const c of children) c.parent = root;

  const chronoFolder = new TFolder("Projet/Chronologie/Jalons");
  chronoFolder.children = [];

  const app = { workspace: {} };
  const plugin = {
    settings: { timelineOrder: "chrono", timelineTagFilter: "", collapsed: {} },
    flattenFiles: (folder) => folder === root ? children : [],
    isFrontMatter: () => false,
    fmOf: (file) => file.__fm || {},
    shortTitleFor: (file) => file.basename,
    getChronoFolder: () => chronoFolder,
    tagsOf: () => [],
    saveSettings: async () => {},
  };
  const view = new BoardView({ app, contentEl: new FakeElement() }, plugin);
  view.passesFilter = () => true;
  view._renderGen = 1;

  // Mock parseStoryDate pour un fonctionnement cohérent des tests
  view._originalParseStoryDate = null;
  return { view, root, chronoFolder, app, plugin };
}

test("Timeline — date n'est plus un simple texte statique, rendu initial affiche item.display", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" };
  const { view, root } = buildTimelineHarness({ children: [file] });

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const dateContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-date"));
  assert.ok(dateContainer, "conteneur timeline-date attendu");

  const dateDisplay = findFirst(dateContainer, (el) => el.classes.has("feuillets-timeline-date-display"));
  assert.ok(dateDisplay, "élément statique de date attendu");

  const textarea = findFirst(dateContainer, (el) => el.tag === "textarea");
  assert.equal(textarea, undefined, "textarea non présent au rendu initial");
});

test("Timeline — rendu statique initial utilise item.display pour la date", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" };
  const { view, root } = buildTimelineHarness({ children: [file] });

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  // Vérifier que la date s'affiche (item.display devrait contenir quelque chose)
  const dateContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-date"));
  const dateDisplay = findFirst(dateContainer, (el) => el.classes.has("feuillets-timeline-date-display"));
  assert.ok(dateDisplay.text.length > 0, "item.display n'est pas vide");
});

test("Timeline — textarea d'édition de date reçoit la valeur YAML brute", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" };
  const { view, root } = buildTimelineHarness({ children: [file] });

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const dateContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-date"));
  const dateDisplay = findFirst(dateContainer, (el) => el.classes.has("feuillets-timeline-date-display"));

  // Simuler le clic pour afficher le textarea
  await dateDisplay.trigger("click");

  const textarea = findFirst(dateContainer, (el) => el.tag === "textarea");
  assert.ok(textarea, "textarea créé au clic");
  assert.equal(textarea.value, "1789-07-14", "textarea initialisé avec valeur YAML brute");
  assert.ok(textarea.classes.has("feuillets-flat-textarea"), "textarea a classe feuillets-flat-textarea");
  assert.ok(textarea.classes.has("feuillets-autosize"), "textarea a classe feuillets-autosize");
});

test("Timeline — sauvegarde d'une nouvelle date appelle setFm avec clé 'date'", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" };
  const { view, root } = buildTimelineHarness({ children: [file] });

  let setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f: f.path, k, v }); };
  view.render = async () => {};

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const dateContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-date"));
  const dateDisplay = findFirst(dateContainer, (el) => el.classes.has("feuillets-timeline-date-display"));
  await dateDisplay.trigger("click");

  const textarea = findFirst(dateContainer, (el) => el.tag === "textarea");
  textarea.value = "1812-12-25";
  await textarea.trigger("blur");

  const dateCall = setFmCalls.find(c => c.k === "date");
  assert.ok(dateCall, "setFm appelé avec clé 'date'");
  assert.equal(dateCall.v, "1812-12-25", "nouvelle date sauvegardée");
});

test("Timeline — vraie modification de date déclenche render(true)", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" };
  const { view, root } = buildTimelineHarness({ children: [file] });

  let renderCalls = [];
  view.setFm = async () => {};
  view.render = async (force) => { renderCalls.push(force); };

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const dateContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-date"));
  const dateDisplay = findFirst(dateContainer, (el) => el.classes.has("feuillets-timeline-date-display"));
  await dateDisplay.trigger("click");

  const textarea = findFirst(dateContainer, (el) => el.tag === "textarea");
  textarea.value = "1812-12-25";
  await textarea.trigger("blur");

  assert.ok(renderCalls.includes(true), "render(true) déclenché après modification de date");
});

test("Timeline — date inchangée ne déclenche pas de rerender inutile", async () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" };
  const { view, root } = buildTimelineHarness({ children: [file] });

  let renderCalls = [];
  view.setFm = async () => {};
  view.render = async (force) => { renderCalls.push(force); };

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const dateContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-date"));
  const dateDisplay = findFirst(dateContainer, (el) => el.classes.has("feuillets-timeline-date-display"));
  await dateDisplay.trigger("click");

  const textarea = findFirst(dateContainer, (el) => el.tag === "textarea");
  textarea.value = "1789-07-14"; // valeur inchangée
  await textarea.trigger("blur");

  assert.equal(renderCalls.length, 0, "render() ne doit pas être appelé si la date n'a pas changé");
});

test("Timeline — synopsis utilise makeClickToEditFmArea", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14", synopsis: "Un court résumé." };
  const { view, root } = buildTimelineHarness({ children: [file] });

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const synopsisContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-syn"));
  assert.ok(synopsisContainer, "conteneur synopsis attendu");

  const synopsisCell = findFirst(synopsisContainer, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.ok(synopsisCell, "cellule d'édition inline du synopsis attendue (makeClickToEditFmArea)");
  assert.equal(synopsisCell.text, "Un court résumé.");
});

test("Timeline — synopsis est rendu même quand il est vide", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" }; // pas de synopsis
  const { view, root } = buildTimelineHarness({ children: [file] });

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const synopsisContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-syn"));
  assert.ok(synopsisContainer, "conteneur synopsis présent même si synopsis est vide");

  const synopsisCell = findFirst(synopsisContainer, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.ok(synopsisCell, "cellule synopsis présente même si vide");
});

test("Timeline — synopsis utilise le placeholder existant", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" }; // pas de synopsis
  const { view, root } = buildTimelineHarness({ children: [file] });

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const synopsisContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-syn"));
  const synopsisCell = findFirst(synopsisContainer, (el) => el.classes.has("feuillets-flat-text-cell"));
  // Le placeholder devrait être affiché (l'élément aura la classe is-empty)
  assert.ok(synopsisCell.classes.has("is-empty"), "classe is-empty appliquée au placeholder");
});

test("Timeline — synopsis reste multilignes et autosize (maxLines=6)", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14", synopsis: "Un\nsynnopsis\nmultilignes." };
  const { view, root } = buildTimelineHarness({ children: [file] });

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const synopsisContainer = findFirst(container, (el) => el.classes.has("feuillets-timeline-syn"));
  const synopsisCell = findFirst(synopsisContainer, (el) => el.classes.has("feuillets-flat-text-cell"));
  assert.ok(synopsisCell.classes.has("feuillets-clamp-text"), "classe clamp-text présente");
  assert.equal(synopsisCell.style._props["--max-lines"], "6", "maxLines=6 configuré via CSS var");
});

test("Timeline — titre continue d'utiliser openFileActivating", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  file.__fm = { date: "1789-07-14" };
  const { view, root } = buildTimelineHarness({ children: [file] });

  const container = new FakeElement();
  view.renderTimelineInner(container, root, new Map());

  const titleSpan = findFirst(container, (el) => el.classes.has("feuillets-timeline-title"));
  assert.ok(titleSpan, "élément titre trouvé");
  assert.ok(titleSpan.events.has("click"), "écouteur click présent sur le titre");
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
