import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { registerAdvancedCanvasIntegration } from "../src/integrations/advanced-canvas.js";
import { canvasPathFor } from "../src/services/canvas-board.js";
import { FEUILLETS_FILE_DRAG_MIME, CARNET_FILE_NODE_SIZE } from "../src/carnet/canvas/adapter.js";

/* Correctif Prompt 2 (suite) — DROP BINDER/RECHERCHE → VRAI FILENODE (§4/§5).
 * Fixture minimale et dédiée : dragover/drop réels sur le wrapper DOM de la
 * vue Canvas, jamais document/window, jamais une mutation du fichier
 * Markdown lâché. */

function makeFakeWrapperEl() {
  const listeners = {};
  return {
    // `capture` est significatif : le drop Carnet DOIT s'enregistrer en
    // phase capture pour passer avant le handler natif du Canvas.
    addEventListener(type, cb, capture) {
      (listeners[type] ||= []).push({ cb, capture: !!capture });
    },
    removeEventListener(type, cb, capture) {
      listeners[type] = (listeners[type] || []).filter((r) => !(r.cb === cb && r.capture === !!capture));
    },
    fire(type, evt) {
      for (const r of listeners[type] || []) r.cb(evt);
    },
    capturingCount(type) {
      return (listeners[type] || []).filter((r) => r.capture).length;
    },
    listenerCount(type) {
      return (listeners[type] || []).length;
    },
  };
}

function makeFakeDataTransfer(pairs = {}) {
  const map = new Map(Object.entries(pairs));
  return {
    dropEffect: "none",
    getData: (type) => map.get(type) || "",
  };
}

function makeFixture() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;
  const target = new TFile("Projet/Manuscrit/Scene.md", "titre : Scene\n---\ncorps original");
  const { vault } = createFakeVault([volume, manuscript, target]);
  const boardFile = new TFile(canvasPathFor({ vault }, manuscript), "");
  const containerEl = makeFakeWrapperEl();
  const createFileNodeCalls = [];
  const canvas = {
    view: { file: boardFile },
    wrapperEl: containerEl,
    requestSaveCalls: 0,
    createFileNode(options) {
      createFileNodeCalls.push(options);
      return { id: "new-file-node" };
    },
    posFromEvt: (evt) => ({ x: evt.clientX, y: evt.clientY }),
    requestSave() { this.requestSaveCalls += 1; },
  };
  const cleanups = [];
  const view = { file: boardFile, canvas, register: (cb) => cleanups.push(cb) };
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
    register(cb) { registeredCleanups.push(cb); },
  };
  return {
    plugin, app, vault, manuscript, boardFile, canvas, containerEl, target,
    createFileNodeCalls, cleanups, registeredCleanups,
  };
}

test("drop Carnet — drop d'un TFile crée un vrai FileNode, jamais un TextNode", () => {
  const { plugin, canvas, containerEl, target, createFileNodeCalls } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  let prevented = 0;
  let stopped = 0;
  const evt = {
    clientX: 400,
    clientY: 300,
    dataTransfer: makeFakeDataTransfer({ [FEUILLETS_FILE_DRAG_MIME]: target.path }),
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => { stopped += 1; },
  };
  containerEl.fire("drop", evt);

  assert.equal(createFileNodeCalls.length, 1, "createFileNode appelé exactement une fois");
  assert.equal(createFileNodeCalls[0].file, target, "le VRAI TFile est transmis, jamais un chemin");
  assert.equal(createFileNodeCalls[0].size.width, CARNET_FILE_NODE_SIZE.width);
  assert.equal(createFileNodeCalls[0].size.height, CARNET_FILE_NODE_SIZE.height);
  assert.equal(prevented, 1, "preventDefault empêche Canvas de créer un TextNode [[lien]] en plus");
  assert.equal(stopped, 1);
  assert.equal(canvas.requestSaveCalls, 1);
});

test("drop Carnet — la position de dépose (canvas.posFromEvt) est utilisée, centrée sur le node créé", () => {
  const { plugin, canvas, containerEl, target, createFileNodeCalls } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  containerEl.fire("drop", {
    clientX: 500,
    clientY: 400,
    dataTransfer: makeFakeDataTransfer({ [FEUILLETS_FILE_DRAG_MIME]: target.path }),
    preventDefault() {}, stopPropagation() {},
  });

  const pos = createFileNodeCalls[0].pos;
  assert.equal(pos.x, 500 - CARNET_FILE_NODE_SIZE.width / 2);
  assert.equal(pos.y, 400 - CARNET_FILE_NODE_SIZE.height / 2);
  void canvas;
});

