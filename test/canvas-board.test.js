import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  addFileNodeToNotebook,
  addTextNodeToCanvas,
  addTextNodeToNotebook,
  canvasPathFor,
  generateCanvasBoard,
} from "../src/services/canvas-board.js";

function makeProject() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const scene = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "Texte");
  volume.children = [manuscript]; manuscript.parent = volume;
  manuscript.children = [chapter]; chapter.parent = manuscript;
  chapter.children = [scene]; scene.parent = chapter;
  const { vault, files } = createFakeVault([volume, manuscript, chapter, scene]);
  return { app: { vault }, settings: { projectFolder: manuscript.path }, manuscript, scene, files };
}

test("generateCanvasBoard : crée un Carnet vide, sans injecter le manuscrit", async () => {
  const { app, settings, scene } = makeProject();
  const result = await generateCanvasBoard(app, settings);
  assert.ok(result);
  assert.equal(result.added, 0);
  assert.equal(result.edgesAdded, 0);
  assert.deepEqual(JSON.parse(await app.vault.read(result.file)), { nodes: [], edges: [] });
  assert.ok(app.vault.getAbstractFileByPath(scene.path), "le feuillet Binder reste intact");
});

test("generateCanvasBoard : ne réécrit jamais un Carnet existant", async () => {
  const { app, settings, manuscript, files } = makeProject();
  const path = canvasPathFor(app, manuscript);
  const original = {
    nodes: [{ id: "note", type: "text", text: "Idée", x: 12, y: 34, color: "3" }, { id: "g", type: "group", label: "G" }],
    edges: [{ id: "edge", fromNode: "note", toNode: "g" }],
  };
  const resources = new TFolder("Projet/Manuscrit/Ressources");
  resources.parent = manuscript; manuscript.children.push(resources);
  const canvas = new TFile(path, JSON.stringify(original));
  canvas.parent = resources; resources.children.push(canvas);
  files.set(path, canvas);

  const result = await generateCanvasBoard(app, settings);
  assert.equal(result.file, canvas);
  assert.equal(await app.vault.read(canvas), JSON.stringify(original));
});

test("Ajouter au Carnet : une vue live non sauvegardée est préservée et sauvegardée sans vault.modify", async () => {
  const { app, settings } = makeProject();
  const board = (await generateCanvasBoard(app, settings)).file;
  const diskBefore = await app.vault.read(board);
  let liveData = {
    nodes: [{ id: "idee-live", type: "text", text: "Idée non sauvegardée", x: 50, y: 75, width: 200, height: 80 }],
    edges: [],
  };
  const setCalls = [];
  let saveCalls = 0;
  let modifyCalls = 0;
  const originalModify = app.vault.modify;
  app.vault.modify = async (...args) => {
    modifyCalls += 1;
    return originalModify(...args);
  };
  const liveView = {
    getViewData: () => JSON.stringify(liveData),
    setViewData: (raw, clear) => {
      setCalls.push({ raw, clear });
      liveData = JSON.parse(raw);
    },
    requestSave: () => { saveCalls += 1; },
  };

  const result = await addFileNodeToNotebook(app, board, "Projet/Manuscrit/Chapitre 1/Scène 1.md", liveView);

  assert.equal(result, "added");
  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].clear, false);
  assert.equal(saveCalls, 1);
  assert.equal(modifyCalls, 0);
  assert.equal(await app.vault.read(board), diskBefore);
  assert.deepEqual(liveData.nodes.map((node) => node.id), ["idee-live", liveData.nodes[1].id]);
  assert.deepEqual(liveData.nodes[1], {
    id: liveData.nodes[1].id,
    type: "file",
    file: "Projet/Manuscrit/Chapitre 1/Scène 1.md",
    x: 0,
    y: 195,
    width: 320,
    height: 220,
  });
});

test("Ajouter au Carnet : sans vue live, le fallback disque conserve la géométrie historique", async () => {
  const { app, settings } = makeProject();
  const board = (await generateCanvasBoard(app, settings)).file;
  const result = await addFileNodeToNotebook(app, board, "Projet/Manuscrit/Chapitre 1/Scène 1.md");
  const saved = JSON.parse(await app.vault.read(board));
  assert.equal(result, "added");
  assert.deepEqual({ ...saved.nodes[0], id: undefined }, {
    id: undefined,
    type: "file",
    file: "Projet/Manuscrit/Chapitre 1/Scène 1.md",
    x: 0,
    y: 40,
    width: 320,
    height: 220,
  });
});

test("Ajouter au Carnet : un doublon présent dans la vue live ne touche pas le disque", async () => {
  const { app, settings } = makeProject();
  const board = (await generateCanvasBoard(app, settings)).file;
  let setCalls = 0;
  let saveCalls = 0;
  const liveView = {
    getViewData: () => JSON.stringify({
      nodes: [{ id: "deja", type: "file", file: "Projet/Manuscrit/Chapitre 1/Scène 1.md" }],
      edges: [],
    }),
    setViewData: () => { setCalls += 1; },
    requestSave: () => { saveCalls += 1; },
  };
  const diskBefore = await app.vault.read(board);
  const result = await addFileNodeToNotebook(app, board, "Projet/Manuscrit/Chapitre 1/Scène 1.md", liveView);
  assert.equal(result, "duplicate");
  assert.equal(setCalls, 0);
  assert.equal(saveCalls, 0);
  assert.equal(await app.vault.read(board), diskBefore);
});

// ---------------------------------------------------------------------------
// Lot 6 — « Carnet : noter une idée » — addTextNodeToCanvas / addTextNodeToNotebook
// ---------------------------------------------------------------------------

// A. addTextNodeToCanvas (mutation pure)

