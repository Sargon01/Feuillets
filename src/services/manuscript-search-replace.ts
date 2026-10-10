/** Shared search rules and replacement planning for Markdown documents. */
import { parser } from "@lezer/markdown";

// Obsidian footnote definitions contain Markdown, whereas CommonMark treats
// a single-word definition as a link destination. Keep continuation offsets
// intact and let the existing parser handle emphasis and code inside notes.
const searchMarkdownParser = parser.configure({
  defineNodes: [{
    name: "SearchFootnote", block: true,
    composite(_context, line, indent) {
      if (line.pos === line.text.length) return true;
      if (line.indent < indent) return false;
      line.moveBaseColumn(indent);
      return true;
    },
  }],
  parseBlock: [{
    name: "SearchFootnote", before: "LinkReference",
    parse(context, line) {
      const marker = /^\[\^[^\]]+\]:[ \t]?/.exec(line.text.slice(line.pos));
      if (!marker) return false;
      context.startComposite("SearchFootnote", line.pos, line.indent + 4);
      line.moveBase(line.pos + marker[0].length);
      return null;
    },
    endLeaf(_context, line) {
      return /^\[\^[^\]]+\]:/.test(line.text.slice(line.pos));
    },
  }],
});

export type SearchReplaceOptions = {
  scope?: string;
  caseSensitive?: boolean;
  preserveCase?: boolean;
  ignoreDiacritics?: boolean;
  matchMode?: string;
  useRegex?: boolean;
  includeYaml?: boolean;
  protectMarkdown?: boolean;
  replacementQuery?: string;
  targetFile?: SearchReplaceFile;
};

type SearchReplaceFile = {
  path: string;
  parent?: { path: string } | null;
};

type SearchReplaceApp = {
  vault: {
    getMarkdownFiles?: () => SearchReplaceFile[];
    process: (file: SearchReplaceFile, callback: (content: string) => string) => Promise<void>;
  };
};

type SearchReplacePlugin = {
  getManuscriptFiles?: () => SearchReplaceFile[];
  getProjectFolder?: () => SearchReplaceFile | null;
};

/**
 * Sépare le bloc frontmatter (--- ... ---) du corps du document Markdown.
 * @param {string} content - Le contenu complet du fichier
 * @returns {{ frontmatter: string, body: string }}
 */
export function splitFrontmatter(content: unknown): { frontmatter: string; body: string } {
  if (typeof content !== "string") return { frontmatter: "", body: "" };
  const match = content.match(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m);
  if (!match || match.index !== 0) return { frontmatter: "", body: content };
  const frontmatter = match[0];
  const body = content.slice(frontmatter.length);
  return { frontmatter, body };
}

/**
 * Préserve la casse du texte original pour la chaîne de remplacement.
 * Ex: "KEMAL" + "Altan" -> "ALTAN", "Kemal" + "Altan" -> "Altan", "kemal" + "Altan" -> "altan"
 * @param {string} matchText
 * @param {string} replacementText
 * @returns {string}
 */
export function preserveCase(matchText: string, replacementText: string) {
  if (!matchText || !replacementText) return replacementText;

  // TOUT EN MAJUSCULES (ex: "KEMAL")
  if (matchText === matchText.toUpperCase() && matchText !== matchText.toLowerCase()) {
    return replacementText.toUpperCase();
  }

  // Capitalisé / TitleCase (ex: "Kemal")
  if (matchText[0] === matchText[0].toUpperCase() && matchText[0] !== matchText[0].toLowerCase()) {
    const rest = matchText.slice(1);
    if (rest === rest.toLowerCase()) {
      return replacementText.charAt(0).toUpperCase() + replacementText.slice(1).toLowerCase();
    }
  }

  // Tout en minuscules (ex: "kemal")
  if (matchText === matchText.toLowerCase() && matchText !== matchText.toUpperCase()) {
    return replacementText.toLowerCase();
  }

  return replacementText;
}

