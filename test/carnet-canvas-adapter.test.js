import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { findOpenCanvasView, persistCanvasData, readCanvasData } from "../src/carnet/canvas/adapter.js";

test("Canvas adapter chooses the exact opened Canvas and persists live", async () => {
  const target = new TFile("Projet/A.canvas"); const other = new TFile("Projet/B.canvas"); let saved = 0; let modified = 0;
  const view = { file: target, getViewData: () => '{"nodes":[{"id":"x","custom":true}],"edges":[]}', setViewData: () => { saved += 1; }, requestSave: () => { saved += 1; } };
  const app = { workspace: { getLeavesOfType: () => [{ view: { file: other, getViewData() { return ""; }, setViewData() {}, requestSave() {} } }, { view }] }, vault: { read: async () => '{"nodes":[],"edges":[]}', modify: async () => { modified += 1; } } };
  assert.equal(findOpenCanvasView(app, target), view);
  assert.equal((await readCanvasData(app, target)).nodes[0].custom, true);
  await persistCanvasData(app, target, { nodes: [], edges: [] }, view);
  assert.equal(saved, 2); assert.equal(modified, 0);
});
