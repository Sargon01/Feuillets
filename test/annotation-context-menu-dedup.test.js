import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { AnnotationEditorController } from "../src/services/annotation-editor-controller.js";
import { annotationHighlightField, applyAnnotationHighlights } from "../src/utils/cm-annotation-highlighter.js";
import { AnnotationPopover } from "../src/ui/annotation-popover.js";
import { loadAnnotations, saveAnnotations } from "../src/services/annotations.js";
import { t } from "../src/i18n/index.js";

/* CORRECTIF FINAL — « le clic droit ne doit jamais créer/empiler une
   annotation » + désengorgement de main.ts.

   Ce fichier teste directement `AnnotationEditorController` (voir
   src/services/annotation-editor-controller.ts), propriétaire de la
   logique annotation depuis ce chantier — plus `main.ts`/un cache miroir.

   Le contexte du menu (existing/selection/none) est désormais résolu en
   LISANT le `annotationHighlightField` déjà monté (StateField CodeMirror,
   voir utils/cm-annotation-highlighter.ts#annotationIdAtOffset/
   annotationIdForExactRange) — jamais `annotations.json`, jamais de cache.
   Les fixtures ci-dessous construisent donc un faux EditorView dont
   `state.field(annotationHighlightField, false)` renvoie un VRAI
   DecorationSet (produit par `applyAnnotationHighlights`, le même
   StateEffect qu'en production), pour exercer le vrai chemin de lecture —
   pas un mock de complaisance. */

const previousDocument = globalThis.document;
globalThis.document = { body: {} };
test.after(() => {
  globalThis.document = previousDocument;
});

const SCENE_CONTENT = "Il faisait nuit. Le chat dormait tranquillement. Il faisait nuit.";
const QUOTE = "Le chat dormait tranquillement";
const START = SCENE_CONTENT.indexOf(QUOTE);
const END = START + QUOTE.length;

/** Faux EditorView CodeMirror exposant EXACTEMENT la surface lue par
 * `annotationIdAtOffset`/`annotationIdForExactRange` : `state.field(...)`
 * (retournant le VRAI DecorationSet posé par `applyAnnotationHighlights`,
 * capturé via `dispatch`) et `state.doc.length`. */
function annotationEditorView(docLength) {
  let decorations;
  const view = {
    state: {
      doc: { length: docLength },
      field: (field) => (field === annotationHighlightField ? decorations : undefined),
    },
    dispatch(spec) {
      decorations = spec.effects.value;
    },
    // API PUBLIQUE CodeMirror utilisée par `coordsAtOffset` (voir
    // AnnotationEditorController#anchorFromVisualCoordinates, correctif
    // « Continu ne doit jamais quitter Continu ») — un rectangle simple
    // suffit, jamais une vraie mesure DOM en test.
    coordsAtPos: (pos) => ({ left: pos, right: pos, top: 0, bottom: 12 }),
  };
  return view;
}

function fakeEditor(content, selStart, selEnd, cursorOffset, cm) {
  return {
    getValue: () => content,
    somethingSelected: () => selEnd > selStart,
    getCursor: (which) => {
      if (which === "from") return { offset: selStart };
      if (which === "to") return { offset: selEnd };
      return { offset: cursorOffset ?? selEnd };
    },
    posToOffset: (pos) => pos.offset,
    cm,
  };
}

async function fixture() {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const scene = new TFile("Projet/Manuscrit/Scène.md", SCENE_CONTENT);
  volume.children = [root];
  root.parent = volume;
  root.children = [scene];
  scene.parent = root;
  const { vault } = createFakeVault([volume, root, scene]);
  const app = { vault, workspace: { getActiveFile: () => scene, getLeaf: undefined } };
  const settings = { projectFolder: root.path };

  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "A1",
      file: "Scène.md",
      start: START,
      end: END,
      quote: QUOTE,
      prefix: SCENE_CONTENT.slice(Math.max(0, START - 30), START),
      suffix: SCENE_CONTENT.slice(END, Math.min(SCENE_CONTENT.length, END + 30)),
      text: "première note",
      color: "yellow",
      style: "underline",
    }],
  });

  // EditorView portant la décoration A1 — même mécanisme qu'en production
  // (applyAnnotationHighlights, StateEffect qui REMPLACE le DecorationSet).
  const cm = annotationEditorView(SCENE_CONTENT.length);
  applyAnnotationHighlights(cm, [{ id: "A1", color: "yellow", style: "underline", range: { start: START, end: END } }]);

  const controller = new AnnotationEditorController({
    app,
    getSettings: () => settings,
    getActiveEditor: () => null,
    getActiveFile: () => scene,
  });

  return { app, settings, controller, scene, cm };
}