/** Escape each literal before adding accent alternatives. Keep case in the pattern. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildDiacriticsPattern(text: string): string {
  const groups = ["aàáâãäåāăą", "eèéêëēĕėęě", "iìíîïīĭį", "oòóôõöōŏő", "uùúûüūŭůűų", "cçćĉċč", "nñńņň", "yýÿŷ", "sśŝşš", "zźżž", "rŕŗř", "lĺļľ"];
  const letters = Array.from(text.normalize("NFD").replace(/\p{M}/gu, ""));
  return letters.map((letter) => {
    const lower = letter.toLowerCase();
    const group = groups.find((entry) => entry[0] === lower);
    if (!group) return escapeRegex(letter);
    const alternatives = letter === lower ? group : group.toUpperCase();
    return `[${alternatives}]\\p{M}*`;
  }).join("");
}

export function buildSearchRegExp(searchQuery: string, options: SearchReplaceOptions = {}): RegExp | null {
  if (!searchQuery) return null;
  const flags = `g${options.caseSensitive ? "" : "i"}u`;
  try {
    if (options.useRegex) return new RegExp(searchQuery, flags.replace("u", ""));
    const pattern = options.ignoreDiacritics ? buildDiacriticsPattern(searchQuery) : escapeRegex(searchQuery);
    // JavaScript's \b treats accented letters as non-word characters.
    const word = "[\\p{L}\\p{N}\\p{M}_]";
    const start = options.matchMode === "startsWith" || options.matchMode === "wholeWord" || options.matchMode === "exactWord";
    const end = options.matchMode === "wholeWord" || options.matchMode === "exactWord";
    return new RegExp(`${start ? `(?<!${word})` : ""}${pattern}${end ? `(?!${word})` : ""}`, flags);
  } catch {
    return null;
  }
}

type MarkdownRange = { from: number; to: number };
export type TextSearchMatch = { index: number; match: RegExpMatchArray };
export type TextReplacement = { from: number; to: number; text: string };

/** Recognize wrapping even when the replacement explicitly changes letter case. */
function wrapsQuery(query: string, replacement: string, options: SearchReplaceOptions): boolean {
  if (options.useRegex) return false;
  const regex = buildSearchRegExp(query, { ...options, caseSensitive: false, matchMode: "contains" });
  if (!regex) return false;
  return ["*", "**", "***", "_", "__", "___"].some((mark) => {
    if (!replacement.startsWith(mark) || !replacement.endsWith(mark)) return false;
    const inner = replacement.slice(mark.length, -mark.length);
    regex.lastIndex = 0;
    const match = regex.exec(inner);
    return match?.index === 0 && match[0].length === inner.length;
  });
}

