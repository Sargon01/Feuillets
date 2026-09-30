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
  length: number;
  replacement: (level: number) => string;
};

function headingMarker(text: string, heading: HeadingOutlineInput): MarkerReplacement | null {
  const lineEnd = text.indexOf("\n", heading.startOffset);
  const lineRaw = text.slice(heading.startOffset, lineEnd === -1 ? text.length : lineEnd);
  const line = lineRaw.replace(/\r$/, "");
  const marker = /^[ \t]*(#{1,6})(?=[ \t]|$)/.exec(line);
  if (marker && marker[1].length === heading.level) {
    const offset = heading.startOffset + marker[0].length - marker[1].length;
    return { offset, level: heading.level, length: heading.level, replacement: (level) => "#".repeat(level) };
  }
  if (lineEnd === -1) return null;
  const underlineStart = lineEnd + 1;
  const underlineEnd = text.indexOf("\n", underlineStart);
  const underline = text.slice(underlineStart, underlineEnd === -1 ? text.length : underlineEnd).replace(/\r$/, "");
  const setext = /^[ \t]*(=+|-+)[ \t]*$/.exec(underline);
  if (!setext || (setext[1][0] === "=" ? 1 : 2) !== heading.level || line !== heading.text) return null;
  const lineBreakLength = text.slice(lineEnd, underlineStart).length;
  const length = lineRaw.length + lineBreakLength + underline.length;
  const newline = lineRaw.endsWith("\r") ? "\r\n" : "\n";
  return {
    offset: heading.startOffset,
    level: heading.level,
    length,
    replacement: (level) => level <= 2 ? `${line}${newline}${(level === 1 ? "=" : "-").repeat(setext[1].length)}` : `${"#".repeat(level)} ${line}`,
  };
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
    const replacement = headingMarker(text, heading);
    if (replacement === null) return null;
    replacements.push(replacement);
  }

  const delta = direction === "promote" ? -1 : 1;
  if (replacements.some((replacement) => replacement.level + delta < 1 || replacement.level + delta > 6)) {
    return { text, changed: false };
  }

  let shifted = text;
  for (const replacement of replacements.sort((a, b) => b.offset - a.offset)) {
    shifted =
      shifted.slice(0, replacement.offset) +
      replacement.replacement(replacement.level + delta) +
      shifted.slice(replacement.offset + replacement.length);
  }
  return { text: shifted, changed: true };
}
