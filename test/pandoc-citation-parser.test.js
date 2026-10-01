/* Structured Pandoc Citation Parser Tests (Lot 7A) */

import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (p) => new URL(`../.test-dist/${p}`, import.meta.url).href;
const modulePath = (p) => (isCompiledTest ? `../${p}` : compiledModule(p));

const {
  parsePandocCitationDocument,
  parseCitationItem,
  maskProtectedContexts,
  extractPandocCitekey,
} = await import(modulePath("src/services/pandoc-citation-parser.js"));

test("maskProtectedContexts: preserves text length while masking code and links", () => {
  const input = "Here is `code` and [link](https://example.org/@user) and [@cite].";
  const masked = maskProtectedContexts(input);
  assert.equal(masked.length, input.length);
  assert.ok(!masked.includes("https://example.org/@user"));
  assert.ok(!masked.includes("`code`"));
});

test("parseCitationItem: basic parenthetical citation item", () => {
  const item = parseCitationItem("@smith2024");
  assert.deepEqual(item, { id: "smith2024" });
});

test("parseCitationItem: item with prefix", () => {
  const item = parseCitationItem("see @smith2024");
  assert.deepEqual(item, { id: "smith2024", prefix: "see " });
});

test("parseCitationItem: item with locator and page label", () => {
  const item = parseCitationItem("@smith2024, p. 42");
  assert.deepEqual(item, { id: "smith2024", locator: "42", label: "page" });

  const itemPlural = parseCitationItem("@smith2024, pp. 100-105");
  assert.deepEqual(itemPlural, { id: "smith2024", locator: "100-105", label: "page" });
});

test("parseCitationItem: item with chapter and section labels", () => {
  const chItem = parseCitationItem("also @doe2023, ch. 3");
  assert.deepEqual(chItem, { id: "doe2023", prefix: "also ", locator: "3", label: "chapter" });

  const secItem = parseCitationItem("@law2022, sec. 15");
  assert.deepEqual(secItem, { id: "law2022", locator: "15", label: "section" });
});

test("parseCitationItem: suppress-author item", () => {
  const item = parseCitationItem("-@smith2024");
  assert.deepEqual(item, { id: "smith2024", mode: "suppress-author" });

  const withPrefix = parseCitationItem("see -@smith2024, p. 12");
  assert.deepEqual(withPrefix, {
    id: "smith2024",
    prefix: "see ",
    locator: "12",
    label: "page",
    mode: "suppress-author",
  });
});

test("parseCitationItem: unformatted trailing text preserved as suffix", () => {
  const item = parseCitationItem("@smith2024, with critical commentary");
  assert.deepEqual(item, {
    id: "smith2024",
    suffix: ", with critical commentary",
  });
});

test("parseCitationItem: locator with trailing suffix", () => {
  const item = parseCitationItem("@smith2024, p. 42, note 1");
  assert.deepEqual(item, {
    id: "smith2024",
    locator: "42",
    label: "page",
    suffix: ", note 1",
  });
});

test("parseCitationItem: bare number locator treated as page", () => {
  const item = parseCitationItem("@smith2024, 42");
  assert.deepEqual(item, {
    id: "smith2024",
    locator: "42",
    label: "page",
  });
});

test("parseCitationDocument: single bracket citation [@smith2024]", () => {
  const doc = parsePandocCitationDocument("A statement [@smith2024].");
  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];
  assert.equal(occ.raw, "[@smith2024]");
  assert.equal(occ.from, 12);
  assert.equal(occ.to, 24);
  assert.equal(occ.clusterId, "citation:12:24");
  assert.deepEqual(occ.cluster.items, [{ id: "smith2024" }]);
  assert.equal(occ.cluster.noteIndex, undefined);
});

