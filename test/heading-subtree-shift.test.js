import test from "node:test";
import assert from "node:assert/strict";
import { shiftHeadingSubtree } from "../src/services/heading-subtree-shift.js";

function buildDoc(entries, { eol = "\n", finalNewline = true } = {}) {
  let text = "";
  const headings = [];
  entries.forEach((entry, index) => {
    const prefix = entry.prefix ?? "";
    const startOffset = text.length;
    const line = `${prefix}${"#".repeat(entry.level)}${entry.spacing ?? " "}${entry.title}`;
    text += line;
    headings.push({ text: entry.title, level: entry.level, startOffset, endOffset: text.length });
    if (entry.body !== undefined) text += eol + entry.body;
    if (index < entries.length - 1 || finalNewline) text += eol;
  });
  return { text, headings };
}

function source(headings, index) {
  return headings[index].startOffset;
}

test("promote shifts a subtree and leaves its parent and sibling unchanged", () => {
  const { text, headings } = buildDoc([
    { level: 1, title: "Parent" },
    { level: 2, title: "Section", body: "text" },
    { level: 3, title: "Child" },
    { level: 4, title: "Grandchild" },
    { level: 2, title: "Sibling" },
  ]);
  const result = shiftHeadingSubtree(text, headings, source(headings, 1), "promote");
  assert.deepEqual(result, { text: "# Parent\n# Section\ntext\n## Child\n### Grandchild\n## Sibling\n", changed: true });
});

test("demote preserves skipped levels and refuses an H6 subtree atomically", () => {
  const valid = buildDoc([{ level: 2, title: "A" }, { level: 4, title: "B" }, { level: 5, title: "C" }]);
  assert.deepEqual(shiftHeadingSubtree(valid.text, valid.headings, source(valid.headings, 0), "demote"), {
    text: "### A\n##### B\n###### C\n", changed: true,
  });
  const limited = buildDoc([{ level: 2, title: "A" }, { level: 6, title: "Deep" }, { level: 2, title: "Sibling" }]);
  assert.deepEqual(shiftHeadingSubtree(limited.text, limited.headings, source(limited.headings, 0), "demote"), {
    text: limited.text, changed: false,
  });
});

test("H1 promotion is a no-op and duplicate titles use their offsets", () => {
  const root = buildDoc([{ level: 1, title: "A" }, { level: 2, title: "A1" }]);
  assert.deepEqual(shiftHeadingSubtree(root.text, root.headings, source(root.headings, 0), "promote"), { text: root.text, changed: false });
  const duplicate = buildDoc([{ level: 2, title: "Section" }, { level: 2, title: "Section" }]);
  assert.deepEqual(shiftHeadingSubtree(duplicate.text, duplicate.headings, source(duplicate.headings, 1), "promote"), {
    text: "## Section\n# Section\n", changed: true,
  });
});

test("only opening markers change and all other bytes are preserved", () => {
  const frontmatter = "---\r\ntitle: Example\r\nheading: '# fake'\r\n---\r\n";
  const doc = buildDoc([
    { level: 2, prefix: "  ", spacing: "   ", title: "Title ##", body: "```text\r\n### fake\r\n```\r\n> ## quote\r\n- ### list" },
  ], { eol: "\r\n", finalNewline: false });
  const headings = doc.headings.map((heading) => ({ ...heading, startOffset: heading.startOffset + frontmatter.length, endOffset: heading.endOffset + frontmatter.length }));
  const text = frontmatter + doc.text;
  assert.deepEqual(shiftHeadingSubtree(text, headings, source(headings, 0), "promote"), {
    text: frontmatter + "  #   Title ##\r\n```text\r\n### fake\r\n```\r\n> ## quote\r\n- ### list", changed: true,
  });
});

test("invalid or stale cache data returns null without mutating inputs", () => {
  const { text, headings } = buildDoc([{ level: 2, title: "A" }, { level: 3, title: "Child" }]);
  const original = structuredClone(headings);
  assert.equal(shiftHeadingSubtree(text, headings, 999, "promote"), null);
  assert.equal(shiftHeadingSubtree(text, [{ ...headings[0], level: 3 }, headings[1]], source(headings, 0), "promote"), null);
  const deep = buildDoc([{ level: 2, title: "A" }, { level: 4, title: "Child" }]);
  assert.equal(shiftHeadingSubtree(deep.text, [deep.headings[0], { ...deep.headings[1], level: 3 }], source(deep.headings, 0), "promote"), null);
  assert.equal(shiftHeadingSubtree(text, [headings[0], { ...headings[1], startOffset: headings[0].startOffset }], source(headings, 0), "promote"), null);
  assert.deepEqual(headings, original);
});

test("promote handles a single H2 and a single H3", () => {
  const h2 = buildDoc([{ level: 2, title: "Two" }]);
  assert.deepEqual(shiftHeadingSubtree(h2.text, h2.headings, source(h2.headings, 0), "promote"), {
    text: "# Two\n", changed: true,
  });
  const h3 = buildDoc([{ level: 3, title: "Three" }]);
  assert.deepEqual(shiftHeadingSubtree(h3.text, h3.headings, source(h3.headings, 0), "promote"), {
    text: "## Three\n", changed: true,
  });
});

test("promote preserves a previous parent and same-level sibling", () => {
  const doc = buildDoc([
    { level: 1, title: "Parent" },
    { level: 2, title: "Source" },
    { level: 3, title: "Child" },
    { level: 2, title: "Sibling" },
  ]);
  const result = shiftHeadingSubtree(doc.text, doc.headings, source(doc.headings, 1), "promote");
  assert.equal(result?.text, "# Parent\n# Source\n## Child\n## Sibling\n");
  assert.equal(result?.text.startsWith("# Parent\n"), true);
  assert.equal(result?.text.endsWith("## Sibling\n"), true);
});

