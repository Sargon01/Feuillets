import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { buildScriveningsDocument } from "../src/services/scrivenings-document.js";
import {
  getScriveningsScrollAnchor,
  computeScriveningsScrollTop,
  scrollScriveningsToAnchor,
  scriveningsSegmentProgress,
  scriveningsViewportTop,
} from "../src/utils/cm-scrivenings-scroll.js";

/* Lot 2B.1 — ancre de défilement de Continu, purement géométrique : ces
 * tests ne montent JAMAIS un vrai CodeMirror, seulement un faux EditorView
 * exposant sa surface publique (scrollDOM, documentTop, elementAtHeight,
 * lineBlockAt) — exactement la garantie que doit offrir ce module. */

function entriesFrom(pairs) {
  const files = pairs.map(([path]) => new TFile(path));
  return pairs.map(([, content], i) => ({ file: files[i], content }));
}

/* Trois feuillets composites, chacun avec un TITRE (20px) suivi d'un CORPS
 * (100px) — géométrie synthétique, jamais dérivée du nombre de caractères :
 * segment A : bande [0, 120) ; segment B : [120, 240) ; segment C : [240, 360).
 * `lineBlockAt` n'est JAMAIS appelée qu'avec segment.from/segment.to par le
 * module testé — la table ci-dessous suffit donc intégralement. */
function buildFixture() {
  const doc = buildScriveningsDocument(
    entriesFrom([
      ["Roman/A.md", "Corps A."],
      ["Roman/B.md", "Corps B."],
      ["Roman/C.md", "Corps C."],
    ])
  );
  const [a, b, c] = doc.segments;

  const geometry = new Map([
    [a.from, { top: 0, bottom: 20 }],
    [a.to, { top: 100, bottom: 120 }],
    [b.from, { top: 120, bottom: 140 }],
    [b.to, { top: 220, bottom: 240 }],
    [c.from, { top: 240, bottom: 260 }],
    [c.to, { top: 340, bottom: 360 }],
  ]);
  const bands = [
    { seg: a, top: 0, bottom: 120 },
    { seg: b, top: 120, bottom: 240 },
    { seg: c, top: 240, bottom: 360 },
  ];

  function makeView({ documentTop = 0, rectTop = 0, scrollTop = 0, scrollHeight = 1000, clientHeight = 400 } = {}) {
    return {
      documentTop,
      contentHeight: 360,
      scrollDOM: {
        scrollTop,
        scrollHeight,
        clientHeight,
        getBoundingClientRect: () => ({ top: rectTop }),
      },
      lineBlockAt(pos) {
        const g = geometry.get(pos);
        if (!g) throw new Error(`lineBlockAt appelé avec un offset inattendu : ${pos}`);
        return { from: pos, to: pos, top: g.top, bottom: g.bottom };
      },
      elementAtHeight(height) {
        const band = bands.find((b) => height < b.bottom) || bands[bands.length - 1];
        return { from: band.seg.from, to: band.seg.to, top: band.top, bottom: band.bottom };
      },
    };
  }

  return { doc, a, b, c, makeView };
}

/* ===================== scriveningsViewportTop ===================== */

test("scriveningsViewportTop : rect.top - documentTop, jamais scrollTop seul", () => {
  const { makeView } = buildFixture();
  const view = makeView({ documentTop: 50, rectTop: 200 });
  assert.equal(scriveningsViewportTop(view), 150);
});

/* ===================== getScriveningsScrollAnchor ===================== */

test("getScriveningsScrollAnchor : aucun document (segments vides) → null", () => {
  const { makeView } = buildFixture();
  const view = makeView();
  assert.equal(getScriveningsScrollAnchor(view, { segments: [], text: "" }), null);
});

test("getScriveningsScrollAnchor : vue absente → null", () => {
  const { doc } = buildFixture();
  assert.equal(getScriveningsScrollAnchor(null, doc), null);
});

test("getScriveningsScrollAnchor : premier segment visible → bon path", () => {
  const { doc, a, makeView } = buildFixture();
  const view = makeView({ rectTop: 50 }); // 50 < 120 → bande A
  const anchor = getScriveningsScrollAnchor(view, doc);
  assert.equal(anchor.path, a.path);
});

test("getScriveningsScrollAnchor : segment intermédiaire visible → bon path", () => {
  const { doc, b, makeView } = buildFixture();
  const view = makeView({ rectTop: 180 }); // dans [120, 240)
  const anchor = getScriveningsScrollAnchor(view, doc);
  assert.equal(anchor.path, b.path);
});

