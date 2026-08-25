/* Couche de COMPOSITION A4 partagée par toutes les sorties papier de la
 * Présentation qui posent PLUSIEURS diapositives sur une même feuille :
 *
 *   - Support à distribuer (handout) : 2 ou 4 diapositives par page ;
 *   - Plan de présentation : 4 diapositives par page + notes personnelles.
 *
 * Elle ne connaît NI le Markdown, NI le planificateur, NI le renderer, NI le
 * pipeline d'impression : elle reçoit des sections DÉJÀ rendues (le DOM final
 * 1280×720 produit par presentation-slide-renderer.ts) et les dispose dans
 * une grille A4. Aucune slide n'est jamais recomposée à une autre largeur :
 * seule une échelle « contain » calculée à partir de la place réellement
 * disponible réduit le clone (voir fitPresentationThumbnails).
 *
 * C'est volontairement la SEULE brique de pagination papier : ajouter une
 * densité (2/4/…) ou une nouvelle sortie ne doit jamais rouvrir ce fichier
 * pour y dupliquer une géométrie.
 */
import { PRESENTATION_SLIDE_WIDTH, PRESENTATION_SLIDE_HEIGHT } from "./presentation-slide-renderer.js";

/** Valeur CSS `@page { size: ... }` des sorties papier multi-diapositives —
 * nom de format + mot-clé d'orientation, la seule forme honorée de façon
 * fiable par Chromium (voir printPageGeometry, presentation-pdf-export.ts). */
export const A4_PORTRAIT_PAGE_SIZE = "A4 portrait";

export const A4_PORTRAIT_WIDTH_CSS = "210mm";
export const A4_PORTRAIT_HEIGHT_CSS = "297mm";
const A4_PAGE_PADDING_CSS = "12mm";
const A4_PAGE_GAP_CSS = "8mm";

/** Classe COMMUNE à toutes les frames de miniature, quelle que soit la
 * sortie — c'est elle, et elle seule, que `fitPresentationThumbnails`
 * recherche : une nouvelle sortie n'a jamais besoin de son propre ajusteur. */
export const PRESENTATION_THUMBNAIL_FRAME_CLASS = "feuillets-presentation-thumbnail-frame";

/** Grille d'une page A4 : le nombre d'emplacements par feuille en découle
 * (`columns × rows`), jamais l'inverse. */
export interface A4Grid {
  columns: number;
  rows: number;
}

/** Grilles utilisées aujourd'hui — 4/page reste une VRAIE matrice 2×2, y
 * compris sur la dernière page incomplète (des emplacements restent alors
 * vides : la géométrie ne change jamais d'une page à l'autre). */
export const A4_GRID_4_PER_PAGE: A4Grid = { columns: 2, rows: 2 };
export const A4_GRID_2_PER_PAGE: A4Grid = { columns: 1, rows: 2 };
export const A4_GRID_6_PER_PAGE: A4Grid = { columns: 2, rows: 3 };

export function slotsPerPage(grid: A4Grid): number {
  return grid.columns * grid.rows;
}

export function styleEl(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, styles);
}

/**
 * Découpe `items` en pages de `perPage` éléments — découpage FIXE, jamais
 * adaptatif : la dernière page peut être incomplète, sa grille reste
 * identique aux précédentes. Retourne une liste vide pour une entrée vide.
 */
export function chunkIntoPages<T>(items: readonly T[], perPage: number): T[][] {
  if (perPage <= 0) return [];
  const pages: T[][] = [];
  for (let start = 0; start < items.length; start += perPage) {
    pages.push(items.slice(start, start + perPage));
  }
  return pages;
}

/**
 * Feuille A4 portrait à géométrie PHYSIQUE, appliquée directement en style
 * au moment de la construction (jamais différée à une feuille CSS qui
 * n'existerait que dans l'iframe d'impression) : le DOM composé ici est
 * exactement celui qui sera imprimé.
 *
 * `min-height` (et non `height`) + `overflow: visible` : la matrice reste
 * TOUJOURS celle demandée, et si une cellule porte un contenu
 * exceptionnellement long (une note de présentation très longue), la page
 * grandit et Chromium la poursuit sur la feuille physique suivante — jamais
 * de troncature, jamais de matrice modifiée en cours de route.
 */
export function createA4Page(cls: string, grid: A4Grid, attr?: Record<string, string>): HTMLElement {
  const page = createDiv({ cls, attr });
  styleEl(page, {
    width: A4_PORTRAIT_WIDTH_CSS,
    minHeight: A4_PORTRAIT_HEIGHT_CSS,
    height: "auto",
    boxSizing: "border-box",
    padding: A4_PAGE_PADDING_CSS,
    background: "white",
    color: "black",
    overflow: "visible",
    display: "grid",
    gap: A4_PAGE_GAP_CSS,
    gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
  });
  return page;
}

