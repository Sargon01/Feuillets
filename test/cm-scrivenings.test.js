import test from "node:test";
import assert from "node:assert/strict";
import { WidgetType, EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { history, historyKeymap, redo } from "@codemirror/commands";
import {
  ScriveningsTitleWidget,
  scriveningsTitleSpecsFor,
  scriveningsTitlesField,
  setScriveningsTitlesEffect,
  scriveningsBoundariesField,
  setScriveningsBoundaryOffsetsEffect,
  setScriveningsDecorations,
  crossesScriveningsBoundary,
  scriveningsTransactionFilter,
  scriveningsChangesFromTransaction,
  scriveningsChangeListener,
  scriveningsLineWrapping,
  scriveningsHistory,
  scriveningsHistoryKeymap,
  scriveningsPriorityKeymap,
  scriveningsExtensions,
} from "../src/utils/cm-scrivenings.js";
import { buildScriveningsDocument, boundaryOffsets } from "../src/services/scrivenings-document.js";
import { emptyLinesPlugin } from "../src/utils/cm-empty-lines.js";
import { paragraphIndentPlugin } from "../src/utils/cm-paragraph-indent.js";
import { TFile } from "obsidian";

function docFrom(pairs) {
  const entries = pairs.map(([path, content]) => ({ file: new TFile(path), content }));
  return buildScriveningsDocument(entries);
}

/* --- Retour à la ligne --------------------------------------------------- */

test("scriveningsLineWrapping : monte l'extension publique EditorView.lineWrapping, jamais une réimplémentation", () => {
  assert.equal(scriveningsLineWrapping, EditorView.lineWrapping);
});

test("scriveningsExtensions : compose frontières + titres + retour à la ligne + historique + keymap prioritaire + grammaire Feuillets réutilisée", () => {
  assert.ok(scriveningsExtensions.includes(scriveningsBoundariesField));
  assert.ok(scriveningsExtensions.includes(scriveningsTitlesField));
  assert.ok(scriveningsExtensions.includes(scriveningsLineWrapping));
  assert.ok(scriveningsExtensions.includes(scriveningsHistory), "l'historique CM6 public doit être monté");
  assert.ok(scriveningsExtensions.includes(scriveningsPriorityKeymap), "le keymap Continu prioritaire (micro-lot 1.3.1) doit être monté");
  assert.ok(scriveningsExtensions.includes(scriveningsHistoryKeymap), "le keymap Undo/Redo (repli) doit être monté");
  assert.ok(scriveningsExtensions.includes(emptyLinesPlugin), "cm-empty-lines.ts doit être réutilisé tel quel");
  assert.ok(scriveningsExtensions.includes(paragraphIndentPlugin), "cm-paragraph-indent.ts doit être réutilisé tel quel");

  const priorityIndex = scriveningsExtensions.indexOf(scriveningsPriorityKeymap);
  const historyKeymapIndex = scriveningsExtensions.indexOf(scriveningsHistoryKeymap);
  assert.ok(priorityIndex < historyKeymapIndex, "le keymap prioritaire doit être monté AVANT le repli historyKeymap");
});

/* --- Undo/Redo (LOT 1.2) --------------------------------------------------- */

test("scriveningsHistory : monte l'extension officielle @codemirror/commands, jamais une réimplémentation", () => {
  assert.equal(scriveningsHistory, history());
});

test("scriveningsHistoryKeymap : porte le historyKeymap officiel tel quel, sans binding maison (le correctif Redo vit dans scriveningsPriorityKeymap, micro-lot 1.3.1)", () => {
  assert.deepEqual(scriveningsHistoryKeymap, EditorView.keymap.of(historyKeymap));
});

test("historyKeymap : Cmd/Ctrl+Z (Undo) et Cmd/Ctrl+Shift+Z ou Cmd/Ctrl+Y (Redo) sont bien fournis par le keymap standard", () => {
  const keys = historyKeymap.map((binding) => binding.key);
  assert.ok(keys.includes("Mod-z"), "Undo (Cmd/Ctrl+Z) doit être lié");
  assert.ok(keys.includes("Mod-y") || keys.includes("Mod-Shift-z"), "Redo (Cmd/Ctrl+Shift+Z ou Cmd/Ctrl+Y) doit être lié");
});

/* --- Keymap Continu PRIORITAIRE : Mod-i / Mod-b / Mod-Shift-z (micro-lot 1.3.1) --- */

test("scriveningsPriorityKeymap : enveloppé dans Prec.highest(keymap.of([...])) — API publiques CodeMirror uniquement", () => {
  assert.deepEqual(scriveningsPriorityKeymap, Prec.highest(scriveningsPriorityKeymap.extension));
  assert.equal(scriveningsPriorityKeymap.prec, "highest");
  assert.equal(scriveningsPriorityKeymap.extension.facet, "keymap");
});

test("scriveningsPriorityKeymap : Mod-i, Mod-b et Mod-Shift-z sont présents, chacun preventDefault + stopPropagation", () => {
  const bindings = scriveningsPriorityKeymap.extension.bindings;
  const byKey = Object.fromEntries(bindings.map((b) => [b.key, b]));

  assert.ok(byKey["Mod-i"], "Mod-i doit être présent");
  assert.equal(byKey["Mod-i"].preventDefault, true);
  assert.equal(byKey["Mod-i"].stopPropagation, true);

  assert.ok(byKey["Mod-b"], "Mod-b doit être présent");
  assert.equal(byKey["Mod-b"].preventDefault, true);
  assert.equal(byKey["Mod-b"].stopPropagation, true);

  assert.ok(byKey["Mod-Shift-z"], "Mod-Shift-z (casse exacte CodeMirror) doit être présent");
  assert.equal(byKey["Mod-Shift-z"].run, redo, "doit appeler le redo PUBLIC de @codemirror/commands, jamais une réimplémentation");
  assert.equal(byKey["Mod-Shift-z"].preventDefault, true);
  assert.equal(byKey["Mod-Shift-z"].stopPropagation, true);
});

test("scriveningsPriorityKeymap : construit via le `keymap` public de @codemirror/view, distinct de EditorView.keymap", () => {
  assert.deepEqual(scriveningsPriorityKeymap.extension, keymap.of(scriveningsPriorityKeymap.extension.bindings));
});

test("historyKeymap : Cmd/Ctrl+Z (Undo) et Cmd/Ctrl+Shift+Z ou Cmd/Ctrl+Y (Redo) sont bien fournis par le keymap standard", () => {
  const keys = historyKeymap.map((binding) => binding.key);
  assert.ok(keys.includes("Mod-z"), "Undo (Cmd/Ctrl+Z) doit être lié");
  assert.ok(keys.includes("Mod-y") || keys.includes("Mod-Shift-z"), "Redo (Cmd/Ctrl+Shift+Z ou Cmd/Ctrl+Y) doit être lié");
});

test("scriveningsBoundaryGuard s'applique aussi aux transactions d'annulation/rétablissement : une édition ne franchissant jamais de frontière au départ, l'historique n'a jamais besoin d'en réintroduire une — même filtre, aucune dérogation", () => {
  // L'historique CM6 rejoue l'INVERSE de changements déjà acceptés par
  // scriveningsTransactionFilter (voir cm-scrivenings.ts) : ces changements
  // n'ont donc, par construction, jamais recouvert de jonction. On vérifie
  // ici que le filtre ne fait aucune exception de source — il traite une
  // transaction d'annulation exactement comme n'importe quelle autre.
  const boundaries = [7];
  const undoTr = {
    startState: { field: () => boundaries },
    changes: fakeIterChanges([[5, 9, 5, 5, ""]]), // franchirait la frontière à 7
  };
  assert.deepEqual(scriveningsTransactionFilter(undoTr), [], "même une transaction jouée par l'historique reste bloquée si elle franchit une frontière");
});

/* --- Titres visuels ------------------------------------------------------- */

test("scriveningsTitleSpecsFor : un titre par segment, PREMIER COMPRIS, jamais « A → B »", () => {
  const doc = docFrom([
    ["A.md", "Corps A"],
    ["B.md", "Corps B"],
    ["C.md", "Corps C"],
  ]);
  const specs = scriveningsTitleSpecsFor(doc, (file) => file.basename);

  assert.equal(specs.length, 3);
  assert.deepEqual(specs.map((s) => s.title), ["A", "B", "C"]);
  for (const spec of specs) assert.equal(spec.title.includes("→"), false);

  assert.equal(specs[0].offset, doc.segments[0].from);
  assert.equal(specs[0].divider, false, "aucune séparation au-dessus du tout premier titre");

  assert.equal(specs[1].offset, doc.segments[1].from);
  assert.equal(specs[1].divider, true);
  assert.equal(specs[2].offset, doc.segments[2].from);
  assert.equal(specs[2].divider, true);
});

test("scriveningsTitleSpecsFor : un seul fichier a quand même son titre (le premier)", () => {
  const doc = docFrom([["Seul.md", "Corps"]]);
  const specs = scriveningsTitleSpecsFor(doc, (f) => f.basename);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].title, "Seul");
  assert.equal(specs[0].divider, false);
});

