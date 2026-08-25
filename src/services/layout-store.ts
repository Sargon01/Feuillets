import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { getProjectFolder, internalResourcesFolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import {
  refreshSourceAnchor,
  resolveSourceAnchor,
  type ResolvedSourceRange,
  type SourceAnchor,
} from "./source-anchor.js";

export interface AnswerLinesOverride { id: string; file: string; kind: "answer-lines"; anchor: SourceAnchor; lines: number; }
export interface AnswerSpaceOverride { id: string; file: string; kind: "answer-space"; anchor: SourceAnchor; amount: number; unit: "lh" | "mm"; }
export interface PageBreakBeforeOverride { id: string; file: string; kind: "page-break-before"; anchor: SourceAnchor; }
export interface SlideLayoutOverride { id: string; file: string; kind: "slide-layout"; anchor: SourceAnchor; layout: "flow" | "columns" | "image-left" | "image-right"; }
export type LayoutOverride = AnswerLinesOverride | AnswerSpaceOverride | PageBreakBeforeOverride | SlideLayoutOverride;
export interface LayoutStore { version: 2; overrides: LayoutOverride[]; }
export type NewLayoutOverride = Omit<LayoutOverride, "id">;
export type NewLayoutInput =
  | Omit<AnswerLinesOverride, "id">
  | Omit<AnswerSpaceOverride, "id">
  | Omit<PageBreakBeforeOverride, "id">
  | Omit<SlideLayoutOverride, "id">;

const LAYOUT_FILE_NAME = "layout.json";
const UNITS = ["lh", "mm"] as const;
const SLIDE_LAYOUTS = ["flow", "columns", "image-left", "image-right"] as const;

export class LayoutFileCorruptedError extends Error {
  readonly originalError?: unknown;
  constructor(path: string, originalError?: unknown) {
    super(`Fichier de mise en page JSON invalide : ${path}`);
    this.name = "LayoutFileCorruptedError";
    this.originalError = originalError;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validAnchor(value: unknown): value is SourceAnchor {
  const a = record(value);
  return !!a && Number.isInteger(a.start) && Number.isInteger(a.end) && (a.start as number) >= 0 && (a.end as number) > (a.start as number) && typeof a.quote === "string" && a.quote.length > 0 && typeof a.prefix === "string" && typeof a.suffix === "string";
}

function validRelativeMarkdownPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/") || value.endsWith("/")) return false;
  const parts = value.split("/");
  return value.endsWith(".md") && parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function finitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function validOverride(value: unknown): value is LayoutOverride {
  const o = record(value);
  if (!o || typeof o.id !== "string" || !o.id || !validRelativeMarkdownPath(o.file) || typeof o.kind !== "string") return false;
  switch (o.kind) {
    case "answer-lines": return validAnchor(o.anchor) && finitePositiveInteger(o.lines);
    case "answer-space": return validAnchor(o.anchor) && finitePositiveInteger(o.amount) && typeof o.unit === "string" && UNITS.includes(o.unit as AnswerSpaceOverride["unit"]);
    case "page-break-before": return validAnchor(o.anchor);
    case "slide-layout": return validAnchor(o.anchor) && typeof o.layout === "string" && SLIDE_LAYOUTS.includes(o.layout as SlideLayoutOverride["layout"]);
    default: return false;
  }
}

export function validateLayoutStore(value: unknown): value is LayoutStore {
  const store = record(value);
  if (!store || store.version !== 2 || !Array.isArray(store.overrides)) return false;
  const ids = new Set<string>();
  return store.overrides.every((override) => validOverride(override) && !ids.has(override.id) && (ids.add(override.id), true));
}

export function emptyLayoutStore(): LayoutStore { return { version: 2, overrides: [] }; }

/** Development-only V1 reader. Deprecated document-layout records are dropped
 * and are never exposed through the V2 API. */
export function migrateLayoutStoreV1(value: unknown): LayoutStore | null {
  const store = record(value);
  if (!store || store.version !== 1 || !Array.isArray(store.overrides)) return null;
  const overrides: LayoutOverride[] = [];
  const ids = new Set<string>();
  for (const item of store.overrides) {
    const candidate = record(item);
    if (!candidate || typeof candidate.kind !== "string") return null;
    if (candidate.kind === "image-position" || candidate.kind === "block-composition") continue;
    if (!validOverride(candidate) || ids.has(candidate.id)) return null;
    ids.add(candidate.id);
    overrides.push(candidate);
  }
  return { version: 2, overrides };
}

export function layoutFilePath(app: App, settings: FeuilletsSettings | null | undefined): string | null {
  const root = getProjectFolder(app, settings);
  return root ? normalizePath(`${internalResourcesFolderPath(app, root)}/${LAYOUT_FILE_NAME}`) : null;
}

export async function loadLayoutStore(app: App, settings: FeuilletsSettings | null | undefined): Promise<LayoutStore> {
  const path = layoutFilePath(app, settings);
  if (!path) return emptyLayoutStore();
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return emptyLayoutStore();
  let parsed: unknown;
  try { parsed = JSON.parse(await app.vault.read(file)); } catch (error) { throw new LayoutFileCorruptedError(path, error); }
  if (validateLayoutStore(parsed)) return parsed;
  const migrated = migrateLayoutStoreV1(parsed);
  if (!migrated) throw new LayoutFileCorruptedError(path);
  return migrated;
}

export async function saveLayoutStore(app: App, settings: FeuilletsSettings | null | undefined, store: LayoutStore): Promise<void> {
  if (!validateLayoutStore(store)) throw new LayoutFileCorruptedError("layout-store");
  const root = getProjectFolder(app, settings);
  if (!root) throw new Error("Aucun projet Feuillets actif.");
  const path = layoutFilePath(app, settings);
  if (!path) throw new Error("Aucun chemin layout.json disponible.");
  const existing = app.vault.getAbstractFileByPath(path);
  if (!(existing instanceof TFile) && store.overrides.length === 0) return;
  if (!(existing instanceof TFile)) await ensureFolder(app, internalResourcesFolderPath(app, root));
  const json = JSON.stringify(store, null, 2);
  if (existing instanceof TFile) await app.vault.modify(existing, json);
  else await app.vault.create(path, json);
}

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); });
}
export function newLayoutOverrideId(): string { return uuid(); }
/** Converts a vault path to the file key persisted in layout.json. */
export function relativeLayoutFilePath(manuscriptPath: string, vaultPath: string): string | null {
  if (vaultPath === manuscriptPath) return "";
  return vaultPath.startsWith(`${manuscriptPath}/`) ? vaultPath.slice(manuscriptPath.length + 1) : null;
}

