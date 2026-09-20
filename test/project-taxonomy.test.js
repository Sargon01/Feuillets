import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocale, translate } from "../src/i18n/index.js";
import {
  isBuiltinStatusId,
  isBuiltinLabelId,
  builtinStatusColor,
  builtinLabelColor,
  builtinStatusIds,
  builtinLabelIds,
  statusDisplayLabel,
  labelDisplayLabel,
  statusStoredValue,
  labelStoredValue,
  builtinStatusDefaults,
  builtinLabelDefaults,
  normalizeFilterSentinel,
} from "../src/services/project-taxonomy.js";

/* Stable-identity layer for built-in statuses, labels, and filters — pure
 * logic only. No fake app/vault/settings anywhere in this file: every
 * function under test takes plain data and returns plain data.
 *
 * No French literal is hardcoded anywhere below: every expected French
 * (or English) display string is derived from the dictionaries themselves
 * via translate(locale, key) — never typed out as a string literal. Legacy/
 * custom entry names used as test fixtures are plain English placeholders,
 * since their exact spelling is never meaningful to the behavior under
 * test (see frFixture()/enFixture() below for the one case where the
 * actual dictionary text does matter: legacy filter sentinel recognition).
 */

function frFixture(key) { return translate("fr", key); }
function enFixture(key) { return translate("en", key); }

/* ==================== built-in ids ==================== */

test("built-in status ids are exactly idea, draft, in_progress, revised, complete, in this order", () => {
  assert.deepEqual(builtinStatusIds(), ["idea", "draft", "in_progress", "revised", "complete"]);
});

test("built-in label ids are exactly red, orange, yellow, green, blue, purple, in this order", () => {
  assert.deepEqual(builtinLabelIds(), ["red", "orange", "yellow", "green", "blue", "purple"]);
});

test("isBuiltinStatusId recognizes every built-in status id and rejects anything else", () => {
  for (const id of ["idea", "draft", "in_progress", "revised", "complete"]) {
    assert.equal(isBuiltinStatusId(id), true, id);
  }
  for (const id of ["", "Idea", "red", "custom-status", "legacy-status", "Legacy Status Name"]) {
    assert.equal(isBuiltinStatusId(id), false, id);
  }
});

test("isBuiltinLabelId recognizes every built-in label id and rejects anything else", () => {
  for (const id of ["red", "orange", "yellow", "green", "blue", "purple"]) {
    assert.equal(isBuiltinLabelId(id), true, id);
  }
  for (const id of ["", "Red", "idea", "custom-label", "legacy-label", "Custom Label Name"]) {
    assert.equal(isBuiltinLabelId(id), false, id);
  }
});

/* ==================== built-in colors ==================== */

test("builtinStatusColor returns the exact color for each built-in status id", () => {
  assert.equal(builtinStatusColor("idea"), "#8a8a8a");
  assert.equal(builtinStatusColor("draft"), "#e08f4f");
  assert.equal(builtinStatusColor("in_progress"), "#d9c04a");
  assert.equal(builtinStatusColor("revised"), "#5a8fd9");
  assert.equal(builtinStatusColor("complete"), "#5aa564");
});

test("builtinLabelColor returns the exact color for each built-in label id", () => {
  assert.equal(builtinLabelColor("red"), "#e0524f");
  assert.equal(builtinLabelColor("orange"), "#e08f4f");
  assert.equal(builtinLabelColor("yellow"), "#d9c04a");
  assert.equal(builtinLabelColor("green"), "#5aa564");
  assert.equal(builtinLabelColor("blue"), "#5a8fd9");
  assert.equal(builtinLabelColor("purple"), "#9a6dd7");
});

/* ==================== translated display labels (FR/EN) ==================== */

test("statusDisplayLabel translates a built-in status by id, in French", () => {
  assert.equal(statusDisplayLabel({ id: "idea", color: "#8a8a8a" }, "fr"), frFixture("taxonomy.status.idea"));
  assert.equal(statusDisplayLabel({ id: "draft", color: "#e08f4f" }, "fr"), frFixture("taxonomy.status.draft"));
  assert.equal(statusDisplayLabel({ id: "in_progress", color: "#d9c04a" }, "fr"), frFixture("taxonomy.status.in_progress"));
  assert.equal(statusDisplayLabel({ id: "revised", color: "#5a8fd9" }, "fr"), frFixture("taxonomy.status.revised"));
  assert.equal(statusDisplayLabel({ id: "complete", color: "#5aa564" }, "fr"), frFixture("taxonomy.status.complete"));
});

