import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, normalizePath, TFile, type App } from "obsidian";
import {
  buildCitationNoticeElement,
  buildCitationNoticeLines,
  loadPandocCitationCatalog,
  PANDOC_CITATION_CLASS,
  PANDOC_CITATION_LABEL_CLASS,
  resolvePandocCitationPreviewForFile,
  splitPandocCitationSegments,
  type PandocCitationCatalog,
} from "../services/pandoc-citation-preview.js";
import type { BibtexCatalogEntry } from "../services/bibtex-catalog.js";

/**
 * Live Preview folding of Pandoc citekeys: [@smith2024] → (Smith, 2024), as an
 * editable widget rather than a rewritten string — the Markdown source is never
 * touched (see PandocCitationWidget.toDOM(), buildCitationNoticeElement()).
 *
 * File and scope resolution never assume a single globally active file: the
 * editor this ViewPlugin instance belongs to is read from `editorInfoField`
 * (Obsidian's own per-editor StateField), and that file — not any other pane's
 * file — is what resolvePandocCitationPreviewForFile() resolves a bibliography
 * for. Two panes open on siblings such as Work-A and Work-A-Extra therefore
 * always resolve independently.
 *
 * Source mode (editorLivePreviewField === false) never folds anything: raw
 * citekeys stay visible there, exactly like the Markdown source on disk.
 *
 * Cursor-reveal: a citation whose source range overlaps any selection range is
 * left undecorated for that redraw, so the raw `[@...]` syntax becomes visible
 * and editable the moment the cursor enters it, and refolds the moment every
 * selection range leaves it again.
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

interface WidgetTypeInstance {
  eq(other: unknown): boolean;
  toDOM(): HTMLElement;
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

/** Every notice line for one citekey, joined into a single string — used only to
 * detect whether a record's content changed, never rendered as-is. */
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

/** Widget carrying a fully built citation element (label + notice), the exact
 * same DOM shape as Reading Mode's (see buildCitationNoticeElement()). */
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

  /** Compares the visible text AND a signature built from every notice field
   * (title, journal, volume, pages, publisher, DOI/URL — see
   * buildCitationNoticeLines()): a record edit that leaves the author, year and
   * visible text unchanged (e.g. only the title or the DOI changes) must still
   * be treated as a different widget, so CodeMirror rebuilds its DOM and the
   * tooltip never goes stale. */
  eq(other: PandocCitationWidget): boolean {
    return (
      other instanceof PandocCitationWidget &&
      this.text === other.text &&
      this.citekeys.join(",") === other.citekeys.join(",") &&
      this.noticeSignature === other.noticeSignature
    );
  }

  toDOM(): HTMLElement {
    const citation = createSpan({ cls: PANDOC_CITATION_CLASS });
    citation.setAttribute("data-citekeys", this.citekeys.join(","));
    citation.createSpan({ cls: PANDOC_CITATION_LABEL_CLASS, text: this.text });
    const tooltip = buildCitationNoticeElement(this.citekeys, this.records);
    if (tooltip) {
      citation.appendChild(tooltip);
      citation.setAttribute("tabindex", "0");
      citation.setAttribute("aria-describedby", tooltip.getAttribute("id") || "");
    }
    return citation;
  }

  /** Never ignored: a click must be allowed to reach CodeMirror's own
   * position-mapping, which places the cursor at the folded range — the
   * mechanism that reveals the raw syntax (see the selection-overlap check
   * in buildDecorations()) so the citation stays editable by clicking it. */
  ignoreEvent(): boolean {
    return false;
  }
}

