import { getLocale } from "../i18n/index.js";

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

function targetNameFor(name: string, locale: DefaultStatusLocale): string | null {
  const pair = DEFAULT_STATUS_PAIRS.find((p) => p.fr === name || p.en === name);
  if (!pair) return null;
  const target = locale === "fr" ? pair.fr : pair.en;
  return target === name ? null : target;
}

/** (atendev) Renames known default statuses in `statuses` to match `locale`, in place. Returns true if anything changed. */
export function reconcileDefaultStatusNames(
  statuses: ProjectStatusEntry[] | null | undefined,
  locale: DefaultStatusLocale
): boolean {
  if (!Array.isArray(statuses)) return false;
  let changed = false;
  for (const entry of statuses) {
    if (!entry || typeof entry.name !== "string") continue;
    const target = targetNameFor(entry.name, locale);
    if (target) {
      entry.name = target;
      changed = true;
    }
  }
  return changed;
}

/** (atendev) Reconciles the global status list and every per-project override to the active locale. Returns true if anything changed, so the caller can persist. */
export function reconcileAllDefaultStatusNames(settings: FeuilletsSettings): boolean {
  const locale = getLocale();
  let changed = reconcileDefaultStatusNames(settings.statuses, locale);
  const projectMeta = settings.projectMeta || {};
  for (const path of Object.keys(projectMeta)) {
    if (reconcileDefaultStatusNames(projectMeta[path]?.statuses, locale)) changed = true;
  }
  return changed;
}
