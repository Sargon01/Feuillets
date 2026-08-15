/** Grammaire de l'aperçu du Binder (micro-lot "simplification définitive du
 * Binder" + ajustement "aperçu du Binder") — partagée entre le menu local
 * du volet fichiers (feuillets-view.ts) et le panneau Paramètres
 * (feuillets-setting-tab.ts) pour que les deux proposent EXACTEMENT les
 * mêmes choix, jamais deux implémentations divergentes.
 *
 * Le Binder ne doit jamais exposer les deux champs sémantiques "synopsis"
 * (Fiction) et "summary" (Non-fiction/Libre) à la fois : un seul, celui du
 * mode du projet courant — la règle existante de PROJECT_MODES[...]
 * .defaults.cardContent (voir utils/project-modes.ts), jamais une nouvelle
 * notion de mode ou de préférence. */

export type BinderPreviewSemanticField = "synopsis" | "summary";
export type BinderPreviewField = "none" | "extrait" | BinderPreviewSemanticField;

/** `cardContent` du mode de projet courant ("synopsis" en Fiction,
 * "summary" en Non-fiction/Libre) ramené sur le champ sémantique de
 * l'aperçu Binder — "synopsis" par repli si absent/inconnu (même repli que
 * `resolveType`, utils/project-modes.ts). */
export function binderPreviewSemanticField(
  cardContent: string | null | undefined
): BinderPreviewSemanticField {
  return cardContent === "summary" ? "summary" : "synopsis";
}

/** Résout une valeur quelconque de `listPanePreviewField` — y compris une
 * ancienne donnée sauvegardée ("tags", "notes", "synopsis" ou "summary"
 * enregistrés sous un mode différent de l'actuel, ou toute valeur inconnue)
 * — vers la grammaire ACTUELLE du Binder, au moment du rendu :
 * - "none"/absent → "none" ;
 * - "extrait" → "extrait" ;
 * - "synopsis" ou "summary" → le champ sémantique du mode courant
 *   (`semanticField`), jamais les deux à la fois ;
 * - "tags", "notes" ou toute autre valeur → "none" (retirés de la
 *   grammaire Binder, restent consultables dans Cartes/Plan).
 * Aucune migration de données : `listPanePreviewField` reste tel quel sur
 * le disque, seul le RENDU est borné. */
export function resolveBinderPreviewField(
  field: string | null | undefined,
  semanticField: BinderPreviewSemanticField
): BinderPreviewField {
  if (!field || field === "none") return "none";
  if (field === "extrait") return "extrait";
  if (field === "synopsis" || field === "summary") return semanticField;
  return "none";
}

/** Choix proposés par le menu Binder (local ET Paramètres) pour l'aperçu de
 * la fiche, dans l'ordre d'affichage — "Aucun", "Extrait du texte", puis le
 * SEUL champ sémantique du mode courant. */
export function binderPreviewFieldChoices(
  semanticField: BinderPreviewSemanticField
): BinderPreviewField[] {
  return ["none", "extrait", semanticField];
}

/** Nombre de lignes d'aperçu autorisé (menu local ET slider Paramètres) —
 * 1 à 3, jamais plus : le Binder ne doit jamais devenir une fiche. */
export const BINDER_PREVIEW_MAX_LINES = 3;

/** Borne une valeur de `listPanePreviewLines` quelconque (y compris une
 * ancienne donnée > 3, jamais migrée) au rendu : entre 1 et 3. */
export function clampBinderPreviewLines(lines: number | null | undefined): number {
  return Math.min(BINDER_PREVIEW_MAX_LINES, Math.max(1, lines || 2));
}
