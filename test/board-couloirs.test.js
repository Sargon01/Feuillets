import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TFile, TFolder, Menu } from "obsidian";
import { BoardView } from "../src/views/board-view.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { fr } from "../src/i18n/fr.js";
import { en } from "../src/i18n/en.js";

/* ===================== LOT 5C VISUEL — COULOIRS (sous-vue « lanes ») =====================
   Finalisation visuelle/ergonomique de Couloirs, sans toucher à la logique
   métier validée :
   - sélecteur COMPACT de sous-vue : une seule pilule (icône + libellé de la
     sous-vue COURANTE + chevron) qui ouvre un Menu Obsidian natif (Trame
     waypoint / Couloirs rows-3, entrée courante cochée via setChecked) ;
   - barre d'axe Couloirs = la MÊME grammaire que la barre de filtres Trame
     (feuillets-arcs-filter-bar / feuillets-arcs-filter-btn), utilisée comme
     sélecteur EXCLUSIF de l'axe (aria-pressed + classe feuillets-lanes-axis-
     active, PAS is-active) — ordre imposé Label, Personnage, Fil, Pov, et
     bouton « + » contextuel à l'axe actif ;
   - quatrième axe Personnage (LaneAxis "character") : fm.characters via
     getPersonnagesList (même mécanisme que Trame), multi-valeurs, ligne
     « Sans personnage » toujours en dernier, drag à membres seuls ;
   - synopsis/résumé RÉEL dans les cartes : champ sémantique du projet
     (lanesPlanningField : synopsis Fiction, résumé sinon), PAS la préférence
     d'affichage currentCardContent ;
   - cartes compactes 190 × 110 (slot 208), bande continue unique ;
   - i18n : plus d'axe/addLine, ajouts noCharacter/newCharacter/add* ;
   - non-régression : laneAxis/narrativeSubview restent de session, le drag
     ne réordonne jamais, Trame inchangée, registre stable. */

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
    this.parentNode = {};
    /* Positions de scroll simulées (initialisées à 0) — nécessaires au test de
       reconstruction du viewport Couloirs (scrollLeft/scrollTop restaurés). */
    this.scrollLeft = 0;
    this.scrollTop = 0;
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    child.parentNode = this;
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

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function cssRule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

/* ----- Harness de rendu plein (barre narrative + routing de sous-vues) ----- */

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

/* ----- Harness de rendu Couloirs (contenu des lignes/cartes) ----- */

function mkLaneFile(name, fm) {
  const file = new TFile(`Projet/Manuscrit/${name}.md`);
  file.__fm = fm || {};
  return file;
}

