import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { getProjectFolder, resourcesFolderPath, resourcesSubfolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";

export interface ContentCollection {
  id: string;
  name: string;
  roles: SemanticRole[];
}

export interface ContentCollectionsStore {
  version: 1;
  collections: ContentCollection[];
}

const CONTENT_COLLECTIONS_FILE_NAME = "content-collections.json";

export type ContentCollectionsErrorCode =
  | "file-corrupted"
  | "name-required"
  | "duplicate-name"
  | "invalid-role"
  | "no-roles"
  | "collection-not-found"
  | "invalid-store"
  | "no-project";

export class ContentCollectionsError extends Error {
  readonly code: ContentCollectionsErrorCode;
  constructor(code: ContentCollectionsErrorCode) {
    super(code);
    this.name = "ContentCollectionsError";
    this.code = code;
  }
}

export class ContentCollectionsFileCorruptedError extends ContentCollectionsError {
  readonly originalError?: unknown;
  constructor(path: string, originalError?: unknown) {
    super("file-corrupted");
    this.name = "ContentCollectionsFileCorruptedError";
    this.originalError = originalError;
  }
}

function emptyStore(): ContentCollectionsStore {
  return { version: 1, collections: [] };
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function contentCollectionsFilePath(app: App, settings: FeuilletsSettings | null | undefined): string | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const resources = resourcesFolderPath(app, root);
  const exportsPath = resourcesSubfolderPath(app, resources, "Exports", "Export");
  return normalizePath(`${exportsPath}/${CONTENT_COLLECTIONS_FILE_NAME}`);
}

function normalizedRoles(roles: readonly unknown[]): SemanticRole[] {
  if (roles.length === 0) throw new ContentCollectionsError("no-roles");
  for (const role of roles) {
    if (typeof role !== "string" || !SEMANTIC_ROLES.includes(role as SemanticRole)) {
      throw new ContentCollectionsError("invalid-role");
    }
  }
  const selected = new Set(roles);
  return SEMANTIC_ROLES.filter((role) => selected.has(role));
}

function validateName(name: string, collections: ContentCollection[], exceptId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentCollectionsError("name-required");
  if (collections.some((collection) => collection.id !== exceptId && collection.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
    throw new ContentCollectionsError("duplicate-name");
  }
  return trimmed;
}

function isValidCollection(value: unknown): value is ContentCollection {
  if (!value || typeof value !== "object") return false;
  const collection = value as Record<string, unknown>;
  if (typeof collection.id !== "string" || !collection.id || typeof collection.name !== "string" || !collection.name.trim()) return false;
  if (!Array.isArray(collection.roles) || collection.roles.length === 0) return false;
  const roles = collection.roles;
  return roles.every((role) => typeof role === "string" && SEMANTIC_ROLES.includes(role as SemanticRole))
    && new Set(roles).size === roles.length;
}

function isValidStore(value: unknown): value is ContentCollectionsStore {
  if (!value || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  if (store.version !== 1 || !Array.isArray(store.collections)) return false;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of store.collections) {
    if (!isValidCollection(item)) return false;
    if (ids.has(item.id) || names.has(item.name.trim().toLocaleLowerCase())) return false;
    ids.add(item.id);
    names.add(item.name.trim().toLocaleLowerCase());
  }
  return true;
}

function normalizeStore(store: ContentCollectionsStore): ContentCollectionsStore {
  return {
    version: 1,
    collections: store.collections.map((collection) => ({
      id: collection.id,
      name: collection.name.trim(),
      roles: SEMANTIC_ROLES.filter((role) => collection.roles.includes(role)),
    })),
  };
}

async function saveContentCollections(app: App, settings: FeuilletsSettings | null | undefined, store: ContentCollectionsStore): Promise<void> {
  if (!isValidStore(store)) throw new ContentCollectionsError("invalid-store");
  const root = getProjectFolder(app, settings);
  if (!root) throw new ContentCollectionsError("no-project");
  const path = contentCollectionsFilePath(app, settings);
  if (!path) throw new ContentCollectionsError("no-project");
  await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));
  const existing = app.vault.getAbstractFileByPath(path);
  const json = JSON.stringify(normalizeStore(store), null, 2);
  if (existing instanceof TFile) await app.vault.modify(existing, json);
  else await app.vault.create(path, json);
}

export async function loadContentCollections(app: App, settings: FeuilletsSettings | null | undefined): Promise<ContentCollectionsStore> {
  const path = contentCollectionsFilePath(app, settings);
  if (!path) return emptyStore();
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return emptyStore();
  const raw = await app.vault.read(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ContentCollectionsFileCorruptedError(path, error);
  }
  if (!isValidStore(parsed)) throw new ContentCollectionsFileCorruptedError(path);
  return normalizeStore(parsed);
}

export async function createContentCollection(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  name: string,
  roles: readonly SemanticRole[],
): Promise<ContentCollection> {
  const store = await loadContentCollections(app, settings);
  const collection: ContentCollection = {
    id: newId(),
    name: validateName(name, store.collections),
    roles: normalizedRoles(roles),
  };
  while (store.collections.some((item) => item.id === collection.id)) collection.id = newId();
  store.collections.push(collection);
  await saveContentCollections(app, settings, store);
  return collection;
}

export async function updateContentCollection(
  app: App,
  settings: FeuilletsSettings | null | undefined,
  id: string,
  changes: { name: string; roles: readonly SemanticRole[] },
): Promise<ContentCollection> {
  const store = await loadContentCollections(app, settings);
  const index = store.collections.findIndex((item) => item.id === id);
  if (index < 0) throw new ContentCollectionsError("collection-not-found");
  const collection: ContentCollection = {
    id,
    name: validateName(changes.name, store.collections, id),
    roles: normalizedRoles(changes.roles),
  };
  store.collections[index] = collection;
  await saveContentCollections(app, settings, store);
  return collection;
}

export async function deleteContentCollection(app: App, settings: FeuilletsSettings | null | undefined, id: string): Promise<boolean> {
  const store = await loadContentCollections(app, settings);
  const index = store.collections.findIndex((item) => item.id === id);
  if (index < 0) return false;
  store.collections.splice(index, 1);
  await saveContentCollections(app, settings, store);
  return true;
}
