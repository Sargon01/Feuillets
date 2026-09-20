import { translate, getLocale, type Locale } from "../i18n/index.js";

/**
 * Stable-identity layer for built-in statuses, labels, and filter
 * sentinels. Pure: no Obsidian import, no Vault/settings access, no
 * mutable global state, no automatic migration — this module never reads
 * or writes anything, it only maps ids <-> colors <-> translated display
 * labels.
 *
 * Existing settings entries shaped `{ name, color }` are legacy/custom:
 * `name` is real user data, displayed and stored EXACTLY as typed, never
 * translated, renamed, or rewritten. New built-in entries are shaped
 * `{ id, color }`: `id` is the stable, never-translated identity, and its
 * display is resolved here via `translate(locale, key)` — never a
 * hardcoded French or English string beyond the dictionary keys
 * themselves (src/i18n/en.ts, src/i18n/fr.ts).
 */

const BUILTIN_STATUS_LIST = [
  { id: "idea", color: "#8a8a8a", key: "taxonomy.status.idea" },
  { id: "draft", color: "#e08f4f", key: "taxonomy.status.draft" },
  { id: "in_progress", color: "#d9c04a", key: "taxonomy.status.in_progress" },
  { id: "revised", color: "#5a8fd9", key: "taxonomy.status.revised" },
  { id: "complete", color: "#5aa564", key: "taxonomy.status.complete" },
] as const;

const BUILTIN_LABEL_LIST = [
  { id: "red", color: "#e0524f", key: "taxonomy.label.red" },
  { id: "orange", color: "#e08f4f", key: "taxonomy.label.orange" },
  { id: "yellow", color: "#d9c04a", key: "taxonomy.label.yellow" },
  { id: "green", color: "#5aa564", key: "taxonomy.label.green" },
  { id: "blue", color: "#5a8fd9", key: "taxonomy.label.blue" },
  { id: "purple", color: "#9a6dd7", key: "taxonomy.label.purple" },
] as const;

export type BuiltinStatusId = (typeof BUILTIN_STATUS_LIST)[number]["id"];
export type BuiltinLabelId = (typeof BUILTIN_LABEL_LIST)[number]["id"];
export type FilterSentinelId = "all" | "none";
export type ProgressFilterId = "all" | "hit" | "under" | "over";

/** Minimal shape shared by ProjectStatusEntry and Label (src/types.d.ts) —
 * declared locally so this module depends on nothing beyond what it truly
 * needs. `id` marks a built-in entry, `name` a legacy/custom one; a valid
 * entry has at most one of the two, though callers are never required to
 * enforce that here. */
export type TaxonomyEntry = { id?: string; name?: string; color: string };

export function isBuiltinStatusId(id: string): id is BuiltinStatusId {
  return BUILTIN_STATUS_LIST.some((entry) => entry.id === id);
}

export function isBuiltinLabelId(id: string): id is BuiltinLabelId {
  return BUILTIN_LABEL_LIST.some((entry) => entry.id === id);
}

function statusCatalogEntry(id: BuiltinStatusId): (typeof BUILTIN_STATUS_LIST)[number] {
  return BUILTIN_STATUS_LIST.find((entry) => entry.id === id) ?? BUILTIN_STATUS_LIST[0];
}

function labelCatalogEntry(id: BuiltinLabelId): (typeof BUILTIN_LABEL_LIST)[number] {
  return BUILTIN_LABEL_LIST.find((entry) => entry.id === id) ?? BUILTIN_LABEL_LIST[0];
}

export function builtinStatusColor(id: BuiltinStatusId): string {
  return statusCatalogEntry(id).color;
}

export function builtinLabelColor(id: BuiltinLabelId): string {
  return labelCatalogEntry(id).color;
}

export function builtinStatusKey(id: BuiltinStatusId): string {
  return statusCatalogEntry(id).key;
}

export function builtinLabelKey(id: BuiltinLabelId): string {
  return labelCatalogEntry(id).key;
}

/** All built-in status ids, in their canonical display order. */
export function builtinStatusIds(): readonly BuiltinStatusId[] {
  return BUILTIN_STATUS_LIST.map((entry) => entry.id);
}

/** All built-in label ids, in their canonical display order. */
export function builtinLabelIds(): readonly BuiltinLabelId[] {
  return BUILTIN_LABEL_LIST.map((entry) => entry.id);
}

/** Display label of a status entry: the translated built-in name for a
 * stable id, or the stored `name` unchanged for a legacy/custom entry —
 * never translated, never rewritten. Defaults to the active global
 * locale when none is given, for call sites that already read `t()`. */
