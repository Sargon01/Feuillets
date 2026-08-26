import { StateEffect, StateField } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { splitFrontmatter } from "../services/frontmatter.js";
import { resolveMarkdownBlocks, planParagraphMove, type MarkdownBlock } from "./paragraph-reorder-core.js";
import { planTextFragmentMove } from "./text-fragment-reorder-core.js";
import { t } from "../i18n/index.js";

/**
 * Couche CodeMirror du déplacement de paragraphes (LOT 1, correctif
 * runtime) : activation du mode « Réorganiser le texte », Pointer Events
 * via le `PluginSpec.eventHandlers` OFFICIEL de CodeMirror (jamais des
 * `addEventListener` manuels sur `view.dom`), géométrie, overlay DOM
 * flottant pour l'indicateur de destination, connexion au moteur pur
 * (`paragraph-reorder-core.ts`) et dispatch CodeMirror. Aucune logique
 * Markdown ad hoc ici — voir le contrat du chantier, notamment §20.
 *
 * AUCUNE poignée, AUCUN agrippeur : en mode normal (StateField à `false`),
 * cette extension n'intercepte STRICTEMENT rien — chaque handler retourne
 * `false` et laisse CodeMirror traiter l'événement normalement. Voir §4.
 *
 * L'indicateur de destination n'est JAMAIS un widget CodeMirror : un
 * widget de bloc modifierait la hauteur du document et exigerait une
 * transaction à chaque `pointermove`. C'est un simple élément DOM
 * `position: fixed`, créé paresseusement dans `view.dom.ownerDocument`
 * (jamais `document` global — pop-out windows), en dehors de `contentDOM`.
 *
 * Même style que cm-scrivenings.ts : les types réels de `@codemirror/*`
 * sont fournis par Obsidian à l'exécution (codemirror-runtime.d.ts les
 * déclare `unknown`) — on ne type ici que le sous-ensemble utilisé, jamais
 * un `any`, jamais un `@ts-ignore`.
 *
 * LOT 1.2 (finition runtime) ajoute quatre correctifs UX, SANS toucher au
 * moteur pur (`paragraph-reorder-core.ts`) : un overlay « source » qui
 * identifie le Paragraph survolé/déplacé, un auto-scroll par
 * `requestAnimationFrame` exclusivement (jamais de `setInterval`), un
 * SEUL listener `keydown` temporaire posé sur `view.dom.ownerDocument`
 * (jamais `document` global) tant que le mode est actif — seule exception
 * documentée à la règle « aucun `addEventListener` manuel » ci-dessus,
 * requise parce que le mode peut être activé depuis le menu contextuel,
 * hors focus clavier de `view.dom` — et un petit indicateur de mode, en
 * enfant de `view.dom` (position absolue, hors flux), jamais du Markdown.
 */

/* --- Typage local, réutilisé (jamais `any`) ------------------------------ */

type EffectType<T> = { of(value: T): unknown };
type EffectInstance<T> = { value: T; is(type: unknown): boolean };
type FieldStatic = {
  define<T>(config: {
    create(): T;
    update(value: T, tr: TransactionLike): T;
    provide?: (field: unknown) => unknown;
  }): unknown;
};
type ChangesLike = { mapPos(pos: number, assoc?: number): number };
export type TransactionLike = { effects: EffectInstance<unknown>[]; docChanged: boolean; changes: ChangesLike };

interface DocLike {
  length: number;
  toString(): string;
  sliceString(from: number, to?: number): string;
}
/** Sous-ensemble PUBLIC de `state.selection.main` — sert UNIQUEMENT à
 * déterminer si un pointerdown tombe dans une sélection existante (§18-19
 * du contrat LOT 1.3), jamais à lui seul source de vérité pour un
 * Paragraph (qui reste le parser Lezer). */
interface EditorSelectionMainLike {
  from: number;
  to: number;
}
interface EditorStateLike {
  doc: DocLike;
  selection: {
    main: EditorSelectionMainLike;
  };
  field(field: unknown, required: false): unknown;
}
interface ChangeSpec {
  from: number;
  to: number;
  insert: string;
}

/** Rectangle générique (mêmes quatre champs qu'un `DOMRect`/le `Rect`
 * public de CodeMirror, sans en dépendre — absent de l'environnement de
 * test Node) : sert à la fois à `coordsAtPos` (position dans le document)
 * et à `contentDOM.getBoundingClientRect()` (largeur visible). La largeur
 * se déduit toujours de `right - left`, jamais d'un champ `width` séparé. */
export interface ReorderRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface ClassListLike {
  add(token: string): void;
  remove(token: string): void;
  toggle(token: string, force?: boolean): boolean;
}
interface OverlayElementLike {
  classList: ClassListLike;
  style: { top: string; left: string; width: string; height: string };
  setAttribute(name: string, value: string): void;
  remove(): void;
  textContent: string;
  appendChild(child: OverlayElementLike): void;
}
interface OwnerDocumentLike {
  createElement(tag: string): OverlayElementLike;
  body: { appendChild(el: OverlayElementLike): void };
  /** Listener `keydown` TEMPORAIRE, posé/retiré uniquement pendant que le
   * mode est actif (§14-15 du correctif) — jamais sur `document` global. */
  addEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
}
interface DomElementLike {
  classList: ClassListLike;
  ownerDocument: OwnerDocumentLike;
  /** Porte l'indicateur de mode (§18-19) : un enfant `position: absolute`
   * de `view.dom`, jamais un ajout à `contentDOM` (jamais de Markdown). */
  appendChild(el: OverlayElementLike): void;
}
interface ContentDomLike {
  getBoundingClientRect(): ReorderRect;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}
/** Sous-ensemble PUBLIC de `EditorView.scrollDOM` — jamais un autre moyen
 * de scroller (§8 du correctif : exclusivement `scrollDOM` + RAF). */
interface ScrollDomLike {
  scrollTop: number;
  getBoundingClientRect(): ReorderRect;
}

