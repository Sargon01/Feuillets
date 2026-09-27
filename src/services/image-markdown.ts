/**
 * Shared image-Markdown semantics: one parser, one formatter, reused by
 * Continu's inline renderer (utils/cm-scrivenings-markdown.ts), the Pandoc
 * package's media collector (services/compile-export.ts), and the
 * add/edit/remove image-caption editor actions — instead of several
 * incompatible ad-hoc regexes.
 *
 * Canonical syntax (the Markdown source is the only source of truth — never
 * YAML, sidecar metadata, or custom HTML):
 *   ![[image.png]]                       plain embed
 *   ![](image.png)                       plain embed
 *   ![[image.png|300]]                   plain embed, explicit width
 *   ![[image.png|300x200]]               plain embed, explicit width/height
 *   ![Caption](image.png)                captioned
 *   ![Caption](<Pasted image ....png>)   captioned, target contains spaces
 *   ![Caption](folder/image%20name.png)  captioned, URI-encoded target
 *
 * A wikilink's numeric alias (`|300`, `|300x200`) is always a size, never a
 * caption — this mirrors exactly the rule export-render.ts's `realCaption`
 * already applies to Obsidian's own rendered `alt` attribute.
 */

export type ImageMarkdownSyntax = "wikilink" | "markdown";

export interface ParsedImageMarkdown {
  syntax: ImageMarkdownSyntax;
  /** Raw target/destination exactly as written (angle brackets stripped,
   * still URI-encoded if it was) — never decoded here; decoding is a
   * resolution-time concern (see the existing `decodeURIComponent`
   * fallbacks in scrivenings-view.ts and compile-export.ts). */
  target: string;
  /** Real caption text, present only for the standard Markdown syntax with
   * non-empty alt text — never a numeric wikilink alias. */
  caption?: string;
  width?: number;
  height?: number;
}

const WIKILINK_SIZE_RE = /^([0-9]+)(?:x([0-9]+))?$/;

function parseWikilinkAlias(alias: string): { width?: number; height?: number } {
  const match = WIKILINK_SIZE_RE.exec(alias);
  if (!match) return {};
  const width = Number(match[1]);
  const height = match[2] === undefined ? undefined : Number(match[2]);
  return {
    ...(Number.isFinite(width) ? { width } : {}),
    ...(height !== undefined && Number.isFinite(height) ? { height } : {}),
  };
}

/** Strips one layer of CommonMark angle-bracket destination wrapping
 * (`<target>` -> `target`) — a destination that isn't wrapped is returned
 * trimmed and otherwise untouched. */
export function stripAngleBrackets(destination: string): string {
  const trimmed = destination.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Parses ONE full image embed, given exactly its text (e.g. an already
 * `.trim()`-ed source line — callers own locating that substring). `null`
 * for anything that is not a recognized image embed at all; callers that
 * only want to treat known raster extensions as images still check the
 * target's extension themselves (this parser is syntax-only, extension-
 * agnostic, so it stays reusable for callers with different extension
 * policies).
 */
export function parseImageMarkdown(embed: string): ParsedImageMarkdown | null {
  const trimmed = embed.trim();
  if (trimmed.startsWith("![[") && trimmed.endsWith("]]")) {
    const inner = trimmed.slice(3, -2);
    const pipe = inner.indexOf("|");
    const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
    if (!target) return null;
    const size = pipe < 0 ? {} : parseWikilinkAlias(inner.slice(pipe + 1).trim());
    return { syntax: "wikilink", target, ...size };
  }
  if (!trimmed.startsWith("![") || !trimmed.endsWith(")")) return null;
  const closeAlt = findUnescapedCaptionEnd(trimmed, 2);
  if (closeAlt < 0) return null;
  const target = stripAngleBrackets(trimmed.slice(closeAlt + 2, -1));
  if (!target) return null;
  const altText = trimmed.slice(2, closeAlt);
  const caption = unescapeImageCaption(altText);
  return { syntax: "markdown", target, ...(caption ? { caption } : {}) };
}

/**
 * Index of the `]` that closes the `[...]` caption span starting at
 * `start`, or `-1` if none exists. A deterministic scanner, not a full
 * Markdown parser: it only needs to (a) skip a backslash-escaped character
 * — so an escaped `\]` is never mistaken for the real terminator, even when
 * immediately followed by `(` (e.g. a caption containing the literal text
 * `]( `) — and (b) require the candidate `]` to be immediately followed by
 * `(`, exactly the shape `formatCaptionedImageMarkdown` always produces.
 */
function findUnescapedCaptionEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2; // the escaped character itself is never structural here
      continue;
    }
    if (ch === "]" && text[i + 1] === "(") return i;
    i += 1;
  }
  return -1;
}

/** True when `target` needs `<...>` CommonMark destination wrapping to stay
 * parseable as a single, unambiguous destination — currently: any
 * whitespace. Obsidian does not accept a bare, unencoded space there. */
export function imageTargetNeedsAngleBrackets(target: string): boolean {
  return /\s/.test(target);
}

/** `target` as it must appear between the parentheses of a Markdown image
 * destination: wrapped in `<...>` only when required. */
export function formatImageTarget(target: string): string {
  return imageTargetNeedsAngleBrackets(target) ? `<${target}>` : target;
}

/** Escapes the three characters that would otherwise be structurally
 * significant once the result is re-parsed:
 * - `\` (would escape whatever follows);
 * - `]` (could close the caption early — see `findUnescapedCaptionEnd`);
 * - `[` (only actually ambiguous as the very first character, where an
 *   unescaped one would make the result start with `![[`, indistinguishable
 *   from a wikilink embed — escaped everywhere for a single, uniform rule
 *   rather than a leading-position special case).
 * Accents, Unicode, French punctuation, apostrophes and parentheses need no
 * escaping inside `[...]` and are left exactly as typed — parentheses are
 * only ever structural inside the destination `(...)`, never inside the
 * caption span itself. Order matters: backslashes first, so the backslashes
 * this function itself introduces are never re-escaped. */
export function escapeImageCaption(caption: string): string {
  return caption.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

/** Inverse of `escapeImageCaption`: `\[` -> `[`, `\]` -> `]`, `\\` -> `\`,
 * scanned left to right so a doubled backslash is never mistaken for two
 * separate escapes. */
function unescapeImageCaption(caption: string): string {
  return caption.replace(/\\([\\[\]])/g, "$1");
}

/** `![[target]]` — the plain, Obsidian-native embed form. */
export function formatPlainImageMarkdown(target: string): string {
  return `![[${target}]]`;
}

/** `![Caption](target)`, angle-bracket-wrapping `target` when it contains
 * whitespace and escaping `caption` — never `![Caption](target with spaces)`,
 * which Obsidian would misparse. */
export function formatCaptionedImageMarkdown(target: string, caption: string): string {
  return `![${escapeImageCaption(caption)}](${formatImageTarget(target)})`;
}
