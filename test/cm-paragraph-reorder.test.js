import test from "node:test";
import assert from "node:assert/strict";
import {
  paragraphReorderModeField,
  setParagraphReorderModeEffect,
  toggleParagraphReorderMode,
  REORDER_DRAG_THRESHOLD,
  exceedsDragThreshold,
  draggableBlockAt,
  seamIndexForOffset,
  segmentRangeFromBoundaries,
  inSameSegment,
  segmentRangeForFrontmatter,
  overlayRectFor,
  sourceOverlayRectFor,
  autoScrollDelta,
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_PX_PER_FRAME,
  REORDER_HOVER_CLASS,
  REORDER_DRAGGING_CLASS,
  REORDER_INSERTION_LINE_CLASS,
  REORDER_SOURCE_OVERLAY_CLASS,
  REORDER_SOURCE_DRAGGING_CLASS,
  REORDER_MODE_INDICATOR_CLASS,
  REORDER_MODE_INDICATOR_LABEL_CLASS,
  REORDER_MODE_INDICATOR_HINT_CLASS,
  createParagraphReorderExtension,
} from "../src/utils/cm-paragraph-reorder.js";
import { resolveMarkdownBlocks } from "../src/utils/paragraph-reorder-core.js";
import { setLocale, t } from "../src/i18n/index.js";

/* ==================== Harness : requestAnimationFrame contrôlable ==================== */

/** Remplace `globalThis.window` par un stub RAF déterministe — une frame ne
 * s'exécute que via `runNextFrame()`, jamais automatiquement (même
 * principe que test/preview-view.test.js). Restaure l'état précédent après
 * le test. */
function withFakeWindow(fn) {
  const previous = globalThis.window;
  let nextId = 1;
  const frames = new Map();
  globalThis.window = {
    requestAnimationFrame: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id) => {
      frames.delete(id);
    },
  };
  try {
    fn({
      pendingFrames: () => frames.size,
      /** Exécute LA frame la plus ancienne encore en attente (si `step()`
       * en programme une nouvelle, elle n'est PAS jouée ici). */
      runNextFrame: () => {
        const [id] = frames.keys();
        if (id === undefined) return false;
        const cb = frames.get(id);
        frames.delete(id);
        cb();
        return true;
      },
    });
  } finally {
    globalThis.window = previous;
  }
}

/* ==================== Harness : pipeline pointer réel (§18) ==================== */

function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, force) => {
      const want = force === undefined ? !set.has(c) : force;
      if (want) set.add(c);
      else set.delete(c);
      return want;
    },
    contains: (c) => set.has(c),
  };
}

function makeFakeDocument() {
  const created = [];
  const keydownListeners = []; // { listener, capture }
  return {
    created,
    createElement: (tag) => {
      const children = [];
      const listeners = {};
      const el = {
        tag,
        classList: makeClassList(),
        style: {},
        attrs: {},
        textContent: "",
        removed: false,
        children,
        setAttribute(name, value) {
          el.attrs[name] = value;
        },
        appendChild(child) {
          children.push(child);
        },
        addEventListener(type, listener) {
          (listeners[type] ||= []).push(listener);
        },
        dispatchClick() {
          for (const listener of listeners.click || []) listener({ type: "click" });
        },
        remove() {
          el.removed = true;
          // `el._parentList` : la liste (body.created OU dom.domChildren)
          // dans laquelle l'élément a été inséré — jamais supposé être
          // `created` ; un enfant de `view.dom` (l'indicateur, §18-19) vit
          // dans `domChildren`, pas dans `body`.
          const list = el._parentList;
          if (list) {
            const idx = list.indexOf(el);
            if (idx >= 0) list.splice(idx, 1);
          }
        },
      };
      return el;
    },
    body: {
      appendChild: (el) => {
        el._parentList = created;
        created.push(el);
      },
    },
    /* Écoute Escape « hors éditeur » (§14 du correctif) — un vrai
     * `EventTarget` distinguerait capture/bubble ; ici, une seule liste
     * suffit puisque `keydown` n'est branché qu'avec `capture: true`. */
    addEventListener: (type, listener, capture) => {
      if (type === "keydown") keydownListeners.push({ listener, capture: !!capture });
    },
    removeEventListener: (type, listener) => {
      if (type !== "keydown") return;
      const idx = keydownListeners.findIndex((entry) => entry.listener === listener);
      if (idx >= 0) keydownListeners.splice(idx, 1);
    },
    /** Simule un `keydown` réel sur `ownerDocument`, indépendant du focus
     * de `view.dom` — c'est le scénario du bug runtime (§14, §28). */
    dispatchKeydown(event) {
      for (const { listener } of [...keydownListeners]) listener(event);
    },
    keydownListenerCount: () => keydownListeners.length,
  };
}

/** Fabrique une vue CodeMirror minimale mais RÉALISTE pour exercer le
 * pipeline pointerdown → pointermove → pointerup réel — jamais seulement
 * les helpers purs (§18). `posMap`/`coordsMap` : fonctions explicites
 * pixel → position document / position document → rect, pour découpler
 * entièrement l'espace écran de l'espace texte dans les tests. */