function buildLanesHarness({ files = [] } = {}) {
  const root = new TFolder("Projet/Manuscrit");
  root.children = files;
  for (const f of files) f.parent = root;
  const leaf = { openFile: async () => {} };
  const app = {
    workspace: { getLeaf: () => leaf, setActiveLeaf: () => {} },
    vault: { getAbstractFileByPath: (path) => files.find((f) => f.path === path) || null },
  };
  const plugin = {
    settings: {},
    flattenFiles: (folder) => (folder === root ? files : []),
    isFrontMatter: () => false,
    /* fmOf applique les ALIAS HÉRITÉS comme le vrai plugin (withLegacyFieldAliases :
       personnages/persos → characters, fil → thread) — sinon getPersonnagesList ne
       lirait que la clé canonique characters. */
    fmOf: (file) => {
      const raw = file.__fm || {};
      const out = { ...raw };
      if (out.characters === undefined) {
        if (out.personnages !== undefined) out.characters = out.personnages;
        else if (out.persos !== undefined) out.characters = out.persos;
      }
      if (out.thread === undefined && out.fil !== undefined) out.thread = out.fil;
      return out;
    },
    shortTitleFor: (file) => file.basename,
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
  return { view, root, files, app, leaf, plugin };
}

function renderCouloirs(view, root) {
  const container = new FakeElement();
  view.renderCouloirs(container, root, root, true, new Map());
  return container;
}

/* LOT 5C structure : les noms de lignes vivent dans le GUTTER fixe
   (feuillets-lanes-gutter-label), les pistes dans le canevas (feuillets-lanes-
   row). Le rendu crée les deux nœuds jumeaux dans le MÊME ordre (mêmes
   itérations) : la piste d'une ligne est retrouvée par l'index de son libellé
   dans le gutter (§19). */
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

function lanesLabels(container) {
  return findAll(container, (el) => el.classes.has("feuillets-lanes-gutter-label")).map((l) => l.text);
}

/* ===================== A. SÉLECTEUR COMPACT DE SOUS-VUE ===================== */

test("LOT5C-VISUEL — mode arcs : barre narrative avec un SEUL sélecteur compact (pilule icône+libellé+chevron)", async () => {
  const { view, contentEl } = buildNarrativeHarness({ boardMode: "arcs" });
  await view.render(true);
  const bar = narrativeBar(contentEl);
  assert.ok(bar, "barre narrative présente en mode arcs");
  assert.equal(bar.parentNode, contentEl, "la barre est un contrôle de niveau vue, direct enfant du conteneur");
  const selectors = findAll(bar, (el) => el.classes.has("feuillets-narrative-subview-btn"));
  assert.equal(selectors.length, 1, "un SEUL sélecteur compact (plus de 3 boutons sous-vues)");
  const sel = selectors[0];
  const iconHost = findFirst(sel, (el) => el.classes.has("feuillets-narrative-btn-icon"));
  const label = findFirst(sel, (el) => el.classes.has("feuillets-narrative-btn-label"));
  const chevron = findFirst(sel, (el) => el.classes.has("feuillets-narrative-btn-chevron"));
  assert.ok(iconHost && label && chevron, "icône + libellé + chevron présents dans la pilule");
  assert.equal(iconHost.icon, "waypoint", "face Trame (sous-vue courante par défaut) : icône waypoint");
  assert.equal(label.text, "Trame", "libellé courant");
  assert.equal(chevron.icon, "chevron-down", "chevron signalant le Menu");
  /* Plus AUCUN groupe Axe / libellé « Axe » dans la barre : l'axe vit dans le
     contenu de Couloirs. */
  assert.equal(findAll(bar, (el) => el.classes.has("feuillets-narrative-axis-group")).length, 0, "plus de capsule Axe dans la barre");
  assert.equal(findAll(bar, (el) => el.classes.has("feuillets-narrative-axis-label")).length, 0, "plus de libellé « Axe »");
  assert.equal(findAll(bar, (el) => el.classes.has("feuillets-narrative-sep")).length, 0, "plus de séparateurs de groupe");
});

test("LOT5C-VISUEL — clic sur le sélecteur : Menu natif exactement Trame/Couloirs, courant cochée, aucune Grille", async () => {
  const { view, contentEl } = buildNarrativeHarness({ boardMode: "arcs" });
  await view.render(true);
  const sel = findFirst(contentEl, (el) => el.classes.has("feuillets-narrative-subview-btn"));
  Menu.lastShown = null;
  await sel.trigger("click", { clientX: 1, clientY: 2 });
  const menu = Menu.lastShown;
  assert.ok(menu, "Menu ouvert par le clic");
  assert.equal(menu.items.length, 2, "exactement deux entrées de sous-vue (Trame, Couloirs)");
  const [trame, lanes] = menu.items;
  assert.deepEqual([trame.title, trame.icon], ["Trame", "waypoint"]);
  assert.deepEqual([lanes.title, lanes.icon], ["Couloirs", "rows-3"]);
  assert.equal(trame.checked, true, "entrée courante (Trame) cochée via le Menu natif");
  assert.equal(lanes.checked, false, "Couloirs non cochée");
  assert.equal(menu.items.some((i) => i.icon === "grid-3x3"), false, "aucune icône grid-3x3");
  assert.equal(menu.items.some((i) => i.title === "Grille"), false, "aucune entrée Grille");
  /* Choisir Couloirs dans le Menu → bascule de sous-vue. */
  lanes.callback();
  assert.equal(view.narrativeSubview, "lanes", "sous-vue changée par le Menu");
});

test("LOT5C-VISUEL — la face du sélecteur reflète la sous-vue courante (Couloirs → rows-3, label Couloirs)", async () => {
  const { view, contentEl } = buildNarrativeHarness({ boardMode: "arcs" });
  view.narrativeSubview = "lanes";
  await view.render(true);
  const sel = findFirst(contentEl, (el) => el.classes.has("feuillets-narrative-subview-btn"));
  const iconHost = findFirst(sel, (el) => el.classes.has("feuillets-narrative-btn-icon"));
  const label = findFirst(sel, (el) => el.classes.has("feuillets-narrative-btn-label"));
  assert.equal(iconHost.icon, "rows-3", "icône de la sous-vue courante (Couloirs)");
  assert.equal(label.text, "Couloirs", "libellé de la sous-vue courante");
  Menu.lastShown = null;
  await sel.trigger("click", { clientX: 1, clientY: 2 });
  const menu = Menu.lastShown;
  assert.equal(menu.items[0].checked, false, "Trame non cochée");
  assert.equal(menu.items[1].checked, true, "Couloirs cochée (courante)");
});

/* ===================== B. BARRE D'AXE (même grammaire que Trame) ===================== */

function axisBar(container) {
  return findFirst(container, (el) => el.classes.has("feuillets-arcs-filter-bar"));
}

function axisBtnLabels(bar) {
  return findAll(bar, (el) => el.classes.has("feuillets-arcs-filter-btn")).map((b) =>
    findFirst(b, (el) => el.classes.has("feuillets-arcs-filter-btn-label")).text
  );
}

test("LOT5C-VISUEL — barre d'axe en Couloirs : même grammaire que Trame, ordre imposé Label, Personnage, Fil, Pov", () => {
  const files = [mkLaneFile("A", { label: "rouge" })];
  const { view, root } = buildLanesHarness({ files });
  const container = renderCouloirs(view, root);
  const bar = axisBar(container);
  assert.ok(bar, "barre d'axe présente en haut du contenu Couloirs (même classe que la barre de filtres Trame)");
  assert.deepEqual(
    axisBtnLabels(bar),
    ["Label", "Personnage", "Fil", "Pov"],
    "ordre imposé : Label, Personnage, Fil, Pov (exactement l'ordre des boutons de filtres Trame)"
  );
  const btns = findAll(bar, (el) => el.classes.has("feuillets-arcs-filter-btn"));
  /* Icônes = les mêmes que la barre Trame (map-pin/users/route/eye). */
  assert.deepEqual(
    btns.map((b) => findFirst(b, (el) => el.icon)?.icon),
    ["map-pin", "users", "route", "eye"]
  );
  /* Pas de libellé « Axe » ni de groupe Axe résiduel. */
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-narrative-axis-group")).length, 0, "plus de capsule Axe");
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-narrative-axis-label")).length, 0, "plus de libellé « Axe »");
});

test("LOT5C-VISUEL — axe actif : aria-pressed + classe dédiée feuillets-lanes-axis-active (PAS is-active)", () => {
  const files = [mkLaneFile("A", { label: "rouge" })];
  const { view, root } = buildLanesHarness({ files });
  const container = renderCouloirs(view, root);
  const btns = findAll(axisBar(container), (el) => el.classes.has("feuillets-arcs-filter-btn"));
  assert.equal(btns[0].getAttr("aria-pressed"), "true", "Label actif par défaut");
  assert.ok(btns[0].classes.has("feuillets-lanes-axis-active"), "classe dédiée d'axe actif posée");
  assert.equal(btns[0].classes.has("is-active"), false, "PAS is-active (réservé aux filtres Trame)");
  for (const btn of btns.slice(1)) {
    assert.equal(btn.getAttr("aria-pressed"), "false", "axes inactifs : aria-pressed false");
    assert.equal(btn.classes.has("feuillets-lanes-axis-active"), false);
  }
  /* Changer d'axe : clic sur Personnage → laneAxis = character, re-rendu avec l'actif déplacé. */
  btns[1].trigger("click");
  assert.equal(view.laneAxis, "character", "axe changé en session");
  view.render = async () => {};
  const container2 = renderCouloirs(view, root);
  const btns2 = findAll(axisBar(container2), (el) => el.classes.has("feuillets-arcs-filter-btn"));
  assert.ok(btns2[1].classes.has("feuillets-lanes-axis-active"), "Personnage actif après changement");
  assert.equal(btns2[0].classes.has("feuillets-lanes-axis-active"), false, "Label redevenu inactif");
});

test("LOT5C-VISUEL — bouton « + » contextuel à l'axe actif (uniquement en Couloirs)", () => {
  const files = [mkLaneFile("A", { label: "rouge" })];
  const { view, root } = buildLanesHarness({ files });
  let container = renderCouloirs(view, root);
  let plus = findAll(axisBar(container), (el) => el.tag === "button" && el.icon === "plus")[0];
  assert.ok(plus, "« + » présent dans la barre d'axe");
  assert.equal(plus.tooltip, "Ajouter un label", "tooltip contextuel à l'axe Label");
  view.laneAxis = "character";
  container = renderCouloirs(view, root);
  plus = findAll(axisBar(container), (el) => el.tag === "button" && el.icon === "plus")[0];
  assert.equal(plus.tooltip, "Ajouter un personnage", "tooltip contextuel à l'axe Personnage");
  view.laneAxis = "thread";
  container = renderCouloirs(view, root);
  plus = findAll(axisBar(container), (el) => el.tag === "button" && el.icon === "plus")[0];
  assert.equal(plus.tooltip, "Ajouter un fil", "tooltip contextuel à l'axe Fil");
  view.laneAxis = "pov";
  container = renderCouloirs(view, root);
  plus = findAll(axisBar(container), (el) => el.tag === "button" && el.icon === "plus")[0];
  assert.equal(plus.tooltip, "Ajouter un pov", "tooltip contextuel à l'axe Pov");
  /* En Trame (renderCheminDeFer), la barre d'axe Couloirs n'existe pas. */
  view.renderLanesAxisBar = undefined;
  assert.equal(typeof view.renderLanesAxisBar, "undefined", "pas de barre d'axe hors Couloirs (le rendu Trame ne l'appelle pas)");
});

test("LOT5C-VISUEL — barre d'axe : l'ordre Label, Personnage, Fil, Pov est le même que la barre de filtres Trame", async () => {
  /* Les libellés viennent de board.arcs.*FilterName — une seule source de
     vocabulaire partagée avec Trame. */
  const { view, contentEl } = buildNarrativeHarness({ boardMode: "arcs" });
  await view.render(true);
  /* Trame n'a PAS de barre d'axe (elle a sa barre de filtres, testée ailleurs). */
  const lanesFiles = [mkLaneFile("A", { label: "rouge" })];
  const { view: lanesView, root } = buildLanesHarness({ files: lanesFiles });
  const container = renderCouloirs(lanesView, root);
  assert.deepEqual(axisBtnLabels(axisBar(container)), ["Label", "Personnage", "Fil", "Pov"]);
  /* Aucun lien entre la barre narrative et l'axe : l'axe n'y apparaît plus. */
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-arcs-filter-btn")).length, 0, "aucun bouton d'axe dans la barre narrative");
});

/* ===================== C. QUATRIÈME AXE PERSONNAGE ===================== */

test("LOT5C-VISUEL — axe Personnage : lignes par fm.characters (multi-valeurs, alias compris), 'Sans personnage' en dernier", () => {
  const files = [
    mkLaneFile("A", { characters: ["Kemal", "Arif"] }),
    mkLaneFile("B", { personnages: "Sophie" }),
    mkLaneFile("C", { persos: ["Kemal"] }),
    mkLaneFile("D", {}),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "character";
  const container = renderCouloirs(view, root);
  assert.deepEqual(
    lanesLabels(container),
    ["Kemal", "Arif", "Sophie", "Sans personnage"],
    "multi-valeurs, première apparition dans l'ordre narratif, Sans personnage toujours en dernier"
  );
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "Kemal")[0])).text, "A", "A dans Kemal (index 0)");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "Kemal")[2])).text, "C", "C dans Kemal (index 2)");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "Arif")[0])).text, "A", "A dans Arif (multi-valeurs)");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "Sophie")[1])).text, "B", "B dans Sophie via l'alias personnages");
  assert.equal(cardInSlot(laneSlots(container, "Kemal")[3]), undefined, "slot 3 vide (D sans personnage)");
  assert.equal(cardTitle(cardInSlot(laneSlots(container, "Sans personnage")[3])).text, "D", "D sans personnage → ligne Sans personnage");
});

