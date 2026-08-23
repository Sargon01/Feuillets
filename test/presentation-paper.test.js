import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPresentationPaperUnits,
  presentationPaperScale,
  planAdaptivePair,
  shouldAdoptAdaptivePair,
  ADAPTIVE_PAIR_CLASS,
  ADAPTIVE_CONTENT_CLASS,
  ADAPTIVE_MEDIA_CLASS,
} from "../src/services/presentation-paper.js";

/** Nœud minimal satisfaisant `AdaptivePairElementLike` (voir
 * presentation-paper.ts) — un simple objet, jamais un vrai DOM : ces tests
 * couvrent l'ÉLIGIBILITÉ pure, indépendamment de toute mesure (voir
 * test/preview-view.test.js pour l'intégration DOM/mesure réelle). */
function block(tagName, classes = []) {
  const set = new Set(classes);
  return { tagName, classList: { contains: (cls) => set.has(cls) } };
}
const heading = (tag = "H2") => block(tag);
const media = (...extraClasses) => block("DIV", ["feuillets-doc-media-block", ...extraClasses]);
const content = (tag = "P") => block(tag);

test("buildPresentationPaperUnits : trois slides séparées par --- donnent trois unités", () => {
  const input = `slide 1
---
slide 2
---
slide 3`;
  const units = buildPresentationPaperUnits(input);
  assert.equal(units.length, 3);
  assert.match(units[0].markdown, /slide 1/);
  assert.match(units[1].markdown, /slide 2/);
  assert.match(units[2].markdown, /slide 3/);
});

test("buildPresentationPaperUnits : slides séparées par [!pagebreak]", () => {
  const input = `slide A
> [!pagebreak]
slide B
> [!pagebreak]
slide C`;
  const units = buildPresentationPaperUnits(input);
  assert.equal(units.length, 3);
  assert.match(units[0].markdown, /slide A/);
  assert.match(units[1].markdown, /slide B/);
  assert.match(units[2].markdown, /slide C/);
});

test("buildPresentationPaperUnits : slides séparées par [!saut-page]", () => {
  const input = `slide X
> [!saut-page]
slide Y
> [!saut-page]
slide Z`;
  const units = buildPresentationPaperUnits(input);
  assert.equal(units.length, 3);
});

test("buildPresentationPaperUnits : aucune frontière présente dans unit.markdown", () => {
  const input = `slide 1
---
slide 2
> [!pagebreak]
slide 3
> [!saut-page]
slide 4`;
  const units = buildPresentationPaperUnits(input);
  for (const unit of units) {
    assert.doesNotMatch(unit.markdown, /^\s*---\s*$/m);
    assert.doesNotMatch(unit.markdown, /\[!pagebreak\]/);
    assert.doesNotMatch(unit.markdown, /\[!saut-page\]/);
  }
});

test("buildPresentationPaperUnits : frontières consécutives ne produisent aucune unité vide", () => {
  const input = `slide 1
---
---
slide 2`;
  const units = buildPresentationPaperUnits(input);
  for (const unit of units) {
    assert.ok(unit.markdown.trim().length > 0, "aucune unité ne doit être vide");
  }
});

test("buildPresentationPaperUnits : frontmatter/fences — protections du splitter préservées", () => {
  const input = `---
title: Test
---

slide 1
\`\`\`
code
---
dans fence
\`\`\`
---
slide 2`;
  const units = buildPresentationPaperUnits(input);
  const joined = units.map((u) => u.markdown).join("\n");
  // Le YAML n'apparaît dans aucune unité (retiré par le splitter).
  assert.doesNotMatch(joined, /title: Test/);
  // Le contenu des slides est préservé.
  assert.match(joined, /slide 1/);
  assert.match(joined, /slide 2/);
  // Le --- à l'intérieur du fence n'est pas une frontière : il reste dans
  // la première unité, avec le code.
  assert.match(units[0].markdown, /dans fence/);
});

