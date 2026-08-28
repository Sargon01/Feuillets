import test from "node:test";
import assert from "node:assert/strict";
import {
  createRelationsBlock,
  isFileAlreadyMember,
  applyRelationsLayout,
  createRelation,
  deleteRelation,
  removeRelationsMember,
} from "../src/carnet/blocks/relations/relations.js";
import { groupBlockMemberNodes } from "../src/carnet/blocks/shared/native-group-block.js";

function memberFileNode(id, path, x, y) {
  return { id, type: "file", file: path, x, y, width: 240, height: 80 };
}

test("createRelationsBlock — un vrai GroupNode natif, aucun membre", () => {
  const canvas = { nodes: [], edges: [] };
  const group = createRelationsBlock(canvas, { blockId: "b1", centerX: 100, centerY: 100 });
  assert.equal(group.type, "group");
  assert.equal(group.feuillets_block, "relations");
  assert.equal(group.feuillets_block_id, "b1");
  assert.equal(canvas.nodes.length, 1);
});

test("ajout de membres — pas de doublon pour le même chemin dans le même bloc", () => {
  const canvas = { nodes: [], edges: [] };
  createRelationsBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0 });
  assert.equal(isFileAlreadyMember(canvas, "b1", "Binder/Kemal.md"), false);
  const member = memberFileNode("m1", "Binder/Kemal.md", 0, 0);
  member.feuillets_block_id = "b1";
  canvas.nodes.push(member);
  assert.equal(isFileAlreadyMember(canvas, "b1", "Binder/Kemal.md"), true, "le pont d'ajout doit refuser un second drop du même fichier");
});

test("créer une relation entre deux membres, puis la supprimer — n'affecte jamais les nodes", () => {
  const canvas = { nodes: [], edges: [] };
  createRelationsBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0 });
  canvas.nodes.push(memberFileNode("m1", "R/A.md", 0, 0), memberFileNode("m2", "R/B.md", 300, 0));
  for (const node of canvas.nodes) if (node.type === "file") node.feuillets_block_id = "b1";

  const created = createRelation(canvas, "b1", "m1", "m2", "confidents");
  assert.equal(created.ok, true);
  assert.equal(canvas.edges.length, 1);

  const edgeId = created.ok ? created.edge.id : "";
  const deleted = deleteRelation(canvas, "b1", edgeId);
  assert.equal(deleted, true);
  assert.equal(canvas.edges.length, 0);
  assert.equal(canvas.nodes.filter((n) => n.type === "file").length, 2, "les deux membres restent");
});

test("un edge Canvas libre entre deux membres n'est jamais traité comme une relation", () => {
  const canvas = { nodes: [], edges: [] };
  createRelationsBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0 });
  canvas.nodes.push(memberFileNode("m1", "R/A.md", 0, 0), memberFileNode("m2", "R/B.md", 300, 0));
  for (const node of canvas.nodes) if (node.type === "file") node.feuillets_block_id = "b1";
  canvas.edges.push({ id: "free-edge", fromNode: "m1", toNode: "m2" }); // aucun marqueur

  assert.equal(deleteRelation(canvas, "b1", "free-edge"), false, "jamais supprimée comme relation métier");
  assert.equal(canvas.edges.length, 1, "l'edge libre reste");
});

test("suppression d'un membre — supprime le node ET ses edges métier, jamais le fichier référencé", () => {
  const canvas = { nodes: [], edges: [] };
  createRelationsBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0 });
  canvas.nodes.push(memberFileNode("m1", "R/A.md", 0, 0), memberFileNode("m2", "R/B.md", 300, 0), memberFileNode("m3", "R/C.md", 600, 0));
  for (const node of canvas.nodes) if (node.type === "file") node.feuillets_block_id = "b1";
  createRelation(canvas, "b1", "m1", "m2");
  createRelation(canvas, "b1", "m2", "m3");

  assert.equal(removeRelationsMember(canvas, "b1", "m2"), true);
  assert.equal(canvas.nodes.some((n) => n.id === "m2"), false);
  assert.equal(canvas.edges.length, 0, "les deux relations touchant m2 disparaissent");
  assert.equal(groupBlockMemberNodes(canvas, "b1").map((n) => n.id).sort().join(","), "m1,m3");
  // Aucune E/S vers le vault n'existe dans ce module : la « suppression du
  // fichier » n'est même pas une opération représentable ici.
});

test("layout déterministe — Réorganiser positionne tous les membres sans chevauchement", () => {
  const canvas = { nodes: [], edges: [] };
  createRelationsBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0 });
  canvas.nodes.push(memberFileNode("m1", "R/A.md", 10, 10), memberFileNode("m2", "R/B.md", 20, 20), memberFileNode("m3", "R/C.md", 30, 30));
  for (const node of canvas.nodes) if (node.type === "file") node.feuillets_block_id = "b1";

  assert.equal(applyRelationsLayout(canvas, "b1"), true);
  const positions = groupBlockMemberNodes(canvas, "b1").map((n) => ({ x: n.x, y: n.y }));
  assert.equal(new Set(positions.map((p) => `${p.x},${p.y}`)).size, 3, "trois positions distinctes");
});

test("positions inchangées SANS Réorganiser — créer/supprimer une relation ne déplace jamais les membres", () => {
  const canvas = { nodes: [], edges: [] };
  createRelationsBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0 });
  canvas.nodes.push(memberFileNode("m1", "R/A.md", 123, 456), memberFileNode("m2", "R/B.md", 789, 101));
  for (const node of canvas.nodes) if (node.type === "file") node.feuillets_block_id = "b1";

  const before = canvas.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  createRelation(canvas, "b1", "m1", "m2");
  const after = canvas.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  assert.deepEqual(before, after, "Relier ne relayout jamais automatiquement (contrairement à la Généalogie, §4 vs §7)");
});
