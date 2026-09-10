import type { App } from "obsidian";
import { getLocale } from "../i18n/index.js";
import { fmOf, writeLogicalFrontmatterField } from "../services/frontmatter.js";

type DefaultStatusLocale = ReturnType<typeof getLocale>;

/** (atendev) fr/en pairs for the built-in default statuses only — the sole
 * source of truth for auto-renaming on locale change. Anything not listed
 * here (deleted, renamed, or user-added statuses) is left untouched. */
const DEFAULT_STATUS_PAIRS: { fr: string; en: string }[] = [
  { fr: "Idée", en: "Idea" },
  { fr: "Brouillon", en: "Draft" },
  { fr: "En cours", en: "In Progress" },
  { fr: "Révisé", en: "Revised" },
  { fr: "Terminé", en: "Done" },
];

/** (atendev) One rename applied by reconcile, for migrating note frontmatter too. */
export type StatusRename = { from: string; to: string };

function targetNameFor(name: string, locale: DefaultStatusLocale): string | null {
  const pair = DEFAULT_STATUS_PAIRS.find((p) => p.fr === name || p.en === name);
  if (!pair) return null;
  const target = locale === "fr" ? pair.fr : pair.en;
  return target === name ? null : target;
}

/** (atendev) Renames known default statuses in `statuses` to match `locale`, in place,
 * pushing each rename to `renames` if given. Returns true if anything changed. */
export function reconcileDefaultStatusNames(
  statuses: ProjectStatusEntry[] | null | undefined,
  locale: DefaultStatusLocale,
  renames?: StatusRename[]
): boolean {
  if (!Array.isArray(statuses)) return false;
  let changed = false;
  for (const entry of statuses) {
    if (!entry || typeof entry.name !== "string") continue;
    const target = targetNameFor(entry.name, locale);
    if (target) {
      renames?.push({ from: entry.name, to: target });
      entry.name = target;
      changed = true;
    }
  }
  return changed;
}

/** (atendev) Reconciles the global status list and every per-project override to the
 * active locale. Returns the deduplicated renames applied, for the caller to persist
 * and pass to migrateStatusFrontmatterValues. */
export function reconcileAllDefaultStatusNames(settings: FeuilletsSettings): StatusRename[] {
  const locale = getLocale();
  const renames: StatusRename[] = [];
  reconcileDefaultStatusNames(settings.statuses, locale, renames);
  const projectMeta = settings.projectMeta || {};
  for (const path of Object.keys(projectMeta)) {
    reconcileDefaultStatusNames(projectMeta[path]?.statuses, locale, renames);
  }
  const seen = new Set<string>();
  return renames.filter((r) => {
    const key = `${r.from} ${r.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** (atendev) reconcileAllDefaultStatusNames only renames the settings entries, leaving
 * notes on the old localized value (breaks color/filter/picker matching by exact name,
 * see getStatusColor in constants.ts). Rewrites `status` on every note whose value
 * exactly matches one of `renames`; anything else is left alone. */
export async function migrateStatusFrontmatterValues(
  app: App,
  settings: FeuilletsSettings,
  renames: StatusRename[]
): Promise<void> {
  if (renames.length === 0) return;
  const targetByOldName = new Map(renames.map((r) => [r.from, r.to]));
  for (const file of app.vault.getMarkdownFiles()) {
    const current = fmOf(app, file, settings).status;
    if (typeof current !== "string") continue;
    const target = targetByOldName.get(current);
    if (target) await writeLogicalFrontmatterField(app, settings, file, "status", target);
  }
}
