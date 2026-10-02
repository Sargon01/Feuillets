import { type App, TFile, type TFolder } from "obsidian";
import { folderPathToWorkspaceScope } from "./folder-workspaces.js";
import { resolveCitationCandidates } from "./citation-candidates.js";
import { resolveBibliographySourceInResearchRoot } from "./bibliography-generator.js";
import { resolveBibliographyMetadataFromFrontmatter } from "./source-bibliography-resolver.js";
import { resolveWorkspaceResearchContext } from "./workspace-research-context.js";
import { resolveWorkspaceCitationResources } from "./workspace-citations.js";
import { getCachedBibtexCatalog, searchBibtexCatalog, type BibtexCatalogEntry } from "./bibtex-catalog.js";
import type { ResearchDocumentContext } from "./research-document-context.js";
import { foldAccents } from "../utils/core.js";

export type ReferenceSearchRecord = {
  author: string;
  title: string;
  date: string;
} & (
  | { kind: "source"; file: TFile }
  | { kind: "bibtex"; entry: BibtexCatalogEntry }
);

export const REFERENCE_SEARCH_LIMIT = 30;

export type ReferenceCitationContext = {
  projectRoot: TFolder;
  scopeRoot: TFolder;
  targetScope: TFolder | TFile;
};

/** Resource reads follow the editable file; settings writes stay in its exact folder. */
export function resolveReferenceCitationContext(context: ResearchDocumentContext, targetFile: TFile | null): ReferenceCitationContext {
  if (targetFile?.parent && context.files.some((file) => file.path === targetFile.path)
    && (targetFile.parent.path === context.projectRoot.path || folderPathToWorkspaceScope(context.projectRoot.path, targetFile.parent.path))) {
    return { projectRoot: context.projectRoot, scopeRoot: targetFile.parent, targetScope: targetFile };
  }
  return { projectRoot: context.projectRoot, scopeRoot: context.scopeRoot, targetScope: context.scopeRoot };
}

export function referenceSourceFolders(app: App, settings: FeuilletsSettings, context: ResearchDocumentContext): TFolder[] {
  return resolveWorkspaceResearchContext(app, settings, context.workspaceRoot)
    .flatMap(({ folder }) => {
      const resolved = resolveBibliographySourceInResearchRoot(app, folder);
      return resolved ? [resolved.folder] : [];
    });
}

/** Uses the same Source-folder policy as citation insertion, in the displayed scope. */
export function referenceSourceRecords(
  app: App,
  settings: FeuilletsSettings,
  context: ResearchDocumentContext,
  frontmatterOf: (file: TFile) => Record<string, unknown>,
): ReferenceSearchRecord[] {
  const folders = referenceSourceFolders(app, settings, context);
  return resolveCitationCandidates(folders, frontmatterOf).flatMap((candidate) => {
    if (candidate.kind !== "source-sheet") return [];
    const file = candidate.sourceFile;
    const metadata = resolveBibliographyMetadataFromFrontmatter(frontmatterOf(file));
    return [{ kind: "source" as const, file, author: metadata.author || "", title: metadata.title || file.basename, date: metadata.date || "" }];
  });
}

/** An out-of-scope editor never contributes a bibliography to the panel. */
export function referenceBibliographyFile(
  app: App,
  settings: FeuilletsSettings,
  context: ResearchDocumentContext,
  targetFile: TFile | null,
): TFile | null {
  const target = resolveReferenceCitationContext(context, targetFile).targetScope;
  const resource = resolveWorkspaceCitationResources(app, settings, context.projectRoot, target).bibliography;
  return resource.status === "valid" ? resource.file : null;
}

export async function loadReferenceCatalog(app: App, file: TFile | null): Promise<readonly BibtexCatalogEntry[]> {
  return file ? getCachedBibtexCatalog(app, file) : [];
}

/** Search is bounded before rows are built. The blank view contains only cited references. */
export function searchReferenceRecords(
  sources: readonly ReferenceSearchRecord[],
  catalog: readonly BibtexCatalogEntry[],
  query: string,
): ReferenceSearchRecord[] {
  const normalized = foldAccents(query.trim());
  if (!normalized) return [];
  const sourceMatches = sources.filter((record) => record.kind === "source"
    && foldAccents(`${record.author} ${record.title} ${record.date} ${record.file.basename}`).includes(normalized)
  ).slice(0, REFERENCE_SEARCH_LIMIT);
  const bibtexMatches: ReferenceSearchRecord[] = searchBibtexCatalog(catalog, query, REFERENCE_SEARCH_LIMIT)
    .map((entry) => ({ kind: "bibtex", entry, author: entry.author || entry.authors.join(", "), title: entry.title || entry.key, date: entry.year || entry.date || "" }));
  // Interleave the independently ranked paths so neither origin hides the other.
  const matches: ReferenceSearchRecord[] = [];
  for (let index = 0; matches.length < REFERENCE_SEARCH_LIMIT && index < Math.max(sourceMatches.length, bibtexMatches.length); index++) {
    if (sourceMatches[index]) matches.push(sourceMatches[index]);
    if (bibtexMatches[index] && matches.length < REFERENCE_SEARCH_LIMIT) matches.push(bibtexMatches[index]);
  }
  return matches;
}
