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

export type PandocCitationEntry = {
  key: string;
  authors: string[];
  year: string;
};

/**
 * Parse a BibTeX bibliography and extract minimal fields for author-date formatting.
 * Handles:
 * - Nested braces and quoted values
 * - author, editor (fallback), year, date (fallback)
 * - Ignores @string, @comment, @preamble
 *
 * Returns a Map of citekey → entry, or empty map on parse error.
 */
export function parsePandocCitationBibliography(
  bibtex: string
): Map<string, PandocCitationEntry> {
  const entries = new Map<string, PandocCitationEntry>();

  // Simple state machine to scan entries
  let pos = 0;
  while (pos < bibtex.length) {
    // Skip whitespace
    while (pos < bibtex.length && /\s/.test(bibtex[pos])) pos++;
    if (pos >= bibtex.length) break;

    // Look for @
    if (bibtex[pos] !== "@") {
      pos++;
      continue;
    }

    pos++; // skip @

    // Read entry type (article, book, etc.)
    let typeStart = pos;
    while (pos < bibtex.length && /[a-z]/i.test(bibtex[pos])) pos++;
    const entryType = bibtex.slice(typeStart, pos).toLowerCase();

    // Skip ignored types
    if (entryType === "string" || entryType === "comment" || entryType === "preamble") {
      // Skip to end of entry
      while (pos < bibtex.length && bibtex[pos] !== "{" && bibtex[pos] !== "(") pos++;
      if (pos >= bibtex.length) break;

      const openChar = bibtex[pos];
      const closeChar = openChar === "{" ? "}" : ")";
      pos++;

      let depth = 1;
      while (pos < bibtex.length && depth > 0) {
        if (bibtex[pos] === openChar) depth++;
        else if (bibtex[pos] === closeChar) depth--;
        pos++;
      }
      continue;
    }

    // Skip whitespace after type
    while (pos < bibtex.length && /\s/.test(bibtex[pos])) pos++;
    if (pos >= bibtex.length || (bibtex[pos] !== "{" && bibtex[pos] !== "(")) break;

    // Parse entry
    const openChar = bibtex[pos];
    const closeChar = openChar === "{" ? "}" : ")";
    pos++;

    // Extract citekey
    let keyStart = pos;
    while (pos < bibtex.length && bibtex[pos] !== "," && bibtex[pos] !== closeChar) pos++;
    const citekey = bibtex.slice(keyStart, pos).trim();

    if (!citekey) break;

    // Skip comma after citekey
    if (pos < bibtex.length && bibtex[pos] === ",") pos++;

    // Parse fields: key = value pairs
    const fields = new Map<string, string>();
    let depth = 0;

    while (pos < bibtex.length) {
      // Skip whitespace
      while (pos < bibtex.length && /\s/.test(bibtex[pos])) pos++;
      if (pos >= bibtex.length || bibtex[pos] === closeChar) break;

      // Read field name
      let fieldStart = pos;
      while (pos < bibtex.length && /[a-z0-9]/i.test(bibtex[pos])) pos++;
      const fieldName = bibtex.slice(fieldStart, pos).toLowerCase();

      if (!fieldName) {
        pos++;
        continue;
      }

      // Skip to =
      while (pos < bibtex.length && /[\s=]/.test(bibtex[pos])) pos++;

      // Read value
      let value = "";
      depth = 0;
      let inQuotes = false;

      while (pos < bibtex.length) {
        const ch = bibtex[pos];

        if (inQuotes) {
          if (ch === '"') {
            inQuotes = false;
          }
          value += ch;
          pos++;
        } else if (ch === '"') {
          inQuotes = true;
          value += ch;
          pos++;
        } else if (ch === "{") {
          depth++;
          value += ch;
          pos++;
        } else if (ch === "}") {
          if (depth === 0) break;
          depth--;
          value += ch;
          pos++;
        } else if ((ch === "," || ch === closeChar) && depth === 0) {
          break;
        } else {
          value += ch;
          pos++;
        }
      }

      // Clean value: remove outer quotes/braces
      value = value.trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("{") && value.endsWith("}")) {
        // Handle both single and double braces
        // {{...}} becomes {...}, {...} becomes ...
        // But preserve enough info for extractLastName to detect institutional authors
        value = value.slice(1, -1);
      }

      fields.set(fieldName, value);

      // Skip comma
      if (pos < bibtex.length && bibtex[pos] === ",") pos++;
    }

    // Skip closing char
    if (pos < bibtex.length && bibtex[pos] === closeChar) pos++;

    // Extract author and year
    const authors = extractAuthors(fields.get("author") || fields.get("editor") || "");
    const year = extractYear(fields.get("year") || fields.get("date") || "");

    // Only add if both author and year are present
    if (authors.length > 0 && year) {
      entries.set(citekey, {
        key: citekey,
        authors,
        year,
      });
    }
  }

  return entries;
}

