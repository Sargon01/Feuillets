import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { editorInfoField, editorLivePreviewField, normalizePath, TFile, type App } from "obsidian";
import {
  buildCitationNoticeLines,
  buildPandocCitationElement,
  createPandocCitationSpan,
  disposePandocCitationElement,
  getSyncPandocCitationCatalog,
  registerPandocCitationCatalogView,
  resolvePandocCitationPreviewForFile,
  splitPandocCitationSegments,
  unregisterPandocCitationCatalogView,
  type PandocCitationCatalog,
} from "../services/pandoc-citation-preview.js";
import type { BibtexCatalogEntry } from "../services/bibtex-catalog.js";
import { getProjectFolder } from "../services/folder-structure.js";
import type {
  CslCitationHost,
  CslHostInvalidation,
  CslHostReadySnapshot,
  CslHostSnapshot,
} from "../services/csl-citation-host.js";
import type { RenderedCitation } from "../api/citation-contract.js";
import { renderCitationNodes } from "../services/citation-render-nodes.js";

/** Re-exported for existing callers (main.ts, tests): the synchronous cache
 * and view registry this module registers into now live in
 * pandoc-citation-preview.ts, shared with Continu's own citation extension
 * (cm-scrivenings-citations.ts) — see that module's doc comment. */
export { notifyPandocCitationBibliographyChanged } from "../services/pandoc-citation-preview.js";

/** Debounce time for whole-document CSL rendering on typing (Lot 7B). */
export const CSL_LIVE_PREVIEW_DEBOUNCE_MS = 150;

/**
 * Live Preview folding of Pandoc citekeys:
 * - Legacy author-date: [@smith2024] → (Smith, 2024) via PandocCitationWidget
 * - Native CSL: whole-document citation processing through CslCitationHost,
 *   decorating visible citations via CslCitationWidget without touching Markdown source on disk.
 *
 * File and scope resolution never assume a single globally active file: the
 * editor this ViewPlugin instance belongs to is read from `editorInfoField`
 * (Obsidian's own per-editor StateField), and that file — not any other pane's
 * file — is what resolves citations. Two panes open on siblings or the same file
 * maintain independent session state.
 *
 * Source mode (editorLivePreviewField === false) never folds anything: raw
 * citekeys stay visible there, exactly like the Markdown source on disk.
 *
 * Cursor-reveal: a citation whose source range overlaps any selection range is
 * left undecorated for that redraw, so the raw syntax becomes visible and editable
 * the moment the cursor enters it, and refolds when the cursor leaves.
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

interface SyntaxTreeIteratableNode {
  name: string;
}
interface SyntaxTreeResolvedNode {
  name: string;
  parent: SyntaxTreeResolvedNode | null;
}
interface IteratableSyntaxTree {
  iterate(spec: { from: number; to: number; enter(node: SyntaxTreeIteratableNode): boolean | void }): void;
  resolveInner?(pos: number, side?: number): SyntaxTreeResolvedNode | null;
}
const syntaxTreeTyped = syntaxTree as unknown as (state: unknown) => IteratableSyntaxTree | null;

/** True when `[from, to)` overlaps a node whose name contains "code". */
function isRangeInsideCode(state: unknown, from: number, to: number): boolean {
  const tree = typeof syntaxTreeTyped === "function" ? syntaxTreeTyped(state) : null;
  if (!tree) return false;

  let excluded = false;
  if (typeof tree.iterate === "function") {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name.toLowerCase().includes("code")) {
          excluded = true;
          return false;
        }
      },
    });
  }
  if (!excluded && typeof tree.resolveInner === "function") {
    let curr = tree.resolveInner(from, 1);
    while (curr) {
      if (curr.name.toLowerCase().includes("code")) {
        excluded = true;
        break;
      }
      curr = curr.parent;
    }
  }
  return excluded;
}

