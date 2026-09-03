import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGenealogy } from "../src/carnet/blocks/genealogy/index.js";

function person(id, relations = {}) {
  return {
    id,
    filePath: `${id}.md`,
    displayName: id,
    ...relations,
  };
}

function onePerson(result, id) {
  return result.graph.persons.find((candidate) => candidate.id === id);
}

function diagnostic(result, code) {
  return result.diagnostics.find((entry) => entry.code === code);
}

test("personne seule : graphe normalisé complet", () => {
  const result = normalizeGenealogy([person("a")]);
  assert.deepEqual(result.graph.persons, [{ id: "a", filePath: "a.md", displayName: "a", parentIds: [], spouseIds: [], childIds: [] }]);
  assert.deepEqual(result.graph.unions, []);
  assert.deepEqual(result.diagnostics, []);
});

test("conjoint déclaré dans un seul sens : relation symétrique et union stable", () => {
  const result = normalizeGenealogy([person("b"), person("a", { spouseIds: ["b"] })]);
  assert.deepEqual(onePerson(result, "a")?.spouseIds, ["b"]);
  assert.deepEqual(onePerson(result, "b")?.spouseIds, ["a"]);
  assert.deepEqual(result.graph.unions, [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: [], sources: ["spouse"] }]);
});

test("IDs Unicode distincts restent distincts dans une union de conjoints", () => {
  const composed = "é";
  const decomposed = "e\u0301";
  const result = normalizeGenealogy([
    person(composed, { spouseIds: [decomposed] }),
    person(decomposed),
  ]);

  assert.equal(result.graph.persons.length, 2);
  assert.deepEqual(onePerson(result, composed)?.spouseIds, [decomposed]);
  assert.deepEqual(onePerson(result, decomposed)?.spouseIds, [composed]);
  assert.deepEqual(result.graph.unions, [{
    id: `union:${encodeURIComponent(decomposed)}|${encodeURIComponent(composed)}`,
    partnerIds: [decomposed, composed],
    childIds: [],
    sources: ["spouse"],
  }]);
});

test("les IDs contenant une barre verticale sont encodés dans l'ID d'union", () => {
  const result = normalizeGenealogy([
    person("a|b", { spouseIds: ["c"] }),
    person("c"),
  ]);

  assert.deepEqual(result.graph.unions, [{
    id: `union:${encodeURIComponent("a|b")}|${encodeURIComponent("c")}`,
    partnerIds: ["a|b", "c"],
    childIds: [],
    sources: ["spouse"],
  }]);
});

test("deux parents explicites : enfants inverses et union de parenté", () => {
  const result = normalizeGenealogy([
    person("child", { parentIds: ["b", "a"] }),
    person("a"),
    person("b"),
  ]);
  assert.deepEqual(onePerson(result, "child")?.parentIds, ["a", "b"]);
  assert.deepEqual(onePerson(result, "a")?.childIds, ["child"]);
  assert.deepEqual(onePerson(result, "b")?.childIds, ["child"]);
  assert.deepEqual(result.graph.unions, [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: ["child"], sources: ["parentage"] }]);
});

test("conjoints également parents : une union fusionnée", () => {
  const result = normalizeGenealogy([
    person("a", { spouseIds: ["b"] }),
    person("b"),
    person("c", { parentIds: ["a", "b"] }),
  ]);
  assert.deepEqual(result.graph.unions, [{ id: "union:a|b", partnerIds: ["a", "b"], childIds: ["c"], sources: ["spouse", "parentage"] }]);
});

test("fallback legacy simple et deux parents legacy", () => {
  const result = normalizeGenealogy([
    person("p1", { legacyChildIds: ["c"] }),
    person("p2", { legacyChildIds: ["c"] }),
    person("c"),
  ]);
  assert.deepEqual(onePerson(result, "c")?.parentIds, ["p1", "p2"]);
  assert.deepEqual(onePerson(result, "p1")?.childIds, ["c"]);
  assert.deepEqual(onePerson(result, "p2")?.childIds, ["c"]);
});

