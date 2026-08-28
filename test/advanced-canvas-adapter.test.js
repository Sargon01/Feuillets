import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { CanvasBridgeModal, CanvasNodeToManuscriptModal } from "../src/ui/canvas-bridge-modal.js";
import { CanvasChapterModal } from "../src/ui/canvas-chapter-modal.js";
import { ideaTreeBranch } from "../src/services/canvas-idea-tree.js";
import FeuilletsPlugin from "../src/main.js";

/* On ne teste jamais Advanced Canvas lui-même — seulement l'adaptateur
 * Feuillets, avec un faux objet minimal reproduisant uniquement le contrat
 * vérifié (canvas:selection-menu, canvas:node-menu, getSelectionData,
 * node.canvas, node.getData, view.file). */

function makeFixture() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;
  const { vault } = createFakeVault([volume, manuscript]);
  const app = { vault, workspace: { handlers: {}, on(name, cb) { this.handlers[name] = cb; return { name }; } } };
  const settings = { projectFolder: manuscript.path };
  const plugin = {
    app,
    settings,
    registerEvent() {},
    saveSettings: async () => {},
  };
  return { app, settings, plugin, manuscript };
}

function fireSelectionMenu(app, menu, canvas) {
  const handler = app.workspace.handlers["canvas:selection-menu"];
  handler(menu, canvas);
}

function fireNodeMenu(app, menu, node) {
  const handler = app.workspace.handlers["canvas:node-menu"];
  handler(menu, node);
}

/** Laisse le temps aux chaînes de promesses (fake vault, resolveResearch-
 * Destination, applySelectedIdeas…) déclenchées par un clic de menu de se
 * terminer, sans dépendre d'un vrai rendu de modale (open() est un no-op
 * dans le stub Obsidian, voir onOpen jamais appelé par défaut). */
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Même projet que makeFixture(), avec en plus une racine Recherche déjà
 * présente sur le disque (Projet/Recherche) — pour tester la conversion
 * "fiche Recherche" sans dépendre de la création asynchrone du dossier. */
function makeFixtureWithResearchFolder() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Recherche");
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  const { vault } = createFakeVault([volume, manuscript, research]);
  const app = { vault, workspace: { handlers: {}, on(name, cb) { this.handlers[name] = cb; return { name }; } } };
  const settings = { projectFolder: manuscript.path };
  const plugin = { app, settings, registerEvent() {}, saveSettings: async () => {} };
  return { app, settings, plugin, manuscript, research };
}

/** Même projet, avec en plus deux feuillets réels du manuscrit actif — pour
 * tester les actions "chapitre" (Lot 2), qui doivent reconnaître un file
 * node manuscrit réellement présent sur le disque. */
function makeFixtureWithManuscriptFiles() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const ch1 = new TFile("Projet/Manuscrit/Chapitre 1.md", "Contenu 1");
  const ch2 = new TFile("Projet/Manuscrit/Chapitre 2.md", "Contenu 2");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [ch1, ch2];
  ch1.parent = manuscript;
  ch2.parent = manuscript;
  const { vault, fileManager } = createFakeVault([volume, manuscript, ch1, ch2]);
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: { handlers: {}, on(name, cb) { this.handlers[name] = cb; return { name }; } },
  };
  const settings = { projectFolder: manuscript.path, level1Role: "chapitres", orders: {}, folderPositions: {} };
  const plugin = { app, settings, registerEvent() {}, saveSettings: async () => {} };
  return { app, settings, plugin, manuscript, ch1, ch2 };
}

/** Canvas minimal avec l'API live (getData/setData/requestSave) — permet de
 * vérifier synchronement, via le chemin "sûr" (jamais une relecture disque),
 * ce qui est transmis au pont sans dépendre du rendu réel d'une modale. */
function makeLiveCanvas(boardFile, nodes = []) {
  const data = { nodes, edges: [] };
  return {
    view: { file: boardFile },
    setDataCalls: [],
    getData: () => data,
    setData(updated) {
      this.setDataCalls.push(updated);
    },
    requestSave() {},
  };
}

/* ---------------------------------------------------------------------- *
 * Lot 5 — fixtures Scope/runtime : couche instances réelle (canvas.nodes,
 * canvas.selection) en plus de la couche JSON, pour tester Tab/Entrée et
 * les classes visuelles sans dépendre du rendu réel d'Advanced Canvas.
 * VERSION FINALE : le node créé n'est ni sélectionné ni édité
 * automatiquement (décision produit) — ces fixtures ne simulent donc plus
 * ni sélection auto, ni édition auto, ni focus ; `canvas.selection` reste
 * settable directement par chaque test pour simuler CE QUE L'UTILISATEUR a
 * sélectionné avant Tab/Entrée.
 * ---------------------------------------------------------------------- */

/** Faux iframe d'éditeur — uniquement `contentDocument.body.classList`
 * (classe de lisibilité pendant l'édition, section 6). */
function makeFakeIframe() {
  const bodyClasses = new Set();
  return {
    contentDocument: {
      body: {
        classList: {
          toggle(cls, force) {
            const has = bodyClasses.has(cls);
            const next = force === undefined ? !has : !!force;
            if (next) bodyClasses.add(cls);
            else bodyClasses.delete(cls);
            return next;
          },
          contains(cls) {
            return bodyClasses.has(cls);
          },
        },
      },
    },
  };
}

/** Correctif drag/reparent + collapse (Prompt 2, suite) — `rect` (settable
 * par chaque test) simule `getBoundingClientRect()` pour le hit-test par
 * position ; `add`/`remove` complètent `toggle`/`contains` (déjà utilisés
 * par la classe de lecture idea-tree) pour le survol de cible de dépôt. */
function makeFakeNodeEl(rect = { left: 0, right: 0, top: 0, bottom: 0 }) {
  const classes = new Set();
  let iframe = makeFakeIframe();
  const attrs = {};
  const children = [];
  const el = {
    rect,
    classList: {
      toggle(cls, force) {
        const has = classes.has(cls);
        const next = force === undefined ? !has : !!force;
        if (next) classes.add(cls);
        else classes.delete(cls);
        return next;
      },
      contains(cls) {
        return classes.has(cls);
      },
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
    },
    getBoundingClientRect() {
      return el.rect;
    },
    querySelector(sel) {
      if (sel === "iframe") return iframe;
      return children.find((child) => child.matchesClass && sel.startsWith(".") && child.matchesClass(sel.slice(1))) || null;
    },
    createDiv({ cls } = {}) {
      const child = makeFakeControlEl(cls);
      children.push(child);
      return child;
    },
    setAttr(name, value) { attrs[name] = value; },
    getAttr(name) { return attrs[name]; },
    setIframe(el2) {
      iframe = el2;
    },
  };
  return el;
}

/** Petit élément DOM factice pour le contrôle repli/dépli (`createDiv`) —
 * juste assez pour vérifier texte, classe et rappel de clic. */
function makeFakeControlEl(cls) {
  const classes = new Set(cls ? cls.split(" ") : []);
  const attrs = {};
  return {
    matchesClass: (name) => classes.has(name),
    textContent: "",
    onclick: null,
    onpointerdown: null,
    setText(text) { this.textContent = text; },
    setAttr(name, value) { attrs[name] = value; },
    getAttr(name) { return attrs[name]; },
    toggleClass(name, force) {
      const has = classes.has(name);
      const next = force === undefined ? !has : !!force;
      if (next) classes.add(name); else classes.delete(name);
    },
    remove() { this.removed = true; },
  };
}

function makeFakeRuntimeNode(nodeData) {
  return {
    id: nodeData.id,
    getData: () => nodeData,
    setData(updated) {
      Object.assign(nodeData, updated);
    },
    isEditing: false,
    nodeEl: makeFakeNodeEl(),
  };
}

/** Canvas complet Lot 5 : couche JSON (getData/importData/requestSave) ET
 * couche instances (nodes Map, selection) — `importData` (le SEUL chemin
 * retenu par `persistCanvasData` quand il est présent) reconstruit `nodes`
 * depuis le JSON à chaque appel, comme le vrai mécanisme audité (voir
 * services/canvas-runtime.ts, tête de fichier). */
