import type { HeadingOutlineInput } from "./heading-outline.js";

function titleAt(text: string, heading: HeadingOutlineInput): string | null {
  const lineEnd = text.indexOf("\n", heading.startOffset);
  const line = text.slice(heading.startOffset, lineEnd === -1 ? text.length : lineEnd).replace(/\r$/, "");
  const atx = /^[ \t]*(#{1,6})[ \t]+(.*?)(?:[ \t]+#+[ \t]*)?$/.exec(line);
  if (atx) return atx[1].length === heading.level ? atx[2] : null;
  const underlineStart = lineEnd === -1 ? text.length : lineEnd + 1;
  const underlineEnd = text.indexOf("\n", underlineStart);
  const underline = text.slice(underlineStart, underlineEnd === -1 ? text.length : underlineEnd).replace(/\r$/, "");
  const setext = /^[ \t]*(=+|-+)[ \t]*$/.exec(underline);
  if (!setext) return null;
  const level = setext[1][0] === "=" ? 1 : 2;
  return level === heading.level ? line : null;
}

/** Verifies that every cached heading exactly matches the current text. */
export function headingsMatchText(text: string, headings: readonly HeadingOutlineInput[]): boolean {
  let previous = -1;
  for (const heading of headings) {
    if (!Number.isInteger(heading.startOffset) || !Number.isInteger(heading.endOffset)
      || heading.startOffset < 0 || heading.endOffset <= heading.startOffset || heading.endOffset > text.length
      || heading.startOffset <= previous || heading.level < 1 || heading.level > 6 || !Number.isInteger(heading.level)) return false;
    if (titleAt(text, heading) !== heading.text) return false;
    previous = heading.startOffset;
  }
  return true;
}
