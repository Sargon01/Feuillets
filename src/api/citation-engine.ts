/**
 * Public Citation Engine API for Feuillets (API v2).
 *
 * Minimal surface: Feuillets does not implement a citation engine directly.
 * It provides a public registry for optional companion plugins (e.g. Feuillets CSL)
 * to dynamically register, unregister, or reload citation providers.
 *
 * In API v2, registered providers supply full document citation rendering via
 * renderDocument() and per-document session release via disposeDocument().
 *
 * This contract contains no Obsidian dependencies and is pure TypeScript.
 */

import type {
  CitationClusterInput,
  CitationDocumentRequest,
  CitationDocumentResult,
} from "./citation-contract.js";

export * from "./citation-contract.js";

export const CITATION_API_VERSION = 2;

/**
 * Public interface for a citation engine provider (v2).
 */
export interface CitationEngineProvider {
  /** Unique provider identifier, e.g. "feuillets-csl". */
  id: string;
  /** Display name of the provider. */
  name: string;
  /** Semantic version string of the provider. */
  version: string;

  /**
   * Renders citation clusters and bibliography for a complete document request.
   */
  renderDocument(
    request: CitationDocumentRequest
  ): Promise<CitationDocumentResult>;

  /**
   * Releases engine resources and cached state for a single document.
   */
  disposeDocument(documentId: string): void;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Validates whether an arbitrary value conforms to CitationEngineProvider v2.
 * Third-party companion plugins are compiled separately, so runtime checks
 * are necessary to guarantee structural integrity.
 */
export function isCitationEngineProvider(
  value: unknown
): value is CitationEngineProvider {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    isNonEmptyString(value["name"]) &&
    isNonEmptyString(value["version"]) &&
    typeof value["renderDocument"] === "function" &&
    typeof value["disposeDocument"] === "function"
  );
}

/**
 * Registry for citation engine providers.
 *
 * Re-registering the same provider ID replaces the previous instance instead of failing,
 * ensuring seamless reload cycles when companion plugins are updated or reloaded by Obsidian.
 */
export class CitationEngineRegistry {
  private providers = new Map<string, CitationEngineProvider>();
  private listeners = new Set<() => void>();

  register(provider: CitationEngineProvider): void {
    if (!isCitationEngineProvider(provider)) {
      throw new Error(
        "Feuillets: invalid citation engine provider (id, name, and version are required non-empty strings, renderDocument and disposeDocument must be functions)."
      );
    }
    this.providers.set(provider.id, provider);
    this.emit();
  }

  /**
   * Unregisters a provider by its identifier.
   * Returns true if a provider was removed, false otherwise.
   * Never throws so companion plugins can safely call this in onunload().
   */
  unregister(providerId: string): boolean {
    const removed = this.providers.delete(providerId);
    if (removed) this.emit();
    return removed;
  }

  /**
   * Retrieves a provider by ID, or the first registered provider if omitted.
   * Returns null if no matching provider is registered.
   */
  get(providerId?: string): CitationEngineProvider | null {
    if (providerId !== undefined) return this.providers.get(providerId) ?? null;
    for (const provider of this.providers.values()) return provider;
    return null;
  }

  /** Lists all registered providers. */
  list(): CitationEngineProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Registers a callback invoked whenever providers are registered or unregistered.
   * Returns an unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Faulty listeners must not disrupt the registry. */
      }
    }
  }
}

/**
 * Namespaced citation API exposed on plugin.api.citations.
 */
export interface FeuilletsCitationApi {
  readonly apiVersion: number;
  registerProvider(provider: CitationEngineProvider): void;
  unregisterProvider(providerId: string): void;
  getProvider(providerId?: string): CitationEngineProvider | null;
}

/**
 * Factory creating the namespaced citation API bound to a registry instance.
 */
export function createCitationApi(
  registry: CitationEngineRegistry
): FeuilletsCitationApi {
  return {
    apiVersion: CITATION_API_VERSION,
    registerProvider: (provider) => registry.register(provider),
    unregisterProvider: (providerId) => {
      registry.unregister(providerId);
    },
    getProvider: (providerId) => registry.get(providerId),
  };
}

// ---------------------------------------------------------------------------
// Runtime Result Validation
// ---------------------------------------------------------------------------