/**
 * Frame de miniature 16:9 + clone EXACT de la section rendue (1280×720,
 * jamais redimensionnée en `%`, jamais recomposée). Aucune échelle n'est
 * posée ici : `fitPresentationThumbnails` la calculera une fois la frame
 * réellement attachée et mesurable.
 */
export function createThumbnailFrame(parent: HTMLElement, section: HTMLElement, extraCls = ""): HTMLElement {
  const frame = parent.createDiv({ cls: `${PRESENTATION_THUMBNAIL_FRAME_CLASS}${extraCls ? ` ${extraCls}` : ""}` });
  styleEl(frame, {
    position: "relative",
    overflow: "hidden",
    background: "white",
    border: "1px solid #d8d8d8",
    minWidth: "0",
    minHeight: "0",
    aspectRatio: "16 / 9",
    width: "100%",
  });

  const clone = section.cloneNode(true) as HTMLElement;
  clone.classList.add("is-active");
  styleEl(clone, {
    position: "absolute",
    left: "0",
    top: "0",
    width: `${PRESENTATION_SLIDE_WIDTH}px`,
    height: `${PRESENTATION_SLIDE_HEIGHT}px`,
    margin: "0",
    padding: "0",
    display: "block",
    visibility: "visible",
    opacity: "1",
    transformOrigin: "top left",
    transform: "scale(1)",
  });
  frame.appendChild(clone);
  return frame;
}

/**
 * Réduit chaque miniature en « contain » RÉEL — jamais une constante fixe :
 * la frame attachée est mesurée, l'échelle min(largeur, hauteur) calculée
 * pour CETTE frame précisément, puis le clone 1280×720 centré dedans par un
 * simple `left`/`top` + `scale()`. Aucun `translate()` approximatif, aucun
 * facteur X/Y distinct, aucun `zoom`.
 *
 * Appelée deux fois par export : pendant la composition (dans le document
 * principal) puis après import dans l'iframe d'impression, dont le moteur
 * recalcule sa propre géométrie.
 */
export function fitPresentationThumbnails(root: HTMLElement): void {
  for (const frame of Array.from(root.querySelectorAll<HTMLElement>(`.${PRESENTATION_THUMBNAIL_FRAME_CLASS}`))) {
    const clone = frame.children[0] as HTMLElement | undefined;
    if (!clone) continue;
    const frameWidth = frame.clientWidth;
    const frameHeight = frame.clientHeight;
    if (frameWidth <= 0 || frameHeight <= 0) continue;
    const scale = Math.min(frameWidth / PRESENTATION_SLIDE_WIDTH, frameHeight / PRESENTATION_SLIDE_HEIGHT);
    const left = (frameWidth - PRESENTATION_SLIDE_WIDTH * scale) / 2;
    const top = (frameHeight - PRESENTATION_SLIDE_HEIGHT * scale) / 2;
    styleEl(clone, { left: `${left}px`, top: `${top}px`, transform: `scale(${scale})`, transformOrigin: "top left" });
  }
}

/**
 * Sauts de page : toutes les feuilles sauf la dernière portent
 * `break-after: page`. Posé en style inline plutôt qu'en règle CSS, parce
 * que ces pages ne portent pas la classe de la Présentation classique —
 * évite toute page blanche terminale.
 */
export function applyA4PageBreaks(pages: readonly HTMLElement[]): void {
  pages.forEach((page, index) => {
    const isLast = index === pages.length - 1;
    styleEl(page, {
      breakAfter: isLast ? "auto" : "page",
      pageBreakAfter: isLast ? "auto" : "always",
    });
  });
}

/** Pas d'écriture manuscrite entre deux réglures — une valeur PHYSIQUE
 * fixe, comme sur un cahier : c'est ce qui garantit qu'on peut réellement
 * écrire entre les lignes, quelle que soit la place restante dans la
 * cellule. */
const RULED_LINE_PITCH_CSS = "7mm";

/**
 * Lignes de prise de notes MANUSCRITES sous une miniature — des réglures
 * réelles (une par ligne), jamais un fond dégradé : à l'impression, seules
 * de vraies bordures sont rendues de façon fiable, et leur nombre reste
 * déterministe (donc vérifiable).
 *
 * Les réglures sont posées à PAS FIXE depuis le haut du bloc, jamais
 * réparties dans la hauteur disponible : une répartition (`space-evenly`)
 * étirait 3 ou 4 lignes sur toute la place restante et les éloignait bien
 * au-delà de ce qu'une écriture manuscrite permet.
 */
export function createRuledNoteLines(parent: HTMLElement, count: number, cls: string): HTMLElement {
  const ruled = parent.createDiv({ cls });
  styleEl(ruled, {
    flex: "1",
    minHeight: "0",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    overflow: "hidden",
    paddingTop: "1mm",
  });
  for (let index = 0; index < count; index++) {
    const line = ruled.createDiv({ cls: `${cls}-rule` });
    styleEl(line, { borderBottom: "1px solid #c8c8c8", height: RULED_LINE_PITCH_CSS, flex: "none" });
  }
  return ruled;
}
