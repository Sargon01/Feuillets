export interface SourceAnchor {
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface ResolvedSourceRange {
  start: number;
  end: number;
}

export const SOURCE_ANCHOR_CONTEXT_CHARS = 64;

function findAll(content: string, needle: string): number[] {
  if (!needle) return [];
  const result: number[] = [];
  for (let index = content.indexOf(needle); index !== -1; index = content.indexOf(needle, index + 1)) result.push(index);
  return result;
}

export function createSourceAnchor(content: string, start: number, end: number): SourceAnchor | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > content.length) return null;
  return {
    start,
    end,
    quote: content.slice(start, end),
    prefix: content.slice(Math.max(0, start - SOURCE_ANCHOR_CONTEXT_CHARS), start),
    suffix: content.slice(end, Math.min(content.length, end + SOURCE_ANCHOR_CONTEXT_CHARS)),
  };
}

export function resolveSourceAnchor(anchor: SourceAnchor, content: string): ResolvedSourceRange | null {
  if (Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.start >= 0 && anchor.start < anchor.end && anchor.end <= content.length && content.slice(anchor.start, anchor.end) === anchor.quote) {
    return { start: anchor.start, end: anchor.end };
  }
  const occurrences = findAll(content, anchor.quote);
  if (occurrences.length === 1) return { start: occurrences[0], end: occurrences[0] + anchor.quote.length };
  if (occurrences.length > 1) {
    const matches = occurrences.filter((start) => {
      const before = content.slice(Math.max(0, start - anchor.prefix.length), start);
      const after = content.slice(start + anchor.quote.length, start + anchor.quote.length + anchor.suffix.length);
      return (!anchor.prefix || before.endsWith(anchor.prefix)) && (!anchor.suffix || after.startsWith(anchor.suffix));
    });
    return matches.length === 1 ? { start: matches[0], end: matches[0] + anchor.quote.length } : null;
  }
  if (!anchor.prefix || !anchor.suffix) return null;
  const candidates: ResolvedSourceRange[] = [];
  for (const prefixStart of findAll(content, anchor.prefix)) {
    const start = prefixStart + anchor.prefix.length;
    for (const suffixStart of findAll(content, anchor.suffix)) {
      if (suffixStart >= start) candidates.push({ start, end: suffixStart });
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

export function refreshSourceAnchor(anchor: SourceAnchor, content: string): SourceAnchor | null {
  const range = resolveSourceAnchor(anchor, content);
  return range ? createSourceAnchor(content, range.start, range.end) : null;
}
