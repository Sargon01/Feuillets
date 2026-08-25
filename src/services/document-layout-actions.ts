import type { App, TFile } from "obsidian";
import {
  layoutOverridesForFile,
  loadLayoutStore,
  newLayoutOverrideId,
  relativeLayoutFilePath,
  resolveLayoutOverride,
  saveLayoutStore,
  type LayoutOverride,
  type NewLayoutInput,
} from "./layout-store.js";
import type { SourceAnchor } from "./source-anchor.js";

/** UI-neutral structural target shared by every Document layout entry point. */
export interface DocumentLayoutTarget {
  questionAnchor?: SourceAnchor;
  paginationAnchor?: SourceAnchor;
}

export interface DocumentLayoutValues {
  question: { mode: "default" | "lines" | "space"; lines?: number; amount?: number; unit?: "lh" | "mm" } | null;
  pagination: boolean;
}

function sameAnchor(override: LayoutOverride, anchor: SourceAnchor | undefined, content: string): boolean {
  if (!anchor) return false;
  const resolved = resolveLayoutOverride(override, content);
  const target = { kind: override.kind, file: override.file, id: override.id, anchor } as LayoutOverride;
  const targetResolved = resolveLayoutOverride(target, content);
  return !!resolved && !!targetResolved && !("first" in resolved) && !("first" in targetResolved) && resolved.start === targetResolved.start && resolved.end === targetResolved.end;
}

export function relativeDocumentLayoutPath(manuscriptPath: string, file: TFile): string | null {
  return relativeLayoutFilePath(manuscriptPath, file.path);
}

export async function documentLayoutValuesForTarget(app: App, settings: FeuilletsSettings, manuscriptPath: string, file: TFile, content: string, target: DocumentLayoutTarget): Promise<DocumentLayoutValues> {
  const relative = relativeDocumentLayoutPath(manuscriptPath, file);
  const overrides = relative ? layoutOverridesForFile(await loadLayoutStore(app, settings), relative) : [];
  const answer = overrides.find((entry) => (entry.kind === "answer-lines" || entry.kind === "answer-space") && sameAnchor(entry, target.questionAnchor, content));
  const pagination = overrides.some((entry) => entry.kind === "page-break-before" && sameAnchor(entry, target.paginationAnchor, content));
  return {
    question: target.questionAnchor ? (answer?.kind === "answer-lines" ? { mode: "lines", lines: answer.lines } : answer?.kind === "answer-space" ? { mode: "space", amount: answer.amount, unit: answer.unit } : { mode: "default" }) : null,
    pagination,
  };
}

export async function applyDocumentLayoutChanges(app: App, settings: FeuilletsSettings, manuscriptPath: string, file: TFile, content: string, target: DocumentLayoutTarget, values: DocumentLayoutValues): Promise<void> {
  const relative = relativeDocumentLayoutPath(manuscriptPath, file);
  if (!relative) throw new Error("Le fichier n’appartient pas au Manuscrit actif.");
  const store = await loadLayoutStore(app, settings);
  store.overrides = store.overrides.filter((override) => {
    if (override.file !== relative) return true;
    if ((override.kind === "answer-lines" || override.kind === "answer-space") && sameAnchor(override, target.questionAnchor, content)) return false;
    if (override.kind === "page-break-before" && sameAnchor(override, target.paginationAnchor, content)) return false;
    return true;
  });
  const add = (input: NewLayoutInput): void => { store.overrides.push({ ...input, id: newLayoutOverrideId() }); };
  if (values.question?.mode === "lines" && values.question.lines && target.questionAnchor) add({ file: relative, kind: "answer-lines", anchor: target.questionAnchor, lines: values.question.lines });
  if (values.question?.mode === "space" && values.question.amount && values.question.unit && target.questionAnchor) add({ file: relative, kind: "answer-space", anchor: target.questionAnchor, amount: values.question.amount, unit: values.question.unit });
  if (values.pagination && target.paginationAnchor) add({ file: relative, kind: "page-break-before", anchor: target.paginationAnchor });
  await saveLayoutStore(app, settings, store);
}

/** Read-only cache source for the Markdown editor page-break decoration. */
export async function pageBreakAnchorsForFile(app: App, settings: FeuilletsSettings, manuscriptPath: string, file: TFile): Promise<readonly SourceAnchor[]> {
  const relative = relativeDocumentLayoutPath(manuscriptPath, file);
  if (!relative) return [];
  return layoutOverridesForFile(await loadLayoutStore(app, settings), relative)
    .filter((override): override is Extract<LayoutOverride, { kind: "page-break-before" }> => override.kind === "page-break-before")
    .map((override) => override.anchor);
}