function makeRuntimeCanvas(boardFile, nodeDataList = []) {
  const data = { nodes: nodeDataList, edges: [] };
  const canvas = {
    view: { file: boardFile },
    importDataCalls: [],
    getData: () => data,
    importData(updated) {
      this.importDataCalls.push(updated);
      data.nodes = updated.nodes;
      data.edges = updated.edges;
      const known = new Set(data.nodes.map((n) => n.id));
      for (const id of [...canvas.nodes.keys()]) if (!known.has(id)) canvas.nodes.delete(id);
      for (const nd of data.nodes) if (!canvas.nodes.has(nd.id)) canvas.nodes.set(nd.id, makeFakeRuntimeNode(nd));
    },
    // Présent uniquement pour satisfaire les gardes `readLive` (getData &&
    // setData && requestSave) du fichier testé — `persistCanvasData` préfère
    // toujours `importData` quand il est là (voir plus haut), donc ce
    // `setData` n'est jamais réellement invoqué dans ces tests.
    setData(updated) {
      this.importData(updated);
    },
    requestSave() {},
    nodes: new Map(nodeDataList.map((nd) => [nd.id, makeFakeRuntimeNode(nd)])),
    selection: new Set(),
  };
  return canvas;
}

/** Faux Scope Obsidian — mêmes signatures que `Scope.register`/`unregister`. */
function makeFakeScope() {
  const handlers = [];
  return {
    handlers,
    register(modifiers, key, func) {
      const handler = { modifiers, key, func };
      handlers.push(handler);
      return handler;
    },
    unregister(handler) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    },
  };
}

/** Fixture complète avec un faux workspace `getLeavesOfType("canvas")` —
 * pour tester `attachIdeaTreeKeymaps` sans dépendre du rendu réel d'une vue
 * Canvas. */
/** Correctif drag/reparent — faux wrapper DOM de la vue Canvas :
 * `addEventListener`/`removeEventListener` réels (pour vérifier le
 * cleanup), `fire` pour simuler un événement pointer dans les tests. */
function makeFakeWrapperEl() {
  const listeners = {};
  return {
    addEventListener(type, cb) {
      (listeners[type] ||= []).push(cb);
    },
    removeEventListener(type, cb) {
      listeners[type] = (listeners[type] || []).filter((registered) => registered !== cb);
    },
    fire(type, evt) {
      for (const cb of listeners[type] || []) cb(evt);
    },
    listenerCount(type) {
      return (listeners[type] || []).length;
    },
  };
}

function makeScopedFixture(nodeDataList = []) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;
  const { vault } = createFakeVault([volume, manuscript]);
  const boardFile = new TFile(canvasPathFor({ vault }, manuscript), "");
  const canvas = makeRuntimeCanvas(boardFile, nodeDataList);
  const scope = makeFakeScope();
  const cleanups = [];
  const containerEl = makeFakeWrapperEl();
  canvas.wrapperEl = containerEl;
  const view = {
    file: boardFile,
    canvas,
    scope,
    register(cb) {
      cleanups.push(cb);
    },
  };
  const leaves = [{ view }];
  const app = {
    vault,
    workspace: {
      handlers: {},
      on(name, cb) {
        this.handlers[name] = cb;
        return { name };
      },
      getLeavesOfType(type) {
        return type === "canvas" ? leaves : [];
      },
    },
  };
  const settings = { projectFolder: manuscript.path };
  const registeredCleanups = [];
  const plugin = {
    app,
    settings,
    registerEvent() {},
    saveSettings: async () => {},
    register(cb) {
      registeredCleanups.push(cb);
    },
  };
  return { app, plugin, settings, manuscript, boardFile, canvas, scope, view, containerEl, cleanups, registeredCleanups };
}

test("registerAdvancedCanvasIntegration : s'enregistre sans planter même sans Advanced Canvas", () => {
  const { plugin } = makeFixture();
  assert.doesNotThrow(() => registerAdvancedCanvasIntegration(plugin));
});

test("registerAdvancedCanvasIntegration : un second enregistrement ne duplique ni Scinder ni Fusionner", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [
    { id: "t1", type: "text", text: "Idée 1" },
    { id: "t2", type: "text", text: "Idée 2" },
  ]);
  canvas.getSelectionData = () => ({ nodes: [{ id: "t1", type: "text" }, { id: "t2", type: "text" }] });

  const selectionMenu = new Menu();
  fireSelectionMenu(app, selectionMenu, canvas);
  assert.equal(selectionMenu.items.filter((item) => item.title === "Fusionner…").length, 1);

  const nodeMenu = new Menu();
  fireNodeMenu(app, nodeMenu, { canvas, getData: () => ({ id: "t1", type: "text", text: "Idée 1" }) });
  assert.equal(nodeMenu.items.filter((item) => item.title === "Scinder…").length, 1);
});

test("registerAdvancedCanvasIntegration : ignore un canvas qui n'est pas le Tableau brainstorming du projet actif", () => {
  const { app, plugin } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const menu = new Menu();
  const wrongFile = new TFile("Projet/Autre.canvas", "");
  fireSelectionMenu(app, menu, {
    view: { file: wrongFile },
    getSelectionData: () => ({ nodes: [{ id: "t1", type: "text" }] }),
  });

  assert.equal(menu.items.length, 0);
});

test("registerAdvancedCanvasIntegration : ignore une sélection sans text node", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const menu = new Menu();
  fireSelectionMenu(app, menu, {
    view: { file: boardFile },
    getSelectionData: () => ({ nodes: [{ id: "f1", type: "file" }, { id: "g1", type: "group" }] }),
  });

  assert.equal(menu.items.length, 0);
});

test("registerAdvancedCanvasIntegration : un seul text node → libellés au singulier", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const menu = new Menu();
  fireSelectionMenu(app, menu, {
    view: { file: boardFile },
    getSelectionData: () => ({ nodes: [{ id: "t1", type: "text" }] }),
  });

  assert.equal(menu.items.length, 2);
  assert.ok(menu.items.every((item) => typeof item.callback === "function"));
});

test("registerAdvancedCanvasIntegration : plusieurs text nodes → deux actions, sélection multiple prise en compte", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const menu = new Menu();
  fireSelectionMenu(app, menu, {
    view: { file: boardFile },
    getSelectionData: () => ({
      nodes: [
        { id: "t1", type: "text" },
        { id: "t2", type: "text" },
        { id: "f1", type: "file" },
      ],
    }),
  });

  assert.equal(menu.items.length, 2);
});

// 1. canvas:node-menu sur un text node du Carnet → actions historiques + arbre
test("registerAdvancedCanvasIntegration : node-menu TextNode ne propose QUE les actions Feuillets, plus aucune action idea-tree", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t1", type: "text" }) });

  assert.deepEqual(menu.items.map((item) => item.title), [
    "Transformer en feuillet",
    "Transformer en fiche Recherche",
    "Scinder…",
  ]);
  assert.ok(menu.items.every((item) => typeof item.callback === "function"));
});

test("Plan — keymaps legacy ignorent Tab/Entrée et le menu ne reçoit aucune action Feuillets", () => {
  const planNode = { id: "plan", type: "text", text: "Plan du manuscrit", feuillets_binder_plan: "outliner-v1", feuillets_plan_version: 2, feuillets_plan_items: [] };
  const { plugin, canvas, scope } = makeScopedFixture([planNode]);
  registerAdvancedCanvasIntegration(plugin);
  canvas.selection = new Set([canvas.nodes.get("plan")]);
  const tab = scope.handlers.find((handler) => handler.key === "Tab");
  const enter = scope.handlers.find((handler) => handler.key === "Enter");
  const tabEvent = { preventDefault() { this.prevented = true; } };
  tab.func(tabEvent, {});
  enter.func({ preventDefault() { this.prevented = true; } }, {});
  assert.equal(canvas.getData().nodes.length, 1, "aucune edge ou branche idea-tree n'est créée");
  assert.equal(tabEvent.prevented, undefined, "le raccourci legacy ne consomme pas le Plan");

  const { app, manuscript } = makeFixture();
  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const menuCanvas = makeLiveCanvas(boardFile, [planNode]);
  registerAdvancedCanvasIntegration({ app, settings: { projectFolder: manuscript.path }, registerEvent() {}, saveSettings: async () => {} });
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas: menuCanvas, getData: () => planNode });
  assert.equal(menu.items.length, 0, "aucune conversion, scission ou action idea-tree sur le Plan");
});

// 2. file node → aucune action Feuillets de transformation
test("registerAdvancedCanvasIntegration : node-menu sur un file node → aucune action", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "f1", type: "file" }) });

  assert.equal(menu.items.length, 0);
});

// 3. group node absent du canvas complet (ou sans élément admissible) → aucune action
test("registerAdvancedCanvasIntegration : node-menu sur un group node introuvable dans canvas.getData() → aucune action", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "g1", type: "group" }) });

  assert.equal(menu.items.length, 0);
});

