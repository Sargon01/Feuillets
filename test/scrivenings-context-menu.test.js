import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { t } from "../src/i18n/index.js";
import { paragraphReorderModeField } from "../src/utils/cm-paragraph-reorder.js";
import { ScriveningsSegmentEditorAdapter } from "../src/utils/scrivenings-editor-adapter.js";

/* LOT 1.4 — Menu contextuel Continu. Le plugin est exercé via
   Object.create(FeuilletsPlugin.prototype), même patron que
   test/editor-context-menu-unification.test.js : le stub Obsidian de test
   n'exporte pas `Plugin`, l'instanciation réelle échouerait. */

function harness() {
  const consent = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  consent.children = [manuscript];
  manuscript.parent = consent;
  const files = new Map([[consent.path, consent], [manuscript.path, manuscript]]);
  const app = { workspace: { on: () => ({}), getActiveFile: () => null }, vault: { getAbstractFileByPath: (p) => files.get(p) || null } };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.settings = { projectFolder: manuscript.path };
  plugin.getProjectFolder = () => manuscript;
  plugin.annotationMenuStyle = "highlight";
  plugin.annotationMenuColor = "yellow";
  plugin.openCaptureIdeaModal = () => {
    plugin.captureIdeaOpened = true;
  };
  return { plugin, manuscript };
}

function makeSegment() {
  const file = new TFile("Projet/Manuscrit/A.md");
  const body = "Alpha bravo.";
  return { file, path: file.path, frontmatter: "", body, from: 0, to: body.length };
}

function makeFixture({ selection = { from: 0, to: 0, empty: true }, reorderActive = false, text = null } = {}) {
  const segment = makeSegment();
  let compositeText = text ?? segment.body;
  const state = {
    doc: {
      get length() { return compositeText.length; },
      sliceString: (f, t2 = compositeText.length) => compositeText.slice(f, t2),
    },
    selection: { main: selection },
    field: (field) => (field === paragraphReorderModeField ? reorderActive : undefined),
  };
  const dispatched = [];
  const editorView = {
    state,
    dispatch(spec) {
      dispatched.push(spec);
      if (spec.changes) {
        const { from, to, insert } = spec.changes;
        compositeText = compositeText.slice(0, from) + insert + compositeText.slice(to);
        segment.body = compositeText;
        segment.to = segment.from + compositeText.length;
      }
      if (spec.selection) {
        state.selection = {
          main: {
            from: spec.selection.anchor,
            to: spec.selection.head ?? spec.selection.anchor,
            empty: (spec.selection.head ?? spec.selection.anchor) === spec.selection.anchor,
          },
        };
      }
    },
    focus() {},
  };
  const view = {
    editorView,
    getSegmentByPath: (p) => (p === segment.path ? segment : null),
    resolveEditorContext: () => ({
      file: segment.file,
      segment,
      compositeOffset: selection.to,
      bodyOffset: selection.to,
      fileOffset: segment.frontmatter.length + selection.to,
    }),
    refreshAnnotationHighlights: async () => {},
  };
  return { view, segment, dispatched, editorView };
}

/* --- §56 — menu exact ------------------------------------------------------- */

test("§56 — menu Continu : Couper/Copier/Coller, Note de bas de page, Annotation, Noter une idée, Réorganiser le texte — rien d'autre", () => {
  const { plugin } = harness();
  const { view } = makeFixture();
  plugin.showScriveningsContextMenu(view, { clientX: 0, clientY: 0 });
  const menu = Menu.lastShown;
  assert.ok(menu, "un menu doit avoir été affiché");
  const titles = menu.items.map((i) => (i.separator ? "---" : i.title));
  assert.deepEqual(titles, [
    t("editorMenu.cut"),
    t("editorMenu.copy"),
    t("editorMenu.paste"),
    "---",
    t("editorMenu.footnote"),
    t("editorMenu.annotation"),
    t("editorMenu.captureIdea"),
    "---",
    t("editorMenu.reorderParagraphs"),
  ]);
});

/* --- §46 — jamais d'action structurelle ------------------------------------- */

test("§46 — le menu Continu ne contient jamais Scinder/Dupliquer/Déplacer", () => {
  const { plugin } = harness();
  const { view } = makeFixture();
  plugin.showScriveningsContextMenu(view, { clientX: 0, clientY: 0 });
  const menu = Menu.lastShown;
  const titles = menu.items.filter((i) => !i.separator).map((i) => i.title);
  for (const word of ["Scinder", "Dupliquer", "Déplacer"]) {
    assert.equal(titles.some((title) => title.includes(word)), false, `« ${word} » ne doit jamais apparaître`);
  }
});

/* --- §41/§67 — état du mode Réorganisation, propre à CET EditorView -------- */