test("parseCitationDocument: grouped citations [@smith2024; @doe2023]", () => {
  const doc = parsePandocCitationDocument("[@smith2024; @doe2023]");
  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];
  assert.equal(occ.raw, "[@smith2024; @doe2023]");
  assert.equal(occ.from, 0);
  assert.equal(occ.to, 22);
  assert.equal(occ.cluster.items.length, 2);
  assert.equal(occ.cluster.items[0].id, "smith2024");
  assert.equal(occ.cluster.items[1].id, "doe2023");
});

test("parseCitationDocument: citation with locator [@smith2024, p. 42]", () => {
  const doc = parsePandocCitationDocument("[@smith2024, p. 42]");
  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];
  assert.equal(occ.raw, "[@smith2024, p. 42]");
  assert.deepEqual(occ.cluster.items, [
    { id: "smith2024", locator: "42", label: "page" },
  ]);
});

test("parseCitationDocument: suppress-author [-@smith2024]", () => {
  const doc = parsePandocCitationDocument("[-@smith2024]");
  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];
  assert.equal(occ.raw, "[-@smith2024]");
  assert.deepEqual(occ.cluster.items, [
    { id: "smith2024", mode: "suppress-author" },
  ]);
});

test("parseCitationDocument: prefix and locators [see @smith2024; also @doe2023, ch. 3]", () => {
  const doc = parsePandocCitationDocument("[see @smith2024; also @doe2023, ch. 3]");
  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];
  assert.equal(occ.raw, "[see @smith2024; also @doe2023, ch. 3]");
  assert.deepEqual(occ.cluster.items, [
    { id: "smith2024", prefix: "see " },
    { id: "doe2023", prefix: "also ", locator: "3", label: "chapter" },
  ]);
});

test("parseCitationDocument: narrative citation @smith2024", () => {
  const doc = parsePandocCitationDocument("According to @smith2024, this holds.");
  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];
  assert.equal(occ.raw, "@smith2024");
  assert.equal(occ.from, 13);
  assert.equal(occ.to, 23);
  assert.equal(occ.clusterId, "citation:13:23");
  assert.deepEqual(occ.cluster.items, [
    { id: "smith2024", mode: "composite" },
  ]);
});

test("parseCitationDocument: narrative citation at end of sentence with trailing period", () => {
  const doc = parsePandocCitationDocument("We follow @smith2024.");
  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];
  assert.equal(occ.raw, "@smith2024");
  assert.equal(occ.to, 20);
  assert.equal(doc.occurrences[0].cluster.items[0].id, "smith2024");
});

test("parseCitationDocument: multiple clusters in one paragraph", () => {
  const input = "As shown by @smith2024, the effect is real [@doe2023, p. 5; @jones2021].";
  const doc = parsePandocCitationDocument(input);
  assert.equal(doc.occurrences.length, 2);

  // Occurrence 1: narrative
  assert.equal(doc.occurrences[0].raw, "@smith2024");
  assert.equal(doc.occurrences[0].cluster.items[0].id, "smith2024");
  assert.equal(doc.occurrences[0].cluster.items[0].mode, "composite");

  // Occurrence 2: bracket
  assert.equal(doc.occurrences[1].raw, "[@doe2023, p. 5; @jones2021]");
  assert.equal(doc.occurrences[1].cluster.items.length, 2);
  assert.equal(doc.occurrences[1].cluster.items[0].id, "doe2023");
  assert.equal(doc.occurrences[1].cluster.items[0].locator, "5");
  assert.equal(doc.occurrences[1].cluster.items[1].id, "jones2021");
});

test("parseCitationDocument: multiline document with exact offsets", () => {
  const input = [
    "Line 1 with @first2020.",
    "Line 2 has [@second2021, p. 10].",
    "",
    "Line 4 ends with [-@third2022].",
  ].join("\n");

  const doc = parsePandocCitationDocument(input);
  assert.equal(doc.occurrences.length, 3);

  for (const occ of doc.occurrences) {
    assert.equal(input.slice(occ.from, occ.to), occ.raw);
    assert.equal(occ.clusterId, `citation:${occ.from}:${occ.to}`);
  }
});