test("buildPresentationPaperUnits : les plages de lignes (ranges) sont préservées", () => {
  const input = `slide 1
---
slide 2`;
  const units = buildPresentationPaperUnits(input);
  assert.equal(units.length, 2);
  for (const unit of units) {
    assert.equal(typeof unit.startLine, "number");
    assert.equal(typeof unit.endLine, "number");
    assert.ok(unit.endLine >= unit.startLine);
  }
});

test("buildPresentationPaperUnits : le Markdown source n'est jamais muté", () => {
  const input = `slide 1
---
slide 2`;
  const before = input;
  buildPresentationPaperUnits(input);
  assert.equal(input, before);
});

test("buildPresentationPaperUnits : Markdown vide ne produit aucune unité", () => {
  const units = buildPresentationPaperUnits("");
  assert.equal(units.length, 0);
});

test("buildPresentationPaperUnits : une seule slide sans séparateur donne une unité", () => {
  const units = buildPresentationPaperUnits("seul slide");
  assert.equal(units.length, 1);
  assert.match(units[0].markdown, /seul slide/);
});

test("presentationPaperScale : contenu qui tient parfaitement", () => {
  const scale = presentationPaperScale(800, 1000, 800, 800);
  assert.equal(scale, 1);
});

test("presentationPaperScale : réduction selon la hauteur", () => {
  const scale = presentationPaperScale(800, 1000, 800, 1250);
  assert.ok(Math.abs(scale - 0.8) < 0.01);
});

test("presentationPaperScale : réduction selon la largeur", () => {
  const scale = presentationPaperScale(800, 1000, 1000, 900);
  assert.ok(Math.abs(scale - 0.8) < 0.01);
});

test("presentationPaperScale : dimensions invalides retournent 1", () => {
  assert.equal(presentationPaperScale(0, 1000, 800, 800), 1);
  assert.equal(presentationPaperScale(800, -1000, 800, 800), 1);
  assert.equal(presentationPaperScale(800, 1000, 0, 800), 1);
  assert.equal(presentationPaperScale(800, 1000, 800, -800), 1);
});

test("presentationPaperScale : dimensions NaN retournent 1", () => {
  assert.equal(presentationPaperScale(NaN, 1000, 800, 800), 1);
  assert.equal(presentationPaperScale(800, NaN, 800, 800), 1);
  assert.equal(presentationPaperScale(800, 1000, NaN, 800), 1);
  assert.equal(presentationPaperScale(800, 1000, 800, NaN), 1);
});

test("presentationPaperScale : infini retourne 1", () => {
  assert.equal(presentationPaperScale(Infinity, 1000, 800, 800), 1);
  assert.equal(presentationPaperScale(800, Infinity, 800, 800), 1);
  assert.equal(presentationPaperScale(800, 1000, Infinity, 800), 1);
  assert.equal(presentationPaperScale(800, 1000, 800, Infinity), 1);
});

test("presentationPaperScale : jamais d'agrandissement > 1", () => {
  const scale = presentationPaperScale(1000, 1000, 800, 800);
  assert.ok(scale <= 1);
});

test("presentationPaperScale : contrainte de largeur", () => {
  const scale = presentationPaperScale(400, 1000, 800, 500);
  assert.ok(Math.abs(scale - 0.5) < 0.01);
});

test("presentationPaperScale : contrainte de hauteur", () => {
  const scale = presentationPaperScale(1000, 500, 800, 1000);
  assert.ok(Math.abs(scale - 0.5) < 0.01);
});

/* ===================== planAdaptivePair — éligibilité ===================== */

test("planAdaptivePair : benchmark B — deux blocs avant un unique média est éligible (content-media)", () => {
  const children = [heading(), content(), content(), media()];
  const plan = planAdaptivePair(children);
  assert.ok(plan, "deux blocs significatifs du même côté du média doivent être éligibles");
  assert.equal(plan.bodyStart, 1, "le titre initial ne fait jamais partie du corps");
  assert.equal(plan.mediaIndex, 3);
  assert.deepEqual(plan.contentIndices, [1, 2]);
  assert.equal(plan.orientation, "content-media");
});

