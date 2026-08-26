import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type { ComparisonDecoration } from "../services/comparison-plan.js";
import { t } from "../i18n/index.js";

/**
 * Couche CodeMirror d'une comparaison — la SEULE chose que Feuillets ajoute
 * aux deux textes. Les deux côtés sont de vraies vues Markdown d'Obsidian :
 * c'est lui qui rend le texte, avec son thème, sa police, sa largeur, ses
 * alinéas et ses extensions. Ici, rien que des décorations temporaires,
 * jamais du Markdown : marques de différence, libellés de déplacement et
 * cartouche de décision. Rien d'autre — pas de fantôme qui dupliquerait un
 * passage déjà visible en face, pas de cale d'alignement.
 *
 * Tout est posé par effet et retiré par effet : à la fermeture de la
 * comparaison, chaque éditeur redevient exactement ce qu'il était.
 */

export type ComparisonEditorView = {
  state?: { doc?: { length?: number } };
  dispatch?: (spec: { effects: unknown }) => void;
};

/** Même repli non documenté que `annotationCmView` (main.ts) : Obsidian
 * n'expose la vue CodeMirror 6 d'un `Editor` que via cette propriété. */
export function comparisonEditorCmView(editor: unknown): ComparisonEditorView | null {
  const cm = (editor as { cm?: unknown } | null)?.cm;
  return (cm as ComparisonEditorView) ?? null;
}

type DecorationSet = { map(changes: unknown): DecorationSet };
type Range = { from: number; to?: number };
type EffectType<T> = { of(value: T): unknown };
type EffectInstance<T> = { value: T; is(type: unknown): boolean };
type FieldStatic = { define<T>(config: { create(): T; update(value: T, tr: { effects: EffectInstance<T>[]; docChanged: boolean; changes: unknown }): T; provide?: (field: unknown) => unknown }): unknown };
type MarkSpec = { class: string; attributes: Record<string, string> };
type WidgetSpec = { widget: unknown; side: number };
type DecorationStatic = {
  none: DecorationSet;
  mark(spec: MarkSpec): { range(from: number, to: number): Range };
  widget(spec: WidgetSpec): { range(from: number): Range };
  set(ranges: Range[], sort?: boolean): DecorationSet;
};
type FacetLike = { from(field: unknown, get?: (value: unknown) => unknown): unknown };
type ViewStatic = { decorations: FacetLike; editable: FacetLike; domEventHandlers(handlers: Record<string, (event: Event, view: unknown) => boolean>): unknown };
type StateStatic = { readOnly: FacetLike };
const StateEffectTyped = StateEffect as { define<T>(): EffectType<T> };
const StateFieldTyped = StateField as FieldStatic;
const DecorationTyped = Decoration as DecorationStatic;
const EditorViewTyped = EditorView as ViewStatic;
const EditorStateTyped = EditorState as StateStatic;

/* --- Décorations -------------------------------------------------------- */

/** Effects are StateEffectType values. Transactions carry instances whose
 * `effect.is(type)` method performs the comparison (never `type.is`). */
export const setComparisonDecorationsEffect = StateEffectTyped.define<DecorationSet>();
export const comparisonDecorationField = StateFieldTyped.define<DecorationSet>({
  create: () => DecorationTyped.none,
  update: (value, tr) => { for (const effect of tr.effects) if (effect.is(setComparisonDecorationsEffect)) return effect.value; return tr.docChanged ? value.map(tr.changes) : value; },
  provide: (field) => EditorViewTyped.decorations.from(field),
});

/* --- Lecture seule ------------------------------------------------------
   La version comparée s'ouvre dans un vrai éditeur Obsidian, mais ne se
   modifie pas : c'est une copie de référence. Le verrou est conditionnel et
   porté par l'état de CETTE vue seulement — aucun autre éditeur du coffre
   n'est touché, et il disparaît avec la comparaison. */
