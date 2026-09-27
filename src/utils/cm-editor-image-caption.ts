import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { editorInfoField, editorLivePreviewField, type App, type TFile } from "obsidian";
import { parseImageMarkdown, type ParsedImageMarkdown } from "../services/image-markdown.js";
import { getProjectFolder, feuilletsAuxiliaryRootPath } from "../services/folder-structure.js";
import { selectionOverlaps } from "./cm-pandoc-citation-live-preview.js";
import { buildImageEmbedDom } from "./cm-image-embed-dom.js";

/**
 * Normal-editor rendering of a CAPTIONED standalone local image — one whose
 * whole line `parseImageMarkdown()` (services/image-markdown.ts, never
 * modified here) recognizes as the standard Markdown syntax WITH a caption
 * (`![Caption](target)`, including one starting with an escaped `[`, or with
 * an angle-bracket/URI-encoded target). A plain embed (`![[image.png]]`,
 * `![[image.png|300]]`) or a Markdown image with no caption is left
 * completely untouched — Obsidian's own native rendering already handles
 * those correctly; only captioned images have the Live Preview rendering
 * problem this widget works around (a captioned image's `[...]` alt text can
 * fail to render inline in Obsidian's own Live Preview, even when validly
 * escaped).
 *
 * CONFIRMED ROOT CAUSE of the "blank tab / Impossible d'ouvrir le fichier ''"
 * regression, reproduced live in Obsidian (Playwright over CDP, real click,
 * real console): a `Decoration.replace({ …, block: true })` supplied from a
 * `ViewPlugin`'s `decorations` accessor is invalid CodeMirror 6 — CM6 throws
 * `RangeError: Block decorations may not be specified via plugins` the
 * moment it tries to render one. That exception aborted the MarkdownView's
 * own setup, which is what left the leaf permanently empty — the tab looked
 * "blank" not because of anything about clicking, but because the file never
 * successfully rendered in the first place. **Never pass `block: true` in
 * this file's decoration spec.** If a genuine block-level replacement is
 * ever needed here, it MUST come from a `StateField` (as Continu's own block
 * title widgets already do, see `scriveningsTitlesField`,
 * cm-scrivenings-markdown.ts), never from this ViewPlugin.
 *
 * An earlier round of work had also hypothesized (WITHOUT reproducing it)
 * that Obsidian's native Live-Preview embed-click handling was misparsing
 * this bracket-escaped syntax and navigating to an empty path. That specific
 * mechanism was never actually observed once the crash above was fixed and
 * the widget could render at all: a real traced click (pointerdown/mousedown
 * /mouseup, capture and bubble phases, on both the widget and the editor's
 * own DOM) shows the click handled entirely locally, no `click` event even
 * reaching the editor DOM (the widget is removed from under the pointer
 * between mousedown and mouseup, so the browser never synthesizes one), and
 * no navigation of any kind. The interaction-ownership design below was
 * built for that hypothesis; it is kept and verified because it is correct,
 * harmless defensive practice regardless — not because it turned out to be
 * the fix for the reported bug.
 *
 * Interaction ownership (verified, kept):
 * - `ignoreEvent()` returns `true` — CodeMirror never tries to translate a
 *   pointer event on this widget into its own cursor-placement command;
 * - the widget's own `mousedown` listener (attached directly to its DOM in
 *   `toDOM()`) calls `preventDefault()` AND `stopPropagation()`, then places
 *   the CodeMirror selection at the widget's own known source range
 *   (`sourceFrom`) and focuses the view — never a document change, never any
 *   Obsidian link-opening API. The next redraw's `selectionOverlaps` check
 *   (below) then naturally hides the widget, revealing the raw, editable
 *   Markdown.
 *
 * Architecture otherwise mirrors cm-pandoc-citation-live-preview.ts (the
 * existing, already-established pattern for a normal-editor Live-Preview
 * ViewPlugin): `editorInfoField` resolves THIS editor's own file (never a
 * globally "active" one), Source mode renders nothing, and `selectionOverlaps`
 * (imported, not re-derived) hides the widget the moment the cursor/selection
 * touches its exact source range.
 *
 * This widget never writes to the document, never touches the Vault, and
 * never moves/creates/copies an image — it only reads and renders. Image
 * resolution mirrors Continu's own resolver (scrivenings-view.ts): try the
 * target as written, then `decodeURIComponent`, via
 * `metadataCache.getFirstLinkpathDest` + `vault.getResourcePath` — never a
 * third, independently invented resolution strategy.
 */

