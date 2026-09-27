import type { App } from "obsidian";
import { getProjectFolder } from "./folder-structure.js";
import { knownProjectType, resolveType } from "../utils/project-modes.js";
import { translate } from "../i18n/index.js";
import { builtinLabelKey, legacyBuiltinLabelId, legacyBuiltinStatusId } from "./project-taxonomy.js";

export function migrateLegacyProjectTypes(settings: FeuilletsSettings): number {
  const paths = new Set<string>();
  for (const path of Object.keys(settings.projectMeta)) paths.add(path);
  for (const path of settings.projects) paths.add(path);
  if (settings.projectFolder) paths.add(settings.projectFolder);

  let migrated = 0;
  for (const path of paths) {
    if (!settings.projectMeta[path]) settings.projectMeta[path] = {};
    const meta = settings.projectMeta[path];
    if (knownProjectType(meta.type) === null) {
      meta.type = "fiction";
      migrated += 1;
    }
  }
  return migrated;
}

/** Migrates one legacy `{ name, color }` status entry to `{ id, color }`
 * when `legacyBuiltinStatusId` (project-taxonomy.ts) positively identifies
 * it as an old built-in — returns the SAME object reference unchanged
 * otherwise (a genuine custom status, or an already-migrated `{ id }`
 * entry), so callers can detect "did anything change" via `!==`. `name` is
 * dropped on migration: `ProjectStatusEntry.name` is optional, and display/
 * storage for a built-in `id` never reads it (statusDisplayLabel,
 * project-taxonomy.ts). */
function migrateStatusEntry(entry: ProjectStatusEntry): ProjectStatusEntry {
  const id = legacyBuiltinStatusId(entry);
  return id ? { id, color: entry.color } : entry;
}

/** Migrates one legacy `{ name, color }` label entry to `{ id, color }` —
 * see migrateStatusEntry. Unlike `ProjectStatusEntry`, `Label.name` is
 * REQUIRED (types.d.ts): a migrated built-in keeps an English compatibility
 * `name` fallback, exactly like a brand-new install's own defaults
 * (builtinLabelDefaults, project-taxonomy.ts) — never re-read for display
 * (labelDisplayLabel resolves through `id`), kept only for a surface that
 * still reads `.name` directly. */
function migrateLabelEntry(entry: Label): Label {
  const id = legacyBuiltinLabelId(entry);
  return id ? { id, name: translate("en", builtinLabelKey(id)), color: entry.color } : entry;
}

/** Migrates a whole array of legacy entries via `migrate`, returning the
 * SAME array reference (never a needless copy) when nothing changed. */
function migrateEntries<T extends { id?: string; name?: string; color: string }>(
  entries: T[],
  migrate: (entry: T) => T
): { entries: T[]; changed: boolean } {
  let changed = false;
  const migrated = entries.map((entry) => {
    const next = migrate(entry);
    if (next !== entry) changed = true;
    return next;
  });
  return changed ? { entries: migrated, changed: true } : { entries, changed: false };
}

/** Migrates legacy `{ name, color }` built-in statuses/labels to their
 * stable `{ id, color }` form — at BOTH `settings.statuses`/`settings.labels`
 * and, only where they already exist, every `projectMeta[path].statuses`/
 * `.labels` override. Never creates a project override that did not already
 * exist (a `ProjectMeta` with no `statuses`/`labels` array stays exactly
 * that way). A genuine custom entry — one `legacyBuiltinStatusId`/
 * `legacyBuiltinLabelId` cannot positively identify as an old built-in — is
 * never modified. Idempotent: re-running this against already-migrated
 * settings changes nothing and returns `false`.
 *
 * Returns whether anything actually changed, so the caller (main.ts's
 * `loadSettings()`) only persists settings when this migration itself did
 * something — never on every plugin load. */
export function migrateLegacyTaxonomyEntries(settings: FeuilletsSettings): boolean {
  let changed = false;

  const statuses = migrateEntries(settings.statuses, migrateStatusEntry);
  if (statuses.changed) {
    settings.statuses = statuses.entries;
    changed = true;
  }

  const labels = migrateEntries(settings.labels, migrateLabelEntry);
  if (labels.changed) {
    settings.labels = labels.entries;
    changed = true;
  }

  for (const meta of Object.values(settings.projectMeta)) {
    if (!meta) continue;
    if (Array.isArray(meta.statuses)) {
      const result = migrateEntries(meta.statuses, migrateStatusEntry);
      if (result.changed) {
        meta.statuses = result.entries;
        changed = true;
      }
    }
    if (Array.isArray(meta.labels)) {
      const result = migrateEntries(meta.labels, migrateLabelEntry);
      if (result.changed) {
        meta.labels = result.entries;
        changed = true;
      }
    }
  }

  return changed;
}

