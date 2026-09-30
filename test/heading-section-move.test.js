import test from "node:test";
import assert from "node:assert/strict";
import { headingSectionRange, moveHeadingSection } from "../src/services/heading-section-move.js";

/* Pure unit tests only — no fake Vault, no fake DOM, no fake Obsidian App.
 * Fixtures are built deterministically (never via indexOf/text search) so
 * every offset is exact and independent of the module under test. */

/** Builds a flat Markdown document from an ordered list of headings, each
 * `{ level, title, body? }` (body may itself contain newlines). Returns
 * `{ text, headings }` with `headings` in the exact `HeadingOutlineInput`
 * shape the production module consumes — offsets computed by the builder
 * itself as it writes, never guessed. */
function buildDoc(entries, { finalNewline = true, eol = "\n" } = {}) {
  let text = "";
  const headings = [];
  entries.forEach((entry, i) => {
    const headingLine = `${"#".repeat(entry.level)} ${entry.title}`;
    const startOffset = text.length;
    text += headingLine;
    const endOffset = text.length;
    headings.push({ text: entry.title, level: entry.level, startOffset, endOffset });
    const isLast = i === entries.length - 1;
    if (entry.body !== undefined) text += eol + entry.body;
    if (!isLast || finalNewline) text += eol;
  });
  return { text, headings };
}

function withFrontmatter(doc, frontmatter) {
  return {
    text: frontmatter + doc.text,
    headings: doc.headings.map((h) => ({ ...h, startOffset: h.startOffset + frontmatter.length, endOffset: h.endOffset + frontmatter.length })),
  };
}

function headingByTitle(headings, title) {
  const found = headings.find((h) => h.text === title);
  assert.ok(found, `fixture setup: no heading titled "${title}"`);
  return found;
}

// ===== headingSectionRange =====

test("headingSectionRange: a simple H1 with no following heading runs to EOF", () => {
  const { text, headings } = buildDoc([{ level: 1, title: "A", body: "text A" }]);
  const range = headingSectionRange(headings, headingByTitle(headings, "A").startOffset, text.length);
  assert.deepEqual(range, { startOffset: 0, endOffset: text.length });
});

test("headingSectionRange: an H1 is stopped by the next H1", () => {
  const { text, headings } = buildDoc([
    { level: 1, title: "A", body: "text A" },
    { level: 1, title: "B", body: "text B" },
  ]);
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const range = headingSectionRange(headings, a.startOffset, text.length);
  assert.deepEqual(range, { startOffset: a.startOffset, endOffset: b.startOffset });
});

test("headingSectionRange: an H2 includes its H3/H4 descendants", () => {
  const { text, headings } = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
    { level: 4, title: "A1a-i", body: "a1a-i" },
  ]);
  const a1 = headingByTitle(headings, "A1");
  const range = headingSectionRange(headings, a1.startOffset, text.length);
  assert.deepEqual(range, { startOffset: a1.startOffset, endOffset: text.length });
});

test("headingSectionRange: an H2 is stopped by the next H2", () => {
  const { text, headings } = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 2, title: "A2", body: "a2" },
  ]);
  const a1 = headingByTitle(headings, "A1");
  const a2 = headingByTitle(headings, "A2");
  const range = headingSectionRange(headings, a1.startOffset, text.length);
  assert.deepEqual(range, { startOffset: a1.startOffset, endOffset: a2.startOffset });
});

test("headingSectionRange: an H2 is stopped by the next H1", () => {
  const { text, headings } = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 1, title: "B", body: "b" },
  ]);
  const a1 = headingByTitle(headings, "A1");
  const b = headingByTitle(headings, "B");
  const range = headingSectionRange(headings, a1.startOffset, text.length);
  assert.deepEqual(range, { startOffset: a1.startOffset, endOffset: b.startOffset });
});

test("headingSectionRange: skipped levels never invent phantom boundaries", () => {
  const { text, headings } = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 4, title: "B", body: "b" },
    { level: 3, title: "C", body: "c" },
    { level: 2, title: "D", body: "d" },
    { level: 1, title: "E", body: "e" },
  ]);
  const b = headingByTitle(headings, "B");
  const c = headingByTitle(headings, "C");
  const d = headingByTitle(headings, "D");
  assert.deepEqual(headingSectionRange(headings, b.startOffset, text.length), { startOffset: b.startOffset, endOffset: c.startOffset });
  assert.deepEqual(headingSectionRange(headings, c.startOffset, text.length), { startOffset: c.startOffset, endOffset: d.startOffset });
});

