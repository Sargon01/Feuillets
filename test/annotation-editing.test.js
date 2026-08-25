import test from "node:test";
import assert from "node:assert/strict";
import { Decoration } from "@codemirror/view";
import { TFile, TFolder, Menu } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { AnnotationPopover } from "../src/ui/annotation-popover.js";
import { loadAnnotations, saveAnnotations, deleteAnnotation } from "../src/services/annotations.js";

/* Chantier annotations — lot 3 (+ correctif UI popover) : commande/menu de
   création, double-clic → modification, sauvegarde/suppression via le
   service du lot 1, rafraîchissement des décorations. Le popover lui-même
   n'est jamais piloté par le DOM ici (voir test/annotation-popover.test.js
   pour ça) : on intercepte AnnotationPopover.prototype.open comme le fait
   déjà test/main-auto-open-panels.js pour ManageProjectsModal, et on
   appelle directement les callbacks onSave/onDelete capturés — exactement
   ce que ferait la fermeture/le bouton Supprimer du popover.
   main.ts construit le popover avec `parentEl: document.body` : un
   `document` minimal est fourni ici pour que cette seule ligne ne lève
   pas — .open() étant intercepté, son contenu (DOM réel) n'est jamais
   exécuté. */
const previousDocument = globalThis.document;
globalThis.document = { body: {} };
test.after(() => {
  globalThis.document = previousDocument;
});

const SCENE_CONTENT = "Il faisait nuit. Le chat dormait tranquillement. Il faisait nuit.";

function fixture() {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre");
  const scene = new TFile("Projet/Manuscrit/Chapitre/Scène.md", SCENE_CONTENT);
  volume.children = [root];
  root.parent = volume;
  root.children = [chapter];
  chapter.parent = root;
  chapter.children = [scene];
  scene.parent = chapter;
  const { vault } = createFakeVault([volume, root, chapter, scene]);
  const app = { vault, workspace: { getActiveFile: () => scene } };
  const settings = { projectFolder: root.path };

  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.settings = settings;

  return { app, settings, plugin, scene };
}

function fakeEditor(content, selStart, selEnd, dispatchCalls) {
  return {
    getValue: () => content,
    somethingSelected: () => selEnd > selStart,
    getCursor: (which) => ({ offset: which === "from" ? selStart : selEnd }),
    posToOffset: (pos) => pos.offset,
    cm: {
      state: { doc: { length: content.length } },
      dispatch(spec) {
        dispatchCalls.push(spec);
      },
      /* API publique CodeMirror : position du document sous un point écran.
         Le fake encode directement l'offset visé dans `x` — un clic droit
         ne déplace PAS le curseur, c'est donc la SEULE façon pour la
         production de savoir sur quoi le clic portait réellement. */
      posAtCoords: (coords) => (coords && typeof coords.x === "number" ? coords.x : null),
    },
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

test("canAnnotateSelection : refuse sans sélection ou hors du Manuscrit", () => {
  const { plugin, scene } = fixture();
  const dispatchCalls = [];

  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, 3, 3, dispatchCalls); // pas de sélection
  assert.equal(plugin.canAnnotateSelection(), false);

  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, 0, 5, dispatchCalls);
  plugin.app.workspace.getActiveFile = () => new TFile("Ailleurs/Notes.md", "x"); // hors Manuscrit
  assert.equal(plugin.canAnnotateSelection(), false);

  plugin.app.workspace.getActiveFile = () => scene;
  assert.equal(plugin.canAnnotateSelection(), true);
});

test("création à partir d'une sélection : file/quote/prefix/suffix/id via le service du lot 1", async () => {
  const { plugin, app, settings, scene } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  const dispatchCalls = [];
  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, start, end, dispatchCalls);

  const opened = await captureAnnotationPopover(() => plugin.createAnnotationFromSelection());
  assert.ok(opened, "le popover de création s'ouvre");
  assert.equal(opened.text, "");
  assert.equal(opened.color, "yellow");
  assert.equal(typeof opened.onDelete, "undefined"); // rien à supprimer en création

  await opened.onSave("Belle réplique", "green");

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1);
  const created = store.annotations[0];
  assert.ok(created.id);
  assert.equal(created.file, "Chapitre/Scène.md");
  assert.equal(created.quote, quote);
  assert.equal(created.start, start);
  assert.equal(created.end, end);
  assert.equal(created.prefix, SCENE_CONTENT.slice(Math.max(0, start - 30), start));
  assert.equal(created.suffix, SCENE_CONTENT.slice(end, end + 30));
  assert.equal(created.text, "Belle réplique");
  assert.equal(created.color, "green");

  assert.equal(scene.content, SCENE_CONTENT, "le Markdown n'est jamais modifié par la création");
});

