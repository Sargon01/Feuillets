// @ts-check
/** Traduction d'un modèle d'export (utils/export-templates.js) en primitives
 * de la bibliothèque `docx` : alignements, marges de section, et mise en forme
 * des blocs d'une page Front (page de titre, dédicace, épigraphe).
 *
 * Séparé de services/export-docx.js parce que ce dernier charge
 * export-render.js, qui dépend d'Obsidian et n'est donc pas importable hors
 * du plugin. Ici, aucune dépendance à Obsidian : ces fonctions sont testables
 * directement sous Node, contrairement au reste du moteur .docx.
 *
 * Unités — les trois cohabitent, d'où les conversions explicites :
 *  - `docx` exprime les tailles de police en DEMI-points (`fontSizePt * 2`) ;
 *  - les espacements de paragraphe en TWIPS (`pt * 20`) ;
 *  - les marges de page acceptent une chaîne en cm, prise telle quelle.
 *
 * @typedef {{ style?: TitlePageStyle|null, isTitleLine?: boolean }} FrontOverride
 *   Contexte d'un bloc appartenant à une page Front. `style` vient du modèle
 *   (`titlePage.styles.<rôle>`) ; `isTitleLine` marque le tout premier bloc
 *   d'une page de titre sans style de rôle défini.
 */

import { AlignmentType } from "docx";
import { marginsFor } from "../utils/export-templates.js";
import { TITLE_ROLE_MARKER } from "../utils/title-roles.js";

/* Interligne simple partout sur une page Front — c'est une page composée à la
   main, pas du texte de roman : l'interligne du gabarit du manuscrit (souvent
   1,5 ou double) fausserait l'espacement entre des blocs que l'autrice
   contrôle elle-même, ligne vide par ligne vide. */
/** @type {import("docx").ISpacingProperties} */
export const FRONT_PAGE_LINE_SPACING = { line: 240, lineRule: "auto" };

/* 18pt en demi-points (unité w:sz) pour le titre du roman sur sa page de
   titre — appliqué au seul premier bloc, et seulement si le modèle ne définit
   pas de style pour ce rôle. */
export const FRONT_TITLE_FONT_SIZE = 36;

/**
 * Alignement docx d'un modèle. Repli à gauche pour toute valeur non reconnue,
 * y compris absente.
 * @param {{ align?: string }} tpl
 */
export function alignmentFor(tpl) {
  /* `JUSTIFIED` (= "both"), pas `JUSTIFY` : cette dernière n'existe pas dans
     `docx` et valait donc `undefined`, ce qui retirait purement et simplement
     l'alignement du paragraphe — les manuscrits exportés en .docx avec le
     modèle « Classique » (align: "justify") sortaient au fer à gauche. */
  if (tpl.align === "justify") return AlignmentType.JUSTIFIED;
  if (tpl.align === "center") return AlignmentType.CENTER;
  if (tpl.align === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

/**
 * Locale Word pour la langue du projet — pilote la césure et le dictionnaire
 * du correcteur à l'ouverture du .docx. Repli français, cohérent avec le reste
 * du plugin.
 * @param {string|null|undefined} lang code de langue, ex. "fr", "en-GB".
 * @returns {string}
 */
export function wordLocale(lang) {
  const l = (lang || "fr").toLowerCase();
  if (l.startsWith("en")) return "en-US";
  if (l.startsWith("de")) return "de-DE";
  if (l.startsWith("es")) return "es-ES";
  if (l.startsWith("it")) return "it-IT";
  return "fr-FR";
}

/**
 * Marges de page au format attendu par `docx`. Réutilisé à l'identique par la
 * section principale et par chaque section Front : mêmes marges partout, seul
 * le centrage vertical change d'une section à l'autre.
 * @param {ExportTemplate} tpl
 */
export function sectionPageMargin(tpl) {
  const margins = marginsFor(tpl);
  return {
    top: `${margins.top}cm`,
    bottom: `${margins.bottom}cm`,
    left: `${margins.left}cm`,
    right: `${margins.right}cm`,
  };
}

/**
 * Nom du rôle porté par un paragraphe-marqueur de page de titre, en
 * minuscules, ou `null` si l'élément n'est pas un marqueur de rôle.
 * @param {{ textContent?: string|null }|null|undefined} el
 * @returns {string|null}
 */
export function titleRoleOf(el) {
  if (!el) return null;
  const raw = (el.textContent || "").trim();
  if (!raw.startsWith(TITLE_ROLE_MARKER)) return null;
  return raw.slice(TITLE_ROLE_MARKER.length).trim().toLowerCase();
}

/**
 * Style défini par le modèle pour un rôle de page de titre, ou `null` — la
 * page retombe alors sur sa mise en forme de base (centré, interligne simple).
 * @param {ExportTemplate|null|undefined} tpl
 * @param {string|null|undefined} role
 * @returns {TitlePageStyle|null}
 */
export function frontRoleStyle(tpl, role) {
  const styles = tpl && tpl.titlePage && tpl.titlePage.styles;
  return (role && styles && styles[role]) || null;
}

/**
 * Marques de texte d'un bloc Front : celles du rôle si le modèle en définit,
 * sinon la taille de titre historique sur la première ligne d'une page de
 * titre libre.
 * @param {FrontOverride|null|undefined} frontOverride
 */
export function frontInlineMarks(frontOverride) {
  if (!frontOverride) return {};
  const st = frontOverride.style;
  if (st) {
    return {
      size: st.fontSizePt != null ? st.fontSizePt * 2 : undefined,
      bold: st.bold,
      italics: st.italic,
    };
  }
  return frontOverride.isTitleLine ? { size: FRONT_TITLE_FONT_SIZE } : {};
}

/**
 * Espacement d'un paragraphe Front : interligne simple de base, complété par
 * les marges du rôle.
 * @param {FrontOverride|null|undefined} frontOverride
 */
export function frontSpacing(frontOverride) {
  const st = frontOverride && frontOverride.style;
  if (!st) return FRONT_PAGE_LINE_SPACING;
  return {
    ...FRONT_PAGE_LINE_SPACING,
    ...(st.marginTopPt != null ? { before: st.marginTopPt * 20 } : {}),
    ...(st.marginBottomPt != null ? { after: st.marginBottomPt * 20 } : {}),
  };
}

/**
 * Alignement d'un paragraphe Front : celui du rôle s'il en impose un, sinon le
 * centrage par défaut des pages Front.
 * @param {FrontOverride|null|undefined} frontOverride
 */
export function frontAlignment(frontOverride) {
  const st = frontOverride && frontOverride.style;
  if (st && st.align) return alignmentFor({ align: st.align });
  return AlignmentType.CENTER;
}
