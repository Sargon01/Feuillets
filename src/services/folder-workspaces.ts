import { folderPathToRelativeScope, relativeScopeToFolderPath } from "../carnet/core/folder-carnets.js";

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