export interface ParagraphReorderViewLike {
  state: EditorStateLike;
  dom: DomElementLike;
  contentDOM: ContentDomLike;
  scrollDOM: ScrollDomLike;
  dispatch(spec: { effects?: unknown; changes?: ChangeSpec; selection?: { anchor: number; head?: number } }): void;
  posAtCoords(coords: { x: number; y: number }): number | null;
  /** API PUBLIQUE CodeMirror — sert UNIQUEMENT à dessiner l'overlay (§8) :
   * ne détermine jamais les limites d'un Paragraph. */
  coordsAtPos(pos: number): ReorderRect | null;
}
interface ViewUpdateLike {
  state: EditorStateLike;
  docChanged: boolean;
}

/** Un seul type d'événement DOM géré par handler — juste ce qui est
 * réellement branché (§3), jamais un `any`. */
type PointerHandler<This> = (this: This, event: PointerEvent) => boolean | void;
type KeyHandler<This> = (this: This, event: KeyboardEvent) => boolean | void;
interface EventHandlersSpec<This> {
  pointerdown?: PointerHandler<This>;
  pointermove?: PointerHandler<This>;
  pointerup?: PointerHandler<This>;
  pointercancel?: PointerHandler<This>;
  pointerleave?: PointerHandler<This>;
  keydown?: KeyHandler<This>;
}
type ViewPluginStatic = {
  fromClass<T>(cls: new (view: ParagraphReorderViewLike) => T, spec?: { eventHandlers?: EventHandlersSpec<T> }): unknown;
};

const StateEffectTyped = StateEffect as { define<T>(): EffectType<T> };
const StateFieldTyped = StateField as FieldStatic;
const ViewPluginTyped = ViewPlugin as ViewPluginStatic;

/* --- Mode « Réorganiser le texte » : StateEffect + StateField ------------ *
 *
 * État TEMPORAIRE, strictement local à l'EditorView (§3, §7 du contrat
 * initial) : jamais dans les settings, jamais dans FeuilletsPlugin, jamais
 * dans document.body.
 */

export const setParagraphReorderModeEffect = StateEffectTyped.define<boolean>();

export const paragraphReorderModeField = StateFieldTyped.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setParagraphReorderModeEffect)) return effect.value as boolean;
    }
    return value;
  },
});

/** Bascule le mode pour CETTE vue et retourne le nouvel état — utilisé par
 * la commande palette et le menu contextuel (main.ts). */
export function toggleParagraphReorderMode(view: ParagraphReorderViewLike): boolean {
  const current = !!view.state.field(paragraphReorderModeField, false);
  const next = !current;
  view.dispatch({ effects: setParagraphReorderModeEffect.of(next) });
  return next;
}

/* --- Géométrie pure (testable sans DOM) ----------------------------------- */

/** Seuil du geste (§6 du contrat initial) : en-deçà, on reste `pending`,
 * aucun changement du document. */
export const REORDER_DRAG_THRESHOLD = 5;

export function exceedsDragThreshold(
  startX: number,
  startY: number,
  x: number,
  y: number,
  threshold: number = REORDER_DRAG_THRESHOLD
): boolean {
  return Math.hypot(x - startX, y - startY) >= threshold;
}

/** Bloc `draggable` contenant `offset`, ou `null` — jamais un bloc non
 * draggable (§48 du contrat initial). */
export function draggableBlockAt(blocks: readonly MarkdownBlock[], offset: number): MarkdownBlock | null {
  return blocks.find((b) => b.draggable && offset >= b.from && offset <= b.to) ?? null;
}

/** Seam (§27 du contrat initial) la plus proche de `offset`, parmi
 * `blocks` (coordonnées partagées, composites ou locales selon
 * l'appelant). À l'intérieur d'un bloc, la moitié survolée choisit
 * avant/après lui ; dans un interstice entre deux blocs, il n'existe
 * qu'UNE seam possible : celle qui suit le bloc précédent. C'est cette
 * valeur LOGIQUE (un simple index) qui fait autorité pour le déplacement —
 * jamais un offset visuel reconverti après coup. */
export function seamIndexForOffset(blocks: readonly MarkdownBlock[], offset: number): number {
  const n = blocks.length;
  if (n === 0) return 0;
  for (let i = 0; i < n; i++) {
    const b = blocks[i];
    if (offset >= b.from && offset <= b.to) {
      const mid = (b.from + b.to) / 2;
      return offset < mid ? i : i + 1;
    }
  }
  if (offset <= blocks[0].from) return 0;
  for (let i = 0; i < n - 1; i++) {
    if (offset > blocks[i].to && offset < blocks[i + 1].from) return i + 1;
  }
  return n;
}

/** Offset composite où ancrer le DESSIN de l'overlay pour la seam `index`
 * — jamais utilisé pour la logique de déplacement elle-même (voir
 * `seamIndexForOffset`, qui reste la seule source de vérité côté plan). */
export function seamAnchorOffset(blocks: readonly MarkdownBlock[], index: number, segmentFrom: number, segmentTo: number): number {
  if (blocks.length === 0) return segmentFrom;
  if (index <= 0) return blocks[0].from;
  if (index >= blocks.length) return blocks[blocks.length - 1].to ?? segmentTo;
  return blocks[index].from;
}

/** Bornes `[from, to]` du segment contenant `pos`, à partir d'une liste de
 * frontières Continu (offsets bruts de `scriveningsBoundariesField` —
 * réutilisée telle quelle, jamais un second système de segments, §35 du
 * contrat initial). */
export function segmentRangeFromBoundaries(boundaries: readonly number[], docLength: number, pos: number): { from: number; to: number } {
  let start = 0;
  for (const boundary of boundaries) {
    if (pos <= boundary) return { from: start, to: boundary };
    start = boundary + 1;
  }
  return { from: start, to: docLength };
}

/** `true` si `posA` et `posB` appartiennent au MÊME segment Continu — la
 * garde de segment (§37 du contrat initial) : refusée AVANT tout dispatch. */