test("headingSectionRange: the last heading in the document runs to EOF", () => {
  const { text, headings } = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 1, title: "B", body: "b" },
  ]);
  const b = headingByTitle(headings, "B");
  const range = headingSectionRange(headings, b.startOffset, text.length);
  assert.deepEqual(range, { startOffset: b.startOffset, endOffset: text.length });
});

test("headingSectionRange: an absent source offset returns null", () => {
  const { text, headings } = buildDoc([{ level: 1, title: "A", body: "a" }]);
  assert.equal(headingSectionRange(headings, 9999, text.length), null);
});

test("headingSectionRange: invalid offsets return null", () => {
  const { text, headings } = buildDoc([{ level: 1, title: "A", body: "a" }]);
  assert.equal(headingSectionRange(headings, -1, text.length), null);
  assert.equal(headingSectionRange(headings, text.length + 1, text.length), null);
  assert.equal(headingSectionRange(headings, 1.5, text.length), null);
  assert.equal(headingSectionRange(headings, 0, -1), null);
});

// ===== headingSectionRange: a single malformed heading invalidates the WHOLE list =====

function twoSectionsForValidation() {
  return buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 1, title: "B", body: "b" },
  ]);
}

/** A new array with `headings[index]` shallow-patched — never mutates the
 * original array or its objects. */
function withPatchedHeading(headings, index, patch) {
  return headings.map((h, i) => (i === index ? { ...h, ...patch } : h));
}

test("headingSectionRange: a heading with a negative startOffset invalidates the whole list", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const corrupted = withPatchedHeading(headings, 1, { startOffset: -1 });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("headingSectionRange: a heading with endOffset beyond the document length invalidates the whole list", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const corrupted = withPatchedHeading(headings, 1, { endOffset: text.length + 50 });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("headingSectionRange: a heading with endOffset <= startOffset invalidates the whole list", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const corrupted = withPatchedHeading(headings, 1, { endOffset: b.startOffset });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("headingSectionRange: a heading with level 0 invalidates the whole list", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const corrupted = withPatchedHeading(headings, 1, { level: 0 });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("headingSectionRange: a heading with level 7 invalidates the whole list", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const corrupted = withPatchedHeading(headings, 1, { level: 7 });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("headingSectionRange: a non-integer level (2.5) invalidates the whole list", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const corrupted = withPatchedHeading(headings, 1, { level: 2.5 });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("headingSectionRange: a non-integer startOffset (1.5) invalidates the whole list", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const corrupted = withPatchedHeading(headings, 1, { startOffset: 1.5 });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("headingSectionRange: a non-integer endOffset (4.5) invalidates the whole list", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const corrupted = withPatchedHeading(headings, 1, { endOffset: 4.5 });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("headingSectionRange: the NEXT heading (the section's own boundary) having startOffset beyond the document also invalidates the whole list", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const corrupted = withPatchedHeading(headings, 1, { startOffset: text.length + 10, endOffset: text.length + 13 });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("headingSectionRange: two headings sharing the same startOffset invalidate the whole list — never resolved arbitrarily", () => {
  const { text, headings } = twoSectionsForValidation();
  const a = headingByTitle(headings, "A");
  const corrupted = withPatchedHeading(headings, 1, { startOffset: a.startOffset });
  assert.equal(headingSectionRange(corrupted, a.startOffset, text.length), null);
});

test("moveHeadingSection: an inconsistent headings list (one malformed entry) makes the whole call return null, not an approximate move", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  const c = headingByTitle(headings, "C");
  const corrupted = withPatchedHeading(headings, 1, { level: 0 });
  assert.equal(moveHeadingSection(text, corrupted, a.startOffset, c.startOffset, "after"), null);
});

// ===== moveHeadingSection: basic moves =====

function threeSections() {
  return buildDoc([
    { level: 1, title: "A", body: "A" },
    { level: 1, title: "B", body: "B" },
    { level: 1, title: "C", body: "C" },
  ]);
}

test("moveHeadingSection: A before B reorders A ahead of B, keeping C last", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, a.startOffset, b.startOffset, "before");
  assert.equal(result.changed, false, "A is already immediately before B: no-op");
});

test("moveHeadingSection: B before A swaps their order", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, b.startOffset, a.startOffset, "before");
  assert.equal(result.changed, true);
  assert.equal(result.text, buildDoc([
    { level: 1, title: "B", body: "B" },
    { level: 1, title: "A", body: "A" },
    { level: 1, title: "C", body: "C" },
  ]).text);
});

test("moveHeadingSection: A after B is a REAL change — A moves past B, becoming B, A, C", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, a.startOffset, b.startOffset, "after");
  assert.equal(result.changed, true, "A after B means A moves past B, becoming B, A, C — a real change");
  assert.equal(result.text, buildDoc([
    { level: 1, title: "B", body: "B" },
    { level: 1, title: "A", body: "A" },
    { level: 1, title: "C", body: "C" },
  ]).text);
});

test("moveHeadingSection: C before A moves C to the front (moving upward) — movedStartOffset points at the very start of the document", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  const c = headingByTitle(headings, "C");
  const result = moveHeadingSection(text, headings, c.startOffset, a.startOffset, "before");
  assert.equal(result.changed, true);
  assert.equal(result.text, buildDoc([
    { level: 1, title: "C", body: "C" },
    { level: 1, title: "A", body: "A" },
    { level: 1, title: "B", body: "B" },
  ]).text);
  assert.equal(result.movedStartOffset, 0, "C is now the very first section in the document");
});

test("moveHeadingSection: A after C moves A to the end (moving downward) — movedStartOffset points exactly past B and C", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  const c = headingByTitle(headings, "C");
  const result = moveHeadingSection(text, headings, a.startOffset, c.startOffset, "after");
  assert.equal(result.changed, true);
  const expectedTextBeforeA = buildDoc([
    { level: 1, title: "B", body: "B" },
    { level: 1, title: "C", body: "C" },
  ]).text;
  assert.equal(result.text, expectedTextBeforeA + buildDoc([{ level: 1, title: "A", body: "A" }]).text);
  assert.equal(result.movedStartOffset, expectedTextBeforeA.length, "A must start exactly where B+C's combined text ends");
});