function makeFakeView({
  text,
  posMap = () => null,
  coordsMap = () => null,
  contentRect = { left: 0, right: 800, top: 0, bottom: 600 },
  scrollRect = { left: 0, right: 800, top: 0, bottom: 600 },
  scrollTop = 0,
}) {
  let doc = text;
  let mode = false;
  let currentScrollTop = scrollTop;
  const dispatchCalls = [];
  const capturedIds = [];
  const ownerDocument = makeFakeDocument();
  const domChildren = [];
  const dom = {
    classList: makeClassList(),
    ownerDocument,
    appendChild: (el) => {
      el._parentList = domChildren;
      domChildren.push(el);
    },
  };
  const contentDOM = {
    getBoundingClientRect: () => contentRect,
    setPointerCapture: (id) => capturedIds.push(id),
    releasePointerCapture: (id) => {
      const idx = capturedIds.indexOf(id);
      if (idx >= 0) capturedIds.splice(idx, 1);
    },
  };
  const scrollDOM = {
    getBoundingClientRect: () => scrollRect,
    get scrollTop() {
      return currentScrollTop;
    },
    set scrollTop(v) {
      currentScrollTop = v;
    },
  };
  const view = {
    dom,
    contentDOM,
    scrollDOM,
    posAtCoords: ({ x, y }) => posMap(x, y),
    coordsAtPos: (pos) => coordsMap(pos),
    state: {
      get doc() {
        return { length: doc.length, toString: () => doc, sliceString: (from, to) => doc.slice(from, to === undefined ? doc.length : to) };
      },
      field: (field) => (field === paragraphReorderModeField ? mode : undefined),
    },
    dispatch: (spec) => {
      dispatchCalls.push(spec);
      if (spec.effects && typeof spec.effects === "object" && "value" in spec.effects) mode = spec.effects.value;
      if (spec.changes) {
        const { from, to, insert } = spec.changes;
        doc = doc.slice(0, from) + insert + doc.slice(to);
      }
    },
  };
  return {
    view,
    dispatchCalls,
    capturedIds,
    ownerDocument,
    domChildren,
    getText: () => doc,
    getScrollTop: () => currentScrollTop,
    setMode: (v) => {
      mode = v;
    },
    isModeActive: () => mode,
  };
}

/** Filtre `created` par classe — nécessaire depuis que DEUX overlays
 * peuvent coexister pendant `dragging` (ligne d'insertion + source, §4-8
 * du correctif) : un compte brut de `created.length` ne suffit plus à lui
 * seul à distinguer lequel est présent. */
function elementsWithClass(created, cls) {
  return created.filter((el) => el.classList.contains(cls));
}

