import type { App, TFile } from "obsidian";

export type BibtexCatalogEntry = {
  key: string;
  type: string;
  title: string;
  authors: string[];
  year: string;
  author?: string;
  editor?: string;
  publisher?: string;
  journal?: string;
  booktitle?: string;
  date?: string;
  volume?: string;
  number?: string;
  pages?: string;
  doi?: string;
  url?: string;
};

export function isValidCitekey(key: string): boolean {
  if (!key) return false;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }
  return !/[\s[\]@,;]/.test(key);
}

function cleanDelimiters(raw: string): string {
  const val = raw.trim();
  if (val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1).trim();
  }
  if (val.startsWith("{") && val.endsWith("}")) {
    return val.slice(1, -1).trim();
  }
  return val;
}


function cleanFieldValue(raw?: string): string | undefined {
  if (!raw) return undefined;
  const unwrapped = cleanDelimiters(raw);
  const cleaned = unwrapped.replace(/[{}]/g, "").trim();
  return cleaned || undefined;
}

function cleanTitle(raw: string): string {
  const unwrapped = cleanDelimiters(raw);
  return unwrapped.replace(/[{}]/g, "").trim();
}

function extractLastName(author: string): string {
  let cleaned = author.trim();

  // Institutional authors in {{...}} or {...}
  if (cleaned.startsWith("{{") && cleaned.endsWith("}}")) {
    return cleaned.slice(2, -2).trim();
  }
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    const inner = cleaned.slice(1, -1).trim();
    if (inner.startsWith("{") && inner.endsWith("}")) {
      return inner.slice(1, -1).trim();
    }
    return inner;
  }

  // Comma separated: "Last, First" -> "Last"
  if (cleaned.includes(",")) {
    return cleaned.split(",")[0].trim();
  }

  // Space separated: "First Middle Last" -> "Last"
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1] || "";
}

function extractAuthors(authorField: string): string[] {
  if (!authorField.trim()) return [];

  const authors: string[] = [];
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
      if (depth > 0) depth--;
      current += ch;
    } else if (depth === 0 && authorField.slice(i, i + 5).toLowerCase() === " and ") {
      const lastNm = extractLastName(current.trim());
      if (lastNm) authors.push(lastNm);
      current = "";
      i += 4;
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    const lastNm = extractLastName(current.trim());
    if (lastNm) authors.push(lastNm);
  }

  return authors;
}

function extractYear(yearOrDate: string): string {
  const match = yearOrDate.match(/\d{4}/);
  return match ? match[0] : "";
}

