import {
  splitMarkdownLogicalUnits,
  splitMarkdownLogicalUnitsWithRanges,
  type MarkdownLogicalUnitSource,
} from "../utils/markdown-logical-boundaries.js";

/**
 * Une diapositive source, avec sa plage de lignes dans le fichier ORIGINAL
 * (frontmatter compris) — coordonnées Editor 0-based, `endLine` INCLUS.
 * Le séparateur `---` qui clôt une diapositive appartient à CETTE
 * diapositive (jamais à la suivante) : voir `splitPresentationMarkdownWithRanges`.
 * Alias de l'unité logique générique partagée (voir
 * `src/utils/markdown-logical-boundaries.ts`) — même forme exacte, aucune
 * divergence possible avec l'implémentation.
 */
export type PresentationSlideSource = MarkdownLogicalUnitSource;

/** Découpe le corps Markdown en diapositives sans interpréter le Markdown.
 * Délègue au scanner générique partagé (voir
 * `src/utils/markdown-logical-boundaries.ts`) — aucun second parseur,
 * comportement Présentation strictement inchangé. */
export function splitPresentationMarkdown(markdown: string): string[] {
  return splitMarkdownLogicalUnits(markdown);
}

/**
 * Comme `splitPresentationMarkdown`, avec en plus la plage de lignes
 * (Editor 0-based, `endLine` inclus, coordonnées du fichier ORIGINAL) de
 * chaque diapositive — utilisé par l'aperçu lié pour faire correspondre
 * curseur ↔ diapositive. Même logique de séparation, aucun second parseur
 * (voir `src/utils/markdown-logical-boundaries.ts`).
 */
export function splitPresentationMarkdownWithRanges(markdown: string): PresentationSlideSource[] {
  return splitMarkdownLogicalUnitsWithRanges(markdown);
}

/**
 * Index (dans `slides`) de la diapositive contenant la ligne `line`
 * (Editor 0-based). Une ligne avant la première diapositive (frontmatter)
 * est rattachée à la première ; une ligne après la dernière, à la
 * dernière. `-1` si `slides` est vide.
 */
export function presentationSlideIndexForLine(slides: readonly PresentationSlideSource[], line: number): number {
  if (!slides.length) return -1;
  if (line < slides[0].startLine) return 0;
  for (let i = 0; i < slides.length; i++) {
    if (line >= slides[i].startLine && line <= slides[i].endLine) return i;
  }
  return slides.length - 1;
}

export function presentationScale(availableWidth: number, availableHeight: number, baseWidth = 1280, baseHeight = 720): number {
  if (availableWidth <= 0 || availableHeight <= 0 || baseWidth <= 0 || baseHeight <= 0) return 0;
  return Math.min(1, availableWidth / baseWidth, availableHeight / baseHeight);
}
