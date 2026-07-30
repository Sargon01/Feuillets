import type { App } from "obsidian";
import { getProjectFolder } from "./folder-structure.js";
import { PROJECT_MODES, resolveType } from "../utils/project-modes.js";

type ProjectMode = typeof PROJECT_MODES[keyof typeof PROJECT_MODES];

/** Type du projet actif, ou "roman" par repli. */
export function getProjectType(app: App, settings: FeuilletsSettings) {
  const root = getProjectFolder(app, settings);
  if (!root) return "fiction";
  return resolveType((settings.projectMeta[root.path] || {}).type);
}

export function getProjectMode(app: App, settings: FeuilletsSettings): ProjectMode {
  return PROJECT_MODES[getProjectType(app, settings)];
}
