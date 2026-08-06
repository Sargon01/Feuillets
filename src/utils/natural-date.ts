/**
 * Dates historiques en français naturel — moteur PUR (aucune dépendance à
 * Obsidian), partagé par le parseur de date de scène (utils/core.ts) et,
 * pour la normalisation des valeurs YAML brutes, par tout appelant qui lit
 * une propriété de frontmatter potentiellement typée par Obsidian (nombre,
 * objet `Date`…) plutôt que laissée en chaîne.
 *
 * Formats ACCEPTÉS en entrée, en plus des anciens formats ISO déjà
 * compatibles (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`, éventuellement précédé
 * d'un `-` pour une ancienne convention avant J.-C., et `YYYY-MM-DD HH:MM`
 * / `YYYY-MM-DDTHH:MM` pour l'ancien usage avec heure) :
 *   - `765` (année seule)
 *   - `12 mars 765` (jour + mois + année)
 *   - `mars 765` (mois + année)
 *   - `1er novembre 1755` (jour ordinal + mois + année)
 *   - `1er novembre 1755 à 9 h 30` (+ heure)
 *   - `44 av. J.-C.` / `15 mars 44 av. J.-C.` (avant J.-C.)
 *   - `1 apr. J.-C.` (après J.-C., explicite)
 *   - `vers 450 av. J.-C.` (approximatif)
 *
 * Convention interne pour les années avant J.-C. : négation NAÏVE, sans
 * décalage astronomique (« 44 av. J.-C. » vaut simplement l'année -44) —
 * la même convention déjà utilisée ailleurs dans le plugin (voir
 * entity-states.ts et l'ancien parseStoryDate). L'année 0 est TOUJOURS
 * rejetée (`null`), qu'elle soit écrite `0`, `0 av. J.-C.`, `0 apr. J.-C.`
 * ou `-0000` — elle n'existe pas dans l'écriture historique usuelle et ne
 * doit donc jamais être acceptée comme une date valide, ni affichée, ni
 * comparée.
 */

export type DatePrecision = "year" | "month" | "day";
export type DateEra = "BC" | "AD" | null;

export interface NaturalDate {
  /** Année interne signée — voir la convention naïve ci-dessus. Jamais 0. */
  year: number;
  /** 1-12, vaut 1 par défaut si la précision ne descend pas au mois. */
  month: number;
  /** 1-31, vaut 1 par défaut si la précision ne descend pas au jour. */
  day: number;
  precision: DatePrecision;
  /** `"BC"`/`"AD"` seulement quand l'ère est EXPLICITE dans le texte
   * source (« av. J.-C. », « apr. J.-C. ») — sert à l'affichage, jamais
   * à la comparaison (qui ne regarde que `year`, déjà signé). */
  era: DateEra;
  /** Vrai pour une date précédée de « vers » — approximative, ne doit
   * jamais déclencher une alerte chronologique stricte injustifiée côté
   * appelant. Aucun système d'alerte n'exploite ce flag pour l'instant :
   * c'est un simple indicateur d'affichage, à disposition d'un futur
   * appelant qui voudrait assouplir son propre seuil. */
  approx: boolean;
  /** Heure/minute — PUREMENT informatives : jamais utilisées pour trier ou
   * comparer des dates (voir parseStoryDate, utils/core.ts, dont le `sort`
   * ne dépend que de year/month/day). `hour` seul sans `minute` vaut une
   * heure ronde (« à 9 h »). */
  hour?: number;
  minute?: number;
}

const MONTHS_FR = [
  "janvier", "fevrier", "mars", "avril", "mai", "juin",
  "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
];

/** Noms de mois pour l'AFFICHAGE — accents complets, jamais ceux de
 * MONTHS_FR (repliés, utilisés uniquement pour la RECONNAISSANCE). */
