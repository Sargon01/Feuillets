import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { buildScriveningsDocument } from "../src/services/scrivenings-document.js";

/* LOT 1.4 — hook `contextmenu` + résolution du contexte de clic
   (§7-9, §54-55). ScriveningsView est exercée via Object.create (même
   patron que test/scrivenings-open.test.js) : aucun vrai CodeMirror monté,
   seulement le sous-ensemble d'EditorView réellement consommé par ces
   méthodes (dom, posAtCoords, state, dispatch). */

function makeCm({ posAtCoordsResult = 5, selection = { from: 0, to: 0, empty: true } } = {}) {
  const listeners = new Map();
  const cm = {
    dom: {
      addEventListener: (type, cb) => listeners.set(type, cb),
      removeEventListener: (type, cb) => {
        if (listeners.get(type) === cb) listeners.delete(type);
      },
    },
    listeners,
    dispatched: [],
    state: { selection: { main: selection } },
    dispatch(spec) {
      cm.dispatched.push(spec);
      if (spec.selection) {
        cm.state = {
          selection: {
            main: {
              from: spec.selection.anchor,
              to: spec.selection.head ?? spec.selection.anchor,
              empty: (spec.selection.head ?? spec.selection.anchor) === spec.selection.anchor,
            },
          },
        };
      }
    },
    posAtCoords: () => posAtCoordsResult,
    destroy() {},
  };
  return cm;
}

function docFrom(pairs) {
  const entries = pairs.map(([path, content]) => ({ file: new TFile(path), content }));
  return buildScriveningsDocument(entries);
}

function makeView({ cm, document, plugin = {} }) {
  const view = Object.create(ScriveningsView.prototype);
  view.plugin = plugin;
  view.cm = cm;
  view.session = { document };
  return view;
}

/* --- §9/§55 — position du curseur au clic droit ----------------------------- */

test("§9/§55 — clic HORS sélection : caret placé à la position du clic, sélection AVANT écrasée", () => {
  const document = docFrom([["A.md", "Alpha bravo."]]);
  const cm = makeCm({ posAtCoordsResult: 7, selection: { from: 0, to: 3, empty: false } });
  const view = makeView({ cm, document });

  const ctx = view.resolveEditorContext(10, 20);

  assert.ok(ctx);
  assert.equal(ctx.compositeOffset, 7);
  assert.deepEqual(cm.dispatched, [{ selection: { anchor: 7, head: 7 } }]);
});

test("§9/§55 — clic DANS une sélection non vide : la sélection est conservée, aucun dispatch", () => {
  const document = docFrom([["A.md", "Alpha bravo."]]);
  const cm = makeCm({ posAtCoordsResult: 3, selection: { from: 0, to: 5, empty: false } });
  const view = makeView({ cm, document });

  const ctx = view.resolveEditorContext(10, 20);

  assert.ok(ctx);
  assert.deepEqual(cm.dispatched, [], "aucun dispatch : la sélection reste intacte");
});

test("§9 — sélection vide : le caret est toujours replacé à la position du clic", () => {
  const document = docFrom([["A.md", "Alpha bravo."]]);
  const cm = makeCm({ posAtCoordsResult: 4, selection: { from: 4, to: 4, empty: true } });
  const view = makeView({ cm, document });

  view.resolveEditorContext(0, 0);

  assert.deepEqual(cm.dispatched, [{ selection: { anchor: 4, head: 4 } }]);
});

/* --- §7-8 — contexte du clic : offsets ------------------------------------- */

test("§7-8 — offsets composite/body/fichier cohérents pour un segment avec frontmatter", () => {
  const document = docFrom([["A.md", "---\ntitle: X\n---\nAlpha bravo."]]);
  const seg = document.segments[0];
  const cm = makeCm({ posAtCoordsResult: seg.from + 3, selection: { from: 0, to: 0, empty: true } });
  const view = makeView({ cm, document });

  const ctx = view.resolveEditorContext(1, 1);

  assert.equal(ctx.file, seg.file);
  assert.equal(ctx.segment, seg);
  assert.equal(ctx.compositeOffset, seg.from + 3);
  assert.equal(ctx.bodyOffset, 3);
  assert.equal(ctx.fileOffset, seg.frontmatter.length + 3);
});

test("§7 — un clic hors document (posAtCoords null) : aucun contexte, aucun dispatch", () => {
  const document = docFrom([["A.md", "Alpha."]]);
  const cm = makeCm({ posAtCoordsResult: null });
  const view = makeView({ cm, document });

  const ctx = view.resolveEditorContext(999, 999);

  assert.equal(ctx, null);
  assert.deepEqual(cm.dispatched, []);
});

/* --- §54 — listener contextmenu --------------------------------------------- */

test("§54 — sans hook plugin : le contextmenu n'est jamais intercepté", () => {
  const cm = makeCm();
  const view = makeView({ cm, document: docFrom([["A.md", "Alpha."]]), plugin: {} });

  view.installContextMenuListener();
  const handler = cm.listeners.get("contextmenu");
  assert.ok(handler, "le listener est bien installé");

  let prevented = false;
  handler({ preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
  assert.equal(prevented, false, "comportement natif non intercepté sans hook");
});

test("§54 — avec hook : preventDefault + stopPropagation + hook appelé EXACTEMENT une fois", () => {
  const cm = makeCm();
  const calls = [];
  const view = makeView({ cm, document: docFrom([["A.md", "Alpha."]]), plugin: { showScriveningsContextMenu: (v, e) => calls.push([v, e]) } });

  view.installContextMenuListener();
  const handler = cm.listeners.get("contextmenu");
  let prevented = false;
  let stopped = false;
  const event = { preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } };
  handler(event);

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], view);
  assert.equal(calls[0][1], event);
});

test("§54 — après destroy : le listener est retiré, jamais deux instances vivantes", () => {
  const cm = makeCm();
  const view = makeView({ cm, document: docFrom([["A.md", "Alpha."]]), plugin: { showScriveningsContextMenu: () => {} } });

  view.installContextMenuListener();
  assert.ok(cm.listeners.get("contextmenu"));

  view.destroyEditor();

  assert.equal(cm.listeners.get("contextmenu"), undefined);
  assert.equal(view.cm, null);
});