function isNewEntryStart(source: string, pos: number): boolean {
  if (source[pos] !== "@") return false;
  if (pos > 0 && !/\s/.test(source[pos - 1])) return false;
  const rest = source.slice(pos + 1, pos + 40);
  return /^[a-z0-9_-]+\s*[{|(]/i.test(rest);
}

export function parseBibtexCatalog(source: string): BibtexCatalogEntry[] {
  const entries: BibtexCatalogEntry[] = [];
  const seenKeys = new Set<string>();

  let pos = 0;
  const len = source.length;

  while (pos < len) {
    const atIdx = source.indexOf("@", pos);
    if (atIdx === -1) break;

    pos = atIdx + 1;

    // Read entry type
    const typeStart = pos;
    while (pos < len && /[a-z0-9_-]/i.test(source[pos])) pos++;
    const entryType = source.slice(typeStart, pos).toLowerCase();

    if (!entryType) continue;

    // Handle directives to ignore: @string, @comment, @preamble
    if (entryType === "string" || entryType === "comment" || entryType === "preamble") {
      while (pos < len && source[pos] !== "{" && source[pos] !== "(") pos++;
      if (pos >= len) break;

      const openChar = source[pos];
      const closeChar = openChar === "{" ? "}" : ")";
      pos++;

      let depth = 1;
      while (pos < len && depth > 0) {
        if (source[pos] === openChar) depth++;
        else if (source[pos] === closeChar) depth--;
        pos++;
      }
      continue;
    }

    // Skip whitespace after entry type
    while (pos < len && /\s/.test(source[pos])) pos++;
    if (pos >= len) break;

    const openChar = source[pos];
    if (openChar !== "{" && openChar !== "(") continue;
    const closeChar = openChar === "{" ? "}" : ")";
    pos++; // consume openChar

    // Read citekey
    const keyStart = pos;
    while (pos < len && source[pos] !== "," && source[pos] !== closeChar && !isNewEntryStart(source, pos)) pos++;
    const citekey = source.slice(keyStart, pos).trim();

    // If key has comma after it, consume comma
    if (pos < len && source[pos] === ",") pos++;

    // Parse fields
    const fields = new Map<string, string>();
    let inQuotes = false;
    let braceDepth = 0;

    while (pos < len) {
      while (pos < len && /\s/.test(source[pos])) pos++;
      if (pos >= len || source[pos] === closeChar) break;
      if (isNewEntryStart(source, pos)) break;

      // Read field name
      const fieldStart = pos;
      while (pos < len && /[a-z0-9_-]/i.test(source[pos])) pos++;
      const fieldName = source.slice(fieldStart, pos).toLowerCase();

      if (!fieldName) {
        // If we cannot parse a field name, skip character to make progress
        pos++;
        continue;
      }

      // Skip to =
      while (pos < len && /[\s=]/.test(source[pos])) pos++;

      // Read value
      let value = "";
      inQuotes = false;
      braceDepth = 0;

      while (pos < len) {
        if (isNewEntryStart(source, pos)) {
          break;
        }
        const ch = source[pos];

        if (inQuotes) {
          if (ch === '"') inQuotes = false;
          value += ch;
          pos++;
        } else if (ch === '"') {
          inQuotes = true;
          value += ch;
          pos++;
        } else if (ch === "{") {
          braceDepth++;
          value += ch;
          pos++;
        } else if (ch === "}") {
          if (braceDepth === 0) break; // Reached closing of entry
          braceDepth--;
          value += ch;
          pos++;
        } else if ((ch === "," || ch === closeChar) && braceDepth === 0) {
          break;
        } else {
          value += ch;
          pos++;
        }
      }

      fields.set(fieldName, cleanDelimiters(value));

      if (pos < len && source[pos] === ",") pos++;
    }

    if (pos < len && source[pos] === closeChar) pos++;

    // Validate citekey: reject whitespace, control chars, [, ], @, comma, semicolon
    if (!isValidCitekey(citekey)) {
      continue;
    }

    // Deduplicate: preserve first entry
    if (seenKeys.has(citekey)) {
      continue;
    }
    seenKeys.add(citekey);

    const authors = extractAuthors(fields.get("author") || fields.get("editor") || "");
    const year = extractYear(fields.get("year") || fields.get("date") || "");
    const title = cleanTitle(fields.get("title") || "");
    const author = cleanFieldValue(fields.get("author"));
    const editor = cleanFieldValue(fields.get("editor"));
    const publisher = cleanFieldValue(fields.get("publisher"));
    const journal = cleanFieldValue(fields.get("journal"));
    const booktitle = cleanFieldValue(fields.get("booktitle"));
    const date = cleanFieldValue(fields.get("date") || fields.get("year"));
    const volume = cleanFieldValue(fields.get("volume"));
    const number = cleanFieldValue(fields.get("number"));
    const pages = cleanFieldValue(fields.get("pages"));
    const doi = cleanFieldValue(fields.get("doi"));
    const url = cleanFieldValue(fields.get("url"));

    entries.push({
      key: citekey,
      type: entryType,
      title,
      authors,
      year,
      ...(author ? { author } : {}),
      ...(editor ? { editor } : {}),
      ...(publisher ? { publisher } : {}),
      ...(journal ? { journal } : {}),
      ...(booktitle ? { booktitle } : {}),
      ...(date ? { date } : {}),
      ...(volume ? { volume } : {}),
      ...(number ? { number } : {}),
      ...(pages ? { pages } : {}),
      ...(doi ? { doi } : {}),
      ...(url ? { url } : {}),
    });
  }

  return entries;
}

function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function searchBibtexCatalog(
  entries: readonly BibtexCatalogEntry[],
  query: string,
  limit: number = 50,
): BibtexCatalogEntry[] {
  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return [...entries]
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(0, limit);
  }

  type RankedEntry = {
    entry: BibtexCatalogEntry;
    rank: number;
  };

  const matches: RankedEntry[] = [];

  for (const entry of entries) {
    const normKey = normalizeForSearch(entry.key);
    let rank = 0;

    if (normKey === normalizedQuery) {
      rank = 1;
    } else if (normKey.startsWith(normalizedQuery)) {
      rank = 2;
    } else if (normKey.includes(normalizedQuery)) {
      rank = 3;
    } else if (entry.authors.some((author) => normalizeForSearch(author).includes(normalizedQuery))) {
      rank = 4;
    } else if (normalizeForSearch(entry.title).includes(normalizedQuery)) {
      rank = 5;
    } else if (normalizeForSearch(entry.year).includes(normalizedQuery)) {
      rank = 6;
    }

    if (rank > 0) {
      matches.push({ entry, rank });
    }
  }

  matches.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.entry.key.localeCompare(b.entry.key);
  });

  return matches.slice(0, limit).map((m) => m.entry);
}

type CatalogCacheRecord = {
  path: string;
  mtime: number;
  size: number;
  entries: readonly BibtexCatalogEntry[];
};

const catalogCache = new Map<string, CatalogCacheRecord>();

export async function getCachedBibtexCatalog(
  app: App,
  file: TFile,
): Promise<readonly BibtexCatalogEntry[]> {
  const mtime = file.stat?.mtime ?? 0;
  const size = file.stat?.size ?? 0;
  const cached = catalogCache.get(file.path);
  if (
    cached &&
    cached.mtime === mtime &&
    cached.size === size
  ) {
    return cached.entries;
  }

  const content =
    typeof app.vault.cachedRead === "function"
      ? await app.vault.cachedRead(file)
      : await app.vault.read(file);
  const entries = Object.freeze(parseBibtexCatalog(content));
  catalogCache.set(file.path, {
    path: file.path,
    mtime,
    size,
    entries,
  });

  return entries;
}

export function clearBibtexCatalogCache(): void {
  catalogCache.clear();
}