test("getScriveningsScrollAnchor : dernier segment visible → bon path", () => {
  const { doc, c, makeView } = buildFixture();
  const view = makeView({ rectTop: 300 }); // dans [240, 360)
  const anchor = getScriveningsScrollAnchor(view, doc);
  assert.equal(anchor.path, c.path);
});

test("getScriveningsScrollAnchor : viewport pile sur le titre → segment suivant correct + progress 0", () => {
  const { doc, b, makeView } = buildFixture();
  // 120 est le tout début de la bande B (le widget de titre de B) : la
  // jonction structurelle A→B tombe exactement ici.
  const view = makeView({ rectTop: 120 });
  const anchor = getScriveningsScrollAnchor(view, doc);
  assert.equal(anchor.path, b.path, "le feuillet SUIVANT (B), jamais A");
  assert.equal(anchor.progress, 0, "le titre produit naturellement une progression 0");
});

test("getScriveningsScrollAnchor : position exacte autour d'une jonction est déterministe", () => {
  const { doc, a, b, makeView } = buildFixture();
  const justBefore = getScriveningsScrollAnchor(makeView({ rectTop: 119.9 }), doc);
  const exactly = getScriveningsScrollAnchor(makeView({ rectTop: 120 }), doc);
  assert.equal(justBefore.path, a.path);
  assert.equal(exactly.path, b.path);
});

test("getScriveningsScrollAnchor : début de segment → progress 0", () => {
  const { doc, a, makeView } = buildFixture();
  const anchor = getScriveningsScrollAnchor(makeView({ rectTop: 0 }), doc);
  assert.equal(anchor.path, a.path);
  assert.equal(anchor.progress, 0);
});

test("getScriveningsScrollAnchor : milieu de segment → progress ~0.5", () => {
  const { doc, a, makeView } = buildFixture();
  const anchor = getScriveningsScrollAnchor(makeView({ rectTop: 60 }), doc); // bande A = [0,120)
  assert.equal(anchor.path, a.path);
  assert.ok(Math.abs(anchor.progress - 0.5) < 1e-9);
});

test("getScriveningsScrollAnchor : fin de segment → progress 1", () => {
  const { doc, c, makeView } = buildFixture();
  const anchor = getScriveningsScrollAnchor(makeView({ rectTop: 359.999 }), doc); // juste avant 360
  assert.equal(anchor.path, c.path);
  assert.ok(anchor.progress > 0.99);
});

test("getScriveningsScrollAnchor : progress toujours borné même hors bornes géométriques", () => {
  const { doc, a, makeView } = buildFixture();
  // rectTop négatif : viewportTop < segmentTop → ratio négatif, doit rester 0.
  const anchor = getScriveningsScrollAnchor(makeView({ rectTop: -500 }), doc);
  assert.equal(anchor.path, a.path);
  assert.equal(anchor.progress, 0);
});

/* ===================== scriveningsSegmentProgress (segment isolé) ===================== */

test("scriveningsSegmentProgress : segment de hauteur nulle → 0, jamais NaN", () => {
  const doc = buildScriveningsDocument(entriesFrom([["Roman/Vide.md", ""]]));
  const [empty] = doc.segments;
  const view = {
    documentTop: 0,
    contentHeight: 0,
    scrollDOM: { scrollTop: 0, scrollHeight: 0, clientHeight: 0, getBoundingClientRect: () => ({ top: 0 }) },
    lineBlockAt: () => ({ from: 0, to: 0, top: 42, bottom: 42 }), // top === bottom : hauteur nulle
    elementAtHeight: () => ({ from: 0, to: 0, top: 42, bottom: 42 }),
  };
  assert.equal(scriveningsSegmentProgress(view, empty, 42), 0);
  assert.equal(scriveningsSegmentProgress(view, empty, 999), 0);
});

/* ===================== computeScriveningsScrollTop (inverse) ===================== */

test("computeScriveningsScrollTop : path + progress 0 → début du segment", () => {
  const { doc, a, makeView } = buildFixture();
  const view = makeView({ rectTop: 0, scrollTop: 0 });
  const next = computeScriveningsScrollTop(view, doc, a.path, 0);
  // viewportTop actuel = 0, cible = top de A (0) → delta 0 → scrollTop inchangé.
  assert.equal(next, 0);
});

test("computeScriveningsScrollTop : path + progress 0.5 → milieu du segment", () => {
  const { doc, a, makeView } = buildFixture();
  const view = makeView({ rectTop: 0, scrollTop: 0 });
  const next = computeScriveningsScrollTop(view, doc, a.path, 0.5);
  // cible = 60 (milieu de [0,120)), viewportTop actuel = 0 → delta 60.
  assert.equal(next, 60);
});

