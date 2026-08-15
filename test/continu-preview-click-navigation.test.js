import { test } from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { PreviewView } from "../src/views/preview-view.js";
import { ScriveningsView } from "../src/views/scrivenings-view.js";
import { createSelectionScope } from "../src/services/compile-scope.js";
import { buildScriveningsDocument, locationToCompositeOffset } from "../src/services/scrivenings-document.js";
import {
  SOURCE_BLOCK_PATH_ATTR,
  SOURCE_START_LINE_ATTR,
  SOURCE_START_COL_ATTR,
  SOURCE_END_LINE_ATTR,
  SOURCE_END_COL_ATTR,
} from "../src/views/preview-source-map.js";

/* LOT « clic Preview → Continu » — §10-19 du micro-correctif.
 *
 * Deux volets distincts, testés séparément :
 *  A. PreviewView.onPreviewBlockClick() : le ROUTAGE — Continu lié →
 *     `continu.focusSourcePosition()`, jamais `openPreviewBlockInEditor()` ;
 *     Continu absent → comportement Markdown historique STRICTEMENT
 *     inchangé. `ContinuSourceView` est ici un simple objet exposant sa
 *     surface publique — jamais une vraie ScriveningsView.
 *  B. ScriveningsView.focusSourcePosition() : la CONVERSION réelle position
 *     source → curseur composite, avec un VRAI document Scrivenings
 *     (buildScriveningsDocument) et un faux CodeMirror minimal (dispatch/
 *     focus espionnés) — jamais de vrai EditorView monté. */

globalThis.window ??= {
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

const PROJECT_ROOT = "Roman/Manuscrit";
const SCOPE = createSelectionScope(PROJECT_ROOT, ["A.md", "B.md", "C.md"]);

/* ============================================================
 * A. Routage du clic (PreviewView.onPreviewBlockClick)
 * ============================================================ */

function fakeContinuForClick({ compileScope = SCOPE, result = true } = {}) {
  const calls = [];
  let syncingFromPreviewDuringCall = null;
  return {
    compileScope,
    async focusSourcePosition(path, position) {
      calls.push({ path, position });
      // Capturé SYNCHRONEMENT (avant tout `await`) : c'est le seul instant
      // fiable pour observer le garde anti-rebond posé par l'appelant.
      syncingFromPreviewDuringCall = this._viewDuringCall ? this._viewDuringCall.syncingFromPreview : null;
      return result;
    },
    calls,
    getSyncingFromPreviewDuringCall: () => syncingFromPreviewDuringCall,
  };
}

/** Élément DOM minimal : seul `closest()` est réellement exploité par
 * `onPreviewBlockClick`. `protectedHit` simule un clic sur un lien/bouton/
 * contrôle Feuillets — peu importe le sélecteur exact, il matche TOUT. */
function clickTarget({ protectedHit = false, block = null } = {}) {
  const target = {
    closest(selector) {
      if (protectedHit) return target;
      if (block && selector === `[${SOURCE_START_LINE_ATTR}]`) return block;
      return null;
    },
  };
  return target;
}

function blockElement({ path, startLine, startCol, endLine, endCol }) {
  const attrs = new Map([
    [SOURCE_BLOCK_PATH_ATTR, path],
    [SOURCE_START_LINE_ATTR, String(startLine)],
    [SOURCE_START_COL_ATTR, String(startCol)],
    [SOURCE_END_LINE_ATTR, String(endLine)],
    [SOURCE_END_COL_ATTR, String(endCol)],
  ]);
  return { getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null) };
}

function fakePreviewForClick({ continu = null } = {}) {
  const view = Object.create(PreviewView.prototype);
  Object.defineProperty(view, "compileScope", { value: continu ? continu.compileScope : null, configurable: true });
  view.plugin = { getCentralContinuView: () => continu };
  view.closed = false;
  view.releaseHandles = [];
  view.syncingFromPreview = false;
  view.explicitContinuSource = null;
  const openPreviewBlockInEditorCalls = [];
  view.openPreviewBlockInEditor = async (path, from, to) => {
    openPreviewBlockInEditorCalls.push({ path, from, to });
  };
  view.openPreviewBlockInEditorCalls = openPreviewBlockInEditorCalls;
  if (continu) continu._viewDuringCall = view;
  return view;
}

