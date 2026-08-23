import assert from "node:assert/strict";
import test from "node:test";
import {
  splitMarkdownLogicalUnits,
  splitMarkdownLogicalUnitsWithRanges,
} from "../src/utils/markdown-logical-boundaries.js";

/* Utilitaire générique extrait du découpeur de diapositives Présentation
   (voir src/services/presentation.ts, qui délègue désormais ici) — la même
   mécanique de reconnaissance de frontière est réutilisée telle quelle par
   le profil d'export document (voir export-render.ts). */

test("splitMarkdownLogicalUnits : une frontière `---` isolée sépare deux unités", () => {
  assert.deepEqual(splitMarkdownLogicalUnits("# A\n---\n# B"), ["# A", "# B"]);
});

test("splitMarkdownLogicalUnitsWithRanges : plages identiques au contrat Presentation existant", () => {
  const markdown = "# A\n---\n# B";
  const plain = splitMarkdownLogicalUnits(markdown);
  const ranged = splitMarkdownLogicalUnitsWithRanges(markdown);
  assert.deepEqual(ranged.map((u) => u.markdown), plain);
  assert.deepEqual(ranged.map((u) => [u.startLine, u.endLine]), [[0, 1], [2, 2]]);
});

test("splitMarkdownLogicalUnits : le frontmatter YAML initial n'est jamais une frontière — seul le `---` du corps compte", () => {
  const markdown = "---\ntitle: Test\n---\n# A\n---\n# B";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), ["# A", "# B"]);
});

test("splitMarkdownLogicalUnits : un `---` à l'intérieur d'une fence backticks n'est pas une frontière", () => {
  assert.deepEqual(splitMarkdownLogicalUnits("```md\n---\n```"), ["```md\n---\n```"]);
});

test("splitMarkdownLogicalUnits : un `---` à l'intérieur d'une fence tildes n'est pas une frontière", () => {
  assert.deepEqual(splitMarkdownLogicalUnits("~~~\n---\n~~~"), ["~~~\n---\n~~~"]);
});

test("splitMarkdownLogicalUnits : `***` n'est jamais une frontière", () => {
  assert.deepEqual(splitMarkdownLogicalUnits("# A\n***\n# B"), ["# A\n***\n# B"]);
});

test("splitMarkdownLogicalUnits : `___` n'est jamais une frontière", () => {
  assert.deepEqual(splitMarkdownLogicalUnits("# A\n___\n# B"), ["# A\n___\n# B"]);
});

// ---------- Directives pagebreak/saut-page comme frontières Présentation ----------

test("splitMarkdownLogicalUnits : `> [!pagebreak]` top-level crée une frontière, la directive est consommée", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("# Chapitre 1\n\n> [!pagebreak]\n\n# Chapitre 2"),
    ["# Chapitre 1", "# Chapitre 2"]
  );
});

test("splitMarkdownLogicalUnits : `> [!saut-page]` top-level crée une frontière, la directive est consommée", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("# Chapitre 1\n\n> [!saut-page]\n\n# Chapitre 2"),
    ["# Chapitre 1", "# Chapitre 2"]
  );
});

test("splitMarkdownLogicalUnits : `>[!pagebreak]` sans espace après `>` est reconnu comme frontière", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("# A\n>[!pagebreak]\n# B"),
    ["# A", "# B"]
  );
});

test("splitMarkdownLogicalUnits : directive avec titre est consommée", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("# A\n> [!pagebreak] Titre du chapitre\n# B"),
    ["# A", "# B"]
  );
});

test("splitMarkdownLogicalUnits : directive avec titre et contenu multi-ligne est entièrement consommée", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("# A\n> [!pagebreak] Titre\n> Contenu ligne 1\n> Contenu ligne 2\n# B"),
    ["# A", "# B"]
  );
});

