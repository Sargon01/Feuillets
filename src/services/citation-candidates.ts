import { TFile, TFolder, normalizePath, type TAbstractFile } from "obsidian";

export type SourceSheetCitationCandidate = {
  kind: "source-sheet";
  sourceFile: TFile;
  attachmentFiles: readonly TFile[];
};

export type UnlinkedAttachmentCitationCandidate = {
  kind: "unlinked-attachment";
  attachmentFile: TFile;
};

export type AmbiguousAttachmentCitationCandidate = {
  kind: "ambiguous-attachment";
  attachmentFile: TFile;
  sourceFiles: readonly TFile[];
};

export type CitationCandidate =
  | SourceSheetCitationCandidate
  | UnlinkedAttachmentCitationCandidate
  | AmbiguousAttachmentCitationCandidate;

export const CITABLE_ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "epub",
  "html",
  "htm",
  "txt",
]);

/**
 * Returns the base name of a file without its extension.
 * Operates purely on strings without reading file content.
 */
export function getFileBaseName(file: TFile): string {
  if (file.extension && file.name.endsWith(`.${file.extension}`)) {
    return file.name.slice(0, -(file.extension.length + 1));
  }
  return file.basename || file.name;
}

/**
 * Recursively collects markdown files and citable attachment files
 * from the given list of root folders. Never reads file contents.
 */
export function collectCitationFiles(folders: readonly TFolder[]): {
  markdownFiles: TFile[];
  attachmentFiles: TFile[];
} {
  const markdownFiles: TFile[] = [];
  const attachmentFiles: TFile[] = [];
  const seenPaths = new Set<string>();

  const stack: TAbstractFile[] = [...folders];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) continue;

    if (item instanceof TFolder) {
      for (const child of item.children) {
        stack.push(child);
      }
    } else if (item instanceof TFile) {
      if (seenPaths.has(item.path)) continue;
      seenPaths.add(item.path);

      const ext = (item.extension || "").toLowerCase();
      if (ext === "md") {
        markdownFiles.push(item);
      } else if (CITABLE_ATTACHMENT_EXTENSIONS.has(ext)) {
        attachmentFiles.push(item);
      }
    }
  }

  markdownFiles.sort((a, b) => a.path.localeCompare(b.path));
  attachmentFiles.sort((a, b) => a.path.localeCompare(b.path));

  return { markdownFiles, attachmentFiles };
}

/**
 * Parses raw frontmatter attachments value into normalized link strings.
 * Handles strings, arrays of strings, wikilinks, aliases, fragments, and backslashes.
 */
export function parseAttachmentLinks(raw: unknown): string[] {
  if (!raw) return [];
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  const links: string[] = [];

  for (const item of items) {
    if (typeof item !== "string") continue;
    let text = item.trim();
    if (!text) continue;

    if (text.startsWith("[[") && text.endsWith("]]")) {
      text = text.slice(2, -2).trim();
    }
    // Strip alias
    if (text.includes("|")) {
      text = text.split("|")[0].trim();
    }
    // Strip fragment/anchor
    if (text.includes("#")) {
      text = text.split("#")[0].trim();
    }
    // Normalize backslashes
    text = text.replace(/\\/g, "/").trim();
    if (text) {
      links.push(text);
    }
  }

  return links;
}

/**
 * Resolves a link string to a target attachment file.
 * Strictly checks:
 * 1. Exact Vault path
 * 2. Exact path relative to the source sheet's parent folder
 * Strictly prohibits global resolution by simple filename.
 */
export function resolveAttachmentLink(
  linkText: string,
  sourceFile: TFile,
  attachmentFiles: readonly TFile[]
): TFile | null {
  const normalizedLink = normalizePath(linkText);
  const parentFolder = sourceFile.parent?.path || "";
  const relativeTarget = normalizePath(parentFolder ? `${parentFolder}/${linkText}` : linkText);

  for (const att of attachmentFiles) {
    const attPath = normalizePath(att.path);
    if (attPath === normalizedLink || attPath === relativeTarget) {
      return att;
    }
  }

  return null;
}

/**
 * Returns all attachments with the exact same base name located in the exact same
 * folder as the source sheet. Pure function with no fuzzy or prefix matching.
 */
export function getCompatibilityAttachments(
  sourceFile: TFile,
  attachmentFiles: readonly TFile[]
): TFile[] {
  const sourceFolder = sourceFile.parent?.path || "";
  const sourceBase = getFileBaseName(sourceFile);
  const matched: TFile[] = [];

  for (const att of attachmentFiles) {
    const attFolder = att.parent?.path || "";
    if (attFolder !== sourceFolder) continue;

    const attBase = getFileBaseName(att);
    if (attBase === sourceBase) {
      matched.push(att);
    }
  }

  return matched;
}

