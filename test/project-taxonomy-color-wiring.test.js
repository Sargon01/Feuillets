import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { translate } from "../src/i18n/index.js";
import { workspaceStatusColor, workspaceLabelColor } from "../src/services/folder-workspaces.js";
import { labelColor as frontmatterLabelColor } from "../src/services/frontmatter.js";
import { builtinStatusDefaults, builtinLabelDefaults, builtinStatusColor, builtinLabelColor } from "../src/services/project-taxonomy.js";

/* Closes the color/label-lookup blocker: workspaceStatusColor/
 * workspaceLabelColor (folder-workspaces.ts) — and the standalone
 * frontmatter.ts labelColor found by the same audit — used to compare the
 * raw stored value against entry.name, so a freshly assigned built-in id
 * ("draft"/"red") never matched its own catalog entry's English-fallback
 * `name` ("Draft"/"Red") and its configured color never resolved. They now
 * compare through statusStoredValue/labelStoredValue instead.
 *
 * No fake Obsidian app/vault is needed: passing `folder: null` makes
 * workspaceValueContext short-circuit (see folder-workspaces.ts
 * workspaceValueContext — it requires a truthy folder), so
 * workspaceStatuses/workspaceLabels fall straight through to the plain
 * settings.statuses/settings.labels arrays — the exact same trick already
 * used by test/project-taxonomy-settings.test.js.
 */

function readSource(relativePath) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const FAKE_APP = {};

function settingsWith(statuses, labels) {
  return { statuses, labels, projectFolder: "", projectMeta: {} };
}

/** The doc comment immediately preceding `anchor` in `source` — found by
 * searching backward from `anchor` for the closest `/**`, never forward
 * from the start of the file (a lazy `[\s\S]*?` match starting at index 0
 * would instead capture everything from the file's FIRST doc comment
 * onward, sweeping in unrelated pre-existing content this batch never
 * touched). */
function docCommentBefore(source, anchor) {
  const anchorIndex = source.indexOf(anchor);
  assert.notEqual(anchorIndex, -1, `anchor not found: ${anchor}`);
  const windowStart = Math.max(0, anchorIndex - 1000);
  const window = source.slice(windowStart, anchorIndex);
  const commentStart = window.lastIndexOf("/**");
  assert.notEqual(commentStart, -1, `no doc comment found before: ${anchor}`);
  return window.slice(commentStart);
}

/* ==================== built-in ids resolve their configured color ==================== */

test("workspaceStatusColor resolves a built-in \"draft\" status's configured color through the real workspace lookup path", () => {
  const settings = settingsWith(builtinStatusDefaults(), []);
  assert.equal(workspaceStatusColor(FAKE_APP, settings, null, "draft"), builtinStatusColor("draft"));
});

test("workspaceLabelColor resolves a built-in \"red\" label's configured color through the real workspace lookup path", () => {
  const settings = settingsWith([], builtinLabelDefaults());
  assert.equal(workspaceLabelColor(FAKE_APP, settings, null, "red"), builtinLabelColor("red"));
});

test("workspaceStatusColor/workspaceLabelColor never match a built-in entry by its English-fallback display name — only by its stable id", () => {
  const settings = settingsWith(builtinStatusDefaults(), builtinLabelDefaults());
  assert.equal(workspaceStatusColor(FAKE_APP, settings, null, "Draft"), null, "the English display name is not the stored value");
  assert.equal(workspaceLabelColor(FAKE_APP, settings, null, "Red"), null);
});

/* ==================== legacy/custom entries: unaffected ==================== */

test("workspaceStatusColor/workspaceLabelColor still resolve a legacy/custom entry's color by its exact stored name", () => {
  const settings = settingsWith(
    [{ name: "Legacy Status Name", color: "#123abc" }],
    [{ name: "Custom Label Name", color: "#abc123" }],
  );
  assert.equal(workspaceStatusColor(FAKE_APP, settings, null, "Legacy Status Name"), "#123abc");
  assert.equal(workspaceLabelColor(FAKE_APP, settings, null, "Custom Label Name"), "#abc123");
});

test("workspaceStatusColor/workspaceLabelColor still resolve a historical French-named entry's color by its exact stored name", () => {
  // The pre-batch DEFAULT_SETTINGS shipped statuses/labels named exactly
  // like this ({ name: "<French word>", color }); the historical persisted
  // name is derived from the dictionary (translate("fr", key)) rather than
  // hardcoded here, but it is byte-for-byte the same string an existing
  // data.json actually stores.
  const legacyDraftName = translate("fr", "taxonomy.status.draft");
  const legacyRedName = translate("fr", "taxonomy.label.red");
  const settings = settingsWith(
    [{ name: legacyDraftName, color: "#e08f4f" }],
    [{ name: legacyRedName, color: "#e0524f" }],
  );
  assert.equal(workspaceStatusColor(FAKE_APP, settings, null, legacyDraftName), "#e08f4f");
  assert.equal(workspaceLabelColor(FAKE_APP, settings, null, legacyRedName), "#e0524f");
});

