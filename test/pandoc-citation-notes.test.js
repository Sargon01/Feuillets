import test from "node:test";
import assert from "node:assert/strict";
import { buildNoteAwarePandocCitationDocument } from "../src/services/pandoc-citation-notes.js";
import { parsePandocCitationDocument } from "../src/services/pandoc-citation-parser.js";

const cases = [
  ["body citation", "Text [@a].", [["a", undefined]], 0],
  ["referenced note", "Text[^source].\n\n[^source]: [@a]", [["a", 1]], 1],
  ["two notes", "Text[^a][^b].\n\n[^a]: [@a]\n[^b]: [@b]", [["a", 1], ["b", 2]], 2],
  ["reversed definitions", "Text[^b][^a].\n\n[^a]: [@a]\n[^b]: [@b]", [["b", 1], ["a", 2]], 2],
  ["multiple citations", "Text[^a].\n\n[^a]: [@a] and [@b]", [["a", 1], ["b", 1]], 1],
  ["inline nested groups", "Text.^[See [@a; @b] and [@c].]", [["a", 1], ["c", 1]], 1],
  ["empty inline citation state", "^[Comment] ^[See [@a]]", [["a", 2]], 2],
  ["non-citing reference", "Text[^a] ^[See [@b]]\n\n[^a]: Comment", [["b", 2]], 2],
  ["unused definition", "Text [@a]\n\n[^unused]: [@b]", [["a", undefined]], 0],
  ["repeated reference", "Text[^a][^a][^b]\n\n[^a]: [@a]\n[^b]: [@b]", [["a", 1], ["b", 2]], 2],
  ["protected notes", "`^[Comment] [^x]`\n```md\n^[Hidden] [^x]\n```\n<pre>^[Hidden]</pre><!-- [^x] -->\n^[See [@a]]\n\n[^x]: [@b]", [["a", 1]], 1],
  ["code inside note", "Text[^a]\n\n[^a]: `[@hidden]` [@a]", [["a", 1]], 1],
  ["multiline definition", "Text[^a]\n\n[^a]: See [@a]\n    and [@b]\n\n    [@c]", [["a", 1], ["b", 1], ["c", 1]], 1],
  ["fenced code in a multiline note", "Text[^a]\n\n[^a]: See [@a]\n    ```md\n    [@hidden]\n    ```\n    [@b]", [["a", 1], ["b", 1]], 1],
  ["malformed inline fails closed", "Text.^[See [@a]", [], 0],
  ["escaped inline marker", "\\^[Comment] ^[See [@a]]", [["a", 1]], 1],
  ["logical interleaving", "[@a] text[^b] [@c] text[^a]\n\n[^a]: [@a]\n[^b]: [@b]", [["a", undefined], ["b", 1], ["c", undefined], ["a", 2]], 2],
];
for (const [name, source, expected, count] of cases) {
  test(`Note-aware document: ${name}`, () => {
    const result = buildNoteAwarePandocCitationDocument(source);
    assert.equal(result.noteCount, count);
    assert.deepEqual(result.document.clusters.map((cluster) => [cluster.items[0].id, cluster.noteIndex]), expected);
    assert.ok(result.document.occurrences.every((occurrence, index, occurrences) => index === 0 || occurrences[index - 1].from < occurrence.from));
    const syntax = parsePandocCitationDocument(source);
    for (const occurrence of result.document.occurrences) {
      const original = syntax.occurrences.find((entry) => entry.clusterId === occurrence.clusterId);
      assert.ok(original);
      for (const field of ["from", "to", "raw", "clusterId"]) assert.equal(occurrence[field], original[field]);
      assert.equal(original.cluster.noteIndex, undefined);
    }
  });
}
