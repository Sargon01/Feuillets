import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPresentationBlock,
  descriptorsForSlide,
  generatePresentationCandidates,
  isAutonomousMediaBlock,
  isPresentationTitleSlide,
  normalizePresentationMediaCell,
  choosePresentationCandidate,
  presentationContainedMediaSize,
  presentationLayoutOverflows,
  PRESENTATION_MEDIA_BLOCK_CLASS,
  PRESENTATION_MEDIA_WRAPPER_CLASS,
} from "../src/services/presentation-layout-engine.js";

/* FakeElement minimal, cohérent avec la convention déjà utilisée par
   test/presentation-view.test.js : le texte direct d'un élément est porté
   par sa propriété .text, pas par un nœud texte séparé. */
class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.classes = new Set();
    this.attrs = new Map();
    this.text = options.text || "";
    const style = {};
    style.removeProperty = (name) => { delete style[name]; };
    this.style = style;
    this.clientWidth = 1280; this.clientHeight = 720; this.scrollWidth = 1280; this.scrollHeight = 720;
    this.classList = {
      add: (...names) => names.forEach((n) => this.classes.add(n)),
      remove: (...names) => names.forEach((n) => this.classes.delete(n)),
      toggle: (n, force) => (force ? this.classes.add(n) : this.classes.delete(n)),
    };
  }
  get childNodes() { return this.children; }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.appendChild(child); return child; }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; }
  removeAttribute(name) { this.attrs.delete(name); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  querySelector(selector) {
    const names = selector.split(",").map((v) => v.trim().toUpperCase());
    return descendants(this).slice(1).find((el) => names.includes(el.tagName)) || null;
  }
  querySelectorAll(selector) {
    const names = selector.split(",").map((v) => v.trim().toUpperCase());
    return descendants(this).slice(1).filter((el) => names.includes(el.tagName));
  }
}
function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }

function heading() { return new FakeElement("h1", { text: "Titre" }); }
function text() { return new FakeElement("p", { text: "Un paragraphe" }); }
function list() { const el = new FakeElement("ul"); el.createEl("li", { text: "Item" }); return el; }
function callout() { const el = new FakeElement("div"); el.setAttribute("data-callout", "note"); return el; }
function media() {
  const el = new FakeElement("p");
  el.createEl("img");
  return el;
}
function audio() {
  const el = new FakeElement("p");
  el.createEl("audio");
  return el;
}

function slideOf(...blocks) {
  const inner = new FakeElement("div");
  for (const block of blocks) inner.appendChild(block);
  return inner;
}

function candidatesFor(inner) {
  return generatePresentationCandidates(descriptorsForSlide(inner));
}

function assertClose(actual, expected, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `attendu ~${expected}, obtenu ${actual}`);
}

test("classifyPresentationBlock : reconnaît heading/media/list/text/callout/other", () => {
  assert.equal(classifyPresentationBlock(heading()), "heading");
  assert.equal(classifyPresentationBlock(media()), "media");
  assert.equal(classifyPresentationBlock(list()), "list");
  assert.equal(classifyPresentationBlock(text()), "text");
  const note = callout(); note.setAttribute("data-callout", "note");
  assert.equal(classifyPresentationBlock(note), "callout");
  assert.equal(classifyPresentationBlock(new FakeElement("hr")), "other");
});

test("isAutonomousMediaBlock : refuse texte direct, liste, blockquote, table, plusieurs médias et audio", () => {
  assert.equal(isAutonomousMediaBlock(media()), true);
  assert.equal(isAutonomousMediaBlock(audio()), false);
  const withText = media(); withText.text = "légende";
  assert.equal(isAutonomousMediaBlock(withText), false);
  const withList = media(); withList.createEl("li");
  assert.equal(isAutonomousMediaBlock(withList), false);
  const withTwo = new FakeElement("p"); withTwo.createEl("img"); withTwo.createEl("img");
  assert.equal(isAutonomousMediaBlock(withTwo), false);
  assert.equal(isAutonomousMediaBlock(new FakeElement("span")), false);
});

// ===== génération des candidats =====

const EXPECTED_IDS = [
  "split-42-58", "split-50-50", "split-58-42",
  "stack-65-35", "stack-60-40", "stack-55-45",
];

test("A : MEDIA puis TEXT => 6 candidats, média en cellule A, ordre Markdown conservé", () => {
  const inner = slideOf(heading(), media(), text());
  const candidates = candidatesFor(inner);
  assert.deepEqual(candidates.map((c) => c.id), EXPECTED_IDS);
  for (const c of candidates) {
    assert.equal(c.mediaPosition, "a");
    assert.deepEqual(c.cellBIndexes, [2]);
  }
});

