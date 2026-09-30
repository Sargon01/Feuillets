import type { HeadingOutlineInput } from "./heading-outline.js";

export type HeadingSectionPlacement = "before" | "after";

export interface HeadingSectionRange {
  startOffset: number;
  endOffset: number;
}

export interface MoveHeadingSectionResult {
  text: string;
  changed: boolean;
  movedStartOffset: number;
}

function isValidOffset(offset: number, max: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= max;
}

/** A copy of `headings`, ordered by `startOffset` ascending — never mutates
 * the input array or its objects. MetadataCache already delivers headings
 * in document order, but this pure engine stays correct even if it didn't. */
function orderedByStart(headings: readonly HeadingOutlineInput[]): HeadingOutlineInput[] {
  return [...headings].sort((a, b) => a.startOffset - b.startOffset);
}

/** Whether a single `HeadingOutlineInput` is internally coherent: integer
 * offsets and level, level within 1-6, non-negative offsets, a non-empty
 * span (`startOffset < endOffset`), and both offsets within the document.
 * `text` is never constrained — an empty heading title is not this
 * engine's concern. */
function isValidHeadingInput(heading: HeadingOutlineInput, documentLength: number): boolean {
  return (
    Number.isInteger(heading.startOffset) &&
    Number.isInteger(heading.endOffset) &&
    Number.isInteger(heading.level) &&
    heading.level >= 1 &&
    heading.level <= 6 &&
    heading.startOffset >= 0 &&
    heading.endOffset >= 0 &&
    heading.startOffset < heading.endOffset &&
    heading.startOffset <= documentLength &&
    heading.endOffset <= documentLength
  );
}

/** Whether every heading in `ordered` (already sorted by `startOffset`) is
 * individually well-formed AND the sequence itself is unambiguous — no two
 * headings share the same `startOffset`. A single malformed or ambiguous
 * entry invalidates the WHOLE list rather than just the one heading: this
 * engine feeds a future destructive mutation, so a partially inconsistent
 * MetadataCache snapshot must refuse outright (`null`) rather than attempt
 * an approximate move built on data it cannot fully trust. */
function headingsAreValid(ordered: readonly HeadingOutlineInput[], documentLength: number): boolean {
  for (let i = 0; i < ordered.length; i++) {
    if (!isValidHeadingInput(ordered[i], documentLength)) return false;
    if (i > 0 && ordered[i - 1].startOffset >= ordered[i].startOffset) return false;
  }
  return true;
}

/**
 * The semantic range of the section rooted at the heading whose
 * `startOffset` is `sourceStartOffset`: the heading itself, its body, and
 * every descendant, up to (but excluding) the next heading whose level is
 * less than or equal to the source heading's own level, or the end of the
 * document.
 *
 * Returns `null` when no heading matches `sourceStartOffset`, when the
 * offsets are not valid positions within a document of `documentLength`
 * characters, or when ANY heading in `headings` is individually malformed
 * or shares its `startOffset` with another — see `headingsAreValid`: a
 * partially inconsistent list is refused wholesale, never approximated.
 */
export function headingSectionRange(
  headings: readonly HeadingOutlineInput[],
  sourceStartOffset: number,
  documentLength: number
): HeadingSectionRange | null {
  if (!Number.isInteger(documentLength) || documentLength < 0) return null;
  if (!isValidOffset(sourceStartOffset, documentLength)) return null;

  const ordered = orderedByStart(headings);
  if (!headingsAreValid(ordered, documentLength)) return null;

  const sourceIndex = ordered.findIndex((heading) => heading.startOffset === sourceStartOffset);
  if (sourceIndex === -1) return null;
  const source = ordered[sourceIndex];

  let endOffset = documentLength;
  for (let i = sourceIndex + 1; i < ordered.length; i++) {
    if (ordered[i].level <= source.level) {
      endOffset = ordered[i].startOffset;
      break;
    }
  }

  if (source.startOffset >= endOffset) return null;
  return { startOffset: source.startOffset, endOffset };
}

const LF = "\n";
const CRLF = "\r\n";

/** The document's own line-ending style, detected rather than assumed —
 * never rewrites any EXISTING line break, only picks what to use for a
 * boundary that genuinely needs a new one (see joinAtBoundary). */
function newlineStyle(text: string): string {
  return text.includes(CRLF) ? CRLF : LF;
}

function startsWithNewline(fragment: string): boolean {
  return fragment.startsWith(LF) || fragment.startsWith("\r");
}

/** Concatenates `left` and `right`, inserting exactly one `newline` between
 * them ONLY when neither side already provides a line break at that exact
 * boundary — never touches any other newline already present in either
 * fragment, never collapses existing blank lines. Also reports the offset
 * at which `right`'s own content begins in the result, which
 * `moveHeadingSection` needs to compute `movedStartOffset`. */