// ===== moveHeadingSection: subtrees =====

function familyDoc() {
  return buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
    { level: 2, title: "A2", body: "a2" },
    { level: 1, title: "B", body: "b" },
    { level: 2, title: "B1", body: "b1" },
  ]);
}

test("moveHeadingSection: moving A1 after B1 carries A1a along, but never A2", () => {
  const { text, headings } = familyDoc();
  const a1 = headingByTitle(headings, "A1");
  const b1 = headingByTitle(headings, "B1");
  const result = moveHeadingSection(text, headings, a1.startOffset, b1.startOffset, "after");
  assert.equal(result.changed, true);
  assert.equal(result.text, buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A2", body: "a2" },
    { level: 1, title: "B", body: "b" },
    { level: 2, title: "B1", body: "b1" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
  ]).text);
});

test("moveHeadingSection: moving A after B carries the ENTIRE subtree (A1, A1a, A2) — nothing left behind", () => {
  const { text, headings } = familyDoc();
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, a.startOffset, b.startOffset, "after");
  assert.equal(result.changed, true);
  assert.equal(result.text, buildDoc([
    { level: 1, title: "B", body: "b" },
    { level: 2, title: "B1", body: "b1" },
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
    { level: 2, title: "A2", body: "a2" },
  ]).text);
});

test("moveHeadingSection: inserting C after A (A has descendants A1/A1a/A2) lands after the WHOLE subtree, never between A and A1", () => {
  const { text, headings } = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
    { level: 2, title: "A2", body: "a2" },
    { level: 1, title: "B", body: "b" },
    { level: 2, title: "B1", body: "b1" },
    { level: 1, title: "C", body: "c" },
  ]);
  const a = headingByTitle(headings, "A");
  const c = headingByTitle(headings, "C");
  const result = moveHeadingSection(text, headings, c.startOffset, a.startOffset, "after");
  assert.equal(result.changed, true);
  assert.equal(result.text, buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 2, title: "A1", body: "a1" },
    { level: 3, title: "A1a", body: "a1a" },
    { level: 2, title: "A2", body: "a2" },
    { level: 1, title: "C", body: "c" },
    { level: 1, title: "B", body: "b" },
    { level: 2, title: "B1", body: "b1" },
  ]).text);
});

// ===== moveHeadingSection: target inside source is a no-op =====

test("moveHeadingSection: a target inside the source's own subtree (direct child) is a no-op, before AND after", () => {
  const { text, headings } = familyDoc();
  const a = headingByTitle(headings, "A");
  const a1 = headingByTitle(headings, "A1");
  const before = moveHeadingSection(text, headings, a.startOffset, a1.startOffset, "before");
  const after = moveHeadingSection(text, headings, a.startOffset, a1.startOffset, "after");
  assert.equal(before.changed, false);
  assert.equal(before.text, text);
  assert.equal(after.changed, false);
  assert.equal(after.text, text);
});

