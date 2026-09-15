import JSZip from "jszip";

export type ResolverStatus =
  | "unknown_citekey"
  | "missing_bibliography"
  | "disabled_bibliography"
  | "invalid_bibliography_path"
  | "unbound_research";

export type PandocPackageBibliographyFile = {
  filename: string;
  content: string;
};

export type PandocPackageCslFile = {
  filename: string;
  content: string;
};

export type PandocPackageMediaFile = {
  relativePath: string;
  data: ArrayBuffer | Uint8Array;
};

export type PandocPackageCitationReportItem = {
  key: string;
  occurrenceCount: number;
  sourceMarkdownPath: string;
  resolverStatus: ResolverStatus;
};

export type PandocPackageCitationReport = {
  unknownKeys?: PandocPackageCitationReportItem[];
  warnings?: string[];
};

export type PandocPackageOptions = {
  manuscript: string;
  suppressBibliography?: boolean;
  bibliographies?: PandocPackageBibliographyFile[];
  csl?: PandocPackageCslFile | null;
  media?: PandocPackageMediaFile[];
  citationReport?: PandocPackageCitationReport | null;
};

function hasControlOrNewline(str: string): boolean {
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

/**
 * Validates that an archive entry path is strictly portable and relative.
 * Rejects control characters, newlines, leading slashes, backslashes, colons, empty segments, and relative navigation ('.' / '..').
 */
export function validateArchivePath(path: string): void {
  if (!path || typeof path !== "string") {
    throw new Error("Invalid archive entry path: path is empty.");
  }
  if (hasControlOrNewline(path)) {
    throw new Error(`Invalid archive entry path "${path}": control characters and newlines are prohibited.`);
  }
  if (path.startsWith("/") || path.startsWith("\\")) {
    throw new Error(`Invalid archive entry path "${path}": leading slash is prohibited.`);
  }
  if (path.includes("\\")) {
    throw new Error(`Invalid archive entry path "${path}": backslashes are prohibited.`);
  }
  if (path.includes(":")) {
    throw new Error(`Invalid archive entry path "${path}": colons are prohibited.`);
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`Invalid archive entry path "${path}": contains empty or relative directory segments.`);
    }
  }
}

/**
 * Sanitizes a single filename segment, replacing unsafe filesystem characters with hyphens.
 */
export function sanitizeArchiveSegment(name: string): string {
  let cleaned = "";
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    const ch = name[i] ?? "";
    if ((code >= 0 && code <= 31) || code === 127 || "\\/:*?\"<>|".includes(ch)) {
      cleaned += "-";
    } else {
      cleaned += ch;
    }
  }
  const trimmed = cleaned.trim();
  return trimmed || "unnamed";
}

/**
 * Safely serializes a string value as a YAML scalar.
 * Rejects control characters and newlines.
 * Escapes characters that have special meaning in YAML (e.g. #, :, quotes, whitespace) by producing a valid double-quoted scalar.
 */
export function escapeYamlScalar(value: string): string {
  if (hasControlOrNewline(value)) {
    throw new Error(`Invalid YAML scalar "${value}": control characters and newlines are prohibited.`);
  }
  if (/^[a-zA-Z0-9_\-./]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * Generates the pandoc defaults configuration YAML file content.
 */
export function generatePandocDefaultsYaml(options: {
  bibliographies?: PandocPackageBibliographyFile[];
  csl?: PandocPackageCslFile | null;
  suppressBibliography?: boolean;
}): string {
  const lines: string[] = [
    "from: markdown",
    "to: docx",
    "input-files: [manuscript.md]",
    "output-file: manuscript.docx",
    "citeproc: true",
    "resource-path:",
    "  - .",
    "  - media",
  ];

  if (options.suppressBibliography) {
    lines.push("suppress-bibliography: true");
  }

  if (options.bibliographies && options.bibliographies.length > 0) {
    lines.push("bibliography:");
    for (const bib of options.bibliographies) {
      const relPath = `bibliography/${bib.filename}`;
      lines.push(`  - ${escapeYamlScalar(relPath)}`);
    }
  }

  if (options.csl) {
    const relPath = `styles/${options.csl.filename}`;
    lines.push(`csl: ${escapeYamlScalar(relPath)}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Creates an in-memory Pandoc package archive as a Uint8Array.
 * Pure packaging function: no Obsidian Vault, settings, or filesystem calls.
 */
export async function createPandocPackage(options: PandocPackageOptions): Promise<Uint8Array> {
  const zip = new JSZip();

  // 1. manuscript.md
  validateArchivePath("manuscript.md");
  zip.file("manuscript.md", options.manuscript);

  // 2. pandoc.yaml
  validateArchivePath("pandoc.yaml");
  const yamlContent = generatePandocDefaultsYaml({
    bibliographies: options.bibliographies,
    csl: options.csl,
    suppressBibliography: options.suppressBibliography,
  });
  zip.file("pandoc.yaml", yamlContent);

  // 3. bibliography/<filename>.bib
  if (options.bibliographies) {
    for (const bib of options.bibliographies) {
      const entryPath = `bibliography/${bib.filename}`;
      validateArchivePath(entryPath);
      zip.file(entryPath, bib.content);
    }
  }

  // 4. styles/<filename>.csl
  if (options.csl) {
    const entryPath = `styles/${options.csl.filename}`;
    validateArchivePath(entryPath);
    zip.file(entryPath, options.csl.content);
  }

  // 5. media/<relativePath>
  if (options.media) {
    for (const item of options.media) {
      const entryPath = `media/${item.relativePath}`;
      validateArchivePath(entryPath);
      zip.file(entryPath, item.data);
    }
  }

  // 6. citation-report.json (only when unknown keys or warnings exist)
  const report = options.citationReport;
  const hasUnknownKeys = Boolean(report?.unknownKeys && report.unknownKeys.length > 0);
  const hasWarnings = Boolean(report?.warnings && report.warnings.length > 0);
  if (report && (hasUnknownKeys || hasWarnings)) {
    validateArchivePath("citation-report.json");
    zip.file("citation-report.json", JSON.stringify(report, null, 2) + "\n");
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
