import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { editorInfoField, editorLivePreviewField, normalizePath, TFile, type App } from "obsidian";
import {
  buildCitationNoticeLines,
  buildPandocCitationElement,
  disposePandocCitationElement,
  getSyncPandocCitationCatalog,
  registerPandocCitationCatalogView,
  resolvePandocCitationPreviewForFile,
  splitPandocCitationSegments,
  unregisterPandocCitationCatalogView,
  type PandocCitationCatalog,
} from "../services/pandoc-citation-preview.js";
import type { BibtexCatalogEntry } from "../services/bibtex-catalog.js";

/** Re-exported for existing callers (main.ts, tests): the synchronous cache
 * and view registry this module registers into now live in
 * pandoc-citation-preview.ts, shared with Continu's own citation extension
 * (cm-scrivenings-citations.ts) — see that module's doc comment. */
export { notifyPandocCitationBibliographyChanged } from "../services/pandoc-citation-preview.js";

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

/** Same minimal syntax-tree surface, and the SAME "name contains 'code'"
 * detection convention, as cm-paragraph-indent.ts's isNonParagraphLine() —
 * that file already established this pattern for a different exclusion set
 * (headers/lists/quotes/code); citations need only the "code" part of it
 * (a citation is perfectly legitimate inside a blockquote or a list item),
 * so it is reimplemented narrowly here rather than importing a broader check
 * that would need its own unrelated cases threaded through. */
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

/** True when `[from, to)` overlaps a node whose name contains "code" —
 * Obsidian's own CM6 markdown language tags both fenced/indented code blocks
 * and inline code spans this way (e.g. "HyperMD-codeblock", "inline-code").
 * Returns false (never excludes anything) when no language is installed on
 * this state — Continu's own composite EditorState has none (it renders
 * Markdown itself, see cm-scrivenings-markdown.ts), which is why Continu's
 * citation extension (cm-scrivenings-citations.ts) passes its OWN
 * `isProtected` built from the per-segment Lezer parse it already runs,
 * instead of relying on this function. */
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
  /** The editor's own root DOM element — real CodeMirror's `EditorView.dom`.
   * `dom.ownerDocument` is what PandocCitationWidget.toDOM(view) below uses
   * to build the citation in the SAME document as this editor, never the
   * global `document` (wrong for an Obsidian pane popped out into its own
   * window — see buildPandocCitationElement()'s doc comment). */
  dom: HTMLElement;
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

  toDOM(view: EditorViewInstance): HTMLElement {
    return buildPandocCitationElement(this.text, this.citekeys, this.records, view.dom.ownerDocument);
  }

  /** Never ignored: a click must be allowed to reach CodeMirror's own
   * position-mapping, which places the cursor at the folded range — the
   * mechanism that reveals the raw syntax (see the selection-overlap check
   * in buildDecorations()) so the citation stays editable by clicking it. */
  ignoreEvent(): boolean {
    return false;
  }

  /** CodeMirror's own WidgetType lifecycle hook, called with the exact DOM
   * node toDOM() returned once CodeMirror discards it (decoration replaced,
   * eq() returned false on a record edit, or the view itself is destroyed).
   * Without this, a tooltip left open at that exact moment would leak its
   * temporary window-level scroll/resize listeners (see
   * disposePandocCitationElement(), pandoc-citation-preview.ts) forever. */
  destroy(dom: HTMLElement): void {
    disposePandocCitationElement(dom);
  }
}

/** Exported for reuse by Continu's own citation extension
 * (cm-scrivenings-citations.ts), which needs the exact same
 * selection-overlap rule for its own (differently-sourced) selections —
 * never a re-derived copy of this rule. */
export function selectionOverlaps(selection: EditorSelectionLike, from: number, to: number): boolean {
  for (const range of selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

/**
 * Recognizes and decorates every citation on one CodeMirror line, appending
 * to `decos`. Exported for reuse by Continu's citation extension
 * (cm-scrivenings-citations.ts): the SAME per-line recognition, widget and
 * cursor-reveal logic, called once per (segment, catalog) pair there instead
 * of once for the whole editor — never a second implementation of this
 * scan.
 *
 * `{ narrative: true }`: both bracketed (`[@key]`) AND bracket-less
 * (`@key`) citations are recognized here — see splitPandocCitationSegments()'s
 * own doc comment for why this is safe to turn on unconditionally for every
 * interactive surface while formatPandocCitationText() (Aperçu, exports)
 * keeps the flag off and stays bracket-only.
 *
 * `isProtected`, when given, is asked about EVERY recognized citation's
 * `[absFrom, absTo)` range before it is decorated — a citation-shaped match
 * inside a fenced/inline code span must never fold, on any surface: `@word`
 * decorators/annotations are common in source code, so a real citekey
 * matching one by pure coincidence would otherwise fold in the middle of a
 * code sample. Absent (Reading Mode never passes it): that surface already
 * excludes CODE/PRE/SCRIPT/STYLE/A at the DOM level, upstream of ever
 * reaching splitPandocCitationSegments().
 */
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
      /** The path this editor is currently registered under in the shared
       * cache's view registry (pandoc-citation-preview.ts), or null when it
       * depends on none. Tracked so a rebuild that resolves to a DIFFERENT
       * (or no) path re-registers instead of leaking the old one. */
      private registeredPath: string | null = null;

      constructor(view: EditorViewInstance) {
        this.view = view;
        this.decorations = DecorationTyped?.none ?? [];
        this.rebuild();
      }

      update(update: ViewUpdateLike): void {
        // Rebuilt on every CM6 update, deliberately unconditional: the async
        // catalog load (getSyncPandocCitationCatalog()) and a later
        // bibliography edit (notifyPandocCitationBibliographyChanged()) both
        // wake the view with an empty transaction, which carries none of
        // docChanged / selectionSet / viewportChanged — only an
        // unconditional rebuild here picks that redraw up. The rebuild
        // itself stays cheap: it only scans visible lines, and reads the
        // resolved catalog from an in-memory map.
        this.view = update.view;
        this.rebuild();
      }

      /** CodeMirror's own ViewPlugin lifecycle hook, called when this plugin
       * instance is torn down (editor closed, extension reconfigured). Without
       * this, a closed editor would stay registered under its last
       * bibliography path forever — a residual subscription that would still
       * receive (harmlessly try/caught, but pointless) wake-up dispatches. */
      destroy(): void {
        unregisterPandocCitationCatalogView(this.registeredPath, this.view);
        this.registeredPath = null;
      }

      private rebuild(): void {
        const result = buildDecorations(this.view, getSettings);
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
