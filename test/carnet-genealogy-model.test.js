import test from "node:test";
import assert from "node:assert/strict";
import {
  isGenealogyEdge,
  parentChildEdges,
  spouseEdges,
  buildGenealogyChildrenMap,
  buildGenealogyParentsMap,
  buildGenealogySpouseGroups,
  areSpouses,
  isGenealogyDescendant,
  addParentChildEdge,
  addSpouseEdge,
  removeGenealogyEdge,
} from "../src/carnet/blocks/genealogy/model.js";

function member(id, path) {
  return { id, type: "file", file: path, feuillets_block_id: "b1" };
}

function buildCanvas() {
  return {
    nodes: [
      { id: "grp", type: "group", feuillets_block: "genealogy", feuillets_block_version: 1, feuillets_block_id: "b1" },
      member("gp", "F/GrandPere.md"),
      member("gm", "F/GrandMere.md"),
      member("p1", "F/Parent1.md"),
      member("p2", "F/Parent2.md"),
      member("c1", "F/Enfant1.md"),
      member("c2", "F/Enfant2.md"),
      { id: "outside", type: "file", file: "F/Hors.md" },
    ],
    edges: [
      { id: "e1", fromNode: "gp", toNode: "p1", feuillets_managed: "genealogy", feuillets_block_id: "b1", feuillets_relation: "parent-child" },
      { id: "e2", fromNode: "gm", toNode: "p1", feuillets_managed: "genealogy", feuillets_block_id: "b1", feuillets_relation: "parent-child" },
      { id: "e3", fromNode: "gp", toNode: "gm", feuillets_managed: "genealogy", feuillets_block_id: "b1", feuillets_relation: "spouse" },
      { id: "e4", fromNode: "p1", toNode: "c1", feuillets_managed: "genealogy", feuillets_block_id: "b1", feuillets_relation: "parent-child" },
      { id: "e5", fromNode: "p2", toNode: "c1", feuillets_managed: "genealogy", feuillets_block_id: "b1", feuillets_relation: "parent-child" },
      { id: "eFree", fromNode: "p1", toNode: "p2" }, // edge libre : jamais une relation généalogique
    ],
  };
}

test("isGenealogyEdge / parentChildEdges / spouseEdges — séparent proprement les deux natures, ignorent le libre", () => {
  const canvas = buildCanvas();
  assert.equal(isGenealogyEdge(canvas.edges[0], "b1"), true);
  assert.equal(isGenealogyEdge(canvas.edges.at(-1), "b1"), false, "edge libre");
  assert.deepEqual(parentChildEdges(canvas, "b1").map((e) => e.id), ["e1", "e2", "e4", "e5"]);
  assert.deepEqual(spouseEdges(canvas, "b1").map((e) => e.id), ["e3"]);
});

test("buildGenealogyChildrenMap / buildGenealogyParentsMap — un enfant peut avoir DEUX parents distincts", () => {
  const canvas = buildCanvas();
  const children = buildGenealogyChildrenMap(canvas, "b1");
  assert.deepEqual(children.get("gp"), ["p1"]);
  assert.deepEqual(children.get("p1"), ["c1"]);
  assert.deepEqual(children.get("p2"), ["c1"]);
  const parents = buildGenealogyParentsMap(canvas, "b1");
  assert.deepEqual(parents.get("p1").sort(), ["gm", "gp"]);
  assert.deepEqual(parents.get("c1").sort(), ["p1", "p2"]);
});

test("buildGenealogySpouseGroups / areSpouses", () => {
  const canvas = buildCanvas();
  assert.deepEqual(buildGenealogySpouseGroups(canvas, "b1"), [["gm", "gp"]]);
  assert.equal(areSpouses(canvas, "b1", "gp", "gm"), true);
  assert.equal(areSpouses(canvas, "b1", "gm", "gp"), true, "symétrique");
  assert.equal(areSpouses(canvas, "b1", "p1", "p2"), false, "coparents, pas conjoints (aucune edge spouse)");
});

test("isGenealogyDescendant — vrai le long de la chaîne parent→enfant, jamais via spouse", () => {
  const canvas = buildCanvas();
  assert.equal(isGenealogyDescendant(canvas, "b1", "gp", "c1"), true, "gp → p1 → c1");
  assert.equal(isGenealogyDescendant(canvas, "b1", "gp", "gp"), true, "réflexif");
  assert.equal(isGenealogyDescendant(canvas, "b1", "c1", "gp"), false, "sens inverse : faux");
  assert.equal(isGenealogyDescendant(canvas, "b1", "gm", "gp"), false, "spouse n'est jamais une chaîne de descendance");
});