// 4. link node → aucune action
test("registerAdvancedCanvasIntegration : node-menu sur un link node → aucune action", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "l1", type: "link" }) });

  assert.equal(menu.items.length, 0);
});

// 5. node-menu sur un autre Canvas → aucune action
test("registerAdvancedCanvasIntegration : node-menu ignoré si ce n'est pas le Carnet du projet actif", () => {
  const { app, plugin } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const wrongFile = new TFile("Projet/Autre.canvas", "");
  const canvas = makeLiveCanvas(wrongFile);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t1", type: "text" }) });

  assert.equal(menu.items.length, 0);
});

// 1/4. node-menu (feuillet ET fiche Recherche) → CanvasBridgeModal jamais ouvert
test("registerAdvancedCanvasIntegration : node-menu ne rouvre jamais la modale multi-sélection (CanvasBridgeModal)", async () => {
  const { app, plugin, manuscript } = makeFixtureWithResearchFolder();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [{ id: "t1", type: "text", text: "Idée" }]);

  const bridgeModalOpens = [];
  const nodeModalOpens = [];
  const originalBridgeOpen = CanvasBridgeModal.prototype.open;
  const originalNodeOpen = CanvasNodeToManuscriptModal.prototype.open;
  CanvasBridgeModal.prototype.open = function () { bridgeModalOpens.push(this); };
  CanvasNodeToManuscriptModal.prototype.open = function () { nodeModalOpens.push(this); };
  try {
    const menu = new Menu();
    fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t1", type: "text" }) });
    menu.items[0].callback(); // "Transformer en feuillet"
    menu.items[1].callback(); // "Transformer en fiche Recherche"
    await flushMicrotasks();
  } finally {
    CanvasBridgeModal.prototype.open = originalBridgeOpen;
    CanvasNodeToManuscriptModal.prototype.open = originalNodeOpen;
  }

  assert.equal(bridgeModalOpens.length, 0, "CanvasBridgeModal ne doit jamais être ouverte depuis le node-menu");
  // 5. seule la destination peut être demandée : une petite modale dédiée, une seule fois.
  assert.equal(nodeModalOpens.length, 1);
});

// 2/3. node-menu → fiche Recherche : seul l'id du node cliqué est converti, les autres restent inchangés
test("registerAdvancedCanvasIntegration : node-menu → fiche Recherche ne convertit que le node cliqué", async () => {
  const { app, plugin, manuscript, research } = makeFixtureWithResearchFolder();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const untouched = { id: "t1", type: "text", text: "Idée intacte" };
  const target = { id: "t2", type: "text", text: "Ney" };
  const canvas = makeLiveCanvas(boardFile, [untouched, target]);

  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t2", type: "text", text: "Ney" }) });
  menu.items[1].callback(); // "Transformer en fiche Recherche"
  await flushMicrotasks();

  assert.equal(canvas.setDataCalls.length, 1);
  const data = canvas.setDataCalls[0];
  const convertedNode = data.nodes.find((n) => n.file === `${research.path}/Carnet/Ney.md`);
  const otherNode = data.nodes.find((n) => n.id === "t1");

  assert.ok(convertedNode);
  assert.notEqual(convertedNode.id, "t2");
  assert.equal(data.nodes.some((n) => n.id === "t2"), false);
  assert.equal(convertedNode.type, "file");
  assert.equal(convertedNode.feuillets_managed, "research");
  // Correctif recherche contextuelle : la fiche libre du Carnet va dans sa
  // propre rubrique, jamais directement à la racine Recherche/Ney.md.
  assert.equal(convertedNode.file, `${research.path}/Carnet/Ney.md`);
  assert.deepEqual(otherNode, untouched, "l'autre text node doit rester strictement inchangé");

  const created = app.vault.getAbstractFileByPath(`${research.path}/Carnet/Ney.md`);
  assert.ok(created, "la fiche Recherche doit avoir été créée directement, sans modale");
  assert.equal(app.vault.getAbstractFileByPath(`${research.path}/Ney.md`), null, "jamais à la racine Recherche");
});

// 4/5. node-menu → feuillet : pas de liste multi-sélection, seule la destination est demandée
test("registerAdvancedCanvasIntegration : node-menu → feuillet ouvre une modale de destination minimale, pas de liste", async () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  chapter.parent = manuscript;
  manuscript.children.push(chapter);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const target = { id: "t7", type: "text", text: "Kemal arrive au village" };
  const canvas = makeLiveCanvas(boardFile, [target]);

  let captured = null;
  const originalOpen = CanvasNodeToManuscriptModal.prototype.open;
  CanvasNodeToManuscriptModal.prototype.open = function () { captured = this; };
  try {
    const menu = new Menu();
    fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t7", type: "text", text: "Kemal arrive au village" }) });
    menu.items[0].callback(); // "Transformer en feuillet"
  } finally {
    CanvasNodeToManuscriptModal.prototype.open = originalOpen;
  }

  assert.ok(captured, "une modale de destination doit être ouverte");
  assert.equal(captured.ideaTitle, "Kemal arrive au village");

  // Simule la confirmation de destination (l'unique champ de cette modale).
  await captured.onConfirm(chapter);
  await flushMicrotasks();

  assert.equal(canvas.setDataCalls.length, 1);
  const converted = canvas.setDataCalls[0].nodes.find((n) => n.file === `${chapter.path}/Kemal arrive au village.md`);
  assert.ok(converted);
  assert.notEqual(converted.id, "t7");
  assert.equal(canvas.setDataCalls[0].nodes.some((n) => n.id === "t7"), false);
  assert.equal(converted.type, "file");
  assert.equal(converted.feuillets_managed, "manuscript");
  assert.equal(converted.file, `${chapter.path}/Kemal arrive au village.md`);
});

// Simplification Carnet : une edge n'a plus AUCUN effet métier — une fiche
// Recherche reliée par edge directe à l'idée transformée en feuillet ne
// doit ni être proposée dans une case à cocher, ni déplacée, ni associée
// via researchFolderLinks. L'edge elle-même reste intacte (purement
// visuelle).
test("registerAdvancedCanvasIntegration : node-menu → feuillet avec une fiche Recherche reliée ne la déplace ni ne l'associe jamais", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Recherche");
  const carnet = new TFolder("Projet/Recherche/Carnet");
  const ney = new TFile("Projet/Recherche/Carnet/Ney.md", "# Ney");
  volume.children = [manuscript, research];
  research.children = [carnet];
  carnet.children = [ney];
  manuscript.parent = volume;
  research.parent = volume;
  carnet.parent = research;
  ney.parent = carnet;
  const { vault, fileManager } = createFakeVault([volume, manuscript, research, carnet, ney]);
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: { handlers: {}, on(name, cb) { this.handlers[name] = cb; return { name }; } },
  };
  const settings = { projectFolder: manuscript.path, level1Role: "chapitres", orders: {}, folderPositions: {}, projectMeta: {} };
  const plugin = { app, settings, registerEvent() {}, saveSettings: async () => {} };
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const target = { id: "t7", type: "text", text: "Kemal entend le ney" };
  const neyNode = { id: "ney-node", type: "file", file: ney.path, x: 10, y: 10, width: 100, height: 60 };
  const canvas = makeLiveCanvas(boardFile, [target, neyNode]);
  canvas.getData().edges.push({ id: "e1", fromNode: "t7", toNode: "ney-node" });

  let captured = null;
  const originalOpen = CanvasNodeToManuscriptModal.prototype.open;
  CanvasNodeToManuscriptModal.prototype.open = function () { captured = this; };
  try {
    const menu = new Menu();
    fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t7", type: "text", text: "Kemal entend le ney" }) });
    menu.items[0].callback(); // "Transformer en feuillet"
  } finally {
    CanvasNodeToManuscriptModal.prototype.open = originalOpen;
  }

  assert.ok(captured, "une modale de destination doit être ouverte");
  assert.equal("linkedResearch" in captured, false, "la modale ne connaît plus la notion de recherche liée");

  const originalNeyPath = ney.path;
  await captured.onConfirm(manuscript);
  await flushMicrotasks();

  const sheetPath = "Projet/Manuscrit/Kemal entend le ney.md";
  assert.ok(app.vault.getAbstractFileByPath(sheetPath));

  // Ney reste exactement où elle était — aucun déplacement, aucun dossier
  // de contexte créé, aucune entrée researchFolderLinks écrite.
  assert.ok(app.vault.getAbstractFileByPath(originalNeyPath), "Ney doit rester à son emplacement Carnet d'origine");
  assert.equal(app.vault.getAbstractFileByPath("Projet/Recherche/Kemal entend le ney"), null, "aucun dossier de contexte ne doit être créé");
  assert.equal(settings.projectMeta[manuscript.path]?.researchFolderLinks, undefined);

  // L'edge t7→ney-node reste présente, redirigée vers le nouvel id du
  // feuillet (remappage JSON normal), jamais supprimée ni altérée pour
  // Ney — une edge reste purement visuelle.
  const finalData = canvas.setDataCalls[canvas.setDataCalls.length - 1];
  const finalSheetNode = finalData.nodes.find((n) => n.file === sheetPath);
  assert.ok(finalData.edges.some((e) => e.fromNode === finalSheetNode.id && e.toNode === "ney-node"));
});

