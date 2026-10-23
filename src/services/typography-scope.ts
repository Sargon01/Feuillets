import { normalizePath, type TFile, type TFolder } from "obsidian";
import { feuilletsAuxiliaryRootPath } from "./folder-structure.js";
import { isProjectDraft } from "./project-drafts.js";

/** Prose targets in the active project. Drafts are the only exception to
 * the auxiliary-folder exclusion; image-paste eligibility is independent. */
export function isEligibleTypographyTarget(
  root: TFolder | null | undefined,
  file: TFile | null | undefined,
): boolean {
  if (!root || !file || file.extension.toLowerCase() !== "md") return false;
  if (isProjectDraft(root, file)) return true;
  const path = normalizePath(file.path);
  const rootPath = normalizePath(root.path);
  const auxiliary = feuilletsAuxiliaryRootPath(root);
  return path.startsWith(`${rootPath}/`) && path !== auxiliary && !path.startsWith(`${auxiliary}/`);
}
