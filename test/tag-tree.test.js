import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTagTree, collectFiles, sortTagNodes } from "../src/utils/tag-tree.js";

test("buildTagTree", async (t) => {
  await t.test("construit des tags plats sans imbrication", () => {
    const tree = buildTagTree([
      { path: "a.md", tags: ["derviche"] },
      { path: "b.md", tags: ["derviche", "deli"] },
    ]);
    assert.equal(tree.size, 2);
    assert.deepEqual([...tree.get("derviche").files].sort(), ["a.md", "b.md"]);
    assert.deepEqual([...tree.get("deli").files], ["b.md"]);
  });

  await t.test("construit un tag imbriqué en arbre", () => {
    const tree = buildTagTree([{ path: "a.md", tags: ["parent/enfant"] }]);
    assert.equal(tree.size, 1);
    const parent = tree.get("parent");
    assert.equal(parent.fullPath, "parent");
    assert.equal(parent.files.size, 0); // rien tagué "parent" exactement
    const enfant = parent.children.get("enfant");
    assert.equal(enfant.fullPath, "parent/enfant");
    assert.deepEqual([...enfant.files], ["a.md"]);
  });

  await t.test("un fichier peut porter le parent ET l'enfant", () => {
    const tree = buildTagTree([
      { path: "a.md", tags: ["parent", "parent/enfant"] },
    ]);
    const parent = tree.get("parent");
    assert.deepEqual([...parent.files], ["a.md"]);
    assert.deepEqual([...parent.children.get("enfant").files], ["a.md"]);
  });

  await t.test("ignore les tags vides", () => {
    const tree = buildTagTree([{ path: "a.md", tags: ["", "  "] }]);
    assert.equal(tree.size, 0);
  });
});

test("collectFiles", async (t) => {
  await t.test("agrège les fichiers du nœud et de ses descendants sans doublon", () => {
    const tree = buildTagTree([
      { path: "a.md", tags: ["parent"] },
      { path: "a.md", tags: ["parent/enfant"] }, // même fichier, deux tags
      { path: "b.md", tags: ["parent/enfant"] },
    ]);
    const parent = tree.get("parent");
    const files = collectFiles(parent);
    assert.equal(files.size, 2);
    assert.ok(files.has("a.md"));
    assert.ok(files.has("b.md"));
  });

  await t.test("un nœud feuille ne retourne que ses propres fichiers", () => {
    const tree = buildTagTree([{ path: "a.md", tags: ["solo"] }]);
    assert.deepEqual([...collectFiles(tree.get("solo"))], ["a.md"]);
  });
});

test("sortTagNodes", async (t) => {
  await t.test("trie alphabétiquement (fr)", () => {
    const tree = buildTagTree([
      { path: "a.md", tags: ["zebre"] },
      { path: "b.md", tags: ["ecole"] },
      { path: "c.md", tags: ["arbre"] },
    ]);
    const names = sortTagNodes(tree).map((n) => n.name);
    assert.deepEqual(names, ["arbre", "ecole", "zebre"]);
  });
});
