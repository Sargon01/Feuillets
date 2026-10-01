/**
 * CSL Citation Host / Document Coordinator for Feuillets (Lot 7A).
 *
 * Coordinates CSL citation rendering between Feuillets and registered
 * citation providers (e.g. Feuillets CSL).
 *
 * Responsibilities:
 * 1. Obtains the registered CSL provider via CitationEngineRegistry.
 * 2. Resolves citation resources (.bib and .csl) hierarchically via workspace-citations.ts.
 * 3. Reads resource file contents once per request and extracts version tokens (mtime:size).
 * 4. Parses Pandoc citation occurrences structurally via pandoc-citation-parser.ts.
 * 5. Builds CitationDocumentRequest and invokes provider.renderDocument().
 * 6. Hardens result validation: validates structural integrity before request matching.
 * 7. Manages monotonically increasing per-document revisions and rejects stale async results.
 * 8. Caches the latest valid snapshot per logical document session and indexes citations by clusterId.
 * 9. Exposes clean provider and resource invalidation primitives.
 *
 * Invariants:
 * - Pure coordinator: never formats CSL itself; does not duplicate citeproc state.
 * - Fails safely: returns typed status snapshots, never throws into rendering paths.
 * - No user-visible notices in this lot.
 */

import { normalizePath, TFile, TFolder, type App } from "obsidian";
import {
  CitationEngineRegistry,
  isCitationEngineProvider,
  validateCitationDocumentResult,
  validateCitationDocumentResultForRequest,
  type CitationDocumentRequest,
  type CitationDocumentResult,
  type CitationEngineDiagnostic,
  type CitationEngineProvider,
  type RenderedCitation,
} from "../api/citation-engine.js";
import { resolveWorkspaceCitationResources } from "./workspace-citations.js";
import {
  parsePandocCitationDocument,
  type ParsedPandocCitationDocument,
} from "./pandoc-citation-parser.js";
import { getLocale } from "../i18n/index.js";

export const DEFAULT_CSL_PROVIDER_ID = "feuillets-csl";

/**
 * Maps Feuillets application locale string to supported CSL runtime locale (en-US, fr-FR).
 * Closed mapping:
 * - "fr", "fr-FR" -> "fr-FR"
 * - "en", "en-US" -> "en-US"
 * - Any other value (e.g. "fr-CA", "en-GB", "de", unsupported/empty) -> undefined.
 */
export function resolveCslLocale(
  appLocale: string | undefined | null
): string | undefined {
  if (!appLocale || typeof appLocale !== "string") return undefined;
  const trimmed = appLocale.trim();
  if (trimmed === "fr" || trimmed === "fr-FR") return "fr-FR";
  if (trimmed === "en" || trimmed === "en-US") return "en-US";
  return undefined;
}

// ---------------------------------------------------------------------------
// Host Snapshot Types
// ---------------------------------------------------------------------------

export type CslHostStatus =
  | "ready"
  | "pending"
  | "provider-unavailable"
  | "resources-unavailable"
  | "engine-error";

export interface CslHostReadySnapshot {
  status: "ready";
  documentId: string;
  revision: number;
  result: CitationDocumentResult;
  citationByClusterId: Map<string, RenderedCitation>;
  parsedDocument: ParsedPandocCitationDocument;
}

export interface CslHostPendingSnapshot {
  status: "pending";
  documentId: string;
  revision: number;
}

export interface CslHostProviderUnavailableSnapshot {
  status: "provider-unavailable";
  reason: string;
}

export interface CslHostResourcesUnavailableSnapshot {
  status: "resources-unavailable";
  reason: string;
  bibliographyStatus?: string;
  cslStatus?: string;
}

export interface CslHostEngineErrorSnapshot {
  status: "engine-error";
  reason: string;
  diagnostics?: CitationEngineDiagnostic[];
}

export type CslHostSnapshot =
  | CslHostReadySnapshot
  | CslHostPendingSnapshot
  | CslHostProviderUnavailableSnapshot
  | CslHostResourcesUnavailableSnapshot
  | CslHostEngineErrorSnapshot;

export interface CslHostInvalidation {
  documentIds: ReadonlySet<string> | null;
}

export type CslHostInvalidationListener = (event: CslHostInvalidation) => void;

export interface RenderDocumentOptions {
  includeBibliography?: boolean;
  locale?: string;
}

interface HostDocumentSession {
  provider: CitationEngineProvider;
  currentRevision: number;
  latestPendingRevision: number;
  latestReadySnapshot: CslHostReadySnapshot | null;
  lastInputSignature?: string;
  usedResourcePaths: Set<string>;
}

export interface CslCitationHostOptions {
  app: App;
  settings?: FeuilletsSettings;
  getSettings?: () => FeuilletsSettings;
  citationRegistry: CitationEngineRegistry;
  providerId?: string;
}

/**
 * Host coordinator managing CSL citation rendering sessions.
 */
