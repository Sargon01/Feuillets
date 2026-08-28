import test from "node:test";
import assert from "node:assert/strict";
import { computeMindmapBranchLayout, computeMindmapTreeLayout } from "../src/carnet/blocks/mindmap/layout.js";

const DIM = { width: 200, height: 80 };

function rectOf(pos, dims) {
  return { left: pos.x, right: pos.x + dims.width, top: pos.y, bottom: pos.y + dims.height };
}
function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

test("parent centré — un parent à 2 enfants est vertically centré sur eux", () => {
  const childrenOf = { root: ["c1", "c2"] };
  const dims = { root: DIM, c1: DIM, c2: DIM };
  const { positions } = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 0, y: 0 });
  const rootCenter = positions.root.y + DIM.height / 2;
  const c1Center = positions.c1.y + DIM.height / 2;
  const c2Center = positions.c2.y + DIM.height / 2;
  assert.ok(Math.abs(rootCenter - (c1Center + c2Center) / 2) < 1e-6);
});

test("branches sans chevauchement — aucun rectangle de nodes ne se recoupe, même profond", () => {
  const childrenOf = {
    root: ["a", "b", "c"],
    a: ["a1", "a2"],
    b: [],
    c: ["c1"],
    a1: ["a1x"],
  };
  const dims = Object.fromEntries(["root", "a", "b", "c", "a1", "a2", "c1", "a1x"].map((id) => [id, DIM]));
  const { positions } = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 0, y: 0 });
  const ids = Object.keys(positions);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const rectA = rectOf(positions[ids[i]], DIM);
      const rectB = rectOf(positions[ids[j]], DIM);
      assert.equal(overlaps(rectA, rectB), false, `${ids[i]} et ${ids[j]} ne doivent jamais se chevaucher`);
    }
  }
});

test("branches gauche/droite — la racine répartit ses enfants directs des deux côtés", () => {
  const childrenOf = { root: ["r1", "r2", "r3", "r4"] };
  const dims = { root: DIM, r1: DIM, r2: DIM, r3: DIM, r4: DIM };
  const { positions } = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 500, y: 0 });
  const rightSide = ["r1", "r3"]; // index pair -> droite
  const leftSide = ["r2", "r4"]; // index impair -> gauche
  for (const id of rightSide) assert.ok(positions[id].x > positions.root.x, `${id} doit être à droite de la racine`);
  for (const id of leftSide) assert.ok(positions[id].x + DIM.width <= positions.root.x, `${id} doit être à gauche de la racine`);
});

test("sous-arbre déplacé comme unité — computeMindmapBranchLayout reproduit la même forme interne quel que soit l'ancrage", () => {
  const childrenOf = { branch: ["b1", "b2"], b1: ["b1x"] };
  const dims = { branch: DIM, b1: DIM, b2: DIM, b1x: DIM };
  const layoutAt = (anchor) => computeMindmapBranchLayout(childrenOf, "branch", dims, anchor, "right");
  const first = layoutAt({ x: 0, y: 0 });
  const second = layoutAt({ x: 1000, y: 500 });
  const dx = 1000; const dy = 500;
  for (const id of Object.keys(first.positions)) {
    assert.ok(Math.abs((second.positions[id].x - first.positions[id].x) - dx) < 1e-6, `${id}.x doit suivre la translation de l'ancre`);
    assert.ok(Math.abs((second.positions[id].y - first.positions[id].y) - dy) < 1e-6, `${id}.y doit suivre la translation de l'ancre`);
  }
});

test("layout déterministe — mêmes entrées, mêmes sorties, toujours", () => {
  const childrenOf = { root: ["a", "b"], a: ["a1", "a2", "a3"] };
  const dims = { root: DIM, a: DIM, b: DIM, a1: DIM, a2: DIM, a3: DIM };
  const first = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 10, y: 20 });
  const second = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 10, y: 20 });
  assert.deepEqual(first, second);
});

test("edgeSides — un enfant à droite pointe fromSide right/toSide left, et inversement à gauche", () => {
  const childrenOf = { root: ["r1", "r2"] };
  const dims = { root: DIM, r1: DIM, r2: DIM };
  const { edgeSides } = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 0, y: 0 });
  assert.deepEqual(edgeSides["root->r1"], { fromSide: "right", toSide: "left" });
  assert.deepEqual(edgeSides["root->r2"], { fromSide: "left", toSide: "right" });
});

/* ================================================================
 * ORIENTATION (Correctif Prompt 2 — layout.ts, un seul moteur paramétré)
 * ================================================================ */

test("orientation — absence de paramètre = horizontal, comportement historique inchangé", () => {
  const childrenOf = { root: ["r1", "r2"] };
  const dims = { root: DIM, r1: DIM, r2: DIM };
  const withoutOrientation = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 0, y: 0 });
  const explicitHorizontal = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 0, y: 0 }, "horizontal");
  assert.deepEqual(withoutOrientation, explicitHorizontal);
});

test("orientation verticale — la racine se place au-dessus, les enfants en dessous", () => {
  const childrenOf = { root: ["r1"] };
  const dims = { root: DIM, r1: DIM };
  const { positions } = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 0, y: 0 }, "vertical");
  assert.ok(positions.r1.y > positions.root.y, "l'enfant est en dessous de la racine, jamais à côté");
});

test("orientation verticale — parent centré sur ses enfants (axe transverse = X)", () => {
  const childrenOf = { root: ["a"], a: ["a1", "a2"] };
  const dims = { root: DIM, a: DIM, a1: DIM, a2: DIM };
  const { positions } = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 0, y: 0 }, "vertical");
  const centerA = positions.a.x + DIM.width / 2;
  const centerA1 = positions.a1.x + DIM.width / 2;
  const centerA2 = positions.a2.x + DIM.width / 2;
  assert.ok(Math.abs(centerA - (centerA1 + centerA2) / 2) < 1e-6);
});

test("orientation verticale — aucun chevauchement, dimensions réelles prises en compte", () => {
  const childrenOf = { root: ["a", "b"], a: ["a1", "a2"] };
  const dims = { root: DIM, a: DIM, b: DIM, a1: DIM, a2: DIM };
  const { positions } = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 0, y: 0 }, "vertical");
  const ids = Object.keys(positions);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const rectA = rectOf(positions[ids[i]], DIM);
      const rectB = rectOf(positions[ids[j]], DIM);
      assert.equal(overlaps(rectA, rectB), false, `${ids[i]}/${ids[j]} ne doivent jamais se chevaucher en vertical`);
    }
  }
});

test("orientation verticale — côtés top/bottom, jamais left/right", () => {
  const childrenOf = { root: ["r1", "r2"] };
  const dims = { root: DIM, r1: DIM, r2: DIM };
  const { edgeSides } = computeMindmapTreeLayout(childrenOf, "root", dims, { x: 0, y: 0 }, "vertical");
  for (const sides of Object.values(edgeSides)) {
    assert.ok(["top", "bottom"].includes(sides.fromSide));
    assert.ok(["top", "bottom"].includes(sides.toSide));
  }
});

test("orientation — computeMindmapBranchLayout respecte aussi l'orientation transmise", () => {
  const childrenOf = { branch: ["b1"] };
  const dims = { branch: DIM, b1: DIM };
  const { positions, edgeSides } = computeMindmapBranchLayout(childrenOf, "branch", dims, { x: 0, y: 0 }, "right", "vertical");
  assert.ok(positions.b1.y > positions.branch.y);
  assert.deepEqual(edgeSides["branch->b1"], { fromSide: "bottom", toSide: "top" });
});
