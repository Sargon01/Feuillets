import test from "node:test";
import assert from "node:assert/strict";
import { Decoration } from "@codemirror/view";
import {
  applyAnnotationHighlights,
  clearAnnotationHighlights,
  annotationHighlightField,
  annotationDoubleClickExtension,
  setAnnotationHighlightsEffect,
  ANNOTATION_HIGHLIGHT_CLASS,
  annotationHighlightColorClass,
  annotationHighlightStyleClass,
} from "../src/utils/cm-annotation-highlighter.js";

const view = (docLength = 40) => ({
  state: { doc: { length: docLength } },
  calls: [],
  dispatch(value) {
    this.calls.push(value);
  },
});

test("applyAnnotationHighlights : une plage valide produit une décoration", () => {
  const editor = view();
  applyAnnotationHighlights(editor, [{ id: "a1", color: "yellow", range: { start: 2, end: 6 } }]);
  assert.equal(editor.calls.length, 1);
  const decos = editor.calls[0].effects.value;
  assert.equal(decos.length, 1);
  assert.equal(decos[0].from, 2);
  assert.equal(decos[0].to, 6);
  assert.equal(decos[0].attributes["data-annotation-id"], "a1");
  assert.match(decos[0].class, new RegExp(ANNOTATION_HIGHLIGHT_CLASS));
  assert.match(decos[0].class, /cm-annotation-highlight-yellow/);
});

test("applyAnnotationHighlights : plages invalides ignorées (négative, start>=end, dépasse le document)", () => {
  const editor = view(10);
  applyAnnotationHighlights(editor, [
    { id: "neg", color: "yellow", range: { start: -1, end: 3 } },
    { id: "inverted", color: "green", range: { start: 5, end: 5 } },
    { id: "reversed", color: "blue", range: { start: 6, end: 4 } },
    { id: "overflow", color: "pink", range: { start: 8, end: 20 } },
    { id: "ok", color: "yellow", range: { start: 1, end: 3 } },
  ]);
  assert.equal(editor.calls.length, 1);
  const decos = editor.calls[0].effects.value;
  assert.equal(decos.length, 1);
  assert.equal(decos[0].attributes["data-annotation-id"], "ok");
});

test("applyAnnotationHighlights : annotations non résolues ignorées, jamais devinées", () => {
  const editor = view();
  applyAnnotationHighlights(editor, [
    { id: "unresolved", color: "yellow", range: null },
    { id: "resolved", color: "green", range: { start: 0, end: 3 } },
  ]);
  const decos = editor.calls[0].effects.value;
  assert.equal(decos.length, 1);
  assert.equal(decos[0].attributes["data-annotation-id"], "resolved");
});

test("applyAnnotationHighlights : les quatre classes de couleur sont posées correctement", () => {
  const editor = view();
  const colors = ["yellow", "green", "blue", "pink"];
  applyAnnotationHighlights(
    editor,
    colors.map((color, i) => ({ id: `id-${color}`, color, range: { start: i * 2, end: i * 2 + 1 } }))
  );
  const decos = editor.calls[0].effects.value;
  assert.equal(decos.length, 4);
  for (const color of colors) {
    const deco = decos.find((d) => d.attributes["data-annotation-id"] === `id-${color}`);
    assert.ok(deco, `décoration manquante pour ${color}`);
    assert.match(deco.class, new RegExp(annotationHighlightColorClass(color)));
  }
});

test("applyAnnotationHighlights : style absent reste compatible et utilise highlight", () => {
  const editor = view();
  applyAnnotationHighlights(editor, [{ id: "legacy", color: "yellow", range: { start: 0, end: 2 } }]);
  assert.match(editor.calls[0].effects.value[0].class, new RegExp(annotationHighlightStyleClass("highlight")));
});

test("applyAnnotationHighlights : les trois styles sont combinés à chaque couleur", () => {
  const editor = view(100);
  const styles = ["highlight", "underline", "strikethrough"];
  const colors = ["yellow", "green", "blue", "pink"];
  applyAnnotationHighlights(editor, colors.flatMap((color, colorIndex) => styles.map((style, styleIndex) => ({ id: `${color}-${style}`, color, style, range: { start: (colorIndex * 3 + styleIndex) * 2, end: (colorIndex * 3 + styleIndex) * 2 + 1 } }))));
  const decos = editor.calls[0].effects.value;
  assert.equal(decos.length, 12);
  for (const color of colors) for (const style of styles) {
    const deco = decos.find((entry) => entry.attributes["data-annotation-id"] === `${color}-${style}`);
    assert.match(deco.class, new RegExp(annotationHighlightColorClass(color)));
    assert.match(deco.class, new RegExp(annotationHighlightStyleClass(style)));
  }
});

test("applyAnnotationHighlights : data-annotation-id porte l'id stable de chaque annotation", () => {
  const editor = view();
  applyAnnotationHighlights(editor, [
    { id: "abc-123", color: "blue", range: { start: 0, end: 2 } },
    { id: "def-456", color: "pink", range: { start: 3, end: 5 } },
  ]);
  const decos = editor.calls[0].effects.value;
  const ids = decos.map((d) => d.attributes["data-annotation-id"]).sort();
  assert.deepEqual(ids, ["abc-123", "def-456"]);
});

