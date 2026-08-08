import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { CanvasBridgeModal, CanvasNodeToManuscriptModal } from "../src/ui/canvas-bridge-modal.js";
import { CanvasChapterModal } from "../src/ui/canvas-chapter-modal.js";
import { CanvasIdeaTreeModal } from "../src/ui/canvas-idea-tree-modal.js";
import { ideaTreeBranch } from "../src/services/canvas-idea-tree.js";

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

function makeFakeNodeEl() {
  const classes = new Set();
  let iframe = makeFakeIframe();
  return {
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
    },
    querySelector(sel) {
      return sel === "iframe" ? iframe : null;
    },
    setIframe(el) {
      iframe = el;
    },
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
  return { app, plugin, settings, manuscript, boardFile, canvas, scope, view, cleanups, registeredCleanups };
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
test("registerAdvancedCanvasIntegration : node-menu TextNode conserve les actions historiques et ajoute Développer en arbre", () => {
  const { app, plugin, manuscript } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t1", type: "text" }) });

  assert.equal(menu.items.length, 5);
  assert.equal(menu.items.some((item) => item.title === "Développer en arbre…"), true);
  assert.equal(menu.items.some((item) => item.title === "Ajouter une branche"), true);
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
  assert.equal(nodeMenu.items.length, 5);
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

// 3. file node manuscrit → arbre, mais toujours aucune scission Canvas.
test("registerAdvancedCanvasIntegration : node-menu FileNode manuscrit → arbre sans scission Canvas", () => {
  const { app, plugin, manuscript, ch1 } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [{ id: "f1", type: "file", file: ch1.path }]);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "f1", type: "file" }) });

  assert.equal(menu.items.length, 1);
  assert.equal(menu.items[0].title, "Développer en arbre…");
  assert.equal(menu.items.some((i) => i.title === "Scinder…"), false);
  assert.equal(menu.items.some((i) => i.title.includes("chapitre")), false);
});

// 4. text node libre → conserve les actions Lot 1 et l'arbre, jamais chapitre.
test("registerAdvancedCanvasIntegration : node-menu sur un text node → jamais l'action chapitre, toujours Scinder", () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);

  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const canvas = makeLiveCanvas(boardFile, [{ id: "t1", type: "text", text: "Idée" }]);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "t1", type: "text", text: "Idée" }) });

  assert.equal(menu.items.length, 5);
  assert.equal(menu.items[0].title, "Transformer en feuillet");
  assert.equal(menu.items[1].title, "Transformer en fiche Recherche");
  assert.equal(menu.items[2].title, "Scinder…");
  assert.equal(menu.items[3].title, "Ajouter une branche");
  assert.equal(menu.items[4].title, "Développer en arbre…");
  assert.equal(menu.items.some((i) => i.title.includes("chapitre")), false);
});

test("registerAdvancedCanvasIntegration : Développer en arbre ouvre la modale légère et persiste uniquement nodes/edges", async () => {
  const { app, plugin, manuscript } = makeFixtureWithManuscriptFiles();
  registerAdvancedCanvasIntegration(plugin);
  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const parent = { id: "A", type: "text", text: "A", x: 0, y: 0, width: 240, height: 80 };
  const canvas = makeLiveCanvas(boardFile, [parent]);

  let captured = null;
  const originalOpen = CanvasIdeaTreeModal.prototype.open;
  CanvasIdeaTreeModal.prototype.open = function () { captured = this; };
  try {
    const menu = new Menu();
    fireNodeMenu(app, menu, { canvas, getData: () => parent });
    menu.items.find((item) => item.title === "Développer en arbre…").callback();
  } finally {
    CanvasIdeaTreeModal.prototype.open = originalOpen;
  }
  assert.ok(captured);
  await captured.onSubmit("B\nC");
  assert.deepEqual(canvas.getData().nodes.filter((node) => node.type === "text").map((node) => node.text), ["A", "B", "C"]);
  assert.ok(canvas.getData().edges.every((edge) => edge.feuillets_managed === "idea-tree"));
});

