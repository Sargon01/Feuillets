/**
 * Pandoc/Zotero citation preview — shared core.
 *
 * Transforms citekeys like [@smith2024] to (Smith, 2024) for visual clarity
 * without modifying the Markdown source. Author-date format only (simplified,
 * not a full CSL engine).
 * 1 author: Smith, 2024
 * 2 authors: Smith & Jones, 2024
 * 3+ authors: Smith et al., 2024
 *
 * This module holds the parsing, formatting, notice-building and shared cache
 * used by every surface that renders citations:
 * - src/services/pandoc-citation-preview.ts (this file): plain-text rewrite,
 *   used by PreviewView (Aperçu) and the export pipeline (ODT/PDF/DOCX/EPUB).
 * - src/utils/cm-pandoc-citation-live-preview.ts: CodeMirror 6 Live Preview
 *   folding, built on splitPandocCitationSegments() and buildCitationNoticeElement().
 * - src/services/pandoc-citation-reading-mode.ts: Reading Mode markdown
 *   post-processor, built on the same two functions.
 *
 * All three recognize citations with the exact same function
 * (splitPandocCitationSegments), so they can never disagree on what counts as
 * a citation or how it is formatted.
 */

import { App, TFile, normalizePath } from "obsidian";
import { parseBibtexCatalog, getCachedBibtexCatalog, type BibtexCatalogEntry } from "./bibtex-catalog.js";
import { getProjectFolder } from "./folder-structure.js";
import { resolveWorkspaceCitationResources } from "./workspace-citations.js";
import {
  intersectFloatingBounds,
  resolveFloatingAvailableSize,
  resolveFloatingPosition,
  type FloatingBounds,
} from "../utils/floating-position.js";

export type PandocCitationEntry = {
  key: string;
  authors: string[];
  year: string;
};

export type ExportCitationSettings = {
  style: PandocCitationPreviewStyle;
  bibliographyPath: string;
};

/**
 * Author-date entries used to render citation text, paired with the full BibTeX
 * records backing the notices. Both are derived from a single parse.
 */
export type PandocCitationCatalog = {
  entries: Map<string, PandocCitationEntry>;
  records: Map<string, BibtexCatalogEntry>;
};

/**
 * One slice of source text: either an untouched run, or a recognized citation
 * group. `start`/`end` are offsets within the INPUT string (not the output),
 * spanning the raw Pandoc syntax — what Live Preview needs to replace with a
 * decoration, and what a cursor position is compared against to reveal it.
 */
export type PandocCitationSegment =
  | { kind: "text"; text: string; start: number; end: number }
  | { kind: "citation"; text: string; citekeys: string[]; start: number; end: number };

export const PANDOC_CITATION_CLASS = "feuillets-pandoc-citation";
export const PANDOC_CITATION_LABEL_CLASS = "feuillets-pandoc-citation-label";
export const PANDOC_CITATION_TOOLTIP_CLASS = "feuillets-pandoc-citation-tooltip";

/**
 * Parse a BibTeX bibliography and extract minimal fields for author-date formatting.
 * Delegates to the shared parseBibtexCatalog parser.
 *
 * Test-facing pure helper: the production path (loadPandocCitationCatalog(), below)
 * goes through the shared getCachedBibtexCatalog() cache instead of parsing a raw
 * string directly, so it never re-reads or re-parses a bibliography the cache
 * already holds.
 *
 * Returns a Map of citekey → entry, or empty map on parse error.
 */
export function parsePandocCitationBibliography(
  bibtex: string
): Map<string, PandocCitationEntry> {
  return parsePandocCitationCatalog(bibtex).entries;
}

/**
 * Parse a BibTeX bibliography once and expose both the author-date entries used
 * for the rendered text and the full records used for the notices.
 *
 * Test-facing pure helper (see parsePandocCitationBibliography()); production code
 * builds the same shape from an already-parsed catalog via buildPandocCitationCatalog().
 */
export function parsePandocCitationCatalog(bibtex: string): PandocCitationCatalog {
  return buildPandocCitationCatalog(parseBibtexCatalog(bibtex));
}

/**
 * Derive the author-date entries and notice records from an already-parsed BibTeX
 * catalog, such as the one returned by the shared getCachedBibtexCatalog() cache.
 * Pure function: no file system access, no parsing.
 */
export function buildPandocCitationCatalog(
  records: readonly BibtexCatalogEntry[]
): PandocCitationCatalog {
  const entries = new Map<string, PandocCitationEntry>();
  const byKey = new Map<string, BibtexCatalogEntry>();

  for (const item of records) {
    if (item.authors.length > 0 && item.year) {
      entries.set(item.key, {
        key: item.key,
        authors: item.authors,
        year: item.year,
      });
      byKey.set(item.key, item);
    }
  }

  return { entries, records: byKey };
}

/**
 * Format author list for author-date display.
 * 1 author: "Smith"
 * 2 authors: "Smith & Jones"
 * 3+ authors: "Smith et al."
 */
function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  return `${authors[0]} et al.`;
}

/**
 * Format a single citation as (Author, Year) or (Author, Year, locator).
 * Suffix can include leading comma/space (e.g. ", p. 42") or not (e.g. "p. 42").
 * Pure function: no side effects.
 */
function formatCitation(entry: PandocCitationEntry, suffix: string = ""): string {
  const authors = formatAuthors(entry.authors);
  const year = entry.year;
  const text = `${authors}, ${year}`;

  if (!suffix.trim()) {
    return text;
  }

  // If suffix doesn't start with comma/space, add one
  if (!/^[\s,]/.test(suffix)) {
    return `${text}, ${suffix}`;
  }

  return `${text}${suffix}`;
}

/**
 * Format a single NARRATIVE citation as Author (Year) — the author sits
 * outside the parentheses, unlike formatCitation()'s (Author, Year), which
 * is exactly what distinguishes `@who2021` (narrative) from `[@who2021]`
 * (parenthetical) in Pandoc's own syntax. Reuses formatAuthors() — the
 * 1/2/3+ author rules are a single source of truth for both forms.
 */
