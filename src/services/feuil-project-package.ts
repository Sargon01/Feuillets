import JSZip from "jszip";

export const FEUIL_PROJECT_EXTENSION = "feuil";
export const FEUIL_PROJECT_FORMAT = "feuil";
export const FEUIL_PROJECT_VERSION = 1;

export const FEUIL_PROJECT_PACKAGE_LIMITS = {
  maxEntries: 20_000,
  maxManifestBytes: 1 * 1024 * 1024,
  maxDecompressedBytes: 1024 * 1024 * 1024,
} as const;

const MANIFEST_PATH = "manifest.json";
const DANGEROUS_MANIFEST_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type FeuilProjectLinkedResearch = {
  binderPath: string;
  target:
    | { kind: "project"; path: string }
    | { kind: "external"; id: string; name: string };
};

export type FeuilProjectManifest = {
  format: typeof FEUIL_PROJECT_FORMAT;
  version: typeof FEUIL_PROJECT_VERSION;
  packageId: string;
  createdAt: string;
  createdByVersion: string;
  project: {
    name: string;
    rootKind: "structured" | "adopted";
    manuscriptPath: string;
    structure: {
      level1Role: "parties" | "chapitres";
    };
    meta: Record<string, unknown>;
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
    linkedResearch: FeuilProjectLinkedResearch[];
  };
  [key: string]: unknown;
};

export type FeuilProjectPackageFile = string | Uint8Array | ArrayBuffer;

export type FeuilProjectPackageEntry = {
  path: string;
  data: Uint8Array;
};

export type FeuilProjectPackage = {
  manifest: FeuilProjectManifest;
  entries: FeuilProjectPackageEntry[];
  directories: string[];
};

export class FeuilProjectPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeuilProjectPackageError";
  }
}

function fail(message: string): never {
  throw new FeuilProjectPackageError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function hasOnlySafeKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(hasOnlySafeKeys);
  if (!isPlainObject(value)) return true;
  return Object.keys(value).every((key) => !DANGEROUS_MANIFEST_KEYS.has(key) && hasOnlySafeKeys(value[key]));
}

function isPortableSegment(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value.includes("/") || value.includes("\\")) return false;
  if (hasControlCharacter(value) || /[<>:"|?*]/.test(value) || value.endsWith(".") || value.endsWith(" ")) return false;
  const baseName = value.split(".", 1)[0].toUpperCase();
  return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName);
}

function validateRelativePath(value: unknown, allowRoot = false): value is string {
  if (allowRoot && value === ".") return true;
  if (typeof value !== "string" || value.length === 0 || hasControlCharacter(value)) return false;
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  return value.split("/").every(isPortableSegment);
}

function validateStringRecord(value: unknown, validator: (item: unknown) => boolean): value is Record<string, unknown> {
  return isPlainObject(value) && Object.entries(value).every(([key, item]) => validateRelativePath(key, true) && validator(item));
}

function validatePathSettings(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const { orders, folderPositions, folderGoals } = value;
  return validateStringRecord(orders, (item) => Array.isArray(item) && item.every((name) => typeof name === "string" && isPortableSegment(name)))
    && validateStringRecord(folderPositions, (item) => typeof item === "number" && Number.isFinite(item))
    && validateStringRecord(folderGoals, (item) => typeof item === "number" && Number.isFinite(item));
}

function validateLinkedResearch(value: unknown): value is FeuilProjectLinkedResearch[] {
  if (!Array.isArray(value)) return false;
  const binderPaths = new Set<string>();
  const externalNames = new Map<string, string>();
  return value.every((item) => {
    if (!isPlainObject(item) || !validateRelativePath(item.binderPath, true) || binderPaths.has(item.binderPath)) return false;
    binderPaths.add(item.binderPath);
    if (!isPlainObject(item.target)) return false;
    if (item.target.kind === "project") return validateRelativePath(item.target.path, true);
    if (item.target.kind !== "external" || typeof item.target.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.target.id) || !isNonEmptyString(item.target.name) || hasControlCharacter(item.target.name)) return false;
    const previousName = externalNames.get(item.target.id);
    if (previousName !== undefined && previousName !== item.target.name) return false;
    externalNames.set(item.target.id, item.target.name);
    return true;
  });
}

function validateNarrativeState(value: unknown): boolean {
  if (!isPlainObject(value) || !Array.isArray(value.resolved) || !value.resolved.every((item) => typeof item === "string")) return false;
  const validatePaths = (record: unknown): boolean => isPlainObject(record) && Object.entries(record).every(([key, path]) => (
    isNonEmptyString(key) && !hasControlCharacter(key) && typeof path === "string" && validateRelativePath(path, true)
  ));
  return validatePaths(value.placeholders) && validatePaths(value.origins);
}

