import { Compartment } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, highlightWhitespace } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

interface Line { from: number; to: number; text: string }
export interface FormattingMarksState {
  doc: { length: number; lineAt(position: number): Line; sliceString(from: number, to: number): string };
  field(field: unknown, required: false): unknown;
}
interface MarksView {
  state: FormattingMarksState;
  visibleRanges: readonly { from: number; to: number }[];
  dispatch(spec: { effects: unknown }): void;
}
interface MarksUpdate { view: MarksView; docChanged: boolean; viewportChanged: boolean; startState: FormattingMarksState }
interface SyntaxNode { name: string; to: number; parent: SyntaxNode | null }
interface MarksTree { resolveInner(position: number, side: number): SyntaxNode }
type Range = { from: number; to: number };
const decorations = Decoration as {
  mark(spec: { class: string }): { range(from: number, to: number): Range };
  line(spec: { class: string; attributes: Record<string, string> }): { range(from: number): Range };
  set(ranges: Range[], sort: boolean): unknown;
};
const plugins = ViewPlugin as {
  fromClass<T>(ctor: new (view: MarksView) => T, spec?: { decorations(value: T): unknown }): unknown;
};
const views = EditorView as { editorAttributes: { of(attributes: Record<string, string>): unknown } };

export interface FormattingMarksOptions {
  eligible?: (state: FormattingMarksState) => boolean;
  boundaries?: (state: FormattingMarksState) => readonly number[];
  /** Reuse the writing surface's existing Markdown parse, without reparsing. */
  paragraphEndLookup?: (view: MarksView) => (position: number) => boolean | undefined;
}

function paragraphEnd(tree: MarksTree, position: number): boolean | undefined {
  let node: SyntaxNode | null = tree.resolveInner(position, -1);
  while (node) {
    if (/^paragraph$/i.test(node.name)) return node.to === position;
    if (/code|table|heading/i.test(node.name)) return false;
    node = node.parent;
  }
  return undefined;
}

function complementaryMarks(view: MarksView, options: FormattingMarksOptions): unknown {
  const { state } = view;
  const boundaries = new Set(options.boundaries?.(state));
  const lookup = options.paragraphEndLookup?.(view);
  const tree = lookup ? undefined : (syntaxTree as unknown as (state: unknown) => MarksTree)(state);
  const ranges: Range[] = [];
  let lastEnd = -1;
  for (const visible of view.visibleRanges) {
    // Read only visible characters, even when a physical line is very long.
    const text = state.doc.sliceString(visible.from, visible.to);
    const spaces = /[\u00a0\u202f]/g;
    for (let match = spaces.exec(text); match; match = spaces.exec(text)) {
      const from = visible.from + match.index;
      ranges.push(decorations.mark({ class: match[0] === "\u00a0"
        ? "feuillets-formatting-nbsp" : "feuillets-formatting-nnbsp" }).range(from, from + 1));
    }
    for (let position = visible.from; position <= visible.to;) {
      const line = state.doc.lineAt(position);
      if (line.to > lastEnd && line.to <= visible.to && line.to < state.doc.length && !boundaries.has(line.to)) {
        const next = state.doc.lineAt(line.to + 1);
        const isParagraphEnd = lookup ? lookup(line.to) : tree ? paragraphEnd(tree, line.to) : undefined;
        const blank = /^[\t >]*$/.test(line.text);
        const nextBlank = /^[\t >]*$/.test(next.text);
        const mark = (isParagraphEnd ?? (blank || nextBlank)) ? "¶" : "↵";
        const attributes: Record<string, string> = { "data-feuillets-line-end": mark };
        if (line.text.length === 0) attributes["data-feuillets-line-end-empty"] = mark;
        ranges.push(decorations.line({ class: "feuillets-formatting-line-end", attributes }).range(line.from));
        lastEnd = line.to;
      }
      position = line.to + 1;
    }
  }
  return decorations.set(ranges, true);
}

/** Tracks live CM views through public lifecycle hooks. Only the small observer
 * remains installed while disabled; the native highlighter and all custom
 * decorations live in a compartment that is removed on deactivation. */
export class FormattingMarksController {
  private readonly editors = new Set<{ refresh(): void }>();
  constructor(private readonly enabled: () => boolean) {}

  refresh(): void { for (const editor of this.editors) editor.refresh(); }

  extension(options: FormattingMarksOptions = {}): unknown[] {
    const compartment = new Compartment();
    const controller = this;
    const marks = plugins.fromClass(class {
      decorations: unknown;
      constructor(view: MarksView) { this.decorations = complementaryMarks(view, options); }
      update(update: MarksUpdate): void {
        if (update.docChanged || update.viewportChanged ||
          options.boundaries?.(update.startState) !== options.boundaries?.(update.view.state) ||
          syntaxTree(update.startState) !== syntaxTree(update.view.state)) {
          this.decorations = complementaryMarks(update.view, options);
        }
      }
    }, { decorations: (value) => value.decorations });
    const active = [highlightWhitespace(), marks, views.editorAttributes.of({ class: "feuillets-formatting-marks" })];
    const observer = plugins.fromClass(class {
      private active = false;
      private destroyed = false;
      private pending = false;
      constructor(private readonly view: MarksView) {
        controller.editors.add(this);
        this.schedule();
      }
      private wanted(): boolean { return controller.enabled() && (options.eligible?.(this.view.state) ?? true); }
      private schedule(): void {
        if (this.pending || this.active === this.wanted()) return;
        this.pending = true;
        // CM forbids dispatch during plugin construction or update.
        queueMicrotask(() => { this.pending = false; if (!this.destroyed) this.refresh(); });
      }
      refresh(): void {
        const wanted = this.wanted();
        if (wanted === this.active || this.destroyed) return;
        this.active = wanted;
        this.view.dispatch({ effects: compartment.reconfigure(wanted ? active : []) });
      }
      update(): void { this.schedule(); }
      destroy(): void { this.destroyed = true; controller.editors.delete(this); }
    });
    return [compartment.of([]), observer];
  }
}
