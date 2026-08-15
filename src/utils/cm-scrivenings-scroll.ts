import type { ScriveningsDocument, ScriveningsSegment } from "../services/scrivenings-document.js";
import { segmentAt } from "../services/scrivenings-document.js";

/**
 * Géométrie de défilement de Continu (LOT 2B.1) : primitives PURES qui
 * répondent à « quel feuillet est visible, à quelle progression verticale »
 * et à son inverse « replacer le viewport sur ce feuillet, à cette
 * progression » — sans jamais toucher au Vault, à Preview, ni au document
 * CodeMirror (aucun dispatch, aucune transaction, jamais de curseur
 * déplacé). ScriveningsView (views/scrivenings-view.ts) n'est qu'un mince
 * adaptateur autour de ce module : toute la géométrie vit ici, testable sans
 * monter un vrai CodeMirror.
 *
 * SOURCE DE VÉRITÉ DES SEGMENTS — `services/scrivenings-document.ts`
 * (`ScriveningsSegment`, `segmentAt`) : ce module ne construit jamais sa
 * propre table de correspondance offset → fichier.
 *
 * API CodeMirror PUBLIQUE utilisée, et seulement elle :
 * - `EditorView.scrollDOM` (élément DOM réellement défilé) ;
 * - `EditorView.documentTop` (conversion écran → coordonnées document) ;
 * - `EditorView.elementAtHeight(height)` (bloc sous une hauteur document) ;
 * - `EditorView.lineBlockAt(pos)` (géométrie de la ligne à une position).
 * Jamais `editor.cm`, jamais de propriété privée CodeMirror, jamais de
 * `querySelector` sur `.cm-line` : voir `ScriveningsScrollView` ci-dessous,
 * qui ne déclare que cette surface.
 */

/** Ancre de défilement : le feuillet actuellement visible et la progression
 * verticale DANS ce feuillet — 0 = début (titre compris), 1 = fin. Toujours
 * bornée, indépendante de toute notion de Preview (voir §5 du lot). */
export type ScriveningsScrollAnchor = {
  path: string;
  progress: number;
};

/** Sous-ensemble RÉELLEMENT utilisé du `BlockInfo` public de CodeMirror —
 * jamais le type complet, dont le reste de la surface n'a aucun usage ici. */
export interface ScriveningsBlockInfo {
  readonly from: number;
  readonly to: number;
  readonly top: number;
  readonly bottom: number;
}

/** Sous-ensemble RÉELLEMENT utilisé de `EditorView.scrollDOM` (un vrai
 * `HTMLElement` à l'exécution — cette interface n'existe que pour rendre le
 * module testable avec un faux DOM, comme `ScrollLike` dans
 * preview-scroll-sync.ts). */
export interface ScriveningsScrollDom {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  getBoundingClientRect(): { top: number };
}

/** Surface CodeMirror PUBLIQUE réellement consommée par ce module — voir
 * l'en-tête de fichier pour la liste. `ScriveningsView` y passe directement
 * son `EditorView` réel (structurellement compatible), les tests un faux
 * objet minimal. */
export interface ScriveningsScrollView {
  readonly scrollDOM: ScriveningsScrollDom;
  readonly documentTop: number;
  readonly contentHeight: number;
  elementAtHeight(height: number): ScriveningsBlockInfo;
  lineBlockAt(pos: number): ScriveningsBlockInfo;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Position verticale du bord supérieur du viewport, dans le repère
 * CodeMirror ("coordonnées document"). `scrollDOM.scrollTop` seul ne suffit
 * PAS : paddings et widgets peuvent le rendre différent de la position
 * document réelle — voir `EditorView.documentTop`.
 */
export function scriveningsViewportTop(view: ScriveningsScrollView): number {
  return view.scrollDOM.getBoundingClientRect().top - view.documentTop;
}

/**
 * Progression verticale VISUELLE (jamais comptée en caractères) à
 * `viewportTop` à l'intérieur de `segment` : le sommet du segment inclut
 * naturellement son widget de titre (`lineBlockAt(segment.from).top`, qui
 * fusionne le bloc du widget avec la première ligne dans la géométrie
 * CodeMirror) — un viewport posé exactement sur le titre produit donc 0 sans
 * traitement spécial. Hauteur nulle ou invalide → 0, jamais NaN.
 */
export function scriveningsSegmentProgress(view: ScriveningsScrollView, segment: ScriveningsSegment, viewportTop: number): number {
  const top = view.lineBlockAt(segment.from).top;
  const bottom = view.lineBlockAt(segment.to).bottom;
  const height = bottom - top;
  if (!(height > 0)) return 0;
  return clamp01((viewportTop - top) / height);
}

/** Segment le plus proche d'un offset composite potentiellement hors bornes
 * (repli robuste demandé §4 du lot : jamais un chemin inexistant, même si
 * `elementAtHeight()` tombe exactement sur une jonction structurelle ou que
 * l'offset dépasse le document). */
function nearestSegment(doc: ScriveningsDocument, offset: number): ScriveningsSegment | null {
  if (doc.segments.length === 0) return null;
  const last = doc.segments[doc.segments.length - 1];
  const clamped = clampNumber(offset, 0, last.to);
  return segmentAt(doc, clamped) ?? last;
}

/**
 * Feuillet actuellement visible dans Continu, et progression verticale dans
 * ce feuillet. `null` si le document est vide (aucun scope chargé) — jamais
 * un chemin inventé.
 */
export function getScriveningsScrollAnchor(
  view: ScriveningsScrollView | null | undefined,
  doc: ScriveningsDocument | null | undefined
): ScriveningsScrollAnchor | null {
  if (!view || !doc || doc.segments.length === 0) return null;

  const viewportTop = scriveningsViewportTop(view);
  const block = view.elementAtHeight(viewportTop);
  const segment = nearestSegment(doc, block.from);
  if (!segment) return null;

  return { path: segment.path, progress: scriveningsSegmentProgress(view, segment, viewportTop) };
}

/**
 * Position de `scrollDOM.scrollTop` qui amènerait le viewport à `progress`
 * (borné) dans le feuillet `path` — fonction PURE, aucun effet de bord :
 * c'est `scrollScriveningsToAnchor` ci-dessous qui l'applique réellement.
 * `null` si `path` n'appartient pas au document courant : aucun défilement
 * ne doit alors avoir lieu.
 */
export function computeScriveningsScrollTop(view: ScriveningsScrollView, doc: ScriveningsDocument, path: string, progress: number): number | null {
  const segment = doc.segments.find((s) => s.path === path);
  if (!segment) return null;

  const top = view.lineBlockAt(segment.from).top;
  const bottom = view.lineBlockAt(segment.to).bottom;
  const targetHeight = top + clamp01(progress) * (bottom - top);

  const delta = targetHeight - scriveningsViewportTop(view);
  const maxScrollTop = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
  return clampNumber(view.scrollDOM.scrollTop + delta, 0, maxScrollTop);
}

/**
 * Replace le viewport de Continu sur `path` à `progress` — jamais de
 * curseur déplacé, jamais de sélection modifiée, jamais de transaction
 * document dispatchée, jamais de dirty state produit : seul
 * `scrollDOM.scrollTop` est écrit. Sans effet si `path` est absent du
 * document courant (voir `computeScriveningsScrollTop`).
 */
export function scrollScriveningsToAnchor(view: ScriveningsScrollView, doc: ScriveningsDocument, path: string, progress: number): void {
  const nextScrollTop = computeScriveningsScrollTop(view, doc, path, progress);
  if (nextScrollTop === null) return;
  view.scrollDOM.scrollTop = nextScrollTop;
}
