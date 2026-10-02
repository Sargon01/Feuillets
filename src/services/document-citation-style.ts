import { normalizePath } from "obsidian";

/** Resolves citation style from the documentary root before compilation or rendering. */
export function resolveDocumentCitationStyle(
  settings: FeuilletsSettings,
  projectRootPath: string,
): PandocCitationPreviewStyle {
  const style = settings.projectMeta?.[normalizePath(projectRootPath)]?.pandocCitationPreviewStyle
    ?? settings.projectMeta?.[normalizePath(settings.projectFolder || "")]?.pandocCitationPreviewStyle;
  return style || "off";
}
