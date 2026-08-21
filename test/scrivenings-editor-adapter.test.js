import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import {
  ScriveningsSegmentEditorAdapter,
  offsetToLineCol,
  lineColToOffset,
} from "../src/utils/scrivenings-editor-adapter.js";

/* --- Harness : un composite à DEUX segments, EditorView CodeMirror factice --- */

function makeSegments() {
  // A : frontmatter 18 caractères ("---\ntitle: X\n---\n"), body "Alpha bravo."
  const frontmatterA = "---\ntitle: X\n---\n";
  const bodyA = "Alpha bravo.";
  const fileA = new TFile("Manuscrit/A.md");
  const fromA = 5; // segment.from volontairement non nul (§51)
  const toA = fromA + bodyA.length;

  // B : sans frontmatter, juste après une jonction "\n".
  const frontmatterB = "";
  const bodyB = "Charlie delta echo.";
  const fileB = new TFile("Manuscrit/B.md");
  const fromB = toA + 1;
  const toB = fromB + bodyB.length;

  return {
    A: { file: fileA, path: fileA.path, frontmatter: frontmatterA, body: bodyA, from: fromA, to: toA },
    B: { file: fileB, path: fileB.path, frontmatter: frontmatterB, body: bodyB, from: fromB, to: toB },
    compositeText:
      " ".repeat(fromA) /* préfixe arbitraire avant segment A, jamais lu par l'adaptateur */ +
      bodyA +
      "\n" +
      bodyB,
  };
}

function makeEditorView(compositeText, selection = { from: 0, to: 0, empty: true }) {
  const state = {
    doc: {
      length: compositeText.length,
      sliceString: (from, to = compositeText.length) => compositeText.slice(from, to),
    },
    selection: { main: selection },
  };
  const dispatched = [];
  return {
    state,
    dispatch(spec) {
      dispatched.push(spec);
      if (spec.changes) {
        const { from, to, insert } = spec.changes;
        compositeText = compositeText.slice(0, from) + insert + compositeText.slice(to);
        state.doc.length = compositeText.length;
        state.doc.sliceString = (f, t = compositeText.length) => compositeText.slice(f, t);
      }
      if (spec.selection) {
        state.selection = { main: { from: spec.selection.anchor, to: spec.selection.head ?? spec.selection.anchor, empty: (spec.selection.head ?? spec.selection.anchor) === spec.selection.anchor } };
      }
    },
    focus() {
      this.focused = true;
    },
    dispatched,
    getText: () => compositeText,
  };
}

function makeAdapter(segments, path, cm) {
  const byPath = new Map([[segments.A.path, segments.A], [segments.B.path, segments.B]]);
  return new ScriveningsSegmentEditorAdapter(cm, path, (p) => byPath.get(p) ?? null);
}

/* --- §51 — Lecture -------------------------------------------------------- */

test("§51 — getValue() === frontmatter + body, quel que soit segment.from", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);
  assert.equal(adapter.getValue(), segments.A.frontmatter + segments.A.body);
});

test("§51 — getValue() lit le body ACTUEL de CodeMirror, jamais une copie figée", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);
  // Édition RÉELLE du composite (dispatch), avec la mise à jour de
  // segment.to/body que produirait handleEditorChanges en vrai après coup —
  // c'est la lecture PENDANT/APRÈS ce dispatch qui doit refléter le nouveau
  // texte, jamais une copie prise à la construction de l'adaptateur.
  const insert = " modifié.";
  const insertAt = segments.A.to;
  cm.dispatch({ changes: { from: insertAt, to: insertAt, insert } });
  segments.A.body = segments.A.body + insert;
  segments.A.to = segments.A.from + segments.A.body.length;
  assert.equal(adapter.getValue(), segments.A.frontmatter + "Alpha bravo. modifié.");
});

/* --- §52 — Offsets --------------------------------------------------------- */

test("§52 — conversion fileOffset <-> bodyOffset <-> compositeOffset : début, milieu, fin du body", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);
  const { frontmatter, from, body } = segments.A;

  // Début du body : fileOffset = frontmatter.length -> compositeOffset = from
  adapter.setCursor(offsetToLineCol(frontmatter + body, frontmatter.length));
  assert.equal(cm.state.selection.main.from, from);

  // Milieu du body
  const mid = frontmatter.length + Math.floor(body.length / 2);
  adapter.setCursor(offsetToLineCol(frontmatter + body, mid));
  assert.equal(cm.state.selection.main.from, from + Math.floor(body.length / 2));

  // Fin du body
  adapter.setCursor(offsetToLineCol(frontmatter + body, frontmatter.length + body.length));
  assert.equal(cm.state.selection.main.from, segments.A.to);
});

test("§52 — aucune position YAML ne devient jamais une position éditable composite (setCursor bloque au début du body)", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);
  // Position DANS le YAML (fileOffset = 5, bien avant frontmatter.length=17)
  adapter.setCursor(offsetToLineCol(segments.A.frontmatter + segments.A.body, 5));
  assert.equal(cm.state.selection.main.from, segments.A.from, "clampé au tout début du body, jamais dans le YAML");
});