/* Le `onClick` d'un MenuItem (contrat Menu/Obsidian) ne renvoie jamais la
   promesse de l'action asynchrone qu'il déclenche (`void this.openXxx(...)`,
   voir AnnotationEditorController#addContextMenuItem) — un simple
   `await root.callback()` ne suffit donc pas à attendre la chaîne interne
   (`await loadAnnotations`, etc.). Un flush microtâche après l'appel
   synchrone laisse le temps aux microtâches déjà mises en file d'attente de
   se résoudre, sans ajouter le moindre timer/polling au CODE testé
   (uniquement au test). */
function flushMicrotasks() {
  return new Promise((resolve) => queueMicrotask(() => queueMicrotask(() => queueMicrotask(resolve))));
}

function captureAnnotationPopover(run) {
  const originalOpen = AnnotationPopover.prototype.open;
  let opened = null;
  AnnotationPopover.prototype.open = function open() {
    opened = this;
    return this;
  };
  return Promise.resolve(run())
    .then(() => flushMicrotasks())
    .then(() => opened)
    .finally(() => {
      AnnotationPopover.prototype.open = originalOpen;
    });
}

/* ==================== §27 — tests directs du contrôleur ================== */

test("A — aucune sélection, aucune décoration au curseur → none, entrée désactivée", async () => {
  const { controller, scene, cm } = await fixture();
  const editor = fakeEditor(SCENE_CONTENT, 0, 0, 2, cm); // curseur hors de A1

  const menu = new Menu();
  controller.addContextMenuItem(menu, editor, scene);
  const root = menu.items.find((i) => i.title === t("editorMenu.annotation"));
  assert.equal(root.disabled, true);
});

test("B — aucune sélection, décoration A1 au curseur → existing A1", async () => {
  const { controller, scene, cm } = await fixture();
  const editor = fakeEditor(SCENE_CONTENT, 0, 0, START + 3, cm); // curseur dans A1

  const visualCoordinates = { editorView: cm, cursorOffset: START + 3 };
  const context = controller.resolveContext(visualCoordinates);
  assert.deepEqual(context, { kind: "existing", id: "A1" });

  const menu = new Menu();
  controller.addContextMenuItem(menu, editor, scene);
  const root = menu.items.find((i) => i.title === t("editorMenu.annotation"));
  assert.equal(root.disabled, undefined, "actif : une décoration existe au curseur");
});

test("C — sélection exactement égale à A1 → existing A1", async () => {
  const { controller, cm } = await fixture();
  const context = controller.resolveContext({ editorView: cm, cursorOffset: END, selection: { from: START, to: END } });
  assert.deepEqual(context, { kind: "existing", id: "A1" });
});

test("D — sélection partielle d'une décoration A1 → selection (pas de fusion)", async () => {
  const { controller, cm } = await fixture();
  const context = controller.resolveContext({ editorView: cm, cursorOffset: END, selection: { from: START + 2, to: END - 2 } });
  assert.deepEqual(context, { kind: "selection" });
});

test("E — nouvelle sélection sans décoration → selection", async () => {
  const { controller, cm } = await fixture();
  const otherQuote = "Il faisait nuit";
  const otherStart = SCENE_CONTENT.indexOf(otherQuote);
  const otherEnd = otherStart + otherQuote.length;
  const context = controller.resolveContext({ editorView: cm, cursorOffset: otherEnd, selection: { from: otherStart, to: otherEnd } });
  assert.deepEqual(context, { kind: "selection" });
});

/* ============ §32 — 10x contextmenu sur une annotation existante ========= */

test("10x construction du menu sur A1 (sans clic) — 0 mutation, 1 annotation inchangée", async () => {
  const { controller, app, settings, scene, cm } = await fixture();
  const editor = fakeEditor(SCENE_CONTENT, 0, 0, START + 3, cm);

  for (let i = 0; i < 10; i++) {
    const menu = new Menu();
    controller.addContextMenuItem(menu, editor, scene);
    const root = menu.items.find((it) => it.title === t("editorMenu.annotation"));
    assert.equal(root.disabled, undefined, "existing → actif");
    // Construction SEULE : jamais de clic sur l'item.
  }

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "aucune mutation après 10 constructions de menu sans clic");
  assert.equal(store.annotations[0].id, "A1");
});