test("parseCitationDocument: valid punctuated citekeys", () => {
  const input = "[@smith:2024; @doe_2023-a; @rfc#123; @sub.dir/item]";
  const doc = parsePandocCitationDocument(input);
  assert.equal(doc.occurrences.length, 1);
  const items = doc.occurrences[0].cluster.items;
  assert.equal(items.length, 4);
  assert.equal(items[0].id, "smith:2024");
  assert.equal(items[1].id, "doe_2023-a");
  assert.equal(items[2].id, "rfc#123");
  assert.equal(items[3].id, "sub.dir/item");
});

test("parseCitationDocument: Unicode prose", () => {
  const input = "D'après l'étude de @muller2024, la mémoire s'améliore [voir @dupont2020, p. 12].";
  const doc = parsePandocCitationDocument(input);
  assert.equal(doc.occurrences.length, 2);
  assert.equal(doc.occurrences[0].raw, "@muller2024");
  assert.equal(doc.occurrences[1].raw, "[voir @dupont2020, p. 12]");
});

test("parseCitationDocument: protected contexts are ignored", () => {
  const input = `---
title: Test
author: @authorFrontmatter
---

<!-- HTML comment [@comment2024] and @commentNarrative -->

\`\`\`typescript
const cite = "[@fencedCode2024]";
\`\`\`

Here is inline \`[@inlineCode2024]\` and \`@inlineNarrative\`.

<pre>[@pre2024]</pre>
<code>@code2024</code>

A wikilink [[@wikilink2024]] must not match.

A markdown link [destination with at](https://example.org/@urlDestination2024) must stay untouched.

Escaped citations: \\[@escapedBracket2024] and \\@escapedNarrative2024.

Email: contact@example.com and user.name@domain.co.uk.

Bare URL: https://example.org/@inUrlPath2024.

Real citation at the end: [@real2024].
`;

  const doc = parsePandocCitationDocument(input);
  assert.equal(doc.occurrences.length, 1);
  assert.equal(doc.occurrences[0].raw, "[@real2024]");
  assert.equal(doc.occurrences[0].cluster.items[0].id, "real2024");
});

test("parseCitationDocument: unresolved citekeys are parsed structurally", () => {
  const input = "[@completely_unknown_key_9999, p. 77]";
  const doc = parsePandocCitationDocument(input);
  assert.equal(doc.occurrences.length, 1);
  assert.deepEqual(doc.occurrences[0].cluster.items, [
    { id: "completely_unknown_key_9999", locator: "77", label: "page" },
  ]);
});

test("parseCitationDocument: non-citation bracket groups are ignored", () => {
  const inputs = [
    "[ordinary text]",
    "[see chapter 1; see page 5]",
    "[1]",
    "[]",
    "[@]",
    "[image.png]",
    "![image](https://example.com/pic.png)",
    "[link text](https://example.com)",
  ];

  for (const text of inputs) {
    const doc = parsePandocCitationDocument(text);
    assert.equal(
      doc.occurrences.length,
      0,
      `Expected 0 citations for: ${text}`
    );
  }
});

/* -------------------- Non-regression: noteIndex semantics (Lot 7A) -------------------- */

test("parseCitationDocument: citation in footnote definition has undefined noteIndex", () => {
  const input = "[^1]: texte [@smith2024]";
  const doc = parsePandocCitationDocument(input);
  assert.equal(doc.occurrences.length, 1);
  assert.equal(doc.occurrences[0].raw, "[@smith2024]");
  assert.equal(doc.occurrences[0].cluster.items[0].id, "smith2024");
  assert.equal(doc.occurrences[0].cluster.noteIndex, undefined);
  assert.equal(doc.clusters[0].noteIndex, undefined);
});

/* -------------------- Non-regression: isValidCitekey domains (Lot 7A) -------------------- */