function makeEvent(target) {
  const calls = { preventDefault: 0 };
  return { target, preventDefault: () => { calls.preventDefault++; }, calls };
}

test("A. Continu lié, clic sur un passage valide : focusSourcePosition appelé, openPreviewBlockInEditor jamais, scope inchangé", async () => {
  const continu = fakeContinuForClick();
  const view = fakePreviewForClick({ continu });
  const block = blockElement({ path: "B.md", startLine: 3, startCol: 0, endLine: 4, endCol: 12 });
  const event = makeEvent(clickTarget({ block }));

  view.onPreviewBlockClick(event);
  await flush();

  assert.equal(event.calls.preventDefault, 1);
  assert.equal(continu.calls.length, 1);
  assert.deepEqual(continu.calls[0], { path: "B.md", position: { line: 3, ch: 0 } });
  assert.equal(view.openPreviewBlockInEditorCalls.length, 0, "jamais openPreviewBlockInEditor quand Continu est lié");
  assert.equal(view.compileScope, SCOPE, "le scope Preview reste inchangé");
  // Le garde anti-rebond était posé AU MOMENT de l'appel...
  assert.equal(continu.getSyncingFromPreviewDuringCall(), true);
  // ...et relâché ensuite (releaseAfterFrame), jamais laissé actif.
  assert.equal(view.syncingFromPreview, false);
});

test("B. Continu non lié : comportement Markdown historique — openPreviewBlockInEditor appelé", async () => {
  const view = fakePreviewForClick({ continu: null });
  Object.defineProperty(view, "compileScope", { value: SCOPE, configurable: true }); // scope Preview posé, mais aucun Continu central
  const block = blockElement({ path: "B.md", startLine: 3, startCol: 0, endLine: 4, endCol: 12 });
  const event = makeEvent(clickTarget({ block }));

  view.onPreviewBlockClick(event);
  await flush();

  assert.equal(event.calls.preventDefault, 1);
  assert.equal(view.openPreviewBlockInEditorCalls.length, 1);
  assert.deepEqual(view.openPreviewBlockInEditorCalls[0], {
    path: "B.md",
    from: { line: 3, ch: 0 },
    to: { line: 4, ch: 12 },
  });
});

test("C. Clic sur un lien/bouton/contrôle protégé : aucune navigation, ni Continu ni Markdown", async () => {
  const continu = fakeContinuForClick();
  const view = fakePreviewForClick({ continu });
  const event = makeEvent(clickTarget({ protectedHit: true }));

  view.onPreviewBlockClick(event);
  await flush();

  assert.equal(event.calls.preventDefault, 0);
  assert.equal(continu.calls.length, 0);
  assert.equal(view.openPreviewBlockInEditorCalls.length, 0);
});

test("D. path absent du Continu : focusSourcePosition renvoie false, aucun changement de scope, no-op propre", async () => {
  const continu = fakeContinuForClick({ result: false });
  const view = fakePreviewForClick({ continu });
  const block = blockElement({ path: "Z.md", startLine: 0, startCol: 0, endLine: 0, endCol: 5 });
  const event = makeEvent(clickTarget({ block }));

  view.onPreviewBlockClick(event);
  await flush();

  assert.equal(continu.calls.length, 1, "l'appel a bien lieu — c'est focusSourcePosition qui refuse en interne");
  assert.equal(view.compileScope, SCOPE, "scope inchangé même en cas d'échec");
  assert.equal(view.openPreviewBlockInEditorCalls.length, 0);
  assert.equal(view.syncingFromPreview, false, "le garde est relâché même après un échec");
});