test("addParentChildEdge — crée une edge dirigée fléchée, un enfant peut avoir 2 parents", () => {
  const canvas = buildCanvas();
  // gm est DÉJÀ parent de p1 dans la fixture (e2) : redemander la même
  // relation doit être un doublon, pas une seconde edge identique.
  assert.deepEqual(addParentChildEdge(canvas, "b1", "gm", "p1"), { ok: false, reason: "duplicate" });

  const fresh = addParentChildEdge(canvas, "b1", "p2", "c2");
  assert.equal(fresh.ok, true);
  if (!fresh.ok) return;
  assert.equal(fresh.edge.fromNode, "p2");
  assert.equal(fresh.edge.toNode, "c2");
  assert.equal(fresh.edge.feuillets_relation, "parent-child");
  assert.equal(fresh.edge.toEnd, "arrow");
});

test("addParentChildEdge — refuse d'être son propre parent", () => {
  const canvas = buildCanvas();
  const before = canvas.edges.length;
  assert.deepEqual(addParentChildEdge(canvas, "b1", "p1", "p1"), { ok: false, reason: "self" });
  assert.equal(canvas.edges.length, before);
});

test("addParentChildEdge — refuse un id hors bloc", () => {
  const canvas = buildCanvas();
  assert.deepEqual(addParentChildEdge(canvas, "b1", "p1", "outside"), { ok: false, reason: "not-members" });
  assert.deepEqual(addParentChildEdge(canvas, "b1", "outside", "p1"), { ok: false, reason: "not-members" });
});

test("addParentChildEdge — refuse un doublon EXACT (même parent, même enfant)", () => {
  const canvas = buildCanvas();
  const before = canvas.edges.length;
  assert.deepEqual(addParentChildEdge(canvas, "b1", "gp", "p1"), { ok: false, reason: "duplicate" });
  assert.equal(canvas.edges.length, before);
});

test("addParentChildEdge — refuse un CYCLE (le parent proposé est déjà un descendant de l'enfant), aucune mutation partielle", () => {
  const canvas = buildCanvas();
  const before = JSON.stringify(canvas);
  // c1 → gp créerait gp → p1 → c1 → gp : un cycle.
  const result = addParentChildEdge(canvas, "b1", "c1", "gp");
  assert.deepEqual(result, { ok: false, reason: "cycle" });
  assert.equal(JSON.stringify(canvas), before, "AUCUNE mutation, même partielle, en cas de refus");
});

test("addParentChildEdge — refuse un cycle direct (A→B puis B→A)", () => {
  const canvas = { nodes: [member("a", "F/A.md"), member("b", "F/B.md")], edges: [] };
  assert.equal(addParentChildEdge(canvas, "b1", "a", "b").ok, true);
  assert.deepEqual(addParentChildEdge(canvas, "b1", "b", "a"), { ok: false, reason: "cycle" });
});

test("addSpouseEdge — crée une edge non dirigée (trait sans embout), refuse soi-même et les doublons", () => {
  const canvas = buildCanvas();
  const result = addSpouseEdge(canvas, "b1", "p1", "p2");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.edge.feuillets_relation, "spouse");
  assert.equal(result.edge.toEnd, "none");

  assert.deepEqual(addSpouseEdge(canvas, "b1", "c1", "c1"), { ok: false, reason: "self" });
  assert.deepEqual(addSpouseEdge(canvas, "b1", "gp", "gm"), { ok: false, reason: "duplicate" });
  assert.deepEqual(addSpouseEdge(canvas, "b1", "gm", "gp"), { ok: false, reason: "duplicate" }, "sens inverse aussi refusé");
});

test("les relations spouse ne participent JAMAIS au contrôle de cycle parent→enfant", () => {
  const canvas = { nodes: [member("a", "F/A.md"), member("b", "F/B.md"), member("c", "F/C.md")], edges: [] };
  assert.equal(addSpouseEdge(canvas, "b1", "a", "b").ok, true);
  assert.equal(addParentChildEdge(canvas, "b1", "a", "c").ok, true);
  // b est le conjoint de a, mais PAS un ancêtre de c au sens parent→enfant :
  // rendre b parent de c ne doit PAS être bloqué comme cycle.
  const result = addParentChildEdge(canvas, "b1", "b", "c");
  assert.equal(result.ok, true, "b devient un second parent de c, aucun cycle réel");
});

test("removeGenealogyEdge — retire uniquement l'edge visée, jamais un node ni une edge libre", () => {
  const canvas = buildCanvas();
  const nodesBefore = canvas.nodes.length;
  assert.equal(removeGenealogyEdge(canvas, "b1", "e4"), true);
  assert.equal(canvas.edges.some((e) => e.id === "e4"), false);
  assert.equal(canvas.nodes.length, nodesBefore);
  assert.equal(removeGenealogyEdge(canvas, "b1", "eFree"), false, "edge libre jamais traitée comme relation");
});
