import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { replaceTextNodeWithFileNode } from "../src/services/canvas-runtime.js";

class NodeBase {
  constructor(canvas, id, data, type) {
    this.canvas = canvas;
    this.id = id;
    this.type = type;
    this.raw = { ...data, id, type };
  }
  getData() { return { ...this.raw, id: this.id, type: this.type }; }
  setData(data) {
    this.raw = { ...this.raw, ...data, id: this.id, type: this.type };
    // Advanced Canvas 6.5 patchNode.setData() updates canvas.data and calls
    // canvas.view.requestSave() whenever the node is initialized.
    this.canvas.requestSave();
  }
}
class TextNode extends NodeBase {
  constructor(canvas, id, data) { super(canvas, id, data, "text"); }
}
class FileNode extends NodeBase {
  constructor(canvas, id, data) { super(canvas, id, data, "file"); }
}
class RuntimeEdge {
  constructor(canvas, id, data, fromNode, toNode) {
    this.canvas = canvas;
    this.id = id;
    this.raw = { ...data, id };
    this.from = { node: fromNode, side: data.fromSide ?? "right", end: data.fromEnd ?? "none" };
    this.to = { node: toNode, side: data.toSide ?? "left", end: data.toEnd ?? "arrow" };
  }
  getData() {
    return { ...this.raw, id: this.id, fromNode: this.raw.fromNode, toNode: this.raw.toNode };
  }
  setData(data) {
    // Faithful distinction: setData mutates serialized fields and autosaves,
    // but does NOT rebind the runtime endpoints / Canvas edge indexes.
    this.raw = { ...this.raw, ...data, id: this.id };
    this.canvas.requestSave();
  }
  update(from, to) {
    this.from = from;
    this.to = to;
    this.raw = { ...this.raw, fromNode: from.node.id, toNode: to.node.id };
  }
}

function makeCanvas() {
  const canvas = {
    nodes: new Map(),
    edges: new Map(),
    savedSnapshots: [],
    counter: 0,
    requestSave() {
      this.savedSnapshots.push(this.getData());
    },
    getData() {
      return {
        nodes: [...this.nodes.values()].map((n) => n.getData()),
        edges: [...this.edges.values()].map((e) => e.getData()),
      };
    },
    createFileNode(options) {
      const id = `file-${++this.counter}`;
      const node = new FileNode(this, id, {
        x: options.pos.x,
        y: options.pos.y,
        width: options.size.width,
        height: options.size.height,
        file: options.file.path,
      });
      this.nodes.set(id, node);
      return node;
    },
    getEdgesForNode(node) {
      // Real Canvas tracks runtime endpoint objects, not only JSON ids.
      return [...this.edges.values()].filter((e) => e.from.node === node || e.to.node === node);
    },
    removeNode(node) {
      // Real remove semantics use runtime relationships: any edge still
      // attached to the node is removed with it.
      for (const [id, edge] of [...this.edges]) {
        if (edge.from.node === node || edge.to.node === node) this.edges.delete(id);
      }
      this.nodes.delete(node.id);
    },
  };

  const research = new FileNode(canvas, "research", {
    file: "Projet/Recherche/Carnet/Tanbur.md", x: 0, y: 0, width: 100, height: 60,
  });
  const scene = new TextNode(canvas, "scene", {
    text: "meryem joue du tambur", x: 200, y: 0, width: 180, height: 80,
  });
  canvas.nodes.set(research.id, research);
  canvas.nodes.set(scene.id, scene);
  canvas.edges.set("e1", new RuntimeEdge(canvas, "e1", {
    fromNode: research.id,
    toNode: scene.id,
    fromSide: "right",
    toSide: "left",
  }, research, scene));
  return { canvas, research, scene };
}

test("runtime Advanced Canvas fidèle : le swap rebranche l'edge par edge.update et removeNode ne la supprime pas", () => {
  const { canvas, research, scene } = makeCanvas();
  const result = replaceTextNodeWithFileNode(
    canvas,
    scene.id,
    new TFile("Projet/Manuscrit/meryem joue du tambur.md", ""),
    "manuscript"
  );
  assert.ok(result);
  const newNode = canvas.nodes.get(result.newId);
  const edge = canvas.edges.get("e1");
  assert.ok(newNode instanceof FileNode);
  assert.ok(edge, "l'edge ne doit pas être supprimée avec l'ancien TextNode");
  assert.equal(edge.from.node, research);
  assert.equal(edge.to.node, newNode, "l'extrémité runtime doit viser le nouveau FileNode");
  assert.equal(edge.getData().toNode, result.newId);
  assert.equal(canvas.nodes.has("scene"), false);
});

test("runtime Advanced Canvas fidèle : le dernier autosave interne du swap ne contient jamais ancien TextNode + nouveau FileNode", () => {
  const { canvas, scene } = makeCanvas();
  const result = replaceTextNodeWithFileNode(
    canvas,
    scene.id,
    new TFile("Projet/Manuscrit/meryem joue du tambur.md", ""),
    "manuscript"
  );
  assert.ok(result);
  assert.ok(canvas.savedSnapshots.length >= 1, "newNode.setData doit provoquer l'autosave patché par Advanced Canvas");
  const last = canvas.savedSnapshots.at(-1);
  assert.equal(last.nodes.some((n) => n.id === "scene"), false,
    "le snapshot autosauvé juste avant un renameFile Recherche ne doit plus contenir l'ancien TextNode");
  assert.equal(last.nodes.some((n) => n.id === result.newId && n.type === "file"), true);
  assert.equal(last.edges.some((e) => e.toNode === result.newId), true);
});
