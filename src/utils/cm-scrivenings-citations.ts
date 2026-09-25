import { Decoration, ViewPlugin } from "@codemirror/view";
import { normalizePath, type App, type TFile } from "obsidian";
import { appendLineDecorations } from "./cm-pandoc-citation-live-preview.js";
import { compositeScriveningsFormatting, scriveningsSegmentRanges, type ScriveningsSegmentRange } from "./cm-scrivenings-markdown.js";
import {
  getSyncPandocCitationCatalog,
  registerPandocCitationCatalogView,
  resolvePandocCitationPreviewForFile,
  unregisterPandocCitationCatalogView,
} from "../services/pandoc-citation-preview.js";

/**
 * Pandoc citation rendering for Continu — `[@smith2024]` → "(Smith, 2024)"
 * and the narrative `@smith2024` → "Smith (2024)", as the exact same editable
 * widget as Live Preview and the exact same wrapped element as Reading Mode.
 * This module adds NO second recognition/formatting/notice engine: it only
 * figures out, for each composite offset, WHICH real file (and therefore
 * which resolved bibliography) applies, then hands the actual work to the
 * shared primitives from cm-pandoc-citation-live-preview.ts
 * (appendLineDecorations(), PandocCitationWidget, selectionOverlaps()) and
 * pandoc-citation-preview.ts (resolvePandocCitationPreviewForFile(), the
 * shared synchronous catalog cache, splitPandocCitationSegments() itself).
 *
 * Continu's single composite EditorView spans SEVERAL real files, possibly
 * with DIFFERENT resolved bibliographies (different Project/Espace or
 * Work-A/Work-A-Extra scopes) — the one thing Live Preview's single-file
 * extension never has to handle. The composite text is therefore walked
 * SEGMENT BY SEGMENT (`scriveningsSegmentRanges`, cm-scrivenings-markdown.ts
 * — the same helper the markdown/image layer uses), each segment resolving
 * its own bibliography from its OWN file — never from `getActiveFile()`, and
 * never leaking one segment's scope into another's.
 *
 * `files` is the list of real files backing the composite document, in
 * SEGMENT ORDER — captured once when the caller mounts this extension
 * (scrivenings-view.ts#mountEditor(), which rebuilds a fresh extensions array
 * on every recomposition). Membership never changes without a full remount
 * (toggleMember()/addMembers() both go through openScope() → mountEditor()),
 * so pairing `scriveningsSegmentRanges(boundaries, docLength)[i]` with
 * `files[i]` by index stays correct for the whole lifetime of one mount, even
 * as typing shifts every segment's from/to — `boundariesField` itself is kept
 * in sync with the live document by CodeMirror's own position-mapping (see
 * `scriveningsBoundariesField.update()`, cm-scrivenings.ts), so this never
 * needs a second, potentially stale, copy of segment boundaries.
 *
 * `boundariesField` is PASSED IN, never imported — same "SENS DE DÉPENDANCE"
 * rule as cm-scrivenings-markdown.ts: cm-scrivenings.ts imports this module,
 * so this module must never import back from cm-scrivenings.ts.
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
}
interface ViewUpdateLike {
  view: EditorViewInstance;
}
interface ViewPluginStatic {
  fromClass<T>(
    cls: new (view: EditorViewInstance) => T,
    spec?: { decorations?: (value: T) => unknown }
  ): unknown;
}
const ViewPluginTyped = ViewPlugin as ViewPluginStatic;

/** A segment range still worth decorating THIS redraw (overlaps at least one
 * visible range — see scriveningsSegmentsInRanges(), cm-scrivenings-markdown.ts,
 * same "keep a partially-visible segment whole, never scan the whole
 * manuscript" rule), paired with the real file it belongs to. */
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

/**
 * `bibliographyPaths` is every normalized bibliography path a CURRENTLY
 * VISIBLE segment resolves to, independently of whether a catalog was
 * actually available for it on THIS pass (a load still in flight, or style
 * "off" for one segment while another resolves fine) — the caller registers
 * the view under exactly this set, so a later load or bibliography edit
 * still wakes it. A segment that scrolls OUT of view is simply dropped from
 * the set on the next rebuild (that rebuild is itself triggered by the
 * viewportChanged this scroll produces) — never a case that needs its own
 * cleanup here.
 */
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
    if (style === "off" || !bibliographyPath) continue;
    bibliographyPaths.add(normalizePath(bibliographyPath));

    const catalog = getSyncPandocCitationCatalog(app, style, bibliographyPath);
    if (!catalog) continue;

    // Reuses the SAME per-segment Lezer parse cm-scrivenings-markdown.ts's
    // own rendering plugin already runs for this segment on this redraw
    // (parseScriveningsSegmentFormattingCached() is keyed by segment TEXT,
    // so this call is a cache hit, never a second parser instance) — the
    // `codeRanges` it exposes is how Continu gets the same "never fold a
    // citation inside code" guarantee Live Preview gets from its CM6
    // language `syntaxTree` (which Continu's own composite EditorState does
    // not have — see that module's isRangeInsideCode() doc comment).
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

/**
 * Builds Continu's citation extension. `files` must be in the SAME order as
 * the composite document's segments (see module doc comment above) — the
 * caller (scrivenings-view.ts#mountEditor()) derives it directly from
 * `session.document.segments.map((s) => s.file)`. `getSettings` is called
 * fresh on every rebuild, never captured once, matching
 * createPandocCitationLivePreviewExtension()'s own convention.
 */
export function createScriveningsCitationExtension(
  boundariesField: unknown,
  app: App,
  getSettings: () => FeuilletsSettings,
  files: readonly TFile[]
): unknown {
  if (typeof ViewPluginTyped?.fromClass !== "function") return [];

  return ViewPluginTyped.fromClass(
    class {
      decorations: DecorationSet;
      private view: EditorViewInstance;
      /** Every bibliography path this Continu editor is CURRENTLY registered
       * under in the shared cache's view registry (pandoc-citation-preview.ts)
       * — unlike Live Preview's single-file extension, this can hold several
       * paths at once (several segments, several scopes). Diffed against the
       * freshly computed set on every rebuild so a path that stops applying
       * (segment scrolled away, or its file's scope changed) is unregistered
       * instead of leaking a stale subscription. */
      private registeredPaths: ReadonlySet<string> = new Set();

      constructor(view: EditorViewInstance) {
        this.view = view;
        this.decorations = DecorationTyped?.none ?? [];
        this.rebuild();
      }

      update(update: ViewUpdateLike): void {
        // Deliberately unconditional, exactly like Live Preview's own
        // extension: an async catalog load or a later bibliography edit
        // wakes this view with an empty transaction (docChanged/
        // viewportChanged/selectionSet all false), and only an
        // unconditional rebuild here picks that redraw up.
        this.view = update.view;
        this.rebuild();
      }

      destroy(): void {
        for (const path of this.registeredPaths) unregisterPandocCitationCatalogView(path, this.view);
        this.registeredPaths = new Set();
      }

      private rebuild(): void {
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
