import test from "node:test";
import assert from "node:assert/strict";
import { renderContentCollectionMarkdown } from "../src/services/content-collection-render.js";

const collection = (roles) => ({ id: "collection", name: "Collection", roles });

test("un rôle produit uniquement le bloc collecté", () => {
  const markdown = "# Chapitre\n\nTexte ordinaire.\n\n> [!definition]\n> Définition.\n\n> [!preuve]\n> Preuve.";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["definition"])), "# Chapitre\n\n> [!definition]\n> Définition.");
});

test("plusieurs rôles restent dans l'ordre source et suppriment le reste", () => {
  const markdown = "# Chapitre\n\n## Partie A\n\n> [!preuve]\n> A\n\nTexte supprimé.\n\n> [!source]\n> B\n\n> [!definition]\n> C";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["source", "preuve"])), "# Chapitre\n\n## Partie A\n\n> [!preuve]\n> A\n\n> [!source]\n> B");
});

test("le contexte commun n'est pas répété et un nouveau H2 est émis", () => {
  const markdown = "# Chapitre\n\n## Partie A\n\n> [!definition]\n> A\n\n> [!preuve]\n> B\n\n## Partie B\n\n> [!definition]\n> C";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["definition", "preuve"])), "# Chapitre\n\n## Partie A\n\n> [!definition]\n> A\n\n> [!preuve]\n> B\n\n## Partie B\n\n> [!definition]\n> C");
});

test("conserve H1 à H6 et le Markdown exact des callouts", () => {
  const callout = "> [!source]+  Titre  \n> Texte  ";
  const markdown = "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n\n" + callout;
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["source"])), "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n\n" + callout);
});

test("utilise CRLF pour les séparations générées", () => {
  const markdown = "# Chapitre\r\n\r\n## Partie\r\n\r\n> [!preuve]\r\n> A\r\n\r\n## Suite\r\n\r\n> [!preuve]\r\n> B";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["preuve"])), "# Chapitre\r\n\r\n## Partie\r\n\r\n> [!preuve]\r\n> A\r\n\r\n## Suite\r\n\r\n> [!preuve]\r\n> B");
  assert.equal(renderContentCollectionMarkdown("Texte", collection(["preuve"])), null);
});

test("conserve PAGE_BREAK_BEFORE immédiatement devant un callout sélectionné", () => {
  const markdown = "FEUILLETS_LAYOUT_PAGE_BREAK_BEFORE\n\n> [!source]\n> Conservé";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["source"])), "FEUILLETS_LAYOUT_PAGE_BREAK_BEFORE\n\n> [!source]\n> Conservé");
});

test("ne transfère pas PAGE_BREAK_BEFORE depuis un callout non sélectionné", () => {
  const markdown = "FEUILLETS_LAYOUT_PAGE_BREAK_BEFORE\n\n> [!preuve]\n> Supprimé\n\n> [!source]\n> Conservé";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["source"])), "> [!source]\n> Conservé");
});

test("conserve les marqueurs de réponse déjà contenus dans un callout sélectionné", () => {
  const markdown = "> [!questions] FEUILLETS_LAYOUT_ANSWER_LINES_2\n> Question";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["questions"])), markdown);
});

test("réémet H2 lors d'une remontée H1/H2/H3 vers H1/H2", () => {
  const markdown = "# Chapitre\n\n## Partie\n\n### Sous-partie\n\n> [!definition]\n> A\n\n## Partie\n\n> [!definition]\n> B";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["definition"])), "# Chapitre\n\n## Partie\n\n### Sous-partie\n\n> [!definition]\n> A\n\n## Partie\n\n> [!definition]\n> B");
});

test("réémet uniquement H2 lors d'une remontée H1/H2/H3/H4 vers H1/H2", () => {
  const markdown = "# Chapitre\n\n## Partie\n\n### Sous-partie\n\n#### Détail\n\n> [!definition]\n> A\n\n## Partie\n\n> [!definition]\n> B";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["definition"])), "# Chapitre\n\n## Partie\n\n### Sous-partie\n\n#### Détail\n\n> [!definition]\n> A\n\n## Partie\n\n> [!definition]\n> B");
});

test("deux callouts sous le même H1/H2 n'émettent les headings qu'une fois", () => {
  const markdown = "# Chapitre\n\n## Partie\n\n> [!definition]\n> A\n\n> [!definition]\n> B";
  assert.equal(renderContentCollectionMarkdown(markdown, collection(["definition"])), "# Chapitre\n\n## Partie\n\n> [!definition]\n> A\n\n> [!definition]\n> B");
});
