/**
 * Static CSL Citation Rendering Service.
 *
 * Provides native CSL citation rendering for static surfaces:
 * Paginated Preview, native PDF, EPUB, DOCX, and ODT exports.
 *
 * Invariants:
 * - Collects citation occurrences from the final DOM after ContentVariant filtering.
 * - Monotonic synthetic offsets assign stable cluster IDs in DOM order.
 * - Multi-bibliography resolution delegates to resolveCompositeCslResources.
 * - Single citeproc request per static document via CslCitationHost.renderPreparedDocument().
 * - Atomic fail-closed DOM mutation: 0 changes if any citation is missing or invalid.
 * - Ephemeral Host session always disposed in finally.
 * - Pure DOM operations: zero innerHTML, zero outerHTML, zero DOMParser.
 * - Respects textNode.ownerDocument for all created elements and spans.
 */

import { normalizePath, TFile, type App, type TFolder } from "obsidian";
import type { CslCitationHost } from "./csl-citation-host.js";
import type { CitationClusterInput } from "../api/citation-contract.js";
import {
  parsePandocCitationDocument,
  type ParsedPandocCitationDocument,
  type ParsedPandocCitationOccurrence,
} from "./pandoc-citation-parser.js";
import {
  resolveCompositeCslResources,
  type CompositeCslSource,
} from "./composite-csl-resources.js";
import { renderCitationNodes } from "./citation-render-nodes.js";
import { createPandocCitationSpan } from "./pandoc-citation-preview.js";

export const STATIC_RENDER_ATTR = "data-feuillets-static-render";
export const STATIC_RENDER_ATTR_VALUE = "true";

export const CITATION_RENDER_CSS = `
.feuillets-csl-font-normal {
  font-style: normal;
}
.feuillets-csl-font-italic {
  font-style: italic;
}
.feuillets-csl-font-oblique {
  font-style: oblique;
}
.feuillets-csl-weight-normal {
  font-weight: normal;
}
.feuillets-csl-weight-bold {
  font-weight: bold;
}
.feuillets-csl-weight-light {
  font-weight: 300;
}
.feuillets-csl-variant-normal {
  font-variant: normal;
}
.feuillets-csl-variant-small-caps {
  font-variant: small-caps;
}
.feuillets-csl-decoration-none {
  text-decoration: none;
}
.feuillets-csl-decoration-underline {
  text-decoration: underline;
}
.feuillets-csl-valign-baseline {
  vertical-align: baseline;
}
.feuillets-csl-valign-sup {
  vertical-align: super;
  font-size: 0.8em;
  line-height: 0;
}
.feuillets-csl-valign-sub {
  vertical-align: sub;
  font-size: 0.8em;
  line-height: 0;
}
.feuillets-csl-block {
  display: block;
}
.feuillets-csl-left-margin {
  display: inline-block;
  margin-right: 1em;
}
.feuillets-csl-right-inline {
  display: inline;
}
.feuillets-csl-indent {
  display: block;
  padding-left: 2em;
}
.feuillets-csl-link {
  text-decoration: underline;
  cursor: pointer;
}
.feuillets-csl-link-disabled {
  color: inherit;
  text-decoration: none;
  cursor: default;
}
.feuillets-csl-citation {
  display: inline;
}
`;

let staticSessionCounter = 0;

/**
 * Creates a unique ephemeral document ID for a static CSL render session.
 */
export function createStaticDocumentId(prefix: string, scopePath: string): string {
  return `${prefix}:${++staticSessionCounter}:${normalizePath(scopePath)}`;
}

export type StaticCslSource = {
  readonly path: string;
  readonly text?: string;
  readonly renderText?: string;
  readonly file?: TFile | null;
};

export type StaticCslRenderOptions = {
  readonly app: App;
  readonly settings: FeuilletsSettings;
  readonly host: CslCitationHost | null | undefined;
  readonly projectRoot: TFolder;
  readonly container: HTMLElement;
  readonly sources: readonly StaticCslSource[];
  readonly documentId: string;
};

