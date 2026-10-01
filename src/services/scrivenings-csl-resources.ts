/**
 * Scrivenings CSL Resource Resolution Service.
 *
 * Resolves citation resources (.bib and .csl) for a composite Scrivenings document.
 * Only resolves resources for segments that contain at least one structured citation.
 *
 * Invariants:
 * - Reuses resolveWorkspaceCitationResources without duplicating resolution logic.
 * - Collects distinct valid bibliographies in order of first citing appearance.
 * - Enforces strict CSL style uniqueness across all citing segments (fail-closed if conflicting).
 * - Fails closed if any citing segment lacks valid bibliography or CSL style.
 * - Non-citing segments never invalidate the document's CSL resolution.
 */

import { normalizePath, type App, type TFile, type TFolder } from "obsidian";
import {
  resolveWorkspaceCitationResources,
  type WorkspaceCitationResourceStatus,
  type WorkspaceCitationResourcesResolution,
} from "./workspace-citations.js";
import type { ScriveningsDocument, ScriveningsSegment } from "./scrivenings-document.js";
import type { ScriveningsCslDocument } from "./scrivenings-csl-document.js";

export type ScriveningsCslResourceResolution =
  | {
      readonly status: "ready";
      readonly styleFile: TFile;
      readonly bibliographyFiles: readonly TFile[];
      readonly segmentResources: ReadonlyMap<string, WorkspaceCitationResourcesResolution>;
    }
  | {
      readonly status: "no-citations";
      readonly reason: string;
      readonly bibliographyFiles: readonly [];
      readonly segmentResources: ReadonlyMap<string, WorkspaceCitationResourcesResolution>;
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      readonly segmentPath: string;
      readonly resourceType: "bibliography" | "csl";
      readonly resourceStatus: WorkspaceCitationResourceStatus;
      readonly segmentResources: ReadonlyMap<string, WorkspaceCitationResourcesResolution>;
    }
  | {
      readonly status: "incompatible-style";
      readonly reason: string;
      readonly conflictingStyles: readonly {
        readonly segmentPath: string;
        readonly stylePath: string;
      }[];
      readonly segmentResources: ReadonlyMap<string, WorkspaceCitationResourcesResolution>;
    };

/**
 * Resolves CSL citation resources for a composite Scrivenings document.
 *
 * Scans all segments that contain at least one structured Pandoc citation,
 * resolves their individual workspace citation configurations, validates availability,
 * enforces single CSL style consistency across the entire document, and aggregates
 * distinct bibliography files in order of first appearance.
 */
export function resolveScriveningsCslResources(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  scriveningsDoc: ScriveningsDocument,
  cslDoc: ScriveningsCslDocument
): ScriveningsCslResourceResolution {
  const segmentResources = new Map<string, WorkspaceCitationResourcesResolution>();

  const citingSegments: ScriveningsSegment[] = [];
  for (let i = 0; i < scriveningsDoc.segments.length; i++) {
    const segment = scriveningsDoc.segments[i];
    const occurrences = cslDoc.segmentOccurrences[i];
    if (occurrences && occurrences.length > 0) {
      citingSegments.push(segment);
    }
  }

  if (citingSegments.length === 0) {
    return {
      status: "no-citations",
      reason: "Document contains no structured citation occurrences.",
      bibliographyFiles: [],
      segmentResources,
    };
  }

  for (const segment of citingSegments) {
    if (!segmentResources.has(segment.path)) {
      const res = resolveWorkspaceCitationResources(
        app,
        settings,
        projectRoot,
        segment.file
      );
      segmentResources.set(segment.path, res);
    }
  }

  for (const segment of citingSegments) {
    const res = segmentResources.get(segment.path);
    if (!res) continue;

    if (res.bibliography.status !== "valid" || res.bibliography.file === null) {
      return {
        status: "unavailable",
        reason: `Bibliography resource unavailable for segment '${segment.path}' (status: ${res.bibliography.status}).`,
        segmentPath: segment.path,
        resourceType: "bibliography",
        resourceStatus: res.bibliography.status,
        segmentResources,
      };
    }

    if (res.csl.status !== "valid" || res.csl.file === null) {
      return {
        status: "unavailable",
        reason: `CSL style resource unavailable for segment '${segment.path}' (status: ${res.csl.status}).`,
        segmentPath: segment.path,
        resourceType: "csl",
        resourceStatus: res.csl.status,
        segmentResources,
      };
    }
  }

  const seenStylePaths = new Set<string>();
  const styles: { segmentPath: string; stylePath: string; file: TFile }[] = [];

  for (const segment of citingSegments) {
    const res = segmentResources.get(segment.path);
    if (!res || !res.csl.file) continue;

    const normPath = normalizePath(res.csl.file.path);
    if (!seenStylePaths.has(normPath)) {
      seenStylePaths.add(normPath);
      styles.push({
        segmentPath: segment.path,
        stylePath: normPath,
        file: res.csl.file,
      });
    }
  }

  if (styles.length > 1) {
    return {
      status: "incompatible-style",
      reason: `Conflicting CSL styles across citing segments: ${styles
        .map((s) => `${s.segmentPath} -> ${s.stylePath}`)
        .join(", ")}.`,
      conflictingStyles: styles.map((s) => ({
        segmentPath: s.segmentPath,
        stylePath: s.stylePath,
      })),
      segmentResources,
    };
  }

  const effectiveStyleFile = styles[0].file;

  const seenBibPaths = new Set<string>();
  const bibliographyFiles: TFile[] = [];

  for (const segment of citingSegments) {
    const res = segmentResources.get(segment.path);
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
    segmentResources,
  };
}