test("moveHeadingSection: a target inside the source's own subtree (grandchild) is a no-op, before AND after", () => {
  const { text, headings } = familyDoc();
  const a = headingByTitle(headings, "A");
  const a1a = headingByTitle(headings, "A1a");
  const before = moveHeadingSection(text, headings, a.startOffset, a1a.startOffset, "before");
  const after = moveHeadingSection(text, headings, a.startOffset, a1a.startOffset, "after");
  assert.equal(before.changed, false);
  assert.equal(after.changed, false);
});

// ===== moveHeadingSection: source === target =====

test("moveHeadingSection: source === target is a no-op, before AND after", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  const before = moveHeadingSection(text, headings, a.startOffset, a.startOffset, "before");
  const after = moveHeadingSection(text, headings, a.startOffset, a.startOffset, "after");
  assert.equal(before.changed, false);
  assert.equal(before.text, text);
  assert.equal(before.movedStartOffset, a.startOffset);
  assert.equal(after.changed, false);
  assert.equal(after.text, text);
});

// ===== moveHeadingSection: already-adjacent no-ops =====

test("moveHeadingSection: B before C when B is already immediately before C is a no-op", () => {
  const { text, headings } = threeSections();
  const b = headingByTitle(headings, "B");
  const c = headingByTitle(headings, "C");
  const result = moveHeadingSection(text, headings, b.startOffset, c.startOffset, "before");
  assert.equal(result.changed, false);
  assert.equal(result.text, text);
});

test("moveHeadingSection: B after A when B is already immediately after A is a no-op", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, b.startOffset, a.startOffset, "after");
  assert.equal(result.changed, false);
  assert.equal(result.text, text);
});

// ===== moveHeadingSection: duplicate titles =====

test("moveHeadingSection: duplicate heading titles are disambiguated by offset alone, never by text search", () => {
  const { text, headings } = buildDoc([
    { level: 1, title: "Introduction", body: "first" },
    { level: 1, title: "Introduction", body: "second" },
  ]);
  const [first, second] = headings;
  assert.equal(first.text, second.text);
  assert.notEqual(first.startOffset, second.startOffset);

  const result = moveHeadingSection(text, headings, second.startOffset, first.startOffset, "before");
  assert.equal(result.changed, true);
  assert.equal(result.text, buildDoc([
    { level: 1, title: "Introduction", body: "second" },
    { level: 1, title: "Introduction", body: "first" },
  ]).text);
});

// ===== moveHeadingSection: EOF without a trailing newline =====

test("moveHeadingSection: a final section with no trailing newline stays syntactically separated once moved into the middle", () => {
  const { text, headings } = buildDoc(
    [
      { level: 1, title: "A", body: "text A" },
      { level: 1, title: "B", body: "text B" },
    ],
    { finalNewline: false }
  );
  assert.equal(text.endsWith("\n"), false, "fixture setup: B must not end with a newline");

  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, b.startOffset, a.startOffset, "before");

  assert.equal(result.changed, true);
  // B's own slice has no trailing newline (it was at EOF originally), so a
  // separator is inserted before "# A". The newline that used to separate
  // A's body from B's heading is still part of the document and now simply
  // trails the whole thing, since A is last.
  assert.equal(result.text, "# B\ntext B\n# A\ntext A\n");
  assert.doesNotMatch(result.text, /text B#/, "a newline must separate the relocated section from the next heading");
});

// ===== moveHeadingSection: CRLF =====

test("moveHeadingSection: a CRLF document keeps CRLF at the newly introduced boundary, without converting the whole document to LF", () => {
  const { text, headings } = buildDoc(
    [
      { level: 1, title: "A", body: "text A" },
      { level: 1, title: "B", body: "text B" },
    ],
    { finalNewline: false, eol: "\r\n" }
  );

  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, b.startOffset, a.startOffset, "before");

  assert.equal(result.changed, true);
  assert.equal(result.text, "# B\r\ntext B\r\n# A\r\ntext A\r\n");
  assert.doesNotMatch(result.text, /text B#/);
});

// ===== moveHeadingSection: movedStartOffset when a separator is added BEFORE the relocated source =====

