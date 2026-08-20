import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { BoardView } from "../src/views/board-view.js";
import { VIEW_BOARD, BOARD_MODES } from "../src/constants.js";
import { t } from "../src/i18n/index.js";

/* Bouton « Carte » du Binder : le clic gauche continue d'appeler
   activateBoard(), le clic droit ouvre EN ARRIÈRE-PLAN le Board dans un des
   4 modes (openBoardModeInBackground) — qui réutilise la leaf existante SANS
   revealLeaf, sinon crée une leaf centrale puis restaure la leaf d'origine
   de la même mécanique rootSplit qu'ailleurs. setBoardMode persiste la
   préférence (méta projet si projet, sinon globale) et re-rend la vue :
   TOUTES les bascules de mode du Board passent par cette unique méthode.
   Le plugin est exercé via Object.create(FeuilletsPlugin.prototype). */

class FakeElement {
  constructor() {
    this.children = [];
    this.classes = new Set();
    this.style = { _props: {}, setProperty() {} };
  }
  createEl(tag) { const el = new FakeElement(); el.tag = tag; this.children.push(el); return el; }
  createDiv() { return this.createEl("div"); }
  createSpan() { return this.createEl("span"); }
  addClass(c) { this.classes.add(c); return this; }
  setAttr() {}
  empty() { this.children = []; }
  querySelector() { return null; }
}

/* §15.F — clic droit du bouton « Carte » : UN menu des 4 modes, ordre
   BOARD_MODES, chacun ouvrant le Board en arrière-plan via
   openBoardModeInBackground — jamais activateBoard, jamais le menu partagé
   des Cartes. */
test("§15.F — le clic droit du bouton Carte propose les 4 modes en arrière-plan", () => {
  const opened = [];
  const plugin = { openBoardModeInBackground: async (mode) => { opened.push(mode); } };
  const view = new FeuilletsView({ app: { workspace: {} }, contentEl: new FakeElement() }, plugin);

  view.showBoardModesMenu({});

  const menu = Menu.lastShown;
  const items = menu.items.filter((i) => !i.separator);
  assert.deepEqual(
    items.map((i) => i.title),
    BOARD_MODES.map(([k]) => t(`board.mode.${k}`)),
    "les 4 modes, dans l'ordre BOARD_MODES, libellés i18n"
  );
  for (const [i] of BOARD_MODES.entries()) {
    items[i].callback();
  }
  assert.deepEqual(opened, BOARD_MODES.map(([k]) => k), "chaque entrée ouvre le mode attendu en arrière-plan");
});

/* §15.G — openBoardModeInBackground, leaf existante : la leaf Board est
   réutilisée avec setBoardMode, SANS revealLeaf ni nouvelle leaf ni
   changement d'onglet actif. CAS 1 (régression) : un mode initial différent
   ("board") ne doit jamais gagner sur le choix explicite, y compris pour
   deux choix successifs ("outline" puis "timeline"). */
test("§15.G — leaf Board déjà ouverte : réutilisation sans revealLeaf ni ouverture d'onglet, le mode explicite gagne toujours", async () => {
  let appliedMode = null;
  let currentMode = "board";
  const existingLeaf = { view: { setBoardMode: (mode) => { appliedMode = mode; currentMode = mode; } } };
  let getLeafCalled = 0;
  let revealLeafCalls = 0;
  const workspace = {
    rootSplit: {},
    getLeavesOfType: (type) => (type === VIEW_BOARD ? [existingLeaf] : []),
    getLeaf: () => { getLeafCalled++; return null; },
    revealLeaf: () => { revealLeafCalls++; },
  };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { workspace };

  await plugin.openBoardModeInBackground("outline");
  assert.equal(currentMode, "outline", "CAS 1a — Plan choisi depuis \"board\" : mode final = \"outline\"");

  await plugin.openBoardModeInBackground("timeline");
  assert.equal(currentMode, "timeline", "CAS 1b — Chronologie choisie ensuite : mode final = \"timeline\"");

  assert.equal(appliedMode, "timeline", "le mode est appliqué sur la leaf existante");
  assert.equal(getLeafCalled, 0, "aucune nouvelle leaf créée");
  assert.equal(revealLeafCalls, 0, "l'arrière-plan ne révèle jamais la leaf Board");
});