/**
 * Compatibility fallback: returns the first matching attachment with the same base name
 * in the same folder, or null.
 */
export function getCompatibilityAttachment(
  sourceFile: TFile,
  attachmentFiles: readonly TFile[]
): TFile | null {
  const matched = getCompatibilityAttachments(sourceFile, attachmentFiles);
  return matched.length > 0 ? matched[0] : null;
}

/**
 * Deduplicates an array of TFile items based on file path.
 */
export function deduplicateFiles(files: readonly TFile[]): TFile[] {
  const seen = new Set<string>();
  const result: TFile[] = [];
  for (const f of files) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      result.push(f);
    }
  }
  return result;
}

/**
 * Resolves citation candidates from the provided citation folders.
 * Pure and deterministic function: no file system mutations, no binary reads.
 */
export function resolveCitationCandidates(
  folders: readonly TFolder[],
  getFrontmatter: (file: TFile) => Record<string, unknown>
): CitationCandidate[] {
  const { markdownFiles, attachmentFiles } = collectCitationFiles(folders);

  // Map each attachment path to the source sheets that claim it
  const claimsByAttachment = new Map<string, TFile[]>();
  const explicitClaimsBySheet = new Map<string, TFile[]>();
  const sheetHasExplicitAttachments = new Set<string>();

  for (const sheet of markdownFiles) {
    const fm = getFrontmatter(sheet) || {};
    const hasExplicitAttachmentsKey =
      "attachments" in fm && fm.attachments !== undefined;
    if (hasExplicitAttachmentsKey) {
      sheetHasExplicitAttachments.add(sheet.path);
    }
    const links = parseAttachmentLinks(fm.attachments);
    const claimedAttachments: TFile[] = [];

    if (links.length > 0) {
      for (const link of links) {
        const resolved = resolveAttachmentLink(link, sheet, attachmentFiles);
        if (resolved) {
          claimedAttachments.push(resolved);
          const currentClaims = claimsByAttachment.get(resolved.path) || [];
          if (!currentClaims.some((f) => f.path === sheet.path)) {
            currentClaims.push(sheet);
            claimsByAttachment.set(resolved.path, currentClaims);
          }
        }
      }
    }

    explicitClaimsBySheet.set(sheet.path, claimedAttachments);
  }

  // Compatibility fallback for sheets that do not declare an attachments key
  for (const sheet of markdownFiles) {
    if (sheetHasExplicitAttachments.has(sheet.path)) {
      continue;
    }
    const compatMatches = getCompatibilityAttachments(sheet, attachmentFiles);
    for (const att of compatMatches) {
      // Only link if the attachment has no explicit claims from any sheet
      const existingClaims = claimsByAttachment.get(att.path);
      if (existingClaims && existingClaims.length > 0) {
        continue;
      }
      const currentClaims = claimsByAttachment.get(att.path) || [];
      if (!currentClaims.some((f) => f.path === sheet.path)) {
        currentClaims.push(sheet);
        claimsByAttachment.set(att.path, currentClaims);
      }
      const sheetClaims = explicitClaimsBySheet.get(sheet.path) || [];
      if (!sheetClaims.some((f) => f.path === att.path)) {
        sheetClaims.push(att);
        explicitClaimsBySheet.set(sheet.path, sheetClaims);
      }
    }
  }

  const candidates: CitationCandidate[] = [];

  // 1. Source sheets
  for (const sheet of markdownFiles) {
    const claimed = explicitClaimsBySheet.get(sheet.path) || [];
    // Only include attachments that are uniquely claimed by this sheet
    const unambiguousAttachments = claimed.filter((att) => {
      const claims = claimsByAttachment.get(att.path);
      return claims && claims.length === 1 && claims[0].path === sheet.path;
    });

    candidates.push({
      kind: "source-sheet",
      sourceFile: sheet,
      attachmentFiles: deduplicateFiles(unambiguousAttachments),
    });
  }

  // 2. Attachments (unlinked or ambiguous)
  for (const att of attachmentFiles) {
    const claims = claimsByAttachment.get(att.path) || [];
    if (claims.length === 0) {
      candidates.push({
        kind: "unlinked-attachment",
        attachmentFile: att,
      });
    } else if (claims.length > 1) {
      candidates.push({
        kind: "ambiguous-attachment",
        attachmentFile: att,
        sourceFiles: deduplicateFiles(claims),
      });
    }
  }

  return candidates;
}