function makePointerEvent(overrides) {
  let defaultPrevented = false;
  return {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...overrides,
    preventDefault() {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
  };
}

function makeKeyEvent(key) {
  let defaultPrevented = false;
  return {
    key,
    preventDefault() {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
  };
}

/** Instancie le ViewPlugin réel via `__viewPluginSpec` (posé par le stub de
 * test, test/codemirror-view-stub.mjs) — jamais une réimplémentation, on
 * exerce directement les mêmes eventHandlers que le PluginSpec réel. */
function instantiatePlugin(fake) {
  const ext = createParagraphReorderExtension();
  const PluginClass = ext[1];
  const spec = PluginClass.__viewPluginSpec;
  assert.ok(spec && spec.eventHandlers, "le PluginSpec doit porter eventHandlers (§2-4)");
  const instance = new PluginClass(fake.view);
  return { instance, handlers: spec.eventHandlers };
}

/* ==================== §65 : mode StateField / StateEffect ==================== */

test("paragraphReorderModeField : create() est false, un effet remplace la valeur", () => {
  assert.equal(paragraphReorderModeField.create(), false);
  const next = paragraphReorderModeField.update(false, {
    docChanged: false,
    effects: [{ is: (type) => type === setParagraphReorderModeEffect, value: true }],
    changes: null,
  });
  assert.equal(next, true);
});

test("toggleParagraphReorderMode : bascule et dispatch un unique effet, propre à CETTE vue", () => {
  const dispatched = [];
  let modeValue = false;
  const view = { state: { field: () => modeValue }, dispatch: (spec) => dispatched.push(spec) };
  const next = toggleParagraphReorderMode(view);
  assert.equal(next, true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].effects.value, true);
});

/* ==================== §66 : seuil du geste (5px, helper pur) ==================== */

test("exceedsDragThreshold : seuil exact 5px", () => {
  assert.equal(REORDER_DRAG_THRESHOLD, 5);
  assert.equal(exceedsDragThreshold(0, 0, 4, 0), false);
  assert.equal(exceedsDragThreshold(0, 0, 5, 0), true);
});

/* ==================== helpers purs déjà couverts (blocs, seams, segments) ==================== */

test("draggableBlockAt : reconnaît un Paragraph, jamais un autre type de bloc", () => {
  const text = "A.\n\n## Titre\n\nB.";
  const blocks = resolveMarkdownBlocks(text);
  assert.equal(draggableBlockAt(blocks, 1)?.type, "Paragraph");
  assert.equal(draggableBlockAt(blocks, 6), null);
});

test("seamIndexForOffset : la moitié survolée d'un bloc choisit avant/après lui", () => {
  const text = "A.\n\nB.\n\nC.";
  const blocks = resolveMarkdownBlocks(text);
  assert.equal(seamIndexForOffset(blocks, 0), 0);
  assert.equal(seamIndexForOffset(blocks, 5), 2);
  assert.equal(seamIndexForOffset(blocks, 9), 3);
});

test("segmentRangeFromBoundaries / inSameSegment : garde de segment Continu", () => {
  const boundaries = [3, 7];
  assert.deepEqual(segmentRangeFromBoundaries(boundaries, 11, 5), { from: 4, to: 7 });
  assert.equal(inSameSegment(boundaries, 11, 1, 5), false);
});

test("segmentRangeForFrontmatter : réutilise splitFrontmatter, jamais une nouvelle regex", () => {
  const text = "---\ntitle: Test\n---\nPremier paragraphe.";
  const range = segmentRangeForFrontmatter(text);
  assert.equal(text.slice(range.from), "Premier paragraphe.");
});

test("overlayRectFor : ancre en haut de la seam (avant un bloc) ou en bas (après le dernier), largeur = contentDOM", () => {
  const seamRect = { left: 5, right: 5, top: 100, bottom: 120 };
  const contentRect = { left: 40, right: 640, top: 0, bottom: 800 };
  assert.deepEqual(overlayRectFor(seamRect, false, contentRect), { top: 100, left: 40, width: 600 });
  assert.deepEqual(overlayRectFor(seamRect, true, contentRect), { top: 120, left: 40, width: 600 });
});

/* ==================== §20-21 : composition de l'extension ==================== */

test("createParagraphReorderExtension : compose le StateField de mode + un ViewPlugin dont le PluginSpec porte eventHandlers (jamais decorations)", () => {
  const ext = createParagraphReorderExtension();
  assert.equal(ext.length, 2);
  assert.equal(ext[0], paragraphReorderModeField);
  const spec = ext[1].__viewPluginSpec;
  assert.ok(spec.eventHandlers);
  assert.equal(typeof spec.eventHandlers.pointerdown, "function");
  assert.equal(typeof spec.eventHandlers.pointermove, "function");
  assert.equal(typeof spec.eventHandlers.pointerup, "function");
  assert.equal(typeof spec.eventHandlers.pointercancel, "function");
  assert.equal(typeof spec.eventHandlers.pointerleave, "function");
  assert.equal(typeof spec.eventHandlers.keydown, "function");
  assert.equal(spec.decorations, undefined, "aucun widget de bloc, aucune décoration (§6 du correctif)");
});

/* ==================== §19 : pointerdown ==================== */

test("pointerdown en mode actif, à l'intérieur d'un Paragraph : preventDefault, true, capture posée, 0 changement texte", () => {
  const text = "A.\n\nB.\n\nC.";
  const fake = makeFakeView({ text, posMap: () => 5 }); // 5 : à l'intérieur de "B."
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  const event = makePointerEvent({ clientX: 10, clientY: 10 });
  const handled = handlers.pointerdown.call(instance, event);
  assert.equal(handled, true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(fake.capturedIds, [1]);
  assert.equal(fake.dispatchCalls.length, 0);
});

test("pointerdown sur un bloc NON Paragraph (Heading) : false, aucun preventDefault, aucune capture, aucune transaction", () => {
  const text = "A.\n\n## Titre\n\nB.";
  const blocks = resolveMarkdownBlocks(text);
  const headingPos = blocks.find((b) => b.type === "ATXHeading2").from + 1;
  const fake = makeFakeView({ text, posMap: () => headingPos });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  const event = makePointerEvent({ clientX: 10, clientY: 10 });
  const handled = handlers.pointerdown.call(instance, event);
  assert.equal(handled, false);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(fake.capturedIds, []);
  assert.equal(fake.dispatchCalls.length, 0);
});

/* ==================== §20 : seuil ==================== */

test("pointermove sous 5px reste pending (true, 0 transaction, aucun overlay) ; au-delà, dragging observable + overlay", () => {
  const text = "A.\n\nB.\n\nC.";
  let coords = null; // position sous le pointeur pendant le drag
  const fake = makeFakeView({
    text,
    posMap: () => (coords === null ? 5 : coords),
    coordsMap: (pos) => ({ left: 0, right: 0, top: pos * 2, bottom: pos * 2 + 14 }),
  });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  handlers.pointerdown.call(instance, makePointerEvent({ clientX: 10, clientY: 10 }));

  const small = handlers.pointermove.call(instance, makePointerEvent({ clientX: 13, clientY: 10 })); // 3px
  assert.equal(small, true);
  assert.equal(fake.dispatchCalls.length, 0);
  assert.equal(fake.ownerDocument.created.length, 0, "aucun overlay avant dépassement du seuil");

  coords = 9; // cible : à l'intérieur/à la fin de "C."
  const big = handlers.pointermove.call(instance, makePointerEvent({ clientX: 20, clientY: 10 })); // >5px
  assert.equal(big, true);
  assert.equal(fake.dispatchCalls.length, 0, "toujours aucune modification tant que pointerup n'a pas eu lieu");
  assert.equal(fake.view.dom.classList.contains(REORDER_DRAGGING_CLASS), true);
  assert.equal(
    elementsWithClass(fake.ownerDocument.created, REORDER_INSERTION_LINE_CLASS).length,
    1,
    "la ligne d'insertion est créée au premier target valide pendant dragging"
  );
  assert.equal(
    elementsWithClass(fake.ownerDocument.created, REORDER_SOURCE_OVERLAY_CLASS).length,
    1,
    "l'overlay source du Paragraph déplacé est créé lui aussi (§5 du correctif)"
  );
});

/* ==================== §21 : pointerup — LA régression principale ==================== */

test("pointerup après un drag valide (A → seam après C) : UNE seule dispatch {changes, selection}, capture relâchée, overlay supprimé, mode toujours actif", () => {
  const text = "A.\n\nB.\n\nC.";
  let pos = 0; // "A."
  const fake = makeFakeView({
    text,
    // Après le drop, pointerup recalcule le hover (§7) avec les coordonnées
    // de l'événement : clientX 999 → hors de tout Paragraph, pour isoler
    // cette assertion de l'overlay source (testé séparément, §24).
    posMap: (x) => (x === 999 ? null : pos),
    coordsMap: (p) => ({ left: 0, right: 0, top: p * 2, bottom: p * 2 + 14 }),
  });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  handlers.pointerdown.call(instance, makePointerEvent({ clientX: 0, clientY: 0, pointerId: 7 }));
  assert.deepEqual(fake.capturedIds, [7]);

  pos = 9; // seam après C
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 50, clientY: 0, pointerId: 7 }));
  assert.equal(elementsWithClass(fake.ownerDocument.created, REORDER_INSERTION_LINE_CLASS).length, 1);
  assert.equal(elementsWithClass(fake.ownerDocument.created, REORDER_SOURCE_OVERLAY_CLASS).length, 1);

  const handled = handlers.pointerup.call(instance, makePointerEvent({ pointerId: 7, clientX: 999, clientY: 0 }));
  assert.equal(handled, true);

  assert.equal(fake.getText(), "B.\n\nC.\n\nA.");
  const textDispatches = fake.dispatchCalls.filter((d) => d.changes);
  assert.equal(textDispatches.length, 1, "EXACTEMENT une dispatch contenant `changes`");
  assert.ok(textDispatches[0].selection, "la même dispatch contient aussi `selection`");
  assert.deepEqual(fake.capturedIds, [], "releasePointerCapture appelé");
  assert.equal(fake.ownerDocument.created.length, 0, "overlay supprimé");
  assert.equal(fake.view.dom.classList.contains(REORDER_DRAGGING_CLASS), false);
  assert.equal(fake.isModeActive(), true, "le mode reste actif après un drop réussi (§12/§31)");
});

