import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { resolveSourceAnchor, type SourceAnchor } from "../services/source-anchor.js";
import { t } from "../i18n/index.js";

type Range = { from: number; to?: number };
type DecorationSet = unknown;
type EditorStateLike = {
  doc: { toString(): string; lineAt(pos: number): { from: number } };
  field(field: unknown, require?: boolean): unknown;
};
type EditorState = EditorStateLike;
type EditorViewLike = { state: EditorStateLike; dispatch(spec: { effects: unknown }): void };
type EffectType<T> = { of(value: T): unknown };
type EffectInstance = { is(type: unknown): boolean };
type DecorationStatic = {
  none: DecorationSet;
  widget(spec: { widget: unknown; side: number; block: boolean }): { range(from: number): Range };
  set(ranges: Range[], sort?: boolean): DecorationSet;
};
type StateFieldStatic = {
  define<T>(config: {
    create(state: EditorState): T;
    update(value: T, transaction: { docChanged: boolean; effects: EffectInstance[]; state: EditorState }): T;
    provide(field: unknown): unknown;
  }): unknown;
};
type ViewPluginStatic = { fromClass<T>(value: new (view: EditorViewLike) => T): unknown };
type EditorViewStatic = { decorations: { from(field: unknown): unknown } };

const anchorsByPath = new Map<string, readonly SourceAnchor[]>();
const registeredEditorViews = new Set<EditorViewLike>();
const StateEffectTyped = StateEffect as { define<T>(): EffectType<T> };
const StateFieldTyped = StateField as StateFieldStatic;
const DecorationTyped = Decoration as DecorationStatic;
const EditorViewTyped = EditorView as EditorViewStatic;
const ViewPluginTyped = ViewPlugin as ViewPluginStatic;
export const refreshDocumentPageBreakEffect = StateEffectTyped.define<void>();

export function setDocumentLayoutPageBreakAnchors(path: string, anchors: readonly SourceAnchor[]): void {
  anchorsByPath.set(path, anchors);
  for (const view of registeredEditorViews) {
    if (pathFor(view) === path) view.dispatch({ effects: refreshDocumentPageBreakEffect.of(undefined) });
  }
}

function pathFor(view: { state: EditorStateLike }): string | null {
  const info = view.state.field(editorInfoField, false) as { file?: { path?: string } } | undefined;
  return info?.file?.path || null;
}

export class DocumentLayoutPageBreakWidget extends WidgetType {
  toDOM(): HTMLElement {
    const root = createDiv({ cls: "feuillets-editor-page-break" });
    root.setAttribute("aria-hidden", "true");
    const line = (): HTMLSpanElement => createSpan({ cls: "feuillets-editor-page-break-line" });
    root.append(line());
    const label = createSpan({ cls: "feuillets-editor-page-break-label" });
    label.textContent = t("layoutDirective.pageBreak");
    root.append(label, line());
    return root;
  }
  eq(other: unknown): boolean { return other instanceof DocumentLayoutPageBreakWidget; }
  ignoreEvent(): boolean { return true; }
}

export function buildDocumentPageBreakDecorations(state: EditorState): DecorationSet {
  const editorState = state;
  const path = pathFor({ state: editorState });
  if (!path) return DecorationTyped.none;
  const text = editorState.doc.toString();
  const lines = new Set<number>();
  for (const anchor of anchorsByPath.get(path) || []) {
    const resolved = resolveSourceAnchor(anchor, text);
    if (resolved) lines.add(editorState.doc.lineAt(resolved.start).from);
  }
  const ranges = [...lines]
    .sort((left, right) => left - right)
    .map((from) => DecorationTyped.widget({ widget: new DocumentLayoutPageBreakWidget(), side: -1, block: true }).range(from));
  return DecorationTyped.set(ranges, true);
}

const documentPageBreakDecorationField = StateFieldTyped.define<DecorationSet>({
  create(state) {
    return buildDocumentPageBreakDecorations(state);
  },
  update(value, transaction) {
    const mustRefresh = transaction.docChanged || transaction.effects.some((effect) => effect.is(refreshDocumentPageBreakEffect));
    return mustRefresh ? buildDocumentPageBreakDecorations(transaction.state) : value;
  },
  provide(field) {
    return EditorViewTyped.decorations.from(field);
  },
});

const documentPageBreakViewPlugin = ViewPluginTyped.fromClass(
  class {
    private readonly editorView: EditorViewLike;
    constructor(view: EditorViewLike) {
      this.editorView = view;
      registeredEditorViews.add(view);
    }
    destroy(): void {
      registeredEditorViews.delete(this.editorView);
    }
  },
);

export const documentLayoutPageBreakPlugin = [documentPageBreakDecorationField, documentPageBreakViewPlugin];