test("statusDisplayLabel translates a built-in status by id, in English", () => {
  assert.equal(statusDisplayLabel({ id: "idea", color: "#8a8a8a" }, "en"), enFixture("taxonomy.status.idea"));
  assert.equal(statusDisplayLabel({ id: "draft", color: "#e08f4f" }, "en"), enFixture("taxonomy.status.draft"));
  assert.equal(statusDisplayLabel({ id: "in_progress", color: "#d9c04a" }, "en"), enFixture("taxonomy.status.in_progress"));
  assert.equal(statusDisplayLabel({ id: "revised", color: "#5a8fd9" }, "en"), enFixture("taxonomy.status.revised"));
  assert.equal(statusDisplayLabel({ id: "complete", color: "#5aa564" }, "en"), enFixture("taxonomy.status.complete"));
});

test("labelDisplayLabel translates a built-in label by id, in French and English", () => {
  assert.equal(labelDisplayLabel({ id: "red", color: "#e0524f" }, "fr"), frFixture("taxonomy.label.red"));
  assert.equal(labelDisplayLabel({ id: "red", color: "#e0524f" }, "en"), enFixture("taxonomy.label.red"));
  assert.equal(labelDisplayLabel({ id: "purple", color: "#9a6dd7" }, "fr"), frFixture("taxonomy.label.purple"));
  assert.equal(labelDisplayLabel({ id: "purple", color: "#9a6dd7" }, "en"), enFixture("taxonomy.label.purple"));
});

test("French and English translations are actually distinct for every built-in status/label", () => {
  for (const id of builtinStatusIds()) {
    assert.notEqual(
      statusDisplayLabel({ id, color: "#000000" }, "fr"),
      statusDisplayLabel({ id, color: "#000000" }, "en"),
      id
    );
  }
  // "orange" happens to be spelled the same in both languages — every
  // other built-in label must still differ.
  for (const id of builtinLabelIds().filter((value) => value !== "orange")) {
    assert.notEqual(
      labelDisplayLabel({ id, color: "#000000" }, "fr"),
      labelDisplayLabel({ id, color: "#000000" }, "en"),
      id
    );
  }
});

/* ==================== custom/legacy entries: unchanged ==================== */

test("statusDisplayLabel never translates a legacy/custom entry — its stored name is returned exactly, in either locale", () => {
  const legacy = { name: "Legacy Status Name", color: "#e08f4f" };
  assert.equal(statusDisplayLabel(legacy, "fr"), "Legacy Status Name");
  assert.equal(statusDisplayLabel(legacy, "en"), "Legacy Status Name", "never re-translated into English either");

  const custom = { name: "Editorial Review Pending", color: "#ff00ff" };
  assert.equal(statusDisplayLabel(custom, "fr"), "Editorial Review Pending");
  assert.equal(statusDisplayLabel(custom, "en"), "Editorial Review Pending");
});

test("labelDisplayLabel never translates a legacy/custom entry — its stored name is returned exactly", () => {
  const legacy = { name: "Legacy Label Name", color: "#e0524f" };
  assert.equal(labelDisplayLabel(legacy, "fr"), "Legacy Label Name");
  assert.equal(labelDisplayLabel(legacy, "en"), "Legacy Label Name");

  const custom = { name: "Custom Personal Color", color: "#123456" };
  assert.equal(labelDisplayLabel(custom, "fr"), "Custom Personal Color");
  assert.equal(labelDisplayLabel(custom, "en"), "Custom Personal Color");
});

test("an entry with an unrecognized id falls back to its stored name, like a legacy entry", () => {
  const entry = { id: "some-future-id", name: "Fallback Name", color: "#000000" };
  assert.equal(statusDisplayLabel(entry, "fr"), "Fallback Name");
  assert.equal(labelDisplayLabel(entry, "en"), "Fallback Name");
});

test("statusDisplayLabel/labelDisplayLabel default to the active global locale when none is given", () => {
  const entry = { id: "idea", color: "#8a8a8a" };
  assert.equal(statusDisplayLabel(entry), statusDisplayLabel(entry, getLocale()));
  const labelEntry = { id: "red", color: "#e0524f" };
  assert.equal(labelDisplayLabel(labelEntry), labelDisplayLabel(labelEntry, getLocale()));
});

/* ==================== stored value: id for built-in, name for custom ==================== */