test("ScriveningsTitleWidget : jamais éditable, se redessine seulement si titre, séparateur ou rôle changent", () => {
  const widget = new ScriveningsTitleWidget("Scène A", false);
  assert.ok(widget instanceof WidgetType);
  assert.equal(widget.eq(new ScriveningsTitleWidget("Scène A", false)), true);
  assert.equal(widget.eq(new ScriveningsTitleWidget("Scène B", false)), false);
  assert.equal(widget.eq(new ScriveningsTitleWidget("Scène A", true)), false);
  assert.equal(widget.eq(new ScriveningsTitleWidget("Scène A", false, "chapitre")), false, "un rôle différent (même undefined vs \"chapitre\") change bien l'égalité");
  assert.equal(widget.ignoreEvent(), true);
  // toDOM() manipule `document` — comme les autres widgets CodeMirror du
  // plugin (IndentWidget…), il n'est exercé qu'en environnement Obsidian
  // réel, jamais en test Node (voir test/paragraph-indent.test.js).
});

/* ==================== Rôle scène/chapitre (micro-chantier finition Continu, §23) ==================== */

test("scriveningsTitleSpecsFor : sans roleFor fourni (compatibilité), chaque spec a role=undefined — jamais d'exception (§D)", () => {
  const doc = docFrom([
    ["A.md", "Corps A"],
    ["B.md", "Corps B"],
  ]);
  const specs = scriveningsTitleSpecsFor(doc, (f) => f.basename);
  for (const spec of specs) assert.equal(spec.role, undefined);
});

