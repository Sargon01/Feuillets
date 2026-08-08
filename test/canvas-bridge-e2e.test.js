import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { CanvasNodeToManuscriptModal } from "../src/ui/canvas-bridge-modal.js";

/* CORRECTIF STRUCTUREL — le faux canvas ci-dessous modélise le contrat
 * Advanced Canvas RÉELLEMENT observé (confirmé par test manuel réel dans
 * Obsidian, pas seulement par lecture de types) :
 *
 *   - `node.setData(...)`/`canvas.setData(...)`/`canvas.importData(...)`
 *     NE PEUVENT PAS transformer une instance TextNode en instance FileNode
 *     — chaque instance garde sa PROPRE classe pour toujours, quel que soit
 *     le `type` qu'on tente de lui réappliquer.
 *   - SEUL `canvas.createFileNode(...)` crée une vraie instance FileNode,
 *     et SEUL `canvas.removeNode(...)` retire une instance de
 *     `canvas.nodes` — ce sont les deux seuls leviers testés ici pour
 *     matérialiser un remplacement de type.
 *   - `removeNode` retire aussi, comme un vrai canvas, toute edge encore
 *     attachée à l'id supprimé. */

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
    this.raw = { ...this.raw, ...data, id: this.id };
  }
  update(from, to) {
    this.from = from;
    this.to = to;
    this.raw = { ...this.raw, fromNode: from.node.id, toNode: to.node.id };
  }
}

let generatedIdCounter = 0;
function nextGeneratedId() {
  generatedIdCounter += 1;
  return `generated-${generatedIdCounter}`;
}

function makeTrueRuntimeCanvas(boardFile, nodeList, edgeList) {
  const nodes = new Map(nodeList.map((n) => [n.id, n.type === "file" ? new RuntimeFileNode(n.id, n) : new RuntimeTextNode(n.id, n)]));
  const edges = new Map(edgeList.map((e) => [e.id, new RuntimeEdge(e.id, e, nodes)]));

  function applyNodeJson(nodeData) {
    const existing = nodes.get(nodeData.id);
    if (existing) existing.setData(nodeData);
    else nodes.set(nodeData.id, nodeData.type === "file" ? new RuntimeFileNode(nodeData.id, nodeData) : new RuntimeTextNode(nodeData.id, nodeData));
  }

  const canvas = {
    view: { file: boardFile },
    nodes,
    getData() {
      return {
        nodes: [...nodes.values()].map((n) => n.getData()),
        edges: [...edges.values()].map((e) => e.getData()),
      };
    },
    setData(data) {
      for (const nodeData of data.nodes) applyNodeJson(nodeData);
      const seenNodes = new Set(data.nodes.map((n) => n.id));
      for (const id of [...nodes.keys()]) if (!seenNodes.has(id)) nodes.delete(id);

      edges.clear();
      for (const edgeData of data.edges) edges.set(edgeData.id, new RuntimeEdge(edgeData.id, edgeData, nodes));
    },
    importData(data, clearCanvas) {
      void clearCanvas;
      this.setData(data);
    },
    createFileNode(options) {
      const id = nextGeneratedId();
      const node = new RuntimeFileNode(id, {
        x: options.pos.x, y: options.pos.y,
        width: options.size.width, height: options.size.height,
        file: options.file.path,
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
    requestSave() {},
  };
  return canvas;
}

function fireNodeMenu(app, menu, node) {
  const handler = app.workspace.handlers["canvas:node-menu"];
  handler(menu, node);
}

function makeProject() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Recherche");
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  const { vault, fileManager } = createFakeVault([volume, manuscript, research]);
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: { handlers: {}, on(name, cb) { this.handlers[name] = cb; return { name }; } },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    folderPositions: {},
    projectMeta: {},
  };
  const plugin = { app, settings, registerEvent() {}, saveSettings: async () => {} };
  return { app, settings, plugin, volume, manuscript };
}

test("aucune duplication : deux transformations successives du même text node ne laissent jamais coexister TextNode et FileNode", async () => {
  const { app, plugin, manuscript } = makeProject();
  registerAdvancedCanvasIntegration(plugin);
  const boardFile = new TFile(canvasPathFor(app, manuscript), "");
  const node = { id: "s1", type: "text", text: "scène 2", x: 0, y: 0, width: 100, height: 60 };
  const canvas = makeTrueRuntimeCanvas(boardFile, [node], []);

  let capturedModal = null;
  const originalOpen = CanvasNodeToManuscriptModal.prototype.open;
  CanvasNodeToManuscriptModal.prototype.open = function () { capturedModal = this; };
  try {
    const menu = new Menu();
    fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "s1", type: "text", text: "scène 2" }) });
    menu.items.find((i) => i.title === "Transformer en feuillet").callback();
  } finally {
    CanvasNodeToManuscriptModal.prototype.open = originalOpen;
  }
  await capturedModal.onConfirm(manuscript);
  await new Promise((r) => setTimeout(r, 0));

  const before = canvas.getData();
  assert.equal(before.nodes.length, 1, "un seul node attendu après la première transformation");
  assert.equal(before.nodes[0].type, "file");

  const createdFile = app.vault.getAbstractFileByPath("Projet/Manuscrit/scène 2.md");
  assert.ok(createdFile instanceof TFile, "scène 2.md doit exister après la première transformation");

  // Compte le nombre de fichiers "scène 2*.md" dans Manuscrit — aucun
  // doublon ne doit jamais apparaître, même en cas de nouvelle tentative.
  const countMdFor = (name) => {
    let n = 0;
    const walk = (folder) => {
      for (const child of folder.children || []) {
        if (child.path && child.path.startsWith(`Projet/Manuscrit/${name}`)) n++;
        if (child.children) walk(child);
      }
    };
    walk(manuscript);
    return n;
  };
  assert.equal(countMdFor("scène 2"), 1, "un seul fichier scène 2*.md attendu, aucun doublon");
});