// 6. selection-menu multi-node → CanvasBridgeModal continue de fonctionner
test("registerAdvancedCanvasIntegration : selection-menu multi-node ouvre toujours CanvasBridgeModal avec tous les ids", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [
    { id: "t1", type: "text", text: "Idée 1" },
    { id: "t2", type: "text", text: "Idée 2" },
  ]);
  canvas.getSelectionData = () => ({ nodes: [{ id: "t1", type: "text" }, { id: "t2", type: "text" }] });

  const captured = [];
  const originalOpen = CanvasBridgeModal.prototype.open;
  CanvasBridgeModal.prototype.open = function () { captured.push(this); };
  try {
    const menu = new Menu();
    fireSelectionMenu(app, menu, canvas);
    menu.items[0].callback(); // "Passer les idées au manuscrit…"
  } finally {
    CanvasBridgeModal.prototype.open = originalOpen;
  }

  assert.equal(captured.length, 1);
  assert.deepEqual([...captured[0].preselectedIds].sort(), ["t1", "t2"]);
  assert.equal(captured[0].mode, "manuscript");
});

// 8. selection-menu existant continue de fonctionner (voir aussi les tests précédents)
test("registerAdvancedCanvasIntegration : selection-menu et node-menu coexistent sans interférence", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile);

  const selectionMenu = new Menu();
  fireSelectionMenu(app, selectionMenu, {
    view: { file: boardFile },
    getSelectionData: () => ({ nodes: [{ id: "t1", type: "text" }, { id: "t2", type: "text" }] }),
  });
  assert.equal(selectionMenu.items.length, 2);

  const nodeMenu = new Menu();
  fireNodeMenu(app, nodeMenu, { canvas, getData: () => ({ id: "t1", type: "text" }) });
  assert.equal(nodeMenu.items.length, 3);
});

// ---------------------------------------------------------------------------
// Lot 2 — Carnet → chapitre (section 27)
// ---------------------------------------------------------------------------

// 1. node-menu group du Carnet contenant un élément admissible → action chapitre
test("registerAdvancedCanvasIntegration : node-menu sur un group du Carnet avec élément admissible → « Créer un chapitre… »", () => {
  const { app, plugin, manuscript, ch1 } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const group = { id: "g1", type: "group", label: "Chapitre 3", x: 0, y: 0, width: 400, height: 200 };
  const fileNode = { id: "f1", type: "file", file: ch1.path, x: 10, y: 10, width: 100, height: 60 };
  const canvas = makeLiveCanvas(boardFile, [group, fileNode]);

  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "g1", type: "group" }) });

  assert.equal(menu.items.length, 1);
  assert.ok(typeof menu.items[0].callback === "function");
});

// 2. group d'un autre Canvas → aucune action
test("registerAdvancedCanvasIntegration : node-menu group d'un autre Canvas → aucune action", () => {
  const { app, plugin, ch1 } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const wrongFile = new TFile("Projet/Autre.canvas", "");
  const group = { id: "g1", type: "group", label: "Chapitre 3", x: 0, y: 0, width: 400, height: 200 };
  const fileNode = { id: "f1", type: "file", file: ch1.path, x: 10, y: 10, width: 100, height: 60 };
  const canvas = makeLiveCanvas(wrongFile, [group, fileNode]);

  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "g1", type: "group" }) });

  assert.equal(menu.items.length, 0);
});

// 3. file node manuscrit → aucune action : ni scission Canvas, ni idea-tree.
test("registerAdvancedCanvasIntegration : node-menu FileNode manuscrit → aucune action Canvas", () => {
  const { app, plugin, manuscript, ch1 } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [{ id: "f1", type: "file", file: ch1.path }]);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "f1", type: "file" }) });

  assert.equal(menu.items.length, 0, "le menu de fichier Feuillets garde ses propres actions");
});

// 4. text node libre → conserve les actions Lot 1, jamais chapitre ni arbre.
test("registerAdvancedCanvasIntegration : node-menu sur un text node → jamais l'action chapitre, toujours Scinder", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [{ id: "t1", type: "text", text: "Idée" }]);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t1", type: "text", text: "Idée" }) });

  assert.deepEqual(menu.items.map((i) => i.title), [
    "Transformer en feuillet",
    "Transformer en fiche Recherche",
    "Scinder…",
  ]);
  assert.equal(menu.items.some((i) => i.title.includes("chapitre")), false);
});

/* Idea-tree = compatibilité/migration seulement : aucune commande active ne
   crée, n'étend ni ne réorganise plus une branche. Ses DONNÉES restent
   intactes et lisibles — ces deux tests vérifient les deux faces. */
test("idea-tree legacy — aucune action de création/réorganisation d'arbre n'est proposée", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);
  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const parent = { id: "A", type: "text", text: "A", x: 0, y: 0, width: 240, height: 80 };
  const canvas = makeLiveCanvas(boardFile, [parent]);

  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => parent });
  for (const retired of [
    "Développer en arbre…",
    "Ajouter une branche",
    "Réorganiser l'arbre",
    "Créer un chapitre avec cette branche…",
    "Transformer cette branche en plan…",
  ]) {
    assert.equal(menu.items.some((item) => item.title === retired), false, `${retired} est retirée de l'usage actif`);
  }
});

test("idea-tree legacy — un Carnet contenant un ancien arbre reste lisible et n'est jamais réécrit", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);
  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const nodes = [
    { id: "A", type: "text", text: "A", y: 0 },
    { id: "C", type: "text", text: "C", y: 200 },
    { id: "B", type: "text", text: "B", y: 20 },
  ];
  const canvas = makeLiveCanvas(boardFile, nodes);
  canvas.getData().edges.push(
    { id: "ac", fromNode: "A", toNode: "C", feuillets_managed: "idea-tree" },
    { id: "ab", fromNode: "A", toNode: "B", feuillets_managed: "idea-tree" }
  );
  const before = JSON.stringify(canvas.getData());

  // Les données legacy restent parcourables par le service de lecture…
  assert.deepEqual(ideaTreeBranch(canvas.getData(), "A").map((n) => n.id), ["A", "B", "C"]);

  // …et l'ouverture d'un menu sur l'arbre n'écrit RIEN.
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => nodes[0] });
  assert.equal(JSON.stringify(canvas.getData()), before);
  assert.equal(canvas.setDataCalls.length, 0);
});

// 5. selection-menu avec 2 text nodes → action chapitre proposée
test("registerAdvancedCanvasIntegration : selection-menu 2 text nodes → action chapitre proposée", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [
    { id: "t1", type: "text", text: "Idée 1" },
    { id: "t2", type: "text", text: "Idée 2" },
  ]);
  canvas.getSelectionData = () => ({ nodes: [{ id: "t1", type: "text" }, { id: "t2", type: "text" }] });

  const menu = new Menu();
  fireSelectionMenu(app, menu, canvas);

  // 2 actions Lot 1 (manuscrit/recherche) + chapitre + fusionner.
  assert.equal(menu.items.length, 4);
  assert.ok(menu.items.some((i) => i.title === "Créer un chapitre avec la sélection…"));
  assert.ok(menu.items.some((i) => i.title === "Fusionner…"));
});

// 6. selection-menu avec 2 file nodes manuscrit → action chapitre
test("registerAdvancedCanvasIntegration : selection-menu 2 file nodes manuscrit → action chapitre", () => {
  const { app, plugin, manuscript, ch1, ch2 } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [
    { id: "f1", type: "file", file: ch1.path },
    { id: "f2", type: "file", file: ch2.path },
  ]);
  canvas.getSelectionData = () => ({ nodes: [{ id: "f1", type: "file" }, { id: "f2", type: "file" }] });

  const menu = new Menu();
  fireSelectionMenu(app, menu, canvas);

  // Aucun text node : pas d'actions Lot 1 ni fusion Canvas, seulement chapitre.
  assert.equal(menu.items.length, 1);
  assert.equal(menu.items[0].title, "Créer un chapitre avec la sélection…");
  assert.equal(menu.items.some((i) => i.title === "Fusionner…"), false);
});

