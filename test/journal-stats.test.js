import { test } from "node:test";
import assert from "node:assert/strict";
import { dateKey, statsForDay } from "../src/utils/journal-stats.js";

test("dateKey", async (t) => {
  await t.test("formate AAAA-MM-JJ avec zéros de tête", () => {
    assert.equal(dateKey(new Date(2026, 0, 5)), "2026-01-05");
  });

  await t.test("gère décembre correctement", () => {
    assert.equal(dateKey(new Date(2025, 11, 31)), "2025-12-31");
  });
});

test("statsForDay", async (t) => {
  await t.test("retourne 0 si le jour n'a aucune entrée", () => {
    assert.deepEqual(statsForDay({ stats: {} }, "2026-01-05"), { delta: 0 });
  });

  await t.test("calcule le delta entre start et latest", () => {
    const settings = { stats: { "2026-01-05": { start: 1000, latest: 1450 } } };
    assert.deepEqual(statsForDay(settings, "2026-01-05"), { delta: 450 });
  });

  await t.test("ne retourne jamais un delta négatif", () => {
    const settings = { stats: { "2026-01-05": { start: 1000, latest: 900 } } };
    assert.deepEqual(statsForDay(settings, "2026-01-05"), { delta: 0 });
  });

  await t.test("gère un settings.stats absent", () => {
    assert.deepEqual(statsForDay({}, "2026-01-05"), { delta: 0 });
  });
});