test("LOT5C-VISUEL — axe Personnage : bande colorée via characterLaneColor, distincte de Pov, Sans personnage neutre", () => {
  /* Le feuillet porte AUSSI un pov pour pouvoir comparer les deux axes sur le
     même nom de ligne. */
  const files = [mkLaneFile("A", { characters: ["Kemal"], pov: "Kemal" })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "character";
  const container = renderCouloirs(view, root);
  const kemal = laneLine(laneRow(container, "Kemal")).style._props["--feuillets-lane-color"];
  assert.ok(kemal && /^hsl\(\d+, 55%, 42%\)$/.test(kemal), `bande Personnage via characterLaneColor : ${kemal}`);
  assert.equal(laneLine(laneRow(container, "Sans personnage")).style._props["--feuillets-lane-color"], undefined, "Sans personnage : neutre native");
  /* Distincte de Pov : même nom → teinte commune mais saturation/limpidité
     différentes (55/42 vs 45/40). */
  view.laneAxis = "pov";
  const povContainer = renderCouloirs(view, root);
  const povColor = laneLine(laneRow(povContainer, "Kemal")).style._props["--feuillets-lane-color"];
  assert.notEqual(kemal, povColor, "couleur Personnage ≠ couleur Pov pour le même nom");
});

test("LOT5C-VISUEL — drag axe Personnage : setFm(file, 'characters', …) retiré/ajouté, ordre préservé", async () => {
  const files = [
    mkLaneFile("A", { characters: ["Kemal", "Arif"] }),
    mkLaneFile("B", { characters: "Sophie" }),
  ];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "character";
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async () => { renderCalls.push(true); };
  const container = renderCouloirs(view, root);
  const card = cardInSlot(laneSlots(container, "Kemal")[0]); // A, source = "Kemal"
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Sophie")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, 1, "setFm appelé une fois");
  assert.equal(setFmCalls[0].k, "characters", "clé frontmatter characters en axe Personnage");
  assert.deepEqual(setFmCalls[0].v, ["Arif", "Sophie"], "[Kemal,Arif] Kemal→Sophie = [Arif,Sophie] — ordre préservé");
  assert.deepEqual(renderCalls, [true], "render(true) après sauvegarde");
});

test("LOT5C-VISUEL — drop sur sa propre ligne Personnage : aucune écriture, aucun render", async () => {
  const files = [mkLaneFile("A", { characters: ["Kemal"] })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "character";
  const setFmCalls = [];
  const renderCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  view.render = async () => { renderCalls.push(true); };
  const container = renderCouloirs(view, root);
  const card = cardInSlot(laneSlots(container, "Kemal")[0]);
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Kemal")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, 0, "source === cible → aucune écriture");
  assert.equal(renderCalls.length, 0);
});

test("LOT5C-VISUEL — NewLaneModal axe Personnage : placeholder « Nouveau personnage »", () => {
  /* Le placeholder est privé ; on vérifie la chaîne i18n utilisée. */
  assert.equal(fr["board.lanes.newCharacter"], "Nouveau personnage", "placeholder FR Personnage");
  assert.equal(en["board.lanes.newCharacter"], "New character", "placeholder EN Personnage");
});

/* ===================== D. SYNOPSIS / RÉSUMÉ RÉEL ===================== */

function cardTitle(card) {
  return findFirst(card, (el) => el.classes.has("feuillets-lanes-card-title"));
}

test("LOT5C-VISUEL — synopsis lue dans le champ SÉMANTIQUE du projet, pas dans la préférence d'affichage", () => {
  const files = [mkLaneFile("A", { synopsis: "Synopsis de A.", summary: "Résumé long de A." })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "pov";
  /* Cas critique : l'utilisateur a choisi « Extrait » pour les cartes du Board
     (currentCardContent = "extrait") — la synopsis Fiction doit rester lue. */
  view.currentCardContent = "extrait";
  view.runtimePlanningField = "synopsis";
  let container = renderCouloirs(view, root);
  const card = findFirst(container, (el) => el.classes.has("feuillets-lanes-card"));
  const synopsis = findFirst(card, (el) => el.classes.has("feuillets-lanes-card-synopsis"));
  assert.ok(synopsis, "synopsis rendue malgré currentCardContent = extrait");
  assert.equal(synopsis.text, "Synopsis de A.", "champ sémantique Fiction = synopsis");
  /* Non-fiction / Libre → résumé long. */
  view.runtimePlanningField = "summary";
  container = renderCouloirs(view, root);
  const synopsis2 = findFirst(findFirst(container, (el) => el.classes.has("feuillets-lanes-card")), (el) => el.classes.has("feuillets-lanes-card-synopsis"));
  assert.equal(synopsis2.text, "Résumé long de A.", "champ sémantique Non-fiction = summary");
  /* Sans synopsis → aucun nœud ni espace réservé. */
  view.runtimePlanningField = "synopsis";
  const files2 = [mkLaneFile("B", { pov: "Deli" })];
  const { view: v2, root: r2 } = buildLanesHarness({ files: files2 });
  v2.laneAxis = "pov";
  const container2 = renderCouloirs(v2, r2);
  const card2 = findFirst(container2, (el) => el.classes.has("feuillets-lanes-card"));
  assert.equal(findAll(card2, (el) => el.classes.has("feuillets-lanes-card-synopsis")).length, 0, "pas de nœud synopsis si absente");
});

/* ===================== E. CARTES COMPACTES / BANDE CONTINUE ===================== */

test("LOT5C-VISUEL CSS — cartes compactes 190 × 110 (largeur > hauteur), slot 208, bande 4px continue", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  /* LOT 5C structure : les variables de géométrie vivent sur .feuillets-lanes-
     area (ancêtre commun du gutter et du canevas). */
  const lanesBlock = cssRule(css, ".feuillets-lanes-area");
  assert.ok(lanesBlock.includes("--feuillets-lane-card-w: 190px"), "largeur de carte compacte 190px");
  assert.ok(lanesBlock.includes("--feuillets-lane-card-h: 110px"), "hauteur de carte compacte 110px");
  assert.ok(lanesBlock.includes("--feuillets-lane-slot-w: 208px"), "slot = carte + gap (208px)");
  const slot = cssRule(css, ".feuillets-lanes-slot");
  assert.ok(slot.includes("flex: 0 0 var(--feuillets-lane-slot-w)"), "slot à l'empreinte var(--feuillets-lane-slot-w)");
  assert.ok(slot.includes("height: var(--feuillets-lane-card-h)"), "slot à la hauteur de carte");
  const card = cssRule(css, ".feuillets-lanes-card");
  assert.ok(card.includes("width: var(--feuillets-lane-card-w)"), "carte = variable largeur");
  assert.ok(card.includes("height: var(--feuillets-lane-card-h)"), "carte = variable hauteur");
  const line = cssRule(css, ".feuillets-lane-line");
  assert.ok(line.includes("left: 0") && line.includes("right: 0"), "bande continue sur toute la largeur narrative");
  assert.ok(line.includes("z-index: 0"), "bande au fond (derrière les cartes)");
  assert.ok(line.includes("height: 4px"), "bande de 4px");
  assert.ok(card.includes("z-index: 1"), "carte opaque devant la bande");
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(line), false, "aucune couleur hex dans la bande");
});

test("LOT5C-VISUEL CSS — barre d'axe : classe d'axe actif dédiée, discrets, sans couleur codée ni !important", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  const active = cssRule(css, ".feuillets-lanes-axis-active");
  assert.ok(active.includes("color: var(--text-normal)"), "texte affirmé pour l'axe actif");
  assert.ok(active.includes("background: var(--background-modifier-hover)"), "fond discret natif");
  assert.equal(active.includes("!important"), false, "aucun !important");
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(active), false, "aucune couleur codée en dur");
  /* Le sélecteur compact et le chevron existent ; les anciens contrôles Axe
     (capsule, séparateurs, libellé) ont disparu. */
  assert.ok(css.includes(".feuillets-narrative-subview-btn"), "sélecteur compact présent");
  assert.ok(css.includes(".feuillets-narrative-btn-chevron"), "chevron présent");
  assert.equal(css.includes(".feuillets-narrative-axis-group"), false, "plus de capsule Axe");
  assert.equal(css.includes(".feuillets-narrative-sep"), false, "plus de séparateurs de groupe");
  assert.equal(css.includes(".feuillets-narrative-axis-label"), false, "plus de libellé « Axe »");
});