interface WidgetTypeInstance {
  eq(other: unknown): boolean;
  toDOM(view: EditorViewInstance): HTMLElement;
  ignoreEvent(event?: Event): boolean;
}
interface WidgetTypeStatic {
  new (...args: unknown[]): WidgetTypeInstance;
}
const WidgetTypeTyped = WidgetType as unknown as WidgetTypeStatic;

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
  lineAt(pos: number): EditorLineLike;
  toString?(): string;
  length?: number;
}
interface EditorStateLike {
  doc: EditorDocLike;
  selection: EditorSelectionLike;
  field<T>(field: unknown, required?: boolean): T | undefined;
}
interface EditorInfoLike {
  app: App;
  file: TFile | null;
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

function noticeSignatureFor(
  citekeys: readonly string[],
  records: ReadonlyMap<string, BibtexCatalogEntry>
): string {
  return citekeys
    .map((key) => {
      const entry = records.get(key);
      return entry ? buildCitationNoticeLines(entry).join("\n") : "";
    })
    .join("\n\u0000\n");
}

/** Legacy author-date preview widget carrying a fully built citation element (label + notice). */
export class PandocCitationWidget extends WidgetTypeTyped {
  private readonly noticeSignature: string;

  constructor(
    readonly text: string,
    readonly citekeys: readonly string[],
    readonly records: ReadonlyMap<string, BibtexCatalogEntry>
  ) {
    super();
    this.noticeSignature = noticeSignatureFor(citekeys, records);
  }

  eq(other: PandocCitationWidget): boolean {
    return (
      other instanceof PandocCitationWidget &&
      this.text === other.text &&
      this.citekeys.join(",") === other.citekeys.join(",") &&
      this.noticeSignature === other.noticeSignature
    );
  }

  toDOM(view: EditorViewInstance): HTMLElement {
    return buildPandocCitationElement(this.text, this.citekeys, this.records, view.dom.ownerDocument);
  }

  ignoreEvent(): boolean {
    return false;
  }

  destroy(dom: HTMLElement): void {
    disposePandocCitationElement(dom);
  }
}

/** CSL Live Preview widget rendering CitationRenderNode AST. */
export class CslCitationWidget extends WidgetTypeTyped {
  private readonly signature: string;

  constructor(
    readonly clusterId: string,
    readonly citation: RenderedCitation
  ) {
    super();
    this.signature = `${citation.plainText}\u0000${JSON.stringify(citation.content)}`;
  }

  eq(other: unknown): boolean {
    return (
      other instanceof CslCitationWidget &&
      this.clusterId === other.clusterId &&
      this.signature === other.signature
    );
  }