export function inSameSegment(boundaries: readonly number[], docLength: number, posA: number, posB: number): boolean {
  const a = segmentRangeFromBoundaries(boundaries, docLength, posA);
  const b = segmentRangeFromBoundaries(boundaries, docLength, posB);
  return a.from === b.from && a.to === b.to;
}

/** Bornes `[from, to]` du corps éditable d'un `MarkdownView` normal : tout
 * le document APRÈS son frontmatter — réutilise obligatoirement
 * `splitFrontmatter` (services/frontmatter.ts, §13 du contrat initial),
 * jamais une nouvelle regex YAML. */
export function segmentRangeForFrontmatter(fullText: string): { from: number; to: number } {
  const { frontmatter } = splitFrontmatter(fullText);
  return { from: frontmatter.length, to: fullText.length };
}

/* --- Overlay DOM flottant : fine ligne d'insertion (§6-8) ----------------- */

export const REORDER_INSERTION_LINE_CLASS = "feuillets-reorder-insertion-line";
export const REORDER_MODE_ACTIVE_CLASS = "feuillets-reorder-mode-active";
export const REORDER_HOVER_CLASS = "feuillets-reorder-hover";
export const REORDER_DRAGGING_CLASS = "feuillets-reorder-dragging";

/** Position/largeur `position: fixed` pures pour l'overlay, à partir du
 * rectangle de destination (§8) et du rectangle visible de `contentDOM` —
 * aucune dépendance DOM, testable isolément. */
export function overlayRectFor(seamRect: ReorderRect, useBottom: boolean, contentRect: ReorderRect): { top: number; left: number; width: number } {
  return {
    top: useBottom ? seamRect.bottom : seamRect.top,
    left: contentRect.left,
    width: contentRect.right - contentRect.left,
  };
}

/* --- Overlay DOM flottant : Paragraph « source » (§4-7 du correctif) ----- */

export const REORDER_SOURCE_OVERLAY_CLASS = "feuillets-reorder-source-overlay";
/** Classe posée sur l'overlay source pendant `dragging` (§5) — jamais une
 * poignée, jamais un second mécanisme : le MÊME overlay, juste plus marqué. */
export const REORDER_SOURCE_DRAGGING_CLASS = "is-dragging";
export const REORDER_MODE_INDICATOR_CLASS = "feuillets-reorder-mode-indicator";
/** Deux `<span>` distincts (jamais du HTML brut injecté) pour différencier
 * visuellement le libellé du rappel de raccourci — voir `ensureModeIndicator`. */
export const REORDER_MODE_INDICATOR_LABEL_CLASS = "feuillets-reorder-mode-label";
export const REORDER_MODE_INDICATOR_HINT_CLASS = "feuillets-reorder-mode-hint";

/* --- Fragment (LOT 1.3) : caret vertical d'insertion (§30-31 du contrat) --- */

/** Fine barre VERTICALE, jamais la ligne horizontale du Paragraph : les deux
 * ne coexistent jamais (`sourceKind` détermine lequel est dessiné, jamais
 * les deux à la fois — voir `retarget`). */
export const REORDER_FRAGMENT_CARET_CLASS = "feuillets-reorder-fragment-caret";

/** Rectangle `position: fixed` pur de l'overlay source (§6) : couvre
 * verticalement `coordsAtPos(source.from).top` → `coordsAtPos(source.to).bottom`,
 * horizontalement toute la largeur visible de `contentDOM` — jamais les
 * `.cm-line` comme source sémantique (le Paragraph vient toujours du
 * resolver Lezer, ces rects ne servent qu'au DESSIN). */
export function sourceOverlayRectFor(
  fromRect: ReorderRect,
  toRect: ReorderRect,
  contentRect: ReorderRect
): { top: number; left: number; width: number; height: number } {
  return {
    top: fromRect.top,
    left: contentRect.left,
    width: contentRect.right - contentRect.left,
    height: toRect.bottom - fromRect.top,
  };
}

/* --- Auto-scroll : géométrie pure de la vitesse progressive (§9-10) ------ */

export const AUTO_SCROLL_EDGE_PX = 56;
export const AUTO_SCROLL_MAX_PX_PER_FRAME = 18;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Delta de scroll (px, signé) pour UNE frame, à partir de la position Y du
 * pointeur et du rectangle visible de `scrollDOM` (§9-10 du correctif) :
 * négatif = vers le haut, positif = vers le bas, `0` hors zone. La vitesse
 * est progressive — `penetration` croît linéairement de 0 (bord de la zone)
 * à 1 (bord de `scrollDOM`, ou au-delà) — jamais un saut brutal. */
export function autoScrollDelta(
  pointerY: number,
  scrollRectTop: number,
  scrollRectBottom: number,
  edgePx: number = AUTO_SCROLL_EDGE_PX,
  maxPxPerFrame: number = AUTO_SCROLL_MAX_PX_PER_FRAME
): number {
  const distFromTop = pointerY - scrollRectTop;
  if (distFromTop < edgePx) {
    const penetration = clamp01((edgePx - distFromTop) / edgePx);
    return -Math.round(penetration * maxPxPerFrame);
  }
  const distFromBottom = scrollRectBottom - pointerY;
  if (distFromBottom < edgePx) {
    const penetration = clamp01((edgePx - distFromBottom) / edgePx);
    return Math.round(penetration * maxPxPerFrame);
  }
  return 0;
}

/* --- ViewPlugin : PluginSpec.eventHandlers + état local (§7, §20-21 du contrat initial) --- */

type BoundariesField = unknown;

type ReorderPhase = "idle" | "pending" | "dragging";

/** Source d'un geste de réorganisation (§14 du contrat LOT 1.3) :
 * `"paragraph"` — comportement historique, un `MarkdownBlock` entier ;
 * `"fragment"` — une sélection textuelle valide, entièrement contenue dans
 * UN Paragraph. Déterminé une fois pour toutes au `pointerdown`, jamais
 * réévalué pendant le geste. */
type ReorderSourceKind = "paragraph" | "fragment";

