import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { generateCanvasBoard, canvasPathFor } from "../src/services/canvas-board.js";

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
