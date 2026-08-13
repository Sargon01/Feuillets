/* Voir l'explication détaillée en tête de cm-grammar-highlighter.js :
   @codemirror/* est fourni par Obsidian à l'exécution, marqué `external`
   dans esbuild, et délibérément absent de package.json depuis 72d9303. */
/* eslint-disable import/no-extraneous-dependencies -- @codemirror/* est fourni par Obsidian a l'execution, marque external dans esbuild, jamais installe (voir 72d9303) */
import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
/* eslint-enable import/no-extraneous-dependencies -- fin de la zone d'imports fournis par l'hote */

/** Surlignage des annotations de relecture dans l'éditeur CodeMirror 6 —
 * même modèle que cm-search-highlighter.ts (StateField + StateEffect +
 * Decoration.mark, mapping via tr.changes). Volontairement PAS le modèle
 * de cm-grammar-highlighter.ts : celui-ci garde en plus un état mutable au
 * niveau du module (activeHost/activeFilePath/currentIssues) pour son menu
 * contextuel — rien de tel ici. Tout ce dont ce module a besoin (id,
 * position, couleur) est porté par la décoration elle-même ; aucune
 * donnée d'annotation n'est conservée ailleurs que dans le StateField. */

export type AnnotationHighlightColor = "yellow" | "green" | "blue" | "pink";
export type AnnotationHighlightStyle = "highlight" | "underline" | "strikethrough";

const ANNOTATION_COLORS: readonly AnnotationHighlightColor[] = ["yellow", "green", "blue", "pink"];

/** Une entrée à surligner : la position n'est fournie que si l'annotation
 * a pu être résolue dans le texte courant (voir resolveAnnotation,
 * services/annotations.ts) — `range: null` signifie "non résolue" et est
 * ignorée proprement, jamais dessinée au hasard. */
export interface AnnotationHighlightInput {
  id: string;
  color: AnnotationHighlightColor;
  style?: AnnotationHighlightStyle;
  range: { start: number; end: number } | null;
}

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

export interface EditorViewInstance {
  state?: {
    doc?: {
      length?: number;
    };
  };
  dispatch?: (spec: { effects?: unknown }) => void;
  /** API PUBLIQUE et documentée de @codemirror/view (pas une API interne
   * Obsidian) : coordonnées écran d'une position du document — sert
   * uniquement à ancrer le popover de création près de la sélection (voir
   * coordsAtOffset ci-dessous, utilisé par main.ts). */
  coordsAtPos?: (pos: number) => AnchorRect | null;
}

const StateEffectTyped = StateEffect as StateEffectStatic;
const StateFieldTyped = StateField as StateFieldStatic;
const DecorationTyped = Decoration as DecorationStatic;
const EditorViewTyped = EditorView as EditorViewStatic;

/** Classe commune à toute décoration d'annotation, quelle que soit sa
 * couleur — permet un sélecteur CSS générique en plus du sélecteur par
 * couleur (voir annotationHighlightClass). */
export const ANNOTATION_HIGHLIGHT_CLASS = "cm-annotation-highlight";

export function annotationHighlightColorClass(color: AnnotationHighlightColor): string {
  return `cm-annotation-highlight-${color}`;
}
export function annotationHighlightStyleClass(style: AnnotationHighlightStyle = "highlight"): string { return `cm-annotation-style-${style}`; }

function isValidColor(color: string): color is AnnotationHighlightColor {
  return (ANNOTATION_COLORS as readonly string[]).includes(color);
}
function isValidStyle(style: string): style is AnnotationHighlightStyle { return ["highlight", "underline", "strikethrough"].includes(style); }

export const setAnnotationHighlightsEffect = StateEffectTyped.define<DecorationSet>();

/** StateField dédié, propre à ce module — aucun état partagé avec
 * cm-grammar-highlighter.ts ni aucun autre surlignage. Les décorations
 * suivent automatiquement les modifications du document (tr.changes),
 * exactement comme searchHighlightField. */
export const annotationHighlightField = StateFieldTyped.define<DecorationSet>({
  create() {
    return DecorationTyped.none;
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setAnnotationHighlightsEffect)) {
        return e.value;
      }
    }
    return tr.docChanged ? decorations.map(tr.changes) : decorations;
  },
  provide: (f) => EditorViewTyped.decorations.from(f),
});

/** Rectangle générique (mêmes quatre champs qu'un DOMRect, sans dépendre du
 * type DOMRect lui-même — absent de l'environnement de test Node, voir
 * ui/annotation-popover.ts) : sert à positionner le popover d'annotation
 * près d'un passage, qu'il vienne d'un élément décoré (getBoundingClientRect)
 * ou d'une position calculée dans l'éditeur (EditorView.coordsAtPos). */
export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** La décoration DOM sur laquelle porte un double-clic — juste assez pour
 * relire son id et, si besoin, sa position à l'écran (popover d'édition,
 * voir ui/annotation-popover.ts). Jamais gardé au-delà de l'appel du
 * callback : aucune donnée d'annotation n'est conservée dans ce module. */