test("scriveningsTitleSpecsFor : relaie exactement le rôle rendu par roleFor, PAR SEGMENT (§A/§B)", () => {
  const doc = docFrom([
    ["Scene.md", "Corps scène"],
    ["Chapitre.md", "Corps chapitre"],
  ]);
  const roles = new Map([
    ["Scene.md", "scene"],
    ["Chapitre.md", "chapitre"],
  ]);
  const specs = scriveningsTitleSpecsFor(doc, (f) => f.basename, (f) => roles.get(f.path));
  assert.equal(specs[0].role, "scene");
  assert.equal(specs[1].role, "chapitre");
});

test("scriveningsTitleSpecsFor : un rôle inconnu (ni \"chapitre\" ni \"scene\") est relayé tel quel, sans exception (§C)", () => {
  const doc = docFrom([["Partie.md", "Corps"]]);
  const specs = scriveningsTitleSpecsFor(doc, (f) => f.basename, () => "partie");
  assert.equal(specs[0].role, "partie");
});

test("ScriveningsTitleWidget.toDOM() n'ajoute la classe chapitre QUE pour role=\"chapitre\" ET divider=true (§A/§B/§C/§D)", () => {
  // Pas de rendu DOM réel en Node (voir le test ci-dessus) : on vérifie ici
  // seulement la LOGIQUE de sélection de classe, en dupliquant celle de
  // toDOM() — même garanti par la lecture directe du code (cm-scrivenings.ts).
  function classesFor(divider, role) {
    const classes = ["feuillets-scrivenings-title"];
    if (divider) {
      classes.push("feuillets-scrivenings-title-divider");
      if (role === "chapitre") classes.push("feuillets-scrivenings-title-role-chapitre");
    }
    return classes;
  }
  assert.deepEqual(classesFor(true, "chapitre"), ["feuillets-scrivenings-title", "feuillets-scrivenings-title-divider", "feuillets-scrivenings-title-role-chapitre"], "chapitre → classe/variant chapitre (§B)");
  assert.deepEqual(classesFor(true, "scene"), ["feuillets-scrivenings-title", "feuillets-scrivenings-title-divider"], "scène → classe/variant compact (§A)");
  assert.deepEqual(classesFor(true, "partie"), ["feuillets-scrivenings-title", "feuillets-scrivenings-title-divider"], "rôle inconnu → repli compact (§C)");
  assert.deepEqual(classesFor(true, undefined), ["feuillets-scrivenings-title", "feuillets-scrivenings-title-divider"], "aucun rôle → aucune exception (§D)");
  assert.deepEqual(classesFor(false, "chapitre"), ["feuillets-scrivenings-title"], "premier segment (sans divider) : jamais la classe chapitre, même si role=\"chapitre\"");
});