test("pointerup sans dépassement du seuil (toujours pending) : aucun déplacement, nettoyage, mode reste actif", () => {
  const text = "A.\n\nB.\n\nC.";
  const fake = makeFakeView({ text, posMap: () => 5, coordsMap: () => null });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  handlers.pointerdown.call(instance, makePointerEvent({ clientX: 10, clientY: 10, pointerId: 3 }));
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 12, clientY: 10, pointerId: 3 })); // 2px : reste pending
  const handled = handlers.pointerup.call(instance, makePointerEvent({ pointerId: 3 }));

  assert.equal(handled, true);
  assert.equal(fake.getText(), text, "aucune modification");
  assert.equal(fake.dispatchCalls.filter((d) => d.changes).length, 0);
  assert.equal(fake.isModeActive(), true);
});

/* ==================== §22 : ligne d'insertion (overlay DOM) ==================== */

test("overlay : exactement un élément .feuillets-reorder-insertion-line pendant dragging valide, position fixed, coordonnées mises à jour ; supprimé si destination invalide", () => {
  const text = "A.\n\nB.\n\nC.";
  let pos = 4; // "B."
  let coordsValid = true;
  const fake = makeFakeView({
    text,
    // clientX 999 : hors de tout Paragraph — isole cette assertion de
    // l'overlay source recalculé au hover après pointerup (§7, testé
    // séparément en §24).
    posMap: (x) => (x === 999 ? null : pos),
    coordsMap: (p) => (coordsValid ? { left: 0, right: 0, top: p * 2, bottom: p * 2 + 14 } : null),
  });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  handlers.pointerdown.call(instance, makePointerEvent({ clientX: 0, clientY: 0 }));
  pos = 9;
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 50, clientY: 0 }));

  assert.equal(elementsWithClass(fake.ownerDocument.created, REORDER_INSERTION_LINE_CLASS).length, 1);
  const overlay = fake.ownerDocument.created.find((el) => el.classList.contains(REORDER_INSERTION_LINE_CLASS));
  assert.equal(overlay.attrs["aria-hidden"], "true");
  // `position: fixed` vit dans la classe CSS (styles.css), jamais posé en
  // JS (obsidianmd/no-static-styles-assignment) — seule la classe compte ici.
  assert.ok(overlay.classList.contains(REORDER_INSERTION_LINE_CLASS));
  const firstTop = overlay.style.top;

  pos = 1; // toujours dans B : la seam change → la position doit bouger
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 51, clientY: 0 }));
  assert.equal(
    elementsWithClass(fake.ownerDocument.created, REORDER_INSERTION_LINE_CLASS).length,
    1,
    "toujours un seul élément, jamais empilé"
  );
  assert.notEqual(overlay.style.top, firstTop);

  coordsValid = false; // destination visuellement invalide (§8) — retire aussi l'overlay source (mêmes coordonnées)
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 52, clientY: 0 }));
  assert.equal(fake.ownerDocument.created.length, 0, "supprimé sans résidu");

  coordsValid = true;
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 53, clientY: 0 }));
  assert.equal(elementsWithClass(fake.ownerDocument.created, REORDER_INSERTION_LINE_CLASS).length, 1);
  handlers.pointerup.call(instance, makePointerEvent({ clientX: 999, clientY: 0 }));
  assert.equal(fake.ownerDocument.created.length, 0, "aucun élément après pointerup");
});

/* ==================== §23 : pointercancel ==================== */