const MONTHS_DISPLAY = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function foldLower(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function monthIndexFromFolded(word: string): number | null {
  const idx = MONTHS_FR.indexOf(word);
  return idx >= 0 ? idx + 1 : null;
}

function isLeapYear(year: number): boolean {
  const y = Math.abs(year);
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Nombre de jours du mois — `year` peut être négatif (avant J.-C.),
 * le calcul bissextile retombe alors sur sa valeur absolue (approximation
 * assumée : aucun besoin exprimé de calendrier proleptique exact ici). */
function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

/** Heure/minute valides (0-23 / 0-59) — au-delà, la date ENTIÈRE est
 * rejetée (`null`), jamais silencieusement tronquée ou ignorée : une heure
 * mal formée est le signe d'une saisie erronée, pas d'un champ facultatif
 * à laisser de côté. */
function isValidTime(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23
    && Number.isInteger(minute) && minute >= 0 && minute <= 59;
}

/**
 * Analyse une date au format ISO déjà compatible : `YYYY`, `YYYY-MM`,
 * `YYYY-MM-DD`, année sur 1 à 4 chiffres, optionnellement précédée d'un
 * `-` (ancienne convention avant J.-C., compatible avec les fichiers déjà
 * créés) — et, à la précision jour uniquement, une heure optionnelle au
 * format `YYYY-MM-DD HH:MM` ou `YYYY-MM-DDTHH:MM` (ancien usage préservé).
 * Rejette tout mois/jour/heure/minute hors bornes calendaires, ainsi que
 * l'année 0. `null` dans tous ces cas — l'appelant retombe alors sur
 * parseNaturalDate(). SEUL parseur ISO du plugin (voir parseStoryDate,
 * utils/core.ts, qui délègue ici plutôt que de revalider indépendamment).
 */
export function parseIsoDate(raw: string | undefined | null): NaturalDate | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const m = /^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?)?)?$/.exec(trimmed);
  if (!m) return null;

  const year = parseInt(m[1], 10);
  if (year === 0) return null; // jamais d'année 0, ISO compris (ex. "-0000").
  const era: DateEra = year < 0 ? "BC" : null;

  if (!m[2]) return { year, month: 1, day: 1, precision: "year", era, approx: false };
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;

  if (!m[3]) return { year, month, day: 1, precision: "month", era, approx: false };
  const day = parseInt(m[3], 10);
  if (day < 1 || day > daysInMonth(year, month)) return null;

  if (!m[4]) return { year, month, day, precision: "day", era, approx: false };
  const hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  if (!isValidTime(hour, minute)) return null;

  return { year, month, day, precision: "day", era, approx: false, hour, minute };
}

/**
 * Analyse une date en français naturel — voir les formats acceptés en
 * tête de fichier. `null` si la chaîne ne correspond à aucun d'entre eux.
 * N'essaie PAS les formats ISO (voir parseIsoDate) : utiliser
 * parseFlexibleDate() pour accepter les deux.
 */