test("promote handles a deep subtree while retaining skipped levels", () => {
  const doc = buildDoc([
    { level: 2, title: "A" },
    { level: 4, title: "A1" },
    { level: 5, title: "A1a" },
    { level: 3, title: "A2" },
    { level: 2, title: "B" },
  ]);
  assert.deepEqual(shiftHeadingSubtree(doc.text, doc.headings, source(doc.headings, 0), "promote"), {
    text: "# A\n### A1\n#### A1a\n## A2\n## B\n", changed: true,
  });
});

test("demote handles H1, H2, descendants, and a deep subtree", () => {
  const h1 = buildDoc([{ level: 1, title: "One" }]);
  assert.deepEqual(shiftHeadingSubtree(h1.text, h1.headings, source(h1.headings, 0), "demote"), {
    text: "## One\n", changed: true,
  });
  const h2 = buildDoc([{ level: 2, title: "Two" }]);
  assert.deepEqual(shiftHeadingSubtree(h2.text, h2.headings, source(h2.headings, 0), "demote"), {
    text: "### Two\n", changed: true,
  });
  const deep = buildDoc([
    { level: 2, title: "A" },
    { level: 3, title: "A1" },
    { level: 4, title: "A1a" },
    { level: 5, title: "A1b" },
    { level: 3, title: "A2" },
    { level: 2, title: "B" },
  ]);
  assert.deepEqual(shiftHeadingSubtree(deep.text, deep.headings, source(deep.headings, 0), "demote"), {
    text: "### A\n#### A1\n##### A1a\n###### A1b\n#### A2\n## B\n", changed: true,
  });
});

test("demote keeps a same-level sibling intact and refuses an H6 source", () => {
  const doc = buildDoc([{ level: 2, title: "A" }, { level: 2, title: "B" }]);
  assert.deepEqual(shiftHeadingSubtree(doc.text, doc.headings, source(doc.headings, 0), "demote"), {
    text: "### A\n## B\n", changed: true,
  });
  const h6 = buildDoc([{ level: 6, title: "Already Deep" }]);
  assert.deepEqual(shiftHeadingSubtree(h6.text, h6.headings, source(h6.headings, 0), "demote"), {
    text: h6.text, changed: false,
  });
});

test("validation rejects every malformed heading cache shape", () => {
  const doc = buildDoc([{ level: 2, title: "A" }, { level: 3, title: "Child" }]);
  const cases = [
    ["negative start", { startOffset: -1 }],
    ["start beyond text", { startOffset: doc.text.length + 1 }],
    ["end before start", { endOffset: doc.headings[0].startOffset }],
    ["end beyond text", { endOffset: doc.text.length + 1 }],
    ["level zero", { level: 0 }],
    ["level seven", { level: 7 }],
    ["non-integer level", { level: 2.5 }],
  ];
  for (const [label, patch] of cases) {
    const headings = doc.headings.map((heading, index) => index === 0 ? { ...heading, ...patch } : { ...heading });
    assert.equal(shiftHeadingSubtree(doc.text, headings, doc.headings[0].startOffset, "promote"), null, label);
  }
  const duplicate = [doc.headings[0], { ...doc.headings[1], startOffset: doc.headings[0].startOffset }];
  assert.equal(shiftHeadingSubtree(doc.text, duplicate, doc.headings[0].startOffset, "promote"), null, "duplicate startOffset");
});

test("preservation keeps blank lines, LF, EOF, and inline hashes byte-for-byte", () => {
  const doc = buildDoc([
    { level: 2, prefix: "\t", spacing: "    ", title: "Title ##", body: "\n\ninline # hashes" },
  ], { finalNewline: false });
  const result = shiftHeadingSubtree(doc.text, doc.headings, source(doc.headings, 0), "promote");
  assert.deepEqual(result, { text: "\t#    Title ##\n\n\ninline # hashes", changed: true });
  assert.equal(result?.text.endsWith("hashes"), true);
});

test("promote, demote, no-ops, and null results never mutate heading inputs", () => {
  const promoteDoc = buildDoc([{ level: 2, title: "A" }, { level: 3, title: "Child" }]);
  const promoteSnapshot = structuredClone(promoteDoc.headings);
  shiftHeadingSubtree(promoteDoc.text, promoteDoc.headings, source(promoteDoc.headings, 0), "promote");
  assert.deepEqual(promoteDoc.headings, promoteSnapshot);

  const demoteDoc = buildDoc([{ level: 2, title: "A" }, { level: 3, title: "Child" }]);
  const demoteSnapshot = structuredClone(demoteDoc.headings);
  shiftHeadingSubtree(demoteDoc.text, demoteDoc.headings, source(demoteDoc.headings, 0), "demote");
  assert.deepEqual(demoteDoc.headings, demoteSnapshot);

  const h1 = buildDoc([{ level: 1, title: "A" }]);
  const h1Snapshot = structuredClone(h1.headings);
  shiftHeadingSubtree(h1.text, h1.headings, source(h1.headings, 0), "promote");
  assert.deepEqual(h1.headings, h1Snapshot);

  const h6 = buildDoc([{ level: 6, title: "A" }]);
  const h6Snapshot = structuredClone(h6.headings);
  shiftHeadingSubtree(h6.text, h6.headings, source(h6.headings, 0), "demote");
  assert.deepEqual(h6.headings, h6Snapshot);

  const invalidSnapshot = structuredClone(promoteDoc.headings);
  shiftHeadingSubtree(promoteDoc.text, promoteDoc.headings, -1, "promote");
  assert.deepEqual(promoteDoc.headings, invalidSnapshot);
});