test("modification : conserve l'id et permet un changement de couleur", async () => {
  const { plugin, app, settings, scene } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1",
      file: "Chapitre/Scène.md",
      start: 3,
      end: 13,
      quote: "faisait nu",
      prefix: "Il ",
      suffix: "it.",
      text: "ancienne note",
      color: "yellow",
    }],
  });
  plugin.activeEditorAnywhere = () => null; // pas d'éditeur actif : refreshAnnotationHighlights n'a rien à redessiner

  const opened = await captureAnnotationPopover(() => plugin.openAnnotationEditor("ann-1"));
  assert.ok(opened, "le popover d'édition s'ouvre");
  assert.equal(opened.text, "ancienne note");
  assert.equal(opened.color, "yellow");
  assert.equal(typeof opened.onDelete, "function"); // Supprimer disponible en modification

  await opened.onSave("note révisée", "blue");

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1);
  assert.equal(store.annotations[0].id, "ann-1"); // id inchangé
  assert.equal(store.annotations[0].text, "note révisée");
  assert.equal(store.annotations[0].color, "blue");
  assert.equal(scene.content, SCENE_CONTENT, "le Markdown n'est jamais modifié par la modification");
});

test("suppression : retire l'annotation via le bouton Supprimer du popover", async () => {
  const { plugin, app, settings, scene } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1",
      file: "Chapitre/Scène.md",
      start: 3,
      end: 13,
      quote: "faisait nu",
      prefix: "Il ",
      suffix: "it.",
      text: "à retirer",
      color: "pink",
    }],
  });
  plugin.activeEditorAnywhere = () => null; // pas d'éditeur actif : refreshAnnotationHighlights n'a rien à redessiner

  const opened = await captureAnnotationPopover(() => plugin.openAnnotationEditor("ann-1"));
  await opened.onDelete();

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 0);
  assert.equal(scene.content, SCENE_CONTENT, "le Markdown n'est jamais modifié par la suppression");
});

test("refreshAnnotationHighlights : une annotation non résolue n'est pas surlignée", async () => {
  const { plugin, app, settings } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-disparu",
      file: "Chapitre/Scène.md",
      start: 999,
      end: 1010,
      quote: "passage qui n'existe plus du tout",
      prefix: "inconnu",
      suffix: "inconnu",
      text: "",
      color: "yellow",
    }],
  });

  const dispatchCalls = [];
  const editedContent = "Un tout autre contenu, sans rapport avec l'annotation enregistrée.";
  plugin.activeEditorAnywhere = () => fakeEditor(editedContent, 0, 0, dispatchCalls);

  await plugin.refreshAnnotationHighlights();

  assert.equal(dispatchCalls.length, 1);
  const decos = dispatchCalls[0].effects.value;
  assert.equal(Array.isArray(decos), true);
  assert.equal(decos.length, 0, "aucune décoration pour une annotation non résolue");
});

test("refreshAnnotationHighlights : aucune annotation pour ce fichier nettoie les décorations", async () => {
  const { plugin, app, settings } = fixture();
  // Une annotation existe, mais pour un AUTRE fichier du Manuscrit.
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-autre-fichier",
      file: "Chapitre/Autre.md",
      start: 0,
      end: 3,
      quote: "Il ",
      prefix: "",
      suffix: "faisait",
      text: "",
      color: "yellow",
    }],
  });

  const dispatchCalls = [];
  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, 0, 0, dispatchCalls);

  await plugin.refreshAnnotationHighlights();

  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0].effects.value, Decoration.none);
});

test("refreshAnnotationHighlights : hors du Manuscrit, nettoie aussi les décorations", async () => {
  const { plugin } = fixture();
  const dispatchCalls = [];
  const outsideFile = new TFile("Ailleurs/Notes.md", "x");
  plugin.app.workspace.getActiveFile = () => outsideFile;
  plugin.activeEditorAnywhere = () => fakeEditor("x", 0, 0, dispatchCalls);

  await plugin.refreshAnnotationHighlights();

  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0].effects.value, Decoration.none);
});

