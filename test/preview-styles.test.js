import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Sous-lot H — exigence visuelle absolue : AUCUN fond, aucune surbrillance,
 * aucune pastille derrière les icônes de PreviewView, dans tous les états
 * (repos, survol, focus, actif, sélectionné, clic).
 *
 * Ce test audite le CSS RÉELLEMENT livré. Un test DOM ne pourrait pas le
 * faire : le fond litigieux ne vient pas du TypeScript mais de la classe
 * `clickable-icon` telle que la peint le thème d'Obsidian — c'est donc dans
 * styles.css que la neutralisation doit exister, et c'est là qu'il faut la
 * vérifier. Le pendant côté DOM (aria-pressed, absence de style en ligne)
 * est vérifié dans preview-view.test.js. */

// Commentaires retirés d'abord : sans cela, le commentaire qui précède une
// règle serait lu comme une partie de ses sélecteurs.
const CSS = readFileSync(join(process.cwd(), "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Découpe le CSS en règles { sélecteurs, déclarations }. Les règles
 *  imbriquées dans une @media sont capturées comme les autres. */
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

/** Contrôles de PreviewView : icônes de la barre, libellés cliquables
 *  (mode courant, zoom courant) et bouton de repli de la barre. */
const PREVIEW_CONTROL_RE = /feuillets-preview-(toolbar|view)/;
const CONTROL_RE = /clickable-icon|feuillets-preview-(chip|bar-toggle|breadcrumb-item)/;

const PREVIEW_ICON_RULES = RULES.filter((rule) =>
  rule.selector.split(",").some((sel) => PREVIEW_CONTROL_RE.test(sel) && CONTROL_RE.test(sel))
);

const TRANSPARENT = /^(none|transparent|0 0|inherit|unset|initial)$/;

test("styles — aucune règle de PreviewView ne peint un fond, une ombre ou une bordure sur ses icônes", () => {
  assert.ok(PREVIEW_ICON_RULES.length >= 3, "les règles de neutralisation doivent exister");

  for (const rule of PREVIEW_ICON_RULES) {
    for (const [prop, value] of rule.declarations) {
      if (/^background(-color|-image)?$/.test(prop)) {
        assert.match(value, TRANSPARENT, `« ${prop}: ${value} » interdit sur « ${rule.selector} »`);
      }
      if (prop === "box-shadow") {
        assert.match(value, TRANSPARENT, `box-shadow interdit sur « ${rule.selector} »`);
      }
      if (/^border(-color|-width|-style)?$/.test(prop)) {
        assert.match(value, TRANSPARENT, `bordure accentuée interdite sur « ${rule.selector} »`);
      }
      // Une « pastille » se ferait par un fond arrondi : sans fond ni ombre,
      // aucun rayon ne peut dessiner quoi que ce soit — on refuse quand même
      // toute tentative explicite.
      assert.notEqual(prop, "backdrop-filter", `filtre de fond interdit sur « ${rule.selector} »`);
    }
  }
});

test("styles — la neutralisation couvre repos, survol, focus, focus clavier, clic et état actif", () => {
  const states = [":hover", ":focus", ":focus-visible", ":active", ".feuillets-mode-active", '[aria-pressed="true"]', '[aria-current="page"]'];

  const neutralising = PREVIEW_ICON_RULES.filter((rule) =>
    rule.declarations.some(([prop, value]) => /^background(-color|-image)?$/.test(prop) && TRANSPARENT.test(value))
  );
  assert.ok(neutralising.length > 0);

  for (const state of states) {
    const covered = neutralising.some((rule) =>
      rule.selector.split(",").some((sel) => sel.includes(state) && PREVIEW_CONTROL_RE.test(sel))
    );
    assert.ok(covered, `l'état « ${state} » doit être explicitement neutralisé`);
  }

  // État de repos : une règle sans pseudo-classe doit aussi être couverte.
  const rest = neutralising.some((rule) =>
    rule.selector
      .split(",")
      .some((sel) => /feuillets-preview-(toolbar|view)\s+\.(clickable-icon|feuillets-preview-chip)\s*$/.test(sel.trim()))
  );
  assert.ok(rest, "l'état de repos doit être neutralisé lui aussi");
});

test("styles — l'état actif reste identifiable sans fond (couleur et opacité seulement)", () => {
  const activeRules = PREVIEW_ICON_RULES.filter((rule) =>
    rule.selector.split(",").some((sel) => sel.includes(".feuillets-mode-active") || sel.includes('[aria-pressed="true"]'))
  );
  assert.ok(activeRules.length >= 2, "l'état actif doit être stylé quelque part");

  const marks = new Set();
  for (const rule of activeRules) {
    for (const [prop] of rule.declarations) {
      if (prop === "color" || prop === "opacity") marks.add(prop);
    }
  }
  assert.deepEqual([...marks].sort(), ["color", "opacity"], "couleur d'icône ET opacité, sans arrière-plan");
});

test("styles — la neutralisation ne déborde PAS sur les autres vues Feuillets", () => {
  /* Seules les règles qui NEUTRALISENT (fond, ombre, bordure) sont
     concernées : la règle d'alignement partagée par toutes les barres du
     plugin peut, elle, viser plusieurs vues — elle ne peint rien. */
  const neutralising = PREVIEW_ICON_RULES.filter((rule) =>
    rule.declarations.some(([prop]) => /^(background|box-shadow|border)/.test(prop))
  );
  assert.ok(neutralising.length > 0);

  for (const rule of neutralising) {
    for (const sel of rule.selector.split(",")) {
      const trimmed = sel.trim();
      if (!trimmed) continue;
      assert.match(
        trimmed,
        PREVIEW_CONTROL_RE,
        `« ${trimmed} » sortirait de PreviewView et modifierait les autres barres`
      );
    }
  }
});

test("styles — la barre de contexte reste utilisable en colonne étroite", () => {
  const bar = RULES.find((rule) => rule.selector.split(",").some((sel) => sel.trim() === ".feuillets-preview-toolbar"));
  assert.ok(bar, ".feuillets-preview-toolbar doit être stylée");
  const declarations = new Map(bar.declarations);
  assert.equal(declarations.get("display"), "flex");
  assert.equal(declarations.get("flex-wrap"), "wrap", "la barre doit pouvoir passer à la ligne");

  /* Deuxième essai (barre flottante en deux groupes) : le CONTENEUR ne peint
     plus de fond continu — sinon il redessinerait la « grande barre » entre
     le fil d'Ariane et les icônes, ce qui masquait le texte de la page. La
     variable de fond du thème (clair ET sombre) vit désormais sur le groupe
     de gauche, .feuillets-preview-breadcrumb, seul élément à porter une
     pastille visible. */
  assert.equal(declarations.get("background"), "none", "le conteneur ne doit plus peindre de fond continu entre les deux groupes");

  const breadcrumbGroup = RULES.find((rule) => rule.selector.split(",").some((sel) => sel.trim() === ".feuillets-preview-breadcrumb"));
  assert.ok(breadcrumbGroup, ".feuillets-preview-breadcrumb (groupe de gauche) doit être stylée");
  assert.match(
    new Map(breadcrumbGroup.declarations).get("background") || "",
    /var\(--background-secondary\)/,
    "le fil d'Ariane porte désormais lui-même le fond thémé, clair ET sombre"
  );

  const breadcrumb = RULES.find((rule) => rule.selector.trim() === ".feuillets-preview-breadcrumb-item");
  assert.ok(breadcrumb, "les niveaux du fil d'Ariane doivent être stylés");
  assert.equal(new Map(breadcrumb.declarations).get("text-overflow"), "ellipsis");
});

test("styles — la barre flottante reste discrète hors survol et se révèle au survol/focus", () => {
  const bar = RULES.find((rule) => rule.selector.split(",").some((sel) => sel.trim() === ".feuillets-preview-toolbar"));
  const declarations = new Map(bar.declarations);
  assert.equal(declarations.get("position"), "absolute", "la barre ne doit plus consommer une ligne de hauteur dans le flux");
  assert.equal(declarations.get("opacity"), "0", "discrète par défaut, hors survol");
  assert.ok((declarations.get("transition") || "").includes("opacity"), "seule une transition d'opacité est autorisée");

  const revealRules = RULES.filter((rule) =>
    rule.selector.split(",").some((sel) => {
      const trimmed = sel.trim();
      return trimmed === ".feuillets-preview-toolbar:hover" || trimmed === ".feuillets-preview-toolbar:focus-within";
    })
  );
  assert.ok(revealRules.length > 0, "un survol ou un focus clavier doit révéler la barre");
  for (const rule of revealRules) {
    assert.equal(new Map(rule.declarations).get("opacity"), "1");
  }
});

test("styles — aucun contrôle de barre séparé ne subsiste", () => {
  assert.equal(CSS.includes(".feuillets-preview-bar-toggle {"), false);
  assert.equal(CSS.includes(".feuillets-preview-select {"), false);
});

test("styles — la typographie Feuillets exclut les FileNodes Markdown du Canvas", () => {
  const markdownLeaf = '.workspace-leaf-content[data-type="markdown"]';
  const markdownSurface = /\.(?:markdown-source-view|markdown-preview-view|markdown-rendered|cm-editor|cm-content|cm-line)\b/;
  const feuilletsMarkdownSelectors = RULES.flatMap((rule) =>
    rule.selector
      .split(",")
      .map((selector) => selector.trim())
      .filter((selector) => selector.includes("body.feuillets-") && markdownSurface.test(selector))
  );

  assert.ok(feuilletsMarkdownSelectors.length > 0, "les réglages typographiques doivent rester présents");
  for (const selector of feuilletsMarkdownSelectors) {
    assert.ok(
      selector.includes(markdownLeaf),
      `« ${selector} » pourrait atteindre une vue Markdown embarquée sans leaf native`
    );
  }

  // En édition, le FileNode réel vit dans iframe.canvas-node-iframe-body et
  // commence directement par .markdown-source-view.mod-inside-iframe : il ne
  // possède jamais l'ancêtre positif exigé ci-dessus.
  assert.ok(
    feuilletsMarkdownSelectors.some((selector) => selector.includes(".markdown-source-view")),
    "le Live Preview natif doit rester couvert"
  );
  assert.ok(
    feuilletsMarkdownSelectors.some((selector) => selector.includes(".markdown-preview-view")),
    "le mode lecture natif doit rester couvert"
  );
  assert.equal(
    feuilletsMarkdownSelectors.some((selector) => selector.includes(".canvas-node")),
    false,
    "la correction doit reposer sur la vraie leaf Markdown, pas sur une compensation Canvas"
  );
});