export const setComparisonReadOnlyEffect = StateEffectTyped.define<boolean>();
export const comparisonReadOnlyField = StateFieldTyped.define<boolean>({
  create: () => false,
  update: (value, tr) => { for (const effect of tr.effects) if (effect.is(setComparisonReadOnlyEffect)) return effect.value; return value; },
  provide: (field) => [
    EditorStateTyped.readOnly.from(field),
    EditorViewTyped.editable.from(field, (locked) => !locked),
  ],
});

export function setComparisonReadOnly(view: ComparisonEditorView | null | undefined, locked: boolean): void {
  if (view?.dispatch) try { view.dispatch({ effects: setComparisonReadOnlyEffect.of(locked) }); } catch { /* editor was disposed */ }
}

/* --- Widgets ------------------------------------------------------------
   `createEl` (global Obsidian) et non `container.createEl(...)` : CodeMirror
   crée ces widgets hors de tout conteneur et les rattache lui-même — les
   construire dans un parent les ferait apparaître fugitivement ailleurs. */

function element(tag: "span" | "div" | "button", className: string, text?: string): HTMLElement {
  return createEl(tag, { cls: className || undefined, text: text || undefined });
}

/** Libellé numéroté d'un déplacement (« Déplacé 2 → »), qui relie ses deux
 * emplacements. Jamais du Markdown, et jamais une copie du texte déplacé :
 * celui-ci est déjà lisible à sa place, des deux côtés. */
export class ComparisonLabelWidget extends WidgetType {
  constructor(readonly index: number, readonly className: string, readonly text: string) { super(); }
  eq(other: ComparisonLabelWidget): boolean { return this.index === other.index && this.className === other.className && this.text === other.text; }
  toDOM(): HTMLElement {
    const node = element("span", this.className, this.text);
    node.setAttribute("data-comparison-change", String(this.index));
    node.setAttribute("aria-hidden", this.text ? "false" : "true");
    return node;
  }
}

export type ComparisonActionsSpec = Extract<ComparisonDecoration, { type: "actions" }>;

/** Cartouche de décision, à l'endroit exact du changement sélectionné. Se
 * ferme sans décider ni écrire — bouton `×`, Escape ou clic extérieur (voir
 * comparisonClickExtension) — ce qui n'est jamais confondu avec un bouton de
 * décision : `data-comparison-close`, jamais `data-comparison-action`.
 *
 * Ses boutons ne portent AUCUN écouteur propre : une seule voie d'événement
 * existe pour toute la comparaison — `comparisonClickExtension()`, posée une
 * fois sur l'éditeur (voir main.ts) — jamais une seconde en parallèle. */
export class ComparisonActionsWidget extends WidgetType {
  constructor(readonly spec: ComparisonActionsSpec) { super(); }
  eq(other: ComparisonActionsWidget): boolean { return JSON.stringify(this.spec) === JSON.stringify(other.spec); }
  /**
   * Par défaut, CodeMirror ignore TOUT événement dont la cible est à
   * l'intérieur d'un widget (`WidgetType.ignoreEvent`, doc CM6) — avant même
   * que `comparisonClickExtension()` (posée via `domEventHandlers`) ne soit
   * consultée : `eventBelongsToEditor()` s'arrête dès qu'un ancêtre du widget
   * répond `ignoreEvent() === true`, et l'événement n'atteint jamais les
   * gestionnaires. C'est la cause exacte pour laquelle les boutons du
   * cartouche restaient inertes. Seuls les trois types que
   * `comparisonClickExtension()` écoute réellement doivent donc remonter —
   * tout le reste (mousedown, glisser, etc.) garde le comportement par
   * défaut de CodeMirror.
   */
  ignoreEvent(event: Event): boolean {
    return event.type !== "click" && event.type !== "dblclick" && event.type !== "keydown";
  }
  toDOM(): HTMLElement {
    const zone = element("span", "cm-comparison-actions");
    zone.setAttribute("data-comparison-change", String(this.spec.index));
    zone.appendChild(element("span", "cm-comparison-action-label", this.spec.label));
    if (this.spec.hint) zone.appendChild(element("span", "cm-comparison-action-hint", this.spec.hint));
    for (const button of this.spec.buttons) {
      const node = element("button", `cm-comparison-action-button${button.cta ? " mod-cta" : ""}`, button.text);
      node.setAttribute("type", "button");
      node.setAttribute("data-comparison-change", String(this.spec.index));
      node.setAttribute("data-comparison-action", button.action);
      zone.appendChild(node);
    }
    const close = element("button", "cm-comparison-action-close", "×");
    close.setAttribute("type", "button");
    close.setAttribute("data-comparison-close", String(this.spec.index));
    close.setAttribute("aria-label", t("modal.close"));
    zone.appendChild(close);
    return zone;
  }
}

