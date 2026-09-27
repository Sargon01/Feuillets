import test from "node:test";
import assert from "node:assert/strict";
import { translate } from "../src/i18n/index.js";
import { migrateLegacyTaxonomyEntries } from "../src/services/project-settings.js";
import { statusDisplayLabel, labelDisplayLabel } from "../src/services/project-taxonomy.js";

/*
 * Migration bridge: an existing installation's `{ name, color }` built-in
 * statuses/labels become `{ id, color }`, so the stable-id translation
 * layer (project-taxonomy.ts) can finally apply to them. Only entries
 * positively identified — name AND canonical color both matching a
 * historical built-in — are ever touched; everything else (a real custom
 * entry, an already-migrated `{ id }` entry) is preserved exactly.
 */

function frFixture(key) { return translate("fr", key); }
function enFixture(key) { return translate("en", key); }

function settings(overrides = {}) {
  return {
    statuses: [],
    labels: [],
    projectMeta: {},
    ...overrides,
  };
}

test("a legacy French built-in status migrates to its stable id, color preserved, and now translates in another locale", () => {
  const value = settings({ statuses: [{ name: frFixture("taxonomy.status.draft"), color: "#e08f4f" }] });
  assert.equal(migrateLegacyTaxonomyEntries(value), true);
  assert.deepEqual(value.statuses, [{ id: "draft", color: "#e08f4f" }]);
  assert.equal(statusDisplayLabel(value.statuses[0], "en"), enFixture("taxonomy.status.draft"));
});

test("a legacy French built-in label migrates to its stable id, color preserved, keeps an English name fallback, and now translates", () => {
  const value = settings({ labels: [{ name: frFixture("taxonomy.label.red"), color: "#e0524f" }] });
  assert.equal(migrateLegacyTaxonomyEntries(value), true);
  assert.equal(value.labels[0].id, "red");
  assert.equal(value.labels[0].color, "#e0524f");
  assert.equal(labelDisplayLabel(value.labels[0], "en"), enFixture("taxonomy.label.red"));
});

test("a legacy ENGLISH built-in status is also recognized, converted to the same stable id", () => {
  const value = settings({ statuses: [{ name: enFixture("taxonomy.status.draft"), color: "#e08f4f" }] });
  assert.equal(migrateLegacyTaxonomyEntries(value), true);
  assert.deepEqual(value.statuses, [{ id: "draft", color: "#e08f4f" }]);
});

test("a legacy ENGLISH built-in label is also recognized, converted to the same stable id", () => {
  const value = settings({ labels: [{ name: enFixture("taxonomy.label.red"), color: "#e0524f" }] });
  assert.equal(migrateLegacyTaxonomyEntries(value), true);
  assert.equal(value.labels[0].id, "red");
});

test("a modern { id } entry is left strictly unchanged", () => {
  const value = settings({ statuses: [{ id: "draft", color: "#e08f4f" }] });
  const before = value.statuses[0];
  assert.equal(migrateLegacyTaxonomyEntries(value), false);
  assert.equal(value.statuses[0], before, "same object reference: never rebuilt");
});

test("a genuine custom status is preserved exactly", () => {
  const value = settings({ statuses: [{ name: "My custom status", color: "#123456" }] });
  const before = value.statuses[0];
  assert.equal(migrateLegacyTaxonomyEntries(value), false);
  assert.equal(value.statuses[0], before);
  assert.deepEqual(value.statuses[0], { name: "My custom status", color: "#123456" });
});

test("name collision, wrong color: the entry cannot be identified with certainty and is preserved as custom", () => {
  const value = settings({ statuses: [{ name: frFixture("taxonomy.status.draft"), color: "#123456" }] });
  const before = value.statuses[0];
  assert.equal(migrateLegacyTaxonomyEntries(value), false);
  assert.equal(value.statuses[0], before);
  assert.equal(value.statuses[0].name, frFixture("taxonomy.status.draft"));
  assert.equal(value.statuses[0].color, "#123456");
});

test("a project override (projectMeta[path].statuses/labels) is migrated when it exists", () => {
  const value = settings({
    projectMeta: {
      "Roman/Manuscrit": {
        statuses: [{ name: frFixture("taxonomy.status.complete"), color: "#5aa564" }],
        labels: [{ name: frFixture("taxonomy.label.blue"), color: "#5a8fd9" }],
      },
    },
  });
  assert.equal(migrateLegacyTaxonomyEntries(value), true);
  assert.deepEqual(value.projectMeta["Roman/Manuscrit"].statuses, [{ id: "complete", color: "#5aa564" }]);
  assert.equal(value.projectMeta["Roman/Manuscrit"].labels[0].id, "blue");
});