const FORBIDDEN_HTML_PROPERTIES = [
  "html",
  "rawHtml",
  "innerHTML",
  "outerHTML",
  "unsafeHtml",
];

const ALLOWED_FONT_STYLES = new Set(["normal", "italic", "oblique"]);
const ALLOWED_FONT_WEIGHTS = new Set(["normal", "bold", "light"]);
const ALLOWED_FONT_VARIANTS = new Set(["normal", "small-caps"]);
const ALLOWED_TEXT_DECORATIONS = new Set(["none", "underline"]);
const ALLOWED_VERTICAL_ALIGNS = new Set(["baseline", "superscript", "subscript"]);
const ALLOWED_BLOCK_DISPLAYS = new Set([
  "block",
  "left-margin",
  "right-inline",
  "indent",
]);
const ALLOWED_SECOND_FIELD_ALIGNS = new Set(["flush", "margin"]);
const ALLOWED_DIAGNOSTIC_SEVERITIES = new Set(["warning", "error"]);

function checkForbiddenHtml(
  obj: Record<string, unknown>,
  path: string,
  errors: string[]
): void {
  for (const prop of FORBIDDEN_HTML_PROPERTIES) {
    if (prop in obj) {
      errors.push(`${path} must not contain forbidden property '${prop}'.`);
    }
  }
}

function validateTextStyle(
  style: unknown,
  path: string,
  errors: string[]
): void {
  if (!isRecord(style)) {
    errors.push(`${path} must be a style object.`);
    return;
  }
  checkForbiddenHtml(style, path, errors);

  if (style["fontStyle"] !== undefined) {
    if (
      typeof style["fontStyle"] !== "string" ||
      !ALLOWED_FONT_STYLES.has(style["fontStyle"])
    ) {
      errors.push(
        `${path}.fontStyle must be 'normal', 'italic', or 'oblique'.`
      );
    }
  }
  if (style["fontWeight"] !== undefined) {
    if (
      typeof style["fontWeight"] !== "string" ||
      !ALLOWED_FONT_WEIGHTS.has(style["fontWeight"])
    ) {
      errors.push(
        `${path}.fontWeight must be 'normal', 'bold', or 'light'.`
      );
    }
  }
  if (style["fontVariant"] !== undefined) {
    if (
      typeof style["fontVariant"] !== "string" ||
      !ALLOWED_FONT_VARIANTS.has(style["fontVariant"])
    ) {
      errors.push(
        `${path}.fontVariant must be 'normal' or 'small-caps'.`
      );
    }
  }
  if (style["textDecoration"] !== undefined) {
    if (
      typeof style["textDecoration"] !== "string" ||
      !ALLOWED_TEXT_DECORATIONS.has(style["textDecoration"])
    ) {
      errors.push(
        `${path}.textDecoration must be 'none' or 'underline'.`
      );
    }
  }
  if (style["verticalAlign"] !== undefined) {
    if (
      typeof style["verticalAlign"] !== "string" ||
      !ALLOWED_VERTICAL_ALIGNS.has(style["verticalAlign"])
    ) {
      errors.push(
        `${path}.verticalAlign must be 'baseline', 'superscript', or 'subscript'.`
      );
    }
  }
}