test("splitMarkdownLogicalUnits : directive imbriquée `> > [!pagebreak]` ne crée pas de frontière", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("# A\n> [!note]\n> > [!pagebreak]\n# B"),
    ["# A\n> [!note]\n> > [!pagebreak]\n# B"]
  );
});

test("splitMarkdownLogicalUnits : `---` et `> [!pagebreak]` consécutifs créent une seule rupture", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("# A\n---\n> [!pagebreak]\n# B"),
    ["# A", "# B"]
  );
});

test("splitMarkdownLogicalUnits : `> [!saut-page]` et `---` consécutifs créent une seule rupture", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("# A\n> [!saut-page]\n---\n# B"),
    ["# A", "# B"]
  );
});

test("splitMarkdownLogicalUnits : plusieurs `> [!pagebreak]` consécutifs créent une seule rupture", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("# A\n> [!pagebreak]\n> [!pagebreak]\n# B"),
    ["# A", "# B"]
  );
});

test("splitMarkdownLogicalUnits : directive `> [!pagebreak]` au début du corps ne crée pas de slide vide", () => {
  const result = splitMarkdownLogicalUnits("> [!pagebreak]\n# A");
  assert.equal(result.length, 1);
  assert.equal(result[0], "# A");
});

test("splitMarkdownLogicalUnits : directive `> [!pagebreak]` à la fin du corps ne crée pas de slide vide", () => {
  const result = splitMarkdownLogicalUnits("# A\n> [!pagebreak]");
  assert.equal(result.length, 1);
  assert.equal(result[0], "# A");
});

test("splitMarkdownLogicalUnits : `> [!pagebreak]` dans une fence n'est pas une frontière", () => {
  assert.deepEqual(
    splitMarkdownLogicalUnits("```\n> [!pagebreak]\n```"),
    ["```\n> [!pagebreak]\n```"]
  );
});

test("splitMarkdownLogicalUnits : `***` et `___` ne sont jamais des frontières (présentation)", () => {
  assert.deepEqual(splitMarkdownLogicalUnits("# A\n***\n# B"), ["# A\n***\n# B"]);
  assert.deepEqual(splitMarkdownLogicalUnits("# A\n___\n# B"), ["# A\n___\n# B"]);
});

test("splitMarkdownLogicalUnitsWithRanges : ranges corrects pour directive `> [!pagebreak]`", () => {
  const markdown = "# A\n> [!pagebreak]\n# B";
  const ranges = splitMarkdownLogicalUnitsWithRanges(markdown);
  assert.deepEqual(ranges.map((u) => u.markdown), ["# A", "# B"]);
  // La directive appartient au range de l'unité qu'elle ferme
  assert.deepEqual(ranges.map((u) => [u.startLine, u.endLine]), [[0, 1], [2, 2]]);
});

test("splitMarkdownLogicalUnitsWithRanges : groupe de frontières consécutives `--- + [!pagebreak] + ---` — toutes les lignes au range précédent", () => {
  const markdown = "# A\n---\n> [!pagebreak]\n---\n# B";
  const ranges = splitMarkdownLogicalUnitsWithRanges(markdown);
  assert.deepEqual(ranges.map((u) => u.markdown), ["# A", "# B"]);
  // Tout le groupe [ligne 1, 2, 3] appartient au range de la première unité
  assert.deepEqual(ranges.map((u) => [u.startLine, u.endLine]), [[0, 3], [4, 4]]);
});

test("splitMarkdownLogicalUnitsWithRanges : groupe avec lignes blanches intermédiaires — toutes les lignes au range précédent", () => {
  const markdown = "# A\n\n---\n\n> [!saut-page]\n\n# B";
  const ranges = splitMarkdownLogicalUnitsWithRanges(markdown);
  assert.deepEqual(ranges.map((u) => u.markdown), ["# A", "# B"]);
  // Lignes 0-6 : "# A", "", "---", "", "> [!saut-page]", "", "# B"
  // Tout le groupe de frontières + blanches [1-5] appartient au range [0-5] de A
  assert.deepEqual(ranges.map((u) => [u.startLine, u.endLine]), [[0, 5], [6, 6]]);
});

