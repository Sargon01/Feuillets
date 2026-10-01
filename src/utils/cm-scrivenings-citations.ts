import { Decoration, ViewPlugin } from "@codemirror/view";
import { normalizePath, TFolder, type App, type TFile } from "obsidian";
import {
  appendLineDecorations,
  areCitationSequencesSemanticallyEqual,
  CslCitationWidget,
  selectionOverlaps,
} from "./cm-pandoc-citation-live-preview.js";
import {
  compositeScriveningsFormatting,
  scriveningsSegmentRanges,
  type ScriveningsSegmentRange,
} from "./cm-scrivenings-markdown.js";
import {
  getSyncPandocCitationCatalog,
  registerPandocCitationCatalogView,
  resolvePandocCitationPreviewForFile,
  unregisterPandocCitationCatalogView,
} from "../services/pandoc-citation-preview.js";
import type {
  CslCitationHost,
  CslHostInvalidation,
  CslHostReadySnapshot,
  CslHostSnapshot,
} from "../services/csl-citation-host.js";
import {
  buildScriveningsCslDocument,
  type ScriveningsCslDocument,
} from "../services/scrivenings-csl-document.js";
import { resolveScriveningsCslResources } from "../services/scrivenings-csl-resources.js";
import type {
  ScriveningsDocument,
  ScriveningsSegment,
} from "../services/scrivenings-document.js";
import type { CitationClusterInput } from "../api/citation-contract.js";
import type { RenderedCitation } from "../api/citation-engine.js";

/**
 * Pandoc citation rendering for Continu:
 * - Author-date: [@smith2024] -> "(Smith, 2024)" via PandocCitationWidget
 * - Native CSL: whole-document citation processing through CslCitationHost,
 *   decorating visible citations via CslCitationWidget without altering Markdown text.
 */

type DecorationRange = { from: number; to: number };
type DecorationSet = unknown;
interface ReplaceSpec {
  widget: unknown;
  inclusive?: boolean;
}
interface DecorationStatic {
  none: DecorationSet;
  replace(spec: ReplaceSpec): { range(from: number, to: number): DecorationRange };
  set(ranges: DecorationRange[], sort?: boolean): DecorationSet;
}
const DecorationTyped = Decoration as DecorationStatic;

interface EditorSelectionRange {
  from: number;
  to: number;
}
interface EditorSelectionLike {
  ranges: readonly EditorSelectionRange[];
}
interface EditorLineLike {
  from: number;
  to: number;
  text: string;
}
interface EditorDocLike {
  length: number;
  lineAt(pos: number): EditorLineLike;
  sliceString(from: number, to?: number): string;
  toString?(): string;
}
interface EditorStateLike {
  doc: EditorDocLike;
  selection: EditorSelectionLike;
  field<T>(field: unknown, required?: boolean): T | undefined;
}
interface EditorViewInstance {
  state: EditorStateLike;
  visibleRanges?: ReadonlyArray<{ from: number; to: number }>;
  dispatch(spec: Record<string, unknown>): void;
  dom: HTMLElement;
}
interface ViewUpdateLike {
  view: EditorViewInstance;
  docChanged?: boolean;
  selectionSet?: boolean;
  viewportChanged?: boolean;
}
interface ViewPluginStatic {
  fromClass<T>(
    cls: new (view: EditorViewInstance) => T,
    spec?: { decorations?: (value: T) => unknown }
  ): unknown;
}
const ViewPluginTyped = ViewPlugin as ViewPluginStatic;

export interface ScriveningsCslContext {
  document: ScriveningsDocument;
  projectRoot: TFolder;
  getHost: () => CslCitationHost | null;
}

/** A segment range still worth decorating this redraw, paired with the real file it belongs to. */
function segmentsInVisibleRanges(
  segments: readonly ScriveningsSegmentRange[],
  files: readonly TFile[],
  visibleRanges: readonly { from: number; to: number }[]
): { range: ScriveningsSegmentRange; file: TFile }[] {
  const result: { range: ScriveningsSegmentRange; file: TFile }[] = [];
  segments.forEach((range, index) => {
    const file = files[index];
    if (!file) return;
    if (!visibleRanges.some((visible) => range.from <= visible.to && range.to >= visible.from)) return;
    result.push({ range, file });
  });
  return result;
}

type BuildResult = { decorations: DecorationSet; bibliographyPaths: ReadonlySet<string> };

