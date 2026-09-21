import { TFile, normalizePath, type App } from "obsidian";
import { getProjectFolder, internalResourcesFolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { t } from "../i18n/index.js";
import { createSourceAnchor, resolveSourceAnchor, type SourceAnchor, type ResolvedSourceRange } from "./source-anchor.js";

export type CitationOccurrence = SourceAnchor & {
  id: string;
  file: string;
  sourcePath: string;
};

export type CitationRegistry = {
  version: 1;
  citations: CitationOccurrence[];
};

export class CitationRegistryCorruptedError extends Error {
  constructor(readonly path: string) {
    super(`Registre de citations invalide : ${path}`);
  }
}

export function citationRegistryPath(app: App, settings: FeuilletsSettings | null | undefined): string | null {
  const root = getProjectFolder(app, settings);
  return root ? normalizePath(`${internalResourcesFolderPath(app, root)}/citations.json`) : null;
}

function emptyRegistry(): CitationRegistry {
  return { version: 1, citations: [] };
}

function isSourceAnchor(value: unknown): value is SourceAnchor {
  if (!value || typeof value !== "object") return false;
  const anchor = value as Record<string, unknown>;
  return Number.isInteger(anchor.start) && Number.isInteger(anchor.end)
    && typeof anchor.quote === "string"
    && typeof anchor.prefix === "string"
    && typeof anchor.suffix === "string";
}

function isCitationOccurrence(value: unknown): value is CitationOccurrence {
  if (!value || typeof value !== "object") return false;
  const occurrence = value as Record<string, unknown>;
  return typeof occurrence.id === "string"
    && typeof occurrence.file === "string"
    && typeof occurrence.sourcePath === "string"
    && isSourceAnchor(value);
}

function isCitationRegistry(value: unknown): value is CitationRegistry {
  if (!value || typeof value !== "object") return false;
  const registry = value as Record<string, unknown>;
  return registry.version === 1
    && Array.isArray(registry.citations)
    && registry.citations.every((citation) => isCitationOccurrence(citation));
}

function validateRegistry(registry: CitationRegistry, path: string): void {
  if (!isCitationRegistry(registry)) throw new CitationRegistryCorruptedError(path);
}

function occurrenceId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export async function loadCitationRegistry(
  app: App,
  settings: FeuilletsSettings | null | undefined
): Promise<CitationRegistry> {
  const path = citationRegistryPath(app, settings);
  if (!path) return emptyRegistry();
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return emptyRegistry();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await app.vault.read(file));
  } catch {
    throw new CitationRegistryCorruptedError(path);
  }
  if (!isCitationRegistry(parsed)) throw new CitationRegistryCorruptedError(path);
  return parsed;
}

export async function saveCitationRegistry(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  registry: CitationRegistry
): Promise<void> {
  const path = citationRegistryPath(app, settings);
  if (!path) throw new Error(t("analysis.dashboard.noActiveProject"));
  validateRegistry(registry, path);
  const root = getProjectFolder(app, settings);
  if (!root) throw new Error(t("analysis.dashboard.noActiveProject"));
  const folder = internalResourcesFolderPath(app, root);
  await ensureFolder(app, folder);
  const json = JSON.stringify(registry, null, 2);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) await app.vault.modify(existing, json);
  else await app.vault.create(path, json);
}

function manuscriptRelativePath(rootPath: string, filePath: string): string | null {
  const root = normalizePath(rootPath);
  const file = normalizePath(filePath);
  if (!file.startsWith(`${root}/`)) return null;
  return file.slice(root.length + 1);
}

export async function addCitationOccurrence(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  manuscriptFile: TFile,
  sourceFile: TFile,
  content: string,
  start: number,
  end: number
): Promise<CitationOccurrence | null> {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const relativeFile = manuscriptRelativePath(root.path, manuscriptFile.path);
  if (!relativeFile) return null;
  const anchor = createSourceAnchor(content, start, end);
  if (!anchor) return null;
  const registry = await loadCitationRegistry(app, settings);
  const occurrence: CitationOccurrence = {
    id: occurrenceId(),
    file: relativeFile,
    sourcePath: sourceFile.path,
    ...anchor,
  };
  registry.citations.push(occurrence);
  await saveCitationRegistry(app, settings, registry);
  return occurrence;
}