test("changement de couleur en édition : persisté et redessiné immédiatement, sans attendre la fermeture", async () => {
  const { plugin, app, settings } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1", file: "Chapitre/Scène.md", start: 3, end: 13, quote: "faisait nu", prefix: "Il ", suffix: "it.", text: "note", color: "yellow",
    }],
  });
  const dispatchCalls = [];
  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, 0, 0, dispatchCalls);

  const opened = await captureAnnotationPopover(() => plugin.openAnnotationEditor("ann-1"));
  assert.equal(typeof opened.onColorChange, "function", "le popover expose bien un callback de couleur immédiat");
  dispatchCalls.length = 0; // ignore le rafraîchissement déclenché par l'ouverture elle-même

  await opened.onColorChange("blue");

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations[0].color, "blue", "persisté immédiatement, pas seulement à la fermeture du popover");
  assert.equal(dispatchCalls.length, 1, "la décoration CodeMirror est redessinée immédiatement");
});

test("réancrage : sauvegarder une annotation résolue mais déplacée met à jour start/end/quote/prefix/suffix depuis le texte ACTUEL", async () => {
  const { plugin, app, settings, scene } = fixture();
  const quote = "Le chat dormait tranquillement";
  const originalStart = SCENE_CONTENT.indexOf(quote);
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1", file: "Chapitre/Scène.md",
      start: originalStart, end: originalStart + quote.length, quote,
      prefix: SCENE_CONTENT.slice(Math.max(0, originalStart - 30), originalStart),
      suffix: SCENE_CONTENT.slice(originalStart + quote.length, originalStart + quote.length + 30),
      text: "avant", color: "yellow",
    }],
  });
  // Le texte a changé PENDANT que l'annotation restait ouverte (ou entre deux
  // ouvertures) : le passage a reculé, mais reste retrouvable avec certitude.
  const shifted = `PRÉAMBULE AJOUTÉ. ${SCENE_CONTENT}`;
  scene.content = shifted;
  plugin.activeEditorAnywhere = () => null;

  const opened = await captureAnnotationPopover(() => plugin.openAnnotationEditor("ann-1"));
  await opened.onSave("note à jour", "yellow", "highlight");

  const store = await loadAnnotations(app, settings);
  const updated = store.annotations[0];
  const expectedStart = shifted.indexOf(quote);
  assert.equal(updated.start, expectedStart, "start recalculé à partir du texte ACTUEL, jamais l'ancien");
  assert.equal(updated.end, expectedStart + quote.length);
  assert.equal(updated.quote, quote);
  assert.equal(updated.prefix, shifted.slice(Math.max(0, expectedStart - 30), expectedStart));
  assert.equal(updated.suffix, shifted.slice(expectedStart + quote.length, expectedStart + quote.length + 30));
  assert.equal(updated.text, "note à jour");
  assert.equal(scene.content, shifted, "réancrage : jamais une écriture dans le Markdown");
});

test("annotation unresolved : jamais réancrée, reste éditable et supprimable", async () => {
  const { plugin, app, settings, scene } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1", file: "Chapitre/Scène.md",
      start: 999, end: 1010, quote: "passage qui n'existe plus du tout", prefix: "inconnu", suffix: "inconnu",
      text: "avant", color: "yellow",
    }],
  });
  plugin.activeEditorAnywhere = () => null;

  const opened = await captureAnnotationPopover(() => plugin.openAnnotationEditor("ann-1"));
  await opened.onSave("note modifiée", "blue", "highlight");

  const afterSave = (await loadAnnotations(app, settings)).annotations[0];
  // Jamais réancrée : start/end/quote inchangés, aucune position inventée.
  assert.equal(afterSave.start, 999);
  assert.equal(afterSave.end, 1010);
  assert.equal(afterSave.quote, "passage qui n'existe plus du tout");
  // Mais reste éditable (texte/couleur bien pris en compte)…
  assert.equal(afterSave.text, "note modifiée");
  assert.equal(afterSave.color, "blue");

  // … et supprimable.
  const deleted = await deleteAnnotation(app, settings, "ann-1");
  assert.equal(deleted, true);
  assert.equal((await loadAnnotations(app, settings)).annotations.length, 0);
  assert.equal(scene.content, SCENE_CONTENT, "jamais une écriture dans le Markdown, résolue ou non");
});