function buildScriveningsCitationDecorations(
  view: EditorViewInstance,
  boundariesField: unknown,
  app: App,
  getSettings: () => FeuilletsSettings,
  files: readonly TFile[]
): BuildResult {
  const none = { decorations: DecorationTyped?.none ?? [], bibliographyPaths: new Set<string>() };
  if (typeof DecorationTyped?.set !== "function" || !view.visibleRanges || !view.state?.doc) return none;

  const boundaries = view.state.field<number[]>(boundariesField, false) ?? [];
  const ranges = scriveningsSegmentRanges(boundaries, view.state.doc.length);
  const visibleSegments = segmentsInVisibleRanges(ranges, files, view.visibleRanges);
  if (visibleSegments.length === 0) return none;

  const settings = getSettings();
  const bibliographyPaths = new Set<string>();
  const decos: DecorationRange[] = [];

  for (const { range, file } of visibleSegments) {
    const { style, bibliographyPath } = resolvePandocCitationPreviewForFile(app, settings, file);
    if (style !== "author-date" || !bibliographyPath) continue;
    bibliographyPaths.add(normalizePath(bibliographyPath));

    const catalog = getSyncPandocCitationCatalog(app, style, bibliographyPath);
    if (!catalog) continue;

    const segmentText = view.state.doc.sliceString(range.from, range.to);
    const codeRanges = compositeScriveningsFormatting(range, segmentText).codeRanges;
    const isProtected = (from: number, to: number): boolean =>
      codeRanges.some((code) => from < code.to && to > code.from);

    let pos = range.from;
    while (pos <= range.to) {
      const line = view.state.doc.lineAt(pos);
      appendLineDecorations(line, view.state, catalog, decos, isProtected);
      pos = line.to + 1;
    }
  }

  return { decorations: DecorationTyped.set(decos, true), bibliographyPaths };
}

let nextScriveningsViewSeq = 1;

function citationClustersSemanticKey(clusters: readonly CitationClusterInput[]): string {
  return clusters
    .map((c) =>
      `[${c.noteIndex ?? ""}:` +
      c.items
        .map(
          (it) =>
            `${it.id}:${it.mode ?? "normal"}:${it.locator ?? ""}:${it.label ?? ""}:${it.prefix ?? ""}:${it.suffix ?? ""}`
        )
        .join(",") +
      "]"
    )
    .join(";");
}

