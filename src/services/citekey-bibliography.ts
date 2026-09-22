import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { isValidCitekey, getCachedBibtexCatalog, type BibtexCatalogEntry } from "./bibtex-catalog.js";
import { resolveWorkspaceCitationResources } from "./workspace-citations.js";
import type { BibliographyEntry } from "./bibliography-generator.js";
import { getLocale } from "../i18n/index.js";

/**
 * Extracts Pandoc citekeys from Markdown content within brackets.
 * Supports:
 * - Single citations: [@key]
 * - Suppressed author: [-@key]
 * - Locators: [@key, p. 42]
 * - Grouped citations: [@key1; @key2, ch. 1]
 * - Citations inside footnotes: ^[See [@key]] or [^1]: See [@key]
 *
 * Excludes:
 * - YAML frontmatter
 * - HTML comments
 * - Code blocks (fenced ``` or ~~~)
 * - Inline code (`...`)
 * - HTML <pre> and <code> tags
 * - Markdown links and reference links
 * - Wikilinks [[...]]
 * - Escaped brackets \[...\]
 * - Narrative citations @key without brackets
 */
export function extractPandocCitekeys(markdown: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!markdown) return counts;

  // 1. Strip YAML frontmatter at the beginning of the file
  let clean = markdown.replace(/^---[\r\n]+[\s\S]*?[\r\n]+---(?:\r?\n|$)/, "");

  // 2. Strip HTML comments
  clean = clean.replace(/<!--[\s\S]*?-->/g, "");

  // 3. Strip fenced code blocks (``` or ~~~)
  clean = clean.replace(/^(?:[ ]{0,3})(```+|~~~+)[\s\S]*?\n(?:[ ]{0,3})\1[ \t]*$/gm, "");

  // 4. Strip HTML <pre> and <code> tags
  clean = clean.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, "");
  clean = clean.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, "");

  // 5. Strip inline code (`...`)
  clean = clean.replace(/`+[^`\n]+`+/g, "");

  // 6. Strip wikilinks [[...]]
  clean = clean.replace(/\[\[[\s\S]*?\]\]/g, "");

  // 7. Strip markdown links and reference links: ![...](...), [...](...), [...][...]
  clean = clean.replace(/!?\[(?:[^[\]]|\[[^[\]]*\])*\]\([^)]*\)/g, "");
  clean = clean.replace(/!?\[(?:[^[\]]|\[[^[\]]*\])*\]\[[^\]]*\]/g, "");

  // 8. Strip escaped brackets: \[ ... \]
  clean = clean.replace(/\\\[[\s\S]*?\]/g, "");

  // Scan for bracketed groups
  const bracketGroupRegex = /\[([^\][]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = bracketGroupRegex.exec(clean)) !== null) {
    const groupContent = match[1];
    const citekeyRegex = /(?:^|[\s-])@([-a-zA-Z0-9_:.#$%+/]+)/g;
    let keyMatch: RegExpExecArray | null;

    while ((keyMatch = citekeyRegex.exec(groupContent)) !== null) {
      let rawKey = keyMatch[1];
      rawKey = rawKey.replace(/[.,;:!]+$/, "");
      if (isValidCitekey(rawKey)) {
        counts.set(rawKey, (counts.get(rawKey) || 0) + 1);
      }
    }
  }

  return counts;
}

type CitekeyAnalysisCacheRecord = {
  path: string;
  mtime: number;
  size: number;
  citekeys: Map<string, number>;
};

const citekeyAnalysisCache = new Map<string, CitekeyAnalysisCacheRecord>();

/**
 * Extracts citekeys with mtime and size caching.
 */
export function extractCitekeysCached(file: TFile, content: string): Map<string, number> {
  const mtime = file.stat?.mtime ?? 0;
  const size = file.stat?.size ?? (typeof content === "string" ? content.length : 0);
  const cached = citekeyAnalysisCache.get(file.path);
  if (cached && cached.mtime === mtime && cached.size === size) {
    return new Map(cached.citekeys);
  }

  const citekeys = extractPandocCitekeys(content);
  citekeyAnalysisCache.set(file.path, {
    path: file.path,
    mtime,
    size,
    citekeys: new Map(citekeys),
  });

  return citekeys;
}

export function clearCitekeyAnalysisCache(): void {
  citekeyAnalysisCache.clear();
}

/**
 * Resolves the effective .bib file and defining folder along the file's physical branch.
 */
export function resolveBibliographicScope(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  targetFileOrFolder: TFile | TFolder | null
): { bibFile: TFile | null; definingScope: TFolder | null } {
  const resolution = resolveWorkspaceCitationResources(app, settings, projectRoot, targetFileOrFolder);
  if (resolution.bibliography.status === "valid" && resolution.bibliography.file) {
    return {
      bibFile: resolution.bibliography.file,
      definingScope: resolution.bibliography.sourceScope || projectRoot,
    };
  }
  return { bibFile: null, definingScope: null };
}

/**
 * Finds all Markdown files that share the exact same effective .bib file under the defining scope.
 * Excludes sibling branches (not under definingScope) and sub-branches with their own .bib.
 */
export function findFilesSharingBibliographicScope(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  definingScope: TFolder,
  bibFilePath: string
): TFile[] {
  const matchingFiles: TFile[] = [];

  function walk(folder: TFolder): void {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        const childRes = resolveWorkspaceCitationResources(app, settings, projectRoot, child.parent);
        if (childRes.bibliography.status === "valid" && childRes.bibliography.file?.path === bibFilePath) {
          matchingFiles.push(child);
        }
      } else if (child instanceof TFolder) {
        walk(child);
      }
    }
  }

  walk(definingScope);
  return matchingFiles;
}