/**
 * Extract author last names from a BibTeX author field.
 * Handles "Smith, John and Jones, Alice" or "John Smith and Alice Jones".
 * Also handles institutional authors with double braces: {{World Health Organization}}.
 */
function extractAuthors(authorField: string): string[] {
  if (!authorField.trim()) return [];

  const authors: string[] = [];

  // Split on top-level " and "
  let current = "";
  let depth = 0;
  let inQuotes = false;

  for (let i = 0; i < authorField.length; i++) {
    const ch = authorField[i];

    if (inQuotes) {
      current += ch;
      if (ch === '"') inQuotes = false;
    } else if (ch === '"') {
      inQuotes = true;
      current += ch;
    } else if (ch === "{") {
      depth++;
      current += ch;
    } else if (ch === "}") {
      depth--;
      current += ch;
    } else if (depth === 0 && authorField.slice(i, i + 5).toLowerCase() === " and ") {
      // Top-level " and "
      const lastNm = extractLastName(current.trim());
      if (lastNm) authors.push(lastNm);
      current = "";
      i += 4;
    } else {
      current += ch;
    }
  }

  // Last author
  if (current.trim()) {
    const lastNm = extractLastName(current.trim());
    if (lastNm) authors.push(lastNm);
  }

  return authors;
}

/**
 * Extract the last name from a single author.
 * "Smith, John" → "Smith"
 * "John Smith" → "Smith"
 * "John Michael Smith" → "Smith"
 * "{{World Health Organization}}" → "World Health Organization"
 * "{World Health Organization}" → "World Health Organization"
 */
function extractLastName(author: string): string {
  author = author.trim();

  // Handle institutional authors: {{...}} (double braces indicate organization)
  if (author.startsWith("{{") && author.endsWith("}}")) {
    return author.slice(2, -2).trim();
  }

  // Handle single braces: {...}
  // Note: value is already stripped of outer delimiters by the parser,
  // so {World Health Organization} from the BibTeX author = {{World Health Organization}}
  // becomes {World Health Organization} in value, then we further strip to World Health Organization
  if (author.startsWith("{") && author.endsWith("}")) {
    const inner = author.slice(1, -1).trim();
    // If inner starts with {, it's double-braced (institutional)
    if (inner.startsWith("{") && inner.endsWith("}")) {
      return inner.slice(1, -1).trim();
    }
    // Single braces, use the inner content
    return inner;
  }

  // If contains comma, first part is last name
  if (author.includes(",")) {
    return author.split(",")[0].trim();
  }

  // Otherwise, last word is last name
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1] || "";
}

/**
 * Extract year from year or date field.
 * "2024" → "2024"
 * "2023-06-12" → "2023"
 * "2023/06/12" → "2023"
 */
function extractYear(yearOrDate: string): string {
  const match = yearOrDate.match(/\d{4}/);
  return match ? match[0] : "";
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
