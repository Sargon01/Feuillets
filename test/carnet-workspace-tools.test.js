import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { resolveCanvasSession } from "../src/carnet/canvas/adapter.js";
import { runMindmapBranchAction } from "../src/integrations/advanced-canvas.js";
import { addMindmapChild, createMindmapBlock } from "../src/carnet/blocks/mindmap/mindmap.js";
import { findMindmapParent } from "../src/carnet/blocks/mindmap/model.js";
import { createFakeVault } from "./helpers/fake-vault.js";

function fixture() {
  const root = new TFolder("Project"), folder = new TFile("Project/Folder.canvas", '{"nodes":[],"edges":[]}');
  const sheet = new TFile("Project/Sheet.md", "Sheet");
  const { vault, files } = createFakeVault([root, folder, sheet]);
  const views = [0, 1].map((index) => {
    let data = { nodes: [{ id: `note-${index}`, type: "text", text: "Existing idea", x: 0, y: 0, width: 200, height: 100 }], edges: [] };
    return { file: folder, getViewData: () => JSON.stringify(data), setViewData: (raw) => { data = JSON.parse(raw); }, requestSave() {},
      canvas: { getData: () => structuredClone(data), setData: (next) => { data = structuredClone(next); }, requestSave() {} } };
  });
  const leaves = views.map((view) => ({ view }));
  const app = { vault, workspace: { getLeavesOfType: () => leaves } };
  const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
  plugin.getProjectFolder = () => root;
  plugin.settings = { carnetDefaultStyles: {} };
  plugin.isFeuilletsCarnetFile = (file) => file === folder;
  plugin.carnetLifecycle = { context: { current: () => ({ file: folder, view: views[1], canvas: views[1].canvas }) } };
  return { plugin, app, root, folder, sheet, views, leaves, files };
}

test("explicit Canvas sessions use the retained view even when the same file is open twice", async () => {
  const { app, folder, views, plugin } = fixture();
  const session = await resolveCanvasSession(app, folder, views[1]);
  assert.equal(session.view, views[1]);
  assert.equal(session.data.nodes[0].id, "note-1");
  assert.equal((await plugin.resolveCarnetToolSession(folder)).view, views[1]);
  await assert.rejects(resolveCanvasSession(app, folder, { ...views[1] }), /no longer available/);
  await assert.rejects(resolveCanvasSession(app, new TFile("Other.canvas"), views[1]), /no longer available/);
});

test("folder capture and adding a sheet reuse notebook operations without redirecting or creating another file", async () => {
  const { plugin, folder, sheet, views, files } = fixture(), before = [...files.keys()];
  await plugin.captureIdeaToNotebook("Folder idea", folder);
  await plugin.addFileToNotebook(sheet, folder);
  const data = views[1].canvas.getData();
  assert(data.nodes.some((node) => node.text === "Folder idea"));
  assert(data.nodes.some((node) => node.type === "file" && node.file === sheet.path));
  assert.equal(views[0].canvas.getData().nodes.length, 1);
  assert.deepEqual([...files.keys()], before);
  await plugin.addFileToNotebook(sheet, folder);
  assert.equal(views[1].canvas.getData().nodes.filter((node) => node.type === "file").length, 1);
});

test("deleted, unrecognized and readonly explicit destinations cannot fall back to a global notebook", async () => {
  for (const kind of ["deleted", "unrecognized", "readonly"]) {
    const { plugin, folder, sheet, views, files } = fixture();
    if (kind === "deleted") files.delete(folder.path);
    if (kind === "unrecognized") plugin.isFeuilletsCarnetFile = () => false;
    if (kind === "readonly") views[1].canvas.readonly = true;
    const before = views[1].canvas.getData(), paths = [...files.keys()];
    await plugin.captureIdeaToNotebook("Rejected", folder);
    await plugin.addFileToNotebook(sheet, folder);
    assert.deepEqual(views[1].canvas.getData(), before);
    assert.deepEqual([...files.keys()], paths);
  }
});

test("conversion and chapter sessions reject changed data, closed views and deleted files", async () => {
  const { plugin, folder, views, leaves, files } = fixture(), session = await plugin.resolveCarnetToolSession(folder);
  const validate = plugin.carnetSessionValidator(folder, session);
  assert(validate());
  views[1].canvas.setData({ nodes: [], edges: [] }); assert.equal(validate(), false);
  views[1].canvas.setData(session.data); assert(validate());
  leaves.pop(); assert.equal(validate(), false);
  leaves.push({ view: views[1] }); assert(validate());
  files.delete(folder.path); assert.equal(validate(), false);
});

test("sidebar branch actions share child, sibling and outdent operations with the native keymap", () => {
  let data = { nodes: [], edges: [] }, saves = 0;
  const { root } = createMindmapBlock(data, { blockId: "mindmap", centerX: 0, centerY: 0, rootText: "Root" });
  const canvas = { selection: new Set([{ id: root.id }]), getData: () => structuredClone(data), setData: (next) => { data = next; }, requestSave: () => saves++ };
  assert.equal(runMindmapBranchAction(canvas, "sibling", true), false);
  assert.equal(runMindmapBranchAction(canvas, "outdent", true), false);
  assert(runMindmapBranchAction(canvas, "child", true)); assert.equal(saves, 0);
  assert(runMindmapBranchAction(canvas, "child"));
  const child = data.nodes.find((node) => node.type === "text" && node.id !== root.id);
  canvas.selection = new Set([{ id: child.id }]);
  assert(runMindmapBranchAction(canvas, "sibling"));
  const grandchild = addMindmapChild(data, "mindmap", child.id);
  canvas.selection = new Set([{ id: grandchild.id }]);
  assert(runMindmapBranchAction(canvas, "outdent"));
  assert.equal(findMindmapParent(data, "mindmap", grandchild.id).id, root.id);
  assert.equal(saves, 3);
  data.nodes.find((node) => node.feuillets_block === "mindmap").feuillets_block = "relations";
  assert.equal(runMindmapBranchAction(canvas, "child"), false);
  assert.equal(saves, 3);
});