test("planAdaptivePair : média puis deux blocs est éligible (media-content)", () => {
  const children = [heading(), media(), content(), content()];
  const plan = planAdaptivePair(children);
  assert.ok(plan);
  assert.equal(plan.mediaIndex, 1);
  assert.deepEqual(plan.contentIndices, [2, 3]);
  assert.equal(plan.orientation, "media-content");
});

test("planAdaptivePair : sans titre initial reste éligible (bodyStart = 0)", () => {
  const children = [content(), content(), media()];
  const plan = planAdaptivePair(children);
  assert.ok(plan);
  assert.equal(plan.bodyStart, 0);
});

test("planAdaptivePair : règle 4 — contenu significatif avant ET après le média -> aucun plan", () => {
  const children = [heading(), content(), media(), content()];
  assert.equal(planAdaptivePair(children), null);
});

test("planAdaptivePair : règle 5 — deux médias -> aucun plan", () => {
  const children = [heading(), content(), content(), media(), media()];
  assert.equal(planAdaptivePair(children), null);
});

test("planAdaptivePair : règle 6 — média + un seul bloc -> aucun plan (moteur Document décide)", () => {
  const children = [heading(), content(), media()];
  assert.equal(planAdaptivePair(children), null);
});

test("planAdaptivePair : aucun média -> aucun plan", () => {
  const children = [heading(), content(), content(), content()];
  assert.equal(planAdaptivePair(children), null);
});

test("planAdaptivePair : règle 9 — directive image: explicite (placement) sur le média -> aucun plan", () => {
  const children = [heading(), content(), content(), media("feuillets-image-placement-left")];
  assert.equal(planAdaptivePair(children), null);
});

test("planAdaptivePair : règle 9 — colonnes: explicite déjà en place -> aucun plan", () => {
  const children = [heading(), block("DIV", ["feuillets-columns"]), media()];
  assert.equal(planAdaptivePair(children), null);
});

test("planAdaptivePair : règle 8/9 — média déjà apparié à un rôle (dessous compris) -> aucun plan", () => {
  const children = [heading(), content(), content(), media("feuillets-document-media-role-pair")];
  assert.equal(planAdaptivePair(children), null);
});

test("planAdaptivePair : règle 7 — plusieurs titres initiaux (H1-H3) restent tous hors du corps", () => {
  const children = [heading("H1"), heading("H2"), content(), content(), media()];
  const plan = planAdaptivePair(children);
  assert.ok(plan);
  assert.equal(plan.bodyStart, 2);
});

test("planAdaptivePair : moins de deux blocs de contenu (média seul) -> aucun plan", () => {
  const children = [heading(), media()];
  assert.equal(planAdaptivePair(children), null);
});

/* =================== shouldAdoptAdaptivePair — décision =================== */

test("shouldAdoptAdaptivePair : adopte seulement un candidat strictement meilleur", () => {
  assert.equal(shouldAdoptAdaptivePair(0.6, 0.9), true);
  assert.equal(shouldAdoptAdaptivePair(0.6, 0.6), false, "égalité -> on conserve le naturel, jamais une bascule inutile");
  assert.equal(shouldAdoptAdaptivePair(0.6, 0.4), false);
});

test("noms de classes des wrappers adaptatifs — locaux au support papier, jamais réutilisés ailleurs", () => {
  assert.equal(ADAPTIVE_PAIR_CLASS, "feuillets-presentation-paper-adaptive-pair");
  assert.equal(ADAPTIVE_CONTENT_CLASS, "feuillets-presentation-paper-adaptive-content");
  assert.equal(ADAPTIVE_MEDIA_CLASS, "feuillets-presentation-paper-adaptive-media");
});
