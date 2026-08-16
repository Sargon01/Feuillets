/**
 * Source de vérité UNIQUE de la géométrie de page (§24-§26 du chantier
 * « espace central »).
 *
 * Historiquement, `paginateManuscript()` et `exportPdf()` calculaient chacun
 * leur format et leur orientation avec `settings.pdfOrientation ||
 * tpl.pageOrientation || "portrait"`. Or `DEFAULT_SETTINGS.pdfOrientation`
 * vaut TOUJOURS "portrait" : la partie gauche du `||` était donc toujours
 * vraie et un gabarit « paysage » ne pouvait jamais gagner. C'est la cause
 * réelle et unique du bug Paysage.
 *
 * La règle est désormais explicite et unidirectionnelle : le GABARIT RÉSOLU
 * prime ; les anciens réglages PDF ne servent que de repli quand le gabarit
 * n'exprime pas la donnée. Un gabarit intégré (utils/export-templates.ts) ne
 * déclare pas `pageSize` : les réglages legacy continuent donc de piloter le
 * format exactement comme avant pour ces gabarits.
 *
 * Fonction PURE : ni App, ni vault, ni DOM — elle est testable seule et
 * partagée par la pagination Preview, l'export PDF et la miniature Première
 * page, pour qu'il n'existe jamais trois tables de dimensions.
 */

export type PageOrientation = "portrait" | "landscape";

export type PageGeometry = {
  /** Format retenu, tel qu'écrit par sa source (jamais normalisé en casse :
   * la règle CSS `@page { size: ... }` de l'export le réutilise tel quel). */
  size: string;
  orientation: PageOrientation;
  widthMm: number;
  heightMm: number;
};

/** Ce que la géométrie lit d'un gabarit résolu — sous-ensemble volontairement
 * minimal d'`ExportTemplate`, pour que ce module ne dépende d'aucun autre. */
export type PageGeometryTemplate = {
  pageSize?: string;
  pageOrientation?: string;
};

/** Repli legacy : les deux seules clés de réglages qui concernent la
 * géométrie. Elles restent lues, jamais écrites, et ne sont PAS supprimées de
 * DEFAULT_SETTINGS (§19). */
export type PageGeometrySettings = {
  pdfPageSize?: string;
  pdfOrientation?: string;
};

/** Côtés en millimètres, indexés par format en minuscules. `shortMm` est
 * toujours la petite dimension : l'orientation décide seule de son affectation
 * à la largeur ou à la hauteur. */
const PAGE_DIMENSIONS_MM: Record<string, { shortMm: number; longMm: number }> = {
  a4: { shortMm: 210, longMm: 297 },
  a5: { shortMm: 148, longMm: 210 },
  letter: { shortMm: 216, longMm: 279 },
};

function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function normalizeOrientation(value: string | undefined): PageOrientation {
  return value === "landscape" ? "landscape" : "portrait";
}

/** Résout format + orientation + dimensions réelles.
 *
 * Priorité, pour CHAQUE champ indépendamment :
 * 1. le gabarit résolu (donc le gabarit V2 quand il y en a un) ;
 * 2. les anciens réglages PDF ;
 * 3. A4 portrait.
 *
 * Un format inconnu (ex. l'ancienne valeur « poche ») retombe sur A4, comme
 * le faisait déjà le calcul historique. La reconnaissance est insensible à la
 * casse : « Letter » et « letter » désignent bien le même format. */
export function resolvePageGeometry(
  tpl: PageGeometryTemplate | null | undefined,
  settings: PageGeometrySettings | null | undefined,
): PageGeometry {
  const size = firstNonEmpty(tpl?.pageSize, settings?.pdfPageSize) ?? "A4";
  const orientation = normalizeOrientation(
    firstNonEmpty(tpl?.pageOrientation, settings?.pdfOrientation)
  );
  const dimensions = PAGE_DIMENSIONS_MM[size.trim().toLowerCase()] ?? PAGE_DIMENSIONS_MM.a4;
  const landscape = orientation === "landscape";
  return {
    size,
    orientation,
    widthMm: landscape ? dimensions.longMm : dimensions.shortMm,
    heightMm: landscape ? dimensions.shortMm : dimensions.longMm,
  };
}
