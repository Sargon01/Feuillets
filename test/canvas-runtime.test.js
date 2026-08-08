import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { replaceTextNodeWithFileNode, hasRuntimeReplaceContract } from "../src/services/canvas-runtime.js";
import { resolveOrCreateSheetFile } from "../src/services/canvas-bridge.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { CanvasNodeToManuscriptModal } from "../src/ui/canvas-bridge-modal.js";

/* Tests unitaires du mécanisme de remplacement runtime RÉEL (section
 * 13/14 du correctif structurel) — le SEUL chemin qui matérialise un vrai
 * FileNode, `createFileNode`/`removeNode`, jamais `setData`/`importData`
 * seuls (voir services/canvas-runtime.ts, tête de fichier, pour l'audit
 * complet et la raison pour laquelle l'hypothèse importData a été
 * abandonnée). */

class RuntimeTextNode {
  constructor(id, data) { this.id = id; this.raw = { ...data, id, type: "text" }; }
  getData() { return { ...this.raw, id: this.id, type: "text" }; }
  setData(data) { this.raw = { ...this.raw, ...data, id: this.id, type: "text" }; }
}
class RuntimeFileNode {
  constructor(id, data) { this.id = id; this.raw = { ...data, id, type: "file" }; }
  getData() { return { ...this.raw, id: this.id, type: "file" }; }
  setData(data) { this.raw = { ...this.raw, ...data, id: this.id, type: "file" }; }
}
class RuntimeEdge {
  constructor(id, data, nodes) {
    this.id = id;
    this.raw = { ...data, id };
    this.from = { node: nodes.get(data.fromNode), side: data.fromSide ?? "right", end: data.fromEnd ?? "none" };
    this.to = { node: nodes.get(data.toNode), side: data.toSide ?? "left", end: data.toEnd ?? "arrow" };
  }
  getData() {
    return { ...this.raw, id: this.id, fromNode: this.from.node.id, toNode: this.to.node.id };
  }
  setData(data) {
    // Comme Advanced Canvas : setData modifie les champs sérialisés, mais
    // ne rebranche pas les références runtime `from.node` / `to.node`.
    this.raw = { ...this.raw, ...data, id: this.id };
  }
  update(from, to) {
    this.from = from;
    this.to = to;
    this.raw = { ...this.raw, fromNode: from.node.id, toNode: to.node.id };
  }
}

let counter = 0;
function makeTrueRuntimeCanvas(nodeList, edgeList) {
  const nodes = new Map(nodeList.map((n) => [n.id, n.type === "file" ? new RuntimeFileNode(n.id, n) : new RuntimeTextNode(n.id, n)]));
  const edges = new Map(edgeList.map((e) => [e.id, new RuntimeEdge(e.id, e, nodes)]));
  let saveCalls = 0;
  return {
    nodes,
    edges,
    get saveCalls() { return saveCalls; },
    createFileNode(options) {
      counter += 1;
      const id = `generated-${counter}`;
      const node = new RuntimeFileNode(id, {
        x: options.pos.x, y: options.pos.y, width: options.size.width, height: options.size.height, file: options.file.path,
      });
      nodes.set(id, node);
      return node;
    },
    removeNode(node) {
      nodes.delete(node.id);
      for (const [edgeId, edge] of [...edges]) {
        if (edge.from.node === node || edge.to.node === node) edges.delete(edgeId);
      }
    },
    getEdgesForNode(node) {
      return [...edges.values()].filter((e) => e.from.node === node || e.to.node === node);
    },
    requestSave() { saveCalls++; },
  };
}

function makeProjectVault() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;
  const existing = new TFile("Projet/Manuscrit/scène 2.md", "salut");
  existing.parent = manuscript;
  manuscript.children = [existing];
  const { vault } = createFakeVault([volume, manuscript, existing]);
  const app = { vault };
  return { app, manuscript, existing };
}

// ---------------------------------------------------------------------------
// Section 13 : régression principale
// ---------------------------------------------------------------------------

