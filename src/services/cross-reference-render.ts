import type { Locale } from "../i18n/index.js";
import type { CrossReferenceStore } from "./cross-reference-model.js";
import type { ContextualCrossReferenceStoreResolution } from "./cross-reference-context.js";
import { formatCrossReference } from "./cross-reference-format.js";
import { locationToCompositeOffset, type ScriveningsDocument } from "./scrivenings-document.js";

export interface CrossReferenceReplacement { sourceFile: string; from: number; to: number; text: string }

export function crossReferenceReplacements(store: CrossReferenceStore, resolution: ContextualCrossReferenceStoreResolution, locale: Locale): CrossReferenceReplacement[] {
  const replacements: CrossReferenceReplacement[] = [];
  for (const occurrence of store.occurrences) {
    const attached = resolution.occurrences.get(occurrence.id);
    const target = resolution.targets.get(occurrence.targetId);
    if (attached?.status !== "attached" || target?.status !== "resolved") continue;
    const text = formatCrossReference(target, occurrence.displayMode, locale);
    if (text) replacements.push({ sourceFile: occurrence.sourceFile, from: attached.range.start, to: attached.range.end, text });
  }
  return replacements.filter((range, index) => !replacements.some((other, otherIndex) => otherIndex !== index
    && other.sourceFile === range.sourceFile && other.from < range.to && other.to > range.from));
}

export function compositeCrossReferenceReplacements(document: ScriveningsDocument, replacements: readonly CrossReferenceReplacement[]): CrossReferenceReplacement[] {
  const result: CrossReferenceReplacement[] = [];
  for (const replacement of replacements) {
    const segment = document.segments.find((entry) => entry.path === replacement.sourceFile);
    if (!segment) continue;
    const from = locationToCompositeOffset(document, segment.path, replacement.from - segment.frontmatter.length);
    const to = locationToCompositeOffset(document, segment.path, replacement.to - segment.frontmatter.length);
    if (from !== null && to !== null && from < to) result.push({ ...replacement, from, to });
  }
  return result;
}
