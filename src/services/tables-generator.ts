/** Génération de la Table des illustrations (Phase 7).
 *
 * Même principe que Sommaire/Table des matières (services/contents-
 * generator.ts) : calculée à la compilation à partir des `segments` déjà
 * produits par `compile()` (services/compile-export.ts) — jamais d'un
 * fichier Markdown source propre, jamais de syntaxe de légende inventée.
 * Élément "generated" du modèle commun de composition (services/book-
 * composition.ts). Pas de numéros de page ici : ils dépendent de la mise en
 * page (Phase 11).
 *
 * Volontairement minimal : seules les images Markdown standard
 * `![Légende](chemin)` avec un texte alternatif non vide comptent comme
 * illustration légendée. Ni table des tableaux, ni table des figures
 * séparée, ni nouvelle syntaxe de légende — ce module pourra être enrichi
 * plus tard si une vraie source de légende est ajoutée. */

const IMAGE_WITH_ALT = /!\[([^\]]+)\]\([^)]*\)/g;

/** Légendes d'illustrations réellement présentes dans le manuscrit compilé,
 * dans leur ordre réel — les pages Front sont IGNORÉES (comme pour Sommaire/
 * TDM), les images sans texte alternatif sont ignorées (elles ne matchent
 * même pas le motif), et les doublons EXACTS ne sont conservés qu'une fois
 * (première occurrence). */
export function extractIllustrationCaptions(segments: CompileSegment[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    if (segment.frontType) continue;
    const text = segment.text || "";
    for (const match of text.matchAll(IMAGE_WITH_ALT)) {
      const caption = match[1].trim();
      if (!caption || seen.has(caption)) continue;
      seen.add(caption);
      out.push(caption);
    }
  }
  return out;
}

/** Table des illustrations : titre `# Table des illustrations` suivi d'une
 * légende par ligne, dans leur ordre réel. `null` s'il n'existe aucune
 * illustration légendée — jamais de page générée vide (règle explicite de
 * la Phase 7, contrairement à Sommaire/TDM qui affichent toujours leur
 * titre). */
export function generateTableOfIllustrations(segments: CompileSegment[]): string | null {
  const captions = extractIllustrationCaptions(segments);
  if (!captions.length) return null;
  return `# Table des illustrations\n\n${captions.map((c) => `- ${c}`).join("\n")}\n`;
}