function selectionOverlaps(selection: EditorSelectionLike, from: number, to: number): boolean {
  for (const range of selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

/** One resolved bibliography, snapshotted against the mtime/size it was read
 * at — the same pair getCachedBibtexCatalog() itself keys its cache on, so a
 * later redraw can decide synchronously, from already-in-memory numbers,
 * whether a fresh read is actually needed. */
type CatalogSnapshot = { catalog: PandocCitationCatalog; mtime: number; size: number };
const syncCatalogSnapshots = new Map<string, CatalogSnapshot>();
const pendingCatalogLoads = new Set<string>();

/**
 * Every editor currently displaying decorations built from a given bibliography
 * path — never a single "requester" view. Populated by the plugin class below
 * (registerView()/unregisterView(), called from its own rebuild()/destroy()),
 * and read from two places: once a shared load resolves (wakeViews(), below),
 * and once the bibliography file changes on disk
 * (notifyPandocCitationBibliographyChanged(), exported at the bottom).
 *
 * This is what lets TWO editors cold-opened on the SAME .bib both display their
 * citations from a SINGLE physical read: both register under the same path
 * while the (deduplicated, see loadPandocCitationCatalog()) load is in flight,
 * and both get woken once it resolves.
 */
const viewsByPath = new Map<string, Set<EditorViewInstance>>();

function registerView(path: string, view: EditorViewInstance): void {
  let views = viewsByPath.get(path);
  if (!views) {
    views = new Set();
    viewsByPath.set(path, views);
  }
  views.add(view);
}

function unregisterView(path: string | null, view: EditorViewInstance): void {
  if (!path) return;
  const views = viewsByPath.get(path);
  if (!views) return;
  views.delete(view);
  if (views.size === 0) viewsByPath.delete(path);
}

/** Dispatches an empty transaction to every editor registered for `path`. A
 * destroyed editor's dispatch throws (or was already unregistered in
 * destroy() — see the plugin class below), so this never fails as a whole. */
function wakeViews(path: string): void {
  const views = viewsByPath.get(path);
  if (!views) return;
  for (const view of [...views]) {
    try {
      view.dispatch({});
    } catch {
      // The editor was closed before the load resolved: nothing to redraw.
    }
  }
}

/**
 * Invalidates the synchronous snapshot for `bibFile` and wakes every editor
 * currently registered for it — never editors registered for a different
 * bibliography. Call from a vault "modify" event (see main.ts), registered in
 * the plugin's own lifecycle so it is unregistered automatically on unload.
 */
export function notifyPandocCitationBibliographyChanged(bibFile: TFile): void {
  const normalizedPath = normalizePath(bibFile.path);
  syncCatalogSnapshots.delete(normalizedPath);
  wakeViews(normalizedPath);
}

/**
 * Synchronous read of the last resolved catalog for `bibliographyPath`, kicking
 * off a fresh load (at most one in flight per path — see loadPandocCitationCatalog())
 * when the file is missing from the snapshot or its mtime/size no longer match.
 * A load in flight makes this redraw fall back to raw text; once it resolves,
 * wakeViews() dispatches an empty transaction to EVERY editor registered for
 * this path (update() below rebuilds unconditionally on every dispatch), not
 * only the one that happened to trigger the load.
 */
function getSyncCatalog(
  app: App,
  style: PandocCitationPreviewStyle,
  bibliographyPath: string
): PandocCitationCatalog | null {
  const normalizedPath = normalizePath(bibliographyPath);
  const bibFile = app.vault.getAbstractFileByPath(normalizedPath);
  if (!(bibFile instanceof TFile)) {
    syncCatalogSnapshots.delete(normalizedPath);
    return null;
  }

  const mtime = bibFile.stat?.mtime ?? 0;
  const size = bibFile.stat?.size ?? 0;
  const snapshot = syncCatalogSnapshots.get(normalizedPath);
  if (snapshot && snapshot.mtime === mtime && snapshot.size === size) {
    return snapshot.catalog;
  }

  if (!pendingCatalogLoads.has(normalizedPath)) {
    pendingCatalogLoads.add(normalizedPath);
    void loadPandocCitationCatalog(app, style, bibliographyPath).then((catalog) => {
      pendingCatalogLoads.delete(normalizedPath);
      if (catalog) {
        syncCatalogSnapshots.set(normalizedPath, { catalog, mtime, size });
      } else {
        syncCatalogSnapshots.delete(normalizedPath);
      }
      wakeViews(normalizedPath);
    });
  }

  return null;
}

function appendLineDecorations(
  line: EditorLineLike,
  state: EditorStateLike,
  catalog: PandocCitationCatalog,
  decos: DecorationRange[]
): void {
  const segments = splitPandocCitationSegments(line.text, catalog.entries);
  for (const segment of segments) {
    if (segment.kind !== "citation") continue;
    const absFrom = line.from + segment.start;
    const absTo = line.from + segment.end;
    if (absFrom >= absTo) continue;
    if (selectionOverlaps(state.selection, absFrom, absTo)) continue;
    decos.push(
      DecorationTyped.replace({
        widget: new PandocCitationWidget(segment.text, segment.citekeys, catalog.records),
        inclusive: false,
      }).range(absFrom, absTo)
    );
  }
}

type BuildResult = { decorations: DecorationSet; bibliographyPath: string | null };

/** `bibliographyPath` in the result is the normalized path this editor now
 * depends on (or null when it depends on none — Source mode, no file, style
 * "off", nothing configured), independently of whether a catalog was actually
 * available for it on THIS pass: the caller registers the view under that path
 * either way, so a load still in flight — or a later file change — still wakes
 * it. */
function buildDecorations(view: EditorViewInstance, getSettings: () => FeuilletsSettings): BuildResult {
  if (typeof DecorationTyped?.set !== "function" || !view.visibleRanges || !view.state?.doc) {
    return { decorations: DecorationTyped?.none ?? [], bibliographyPath: null };
  }

  // Source mode: raw citekeys stay visible, exactly like the file on disk.
  const livePreview = view.state.field<boolean>(editorLivePreviewField, false);
  if (livePreview === false) return { decorations: DecorationTyped.none, bibliographyPath: null };

  // THIS editor's own file, never a globally active one — see module doc comment.
  const info = view.state.field<EditorInfoLike>(editorInfoField, false);
  const file = info?.file ?? null;
  if (!info || !file) return { decorations: DecorationTyped.none, bibliographyPath: null };

  const { style, bibliographyPath } = resolvePandocCitationPreviewForFile(info.app, getSettings(), file);
  if (style === "off" || !bibliographyPath) return { decorations: DecorationTyped.none, bibliographyPath: null };
  const normalizedPath = normalizePath(bibliographyPath);

  const catalog = getSyncCatalog(info.app, style, bibliographyPath);
  if (!catalog) return { decorations: DecorationTyped.none, bibliographyPath: normalizedPath };

  const decos: DecorationRange[] = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      appendLineDecorations(line, view.state, catalog, decos);
      pos = line.to + 1;
    }
  }

  return { decorations: DecorationTyped.set(decos, true), bibliographyPath: normalizedPath };
}

