/** Fonctions pures des statistiques quotidiennes du Journal — aucune lecture
 * ni écriture sur le disque ici, uniquement des transformations de données.
 * Les statistiques sont stockées PAR PROJET (ProjectMeta.journalStats, voir
 * types.d.ts) : ce module ignore délibérément D'OÙ vient la table qu'on lui
 * passe, c'est aux appelants (main.ts, views/journal-view.ts) de la résoudre
 * pour le projet actif — jamais une table globale mélangeant les projets. */

export type DailyStat = { start: number; latest: number };
export type StatsTable = Record<string, DailyStat>;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Clé "AAAA-MM-JJ" pour une date donnée, même convention que todayKey()
 * (utils/core.ts) — les deux DOIVENT rester identiques. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Ne garde que les entrées `{start, latest}` numériques d'une table de
 * statistiques — défensif contre des données legacy ou corrompues (un
 * ancien settings.stats, ou un projectMeta écrit à la main). */
export function validateStatsTable(value: StatsTable | null | undefined): StatsTable {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: StatsTable = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "object" && entry !== null &&
      typeof entry.start === "number" && Number.isFinite(entry.start) &&
      typeof entry.latest === "number" && Number.isFinite(entry.latest)
    ) {
      result[key] = { start: entry.start, latest: entry.latest };
    }
  }
  return result;
}

/** Statistiques d'UN projet — lecture pure, sans mutation : `journalStats`
 * absent ou invalide retombe sur une table vide, jamais une erreur. */
export function resolveProjectStats(meta: { journalStats?: StatsTable } | null | undefined): StatsTable {
  return validateStatsTable(meta?.journalStats);
}

/** Règle UNIQUE du delta de mots quotidien — jamais négatif (une baisse du
 * total, une purge, un recalcul… ne doit jamais afficher "-N mots"). Utilisée
 * par statsForDay() ET par updateStatusBar() (main.ts) : un seul calcul de
 * delta dans tout le plugin, jamais de `total - start` non borné ailleurs. */
export function dailyWordDelta(start: number, latest: number): number {
  return Math.max(0, latest - start);
}

/** Delta du jour `key` dans une table déjà résolue — voir dailyWordDelta. */
export function statsForDay(stats: StatsTable, key: string): { delta: number } {
  const entry = stats[key];
  const delta = entry ? dailyWordDelta(entry.start, entry.latest) : 0;
  return { delta };
}

/** Enregistre le total observé pour le jour `key` : première observation ->
 * baseline (`start = latest = total`, delta 0) ; observations suivantes ->
 * seul `latest` évolue ; total inchangé -> AUCUNE mutation (`changed: false`,
 * la même table est renvoyée par référence) pour que l'appelant sache qu'il
 * n'a rien à sauvegarder. Fonction pure : ne mute jamais `stats` en entrée. */
export function recordDailyTotal(stats: StatsTable, key: string, total: number): { table: StatsTable; changed: boolean } {
  const existing = stats[key];
  if (!existing) {
    return { table: { ...stats, [key]: { start: total, latest: total } }, changed: true };
  }
  if (existing.latest === total) {
    return { table: stats, changed: false };
  }
  return { table: { ...stats, [key]: { ...existing, latest: total } }, changed: true };
}

/** Fusionne un ancien historique global dans la table d'un projet lors de la
 * migration — les dates déjà présentes dans `current` (les statistiques
 * PROPRES au projet) priment toujours sur l'historique `legacy`. */
export function mergeLegacyStats(current: StatsTable, legacy: StatsTable): StatsTable {
  return { ...legacy, ...current };
}

/** Historique limité aux `retention` dates les plus récentes ; `0` (ou toute
 * valeur non positive/non finie) = illimité, table inchangée (même
 * référence). Fonction pure. */
export function trimStatsTable(stats: StatsTable, retention: number): StatsTable {
  const keep = Number(retention);
  if (!keep || keep <= 0 || !Number.isFinite(keep)) return stats;
  const keys = Object.keys(stats).sort();
  if (keys.length <= keep) return stats;
  const result: StatsTable = {};
  for (const key of keys.slice(keys.length - keep)) result[key] = stats[key];
  return result;
}