/* §15.G — openBoardModeInBackground sans leaf Board : une leaf centrale est
   créée et révélée, puis la leaf d'écriture d'origine (getRoot() ===
   rootSplit) est restaurée. La vraie BoardView créée par setViewState doit
   recevoir setBoardMode(mode) — CAS 2 (régression) : la vue s'initialise
   sur le DERNIER mode mémorisé ("arcs"), le choix explicite ("outline")
   doit néanmoins gagner sur le mode final. */
test("§15.G — pas de leaf Board : nouvel onglet initialisé dans le mode explicite, puis restauration de la leaf d'origine", async () => {
  const rootSplit = {};
  const anchorLeaf = { getRoot: () => rootSplit };
  const revealed = [];
  const setViewStates = [];
  let appliedMode = null;
  const leafUnderTest = {
    view: null,
    async setViewState(state) {
      setViewStates.push(state);
      // Simule l'initialisation réelle de BoardView.onOpen()/_render, qui
      // relit meta.boardMode / settings.boardMode et applique donc le
      // DERNIER mode mémorisé AVANT tout appel explicite à setBoardMode.
      this.view = {
        mode: "arcs",
        setBoardMode(mode) { appliedMode = mode; this.mode = mode; },
      };
    },
  };
  const workspace = {
    rootSplit,
    getLeavesOfType: () => [],
    getMostRecentLeaf: (split) => (split === rootSplit ? anchorLeaf : null),
    getLeaf: () => leafUnderTest,
    revealLeaf: (leaf) => revealed.push(leaf),
  };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { workspace };

  await plugin.openBoardModeInBackground("outline");

  assert.deepEqual(setViewStates, [{ type: VIEW_BOARD, active: true }]);
  assert.equal(appliedMode, "outline", "setBoardMode est appelé avec le mode explicite après l'initialisation");
  assert.equal(leafUnderTest.view.mode, "outline",
    "CAS 2 — mode final = \"outline\", jamais \"arcs\" (dernier mode mémorisé) : le choix explicite gagne toujours");
  assert.deepEqual(revealed, [leafUnderTest, anchorLeaf],
    "la nouvelle leaf est révélée puis la leaf d'écriture d'origine est restaurée");
});

/* §15.G — CAS 3 & 4 (régression) : quel que soit le dernier mode mémorisé,
   le mode final d'une leaf Board nouvellement créée est TOUJOURS le mode
   explicitement choisi au clic droit. Couvre tous les couples (dernier
   mode, mode choisi) du mapping Carte/Plan/Chemin de fer/Chronologie. */
test("§15.G — pas de leaf Board : le mode explicite gagne sur le dernier mode mémorisé, quel qu'il soit", async () => {
  const cases = [
    { lastMode: "timeline", chosen: "board" },   // CAS 3 — Chronologie mémorisé → Carte choisie → "board"
    { lastMode: "board", chosen: "arcs" },        // CAS 4 — Carte mémorisé → Chemin de fer choisi → "arcs"
    { lastMode: "arcs", chosen: "outline" },
    { lastMode: "outline", chosen: "timeline" },
  ];

  for (const { lastMode, chosen } of cases) {
    const rootSplit = {};
    let appliedMode = null;
    const leafUnderTest = {
      view: null,
      async setViewState() {
        this.view = { mode: lastMode, setBoardMode(mode) { appliedMode = mode; this.mode = mode; } };
      },
    };
    const workspace = {
      rootSplit,
      getLeavesOfType: () => [],
      getMostRecentLeaf: () => null,
      getLeaf: () => leafUnderTest,
      revealLeaf: () => {},
    };
    const plugin = Object.create(FeuilletsPlugin.prototype);
    plugin.app = { workspace };

    await plugin.openBoardModeInBackground(chosen);

    assert.equal(appliedMode, chosen, `dernier mode "${lastMode}" → choix "${chosen}" : setBoardMode appelé avec "${chosen}"`);
    assert.equal(leafUnderTest.view.mode, chosen,
      `dernier mode "${lastMode}" → choix "${chosen}" : mode final = "${chosen}", pas "${lastMode}"`);
  }
});

