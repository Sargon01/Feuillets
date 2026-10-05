import { TFolder, type App, type TFile } from "obsidian";
import { createProjectScope, createFolderScope, type CompileScope } from "./compile-scope.js";
import { resolveEditorialRoot } from "./editorial-roots.js";
import { resolveDeclaredWorkspaceRoot } from "./folder-workspaces.js";
import { getProjectFolder } from "./folder-structure.js";
import { detectCrossReferenceTargetsForScope, resolveCrossReferenceStore, type CrossReferenceContentReader, type CrossReferenceStoreResolution, type CrossReferenceTargetDetector } from "./cross-reference-store.js";
import { detectCrossReferenceTargets } from "./cross-reference-detection.js";
import type { CrossReferenceStore, CrossReferenceTargetType, DetectedCrossReferenceTarget } from "./cross-reference-model.js";
import type { CrossReferenceTargetResolution } from "./cross-reference-resolution.js";

export interface NumberedCrossReferenceTarget {
  detectedTarget: DetectedCrossReferenceTarget;
  number: number;
}

export interface CrossReferenceContext {
  scope: CompileScope;
  targets: NumberedCrossReferenceTarget[];
}

/** Reuses unchanged Markdown parses within one editor; editorial order stays contextual. */
export function createCrossReferenceDetectionSession(detect: CrossReferenceTargetDetector = detectCrossReferenceTargets): CrossReferenceTargetDetector {
  const snapshots = new Map<string, { content: string; appendixTitle?: string; targets: DetectedCrossReferenceTarget[] }>();
  return (path, content, options = {}) => {
    let snapshot = snapshots.get(path);
    if (!snapshot || snapshot.content !== content || snapshot.appendixTitle !== options.appendixTitle) {
      snapshot = { content, appendixTitle: options.appendixTitle, targets: detect(path, content, options) };
      snapshots.set(path, snapshot);
    }
    return snapshot.targets.map((target) => ({ ...target, sourceOrder: { ...target.sourceOrder, fileOrder: options.fileOrder ?? 0 } }));
  };
}

export type ContextualCrossReferenceTargetResolution =
  | (Extract<CrossReferenceTargetResolution, { status: "resolved" }> & { number: number })
  | { status: "out-of-scope"; detectedTarget: DetectedCrossReferenceTarget }
  | Extract<CrossReferenceTargetResolution, { status: "missing" | "ambiguous" }>;

export function createCrossReferenceContext(scope: CompileScope, detected: readonly DetectedCrossReferenceTarget[]): CrossReferenceContext {
  const counters: Record<CrossReferenceTargetType, number> = { section: 0, figure: 0, table: 0, appendix: 0 };
  const ordered = [...detected].sort((a, b) => a.sourceOrder.fileOrder - b.sourceOrder.fileOrder || a.anchor.start - b.anchor.start);
  return { scope, targets: ordered.map((detectedTarget) => ({ detectedTarget, number: ++counters[detectedTarget.type] })) };
}

export function contextualizeCrossReferenceTarget(
  resolution: CrossReferenceTargetResolution, context: CrossReferenceContext,
): ContextualCrossReferenceTargetResolution {
  if (resolution.status !== "resolved") return resolution;
  const current = resolution.detectedTarget;
  const entry = context.targets.find(({ detectedTarget }) => detectedTarget.type === current.type
    && detectedTarget.sourceFile === current.sourceFile && detectedTarget.anchor.start === current.anchor.start
    && detectedTarget.anchor.end === current.anchor.end);
  return entry ? { ...resolution, number: entry.number, detectedTarget: entry.detectedTarget }
    : { status: "out-of-scope", detectedTarget: current };
}

export function crossReferenceBoundaryScope(
  app: App, settings: FeuilletsSettings, file: TFile, isolation: TFolder | null = null,
): CompileScope | null {
  const root = getProjectFolder(app, crossReferenceProjectSettings(app, settings, file.path));
  if (!(root instanceof TFolder) || !file.path.startsWith(`${root.path}/`)) return null;
  const editorial = resolveEditorialRoot(app, settings, root, file);
  const workspace = resolveDeclaredWorkspaceRoot(app, settings, root, file);
  let boundary = workspace && workspace.path.length > editorial.path.length ? workspace : editorial;
  if (isolation && app.vault.getAbstractFileByPath(isolation.path) instanceof TFolder
    && file.path.startsWith(`${isolation.path}/`)
    && (isolation.path === boundary.path || isolation.path.startsWith(`${boundary.path}/`))
    && getProjectFolder(app, crossReferenceProjectSettings(app, settings, isolation.path))?.path === root.path) boundary = isolation;
  return boundary.path === root.path ? createProjectScope(root.path) : createFolderScope(root.path, boundary.path);
}

export function crossReferenceProjectSettings(app: App, settings: FeuilletsSettings, path: string): FeuilletsSettings {
  const candidates = [settings.projectFolder, ...(settings.projects ?? [])]
    .filter((root): root is string => typeof root === "string" && root.length > 0 && (path === root || path.startsWith(`${root}/`)))
    .sort((a, b) => b.length - a.length);
  for (const projectFolder of candidates) {
    const context = { ...settings, projectFolder };
    if (getProjectFolder(app, context)) return context;
  }
  return settings;
}

export async function loadCrossReferenceContext(
  app: App, settings: FeuilletsSettings, scope: CompileScope,
  readContent: CrossReferenceContentReader = (file) => app.vault.read(file),
  detect: CrossReferenceTargetDetector = detectCrossReferenceTargets,
): Promise<CrossReferenceContext> {
  return createCrossReferenceContext(scope, await detectCrossReferenceTargetsForScope(app, crossReferenceProjectSettings(app, settings, scope.projectRoot), scope, readContent, detect));
}

export interface ContextualCrossReferenceStoreResolution {
  context: CrossReferenceContext;
  targets: Map<string, ContextualCrossReferenceTargetResolution>;
  occurrences: CrossReferenceStoreResolution["occurrences"];
}

export async function resolveCrossReferencesInContext(
  app: App, settings: FeuilletsSettings, scope: CompileScope, store: CrossReferenceStore,
  readContent: CrossReferenceContentReader = (file) => app.vault.read(file),
  detect: CrossReferenceTargetDetector = createCrossReferenceDetectionSession(),
): Promise<ContextualCrossReferenceStoreResolution> {
  const contents = new Map<string, Promise<string>>();
  const read: CrossReferenceContentReader = (file) => {
    let content = contents.get(file.path);
    if (!content) { content = readContent(file); contents.set(file.path, content); }
    return content;
  };
  const context = await loadCrossReferenceContext(app, settings, scope, read, detect);
  const global = await resolveCrossReferenceStore(app, store, read, detect);
  return { context, targets: new Map([...global.targets].map(([id, resolution]) => [id, contextualizeCrossReferenceTarget(resolution, context)])), occurrences: global.occurrences };
}
