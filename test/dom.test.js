import test from "node:test";
import assert from "node:assert/strict";
import { MarkdownView } from "obsidian";
import { getActiveFileSafe, highlightActive, isEditing, openFileActivatingWithCursor } from "../src/utils/dom.js";

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

test("openFileActivatingWithCursor : ouvre le fichier, l'active, place le curseur en fin de texte", async () => {
  const calls = [];
  const editor = {
    cursor: null,
    focused: false,
    lastLine: () => 2,
    getLine: (n) => (n === 2 ? "" : "un contenu quelconque"),
    setCursor(pos) { this.cursor = pos; },
    focus() { this.focused = true; },
  };
  const view = Object.assign(new MarkdownView(), { editor });
  const leaf = {
    view,
    async openFile(file, opts) { calls.push(["openFile", file, opts]); },
  };
  const app = {
    workspace: {
      setActiveLeaf(l, opts) { calls.push(["setActiveLeaf", l, opts]); },
    },
  };
  const file = { path: "Scène 1.md" };

  await openFileActivatingWithCursor(app, leaf, file);

  assert.deepEqual(calls, [
    ["openFile", file, { active: true }],
    ["setActiveLeaf", leaf, { focus: true }],
  ]);
  assert.deepEqual(editor.cursor, { line: 2, ch: 0 });
  assert.equal(editor.focused, true);
});

test("openFileActivatingWithCursor : n'exige pas d'éditeur — n'échoue pas sans MarkdownView", async () => {
  const leaf = { view: {}, async openFile() {} };
  const app = { workspace: { setActiveLeaf() {} } };
  await assert.doesNotReject(() => openFileActivatingWithCursor(app, leaf, { path: "x.md" }));
});
