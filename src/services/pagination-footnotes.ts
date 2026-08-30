/**
 * Footnote association for paginated content.
 *
 * Scans PaginationPage.bodyNodes for footnote references and associates
 * their definitions to the page of their first call, with visible marker text.
 */

import type { PaginationPage } from "./pagination-engine.js";

/**
 * Internal attribute used to mark second+ occurrences of repeated footnote references.
 * Only applied during measurement; never affects final output.
 */
export const PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE = "data-pagination-footnote-repeat";

export type PaginationFootnoteDefinition = {
  id: string;
  html: string;
};

export type PaginationFootnoteCall = {
  id: string;
  pageIndex: number;
  callIndex: number;
  markerText: string;
};

export type PaginationFootnoteObservation = {
  calls: PaginationFootnoteCall[];
  assignedIdsByPage: string[][];
  assignedDefinitionsByPage: PaginationFootnoteDefinition[][];
  assignedCallsByPage: PaginationFootnoteCall[][];
  missingDefinitionIds: string[];
  duplicateDefinitionIds: string[];
  unusedDefinitionIds: string[];
};

/**
 * Extract the footnote ID and marker text from a sup.footnote-ref element.
 */
function extractFootnoteData(supElement: Element): { id: string; markerText: string } | null {
  const link = supElement.querySelector("a[href]");
  if (!link) return null;

  const href = link.getAttribute("href");
  if (!href) return null;

  // Extract fragment after #
  const hashIndex = href.lastIndexOf("#");
  if (hashIndex === -1) return null;

  let fragment = href.substring(hashIndex + 1);

  // Try to decode if percent-encoded
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    // If decoding fails, use raw fragment
  }

  if (!fragment) return null;

  const markerText = link.textContent?.trim() ?? "";

  return { id: fragment, markerText };
}

/**
 * Mark second+ occurrences of footnote references with the repeat attribute.
 * Modifies bodyNodes in place (on clones only).
 *
 * Used during measurement to prevent repeated references from reserving height multiple times.
 * Only the second and later occurrences of the same footnote ID are marked with "true".
 * First occurrences have any stale attribute removed.
 *
 * Idempotent: calling twice on the same nodes produces the same result.
 */
export function markRepeatedPaginationFootnoteReferences(bodyNodes: readonly Element[]): void {
  const seenIds = new Set<string>();

  for (const node of bodyNodes) {
    // Mark the node itself if it is a sup.footnote-ref
    if (node.tagName?.toLowerCase() === "sup" && node.classList?.contains("footnote-ref")) {
      const data = extractFootnoteData(node);
      if (data) {
        if (seenIds.has(data.id)) {
          // Second+ occurrence: mark with "true"
          node.setAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE, "true");
        } else {
          // First occurrence: clean up any stale attribute
          node.removeAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE);
          seenIds.add(data.id);
        }
      }
    }

    // Mark descendants
    const descendants = node.querySelectorAll?.("sup.footnote-ref");
    if (descendants) {
      for (let i = 0; i < descendants.length; i++) {
        const sup = descendants[i];
        const data = extractFootnoteData(sup);
        if (data) {
          if (seenIds.has(data.id)) {
            // Second+ occurrence: mark with "true"
            sup.setAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE, "true");
          } else {
            // First occurrence: clean up any stale attribute
            sup.removeAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE);
            seenIds.add(data.id);
          }
        }
      }
    }
  }
}

/**
 * Clone bodyNodes and remove second+ occurrences of repeated footnote references.
 * Returns new Element[] with cloned structure, but marked sup.footnote-ref removed.
 *
 * Used for measurement only: this prevents measurement from seeing repeated references
 * that don't actually trigger the provider (they're associated to earlier pages).
 *
 * Logic:
 * - If a bodyNode itself is a sup.footnote-ref with repeat="true", skip it entirely
 * - Otherwise, clone it and remove only sup.footnote-ref[data-pagination-footnote-repeat="true"]
 * - Source is never modified; clones are independent
 */
