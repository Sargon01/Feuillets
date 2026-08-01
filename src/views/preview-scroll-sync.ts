/* Synchronisation de défilement entre le panneau source (éditeur Markdown,
 * ou vue Scrivening) et PreviewView — et pour eux SEULS.
 *
 * Ce module ne contient que de la géométrie de défilement : aucun accès à
 * Obsidian, aucun rendu, aucune compilation. C'est volontaire — la
 * mécanique fragile (progression bornée, seuils, repérage d'une scène dans
 * un panneau) est ainsi testable telle quelle, sans monter une vue.
 *
 * Hiérarchie de synchronisation réellement appliquée :
 *   1. SCÈNE ACTIVE — quand un `data-source-path` existe pour le feuillet
 *      suivi (modes Chapitre, Partie, Manuscrit), la progression est
 *      appliquée à SA section, et à elle seule : les scènes précédentes,
 *      les pages liminaires et les pages de titre ne comptent pas ;
 *   2. PROGRESSION RELATIVE dans cette scène ;
 *   3. PROGRESSION GLOBALE en dernier recours — c'est le cas du mode Scène,
 *      où elle est EXACTE puisque l'aperçu est le feuillet lui-même.
 *
 * LIMITE ASSUMÉE — pas de synchronisation par bloc ni par ligne. Audit :
 *
 * a. Côté APERÇU, `MarkdownRenderer.render()` n'émet aucune information de
 *    ligne, et l'API publique d'Obsidian n'expose aucun point d'accroche
 *    pendant le rendu. Le seul mécanisme disponible est celui déjà employé
 *    pour les feuillets (paragraphe-marqueur injecté dans le markdown, puis
 *    converti en attribut — voir preview-source-map.ts). Un marqueur PAR
 *    BLOC casserait ce qu'il traverse : inséré entre deux éléments d'une
 *    liste il la coupe en deux listes, à l'intérieur d'une clôture ``` il
 *    apparaît littéralement dans le code affiché, et il doublerait le
 *    nombre de nœuds rendus sur un manuscrit entier.
 * b. Côté ÉDITEUR, il faudrait connaître la LIGNE en tête de viewport. Les
 *    éléments `.cm-line` réellement présents dans le DOM ne portent pas
 *    leur numéro de ligne, et CodeMirror ne le donne que par
 *    `editor.cm.lineBlockAtHeight()` — une API interne, non documentée par
 *    Obsidian, qu'un plugin publié ne peut pas se permettre de suivre.
 *
 * Conclusion : la synchronisation reste scène + progression relative, ce
 * qui suffit dès lors que le rendu ne contient plus de contenu absent de la
 * source (le frontmatter YAML, retiré depuis, était l'écart réel). Ce qui
 * débloquerait le niveau bloc : un repère de ligne officiel dans l'API de
 * rendu d'Obsidian.
 */

/** Écart en dessous duquel une correction de position est jugée inutile —
 * l'appliquer ne ferait que produire un événement `scroll` de plus. */
export const SCROLL_SYNC_EPSILON_PX = 3;

/** Après un défilement MANUEL d'un panneau, les corrections venant de
 * l'autre panneau sont suspendues pendant ce délai : sans cela, deux
 * corrections croisées se disputeraient la position pendant tout un geste
 * de défilement rapide. */
export const SCROLL_SYNC_SUSPEND_MS = 200;

/** Sous-ensemble de HTMLElement réellement utilisé ici : accepter cette
 * forme (plutôt que HTMLElement) garde le module testable avec un faux DOM
 * et interdit d'y appeler autre chose que de la mesure. */