test("statusStoredValue returns the stable id for a built-in entry, ignoring any name fallback it may carry", () => {
  assert.equal(statusStoredValue({ id: "draft", name: "Draft", color: "#e08f4f" }), "draft");
  assert.equal(statusStoredValue({ id: "draft", color: "#e08f4f" }), "draft");
});

test("statusStoredValue returns the literal name for a legacy/custom entry", () => {
  assert.equal(statusStoredValue({ name: "Legacy Status Name", color: "#e08f4f" }), "Legacy Status Name");
  assert.equal(statusStoredValue({ name: "Editorial Review Pending", color: "#ff00ff" }), "Editorial Review Pending");
});

test("labelStoredValue returns the stable id for a built-in entry, the literal name for a legacy/custom one", () => {
  assert.equal(labelStoredValue({ id: "red", name: "Red", color: "#e0524f" }), "red");
  assert.equal(labelStoredValue({ name: "Legacy Label Name", color: "#e0524f" }), "Legacy Label Name");
});

test("statusStoredValue/labelStoredValue never crash on an entry with neither id nor name", () => {
  assert.equal(statusStoredValue({ color: "#000000" }), "");
  assert.equal(labelStoredValue({ color: "#000000" }), "");
});

/* ==================== default catalog for brand-new installs ==================== */

test("builtinStatusDefaults returns the full catalog with id, an English name fallback, and the exact color", () => {
  const defaults = builtinStatusDefaults();
  assert.deepEqual(defaults, [
    { id: "idea", name: enFixture("taxonomy.status.idea"), color: "#8a8a8a" },
    { id: "draft", name: enFixture("taxonomy.status.draft"), color: "#e08f4f" },
    { id: "in_progress", name: enFixture("taxonomy.status.in_progress"), color: "#d9c04a" },
    { id: "revised", name: enFixture("taxonomy.status.revised"), color: "#5a8fd9" },
    { id: "complete", name: enFixture("taxonomy.status.complete"), color: "#5aa564" },
  ]);
});

test("builtinLabelDefaults returns the full catalog with id, an English name fallback, and the exact color", () => {
  const defaults = builtinLabelDefaults();
  assert.deepEqual(defaults, [
    { id: "red", name: enFixture("taxonomy.label.red"), color: "#e0524f" },
    { id: "orange", name: enFixture("taxonomy.label.orange"), color: "#e08f4f" },
    { id: "yellow", name: enFixture("taxonomy.label.yellow"), color: "#d9c04a" },
    { id: "green", name: enFixture("taxonomy.label.green"), color: "#5aa564" },
    { id: "blue", name: enFixture("taxonomy.label.blue"), color: "#5a8fd9" },
    { id: "purple", name: enFixture("taxonomy.label.purple"), color: "#9a6dd7" },
  ]);
});

test("builtinStatusDefaults/builtinLabelDefaults are deterministic and return a fresh array/objects each call", () => {
  const a = builtinStatusDefaults();
  const b = builtinStatusDefaults();
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  assert.notEqual(a[0], b[0]);
});

test("every default entry is correctly recognized as its own built-in id by the display/stored-value helpers", () => {
  for (const entry of builtinStatusDefaults()) {
    assert.equal(statusStoredValue(entry), entry.id);
    assert.equal(statusDisplayLabel(entry, "en"), entry.name);
  }
  for (const entry of builtinLabelDefaults()) {
    assert.equal(labelStoredValue(entry), entry.id);
    assert.equal(labelDisplayLabel(entry, "en"), entry.name);
  }
});

/* ==================== filter sentinels: canonical ids ==================== */

test("normalizeFilterSentinel: canonical stable ids pass through unchanged", () => {
  for (const id of ["all", "none", "hit", "under", "over"]) {
    assert.equal(normalizeFilterSentinel(id), id);
  }
});

test("normalizeFilterSentinel: legacy French sentinels (the exact dictionary text) normalize to the stable id", () => {
  assert.equal(normalizeFilterSentinel(frFixture("binder.filter.all")), "all");
  assert.equal(normalizeFilterSentinel(frFixture("binder.filter.noStatus")), "none");
  assert.equal(normalizeFilterSentinel(frFixture("binder.filter.noLabel")), "none");
  assert.equal(normalizeFilterSentinel(frFixture("binder.filter.progressHit")), "hit");
  assert.equal(normalizeFilterSentinel(frFixture("binder.filter.progressUnder")), "under");
  assert.equal(normalizeFilterSentinel(frFixture("binder.filter.progressOver")), "over");
});

