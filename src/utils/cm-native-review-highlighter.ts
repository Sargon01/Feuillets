import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

/* Seules les notes sont décorées dans l'éditeur : les changements proposés se
 * traitent dans la comparaison côte à côte, jamais en surimpression du texte. */
export type NativeReviewThreadColor = "yellow" | "green" | "blue" | "pink";
export type NativeReviewThreadStyle = "highlight" | "underline" | "strikethrough";
export type NativeReviewThreadVisual = { threadId: string; reviewId: string; documentId: string; anchor: { start: number; end: number; quote: string; prefix: string; suffix: string }; color?: NativeReviewThreadColor; style?: NativeReviewThreadStyle };
export const nativeReviewThreadColor = (thread: Pick<NativeReviewThreadVisual, "color">): NativeReviewThreadColor => thread.color ?? "yellow";
export const nativeReviewThreadStyle = (thread: Pick<NativeReviewThreadVisual, "style">): NativeReviewThreadStyle => thread.style ?? "highlight";

/** Resolves a collaborative anchor without fuzzy matching or guessed positions. */
export function resolveNativeReviewThreadAnchor(anchor: NativeReviewThreadVisual["anchor"], text: string): { start: number; end: number } | null {
  if (anchor.start >= 0 && anchor.end > anchor.start && text.slice(anchor.start, anchor.end) === anchor.quote) return { start: anchor.start, end: anchor.end };
  const occurrences: number[] = []; for (let at = text.indexOf(anchor.quote); at !== -1; at = text.indexOf(anchor.quote, at + 1)) occurrences.push(at);
  const candidates = occurrences.filter((start) => (!anchor.prefix || text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix) && (!anchor.suffix || text.slice(start + anchor.quote.length, start + anchor.quote.length + anchor.suffix.length) === anchor.suffix));
  if (candidates.length === 1) return { start: candidates[0], end: candidates[0] + anchor.quote.length };
  if (occurrences.length === 1) return { start: occurrences[0], end: occurrences[0] + anchor.quote.length };
  if (!anchor.quote && anchor.prefix && anchor.suffix) { const anchors: number[] = []; for (let at = text.indexOf(anchor.prefix); at !== -1; at = text.indexOf(anchor.prefix, at + 1)) { const end = at + anchor.prefix.length; if (text.slice(end, end + anchor.suffix.length) === anchor.suffix) anchors.push(end); } if (anchors.length === 1) return { start: anchors[0], end: anchors[0] }; }
  return null;
}

type DecorationSet = { map(changes: unknown): DecorationSet };
type Range = { from: number; to: number };
type EffectType<T> = { of(value: T): unknown };
type EffectInstance<T> = { value: T; is(type: unknown): boolean };
type FieldStatic = { define<T>(config: { create(): T; update(value: T, tr: { effects: EffectInstance<T>[]; docChanged: boolean; changes: unknown }): T; provide?: (field: unknown) => unknown }): unknown };
type DecorationStatic = { none: DecorationSet; mark(spec: { class: string; attributes: Record<string, string> }): { range(from: number, to: number): Range }; set(ranges: Range[], sort?: boolean): DecorationSet };
type ViewStatic = { decorations: { from(field: unknown): unknown } };
const StateEffectTyped = StateEffect as { define<T>(): EffectType<T> };
const StateFieldTyped = StateField as FieldStatic;
const DecorationTyped = Decoration as DecorationStatic;
const EditorViewTyped = EditorView as ViewStatic;
/** Effects are StateEffectType values. Transactions carry instances whose
 * `effect.is(type)` method performs the comparison (never `type.is`). */
export const setNativeReviewThreadsEffect = StateEffectTyped.define<DecorationSet>();
export const nativeReviewThreadHighlightField = StateFieldTyped.define<DecorationSet>({
  create: () => DecorationTyped.none,
  update: (value, tr) => { for (const effect of tr.effects) if (effect.is(setNativeReviewThreadsEffect)) return effect.value; return tr.docChanged ? value.map(tr.changes) : value; },
  provide: (field) => EditorViewTyped.decorations.from(field),
});

export type NativeReviewEditorView = { state?: { doc?: { length?: number } }; dispatch?: (spec: { effects: unknown }) => void };
export function applyNativeReviewThreadHighlights(view: NativeReviewEditorView | null | undefined, threads: NativeReviewThreadVisual[], text: string): void {
  if (!view?.dispatch) return; const ranges: Range[] = [];
  for (const thread of threads) { const range = resolveNativeReviewThreadAnchor(thread.anchor, text); if (!range || range.end <= range.start) continue; const color = nativeReviewThreadColor(thread); const style = nativeReviewThreadStyle(thread); ranges.push(DecorationTyped.mark({ class: `cm-annotation-highlight cm-annotation-highlight-${color} cm-annotation-style-${style} cm-native-review-thread`, attributes: { "data-native-review-thread-id": thread.threadId, "data-native-review-id": thread.reviewId, "data-native-review-document-id": thread.documentId } }).range(range.start, range.end)); }
  try { view.dispatch({ effects: setNativeReviewThreadsEffect.of(DecorationTyped.set(ranges, true)) }); } catch { /* disposed */ }
}
export function clearNativeReviewThreadHighlights(view: NativeReviewEditorView | null | undefined): void { if (view?.dispatch) try { view.dispatch({ effects: setNativeReviewThreadsEffect.of(DecorationTyped.none) }); } catch { /* disposed */ } }
export function nativeReviewThreadDoubleClickExtension(onDoubleClick: (threadId: string, target: { getBoundingClientRect?(): { left: number; right: number; top: number; bottom: number }; getAttribute(name: string): string | null }) => void) {
  return (EditorView as { domEventHandlers(handlers: Record<string, (event: Event) => boolean>): unknown }).domEventHandlers({ click: (event) => { const source = event.target; const target = source instanceof HTMLElement ? source.closest("[data-native-review-thread-id]") : null; const id = target?.getAttribute("data-native-review-thread-id"); if (!id || !target) return false; onDoubleClick(id, target); return true; } });
}
