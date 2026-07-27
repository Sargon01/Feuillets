import test from "node:test";
import assert from "node:assert/strict";
import { getActiveFileSafe, highlightActive, isEditing } from "../src/utils/dom.js";

test("highlightActive : nettoie les classes et révèle le chemin actif", () => {
  const active = { classes: [], addClass(name) { this.classes.push(name); }, scrollIntoView() {} };
  const stale = { removed: [], removeClass(name) { this.removed.push(name); } };
  globalThis.CSS = { escape: (value) => value };
  highlightActive({ querySelectorAll(selector) {
    return selector.startsWith("[data-path") ? [active] : [stale];
  } }, "Scene.md");
  assert.deepEqual(stale.removed, ["is-active", "feuillets-dragover", "feuillets-dragging"]);
  assert.deepEqual(active.classes, ["is-active"]);
});

test("isEditing : détecte uniquement les champs actifs contenus dans la vue", () => {
  globalThis.document = { activeElement: { tagName: "TEXTAREA" } };
  assert.equal(isEditing({ contains: () => true }), true);
  globalThis.document.activeElement = { tagName: "DIV" };
  assert.equal(isEditing({ contains: () => true }), false);
});

test("getActiveFileSafe : applique les trois replis du workspace", () => {
  const file = { path: "Scene.md" };
  const workspace = {
    getActiveFile: () => null,
    getMostRecentLeaf: () => ({ view: { file } }),
    getLeavesOfType: () => [],
  };
  assert.equal(getActiveFileSafe({ workspace }), file);
  workspace.getMostRecentLeaf = () => null;
  workspace.getLeavesOfType = () => [{ view: { file } }];
  assert.equal(getActiveFileSafe({ workspace }), file);
});