  toDOM(view: EditorViewInstance): HTMLElement {
    const ownerDoc = view.dom.ownerDocument;
    const span = createPandocCitationSpan(ownerDoc, "feuillets-csl-citation");
    renderCitationNodes(this.citation.content, span, ownerDoc);
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Safely extracts text source from EditorDocLike. */
function getDocumentSource(doc: EditorDocLike): string {
  if (typeof doc?.toString === "function") {
    const str = doc.toString();
    if (str !== "[object Object]") {
      return str;
    }
  }
  return "";
}

/** Exported for reuse: true when selection overlaps `[from, to]`. */
export function selectionOverlaps(selection: EditorSelectionLike, from: number, to: number): boolean {
  for (const range of selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

/** Recognizes and decorates citations on one line for legacy author-date preview. */
export function appendLineDecorations(
  line: EditorLineLike,
  state: EditorStateLike,
  catalog: PandocCitationCatalog,
  decos: DecorationRange[],
  isProtected?: (absFrom: number, absTo: number) => boolean
): void {
  const segments = splitPandocCitationSegments(line.text, catalog.entries, { narrative: true });
  for (const segment of segments) {
    if (segment.kind !== "citation") continue;
    const absFrom = line.from + segment.start;
    const absTo = line.from + segment.end;
    if (absFrom >= absTo) continue;
    if (selectionOverlaps(state.selection, absFrom, absTo)) continue;
    if (isProtected?.(absFrom, absTo)) continue;
    decos.push(
      DecorationTyped.replace({
        widget: new PandocCitationWidget(segment.text, segment.citekeys, catalog.records),
        inclusive: false,
      }).range(absFrom, absTo)
    );
  }
}

type BuildResult = { decorations: DecorationSet; bibliographyPath: string | null };

/** Legacy author-date decoration builder. */
function buildLegacyDecorations(view: EditorViewInstance, getSettings: () => FeuilletsSettings): BuildResult {
  if (typeof DecorationTyped?.set !== "function" || !view.visibleRanges || !view.state?.doc) {
    return { decorations: DecorationTyped?.none ?? [], bibliographyPath: null };
  }

  const livePreview = view.state.field<boolean>(editorLivePreviewField, false);
  if (livePreview === false) return { decorations: DecorationTyped.none, bibliographyPath: null };

  const info = view.state.field<EditorInfoLike>(editorInfoField, false);
  const file = info?.file ?? null;
  if (!info || !file) return { decorations: DecorationTyped.none, bibliographyPath: null };

  const { style, bibliographyPath } = resolvePandocCitationPreviewForFile(info.app, getSettings(), file);
  if (style !== "author-date" || !bibliographyPath) return { decorations: DecorationTyped.none, bibliographyPath: null };
  const normalizedPath = normalizePath(bibliographyPath);

  const catalog = getSyncPandocCitationCatalog(info.app, style, bibliographyPath);
  if (!catalog) return { decorations: DecorationTyped.none, bibliographyPath: normalizedPath };

  const isProtected = (rangeFrom: number, rangeTo: number): boolean => isRangeInsideCode(view.state, rangeFrom, rangeTo);

  const decos: DecorationRange[] = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      appendLineDecorations(line, view.state, catalog, decos, isProtected);
      pos = line.to + 1;
    }
  }

  return { decorations: DecorationTyped.set(decos, true), bibliographyPath: normalizedPath };
}

let nextLivePreviewViewSeq = 1;

/**
 * Builds the Live Preview extension.
 * Supports legacy author-date preview and native CSL preview through CslCitationHost.
 */
export function createPandocCitationLivePreviewExtension(
  getSettings: () => FeuilletsSettings,
  getCslHost?: () => CslCitationHost | null
): unknown {
  if (typeof ViewPluginTyped?.fromClass !== "function") return [];

  return ViewPluginTyped.fromClass(
    class {
      decorations: DecorationSet;
      private view: EditorViewInstance;
      private registeredPath: string | null = null;

      // Per-view CSL state
      private readonly viewSeq = nextLivePreviewViewSeq++;
      private currentDocumentId: string | null = null;
      private currentFilePath: string | null = null;
      private readySnapshot: CslHostReadySnapshot | null = null;
      private readySource: string | null = null;
      private requestGeneration = 0;
      private debounceTimer: number | null = null;
      private unsubscribeHostInvalidation: (() => void) | null = null;
      private destroyed = false;

      constructor(view: EditorViewInstance) {
        this.view = view;
        this.decorations = DecorationTyped?.none ?? [];
        this.ensureHostSubscription();
        this.rebuild();
      }

      update(update: ViewUpdateLike): void {
        this.view = update.view;
        const livePreview = this.view.state.field<boolean>(editorLivePreviewField, false);
        const info = this.view.state.field<EditorInfoLike>(editorInfoField, false);
        const file = info?.file ?? null;

        if (livePreview === false || !info || !file) {
          this.rebuild();
          return;
        }

        const settings = getSettings();
        const { style } = resolvePandocCitationPreviewForFile(info.app, settings, file);
        if (style === "csl") {
          const currentDoc = getDocumentSource(this.view.state.doc);
          const docTextChanged =
            update.docChanged === true ||
            (this.readySource !== null && currentDoc !== this.readySource);
          if (docTextChanged) {
            this.scheduleCslRender(CSL_LIVE_PREVIEW_DEBOUNCE_MS);
          }
          this.rebuild();
        } else {
          this.rebuild();
        }
      }

      destroy(): void {
        this.destroyed = true;
        if (this.debounceTimer !== null) {
          window.clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        if (this.unsubscribeHostInvalidation) {
          this.unsubscribeHostInvalidation();
          this.unsubscribeHostInvalidation = null;
        }
        if (this.registeredPath) {
          unregisterPandocCitationCatalogView(this.registeredPath, this.view);
          this.registeredPath = null;
        }
        if (this.currentDocumentId) {
          const host = getCslHost?.();
          if (host) {
            host.disposeDocument(this.currentDocumentId);
          }
          this.currentDocumentId = null;
        }
        this.currentFilePath = null;
        this.readySnapshot = null;
        this.readySource = null;
      }

      private ensureHostSubscription(): CslCitationHost | null {
        const host = getCslHost?.() ?? null;
        if (host && !this.unsubscribeHostInvalidation) {
          this.unsubscribeHostInvalidation = host.onInvalidation((invalidation) => {
            this.handleHostInvalidation(invalidation);
          });
        }
        return host;
      }

      private handleHostInvalidation(invalidation: CslHostInvalidation): void {
        if (this.destroyed) return;
        if (
          invalidation.documentIds === null ||
          (this.currentDocumentId && invalidation.documentIds.has(this.currentDocumentId)) ||
          this.readySnapshot === null
        ) {
          this.readySnapshot = null;
          this.readySource = null;
          this.scheduleCslRender(0);
        }
      }

      private cleanupCslSession(): void {
        if (this.debounceTimer !== null) {
          window.clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        if (this.currentDocumentId) {
          const host = getCslHost?.();
          if (host) {
            host.disposeDocument(this.currentDocumentId);
          }
          this.currentDocumentId = null;
        }
        this.currentFilePath = null;
        this.readySnapshot = null;
        this.readySource = null;
      }

      private scheduleCslRender(delayMs: number): void {
        if (this.destroyed) return;
        if (this.debounceTimer !== null) {
          window.clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }

        const run = async (): Promise<void> => {
          this.debounceTimer = null;
          if (this.destroyed) return;

          const host = this.ensureHostSubscription();
          if (!host) {
            this.readySnapshot = null;
            this.readySource = null;
            this.decorations = DecorationTyped.none;
            try {
              this.view.dispatch({});
            } catch {
              // Ignore if view was closed
            }
            return;
          }

          const info = this.view.state.field<EditorInfoLike>(editorInfoField, false);
          const file = info?.file ?? null;
          if (!info || !file) return;

          const projectRoot = getProjectFolder(info.app, getSettings());
          if (!projectRoot) {
            this.readySnapshot = null;
            this.readySource = null;
            this.decorations = DecorationTyped.none;
            try {
              this.view.dispatch({});
            } catch {
              // Ignore if view was closed
            }
            return;
          }

          const documentId = this.currentDocumentId;
          if (!documentId) return;

          const source = getDocumentSource(this.view.state.doc);
          const generation = ++this.requestGeneration;

          let snapshot: CslHostSnapshot;
          try {
            snapshot = await host.renderDocument(documentId, source, projectRoot, file, {
              includeBibliography: false,
            });
          } catch {
            if (this.destroyed || generation !== this.requestGeneration || this.currentDocumentId !== documentId) {
              return;
            }
            this.readySnapshot = null;
            this.readySource = null;
            this.decorations = DecorationTyped.none;
            try {
              this.view.dispatch({});
            } catch {
              // Ignore if view was closed
            }
            return;
          }

          if (this.destroyed || generation !== this.requestGeneration || this.currentDocumentId !== documentId) {
            return;
          }

          const currentDoc = getDocumentSource(this.view.state.doc);
          if (currentDoc !== source) {
            return;
          }

          if (snapshot.status === "ready") {
            this.readySnapshot = snapshot;
            this.readySource = source;
            this.decorations = this.buildCslDecorations();
            try {
              this.view.dispatch({});
            } catch {
              // Ignore if view was closed
            }
          } else {
            this.readySnapshot = null;
            this.readySource = null;
            this.decorations = DecorationTyped.none;
            try {
              this.view.dispatch({});
            } catch {
              // Ignore if view was closed
            }
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

      private buildCslDecorations(): DecorationSet {
        if (typeof DecorationTyped?.set !== "function" || !this.view.visibleRanges || !this.view.state?.doc) {
          return DecorationTyped?.none ?? [];
        }

        const currentDoc = getDocumentSource(this.view.state.doc);
        if (!this.readySnapshot || this.readySource !== currentDoc) {
          return DecorationTyped.none;
        }

        const decos: DecorationRange[] = [];
        const visibleRanges = this.view.visibleRanges;
        const selection = this.view.state.selection;
        const occurrences = this.readySnapshot.parsedDocument.occurrences;
        const citationByClusterId = this.readySnapshot.citationByClusterId;

        for (const occ of occurrences) {
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

          const citation = citationByClusterId.get(occ.clusterId);
          if (!citation) continue;

          decos.push(
            DecorationTyped.replace({
              widget: new CslCitationWidget(occ.clusterId, citation),
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

        const livePreview = this.view.state.field<boolean>(editorLivePreviewField, false);
        const info = this.view.state.field<EditorInfoLike>(editorInfoField, false);
        const file = info?.file ?? null;

        if (livePreview === false || !info || !file) {
          this.cleanupCslSession();
          if (this.registeredPath) {
            unregisterPandocCitationCatalogView(this.registeredPath, this.view);
            this.registeredPath = null;
          }
          this.decorations = DecorationTyped.none;
          return;
        }

        const settings = getSettings();
        const { style } = resolvePandocCitationPreviewForFile(info.app, settings, file);

        if (style === "off") {
          this.cleanupCslSession();
          if (this.registeredPath) {
            unregisterPandocCitationCatalogView(this.registeredPath, this.view);
            this.registeredPath = null;
          }
          this.decorations = DecorationTyped.none;
          return;
        }

        if (style === "csl") {
          if (this.registeredPath) {
            unregisterPandocCitationCatalogView(this.registeredPath, this.view);
            this.registeredPath = null;
          }

          this.ensureHostSubscription();

          const normalizedFilePath = normalizePath(file.path);
          if (this.currentFilePath !== normalizedFilePath) {
            this.cleanupCslSession();
            this.currentFilePath = normalizedFilePath;
            this.currentDocumentId = `live-preview:${this.viewSeq}:${normalizedFilePath}`;
            this.scheduleCslRender(0);
          } else if (!this.currentDocumentId) {
            this.currentFilePath = normalizedFilePath;
            this.currentDocumentId = `live-preview:${this.viewSeq}:${normalizedFilePath}`;
            this.scheduleCslRender(0);
          }

          this.decorations = this.buildCslDecorations();
          return;
        }

        // style === "author-date" (Legacy path)
        this.cleanupCslSession();

        const result = buildLegacyDecorations(this.view, getSettings);
        this.decorations = result.decorations;
        if (result.bibliographyPath !== this.registeredPath) {
          unregisterPandocCitationCatalogView(this.registeredPath, this.view);
          this.registeredPath = result.bibliographyPath;
          if (this.registeredPath) registerPandocCitationCatalogView(this.registeredPath, this.view);
        }
      }
    },
    {
      decorations: (v: { decorations: DecorationSet }) => v.decorations,
    }
  );
}
