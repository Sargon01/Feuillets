import { TFile, TFolder, normalizePath, type App } from "obsidian";
import { getProjectFolder, internalResourcesFolderPath } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { annexesFiles } from "./annexes.js";
import { resolveCompileScopeFiles, type CompileScope } from "./compile-scope.js";
import { resolveEditorialRoot } from "./editorial-roots.js";
import { remapPath } from "../carnet/core/path-reference-maintenance.js";
import { detectCrossReferenceTargets } from "./cross-reference-detection.js";
import {
  CrossReferenceStoreCorruptedError, emptyCrossReferenceStore, parseCrossReferenceStore, serializeCrossReferenceStore,
  validateCrossReferenceStore, type CrossReferenceDisplayMode, type CrossReferenceStore, type DetectedCrossReferenceTarget,
} from "./cross-reference-model.js";
import {
  createCrossReferenceLink, resolveCrossReferenceTarget, resolveCrossReferenceOccurrence,
  type CrossReferenceLink, type CrossReferenceTargetResolution, type CrossReferenceOccurrenceResolution,
} from "./cross-reference-resolution.js";

export function crossReferenceStorePath(app: App, settings: FeuilletsSettings | null | undefined): string | null {
  const root = getProjectFolder(app, settings);
  return root ? normalizePath(`${internalResourcesFolderPath(app, root)}/cross-references.json`) : null;
}

const pending = new WeakMap<App, Map<string, Promise<unknown>>>();

/** Serializes sidecar operations per project, including consecutive rename events. */
function inStore<T>(app: App, path: string, action: () => Promise<T>): Promise<T> {
  let paths = pending.get(app);
  if (!paths) { paths = new Map(); pending.set(app, paths); }
  const previous = paths.get(path) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(action);
  paths.set(path, result);
  void result.finally(() => { if (paths.get(path) === result) paths.delete(path); }).catch(() => undefined);
  return result;
}

async function readStore(app: App, path: string): Promise<CrossReferenceStore> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file === null) return emptyCrossReferenceStore();
  if (!(file instanceof TFile)) throw new CrossReferenceStoreCorruptedError(path);
  return parseCrossReferenceStore(await app.vault.read(file), path);
}

async function writeStore(app: App, path: string, store: CrossReferenceStore): Promise<void> {
  validateCrossReferenceStore(store, path);
  // Validate the existing sidecar before any write, including explicit replacement saves.
  await readStore(app, path);
  const json = serializeCrossReferenceStore(store);
  await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) await app.vault.modify(existing, json);
  else if (existing === null) await app.vault.create(path, json);
  else throw new CrossReferenceStoreCorruptedError(path);
}

export async function loadCrossReferenceStore(app: App, settings: FeuilletsSettings | null | undefined): Promise<CrossReferenceStore> {
  const path = crossReferenceStorePath(app, settings);
  return path ? inStore(app, path, () => readStore(app, path)) : emptyCrossReferenceStore();
}

export async function saveCrossReferenceStore(app: App, settings: FeuilletsSettings | null | undefined, store: CrossReferenceStore): Promise<void> {
  const path = crossReferenceStorePath(app, settings);
  if (!path) throw new Error("Cross-reference store requires an active project");
  await inStore(app, path, () => writeStore(app, path, store));
}

/** Automatic discovery stays read-only and creates no persistent identities. */
export async function detectProjectCrossReferenceTargets(app: App, settings: FeuilletsSettings): Promise<DetectedCrossReferenceTarget[]> {
  const root = getProjectFolder(app, settings);
  if (!root) return [];
  return detectCrossReferenceTargetsForScope(app, settings, { type: "project", projectRoot: root.path });
}

export type CrossReferenceContentReader = (file: TFile) => Promise<string>;
export type CrossReferenceTargetDetector = typeof detectCrossReferenceTargets;

export async function detectCrossReferenceTargetsForScope(
  app: App, settings: FeuilletsSettings, scope: CompileScope,
  readContent: CrossReferenceContentReader = (file) => app.vault.read(file),
  detect: CrossReferenceTargetDetector = detectCrossReferenceTargets,
): Promise<DetectedCrossReferenceTarget[]> {
  const root = app.vault.getAbstractFileByPath(scope.projectRoot);
  if (!(root instanceof TFolder)) return [];
  const files = resolveCompileScopeFiles(app, settings, scope);
  const projectRoot = getProjectFolder(app, settings);
  const structuralRoot = projectRoot && (root.path === projectRoot.path || root.path.startsWith(`${projectRoot.path}/`)) ? projectRoot : root;
  const appendixPaths = new Set<string>();
  const editorialRoots = new Map<string, TFolder>([[root.path, root]]);
  for (const file of files) {
    const editorial = resolveEditorialRoot(app, settings, structuralRoot, file);
    editorialRoots.set(editorial.path, editorial);
  }
  for (const editorial of editorialRoots.values()) {
    for (const file of annexesFiles(app, settings, editorial)) appendixPaths.add(file.path);
  }
  const targets: DetectedCrossReferenceTarget[] = [];
  for (const [fileOrder, file] of files.entries()) {
    targets.push(...detect(file.path, await readContent(file), {
      fileOrder, ...(appendixPaths.has(file.path) ? { appendixTitle: file.basename } : {}),
    }));
  }
  return targets;
}

