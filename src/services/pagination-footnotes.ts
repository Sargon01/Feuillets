/**
 * Footnote association for paginated content.
 *
 * Scans PaginationPage.bodyNodes for footnote references and associates
 * their definitions to the page of their first call, without modifying
 * the pagination or reserving height.
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
};

export type PaginationFootnoteObservation = {
  calls: PaginationFootnoteCall[];
  assignedIdsByPage: string[][];
  assignedDefinitionsByPage: PaginationFootnoteDefinition[][];
  missingDefinitionIds: string[];
  duplicateDefinitionIds: string[];
  unusedDefinitionIds: string[];
};

/**
 * Extract the footnote ID from a sup.footnote-ref element.
 * Looks for an `href` attribute and extracts the fragment after `#`.
 */
function extractFootnoteId(supElement: Element): string | null {
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

  return fragment || null;
}

/**
 * Scan bodyNodes for sup.footnote-ref elements and extract footnote IDs.
 */
function scanBodyNodesForFootnoteIds(bodyNodes: Element[]): string[] {
  const ids: string[] = [];

  for (const node of bodyNodes) {
    // Check if the node itself is a sup.footnote-ref
    if (node.tagName?.toLowerCase() === "sup" && node.classList?.contains("footnote-ref")) {
      const id = extractFootnoteId(node);
      if (id) ids.push(id);
    }

    // Scan descendants
    const descendants = node.querySelectorAll?.("sup.footnote-ref");
    if (descendants) {
      for (let i = 0; i < descendants.length; i++) {
        const sup = descendants[i];
        const id = extractFootnoteId(sup);
        if (id) ids.push(id);
      }
    }
  }

  return ids;
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
  const assignedDefinitionIds = new Set<string>();
  const missingIds = new Set<string>();

  // Scan pages for calls
  let callIndex = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const footnoteIds = scanBodyNodesForFootnoteIds(page.bodyNodes);

    for (const id of footnoteIds) {
      calls.push({ id, pageIndex, callIndex });
      callIndex++;

      // Check if definition exists
      const definition = definitionMap.get(id);
      if (!definition) {
        missingIds.add(id);
        continue;
      }

      // Assign definition to first occurrence only
      if (!assignedDefinitionIds.has(id)) {
        assignedIdsByPage[pageIndex].push(id);
        assignedDefinitionsByPage[pageIndex].push(definition);
        assignedDefinitionIds.add(id);
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
    missingDefinitionIds: Array.from(missingIds),
    duplicateDefinitionIds: Array.from(duplicateIds),
    unusedDefinitionIds: unusedIds,
  };
}

/**
 * Populate footnoteNodes on pages based on observed footnote associations.
 * The createNode callback converts a definition to a DOM element.
 */
export function populatePaginationFootnoteNodes(
  pages: PaginationPage[],
  definitions: readonly PaginationFootnoteDefinition[],
  createNode: (definition: PaginationFootnoteDefinition) => Element
): PaginationFootnoteObservation {
  const observation = observePaginationFootnotes(pages, definitions);

  // Populate footnoteNodes for each page
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const assignedDefinitions = observation.assignedDefinitionsByPage[pageIndex];
    page.footnoteNodes = assignedDefinitions.map(createNode);
  }

  return observation;
}