test("aucun repère source exploitable : rien ne se passe (ni Continu ni Markdown)", () => {
  const continu = fakeContinuForClick();
  const view = fakePreviewForClick({ continu });
  const event = makeEvent(clickTarget({})); // ni protégé, ni bloc trouvé

  view.onPreviewBlockClick(event);

  assert.equal(event.calls.preventDefault, 0);
  assert.equal(continu.calls.length, 0);
});

/* ============================================================
 * B. ScriveningsView.focusSourcePosition()
 * ============================================================ */

function makeFile(path, basename) {
  const f = new TFile(path, "");
  f.path = path;
  f.name = `${basename}.md`;
  f.basename = basename;
  f.extension = "md";
  return f;
}

/** Vue Continu réelle (constructeur, pas Object.create) — mais CodeMirror
 * est un faux minimal (`cm`) : seuls `dispatch`/`focus` sont espionnés,
 * jamais un vrai montage. `session.load()` (API PUBLIQUE réelle) pose le
 * document, exactement comme `openScope()` le ferait après compilation. */
function buildView({ entries, diskContents = {} }) {
  const document = buildScriveningsDocument(entries);
  const reads = [];
  const app = {
    vault: {
      cachedRead: async (file) => {
        reads.push(file.path);
        return diskContents[file.path] ?? entries.find((e) => e.file.path === file.path).content;
      },
    },
  };
  const plugin = { app, settings: {} };
  const leaf = { app, contentEl: null };
  const view = new ScriveningsView(leaf, plugin);
  view.session.load(document);

  const dispatchCalls = [];
  let focusCalls = 0;
  view.cm = {
    dispatch: (spec) => { dispatchCalls.push(spec); },
    focus: () => { focusCalls++; },
  };

  return { view, document, dispatchCalls, getFocusCalls: () => focusCalls, reads };
}

test("focusSourcePosition — feuillet AVEC frontmatter YAML : curseur composite correct, aucun changement document", async () => {
  const file = makeFile("A.md", "A");
  const content = "---\ntitre: A\n---\nPremière ligne.\nDeuxième ligne.";
  const { view, document, dispatchCalls, getFocusCalls } = buildView({ entries: [{ file, content }] });

  // "Deuxième ligne." commence à la ligne 4 (0-based) du fichier complet
  // (---(0) titre(1) ---(2) Première ligne.(3) Deuxième ligne.(4)).
  const ok = await view.focusSourcePosition("A.md", { line: 4, ch: 0 });

  assert.equal(ok, true);
  const bodyOffset = "Première ligne.\n".length; // début de "Deuxième ligne."
  const expectedComposite = locationToCompositeOffset(view.session.document, "A.md", bodyOffset);
  assert.equal(dispatchCalls.length, 1);
  assert.deepEqual(dispatchCalls[0].selection, { anchor: expectedComposite, head: expectedComposite });
  assert.ok(dispatchCalls[0].effects, "un effet de recentrage est transmis");
  assert.equal(getFocusCalls(), 1);
  // Aucun changement du document : le body du segment reste identique.
  assert.equal(view.session.document.segments[0].body, document.segments[0].body);
  assert.equal(view.session.dirtyCount, 0);
});

test("focusSourcePosition — feuillet SANS frontmatter : conversion directe, première ligne du body", async () => {
  const file = makeFile("B.md", "B");
  const content = "Corps sans YAML.\nDeuxième ligne.";
  const { view, dispatchCalls } = buildView({ entries: [{ file, content }] });

  const ok = await view.focusSourcePosition("B.md", { line: 0, ch: 0 });

  assert.equal(ok, true);
  const expectedComposite = locationToCompositeOffset(view.session.document, "B.md", 0);
  assert.deepEqual(dispatchCalls[0].selection, { anchor: expectedComposite, head: expectedComposite });
});