/* --- Pose et retrait ---------------------------------------------------- */

/** Convertit le plan en plages CodeMirror. Une position hors document est
 * ignorée plutôt que devinée : le texte reste intégralement lisible. */
export function comparisonDecorationRanges(decorations: ComparisonDecoration[], docLength: number): Range[] {
  const inside = (position: number): boolean => Number.isSafeInteger(position) && position >= 0 && position <= docLength;
  const ranges: Range[] = [];
  for (const decoration of decorations) {
    if (decoration.type === "mark") {
      if (!inside(decoration.from) || !inside(decoration.to) || decoration.to <= decoration.from) continue;
      const attributes: Record<string, string> = decoration.role === "note"
        ? { "data-comparison-note": String(decoration.index) }
        : { "data-comparison-change": String(decoration.index) };
      ranges.push(DecorationTyped.mark({ class: decoration.class, attributes }).range(decoration.from, decoration.to));
      continue;
    }
    if (!inside(decoration.at)) continue;
    if (decoration.type === "label") ranges.push(DecorationTyped.widget({ widget: new ComparisonLabelWidget(decoration.index, decoration.class, decoration.text), side: decoration.side }).range(decoration.at));
    else ranges.push(DecorationTyped.widget({ widget: new ComparisonActionsWidget(decoration), side: 2 }).range(decoration.at));
  }
  return ranges;
}

export function applyComparisonDecorations(view: ComparisonEditorView | null | undefined, decorations: ComparisonDecoration[]): void {
  if (!view?.dispatch) return;
  const ranges = comparisonDecorationRanges(decorations, view.state?.doc?.length ?? 0);
  try { view.dispatch({ effects: setComparisonDecorationsEffect.of(DecorationTyped.set(ranges, true)) }); } catch { /* editor was disposed */ }
}

export function clearComparisonDecorations(view: ComparisonEditorView | null | undefined): void {
  if (view?.dispatch) try { view.dispatch({ effects: setComparisonDecorationsEffect.of(DecorationTyped.none) }); } catch { /* disposed */ }
}

/* --- Clics --------------------------------------------------------------
   Relié à la comparaison ouverte par un pub/sub interne au module, jamais un
   événement DOM global : testable sans navigateur. La comparaison s'abonne à
   son ouverture et se désabonne à sa fermeture (voir comparison-view.ts). */

/**
 * `select`/`note`/`apply`/`ignore`/`restore` : décision ou navigation, comme
 * avant. `recenter` : double-clic — appelle `recenterOnActive()`, jamais une
 * décision. `dismiss` : ferme le cartouche SANS décider ni écrire — bouton
 * `×`, Escape, ou un clic qui ne touche aucune décoration (donc "hors du
 * cartouche") ; `comparison-view.ts` l'ignore si rien n'est sélectionné.
 */
export type ComparisonClickAction = "select" | "note" | "apply" | "ignore" | "restore" | "recenter" | "dismiss";
/** `x`/`y` : coin bas-gauche de l'élément cliqué, pour qu'un menu s'ouvre
 * exactement sous le passage concerné. Absents quand la mesure n'est pas
 * disponible — un menu s'ouvre alors sans être positionné, jamais ailleurs. */
export interface ComparisonClickDetail { path: string; index: number; action: ComparisonClickAction; x?: number; y?: number; }
type ComparisonClickListener = (detail: ComparisonClickDetail) => void;
const clickListeners = new Set<ComparisonClickListener>();
export function onComparisonClick(listener: ComparisonClickListener): () => void {
  clickListeners.add(listener);
  return () => clickListeners.delete(listener);
}