test("pointercancel pendant dragging : release, 0 transaction, overlay absent, dragging retiré, mode toujours actif", () => {
  const text = "A.\n\nB.\n\nC.";
  let pos = 4;
  const fake = makeFakeView({ text, posMap: () => pos, coordsMap: (p) => ({ left: 0, right: 0, top: p, bottom: p + 10 }) });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  handlers.pointerdown.call(instance, makePointerEvent({ clientX: 0, clientY: 0, pointerId: 9 }));
  pos = 9;
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 50, clientY: 0, pointerId: 9 }));
  assert.equal(fake.ownerDocument.created.length, 2, "ligne d'insertion + overlay source (§5)");

  const handled = handlers.pointercancel.call(instance, makePointerEvent({ pointerId: 9 }));
  assert.equal(handled, true);
  assert.equal(fake.getText(), text);
  assert.deepEqual(fake.capturedIds, []);
  assert.equal(fake.ownerDocument.created.length, 0);
  assert.equal(fake.view.dom.classList.contains(REORDER_DRAGGING_CLASS), false);
  assert.equal(fake.isModeActive(), true);
});

/* ==================== §24 : Escape — un seul geste ==================== */

test("Escape pendant dragging : 0 commit, release, overlay supprimé, dragging retiré, mode false — UN seul Escape", () => {
  const text = "A.\n\nB.\n\nC.";
  let pos = 4;
  const fake = makeFakeView({ text, posMap: () => pos, coordsMap: (p) => ({ left: 0, right: 0, top: p, bottom: p + 10 }) });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  handlers.pointerdown.call(instance, makePointerEvent({ clientX: 0, clientY: 0, pointerId: 4 }));
  pos = 9;
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 50, clientY: 0, pointerId: 4 }));
  assert.equal(fake.ownerDocument.created.length, 2, "ligne d'insertion + overlay source (§5)");

  const handled = handlers.keydown.call(instance, makeKeyEvent("Escape"));
  assert.equal(handled, true);
  assert.equal(fake.getText(), text, "aucun commit");
  assert.deepEqual(fake.capturedIds, []);
  assert.equal(fake.ownerDocument.created.length, 0);
  assert.equal(fake.view.dom.classList.contains(REORDER_DRAGGING_CLASS), false);
  assert.equal(fake.isModeActive(), false, "un seul Escape suffit à désactiver le mode");
});

test("Escape en idle + mode actif : désactive directement, aucun second Escape nécessaire", () => {
  const fake = makeFakeView({ text: "A.\n\nB.", posMap: () => null, coordsMap: () => null });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  const handled = handlers.keydown.call(instance, makeKeyEvent("Escape"));
  assert.equal(handled, true);
  assert.equal(fake.isModeActive(), false);
});

/* ==================== §25 : mode normal — non-régression absolue ==================== */

test("mode inactif : tous les handlers laissent l'événement intact — aucune capture, aucune transaction, aucun overlay", () => {
  const text = "A.\n\nB.\n\nC.";
  const fake = makeFakeView({ text, posMap: () => 5, coordsMap: (p) => ({ left: 0, right: 0, top: p, bottom: p + 10 }) });
  // mode reste false (jamais activé)
  const { instance, handlers } = instantiatePlugin(fake);

  const down = makePointerEvent({ clientX: 10, clientY: 10 });
  assert.equal(handlers.pointerdown.call(instance, down), false);
  assert.equal(down.defaultPrevented, false);

  const move = makePointerEvent({ clientX: 20, clientY: 10 });
  assert.equal(handlers.pointermove.call(instance, move), false);

  const up = makePointerEvent({});
  assert.equal(handlers.pointerup.call(instance, up), false);

  const esc = makeKeyEvent("Escape");
  assert.equal(handlers.keydown.call(instance, esc), false);
  assert.equal(esc.defaultPrevented, false);

  assert.equal(fake.getText(), text);
  assert.deepEqual(fake.capturedIds, []);
  assert.equal(fake.ownerDocument.created.length, 0);
  assert.equal(fake.view.dom.classList.contains(REORDER_HOVER_CLASS), false);
  assert.equal(fake.view.dom.classList.contains(REORDER_DRAGGING_CLASS), false);
});

/* ==================== §15 : hover ==================== */

test("hover : mode actif + survol d'un Paragraph → REORDER_HOVER_CLASS ; pointerleave en idle la retire", () => {
  const text = "A.\n\nB.";
  let pos = 0;
  const fake = makeFakeView({ text, posMap: () => pos });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  handlers.pointermove.call(instance, makePointerEvent({ clientX: 1, clientY: 1 }));
  assert.equal(fake.view.dom.classList.contains(REORDER_HOVER_CLASS), true);

  handlers.pointerleave.call(instance);
  assert.equal(fake.view.dom.classList.contains(REORDER_HOVER_CLASS), false);
});

/* ==================== §6 : géométrie pure de l'overlay source ==================== */

test("sourceOverlayRectFor : top = coordsAtPos(from).top, bottom = coordsAtPos(to).bottom, largeur = contentDOM", () => {
  const fromRect = { left: 5, right: 5, top: 100, bottom: 114 };
  const toRect = { left: 5, right: 5, top: 130, bottom: 144 };
  const contentRect = { left: 40, right: 640, top: 0, bottom: 800 };
  assert.deepEqual(sourceOverlayRectFor(fromRect, toRect, contentRect), { top: 100, left: 40, width: 600, height: 44 });
});

/* ==================== §9-10 : géométrie pure de l'auto-scroll ==================== */