test("parseCitationDocument: citekeys with internal punctuation allowed by isValidCitekey", () => {
  // alpha#beta, alpha%beta, alpha+beta, alpha.beta, alpha:beta, alpha/beta
  const bracketInput = "[@alpha#beta; @alpha%beta, p. 10; @alpha+beta; @alpha.beta; @alpha:beta; @alpha/beta]";
  const doc = parsePandocCitationDocument(bracketInput);
  assert.equal(doc.occurrences.length, 1);
  const items = doc.occurrences[0].cluster.items;
  assert.equal(items.length, 6);
  assert.equal(items[0].id, "alpha#beta");
  assert.equal(items[1].id, "alpha%beta");
  assert.equal(items[1].locator, "10");
  assert.equal(items[1].label, "page");
  assert.equal(items[2].id, "alpha+beta");
  assert.equal(items[3].id, "alpha.beta");
  assert.equal(items[4].id, "alpha:beta");
  assert.equal(items[5].id, "alpha/beta");
});

test("parseCitationDocument: citekeys with Pandoc internal punctuation (: . # $ % & - + ? < > ~ /)", () => {
  const bracketInput = "[@alpha#beta; @alpha%beta, p. 10; @alpha+beta; @alpha.beta; @alpha:beta; @alpha/beta; @key~1; @price$5; @author&co]";
  const doc = parsePandocCitationDocument(bracketInput);
  assert.equal(doc.occurrences.length, 1);
  const items = doc.occurrences[0].cluster.items;
  assert.equal(items.length, 9);
  assert.equal(items[0].id, "alpha#beta");
  assert.equal(items[1].id, "alpha%beta");
  assert.equal(items[1].locator, "10");
  assert.equal(items[1].label, "page");
  assert.equal(items[2].id, "alpha+beta");
  assert.equal(items[3].id, "alpha.beta");
  assert.equal(items[4].id, "alpha:beta");
  assert.equal(items[5].id, "alpha/beta");
  assert.equal(items[6].id, "key~1");
  assert.equal(items[7].id, "price$5");
  assert.equal(items[8].id, "author&co");
});

test("parseCitationDocument: citekeys with ? < > internal punctuation", () => {
  const input = "Discussion of @foo?bar alongside @foo<bar and @foo>bar.";
  const doc = parsePandocCitationDocument(input);
  assert.equal(doc.occurrences.length, 3);
  assert.equal(doc.occurrences[0].cluster.items[0].id, "foo?bar");
  assert.equal(doc.occurrences[1].cluster.items[0].id, "foo<bar");
  assert.equal(doc.occurrences[2].cluster.items[0].id, "foo>bar");
});

test("parseCitationDocument: non-Pandoc characters (^, =, *, |) are not absorbed into non-braced keys", () => {
  // In narrative prose:
  const narrativeInput = "Tests: @math^2, @assign=val, @ptr*ref, @opt|alt.";
  const narrativeDoc = parsePandocCitationDocument(narrativeInput);
  assert.equal(narrativeDoc.occurrences.length, 4);
  assert.equal(narrativeDoc.occurrences[0].raw, "@math");
  assert.equal(narrativeDoc.occurrences[0].cluster.items[0].id, "math");
  assert.equal(narrativeDoc.occurrences[1].raw, "@assign");
  assert.equal(narrativeDoc.occurrences[1].cluster.items[0].id, "assign");
  assert.equal(narrativeDoc.occurrences[2].raw, "@ptr");
  assert.equal(narrativeDoc.occurrences[2].cluster.items[0].id, "ptr");
  assert.equal(narrativeDoc.occurrences[3].raw, "@opt");
  assert.equal(narrativeDoc.occurrences[3].cluster.items[0].id, "opt");

  // In bracketed groups:
  const bracketDoc = parsePandocCitationDocument("[@math^2]");
  assert.equal(bracketDoc.occurrences.length, 1);
  assert.equal(bracketDoc.occurrences[0].cluster.items[0].id, "math");
  assert.equal(bracketDoc.occurrences[0].cluster.items[0].suffix, "^2");
});

