import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { loadAnnotations, saveAnnotations } from "../src/services/annotations.js";

/* Chantier annotations — réparation de la régression de création.
   Contrairement à test/annotation-editing.test.js (qui intercepte
   AnnotationPopover.prototype.open pour tester CE QUE FONT onSave/onDelete
   une fois appelés), ce fichier laisse le popover s'ouvrir et se fermer
   RÉELLEMENT : seul document.body est une fausse implémentation DOM
   minimale (même patron que test/annotation-popover.test.js). Le clic
   extérieur et Escape sont de VRAIS événements dispatchés sur ce faux DOM,
   jamais un appel direct à onSave() — c'est précisément le chemin que la
   régression avait cassé (saveOnClose: false empêchait toute sauvegarde,
   quel que soit le moyen de fermeture). */

class FakeElement {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.attributes = {};
    this.events = new Map();
    this.style = {};
    this.text = "";
    this.value = "";
    this.removed = false;
    this.parent = null;
  }
  _createChild(tag, options = {}) {
    const child = new FakeElement(tag);
    if (options.cls) child.addClass(options.cls);
    if (options.text) child.setText(options.text);
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) child.setAttr(k, v);
    child.parent = this;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this._createChild("div", options); }
  createSpan(options = {}) { return this._createChild("span", options); }
  createEl(tag, options = {}) { return this._createChild(tag, options); }
  addClass(cls) { for (const c of cls.split(" ")) this.classes.add(c); }
  removeClass(cls) { this.classes.delete(cls); }
  setText(text) { this.text = String(text); }
  setAttr(name, value) { this.attributes[name] = value; }
  addEventListener(type, cb) { this.events.set(type, cb); }
  removeEventListener(type, cb) { if (this.events.get(type) === cb) this.events.delete(type); }
  remove() {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  contains(target) {
    if (target === this) return true;
    return this.children.some((c) => c.contains(target));
  }
  focus() {}
}

function findAll(el, predicate) {
  const out = [];
  for (const child of el.children) {
    if (predicate(child)) out.push(child);
    out.push(...findAll(child, predicate));
  }
  return out;
}

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
      dispatch(spec) { dispatchCalls.push(spec); },
    },
  };
}

/** `close()`/`cancel()` déclenchent `onSave`/`onDelete` en fire-and-forget
 * (`void this.onSave(...)`, voir annotation-popover.ts) — un mousedown/
 * keydown simulé revient donc avant que la chaîne async réelle
 * (loadAnnotations → écriture → saveAnnotations) se termine. Laisse
 * plusieurs tours de boucle s'écouler, exactement ce qu'un test bout-en-bout
 * doit faire plutôt que d'halluciner un await inexistant côté production. */
function flush() {
  return new Promise((resolve) => { setTimeout(resolve, 0); }).then(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
}

/** Fournit un `document.body` réel (au sens DOM minimal) le temps du test —
 * `createAnnotationFromSelection`/`openAnnotationEditor` construisent le
 * popover dedans (`parentEl: document.body`, voir main.ts). */
async function withFakeDocument(run) {
  const previous = globalThis.document;
  const body = new FakeElement("body");
  globalThis.document = { body };
  try { return await run(body); }
  finally { globalThis.document = previous; }
}

test("création réelle : clic extérieur sauvegarde, l'annotation existe vraiment", () => withFakeDocument(async (body) => {
  const { plugin, app, settings, scene } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, start, end, []);

  await plugin.createAnnotationFromSelection(); // .open() RÉEL, jamais intercepté

  const textarea = findAll(body, (n) => n.tag === "textarea")[0];
  assert.ok(textarea, "le popover réel s'est ouvert dans document.body");
  textarea.value = "Belle réplique";
  textarea.events.get("input")();

  // Clic extérieur RÉEL : mousedown sur document.body, cible hors du popover.
  const outside = new FakeElement("div");
  await body.events.get("mousedown")({ target: outside });
  await flush();

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "l'annotation existe réellement après le clic extérieur");
  assert.equal(store.annotations[0].text, "Belle réplique");
  assert.equal(store.annotations[0].quote, quote);
  assert.equal(store.annotations[0].file, "Chapitre/Scène.md");
  assert.equal(scene.content, SCENE_CONTENT, "le Markdown n'est jamais modifié");
}));

test("création réelle : Escape ANNULE, aucune annotation n'est créée", () => withFakeDocument(async (body) => {
  const { plugin, app, settings, scene } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, start, end, []);

  await plugin.createAnnotationFromSelection();

  const textarea = findAll(body, (n) => n.tag === "textarea")[0];
  assert.ok(textarea, "le popover réel s'est ouvert");
  textarea.value = "Ne doit jamais être enregistré";
  textarea.events.get("input")();

  await body.events.get("keydown")({ key: "Escape" });

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 0, "Escape annule une création : rien n'est créé");
  assert.equal(scene.content, SCENE_CONTENT);
}));

test("note vide autorisée : un surlignage sans commentaire est réellement créé", () => withFakeDocument(async (body) => {
  const { plugin, app, settings } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, start, end, []);

  await plugin.createAnnotationFromSelection();
  // Rien tapé dans le textarea : le commentaire reste vide.
  const outside = new FakeElement("div");
  await body.events.get("mousedown")({ target: outside });
  await flush();

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 1, "un simple surlignage, sans commentaire, est bien créé");
  assert.equal(store.annotations[0].text, "");
}));

test("édition réelle : Escape SAUVEGARDE — contrat différent de la création", () => withFakeDocument(async (body) => {
  const { plugin, app, settings, scene } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "ann-1", file: "Chapitre/Scène.md", start: 3, end: 13, quote: "faisait nu", prefix: "Il ", suffix: "it.", text: "ancienne note", color: "yellow",
    }],
  });
  plugin.activeEditorAnywhere = () => null; // pas d'éditeur actif : refreshAnnotationHighlights n'a rien à redessiner

  await plugin.openAnnotationEditor("ann-1"); // .open() RÉEL

  const textarea = findAll(body, (n) => n.tag === "textarea")[0];
  assert.ok(textarea, "le popover d'édition réel s'est ouvert");
  assert.equal(textarea.value, "ancienne note");
  textarea.value = "note révisée";
  textarea.events.get("input")();

  await body.events.get("keydown")({ key: "Escape" });
  await flush();

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations[0].text, "note révisée", "Escape sauvegarde en modification, jamais n'annule");
  assert.equal(scene.content, SCENE_CONTENT, "le Markdown n'est jamais modifié");
}));

test("clic à l'intérieur du popover de création ne le ferme jamais (ni ne sauvegarde ni n'annule)", () => withFakeDocument(async (body) => {
  const { plugin, app, settings } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  plugin.activeEditorAnywhere = () => fakeEditor(SCENE_CONTENT, start, end, []);

  await plugin.createAnnotationFromSelection();

  const dot = findAll(body, (n) => n.classes.has("feuillets-annotation-popover-color"))[0];
  assert.ok(dot, "une pastille de couleur est bien rendue");
  await body.events.get("mousedown")({ target: dot });

  const store = await loadAnnotations(app, settings);
  assert.equal(store.annotations.length, 0, "un clic dans le popover ne ferme jamais, donc rien n'est encore décidé");
}));
