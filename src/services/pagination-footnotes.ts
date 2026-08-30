/**
 * Footnote association for paginated content.
 *
 * Scans PaginationPage.bodyNodes for footnote references and associates
 * their definitions to the page of their first call, with visible marker text.
 */

import type { PaginationPage } from "./pagination-engine.js";

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
  for (const [id, def] of definitionMap) {
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
