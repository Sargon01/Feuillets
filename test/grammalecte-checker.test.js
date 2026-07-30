import test from "node:test";
import assert from "node:assert/strict";
import { Platform } from "obsidian";
import { GrammalecteChecker } from "../src/services/grammalecte-checker.js";

test("GrammalecteChecker.ensureLoaded : refuse proprement hors desktop (aucun require Node)", () => {
  const checker = new GrammalecteChecker({}, {});
  const previousDesktop = Platform.isDesktop;
  Platform.isDesktop = false;
  try {
    assert.throws(() => checker.ensureLoaded(), /mobile/i);
    assert.equal(checker.context, null);
  } finally {
    Platform.isDesktop = previousDesktop;
  }
});