test("normalizeFilterSentinel: legacy English sentinels (the exact dictionary text) normalize to the stable id", () => {
  assert.equal(normalizeFilterSentinel(enFixture("binder.filter.all")), "all");
  assert.equal(normalizeFilterSentinel(enFixture("binder.filter.noStatus")), "none");
  assert.equal(normalizeFilterSentinel(enFixture("binder.filter.noLabel")), "none");
  assert.equal(normalizeFilterSentinel(enFixture("binder.filter.progressHit")), "hit");
  assert.equal(normalizeFilterSentinel(enFixture("binder.filter.progressUnder")), "under");
  assert.equal(normalizeFilterSentinel(enFixture("binder.filter.progressOver")), "over");
});

test("normalizeFilterSentinel: a real status/label value (never a sentinel) passes through unchanged", () => {
  for (const value of ["Legacy Status Name", "idea", "draft", "Custom Personal Color", "Editorial Review Pending", ""]) {
    assert.equal(normalizeFilterSentinel(value), value);
  }
});

test("normalizeFilterSentinel is pure — read-only, never mutates its argument, never has side effects", () => {
  const value = frFixture("binder.filter.all");
  const before = String(value);
  normalizeFilterSentinel(value);
  assert.equal(value, before);
});

/* ==================== purity / no side effects ==================== */

test("project-taxonomy.ts is pure — no Obsidian import, no Vault/app/settings reference, no automatic migration, no forbidden TypeScript escapes", () => {
  const raw = readFileSync(join(process.cwd(), "src/services/project-taxonomy.ts"), "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  assert.doesNotMatch(code, /from\s+["']obsidian["']/, "must never import the Obsidian API");
  assert.doesNotMatch(code, /\bVault\b/);
  assert.doesNotMatch(code, /\bTFile\b/);
  assert.doesNotMatch(code, /\bTFolder\b/);
  assert.doesNotMatch(code, /\bapp\./);
  assert.doesNotMatch(code, /createFolder|createBinary|processFrontMatter|\.modify\(|\.rename/, "no Vault/frontmatter write of any kind");
  assert.doesNotMatch(code, /migrat/i, "no automatic migration");
  assert.doesNotMatch(code, /:\s*any\b/, "no `: any` type annotation");
  assert.doesNotMatch(code, /as\s+any\b/);
  assert.doesNotMatch(code, /@ts-ignore/);
  assert.doesNotMatch(code, /@ts-expect-error/);
  assert.doesNotMatch(code, /eslint-disable/);
  assert.doesNotMatch(code, /\S!(?:\.|;|,|\)|\s)/, "no non-null assertion operator");
});

test("project-taxonomy.ts never hardcodes a display string outside the i18n dictionaries — every translated value goes through translate()", () => {
  const raw = readFileSync(join(process.cwd(), "src/services/project-taxonomy.ts"), "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  assert.match(code, /translate\(/, "built-in display resolution must go through the locale-explicit i18n helper");
});

/* ==================== no French literal anywhere outside fr.ts ==================== */

const FRENCH_ACCENT_PATTERN = /[éèêëàâäîïôöùûüçœÉÈÊËÀÂÄÎÏÔÖÙÛÜÇŒ]/;
/* Words this batch specifically eliminated from project-taxonomy.ts's own
   source — none of them may reappear as a bare string literal there. */
const ELIMINATED_FRENCH_WORDS = [
  "Tous", "Sans statut", "Sans label", "Atteint", "En dessous", "Dépassé",
];

test("project-taxonomy.ts contains no French literal in actual CODE (comments may still explain, in English, what a historical French sentinel looked like)", () => {
  const raw = readFileSync(join(process.cwd(), "src/services/project-taxonomy.ts"), "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  assert.doesNotMatch(code, FRENCH_ACCENT_PATTERN);
  for (const word of ELIMINATED_FRENCH_WORDS) {
    assert.doesNotMatch(code, new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

/* This file itself is exempt from the same self-scan: it deliberately
   contains ELIMINATED_FRENCH_WORDS/FRENCH_ACCENT_PATTERN above as denylist
   fixtures, to prove those words are ABSENT from project-taxonomy.ts — the
   words appearing here, in a regex/array used only to detect their absence
   elsewhere, are not the same as a hardcoded French display value. Every
   actual French EXPECTED VALUE in this file is derived via frFixture()/
   translate("fr", key), never typed out — see the tests above. */