test("LOT5C-VISUEL DOM — une seule bande continue par ligne, derrière les cartes opaques", () => {
  const files = [
    mkLaneFile("A", { label: "rouge" }),
    mkLaneFile("B", { label: "vert" }),
    mkLaneFile("C", {}),
  ];
  const { view, root } = buildLanesHarness({ files });
  const container = renderCouloirs(view, root);
  for (const label of ["rouge", "vert", "Sans label"]) {
    const row = laneRow(container, label);
    assert.ok(laneLine(row), `${label} : bande présente`);
    assert.equal(findAll(laneTrack(row), (el) => el.classes.has("feuillets-lane-line")).length, 1, `${label} : exactement UNE bande continue`);
  }
  /* Chaque slot garde l'empreinte d'une carte (position narrative en colonne i). */
  const rouge = laneSlots(container, "rouge");
  assert.equal(rouge.length, files.length, "autant de slots que de feuillets visibles");
  for (let i = 0; i < rouge.length; i++) assert.equal(Number(rouge[i].getAttr("data-index")), i, `slot à l'index narratif ${i}`);
});

/* ===================== E-bis. STRUCTURE : toolbar/gutter/canevas =====================
   LOT 5C micro-correctif — architecture à deux niveaux (§6) :
     niveau vue (HORS scroll) : sélecteur de sous-vue, barre d'axe ;
     zone de couloirs : gutter fixe + canevas horizontal scrollable.
   La barre Label·Personnage·Fil·Pov·+ ne part JAMAIS avec le canevas ; une
   SEULE scrollbar horizontale (celle du canevas). */

