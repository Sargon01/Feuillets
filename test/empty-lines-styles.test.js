import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Micro-correctif final "ligne blanche fantôme à l'ouverture" (styles.css
 * seul — voir son commentaire d'en-tête pour le détail du problème et de la
 * correction). Comme test/preview-styles.test.js, ce test audite le CSS
 * RÉELLEMENT livré : la régression ne vient d'aucun TypeScript (le
 * mécanisme `.feuillets-empty-line`/`liveDoubleEnter` est inchangé), mais
 * d'une règle CSS `:not(.cm-active)` qui masquait à tort une ligne vide
 * seulement quand elle N'ÉTAIT PAS active — or CodeMirror peut donner
 * `.cm-active` à une ligne dès le montage, sans édition réelle. */

const CSS = readFileSync(join(process.cwd(), "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function parseRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    declarations: [...m[2].matchAll(/([a-z-]+)\s*:\s*([^;]+)/gi)].map(([, prop, value]) => [
      prop.trim().toLowerCase(),
      value.replace(/!important/g, "").trim().toLowerCase(),
    ]),
  }));
}

const RULES = parseRules(CSS);

function declarationValue(rule, prop) {
  const found = rule.declarations.find(([p]) => p === prop);
  return found ? found[1] : undefined;
}

/* ==================== A/B — Markdown ==================== */

const markdownInvisibleRules = RULES.filter(
  (r) =>
    r.selector.includes("feuillets-lignesvides-invisible") &&
    r.selector.includes('data-type="markdown"') &&
    r.selector.includes("feuillets-empty-line")
);

test("A. Markdown/invisible : la règle générale .cm-line.feuillets-empty-line masque TOUJOURS (display: none), plus jamais avec :not(.cm-active)", () => {
  const generalRule = markdownInvisibleRules.find((r) => !r.selector.includes("cm-active"));
  assert.ok(generalRule, "la règle générale (sans .cm-active) doit exister");
  assert.equal(declarationValue(generalRule, "display"), "none");
  assert.doesNotMatch(generalRule.selector, /:not\(\.cm-active\)/, "l'ancienne exception :not(.cm-active) ne doit plus exister — c'est elle qui causait la ligne fantôme");
});

test("B. Markdown/édition réelle : .cm-editor.cm-focused .cm-line.feuillets-empty-line.cm-active réaffiche (display: block), jamais au simple montage", () => {
  const reappearRule = markdownInvisibleRules.find(
    (r) => r.selector.includes("cm-focused") && r.selector.includes("cm-active")
  );
  assert.ok(reappearRule, "la règle de réaffichage pendant l'édition réelle doit exister");
  assert.equal(declarationValue(reappearRule, "display"), "block");
  assert.match(reappearRule.selector, /\.cm-editor\.cm-focused/, "doit exiger un éditeur RÉELLEMENT focalisé — jamais juste .cm-active seul");
});

/* ==================== C — Continu ==================== */

const continuInvisibleRules = RULES.filter(
  (r) =>
    r.selector.includes("feuillets-lignesvides-invisible") &&
    r.selector.includes('data-type="feuillets-scrivenings"') &&
    r.selector.includes("feuillets-empty-line")
);

test("C. Continu : même contrat que Markdown sous [data-type=\"feuillets-scrivenings\"] — masquage général sans :not(.cm-active)", () => {
  const generalRule = continuInvisibleRules.find((r) => !r.selector.includes("cm-active"));
  assert.ok(generalRule, "la règle générale Continu doit exister");
  assert.equal(declarationValue(generalRule, "display"), "none");
  assert.doesNotMatch(generalRule.selector, /:not\(\.cm-active\)/);
});

test("C. Continu : réaffichage pendant l'édition réelle, même sélecteur .cm-editor.cm-focused ... .cm-active", () => {
  const reappearRule = continuInvisibleRules.find(
    (r) => r.selector.includes("cm-focused") && r.selector.includes("cm-active")
  );
  assert.ok(reappearRule, "la règle de réaffichage Continu doit exister");
  assert.equal(declarationValue(reappearRule, "display"), "block");
});

/* ==================== D — Réduit (inchangé) ==================== */

test("D. Mode réduit : conserve exactement height: 0.6rem, Markdown ET Continu, sans condition .cm-active", () => {
  const reduitRules = RULES.filter(
    (r) => r.selector.includes("feuillets-lignesvides-reduit") && r.selector.includes("feuillets-empty-line")
  );
  assert.equal(reduitRules.length, 2, "une règle réduit pour Markdown, une pour Continu");
  for (const rule of reduitRules) {
    assert.equal(declarationValue(rule, "height"), "0.6rem");
    assert.doesNotMatch(rule.selector, /cm-active/, "le mode réduit ne dépend jamais de .cm-active");
  }
});

/* ==================== E — Mode normal (aucun changement spécifique) ==================== */

test("E. Mode normal : ce correctif n'introduit AUCUNE règle .feuillets-empty-line hors des modes invisible/réduit", () => {
  const emptyLineRules = RULES.filter((r) => r.selector.includes("feuillets-empty-line"));
  for (const rule of emptyLineRules) {
    assert.ok(
      rule.selector.includes("feuillets-lignesvides-invisible") || rule.selector.includes("feuillets-lignesvides-reduit"),
      `règle inattendue hors invisible/réduit : « ${rule.selector} »`
    );
  }
});

/* ==================== F — Preview jamais touché par ce correctif ==================== */

test("F. Preview : aucune règle .cm-line/.cm-active n'est ajoutée sous markdown-preview-view/markdown-rendered — le mécanisme p.feuillets-empty-paragraph reste seul et inchangé", () => {
  const previewEmptyRules = RULES.filter(
    (r) =>
      (r.selector.includes("markdown-preview-view") || r.selector.includes("markdown-rendered")) &&
      r.selector.includes("feuillets-lignesvides")
  );
  assert.ok(previewEmptyRules.length > 0, "les règles historiques Preview (p.feuillets-empty-paragraph, br:last-child…) doivent toujours exister");
  for (const rule of previewEmptyRules) {
    assert.doesNotMatch(rule.selector, /\.cm-line|\.cm-active|\.cm-editor|\.cm-focused/, `Preview ne doit jamais dépendre de CodeMirror : « ${rule.selector} »`);
    assert.doesNotMatch(rule.selector, /feuillets-empty-line\b/, "Preview reste sur son propre marqueur, jamais .feuillets-empty-line (CodeMirror)");
  }
});
