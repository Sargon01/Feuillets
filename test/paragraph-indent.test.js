import test from "node:test";
import assert from "node:assert/strict";
import { isNonParagraphLine, isNonParagraphRegexFallback } from "../src/utils/cm-paragraph-indent.js";

function createMockStateWithTree(nodeMap) {
  return {
    tree: {
      iterate({ from, to, enter }) {
        const list = nodeMap.ranges || nodeMap.ancestors || [];
        const match = list.find((r) => r.from <= from && r.to >= to);
        if (match) {
          enter({ name: match.name });
        }
      },
      resolveInner(pos) {
        const match = nodeMap.ancestors?.find((a) => a.from <= pos && a.to >= pos);
        if (match) {
          return { name: match.name, parent: match.parent ? { name: match.parent, parent: null } : null };
        }
        return null;
      },
    },
  };
}

test("isNonParagraphLine : détection avec l'arbre syntaxique CodeMirror 6 (syntaxTree)", () => {
  const codeBlockState = createMockStateWithTree({
    ancestors: [
      { from: 0, to: 10, name: "CodeMark", parent: "FencedCode" },
      { from: 11, to: 30, name: "CodeText", parent: "FencedCode" },
      { from: 31, to: 40, name: "CodeMark", parent: "FencedCode" },
    ],
  });

  // Ligne d'ouverture ```
  assert.equal(isNonParagraphLine(codeBlockState, 0, 10, "```js"), true);
  // Ligne de texte située entre ``` et ```
  assert.equal(isNonParagraphLine(codeBlockState, 11, 30, "const x = 42;"), true);
  // Ligne de fermeture ```
  assert.equal(isNonParagraphLine(codeBlockState, 31, 40, "```"), true);

  const frontMatterState = createMockStateWithTree({
    ancestors: [
      { from: 0, to: 3, name: "YAMLHeader", parent: "FrontMatter" },
      { from: 4, to: 20, name: "yaml", parent: "FrontMatter" },
      { from: 21, to: 24, name: "YAMLHeader", parent: "FrontMatter" },
    ],
  });

  // Première ligne ---
  assert.equal(isNonParagraphLine(frontMatterState, 0, 3, "---"), true);
  // Propriété YAML située dans le frontmatter
  assert.equal(isNonParagraphLine(frontMatterState, 4, 20, "title: Mon Livre"), true);
  // Ligne de fermeture ---
  assert.equal(isNonParagraphLine(frontMatterState, 21, 24, "---"), true);

  const headerState = createMockStateWithTree({
    ancestors: [{ from: 0, to: 15, name: "ATXHeading1", parent: "Document" }],
  });
  assert.equal(isNonParagraphLine(headerState, 0, 15, "# Grand Titre"), true);

  const listState = createMockStateWithTree({
    ancestors: [{ from: 0, to: 15, name: "ListItem", parent: "BulletList" }],
  });
  assert.equal(isNonParagraphLine(listState, 0, 15, "- Premier point"), true);

  const quoteState = createMockStateWithTree({
    ancestors: [{ from: 0, to: 15, name: "Blockquote", parent: "Document" }],
  });
  assert.equal(isNonParagraphLine(quoteState, 0, 15, "> Une citation"), true);

  const tableState = createMockStateWithTree({
    ancestors: [{ from: 0, to: 20, name: "TableRow", parent: "Table" }],
  });
  assert.equal(isNonParagraphLine(tableState, 0, 20, "| Col A | Col B |"), true);

  // Ligne vide
  assert.equal(isNonParagraphLine(headerState, 0, 0, "   "), true);

  // Paragraphe Markdown ordinaire
  const paragraphState = createMockStateWithTree({
    ancestors: [{ from: 0, to: 30, name: "Paragraph", parent: "Document" }],
  });
  assert.equal(isNonParagraphLine(paragraphState, 0, 30, "Ceci est un vrai paragraphe de roman."), false);
});

test("isNonParagraphRegexFallback : secours par regex isolée", () => {
  assert.equal(isNonParagraphRegexFallback("Ceci est un paragraphe."), false);
  assert.equal(isNonParagraphRegexFallback("# Titre"), true);
  assert.equal(isNonParagraphRegexFallback("- Liste"), true);
  assert.equal(isNonParagraphRegexFallback("> Citation"), true);
  assert.equal(isNonParagraphRegexFallback("```"), true);
  assert.equal(isNonParagraphRegexFallback("---"), true);
  assert.equal(isNonParagraphRegexFallback("| A | B |"), true);
  assert.equal(isNonParagraphRegexFallback(""), true);
});
