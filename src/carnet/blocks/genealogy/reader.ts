import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import type { GenealogyDiagnostic } from "./diagnostics.js";
import { normalizeGenealogy, type GenealogyNormalizationResult } from "./normalizer.js";
import type { GenealogyPersonId, GenealogyPersonInput } from "./types.js";

type RelationField = "parents" | "spouse" | "spouses" | "children";

function compareGenealogyIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function collectMarkdownFiles(folder: TFolder, files: TFile[]): void {
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      collectMarkdownFiles(child, files);
    } else if (child instanceof TFile && child.extension.toLowerCase() === "md") {
      files.push(child);
    }
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function relationValues(
  frontmatter: Record<string, unknown>,
  field: RelationField,
  personId: GenealogyPersonId,
  diagnostics: GenealogyDiagnostic[],
): string[] {
  const value = frontmatter[field];
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every(isString)) return value;
  diagnostics.push({ severity: "warning", code: "invalid-genealogy-field", personId, field });
  return [];
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function linkpathFromWikilink(value: string): string | null {
  if (!value.startsWith("[[") || !value.endsWith("]]")) return null;
  const inner = value.slice(2, -2).split("|")[0].split("#")[0];
  return inner.length > 0 ? inner : null;
}

function resolveRelations(
  app: App,
  file: TFile,
  values: readonly string[],
  field: RelationField,
  scopePaths: ReadonlySet<string>,
  diagnostics: GenealogyDiagnostic[],
): GenealogyPersonId[] {
  const resolved: GenealogyPersonId[] = [];
  for (const value of uniqueValues(values)) {
    const linkpath = linkpathFromWikilink(value);
    const target = linkpath === null
      ? null
      : app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
    if (!(target instanceof TFile) || target.extension.toLowerCase() !== "md" || !scopePaths.has(target.path)) {
      diagnostics.push({
        severity: "warning",
        code: "unresolved-genealogy-link",
        personId: file.path,
        relatedPersonId: value,
        field,
      });
      continue;
    }
    resolved.push(target.path);
  }
  return uniqueValues(resolved);
}

function displayName(frontmatter: Record<string, unknown>, basename: string): string {
  const firstName = isString(frontmatter.first_name) ? frontmatter.first_name : undefined;
  const lastName = isString(frontmatter.last_name) ? frontmatter.last_name : undefined;
  return [firstName, lastName]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" ") || basename;
}

function optionalString(frontmatter: Record<string, unknown>, field: string): string | undefined {
  const value = frontmatter[field];
  return isString(value) ? value : undefined;
}

function compareDiagnostics(a: GenealogyDiagnostic, b: GenealogyDiagnostic): number {
  return compareGenealogyIds(a.code, b.code)
    || compareGenealogyIds(a.personId ?? "", b.personId ?? "")
    || compareGenealogyIds(a.relatedPersonId ?? "", b.relatedPersonId ?? "")
    || compareGenealogyIds(a.field ?? "", b.field ?? "");
}

export function readGenealogyFolder(app: App, folderPath: string): GenealogyNormalizationResult {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return normalizeGenealogy([]);

  const files: TFile[] = [];
  collectMarkdownFiles(folder, files);
  files.sort((a, b) => compareGenealogyIds(a.path, b.path));
  const scopePaths = new Set(files.map((file) => file.path));
  const readerDiagnostics: GenealogyDiagnostic[] = [];
  const inputs: GenealogyPersonInput[] = [];

  for (const file of files) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const parents = relationValues(frontmatter, "parents", file.path, readerDiagnostics);
    const spouse = relationValues(frontmatter, "spouse", file.path, readerDiagnostics);
    const spouses = relationValues(frontmatter, "spouses", file.path, readerDiagnostics);
    const children = relationValues(frontmatter, "children", file.path, readerDiagnostics);
    const parentIds = resolveRelations(app, file, parents, "parents", scopePaths, readerDiagnostics);
    const spouseValues = uniqueValues([...spouse, ...spouses]);
    const spouseIds = resolveRelations(app, file, spouseValues, "spouses", scopePaths, readerDiagnostics);
    const legacyChildIds = resolveRelations(app, file, children, "children", scopePaths, readerDiagnostics);
    const firstName = optionalString(frontmatter, "first_name");
    const lastName = optionalString(frontmatter, "last_name");
    const birth = optionalString(frontmatter, "birth");
    const death = optionalString(frontmatter, "death");
    inputs.push({
      id: file.path,
      filePath: file.path,
      displayName: displayName(frontmatter, file.basename),
      ...(firstName === undefined ? {} : { firstName }),
      ...(lastName === undefined ? {} : { lastName }),
      ...(birth === undefined ? {} : { birth }),
      ...(death === undefined ? {} : { death }),
      parentIds,
      spouseIds,
      legacyChildIds,
    });
  }

  const normalized = normalizeGenealogy(inputs);
  const diagnostics = [...readerDiagnostics, ...normalized.diagnostics].sort(compareDiagnostics);
  return { graph: normalized.graph, diagnostics };
}
