import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import {
  buildScriveningsDocument,
} from "../src/services/scrivenings-document.js";
import {
  buildScriveningsCslDocument,
  getCslOccurrencesForSegment,
  isSegmentCiting,
} from "../src/services/scrivenings-csl-document.js";

function makeDoc(entries) {
  const fileEntries = entries.map(([path, content]) => ({
    file: new TFile(path),
    content,
  }));
  return buildScriveningsDocument(fileEntries);
}

test("A. two segments, one citation each", () => {
  const doc = makeDoc([
    ["fileA.md", "Avant [@smith2024]."],
    ["fileB.md", "Puis [@doe2023]."],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  assert.equal(cslDoc.occurrences.length, 2);
  assert.equal(cslDoc.clusters.length, 2);

  // Segment 0
  const occ0 = cslDoc.occurrences[0];
  assert.equal(occ0.segmentIndex, 0);
  assert.equal(occ0.segmentPath, "fileA.md");
  assert.equal(occ0.localFrom, 6);
  assert.equal(occ0.localTo, 18);
  assert.equal(occ0.from, 6);
  assert.equal(occ0.to, 18);
  assert.equal(occ0.raw, "[@smith2024]");
  assert.equal(occ0.clusterId, "citation:6:18");
  assert.equal(occ0.cluster.id, "citation:6:18");
  assert.equal(occ0.cluster.items.length, 1);
  assert.equal(occ0.cluster.items[0].id, "smith2024");

  // Segment 1 (segment 0 length is 18 + 1 junction = offset 19)
  const occ1 = cslDoc.occurrences[1];
  assert.equal(occ1.segmentIndex, 1);
  assert.equal(occ1.segmentPath, "fileB.md");
  assert.equal(occ1.localFrom, 5);
  assert.equal(occ1.localTo, 15);
  const seg1From = doc.segments[1].from;
  assert.equal(seg1From, 20);
  assert.equal(occ1.from, 20 + 5);
  assert.equal(occ1.to, 20 + 15);
  assert.equal(occ1.raw, "[@doe2023]");
  assert.equal(occ1.clusterId, `citation:${20 + 5}:${20 + 15}`);
  assert.equal(occ1.cluster.id, `citation:${20 + 5}:${20 + 15}`);
  assert.equal(occ1.cluster.items.length, 1);
  assert.equal(occ1.cluster.items[0].id, "doe2023");

  // Global clusters array matches occurrences
  assert.deepEqual(cslDoc.clusters, [occ0.cluster, occ1.cluster]);
});

test("B. hard syntactic boundary: no occurrence spans across segment boundaries", () => {
  const doc = makeDoc([
    ["fileA.md", "Avant ["],
    ["fileB.md", "@smith2024]"],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  const segA = doc.segments[0];
  const segB = doc.segments[1];

  // 1. No occurrence crosses the boundary between segment A and segment B
  for (const occ of cslDoc.occurrences) {
    assert.ok(
      !(occ.from < segA.to && occ.to > segB.from),
      "No occurrence may span across the boundary between segment A and segment B"
    );
    // Every occurrence belongs entirely to a single segment
    const seg = doc.segments[occ.segmentIndex];
    assert.ok(occ.from >= seg.from && occ.to <= seg.to);
    assert.equal(occ.segmentPath, seg.path);
  }

  // 2. No combined bracketed cluster is formed from segment A's '[' and segment B's ']'
  const bracketCluster = cslDoc.occurrences.find(
    (o) => o.raw.startsWith("[") && o.raw.endsWith("]")
  );
  assert.equal(bracketCluster, undefined, "No cross-segment bracketed cluster should be formed");

  // 3. Segment A has no citations
  assert.equal(isSegmentCiting(cslDoc, 0), false);
  assert.equal(getCslOccurrencesForSegment(cslDoc, 0).length, 0);

  // 4. Any occurrence in segment B belongs exclusively to segment B
  const segBOccs = getCslOccurrencesForSegment(cslDoc, 1);
  for (const occ of segBOccs) {
    assert.equal(occ.segmentIndex, 1);
    assert.equal(occ.segmentPath, "fileB.md");
    assert.ok(occ.from >= segB.from && occ.to <= segB.to);
  }
});

test("B bis. hard syntactic boundary: split syntax without valid local citation yields zero occurrences", () => {
  const doc = makeDoc([
    ["fileA.md", "Texte ["],
    ["fileB.md", "suite sans citation]"],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  assert.equal(cslDoc.occurrences.length, 0);
  assert.equal(cslDoc.clusters.length, 0);
});

test("C. unclosed code block in segment A does not mask citations in segment B", () => {
  const doc = makeDoc([
    ["fileA.md", "```text\n[@fake]"],
    ["fileB.md", "[@smith2024]"],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  // Segment B citation is found regardless of segment A's unclosed code block
  const segBList = getCslOccurrencesForSegment(cslDoc, 1);
  assert.equal(segBList.length, 1);
  const occ = segBList[0];
  assert.equal(occ.segmentIndex, 1);
  assert.equal(occ.cluster.items[0].id, "smith2024");
});

test("D. YAML frontmatter is never parsed and does not alter composite offsets", () => {
  const doc = makeDoc([
    ["fileA.md", "---\ntitle: Document A\nauthor: John\n---\nCorpus A [@smith2024]."],
    ["fileB.md", "---\ntitle: Document B\n---\nCorpus B [@doe2023]."],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  assert.equal(cslDoc.occurrences.length, 2);

  // Segment 0 body is "Corpus A [@smith2024]." (from=0)
  const occ0 = cslDoc.occurrences[0];
  assert.equal(occ0.from, 9);
  assert.equal(occ0.to, 21);
  assert.equal(occ0.clusterId, "citation:9:21");
  assert.equal(doc.text.slice(occ0.from, occ0.to), "[@smith2024]");

  // Segment 1 body starts after Segment 0 body length + 1 junction
  const occ1 = cslDoc.occurrences[1];
  assert.equal(doc.text.slice(occ1.from, occ1.to), "[@doe2023]");
});

test("E. grouped citations preserve all items, locators, labels, prefixes, and suffixes", () => {
  const doc = makeDoc([
    ["fileA.md", "Discussion [see @smith2024; @doe2023, p. 42; also -@brown2022, chap. 2]."],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  assert.equal(cslDoc.occurrences.length, 1);
  const cluster = cslDoc.occurrences[0].cluster;
  assert.equal(cluster.items.length, 3);

  // Item 0
  assert.equal(cluster.items[0].id, "smith2024");
  assert.equal(cluster.items[0].prefix, "see ");
  assert.equal(cluster.items[0].mode, undefined);

  // Item 1
  assert.equal(cluster.items[1].id, "doe2023");
  assert.equal(cluster.items[1].locator, "42");
  assert.equal(cluster.items[1].label, "page");

  // Item 2
  assert.equal(cluster.items[2].id, "brown2022");
  assert.equal(cluster.items[2].prefix, "also ");
  assert.equal(cluster.items[2].locator, "2");
  assert.equal(cluster.items[2].label, "chapter");
  assert.equal(cluster.items[2].mode, "suppress-author");
});

test("F. narrative citations preserve composite mode and global offsets", () => {
  const doc = makeDoc([
    ["fileA.md", "Selon @smith2024 la question demeure."],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  assert.equal(cslDoc.occurrences.length, 1);
  const occ = cslDoc.occurrences[0];
  assert.equal(occ.raw, "@smith2024");
  assert.equal(occ.cluster.items[0].id, "smith2024");
  assert.equal(occ.cluster.items[0].mode, "composite");
});

test("G. identical occurrences in two segments receive distinct global clusterIds", () => {
  const doc = makeDoc([
    ["fileA.md", "[@smith2024]"],
    ["fileB.md", "[@smith2024]"],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  assert.equal(cslDoc.occurrences.length, 2);
  const occA = cslDoc.occurrences[0];
  const occB = cslDoc.occurrences[1];

  assert.equal(occA.raw, "[@smith2024]");
  assert.equal(occB.raw, "[@smith2024]");
  assert.notEqual(occA.clusterId, occB.clusterId);
  assert.equal(occA.clusterId, "citation:0:12");
  // fileA body length = 12 + 1 junction = 13
  assert.equal(occB.clusterId, "citation:13:25");
});

test("H. empty segment between two citing segments preserves correct ordering and offsets", () => {
  const doc = makeDoc([
    ["fileA.md", "Premier [@smith2024]"],
    ["empty.md", ""],
    ["fileB.md", "Dernier [@doe2023]"],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  assert.equal(cslDoc.occurrences.length, 2);
  assert.equal(cslDoc.segmentOccurrences[0].length, 1);
  assert.equal(cslDoc.segmentOccurrences[1].length, 0);
  assert.equal(cslDoc.segmentOccurrences[2].length, 1);

  assert.equal(isSegmentCiting(cslDoc, 0), true);
  assert.equal(isSegmentCiting(cslDoc, 1), false);
  assert.equal(isSegmentCiting(cslDoc, 2), true);

  const occA = cslDoc.occurrences[0];
  const occB = cslDoc.occurrences[1];
  assert.equal(occA.segmentIndex, 0);
  assert.equal(occB.segmentIndex, 2);
  assert.equal(doc.text.slice(occA.from, occA.to), "[@smith2024]");
  assert.equal(doc.text.slice(occB.from, occB.to), "[@doe2023]");
});

test("I. length modification of first segment correctly shifts subsequent segment offsets", () => {
  const v1 = makeDoc([
    ["fileA.md", "Court [@smith2024]"],
    ["fileB.md", "Texte [@doe2023]"],
  ]);
  const v2 = makeDoc([
    ["fileA.md", "Un texte nettement plus long avec du contenu supplémentaire [@smith2024]"],
    ["fileB.md", "Texte [@doe2023]"],
  ]);

  const csl1 = buildScriveningsCslDocument(v1);
  const csl2 = buildScriveningsCslDocument(v2);

  const b1 = csl1.occurrences[1];
  const b2 = csl2.occurrences[1];

  assert.equal(b1.segmentPath, "fileB.md");
  assert.equal(b2.segmentPath, "fileB.md");
  assert.equal(b1.localFrom, b2.localFrom);
  assert.equal(b1.localTo, b2.localTo);
  assert.ok(b2.from > b1.from);
  assert.ok(b2.to > b1.to);
  assert.equal(b2.clusterId, `citation:${b2.from}:${b2.to}`);
});

test("J. viewport independence: parsing includes all segments without any viewport filtering", () => {
  const doc = makeDoc([
    ["seg0.md", "Header [@c0]"],
    ["seg1.md", "Body [@c1]"],
    ["seg2.md", "Middle [@c2]"],
    ["seg3.md", "Footer [@c3]"],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  assert.equal(cslDoc.occurrences.length, 4);
  assert.deepEqual(
    cslDoc.occurrences.map((o) => o.cluster.items[0].id),
    ["c0", "c1", "c2", "c3"]
  );
});

test("K. strict boundary and monotonic order invariants", () => {
  const doc = makeDoc([
    ["A.md", "Un [@a1] et deux [@a2]"],
    ["B.md", "Trois [@b1]"],
  ]);
  const cslDoc = buildScriveningsCslDocument(doc);

  assert.equal(cslDoc.occurrences.length, 3);
  for (let i = 0; i < cslDoc.occurrences.length - 1; i++) {
    assert.ok(cslDoc.occurrences[i].from <= cslDoc.occurrences[i + 1].from);
    assert.ok(cslDoc.occurrences[i].from < cslDoc.occurrences[i].to);
  }

  for (const occ of cslDoc.occurrences) {
    const seg = doc.segments[occ.segmentIndex];
    assert.ok(occ.from >= seg.from);
    assert.ok(occ.to <= seg.to);
    // Structural joint check: segment junction is never within any occurrence
    for (let j = 0; j < doc.segments.length - 1; j++) {
      const jointOffset = doc.segments[j].to;
      assert.ok(occ.from > jointOffset || occ.to <= jointOffset);
    }
  }
});
