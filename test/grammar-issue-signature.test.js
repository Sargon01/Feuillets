import test from "node:test";
import assert from "node:assert/strict";
import { grammarIssueSignature } from "../src/utils/grammar-issue-signature.js";

test("grammarIssueSignature : associe la règle au mot normalisé", () => {
  assert.equal(grammarIssueSignature({ ruleId: "SPELL", underlined: "Sargon" }), "SPELL::sargon");
  assert.equal(grammarIssueSignature({ ruleId: "SPELL", underlined: "SARGON" }), "SPELL::sargon");
  assert.equal(grammarIssueSignature({ ruleId: "RULE" }), "RULE::");
});
