import test from "node:test";
import assert from "node:assert/strict";
import {
  isRelationEdge,
  relationEdges,
  relationExists,
  addRelationEdge,
  removeRelationEdge,
} from "../src/carnet/blocks/relations/model.js";

function buildCanvas() {
  return {
    nodes: [
      { id: "grp", type: "group", feuillets_block: "relations", feuillets_block_version: 1, feuillets_block_id: "b1" },
      { id: "m1", type: "file", file: "R/A.md", feuillets_block_id: "b1" },
      { id: "m2", type: "file", file: "R/B.md", feuillets_block_id: "b1" },
      { id: "m3", type: "file", file: "R/C.md", feuillets_block_id: "b1" },
      { id: "outside", type: "file", file: "R/D.md" },
    ],
    edges: [
      { id: "e1", fromNode: "m1", toNode: "m2", feuillets_managed: "relations", feuillets_block_id: "b1", feuillets_relation_id: "r1" },
      { id: "eFree", fromNode: "m2", toNode: "m3" }, // edge Canvas libre
    ],
  };
}

test("isRelationEdge / relationEdges — seule une edge feuillets_managed=relations + bon block_id compte", () => {
  const canvas = buildCanvas();
  assert.equal(isRelationEdge(canvas.edges[0], "b1"), true);
  assert.equal(isRelationEdge(canvas.edges[1], "b1"), false, "edge libre ignorée");
  assert.deepEqual(relationEdges(canvas, "b1").map((e) => e.id), ["e1"]);
});

test("relationExists — détecte une relation existante dans les DEUX sens", () => {
  const canvas = buildCanvas();
  assert.equal(relationExists(canvas, "b1", "m1", "m2"), true);
  assert.equal(relationExists(canvas, "b1", "m2", "m1"), true, "non dirigé");
  assert.equal(relationExists(canvas, "b1", "m1", "m3"), false);
});

test("addRelationEdge — crée l'edge métier avec feuillets_relation_id, label facultatif natif", () => {
  const canvas = buildCanvas();
  const result = addRelationEdge(canvas, "b1", "m1", "m3", "amis d'enfance");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.edge.feuillets_managed, "relations");
  assert.equal(result.edge.feuillets_block_id, "b1");
  assert.ok(result.edge.feuillets_relation_id, "un uuid de relation est posé");
  assert.equal(result.edge.label, "amis d'enfance");
  assert.equal(canvas.edges.includes(result.edge), true);
});

test("addRelationEdge — sans label, aucun champ label posé", () => {
  const canvas = buildCanvas();
  const result = addRelationEdge(canvas, "b1", "m1", "m3");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("label" in result.edge, false);
});

test("addRelationEdge — refuse l'auto-relation (même node des deux côtés)", () => {
  const canvas = buildCanvas();
  const before = canvas.edges.length;
  const result = addRelationEdge(canvas, "b1", "m1", "m1");
  assert.deepEqual(result, { ok: false, reason: "same-node" });
  assert.equal(canvas.edges.length, before, "aucune mutation");
});

test("addRelationEdge — refuse si l'un des deux ids n'est pas membre du bloc", () => {
  const canvas = buildCanvas();
  const before = canvas.edges.length;
  assert.deepEqual(addRelationEdge(canvas, "b1", "m1", "outside"), { ok: false, reason: "not-members" });
  assert.deepEqual(addRelationEdge(canvas, "b1", "m1", "does-not-exist"), { ok: false, reason: "not-members" });
  assert.equal(canvas.edges.length, before);
});

test("addRelationEdge — refuse un doublon (déjà reliés, quel que soit le sens demandé)", () => {
  const canvas = buildCanvas();
  const before = canvas.edges.length;
  assert.deepEqual(addRelationEdge(canvas, "b1", "m1", "m2"), { ok: false, reason: "duplicate" });
  assert.deepEqual(addRelationEdge(canvas, "b1", "m2", "m1"), { ok: false, reason: "duplicate" });
  assert.equal(canvas.edges.length, before);
});

test("removeRelationEdge — retire UNIQUEMENT l'edge métier ciblée, jamais les nodes", () => {
  const canvas = buildCanvas();
  const nodesBefore = canvas.nodes.length;
  assert.equal(removeRelationEdge(canvas, "b1", "e1"), true);
  assert.equal(canvas.edges.some((e) => e.id === "e1"), false);
  assert.equal(canvas.edges.some((e) => e.id === "eFree"), true, "l'edge libre survit");
  assert.equal(canvas.nodes.length, nodesBefore, "aucun node supprimé");
});

test("removeRelationEdge — false pour une edge libre ou inconnue, jamais une suppression accidentelle", () => {
  const canvas = buildCanvas();
  assert.equal(removeRelationEdge(canvas, "b1", "eFree"), false, "une edge libre n'est jamais une relation métier");
  assert.equal(removeRelationEdge(canvas, "b1", "does-not-exist"), false);
  assert.equal(canvas.edges.length, 2);
});