export function parseNaturalDate(raw: string | undefined | null): NaturalDate | null {
  if (typeof raw !== "string") return null;
  const original = raw.trim();
  if (!original) return null;

  let working = foldLower(original);

  let approx = false;
  const versMatch = working.match(/^vers\s+/);
  if (versMatch) {
    approx = true;
    working = working.slice(versMatch[0].length).trim();
  }

  let era: DateEra = null;
  const bcMatch = working.match(/\s+(?:av\.?\s*j\.?-?\s*c\.?|avant\s+j\.?-?\s*c\.?)\s*$/);
  if (bcMatch && bcMatch.index !== undefined) {
    era = "BC";
    working = working.slice(0, bcMatch.index).trim();
  } else {
    const adMatch = working.match(/\s+(?:apr\.?\s*j\.?-?\s*c\.?|ap\.?\s*j\.?-?\s*c\.?|apres\s+j\.?-?\s*c\.?)\s*$/);
    if (adMatch && adMatch.index !== undefined) {
      era = "AD";
      working = working.slice(0, adMatch.index).trim();
    }
  }

  let hour: number | undefined;
  let minute: number | undefined;
  const timeMatch = working.match(/\s+a\s+(\d{1,2})\s*h\s*(\d{1,2})?\s*$/);
  if (timeMatch && timeMatch.index !== undefined) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (!isValidTime(hour, minute)) return null;
    working = working.slice(0, timeMatch.index).trim();
  }

  if (!working) return null;

  // Jour (+ « er » ordinal facultatif) + mois + année — « 12 mars 765 »,
  // « 1er novembre 1755 ».
  let m = working.match(/^(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{1,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = monthIndexFromFolded(m[2]);
    let year = parseInt(m[3], 10);
    if (!month || day < 1 || day > daysInMonth(year, month) || year === 0) return null;
    if (era === "BC") year = -year;
    return { year, month, day, precision: "day", era, approx, hour, minute };
  }

  // Mois + année — « mars 765 ».
  m = working.match(/^([a-z]+)\s+(\d{1,4})$/);
  if (m) {
    const month = monthIndexFromFolded(m[1]);
    let year = parseInt(m[2], 10);
    if (!month || year === 0) return null;
    if (era === "BC") year = -year;
    return { year, month, day: 1, precision: "month", era, approx, hour, minute };
  }

  // Année seule — « 765 », « 44 » (avec ou sans ère explicite).
  m = working.match(/^(\d{1,4})$/);
  if (m) {
    let year = parseInt(m[1], 10);
    if (year === 0) return null;
    if (era === "BC") year = -year;
    return { year, month: 1, day: 1, precision: "year", era, approx, hour, minute };
  }

  return null;
}

/** Essaie l'ISO déjà compatible en premier, puis le français naturel —
 * le parseur unique à utiliser côté appelants (chronology-matcher,
 * formatage d'affichage). */
export function parseFlexibleDate(raw: string | undefined | null): NaturalDate | null {
  return parseIsoDate(raw) ?? parseNaturalDate(raw);
}

/**
 * Formate une date déjà analysée en français naturel — jamais de valeur
 * technique ou brute (pas de zéro de tête, pas de tiret ISO, pas d'année
 * 0 — déjà impossible ici puisque les parseurs ci-dessus la rejettent en
 * amont). Retourne `null` si la date ne peut pas être formatée proprement
 * (mois hors bornes…) : l'appelant ne doit alors jamais afficher la
 * valeur brute à la place (voir les appelants de cette fonction).
 */
export function formatNaturalDate(parsed: NaturalDate | null | undefined): string | null {
  if (!parsed || !Number.isFinite(parsed.year) || parsed.year === 0) return null;
  const { year, month, day, precision, era, approx, hour, minute } = parsed;
  const displayYear = Math.abs(year);

  let core: string;
  if (precision === "day") {
    if (!month || month < 1 || month > 12) return null;
    if (!day || day < 1 || day > 31) return null;
    const dayStr = day === 1 ? "1er" : String(day);
    core = `${dayStr} ${MONTHS_DISPLAY[month - 1]} ${displayYear}`;
  } else if (precision === "month") {
    if (!month || month < 1 || month > 12) return null;
    core = `${MONTHS_DISPLAY[month - 1]} ${displayYear}`;
  } else {
    core = String(displayYear);
  }

  let out = approx ? `vers ${core}` : core;
  if (era === "BC" || year < 0) out += " av. J.-C.";
  else if (era === "AD") out += " apr. J.-C.";

  if (hour !== undefined && Number.isFinite(hour)) {
    out += minute ? ` à ${hour} h ${String(minute).padStart(2, "0")}` : ` à ${hour} h`;
  }

  return out;
}

/** Construit une NaturalDate d'affichage à partir des composants « bruts »
 * déjà utilisés par l'ancien parseStoryDate (year, mo 0-12 où 0 = absent,
 * d 0-31 où 0 = absent) — pont entre les deux représentations, utilisé
 * uniquement pour le formatage (jamais pour la comparaison/tri, qui reste
 * celle de parseStoryDate). */
export function naturalDateFromComponents(year: number, mo: number, d: number): NaturalDate {
  const precision: DatePrecision = mo <= 0 ? "year" : d <= 0 ? "month" : "day";
  return {
    year,
    month: mo > 0 ? mo : 1,
    day: d > 0 ? d : 1,
    precision,
    era: year < 0 ? "BC" : null,
    approx: false,
  };
}

/**
 * Normalise une valeur BRUTE de frontmatter YAML — Obsidian analyse le
 * YAML, pas seulement le lit : `date: 1879` (sans guillemets, l'écriture
 * la plus naturelle) arrive dans metadataCache comme le NOMBRE `1879`, pas
 * la chaîne `"1879"` ; `date: 1755-11-03` arrive comme un objet `Date`
 * (type YAML "timestamp"). Un simple `typeof valeur === "string"` rejette
 * donc silencieusement la quasi-totalité des fiches écrites sans
 * guillemets. Fonction PURE, générique (accepte n'importe quel `unknown`,
 * pas seulement une propriété de chronologie) — utilisée par
 * parseStoryDate (utils/core.ts) pour la date d'un feuillet/scène, la date
 * d'un jalon, `naissance`/`mort`, et toute autre propriété de date lue par
 * ce même parseur.
 */
export function normalizeDateInput(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed || undefined;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(Math.trunc(raw));
  }
  // Compat historique : parseStoryDate acceptait déjà `boolean` (via
  // String(raw)) avant ce chantier — jamais une date valide en pratique,
  // mais préservé pour ne rien changer silencieusement à ses appelants.
  if (typeof raw === "boolean") {
    return String(raw);
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    // UTC, jamais l'heure locale : Obsidian pose ses dates YAML à minuit
    // UTC, un fuseau horaire négatif ferait sinon glisser la date d'un jour.
    const y = raw.getUTCFullYear();
    const mo = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const d = String(raw.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return undefined;
}