test("B : TEXT puis MEDIA => 6 candidats, média en cellule B, ordre Markdown conservé", () => {
  const inner = slideOf(heading(), text(), media());
  const candidates = candidatesFor(inner);
  assert.deepEqual(candidates.map((c) => c.id), EXPECTED_IDS);
  for (const c of candidates) {
    assert.equal(c.mediaPosition, "b");
    assert.deepEqual(c.cellAIndexes, [1]);
  }
});

test("C : TEXT MEDIA TEXT => FLOW uniquement (aucun candidat)", () => {
  const inner = slideOf(text(), media(), text());
  assert.deepEqual(candidatesFor(inner), []);
});

test("D : TEXT TEXT => 5 candidats SPLIT texte–texte", () => {
  const inner = slideOf(text(), text());
  const candidates = candidatesFor(inner);
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["split-35-65", "split-42-58", "split-50-50", "split-58-42", "split-65-35"]);
  for (const candidate of candidates) {
    assert.equal(candidate.geometry, "split");
    assert.equal(candidate.mediaPosition, null);
    assert.deepEqual(candidate.cellAIndexes, [0]);
    assert.deepEqual(candidate.cellBIndexes, [1]);
  }
});

test("texte–texte accepte les listes et callouts, mais refuse les structures non compatibles", () => {
  assert.equal(candidatesFor(slideOf(text(), list())).length, 5);
  assert.equal(candidatesFor(slideOf(text(), callout())).length, 5);
  assert.equal(candidatesFor(slideOf(callout(), callout())).length, 5);
  assert.deepEqual(candidatesFor(slideOf(text(), text(), text())), []);
  assert.deepEqual(candidatesFor(slideOf(text(), new FakeElement("div"))), []);
  assert.deepEqual(candidatesFor(slideOf(text(), new FakeElement("h3"), text())), []);
});

test("E : MEDIA MEDIA => FLOW uniquement dans ce lot (aucun candidat)", () => {
  const inner = slideOf(media(), media());
  assert.deepEqual(candidatesFor(inner), []);
});

test("generatePresentationCandidates : plan PUR, aucun HTMLElement", () => {
  const inner = slideOf(heading(), media(), text());
  const candidates = candidatesFor(inner);
  for (const candidate of candidates) {
    for (const key of ["headingIndexes", "cellAIndexes", "cellBIndexes"]) {
      for (const value of candidate[key]) assert.equal(typeof value, "number");
    }
  }
});

test("isPresentationTitleSlide : règle exacte heading seul ou heading + heading/text", () => {
  assert.equal(isPresentationTitleSlide(0, descriptorsForSlide(slideOf(heading()))), true);
  assert.equal(isPresentationTitleSlide(0, descriptorsForSlide(slideOf(heading(), heading()))), true);
  assert.equal(isPresentationTitleSlide(0, descriptorsForSlide(slideOf(heading(), text()))), true);
  assert.equal(isPresentationTitleSlide(1, descriptorsForSlide(slideOf(heading()))), false);
  assert.equal(isPresentationTitleSlide(0, descriptorsForSlide(slideOf(text()))), false);
  assert.equal(isPresentationTitleSlide(0, descriptorsForSlide(slideOf(heading(), list()))), false);
  assert.equal(isPresentationTitleSlide(0, descriptorsForSlide(slideOf(heading(), media()))), false);
  assert.equal(isPresentationTitleSlide(0, descriptorsForSlide(slideOf(heading(), new FakeElement("hr")))), false);
  assert.equal(isPresentationTitleSlide(0, descriptorsForSlide(slideOf(heading(), text(), text()))), false);
  assert.equal(isPresentationTitleSlide(0, descriptorsForSlide(slideOf(heading(), heading(), list()))), false);
});

// ===== classement des candidats =====

test("choosePresentationCandidate : cas PORTRAIT simulé => split gagne (plus grande surface média)", () => {
  const winner = choosePresentationCandidate([
    { id: "split", overflowPx: 0, mediaArea: 200000, minTextWidth: 400 },
    { id: "stack", overflowPx: 0, mediaArea: 90000, minTextWidth: 1000 },
  ]);
  assert.equal(winner, "split");
});

test("choosePresentationCandidate : cas PAYSAGE simulé => stack gagne (plus grande surface média)", () => {
  const winner = choosePresentationCandidate([
    { id: "split", overflowPx: 0, mediaArea: 120000, minTextWidth: 0 },
    { id: "stack", overflowPx: 0, mediaArea: 220000, minTextWidth: 0 },
  ]);
  assert.equal(winner, "stack");
});

test("choosePresentationCandidate : texte qui déborde en SPLIT => stack (seul valide) gagne", () => {
  const winner = choosePresentationCandidate([
    { id: "split", overflowPx: 100, mediaArea: 250000, minTextWidth: 0 },
    { id: "stack", overflowPx: 0, mediaArea: 180000, minTextWidth: 0 },
  ]);
  assert.equal(winner, "stack");
});

