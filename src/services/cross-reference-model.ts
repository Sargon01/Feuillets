import type { SourceAnchor } from "./source-anchor.js";

export type CrossReferenceTargetType = "section" | "figure" | "table" | "appendix";
export type CrossReferenceDisplayMode = "number" | "title" | "type-number";

export interface DetectedCrossReferenceTarget {
  type: CrossReferenceTargetType;
  sourceFile: string;
  anchor: SourceAnchor;
  titleOrCaption: string;
  sourceOrder: { fileOrder: number; offset: number };
}

export interface CrossReferenceTarget {
  id: string;
  type: CrossReferenceTargetType;
  sourceFile: string;
  anchor: SourceAnchor;
  titleOrCaption: string;
}

export interface CrossReferenceOccurrence {
  id: string;
  targetId: string;
  sourceFile: string;
  anchor: SourceAnchor;
  displayMode: CrossReferenceDisplayMode;
}

export interface CrossReferenceStore {
  version: 1;
  targets: CrossReferenceTarget[];
  occurrences: CrossReferenceOccurrence[];
}

export class CrossReferenceStoreCorruptedError extends Error {
  constructor(readonly path: string) {
    super(`Invalid cross-reference store: ${path}`);
    this.name = "CrossReferenceStoreCorruptedError";
  }
}

export function emptyCrossReferenceStore(): CrossReferenceStore {
  return { version: 1, targets: [], occurrences: [] };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function isCrossReferenceSourceFile(value: unknown): value is string {
  return typeof value === "string" && value.endsWith(".md") && !value.startsWith("/")
    && !value.includes("\\") && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function isAnchor(value: unknown): value is SourceAnchor {
  return record(value) && hasKeys(value, ["start", "end", "quote", "prefix", "suffix"])
    && typeof value.start === "number" && typeof value.end === "number"
    && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end)
    && value.start >= 0 && value.end > value.start
    && typeof value.quote === "string" && value.quote.length === value.end - value.start
    && typeof value.prefix === "string" && typeof value.suffix === "string";
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^xr_[a-zA-Z0-9-]+$/.test(value);
}

export function isCrossReferenceTargetType(value: unknown): value is CrossReferenceTargetType {
  return value === "section" || value === "figure" || value === "table" || value === "appendix";
}

export function isCrossReferenceDisplayMode(value: unknown): value is CrossReferenceDisplayMode {
  return value === "number" || value === "title" || value === "type-number";
}

function isTarget(value: unknown): value is CrossReferenceTarget {
  return record(value) && hasKeys(value, ["id", "type", "sourceFile", "anchor", "titleOrCaption"])
    && isId(value.id) && isCrossReferenceTargetType(value.type)
    && isCrossReferenceSourceFile(value.sourceFile) && isAnchor(value.anchor) && typeof value.titleOrCaption === "string";
}

function isOccurrence(value: unknown): value is CrossReferenceOccurrence {
  return record(value) && hasKeys(value, ["id", "targetId", "sourceFile", "anchor", "displayMode"])
    && isId(value.id) && isId(value.targetId) && isCrossReferenceSourceFile(value.sourceFile)
    && isAnchor(value.anchor) && isCrossReferenceDisplayMode(value.displayMode);
}

export function validateCrossReferenceStore(value: unknown, path = "cross-references.json"): asserts value is CrossReferenceStore {
  if (!record(value) || !hasKeys(value, ["version", "targets", "occurrences"])
    || value.version !== 1 || !Array.isArray(value.targets) || !Array.isArray(value.occurrences)
    || !value.targets.every(isTarget) || !value.occurrences.every(isOccurrence)) {
    throw new CrossReferenceStoreCorruptedError(path);
  }
  const targetIds = new Set(value.targets.map((target: CrossReferenceTarget) => target.id));
  const ids = [...targetIds, ...value.occurrences.map((occurrence: CrossReferenceOccurrence) => occurrence.id)];
  if (targetIds.size !== value.targets.length || new Set(ids).size !== ids.length
    || !value.occurrences.every((occurrence: CrossReferenceOccurrence) => targetIds.has(occurrence.targetId))) {
    throw new CrossReferenceStoreCorruptedError(path);
  }
}

export function parseCrossReferenceStore(json: string, path = "cross-references.json"): CrossReferenceStore {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new CrossReferenceStoreCorruptedError(path); }
  validateCrossReferenceStore(value, path);
  return value;
}

function orderedAnchor(anchor: SourceAnchor): SourceAnchor {
  return { start: anchor.start, end: anchor.end, quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix };
}

/** Fixed key order and opaque-ID order make serialization independent of insertion order. */
export function serializeCrossReferenceStore(store: CrossReferenceStore): string {
  validateCrossReferenceStore(store);
  const compare = (a: { id: string }, b: { id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return JSON.stringify({
    version: 1,
    targets: [...store.targets].sort(compare).map((target) => ({
      id: target.id, type: target.type, sourceFile: target.sourceFile,
      anchor: orderedAnchor(target.anchor), titleOrCaption: target.titleOrCaption,
    })),
    occurrences: [...store.occurrences].sort(compare).map((occurrence) => ({
      id: occurrence.id, targetId: occurrence.targetId, sourceFile: occurrence.sourceFile,
      anchor: orderedAnchor(occurrence.anchor), displayMode: occurrence.displayMode,
    })),
  }, null, 2) + "\n";
}

let fallbackSequence = 0;

export function crossReferenceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `xr_${crypto.randomUUID()}`;
  fallbackSequence++;
  return `xr_${Date.now().toString(16)}-${fallbackSequence.toString(16)}`;
}