test("replaceTextNodeWithFileNode : remplacement complet — 1 seul node, ancien TextNode disparu, edges/style/position conservés (13)", () => {
  const nodeA = {
    id: "A", type: "text", text: "scène 2",
    x: 100, y: 200, width: 320, height: 220,
    color: "4", styleAttributes: { border: "invisible" }, dynamicHeight: true, zIndex: 7,
  };
  const nodeB = { id: "B", type: "text", text: "autre idée", x: 0, y: 0, width: 100, height: 60 };
  const edgeBA = { id: "e1", fromNode: "B", toNode: "A", color: "2", label: "vers" };
  const canvas = makeTrueRuntimeCanvas([nodeA, nodeB], [edgeBA]);

  const file = new TFile("Projet/Manuscrit/scène 2.md", "salut");
  const result = replaceTextNodeWithFileNode(canvas, "A", file, "manuscript");

  assert.ok(result, "le remplacement doit réussir avec le contrat complet");
  const newId = result.newId;

  // 1 seul node à cet emplacement, ancien TextNode A disparu.
  assert.equal(canvas.nodes.has("A"), false, "l'ancien TextNode A doit avoir disparu");
  assert.equal(canvas.nodes.size, 2, "exactement 2 nodes (B inchangé + le nouveau file node), jamais 3");
  const newNode = canvas.nodes.get(newId);
  assert.ok(newNode instanceof RuntimeFileNode, "le nouveau node doit être une vraie instance FileNode");

  // Contenu/chemin corrects.
  const data = newNode.getData();
  assert.equal(data.type, "file");
  assert.equal(data.file, "Projet/Manuscrit/scène 2.md");
  assert.equal(data.feuillets_managed, "manuscript");
  assert.equal("text" in data, false, "aucune trace de `text` sur le nouveau file node");

  // Position/style identiques à l'ancien node.
  assert.equal(data.x, 100);
  assert.equal(data.y, 200);
  assert.equal(data.width, 320);
  assert.equal(data.height, 220);
  assert.equal(data.color, "4");
  assert.deepEqual(data.styleAttributes, { border: "invisible" });
  assert.equal(data.dynamicHeight, true);
  assert.equal(data.zIndex, 7);

  // Edge B→A toujours présente, redirigée vers le nouvel id, jamais dupliquée.
  assert.equal(canvas.edges.size, 1, "aucune edge dupliquée");
  const edge = [...canvas.edges.values()][0];
  const edgeData = edge.getData();
  assert.equal(edgeData.fromNode, "B");
  assert.equal(edgeData.toNode, newId);
  assert.equal(edgeData.color, "2");
  assert.equal(edgeData.label, "vers");

  // B (non concerné) strictement inchangé.
  assert.deepEqual(canvas.nodes.get("B").getData(), nodeB);

  // CORRECTIF (recherche contextuelle annulant le remplacement) :
  // `replaceTextNodeWithFileNode` n'appelle plus `requestSave()` lui-même —
  // un seul `requestSave()` final, appelé par l'orchestrateur UNE FOIS toute
  // la transaction terminée (voir integrations/advanced-canvas.ts,
  // `persistCanvasData`), pour ne jamais laisser de fenêtre où un
  // événement déclenché par une contextualisation Recherche ultérieure
  // (renameFile) pourrait provoquer une sauvegarde concurrente à partir
  // d'un état pas encore synchronisé.
  assert.equal(canvas.saveCalls, 0);
});

test("replaceTextNodeWithFileNode : edge dans l'autre sens (A→B) également redirigée", () => {
  const nodeA = { id: "A", type: "text", text: "scène", x: 0, y: 0, width: 100, height: 60 };
  const nodeB = { id: "B", type: "text", text: "autre", x: 0, y: 0, width: 100, height: 60 };
  const edgeAB = { id: "e1", fromNode: "A", toNode: "B" };
  const canvas = makeTrueRuntimeCanvas([nodeA, nodeB], [edgeAB]);
  const file = new TFile("Projet/Manuscrit/scène.md", "");

  const result = replaceTextNodeWithFileNode(canvas, "A", file, "manuscript");
  const edgeData = [...canvas.edges.values()][0].getData();
  assert.equal(edgeData.fromNode, result.newId);
  assert.equal(edgeData.toNode, "B");
});

test("replaceTextNodeWithFileNode : contrat runtime incomplet → retourne null, aucune mutation", () => {
  const canvas = { nodes: new Map([["A", new RuntimeTextNode("A", { text: "x" })]]) }; // pas de createFileNode/removeNode/getEdgesForNode
  assert.equal(hasRuntimeReplaceContract(canvas), false);
  const file = new TFile("Projet/Manuscrit/x.md", "");
  const result = replaceTextNodeWithFileNode(canvas, "A", file, "manuscript");
  assert.equal(result, null);
  assert.equal(canvas.nodes.get("A") instanceof RuntimeTextNode, true, "le node A n'a pas dû être touché");
});