test("autoScrollDelta : zone de bord (56px), vitesse progressive, aucun changement au centre", () => {
  assert.equal(AUTO_SCROLL_EDGE_PX, 56);
  assert.equal(AUTO_SCROLL_MAX_PX_PER_FRAME, 18);

  // Bord bas : Y=495 dans un scrollDOM 0→500 → pénétration ≈0.91 → +16 (positif = vers le bas)
  assert.equal(autoScrollDelta(495, 0, 500), 16);
  // Bord haut : Y=5 → même pénétration, signe opposé (négatif = vers le haut)
  assert.equal(autoScrollDelta(5, 0, 500), -16);
  // Centre : aucun changement
  assert.equal(autoScrollDelta(250, 0, 500), 0);
  // Bord exact (56px pile) : encore hors zone (< strict)
  assert.equal(autoScrollDelta(56, 0, 500), 0);
  // Au ras du bord haut (0px) : pénétration maximale
  assert.equal(autoScrollDelta(0, 0, 500), -18);
  // Au-delà du bord (pointeur capturé hors de scrollDOM) : reste à vitesse maximale, jamais un saut
  assert.equal(autoScrollDelta(-40, 0, 500), -18);
});

/* ==================== §24 : overlay source — hover / dragging ==================== */

test("overlay source : présent au survol d'un Paragraph (jamais de grip), absent sur un Heading, géométrie = block", () => {
  const text = "A.\n\n## Titre\n\nB.";
  const blocks = resolveMarkdownBlocks(text);
  const bBlock = blocks.find((b) => b.type === "Paragraph" && b.from > 5);
  let pos = bBlock.from + 1; // à l'intérieur de "B."
  const fake = makeFakeView({
    text,
    posMap: () => pos,
    coordsMap: (p) => ({ left: 0, right: 0, top: p * 2, bottom: p * 2 + 14 }),
  });
  fake.setMode(true);
  const { instance, handlers } = instantiatePlugin(fake);

  handlers.pointermove.call(instance, makePointerEvent({ clientX: 1, clientY: 1 }));
  const sourceOverlays = elementsWithClass(fake.ownerDocument.created, REORDER_SOURCE_OVERLAY_CLASS);
  assert.equal(sourceOverlays.length, 1, "overlay source présent au survol d'un Paragraph");
  assert.equal(fake.ownerDocument.created.some((el) => el.tag === "div" && el.classList.contains("feuillets-reorder-grip")), false);
  assert.equal(sourceOverlays[0].classList.contains(REORDER_SOURCE_DRAGGING_CLASS), false, "pas encore dragging");

  const headingPos = blocks.find((b) => b.type === "ATXHeading2").from + 1;
  pos = headingPos;
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 2, clientY: 2 }));
  assert.equal(elementsWithClass(fake.ownerDocument.created, REORDER_SOURCE_OVERLAY_CLASS).length, 0, "absent sur un Heading");

  // Drag du Paragraph B : l'overlay source réapparaît avec la classe is-dragging.
  pos = bBlock.from + 1;
  handlers.pointerdown.call(instance, makePointerEvent({ clientX: 1, clientY: 1 }));
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 20, clientY: 1 })); // >5px : dragging
  const dragging = elementsWithClass(fake.ownerDocument.created, REORDER_SOURCE_OVERLAY_CLASS);
  assert.equal(dragging.length, 1);
  assert.equal(dragging[0].classList.contains(REORDER_SOURCE_DRAGGING_CLASS), true, "porte is-dragging pendant le drag (§5)");

  handlers.pointerup.call(instance, makePointerEvent({ clientX: 999, clientY: 1 }));
  const afterDrop = elementsWithClass(fake.ownerDocument.created, REORDER_SOURCE_OVERLAY_CLASS);
  assert.equal(
    afterDrop.some((el) => el.classList.contains(REORDER_SOURCE_DRAGGING_CLASS)),
    false,
    "état dragging retiré après pointerup, le hover est recalculé normalement (§7)"
  );
});

/* ==================== §25-27 : auto-scroll (RAF exclusivement) ==================== */

test("auto-scroll : haut/bas progressif via scrollDOM.scrollTop + requestAnimationFrame, rien au centre", () => {
  withFakeWindow(({ runNextFrame, pendingFrames }) => {
    const text = "A.\n\nB.\n\nC.";
    let pos = 4; // "B."
    let clientY = 1;
    const fake = makeFakeView({
      text,
      posMap: () => pos,
      coordsMap: (p) => ({ left: 0, right: 0, top: p, bottom: p + 10 }),
      scrollRect: { left: 0, right: 800, top: 0, bottom: 500 },
      scrollTop: 100,
    });
    fake.setMode(true);
    const { instance, handlers } = instantiatePlugin(fake);

    handlers.pointerdown.call(instance, makePointerEvent({ clientX: 0, clientY: 250 }));
    clientY = 260; // centre, hors zone de bord : franchit juste le seuil sans déclencher l'auto-scroll
    handlers.pointermove.call(instance, makePointerEvent({ clientX: 20, clientY })); // dragging
    assert.equal(pendingFrames(), 0, "aucune boucle tant que le pointeur est au centre");

    clientY = 495; // bord bas
    handlers.pointermove.call(instance, makePointerEvent({ clientX: 21, clientY }));
    assert.equal(pendingFrames(), 1, "UNE seule boucle RAF démarrée");
    runNextFrame();
    assert.equal(fake.getScrollTop(), 116, "scrollTop augmente (bord bas)");

    clientY = 5; // bord haut
    handlers.pointermove.call(instance, makePointerEvent({ clientX: 22, clientY }));
    // La frame précédente a reprogrammé une frame ; on la consomme avant de
    // vérifier le nouveau sens.
    runNextFrame();
    const afterTop = fake.getScrollTop();
    runNextFrame();
    assert.ok(fake.getScrollTop() < afterTop, "scrollTop diminue (bord haut)");

    clientY = 250; // centre : aucun changement, la boucle s'arrête
    handlers.pointermove.call(instance, makePointerEvent({ clientX: 23, clientY }));
    const before = fake.getScrollTop();
    // Soit aucune frame n'a été (re)programmée, soit la frame en attente se
    // contente de constater `delta === 0` et ne reprogramme rien (§12).
    while (pendingFrames() > 0) runNextFrame();
    assert.equal(fake.getScrollTop(), before, "aucun changement au centre");
    assert.equal(pendingFrames(), 0, "la boucle s'arrête d'elle-même hors zone (§12)");

    handlers.pointerup.call(instance, makePointerEvent({ clientX: 999, clientY: 250 }));
  });
});

