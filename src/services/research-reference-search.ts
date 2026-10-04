import { type App, TFile, TFolder } from "obsidian";
import { folderPathToWorkspaceScope, resolveDeclaredWorkspaceRoot } from "./folder-workspaces.js";
import { resolveResearchDocumentContext } from "./research-document-context.js";
import { resolveCitationCandidates } from "./citation-candidates.js";
import { resolveBibliographySourceInResearchRoot } from "./bibliography-generator.js";
import { resolveBibliographyMetadataFromFrontmatter } from "./source-bibliography-resolver.js";
import { resolveWorkspaceResearchContext } from "./workspace-research-context.js";
import { resolveWorkspaceCitationResources } from "./workspace-citations.js";
import { getCachedBibtexCatalog, searchBibtexCatalog, type BibtexCatalogEntry } from "./bibtex-catalog.js";
import type { ResearchDocumentContext } from "./research-document-context.js";
import { foldAccents } from "../utils/core.js";
import type { CompileScope } from "./compile-scope.js";

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

/** A remembered sidebar editor is a fallback, not a replacement for the active document. */
export function resolveReferenceTargetFile(app: App, projectRoot: TFolder, editorFile: TFile | null): TFile | null {
  const activeFile = app.workspace?.getActiveFile?.();
  const target = activeFile instanceof TFile ? activeFile : editorFile;
  return target instanceof TFile && target.extension === "md" && target.path.startsWith(`${projectRoot.path}/`)
    ? target : null;
}

export type ReferenceTarget = {
  kind: "markdown" | "continuous";
  target: TFile | TFolder | null;
  key: string;
};

/** The central continuous scope supplies a location, not a reference boundary. */
export function resolveReferenceTarget(
  app: App, projectRoot: TFolder, editorFile: TFile | null, continuousScope: CompileScope | null = null,
): ReferenceTarget {
  if (!continuousScope) {
    const target = resolveReferenceTargetFile(app, projectRoot, editorFile);
    return { kind: "markdown", target, key: `markdown:${target?.path ?? ""}` };
  }
  const scopeRoot = app.vault.getAbstractFileByPath(continuousScope.projectRoot);
  const path = continuousScope.type === "folder" || continuousScope.type === "file"
    ? continuousScope.path : continuousScope.projectRoot;
  const node = app.vault.getAbstractFileByPath(path);
  const withinProject = (location: string) => location === projectRoot.path || location.startsWith(`${projectRoot.path}/`);
  const validNode = continuousScope.type === "file" ? node instanceof TFile && node.extension === "md" : node instanceof TFolder;
  const target = scopeRoot instanceof TFolder && withinProject(scopeRoot.path) && withinProject(path)
    && (path === scopeRoot.path || path.startsWith(`${scopeRoot.path}/`)) && validNode
    && (node instanceof TFile || node instanceof TFolder) ? node : null;
  return { kind: "continuous", target, key: `continuous:${continuousScope.type}:${continuousScope.projectRoot}:${path}` };
}

/** Session isolation can narrow a declared reference context, never widen it. */
export function resolveReferenceContextRoot(
  app: App, settings: FeuilletsSettings, projectRoot: TFolder,
  target: TFile | TFolder, isolation: TFolder | null,
): TFolder {
  const declared = resolveDeclaredWorkspaceRoot(app, settings, projectRoot, target);
  const applicableIsolation = isolation instanceof TFolder
    && folderPathToWorkspaceScope(projectRoot.path, isolation.path)
    && (target.path === isolation.path || target.path.startsWith(`${isolation.path}/`))
    ? isolation : null;
  if (applicableIsolation && (!declared || applicableIsolation.path.startsWith(`${declared.path}/`))) return applicableIsolation;
  return declared ?? applicableIsolation ?? projectRoot;
}

/** References have their own document context; other Research tabs retain their scope. */
export function resolveReferenceDocumentContext(
  app: App, settings: FeuilletsSettings, context: ResearchDocumentContext,
  target: TFile | TFolder | null, isolation: TFolder | null,
): ResearchDocumentContext {
  if (!target || (target.path !== context.projectRoot.path && !target.path.startsWith(`${context.projectRoot.path}/`))) return context;
  const root = resolveReferenceContextRoot(app, settings, context.projectRoot, target, isolation);
  const workspaceRoot = root.path === context.projectRoot.path ? null : root;
  const mode = workspaceRoot ? "workspace" : "project";
  if (root.path === context.scopeRoot.path && context.workspaceRoot?.path === workspaceRoot?.path && context.mode === mode) return context;
  return resolveResearchDocumentContext(app, settings, context.projectRoot, root, "workspace");
}

/** Reads follow the editable file; writes use the shared contextual root. */
export function resolveReferenceCitationContext(
  app: App, settings: FeuilletsSettings, context: ResearchDocumentContext, target: TFile | TFolder | null,
): ReferenceCitationContext {
  const applicable = target instanceof TFolder
    ? target.path === context.scopeRoot.path || target.path.startsWith(`${context.scopeRoot.path}/`)
    : target instanceof TFile && context.files.some((file) => file.path === target.path);
  if (target && applicable && (target.path === context.projectRoot.path || target.path.startsWith(`${context.projectRoot.path}/`))) {
    const scopeRoot = resolveReferenceContextRoot(app, settings, context.projectRoot, target, context.workspaceRoot);
    return { projectRoot: context.projectRoot, scopeRoot, targetScope: target };
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
  target: TFile | TFolder | null,
): TFile | null {
  const targetScope = resolveReferenceCitationContext(app, settings, context, target).targetScope;
  const resource = resolveWorkspaceCitationResources(app, settings, context.projectRoot, targetScope).bibliography;
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
