import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateKey,
  validateStatsTable,
  resolveProjectStats,
  statsForDay,
  recordDailyTotal,
  mergeLegacyStats,
  trimStatsTable,
  dailyWordDelta,
} from "../src/utils/journal-stats.js";

test("dateKey", async (t) => {
  await t.test("formate AAAA-MM-JJ avec zéros de tête", () => {
    assert.equal(dateKey(new Date(2026, 0, 5)), "2026-01-05");
  });

  await t.test("gère décembre correctement", () => {
    assert.equal(dateKey(new Date(2025, 11, 31)), "2025-12-31");
  });
});

test("validateStatsTable", async (t) => {
  await t.test("rejette une valeur absente ou non-objet", () => {
    assert.deepEqual(validateStatsTable(undefined), {});
    assert.deepEqual(validateStatsTable(null), {});
  });

  await t.test("ne garde que les entrées {start, latest} numériques", () => {
    const raw = {
      "2026-01-01": { start: 100, latest: 200 },
      "2026-01-02": { start: "cent", latest: 200 },
      "2026-01-03": "pas un objet",
      "2026-01-04": { start: 50 },
    };
    assert.deepEqual(validateStatsTable(raw), { "2026-01-01": { start: 100, latest: 200 } });
  });
});

test("resolveProjectStats", async (t) => {
  await t.test("table vide quand journalStats est absent", () => {
    assert.deepEqual(resolveProjectStats(undefined), {});
    assert.deepEqual(resolveProjectStats(null), {});
    assert.deepEqual(resolveProjectStats({}), {});
  });

  await t.test("résout la table du projet sans mutation", () => {
    const meta = { journalStats: { "2026-01-05": { start: 10, latest: 40 } } };
    const before = JSON.stringify(meta);
    assert.deepEqual(resolveProjectStats(meta), { "2026-01-05": { start: 10, latest: 40 } });
    assert.equal(JSON.stringify(meta), before);
  });
});

test("dailyWordDelta", async (t) => {
  await t.test("calcule latest - start quand positif", () => {
    assert.equal(dailyWordDelta(1000, 1450), 450);
  });

  await t.test("ramène un delta négatif à zéro", () => {
    assert.equal(dailyWordDelta(1000, 900), 0);
  });

  await t.test("delta nul reste nul", () => {
    assert.equal(dailyWordDelta(1000, 1000), 0);
  });
});

test("statsForDay", async (t) => {
  await t.test("retourne 0 si le jour n'a aucune entrée", () => {
    assert.deepEqual(statsForDay({}, "2026-01-05"), { delta: 0 });
  });

  await t.test("calcule le delta entre start et latest", () => {
    const stats = { "2026-01-05": { start: 1000, latest: 1450 } };
    assert.deepEqual(statsForDay(stats, "2026-01-05"), { delta: 450 });
  });

  await t.test("ne retourne jamais un delta négatif", () => {
    const stats = { "2026-01-05": { start: 1000, latest: 900 } };
    assert.deepEqual(statsForDay(stats, "2026-01-05"), { delta: 0 });
  });

  await t.test("applique exactement la même règle que dailyWordDelta, pour toute paire start/latest", () => {
    const cases = [[1000, 1450], [1000, 900], [1000, 1000], [0, 0], [500, 0], [0, 500]];
    for (const [start, latest] of cases) {
      const stats = { d: { start, latest } };
      assert.equal(statsForDay(stats, "d").delta, dailyWordDelta(start, latest), `start=${start}, latest=${latest}`);
    }
  });
});

test("recordDailyTotal", async (t) => {
  await t.test("première observation du jour : baseline et delta nul", () => {
    const { table, changed } = recordDailyTotal({}, "2026-01-05", 1000);
    assert.equal(changed, true);
    assert.deepEqual(table, { "2026-01-05": { start: 1000, latest: 1000 } });
    assert.deepEqual(statsForDay(table, "2026-01-05"), { delta: 0 });
  });

  await t.test("observation suivante : seul latest évolue", () => {
    const initial = { "2026-01-05": { start: 1000, latest: 1000 } };
    const { table, changed } = recordDailyTotal(initial, "2026-01-05", 1450);
    assert.equal(changed, true);
    assert.deepEqual(table, { "2026-01-05": { start: 1000, latest: 1450 } });
  });

  await t.test("total inchangé : aucune mutation, même table par référence", () => {
    const initial = { "2026-01-05": { start: 1000, latest: 1450 } };
    const { table, changed } = recordDailyTotal(initial, "2026-01-05", 1450);
    assert.equal(changed, false);
    assert.equal(table, initial);
  });

  await t.test("ne mute jamais la table passée en entrée", () => {
    const initial = { "2026-01-05": { start: 1000, latest: 1000 } };
    const before = JSON.stringify(initial);
    recordDailyTotal(initial, "2026-01-05", 2000);
    assert.equal(JSON.stringify(initial), before);
  });

  await t.test("n'affecte pas les autres jours de la table", () => {
    const initial = { "2026-01-04": { start: 500, latest: 600 } };
    const { table } = recordDailyTotal(initial, "2026-01-05", 1000);
    assert.deepEqual(table["2026-01-04"], { start: 500, latest: 600 });
  });
});

test("mergeLegacyStats", async (t) => {
  await t.test("les dates déjà propres au projet priment sur le legacy", () => {
    const current = { "2026-01-01": { start: 100, latest: 150 } };
    const legacy = { "2026-01-01": { start: 999, latest: 999 }, "2026-01-02": { start: 10, latest: 20 } };
    assert.deepEqual(mergeLegacyStats(current, legacy), {
      "2026-01-01": { start: 100, latest: 150 },
      "2026-01-02": { start: 10, latest: 20 },
    });
  });

  await t.test("current vide : legacy est repris intégralement", () => {
    const legacy = { "2026-01-01": { start: 1, latest: 2 } };
    assert.deepEqual(mergeLegacyStats({}, legacy), legacy);
  });

  await t.test("legacy vide : current est repris intégralement", () => {
    const current = { "2026-01-01": { start: 1, latest: 2 } };
    assert.deepEqual(mergeLegacyStats(current, {}), current);
  });
});

test("trimStatsTable", async (t) => {
  await t.test("0 = illimité, table inchangée (même référence)", () => {
    const stats = { "2026-01-01": { start: 1, latest: 2 } };
    assert.equal(trimStatsTable(stats, 0), stats);
  });

  await t.test("retention négative ou non finie = illimité", () => {
    const stats = { "2026-01-01": { start: 1, latest: 2 } };
    assert.equal(trimStatsTable(stats, -5), stats);
    assert.equal(trimStatsTable(stats, NaN), stats);
  });

  await t.test("garde les N dates les plus récentes", () => {
    const stats = {
      "2026-01-01": { start: 1, latest: 1 },
      "2026-01-02": { start: 2, latest: 2 },
      "2026-01-03": { start: 3, latest: 3 },
    };
    assert.deepEqual(trimStatsTable(stats, 2), {
      "2026-01-02": { start: 2, latest: 2 },
      "2026-01-03": { start: 3, latest: 3 },
    });
  });

  await t.test("table déjà sous la limite : inchangée (même référence)", () => {
    const stats = { "2026-01-01": { start: 1, latest: 1 } };
    assert.equal(trimStatsTable(stats, 5), stats);
  });
});