test("parseCitationDocument: mandatory test @Foo_bar.baz. strips trailing period in non-braced key", () => {
  const doc = parsePandocCitationDocument("As described in @Foo_bar.baz.");
  assert.equal(doc.occurrences.length, 1);
  assert.equal(doc.occurrences[0].raw, "@Foo_bar.baz");
  assert.equal(doc.occurrences[0].cluster.items[0].id, "Foo_bar.baz");
});

test("parseCitationDocument: mandatory test @{Foo_bar.baz.} preserves trailing punctuation inside braced key", () => {
  const doc = parsePandocCitationDocument("As described in @{Foo_bar.baz.}");
  assert.equal(doc.occurrences.length, 1);
  assert.equal(doc.occurrences[0].raw, "@{Foo_bar.baz.}");
  assert.equal(doc.occurrences[0].cluster.items[0].id, "Foo_bar.baz.");
});

test("parseCitationDocument: mandatory test [@{https://example.com/bib?name=foobar&date=2000}, p. 33]", () => {
  const input = "[@{https://example.com/bib?name=foobar&date=2000}, p. 33]";
  const doc = parsePandocCitationDocument(input);
  assert.equal(doc.occurrences.length, 1);
  assert.equal(doc.occurrences[0].raw, input);
  const item = doc.occurrences[0].cluster.items[0];
  assert.equal(item.id, "https://example.com/bib?name=foobar&date=2000");
  assert.equal(item.locator, "33");
  assert.equal(item.label, "page");
});

test("parseCitationDocument: mandatory test empty braced key produces no valid citation", () => {
  assert.equal(parsePandocCitationDocument("@{}").occurrences.length, 0);
  assert.equal(parsePandocCitationDocument("[@{}]").occurrences.length, 0);
});

test("parseCitationDocument: mandatory test unclosed brace produces no valid citation", () => {
  assert.equal(parsePandocCitationDocument("@{unclosed").occurrences.length, 0);
  assert.equal(parsePandocCitationDocument("[@{unclosed]").occurrences.length, 0);
});

test("parseCitationDocument: narrative citations with internal punctuation distinguish prose punctuation", () => {
  // Comma delimiter
  const commaDoc = parsePandocCitationDocument("D'après @alpha.beta, la structure tient.");
  assert.equal(commaDoc.occurrences.length, 1);
  assert.equal(commaDoc.occurrences[0].raw, "@alpha.beta");
  assert.equal(commaDoc.occurrences[0].cluster.items[0].id, "alpha.beta");
  assert.equal(commaDoc.occurrences[0].cluster.items[0].mode, "composite");

  // Sentence-final period
  const periodDoc = parsePandocCitationDocument("Nous citons @alpha:beta.");
  assert.equal(periodDoc.occurrences.length, 1);
  assert.equal(periodDoc.occurrences[0].raw, "@alpha:beta");
  assert.equal(periodDoc.occurrences[0].cluster.items[0].id, "alpha:beta");

  // Question mark
  const questionDoc = parsePandocCitationDocument("Avez-vous lu @alpha#beta?");
  assert.equal(questionDoc.occurrences.length, 1);
  assert.equal(questionDoc.occurrences[0].raw, "@alpha#beta");
  assert.equal(questionDoc.occurrences[0].cluster.items[0].id, "alpha#beta");

  // Exclamation mark
  const exclamDoc = parsePandocCitationDocument("Regardez @alpha%beta!");
  assert.equal(exclamDoc.occurrences.length, 1);
  assert.equal(exclamDoc.occurrences[0].raw, "@alpha%beta");
  assert.equal(exclamDoc.occurrences[0].cluster.items[0].id, "alpha%beta");

  // Colon followed by narrative cite
  const colonDoc = parsePandocCitationDocument("Voici : @alpha/beta; et ensuite @alpha+beta.");
  assert.equal(colonDoc.occurrences.length, 2);
  assert.equal(colonDoc.occurrences[0].raw, "@alpha/beta");
  assert.equal(colonDoc.occurrences[0].cluster.items[0].id, "alpha/beta");
  assert.equal(colonDoc.occurrences[1].raw, "@alpha+beta");
  assert.equal(colonDoc.occurrences[1].cluster.items[0].id, "alpha+beta");
});