/* ===== §3 — note de présentation jamais décorée dans la source ===== */

test("refreshAnnotationHighlights : une note de présentation n'est jamais décorée dans la source", async () => {
  const { plugin, app, settings } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{ id: "ann-1", file: "Chapitre/Scène.md", start: 0, end: 2, quote: "Il", prefix: "", suffix: " ", text: "", color: "yellow", presentationNote: true }],
  });
  const dispatchCalls = [];
  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, 0, 0, dispatchCalls);
  await plugin.refreshAnnotationHighlights();
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0].effects.value, Decoration.none, "aucune décoration : filtrée avant construction du DecorationSet");
});

test("refreshAnnotationHighlights : annotation normale toujours décorée (comportement inchangé)", async () => {
  const { plugin, app, settings } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{ id: "ann-1", file: "Chapitre/Scène.md", start, end: start + quote.length, quote, prefix: "", suffix: "", text: "", color: "yellow" }],
  });
  const dispatchCalls = [];
  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, 0, 0, dispatchCalls);
  await plugin.refreshAnnotationHighlights();
  assert.equal(dispatchCalls.length, 1);
  const decos = dispatchCalls[0].effects.value;
  assert.equal(Array.isArray(decos), true);
  assert.equal(decos.length, 1, "annotation normale toujours décorée");
});

test("édition d'une note de présentation existante : couleur/style masqués (showColors/showStyles false)", async () => {
  const { plugin, app, settings } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{ id: "ann-1", file: "Chapitre/Scène.md", start: 0, end: 2, quote: "Il", prefix: "", suffix: " ", text: "", color: "yellow", presentationNote: true }],
  });
  const opened = await captureAnnotationPopover(() => plugin.openAnnotationEditor("ann-1"));
  assert.equal(opened.showColors, false);
  assert.equal(opened.showStyles, false);
});

test("édition d'une annotation normale : couleur/style restent affichés (comportement STRICTEMENT inchangé)", async () => {
  const { plugin, app, settings } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{ id: "ann-1", file: "Chapitre/Scène.md", start: 0, end: 2, quote: "Il", prefix: "", suffix: " ", text: "", color: "yellow" }],
  });
  const opened = await captureAnnotationPopover(() => plugin.openAnnotationEditor("ann-1"));
  assert.equal(opened.showColors, true);
  assert.equal(opened.showStyles, true);
});

/* ===== §4 — création SANS sélection sur titre/image/callout ===== */

test("création SANS sélection sur un titre : ancre la ligne entière, presentationNote=true, couleur/style masqués, Markdown inchangé", async () => {
  const { plugin, app, settings, scene } = fixture();
  const content = "## I. L'Empire carolingien\n\nTexte de la section.";
  scene.content = content;
  const cursor = content.indexOf("Empire");
  const dispatchCalls = [];
  const editor = fakeEditor(content, cursor, cursor, dispatchCalls);
  plugin.activeEditorAnywhere = () => editor;

  const menu = new Menu();
  plugin.getAnnotationEditor().addContextMenuItem(menu, editor, scene);
  const item = menu.items.find((i) => i.title === "Ajouter une note de présentation");
  assert.ok(item, "l'entrée est proposée quand le curseur porte sur un titre, sans sélection");

  const opened = await captureAnnotationPopover(() => { item.callback(); return Promise.resolve(); });
  assert.ok(opened);
  assert.equal(opened.presentationNote, true);
  assert.equal(opened.showColors, false);
  assert.equal(opened.showStyles, false);

  await opened.onSave("", "yellow", "highlight", true);
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1);
  const created = store.annotations[0];
  assert.equal(created.quote, "## I. L'Empire carolingien");
  assert.equal(created.presentationNote, true);
  assert.equal(scene.content, content, "le Markdown n'est jamais modifié par la création");
});