type ClickEditorView = { state: { field(field: unknown, required?: boolean): { file?: { path?: string } } | undefined } };
const ACTIONS: ReadonlySet<string> = new Set(["apply", "ignore", "restore"]);
/** Sentinelle : un `dismiss` déclenché hors de tout changement précis (clic
 * extérieur, Escape) ne porte pas d'index réel — `comparison-view.ts` ne le
 * lit jamais pour ce type d'action, seulement pour fermer si besoin. */
const NO_INDEX = -1;

function pathOf(view: unknown): string | undefined {
  return ((view as ClickEditorView).state.field(editorInfoField, false))?.file?.path;
}
function notify(path: string, index: number, action: ComparisonClickAction, rect?: { left: number; bottom: number }): void {
  // `x`/`y` n'existent sur le détail QUE si une mesure a été prise — jamais
  // des clés présentes-mais-`undefined`, qu'un abonné pourrait confondre
  // avec une mesure ratée plutôt qu'une mesure jamais tentée.
  const detail: ComparisonClickDetail = rect ? { path, index, action, x: rect.left, y: rect.bottom } : { path, index, action };
  for (const listener of [...clickListeners]) listener(detail);
}

/**
 * Extension globale, enregistrée une seule fois (voir main.ts). Un clic sur
 * une marque ne "consomme" jamais l'événement : le texte reste un Markdown
 * ordinaire, placer le curseur au clic continue de fonctionner. Seul un
 * bouton (décision ou fermeture) intercepte réellement — c'est un contrôle,
 * pas du texte.
 */
export function comparisonClickExtension(): unknown {
  return EditorViewTyped.domEventHandlers({
    click: (event, view) => {
      const source = event.target;
      if (!(source instanceof HTMLElement)) return false;
      const path = pathOf(view);
      if (!path) return false;
      const close = source.closest("[data-comparison-close]");
      if (close) { notify(path, NO_INDEX, "dismiss"); return true; }
      const button = source.closest("[data-comparison-action]");
      if (button) {
        const action = button.getAttribute("data-comparison-action") ?? "";
        const index = Number(button.getAttribute("data-comparison-change"));
        if (!ACTIONS.has(action) || !Number.isSafeInteger(index)) return false;
        notify(path, index, action as ComparisonClickAction);
        return true;
      }
      const target = source.closest("[data-comparison-change],[data-comparison-note]");
      if (!target) { notify(path, NO_INDEX, "dismiss"); return false; }
      const note = target.getAttribute("data-comparison-note");
      const index = Number(note ?? target.getAttribute("data-comparison-change"));
      if (!Number.isSafeInteger(index)) return false;
      notify(path, index, note === null ? "select" : "note", target.getBoundingClientRect?.());
      return false;
    },
    /** Double-clic : recentre les deux vues sur ce changement — jamais une
     * décision. Ignoré sur un bouton (décision ou fermeture), qui a déjà son
     * propre comportement au simple clic. */
    dblclick: (event, view) => {
      const source = event.target;
      if (!(source instanceof HTMLElement)) return false;
      const path = pathOf(view);
      if (!path) return false;
      if (source.closest("[data-comparison-action],[data-comparison-close]")) return false;
      const target = source.closest("[data-comparison-change]");
      if (!target) return false;
      const index = Number(target.getAttribute("data-comparison-change"));
      if (!Number.isSafeInteger(index)) return false;
      notify(path, index, "recenter");
      return false;
    },
    /** Échap ferme un cartouche ouvert, sans jamais consommer la touche —
     * Obsidian/CodeMirror peuvent avoir leur propre usage (fermer une
     * recherche, par exemple). */
    keydown: (event, view) => {
      if ((event as KeyboardEvent).key !== "Escape") return false;
      const path = pathOf(view);
      if (!path) return false;
      notify(path, NO_INDEX, "dismiss");
      return false;
    },
  });
}
