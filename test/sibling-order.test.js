import test from "node:test";
import assert from "node:assert/strict";
import { orderFromSnapshot } from "../src/utils/sibling-order.js";

const noms = (list) => list.map((c) => c.name);
const enfants = (...names) => names.map((name) => ({ name }));

test("orderFromSnapshot : rétablit l'ordre de l'instantané", () => {
  const current = enfants("c", "a", "b");
  assert.deepEqual(noms(orderFromSnapshot(current, ["a", "b", "c"])), ["a", "b", "c"]);
});

test("orderFromSnapshot : ignore un nom de l'instantané qui n'existe plus", () => {
  const current = enfants("a", "c");
  assert.deepEqual(noms(orderFromSnapshot(current, ["a", "b", "c"])), ["a", "c"]);
});

test("orderFromSnapshot : conserve un enfant apparu depuis, en fin de liste", () => {
  const current = enfants("a", "b", "nouveau");
  assert.deepEqual(noms(orderFromSnapshot(current, ["b", "a"])), ["b", "a", "nouveau"]);
});

test("orderFromSnapshot : renvoie exactement les éléments reçus", () => {
  const current = enfants("a", "b", "c");
  const sorti = orderFromSnapshot(current, ["c"]);
  assert.equal(sorti.length, current.length);
  for (const c of current) assert.ok(sorti.includes(c), `${c.name} manquant`);
});

test("orderFromSnapshot : un nom répété dans l'instantané n'insère pas de doublon", () => {
  const current = enfants("a", "b");
  assert.deepEqual(noms(orderFromSnapshot(current, ["a", "a", "b"])), ["a", "b"]);
});

test("orderFromSnapshot : instantané vide conserve l'ordre courant", () => {
  const current = enfants("a", "b", "c");
  assert.deepEqual(noms(orderFromSnapshot(current, [])), ["a", "b", "c"]);
});

test("orderFromSnapshot : dossier vide", () => {
  assert.deepEqual(orderFromSnapshot([], ["a", "b"]), []);
});

test("orderFromSnapshot : les enfants ajoutés gardent leur ordre relatif", () => {
  const current = enfants("n1", "a", "n2");
  assert.deepEqual(noms(orderFromSnapshot(current, ["a"])), ["a", "n1", "n2"]);
});
