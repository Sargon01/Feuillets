import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { flattenFiles, getManuscriptRoot, getProjectRoot, isFrontMatter, isStructuredManuscriptRoot } from "./folder-structure.js";
import { fmOf } from "./frontmatter.js";
import { getBackupsRoot } from "./project-backup.js";
import { validateFeuilProjectManifest } from "./feuil-project-package.js";
import type { FeuilProjectLinkedResearch, FeuilProjectManifest } from "./feuil-project-package.js";
import { filsOf } from "../utils/arc-fields.js";

export type FeuilProjectExportPlan = {
  manifest: FeuilProjectManifest;
  files: Record<string, Uint8Array>;
  directories: string[];
};

type ExternalResearchSource = {
  id: string;
  sourcePath: string;
};

type LinkedResearchResolution = {
  linkedResearch: FeuilProjectLinkedResearch[];
  externalSources: ExternalResearchSource[];
};

export class FeuilProjectExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeuilProjectExportError";
  }
}

function fail(message: string): never {
  throw new FeuilProjectExportError(message);
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function relativePath(path: string, root: string): string {
  return path === root ? "." : path.slice(root.length + 1);
}

function cloneMeta(meta: ProjectMeta | undefined): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(meta || {})) as Record<string, unknown>;
  delete clone.researchFolderLinks;
  delete clone.level1Role;
  delete clone.narrativeState;
  return clone;
}

type EffectiveNarrativeState = {
  placeholders: Record<string, string>;
  origins: Record<string, string>;
  resolved: string[];
};

function narrativeStateOf(meta: ProjectMeta | undefined, settings: FeuilletsSettings): EffectiveNarrativeState {
  const state = meta?.narrativeState;
  if (state && state.placeholders && state.origins && Array.isArray(state.resolved)) return state;
  return { placeholders: settings.filPlaceholders || {}, origins: settings.filOrigins || {}, resolved: settings.filResolved || [] };
}

function exportPathRecord(record: Record<string, string> | undefined, root: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, path] of Object.entries(record || {})) {
    if (isInside(path, root)) result[key] = relativePath(path, root);
  }
  return result;
}

function exportSettings<T>(record: Record<string, T> | undefined, root: string, copy: (value: T) => T): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [path, value] of Object.entries(record || {})) {
    if (isInside(path, root)) result[relativePath(path, root)] = copy(value);
  }
  return result;
}

function projectThreadNames(app: App, settings: FeuilletsSettings, manuscriptRoot: TFolder): Set<string> {
  const names = new Set<string>();
  if (!app.metadataCache) return names;
  for (const file of flattenFiles(app, settings, manuscriptRoot)) {
    if (isFrontMatter(app, settings, file)) continue;
    for (const name of filsOf(fmOf(app, file, settings))) if (name) names.add(name);
  }
  return names;
}

function level1RoleOf(meta: ProjectMeta | undefined, settings: FeuilletsSettings): "parties" | "chapitres" {
  if (meta?.level1Role === "parties" || meta?.level1Role === "chapitres") return meta.level1Role;
  if (settings.level1Role === "parties" || settings.level1Role === "chapitres") return settings.level1Role;
  return fail("level1Role invalide.");
}

function linkedResearch(meta: ProjectMeta | undefined, manuscriptRoot: TFolder, projectRoot: TFolder): LinkedResearchResolution {
  const links = meta?.researchFolderLinks || {};
  const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  const candidates = Object.entries(links);
  for (const [binderPath] of candidates) if (!isInside(binderPath, manuscriptRoot.path)) fail("Lien Recherche hors manuscrit.");
  const externalIds = new Map(Object.values(links).filter((path) => !isInside(path, projectRoot.path)).sort(compare).filter((path, index, paths) => index === 0 || path !== paths[index - 1]).map((path, index) => [path, `research-${String(index + 1).padStart(3, "0")}`]));
  candidates.sort(([leftBinder, leftTarget], [rightBinder, rightTarget]) => compare(leftTarget, rightTarget) || compare(leftBinder, rightBinder));
  const result: FeuilProjectLinkedResearch[] = [];
  for (const [binderPath, researchPath] of candidates) {
    const binderRelative = relativePath(binderPath, manuscriptRoot.path);
    if (isInside(researchPath, projectRoot.path)) {
      result.push({ binderPath: binderRelative, target: { kind: "project", path: relativePath(researchPath, projectRoot.path) } });
    } else {
      const segments = researchPath.split("/").filter(Boolean);
      const name = segments[segments.length - 1] || "Recherche";
      result.push({ binderPath: binderRelative, target: { kind: "external", id: externalIds.get(researchPath) || fail("ID Research externe introuvable."), name } });
    }
  }
  return {
    linkedResearch: result,
    externalSources: [...externalIds.entries()]
      .map(([sourcePath, id]) => ({ id, sourcePath }))
      .sort((left, right) => compare(left.id, right.id)),
  };
}