test("registerAdvancedCanvasIntegration : une node d'arbre ouvre le chapitre avec l'ordre DFS exact", () => {
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

  let captured = null;
  const originalOpen = CanvasChapterModal.prototype.open;
  CanvasChapterModal.prototype.open = function () { captured = this; };
  try {
    const menu = new Menu();
    fireNodeMenu(app, menu, { canvas, getData: () => nodes[0] });
    menu.items.find((item) => item.title === "Créer un chapitre avec cette branche…").callback();
  } finally {
    CanvasChapterModal.prototype.open = originalOpen;
  }
  assert.ok(captured);
  assert.equal(captured.context.source, "idea-tree");
  assert.deepEqual(captured.context.ids, ["A", "B", "C"]);
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
// Lot 5 — Arbre d'idées : raccourcis clavier (Scope), lisibilité, menu.
// ---------------------------------------------------------------------------

test("Lot 5 — Scope : Tab et Entrée sont enregistrés dans le Scope de la vue Carnet", () => {
  const { plugin, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.filter((h) => h.key === "Tab").length, 1);
  assert.equal(scope.handlers.filter((h) => h.key === "Enter").length, 1);
});

test("Lot 5 — Scope : un Canvas qui n'est pas le Carnet du projet actif n'obtient aucun raccourci", () => {
  const { plugin, scope, view } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  const wrongFile = new TFile("Projet/Autre.canvas", "");
  view.file = wrongFile;
  view.canvas.view.file = wrongFile;
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.length, 0);
});

test("Lot 5 — Tab sur un node sélectionné et non édité crée un enfant idea-tree (rien d'autre : pas de sélection/édition automatique)", () => {
  const { plugin, canvas, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A", x: 0, y: 0, width: 260, height: 80 }]);
  registerAdvancedCanvasIntegration(plugin);
  const runtimeA = canvas.nodes.get("A");
  canvas.selection = new Set([runtimeA]);
  const selectionBefore = canvas.selection;

  const tabHandler = scope.handlers.find((h) => h.key === "Tab");
  assert.ok(tabHandler);
  const evt = { preventDefault() { this.prevented = true; } };
  tabHandler.func(evt, {});

  assert.equal(evt.prevented, true);
  const nodes = canvas.getData().nodes;
  assert.equal(nodes.length, 2);
  const child = nodes[1];
  assert.equal(child.text, "");
  assert.equal(child.width, 260);
  assert.equal(child.height, 80);
  assert.equal(child.x, 170);
  assert.equal(child.y, 60);

  const runtimeChild = canvas.nodes.get(child.id);
  assert.ok(runtimeChild, "le node créé existe dans canvas.nodes");

  // Décision produit VERSION FINALE : aucune sélection ni édition
  // automatique du node créé — la sélection du Canvas reste celle de
  // l'utilisateur (A), le nouveau node n'est pas en édition.
  assert.equal(canvas.selection, selectionBefore);
  assert.equal([...canvas.selection][0], runtimeA);
  assert.equal(runtimeChild.isEditing, false);

  // Aucun zoom, aucun déplacement de viewport.
  for (const zoomFn of ["zoomToSelection", "zoomToFit", "zoomToBbox", "setViewport"]) {
    assert.equal(zoomFn in canvas, false);
  }
});

test("Lot 5 — Entrée sur un membre avec parent, non édité, crée un frère juste après lui (rien d'autre)", () => {
  const { plugin, canvas, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A", x: 0, y: 0 }]);
  registerAdvancedCanvasIntegration(plugin);
  const runtimeA = canvas.nodes.get("A");
  canvas.selection = new Set([runtimeA]);
  scope.handlers.find((h) => h.key === "Tab").func({ preventDefault() {} }, {});
  const bId = canvas.getData().nodes[1].id;
  const runtimeB = canvas.nodes.get(bId);
  canvas.selection = new Set([runtimeB]);

  const enterHandler = scope.handlers.find((h) => h.key === "Enter");
  const evt = { preventDefault() { this.prevented = true; } };
  enterHandler.func(evt, {});

  assert.equal(evt.prevented, true);
  const finalData = canvas.getData();
  assert.equal(finalData.nodes.length, 3);
  const cId = finalData.nodes[2].id;
  assert.equal(finalData.nodes[2].text, "");
  assert.deepEqual(ideaTreeBranch(finalData, "A").map((n) => n.id), ["A", bId, cId]);

  const runtimeC = canvas.nodes.get(cId);
  assert.ok(runtimeC, "le frère créé existe dans canvas.nodes");
  assert.equal([...canvas.selection][0], runtimeB, "la sélection reste celle de l'utilisateur, jamais déplacée sur C");
  assert.equal(runtimeC.isEditing, false);

  for (const zoomFn of ["zoomToSelection", "zoomToFit", "zoomToBbox", "setViewport"]) {
    assert.equal(zoomFn in canvas, false);
  }
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

test("Lot 5 — VERSION FINALE : aucune logique d'autofocus ne subsiste (Tab/Entrée ne touchent ni sélection ni édition)", () => {
  const { plugin, canvas, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A", x: 0, y: 0 }]);
  registerAdvancedCanvasIntegration(plugin);
  const runtimeA = canvas.nodes.get("A");
  canvas.selection = new Set([runtimeA]);
  const selectionRef = canvas.selection;

  // Tab : création d'un enfant.
  scope.handlers.find((h) => h.key === "Tab").func({ preventDefault() {} }, {});
  const bId = canvas.getData().nodes[1].id;
  const runtimeB = canvas.nodes.get(bId);

  // Aucun helper de sélection/édition automatique n'a été appelé : la
  // référence de sélection du Canvas n'a même pas changé d'objet, et le
  // nouveau node n'a jamais été touché.
  assert.equal(canvas.selection, selectionRef);
  assert.equal([...canvas.selection][0], runtimeA);
  assert.equal(runtimeB.isEditing, false);
  assert.equal("startEditing" in runtimeB, false);
  assert.equal("setIsEditing" in runtimeB, false);
  assert.equal("selectOnly" in canvas, false);

  // Entrée : création d'un frère — même constat.
  canvas.selection = new Set([runtimeB]);
  const selectionRef2 = canvas.selection;
  scope.handlers.find((h) => h.key === "Enter").func({ preventDefault() {} }, {});
  const cId = canvas.getData().nodes[2].id;
  const runtimeC = canvas.nodes.get(cId);

  assert.equal(canvas.selection, selectionRef2);
  assert.equal([...canvas.selection][0], runtimeB);
  assert.equal(runtimeC.isEditing, false);
});

test("Lot 5 — les handlers Tab/Entrée sont désenregistrés au déchargement de la VUE", () => {
  const { plugin, scope, cleanups } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.length, 2);
  cleanups.forEach((cb) => cb());
  assert.equal(scope.handlers.length, 0);
});

test("Lot 5 — les handlers Tab/Entrée sont aussi désenregistrés au déchargement du PLUGIN", () => {
  const { plugin, scope, registeredCleanups } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.length, 2);
  registeredCleanups.forEach((cb) => cb());
  assert.equal(scope.handlers.length, 0);
});

test("Lot 5 — attachIdeaTreeKeymaps n'attache jamais deux fois la même vue Carnet", () => {
  const { plugin, scope } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(scope.handlers.length, 2);
  plugin.app.workspace.handlers["active-leaf-change"]();
  plugin.app.workspace.handlers["layout-change"]();
  assert.equal(scope.handlers.length, 2);
});

test("Lot 5 — classe de lecture posée sur les membres idea-tree, jamais sur une carte libre", () => {
  const { plugin, canvas, scope } = makeScopedFixture([
    { id: "A", type: "text", text: "A" },
    { id: "LIBRE", type: "text", text: "Libre" },
  ]);
  registerAdvancedCanvasIntegration(plugin);
  canvas.selection = new Set([canvas.nodes.get("A")]);
  scope.handlers.find((h) => h.key === "Tab").func({ preventDefault() {} }, {});

  assert.equal(canvas.nodes.get("A").nodeEl.classList.contains("feuillets-idea-tree-member"), true);
  const childId = canvas.getData().nodes.find((n) => n.id !== "A" && n.id !== "LIBRE").id;
  assert.equal(canvas.nodes.get(childId).nodeEl.classList.contains("feuillets-idea-tree-member"), true);
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

test("Lot 5 — menu « Ajouter une branche » crée un enfant (aucune sélection/édition automatique)", () => {
  const { app, plugin, canvas } = makeScopedFixture([{ id: "A", type: "text", text: "A" }]);
  registerAdvancedCanvasIntegration(plugin);
  const runtimeA = canvas.nodes.get("A");
  canvas.selection = new Set([runtimeA]);

  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "A", type: "text", text: "A" }) });
  const item = menu.items.find((i) => i.title === "Ajouter une branche");
  assert.ok(item);
  item.callback();

  const nodes = canvas.getData().nodes;
  assert.equal(nodes.length, 2);
  const child = nodes[1];
  assert.equal(child.text, "");

  const runtimeChild = canvas.nodes.get(child.id);
  assert.ok(runtimeChild);
  assert.equal(runtimeChild.isEditing, false);
  assert.equal([...canvas.selection][0], runtimeA, "la sélection reste celle de l'utilisateur");
});

test("Lot 5 — menu « Réorganiser l'arbre » appelle exclusivement reflowIdeaTree, aucun zoom", () => {
  const nodeA = { id: "A", type: "text", text: "A", x: 0, y: 0 };
  const nodeB = { id: "B", type: "text", text: "B", x: 999, y: 999 };
  const { app, plugin, canvas } = makeScopedFixture([nodeA, nodeB]);
  canvas.getData().edges.push({ id: "ab", fromNode: "A", toNode: "B", feuillets_managed: "idea-tree" });
  for (const zoomFn of ["zoomToSelection", "zoomToFit", "zoomToBbox", "setViewport"]) {
    canvas[zoomFn] = () => {
      throw new Error(`${zoomFn} ne doit jamais être appelée`);
    };
  }
  registerAdvancedCanvasIntegration(plugin);

  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "A", type: "text", text: "A" }) });
  const item = menu.items.find((i) => i.title === "Réorganiser l'arbre");
  assert.ok(item);
  assert.doesNotThrow(() => item.callback());

  const updatedB = canvas.getData().nodes.find((n) => n.id === "B");
  assert.equal(updatedB.x, nodeA.x + 170);
  assert.equal(updatedB.y, nodeA.y + 60);
});