test("a project WITHOUT any statuses/labels override gets none created", () => {
  const value = settings({ projectMeta: { "Roman/Manuscrit": { type: "fiction" } } });
  assert.equal(migrateLegacyTaxonomyEntries(value), false);
  assert.equal("statuses" in value.projectMeta["Roman/Manuscrit"], false);
  assert.equal("labels" in value.projectMeta["Roman/Manuscrit"], false);
  assert.deepEqual(value.projectMeta["Roman/Manuscrit"], { type: "fiction" });
});

test("idempotent: running the migration a second time changes nothing further", () => {
  const value = settings({
    statuses: [{ name: frFixture("taxonomy.status.draft"), color: "#e08f4f" }],
    labels: [{ name: frFixture("taxonomy.label.red"), color: "#e0524f" }],
    projectMeta: {
      Roman: { statuses: [{ name: frFixture("taxonomy.status.idea"), color: "#8a8a8a" }] },
    },
  });
  assert.equal(migrateLegacyTaxonomyEntries(value), true);
  const snapshot = JSON.parse(JSON.stringify(value));
  assert.equal(migrateLegacyTaxonomyEntries(value), false);
  assert.deepEqual(value, snapshot);
});

test("a mixed array of legacy built-ins and genuine customs migrates only the built-ins", () => {
  const value = settings({
    statuses: [
      { name: frFixture("taxonomy.status.draft"), color: "#e08f4f" },
      { name: "My custom status", color: "#123456" },
      { name: frFixture("taxonomy.status.complete"), color: "#5aa564" },
    ],
  });
  assert.equal(migrateLegacyTaxonomyEntries(value), true);
  assert.deepEqual(value.statuses, [
    { id: "draft", color: "#e08f4f" },
    { name: "My custom status", color: "#123456" },
    { id: "complete", color: "#5aa564" },
  ]);
});

/* ====================================================================== *
 * Reported real-world scenario, end to end: a whole pre-existing French
 * installation's `settings.statuses`/`settings.labels`, run through the
 * EXACT SAME migration function loadSettings() calls, then read back
 * through the actual display functions in both locales.
 * ====================================================================== */