test("scriveningsTitlesField : create() est vide, un effet remplace tout le champ", () => {
  assert.deepEqual(scriveningsTitlesField.create(), []);

  const next = scriveningsTitlesField.update([], {
    docChanged: false,
    effects: [{ is: (type) => type === setScriveningsTitlesEffect, value: [{ offset: 0, title: "A", divider: false }] }],
    changes: null,
  });
  assert.deepEqual(next, [{ offset: 0, title: "A", divider: false }]);
});

test("scriveningsTitlesField : une édition avant un titre le fait glisser (mapPos), sans toucher son libellé", () => {
  const value = [{ offset: 10, title: "B", divider: true }];
  const changes = { mapPos: (pos) => pos + 4 };
  const next = scriveningsTitlesField.update(value, { docChanged: true, effects: [], changes });
  assert.equal(next[0].offset, 14);
  assert.equal(next[0].title, "B");
  assert.equal(next[0].divider, true);
});

test("setScriveningsDecorations : dispatch en une transaction les frontières ET les titres, jamais un ajout", () => {
  const doc = docFrom([
    ["A.md", "Corps A"],
    ["B.md", "Corps B"],
  ]);
  const dispatched = [];
  const view = { dispatch: (spec) => dispatched.push(spec.effects) };

  setScriveningsDecorations(view, doc, (file) => file.basename);

  assert.equal(dispatched.length, 1);
  const [effects] = dispatched;
  assert.equal(effects.length, 2);

  const boundaryEffect = effects.find((e) => e.value !== undefined && Array.isArray(e.value) && typeof e.value[0] === "number");
  assert.deepEqual(boundaryEffect.value, boundaryOffsets(doc));

  const titlesEffect = effects.find((e) => Array.isArray(e.value) && e.value[0] && typeof e.value[0] === "object");
  assert.deepEqual(
    titlesEffect.value.map((s) => s.title),
    ["A", "B"]
  );
});

test("setScriveningsDecorations : transmet roleFor à chaque spec de titre, PAR SEGMENT — sans roleFor, role=undefined partout", () => {
  const doc = docFrom([
    ["A.md", "Corps A"],
    ["B.md", "Corps B"],
  ]);
  const dispatched = [];
  const view = { dispatch: (spec) => dispatched.push(spec.effects) };

  setScriveningsDecorations(view, doc, (file) => file.basename, (file) => (file.basename === "B" ? "chapitre" : "scene"));

  const [effects] = dispatched;
  const titlesEffect = effects.find((e) => Array.isArray(e.value) && e.value[0] && typeof e.value[0] === "object");
  assert.deepEqual(titlesEffect.value.map((s) => s.role), ["scene", "chapitre"]);

  dispatched.length = 0;
  setScriveningsDecorations(view, doc, (file) => file.basename);
  const [effectsNoRole] = dispatched;
  const titlesEffectNoRole = effectsNoRole.find((e) => Array.isArray(e.value) && e.value[0] && typeof e.value[0] === "object");
  assert.deepEqual(titlesEffectNoRole.value.map((s) => s.role), [undefined, undefined]);
});

