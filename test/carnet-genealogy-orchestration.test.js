import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { normalizeGenealogyDate } from "../src/carnet/canvas/adapter.js";
import {
  createGenealogyBlock,
  isFileAlreadyMember,
  applyGenealogyLayout,
  addGenealogyParentChild,
  addGenealogySpouse,
  deleteGenealogyRelation,
  removeGenealogyMember,
} from "../src/carnet/blocks/genealogy/genealogy.js";
import { groupBlockMemberNodes } from "../src/carnet/blocks/shared/native-group-block.js";

function memberFileNode(id, path, x = 0, y = 0) {
  return { id, type: "file", file: path, x, y, width: 240, height: 80, feuillets_block_id: "b1" };
}

function seedCanvas() {
  const canvas = { nodes: [], edges: [] };
  createGenealogyBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0 });
  canvas.nodes.push(
    memberFileNode("gp", "F/GrandPere.md"),
    memberFileNode("gm", "F/GrandMere.md"),
    memberFileNode("p1", "F/Parent.md"),
    memberFileNode("c1", "F/Enfant.md")
  );
  return canvas;
}

test("menu parent→enfant — libellés humains, jamais IDs Canvas", () => {
  const hasan = new TFile("Personnes/Hasan.md", "");
  const kemal = new TFile("Personnes/Kemal.md", "");
  const files = new Map([[hasan.path, hasan], [kemal.path, kemal]]);
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = {
    vault: { getAbstractFileByPath: (path) => files.get(path) || null },
    metadataCache: { getFileCache: (file) => ({ frontmatter: { title: file === hasan ? "Hasan Altin" : "Kemal Altin" } }) },
  };
  const labels = plugin.groupMemberDisplayLabels([
    { id: "eff6bd-internal", type: "file", file: hasan.path },
    { id: "23a-internal", type: "file", file: kemal.path },
  ]);
  assert.deepEqual(labels, ["Hasan Altin", "Kemal Altin"]);
  assert.equal(labels.some((label) => label.includes("eff6bd") || label.includes("23a")), false);
});

test("dates Généalogie — nombres YAML, chaînes et valeurs invalides", () => {
  assert.equal(normalizeGenealogyDate(1876), "1876");
  assert.equal(normalizeGenealogyDate(" 1934 "), "1934");
  assert.equal(normalizeGenealogyDate([]), "");
  assert.equal(normalizeGenealogyDate({ year: 1934 }), "");
  assert.equal(normalizeGenealogyDate(Number.NaN), "");
});

test("createGenealogyBlock — GroupNode natif, aucun membre", () => {
  const canvas = { nodes: [], edges: [] };
  const group = createGenealogyBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0 });
  assert.equal(group.feuillets_block, "genealogy");
  assert.equal(canvas.nodes.length, 1);
});

test("ajout de fiches — aucun doublon pour le même chemin", () => {
  const canvas = seedCanvas();
  assert.equal(isFileAlreadyMember(canvas, "b1", "F/GrandPere.md"), true);
  assert.equal(isFileAlreadyMember(canvas, "b1", "F/Inconnu.md"), false);
});

test("parent→enfant — création sans déplacement automatique des fiches", () => {
  const canvas = seedCanvas();
  const before = groupBlockMemberNodes(canvas, "b1").map((n) => ({ id: n.id, x: n.x, y: n.y }));
  const result = addGenealogyParentChild(canvas, "b1", "p1", "c1");
  assert.equal(result.ok, true);
  const after = groupBlockMemberNodes(canvas, "b1").map((n) => ({ id: n.id, x: n.x, y: n.y }));
  assert.deepEqual(before, after, "les positions manuelles restent inchangées");
  const p1 = after.find((n) => n.id === "p1");
  const c1 = after.find((n) => n.id === "c1");
  assert.equal(p1.y, 0);
  assert.equal(c1.y, 0);
});

test("conjoints — relayout automatique, même génération", () => {
  const canvas = seedCanvas();
  const result = addGenealogySpouse(canvas, "b1", "gp", "gm");
  assert.equal(result.ok, true);
  const members = groupBlockMemberNodes(canvas, "b1");
  const gp = members.find((n) => n.id === "gp");
  const gm = members.find((n) => n.id === "gm");
  assert.equal(gp.y, gm.y);
});

test("un refus (cycle) n'applique AUCUN relayout ni mutation", () => {
  const canvas = seedCanvas();
  addGenealogyParentChild(canvas, "b1", "p1", "c1");
  const snapshot = JSON.stringify(canvas);
  const result = addGenealogyParentChild(canvas, "b1", "c1", "p1"); // cycle direct
  assert.deepEqual(result, { ok: false, reason: "cycle" });
  assert.equal(JSON.stringify(canvas), snapshot, "aucune mutation, y compris de position");
});

test("suppression d'une relation — relayout automatique, membres intacts", () => {
  const canvas = seedCanvas();
  const created = addGenealogyParentChild(canvas, "b1", "p1", "c1");
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(deleteGenealogyRelation(canvas, "b1", created.edge.id), true);
  assert.equal(canvas.edges.length, 0);
  assert.equal(groupBlockMemberNodes(canvas, "b1").length, 4, "les 4 membres restent");
});

test("suppression d'un membre — retire le node et ses relations, jamais le fichier ; relayout du reste", () => {
  const canvas = seedCanvas();
  addGenealogyParentChild(canvas, "b1", "gp", "p1");
  addGenealogyParentChild(canvas, "b1", "p1", "c1");
  assert.equal(removeGenealogyMember(canvas, "b1", "p1"), true);
  const remaining = groupBlockMemberNodes(canvas, "b1").map((n) => n.id).sort();
  assert.deepEqual(remaining, ["c1", "gm", "gp"]);
  assert.equal(canvas.edges.length, 0, "les deux relations touchant p1 disparaissent");
});

test("applyGenealogyLayout — relayout explicite (bouton Réorganiser), déterministe", () => {
  const canvas = seedCanvas();
  addGenealogyParentChild(canvas, "b1", "gp", "p1");
  addGenealogyParentChild(canvas, "b1", "p1", "c1");
  const first = groupBlockMemberNodes(canvas, "b1").map((n) => ({ id: n.id, x: n.x, y: n.y }));
  applyGenealogyLayout(canvas, "b1");
  const second = groupBlockMemberNodes(canvas, "b1").map((n) => ({ id: n.id, x: n.x, y: n.y }));
  assert.deepEqual(first, second, "relancer Réorganiser sur une structure inchangée redonne le même résultat");
});

test("applyGenealogyLayout — ne touche jamais aux cartes Canvas libres ni aux autres blocs", () => {
  const canvas = seedCanvas();
  canvas.nodes.push({ id: "free", type: "text", text: "Libre", x: 999, y: 999, width: 200, height: 80 });
  addGenealogyParentChild(canvas, "b1", "gp", "p1");
  const free = canvas.nodes.find((n) => n.id === "free");
  assert.deepEqual({ x: free.x, y: free.y }, { x: 999, y: 999 });
});
