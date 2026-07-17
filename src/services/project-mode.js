import { getProjectFolder } from "./folder-structure.js";
import { PROJECT_MODES, resolveType } from "../utils/project-modes.js";

/** Type du projet actif, ou "roman" par repli. */
export function getProjectType(app, settings) {
  const root = getProjectFolder(app, settings);
  if (!root) return "fiction";
  return resolveType((settings.projectMeta[root.path] || {}).type);
}

export function getProjectMode(app, settings) {
  return PROJECT_MODES[getProjectType(app, settings)];
}