export function createScriveningsCitationExtension(
  boundariesField: unknown,
  app: App,
  getSettings: () => FeuilletsSettings,
  files: readonly TFile[],
  cslContext?: ScriveningsCslContext
): unknown {
  if (typeof ViewPluginTyped?.fromClass !== "function") return [];

  return ViewPluginTyped.fromClass(
    class {
      decorations: DecorationSet;
      private view: EditorViewInstance;
      private registeredPaths: ReadonlySet<string> = new Set();

      // CSL state
      private readonly viewSeq = nextScriveningsViewSeq++;
      private currentDocumentId: string | null = null;
      private readySnapshot: CslHostReadySnapshot | null = null;
      private readyCslDoc: ScriveningsCslDocument | null = null;
      private lastDocText: string | null = null;
      private lastRequestedSemanticSignature: string | null = null;
      private requestGeneration = 0;
      private debounceTimer: number | null = null;
      private unsubscribeHostInvalidation: (() => void) | null = null;
      private destroyed = false;
      private liveDocumentWasReady = false;
      private initialRenderRequested = false;

      constructor(view: EditorViewInstance) {
        this.view = view;
        this.decorations = DecorationTyped?.none ?? [];
        this.lastDocText = view.state?.doc ? view.state.doc.sliceString(0, view.state.doc.length) : null;
        this.initCslSession();
        this.rebuild();
      }

      private initCslSession(): void {
        const isCsl = this.isCslModeActive();
        if (!isCsl || !cslContext) return;

        this.ensureHostSubscription();
        if (!this.currentDocumentId) {
          this.currentDocumentId = `scrivenings:${this.viewSeq}:${normalizePath(cslContext.projectRoot.path)}`;
        }
        const liveDoc = this.getLiveDocument();
        if (liveDoc) {
          this.liveDocumentWasReady = true;
          this.initialRenderRequested = true;
          this.scheduleCslRender(0, "initial");
        }
      }

      update(update: ViewUpdateLike): void {
        this.view = update.view;
        const isCsl = this.isCslModeActive();

        if (isCsl) {
          const liveDoc = this.getLiveDocument();

          if (!liveDoc) {
            this.liveDocumentWasReady = false;
            if (this.readySnapshot !== null || this.decorations !== DecorationTyped.none) {
              this.readySnapshot = null;
              this.readyCslDoc = null;
              this.lastRequestedSemanticSignature = null;
              this.decorations = DecorationTyped.none;
            }
            this.rebuild();
            return;
          }

          if (!this.liveDocumentWasReady) {
            this.liveDocumentWasReady = true;
            if (!this.initialRenderRequested) {
              this.initialRenderRequested = true;
              this.ensureHostSubscription();
              if (!this.currentDocumentId && cslContext) {
                this.currentDocumentId = `scrivenings:${this.viewSeq}:${normalizePath(cslContext.projectRoot.path)}`;
              }
              const currentDocText = this.view.state?.doc
                ? this.view.state.doc.sliceString(0, this.view.state.doc.length)
                : "";
              this.lastDocText = currentDocText;
              this.scheduleCslRender(0, "initial-boundaries-ready");
              this.rebuild();
              return;
            }
          }

          const currentDocText = this.view.state?.doc
            ? this.view.state.doc.sliceString(0, this.view.state.doc.length)
            : "";
          const docTextChanged =
            update.docChanged === true ||
            (this.lastDocText !== null && currentDocText !== this.lastDocText);

          if (docTextChanged) {
            this.lastDocText = currentDocText;
            const cslDoc = buildScriveningsCslDocument(liveDoc);

            const canReuseSnapshot =
              this.readySnapshot !== null &&
              this.readyCslDoc !== null &&
              areCitationSequencesSemanticallyEqual(
                cslDoc.clusters,
                this.readySnapshot.parsedDocument.clusters
              );

            if (canReuseSnapshot) {
              if (this.debounceTimer !== null) {
                window.clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
              }
            } else {
              this.readySnapshot = null;
              this.readyCslDoc = null;
              this.decorations = DecorationTyped.none;
              this.scheduleCslRender(150, "semantic-change");
            }
          }
          this.rebuild();
        } else {
          this.rebuild();
        }
      }

      destroy(): void {
        this.destroyed = true;
        this.cleanupCslSession();
        for (const path of this.registeredPaths) {
          unregisterPandocCitationCatalogView(path, this.view);
        }
        this.registeredPaths = new Set();
      }

      private isCslModeActive(): boolean {
        if (!cslContext) return false;
        const settings = getSettings();
        for (const file of files) {
          const { style } = resolvePandocCitationPreviewForFile(app, settings, file);
          if (style === "csl") return true;
        }
        return false;
      }

      private ensureHostSubscription(): CslCitationHost | null {
        const host = cslContext?.getHost() ?? null;
        if (host && !this.unsubscribeHostInvalidation) {
          this.unsubscribeHostInvalidation = host.onInvalidation((invalidation) => {
            this.handleHostInvalidation(invalidation);
          });
        }
        return host;
      }

      private handleHostInvalidation(invalidation: CslHostInvalidation): void {
        if (this.destroyed) return;
        const isAffected =
          invalidation.documentIds === null ||
          (this.currentDocumentId !== null && invalidation.documentIds.has(this.currentDocumentId));
        if (isAffected) {
          this.readySnapshot = null;
          this.readyCslDoc = null;
          this.lastRequestedSemanticSignature = null;
          this.decorations = DecorationTyped.none;
          this.scheduleCslRender(0, "invalidation");
        }
      }

      private cleanupCslSession(): void {
        if (this.debounceTimer !== null) {
          window.clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        if (this.unsubscribeHostInvalidation) {
          this.unsubscribeHostInvalidation();
          this.unsubscribeHostInvalidation = null;
        }
        if (this.currentDocumentId) {
          const host = cslContext?.getHost();
          if (host) {
            host.disposeDocument(this.currentDocumentId);
          }
          this.currentDocumentId = null;
        }
        this.readySnapshot = null;
        this.readyCslDoc = null;
        this.lastRequestedSemanticSignature = null;
        this.lastDocText = null;
        this.liveDocumentWasReady = false;
        this.initialRenderRequested = false;
      }

      private getLiveDocument(): ScriveningsDocument | null {
        if (!cslContext) return null;
        const mountedDoc = cslContext.document;
        const N = mountedDoc.segments.length;
        const boundaries = this.view.state.field<number[]>(boundariesField, false) ?? [];
        const ranges = scriveningsSegmentRanges(boundaries, this.view.state.doc.length);
        if (ranges.length !== N) {
          return null;
        }

        const liveSegments: ScriveningsSegment[] = [];
        for (let i = 0; i < N; i++) {
          const range = ranges[i];
          const mountedSegment = mountedDoc.segments[i];
          liveSegments.push({
            file: mountedSegment.file,
            path: mountedSegment.path,
            frontmatter: mountedSegment.frontmatter,
            from: range.from,
            to: range.to,
            body: this.view.state.doc.sliceString(range.from, range.to),
          });
        }

        return {
          text: this.view.state.doc.sliceString(0, this.view.state.doc.length),
          segments: liveSegments,
        };
      }

      private scheduleCslRender(delayMs: number, _reason = "unknown"): void {
        if (this.destroyed) return;
        if (this.debounceTimer !== null) {
          window.clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }

        const run = async (): Promise<void> => {
          this.debounceTimer = null;
          if (this.destroyed || !cslContext) return;

          const host = this.ensureHostSubscription();
          if (!host) {
            this.failClosed();
            return;
          }

          const projectRoot = cslContext.projectRoot;
          if (!projectRoot || !(projectRoot instanceof TFolder)) {
            this.failClosed();
            return;
          }

          const liveDoc = this.getLiveDocument();
          if (!liveDoc) {
            this.failClosed();
            return;
          }

          const cslDoc = buildScriveningsCslDocument(liveDoc);

          if (cslDoc.occurrences.length === 0) {
            if (this.currentDocumentId) {
              host.disposeDocument(this.currentDocumentId);
            }
            const hadDecorations =
              this.readySnapshot !== null || this.decorations !== DecorationTyped.none;
            this.readySnapshot = null;
            this.readyCslDoc = null;
            this.lastRequestedSemanticSignature = null;
            this.decorations = DecorationTyped.none;
            if (hadDecorations) {
              try {
                this.view.dispatch({});
              } catch {
                // Swallowed
              }
            }
            return;
          }

          const signature = citationClustersSemanticKey(cslDoc.clusters);
          if (
            this.readySnapshot !== null &&
            this.lastRequestedSemanticSignature === signature &&
            areCitationSequencesSemanticallyEqual(
              cslDoc.clusters,
              this.readySnapshot.parsedDocument.clusters
            )
          ) {
            return;
          }

          const settings = getSettings();
          const res = resolveScriveningsCslResources(app, settings, projectRoot, liveDoc, cslDoc);
          if (res.status !== "ready") {
            this.failClosed();
            return;
          }

          const documentId = this.currentDocumentId;
          if (!documentId) return;

          const generation = ++this.requestGeneration;
          this.lastRequestedSemanticSignature = signature;

          let snapshot: CslHostSnapshot;
          try {
            snapshot = await host.renderPreparedDocument(
              documentId,
              cslDoc,
              res.styleFile,
              res.bibliographyFiles,
              { includeBibliography: false }
            );
          } catch {
            if (
              this.destroyed ||
              generation !== this.requestGeneration ||
              this.currentDocumentId !== documentId
            ) {
              return;
            }
            this.failClosed();
            return;
          }

          if (
            this.destroyed ||
            generation !== this.requestGeneration ||
            this.currentDocumentId !== documentId
          ) {
            return;
          }

          if (snapshot.status === "ready") {
            const hasError = snapshot.result.diagnostics?.some((d) => d.severity === "error") ?? false;
            if (hasError) {
              this.failClosed();
              return;
            }

            if (snapshot.result.citations.length !== cslDoc.occurrences.length) {
              this.failClosed();
              return;
            }

            for (const occ of cslDoc.occurrences) {
              if (!snapshot.citationByClusterId.has(occ.clusterId)) {
                this.failClosed();
                return;
              }
            }

            const currentLive = this.getLiveDocument();
            if (!currentLive) {
              this.failClosed();
              return;
            }
            const currentCsl = buildScriveningsCslDocument(currentLive);
            const isSemanticallyEqual = areCitationSequencesSemanticallyEqual(
              currentCsl.clusters,
              snapshot.parsedDocument.clusters
            );

            if (isSemanticallyEqual) {
              this.readySnapshot = snapshot;
              this.readyCslDoc = currentCsl;
              this.decorations = this.buildCslDecorations();
              try {
                this.view.dispatch({});
              } catch {
                // Swallowed
              }
            }
          } else {
            this.failClosed();
          }
        };

        if (delayMs <= 0) {
          void run();
        } else {
          this.debounceTimer = window.setTimeout(() => {
            void run();
          }, delayMs);
        }
      }

      private failClosed(): void {
        const hadDecorations =
          this.readySnapshot !== null || this.decorations !== DecorationTyped.none;
        this.readySnapshot = null;
        this.readyCslDoc = null;
        this.lastRequestedSemanticSignature = null;
        this.decorations = DecorationTyped.none;
        if (hadDecorations) {
          try {
            this.view.dispatch({});
          } catch {
            // Swallowed
          }
        }
      }

      private buildCslDecorations(): DecorationSet {
        if (typeof DecorationTyped?.set !== "function" || !this.view.visibleRanges || !this.view.state?.doc) {
          return DecorationTyped?.none ?? [];
        }

        if (!this.readySnapshot || !this.readyCslDoc) {
          return DecorationTyped.none;
        }

        const liveDoc = this.getLiveDocument();
        if (!liveDoc) return DecorationTyped.none;

        const currentCslDoc = buildScriveningsCslDocument(liveDoc);
        if (!areCitationSequencesSemanticallyEqual(currentCslDoc.clusters, this.readySnapshot.parsedDocument.clusters)) {
          return DecorationTyped.none;
        }

        const decos: DecorationRange[] = [];
        const visibleRanges = this.view.visibleRanges;
        const selection = this.view.state.selection;
        const occurrences = currentCslDoc.occurrences;
        const oldOccurrences = this.readySnapshot.parsedDocument.occurrences;
        const citationByClusterId = this.readySnapshot.citationByClusterId;

        for (let i = 0; i < occurrences.length; i++) {
          const occ = occurrences[i];
          if (occ.from >= occ.to) continue;

          let isVisible = false;
          for (const range of visibleRanges) {
            if (occ.from <= range.to && occ.to >= range.from) {
              isVisible = true;
              break;
            }
          }
          if (!isVisible) continue;

          if (selectionOverlaps(selection, occ.from, occ.to)) continue;

          const oldClusterId = oldOccurrences[i]?.clusterId;
          const oldCitation = oldClusterId ? citationByClusterId.get(oldClusterId) : undefined;
          if (!oldCitation) continue;

          const projectedCitation: RenderedCitation =
            oldCitation.clusterId === occ.clusterId
              ? oldCitation
              : { ...oldCitation, clusterId: occ.clusterId };

          decos.push(
            DecorationTyped.replace({
              widget: new CslCitationWidget(occ.clusterId, projectedCitation),
              inclusive: false,
            }).range(occ.from, occ.to)
          );
        }

        return DecorationTyped.set(decos, true);
      }

      private rebuild(): void {
        if (this.destroyed) return;
        if (typeof DecorationTyped?.set !== "function" || !this.view.visibleRanges || !this.view.state?.doc) {
          this.decorations = DecorationTyped?.none ?? [];
          return;
        }

        const isCsl = this.isCslModeActive();

        if (isCsl) {
          if (this.registeredPaths.size > 0) {
            for (const path of this.registeredPaths) {
              unregisterPandocCitationCatalogView(path, this.view);
            }
            this.registeredPaths = new Set();
          }

          if (cslContext) {
            this.ensureHostSubscription();
            if (!this.currentDocumentId) {
              this.currentDocumentId = `scrivenings:${this.viewSeq}:${normalizePath(cslContext.projectRoot.path)}`;
            }
          }

          this.decorations = this.buildCslDecorations();
          return;
        }

        // Author-date legacy path
        this.cleanupCslSession();

        const result = buildScriveningsCitationDecorations(this.view, boundariesField, app, getSettings, files);
        this.decorations = result.decorations;

        for (const path of this.registeredPaths) {
          if (!result.bibliographyPaths.has(path)) unregisterPandocCitationCatalogView(path, this.view);
        }
        for (const path of result.bibliographyPaths) {
          if (!this.registeredPaths.has(path)) registerPandocCitationCatalogView(path, this.view);
        }
        this.registeredPaths = result.bibliographyPaths;
      }
    },
    { decorations: (value: { decorations: DecorationSet }) => value.decorations }
  );
}