export type AttachmentCandidateResolution =
  | { kind: "linked"; sourceFile: TFile }
  | { kind: "ambiguous"; sourceFiles: readonly TFile[] }
  | { kind: "unlinked" };

/**
 * Resolves the candidate status of a specific attachment file from a candidates list.
 * Pure and deterministic helper shared across modal selection and quick-cite.
 */
export function resolveAttachmentCandidate(
  candidates: readonly CitationCandidate[],
  attachmentFile: TFile
): AttachmentCandidateResolution {
  for (const c of candidates) {
    if (c.kind === "ambiguous-attachment" && c.attachmentFile.path === attachmentFile.path) {
      return { kind: "ambiguous", sourceFiles: c.sourceFiles };
    }
    if (c.kind === "source-sheet" && c.attachmentFiles.some((f) => f.path === attachmentFile.path)) {
      return { kind: "linked", sourceFile: c.sourceFile };
    }
    if (c.kind === "unlinked-attachment" && c.attachmentFile.path === attachmentFile.path) {
      return { kind: "unlinked" };
    }
  }
  return { kind: "unlinked" };
}

/**
 * Escapes a string for safe inclusion in double-quoted YAML.
 */
export function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Strips quotes, wikilinks, aliases, anchors, and unescapes YAML escapes
 * to extract the raw target filename/path.
 */
export function cleanAttachmentLinkTarget(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (s.startsWith("[[") && s.endsWith("]]")) {
    s = s.slice(2, -2).trim();
  }
  if (s.includes("|")) {
    s = s.split("|")[0].trim();
  }
  if (s.includes("#")) {
    s = s.split("#")[0].trim();
  }
  return s.trim();
}

/**
 * Splits a raw YAML scalar/array text into its value portion and its trailing
 * comment, respecting single- and double-quoted strings and bracketed arrays
 * so a `#` inside quotes or inside `[ ... ]` is never mistaken for a comment
 * marker. Returns `comment` as null when no trailing comment is present.
 */
export function splitYamlValueAndComment(text: string): { value: string; comment: string | null } {
  let depth = 0;
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === "[") {
      depth++;
      continue;
    }
    if (ch === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === "#" && depth === 0 && (i === 0 || /\s/.test(text[i - 1]))) {
      return { value: text.slice(0, i).trim(), comment: text.slice(i).trim() };
    }
  }

  return { value: text.trim(), comment: null };
}

/**
 * Extracts individual link targets from the text content of an attachments YAML property.
 * Correctly parses block lists (- ...), inline bracketed arrays ([ ... ]),
 * empty arrays ([]), and inline scalars ("..."). Trailing end-of-line comments are
 * stripped from each value before cleaning, whether or not the value is quoted.
 */
export function extractLinksFromAttachmentsBlock(rawAttachmentsText: string): string[] {
  const content = rawAttachmentsText.replace(/^[ \t]*attachments:[ \t]*/m, "").trim();
  if (!content) return [];

  const bracketMatch = content.match(/^\[([\s\S]*)\]/);
  if (bracketMatch) {
    const inner = bracketMatch[1].trim();
    if (!inner) return [];
    const tokenRegex = /(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|\[\[([^\]]+)\]\]|([^,[\]\s]+(?:\s+[^,[\]\s]+)*))/g;
    const links: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(inner)) !== null) {
      const rawToken = match[0].trim();
      if (rawToken && rawToken !== ",") {
        const cleaned = cleanAttachmentLinkTarget(rawToken);
        if (cleaned) links.push(cleaned);
      }
    }
    return links;
  }

  const lines = content.split(/\r?\n/);
  const links: string[] = [];
  let isBlockList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const listMatch = trimmed.match(/^-[ \t]+(.*)$/);
    if (listMatch) {
      isBlockList = true;
      const { value } = splitYamlValueAndComment(listMatch[1].trim());
      const cleaned = cleanAttachmentLinkTarget(value);
      if (cleaned) links.push(cleaned);
    }
  }

  if (!isBlockList && lines.length > 0) {
    const firstLine = lines[0].trim();
    if (!firstLine.startsWith("#")) {
      const { value } = splitYamlValueAndComment(firstLine);
      const cleaned = cleanAttachmentLinkTarget(value);
      if (cleaned) links.push(cleaned);
    }
  }

  return links;
}

type AttachmentsBlockRange = { start: number; end: number };

/**
 * Locates every strictly root-level (non-indented) `attachments:` property in the
 * given lines, in order. Indented `attachments:` properties nested under another
 * key are never matched, since the detection regex requires zero leading whitespace.
 */