test("drop Carnet — le fichier Markdown source n'est jamais renommé ni modifié", () => {
  const { plugin, containerEl, target } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);
  const originalPath = target.path;
  const originalContent = target.content;

  containerEl.fire("drop", {
    clientX: 10, clientY: 10,
    dataTransfer: makeFakeDataTransfer({ [FEUILLETS_FILE_DRAG_MIME]: target.path }),
    preventDefault() {}, stopPropagation() {},
  });

  assert.equal(target.path, originalPath);
  assert.equal(target.content, originalContent);
});

test("drop Carnet — dragover accepte le MIME privé et fixe dropEffect à copy, sans déplacer le fichier", () => {
  const { plugin, containerEl, target } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);
  let prevented = 0;
  const dataTransfer = makeFakeDataTransfer({ [FEUILLETS_FILE_DRAG_MIME]: target.path });
  containerEl.fire("dragover", { dataTransfer, preventDefault: () => { prevented += 1; } });

  assert.equal(prevented, 1);
  assert.equal(dataTransfer.dropEffect, "copy");
});

test("drop Carnet — dragover/drop sans le MIME privé n'interceptent rien (drag Canvas ordinaire)", () => {
  const { plugin, containerEl, createFileNodeCalls } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);
  let prevented = 0;
  const dataTransfer = makeFakeDataTransfer({ "text/plain": "n'importe quoi" });

  containerEl.fire("dragover", { dataTransfer, preventDefault: () => { prevented += 1; } });
  containerEl.fire("drop", { dataTransfer, preventDefault() {}, stopPropagation() {} });

  assert.equal(prevented, 0, "dragover natif reste intact sans notre MIME");
  assert.equal(createFileNodeCalls.length, 0, "aucun FileNode créé sans notre MIME");
});

test("drop Carnet — un chemin qui ne résout plus un TFile réel est ignoré", () => {
  const { plugin, containerEl, createFileNodeCalls } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);

  containerEl.fire("drop", {
    clientX: 0, clientY: 0,
    dataTransfer: makeFakeDataTransfer({ [FEUILLETS_FILE_DRAG_MIME]: "Projet/Manuscrit/Disparu.md" }),
    preventDefault() {}, stopPropagation() {},
  });

  assert.equal(createFileNodeCalls.length, 0);
});

test("drop Carnet — un Canvas ordinaire hors Carnet Feuillets n'est jamais intercepté", () => {
  const { plugin, containerEl, createFileNodeCalls } = makeFixture();
  const wrongFile = new TFile("Projet/Autre.canvas", "");
  containerEl.wrongFileView = true;
  // Remplace le fichier de la vue par un Canvas qui n'est ni le Carnet
  // global ni un Carnet de dossier reconnu.
  const leaves = plugin.app.workspace.getLeavesOfType("canvas");
  leaves[0].view.file = wrongFile;
  leaves[0].view.canvas.view.file = wrongFile;

  registerAdvancedCanvasIntegration(plugin);
  containerEl.fire("drop", {
    clientX: 0, clientY: 0,
    dataTransfer: makeFakeDataTransfer({ [FEUILLETS_FILE_DRAG_MIME]: "Projet/Manuscrit/Scene.md" }),
    preventDefault() {}, stopPropagation() {},
  });

  assert.equal(containerEl.listenerCount("drop"), 0, "aucun écouteur attaché à un Canvas hors Carnet");
  assert.equal(createFileNodeCalls.length, 0);
});

test("drop Carnet — écouteurs dragover/drop désenregistrés au déchargement de la vue et du plugin", () => {
  const { plugin, containerEl, cleanups, registeredCleanups } = makeFixture();
  registerAdvancedCanvasIntegration(plugin);
  assert.equal(containerEl.listenerCount("dragover"), 1);
  assert.equal(containerEl.listenerCount("drop"), 1);
  assert.equal(containerEl.capturingCount("drop"), 1, "drop enregistré en phase CAPTURE (avant le handler natif du Canvas)");

  cleanups.forEach((cb) => cb());
  assert.equal(containerEl.listenerCount("dragover"), 0);
  assert.equal(containerEl.listenerCount("drop"), 0);
  assert.ok(registeredCleanups.length > 0, "aussi enregistré pour le déchargement du plugin");
});
