import test from "node:test";
import assert from "node:assert/strict";
import {
  findMindmapChildren,
  findMindmapParent,
  findMindmapRoot,
  findMindmapSiblings,
  isMindmapDescendant,
  isMindmapStructuralEdge,
  canReparentMindmapNode,
  mindmapSubtree,
  mindmapMemberNodes,
  addMindmapChildRelation,
  addMindmapSiblingRelation,
  removeMindmapParentRelation,
  reparentMindmapBranch,
} from "../src/carnet/blocks/mindmap/model.js";

/* Fixture : une Mindmap A (racine A1, enfants A2/A3, petit-enfant A4 sous
 * A2), une Mindmap B totalement isolée (racine B1, enfant B2), et une edge
 * Canvas LIBRE (sans marqueur) reliant A1 à B1 — jamais interprétée comme
 * une relation structurelle par ce module. */
function buildCanvas() {
  return {
    nodes: [
      { id: "A1", type: "text", text: "Racine A", x: 0, y: 0, width: 200, height: 80, feuillets_block_id: "block-a" },
      { id: "A2", type: "text", text: "A2", x: 200, y: -50, width: 200, height: 80, feuillets_block_id: "block-a" },
      { id: "A3", type: "text", text: "A3", x: 200, y: 50, width: 200, height: 80, feuillets_block_id: "block-a" },
      { id: "A4", type: "text", text: "A4", x: 400, y: -50, width: 200, height: 80, feuillets_block_id: "block-a" },
      { id: "B1", type: "text", text: "Racine B", x: 1000, y: 0, width: 200, height: 80, feuillets_block_id: "block-b" },
      { id: "B2", type: "text", text: "B2", x: 1200, y: 0, width: 200, height: 80, feuillets_block_id: "block-b" },
      { id: "free", type: "text", text: "Carte libre", x: 2000, y: 0, width: 200, height: 80 },
    ],
    edges: [
      { id: "eA1A2", fromNode: "A1", toNode: "A2", feuillets_managed: "mindmap", feuillets_block_id: "block-a" },
      { id: "eA1A3", fromNode: "A1", toNode: "A3", feuillets_managed: "mindmap", feuillets_block_id: "block-a" },
      { id: "eA2A4", fromNode: "A2", toNode: "A4", feuillets_managed: "mindmap", feuillets_block_id: "block-a" },
      { id: "eB1B2", fromNode: "B1", toNode: "B2", feuillets_managed: "mindmap", feuillets_block_id: "block-b" },
      { id: "eFree", fromNode: "A1", toNode: "B1" }, // edge libre, aucun marqueur
    ],
  };
}

test("parent/enfants/frères — relations structurelles correctement retrouvées", () => {
  const canvas = buildCanvas();
  assert.equal(findMindmapParent(canvas, "block-a", "A1"), null, "la racine n'a pas de parent");
  assert.equal(findMindmapParent(canvas, "block-a", "A2").id, "A1");
  assert.equal(findMindmapParent(canvas, "block-a", "A4").id, "A2");
  assert.deepEqual(findMindmapChildren(canvas, "block-a", "A1").map((n) => n.id), ["A2", "A3"]);
  assert.deepEqual(findMindmapSiblings(canvas, "block-a", "A2").map((n) => n.id), ["A3"]);
  assert.deepEqual(findMindmapSiblings(canvas, "block-a", "A1"), [], "la racine n'a pas de fratrie");
});

test("racine — findMindmapRoot remonte jusqu'à la racine depuis n'importe quel descendant", () => {
  const canvas = buildCanvas();
  assert.equal(findMindmapRoot(canvas, "block-a", "A4").id, "A1");
  assert.equal(findMindmapRoot(canvas, "block-a", "A1").id, "A1");
  assert.equal(findMindmapRoot(canvas, "block-a", "does-not-exist"), null);
});

test("sous-arbre — mindmapSubtree retourne le pré-ordre déterministe, jamais les nodes hors bloc", () => {
  const canvas = buildCanvas();
  assert.deepEqual(mindmapSubtree(canvas, "block-a", "A1").map((n) => n.id), ["A1", "A2", "A4", "A3"]);
  assert.deepEqual(mindmapSubtree(canvas, "block-a", "A2").map((n) => n.id), ["A2", "A4"]);
});