export function cloneBodyNodesWithoutRepeatedPaginationFootnoteReferences(bodyNodes: readonly Element[]): Element[] {
  const cloned: Element[] = [];

  for (const node of bodyNodes) {
    // If the node itself is a marked repeated reference, skip it entirely
    if (
      node.tagName?.toLowerCase() === "sup" &&
      node.classList?.contains("footnote-ref") &&
      node.getAttribute?.(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE) === "true"
    ) {
      continue;
    }

    // Clone the node
    const clone = node.cloneNode(true) as Element;

    // Remove all sup.footnote-ref with repeat="true" from the clone
    const markedRepeats = clone.querySelectorAll?.(`sup.footnote-ref[${PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE}="true"]`);
    if (markedRepeats) {
      for (let i = markedRepeats.length - 1; i >= 0; i--) {
        const elem = markedRepeats[i];
        elem.remove?.();
      }
    }

    cloned.push(clone);
  }

  return cloned;
}

/**
 * Remove the repeat attribute from all marked footnote references.
 * This is called before final HTML serialization to ensure the internal attribute
 * doesn't leak into the exported PDF.
 *
 * Does not remove the sup elements themselves, only the internal marker attribute.
 * Does not modify href, markerText, or any other properties.
 */
export function clearRepeatedPaginationFootnoteReferenceMarks(bodyNodes: readonly Element[]): void {
  for (const node of bodyNodes) {
    // Check if the node itself is a marked sup
    if (
      node.tagName?.toLowerCase() === "sup" &&
      node.classList?.contains("footnote-ref") &&
      node.hasAttribute?.(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE)
    ) {
      node.removeAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE);
    }

    // Check descendants
    const markedDescendants = node.querySelectorAll?.(`sup.footnote-ref[${PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE}]`);
    if (markedDescendants) {
      for (let i = 0; i < markedDescendants.length; i++) {
        markedDescendants[i].removeAttribute(PAGINATION_FOOTNOTE_REPEAT_ATTRIBUTE);
      }
    }
  }
}

/**
 * Scan bodyNodes for sup.footnote-ref elements and extract footnote data.
 */
function scanBodyNodesForFootnoteData(bodyNodes: Element[]): { id: string; markerText: string }[] {
  const footnoteData: { id: string; markerText: string }[] = [];

  for (const node of bodyNodes) {
    // Check if the node itself is a sup.footnote-ref
    if (node.tagName?.toLowerCase() === "sup" && node.classList?.contains("footnote-ref")) {
      const data = extractFootnoteData(node);
      if (data) footnoteData.push(data);
    }

    // Scan descendants
    const descendants = node.querySelectorAll?.("sup.footnote-ref");
    if (descendants) {
      for (let i = 0; i < descendants.length; i++) {
        const sup = descendants[i];
        const data = extractFootnoteData(sup);
        if (data) footnoteData.push(data);
      }
    }
  }

  return footnoteData;
}

/**
 * Main observation function: scan pages for footnote calls and associate
 * definitions to their pages.
 */
