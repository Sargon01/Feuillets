/** Génération de Sommaire et Table des matières (Phase 6).
 *
 * Calculée à la compilation à partir des `segments` déjà produits par
 * `compile()` (services/compile-export.ts) — jamais d'un fichier Markdown
 * source propre : ce sont des éléments "generated" du modèle commun de
 * composition (services/book-composition.ts), rien n'est dupliqué. Pas de
 * numéros de page ici : ils dépendent de la mise en page (Phase 11).
 */
import { generatedContentsEntries } from "./generated-contents.js";

/** Un titre Markdown réellement présent dans le manuscrit compilé, avec son
 * niveau (nombre de `#`, 1 à 6) et son texte, dans l'ordre où il apparaît. */
export type ManuscriptHeading = {
  level: number;
  title: string;
};

const HEADING_LINE = /^(#{1,6})[ \t]+(.+)$/gm;

/** Titres du manuscrit compilé, dans leur ordre réel — les pages Front
 * (`segments[i].frontType` renseigné : titre/dédicace/épigraphe…) sont
 * IGNORÉES : elles précèdent narrativement le roman, leurs éventuels titres
 * n'en font pas partie. */
export function extractManuscriptHeadings(segments: CompileSegment[]): ManuscriptHeading[] {
  const out: ManuscriptHeading[] = [];
  for (const segment of segments) {
    if (segment.frontType) continue;
    const text = segment.text || "";
    for (const match of text.matchAll(HEADING_LINE)) {
      out.push({ level: match[1].length, title: match[2].trim() });
    }
  }
  return out;
}

function block(title: string, lines: string[]): string {
  return lines.length ? `${title}\n\n${lines.join("\n")}\n` : `${title}\n`;
}

/** Sommaire : uniquement les deux premiers niveaux de titres du manuscrit
 * (typiquement parties et chapitres), en liste simple, dans leur ordre
 * réel. */
export function generateSummary(segments: CompileSegment[]): string {
  const lines = generatedContentsEntries(segments)
    .filter((h) => h.level <= 2)
    .map((h) => `- ${h.text}`);
  return block("# Sommaire", lines);
}

/** Table des matières : tous les niveaux de titres présents, indentés selon
 * leur niveau, dans leur ordre réel. */
export function generateTableOfContents(segments: CompileSegment[]): string {
  const lines = generatedContentsEntries(segments)
    .map((h) => `${"  ".repeat(h.level - 1)}- ${h.text}`);
  return block("# Table des matières", lines);
}