const PROTECTED_TAGS = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "A"]);

function isProtectedElement(element: Element): boolean {
  if (PROTECTED_TAGS.has(element.tagName)) return true;
  if (element.classList && element.classList.contains("feuillets-csl-citation")) return true;
  if (element.classList && element.classList.contains("footnotes")) return true;
  if (element.tagName === "SECTION" && element.classList && element.classList.contains("footnotes")) return true;
  return false;
}

const DOM_TEXT_NODE = 3;
const DOM_ELEMENT_NODE = 1;

function collectEligibleTextNodes(node: Node, out: Text[]): void {
  if (node.nodeType === DOM_TEXT_NODE) {
    const parent = (node as Text).parentElement;
    if (parent && !isProtectedElement(parent)) {
      out.push(node as Text);
    }
    return;
  }
  if (node.nodeType !== DOM_ELEMENT_NODE) return;
  const element = node as Element;
  if (isProtectedElement(element)) return;
  for (let i = 0; i < node.childNodes.length; i++) {
    collectEligibleTextNodes(node.childNodes[i], out);
  }
}

type DomOccurrenceMapping = {
  readonly textNode: Text;
  readonly localFrom: number;
  readonly localTo: number;
  readonly raw: string;
  readonly clusterId: string;
};

type PreparedDomReplacement = {
  readonly textNode: Text;
  readonly items: {
    readonly localFrom: number;
    readonly localTo: number;
    readonly span: HTMLElement;
  }[];
};

/**
 * Applies native CSL citations to a static rendered DOM container.
 *
 * Scans the final container DOM for Pandoc citation patterns, resolves
 * multi-bibliography CSL resources, executes a single citeproc request on the Host,
 * validates the snapshot, and performs an atomic in-memory DOM transformation.
 */
