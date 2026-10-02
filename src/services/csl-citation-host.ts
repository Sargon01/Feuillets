/**
 * Coordinates resource resolution and citation rendering through registered CSL providers.
 * Caches accepted results within document sessions and rejects obsolete asynchronous work.
 */

import { normalizePath, TFile, TFolder, type App } from "obsidian";
import {
  CitationEngineRegistry,
  isCitationEngineProvider,
  validateCitationDocumentResult,
  validateCitationDocumentResultForRequest,
  type CitationBibliographySource,
  type CitationDocumentRequest,
  type CitationDocumentResult,
  type CitationEngineDiagnostic,
  type CitationEngineProvider,
  type RenderedCitation,
} from "../api/citation-engine.js";
import { buildNoteAwarePandocCitationDocument } from "./pandoc-citation-notes.js";
import { resolveWorkspaceCitationResources } from "./workspace-citations.js";
import {
  type ParsedPandocCitationDocument,
  type ParsedPandocCitationOccurrence,
} from "./pandoc-citation-parser.js";
import type {
  ScriveningsCslDocument,
  ScriveningsCslOccurrence,
} from "./scrivenings-csl-document.js";
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

export type CslOccurrenceLike = ParsedPandocCitationOccurrence | ScriveningsCslOccurrence;
export type CslDocumentLike = ParsedPandocCitationDocument | ScriveningsCslDocument;

export interface CslHostReadySnapshot {
  status: "ready";
  documentId: string;
  revision: number;
  result: CitationDocumentResult;
  citationByClusterId: Map<string, RenderedCitation>;
  parsedDocument: CslDocumentLike;
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
  currentInvocationGeneration: number;
  latestPendingRevision: number;
  latestReadySnapshot: CslHostReadySnapshot | null;
  readyInputSignature?: string;
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
  private disposed = false;

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
    if (this.disposed) return () => {};
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  private notifyInvalidation(event: CslHostInvalidation): void {
    for (const listener of this.invalidationListeners) {
      if (this.disposed) return;
      try {
        listener(event);
      } catch {
        // One failed subscriber must not prevent other views from invalidating.
      }
    }
  }

  private dropSession(documentId: string): void {
    const session = this.sessions.get(documentId);
    if (!session) return;
    this.sessions.delete(documentId);
    try {
      session.provider.disposeDocument(documentId);
    } catch {
      // Provider cleanup failure must not keep the session active.
    }
  }

