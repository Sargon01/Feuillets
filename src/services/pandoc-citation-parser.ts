/**
 * Structured Pandoc Citation Parser for Feuillets (Lot 7A).
 *
 * Pure syntax-level parser:
 * Markdown/Pandoc source -> ordered structured citation occurrences -> CitationClusterInput[].
 *
 * Invariants:
 * - Pure TypeScript: zero Obsidian runtime dependencies.
 * - Zero citation formatting (formatting belongs exclusively to the CSL engine / legacy preview).
 * - Exact source offsets: `from` and `to` match indices in the original input string.
 * - Deterministic cluster IDs: `citation:<from>:<to>`.
 * - No validation against bibliography content (unresolved citekeys remain structural).
 * - Safe protection for code, frontmatter, comments, links, wikilinks, URLs, and emails.
 */

import type {
  CitationClusterInput,
  CitationItemInput,
  CitationItemMode,
} from "../api/citation-contract.js";
import { isValidCitekey } from "./bibtex-catalog.js";

export interface ParsedPandocCitationOccurrence {
  clusterId: string;
  from: number;
  to: number;
  raw: string;
  cluster: CitationClusterInput;
}

export interface ParsedPandocCitationDocument {
  occurrences: ParsedPandocCitationOccurrence[];
  clusters: CitationClusterInput[];
}

/**
 * Masks destination URLs and optional link titles in inline Markdown links:
 * `[text](destination "title")` -> `[text](                  )`
 *
 * Leaves `text` untouched so any Pandoc citations within link text
 * (e.g. `[see @doe99](https://example.com)`) remain fully discoverable.
 * Strictly preserves string length and character offsets.
 */
