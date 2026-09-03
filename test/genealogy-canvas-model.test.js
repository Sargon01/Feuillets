import assert from "node:assert/strict";
import test from "node:test";
import { createGenealogyCanvasModel } from "../src/carnet/blocks/genealogy/index.js";
import { createGroupBlockNode } from "../src/carnet/blocks/shared/native-group-block.js";

function person(id, relations = {}) {
  return { id, filePath: `${id}.md`, displayName: id, parentIds: [], spouseIds: [], childIds: [], ...relations };
}

function graph(persons, unions = []) {
  return { persons, unions };
}

function nodesOfType(model, type) {
  return model.nodes.filter((node) => node.type === type);
}

test("personne seule devient un FileNode généalogie", () => {
  const model = createGenealogyCanvasModel(graph([person("a")]), "block-1");
  const files = nodesOfType(model, "file");

  assert.equal(files.length, 1);
  assert.equal(files[0].file, "a.md");
  assert.equal(files[0].feuillets_block, "genealogy");
  assert.equal(files[0].feuillets_block_id, "block-1");
  assert.equal(model.edges.length, 0);
});

test("conjoints : deux fichiers, union technique et deux edges", () => {
  const model = createGenealogyCanvasModel(graph([
    person("a"),
    person("b"),
  ], [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: [], sources: ["spouse"] }]), "block-1");
  const unions = model.nodes.filter((node) => node.feuillets_genealogy_kind === "union");

  assert.equal(nodesOfType(model, "file").length, 2);
  assert.equal(unions.length, 1);
  assert.equal(unions[0].feuillets_block_id, "block-1");
  assert.equal(model.edges.length, 2);
  assert.ok(model.edges.every((edge) => edge.feuillets_relation === "partner-union"));
});

test("deux parents et enfant : union commune et edge union-child", () => {
  const model = createGenealogyCanvasModel(graph([
    person("a"), person("b"), person("c"),
  ], [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: ["c"], sources: ["parentage"] }]), "block-1");
  const unionId = "genealogy-union:union%3Aa%7Cb";
  const childEdge = model.edges.find((edge) => edge.feuillets_relation === "union-child");

  assert.equal(nodesOfType(model, "text").length, 1);
  assert.equal(childEdge?.fromNode, unionId);
  assert.equal(childEdge?.toNode, "genealogy-person:c");
  assert.equal(model.edges.filter((edge) => edge.feuillets_relation === "partner-union").length, 2);
});

test("spouse et parentage fusionnés restent une seule union", () => {
  const model = createGenealogyCanvasModel(graph([
    person("a"), person("b"), person("c"),
  ], [{ id: "union:a|b", partnerIds: ["b", "a"], childIds: ["c"], sources: ["spouse", "parentage"] }]), "block-1");

  assert.equal(model.nodes.filter((node) => node.feuillets_genealogy_kind === "union").length, 1);
  assert.equal(model.edges.length, 3);
});

test("parent singleton : union technique valide", () => {
  const model = createGenealogyCanvasModel(graph([
    person("a"), person("c"),
  ], [{ id: "union:a", partnerIds: ["a"], childIds: ["c"], sources: ["parentage"] }]), "block-1");

  assert.equal(model.nodes.filter((node) => node.feuillets_genealogy_kind === "union").length, 1);
  assert.deepEqual(model.edges.map((edge) => edge.feuillets_relation), ["partner-union", "union-child"]);
});

test("plus de deux parents : toutes les edges partenaire sont conservées", () => {
  const model = createGenealogyCanvasModel(graph([
    person("a"), person("b"), person("c"), person("d"),
  ], [{ id: "union:a|b|d", partnerIds: ["d", "a", "b"], childIds: ["c"], sources: ["parentage"] }]), "block-1");

  assert.equal(model.edges.filter((edge) => edge.feuillets_relation === "partner-union").length, 3);
});

test("IDs de nodes et edges déterministes", () => {
  const input = graph([person("b"), person("a"), person("c")], [{ id: "union:a|b", partnerIds: ["b", "a"], childIds: ["c"], sources: ["parentage"] }]);
  const first = createGenealogyCanvasModel(input, "block-1");
  const second = createGenealogyCanvasModel(graph([...input.persons].reverse(), [{ ...input.unions[0], partnerIds: ["a", "b"] }]), "block-1");

  assert.deepEqual(first, second);
});

test("group et edges portent les métadonnées généalogie", () => {
  const model = createGenealogyCanvasModel(graph([person("a")]), "block-1");
  const group = model.nodes.find((node) => node.type === "group");

  assert.deepEqual(group, {
    id: "genealogy-group:block-1",
    type: "group",
    x: -60,
    y: -60,
    width: 340,
    height: 340,
    label: "Généalogie",
    feuillets_block: "genealogy",
    feuillets_block_version: 1,
    feuillets_block_id: "block-1",
  });
});

test("les nodes du modèle ne portent aucune métadonnée Relations", () => {
  const model = createGenealogyCanvasModel(graph([person("a"), person("b")], [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: [], sources: ["spouse"] }]), "block-g");

  assert.ok(model.nodes.every((node) => node.feuillets_block === "genealogy"));
  assert.ok(model.edges.every((edge) => edge.feuillets_managed === "genealogy"));
  assert.equal(model.edges.some((edge) => edge.feuillets_managed === "relations"), false);
});

test("createGroupBlockNode conserve son ID frais par défaut pour Relations", () => {
  const canvas = { nodes: [], edges: [] };
  const group = createGroupBlockNode(canvas, {
    blockType: "relations",
    blockId: "relations-1",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });

  assert.match(group.id, /^[0-9a-f]{16}$/);
  assert.equal(group.feuillets_block, "relations");
  assert.equal(canvas.nodes.length, 1);
});
