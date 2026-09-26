import type { ScriveningsDocument, ScriveningsSegment } from "./scrivenings-document.js";

/**
 * Clipboard serialization for Scrivenings (Continu).
 *
 * The composite document only carries file bodies joined by a structural
 * joint; the file titles shown between segments are non-editable widgets and
 * never part of the text. This module turns a composite selection into the
 * Markdown that should reach the clipboard: the selected text, plus the
 * Markdown title of every segment whose beginning the selection covers.
 *
 * Pure: no Vault, no CodeMirror, no clipboard API. Title resolution is
 * injected (`titleFor`) so the caller reuses the single shared rule
 * (`resolvedFileTitleMarkdown`, services/compile-export.ts).
 */

/** Resolves the Markdown title block to put before a segment, or `null` when
 * none is needed (e.g. the selected text already opens with a heading).
 * `selectedBody` is the selected part of the segment, which always starts at
 * `segment.from` whenever a title is requested. */
export type ScriveningsClipboardTitleResolver = (segment: ScriveningsSegment, selectedBody: string) => string | null;

/** Markdown title blocks of the structural folders (parts, chapters) entered
 * between `previous` (the preceding segment of the document, `null` for the
 * first one) and `segment` — outermost first, only the folders `segment`
 * enters. Injected like `titleFor`: the folder rules live with the caller. */
export type ScriveningsClipboardFolderTitles = (segment: ScriveningsSegment, previous: ScriveningsSegment | null) => string[];

/**
 * Text to copy for the composite range `[from, to)`.
 *
 * - Selection inside a single segment: the exact slice, never a title.
 * - Selection spanning several segments: each segment whose start
 *   (`segment.from`) lies inside the selection gets its title first. A
 *   selection starting mid-body gets no title for that first segment; one
 *   ending exactly at `nextSegment.from` does not reach the next segment.
 *   An empty last segment counts as reached when the selection extends to
 *   the end of the document (select-all).
 * - Selecting the whole document counts as a multi-unit copy even with a
 *   single segment, so its titles are present.
 * - `folderTitlesFor` (optional) adds, before a segment's own title, the
 *   titles of the structural folders it enters relative to the previous
 *   segment (never those before the start of the selection).
 * - Between units the structural joint is replaced by exactly one blank line.
 */
export function buildScriveningsClipboardText(
  doc: ScriveningsDocument,
  from: number,
  to: number,
  titleFor: ScriveningsClipboardTitleResolver,
  folderTitlesFor?: ScriveningsClipboardFolderTitles
): string {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(doc.text.length, Math.max(from, to));
  const plain = doc.text.slice(start, end);
  if (end <= start) return plain;

  const lastIndex = doc.segments.length - 1;
  const reached = doc.segments.filter((segment, index) => {
    if (start > segment.to) return false;
    if (end > segment.from) return true;
    return index === lastIndex && segment.from === segment.to && end === doc.text.length && start < segment.from;
  });
  const wholeDocument = start === 0 && end === doc.text.length;
  if (reached.length < 2 && !wholeDocument) return plain;

  const chunks: string[] = [];
  for (const segment of reached) {
    const atStart = start <= segment.from;
    const index = doc.segments.indexOf(segment);
    const sliceStart = Math.max(start, segment.from);
    const sliceEnd = Math.min(end, segment.to);
    const selected = doc.text.slice(sliceStart, Math.max(sliceStart, sliceEnd));
    const title = atStart ? titleFor(segment, selected) : null;
    const folders = atStart && folderTitlesFor ? folderTitlesFor(segment, index > 0 ? doc.segments[index - 1] : null) : [];
    // Blank lines a body starts with (e.g. after its frontmatter) would pile
    // up behind the generated titles: drop them there only.
    const body = title || folders.length ? selected.replace(/^\n+/, "") : selected;
    const chunk = [...folders, ...(title ? [title] : []), ...(body ? [body] : [])].join("\n\n");
    if (chunk) chunks.push(chunk);
  }

  return chunks.reduce((out, chunk, index) => (index === 0 ? chunk : `${out.replace(/\n+$/, "")}\n\n${chunk.replace(/^\n+/, "")}`), "");
}