  /**
   * Retrieves the current registered citation engine provider.
   */
  getProvider(): CitationEngineProvider | null {
    if (this.disposed) return null;
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

  private getOrCreateSession(
    documentId: string,
    provider: CitationEngineProvider,
    resourcePaths: readonly string[]
  ): HostDocumentSession | null {
    if (this.disposed) return null;
    let session = this.sessions.get(documentId);
    if (session && session.provider !== provider) {
      this.dropSession(documentId);
      session = undefined;
    }

    if (this.disposed) return null;
    if (!session) {
      session = {
        provider,
        currentRevision: 0,
        currentInvocationGeneration: 0,
        latestPendingRevision: 0,
        latestReadySnapshot: null,
        usedResourcePaths: new Set(resourcePaths),
      };
      this.sessions.set(documentId, session);
    } else {
      for (const p of resourcePaths) {
        session.usedResourcePaths.add(p);
      }
    }
    return session;
  }

  private isCurrentSession(documentId: string, session: HostDocumentSession): boolean {
    return !this.disposed && this.sessions.get(documentId) === session;
  }

  private inactiveSessionSnapshot(): CslHostEngineErrorSnapshot {
    return { status: "engine-error", reason: "Citation document session is no longer active." };
  }

  private getStaleInvocationSnapshot(
    documentId: string,
    session: HostDocumentSession,
    generation: number
  ): CslHostSnapshot | null {
    if (!this.isCurrentSession(documentId, session)) return this.inactiveSessionSnapshot();
    if (generation !== session.currentInvocationGeneration) {
      return session.latestReadySnapshot ?? {
        status: "pending",
        documentId,
        revision: session.latestPendingRevision,
      };
    }
    return null;
  }

  private async executeRenderPipeline(
    documentId: string,
    session: HostDocumentSession,
    provider: CitationEngineProvider,
    styleFile: TFile,
    bibliographyFiles: readonly TFile[],
    parsedDocument: CslDocumentLike,
    options: RenderDocumentOptions,
    cacheSignature: string
  ): Promise<CslHostSnapshot> {
    if (!this.isCurrentSession(documentId, session)) return this.inactiveSessionSnapshot();
    // Cache hits supersede pending work without consuming provider revisions.
    const generation = ++session.currentInvocationGeneration;
    if (
      session.readyInputSignature === cacheSignature &&
      session.latestReadySnapshot !== null
    ) {
      return session.latestReadySnapshot;
    }

    const revision = ++session.currentRevision;
    session.latestPendingRevision = revision;

    let cslXml: string;
    let staleSnapshot: CslHostSnapshot | null;
    const bibSources: CitationBibliographySource[] = [];
    try {
      cslXml =
        typeof this.app.vault.cachedRead === "function"
          ? await this.app.vault.cachedRead(styleFile)
          : await this.app.vault.read(styleFile);
      staleSnapshot = this.getStaleInvocationSnapshot(documentId, session, generation);
      if (staleSnapshot) return staleSnapshot;

      for (const bibFile of bibliographyFiles) {
        const bibContent =
          typeof this.app.vault.cachedRead === "function"
            ? await this.app.vault.cachedRead(bibFile)
            : await this.app.vault.read(bibFile);
        staleSnapshot = this.getStaleInvocationSnapshot(documentId, session, generation);
        if (staleSnapshot) return staleSnapshot;
        bibSources.push({
          id: normalizePath(bibFile.path),
          version: `${bibFile.stat?.mtime ?? 0}:${bibFile.stat?.size ?? 0}`,
          format: "bibtex",
          content: bibContent,
        });
      }
    } catch (readError) {
      staleSnapshot = this.getStaleInvocationSnapshot(documentId, session, generation);
      if (staleSnapshot) return staleSnapshot;
      return {
        status: "resources-unavailable",
        reason: `Failed to read citation files: ${readError instanceof Error ? readError.message : String(readError)}`,
      };
    }

    const cslPath = normalizePath(styleFile.path);
    const cslVersion = `${styleFile.stat?.mtime ?? 0}:${styleFile.stat?.size ?? 0}`;
    const effectiveLocale = resolveCslLocale(options.locale ?? getLocale());
    const includeBibliography = options.includeBibliography ?? false;

    const request: CitationDocumentRequest = {
      documentId,
      revision,
      style: {
        id: cslPath,
        version: cslVersion,
        xml: cslXml,
      },
      bibliographies: bibSources,
      ...(effectiveLocale ? { locale: effectiveLocale } : {}),
      clusters: [...parsedDocument.clusters],
      includeBibliography,
    };

    let result: CitationDocumentResult;
    try {
      result = await provider.renderDocument(request);
    } catch (engineError) {
      staleSnapshot = this.getStaleInvocationSnapshot(documentId, session, generation);
      if (staleSnapshot) return staleSnapshot;
      return {
        status: "engine-error",
        reason: `Citation engine threw an error: ${engineError instanceof Error ? engineError.message : String(engineError)}`,
      };
    }

    staleSnapshot = this.getStaleInvocationSnapshot(documentId, session, generation);
    if (staleSnapshot) return staleSnapshot;
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

    if (
      generation !== session.currentInvocationGeneration ||
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

    if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return {
        status: "engine-error",
        reason: "Citation engine reported an error.",
        diagnostics: result.diagnostics,
      };
    }

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

    staleSnapshot = this.getStaleInvocationSnapshot(documentId, session, generation);
    if (staleSnapshot) return staleSnapshot;
    session.latestReadySnapshot = readySnapshot;
    session.readyInputSignature = cacheSignature;
    return readySnapshot;
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

    const session = this.getOrCreateSession(documentId, provider, [bibPath, cslPath]);
    if (!session) return this.inactiveSessionSnapshot();

    const effectiveLocale = resolveCslLocale(options.locale ?? getLocale());
    const includeBibliography = options.includeBibliography ?? false;
    const cacheSignature = `${bibPath}@${bibVersion}|${cslPath}@${cslVersion}|${effectiveLocale ?? ""}|${includeBibliography ? "1" : "0"}|${markdown}`;

    const parsedDocument = buildNoteAwarePandocCitationDocument(markdown).document;

    return this.executeRenderPipeline(
      documentId,
      session,
      provider,
      cslFile,
      [bibFile],
      parsedDocument,
      options,
      cacheSignature
    );
  }

  /**
   * Renders citations for an already-prepared citation document (e.g. Scrivenings composite document)
   * with explicitly resolved CSL style and bibliography files.
   */
  async renderPreparedDocument(
    documentId: string,
    parsedDocument: CslDocumentLike,
    styleFile: TFile,
    bibliographyFiles: readonly TFile[],
    options: RenderDocumentOptions = {}
  ): Promise<CslHostSnapshot> {
    const provider = this.getProvider();
    if (!provider) {
      return {
        status: "provider-unavailable",
        reason: `Citation engine provider '${this.providerId}' is not registered or invalid.`,
      };
    }

    if (!styleFile || !(styleFile instanceof TFile)) {
      return {
        status: "resources-unavailable",
        reason: "Valid CSL style file must be provided.",
      };
    }

    const cslPath = normalizePath(styleFile.path);
    const cslVersion = `${styleFile.stat?.mtime ?? 0}:${styleFile.stat?.size ?? 0}`;

    const bibPaths: string[] = [];
    const bibDescriptors: string[] = [];
    for (const bibFile of bibliographyFiles) {
      if (!bibFile || !(bibFile instanceof TFile)) {
        return {
          status: "resources-unavailable",
          reason: "All bibliography files must be valid TFile instances.",
        };
      }
      const norm = normalizePath(bibFile.path);
      bibPaths.push(norm);
      bibDescriptors.push(`${norm}@${bibFile.stat?.mtime ?? 0}:${bibFile.stat?.size ?? 0}`);
    }

    const session = this.getOrCreateSession(documentId, provider, [cslPath, ...bibPaths]);
    if (!session) return this.inactiveSessionSnapshot();

    const effectiveLocale = resolveCslLocale(options.locale ?? getLocale());
    const includeBibliography = options.includeBibliography ?? false;

    const occurrences: readonly CslOccurrenceLike[] = parsedDocument.occurrences;
    const clustersSignature = occurrences
      .map((o: CslOccurrenceLike) => `${o.clusterId}:${o.from}:${o.to}:${JSON.stringify(o.cluster)}`)
      .join(";");
    const cacheSignature = `prepared|${cslPath}@${cslVersion}|[${bibDescriptors.join(",")}]|${effectiveLocale ?? ""}|${includeBibliography ? "1" : "0"}|${clustersSignature}`;

    return this.executeRenderPipeline(
      documentId,
      session,
      provider,
      styleFile,
      bibliographyFiles,
      parsedDocument,
      options,
      cacheSignature
    );
  }

  /**
   * Invalidates provider cache across all sessions when citation provider changes.
   * Disposes each tracked document through its owning provider and notifies subscribers.
   */
  invalidateProvider(): void {
    if (this.disposed) return;
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
    if (this.disposed) return;
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
    if (this.disposed) return;
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
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterRegistryListener();
    const docIds = Array.from(this.sessions.keys());
    for (const docId of docIds) {
      this.dropSession(docId);
    }
    this.invalidationListeners.clear();
  }
}