export type ProjectPlanningField = "synopsis" | "summary";

export function planningFieldForProjectType(type: string | null | undefined): ProjectPlanningField {
  return resolveType(type) === "fiction" ? "synopsis" : "summary";
}

export function newSheetIncludeSourcesForProjectType(type: string | null | undefined): boolean {
  return resolveType(type) !== "fiction";
}

/** Résolution centralisée des réglages « projet actif », voir chantier
 * « panneau Projet + métadonnées + mapping YAML ». Chaque champ suit le
 * même contrat : `ProjectMeta` du projet actif SI RENSEIGNÉ, sinon le
 * réglage global historique (`settings.<champ>`), qui reste donc le repli
 * legacy pour tous les projets déjà créés.
 *
 * Ces fonctions ne LISENT que — jamais d'écriture, jamais de clonage.
 * Le clonage « au premier réglage modifié » (statuts, labels, etc.) est la
 * responsabilité du panneau Projet (views/sidebar-feuillets-view.ts), pas
 * de ce module : ouvrir/lire ne doit jamais faire apparaître une surcharge
 * de projet qui n'existe pas encore dans data.json. */

/** ProjectMeta du projet actif, ou `null` s'il n'y a pas de projet actif ou
 * pas encore de fiche pour lui (`settings.projectMeta[root.path]` absent —
 * état normal, voir types.d.ts ProjectMeta). */
export function activeProjectMeta(app: App, settings: FeuilletsSettings): ProjectMeta | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  return (settings.projectMeta && settings.projectMeta[root.path]) || null;
}

export function projectPlanningField(app: App, settings: FeuilletsSettings): ProjectPlanningField {
  const meta = activeProjectMeta(app, settings);
  if (meta?.planningField === "synopsis" || meta?.planningField === "summary") return meta.planningField;
  return planningFieldForProjectType(meta?.type);
}

export function projectNewSheetIncludeSources(app: App, settings: FeuilletsSettings): boolean {
  const meta = activeProjectMeta(app, settings);
  if (typeof meta?.newSheetIncludeSources === "boolean") return meta.newSheetIncludeSources;
  return newSheetIncludeSourcesForProjectType(meta?.type);
}

export function projectStatuses(app: App, settings: FeuilletsSettings): ProjectStatusEntry[] {
  const meta = activeProjectMeta(app, settings);
  if (meta && Array.isArray(meta.statuses)) return meta.statuses;
  return Array.isArray(settings.statuses) ? settings.statuses : [];
}

export function projectFavoriteTags(app: App, settings: FeuilletsSettings): string[] {
  const meta = activeProjectMeta(app, settings);
  if (meta && Array.isArray(meta.favoriteTags)) return meta.favoriteTags;
  return Array.isArray(settings.favoriteTags) ? settings.favoriteTags : [];
}

export function projectLabels(app: App, settings: FeuilletsSettings): Label[] {
  const meta = activeProjectMeta(app, settings);
  if (meta && Array.isArray(meta.labels)) return meta.labels;
  return Array.isArray(settings.labels) ? settings.labels : [];
}

/** Objectif de mots par défaut d'UN feuillet (pas le total du manuscrit —
 * voir projectTotalWordGoal). */
export function projectWordGoalDefault(app: App, settings: FeuilletsSettings): number {
  const meta = activeProjectMeta(app, settings);
  if (meta && typeof meta.wordGoal === "number") return meta.wordGoal;
  return settings.wordGoal;
}

export function projectTolerance(app: App, settings: FeuilletsSettings): number {
  const meta = activeProjectMeta(app, settings);
  if (meta && typeof meta.tolerance === "number") return meta.tolerance;
  return Number(settings.tolerance);
}

/** Objectif total de mots du MANUSCRIT entier (pas le défaut par feuillet —
 * voir projectWordGoalDefault). */
export function projectTotalWordGoal(app: App, settings: FeuilletsSettings): number {
  const meta = activeProjectMeta(app, settings);
  if (meta && typeof meta.projectWordGoal === "number") return meta.projectWordGoal;
  return typeof settings.projectWordGoal === "number" ? settings.projectWordGoal : 0;
}

export function projectDeadline(app: App, settings: FeuilletsSettings): string {
  const meta = activeProjectMeta(app, settings);
  if (meta && typeof meta.deadlineDate === "string") return meta.deadlineDate;
  return typeof settings.deadlineDate === "string" ? settings.deadlineDate : "";
}

export function projectSessionGoal(app: App, settings: FeuilletsSettings): number {
  const meta = activeProjectMeta(app, settings);
  if (meta && typeof meta.sessionGoal === "number") return meta.sessionGoal;
  return typeof settings.sessionGoal === "number" ? settings.sessionGoal : 0;
}
