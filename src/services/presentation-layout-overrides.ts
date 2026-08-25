import {
  layoutOverridesForFile,
  newLayoutOverrideId,
  type LayoutOverride,
  type LayoutStore,
} from "./layout-store.js";
import { createSourceAnchor, resolveSourceAnchor, type SourceAnchor } from "./source-anchor.js";
import { splitPresentationMarkdownWithRanges, type PresentationSlideSource } from "./presentation.js";
import type { PresentationLayoutOverride } from "./presentation-layout-engine.js";

export type ResolvedPresentationSlideLayouts = Map<number, LayoutOverride & { kind: "slide-layout" }>;

function lineStarts(markdown: string): number[] {
  const starts = [0];
  for (let i = 0; i < markdown.length; i++) if (markdown[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineEnd(markdown: string, starts: number[], line: number): number {
  const next = starts[line + 1];
  const rawEnd = next === undefined ? markdown.length : next - 1;
  return rawEnd > starts[line] && markdown[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
}

function isLogicalSeparator(line: string): boolean { return /^(?:---|\*\*\*|___)[ \t]*$/.test(line.trim()); }
function isFenceOnly(line: string): boolean { return /^(`{3,}|~{3,})[ \t]*$/.test(line.trim()); }

/** Première ligne source réellement porteuse du contenu de la slide. */
export function createPresentationSlideAnchor(fullMarkdown: string, slide: PresentationSlideSource): SourceAnchor | null {
  const starts = lineStarts(fullMarkdown);
  for (let line = slide.startLine; line <= slide.endLine; line++) {
    if (starts[line] === undefined) continue;
    const start = starts[line];
    const end = lineEnd(fullMarkdown, starts, line);
    const value = fullMarkdown.slice(start, end);
    if (!value.trim() || isLogicalSeparator(value) || isFenceOnly(value)) continue;
    return createSourceAnchor(fullMarkdown, start, end);
  }
  return null;
}

export function presentationSlideIndexForRange(fullMarkdown: string, slides: readonly PresentationSlideSource[], start: number, end: number): number {
  const starts = lineStarts(fullMarkdown);
  const line = starts.findIndex((offset, index) => start >= offset && (starts[index + 1] === undefined || start < starts[index + 1]));
  if (line < 0) return -1;
  return slides.findIndex((slide) => line >= slide.startLine && line <= slide.endLine && end <= lineEnd(fullMarkdown, starts, slide.endLine));
}

export function resolvePresentationSlideLayouts(
  fullMarkdown: string,
  slides: readonly PresentationSlideSource[],
  overrides: readonly LayoutOverride[],
): ResolvedPresentationSlideLayouts {
  const result: ResolvedPresentationSlideLayouts = new Map();
  const collided = new Set<number>();
  for (const override of overrides) {
    if (override.kind !== "slide-layout") continue;
    const range = resolveSourceAnchor(override.anchor, fullMarkdown);
    if (!range) continue;
    const index = presentationSlideIndexForRange(fullMarkdown, slides, range.start, range.end);
    if (index < 0) continue;
    if (collided.has(index)) continue;
    if (result.has(index)) {
      result.delete(index);
      collided.add(index);
      console.warn(`Feuillets: plusieurs slide-layout résolus sur la diapositive ${index + 1}; retour en automatique.`);
      continue;
    }
    result.set(index, override);
  }
  return result;
}

export function replacePresentationSlideLayout(
  store: LayoutStore,
  file: string,
  fullMarkdown: string,
  slides: readonly PresentationSlideSource[],
  slideIndex: number,
  layout: PresentationLayoutOverride | null,
): LayoutStore {
  const target = slides[slideIndex];
  if (!target) return store;
  const anchor = createPresentationSlideAnchor(fullMarkdown, target);
  if (!anchor) return store;
  const kept = store.overrides.filter((override) => {
    if (override.kind !== "slide-layout" || override.file !== file) return true;
    const range = resolveSourceAnchor(override.anchor, fullMarkdown);
    return !range || presentationSlideIndexForRange(fullMarkdown, slides, range.start, range.end) !== slideIndex;
  });
  if (layout === null) return { ...store, overrides: kept };
  kept.push({ id: newLayoutOverrideId(), file, kind: "slide-layout", anchor, layout });
  return { ...store, overrides: kept };
}

export function resolvePresentationSlideLayoutsFromMarkdown(fullMarkdown: string, store: LayoutStore, file: string): ResolvedPresentationSlideLayouts {
  const slides = splitPresentationMarkdownWithRanges(fullMarkdown);
  return resolvePresentationSlideLayouts(fullMarkdown, slides, layoutOverridesForFile(store, file));
}

/** Ce dont le planificateur a besoin pour respecter les choix de l'auteur. */
export interface PresentationPlanningOverrides {
  /** Dispositions manuelles, indexées par segment EXPLICITE (avant découpe automatique). */
  slideLayouts: Map<number, PresentationLayoutOverride>;
  /** Lignes source portant un saut explicite (« Saut de page »). */
  forcedBreakLines: number[];
}

/**
 * Traduit les overrides STOCKÉS en entrées directement exploitables par
 * `planPresentationSlides`. Point d'entrée UNIQUE : les vues, la commande et
 * l'export PDF passent tous par ici, si bien qu'aucun d'eux ne peut planifier
 * sur une base différente des autres.
 *
 * Les dispositions sont volontairement résolues contre les segments
 * EXPLICITES : la découpe automatique n'a pas encore eu lieu au moment de la
 * planification, et c'est précisément ce qu'elles doivent pouvoir influencer.
 */
export function presentationPlanningOverrides(
  fullMarkdown: string,
  overrides: readonly LayoutOverride[],
): PresentationPlanningOverrides {
  const segments = splitPresentationMarkdownWithRanges(fullMarkdown);
  const resolved = resolvePresentationSlideLayouts(fullMarkdown, segments, overrides);
  const slideLayouts = new Map<number, PresentationLayoutOverride>();
  for (const [index, override] of resolved) slideLayouts.set(index, override.layout);

  const starts = lineStarts(fullMarkdown);
  const forcedBreakLines: number[] = [];
  for (const override of overrides) {
    if (override.kind !== "page-break-before") continue;
    const range = resolveSourceAnchor(override.anchor, fullMarkdown);
    if (!range) continue;
    const line = starts.findIndex((offset, index) =>
      range.start >= offset && (starts[index + 1] === undefined || range.start < starts[index + 1]));
    if (line >= 0 && !forcedBreakLines.includes(line)) forcedBreakLines.push(line);
  }
  return { slideLayouts, forcedBreakLines };
}
