/* Voir l'explication détaillée en tête de cm-grammar-highlighter.js :
   @codemirror/* est fourni par Obsidian à l'exécution, marqué `external`
   dans esbuild, et délibérément absent de package.json depuis 72d9303. */
/* eslint-disable import/no-extraneous-dependencies -- @codemirror/* est fourni par Obsidian a l'execution, marque external dans esbuild, jamais installe (voir 72d9303) */
import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
/* eslint-enable import/no-extraneous-dependencies -- fin de la zone d'imports fournis par l'hote */

export const setSearchHighlightsEffect = StateEffect.define();

export const searchHighlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setSearchHighlightsEffect)) {
        return e.value;
      }
    }
    return tr.docChanged ? decorations.map(tr.changes) : decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Applique la surbrillance dynamique sur l'éditeur CodeMirror 6 actif.
 * @param {object} editorView - L'instance EditorView de CodeMirror 6 (view.editor.cm)
 * @param {Array<{ index: number, length: number }>} occurrences - Occurrences dans le document actif
 * @param {number} activeIndex - Index de l'occurrence active dans le document (-1 si aucune)
 */
export function applyEditorHighlights(editorView: any, occurrences: Array<{ index: number; length: number }> | null | undefined, activeIndex = -1) {
  if (!editorView || typeof editorView.dispatch !== "function") return;

  if (!occurrences || occurrences.length === 0) {
    clearEditorHighlights(editorView);
    return;
  }

  const docLength = editorView.state.doc.length;
  const decos: any[] = [];

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
      Decoration.mark({ class: decoClass }).range(from, to)
    );
  }

  decos.sort((a, b) => a.from - b.from);

  try {
    const decoSet = Decoration.set(decos, true);
    editorView.dispatch({
      effects: setSearchHighlightsEffect.of(decoSet),
    });
  } catch {
    // S'assure de ne jamais interrompre le flux d'édition
  }
}

export function clearEditorHighlights(editorView: any) {
  if (editorView && typeof editorView.dispatch === "function") {
    try {
      editorView.dispatch({
        effects: setSearchHighlightsEffect.of(Decoration.none),
      });
    } catch { /* idem : la vue a ete detruite avant le nettoyage des surlignages */ }
  }
}