test("addTextNodeToCanvas : ajoute exactement un TextNode libre, texte trimé, dimensions 320×120", () => {
  const data = { nodes: [], edges: [] };
  const result = addTextNodeToCanvas(data, "  une idée qui traîne  ");
  assert.equal(result, "added");
  assert.equal(data.nodes.length, 1);
  assert.equal(data.edges.length, 0);
  const node = data.nodes[0];
  assert.equal(node.type, "text");
  assert.equal(node.text, "une idée qui traîne");
  assert.equal(node.width, 320);
  assert.equal(node.height, 120);
  assert.equal("feuillets_managed" in node, false);
  assert.equal("file" in node, false);
  assert.equal("color" in node, false);
});

test("addTextNodeToCanvas : les nodes existants restent inchangés, la nouvelle idée s'empile après eux", () => {
  const existing = { id: "A", type: "text", text: "A", x: 0, y: 0, width: 260, height: 80 };
  const data = { nodes: [existing], edges: [{ id: "e", fromNode: "A", toNode: "A" }] };
  const before = JSON.stringify(existing);
  const result = addTextNodeToCanvas(data, "B");
  assert.equal(result, "added");
  assert.equal(JSON.stringify(existing), before, "le node existant n'est jamais déplacé");
  assert.equal(data.edges.length, 1, "aucune edge automatique n'est ajoutée");
  assert.equal(data.nodes[1].y, existing.y + existing.height + 40);
  assert.equal(data.nodes[1].x, 0);
});

test("addTextNodeToCanvas : deux idées avec exactement le même texte sont autorisées, jamais dédupliquées", () => {
  const data = { nodes: [], edges: [] };
  addTextNodeToCanvas(data, "Même idée");
  addTextNodeToCanvas(data, "Même idée");
  assert.equal(data.nodes.length, 2);
  assert.notEqual(data.nodes[0].id, data.nodes[1].id);
  assert.equal(data.nodes[0].text, "Même idée");
  assert.equal(data.nodes[1].text, "Même idée");
});

test("addTextNodeToCanvas : un texte vide (ou seulement des espaces) ne crée rien", () => {
  const data = { nodes: [], edges: [] };
  assert.equal(addTextNodeToCanvas(data, ""), "empty");
  assert.equal(addTextNodeToCanvas(data, "   "), "empty");
  assert.equal(addTextNodeToCanvas(data, "\n\t "), "empty");
  assert.equal(data.nodes.length, 0);
});

// B. addTextNodeToNotebook — Carnet ouvert (état live, invariant Lot 4)

test("Noter une idée : Carnet ouvert → getViewData/setViewData(false)/requestSave, jamais vault.modify", async () => {
  const { app, settings } = makeProject();
  const board = (await generateCanvasBoard(app, settings)).file;
  const diskBefore = await app.vault.read(board);
  // Le Canvas live contient un node ABSENT de la version disque (déplacement
  // ou idée non encore sauvegardée) — il doit être préservé après capture.
  let liveData = {
    nodes: [{ id: "non-sauvegarde", type: "text", text: "Idée non sauvegardée", x: 50, y: 75, width: 200, height: 80 }],
    edges: [],
  };
  const setCalls = [];
  let saveCalls = 0;
  let modifyCalls = 0;
  const originalModify = app.vault.modify;
  app.vault.modify = async (...args) => {
    modifyCalls += 1;
    return originalModify(...args);
  };
  const liveView = {
    getViewData: () => JSON.stringify(liveData),
    setViewData: (raw, clear) => {
      setCalls.push({ raw, clear });
      liveData = JSON.parse(raw);
    },
    requestSave: () => { saveCalls += 1; },
  };

  const result = await addTextNodeToNotebook(app, board, "Une idée en pleine écriture", liveView);

  assert.equal(result, "added");
  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].clear, false);
  assert.equal(saveCalls, 1);
  assert.equal(modifyCalls, 0, "vault.modify ne doit jamais être appelé sur un Carnet ouvert");
  assert.equal(await app.vault.read(board), diskBefore, "le disque n'est jamais touché tant qu'une vue live existe");
  assert.equal(liveData.nodes.length, 2);
  assert.equal(liveData.nodes[0].id, "non-sauvegarde", "le node live non sauvegardé existe toujours après capture");
  assert.equal(liveData.nodes[1].text, "Une idée en pleine écriture");
  assert.equal(liveData.nodes[1].type, "text");
});

// C. addTextNodeToNotebook — Carnet fermé (repli disque)

test("Noter une idée : Carnet fermé → vault.read puis vault.modify, Canvas existant préservé", async () => {
  const { app, settings } = makeProject();
  const board = (await generateCanvasBoard(app, settings)).file;
  await app.vault.modify(board, JSON.stringify({
    nodes: [{ id: "deja-la", type: "text", text: "Déjà présente", x: 0, y: 0, width: 260, height: 80 }],
    edges: [],
  }));

  const result = await addTextNodeToNotebook(app, board, "Nouvelle idée");
  const saved = JSON.parse(await app.vault.read(board));

  assert.equal(result, "added");
  assert.equal(saved.nodes.length, 2);
  assert.equal(saved.nodes[0].text, "Déjà présente", "le Canvas existant reste intact");
  assert.equal(saved.nodes[1].text, "Nouvelle idée");
  assert.equal(saved.nodes[1].type, "text");
  assert.equal(saved.nodes[1].width, 320);
  assert.equal(saved.nodes[1].height, 120);
});

test("Noter une idée : texte vide, Carnet fermé → aucune écriture disque", async () => {
  const { app, settings } = makeProject();
  const board = (await generateCanvasBoard(app, settings)).file;
  const diskBefore = await app.vault.read(board);
  const result = await addTextNodeToNotebook(app, board, "   ");
  assert.equal(result, "empty");
  assert.equal(await app.vault.read(board), diskBefore);
});