test("cycle interdit — canReparentMindmapNode rejette soi-même et tout descendant", () => {
  const canvas = buildCanvas();
  assert.equal(canReparentMindmapNode(canvas, "block-a", "A1", "A1"), false, "jamais node → lui-même");
  assert.equal(canReparentMindmapNode(canvas, "block-a", "A1", "A4"), false, "jamais node → son propre descendant");
  assert.equal(canReparentMindmapNode(canvas, "block-a", "A2", "A1"), true, "un ancêtre normal reste un parent valide");
  assert.equal(isMindmapDescendant(canvas, "block-a", "A1", "A4"), true);
  assert.equal(isMindmapDescendant(canvas, "block-a", "A2", "A3"), false, "A3 n'est pas un descendant de A2");
});

test("plusieurs Mindmaps isolées — aucune fuite d'un bloc vers l'autre", () => {
  const canvas = buildCanvas();
  assert.deepEqual(mindmapMemberNodes(canvas, "block-a").map((n) => n.id).sort(), ["A1", "A2", "A3", "A4"]);
  assert.deepEqual(mindmapMemberNodes(canvas, "block-b").map((n) => n.id).sort(), ["B1", "B2"]);
  assert.equal(canReparentMindmapNode(canvas, "block-a", "A2", "B1"), false, "un node d'un AUTRE bloc n'est jamais un parent valide");
  assert.equal(findMindmapParent(canvas, "block-a", "B1"), null, "B1 n'appartient pas à block-a");
});

test("arête libre ignorée — une edge sans marqueurs n'est jamais parent/enfant", () => {
  const canvas = buildCanvas();
  assert.equal(isMindmapStructuralEdge(canvas.edges.find((e) => e.id === "eFree"), "block-a"), false);
  assert.equal(findMindmapParent(canvas, "block-b", "B1"), null, "l'edge libre A1->B1 ne fait jamais de B1 un enfant");
  assert.deepEqual(findMindmapChildren(canvas, "block-a", "A1").map((n) => n.id), ["A2", "A3"], "l'edge libre n'ajoute jamais B1 aux enfants de A1");
});

test("ajouter enfant / frère — un seul parent structurel au maximum", () => {
  const canvas = buildCanvas();
  const edge = addMindmapChildRelation(canvas, "block-a", "A3", "A4");
  assert.equal(edge, null, "A4 a déjà un parent structurel (A2) : impossible d'en ajouter un second");

  const sibling = addMindmapSiblingRelation(canvas, "block-a", "A1", "A2");
  assert.equal(sibling, null, "A1 est la racine, pas de fratrie possible");

  canvas.nodes.push({ id: "A5", type: "text", text: "A5", x: 400, y: 50, width: 200, height: 80, feuillets_block_id: "block-a" });
  const newSibling = addMindmapSiblingRelation(canvas, "block-a", "A4", "A5");
  assert.ok(newSibling);
  assert.equal(findMindmapParent(canvas, "block-a", "A5").id, "A2");
});

test("supprimer une relation structurelle — détache sans supprimer le node ni ses propres enfants", () => {
  const canvas = buildCanvas();
  assert.equal(removeMindmapParentRelation(canvas, "block-a", "A2"), true);
  assert.equal(findMindmapParent(canvas, "block-a", "A2"), null, "A2 est maintenant racine de sa propre branche");
  assert.equal(findMindmapParent(canvas, "block-a", "A4").id, "A2", "A4 reste enfant de A2 : sa relation n'a pas été touchée");
  assert.ok(mindmapMemberNodes(canvas, "block-a").some((n) => n.id === "A2"), "le node A2 lui-même n'est jamais supprimé");
});

test("déplacer/reparenter une branche — les descendants suivent, le cycle reste interdit", () => {
  const canvas = buildCanvas();
  assert.equal(reparentMindmapBranch(canvas, "block-a", "A1", "A4"), false, "reparenter la racine sous son propre descendant est un cycle");
  assert.equal(findMindmapParent(canvas, "block-a", "A1"), null, "aucune mutation après un rejet");

  assert.equal(reparentMindmapBranch(canvas, "block-a", "A2", "A3"), true);
  assert.equal(findMindmapParent(canvas, "block-a", "A2").id, "A3");
  assert.equal(findMindmapParent(canvas, "block-a", "A4").id, "A2", "A4 suit sa branche (A2), sa propre relation est intacte");
  assert.deepEqual(mindmapSubtree(canvas, "block-a", "A3").map((n) => n.id), ["A3", "A2", "A4"]);
});
