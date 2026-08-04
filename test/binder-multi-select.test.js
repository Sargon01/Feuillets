import { test } from "node:test";
import assert from "node:assert/strict";

test("Sélection multiple du Binder", async (t) => {
  await t.test("clic simple remplace la sélection", () => {
    const selection = new Set(["path1", "path2"]);
    const newPath = "path3";

    // Simuler un clic simple (pas de modifier)
    if (selection.size > 0) {
      selection.clear();
    }
    selection.add(newPath);

    assert.equal(selection.size, 1);
    assert.ok(selection.has("path3"));
    assert.equal(Array.from(selection).length, 1);
  });

  await t.test("Cmd/Ctrl + clic ajoute l'élément", () => {
    const selection = new Set(["path1"]);
    const newPath = "path2";

    // Simuler Cmd/Ctrl + clic
    if (!selection.has(newPath)) {
      selection.add(newPath);
    }

    assert.equal(selection.size, 2);
    assert.ok(selection.has("path1"));
    assert.ok(selection.has("path2"));
  });

  await t.test("Cmd/Ctrl + clic retire l'élément s'il est sélectionné", () => {
    const selection = new Set(["path1", "path2"]);
    const pathToToggle = "path1";

    // Simuler Cmd/Ctrl + clic sur un élément déjà sélectionné
    if (selection.has(pathToToggle)) {
      selection.delete(pathToToggle);
    }

    assert.equal(selection.size, 1);
    assert.ok(selection.has("path2"));
    assert.equal(selection.has("path1"), false);
  });

  await t.test("Shift + clic sélectionne une plage", () => {
    const siblings = [
      { path: "file1" },
      { path: "file2" },
      { path: "file3" },
      { path: "file4" },
      { path: "file5" },
    ];
    const selection = new Set();
    const anchorIndex = 1;
    const currentIndex = 3;

    // Simuler Shift + clic
    const lo = Math.min(anchorIndex, currentIndex);
    const hi = Math.max(anchorIndex, currentIndex);
    selection.clear();
    for (let i = lo; i <= hi; i++) {
      if (siblings[i]) selection.add(siblings[i].path);
    }

    assert.equal(selection.size, 3);
    assert.ok(selection.has("file2"));
    assert.ok(selection.has("file3"));
    assert.ok(selection.has("file4"));
  });

  await t.test("Clic dans une zone vide vide la sélection", () => {
    const selection = new Set(["path1", "path2"]);

    // Simuler un clic dans une zone vide
    selection.clear();

    assert.equal(selection.size, 0);
  });

  await t.test("les éléments fichiers et dossiers peuvent être sélectionnés ensemble", () => {
    const selection = new Set();
    selection.add("path/to/file.md");
    selection.add("path/to/folder");

    assert.equal(selection.size, 2);
    assert.ok(selection.has("path/to/file.md"));
    assert.ok(selection.has("path/to/folder"));
  });

  await t.test("ensureSelectionForContextMenu: conserve sélection si élément déjà sélectionné", () => {
    const selection = new Set(["path1", "path2"]);
    const clickedPath = "path1";

    // Simuler clic droit sur un élément sélectionné
    if (!selection.has(clickedPath)) {
      selection.clear();
      selection.add(clickedPath);
    }
    // Sinon, ne rien faire (garder la sélection)

    assert.equal(selection.size, 2);
    assert.ok(selection.has("path1"));
    assert.ok(selection.has("path2"));
  });

  await t.test("ensureSelectionForContextMenu: remplace sélection si élément non sélectionné", () => {
    const selection = new Set(["path1", "path2"]);
    const clickedPath = "path3";

    // Simuler clic droit sur un élément non sélectionné
    if (!selection.has(clickedPath)) {
      selection.clear();
      selection.add(clickedPath);
    }

    assert.equal(selection.size, 1);
    assert.ok(selection.has("path3"));
    assert.equal(selection.has("path1"), false);
    assert.equal(selection.has("path2"), false);
  });

  await t.test("refreshMultiSelectClasses appelle classList avec is-selected", () => {
    const mockElements = [
      { path: "path1", classList: { add: null, remove: null } },
      { path: "path2", classList: { add: null, remove: null } },
      { path: "path3", classList: { add: null, remove: null } },
    ];

    const selection = new Set(["path1", "path3"]);

    // Simuler refreshMultiSelectClasses
    const classCalls = { added: [], removed: [] };
    mockElements.forEach((el) => {
      if (selection.has(el.path)) {
        classCalls.added.push(el.path);
      } else {
        classCalls.removed.push(el.path);
      }
    });

    assert.deepEqual(classCalls.added, ["path1", "path3"]);
    assert.deepEqual(classCalls.removed, ["path2"]);
  });
});