export async function applyNativeCslToStaticRender(
  options: StaticCslRenderOptions
): Promise<boolean> {
  const { app, settings, host, projectRoot, container, sources, documentId } = options;

  if (!host) {
    return false;
  }

  const eligibleTextNodes: Text[] = [];
  collectEligibleTextNodes(container, eligibleTextNodes);
  if (eligibleTextNodes.length === 0) {
    return false;
  }

  const clusters: CitationClusterInput[] = [];
  const globalOccurrences: ParsedPandocCitationOccurrence[] = [];
  const domMappings: DomOccurrenceMapping[] = [];

  let syntheticOffset = 0;
  for (const textNode of eligibleTextNodes) {
    const localText = textNode.nodeValue || "";
    if (!localText) continue;

    const parsed = parsePandocCitationDocument(localText);
    for (const occ of parsed.occurrences) {
      const globalFrom = syntheticOffset + occ.from;
      const globalTo = syntheticOffset + occ.to;
      const clusterId = `citation:${globalFrom}:${globalTo}`;

      const cluster: CitationClusterInput = {
        id: clusterId,
        items: occ.cluster.items,
      };

      clusters.push(cluster);
      globalOccurrences.push({
        ...occ,
        from: globalFrom,
        to: globalTo,
        clusterId,
        cluster,
      });

      domMappings.push({
        textNode,
        localFrom: occ.from,
        localTo: occ.to,
        raw: occ.raw,
        clusterId,
      });
    }

    syntheticOffset += localText.length + 1;
  }

  if (globalOccurrences.length === 0) {
    return false;
  }

  const compositeSources: CompositeCslSource[] = [];
  for (const source of sources) {
    let resolvedFile = source.file ?? null;
    if (!resolvedFile && source.path) {
      const candidate = app.vault.getAbstractFileByPath(normalizePath(source.path));
      if (candidate instanceof TFile && candidate.extension === "md") {
        resolvedFile = candidate;
      }
    }

    let sourceContent = source.renderText ?? source.text ?? "";
    if (!sourceContent && resolvedFile) {
      try {
        sourceContent = await app.vault.cachedRead(resolvedFile);
      } catch {
        // fail-safe: conserve le contenu vide en cas d'erreur de lecture
      }
    }

    const isCiting = sourceContent.length > 0
      ? parsePandocCitationDocument(sourceContent).occurrences.length > 0
      : (sources.length === 1 && globalOccurrences.length > 0);

    if (isCiting && !resolvedFile) {
      return false;
    }

    compositeSources.push({
      file: resolvedFile,
      citing: isCiting,
      path: source.path,
    });
  }

  const resourcesResolution = resolveCompositeCslResources(
    app,
    settings,
    projectRoot,
    compositeSources
  );

  if (resourcesResolution.status !== "ready") {
    return false;
  }

  const preparedDoc: ParsedPandocCitationDocument = {
    clusters,
    occurrences: globalOccurrences,
  };

  try {
    const snapshot = await host.renderPreparedDocument(
      documentId,
      preparedDoc,
      resourcesResolution.styleFile,
      resourcesResolution.bibliographyFiles,
      { includeBibliography: false }
    );

    if (snapshot.status !== "ready") {
      return false;
    }

    if (snapshot.result.diagnostics.some((d) => d.severity === "error")) {
      return false;
    }

    if (snapshot.result.citations.length !== globalOccurrences.length) {
      return false;
    }

    const hasAllClusters = globalOccurrences.every((occ) =>
      snapshot.citationByClusterId.has(occ.clusterId)
    );
    if (!hasAllClusters) {
      return false;
    }

    // Build replacement spans in memory before any DOM mutation
    const occurrencesByNode = new Map<Text, DomOccurrenceMapping[]>();
    for (const mapping of domMappings) {
      let list = occurrencesByNode.get(mapping.textNode);
      if (!list) {
        list = [];
        occurrencesByNode.set(mapping.textNode, list);
      }
      list.push(mapping);
    }

    const preparedReplacements: PreparedDomReplacement[] = [];

    for (const [textNode, mappings] of occurrencesByNode) {
      const ownerDocument = textNode.ownerDocument;
      if (!ownerDocument) return false;

      mappings.sort((a, b) => a.localFrom - b.localFrom);

      const items: { localFrom: number; localTo: number; span: HTMLElement }[] = [];

      for (const mapping of mappings) {
        const rendered = snapshot.citationByClusterId.get(mapping.clusterId);
        if (!rendered) return false;

        const span = createPandocCitationSpan(ownerDocument, "feuillets-csl-citation");
        span.setAttribute("data-cluster-id", mapping.clusterId);
        span.setAttribute("data-csl-cluster-id", mapping.clusterId);
        renderCitationNodes(rendered.content, span, ownerDocument);

        items.push({
          localFrom: mapping.localFrom,
          localTo: mapping.localTo,
          span,
        });
      }

      preparedReplacements.push({ textNode, items });
    }

    // All pre-checks and element constructions succeeded; perform atomic replacement
    for (const replacement of preparedReplacements) {
      const textNode = replacement.textNode;
      const parent = textNode.parentNode;
      if (!parent) continue;

      const ownerDocument = textNode.ownerDocument;
      const fullValue = textNode.nodeValue || "";
      let cursor = 0;

      for (const item of replacement.items) {
        if (item.localFrom > cursor) {
          const slice = fullValue.slice(cursor, item.localFrom);
          parent.insertBefore(ownerDocument.createTextNode(slice), textNode);
        }
        parent.insertBefore(item.span, textNode);
        cursor = item.localTo;
      }

      if (cursor < fullValue.length) {
        const tail = fullValue.slice(cursor);
        parent.insertBefore(ownerDocument.createTextNode(tail), textNode);
      }

      parent.removeChild(textNode);
    }

    return true;
  } finally {
    host.disposeDocument(documentId);
  }
}
