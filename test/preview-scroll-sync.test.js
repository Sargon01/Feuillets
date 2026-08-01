import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clamp01,
  findScriveningsScroller,
  findSourceScroller,
  progressWithinSection,
  scriveningsAnchor,
  scrollableAmount,
  scrollProgress,
  scrollTopForProgress,
  scrollTopWithinSection,
  SCROLL_SYNC_EPSILON_PX,
  SCROLL_SYNC_SUSPEND_MS,
  topWithinScroller,
} from "../src/views/preview-scroll-sync.js";

/* Géométrie pure de la synchronisation de défilement. Testée ici sans
 * aucune vue : ce sont ces quelques formules qui décident si les deux
 * panneaux restent sur la même zone de texte ou partent en boucle. */

function scroller({ scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {}) {
  return { scrollTop, scrollHeight, clientHeight };
}

test("progression : bornée à [0, 1], y compris sur des valeurs absurdes", () => {
  assert.equal(scrollProgress(scroller({ scrollTop: 0, scrollHeight: 2000, clientHeight: 500 })), 0);
  assert.equal(scrollProgress(scroller({ scrollTop: 750, scrollHeight: 2000, clientHeight: 500 })), 0.5);
  assert.equal(scrollProgress(scroller({ scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 })), 1);

  // Au-delà du bas (rebond iOS/trackpad), ou position négative : bornées.
  assert.equal(scrollProgress(scroller({ scrollTop: 9999, scrollHeight: 2000, clientHeight: 500 })), 1);
  assert.equal(scrollProgress(scroller({ scrollTop: -40, scrollHeight: 2000, clientHeight: 500 })), 0);

  // Contenu plus court que le cadre : rien à défiler, jamais NaN ni Infinity.
  assert.equal(scrollProgress(scroller({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 })), 0);
  assert.equal(scrollProgress(null), 0);
  assert.equal(clamp01(NaN), 0);
});

test("progression : aller-retour exact entre progression et position", () => {
  const el = scroller({ scrollHeight: 3000, clientHeight: 700 });
  assert.equal(scrollableAmount(el), 2300);
  for (const p of [0, 0.25, 0.5, 1]) {
    const top = scrollTopForProgress(el, p);
    assert.equal(scrollProgress({ ...el, scrollTop: top }), p);
  }
  // Un élément non défilable ne peut viser que 0 — pas de division par zéro.
  assert.equal(scrollTopForProgress(scroller({ scrollHeight: 100, clientHeight: 700 }), 0.8), 0);
});

test("section : la plage utile est la hauteur restante, pas la hauteur brute", () => {
  const section = { top: 1000, height: 900 };
  const clientHeight = 600; // il reste 300 px à parcourir dans la section

  assert.equal(progressWithinSection(1000, section, clientHeight), 0);
  assert.equal(progressWithinSection(1150, section, clientHeight), 0.5);
  assert.equal(progressWithinSection(1300, section, clientHeight), 1);
  // Hors de la section : borné, jamais extrapolé.
  assert.equal(progressWithinSection(200, section, clientHeight), 0);
  assert.equal(progressWithinSection(5000, section, clientHeight), 1);

  assert.equal(scrollTopWithinSection(section, clientHeight, 0), 1000);
  assert.equal(scrollTopWithinSection(section, clientHeight, 0.5), 1150);
  assert.equal(scrollTopWithinSection(section, clientHeight, 1), 1300);

  // Section entièrement visible : on se cale sur son début, sans sursaut.
  const short = { top: 400, height: 200 };
  assert.equal(progressWithinSection(500, short, clientHeight), 0);
  assert.equal(scrollTopWithinSection(short, clientHeight, 0.9), 400);
});

test("seuils : un écart minuscule ne justifie pas une correction", () => {
  assert.ok(SCROLL_SYNC_EPSILON_PX >= 2 && SCROLL_SYNC_EPSILON_PX <= 4);
  assert.ok(SCROLL_SYNC_SUSPEND_MS >= 150 && SCROLL_SYNC_SUSPEND_MS <= 300);
});

/* ------------------------- Repérage des panneaux ------------------------ */

class El {
  constructor(cls = "", { scrollHeight = 0, clientHeight = 0, top = 0 } = {}) {
    this.cls = cls;
    this.children = [];
    this.parentElement = null;
    this.scrollTop = 0;
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
    this._top = top;
    this.attrs = new Map();
  }
  add(child) { child.parentElement = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attrs.set(name, value); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const wanted = selector.replace(/^\./, "");
    const out = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.cls.split(" ").includes(wanted)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
  getBoundingClientRect() {
    const scroller = this.parentElement;
    return { top: this._top - (scroller ? scroller.scrollTop : 0) };
  }
}

test("panneau Markdown : c'est .cm-scroller qui défile, jamais la vue entière", () => {
  const contentEl = new El("view");
  const scroller = contentEl.add(new El("cm-scroller", { scrollHeight: 4000, clientHeight: 600 }));
  assert.equal(findSourceScroller(contentEl), scroller);

  // Mode Lecture : la zone rendue prend le relais.
  const reading = new El("view");
  const preview = reading.add(new El("markdown-preview-view", { scrollHeight: 4000, clientHeight: 600 }));
  assert.equal(findSourceScroller(reading), preview);

  // Aucune zone connue et rien de défilable : on ne devine pas.
  assert.equal(findSourceScroller(new El("view")), null);
  assert.equal(findSourceScroller(null), null);
});

test("panneau Scrivening : on remonte jusqu'à l'ancêtre réellement défilable", () => {
  const contentEl = new El("view");
  const scroll = contentEl.add(new El("feuillets-board-scroll", { scrollHeight: 3000, clientHeight: 600 }));
  const wrapper = scroll.add(new El("feuillets-scrivenings-wrapper"));
  assert.equal(findScriveningsScroller(contentEl), scroll);

  // Le conteneur des scènes lui-même ne défile pas : il grandit.
  assert.equal(scrollableAmount(wrapper), 0);
  assert.equal(findScriveningsScroller(new El("view")), null);
});

test("Scrivening : la scène en tête de lecture et la progression à l'intérieur", () => {
  const scroll = new El("scroll", { scrollHeight: 3000, clientHeight: 600 });
  const scenes = ["A.md", "B.md", "C.md"].map((path, i) => {
    const el = scroll.add(new El("feuillets-scrivenings-scene", { top: i * 1000 }));
    el.setAttribute("data-path", path);
    return el;
  });

  // Tout en haut : première scène, progression nulle.
  scroll.scrollTop = 0;
  assert.deepEqual(scriveningsAnchor(scroll, scenes), { path: "A.md", progress: 0 });

  // Milieu de la deuxième scène (1000 → 2000, cadre de 600 : 400 utiles).
  scroll.scrollTop = 1200;
  assert.deepEqual(scriveningsAnchor(scroll, scenes), { path: "B.md", progress: 0.5 });

  // Dernière scène : la borne haute est la fin du contenu.
  scroll.scrollTop = 2000;
  assert.equal(scriveningsAnchor(scroll, scenes).path, "C.md");

  // Position d'un bloc mesurée dans le repère DÉFILÉ (donc stable).
  assert.equal(topWithinScroller(scenes[1], scroll), 1000);

  assert.equal(scriveningsAnchor(scroll, []), null);
  assert.equal(scriveningsAnchor(null, scenes), null);
});