function validateRenderNode(
  node: unknown,
  path: string,
  errors: string[]
): void {
  if (!isRecord(node)) {
    errors.push(`${path} must be a node object.`);
    return;
  }
  checkForbiddenHtml(node, path, errors);

  const type = node["type"];
  if (type === "text") {
    if (typeof node["text"] !== "string") {
      errors.push(`${path}.text must be a string.`);
    }
  } else if (type === "span") {
    validateTextStyle(node["style"], `${path}.style`, errors);
    const children = node["children"];
    if (!isUnknownArray(children)) {
      errors.push(`${path}.children must be an array.`);
    } else {
      for (let i = 0; i < children.length; i++) {
        validateRenderNode(children[i], `${path}.children[${i}]`, errors);
      }
    }
  } else if (type === "block") {
    if (
      typeof node["display"] !== "string" ||
      !ALLOWED_BLOCK_DISPLAYS.has(node["display"])
    ) {
      errors.push(
        `${path}.display must be 'block', 'left-margin', 'right-inline', or 'indent'.`
      );
    }
    const children = node["children"];
    if (!isUnknownArray(children)) {
      errors.push(`${path}.children must be an array.`);
    } else {
      for (let i = 0; i < children.length; i++) {
        validateRenderNode(children[i], `${path}.children[${i}]`, errors);
      }
    }
  } else if (type === "link") {
    if (typeof node["href"] !== "string") {
      errors.push(`${path}.href must be a string.`);
    }
    const children = node["children"];
    if (!isUnknownArray(children)) {
      errors.push(`${path}.children must be an array.`);
    } else {
      for (let i = 0; i < children.length; i++) {
        validateRenderNode(children[i], `${path}.children[${i}]`, errors);
      }
    }
  } else {
    errors.push(
      `${path}.type must be 'text', 'span', 'block', or 'link'. Got: ${String(type)}.`
    );
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a CitationDocumentResult returned by a citation engine provider.
 * Feuillets does not blindly trust objects returned across plugin boundaries.
 */
export function validateCitationDocumentResult(
  value: unknown
): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ["Root must be an object."] };
  }
  checkForbiddenHtml(value, "root", errors);

  // documentId
  if (!isNonEmptyString(value["documentId"])) {
    errors.push("documentId must be a non-empty string.");
  }

  // revision
  const revision = value["revision"];
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 0
  ) {
    errors.push("revision must be an integer >= 0.");
  }

  // citations
  const citations = value["citations"];
  if (!isUnknownArray(citations)) {
    errors.push("citations must be an array.");
  } else {
    for (let i = 0; i < citations.length; i++) {
      const cit = citations[i];
      const p = `citations[${i}]`;
      if (!isRecord(cit)) {
        errors.push(`${p} must be an object.`);
        continue;
      }
      checkForbiddenHtml(cit, p, errors);

      if (!isNonEmptyString(cit["clusterId"])) {
        errors.push(`${p}.clusterId must be a non-empty string.`);
      }
      if (typeof cit["plainText"] !== "string") {
        errors.push(`${p}.plainText must be a string.`);
      }
      const content = cit["content"];
      if (!isUnknownArray(content)) {
        errors.push(`${p}.content must be an array.`);
      } else {
        for (let j = 0; j < content.length; j++) {
          validateRenderNode(content[j], `${p}.content[${j}]`, errors);
        }
      }
    }
  }

  // bibliography
  if (!("bibliography" in value) || value["bibliography"] === undefined) {
    errors.push("bibliography must be null or an object.");
  } else {
    const bibliography = value["bibliography"];
    if (bibliography !== null) {
      if (!isRecord(bibliography)) {
        errors.push("bibliography must be null or an object.");
      } else {
        checkForbiddenHtml(bibliography, "bibliography", errors);

      // entries
      const entries = bibliography["entries"];
      if (!isUnknownArray(entries)) {
        errors.push("bibliography.entries must be an array.");
      } else {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const p = `bibliography.entries[${i}]`;
          if (!isRecord(entry)) {
            errors.push(`${p} must be an object.`);
            continue;
          }
          checkForbiddenHtml(entry, p, errors);

          const itemIds = entry["itemIds"];
          if (!isUnknownArray(itemIds)) {
            errors.push(`${p}.itemIds must be an array of strings.`);
          } else {
            for (let k = 0; k < itemIds.length; k++) {
              if (typeof itemIds[k] !== "string") {
                errors.push(`${p}.itemIds[${k}] must be a string.`);
              }
            }
          }

          if (typeof entry["plainText"] !== "string") {
            errors.push(`${p}.plainText must be a string.`);
          }

          const content = entry["content"];
          if (!isUnknownArray(content)) {
            errors.push(`${p}.content must be an array.`);
          } else {
            for (let j = 0; j < content.length; j++) {
              validateRenderNode(content[j], `${p}.content[${j}]`, errors);
            }
          }
        }
      }

      // layout
      const layout = bibliography["layout"];
      if (!isRecord(layout)) {
        errors.push("bibliography.layout must be an object.");
      } else {
        checkForbiddenHtml(layout, "bibliography.layout", errors);

        if (typeof layout["hangingIndent"] !== "boolean") {
          errors.push("bibliography.layout.hangingIndent must be a boolean.");
        }
        if (
          typeof layout["entrySpacing"] !== "number" ||
          layout["entrySpacing"] < 0
        ) {
          errors.push(
            "bibliography.layout.entrySpacing must be a number >= 0."
          );
        }
        if (
          typeof layout["lineSpacing"] !== "number" ||
          layout["lineSpacing"] < 0
        ) {
          errors.push("bibliography.layout.lineSpacing must be a number >= 0.");
        }
        if (layout["secondFieldAlign"] !== undefined) {
          if (
            typeof layout["secondFieldAlign"] !== "string" ||
            !ALLOWED_SECOND_FIELD_ALIGNS.has(layout["secondFieldAlign"])
          ) {
            errors.push(
              "bibliography.layout.secondFieldAlign must be 'flush' or 'margin'."
            );
          }
        }
        if (layout["maxOffset"] !== undefined) {
          if (
            typeof layout["maxOffset"] !== "number" ||
            layout["maxOffset"] < 0
          ) {
            errors.push("bibliography.layout.maxOffset must be a number >= 0.");
          }
        }
      }
    }
  }
}

  // diagnostics
  const diagnostics = value["diagnostics"];
  if (!isUnknownArray(diagnostics)) {
    errors.push("diagnostics must be an array.");
  } else {
    for (let i = 0; i < diagnostics.length; i++) {
      const diag = diagnostics[i];
      const p = `diagnostics[${i}]`;
      if (!isRecord(diag)) {
        errors.push(`${p} must be an object.`);
        continue;
      }
      checkForbiddenHtml(diag, p, errors);

      if (!isNonEmptyString(diag["code"])) {
        errors.push(`${p}.code must be a non-empty string.`);
      }
      if (
        typeof diag["severity"] !== "string" ||
        !ALLOWED_DIAGNOSTIC_SEVERITIES.has(diag["severity"])
      ) {
        errors.push(`${p}.severity must be 'warning' or 'error'.`);
      }
      if (typeof diag["message"] !== "string") {
        errors.push(`${p}.message must be a string.`);
      }
      if (
        diag["clusterId"] !== undefined &&
        typeof diag["clusterId"] !== "string"
      ) {
        errors.push(`${p}.clusterId must be a string if defined.`);
      }
      if (
        diag["citekey"] !== undefined &&
        typeof diag["citekey"] !== "string"
      ) {
        errors.push(`${p}.citekey must be a string if defined.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates that a returned CitationDocumentResult strictly matches the request
 * it was rendered for (same documentId and revision).
 */
export function validateCitationDocumentResultForRequest(
  request: CitationDocumentRequest,
  result: CitationDocumentResult
): ValidationResult {
  const errors: string[] = [];

  if (result.documentId !== request.documentId) {
    errors.push(
      `Document ID mismatch: result.documentId ('${result.documentId}') !== request.documentId ('${request.documentId}').`
    );
  }
  if (result.revision !== request.revision) {
    errors.push(
      `Revision mismatch: result.revision (${result.revision}) !== request.revision (${request.revision}).`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Accepts only complete renderings or explicitly unresolved whole clusters. */
export function validateCitationClusterResults(
  clusters: readonly CitationClusterInput[],
  result: CitationDocumentResult
): ValidationResult {
  const errors: string[] = [];
  const requested = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const rendered = new Set<string>();
  const unresolved = new Set<string>();
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.severity !== "error") continue;
    const cluster = diagnostic.clusterId ? requested.get(diagnostic.clusterId) : undefined;
    if (diagnostic.code !== "UNKNOWN_CITEKEY" || !cluster
      || !cluster.items.some((item) => item.id === diagnostic.citekey)) {
      errors.push(`Unrecoverable citation diagnostic: ${diagnostic.code}.`);
    } else {
      unresolved.add(cluster.id);
    }
  }
  for (const citation of result.citations) {
    if (!requested.has(citation.clusterId) || rendered.has(citation.clusterId)
      || unresolved.has(citation.clusterId)) {
      errors.push(`Unexpected, duplicate or unresolved rendered cluster: ${citation.clusterId}.`);
    }
    rendered.add(citation.clusterId);
  }
  for (const cluster of clusters) {
    if (!rendered.has(cluster.id) && !unresolved.has(cluster.id)) {
      errors.push(`Missing rendering without an unknown citekey diagnostic: ${cluster.id}.`);
    }
  }
  return { valid: errors.length === 0, errors };
}
