import assert from "node:assert/strict";
import test from "node:test";
import { createGenealogyCanvasModel, layoutGenealogy } from "../src/carnet/blocks/genealogy/index.js";

function person(id) {
  return { id, filePath: `${id}.md`, displayName: id, parentIds: [], spouseIds: [], childIds: [] };
}

function union(id, partnerIds, childIds = [], sources = ["parentage"]) {
  return { id, partnerIds, childIds, sources };
}

function familyGraph(persons, unions) {
  return { persons, unions };
}

test("trois générations : les générations successives ont des y croissants", () => {
  const graph = familyGraph([
    person("a"), person("b"),
    { ...person("c"), parentIds: ["a", "b"] },
    { ...person("d"), parentIds: ["c"] },
  ], [
    union("u-ab", ["a", "b"], ["c"]),
    union("u-c", ["c"], ["d"]),
  ]);
  const positions = layoutGenealogy(graph);

  assert.equal(positions.persons.a.y, positions.persons.b.y);
  assert.ok(positions.persons.c.y > positions.persons.a.y);
  assert.ok(positions.persons.d.y > positions.persons.c.y);
});

test("les partenaires sont sur la même ligne et l'union est exactement centrée", () => {
  const graph = familyGraph([person("a"), person("b")], [union("u", ["b", "a"], [], ["spouse"])]);
  const positions = layoutGenealogy(graph);
  const unionPosition = positions.unions.u;
  const left = Math.min(positions.persons.a.x, positions.persons.b.x);
  const right = Math.max(positions.persons.a.x, positions.persons.b.x) + 220;

  assert.equal(positions.persons.a.y, positions.persons.b.y);
  assert.equal(unionPosition.x, (left + right - 40) / 2);
  assert.ok(unionPosition.y > positions.persons.a.y);
});

test("parent singleton : l'union est centrée sous le parent", () => {
  const graph = familyGraph([person("a"), { ...person("c"), parentIds: ["a"] }], [union("u", ["a"], ["c"])]);
  const positions = layoutGenealogy(graph);

  assert.equal(positions.unions.u.x, positions.persons.a.x + (220 - 40) / 2);
  assert.ok(positions.persons.c.y > positions.unions.u.y);
});

test("frères et sœurs : même génération, sans chevauchement et groupés sous l'union", () => {
  const graph = familyGraph([
    person("a"), person("b"),
    { ...person("c"), parentIds: ["a", "b"] },
    { ...person("d"), parentIds: ["a", "b"] },
  ], [union("u", ["a", "b"], ["d", "c"])]);
  const positions = layoutGenealogy(graph);

  assert.equal(positions.persons.c.y, positions.persons.d.y);
  assert.ok(Math.abs(positions.persons.c.x - positions.persons.d.x) >= 260);
  assert.ok(positions.persons.c.x >= 0);
  assert.ok(positions.persons.d.x >= 0);
});

test("fratrie large : trois enfants restent centrés sous l'union", () => {
  const graph = familyGraph([
    person("a"), person("b"),
    { ...person("c"), parentIds: ["a", "b"] },
    { ...person("d"), parentIds: ["a", "b"] },
    { ...person("e"), parentIds: ["a", "b"] },
  ], [union("u", ["a", "b"], ["c", "d", "e"])]);
  const positions = layoutGenealogy(graph);
  const children = ["c", "d", "e"].map((id) => positions.persons[id]);
  const childLeft = Math.min(...children.map((position) => position.x));
  const childRight = Math.max(...children.map((position) => position.x + 220));
  const childrenCenter = (childLeft + childRight) / 2;
  const unionCenter = positions.unions.u.x + 20;

  assert.equal(childrenCenter, unionCenter);
});

test("les edges généalogiques relient toujours bottom vers top", () => {
  const model = createGenealogyCanvasModel(familyGraph([
    person("a"), person("b"), { ...person("c"), parentIds: ["a", "b"] },
  ], [union("u", ["a", "b"], ["c"])]), "block-1");

  assert.ok(model.edges.every((edge) => edge.fromSide === "bottom" && edge.toSide === "top"));
});

test("plus de deux parents : l'union est centrée sur tous les partenaires", () => {
  const graph = familyGraph([person("a"), person("b"), person("d"), person("c")], [union("u", ["d", "a", "b"], ["c"])]);
  const positions = layoutGenealogy(graph);
  const partnerXs = ["a", "b", "d"].map((id) => positions.persons[id].x);
  const left = Math.min(...partnerXs);
  const right = Math.max(...partnerXs) + 220;

  assert.equal(positions.unions.u.x, (left + right - 40) / 2);
});

test("familles déconnectées : composantes côte à côte sans chevauchement", () => {
  const graph = familyGraph([person("a"), person("z")], []);
  const positions = layoutGenealogy(graph);

  assert.ok(positions.persons.z.x >= positions.persons.a.x + 220 + 160);
});

test("ordre d'entrée différent : layout identique", () => {
  const persons = [person("a"), person("b"), { ...person("c"), parentIds: ["a", "b"] }];
  const unions = [union("u", ["b", "a"], ["c"])]
  const first = layoutGenealogy(familyGraph(persons, unions));
  const second = layoutGenealogy(familyGraph([...persons].reverse(), [{ ...unions[0], partnerIds: ["a", "b"], childIds: ["c"] }]));

  assert.deepEqual(first, second);
});

test("cycle d'ascendance : le layout termine avec des positions finies", () => {
  const graph = familyGraph([
    { ...person("a"), parentIds: ["b"] },
    { ...person("b"), parentIds: ["a"] },
  ], [union("u", ["a"], ["b"]), union("v", ["b"], ["a"])]);
  const positions = layoutGenealogy(graph);

  for (const position of Object.values(positions.persons)) {
    assert.equal(Number.isFinite(position.x), true);
    assert.equal(Number.isFinite(position.y), true);
  }
});

test("le modèle Canvas consomme les positions du layout sans changer les métadonnées", () => {
  const graph = familyGraph([person("a"), person("b")], [union("u", ["a", "b"], [], ["spouse"])]);
  const model = createGenealogyCanvasModel(graph, "block-1");
  const files = model.nodes.filter((node) => node.type === "file");
  const unionNode = model.nodes.find((node) => node.feuillets_genealogy_kind === "union");

  assert.equal(files[0].y, files[1].y);
  assert.equal(unionNode?.feuillets_block, "genealogy");
  assert.ok(model.edges.every((edge) => edge.feuillets_managed === "genealogy" && edge.feuillets_block_id === "block-1"));
});
