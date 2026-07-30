/* @codemirror/* est FOURNI PAR OBSIDIAN à l'exécution, exactement comme le
   module "obsidian" : ces paquets sont marqués `external` dans
   esbuild.config.mjs et ne sont jamais bundlés. Ils ne figurent volontairement
   pas dans package.json depuis 72d9303 — leurs contraintes de version rendaient
   `npm ci` insoluble. Les déclarer pour satisfaire le linter réintroduirait
   cette panne d'installation, donc la règle est désactivée ici, sciemment. */
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

interface EditorViewInstance {
  state: {
    doc: {
      length: number;
    };
  };
  dispatch(spec: { effects?: unknown }): void;
}

const StateEffectTyped = StateEffect as StateEffectStatic;
const StateFieldTyped = StateField as StateFieldStatic;
const DecorationTyped = Decoration as DecorationStatic;
const EditorViewTyped = EditorView as EditorViewStatic;

export const setGrammarIssuesEffect = StateEffectTyped.define<DecorationSet>();

export const grammarIssuesField = StateFieldTyped.define<DecorationSet>({
  create() {
    return DecorationTyped.none;
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setGrammarIssuesEffect)) {
        return e.value;
      }
    }
    return tr.docChanged ? decorations.map(tr.changes) : decorations;
  },
  provide: (f) => EditorViewTyped.decorations.from(f),
});

/**
 * Souligne les signalements Grammalecte dans l'éditeur CodeMirror 6 actif.
 * @param {EditorViewInstance} editorView - L'instance EditorView de CodeMirror 6 (view.editor.cm)
 * @param {Array<{start:number, end:number, type:string}>} issues - Signalements, offsets relatifs au corps (sans frontmatter)
 * @param {number} offset - Longueur du frontmatter retiré avant la vérification, à rajouter aux offsets
 */
export function applyGrammarHighlights(
  editorView: EditorViewInstance,
  issues: Array<{ start: number; end: number; type: string }> | null | undefined,
  offset = 0
) {
  if (!editorView || typeof editorView.dispatch !== "function") return;

  if (!issues || issues.length === 0) {
    clearGrammarHighlights(editorView);
    return;
  }

  const docLength = editorView.state.doc.length;
  const decos: DecorationRange[] = [];

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
      DecorationTyped.mark({ class: cls, attributes: { "data-grammar-idx": String(idx) } }).range(from, to)
    );
  });

  decos.sort((a, b) => a.from - b.from);

  try {
    editorView.dispatch({
      effects: setGrammarIssuesEffect.of(DecorationTyped.set(decos, true)),
    });
  } catch {
    // S'assure de ne jamais interrompre le flux d'édition
  }
}

export function clearGrammarHighlights(editorView: EditorViewInstance) {
  if (editorView && typeof editorView.dispatch === "function") {
    try {
      editorView.dispatch({ effects: setGrammarIssuesEffect.of(DecorationTyped.none) });
    } catch { /* dispatch sur un EditorView deja detruit (onglet ferme entre-temps) : il n'y a plus rien a effacer */ }
  }
}

/**
 * Clic sur un mot souligné dans l'éditeur -> menu flottant à la position du
 * clic (voir GrammarView.showIssueMenu) : suggestions cliquables, ignorer/
 * apprendre, façon Ulysses — sans quitter l'éditeur ni ouvrir l'onglet.
 * plugin._grammarView est posé par le constructeur de GrammarView.
 */
export function grammarClickHandler(plugin: { _grammarView?: { showIssueMenu(index: number, event: MouseEvent): void } }) {
  return EditorViewTyped.domEventHandlers({
    click(event: Event) {
      const mouseEvent = event as MouseEvent;
      const el = mouseEvent.target instanceof HTMLElement ? mouseEvent.target : null;
      const target = el ? el.closest("[data-grammar-idx]") : null;
      if (!target) return false;
      const idx = Number(target.getAttribute("data-grammar-idx"));
      if (plugin._grammarView) plugin._grammarView.showIssueMenu(idx, mouseEvent);
      return false;
    },
  });
}