test("parseCitationDocument: single vs consecutive internal punctuation in non-braced citekeys", () => {
  // Consecutive punctuation terminates citekey
  const doubleDashDoc = parsePandocCitationDocument("Reference @Foo_bar--baz in prose.");
  assert.equal(doubleDashDoc.occurrences.length, 1);
  assert.equal(doubleDashDoc.occurrences[0].raw, "@Foo_bar");
  assert.equal(doubleDashDoc.occurrences[0].cluster.items[0].id, "Foo_bar");

  const doubleDotDoc = parsePandocCitationDocument("Reference @foo..bar in prose.");
  assert.equal(doubleDotDoc.occurrences.length, 1);
  assert.equal(doubleDotDoc.occurrences[0].raw, "@foo");
  assert.equal(doubleDotDoc.occurrences[0].cluster.items[0].id, "foo");

  const doubleColonDoc = parsePandocCitationDocument("Reference @foo::bar in prose.");
  assert.equal(doubleColonDoc.occurrences.length, 1);
  assert.equal(doubleColonDoc.occurrences[0].raw, "@foo");
  assert.equal(doubleColonDoc.occurrences[0].cluster.items[0].id, "foo");

  const doublePlusDoc = parsePandocCitationDocument("Reference @foo++bar in prose.");
  assert.equal(doublePlusDoc.occurrences.length, 1);
  assert.equal(doublePlusDoc.occurrences[0].raw, "@foo");
  assert.equal(doublePlusDoc.occurrences[0].cluster.items[0].id, "foo");

  // Single internal punctuation followed by word character is preserved
  const singleDashDoc = parsePandocCitationDocument("Reference @foo-bar in prose.");
  assert.equal(singleDashDoc.occurrences.length, 1);
  assert.equal(singleDashDoc.occurrences[0].raw, "@foo-bar");
  assert.equal(singleDashDoc.occurrences[0].cluster.items[0].id, "foo-bar");

  const singleDotDoc = parsePandocCitationDocument("Reference @foo.bar in prose.");
  assert.equal(singleDotDoc.occurrences.length, 1);
  assert.equal(singleDotDoc.occurrences[0].raw, "@foo.bar");
  assert.equal(singleDotDoc.occurrences[0].cluster.items[0].id, "foo.bar");

  const singleSlashDoc = parsePandocCitationDocument("Reference @foo/bar in prose.");
  assert.equal(singleSlashDoc.occurrences.length, 1);
  assert.equal(singleSlashDoc.occurrences[0].raw, "@foo/bar");
  assert.equal(singleSlashDoc.occurrences[0].cluster.items[0].id, "foo/bar");

  const singleQuestionDoc = parsePandocCitationDocument("Reference @foo?bar in prose.");
  assert.equal(singleQuestionDoc.occurrences.length, 1);
  assert.equal(singleQuestionDoc.occurrences[0].raw, "@foo?bar");
  assert.equal(singleQuestionDoc.occurrences[0].cluster.items[0].id, "foo?bar");
});

