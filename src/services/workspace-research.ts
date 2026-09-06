import { TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { folderPathToRelativeScope } from "../carnet/core/folder-carnets.js";
import { getProjectFolder } from "./folder-structure.js";
import { getResearchRoot } from "./research.js";

export type WorkspaceResearchResolution = {
  folder: TFolder | null;
  sourceKind: "exact" | "ancestor" | "project" | "none";
  sourceBinderPath: string | null;
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
