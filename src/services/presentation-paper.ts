/**
 * Support papier de la présentation — convertit une présentation Markdown
 * (slides séparées par ---, [!pagebreak], [!saut-page]) en unités de
 * rendu papier, UNE unité par slide.
 *
 * Aucun nouveau parser : réutilise le splitter Présentation DÉJÀ VALIDÉ
 * (src/services/presentation.ts, `splitPresentationMarkdownWithRanges`),
 * qui délègue lui-même au scanner générique partagé
 * (src/utils/markdown-logical-boundaries.ts). Les frontières (`---`,
 * `[!pagebreak]`, `[!saut-page]`) sont déjà consommées par ce splitter et
 * n'apparaissent JAMAIS dans `unit.markdown`.
 *
 * Le Markdown source n'est JAMAIS modifié ; les unités ne sont pas
 * reconcaténées en un Markdown virtuel — chaque unité est destinée à être
 * rendue et paginée SÉPARÉMENT, sur sa propre page papier (voir
 * `src/views/preview-view.ts`).
 */

import { splitPresentationMarkdownWithRanges, type PresentationSlideSource } from "./presentation.js";

/**
 * Une unité papier : le Markdown d'UNE slide, avec sa plage de lignes dans
 * le fichier source (Editor 0-based, `endLine` inclus) — même forme que
 * `PresentationSlideSource`, alias explicite pour ce domaine.
 */
export type PresentationPaperUnit = PresentationSlideSource;

/**
 * Découpe un Markdown de présentation en unités papier — une unité par
 * slide, dans l'ordre du document. Délègue ENTIÈREMENT au splitter
 * Présentation déjà validé : aucune frontière (`---`, `[!pagebreak]`,
 * `[!saut-page]`) n'est jamais présente dans `unit.markdown`.
 *
 * @param markdown Le contenu Markdown source (jamais muté)
 * @returns Les unités papier, dans l'ordre du document
 */
export function buildPresentationPaperUnits(markdown: string): PresentationPaperUnit[] {
  return splitPresentationMarkdownWithRanges(markdown);
}

/**
 * Calcule le facteur d'échelle pour adapter une unité de slide au papier.
 *
 * Contrat :
 * - Toutes les dimensions doivent être finies et > 0, sinon retourne 1.
 * - Jamais d'agrandissement > 1 (scale ≤ 1).
 * - Jamais de crop.
 *
 * @param availableWidth Largeur disponible de la zone papier (px)
 * @param availableHeight Hauteur disponible de la zone papier (px)
 * @param contentWidth Largeur naturelle du contenu de la slide (px)
 * @param contentHeight Hauteur naturelle du contenu de la slide (px)
 * @returns Facteur d'échelle (0 < scale ≤ 1)
 */
export function presentationPaperScale(
  availableWidth: number,
  availableHeight: number,
  contentWidth: number,
  contentHeight: number
): number {
  // Validation : toutes les dimensions doivent être finies et > 0.
  if (
    !Number.isFinite(availableWidth) || availableWidth <= 0
    || !Number.isFinite(availableHeight) || availableHeight <= 0
    || !Number.isFinite(contentWidth) || contentWidth <= 0
    || !Number.isFinite(contentHeight) || contentHeight <= 0
  ) {
    return 1;
  }

  // Calcul du scale : minimum des trois rapports (largeur, hauteur, pas d'agrandissement).
  return Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);
}

/**
 * Repli « paire adaptative » (support papier UNIQUEMENT) — quand une slide a
 * UN SEUL média et au moins deux blocs significatifs du même côté, et que le
 * rendu naturel exige un scale global < 1, on tente de regrouper contenu et
 * média côte à côte (grille ~60/40) plutôt que de tout réduire. Voir
 * `applyPresentationPaperFit`/`tryAdaptivePresentationPair` dans
 * preview-view.ts, qui mesurent RÉELLEMENT le candidat construit à partir de
 * ce plan avant de l'adopter — cette fonction ne décide que de
 * l'ÉLIGIBILITÉ et du regroupement, jamais d'un scale.
 *
 * Classes des wrappers LOCAUX construits pour ce repli — jamais réutilisées
 * par le moteur Document (export-render.ts) ni par le moteur 16:9
 * (presentation-slide-renderer.ts) : un nom distinct et local au support
 * papier, cohérent avec `.feuillets-presentation-paper-*` déjà en usage
 * (voir preview-view.ts, PRESENTATION_PAPER_CSS).
 */
export const ADAPTIVE_PAIR_CLASS = "feuillets-presentation-paper-adaptive-pair";
export const ADAPTIVE_CONTENT_CLASS = "feuillets-presentation-paper-adaptive-content";
export const ADAPTIVE_MEDIA_CLASS = "feuillets-presentation-paper-adaptive-media";
/** Modificateurs d'ordre visuel de la paire — posés SUR `ADAPTIVE_PAIR_CLASS`,
 * jamais une classe séparée : styles.css n'a besoin que de l'ordre des
 * colonnes (60/40 si le contenu précède le média, 40/60 sinon), la mise en
 * grille elle-même reste posée par la classe de base. */
export const ADAPTIVE_PAIR_ORIENTATION_CLASS = {
  "content-media": "feuillets-presentation-paper-adaptive-pair-content-first",
  "media-content": "feuillets-presentation-paper-adaptive-pair-media-first",
} as const;

/** Nœud DOM minimal requis par `planAdaptivePair` — duck-typé pour
 * fonctionner aussi bien avec un `Element` réel (DOM de l'iframe Aperçu)
 * qu'avec le DOM de test (`FakeElement`, voir test/preview-view.test.js) :
 * seuls `tagName` et `classList.contains` sont lus, jamais autre chose —
 * cette fonction ne mesure rien, elle ne fait QUE lire la nature de chaque
 * bloc déjà rendu par le moteur Document (`renderManuscriptHtml` +
 * `composeDocumentMedia`, export-render.ts). */