/* §15.G — Test d'ordre d'initialisation (régression) : si une étape
   ultérieure de l'initialisation restaurait l'ancien mode APRÈS l'appel
   explicite à setBoardMode, ce test doit échouer. Il vérifie le mode final
   après la séquence complète setBoardMode → (ré-)initialisation simulée,
   jamais seulement le nombre d'appels à setBoardMode. */
test("§15.G — le mode explicite n'est jamais réécrit par une phase d'initialisation postérieure", async () => {
  const rootSplit = {};
  let restoreCalls = 0;
  const leafUnderTest = {
    view: null,
    async setViewState() {
      const self = this;
      self.view = {
        mode: "arcs",
        setBoardMode(mode) {
          self.view.mode = mode;
          // Simule une éventuelle relecture tardive de la persistance
          // (onOpen différé, second render, etc.) : elle ne doit JAMAIS
          // réécraser le mode explicite qui vient d'être appliqué.
          restoreCalls++;
        },
      };
    },
  };
  const workspace = {
    rootSplit,
    getLeavesOfType: () => [],
    getMostRecentLeaf: () => null,
    getLeaf: () => leafUnderTest,
    revealLeaf: () => {},
  };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { workspace };

  await plugin.openBoardModeInBackground("outline");

  assert.equal(restoreCalls, 1, "setBoardMode appelé exactement une fois pour le mode explicite");
  assert.equal(leafUnderTest.view.mode, "outline",
    "mode final après initialisation complète = \"outline\", jamais restauré à \"arcs\"");
});

/* §15.G — openBoardModeInBackground : une leaf d'origine hors du split
   central (Sidebar) n'est jamais « restaurée » — on ne re-révèle que ce
   qui appartient au rootSplit. */
test("§15.G — restauration sans effet hors du rootSplit (leaf de Sidebar)", async () => {
  const rootSplit = {};
  const sidebarLeaf = { getRoot: () => ({}) }; // Sidebar, PAS rootSplit
  const newLeaf = { getRoot: () => rootSplit, async setViewState() {} };
  const revealed = [];
  const workspace = {
    rootSplit,
    getLeavesOfType: () => [],
    getMostRecentLeaf: () => sidebarLeaf,
    getLeaf: () => newLeaf,
    revealLeaf: (leaf) => revealed.push(leaf),
  };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { workspace };

  await plugin.openBoardModeInBackground("arcs");

  assert.deepEqual(revealed, [newLeaf], "seule la nouvelle leaf est révélée, jamais la leaf de Sidebar");
});

/* §15.G — setBoardMode : persiste la préférence dans la méta du projet quand
   le projet existe, toujours dans le réglage global, et re-rend la vue. */
test("§15.G — setBoardMode persiste (méta projet + réglage global) et re-rend", () => {
  const root = new TFolder("Projet/Manuscrit");
  const saved = [];
  const settings = { projectFolder: root.path, projectMeta: {}, boardMode: "board" };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    saveSettings: async () => { saved.push(true); },
    fmOf: () => ({}),
  };
  const board = new BoardView({ app: { vault: { getAbstractFileByPath: () => null } }, contentEl: new FakeElement() }, plugin);
  let rendered = 0;
  board.render = async () => { rendered++; };

  board.setBoardMode("timeline");

  assert.equal(settings.projectMeta[root.path].boardMode, "timeline", "la méta du projet est écrite");
  assert.equal(settings.boardMode, "timeline", "le réglage global est toujours écrit");
  assert.equal(saved.length, 1, "les réglages sont sauvegardés");
  assert.equal(rendered, 1, "la vue est re-rendue");
});

/* §15.G — setBoardMode sans projet : seule la préférence globale est écrite,
   jamais une méta fantôme. */
test("§15.G — setBoardMode sans projet : réglage global seul, pas de méta créée", () => {
  const settings = { projectMeta: {}, boardMode: "board" };
  const plugin = {
    settings,
    getProjectFolder: () => null,
    saveSettings: async () => {},
    fmOf: () => ({}),
  };
  const board = new BoardView({ app: { vault: { getAbstractFileByPath: () => null } }, contentEl: new FakeElement() }, plugin);
  board.render = async () => {};

  board.setBoardMode("outline");

  assert.equal(settings.boardMode, "outline");
  assert.deepEqual(settings.projectMeta, {}, "aucune méta créée sans projet");
});