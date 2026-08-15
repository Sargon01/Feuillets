import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { t } from "../src/i18n/index.js";

/* Ce test tourne compilé depuis .test-dist/test/ (voir tsconfig.test.json,
 * npm run test:compiled), mais lit les SOURCES .ts originales : celles-ci
 * ne sont jamais copiées dans .test-dist. `process.cwd()` reste la racine
 * du dépôt, `npm test` y étant toujours invoqué. */
const repoRoot = process.cwd();

test("Nettoyage Lot 1 : la commande de test dev-test-scrivenings-current-folder n'existe plus", () => {
  const mainSource = readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  assert.equal(mainSource.includes("dev-test-scrivenings-current-folder"), false);
  assert.equal(mainSource.includes("Tester Scrivenings sur le dossier courant"), false);
});

test("Nettoyage Lot 1 : registerView(VIEW_SCRIVENINGS, ...) reste enregistré", () => {
  const mainSource = readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  assert.ok(mainSource.includes("registerView(VIEW_SCRIVENINGS"));
});

test("Nom produit : les libellés visibles Binder/Continu ne contiennent jamais « Scrivenings »", () => {
  assert.equal(t("binder.openInContinu"), "Ouvrir en continu");
  assert.equal(t("scrivenings.display.title"), "Continu");
  assert.equal(/scrivenings/i.test(t("scrivenings.display.title")), false);
  assert.equal(/scrivenings/i.test(t("binder.openInContinu")), false);
});

/** Extrait grossièrement les paires `"clé": "valeur"` d'un fichier i18n —
 * un vrai parseur JS serait disproportionné ici : on ne vérifie que
 * l'absence du mot « Scrivenings » dans les VALEURS affichées, jamais dans
 * les clés techniques (qui commencent légitimement par `scrivenings.`). */
function extractI18nEntries(source) {
  const entries = [];
  const re = /^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm;
  let match;
  while ((match = re.exec(source))) {
    entries.push({ key: match[1], value: match[2] });
  }
  return entries;
}

test("Nom produit : aucune VALEUR visible des dictionnaires i18n n'affiche « Scrivenings »", () => {
  for (const locale of ["fr", "en"]) {
    const source = readFileSync(path.join(repoRoot, `src/i18n/${locale}.ts`), "utf8");
    const entries = extractI18nEntries(source);
    assert.ok(entries.length > 100, `sanity check : le dictionnaire ${locale} doit contenir de nombreuses entrées`);
    const offenders = entries.filter((e) => /scrivenings/i.test(e.value));
    assert.deepEqual(offenders, [], `aucune valeur visible (${locale}) ne doit contenir "Scrivenings"`);
  }
});

/* ===================== Lot 2B.2 §8 : plus de barre locale sous Continu =====================
 * Décision produit définitive : les statistiques du groupe ne s'affichent
 * plus QUE dans la barre d'état Feuillets (main.ts) — jamais un second DOM
 * local sous CodeMirror, qui a provoqué la régression de layout observée en
 * test manuel. Vérification structurelle sur les SOURCES (même patron que
 * les tests "Nettoyage Lot 1" ci-dessus) : aucune façon de faire mentir un
 * test Node sur une largeur réelle de navigateur, donc on vérifie plutôt que
 * le code qui créait cette ligne locale a bien disparu. */
test("Lot 2B.2 §8 : ScriveningsView ne crée plus aucun DOM .feuillets-scrivenings-stats", () => {
  const source = readFileSync(path.join(repoRoot, "src/views/scrivenings-view.ts"), "utf8");
  assert.equal(source.includes("feuillets-scrivenings-stats"), false);
  assert.equal(source.includes("statsEl"), false);
});

test("Lot 2B.2 §8 : styles.css ne contient plus la règle .feuillets-scrivenings-stats ni le conteneur Continu en colonne flex", () => {
  const css = readFileSync(path.join(repoRoot, "styles.css"), "utf8");
  assert.equal(css.includes(".feuillets-scrivenings-stats"), false);

  const containerMatch = css.match(/\.feuillets-scrivenings-container\s*\{([^}]*)\}/);
  assert.ok(containerMatch, "la règle .feuillets-scrivenings-container doit toujours exister");
  assert.equal(/display:\s*flex/.test(containerMatch[1]), false, "plus de colonne flex artificielle introduite pour la ligne de stats");
  assert.equal(/flex-direction/.test(containerMatch[1]), false);
});

test("Lot 2B.2 §9-10 : les statistiques du groupe Continu sont lues par main.ts via getGroupStats(), jamais un TFile actif", () => {
  const mainSource = readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
  assert.ok(mainSource.includes("getGroupStats()"), "updateStatusBar() doit lire le groupe Continu via getGroupStats()");
  assert.ok(mainSource.includes("getActiveViewOfType(ScriveningsView)"), "la détection de la vue active doit passer par ScriveningsView, jamais getActiveFile() en priorité");
});