type DecorationSet = unknown;
interface ReplaceSpec {
  widget: unknown;
  // Deliberately no `block` field: a block-level replace decoration is
  // invalid CM6 usage from a ViewPlugin — see this module's doc comment.
}
interface DecorationStatic {
  none: DecorationSet;
  replace(spec: ReplaceSpec): { range(from: number, to: number): { from: number; to: number } };
  set(ranges: { from: number; to: number }[], sort?: boolean): DecorationSet;
}
const DecorationTyped = Decoration as DecorationStatic;

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
  requestMeasure?: () => void;
  dispatch(spec: Record<string, unknown>): void;
  focus(): void;
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

type PrecStatic = { highest(extension: unknown): unknown };
const PrecTyped = Prec as PrecStatic;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"]);

function hasImageExtension(target: string): boolean {
  const clean = target.split(/[?#]/, 1)[0] ?? target;
  const dot = clean.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTENSIONS.has(clean.slice(dot + 1).toLowerCase());
}

/** Same "inside the active project, not under `_Feuillets/`" rule already
 * applied to pasted images (services/image-resources.ts's
 * `resolvePastedImageDirectory`) and to the caption editor actions
 * (services/image-caption-actions.ts) — re-derived here from the same two
 * canonical primitives (`getProjectFolder`, `feuilletsAuxiliaryRootPath`)
 * rather than importing either of those (frozen for this task; this is a
 * plain boolean gate, not their destination-path/caption-line concerns). */
function isEligibleProjectMarkdownFile(app: App, settings: FeuilletsSettings | null | undefined, file: TFile | null): file is TFile {
  if (!file || file.extension !== "md") return false;
  const root = getProjectFolder(app, settings);
  if (!root) return false;
  if (file.path !== root.path && !file.path.startsWith(`${root.path}/`)) return false;
  const auxRoot = feuilletsAuxiliaryRootPath(root);
  return file.path !== auxRoot && !file.path.startsWith(`${auxRoot}/`);
}

/** Resolves a parsed image target to a displayable source URL — remote
 * targets pass through unchanged; a local target is tried as written, then
 * `decodeURIComponent`-ed, exactly mirroring Continu's own image resolver
 * (scrivenings-view.ts, mountEditor()'s `imageResolver`). `null` fails
 * closed: the caller then leaves the raw Markdown visible instead of a
 * broken widget. */
function resolveEditorImageSource(app: App, target: string, sourcePath: string): string | null {
  if (/^https?:\/\//i.test(target)) return target;
  const candidates = [target];
  try {
    const decoded = decodeURIComponent(target);
    if (decoded !== target) candidates.push(decoded);
  } catch {
    // Malformed percent-encoding: no decoded fallback, raw candidate only.
  }
  for (const candidate of candidates) {
    const file = app.metadataCache.getFirstLinkpathDest(candidate, sourcePath);
    if (file && file.extension && IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) {
      return app.vault.getResourcePath(file);
    }
  }
  return null;
}

/** Trimmed span of `line` — excludes any leading/trailing whitespace, so the
 * decoration and the widget's own known source range cover exactly the
 * standalone image Markdown, never incidental indentation, trailing spaces,
 * or (CodeMirror's `Line.to` already excludes it) the line break itself.
 * Same convention as Continu's own `parseImageLine` (cm-scrivenings-
 * markdown.ts): `from = lineStart + leading`. */
function trimmedLineSpan(line: EditorLineLike): { from: number; to: number } {
  const leading = line.text.length - line.text.trimStart().length;
  const from = line.from + leading;
  return { from, to: from + line.text.trim().length };
}

class EditorImageCaptionWidget extends WidgetTypeTyped {
  constructor(
    private readonly parsed: ParsedImageMarkdown,
    private readonly src: string,
    private readonly sourceFrom: number,
    private readonly sourceTo: number
  ) {
    super();
  }

  eq(other: unknown): boolean {
    return (
      other instanceof EditorImageCaptionWidget &&
      other.src === this.src &&
      other.sourceFrom === this.sourceFrom &&
      other.sourceTo === this.sourceTo &&
      other.parsed.caption === this.parsed.caption &&
      other.parsed.width === this.parsed.width &&
      other.parsed.height === this.parsed.height
    );
  }

  toDOM(view: EditorViewInstance): HTMLElement {
    const root = buildImageEmbedDom({
      src: this.src,
      alt: this.parsed.caption ?? "",
      caption: this.parsed.caption,
      width: this.parsed.width,
      height: this.parsed.height,
      onLoad: () => view?.requestMeasure?.(),
    });

    // Own this interaction outright — see this module's doc comment for why.
    // A SINGLE listener, on the widget's own root: it never reaches any
    // ancestor (Obsidian's native embed-click handling included), and it
    // never reaches CodeMirror's own default click handling either
    // (ignoreEvent() below returns true for exactly that reason).
    root.addEventListener("mousedown", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.sourceFrom } });
      view.focus();
    });

    // Never expose this image's resolved src to native browser/Obsidian
    // drag handling (which could itself attempt to interpret it as a
    // droppable link/file reference elsewhere).
    const img = root.querySelector("img");
    if (img) img.draggable = false;

    return root;
  }

  /** Always true: Feuillets owns pointer interaction on this widget
   * completely (see the `mousedown` listener in `toDOM()` and this module's
   * doc comment) — never `false` like PandocCitationWidget, whose click must
   * fall through to CodeMirror to reveal its folded source. */
  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(view: EditorViewInstance, getSettings: () => FeuilletsSettings): DecorationSet {
  if (typeof DecorationTyped?.set !== "function" || !view.visibleRanges || !view.state?.doc) {
    return DecorationTyped?.none ?? [];
  }

  // Source mode: raw Markdown stays visible, exactly like the file on disk.
  const livePreview = view.state.field<boolean>(editorLivePreviewField, false);
  if (livePreview === false) return DecorationTyped.none;

  // THIS editor's own file, never a globally "active" one. A new/empty tab
  // (info present, file null) or an editor with no editorInfoField at all
  // fails closed here: no decorations, no resolution, no event wiring.
  const info = view.state.field<EditorInfoLike>(editorInfoField, false);
  const file = info?.file ?? null;
  if (!info || !isEligibleProjectMarkdownFile(info.app, getSettings(), file)) return DecorationTyped.none;

  const decos: { from: number; to: number }[] = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const parsed = parseImageMarkdown(line.text.trim());
      if (parsed && parsed.syntax === "markdown" && parsed.caption && hasImageExtension(parsed.target)) {
        const span = trimmedLineSpan(line);
        if (!selectionOverlaps(view.state.selection, span.from, span.to)) {
          const src = resolveEditorImageSource(info.app, parsed.target, file.path);
          if (src) {
            decos.push(
              DecorationTyped.replace({
                widget: new EditorImageCaptionWidget(parsed, src, span.from, span.to),
              }).range(span.from, span.to)
            );
          }
          // Unresolved: fail closed, no decoration — the raw Markdown line stays visible.
        }
      }
      pos = line.to + 1;
    }
  }

  return DecorationTyped.set(decos, true);
}