export function layoutOverridesForFile(store: LayoutStore, relativePath: string): LayoutOverride[] { return store.overrides.filter((override) => override.file === relativePath); }

/** Mutation pure et déterministe utilisée par les interfaces de mise en page.
 * La résolution des ancres est faite sur le contenu courant : un override
 * ambigu ou devenu introuvable n'est jamais remplacé par approximation. */
export function replaceLayoutOverridesForTarget(store: LayoutStore, content: string, target: LayoutOverride, kinds: LayoutOverride["kind"][]): LayoutStore | null {
  const resolved = resolveLayoutOverride(target, content);
  if (!resolved) return null;
  const kept = store.overrides.filter((candidate) => {
    if (!kinds.includes(candidate.kind) || candidate.file !== target.file) return true;
    const candidateResolved = resolveLayoutOverride(candidate, content);
    if (!candidateResolved) return true;
    return resolved.start !== candidateResolved.start || resolved.end !== candidateResolved.end;
  });
  if (target.kind !== "slide-layout") kept.push(target);
  return { ...store, overrides: kept };
}

export function duplicateLayoutForFile(store: LayoutStore, sourceFile: string, targetFile: string, content: string): LayoutStore {
  const copies = store.overrides.filter((override) => override.file === sourceFile).map((override) => {
    const refreshedOverride = refreshLayoutOverrideAnchors({ ...override, file: targetFile }, content);
    return refreshedOverride ? { ...refreshedOverride, id: uuid() } : null;
  }).filter((override): override is LayoutOverride => override !== null);
  return { ...store, overrides: [...store.overrides, ...copies] };
}

export function splitLayoutForFiles(store: LayoutStore, sourceFile: string, fileA: string, contentA: string, fileB: string, contentB: string): LayoutStore {
  const retained: LayoutOverride[] = [];
  for (const override of store.overrides) {
    if (override.file !== sourceFile) { retained.push(override); continue; }
    const a = refreshLayoutOverrideAnchors({ ...override, file: fileA }, contentA);
    const b = refreshLayoutOverrideAnchors({ ...override, file: fileB }, contentB);
    if (!!a !== !!b) retained.push(a || b!);
  }
  return { ...store, overrides: retained };
}

function sameOverrideTarget(first: LayoutOverride, second: LayoutOverride, content: string): boolean {
  const a = resolveLayoutOverride(first, content); const b = resolveLayoutOverride(second, content);
  if (!a || !b) return false;
  return a.start === b.start && a.end === b.end;
}
function conflictFamily(kind: LayoutOverride["kind"]): string { return kind === "answer-lines" || kind === "answer-space" ? "answer" : kind; }

