import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { translate } from "../src/i18n/index.js";

/* Confirms board-view.ts, feuillets-view.ts, and base-feuillets-view.ts
 * actually route every status/label/progress filter comparison, menu
 * construction, and assignment path through statusStoredValue/
 * labelStoredValue/statusDisplayLabel/labelDisplayLabel/
 * normalizeFilterSentinel (src/services/project-taxonomy.ts) — a source-
 * level check, the same technique already used by this repo for this kind
 * of wiring (see test/project-config-focus.test.js).
 *
 * No French literal (not even inside a regex denylist pattern) is
 * hardcoded in this file: every legacy sentinel string used to build a
 * detection pattern is derived from translate("fr"/"en", key), never typed
 * out. POV filtering is out of scope for this batch and is not covered by
 * this file's checks.
 */

function readSource(relativePath) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FR_ALL = translate("fr", "binder.filter.all");

for (const file of ["src/views/board-view.ts", "src/views/feuillets-view.ts"]) {
  test(`${file} imports normalizeFilterSentinel from project-taxonomy.ts`, () => {
    const source = readSource(file);
    assert.match(source, /normalizeFilterSentinel/);
    assert.match(source, /from\s+["']\.\.\/services\/project-taxonomy\.js["']/);
  });

  test(`${file} defaults status/label/progress filters to the stable "all" id, never the legacy French sentinel`, () => {
    const source = readSource(file);
    const legacyAssignment = new RegExp(`=\\s*"${escapeForRegex(FR_ALL)}"`);
    assert.doesNotMatch(source, new RegExp(`S\\.statusFilter\\s*${legacyAssignment.source}`));
    assert.doesNotMatch(source, new RegExp(`S\\.labelFilter\\s*${legacyAssignment.source}`));
    assert.doesNotMatch(source, new RegExp(`S\\.progressFilter\\s*${legacyAssignment.source}`));
    assert.doesNotMatch(source, new RegExp(`S\\.binderStatusFilter\\s*${legacyAssignment.source}`));
    assert.doesNotMatch(source, new RegExp(`S\\.binderLabelFilter\\s*${legacyAssignment.source}`));
    assert.doesNotMatch(source, new RegExp(`S\\.binderProgressFilter\\s*${legacyAssignment.source}`));
  });

  test(`${file} builds its status/label/progress menu loops over the stable "all"/"none" ids`, () => {
    const source = readSource(file);
    assert.match(source, /\[\s*"all"[\s\S]{0,80}"none"/, "the status/label loops must iterate from \"all\" through to \"none\"");
    assert.match(source, /\[\s*"all",\s*"hit",\s*"under",\s*"over"\]/, "the progress loop must iterate the four stable ids exactly");
  });

  test(`${file} builds its status/label loop values through statusStoredValue/labelStoredValue, never raw .name`, () => {
    const source = readSource(file);
    assert.match(source, /statusStoredValue\(status\)/);
    assert.match(source, /labelStoredValue\(/);
    assert.doesNotMatch(source, /status\.name\?\.trim\(\)/, "no remaining raw .name-based status value");
  });
}

test("board-view.ts's passesFilter/filterActive normalize the stored filter before comparing, for status/label/progress", () => {
  const source = readSource("src/views/board-view.ts");
  assert.match(source, /normalizeFilterSentinel\(S\.statusFilter/);
  assert.match(source, /normalizeFilterSentinel\(S\.labelFilter/);
  assert.match(source, /normalizeFilterSentinel\(S\.progressFilter/);
});

test("feuillets-view.ts's Binder filter predicate normalizes the stored filter before comparing, for status/label/progress", () => {
  const source = readSource("src/views/feuillets-view.ts");
  assert.match(source, /normalizeFilterSentinel\(S\.binderStatusFilter/);
  assert.match(source, /normalizeFilterSentinel\(S\.binderLabelFilter/);
  assert.match(source, /normalizeFilterSentinel\(S\.binderProgressFilter/);
});

test("status/label menu construction never writes a translated display string as the stored filter value — the click handler always stores the plain loop variable", () => {
  for (const file of ["src/views/board-view.ts", "src/views/feuillets-view.ts"]) {
    const source = readSource(file);
    assert.doesNotMatch(source, /S\.(statusFilter|binderStatusFilter)\s*=\s*(t\(|statusDisplayLabel\()/);
    assert.doesNotMatch(source, /S\.(labelFilter|binderLabelFilter)\s*=\s*(t\(|labelDisplayLabel\()/);
  }
});

/* ==================== assignment/frontmatter-writing paths ==================== */

test("board-view.ts's bulk status/label assignment menu applies the stored value, displays the translated label", () => {
  const source = readSource("src/views/board-view.ts");
  assert.match(source, /applyBulkStatus\(files,\s*value\)/, "must apply statusStoredValue's result, never a raw .name");
  assert.match(source, /applyBulkLabel\(files,\s*value\)/);
  assert.match(source, /board\.selection\.statusCount["'],\s*\{\s*status:\s*statusDisplayLabel\(/, "the menu TEXT must be translated");
  assert.match(source, /board\.selection\.labelCount["'],\s*\{\s*label:\s*labelDisplayLabel\(/);
});

test("board-view.ts's card \"more\" status menu and status badge use statusStoredValue/statusDisplayLabel, never raw .name", () => {
  const source = readSource("src/views/board-view.ts");
  assert.match(source, /displayForStoredStatus/, "the card status badge must reverse-look-up its translated display");
  assert.match(source, /setFm\(file,\s*"status",\s*value === currentSt/, "the card menu must write the stored value, never the display text");
});

test("base-feuillets-view.ts's makeStatusSelect/makeLabelSelect build <option> values from statusStoredValue/labelStoredValue, text from statusDisplayLabel/labelDisplayLabel", () => {
  const source = readSource("src/views/base-feuillets-view.ts");
  assert.match(source, /statusStoredValue\(status\)\.trim\(\)/);
  assert.match(source, /labelStoredValue\(l\)/);
  assert.match(source, /text: statusDisplayLabel\(status, getLocale\(\)\)/);
  assert.match(source, /text: labelDisplayLabel\(l, getLocale\(\)\)/);
  assert.doesNotMatch(source, /opt\.value = l\.name;/, "no remaining raw .name used as an <option> value");
  assert.doesNotMatch(source, /opt\.value = s;/, "no remaining raw name-derived string used as an <option> value");
});

test("base-feuillets-view.ts's shared right-click context menu (status/label sections) applies statusStoredValue/labelStoredValue, displays statusDisplayLabel/labelDisplayLabel — for both the file menu and the folder-note menu", () => {
  const source = readSource("src/views/base-feuillets-view.ts");
  const storedStatusOccurrences = source.match(/statusStoredValue\(status\)\.trim\(\)/g) || [];
  const storedLabelOccurrences = source.match(/labelStoredValue\(labelEntry\)\.trim\(\)/g) || [];
  assert.equal(storedStatusOccurrences.length, 3, "makeStatusSelect, the file context menu, and the folder-note context menu");
  assert.equal(storedLabelOccurrences.length, 2, "once for the file context menu, once for the folder-note context menu");
  assert.match(source, /statusDisplayLabel\(status, getLocale\(\)\)/);
  assert.match(source, /labelDisplayLabel\(labelEntry, getLocale\(\)\)/);
  assert.doesNotMatch(source, /status:\s*st\s*\}\)\)/, "the menu item title must never interpolate the raw stored value directly");
});

test("no assignment path anywhere in these three files still reads .name directly off a status/label entry for storage/comparison", () => {
  for (const file of ["src/views/board-view.ts", "src/views/feuillets-view.ts", "src/views/base-feuillets-view.ts"]) {
    const source = readSource(file);
    assert.doesNotMatch(source, /status\.name\b/, `${file}: no remaining status.name`);
    assert.doesNotMatch(source, /\bl\.name\b/, `${file}: no remaining l.name`);
    assert.doesNotMatch(source, /label\.name\b/, `${file}: no remaining label.name`);
  }
});

test("project-config-content.ts's built-in status/label rename forks the entry to a legacy/custom one instead of silently keeping a stale id", () => {
  const source = readSource("src/ui/project-config-content.ts");
  assert.match(source, /delete entry\.id/, "typing a new name must drop the built-in id, exactly twice — once for statuses, once for labels");
  const occurrences = source.match(/delete entry\.id/g) || [];
  assert.equal(occurrences.length, 2);
});

/* This file itself never hardcodes a French literal: the one legacy
   sentinel it needs (FR_ALL, above) is derived via translate("fr", key),
   never typed out — a self-scan is not included here because it would
   have to quote the very accented-character detection pattern it uses
   elsewhere in this file to prove OTHER files clean, which is not the
   same thing as a hardcoded display value (see project-taxonomy.test.js
   for the identical reasoning, applied there to its own denylist). */