test("choosePresentationCandidate : tout déborde => le plus petit overflowPx gagne", () => {
  const winner = choosePresentationCandidate([
    { id: "A", overflowPx: 200, mediaArea: 250000, minTextWidth: 0 },
    { id: "B", overflowPx: 50, mediaArea: 120000, minTextWidth: 0 },
  ]);
  assert.equal(winner, "B");
});

test("choosePresentationCandidate : égalité d'overflow (aucun valide) => le plus grand mediaArea gagne", () => {
  const winner = choosePresentationCandidate([
    { id: "A", overflowPx: 50, mediaArea: 100000, minTextWidth: 0 },
    { id: "B", overflowPx: 50, mediaArea: 150000, minTextWidth: 0 },
  ]);
  assert.equal(winner, "B");
});

test("choosePresentationCandidate : égalité mediaArea à moins de 1% => le plus grand minTextWidth gagne", () => {
  const winner = choosePresentationCandidate([
    { id: "A", overflowPx: 0, mediaArea: 100000, minTextWidth: 300 },
    { id: "B", overflowPx: 0, mediaArea: 100500, minTextWidth: 500 },
  ]);
  assert.equal(winner, "B");
});

test("choosePresentationCandidate : égalité totale => premier candidat conservé", () => {
  const winner = choosePresentationCandidate([
    { id: "A", overflowPx: 0, mediaArea: 100000, minTextWidth: 300 },
    { id: "B", overflowPx: 0, mediaArea: 100000, minTextWidth: 300 },
  ]);
  assert.equal(winner, "A");
});

test("choosePresentationCandidate : texte–texte mediaArea=0 privilégie minTextWidth, puis le candidat valide", () => {
  const candidates = [
    { id: "split-42-58", overflowPx: 0, mediaArea: 0, minTextWidth: 420 },
    { id: "split-50-50", overflowPx: 0, mediaArea: 0, minTextWidth: 500 },
    { id: "split-58-42", overflowPx: 0, mediaArea: 0, minTextWidth: 460 },
  ];
  assert.equal(choosePresentationCandidate(candidates), "split-50-50");
  assert.equal(choosePresentationCandidate([
    { ...candidates[0], overflowPx: 20 },
    { ...candidates[1], overflowPx: 0 },
    { ...candidates[2], overflowPx: 10 },
  ]), "split-50-50");
});

test("choosePresentationCandidate : liste vide => null", () => {
  assert.equal(choosePresentationCandidate([]), null);
});

test("normalizePresentationMediaCell : marque le bloc et les wrappers jusqu'à la cellule, retire les tailles explicites", () => {
  const cell = new FakeElement("div");
  const wrapper = cell.createEl("div");
  const mediaBlock = wrapper.createEl("p");
  const img = mediaBlock.createEl("img");
  img.setAttribute("width", "300");
  img.style.width = "300px";
  normalizePresentationMediaCell(cell, mediaBlock);
  assert.equal(mediaBlock.classes.has(PRESENTATION_MEDIA_BLOCK_CLASS), true);
  assert.equal(wrapper.classes.has(PRESENTATION_MEDIA_WRAPPER_CLASS), true);
  assert.equal(cell.classes.has(PRESENTATION_MEDIA_WRAPPER_CLASS), false);
  assert.equal(img.attrs.has("width"), false);
  assert.equal("width" in img.style, false);
});

test("normalizePresentationMediaCell : ignore un audio", () => {
  const cell = new FakeElement("div");
  const mediaBlock = cell.createEl("p");
  const audioEl = mediaBlock.createEl("audio");
  audioEl.setAttribute("width", "300");
  normalizePresentationMediaCell(cell, mediaBlock);
  assert.equal(audioEl.attrs.has("width"), true);
});

// ===== fausse alerte overflow (image intrinsèque grande, contain) =====

test("presentationLayoutOverflows : une cellule média en contain n'est jamais en overflow malgré une image intrinsèque grande", () => {
  const mediaCell = { clientWidth: 500, clientHeight: 400, scrollWidth: 500, scrollHeight: 400 };
  assert.equal(presentationLayoutOverflows(mediaCell), false);
});

// ===== vrai overflow texte =====

test("presentationLayoutOverflows : détecte le dépassement en largeur ou en hauteur", () => {
  const el = { clientWidth: 100, clientHeight: 100, scrollWidth: 100, scrollHeight: 100 };
  assert.equal(presentationLayoutOverflows(el), false);
  assert.equal(presentationLayoutOverflows({ ...el, scrollHeight: 200 }), true);
  assert.equal(presentationLayoutOverflows({ ...el, scrollWidth: 200 }), true);
  const textCell = { clientWidth: 400, clientHeight: 200, scrollWidth: 400, scrollHeight: 350 };
  assert.equal(presentationLayoutOverflows(textCell), true);
});