test("création SANS sélection sur une image wiki : ancre l'occurrence exacte", async () => {
  const { plugin, app, settings, scene } = fixture();
  const content = "Texte avant.\n\n![[carte.png|Ma carte]]\n\nTexte après.";
  scene.content = content;
  const cursor = content.indexOf("carte.png") + 2;
  const dispatchCalls = [];
  const editor = fakeEditor(content, cursor, cursor, dispatchCalls);
  plugin.activeEditorAnywhere = () => editor;

  const menu = new Menu();
  plugin.getAnnotationEditor().addContextMenuItem(menu, editor, scene);
  const item = menu.items.find((i) => i.title === "Ajouter une note de présentation");
  assert.ok(item, "l'entrée est proposée quand le curseur porte sur une image");

  const opened = await captureAnnotationPopover(() => { item.callback(); return Promise.resolve(); });
  await opened.onSave("", "yellow", "highlight", true);
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations[0].quote, "![[carte.png|Ma carte]]");
  assert.equal(scene.content, content, "le Markdown n'est jamais modifié par la création");
});

test("création SANS sélection sur un callout : ancre le bloc logique entier", async () => {
  const { plugin, app, settings, scene } = fixture();
  const content = "Texte.\n\n> [!questions] Mes questions\n> Ligne 1\n> Ligne 2\n\nSuite.";
  scene.content = content;
  const cursor = content.indexOf("Ligne 1");
  const dispatchCalls = [];
  const editor = fakeEditor(content, cursor, cursor, dispatchCalls);
  plugin.activeEditorAnywhere = () => editor;

  const menu = new Menu();
  plugin.getAnnotationEditor().addContextMenuItem(menu, editor, scene);
  const item = menu.items.find((i) => i.title === "Ajouter une note de présentation");
  assert.ok(item, "l'entrée est proposée quand le curseur porte n'importe où dans le callout");

  const opened = await captureAnnotationPopover(() => { item.callback(); return Promise.resolve(); });
  await opened.onSave("", "yellow", "highlight", true);
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations[0].quote, "> [!questions] Mes questions\n> Ligne 1\n> Ligne 2");
  assert.equal(scene.content, content, "le Markdown n'est jamais modifié par la création");
});

test("sélection de texte reste prioritaire : aucune entrée « Ajouter une note de présentation » quand une sélection est active, même sur un titre", async () => {
  const { plugin, scene } = fixture();
  const content = "## Titre\n\nTexte.";
  scene.content = content;
  const start = content.indexOf("Titre");
  const end = start + "Titre".length;
  const dispatchCalls = [];
  const editor = fakeEditor(content, start, end, dispatchCalls);

  const menu = new Menu();
  plugin.getAnnotationEditor().addContextMenuItem(menu, editor, scene);
  const item = menu.items.find((i) => i.title === "Ajouter une note de présentation");
  assert.equal(item, undefined, "la sélection reste prioritaire : seule « Annotation… » est proposée");
});

test("aucun titre/image/callout sous le curseur, sans sélection : aucune entrée supplémentaire proposée", async () => {
  const { plugin, scene } = fixture();
  const content = "Un paragraphe ordinaire, sans titre ni image ni callout.";
  scene.content = content;
  const cursor = 5;
  const dispatchCalls = [];
  const editor = fakeEditor(content, cursor, cursor, dispatchCalls);

  const menu = new Menu();
  plugin.getAnnotationEditor().addContextMenuItem(menu, editor, scene);
  const item = menu.items.find((i) => i.title === "Ajouter une note de présentation");
  assert.equal(item, undefined);
});

/* ===== §4 (correctif) — un clic droit ne déplace pas le curseur ===== */

test("clic droit DANS un callout sans y avoir mis le curseur : l'entrée est proposée et ancre le bloc entier", async () => {
  const { plugin, app, settings, scene } = fixture();
  const content = "Texte.\n\n> [!questions] Mes questions\n> Ligne 1\n> Ligne 2\n\nSuite.";
  scene.content = content;
  // Le curseur est resté TOUT AILLEURS (dans « Texte. »), comme après un
  // simple clic droit qui ne le déplace pas.
  const dispatchCalls = [];
  const editor = fakeEditor(content, 2, 2, dispatchCalls);
  plugin.activeEditorAnywhere = () => editor;

  const menu = new Menu();
  plugin.getAnnotationEditor().addContextMenuItem(menu, editor, scene, {
    pointerCoordinates: { x: content.indexOf("Ligne 1"), y: 0 },
  });
  const item = menu.items.find((i) => i.title === "Ajouter une note de présentation");
  assert.ok(item, "l'entrée est proposée d'après le POINT du clic droit, pas d'après le curseur");

  const opened = await captureAnnotationPopover(() => { item.callback(); return Promise.resolve(); });
  await opened.onSave("", "yellow", "highlight", true);
  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations[0].quote, "> [!questions] Mes questions\n> Ligne 1\n> Ligne 2");
  assert.equal(scene.content, content, "le Markdown n'est jamais modifié");
});