export class ParagraphReorderPluginValue {
  private phase: ReorderPhase = "idle";
  private sourceKind: ReorderSourceKind | null = null;
  private sourceBlock: MarkdownBlock | null = null;
  private segmentFrom = 0;
  private segmentTo = 0;
  private startX = 0;
  private startY = 0;
  /** Position document du pointerdown (§14, §22-23) : permet de replacer le
   * caret sur un simple clic Paragraph sans dépassement du seuil — jamais
   * utilisé pour un fragment (la sélection existante y est conservée
   * telle quelle). */
  private startPos = 0;
  private pointerId: number | null = null;
  private targetSeamIndex: number | null = null;
  /** Bornes de la sélection source d'un geste fragment (§7, §24) — jamais
   * modifiées pendant le geste : la source vaut toujours EXACTEMENT
   * `text.slice(fragmentFrom, fragmentTo)`. */
  private fragmentFrom = 0;
  private fragmentTo = 0;
  /** Destination COURANTE d'un geste fragment : un offset texte exact
   * (§26), jamais une seam — `null` tant qu'aucune position valide n'a été
   * survolée (§27, §35). */
  private targetOffset: number | null = null;
  private hovering = false;
  private overlayEl: OverlayElementLike | null = null;
  private sourceOverlayEl: OverlayElementLike | null = null;
  private fragmentCaretEl: OverlayElementLike | null = null;
  private modeIndicatorEl: OverlayElementLike | null = null;

  private cachedBlocks: MarkdownBlock[] | null = null;
  private cachedSegFrom = -1;
  private cachedSegTo = -1;
  private frontmatterLen: number | null = null;

  /** `true` tant que le listener Escape temporaire (§14-15) est posé sur
   * `ownerDocument` — au plus UN par instance de plugin. */
  private globalEscapeInstalled = false;
  /** Mémorise l'état précédent du mode pour ne (dés)installer le listener
   * Escape et l'indicateur qu'aux TRANSITIONS, jamais à chaque `update()`. */
  private modeWasActive = false;

  /** Dernières coordonnées écran connues du pointeur pendant `dragging`
   * (§11) — seule source de vérité pour chaque frame RAF d'auto-scroll,
   * y compris quand le pointeur ne bouge plus mais que le document défile. */
  private lastPointerX = 0;
  private lastPointerY = 0;
  /** Identifiant `requestAnimationFrame` de l'UNIQUE boucle d'auto-scroll
   * en cours, ou `null` — jamais deux boucles simultanées (§11-12). */
  private autoScrollHandle: number | null = null;

  constructor(
    protected readonly view: ParagraphReorderViewLike,
    private readonly boundariesField: BoundariesField
  ) {}

