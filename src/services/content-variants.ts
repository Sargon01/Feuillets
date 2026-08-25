import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { getProjectFolder, resourcesFolderPath, resourcesSubfolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";

export type QuestionAnswerSpaceMode = "keep" | "hide";

export interface ContentVariant {
  id: string;
  name: string;
  excludedRoles: SemanticRole[];
  questionAnswerSpace: QuestionAnswerSpaceMode;
}

export interface ContentVariantsStore {
  version: 1;
  selectedVariantId: string | null;
  variants: ContentVariant[];
}

const CONTENT_VARIANTS_FILE_NAME = "content-variants.json";

export type ContentVariantsErrorCode =
  | "file-corrupted"
  | "name-required"
  | "duplicate-name"
  | "invalid-role"
  | "invalid-question-answer-space"
  | "variant-not-found"
  | "invalid-store"
  | "no-project";

export class ContentVariantsError extends Error {
  readonly code: ContentVariantsErrorCode;
  constructor(code: ContentVariantsErrorCode) {
    super(code);
    this.name = "ContentVariantsError";
    this.code = code;
  }
}

export class ContentVariantsFileCorruptedError extends ContentVariantsError {
  readonly originalError?: unknown;
  constructor(path: string, originalError?: unknown) {
    super("file-corrupted");
    this.name = "ContentVariantsFileCorruptedError";
    this.originalError = originalError;
  }
}

function emptyStore(): ContentVariantsStore {
  return { version: 1, selectedVariantId: null, variants: [] };
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function contentVariantsFilePath(app: App, settings: FeuilletsSettings | null | undefined): string | null {
  const root = getProjectFolder(app, settings);
  if (!root) return null;
  const resources = resourcesFolderPath(app, root);
  const exportsPath = resourcesSubfolderPath(app, resources, "Exports", "Export");
  return normalizePath(`${exportsPath}/${CONTENT_VARIANTS_FILE_NAME}`);
}

export async function loadContentVariants(app: App, settings: FeuilletsSettings | null | undefined): Promise<ContentVariantsStore> {
  const path = contentVariantsFilePath(app, settings);
  if (!path) return emptyStore();
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return emptyStore();
  const raw = await app.vault.read(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ContentVariantsFileCorruptedError(path, error);
  }
  if (!isValidStore(parsed)) throw new ContentVariantsFileCorruptedError(path);
  return parsed;
}

function isValidStore(value: unknown): value is ContentVariantsStore {
  if (!value || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  if (store.version !== 1 || !Array.isArray(store.variants)) return false;
  if (store.selectedVariantId !== null && typeof store.selectedVariantId !== "string") return false;
  const variants = store.variants;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of variants) {
    if (!isValidVariant(item)) return false;
    if (ids.has(item.id) || names.has(item.name.toLocaleLowerCase())) return false;
    ids.add(item.id);
    names.add(item.name.toLocaleLowerCase());
  }
  return store.selectedVariantId === null || ids.has(store.selectedVariantId);
}

function isValidVariant(value: unknown): value is ContentVariant {
  if (!value || typeof value !== "object") return false;
  const variant = value as Record<string, unknown>;
  if (typeof variant.id !== "string" || !variant.id) return false;
  if (typeof variant.name !== "string" || !variant.name.trim()) return false;
  if (variant.questionAnswerSpace !== "keep" && variant.questionAnswerSpace !== "hide") return false;
  if (!Array.isArray(variant.excludedRoles)) return false;
  const roles = variant.excludedRoles;
  return roles.every((role) => typeof role === "string" && SEMANTIC_ROLES.includes(role as SemanticRole))
    && new Set(roles).size === roles.length;
}

function normalizedRoles(roles: readonly unknown[]): SemanticRole[] {
  for (const role of roles) {
    if (typeof role !== "string" || !SEMANTIC_ROLES.includes(role as SemanticRole)) {
      throw new ContentVariantsError("invalid-role");
    }
  }
  const excluded = new Set(roles);
  return SEMANTIC_ROLES.filter((role) => excluded.has(role));
}

function validateName(name: string, variants: ContentVariant[], exceptId?: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ContentVariantsError("name-required");
  if (variants.some((variant) => variant.id !== exceptId && variant.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
    throw new ContentVariantsError("duplicate-name");
  }
  return trimmed;
}

export async function saveContentVariants(app: App, settings: FeuilletsSettings | null | undefined, store: ContentVariantsStore): Promise<void> {
  if (!isValidStore(store)) throw new ContentVariantsError("invalid-store");
  const root = getProjectFolder(app, settings);
  if (!root) throw new ContentVariantsError("no-project");
  const path = contentVariantsFilePath(app, settings);
  if (!path) throw new ContentVariantsError("no-project");
  const folderPath = path.slice(0, path.lastIndexOf("/"));
  await ensureFolder(app, folderPath);
  const json = JSON.stringify(store, null, 2);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) await app.vault.modify(existing, json);
  else await app.vault.create(path, json);
}

export async function createContentVariant(
  app: App, settings: FeuilletsSettings | null | undefined, name: string,
  excludedRoles: readonly SemanticRole[] = [], questionAnswerSpace: QuestionAnswerSpaceMode = "keep",
): Promise<ContentVariant> {
  if (questionAnswerSpace !== "keep" && questionAnswerSpace !== "hide") {
    throw new ContentVariantsError("invalid-question-answer-space");
  }
  const store = await loadContentVariants(app, settings);
  let id = newId();
  while (store.variants.some((variant) => variant.id === id)) id = newId();
  const variant: ContentVariant = { id, name: validateName(name, store.variants), excludedRoles: normalizedRoles(excludedRoles), questionAnswerSpace };
  store.variants.push(variant);
  await saveContentVariants(app, settings, store);
  return variant;
}

export async function updateContentVariant(
  app: App, settings: FeuilletsSettings | null | undefined, id: string, changes: { name: string; excludedRoles: readonly SemanticRole[]; questionAnswerSpace: QuestionAnswerSpaceMode },
): Promise<ContentVariant> {
  const store = await loadContentVariants(app, settings);
  const index = store.variants.findIndex((variant) => variant.id === id);
  if (index < 0) throw new ContentVariantsError("variant-not-found");
  if (changes.questionAnswerSpace !== "keep" && changes.questionAnswerSpace !== "hide") {
    throw new ContentVariantsError("invalid-question-answer-space");
  }
  const updated: ContentVariant = { id, name: validateName(changes.name, store.variants, id), excludedRoles: normalizedRoles(changes.excludedRoles), questionAnswerSpace: changes.questionAnswerSpace };
  store.variants[index] = updated;
  await saveContentVariants(app, settings, store);
  return updated;
}

export async function deleteContentVariant(app: App, settings: FeuilletsSettings | null | undefined, id: string): Promise<boolean> {
  const store = await loadContentVariants(app, settings);
  const index = store.variants.findIndex((variant) => variant.id === id);
  if (index < 0) return false;
  store.variants.splice(index, 1);
  if (store.selectedVariantId === id) store.selectedVariantId = null;
  await saveContentVariants(app, settings, store);
  return true;
}

export async function selectContentVariant(app: App, settings: FeuilletsSettings | null | undefined, id: string | null): Promise<void> {
  const store = await loadContentVariants(app, settings);
  if (id !== null && !store.variants.some((variant) => variant.id === id)) throw new ContentVariantsError("variant-not-found");
  store.selectedVariantId = id;
  await saveContentVariants(app, settings, store);
}

export async function selectedContentVariant(app: App, settings: FeuilletsSettings | null | undefined): Promise<ContentVariant | null> {
  const store = await loadContentVariants(app, settings);
  return store.variants.find((variant) => variant.id === store.selectedVariantId) || null;
}
