import { folderPathToRelativeScope, relativeScopeToFolderPath } from "../carnet/core/folder-carnets.js";
import type { App, TFolder } from "obsidian";
import { getProjectFolder } from "./folder-structure.js";
import {
  activeProjectMeta,
  projectDeadline,
  projectFavoriteTags,
  projectLabels,
  projectSessionGoal,
  projectStatuses,
  projectTolerance,
  projectTotalWordGoal,
  projectWordGoalDefault,
} from "./project-settings.js";

export type FolderWorkspaceResolution<T> = {
  value: T | undefined;
  source: string | null;
};

/** Convertit un dossier du coffre en clé locale d'un workspace. */
export function folderPathToWorkspaceScope(projectRootPath: string, folderPath: string): string | null {
  return folderPathToRelativeScope(projectRootPath, folderPath);
}

/** Retourne la configuration exacte d'une clé relative, sans jamais la créer. */
export function getFolderWorkspaceConfig(
  meta: ProjectMeta | undefined,
  relativeScope: string,
): FolderWorkspaceConfig | undefined {
  if (!relativeScope || !meta?.folderWorkspaces) return undefined;
  return meta.folderWorkspaces[relativeScope];
}

/** Construit la chaîne dossier → parents, sans inclure le manuscript root. */
export function folderWorkspaceScopeChain(projectRootPath: string, folderPath: string): string[] {
  const relative = folderPathToWorkspaceScope(projectRootPath, folderPath);
  if (!relative) return [];
  const parts = relative.split("/");
  const scopes: string[] = [];
  for (let end = parts.length; end > 0; end -= 1) scopes.push(parts.slice(0, end).join("/"));
  return scopes;
}

/** Résout le premier override défini ; false, 0 et "" sont des valeurs valides. */
export function resolveFolderWorkspaceValue<K extends keyof FolderWorkspaceConfig>(
  meta: ProjectMeta | undefined,
  projectRootPath: string,
  folderPath: string,
  key: K,
  projectValue?: FolderWorkspaceConfig[K],
): FolderWorkspaceResolution<FolderWorkspaceConfig[K]> {
  for (const scope of folderWorkspaceScopeChain(projectRootPath, folderPath)) {
    const config = getFolderWorkspaceConfig(meta, scope);
    if (config && config[key] !== undefined) return { value: config[key], source: scope };
  }
  return { value: projectValue, source: null };
}

/** Vérifie qu'une clé relative désigne bien un dossier du projet. */
export function workspaceScopeToFolderPath(projectRootPath: string, relativeScope: string): string | null {
  return relativeScopeToFolderPath(projectRootPath, relativeScope);
}

function workspaceValueContext(app: App, settings: FeuilletsSettings, folder: TFolder | null): {
  root: TFolder;
  meta: ProjectMeta | undefined;
  folder: TFolder;
} | null {
  const root = getProjectFolder(app, settings);
  if (!root || !folder) return null;
  const relativeScope = folderPathToWorkspaceScope(root.path, folder.path);
  if (!relativeScope) return null;
  return { root, meta: activeProjectMeta(app, settings) || undefined, folder };
}

export function workspaceStatuses(app: App, settings: FeuilletsSettings, folder: TFolder | null): ProjectStatusEntry[] {
  const fallback = projectStatuses(app, settings);
  const context = workspaceValueContext(app, settings, folder);
  if (!context) return fallback;
  const value = resolveFolderWorkspaceValue(context.meta, context.root.path, context.folder.path, "statuses", fallback).value;
  return value === undefined ? fallback : value;
}

export function workspaceLabels(app: App, settings: FeuilletsSettings, folder: TFolder | null): Label[] {
  const fallback = projectLabels(app, settings);
  const context = workspaceValueContext(app, settings, folder);
  if (!context) return fallback;
  const value = resolveFolderWorkspaceValue(context.meta, context.root.path, context.folder.path, "labels", fallback).value;
  return value === undefined ? fallback : value;
}

export function workspaceFavoriteTags(app: App, settings: FeuilletsSettings, folder: TFolder | null): string[] {
  const fallback = projectFavoriteTags(app, settings);
  const context = workspaceValueContext(app, settings, folder);
  if (!context) return fallback;
  const value = resolveFolderWorkspaceValue(context.meta, context.root.path, context.folder.path, "favoriteTags", fallback).value;
  return value === undefined ? fallback : value;
}

export function workspaceWordGoalDefault(app: App, settings: FeuilletsSettings, folder: TFolder | null): number {
  const fallback = projectWordGoalDefault(app, settings);
  const context = workspaceValueContext(app, settings, folder);
  if (!context) return fallback;
  const value = resolveFolderWorkspaceValue(context.meta, context.root.path, context.folder.path, "wordGoal", fallback).value;
  return value === undefined ? fallback : value;
}

export function workspaceTolerance(app: App, settings: FeuilletsSettings, folder: TFolder | null): number {
  const fallback = projectTolerance(app, settings);
  const context = workspaceValueContext(app, settings, folder);
  if (!context) return fallback;
  const value = resolveFolderWorkspaceValue(context.meta, context.root.path, context.folder.path, "tolerance", fallback).value;
  return value === undefined ? fallback : value;
}

export function workspaceTotalWordGoal(app: App, settings: FeuilletsSettings, folder: TFolder | null): number {
  const fallback = projectTotalWordGoal(app, settings);
  const context = workspaceValueContext(app, settings, folder);
  if (!context) return fallback;
  const value = resolveFolderWorkspaceValue(context.meta, context.root.path, context.folder.path, "projectWordGoal", fallback).value;
  return value === undefined ? fallback : value;
}

export function workspaceDeadline(app: App, settings: FeuilletsSettings, folder: TFolder | null): string {
  const fallback = projectDeadline(app, settings);
  const context = workspaceValueContext(app, settings, folder);
  if (!context) return fallback;
  const value = resolveFolderWorkspaceValue(context.meta, context.root.path, context.folder.path, "deadlineDate", fallback).value;
  return value === undefined ? fallback : value;
}

export function workspaceSessionGoal(app: App, settings: FeuilletsSettings, folder: TFolder | null): number {
  const fallback = projectSessionGoal(app, settings);
  const context = workspaceValueContext(app, settings, folder);
  if (!context) return fallback;
  const value = resolveFolderWorkspaceValue(context.meta, context.root.path, context.folder.path, "sessionGoal", fallback).value;
  return value === undefined ? fallback : value;
}

/** Retourne la clé relative qui fournit un override effectif, ou null quand
 * la valeur vient du projet/réglage global. Lecture pure, sans création. */
export function workspaceFieldSource<K extends keyof FolderWorkspaceConfig>(
  app: App,
  settings: FeuilletsSettings,
  folder: TFolder | null,
  key: K,
): string | null {
  const context = workspaceValueContext(app, settings, folder);
  if (!context) return null;
  return resolveFolderWorkspaceValue(context.meta, context.root.path, context.folder.path, key).source;
}

export function workspaceStatusColor(
  app: App,
  settings: FeuilletsSettings,
  folder: TFolder | null,
  name: string,
): string | null {
  const status = workspaceStatuses(app, settings, folder).find((entry) => entry.name === name);
  return status ? status.color : null;
}

export function workspaceLabelColor(
  app: App,
  settings: FeuilletsSettings,
  folder: TFolder | null,
  name: string,
): string | null {
  const label = workspaceLabels(app, settings, folder).find((entry) => entry.name === name);
  return label ? label.color : null;
}
