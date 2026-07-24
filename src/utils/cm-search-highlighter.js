const { StateField, StateEffect } = require("@codemirror/state");
const { Decoration, EditorView } = require("@codemirror/view");

export const setSearchHighlightsEffect = StateEffect.define();

export const searchHighlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (let e of tr.effects) {
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
export function applyEditorHighlights(editorView, occurrences, activeIndex = -1) {
  if (!editorView || typeof editorView.dispatch !== "function") return;

  if (!occurrences || occurrences.length === 0) {
    clearEditorHighlights(editorView);
    return;
  }

  const docLength = editorView.state.doc.length;
  const decos = [];

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
  } catch (e) {
    // S'assure de ne jamais interrompre le flux d'édition
  }
}

export function clearEditorHighlights(editorView) {
  if (editorView && typeof editorView.dispatch === "function") {
    try {
      editorView.dispatch({
        effects: setSearchHighlightsEffect.of(Decoration.none),
      });
    } catch (e) {}
  }
}
