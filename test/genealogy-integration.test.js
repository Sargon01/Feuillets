import assert from "node:assert/strict";
import test from "node:test";
import {
  createGenealogyBlock,
  reconcileGenealogyBlock,
  selectGenealogyBlockId,
} from "../src/carnet/blocks/genealogy/index.js";

function person(id, file = `${id}.md`) {
  return { id, filePath: file, displayName: id, parentIds: [], spouseIds: [], childIds: [] };
}

function graph(persons, unions = []) {
  return { persons, unions };
}

test("la création ajoute un bloc sous le Canvas existant sans le déplacer", () => {
  const existing = { nodes: [{ id: "outside", type: "text", x: 20, y: 40, width: 100, height: 100 }], edges: [] };
  const next = createGenealogyBlock(existing, graph([person("a")]), "block-1");
  assert.equal(next.nodes.find((node) => node.id === "outside")?.y, 40);
  const group = next.nodes.find((node) => node.feuillets_block_id === "block-1" && node.type === "group");
  const personNode = next.nodes.find((node) => node.file === "a.md");
  assert.ok(group && personNode);
  assert.ok((group.y ?? 0) >= 340);
});

test("la réconciliation conserve la position manuelle et reconstruit les relations", () => {
  const initial = createGenealogyBlock({ nodes: [], edges: [] }, graph([
    person("a"), person("b"), person("c"),
  ], [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: ["c"], sources: ["parentage"] }]), "block-1");
  const moved = { ...initial, nodes: initial.nodes.map((node) => node.file === "a.md" ? { ...node, x: 987, y: 654 } : node) };
  const next = reconcileGenealogyBlock(moved, graph([person("a"), person("b"), person("d")], [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: ["d"], sources: ["parentage"] }]), "block-1");
  const a = next.nodes.find((node) => node.file === "a.md");
  assert.equal(a?.x, 987);
  assert.equal(a?.y, 654);
  assert.equal(next.nodes.some((node) => node.file === "c.md"), false);
  assert.equal(next.nodes.some((node) => node.file === "d.md"), true);
  assert.equal(next.edges.some((edge) => edge.toNode === "genealogy-person:d"), true);
  assert.equal(next.nodes.find((node) => node.type === "group")?.feuillets_block_id, "block-1");
});

test("les autres blocs restent intacts et un choix ambigu est refusé", () => {
  const canvas = {
    nodes: [
      { id: "other", type: "text", x: 1, y: 2, width: 3, height: 4, feuillets_block: "relations", feuillets_block_id: "r" },
      { id: "g1", type: "group", feuillets_block: "genealogy", feuillets_block_id: "one" },
      { id: "g2", type: "group", feuillets_block: "genealogy", feuillets_block_id: "two" },
    ],
    edges: [{ id: "outside-edge", fromNode: "other", toNode: "other", feuillets_managed: "relations", feuillets_block_id: "r" }],
  };
  const before = JSON.stringify(canvas.nodes[0]);
  assert.equal(selectGenealogyBlockId(canvas), null);
  assert.equal(selectGenealogyBlockId(canvas, "g2"), "two");
  const next = reconcileGenealogyBlock(canvas, graph([person("a")]), "two");
  assert.equal(JSON.stringify(next.nodes[0]), before);
  assert.equal(next.edges[0]?.id, "outside-edge");
});

test("un refresh reste dans le bloc déplacé et recalcule l'union autour des partenaires", () => {
  const initial = createGenealogyBlock({ nodes: [], edges: [] }, graph([
    person("a"), person("b"), person("c"),
  ], [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: ["c"], sources: ["parentage"] }]), "far-block");
  const placed = {
    ...initial,
    nodes: initial.nodes.map((node) => ({
      ...node,
      x: (node.x ?? 0) + 4000,
      y: (node.y ?? 0) + 5000,
    })),
  };
  const moved = {
    ...placed,
    nodes: placed.nodes.map((node) => node.file === "a.md" ? { ...node, x: 4321, y: 5432 } : node),
  };
  const next = reconcileGenealogyBlock(moved, graph([
    person("a"), person("b"), person("d"),
  ], [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: ["d"], sources: ["parentage"] }]), "far-block");
  const a = next.nodes.find((node) => node.file === "a.md");
  const d = next.nodes.find((node) => node.file === "d.md");
  const union = next.nodes.find((node) => node.feuillets_genealogy_kind === "union");
  assert.deepEqual({ x: a?.x, y: a?.y }, { x: 4321, y: 5432 });
  assert.ok(d && (d.x ?? 0) > 3000 && (d.y ?? 0) > 4000);
  assert.ok(union && (union.x ?? 0) > 3000 && (union.y ?? 0) > 4000);
  const partners = next.nodes.filter((node) => node.file === "a.md" || node.file === "b.md");
  const partnerLeft = Math.min(...partners.map((node) => node.x ?? 0));
  const partnerRight = Math.max(...partners.map((node) => (node.x ?? 0) + (node.width ?? 0)));
  assert.equal(union?.x, (partnerLeft + partnerRight - (union?.width ?? 0)) / 2);
});
