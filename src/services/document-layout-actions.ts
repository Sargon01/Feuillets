import type { App, TFile } from "obsidian";
import {
  layoutOverridesForFile,
  loadLayoutStore,
  newLayoutOverrideId,
  relativeLayoutFilePath,
  resolveLayoutOverride,
  saveLayoutStore,
  hasParagraphLayoutProperties,
  validParagraphLayoutProperties,
  type LayoutStore,
  type ParagraphLayoutProperties,
  type ParagraphLayoutOverride,
  type LayoutOverride,
  type NewLayoutInput,
} from "./layout-store.js";
import { createSourceAnchor, resolveParagraphSourceAnchor, resolveSourceAnchor, type SourceAnchor } from "./source-anchor.js";
import { documentLayoutBlocks, isOrdinaryLayoutParagraph } from "./document-layout.js";

/** UI-neutral structural target shared by every Document layout entry point. */
export interface DocumentLayoutTarget {
  questionAnchor?: SourceAnchor;
  paginationAnchor?: SourceAnchor;
  paragraphAnchor?: SourceAnchor;
}

export interface DocumentLayoutValues {
  question: { mode: "default" | "lines" | "space"; lines?: number; amount?: number; unit?: "lh" | "mm" } | null;
  pagination: boolean;
  paragraph?: ParagraphLayoutProperties;
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
  const paragraph = overrides.find((entry): entry is ParagraphLayoutOverride => entry.kind === "paragraph-layout" && sameAnchor(entry, target.paragraphAnchor, content));
  return {
    question: target.questionAnchor ? (answer?.kind === "answer-lines" ? { mode: "lines", lines: answer.lines } : answer?.kind === "answer-space" ? { mode: "space", amount: answer.amount, unit: answer.unit } : { mode: "default" }) : null,
    pagination,
    paragraph: paragraph ? { alignment: paragraph.alignment, firstLineIndentPt: paragraph.firstLineIndentPt, spacingBeforePt: paragraph.spacingBeforePt, spacingAfterPt: paragraph.spacingAfterPt } : {},
  };
}

/** Updating one property retains all other exceptions and page breaks. */
export function updateParagraphLayoutOverride(store: LayoutStore, file: string, content: string, anchor: SourceAnchor, patch: ParagraphLayoutProperties): LayoutStore | null {
  if (!validParagraphLayoutProperties(patch)) return null;
  const range = resolveParagraphSourceAnchor(anchor, content);
  const block = range && documentLayoutBlocks(content).find((entry) => entry.startOffset === range.start && entry.endOffset === range.end);
  if (!block || !isOrdinaryLayoutParagraph(content, block)) return null;
  const matches = store.overrides.filter((entry): entry is ParagraphLayoutOverride => entry.kind === "paragraph-layout" && entry.file === file && sameAnchor(entry, anchor, content));
  const existing = matches[0];
  const properties: ParagraphLayoutProperties = {
    ...(existing ? { alignment: existing.alignment, firstLineIndentPt: existing.firstLineIndentPt, spacingBeforePt: existing.spacingBeforePt, spacingAfterPt: existing.spacingAfterPt } : {}),
    ...patch,
  };
  for (const key of ["alignment", "firstLineIndentPt", "spacingBeforePt", "spacingAfterPt"] as const) if (properties[key] === undefined) delete properties[key];
  const overrides = store.overrides.filter((entry) => !matches.some((candidate) => candidate === entry));
  const refreshed = createSourceAnchor(content, block.startOffset, block.endOffset);
  if (hasParagraphLayoutProperties(properties) && refreshed) overrides.push({ id: existing?.id ?? newLayoutOverrideId(), file, kind: "paragraph-layout", anchor: refreshed, ...properties });
  return { ...store, overrides };
}

export async function applyParagraphLayoutChange(app: App, settings: FeuilletsSettings, manuscriptPath: string, file: TFile, content: string, anchor: SourceAnchor, patch: ParagraphLayoutProperties): Promise<boolean> {
  const relative = relativeDocumentLayoutPath(manuscriptPath, file);
  if (!relative) return false;
  const next = updateParagraphLayoutOverride(await loadLayoutStore(app, settings), relative, content, anchor, patch);
  if (!next) return false;
  await saveLayoutStore(app, settings, next);
  return true;
}

export async function toggleDocumentLayoutPageBreak(app: App, settings: FeuilletsSettings, manuscriptPath: string, file: TFile, content: string, anchor: SourceAnchor): Promise<boolean> {
  const range = resolveSourceAnchor(anchor, content);
  if (!range || !documentLayoutBlocks(content).some((block) => block.startOffset === range.start && block.endOffset === range.end)) return false;
  const target = { paginationAnchor: anchor };
  const values = await documentLayoutValuesForTarget(app, settings, manuscriptPath, file, content, target);
  await applyDocumentLayoutChanges(app, settings, manuscriptPath, file, content, target, { ...values, pagination: !values.pagination });
  return true;
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
