import { test } from "node:test";
import assert from "node:assert/strict";
import { oneOf, arcsOf, personnagesOf, filsOf } from "../src/utils/arc-fields.js";

test("oneOf", async (t) => {
  await t.test("retourne une string telle quelle", () => {
    assert.equal(oneOf("Derviche"), "Derviche");
  });

  await t.test("prend le premier élément d'une liste à un élément", () => {
    assert.equal(oneOf(["Kali"]), "Kali");
  });

  await t.test("retourne une chaîne vide pour une valeur absente", () => {
    assert.equal(oneOf(undefined), "");
    assert.equal(oneOf(""), "");
  });

  await t.test("retire les espaces superflus", () => {
    assert.equal(oneOf("  Derviche  "), "Derviche");
  });
});

test("arcsOf", async (t) => {
  await t.test("combine arc et arc_secondaire", () => {
    assert.deepEqual(arcsOf({ arc: "Derviche", arc_secondaire: "Palais" }), [
      "Derviche",
      "Palais",
    ]);
  });

  await t.test("tolère arc en liste YAML à un élément", () => {
    assert.deepEqual(arcsOf({ arc: ["Kali"], arc_secondaire: "gitans" }), [
      "Kali",
      "gitans",
    ]);
  });

  await t.test("retourne une liste vide sans aucun champ", () => {
    assert.deepEqual(arcsOf({}), []);
  });

  await t.test("ignore arc_secondaire absent", () => {
    assert.deepEqual(arcsOf({ arc: "Derviche" }), ["Derviche"]);
  });

  await t.test("lit la clé du mode (ex. argument) plutôt que arc", () => {
    assert.deepEqual(
      arcsOf(
        { argument: "Thèse principale", argument_secondaire: "Contre-exemple" },
        { arc: "argument" }
      ),
      ["Thèse principale", "Contre-exemple"]
    );
  });

  await t.test("clé du mode absente : replie sur arc/arc_secondaire", () => {
    assert.deepEqual(
      arcsOf({ arc: "Derviche" }, { arc: "argument" }),
      ["Derviche"]
    );
  });

  await t.test("clé du mode prioritaire si les deux sont présentes", () => {
    assert.deepEqual(
      arcsOf({ arc: "Legacy", argument: "Actuel" }, { arc: "argument" }),
      ["Actuel"]
    );
  });
});

test("personnagesOf", async (t) => {
  await t.test("retourne une liste telle quelle", () => {
    assert.deepEqual(personnagesOf({ personnages: ["Boran", "Zemfira"] }), [
      "Boran",
      "Zemfira",
    ]);
  });

  await t.test("tolère une valeur unique en string", () => {
    assert.deepEqual(personnagesOf({ personnages: "Boran" }), ["Boran"]);
  });

  await t.test("retourne une liste vide sans champ", () => {
    assert.deepEqual(personnagesOf({}), []);
  });

  await t.test("filtre les entrées vides d'une liste", () => {
    assert.deepEqual(personnagesOf({ personnages: ["Boran", "", null] }), ["Boran"]);
  });
});

test("filsOf", async (t) => {
  await t.test("retourne une liste telle quelle", () => {
    assert.deepEqual(filsOf({ fil: ["indice", "lettre-volee"] }), ["indice", "lettre-volee"]);
  });

  await t.test("une seule valeur en string devient une liste à un élément", () => {
    assert.deepEqual(filsOf({ fil: "indice" }), ["indice"]);
  });

  await t.test("sépare uniquement sur la virgule, jamais sur l'espace", () => {
    assert.deepEqual(filsOf({ fil: "plante l'indice ici" }), ["plante l'indice ici"]);
  });

  await t.test("plusieurs valeurs séparées par des virgules", () => {
    assert.deepEqual(filsOf({ fil: "indice, lettre-volee" }), ["indice", "lettre-volee"]);
  });

  await t.test("retourne une liste vide sans champ", () => {
    assert.deepEqual(filsOf({}), []);
  });

  await t.test("filtre les entrées vides", () => {
    assert.deepEqual(filsOf({ fil: ["indice", "", null] }), ["indice"]);
  });
});
