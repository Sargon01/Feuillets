import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { CanvasBridgeModal, CanvasNodeToManuscriptModal } from "../src/ui/canvas-bridge-modal.js";

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
  const plugin = { app, settings, registerEvent() {} };
  return { app, settings, plugin, manuscript, research };
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

test("registerAdvancedCanvasIntegration : s'enregistre sans planter même sans Advanced Canvas", () => {
  const { plugin } = makeFixture();
  assert.doesNotThrow(() => registerAdvancedCanvasIntegration(plugin));
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

// 1. canvas:node-menu sur un text node du Carnet → 2 actions Feuillets
test("registerAdvancedCanvasIntegration : node-menu sur un text node du Carnet → 2 actions", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t1", type: "text" }) });

  assert.equal(menu.items.length, 2);
  assert.ok(menu.items.every((item) => typeof item.callback === "function"));
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

// 3. group node → aucune action dans ce Lot
test("registerAdvancedCanvasIntegration : node-menu sur un group node → aucune action", () => {
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
  const convertedNode = data.nodes.find((n) => n.id === "t2");
  const otherNode = data.nodes.find((n) => n.id === "t1");

  assert.equal(convertedNode.type, "file");
  assert.equal(convertedNode.feuillets_managed, "research");
  assert.equal(convertedNode.file, `${research.path}/Ney.md`);
  assert.deepEqual(otherNode, untouched, "l'autre text node doit rester strictement inchangé");

  const created = app.vault.getAbstractFileByPath(`${research.path}/Ney.md`);
  assert.ok(created, "la fiche Recherche doit avoir été créée directement, sans modale");
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
  const converted = canvas.setDataCalls[0].nodes.find((n) => n.id === "t7");
  assert.equal(converted.type, "file");
  assert.equal(converted.feuillets_managed, "manuscript");
  assert.equal(converted.file, `${chapter.path}/Kemal arrive au village.md`);
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
  assert.equal(nodeMenu.items.length, 2);
});