test("legacy est ignoré en présence d'un parent explicite et diagnostique le conflit", () => {
  const result = normalizeGenealogy([
    person("p1"),
    person("p2", { legacyChildIds: ["c"] }),
    person("c", { parentIds: ["p1"] }),
  ]);
  assert.deepEqual(onePerson(result, "c")?.parentIds, ["p1"]);
  assert.deepEqual(diagnostic(result, "legacy-child-conflict"), { severity: "warning", code: "legacy-child-conflict", personId: "p2", relatedPersonId: "c" });
});

test("références inconnues et auto-relations sont nettoyées avec diagnostics", () => {
  const result = normalizeGenealogy([person("a", { parentIds: ["a", "x"], spouseIds: ["a", "x"], legacyChildIds: ["a", "x"] })]);
  assert.deepEqual(onePerson(result, "a")?.parentIds, []);
  assert.deepEqual(onePerson(result, "a")?.spouseIds, []);
  assert.deepEqual(result.diagnostics.map((entry) => entry.code), ["self-legacy-child", "self-parent", "self-spouse", "unknown-legacy-child", "unknown-parent", "unknown-spouse"]);
});

test("doublons de relations ne dupliquent ni relations ni enfants", () => {
  const result = normalizeGenealogy([
    person("a", { spouseIds: ["b", "b"] }),
    person("b"),
    person("c", { parentIds: ["a", "a", "b"] }),
  ]);
  assert.deepEqual(onePerson(result, "c")?.parentIds, ["a", "b"]);
  assert.deepEqual(onePerson(result, "a")?.childIds, ["c"]);
  assert.equal(result.graph.unions.length, 1);
});

test("plus de deux parents : toutes les relations sont conservées", () => {
  const result = normalizeGenealogy([
    person("c", { parentIds: ["d", "b", "a"] }),
    person("a"), person("b"), person("d"),
  ]);
  assert.deepEqual(onePerson(result, "c")?.parentIds, ["a", "b", "d"]);
  assert.deepEqual(diagnostic(result, "more-than-two-parents"), { severity: "warning", code: "more-than-two-parents", personId: "c" });
  assert.deepEqual(result.graph.unions[0].partnerIds, ["a", "b", "d"]);
});

test("cycles simples et longs sont détectés sans supprimer les relations", () => {
  const simple = normalizeGenealogy([person("a", { parentIds: ["b"] }), person("b", { parentIds: ["a"] })]);
  const long = normalizeGenealogy([
    person("a", { parentIds: ["b"] }), person("b", { parentIds: ["c"] }), person("c", { parentIds: ["a"] }),
  ]);
  assert.equal(simple.diagnostics.filter((entry) => entry.code === "ancestry-cycle").length, 1);
  assert.equal(long.diagnostics.filter((entry) => entry.code === "ancestry-cycle").length, 1);
  assert.deepEqual(onePerson(long, "a")?.parentIds, ["b"]);
});

test("ID vide et ID dupliqué : première entrée conservée", () => {
  const result = normalizeGenealogy([person(""), person("a", { displayName: "first" }), person("a", { displayName: "second" })]);
  assert.equal(result.graph.persons.length, 1);
  assert.equal(onePerson(result, "a")?.displayName, "first");
  assert.equal(result.diagnostics.filter((entry) => entry.code === "invalid-person-id").length, 1);
  assert.deepEqual(diagnostic(result, "duplicate-person-id"), { severity: "error", code: "duplicate-person-id", personId: "a" });
});

test("coparents non conjoints et parent singleton restent distincts", () => {
  const result = normalizeGenealogy([person("a"), person("b"), person("c", { parentIds: ["a", "b"] }), person("d", { parentIds: ["a"] })]);
  assert.deepEqual(onePerson(result, "a")?.spouseIds, []);
  assert.deepEqual(result.graph.unions, [
    { id: "union:a", partnerIds: ["a"], childIds: ["d"], sources: ["parentage"] },
    { id: "union:a|b", partnerIds: ["a", "b"], childIds: ["c"], sources: ["parentage"] },
  ]);
});