function maskMarkdownLinkDestinations(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "]" && i + 1 < text.length) {
      let openParenIdx = i + 1;
      while (
        openParenIdx < text.length &&
        (text[openParenIdx] === " " || text[openParenIdx] === "\t")
      ) {
        openParenIdx++;
      }
      if (openParenIdx < text.length && text[openParenIdx] === "(") {
        let j = openParenIdx + 1;
        let depth = 1;
        let inQuotes = false;
        let quoteChar = "";
        while (j < text.length) {
          const ch = text[j];
          if (inQuotes) {
            if (ch === quoteChar && text[j - 1] !== "\\") {
              inQuotes = false;
            }
          } else {
            if (ch === '"' || ch === "'") {
              inQuotes = true;
              quoteChar = ch;
            } else if (ch === "(") {
              depth++;
            } else if (ch === ")") {
              depth--;
              if (depth === 0) break;
            }
          }
          j++;
        }
        if (j < text.length && depth === 0) {
          const before = text.slice(i, openParenIdx + 1);
          const dest = text.slice(openParenIdx + 1, j);
          result += before + " ".repeat(dest.length) + ")";
          i = j + 1;
          continue;
        }
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

/**
 * Masks protected Markdown contexts by replacing them with space characters
 * of identical length, strictly preserving character offsets.
 */
export function maskProtectedContexts(markdown: string): string {
  if (!markdown) return "";

  // 1. YAML frontmatter at the beginning of the text
  let masked = markdown.replace(/^---[\r\n]+[\s\S]*?[\r\n]+---(?:\r?\n|$)/, (m) =>
    " ".repeat(m.length)
  );

  // 2. HTML comments
  masked = masked.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));

  // 3. Fenced code blocks (``` or ~~~)
  masked = masked.replace(
    /^(?:[ ]{0,3})(```+|~~~+)[\s\S]*?\n(?:[ ]{0,3})\1[ \t]*(?:\r?\n|$)/gm,
    (m) => " ".repeat(m.length)
  );

  // 4. HTML <pre> and <code> blocks
  masked = masked.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (m) =>
    " ".repeat(m.length)
  );
  masked = masked.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, (m) =>
    " ".repeat(m.length)
  );

  // 5. Inline code (`...`)
  masked = masked.replace(/(`+)[^`\r\n]*?\1/g, (m) => " ".repeat(m.length));

  // 6. Wikilinks [[...]]
  masked = masked.replace(/\[\[[\s\S]*?\]\]/g, (m) => " ".repeat(m.length));

  // 7. Inline markdown link destinations: [text](destination)
  // Mask only the destination and optional title between ( and ); do NOT mask text.
  masked = maskMarkdownLinkDestinations(masked);

  // 8. Escaped brackets: \[ ... \] and escaped narrative citations: \@key
  masked = masked.replace(/\\\[[\s\S]*?\]/g, (m) => " ".repeat(m.length));
  masked = masked.replace(/\\@[^\s[\]@,;]+/g, (m) => " ".repeat(m.length));

  // 9. URLs in prose: http://..., https://..., mailto:...
  masked = masked.replace(/(?:https?:\/\/|mailto:)[^\s)\]>"']+/gi, (m) =>
    " ".repeat(m.length)
  );

  // 10. Email addresses: contact@example.com
  masked = masked.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    (m) => " ".repeat(m.length)
  );

  return masked;
}

export interface ExtractedPandocCitekey {
  key: string;
  keyEnd: number;
  isBraced: boolean;
}

const PANDOC_WORD_CHAR = /[a-zA-Z0-9_]/;
const PANDOC_INTERNAL_PUNCT = new Set([":", ".", "#", "$", "%", "&", "+", "-", "?", "<", ">", "/", "~"]);

/**
 * Extracts a Pandoc citation key starting at an '@' character.
 *
 * Supports:
 * 1. Braced keys: `@{key}`
 *    - Cannot be empty
 *    - Must have a matching closing brace '}'
 *    - No control characters
 *    - Validated by isValidCitekey(key)
 *    - Braces are stripped from the resulting key
 * 2. Non-braced keys: `@key`
 *    - Starts with: letter, digit, or underscore [a-zA-Z0-9_]
 *    - Internal characters: [a-zA-Z0-9_] and single Pandoc internal punctuation:
 *      : . # $ % & - + ? < > ~ /
 *      only when followed by a valid character allowing key continuation ([a-zA-Z0-9_])
 *    - Two consecutive internal punctuation characters terminate the key
 *    - A trailing punctuation character does not belong to the key
 *    - Validated by isValidCitekey(key)
 */
export function extractPandocCitekey(
  text: string,
  atIndex: number
): ExtractedPandocCitekey | null {
  if (atIndex < 0 || atIndex >= text.length || text[atIndex] !== "@") {
    return null;
  }

  const nextIdx = atIndex + 1;
  if (nextIdx >= text.length) {
    return null;
  }

  // 1. Braced citation key: @{...}
  if (text[nextIdx] === "{") {
    const braceStart = nextIdx;
    const braceEnd = text.indexOf("}", braceStart + 1);
    if (braceEnd === -1) {
      // Unclosed brace -> invalid
      return null;
    }

    const rawKey = text.slice(braceStart + 1, braceEnd);
    if (rawKey.length === 0) {
      // Empty braced key -> invalid
      return null;
    }

    // Reject control characters
    for (let i = 0; i < rawKey.length; i++) {
      const code = rawKey.charCodeAt(i);
      if (code <= 0x1f || code === 0x7f) {
        return null;
      }
    }

    if (!isValidCitekey(rawKey)) {
      return null;
    }

    return {
      key: rawKey,
      keyEnd: braceEnd + 1,
      isBraced: true,
    };
  }

  // 2. Non-braced citation key: @key
  const firstChar = text[nextIdx];
  if (!PANDOC_WORD_CHAR.test(firstChar)) {
    return null;
  }

  let i = nextIdx + 1;
  while (i < text.length) {
    if (PANDOC_WORD_CHAR.test(text[i])) {
      i++;
    } else if (
      PANDOC_INTERNAL_PUNCT.has(text[i]) &&
      i + 1 < text.length &&
      PANDOC_WORD_CHAR.test(text[i + 1])
    ) {
      // Single internal punctuation immediately followed by a word character
      i += 2;
    } else {
      // Two consecutive punctuation characters, non-Pandoc character, or trailing punctuation terminates the key
      break;
    }
  }

  const rawKey = text.slice(nextIdx, i);
  if (!isValidCitekey(rawKey)) {
    return null;
  }

  return {
    key: rawKey,
    keyEnd: i,
    isBraced: false,
  };
}

/**
 * Parses a single citation item chunk (e.g. from within a semicolon-separated bracket group).
 *
 * Supports:
 * - `@smith2024` / `@{Foo_bar.baz.}`
 * - `-@smith2024` / `-@{Foo_bar.baz.}` (suppress-author)
 * - `see @smith2024` (prefix)
 * - `@smith2024, p. 42` (locator + label)
 * - `see @smith2024, p. 42` (prefix + locator)
 * - `also @doe2023, ch. 3` (prefix + locator chapter)
 * - `@smith2024, some notes` (suffix)
 */
export function parseCitationItem(chunk: string): CitationItemInput | null {
  const atIdx = chunk.indexOf("@");
  if (atIdx === -1) return null;

  // Check suppress author: -@
  const hasHyphen = atIdx > 0 && chunk[atIdx - 1] === "-";
  const prefixEnd = hasHyphen ? atIdx - 1 : atIdx;

  const rawPrefix = chunk.slice(0, prefixEnd);
  let prefix: string | undefined;
  if (rawPrefix.trim().length > 0) {
    // Trim leading whitespace that comes from semicolon separator,
    // but preserve meaningful prose and trailing whitespace before @
    prefix = rawPrefix.replace(/^\s+/, "");
  }

  const parsedKey = extractPandocCitekey(chunk, atIdx);
  if (!parsedKey) {
    return null;
  }

  const rawKey = parsedKey.key;
  const tail = chunk.slice(parsedKey.keyEnd);
  let locator: string | undefined;
  let label: string | undefined;
  let suffix: string | undefined;

  if (tail && tail.trim().length > 0) {
    // Explicit locator mappings:
    // p. / pp. -> page
    // ch. / chap. -> chapter
    // sec. -> section
    const locatorMatch = tail.match(
      /^[,\s]*\s*(p\.|pp\.|ch\.|chap\.|sec\.)\s+([0-9]+(?:[-–][0-9]+)?|[ivxlcdmIVXLCDM]+)(.*)$/s
    );
    if (locatorMatch) {
      const rawLabel = locatorMatch[1].toLowerCase();
      if (rawLabel === "p." || rawLabel === "pp.") {
        label = "page";
      } else if (rawLabel === "ch." || rawLabel === "chap.") {
        label = "chapter";
      } else if (rawLabel === "sec.") {
        label = "section";
      }
      locator = locatorMatch[2];
      const rest = locatorMatch[3];
      if (rest && rest.trim().length > 0) {
        suffix = rest;
      }
    } else {
      // Bare number locator (e.g. , 42)
      const bareMatch = tail.match(/^[,\s]*\s*([0-9]+(?:[-–][0-9]+)?)(.*)$/s);
      if (bareMatch && bareMatch[1]) {
        label = "page";
        locator = bareMatch[1];
        const rest = bareMatch[2];
        if (rest && rest.trim().length > 0) {
          suffix = rest;
        }
      } else {
        // Cannot safely be interpreted as a locator, preserve as suffix
        suffix = tail;
      }
    }
  }

  let mode: CitationItemMode | undefined;
  if (hasHyphen) {
    mode = "suppress-author";
  }

  return {
    id: rawKey,
    ...(prefix !== undefined ? { prefix } : {}),
    ...(suffix !== undefined ? { suffix } : {}),
    ...(locator !== undefined ? { locator } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(mode !== undefined ? { mode } : {}),
  };
}

/**
 * Parses a Markdown document and returns structured Pandoc citation occurrences
 * and CSL CitationClusterInput items in exact document order.
 */
export function parsePandocCitationDocument(
  markdown: string
): ParsedPandocCitationDocument {
  const occurrences: ParsedPandocCitationOccurrence[] = [];
  if (!markdown) {
    return { occurrences, clusters: [] };
  }

  const masked = maskProtectedContexts(markdown);
  let pos = 0;

  while (pos < masked.length) {
    if (masked[pos] === "[") {
      // Skip markdown images: ![alt](url)
      if (pos > 0 && masked[pos - 1] === "!") {
        pos++;
        continue;
      }

      // Find matching closing bracket with balanced depth
      let closeIdx = pos + 1;
      let depth = 1;
      while (closeIdx < masked.length) {
        if (masked[closeIdx] === "[") {
          depth++;
        } else if (masked[closeIdx] === "]") {
          depth--;
          if (depth === 0) break;
        }
        closeIdx++;
      }

      if (closeIdx >= masked.length) {
        pos++;
        continue;
      }

      // Markdown inline links [text](destination) or reference links [text][ref]:
      // The outer brackets belong to the markdown link, not to a citation cluster.
      // Do not treat [text] as a citation cluster; advance pos into the link text
      // so citations located in the link text (e.g. [see @doe99](url)) are parsed normally.
      let afterClose = closeIdx + 1;
      while (
        afterClose < masked.length &&
        (masked[afterClose] === " " || masked[afterClose] === "\t")
      ) {
        afterClose++;
      }

      if (
        afterClose < masked.length &&
        (masked[afterClose] === "(" || masked[afterClose] === "[")
      ) {
        pos++;
        continue;
      }

      const groupContent = markdown.slice(pos + 1, closeIdx);
      // Skip footnote labels like [^1]
      if (groupContent.startsWith("^")) {
        pos = closeIdx + 1;
        continue;
      }

      // Split into semicolon-separated citation chunks
      const chunks = groupContent.split(";");
      const nonBlankChunks = chunks.filter((c) => c.trim().length > 0);

      if (nonBlankChunks.length > 0) {
        const items: CitationItemInput[] = [];
        let allValid = true;

        for (const chunk of nonBlankChunks) {
          const item = parseCitationItem(chunk);
          if (!item) {
            allValid = false;
            break;
          }
          items.push(item);
        }

        if (allValid && items.length > 0) {
          const from = pos;
          const to = closeIdx + 1;
          const raw = markdown.slice(from, to);
          const clusterId = `citation:${from}:${to}`;
          const cluster: CitationClusterInput = {
            id: clusterId,
            items,
          };
          occurrences.push({
            clusterId,
            from,
            to,
            raw,
            cluster,
          });
          pos = to;
          continue;
        }
      }

      pos++;
      continue;
    }

    if (masked[pos] === "@") {
      // Narrative citation: @citekey or @{citekey}
      const prevChar = pos > 0 ? markdown[pos - 1] : undefined;
      const isWord = prevChar !== undefined && /[\w]/u.test(prevChar);

      if (!isWord) {
        const parsedKey = extractPandocCitekey(markdown, pos);
        if (parsedKey) {
          const from = pos;
          const to = parsedKey.keyEnd;
          const raw = markdown.slice(from, to);
          const clusterId = `citation:${from}:${to}`;
          const cluster: CitationClusterInput = {
            id: clusterId,
            items: [
              {
                id: parsedKey.key,
                mode: "composite",
              },
            ],
          };
          occurrences.push({
            clusterId,
            from,
            to,
            raw,
            cluster,
          });
          pos = to;
          continue;
        }
      }

      pos++;
      continue;
    }

    pos++;
  }

  return {
    occurrences,
    clusters: occurrences.map((o) => o.cluster),
  };
}
