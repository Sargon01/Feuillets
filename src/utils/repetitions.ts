/* Détection de répétitions rapprochées (Analyse — Phase 4). Moteur maison,
 * FR-safe, sans NLP : repère les mots de contenu qui reviennent à faible
 * distance (fenêtre glissante en nombre de mots) — le défaut de prose le plus
 * courant en français. Pas de lemmatisation (Phase 5, via Grammalecte) : on
 * compare la forme de surface, minuscule et sans accents. Fonction PURE,
 * testable sans Obsidian ; renvoie les décalages (offsets) caractères pour
 * permettre la navigation vers chaque occurrence. */

import { foldAccents } from "./core.js";

type Occurrence = {
  raw: string;
  wi: number;
  offset: number;
};

/** Mots-outils français exclus (articles, pronoms, prépositions, conjonctions,
 * auxiliaires, adverbes très fréquents) : leur répétition est normale et ne
 * doit jamais être signalée. Liste volontairement compacte, extensible. */
export const FR_STOPWORDS = new Set([
  "alors", "aucun", "aussi", "autre", "avait", "avec", "avoir", "bien", "cela",
  "cent", "cette", "ceux", "chaque", "comme", "comment", "dans", "des", "deux",
  "donc", "dont", "elle", "elles", "encore", "entre", "était", "étaient", "être",
  "eux", "fait", "faire", "fois", "font", "hors", "ici", "jamais", "leur", "leurs",
  "lorsque", "lui", "mais", "même", "moins", "notre", "nous", "pour", "pourquoi",
  "puis", "quand", "que", "quel", "quelle", "quelles", "quels", "qui", "sans",
  "ses", "soit", "sont", "sous", "sur", "tandis", "tant", "toujours", "tous",
  "tout", "toute", "toutes", "très", "vers", "votre", "vous", "était",
]);

function normalize(word: string): string {
  return foldAccents(word).replace(/[’]/g, "'");
}

/** Répétitions rapprochées d'un texte.
 * window : distance max en mots entre deux occurrences pour les lier (déf. 50)
 * minLen : longueur minimale d'un mot considéré (déf. 4) */
export function findRepetitions(
  text: string,
  opts: { window?: number; minLen?: number; stopWords?: Set<string> } = {}
): Array<{ word: string; norm: string; count: number; offsets: number[]; minGap: number }> {
  const window = opts.window ?? 50;
  const minLen = opts.minLen ?? 4;
  const stopWords = opts.stopWords ?? FR_STOPWORDS;

  const re = /[\p{L}][\p{L}\p{N}'’-]*/gu;
  const groups = new Map<string, Occurrence[]>();
  let m: RegExpExecArray | null;
  let wi = 0;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const norm = normalize(raw);
    wi++;
    if (norm.length < minLen || stopWords.has(norm)) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push({ raw, wi, offset: m.index });
  }

  const result: Array<{ word: string; norm: string; count: number; offsets: number[]; minGap: number }> = [];
  for (const [norm, occ] of groups) {
    if (occ.length < 2) continue;
    // Signalé seulement si au moins deux occurrences sont proches (< window),
    // mais on renvoie TOUTES les occurrences du mot pour pouvoir les surligner
    // ensemble dans le texte.
    let minGap = Infinity;
    for (let i = 1; i < occ.length; i++) {
      minGap = Math.min(minGap, occ[i].wi - occ[i - 1].wi);
    }
    if (minGap > window) continue;
    result.push({
      word: occ[0].raw,
      norm,
      count: occ.length,
      offsets: occ.map((t) => t.offset),
      minGap,
    });
  }

  result.sort((a, b) => a.minGap - b.minGap || b.count - a.count);
  return result;
}