export function statusDisplayLabel(entry: TaxonomyEntry, locale: Locale = getLocale()): string {
  if (entry.id && isBuiltinStatusId(entry.id)) return translate(locale, builtinStatusKey(entry.id));
  return entry.name || "";
}

/** Display label of a label entry — see statusDisplayLabel. */
export function labelDisplayLabel(entry: TaxonomyEntry, locale: Locale = getLocale()): string {
  if (entry.id && isBuiltinLabelId(entry.id)) return translate(locale, builtinLabelKey(entry.id));
  return entry.name || "";
}

/** The value that identifies a status entry for storage and
 * frontmatter/filter comparison: the stable id for a built-in entry, the
 * literal `name` for a legacy/custom entry. */
export function statusStoredValue(entry: TaxonomyEntry): string {
  if (entry.id && isBuiltinStatusId(entry.id)) return entry.id;
  return entry.name || "";
}

/** The value that identifies a label entry for storage/comparison — see
 * statusStoredValue. */
export function labelStoredValue(entry: TaxonomyEntry): string {
  if (entry.id && isBuiltinLabelId(entry.id)) return entry.id;
  return entry.name || "";
}

/** Default catalog entries for brand-new installs (src/default-
 * settings.ts). `id`/`color` are the authoritative built-in identity;
 * `name` is a plain English fallback (`translate("en", key)`, never
 * itself hardcoded) kept only so a settings surface that still reads
 * `.name` directly shows a real word instead of a blank field — it is
 * never re-translated and never rewritten once saved. Taxonomy-aware code
 * always prefers `id` over this fallback. */
export function builtinStatusDefaults(): Array<{ id: BuiltinStatusId; name: string; color: string }> {
  return BUILTIN_STATUS_LIST.map((entry) => ({
    id: entry.id,
    name: translate("en", entry.key),
    color: entry.color,
  }));
}

/** Default label catalog entries for brand-new installs — see
 * builtinStatusDefaults. */
export function builtinLabelDefaults(): Array<{ id: BuiltinLabelId; name: string; color: string }> {
  return BUILTIN_LABEL_LIST.map((entry) => ({
    id: entry.id,
    name: translate("en", entry.key),
    color: entry.color,
  }));
}

/* ==================== filter sentinels ==================== */

/** Keys whose CURRENT French/English dictionary text is also the historical
 * persisted sentinel — those UI labels were always produced by `t()` on
 * exactly these keys (src/views/board-view.ts, src/views/feuillets-view.ts),
 * so the same keys are the single source of truth for recognizing what was
 * actually written to settings, in either locale. The two "no status"/"no
 * label" dictionary keys both collapse to the single, context-free "none"
 * id: the caller already knows which filter it is normalizing, so the
 * shared id is unambiguous in context. */
const LEGACY_FILTER_SENTINEL_KEYS: ReadonlyArray<{ key: string; id: FilterSentinelId | ProgressFilterId }> = [
  { key: "binder.filter.all", id: "all" },
  { key: "binder.filter.noStatus", id: "none" },
  { key: "binder.filter.noLabel", id: "none" },
  { key: "binder.filter.progressHit", id: "hit" },
  { key: "binder.filter.progressUnder", id: "under" },
  { key: "binder.filter.progressOver", id: "over" },
];

/** Built once at module load from `translate("fr"/"en", key)` — never a
 * hardcoded French or English literal in this module's own source. */
const LEGACY_FILTER_SENTINELS: Readonly<Record<string, FilterSentinelId | ProgressFilterId>> = Object.fromEntries(
  LEGACY_FILTER_SENTINEL_KEYS.flatMap(({ key, id }) => [
    [translate("fr", key), id],
    [translate("en", key), id],
  ])
);

const STABLE_FILTER_SENTINEL_IDS: ReadonlySet<string> = new Set(["all", "none", "hit", "under", "over"]);

/** Normalizes any stored filter sentinel — a legacy French word, its
 * legacy English equivalent, or an already-stable id — into the stable
 * id. A value that is none of these (a real status/label name or value
 * chosen by the user) is returned UNCHANGED. Pure: reads nothing from
 * settings, writes nothing — callers decide whether/what to persist. */
export function normalizeFilterSentinel(value: string): string {
  if (STABLE_FILTER_SENTINEL_IDS.has(value)) return value;
  return LEGACY_FILTER_SENTINELS[value] ?? value;
}