function findRootAttachmentsBlocks(lines: string[]): AttachmentsBlockRange[] {
  const blocks: AttachmentsBlockRange[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!/^attachments:[ \t]*/.test(line)) {
      i++;
      continue;
    }
    const start = i;
    const rest = line.replace(/^attachments:[ \t]*/, "").trim();
    let end = -1;
    if (rest.startsWith("[") && rest.includes("]")) {
      end = start;
    } else if (rest && !rest.startsWith("#")) {
      end = start;
    } else {
      let j = start + 1;
      while (j < lines.length) {
        const l = lines[j];
        const isIndented = /^[ \t]+/.test(l);
        const isBlank = l.trim() === "";
        if (isIndented) {
          j++;
          continue;
        }
        if (isBlank) {
          let nextIsIndented = false;
          for (let k = j + 1; k < lines.length; k++) {
            if (lines[k].trim() !== "") {
              nextIsIndented = /^[ \t]+/.test(lines[k]);
              break;
            }
          }
          if (!nextIsIndented) {
            end = j - 1;
            break;
          }
          j++;
          continue;
        }
        end = j - 1;
        break;
      }
      if (end === -1) end = lines.length - 1;
    }
    blocks.push({ start, end });
    i = end + 1;
  }
  return blocks;
}

/**
 * Merges multiple root-level `attachments:` properties into a single one:
 * collects and deduplicates their links, preserves their comments (header trailing
 * comments and standalone comment lines) as leading comment lines, keeps the merged
 * property at the position of the first occurrence, and removes only the
 * surnumerary root keys — every other line (including properties sitting between
 * the duplicated keys, and nested `attachments:` properties) is left untouched.
 */
function mergeRootAttachmentsBlocks(lines: string[], blocks: readonly AttachmentsBlockRange[]): string[] {
  const collectedComments: string[] = [];
  const collectedLinks: string[] = [];
  const seenNorm = new Set<string>();

  for (const block of blocks) {
    const headerLine = lines[block.start];
    const headerRest = headerLine.replace(/^attachments:[ \t]*/, "").trim();
    const { comment: headerComment } = splitYamlValueAndComment(headerRest);
    if (headerComment) collectedComments.push(headerComment);

    for (let i = block.start + 1; i <= block.end; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("#")) {
        collectedComments.push(trimmed);
        continue;
      }
      const listMatch = trimmed.match(/^-[ \t]+(.*)$/);
      if (listMatch) {
        const { comment: itemComment } = splitYamlValueAndComment(listMatch[1].trim());
        if (itemComment) collectedComments.push(itemComment);
      }
    }

    const rawBlock = lines.slice(block.start, block.end + 1).join("\n");
    for (const link of extractLinksFromAttachmentsBlock(rawBlock)) {
      const norm = normalizePath(link);
      if (!seenNorm.has(norm)) {
        seenNorm.add(norm);
        collectedLinks.push(link);
      }
    }
  }

  const mergedBlockLines = [
    ...collectedComments,
    "attachments:",
    ...collectedLinks.map((l) => `  - "[[${escapeYamlString(l)}]]"`),
  ];

  const result: string[] = [];
  let cursor = 0;
  let insertedMerged = false;
  for (const block of blocks) {
    result.push(...lines.slice(cursor, block.start));
    if (!insertedMerged) {
      result.push(...mergedBlockLines);
      insertedMerged = true;
    }
    cursor = block.end + 1;
  }
  result.push(...lines.slice(cursor));
  return result;
}

/**
 * Builds or modifies markdown content with prefilled title and an attachments wikilink.
 * Hardened to preserve existing custom templates:
 * - Only modifies the root `attachments:` property, leaving indented ones strictly intact
 * - Merges multiple root `attachments:` properties into a single one when present
 * - Updates existing generic title or preserves custom title
 * - Preserves other properties, order, and comments (including trailing end-of-line
 *   comments on inline scalars/arrays, hoisted above the property when converted to a
 *   block list)
 * - Handles inline arrays, empty arrays, scalars, and block lists
 * - Prevents duplicate keys, multiple frontmatter delimiters, or nested arrays
 * - Safely escapes special characters in titles and attachment paths
 */
