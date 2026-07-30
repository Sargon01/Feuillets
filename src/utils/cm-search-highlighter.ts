/* Voir l'explication détaillée en tête de cm-grammar-highlighter.js :
   @codemirror/* est fourni par Obsidian à l'exécution, marqué `external`
   dans esbuild, et délibérément absent de package.json depuis 72d9303. */
/* eslint-disable import/no-extraneous-dependencies -- @codemirror/* est fourni par Obsidian a l'execution, marque external dans esbuild, jamais installe (voir 72d9303) */
import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
/* eslint-enable import/no-extraneous-dependencies -- fin de la zone d'imports fournis par l'hote */

interface DecorationSet {
  map(changes: unknown): DecorationSet;
  readonly [key: string]: unknown;
}

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
}

interface DecorationStatic {
  none: DecorationSet;
  mark(spec: { class?: string }): {
    range(from: number, to: number): DecorationRange;
  };
  set(of: DecorationRange[], sort?: boolean): DecorationSet;
}

interface EditorViewStatic {
  decorations: {
    from(field: unknown): unknown;
  };
}

export interface EditorViewInstance {
  state?: {
    doc?: {
      length?: number;
    };
  };
  dispatch?: (spec: { effects?: unknown }) => void;
}

const StateEffectTyped = StateEffect as unknown as StateEffectStatic;
const StateFieldTyped = StateField as unknown as StateFieldStatic;
const DecorationTyped = Decoration as unknown as DecorationStatic;
const EditorViewTyped = EditorView as unknown as EditorViewStatic;

export const setSearchHighlightsEffect = StateEffectTyped.define<DecorationSet>();

export const searchHighlightField = StateFieldTyped.define<DecorationSet>({
  create() {
    return DecorationTyped.none;
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setSearchHighlightsEffect)) {
        return e.value;
      }
    }
    return tr.docChanged ? decorations.map(tr.changes) : decorations;
  },
  provide: (f) => EditorViewTyped.decorations.from(f),
});

/**
 * Applique la surbrillance dynamique sur l'éditeur CodeMirror 6 actif.
 * @param {EditorViewInstance} editorView - L'instance EditorView de CodeMirror 6 (view.editor.cm)
 * @param {Array<{ index: number, length: number }>} occurrences - Occurrences dans le document actif
 * @param {number} activeIndex - Index de l'occurrence active dans le document (-1 si aucune)
 */
export function applyEditorHighlights(
  editorView: EditorViewInstance | null | undefined,
  occurrences: Array<{ index: number; length: number }> | null | undefined,
  activeIndex = -1
) {
  if (!editorView || typeof editorView.dispatch !== "function") return;

  if (!occurrences || occurrences.length === 0) {
    clearEditorHighlights(editorView);
    return;
  }

  const docLength = editorView.state?.doc?.length ?? 0;
  const decos: DecorationRange[] = [];

  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i];
    const from = occ.index;
    const to = occ.index + occ.length;
    if (from < 0 || to > docLength || from >= to) continue;

    const isActive = i === activeIndex;
    const decoClass = isActive
      ? "cm-search-highlight cm-search-highlight-active"
      : "cm-search-highlight";

    decos.push(
      DecorationTyped.mark({ class: decoClass }).range(from, to)
    );
  }

  decos.sort((a, b) => a.from - b.from);

  try {
    const decoSet = DecorationTyped.set(decos, true);
    editorView.dispatch({
      effects: setSearchHighlightsEffect.of(decoSet),
    });
  } catch {
    // S'assure de ne jamais interrompre le flux d'édition
  }
}

export function clearEditorHighlights(editorView: EditorViewInstance | null | undefined) {
  if (editorView && typeof editorView.dispatch === "function") {
    try {
      editorView.dispatch({
        effects: setSearchHighlightsEffect.of(DecorationTyped.none),
      });
    } catch { /* idem : la vue a ete detruite avant le nettoyage des surlignages */ }
  }
}
