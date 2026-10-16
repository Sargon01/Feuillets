import { TFile, TFolder, type App } from "obsidian";
import { getProjectRoot } from "../../services/folder-structure.js";
import { canvasPathFor } from "../../services/canvas-board.js";
import { t } from "../../i18n/index.js";
import { findExistingFolderCarnetCanvas, getFolderCarnetDisplayLabel, listCanonicalFolderCarnetOwners, resolveExistingFolderCarnetRegistration, resolveFolderCarnetContext } from "./folder-carnets.js";

export type CarnetWorkspaceEntry = { key: string; label: string; context: string; file: TFile | null; folder: TFolder | null };

/** Only registered canonical owners and an optional current folder are visited. */
export function listCarnetWorkspaceEntries(app: App, settings: FeuilletsSettings, manuscript: TFolder | null, currentFolder?: TFolder | null): CarnetWorkspaceEntry[] {
  if (!manuscript) return [];
  const project = getProjectRoot(app, settings);
  if (!project) return [];
  const projectFile = app.vault.getAbstractFileByPath(canvasPathFor(app, manuscript));
  const result: CarnetWorkspaceEntry[] = [{ key: manuscript.path, label: t("carnet.workspace.project"), context: manuscript.path,
    file: projectFile instanceof TFile ? projectFile : null, folder: null }];
  const meta = settings.projectMeta[manuscript.path];
  const owners = listCanonicalFolderCarnetOwners(app.vault, project.path, meta);
  if (currentFolder && currentFolder.path.startsWith(`${project.path}/`) && currentFolder !== manuscript) {
    const context = resolveFolderCarnetContext(app.vault, project.path, meta, currentFolder);
    if (context && !owners.some((owner) => owner.path === context.owner.path)) owners.push(context.owner);
  }
  for (const owner of owners) {
    if (!(app.vault.getAbstractFileByPath(owner.path) instanceof TFolder)) continue;
    const context = resolveFolderCarnetContext(app.vault, project.path, meta, owner);
    if (!context) continue;
    const registration = resolveExistingFolderCarnetRegistration(meta, context.ownerRelative, context.linkedRelative);
    result.push({ key: owner.path, label: getFolderCarnetDisplayLabel(owner, owners),
      context: [owner.path, context.linkedResearchFolder?.path].filter(Boolean).join(" · "),
      file: registration ? findExistingFolderCarnetCanvas(app.vault, manuscript, registration.id) : null, folder: owner });
  }
  return result;
}