function formatNarrativeCitation(entry: PandocCitationEntry): string {
  return `${formatAuthors(entry.authors)} (${entry.year})`;
}

/**
 * Transform text containing Pandoc citation groups.
 * Pure function: idempotent.
 *
 * Supports:
 * [@smith2024] → (Smith, 2024)
 * [@smith2024, p. 42] → (Smith, 2024, p. 42)
 * [@smith2024; @doe2023] → (Smith, 2024; Doe, 2023)
 *
 * Unsupported syntaxes remain unchanged:
 * @smith2024 (narrative, no brackets)
 * [-@smith2024] (suppress author)
 * [see @smith2024] (prefix not starting with @)
 *
 * Atomic failures: if any citekey in a group fails, the entire group is left unchanged.
 */
export function formatPandocCitationText(
  text: string,
  entries: ReadonlyMap<string, PandocCitationEntry>
): string {
  return splitPandocCitationSegments(text, entries)
    .map((segment) => segment.text)
    .join("");
}

/**
 * Options for splitPandocCitationSegments(). `narrative` is off by default so
 * formatPandocCitationText() — the plain-text rewrite behind PreviewView
 * (Aperçu) and the export pipeline — keeps its EXACT current behavior
 * (bracket-only, `@key` never touched) without passing anything: extending
 * this shared function must never change the Markdown, exports or Aperçu
 * output. Live Preview, Continu and Reading Mode explicitly pass
 * `{ narrative: true }`, since narrative citations must render identically
 * on all three interactive surfaces.
 */
export interface PandocCitationSegmentOptions {
  narrative?: boolean;
}

/**
 * Split text into untouched runs and recognized citation groups.
 *
 * Single source of truth for citation recognition, shared by every renderer
 * (plain-text rewrite, Live Preview folding, Reading Mode, Continu). A group
 * whose citekeys are not all resolvable stays a plain text segment, which
 * keeps the raw Pandoc syntax visible — the "unknown citekey" contract every
 * consumer relies on.
 *
 * `start`/`end` on each segment are offsets within `text` spanning the raw
 * source for that segment (not the formatted output), which is what a caller
 * needs to map a segment back onto document positions.
 *
 * Two independent passes, never one merged scan: pass 1 (below) recognizes
 * `[@key]` bracket groups exactly as before — UNTOUCHED, so its behavior and
 * test coverage stay valid byte-for-byte. Pass 2 (splitNarrativeCitationSegments(),
 * further down), only when `options.narrative` is true, re-scans each plain
 * "text" run pass 1 produced for bracket-less `@key` citations — never the
 * "citation" runs pass 1 already recognized, so a resolved [@key] group can
 * never be reprocessed or double-matched.
 */
export function splitPandocCitationSegments(
  text: string,
  entries: ReadonlyMap<string, PandocCitationEntry>,
  options: PandocCitationSegmentOptions = {}
): PandocCitationSegment[] {
  const bracketSegments = splitBracketPandocCitationSegments(text, entries);
  if (!options.narrative || entries.size === 0) return bracketSegments;

  const result: PandocCitationSegment[] = [];
  for (const segment of bracketSegments) {
    if (segment.kind === "citation") {
      result.push(segment);
      continue;
    }
    result.push(...splitNarrativeCitationSegments(segment.text, segment.start, entries));
  }
  return result;
}

function splitBracketPandocCitationSegments(
  text: string,
  entries: ReadonlyMap<string, PandocCitationEntry>
): PandocCitationSegment[] {
  if (!text || entries.size === 0) {
    return text ? [{ kind: "text", text, start: 0, end: text.length }] : [];
  }

  const segments: PandocCitationSegment[] = [];
  let pending = "";
  let pendingStart = 0;
  const pushText = (value: string, valueEnd: number): void => {
    if (!value) return;
    if (!pending) pendingStart = valueEnd - value.length;
    pending += value;
  };
  const flushText = (endPos: number): void => {
    if (pending) {
      segments.push({ kind: "text", text: pending, start: pendingStart, end: endPos });
      pending = "";
    }
  };

  let pos = 0;

  while (pos < text.length) {
    // Look for [
    const bracketIdx = text.indexOf("[", pos);
    if (bracketIdx === -1) {
      pushText(text.slice(pos), text.length);
      break;
    }

    // Add text before bracket
    pushText(text.slice(pos, bracketIdx), bracketIdx);

    // Check if this is a citation group: first content is @
    let contentStart = bracketIdx + 1;
    while (contentStart < text.length && /\s/.test(text[contentStart])) contentStart++;

    if (contentStart >= text.length || text[contentStart] !== "@") {
      // Not a citation group
      pushText("[", bracketIdx + 1);
      pos = bracketIdx + 1;
      continue;
    }

    // Find closing ]
    let closeIdx = contentStart;
    let depth = 0;
    while (closeIdx < text.length) {
      if (text[closeIdx] === "{") depth++;
      else if (text[closeIdx] === "}") depth--;
      else if (text[closeIdx] === "]" && depth === 0) break;
      closeIdx++;
    }

    if (closeIdx >= text.length) {
      // No closing bracket
      pushText("[", bracketIdx + 1);
      pos = bracketIdx + 1;
      continue;
    }

    // Extract group content
    const groupContent = text.slice(contentStart, closeIdx).trim();

    // Parse citations in group (separated by ;)
    const citations = groupContent.split(";").map((c) => c.trim());
    const formattedCitations: string[] = [];
    const citekeys: string[] = [];
    let allSuccess = true;

    for (const citation of citations) {
      if (!citation) continue;

      // Extract citekey and suffix
      const atIdx = citation.indexOf("@");
      if (atIdx === -1) {
        allSuccess = false;
        break;
      }

      let keyEnd = atIdx + 1;
      while (keyEnd < citation.length && /[a-z0-9_-]/i.test(citation[keyEnd])) keyEnd++;

      const citekey = citation.slice(atIdx + 1, keyEnd);
      const suffix = citation.slice(keyEnd).trim();

      // Look up citekey
      const entry = entries.get(citekey);
      if (!entry) {
        allSuccess = false;
        break;
      }

      // Format citation (suffix already includes commas/spaces if present)
      formattedCitations.push(formatCitation(entry, suffix));
      citekeys.push(citekey);
    }

    // Add result (all-or-nothing)
    if (allSuccess && formattedCitations.length > 0) {
      flushText(bracketIdx);
      segments.push({
        kind: "citation",
        text: `(${formattedCitations.join("; ")})`,
        citekeys,
        start: bracketIdx,
        end: closeIdx + 1,
      });
    } else {
      pushText(text.slice(bracketIdx, closeIdx + 1), closeIdx + 1);
    }

    pos = closeIdx + 1;
  }

  flushText(text.length);
  return segments;
}

