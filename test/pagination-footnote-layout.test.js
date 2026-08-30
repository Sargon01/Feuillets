import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Lot 6 structural and integration tests for footnote pagination.
 * Verifies layout invariants, two-up, and architecture constraints.
 */

test("pagination-footnote-layout: existing geometries A4/A5/Letter exist", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify key functions exist
  assert.match(sourceFile, /logicalPageGeometryFor/);
  assert.match(sourceFile, /physicalPageGeometryFor/);
  assert.match(sourceFile, /pageContentGeometry/);
});

test("pagination-footnote-layout: footnotes zone full width", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify columnSpan and columnCount in setCssStyles
  assert.match(sourceFile, /columnSpan\s*:\s*["']all["']/);
  assert.match(sourceFile, /columnCount\s*:\s*["']1["']/);

  // Verify left/right/bottom positioning in setCssStyles for absolute
  assert.match(sourceFile, /left\s*:\s*["']0["']/);
  assert.match(sourceFile, /right\s*:\s*["']0["']/);
  assert.match(sourceFile, /bottom\s*:\s*["']0["']/);
});

test("pagination-footnote-layout: two-up helper exists", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify imposePagesHtml exists
  assert.match(sourceFile, /imposePagesHtml/);
  assert.match(sourceFile, /two-up-successive/);
  assert.match(sourceFile, /two-up-duplicate/);
});

test("pagination-footnote-layout: single paginator architecture", async () => {
  const engineFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/pagination-engine.ts"),
    "utf8"
  );
  const pdfFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify paginateDom and paginateDomCooperatively both exist
  assert.match(engineFile, /export.*function.*paginateDom/);
  assert.match(engineFile, /export.*function.*paginateDomCooperatively/);

  // Verify both use paginateDomSteps or similar shared logic
  assert.match(engineFile, /paginateDomSteps/);

  // Verify no footnote-specific paginator
  assert.doesNotMatch(engineFile, /paginateFootnotes(?!Node)/);
  assert.doesNotMatch(pdfFile, /paginateDomWithFootnotes/);
});

test("pagination-footnote-layout: shared provider architecture", async () => {
  const pdfFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify createFootnoteReservedBottomAreaProvider exists and is used
  assert.match(pdfFile, /createFootnoteReservedBottomAreaProvider/);

  // Verify provider used in both sync and cooperative paths
  const providerMatch = pdfFile.match(/createFootnoteReservedBottomAreaProvider\([^)]+\)/g);
  assert(providerMatch && providerMatch.length >= 2, "provider should be used at least twice");

  // Verify prepareManuscriptPagination provides geometry
  assert.match(pdfFile, /prepareManuscriptPagination[\s\S]*?reservedBottomAreaProvider/);
});

test("pagination-footnote-layout: front page isolation", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify feuillets-frontpage class usage
  assert.match(sourceFile, /feuillets-frontpage/);

  // Verify page-break handling for front
  assert.match(sourceFile, /page-break/);
});

test("pagination-footnote-layout: heading page breaks unchanged", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify isForcedPage or similar exists
  assert.match(sourceFile, /headingPageBreak/);

  // Verify no new heading policy added
  assert.doesNotMatch(sourceFile, /footnoteHeadingPageBreak/);
});

test("pagination-footnote-layout: image preservation", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify no image-specific fragmentation rules added
  assert.doesNotMatch(sourceFile, /img\s*?{.*?break/);
});

test("pagination-footnote-layout: Lot 4 reserved bottom area guard", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/pagination-engine.ts"),
    "utf8"
  );

  // Verify reservedBottomAreaProvider mechanism
  assert.match(sourceFile, /reservedBottomAreaProvider/);

  // Verify it's optional (for non-footnote usage)
  assert.match(sourceFile, /reservedBottomAreaProvider\?/);
});

test("pagination-footnote-layout: Lot 5 marking and filtering guards", async () => {
  const footnotesFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/pagination-footnotes.ts"),
    "utf8"
  );
  const pdfFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify Lot 5 helpers exist
  assert.match(footnotesFile, /markRepeatedPaginationFootnoteReferences/);
  assert.match(footnotesFile, /cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences/);
  assert.match(footnotesFile, /clearRepeatedPaginationFootnoteReferenceMarks/);

  // Verify they're used in export-pdf
  assert.match(pdfFile, /markRepeatedPaginationFootnoteReferences/);
  assert.match(pdfFile, /clearRepeatedPaginationFootnoteReferenceMarks/);
});

test("pagination-footnote-layout: no baseline update committed", async () => {
  // Read baseline fixture file
  const baselineFile = path.resolve(process.cwd(), "test/fixtures/pagination-baseline.json");
  const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));

  // Verify it's the expected structure (Lot 0B)
  assert.strictEqual(baseline.pageCount, 6, "baseline should have 6 pages");
  assert(baseline.pages && Array.isArray(baseline.pages), "baseline should have pages array");
});