test("replaceTextNodeWithFileNode : id introuvable → retourne null", () => {
  const canvas = makeTrueRuntimeCanvas([], []);
  const file = new TFile("Projet/Manuscrit/x.md", "");
  assert.equal(replaceTextNodeWithFileNode(canvas, "absent", file, "manuscript"), null);
});

// ---------------------------------------------------------------------------
// Section 14 : réparation d'un artefact déjà cassé (fichier déjà créé)
// ---------------------------------------------------------------------------

test("resolveOrCreateSheetFile : réutilise le fichier déjà créé par une tentative interrompue, jamais de doublon (14)", async () => {
  const { app, manuscript, existing } = makeProjectVault();
  // Node cassé typique : type resté "text" mais `file` déjà posé vers un
  // fichier réellement présent sur le disque (artefact runtime pré-correctif).
  const brokenNode = { id: "A", type: "text", text: "scène 2", file: "Projet/Manuscrit/scène 2.md" };

  const { file, wasCreated } = await resolveOrCreateSheetFile(app, brokenNode, manuscript, "manuscript");

  assert.equal(wasCreated, false, "le fichier déjà présent doit être réutilisé, jamais recréé");
  assert.equal(file, existing, "doit renvoyer exactement le TFile déjà existant");
  assert.equal(file.content, "salut", "le contenu existant n'est jamais écrasé");

  // Aucun second fichier "scène 2 2.md"/"scène 2 1.md" créé.
  assert.equal(app.vault.getAbstractFileByPath("Projet/Manuscrit/scène 2 2.md"), null);
  assert.equal(manuscript.children.filter((c) => c.name.startsWith("scène 2")).length, 1);
});

test("resolveOrCreateSheetFile : `node.file` pointant vers un fichier disparu → en crée un nouveau normalement", async () => {
  const { app, manuscript } = makeProjectVault();
  const brokenNode = { id: "A", type: "text", text: "Idée fantôme", file: "Projet/Manuscrit/Introuvable.md" };
  const { file, wasCreated } = await resolveOrCreateSheetFile(app, brokenNode, manuscript, "manuscript");
  assert.equal(wasCreated, true);
  assert.equal(file.path, "Projet/Manuscrit/Idée fantôme.md");
});

test("resolveOrCreateSheetFile : node normal sans `file` → crée toujours un nouveau fichier (comportement inchangé)", async () => {
  const { app, manuscript } = makeProjectVault();
  const node = { id: "A", type: "text", text: "Nouvelle idée" };
  const { file, wasCreated } = await resolveOrCreateSheetFile(app, node, manuscript, "manuscript");
  assert.equal(wasCreated, true);
  assert.equal(file.path, "Projet/Manuscrit/Nouvelle idée.md");
});

test("replaceTextNodeWithFileNode + resolveOrCreateSheetFile : réparation complète d'un artefact cassé produit UN SEUL vrai FileNode", async () => {
  const { app, manuscript, existing } = makeProjectVault();
  const brokenNode = {
    id: "A", type: "text", text: "scène 2", file: "Projet/Manuscrit/scène 2.md",
    x: 5, y: 6, width: 100, height: 60,
  };
  const canvas = makeTrueRuntimeCanvas([brokenNode], []);

  const { file, wasCreated } = await resolveOrCreateSheetFile(app, brokenNode, manuscript, "manuscript");
  assert.equal(wasCreated, false);
  assert.equal(file, existing);

  const result = replaceTextNodeWithFileNode(canvas, "A", file, "manuscript");
  assert.ok(result);
  assert.equal(canvas.nodes.has("A"), false);
  assert.equal(canvas.nodes.size, 1);
  const finalNode = canvas.nodes.get(result.newId);
  assert.ok(finalNode instanceof RuntimeFileNode);
  assert.equal(finalNode.getData().file, "Projet/Manuscrit/scène 2.md");

  // Toujours un seul fichier physique.
  assert.equal(manuscript.children.filter((c) => c.name.startsWith("scène 2")).length, 1);
});

// ---------------------------------------------------------------------------
// Régression : la contextualisation Recherche ne doit jamais annuler le
// remplacement runtime (section 7/8 du correctif ciblé)
// ---------------------------------------------------------------------------