test("computeScriveningsScrollTop : path B + progress 1 → fin du segment", () => {
  const { doc, b, makeView } = buildFixture();
  const view = makeView({ rectTop: 0, scrollTop: 0 });
  const next = computeScriveningsScrollTop(view, doc, b.path, 1);
  // cible = 240 (fin de B), viewportTop actuel = 0 → delta 240.
  assert.equal(next, 240);
});

test("computeScriveningsScrollTop : progress < 0 est ramené à 0", () => {
  const { doc, a, makeView } = buildFixture();
  const view = makeView({ rectTop: 0, scrollTop: 0 });
  const withNegative = computeScriveningsScrollTop(view, doc, a.path, -3);
  const withZero = computeScriveningsScrollTop(view, doc, a.path, 0);
  assert.equal(withNegative, withZero);
});

test("computeScriveningsScrollTop : progress > 1 est ramené à 1", () => {
  const { doc, a, makeView } = buildFixture();
  const view = makeView({ rectTop: 0, scrollTop: 0 });
  const withOverflow = computeScriveningsScrollTop(view, doc, a.path, 7);
  const withOne = computeScriveningsScrollTop(view, doc, a.path, 1);
  assert.equal(withOverflow, withOne);
});

test("computeScriveningsScrollTop : chemin absent du document → null (aucun scroll)", () => {
  const { doc, makeView } = buildFixture();
  const view = makeView();
  assert.equal(computeScriveningsScrollTop(view, doc, "Roman/Inexistant.md", 0.5), null);
});

test("computeScriveningsScrollTop : le résultat est borné à 0 (jamais négatif)", () => {
  const { doc, a, makeView } = buildFixture();
  // Le scroll actuel est déjà loin en dessous de la cible : le delta ferait
  // chuter le résultat sous zéro sans le clamp.
  const view = makeView({ rectTop: 900, scrollTop: 900, scrollHeight: 1000, clientHeight: 400 });
  const next = computeScriveningsScrollTop(view, doc, a.path, 0);
  assert.equal(next, 0);
});

test("computeScriveningsScrollTop : le résultat est borné au maximum scrollable", () => {
  const { doc, c, makeView } = buildFixture();
  // Amplitude scrollable réelle volontairement petite (scrollHeight(300) -
  // clientHeight(280) = 20) face à une cible brute bien plus haute (fin de
  // C = 360) : sans clamp, le résultat dépasserait largement 20.
  const view = makeView({ rectTop: 0, scrollTop: 0, scrollHeight: 300, clientHeight: 280 });
  const clamped = computeScriveningsScrollTop(view, doc, c.path, 1);
  assert.equal(clamped, 20, "20 = scrollHeight(300) - clientHeight(280), le maximum scrollable réel");
});

/* ===================== scrollScriveningsToAnchor (effet de bord) ===================== */

test("scrollScriveningsToAnchor : écrit scrollDOM.scrollTop, rien d'autre", () => {
  const { doc, b, makeView } = buildFixture();
  const view = makeView({ rectTop: 0, scrollTop: 0 });
  let dispatchCalled = false;
  view.dispatch = () => { dispatchCalled = true; };

  scrollScriveningsToAnchor(view, doc, b.path, 0);

  assert.equal(view.scrollDOM.scrollTop, 120, "cible = top de B");
  assert.equal(dispatchCalled, false, "aucune transaction document ne doit être dispatchée");
});

test("scrollScriveningsToAnchor : chemin absent → scrollTop inchangé", () => {
  const { doc, makeView } = buildFixture();
  const view = makeView({ rectTop: 0, scrollTop: 77 });
  scrollScriveningsToAnchor(view, doc, "Roman/Inexistant.md", 0.5);
  assert.equal(view.scrollDOM.scrollTop, 77, "aucun scroll ne doit avoir lieu");
});

test("scrollScriveningsToAnchor : ne modifie ni le document ni la sélection (aucune propriété autre que scrollTop)", () => {
  const { doc, a, makeView } = buildFixture();
  const view = makeView({ rectTop: 0, scrollTop: 0 });
  const before = JSON.stringify({ ...view.scrollDOM, scrollTop: undefined });
  scrollScriveningsToAnchor(view, doc, a.path, 0.5);
  const after = JSON.stringify({ ...view.scrollDOM, scrollTop: undefined });
  assert.equal(before, after, "seul scrollTop doit avoir changé");
});
