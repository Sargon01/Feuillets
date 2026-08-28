import test from "node:test";
import assert from "node:assert/strict";
import { computeGenealogyLayout } from "../src/carnet/blocks/genealogy/layout.js";

const DIM = { width: 240, height: 80 };
const anchor = { x: 0, y: 0 };

function dims(ids) {
  return Object.fromEntries(ids.map((id) => [id, DIM]));
}

test("aucun membre — positions vides", () => {
  assert.deepEqual(computeGenealogyLayout([], new Map(), [], {}, anchor), { positions: {} });
});

test("générations correctes — parent strictement au-dessus de l'enfant (y croissant vers le bas)", () => {
  const ids = ["gp", "p", "c"];
  const children = new Map([["gp", ["p"]], ["p", ["c"]]]);
  const { positions } = computeGenealogyLayout(ids, children, [], dims(ids), anchor);
  assert.ok(positions.gp.y < positions.p.y, "grand-parent au-dessus du parent");
  assert.ok(positions.p.y < positions.c.y, "parent au-dessus de l'enfant");
});

test("conjoints — même génération (même y), placés côte à côte (x adjacents)", () => {
  const ids = ["a", "b"];
  const spouseGroups = [["a", "b"]];
  const { positions } = computeGenealogyLayout(ids, new Map(), spouseGroups, dims(ids), anchor);
  assert.equal(positions.a.y, positions.b.y, "même génération");
  const gap = Math.abs(positions.a.x - positions.b.x);
  assert.ok(gap >= DIM.width, "aucun chevauchement entre conjoints");
  assert.ok(gap < DIM.width * 2, "côte à côte, pas dispersés ailleurs sur la ligne");
});

test("fratrie regroupée — les enfants du même parent restent adjacents, jamais dispersés par un tiers", () => {
  // p a trois enfants (c1,c2,c3) ; q (sans lien) a un enfant (d1) à la même
  // génération : d1 ne doit jamais s'intercaler entre deux enfants de p.
  const ids = ["p", "q", "c1", "c2", "c3", "d1"];
  const children = new Map([["p", ["c1", "c2", "c3"]], ["q", ["d1"]]]);
  const { positions } = computeGenealogyLayout(ids, children, [], dims(ids), anchor);
  const siblingsX = ["c1", "c2", "c3"].map((id) => positions[id].x).sort((a, b) => a - b);
  const dX = positions.d1.x;
  const inRange = dX > siblingsX[0] - 1 && dX < siblingsX[2] + DIM.width + 1;
  assert.equal(inRange, false, "l'enfant de q ne s'intercale pas au milieu de la fratrie de p");
});

test("composants déconnectés — côte à côte, jamais superposés", () => {
  const ids = ["a", "b", "x", "y"];
  const children = new Map([["a", ["b"]], ["x", ["y"]]]);
  const { positions } = computeGenealogyLayout(ids, children, [], dims(ids), anchor);
  // Les deux racines (a, x) doivent être séparées horizontalement d'au
  // moins une largeur de carte — jamais à la même position.
  assert.ok(Math.abs(positions.a.x - positions.x.x) >= DIM.width, "les deux familles ne se superposent pas");
});

test("aucun chevauchement, quel que soit le graphe — grille englobante sans intersection deux à deux", () => {
  const ids = ["gp", "gm", "p1", "p2", "c1", "c2", "c3"];
  const children = new Map([["gp", ["p1"]], ["gm", ["p1"]], ["p1", ["c1", "c2"]], ["p2", ["c1"]], ["p2", ["c1", "c3"]]]);
  const spouseGroups = [["gp", "gm"]];
  const { positions } = computeGenealogyLayout(ids, children, spouseGroups, dims(ids), anchor);
  const boxes = ids.map((id) => ({ id, ...positions[id], w: DIM.width, h: DIM.height }));
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.equal(overlaps(boxes[i], boxes[j]), false, `${boxes[i].id}/${boxes[j].id} se chevauchent`);
    }
  }
});

test("déterministe — même structure, même résultat, indépendant de l'ordre des ids en entrée", () => {
  const ids = ["gp", "gm", "p1", "c1", "c2"];
  const children = new Map([["gp", ["p1"]], ["p1", ["c1", "c2"]]]);
  const spouseGroups = [["gp", "gm"]];
  const r1 = computeGenealogyLayout(ids, children, spouseGroups, dims(ids), anchor);
  const r2 = computeGenealogyLayout([...ids].reverse(), children, spouseGroups, dims(ids), anchor);
  assert.deepEqual(r1, r2);
});

test("conjoints à générations initialement différentes convergent vers la même génération partagée", () => {
  // b n'a pas de parent connu (génération 0 a priori), mais est le conjoint
  // de a, lui-même enfant de gp (génération 1) : b doit rejoindre la
  // génération 1, pas rester à 0.
  const ids = ["gp", "a", "b"];
  const children = new Map([["gp", ["a"]]]);
  const spouseGroups = [["a", "b"]];
  const { positions } = computeGenealogyLayout(ids, children, spouseGroups, dims(ids), anchor);
  assert.equal(positions.a.y, positions.b.y);
  assert.ok(positions.gp.y < positions.a.y);
});

test("relayout complet — appel répété sur la même structure produit exactement les mêmes positions", () => {
  const ids = ["gp", "gm", "p1", "p2", "c1"];
  const children = new Map([["gp", ["p1"]], ["gm", ["p1"]], ["p1", ["c1"]], ["p2", ["c1"]]]);
  const spouseGroups = [["gp", "gm"]];
  const r1 = computeGenealogyLayout(ids, children, spouseGroups, dims(ids), anchor);
  const r2 = computeGenealogyLayout(ids, children, spouseGroups, dims(ids), anchor);
  assert.deepEqual(r1, r2);
});