/** Same citekey character class as splitBracketPandocCitationSegments()
 * above (`[a-z0-9_-]`, case-insensitive) — one source of truth for what a
 * citekey looks like, bracketed or not. */
const NARRATIVE_CITEKEY_CHAR = /[a-z0-9_-]/i;

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[a-z0-9_]/i.test(ch);
}

/** URL/URI schemes whose path component can legitimately contain `@key`
 * without it ever being a citation (a profile fragment, an anchor, part of
 * a query string…) — `https://example.org/@smith2024` must stay exactly as
 * written, even though its `@` is preceded by `/`, not a word character.
 * Deliberately NOT anchored with `^`: the scheme can sit behind leading
 * punctuation within the same token — `(https://…`, `<https://…`,
 * `"https://…`, or `](https://…` for a Markdown link's destination right
 * after its closing `]` — so a plain substring match is what actually
 * covers every shape isNarrativeUrlContext() below needs to catch, not just
 * a token that starts with the scheme. */
const NARRATIVE_URL_TOKEN = /(?:https?:\/\/|obsidian:\/\/|mailto:|www\.)/i;

/**
 * True when the `@` at `atIndex` sits inside a URL/URI TOKEN — the run of
 * non-whitespace, non-bracket characters immediately before it — that
 * CONTAINS a recognized scheme (`http://`, `https://`, `obsidian://`,
 * `mailto:`) or `www.`, however it is introduced (raw in prose, wrapped in
 * `(…)`/`<…>`/`"…"`, or used as a Markdown link destination). The "not
 * preceded by a word character" rule alone (isWordChar(), below) only
 * catches an `@` glued directly to a word (`contact@example.com`); it does
 * nothing for a scheme/slash/query character right before `@`, which is
 * exactly the shape of `@key` sitting inside a URL's path or query string.
 *
 * The backward scan itself still stops at whitespace or `[`/`]` — never at
 * `(`, `<`, `"`, etc. — so a token like `(https://example.org/` or, for
 * `[site](https://example.org/@key)`, `(https://example.org/` (scan stopped
 * at the link text's closing `]`) is captured whole and the un-anchored
 * regex finds the scheme inside it regardless of what leads it.
 */
function isNarrativeUrlContext(text: string, atIndex: number): boolean {
  let start = atIndex;
  while (start > 0 && !/\s/.test(text[start - 1]) && text[start - 1] !== "[" && text[start - 1] !== "]") {
    start--;
  }
  return NARRATIVE_URL_TOKEN.test(text.slice(start, atIndex));
}

/**
 * Re-scans ONE plain-text run (never a resolved "citation" segment — see
 * splitPandocCitationSegments()'s doc comment) for bracket-less narrative
 * citations: `@who2021` → "World Health Organization (2021)".
 *
 * Recognition rules, in order:
 * - the `@` must NOT be preceded by a word character. This alone excludes
 *   every email address and URL userinfo (`contact@example.com`,
 *   `user@host`) — their `@` always has a local-part directly before it —
 *   without any special-casing for "this looks like an email".
 * - the `@` must NOT sit inside a URL/URI token (isNarrativeUrlContext(),
 *   above) — the word-character rule above does not catch
 *   `https://example.org/@smith2024` (its `@` is preceded by `/`), so this
 *   is a second, independent guard specifically for that shape.
 * - bracket-depth tracking (`[`/`]` counted across this run): an `@` found
 *   INSIDE a `[...]` span is never treated as narrative, even when that
 *   span is an ordinary Markdown link (`[texte](url)`) or a citation-shaped
 *   bracket group that FAILED to resolve in pass 1 (e.g. `[@ok2024; @bad]`,
 *   left verbatim by splitBracketPandocCitationSegments()'s atomic-failure
 *   rule) — narrative syntax is by definition the bracket-LESS form, so
 *   anything already inside brackets is never eligible, resolved or not.
 * - an unresolved citekey (including an ordinary "@mention" that simply
 *   isn't in the bibliography) stays raw text, exactly like an unresolved
 *   bracketed citekey — no separate "is this a mention" heuristic needed.
 *
 * `offset` shifts every emitted segment's start/end back into the ORIGINAL
 * full string's coordinates (this run's `start`, from pass 1).
 */
function splitNarrativeCitationSegments(
  text: string,
  offset: number,
  entries: ReadonlyMap<string, PandocCitationEntry>
): PandocCitationSegment[] {
  const segments: PandocCitationSegment[] = [];
  let pending = "";
  let pendingStart = 0;
  const pushText = (value: string, valueEnd: number): void => {
    if (!value) return;
    if (!pending) pendingStart = valueEnd - value.length;
    pending += value;
  };
  const flushText = (endPos: number): void => {
    if (pending) {
      segments.push({ kind: "text", text: pending, start: offset + pendingStart, end: offset + endPos });
      pending = "";
    }
  };

  let pos = 0;
  let bracketDepth = 0;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === "[") {
      bracketDepth++;
      pushText(ch, pos + 1);
      pos++;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      pushText(ch, pos + 1);
      pos++;
      continue;
    }
    if (ch !== "@" || bracketDepth > 0 || isWordChar(text[pos - 1]) || isNarrativeUrlContext(text, pos)) {
      pushText(ch, pos + 1);
      pos++;
      continue;
    }

    let keyEnd = pos + 1;
    while (keyEnd < text.length && NARRATIVE_CITEKEY_CHAR.test(text[keyEnd])) keyEnd++;
    const citekey = text.slice(pos + 1, keyEnd);
    const entry = citekey ? entries.get(citekey) : undefined;

    if (!entry) {
      pushText(text.slice(pos, keyEnd), keyEnd);
      pos = keyEnd;
      continue;
    }

    flushText(pos);
    segments.push({
      kind: "citation",
      text: formatNarrativeCitation(entry),
      citekeys: [citekey],
      start: offset + pos,
      end: offset + keyEnd,
    });
    pos = keyEnd;
  }

  flushText(text.length);
  return segments;
}

