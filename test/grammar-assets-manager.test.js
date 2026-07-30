import test from "node:test";
import assert from "node:assert/strict";
import { Platform } from "obsidian";
import { isEngineInstalled, downloadEngine } from "../src/services/grammar-assets-manager.js";

test("isEngineInstalled : renvoie false hors desktop sans toucher au disque", () => {
  const previousDesktop = Platform.isDesktop;
  Platform.isDesktop = false;
  try {
    assert.equal(isEngineInstalled({}, {}, "grammalecte"), false);
    assert.equal(isEngineInstalled({}, {}, "harper"), false);
  } finally {
    Platform.isDesktop = previousDesktop;
  }
});

test("downloadEngine : refuse proprement hors desktop (aucun require Node)", async () => {
  const previousDesktop = Platform.isDesktop;
  Platform.isDesktop = false;
  try {
    await assert.rejects(() => downloadEngine({}, {}, "grammalecte"), /mobile/i);
  } finally {
    Platform.isDesktop = previousDesktop;
  }
});