  /** Listener Escape temporaire (§14) : un SEUL Escape, quelle que soit la
   * provenance du focus, appelle `exitReorderMode()` — jamais de second
   * raccourci global (§14 : « aucun autre raccourci global »). */
  private readonly handleGlobalEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    this.exitReorderMode(); // idempotent : no-op si le mode est déjà inactif (§17)
  };

  destroy(): void {
    this.removeGlobalEscapeListener();
    this.releaseCapture();
    this.stopAutoScroll();
    this.removeOverlay();
    this.removeSourceOverlay();
    this.removeFragmentCaret();
    this.removeModeIndicator();
  }

  update(update: ViewUpdateLike): void {
    if (update.docChanged) {
      this.cachedBlocks = null;
      this.frontmatterLen = null;
    }
    const active = !!update.state.field(paragraphReorderModeField, false);
    this.view.dom.classList.toggle(REORDER_MODE_ACTIVE_CLASS, active);
    if (active && !this.modeWasActive) {
      this.installGlobalEscapeListener();
      this.ensureModeIndicator();
    } else if (!active && this.modeWasActive) {
      this.removeGlobalEscapeListener();
    }
    if (!active) this.resetAll();
    this.modeWasActive = active;
  }

  /* --- eventHandlers (branchés via createParagraphReorderExtension) ----- */

  handlePointerDown(event: PointerEvent): boolean {
    if (!this.modeActive() || event.button !== 0) return false;
    // §16-17 du contrat LOT 1.3 : Shift et double/triple-clic appartiennent
    // à CodeMirror — sortie AVANT tout posAtCoords/résolution Markdown.
    if (event.shiftKey) return false;
    if (event.detail > 1) return false;

    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    // §18-19 : priorité ABSOLUE à une sélection fragment valide contenant
    // `pos` (borne droite EXCLUSIVE) sur la résolution Paragraph.
    const selectionMain = this.view.state.selection.main;
    if (selectionMain.from !== selectionMain.to && pos >= selectionMain.from && pos < selectionMain.to) {
      const fragment = this.tryResolveFragmentSource(selectionMain.from, selectionMain.to);
      if (fragment) {
        event.preventDefault();
        this.phase = "pending";
        this.sourceKind = "fragment";
        this.fragmentFrom = selectionMain.from;
        this.fragmentTo = selectionMain.to;
        this.segmentFrom = fragment.segmentFrom;
        this.segmentTo = fragment.segmentTo;
        this.startX = event.clientX;
        this.startY = event.clientY;
        this.startPos = pos;
        this.capturePointer(event.pointerId);
        return true;
      }
      // §20 : sélection existante mais invalide comme fragment (traverse
      // plusieurs blocs, un type non-Paragraph, deux segments…) — ne
      // jamais la couper : retomber sur la résolution Paragraph ci-dessous.
    }

    // §21 : fallback Paragraph — EXACTEMENT la logique existante.
    const segment = this.resolveSegment(pos);
    const blocks = this.resolveBlocks(segment.from, segment.to);
    const block = draggableBlockAt(blocks, pos);
    if (!block) return false; // hors d'un vrai Paragraph : comportement natif intact (§5 du contrat initial)

    event.preventDefault(); // empêche le démarrage d'une sélection de texte
    this.phase = "pending";
    this.sourceKind = "paragraph";
    this.sourceBlock = block;
    this.segmentFrom = segment.from;
    this.segmentTo = segment.to;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startPos = pos;
    this.capturePointer(event.pointerId);
    return true;
  }

  /** Valide `[from, to)` comme source fragment (§19 du contrat LOT 1.3) :
   * même segment (Continu ou frontmatter, via `resolveSegment` — jamais un
   * second système), et entièrement contenue dans UN SEUL Paragraph Lezer
   * résolu depuis CE segment (`resolveBlocks`, jamais le DOM). Retourne
   * `null` si l'une de ces conditions échoue — jamais une correction ou une
   * découpe de la sélection (§20, §36). */
  private tryResolveFragmentSource(from: number, to: number): { segmentFrom: number; segmentTo: number } | null {
    const segment = this.resolveSegment(from);
    if (to < segment.from || to > segment.to) return null; // §36 : cross-segment
    const blocks = this.resolveBlocks(segment.from, segment.to);
    const paragraph = blocks.find((b) => b.draggable && from >= b.from && to <= b.to);
    if (!paragraph) return null;
    return { segmentFrom: segment.from, segmentTo: segment.to };
  }

  handlePointerMove(event: PointerEvent): boolean {
    if (this.phase === "idle") {
      if (this.modeActive()) this.updateHoverCursor(event.clientX, event.clientY);
      return false;
    }
    if (this.phase === "pending") {
      if (!exceedsDragThreshold(this.startX, this.startY, event.clientX, event.clientY)) return true; // sous le seuil : rien ne bouge
      this.phase = "dragging";
      this.view.dom.classList.add(REORDER_DRAGGING_CLASS);
    }
    this.updateDragTarget(event.clientX, event.clientY);
    return true;
  }

  handlePointerUp(event: PointerEvent): boolean {
    if (this.phase === "idle") return false;
    const wasDragging = this.phase === "dragging";
    this.releaseCapture();
    if (wasDragging) {
      if (this.sourceKind === "fragment") this.commitFragmentMove();
      else this.commitMove();
    } else if (this.sourceKind === "paragraph") {
      // §22 : clic simple sans drag sur un Paragraph — replace le caret,
      // aucun changement de texte.
      this.view.dispatch({ selection: { anchor: this.startPos } });
    }
    // §23 : clic simple dans une sélection fragment (pending, sans drag) —
    // ne rien dispatcher : la sélection existante reste intacte.
    this.removeOverlay();
    this.resetGesture(); // le mode, lui, RESTE actif (§12 du contrat initial) ; stoppe aussi l'auto-scroll (§12 du correctif)
    // Le mode reste actif après un drop réussi (§7 du correctif) : on
    // recalcule le hover — et donc l'overlay source — normalement, jamais
    // un résidu de l'état `dragging`.
    this.updateHoverCursor(event.clientX, event.clientY);
    return true;
  }

  handlePointerCancel(): boolean {
    if (this.phase === "idle") return false;
    this.releaseCapture();
    this.removeOverlay();
    this.removeSourceOverlay(); // §7 : pointercancel supprime aussi la source
    this.resetGesture(); // mode toujours actif (§13 du contrat initial) ; supprime aussi le caret fragment (§38)
    return true;
  }

  handlePointerLeave(): boolean {
    // Ne jamais interrompre un geste en cours simplement parce que le
    // pointeur quitte momentanément contentDOM pendant que la capture est
    // active (§15) : seul le survol simple (idle) réagit ici.
    if (this.phase === "idle") {
      this.setHover(false);
      this.removeSourceOverlay(); // §7 : pointeur hors Paragraph en idle
    }
    return false;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key !== "Escape" || !this.modeActive()) return false;
    this.exitReorderMode();
    event.preventDefault();
    return true;
  }

  /** Sortie du mode « Réorganiser le texte » (§16-17 du correctif) : appelée
   * par le `PluginSpec.keydown` CodeMirror ET par le listener Escape
   * temporaire posé sur `ownerDocument` (§14) — TOUJOURS le même helper,
   * jamais deux logiques distinctes. Idempotente : si le mode est déjà
   * inactif (le premier Escape a déjà traité l'événement), ne fait rien —
   * c'est ce qui rend le second Escape éventuel sans effet (§17). */
  private exitReorderMode(): void {
    if (!this.modeActive()) return;
    if (this.phase !== "idle") {
      this.releaseCapture();
      this.removeOverlay();
      this.removeSourceOverlay();
      this.resetGesture(); // supprime aussi le caret fragment (§39)
    } else {
      this.setHover(false);
      this.removeSourceOverlay();
    }
    // UN seul Escape suffit à sortir du mode, geste en cours ou non (§16 du
    // correctif).
    this.view.dispatch({ effects: setParagraphReorderModeEffect.of(false) });
  }

  private installGlobalEscapeListener(): void {
    if (this.globalEscapeInstalled) return;
    this.view.dom.ownerDocument.addEventListener("keydown", this.handleGlobalEscape, true);
    this.globalEscapeInstalled = true;
  }

  private removeGlobalEscapeListener(): void {
    if (!this.globalEscapeInstalled) return;
    this.view.dom.ownerDocument.removeEventListener("keydown", this.handleGlobalEscape, true);
    this.globalEscapeInstalled = false;
  }

  /* --- Résolution segment/blocs (identique au lot initial) -------------- */

  private modeActive(): boolean {
    return !!this.view.state.field(paragraphReorderModeField, false);
  }

  private frontmatterLength(): number {
    if (this.frontmatterLen == null) {
      this.frontmatterLen = segmentRangeForFrontmatter(this.view.state.doc.toString()).from;
    }
    return this.frontmatterLen;
  }

  private resolveSegment(pos: number): { from: number; to: number } {
    const docLength = this.view.state.doc.length;
    if (this.boundariesField) {
      const boundaries = (this.view.state.field(this.boundariesField, false) as number[] | undefined) || [];
      return segmentRangeFromBoundaries(boundaries, docLength, pos);
    }
    return { from: this.frontmatterLength(), to: docLength };
  }

  private resolveBlocks(segFrom: number, segTo: number): MarkdownBlock[] {
    if (this.cachedBlocks && this.cachedSegFrom === segFrom && this.cachedSegTo === segTo) return this.cachedBlocks;
    const text = this.view.state.doc.sliceString(segFrom, segTo);
    const blocks = resolveMarkdownBlocks(text).map((b) => ({ ...b, from: b.from + segFrom, to: b.to + segFrom }));
    this.cachedBlocks = blocks;
    this.cachedSegFrom = segFrom;
    this.cachedSegTo = segTo;
    return blocks;
  }

  private setHover(hovering: boolean): void {
    if (hovering === this.hovering) return;
    this.hovering = hovering;
    this.view.dom.classList.toggle(REORDER_HOVER_CLASS, hovering);
  }

  private updateHoverCursor(clientX: number, clientY: number): void {
    const pos = this.view.posAtCoords({ x: clientX, y: clientY });
    if (pos == null) {
      this.setHover(false);
      this.removeSourceOverlay();
      return;
    }
    const segment = this.resolveSegment(pos);
    const blocks = this.resolveBlocks(segment.from, segment.to);
    const block = draggableBlockAt(blocks, pos);
    this.setHover(!!block);
    if (block) this.drawSourceOverlayForBlock(block, false);
    else this.removeSourceOverlay();
  }

  /* --- Geste de déplacement ---------------------------------------------- */

  private updateDragTarget(clientX: number, clientY: number): void {
    this.lastPointerX = clientX;
    this.lastPointerY = clientY;
    this.retarget(clientX, clientY);
    this.syncAutoScroll();
  }

  /** Recalcule la cible + redessine l'indicateur approprié pour les
   * coordonnées données — factorisé pour être appelé aussi bien par
   * `pointermove` que par chaque frame RAF d'auto-scroll (§11, point 5 du
   * correctif ; §34 du contrat LOT 1.3), jamais dupliqué. Branche sur
   * `sourceKind` (§14 du contrat LOT 1.3) : un fragment et un Paragraph
   * n'affichent jamais leur indicateur simultanément (§30, §32-33). */
  private retarget(clientX: number, clientY: number): void {
    if (this.sourceKind === "fragment") {
      this.retargetFragment(clientX, clientY);
      return;
    }
    if (!this.sourceBlock) return;
    const pos = this.view.posAtCoords({ x: clientX, y: clientY });
    const validSegment =
      pos != null &&
      (this.boundariesField
        ? inSameSegment(
            (this.view.state.field(this.boundariesField, false) as number[] | undefined) || [],
            this.view.state.doc.length,
            this.sourceBlock.from,
            pos
          )
        : pos >= this.segmentFrom && pos <= this.segmentTo);

    if (!validSegment) {
      this.targetSeamIndex = null;
      this.removeOverlay();
    } else {
      const blocks = this.resolveBlocks(this.segmentFrom, this.segmentTo);
      const seamIndex = seamIndexForOffset(blocks, pos);
      this.targetSeamIndex = seamIndex; // valeur LOGIQUE, seule source de vérité pour le plan (§9 du correctif)
      this.drawOverlayForSeam(blocks, seamIndex);
    }
    this.drawSourceOverlayForBlock(this.sourceBlock, true);
  }

  /** Cible d'un geste fragment (§26-27, §35 du contrat LOT 1.3) : un offset
   * texte EXACT, jamais une seam. Valide uniquement si `pos` appartient au
   * MÊME segment que la source (comparaison stricte des bornes, jamais
   * seulement le garde-fou Continu), hors `[fragmentFrom, fragmentTo]`, et
   * à l'intérieur d'un Paragraph Lezer résolu depuis ce segment. */
  private retargetFragment(clientX: number, clientY: number): void {
    const pos = this.view.posAtCoords({ x: clientX, y: clientY });
    if (pos == null || !this.isValidFragmentTarget(pos)) {
      this.targetOffset = null;
      this.removeFragmentCaret();
      return;
    }
    this.targetOffset = pos;
    this.drawFragmentCaret(pos);
  }

  private isValidFragmentTarget(pos: number): boolean {
    const targetSegment = this.resolveSegment(pos);
    if (targetSegment.from !== this.segmentFrom || targetSegment.to !== this.segmentTo) return false; // §35
    if (pos >= this.fragmentFrom && pos <= this.fragmentTo) return false; // §10/§27 : jamais dans la source
    const blocks = this.resolveBlocks(this.segmentFrom, this.segmentTo);
    return !!draggableBlockAt(blocks, pos); // §27 : uniquement à l'intérieur d'un Paragraph
  }

  private drawOverlayForSeam(blocks: MarkdownBlock[], seamIndex: number): void {
    const anchor = seamAnchorOffset(blocks, seamIndex, this.segmentFrom, this.segmentTo);
    const seamRect = this.view.coordsAtPos(anchor);
    if (!seamRect) {
      this.removeOverlay(); // destination visuellement invalide (§8 du correctif)
      return;
    }
    const useBottom = blocks.length > 0 && seamIndex >= blocks.length;
    const contentRect = this.view.contentDOM.getBoundingClientRect();
    const { top, left, width } = overlayRectFor(seamRect, useBottom, contentRect);
    const el = this.ensureOverlay();
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.width = `${width}px`;
  }

  private ensureOverlay(): OverlayElementLike {
    if (this.overlayEl) return this.overlayEl;
    const doc = this.view.dom.ownerDocument; // jamais `document` global (pop-out windows, §7)
    const el = doc.createElement("div");
    el.classList.add(REORDER_INSERTION_LINE_CLASS); // `position: fixed` vit dans la classe CSS (styles.css), jamais posé ici
    el.setAttribute("aria-hidden", "true");
    doc.body.appendChild(el);
    this.overlayEl = el;
    return el;
  }

  private removeOverlay(): void {
    if (!this.overlayEl) return;
    this.overlayEl.remove();
    this.overlayEl = null;
  }

  /* --- Overlay « source » : Paragraph survolé/déplacé (§4-7 du correctif) --- */

  /** Dessine (ou déplace) l'overlay source pour `block`, `dragging` portant
   * la classe `is-dragging` (§5). Ne modifie JAMAIS le document, jamais la
   * hauteur ni le padding du texte : uniquement `coordsAtPos` + géométrie
   * pure (`sourceOverlayRectFor`). Coordonnées indisponibles → overlay
   * masqué (§6). */
  private drawSourceOverlayForBlock(block: MarkdownBlock, dragging: boolean): void {
    const fromRect = this.view.coordsAtPos(block.from);
    const toRect = this.view.coordsAtPos(block.to);
    if (!fromRect || !toRect) {
      this.removeSourceOverlay();
      return;
    }
    const contentRect = this.view.contentDOM.getBoundingClientRect();
    const { top, left, width, height } = sourceOverlayRectFor(fromRect, toRect, contentRect);
    const el = this.ensureSourceOverlay();
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.classList.toggle(REORDER_SOURCE_DRAGGING_CLASS, dragging);
  }

  private ensureSourceOverlay(): OverlayElementLike {
    if (this.sourceOverlayEl) return this.sourceOverlayEl;
    const doc = this.view.dom.ownerDocument; // jamais `document` global (pop-out windows, §7)
    const el = doc.createElement("div");
    el.classList.add(REORDER_SOURCE_OVERLAY_CLASS); // `position: fixed` vit dans la classe CSS, jamais posé ici
    el.setAttribute("aria-hidden", "true");
    doc.body.appendChild(el);
    this.sourceOverlayEl = el;
    return el;
  }

  private removeSourceOverlay(): void {
    if (!this.sourceOverlayEl) return;
    this.sourceOverlayEl.remove();
    this.sourceOverlayEl = null;
  }

  /* --- Caret fragment : fine barre verticale (§30-32 du contrat LOT 1.3) --- *
   *
   * La sélection CodeMirror existante représente déjà la source (§32) : ce
   * caret ne dessine QUE la destination, jamais un second overlay source.
   * Géométrie pure via `coordsAtPos`, largeur fixe posée en CSS (jamais en
   * JS, voir `styles.css`) — seuls `top`/`left`/`height` varient ici. */

  private drawFragmentCaret(pos: number): void {
    const rect = this.view.coordsAtPos(pos);
    if (!rect) {
      this.removeFragmentCaret();
      return;
    }
    const el = this.ensureFragmentCaret();
    el.style.top = `${rect.top}px`;
    el.style.left = `${rect.left}px`;
    el.style.height = `${rect.bottom - rect.top}px`;
  }

  private ensureFragmentCaret(): OverlayElementLike {
    if (this.fragmentCaretEl) return this.fragmentCaretEl;
    const doc = this.view.dom.ownerDocument; // jamais `document` global (pop-out windows)
    const el = doc.createElement("div");
    el.classList.add(REORDER_FRAGMENT_CARET_CLASS);
    el.setAttribute("aria-hidden", "true");
    doc.body.appendChild(el);
    this.fragmentCaretEl = el;
    return el;
  }

  private removeFragmentCaret(): void {
    if (!this.fragmentCaretEl) return;
    this.fragmentCaretEl.remove();
    this.fragmentCaretEl = null;
  }

  /* --- Auto-scroll : exclusivement scrollDOM + requestAnimationFrame (§8-12) --- */

  /** Démarre/arrête l'UNIQUE boucle RAF selon que le pointeur est ou non
   * dans une zone de bord de `scrollDOM` — jamais depuis l'intérieur de la
   * boucle elle-même (voir `startAutoScrollLoop`), pour ne jamais risquer
   * une seconde boucle concurrente. */
  private syncAutoScroll(): void {
    const rect = this.view.scrollDOM.getBoundingClientRect();
    const delta = autoScrollDelta(this.lastPointerY, rect.top, rect.bottom);
    if (delta === 0) {
      this.stopAutoScroll();
      return;
    }
    this.startAutoScrollLoop();
  }

  private startAutoScrollLoop(): void {
    if (this.autoScrollHandle != null) return; // jamais deux boucles simultanées (§11)
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
    const step = (): void => {
      this.autoScrollHandle = null;
      if (this.phase !== "dragging") return; // §12 : arrêt si le geste s'est terminé entre-temps
      const rect = this.view.scrollDOM.getBoundingClientRect();
      const delta = autoScrollDelta(this.lastPointerY, rect.top, rect.bottom);
      if (delta === 0) return; // §12 : pointeur sorti de la zone de bord
      this.view.scrollDOM.scrollTop += delta;
      this.retarget(this.lastPointerX, this.lastPointerY); // §11, point 5 : overlays recalculés sur les dernières coordonnées
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        this.autoScrollHandle = window.requestAnimationFrame(step);
      }
    };
    this.autoScrollHandle = window.requestAnimationFrame(step);
  }

  private stopAutoScroll(): void {
    if (this.autoScrollHandle == null) return;
    if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(this.autoScrollHandle);
    }
    this.autoScrollHandle = null;
  }

  /* --- Indicateur de mode (§18-20 du correctif) --------------------------- */

  /** Enfant `position: absolute` de `view.dom` (jamais `contentDOM`, jamais
   * de Markdown) : ne prend aucune place dans le flux, ne déplace aucun
   * texte. Purement textuel — AUCUN élément interactif : Escape reste
   * l'unique façon de quitter le mode. Deux `<span>` (jamais de HTML brut
   * injecté) pour différencier le libellé du rappel de raccourci en CSS. */
  private ensureModeIndicator(): void {
    if (this.modeIndicatorEl) return;
    const doc = this.view.dom.ownerDocument;
    const el = doc.createElement("div");
    el.classList.add(REORDER_MODE_INDICATOR_CLASS);

    const label = doc.createElement("span");
    label.classList.add(REORDER_MODE_INDICATOR_LABEL_CLASS);
    label.textContent = t("editorMenu.reorderMode.label");
    el.appendChild(label);

    const hint = doc.createElement("span");
    hint.classList.add(REORDER_MODE_INDICATOR_HINT_CLASS);
    hint.textContent = t("editorMenu.reorderMode.hint");
    el.appendChild(hint);

    this.view.dom.appendChild(el);
    this.modeIndicatorEl = el;
  }

  private removeModeIndicator(): void {
    if (!this.modeIndicatorEl) return;
    this.modeIndicatorEl.remove();
    this.modeIndicatorEl = null;
  }

  private commitMove(): void {
    if (!this.sourceBlock || this.targetSeamIndex == null) return;
    const blocks = this.resolveBlocks(this.segmentFrom, this.segmentTo);
    const localBlocks = blocks.map((b) => ({ ...b, from: b.from - this.segmentFrom, to: b.to - this.segmentFrom }));
    const sourceIndex = blocks.findIndex((b) => b.from === this.sourceBlock!.from && b.to === this.sourceBlock!.to);
    if (sourceIndex === -1) return;
    const segmentText = this.view.state.doc.sliceString(this.segmentFrom, this.segmentTo);
    const plan = planParagraphMove(segmentText, localBlocks, sourceIndex, this.targetSeamIndex);
    if (!plan) return; // no-op (§28 du contrat initial) : aucune transaction

    this.view.dispatch({
      changes: { from: plan.from + this.segmentFrom, to: plan.to + this.segmentFrom, insert: plan.insert },
      selection: { anchor: plan.selectionOffset + this.segmentFrom },
    });
  }

  /** Commit d'un geste fragment (§37 du contrat LOT 1.3) : le texte du
   * segment SEUL est extrait (jamais le composite Continu entier, §28), le
   * plan pur (`text-fragment-reorder-core.ts`) calcule la fenêtre unique, et
   * la transaction — `changes` + `selection` — part en UNE seule dispatch,
   * offsets rebasés sur `segmentFrom` exactement comme `commitMove`. `null`
   * (no-op ou target invalidée entre-temps) : aucune transaction. */
  private commitFragmentMove(): void {
    if (this.targetOffset == null) return;
    const segmentText = this.view.state.doc.sliceString(this.segmentFrom, this.segmentTo);
    const localFrom = this.fragmentFrom - this.segmentFrom;
    const localTo = this.fragmentTo - this.segmentFrom;
    const localTarget = this.targetOffset - this.segmentFrom;
    const plan = planTextFragmentMove(segmentText, localFrom, localTo, localTarget);
    if (!plan) return; // no-op (§10) : aucune transaction

    this.view.dispatch({
      changes: { from: plan.from + this.segmentFrom, to: plan.to + this.segmentFrom, insert: plan.insert },
      selection: { anchor: plan.selectionFrom + this.segmentFrom, head: plan.selectionTo + this.segmentFrom },
    });
  }

  private capturePointer(pointerId: number): void {
    this.pointerId = pointerId;
    if (typeof this.view.contentDOM.setPointerCapture === "function") {
      try {
        this.view.contentDOM.setPointerCapture(pointerId);
      } catch {
        /* capture non supportée dans cet environnement : sans conséquence */
      }
    }
  }

  private releaseCapture(): void {
    if (this.pointerId != null && typeof this.view.contentDOM.releasePointerCapture === "function") {
      try {
        this.view.contentDOM.releasePointerCapture(this.pointerId);
      } catch {
        /* déjà relâchée : sans conséquence */
      }
    }
    this.pointerId = null;
  }

  /** Fin d'un geste (pointerup/pointercancel/Escape pendant pending ou
   * dragging) : le MODE, lui, reste actif — voir chaque appelant. */
  private resetGesture(): void {
    this.phase = "idle";
    this.sourceKind = null;
    this.sourceBlock = null;
    this.targetSeamIndex = null;
    this.fragmentFrom = 0;
    this.fragmentTo = 0;
    this.targetOffset = null;
    this.removeFragmentCaret(); // §38-39 : jamais de résidu du caret fragment après un geste
    this.setHover(false);
    this.view.dom.classList.remove(REORDER_DRAGGING_CLASS);
    this.stopAutoScroll(); // §12 : fin de geste = arrêt systématique de l'auto-scroll
  }

  /** Désactivation complète (mode éteint, `destroy()`) : geste, overlays ET
   * indicateur — aucun résidu DOM (§7). */
  private resetAll(): void {
    this.resetGesture();
    this.releaseCapture();
    this.removeOverlay();
    this.removeSourceOverlay();
    this.removeModeIndicator();
  }
}