/* ============ §33 — 5x « Annotation… » sur l'existante, fermeture ======== */

test("5x clic « Annotation… » sur A1, fermeture à chaque fois — toujours 1 annotation, même id", async () => {
  const { controller, app, settings, scene, cm } = await fixture();

  for (let i = 0; i < 5; i++) {
    const editor = fakeEditor(SCENE_CONTENT, 0, 0, START + 3, cm);
    const menu = new Menu();
    controller.addContextMenuItem(menu, editor, scene);
    const root = menu.items.find((it) => it.title === t("editorMenu.annotation"));

    const opened = await captureAnnotationPopover(() => root.callback());
    assert.ok(opened, "popover d'ÉDITION ouvert (jamais de création)");
    await opened.onSave(opened.text, opened.color, opened.style);
  }

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "toujours UNE seule annotation");
  assert.equal(store.annotations[0].id, "A1", "jamais de A2/A3/A4/A5");
});

test("modification couleur/style de A1 via « Annotation… » → mise à jour, pas de doublon", async () => {
  const { controller, app, settings, scene, cm } = await fixture();
  const editor = fakeEditor(SCENE_CONTENT, 0, 0, START + 3, cm);
  const menu = new Menu();
  controller.addContextMenuItem(menu, editor, scene);
  const root = menu.items.find((it) => it.title === t("editorMenu.annotation"));

  const opened = await captureAnnotationPopover(() => root.callback());
  await opened.onSave("", "pink", "strikethrough");

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.filter((a) => a.start === START && a.end === END).length, 1);
  assert.equal(store.annotations[0].id, "A1");
  assert.equal(store.annotations[0].color, "pink");
  assert.equal(store.annotations[0].style, "strikethrough");
});

/* ================== §29 — verrou anti-doublon AVANT création ============= */

test("§29 — createAnnotationFromSelection sur une sélection exacte existante → édite A1, 0 création", async () => {
  const { controller, app, settings, scene } = await fixture();
  const editor = fakeEditor(SCENE_CONTENT, START, END);

  let openedId = null;
  const originalOpenAnnotationEditor = controller.openAnnotationEditor.bind(controller);
  controller.openAnnotationEditor = async (id, onChange) => {
    openedId = id;
    return originalOpenAnnotationEditor(id, onChange);
  };

  const opened = await captureAnnotationPopover(() => controller.createAnnotationFromSelection(editor, scene));
  assert.equal(openedId, "A1", "édite l'existante");
  assert.ok(opened, "le popover d'ÉDITION s'ouvre (jamais un popover de création par-dessus)");

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "aucune création");
});

/* ==================== §30 — verrou anti-doublon AU SAVE ================== */

test("§30 — course au save : une annotation exacte apparaît pendant que le popover de création est ouvert → update, 0 création", async () => {
  const { controller, app, settings, scene } = await fixture();
  const otherQuote = "Il faisait nuit";
  const otherStart = SCENE_CONTENT.indexOf(otherQuote);
  const otherEnd = otherStart + otherQuote.length;
  const editor = fakeEditor(SCENE_CONTENT, otherStart, otherEnd);

  const opened = await captureAnnotationPopover(() => controller.createAnnotationFromSelection(editor, scene));
  assert.ok(opened, "popover de création ouvert (aucune décoration existante sur cette plage)");

  // Une autre action a créé, PENDANT que ce popover reste ouvert, une
  // annotation EXACTE sur cette même plage.
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [
      ...(await loadAnnotations(app, settings)).annotations,
      {
        id: "RACE",
        file: "Scène.md",
        start: otherStart,
        end: otherEnd,
        quote: otherQuote,
        prefix: "",
        suffix: SCENE_CONTENT.slice(otherEnd, otherEnd + 30),
        text: "créée entre-temps",
        color: "blue",
        style: "highlight",
      },
    ],
  });

  await opened.onSave("texte final", "green", "underline");

  const store = await loadAnnotations(app, settings);
  const onRange = store.annotations.filter((a) => a.start === otherStart && a.end === otherEnd);
  assert.equal(onRange.length, 1, "toujours UNE seule annotation sur cette plage — mise à jour, pas de doublon");
  assert.equal(onRange[0].id, "RACE", "l'annotation apparue entre-temps est mise à jour, pas remplacée");
  assert.equal(onRange[0].text, "texte final");
});

/* ==================== §31 — nouvelle annotation normale =================== */