test("LOT5C-VISUEL structure — barre d'axe ET sélecteur de sous-vue HORS du scroll horizontal, canevas DANS le scroll", async () => {
  /* Couloirs : la barre d'axe est un contrôle de niveau vue (parent =
     conteneur de la vue), le canevas narratif est dans le horizontal-scroll,
     et aucun bouton d'axe n'existe dans le scroll. */
  const files = [mkLaneFile("A", { label: "rouge" })];
  const { view, root } = buildLanesHarness({ files });
  const container = renderCouloirs(view, root);
  const scroll = findFirst(container, (el) => el.classes.has("feuillets-lanes-scroll"));
  assert.ok(scroll, "horizontal-scroll présent (SEULE zone de scroll horizontal)");
  const canvas = findFirst(scroll, (el) => el.classes.has("feuillets-lanes"));
  assert.ok(canvas, "canevas narratif présent");
  assert.equal(canvas.parentNode, scroll, "le canevas est enfant DIRECT du horizontal-scroll");
  const bar = axisBar(container);
  assert.ok(bar, "barre d'axe présente");
  assert.equal(bar.parentNode, container, "la barre d'axe est au niveau de la vue, hors du scroll");
  assert.equal(findAll(scroll, (el) => el.classes.has("feuillets-arcs-filter-btn")).length, 0, "aucun bouton d'axe dans le scroll horizontal");
  /* Sélecteur de sous-vue : au niveau de la vue (jamais dans un scroll). */
  const { view: nv, contentEl } = buildNarrativeHarness({ boardMode: "arcs" });
  nv.narrativeSubview = "lanes";
  await nv.render(true);
  const navBar = narrativeBar(contentEl);
  assert.ok(navBar, "sélecteur de sous-vue présent");
  assert.equal(navBar.parentNode, contentEl, "le sélecteur de sous-vue est au niveau de la vue");
  assert.equal(findAll(navBar, (el) => el.classes.has("feuillets-lanes-scroll")).length, 0, "le sélecteur n'est jamais dans un scroll");
});

test("LOT5C-VISUEL structure — gutter séparé du canevas : noms dans le gutter, pistes dans le canevas, hors de la largeur narrative", () => {
  const files = [mkLaneFile("A", { label: "rouge" }), mkLaneFile("B", { label: "vert" })];
  const { view, root } = buildLanesHarness({ files });
  const container = renderCouloirs(view, root);
  const gutter = findFirst(container, (el) => el.classes.has("feuillets-lanes-gutter"));
  const scroll = findFirst(container, (el) => el.classes.has("feuillets-lanes-scroll"));
  assert.ok(gutter && scroll, "gutter et horizontal-scroll présents");
  assert.notEqual(gutter.parentNode, scroll, "le gutter n'est PAS dans le scroll (séparé du canevas)");
  assert.deepEqual(
    findAll(gutter, (el) => el.classes.has("feuillets-lanes-gutter-label")).map((l) => l.text),
    ["rouge", "vert", "Sans label"],
    "noms de lignes dans le gutter"
  );
  assert.equal(gutterLabel(container, "vert").text, "vert", "libellé retrouvé dans le gutter");
  const canvas = findFirst(container, (el) => el.classes.has("feuillets-lanes"));
  const rows = findAll(canvas, (el) => el.classes.has("feuillets-lanes-row"));
  assert.equal(rows.length, 3, "autant de pistes que de lignes dans le canevas");
  assert.equal(findAll(container, (el) => el.classes.has("feuillets-lanes-label")).length, 0, "plus de libellé dans les pistes (il vit dans le gutter)");
  /* Une seule bande par piste, dans le canevas (pas dans le gutter, pas dans un slot). */
  for (const row of rows) {
    const track = laneTrack(row);
    assert.equal(findAll(track, (el) => el.classes.has("feuillets-lane-line")).length, 1, "exactement UNE bande par piste");
  }
  assert.equal(findAll(gutter, (el) => el.classes.has("feuillets-lane-line")).length, 0, "aucune bande dans le gutter");
  const totalSlots = rows.reduce((n, row) => n + findAll(laneTrack(row), (el) => el.classes.has("feuillets-lanes-slot")).length, 0);
  assert.ok(totalSlots > 0, "les pistes portent les slots");
});