export interface AdaptivePairElementLike {
  tagName: string;
  classList: { contains(cls: string): boolean };
}

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/** Classe posée par `composeDocumentMedia` (export-render.ts,
 * `DOCUMENT_MEDIA_BLOCK`) sur le wrapper direct de CHAQUE média rendu —
 * DOIT rester synchronisée avec cette constante, jamais réécrite ici : le
 * support papier ne fait que LIRE une composition déjà faite par le moteur
 * Document, jamais une seconde détection d'image. */
const MEDIA_BLOCK_CLASS = "feuillets-doc-media-block";

/** Classes qui signalent une composition déjà EXPLICITEMENT décidée par
 * l'utilisateur ou par le moteur Document — une directive `image:`
 * (`feuillets-image-placement-*`), `colonnes:` (`feuillets-columns`), ou un
 * appariement média+rôle déjà construit (`feuillets-document-media-role-pair`,
 * `dessous` compris — `composeDocumentMediaRoles`, export-render.ts). La
 * paire adaptative ne doit JAMAIS s'y substituer (règles 8 et 9 du lot) : sa
 * présence, sur le bloc média ou sur un bloc de contenu candidat, annule
 * systématiquement l'éligibilité. */
const EXPLICIT_COMPOSITION_CLASSES = [
  "feuillets-columns",
  "feuillets-document-media-role-pair",
  "feuillets-image-placement-left",
  "feuillets-image-placement-center",
  "feuillets-image-placement-right",
  "feuillets-image-placement-full",
];

function hasExplicitComposition(el: AdaptivePairElementLike): boolean {
  return EXPLICIT_COMPOSITION_CLASSES.some((cls) => el.classList.contains(cls));
}

export type AdaptivePairOrientation = keyof typeof ADAPTIVE_PAIR_ORIENTATION_CLASS;

export interface AdaptivePairPlan {
  /** Index, dans `children`, à partir duquel le « corps » commence — les
   * titres H1-H3 INITIAUX (règle 7) restent avant, pleine largeur,
   * jamais déplacés dans la paire. */
  bodyStart: number;
  /** Index, dans `children`, de l'UNIQUE bloc média. */
  mediaIndex: number;
  /** Index, dans `children`, des blocs de contenu à regrouper — tous du
   * même côté du média (règle 4), dans leur ordre d'origine. */
  contentIndices: number[];
  /** Contenu avant le média (paire 60/40) ou après (paire 40/60). */
  orientation: AdaptivePairOrientation;
}

/**
 * Décide si une slide (ses blocs de premier niveau, DÉJÀ rendus et
 * composés par le moteur Document) est éligible au repli « paire
 * adaptative », et calcule le regroupement le cas échéant.
 *
 * Contrat (voir en-tête de fichier de la tâche) :
 *  - exactement UN bloc média parmi les blocs non-titre ;
 *  - au moins DEUX blocs de contenu significatifs, tous du même côté du
 *    média (avant OU après, jamais les deux — règle 4) ;
 *  - aucune composition déjà explicite (directive `image:`/`colonnes:`,
 *    appariement média+rôle déjà construit) sur le média ou le contenu ;
 *  - les titres H1-H3 initiaux ne comptent jamais comme contenu.
 *
 * Ne mesure RIEN et ne construit AUCUN DOM — seule la décision
 * d'éligibilité et le regroupement. Voir preview-view.ts pour la
 * construction du candidat et la mesure réelle qui décide de son adoption.
 */
export function planAdaptivePair<T extends AdaptivePairElementLike>(children: readonly T[]): AdaptivePairPlan | null {
  let bodyStart = 0;
  while (bodyStart < children.length && HEADING_TAGS.has(children[bodyStart].tagName)) bodyStart++;

  const bodyIndices: number[] = [];
  for (let i = bodyStart; i < children.length; i++) bodyIndices.push(i);
  if (bodyIndices.length < 3) return null; // 1 média + au moins 2 blocs de contenu

  const mediaCandidates = bodyIndices.filter((i) => children[i].classList.contains(MEDIA_BLOCK_CLASS));
  if (mediaCandidates.length !== 1) return null; // règles 2 et 5 : exactement un média
  const mediaIndex = mediaCandidates[0];
  if (hasExplicitComposition(children[mediaIndex])) return null; // règle 9

  const contentIndices = bodyIndices.filter((i) => i !== mediaIndex);
  if (contentIndices.length < 2) return null; // règle 6 : laisser le moteur Document décider
  if (contentIndices.some((i) => hasExplicitComposition(children[i]))) return null; // règle 9

  const before = contentIndices.filter((i) => i < mediaIndex);
  const after = contentIndices.filter((i) => i > mediaIndex);
  if (before.length > 0 && after.length > 0) return null; // règle 4

  const orientation: AdaptivePairOrientation = before.length > 0 ? "content-media" : "media-content";
  return { bodyStart, mediaIndex, contentIndices, orientation };
}

/**
 * Règle d'adoption UNIQUE du candidat (voir ALGORITHME de la tâche) : conservé
 * seulement s'il obtient un meilleur scale que le rendu naturel, sinon le DOM
 * naturel est restauré à l'identique. Fonction pure — la mesure réelle
 * (candidateScale) et la restauration éventuelle restent à la charge de
 * l'appelant (preview-view.ts), qui seul a accès au DOM vivant de l'iframe.
 */
export function shouldAdoptAdaptivePair(naturalScale: number, candidateScale: number): boolean {
  return candidateScale > naturalScale;
}