test("applyAnnotationHighlights : un second appel REMPLACE les décorations précédentes", () => {
  const editor = view();
  applyAnnotationHighlights(editor, [{ id: "old", color: "yellow", range: { start: 0, end: 2 } }]);
  applyAnnotationHighlights(editor, [{ id: "new", color: "blue", range: { start: 3, end: 5 } }]);
  assert.equal(editor.calls.length, 2);
  const lastDecos = editor.calls[1].effects.value;
  assert.equal(lastDecos.length, 1);
  assert.equal(lastDecos[0].attributes["data-annotation-id"], "new");
});

test("applyAnnotationHighlights : une liste vide nettoie comme clearAnnotationHighlights", () => {
  const editor = view();
  applyAnnotationHighlights(editor, [{ id: "a", color: "yellow", range: { start: 0, end: 2 } }]);
  applyAnnotationHighlights(editor, []);
  assert.equal(editor.calls.length, 2);
  assert.equal(editor.calls[1].effects.value, Decoration.none);
});

test("clearAnnotationHighlights : dispatch un DecorationSet vide", () => {
  const editor = view();
  clearAnnotationHighlights(editor);
  assert.equal(editor.calls.length, 1);
  assert.equal(editor.calls[0].effects.value, Decoration.none);
});

test("clearAnnotationHighlights : une vue sans dispatch (détruite) ne lève pas", () => {
  assert.doesNotThrow(() => clearAnnotationHighlights({}));
  assert.doesNotThrow(() => clearAnnotationHighlights(null));
});

test("annotationHighlightField : create() démarre sans décoration", () => {
  assert.equal(annotationHighlightField.create(), Decoration.none);
});

test("annotationHighlightField : un effet setAnnotationHighlightsEffect remplace l'état", () => {
  const decoSet = [{ from: 0, to: 2 }];
  const next = annotationHighlightField.update(Decoration.none, {
    docChanged: false,
    changes: null,
    effects: [{ is: (t) => t === setAnnotationHighlightsEffect, value: decoSet }],
  });
  assert.equal(next, decoSet);
});

test("annotationHighlightField : mapping correct après insertion dans le document", () => {
  const editor = view();
  applyAnnotationHighlights(editor, [{ id: "a1", color: "yellow", range: { start: 10, end: 15 } }]);
  const decorations = editor.calls[0].effects.value;

  // Simule l'insertion de 5 caractères en position 2 (avant l'annotation) :
  // toute position >= 2 est décalée de +5, exactement le contrat de
  // ChangeSet.map côté CodeMirror réel — reproduit ici volontairement à la
  // main puisque le stub de test n'implémente pas ChangeSet.
  const insertAt2Plus5 = (deco) => {
    const shift = (pos) => (pos >= 2 ? pos + 5 : pos);
    return { ...deco, from: shift(deco.from), to: shift(deco.to) };
  };

  const mapped = annotationHighlightField.update(decorations, {
    docChanged: true,
    changes: insertAt2Plus5,
    effects: [],
  });

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].from, 15);
  assert.equal(mapped[0].to, 20);
  assert.equal(mapped[0].attributes["data-annotation-id"], "a1");
});

test("annotationHighlightField : mapping correct après suppression dans le document", () => {
  const editor = view();
  applyAnnotationHighlights(editor, [{ id: "a1", color: "green", range: { start: 10, end: 15 } }]);
  const decorations = editor.calls[0].effects.value;

  // Suppression de 3 caractères en position 2, avant l'annotation.
  const deleteAt2Minus3 = (deco) => {
    const shift = (pos) => (pos >= 5 ? pos - 3 : pos);
    return { ...deco, from: shift(deco.from), to: shift(deco.to) };
  };

  const mapped = annotationHighlightField.update(decorations, {
    docChanged: true,
    changes: deleteAt2Minus3,
    effects: [],
  });

  assert.equal(mapped[0].from, 7);
  assert.equal(mapped[0].to, 12);
});

test("annotationHighlightField : sans changement de document, les décorations restent identiques (pas d'effet)", () => {
  const editor = view();
  applyAnnotationHighlights(editor, [{ id: "a1", color: "pink", range: { start: 1, end: 3 } }]);
  const decorations = editor.calls[0].effects.value;
  const result = annotationHighlightField.update(decorations, { docChanged: false, changes: null, effects: [] });
  assert.equal(result, decorations);
});

class FakeTarget {
  constructor(attributes = {}) {
    this.attributes = attributes;
  }
  closest(selector) {
    // Sélecteur unique attendu ici : [data-annotation-id]
    assert.equal(selector, "[data-annotation-id]");
    return "data-annotation-id" in this.attributes ? this : null;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

test("annotationDoubleClickExtension : un double-clic sur une décoration transmet le bon id et l'élément décoré", () => {
  const received = [];
  const handlers = annotationDoubleClickExtension((id, el) => received.push([id, el]));
  const target = new FakeTarget({ "data-annotation-id": "annotation-42" });
  const handled = handlers.dblclick({ target });
  assert.equal(handled, true);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], ["annotation-42", target]);
});

test("annotationDoubleClickExtension : un double-clic hors décoration ne fait rien", () => {
  const received = [];
  const handlers = annotationDoubleClickExtension((id) => received.push(id));
  const target = new FakeTarget({}); // pas de data-annotation-id
  const handled = handlers.dblclick({ target });
  assert.equal(handled, false);
  assert.deepEqual(received, []);
});

test("annotationDoubleClickExtension : une cible sans closest() (pas un élément DOM) ne lève pas", () => {
  const received = [];
  const handlers = annotationDoubleClickExtension((id) => received.push(id));
  const handled = handlers.dblclick({ target: null });
  assert.equal(handled, false);
  assert.deepEqual(received, []);
});
