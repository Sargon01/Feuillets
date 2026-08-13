import JSZip from "jszip";

/** Current limits for untrusted .feuillets archives. */
export const FEUILLETS_PACKAGE_LIMITS = {
  maxEntries: 1_000,
  maxDecompressedBytes: 50 * 1024 * 1024,
} as const;

export type FeuilletsPackageKind = "review" | "project";

export type FeuilletsManifest = {
  format: "feuillets";
  version: 1;
  kind: FeuilletsPackageKind;
  packageId: string;
  createdAt: string;
  createdByVersion: string;
  [key: string]: unknown;
};

export type FeuilletsPackageFile = string | Uint8Array | ArrayBuffer;

export type FeuilletsPackageEntry = {
  path: string;
  data: Uint8Array;
};

export type FeuilletsPackage = {
  manifest: FeuilletsManifest;
  entries: FeuilletsPackageEntry[];
};

export class FeuilletsPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeuilletsPackageError";
  }
}

const MANIFEST_PATH = "manifest.json";
const DANGEROUS_MANIFEST_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function fail(message: string): never {
  throw new FeuilletsPackageError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlySafeKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(hasOnlySafeKeys);
  if (!isPlainObject(value)) return true;
  return Object.keys(value).every((key) => !DANGEROUS_MANIFEST_KEYS.has(key) && hasOnlySafeKeys(value[key]));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
}

/** Validates and returns the manifest without stripping safe future fields. */
export function validateFeuilletsManifest(value: unknown): FeuilletsManifest {
  if (!isPlainObject(value) || !hasOnlySafeKeys(value)) fail("Manifest .feuillets invalide.");
  if (value.format !== "feuillets") fail("Format .feuillets invalide.");
  if (value.version !== 1) fail("Version .feuillets non prise en charge.");
  if (value.kind !== "review" && value.kind !== "project") fail("Kind .feuillets invalide.");
  if (!isNonEmptyString(value.packageId)) fail("packageId .feuillets invalide.");
  if (!isNonEmptyString(value.createdAt)) fail("createdAt .feuillets invalide.");
  if (!isNonEmptyString(value.createdByVersion)) fail("createdByVersion .feuillets invalide.");
  return value as FeuilletsManifest;
}

function validateEntryPath(path: string): void {
  if (!path || path === MANIFEST_PATH) fail("Chemin d’entrée .feuillets invalide.");
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
    fail("Chemin absolu .feuillets refusé.");
  }
  if (path.includes("\\") || path.split("/").some((part) => part === ".." || part === "" || part === ".")) {
    fail("Chemin d’entrée .feuillets dangereux.");
  }
  if (/^[A-Za-z]+:/.test(path) || /[<>:"|?*]/.test(path) || hasControlCharacter(path)) {
    fail("Chemin Windows .feuillets dangereux.");
  }
}

function validateArchiveEntryPath(path: string, isDirectory: boolean): void {
  if (isDirectory) {
    if (!path.endsWith("/")) fail("Chemin d’entrée .feuillets invalide.");
    path = path.slice(0, -1);
  }
  validateEntryPath(path);
}

function assertFileData(data: unknown): asserts data is FeuilletsPackageFile {
  if (typeof data === "string" || data instanceof Uint8Array || data instanceof ArrayBuffer) return;
  fail("Donnée d’entrée .feuillets invalide.");
}

function zipEntries(zip: JSZip): Array<[string, JSZip.JSZipObject]> {
  return Object.entries(zip.files).filter(([, entry]) => !entry.dir);
}

function archiveSize(entry: JSZip.JSZipObject): number | undefined {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data;
  return typeof data?.uncompressedSize === "number" ? data.uncompressedSize : undefined;
}

/** Creates an in-memory .feuillets ZIP. No filesystem or Vault API is used. */
export async function createFeuilletsPackage(
  manifest: FeuilletsManifest,
  files: Record<string, FeuilletsPackageFile>,
): Promise<Uint8Array> {
  const validatedManifest = validateFeuilletsManifest(manifest);
  const fileEntries = Object.entries(files);
  if (fileEntries.length + 1 > FEUILLETS_PACKAGE_LIMITS.maxEntries) fail("Trop d’entrées .feuillets.");

  const zip = new JSZip();
  zip.file(MANIFEST_PATH, JSON.stringify(validatedManifest));
  let totalBytes = new TextEncoder().encode(JSON.stringify(validatedManifest)).byteLength;
  for (const [path, data] of fileEntries) {
    validateEntryPath(path);
    assertFileData(data);
    const byteLength = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
    totalBytes += byteLength;
    if (totalBytes > FEUILLETS_PACKAGE_LIMITS.maxDecompressedBytes) fail("Archive .feuillets trop volumineuse.");
    zip.file(path, data, { createFolders: false });
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Reads, validates, and keeps all archive data in memory. */
export async function readFeuilletsPackage(data: ArrayBuffer | Uint8Array): Promise<FeuilletsPackage> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data, { createFolders: false });
  } catch {
    fail("Archive .feuillets invalide.");
  }

  const entries = zipEntries(zip);
  if (entries.length > FEUILLETS_PACKAGE_LIMITS.maxEntries) fail("Trop d’entrées .feuillets.");
  for (const [path, entry] of Object.entries(zip.files)) {
    const originalPath = entry.unsafeOriginalName ?? path;
    if (originalPath !== MANIFEST_PATH) validateArchiveEntryPath(originalPath, entry.dir);
  }
  const manifestEntry = entries.find(([path]) => path === MANIFEST_PATH)?.[1];
  if (!manifestEntry) fail("manifest.json .feuillets absent.");

  let manifest: FeuilletsManifest;
  try {
    manifest = validateFeuilletsManifest(JSON.parse(await manifestEntry.async("text")));
  } catch (error) {
    if (error instanceof FeuilletsPackageError) throw error;
    fail("manifest.json .feuillets invalide.");
  }

  let totalBytes = 0;
  const validatedEntries: FeuilletsPackageEntry[] = [];
  for (const [path, entry] of entries) {
    const declaredSize = archiveSize(entry);
    if (declaredSize !== undefined) {
      totalBytes += declaredSize;
      if (totalBytes > FEUILLETS_PACKAGE_LIMITS.maxDecompressedBytes) fail("Archive .feuillets trop volumineuse.");
    }
    if (path === MANIFEST_PATH) continue;
    const entryData = await entry.async("uint8array");
    if (declaredSize === undefined) {
      totalBytes += entryData.byteLength;
      if (totalBytes > FEUILLETS_PACKAGE_LIMITS.maxDecompressedBytes) fail("Archive .feuillets trop volumineuse.");
    }
    validatedEntries.push({ path, data: entryData });
  }
  return { manifest, entries: validatedEntries };
}