test("auto-scroll : pendant une frame où scrollTop change, la cible (ligne d'insertion) est recalculée sur les dernières coordonnées (§26)", () => {
  withFakeWindow(({ runNextFrame }) => {
    const text = "A.\n\nB.\n\nC.\n\nD.\n\nE.";
    let scrollTopRef = { value: 100 };
    // La position document dépend du scrollTop courant : simule le fait que
    // le même point écran désigne un texte différent une fois le document
    // défilé — c'est ce qui doit faire bouger la ligne d'insertion.
    const fake = makeFakeView({
      text,
      posMap: () => (scrollTopRef.value > 100 ? 17 : 4),
      coordsMap: (p) => ({ left: 0, right: 0, top: p, bottom: p + 10 }),
      scrollRect: { left: 0, right: 800, top: 0, bottom: 500 },
      scrollTop: 100,
    });
    fake.setMode(true);
    const { instance, handlers } = instantiatePlugin(fake);
    // Reflète le scrollTop réel de la vue dans `scrollTopRef` pour posMap.
    const realSetter = Object.getOwnPropertyDescriptor(fake.view.scrollDOM, "scrollTop").set;
    Object.defineProperty(fake.view.scrollDOM, "scrollTop", {
      get: () => scrollTopRef.value,
      set: (v) => {
        scrollTopRef.value = v;
        realSetter.call(fake.view.scrollDOM, v);
      },
    });

    handlers.pointerdown.call(instance, makePointerEvent({ clientX: 0, clientY: 1 }));
    handlers.pointermove.call(instance, makePointerEvent({ clientX: 20, clientY: 495 })); // dragging, bord bas

    const overlay = fake.ownerDocument.created.find((el) => el.classList.contains(REORDER_INSERTION_LINE_CLASS));
    const topBefore = overlay.style.top;

    runNextFrame(); // scrollTop change → posMap change de branche → seam différente
    assert.notEqual(overlay.style.top, topBefore, "la ligne d'insertion suit la cible recalculée pendant l'auto-scroll");

    handlers.pointerup.call(instance, makePointerEvent({ clientX: 999, clientY: 495 }));
  });
});

test("auto-scroll : cancelAnimationFrame sur pointerup / pointercancel / Escape / destroy — jamais deux boucles simultanées", () => {
  const scenarios = [
    (instance, handlers) => handlers.pointerup.call(instance, makePointerEvent({ clientX: 999, clientY: 495 })),
    (instance, handlers) => handlers.pointercancel.call(instance, makePointerEvent({})),
    (instance, handlers) => handlers.keydown.call(instance, makeKeyEvent("Escape")),
    (instance) => instance.destroy(),
  ];

  for (const trigger of scenarios) {
    withFakeWindow(({ pendingFrames }) => {
      const text = "A.\n\nB.\n\nC.";
      const fake = makeFakeView({
        text,
        posMap: () => 4,
        coordsMap: (p) => ({ left: 0, right: 0, top: p, bottom: p + 10 }),
        scrollRect: { left: 0, right: 800, top: 0, bottom: 500 },
      });
      fake.setMode(true);
      const { instance, handlers } = instantiatePlugin(fake);

      handlers.pointerdown.call(instance, makePointerEvent({ clientX: 0, clientY: 1 }));
      handlers.pointermove.call(instance, makePointerEvent({ clientX: 20, clientY: 495 })); // dragging, bord bas
      assert.equal(pendingFrames(), 1, "une boucle démarrée");

      trigger(instance, handlers);
      assert.equal(pendingFrames(), 0, "aucun RAF orphelin après l'arrêt du geste");
    });
  }
});

/* ==================== §14, §28 : Escape hors focus de l'éditeur (LE bug runtime) ==================== */

test("Escape hors éditeur : keydown sur ownerDocument (hors focus view.dom) désactive le mode — CE TEST ÉCHOUE SANS LE LISTENER GLOBAL", () => {
  const text = "A.\n\nB.\n\nC.";
  const fake = makeFakeView({
    text,
    posMap: () => 4,
    coordsMap: (p) => ({ left: 0, right: 0, top: p, bottom: p + 10 }),
  });
  const { instance, handlers } = instantiatePlugin(fake);

  // Activation depuis le menu contextuel : le mode devient actif SANS que
  // le focus clavier soit dans view.dom — seul `update()` reflète l'effet.
  fake.setMode(true);
  instance.update({ state: fake.view.state, docChanged: false });
  assert.equal(fake.ownerDocument.keydownListenerCount(), 1, "un seul listener Escape temporaire installé (§15)");

  handlers.pointerdown.call(instance, makePointerEvent({ clientX: 0, clientY: 1 }));
  handlers.pointermove.call(instance, makePointerEvent({ clientX: 20, clientY: 1 })); // dragging
  assert.ok(fake.ownerDocument.created.length > 0);

  const escapeEvent = makeKeyEvent("Escape");
  fake.ownerDocument.dispatchKeydown(escapeEvent); // JAMAIS via handlers.keydown : simule le focus hors éditeur

  assert.equal(fake.isModeActive(), false, "mode désactivé");
  assert.equal(fake.getText(), text, "aucune transaction de texte");
  assert.equal(fake.ownerDocument.created.length, 0, "overlays (source + insertion) supprimés");
  assert.deepEqual(fake.capturedIds, [], "pointer capture relâchée");

  // update() reflète ensuite la désactivation : indicateur et listener disparaissent.
  instance.update({ state: fake.view.state, docChanged: false });
  assert.equal(fake.domChildren.filter((el) => el.classList.contains(REORDER_MODE_INDICATOR_CLASS)).length, 0, "indicateur absent");
  assert.equal(fake.ownerDocument.keydownListenerCount(), 0, "listener Escape temporaire retiré (§15)");
});