// ---------- Fences imbriquées : longueur de la fence ouvrante mémorisée ----------

test("splitMarkdownLogicalUnits : une fence ouverte à 4 backticks n'est pas refermée par une ligne de 3 backticks — le `---` interne reste dans la même unité", () => {
  const markdown = "````\n```\n---\n````";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), [markdown]);
});

test("splitMarkdownLogicalUnits : même protection avec des tildes (ouverture 4, pseudo-fermeture 3)", () => {
  const markdown = "~~~~\n~~~\n---\n~~~~";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), [markdown]);
});

test("splitMarkdownLogicalUnits : une fence se ferme par le même marqueur de longueur égale", () => {
  assert.deepEqual(splitMarkdownLogicalUnits("````\n---\n````\n# B"), ["````\n---\n````\n# B"]);
  assert.deepEqual(
    splitMarkdownLogicalUnits("````\n---\n````\n---\n# B"),
    ["````\n---\n````", "# B"]
  );
});

test("splitMarkdownLogicalUnits : une fence se ferme par le même marqueur de longueur supérieure", () => {
  const markdown = "```\n---\n`````\n---\n# B";
  // La fence à 3 backticks est refermée par la ligne à 5 backticks (>= 3) ;
  // le `---` qui suit est alors de nouveau une frontière hors fence.
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), ["```\n---\n`````", "# B"]);
});

test("splitMarkdownLogicalUnits : un marqueur opposé (tilde) ne referme pas une fence backticks", () => {
  const markdown = "```\n~~~\n---\n```";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), [markdown]);
});

test("splitMarkdownLogicalUnits : `> [!pagebreak]` à l'intérieur d'une fence 4 backticks pseudo-fermée par 3 backticks n'est jamais consommé", () => {
  const markdown = "````\n```\n> [!pagebreak]\n````";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), [markdown]);
});

test("splitMarkdownLogicalUnits : `> [!saut-page]` à l'intérieur d'une fence tildes 4/3 n'est jamais consommé", () => {
  const markdown = "~~~~\n~~~\n> [!saut-page]\n~~~~";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), [markdown]);
});

// ---------- BUG 1 : Code indenté ne doit jamais être une frontière ----------

test("BUG 1 : code indenté `    ---` ne doit pas être une frontière", () => {
  // 4 espaces = bloc de code en Markdown, ne doit pas être reconnu comme frontière
  const markdown = "# A\n    ---\n# B";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), ["# A\n    ---\n# B"]);
});

test("BUG 1 : code indenté avec plus de 4 espaces ne doit pas être une frontière", () => {
  const markdown = "# A\n      ---\n# B";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), ["# A\n      ---\n# B"]);
});

test("BUG 1 : code indenté `    > [!pagebreak]` ne doit pas être une frontière", () => {
  const markdown = "# A\n    > [!pagebreak]\n# B";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), ["# A\n    > [!pagebreak]\n# B"]);
});

test("BUG 1 : code indenté `    > [!saut-page]` ne doit pas être une frontière", () => {
  const markdown = "# A\n    > [!saut-page]\n# B";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), ["# A\n    > [!saut-page]\n# B"]);
});

test("BUG 1 : indentation de 3 espaces ou moins est autorisée pour les frontières", () => {
  const markdown = "# A\n   ---\n# B";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), ["# A", "# B"]);
});

test("BUG 1 : indentation avec tabs: 1 tab = bloc de code, ne doit pas être une frontière", () => {
  const markdown = "# A\n\t---\n# B";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), ["# A\n\t---\n# B"]);
});

// ---------- BUG 2 : Fermeture de fence trop permissive ----------

