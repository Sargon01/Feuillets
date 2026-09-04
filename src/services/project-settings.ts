import type { App } from "obsidian";
import { getProjectFolder } from "./folder-structure.js";
import { knownProjectType, resolveType } from "../utils/project-modes.js";

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