export interface AnnotationDecorationTarget {
  getAttribute(name: string): string | null;
  getBoundingClientRect?(): AnchorRect;
}

/**
 * Extension CodeMirror qui détecte un double-clic sur une décoration
 * d'annotation ([data-annotation-id]) et transmet l'id ainsi que l'élément
 * décoré (pour ancrer le popover d'édition près de lui) au callback fourni
 * — jamais l'objet Annotation complet, jamais de donnée conservée dans ce
 * module (le callback est fermé sur cette instance d'extension, pas sur
 * une variable de module comme activeHost dans cm-grammar-highlighter.ts).
 * Un simple clic n'est pas intercepté : le comportement natif de l'éditeur
 * (positionner le curseur) reste intact.
 */
interface ClosestCapable {
  closest(selector: string): AnnotationDecorationTarget | null;
}

function hasClosest(value: unknown): value is ClosestCapable {
  return !!value && typeof (value as ClosestCapable).closest === "function";
}

export function annotationDoubleClickExtension(
  onDoubleClick: (id: string, target: AnnotationDecorationTarget) => void
) {
  return EditorViewTyped.domEventHandlers({
    dblclick(event: Event) {
      const mouseEvent = event as MouseEvent;
      const el = hasClosest(mouseEvent.target) ? mouseEvent.target : null;
      const target = el ? el.closest("[data-annotation-id]") : null;
      if (!target) return false;
      const id = target.getAttribute("data-annotation-id");
      if (!id) return false;
      onDoubleClick(id, target);
      return true;
    },
  });
}

/**
 * Construit et applique les décorations de surlignage des annotations sur
 * l'éditeur CodeMirror 6 actif, à partir des annotations déjà résolues du
 * fichier courant. Ignore proprement (sans lever) :
 * - les annotations non résolues (`range: null`) ;
 * - les plages négatives ou invalides (start < 0, start >= end) ;
 * - les plages dépassant la fin du document ;
 * - une couleur qui ne serait pas l'une des quatre attendues.
 *
 * Chaque décoration porte la classe commune ANNOTATION_HIGHLIGHT_CLASS, la
 * classe de couleur (cm-annotation-highlight-{yellow|green|blue|pink}) et
 * l'attribut data-annotation-id avec l'id stable de l'annotation.
 */
export function applyAnnotationHighlights(
  editorView: EditorViewInstance | null | undefined,
  annotations: AnnotationHighlightInput[] | null | undefined
): void {
  if (!editorView || typeof editorView.dispatch !== "function") return;

  if (!annotations || annotations.length === 0) {
    clearAnnotationHighlights(editorView);
    return;
  }

  const docLength = editorView.state?.doc?.length ?? 0;
  const decos: DecorationRange[] = [];

  for (const annotation of annotations) {
    const { id, color, range } = annotation;
    const style = annotation.style ?? "highlight";
    if (!range) continue; // non résolue : jamais devinée
    if (!isValidColor(color)) continue;
    if (!isValidStyle(style)) continue;
    const { start, end } = range;
    if (start < 0 || end <= start || end > docLength) continue;

    decos.push(
      DecorationTyped.mark({
        class: `${ANNOTATION_HIGHLIGHT_CLASS} ${annotationHighlightColorClass(color)} ${annotationHighlightStyleClass(style)}`,
        attributes: { "data-annotation-id": id },
      }).range(start, end)
    );
  }

  decos.sort((a, b) => a.from - b.from);

  try {
    const decoSet = DecorationTyped.set(decos, true);
    editorView.dispatch({
      effects: setAnnotationHighlightsEffect.of(decoSet),
    });
  } catch {
    // S'assure de ne jamais interrompre le flux d'édition
  }
}

/** Retire tous les surlignages d'annotations de l'éditeur actif — remplace
 * simplement le DecorationSet par Decoration.none, sans toucher au
 * document. */
export function clearAnnotationHighlights(editorView: EditorViewInstance | null | undefined): void {
  if (editorView && typeof editorView.dispatch === "function") {
    try {
      editorView.dispatch({
        effects: setAnnotationHighlightsEffect.of(DecorationTyped.none),
      });
    } catch { /* idem : la vue a ete detruite avant le nettoyage des surlignages */ }
  }
}

/** Coordonnées écran d'une position du document — sert à ancrer le popover
 * de CRÉATION près de la sélection (voir ui/annotation-popover.ts,
 * main.ts createAnnotationFromSelection). `null` si l'éditeur n'expose pas
 * `coordsAtPos` ou si la position n'est pas visible/mesurable : à
 * l'appelant de retomber sur une position par défaut, jamais deviné ici. */
export function coordsAtOffset(editorView: EditorViewInstance | null | undefined, pos: number): AnchorRect | null {
  if (!editorView || typeof editorView.coordsAtPos !== "function") return null;
  try {
    return editorView.coordsAtPos(pos) ?? null;
  } catch {
    return null;
  }
}