// 7. sélection mixte admissible (texte + file manuscrit) → action chapitre
test("registerAdvancedCanvasIntegration : selection-menu mixte (texte + file manuscrit) → action chapitre", () => {
  const { app, plugin, manuscript, ch1 } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [
    { id: "t1", type: "text", text: "Idée" },
    { id: "f1", type: "file", file: ch1.path },
  ]);
  canvas.getSelectionData = () => ({ nodes: [{ id: "t1", type: "text" }, { id: "f1", type: "file" }] });

  const menu = new Menu();
  fireSelectionMenu(app, menu, canvas);

  assert.ok(menu.items.some((i) => i.title === "Créer un chapitre avec la sélection…"));
});

// 8. sélection seulement Recherche/link/group → pas d'action chapitre (ni Lot 1)
test("registerAdvancedCanvasIntegration : selection-menu Recherche/link/group uniquement → aucune action", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [
    { id: "r1", type: "file", file: "Projet/Recherche/Ney.md" },
    { id: "l1", type: "link", url: "https://x" },
    { id: "g1", type: "group", label: "G" },
  ]);
  canvas.getSelectionData = () => ({
    nodes: [{ id: "r1", type: "file" }, { id: "l1", type: "link" }, { id: "g1", type: "group" }],
  });

  const menu = new Menu();
  fireSelectionMenu(app, menu, canvas);

  assert.equal(menu.items.length, 0);
});

// 9. IDs exacts transmis au service (groupe ET sélection)
test("registerAdvancedCanvasIntegration : IDs exacts transmis à CanvasChapterModal (groupe et sélection)", () => {
  const { app, plugin, manuscript, ch1, ch2 } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const group = { id: "g1", type: "group", label: "Chapitre 3", x: 0, y: 0, width: 500, height: 500 };
  const inGroup = { id: "f1", type: "file", file: ch1.path, x: 10, y: 10, width: 100, height: 60 };
  const outsideGroup = { id: "f2", type: "file", file: ch2.path, x: 900, y: 900, width: 100, height: 60 };
  const canvas = makeLiveCanvas(boardFile, [group, inGroup, outsideGroup]);

  const captured = [];
  const originalOpen = CanvasChapterModal.prototype.open;
  CanvasChapterModal.prototype.open = function () { captured.push(this); };
  try {
    const groupMenu = new Menu();
    fireNodeMenu(app, groupMenu, { canvas, getData: () => ({ id: "g1", type: "group" }) });
    groupMenu.items[0].callback();

    canvas.getSelectionData = () => ({ nodes: [{ id: "f1", type: "file" }, { id: "f2", type: "file" }] });
    const selMenu = new Menu();
    fireSelectionMenu(app, selMenu, canvas);
    selMenu.items.find((i) => i.title === "Créer un chapitre avec la sélection…").callback();
  } finally {
    CanvasChapterModal.prototype.open = originalOpen;
  }

  assert.equal(captured.length, 2);
  // Contexte "group" : seul le node géométriquement contenu (f1) est transmis, jamais f2.
  assert.equal(captured[0].context.source, "group");
  assert.equal(captured[0].context.group.id, "g1");
  // Contexte "selection" : exactement les ids sélectionnés, dans l'ordre transmis.
  assert.equal(captured[1].context.source, "selection");
  assert.deepEqual([...captured[1].context.ids].sort(), ["f1", "f2"]);
});

// 10. aucune mutation Binder lors d'un simple node move après création — aucun
//     écouteur de synchronisation géométrique n'est jamais enregistré.
test("registerAdvancedCanvasIntegration : aucun écouteur de synchronisation géométrique groupe↔Binder n'est enregistré", () => {
  const { app, plugin } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  for (const forbiddenEvent of [
    "advanced-canvas:node-moved",
    "advanced-canvas:node-resized",
    "advanced-canvas:selection-changed",
    "advanced-canvas:canvas-saved:after",
  ]) {
    assert.equal(app.workspace.handlers[forbiddenEvent], undefined, `${forbiddenEvent} ne doit jamais être écouté`);
  }
});

// ---------------------------------------------------------------------------
// Raccourcis clavier Mindmap (Scope de la vue Carnet) et décorations de
// LECTURE des anciens idea-tree.
// ---------------------------------------------------------------------------

test("Scope Mindmap : Tab, Entrée et Shift+Tab enregistrés avec des modificateurs EXACTS, jamais null", () => {
  const { plugin, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.every((h) => Array.isArray(h.modifiers)), true, "`null` accepterait TOUTES les variantes, Cmd/Ctrl+Entrée du Plan comprise");
  assert.equal(scope.handlers.filter((h) => h.key === "Tab" && h.modifiers.length === 0).length, 1);
  assert.equal(scope.handlers.filter((h) => h.key === "Enter" && h.modifiers.length === 0).length, 1);
  assert.equal(scope.handlers.filter((h) => h.key === "Tab" && h.modifiers.includes("Shift")).length, 1, "Mindmap : Shift+Tab outdent");
});

test("Lot 5 — Scope : un Canvas qui n'est pas le Carnet du projet actif n'obtient aucun raccourci", () => {
  const { plugin, scope, view } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  const wrongFile = new TFile("Projet/Autre.canvas", "");
  view.file = wrongFile;
  view.canvas.view.file = wrongFile;
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.length, 0);
});

