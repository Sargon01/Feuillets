import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchRegExp,
  preserveCase,
  replaceInText,
  splitFrontmatter,
} from "../src/services/manuscript-search-replace.js";

test("search-replace : préserve le frontmatter par défaut", () => {
  const content = "---\ntitle: Kemal\n---\nKemal retrouve kemal.";

  const result = replaceInText(content, "kemal", "Altan");

  assert.equal(result.newContent, "---\ntitle: Kemal\n---\nAltan retrouve Altan.");
  assert.equal(result.count, 2);
});

test("search-replace : gère la casse et les diacritiques", () => {
  assert.equal(preserveCase("KEMAL", "Altan"), "ALTAN");
  assert.equal(preserveCase("Kemal", "altan"), "Altan");
  assert.ok(buildSearchRegExp("elodie", { ignoreDiacritics: true })?.test("Élodie"));
  assert.equal(replaceInText("Élodie", "elodie", "Jeanne", { ignoreDiacritics: true }).newContent, "Jeanne");
});

test("search-replace : accepte les captures regex et refuse un motif invalide", () => {
  const result = replaceInText("Chapitre 12", "(Chapitre) (\\d+)", "$2 — $1", { useRegex: true });

  assert.deepEqual(result, { newContent: "12 — Chapitre", count: 1 });
  assert.equal(buildSearchRegExp("[", { useRegex: true }), null);
});

test("search-replace : sépare uniquement un frontmatter initial", () => {
  assert.deepEqual(splitFrontmatter("Texte\n---\nSuite"), { frontmatter: "", body: "Texte\n---\nSuite" });
});

test("shared text replacement preserves CRLF and BOM frontmatter, including closing delimiter at EOF", () => {
  for (const frontmatter of ["---\r\ntitle: ney\r\n---\r\n", "\uFEFF---\ntitle: ney\n---\n", "---\ntitle: ney\n---"]) {
    const content = frontmatter.endsWith("\n") ? frontmatter + "ney" : frontmatter;
    const result = replaceInText(content, "ney", "x");
    assert.equal(result.newContent, frontmatter + (content === frontmatter ? "" : "x"));
    assert.equal(result.count, content === frontmatter ? 0 : 1);
    assert.equal(replaceInText(content, "ney", "x", { includeYaml: true }).count, content === frontmatter ? 1 : 2);
  }
  assert.equal(splitFrontmatter("---suffix\ntitle: ney\n---\nney").frontmatter, "");
});

test("shared text replacement respects whole words and starts-with in accented text", () => {
  assert.equal(replaceInText("été étéx xété", "été", "x", { matchMode: "wholeWord" }).newContent, "x étéx xété");
  assert.equal(replaceInText("été étéx xété", "été", "x", { matchMode: "startsWith" }).newContent, "x xx xété");
  assert.equal(replaceInText("été étéx xété", "été", "x", { matchMode: "exactWord" }).newContent, "x étéx xété");
});

test("shared regex replacements expand captures once and support missing, named and literal tokens", () => {
  assert.equal(replaceInText("a", "(a)(b)?", "$2:$1:$$:$&", { useRegex: true }).newContent, ":a:$:a");
  assert.equal(replaceInText("a", "(?<letter>a)", "$<letter>", { useRegex: true }).newContent, "a");
  assert.equal(replaceInText("$2 b", "(\\$2) (b)", "$1/$2", { useRegex: true }).newContent, "$2/b");
  assert.equal(replaceInText("ney", "ney", "$1").newContent, "$1");
});

test("shared Markdown protection recognizes escaped delimiters and all supported wrapping styles", () => {
  for (const marker of ["*", "**", "***", "_", "__", "___"]) {
    const result = replaceInText("ney *before ney after* **ney** `ney`", "ney", marker + "ney" + marker, { protectMarkdown: true });
    assert.equal(result.count, 1, marker);
    assert.equal(replaceInText(result.newContent, "ney", marker + "ney" + marker, { protectMarkdown: true }).count, 0, marker);
  }
  assert.equal(replaceInText("\\*ney\\*", "ney", "*ney*", { protectMarkdown: true }).count, 1);
  assert.equal(replaceInText("*ney* `ney`", "ney", "x", { protectMarkdown: true }).newContent, "*x* `x`");
});

test("protected wrapping does not merge delimiter runs or alter existing emphasis", () => {
  for (const content of ["ney**ney\n_before **__", "*`ney ney neyneybefore before ", "*before  ney neyneyafter __\n"]) {
    const first = replaceInText(content, "ney", "**ney**", { protectMarkdown: true });
    const second = replaceInText(first.newContent, "ney", "**ney**", { protectMarkdown: true });
    assert.equal(second.count, 0, content);
  }
  assert.deepEqual(replaceInText("ney**ney\n_before **__", "ney", "**ney**", { protectMarkdown: true }), { newContent: "ney**ney\n_before **__", count: 0 });
});

test("protected wrapping is idempotent across deterministic Markdown delimiter combinations", () => {
  const atoms = ["ney", " ney ", "*", "**", "_", "__", "`", "\\*", "before ", "\n", "after "];
  let seed = 17;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  for (let index = 0; index < 6000; index++) {
    let content = "";
    for (let atom = 0; atom < 8; atom++) content += atoms[random() % atoms.length];
    for (const replacement of ["*ney*", "**ney**", "_ney_"]) {
      const first = replaceInText(content, "ney", replacement, { protectMarkdown: true });
      const second = replaceInText(first.newContent, "ney", replacement, { protectMarkdown: true });
      assert.equal(second.count, 0, JSON.stringify({ content, replacement }));
      assert.equal(second.newContent, first.newContent);
    }
  }
});