/**
 * Join the non-empty parts of a notice line with the given separator.
 */
function joinParts(parts: (string | undefined)[], separator: string): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(separator);
}

/**
 * Build the notice lines shown for one bibliographic record.
 *
 * Uses only the fields present on the record, so a sparse entry stays readable
 * instead of producing empty or dangling punctuation. Deliberately free of prose
 * labels: the notice is built from bibliographic data and punctuation only, so it
 * needs no translation and never leaks UI strings into this service.
 */
export function buildCitationNoticeLines(entry: BibtexCatalogEntry): string[] {
  const lines: string[] = [];

  const creator = entry.author || entry.editor || entry.authors.join(", ");
  const year = entry.year || entry.date || "";
  const heading = year ? joinParts([creator, `(${year})`], " ") : creator;
  if (heading) lines.push(heading);

  if (entry.title) lines.push(entry.title);

  const container = entry.journal || entry.booktitle;
  if (container) {
    const issue = entry.number ? `(${entry.number})` : "";
    const volumeAndIssue = entry.volume ? `${entry.volume}${issue}` : issue;
    lines.push(joinParts([container, volumeAndIssue, entry.pages], ", "));
  } else if (entry.pages) {
    lines.push(entry.pages);
  }

  if (entry.publisher) lines.push(entry.publisher);

  const locator = entry.doi ? `https://doi.org/${entry.doi}` : entry.url;
  if (locator) lines.push(locator);

  return lines.length > 0 ? lines : [entry.key];
}

let tooltipIdCounter = 0;

/**
 * Builds one detached `<span>` in `ownerDocument`'s OWN window — never a
 * different (wrong) window. `ownerDocument.defaultView` is typed
 * `(WindowProxy & typeof globalThis) | null`: unlike Obsidian's own `.win`
 * (typed as a plain `Window`, with no visibility of the ambient
 * `createEl`/`createSpan` globals), `typeof globalThis` DOES carry those
 * declarations, so `defaultView.createSpan(...)` is both realm-correct and
 * the Obsidian-preferred DOM helper (obsidianmd/prefer-create-el) — no raw
 * `document.createElement()` needed. Falls back to the bare global
 * `createSpan()` only for a document with no browsing context at all
 * (`defaultView === null`, not a real rendering scenario) — the same
 * (main-window) behavior this whole mechanism had before this fix.
 */
function createPandocCitationSpan(ownerDocument: Document, cls: string): HTMLElement {
  const win = ownerDocument.defaultView;
  return win ? win.createSpan({ cls }) : createSpan({ cls });
}

/**
 * Build a detached bibliographic notice element for one or more citekeys — the
 * SAME element (down to the class names and DOM shape) used by both Live
 * Preview's widget and Reading Mode's post-processor, so the two surfaces can
 * never visually drift apart.
 *
 * `ownerDocument` is the CALLER's own document — `view.dom.ownerDocument` for
 * Live Preview/Continu (both CodeMirror `EditorView`s), `textNode.ownerDocument`
 * for Reading Mode — NEVER the global `document`: an Obsidian pane popped out
 * into its own OS window renders into a SEPARATE `Document`/`Window`, and a
 * node built via the global `createSpan()` (which resolves against the MAIN
 * window) would end up detached from the window the citation is actually
 * shown in. The root element is therefore built via
 * createPandocCitationSpan() (above), which resolves `ownerDocument`'s OWN
 * window (`ownerDocument.defaultView`) and calls ITS `createSpan()` —
 * scoped to exactly that document's window, never auto-appended anywhere,
 * exactly like the global `createSpan()` it replaces — every element
 * created FROM IT (`.createSpan()`, below) inherits the same correct realm
 * automatically.
 *
 * Every piece of bibliographic data is written with `textContent`, never
 * `innerHTML`: a title containing `<b>` or any other markup is shown as literal
 * text, never interpreted.
 *
 * Returns null if none of the citekeys resolve to a record (nothing to show).
 */
export function buildCitationNoticeElement(
  citekeys: readonly string[],
  records: ReadonlyMap<string, BibtexCatalogEntry>,
  ownerDocument: Document
): HTMLElement | null {
  const notices = citekeys
    .map((key) => records.get(key))
    .filter((entry): entry is BibtexCatalogEntry => Boolean(entry));
  if (notices.length === 0) return null;

  const tooltip = createPandocCitationSpan(ownerDocument, PANDOC_CITATION_TOOLTIP_CLASS);
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("id", `feuillets-pandoc-citation-tooltip-${++tooltipIdCounter}`);

  for (const entry of notices) {
    const notice = tooltip.createSpan({ cls: "feuillets-pandoc-citation-notice" });
    buildCitationNoticeLines(entry).forEach((line, index) => {
      const lineEl = notice.createSpan({
        cls:
          index === 0
            ? "feuillets-pandoc-citation-notice-line is-primary"
            : "feuillets-pandoc-citation-notice-line",
      });
      lineEl.textContent = line;
    });
  }

  return tooltip;
}

export const PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS = "feuillets-pandoc-citation-tooltip-visible";

/**
 * Every citation element's teardown, keyed by the element itself so a
 * destroyed widget (Live Preview, Continu) or an unloaded post-processor
 * render (Reading Mode) can dispose of it without either surface keeping its
 * own bookkeeping. A WeakMap never blocks garbage collection of a citation
 * element that some other path already dropped without disposing.
 */
const citationTooltipCleanups = new WeakMap<HTMLElement, () => void>();