export function buildSourceSheetContent(
  template: string,
  defaultName: string,
  baseName: string,
  attachmentPath: string
): string {
  const escapedTitle = escapeYamlString(baseName);
  const cleanedNew = cleanAttachmentLinkTarget(attachmentPath);

  const fmMatch = template.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!fmMatch) {
    const frontmatter = [
      "---",
      `title: "${escapedTitle}"`,
      "attachments:",
      `  - "[[${escapeYamlString(cleanedNew)}]]"`,
      "---",
      "",
    ].join("\n");
    return template.trim() ? `${frontmatter}${template}` : frontmatter;
  }

  let body = fmMatch[1];

  // Title handling (root-level only)
  const titleLineMatch = body.match(/^title:[ \t]*(.*)$/m);
  if (titleLineMatch) {
    const rawVal = titleLineMatch[1].trim();
    const quotedMatch = rawVal.match(/^"(.*)"$/) || rawVal.match(/^'(.*)'$/);
    const currentVal = quotedMatch ? quotedMatch[1] : rawVal;

    // Replace if current title is default, empty, or generic
    if (!currentVal || currentVal === defaultName || /^(Nouveau|Nouvelle|New)\s+/i.test(currentVal)) {
      body = body.replace(titleLineMatch[0], `title: "${escapedTitle}"`);
    }
  } else {
    // Insert title at top of frontmatter
    body = `title: "${escapedTitle}"\n${body}`;
  }

  // Parse lines to locate strictly ROOT-LEVEL attachments property. When more than
  // one root attachments property exists, merge them into a single one first.
  let lines = body.split("\n");
  const initialRootBlocks = findRootAttachmentsBlocks(lines);
  if (initialRootBlocks.length > 1) {
    lines = mergeRootAttachmentsBlocks(lines, initialRootBlocks);
  }
  const rootBlocks = findRootAttachmentsBlocks(lines);
  const attachmentsStartLine = rootBlocks.length > 0 ? rootBlocks[0].start : -1;
  const attachmentsEndLine = rootBlocks.length > 0 ? rootBlocks[0].end : -1;

  let existingLinks: string[] = [];
  if (attachmentsStartLine !== -1) {
    const rawBlock = lines.slice(attachmentsStartLine, attachmentsEndLine + 1).join("\n");
    existingLinks = extractLinksFromAttachmentsBlock(rawBlock);
  }

  const seenNorm = new Set<string>();
  for (const link of existingLinks) {
    seenNorm.add(normalizePath(link));
  }
  const isAlreadyPresent = Boolean(cleanedNew && seenNorm.has(normalizePath(cleanedNew)));

  if (attachmentsStartLine === -1) {
    // No root attachments property: add a new root property without touching nested properties
    lines.push("attachments:", `  - "[[${escapeYamlString(cleanedNew)}]]"`);
  } else if (!isAlreadyPresent) {
    const headerLine = lines[attachmentsStartLine];
    const headerRest = headerLine.replace(/^attachments:[ \t]*/, "").trim();
    const { value: headerValue, comment: headerComment } = splitYamlValueAndComment(headerRest);
    const headerCommentLines = headerComment ? [headerComment] : [];

    if (headerValue.startsWith("[") && headerValue.includes("]")) {
      // Inline bracketed array
      if (existingLinks.length === 0) {
        lines.splice(
          attachmentsStartLine,
          attachmentsEndLine - attachmentsStartLine + 1,
          ...headerCommentLines,
          "attachments:",
          `  - "[[${escapeYamlString(cleanedNew)}]]"`
        );
      } else {
        const merged = [...existingLinks, cleanedNew];
        const newLines = [
          ...headerCommentLines,
          "attachments:",
          ...merged.map((l) => `  - "[[${escapeYamlString(l)}]]"`),
        ];
        lines.splice(
          attachmentsStartLine,
          attachmentsEndLine - attachmentsStartLine + 1,
          ...newLines
        );
      }
    } else if (headerValue !== "" && !headerValue.startsWith("#")) {
      // Inline scalar
      const merged = [...existingLinks, cleanedNew];
      const newLines = [
        ...headerCommentLines,
        "attachments:",
        ...merged.map((l) => `  - "[[${escapeYamlString(l)}]]"`),
      ];
      lines.splice(
        attachmentsStartLine,
        attachmentsEndLine - attachmentsStartLine + 1,
        ...newLines
      );
    } else {
      // Multiline block list or bare attachments: header
      // Preserve all existing lines, comments, and structure!
      let insertAt = attachmentsEndLine + 1;
      while (insertAt > attachmentsStartLine + 1 && lines[insertAt - 1].trim() === "") {
        insertAt--;
      }
      lines.splice(insertAt, 0, `  - "[[${escapeYamlString(cleanedNew)}]]"`);
    }
  }

  body = lines.join("\n");
  const remainder = template.slice(fmMatch[0].length);
  return `---\n${body.trim()}\n---${remainder}`;
}
