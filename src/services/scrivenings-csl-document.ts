/**
 * Scrivenings CSL Document Service.
 *
 * Transforms a composite ScriveningsDocument into an ordered composite
 * citation document containing structured Pandoc citation occurrences
 * with composite offsets and deterministic cluster identifiers.
 *
 * Invariants:
 * - Pure TypeScript: zero Obsidian runtime or DOM dependencies.
 * - Segment-by-segment parsing: never parses composite text across junctions.
 * - Hard syntactic boundary per segment.
 * - Global offsets and deterministic global cluster IDs (`citation:<globalFrom>:<globalTo>`).
 * - Full document citations: no viewport or visibility filtering.
 */

import type { CitationClusterInput } from "../api/citation-contract.js";
import { buildNoteAwarePandocCitationDocument } from "./pandoc-citation-notes.js";
import type { ScriveningsDocument } from "./scrivenings-document.js";

export interface ScriveningsCslOccurrence {
  readonly clusterId: string;
  readonly from: number;
  readonly to: number;
  readonly raw: string;
  readonly cluster: CitationClusterInput;
  readonly segmentPath: string;
  readonly segmentIndex: number;
  readonly localFrom: number;
  readonly localTo: number;
}

export interface ScriveningsCslDocument {
  readonly occurrences: readonly ScriveningsCslOccurrence[];
  readonly clusters: readonly CitationClusterInput[];
  readonly segmentOccurrences: readonly (readonly ScriveningsCslOccurrence[])[];
}

/**
 * Builds an ordered composite citation document from a ScriveningsDocument.
 *
 * Parses each segment body independently to guarantee that structural junctions
 * between segments never allow Markdown or Pandoc syntax leaks across file boundaries.
 * Offsets are rebased into composite document coordinates, and cluster IDs are
 * deterministically generated from global offsets.
 */
export function buildScriveningsCslDocument(
  doc: ScriveningsDocument
): ScriveningsCslDocument {
  const occurrences: ScriveningsCslOccurrence[] = [];
  const segmentOccurrences: ScriveningsCslOccurrence[][] = [];
  const clusters: CitationClusterInput[] = [];
  let cumulativeNoteCount = 0;

  for (let segmentIndex = 0; segmentIndex < doc.segments.length; segmentIndex++) {
    const segment = doc.segments[segmentIndex];
    const segmentList: ScriveningsCslOccurrence[] = [];
    const noteAware = buildNoteAwarePandocCitationDocument(segment.body);
    const parsed = noteAware.document;

    for (const localOccurrence of parsed.occurrences) {
      const globalFrom = segment.from + localOccurrence.from;
      const globalTo = segment.from + localOccurrence.to;

      if (globalFrom < segment.from || globalTo > segment.to) {
        throw new Error(
          `Citation occurrence [${globalFrom}, ${globalTo}] exceeds segment bounds [${segment.from}, ${segment.to}].`
        );
      }

      const clusterId = `citation:${globalFrom}:${globalTo}`;

      const cluster: CitationClusterInput = {
        id: clusterId,
        items: localOccurrence.cluster.items.map((item) => ({ ...item })),
        ...(localOccurrence.cluster.noteIndex !== undefined
          ? { noteIndex: localOccurrence.cluster.noteIndex + cumulativeNoteCount }
          : {}),
      };

      const occurrence: ScriveningsCslOccurrence = {
        clusterId,
        from: globalFrom,
        to: globalTo,
        raw: localOccurrence.raw,
        cluster,
        segmentPath: segment.path,
        segmentIndex,
        localFrom: localOccurrence.from,
        localTo: localOccurrence.to,
      };

      segmentList.push(occurrence);
      occurrences.push(occurrence);
    }

    const byLocalId = new Map(segmentList.map((occurrence) => [
      `citation:${occurrence.localFrom}:${occurrence.localTo}`, occurrence.cluster,
    ]));
    for (const cluster of parsed.clusters) {
      const rebased = byLocalId.get(cluster.id);
      if (rebased) clusters.push(rebased);
    }
    cumulativeNoteCount += noteAware.noteCount;
    segmentOccurrences.push(segmentList);
  }

  for (let i = 0; i < occurrences.length - 1; i++) {
    if (occurrences[i].from > occurrences[i + 1].from) {
      throw new Error(
        `Inconsistent occurrence order at index ${i}: ${occurrences[i].from} > ${occurrences[i + 1].from}.`
      );
    }
  }

  return {
    occurrences,
    clusters,
    segmentOccurrences,
  };
}

/**
 * Returns all composite CSL citation occurrences belonging to a given segment index.
 */
export function getCslOccurrencesForSegment(
  cslDoc: ScriveningsCslDocument,
  segmentIndex: number
): readonly ScriveningsCslOccurrence[] {
  if (segmentIndex < 0 || segmentIndex >= cslDoc.segmentOccurrences.length) {
    return [];
  }
  return cslDoc.segmentOccurrences[segmentIndex];
}

/**
 * Checks whether a given segment contains at least one structured CSL citation occurrence.
 */
export function isSegmentCiting(
  cslDoc: ScriveningsCslDocument,
  segmentIndex: number
): boolean {
  return getCslOccurrencesForSegment(cslDoc, segmentIndex).length > 0;
}