/** Identifies the editor/preview panel a citation is rendered in —
 * `.cm-scroller` (Live Preview's and Continu's own CM6 `EditorView` both use
 * this class for their scrollable content element) or `.markdown-preview-view`
 * (Reading Mode's content pane). Checked in this order; whichever is found
 * first, stops the search — a citation is never rendered inside both. */
const HOST_PANEL_SELECTORS = [".cm-scroller", ".markdown-preview-view"];

/**
 * Nearest ancestor matching one of HOST_PANEL_SELECTORS, or null when
 * neither is found (e.g. a detached element, or a test harness that never
 * nests the citation under either) — resolveTooltipBounds() then falls back
 * to the browser viewport alone.
 */
function findHostPanel(citation: HTMLElement): HTMLElement | null {
  let node = citation.parentElement;
  while (node) {
    for (const selector of HOST_PANEL_SELECTORS) {
      if (typeof node.matches === "function" && node.matches(selector)) return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** `win.innerWidth`/`innerHeight` of the citation's OWN window — NEVER the
 * global `window`, which is a different, wrong window for a citation
 * rendered in an Obsidian pane popped out into its own OS window. `win` is
 * null only when `citation.ownerDocument.defaultView` itself is null (a
 * document with no associated browsing context — not a real rendering
 * scenario, but handled without throwing): a safe fixed fallback then takes
 * over, same convention as src/ui/annotation-popover.ts's
 * resolveViewportSize(). */
function resolveTooltipWindowBounds(win: Window | null): FloatingBounds {
  if (win) {
    return { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
  }
  return { left: 0, top: 0, right: 1024, bottom: 768 };
}

/**
 * The rect the tooltip must stay within: the intersection of `win`'s (the
 * citation's OWN window) viewport and — when one is found — the citation's
 * own host panel's rect. Never the viewport alone: a citation near the edge
 * of a narrow pane (a side-by-side split, or a pane next to a sidebar) must
 * never let the tooltip drift into that NEIGHBORING pane just because it is
 * still inside that window.
 */
function resolveTooltipBounds(citation: HTMLElement, win: Window | null): FloatingBounds {
  const windowBounds = resolveTooltipWindowBounds(win);
  const panel = findHostPanel(citation);
  if (!panel) return windowBounds;
  return intersectFloatingBounds(windowBounds, panel.getBoundingClientRect());
}

/** Grace period between the citation's `mouseleave` and the tooltip actually
 * closing — long enough for the pointer to travel the deliberate gap between
 * the citation and its portaled tooltip (see attachCitationTooltipBehavior()'s
 * doc comment), short enough to still feel immediate. */
export const TOOLTIP_CLOSE_GRACE_MS = 200;

/**
 * Wires the tooltip's collision-aware positioning and its show/hide
 * lifecycle onto `citation`. The tooltip starts (and, hidden, always ends up
 * back) nested inside `citation` — matching its original, pre-fix DOM shape —
 * but while SHOWN it is reparented to `doc.body` as `position: fixed`,
 * escaping every ancestor's `overflow: hidden`/`auto` clipping (the CM6
 * scroller and the Reading Mode content pane both clip an `overflow`ing
 * absolutely-positioned descendant; a `position: fixed` descendant of
 * `doc.body` is clipped by none of them). resolveFloatingPosition()
 * (utils/floating-position.ts) — the same collision math other floating UI in
 * this plugin could migrate onto — then keeps it within a 12px margin of
 * resolveTooltipBounds() (the viewport intersected with the citation's own
 * host panel, never the viewport alone — see that function's doc comment),
 * flipping above/below based on the citation's OWN measured position, never
 * a static CSS value.
 *
 * `doc`/`win` are `citation.ownerDocument`/its `.defaultView` — NEVER the
 * global `document`/`window`: a citation rendered in an Obsidian pane popped
 * out into its own OS window lives in a SEPARATE realm, and this function
 * must portal into, listen on, and observe THAT window, never the main one.
 * `win` can be null (a document with no browsing context); every use of it
 * below is null-safe and simply skips what needs a window when there isn't
 * one, rather than falling back to a DIFFERENT (wrong) window.
 *
 * Reposition triggers: shown (hover/focus), then on every `scroll` (capture
 * phase, so a scroll on the CM6 scroller or the Markdown preview pane is
 * caught even though "scroll" does not bubble), `resize` (the citation's own
 * window), and a `ResizeObserver` — from that SAME window's realm, per
 * `win.ResizeObserver` — on the host panel itself (catches an Obsidian pane
 * split being dragged, which resizes the panel without ever firing a window
 * "resize" event) — all three only while the tooltip stays open, torn down
 * the moment it closes, so an idle citation never holds a window-level
 * listener or an active observer.
 *
 * Hover is tracked on BOTH `citation` and `tooltip`: once the tooltip is
 * portaled out of `citation`'s subtree, `:hover`-through-a-descendant no
 * longer keeps it open on its own, so moving the pointer from the citation
 * text into the tooltip (to read a long entry, or select its text) must be
 * tracked explicitly instead. Leaving the CITATION specifically never closes
 * synchronously: `closeCitationHoverWithGrace()` gives the pointer
 * `TOOLTIP_CLOSE_GRACE_MS` to actually reach the tooltip (there IS a real
 * gap to cross — the tooltip sits `gap` pixels away, see
 * utils/floating-position.ts) before the tooltip disappears out from under
 * it; entering the tooltip (or regaining focus) within that window cancels
 * the pending close via `open()`. Leaving the TOOLTIP itself, or losing
 * focus, closes immediately if nothing else keeps it open — there is no gap
 * to cross in the other direction.
 *
 * Sizing: before ever measuring the tooltip's own width/height,
 * reposition() clamps them (inline `min-width`/`max-width`/`max-height`,
 * neutralizing the CSS class's own `width: max-content`, which has no upper
 * bound of its own) to resolveFloatingAvailableSize()'s result — the REAL
 * space left inside resolveTooltipBounds(), margin already subtracted. A
 * multi-reference notice taller than that available height scrolls
 * internally (`overflow-y: auto`) rather than ever exceeding the panel.
 * Positioning alone cannot fix an oversized element (resolveFloatingPosition()
 * can only slide it within existing space, never shrink it), which is why
 * this sizing pass must run first, every time, not just when it happens to
 * be needed.
 *
 * The returned dispose function cancels any pending grace-period close,
 * removes every listener and observer this call added, clears every
 * temporary inline style reposition() set, and restores `tooltip` as a child
 * of `citation` — registered in citationTooltipCleanups under `citation`,
 * retrieved by disposePandocCitationElement().
 */
function attachCitationTooltipBehavior(citation: HTMLElement, tooltip: HTMLElement): void {
  const doc = citation.ownerDocument;
  const win = doc.defaultView;

  const openReasons = new Set<string>();
  let visible = false;
  let resizeObserver: ResizeObserver | null = null;
  let closeTimer: number | null = null;

  const clearScheduledClose = (): void => {
    if (closeTimer !== null) {
      win?.clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const reposition = (): void => {
    const anchorRect = citation.getBoundingClientRect();
    const bounds = resolveTooltipBounds(citation, win);
    const available = resolveFloatingAvailableSize(bounds);

    // Clamp size FIRST, re-measure AFTER: a tooltip whose natural content
    // (a long title, several stacked references) exceeds the panel must
    // shrink to fit — never overflow it regardless of where it is placed.
    // Template literals throughout (never a plain string literal): the
    // obsidianmd/no-static-styles-assignment lint rule only flags a bare
    // string-literal assignment to `.style.*`, exactly like its own
    // documented exemption for `el.style.transform =
    // \`translateX(${offset}px)\``) — every one of these four values is a
    // genuinely per-redraw computed layout number (or a fixed constant
    // written the same way for consistency), never a theming concern.
    tooltip.style.minWidth = `0`;
    tooltip.style.maxWidth = `${available.width}px`;
    tooltip.style.maxHeight = `${available.height}px`;
    tooltip.style.overflowY = `auto`;

    const size = { width: tooltip.offsetWidth, height: tooltip.offsetHeight };
    const { left, top } = resolveFloatingPosition(anchorRect, size, bounds);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const onScrollOrResize = (): void => reposition();

  const show = (): void => {
    if (visible) return;
    doc.body.appendChild(tooltip);
    tooltip.classList.add(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS);
    visible = true;
    reposition();
    win?.addEventListener("scroll", onScrollOrResize, true);
    win?.addEventListener("resize", onScrollOrResize);
    const panel = findHostPanel(citation);
    const ResizeObserverCtor = win?.ResizeObserver;
    if (panel && typeof ResizeObserverCtor === "function") {
      resizeObserver = new ResizeObserverCtor(onScrollOrResize);
      resizeObserver.observe(panel);
    }
  };
  const hide = (): void => {
    if (!visible) return;
    clearScheduledClose();
    win?.removeEventListener("scroll", onScrollOrResize, true);
    win?.removeEventListener("resize", onScrollOrResize);
    resizeObserver?.disconnect();
    resizeObserver = null;
    tooltip.classList.remove(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS);
    tooltip.style.removeProperty("left");
    tooltip.style.removeProperty("top");
    tooltip.style.removeProperty("min-width");
    tooltip.style.removeProperty("max-width");
    tooltip.style.removeProperty("max-height");
    tooltip.style.removeProperty("overflow-y");
    citation.appendChild(tooltip);
    visible = false;
  };
  const open = (reason: string): void => {
    clearScheduledClose();
    openReasons.add(reason);
    show();
  };
  /** Immediate close — used by every reason EXCEPT leaving the citation
   * itself (see closeCitationHoverWithGrace() below). */
  const closeNow = (reason: string): void => {
    openReasons.delete(reason);
    clearScheduledClose();
    if (openReasons.size === 0) hide();
  };
  /** Leaving the citation never closes synchronously — see this function's
   * own doc comment for why. Schedules hide() after TOOLTIP_CLOSE_GRACE_MS,
   * cancelled by open() if any reason (typically tooltip-hover) reopens it
   * first. Without a window to schedule on, there is no grace period to
   * give: close immediately instead of staying open forever. */
  const closeCitationHoverWithGrace = (): void => {
    openReasons.delete("citation-hover");
    if (openReasons.size > 0) return;
    clearScheduledClose();
    if (!win) {
      hide();
      return;
    }
    closeTimer = win.setTimeout(() => {
      closeTimer = null;
      if (openReasons.size === 0) hide();
    }, TOOLTIP_CLOSE_GRACE_MS);
  };

  const onCitationEnter = (): void => open("citation-hover");
  const onCitationLeave = (): void => closeCitationHoverWithGrace();
  const onTooltipEnter = (): void => open("tooltip-hover");
  const onTooltipLeave = (): void => closeNow("tooltip-hover");
  const onFocusIn = (): void => open("focus");
  const onFocusOut = (): void => closeNow("focus");

  citation.addEventListener("mouseenter", onCitationEnter);
  citation.addEventListener("mouseleave", onCitationLeave);
  tooltip.addEventListener("mouseenter", onTooltipEnter);
  tooltip.addEventListener("mouseleave", onTooltipLeave);
  citation.addEventListener("focusin", onFocusIn);
  citation.addEventListener("focusout", onFocusOut);

  citationTooltipCleanups.set(citation, () => {
    openReasons.clear();
    clearScheduledClose();
    hide();
    citation.removeEventListener("mouseenter", onCitationEnter);
    citation.removeEventListener("mouseleave", onCitationLeave);
    tooltip.removeEventListener("mouseenter", onTooltipEnter);
    tooltip.removeEventListener("mouseleave", onTooltipLeave);
    citation.removeEventListener("focusin", onFocusIn);
    citation.removeEventListener("focusout", onFocusOut);
    citationTooltipCleanups.delete(citation);
  });
}

/**
 * Builds one full `.feuillets-pandoc-citation` element — label, optional
 * tooltip, and (when a tooltip exists) its accessible wiring and collision-
 * aware positioning behavior — the SINGLE place that does so. Both DOM-
 * building call sites (PandocCitationWidget.toDOM(view), Live Preview and
 * Continu; wrapCitationsInTextNode(), Reading Mode) build their citation
 * element through this function instead of duplicating the same five lines,
 * so the positioning fix in attachCitationTooltipBehavior() above is written
 * — and can only ever be written — once.
 *
 * `ownerDocument` is the CALLER's own document (never the global `document`
 * — see buildCitationNoticeElement()'s doc comment for why this matters for
 * an Obsidian pane popped out into its own window): `view.dom.ownerDocument`
 * for the CodeMirror callers, `textNode.ownerDocument` for Reading Mode.
 */
export function buildPandocCitationElement(
  text: string,
  citekeys: readonly string[],
  records: ReadonlyMap<string, BibtexCatalogEntry>,
  ownerDocument: Document
): HTMLElement {
  const citation = createPandocCitationSpan(ownerDocument, PANDOC_CITATION_CLASS);
  citation.setAttribute("data-citekeys", citekeys.join(","));
  citation.createSpan({ cls: PANDOC_CITATION_LABEL_CLASS, text });

  const tooltip = buildCitationNoticeElement(citekeys, records, ownerDocument);
  if (tooltip) {
    citation.appendChild(tooltip);
    citation.setAttribute("tabindex", "0");
    citation.setAttribute("aria-describedby", tooltip.getAttribute("id") || "");
    attachCitationTooltipBehavior(citation, tooltip);
  }

  return citation;
}

/**
 * Releases whatever attachCitationTooltipBehavior() registered for `citation`
 * (temporary window listeners if a tooltip happened to be open, and the
 * citation/tooltip's own event listeners) — a no-op for a citation built
 * without a tooltip (nothing was ever registered) or already disposed.
 *
 * Called from PandocCitationWidget.destroy() (Live Preview, Continu — a CM6
 * WidgetType lifecycle hook) and from the MarkdownRenderChild registered by
 * registerPandocCitationReadingMode() (Reading Mode — unloaded once its
 * containerEl is detached, on rerender or view close).
 */
export function disposePandocCitationElement(citation: HTMLElement): void {
  citationTooltipCleanups.get(citation)?.();
}

/**
 * Resolve which bibliography (if any) applies to a specific file — the file the
 * editor or Reading Mode view is ACTUALLY showing, never a globally "active"
 * file. Passing the file itself (not a folder) to resolveWorkspaceCitationResources()
 * lets it resolve through the file's own folder-workspace scope chain, so two
 * panes open on siblings such as Work-A and Work-A-Extra resolve independently
 * and never share a bibliography by accident.
 *
 * The project itself (getProjectFolder()) is legitimately a single, plugin-wide
 * setting — it is the per-FILE workspace scope, not the project, that must never
 * be assumed from a globally active file.
 */
export function resolvePandocCitationPreviewForFile(
  app: App,
  settings: FeuilletsSettings,
  file: TFile
): { style: PandocCitationPreviewStyle; bibliographyPath: string } {
  const projectRoot = getProjectFolder(app, settings);
  if (!projectRoot) return { style: "off", bibliographyPath: "" };

  const projectMeta = settings.projectMeta?.[projectRoot.path];
  const style = (projectMeta?.pandocCitationPreviewStyle as PandocCitationPreviewStyle) || "off";
  if (style === "off") return { style, bibliographyPath: "" };

  const resolution = resolveWorkspaceCitationResources(app, settings, projectRoot, file);
  const bibliographyPath = resolution.bibliography.file ? resolution.bibliography.file.path : "";
  return { style, bibliographyPath };
}

// Concurrent calls for the SAME bibliography path share one in-flight load
// instead of each independently reading the file: without this, Live Preview
// rebuilding its decorations on every keystroke while a load is in flight would
// otherwise trigger one vault read per keystroke.
const inFlightCatalogLoads = new Map<string, Promise<PandocCitationCatalog | null>>();

/**
 * Load and parse a bibliography through the shared getCachedBibtexCatalog() cache
 * (bibtex-catalog.ts), keyed by path + mtime + size — the same cache the rest of
 * the citation tooling relies on. Used by every consumer of this module: no
 * surface keeps its own private bibliography cache.
 *
 * Returns null if style is "off", the path is empty, the file is missing, or
 * parsing yields no usable entry — every case silently falls back to raw text.
 */
export function loadPandocCitationCatalog(
  app: App,
  style: PandocCitationPreviewStyle,
  bibliographyPath: string
): Promise<PandocCitationCatalog | null> {
  if (style === "off" || !bibliographyPath.trim()) {
    return Promise.resolve(null);
  }

  const normalizedPath = normalizePath(bibliographyPath);
  const existing = inFlightCatalogLoads.get(normalizedPath);
  if (existing) return existing;

  const promise = (async (): Promise<PandocCitationCatalog | null> => {
    try {
      const file = app.vault.getAbstractFileByPath(normalizedPath);
      if (!file || !(file instanceof TFile)) return null;
      const records = await getCachedBibtexCatalog(app, file);
      const catalog = buildPandocCitationCatalog(records);
      return catalog.entries.size > 0 ? catalog : null;
    } catch {
      return null;
    } finally {
      inFlightCatalogLoads.delete(normalizedPath);
    }
  })();

  inFlightCatalogLoads.set(normalizedPath, promise);
  return promise;
}

/**
 * Minimal view surface the synchronous catalog cache below dispatches an
 * empty transaction to once a load resolves or a bibliography changes on
 * disk — structurally compatible with a real CodeMirror `EditorView`, so
 * every CM6 surface that renders citations (Live Preview's per-file editor,
 * cm-pandoc-citation-live-preview.ts; Continu's single composite editor,
 * cm-scrivenings-citations.ts) can register under this ONE shared cache
 * instead of each keeping a private one — the "réutiliser le cache BibTeX
 * partagé, aucune lecture par citation ou par survol" contract from both
 * callers' specs, enforced in one place instead of twice.
 */
export interface PandocCitationCatalogView {
  dispatch(spec: Record<string, unknown>): void;
}

/** One resolved bibliography, snapshotted against the mtime/size it was read
 * at — the same pair getCachedBibtexCatalog() itself keys its cache on, so a
 * later redraw can decide synchronously, from already-in-memory numbers,
 * whether a fresh read is actually needed. */
type PandocCitationCatalogSnapshot = { catalog: PandocCitationCatalog; mtime: number; size: number };
const syncCatalogSnapshots = new Map<string, PandocCitationCatalogSnapshot>();
const pendingCatalogLoads = new Set<string>();

/**
 * Every view currently displaying decorations built from a given
 * bibliography path — never a single "requester" view, and never scoped to
 * one surface: a Live Preview editor and a Continu editor open on files that
 * resolve to the SAME .bib both register here, so a single physical read
 * (deduplicated by loadPandocCitationCatalog()) wakes both once it resolves.
 */
const viewsByPath = new Map<string, Set<PandocCitationCatalogView>>();

export function registerPandocCitationCatalogView(path: string, view: PandocCitationCatalogView): void {
  let views = viewsByPath.get(path);
  if (!views) {
    views = new Set();
    viewsByPath.set(path, views);
  }
  views.add(view);
}

export function unregisterPandocCitationCatalogView(path: string | null, view: PandocCitationCatalogView): void {
  if (!path) return;
  const views = viewsByPath.get(path);
  if (!views) return;
  views.delete(view);
  if (views.size === 0) viewsByPath.delete(path);
}

/** Dispatches an empty transaction to every view registered for `path`. A
 * destroyed view's dispatch throws (or was already unregistered on its own
 * teardown), so this never fails as a whole. */
function wakeCatalogViews(path: string): void {
  const views = viewsByPath.get(path);
  if (!views) return;
  for (const view of [...views]) {
    try {
      view.dispatch({});
    } catch {
      // The view was closed before the load resolved: nothing to redraw.
    }
  }
}

/**
 * Invalidates the synchronous snapshot for `bibFile` and wakes every view
 * currently registered for it — never views registered for a different
 * bibliography, so a Continu editor spanning several .bib files only
 * refreshes the segments that actually depend on the one that changed. Call
 * from a vault "modify" event (see main.ts), registered in the plugin's own
 * lifecycle so it is unregistered automatically on unload.
 */
export function notifyPandocCitationBibliographyChanged(bibFile: TFile): void {
  const normalizedPath = normalizePath(bibFile.path);
  syncCatalogSnapshots.delete(normalizedPath);
  wakeCatalogViews(normalizedPath);
}

/**
 * Synchronous read of the last resolved catalog for `bibliographyPath`, kicking
 * off a fresh load (at most one in flight per path — see loadPandocCitationCatalog())
 * when the file is missing from the snapshot or its mtime/size no longer match.
 * A load in flight makes this redraw fall back to raw text; once it resolves,
 * wakeCatalogViews() dispatches an empty transaction to EVERY view registered for
 * this path, not only the one that happened to trigger the load.
 */
export function getSyncPandocCitationCatalog(
  app: App,
  style: PandocCitationPreviewStyle,
  bibliographyPath: string
): PandocCitationCatalog | null {
  const normalizedPath = normalizePath(bibliographyPath);
  const bibFile = app.vault.getAbstractFileByPath(normalizedPath);
  if (!(bibFile instanceof TFile)) {
    syncCatalogSnapshots.delete(normalizedPath);
    return null;
  }

  const mtime = bibFile.stat?.mtime ?? 0;
  const size = bibFile.stat?.size ?? 0;
  const snapshot = syncCatalogSnapshots.get(normalizedPath);
  if (snapshot && snapshot.mtime === mtime && snapshot.size === size) {
    return snapshot.catalog;
  }

  if (!pendingCatalogLoads.has(normalizedPath)) {
    pendingCatalogLoads.add(normalizedPath);
    void loadPandocCitationCatalog(app, style, bibliographyPath).then((catalog) => {
      pendingCatalogLoads.delete(normalizedPath);
      if (catalog) {
        syncCatalogSnapshots.set(normalizedPath, { catalog, mtime, size });
      } else {
        syncCatalogSnapshots.delete(normalizedPath);
      }
      wakeCatalogViews(normalizedPath);
    });
  }

  return null;
}

/**
 * Apply the plain-text Pandoc citation rewrite to a container's text nodes.
 * Traverses only eligible nodes (not inside CODE, PRE, A, SCRIPT, STYLE).
 * Rewrites text content in place; DOM structure unchanged. Used by PreviewView
 * (Aperçu) and the export pipeline — both want the plain author-date text, never
 * an interactive element.
 *
 * Returns immediately if style === "off" or bibliographyPath is empty.
 * Returns silently on file not found or parse error (does not throw, does not modify DOM).
 */
export async function applyPandocCitationPreview(
  app: App,
  container: HTMLElement,
  style: PandocCitationPreviewStyle,
  bibliographyPath: string
): Promise<void> {
  const catalog = await loadPandocCitationCatalog(app, style, bibliographyPath);
  if (!catalog) return;

  traverseTextNodes(container, (textNode) => {
    if (isEligibleForTransform(textNode)) {
      textNode.nodeValue = formatPandocCitationText(textNode.nodeValue || "", catalog.entries);
    }
  });
}

/**
 * Traverse all text nodes in a container and call a callback.
 */
function traverseTextNodes(
  node: Node,
  callback: (textNode: Text) => void
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    callback(node as Text);
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;

    // Skip protected elements
    if (["CODE", "PRE", "SCRIPT", "STYLE"].includes(element.tagName)) {
      return;
    }

    // For links, skip text transformation (avoid modifying already-rendered content)
    if (element.tagName === "A") {
      return;
    }

    // Recurse into children
    for (let i = 0; i < node.childNodes.length; i++) {
      traverseTextNodes(node.childNodes[i], callback);
    }
  }
}

/**
 * Check if a text node is eligible for citation transformation.
 */
function isEligibleForTransform(textNode: Text): boolean {
  const parent = textNode.parentElement;
  if (!parent) return false;

  // Skip if parent is protected
  const tagName = parent.tagName;
  if (["CODE", "PRE", "SCRIPT", "STYLE", "A"].includes(tagName)) {
    return false;
  }

  return true;
}