/**
 * Construit l'extension complète du mode « Réorganiser le texte » : le
 * StateField de mode + le ViewPlugin, dont les Pointer Events passent
 * EXCLUSIVEMENT par le `PluginSpec.eventHandlers` officiel de CodeMirror
 * (`this` lié à l'instance du plugin par CodeMirror lui-même — jamais un
 * `addEventListener` manuel, jamais de listener `document`/`window`
 * supplémentaire).
 *
 * `boundariesField` — le `scriveningsBoundariesField` de cm-scrivenings.ts,
 * PASSÉ EN PARAMÈTRE pour ne jamais créer de dépendance circulaire (même
 * règle que cm-scrivenings-markdown.ts) — n'est fourni que pour Continu ;
 * omis, cette extension utilise le frontmatter (§13 du contrat initial)
 * comme unique frontière de segment, pour un `MarkdownView` normal.
 */
export function createParagraphReorderExtension(boundariesField?: BoundariesField): unknown[] {
  const eventHandlers: EventHandlersSpec<ParagraphReorderPluginValue> = {
    pointerdown(event) {
      return this.handlePointerDown(event);
    },
    pointermove(event) {
      return this.handlePointerMove(event);
    },
    pointerup(event) {
      return this.handlePointerUp(event);
    },
    pointercancel() {
      return this.handlePointerCancel();
    },
    pointerleave() {
      return this.handlePointerLeave();
    },
    keydown(event) {
      return this.handleKeyDown(event);
    },
  };

  const plugin = ViewPluginTyped.fromClass(
    class extends ParagraphReorderPluginValue {
      constructor(view: ParagraphReorderViewLike) {
        super(view, boundariesField);
      }
    },
    { eventHandlers }
  );
  return [paragraphReorderModeField, plugin];
}
