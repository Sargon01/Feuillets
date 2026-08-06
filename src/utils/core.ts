import type { TFile } from "obsidian";
import { parseIsoDate, parseNaturalDate, formatNaturalDate, normalizeDateInput } from "./natural-date.js";

/** Retire la syntaxe Markdown d'un extrait pour un APERÇU en texte propre
 * (cartes, binder) — on garde le texte lisible, on enlève seulement les
 * balises (`*`, `**`, `#`, `[[ ]]`, `[texte](url)`, `> `, puces, séparateurs
 * de scène, appels de note…). Volontairement conservateur sur l'underscore :
 * seul un `_..._` clairement délimité (bordé de non-mots) est traité comme
 * de l'italique, pour ne jamais amputer un identifiant en snake_case. */
export function stripMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  let t = text;

  // Blocs et spans de code : on retire les délimiteurs, on garde le contenu.
  t = t.replace(/```[a-zA-Z0-9]*\r?\n?/g, "").replace(/```/g, "");
  // Images (embed Obsidian ou Markdown) : retirées entièrement de l'aperçu.
  t = t.replace(/!\[\[[^\]]*\]\]/g, "");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Wikiliens : [[cible|alias]] -> alias ; [[dossier/cible]] -> "cible".
  t = t.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) =>
    alias !== undefined ? alias : target.split("/").pop()!
  );
  // Liens Markdown [texte](url) -> texte.
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Définitions de notes de bas de page [^id]: texte -> ligne retirée en
  // entier (sinon seul le retrait du marqueur [^id] laisse fuiter
  // « : texte de la note » dans l'aperçu, avec un « : » orphelin en tête —
  // best-effort sur la ligne de marqueur ; une éventuelle continuation
  // indentée sur la ligne suivante n'est pas reconnue comme telle ici et
  // reste traitée comme du texte normal, ce qui reste lisible).
  t = t.replace(/^[ \t]{0,3}\[\^[^\]]+\]:.*$/gm, "");
  // Appels de note de bas de page [^id] -> retirés.
  t = t.replace(/\[\^[^\]]+\]/g, "");

  // Balises ancrées en début de ligne : titres, citations, puces, numéros,
  // séparateurs de scène (*** / --- / ___ seuls sur leur ligne).
  t = t
    .split("\n")
    .map((line) => {
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return ""; // *** --- ___ (avec ou sans espaces)
      return line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^\s{0,3}[-*+]\s+/, "")
        .replace(/^\s{0,3}\d+\.\s+/, "");
    })
    .join("\n");

  // Emphases à base d'astérisque (les plus courantes ici), surlignage,
  // barré : marqueurs retirés, contenu gardé.
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  t = t.replace(/\*\*(.+?)\*\*/g, "$1");
  t = t.replace(/\*(.+?)\*/g, "$1");
  t = t.replace(/~~(.+?)~~/g, "$1");
  t = t.replace(/==(.+?)==/g, "$1");
  t = t.replace(/`([^`]+)`/g, "$1");
  // Italique par underscore UNIQUEMENT s'il est bordé de non-mots (jamais au
  // milieu d'un mot type snake_case).
  t = t.replace(/(^|[^A-Za-z0-9_])_(?!_)([^_]+?)_(?![A-Za-z0-9_])/g, "$1$2");
  t = t.replace(/(^|[^A-Za-z0-9_])__([^_]+?)__(?![A-Za-z0-9_])/g, "$1$2");

  // Caractères Markdown échappés : on rend le caractère littéral.
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!~>])/g, "$1");
  // Astérisques/accents graves esseulés restants (jamais l'underscore).
  t = t.replace(/[*`]/g, "");

  // Espaces et lignes vides surnuméraires.
  t = t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export function countWords(text: string): number {
  let t = text;
  t = t.replace(/^---\n[\s\S]*?\n---\n?/, "");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2");
  t = t.replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1");
  t = t.replace(/[#>*_`~=]{1,}/g, " ");
  const words = t.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length;
}

export function foldAccents(str: unknown): string {
  const s = typeof str === "string" ? str : (typeof str === "number" || typeof str === "boolean" ? String(str) : "");
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function embedHardBreaks(text: string): string {
  const structural = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|\||\s*\*{3}\s*$)/;
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      const out: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isLast = i === lines.length - 1;
        /* une ligne suivante vide (ou ne contenant que l'espace insécable
           du marqueur de "ligne blanche visible" de Feuillets) sépare déjà
           visuellement les deux lignes — lui ajouter un antislash de saut
           forcé produisait un "\" littéral et visible juste avant chaque
           ligne blanche, exporté tel quel en Word. */
        const nextIsStructural =
          !isLast && (structural.test(lines[i + 1]) || lines[i + 1].trim() === "");
        if (
          !isLast &&
          line.trim() !== "" &&
          !structural.test(line) &&
          !nextIsStructural
        ) {
          out.push(line + "\\");
        } else {
          out.push(line);
        }
      }
      return out.join("\n");
    })
    .join("\n\n");
}

/** Format ISO[-like] canonique déjà couvert par les tests historiques —
 * positif, sans zéro de tête sur l'année : pour CE format précis
 * uniquement, `display` reste l'écho brut de la chaîne saisie (comportement
 * inchangé). Tout le reste (année négative, zéro de tête, date en français
 * naturel) passe par un affichage recalculé — voir formatNaturalDate. */
const CANONICAL_PLAIN_ISO = /^\d{1,4}(-\d{1,2}(-\d{1,2})?)?$/;
/** Une année écrite avec un zéro de tête ("0765") n'est PAS canonique :
 * doit passer par formatNaturalDate() pour perdre ce zéro à l'affichage
 * (voir item 7 — jamais de "0765" brut affiché). Un simple "0" reste
 * canonique (rien à perdre). */
