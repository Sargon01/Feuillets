/**
 * Pandoc/Zotero citation preview in Aperçu.
 *
 * Transforms citekeys like [@smith2024] to (Smith, 2024) for visual clarity
 * without modifying the Markdown source.
 *
 * Author-date format only (simplified, not a full CSL engine).
 * 1 author: Smith, 2024
 * 2 authors: Smith & Jones, 2024
 * 3+ authors: Smith et al., 2024
 */

import { App, TFile, normalizePath } from "obsidian";
import { parseBibtexCatalog } from "./bibtex-catalog.js";

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
 * Parse a BibTeX bibliography and extract minimal fields for author-date formatting.
 * Delegates to the shared parseBibtexCatalog parser.
 *
 * Returns a Map of citekey → entry, or empty map on parse error.
 */
export function parsePandocCitationBibliography(
  bibtex: string
): Map<string, PandocCitationEntry> {
  const entries = new Map<string, PandocCitationEntry>();
  const catalog = parseBibtexCatalog(bibtex);

  for (const item of catalog) {
    if (item.authors.length > 0 && item.year) {
      entries.set(item.key, {
        key: item.key,
        authors: item.authors,
        year: item.year,
      });
    }
  }

  return entries;
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
  if (!text || entries.size === 0) return text;

  let result = "";
  let pos = 0;

  while (pos < text.length) {
    // Look for [
    const bracketIdx = text.indexOf("[", pos);
    if (bracketIdx === -1) {
      result += text.slice(pos);
      break;
    }

    // Add text before bracket
    result += text.slice(pos, bracketIdx);

    // Check if this is a citation group: first content is @
    let contentStart = bracketIdx + 1;
    while (contentStart < text.length && /\s/.test(text[contentStart])) contentStart++;

    if (contentStart >= text.length || text[contentStart] !== "@") {
      // Not a citation group
      result += "[";
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
      result += "[";
      pos = bracketIdx + 1;
      continue;
    }

    // Extract group content
    const groupContent = text.slice(contentStart, closeIdx).trim();

    // Parse citations in group (separated by ;)
    const citations = groupContent.split(";").map((c) => c.trim());
    const formattedCitations: string[] = [];
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
    }

    // Add result (all-or-nothing)
    if (allSuccess && formattedCitations.length > 0) {
      result += `(${formattedCitations.join("; ")})`;
    } else {
      result += text.slice(bracketIdx, closeIdx + 1);
    }

    pos = closeIdx + 1;
  }

  return result;
}

/**
 * Internal cache: path → { mtime, entries }
 */
const citationCache = new Map<
  string,
  {
    mtime: number;
    entries: Map<string, PandocCitationEntry>;
  }
>();

/**
 * Apply Pandoc citation preview to a container's text nodes.
 * Traverses only eligible nodes (not inside CODE, PRE, A, SCRIPT, STYLE).
 * Modifies text content in-place; DOM structure unchanged.
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
  // Early returns
  if (style === "off" || !bibliographyPath.trim()) {
    return;
  }

  // Normalize path
  const normalizedPath = normalizePath(bibliographyPath);

  // Get or load bibliography
  let entries: Map<string, PandocCitationEntry> | null = null;

  try {
    const file = app.vault.getAbstractFileByPath(normalizedPath);
    if (!file || !(file instanceof TFile)) {
      return; // File not found, silently skip
    }

    // Check cache
    const mtime = file.stat.mtime;
    const cached = citationCache.get(normalizedPath);

    if (cached && cached.mtime === mtime) {
      entries = cached.entries;
    } else {
      // Read and parse file
      const content = await app.vault.read(file);
      entries = parsePandocCitationBibliography(content);

      // Update cache
      citationCache.set(normalizedPath, { mtime, entries });
    }
  } catch {
    return; // Read error, silently skip
  }

  if (!entries || entries.size === 0) {
    return; // Parse error or empty, silently skip
  }

  // Traverse and transform text nodes
  traverseTextNodes(container, (textNode) => {
    if (isEligibleForTransform(textNode)) {
      textNode.nodeValue = formatPandocCitationText(textNode.nodeValue || "", entries);
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
