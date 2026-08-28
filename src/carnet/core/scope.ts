import { normalizePath, TFile, TFolder } from "obsidian";

export type ProjectCarnetScope = { type: "project"; projectRootPath: string; manuscriptRootPath: string };
/** `linkedResearchFolderPath` (§8 du correctif « Carnet logique unique ») :
 * présent uniquement pour le Carnet canonique d'un dossier Binder lié à
 * EXACTEMENT un dossier Recherche (voir folder-carnets.ts,
 * resolveCanonicalFolderCarnetOwner) — `folderPath` reste toujours le
 * propriétaire canonique, jamais le dossier Recherche lui-même. Un Carnet
 * Recherche autonome n'a pas de `linkedResearchFolderPath`. */
export type FolderCarnetScope = { type: "folder"; projectRootPath: string; manuscriptRootPath: string; folderPath: string; linkedResearchFolderPath?: string; recursive: true };
export type CarnetScope = ProjectCarnetScope | FolderCarnetScope;

function clean(path: string): string { return normalizePath(path); }
export function isPathInsideScope(path: string, scope: CarnetScope): boolean {
  const base = scope.type === "folder" ? scope.folderPath : scope.manuscriptRootPath;
  const candidate = clean(path);
  const normalizedBase = clean(base);
  return candidate === normalizedBase || candidate.startsWith(`${normalizedBase}/`);
}
export function createFolderCarnetScope(projectRootPath: string, manuscriptRootPath: string, folderPath: string, linkedResearchFolderPath?: string | null): FolderCarnetScope | null {
  const project = clean(projectRootPath); const folder = clean(folderPath);
  if (!project || folder === project || !folder.startsWith(`${project}/`)) return null;
  const scope: FolderCarnetScope = { type: "folder", projectRootPath: project, manuscriptRootPath: clean(manuscriptRootPath), folderPath: folder, recursive: true };
  if (linkedResearchFolderPath) {
    const linked = clean(linkedResearchFolderPath);
    if (linked !== folder && linked.startsWith(`${project}/`)) scope.linkedResearchFolderPath = linked;
  }
  return scope;
}
export function resolveFolderScope(projectRootPath: string, manuscriptRootPath: string, folder: TFolder, linkedResearchFolder?: TFolder | null): FolderCarnetScope | null {
  return createFolderCarnetScope(projectRootPath, manuscriptRootPath, folder.path, linkedResearchFolder?.path ?? null);
}
/** Fichiers Markdown du scope, jamais un scan du vault entier (§9) :
 * uniquement l'arborescence de `folder`, PLUS celle de `linkedFolder` quand
 * `scope.linkedResearchFolderPath` en fait foi et que `linkedFolder` (fourni
 * par l'appelant, jamais recherché ici) correspond bien à ce chemin.
 * Dédupliqué par `file.path`. Cette union reste un scope de CONTEXTE
 * (lecture) — jamais un droit de mutation du Binder depuis le Carnet. */
export function listScopeMarkdownFiles(scope: FolderCarnetScope, folder: TFolder, linkedFolder?: TFolder | null): TFile[] {
  if (clean(folder.path) !== scope.folderPath) return [];
  const collect = (current: TFolder): TFile[] => current.children.flatMap((child): TFile[] => child instanceof TFile ? (child.extension === "md" ? [child] : []) : child instanceof TFolder ? collect(child) : []);
  const primary = collect(folder);
  if (!scope.linkedResearchFolderPath || !linkedFolder || clean(linkedFolder.path) !== scope.linkedResearchFolderPath) return primary;
  const seen = new Set(primary.map((file) => file.path));
  const extra = collect(linkedFolder).filter((file) => !seen.has(file.path));
  return [...primary, ...extra];
}
