import type { HeadingOutlineInput } from "./heading-outline.js";

function isValidHeading(heading: HeadingOutlineInput): boolean {
  return (
    Number.isInteger(heading.level) &&
    heading.level >= 1 &&
    heading.level <= 6 &&
    Number.isInteger(heading.startOffset) &&
    heading.startOffset >= 0
  );
}

/** Returns the semantic heading ancestry at a Markdown cursor offset. */
export function headingTrailAtOffset(
  headings: readonly HeadingOutlineInput[],
  cursorOffset: number
): HeadingOutlineInput[] {
  if (!Number.isInteger(cursorOffset) || cursorOffset < 0) return [];

  const sorted = [...headings];
  const offsets = new Set<number>();
  for (const heading of sorted) {
    if (!isValidHeading(heading) || offsets.has(heading.startOffset)) return [];
    offsets.add(heading.startOffset);
  }
  sorted.sort((a, b) => a.startOffset - b.startOffset);

  const trail: HeadingOutlineInput[] = [];
  for (const heading of sorted) {
    if (heading.startOffset > cursorOffset) break;
    while (trail.length > 0 && trail[trail.length - 1].level >= heading.level) {
      trail.pop();
    }
    trail.push(heading);
  }
  return trail;
}
