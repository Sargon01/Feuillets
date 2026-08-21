import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { AnnotationPopover } from "../src/ui/annotation-popover.js";
import { loadAnnotations, saveAnnotations } from "../src/services/annotations.js";

/* MICRO-CORRECTIF — « annotation créée non visible immédiatement en Continu ».
   Cause : les helpers annotation partagés rafraîchissaient TOUJOURS via
   `this.refreshAnnotationHighlights()` (méthode « fichier actif », qui ne
   reconnaît jamais Continu) au lieu d'un callback explicite fourni par
   l'appelant. Ces tests prouvent : (1) le refresh n'arrive JAMAIS avant la
   persistance réelle, (2) le callback Continu est appelé EXACTEMENT une
   fois par mutation réussie, (3) le MarkdownView natif garde son
   comportement par défaut inchangé (callback optionnel). */

const previousDocument = globalThis.document;
globalThis.document = { body: {} };
test.after(() => {
  globalThis.document = previousDocument;
});

const SCENE_CONTENT = "Il faisait nuit. Le chat dormait tranquillement. Il faisait nuit.";

function fixture() {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const scene = new TFile("Projet/Manuscrit/Scène.md", SCENE_CONTENT);
  volume.children = [root];
  root.parent = volume;
  root.children = [scene];
  scene.parent = root;
  const { vault } = createFakeVault([volume, root, scene]);
  const app = { vault, workspace: { getActiveFile: () => scene } };
  const settings = { projectFolder: root.path };

  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.settings = settings;

  return { app, settings, plugin, scene };
}

function fakeEditor(content, selStart, selEnd, cursorOffset = null) {
  return {
    getValue: () => content,
    somethingSelected: () => selEnd > selStart,
    getCursor: (which) => {
      if (which === "from") return { offset: selStart };
      if (which === "to") return { offset: selEnd };
      return { offset: cursorOffset ?? selEnd };
    },
    posToOffset: (pos) => pos.offset,
  };
}

function captureAnnotationPopover(run) {
  const originalOpen = AnnotationPopover.prototype.open;
  let opened = null;
  AnnotationPopover.prototype.open = function open() {
    opened = this;
    return this;
  };
  return Promise.resolve(run())
    .then(() => opened)
    .finally(() => {
      AnnotationPopover.prototype.open = originalOpen;
    });
}

function refreshSpy() {
  const calls = [];
  const fn = () => {
    calls.push(Date.now());
    return Promise.resolve();
  };
  fn.calls = calls;
  return fn;
}

/* --- §15 — création/mise à jour DIRECTE (style/couleur), sans popover ----- */

test("§15 — applyAnnotationOrUpdate : mutation persistée AVANT le callback, callback appelé EXACTEMENT une fois", async () => {
  const { plugin, app, settings, scene } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  const editor = fakeEditor(SCENE_CONTENT, start, end);
  const onAnnotationChange = refreshSpy();

  const ok = await plugin.applyAnnotationOrUpdate(editor, scene, "highlight", "yellow", onAnnotationChange);

  assert.equal(ok, true);
  assert.equal(onAnnotationChange.calls.length, 1, "callback appelé exactement une fois");
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "la mutation est bien persistée");
});

/* --- §16 — création via POPOVER : le refresh n'arrive jamais avant la persistance --- */

test("§16 — createAnnotationFromSelection : AVANT fermeture du popover, aucune annotation, callback = 0 ; après onSave, persistée + callback = 1", async () => {
  const { plugin, app, settings } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  const editor = fakeEditor(SCENE_CONTENT, start, end);
  const onAnnotationChange = refreshSpy();

  const opened = await captureAnnotationPopover(() =>
    plugin.createAnnotationFromSelection(editor, plugin.app.workspace.getActiveFile(), undefined, onAnnotationChange)
  );
  assert.ok(opened, "le popover de création s'ouvre");

  // AVANT fermeture : rien n'est encore persisté, le callback n'a jamais été appelé.
  let store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 0);
  assert.equal(onAnnotationChange.calls.length, 0);

  await opened.onSave("Belle réplique", "green", "highlight");

  store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "addAnnotation terminé avant le callback");
  assert.equal(onAnnotationChange.calls.length, 1, "callback appelé exactement une fois, après la persistance");
});

/* --- §17 — Escape en création : annule, callback jamais appelé ------------ */

