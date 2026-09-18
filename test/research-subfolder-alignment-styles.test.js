import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Ajustement de l'alignement horizontal des sous-dossiers du panneau
 * Recherche : le chevron, l'icône et le nom paraissaient décalés d'environ
 * 6px vers la droite par rapport à leur niveau hiérarchique. Comme
 * empty-lines-styles.test.js, ce test audite le CSS RÉELLEMENT livré (aucun
 * TypeScript n'est en cause — le rendu de renderResearchSubfolder est
 * inchangé, seul styles.css est corrigé). */

const CSS = readFileSync(join(process.cwd(), "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function parseRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    declarations: [...m[2].matchAll(/([a-z-]+)\s*:\s*([^;]+)/gi)].map(([, prop, value]) => [
      prop.trim().toLowerCase(),
      value.trim().toLowerCase(),
    ]),
  }));
}

const RULES = parseRules(CSS);

function ruleFor(selector) {
  return RULES.find((r) => r.selector === selector);
}

function declarationValue(rule, prop) {
  const found = rule?.declarations.find(([p]) => p === prop);
  return found ? found[1] : undefined;
}

test("le chevron des sous-dossiers Recherche est recalé de -6px, exactement le padding horizontal du header qu'il compense", () => {
  const headerRule = ruleFor(".feuillets-research-container .feuillets-research-item .feuillets-research-item-header");
  assert.ok(headerRule, "la règle de padding du header doit exister");
  assert.equal(declarationValue(headerRule, "padding"), "2px 6px", "le décalage doit correspondre exactement au padding horizontal existant, pour ne jamais déborder");

  const chevronRule = ruleFor(".feuillets-research-subfolder-chevron");
  assert.ok(chevronRule, "la règle du chevron doit exister");
  assert.equal(declarationValue(chevronRule, "margin-left"), "-6px");
});

test("le décalage n'utilise jamais !important", () => {
  const chevronRule = ruleFor(".feuillets-research-subfolder-chevron");
  const raw = chevronRule.declarations.find(([p]) => p === "margin-left")[1];
  assert.doesNotMatch(raw, /!important/);
});

test("non-régression : rien d'autre n'a changé — indentation entre niveaux, trait vertical, colonne type, boutons de ligne", () => {
  const nestedRule = ruleFor(".feuillets-research-nested");
  assert.ok(nestedRule, "l'indentation/trait vertical des sous-niveaux doit toujours exister");
  assert.equal(declarationValue(nestedRule, "margin-left"), "5px");
  assert.equal(declarationValue(nestedRule, "padding-left"), "5px");
  assert.equal(declarationValue(nestedRule, "border-left"), "1px solid var(--background-modifier-border)");

  const iconRule = ruleFor(".feuillets-research-item-icon");
  assert.ok(iconRule, "la colonne type (fichiers ET sous-dossiers) doit rester inchangée");
  assert.equal(declarationValue(iconRule, "width"), "22px");
  assert.equal(declarationValue(iconRule, "margin-left"), undefined, "l'icône elle-même ne doit porter aucun décalage propre — seul le chevron en porte un, qui l'entraîne");

  const menuBtnRule = ruleFor(".feuillets-research-item-menu-btn");
  assert.ok(menuBtnRule, "le bouton \"…\", toujours visible, doit rester une règle à part, jamais touchée par le décalage");

  // Le nom des sous-dossiers (feuillets-research-subfolder-chevron ne le cible pas) garde son style propre, inchangé.
  const subfolderNameRule = ruleFor(".feuillets-research-subfolder > .feuillets-research-item-header > .feuillets-research-item-name");
  assert.ok(subfolderNameRule, "le style du nom des sous-dossiers (graisse/contraste) doit rester inchangé");
  assert.equal(declarationValue(subfolderNameRule, "margin-left"), undefined, "le nom ne porte lui-même aucun décalage — il suit le chevron par le flux flex, jamais par une règle propre");
});