const LEADING_ZERO_YEAR = /^0\d/;

/**
 * Date d'un feuillet/scène ou d'une fiche d'entité (naissance/mort…) —
 * accepte l'ANCIEN format ISO[-like] déjà compatible (`AAAA[-MM[-JJ]]`,
 * éventuellement négatif pour une ancienne convention avant J.-C., et
 * `AAAA-MM-JJ HH:MM`/`AAAA-MM-JJTHH:MM` pour l'ancien usage avec heure) ET,
 * en repli, le français naturel (« 12 mars 765 », « 44 av. J.-C. »…, voir
 * utils/natural-date.ts). Aucune propriété `type` n'est jamais nécessaire
 * pour qu'une date soit reconnue — seule la valeur compte.
 *
 * `raw` accepte directement une chaîne, un nombre, un booléen ou un objet
 * `Date` (voir normalizeDateInput, utils/natural-date.ts) : Obsidian
 * analyse le YAML, pas seulement le lit — `date: 1879` (sans guillemets)
 * arrive du cache en NOMBRE, `date: 1755-11-03` en objet `Date` — jamais en
 * chaîne. Les appelants n'ont donc plus besoin d'une conversion préalable.
 *
 * SEUL parseur ISO du plugin pour la branche ISO (délègue à parseIsoDate,
 * utils/natural-date.ts) — mêmes règles de validation partout (mois/jour/
 * heure hors bornes, année 0 : toujours rejetés), jamais deux jeux de
 * règles différents pour un même format.
 */
export function parseStoryDate(
  raw: unknown,
  file: TFile | null = null
): { sort: number; y: number; mo: number; d: number; display: string } | null {
  let str = normalizeDateInput(raw) ?? "";
  if (!str && file) {
    /* année à 4 chiffres exigée : un fichier nommé "4.md" ou "10.md"
       (numérotation ordinaire d'un chapitre) ne doit jamais être pris
       pour une date — seul un vrai motif AAAA[-MM[-JJ]] compte. */
    const m0 = file.basename.match(/^(\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?)(?:\s|$|-)/);
    if (m0) str = m0[1];
  }
  if (!str) return null;

  // 1) Ancien format ISO[-like].
  const iso = parseIsoDate(str);
  if (iso) {
    // Convention historique de ce parseur (contrairement à NaturalDate) :
    // mois/jour ABSENTS valent 0, pas 1 — préservée ici pour ne rien
    // changer aux appelants existants (StoryDate.mo/.d).
    const mo = iso.precision === "year" ? 0 : iso.month;
    const d = iso.precision === "day" ? iso.day : 0;
    const sort = iso.year * 10000 + mo * 100 + d;
    const yearPrefix = str.match(/^-?\d{1,4}/)?.[0] ?? "";
    const display = CANONICAL_PLAIN_ISO.test(str) && !LEADING_ZERO_YEAR.test(yearPrefix)
      ? str
      : formatNaturalDate(iso) ?? str;
    return { sort, y: iso.year, mo, d, display };
  }

  // 2) Repli : français naturel.
  const natural = parseNaturalDate(str);
  if (natural) {
    const mo = natural.precision === "year" ? 0 : natural.month;
    const d = natural.precision === "day" ? natural.day : 0;
    const sort = natural.year * 10000 + mo * 100 + d;
    const display = formatNaturalDate(natural) ?? str;
    return { sort, y: natural.year, mo, d, display };
  }

  return null;
}

/** Compacte les sauts de ligne simples entre deux lignes de texte "normales"
 * (ni vides, ni structurelles) : les paragraphes déjà séparés par une ligne
 * vide, et les lignes de structure (titres, listes, citations, code,
 * tableaux, ***), sont laissés intacts. */
export function compactLineBreaks(text: string): string {
  const structural = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|\||\s*\*{3}\s*$|\s*$)/;
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlank = line.trim() === "";
    if (isBlank) {
      const prev = out[out.length - 1];
      const next = lines[i + 1];
      const nextBlank = next === undefined || next.trim() === "";
      const prevOk =
        prev !== undefined && prev.trim() !== "" && !structural.test(prev);
      const nextOk =
        next !== undefined && next.trim() !== "" && !structural.test(next);
      if (prevOk && nextOk && !nextBlank) {
        continue; // supprime cette ligne vide : simple saut de ligne
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Corrections typographiques françaises. skipFrontmatter : préserve l'en-tête.
 * Le code (bloc ``` ``` ou span `inline`) n'est jamais touché : guillemets et
 * apostrophes y ont un sens syntaxique, pas typographique. */
export function frenchTypography(text: string, skipFrontmatter: boolean): string {
  let head = "";
  let body = text;
  if (skipFrontmatter) {
    const m = text.match(/^---\n[\s\S]*?\n---\n?/);
    if (m) {
      head = m[0];
      body = text.slice(head.length);
    }
  }
  const NB = " "; // espace fine insécable
  const applyRules = (s: string): string =>
    s
      .replace(/\.\.\./g, "…")
      .replace(/(^|[\s(«])"([^"]+)"/g, (_, a, inner) => `${a}«${NB}${inner}${NB}»`)
      .replace(/'/g, "’")
      .replace(/[ \t]+([;:!?»])/g, `${NB}$1`)
      .replace(/«[ \t]+/g, `«${NB}`)
      .replace(/([\wÀ-ÿ…!?.])([;:!?])/g, (m0, a, p) =>
        p === ";" || p === ":" || p === "!" || p === "?" ? `${a}${NB}${p}` : m0
      );
  body = body
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : applyRules(part)))
    .join("");
  return head + body;
}

export function todayKey(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
