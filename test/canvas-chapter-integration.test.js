import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { CanvasChapterModal } from "../src/ui/canvas-chapter-modal.js";

/* Test d'intégration RÉALISTE : passe par l'entrée réelle de la
 * fonctionnalité — canvas:node-menu (clic droit sur un groupe) → menu
 * Advanced Canvas → CanvasChapterModal → rendu DOM réel (FakeElement) →
 * clic sur le bouton de confirmation — jamais un appel direct à
 * executeChapterPlan. Simplification Carnet : plus aucune fiche Recherche
 * n'intervient dans ce flux (voir test/canvas-notebook-simplification.test.js
 * pour les garanties « une edge n'a aucun effet métier »). */

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = "";
    this.text = options.text ?? "";
    this.attributes = { ...(options.attr ?? {}) };
    this.style = { cssText: "" };
    if (options.type) this.type = options.type;
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  addEventListener(type, cb) { this.events.set(type, cb); }
  async trigger(type, event = {}) { await this.events.get(type)?.(event); }
  focus() {}
  empty() { this.children = []; }
  remove() { this.removed = true; }
}

function findElements(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findElements(child, predicate));
  }
  return found;
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeProject() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;

  const { vault, fileManager } = createFakeVault([volume, manuscript]);
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

function fireNodeMenu(app, menu, node) {
  const handler = app.workspace.handlers["canvas:node-menu"];
  handler(menu, node);
}

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
let chapterCounter = 0;
function makeTrueRuntimeCanvas(boardFile, nodeList, edgeList) {
  const nodes = new Map(nodeList.map((n) => [n.id, n.type === "file" ? new RuntimeFileNode(n.id, n) : new RuntimeTextNode(n.id, n)]));
  const edges = new Map(edgeList.map((e) => [e.id, new RuntimeEdge(e.id, e, nodes)]));
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
    createFileNode(options) {
      chapterCounter += 1;
      const id = `chapter-generated-${chapterCounter}`;
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

test("workflow réel node-menu groupe → chapitre (canvas RUNTIME fidèle) : chaque scène devient un vrai FileNode, jamais un TextNode résiduel", async () => {
  const { app, plugin, manuscript } = makeProject();
  registerAdvancedCanvasIntegration(plugin);
  const boardFile = new TFile(canvasPathFor(app, manuscript), "");

  const group = { id: "g-deux", type: "group", label: "DEUX", x: 0, y: 0, width: 500, height: 200 };
  const un = { id: "un", type: "text", text: "un", x: 10, y: 10, width: 100, height: 60 };
  const deux = { id: "deux", type: "text", text: "deux", x: 250, y: 10, width: 100, height: 60 };
  const canvas = makeTrueRuntimeCanvas(boardFile, [group, un, deux], []);

  let captured = null;
  const originalOpen = CanvasChapterModal.prototype.open;
  CanvasChapterModal.prototype.open = function () { captured = this; };
  try {
    const menu = new Menu();
    fireNodeMenu(app, menu, { canvas, getData: () => ({ id: "g-deux", type: "group" }) });
    menu.items.find((i) => i.title === "Créer un chapitre dans le manuscrit…").callback();
  } finally {
    CanvasChapterModal.prototype.open = originalOpen;
  }
  assert.ok(captured);
  const modal = captured;
  modal.app = app;
  modal.contentEl = new FakeElement();
  modal.onOpen();
  const confirmBtn = findElements(modal.contentEl, (e) => e.classes.has("mod-cta"))[0];
  await confirmBtn.trigger("click");
  await flushMicrotasks();

  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/DEUX/un.md") instanceof TFile);
  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/DEUX/deux.md") instanceof TFile);

  // Aucun TextNode résiduel pour "un"/"deux" — remplacés par de vrais FileNode.
  assert.equal(canvas.nodes.has("un"), false, "ancien TextNode « un » résiduel");
  assert.equal(canvas.nodes.has("deux"), false, "ancien TextNode « deux » résiduel");
  const finalNodes = [...canvas.nodes.values()];
  const unNode = finalNodes.find((n) => n.getData().file === "Projet/Manuscrit/DEUX/un.md");
  const deuxNode = finalNodes.find((n) => n.getData().file === "Projet/Manuscrit/DEUX/deux.md");
  assert.ok(unNode instanceof RuntimeFileNode, "« un » doit être un vrai FileNode runtime");
  assert.ok(deuxNode instanceof RuntimeFileNode, "« deux » doit être un vrai FileNode runtime");

  // Le groupe, non concerné par le remplacement, reste intact.
  assert.ok(canvas.nodes.has("g-deux"));
});
