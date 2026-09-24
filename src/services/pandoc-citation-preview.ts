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
 * Split text into untouched runs and recognized citation groups.
 *
 * Single source of truth for citation recognition, shared by every renderer
 * (plain-text rewrite, Live Preview folding, Reading Mode). A group whose
 * citekeys are not all resolvable stays a plain text segment, which keeps the
 * raw Pandoc syntax visible — the "unknown citekey" contract every consumer
 * relies on.
 *
 * `start`/`end` on each segment are offsets within `text` spanning the raw
 * source for that segment (not the formatted output), which is what a caller
 * needs to map a segment back onto document positions.
 */
export function splitPandocCitationSegments(
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
 * Build a detached bibliographic notice element for one or more citekeys — the
 * SAME element (down to the class names and DOM shape) used by both Live
 * Preview's widget and Reading Mode's post-processor, so the two surfaces can
 * never visually drift apart.
 *
 * Built with the GLOBAL `createEl`/`createSpan` (never a container-scoped call):
 * both consumers attach the returned node themselves — a CodeMirror WidgetType
 * mounts it itself, and a post-processor inserts it into an already-live element.
 * Both live in the SAME document as the rest of Obsidian (never an iframe), so
 * these global DOM helpers are always valid here.
 *
 * Every piece of bibliographic data is written with `textContent`, never
 * `innerHTML`: a title containing `<b>` or any other markup is shown as literal
 * text, never interpreted.
 *
 * Returns null if none of the citekeys resolve to a record (nothing to show).
 */
export function buildCitationNoticeElement(
  citekeys: readonly string[],
  records: ReadonlyMap<string, BibtexCatalogEntry>
): HTMLElement | null {
  const notices = citekeys
    .map((key) => records.get(key))
    .filter((entry): entry is BibtexCatalogEntry => Boolean(entry));
  if (notices.length === 0) return null;

  const tooltip = createSpan({ cls: PANDOC_CITATION_TOOLTIP_CLASS });
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