test("§31 — nouvelle sélection sans décoration existante → 0 écriture avant save, 1 création exacte au save", async () => {
  const { controller, app, settings, scene } = await fixture();
  const otherQuote = "Il faisait nuit";
  const otherStart = SCENE_CONTENT.indexOf(otherQuote);
  const otherEnd = otherStart + otherQuote.length;
  const editor = fakeEditor(SCENE_CONTENT, otherStart, otherEnd);

  let refreshCalls = 0;
  const onAnnotationChange = () => {
    refreshCalls++;
    return Promise.resolve();
  };

  const opened = await captureAnnotationPopover(() => controller.createAnnotationFromSelection(editor, scene, undefined, onAnnotationChange));
  let store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "avant save : toujours seulement A1");
  assert.equal(refreshCalls, 0);

  await opened.onSave("nouvelle note", "green", "highlight");

  store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 2, "exactement une nouvelle annotation après save");
  assert.equal(refreshCalls, 1, "refresh exactement une fois, après la persistance");
});

/* ==================== §34 — Continu, coordonnées composites ============== */

test("§34 — Continu : décoration en coordonnées composites, indépendant du concept de fichier actif", async () => {
  const { app, settings } = await fixture();
  // Composite à deux segments : « Segment A. » (0-12) puis « Segment B texte. »
  // (12-30) — l'annotation vit dans B, en coordonnées COMPOSITES.
  const composite = "Segment A. Segment B texte.";
  const bStart = composite.indexOf("Segment B");
  const bEnd = bStart + "Segment B".length;

  const controller = new AnnotationEditorController({
    app,
    getSettings: () => settings,
    getActiveEditor: () => null, // sans rapport : jamais consulté par resolveContext
    getActiveFile: () => null,
  });

  const compositeView = annotationEditorView(composite.length);
  applyAnnotationHighlights(compositeView, [{ id: "B1", color: "blue", style: "highlight", range: { start: bStart, end: bEnd } }]);

  const context = controller.resolveContext({ editorView: compositeView, cursorOffset: bStart + 2 });
  assert.deepEqual(context, { kind: "existing", id: "B1" }, "résolu via le StateField composite, jamais via le fichier actif");
});

/* ============ MICRO-CORRECTIF — « Annotation… » ne doit jamais quitter
   Continu. Cause : `openAnnotationEditor` retombait sur son fallback
   générique (résolution du fichier source + `openFileAndSelectRange`) dès
   qu'aucune ancre visuelle n'était fournie — le menu contextuel Continu
   n'en fournissait pas. Correctif : `addContextMenuItem` calcule une ancre
   depuis les MÊMES `AnnotationVisualCoordinates` que la résolution du
   contexte (`coordsAtOffset`, API CodeMirror publique) et la transmet à
   `openAnnotationEditor`/`createAnnotationFromSelection` — jamais de
   nouvelle API DOM, jamais un second calcul d'ancre. ============ */

/** Espionne `app.workspace.getLeaf` : sa présence/son appel EST le signal
 * que `openAnnotationEditor` a emprunté le fallback de navigation vers le
 * fichier source (voir son garde `targetFile instanceof TFile &&
 * this.app.workspace.getLeaf`) — jamais d'espionnage de
 * `openFileAndSelectRange` elle-même (fonction libre, non ré-exportée par
 * le contrôleur). */
function leafSpy() {
  const calls = [];
  const fakeLeaf = {
    openFile: async () => {},
    view: undefined, // jamais un vrai MarkdownView : la navigation s'arrêterait avant selectRange
  };
  const getLeaf = (...args) => {
    calls.push(args);
    return fakeLeaf;
  };
  getLeaf.calls = calls;
  return getLeaf;
}

test("§12/§13 — Continu, annotation existante avec ancre : openAnnotationEditor reçoit id+anchor, 0 navigation source", async () => {
  const { controller, app, scene, cm } = await fixture();
  app.workspace.setActiveLeaf = () => { throw new Error("setActiveLeaf ne doit jamais être appelé (0 changement de leaf)"); };
  app.workspace.getLeaf = leafSpy();

  const editor = fakeEditor(SCENE_CONTENT, 0, 0, START + 3, cm);
  let receivedId = null;
  let receivedAnchor = undefined;
  const originalOpenAnnotationEditor = controller.openAnnotationEditor.bind(controller);
  controller.openAnnotationEditor = async (id, onChange, anchor) => {
    receivedId = id;
    receivedAnchor = anchor;
    return originalOpenAnnotationEditor(id, onChange, anchor);
  };

  const menu = new Menu();
  controller.addContextMenuItem(menu, editor, scene);
  const root = menu.items.find((it) => it.title === t("editorMenu.annotation"));

  const opened = await captureAnnotationPopover(() => root.callback());

  assert.equal(receivedId, "A1");
  assert.notEqual(receivedAnchor, undefined, "une ancre visuelle est transmise");
  assert.ok(opened, "le popover s'ouvre");
  assert.equal(app.workspace.getLeaf.calls.length, 0, "0 appel à workspace.getLeaf — aucune navigation vers le fichier source");
});