/** Parse whole blocks so nested, escaped and multiline emphasis follows Markdown rules. */
function protectedMarkdownRanges(body: string, includeCode = true): MarkdownRange[] {
  const ranges: MarkdownRange[] = [];
  searchMarkdownParser.parse(body).iterate({
    enter(node) {
      if (["Emphasis", "StrongEmphasis"].includes(node.name)) {
        ranges.push({ from: node.from, to: node.to });
        return false;
      }
      if (["InlineCode", "FencedCode", "CodeBlock"].includes(node.name)) {
        if (includeCode) ranges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  return ranges;
}

function hasAdjacentMarkdownMark(body: string, from: number, to: number): boolean {
  const isMark = (index: number) => {
    if (!"*_`".includes(body[index] ?? " ")) return false;
    let escapes = 0;
    for (let previous = index - 1; previous >= 0 && body[previous] === "\\"; previous--) escapes++;
    return escapes % 2 === 0;
  };
  return isMark(from - 1) || isMark(to);
}

/** Both result display and replacement consume these exact matches. */
export function findSearchMatches(content: string, query: string, options: SearchReplaceOptions = {}): TextSearchMatch[] {
  const regex = buildSearchRegExp(query, options);
  if (!regex) return [];
  const offset = options.includeYaml ? 0 : splitFrontmatter(content).frontmatter.length;
  const body = content.slice(offset);
  const protect = options.protectMarkdown && wrapsQuery(query, options.replacementQuery ?? "", options);
  const ranges = protect ? protectedMarkdownRanges(body) : [];
  const results: TextSearchMatch[] = [];
  let rangeIndex = 0;
  const matches = Array.from(body.matchAll(regex));
  for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
    const match = matches[matchIndex];
    const index = match.index ?? 0;
    while (rangeIndex < ranges.length && ranges[rangeIndex].to <= index) rangeIndex++;
    const range = ranges[rangeIndex];
    if (range && range.from < index + Math.max(1, match[0].length) && range.to > index) continue;
    // Even outside parsed emphasis, merging adjacent delimiter runs can change
    // existing markup. This conservative boundary guard supplements the full parse.
    if (protect && hasAdjacentMarkdownMark(body, index, index + match[0].length)) continue;
    const previousMatch = matches[matchIndex - 1];
    const nextMatch = matches[matchIndex + 1];
    // Adjacent matches would produce a single combined delimiter run.
    if (protect && ((previousMatch && (previousMatch.index ?? 0) + previousMatch[0].length === index)
      || nextMatch?.index === index + match[0].length)) continue;
    results.push({ index: offset + index, match });
  }
  if (!protect || !results.length) return results;

  // Validate the proposed formatting with a second full parse. For example,
  // underscores inside a word cannot create emphasis and would not be idempotent.
  const parts: string[] = [];
  const proposedRanges: MarkdownRange[] = [];
  let previous = 0;
  let delta = 0;
  for (const { index: absoluteIndex, match } of results) {
    const index = absoluteIndex - offset;
    const replacement = options.preserveCase === true
      ? preserveCase(match[0], options.replacementQuery ?? "") : options.replacementQuery ?? "";
    parts.push(body.slice(previous, index), replacement);
    proposedRanges.push({ from: index + delta, to: index + delta + replacement.length });
    delta += replacement.length - match[0].length;
    previous = index + match[0].length;
  }
  parts.push(body.slice(previous));
  const formatted = protectedMarkdownRanges(parts.join(""), false);
  let formattedIndex = 0;
  return results.filter((_, index) => {
    const proposed = proposedRanges[index];
    while (formattedIndex < formatted.length && formatted[formattedIndex].to <= proposed.from) formattedIndex++;
    const range = formatted[formattedIndex];
    return range && range.from === proposed.from && range.to === proposed.to;
  });
}

/** Expand regex replacement tokens in one pass, without interpreting inserted captures. */
function replacementText(match: RegExpMatchArray, text: string, replacement: string): string {
  return replacement.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/g, (token, key: string) => {
    if (key === "$") return "$";
    if (key === "&") return match[0];
    if (key === "`") return text.slice(0, match.index);
    if (key === "'") return text.slice((match.index ?? 0) + match[0].length);
    if (key.startsWith("<")) return match.groups ? match.groups[key.slice(1, -1)] ?? "" : token;
    const capture = Number(key);
    if (capture > 0 && capture < match.length) return match[capture] ?? "";
    const first = Number(key[0]);
    if (key.length === 2 && first > 0 && first < match.length) return (match[first] ?? "") + key[1];
    return token;
  });
}

export function planTextReplacements(content: string, query: string, replacement: string, options: SearchReplaceOptions = {}): TextReplacement[] {
  const matches = findSearchMatches(content, query, { ...options, replacementQuery: replacement });
  const body = options.includeYaml ? content : splitFrontmatter(content).body;
  return matches.flatMap(({ index, match }) => {
    const text = options.useRegex ? replacementText(match, body, replacement)
      : options.preserveCase === true ? preserveCase(match[0], replacement) : replacement;
    return text === match[0] ? [] : [{ from: index, to: index + match[0].length, text }];
  });
}

export function replaceInText(content: string | null | undefined, searchQuery: string, replaceQuery: string, options: SearchReplaceOptions = {}): { newContent: string; count: number } {
  if (typeof content !== "string") return { newContent: content || "", count: 0 };
  const changes = planTextReplacements(content, searchQuery, replaceQuery ?? "", options);
  return { newContent: applyTextReplacements(content, changes), count: changes.length };
}

export function applyTextReplacements(content: string, changes: readonly TextReplacement[]): string {
  const parts: string[] = [];
  let offset = 0;
  for (const change of changes) {
    parts.push(content.slice(offset, change.from), change.text);
    offset = change.to;
  }
  parts.push(content.slice(offset));
  return parts.join("");
}

/**
 * Récupère tous les fichiers Markdown pertinents selon la portée demandée.
 * @param {object} app
 * @param {object} plugin
 * @param {string} scope - "manuscript" | "project"
 * @returns {Array<object>}
 */
export function getSearchReplaceFiles(app: SearchReplaceApp, plugin: SearchReplacePlugin, scope = "manuscript"): SearchReplaceFile[] {
  if (scope === "manuscript") {
    return plugin.getManuscriptFiles ? plugin.getManuscriptFiles() : [];
  }

  const root = plugin.getProjectFolder ? plugin.getProjectFolder() : null;
  if (!root) return [];

  const baseFolder = root.parent || root;
  const result: SearchReplaceFile[] = [];

  const isMdFile = (item: unknown): boolean => {
    if (!item || typeof (item as { path?: string }).path !== "string") return false;
    const ext = (item as { extension?: string }).extension;
    if (typeof ext === "string") return ext === "md";
    return (item as { path: string }).path.endsWith(".md");
  };

  const collect = (folder: unknown) => {
    if (!folder || !Array.isArray((folder as { children?: unknown[] }).children)) return;
    for (const child of (folder as { children: unknown[] }).children) {
      if (child && Array.isArray((child as { children?: unknown[] }).children)) {
        collect(child);
      } else if (isMdFile(child)) {
        result.push(child as SearchReplaceFile);
      }
    }
  };

  collect(baseFolder);
  return result;
}

/**
 * Applique la recherche/remplacement atomique sur les fichiers ciblés.
 * @param {object} app
 * @param {object} plugin
 * @param {string} searchQuery
 * @param {string} replaceQuery
 * @param {{ scope?: string, caseSensitive?: boolean, preserveCase?: boolean, ignoreDiacritics?: boolean, matchMode?: string, useRegex?: boolean, includeYaml?: boolean, targetFile?: object }} options
 * @returns {Promise<{ totalReplacements: number, filesCount: number }>}
 */
export function replaceInManuscriptBody(app: SearchReplaceApp, plugin: SearchReplacePlugin, searchQuery: string, replaceQuery: string, options: SearchReplaceOptions = {}): Promise<{ totalReplacements: number; filesCount: number }> {
  return replaceInManuscriptScope(app, plugin, searchQuery, replaceQuery, options);
}

export async function replaceInManuscriptScope(app: SearchReplaceApp, plugin: SearchReplacePlugin, searchQuery: string, replaceQuery: string, options: SearchReplaceOptions = {}): Promise<{ totalReplacements: number; filesCount: number }> {
  if (!searchQuery || typeof searchQuery !== "string") {
    return { totalReplacements: 0, filesCount: 0 };
  }

  const scope = options.scope || "manuscript";
  const files = options.targetFile
    ? [options.targetFile]
    : getSearchReplaceFiles(app, plugin, scope);

  let totalReplacements = 0;
  let filesCount = 0;

  for (const file of files) {
    if (!file || !file.path || !file.path.endsWith(".md")) continue;

    let fileReplacedCount = 0;

    await app.vault.process(file, (content) => {
      const { newContent, count } = replaceInText(content, searchQuery, replaceQuery, options);
      if (count > 0) {
        fileReplacedCount = count;
        return newContent;
      }
      return content;
    });

    if (fileReplacedCount > 0) {
      totalReplacements += fileReplacedCount;
      filesCount++;
    }
  }

  return { totalReplacements, filesCount };
}
