/**
 * Scrivenings CSL Resource Resolution Service.
 *
 * Resolves citation resources (.bib and .csl) for a composite Scrivenings document.
 * Only resolves resources for segments that contain at least one structured citation.
 *
 * Invariants:
 * - Reuses resolveCompositeCslResources without duplicating resolution logic.
 * - Collects distinct valid bibliographies in order of first citing appearance.
 * - Enforces strict CSL style uniqueness across all citing segments (fail-closed if conflicting).
 * - Fails closed if any citing segment lacks valid bibliography or CSL style.
 * - Non-citing segments never invalidate the document's CSL resolution.
 */

import { type App, type TFile, type TFolder } from "obsidian";
import type {
  WorkspaceCitationResourceStatus,
  WorkspaceCitationResourcesResolution,
} from "./workspace-citations.js";
import type { ScriveningsDocument } from "./scrivenings-document.js";
import type { ScriveningsCslDocument } from "./scrivenings-csl-document.js";
import {
  resolveCompositeCslResources,
  type CompositeCslSource,
} from "./composite-csl-resources.js";

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
 * delegates resolution to resolveCompositeCslResources, and adapts the result
 * to the ScriveningsCslResourceResolution interface.
 */
export function resolveScriveningsCslResources(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  scriveningsDoc: ScriveningsDocument,
  cslDoc: ScriveningsCslDocument
): ScriveningsCslResourceResolution {
  const sources: CompositeCslSource[] = [];
  for (let i = 0; i < scriveningsDoc.segments.length; i++) {
    const segment = scriveningsDoc.segments[i];
    const occurrences = cslDoc.segmentOccurrences[i];
    sources.push({
      file: segment.file,
      citing: !!(occurrences && occurrences.length > 0),
      path: segment.path,
    });
  }

  const res = resolveCompositeCslResources(app, settings, projectRoot, sources);

  if (res.status === "ready") {
    return {
      status: "ready",
      styleFile: res.styleFile,
      bibliographyFiles: res.bibliographyFiles,
      segmentResources: res.sourceResources,
    };
  }

  if (res.status === "no-citations") {
    return {
      status: "no-citations",
      reason: res.reason,
      bibliographyFiles: [],
      segmentResources: res.sourceResources,
    };
  }

  if (res.status === "unavailable") {
    return {
      status: "unavailable",
      reason: res.reason,
      segmentPath: res.sourcePath,
      resourceType: res.resourceType,
      resourceStatus: res.resourceStatus,
      segmentResources: res.sourceResources,
    };
  }

  return {
    status: "incompatible-style",
    reason: res.reason,
    conflictingStyles: res.conflictingStyles.map((s) => ({
      segmentPath: s.sourcePath,
      stylePath: s.stylePath,
    })),
    segmentResources: res.sourceResources,
  };
}
