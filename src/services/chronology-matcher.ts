/**
 * Moteur PUR de contrôle chronologique — sans dépendance à Obsidian : reçoit
 * la date d'une scène et une liste de fiches de référence (personnages,
 * objets, inventions…) portant chacune une date ponctuelle (`date`) et/ou
 * une période de validité (`validFrom`/`validTo`), et évalue pour chacune
 * si la scène est chronologiquement compatible, anachronique, ou si rien
 * ne permet de trancher.
 */

export interface ChronologyReference {
  id: string;
  path: string;
  title: string;
  /** Date ponctuelle d'un événement (ex. naissance, invention datée
   *  précisément) — ignorée si `validFrom` ou `validTo` est présent : une
   *  période de validité prime toujours sur un simple point. */
  date?: string;
  /** Début de la période de validité (ex. année d'invention). */
  validFrom?: string;
  /** Fin de la période de validité (ex. année de mise hors service). */
  validTo?: string;
}

export type ChronologyStatus =
  | "compatible"
  | "anachronistic-before"
  | "anachronistic-after"
  | "unknown";

export interface ChronologyResult {
  reference: ChronologyReference;
  status: ChronologyStatus;
}

type DatePrecision = "year" | "month" | "day";

/** Date calendaire déjà résolue à sa précision d'origine — `month`/`day`
 * valent 1 quand ils sont absents du texte source (voir parseChronologyDate)
 * ; c'est déjà la borne INFÉRIEURE de la période qu'ils représentent. */
interface ParsedDate {
  year: number;
  month: number;
  day: number;
  precision: DatePrecision;
}

const DATE_PATTERN = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

/** Vrai si `year` est bissextile (calendrier grégorien) — nécessaire pour
 * borner correctement un `YYYY-MM` de février à sa VRAIE fin de mois. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

/**
 * Analyse une date au format `YYYY`, `YYYY-MM` ou `YYYY-MM-DD`. Retourne
 * `null` pour toute valeur absente, mal formée, ou calendairement invalide
 * (mois hors 1-12, jour hors bornes du mois — y compris le 29 février d'une
 * année NON bissextile).
 */
export function parseChronologyDate(value: string | undefined | null): ParsedDate | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = DATE_PATTERN.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  if (!Number.isInteger(year)) return null;

  if (!match[2]) return { year, month: 1, day: 1, precision: "year" };
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  if (!match[3]) return { year, month, day: 1, precision: "month" };
  const day = Number(match[3]);
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day, precision: "day" };
}

/** Ordinal comparable (YYYYMMDD sous forme numérique) — suffisant pour
 * comparer deux dates calendaires par simple soustraction, jamais de vrai
 * calcul de durée nécessaire ici. */
function toOrdinal(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

/** Borne INFÉRIEURE de la période représentée par une date déjà résolue —
 * `parseChronologyDate` remplit déjà mois/jour à 1 quand ils sont absents,
 * donc c'est directement l'ordinal de la date telle quelle. */
function lowerBound(date: ParsedDate): number {
  return toOrdinal(date.year, date.month, date.day);
}

/** Borne SUPÉRIEURE de la période représentée par une date déjà résolue :
 * `YYYY` → 31 décembre, `YYYY-MM` → dernier jour du mois (bissextile
 * compris), `YYYY-MM-DD` → elle-même. C'est cette fonction qui traduit
 * `valid_to: 1879` en `1879-12-31`. */
function upperBound(date: ParsedDate): number {
  if (date.precision === "day") return toOrdinal(date.year, date.month, date.day);
  if (date.precision === "month") return toOrdinal(date.year, date.month, daysInMonth(date.year, date.month));
  return toOrdinal(date.year, 12, 31);
}

/** Intervalle [début, fin] couvert par une date à sa propre précision — une
 * scène datée seulement `1755` couvre toute l'année 1755, par exemple. */
function toInterval(date: ParsedDate): [number, number] {
  return [lowerBound(date), upperBound(date)];
}

/**
 * Évalue le statut chronologique d'UNE référence face à l'intervalle de la
 * scène (`null` si la date de la scène est absente/invalide, auquel cas le
 * statut est toujours "unknown" — voir evaluateChronology).
 *
 * Règles, dans l'ordre :
 * 1. Une période de validité (`validFrom` et/ou `validTo`) prime toujours
 *    sur `date` — dès que l'une des deux bornes est exploitable :
 *    - `validFrom` seul : scène avant la borne → "anachronistic-before",
 *      sinon "compatible" (rien n'interdit qu'elle continue d'exister).
 *    - `validTo` seul : scène après la borne → "anachronistic-after",
 *      sinon "compatible".
 *    - les deux : scène AVANT `validFrom` → "anachronistic-before" ; APRÈS
 *      `validTo` → "anachronistic-after" ; entre les deux (bornes
 *      INCLUSES) → "compatible".
 * 2. Sans période de validité exploitable, `date` seule (événement
 *    ponctuel) : la scène recoupe cette date (à la précision de chacune)
 *    → "compatible" ; sinon → "unknown" (jamais anachronique : rien
 *    n'indique un sens de causalité pour un simple point isolé).
 * 3. Rien d'exploitable (aucun champ, ou tous invalides) → "unknown".
 */
function evaluateReference(sceneInterval: [number, number] | null, reference: ChronologyReference): ChronologyStatus {
  if (!sceneInterval) return "unknown";
  const [sceneStart, sceneEnd] = sceneInterval;

  const validFrom = parseChronologyDate(reference.validFrom);
  const validTo = parseChronologyDate(reference.validTo);

  if (validFrom || validTo) {
    if (validFrom && sceneEnd < lowerBound(validFrom)) return "anachronistic-before";
    if (validTo && sceneStart > upperBound(validTo)) return "anachronistic-after";
    return "compatible";
  }

  const pointDate = parseChronologyDate(reference.date);
  if (pointDate) {
    const [dateStart, dateEnd] = toInterval(pointDate);
    const overlaps = sceneEnd >= dateStart && sceneStart <= dateEnd;
    return overlaps ? "compatible" : "unknown";
  }

  return "unknown";
}

/**
 * Évalue chaque référence face à la date d'une scène. Ordre STABLE (même
 * ordre que `references`, jamais retrié) ; aucune mutation — ni de
 * `references`, ni des objets qu'il contient, ni de `sceneDate` (une
 * chaîne, de toute façon immuable).
 */
export function evaluateChronology(
  sceneDate: string | undefined,
  references: ChronologyReference[]
): ChronologyResult[] {
  const parsedScene = parseChronologyDate(sceneDate);
  const sceneInterval: [number, number] | null = parsedScene ? toInterval(parsedScene) : null;

  return references.map((reference) => ({
    reference,
    status: evaluateReference(sceneInterval, reference),
  }));
}
