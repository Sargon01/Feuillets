import test from "node:test";
import assert from "node:assert/strict";
import { Platform } from "obsidian";
import { GrammarUserData } from "../src/services/grammar-user-data.js";

test("GrammarUserData : construction et save() no-op hors desktop (aucun require Node)", () => {
  const previousDesktop = Platform.isDesktop;
  Platform.isDesktop = false;
  try {
    const data = new GrammarUserData({}, {});
    assert.deepEqual(data.knownWords, []);
    assert.deepEqual(data.ignoredRules, []);
    assert.doesNotThrow(() => data.learnWord("mot"));
    assert.equal(data.knownWords.includes("mot"), true);
    assert.throws(() => data.filePath, /mobile/i);
  } finally {
    Platform.isDesktop = previousDesktop;
  }
});
