/**
 * Public Documentary Citation Contract for Feuillets.
 *
 * Defines the public Data Transfer Object (DTO) types, structured AST nodes,
 * and diagnostic representations exchanged between Feuillets and citation engine
 * providers (e.g. Feuillets CSL).
 *
 * Invariants:
 * - Pure TypeScript: zero Obsidian dependencies.
 * - Zero Vault / filesystem paths.
 * - Zero raw HTML strings (safe structured AST).
 * - Zero citeproc-js / citeproc-ts or Retorquere engine types.
 */

// ---------------------------------------------------------------------------
// 1. Bibliography & Style Sources
// ---------------------------------------------------------------------------

/**
 * Raw bibliography source provided to the citation engine.
 */
export interface CitationBibliographySource {
  id: string;
  version: string;
  format: "bibtex";
  content: string;
}

/**
 * Raw CSL style source provided to the citation engine.
 */
export interface CitationStyleSource {
  id: string;
  version: string;
  xml: string;
}

// ---------------------------------------------------------------------------
// 2. Citation Item Input
// ---------------------------------------------------------------------------

/**
 * Citation item rendering modes supported by CSL and Pandoc syntax.
 */
export type CitationItemMode =
  | "normal"
  | "suppress-author"
  | "author-only"
  | "composite";

/**
 * A single citation item reference inside a citation cluster.
 */
export interface CitationItemInput {
  id: string;
  prefix?: string;
  suffix?: string;
  locator?: string;
  label?: string;
  mode?: CitationItemMode;
}

// ---------------------------------------------------------------------------
// 3. Citation Cluster Input
// ---------------------------------------------------------------------------

/**
 * A citation cluster (group of citation items appearing at a single location).
 */
export interface CitationClusterInput {
  id: string;
  items: CitationItemInput[];
  noteIndex?: number;
}

// ---------------------------------------------------------------------------
// 4. Document Request
// ---------------------------------------------------------------------------

/**
 * Complete document citation request sent to the citation engine.
 */
export interface CitationDocumentRequest {
  documentId: string;
  revision: number;
  style: CitationStyleSource;
  bibliographies: CitationBibliographySource[];
  locale?: string;
  clusters: CitationClusterInput[];
  includeBibliography: boolean;
}

// ---------------------------------------------------------------------------
// 5. Safe Output AST (HTML-Free)
// ---------------------------------------------------------------------------

export type CitationFontStyle =
  | "normal"
  | "italic"
  | "oblique";

export type CitationFontWeight =
  | "normal"
  | "bold"
  | "light";

export type CitationFontVariant =
  | "normal"
  | "small-caps";

export type CitationTextDecoration =
  | "none"
  | "underline";

export type CitationVerticalAlign =
  | "baseline"
  | "superscript"
  | "subscript";

export interface CitationTextStyle {
  fontStyle?: CitationFontStyle;
  fontWeight?: CitationFontWeight;
  fontVariant?: CitationFontVariant;
  textDecoration?: CitationTextDecoration;
  verticalAlign?: CitationVerticalAlign;
}

export interface CitationRenderText {
  type: "text";
  text: string;
}

export interface CitationRenderSpan {
  type: "span";
  style: CitationTextStyle;
  children: CitationRenderNode[];
}

export type CitationRenderDisplay =
  | "block"
  | "left-margin"
  | "right-inline"
  | "indent";

export interface CitationRenderBlock {
  type: "block";
  display: CitationRenderDisplay;
  children: CitationRenderNode[];
}

export interface CitationRenderLink {
  type: "link";
  href: string;
  children: CitationRenderNode[];
}

export type CitationRenderNode =
  | CitationRenderText
  | CitationRenderSpan
  | CitationRenderBlock
  | CitationRenderLink;

// ---------------------------------------------------------------------------
// 6. Rendered Citations
// ---------------------------------------------------------------------------

export interface RenderedCitation {
  clusterId: string;
  plainText: string;
  content: CitationRenderNode[];
}

// ---------------------------------------------------------------------------
// 7. Rendered Bibliography
// ---------------------------------------------------------------------------

export interface RenderedBibliographyEntry {
  itemIds: string[];
  plainText: string;
  content: CitationRenderNode[];
}

export type BibliographySecondFieldAlign =
  | "flush"
  | "margin";

export interface BibliographyLayout {
  hangingIndent: boolean;
  entrySpacing: number;
  lineSpacing: number;
  secondFieldAlign?: BibliographySecondFieldAlign;
  maxOffset?: number;
}

export interface RenderedBibliography {
  entries: RenderedBibliographyEntry[];
  layout: BibliographyLayout;
}

// ---------------------------------------------------------------------------
// 8. Diagnostics
// ---------------------------------------------------------------------------

export type CitationDiagnosticSeverity =
  | "warning"
  | "error";

export interface CitationEngineDiagnostic {
  code: string;
  severity: CitationDiagnosticSeverity;
  message: string;
  clusterId?: string;
  citekey?: string;
}

// ---------------------------------------------------------------------------
// 9. Document Result
// ---------------------------------------------------------------------------

export interface CitationDocumentResult {
  documentId: string;
  revision: number;
  citations: RenderedCitation[];
  bibliography: RenderedBibliography | null;
  diagnostics: CitationEngineDiagnostic[];
}