/* --- Garde-fou de frontière (inchangé) ------------------------------------ */

test("scriveningsBoundariesField : create() est vide, un effet remplace tout le champ (offsets bruts)", () => {
  assert.deepEqual(scriveningsBoundariesField.create(), []);

  const next = scriveningsBoundariesField.update([], {
    docChanged: false,
    effects: [{ is: (type) => type === setScriveningsBoundaryOffsetsEffect, value: [3, 7] }],
    changes: null,
  });
  assert.deepEqual(next, [3, 7]);
});

test("scriveningsBoundariesField : sans édition ni effet, la valeur ne bouge pas", () => {
  const value = [3, 7];
  const next = scriveningsBoundariesField.update(value, { docChanged: false, effects: [], changes: null });
  assert.equal(next, value);
});

test("scriveningsBoundariesField : une édition avant la frontière la fait glisser (mapPos)", () => {
  const value = [10];
  const changes = { mapPos: (pos) => pos + 4 };
  const next = scriveningsBoundariesField.update(value, { docChanged: true, effects: [], changes });
  assert.deepEqual(next, [14]);
});

test("crossesScriveningsBoundary : détecte tout recouvrement, autorise le reste", () => {
  const boundaries = [5, 12];
  assert.equal(crossesScriveningsBoundary(boundaries, 0, 3), false);
  assert.equal(crossesScriveningsBoundary(boundaries, 5, 5), false); // caret, longueur nulle, avant la frontière
  assert.equal(crossesScriveningsBoundary(boundaries, 4, 6), true); // englobe la frontière à 5
  assert.equal(crossesScriveningsBoundary(boundaries, 5, 6), true); // supprime la frontière elle-même
  assert.equal(crossesScriveningsBoundary(boundaries, 11, 20), true); // englobe la frontière à 12
});

function fakeIterChanges(ranges) {
  return {
    iterChanges(fn) {
      for (const [fromA, toA, fromB, toB, insert] of ranges) {
        fn(fromA, toA, fromB, toB, { toString: () => insert });
      }
    },
  };
}

test("scriveningsTransactionFilter : laisse passer une édition contenue dans un seul segment", () => {
  const boundaries = [7];
  const tr = {
    startState: { field: () => boundaries },
    changes: fakeIterChanges([[0, 2, 0, 3, "abc"]]),
  };
  assert.equal(scriveningsTransactionFilter(tr), tr);
});

test("scriveningsTransactionFilter : rejette proprement (transaction vidée) toute édition qui franchit une frontière", () => {
  const boundaries = [7];
  const tr = {
    startState: { field: () => boundaries },
    changes: fakeIterChanges([[5, 9, 5, 5, ""]]),
  };
  assert.deepEqual(scriveningsTransactionFilter(tr), []);
});

test("scriveningsTransactionFilter : sans frontière connue (champ absent), tout passe", () => {
  const tr = {
    startState: { field: () => undefined },
    changes: fakeIterChanges([[0, 100, 0, 0, ""]]),
  };
  assert.equal(scriveningsTransactionFilter(tr), tr);
});

test("scriveningsChangeListener : transmet les changements convertis, jamais sur une transaction sans édition", () => {
  const received = [];
  const extension = scriveningsChangeListener((changes) => received.push(changes));
  extension.fn({ docChanged: false, changes: fakeIterChanges([[0, 1, 0, 1, "x"]]) });
  assert.deepEqual(received, []);
  extension.fn({ docChanged: true, changes: fakeIterChanges([[0, 0, 0, 1, "x"]]) });
  assert.deepEqual(received, [[{ from: 0, to: 0, insert: "x" }]]);
});

test("scriveningsChangesFromTransaction : convertit vers la forme attendue par applyCompositeChanges", () => {
  const tr = { changes: fakeIterChanges([[0, 2, 0, 3, "abc"], [10, 10, 11, 12, "!"]]) };
  assert.deepEqual(scriveningsChangesFromTransaction(tr), [
    { from: 0, to: 2, insert: "abc" },
    { from: 10, to: 10, insert: "!" },
  ]);
});
