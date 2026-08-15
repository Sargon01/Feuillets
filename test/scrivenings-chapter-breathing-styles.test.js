import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Micro-correctif final, §3 : la frontière de chapitre dans Continu doit
 * respirer davantage (validation visuelle réelle : encore trop proche du
 * dernier paragraphe après le lot précédent). Ce test audite le CSS
 * RÉELLEMENT livré — même patron que test/empty-lines-styles.test.js — pour
 * verrouiller la relation demandée (+40% sur l'espace AVANT la frontière,
 * jamais sur le trait ni sur la scène) sans dépendre d'un rendu DOM réel
 * (hors de portée en Node, voir cm-scrivenings.test.js pour la logique de
 * sélection de classe). */

const CSS = readFileSync(join(process.cwd(), "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

function declarationValue(block, prop) {
  const match = block && block.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`, "i"));
  return match ? match[1].trim() : undefined;
}

test("§3 : la frontière chapitre (.feuillets-scrivenings-title-role-chapitre) respire 40% de plus qu'avant sur l'espace AVANT le trait (margin-top)", () => {
  const chapterBlock = ruleFor(".feuillets-scrivenings-title-divider.feuillets-scrivenings-title-role-chapitre");
  assert.ok(chapterBlock, "la règle dédiée au rôle chapitre doit exister");

  const marginTop = declarationValue(chapterBlock, "margin-top");
  assert.equal(marginTop, "5.6em", "4em (valeur précédente) + 40% = 5.6em");
});

test("§3 : le petit espace entre le trait et le titre (padding-top) reste cohérent, volontairement inchangé", () => {
  const chapterBlock = ruleFor(".feuillets-scrivenings-title-divider.feuillets-scrivenings-title-role-chapitre");
  assert.equal(declarationValue(chapterBlock, "padding-top"), "2.5em");
});

test("§3 : le trait lui-même reste discret — aucune épaisseur/couleur de bordure renforcée pour le rôle chapitre, jamais de <hr>", () => {
  const chapterBlock = ruleFor(".feuillets-scrivenings-title-divider.feuillets-scrivenings-title-role-chapitre");
  assert.doesNotMatch(chapterBlock, /border/i, "la bordure fine reste posée UNIQUEMENT par .feuillets-scrivenings-title-divider, jamais surchargée ici");

  const dividerBlock = ruleFor(".feuillets-scrivenings-title-divider");
  assert.equal(declarationValue(dividerBlock, "border-top"), "1px solid var(--background-modifier-border)", "le trait de base (scène/compact) reste inchangé");

  assert.doesNotMatch(CSS, /<hr>/, "aucun <hr> introduit dans le CSS");
});

test("§3 : la transition de scène (divider seul, sans le modificateur chapitre) reste strictement compacte, inchangée", () => {
  const dividerBlock = ruleFor(".feuillets-scrivenings-title-divider");
  assert.equal(declarationValue(dividerBlock, "margin-top"), "2.25em");
  assert.equal(declarationValue(dividerBlock, "padding-top"), "1.25em");
});