test("§41 — « Réorganiser le texte » n'est pas coché quand le mode est inactif, et bascule d'UNE dispatch au clic", () => {
  const { plugin } = harness();
  const { view, dispatched } = makeFixture({ reorderActive: false });
  plugin.showScriveningsContextMenu(view, { clientX: 0, clientY: 0 });
  const menu = Menu.lastShown;
  const item = menu.items.find((i) => i.title === t("editorMenu.reorderParagraphs"));
  assert.equal(item.checked, false);
  item.callback();
  assert.equal(dispatched.length, 1);
});

test("§41 — « Réorganiser le texte » est coché quand le mode est déjà actif sur CET EditorView", () => {
  const { plugin } = harness();
  const { view } = makeFixture({ reorderActive: true });
  plugin.showScriveningsContextMenu(view, { clientX: 0, clientY: 0 });
  const menu = Menu.lastShown;
  const item = menu.items.find((i) => i.title === t("editorMenu.reorderParagraphs"));
  assert.equal(item.checked, true);
});

/* --- §66 — Noter une idée --------------------------------------------------- */

test("§66 — « Noter une idée » appelle exactement openCaptureIdeaModal, aucune modification texte", () => {
  const { plugin } = harness();
  const { view, dispatched } = makeFixture();
  plugin.showScriveningsContextMenu(view, { clientX: 0, clientY: 0 });
  const menu = Menu.lastShown;
  const item = menu.items.find((i) => i.title === t("editorMenu.captureIdea"));
  item.callback();
  assert.equal(plugin.captureIdeaOpened, true);
  assert.equal(dispatched.length, 0, "aucune transaction texte");
});

/* --- Cut / Copy / Paste (§57-59) ------------------------------------------- */

function withClipboard(writeTextImpl, readTextImpl) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: writeTextImpl, readText: readTextImpl } },
    configurable: true,
    writable: true,
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  };
}

test("§57 — Copier : clipboard reçoit exactement la sélection, 0 transaction texte", async () => {
  const { plugin } = harness();
  const { editorView, dispatched } = makeFixture({ selection: { from: 0, to: 5, empty: false } });
  let written = null;
  const restore = withClipboard(async (text) => { written = text; });
  try {
    await plugin.scriveningsCopy(editorView);
  } finally {
    restore();
  }
  assert.equal(written, "Alpha");
  assert.equal(dispatched.length, 0);
});

test("§58 — Couper : succès clipboard → UNE transaction de suppression", async () => {
  const { plugin } = harness();
  const { editorView, dispatched, segment } = makeFixture({ selection: { from: 0, to: 5, empty: false } });
  let written = null;
  const restore = withClipboard(async (text) => { written = text; });
  try {
    await plugin.scriveningsCut(editorView, { segment }, new ScriveningsSegmentEditorAdapter(editorView, segment.path, (p) => (p === segment.path ? segment : null)));
  } finally {
    restore();
  }
  assert.equal(written, "Alpha");
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].changes.insert, "");
});

test("§58 — Couper : échec clipboard → 0 suppression", async () => {
  const { plugin } = harness();
  const { editorView, dispatched, segment } = makeFixture({ selection: { from: 0, to: 5, empty: false } });
  const restore = withClipboard(async () => { throw new Error("denied"); });
  try {
    await plugin.scriveningsCut(editorView, { segment }, new ScriveningsSegmentEditorAdapter(editorView, segment.path, (p) => (p === segment.path ? segment : null)));
  } finally {
    restore();
  }
  assert.equal(dispatched.length, 0);
});

test("§59 — Coller : caret vide → UNE insertion", async () => {
  const { plugin } = harness();
  const { editorView, dispatched, segment } = makeFixture({ selection: { from: 3, to: 3, empty: true } });
  const restore = withClipboard(async () => {}, async () => "XYZ");
  try {
    await plugin.scriveningsPaste(editorView, { segment }, new ScriveningsSegmentEditorAdapter(editorView, segment.path, (p) => (p === segment.path ? segment : null)));
  } finally {
    restore();
  }
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].changes.insert, "XYZ");
});

test("§59 — Coller : sélection cross-segment → 0 transaction", async () => {
  const { plugin } = harness();
  const { editorView, dispatched, segment } = makeFixture({ selection: { from: 0, to: makeSegment().body.length + 5, empty: false } });
  const restore = withClipboard(async () => {}, async () => "XYZ");
  try {
    await plugin.scriveningsPaste(editorView, { segment }, new ScriveningsSegmentEditorAdapter(editorView, segment.path, (p) => (p === segment.path ? segment : null)));
  } finally {
    restore();
  }
  assert.equal(dispatched.length, 0);
});
