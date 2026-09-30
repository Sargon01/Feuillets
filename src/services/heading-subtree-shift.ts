import { headingSectionRange } from "./heading-section-move.js";
import type { HeadingOutlineInput } from "./heading-outline.js";

export type HeadingSubtreeShiftDirection = "promote" | "demote";

export interface ShiftHeadingSubtreeResult {
  text: string;
  changed: boolean;
}

type MarkerReplacement = {
  offset: number;
  level: number;
};

function openingMarkerOffset(text: string, heading: HeadingOutlineInput): number | null {
  const lineEnd = text.indexOf("\n", heading.startOffset);
  const line = text.slice(heading.startOffset, lineEnd === -1 ? text.length : lineEnd);
  const marker = /^[ \t]*(#{1,6})(?=[ \t]|$)/.exec(line);
  if (!marker || marker[1].length !== heading.level) return null;
  return heading.startOffset + marker[0].length - marker[1].length;
}

/** Shifts a heading and every heading in its semantic Markdown subtree. */
export function shiftHeadingSubtree(
  text: string,
  headings: readonly HeadingOutlineInput[],
  sourceStartOffset: number,
  direction: HeadingSubtreeShiftDirection
): ShiftHeadingSubtreeResult | null {
  if (direction !== "promote" && direction !== "demote") return null;

  const section = headingSectionRange(headings, sourceStartOffset, text.length);
  if (!section) return null;

  const subtree = headings.filter(
    (heading) => heading.startOffset >= section.startOffset && heading.startOffset < section.endOffset
  );
  if (subtree.length === 0) return null;

  const replacements: MarkerReplacement[] = [];
  for (const heading of subtree) {
    const offset = openingMarkerOffset(text, heading);
    if (offset === null) return null;
    replacements.push({ offset, level: heading.level });
  }

  const delta = direction === "promote" ? -1 : 1;
  if (replacements.some((replacement) => replacement.level + delta < 1 || replacement.level + delta > 6)) {
    return { text, changed: false };
  }

  let shifted = text;
  for (const replacement of replacements.sort((a, b) => b.offset - a.offset)) {
    shifted =
      shifted.slice(0, replacement.offset) +
      "#".repeat(replacement.level + delta) +
      shifted.slice(replacement.offset + replacement.level);
  }
  return { text: shifted, changed: true };
}