test("les enfants finaux sont uniquement l'inverse des parents normalisés", () => {
  const result = normalizeGenealogy([person("p", { legacyChildIds: ["c"] }), person("c")]);
  assert.deepEqual(onePerson(result, "p")?.childIds, ["c"]);
  assert.deepEqual(onePerson(result, "c")?.childIds, []);
});

test("sortie déterministe et entrées immuables", () => {
  const inputs = [person("b", { spouseIds: ["a"], legacyChildIds: ["c"] }), person("c"), person("a")];
  const snapshot = JSON.parse(JSON.stringify(inputs));
  const first = normalizeGenealogy(inputs);
  const second = normalizeGenealogy([inputs[2], inputs[0], inputs[1]]);
  assert.deepEqual(inputs, snapshot);
  assert.deepEqual(first, second);
});

test("legacy vers un enfant inconnu est ignoré", () => {
  const result = normalizeGenealogy([person("p", { legacyChildIds: ["missing"] })]);
  assert.deepEqual(result.graph.persons[0].childIds, []);
  assert.deepEqual(diagnostic(result, "unknown-legacy-child"), { severity: "warning", code: "unknown-legacy-child", personId: "p", relatedPersonId: "missing" });
});

test("une auto-parenté legacy est ignorée", () => {
  const result = normalizeGenealogy([person("p", { legacyChildIds: ["p"] })]);
  assert.deepEqual(onePerson(result, "p")?.parentIds, []);
  assert.deepEqual(diagnostic(result, "self-legacy-child"), { severity: "error", code: "self-legacy-child", personId: "p", relatedPersonId: "p" });
});

test("un conjoint inconnu est ignoré", () => {
  const result = normalizeGenealogy([person("p", { spouseIds: ["missing"] })]);
  assert.deepEqual(onePerson(result, "p")?.spouseIds, []);
  assert.deepEqual(diagnostic(result, "unknown-spouse"), { severity: "warning", code: "unknown-spouse", personId: "p", relatedPersonId: "missing" });
});

test("une auto-conjugalité est ignorée", () => {
  const result = normalizeGenealogy([person("p", { spouseIds: ["p"] })]);
  assert.deepEqual(onePerson(result, "p")?.spouseIds, []);
  assert.deepEqual(diagnostic(result, "self-spouse"), { severity: "error", code: "self-spouse", personId: "p", relatedPersonId: "p" });
});

test("une paire de conjoints ne dépend ni de l'ordre des personnes ni du sens", () => {
  const first = normalizeGenealogy([person("a", { spouseIds: ["b"] }), person("b")]);
  const second = normalizeGenealogy([person("b", { spouseIds: ["a"] }), person("a")]);
  assert.deepEqual(first.graph.unions, second.graph.unions);
  assert.deepEqual(first.graph.persons.map((entry) => entry.spouseIds), second.graph.persons.map((entry) => entry.spouseIds));
});

test("les métadonnées d'affichage sont conservées sans participer aux relations", () => {
  const result = normalizeGenealogy([person("opaque-id", {
    filePath: "Famille/Derviş.md",
    displayName: "Derviş Yalçın",
    firstName: "Derviş",
    lastName: "Yalçın",
    birth: "1900",
    death: "1980",
  })]);
  assert.deepEqual(onePerson(result, "opaque-id"), {
    id: "opaque-id",
    filePath: "Famille/Derviş.md",
    displayName: "Derviş Yalçın",
    firstName: "Derviş",
    lastName: "Yalçın",
    birth: "1900",
    death: "1980",
    parentIds: [],
    spouseIds: [],
    childIds: [],
  });
});
