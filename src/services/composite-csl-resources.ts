/**
 * Composite CSL Resource Resolution Service.
 *
 * Resolves citation resources (.bib and .csl) for a composite collection of sources
 * (Scrivenings segments, preview sources, or compiled export segments).
 * Only resolves resources for sources that contain at least one structured citation.
 *
 * Invariants:
 * - Reuses resolveWorkspaceCitationResources without duplicating resolution logic.
 * - Collects distinct valid bibliographies in order of first citing appearance.
 * - Enforces strict CSL style uniqueness across all citing sources (fail-closed if conflicting).
 * - Fails closed if any citing source lacks valid bibliography or CSL style.
 * - Non-citing sources never invalidate the document's CSL resolution.
 */

import { normalizePath, type App, type TFile, type TFolder } from "obsidian";
import {
  resolveWorkspaceCitationResources,
  type WorkspaceCitationResourceStatus,
  type WorkspaceCitationResourcesResolution,
} from "./workspace-citations.js";

export type CompositeCslSource = {
  readonly file: TFile | null;
  readonly citing: boolean;
  readonly path: string;
};

export type CompositeCslResourceResolution =
  | {
      readonly status: "ready";
      readonly styleFile: TFile;
      readonly bibliographyFiles: readonly TFile[];
      readonly sourceResources: ReadonlyMap<string, WorkspaceCitationResourcesResolution>;
    }
  | {
      readonly status: "no-citations";
      readonly reason: string;
      readonly bibliographyFiles: readonly [];
      readonly sourceResources: ReadonlyMap<string, WorkspaceCitationResourcesResolution>;
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      readonly sourcePath: string;
      readonly resourceType: "bibliography" | "csl";
      readonly resourceStatus: WorkspaceCitationResourceStatus;
      readonly sourceResources: ReadonlyMap<string, WorkspaceCitationResourcesResolution>;
    }
  | {
      readonly status: "incompatible-style";
      readonly reason: string;
      readonly conflictingStyles: readonly {
        readonly sourcePath: string;
        readonly stylePath: string;
      }[];
      readonly sourceResources: ReadonlyMap<string, WorkspaceCitationResourcesResolution>;
    };

/**
 * Resolves CSL citation resources for a list of logical citation sources.
 *
 * Scans all sources marked as citing, resolves their individual workspace citation configurations,
 * validates availability, enforces single CSL style consistency across the entire document,
 * and aggregates distinct bibliography files in order of first appearance.
 */
export function resolveCompositeCslResources(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  sources: readonly CompositeCslSource[]
): CompositeCslResourceResolution {
  const sourceResources = new Map<string, WorkspaceCitationResourcesResolution>();

  const citingSources: CompositeCslSource[] = [];
  for (const source of sources) {
    if (source.citing) {
      citingSources.push(source);
    }
  }

  if (citingSources.length === 0) {
    return {
      status: "no-citations",
      reason: "Document contains no structured citation occurrences.",
      bibliographyFiles: [],
      sourceResources,
    };
  }

  for (const source of citingSources) {
    if (!source.file) {
      return {
        status: "unavailable",
        reason: `Source file unavailable for citing source '${source.path}'.`,
        sourcePath: source.path,
        resourceType: "bibliography",
        resourceStatus: "missing_file",
        sourceResources,
      };
    }

    if (!sourceResources.has(source.path)) {
      const res = resolveWorkspaceCitationResources(
        app,
        settings,
        projectRoot,
        source.file
      );
      sourceResources.set(source.path, res);
    }
  }

  for (const source of citingSources) {
    const res = sourceResources.get(source.path);
    if (!res) continue;

    if (res.bibliography.status !== "valid" || res.bibliography.file === null) {
      return {
        status: "unavailable",
        reason: `Bibliography resource unavailable for source '${source.path}' (status: ${res.bibliography.status}).`,
        sourcePath: source.path,
        resourceType: "bibliography",
        resourceStatus: res.bibliography.status,
        sourceResources,
      };
    }

    if (res.csl.status !== "valid" || res.csl.file === null) {
      return {
        status: "unavailable",
        reason: `CSL style resource unavailable for source '${source.path}' (status: ${res.csl.status}).`,
        sourcePath: source.path,
        resourceType: "csl",
        resourceStatus: res.csl.status,
        sourceResources,
      };
    }
  }

  const seenStylePaths = new Set<string>();
  const styles: { sourcePath: string; stylePath: string; file: TFile }[] = [];

  for (const source of citingSources) {
    const res = sourceResources.get(source.path);
    if (!res || !res.csl.file) continue;

    const normPath = normalizePath(res.csl.file.path);
    if (!seenStylePaths.has(normPath)) {
      seenStylePaths.add(normPath);
      styles.push({
        sourcePath: source.path,
        stylePath: normPath,
        file: res.csl.file,
      });
    }
  }

  if (styles.length > 1) {
    return {
      status: "incompatible-style",
      reason: `Conflicting CSL styles across citing sources: ${styles
        .map((s) => `${s.sourcePath} -> ${s.stylePath}`)
        .join(", ")}.`,
      conflictingStyles: styles.map((s) => ({
        sourcePath: s.sourcePath,
        stylePath: s.stylePath,
      })),
      sourceResources,
    };
  }

  const effectiveStyleFile = styles[0].file;

  const seenBibPaths = new Set<string>();
  const bibliographyFiles: TFile[] = [];

  for (const source of citingSources) {
    const res = sourceResources.get(source.path);
    if (!res || !res.bibliography.file) continue;

    const normPath = normalizePath(res.bibliography.file.path);
    if (!seenBibPaths.has(normPath)) {
      seenBibPaths.add(normPath);
      bibliographyFiles.push(res.bibliography.file);
    }
  }

  return {
    status: "ready",
    styleFile: effectiveStyleFile,
    bibliographyFiles,
    sourceResources,
  };
}
