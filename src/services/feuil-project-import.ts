import { TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { FeuilProjectImportPlan, FeuilProjectImportedTree } from "./feuil-project-import-plan.js";

export class FeuilProjectImportError extends Error {
  readonly originalError?: unknown;

  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = "FeuilProjectImportError";
    this.originalError = originalError;
  }
}

export type FeuilProjectImportSettingsPatch = {
  projectRootPath: string;
  manuscriptRootPath: string;
  projectMeta: ProjectMeta;
  pathSettings: {
    orders: Record<string, string[]>;
    folderPositions: Record<string, number>;
    folderGoals: Record<string, number>;
  };
  narrativeState: {
    placeholders: Record<string, string>;
    origins: Record<string, string>;
    resolved: string[];
  };
  structure: {
    level1Role: "parties" | "chapitres";
  };
};

export type FeuilProjectImportResult = {
  projectRootPath: string;
  manuscriptRootPath: string;
  externalResearchPaths: Record<string, string>;
  settingsPatch: FeuilProjectImportSettingsPatch;
};

function fail(message: string): never {
  throw new FeuilProjectImportError(message);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function join(root: string, relative: string): string {
  return relative ? normalizePath(`${root}/${relative}`) : root;
}

function exactArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function directoryPaths(tree: FeuilProjectImportedTree): string[] {
  const paths = new Set<string>();
  const addAncestors = (path: string): void => {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) paths.add(segments.slice(0, index).join("/"));
  };
  for (const path of tree.directories) {
    paths.add(path);
    addAncestors(path);
  }
  for (const path of Object.keys(tree.files)) addAncestors(path);
  return [...paths].sort((left, right) => left.split("/").length - right.split("/").length || compare(left, right));
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function validateResearchName(name: string): void {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || hasControlCharacter(name) || /[<>:"|?*]/.test(name) || name.endsWith(".") || name.endsWith(" ")) {
    fail(`Nom de Research externe invalide : ${name}`);
  }
  const baseName = name.split(".", 1)[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName)) fail(`Nom de Research externe invalide : ${name}`);
}

function isOccupied(tree: FeuilProjectImportedTree, candidate: string): boolean {
  return [...Object.keys(tree.files), ...tree.directories].some((path) => path === candidate || path.startsWith(`${candidate}/`));
}

function importedResearchBase(plan: FeuilProjectImportPlan): string | null {
  if (plan.externalResearch.length === 0) return null;
  if ("_Feuillets" in plan.project.files) fail("_Feuillets ne peut pas être un fichier lors de l’import.");
  for (const research of plan.externalResearch) validateResearchName(research.name);
  const stem = "_Feuillets/Recherche liée importée";
  for (let index = 1; ; index += 1) {
    const candidate = index === 1 ? stem : `${stem} ${index}`;
    if (!isOccupied(plan.project, candidate)) return candidate;
  }
}

function remapPath(path: string, root: string): string {
  return path === "." ? root : join(root, path);
}

function remapStringRecord(record: Record<string, string>, root: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, path] of Object.entries(record)) result[key] = remapPath(path, root);
  return result;
}

function remapNumberRecord(record: Record<string, number>, root: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [path, value] of Object.entries(record)) result[remapPath(path, root)] = value;
  return result;
}

function remapOrders(record: Record<string, string[]>, root: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [path, value] of Object.entries(record)) result[remapPath(path, root)] = [...value];
  return result;
}

async function materializeTree(app: App, root: string, tree: FeuilProjectImportedTree): Promise<void> {
  for (const directory of directoryPaths(tree)) await app.vault.createFolder(join(root, directory));
  for (const [path, data] of Object.entries(tree.files).sort(([left], [right]) => compare(left, right))) {
    await app.vault.createBinary(join(root, path), exactArrayBuffer(data));
  }
}

async function ensureDirectory(app: App, root: string, relative: string): Promise<void> {
  const segments = relative.split("/");
  for (let index = 1; index <= segments.length; index += 1) {
    const path = join(root, segments.slice(0, index).join("/"));
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
  }
}

export async function materializeFeuilProjectImport(
  app: App,
  plan: FeuilProjectImportPlan,
  destinationRootPath: string,
): Promise<FeuilProjectImportResult> {
  const projectRootPath = normalizePath(destinationRootPath.trim());
  if (!projectRootPath || projectRootPath === "." || projectRootPath === "/") fail("Destination d’import invalide.");
  if (app.vault.getAbstractFileByPath(projectRootPath)) fail(`Destination déjà existante : ${projectRootPath}`);
  const parentPath = projectRootPath.split("/").slice(0, -1).join("/");
  if (parentPath && !(app.vault.getAbstractFileByPath(parentPath) instanceof TFolder)) fail(`Parent de destination introuvable : ${parentPath}`);

  const researchBase = importedResearchBase(plan);
  const manuscriptRootPath = remapPath(plan.manifest.project.manuscriptPath, projectRootPath);
  const externalResearchPaths: Record<string, string> = {};
  if (researchBase) {
    for (const research of [...plan.externalResearch].sort((left, right) => compare(left.id, right.id))) {
      externalResearchPaths[research.id] = join(projectRootPath, `${researchBase}/${research.id}/${research.name}`);
    }
  }

  const researchFolderLinks: Record<string, string> = {};
  for (const linked of plan.manifest.project.linkedResearch) {
    const binderPath = remapPath(linked.binderPath, manuscriptRootPath);
    const targetPath = linked.target.kind === "project"
      ? remapPath(linked.target.path, projectRootPath)
      : externalResearchPaths[linked.target.id] || fail(`Research externe introuvable : ${linked.target.id}`);
    researchFolderLinks[binderPath] = targetPath;
  }
  const settingsPatch: FeuilProjectImportSettingsPatch = {
    projectRootPath,
    manuscriptRootPath,
    projectMeta: { ...plan.manifest.project.meta, researchFolderLinks, level1Role: plan.manifest.project.structure.level1Role },
    pathSettings: {
      orders: remapOrders(plan.manifest.project.pathSettings.orders, projectRootPath),
      folderPositions: remapNumberRecord(plan.manifest.project.pathSettings.folderPositions, projectRootPath),
      folderGoals: remapNumberRecord(plan.manifest.project.pathSettings.folderGoals, projectRootPath),
    },
    narrativeState: {
      placeholders: remapStringRecord(plan.manifest.project.narrativeState.placeholders, projectRootPath),
      origins: remapStringRecord(plan.manifest.project.narrativeState.origins, projectRootPath),
      resolved: [...plan.manifest.project.narrativeState.resolved],
    },
    structure: { level1Role: plan.manifest.project.structure.level1Role },
  };

  let created = false;
  try {
    await app.vault.createFolder(projectRootPath);
    created = true;
    await materializeTree(app, projectRootPath, plan.project);
    if (researchBase) {
      for (const research of [...plan.externalResearch].sort((left, right) => compare(left.id, right.id))) {
        await ensureDirectory(app, projectRootPath, `${researchBase}/${research.id}/${research.name}`);
        await materializeTree(app, externalResearchPaths[research.id], research.tree);
      }
    }
  } catch (error) {
    if (created) {
      const destination = app.vault.getAbstractFileByPath(projectRootPath);
      if (destination instanceof TFolder) {
        try {
          await app.fileManager.trashFile(destination);
        } catch {
          throw new FeuilProjectImportError(`Import interrompu et nettoyage automatique impossible : ${projectRootPath}`, error);
        }
      }
    }
    throw error;
  }
  return { projectRootPath, manuscriptRootPath, externalResearchPaths, settingsPatch };
}