test("§17 — Escape (cancel) en création : aucune annotation créée, callback = 0", async () => {
  const { plugin, app, settings } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  const editor = fakeEditor(SCENE_CONTENT, start, end);
  const onAnnotationChange = refreshSpy();

  const opened = await captureAnnotationPopover(() =>
    plugin.createAnnotationFromSelection(editor, plugin.app.workspace.getActiveFile(), undefined, onAnnotationChange)
  );
  assert.equal(opened.cancelOnEscape, true, "Escape doit annuler en création");

  opened.cancel();

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 0, "aucune annotation créée");
  assert.equal(onAnnotationChange.calls.length, 0, "callback jamais appelé");
});

/* --- §18 — modification (style/couleur/commentaire) ------------------------ */

test("§18 — modification d'une annotation existante : callback appelé exactement une fois APRÈS la mutation", async () => {
  const { plugin, app, settings, scene } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1",
      file: "Scène.md",
      start: 3,
      end: 13,
      quote: "faisait nu",
      prefix: "Il ",
      suffix: "it.",
      text: "",
      color: "yellow",
      style: "highlight",
    }],
  });
  const editor = fakeEditor(SCENE_CONTENT, 3, 13);
  const onAnnotationChange = refreshSpy();

  const ok = await plugin.applyAnnotationOrUpdate(editor, scene, "underline", "blue", onAnnotationChange);

  assert.equal(ok, true);
  assert.equal(onAnnotationChange.calls.length, 1);
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations[0].id, "ann-1", "id conservé (mise à jour, jamais un doublon)");
  assert.equal(store.annotations[0].style, "underline");
  assert.equal(store.annotations[0].color, "blue");
});

/* --- §19 — suppression : callback exactement une fois, comportement intact --- */

test("§19 — suppression via openAnnotationEditor : persistée, callback appelé exactement une fois", async () => {
  const { plugin, app, settings } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1",
      file: "Scène.md",
      start: 3,
      end: 13,
      quote: "faisait nu",
      prefix: "Il ",
      suffix: "it.",
      text: "à retirer",
      color: "pink",
      style: "highlight",
    }],
  });
  plugin.activeEditorAnywhere = () => null;
  const onAnnotationChange = refreshSpy();

  const opened = await captureAnnotationPopover(() => plugin.openAnnotationEditor("ann-1", onAnnotationChange));
  await opened.onDelete();

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 0, "suppression persistée");
  assert.equal(onAnnotationChange.calls.length, 1, "callback appelé exactement une fois, jamais deux");
});

/* --- §20 — MarkdownView natif : callback OPTIONNEL, comportement inchangé --- */

test("§20 — sans callback fourni (MarkdownView natif) : this.refreshAnnotationHighlights() reste appelée exactement une fois", async () => {
  const { plugin, app, settings, scene } = fixture();
  let refreshCalls = 0;
  plugin.refreshAnnotationHighlights = async () => {
    refreshCalls++;
  };
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  const editor = fakeEditor(SCENE_CONTENT, start, end);

  const ok = await plugin.applyAnnotationOrUpdate(editor, scene, "highlight", "yellow"); // pas de 5e argument

  assert.equal(ok, true);
  assert.equal(refreshCalls, 1, "comportement MarkdownView strictement inchangé : un seul refresh, la méthode existante");
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1);
});

test("§20 — createAnnotationFromSelection sans callback : repli sur this.refreshAnnotationHighlights()", async () => {
  const { plugin, app, settings } = fixture();
  let refreshCalls = 0;
  plugin.refreshAnnotationHighlights = async () => {
    refreshCalls++;
  };
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  const editor = fakeEditor(SCENE_CONTENT, start, end);

  const opened = await captureAnnotationPopover(() =>
    plugin.createAnnotationFromSelection(editor, plugin.app.workspace.getActiveFile())
  );
  await opened.onSave("texte", "yellow", "highlight");

  assert.equal(refreshCalls, 1);
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1);
});

/* --- §12 — suppression : jamais de double refresh via le callback générique --- */

test("§12 — un événement métier réussi ne produit jamais plus d'un refresh Continu explicite", async () => {
  const { plugin, app, settings, scene } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  const editor = fakeEditor(SCENE_CONTENT, start, end);
  const onAnnotationChange = refreshSpy();

  await plugin.applyAnnotationOrUpdate(editor, scene, "highlight", "yellow", onAnnotationChange);
  await plugin.applyAnnotationOrUpdate(editor, scene, "underline", "green", onAnnotationChange);

  assert.equal(onAnnotationChange.calls.length, 2, "un appel par mutation réussie, jamais plus");
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "même annotation mise à jour, jamais un doublon");
});
