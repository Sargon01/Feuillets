import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { getProjectFolder, resourcesFolderPath, resourcesSubfolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";

export interface ContentExtraction {
  id: string;
  name: string;
  triggerRoles: SemanticRole[];
}

export interface ContentExtractionsStore {
  version: 1;
  extractions: ContentExtraction[];
}

const CONTENT_EXTRACTIONS_FILE_NAME = "content-extractions.json";

export type ContentExtractionsErrorCode =
  | "file-corrupted"
  | "name-required"
  | "duplicate-name"
  | "invalid-role"
  | "no-roles"
  | "extraction-not-found"
  | "invalid-store"
  | "no-project";

export class ContentExtractionsError extends Error {
  readonly code: ContentExtractionsErrorCode;
  constructor(code: ContentExtractionsErrorCode) {
    super(code);
    this.name = "ContentExtractionsError";
    this.code = code;
  }
}

export class ContentExtractionsFileCorruptedError extends ContentExtractionsError {
  readonly originalError?: unknown;
  constructor(path: string, originalError?: unknown) {
    super("file-corrupted");
    this.name = "ContentExtractionsFileCorruptedError";
    this.originalError = originalError;
  }
}

function emptyStore(): ContentExtractionsStore {
  return { version: 1, extractions: [] };
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function contentExtractionsFilePath(app: App, settings: FeuilletsSettings | null | undefined): string | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const resources = resourcesFolderPath(app, root);
  const exportsPath = resourcesSubfolderPath(app, resources, "Exports", "Export");
  return normalizePath(`${exportsPath}/${CONTENT_EXTRACTIONS_FILE_NAME}`);
}

function normalizedRoles(roles: readonly unknown[]): SemanticRole[] {
  if (roles.length === 0) throw new ContentExtractionsError("no-roles");
  for (const role of roles) {
    if (typeof role !== "string" || !SEMANTIC_ROLES.includes(role as SemanticRole)) {
      throw new ContentExtractionsError("invalid-role");
    }
  }
  const selected = new Set(roles);
  return SEMANTIC_ROLES.filter((role) => selected.has(role));
}

function validateName(name: string, extractions: ContentExtraction[], exceptId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentExtractionsError("name-required");
  if (extractions.some((extraction) => extraction.id !== exceptId && extraction.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
    throw new ContentExtractionsError("duplicate-name");
  }
  return trimmed;
}

function isValidExtraction(value: unknown): value is ContentExtraction {
  if (!value || typeof value !== "object") return false;
  const extraction = value as Record<string, unknown>;
  if (typeof extraction.id !== "string" || !extraction.id || typeof extraction.name !== "string" || !extraction.name.trim()) return false;
  if (!Array.isArray(extraction.triggerRoles) || extraction.triggerRoles.length === 0) return false;
  const roles = extraction.triggerRoles;
  return roles.every((role) => typeof role === "string" && SEMANTIC_ROLES.includes(role as SemanticRole))
    && new Set(roles).size === roles.length;
}

function isValidStore(value: unknown): value is ContentExtractionsStore {
  if (!value || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  if (store.version !== 1 || !Array.isArray(store.extractions)) return false;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of store.extractions) {
    if (!isValidExtraction(item)) return false;
    if (ids.has(item.id) || names.has(item.name.trim().toLocaleLowerCase())) return false;
    ids.add(item.id);
    names.add(item.name.trim().toLocaleLowerCase());
  }
  return true;
}

function normalizeStore(store: ContentExtractionsStore): ContentExtractionsStore {
  return {
    version: 1,
    extractions: store.extractions.map((extraction) => ({
      id: extraction.id,
      name: extraction.name.trim(),
      triggerRoles: SEMANTIC_ROLES.filter((role) => extraction.triggerRoles.includes(role)),
    })),
  };
}

async function saveContentExtractions(app: App, settings: FeuilletsSettings | null | undefined, store: ContentExtractionsStore): Promise<void> {
  if (!isValidStore(store)) throw new ContentExtractionsError("invalid-store");
  const root = getProjectFolder(app, settings);
  if (!root) throw new ContentExtractionsError("no-project");
  const path = contentExtractionsFilePath(app, settings);
  if (!path) throw new ContentExtractionsError("no-project");
  await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));
  const existing = app.vault.getAbstractFileByPath(path);
  const json = JSON.stringify(normalizeStore(store), null, 2);
  if (existing instanceof TFile) await app.vault.modify(existing, json);
  else await app.vault.create(path, json);
}

export async function loadContentExtractions(app: App, settings: FeuilletsSettings | null | undefined): Promise<ContentExtractionsStore> {
  const path = contentExtractionsFilePath(app, settings);
  if (!path) return emptyStore();
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return emptyStore();
  const raw = await app.vault.read(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ContentExtractionsFileCorruptedError(path, error);
  }
  if (!isValidStore(parsed)) throw new ContentExtractionsFileCorruptedError(path);
  return normalizeStore(parsed);
}

export async function createContentExtraction(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  name: string,
  triggerRoles: readonly SemanticRole[],
): Promise<ContentExtraction> {
  const store = await loadContentExtractions(app, settings);
  const extraction: ContentExtraction = {
    id: newId(),
    name: validateName(name, store.extractions),
    triggerRoles: normalizedRoles(triggerRoles),
  };
  while (store.extractions.some((item) => item.id === extraction.id)) extraction.id = newId();
  store.extractions.push(extraction);
  await saveContentExtractions(app, settings, store);
  return extraction;
}

export async function updateContentExtraction(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  id: string,
  changes: { name: string; triggerRoles: readonly SemanticRole[] },
): Promise<ContentExtraction> {
  const store = await loadContentExtractions(app, settings);
  const index = store.extractions.findIndex((item) => item.id === id);
  if (index < 0) throw new ContentExtractionsError("extraction-not-found");
  const extraction: ContentExtraction = {
    id,
    name: validateName(changes.name, store.extractions, id),
    triggerRoles: normalizedRoles(changes.triggerRoles),
  };
  store.extractions[index] = extraction;
  await saveContentExtractions(app, settings, store);
  return extraction;
}

export async function deleteContentExtraction(app: App, settings: FeuilletsSettings | null | undefined, id: string): Promise<boolean> {
  const store = await loadContentExtractions(app, settings);
  const index = store.extractions.findIndex((item) => item.id === id);
  if (index < 0) return false;
  store.extractions.splice(index, 1);
  await saveContentExtractions(app, settings, store);
  return true;
}
