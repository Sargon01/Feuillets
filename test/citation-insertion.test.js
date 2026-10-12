import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { prepareCitationInsertion, citationPlanContent, applyCitationInsertion } from "../src/services/citation-insertion.js";
import { insertCitation } from "../src/utils/cm-citekey-trigger.js";
import { buildNoteAwarePandocCitationDocument } from "../src/services/pandoc-citation-notes.js";
import { buildScriveningsDocument } from "../src/services/scrivenings-document.js";
import { buildScriveningsCslDocument } from "../src/services/scrivenings-csl-document.js";
import { ScriveningsSegmentEditorAdapter } from "../src/utils/scrivenings-editor-adapter.js";

function viewFor(text, selection = { from: 0, to: 0, empty: true }) {
  return {
    state: { doc: { get length() { return text.length; }, sliceString: (from, to) => text.slice(from, to) }, selection: { main: selection } },
    transactions: [],
    dispatch(spec) {
      this.transactions.push(spec);
      const changes = Array.isArray(spec.changes) ? spec.changes : [spec.changes];
      for (const change of [...changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
      if (spec.selection) this.state.selection.main = { from: spec.selection.anchor, to: spec.selection.anchor, empty: true };
    },
    focus() {},
    text: () => text,
  };
}

for (const [name, content, from, to, citation, mode, expected] of [
  ["parenthetical", "Text .", 5, 5, "[@smith2024]", "parenthetical", "Text [@smith2024]."],
  ["footnote in paragraph", "Text .", 5, 5, "[@smith2024]", "footnote", "Text [^1].\n\n[^1]: [@smith2024]"],
  ["EOF", "Text", 4, 4, "[@smith2024]", "footnote", "Text[^1]\n\n[^1]: [@smith2024]"],
  ["numeric and named notes", "Text[^3][^named].\n\n[^3]: Old\n[^named]: Named", 4, 4, "[@smith2024]", "footnote", "Text[^4][^3][^named].\n\n[^3]: Old\n[^named]: Named\n\n[^4]: [@smith2024]"],
  ["existing note", "Text[^1].\n\n[^1]: Analysis .", 25, 25, "[@smith2024]", "footnote", "Text[^1].\n\n[^1]: Analysis[@smith2024] ."],
  ["multiline note", "Text[^1].\n\n[^1]: Analysis\n    Continued .", 39, 39, "[@smith2024]", "footnote", "Text[^1].\n\n[^1]: Analysis\n    Continued[@smith2024] ."],
]) {
  test(`citation plan: ${name}`, () => {
    const plan = prepareCitationInsertion(content, from, to, citation, mode);
    assert.ok(plan);
    assert.equal(citationPlanContent(content, plan), expected);
  });
}

test("picker group and sanitized locators create one parseable Pandoc note", () => {
  const view = viewFor("Text [@].");
  assert.equal(insertCitation(view, { from: 5, to: 7 }, [
    { key: "smith2024", pages: "42];\n" }, { key: "doe2023", pages: "15-18" },
  ], "open_group", { mode: "footnote", from: 0, to: 9, frontmatter: "" }), true);
  assert.equal(view.text(), "Text [^1].\n\n[^1]: [@smith2024, p. 42; @doe2023, pp. 15–18]");
  assert.equal(view.transactions.length, 1);
  const parsed = buildNoteAwarePandocCitationDocument(view.text());
  assert.equal(parsed.noteCount, 1);
  assert.equal(parsed.document.clusters[0].items.length, 2);
  assert.equal(parsed.document.clusters[0].noteIndex, 1);
});

for (const inNote of [false, true]) test(`picker continuation stays in one group (note=${inNote})`, () => {
  const content = inNote ? "Text[^1].\n\n[^1]: [@smith2024; @]" : "Text [@smith2024; @]";
  const view = viewFor(content);
  const from = content.lastIndexOf("@");
  assert.equal(insertCitation(view, { from, to: from + 1 }, [{ key: "doe2023" }], "continue_group",
    { mode: "footnote", from: 0, to: content.length, frontmatter: "" }), true);
  assert.equal(view.text(), content.slice(0, from) + "@doe2023]" );
  assert.equal(view.transactions.length, 1);
});

test("native Editor transaction contains marker, definition and cursor in one call", () => {
  let text = "Text .";
  let transactions = 0;
  const editor = { getValue: () => text, focus() {}, transaction(tx, origin) {
    transactions++;
    assert.equal(origin, "feuillets-citation");
    assert.equal(tx.changes.length, 2);
    const offset = (pos) => pos.line === 0 ? pos.ch : -1;
    for (const change of [...tx.changes].reverse()) text = text.slice(0, offset(change.from)) + change.text + text.slice(offset(change.to));
    assert.deepEqual(tx.selection, { from: { line: 0, ch: 9 } });
  } };
  const plan = prepareCitationInsertion(text, 5, 5, "[@smith2024]", "footnote");
  assert.equal(applyCitationInsertion(editor, text, plan), true);
  assert.equal(text, "Text [^1].\n\n[^1]: [@smith2024]");
  assert.equal(transactions, 1);
});

test("stale content and missing transaction support refuse without writing", () => {
  const plan = prepareCitationInsertion("Text", 2, 2, "[@smith2024]", "footnote");
  const editor = { getValue: () => "Changed", transaction() { assert.fail("stale transaction"); } };
  assert.equal(applyCitationInsertion(editor, "Text", plan), false);
  assert.equal(applyCitationInsertion({ getValue: () => "Text" }, "Text", plan), false);
});

for (const index of [0, 1, 2]) test(`Continu segment ${index}: file-local note number and EOF, frontmatter preserved`, () => {
  const files = [0, 1, 2].map((n) => new TFile(`${n}.md`));
  const contents = files.map((_, n) => `---\ntitle: ${n}\n---\nText[^${n + 2}].\n\n[^${n + 2}]: Old\nLast paragraph.`);
  const document = buildScriveningsDocument(files.map((file, n) => ({ file, content: contents[n] })));
  const segment = document.segments[index];
  const view = viewFor(document.text, { from: segment.to - 1, to: segment.to - 1, empty: true });
  const adapter = new ScriveningsSegmentEditorAdapter(view, segment.path, () => segment);
  const at = contents[index].length - 1;
  const plan = prepareCitationInsertion(contents[index], at, at, "[@smith2024]", "footnote");
  assert.equal(applyCitationInsertion(adapter, contents[index], plan), true);
  const expected = citationPlanContent(contents[index], plan);
  assert.equal(view.text(), document.text.slice(0, segment.from) + expected.slice(segment.frontmatter.length) + document.text.slice(segment.to));
  assert.equal(plan.noteNumber, index + 3);
  assert.equal(view.transactions.length, 1);
  const parsed = buildScriveningsCslDocument(buildScriveningsDocument(files.map((file, n) => ({ file, content: n === index ? expected : contents[n] }))));
  assert.equal(parsed.occurrences[0].segmentPath, segment.path);
  assert.equal(parsed.occurrences[0].cluster.items[0].id, "smith2024");
});

test("Continu rejects entire batches crossing boundaries, YAML or a selection in another sheet", () => {
  const doc = buildScriveningsDocument([{ file: new TFile("A.md"), content: "---\ntitle: A\n---\nBody" }, { file: new TFile("B.md"), content: "Other" }]);
  const segment = doc.segments[0];
  const view = viewFor(doc.text);
  const adapter = new ScriveningsSegmentEditorAdapter(view, segment.path, () => segment);
  const content = adapter.getValue();
  const plan = prepareCitationInsertion(content, content.length - 1, content.length - 1, "[@smith2024]", "footnote");
  for (const change of [{ from: 0, to: 1, insert: "x" }, { from: content.length, to: content.length + 2, insert: "x" }]) {
    assert.equal(adapter.applyCitationPlan({ ...plan, changes: [...plan.changes, change] }, content), false);
  }
  view.state.selection.main = { from: segment.to - 1, to: doc.segments[1].from + 1, empty: false };
  assert.equal(adapter.applyCitationPlan(plan, content), false);
  assert.equal(view.transactions.length, 0);
  assert.equal(view.text(), doc.text);
});

test("frontmatter and ambiguous definition marker positions refuse", () => {
  assert.equal(prepareCitationInsertion("---\ntitle: A\n---\nBody", 5, 5, "[@smith2024]", "footnote"), null);
  assert.equal(prepareCitationInsertion("[^1]: Text", 3, 3, "[@smith2024]", "footnote"), null);
  assert.equal(prepareCitationInsertion("[^1]: Text\n[^1]: Other", 8, 8, "[@smith2024]", "footnote"), null);
});

for (const index of [0, 1, 2]) test(`Continu picker maps a grouped citation into segment ${index}`, () => {
  const files = [0, 1, 2].map((n) => new TFile(`${n}.md`));
  const contents = files.map((_, n) => `---\ntitle: ${n}\n---\nText[^${n + 2}].\n\n[^${n + 2}]: Old\nLast [@].`);
  const doc = buildScriveningsDocument(files.map((file, n) => ({ file, content: contents[n] })));
  const segment = doc.segments[index];
  const localFrom = segment.body.lastIndexOf("[@");
  const view = viewFor(doc.text);
  assert.equal(insertCitation(view, { from: segment.from + localFrom, to: segment.from + localFrom + 2 },
    [{ key: "smith2024" }, { key: "doe2023", pages: "15-18" }], "open_group",
    { mode: "footnote", from: segment.from, to: segment.to, frontmatter: segment.frontmatter }), true);
  const body = segment.body.replace("Last [@].", `Last [^${index + 3}].`)
    + `\n\n[^${index + 3}]: [@smith2024; @doe2023, pp. 15–18]`;
  assert.equal(view.text(), doc.text.slice(0, segment.from) + body + doc.text.slice(segment.to));
  assert.equal(view.transactions.length, 1);
});
