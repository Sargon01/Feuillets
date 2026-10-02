import { normalizePath } from "obsidian";
import { resolveFolderWorkspaceValue, type FolderWorkspaceResolution } from "./folder-workspaces.js";

export function resolveDocumentCitationStyleSetting(
  settings: FeuilletsSettings,
  projectRootPath: string,
  scopeFolderPath: string = projectRootPath,
): FolderWorkspaceResolution<PandocCitationPreviewStyle> {
  const projectPath = normalizePath(projectRootPath);
  const activePath = normalizePath(settings.projectFolder || "");
  const ownerPath = projectPath === activePath || projectPath.startsWith(`${activePath}/`) ? activePath : projectPath;
  const meta = settings.projectMeta?.[ownerPath];
  const fallback = settings.projectMeta?.[projectPath]?.pandocCitationPreviewStyle
    ?? meta?.pandocCitationPreviewStyle ?? settings.projectMeta?.[activePath]?.pandocCitationPreviewStyle ?? "off";
  const resolved = resolveFolderWorkspaceValue(meta, ownerPath, normalizePath(scopeFolderPath), "pandocCitationPreviewStyle", fallback);
  return { value: resolved.value ?? "off", source: resolved.source };
}

/** Resolves citation style from the documentary root before compilation or rendering. */
export function resolveDocumentCitationStyle(
  settings: FeuilletsSettings,
  projectRootPath: string,
  scopeFolderPath: string = projectRootPath,
): PandocCitationPreviewStyle {
  return resolveDocumentCitationStyleSetting(settings, projectRootPath, scopeFolderPath).value || "off";
}