// ===== taille contain mathématique =====

test("presentationContainedMediaSize A : cellule 500×400, média portrait 600×900 => largeur bridée par la hauteur", () => {
  const size = presentationContainedMediaSize(500, 400, 600, 900);
  assertClose(size.width, 266.6666667);
  assertClose(size.height, 400);
  assertClose(size.area, 106666.6667);
});

test("presentationContainedMediaSize B : cellule 500×400, média paysage 1600×900 => hauteur bridée par la largeur", () => {
  const size = presentationContainedMediaSize(500, 400, 1600, 900);
  assertClose(size.width, 500);
  assertClose(size.height, 281.25);
});

test("presentationContainedMediaSize C : cellule 1100×350, média 1600×900", () => {
  const size = presentationContainedMediaSize(1100, 350, 1600, 900);
  assertClose(size.width, 622.2222222);
  assertClose(size.height, 350);
});

test("presentationContainedMediaSize D : dimensions nulles / négatives / NaN / Infinity => null", () => {
  assert.equal(presentationContainedMediaSize(0, 400, 600, 900), null);
  assert.equal(presentationContainedMediaSize(500, -1, 600, 900), null);
  assert.equal(presentationContainedMediaSize(500, 400, NaN, 900), null);
  assert.equal(presentationContainedMediaSize(500, 400, 600, Infinity), null);
  assert.equal(presentationContainedMediaSize(500, 400, 0, 900), null);
});

test("presentationContainedMediaSize : jamais de crop, jamais de déformation, jamais d'upscale au-delà de la cellule", () => {
  // portrait dans une cellule basse : ne dépasse ni en largeur ni en hauteur, ratio conservé.
  const portrait = presentationContainedMediaSize(1100, 350, 600, 900);
  assert.ok(portrait.width <= 1100 + 0.01);
  assert.ok(portrait.height <= 350 + 0.01);
  assertClose(portrait.width / portrait.height, 600 / 900, 0.001);

  // carte paysage : ne dépasse ni en largeur ni en hauteur, ratio conservé.
  const landscape = presentationContainedMediaSize(500, 400, 1600, 900);
  assert.ok(landscape.width <= 500 + 0.01);
  assert.ok(landscape.height <= 400 + 0.01);
  assertClose(landscape.width / landscape.height, 1600 / 900, 0.001);

  // média plus petit que la cellule : aucun upscale au-delà de sa taille naturelle... en réalité
  // `contain` agrandit toujours jusqu'à remplir une dimension — on vérifie ici seulement qu'il
  // ne dépasse jamais la cellule, jamais ne déforme le ratio.
  const small = presentationContainedMediaSize(1000, 1000, 100, 50);
  assert.ok(small.width <= 1000 + 0.01);
  assert.ok(small.height <= 1000 + 0.01);
  assertClose(small.width / small.height, 100 / 50, 0.001);
});

// ===== invariant de migration : mêmes entrées => même candidat choisi =====
//
// Cas déjà validés dans le prototype avant l'extraction (voir historique de
// test/presentation-prototype.test.js) — non-régression du comportement figé
// après le déplacement vers presentation-layout-engine.ts.

test("Non-régression migration : MEDIA puis TEXT, mesures portrait => mêmes 6 candidats + même gagnant qu'avant l'extraction", () => {
  const inner = slideOf(heading(), media(), text());
  const candidates = candidatesFor(inner);
  assert.deepEqual(candidates.map((c) => c.id), EXPECTED_IDS);

  // mesures synthétiques reproduisant le cas « portrait » déjà validé.
  const measurements = candidates.map((c) => ({
    id: c.id,
    overflowPx: 0,
    mediaArea: c.geometry === "split" ? 200000 : 90000,
    minTextWidth: c.geometry === "split" ? 400 : 1000,
  }));
  assert.equal(choosePresentationCandidate(measurements), "split-42-58");
});

test("Non-régression migration : TEXT puis MEDIA, mesures paysage => même gagnant qu'avant l'extraction", () => {
  const inner = slideOf(heading(), text(), media());
  const candidates = candidatesFor(inner);
  assert.deepEqual(candidates.map((c) => c.id), EXPECTED_IDS);

  const measurements = candidates.map((c) => ({
    id: c.id,
    overflowPx: 0,
    mediaArea: c.geometry === "stack" ? 220000 : 120000,
    minTextWidth: 0,
  }));
  assert.equal(choosePresentationCandidate(measurements), "stack-65-35");
});

test("Non-régression migration : contain 600×900 dans 500×400 — mêmes dimensions qu'avant l'extraction (266.67×400)", () => {
  const size = presentationContainedMediaSize(500, 400, 600, 900);
  assertClose(size.width, 266.6666667);
  assertClose(size.height, 400);
});