test("LOT5C-VISUEL structure — bande continue sur TOUTE la piste, slot vide sans fond, carte opaque au-dessus", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  const line = cssRule(css, ".feuillets-lane-line");
  assert.ok(line.includes("left: 0") && line.includes("right: 0"), "la bande couvre toute la largeur narrative de la piste (continue)");
  assert.ok(line.includes("position: absolute"), "bande en nœud absolu dans la piste");
  /* Le VRAI propriétaire de la largeur : left:0/right:0 ne suffisent QUE si
     le track remplit le canevas. La rangée s'étire sur toute la largeur
     (.feuillets-lanes, min-width: 100%) et le track remplit la rangée —
     c'est ce qui pousse la bande jusqu'au bord droit d'un manuscrit court.
     Pour un manuscrit long, min-width: max-content laisse le track dépasser
     sur toute la largeur de ses slots (scroll horizontal normal). */
  const row = cssRule(css, ".feuillets-lanes-row");
  assert.ok(row.includes("width: 100%"), "rangée = propriétaire de la largeur narrative (width: 100%)");
  const track = cssRule(css, ".feuillets-lanes-track");
  assert.ok(track.includes("width: 100%"), "track étiré sur toute la rangée (width: 100%)");
  assert.ok(track.includes("min-width: max-content"), "track libre de dépasser sur ses slots (min-width: max-content, manuscrit long)");
  const slot = cssRule(css, ".feuillets-lanes-slot");
  assert.equal(slot.includes("background"), false, "slot vide : aucun fond (ne masque jamais la bande)");
  assert.equal(slot.includes("border"), false, "slot vide : aucun cadre");
  const card = cssRule(css, ".feuillets-lanes-card");
  assert.ok(card.includes("z-index: 1"), "carte opaque au-dessus de la bande");
  /* DOM : une bande par piste, le slot vide n'en recrée jamais une. */
  const files = [mkLaneFile("A", { label: "rouge" }), mkLaneFile("B", { label: "vert" })];
  const { view, root } = buildLanesHarness({ files });
  const container = renderCouloirs(view, root);
  const canvas = findFirst(container, (el) => el.classes.has("feuillets-lanes"));
  for (const row of findAll(canvas, (el) => el.classes.has("feuillets-lanes-row"))) {
    assert.equal(findAll(row, (el) => el.classes.has("feuillets-lane-line")).length, 1, "exactement UNE bande par lane");
    assert.equal(findAll(laneTrack(row), (el) => el.classes.has("feuillets-lanes-slot")).length, files.length, "autant de slots que de positions narratives");
  }
});

test("LOT5C-VISUEL CSS — une SEULE scrollbar horizontale (canevas), gutter hors scroll, barre d'axe compacte sans space-between", async () => {
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  const scroll = cssRule(css, ".feuillets-lanes-scroll");
  assert.ok(scroll.includes("overflow-x: auto"), "le canevas est la SEULE zone scrollable horizontalement");
  const gutter = cssRule(css, ".feuillets-lanes-gutter");
  assert.ok(gutter.includes("flex-shrink: 0"), "gutter fixe, hors de la largeur narrative défilante");
  const area = cssRule(css, ".feuillets-lanes-area");
  assert.ok(area.includes("display: flex"), "zone à deux niveaux (gutter + canevas)");
  /* Barre d'axe Couloirs : même classe de base que Trame + modificateur compact. */
  const axisBar = cssRule(css, ".feuillets-lanes-axis-bar");
  assert.ok(axisBar, "modificateur de barre Couloirs présent");
  assert.ok(axisBar.includes("justify-content: center"), "barre compacte CENTRÉE");
  assert.equal(axisBar.includes("space-between"), false, "aucun space-between sur la barre Couloirs");
  assert.ok(axisBar.includes("width: fit-content"), "largeur intrinsèque selon le contenu");
  assert.equal(axisBar.includes("width: 100%"), false, "aucun étalement 100% sur la barre Couloirs");
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(axisBar), false, "aucune couleur codée dans la barre Couloirs");
  assert.equal(axisBar.includes("!important"), false, "aucun !important");
});

test("LOT5C-VISUEL CSS/DOM — le scroll vertical Couloirs cache overflow-x : UNE seule scrollbar horizontale RÉELLE", async () => {
  /* §4 : .feuillets-board-scroll a globalement overflow-x: auto ET
     .feuillets-lanes-scroll aussi. Le test historique ne vérifiait que le
     second. Le modificateur feuillets-lanes-vertical-scroll (porté par le
     scrollArea Couloirs) impose overflow-x: hidden : vertical = board-scroll
     + modificateur, horizontal = UNIQUEMENT feuillets-lanes-scroll. La règle
     générale .feuillets-board-scroll (autres modes) reste inchangée. */
  const css = stripCssComments(await readFile("styles.css", "utf8"));
  const vertical = cssRule(css, ".feuillets-lanes-vertical-scroll");
  assert.ok(vertical.includes("overflow-x: hidden"), "le modificateur Couloirs impose overflow-x: hidden (pas de 2e scrollbar)");
  const lanesScroll = cssRule(css, ".feuillets-lanes-scroll");
  assert.ok(lanesScroll.includes("overflow-x: auto"), "feuillets-lanes-scroll reste la SEULE zone overflow-x auto");
  const boardScroll = cssRule(css, ".feuillets-board-scroll");
  assert.ok(boardScroll.includes("overflow-x: auto"), "la règle générale .feuillets-board-scroll est INCHANGÉE (overflow-x auto conservé pour les autres modes)");
  /* DOM : le scrollArea Couloirs porte la classe feuillets-lanes-vertical-scroll
     EN PLUS de feuillets-board-scroll ; le scroll horizontal ne la porte pas. */
  const files = [mkLaneFile("A", { label: "rouge" })];
  const { view, root } = buildLanesHarness({ files });
  const container = renderCouloirs(view, root);
  const verticalScroll = findFirst(container, (el) => el.classes.has("feuillets-lanes-vertical-scroll"));
  assert.ok(verticalScroll, "scrollArea Couloirs porte feuillets-lanes-vertical-scroll");
  assert.ok(verticalScroll.classes.has("feuillets-board-scroll"), "il conserve aussi feuillets-board-scroll (scroll vertical)");
  const horizScroll = findFirst(container, (el) => el.classes.has("feuillets-lanes-scroll"));
  assert.ok(horizScroll, "scroll horizontal présent");
  assert.equal(horizScroll.classes.has("feuillets-lanes-vertical-scroll"), false, "le scroll horizontal ne porte PAS le modificateur vertical");
  /* Structure : le scroll horizontal est UN DESCENDANT du scroll vertical
     (vertical → lanes-area → {gutter, horizontal}) — pas un direct child,
     mais bien DANS la zone verticale. */
  assert.equal(findFirst(verticalScroll, (el) => el.classes.has("feuillets-lanes-scroll")), horizScroll, "le scroll horizontal est DANS le scroll vertical (deux niveaux)");
});