test("clic droit sur un titre sans y avoir mis le curseur : ancre la ligne du titre visé, pas celle du curseur", async () => {
  const { plugin, app, settings, scene } = fixture();
  const content = "# Premier titre\n\nTexte.\n\n## Second titre\n\nAutre texte.";
  scene.content = content;
  const dispatchCalls = [];
  // Curseur laissé sur le PREMIER titre…
  const editor = fakeEditor(content, 3, 3, dispatchCalls);
  plugin.activeEditorAnywhere = () => editor;

  const menu = new Menu();
  // … mais le clic droit porte sur le SECOND.
  plugin.getAnnotationEditor().addContextMenuItem(menu, editor, scene, {
    pointerCoordinates: { x: content.indexOf("Second titre"), y: 0 },
  });
  const item = menu.items.find((i) => i.title === "Ajouter une note de présentation");
  assert.ok(item);

  const opened = await captureAnnotationPopover(() => { item.callback(); return Promise.resolve(); });
  await opened.onSave("", "yellow", "highlight", true);
  assert.equal((await loadAnnotations(app, settings)).annotations[0].quote, "## Second titre");
});

test("aucune coordonnée de clic disponible : repli sur le curseur, comportement inchangé", async () => {
  const { plugin, scene } = fixture();
  const content = "## Titre visé\n\nTexte.";
  scene.content = content;
  const dispatchCalls = [];
  const editor = fakeEditor(content, 3, 3, dispatchCalls);
  plugin.activeEditorAnywhere = () => editor;

  const menu = new Menu();
  plugin.getAnnotationEditor().addContextMenuItem(menu, editor, scene);
  assert.ok(menu.items.find((i) => i.title === "Ajouter une note de présentation"), "le curseur reste le repli");
});

/* ===== Ancrage du popover d'une note de présentation ===== */

test("RÉGRESSION ancrage — une note de présentation (jamais décorée) s'ouvre SUR le passage, pas dans le coin haut-gauche", async () => {
  const { plugin, app, settings } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1", file: "Chapitre/Scène.md", start, end: start + quote.length,
      quote, prefix: "", suffix: "", text: "note", color: "yellow", presentationNote: true,
    }],
  });

  // Aucune décoration ne porte data-annotation-id : c'est le cas NORMAL
  // d'une note de présentation (jamais surlignée dans la source). Sans le
  // repli coordsAtOffset, resolvedAnchor retombait sur
  // DEFAULT_ANNOTATION_ANCHOR, c'est-à-dire le coin haut-gauche.
  const passageRect = { left: 420, right: 640, top: 300, bottom: 318 };
  const dispatchCalls = [];
  const editor = fakeEditor(SCENE_CONTENT, 0, 0, dispatchCalls);
  editor.cm.coordsAtPos = (pos) => (pos === start ? passageRect : null);
  editor.offsetToPos = (offset) => ({ line: 0, ch: offset });
  editor.setSelection = () => {};
  editor.scrollIntoView = () => {};
  editor.focus = () => {};
  plugin.activeEditorAnywhere = () => editor;

  const previousQuerySelectorAll = globalThis.document.querySelectorAll;
  const previousWindow = globalThis.window;
  const previousCSS = globalThis.CSS;
  globalThis.document.querySelectorAll = () => [];
  globalThis.window = { requestAnimationFrame: (cb) => { cb(); return 0; }, innerHeight: 900 };
  globalThis.CSS = { escape: (value) => value };
  app.workspace.getLeaf = () => ({ openFile: async () => {}, view: null });
  app.workspace.getActiveViewOfType = () => null;
  app.workspace.setActiveLeaf = () => {};

  try {
    const opened = await captureAnnotationPopover(() => plugin.openAnnotationEditor("ann-1"));
    assert.deepEqual(opened.anchor, passageRect, "le popover est ancré sur le passage réel");
    assert.notDeepEqual(opened.anchor, { left: 24, right: 24, top: 24, bottom: 24 }, "jamais le coin haut-gauche");
  } finally {
    globalThis.document.querySelectorAll = previousQuerySelectorAll;
    globalThis.window = previousWindow;
    globalThis.CSS = previousCSS;
  }
});