export class CslCitationHost {
  private readonly app: App;
  private readonly getSettings: () => FeuilletsSettings;
  private readonly registry: CitationEngineRegistry;
  private readonly providerId: string;
  private readonly sessions = new Map<string, HostDocumentSession>();
  private readonly invalidationListeners = new Set<CslHostInvalidationListener>();
  private readonly unregisterRegistryListener: () => void;

  constructor(options: CslCitationHostOptions) {
    this.app = options.app;
    if (typeof options.getSettings === "function") {
      this.getSettings = options.getSettings;
    } else if (options.settings) {
      const capturedSettings = options.settings;
      this.getSettings = () => capturedSettings;
    } else {
      throw new Error("CslCitationHostOptions must provide getSettings or settings.");
    }
    this.registry = options.citationRegistry;
    this.providerId = options.providerId ?? DEFAULT_CSL_PROVIDER_ID;

    this.unregisterRegistryListener = this.registry.onChange(() => {
      this.invalidateProvider();
    });
  }

  /**
   * Subscribes to host invalidation events (provider or resource changes).
   * Returns an unsubscribe function.
   */
  onInvalidation(listener: CslHostInvalidationListener): () => void {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  private notifyInvalidation(event: CslHostInvalidation): void {
    for (const listener of this.invalidationListeners) {
      try {
        listener(event);
      } catch {
        // Swallowed
      }
    }
  }

  /**
   * Drops a session: retrieves the session, calls THAT session's provider.disposeDocument,
   * swallows any errors, and removes the session from the host.
   */
  private dropSession(documentId: string): void {
    const session = this.sessions.get(documentId);
    if (!session) return;
    this.sessions.delete(documentId);
    try {
      session.provider.disposeDocument(documentId);
    } catch {
      // Swallowed
    }
  }

  /**
   * Retrieves the current registered citation engine provider.
   */
  getProvider(): CitationEngineProvider | null {
    const provider = this.registry.get(this.providerId);
    if (!provider || !isCitationEngineProvider(provider)) {
      return null;
    }
    return provider;
  }

  /**
   * Returns the latest snapshot for a logical document, or null if never rendered.
   */
  getLatestSnapshot(documentId: string): CslHostSnapshot | null {
    const session = this.sessions.get(documentId);
    return session?.latestReadySnapshot ?? null;
  }

  /**
   * Retrieves a rendered citation by clusterId from the document's latest ready snapshot.
   */
  getCitation(documentId: string, clusterId: string): RenderedCitation | null {
    const session = this.sessions.get(documentId);
    return session?.latestReadySnapshot?.citationByClusterId.get(clusterId) ?? null;
  }

  /**
   * Renders citations for a logical document session.
   */
  async renderDocument(
    documentId: string,
    markdown: string,
    projectRoot: TFolder,
    targetScope: TFolder | TFile | null,
    options: RenderDocumentOptions = {}
  ): Promise<CslHostSnapshot> {
    const provider = this.getProvider();
    if (!provider) {
      return {
        status: "provider-unavailable",
        reason: `Citation engine provider '${this.providerId}' is not registered or invalid.`,
      };
    }

    const resources = resolveWorkspaceCitationResources(
      this.app,
      this.getSettings(),
      projectRoot,
      targetScope
    );

    const bibFile = resources.bibliography.file;
    const cslFile = resources.csl.file;

    const isBibValid = resources.bibliography.status === "valid" && bibFile !== null;
    const isCslValid = resources.csl.status === "valid" && cslFile !== null;

    if (!isBibValid || !isCslValid) {
      return {
        status: "resources-unavailable",
        reason: "Citation resources (.bib and .csl) must both be valid and configured.",
        bibliographyStatus: resources.bibliography.status,
        cslStatus: resources.csl.status,
      };
    }

    const bibPath = normalizePath(bibFile.path);
    const cslPath = normalizePath(cslFile.path);
    const bibVersion = `${bibFile.stat?.mtime ?? 0}:${bibFile.stat?.size ?? 0}`;
    const cslVersion = `${cslFile.stat?.mtime ?? 0}:${cslFile.stat?.size ?? 0}`;

    let session = this.sessions.get(documentId);
    if (session && session.provider !== provider) {
      this.dropSession(documentId);
      session = undefined;
    }

    if (!session) {
      session = {
        provider,
        currentRevision: 0,
        latestPendingRevision: 0,
        latestReadySnapshot: null,
        usedResourcePaths: new Set([bibPath, cslPath]),
      };
      this.sessions.set(documentId, session);
    } else {
      session.usedResourcePaths.add(bibPath);
      session.usedResourcePaths.add(cslPath);
    }

    const effectiveLocale = resolveCslLocale(options.locale ?? getLocale());
    const includeBibliography = options.includeBibliography ?? false;

    // Fast-path cache check: if input is identical to the last computed ready snapshot, return it
    const currentSignature = `${bibPath}@${bibVersion}|${cslPath}@${cslVersion}|${effectiveLocale ?? ""}|${includeBibliography ? "1" : "0"}|${markdown}`;
    if (
      session.lastInputSignature === currentSignature &&
      session.latestReadySnapshot !== null
    ) {
      return session.latestReadySnapshot;
    }

    // Advance monotonically increasing revision
    const revision = ++session.currentRevision;
    session.latestPendingRevision = revision;
    session.lastInputSignature = currentSignature;

    let bibContent: string;
    let cslXml: string;
    try {
      bibContent =
        typeof this.app.vault.cachedRead === "function"
          ? await this.app.vault.cachedRead(bibFile)
          : await this.app.vault.read(bibFile);
      cslXml =
        typeof this.app.vault.cachedRead === "function"
          ? await this.app.vault.cachedRead(cslFile)
          : await this.app.vault.read(cslFile);
    } catch (readError) {
      return {
        status: "resources-unavailable",
        reason: `Failed to read citation files: ${readError instanceof Error ? readError.message : String(readError)}`,
      };
    }

    const parsedDocument = parsePandocCitationDocument(markdown);

    const request: CitationDocumentRequest = {
      documentId,
      revision,
      style: {
        id: cslPath,
        version: cslVersion,
        xml: cslXml,
      },
      bibliographies: [
        {
          id: bibPath,
          version: bibVersion,
          format: "bibtex",
          content: bibContent,
        },
      ],
      ...(effectiveLocale ? { locale: effectiveLocale } : {}),
      clusters: parsedDocument.clusters,
      includeBibliography,
    };

    let result: CitationDocumentResult;
    try {
      result = await provider.renderDocument(request);
    } catch (engineError) {
      return {
        status: "engine-error",
        reason: `Citation engine threw an error: ${engineError instanceof Error ? engineError.message : String(engineError)}`,
      };
    }

    // Validation Order (§23): FIRST structural, THEN request matching
    const structuralVal = validateCitationDocumentResult(result);
    if (!structuralVal.valid) {
      return {
        status: "engine-error",
        reason: `Provider returned invalid result structure: ${structuralVal.errors.join("; ")}`,
      };
    }

    const requestVal = validateCitationDocumentResultForRequest(request, result);
    if (!requestVal.valid) {
      return {
        status: "engine-error",
        reason: `Provider result does not match request: ${requestVal.errors.join("; ")}`,
      };
    }

    // Race condition guard (§19-20): reject stale async result if newer revision exists
    if (
      revision < session.latestPendingRevision ||
      (session.latestReadySnapshot !== null &&
        session.latestReadySnapshot.revision > revision)
    ) {
      return (
        session.latestReadySnapshot ?? {
          status: "pending",
          documentId,
          revision: session.latestPendingRevision,
        }
      );
    }

    // Build occurrence lookup map
    const citationByClusterId = new Map<string, RenderedCitation>();
    for (const citation of result.citations) {
      citationByClusterId.set(citation.clusterId, citation);
    }

    const readySnapshot: CslHostReadySnapshot = {
      status: "ready",
      documentId,
      revision,
      result,
      citationByClusterId,
      parsedDocument,
    };

    session.latestReadySnapshot = readySnapshot;
    return readySnapshot;
  }

  /**
   * Invalidates provider cache across all sessions when citation provider changes.
   * Disposes each tracked document through its owning provider and notifies subscribers.
   */
  invalidateProvider(): void {
    const docIds = Array.from(this.sessions.keys());
    for (const docId of docIds) {
      this.dropSession(docId);
    }
    this.notifyInvalidation({ documentIds: null });
  }

  /**
   * Invalidates cached sessions associated with a modified .bib or .csl resource.
   */
  invalidateResource(normalizedPath: string): void {
    const norm = normalizePath(normalizedPath);
    const affectedDocIds = new Set<string>();
    for (const [docId, session] of this.sessions) {
      if (session.usedResourcePaths.has(norm)) {
        affectedDocIds.add(docId);
      }
    }
    for (const docId of affectedDocIds) {
      this.dropSession(docId);
    }
    this.notifyInvalidation({ documentIds: affectedDocIds });
  }

  /**
   * Invalidates all resource caches across all sessions.
   */
  invalidateAllResources(): void {
    const docIds = Array.from(this.sessions.keys());
    for (const docId of docIds) {
      this.dropSession(docId);
    }
    this.notifyInvalidation({ documentIds: null });
  }

  /**
   * Releases engine resources and cached state for a logical document session.
   * Disposes only if the host actually tracks a session for documentId.
   */
  disposeDocument(documentId: string): void {
    this.dropSession(documentId);
  }

  /**
   * Disposes the host, unsubscribes all listeners, and disposes every tracked
   * document session through its owning provider.
   */
  dispose(): void {
    this.unregisterRegistryListener();
    const docIds = Array.from(this.sessions.keys());
    for (const docId of docIds) {
      this.dropSession(docId);
    }
    this.invalidationListeners.clear();
  }
}