test("Tab/Entrée/Shift+Tab sur un TextNode LIBRE ne font strictement rien (aucune branche idea-tree créée)", () => {
  const { plugin, canvas, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A", x: 0, y: 0, width: 260, height: 80 }]);
  registerAdvancedCanvasIntegration(plugin);
  const runtimeA = canvas.nodes.get("A");
  canvas.selection = new Set([runtimeA]);
  const selectionBefore = canvas.selection;
  const before = JSON.stringify(canvas.getData());

  for (const handler of scope.handlers) {
    const evt = { preventDefault() { this.prevented = true; } };
    const result = handler.func(evt, {});
    assert.equal(evt.prevented, undefined, "aucun raccourci ne consomme la frappe sur une carte libre");
    assert.equal(result, undefined, "le comportement natif d'Obsidian reste entier");
  }

  assert.equal(JSON.stringify(canvas.getData()), before, "aucun node, aucune edge créés");
  assert.equal(canvas.selection, selectionBefore);

  for (const zoomFn of ["zoomToSelection", "zoomToFit", "zoomToBbox", "setViewport"]) {
    assert.equal(zoomFn in canvas, false);
  }
});

test("Tab/Entrée ne touchent jamais un idea-tree legacy déjà présent dans le Carnet", () => {
  const { plugin, canvas, scope } = makeScopedFixture([
    { id: "A", type: "text", text: "A", x: 0, y: 0 },
    { id: "B", type: "text", text: "B", x: 170, y: 60 },
  ]);
  canvas.getData().edges.push({ id: "ab", fromNode: "A", toNode: "B", feuillets_managed: "idea-tree" });
  registerAdvancedCanvasIntegration(plugin);
  canvas.selection = new Set([canvas.nodes.get("B")]);
  const before = JSON.stringify(canvas.getData());

  for (const handler of scope.handlers) handler.func({ preventDefault() { this.prevented = true; } }, {});

  assert.equal(JSON.stringify(canvas.getData()), before, "les données legacy sont préservées telles quelles");
  assert.deepEqual(ideaTreeBranch(canvas.getData(), "A").map((n) => n.id), ["A", "B"], "et restent lisibles");
});

test("Lot 5 — Entrée sur la racine (sans parent idea-tree) ne crée rien", () => {
  const { plugin, canvas, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  canvas.selection = new Set([canvas.nodes.get("A")]);

  const enterHandler = scope.handlers.find((h) => h.key === "Enter");
  const evt = { preventDefault() { this.prevented = true; } };
  enterHandler.func(evt, {});

  assert.equal(evt.prevented, undefined);
  assert.equal(canvas.getData().nodes.length, 1);
});

test("Lot 5 — un node en cours d'édition : Tab et Entrée restent totalement natifs", () => {
  const { plugin, canvas, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  const nodeA = canvas.nodes.get("A");
  nodeA.isEditing = true;
  canvas.selection = new Set([nodeA]);

  for (const key of ["Tab", "Enter"]) {
    const handler = scope.handlers.find((h) => h.key === key);
    const evt = { preventDefault() { this.prevented = true; } };
    const result = handler.func(evt, {});
    assert.equal(evt.prevented, undefined, `${key} ne doit jamais appeler preventDefault en édition`);
    assert.equal(result, undefined);
  }
  assert.equal(canvas.getData().nodes.length, 1);
});

test("Lot 5 — Tab/Entrée ne font rien sans sélection unique (aucune ou multiple)", () => {
  const { plugin, canvas, scope } = makeScopedFixture([
    { id: "A", type: "text", text: "A" },
    { id: "B", type: "text", text: "B" },
  ]);
  registerAdvancedCanvasIntegration(plugin);
  const tabHandler = scope.handlers.find((h) => h.key === "Tab");

  canvas.selection = new Set();
  tabHandler.func({ preventDefault() { this.prevented = true; } }, {});

  canvas.selection = new Set([canvas.nodes.get("A"), canvas.nodes.get("B")]);
  tabHandler.func({ preventDefault() { this.prevented = true; } }, {});

  assert.equal(canvas.getData().nodes.length, 2);
});

test("Lot 5 — aucune API de zoom n'est jamais appelée par les raccourcis Tab/Entrée", () => {
  const { plugin, canvas, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  for (const zoomFn of ["zoomToSelection", "zoomToFit", "zoomToBbox", "setViewport"]) {
    canvas[zoomFn] = () => {
      throw new Error(`${zoomFn} ne doit jamais être appelée`);
    };
  }
  registerAdvancedCanvasIntegration(plugin);
  canvas.selection = new Set([canvas.nodes.get("A")]);
  const tabHandler = scope.handlers.find((h) => h.key === "Tab");
  assert.doesNotThrow(() => tabHandler.func({ preventDefault() {} }, {}));
});

test("aucune logique d'autofocus ne subsiste : les raccourcis ne touchent ni sélection ni édition", () => {
  const { plugin, canvas, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A", x: 0, y: 0 }]);
  registerAdvancedCanvasIntegration(plugin);
  const runtimeA = canvas.nodes.get("A");
  canvas.selection = new Set([runtimeA]);
  const selectionRef = canvas.selection;

  for (const handler of scope.handlers) handler.func({ preventDefault() {} }, {});

  assert.equal(canvas.selection, selectionRef);
  assert.equal([...canvas.selection][0], runtimeA);
  assert.equal(runtimeA.isEditing, false);
  assert.equal("startEditing" in runtimeA, false);
  assert.equal("setIsEditing" in runtimeA, false);
  assert.equal("selectOnly" in canvas, false);
});

test("Lot 5 — les handlers Tab/Entrée/Shift+Tab sont désenregistrés au déchargement de la VUE", () => {
  const { plugin, scope, cleanups } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.length, 3, "Tab, Entrée, et Shift+Tab (Mindmap, Prompt 2/5)");
  cleanups.forEach((cb) => cb());
  assert.equal(scope.handlers.length, 0);
});

test("Lot 5 — les handlers Tab/Entrée/Shift+Tab sont aussi désenregistrés au déchargement du PLUGIN", () => {
  const { plugin, scope, registeredCleanups } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.length, 3);
  registeredCleanups.forEach((cb) => cb());
  assert.equal(scope.handlers.length, 0);
});

test("Lot 5 — attachIdeaTreeKeymaps n'attache jamais deux fois la même vue Carnet", () => {
  const { plugin, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.length, 3);
  plugin.app.workspace.handlers["active-leaf-change"]();
  plugin.app.workspace.handlers["layout-change"]();
  assert.equal(scope.handlers.length, 3);
});

test("classe de LECTURE posée sur les membres d'un idea-tree legacy, jamais sur une carte libre", () => {
  const { plugin, canvas } = makeScopedFixture([
    { id: "A", type: "text", text: "A" },
    { id: "B", type: "text", text: "B" },
    { id: "LIBRE", type: "text", text: "Libre" },
  ]);
  canvas.getData().edges.push({ id: "ab", fromNode: "A", toNode: "B", feuillets_managed: "idea-tree" });
  registerAdvancedCanvasIntegration(plugin);

  assert.equal(canvas.nodes.get("A").nodeEl.classList.contains("feuillets-idea-tree-member"), true);
  assert.equal(canvas.nodes.get("B").nodeEl.classList.contains("feuillets-idea-tree-member"), true);
  assert.equal(canvas.nodes.get("LIBRE").nodeEl.classList.contains("feuillets-idea-tree-member"), false);
});

test("Lot 5 — classe d'édition posée sur le body de l'iframe réel de l'éditeur d'un membre idea-tree, jamais sur une carte libre", () => {
  const nodeA = { id: "A", type: "text", text: "A" };
  const nodeB = { id: "B", type: "text", text: "B" };
  const nodeLibre = { id: "LIBRE", type: "text", text: "Libre" };
  const { app, plugin, canvas } = makeScopedFixture([nodeA, nodeB]);
  canvas.getData().edges.push({ id: "ab", fromNode: "A", toNode: "B", feuillets_managed: "idea-tree" });
  canvas.getData().nodes.push(nodeLibre);
  canvas.nodes.set("LIBRE", makeFakeRuntimeNode(nodeLibre));
  registerAdvancedCanvasIntegration(plugin);

  const runtimeB = canvas.nodes.get("B");
  const iframeB = makeFakeIframe();
  runtimeB.nodeEl.setIframe(iframeB);
  const handler = app.workspace.handlers["advanced-canvas:node-editing-state-changed"];

  handler({ canvas, getData: () => nodeB, nodeEl: runtimeB.nodeEl }, true);
  assert.equal(iframeB.contentDocument.body.classList.contains("feuillets-idea-tree-editing"), true);
  handler({ canvas, getData: () => nodeB, nodeEl: runtimeB.nodeEl }, false);
  assert.equal(iframeB.contentDocument.body.classList.contains("feuillets-idea-tree-editing"), false);

  const runtimeLibre = canvas.nodes.get("LIBRE");
  const iframeLibre = makeFakeIframe();
  runtimeLibre.nodeEl.setIframe(iframeLibre);
  handler({ canvas, getData: () => nodeLibre, nodeEl: runtimeLibre.nodeEl }, true);
  assert.equal(iframeLibre.contentDocument.body.classList.contains("feuillets-idea-tree-editing"), false);
});

test("Lot 5 — une carte libre (hors idea-tree) n'obtient jamais « Réorganiser l'arbre »", () => {
  const { app, plugin, canvas } = makeScopedFixture([{ id: "LIBRE", type: "text", text: "Libre" }]);
  registerAdvancedCanvasIntegration(plugin);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "LIBRE", type: "text", text: "Libre" }) });
  assert.equal(menu.items.some((i) => i.title === "Réorganiser l'arbre"), false);
});


test("idea-tree legacy — « Créer un chapitre avec cette branche… » n'est plus proposée sur un membre d'arbre", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);
  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const nodeA = { id: "A", type: "text", text: "A", y: 0 };
  const nodeB = { id: "B", type: "text", text: "B", y: 20 };
  const nodeC = { id: "C", type: "text", text: "C", y: 40 };
  const canvas = makeLiveCanvas(boardFile, [nodeA, nodeB, nodeC]);
  canvas.getData().edges.push(
    { id: "ab", fromNode: "A", toNode: "B", feuillets_managed: "idea-tree" },
    { id: "bc", fromNode: "B", toNode: "C", feuillets_managed: "idea-tree" }
  );

  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => nodeB });
  assert.equal(menu.items.some((item) => item.title === "Créer un chapitre avec cette branche…"), false);
});

/* Compatibilité idea-tree : « Transformer cette branche en plan… » est
 * retirée de l'usage actif. Ce garde-fou vérifie qu'elle ne réapparaît
 * jamais, sur une racine comme sur une feuille. */

test("Lot 9 — une simple feuille sans descendant idea-tree n'obtient jamais « Transformer cette branche en plan… »", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);
  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const nodeA = { id: "A", type: "text", text: "A", y: 0 };
  const nodeB = { id: "B", type: "text", text: "B", y: 20 };
  const canvas = makeLiveCanvas(boardFile, [nodeA, nodeB]);
  canvas.getData().edges.push({ id: "ab", fromNode: "A", toNode: "B", feuillets_managed: "idea-tree" });

  const menu = new Menu();
  // B est un descendant (une feuille), pas la racine : aucun enfant idea-tree.
  fireNodeMenu(app, menu, { canvas, getData: () => nodeB });
  assert.ok(!menu.items.some((item) => item.title === "Transformer cette branche en plan…"));
});