test("BUG 2 : fermeture de fence avec texte après les backticks ne referme pas", () => {
  // ``` texte n'est pas une fermeture valide, le texte après doit être vide ou espaces/tabs
  const markdown = "```\n---\n``` texte";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), [markdown]);
});

test("BUG 2 : fermeture de fence avec backtick supplémentaire après", () => {
  // ``` ` n'est pas une fermeture valide, juste des espaces/tabs autorisés après
  const markdown = "```\n---\n``` `";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), [markdown]);
});

test("BUG 2 : fermeture de fence avec espace puis texte après", () => {
  const markdown = "```\n---\n```  text";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), [markdown]);
});

test("BUG 2 : fermeture de fence valide avec espaces/tabs après (trim appliqué)", () => {
  // Note: trim() supprime les espaces de fin du markdown, mais la fence est
  // correctement fermée et pas réouverte ensuite
  const markdown = "```\n---\n```  \t  ";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), ["```\n---\n```"]);
});

test("BUG 2 : même règle avec tildes", () => {
  const markdown = "~~~\n---\n~~~ texte";
  assert.deepEqual(splitMarkdownLogicalUnits(markdown), [markdown]);
});

// ---------- BUG 3 : Ranges des callouts multilignes `[!pagebreak]` / `[!saut-page]` ----------

test("BUG 3 : directive `> [!pagebreak]` multiligne (titre + 2 lignes) — range inclut tout le callout", () => {
  const markdown = "# A\n> [!pagebreak] Titre\n> Contenu 1\n> Contenu 2\n# B";
  const ranges = splitMarkdownLogicalUnitsWithRanges(markdown);
  // Contenu vérifié
  assert.deepEqual(ranges.map((u) => u.markdown), ["# A", "# B"]);
  // Range : le callout entier (lignes 1-3) appartient à l'unité A
  assert.deepEqual(ranges.map((u) => [u.startLine, u.endLine]), [[0, 3], [4, 4]]);
});

test("BUG 3 : directive `> [!saut-page]` multiligne (titre + 2 lignes) — range inclut tout le callout", () => {
  const markdown = "# A\n> [!saut-page] Titre\n> Contenu 1\n> Contenu 2\n# B";
  const ranges = splitMarkdownLogicalUnitsWithRanges(markdown);
  // Contenu vérifié
  assert.deepEqual(ranges.map((u) => u.markdown), ["# A", "# B"]);
  // Range : le callout entier (lignes 1-3) appartient à l'unité A
  assert.deepEqual(ranges.map((u) => [u.startLine, u.endLine]), [[0, 3], [4, 4]]);
});

test("BUG 3 : callout structurel + lignes blanches + contenu — conserver le contrat actuel", () => {
  const markdown = "# A\n\n> [!pagebreak] Titre\n> Contenu 1\n\n# B";
  const ranges = splitMarkdownLogicalUnitsWithRanges(markdown);
  // Contenu vérifié
  assert.deepEqual(ranges.map((u) => u.markdown), ["# A", "# B"]);
  // Range : lignes 0-3 pour A (# A + blank + callout), lignes 4-5 pour B (blank + # B)
  assert.deepEqual(ranges.map((u) => [u.startLine, u.endLine]), [[0, 3], [4, 5]]);
});

test("BUG 3 : frontières consécutives — aucun slide vide", () => {
  const markdown = "# A\n> [!pagebreak]\n> [!saut-page]\n# B";
  const ranges = splitMarkdownLogicalUnitsWithRanges(markdown);
  // Pas de slide vide entre les directives
  assert.equal(ranges.length, 2);
  assert.deepEqual(ranges.map((u) => u.markdown), ["# A", "# B"]);
  // Ranges : ligne 0 pour A, puis lignes 1-2 (directives consécutives), puis ligne 3 pour B
  assert.deepEqual(ranges.map((u) => [u.startLine, u.endLine]), [[0, 2], [3, 3]]);
});
