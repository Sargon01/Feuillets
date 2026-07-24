const { StateField, StateEffect } = require("@codemirror/state");
const { Decoration, EditorView } = require("@codemirror/view");

export const setGrammarIssuesEffect = StateEffect.define();

export const grammarIssuesField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (let e of tr.effects) {
      if (e.is(setGrammarIssuesEffect)) {
        return e.value;
      }
    }
    return tr.docChanged ? decorations.map(tr.changes) : decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Souligne les signalements Grammalecte dans l'éditeur CodeMirror 6 actif.
 * @param {object} editorView - L'instance EditorView de CodeMirror 6 (view.editor.cm)
 * @param {Array<{start:number, end:number, type:string}>} issues - Signalements, offsets relatifs au corps (sans frontmatter)
 * @param {number} offset - Longueur du frontmatter retiré avant la vérification, à rajouter aux offsets
 */
export function applyGrammarHighlights(editorView, issues, offset = 0) {
  if (!editorView || typeof editorView.dispatch !== "function") return;

  if (!issues || issues.length === 0) {
    clearGrammarHighlights(editorView);
    return;
  }

  const docLength = editorView.state.doc.length;
  const decos = [];

  issues.forEach((issue, idx) => {
    const from = issue.start + offset;
    const to = issue.end + offset;
    if (from < 0 || to > docLength || from >= to) return;

    const cls =
      issue.type === "spelling"
        ? "feuillets-grammar-underline feuillets-grammar-underline-spelling"
        : "feuillets-grammar-underline feuillets-grammar-underline-grammar";

    // idx : index dans le tableau `issues` de GrammarView — permet de
    // retrouver la même ligne dans le panneau au clic (voir grammarClickHandler).
    decos.push(
      Decoration.mark({ class: cls, attributes: { "data-grammar-idx": String(idx) } }).range(from, to)
    );
  });

  decos.sort((a, b) => a.from - b.from);

  try {
    editorView.dispatch({
      effects: setGrammarIssuesEffect.of(Decoration.set(decos, true)),
    });
  } catch (e) {
    // S'assure de ne jamais interrompre le flux d'édition
  }
}

export function clearGrammarHighlights(editorView) {
  if (editorView && typeof editorView.dispatch === "function") {
    try {
      editorView.dispatch({ effects: setGrammarIssuesEffect.of(Decoration.none) });
    } catch (e) {}
  }
}

/**
 * Clic sur un mot souligné dans l'éditeur -> menu flottant à la position du
 * clic (voir GrammarView.showIssueMenu) : suggestions cliquables, ignorer/
 * apprendre, façon Ulysses — sans quitter l'éditeur ni ouvrir l'onglet.
 * plugin._grammarView est posé par le constructeur de GrammarView.
 */
export function grammarClickHandler(plugin) {
  return EditorView.domEventHandlers({
    click(event) {
      const target = event.target.closest && event.target.closest("[data-grammar-idx]");
      if (!target) return false;
      const idx = Number(target.getAttribute("data-grammar-idx"));
      if (plugin._grammarView) plugin._grammarView.showIssueMenu(idx, event);
      return false;
    },
  });
}