test("Escape hors éditeur, mode déjà inactif : no-op silencieux (idempotence, §17)", () => {
  const fake = makeFakeView({ text: "A.\n\nB.", posMap: () => null });
  instantiatePlugin(fake);
  // Le listener n'est même pas installé puisque le mode n'a jamais été actif.
  fake.ownerDocument.dispatchKeydown(makeKeyEvent("Escape"));
  assert.equal(fake.isModeActive(), false);
  assert.equal(fake.dispatchCalls.length, 0);
});

/* ==================== §18-20, §29 : indicateur de mode (micro-finition) ==================== */

test("indicateur de mode : absent si mode false, exactement un enfant .feuillets-reorder-mode-indicator si mode true, texte i18n FR/EN via deux spans, supprimé à la désactivation et à destroy", () => {
  const fake = makeFakeView({ text: "A.\n\nB.", posMap: () => null });
  const { instance } = instantiatePlugin(fake);

  instance.update({ state: fake.view.state, docChanged: false });
  assert.equal(fake.domChildren.filter((el) => el.classList.contains(REORDER_MODE_INDICATOR_CLASS)).length, 0);

  setLocale("fr");
  fake.setMode(true);
  instance.update({ state: fake.view.state, docChanged: false });
  const indicators = fake.domChildren.filter((el) => el.classList.contains(REORDER_MODE_INDICATOR_CLASS));
  assert.equal(indicators.length, 1, "exactement un indicateur");

  const indicator = indicators[0];
  const label = indicator.children.find((el) => el.classList.contains(REORDER_MODE_INDICATOR_LABEL_CLASS));
  const hint = indicator.children.find((el) => el.classList.contains(REORDER_MODE_INDICATOR_HINT_CLASS));
  assert.ok(label, ".feuillets-reorder-mode-label présent");
  assert.ok(hint, ".feuillets-reorder-mode-hint présent");
  assert.equal(label.textContent, t("editorMenu.reorderMode.label"));
  assert.equal(hint.textContent, t("editorMenu.reorderMode.hint"));
  assert.equal(label.textContent, "Réorganisation");
  assert.equal(hint.textContent, "· Échap pour quitter");
  // Aucun élément interactif : ni bouton, ni ×, ni apparence de touche encadrée.
  assert.equal(
    indicator.children.some((el) => el.tag === "button"),
    false,
    "aucun bouton dans l'indicateur"
  );
  assert.equal(indicator.children.length, 2, "exactement les deux spans, rien d'autre");

  setLocale("en");
  assert.equal(t("editorMenu.reorderMode.label"), "Reorder");
  assert.equal(t("editorMenu.reorderMode.hint"), "· Esc to exit");
  setLocale("fr");

  // Instanciation répétée de update() en mode actif : jamais un second indicateur.
  instance.update({ state: fake.view.state, docChanged: false });
  assert.equal(fake.domChildren.filter((el) => el.classList.contains(REORDER_MODE_INDICATOR_CLASS)).length, 1);

  fake.setMode(false);
  instance.update({ state: fake.view.state, docChanged: false });
  assert.equal(fake.domChildren.filter((el) => el.classList.contains(REORDER_MODE_INDICATOR_CLASS)).length, 0, "indicateur supprimé");

  fake.setMode(true);
  instance.update({ state: fake.view.state, docChanged: false });
  assert.equal(fake.domChildren.filter((el) => el.classList.contains(REORDER_MODE_INDICATOR_CLASS)).length, 1);
  instance.destroy();
  assert.equal(fake.domChildren.filter((el) => el.classList.contains(REORDER_MODE_INDICATOR_CLASS)).length, 0, "indicateur supprimé à destroy");
});

test("indicateur de mode : Escape le supprime (aucun mécanisme de fermeture propre à l'indicateur)", () => {
  const text = "A.\n\nB.\n\nC.";
  const fake = makeFakeView({ text, posMap: () => null });
  const { instance, handlers } = instantiatePlugin(fake);

  fake.setMode(true);
  instance.update({ state: fake.view.state, docChanged: false });
  assert.equal(fake.domChildren.filter((el) => el.classList.contains(REORDER_MODE_INDICATOR_CLASS)).length, 1);

  handlers.keydown.call(instance, makeKeyEvent("Escape"));
  assert.equal(fake.isModeActive(), false);
  instance.update({ state: fake.view.state, docChanged: false });
  assert.equal(fake.domChildren.filter((el) => el.classList.contains(REORDER_MODE_INDICATOR_CLASS)).length, 0, "indicateur supprimé après Escape");
});