/* ===================== F. i18n ===================== */

test("LOT5C-VISUEL i18n — plus d'axe ni d'addLine ; noCharacter, newCharacter et add* présents FR/EN", () => {
  assert.equal(fr["board.lanes.axis"], undefined, "clé Axe supprimée (FR)");
  assert.equal(en["board.lanes.axis"], undefined, "clé Axis supprimée (EN)");
  assert.equal(fr["board.lanes.axisPov"], undefined, "clé axisPov supprimée (FR)");
  assert.equal(en["board.lanes.axisLabel"], undefined, "clé axisLabel supprimée (EN)");
  assert.equal(fr["board.lanes.addLine"], undefined, "clé addLine supprimée (FR)");
  assert.equal(en["board.lanes.addLine"], undefined, "clé addLine supprimée (EN)");
  assert.equal(fr["board.narrative.gridSoon"], undefined, "clé gridSoon supprimée (plus d'utilisation)");
  assert.equal(fr["board.lanes.noCharacter"], "Sans personnage", "noCharacter FR");
  assert.equal(en["board.lanes.noCharacter"], "No character", "noCharacter EN");
  assert.equal(fr["board.lanes.addLabel"], "Ajouter un label");
  assert.equal(fr["board.lanes.addCharacter"], "Ajouter un personnage");
  assert.equal(fr["board.lanes.addThread"], "Ajouter un fil");
  assert.equal(fr["board.lanes.addPov"], "Ajouter un pov");
  assert.equal(en["board.lanes.addCharacter"], "Add a character");
  assert.equal(fr["board.narrative.pickSubview"], "Choisir une sous-vue", "tooltip sélecteur FR");
  assert.equal(en["board.narrative.pickSubview"], "Pick a subview", "tooltip sélecteur EN");
  /* Les libellés d'axe réutilisent exactement ceux de Trame (une seule source). */
  assert.equal(fr["board.arcs.labelFilterName"], "Label");
  assert.equal(fr["board.arcs.characterFilterName"], "Personnage");
  assert.equal(fr["board.arcs.threadFilterName"], "Fil");
  assert.equal(fr["board.arcs.povFilterName"], "Pov");
});

/* ===================== G. NON-RÉGRESSION ===================== */

test("LOT5C-VISUEL — laneAxis/narrativeSubview restent de SESSION, jamais persistés", async () => {
  const { view, plugin } = buildNarrativeHarness({ boardMode: "arcs" });
  view.narrativeSubview = "lanes";
  view.laneAxis = "character";
  await view.render(true);
  assert.equal(plugin.settings.lanesAxis, undefined, "aucun réglage lanesAxis créé");
  assert.equal(plugin.settings.narrativeSubview, undefined, "aucun réglage narrativeSubview créé");
});

test("LOT5C-VISUEL — le drag Couloirs ne réordonne JAMAIS (setFm sur l'axe uniquement)", async () => {
  const files = [
    mkLaneFile("A", { pov: "Deli" }),
    mkLaneFile("B", { pov: "Kali" }),
  ];
  const { view, root, plugin } = buildLanesHarness({ files });
  view.laneAxis = "pov";
  const setFmCalls = [];
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); };
  const moveCalls = [];
  plugin.moveNode = async () => { moveCalls.push("moveNode"); };
  const container = renderCouloirs(view, root);
  const card = cardInSlot(laneSlots(container, "Deli")[0]);
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "Kali")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, 1, "setFm appelé une fois");
  assert.equal(setFmCalls[0].k, "pov", "clé logique de l'axe courant");
  assert.equal(setFmCalls[0].v, "Kali");
  assert.deepEqual(moveCalls, [], "aucune opération de réordonnancement du manuscrit");
});

test("LOT5C-VISUEL — registre de lignes stable : un re-rendu ne le réinitialise pas (axe Personnage)", () => {
  const files = [mkLaneFile("A", { characters: ["Kemal"] })];
  const { view, root } = buildLanesHarness({ files });
  view.laneAxis = "character";
  renderCouloirs(view, root);
  view.createLane("character", "Arif");
  const container = renderCouloirs(view, root);
  assert.deepEqual(lanesLabels(container), ["Kemal", "Arif", "Sans personnage"], "ligne créée en session conservée au re-rendu");
  assert.deepEqual(view.laneRegistry.character, ["Kemal", "Arif"], "registre de session intact");
});

test("LOT5C-VISUEL — Trame inchangée : sous-vue trame route vers renderCheminDeFer, jamais renderCouloirs", async () => {
  const { view, settings, root } = buildNarrativeHarness({ boardMode: "arcs" });
  let cdf = 0;
  let couloirs = 0;
  view.renderCheminDeFer = () => { cdf += 1; };
  view.renderCouloirs = () => { couloirs += 1; };
  await view.render(true);
  assert.equal(view.narrativeSubview, "trame", "défaut Trame conservé");
  assert.equal(cdf, 1, "renderCheminDeFer appelé (Trame)");
  assert.equal(couloirs, 0, "renderCouloirs jamais appelé en Trame");
  view.narrativeSubview = "lanes";
  await view.render(true);
  assert.equal(couloirs, 1, "renderCouloirs appelé après bascule de sous-vue");
  assert.equal(cdf, 1, "renderCheminDeFer pas réappelé pendant Couloirs");
  settings.projectMeta[root.path].boardMode = "outline";
  await view.render(true);
  assert.equal(cdf, 1, "mode outline : pas de rendu Trame (hors arcs)");
  settings.projectMeta[root.path].boardMode = "arcs";
  await view.render(true);
  assert.equal(couloirs, 2, "retour arcs : la sous-vue de session (lanes) est re-rendue");
  view.narrativeSubview = "trame";
  await view.render(true);
  assert.equal(cdf, 2, "retour Trame : renderCheminDeFer rejoué");
  assert.equal(couloirs, 2, "renderCouloirs pas réappelé en Trame");
});

