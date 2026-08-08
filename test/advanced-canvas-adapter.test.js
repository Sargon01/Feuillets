import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { CanvasBridgeModal, CanvasNodeToManuscriptModal } from "../src/ui/canvas-bridge-modal.js";
import { CanvasChapterModal } from "../src/ui/canvas-chapter-modal.js";

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

// 1. canvas:node-menu sur un text node du Carnet → 2 actions Feuillets
test("registerAdvancedCanvasIntegration : node-menu sur un text node du Carnet → 3 actions (manuscrit/recherche/scinder)", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t1", type: "text" }) });

  assert.equal(menu.items.length, 3);
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

// 3. file node → aucune commande Canvas : le menu de fichier Feuillets
// fournit seul « Feuillets: Scinder » au runtime.
test("registerAdvancedCanvasIntegration : node-menu sur un file node → aucune scission Canvas", () => {
  const { app, plugin, manuscript, ch1 } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [{ id: "f1", type: "file", file: ch1.path }]);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "f1", type: "file" }) });

  assert.equal(menu.items.length, 0);
  assert.equal(menu.items.some((i) => i.title.includes("chapitre")), false);
});

// 4. text node → conserve uniquement les actions Lot 1 (jamais l'action chapitre)
test("registerAdvancedCanvasIntegration : node-menu sur un text node → jamais l'action chapitre, toujours Scinder", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [{ id: "t1", type: "text", text: "Idée" }]);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t1", type: "text", text: "Idée" }) });

  assert.equal(menu.items.length, 3);
  assert.equal(menu.items[0].title, "Transformer en feuillet");
  assert.equal(menu.items[1].title, "Transformer en fiche Recherche");
  assert.equal(menu.items[2].title, "Scinder…");
  assert.equal(menu.items.some((i) => i.title.includes("chapitre")), false);
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
