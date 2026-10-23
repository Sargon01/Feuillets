import { parser } from "@lezer/markdown";
import { frenchTypography } from "./core.js";

export type LiveTypographySettings = Pick<FeuilletsSettings, "liveApostrophe" | "liveEllipsis">;
export interface TypographyChange { from: number; to: number; insert: string }

/** Markdown is parsed only to identify exclusions. The existing typography
 * rules are applied to eligible individual tokens, never to a whole document
 * or paste (which would also change quotes and punctuation spacing). */
function protectedRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  const yaml = /^(?:\uFEFF)?---\r?\n[\s\S]*?(?:\r?\n(?:---|\.\.\.)(?:\r?\n|$)|$)/.exec(text);
  if (yaml) ranges.push({ from: 0, to: yaml[0].length });
  const excluded = new Set(["FencedCode", "CodeBlock", "InlineCode", "Link", "Image", "Autolink", "LinkReference", "HTMLTag", "HTMLBlock"]);
  parser.parse(text).iterate({ enter(node) {
    if (excluded.has(node.name)) {
      ranges.push({ from: node.from, to: node.to });
      return false;
    }
    return undefined;
  } });
  // Obsidian wikilinks and bare URLs are not CommonMark links. Attributes,
  // math and escapes also carry syntax outside fenced/inline code.
  for (const expression of [
    /!?\[\[[^\]\n]*(?:\]\]|$)/g,
    /!?\[[^\]\n]*\]\([^\n)]*(?:\)|$)/gm,
    /\b(?:[a-z][a-z\d+.-]*:\/\/|mailto:|www\.)[^\s<>]+/gi,
    /\b[\w.-]+\s*=\s*(?:'[^'\n]*(?:'|$)|"[^"\n]*(?:"|$))/gm,
    /\$\$[\s\S]*?(?:\$\$|$)|\$[^$\n]+\$/g,
    /\\['.]/g,
    /^[ \t\u00a0]+\r?$/gm,
  ]) {
    for (const match of text.matchAll(expression)) ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

/** A word pair is evidence only when every occurrence in text/plain uses an
 * ordinary space. Ambiguous pairs and intentional NBSPs are left alone.
 * Markdown emphasis delimiters don't affect the identity of the words. */
function spaceKey(text: string, from: number, to: number): string | null {
  // Bound the context so a large paste doesn't rescan the entire preceding
  // document for every space. Unusually long tokens are ambiguous: skip them.
  const left = /([\p{L}\p{N}’']+)[*_~.!?,;:»]*$/u.exec(text.slice(Math.max(0, from - 256), from));
  const right = /^[*_~«]*([\p{L}\p{N}’']+)/u.exec(text.slice(to, to + 256));
  if (!left || !right) return null;
  if ((from > 256 && left.index === 0) || (to + 256 < text.length && right[0].length === 256)) return null;
  return `${left[1]}\n${right[1]}`;
}

function ordinarySpaceEvidence(plain: string): Set<string> {
  const ordinary = new Set<string>();
  const nonbreaking = new Set<string>();
  for (const match of plain.matchAll(/[ \u00a0\u202f]+/g)) {
    const key = spaceKey(plain, match.index, match.index + match[0].length);
    if (key) (match[0] === " " ? ordinary : nonbreaking).add(key);
  }
  for (const key of nonbreaking) ordinary.delete(key);
  return ordinary;
}

export function liveTypographyChanges(
  text: string,
  inserted: readonly { from: number; to: number }[],
  settings: LiveTypographySettings,
  paste: boolean,
  plain?: string,
): TypographyChange[] {
  const protectedText = protectedRanges(text);
  const allowed = (from: number, to: number) => !protectedText.some((range) => from < range.to && to > range.from);
  const spaces = paste && plain !== undefined ? ordinarySpaceEvidence(plain) : new Set<string>();
  const changes: TypographyChange[] = [];
  for (const range of inserted) {
    const pastedText = text.slice(range.from, range.to);
    const alignedPlain = paste && plain !== undefined &&
      pastedText.replace(/\u00a0/g, " ") === plain.replace(/\u00a0/g, " ") ? plain : undefined;
    const wordSpaces = [...pastedText.matchAll(/[ \u00a0]/g)].filter((match) => spaceKey(pastedText, match.index, match.index + 1));
    const nonbreakingCount = wordSpaces.filter((match) => match[0] === "\u00a0").length;
    // A lone word group may be intentional even if the plain representation
    // flattened it. Repair only the observed dense-HTML contamination pattern.
    const contaminated = nonbreakingCount >= 3 && nonbreakingCount / wordSpaces.length >= 0.6;
    const start = paste ? range.from : Math.max(0, range.from - 2);
    const fragment = text.slice(start, range.to);
    for (const match of fragment.matchAll(/'|\.{3}|\u00a0/g)) {
      const from = start + match.index;
      const to = from + match[0].length;
      if (to <= range.from || !allowed(from, to)) continue;
      if (match[0] === "'" && settings.liveApostrophe && /\p{L}/u.test(text[from - 1] ?? "") &&
        (!paste || /\p{L}/u.test(text[to] ?? ""))) {
        changes.push({ from, to, insert: frenchTypography(match[0], false) });
      } else if (match[0] === "..." && settings.liveEllipsis && text[from - 1] !== "." && text[to] !== ".") {
        changes.push({ from, to, insert: frenchTypography(match[0], false) });
      } else if (match[0] === "\u00a0" && paste && contaminated && from >= range.from &&
        !/[;:!?»]/.test(text[to] ?? "") && text[from - 1] !== "«") {
        const key = spaceKey(text, from, to);
        const numeric = /\p{N}[*_~.,]*$/u.test(text.slice(Math.max(0, from - 32), from)) || /^[*_~]*\p{N}/u.test(text.slice(to, to + 32));
        const ordinary = alignedPlain !== undefined ? alignedPlain[from - range.from] === " " : key !== null && spaces.has(key);
        if (!numeric && ordinary) changes.push({ from, to, insert: " " });
      }
    }
  }
  return changes;
}