/* ===================== H. RE-RENDU / VIEWPORT (scroll conservé) =====================
   §6-§9 : _lanesViewport (état de session de l'instance) mémorise
   scrollLeft/scrollTop sur les DEUX scrolls (horizontal + vertical) et les
   restaure sur le nouveau DOM à chaque renderCouloirs. C'est ce qui fait
   survivre le viewport au render(true) du drop ET au second refresh différé
   après vault.modify (renderAllViews). Le harness qui stube
   `view.render = async () => {}` ne reconstruit RIEN — c'est précisément
   pourquoi la régression n'était pas détectée : ces tests reconstruisent
   réellement Couloirs dans un NOUVEAU conteneur avec la MÊME instance. */

test("LOT5C-VISUEL re-rendu — un NOUVEAU DOM reprend scrollLeft/scrollTop (puis un 2e re-rendu aussi)", async () => {
  const files = [mkLaneFile("A", { label: "rouge" }), mkLaneFile("B", { label: "vert" })];
  const { view, root } = buildLanesHarness({ files });

  /* 1. Premier rendu. */
  let container = renderCouloirs(view, root);
  const oldScroll = findFirst(container, (el) => el.classes.has("feuillets-lanes-scroll"));
  const oldVertical = findFirst(container, (el) => el.classes.has("feuillets-lanes-vertical-scroll"));
  assert.ok(oldScroll && oldVertical, "scroll horizontal + vertical présents au premier rendu");

  /* 2-6. Position du viewport : scrollLeft puis scrollTop, chacun suivi du
     listener "scroll" qui la mémorise dans _lanesViewport. */
  oldScroll.scrollLeft = 640;
  await oldScroll.trigger("scroll", {});
  oldVertical.scrollTop = 180;
  await oldVertical.trigger("scroll", {});

  /* 7-9. Reconstruction dans un NOUVEAU conteneur, même instance BoardView
     (= _render : container.empty() puis rebuild après le drop). */
  container = renderCouloirs(view, root);
  const newScroll = findFirst(container, (el) => el.classes.has("feuillets-lanes-scroll"));
  const newVertical = findFirst(container, (el) => el.classes.has("feuillets-lanes-vertical-scroll"));
  assert.notEqual(newScroll, oldScroll, "le nouveau scroller est un NOUVEAU nœud DOM (l'ancien a été détruit)");
  assert.equal(newScroll.scrollLeft, 640, "scrollLeft restauré sur le nouveau scroller");
  assert.equal(newVertical.scrollTop, 180, "scrollTop restauré sur le nouveau scroll vertical");

  /* Deuxième reconstruction (= le refresh différé suivant vault.modify). */
  container = renderCouloirs(view, root);
  const thirdScroll = findFirst(container, (el) => el.classes.has("feuillets-lanes-scroll"));
  const thirdVertical = findFirst(container, (el) => el.classes.has("feuillets-lanes-vertical-scroll"));
  assert.equal(thirdScroll.scrollLeft, 640, "scrollLeft conservé après un 2e re-rendu");
  assert.equal(thirdVertical.scrollTop, 180, "scrollTop conservé après un 2e re-rendu");
});

test("LOT5C-VISUEL drop — le render(true) reconstruit réellement et le nouveau scroller conserve la position", async () => {
  const files = [
    mkLaneFile("A", { label: "rouge" }),
    mkLaneFile("B", { label: "vert" }),
  ];
  const { view, root, plugin } = buildLanesHarness({ files });
  const setFmCalls = [];
  const moveCalls = [];
  /* setFm est STUBÉ mais doit rester FAITHFUL : il enregistre l'appel ET
     applique l'écriture au frontmatter simulé — sinon la reconstruction ne
     peut pas refléter le déplacement de la carte vers sa nouvelle ligne. */
  view.setFm = async (f, k, v) => { setFmCalls.push({ f, k, v }); f.__fm[k] = v; };
  plugin.moveNode = async () => { moveCalls.push("moveNode"); };

  /* render(true) = reconstruction RÉELLE (comme _render : container.empty()
     puis rebuild). Le stub `async () => {}` du harness ne le fait pas. */
  let container;
  const build = () => { container = renderCouloirs(view, root); };
  build();
  view.render = async () => { build(); };

  const oldScroll = findFirst(container, (el) => el.classes.has("feuillets-lanes-scroll"));
  const oldVertical = findFirst(container, (el) => el.classes.has("feuillets-lanes-vertical-scroll"));
  oldScroll.scrollLeft = 640;
  await oldScroll.trigger("scroll", {});
  oldVertical.scrollTop = 180;
  await oldVertical.trigger("scroll", {});

  /* Drag A (source "rouge") vers la ligne "vert". */
  const card = cardInSlot(laneSlots(container, "rouge")[0]);
  await card.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "vert")).trigger("drop");
  await flushMicrotasks();

  /* Métier inchangé : setFm sur la clé d'axe, aucun reorder du manuscrit. */
  assert.equal(setFmCalls.length, 1, "setFm appelé une fois");
  assert.equal(setFmCalls[0].k, "label", "clé d'axe Label");
  assert.deepEqual(setFmCalls[0].v, ["vert"], "A (rouge) → vert : [vert] (source retirée, cible ajoutée)");
  assert.deepEqual(moveCalls, [], "aucun réordonnancement du manuscrit");

  /* La reconstruction a eu lieu : NOUVEAU nœud DOM qui conserve la position. */
  const newScroll = findFirst(container, (el) => el.classes.has("feuillets-lanes-scroll"));
  const newVertical = findFirst(container, (el) => el.classes.has("feuillets-lanes-vertical-scroll"));
  assert.notEqual(newScroll, oldScroll, "le drop a reconstruit : NOUVEAU scroller (pas l'ancien nœud DOM)");
  assert.equal(newScroll.scrollLeft, 640, "scrollLeft conservé après le drop");
  assert.equal(newVertical.scrollTop, 180, "scrollTop conservé après le drop");

  /* Même source/cible reste no-op (aucune écriture, aucun re-rendu). */
  const still = setFmCalls.length;
  const newCard = cardInSlot(laneSlots(container, "vert")[0]); // A désormais en vert
  await newCard.trigger("dragstart", { dataTransfer: { setData() {}, effectAllowed: "" } });
  await laneTrack(laneRow(container, "vert")).trigger("drop");
  await flushMicrotasks();
  assert.equal(setFmCalls.length, still, "drop sur sa propre ligne : aucune écriture (no-op)");
});