test("§14 — Continu, sélection exactement égale à A1 : même résultat, aucun openFileAndSelectRange", async () => {
  const { controller, app, scene, cm } = await fixture();
  app.workspace.setActiveLeaf = () => { throw new Error("setActiveLeaf ne doit jamais être appelé"); };
  app.workspace.getLeaf = leafSpy();

  const editor = fakeEditor(SCENE_CONTENT, START, END, undefined, cm); // sélection == plage de A1

  const menu = new Menu();
  controller.addContextMenuItem(menu, editor, scene);
  const root = menu.items.find((it) => it.title === t("editorMenu.annotation"));

  const opened = await captureAnnotationPopover(() => root.callback());
  assert.ok(opened, "popover d'édition ouvert, sur place");
  assert.equal(app.workspace.getLeaf.calls.length, 0, "aucune navigation vers le fichier source");
});

test("§15 — verrou métier (createAnnotationFromSelection) avec ancre Continu fournie : édite A1 sans navigation", async () => {
  const { controller, app, settings, scene } = await fixture();
  app.workspace.setActiveLeaf = () => { throw new Error("setActiveLeaf ne doit jamais être appelé"); };
  app.workspace.getLeaf = leafSpy();

  // Contexte visuel conclu `selection` (aucune décoration montée sur CET
  // EditorView-ci — simule un StateField pas encore remonté) MAIS le store
  // contient déjà A1 exactement sur cette plage : le verrou §16/§17 doit la
  // retrouver et ouvrir SON éditeur, avec l'ancre Continu déjà calculée par
  // l'appelant (comme le ferait addContextMenuItem).
  const staleView = annotationEditorView(SCENE_CONTENT.length); // aucune décoration appliquée
  const editor = fakeEditor(SCENE_CONTENT, START, END, undefined, staleView);
  const anchor = { left: 10, right: 20, top: 30, bottom: 42 };

  const opened = await captureAnnotationPopover(() =>
    controller.createAnnotationFromSelection(editor, scene, undefined, undefined, anchor)
  );

  assert.ok(opened, "popover d'édition de A1 ouvert (jamais de création)");
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "aucune création — l'existante a été rouverte");
  assert.equal(app.workspace.getLeaf.calls.length, 0, "l'ancre fournie empêche toute navigation source");
});

test("§16 — hors Continu (liste centralisée), sans ancre : le fallback fichier source fonctionne toujours", async () => {
  const { controller, app, settings } = await fixture();
  const getLeaf = leafSpy();
  app.workspace.getLeaf = getLeaf;
  app.workspace.setActiveLeaf = () => {};
  app.workspace.getActiveViewOfType = () => undefined;

  // Dépendances DOM du seul chemin exercé nulle part ailleurs jusqu'ici (ce
  // fallback n'était jamais testé) — juste assez pour l'exécuter sans
  // erreur, jamais pour en changer le comportement.
  const previousWindow = globalThis.window;
  const previousCSS = globalThis.CSS;
  globalThis.window = { requestAnimationFrame: (cb) => { cb(); return 0; }, innerHeight: 800 };
  globalThis.CSS = { escape: (s) => s };
  globalThis.document.querySelectorAll = () => [];

  try {
    // Aucune ancre : appel direct, comme depuis NotesView.renderAnnotationRow.
    const opened = await captureAnnotationPopover(() => controller.openAnnotationEditor("A1"));

    assert.ok(opened, "le popover s'ouvre malgré tout");
    assert.equal(getLeaf.calls.length, 1, "le fallback fichier source est bien emprunté sans ancre");
    const store = await loadAnnotations(app, settings);
    assert.equal(store.annotations.length, 1, "aucune mutation, simple navigation");
  } finally {
    globalThis.window = previousWindow;
    globalThis.CSS = previousCSS;
    delete globalThis.document.querySelectorAll;
  }
});