function makeTrueRuntimeFullCanvas(boardFile, nodeList, edgeList) {
  const nodes = new Map(nodeList.map((n) => [n.id, n.type === "file" ? new RuntimeFileNode(n.id, n) : new RuntimeTextNode(n.id, n)]));
  const edges = new Map(edgeList.map((e) => [e.id, new RuntimeEdge(e.id, e, nodes)]));
  let counter2 = 0;
  return {
    view: { file: boardFile },
    nodes,
    getData() {
      return { nodes: [...nodes.values()].map((n) => n.getData()), edges: [...edges.values()].map((e) => e.getData()) };
    },
    setData(data) {
      for (const nodeData of data.nodes) {
        const existing = nodes.get(nodeData.id);
        if (existing) existing.setData(nodeData);
        else nodes.set(nodeData.id, nodeData.type === "file" ? new RuntimeFileNode(nodeData.id, nodeData) : new RuntimeTextNode(nodeData.id, nodeData));
      }
      const seen = new Set(data.nodes.map((n) => n.id));
      for (const id of [...nodes.keys()]) if (!seen.has(id)) nodes.delete(id);
      edges.clear();
      for (const e of data.edges) edges.set(e.id, new RuntimeEdge(e.id, e, nodes));
    },
    importData(data, clearCanvas) { void clearCanvas; this.setData(data); },
    createFileNode(options) {
      counter2 += 1;
      const id = `regress-generated-${counter2}`;
      const node = new RuntimeFileNode(id, { x: options.pos.x, y: options.pos.y, width: options.size.width, height: options.size.height, file: options.file.path });
      nodes.set(id, node);
      return node;
    },
    removeNode(node) {
      nodes.delete(node.id);
      for (const [edgeId, edge] of [...edges]) {
        if (edge.from.node === node || edge.to.node === node) edges.delete(edgeId);
      }
    },
    getEdgesForNode(node) {
      return [...edges.values()].filter((e) => e.from.node === node || e.to.node === node);
    },
    requestSave() {},
  };
}

function fireNodeMenu2(app, menu, node) {
  const handler = app.workspace.handlers["canvas:node-menu"];
  handler(menu, node);
}

function makeMeryemProject() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Recherche");
  const carnet = new TFolder("Projet/Recherche/Carnet");
  volume.children = [manuscript, research];
  research.children = [carnet];
  manuscript.parent = volume;
  research.parent = volume;
  carnet.parent = research;
  const { vault, fileManager } = createFakeVault([volume, manuscript, research, carnet]);
  const app = {
    vault, fileManager,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: { handlers: {}, on(name, cb) { this.handlers[name] = cb; return { name }; } },
  };
  const settings = { projectFolder: manuscript.path, level1Role: "chapitres", orders: {}, folderPositions: {}, projectMeta: {} };
  const plugin = { app, settings, registerEvent() {}, saveSettings: async () => {} };
  return { app, settings, plugin, manuscript };
}

test("TEST A (contrôle, sans Recherche) : scène → feuillet → vrai FileNode, ancien TextNode absent", async () => {
  const { app, plugin, manuscript } = makeMeryemProject();
  registerAdvancedCanvasIntegration(plugin);
  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const sceneNode = { id: "scene", type: "text", text: "meryem joue du tambur", x: 0, y: 0, width: 100, height: 60 };
  const canvas = makeTrueRuntimeFullCanvas(boardFile, [sceneNode], []);

  let capturedModal = null;
  const originalOpen = CanvasNodeToManuscriptModal.prototype.open;
  CanvasNodeToManuscriptModal.prototype.open = function () { capturedModal = this; };
  try {
    const menu = new Menu();
    fireNodeMenu2(app, menu, { canvas, getData: () => ({ id: "scene", type: "text", text: "meryem joue du tambur" }) });
    menu.items.find((i) => i.title === "Transformer en feuillet").callback();
  } finally {
    CanvasNodeToManuscriptModal.prototype.open = originalOpen;
  }
  await capturedModal.onConfirm(manuscript);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(canvas.nodes.has("scene"), false, "ancien TextNode « scene » doit avoir disparu");
  const finalNodes = [...canvas.nodes.values()];
  assert.equal(finalNodes.length, 1);
  assert.ok(finalNodes[0] instanceof RuntimeFileNode, "runtime final doit être un vrai FileNode");
  assert.match(finalNodes[0].id, /^regress-generated-/, "la conversion utilise createFileNode du runtime, pas seulement le JSON");
  assert.equal(finalNodes[0].getData().type, "file");
});

// Simplification Carnet : une fiche Recherche reliée par edge à une idée en
// cours de transformation n'est plus jamais déplacée/contextualisée
// automatiquement — voir test/canvas-notebook-simplification.test.js (TEST 2).
