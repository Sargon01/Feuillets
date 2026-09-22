import { TFolder, type App, type TFile } from "obsidian";
import { flattenFiles } from "./folder-structure.js";

export type ResearchDocumentScopeMode = "project" | "workspace";

export type ResearchDocumentContext = {
  mode: ResearchDocumentScopeMode;
  projectRoot: TFolder;
  scopeRoot: TFolder;
  workspaceRoot: TFolder | null;
  files: readonly TFile[];
};

function isStrictDescendant(candidate: TFolder, ancestor: TFolder): boolean {
  return candidate.path !== ancestor.path && candidate.path.startsWith(`${ancestor.path}/`);
}

/** Single source of truth for which feuillets belong to the Research scope
 * currently displayed. Purely a function of the given project root, the
 * isolated Binder folder and the requested mode: never reads the active
 * file, the active editor or the active leaf, and never writes settings or
 * the vault. Falls back to the Project scope whenever the requested
 * workspace folder is missing, foreign to the project, or the project root
 * itself. File ordering and exclusion of auxiliary folders are entirely
 * delegated to flattenFiles(). */
export function resolveResearchDocumentContext(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  workspaceFolder: TFolder | null,
  requestedMode: ResearchDocumentScopeMode,
): ResearchDocumentContext {
  if (
    requestedMode === "workspace" &&
    workspaceFolder instanceof TFolder &&
    isStrictDescendant(workspaceFolder, projectRoot)
  ) {
    return {
      mode: "workspace",
      projectRoot,
      scopeRoot: workspaceFolder,
      workspaceRoot: workspaceFolder,
      files: flattenFiles(app, settings, workspaceFolder),
    };
  }

  return {
    mode: "project",
    projectRoot,
    scopeRoot: projectRoot,
    workspaceRoot: null,
    files: flattenFiles(app, settings, projectRoot),
  };
}