test("lineColToOffset/offsetToLineCol : bijection pure sur une chaîne quelconque", () => {
  const text = "Un\ntexte\nsur trois lignes.";
  for (let offset = 0; offset <= text.length; offset++) {
    const pos = offsetToLineCol(text, offset);
    assert.equal(lineColToOffset(text, pos), offset, `offset ${offset}`);
  }
});

/* --- §53 — Écriture --------------------------------------------------------- */

test("§53 — replaceRange dans le body : UNE dispatch CodeMirror, offsets composites corrects", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);
  const full = segments.A.frontmatter + segments.A.body;

  adapter.replaceRange("X", offsetToLineCol(full, segments.A.frontmatter.length), offsetToLineCol(full, segments.A.frontmatter.length + 1));

  assert.equal(cm.dispatched.length, 1);
  assert.deepEqual(cm.dispatched[0].changes, { from: segments.A.from, to: segments.A.from + 1, insert: "X" });
});

test("§53 — écrire dans le YAML : 0 dispatch", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);
  const full = segments.A.frontmatter + segments.A.body;

  adapter.replaceRange("X", offsetToLineCol(full, 0), offsetToLineCol(full, 2));

  assert.equal(cm.dispatched.length, 0);
});

test("§53 — une position hors bornes (ligne/colonne fantaisistes) reste bornée au segment, jamais projetée hors de lui", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);

  // {line: 999, ch: 999} n'existe pas dans le body de A : lineColToOffset
  // le borne à la fin du texte du VRAI fichier — jamais projeté au-delà du
  // segment composite (ce que vérifie l'assertion sur `to` ci-dessous).
  adapter.replaceRange("X", { line: 999, ch: 999 }, { line: 999, ch: 999 });

  assert.equal(cm.dispatched.length, 1);
  const change = cm.dispatched[0].changes;
  assert.ok(change.from <= segments.A.to && change.to <= segments.A.to, "jamais projeté au-delà du segment");
  assert.ok(change.from >= segments.A.from, "jamais projeté dans le YAML ni avant le segment");
});

test("§53 — segment inconnu (chemin absent du document) : toute écriture est un no-op", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = new ScriveningsSegmentEditorAdapter(cm, "Manuscrit/Fantome.md", () => null);
  adapter.replaceRange("X", { line: 0, ch: 0 }, { line: 0, ch: 1 });
  assert.equal(cm.dispatched.length, 0);
  assert.equal(adapter.getValue(), "");
});

/* --- somethingSelected / getSelection : jamais cross-segment --------------- */

test("somethingSelected()/getSelection() : vrai seulement si la sélection composite est ENTIÈREMENT dans ce segment", () => {
  const segments = makeSegments();
  const withinA = { from: segments.A.from + 1, to: segments.A.from + 5, empty: false };
  const cmWithin = makeEditorView(segments.compositeText, withinA);
  const adapterA = makeAdapter(segments, segments.A.path, cmWithin);
  assert.equal(adapterA.somethingSelected(), true);
  assert.equal(adapterA.getSelection(), segments.compositeText.slice(withinA.from, withinA.to));

  const crossSegment = { from: segments.A.to - 1, to: segments.B.from + 3, empty: false };
  const cmCross = makeEditorView(segments.compositeText, crossSegment);
  const adapterCrossA = makeAdapter(segments, segments.A.path, cmCross);
  assert.equal(adapterCrossA.somethingSelected(), false, "cross-segment : jamais 'sélectionné' du point de vue de CE segment");
  assert.equal(adapterCrossA.getSelection(), "");
});

/* --- setValue (renumberFootnotesInEditor) ----------------------------------- */

test("setValue : diff minimal, une seule dispatch, jamais le frontmatter touché", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);
  const renumbered = segments.A.frontmatter + "Alpha bravo modifié.";

  adapter.setValue(renumbered);

  assert.equal(cm.dispatched.length, 1);
  const change = cm.dispatched[0].changes;
  // La partie remplacée ne doit jamais chevaucher le frontmatter :
  assert.ok(change.from >= segments.A.from);
});

test("setValue : contenu identique, 0 dispatch", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);
  adapter.setValue(segments.A.frontmatter + segments.A.body);
  assert.equal(cm.dispatched.length, 0);
});

/* --- getLine/lastLine (insertFootnote) -------------------------------------- */

test("getLine/lastLine opèrent sur frontmatter + body, comme un Editor réel sur le vrai fichier", () => {
  const segments = makeSegments();
  const cm = makeEditorView(segments.compositeText);
  const adapter = makeAdapter(segments, segments.A.path, cm);
  const fullLines = (segments.A.frontmatter + segments.A.body).split("\n");
  assert.equal(adapter.lastLine(), fullLines.length - 1);
  assert.equal(adapter.getLine(adapter.lastLine()), fullLines[fullLines.length - 1]);
});
