import { createSourceAnchor, resolveSourceAnchorStrict, type ResolvedSourceRange } from "./source-anchor.js";
import { detectCrossReferenceTargets } from "./cross-reference-detection.js";
import {
  crossReferenceId, isCrossReferenceSourceFile, isCrossReferenceDisplayMode, validateCrossReferenceStore,
  type CrossReferenceDisplayMode, type CrossReferenceOccurrence, type CrossReferenceStore,
  type CrossReferenceTarget, type DetectedCrossReferenceTarget,
} from "./cross-reference-model.js";

export type CrossReferenceTargetResolution =
  | { status: "resolved"; range: ResolvedSourceRange; detectedTarget: DetectedCrossReferenceTarget }
  | { status: "missing" }
  | { status: "ambiguous" };

export type CrossReferenceOccurrenceResolution =
  | { status: "attached"; range: ResolvedSourceRange }
  | { status: "detached" };

export function resolveCrossReferenceTarget(
  target: CrossReferenceTarget,
  content: string | null,
  detectedTargets?: readonly DetectedCrossReferenceTarget[],
): CrossReferenceTargetResolution {
  if (content === null) return { status: "missing" };
  const result = resolveSourceAnchorStrict(target.anchor, content);
  if (result.status === "ambiguous") return result;
  const candidates = (detectedTargets ?? detectCrossReferenceTargets(target.sourceFile, content,
    target.type === "appendix" ? { appendixTitle: target.sourceFile.split("/").pop()?.slice(0, -3) ?? "" } : {}))
    .filter((candidate) => candidate.type === target.type && candidate.sourceFile === target.sourceFile);
  if (result.status === "resolved") {
    const detectedTarget = candidates.find((candidate) => candidate.anchor.start === result.range.start && candidate.anchor.end === result.range.end);
    return detectedTarget ? { ...result, detectedTarget } : { status: "missing" };
  }
  // Missing context at a file edge is unconstrained; every remaining context must match exactly.
  const matches = candidates.filter((candidate) =>
    (!target.anchor.prefix || content.slice(Math.max(0, candidate.anchor.start - target.anchor.prefix.length), candidate.anchor.start) === target.anchor.prefix)
    && (!target.anchor.suffix || content.slice(candidate.anchor.end, candidate.anchor.end + target.anchor.suffix.length) === target.anchor.suffix)
  );
  if (matches.length > 1) return { status: "ambiguous" };
  const detectedTarget = matches[0];
  return detectedTarget
    ? { status: "resolved", range: { start: detectedTarget.anchor.start, end: detectedTarget.anchor.end }, detectedTarget }
    : { status: "missing" };
}

export function resolveCrossReferenceOccurrence(occurrence: CrossReferenceOccurrence, content: string | null): CrossReferenceOccurrenceResolution {
  if (content === null) return { status: "detached" };
  const result = resolveSourceAnchorStrict(occurrence.anchor, content);
  return result.status === "resolved" ? { status: "attached", range: result.range } : { status: "detached" };
}

export interface CrossReferenceLink {
  store: CrossReferenceStore;
  target: CrossReferenceTarget;
  occurrence: CrossReferenceOccurrence;
}

/** Creates only sidecar data; the occurrence text must already exist in its real source file. */
export function createCrossReferenceLink(
  store: CrossReferenceStore,
  detected: DetectedCrossReferenceTarget,
  targetContent: string,
  sourceFile: string,
  content: string,
  start: number,
  end: number,
  displayMode: CrossReferenceDisplayMode = "number",
): CrossReferenceLink {
  validateCrossReferenceStore(store);
  if (!isCrossReferenceSourceFile(sourceFile) || !isCrossReferenceSourceFile(detected.sourceFile)
    || !isCrossReferenceDisplayMode(displayMode)) throw new Error("Invalid cross-reference link input");
  const targetResolution = resolveSourceAnchorStrict(detected.anchor, targetContent);
  const occurrenceAnchor = createSourceAnchor(content, start, end);
  if (targetResolution.status !== "resolved" || !occurrenceAnchor) throw new Error("Cross-reference anchors must resolve uniquely");
  if (resolveSourceAnchorStrict(occurrenceAnchor, content).status !== "resolved") throw new Error("Cross-reference occurrence is ambiguous");
  const targetAnchor = createSourceAnchor(targetContent, targetResolution.range.start, targetResolution.range.end);
  if (!targetAnchor) throw new Error("Invalid cross-reference target range");
  const candidate: CrossReferenceTarget = { id: "xr_candidate", type: detected.type, sourceFile: detected.sourceFile, anchor: targetAnchor, titleOrCaption: detected.titleOrCaption };
  if (resolveCrossReferenceTarget(candidate, targetContent).status !== "resolved") throw new Error("Cross-reference target is no longer detectable");
  for (const target of store.targets) {
    if (target.type === detected.type && target.sourceFile === detected.sourceFile
      && target.anchor.quote === targetAnchor.quote && resolveCrossReferenceTarget(target, targetContent).status === "ambiguous") {
      throw new Error("Existing cross-reference identity is ambiguous");
    }
  }
  const existing = store.targets.filter((target) => {
    if (target.type !== detected.type || target.sourceFile !== detected.sourceFile) return false;
    const result = resolveCrossReferenceTarget(target, targetContent);
    return result.status === "resolved" && result.range.start === targetAnchor.start && result.range.end === targetAnchor.end;
  });
  if (existing.length > 1) throw new Error("Multiple persistent identities for the same cross-reference target");
  const used = new Set([...store.targets, ...store.occurrences].map((entry) => entry.id));
  const nextId = (): string => {
    let id = crossReferenceId();
    while (used.has(id)) id = crossReferenceId();
    used.add(id);
    return id;
  };
  const target: CrossReferenceTarget = existing[0] ?? {
    id: nextId(), type: detected.type, sourceFile: detected.sourceFile, anchor: targetAnchor, titleOrCaption: detected.titleOrCaption,
  };
  const occurrence: CrossReferenceOccurrence = { id: nextId(), targetId: target.id, sourceFile, anchor: occurrenceAnchor, displayMode };
  const next: CrossReferenceStore = {
    version: 1, targets: existing.length ? [...store.targets] : [...store.targets, target], occurrences: [...store.occurrences, occurrence],
  };
  validateCrossReferenceStore(next);
  return { store: next, target, occurrence };
}