test("Lot 5 — une carte libre (hors idea-tree) n'obtient jamais « Réorganiser l'arbre »", () => {
  const { app, plugin, canvas } = makeScopedFixture([{ id: "LIBRE", type: "text", text: "Libre" }]);
  registerAdvancedCanvasIntegration(plugin);
  const menu = new Menu();
  fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "LIBRE", type: "text", text: "Libre" }) });
  assert.equal(menu.items.some((i) => i.title === "Réorganiser l'arbre"), false);
});

/* Faux <contentEl> minimal — suffisant pour CanvasChapterModal.onOpen() sans
 * dépendre d'un vrai DOM : seuls createEl/createDiv/addClass/empty/focus/
 * addEventListener sont réellement utilisés par cette modale. */
class FakeChapterEl {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.value = "";
  }
  createEl(tag, opts = {}) {
    const el = new FakeChapterEl(tag);
    if (opts.text !== undefined) el.text = opts.text;
    if (opts.type !== undefined) el.type = opts.type;
    if (opts.value !== undefined) el.value = opts.value;
    if (opts.cls) el.classes.add(opts.cls);
    this.children.push(el);
    return el;
  }
  createDiv(opts = {}) {
    return this.createEl("div", opts);
  }
  createSpan(opts = {}) {
    return this.createEl("span", opts);
  }
  addClass(c) {
    this.classes.add(c);
    return this;
  }
  empty() {
    this.children = [];
  }
  focus() {}
  addEventListener() {}
}

test("Lot 5 — CanvasChapterModal (source idea-tree) préremplit le nom avec le NODE CLIQUÉ, jamais avec la racine", () => {
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

  let captured = null;
  const originalOpen = CanvasChapterModal.prototype.open;
  CanvasChapterModal.prototype.open = function () {
    captured = this;
  };
  try {
    const menu = new Menu();
    // Action lancée depuis B, pas depuis la racine A.
    fireNodeMenu(app, menu, { canvas, getData: () => nodeB });
    menu.items.find((item) => item.title === "Créer un chapitre avec cette branche…").callback();
  } finally {
    CanvasChapterModal.prototype.open = originalOpen;
  }
  assert.ok(captured);
  assert.deepEqual(captured.context.ids, ["B", "C"]);

  captured.contentEl = new FakeChapterEl();
  captured.onOpen();
  const nameInputEl = captured.contentEl.children.find((c) => c.tag === "input" && c.type === "text");
  assert.ok(nameInputEl);
  assert.equal(nameInputEl.value, "B");
});
