import { readFeuilProjectPackage } from "./feuil-project-package.js";
import type { FeuilProjectManifest, FeuilProjectPackage } from "./feuil-project-package.js";

export type FeuilProjectImportedTree = {
  files: Record<string, Uint8Array>;
  directories: string[];
};

export type FeuilProjectExternalResearchImport = {
  id: string;
  name: string;
  tree: FeuilProjectImportedTree;
};

export type FeuilProjectImportPlan = {
  manifest: FeuilProjectManifest;
  project: FeuilProjectImportedTree;
  externalResearch: FeuilProjectExternalResearchImport[];
};

export class FeuilProjectImportPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeuilProjectImportPlanError";
  }
}

function fail(message: string): never {
  throw new FeuilProjectImportPlanError(message);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relativePath(path: string, prefix: string): string {
  return path.slice(prefix.length);
}

function projectTree(packageData: FeuilProjectPackage): FeuilProjectImportedTree {
  const files: Record<string, Uint8Array> = {};
  for (const entry of packageData.entries) {
    if (entry.path.startsWith("project/")) files[relativePath(entry.path, "project/")] = entry.data;
  }
  return {
    files,
    directories: packageData.directories.filter((path) => path.startsWith("project/")).map((path) => relativePath(path, "project/")).sort(compare),
  };
}

function externalIds(packageData: FeuilProjectPackage): Set<string> {
  const ids = new Set<string>();
  const prefix = "external/research/";
  for (const path of [...packageData.entries.map((entry) => entry.path), ...packageData.directories]) {
    if (!path.startsWith(prefix)) continue;
    const id = relativePath(path, prefix).split("/", 1)[0];
    if (id) ids.add(id);
  }
  return ids;
}

function requireDirectory(directories: readonly string[], path: string, message: string): void {
  if (!directories.includes(path)) fail(message);
}

function validateProjectReferences(manifest: FeuilProjectManifest, project: FeuilProjectImportedTree): void {
  const manuscriptPath = manifest.project.manuscriptPath;
  if (manifest.project.rootKind === "structured") requireDirectory(project.directories, manuscriptPath, "Dossier manuscrit introuvable.");
  for (const linked of manifest.project.linkedResearch) {
    if (linked.binderPath !== ".") {
      const binderPath = manuscriptPath === "." ? linked.binderPath : `${manuscriptPath}/${linked.binderPath}`;
      if (!project.directories.includes(binderPath) && !(binderPath in project.files)) {
        fail(`Binder introuvable : ${linked.binderPath}`);
      }
    }
    if (linked.target.kind === "project" && linked.target.path !== ".") {
      requireDirectory(project.directories, linked.target.path, `Dossier Research introuvable : ${linked.target.path}`);
    }
  }
}

function externalResearch(packageData: FeuilProjectPackage, manifest: FeuilProjectManifest): FeuilProjectExternalResearchImport[] {
  const referenced = new Map<string, string>();
  for (const linked of manifest.project.linkedResearch) {
    if (linked.target.kind === "external") referenced.set(linked.target.id, linked.target.name);
  }
  const available = externalIds(packageData);
  for (const id of available) if (!referenced.has(id)) fail(`Research externe orpheline : ${id}`);
  const result: FeuilProjectExternalResearchImport[] = [];
  for (const [id, name] of referenced) {
    const root = `external/research/${id}`;
    requireDirectory(packageData.directories, root, `Dossier Research externe introuvable : ${id}`);
    const files: Record<string, Uint8Array> = {};
    const prefix = `${root}/`;
    for (const entry of packageData.entries) if (entry.path.startsWith(prefix)) files[relativePath(entry.path, prefix)] = entry.data;
    result.push({
      id,
      name,
      tree: {
        files,
        directories: packageData.directories.filter((path) => path.startsWith(prefix)).map((path) => relativePath(path, prefix)).sort(compare),
      },
    });
  }
  return result.sort((left, right) => compare(left.id, right.id));
}

export async function buildFeuilProjectImportPlan(data: ArrayBuffer | Uint8Array): Promise<FeuilProjectImportPlan> {
  const packageData = await readFeuilProjectPackage(data);
  const project = projectTree(packageData);
  validateProjectReferences(packageData.manifest, project);
  return {
    manifest: packageData.manifest,
    project,
    externalResearch: externalResearch(packageData, packageData.manifest),
  };
}