async function collectProjectTree(
  app: App,
  folder: TFolder,
  projectRoot: TFolder,
  backupsRoot: TFolder | null,
  files: Record<string, Uint8Array>,
  directories: string[],
): Promise<void> {
  if (backupsRoot && isInside(folder.path, backupsRoot.path)) return;
  if (folder.path !== projectRoot.path) directories.push(`project/${relativePath(folder.path, projectRoot.path)}`);
  for (const child of folder.children) {
    if (backupsRoot && isInside(child.path, backupsRoot.path)) continue;
    if (child instanceof TFolder) await collectProjectTree(app, child, projectRoot, backupsRoot, files, directories);
    else if (child instanceof TFile) files[`project/${relativePath(child.path, projectRoot.path)}`] = new Uint8Array(await app.vault.readBinary(child));
  }
}

async function collectExternalResearchTree(
  app: App,
  folder: TFolder,
  sourceRoot: TFolder,
  id: string,
  files: Record<string, Uint8Array>,
  directories: string[],
): Promise<void> {
  const archiveRoot = `external/research/${id}`;
  directories.push(folder.path === sourceRoot.path ? archiveRoot : `${archiveRoot}/${relativePath(folder.path, sourceRoot.path)}`);
  const children = [...folder.children].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  for (const child of children) {
    if (child instanceof TFolder) await collectExternalResearchTree(app, child, sourceRoot, id, files, directories);
    else if (child instanceof TFile) files[`${archiveRoot}/${relativePath(child.path, sourceRoot.path)}`] = new Uint8Array(await app.vault.readBinary(child));
  }
}

export async function buildFeuilProjectExportPlan(
  app: App,
  settings: FeuilletsSettings,
  createdByVersion: string,
  packageId: string,
  createdAt: string,
): Promise<FeuilProjectExportPlan> {
  const manuscriptRoot = getManuscriptRoot(app, settings);
  const projectRoot = getProjectRoot(app, settings);
  if (!manuscriptRoot || !projectRoot) fail("Projet actif introuvable.");
  if (projectRoot.path === "" || projectRoot.path === "/") fail("Racine du coffre interdite.");

  const meta = settings.projectMeta?.[manuscriptRoot.path];
  const isStructured = isStructuredManuscriptRoot(manuscriptRoot) && projectRoot.path !== manuscriptRoot.path;
  const research = linkedResearch(meta, manuscriptRoot, projectRoot);
  const threadNames = projectThreadNames(app, settings, manuscriptRoot);
  const narrativeState = narrativeStateOf(meta, settings);
  const manifest: FeuilProjectManifest = {
    format: "feuil",
    version: 1,
    packageId,
    createdAt,
    createdByVersion,
    project: {
      name: projectRoot.name,
      rootKind: isStructured ? "structured" : "adopted",
      manuscriptPath: isStructured ? relativePath(manuscriptRoot.path, projectRoot.path) : ".",
      structure: { level1Role: level1RoleOf(meta, settings) },
      meta: cloneMeta(meta),
      pathSettings: {
        orders: exportSettings(settings.orders, projectRoot.path, (value) => [...value]),
        folderPositions: exportSettings(settings.folderPositions, projectRoot.path, (value) => value),
        folderGoals: exportSettings(settings.folderGoals, projectRoot.path, (value) => value),
      },
      narrativeState: {
        placeholders: exportPathRecord(narrativeState.placeholders, projectRoot.path),
        origins: exportPathRecord(narrativeState.origins, projectRoot.path),
        resolved: narrativeState.resolved.filter((name) => threadNames.has(name)),
      },
      linkedResearch: research.linkedResearch,
    },
  };
  validateFeuilProjectManifest(manifest);

  const files: Record<string, Uint8Array> = {};
  const directories: string[] = [];
  await collectProjectTree(app, projectRoot, projectRoot, getBackupsRoot(app, manuscriptRoot), files, directories);
  for (const external of research.externalSources) {
    const source = app.vault.getAbstractFileByPath(external.sourcePath);
    if (!source || !(source instanceof TFolder) || source.path === "" || source.path === "/") fail(`Research externe introuvable : ${external.sourcePath}`);
    await collectExternalResearchTree(app, source, source, external.id, files, directories);
  }
  return { manifest, files, directories };
}
