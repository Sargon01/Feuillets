import test from "node:test";
import assert from "node:assert/strict";
import { Platform } from "obsidian";
import { HarperChecker } from "../src/services/harper-checker.js";

test("HarperChecker.ensureLoaded : refuse proprement hors desktop (aucun require Node)", () => {
  const checker = new HarperChecker({}, {});
  const previousDesktop = Platform.isDesktop;
  Platform.isDesktop = false;
  try {
    assert.throws(() => checker.ensureLoaded(), /mobile/i);
    assert.equal(checker.linter, null);
  } finally {
    Platform.isDesktop = previousDesktop;
  }
});
