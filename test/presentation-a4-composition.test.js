import test from "node:test";
import assert from "node:assert/strict";
import {
  A4_GRID_2_PER_PAGE,
  A4_GRID_4_PER_PAGE,
  chunkIntoPages,
  slotsPerPage,
} from "../src/services/presentation-a4-composition.js";

/* Couche de pagination papier PARTAGÉE (Support + Plan) — testée ici en
   isolation, sans DOM : seul le découpage/la grille sont purs. La géométrie
   DOM produite est vérifiée de bout en bout dans
   test/presentation-pdf-export.test.js. */

test("slotsPerPage : 4/page est une vraie matrice 2×2, 2/page une colonne de 2", () => {
  assert.equal(slotsPerPage(A4_GRID_4_PER_PAGE), 4);
  assert.deepEqual(A4_GRID_4_PER_PAGE, { columns: 2, rows: 2 });
  assert.equal(slotsPerPage(A4_GRID_2_PER_PAGE), 2);
  assert.deepEqual(A4_GRID_2_PER_PAGE, { columns: 1, rows: 2 });
});

test("chunkIntoPages : découpage FIXE, dernière page incomplète conservée telle quelle", () => {
  assert.deepEqual(chunkIntoPages([0, 1, 2, 3, 4, 5], 4), [[0, 1, 2, 3], [4, 5]]);
  assert.deepEqual(chunkIntoPages([0, 1, 2, 3], 4), [[0, 1, 2, 3]]);
  assert.deepEqual(chunkIntoPages([0], 4), [[0]]);
  assert.deepEqual(chunkIntoPages([0, 1, 2], 2), [[0, 1], [2]]);
});

test("chunkIntoPages : entrée vide ou densité invalide → aucune page, jamais une exception", () => {
  assert.deepEqual(chunkIntoPages([], 4), []);
  assert.deepEqual(chunkIntoPages([0, 1], 0), []);
  assert.deepEqual(chunkIntoPages([0, 1], -2), []);
});