test("moveHeadingSection: movedStartOffset accounts for a separator inserted BEFORE the relocated source (LF)", () => {
  // Same fixture as the EOF test above, but moved from the opposite
  // direction: A ends with a natural trailing newline, while B (last, EOF)
  // does not — so moving A to right AFTER B's own section needs a
  // separator inserted BEFORE A, not after it.
  const { text, headings } = buildDoc(
    [
      { level: 1, title: "A", body: "text A" },
      { level: 1, title: "B", body: "text B" },
    ],
    { finalNewline: false }
  );
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, a.startOffset, b.startOffset, "after");

  assert.equal(result.changed, true);
  assert.equal(result.text, "# B\ntext B\n# A\ntext A\n");
  const bSliceLength = "# B\ntext B".length;
  assert.equal(result.movedStartOffset, bSliceLength + 1, "A's new position must land right after B's slice PLUS the one added separator newline");
  assert.equal(result.text.slice(result.movedStartOffset, result.movedStartOffset + 3), "# A", "movedStartOffset must point exactly at A's own heading marker");
});

test("moveHeadingSection: movedStartOffset accounts for a CRLF separator (2 characters, not 1) inserted BEFORE the relocated source", () => {
  const { text, headings } = buildDoc(
    [
      { level: 1, title: "A", body: "text A" },
      { level: 1, title: "B", body: "text B" },
    ],
    { finalNewline: false, eol: "\r\n" }
  );
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, a.startOffset, b.startOffset, "after");

  assert.equal(result.changed, true);
  assert.equal(result.text, "# B\r\ntext B\r\n# A\r\ntext A\r\n");
  const bSliceLength = "# B\r\ntext B".length;
  assert.equal(result.movedStartOffset, bSliceLength + 2, "the added separator is \\r\\n (2 characters), not a single \\n");
  assert.equal(result.text.slice(result.movedStartOffset, result.movedStartOffset + 3), "# A");
});

// ===== moveHeadingSection: opaque body content =====

test("moveHeadingSection: opaque body content (code fence, blockquote, list, a fake heading inside the fence, a link) moves byte-for-byte, uninterpreted", () => {
  const body = [
    "```",
    "# not a real heading",
    "```",
    "> a blockquote",
    "- a list item",
    "[a link](https://example.invalid)",
    "key: value-like-yaml",
  ].join("\n");
  const { text, headings } = buildDoc([
    { level: 1, title: "A", body },
    { level: 1, title: "B", body: "text B" },
  ]);
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");
  const result = moveHeadingSection(text, headings, a.startOffset, b.startOffset, "after");
  assert.equal(result.changed, true);
  assert.equal(result.text, buildDoc([
    { level: 1, title: "B", body: "text B" },
    { level: 1, title: "A", body },
  ]).text);
  assert.ok(result.text.includes(body), "the opaque body must reappear completely untouched");
});

// ===== moveHeadingSection: frontmatter =====

test("moveHeadingSection: YAML frontmatter stays byte-for-byte identical and always in front", () => {
  const frontmatter = "---\ntitle: Test\n---\n\n";
  const base = buildDoc([
    { level: 1, title: "A", body: "a" },
    { level: 1, title: "B", body: "b" },
  ]);
  const { text, headings } = withFrontmatter(base, frontmatter);
  const a = headingByTitle(headings, "A");
  const b = headingByTitle(headings, "B");

  const result = moveHeadingSection(text, headings, b.startOffset, a.startOffset, "before");

  assert.equal(result.changed, true);
  assert.ok(result.text.startsWith(frontmatter), "the frontmatter must remain exactly at the start");
  assert.equal(result.text, withFrontmatter(
    buildDoc([
      { level: 1, title: "B", body: "b" },
      { level: 1, title: "A", body: "a" },
    ]),
    frontmatter
  ).text);
});

// ===== moveHeadingSection: immutability =====

test("moveHeadingSection: the headings array and its objects are never mutated", () => {
  const { text, headings } = threeSections();
  const snapshot = JSON.parse(JSON.stringify(headings));
  const a = headingByTitle(headings, "A");
  const c = headingByTitle(headings, "C");

  moveHeadingSection(text, headings, a.startOffset, c.startOffset, "after");

  assert.deepEqual(headings, snapshot);
});

// ===== moveHeadingSection: invalid requests =====

test("moveHeadingSection: an unknown source offset returns null", () => {
  const { text, headings } = threeSections();
  const b = headingByTitle(headings, "B");
  assert.equal(moveHeadingSection(text, headings, 99999, b.startOffset, "before"), null);
});

test("moveHeadingSection: an unknown target offset returns null", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  assert.equal(moveHeadingSection(text, headings, a.startOffset, 99999, "before"), null);
});

test("moveHeadingSection: a negative or out-of-range target offset returns null", () => {
  const { text, headings } = threeSections();
  const a = headingByTitle(headings, "A");
  assert.equal(moveHeadingSection(text, headings, a.startOffset, -1, "before"), null);
  assert.equal(moveHeadingSection(text, headings, a.startOffset, text.length + 1, "before"), null);
});