export type CitedBibtexItem = {
  key: string;
  citekey: string;
  count: number;
  entry?: BibtexCatalogEntry;
  bibliographyEntry?: BibliographyEntry;
};

export type ScopeBibliographyResult = {
  bibFile: TFile | null;
  knownEntries: CitedBibtexItem[];
  unknownKeys: CitedBibtexItem[];
  allBibliographyEntries: BibliographyEntry[];
};

/**
 * Resolves a bibliography result from an already-known .bib file and a
 * precomputed citekey occurrence count map. Shared tail between
 * collectScopeCitedBibtexEntries (bibliographic-scope corpus) and
 * collectDocumentScopeCitedBibtexEntries (document-scope corpus) — the two
 * differ only in how totalCounts was gathered, never in how it is resolved
 * against the catalog, sorted or split into known/unknown keys.
 */
async function resolveScopeBibliographyResult(
  app: App,
  bibFile: TFile,
  totalCounts: ReadonlyMap<string, number>
): Promise<ScopeBibliographyResult> {
  const catalog = await getCachedBibtexCatalog(app, bibFile);
  const catalogMap = new Map<string, BibtexCatalogEntry>();
  for (const item of catalog) {
    catalogMap.set(item.key, item);
  }

  const knownEntries: CitedBibtexItem[] = [];
  const unknownKeys: CitedBibtexItem[] = [];
  const allBibliographyEntries: BibliographyEntry[] = [];

  for (const [key, count] of totalCounts) {
    const catEntry = catalogMap.get(key);
    if (catEntry) {
      const bibEntry = bibtexEntryToBibliographyEntry(catEntry, bibFile.path);
      knownEntries.push({ key, citekey: key, count, entry: catEntry, bibliographyEntry: bibEntry });
      allBibliographyEntries.push(bibEntry);
    } else {
      unknownKeys.push({ key, citekey: key, count });
    }
  }

  const sortKey = (item: CitedBibtexItem) =>
    (item.entry?.author || item.entry?.title || item.key).toLowerCase();
  knownEntries.sort((a, b) => sortKey(a).localeCompare(sortKey(b), getLocale()));
  unknownKeys.sort((a, b) => a.key.localeCompare(b.key));

  return {
    bibFile,
    knownEntries,
    unknownKeys,
    allBibliographyEntries,
  };
}

/**
 * Collects cited BibTeX entries across all files sharing the bibliographic scope of the target file/folder.
 */
export async function collectScopeCitedBibtexEntries(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  activeFileOrFolder: TFile | TFolder | null
): Promise<ScopeBibliographyResult> {
  const { bibFile, definingScope } = resolveBibliographicScope(app, settings, projectRoot, activeFileOrFolder);
  if (!bibFile || !definingScope) {
    return {
      bibFile: null,
      knownEntries: [],
      unknownKeys: [],
      allBibliographyEntries: [],
    };
  }

  const files = findFilesSharingBibliographicScope(app, settings, projectRoot, definingScope, bibFile.path);
  const totalCounts = new Map<string, number>();

  for (const file of files) {
    const content = typeof app.vault.cachedRead === "function"
      ? await app.vault.cachedRead(file)
      : await app.vault.read(file);
    const fileCounts = extractCitekeysCached(file, content);
    for (const [key, count] of fileCounts) {
      totalCounts.set(key, (totalCounts.get(key) || 0) + count);
    }
  }

  return resolveScopeBibliographyResult(app, bibFile, totalCounts);
}

/**
 * Resolves cited BibTeX entries against the effective .bib file inherited
 * from `bibResolutionScope` (walking ancestors up to `projectRoot`, exactly
 * as resolveBibliographicScope always has — resource discovery is untouched
 * here), but counts occurrences from an already-computed, document-scope
 * citekey map (research-citation-analysis.ts) instead of re-walking the
 * files that share that .bib. This is what keeps "where citekeys are
 * counted" (a document scope) independent from "where the .bib comes from"
 * (a bibliographic-resource scope) at render time.
 */
export async function collectDocumentScopeCitedBibtexEntries(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  bibResolutionScope: TFolder | TFile | null,
  citekeyCounts: ReadonlyMap<string, number>
): Promise<ScopeBibliographyResult> {
  const { bibFile } = resolveBibliographicScope(app, settings, projectRoot, bibResolutionScope);
  if (!bibFile) {
    return {
      bibFile: null,
      knownEntries: [],
      unknownKeys: [],
      allBibliographyEntries: [],
    };
  }

  return resolveScopeBibliographyResult(app, bibFile, citekeyCounts);
}

/**
 * Converts a BibtexCatalogEntry into a BibliographyEntry.
 */
export function bibtexEntryToBibliographyEntry(
  entry: BibtexCatalogEntry,
  bibliographyFilePath?: string
): BibliographyEntry {
  return {
    author: entry.author || entry.editor || (entry.authors.length > 0 ? entry.authors.join(", ") : undefined),
    title: entry.title || undefined,
    publisher: entry.publisher,
    journal: entry.journal,
    booktitle: entry.booktitle,
    date: entry.date || entry.year || undefined,
    volume: entry.volume,
    number: entry.number,
    pages: entry.pages,
    doi: entry.doi,
    url: entry.url,
    citekey: entry.key,
    ...(bibliographyFilePath ? { bibliographyFilePath } : {}),
  };
}