/* ================================================================
 * Correctif Prompt 2 (suite) — DRAG MINDMAP RÉEL
 *
 * Le faux runtime reproduit ici l'API RÉELLE vérifiée sur le bundle
 * Advanced Canvas 6.5.0 installé : `canvas.wrapperEl`, `canvas.posFromEvt`,
 * `node.getBBox()`. `canvas.handleSelectionDrag` n'existe PAS (0 occurrence
 * dans le bundle réel) et n'est donc simulé nulle part.
 *
 * Détail RÉALISTE décisif : pendant un drag, le node glissé SUIT le
 * pointeur — son getBBox() se déplace avec lui. C'est exactement ce qui
 * faisait échouer le hit-test précédent (le node glissé se retrouvait sous
 * le point de dépose et était pris pour sa propre cible).
 * ================================================================ */

function mindmapNode(id, extra = {}) {
  return { id, type: "text", text: id, width: 200, height: 80, feuillets_block_id: "block-1", ...extra };
}

function bboxOf(nodeData) {
  return {
    minX: nodeData.x, minY: nodeData.y,
    maxX: nodeData.x + nodeData.width, maxY: nodeData.y + nodeData.height,
  };
}

function makeMindmapDragFixture() {
  // Racine → A, B → C. Rectangles disjoints en coordonnées Canvas.
  const root = mindmapNode("root", { x: 0, y: 0 });
  const nodeA = mindmapNode("A", { x: 300, y: 0 });
  const nodeB = mindmapNode("B", { x: 300, y: 300 });
  const nodeC = mindmapNode("C", { x: 600, y: 300 });
  const group = { id: "group", type: "group", feuillets_block: "mindmap", feuillets_block_version: 1, feuillets_block_id: "block-1", x: -50, y: -50, width: 900, height: 450 };
  const edges = [
    { id: "e1", fromNode: "root", toNode: "A", feuillets_managed: "mindmap", feuillets_block_id: "block-1" },
    { id: "e2", fromNode: "root", toNode: "B", feuillets_managed: "mindmap", feuillets_block_id: "block-1" },
    { id: "e3", fromNode: "B", toNode: "C", feuillets_managed: "mindmap", feuillets_block_id: "block-1" },
  ];
  const fixture = makeScopedFixture([root, nodeA, nodeB, nodeC, group]);
  fixture.canvas.getData().edges.push(...edges);
  fixture.canvas.posFromEvt = (evt) => ({ x: evt.clientX, y: evt.clientY });
  // getBBox() réel sur chaque instance runtime, lu depuis la donnée vivante.
  for (const nodeData of [root, nodeA, nodeB, nodeC, group]) {
    const runtime = fixture.canvas.nodes.get(nodeData.id);
    if (runtime) runtime.getBBox = () => bboxOf(nodeData);
  }
  fixture.nodeData = { root, nodeA, nodeB, nodeC, group };
  return fixture;
}

/** Rejoue un vrai geste : pointerdown sur le node, le node SUIT le pointeur
 * (comme le drag natif d'Obsidian le fait réellement), puis pointerup. */
function simulateRealDrag(fixture, draggedId, endPoint) {
  const wrapper = fixture.canvas.wrapperEl;
  const dragged = fixture.canvas.getData().nodes.find((n) => n.id === draggedId);
  const startPoint = { clientX: dragged.x + dragged.width / 2, clientY: dragged.y + dragged.height / 2 };
  wrapper.fire("pointerdown", startPoint);
  // Le node glissé se déplace sous le pointeur — reproduction fidèle.
  dragged.x = endPoint.clientX - dragged.width / 2;
  dragged.y = endPoint.clientY - dragged.height / 2;
  wrapper.fire("pointermove", endPoint);
  wrapper.fire("pointerup", endPoint);
}

const CENTER_A = { clientX: 400, clientY: 40 };
const CENTER_C = { clientX: 700, clientY: 340 };
const INSIDE_GROUP_ONLY = { clientX: 50, clientY: 200 };
const OUTSIDE_ANY_BLOCK = { clientX: 5000, clientY: 5000 };

test("drag Mindmap réel — C déposé sur A devient réellement enfant de A (le node glissé suit le pointeur)", () => {
  const fixture = makeMindmapDragFixture();
  registerAdvancedCanvasIntegration(fixture.plugin);

  simulateRealDrag(fixture, "C", CENTER_A);

  const data = fixture.canvas.getData();
  assert.equal(data.edges.find((e) => e.toNode === "C").fromNode, "A", "C est maintenant enfant de A");
  assert.equal(data.edges.some((e) => e.fromNode === "B" && e.toNode === "C"), false, "l'ancienne relation B→C a disparu");
});

test("drag Mindmap réel — branche complète conservée, persistance après reparentage", () => {
  const fixture = makeMindmapDragFixture();
  registerAdvancedCanvasIntegration(fixture.plugin);
  const before = fixture.canvas.getData().nodes.map((n) => n.id).sort();

  simulateRealDrag(fixture, "C", CENTER_A);

  assert.deepEqual(fixture.canvas.getData().nodes.map((n) => n.id).sort(), before, "aucun node supprimé");
  assert.equal(fixture.canvas.getData().edges.some((e) => e.fromNode === "root" && e.toNode === "B"), true, "root→B intacte");
  const persisted = JSON.parse(JSON.stringify(fixture.canvas.getData()));
  assert.equal(persisted.edges.find((e) => e.toNode === "C").fromNode, "A", "survit à une relecture getData");
});

test("drag Mindmap réel — descendant interdit : reparenter A sous son propre descendant C est refusé", () => {
  const fixture = makeMindmapDragFixture();
  registerAdvancedCanvasIntegration(fixture.plugin);
  simulateRealDrag(fixture, "C", CENTER_A); // C devient descendant de A.
  const edgeCount = fixture.canvas.getData().edges.length;

  simulateRealDrag(fixture, "A", CENTER_C);

  assert.equal(fixture.canvas.getData().edges.find((e) => e.toNode === "A").fromNode, "root", "A reste sous root");
  assert.equal(fixture.canvas.getData().edges.length, edgeCount, "aucune edge ajoutée/retirée par le refus");
});

test("drag Mindmap réel — le groupe Canvas n'est jamais une cible", () => {
  const fixture = makeMindmapDragFixture();
  registerAdvancedCanvasIntegration(fixture.plugin);

  simulateRealDrag(fixture, "C", INSIDE_GROUP_ONLY);

  assert.equal(fixture.canvas.getData().edges.find((e) => e.toNode === "C").fromNode, "B", "C reste sous B");
});

test("drag Mindmap réel — autre Mindmap interdite", () => {
  const fixture = makeMindmapDragFixture();
  const otherRoot = { id: "other-root", type: "text", text: "Autre", width: 200, height: 80, feuillets_block_id: "block-2", x: 1200, y: 0 };
  fixture.canvas.getData().nodes.push(otherRoot, { id: "other-group", type: "group", feuillets_block: "mindmap", feuillets_block_version: 1, feuillets_block_id: "block-2" });
  fixture.canvas.nodes.set("other-root", { id: "other-root", getData: () => otherRoot, setData() {}, isEditing: false, nodeEl: makeFakeNodeEl(), getBBox: () => bboxOf(otherRoot) });
  registerAdvancedCanvasIntegration(fixture.plugin);

  simulateRealDrag(fixture, "C", { clientX: 1300, clientY: 40 });

  assert.equal(fixture.canvas.getData().edges.find((e) => e.toNode === "C").fromNode, "B", "jamais reparenté vers un autre bloc");
});

test("drag Mindmap réel — un node Canvas libre n'est jamais une cible valide", () => {
  const fixture = makeMindmapDragFixture();
  const freeNode = { id: "free", type: "text", text: "Libre", x: 1200, y: 0, width: 200, height: 80 };
  fixture.canvas.getData().nodes.push(freeNode);
  fixture.canvas.nodes.set("free", { id: "free", getData: () => freeNode, setData() {}, isEditing: false, nodeEl: makeFakeNodeEl(), getBBox: () => bboxOf(freeNode) });
  registerAdvancedCanvasIntegration(fixture.plugin);

  simulateRealDrag(fixture, "C", { clientX: 1300, clientY: 40 });

  assert.equal(fixture.canvas.getData().edges.find((e) => e.toNode === "C").fromNode, "B", "un node libre n'est jamais une cible");
});

