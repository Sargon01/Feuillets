// eslint-disable-next-line import/no-extraneous-dependencies -- @codemirror/* fourni par Obsidian a l'execution
import { StateField, StateEffect } from "@codemirror/state";
// eslint-disable-next-line import/no-extraneous-dependencies -- @codemirror/* fourni par Obsidian a l'execution
import { Decoration, EditorView } from "@codemirror/view";
import type { TextAnalysisIssue } from "../api/text-analysis.js";
import { openIssueContextMenu, type ContextMenuHost } from "../services/grammar-context-menu.js";

type DecorationSet = Record<string, unknown>;

interface StateEffectType<T> {
  of(value: T): unknown;
  is(effect: unknown): effect is { value: T };
}

interface StateEffectStatic {
  define<T = unknown>(): StateEffectType<T>;
}

interface StateFieldStatic {
  define<T>(config: {
    create(): T;
    update(value: T, tr: { effects: Array<{ is(type: unknown): boolean; value: T }>; docChanged: boolean; changes: unknown }): T;
    provide?: (field: unknown) => unknown;
  }): unknown;
}

interface DecorationRange {
  from: number;
  to: number;
  attributes?: Record<string, string>;
}

interface DecorationStatic {
  none: DecorationSet;
  mark(spec: { class?: string; attributes?: Record<string, string> }): {
    range(from: number, to: number): DecorationRange;
  };
  set(of: DecorationRange[], sort?: boolean): DecorationSet;
}

interface EditorViewStatic {
  decorations: {
    from(field: unknown): unknown;
  };
  domEventHandlers(handlers: Record<string, (event: Event) => boolean | void>): unknown;
}

const StateEffectTyped = StateEffect as StateEffectStatic;
const StateFieldTyped = StateField as StateFieldStatic;
const DecorationTyped = Decoration as DecorationStatic;
const EditorViewTyped = EditorView as EditorViewStatic;

export type GrammarIssuesPayload = {
  issues: TextAnalysisIssue[];
  host?: ContextMenuHost;
  filePath?: string;
};

export const setGrammarIssuesEffect = StateEffectTyped.define<GrammarIssuesPayload>();

let activeHost: ContextMenuHost | null = null;
let activeFilePath = "";
let currentIssues: TextAnalysisIssue[] = [];

export const grammarIssuesField = StateFieldTyped.define<DecorationSet>({
  create() {
    return DecorationTyped.none;
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setGrammarIssuesEffect)) {
        const val = e.value as GrammarIssuesPayload;
        currentIssues = val.issues || [];
        if (val.host) activeHost = val.host;
        if (val.filePath !== undefined) activeFilePath = val.filePath || "";

        const decos: DecorationRange[] = [];
        const docLength = (tr as unknown as { state: { doc: { length: number } } }).state.doc.length;

        currentIssues.forEach((issue, idx) => {
          const from = issue.start;
          const to = issue.end;
          if (from < 0 || to > docLength || from >= to) return;

          const isSpelling = issue.canLearn === true || issue.category === "Orthographe";
          const cls = isSpelling
            ? "feuillets-grammar-underline feuillets-grammar-underline-spelling"
            : "feuillets-grammar-underline feuillets-grammar-underline-grammar";

          decos.push(
            DecorationTyped.mark({
              class: cls,
              attributes: { "data-grammar-idx": String(idx) },
            }).range(from, to)
          );
        });

        decos.sort((a, b) => a.from - b.from);
        return DecorationTyped.set(decos, true);
      }
    }
    return tr.docChanged ? (decorations as { map(c: unknown): DecorationSet }).map(tr.changes) : decorations;
  },
  provide: (f) => EditorViewTyped.decorations.from(f),
});

export function grammarContextMenuExtension(host: ContextMenuHost) {
  activeHost = host;
  return EditorViewTyped.domEventHandlers({
    contextmenu(event: Event) {
      const mouseEvent = event as MouseEvent;
      const el = mouseEvent.target instanceof HTMLElement ? mouseEvent.target : null;
      const target = el ? el.closest("[data-grammar-idx]") : null;
      if (!target) return false;

      const idx = Number(target.getAttribute("data-grammar-idx"));
      const issue = currentIssues[idx];
      if (!issue || !activeHost) return false;

      openIssueContextMenu(activeHost, issue, mouseEvent, activeFilePath);
      return true;
    },
  });
}

export function applyGrammarHighlights(
  editorView: { dispatch(spec: { effects?: unknown }): void } | null | undefined,
  issues: TextAnalysisIssue[] | null | undefined,
  host?: ContextMenuHost,
  filePath?: string
) {
  if (!editorView || typeof editorView.dispatch !== "function") return;

  if (!issues || issues.length === 0) {
    clearGrammarHighlights(editorView);
    return;
  }

  try {
    editorView.dispatch({
      effects: setGrammarIssuesEffect.of({ issues, host, filePath }),
    });
  } catch {
    // S'assure de ne jamais interrompre le flux d'édition
  }
}

export function clearGrammarHighlights(editorView: { dispatch(spec: { effects?: unknown }): void } | null | undefined) {
  if (editorView && typeof editorView.dispatch === "function") {
    try {
      editorView.dispatch({
        effects: setGrammarIssuesEffect.of({ issues: [] }),
      });
    } catch {
      /* ignore */
    }
  }
}