test("extractPandocCitekey: unit tests for braced and non-braced extraction", () => {
  const braced = extractPandocCitekey("@{Foo_bar.baz.} trailing", 0);
  assert.deepEqual(braced, {
    key: "Foo_bar.baz.",
    keyEnd: 15,
    isBraced: true,
  });

  const nonBraced = extractPandocCitekey("@Foo_bar.baz. trailing", 0);
  assert.deepEqual(nonBraced, {
    key: "Foo_bar.baz",
    keyEnd: 12,
    isBraced: false,
  });

  // Single vs consecutive punctuation
  assert.equal(extractPandocCitekey("@Foo_bar--baz", 0)?.key, "Foo_bar");
  assert.equal(extractPandocCitekey("@foo..bar", 0)?.key, "foo");
  assert.equal(extractPandocCitekey("@foo::bar", 0)?.key, "foo");
  assert.equal(extractPandocCitekey("@foo++bar", 0)?.key, "foo");
  assert.equal(extractPandocCitekey("@foo-bar", 0)?.key, "foo-bar");
  assert.equal(extractPandocCitekey("@foo.bar", 0)?.key, "foo.bar");
  assert.equal(extractPandocCitekey("@foo/bar", 0)?.key, "foo/bar");
  assert.equal(extractPandocCitekey("@foo?bar", 0)?.key, "foo?bar");

  assert.equal(extractPandocCitekey("@{}", 0), null);
  assert.equal(extractPandocCitekey("@{unclosed", 0), null);
  assert.equal(extractPandocCitekey("@", 0), null);
  assert.equal(extractPandocCitekey("not-at", 0), null);
});

/* -------------------- Markdown Link Contexts (Lot 7A) -------------------- */

test("parseCitationDocument: citations inside markdown link text vs link destinations", () => {
  // 1. [see @doe99](https://example.com) -> 1 citation, id "doe99", mode "composite"
  const seeDoc = parsePandocCitationDocument("[see @doe99](https://example.com)");
  assert.equal(seeDoc.occurrences.length, 1);
  assert.equal(seeDoc.occurrences[0].cluster.items[0].id, "doe99");
  assert.equal(seeDoc.occurrences[0].cluster.items[0].mode, "composite");

  // 2. [@doe99](https://example.com) -> 1 citation, id "doe99"
  const bareDoc = parsePandocCitationDocument("[@doe99](https://example.com)");
  assert.equal(bareDoc.occurrences.length, 1);
  assert.equal(bareDoc.occurrences[0].cluster.items[0].id, "doe99");

  // 3. [label @doe99](https://example.com) -> 1 citation, id "doe99"
  const labelDoc = parsePandocCitationDocument("[label @doe99](https://example.com)");
  assert.equal(labelDoc.occurrences.length, 1);
  assert.equal(labelDoc.occurrences[0].cluster.items[0].id, "doe99");

  // 4. [label](https://example.com/@doe99) -> 0 citations
  const destDoc = parsePandocCitationDocument("[label](https://example.com/@doe99)");
  assert.equal(destDoc.occurrences.length, 0);

  // 5. [label](https://example.com/path?ref=@doe99) -> 0 citations
  const queryDoc = parsePandocCitationDocument("[label](https://example.com/path?ref=@doe99)");
  assert.equal(queryDoc.occurrences.length, 0);

  // 6. Ordinary link without citation remains untouched (0 citations)
  const plainDoc = parsePandocCitationDocument("[ordinary label](https://example.com)");
  assert.equal(plainDoc.occurrences.length, 0);
});

/* -------------------- Inline Footnotes and Nested Brackets (Lot 7B) -------------------- */

test("parseCitationDocument: inline footnote containing citation ^[Voir [@doe2023, p. 57] pour une discussion méthodologique.]", () => {
  const input = "^[Voir [@doe2023, p. 57] pour une discussion méthodologique.]";
  const doc = parsePandocCitationDocument(input);

  // Exactly 1 occurrence
  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];

  // Exact raw substring and offsets
  assert.equal(occ.raw, "[@doe2023, p. 57]");
  assert.equal(occ.from, 7);
  assert.equal(occ.to, 24);
  assert.equal(input.slice(occ.from, occ.to), "[@doe2023, p. 57]");
  assert.equal(occ.clusterId, "citation:7:24");

  // Cluster properties
  assert.equal(occ.cluster.items.length, 1);
  assert.equal(occ.cluster.items[0].id, "doe2023");
  assert.equal(occ.cluster.items[0].locator, "57");
  assert.equal(occ.cluster.items[0].label, "page");

  // noteIndex must remain undefined (no premature Lot 7F note semantics)
  assert.equal(occ.cluster.noteIndex, undefined);
});

