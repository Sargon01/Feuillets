import { TFile, TFolder, normalizePath, type App } from "obsidian";
import { folderPathToRelativeScope } from "../carnet/core/folder-carnets.js";
import { getProjectFolder, getOrderedChildren } from "./folder-structure.js";
import { getResearchRoot } from "./research.js";
import { resolveWorkspaceResearchFolder } from "./workspace-research.js";
import { RESEARCH_FOLDERS, researchFolderNames } from "../utils/project-modes.js";

export type WorkspaceResearchContextOrigin = "project" | "workspace" | "file";

export type WorkspaceResearchContextRoot = {
  folder: TFolder;
  origin: WorkspaceResearchContextOrigin;
  sourceBinderPath: string | null;
  workspaceSourceKind?: "exact" | "ancestor";
};

export type ContextualResearchCategory = WorkspaceResearchContextRoot & {
  key: string;
};

function addUnique(
  roots: WorkspaceResearchContextRoot[],
  seen: Set<string>,
  root: WorkspaceResearchContextRoot
): void {
  if (seen.has(root.folder.path)) return;
  seen.add(root.folder.path);
  roots.push(root);
}

type DirectFileResearchFolder = { folder: TFolder; sourceBinderPath: string };

function directFileResearchFolders(
  app: App,
  settings: FeuilletsSettings,
  workspaceFolder: TFolder,
  manuscriptRoot: TFolder
): DirectFileResearchFolder[] {
  const meta = settings.projectMeta?.[manuscriptRoot.path];
  const links = meta?.researchFolderLinks;
  if (!links) return [];

  const folders: DirectFileResearchFolder[] = [];
  const visit = (folder: TFolder): void => {
    for (const child of getOrderedChildren(app, settings, folder)) {
      if (child instanceof TFolder) {
        visit(child);
        continue;
      }
      if (!(child instanceof TFile)) continue;
      const linkedPath = links[child.path];
      if (!linkedPath) continue;
      const linked = app.vault.getAbstractFileByPath(normalizePath(linkedPath));
      if (linked instanceof TFolder) folders.push({ folder: linked, sourceBinderPath: child.path });
    }
  };
  visit(workspaceFolder);
  return folders;
}

/** Résout les racines Recherche pertinentes sans écrire ni fusionner de données. */
export function resolveWorkspaceResearchContext(
  app: App,
  settings: FeuilletsSettings,
  workspaceFolder: TFolder | null
): WorkspaceResearchContextRoot[] {
  const projectRoot = getProjectFolder(app, settings);
  const projectResearch = getResearchRoot(app, settings);
  if (!projectRoot) return [];

  const roots: WorkspaceResearchContextRoot[] = [];
  const seen = new Set<string>();
  if (!workspaceFolder) {
    if (projectResearch) addUnique(roots, seen, { folder: projectResearch, origin: "project", sourceBinderPath: null });
    return roots;
  }

  const relative = folderPathToRelativeScope(projectRoot.path, workspaceFolder.path);
  if (!relative) {
    if (projectResearch) addUnique(roots, seen, { folder: projectResearch, origin: "project", sourceBinderPath: null });
    return roots;
  }

  if (projectResearch) addUnique(roots, seen, { folder: projectResearch, origin: "project", sourceBinderPath: null });
  const resolution = resolveWorkspaceResearchFolder(app, settings, workspaceFolder);
  if ((resolution.sourceKind === "exact" || resolution.sourceKind === "ancestor") && resolution.folder) {
    addUnique(roots, seen, {
      folder: resolution.folder,
      origin: "workspace",
      sourceBinderPath: resolution.sourceBinderPath,
      workspaceSourceKind: resolution.sourceKind,
    });
  }

  for (const linked of directFileResearchFolders(app, settings, workspaceFolder, projectRoot)) {
    addUnique(roots, seen, { folder: linked.folder, origin: "file", sourceBinderPath: linked.sourceBinderPath });
  }
  return roots;
}

/** Résout une catégorie dans chaque racine, sans descendre dans les sous-arbres. */
export function resolveContextualResearchCategory(
  app: App,
  settings: FeuilletsSettings,
  workspaceFolder: TFolder | null,
  key: string
): ContextualResearchCategory[] {
  const names = researchFolderNames(RESEARCH_FOLDERS, key);
  if (names.length === 0) return [];
  const result: ContextualResearchCategory[] = [];
  const seen = new Set<string>();
  for (const root of resolveWorkspaceResearchContext(app, settings, workspaceFolder)) {
    const candidates = names.includes(root.folder.name)
      ? [root.folder]
      : (root.folder.children || []).filter((child): child is TFolder =>
        child instanceof TFolder && names.includes(child.name)
      );
    for (const folder of candidates) {
      if (seen.has(folder.path)) continue;
      seen.add(folder.path);
      result.push({ ...root, folder, key });
    }
  }
  return result;
}

/**
 * Resolves all genuine Sources root folders across:
 * 1. Global project research
 * 2. Linked research folders
 * 3. Workspace research roots (e.g. isolated space)
 * Purely structural resolution without general vault scanning.
 */
export function getGenuineSourcesRoots(
  app: App,
  settings: FeuilletsSettings,
  linkedFolders: readonly { folder: TFolder }[] = [],
  activeWorkspaceFolder?: TFolder | null
): TFolder[] {
  const genuineRoots: TFolder[] = [];
  const seen = new Set<string>();

  const addSourcesFromRoot = (researchRoot: TFolder | null | undefined): void => {
    if (!researchRoot) return;
    if (researchRoot.name === "Sources" && !seen.has(researchRoot.path)) {
      seen.add(researchRoot.path);
      genuineRoots.push(researchRoot);
      return;
    }
    const child = app.vault.getAbstractFileByPath(normalizePath(`${researchRoot.path}/Sources`));
    if (child instanceof TFolder && !seen.has(child.path)) {
      seen.add(child.path);
      genuineRoots.push(child);
    }
  };

  // 1. Global project research
  const projectResearch = getResearchRoot(app, settings);
  addSourcesFromRoot(projectResearch);

  // 2. Linked research roots
  for (const { folder } of linkedFolders) {
    addSourcesFromRoot(folder);
  }

  // 3. Workspace research roots (e.g. isolated space)
  if (activeWorkspaceFolder) {
    for (const root of resolveWorkspaceResearchContext(app, settings, activeWorkspaceFolder)) {
      addSourcesFromRoot(root.folder);
    }
  }

  return genuineRoots;
}

/**
 * Returns true if the folder is a genuine Sources folder or a subfolder of one.
 * Excludes custom folders named Sources outside research roots, sibling folders,
 * and folders with non-matching prefixes like Sources-Extra.
 */
export function isGenuineSourcesFolder(
  app: App,
  settings: FeuilletsSettings,
  folder: TFolder,
  linkedFolders: readonly { folder: TFolder }[] = [],
  activeWorkspaceFolder?: TFolder | null
): boolean {
  const genuineRoots = getGenuineSourcesRoots(app, settings, linkedFolders, activeWorkspaceFolder);
  return genuineRoots.some(
    (sf) => sf.path === folder.path || folder.path.startsWith(`${sf.path}/`)
  );
}