export function mergeLayoutForFiles(store: LayoutStore, sourceFiles: string[], targetFile: string, targetContent: string): LayoutStore {
  const sourceOverrides = store.overrides.filter((override) => sourceFiles.includes(override.file));
  const targetOverrides = store.overrides.filter((override) => override.file === targetFile);
  const retained = store.overrides.filter((override) => !sourceFiles.includes(override.file));
  for (const source of sourceOverrides) {
    const candidate = refreshLayoutOverrideAnchors({ ...source, file: targetFile }, targetContent);
    if (!candidate) continue;
    const conflict = targetOverrides.some((existing) => conflictFamily(existing.kind) === conflictFamily(candidate.kind) && sameOverrideTarget(existing, candidate, targetContent));
    if (!conflict) {
      const copy = { ...candidate, id: uuid() };
      retained.push(copy);
      targetOverrides.push(copy);
    }
  }
  return { ...store, overrides: retained };
}

export async function addLayoutOverride(app: App, settings: FeuilletsSettings | null | undefined, input: NewLayoutOverride): Promise<LayoutOverride> {
  const store = await loadLayoutStore(app, settings);
  const created = { ...input, id: uuid() } as LayoutOverride;
  store.overrides.push(created);
  await saveLayoutStore(app, settings, store);
  return created;
}

export async function replaceLayoutOverride(app: App, settings: FeuilletsSettings | null | undefined, override: LayoutOverride): Promise<LayoutOverride | null> {
  const store = await loadLayoutStore(app, settings);
  const index = store.overrides.findIndex((candidate) => candidate.id === override.id);
  if (index === -1) return null;
  store.overrides[index] = override;
  await saveLayoutStore(app, settings, store);
  return override;
}

export async function deleteLayoutOverride(app: App, settings: FeuilletsSettings | null | undefined, id: string): Promise<boolean> {
  const store = await loadLayoutStore(app, settings);
  const before = store.overrides.length;
  store.overrides = store.overrides.filter((override) => override.id !== id);
  if (store.overrides.length === before) return false;
  await saveLayoutStore(app, settings, store);
  return true;
}

export function resolveLayoutOverride(override: LayoutOverride, content: string): ResolvedSourceRange | null {
  return resolveSourceAnchor(override.anchor, content);
}

function refreshed(anchor: SourceAnchor, content: string): SourceAnchor | null { return refreshSourceAnchor(anchor, content); }

export function refreshLayoutOverrideAnchors(override: LayoutOverride, content: string): LayoutOverride | null {
  const anchor = refreshed(override.anchor, content);
  return anchor ? { ...override, anchor } : null;
}

function relativePath(root: TFolder, vaultPath: string): string | null { return relativeLayoutFilePath(root.path, vaultPath); }

function belongs(file: string, prefix: string): boolean { return prefix === "" || file === prefix || file.startsWith(`${prefix}/`); }

export async function remapLayoutAfterRename(app: App, settings: FeuilletsSettings | null | undefined, oldVaultPath: string, newVaultPath: string): Promise<boolean> {
  const root = getProjectFolder(app, settings);
  if (!root || !oldVaultPath || !newVaultPath) return false;
  const oldPrefix = relativePath(root, oldVaultPath);
  if (oldPrefix === null) return false;
  const newPrefix = relativePath(root, newVaultPath);
  const store = await loadLayoutStore(app, settings);
  const affected = store.overrides.filter((override) => belongs(override.file, oldPrefix));
  if (affected.length === 0) return false;
  if (newPrefix === null) store.overrides = store.overrides.filter((override) => !belongs(override.file, oldPrefix));
  else for (const override of affected) override.file = `${newPrefix}${override.file.slice(oldPrefix.length)}`;
  await saveLayoutStore(app, settings, store);
  return true;
}

export async function removeLayoutAfterDelete(app: App, settings: FeuilletsSettings | null | undefined, deletedVaultPath: string): Promise<boolean> {
  const root = getProjectFolder(app, settings);
  if (!root || !deletedVaultPath) return false;
  const prefix = relativePath(root, deletedVaultPath);
  if (prefix === null) return false;
  const store = await loadLayoutStore(app, settings);
  const remaining = store.overrides.filter((override) => !belongs(override.file, prefix));
  if (remaining.length === store.overrides.length) return false;
  store.overrides = remaining;
  await saveLayoutStore(app, settings, store);
  return true;
}