test("focusSourcePosition — CRLF : la position reste correcte", async () => {
  const file = makeFile("C.md", "C");
  const content = "---\r\ntitre: C\r\n---\r\nLigne un.\r\nLigne deux cible.";
  const { view, dispatchCalls } = buildView({ entries: [{ file, content }] });

  // Ligne 4 (0-based) = "Ligne deux cible.", ch=6 -> après "Ligne ".
  const ok = await view.focusSourcePosition("C.md", { line: 4, ch: 6 });

  assert.equal(ok, true);
  const bodyOffset = "Ligne un.\r\n".length + 6;
  const expectedComposite = locationToCompositeOffset(view.session.document, "C.md", bodyOffset);
  assert.deepEqual(dispatchCalls[0].selection, { anchor: expectedComposite, head: expectedComposite });
});

test("focusSourcePosition — corps VIVANT (édité dans Continu) différent du disque : la position suit le corps vivant", async () => {
  const file = makeFile("D.md", "D");
  const diskContent = "---\ntitre: D\n---\nAncien texte.";
  // Le document composite chargé représente le corps VIVANT, déjà modifié
  // depuis le disque (comme après une frappe dans Continu, jamais encore
  // sauvegardée) — `buildView` simule ceci en donnant au disque un contenu
  // DIFFÉRENT de celui utilisé pour construire le document.
  const liveContent = "---\ntitre: D\n---\nNouveau texte vivant.";
  const { view, dispatchCalls, reads } = buildView({
    entries: [{ file, content: liveContent }],
    diskContents: { "D.md": diskContent },
  });

  const ok = await view.focusSourcePosition("D.md", { line: 3, ch: 8 });

  assert.equal(ok, true);
  assert.deepEqual(reads, ["D.md"], "le disque n'est relu QUE pour le frontmatter");
  const bodyOffset = 8; // "Nouveau texte vivant." — ch=8 après "Nouveau "
  const expectedComposite = locationToCompositeOffset(view.session.document, "D.md", bodyOffset);
  assert.deepEqual(dispatchCalls[0].selection, { anchor: expectedComposite, head: expectedComposite });
});

test("focusSourcePosition — ligne au milieu d'un feuillet à plusieurs paragraphes", async () => {
  const file = makeFile("E.md", "E");
  const content = "Para un.\n\nPara deux.\n\nPara trois cible.";
  const { view, dispatchCalls } = buildView({ entries: [{ file, content }] });

  const ok = await view.focusSourcePosition("E.md", { line: 4, ch: 5 });

  assert.equal(ok, true);
  const bodyOffset = "Para un.\n\nPara deux.\n\n".length + 5;
  const expectedComposite = locationToCompositeOffset(view.session.document, "E.md", bodyOffset);
  assert.deepEqual(dispatchCalls[0].selection, { anchor: expectedComposite, head: expectedComposite });
});

test("focusSourcePosition — position hors limites (ligne/colonne au-delà de la fin) : bornée proprement, jamais d'exception", async () => {
  const file = makeFile("F.md", "F");
  const content = "Une seule ligne.";
  const { view, dispatchCalls } = buildView({ entries: [{ file, content }] });

  const ok = await view.focusSourcePosition("F.md", { line: 999, ch: 999 });

  assert.equal(ok, true);
  const expectedComposite = locationToCompositeOffset(view.session.document, "F.md", content.length);
  assert.deepEqual(dispatchCalls[0].selection, { anchor: expectedComposite, head: expectedComposite });
});

test("focusSourcePosition — path absent de la composition actuelle : false, aucun dispatch", async () => {
  const file = makeFile("G.md", "G");
  const { view, dispatchCalls, getFocusCalls } = buildView({ entries: [{ file, content: "Texte." }] });

  const ok = await view.focusSourcePosition("Inconnu.md", { line: 0, ch: 0 });

  assert.equal(ok, false);
  assert.equal(dispatchCalls.length, 0);
  assert.equal(getFocusCalls(), 0);
});

test("focusSourcePosition — aucun scope chargé (CodeMirror pas encore monté) : false", async () => {
  const file = makeFile("H.md", "H");
  const { view } = buildView({ entries: [{ file, content: "Texte." }] });
  view.cm = null;

  const ok = await view.focusSourcePosition("H.md", { line: 0, ch: 0 });
  assert.equal(ok, false);
});
