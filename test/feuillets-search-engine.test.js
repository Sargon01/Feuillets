import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FeuilletsSearchEngine } from "../src/services/feuillets-search-engine.js";

describe("FeuilletsSearchEngine — buildRegex", () => {
  it("construit une regex valide avec options par défaut", () => {
    const regex = FeuilletsSearchEngine.buildRegex("Kemal", { ignoreCase: true });
    assert.ok(regex instanceof RegExp);
    assert.equal(regex.flags, "gi");
  });

  it("gère l'insensibilité aux diacritiques (accents)", () => {
    const regex = FeuilletsSearchEngine.buildRegex("heros", { ignoreDiacritics: true });
    regex.lastIndex = 0;
    assert.ok(regex.test("Héros"));
    regex.lastIndex = 0;
    assert.ok(regex.test("heros"));
  });

  it("gère le mode de correspondance mot entier (wholeWord)", () => {
    const regex = FeuilletsSearchEngine.buildRegex("Kemal", { matchMode: "wholeWord" });
    regex.lastIndex = 0;
    assert.ok(regex.test("Le héros Kemal s'avança"));
    regex.lastIndex = 0;
    assert.equal(regex.test("Kemalite"), false);
  });
});

describe("FeuilletsSearchEngine — getScopedFiles", () => {
  it("filtre strictement le document actif si scope = document", () => {
    const activeFile = { path: "Scene1.md", extension: "md" };
    const files = FeuilletsSearchEngine.getScopedFiles({}, {}, "document", activeFile);
    assert.deepEqual(files, [activeFile]);
  });

  it("filtre le dossier parent du document actif si scope = manuscript", () => {
    const file1 = { path: "Folder/Scene1.md", extension: "md" };
    const file2 = { path: "Folder/Scene2.md", extension: "md" };
    const notMd = { path: "Folder/snapshot.png", extension: "png" };
    const parentFolder = { children: [file1, file2, notMd] };
    file1.parent = parentFolder;

    const files = FeuilletsSearchEngine.getScopedFiles({}, {}, "manuscript", file1);
    assert.deepEqual(files, [file1, file2]);
  });
});