test("parseCitationDocument: ordinary outer brackets containing nested citation [Voir [@doe2023, p. 57] pour une discussion.]", () => {
  const input = "[Voir [@doe2023, p. 57] pour une discussion.]";
  const doc = parsePandocCitationDocument(input);

  // Exactly 1 occurrence (the inner citation, never the outer bracket)
  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];

  assert.equal(occ.raw, "[@doe2023, p. 57]");
  assert.equal(occ.from, 6);
  assert.equal(occ.to, 23);
  assert.equal(input.slice(occ.from, occ.to), "[@doe2023, p. 57]");
  assert.equal(occ.cluster.items[0].id, "doe2023");
  assert.equal(occ.cluster.noteIndex, undefined);
});

test("parseCitationDocument: inline footnote with multiple citations ^[Voir [@doe2023, p. 57] et [@smith2024].]", () => {
  const input = "^[Voir [@doe2023, p. 57] et [@smith2024].]";
  const doc = parsePandocCitationDocument(input);

  // Exactly 2 independent occurrences
  assert.equal(doc.occurrences.length, 2);

  const occ1 = doc.occurrences[0];
  assert.equal(occ1.raw, "[@doe2023, p. 57]");
  assert.equal(occ1.from, 7);
  assert.equal(occ1.to, 24);
  assert.equal(input.slice(occ1.from, occ1.to), "[@doe2023, p. 57]");
  assert.equal(occ1.cluster.items[0].id, "doe2023");
  assert.equal(occ1.cluster.noteIndex, undefined);

  const occ2 = doc.occurrences[1];
  assert.equal(occ2.raw, "[@smith2024]");
  assert.equal(occ2.from, 28);
  assert.equal(occ2.to, 40);
  assert.equal(input.slice(occ2.from, occ2.to), "[@smith2024]");
  assert.equal(occ2.cluster.items[0].id, "smith2024");
  assert.equal(occ2.cluster.noteIndex, undefined);
});

test("parseCitationDocument: ordinary outer brackets with multiple citations [Voir [@doe2023, p. 57] et [@smith2024] pour une discussion.]", () => {
  const input = "[Voir [@doe2023, p. 57] et [@smith2024] pour une discussion.]";
  const doc = parsePandocCitationDocument(input);

  assert.equal(doc.occurrences.length, 2);
  assert.equal(doc.occurrences[0].raw, "[@doe2023, p. 57]");
  assert.equal(doc.occurrences[0].cluster.items[0].id, "doe2023");
  assert.equal(doc.occurrences[1].raw, "[@smith2024]");
  assert.equal(doc.occurrences[1].cluster.items[0].id, "smith2024");
});

test("parseCitationDocument: narrative citation inside inline footnote ^[Voir @doe2023 pour une discussion.]", () => {
  const input = "^[Voir @doe2023 pour une discussion.]";
  const doc = parsePandocCitationDocument(input);

  assert.equal(doc.occurrences.length, 1);
  const occ = doc.occurrences[0];
  assert.equal(occ.raw, "@doe2023");
  assert.equal(occ.from, 7);
  assert.equal(occ.to, 15);
  assert.equal(input.slice(occ.from, occ.to), "@doe2023");
  assert.equal(occ.cluster.items[0].id, "doe2023");
  assert.equal(occ.cluster.items[0].mode, "composite");
});

test("parseCitationItem: chunks with unescaped square brackets are rejected", () => {
  assert.equal(parseCitationItem("Voir [@doe2023, p. 57] pour une discussion."), null);
  assert.equal(parseCitationItem("[@doe2023]"), null);
  assert.equal(parseCitationItem("see @doe2023]"), null);
  assert.equal(parseCitationItem("[see @doe2023"), null);
});
