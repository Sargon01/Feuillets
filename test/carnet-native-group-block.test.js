import test from "node:test";
import assert from "node:assert/strict";
import {
  isGroupBlockNode,
  findGroupBlockNode,
  isGroupBlockMember,
  groupBlockMemberNodes,
  isGroupBlockManagedEdge,
  freshNodeId,
  freshEdgeId,
  createGroupBlockNode,
  fitGroupBlockToMembers,
  hasFileMember,
  removeGroupBlockMember,
} from "../src/carnet/blocks/shared/native-group-block.js";

/* Socle commun (Prompt 4, §1) — vérifié indépendamment de Relations et
 * Généalogie, qui le réutilisent tel quel. */

function buildCanvas() {
  return {
    nodes: [
      { id: "grp", type: "group", x: 0, y: 0, width: 400, height: 300, feuillets_block: "relations", feuillets_block_version: 1, feuillets_block_id: "block-r" },
      { id: "m1", type: "file", file: "Recherche/Ana.md", x: 40, y: 40, width: 240, height: 80, feuillets_block_id: "block-r" },
      { id: "m2", type: "file", file: "Recherche/Bo.md", x: 320, y: 40, width: 240, height: 80, feuillets_block_id: "block-r" },
      { id: "free", type: "text", text: "Carte libre", x: 1000, y: 0, width: 200, height: 80 },
    ],
    edges: [
      { id: "e1", fromNode: "m1", toNode: "m2", feuillets_managed: "relations", feuillets_block_id: "block-r" },
      { id: "eFree", fromNode: "m1", toNode: "free" }, // edge libre, aucun marqueur
    ],
  };
}

test("isGroupBlockNode / findGroupBlockNode — reconnaît le groupe par type+marqueur+id, jamais par géométrie", () => {
  const canvas = buildCanvas();
  const group = canvas.nodes[0];
  assert.equal(isGroupBlockNode(group, "relations"), true);
  assert.equal(isGroupBlockNode(canvas.nodes[1], "relations"), false, "un membre n'est jamais un groupe");
  assert.equal(findGroupBlockNode(canvas, "relations", "block-r")?.id, "grp");
  assert.equal(findGroupBlockNode(canvas, "relations", "unknown-id"), null);
});

test("isGroupBlockMember / groupBlockMemberNodes — jamais le groupe lui-même, jamais une carte libre", () => {
  const canvas = buildCanvas();
  assert.equal(isGroupBlockMember(canvas.nodes[0], "block-r"), false, "le groupe n'est jamais son propre membre");
  assert.equal(isGroupBlockMember(canvas.nodes[1], "block-r"), true);
  assert.equal(isGroupBlockMember(canvas.nodes[3], "block-r"), false, "carte libre, aucun block_id");
  assert.deepEqual(groupBlockMemberNodes(canvas, "block-r").map((n) => n.id), ["m1", "m2"]);
});

test("isGroupBlockManagedEdge — une edge libre n'est JAMAIS interprétée comme métier", () => {
  const canvas = buildCanvas();
  assert.equal(isGroupBlockManagedEdge(canvas.edges[0], "relations", "block-r"), true);
  assert.equal(isGroupBlockManagedEdge(canvas.edges[1], "relations", "block-r"), false, "edge libre, aucun feuillets_managed");
  assert.equal(isGroupBlockManagedEdge(canvas.edges[0], "relations", "block-g"), false, "mauvais block_id");
});

test("freshNodeId / freshEdgeId — jamais un doublon d'un id déjà présent", () => {
  const canvas = buildCanvas();
  for (let i = 0; i < 50; i += 1) {
    const id = freshNodeId(canvas);
    assert.equal(canvas.nodes.some((n) => n.id === id), false);
  }
  const e1 = freshEdgeId(canvas, "feuillets-relations");
  assert.equal(e1, "feuillets-relations-1");
  canvas.edges.push({ id: e1, fromNode: "m1", toNode: "m2" });
  const e2 = freshEdgeId(canvas, "feuillets-relations");
  assert.equal(e2, "feuillets-relations-2");
});

test("createGroupBlockNode — pose exactement les marqueurs attendus, aucun membre créé", () => {
  const canvas = { nodes: [], edges: [] };
  const group = createGroupBlockNode(canvas, { blockType: "relations", blockId: "b1", x: 10, y: 20, width: 300, height: 200 });
  assert.equal(group.type, "group");
  assert.equal(group.feuillets_block, "relations");
  assert.equal(group.feuillets_block_version, 1);
  assert.equal(group.feuillets_block_id, "b1");
  assert.equal(canvas.nodes.length, 1, "aucun membre créé automatiquement");
});

test("fitGroupBlockToMembers — englobe exactement les membres avec la marge, ignore tout le reste", () => {
  const canvas = buildCanvas();
  fitGroupBlockToMembers(canvas, "block-r", 20);
  const group = canvas.nodes[0];
  assert.equal(group.x, 40 - 20);
  assert.equal(group.y, 40 - 20);
  assert.equal(group.width, (320 + 240) - 40 + 20 * 2);
  assert.equal(group.height, 80 + 20 * 2);
});

test("fitGroupBlockToMembers — sans membre, ne touche à rien", () => {
  const canvas = { nodes: [{ id: "grp", type: "group", x: 5, y: 5, width: 100, height: 100, feuillets_block_id: "empty" }], edges: [] };
  fitGroupBlockToMembers(canvas, "empty");
  assert.deepEqual(canvas.nodes[0], { id: "grp", type: "group", x: 5, y: 5, width: 100, height: 100, feuillets_block_id: "empty" });
});

test("hasFileMember — vrai seulement pour un FileNode du bon chemin, déjà membre de CE bloc", () => {
  const canvas = buildCanvas();
  assert.equal(hasFileMember(canvas, "block-r", "Recherche/Ana.md"), true);
  assert.equal(hasFileMember(canvas, "block-r", "Recherche/Introuvable.md"), false);
  assert.equal(hasFileMember(canvas, "other-block", "Recherche/Ana.md"), false, "membre d'un AUTRE bloc");
});

test("removeGroupBlockMember — retire le node et ses edges (métier ou non), jamais le fichier (aucune E/S ici)", () => {
  const canvas = buildCanvas();
  const removed = removeGroupBlockMember(canvas, "block-r", "m1");
  assert.equal(removed, true);
  assert.equal(canvas.nodes.some((n) => n.id === "m1"), false);
  assert.equal(canvas.edges.some((e) => e.fromNode === "m1" || e.toNode === "m1"), false, "l'edge métier ET l'edge libre attachées à m1 disparaissent");
  assert.equal(canvas.nodes.some((n) => n.id === "free"), true, "la carte libre reste intacte");
});

test("removeGroupBlockMember — false pour un id inconnu ou hors bloc", () => {
  const canvas = buildCanvas();
  assert.equal(removeGroupBlockMember(canvas, "block-r", "does-not-exist"), false);
  assert.equal(removeGroupBlockMember(canvas, "other-block", "m1"), false, "m1 n'est pas membre de l'autre bloc");
  assert.equal(canvas.nodes.length, 4, "aucune mutation en cas de refus");
});
