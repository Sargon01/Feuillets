import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { liveTypographyChanges, type LiveTypographySettings, type TypographyChange } from "./live-typography.js";

export interface TypographyState {
  doc: { length: number; toString(): string; sliceString(from: number, to?: number): string };
  selection: { main: { from: number; to: number } };
  field(field: unknown, required: false): unknown;
}
interface TypographyTransaction {
  startState: TypographyState;
  newDoc: TypographyState["doc"];
  docChanged: boolean;
  isUserEvent(event: string): boolean;
  changes: {
    iterChanges(fn: (fromA: number, toA: number, fromB: number, toB: number, inserted: { toString(): string }) => void): void;
    mapPos(position: number, assoc?: number): number;
  };
}
type TypographyView = { state: TypographyState; composing: boolean };
/** Segment coordinates refer to the document BEFORE the transaction. Native
 * Markdown uses the whole document; Continu supplies just one source body. */
export type TypographyContext = { from: number; to: number };

export function typographySegmentContext(state: TypographyState, boundaries: readonly number[], from: number, to: number): TypographyContext | null {
  const previous = boundaries.filter((offset) => offset < from);
  const start = previous[previous.length - 1];
  const end = boundaries.find((offset) => offset >= from) ?? state.doc.length;
  return to <= end ? { from: start === undefined ? 0 : start + 1, to: end } : null;
}

/** Uses public CM6 hooks: observe (never consume) clipboard data, then amend
 * only input transactions. The sequential spec keeps native selection mapping,
 * annotations and a single history event, including native HTML conversion. */
export function createLiveTypographyExtension(
  settings: () => LiveTypographySettings,
  context: (state: TypographyState, from: number, to: number) => TypographyContext | null,
): unknown[] {
  const clipboard = new WeakMap<TypographyState, { plain?: string; skip: boolean; event: ClipboardEvent }>();
  const stateAPI = EditorState as { transactionFilter: { of(fn: (tr: TypographyTransaction) => unknown): unknown } };
  const viewAPI = EditorView as { domEventObservers(handlers: { paste(event: ClipboardEvent, view: TypographyView): void }): unknown };
  return [
    viewAPI.domEventObservers({ paste(event, view) {
      const state = view.state;
      const selection = state.selection.main;
      if (!context(state, selection.from, selection.to)) return;
      const data = event.clipboardData;
      const snapshot = {
        event,
        plain: data?.types.includes("text/plain") ? data.getData("text/plain") : undefined,
        skip: event.defaultPrevented || view.composing || Array.from(data?.items ?? []).some((item) => item.kind === "file"),
      };
      clipboard.set(state, snapshot);
      // No clipboard content survives this paste's synchronous dispatch.
      queueMicrotask(() => { if (clipboard.get(state) === snapshot) clipboard.delete(state); });
    } }),
    stateAPI.transactionFilter.of((tr) => {
      const paste = tr.isUserEvent("input.paste");
      if (!tr.docChanged || (!paste && !tr.isUserEvent("input.type")) || tr.isUserEvent("input.type.compose")) return tr;
      const snapshot = paste ? clipboard.get(tr.startState) : undefined;
      if (snapshot?.skip || snapshot?.event.defaultPrevented) return tr;
      const corrections: TypographyChange[] = [];
      tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        const input = inserted.toString();
        const options = settings();
        if (!(options.liveApostrophe && input.includes("'")) &&
          !(options.liveEllipsis && tr.newDoc.sliceString(Math.max(0, fromB - 2), toB).includes("...")) &&
          !(paste && snapshot?.plain !== undefined && input.includes("\u00a0"))) return;
        const segment = context(tr.startState, fromA, toA);
        if (!segment) return;
        const from = tr.changes.mapPos(segment.from, -1);
        const to = tr.changes.mapPos(segment.to, 1);
        const text = tr.newDoc.sliceString(from, to);
        for (const change of liveTypographyChanges(text, [{ from: fromB - from, to: toB - from }], options, paste, snapshot?.plain)) {
          corrections.push({ ...change, from: change.from + from, to: change.to + from });
        }
      });
      if (!corrections.length) return tr;
      corrections.sort((a, b) => a.from - b.from);
      return [tr, { changes: corrections, sequential: true }];
    }),
  ];
}