export function observePaginationFootnotes(
  pages: PaginationPage[],
  definitions: readonly PaginationFootnoteDefinition[]
): PaginationFootnoteObservation {
  // Build definition registry (first occurrence wins)
  const definitionMap = new Map<string, PaginationFootnoteDefinition>();
  const duplicateIds = new Set<string>();

  for (const def of definitions) {
    if (definitionMap.has(def.id)) {
      duplicateIds.add(def.id);
    } else {
      definitionMap.set(def.id, def);
    }
  }

  // Initialize tracking structures
  const calls: PaginationFootnoteCall[] = [];
  const assignedIdsByPage: string[][] = pages.map(() => []);
  const assignedDefinitionsByPage: PaginationFootnoteDefinition[][] = pages.map(() => []);
  const assignedCallsByPage: PaginationFootnoteCall[][] = pages.map(() => []);
  const assignedDefinitionIds = new Set<string>();
  const missingIds = new Set<string>();

  // Scan pages for calls
  let callIndex = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const footnoteDataList = scanBodyNodesForFootnoteData(page.bodyNodes);

    for (const data of footnoteDataList) {
      const call: PaginationFootnoteCall = { id: data.id, pageIndex, callIndex, markerText: data.markerText };
      calls.push(call);
      callIndex++;

      // Check if definition exists
      const definition = definitionMap.get(data.id);
      if (!definition) {
        missingIds.add(data.id);
        continue;
      }

      // Assign definition to first occurrence only
      if (!assignedDefinitionIds.has(data.id)) {
        assignedIdsByPage[pageIndex].push(data.id);
        assignedDefinitionsByPage[pageIndex].push(definition);
        assignedCallsByPage[pageIndex].push(call);
        assignedDefinitionIds.add(data.id);
      }
    }
  }

  // Find unused definitions
  const unusedIds: string[] = [];
  for (const [id] of definitionMap) {
    if (!assignedDefinitionIds.has(id)) {
      unusedIds.push(id);
    }
  }

  return {
    calls,
    assignedIdsByPage,
    assignedDefinitionsByPage,
    assignedCallsByPage,
    missingDefinitionIds: Array.from(missingIds),
    duplicateDefinitionIds: Array.from(duplicateIds),
    unusedDefinitionIds: unusedIds,
  };
}

/**
 * Populate footnoteNodes on pages based on observed footnote associations.
 * The createNode callback converts a definition and its call to a DOM element.
 */
export function populatePaginationFootnoteNodes(
  pages: PaginationPage[],
  definitions: readonly PaginationFootnoteDefinition[],
  createNode: (definition: PaginationFootnoteDefinition, call: PaginationFootnoteCall) => Element
): PaginationFootnoteObservation {
  const observation = observePaginationFootnotes(pages, definitions);

  // Populate footnoteNodes for each page
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const assignedDefinitions = observation.assignedDefinitionsByPage[pageIndex];
    const assignedCalls = observation.assignedCallsByPage[pageIndex];
    page.footnoteNodes = assignedDefinitions.map((def, idx) => createNode(def, assignedCalls[idx]));
  }

  return observation;
}

/**
 * Transform visual marker text by removing outer brackets for display.
 * Pure function: no side effects.
 *
 * "[1]"   → "1"
 * "[12]"  → "12"
 * "1"     → "1"  (unchanged if no brackets)
 * "[1"    → "[1" (unchanged if incomplete)
 * "[]"    → "[]" (unchanged if empty)
 */
export function paginationFootnoteDisplayMarker(markerText: string): string {
  if (markerText.length >= 3 && markerText[0] === "[" && markerText[markerText.length - 1] === "]") {
    return markerText.slice(1, -1);
  }
  return markerText;
}

/**
 * Normalize footnote reference markers in cloned bodyNodes for display.
 * Transforms "[1]" → "1" in sup.footnote-ref link text only.
 * Does NOT modify href, id, or structure; only textContent.
 * Idempotent: applying twice yields same result.
 */
export function normalizePaginationFootnoteReferenceMarkers(bodyNodes: readonly Element[]): void {
  for (const node of bodyNodes) {
    // Check if node itself is sup.footnote-ref
    if (node.classList && node.classList.contains("footnote-ref") && node.tagName === "SUP") {
      const link = node.querySelector("a[href]");
      if (link && link.textContent) {
        link.textContent = paginationFootnoteDisplayMarker(link.textContent);
      }
    }

    // Scan descendants for sup.footnote-ref
    const descendants = node.querySelectorAll?.("sup.footnote-ref");
    if (descendants) {
      for (let i = 0; i < descendants.length; i++) {
        const sup = descendants[i];
        const link = sup.querySelector("a[href]");
        if (link && link.textContent) {
          link.textContent = paginationFootnoteDisplayMarker(link.textContent);
        }
      }
    }
  }
}