export function resolveCitationOccurrence(
  occurrence: CitationOccurrence,
  content: string
): ResolvedSourceRange | null {
  return resolveSourceAnchor(occurrence, content);
}

export type CompileCitationResolution = {
  sourceFiles: TFile[];
  hasIndexedOccurrences: boolean;
};

/** Résout les Sources citées par une liste déjà résolue par CompileScope.
 * Le registre est chargé une seule fois ; une occurrence présente mais
 * devenue introuvable reste comptée dans hasIndexedOccurrences. */
export async function resolveCitedSourceFilesForCompileFiles(
  app: App,
  settings: FeuilletsSettings,
  compileFiles: TFile[]
): Promise<CompileCitationResolution> {
  const registry = await loadCitationRegistry(app, settings);
  const byFile = new Map<string, CitationOccurrence[]>();
  for (const occurrence of registry.citations) {
    const entries = byFile.get(occurrence.file);
    if (entries) entries.push(occurrence);
    else byFile.set(occurrence.file, [occurrence]);
  }

  const root = getProjectFolder(app, settings);
  if (!root) return { sourceFiles: [], hasIndexedOccurrences: false };
  const sourceFiles: TFile[] = [];
  const seenSources = new Set<string>();
  let hasIndexedOccurrences = false;
  for (const file of compileFiles) {
    const relativeFile = manuscriptRelativePath(root.path, file.path);
    if (!relativeFile) continue;
    const occurrences = byFile.get(relativeFile);
    if (!occurrences) continue;
    hasIndexedOccurrences = true;
    const content = await app.vault.read(file);
    for (const occurrence of occurrences) {
      if (!resolveSourceAnchor(occurrence, content)) continue;
      const source = app.vault.getAbstractFileByPath(normalizePath(occurrence.sourcePath));
      if (!(source instanceof TFile) || seenSources.has(source.path)) continue;
      seenSources.add(source.path);
      sourceFiles.push(source);
    }
  }
  return { sourceFiles, hasIndexedOccurrences };
}

function remapPath(path: string, oldPath: string, newPath: string): string | null {
  const oldValue = normalizePath(oldPath);
  const newValue = normalizePath(newPath);
  const current = normalizePath(path);
  if (current === oldValue) return newValue;
  if (current.startsWith(`${oldValue}/`)) return `${newValue}${current.slice(oldValue.length)}`;
  return null;
}

/** Suit les chemins des feuillets relatifs au Manuscrit et les chemins
 * physiques des Sources, sans supprimer d'occurrence. */
export async function remapCitationRegistryAfterRename(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  oldPath: string,
  newPath: string
): Promise<boolean> {
  if (!oldPath || !newPath || oldPath === newPath) return false;
  const root = getProjectFolder(app, settings);
  if (!root) return false;
  const registry = await loadCitationRegistry(app, settings);
  let changed = false;
  const oldFileRelative = manuscriptRelativePath(root.path, oldPath);
  const newFileRelative = manuscriptRelativePath(root.path, newPath);
  for (const occurrence of registry.citations) {
    if (oldFileRelative && newFileRelative) {
      const remappedFile = remapPath(occurrence.file, oldFileRelative, newFileRelative);
      if (remappedFile && remappedFile !== occurrence.file) {
        occurrence.file = remappedFile;
        changed = true;
      }
    }
    const remappedSource = remapPath(occurrence.sourcePath, oldPath, newPath);
    if (remappedSource && remappedSource !== occurrence.sourcePath) {
      occurrence.sourcePath = remappedSource;
      changed = true;
    }
  }
  if (changed) await saveCitationRegistry(app, settings, registry);
  return changed;
}