/* ==================== plugin.getStatusColor/plugin.labelColor (main.ts) ==================== */

test("main.ts's getStatusColor/labelColor delegate unchanged to workspaceStatusColor/workspaceLabelColor — the fix in folder-workspaces.ts reaches them with no wrapper logic to duplicate", () => {
  const source = readSource("src/main.ts");
  assert.match(source, /labelColor\(name: string, folder\?: TFolder \| null\): string \| null \{[\s\S]{0,200}return workspaceLabelColor\(this\.app, this\.settings, context, name\);/);
  assert.match(source, /getStatusColor\(name: string, folder\?: TFolder \| null\): string \| null \{[\s\S]{0,200}return workspaceStatusColor\(this\.app, this\.settings, context, name\);/);
});

test("plugin.labelOf (main.ts) returns the raw stored frontmatter value unchanged — never compares against entry.name, so it needs no taxonomy-aware fix", () => {
  const source = readSource("src/main.ts");
  assert.match(source, /labelOf\(file: TFile\): string \{ return labelOf\(this\.app, file\); \}/);
});

/* ==================== frontmatter.ts's standalone labelColor (found by the same rg audit) ==================== */

test("frontmatter.ts's labelColor resolves a built-in label's color by stable id, never by its English-fallback display name", () => {
  const settings = { projectFolder: "", projectMeta: null, labels: builtinLabelDefaults() };
  assert.equal(frontmatterLabelColor(settings, "red"), builtinLabelColor("red"));
  // "Red" (the English display name) is not the stored value: it falls
  // through to labelColor's own deterministic hash-based fallback (see its
  // own doc comment), never the built-in entry's actual configured color.
  assert.notEqual(frontmatterLabelColor(settings, "Red"), builtinLabelColor("red"));
});

test("frontmatter.ts's labelColor still resolves a legacy/custom label's color by its exact stored name", () => {
  const legacySettings = { projectFolder: "", projectMeta: null, labels: [{ name: "Custom Label Name", color: "#abc123" }] };
  assert.equal(frontmatterLabelColor(legacySettings, "Custom Label Name"), "#abc123");
});

/* ==================== folder-workspace-modal.ts: per-folder rename UI ==================== */

test("folder-workspace-modal.ts's status/label rename rows display the translated name and fork a built-in entry on rename, like project-config-content.ts", () => {
  const source = readSource("src/ui/folder-workspace-modal.ts");
  assert.match(source, /statusDisplayLabel\(status, getLocale\(\)\)/);
  assert.match(source, /labelDisplayLabel\(label, getLocale\(\)\)/);
  const forkOccurrences = source.match(/delete next\[index\]\.id;/g) || [];
  assert.equal(forkOccurrences.length, 2, "once for the status rows, once for the label rows");
  assert.doesNotMatch(source, /text\.setValue\(status\.name/, "no remaining raw .name used as the displayed value");
  assert.doesNotMatch(source, /text\.setValue\(label\.name\)/, "no remaining raw .name used as the displayed value");
});

/* ==================== no French literal in the newly changed parts of these files ==================== */

test("no French literal or French comment was introduced in the color/label-lookup fix (folder-workspaces.ts, frontmatter.ts, folder-workspace-modal.ts, types.d.ts)", () => {
  const FRENCH_ACCENT_PATTERN = /[éèêëàâäîïôöùûüçœÉÈÊËÀÂÄÎÏÔÖÙÛÜÇŒ]/;
  const checks = [
    { file: "src/services/folder-workspaces.ts", near: /export function workspaceStatusColor[\s\S]{0,400}export function workspaceLabelColor[\s\S]{0,300}/ },
    { file: "src/services/frontmatter.ts", near: /export function labelColor[\s\S]{0,400}/ },
    { file: "src/ui/folder-workspace-modal.ts", near: /statusDisplayLabel\(status, getLocale\(\)\)[\s\S]{0,300}/ },
  ];
  for (const { file, near } of checks) {
    const source = readSource(file);
    const match = source.match(near);
    assert.ok(match, `${file}: expected code block not found`);
    assert.doesNotMatch(match[0], FRENCH_ACCENT_PATTERN, `${file}: French accented character found in the newly changed block`);
  }
  // types.d.ts: the Label/ProjectStatusEntry JSDoc this batch rewrote.
  const typesSource = readSource("src/types.d.ts");
  assert.doesNotMatch(docCommentBefore(typesSource, "declare type Label = {"), FRENCH_ACCENT_PATTERN);
  assert.doesNotMatch(docCommentBefore(typesSource, "declare type ProjectStatusEntry = {"), FRENCH_ACCENT_PATTERN);
});

test("board-view.ts's filterSentinelLabel doc comment is English", () => {
  const source = readSource("src/views/board-view.ts");
  const doc = docCommentBefore(source, "filterSentinelLabel(v: string, noneKey?: string): string {");
  assert.doesNotMatch(doc, /[éèêëàâäîïôöùûüçœÉÈÊËÀÂÄÎÏÔÖÙÛÜÇŒ]/);
});