/** Builds the Live Preview extension. `getSettings` is called fresh on every
 * redraw (never captured once), matching createPandocCitationLivePreviewExtension()'s
 * own convention.
 *
 * CONFIRMED (real Obsidian, CDP DOM inspection, both caption forms on the
 * same note): for an ordinary caption (`![essai de légende](<img>)`),
 * Obsidian's OWN native `.internal-embed.image-embed` decoration was present
 * in the rendered line and this plugin's `.cm-scrivenings-image-embed` was
 * absent entirely — not merely visually covered, but excluded from the
 * rendered decoration set. For a bracket-escaped caption
 * (`![\[Image 1\] …](<img>)`), only this plugin's widget was present; Obsidian
 * never produced a native decoration for that range at all. So the two
 * same-range `Decoration.replace` providers conflict, and without an
 * explicit precedence, Obsidian's own (core, registered before any
 * plugin's `registerEditorExtension`) wins the merge. `Prec.highest` is
 * applied HERE ONLY — to this one widget's extension, not to any other
 * Feuillets editor extension — as the minimum fix: it is the correctness
 * condition for this widget to ever render over a real, non-bracketed
 * caption, and the bracketed case already worked without it. */
export function createEditorImageCaptionExtension(getSettings: () => FeuilletsSettings): unknown {
  if (typeof ViewPluginTyped?.fromClass !== "function") return [];

  const plugin = ViewPluginTyped.fromClass(
    class {
      decorations: DecorationSet;

      constructor(private view: EditorViewInstance) {
        this.decorations = buildDecorations(view, getSettings);
      }

      update(update: ViewUpdateLike): void {
        this.view = update.view;
        this.decorations = buildDecorations(this.view, getSettings);
      }
    },
    {
      decorations: (v: { decorations: DecorationSet }) => v.decorations,
    }
  );

  return typeof PrecTyped?.highest === "function" ? PrecTyped.highest(plugin) : plugin;
}