test("pagination-footnote-layout: export-pdf footnote helpers integrated", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Verify populatePaginationFootnoteNodes called
  assert.match(sourceFile, /populatePaginationFootnoteNodes/);

  // Verify createPaginationFootnoteNode exists
  assert.match(sourceFile, /createPaginationFootnoteNode/);

  // Verify createPaginationFootnoteArea exists
  assert.match(sourceFile, /createPaginationFootnoteArea/);
});

test("pagination-footnote-layout: no dual paginator systems", async () => {
  const pdfFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );
  const engineFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/pagination-engine.ts"),
    "utf8"
  );

  // Verify paginateDom and paginateDomCooperatively are the ONLY paginate functions
  const paginateFns = pdfFile.match(/paginate\w+/g) || [];
  const unique = [...new Set(paginateFns)];

  assert(!unique.includes("paginateWithFootnotes"), "no paginateWithFootnotes");
  assert(!unique.includes("paginateFootnotes"), "no paginateFootnotes");
  assert(unique.includes("paginateDom"), "paginateDom should be used");
});

test("pagination-footnote-layout: pages without footnotes unchanged", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Guard: pages with length 0 footnoteNodes don't get new wrapper
  assert.match(sourceFile, /hasPageFootnotes\s*&&\s*columnCount/);
  assert.match(sourceFile, /isMulticolumnWithFootnotes/);
});

test("pagination-footnote-layout: single-column with footnotes unchanged", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Guard: columnCount > 1 is required for new wrapper, not just hasPageFootnotes
  // This ensures 1-column pages with footnotes keep position:relative behavior
  assert.match(sourceFile, /columnCount > 1/);
  assert.match(sourceFile, /isMulticolumnWithFootnotes.*columnCount.*> 1/);
});

test("pagination-footnote-layout: multicolumn with footnotes uses body wrapper", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Guard: multicolumn + footnotes case creates pdf-page-body-columns wrapper
  assert.match(sourceFile, /pdf-page-body-columns/);
  assert.match(sourceFile, /flex: 1 1 auto/);
  assert.match(sourceFile, /min-height: 0/);

  // Guard: column properties moved to body wrapper
  assert.match(sourceFile, /column-count.*columnCount/);
  assert.match(sourceFile, /column-gap.*columnGapPt/);
});

test("pagination-footnote-layout: multicolumn footnotes use normal flow", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Guard: footnotes positioned=false for multicolumn case
  // positioned=!isMulticolumnWithFootnotes means positioned=false when multicolumn+footnotes
  assert.match(sourceFile, /!isMulticolumnWithFootnotes/);
});

test("pagination-footnote-layout: outer container is flex for multicolumn", async () => {
  const sourceFile = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/export-pdf.ts"),
    "utf8"
  );

  // Guard: when isMulticolumnWithFootnotes, content becomes flex container
  assert.match(sourceFile, /display: flex; flex-direction: column/);
});
