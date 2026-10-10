import test from "node:test";
import assert from "node:assert/strict";
import { validateCitationClusterResults } from "../src/api/citation-engine.js";

const clusters = [{ id: "valid", items: [{ id: "known" }] }, { id: "unresolved", items: [{ id: "known" }, { id: "rejected" }] }];
const citation = { clusterId: "valid", plainText: "Rendered", content: [{ type: "text", text: "Rendered" }] };

for (const code of ["UNKNOWN_CITEKEY", "DUPLICATE_CITEKEY", "UNSUPPORTED_BIBTEX_TYPE", "AMBIGUOUS_CROSSREF", "CYCLIC_CROSSREF"]) {
  test(`contract isolates ${code} only when tied to a requested cluster and key`, () => {
    const diagnostic = { code, severity: "error", message: "Synthetic error", clusterId: "unresolved", citekey: "rejected" };
    const result = { documentId: "doc", revision: 1, citations: [citation], bibliography: null, diagnostics: [diagnostic] };
    assert.equal(validateCitationClusterResults(clusters, result).valid, true);
    for (const change of [{ clusterId: undefined }, { clusterId: "foreign" }, { citekey: "foreign" }, { citekey: undefined }]) {
      assert.equal(validateCitationClusterResults(clusters, { ...result, diagnostics: [{ ...diagnostic, ...change }] }).valid, false);
    }
    assert.equal(validateCitationClusterResults(clusters, { ...result, diagnostics: [] }).valid, false);
    assert.equal(validateCitationClusterResults(clusters, { ...result, citations: [...result.citations, { ...citation, clusterId: "unresolved" }] }).valid, false);
  });
}

test("contract keeps global and unfamiliar errors fatal even with a cluster and key", () => {
  for (const code of ["BIBTEX_PARSE_ERROR", "CSL_STYLE_ERROR", "CSL_LOCALE_UNAVAILABLE", "CSL_PROCESSING_ERROR", "MISSING_CITEKEY", "UNRECOGNIZED_ERROR"]) {
    const result = { documentId: "doc", revision: 1, citations: [citation], bibliography: null,
      diagnostics: [{ code, severity: "error", message: "Fatal", clusterId: "unresolved", citekey: "rejected" }] };
    assert.equal(validateCitationClusterResults(clusters, result).valid, false);
  }
});
