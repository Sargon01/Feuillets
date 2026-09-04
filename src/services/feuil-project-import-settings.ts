import type { FeuilProjectImportResult } from "./feuil-project-import.js";
import { knownProjectType } from "../utils/project-modes.js";

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function removeProjectKeys<T>(record: Record<string, T>, root: string): void {
  for (const path of Object.keys(record)) if (isInside(path, root)) delete record[path];
}

export function applyFeuilProjectImportSettings(settings: FeuilletsSettings, result: FeuilProjectImportResult): void {
  const manuscriptPath = result.manuscriptRootPath;
  if (settings.projectFolder && !settings.projects.includes(settings.projectFolder)) settings.projects.push(settings.projectFolder);
  if (!settings.projects.includes(manuscriptPath)) settings.projects.push(manuscriptPath);

  removeProjectKeys(settings.orders, result.projectRootPath);
  removeProjectKeys(settings.folderPositions, result.projectRootPath);
  removeProjectKeys(settings.folderGoals, result.projectRootPath);
  for (const [path, value] of Object.entries(result.settingsPatch.pathSettings.orders)) settings.orders[path] = [...value];
  for (const [path, value] of Object.entries(result.settingsPatch.pathSettings.folderPositions)) settings.folderPositions[path] = value;
  for (const [path, value] of Object.entries(result.settingsPatch.pathSettings.folderGoals)) settings.folderGoals[path] = value;

  const projectMeta = JSON.parse(JSON.stringify(result.settingsPatch.projectMeta)) as ProjectMeta;
  if (knownProjectType(projectMeta.type) === null) projectMeta.type = "fiction";
  settings.projectMeta[manuscriptPath] = {
    ...projectMeta,
    researchFolderLinks: { ...(projectMeta.researchFolderLinks || {}) },
    level1Role: result.settingsPatch.structure.level1Role,
    narrativeState: {
      placeholders: { ...result.settingsPatch.narrativeState.placeholders },
      origins: { ...result.settingsPatch.narrativeState.origins },
      resolved: [...result.settingsPatch.narrativeState.resolved],
    },
  };
}