function joinAtBoundary(left: string, right: string, newline: string): { text: string; rightOffset: number } {
  if (left.length === 0 || right.length === 0) return { text: left + right, rightOffset: left.length };
  if (left.endsWith(LF) || startsWithNewline(right)) return { text: left + right, rightOffset: left.length };
  return { text: left + newline + right, rightOffset: left.length + newline.length };
}

/** Maps an offset from the ORIGINAL text to its corresponding offset once
 * `[sourceStart, sourceEnd)` has been cut out of it. `>=` (not `>`) at the
 * cut end is deliberate: an insertion point that lands exactly where the
 * cut section used to END (e.g. moving a section right BEFORE the sibling
 * that already immediately follows it) must still map back to `sourceStart`
 * in the shortened text — using a strict `>` here would insert one section
 * too early and wrongly report a change for an already-adjacent, genuinely
 * no-op move. A target offset can never legitimately land strictly INSIDE
 * the cut range here: callers already reject that case as a no-op before
 * reaching this function. */
function adjustAfterRemoval(offset: number, sourceStart: number, sourceEnd: number): number {
  const sourceLength = sourceEnd - sourceStart;
  return offset >= sourceEnd ? offset - sourceLength : offset;
}

/**
 * Moves the Markdown section rooted at `sourceStartOffset` to just before
 * `targetStartOffset`, or just after that target's own COMPLETE section
 * (descendants included) — a pure cut-and-insert on `text`, driven entirely
 * by the offsets already known through `headings` (never a text search,
 * never a Markdown re-parse). Heading levels are never rewritten: the moved
 * block is byte-for-byte identical, only its position changes.
 *
 * Returns `null` for an invalid request (source or target heading not
 * found by its exact `startOffset`, or an out-of-range offset). Returns
 * `{ changed: false, text, movedStartOffset: sourceStartOffset }` — the
 * SAME `text` reference, never a reconstructed one — for a well-formed
 * request that produces no actual change: moving a section relative to
 * itself, to a target already inside its own subtree, or to a position it
 * already effectively occupies.
 */
export function moveHeadingSection(
  text: string,
  headings: readonly HeadingOutlineInput[],
  sourceStartOffset: number,
  targetStartOffset: number,
  placement: HeadingSectionPlacement
): MoveHeadingSectionResult | null {
  const documentLength = text.length;
  if (!isValidOffset(targetStartOffset, documentLength)) return null;

  const ordered = orderedByStart(headings);
  const sourceRange = headingSectionRange(ordered, sourceStartOffset, documentLength);
  if (!sourceRange) return null;

  const targetHeading = ordered.find((heading) => heading.startOffset === targetStartOffset);
  if (!targetHeading) return null;

  const noOp = (): MoveHeadingSectionResult => ({ text, changed: false, movedStartOffset: sourceStartOffset });

  if (sourceStartOffset === targetStartOffset) return noOp();
  // The target heading itself belongs to the source's own subtree: never
  // cut a block to reinsert it inside itself.
  if (targetStartOffset >= sourceRange.startOffset && targetStartOffset < sourceRange.endOffset) return noOp();

  let insertionOriginal: number;
  if (placement === "before") {
    insertionOriginal = targetStartOffset;
  } else {
    // "after" means after the target's own COMPLETE section, descendants
    // included — never merely after the target heading's own line.
    const targetRange = headingSectionRange(ordered, targetStartOffset, documentLength);
    if (!targetRange) return null;
    insertionOriginal = targetRange.endOffset;
  }

  const sourceSlice = text.slice(sourceRange.startOffset, sourceRange.endOffset);
  const withoutSource = text.slice(0, sourceRange.startOffset) + text.slice(sourceRange.endOffset);
  const insertionAdjusted = adjustAfterRemoval(insertionOriginal, sourceRange.startOffset, sourceRange.endOffset);

  const beforeInsertion = withoutSource.slice(0, insertionAdjusted);
  const afterInsertion = withoutSource.slice(insertionAdjusted);
  const newline = newlineStyle(text);

  const withSourceInserted = joinAtBoundary(beforeInsertion, sourceSlice, newline);
  const final = joinAtBoundary(withSourceInserted.text, afterInsertion, newline);

  // Comparing the fully reconstructed text against the original — rather
  // than reasoning about offsets alone — is what correctly recognizes an
  // already-adjacent move as a genuine no-op in every case, including ones
  // that are easy to get subtly wrong (see adjustAfterRemoval above).
  if (final.text === text) return noOp();

  return { text: final.text, changed: true, movedStartOffset: withSourceInserted.rightOffset };
}
