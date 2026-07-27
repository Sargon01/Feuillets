type JournalStatsSettings = {
  stats?: Record<string, { start: number; latest: number }>;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Clé "AAAA-MM-JJ" pour une date donnée, même convention que todayKey(). */
export function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Mots écrits ce jour-là : delta déjà tenu par updateDailyStats. Fonction
 * pure, ne lit rien sur le disque, se contente de settings.stats. */
export function statsForDay(settings: JournalStatsSettings, key: string) {
  const st = (settings.stats || {})[key];
  const delta = st ? Math.max(0, st.latest - st.start) : 0;
  return { delta };
}
