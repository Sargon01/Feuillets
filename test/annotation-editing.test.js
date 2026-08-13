import test from "node:test";
import assert from "node:assert/strict";
import { Decoration } from "@codemirror/view";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { AnnotationPopover } from "../src/ui/annotation-popover.js";
import { loadAnnotations, saveAnnotations } from "../src/services/annotations.js";

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
