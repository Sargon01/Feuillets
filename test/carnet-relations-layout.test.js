import test from "node:test";
import assert from "node:assert/strict";
import { computeRelationsLayout } from "../src/carnet/blocks/relations/layout.js";

test("computeRelationsLayout — aucun membre, positions vides", () => {
  assert.deepEqual(computeRelationsLayout([], {}, { x: 0, y: 0 }), { positions: {} });
});

test("computeRelationsLayout — un seul membre, centré exactement sur l'ancre", () => {
  const result = computeRelationsLayout(["only"], { only: { width: 200, height: 100 } }, { x: 500, y: 500 });
  assert.deepEqual(result.positions.only, { x: 500 - 100, y: 500 - 50 });
});

test("computeRelationsLayout — déterministe : même entrée, même sortie, indépendant de l'ordre du tableau", () => {
  const dims = { a: { width: 200, height: 80 }, b: { width: 200, height: 80 }, c: { width: 200, height: 80 } };
  const anchor = { x: 0, y: 0 };
  const r1 = computeRelationsLayout(["a", "b", "c"], dims, anchor);
  const r2 = computeRelationsLayout(["c", "a", "b"], dims, anchor);
  const r3 = computeRelationsLayout(["b", "c", "a"], dims, anchor);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1, r3);
});

test("computeRelationsLayout — aucun chevauchement entre membres (bounding boxes disjointes)", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const dims = Object.fromEntries(ids.map((id) => [id, { width: 220, height: 90 }]));
  const { positions } = computeRelationsLayout(ids, dims, { x: 0, y: 0 });
  const boxes = ids.map((id) => ({ id, ...positions[id], w: dims[id].width, h: dims[id].height }));
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.equal(overlaps(boxes[i], boxes[j]), false, `${boxes[i].id} et ${boxes[j].id} se chevauchent`);
    }
  }
});

test("computeRelationsLayout — repli sur des dimensions par défaut pour un id absent de la table", () => {
  const result = computeRelationsLayout(["a", "b"], { a: { width: 100, height: 50 } }, { x: 0, y: 0 });
  assert.ok(result.positions.b, "b reçoit quand même une position, via le repli interne");
});
