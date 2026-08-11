import test from "node:test";
import assert from "node:assert/strict";
import { generatedContentsDescriptor } from "../src/services/generated-contents.js";

test("generatedContentsDescriptor : Sommaire couvre les niveaux 1 à 2", () => {
  assert.deepEqual(generatedContentsDescriptor("summary"), { kind: "summary", title: "Sommaire", minLevel: 1, maxLevel: 2 });
});

test("generatedContentsDescriptor : Table des matières couvre les niveaux 1 à 6", () => {
  assert.deepEqual(generatedContentsDescriptor("toc"), { kind: "toc", title: "Table des matières", minLevel: 1, maxLevel: 6 });
});
