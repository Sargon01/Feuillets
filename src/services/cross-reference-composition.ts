import type { App, TFile } from "obsidian";
import type { Locale } from "../i18n/index.js";
import type { CompileScope } from "./compile-scope.js";
import { createCrossReferenceContext, contextualizeCrossReferenceTarget, crossReferenceProjectSettings, createCrossReferenceDetectionSession } from "./cross-reference-context.js";
import { detectCrossReferenceTargetsForScope, loadCrossReferenceStore, resolveCrossReferenceStore } from "./cross-reference-store.js";
import { crossReferenceReplacements, type CrossReferenceReplacement } from "./cross-reference-render.js";

export interface CompositionSourceRange { start: number; end: number }

export interface CrossReferenceCompositionSource {
  path: string;
  content: string;
  /** Original source ranges retained by an extraction or collection. */
  includedRanges?: readonly CompositionSourceRange[];
}

/** Resolves once against the snapshots and order actually retained by the composer. */
export async function compositionCrossReferenceReplacements(
  app: App, settings: FeuilletsSettings, scope: CompileScope,
  sources: readonly CrossReferenceCompositionSource[], locale: Locale,
  readContent: (file: TFile) => Promise<string> = (file) => app.vault.cachedRead(file),
): Promise<CrossReferenceReplacement[]> {
  const projectSettings = crossReferenceProjectSettings(app, settings, scope.projectRoot);
  const store = await loadCrossReferenceStore(app, projectSettings);
  if (!store.occurrences.length || !sources.length) return [];
  const snapshots = new Map(sources.map((source, index) => [source.path, { ...source, index }]));
  const contents = new Map<string, Promise<string>>();
  const read = (file: TFile): Promise<string> => {
    const source = snapshots.get(file.path);
    if (source) return Promise.resolve(source.content);
    let content = contents.get(file.path);
    if (!content) { content = readContent(file); contents.set(file.path, content); }
    return content;
  };
  const included = (path: string, start: number, end: number): boolean => {
    const source = snapshots.get(path);
    return !!source && (!source.includedRanges || source.includedRanges.some((range) => range.start <= start && range.end >= end));
  };
  const detect = createCrossReferenceDetectionSession();
  const detected = await detectCrossReferenceTargetsForScope(app, projectSettings,
    { type: "selection", projectRoot: scope.projectRoot, paths: sources.map((source) => source.path) }, read, detect);
  const context = createCrossReferenceContext(scope, detected
    .filter((target) => included(target.sourceFile, target.anchor.start, target.anchor.end))
    .map((target) => ({ ...target, sourceOrder: { ...target.sourceOrder, fileOrder: snapshots.get(target.sourceFile)?.index ?? 0 } })));
  const global = await resolveCrossReferenceStore(app, store, read, detect);
  return crossReferenceReplacements(store, {
    context,
    targets: new Map([...global.targets].map(([id, target]) => [id, contextualizeCrossReferenceTarget(target, context)])),
    occurrences: global.occurrences,
  }, locale).filter((replacement) => included(replacement.sourceFile, replacement.from, replacement.to));
}

/** Applies verified source offsets before layout, typography or footnote transforms. */
export function applySourceCrossReferenceReplacements(
  content: string, path: string, replacements: readonly CrossReferenceReplacement[],
): string {
  let result = content;
  for (const replacement of replacements.filter((entry) => entry.sourceFile === path).sort((a, b) => b.from - a.from)) {
    result = result.slice(0, replacement.from) + replacement.text + result.slice(replacement.to);
  }
  return result;
}