test("drag Mindmap réel — dépose hors de tout node valide : aucune mutation", () => {
  const fixture = makeMindmapDragFixture();
  registerAdvancedCanvasIntegration(fixture.plugin);
  const beforeEdges = JSON.stringify(fixture.canvas.getData().edges);

  simulateRealDrag(fixture, "C", OUTSIDE_ANY_BLOCK);

  assert.equal(JSON.stringify(fixture.canvas.getData().edges), beforeEdges);
});

test("drag Mindmap réel — surbrillance de la cible retirée à la fin du geste", () => {
  const fixture = makeMindmapDragFixture();
  registerAdvancedCanvasIntegration(fixture.plugin);

  simulateRealDrag(fixture, "C", CENTER_A);

  assert.equal(fixture.canvas.nodes.get("A").nodeEl.classList.contains("feuillets-mindmap-drop-target"), false);
});

test("drag Mindmap réel — un node hors Mindmap ne déclenche jamais de reparentage", () => {
  const fixture = makeMindmapDragFixture();
  const plain = { id: "plain", type: "text", text: "Ordinaire", x: 900, y: 900, width: 200, height: 80 };
  fixture.canvas.getData().nodes.push(plain);
  fixture.canvas.nodes.set("plain", { id: "plain", getData: () => plain, setData() {}, isEditing: false, nodeEl: makeFakeNodeEl(), getBBox: () => bboxOf(plain) });
  registerAdvancedCanvasIntegration(fixture.plugin);
  const beforeEdges = JSON.stringify(fixture.canvas.getData().edges);

  simulateRealDrag(fixture, "plain", CENTER_A);

  assert.equal(JSON.stringify(fixture.canvas.getData().edges), beforeEdges, "aucune edge touchée");
});

test("drag Mindmap réel — écouteurs pointer posés sur canvas.wrapperEl et retirés au cleanup", () => {
  const fixture = makeMindmapDragFixture();
  registerAdvancedCanvasIntegration(fixture.plugin);
  const wrapper = fixture.canvas.wrapperEl;
  assert.equal(wrapper.listenerCount("pointerdown"), 1, "attaché au wrapperEl RÉEL du Canvas");
  assert.equal(wrapper.listenerCount("pointerup"), 1);

  fixture.cleanups.forEach((cb) => cb());

  assert.equal(wrapper.listenerCount("pointerdown"), 0);
  assert.equal(wrapper.listenerCount("pointerup"), 0);
});

/* ================================================================
 * Correctif Prompt 2 (suite) — COLLAPSE EDGES (decorateMindmapCanvasView)
 * ================================================================ */

function makeFakeEdgeEl() {
  const classes = new Set();
  return {
    classList: {
      toggle(cls, force) {
        const has = classes.has(cls);
        const next = force === undefined ? !has : !!force;
        if (next) classes.add(cls); else classes.delete(cls);
      },
      contains: (cls) => classes.has(cls),
    },
  };
}

function makeFakeRuntimeEdge(edgeData) {
  return {
    getData: () => edgeData,
    setData(updated) { Object.assign(edgeData, updated); },
    lineGroupEl: makeFakeEdgeEl(),
    lineEndGroupEl: makeFakeEdgeEl(),
    fromLineEnd: { el: makeFakeEdgeEl() },
    toLineEnd: { el: makeFakeEdgeEl() },
    labelElement: { wrapperEl: makeFakeEdgeEl() },
    path: { display: makeFakeEdgeEl(), interaction: makeFakeEdgeEl() },
  };
}

function collapseEdgeElements(runtimeEdge) {
  return [
    runtimeEdge.lineGroupEl, runtimeEdge.lineEndGroupEl,
    runtimeEdge.fromLineEnd.el, runtimeEdge.toLineEnd.el,
    runtimeEdge.labelElement.wrapperEl,
    runtimeEdge.path.display, runtimeEdge.path.interaction,
  ];
}

function buildCollapseFixture() {
  const root = mindmapNode("root");
  const child = mindmapNode("child");
  const grandchild = mindmapNode("grandchild");
  const group = { id: "group", type: "group", feuillets_block: "mindmap", feuillets_block_version: 1, feuillets_block_id: "block-1" };
  const edgeRootChild = { id: "e1", fromNode: "root", toNode: "child", feuillets_managed: "mindmap", feuillets_block_id: "block-1" };
  const edgeChildGrandchild = { id: "e2", fromNode: "child", toNode: "grandchild", feuillets_managed: "mindmap", feuillets_block_id: "block-1" };
  const freeEdge = { id: "free-edge", fromNode: "root", toNode: "grandchild" };
  const canvasData = { nodes: [root, child, grandchild, group], edges: [edgeRootChild, edgeChildGrandchild, freeEdge] };

  const nodeEls = new Map([root, child, grandchild].map((n) => [n.id, makeFakeNodeEl()]));
  const nodesMap = new Map([root, child, grandchild].map((n) => [n.id, { id: n.id, nodeEl: nodeEls.get(n.id) }]));
  const edgesMap = new Map([
    [edgeRootChild.id, makeFakeRuntimeEdge(edgeRootChild)],
    [edgeChildGrandchild.id, makeFakeRuntimeEdge(edgeChildGrandchild)],
    [freeEdge.id, makeFakeRuntimeEdge(freeEdge)],
  ]);

  const plugin = Object.create(FeuilletsPlugin.prototype);
  const view = {
    canvas: {
      nodes: nodesMap,
      edges: edgesMap,
      getData: () => canvasData,
      setData: (updated) => { canvasData.nodes = updated.nodes; canvasData.edges = updated.edges; },
      requestSave: () => {},
    },
  };
  return { plugin, view, canvasData, nodeEls, edgesMap, root, child, grandchild, edgeRootChild, edgeChildGrandchild, freeEdge };
}

test("collapse edges — replier masque les descendants ET les edges structurelles, jamais l'edge libre", () => {
  const { plugin, view, canvasData, nodeEls, edgesMap, child, edgeChildGrandchild, freeEdge } = buildCollapseFixture();
  canvasData.nodes.find((n) => n.type === "group").mindmapCollapsed = [child.id];

  plugin.decorateMindmapCanvasView(view);

  assert.equal(nodeEls.get("grandchild").classList.contains("feuillets-mindmap-hidden"), true, "le petit-enfant est masqué");
  assert.equal(nodeEls.get("child").classList.contains("feuillets-mindmap-hidden"), false, "le node replié lui-même reste visible");
  for (const el of collapseEdgeElements(edgesMap.get(edgeChildGrandchild.id))) {
    assert.equal(el.classList.contains("feuillets-mindmap-hidden"), true, "chaque élément DOM de l'edge structurelle masquée");
  }
  for (const el of collapseEdgeElements(edgesMap.get(freeEdge.id))) {
    assert.equal(el.classList.contains("feuillets-mindmap-hidden"), false, "l'edge Canvas libre reste intacte");
  }
});

test("collapse edges — dépliage restaure la visibilité de tous les éléments", () => {
  const { plugin, view, canvasData, nodeEls, edgesMap, child, edgeChildGrandchild } = buildCollapseFixture();
  const group = canvasData.nodes.find((n) => n.type === "group");
  group.mindmapCollapsed = [child.id];
  plugin.decorateMindmapCanvasView(view);
  assert.equal(nodeEls.get("grandchild").classList.contains("feuillets-mindmap-hidden"), true);

  group.mindmapCollapsed = [];
  plugin.decorateMindmapCanvasView(view);

  assert.equal(nodeEls.get("grandchild").classList.contains("feuillets-mindmap-hidden"), false, "le node redevient visible");
  for (const el of collapseEdgeElements(edgesMap.get(edgeChildGrandchild.id))) {
    assert.equal(el.classList.contains("feuillets-mindmap-hidden"), false, "l'edge redevient visible");
  }
});

test("collapse edges — cleanup (forceVisible) retire toutes les classes résiduelles, nodes ET edges", () => {
  const { plugin, view, canvasData, nodeEls, edgesMap, child, edgeChildGrandchild } = buildCollapseFixture();
  canvasData.nodes.find((n) => n.type === "group").mindmapCollapsed = [child.id];
  plugin.decorateMindmapCanvasView(view);
  assert.equal(nodeEls.get("grandchild").classList.contains("feuillets-mindmap-hidden"), true);

  plugin.decorateMindmapCanvasView(view, { forceVisible: true });

  assert.equal(nodeEls.get("grandchild").classList.contains("feuillets-mindmap-hidden"), false);
  for (const el of collapseEdgeElements(edgesMap.get(edgeChildGrandchild.id))) {
    assert.equal(el.classList.contains("feuillets-mindmap-hidden"), false);
  }
});