/**
 * Builds the Live Preview extension. `getSettings` is called fresh on every
 * redraw (never captured once), so it always reflects the CURRENT plugin
 * settings — matching the existing createCitekeyTriggerExtension() convention
 * of taking a closure rather than a static settings snapshot.
 */
export function createPandocCitationLivePreviewExtension(getSettings: () => FeuilletsSettings): unknown {
  if (typeof ViewPluginTyped?.fromClass !== "function") return [];

  return ViewPluginTyped.fromClass(
    class {
      decorations: DecorationSet;
      private view: EditorViewInstance;
      /** The path this editor is currently registered under in viewsByPath, or
       * null when it depends on none. Tracked so a rebuild that resolves to a
       * DIFFERENT (or no) path re-registers instead of leaking the old one. */
      private registeredPath: string | null = null;

      constructor(view: EditorViewInstance) {
        this.view = view;
        this.decorations = DecorationTyped?.none ?? [];
        this.rebuild();
      }

      update(update: ViewUpdateLike): void {
        // Rebuilt on every CM6 update, deliberately unconditional: the async
        // catalog load (getSyncCatalog()) and a later bibliography edit
        // (notifyPandocCitationBibliographyChanged()) both wake the view with
        // an empty transaction, which carries none of docChanged /
        // selectionSet / viewportChanged — only an unconditional rebuild here
        // picks that redraw up. The rebuild itself stays cheap: it only scans
        // visible lines, and reads the resolved catalog from an in-memory map.
        this.view = update.view;
        this.rebuild();
      }

      /** CodeMirror's own ViewPlugin lifecycle hook, called when this plugin
       * instance is torn down (editor closed, extension reconfigured). Without
       * this, a closed editor would stay registered under its last
       * bibliography path forever — a residual subscription that would still
       * receive (harmlessly try/caught, but pointless) wake-up dispatches. */
      destroy(): void {
        unregisterView(this.registeredPath, this.view);
        this.registeredPath = null;
      }

      private rebuild(): void {
        const result = buildDecorations(this.view, getSettings);
        this.decorations = result.decorations;
        if (result.bibliographyPath !== this.registeredPath) {
          unregisterView(this.registeredPath, this.view);
          this.registeredPath = result.bibliographyPath;
          if (this.registeredPath) registerView(this.registeredPath, this.view);
        }
      }
    },
    {
      decorations: (v: { decorations: DecorationSet }) => v.decorations,
    }
  );
}
