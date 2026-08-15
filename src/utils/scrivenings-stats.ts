import type { ScriveningsDocument } from "../services/scrivenings-document.js";
import { countWords } from "./core.js";
import { formatNumber } from "./text-metrics.js";
import { t } from "../i18n/index.js";

/**
 * Statistiques du groupe affiché par Continu (LOT 2B.2) : nombre de
 * feuillets composant le scope courant et somme de leurs nombres de mots,
 * chacun compté avec `countWords(segment.body)` — jamais le frontmatter, les
 * titres widgets ou les jonctions structurelles, qui n'existent que dans le
 * texte composite CodeMirror, jamais dans `segment.body`.
 */
export type ScriveningsStats = {
  fileCount: number;
  wordCount: number;
};

/** Comptes de mots par chemin — table intermédiaire qui permet le recalcul
 * incrémental (voir `updateScriveningsWordCounts` ci-dessous) sans jamais
 * rescanner tout le manuscrit à chaque frappe. */
export type ScriveningsWordCounts = ReadonlyMap<string, number>;

/**
 * Calcul complet — un seul passage sur tous les segments. À appeler au
 * chargement d'un scope et après toute recomposition (ajout/retrait de
 * feuillet), jamais à chaque frappe.
 */
export function computeScriveningsWordCounts(doc: ScriveningsDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const segment of doc.segments) {
    counts.set(segment.path, countWords(segment.body));
  }
  return counts;
}

/**
 * Recalcul INCRÉMENTAL : ne recompte que les chemins de `touchedPaths` (voir
 * `ScriveningsEditResult.touchedPaths`, services/scrivenings-document.ts) —
 * un segment non touché conserve exactement son compte précédent. Retire
 * aussi tout chemin qui n'appartient plus au document (recomposition ayant
 * retiré un feuillet), et ajoute ceux qui y sont entrés pour la première
 * fois (recomposition ayant ajouté un feuillet dont le corps a été « touché »
 * par le chargement — en pratique on repasse plutôt par
 * `computeScriveningsWordCounts` complet sur une recomposition, cette
 * fonction reste correcte dans les deux cas).
 */
export function updateScriveningsWordCounts(
  doc: ScriveningsDocument,
  touchedPaths: readonly string[],
  previous: ScriveningsWordCounts
): Map<string, number> {
  const next = new Map(previous);
  const currentPaths = new Set(doc.segments.map((segment) => segment.path));

  for (const path of next.keys()) {
    if (!currentPaths.has(path)) next.delete(path);
  }

  for (const path of touchedPaths) {
    const segment = doc.segments.find((s) => s.path === path);
    if (segment) next.set(path, countWords(segment.body));
    else next.delete(path);
  }

  return next;
}

/** Assemble les statistiques exposées (`ScriveningsView.getGroupStats()`) à
 * partir du document courant et de la table de comptes maintenue par la
 * vue. `fileCount` vient toujours du nombre RÉEL de segments — jamais de
 * `wordCounts.size`, qui pourrait transitoirement diverger. */
export function scriveningsStatsFromCounts(doc: ScriveningsDocument, wordCounts: ScriveningsWordCounts): ScriveningsStats {
  let wordCount = 0;
  for (const segment of doc.segments) {
    wordCount += wordCounts.get(segment.path) ?? 0;
  }
  return { fileCount: doc.segments.length, wordCount };
}

/** Texte affiché sous l'éditeur Continu (§7 du lot) — singulier/pluriel géré
 * par les clés i18n `scrivenings.stats.sheet.one/.other` et
 * `scrivenings.stats.word.one/.other`. */
export function formatScriveningsStats(stats: ScriveningsStats): string {
  const sheetKey = stats.fileCount === 1 ? "scrivenings.stats.sheet.one" : "scrivenings.stats.sheet.other";
  const wordKey = stats.wordCount === 1 ? "scrivenings.stats.word.one" : "scrivenings.stats.word.other";
  const sheets = t(sheetKey, { count: formatNumber(stats.fileCount) });
  const words = t(wordKey, { count: formatNumber(stats.wordCount) });
  return `${sheets} · ${words}`;
}