export type ScrollLike = {
  scrollTop: number;
  scrollHeight?: number;
  clientHeight?: number;
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Amplitude réellement défilable d'un élément, en px. Zéro si le contenu
 * tient entièrement dans le cadre — d'où la division protégée partout
 * ailleurs dans ce module. */
export function scrollableAmount(el: ScrollLike | null | undefined): number {
  if (!el) return 0;
  const height = Number(el.scrollHeight) || 0;
  const client = Number(el.clientHeight) || 0;
  return Math.max(0, height - client);
}

/** Progression de lecture d'un panneau, bornée à [0, 1]. */
export function scrollProgress(el: ScrollLike | null | undefined): number {
  if (!el) return 0;
  const range = scrollableAmount(el);
  if (range <= 0) return 0;
  return clamp01((Number(el.scrollTop) || 0) / range);
}

/** Position absolue correspondant à une progression, dans le même panneau. */
export function scrollTopForProgress(el: ScrollLike | null | undefined, progress: number): number {
  return clamp01(progress) * scrollableAmount(el);
}

/** Section d'un panneau : un intervalle vertical exprimé dans le repère
 * défilé de ce panneau (px, origine = haut du contenu). */
export type ScrollSection = { top: number; height: number };

/** Progression à l'intérieur d'une section. La plage utile est la hauteur
 * de la section MOINS celle du cadre : c'est ce qui reste réellement à
 * parcourir. Une section plus courte que le cadre est entièrement visible,
 * sa progression vaut donc 0 — jamais une valeur qui ferait sursauter
 * l'autre panneau. */
export function progressWithinSection(scrollTop: number, section: ScrollSection, clientHeight: number): number {
  const range = Math.max(0, section.height - (Number(clientHeight) || 0));
  if (range <= 0) return 0;
  return clamp01((scrollTop - section.top) / range);
}

/** Opération inverse : position absolue visant la même zone de texte. */
export function scrollTopWithinSection(section: ScrollSection, clientHeight: number, progress: number): number {
  const range = Math.max(0, section.height - (Number(clientHeight) || 0));
  return section.top + clamp01(progress) * range;
}

/* ===================== Repérage du panneau source ===================== */

type QueryHost = {
  querySelector?(selector: string): unknown;
  querySelectorAll?(selector: string): ArrayLike<unknown>;
};

type MeasurableElement = ScrollLike &
  QueryHost & {
    parentElement?: MeasurableElement | null;
    getBoundingClientRect?(): { top: number };
    getAttribute?(name: string): string | null;
  };

/** Sélecteurs des zones réellement défilables d'une feuille Markdown, dans
 * l'ordre de préférence : mode Source/Live Preview (CodeMirror 6), puis
 * mode Lecture. Aucun n'est inventé : ce sont les classes posées par
 * Obsidian lui-même. */
const SOURCE_SCROLLER_SELECTORS = [".cm-scroller", ".markdown-preview-view", ".markdown-source-view"];

/** Classe du conteneur d'une vue Scrivening (voir views/scrivenings-editor.ts). */
export const SCRIVENINGS_WRAPPER_SELECTOR = ".feuillets-scrivenings-wrapper";
/** Bloc d'une scène dans une vue Scrivening, porteur de son chemin source. */
export const SCRIVENINGS_SCENE_SELECTOR = ".feuillets-scrivenings-scene";
export const SCRIVENINGS_PATH_ATTR = "data-path";

function isScrollable(el: ScrollLike | null | undefined): boolean {
  return scrollableAmount(el) > 1;
}

/** Vrai élément défilable d'une feuille Markdown. Retourne `null` plutôt
 * qu'un repli approximatif : mieux vaut ne pas synchroniser que synchroniser
 * sur le mauvais élément (le document entier, par exemple — `window.scrollY`
 * n'a aucun sens dans Obsidian, dont les panneaux défilent chacun de leur
 * côté). */
export function findSourceScroller(root: MeasurableElement | null | undefined): MeasurableElement | null {
  if (!root) return null;
  for (const selector of SOURCE_SCROLLER_SELECTORS) {
    const found = root.querySelector?.(selector) as MeasurableElement | null | undefined;
    if (found) return found;
  }
  return isScrollable(root) ? root : null;
}

/** Élément défilable d'une vue Scrivening : le conteneur des scènes n'est
 * pas lui-même défilable (il grandit avec son contenu), c'est l'un de ses
 * ancêtres qui l'est. On remonte donc jusqu'au premier ancêtre qui défile
 * réellement, sans jamais dépasser une profondeur raisonnable. */
export function findScriveningsScroller(root: MeasurableElement | null | undefined): MeasurableElement | null {
  const wrapper = root?.querySelector?.(SCRIVENINGS_WRAPPER_SELECTOR) as MeasurableElement | null | undefined;
  if (!wrapper) return null;
  let el: MeasurableElement | null | undefined = wrapper;
  for (let depth = 0; el && depth < 8; depth++) {
    if (isScrollable(el)) return el;
    el = el.parentElement;
  }
  return isScrollable(root) ? (root as MeasurableElement) : null;
}

/** Position d'un élément dans le repère DÉFILÉ de son conteneur. */
export function topWithinScroller(el: MeasurableElement, scroller: MeasurableElement): number {
  if (typeof el.getBoundingClientRect !== "function" || typeof scroller.getBoundingClientRect !== "function") {
    return 0;
  }
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + (Number(scroller.scrollTop) || 0);
}

export type ScriveningsAnchor = { path: string; progress: number };

/**
 * Scène réellement en tête de lecture dans une vue Scrivening, et
 * progression à l'intérieur de cette scène.
 *
 * On retient la DERNIÈRE scène dont le haut est déjà passé sous le bord
 * supérieur du cadre — c'est celle qu'on est en train de lire — et, à
 * défaut (défilement tout en haut), la première.
 */
export function scriveningsAnchor(
  scroller: MeasurableElement | null | undefined,
  scenes: ArrayLike<MeasurableElement> | null | undefined
): ScriveningsAnchor | null {
  if (!scroller || !scenes || !scenes.length) return null;
  const scrollTop = Number(scroller.scrollTop) || 0;
  const clientHeight = Number(scroller.clientHeight) || 0;

  let chosen: { el: MeasurableElement; top: number } | null = null;
  let nextTop = scrollableAmount(scroller) + clientHeight;
  for (let i = 0; i < scenes.length; i++) {
    const el = scenes[i];
    const top = topWithinScroller(el, scroller);
    if (top <= scrollTop + 1 || i === 0) {
      chosen = { el, top };
      const next = i + 1 < scenes.length ? scenes[i + 1] : null;
      nextTop = next ? topWithinScroller(next, scroller) : Number(scroller.scrollHeight) || top;
    }
    if (top > scrollTop + 1) break;
  }
  if (!chosen) return null;

  const path = chosen.el.getAttribute?.(SCRIVENINGS_PATH_ATTR) || "";
  if (!path) return null;
  const section = { top: chosen.top, height: Math.max(0, nextTop - chosen.top) };
  return { path, progress: progressWithinSection(scrollTop, section, clientHeight) };
}
