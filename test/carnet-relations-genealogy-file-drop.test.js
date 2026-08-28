import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { FEUILLETS_FILE_DRAG_MIME } from "../src/carnet/canvas/adapter.js";

/* Prompt 4, §3 — un dépôt Binder/Recherche qui tombe DANS un bloc
 * Relations/Généalogie déjà présent l'ajoute comme MEMBRE (feuillets_
 * block_id posé), jamais comme relation automatique ; un dépôt dans
 * l'espace d'une Mindmap reste un FileNode libre, EXACTEMENT comme avant
 * (comportement Mindmap intentionnellement inchangé). */

function makeFakeWrapperEl() {
  const listeners = {};
  return {
    addEventListener(type, cb, capture) { (listeners[type] ||= []).push({ cb, capture: !!capture }); },
    removeEventListener(type, cb, capture) { listeners[type] = (listeners[type] || []).filter((r) => !(r.cb === cb && r.capture === !!capture)); },
    fire(type, evt) { for (const r of listeners[type] || []) r.cb(evt); },
  };
}

function makeFakeDataTransfer(pairs = {}) {
  const map = new Map(Object.entries(pairs));
  return { dropEffect: "none", getData: (type) => map.get(type) || "" };
}

/** `groupNode` (déjà présent dans `data.nodes`) définit la zone du bloc
 * géré — `canvas.getData()` renvoie TOUJOURS la même référence `data`
 * mutable, comme le ferait un vrai runtime Canvas entre deux appels. */
function makeFixture(groupNode) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;
  const target = new TFile("Projet/Recherche/Kemal.md", "---\ntitle: Kemal\n---\n");
  const { vault } = createFakeVault([volume, manuscript, target]);
  const boardFile = new TFile(canvasPathFor({ vault }, manuscript), "");
  const containerEl = makeFakeWrapperEl();
  const data = { nodes: groupNode ? [groupNode] : [], edges: [] };
  const createFileNodeCalls = [];
  const canvas = {
    view: { file: boardFile },
    wrapperEl: containerEl,
    getData: () => data,
    createFileNode(options) {
      const nodeData = { id: "new-file-node", type: "file", file: options.file.path, x: options.pos.x, y: options.pos.y, width: options.size.width, height: options.size.height };
      data.nodes.push(nodeData);
      createFileNodeCalls.push(options);
      return {
        id: nodeData.id,
        getData: () => ({ ...nodeData }),
        setData: (next) => { Object.assign(nodeData, next); },
      };
    },
    posFromEvt: (evt) => ({ x: evt.clientX, y: evt.clientY }),
    requestSaveCalls: 0,
    requestSave() { this.requestSaveCalls += 1; },
  };
  const view = { file: boardFile, canvas, register() {} };
  const app = {
    vault,
    workspace: { handlers: {}, on(name, cb) { this.handlers[name] = cb; return { name }; }, getLeavesOfType: (type) => (type === "canvas" ? [{ view }] : []) },
  };
  const plugin = { app, settings: { projectFolder: manuscript.path }, registerEvent() {}, saveSettings: async () => {}, register() {} };
  return { plugin, canvas, containerEl, target, data, createFileNodeCalls };
}

function fireDrop(containerEl, target, x, y) {
  containerEl.fire("drop", {
    clientX: x, clientY: y,
    dataTransfer: makeFakeDataTransfer({ [FEUILLETS_FILE_DRAG_MIME]: target.path }),
    preventDefault() {}, stopPropagation() {},
  });
}

test("drop DANS un bloc Relations — le fichier devient membre (feuillets_block_id posé), aucune relation créée", () => {
  const group = { id: "grp", type: "group", x: 0, y: 0, width: 400, height: 300, feuillets_block: "relations", feuillets_block_version: 1, feuillets_block_id: "b1" };
  const { plugin, containerEl, target, data, createFileNodeCalls } = makeFixture(group);
  registerAdvancedCanvasIntegration(plugin);

  fireDrop(containerEl, target, 200, 150); // à l'intérieur du groupe [0,400]x[0,300]

  assert.equal(createFileNodeCalls.length, 1, "un vrai FileNode est bien créé");
  const member = data.nodes.find((n) => n.id === "new-file-node");
  assert.equal(member.feuillets_block_id, "b1", "membre du bloc, posé automatiquement");
  assert.equal(data.edges.length, 0, "AUCUNE relation créée automatiquement (§3)");
});

test("drop DANS un bloc Généalogie — même comportement, membre sans relation", () => {
  const group = { id: "grp", type: "group", x: 0, y: 0, width: 400, height: 300, feuillets_block: "genealogy", feuillets_block_version: 1, feuillets_block_id: "b2" };
  const { plugin, containerEl, target, data } = makeFixture(group);
  registerAdvancedCanvasIntegration(plugin);

  fireDrop(containerEl, target, 100, 100);

  const member = data.nodes.find((n) => n.id === "new-file-node");
  assert.equal(member.feuillets_block_id, "b2");
  assert.equal(data.edges.length, 0);
});

test("drop DANS une Mindmap — comportement INCHANGÉ : FileNode libre, jamais membre", () => {
  const mindmapGroup = { id: "grp", type: "group", x: 0, y: 0, width: 400, height: 300, feuillets_block: "mindmap", feuillets_block_version: 1, feuillets_block_id: "mm1" };
  const { plugin, containerEl, target, data } = makeFixture(mindmapGroup);
  registerAdvancedCanvasIntegration(plugin);

  fireDrop(containerEl, target, 100, 100);

  const member = data.nodes.find((n) => n.id === "new-file-node");
  assert.ok(member, "le node est bien créé");
  assert.equal(member.feuillets_block_id, undefined, "jamais rattaché à la Mindmap par un simple dépôt (§6, comportement Mindmap inchangé)");
});

test("drop HORS de tout groupe — FileNode libre, comme aujourd'hui", () => {
  const group = { id: "grp", type: "group", x: 0, y: 0, width: 100, height: 100, feuillets_block: "relations", feuillets_block_version: 1, feuillets_block_id: "b1" };
  const { plugin, containerEl, target, data } = makeFixture(group);
  registerAdvancedCanvasIntegration(plugin);

  fireDrop(containerEl, target, 900, 900); // loin du groupe

  const member = data.nodes.find((n) => n.id === "new-file-node");
  assert.equal(member.feuillets_block_id, undefined);
});

test("drop d'un fichier DÉJÀ membre du bloc — aucun doublon créé", () => {
  const group = { id: "grp", type: "group", x: 0, y: 0, width: 400, height: 300, feuillets_block: "relations", feuillets_block_version: 1, feuillets_block_id: "b1" };
  const existing = { id: "already", type: "file", file: "Projet/Recherche/Kemal.md", x: 10, y: 10, width: 240, height: 80, feuillets_block_id: "b1" };
  const { plugin, containerEl, target, data, createFileNodeCalls } = makeFixture(group);
  data.nodes.push(existing);
  registerAdvancedCanvasIntegration(plugin);

  fireDrop(containerEl, target, 200, 150);

  assert.equal(createFileNodeCalls.length, 0, "aucun second FileNode créé pour le même chemin");
  assert.equal(data.nodes.filter((n) => n.file === target.path).length, 1);
});
