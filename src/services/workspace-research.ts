import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { folderPathToRelativeScope } from "../carnet/core/folder-carnets.js";
import { getProjectFolder } from "./folder-structure.js";
import { getResearchRoot } from "./research.js";

export type WorkspaceResearchResolution = {
  folder: TFolder | null;
  sourceKind: "exact" | "ancestor" | "project" | "none";
  sourceBinderPath: string | null;
};

export type ActiveBranchResearchFolder = {
  folder: TFolder;
  binderNode: TFile | TFolder;
};

function none(): WorkspaceResearchResolution {
  return { folder: null, sourceKind: "none", sourceBinderPath: null };
}

/** Résout la Recherche effective d'un espace Binder sans écrire dans les settings. */
export function resolveWorkspaceResearchFolder(
  app: App,
  settings: FeuilletsSettings,
  workspaceFolder: TFolder | null,
): WorkspaceResearchResolution {
  const manuscriptRoot = getProjectFolder(app, settings);
  if (!manuscriptRoot) return none();

  const meta = settings.projectMeta?.[manuscriptRoot.path];
  const links = meta?.researchFolderLinks;
  if (workspaceFolder) {
    const relative = folderPathToRelativeScope(manuscriptRoot.path, workspaceFolder.path);
    if (relative) {
      const parts = relative.split("/");
      for (let end = parts.length; end > 0; end -= 1) {
        const sourceBinderPath = normalizePath(`${manuscriptRoot.path}/${parts.slice(0, end).join("/")}`);
        const researchPath = links?.[sourceBinderPath];
        if (!researchPath) continue;
        const folder = app.vault.getAbstractFileByPath(normalizePath(researchPath));
        if (folder instanceof TFolder) {
          return {
            folder,
            sourceKind: end === parts.length ? "exact" : "ancestor",
            sourceBinderPath,
          };
        }
      }
    }
  }

  const projectResearch = getResearchRoot(app, settings);
  if (!projectResearch) return none();
  return { folder: projectResearch, sourceKind: "project", sourceBinderPath: null };
}

/**
 * Resolves research folders explicitly associated with the active file's
 * physical ancestor chain, bounded by workspaceFolder.
 */
export function resolveActiveFileResearchFolders(
  app: App,
  settings: FeuilletsSettings,
  workspaceFolder: TFolder | null | undefined,
  activeFile: TFile | null | undefined
): ActiveBranchResearchFolder[] {
  if (!workspaceFolder || !(workspaceFolder instanceof TFolder)) {
    return [];
  }
  if (!activeFile || !(activeFile instanceof TFile)) {
    return [];
  }

  const manuscriptRoot = getProjectFolder(app, settings);
  if (!manuscriptRoot) return [];

  const rootPath = normalizePath(manuscriptRoot.path);
  const workspacePath = normalizePath(workspaceFolder.path);
  const activeFilePath = normalizePath(activeFile.path);

  // workspaceFolder must belong to the active project
  if (workspacePath !== rootPath && !workspacePath.startsWith(`${rootPath}/`)) {
    return [];
  }

  // activeFile must belong to workspaceFolder with a strict path boundary
  const workspacePrefix = `${workspacePath}/`;
  if (!activeFilePath.startsWith(workspacePrefix)) {
    return [];
  }

  const meta = settings.projectMeta?.[manuscriptRoot.path];
  const links = meta?.researchFolderLinks;
  if (!links) return [];

  // Build physical folder chain between workspaceFolder and activeFile.parent
  const relativeFromWorkspace = activeFilePath.slice(workspacePrefix.length);
  const segments = relativeFromWorkspace.split("/");
  // Last segment is the file itself
  segments.pop();

  const results: ActiveBranchResearchFolder[] = [];
  const seenResearchPaths = new Set<string>();

  // Walk folder chain from widest to narrowest
  for (let i = 0; i < segments.length; i++) {
    const subPath = segments.slice(0, i + 1).join("/");
    const currentFolderPath = normalizePath(`${workspacePath}/${subPath}`);

    let binderFolder: TFolder | null = null;
    const fromVault = app.vault.getAbstractFileByPath(currentFolderPath);
    if (fromVault instanceof TFolder) {
      binderFolder = fromVault;
    } else {
      let curr: TFolder | null = activeFile.parent ?? null;
      while (curr && curr.path !== workspacePath) {
        if (normalizePath(curr.path) === currentFolderPath) {
          binderFolder = curr;
          break;
        }
        curr = curr.parent ?? null;
      }
    }
    if (!binderFolder) continue;

    const researchPath = links[currentFolderPath];
    if (!researchPath) continue;

    const targetFolder = app.vault.getAbstractFileByPath(normalizePath(researchPath));
    if (targetFolder instanceof TFolder && !seenResearchPaths.has(targetFolder.path)) {
      seenResearchPaths.add(targetFolder.path);
      results.push({ folder: targetFolder, binderNode: binderFolder });
    }
  }

  // Check activeFile's own exact association
  const fileResearchPath = links[activeFilePath];
  if (fileResearchPath) {
    const targetFolder = app.vault.getAbstractFileByPath(normalizePath(fileResearchPath));
    if (targetFolder instanceof TFolder && !seenResearchPaths.has(targetFolder.path)) {
      seenResearchPaths.add(targetFolder.path);
      results.push({ folder: targetFolder, binderNode: activeFile });
    }
  }

  return results;
}