test("real-world scenario: a whole legacy French installation migrates, translates correctly in both locales, and never re-migrates", () => {
  // Step 1: an old installation's settings.statuses/labels, in the
  // historical French built-in shape, with their canonical historical
  // colors — exactly as an existing data.json would hold them, plus one
  // genuine custom status and one genuine custom label (step 7).
  const value = settings({
    statuses: [
      { name: frFixture("taxonomy.status.idea"), color: "#8a8a8a" },
      { name: frFixture("taxonomy.status.draft"), color: "#e08f4f" },
      { name: frFixture("taxonomy.status.in_progress"), color: "#d9c04a" },
      { name: frFixture("taxonomy.status.revised"), color: "#5a8fd9" },
      { name: frFixture("taxonomy.status.complete"), color: "#5aa564" },
      { name: "Statut perso", color: "#ff00ff" },
    ],
    labels: [
      { name: frFixture("taxonomy.label.red"), color: "#e0524f" },
      { name: frFixture("taxonomy.label.orange"), color: "#e08f4f" },
      { name: frFixture("taxonomy.label.yellow"), color: "#d9c04a" },
      { name: frFixture("taxonomy.label.green"), color: "#5aa564" },
      { name: frFixture("taxonomy.label.blue"), color: "#5a8fd9" },
      { name: frFixture("taxonomy.label.purple"), color: "#9a6dd7" },
      { name: "Label perso", color: "#00ffff" },
    ],
  });

  // Step 2: the exact same migration function loadSettings() calls.
  const changedOnFirstRun = migrateLegacyTaxonomyEntries(value);
  assert.equal(changedOnFirstRun, true, "the first run must report a real change");

  // Step 3: every built-in entry now carries its stable id.
  assert.deepEqual(value.statuses.slice(0, 5).map((s) => s.id), [
    "idea", "draft", "in_progress", "revised", "complete",
  ]);
  assert.deepEqual(value.labels.slice(0, 6).map((l) => l.id), [
    "red", "orange", "yellow", "green", "blue", "purple",
  ]);
  // Canonical colors are preserved exactly, unchanged by the migration.
  assert.deepEqual(value.statuses.slice(0, 5).map((s) => s.color), [
    "#8a8a8a", "#e08f4f", "#d9c04a", "#5a8fd9", "#5aa564",
  ]);
  assert.deepEqual(value.labels.slice(0, 6).map((l) => l.color), [
    "#e0524f", "#e08f4f", "#d9c04a", "#5aa564", "#5a8fd9", "#9a6dd7",
  ]);

  // Step 4: English locale — display text comes from the production
  // functions, compared against src/i18n/en.ts's own strings, never
  // hand-typed in the test.
  const statusEn = value.statuses.slice(0, 5).map((s) => statusDisplayLabel(s, "en"));
  assert.deepEqual(statusEn, [
    enFixture("taxonomy.status.idea"),
    enFixture("taxonomy.status.draft"),
    enFixture("taxonomy.status.in_progress"),
    enFixture("taxonomy.status.revised"),
    enFixture("taxonomy.status.complete"),
  ]);
  assert.deepEqual(statusEn, ["Idea", "Draft", "In progress", "Revised", "Complete"]);

  const labelEn = value.labels.slice(0, 6).map((l) => labelDisplayLabel(l, "en"));
  assert.deepEqual(labelEn, [
    enFixture("taxonomy.label.red"),
    enFixture("taxonomy.label.orange"),
    enFixture("taxonomy.label.yellow"),
    enFixture("taxonomy.label.green"),
    enFixture("taxonomy.label.blue"),
    enFixture("taxonomy.label.purple"),
  ]);
  assert.deepEqual(labelEn, ["Red", "Orange", "Yellow", "Green", "Blue", "Purple"]);

  // Step 5: same migrated entries, French locale — labels come back in
  // French, again read from src/i18n/fr.ts's own strings.
  const statusFr = value.statuses.slice(0, 5).map((s) => statusDisplayLabel(s, "fr"));
  assert.deepEqual(statusFr, [
    frFixture("taxonomy.status.idea"),
    frFixture("taxonomy.status.draft"),
    frFixture("taxonomy.status.in_progress"),
    frFixture("taxonomy.status.revised"),
    frFixture("taxonomy.status.complete"),
  ]);

  const labelFr = value.labels.slice(0, 6).map((l) => labelDisplayLabel(l, "fr"));
  assert.deepEqual(labelFr, [
    frFixture("taxonomy.label.red"),
    frFixture("taxonomy.label.orange"),
    frFixture("taxonomy.label.yellow"),
    frFixture("taxonomy.label.green"),
    frFixture("taxonomy.label.blue"),
    frFixture("taxonomy.label.purple"),
  ]);

  // Step 6: switching locale never touches the persisted data itself —
  // only the DISPLAY call's own locale argument changed between steps 4/5,
  // the stored entries were read, never re-migrated or mutated.
  assert.deepEqual(value.statuses.slice(0, 5).map((s) => ({ id: s.id, color: s.color })), [
    { id: "idea", color: "#8a8a8a" },
    { id: "draft", color: "#e08f4f" },
    { id: "in_progress", color: "#d9c04a" },
    { id: "revised", color: "#5a8fd9" },
    { id: "complete", color: "#5aa564" },
  ]);

  // Step 7: the custom status/label are untouched in both locales — no
  // `id`, `name` and `color` exactly as originally entered.
  const customStatus = value.statuses[5];
  assert.deepEqual(customStatus, { name: "Statut perso", color: "#ff00ff" });
  assert.equal(statusDisplayLabel(customStatus, "en"), "Statut perso");
  assert.equal(statusDisplayLabel(customStatus, "fr"), "Statut perso");

  const customLabel = value.labels[6];
  assert.deepEqual(customLabel, { name: "Label perso", color: "#00ffff" });
  assert.equal(labelDisplayLabel(customLabel, "en"), "Label perso");
  assert.equal(labelDisplayLabel(customLabel, "fr"), "Label perso");

  // Step 8: idempotence — a second run of the exact same migration
  // function changes nothing further.
  const snapshot = JSON.parse(JSON.stringify(value));
  const changedOnSecondRun = migrateLegacyTaxonomyEntries(value);
  assert.equal(changedOnSecondRun, false, "the second run must report no change");
  assert.deepEqual(value, snapshot, "no data was altered by the second run");
});
