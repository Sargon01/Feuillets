import type { Annotation } from "./annotations.js";
import { resolveAnnotation } from "./annotations.js";
import { presentationSlideIndexForLine, type PresentationSlideSource } from "./presentation.js";

export type PresentationPlanScope = "all" | "notes-only";

export interface PresentationPlanNote {
  annotationId: string;
  text: string;
  sourceStart: number;
}

export interface PresentationPlanNotesResult {
  notesBySlide: Map<number, PresentationPlanNote[]>;
  unresolvedAnnotationIds: string[];
}

function lineForOffset(markdown: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset; index++) if (markdown[index] === "\n") line++;
  return line;
}

export function mapPresentationNotesToSlides(
  markdown: string,
  slides: readonly PresentationSlideSource[],
  annotations: readonly Annotation[],
): PresentationPlanNotesResult {
  const notesBySlide = new Map<number, PresentationPlanNote[]>();
  const unresolvedAnnotationIds: string[] = [];
  for (const annotation of annotations) {
    if (annotation.presentationNote !== true || annotation.text.trim() === "") continue;
    const range = resolveAnnotation(annotation, markdown);
    if (!range) { unresolvedAnnotationIds.push(annotation.id); continue; }
    const slideIndex = presentationSlideIndexForLine(slides, lineForOffset(markdown, range.start));
    if (slideIndex < 0) continue;
    const notes = notesBySlide.get(slideIndex) ?? [];
    notes.push({ annotationId: annotation.id, text: annotation.text, sourceStart: range.start });
    notesBySlide.set(slideIndex, notes);
  }
  for (const notes of notesBySlide.values()) notes.sort((a, b) => a.sourceStart - b.sourceStart);
  return { notesBySlide, unresolvedAnnotationIds };
}

export interface PresentationPlanItem { slideIndex: number; notes: PresentationPlanNote[]; }