/** Validates and returns a V1 manifest without removing safe future fields. */
export function validateFeuilProjectManifest(value: unknown): FeuilProjectManifest {
  if (!isPlainObject(value) || !hasOnlySafeKeys(value)) fail("Manifeste .feuil invalide.");
  if (value.format !== FEUIL_PROJECT_FORMAT) fail("Format .feuil invalide.");
  if (value.version !== FEUIL_PROJECT_VERSION) fail("Version .feuil non prise en charge.");
  if (!isNonEmptyString(value.packageId)) fail("packageId .feuil invalide.");
  if (!isNonEmptyString(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) fail("createdAt .feuil invalide.");
  if (!isNonEmptyString(value.createdByVersion)) fail("createdByVersion .feuil invalide.");
  if (!isPlainObject(value.project)) fail("Projet .feuil invalide.");

  const project = value.project;
  if (!isNonEmptyString(project.name)) fail("Nom de projet .feuil invalide.");
  if (project.rootKind !== "structured" && project.rootKind !== "adopted") fail("rootKind .feuil invalide.");
  if (!validateRelativePath(project.manuscriptPath, true)) fail("manuscriptPath .feuil invalide.");
  if ((project.rootKind === "adopted" && project.manuscriptPath !== ".")
    || (project.rootKind === "structured" && project.manuscriptPath === ".")) fail("rootKind et manuscriptPath .feuil incohérents.");
  if (!isPlainObject(project.structure) || (project.structure.level1Role !== "parties" && project.structure.level1Role !== "chapitres")) fail("structure .feuil invalide.");
  if (!isPlainObject(project.meta)) fail("meta .feuil invalide.");
  if (!validatePathSettings(project.pathSettings)) fail("pathSettings .feuil invalide.");
  if (!validateNarrativeState(project.narrativeState)) fail("narrativeState .feuil invalide.");
  if (!validateLinkedResearch(project.linkedResearch)) fail("linkedResearch .feuil invalide.");
  return value as FeuilProjectManifest;
}

function validateFilePath(path: string): void {
  if (!validateRelativePath(path) || path === MANIFEST_PATH) fail("Chemin d’entrée .feuil invalide.");
  if (!path.startsWith("project/") && !path.startsWith("external/research/")) {
    fail("Espace d’entrée .feuil invalide.");
  }
}

function validateArchiveEntryPath(path: string, isDirectory: boolean): void {
  const normalizedPath = isDirectory && path.endsWith("/") ? path.slice(0, -1) : path;
  if (isDirectory && !path.endsWith("/")) fail("Chemin de dossier .feuil invalide.");
  if (normalizedPath === "project" || normalizedPath === "external" || normalizedPath === "external/research") return;
  validateFilePath(normalizedPath);
}

function assertFileData(data: unknown): asserts data is FeuilProjectPackageFile {
  if (typeof data === "string" || data instanceof Uint8Array || data instanceof ArrayBuffer) return;
  fail("Donnée d’entrée .feuil invalide.");
}

function archiveSize(entry: JSZip.JSZipObject): number | undefined {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data;
  const size = data?.uncompressedSize;
  return typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}

function validateEntryTopology(filePaths: readonly string[], directoryPaths: readonly string[]): void {
  const files = new Set(filePaths);
  const directories = new Set(directoryPaths);
  for (const path of files) {
    if (directories.has(path)) fail("Collision fichier/dossier .feuil.");
  }
  for (const path of [...filePaths, ...directoryPaths]) {
    const segments = path.split("/");
    let ancestor = "";
    for (let index = 0; index < segments.length - 1; index += 1) {
      ancestor = ancestor ? `${ancestor}/${segments[index]}` : segments[index];
      if (files.has(ancestor)) fail("Fichier ancêtre .feuil interdit.");
    }
  }
}

/** Creates an in-memory .feuil project archive. No filesystem or Vault API is used. */
export async function createFeuilProjectPackage(
  manifest: FeuilProjectManifest,
  files: Record<string, FeuilProjectPackageFile>,
  directories: string[] = [],
): Promise<Uint8Array> {
  const validatedManifest = validateFeuilProjectManifest(manifest);
  const fileEntries = Object.entries(files);
  if (fileEntries.some(([path]) => path === MANIFEST_PATH)) fail("manifest.json .feuil réservé.");
  if (fileEntries.length + directories.length + 1 > FEUIL_PROJECT_PACKAGE_LIMITS.maxEntries) fail("Trop d’entrées .feuil.");
  const manifestJson = JSON.stringify(validatedManifest);
  const manifestBytes = new TextEncoder().encode(manifestJson).byteLength;
  if (manifestBytes > FEUIL_PROJECT_PACKAGE_LIMITS.maxManifestBytes) fail("manifest.json .feuil trop volumineux.");

  const filePaths = new Set(fileEntries.map(([path]) => path));
  const directoryPaths = new Set<string>();
  for (const [path, entryData] of fileEntries) {
    validateFilePath(path);
    assertFileData(entryData);
  }
  for (const path of directories) {
    validateFilePath(path);
    if (directoryPaths.has(path)) fail("Dossier .feuil dupliqué.");
    directoryPaths.add(path);
  }
  validateEntryTopology([...filePaths], [...directoryPaths]);

  const zip = new JSZip();
  zip.file(MANIFEST_PATH, manifestJson);
  for (const path of directoryPaths) zip.file(`${path}/`, "", { createFolders: false, dir: true });
  let totalBytes = manifestBytes;
  for (const [path, data] of fileEntries) {
    const byteLength = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
    totalBytes += byteLength;
    if (totalBytes > FEUIL_PROJECT_PACKAGE_LIMITS.maxDecompressedBytes) fail("Archive .feuil trop volumineuse.");
    zip.file(path, data, { createFolders: false });
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Reads, validates, and keeps all .feuil archive data in memory. */
export async function readFeuilProjectPackage(data: ArrayBuffer | Uint8Array): Promise<FeuilProjectPackage> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data, { createFolders: false });
  } catch {
    fail("Archive .feuil invalide.");
  }

  const allEntries = Object.entries(zip.files);
  if (allEntries.length > FEUIL_PROJECT_PACKAGE_LIMITS.maxEntries) fail("Trop d’entrées .feuil.");
  let declaredTotalBytes = 0;
  const archiveFilePaths: string[] = [];
  const archiveDirectoryPaths: string[] = [];
  for (const [path, entry] of allEntries) {
    const originalPath = entry.unsafeOriginalName ?? path;
    if (originalPath !== MANIFEST_PATH || entry.dir) validateArchiveEntryPath(originalPath, entry.dir);
    if (entry.dir) archiveDirectoryPaths.push(path.slice(0, -1));
    else if (path !== MANIFEST_PATH) archiveFilePaths.push(path);
    const declaredSize = archiveSize(entry);
    if (declaredSize !== undefined) {
      declaredTotalBytes += declaredSize;
      if (declaredTotalBytes > FEUIL_PROJECT_PACKAGE_LIMITS.maxDecompressedBytes) fail("Archive .feuil trop volumineuse.");
    }
  }
  validateEntryTopology(archiveFilePaths, archiveDirectoryPaths);

  const manifestEntry = allEntries.find(([path, entry]) => path === MANIFEST_PATH && !entry.dir)?.[1];
  if (!manifestEntry) fail("manifest.json .feuil absent.");
  const declaredManifestBytes = archiveSize(manifestEntry);
  if (declaredManifestBytes === undefined || declaredManifestBytes > FEUIL_PROJECT_PACKAGE_LIMITS.maxManifestBytes) {
    fail("manifest.json .feuil trop volumineux.");
  }

  let manifest: FeuilProjectManifest;
  let manifestByteLength: number;
  try {
    const manifestText = await manifestEntry.async("text");
    manifestByteLength = new TextEncoder().encode(manifestText).byteLength;
    if (manifestByteLength > FEUIL_PROJECT_PACKAGE_LIMITS.maxManifestBytes) fail("manifest.json .feuil trop volumineux.");
    manifest = validateFeuilProjectManifest(JSON.parse(manifestText));
  } catch (error) {
    if (error instanceof FeuilProjectPackageError) throw error;
    fail("manifest.json .feuil invalide.");
  }

  let totalBytes = manifestByteLength;
  const entries: FeuilProjectPackageEntry[] = [];
  const directories = archiveDirectoryPaths.filter((path) => path !== "project" && path !== "external" && path !== "external/research");
  for (const [path, entry] of allEntries) {
    if (entry.dir) continue;
    if (path === MANIFEST_PATH) continue;
    const entryData = await entry.async("uint8array");
    totalBytes += entryData.byteLength;
    if (totalBytes > FEUIL_PROJECT_PACKAGE_LIMITS.maxDecompressedBytes) fail("Archive .feuil trop volumineuse.");
    entries.push({ path, data: entryData });
  }
  return { manifest, entries, directories };
}
