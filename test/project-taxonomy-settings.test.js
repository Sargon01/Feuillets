import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { projectStatuses, projectLabels } from "../src/services/project-settings.js";
import { isBuiltinStatusId, isBuiltinLabelId, statusStoredValue, labelStoredValue } from "../src/services/project-taxonomy.js";

/* Settings/data compatibility: new defaults use the stable-id catalog;
   existing settings data (whatever shape it already has) is never
   migrated, rewritten, or touched — only a brand-new install (no
   existing data.json entry at all) ever reads these defaults. */

/* ==================== new defaults use stable ids ==================== */

test("DEFAULT_SETTINGS.statuses are the five built-in statuses, identified by id", () => {
  assert.equal(DEFAULT_SETTINGS.statuses.length, 5);
  for (const entry of DEFAULT_SETTINGS.statuses) {
    assert.ok(entry.id, `status entry must carry a stable id: ${JSON.stringify(entry)}`);
    assert.equal(isBuiltinStatusId(entry.id), true);
  }
  assert.deepEqual(DEFAULT_SETTINGS.statuses.map((s) => s.id), ["idea", "draft", "in_progress", "revised", "complete"]);
});

test("DEFAULT_SETTINGS.labels are the six built-in labels, identified by id", () => {
  assert.equal(DEFAULT_SETTINGS.labels.length, 6);
  for (const entry of DEFAULT_SETTINGS.labels) {
    assert.ok(entry.id, `label entry must carry a stable id: ${JSON.stringify(entry)}`);
    assert.equal(isBuiltinLabelId(entry.id), true);
  }
  assert.deepEqual(DEFAULT_SETTINGS.labels.map((l) => l.id), ["red", "orange", "yellow", "green", "blue", "purple"]);
});

test("DEFAULT_SETTINGS filter sentinels use the stable \"all\" id, never a French/English word", () => {
  assert.equal(DEFAULT_SETTINGS.statusFilter, "all");
  assert.equal(DEFAULT_SETTINGS.labelFilter, "all");
  assert.equal(DEFAULT_SETTINGS.progressFilter, "all");
  assert.equal(DEFAULT_SETTINGS.binderStatusFilter, "all");
  assert.equal(DEFAULT_SETTINGS.binderLabelFilter, "all");
  assert.equal(DEFAULT_SETTINGS.binderProgressFilter, "all");
});

test("every DEFAULT_SETTINGS status/label entry resolves a real stored value through statusStoredValue/labelStoredValue", () => {
  for (const entry of DEFAULT_SETTINGS.statuses) assert.equal(statusStoredValue(entry), entry.id);
  for (const entry of DEFAULT_SETTINGS.labels) assert.equal(labelStoredValue(entry), entry.id);
});

/* ==================== existing settings data is never touched ==================== */

test("an existing user's own statuses/labels array always overrides the new default on load (Object.assign semantics) — no migration needed", () => {
  const legacyStatuses = [
    { name: "Legacy Status One", color: "#8a8a8a" },
    { name: "Legacy Status Two", color: "#e08f4f" },
  ];
  const legacyLabels = [{ name: "Legacy Label One", color: "#e0524f" }];
  // A legacy stored filter sentinel is opaque data here — any non-empty
  // string works to prove it survives loading unchanged; it need not be
  // the actual historical French/English text (covered by
  // test/project-taxonomy.test.js's normalizeFilterSentinel tests instead).
  const legacyData = { statuses: legacyStatuses, labels: legacyLabels, statusFilter: "legacy-sentinel-value", labelFilter: "another-legacy-value" };

  // Mirrors main.ts's own loadSettings(): Object.assign({}, DEFAULT_SETTINGS, data).
  const loaded = Object.assign({}, DEFAULT_SETTINGS, legacyData);

  assert.equal(loaded.statuses, legacyStatuses, "the exact same array reference — never cloned, never rewritten");
  assert.equal(loaded.labels, legacyLabels);
  assert.equal(loaded.statusFilter, "legacy-sentinel-value", "a legacy stored sentinel survives loading completely unchanged");
  assert.equal(loaded.labelFilter, "another-legacy-value");
  assert.deepEqual(loaded.statuses, [
    { name: "Legacy Status One", color: "#8a8a8a" },
    { name: "Legacy Status Two", color: "#e08f4f" },
  ], "byte-for-byte identical to what was on disk");
});

test("a brand-new install (no existing statuses/labels/filters at all) reads the new built-in defaults, untouched by any migration step", () => {
  const loaded = Object.assign({}, DEFAULT_SETTINGS, {});
  assert.equal(loaded.statuses, DEFAULT_SETTINGS.statuses);
  assert.equal(loaded.labels, DEFAULT_SETTINGS.labels);
  assert.equal(loaded.statusFilter, "all");
});

/* ==================== project/global fallback preservation ==================== */

test("projectStatuses/projectLabels resolution is untouched: still a plain, unmodified read-through, no id-awareness added to the resolver itself", () => {
  const raw = { statuses: [{ id: "draft", name: "Draft", color: "#e08f4f" }], labels: [{ id: "red", name: "Red", color: "#e0524f" }] };
  const app = {};
  const settingsWithoutOverride = { ...raw, projectMeta: {}, projectFolder: "" };
  // getProjectFolder(app, settings) returns null without a real vault/app — activeProjectMeta then
  // returns null, so projectStatuses/projectLabels fall back to the global settings arrays exactly.
  assert.deepEqual(projectStatuses(app, settingsWithoutOverride), raw.statuses);
  assert.deepEqual(projectLabels(app, settingsWithoutOverride), raw.labels);
  // Same array reference — a read-through, never a clone, never a rewrite.
  assert.equal(projectStatuses(app, settingsWithoutOverride), raw.statuses);
  assert.equal(projectLabels(app, settingsWithoutOverride), raw.labels);
});

/* ==================== no French literal anywhere in this batch's part of default-settings.ts ==================== */

test("default-settings.ts no longer hardcodes the old French status/label name literals — the catalog is built from project-taxonomy.ts instead", () => {
  const raw = readFileSync(join(process.cwd(), "src/default-settings.ts"), "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  // Neither the old per-entry NAME literals nor the old progress-filter
  // sentinel words survive anywhere in this file, not even inside a type
  // annotation: binderProgressFilter/progressFilter are typed as plain
  // `string` (see the test below), so no historical value has to be
  // spelled out in TypeScript at all.
  for (const word of ["Idée", "Brouillon", "Rouge", "Violet", "Jaune", "Tous", "Atteint", "En dessous", "Dépassé"]) {
    assert.doesNotMatch(code, new RegExp(word));
  }
  assert.match(code, /builtinStatusDefaults\(\)/);
  assert.match(code, /builtinLabelDefaults\(\)/);
});

test("binderProgressFilter/progressFilter are typed as plain string, not a literal union spelling out legacy sentinel words", () => {
  const raw = readFileSync(join(process.cwd(), "src/default-settings.ts"), "utf8");
  assert.match(raw, /binderProgressFilter:\s*string;/);
  assert.match(raw, /progressFilter:\s*string;/);
});