export async function addCrossReferenceLink(
  app: App, settings: FeuilletsSettings, detected: DetectedCrossReferenceTarget,
  sourceFile: TFile, start: number, end: number, displayMode: CrossReferenceDisplayMode = "number",
  readContent: CrossReferenceContentReader = (file) => app.vault.read(file),
): Promise<CrossReferenceLink> {
  const path = crossReferenceStorePath(app, settings);
  if (!path) throw new Error("Cross-reference store requires an active project");
  return inStore(app, path, async () => {
    const targetFile = app.vault.getAbstractFileByPath(detected.sourceFile);
    if (!(targetFile instanceof TFile) || app.vault.getAbstractFileByPath(sourceFile.path) !== sourceFile) {
      throw new Error("Cross-reference link requires existing source files");
    }
    const targetContent = await readContent(targetFile);
    const content = sourceFile === targetFile ? targetContent : await readContent(sourceFile);
    const result = createCrossReferenceLink(await readStore(app, path), detected, targetContent, sourceFile.path, content, start, end, displayMode);
    await writeStore(app, path, result.store);
    return result;
  });
}

export function addCrossReferenceLinkFromContents(
  app: App, settings: FeuilletsSettings, detected: DetectedCrossReferenceTarget,
  targetContent: string, sourceFile: TFile, content: string, start: number, end: number,
  displayMode: CrossReferenceDisplayMode,
): Promise<CrossReferenceLink> {
  return addCrossReferenceLink(app, settings, detected, sourceFile, start, end, displayMode,
    async (file) => file.path === sourceFile.path ? content : targetContent);
}

export function remapCrossReferenceStore(store: CrossReferenceStore, oldPath: string, newPath: string): CrossReferenceStore {
  validateCrossReferenceStore(store);
  if (!oldPath || !newPath) return store;
  const oldValue = normalizePath(oldPath);
  const newValue = normalizePath(newPath);
  return {
    version: 1,
    targets: store.targets.map((target) => ({ ...target, sourceFile: remapPath(target.sourceFile, oldValue, newValue) })),
    occurrences: store.occurrences.map((occurrence) => ({ ...occurrence, sourceFile: remapPath(occurrence.sourceFile, oldValue, newValue) })),
  };
}

export async function remapCrossReferencesAfterRename(
  app: App, settings: FeuilletsSettings | null | undefined, oldPath: string, newPath: string,
): Promise<boolean> {
  const path = crossReferenceStorePath(app, settings);
  if (!path || !oldPath || !newPath || oldPath === newPath) return false;
  return inStore(app, path, async () => {
    const store = await readStore(app, path);
    const remapped = remapCrossReferenceStore(store, oldPath, newPath);
    const changed = store.targets.some((target, index) => target.sourceFile !== remapped.targets[index].sourceFile)
      || store.occurrences.some((occurrence, index) => occurrence.sourceFile !== remapped.occurrences[index].sourceFile);
    if (changed) await writeStore(app, path, remapped);
    return changed;
  });
}

export interface CrossReferenceStoreResolution {
  targets: Map<string, CrossReferenceTargetResolution>;
  occurrences: Map<string, CrossReferenceOccurrenceResolution>;
}

export async function resolveCrossReferenceStore(
  app: App, store: CrossReferenceStore,
  readContent: CrossReferenceContentReader = (file) => app.vault.read(file),
  detect: CrossReferenceTargetDetector = detectCrossReferenceTargets,
): Promise<CrossReferenceStoreResolution> {
  validateCrossReferenceStore(store);
  const contents = new Map<string, string | null>();
  const detections = new Map<string, DetectedCrossReferenceTarget[]>();
  const targetFiles = new Set(store.targets.map((target) => target.sourceFile));
  const appendixFiles = new Set(store.targets.filter((target) => target.type === "appendix").map((target) => target.sourceFile));
  for (const entry of [...store.targets, ...store.occurrences]) {
    if (contents.has(entry.sourceFile)) continue;
    const file = app.vault.getAbstractFileByPath(entry.sourceFile);
    const content = file instanceof TFile ? await readContent(file) : null;
    contents.set(entry.sourceFile, content);
    if (content !== null && file instanceof TFile && targetFiles.has(entry.sourceFile)) {
      detections.set(entry.sourceFile, detect(entry.sourceFile, content,
        appendixFiles.has(entry.sourceFile) ? { appendixTitle: file.basename } : {}));
    }
  }
  return {
    targets: new Map(store.targets.map((target) => [target.id, resolveCrossReferenceTarget(target, contents.get(target.sourceFile) ?? null, detections.get(target.sourceFile))])),
    occurrences: new Map(store.occurrences.map((occurrence) => [occurrence.id, resolveCrossReferenceOccurrence(occurrence, contents.get(occurrence.sourceFile) ?? null)])),
  };
}
